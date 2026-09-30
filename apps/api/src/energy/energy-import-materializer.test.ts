import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
} from "@datafoundry/data-gateway";
import type { EnergyIqImportBatchRecord, EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { fingerprintEnergyIqMeterMapping } from "@datafoundry/metadata";
import {
  buildEnergyExcelMaterialization,
  isEnergyImportMaterializationCurrent,
} from "./energy-import-materializer.js";

describe("buildEnergyExcelMaterialization", () => {
  it("builds the project-canonical interval across two real workbooks in either completion order", async () => {
    const earlierWorkbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(101)],
    ]).toBuffer();
    const laterWorkbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:30:00Z"), number(102)],
      [text("Meter A"), date("2026-05-01T00:45:00Z"), number(103)],
    ]).toBuffer();

    const materialize = async (projectId: string) => ({
      earlier: await buildEnergyExcelMaterialization({
        content: earlierWorkbook,
        batch: batch("batch-a", projectId, "a".repeat(64)),
        document: document(),
        mappingRevision: 4,
        timezone: "Asia/Singapore",
      }),
      later: await buildEnergyExcelMaterialization({
        content: laterWorkbook,
        batch: batch("batch-b", projectId, "b".repeat(64)),
        document: document(),
        mappingRevision: 4,
        timezone: "Asia/Singapore",
      }),
    });

    const forwardInputs = await materialize("project-real-workbooks-forward");
    expect(forwardInputs.earlier.summary.intervalFactCount).toBe(1);
    expect(forwardInputs.later.summary.intervalFactCount).toBe(1);
    const forward = await writeProjectFacts(
      [forwardInputs.earlier.write, forwardInputs.later.write],
      "snapshot-forward-ab",
      "project-real-workbooks-forward",
    );
    expect(forward.projectAudit).toMatchObject({
      normalizedReadingCount: 4,
      intervalFactCount: 3,
      canonicalMeterSeriesCount: 1,
      adjacentReadingPairCount: 3,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(writeProjectFacts(
      [forwardInputs.earlier.write, forwardInputs.later.write],
      "snapshot-forward-ab",
      "project-real-workbooks-forward",
    )).resolves.toMatchObject({
      projectAudit: forward.projectAudit,
    });

    const reverseInputs = await materialize("project-real-workbooks-reverse");
    const reverse = await writeProjectFacts(
      [reverseInputs.later.write, reverseInputs.earlier.write],
      "snapshot-reverse-ab",
      "project-real-workbooks-reverse",
    );
    expect(reverse.projectAudit).toEqual(forward.projectAudit);
  });

  it("turns mapped Singapore cumulative readings into traceable interval facts", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(100.5)],
      [text("Meter A"), date("2026-05-01T00:30:00Z"), number(101)],
    ]).toBuffer();
    const result = await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch(),
      document: document(),
      mappingRevision: 4,
      timezone: "Asia/Singapore",
    });

    expect(result.write.rawReadings).toHaveLength(3);
    expect(result.write.normalizedReadings).toHaveLength(3);
    expect(result.write.normalizedReadings[0]?.eventTime).toBe("2026-04-30T16:00:00.000Z");
    expect(result.write.intervalFacts).toHaveLength(2);
    expect(result.write.intervalFacts[0]).toMatchObject({
      scopeId: "scope-a",
      usageKwh: 0.5,
      averageKw: 2,
      localDate: "2026-05-01",
      localHour: 0,
      qualityStatus: "ok",
    });
    expect(result.summary).toMatchObject({
      rawRowCount: 3,
      normalizedReadingCount: 3,
      intervalFactCount: 2,
      totalUsageKwh: 1,
      mappingRevision: 4,
      timezone: "Asia/Singapore",
      materializerContractVersion: "energy-excel-cumulative-v2",
      factWriterContractVersion: "energy-fact-writer-snapshot-manifest-v4",
      sourceSheetName: "Sheet1",
      sourceRowCount: 3,
      sourceLabels: ["Meter A"],
    });
    expect(result.summary.mappingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.qualityCounts.boundary).toBe(1);

    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify(result.summary),
      },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(true);
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify(result.summary),
      },
      document: document(),
      timezone: "UTC",
    })).toBe(false);
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify({
          ...result.summary,
          materializerContractVersion: "energy-excel-cumulative-v1",
          factWriterContractVersion: "energy-fact-writer-snapshot-manifest-v3",
        }),
      },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(false);
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify({
          ...result.summary,
          factWriterContractVersion: "energy-fact-writer-project-canonical-v2",
        }),
      },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(false);
    expect(isEnergyImportMaterializationCurrent({
      batch: { ...batch(), status: "materialized", materialization_json: JSON.stringify({ intervalFactCount: 2 }) },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(false);
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify({
          ...result.summary,
          factWriterContractVersion: "energy-fact-writer-later-coverage-v1",
        }),
      },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(false);
    const changed = document();
    changed.meter_mapping!.rows[0]!.category = "other";
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify(result.summary),
      },
      document: changed,
      timezone: "Asia/Singapore",
    })).toBe(false);
  });

  it("keeps the exact cumulative delta across a cadence gap without inventing a reading", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(101)],
      [text("Meter A"), date("2026-05-01T00:30:00Z"), number(102)],
      [text("Meter A"), date("2026-05-01T01:00:00Z"), number(104)],
    ]).toBuffer();

    const result = await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch("batch-gap", "project-gap", "g".repeat(64)),
      document: document(),
      mappingRevision: 4,
      timezone: "Asia/Singapore",
    });

    expect(result.write.normalizedReadings).toHaveLength(4);
    expect(result.write.intervalFacts).toEqual([
      expect.objectContaining({
        elapsedMinutes: 15,
        rawDeltaKwh: 1,
        usageKwh: 1,
        averageKw: 4,
        qualityStatus: "ok",
      }),
      expect.objectContaining({
        elapsedMinutes: 15,
        rawDeltaKwh: 1,
        usageKwh: 1,
        averageKw: 4,
        qualityStatus: "ok",
      }),
      expect.objectContaining({
        elapsedMinutes: 30,
        rawDeltaKwh: 2,
        usageKwh: 2,
        averageKw: 4,
        qualityStatus: "gap",
      }),
    ]);
    expect(result.summary).toMatchObject({
      totalUsageKwh: 4,
      qualityCounts: { ok: 2, boundary: 1, gap: 1 },
    });
  });

  it("preserves a regular hourly source cadence without fabricating 15-minute readings", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T01:00:00Z"), number(101.25)],
      [text("Meter A"), date("2026-05-01T02:00:00Z"), number(103)],
    ]).toBuffer();

    const result = await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch("batch-hourly", "project-hourly", "h".repeat(64)),
      document: document(),
      mappingRevision: 4,
      timezone: "Asia/Singapore",
    });

    expect(result.write.normalizedReadings).toHaveLength(3);
    expect(result.write.intervalFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ elapsedMinutes: 60, usageKwh: 1.25, averageKw: 1.25, qualityStatus: "ok" }),
      expect.objectContaining({ elapsedMinutes: 60, usageKwh: 1.75, averageKw: 1.75, qualityStatus: "ok" }),
    ]));
    expect(result.summary).toMatchObject({ intervalFactCount: 2, totalUsageKwh: 3 });
    expect(result.summary.qualityCounts).not.toHaveProperty("gap");
  });

  it("materializes a mapped interval-usage matrix through the current fact writer contract", async () => {
    const workbook = await intervalMatrixWorkbook([
      ["A", 1, 5, 2026, "Friday", "Aircon", "Aircon 1", ...hourlyUsage(0.25)],
    ]);
    const setup = intervalMatrixDocument();

    const result = await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch("batch-interval", "project-interval", "i".repeat(64)),
      document: setup,
      mappingRevision: 5,
      timezone: "Asia/Singapore",
    });

    expect(result.write.normalizedReadings).toEqual([]);
    expect(result.write.intervalFacts).toHaveLength(24);
    expect(result.write.intervalFacts[0]).toMatchObject({
      meterPointId: "preschool-centre-a-aircon-1",
      scopeId: "preschool-centre-a-aircon-1",
      parentNodeId: "preschool-centre-a",
      intervalStart: "2026-04-30T16:00:00.000Z",
      intervalEnd: "2026-04-30T17:00:00.000Z",
      elapsedMinutes: 60,
      rawDeltaKwh: 0.25,
      usageKwh: 0.25,
      averageKw: 0.25,
      localDate: "2026-05-01",
      localHour: 0,
      sourceReadingKind: "interval_usage",
      qualityStatus: "ok",
    });
    expect(result.summary).toMatchObject({
      rawRowCount: 24,
      normalizedReadingCount: 0,
      intervalFactCount: 24,
      totalUsageKwh: 6,
      mappingRevision: 5,
      materializerContractVersion: "energy-excel-preschool-interval-matrix-v1",
      factWriterContractVersion: "energy-fact-writer-snapshot-manifest-v4",
      sourceLabels: ["preschool-centre-a:Aircon 1"],
    });

    const written = await writeProjectFacts([result.write], "snapshot-interval", "project-interval");
    expect(written.projectAudit).toMatchObject({
      normalizedReadingCount: 0,
      intervalFactCount: 24,
      canonicalMeterSeriesCount: 0,
      orphanIntervalFactCount: 0,
    });
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch("batch-interval", "project-interval", "i".repeat(64)),
        status: "materialized",
        materialization_json: JSON.stringify(result.summary),
      },
      document: setup,
      timezone: "Asia/Singapore",
    })).toBe(true);
  });

  it("keeps interval semantics stable when source readings arrive out of order", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:30:00Z"), number(101)],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(100.5)],
    ]).toBuffer();

    const result = await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch("batch-out-of-order", "project-out-of-order", "o".repeat(64)),
      document: document(),
      mappingRevision: 4,
      timezone: "Asia/Singapore",
    });

    expect(result.write.intervalFacts.map((fact) => ({
      from: fact.intervalStart,
      to: fact.intervalEnd,
      usageKwh: fact.usageKwh,
      localDate: fact.localDate,
      localHour: fact.localHour,
    }))).toEqual([
      {
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-04-30T16:15:00.000Z",
        usageKwh: 0.5,
        localDate: "2026-05-01",
        localHour: 0,
      },
      {
        from: "2026-04-30T16:15:00.000Z",
        to: "2026-04-30T16:30:00.000Z",
        usageKwh: 0.5,
        localDate: "2026-05-01",
        localHour: 0,
      },
    ]);
  });

  it("keeps cached date formatters isolated by Project timezone", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(100.5)],
    ]).toBuffer();
    const buildForTimezone = (timezone: string, suffix: string) => buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch(`batch-${suffix}`, `project-${suffix}`, suffix.repeat(64)),
      document: document(),
      mappingRevision: 4,
      timezone,
    });

    const singapore = await buildForTimezone("Asia/Singapore", "s");
    const utc = await buildForTimezone("UTC", "u");

    expect(singapore.write.normalizedReadings[0]?.eventTime).toBe("2026-04-30T16:00:00.000Z");
    expect(utc.write.normalizedReadings[0]?.eventTime).toBe("2026-05-01T00:00:00.000Z");
    expect(singapore.write.intervalFacts[0]).toMatchObject({ localDate: "2026-05-01", localHour: 0 });
    expect(utc.write.intervalFacts[0]).toMatchObject({ localDate: "2026-05-01", localHour: 0 });
  });

  it("requires a confirmed Mapping", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
    ]).toBuffer();
    const unconfirmed = document();
    unconfirmed.meter_mapping!.confirmed = false;
    await expect(buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch(),
      document: unconfirmed,
      mappingRevision: 4,
      timezone: "Asia/Singapore",
    })).rejects.toThrow("ENERGYIQ_METER_MAPPING_NOT_CONFIRMED");
  });
});

describe("isEnergyImportMaterializationCurrent", () => {
  const materializeMeterA = async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(101)],
    ]).toBuffer();
    return await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch(),
      document: document(),
      mappingRevision: 4,
      timezone: "Asia/Singapore",
    });
  };

  const materialized = (summary: unknown): EnergyIqImportBatchRecord => ({
    ...batch(),
    status: "materialized",
    materialization_json: JSON.stringify(summary),
  });

  /** The mapping the batch was materialized under, as the rename left it behind. */
  const resolveOriginalMapping = () => (fingerprint: string) =>
    fingerprint === fingerprintEnergyIqMeterMapping(document().meter_mapping!)
      ? document().meter_mapping!
      : undefined;

  it("keeps a batch current when a meter is only renamed", async () => {
    const { summary } = await materializeMeterA();
    const renamed = document();
    renamed.meter_mapping!.rows[0]!.display_name = "Office Area Power";

    expect(fingerprintEnergyIqMeterMapping(renamed.meter_mapping!))
      .not.toBe(summary.mappingFingerprint);
    expect(isEnergyImportMaterializationCurrent({
      batch: materialized(summary),
      document: renamed,
      timezone: "Asia/Singapore",
    })).toBe(true);
  });

  it("keeps a batch stamped before the label-free fingerprint existed current across a rename", async () => {
    const { summary } = await materializeMeterA();
    const { mappingFingerprintExcludingDisplayNames: _dropped, ...legacy } = summary;
    const renamed = document();
    renamed.meter_mapping!.rows[0]!.display_name = "Office Area Power";

    expect(isEnergyImportMaterializationCurrent({
      batch: materialized(legacy),
      document: renamed,
      timezone: "Asia/Singapore",
    })).toBe(false);
    expect(isEnergyImportMaterializationCurrent({
      batch: materialized(legacy),
      document: renamed,
      timezone: "Asia/Singapore",
      resolveMappingByFingerprint: resolveOriginalMapping(),
    })).toBe(true);
  });

  it("re-materializes when the mapping changes how a reading is read", async () => {
    const { summary } = await materializeMeterA();
    const { mappingFingerprintExcludingDisplayNames: _dropped, ...legacy } = summary;
    const rescoped = document();
    rescoped.meter_mapping!.rows[0]!.display_name = "Office Area Power";
    rescoped.meter_mapping!.rows[0]!.category = "light";

    for (const candidate of [summary, legacy]) {
      expect(isEnergyImportMaterializationCurrent({
        batch: materialized(candidate),
        document: rescoped,
        timezone: "Asia/Singapore",
        resolveMappingByFingerprint: resolveOriginalMapping(),
      })).toBe(false);
    }
  });

  it("re-materializes a renamed interval matrix, whose columns are found by display name", async () => {
    const { summary } = await materializeMeterA();
    const renamed = document();
    renamed.meter_mapping!.rows[0]!.display_name = "Office Area Power";

    expect(isEnergyImportMaterializationCurrent({
      batch: materialized({
        ...summary,
        materializerContractVersion: "energy-excel-preschool-interval-matrix-v1",
      }),
      document: renamed,
      timezone: "Asia/Singapore",
      resolveMappingByFingerprint: resolveOriginalMapping(),
    })).toBe(false);
  });
});

const writeProjectFacts = async (
  writes: EnergyFactMaterializationBatchWrite[],
  dataSnapshotId: string,
  projectId: string,
) => {
  const first = writes[0];
  if (!first) throw new Error("TEST_PROJECT_MATERIALIZATION_EMPTY");
  const sourceSha256 = writes.map((write) => write.sourceSha256)
    .sort((left, right) => left.localeCompare(right));
  return writeEnergyFactProjectMaterialization({
    databasePath: ":memory:",
    projectId,
    timezone: "Asia/Singapore",
    expectedPreviousDataSnapshotId: "unavailable",
    snapshotFactScope: {
      workspaceId: "workspace-1",
      projectId,
      dataSnapshotId,
      manifestFingerprint: `fingerprint-${dataSnapshotId}`,
      sourceSha256,
      factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    },
    batches: writes.map((write) => ({
      importBatchId: write.importBatchId,
      sourceSha256: write.sourceSha256,
      rawReadings: write.rawReadings,
      normalizedReadings: write.normalizedReadings,
      intervalFacts: write.intervalFacts,
      qualityEvents: write.qualityEvents,
    })),
  });
};

const batch = (
  id = "batch-1",
  projectId = "project-1",
  sourceSha256 = "a".repeat(64),
): EnergyIqImportBatchRecord => ({
  id,
  workspace_id: "workspace-1",
  project_id: projectId,
  source_kind: "excel",
  source_sha256: sourceSha256,
  filename: "meter.xlsx",
  status: "inspected",
  inspection_json: "{}",
  created_by: "admin-1",
  created_at: "2026-05-01T00:00:00.000Z",
});

const document = (): EnergyIqProjectSetupDocument => ({
  project: { name: "Project", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "tier-1", ordinal: 1, alias: "Circuit" }],
  nodes: [{ id: "scope-a", tier_definition_id: "tier-1", name: "Circuit A", sort_order: 1, metadata_status: "confirmed" }],
  meter_mapping: {
    schema_version: 2,
    source_kind: "excel",
    confirmed: true,
    rows: [{
      id: "meter-a",
      source_label: "Meter A",
      scope_id: "scope-a",
      display_name: "Meter A",
      resource: "electricity",
      category: "load",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    }],
  },
});

const intervalMatrixDocument = (): EnergyIqProjectSetupDocument => ({
  project: { name: "Preschool", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [
    { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
    { id: "tier-centre", ordinal: 2, alias: "Centre" },
  ],
  nodes: [
    {
      id: "preschool-centre-a",
      tier_definition_id: "tier-centre",
      name: "Centre A",
      sort_order: 1,
      metadata_status: "confirmed",
      metadata: { centreCode: "A" },
    },
    {
      id: "preschool-centre-a-aircon-1",
      tier_definition_id: "tier-circuit",
      parent_id: "preschool-centre-a",
      name: "Aircon 1",
      sort_order: 1,
      metadata_status: "confirmed",
    },
  ],
  meter_mapping: {
    schema_version: 2,
    source_kind: "excel",
    confirmed: true,
    rows: [{
      id: "preschool-centre-a-aircon-1",
      source_label: "preschool-centre-a:Aircon 1",
      scope_id: "preschool-centre-a-aircon-1",
      display_name: "Aircon 1",
      resource: "electricity",
      category: "aircon",
      coverage: "partial",
      meter_role: "component",
      aggregation_usage: "official",
    }],
  },
});

const text = (value: string) => ({ type: String, value });
const number = (value: number) => ({ type: Number, value });
const date = (value: string) => ({ type: Date, value: new Date(value), format: "yyyy-mm-dd hh:mm" });

const hourlyUsage = (value: number) => Array.from({ length: 24 }, () => value);

const intervalMatrixWorkbook = async (dataRows: Array<Array<string | number>>) => writeXlsxFile([
  [
    text("Preschool Number"), text("Date"), text("Month"), text("Year"),
    text("Day of the Week"), text("Appliance"), text("Power Meter"),
    ...Array.from({ length: 24 }, (_, hour) => text(
      `${hour.toString().padStart(2, "0")}00-${(hour + 1).toString().padStart(2, "0")}00`,
    )),
  ],
  ...dataRows.map((row) => row.map((value) => typeof value === "number" ? number(value) : text(value))),
]).toBuffer();

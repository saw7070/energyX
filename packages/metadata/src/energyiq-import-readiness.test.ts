import { describe, expect, it } from "vitest";

import {
  fingerprintEnergyIqMeterMapping,
  createEnergyIqSourceManifest,
  resolveEnergyIqProjectDataReadiness,
  sourceLabelsAcrossEnergyIqImportBatches,
  type EnergyIqDataSnapshotRecord,
  type EnergyIqImportBatchRecord,
  type EnergyIqMeterMappingDraft,
  type EnergyIqProjectRecord,
  type EnergyIqProjectSetupDocument,
} from "./index.js";

describe("resolveEnergyIqProjectDataReadiness", () => {
  it("treats a pure structure publication without Mapping or imports as not requiring the data gate", () => {
    expect(resolveEnergyIqProjectDataReadiness({
      project: project("unavailable"),
      batches: [],
      document: document(),
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    })).toMatchObject({ status: "not_required", ready: true, requiresFormalData: false });
  });

  it("requires formal imports and Mapping when a project has an authoritative source manifest", () => {
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project("unavailable"),
      batches: [],
      document: { ...document(), source_manifest: createEnergyIqSourceManifest(FORMAL_SOURCE_SHAS, true) },
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness).toMatchObject({ status: "blocked", ready: false, requiresFormalData: true });
    expect(readiness.blockingReasons).toEqual(expect.arrayContaining([
      "IMPORT_BATCH_REQUIRED",
      "METER_MAPPING_REQUIRED",
      "SOURCE_MANIFEST_MISMATCH",
      "DATA_SNAPSHOT_REQUIRED",
    ]));
  });

  it("blocks registered data batches until their exact Source Manifest is pinned and confirmed", () => {
    const batches = [batch("batch-a", FORMAL_SOURCE_SHAS[0], NGEE_ANN_LABELS.slice(0, 9))];
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project("unavailable"),
      batches,
      document: { ...document(), meter_mapping: meterMapping() },
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness.blockingReasons).toContain("SOURCE_MANIFEST_REQUIRED");
  });

  it("requires the union of all source labels and one current composite snapshot", () => {
    const mapping = meterMapping();
    const batches = [
      batch("batch-l6-new", FORMAL_SOURCE_SHAS[0], NGEE_ANN_LABELS.slice(0, 9)),
      batch("batch-l6-old", FORMAL_SOURCE_SHAS[1], NGEE_ANN_LABELS.slice(0, 9)),
      batch("batch-l7-new", FORMAL_SOURCE_SHAS[2], NGEE_ANN_LABELS.slice(9)),
      batch("batch-l7-old", FORMAL_SOURCE_SHAS[3], NGEE_ANN_LABELS.slice(9)),
    ];
    const snapshot = dataSnapshot(batches);
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches,
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest(FORMAL_SOURCE_SHAS, true),
        meter_mapping: mapping,
      },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(sourceLabelsAcrossEnergyIqImportBatches(batches)).toHaveLength(18);
    expect(readiness).toMatchObject({
      status: "ready",
      ready: true,
      importBatchCount: 4,
      activeImportBatchCount: 4,
      materializedBatchCount: 4,
      activeMaterializedBatchCount: 4,
      sourceLabelCount: 18,
      mappedSourceLabelCount: 18,
      blockingReasons: [],
    });
    expect(readiness.warnings).toEqual(["RAW_OVERLAP_CONFLICTS_RESOLVED_BY_LATER_COVERAGE:32"]);
  });

  it("gates only active manifest batches while retaining extra registered batches as evidence", () => {
    const active = batch("batch-a", FORMAL_SOURCE_SHAS[0], NGEE_ANN_LABELS);
    const retained = batch("batch-b", FORMAL_SOURCE_SHAS[1], NGEE_ANN_LABELS);
    const snapshot = dataSnapshot([active]);
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches: [active, retained],
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest([FORMAL_SOURCE_SHAS[0]], true),
        meter_mapping: meterMapping(),
      },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness).toMatchObject({
      status: "ready",
      ready: true,
      importBatchCount: 2,
      activeImportBatchCount: 1,
      materializedBatchCount: 2,
      activeMaterializedBatchCount: 1,
      blockingReasons: [],
    });
  });

  it("accepts a current direct interval-usage materializer without requiring cumulative readings", () => {
    const sourceSha = FORMAL_SOURCE_SHAS[0];
    const cumulative = batch("batch-interval", sourceSha, NGEE_ANN_LABELS);
    const intervalBatch: EnergyIqImportBatchRecord = {
      ...cumulative,
      materialization_json: JSON.stringify({
        ...JSON.parse(cumulative.materialization_json!),
        materializerContractVersion: "energy-excel-preschool-interval-matrix-v1",
      }),
    };
    const snapshot = dataSnapshot([intervalBatch], {
      normalizedReadingCount: 0,
      canonicalMeterSeriesCount: 0,
      adjacentReadingPairCount: 0,
    });

    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches: [intervalBatch],
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest([sourceSha], true),
        meter_mapping: meterMapping(),
      },
      snapshot,
      expectedMaterializerContractVersion: [
        "energy-excel-cumulative-v1",
        "energy-excel-preschool-interval-matrix-v1",
      ],
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness).toMatchObject({ status: "ready", ready: true, blockingReasons: [] });
  });

  it("accepts Tuya event readings after preprocessing them into aligned interval facts", () => {
    const sourceSha = FORMAL_SOURCE_SHAS[0];
    const mapping: EnergyIqMeterMappingDraft = {
      ...meterMapping(),
      source_kind: "tuya",
    };
    const baseBatch = batch("batch-tuya", sourceSha, NGEE_ANN_LABELS);
    const tuyaBatch: EnergyIqImportBatchRecord = {
      ...baseBatch,
      source_kind: "tuya",
      materialization_json: JSON.stringify({
        ...JSON.parse(baseBatch.materialization_json!),
        mappingFingerprint: fingerprintEnergyIqMeterMapping(mapping),
        materializerContractVersion: "energy-tuya-event-resampled-15m-v2",
      }),
    };
    const snapshot = dataSnapshot([tuyaBatch], { invalidIntervalDurationCount: 0 });

    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches: [tuyaBatch],
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest([sourceSha], true),
        meter_mapping: mapping,
      },
      snapshot,
      expectedMaterializerContractVersion: [
        "energy-excel-cumulative-v1",
        "energy-tuya-event-resampled-15m-v2",
      ],
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness).toMatchObject({
      status: "ready",
      ready: true,
      blockingReasons: [],
      warnings: expect.arrayContaining(["RAW_OVERLAP_CONFLICTS_RESOLVED_BY_LATER_COVERAGE:32"]),
    });
  });

  it("blocks stale Mapping materialization, incomplete batches, inactive rows and legacy canonical facts", () => {
    const mapping = meterMapping();
    const batches = [
      batch("batch-l6", "sha-l6", NGEE_ANN_LABELS.slice(0, 9), "inspected"),
      batch("batch-l7", "sha-l7", NGEE_ANN_LABELS.slice(9), "materialized", "stale-fingerprint"),
    ];
    mapping.rows.push({ ...mapping.rows[0]!, id: "inactive", source_label: "Inactive meter" });
    const snapshot = dataSnapshot(batches.filter((candidate) => candidate.status === "materialized"), {
      legacyCanonicalRowCount: 10,
    });
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches,
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest(["sha-l6", "sha-l7", "sha-missing"], true),
        meter_mapping: mapping,
      },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockingReasons).toEqual(expect.arrayContaining([
      "IMPORT_BATCH_NOT_MATERIALIZED",
      "SOURCE_MANIFEST_MISMATCH",
      "MAPPING_SOURCE_INACTIVE",
      "SNAPSHOT_MAPPING_MISMATCH",
      "LEGACY_CANONICAL_ROWS",
    ]));
  });

  it("fails closed for a damaged, incomplete or empty snapshot audit", () => {
    const mapping = meterMapping();
    const batches = FORMAL_SOURCE_SHAS.map((sha, index) => batch(
      `batch-${index}`,
      sha,
      index < 2 ? NGEE_ANN_LABELS.slice(0, 9) : NGEE_ANN_LABELS.slice(9),
    ));
    const base = dataSnapshot(batches);
    const resolve = (snapshot: EnergyIqDataSnapshotRecord) => resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches,
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest(FORMAL_SOURCE_SHAS, true),
        meter_mapping: mapping,
      },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(resolve({ ...base, audit_json: "{" }).blockingReasons).toContain("SNAPSHOT_AUDIT_INVALID");
    expect(resolve({ ...base, audit_json: JSON.stringify({ rawRowCount: -1 }) }).blockingReasons)
      .toContain("SNAPSHOT_AUDIT_INVALID");
    expect(resolve(dataSnapshot(batches, { intervalFactCount: 0 })).blockingReasons)
      .toContain("INTERVAL_FACTS_EMPTY");
    expect(resolve(dataSnapshot(batches, { rawRowCount: 0 })).blockingReasons)
      .toContain("FACT_STORE_EMPTY");
    expect(resolve(dataSnapshot(batches, { negativeDeltaIntervalCount: 1 })).blockingReasons)
      .toContain("NEGATIVE_INTERVAL_DELTAS");
    expect(resolve(dataSnapshot(batches, { missingAdjacentIntervalCount: 1 })).blockingReasons)
      .toContain("MISSING_ADJACENT_INTERVAL_FACTS");
    expect(resolve(dataSnapshot(batches, { orphanIntervalFactCount: 1 })).blockingReasons)
      .toContain("ORPHAN_INTERVAL_FACTS");
  });

  it("uses the draft timezone and requires the exact Ngee Ann source manifest", () => {
    const mapping = meterMapping();
    const batches = FORMAL_SOURCE_SHAS.map((sha, index) => batch(
      `batch-${index}`,
      sha,
      index < 2 ? NGEE_ANN_LABELS.slice(0, 9) : NGEE_ANN_LABELS.slice(9),
    ));
    const snapshot = dataSnapshot(batches);
    const changedTimezoneDocument = {
      ...document(),
      project: { ...document().project, timezone: "UTC" },
      source_manifest: createEnergyIqSourceManifest(FORMAL_SOURCE_SHAS, true),
      meter_mapping: mapping,
    };
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: { ...project(snapshot.id), timezone: "Asia/Singapore" },
      batches,
      document: changedTimezoneDocument,
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness.blockingReasons).toContain("SNAPSHOT_TIMEZONE_MISMATCH");
    const extra = batch("unexpected", "f".repeat(64), NGEE_ANN_LABELS.slice(0, 9));
    expect(resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches: [...batches, extra],
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest(FORMAL_SOURCE_SHAS, true),
        meter_mapping: mapping,
      },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    }).blockingReasons).not.toContain("SOURCE_MANIFEST_MISMATCH");
  });

  it("keeps a Snapshot ready while disclosing bounded cumulative cadence gaps", () => {
    const batches = FORMAL_SOURCE_SHAS.map((sha, index) => batch(
      `batch-${index}`,
      sha,
      index < 2 ? NGEE_ANN_LABELS.slice(0, 9) : NGEE_ANN_LABELS.slice(9),
    ));
    const snapshot = dataSnapshot(batches, { cadenceGapIntervalCount: 21 });

    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches,
      document: {
        ...document(),
        source_manifest: createEnergyIqSourceManifest(FORMAL_SOURCE_SHAS, true),
        meter_mapping: meterMapping(),
      },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
      expectedFactWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    });

    expect(readiness).toMatchObject({ status: "ready", ready: true, blockingReasons: [] });
    expect(readiness.warnings).toEqual(expect.arrayContaining(["CADENCE_GAPS:21"]));
  });
});

const document = (): EnergyIqProjectSetupDocument => ({
  project: { name: "Ngee Ann Polytechnic", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
  nodes: [{ id: "level-6", tier_definition_id: "circuit", name: "Level 6", sort_order: 1, metadata_status: "confirmed" }],
});

const meterMapping = (): EnergyIqMeterMappingDraft => ({
  schema_version: 2,
  source_kind: "excel",
  confirmed: true,
  rows: NGEE_ANN_LABELS.map((label, index) => ({
    id: `meter-${index + 1}`,
    source_label: label,
    scope_id: "level-6",
    display_name: label,
    resource: "electricity",
    category: label.toLowerCase().includes("light") ? "light" : "load",
    coverage: "whole",
    meter_role: label.includes("Total") ? "total" : "component",
    aggregation_usage: label.includes("Total") ? "official" : "excluded",
  })),
});

const batch = (
  id: string,
  sha: string,
  labels: string[],
  status: EnergyIqImportBatchRecord["status"] = "materialized",
  mappingFingerprint = fingerprintEnergyIqMeterMapping(meterMapping()),
): EnergyIqImportBatchRecord => ({
  id,
  workspace_id: "default",
  project_id: "ngee-ann-polytechnic",
  source_kind: "excel",
  source_sha256: sha,
  filename: `${id}.xlsx`,
  status,
  inspection_json: JSON.stringify({
    sheetName: "Sheet1",
    sourceLabels: labels.map((label) => ({ label, rowCount: 2_880 })),
    coverageFrom: "2026-04-21T00:00:00.000Z",
    coverageTo: "2026-06-17T23:45:00.000Z",
  }),
  ...(status === "materialized" ? {
    materialization_json: JSON.stringify({
      mappingFingerprint,
      mappingRevision: 4,
      timezone: "Asia/Singapore",
      materializerContractVersion: "energy-excel-cumulative-v1",
      factWriterContractVersion: "energy-fact-writer-project-canonical-v2",
    }),
    materialized_at: "2026-08-04T00:00:00.000Z",
  } : {}),
  created_by: "dev-user",
  created_at: "2026-08-04T00:00:00.000Z",
});

const dataSnapshot = (
  batches: EnergyIqImportBatchRecord[],
  auditOverrides: Record<string, number> = {},
): EnergyIqDataSnapshotRecord => ({
  id: "energy-snapshot-test",
  workspace_id: "default",
  project_id: "ngee-ann-polytechnic",
  manifest_json: JSON.stringify({
    version: 1,
    projectId: "ngee-ann-polytechnic",
    batches: batches.map((candidate) => ({ sourceSha256: candidate.source_sha256 })),
  }),
  audit_json: JSON.stringify({
    rawRowCount: 103_678,
    invalidRawRowCount: 0,
    unmappedRawRowCount: 0,
    rawOverlapConflictCount: 32,
    normalizedReadingCount: 100_223,
    intervalFactCount: 100_205,
    duplicateNormalizedReadingCount: 0,
    duplicateIntervalFactCount: 0,
    invalidIntervalDurationCount: 0,
    cadenceGapIntervalCount: 0,
    negativeDeltaIntervalCount: 0,
    legacyRawRowCount: 0,
    legacyNormalizedReadingCount: 0,
    legacyIntervalFactCount: 0,
    legacyCanonicalRowCount: 0,
    canonicalMeterSeriesCount: 18,
    adjacentReadingPairCount: 100_205,
    missingAdjacentIntervalCount: 0,
    orphanIntervalFactCount: 0,
    ...auditOverrides,
  }),
  created_at: "2026-08-04T00:00:00.000Z",
});

const project = (dataSnapshotId: string): EnergyIqProjectRecord => ({
  id: "ngee-ann-polytechnic",
  workspace_id: "default",
  name: "Ngee Ann Polytechnic",
  status: "published",
  timezone: "Asia/Singapore",
  hierarchy_revision_id: "hierarchy-v1",
  meter_formula_revision_id: "formula-v1",
  data_snapshot_id: dataSnapshotId,
  metric_version: "metric-v1",
  business_calendar_version: "calendar-v1",
  tariff_schedule_version: "tariff-v1",
  delivery_stage: "published",
  root_scope_id: "project",
  has_unpublished_changes: false,
  created_at: "2026-08-04T00:00:00.000Z",
  updated_at: "2026-08-04T00:00:00.000Z",
});

const FORMAL_SOURCE_SHAS = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)] as const;

const NGEE_ANN_LABELS = [
  "Lvl 6 Total Office Light",
  "Lvl 6 Office Light-Left: External",
  "Lvl 6 Office Light-Right: Internal",
  "Lvl 6 Total Office Load",
  "Lvl 6 Office Load 1: L1P1-L3P6",
  "Lvl 6 Office Load 2: L1P7-L3P12",
  "Lvl 6 Office Load 3: L1P13-L3P18",
  "Lvl 6 Office Load 4: L1P19-L3P24",
  "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2",
  "Lvl 7 Middle Row Office Light",
  "Lvl 7 Back Row Office Light",
  "Lvl 7 Front Row Office Light",
  "Lvl 7 Total Office Light",
  "Lvl 7 Total Office Load",
  "Lvl 7 Office Load 1: L1P1-L3P6",
  "Lvl 7 Office Load 2: L1P7-L3P15",
  "Lvl 7 Office Load 3: L1P16-L3P21",
  "Lvl 7 Office Load 4: L1P22-L3P25 Fan ISOL1/2",
];

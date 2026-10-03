import { describe, expect, it } from "vitest";

import type { EnergyIqImportBatchRecord, EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import {
  buildEnergyTuyaMaterialization,
  isEnergyImportMaterializationCurrent,
} from "./energy-import-materializer.js";
import { inspectEnergyTuyaArtifact } from "./energy-tuya-import.js";
import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  TUYA_SINGAPORE_ENDPOINT,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";

describe("Tuya cumulative energy import", () => {
  it("imports a three-phase meter's forward_energy_total readings", () => {
    const artifact = JSON.parse(artifactContent().toString("utf8")) as TuyaReportLogArtifact;
    artifact.request.codes = ["forward_energy_total"];
    artifact.devices[0]!.properties = {
      totalForwardEnergy: { code: "forward_energy_total", scale: 2, unit: "kW·h" },
      phaseCodes: ["phase_a", "phase_b", "phase_c"],
    };
    artifact.devices[0]!.logs = [
      { code: "forward_energy_total", eventTime: 1_710_000_000_000, value: 83036 },
      { code: "forward_energy_total", eventTime: 1_710_000_900_000, value: 83046 },
    ];
    expect(inspectEnergyTuyaArtifact(Buffer.from(JSON.stringify(artifact)))).toMatchObject({
      sourceLabels: [{ label: "DB1 L1 Power", rowCount: 2 }],
      validRowCount: 2,
      qualityStatus: "ready",
    });
  });

  it("scales raw Tuya energy, ignores instantaneous power for canonical usage, and uses adjacent deltas", async () => {
    const content = artifactContent();
    expect(inspectEnergyTuyaArtifact(content)).toMatchObject({
      readingKind: "cumulative",
      sourceLabels: [{ label: "DB1 L1 Power", rowCount: 2 }],
      rowCount: 2,
      typicalIntervalMinutes: 15,
      coverageFrom: "2024-03-09T16:00:00.000Z",
      coverageTo: "2024-03-09T16:15:00.000Z",
    });

    const result = await buildEnergyTuyaMaterialization({
      content,
      batch: batch(),
      document: document(),
      mappingRevision: 3,
      timezone: "Asia/Singapore",
    });

    expect(result.write.rawReadings).toHaveLength(2);
    expect(result.write.normalizedReadings.map((reading) => reading.activeEnergyKwh)).toEqual([830.36, 830.46]);
    expect(result.write.intervalFacts).toEqual([
      expect.objectContaining({
        intervalStart: "2024-03-09T16:00:00.000Z",
        intervalEnd: "2024-03-09T16:15:00.000Z",
        usageKwh: expect.closeTo(0.1, 8),
        averageKw: expect.closeTo(0.4, 8),
        sourceReadingKind: "interval_usage",
        qualityStatus: "ok",
      }),
    ]);
    expect(result.write.normalizedReadings).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReadingKind: "cumulative_energy_event" }),
    ]));
    expect(result.write.qualityEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "tuya_event_readings_resampled",
        sourceReadingKind: "cumulative_energy_event",
      }),
    ]));
    expect(result.summary).toMatchObject({
      materializerContractVersion: "energy-tuya-event-resampled-15m-v2",
      intervalFactCount: 1,
      sourceSheetName: "Tuya report-logs",
    });
    expect(isEnergyImportMaterializationCurrent({
      batch: { ...batch(), status: "materialized", materialization_json: JSON.stringify(result.summary) },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(true);
  });

  it("interpolates non-aligned event readings into fully covered 15-minute facts", async () => {
    const artifact = JSON.parse(artifactContent().toString("utf8")) as TuyaReportLogArtifact;
    artifact.devices[0]!.logs = [
      { code: "total_forward_energy", eventTime: Date.parse("2024-03-09T16:05:00.000Z"), value: 10_000 },
      { code: "total_forward_energy", eventTime: Date.parse("2024-03-09T16:20:00.000Z"), value: 10_030 },
      { code: "total_forward_energy", eventTime: Date.parse("2024-03-09T16:35:00.000Z"), value: 10_090 },
    ];

    const result = await buildEnergyTuyaMaterialization({
      content: Buffer.from(JSON.stringify(artifact)),
      batch: batch(),
      document: document(),
      mappingRevision: 3,
      timezone: "Asia/Singapore",
    });

    expect(result.write.intervalFacts).toEqual([
      expect.objectContaining({
        intervalStart: "2024-03-09T16:15:00.000Z",
        intervalEnd: "2024-03-09T16:30:00.000Z",
        elapsedMinutes: 15,
        previousActiveEnergyKwh: expect.closeTo(100.2, 8),
        activeEnergyKwh: expect.closeTo(100.7, 8),
        usageKwh: expect.closeTo(0.5, 8),
        averageKw: expect.closeTo(2, 8),
        sourceReadingKind: "interval_usage",
        qualityStatus: "ok",
      }),
    ]);
    expect(result.summary).toMatchObject({ intervalFactCount: 1, totalUsageKwh: 0.5 });
  });
});

const artifactContent = (): Buffer => Buffer.from(JSON.stringify({
  schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
  provider: "tuya",
  region: "sg",
  endpoint: TUYA_SINGAPORE_ENDPOINT,
  createdAt: "2024-03-09T16:20:00.000Z",
  request: {
    startTime: 1_710_000_000_000,
    endTime: 1_710_001_000_000,
    codes: ["cur_power", "total_forward_energy"],
    deviceCount: 1,
  },
  devices: [{
    sourceLabel: "DB1 L1 Power",
    properties: {
      totalForwardEnergy: { code: "total_forward_energy", scale: 2, unit: "kw.h" },
      currentPower: { code: "cur_power", scale: 3, unit: "kW" },
    },
    logs: [
      { code: "total_forward_energy", eventTime: 1_710_000_000_000, value: 83036 },
      { code: "cur_power", eventTime: 1_710_000_000_000, value: 332 },
      { code: "total_forward_energy", eventTime: 1_710_000_900_000, value: 83046 },
    ],
  }],
} satisfies TuyaReportLogArtifact));

const batch = (): EnergyIqImportBatchRecord => ({
  id: "tuya-batch",
  workspace_id: "workspace-1",
  project_id: "project-1",
  source_kind: "tuya",
  source_sha256: "a".repeat(64),
  filename: "tuya.json",
  file_asset_ref_id: "ref-1",
  status: "inspected",
  inspection_json: "{}",
  created_by: "dev-user",
  created_at: "2024-03-09T16:20:00.000Z",
});

const document = (): EnergyIqProjectSetupDocument => ({
  project: { name: "Project", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "tier-db", ordinal: 1, alias: "Distribution Board" }],
  nodes: [{
    id: "db1",
    tier_definition_id: "tier-db",
    name: "DB1",
    sort_order: 1,
    metadata_status: "confirmed",
  }],
  meter_mapping: {
    schema_version: 2,
    source_kind: "tuya",
    confirmed: true,
    rows: [{
      id: "db1-l1-power",
      source_label: "DB1 L1 Power",
      scope_id: "db1",
      navigation_scope_id: "db1",
      display_name: "DB1 L1 Power",
      resource: "electricity",
      category: "load",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    }],
    official_aggregation_routes: [
      { scope_id: "db1", resource: "electricity", category: "load", meter_point_ids: ["db1-l1-power"] },
      { scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["db1-l1-power"] },
    ],
  },
});

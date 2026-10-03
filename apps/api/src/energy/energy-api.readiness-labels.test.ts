import { describe, expect, it } from "vitest";
import { ENERGY_FACT_WRITER_CONTRACT_VERSION } from "@datafoundry/data-gateway";
import { fingerprintEnergyIqMeterMapping, type EnergyIqImportBatchRecord, type EnergyIqProjectSetupDocument, type resolveEnergyIqProjectDataReadiness } from "@datafoundry/metadata";
import { withLabelOnlyMappingChangesAccepted } from "./energy-api.js";
import { ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION } from "./energy-import-materializer.js";

type Readiness = ReturnType<typeof resolveEnergyIqProjectDataReadiness>;
type Mapping = NonNullable<EnergyIqProjectSetupDocument["meter_mapping"]>;

const mapping = (displayName: string, category = "load"): Mapping => ({
  schema_version: 2, source_kind: "tuya", confirmed: true,
  rows: [{ id: "meter-a", source_label: "Meter A", scope_id: "space", navigation_scope_id: "space", display_name: displayName, resource: "electricity", category, coverage: "whole", meter_role: "total", aggregation_usage: "official" }],
  official_aggregation_routes: [{ scope_id: "project", resource: "electricity", category, meter_point_ids: ["meter-a"] }],
} as unknown as Mapping);
const documentWith = (meterMapping: Mapping) => ({
  project: { name: "Tuya Office", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [], meter_mapping: meterMapping,
} as unknown as EnergyIqProjectSetupDocument);
const batch = (id: string, materializedUnder: Mapping): EnergyIqImportBatchRecord => ({
  id, workspace_id: "tuya-office", project_id: "tuya-office", source_kind: "tuya", source_sha256: id.padEnd(64, "0"), filename: `${id}.json`, status: "materialized",
  inspection_json: "{}", created_by: "dev-user", created_at: "2026-09-01T00:00:00.000Z",
  materialization_json: JSON.stringify({ mappingFingerprint: fingerprintEnergyIqMeterMapping(materializedUnder), timezone: "Asia/Singapore", materializerContractVersion: ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION, factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION }),
});
const blocked = (reasons: string[]): Readiness => ({ status: "blocked", ready: false, requiresFormalData: true, blockingReasons: reasons, warnings: [] } as unknown as Readiness);
// What the project's published revisions held, which is how a batch's old fingerprint is traced back to its mapping.
const context = (published: Mapping[]) => ({
  metadataStore: { energyIq: { projectSetup: { listHierarchyRevisions: () => published.map((meterMapping, index) => ({ id: `v${index + 1}`, snapshot_json: JSON.stringify(documentWith(meterMapping)) })) } } },
} as unknown as Parameters<typeof withLabelOnlyMappingChangesAccepted>[0]);

describe("readiness after a meter is renamed", () => {
  it("does not block going live when batches were read before and after a rename only", () => {
    const before = mapping("Office light"), after = mapping("Office Area Light");
    const result = withLabelOnlyMappingChangesAccepted(context([before, after]), "tuya-office", blocked(["SNAPSHOT_MAPPING_MISMATCH"]),
      [batch("old", before), batch("new", after)], documentWith(after));
    expect(result).toMatchObject({ ready: true, status: "ready", blockingReasons: [] });
  });

  it("still blocks when something that decides readings changed, and keeps every other reason", () => {
    const before = mapping("Office light", "light"), after = mapping("Office light", "load");
    const changed = withLabelOnlyMappingChangesAccepted(context([before, after]), "tuya-office", blocked(["SNAPSHOT_MAPPING_MISMATCH"]),
      [batch("old", before), batch("new", after)], documentWith(after));
    expect(changed).toMatchObject({ ready: false, blockingReasons: ["SNAPSHOT_MAPPING_MISMATCH"] });

    const renamed = mapping("Office Area Light");
    const other = withLabelOnlyMappingChangesAccepted(context([mapping("Office light"), renamed]), "tuya-office", blocked(["SNAPSHOT_MAPPING_MISMATCH", "IMPORT_BATCH_NOT_MATERIALIZED"]),
      [batch("old", mapping("Office light")), batch("new", renamed)], documentWith(renamed));
    expect(other).toMatchObject({ ready: false, status: "blocked", blockingReasons: ["IMPORT_BATCH_NOT_MATERIALIZED"] });
  });
});

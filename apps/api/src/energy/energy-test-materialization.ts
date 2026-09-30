import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
} from "@datafoundry/data-gateway";
import {
  fingerprintEnergyIqMeterMapping,
  type EnergyIqDataSnapshotRecord,
  type MetadataStore,
} from "@datafoundry/metadata";

import { ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION } from "./energy-import-materializer.js";

export const materializeTestProjectSnapshot = async (input: {
  metadataStore: MetadataStore;
  databasePath: string;
  workspaceId: string;
  projectId: string;
  timezone: string;
  batches: EnergyFactMaterializationBatchWrite[];
}): Promise<EnergyIqDataSnapshotRecord> => {
  const draft = input.metadataStore.energyIq.projectSetup.getDraft({
    project_id: input.projectId,
    user_id: "dev-user",
  });
  const mappingFingerprint = draft.document.meter_mapping
    ? fingerprintEnergyIqMeterMapping(draft.document.meter_mapping)
    : "test-mapping-unavailable";
  for (const batch of input.batches) {
    if (!input.metadataStore.energyIq.findImportBatchBySha({
      project_id: input.projectId,
      source_sha256: batch.sourceSha256,
    })) {
      const sourceLabels = [...new Set([
        ...batch.rawReadings.map((row) => row.sourceLabel),
        ...batch.normalizedReadings.map((row) => row.sourceLabel),
        ...batch.intervalFacts.map((row) => row.sourceLabel),
      ])].sort((left, right) => left.localeCompare(right));
      input.metadataStore.energyIq.createImportBatch({
        id: batch.importBatchId,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        source_kind: "excel",
        source_sha256: batch.sourceSha256,
        filename: `${batch.importBatchId}.fixture.xlsx`,
        status: "inspected",
        inspection: { sourceLabels: sourceLabels.map((label) => ({ label, rowCount: 1 })) },
        created_by: "dev-user",
      });
    }
  }
  const materializations = input.batches.map((batch) => ({
    batch_id: batch.importBatchId,
    summary: {
      rawRowCount: batch.rawReadings.length,
      normalizedReadingCount: batch.normalizedReadings.length,
      intervalFactCount: batch.intervalFacts.length,
      totalUsageKwh: batch.intervalFacts.reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0),
      qualityCounts: {},
      mappingRevision: draft.revision,
      mappingFingerprint,
      timezone: input.timezone,
      materializerContractVersion: ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
      factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
      sourceSheetName: "Fixture",
      sourceRowCount: batch.rawReadings.length,
      sourceLabels: [...new Set(batch.intervalFacts.map((fact) => fact.sourceLabel))],
    },
  }));
  const sourceManifestSha256 = input.batches.map((batch) => batch.sourceSha256);
  const prepared = input.metadataStore.energyIq.prepareProjectManifestMaterialization({
    project_id: input.projectId,
    materializations,
    source_manifest_sha256: sourceManifestSha256,
  });
  const persisted = await writeEnergyFactProjectMaterialization({
    databasePath: input.databasePath,
    projectId: input.projectId,
    timezone: input.timezone,
    expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
    snapshotFactScope: prepared.fact_scope,
    batches: input.batches,
  });
  return input.metadataStore.energyIq.completeProjectManifestMaterialization({
    project_id: input.projectId,
    materializations,
    project_audit: persisted.projectAudit,
    source_manifest_sha256: sourceManifestSha256,
    expected_snapshot_id: prepared.expected_snapshot_id,
    expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
  }).snapshot;
};

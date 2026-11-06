import { configApi } from "../../../lib/config-api";
import {
  evaluateEnergyImportMaterializationGuard,
  pinEnergySourceManifest,
  sourceLabelsAcrossImportBatches,
} from "./project-setup-model";
import { buildSmartSetup, type DeviceListEntry, type SmartSetupNames } from "./smart-setup";

/**
 * Set up and publish every readings file the project has: one board, one location and one meter per device, then
 * the readings. The same steps as Upload data → Set up & publish, for flows that add the file themselves (such as
 * starting a site from Tuya). `devices` names meters after what they power; `areas` (label → block or area) groups
 * them into one location per area. Returns how many meters the published setup has.
 */
export async function setUpAndPublishReadings(
  projectId: string,
  names?: SmartSetupNames,
  options: { devices?: DeviceListEntry[]; areas?: Record<string, string> } = {},
): Promise<number> {
  const [setup, imports] = await Promise.all([
    configApi.getEnergyProjectSetup(projectId),
    configApi.listEnergyImportBatches(projectId),
  ]);
  const uploads = imports.batches.filter((batch) => batch.sourceKind === "excel");
  if (uploads.length === 0) throw new Error("ENERGYIQ_IMPORT_REQUIRED");
  const plan = buildSmartSetup({
    document: setup.draft.document,
    projectId,
    labels: sourceLabelsAcrossImportBatches(uploads),
    devices: options.devices ?? [],
    ...(names ? { names } : {}),
    ...(options.areas ? { areas: options.areas } : {}),
  });
  if (plan.unplacedLabels.length > 0) throw new Error(`ENERGYIQ_IMPORT_UNPLACED:${plan.unplacedLabels.join(", ")}`);
  const sourceManifest = await pinEnergySourceManifest(uploads);
  const saved = await configApi.saveEnergyProjectSetupDraft(projectId, {
    expectedRevision: setup.draft.revision,
    document: { ...plan.document, source_manifest: sourceManifest },
  });
  const guard = evaluateEnergyImportMaterializationGuard({ document: saved.draft.document, savedDocument: saved.draft.document, batches: uploads });
  if (!guard.ready) throw new Error(`ENERGYIQ_IMPORT_NOT_READY:${guard.reasons.join(", ")}`);
  for (const batch of [...uploads].reverse()) await configApi.materializeEnergyImportBatch(projectId, batch.id);
  await configApi.applyEnergyProjectChanges(projectId);
  return plan.rows.length;
}

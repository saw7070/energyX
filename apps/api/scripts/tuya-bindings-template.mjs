/**
 * Prints the ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON skeleton for a project, one line per meter,
 * so the Tuya device id can be pasted beside the meter it belongs to.
 *
 *   node apps/api/scripts/tuya-bindings-template.mjs tuya-office [path/to/metadata.sqlite]
 *
 * The connector requires the keys to match the published mapping exactly, so this reads the
 * published revision rather than the draft. It never reads or prints credentials.
 */
import { DatabaseSync } from "node:sqlite";

const [projectId, databasePath = "storage/metadata/workbench.sqlite"] = process.argv.slice(2);
if (!projectId) {
  console.error("Usage: node apps/api/scripts/tuya-bindings-template.mjs <projectId> [metadata.sqlite]");
  process.exit(1);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
const project = db.prepare("SELECT id, workspace_id, hierarchy_revision_id FROM energyiq_projects WHERE id = ?").get(projectId);
if (!project) throw new Error(`No project ${projectId} in ${databasePath}`);
if (!project.hierarchy_revision_id) throw new Error(`${projectId} has no published setup yet — apply the setup first.`);

const revision = db.prepare("SELECT snapshot_json FROM energyiq_hierarchy_revisions WHERE id = ?").get(project.hierarchy_revision_id);
const mapping = JSON.parse(revision.snapshot_json).meter_mapping ?? {};
if (mapping.source_kind !== "tuya") throw new Error(`Published mapping is "${mapping.source_kind}", not tuya.`);
if (!mapping.confirmed) throw new Error("Published mapping is not confirmed — confirm the meter totals first.");

const rows = mapping.rows ?? [];
console.log(`# ${projectId}: ${rows.length} meters, workspace ${project.workspace_id}, published revision ${project.hierarchy_revision_id}`);
console.log(`ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID=${project.id}`);
console.log(`ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID=${project.workspace_id}`);
console.log("#");
console.log("# Put each device id from the Tuya IoT console beside the meter it measures, then");
console.log("# paste the whole map on one line as ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON.");
for (const row of rows) {
  const name = row.presentation?.device_name ?? row.display_name ?? row.id;
  console.log(`#   ${row.id.padEnd(20)} ${name}`);
}
console.log(`ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON=${JSON.stringify(Object.fromEntries(rows.map(row => [row.id, "PASTE_DEVICE_ID"])))}`);

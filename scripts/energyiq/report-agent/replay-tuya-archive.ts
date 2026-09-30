// Run with: npx tsx --tsconfig scripts/energyiq/report-agent/tsconfig.json scripts/energyiq/report-agent/replay-tuya-archive.ts --source <archive.duckdb>
// Dry-run is the default: reads archive only. --apply requires existing metadata/files paths,
// --user, --api-url, and ENERGYIQ_REPLAY_COOKIE or ENERGYIQ_REPLAY_AUTHORIZATION.
import { replayTuyaAuthHeaders } from "../../../apps/api/src/report-agent/replay-tuya-auth.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createMetadataStore } from "@datafoundry/metadata";
import { LocalFileAssetService } from "@datafoundry/files";
import { buildTuyaOfficeSetup } from "../../../apps/api/src/energy/tuya-office-project.js";
import { readTuyaArchive, buildTuyaArchiveReplay, registerTuyaArchiveReplay } from "../../../apps/api/src/energy/energy-tuya-archive-replay.js";
import { authorizeReportProject } from "../../../apps/api/src/report-agent/report-inputs.js";
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(`--${name}`); const value = args[index + 1]; if (index < 0 || !value || value.startsWith("--")) throw Error(`ARGUMENT_REQUIRED:${name}`); return value; };
const source = resolve(arg("source"));
const archive = await readTuyaArchive(source);
const artifacts = buildTuyaArchiveReplay(archive.rows, archive.archiveSha256, buildTuyaOfficeSetup());
console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", archiveSha256: archive.archiveSha256, originalRows: archive.rows.length, batches: artifacts.length, ...archive.coverage, note: "The measured archive cutoff is shown above. Newer report attachments do not extend this project snapshot." }, null, 2));
if (args.includes("--apply")) {
  const databasePath = resolve(arg("metadata")); const fileRoot = resolve(arg("file-root")); const userId = arg("user");
  const api = new URL(arg("api-url"));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(api.hostname) || !existsSync(databasePath) || !existsSync(fileRoot)) throw Error("REPLAY_EXISTING_LOCAL_TARGET_REQUIRED");
  const authHeaders = replayTuyaAuthHeaders(process.env);
  const metadata = createMetadataStore({ database_path: databasePath });
  let registered: ReturnType<typeof registerTuyaArchiveReplay>;
  try {
    const project = metadata.energyIq.getProject("tuya-office");
    authorizeReportProject(metadata, userId, project.workspace_id, project.id);
    const draft = metadata.energyIq.projectSetup.getDraft({ project_id: project.id, user_id: userId });
    const currentArtifacts = buildTuyaArchiveReplay(archive.rows, archive.archiveSha256, draft.document);
    registered = registerTuyaArchiveReplay(metadata, new LocalFileAssetService(metadata, { storageRoot: fileRoot }), userId, currentArtifacts);
  } finally { metadata.close(); }
  const response = await fetch(new URL(`/api/v1/energy/projects/tuya-office/imports/${encodeURIComponent(registered.batchIds[0]!)}/materialize`, api), { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": registered.workspaceId, ...authHeaders }, body: "{}" });
  const result = await response.json();
  console.log(JSON.stringify({ stage: "publication", httpStatus: response.status, result }, null, 2));
  if (!response.ok) throw Error("REPLAY_REGISTERED_BUT_PUBLICATION_FAILED");
}


// Default dry-run. Apply uses the same target/auth options as replay-tuya-archive.ts.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createMetadataStore } from "@datafoundry/metadata";
import { LocalFileAssetService } from "@datafoundry/files";
import { buildTuyaOfficeSetup } from "../../../apps/api/src/energy/tuya-office-project.js";
import { readTuyaNativeBundle, appendTuyaNativeBundle } from "../../../apps/api/src/energy/energy-tuya-native-append.js";
import { replayTuyaAuthHeaders } from "../../../apps/api/src/report-agent/replay-tuya-auth.js";
import { authorizeReportProject } from "../../../apps/api/src/report-agent/report-inputs.js";
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(`--${name}`); const value = args[index + 1]; if (index < 0 || !value || value.startsWith("--")) throw Error(`ARGUMENT_REQUIRED:${name}`); return value; };
const directory = resolve(arg("bundle"));
const sources = readTuyaNativeBundle(directory, buildTuyaOfficeSetup());
console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", projectId: "tuya-office", sources: sources.map(({ sha256, inspection }) => ({ sha256, rawRows: inspection.rowCount, coverageFrom: inspection.coverageFrom, coverageTo: inspection.coverageTo })), note: "Source reading cutoff is not interval cutoff. Existing snapshot, sources and report settings are preserved." }, null, 2));
if (args.includes("--apply")) {
  const databasePath = resolve(arg("metadata")); const fileRoot = resolve(arg("file-root")); const userId = arg("user"); const api = new URL(arg("api-url"));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(api.hostname) || !existsSync(databasePath) || !existsSync(fileRoot)) throw Error("APPEND_EXISTING_LOCAL_TARGET_REQUIRED");
  const authHeaders = replayTuyaAuthHeaders(process.env);
  const metadata = createMetadataStore({ database_path: databasePath });
  let registered: ReturnType<typeof appendTuyaNativeBundle>;
  try {
    const project = metadata.energyIq.getProject("tuya-office"); authorizeReportProject(metadata, userId, project.workspace_id, project.id);
    const draft = metadata.energyIq.projectSetup.getDraft({ project_id: project.id, user_id: userId });
    const verified = readTuyaNativeBundle(directory, draft.document);
    registered = appendTuyaNativeBundle(metadata, new LocalFileAssetService(metadata, { storageRoot: fileRoot }), userId, verified);
  } finally { metadata.close(); }
  console.log(JSON.stringify({ stage: "registered", ...registered }));
  const response = await fetch(new URL(`/api/v1/energy/projects/tuya-office/imports/${encodeURIComponent(registered.batchIds[0]!)}/materialize`, api), { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": registered.workspaceId, ...authHeaders }, body: "{}" });
  const result = await response.json(); console.log(JSON.stringify({ stage: "publication", httpStatus: response.status, result }, null, 2));
  if (!response.ok) throw Error("APPEND_REGISTERED_BUT_PUBLICATION_FAILED");
}

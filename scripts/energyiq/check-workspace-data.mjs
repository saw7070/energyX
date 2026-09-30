import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only bootstrap check. File presence is not snapshot or coverage validation.
export function checkWorkspaceData(storageRoot) {
  const root = resolve(storageRoot);
  const db = new DatabaseSync(resolve(root, 'metadata/workbench.sqlite'), { readOnly: true });
  try {
    return db.prepare("SELECT id, workspace_id, data_snapshot_id FROM energyiq_projects WHERE data_snapshot_id != 'unavailable'").all().map(project => {
      const energyRoot = resolve(root, 'energy');
      const path = resolve(energyRoot, project.workspace_id, 'energy.duckdb');
      const rel = relative(energyRoot, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('INVALID_WORKSPACE_PATH');
      const present = existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
      return { projectId: project.id, workspaceId: project.workspace_id, snapshotId: project.data_snapshot_id, path, present };
    });
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/energyiq/check-workspace-data.mjs <storage-root>');
  const projects = checkWorkspaceData(process.argv[2]);
  console.log(JSON.stringify({ projects, scope: 'File presence only; verify snapshot identity and API access separately.' }, null, 2));
  if (projects.some(project => !project.present)) process.exitCode = 1;
}

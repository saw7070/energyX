import type { MetadataStore } from "@datafoundry/metadata";
import {
  copyEnergyFactProjectToWorkspace,
  purgeEnergyFactProject,
  resolveEnergyFactStorePath,
  type EnergyFactProjectRowCounts,
} from "@datafoundry/data-gateway";
import type { DatabaseSync } from "node:sqlite";

import { AuthError } from "../auth/service.js";
import { BOOTSTRAP_PINNED_PROJECT_IDS } from "./energy-bootstrap.js";

export type EnergyProjectMoveResult = {
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  metadataRowsUpdated: number;
  factRowsMoved: EnergyFactProjectRowCounts;
};

export type EnergyProjectMoveFactStore = FactStoreOperations;

type FactStoreOperations = {
  resolvePath: (workspaceId: string) => string;
  copy: typeof copyEnergyFactProjectToWorkspace;
  purge: typeof purgeEnergyFactProject;
};

const defaultFactStore: FactStoreOperations = {
  resolvePath: (workspaceId) => resolveEnergyFactStorePath(workspaceId),
  copy: copyEnergyFactProjectToWorkspace,
  purge: purgeEnergyFactProject,
};

/**
 * Moves a project, with its readings and history, from one customer Workspace to another.
 *
 * Facts are copied into the target store first, then every metadata row is restamped in one
 * SQLite transaction. The old facts are purged only after that commit, so a failure at any
 * step leaves the project readable in its original Workspace.
 */
export const moveEnergyProjectToWorkspace = async (input: {
  metadataStore: MetadataStore;
  projectId: string;
  targetWorkspaceId: string;
  factStore?: FactStoreOperations;
}): Promise<EnergyProjectMoveResult> => {
  const factStore = input.factStore ?? defaultFactStore;
  const { metadataStore, projectId, targetWorkspaceId } = input;
  let project;
  try {
    project = metadataStore.energyIq.getProject(projectId);
  } catch {
    throw new AuthError(404, "RESOURCE_NOT_FOUND", "Project not found.");
  }
  if (BOOTSTRAP_PINNED_PROJECT_IDS.has(projectId)) {
    throw new AuthError(409, "CONFLICT", "This built-in project is pinned to its Organisation and cannot be moved.");
  }
  if (process.env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim() === projectId) {
    throw new AuthError(409, "CONFLICT", "This project is bound to the live Tuya connector. Update ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID before moving it.");
  }
  const fromWorkspaceId = project.workspace_id;
  let target;
  try {
    target = metadataStore.workspaces.get({ id: targetWorkspaceId });
  } catch {
    throw new AuthError(404, "RESOURCE_NOT_FOUND", "Organisation not found.");
  }
  if (target.kind !== "customer") {
    throw new AuthError(400, "BAD_REQUEST", "Projects can only move to a customer Organisation.");
  }
  if (target.disabled_at) {
    throw new AuthError(409, "CONFLICT", `Organisation is disabled: ${target.name}`);
  }
  if (target.id === fromWorkspaceId) {
    throw new AuthError(409, "CONFLICT", "The project already belongs to this Organisation.");
  }
  if (metadataStore.energyIq.findProjectDataPublication(projectId)) {
    throw new AuthError(409, "CONFLICT", "A data publication is in progress for this project. Try again once it finishes.");
  }

  const sourcePath = factStore.resolvePath(fromWorkspaceId);
  const targetPath = factStore.resolvePath(target.id);
  const sharedFactStore = sourcePath === targetPath;
  const factRowsMoved = sharedFactStore
    ? await restampSharedFactStore()
    : await factStore.copy({ sourceDatabasePath: sourcePath, targetDatabasePath: targetPath, projectId, targetWorkspaceId: target.id });

  let metadataRowsUpdated: number;
  try {
    metadataRowsUpdated = restampProjectMetadata(metadataStore.db, { projectId, fromWorkspaceId, toWorkspaceId: target.id });
  } catch (error) {
    if (!sharedFactStore) await factStore.purge({ databasePath: targetPath, projectId }).catch(() => undefined);
    throw error;
  }
  if (!sharedFactStore) {
    // Reads filter by Workspace, so leftover rows are invisible; purge failure must not undo a committed move.
    await factStore.purge({ databasePath: sourcePath, projectId }).catch(() => undefined);
  }
  return { projectId, fromWorkspaceId, toWorkspaceId: target.id, metadataRowsUpdated, factRowsMoved };

  async function restampSharedFactStore(): Promise<EnergyFactProjectRowCounts> {
    // ENERGYIQ_DUCKDB_PATH points every Workspace at one file: copy in place is impossible, so
    // stage through a sibling file and back. Rare deployment shape; keeps the same guarantees.
    const stagingPath = `${sourcePath}.move-${projectId}.duckdb`;
    const counts = await factStore.copy({ sourceDatabasePath: sourcePath, targetDatabasePath: stagingPath, projectId, targetWorkspaceId: target!.id });
    await factStore.copy({ sourceDatabasePath: stagingPath, targetDatabasePath: sourcePath, projectId, targetWorkspaceId: target!.id });
    await factStore.purge({ databasePath: stagingPath, projectId });
    return counts;
  }
};

/** Restamps every metadata row that records the project's Workspace. Returns rows changed. */
export const restampProjectMetadata = (
  db: DatabaseSync,
  scope: { projectId: string; fromWorkspaceId: string; toWorkspaceId: string },
): number => {
  const { projectId, fromWorkspaceId, toWorkspaceId } = scope;
  let changed = 0;
  const run = (sql: string, ...params: Array<string | number>) => {
    changed += Number(db.prepare(sql).run(...params).changes);
  };
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
    .map(({ name }) => ({ name, columns: new Set((db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).map((column) => column.name)) }));
  const oldScope = `${encodeURIComponent(fromWorkspaceId)}/${encodeURIComponent(projectId)}`;
  const newScope = `${encodeURIComponent(toWorkspaceId)}/${encodeURIComponent(projectId)}`;
  const hasActions = tables.some((table) => table.name === "energyiq_actions");

  db.exec("BEGIN IMMEDIATE");
  try {
    // Composite (project, workspace) foreign keys have no ON UPDATE; defer them to commit time.
    db.exec("PRAGMA defer_foreign_keys = ON");
    run("UPDATE energyiq_projects SET workspace_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
      toWorkspaceId, new Date().toISOString(), projectId, fromWorkspaceId);
    if (changed !== 1) throw new Error("ENERGYIQ_PROJECT_MOVE_STALE");

    for (const { name, columns } of tables) {
      const quoted = `"${name}"`;
      if (columns.has("project_id") && columns.has("workspace_id")) {
        run(`UPDATE ${quoted} SET workspace_id = ? WHERE project_id = ? AND workspace_id = ?`, toWorkspaceId, projectId, fromWorkspaceId);
      }
      if (columns.has("document") && columns.has("project_id")) {
        run(`UPDATE ${quoted} SET document = json_set(document, '$.workspaceId', ?)
          WHERE project_id = ? AND json_valid(document) AND json_extract(document, '$.workspaceId') = ?`,
        toWorkspaceId, projectId, fromWorkspaceId);
      }
      if (columns.has("document") && columns.has("action_id") && !columns.has("project_id") && hasActions) {
        run(`UPDATE ${quoted} SET document = json_set(document, '$.workspaceId', ?)
          WHERE action_id IN (SELECT id FROM energyiq_actions WHERE project_id = ?)
            AND json_valid(document) AND json_extract(document, '$.workspaceId') = ?`,
        toWorkspaceId, projectId, fromWorkspaceId);
      }
      if (columns.has("scope") && columns.has("document") && name.startsWith("energyiq_")) {
        run(`UPDATE ${quoted} SET scope = ?,
            document = CASE WHEN json_valid(document) AND json_extract(document, '$.workspaceId') = ?
              THEN json_set(document, '$.workspaceId', ?) ELSE document END
          WHERE scope = ?`, newScope, fromWorkspaceId, toWorkspaceId, oldScope);
      }
    }

    if (tables.some((table) => table.name === "file_asset_refs") && tables.some((table) => table.name === "energyiq_import_batches")) {
      run(`UPDATE file_asset_refs SET workspace_id = ?
        WHERE workspace_id = ? AND id IN (SELECT file_asset_ref_id FROM energyiq_import_batches WHERE project_id = ?)`,
      toWorkspaceId, fromWorkspaceId, projectId);
    }
    if (tables.some((table) => table.name === "config_resources")) {
      run(`UPDATE config_resources SET workspace_id = ?
        WHERE workspace_id = ? AND json_valid(payload_json) AND json_extract(payload_json, '$.reportProjectId') = ?`,
      toWorkspaceId, fromWorkspaceId, projectId);
    }

    // Deferred foreign keys are enforced here: COMMIT fails if the move left any reference dangling.
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return changed;
};

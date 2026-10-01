import type { MetadataStore } from "@datafoundry/metadata";
import { purgeEnergyFactProject, resolveEnergyFactStorePath } from "@datafoundry/data-gateway";
import type { DatabaseSync } from "node:sqlite";

import { AuthError } from "../auth/service.js";
import { BOOTSTRAP_PINNED_PROJECT_IDS } from "./energy-bootstrap.js";

const requireProject = (metadataStore: MetadataStore, projectId: string) => {
  try {
    return metadataStore.energyIq.getProject(projectId);
  } catch {
    throw new AuthError(404, "RESOURCE_NOT_FOUND", "Project not found.");
  }
};

const refusePinned = (projectId: string, verb: string) => {
  if (BOOTSTRAP_PINNED_PROJECT_IDS.has(projectId)) {
    throw new AuthError(409, "CONFLICT", `This built-in project is restored on every startup and cannot be ${verb}.`);
  }
};

/**
 * Archives a project (hidden from customers, data kept) or restores it. A restored project returns
 * to Published when it has ever been published, otherwise to Draft.
 */
export const setEnergyProjectArchived = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  archived: boolean;
}): { projectId: string; status: "draft" | "published" | "archived" } => {
  const project = requireProject(input.metadataStore, input.projectId);
  refusePinned(project.id, input.archived ? "archived" : "restored");
  const db = input.metadataStore.db;
  const everPublished = hasRow(db, "energyiq_template_revisions", project.id);
  const status = input.archived ? "archived" : everPublished ? "published" : "draft";
  db.prepare("UPDATE energyiq_projects SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), project.id);
  return { projectId: project.id, status };
};

/**
 * Permanently deletes a project with its setup, readings, reports, actions and history.
 * Chat conversations that mentioned the project are kept and simply unlinked from it.
 */
export const deleteEnergyProject = async (input: {
  metadataStore: MetadataStore;
  projectId: string;
  confirmName: string;
  purgeFacts?: (input: { databasePath: string; projectId: string }) => Promise<void>;
  resolveFactStorePath?: (workspaceId: string) => string;
}): Promise<{ projectId: string; workspaceId: string; metadataRowsDeleted: number }> => {
  const project = requireProject(input.metadataStore, input.projectId);
  refusePinned(project.id, "deleted");
  if (input.confirmName.trim() !== project.name.trim()) {
    throw new AuthError(400, "BAD_REQUEST", "Type the project name exactly to confirm deletion.");
  }
  if (input.metadataStore.energyIq.findProjectDataPublication(project.id)) {
    throw new AuthError(409, "CONFLICT", "A data publication is in progress for this project. Try again once it finishes.");
  }
  const metadataRowsDeleted = deleteProjectMetadata(input.metadataStore.db, { projectId: project.id, workspaceId: project.workspace_id });
  const purge = input.purgeFacts ?? purgeEnergyFactProject;
  const resolvePath = input.resolveFactStorePath ?? resolveEnergyFactStorePath;
  // Readings are only reachable through the deleted project; a failed purge leaves unreachable rows, not a broken project.
  await purge({ databasePath: resolvePath(project.workspace_id), projectId: project.id }).catch(() => undefined);
  return { projectId: project.id, workspaceId: project.workspace_id, metadataRowsDeleted };
};

const deleteProjectMetadata = (db: DatabaseSync, scope: { projectId: string; workspaceId: string }): number => {
  const { projectId, workspaceId } = scope;
  let changed = 0;
  const run = (sql: string, ...params: string[]) => {
    changed += Number(db.prepare(sql).run(...params).changes);
  };
  const tables = listTables(db);
  const has = (name: string) => tables.some((table) => table.name === name);
  const projectScope = `${encodeURIComponent(workspaceId)}/${encodeURIComponent(projectId)}`;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("PRAGMA defer_foreign_keys = ON");
    // Rows keyed by an action or report run go first, while their parents still identify the project.
    if (has("energyiq_actions")) {
      for (const { name, columns } of tables) {
        if (name !== "energyiq_actions" && columns.has("action_id") && !columns.has("project_id")) {
          run(`DELETE FROM "${name}" WHERE action_id IN (SELECT id FROM energyiq_actions WHERE project_id = ?)`, projectId);
        }
      }
    }
    if (has("energyiq_report_events") && has("energyiq_report_runs")) {
      run("DELETE FROM energyiq_report_events WHERE run_id IN (SELECT id FROM energyiq_report_runs WHERE project_id = ?)", projectId);
    }
    for (const { name, columns } of tables) {
      if (columns.has("scope") && name.startsWith("energyiq_") && !columns.has("project_id")) {
        run(`DELETE FROM "${name}" WHERE scope = ?`, projectScope);
      }
    }
    if (has("config_resources")) {
      run(`DELETE FROM config_resources
        WHERE workspace_id = ? AND json_valid(payload_json) AND json_extract(payload_json, '$.reportProjectId') = ?`, workspaceId, projectId);
    }
    if (has("energyiq_live_connectors") && has("encrypted_secrets")) {
      // A live connection's sealed account is keyed by its own reference, not the project, so remove it by hand.
      run("DELETE FROM encrypted_secrets WHERE ref IN (SELECT secret_ref FROM energyiq_live_connectors WHERE project_id = ?)", projectId);
    }
    if (has("sessions")) {
      db.prepare("UPDATE sessions SET project_id = NULL WHERE project_id = ?").run(projectId);
    }
    for (const { name, columns } of tables) {
      if (name !== "sessions" && columns.has("project_id")) {
        run(`DELETE FROM "${name}" WHERE project_id = ?`, projectId);
      }
    }
    run("DELETE FROM energyiq_projects WHERE id = ?", projectId);
    // Deferred foreign keys are enforced here: COMMIT fails if anything still points at the project.
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return changed;
};

const listTables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
    .map(({ name }) => ({
      name,
      columns: new Set((db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).map((column) => column.name)),
    }));

const hasRow = (db: DatabaseSync, table: string, projectId: string): boolean => {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(exists && db.prepare(`SELECT 1 FROM "${table}" WHERE project_id = ? LIMIT 1`).get(projectId));
};

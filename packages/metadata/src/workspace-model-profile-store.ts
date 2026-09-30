import type { DatabaseSync } from "node:sqlite";

export const WORKSPACE_DEFAULT_MODEL_PROFILE_ID = "workspace-default";

export type WorkspaceDefaultModelProfileRecord = {
  workspace_id: string;
  profile_id: string;
  profile_owner_user_id: string;
  configured_by_user_id: string;
  fallback_policy: "disabled";
  revision: number;
  created_at: string;
  updated_at: string;
};

export const initializeWorkspaceDefaultModelProfileSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_default_model_profiles (
      workspace_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      profile_owner_user_id TEXT NOT NULL,
      configured_by_user_id TEXT NOT NULL,
      fallback_policy TEXT NOT NULL CHECK (fallback_policy = 'disabled'),
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_owner_user_id) REFERENCES users(id),
      FOREIGN KEY (configured_by_user_id) REFERENCES users(id)
    );
  `);
};

/** Bind one existing private model profile for server-side Workspace use. */
export class WorkspaceDefaultModelProfileRepository {
  constructor(private readonly db: DatabaseSync) {}

  set(input: {
    workspace_id: string;
    profile_id: string;
    profile_owner_user_id: string;
    configured_by_user_id: string;
    expected_revision?: number;
  }): WorkspaceDefaultModelProfileRecord {
    const profile = this.db.prepare(`
      SELECT payload_json, default_enabled, status
      FROM config_resources
      WHERE workspace_id = ? AND user_id = ? AND kind = 'model-profile' AND id = ?
    `).get(input.workspace_id, input.profile_owner_user_id, input.profile_id);
    if (!isRecord(profile)) {
      throw new Error(`CONFIG_RESOURCE_NOT_FOUND:model-profile:${input.profile_id}`);
    }
    const payload = parseRecord(profile.payload_json);
    if (optionalString(payload.fallbackProfileId)) {
      throw new Error("WORKSPACE_DEFAULT_MODEL_FALLBACK_MUST_BE_DISABLED");
    }
    if (profile.default_enabled !== 1) {
      throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_DISABLED");
    }
    if (profile.status !== "connected") {
      throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");
    }

    const current = this.find(input.workspace_id);
    if (input.expected_revision !== undefined && current?.revision !== input.expected_revision) {
      throw new Error(`REVISION_CONFLICT:${WORKSPACE_DEFAULT_MODEL_PROFILE_ID}`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workspace_default_model_profiles (
        workspace_id, profile_id, profile_owner_user_id, configured_by_user_id,
        fallback_policy, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'disabled', ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        profile_owner_user_id = excluded.profile_owner_user_id,
        configured_by_user_id = excluded.configured_by_user_id,
        fallback_policy = excluded.fallback_policy,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(
      input.workspace_id,
      input.profile_id,
      input.profile_owner_user_id,
      input.configured_by_user_id,
      (current?.revision ?? 0) + 1,
      current?.created_at ?? now,
      now
    );
    return this.get(input.workspace_id);
  }

  get(workspaceId: string): WorkspaceDefaultModelProfileRecord {
    const record = this.find(workspaceId);
    if (!record) throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONFIGURED");
    return record;
  }

  find(workspaceId: string): WorkspaceDefaultModelProfileRecord | undefined {
    return mapRecord(this.db.prepare(
      "SELECT * FROM workspace_default_model_profiles WHERE workspace_id = ?"
    ).get(workspaceId));
  }

  clear(input: { workspace_id: string; expected_revision?: number }): void {
    const current = this.get(input.workspace_id);
    if (input.expected_revision !== undefined && current.revision !== input.expected_revision) {
      throw new Error(`REVISION_CONFLICT:${WORKSPACE_DEFAULT_MODEL_PROFILE_ID}`);
    }
    this.db.prepare("DELETE FROM workspace_default_model_profiles WHERE workspace_id = ?")
      .run(input.workspace_id);
  }
}

const mapRecord = (value: unknown): WorkspaceDefaultModelProfileRecord | undefined => {
  if (!isRecord(value)) return undefined;
  return {
    workspace_id: requiredString(value.workspace_id),
    profile_id: requiredString(value.profile_id),
    profile_owner_user_id: requiredString(value.profile_owner_user_id),
    configured_by_user_id: requiredString(value.configured_by_user_id),
    fallback_policy: "disabled",
    revision: requiredNumber(value.revision),
    created_at: requiredString(value.created_at),
    updated_at: requiredString(value.updated_at)
  };
};

const parseRecord = (value: unknown): Record<string, unknown> => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(parsed)) throw new Error("CONFIG_RESOURCE_PAYLOAD_INVALID");
  return parsed;
};

const requiredString = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_ROW_INVALID");
  return value;
};
const requiredNumber = (value: unknown): number => {
  if (typeof value !== "number") throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_ROW_INVALID");
  return value;
};
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

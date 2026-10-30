import type { DatabaseSync } from "node:sqlite";

/**
 * How the people of one Organisation (a customer Workspace) sign in and are provisioned from their own identity
 * provider:
 *
 * - `organisation_sso_configs`: one OpenID Connect connection per Organisation. The client secret lives in
 *   `encrypted_secrets` under `client_secret_ref`; this row keeps only what the server needs to find it.
 * - `organisation_sso_domains`: the email domains whose people sign in through that connection. A domain belongs to at
 *   most one Organisation, so an email address always leads to a single identity provider.
 * - `organisation_sso_login_states`: one short-lived row per sign-in in progress (state, nonce, PKCE verifier and the
 *   browser it started in). State, nonce and browser binding are stored only as keyed hashes.
 * - `organisation_scim_tokens`: provisioning keys an identity provider uses to call the SCIM API. Stored only as a
 *   keyed hash, like session tokens; the key itself is shown once when it is created.
 * - `organisation_scim_users`: what the identity provider told us about a person it provisioned into an Organisation
 *   (its own id for them, the name it uses, and whether it has switched them off there).
 */
export type OrganisationSsoConfigRecord = {
  workspace_id: string;
  enabled: boolean;
  issuer: string;
  client_id: string;
  client_secret_ref?: string;
  secret_user_id?: string;
  require_sso: boolean;
  auto_create_accounts: boolean;
  domains: string[];
  last_test_at?: string;
  last_test_ok?: boolean;
  last_test_message?: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type OrganisationSsoLoginStateRecord = {
  state_hash: string;
  workspace_id: string;
  binding_hash: string;
  nonce_hash: string;
  code_verifier: string;
  return_to?: string;
  remember_me: boolean;
  expires_at: string;
  created_at: string;
};

export type OrganisationScimTokenRecord = {
  id: string;
  workspace_id: string;
  name: string;
  token_hash: string;
  token_hint: string;
  created_by?: string;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
};

export type OrganisationScimUserRecord = {
  workspace_id: string;
  user_id: string;
  external_id?: string;
  user_name?: string;
  display_name?: string;
  active: boolean;
  /** The role the person held here before the identity provider switched them off, restored if it switches them back on. */
  suspended_role_id?: string;
  /** True when switching the person off here also disabled their account, because they belonged nowhere else. */
  disabled_account: boolean;
  created_at: string;
  updated_at: string;
};

export const initializeOrganisationIdentitySchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organisation_sso_configs (
      workspace_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      issuer TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret_ref TEXT,
      secret_user_id TEXT,
      require_sso INTEGER NOT NULL DEFAULT 0 CHECK (require_sso IN (0, 1)),
      auto_create_accounts INTEGER NOT NULL DEFAULT 0 CHECK (auto_create_accounts IN (0, 1)),
      last_test_at TEXT,
      last_test_ok INTEGER,
      last_test_message TEXT,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organisation_sso_domains (
      domain TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_organisation_sso_domains_workspace
      ON organisation_sso_domains(workspace_id);
    CREATE TABLE IF NOT EXISTS organisation_sso_login_states (
      state_hash TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      binding_hash TEXT NOT NULL,
      nonce_hash TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      return_to TEXT,
      remember_me INTEGER NOT NULL DEFAULT 1 CHECK (remember_me IN (0, 1)),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_organisation_sso_login_states_expiry
      ON organisation_sso_login_states(expires_at);
    CREATE TABLE IF NOT EXISTS organisation_scim_tokens (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_hint TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_organisation_scim_tokens_workspace
      ON organisation_scim_tokens(workspace_id, created_at);
    CREATE TABLE IF NOT EXISTS organisation_scim_users (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      external_id TEXT,
      user_name TEXT,
      display_name TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      suspended_role_id TEXT,
      disabled_account INTEGER NOT NULL DEFAULT 0 CHECK (disabled_account IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_organisation_scim_users_external
      ON organisation_scim_users(workspace_id, external_id);
  `);
};

export class OrganisationIdentityStore {
  constructor(private readonly db: DatabaseSync) {}

  // --- Single sign-on connection --------------------------------------------------------------------------------

  findSsoConfig(workspaceId: string): OrganisationSsoConfigRecord | undefined {
    const row = this.db.prepare("SELECT * FROM organisation_sso_configs WHERE workspace_id = ?").get(workspaceId);
    return isRecord(row) ? this.mapSsoConfig(row) : undefined;
  }

  /** The connection that owns this email domain, if any Organisation has claimed it. */
  findSsoConfigByDomain(domain: string): OrganisationSsoConfigRecord | undefined {
    const row = this.db.prepare(`
      SELECT c.* FROM organisation_sso_configs c
      INNER JOIN organisation_sso_domains d ON d.workspace_id = c.workspace_id
      WHERE d.domain = ?
    `).get(domain.trim().toLowerCase());
    return isRecord(row) ? this.mapSsoConfig(row) : undefined;
  }

  /** Which Organisation, if any, has already claimed the domain. */
  domainOwner(domain: string): string | undefined {
    const row = this.db.prepare("SELECT workspace_id FROM organisation_sso_domains WHERE domain = ?")
      .get(domain.trim().toLowerCase());
    return isRecord(row) ? String(row.workspace_id) : undefined;
  }

  /** Create or replace the connection and its domains in one step. Throws ORGANISATION_SSO_DOMAIN_TAKEN:<domain>. */
  saveSsoConfig(input: {
    workspace_id: string;
    enabled: boolean;
    issuer: string;
    client_id: string;
    client_secret_ref?: string | null;
    secret_user_id?: string | null;
    require_sso: boolean;
    auto_create_accounts: boolean;
    domains: string[];
    updated_by: string;
    now?: string;
  }): OrganisationSsoConfigRecord {
    const now = input.now ?? new Date().toISOString();
    const current = this.findSsoConfig(input.workspace_id);
    this.db.exec("SAVEPOINT organisation_sso_save");
    try {
      for (const domain of input.domains) {
        const owner = this.domainOwner(domain);
        if (owner && owner !== input.workspace_id) throw new Error(`ORGANISATION_SSO_DOMAIN_TAKEN:${domain}`);
      }
      this.db.prepare(`
        INSERT INTO organisation_sso_configs (
          workspace_id, enabled, issuer, client_id, client_secret_ref, secret_user_id, require_sso,
          auto_create_accounts, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          enabled = excluded.enabled,
          issuer = excluded.issuer,
          client_id = excluded.client_id,
          client_secret_ref = excluded.client_secret_ref,
          secret_user_id = excluded.secret_user_id,
          require_sso = excluded.require_sso,
          auto_create_accounts = excluded.auto_create_accounts,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(
        input.workspace_id,
        input.enabled ? 1 : 0,
        input.issuer,
        input.client_id,
        input.client_secret_ref === undefined ? current?.client_secret_ref ?? null : input.client_secret_ref,
        input.secret_user_id === undefined ? current?.secret_user_id ?? null : input.secret_user_id,
        input.require_sso ? 1 : 0,
        input.auto_create_accounts ? 1 : 0,
        input.updated_by,
        now,
        now
      );
      this.db.prepare("DELETE FROM organisation_sso_domains WHERE workspace_id = ?").run(input.workspace_id);
      const insertDomain = this.db.prepare(
        "INSERT INTO organisation_sso_domains (domain, workspace_id, created_at) VALUES (?, ?, ?)"
      );
      for (const domain of new Set(input.domains.map((value) => value.trim().toLowerCase()))) {
        insertDomain.run(domain, input.workspace_id, now);
      }
      this.db.exec("RELEASE organisation_sso_save");
    } catch (error) {
      this.db.exec("ROLLBACK TO organisation_sso_save");
      this.db.exec("RELEASE organisation_sso_save");
      throw error;
    }
    return this.findSsoConfig(input.workspace_id)!;
  }

  recordSsoTest(input: { workspace_id: string; ok: boolean; message?: string; now?: string }): void {
    this.db.prepare(`
      UPDATE organisation_sso_configs SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE workspace_id = ?
    `).run(input.now ?? new Date().toISOString(), input.ok ? 1 : 0, input.message?.slice(0, 300) ?? null, input.workspace_id);
  }

  /** Removes the connection and frees its domains. Returns what was removed so the caller can delete the secret. */
  deleteSsoConfig(workspaceId: string): OrganisationSsoConfigRecord | undefined {
    const current = this.findSsoConfig(workspaceId);
    if (!current) return undefined;
    this.db.prepare("DELETE FROM organisation_sso_domains WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM organisation_sso_configs WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM organisation_sso_login_states WHERE workspace_id = ?").run(workspaceId);
    return current;
  }

  // --- Sign-ins in progress ---------------------------------------------------------------------------------------

  createLoginState(input: Omit<OrganisationSsoLoginStateRecord, "created_at"> & { now?: string }): void {
    const now = input.now ?? new Date().toISOString();
    this.db.prepare("DELETE FROM organisation_sso_login_states WHERE expires_at <= ?").run(now);
    this.db.prepare(`
      INSERT INTO organisation_sso_login_states (
        state_hash, workspace_id, binding_hash, nonce_hash, code_verifier, return_to, remember_me, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.state_hash,
      input.workspace_id,
      input.binding_hash,
      input.nonce_hash,
      input.code_verifier,
      input.return_to ?? null,
      input.remember_me ? 1 : 0,
      input.expires_at,
      now
    );
  }

  /** Takes the sign-in out of the table, so a state is used once at most. Expired states are never returned. */
  consumeLoginState(stateHash: string, now: string = new Date().toISOString()): OrganisationSsoLoginStateRecord | undefined {
    const row = this.db.prepare("SELECT * FROM organisation_sso_login_states WHERE state_hash = ?").get(stateHash);
    if (!isRecord(row)) return undefined;
    const removed = this.db.prepare("DELETE FROM organisation_sso_login_states WHERE state_hash = ?").run(stateHash);
    if (Number(removed.changes) !== 1) return undefined;
    const record: OrganisationSsoLoginStateRecord = {
      state_hash: String(row.state_hash),
      workspace_id: String(row.workspace_id),
      binding_hash: String(row.binding_hash),
      nonce_hash: String(row.nonce_hash),
      code_verifier: String(row.code_verifier),
      ...(typeof row.return_to === "string" ? { return_to: row.return_to } : {}),
      remember_me: Number(row.remember_me) === 1,
      expires_at: String(row.expires_at),
      created_at: String(row.created_at)
    };
    return record.expires_at > now ? record : undefined;
  }

  // --- Provisioning keys -----------------------------------------------------------------------------------------

  createScimToken(input: {
    id: string;
    workspace_id: string;
    name: string;
    token_hash: string;
    token_hint: string;
    created_by?: string;
    now?: string;
  }): OrganisationScimTokenRecord {
    this.db.prepare(`
      INSERT INTO organisation_scim_tokens (id, workspace_id, name, token_hash, token_hint, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.workspace_id, input.name, input.token_hash, input.token_hint, input.created_by ?? null,
      input.now ?? new Date().toISOString());
    return this.findScimToken(input.id)!;
  }

  findScimToken(id: string): OrganisationScimTokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM organisation_scim_tokens WHERE id = ?").get(id);
    return isRecord(row) ? mapScimToken(row) : undefined;
  }

  /** The key with this hash, unless it has been revoked. */
  findActiveScimTokenByHash(tokenHash: string): OrganisationScimTokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM organisation_scim_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .get(tokenHash);
    return isRecord(row) ? mapScimToken(row) : undefined;
  }

  listScimTokens(workspaceId: string): OrganisationScimTokenRecord[] {
    return this.db.prepare(`
      SELECT * FROM organisation_scim_tokens WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at, id
    `).all(workspaceId).filter(isRecord).map(mapScimToken);
  }

  touchScimToken(id: string, now: string = new Date().toISOString()): void {
    this.db.prepare("UPDATE organisation_scim_tokens SET last_used_at = ? WHERE id = ?").run(now, id);
  }

  /** Revokes the key if it belongs to this Organisation. Returns false when there was nothing to revoke. */
  revokeScimToken(input: { id: string; workspace_id: string; now?: string }): boolean {
    const result = this.db.prepare(`
      UPDATE organisation_scim_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL
    `).run(input.now ?? new Date().toISOString(), input.id, input.workspace_id);
    return Number(result.changes) === 1;
  }

  // --- People provisioned by the identity provider --------------------------------------------------------------

  findScimUser(workspaceId: string, userId: string): OrganisationScimUserRecord | undefined {
    const row = this.db.prepare("SELECT * FROM organisation_scim_users WHERE workspace_id = ? AND user_id = ?")
      .get(workspaceId, userId);
    return isRecord(row) ? mapScimUser(row) : undefined;
  }

  listScimUsers(workspaceId: string): OrganisationScimUserRecord[] {
    return this.db.prepare("SELECT * FROM organisation_scim_users WHERE workspace_id = ? ORDER BY created_at, user_id")
      .all(workspaceId).filter(isRecord).map(mapScimUser);
  }

  /** Create or update the record; fields left undefined keep their current value. */
  upsertScimUser(input: {
    workspace_id: string;
    user_id: string;
    external_id?: string | null;
    user_name?: string | null;
    display_name?: string | null;
    active?: boolean;
    suspended_role_id?: string | null;
    disabled_account?: boolean;
    now?: string;
  }): OrganisationScimUserRecord {
    const now = input.now ?? new Date().toISOString();
    const current = this.findScimUser(input.workspace_id, input.user_id);
    const pick = <T>(next: T | undefined, previous: T | undefined): T | null =>
      next === undefined ? previous ?? null : next;
    this.db.prepare(`
      INSERT INTO organisation_scim_users (
        workspace_id, user_id, external_id, user_name, display_name, active, suspended_role_id, disabled_account,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET
        external_id = excluded.external_id,
        user_name = excluded.user_name,
        display_name = excluded.display_name,
        active = excluded.active,
        suspended_role_id = excluded.suspended_role_id,
        disabled_account = excluded.disabled_account,
        updated_at = excluded.updated_at
    `).run(
      input.workspace_id,
      input.user_id,
      pick(input.external_id, current?.external_id),
      pick(input.user_name, current?.user_name),
      pick(input.display_name, current?.display_name),
      (input.active ?? current?.active ?? true) ? 1 : 0,
      pick(input.suspended_role_id, current?.suspended_role_id),
      (input.disabled_account ?? current?.disabled_account ?? false) ? 1 : 0,
      current?.created_at ?? now,
      now
    );
    return this.findScimUser(input.workspace_id, input.user_id)!;
  }

  deleteScimUser(workspaceId: string, userId: string): void {
    this.db.prepare("DELETE FROM organisation_scim_users WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
  }

  private mapSsoConfig(row: Record<string, unknown>): OrganisationSsoConfigRecord {
    const workspaceId = String(row.workspace_id);
    const domains = this.db.prepare("SELECT domain FROM organisation_sso_domains WHERE workspace_id = ? ORDER BY domain")
      .all(workspaceId).filter(isRecord).map((domain) => String(domain.domain));
    return {
      workspace_id: workspaceId,
      enabled: Number(row.enabled) === 1,
      issuer: String(row.issuer),
      client_id: String(row.client_id),
      ...(typeof row.client_secret_ref === "string" ? { client_secret_ref: row.client_secret_ref } : {}),
      ...(typeof row.secret_user_id === "string" ? { secret_user_id: row.secret_user_id } : {}),
      require_sso: Number(row.require_sso) === 1,
      auto_create_accounts: Number(row.auto_create_accounts) === 1,
      domains,
      ...(typeof row.last_test_at === "string" ? { last_test_at: row.last_test_at } : {}),
      ...(row.last_test_ok === null || row.last_test_ok === undefined ? {} : { last_test_ok: Number(row.last_test_ok) === 1 }),
      ...(typeof row.last_test_message === "string" ? { last_test_message: row.last_test_message } : {}),
      updated_by: String(row.updated_by),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    };
  }
}

const mapScimToken = (row: Record<string, unknown>): OrganisationScimTokenRecord => ({
  id: String(row.id),
  workspace_id: String(row.workspace_id),
  name: String(row.name),
  token_hash: String(row.token_hash),
  token_hint: String(row.token_hint),
  ...(typeof row.created_by === "string" ? { created_by: row.created_by } : {}),
  created_at: String(row.created_at),
  ...(typeof row.last_used_at === "string" ? { last_used_at: row.last_used_at } : {}),
  ...(typeof row.revoked_at === "string" ? { revoked_at: row.revoked_at } : {})
});

const mapScimUser = (row: Record<string, unknown>): OrganisationScimUserRecord => ({
  workspace_id: String(row.workspace_id),
  user_id: String(row.user_id),
  ...(typeof row.external_id === "string" ? { external_id: row.external_id } : {}),
  ...(typeof row.user_name === "string" ? { user_name: row.user_name } : {}),
  ...(typeof row.display_name === "string" ? { display_name: row.display_name } : {}),
  active: Number(row.active) === 1,
  ...(typeof row.suspended_role_id === "string" ? { suspended_role_id: row.suspended_role_id } : {}),
  disabled_account: Number(row.disabled_account) === 1,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

import type { DatabaseSync } from "node:sqlite";

/**
 * Roles a super admin creates and then hands out per Organisation. A role is a name plus, for each area of the
 * product, how far its holders may go: not at all, read, or write (write includes read). Super admins sit above all
 * roles and are never described by one.
 */
export const ENERGYIQ_PERMISSION_AREAS = ["reports", "facility", "hours_rate", "notes", "live_connection", "people"] as const;
export type EnergyIqPermissionArea = (typeof ENERGYIQ_PERMISSION_AREAS)[number];
export type EnergyIqPermissionLevel = "none" | "read" | "write";
export type EnergyIqRolePermissions = Readonly<Record<EnergyIqPermissionArea, EnergyIqPermissionLevel>>;

export type EnergyIqAccessRoleRecord = {
  id: string;
  name: string;
  description: string;
  /** Built-in roles cannot be edited or deleted. */
  builtin: boolean;
  permissions: EnergyIqRolePermissions;
  created_at: string;
  updated_at: string;
};

/** Everyone who is added to an Organisation without a chosen role holds this one. */
export const ENERGYIQ_VIEWER_ROLE_ID = "role-viewer";
export const ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID = "role-organisation-admin";

export const VIEWER_PERMISSIONS: EnergyIqRolePermissions = Object.freeze({
  reports: "write", facility: "read", hours_rate: "read", notes: "read", live_connection: "none", people: "none"
});
export const NO_PERMISSIONS: EnergyIqRolePermissions = Object.freeze({
  reports: "none", facility: "none", hours_rate: "none", notes: "none", live_connection: "none", people: "none"
});
export const ALL_PERMISSIONS: EnergyIqRolePermissions = Object.freeze({
  reports: "write", facility: "write", hours_rate: "write", notes: "write", live_connection: "write", people: "write"
});
const LEVELS: ReadonlySet<string> = new Set(["none", "read", "write"]);

/** Unknown areas are dropped and anything missing or invalid becomes "none", so a role never grants by accident. */
export const normaliseRolePermissions = (value: unknown): EnergyIqRolePermissions => {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const result = { ...NO_PERMISSIONS } as Record<EnergyIqPermissionArea, EnergyIqPermissionLevel>;
  for (const area of ENERGYIQ_PERMISSION_AREAS) {
    const level = source[area];
    if (typeof level === "string" && LEVELS.has(level)) result[area] = level as EnergyIqPermissionLevel;
  }
  return Object.freeze(result);
};

export const permissionAllows = (
  permissions: EnergyIqRolePermissions,
  area: EnergyIqPermissionArea,
  needed: "read" | "write"
): boolean => permissions[area] === "write" || (needed === "read" && permissions[area] === "read");

export const initializeEnergyIqAccessRoleSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_access_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
      permissions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_energyiq_access_roles_name
      ON energyiq_access_roles(lower(name));
  `);
  const now = new Date().toISOString();
  const seed = db.prepare(`
    INSERT OR IGNORE INTO energyiq_access_roles (id, name, description, builtin, permissions_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  seed.run(
    ENERGYIQ_VIEWER_ROLE_ID, "Viewer",
    "Can look at everything for the client and ask the advisor, but cannot change anything.",
    1, JSON.stringify(VIEWER_PERMISSIONS), now, now
  );
  seed.run(
    ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID, "Organisation admin",
    "Runs the client: sets up the facility, uploads data, connects meters and manages the client's people.",
    0, JSON.stringify(ALL_PERMISSIONS), now, now
  );
};

/**
 * Earlier builds seeded "Organisation admin" as a Viewer who could only manage people. If nobody has edited that role,
 * give it the full set of client-management rights it is meant to carry.
 */
export const upgradeSeededOrganisationAdminRole = (db: DatabaseSync): void => {
  db.prepare(`
    UPDATE energyiq_access_roles
    SET permissions_json = ?, description = ?, updated_at = ?
    WHERE id = ? AND permissions_json = ?
  `).run(
    JSON.stringify(ALL_PERMISSIONS),
    "Runs the client: sets up the facility, uploads data, connects meters and manages the client's people.",
    new Date().toISOString(),
    ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID,
    JSON.stringify(FIRST_ORGANISATION_ADMIN_PERMISSIONS_AS_STORED)
  );
};
// The JSON as the first seed wrote it (no live_connection key), so the comparison is exact.
const FIRST_ORGANISATION_ADMIN_PERMISSIONS_AS_STORED = {
  reports: "write", facility: "read", hours_rate: "read", notes: "read", people: "write"
};

export class EnergyIqAccessRoleStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): EnergyIqAccessRoleRecord[] {
    return this.db.prepare("SELECT * FROM energyiq_access_roles ORDER BY builtin DESC, lower(name)")
      .all().map(mapRole);
  }

  find(id: string): EnergyIqAccessRoleRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_access_roles WHERE id = ?").get(id);
    return row ? mapRole(row) : undefined;
  }

  require(id: string): EnergyIqAccessRoleRecord {
    const role = this.find(id);
    if (!role) throw new Error(`ENERGYIQ_ROLE_NOT_FOUND:${id}`);
    return role;
  }

  create(input: { id: string; name: string; description?: string; permissions: unknown; now?: string }): EnergyIqAccessRoleRecord {
    const name = requireRoleName(input.name);
    this.assertNameFree(name);
    const now = input.now ?? new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_access_roles (id, name, description, builtin, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(input.id, name, (input.description ?? "").trim().slice(0, 300), JSON.stringify(normaliseRolePermissions(input.permissions)), now, now);
    return this.require(input.id);
  }

  update(input: { id: string; name: string; description?: string; permissions: unknown; now?: string }): EnergyIqAccessRoleRecord {
    const current = this.require(input.id);
    if (current.builtin) throw new Error("ENERGYIQ_ROLE_BUILTIN");
    const name = requireRoleName(input.name);
    this.assertNameFree(name, current.id);
    this.db.prepare(`
      UPDATE energyiq_access_roles
      SET name = ?, description = ?, permissions_json = ?, updated_at = ?
      WHERE id = ?
    `).run(name, (input.description ?? "").trim().slice(0, 300), JSON.stringify(normaliseRolePermissions(input.permissions)), input.now ?? new Date().toISOString(), current.id);
    return this.require(current.id);
  }

  /** How many people hold the role, across all Organisations. */
  countAssignments(id: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE role_id = ?").get(id) as { n: number };
    return row.n;
  }

  delete(id: string): void {
    const current = this.require(id);
    if (current.builtin) throw new Error("ENERGYIQ_ROLE_BUILTIN");
    if (this.countAssignments(id) > 0) throw new Error("ENERGYIQ_ROLE_IN_USE");
    this.db.prepare("DELETE FROM energyiq_access_roles WHERE id = ?").run(id);
  }

  /**
   * What a person may do in one Organisation. A membership with no role is a Viewer. A role that has since vanished
   * grants nothing rather than falling back to something broader.
   */
  permissionsFor(input: { workspace_id: string; user_id: string }): EnergyIqRolePermissions | undefined {
    const row = this.db.prepare(
      "SELECT role_id FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?"
    ).get(input.workspace_id, input.user_id) as { role_id: string | null } | undefined;
    if (!row) return undefined;
    if (!row.role_id) return VIEWER_PERMISSIONS;
    return this.find(row.role_id)?.permissions ?? NO_PERMISSIONS;
  }

  private assertNameFree(name: string, exceptId?: string): void {
    const row = this.db.prepare("SELECT id FROM energyiq_access_roles WHERE lower(name) = lower(?)").get(name) as { id: string } | undefined;
    if (row && row.id !== exceptId) throw new Error("ENERGYIQ_ROLE_NAME_TAKEN");
  }
}

const requireRoleName = (value: string): string => {
  const name = value.replace(/\s+/gu, " ").trim();
  if (!name) throw new Error("ENERGYIQ_ROLE_NAME_REQUIRED");
  return name.slice(0, 60);
};

const mapRole = (row: unknown): EnergyIqAccessRoleRecord => {
  const record = row as Record<string, unknown>;
  let permissions: unknown = {};
  try { permissions = JSON.parse(String(record.permissions_json)); } catch { /* corrupt row: grants nothing */ }
  return {
    id: String(record.id),
    name: String(record.name),
    description: String(record.description ?? ""),
    builtin: Number(record.builtin) === 1,
    permissions: normaliseRolePermissions(permissions),
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
};

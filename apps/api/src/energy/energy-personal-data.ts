import { randomUUID } from "node:crypto";
import type { MetadataStore } from "@datafoundry/metadata";

import { AuthError } from "../auth/service.js";

/**
 * Personal-data requests under PDPA: a copy of what EnergyX holds about one person, and erasing it.
 *
 * Erasing removes the person's sign-in, memberships, conversations with the advisor, memories, feedback and query
 * history, and blanks their name, email and network details everywhere they appear. Business records they created for
 * a client (projects, imports, saved analyses, reports) stay with the client and keep pointing at the now-anonymous
 * account, so the client's history and audit trail remain complete.
 */

/** Tables that hold one person's own records, keyed by `user_id`. */
const PERSONAL_TABLES = [
  "workspace_memberships",
  "energyiq_user_roles",
  "energyiq_project_access",
  "auth_sessions",
  "auth_audit_events",
  "sessions",
  "conversation_messages",
  "conversation_summaries",
  "long_term_memories",
  "interactions",
  "query_history",
  "energyiq_ai_feedback",
  "energyiq_ai_usage",
  "energyiq_saved_analyses",
  "energyiq_report_schedules"
] as const;

/** What erasing deletes outright, after the person's conversations have gone through the session cascade. */
const ERASED_TABLES = [
  "user_password_credentials",
  "auth_sessions",
  "auth_tokens",
  "workspace_memberships",
  "energyiq_user_roles",
  "energyiq_project_access",
  "conversation_messages",
  "conversation_summaries",
  "long_term_memories",
  "interactions",
  "query_history",
  "model_request_snapshots",
  "context_package_snapshots",
  "energyiq_ai_feedback",
  "config_resources",
  "encrypted_secrets"
] as const;

const SECRET_COLUMN = /hash|secret|token|password|credential/iu;
const MAX_ROWS_PER_TABLE = 50_000;

export type PersonalDataExport = {
  exportedAt: string;
  userId: string;
  records: Record<string, Array<Record<string, unknown>>>;
  truncatedTables: string[];
};

export const exportPersonalData = (metadataStore: MetadataStore, userId: string): PersonalDataExport => {
  const user = metadataStore.users.getById({ user_id: userId });
  const db = metadataStore.db;
  const tables = existingTables(metadataStore);
  const records: PersonalDataExport["records"] = { users: [withoutSecrets({ ...user })] };
  const truncatedTables: string[] = [];
  for (const table of PERSONAL_TABLES) {
    if (!tables.get(table)?.has("user_id")) continue;
    const rows = db.prepare(`SELECT * FROM "${table}" WHERE user_id = ? LIMIT ?`).all(userId, MAX_ROWS_PER_TABLE + 1);
    if (rows.length > MAX_ROWS_PER_TABLE) truncatedTables.push(table);
    records[table] = rows.slice(0, MAX_ROWS_PER_TABLE).map((row) => withoutSecrets(row as Record<string, unknown>));
  }
  return { exportedAt: new Date().toISOString(), userId: user.id, records, truncatedTables };
};

export type PersonalDataErasure = {
  userId: string;
  conversationsDeleted: number;
  rowsDeleted: number;
  auditEventsAnonymised: number;
};

export const erasePersonalData = (input: {
  metadataStore: MetadataStore;
  actorUserId: string;
  userId: string;
  confirmEmail: string;
  env?: Record<string, string | undefined>;
}): PersonalDataErasure => {
  const { metadataStore } = input;
  const user = metadataStore.users.getById({ user_id: input.userId });
  if (user.id === input.actorUserId) {
    throw new AuthError(409, "CONFLICT", "You cannot erase your own account.");
  }
  if (!user.email || input.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new AuthError(400, "BAD_REQUEST", "Type the person's email address exactly to confirm erasure.");
  }
  const adminEmails = (input.env ?? process.env).ENERGYIQ_ADMIN_EMAILS ?? "";
  if (adminEmails.toLowerCase().split(",").map((email) => email.trim()).includes(user.email.toLowerCase())) {
    throw new AuthError(409, "CONFLICT", "Remove this person from ENERGYIQ_ADMIN_EMAILS before erasing them.");
  }

  const db = metadataStore.db;
  const tables = existingTables(metadataStore);
  let conversationsDeleted = 0;
  if (tables.has("sessions")) {
    const sessionIds = db.prepare("SELECT id FROM sessions WHERE user_id = ?").all(user.id)
      .map((row) => (row as { id: string }).id);
    for (const sessionId of sessionIds) {
      // Each delete cascades to the session's runs, events, artifacts, checkpoints and branches.
      conversationsDeleted += metadataStore.sessions.delete({ user_id: user.id, session_id: sessionId }).deletedSessionIds.length;
    }
  }

  let rowsDeleted = 0;
  let auditEventsAnonymised = 0;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of ERASED_TABLES) {
      if (!tables.has(table) || !tables.get(table)!.has("user_id")) continue;
      rowsDeleted += Number(db.prepare(`DELETE FROM "${table}" WHERE user_id = ?`).run(user.id).changes);
    }
    if (tables.has("auth_audit_events")) {
      const columns = tables.get("auth_audit_events")!;
      const blanks = ["email", "ip_address", "user_agent"].filter((column) => columns.has(column));
      if (blanks.length > 0) {
        auditEventsAnonymised = Number(db.prepare(
          `UPDATE auth_audit_events SET ${blanks.map((column) => `${column} = NULL`).join(", ")} WHERE user_id = ?`
        ).run(user.id).changes);
      }
    }
    db.prepare(`UPDATE users
      SET email = ?, display_name = 'Erased user', avatar_url = NULL, dev_token = NULL, email_verified_at = NULL,
          disabled_at = COALESCE(disabled_at, ?), updated_at = ?
      WHERE id = ?`).run(`erased-${user.id}@erased.invalid`, now, now, user.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  metadataStore.authAuditEvents.append({
    id: randomUUID(),
    event_type: "energyiq.user_erased",
    user_id: input.actorUserId,
    metadata: { targetUserId: user.id, conversationsDeleted, rowsDeleted, auditEventsAnonymised }
  });
  return { userId: user.id, conversationsDeleted, rowsDeleted, auditEventsAnonymised };
};

const existingTables = (metadataStore: MetadataStore): Map<string, Set<string>> => {
  const db = metadataStore.db;
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .map((row) => (row as { name: string }).name);
  return new Map(names.map((name) => [
    name,
    new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map((column) => (column as { name: string }).name))
  ]));
};

const withoutSecrets = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([column]) => !SECRET_COLUMN.test(column)));

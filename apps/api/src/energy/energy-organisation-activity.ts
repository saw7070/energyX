import { createSuccessResult } from "@datafoundry/contracts";
import type { AuthAuditEventRecord, MetadataStore, UserRecord, WorkspaceRecord } from "@datafoundry/metadata";

import { AuthError } from "../auth/service.js";
import type { ConfigApiResponse } from "../routes/types.js";
import { auditEventLabel } from "./energy-audit-labels.js";
import { can, resolveEnergyPermissions } from "./energy-permissions.js";
import { SUPPORT_ACCESS_EVENT } from "./energy-support-access.js";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";

/**
 * GET team/activity: the audit trail of one Organisation, for the people who run it (People: write). It holds the
 * events whose details name this Organisation (changes to its projects and settings, its people, AI use, and every
 * time EnergyX support looked at or changed its data) and the sign-in events of its members. Another client's
 * activity never matches, and other clients are never named. `format=csv` downloads every matching event.
 */

const TYPE_FILTERS: Record<string, { categories?: string[]; eventTypes?: string[] }> = {
  "sign-in": { categories: ["auth."] },
  people: { categories: ["energyiq.team_", "energyiq.user_", "energyiq.organisation_"] },
  projects: { categories: ["energyiq.project_", "energyiq.electricity_rate", "energyiq.hours_", "energyiq.policy_", "energyiq.setup_",
    "energyiq.changes_made_live", "energyiq.data_import", "energyiq.live_connection", "energyiq.locations_", "energyiq.analysis_rules",
    "energyiq.overview_layout", "energyiq.budget_carbon", "energyiq.report_"] },
  ai: { categories: ["energyiq.ai_"] },
  support: { eventTypes: [SUPPORT_ACCESS_EVENT] },
};

const PAGE_LIMIT = 500;

export type OrganisationActivityEvent = {
  id: string;
  at: string;
  type: string;
  /** What happened, in plain words. */
  label: string;
  /** The person's name, or their email when they have no name. */
  who?: string;
  email?: string;
  /** Done by EnergyX staff who are not part of this Organisation. */
  support?: true;
  project?: string;
  /** The person the change was made to, when it was not the actor. */
  target?: string;
  /** Only for the Organisation's own people; the network details of EnergyX staff are not shown. */
  ip?: string;
  /** The exact request, for the CSV export. */
  detail?: string;
};

/** Only people who manage this Organisation's members may read its activity. */
const requireActivityAccess = (metadataStore: MetadataStore, actor: UserRecord, workspaceId: string): WorkspaceRecord => {
  let organisation: WorkspaceRecord | undefined;
  try {
    organisation = metadataStore.workspaces.get({ id: workspaceId });
  } catch {
    organisation = undefined;
  }
  const allowed = organisation
    && !actor.disabled_at
    && organisation.kind === "customer"
    && can(resolveEnergyPermissions(metadataStore, actor, organisation.id), "people", "write");
  // Same answer for "no such Organisation" and "not yours", so a caller cannot probe other clients.
  if (!allowed || !organisation) throw new AuthError(403, "FORBIDDEN", "You cannot see this Organisation's activity.");
  return organisation;
};

const timestamp = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
};

const parseMetadata = (event: AuthAuditEventRecord): Record<string, unknown> => {
  try {
    const parsed = event.metadata_json ? JSON.parse(event.metadata_json) as unknown : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const ERASED_EMAIL = /@erased\.invalid$/u;

/** Turns stored events into what the Organisation's admins may see, naming only this Organisation's projects. */
export const organisationActivityShaper = (metadataStore: MetadataStore, organisationId: string) => {
  const members = new Set(metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: organisationId }).map((membership) => membership.user_id));
  const projects = new Map(metadataStore.energyIq.listProjectsByWorkspace(organisationId).map((project) => [project.id, project.name]));
  const users = new Map<string, UserRecord | undefined>();
  const userOf = (id: string): UserRecord | undefined => {
    if (!users.has(id)) {
      try { users.set(id, metadataStore.users.getById({ user_id: id })); } catch { users.set(id, undefined); }
    }
    return users.get(id);
  };
  const platformAdmins = new Map<string, boolean>();
  const isPlatformAdmin = (user: UserRecord): boolean => {
    if (!platformAdmins.has(user.id)) platformAdmins.set(user.id, resolveEnergyIqUserRole(metadataStore, user) === "admin");
    return platformAdmins.get(user.id)!;
  };
  const emailOf = (user: UserRecord | undefined): string | undefined =>
    user?.email && !ERASED_EMAIL.test(user.email) ? user.email : undefined;
  const nameOf = (user: UserRecord | undefined): string | undefined => user?.display_name ?? emailOf(user);

  return (event: AuthAuditEventRecord): OrganisationActivityEvent => {
    const metadata = parseMetadata(event);
    const actor = event.user_id ? userOf(event.user_id) : undefined;
    const member = Boolean(event.user_id && members.has(event.user_id));
    const support = event.event_type === SUPPORT_ACCESS_EVENT || Boolean(actor && !member && isPlatformAdmin(actor));
    // The event's own email is the actor's for a sign-in but the invitee's for an invitation, so prefer the account.
    const email = actor ? emailOf(actor) : event.email;
    const who = actor ? nameOf(actor) : event.email;
    const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
    const project = projectId ? projects.get(projectId) : undefined;
    const targetId = typeof metadata.targetUserId === "string" ? metadata.targetUserId
      : typeof metadata.invitedUserId === "string" ? metadata.invitedUserId : undefined;
    const target = targetId && targetId !== event.user_id ? nameOf(userOf(targetId)) ?? "Erased user" : undefined;
    return {
      id: event.id,
      at: event.created_at,
      type: event.event_type,
      label: auditEventLabel(event.event_type, metadata),
      ...(who ? { who } : {}),
      ...(email ? { email } : {}),
      ...(support ? { support: true as const } : {}),
      ...(project ? { project } : {}),
      ...(target ? { target } : {}),
      ...(event.ip_address && !support ? { ip: event.ip_address } : {}),
      ...(typeof metadata.action === "string" ? { detail: metadata.action } : {}),
    };
  };
};

/** A CSV file that opens cleanly in Excel: a byte-order mark, quoted cells, and no cell that Excel would run as a formula. */
export const csvBody = (rows: string[][]): Buffer => {
  const cell = (raw: string) => {
    const value = /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
  };
  return Buffer.from(`\ufeff${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`, "utf8");
};

export const organisationActivityResponse = (
  metadataStore: MetadataStore,
  actor: UserRecord,
  workspaceId: string,
  params: URLSearchParams,
  options: { pageSize?: number } = {},
): ConfigApiResponse => {
  const organisation = requireActivityAccess(metadataStore, actor, workspaceId);
  const from = timestamp(params.get("from"));
  const to = timestamp(params.get("to"));
  const person = params.get("person")?.trim();
  const filter = {
    organisationId: organisation.id,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(person ? { userId: person } : {}),
    ...(TYPE_FILTERS[params.get("type") ?? ""] ?? {}),
  };
  const shape = organisationActivityShaper(metadataStore, organisation.id);
  const headers = { "Cache-Control": "private, no-store" };

  if (params.get("format") === "csv") {
    const rows: string[][] = [["When (UTC)", "Who", "Email", "What", "Project", "Affected", "IP address", "Event type", "Technical detail"]];
    // Every matching event, page by page, however many there are.
    let before: string | undefined;
    do {
      const page = metadataStore.authAuditEvents.list({ ...filter, limit: options.pageSize ?? PAGE_LIMIT, ...(before ? { before } : {}) });
      for (const event of page.events.map(shape)) {
        rows.push([
          event.at,
          event.support ? `${event.who ?? "Unknown"} (EnergyX support)` : event.who ?? "",
          event.email ?? "",
          event.label,
          event.project ?? "",
          event.target ?? "",
          event.ip ?? "",
          event.type,
          event.detail ?? "",
        ]);
      }
      before = page.next;
    } while (before);
    const slug = organisation.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "organisation";
    return {
      status: 200,
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-activity.csv"` },
      body: csvBody(rows),
    };
  }

  const limit = Number(params.get("limit") ?? 100);
  const before = params.get("before");
  const page = metadataStore.authAuditEvents.list({
    ...filter,
    limit: Number.isFinite(limit) ? limit : 100,
    ...(before ? { before } : {}),
  });
  return {
    status: 200,
    headers,
    body: createSuccessResult({
      organisation: { id: organisation.id, name: organisation.name },
      events: page.events.map(shape),
      ...(page.next ? { next: page.next } : {}),
    }),
  };
};

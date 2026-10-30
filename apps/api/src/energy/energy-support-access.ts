import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { MetadataStore } from "@datafoundry/metadata";

import { clientIpAddress } from "../client-ip.js";
import { changeEventFor } from "./energy-change-audit.js";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";

/**
 * Support access transparency. Platform super admins can open every client's data; when one who is not a member of
 * an Organisation reads or changes that Organisation's data through /api/v1/energy, an `energyiq.support_access`
 * event is recorded, and the Organisation's admins see it on their Activity page. Each change is recorded; reads
 * are recorded at most once an hour per admin and Organisation, which is enough to say "support looked at your data
 * at 10:05" without one row per page load.
 *
 * The admin console's own routes (organisations, users, roles, audit, system health) are platform work and record
 * their own, more specific events; the access list that every page loads to draw the menu is not client data.
 */

export const SUPPORT_ACCESS_EVENT = "energyiq.support_access";
const READ_DEDUPE_MS = 60 * 60 * 1000;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** POSTs that only look at data: running an analysis, resolving what a question covers, checking a setup or connection. */
const READ_ONLY_POSTS: ReadonlyArray<(segments: string[]) => boolean> = [
  (s) => s[0] === "query-context" && s[1] === "resolve",
  (s) => s[0] === "analysis" && (s[1] === "execute" || s[1] === "resolve"),
  (s) => s[0] === "projects" && s[2] === "setup" && s[3] === "validate",
  (s) => s[0] === "projects" && s[2] === "live-connection" && s[3] === "check",
];

export const supportAccessKind = (segments: string[], method: string): "read" | "change" => {
  if (READ_METHODS.has(method)) return "read";
  if (changeEventFor(segments, method)) return "change";
  return method === "POST" && READ_ONLY_POSTS.some((matches) => matches(segments)) ? "read" : "change";
};

const NOT_CLIENT_DATA = new Set(["admin", "access-context"]);

const projectIdOf = (segments: string[]): string | undefined => {
  if (segments[0] !== "projects" || !segments[1]) return undefined;
  try {
    return decodeURIComponent(segments[1]);
  } catch {
    return undefined;
  }
};

/** The Organisation whose data the request touched: the project's own, or the one the request was made in. */
const organisationOf = (metadataStore: MetadataStore, segments: string[], workspaceId: string): string | undefined => {
  const projectId = projectIdOf(segments);
  if (projectId) {
    try {
      return metadataStore.energyIq.getProject(projectId).workspace_id;
    } catch {
      return undefined;
    }
  }
  return workspaceId || undefined;
};

export const recordSupportAccess = (input: {
  metadataStore: MetadataStore;
  request: IncomingMessage;
  segments: string[];
  userId: string;
  workspaceId: string;
  status: number;
  env?: Record<string, string | undefined>;
  now?: Date;
}): void => {
  const { metadataStore, segments } = input;
  if (input.status >= 400 || NOT_CLIENT_DATA.has(segments[0] ?? "")) return;
  const method = (input.request.method ?? "GET").toUpperCase();
  try {
    const user = metadataStore.users.getById({ user_id: input.userId });
    if (resolveEnergyIqUserRole(metadataStore, user, input.env) !== "admin") return;
    const organisationId = organisationOf(metadataStore, segments, input.workspaceId);
    if (!organisationId) return;
    let organisation;
    try {
      organisation = metadataStore.workspaces.get({ id: organisationId });
    } catch {
      return;
    }
    if (organisation.kind !== "customer") return;
    if (metadataStore.workspaceMemberships.find({ workspace_id: organisation.id, user_id: user.id })) return;

    const access = supportAccessKind(segments, method);
    const projectId = projectIdOf(segments);
    const ip = clientIpAddress(input.request, input.env);
    const userAgent = input.request.headers["user-agent"];
    const event = {
      id: randomUUID(),
      event_type: SUPPORT_ACCESS_EVENT,
      user_id: user.id,
      ...(user.email ? { email: user.email } : {}),
      ...(ip ? { ip_address: ip } : {}),
      ...(typeof userAgent === "string" ? { user_agent: userAgent.slice(0, 300) } : {}),
      metadata: {
        workspaceId: organisation.id,
        access,
        ...(projectId ? { projectId } : {}),
        action: `${method} ${segments.join("/")}`,
      },
    };
    if (access === "change") {
      metadataStore.authAuditEvents.append(event);
      return;
    }
    const since = new Date((input.now ?? new Date()).getTime() - READ_DEDUPE_MS).toISOString();
    const recorded = () => metadataStore.authAuditEvents.existsSince({
      user_id: user.id,
      event_type: SUPPORT_ACCESS_EVENT,
      since,
      metadata: { workspaceId: organisation.id, access: "read" },
    });
    // Checked once without the write lock so that the usual case, already recorded this hour, writes nothing.
    if (recorded()) return;
    metadataStore.authAuditEvents.appendUnless(recorded, event);
  } catch (error) {
    // A missing audit row must never fail a request that already succeeded.
    console.warn(`[audit] could not record support access: ${error instanceof Error ? error.message : "unknown"}`);
  }
};

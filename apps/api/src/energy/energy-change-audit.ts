import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { MetadataStore } from "@datafoundry/metadata";

/**
 * Records who changed a project's settings or data, and when, so an administrator can answer "who changed what".
 * Every successful change to the areas below is written to the same audit log as sign-ins and access changes.
 * Reads, failed attempts and the admin routes (which record their own, more detailed events) are left out.
 */
const CHANGE_EVENTS: Array<{ match: (segments: string[], method: string) => boolean; event: string }> = [
  { match: (s, m) => s[0] === "projects" && s.length === 1 && m === "POST", event: "energyiq.project_created" },
  { match: (s) => s[0] === "projects" && s[2] === "operational-policies" && s[3] === "tariff", event: "energyiq.electricity_rate_published" },
  { match: (s) => s[0] === "projects" && s[2] === "operational-policies" && s[3] === "calendar", event: "energyiq.hours_holidays_published" },
  { match: (s) => s[0] === "projects" && s[2] === "operational-policies" && s[3] === "select", event: "energyiq.policy_version_selected" },
  { match: (s) => s[0] === "projects" && s[2] === "setup" && s[3] === "publish", event: "energyiq.setup_published" },
  { match: (s) => s[0] === "projects" && s[2] === "setup" && s[3] === "apply", event: "energyiq.changes_made_live" },
  { match: (s) => s[0] === "projects" && s[2] === "setup" && s[3] === undefined, event: "energyiq.setup_draft_saved" },
  { match: (s) => s[0] === "projects" && s[2] === "imports", event: "energyiq.data_import_changed" },
  { match: (s) => s[0] === "projects" && s[2] === "live-connection", event: "energyiq.live_connection_changed" },
  { match: (s) => s[0] === "projects" && s[2] === "hierarchy", event: "energyiq.locations_changed" },
  { match: (s) => s[0] === "projects" && (s[2] === "rule-config" || s[2] === "metric-config"), event: "energyiq.analysis_rules_changed" },
  { match: (s) => s[0] === "projects" && (s[2] === "template-draft" || s[2] === "published-template" || s[2] === "overview-lifecycle"), event: "energyiq.overview_layout_changed" },
  { match: (s) => s[0] === "projects" && s[2] === "targets", event: "energyiq.budget_carbon_changed" },
  { match: (s) => s[0] === "report-schedules" && s[2] === "send", event: "energyiq.report_email_sent" },
  { match: (s) => s[0] === "report-schedules", event: "energyiq.report_schedule_changed" },
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const changeEventFor = (segments: string[], method: string): string | null => {
  if (!MUTATING.has(method) || segments[0] === "admin") return null;
  return CHANGE_EVENTS.find((candidate) => candidate.match(segments, method))?.event ?? null;
};

export const recordEnergyChange = (input: {
  metadataStore: MetadataStore;
  request: IncomingMessage;
  segments: string[];
  userId: string;
  workspaceId: string;
  status: number;
}): void => {
  const method = (input.request.method ?? "GET").toUpperCase();
  if (input.status >= 400) return;
  const event = changeEventFor(input.segments, method);
  if (!event) return;
  const forwarded = input.request.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || input.request.socket?.remoteAddress;
  const userAgent = input.request.headers["user-agent"];
  try {
    const user = input.metadataStore.users.getById({ user_id: input.userId });
    input.metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: event,
      user_id: input.userId,
      ...(user.email ? { email: user.email } : {}),
      ...(ip ? { ip_address: ip } : {}),
      ...(typeof userAgent === "string" ? { user_agent: userAgent.slice(0, 300) } : {}),
      metadata: {
        workspaceId: input.workspaceId,
        ...(input.segments[0] === "projects" && input.segments[1] ? { projectId: decodeURIComponent(input.segments[1]) } : {}),
        action: `${method} ${input.segments.join("/")}`,
      },
    });
  } catch (error) {
    // A missing audit row must never undo or fail a change that already succeeded.
    console.warn(`[audit] could not record ${event}: ${error instanceof Error ? error.message : "unknown"}`);
  }
};

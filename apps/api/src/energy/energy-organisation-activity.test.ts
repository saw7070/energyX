import { createMetadataStore, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID, type MetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "../auth/service.js";
import { handleConfigApiRequest } from "../config-api.js";
import type { ConfigApiContext } from "../routes/types.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { recordEnergyChange } from "./energy-change-audit.js";
import { organisationActivityResponse, type OrganisationActivityEvent } from "./energy-organisation-activity.js";
import { recordSupportAccess, supportAccessKind } from "./energy-support-access.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const request = (method: string, url = "/", headers: Record<string, string> = {}): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, { method, url, headers, socket: { remoteAddress: "198.51.100.20" } });
  stream.end();
  return stream as unknown as IncomingMessage;
};

/**
 * Two clients, Elite and Other. Each has an Organisation admin, Elite also a Viewer. The platform super admin
 * ("dev-user") belongs to neither, so whatever it does there is support access.
 */
const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-org-activity-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanups.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  ensureEnergyIqBootstrap(metadata);
  const auth = new AuthService(metadata, { mode: "password", publicBaseUrl: "http://127.0.0.1:3001", sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters", emailDelivery: "test" });
  const admin = new EnergyAdminAccessService(metadata, auth);
  const elite = admin.createOrganisation({ actorUserId: "dev-user", name: "Elite IOT" });
  const other = admin.createOrganisation({ actorUserId: "dev-user", name: "Other Client" });
  const invite = async (email: string, organisationId: string, roleId?: string) => (await admin.inviteUser({
    actorUserId: "dev-user", email, organisationIds: [organisationId], role: "user",
    ...(roleId ? { organisationRoles: { [organisationId]: roleId } } : {}),
  })).user.id;
  const eliteAdmin = await invite("boss@elite.test", elite.id, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID);
  const eliteViewer = await invite("viewer@elite.test", elite.id);
  const otherAdmin = await invite("boss@other.test", other.id, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID);
  metadata.energyIq.upsertProject({ id: "elite-site", workspace_id: elite.id, name: "KL office", status: "published" });
  metadata.energyIq.upsertProject({ id: "other-site", workspace_id: other.id, name: "Penang plant", status: "published" });
  const context = { metadataStore: metadata, authService: auth, userId: "dev-user", workspaceId: elite.id } as Required<ConfigApiContext>;
  const user = (id: string) => metadata.users.getById({ user_id: id });
  return { metadata, admin, elite, other, eliteAdmin, eliteViewer, otherAdmin, context, user };
};

const activity = (metadata: MetadataStore, actor: ReturnType<MetadataStore["users"]["getById"]>, workspaceId: string, query = "", pageSize?: number) =>
  organisationActivityResponse(metadata, actor, workspaceId, new URLSearchParams(query), pageSize ? { pageSize } : {});
const events = (response: ReturnType<typeof organisationActivityResponse>) =>
  (response.body as { data: { events: OrganisationActivityEvent[]; next?: string } }).data;

const change = (metadata: MetadataStore, userId: string, workspaceId: string, projectId: string) => recordEnergyChange({
  metadataStore: metadata,
  request: request("POST"),
  segments: ["projects", projectId, "operational-policies", "tariff"],
  userId, workspaceId, status: 201,
});

describe("Organisation Activity", () => {
  it("shows an Organisation's admins its own changes, people and sign-ins, and nothing of any other client", async () => {
    const { metadata, elite, other, eliteAdmin, eliteViewer, otherAdmin, user } = await setup();
    change(metadata, eliteAdmin, elite.id, "elite-site");
    change(metadata, otherAdmin, other.id, "other-site");
    metadata.authAuditEvents.append({ id: "viewer-in", event_type: "auth.login_succeeded", user_id: eliteViewer, email: "viewer@elite.test", ip_address: "203.0.113.5" });
    metadata.authAuditEvents.append({ id: "other-in", event_type: "auth.login_succeeded", user_id: otherAdmin, email: "boss@other.test", ip_address: "203.0.113.6" });
    metadata.authAuditEvents.append({ id: "other-ai", event_type: "energyiq.ai_used", user_id: otherAdmin, metadata: { workspaceId: other.id, feature: "advisor" } });
    metadata.authAuditEvents.append({ id: "other-mfa", event_type: "auth.mfa_enabled", user_id: otherAdmin });
    metadata.authAuditEvents.append({ id: "moved-away", event_type: "energyiq.project_moved", user_id: "dev-user", metadata: { projectId: "x", fromWorkspaceId: other.id, toWorkspaceId: "organisation-third" } });
    // Someone in both clients inviting a person into the other one: that client's own event names it, not this one.
    metadata.authAuditEvents.append({ id: "invite-elsewhere", event_type: "auth.invitation_created", user_id: eliteAdmin, email: "newbie@other.test", metadata: { invitedUserId: otherAdmin, inviterUserId: eliteAdmin } });

    const page = events(activity(metadata, user(eliteAdmin), elite.id, "limit=100"));
    const ids = page.events.map((event) => event.id);
    expect(ids).toContain("viewer-in");
    expect(ids).not.toContain("other-in");
    expect(ids).not.toContain("other-ai");
    expect(ids).not.toContain("other-mfa");
    expect(ids).not.toContain("moved-away");
    expect(ids).not.toContain("invite-elsewhere");
    const all = JSON.stringify(page);
    expect(all).not.toContain("Other Client");
    expect(all).not.toContain("Penang plant");
    expect(all).not.toContain("boss@other.test");

    const tariff = page.events.find((event) => event.type === "energyiq.electricity_rate_published")!;
    expect(tariff).toMatchObject({ label: "Changed the electricity rate", email: "boss@elite.test", project: "KL office", ip: "198.51.100.20" });
    expect(tariff.support).toBeUndefined();
    // The platform admin who invited Elite's people is EnergyX support from Elite's point of view.
    const invited = page.events.find((event) => event.type === "energyiq.user_access_assigned" && event.target === "viewer@elite.test")!;
    expect(invited).toMatchObject({ label: "Gave a user access", support: true });
    expect(invited.ip).toBeUndefined();

    // And the other way round: Other's admin never sees Elite.
    const theirs = JSON.stringify(events(activity(metadata, user(otherAdmin), other.id, "limit=100")));
    expect(theirs).not.toContain("viewer-in");
    expect(theirs).not.toContain("KL office");
    expect(theirs).toContain("other-mfa");
  });

  it("is only for people who manage the Organisation's members", async () => {
    const { metadata, elite, other, eliteAdmin, eliteViewer, user, context } = await setup();
    expect(() => activity(metadata, user(eliteViewer), elite.id)).toThrow("You cannot see this Organisation's activity.");
    expect(() => activity(metadata, user(eliteAdmin), other.id)).toThrow("You cannot see this Organisation's activity.");
    const refused = await handleEnergyApiRequest(request("GET", "/api/v1/energy/team/activity"), ["team", "activity"], { ...context, userId: eliteAdmin, workspaceId: other.id });
    expect(refused.status).toBe(403);
    const allowed = await handleEnergyApiRequest(request("GET", "/api/v1/energy/team/activity?type=people"), ["team", "activity"], { ...context, userId: eliteAdmin });
    expect(allowed.status).toBe(200);
    expect(events(allowed as ReturnType<typeof organisationActivityResponse>).events.every((event) => event.type.startsWith("energyiq.user_") || event.type.startsWith("energyiq.team_") || event.type.startsWith("energyiq.organisation_"))).toBe(true);
  });

  it("filters by date range, person and type", async () => {
    const { metadata, elite, eliteAdmin, eliteViewer, user } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
    metadata.authAuditEvents.append({ id: "sept", event_type: "auth.login_succeeded", user_id: eliteViewer });
    vi.setSystemTime(new Date("2026-10-15T10:00:00.000Z"));
    metadata.authAuditEvents.append({ id: "oct-viewer", event_type: "auth.login_succeeded", user_id: eliteViewer });
    metadata.authAuditEvents.append({ id: "oct-admin", event_type: "auth.login_succeeded", user_id: eliteAdmin });
    change(metadata, eliteAdmin, elite.id, "elite-site");

    const october = events(activity(metadata, user(eliteAdmin), elite.id, "from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z&type=sign-in")).events;
    expect(october.map((event) => event.id).sort()).toEqual(["oct-admin", "oct-viewer"]);
    const viewer = events(activity(metadata, user(eliteAdmin), elite.id, `person=${eliteViewer}`)).events;
    expect(viewer.map((event) => event.id)).toEqual(["oct-viewer", "sept"]);
    expect(viewer[0]).toMatchObject({ label: "Signed in", who: "viewer@elite.test" });
    const projects = events(activity(metadata, user(eliteAdmin), elite.id, "type=projects")).events;
    expect(projects.map((event) => event.type)).toEqual(["energyiq.electricity_rate_published"]);
  });

  it("downloads every matching event as CSV, well beyond 10,000 rows, without other clients' rows", async () => {
    const { metadata, elite, other, eliteAdmin, user } = await setup();
    metadata.db.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < 10_050; index += 1) {
      metadata.authAuditEvents.append({ id: `bulk-${String(index).padStart(5, "0")}`, event_type: "energyiq.ai_used", user_id: eliteAdmin, metadata: { workspaceId: elite.id, feature: "advisor" } });
    }
    metadata.authAuditEvents.append({ id: "other-only", event_type: "energyiq.ai_used", metadata: { workspaceId: other.id, name: "=HYPERLINK(\"x\")" } });
    metadata.db.exec("COMMIT");
    metadata.authAuditEvents.append({ id: "formula", event_type: "energyiq.organisation_updated", user_id: "dev-user", metadata: { organisationId: elite.id, action: "=cmd|' /C calc'!A0" } });

    const csv = activity(metadata, user(eliteAdmin), elite.id, "format=csv");
    expect(csv.headers?.["Content-Disposition"]).toBe("attachment; filename=\"elite-iot-activity.csv\"");
    const lines = (csv.body as Buffer).toString("utf8").trimEnd().split("\r\n");
    expect(lines[0]).toBe("\ufeffWhen (UTC),Who,Email,What,Project,Affected,IP address,Event type,Technical detail");
    const bulkRows = lines.filter((line) => line.includes(",Used AI,"));
    expect(bulkRows).toHaveLength(10_050);
    expect(lines.some((line) => line.includes("Other Client") || line.includes("HYPERLINK"))).toBe(false);
    // A value that Excel would run as a formula is written as text.
    expect(lines.find((line) => line.includes("organisation_updated"))).toContain(",'=cmd|' /C calc'!A0");
    expect(lines.find((line) => line.includes("organisation_updated"))).toContain("(EnergyX support)");

    // Small pages give exactly the same file.
    const paged = activity(metadata, user(eliteAdmin), elite.id, "format=csv", 997);
    expect((paged.body as Buffer).equals(csv.body as Buffer)).toBe(true);
  }, 60_000);
});

describe("Support access transparency", () => {
  it("records a super admin's look at a client's data once an hour, and every change", async () => {
    const { metadata, elite, other, eliteAdmin, user } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T09:00:00.000Z"));
    const look = (segments: string[], workspaceId = elite.id, method = "GET", status = 200) => recordSupportAccess({
      metadataStore: metadata, request: request(method, "/", { "user-agent": "Browser" }), segments, userId: "dev-user", workspaceId, status,
    });
    const supportEvents = () => metadata.authAuditEvents.list({ eventTypes: ["energyiq.support_access"], limit: 50 }).events
      .map((event) => JSON.parse(event.metadata_json!) as { workspaceId: string; access: string; action: string });

    look(["projects", "elite-site", "overview"]);
    vi.setSystemTime(new Date("2026-10-30T09:20:00.000Z"));
    look(["projects", "elite-site", "explorer"]);
    look(["team"]);
    look(["projects", "other-site", "overview"], elite.id); // the project decides: this is Other's data
    expect(supportEvents().map((event) => [event.workspaceId, event.access]).sort()).toEqual([[elite.id, "read"], [other.id, "read"]]);

    look(["projects", "elite-site", "operational-policies", "tariff"], elite.id, "POST", 201);
    look(["projects", "elite-site", "operational-policies", "tariff"], elite.id, "POST", 201);
    look(["projects", "elite-site", "operational-policies", "tariff"], elite.id, "POST", 403); // refused: nothing happened
    expect(supportEvents().filter((event) => event.access === "change")).toHaveLength(2);

    vi.setSystemTime(new Date("2026-10-30T10:01:00.000Z"));
    look(["portfolio"]);
    expect(supportEvents().filter((event) => event.workspaceId === elite.id && event.access === "read")).toHaveLength(2);

    // The admin console and the menu's access list are not a client's data; members are not "support".
    look(["admin", "organisations"]);
    look(["access-context"]);
    recordSupportAccess({ metadataStore: metadata, request: request("GET"), segments: ["team"], userId: eliteAdmin, workspaceId: elite.id, status: 200 });
    expect(supportEvents()).toHaveLength(5);

    const seen = events(activity(metadata, user(eliteAdmin), elite.id, "type=support")).events;
    expect(seen.map((event) => event.label)).toEqual([
      "EnergyX support looked at your data",
      "EnergyX support changed your data",
      "EnergyX support changed your data",
      "EnergyX support looked at your data",
    ]);
    expect(seen[1]).toMatchObject({ support: true, who: "EnergyIQ Admin", project: "KL office", detail: "POST projects/elite-site/operational-policies/tariff" });
    expect(seen[1]!.ip).toBeUndefined();
  });

  it("treats looking-only POSTs as reads and anything else that writes as a change", () => {
    expect(supportAccessKind(["analysis", "execute"], "POST")).toBe("read");
    expect(supportAccessKind(["projects", "p", "setup", "validate"], "POST")).toBe("read");
    expect(supportAccessKind(["projects", "p", "setup", "publish"], "POST")).toBe("change");
    expect(supportAccessKind(["projects", "p", "saved-analyses"], "POST")).toBe("change");
    expect(supportAccessKind(["team", "users", "u"], "DELETE")).toBe("change");
  });

  it("is recorded for real requests through the API, and not for the client's own members", async () => {
    const { metadata, elite, eliteAdmin, context } = await setup();
    const call = (userId: string) => handleConfigApiRequest(request("GET", "/api/v1/energy/team"), "/api/v1/energy/team", { ...context, userId });
    expect((await call("dev-user"))?.status).toBe(200);
    expect((await call("dev-user"))?.status).toBe(200);
    expect((await call(eliteAdmin))?.status).toBe(200);
    const recorded = metadata.authAuditEvents.list({ eventTypes: ["energyiq.support_access"], limit: 10 }).events;
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ user_id: "dev-user", ip_address: "198.51.100.20" });
    expect(JSON.parse(recorded[0]!.metadata_json!)).toEqual({ workspaceId: elite.id, access: "read", action: "GET team" });
  });
});

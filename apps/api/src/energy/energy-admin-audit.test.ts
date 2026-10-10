import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, NGEE_ANN_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { recordEnergyChange } from "./energy-change-audit.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

const get = (url: string): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, { method: "GET", url, headers: {} });
  stream.end();
  return stream as unknown as IncomingMessage;
};

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "energy-admin-audit-"));
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    dev_user: { id: "dev-user", email: "admin@energyiq.local", display_name: "Admin", dev_token: "dev-token" },
  });
  cleanups.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  ensureEnergyIqBootstrap(metadata);
  const context = { metadataStore: metadata, userId: "dev-user", workspaceId: NGEE_ANN_WORKSPACE_ID } as Required<ConfigApiContext>;
  return { metadata, context };
};

describe("Audit history for super admins", () => {
  it("lists who changed a project's settings, newest first, filtered and paged, and downloads them as CSV", async () => {
    const { metadata, context } = setup();
    metadata.authAuditEvents.append({ id: "a1", event_type: "auth.login_succeeded", user_id: "dev-user" });
    const change = Object.assign(new PassThrough(), { method: "POST", headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Test" } }) as unknown as IncomingMessage;
    recordEnergyChange({
      metadataStore: metadata, request: change, segments: ["projects", "ngee-ann-polytechnic", "operational-policies", "tariff"],
      userId: "dev-user", workspaceId: NGEE_ANN_WORKSPACE_ID, status: 201,
    });
    recordEnergyChange({
      metadataStore: metadata, request: change, segments: ["projects", "ngee-ann-polytechnic", "operational-policies", "tariff"],
      userId: "dev-user", workspaceId: NGEE_ANN_WORKSPACE_ID, status: 403,
    });

    const projects = await handleEnergyApiRequest(get("/api/v1/energy/admin/audit?category=projects"), ["admin", "audit"], context);
    expect(projects.status).toBe(200);
    const events = (projects.body as { data: { events: Array<Record<string, unknown>> } }).data.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "energyiq.electricity_rate_published", ip: "203.0.113.9", project: "Ngee Ann Polytechnic", action: "POST projects/ngee-ann-polytechnic/operational-policies/tariff" });

    const firstPage = await handleEnergyApiRequest(get("/api/v1/energy/admin/audit?limit=1"), ["admin", "audit"], context);
    const page = (firstPage.body as { data: { events: Array<{ type: string }>; next?: string } }).data;
    expect(page.events).toHaveLength(1);
    expect(page.next).toBeTruthy();
    const secondPage = await handleEnergyApiRequest(get(`/api/v1/energy/admin/audit?limit=1&before=${encodeURIComponent(page.next!)}`), ["admin", "audit"], context);
    const rest = (secondPage.body as { data: { events: Array<{ type: string }>; next?: string } }).data;
    // Two pages of one cover both events once each, and there is no third page.
    expect([page.events[0]!.type, rest.events[0]!.type].sort()).toEqual(["auth.login_succeeded", "energyiq.electricity_rate_published"]);
    expect(rest.next).toBeUndefined();

    const csv = await handleEnergyApiRequest(get("/api/v1/energy/admin/audit?format=csv"), ["admin", "audit"], context);
    expect(csv.headers?.["Content-Type"]).toContain("text/csv");
    const text = (csv.body as Buffer).toString("utf8");
    expect(text).toContain("When (UTC),Who,What,Affected,Organisation,Project,IP address,Details");
    expect(text).toContain("energyiq.electricity_rate_published");
  });

  it("is refused to anyone who is not a super admin", async () => {
    const { metadata, context } = setup();
    const member = metadata.users.createPasswordUser({ id: "viewer-1", email: "viewer@example.test", display_name: "Viewer" });
    const response = await handleEnergyApiRequest(get("/api/v1/energy/admin/audit"), ["admin", "audit"], { ...context, userId: member.id });
    expect(response.status).toBe(403);
  });
});

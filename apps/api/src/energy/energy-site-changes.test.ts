import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { recordEnergyChange } from "./energy-change-audit.js";
import { readEnergyProjectInformation } from "./energy-project-information.js";

/**
 * Changes recorded on site for their before and after (Facility → Savings): who may record, edit and remove one, the
 * audit entry each leaves, and how they reach the project information the reports and Analysis read.
 */
const PROJECT = "ngee-ann-polytechnic";
type Check = { id: string; name: string; changeDate: string; meterIds: string[]; note?: string };
type View = { checks: Check[]; canEdit: boolean };

const request = (method: string, url: string, body?: unknown): IncomingMessage => {
  const stream = new PassThrough() as PassThrough & IncomingMessage;
  stream.method = method;
  stream.url = url;
  stream.headers = body === undefined ? {} : { "content-type": "application/json" };
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream;
};

describe("changes recorded on site", () => {
  let root: string;
  let metadata: ReturnType<typeof createMetadataStore>;
  const call = async (userId: string, method: string, segments: string[], body?: unknown) => {
    const context = { metadataStore: metadata, userId, workspaceId: "default" } as unknown as Required<ConfigApiContext>;
    const incoming = request(method, `/api/v1/energy/${segments.join("/")}`, body);
    const response = await handleEnergyApiRequest(incoming, segments, context);
    recordEnergyChange({ metadataStore: metadata, request: incoming, segments, userId, workspaceId: "default", status: response.status });
    return { status: response.status, data: (response.body as { data?: View }).data };
  };
  const path = (...rest: string[]) => ["projects", PROJECT, "savings-checks", ...rest];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "site-changes-"));
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    // A viewer (the default role), someone who edits only the project notes, and someone who edits only the Facility's structure.
    metadata.energyIq.roles.create({ id: "role-notes", name: "Notes editor", permissions: { reports: "read", notes: "write" } });
    metadata.energyIq.roles.create({ id: "role-facility", name: "Facility editor", permissions: { reports: "read", facility: "write" } });
    for (const [id, role] of [["viewer", null], ["notes", "role-notes"], ["facility", "role-facility"]] as const) {
      metadata.users.createPasswordUser({ id, email: `${id}@example.test` });
      metadata.workspaceMemberships.upsert({ workspace_id: "default", user_id: id, role: "member" });
      metadata.db.prepare("UPDATE workspace_memberships SET role_id = ? WHERE workspace_id = 'default' AND user_id = ?").run(role, id);
    }
  });
  afterEach(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });

  it("lets people who may change the Facility page record, edit and remove a change, with an audit entry for each", async () => {
    const created = await call("facility", "POST", path(), { name: "Smart lighting: 30% night dimming", changeDate: "2026-12-01", meterIds: [], note: "Charles installs" });
    expect(created.status).toBe(200);
    expect(created.data!.canEdit).toBe(true);
    const [check] = created.data!.checks;
    expect(check).toMatchObject({ name: "Smart lighting: 30% night dimming", changeDate: "2026-12-01", meterIds: [], note: "Charles installs" });

    const edited = await call("notes", "PUT", path(check!.id), { name: "Smart lighting", changeDate: "2026-12-02", meterIds: ["m1"] });
    expect(edited.status).toBe(200);
    expect(edited.data!.checks).toEqual([expect.objectContaining({ id: check!.id, name: "Smart lighting", changeDate: "2026-12-02", meterIds: ["m1"] })]);
    expect(edited.data!.checks[0]).not.toHaveProperty("note");
    expect((await call("notes", "PUT", path(check!.id), { name: " ", changeDate: "2026-12-02" })).status).toBe(400);
    expect((await call("notes", "PUT", path("missing"), { name: "x", changeDate: "2026-12-02" })).status).toBe(404);

    // A super admin may too.
    expect((await call("dev-user", "PUT", path(check!.id), { name: "Smart lighting", changeDate: "2026-12-01", meterIds: [] })).status).toBe(200);
    const removed = await call("facility", "DELETE", path(check!.id));
    expect(removed.data!.checks).toEqual([]);

    const events = metadata.db.prepare("SELECT event_type, user_id FROM auth_audit_events WHERE event_type LIKE 'energyiq.site_change_%' ORDER BY rowid").all() as Array<{ event_type: string; user_id: string }>;
    expect(events.map(event => [event.event_type, event.user_id])).toEqual([
      ["energyiq.site_change_recorded", "facility"], ["energyiq.site_change_edited", "notes"], ["energyiq.site_change_edited", "dev-user"], ["energyiq.site_change_removed", "facility"],
    ]);
  });

  it("shows a viewer the changes but refuses to let them record, edit or remove one", async () => {
    await call("facility", "POST", path(), { name: "LED fittings", changeDate: "2026-11-01" });
    const view = await call("viewer", "GET", path());
    expect(view.data).toMatchObject({ canEdit: false, checks: [{ name: "LED fittings" }] });
    const id = view.data!.checks[0]!.id;
    expect((await call("viewer", "POST", path(), { name: "x", changeDate: "2026-11-01" })).status).toBe(403);
    expect((await call("viewer", "PUT", path(id), { name: "x", changeDate: "2026-11-01" })).status).toBe(403);
    expect((await call("viewer", "DELETE", path(id))).status).toBe(403);
    expect((await call("facility", "GET", path())).data!.checks).toHaveLength(1);
  });

  it("hands the changes to the reports and Analysis with the project information, newest first", async () => {
    await call("facility", "POST", path(), { name: "Timer moved", changeDate: "2026-10-01", meterIds: ["m1"] });
    await call("facility", "POST", path(), { name: "Smart lighting", changeDate: "2026-12-01", note: "30% at night" });
    const information = readEnergyProjectInformation(metadata, "viewer", "default", PROJECT);
    expect(information.changes).toEqual([
      expect.objectContaining({ title: "Smart lighting", date: "2026-12-01", note: "30% at night", meterIds: [] }),
      expect.objectContaining({ title: "Timer moved", date: "2026-10-01", meterIds: ["m1"] }),
    ]);
    expect(information.changes[1]).not.toHaveProperty("note");
  });
});

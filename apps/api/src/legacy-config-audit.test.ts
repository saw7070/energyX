import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { handleConfigApiRequest, type ConfigApiContext } from "./config-api.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });

const fixture = (role: "admin" | "user") => {
  const root = mkdtempSync(join(tmpdir(), "legacy-config-audit-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  metadata.users.createPasswordUser({ id: "member", email: "member@client.test" });
  metadata.energyIq.upsertUserRole({ user_id: "member", role });
  const context = { metadataStore: metadata, userId: "member", workspaceId: "w" } as ConfigApiContext;
  const call = (method: string, path: string, body: unknown = {}) => {
    const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    request.method = method;
    request.headers = { "content-type": "application/json", "user-agent": "Console" };
    Object.assign(request, { socket: { remoteAddress: "198.51.100.30" } });
    return handleConfigApiRequest(request, `/api/v1/${path}`, context);
  };
  const recorded = () => metadata.authAuditEvents.list({ eventTypes: ["energyiq.platform_config_changed"], limit: 20 }).events;
  return { metadata, call, recorded };
};

describe("audit of platform configuration changes", () => {
  it("records each successful change a platform administrator makes, with who, from where and what", async () => {
    const { call, recorded } = fixture("admin");
    expect((await call("POST", "mcp-servers", { id: "remote", name: "Remote", transport: "streamable-http", serverUrl: "https://mcp.example.test/mcp" }))?.status).toBe(201);
    expect((await call("DELETE", "mcp-servers/remote"))?.status).toBeLessThan(400);
    const events = recorded();
    expect(events.map((event) => JSON.parse(event.metadata_json!).action).sort()).toEqual(["DELETE mcp-servers/remote", "POST mcp-servers"]);
    expect(events[0]).toMatchObject({ user_id: "member", email: "member@client.test", ip_address: "198.51.100.30", user_agent: "Console" });
    const deleted = events.find((event) => event.metadata_json!.includes("DELETE"))!;
    expect(JSON.parse(deleted.metadata_json!)).toEqual({ resource: "mcp-servers", resourceId: "remote", action: "DELETE mcp-servers/remote", configWorkspaceId: "w" });
  });

  it("leaves out reads, refusals and failures", async () => {
    const customer = fixture("user");
    expect((await customer.call("POST", "model-profiles", { id: "m", name: "M" }))?.status).toBe(403);
    expect((await customer.call("GET", "mcp-servers"))?.status).toBe(200);
    expect(customer.recorded()).toEqual([]);

    const admin = fixture("admin");
    expect((await admin.call("DELETE", "mcp-servers/does-not-exist"))?.status).toBeGreaterThanOrEqual(400);
    expect((await admin.call("POST", "skills/select", { question: "usage" }))?.status).toBeDefined();
    expect(admin.recorded()).toEqual([]);
  });
});

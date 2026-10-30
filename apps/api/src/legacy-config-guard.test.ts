import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleConfigApiRequest, type ConfigApiContext } from "./config-api.js";
import { legacyConfigRequestNeedsSuperAdmin, stdioMcpAllowed } from "./legacy-config-guard.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });

const fixture = (role: "admin" | "user") => {
  const root = mkdtempSync(join(tmpdir(), "legacy-config-guard-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  metadata.users.createPasswordUser({ id: "member", email: "member@client.test" });
  metadata.energyIq.upsertUserRole({ user_id: "member", role });
  const context = { metadataStore: metadata, userId: "member", workspaceId: "w" } as ConfigApiContext;
  const call = (method: string, path: string, body: unknown = {}) => {
    const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    request.method = method;
    request.headers = { "content-type": "application/json" };
    return handleConfigApiRequest(request, `/api/v1/${path}`, context);
  };
  return { metadata, call };
};

describe("legacy DataFoundry configuration API", () => {
  it.each([
    ["POST", "mcp-servers", { id: "shell", name: "Shell", transport: "stdio", command: "touch", args: ["/tmp/pwned"] }],
    ["POST", "mcp-servers/shell/test", {}],
    ["DELETE", "mcp-servers/shell", {}],
    ["POST", "datasources", { id: "all", name: "All", type: "sqlite", config: { path: "/srv/metadata.sqlite" } }],
    ["POST", "datasources/all/test", {}],
    ["POST", "datasources/uploads", {}],
    ["POST", "model-profiles", { id: "internal", name: "Internal", baseUrl: "http://169.254.169.254/" }],
    ["POST", "knowledge-bases", { id: "kb", name: "KB" }],
    ["POST", "skills", { id: "skill", name: "Skill" }],
    ["POST", "datalink/servers", {}],
  ] as const)("refuses %s /%s for a customer user", async (method, path, body) => {
    const { call, metadata } = fixture("user");
    const response = await call(method, path, body);
    expect(response?.status).toBe(403);
    expect(metadata.configResources.list({ workspace_id: "w", user_id: "member", kind: "mcp-server" })).toEqual([]);
  });

  it("still lets a customer user read their own resources", async () => {
    const { call } = fixture("user");
    expect((await call("GET", "mcp-servers"))?.status).toBe(200);
    expect((await call("GET", "skills"))?.status).toBe(200);
  });

  it("lets a platform administrator manage resources but never save a local-command MCP server in production", async () => {
    const previous = { mode: process.env.DATAFOUNDRY_AUTH_MODE, allow: process.env.ENERGYX_ALLOW_STDIO_MCP };
    process.env.DATAFOUNDRY_AUTH_MODE = "password";
    delete process.env.ENERGYX_ALLOW_STDIO_MCP;
    try {
      const { call, metadata } = fixture("admin");
      expect((await call("POST", "mcp-servers", { id: "remote", name: "Remote", transport: "streamable-http", serverUrl: "https://mcp.example.test/mcp" }))?.status).toBe(201);
      const refused = await call("POST", "mcp-servers", { id: "shell", name: "Shell", transport: "stdio", command: "touch" });
      expect(refused?.status).toBe(403);
      expect(metadata.configResources.list({ workspace_id: "w", user_id: "member", kind: "mcp-server" }).map((resource) => resource.id)).toEqual(["remote"]);
    } finally {
      if (previous.mode === undefined) delete process.env.DATAFOUNDRY_AUTH_MODE; else process.env.DATAFOUNDRY_AUTH_MODE = previous.mode;
      if (previous.allow !== undefined) process.env.ENERGYX_ALLOW_STDIO_MCP = previous.allow;
    }
  });

  it("treats reads and the skill ranking preview as reads", () => {
    expect(legacyConfigRequestNeedsSuperAdmin("GET", ["datasources", "x", "schema"])).toBe(false);
    expect(legacyConfigRequestNeedsSuperAdmin("POST", ["skills", "select"])).toBe(false);
    expect(legacyConfigRequestNeedsSuperAdmin("POST", ["skills", "select", "x"])).toBe(true);
    expect(legacyConfigRequestNeedsSuperAdmin("POST", ["energy", "projects"])).toBe(false);
    expect(legacyConfigRequestNeedsSuperAdmin("PATCH", ["model-profiles", "m"])).toBe(true);
  });

  it("allows local-command MCP servers only in dev sign-in mode or when an operator opts in", () => {
    expect(stdioMcpAllowed({ DATAFOUNDRY_AUTH_MODE: "password" })).toBe(false);
    expect(stdioMcpAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(stdioMcpAllowed({ DATAFOUNDRY_AUTH_MODE: "dev" })).toBe(true);
    expect(stdioMcpAllowed({ DATAFOUNDRY_AUTH_MODE: "dev", ENERGYX_ALLOW_STDIO_MCP: "false" })).toBe(false);
    expect(stdioMcpAllowed({ DATAFOUNDRY_AUTH_MODE: "password", ENERGYX_ALLOW_STDIO_MCP: "true" })).toBe(true);
  });
});

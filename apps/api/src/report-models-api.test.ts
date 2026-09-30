import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createMetadataStore } from "@datafoundry/metadata";
import { handleReportModelsRequest, probeReportModel, reportModelEndpoint } from "./report-models-api.js";
import { resolvePiReportModel } from "./report-agent/pi-report-harness.js";

function request(data: unknown = {}, method = "POST"): IncomingMessage {
  return Object.assign(Readable.from([JSON.stringify(data)]), { method, headers: {} }) as IncomingMessage;
}
function stream(delta: unknown) {
  return new Response('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
}
function provider() {
  let count = 0;
  const calls: Record<string, unknown>[] = [];
  const fetcher = (async (_url: unknown, options: RequestInit) => {
    calls.push(JSON.parse(String(options.body)));
    return ++count % 2 ? stream({ reasoning_content: "A test needs the check tool.", tool_calls: [{ index: 0, id: "check-1", function: { name: "energyiq_connection_check", arguments: '{"marker":"energyiq-ok"}' } }] }) : stream({ content: "energyiq-ok" });
  }) as typeof fetch;
  return { calls, fetcher };
}
describe("Admin report models", () => {
  it("uses the GPT-5.6 streaming tool contract on official OpenAI", async () => {
    const good = provider();
    await probeReportModel({ baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-sol", apiKey: "test-key" }, good.fetcher);
    expect(good.calls).toHaveLength(2);
    for (const call of good.calls) {
      expect(call).toMatchObject({ model: "gpt-5.6-sol", max_completion_tokens: 4096, reasoning_effort: "none", stream: true });
      expect(call).not.toHaveProperty("max_tokens");
    }
  });
  it("validates base URLs and rejects completion paths and credentials", () => {
    expect(reportModelEndpoint("https://api.example.test/v1/")).toBe("https://api.example.test/v1");
    for (const value of ["http://localhost/v1", "https://user:pass@api.test", "https://api.test/v1?key=x", "https://api.test/v1/chat/completions"]) expect(() => reportModelEndpoint(value)).toThrow("ENDPOINT");
  });
  it("requires streamed tools and rejects incomplete/provider error responses without leaking them", async () => {
    const model = { baseUrl: "https://api.example.test/v1", model: "model", apiKey: "private-key" };
    const good = provider(); await probeReportModel(model, good.fetcher);
    expect(good.calls).toHaveLength(2);
    expect(good.calls[0]?.tool_choice).toBe("auto");
    expect(good.calls[1]?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "assistant", reasoning_content: "A test needs the check tool." })]));
    expect(good.calls[1]?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "tool", content: "energyiq-ok" })]));
    await expect(probeReportModel(model, (async () => stream({ content: "plain text" })) as typeof fetch)).rejects.toThrow("REPORT_MODEL_TOOLS_UNSUPPORTED");
    await expect(probeReportModel(model, (async () => new Response("private-provider-message", { status: 401 })) as typeof fetch)).rejects.toThrow("REPORT_MODEL_TEST_FAILED");
    await expect(probeReportModel(model, (async () => new Response('data: {"choices":[]}\n\n')) as typeof fetch)).rejects.toThrow("REPORT_MODEL_STREAM_INCOMPLETE");
  });
  it("keeps candidates separate, gates activation, freezes a running model, and rejects other owners", async () => {
    const root = mkdtempSync(join(tmpdir(), "report-models-"));
    const store = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "test-key" });
    try {
      store.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "System", kind: "personal" });
      store.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      store.workspaces.upsert({ id: "customer", owner_user_id: "dev-user", name: "Customer", kind: "customer" });
      const context = { metadataStore: store, userId: "dev-user", workspaceId: "customer" };
      const data = (response: Awaited<ReturnType<typeof handleReportModelsRequest>>) => (response.body as { data: any }).data;
      const save = async (name: string) => data(await handleReportModelsRequest(request({ name, modelName: name, baseUrl: "https://api.test/v1", apiKey: "private-secret" }), [], context));
      const a = await save("model-a");
      expect(JSON.stringify(a)).not.toContain("private-secret");
      expect(data(await handleReportModelsRequest(request({}, "GET"), [], context)).current.configured).toBe(false);
      await expect(handleReportModelsRequest(request({ revision: a.revision, bindingRevision: 0 }), [a.id, "activate"], context)).rejects.toThrow("TEST_REQUIRED");
      const tested = data(await handleReportModelsRequest(request({ revision: a.revision }), [a.id, "test"], context, provider().fetcher));
      await expect(handleReportModelsRequest(request({ revision: a.revision, bindingRevision: 0 }), [a.id, "activate"], context)).rejects.toThrow("REVISION_CHANGED");
      const active = data(await handleReportModelsRequest(request({ revision: tested.revision, bindingRevision: 0 }), [a.id, "activate"], context));
      expect(active.current.modelName).toBe("model-a");
      const runningModel = resolvePiReportModel(store);
      const native = data(await handleReportModelsRequest(request({ name: "Opus", modelName: "claude-opus-4-8", baseUrl: "https://api.anthropic.com", apiKey: "private-secret", apiProtocol: "anthropic-messages" }), [], context));
      expect(native.apiProtocol).toBe("anthropic-messages");
      expect(native.compatible).toBe(false);
      expect(JSON.stringify(native)).not.toContain("private-secret");
      await expect(handleReportModelsRequest(request({ name: "Bad", modelName: "bad", baseUrl: "https://api.test", apiKey: "private-secret", apiProtocol: "invalid" }), [], context)).rejects.toThrow("PROTOCOL_UNSUPPORTED");
      const b = await save("model-b");
      const testedB = data(await handleReportModelsRequest(request({ revision: b.revision }), [b.id, "test"], context, provider().fetcher));
      await expect(handleReportModelsRequest(request({ revision: testedB.revision, bindingRevision: 0 }), [b.id, "activate"], context)).rejects.toThrow("REVISION_CHANGED");
      await handleReportModelsRequest(request({ revision: testedB.revision, bindingRevision: active.current.revision }), [b.id, "activate"], context);
      expect(resolvePiReportModel(store).model).toBe("model-b");
      expect(runningModel.model).toBe("model-a");

      store.users.upsertDevUser({ id: "member", email: "member@example.test", display_name: "Member", dev_token: "member-token" });
      store.workspaceMemberships.upsert({ workspace_id: "default", user_id: "member", role: "member" });
      await expect(handleReportModelsRequest(request({}, "GET"), [], { ...context, userId: "member" })).rejects.toThrow("ADMIN_REQUIRED");
      store.users.upsertDevUser({ id: "second-admin", email: "second-admin@example.test", display_name: "Admin Two", dev_token: "admin-two-token" });
      store.energyIq.upsertUserRole({ user_id: "second-admin", role: "admin" });
      const other = { ...context, userId: "second-admin" };
      const otherState = data(await handleReportModelsRequest(request({}, "GET"), [], other));
      expect(otherState.current.modelName).toBe("model-b");
      expect(otherState.profiles).toEqual([]);
      expect(JSON.stringify(otherState)).not.toContain("private-secret");
      await expect(handleReportModelsRequest(request({ revision: testedB.revision }), [b.id, "test"], other)).rejects.toThrow();
      const record = store.configResources.get({ id: b.id, workspace_id: "default", user_id: "dev-user", kind: "model-profile" });
      const changed = store.configResources.upsert({ ...record, payload: { ...record.payload, modelName: "changed-without-test" } });
      await expect(handleReportModelsRequest(request({ revision: changed.revision, bindingRevision: active.current.revision + 1 }), [b.id, "activate"], context)).rejects.toThrow("TEST_REQUIRED");
      const protocolChanged = store.configResources.upsert({ ...changed, payload: { ...record.payload, apiProtocol: "anthropic-messages" } });
      await expect(handleReportModelsRequest(request({ revision: protocolChanged.revision, bindingRevision: active.current.revision + 1 }), [b.id, "activate"], context)).rejects.toThrow("TEST_REQUIRED");
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
});


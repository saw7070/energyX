import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createSuccessResult } from "@datafoundry/contracts";
import type { ConfigResourceRecord } from "@datafoundry/metadata";
import type { ConfigApiContext, ConfigApiResponse } from "./routes/types.js";
import { resolveEnergyAccessContext } from "./energy/energy-query-context.js";
import { workspaceDefaultModelProfileDto } from "./workspace-model-profile-api.js";
import { probeAnthropicReportModel, reportModelProtocol, type ReportModelProtocol } from "./report-model-transport.js";
import { reportChatRequest } from "./report-chat-request.js";

type Context = Pick<Required<ConfigApiContext>, "metadataStore" | "userId" | "workspaceId">;
const success = (data: unknown): ConfigApiResponse => ({ status: 200, body: createSuccessResult(data) });
function invalid(message: string): never { throw new Error(message); }
const text = (v: unknown, limit = 200): string => typeof v === "string" && v.trim() && v.length <= limit ? v.trim() : invalid("REPORT_MODEL_FIELD_INVALID");
export function reportModelEndpoint(value: unknown): string {
  let url: URL;
  try { url = new URL(text(value, 2048)); } catch { return invalid("REPORT_MODEL_ENDPOINT_UNSUPPORTED"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /\/(chat\/completions|messages|responses)\/?$/.test(url.pathname)) return invalid("REPORT_MODEL_ENDPOINT_UNSUPPORTED");
  return url.toString().replace(/\/$/, "");
}
function fingerprint(r: ConfigResourceRecord): string {
  return createHash("sha256").update(JSON.stringify([r.payload.modelName, r.payload.baseUrl, r.secret_ref, ...(r.payload.apiProtocol ? [r.payload.apiProtocol] : [])])).digest("hex");
}
function compatible(r: ConfigResourceRecord): boolean {
  return r.status === "connected" && r.default_enabled && !r.payload.fallbackProfileId && r.payload.reportPiTest === fingerprint(r);
}
function dto(r: ConfigResourceRecord) {
  return { id: r.id, name: r.name, modelName: r.payload.modelName ?? r.payload.model, baseUrl: r.payload.baseUrl,
    apiProtocol: reportModelProtocol(r.payload.apiProtocol), hasSecret: Boolean(r.secret_ref), revision: r.revision, compatible: compatible(r),
    testedAt: r.payload.reportPiTestedAt ?? null };
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of request) { const b = Buffer.from(c); size += b.length; if (size > 16384) invalid("INVALID_BODY"); chunks.push(b); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("INVALID_BODY");
  return value as Record<string, unknown>;
}

/** Admin-only UI for the existing server model profiles; no separate model store. */
export async function handleReportModelsRequest(request: IncomingMessage, segments: string[], context: Context, fetcher: typeof fetch = fetch): Promise<ConfigApiResponse> {
  const access = resolveEnergyAccessContext({ metadataStore: context.metadataStore,
    user: context.metadataStore.users.getById({ user_id: context.userId }), requestedWorkspaceId: context.workspaceId });
  if (access.role !== "admin") invalid("ENERGYIQ_ADMIN_REQUIRED");
  const store = context.metadataStore;
  const scope = { workspace_id: "default", user_id: context.userId, kind: "model-profile" as const };
  const state = () => ({
    current: workspaceDefaultModelProfileDto({ context: context as Required<ConfigApiContext>, isAdmin: true }),
    profiles: store.configResources.list(scope).map(dto),
  });
  if (!segments.length && request.method === "GET") return success(state());
  if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } } };
  const input = await body(request);
  if (!segments.length) {
    const name = text(input.name), modelName = text(input.modelName), baseUrl = reportModelEndpoint(input.baseUrl), apiKey = text(input.apiKey, 8192);
    const apiProtocol = reportModelProtocol(input.apiProtocol);
    const id = "report-model-" + randomUUID();
    const secret = store.secrets.put({ ...scope, owner_kind: "model-profile", owner_id: id, value: { apiKey } });
    const record = store.configResources.upsert({ ...scope, id, name, payload: { provider: apiProtocol === "anthropic-messages" ? "anthropic" : "openai-compatible", apiProtocol, modelName, baseUrl },
      secret_ref: secret, default_enabled: true, status: "untested" });
    return success(dto(record));
  }
  const [id, action] = segments;
  if (!id || !action || segments.length !== 2 || !["test", "activate"].includes(action)) return invalid("REPORT_MODEL_ACTION_INVALID");
  const record = store.configResources.get({ ...scope, id });
  if (input.revision !== record.revision) return invalid("REPORT_MODEL_REVISION_CHANGED");
  if (action === "test") {
    if (!record.secret_ref) return invalid("REPORT_MODEL_NOT_CONFIGURED");
    const key = store.secrets.get({ ref: record.secret_ref, workspace_id: "default", user_id: context.userId });
    await probeReportModel({ apiProtocol: reportModelProtocol(record.payload.apiProtocol), baseUrl: reportModelEndpoint(record.payload.baseUrl), model: text(record.payload.modelName ?? record.payload.model), apiKey: text(key.apiKey ?? key.api_key, 8192) }, fetcher);
    const tested = store.configResources.upsert({ ...record, ...scope, payload: { ...record.payload,
      reportPiTest: fingerprint(record), reportPiTestedAt: new Date().toISOString() }, status: "connected", expected_revision: record.revision });
    return success(dto(tested));
  }
  if (!compatible(record)) return invalid("REPORT_MODEL_TEST_REQUIRED");
  if (!Number.isInteger(input.bindingRevision) || Number(input.bindingRevision) < 0) return invalid("REPORT_MODEL_REVISION_CHANGED");
  const current = store.workspaceDefaultModelProfiles.find("default");
  if ((current?.revision ?? 0) !== input.bindingRevision) return invalid("REPORT_MODEL_REVISION_CHANGED");
  store.workspaceDefaultModelProfiles.set({ workspace_id: "default", profile_id: record.id, profile_owner_user_id: context.userId,
    configured_by_user_id: context.userId, ...(current ? { expected_revision: current.revision } : {}) });
  return success(state());
}

/** Probe the same Chat Completions + streamed tool protocol used by the Pi bridge. No project data. */
export async function probeReportModel(model: { baseUrl: string; model: string; apiKey: string; apiProtocol?: ReportModelProtocol }, fetcher: typeof fetch = fetch): Promise<void> {
  if (reportModelProtocol(model.apiProtocol) === "anthropic-messages") return probeAnthropicReportModel(model, fetcher);
  const signal = AbortSignal.timeout(60000);
  const tools = [{ type: "function", function: { name: "energyiq_connection_check", description: "Return a connection test marker.",
    parameters: { type: "object", properties: { marker: { type: "string", enum: ["energyiq-ok"] } }, required: ["marker"], additionalProperties: false } } }];
  async function stream(messages: unknown[], toolChoice: unknown) {
    const response = await fetcher(reportModelEndpoint(model.baseUrl) + "/chat/completions", { method: "POST", redirect: "error", signal,
      headers: { "Content-Type": "application/json", authorization: "Bearer " + model.apiKey },
      body: JSON.stringify(reportChatRequest(model, { messages, tools, tool_choice: toolChoice, stream: true, max_tokens: 4096 })) });
    if (!response.ok || !response.body) { await response.body?.cancel(); return invalid("REPORT_MODEL_TEST_FAILED"); }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = "", bytes = 0, doneMarker = false, content = "", reasoning = "";
    const calls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>();
    function line(line: string) {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") { doneMarker = true; return; }
      if (!data) return;
      const value = JSON.parse(data);
      if (value.error) invalid("REPORT_MODEL_TEST_FAILED");
      const delta = value.choices?.[0]?.delta;
      if (typeof delta?.content === "string") content += delta.content;
      if (typeof delta?.reasoning_content === "string") reasoning += delta.reasoning_content;
      for (const part of delta?.tool_calls ?? []) {
        if (!Number.isInteger(part.index)) invalid("REPORT_MODEL_TEST_FAILED");
        const call = calls.get(part.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
    }
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 1048576) invalid("REPORT_MODEL_TEST_FAILED");
        pending += decoder.decode(chunk.value, { stream: true });
        const lines = pending.split("\n"); pending = lines.pop() ?? ""; lines.forEach(line);
      }
      pending += decoder.decode(); if (pending) line(pending);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (!doneMarker) invalid("REPORT_MODEL_STREAM_INCOMPLETE");
    return { content, reasoning, calls: [...calls.values()] };
  }
  try {
    const messages: unknown[] = [{ role: "user", content: "Call energyiq_connection_check with marker energyiq-ok." }];
    const first = await stream(messages, "auto");
    const call = first.calls[0];
    if (first.calls.length !== 1 || !call?.id || call.function.name !== "energyiq_connection_check" || JSON.parse(call.function.arguments).marker !== "energyiq-ok") invalid("REPORT_MODEL_TOOLS_UNSUPPORTED");
    messages.push({ role: "assistant", content: first.content || null, tool_calls: first.calls, ...(first.reasoning ? { reasoning_content: first.reasoning } : {}) },
      { role: "tool", tool_call_id: call.id, content: "energyiq-ok" },
      { role: "user", content: "Reply with energyiq-ok." });
    const second = await stream(messages, "auto");
    if (second.calls.length || !second.content.includes("energyiq-ok")) invalid("REPORT_MODEL_TEST_FAILED");
  } catch (error) {
    // Never expose provider bodies, authorization headers or arbitrary provider error text.
    const code = error instanceof Error && /^REPORT_MODEL_[A-Z_]+$/.test(error.message) ? error.message : "REPORT_MODEL_TEST_FAILED";
    throw new Error(code);
  }
}


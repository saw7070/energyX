import { reportChatRequest } from "./report-chat-request.js";

export type ReportModelProtocol = "openai-completions" | "anthropic-messages";
export type ReportTransportModel = { model: string; baseUrl: string; apiKey: string; apiProtocol?: ReportModelProtocol };
export function reportModelProtocol(value: unknown): ReportModelProtocol {
  if (value === undefined || value === "openai-completions") return "openai-completions";
  if (value === "anthropic-messages") return value;
  throw new Error("REPORT_MODEL_PROTOCOL_UNSUPPORTED");
}
/** Only the trusted host chooses the upstream URL and authentication. */
export function reportModelRequest(model: ReportTransportModel, body: Record<string, unknown>) {
  const anthropic = reportModelProtocol(model.apiProtocol) === "anthropic-messages";
  const base = model.baseUrl.replace(/\/$/, "");
  const url = anthropic ? base.replace(/\/v1$/, "") + "/v1/messages" : base + "/chat/completions";
  const headers: Record<string, string> = anthropic
    ? { "content-type": "application/json", "x-api-key": model.apiKey, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` };
  return { url, headers, body: anthropic ? { ...body, model: model.model } : reportChatRequest(model, body) };
}

/** Incremental SSE parsing, shared by native probes and the forwarding boundary. */
export class ReportModelStream {
  private decoder = new TextDecoder();
  private pending = "";
  complete = false;
  constructor(private protocol: ReportModelProtocol, private onData?: (data: any) => void) {}
  push(chunk: Uint8Array) { this.lines(this.decoder.decode(chunk, { stream: true })); }
  finish() { this.lines(this.decoder.decode() + "\n"); if (!this.complete) throw new Error("REPORT_MODEL_STREAM_INCOMPLETE"); }
  private lines(text: string) {
    this.pending += text;
    const lines = this.pending.split("\n"); this.pending = lines.pop() ?? "";
    if (this.pending.length > 1024 * 1024) throw new Error("REPORT_MODEL_RESPONSE_LIMIT");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice(5).trim();
      if (!value) continue;
      if (value === "[DONE]" && this.protocol === "openai-completions") { this.complete = true; continue; }
      let data: any;
      try { data = JSON.parse(value); } catch { throw new Error("REPORT_MODEL_TEST_FAILED"); }
      if (data.error || data.type === "error") throw new Error("REPORT_MODEL_TEST_FAILED");
      if (this.protocol === "anthropic-messages" && data.type === "message_stop") this.complete = true;
      this.onData?.(data);
    }
  }
}

export async function probeAnthropicReportModel(model: ReportTransportModel, fetcher: typeof fetch): Promise<void> {
  const signal = AbortSignal.timeout(60_000);
  const tools = [{ name: "energyiq_connection_check", description: "Return the connection marker.", input_schema: {
    type: "object", properties: { marker: { type: "string", enum: ["energyiq-ok"] } }, required: ["marker"], additionalProperties: false,
  } }];
  async function stream(messages: unknown[]) {
    const request = reportModelRequest(model, { messages, tools, tool_choice: { type: "auto" }, stream: true, max_tokens: 4096 });
    const response = await fetcher(request.url, { method: "POST", redirect: "error", signal, headers: request.headers, body: JSON.stringify(request.body) });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("REPORT_MODEL_TEST_FAILED"); }
    const blocks = new Map<number, any>(); const json = new Map<number, string>();
    const parser = new ReportModelStream("anthropic-messages", data => {
      if (data.type === "content_block_start") blocks.set(data.index, { ...data.content_block });
      if (data.type === "content_block_delta") {
        const block = blocks.get(data.index); if (!block) throw new Error("REPORT_MODEL_STREAM_INCOMPLETE");
        if (data.delta.type === "text_delta") block.text = (block.text ?? "") + data.delta.text;
        if (data.delta.type === "input_json_delta") json.set(data.index, (json.get(data.index) ?? "") + data.delta.partial_json);
      }
    });
    const reader = response.body.getReader(); let bytes = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        if ((bytes += value.length) > 1048576) throw new Error("REPORT_MODEL_RESPONSE_LIMIT"); parser.push(value);
      }
      parser.finish();
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    for (const [index, value] of json) if (value) blocks.get(index).input = JSON.parse(value);
    return [...blocks.values()];
  }
  try {
    const messages: unknown[] = [{ role: "user", content: "Call energyiq_connection_check with marker energyiq-ok." }];
    const content = await stream(messages); const calls = content.filter(b => b.type === "tool_use"); const call = calls[0];
    if (calls.length !== 1 || !call.id || call.name !== "energyiq_connection_check" || call.input?.marker !== "energyiq-ok") throw new Error("REPORT_MODEL_TOOLS_UNSUPPORTED");
    messages.push({ role: "assistant", content }, { role: "user", content: [
      { type: "tool_result", tool_use_id: call.id, content: "energyiq-ok" }, { type: "text", text: "Reply with energyiq-ok." },
    ] });
    const second = await stream(messages);
    if (second.some(b => b.type === "tool_use") || !second.some(b => b.type === "text" && b.text.includes("energyiq-ok"))) throw new Error("REPORT_MODEL_TEST_FAILED");
  } catch (error) {
    throw new Error(error instanceof Error && /^REPORT_MODEL_[A-Z_]+$/.test(error.message) ? error.message : "REPORT_MODEL_TEST_FAILED");
  }
}

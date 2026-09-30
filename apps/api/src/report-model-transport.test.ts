import { describe, expect, it } from "vitest";
import { probeAnthropicReportModel, reportModelRequest, ReportModelStream } from "./report-model-transport.js";

const model = { model: "claude-opus-4-8", baseUrl: "https://api.anthropic.com", apiKey: "host-secret", apiProtocol: "anthropic-messages" as const };
function sse(events: unknown[]) { return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""); }
function response(events: unknown[]) {
  const bytes = new TextEncoder().encode(sse(events));
  return new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }));
}
describe("native Anthropic report transport", () => {
  it("pins the host endpoint, model and native headers for either base URL", () => {
    for (const baseUrl of [model.baseUrl, model.baseUrl + "/v1/"]) {
      const req = reportModelRequest({ ...model, baseUrl }, { model: "worker-choice", stream: true });
      expect(req.url).toBe("https://api.anthropic.com/v1/messages");
      expect(req.headers["x-api-key"]).toBe("host-secret");
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers["anthropic-version"]).toBe("2023-06-01");
      expect(req.body.model).toBe(model.model);
    }
  });
  it("roundtrips split tool JSON and a native tool_result, including split UTF-8", async () => {
    let count = 0;
    const fetcher = (async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      expect(options?.redirect).toBe("error"); expect(body.tools[0].input_schema.type).toBe("object");
      if (++count === 1) return response([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "check", name: "energyiq_connection_check", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"marker":' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"energyiq-ok"}' } },
        { type: "message_stop" },
      ]);
      expect(body.messages[1].content[0].input.marker).toBe("energyiq-ok");
      expect(body.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "check", content: "energyiq-ok" });
      return response([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "成功 energyiq-ok" } }, { type: "message_stop" }]);
    }) as typeof fetch;
    await probeAnthropicReportModel(model, fetcher); expect(count).toBe(2);
  });
  it("fails closed on provider error, missing terminator and text-only replies", async () => {
    await expect(probeAnthropicReportModel(model, (async () => new Response("host-secret", { status: 401 })) as typeof fetch)).rejects.toThrow("REPORT_MODEL_TEST_FAILED");
    await expect(probeAnthropicReportModel(model, (async () => response([{ type: "error", error: { message: "host-secret" } }])) as typeof fetch)).rejects.toThrow("REPORT_MODEL_TEST_FAILED");
    await expect(probeAnthropicReportModel(model, (async () => response([])) as typeof fetch)).rejects.toThrow("REPORT_MODEL_STREAM_INCOMPLETE");
    await expect(probeAnthropicReportModel(model, (async () => response([{ type: "message_stop" }])) as typeof fetch)).rejects.toThrow("REPORT_MODEL_TOOLS_UNSUPPORTED");
    const parser = new ReportModelStream("anthropic-messages");
    expect(() => parser.push(new TextEncoder().encode("data: [DONE]\n"))).toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STREAMING_PROXY_HEADERS,
  buildProxyResponseHeaders,
  isStreamingContentType,
  isStreamingProxyPath,
  proxyToApi,
} from "../api-proxy";

describe("api-proxy streaming contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes CopilotKit paths as streaming", () => {
    expect(isStreamingProxyPath("/api/copilotkit")).toBe(true);
    expect(isStreamingProxyPath("/api/copilotkit/info")).toBe(true);
    expect(isStreamingProxyPath("/api/v1/sessions")).toBe(false);
  });

  it("detects text/event-stream content types", () => {
    expect(isStreamingContentType("text/event-stream")).toBe(true);
    expect(isStreamingContentType("text/event-stream; charset=utf-8")).toBe(true);
    expect(isStreamingContentType("application/json")).toBe(false);
    expect(isStreamingContentType(null)).toBe(false);
  });

  it("strips hop-by-hop length/encoding and sets anti-buffering headers for SSE", () => {
    const upstream = new Headers({
      "content-type": "text/event-stream; charset=utf-8",
      "content-encoding": "gzip",
      "content-length": "999",
      "transfer-encoding": "chunked",
      "x-request-id": "abc",
    });

    const headers = buildProxyResponseHeaders(upstream, "/api/v1/other");

    expect(headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(headers.get("x-request-id")).toBe("abc");
    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("Cache-Control")).toBe(STREAMING_PROXY_HEADERS["Cache-Control"]);
    expect(headers.get("X-Accel-Buffering")).toBe(STREAMING_PROXY_HEADERS["X-Accel-Buffering"]);
  });

  it("applies anti-buffering headers for CopilotKit even without event-stream yet", () => {
    const headers = buildProxyResponseHeaders(new Headers({ "content-type": "application/json" }), "/api/copilotkit");

    expect(headers.get("Cache-Control")).toBe(STREAMING_PROXY_HEADERS["Cache-Control"]);
    expect(headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("does not force streaming headers on ordinary JSON API responses", () => {
    const headers = buildProxyResponseHeaders(
      new Headers({ "content-type": "application/json", "content-length": "12" }),
      "/api/v1/sessions",
    );

    expect(headers.get("Cache-Control")).toBeNull();
    expect(headers.get("X-Accel-Buffering")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
  });

  it("normalizes restored structured message content before proxying a CopilotKit run", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string"
        ? init.body
        : new TextDecoder().decode(init?.body as ArrayBuffer);
      expect(JSON.parse(body)).toEqual({
        method: "agent/run",
        params: { agentId: "dataFoundry" },
        body: { messages: [
          { id: "user-1", role: "user", content: "Start" },
          {
            id: "assistant-1",
            role: "assistant",
            content: "Visible answer",
            toolCalls: [{ id: "tool-1" }],
          },
          { id: "tool-1", role: "tool", content: "Tool result" },
          {
            id: "user-with-image",
            role: "user",
            content: [
              { type: "text", text: "Keep this attachment" },
              { type: "image", image: "data:image/png;base64,abc" },
            ],
          },
          { id: "user-text-parts", role: "user", content: "Follow up" },
          { id: "reasoning-1", role: "reasoning", content: "" },
          { id: "user-2", role: "user", content: "Continue" },
        ] },
      });
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyToApi(
      new Request("http://127.0.0.1:3000/api/copilotkit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "agent/run",
          params: { agentId: "dataFoundry" },
          body: { messages: [
            { id: "user-1", role: "user", content: "Start" },
            {
              id: "assistant-1",
              role: "assistant",
              content: [
                { type: "reasoning", text: "Hidden reasoning" },
                { type: "text", text: "Visible answer" },
              ],
              toolCalls: [{ id: "tool-1" }],
            },
            {
              id: "tool-1",
              role: "tool",
              content: [{ type: "text", text: "Tool result" }],
            },
            {
              id: "user-with-image",
              role: "user",
              content: [
                { type: "text", text: "Keep this attachment" },
                { type: "image", image: "data:image/png;base64,abc" },
              ],
            },
            {
              id: "user-text-parts",
              role: "user",
              content: [{ type: "text", text: "Follow up" }],
            },
            {
              id: "reasoning-1",
              role: "reasoning",
              content: [{ type: "reasoning", content: "Internal reasoning" }],
            },
            { id: "user-2", role: "user", content: "Continue" },
          ] },
        }),
      }),
      "/api/copilotkit",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

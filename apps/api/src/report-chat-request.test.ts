import { describe, expect, it } from "vitest";
import { reportChatRequest } from "./report-chat-request.js";

describe("report request compatibility", () => {
  it("adapts a Pi request without mutating it or overriding its completion budget", () => {
    const body = { model: "untrusted", max_tokens: 100, max_completion_tokens: 200, stream: true, tools: [] };
    expect(reportChatRequest({ model: "gpt-5.6-sol", baseUrl: "https://api.openai.com/v1" }, body))
      .toEqual({ model: "gpt-5.6-sol", max_completion_tokens: 200, reasoning_effort: "none", stream: true, tools: [] });
    expect(body.max_tokens).toBe(100);
  });
  it("preserves other provider and model contracts", () => {
    for (const model of [
      { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
      { model: "gpt-5.6-sol", baseUrl: "https://proxy.example.test/v1" },
      { model: "gpt-4.1", baseUrl: "https://api.openai.com/v1" },
    ]) expect(reportChatRequest(model, { max_tokens: 100 })).toEqual({ model: model.model, max_tokens: 100 });
  });
});

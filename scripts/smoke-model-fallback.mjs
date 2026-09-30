import assert from "node:assert/strict";
import http from "node:http";

import { Agent } from "@mastra/core/agent";
import { createModelProviderFromConfig } from "../packages/providers/dist/index.js";

let primaryCalls = 0;
let fallbackCalls = 0;

const fallbackServer = http.createServer((request, response) => {
  fallbackCalls += 1;
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    const input = body ? JSON.parse(body) : {};
    if (input.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      response.write(`data: ${JSON.stringify({
        id: "fallback-smoke",
        object: "chat.completion.chunk",
        created: 1,
        model: "fallback-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "FALLBACK_OK" }, finish_reason: null }]
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: "fallback-smoke",
        object: "chat.completion.chunk",
        created: 1,
        model: "fallback-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json", connection: "close" });
    response.end(JSON.stringify({
      id: "fallback-smoke",
      object: "chat.completion",
      created: 1,
      model: "fallback-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "FALLBACK_OK" },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
  });
});

await listen(fallbackServer);

try {
  const fallback = providerFor(fallbackServer, "fallback-model");
  const failingPrimaryModel = new Proxy(fallback.model, {
    get(target, property, receiver) {
      if (property === "doGenerate" || property === "doStream") {
        return async () => {
          primaryCalls += 1;
          throw new Error("SIMULATED_PRIMARY_OUTAGE");
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const agent = new Agent({
    id: "model-fallback-smoke",
    name: "Model Fallback Smoke",
    instructions: "Reply with the model response only.",
    model: [
      { id: "primary", model: failingPrimaryModel, maxRetries: 0, enabled: true },
      { id: "fallback", model: fallback.model, maxRetries: 0, enabled: true }
    ]
  });
  const output = await agent.generate("Reply with FALLBACK_OK only.", {
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 16, temperature: 0 }
  });
  assert.equal(output.text, "FALLBACK_OK");
  assert.ok(primaryCalls >= 1, "Primary model was not attempted");
  assert.ok(fallbackCalls >= 1, "Fallback model was not attempted");
  console.log(`Model fallback smoke OK: primary_calls=${primaryCalls}, fallback_calls=${fallbackCalls}.`);
} finally {
  fallbackServer.closeAllConnections?.();
  await close(fallbackServer);
}
process.exit(0);

function providerFor(server, model) {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider = createModelProviderFromConfig({
    provider: "openai-compatible",
    model,
    base_url: `http://127.0.0.1:${address.port}/v1`,
    api_key: "test-key"
  });
  assert.equal(provider.kind, "openai-compatible");
  return provider;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

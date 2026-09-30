import assert from "node:assert/strict";
import http from "node:http";

import { generateText } from "ai";
import {
  createModelHelperProviderOptions,
  createModelRuntimeProviderOptions,
  createModelProviderFromConfig
} from "../packages/providers/dist/index.js";

const qwen = createModelProviderFromConfig({
  provider: "bailian",
  model: "qwen3.8-max",
  base_url: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  api_key: "test-key"
});
assert.equal(qwen.kind, "openai-compatible");
assert.equal(qwen.provider_id, "alibaba");
assert.equal(qwen.model_name, "qwen3.8-max");
assert.deepEqual(createModelHelperProviderOptions(), {
  alibaba: { enableThinking: false },
  deepseek: { thinking: { type: "disabled" } }
});
assert.deepEqual(createModelRuntimeProviderOptions({
  providerId: "alibaba",
  reasoningEnabled: false
}), {
  alibaba: { enableThinking: false }
});
assert.deepEqual(createModelRuntimeProviderOptions({
  providerId: "alibaba",
  reasoningEnabled: true
}), {
  alibaba: { enableThinking: true, thinkingBudget: 2048 }
});
assert.deepEqual(createModelRuntimeProviderOptions({
  providerId: "deepseek",
  reasoningEnabled: false
}), {
  deepseek: { thinking: { type: "disabled" } }
});
assert.deepEqual(createModelRuntimeProviderOptions({
  providerId: "alibaba",
  providerIds: ["alibaba", "deepseek"],
  reasoningEnabled: false
}), {
  alibaba: { enableThinking: false },
  deepseek: { thinking: { type: "disabled" } }
});
assert.deepEqual(createModelRuntimeProviderOptions({ providerId: "openai" }), {
  openai: { systemMessageMode: "system" }
});
assert.equal(qwen.model.specificationVersion, "v3");
assert.equal(qwen.prompt_compat?.requires_non_empty_message_content, true);

const deepseek = createModelProviderFromConfig({
  provider: "deepseek",
  model: "deepseek-v4-pro",
  base_url: "https://api.deepseek.com",
  api_key: "test-key"
});
assert.equal(deepseek.provider_id, "deepseek");
assert.equal(deepseek.model.specificationVersion, "v3");

const mock = createModelProviderFromConfig({
  provider: "alibaba",
  model: "qwen3.8-max",
  base_url: "https://example.invalid/v1"
});
assert.equal(mock.kind, "mock");
assert.equal(mock.provider_id, "alibaba");

assert.throws(
  () => createModelProviderFromConfig({
    provider: "unknown-provider",
    model: "unknown-model",
    base_url: "https://example.invalid/v1",
    api_key: "test-key"
  }),
  /PROVIDER_UNSUPPORTED:unknown-provider/u
);

const server = http.createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/json", connection: "close" });
    response.end(JSON.stringify({
      id: "provider-smoke",
      object: "chat.completion",
      created: 1,
      model: "smoke-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OK" },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const compatible = createModelProviderFromConfig({
    provider: "openai-compatible",
    model: "smoke-model",
    base_url: `http://127.0.0.1:${address.port}/v1`,
    api_key: "test-key"
  });
  assert.equal(compatible.kind, "openai-compatible");
  assert.equal(compatible.provider_id, "openai-compatible");
  const result = await generateText({
    model: compatible.model,
    prompt: "Reply with OK only.",
    maxOutputTokens: 8,
    maxRetries: 0
  });
  assert.equal(result.text, "OK");
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

console.log("Model Provider Registry smoke OK: AI SDK 6 + Alibaba + DeepSeek + compatible.");

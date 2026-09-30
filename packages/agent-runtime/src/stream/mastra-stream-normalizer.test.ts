import { describe, expect, it } from "vitest";

import { wrapAgentForAgUi } from "./mastra-stream-normalizer.js";

class PrivateStreamResponse {
  readonly #stream: AsyncIterable<{ payload: { value: number }; type: string }>;

  constructor() {
    this.#stream = (async function* () {
      yield { type: "text-delta", payload: { value: 1 } };
    })();
  }

  get fullStream(): AsyncIterable<{ payload: { value: number }; type: string }> {
    return this.#stream;
  }
}

class PrivateAgent {
  readonly #durable = false;

  get agent(): PrivateAgent | undefined {
    return this.#durable ? this : undefined;
  }

  async stream(): Promise<PrivateStreamResponse> {
    return new PrivateStreamResponse();
  }
}

describe("wrapAgentForAgUi", () => {
  it("preserves private-field accessors on the Agent and stream response", async () => {
    const wrapped = wrapAgentForAgUi(new PrivateAgent());

    expect(wrapped.agent).toBeUndefined();
    const response = await wrapped.stream();
    const chunks = [];
    for await (const chunk of response.fullStream) chunks.push(chunk);

    expect(chunks).toEqual([{ type: "text-delta", payload: { value: 1 } }]);
  });
});

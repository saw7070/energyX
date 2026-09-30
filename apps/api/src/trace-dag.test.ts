import { createCustomEvent } from "@datafoundry/agent-runtime";
import { createMetadataStore, RunEventWriter } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSessionTraceDag } from "./trace-dag.js";

describe("buildSessionTraceDag", () => {
  it("preserves whitespace-only assistant chunks in persisted output", () => {
    const root = mkdtempSync(join(tmpdir(), "trace-dag-stream-text-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Trace" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "test",
        status: "completed",
      });
      metadata.conversationMessages.append({
        id: "run-1:user-1",
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        role: "user",
        source: "client",
        message_id: "user-1",
        content_text: "test",
      });
      const writer = new RunEventWriter(metadata.runEvents);
      writer.write({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
        event: createCustomEvent("context.compiled", { package_id: "context-1" }),
      });
      for (const delta of ["covers", " ", "98.8%"] as const) {
        writer.write({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-1",
          event: {
            type: "TEXT_MESSAGE_CHUNK",
            role: "assistant",
            messageId: "assistant-1",
            delta,
          } as never,
        });
      }

      const trace = buildSessionTraceDag({
        metadataStore: metadata,
        sessionId: "session-1",
        userId: "dev-user",
      });
      const context = trace.nodes.find((node) => node.kind === "context");

      expect(context?.detail?.type).toBe("context");
      if (context?.detail?.type !== "context") return;
      expect(context.detail.assistantOutput).toBe("covers 98.8%");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

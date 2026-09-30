import { EventType } from "@ag-ui/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore, RunEventWriter } from "./index.js";

describe("RunEventWriter protocol event deduplication", () => {
  it("uses one database identity for the same milestone across independent writers", () => {
    const root = mkdtempSync(join(tmpdir(), "protocol-event-concurrent-dedupe-"));
    const databasePath = join(root, "metadata.sqlite");
    const metadata = createMetadataStore({ database_path: databasePath });
    const peer = createMetadataStore({ database_path: databasePath });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Protocol" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "test",
        status: "running",
      });
      const event = {
        type: EventType.CUSTOM,
        name: "energy.run.latency",
        value: { eventId: "energy-run-latency:run-1:request-received" },
      };

      const first = new RunEventWriter(metadata.runEvents).write({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
        event,
      });
      const concurrentReplay = new RunEventWriter(peer.runEvents).write({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
        event,
      });

      expect(concurrentReplay.seq).toBe(first.seq);
      expect(metadata.runEvents.listByRun({ user_id: "dev-user", run_id: "run-1" }))
        .toHaveLength(1);
    } finally {
      peer.close();
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not append a replayed protocol journal event twice", () => {
    const root = mkdtempSync(join(tmpdir(), "protocol-event-dedupe-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Protocol" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "test",
        status: "running"
      });
      const writer = new RunEventWriter(metadata.runEvents);
      const event = {
        type: EventType.CUSTOM,
        name: "protocol.state.updated",
        value: { eventId: "protocol-event-1" }
      };

      const first = writer.write({ user_id: "dev-user", run_id: "run-1", session_id: "session-1", event });
      const replay = writer.write({ user_id: "dev-user", run_id: "run-1", session_id: "session-1", event });

      expect(replay.seq).toBe(first.seq);
      expect(writer.replay({ user_id: "dev-user", run_id: "run-1" })).toHaveLength(1);
      expect(first).toMatchObject({
        contract_version: 1,
        event_schema_version: 0,
        actor_id: "dev-user",
        correlation_id: "run-1",
      });
      const terminal = writer.write({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
        event: { type: EventType.RUN_FINISHED },
      });
      expect(terminal.seq).toBe(first.seq + 1);
      expect(writer.replay({ user_id: "dev-user", run_id: "run-1" }).map(({ seq }) => seq)).toEqual([1, 2]);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends a replayed deterministic model request event only once", () => {
    const root = mkdtempSync(join(tmpdir(), "model-request-event-dedupe-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Provider request" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "test",
        status: "running",
      });
      const writer = new RunEventWriter(metadata.runEvents);
      const event = {
        type: EventType.CUSTOM,
        name: "model.request.prepared",
        value: {
          eventId: "model-request-prepared:run-1:1:0",
          run_event_schema_version: 1,
          request_fidelity: "complete",
          step_number: 1,
          retry_count: 0,
          payload_availability: "not-retained",
          context_package_id: "context-package-1",
          context_package_revision: 1,
          tool_names: [],
          payload_ref: {
            kind: "model-request-snapshot",
            id: "model-request:run-1:1:0",
            sha256: `sha256:${"a".repeat(64)}`,
          },
        },
      };

      const first = writer.write({ user_id: "dev-user", run_id: "run-1", session_id: "session-1", event });
      const replay = writer.write({ user_id: "dev-user", run_id: "run-1", session_id: "session-1", event });

      expect(replay.seq).toBe(first.seq);
      expect(writer.replay({ user_id: "dev-user", run_id: "run-1" })).toHaveLength(1);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends a replayed deterministic Skill load event only once", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-loaded-event-dedupe-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Skill load" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "test",
        status: "running",
      });
      const writer = new RunEventWriter(metadata.runEvents);
      const event = {
        type: EventType.CUSTOM,
        name: "skill.loaded",
        value: {
          eventId: `skill-loaded:run-1:data-analysis:7:${"a".repeat(64)}`,
          run_event_schema_version: 1,
          skill: {
            id: "data-analysis",
            semantic_version: "1.0.0",
            config_revision: 7,
            content_sha256: `sha256:${"a".repeat(64)}`,
          },
        },
      };

      const first = writer.write({ user_id: "dev-user", run_id: "run-1", session_id: "session-1", event });
      const replay = writer.write({ user_id: "dev-user", run_id: "run-1", session_id: "session-1", event });

      expect(replay.seq).toBe(first.seq);
      expect(writer.replay({ user_id: "dev-user", run_id: "run-1" })).toHaveLength(1);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("RunRepository active failure transition", () => {
  it.each(["running", "suspended"] as const)(
    "atomically transitions an owned %s Run to failed",
    (status) => {
      const root = mkdtempSync(join(tmpdir(), "run-active-transition-"));
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      try {
        metadata.sessions.create({ user_id: "dev-user", id: "session-1" });
        metadata.runs.create({
          user_id: "dev-user",
          id: "run-1",
          session_id: "session-1",
          user_input: "Resume",
          status,
        });

        expect(metadata.runs.failActive({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-1",
          error_message: "INVALID_RESUME",
        })).toMatchObject({ status: "failed", error_message: "INVALID_RESUME" });
        expect(metadata.runs.failActive({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-1",
          error_message: "DUPLICATE",
        })).toBeUndefined();
        expect(metadata.runs.get({ user_id: "dev-user", run_id: "run-1" })).toMatchObject({
          status: "failed",
          error_message: "INVALID_RESUME",
        });
      } finally {
        metadata.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("lets restored failure close only a suspended owner, never another running Run", () => {
    const root = mkdtempSync(join(tmpdir(), "run-suspended-transition-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-1" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-running",
        session_id: "session-1",
        user_input: "Another live request",
        status: "running",
      });
      expect(metadata.runs.failSuspended({
        user_id: "dev-user",
        run_id: "run-running",
        session_id: "session-1",
        error_message: "MALFORMED_RESTORE",
      })).toBeUndefined();
      expect(metadata.runs.get({ user_id: "dev-user", run_id: "run-running" })).toMatchObject({
        status: "running",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically suspends and resumes only the exact actor/session-owned active Run", () => {
    const root = mkdtempSync(join(tmpdir(), "run-nonterminal-transition-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-1" });
      metadata.sessions.create({ user_id: "dev-user", id: "session-2" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "Active",
        status: "running",
      });

      expect(metadata.runs.suspendRunning({
        user_id: "foreign-user",
        run_id: "run-1",
        session_id: "session-1",
      })).toBeUndefined();
      expect(metadata.runs.suspendRunning({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-2",
      })).toBeUndefined();
      expect(metadata.runs.suspendRunning({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
      })).toMatchObject({ status: "suspended" });
      expect(metadata.runs.resumeSuspended({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-2",
      })).toBeUndefined();
      expect(metadata.runs.resumeSuspended({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
      })).toMatchObject({ status: "running" });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["completed", "canceled", "failed"] as const)(
    "never resurrects a terminal %s Run through suspend or resume",
    (status) => {
      const root = mkdtempSync(join(tmpdir(), "run-terminal-nonterminal-transition-"));
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      try {
        metadata.sessions.create({ user_id: "dev-user", id: "session-1" });
        metadata.runs.create({
          user_id: "dev-user",
          id: "run-1",
          session_id: "session-1",
          user_input: "Terminal",
          status,
        });
        expect(metadata.runs.suspendRunning({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-1",
        })).toBeUndefined();
        expect(metadata.runs.resumeSuspended({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-1",
        })).toBeUndefined();
        expect(metadata.runs.get({ user_id: "dev-user", run_id: "run-1" })).toMatchObject({ status });
      } finally {
        metadata.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["completed", "canceled", "failed"] as const)(
    "does not rewrite a terminal %s Run or a foreign Session",
    (status) => {
      const root = mkdtempSync(join(tmpdir(), "run-terminal-transition-"));
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      try {
        metadata.sessions.create({ user_id: "dev-user", id: "session-1" });
        metadata.sessions.create({ user_id: "dev-user", id: "session-2" });
        metadata.runs.create({
          user_id: "dev-user",
          id: "run-1",
          session_id: "session-1",
          user_input: "Final",
          status,
        });

        expect(metadata.runs.failActive({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-2",
          error_message: "FOREIGN",
        })).toBeUndefined();
        expect(metadata.runs.failActive({
          user_id: "dev-user",
          run_id: "run-1",
          session_id: "session-1",
          error_message: "LATE",
        })).toBeUndefined();
        expect(metadata.runs.get({ user_id: "dev-user", run_id: "run-1" })).toMatchObject({ status });
      } finally {
        metadata.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

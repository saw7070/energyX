import { auditEntryHash, createMetadataStore, type MetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { attachAuditMirror, auditMirrorStatus, readAuditMirrorTail } from "../audit-mirror.js";
import {
  auditRetentionCutoff,
  auditRetentionMonths,
  checkAuditChain,
  checkAuditLog,
  checkAuditMirror,
  checkAuditRetention,
  createAuditRetentionJob,
} from "./energy-audit-log.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const setup = (options: { secret?: string } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "energy-audit-log-"));
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    ...(options.secret ? { secret_master_key: options.secret } : {}),
  });
  cleanups.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  return { metadata, root };
};

const signIn = (metadata: MetadataStore, id: string) =>
  metadata.authAuditEvents.append({ id, event_type: "auth.login_succeeded", user_id: "dev-user", email: "admin@energyiq.local", ip_address: "203.0.113.9" });

describe("audit retention", () => {
  it("reads ENERGYX_AUDIT_RETENTION_MONTHS: 24 by default, 0 keeps everything, anything else is refused", () => {
    expect(auditRetentionMonths({})).toBe(24);
    expect(auditRetentionMonths({ ENERGYX_AUDIT_RETENTION_MONTHS: "36" })).toBe(36);
    expect(auditRetentionMonths({ ENERGYX_AUDIT_RETENTION_MONTHS: "0" })).toBeNull();
    for (const value of ["-1", "1.5", "two years"]) {
      expect(() => auditRetentionMonths({ ENERGYX_AUDIT_RETENTION_MONTHS: value })).toThrow("ENERGYX_AUDIT_RETENTION_MONTHS_INVALID");
    }
  });

  it("counts back whole calendar months, landing on the last day of a shorter month", () => {
    expect(auditRetentionCutoff(new Date("2026-10-30T08:15:00.000Z"), 24).toISOString()).toBe("2024-10-30T08:15:00.000Z");
    expect(auditRetentionCutoff(new Date("2026-03-31T00:00:00.000Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(auditRetentionCutoff(new Date("2026-01-15T00:00:00.000Z"), 13).toISOString()).toBe("2024-12-15T00:00:00.000Z");
  });

  it("removes records older than the retention period behind a signed checkpoint, and the chain still verifies", async () => {
    const { metadata } = setup({ secret: "retention-test-master-key" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-05T00:00:00.000Z"));
    signIn(metadata, "too-old-1");
    signIn(metadata, "too-old-2");
    vi.setSystemTime(new Date("2025-06-01T00:00:00.000Z"));
    signIn(metadata, "kept");
    vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));
    const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const job = createAuditRetentionJob({ metadataStore: metadata, env: {} });
    const run = await job.runOnce();
    expect(run).toMatchObject({ pruned: 2, verification: { ok: true, first: { seq: 3 }, anchor: { seq: 2, signed: true } } });
    expect(logs).toHaveBeenCalledWith(expect.stringContaining("[audit-retention] removed=2 before=2024-10-30T00:00:00.000Z checkpoint_seq=2 signed=true"));
    const ids = metadata.authAuditEvents.list({ limit: 10 }).events.map((event) => event.event_type);
    expect(ids).toEqual(["energyiq.audit_retention_applied", "auth.login_succeeded"]);

    const health = checkAuditRetention(run!.verification, {});
    expect(health).toMatchObject({ status: "ok", detail: expect.stringContaining("kept for 24 months") });
    expect(health.detail).toContain("signed checkpoint");
    expect((await job.runOnce())?.pruned).toBe(0);
  });

  it("keeps everything when retention is switched off, and says so in System health", async () => {
    const { metadata } = setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    signIn(metadata, "ancient");
    vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));
    const run = await createAuditRetentionJob({ metadataStore: metadata, env: { ENERGYX_AUDIT_RETENTION_MONTHS: "0" } }).runOnce();
    expect(run?.pruned).toBe(0);
    expect(metadata.authAuditEvents.get({ id: "ancient" })).toBeTruthy();
    expect(checkAuditRetention(run!.verification, { ENERGYX_AUDIT_RETENTION_MONTHS: "0" }).status).toBe("warning");
  });

  it("logs loudly when the daily check finds the chain broken", async () => {
    const { metadata } = setup();
    signIn(metadata, "a");
    signIn(metadata, "b");
    metadata.db.exec("DROP TRIGGER auth_audit_events_immutable");
    metadata.db.prepare("UPDATE auth_audit_events SET event_type = 'auth.logout' WHERE id = 'a'").run();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = await createAuditRetentionJob({ metadataStore: metadata, env: {} }).runOnce();
    expect(run?.verification.ok).toBe(false);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("[audit-chain] broken reason=hash_mismatch seq=1 id=a"));
    expect(checkAuditChain(run!.verification)).toMatchObject({ status: "problem", detail: expect.stringContaining("Record #1 was altered"), fix: expect.stringContaining("security incident") });
  });
});

describe("off-host audit copy", () => {
  it("appends every event as one JSON line carrying the chain fields, so the copy verifies on its own", () => {
    const { metadata, root } = setup();
    const path = join(root, "mirror", "audit.jsonl");
    const detach = attachAuditMirror(metadata, { ENERGYX_AUDIT_MIRROR_PATH: path });
    cleanups.unshift(detach);
    signIn(metadata, "one");
    metadata.authAuditEvents.append({ id: "two", event_type: "energyiq.ai_used", user_id: "dev-user", metadata: { workspaceId: "w" } });
    const lines = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => [line.seq, line.id, line.email])).toEqual([[1, "one", "admin@energyiq.local"], [2, "two", null]]);
    expect(lines[1]!.prev_hash).toBe(lines[0]!.entry_hash);
    for (const line of lines) {
      expect(line.entry_hash).toBe(auditEntryHash(line as unknown as Parameters<typeof auditEntryHash>[0]));
    }
    expect(readAuditMirrorTail(path)).toEqual(lines.map((line) => ({ seq: line.seq, entryHash: line.entry_hash })));
    expect(auditMirrorStatus()).toMatchObject({ path, written: 2, failures: 0 });
  });

  it("never fails the request when the copy cannot be written, but logs it and System health shows it", () => {
    const { metadata } = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const detach = attachAuditMirror(metadata, { ENERGYX_AUDIT_MIRROR_PATH: "/audit/mirror.jsonl" }, () => { throw new Error("EROFS: read-only file system"); });
    cleanups.unshift(detach);
    expect(() => signIn(metadata, "still-recorded")).not.toThrow();
    signIn(metadata, "again");
    expect(metadata.authAuditEvents.get({ id: "still-recorded" })).toBeTruthy();
    // Logged once, with the second failure counted rather than flooding the log.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toContain("[audit-mirror] write-failed path=/audit/mirror.jsonl seq=1 code=EROFS");
    expect(auditMirrorStatus()).toMatchObject({ written: 0, failures: 2 });
    expect(checkAuditMirror(metadata, metadata.authAuditEvents.verify(), { ENERGYX_AUDIT_MIRROR_PATH: "/audit/mirror.jsonl" }))
      .toMatchObject({ status: "problem", detail: expect.stringContaining("EROFS") });
  });

  it("warns when there is no off-host copy, and spots records deleted or replaced since they were copied", async () => {
    const { metadata, root } = setup();
    expect(checkAuditMirror(metadata, metadata.authAuditEvents.verify(), {})).toMatchObject({ status: "warning", fix: expect.stringContaining("ENERGYX_AUDIT_MIRROR_PATH") });

    const path = join(root, "audit.jsonl");
    const env = { ENERGYX_AUDIT_MIRROR_PATH: path };
    cleanups.unshift(attachAuditMirror(metadata, env));
    signIn(metadata, "a");
    signIn(metadata, "b");
    expect(checkAuditMirror(metadata, metadata.authAuditEvents.verify(), env).status).toBe("ok");

    // Someone with access to the server removes the newest record, guards and all. The chain alone looks fine.
    metadata.db.exec("DROP TRIGGER auth_audit_events_retained");
    metadata.db.prepare("DELETE FROM auth_audit_events WHERE id = 'b'").run();
    const checks = await checkAuditLog(metadata, env);
    expect(checks.map((check) => [check.id, check.status])).toEqual([["audit-chain", "ok"], ["audit-mirror", "problem"], ["audit-retention", "ok"]]);
    expect(checks[1]!.detail).toContain("goes up to record #2, but the database stops at #1");

    // Writing a new record in its place does not hide it: the copy still holds the original #2.
    signIn(metadata, "c");
    expect(metadata.authAuditEvents.verify().ok).toBe(true);
    expect(checkAuditMirror(metadata, metadata.authAuditEvents.verify(), env)).toMatchObject({
      status: "problem",
      detail: "Record #2 in the database is not the one copied off the server: it was replaced after it was written.",
    });
  });

  it("warns when the copy has fallen behind the database", () => {
    const { metadata, root } = setup();
    const path = join(root, "audit.jsonl");
    const env = { ENERGYX_AUDIT_MIRROR_PATH: path };
    const detach = attachAuditMirror(metadata, env);
    signIn(metadata, "copied");
    detach();
    signIn(metadata, "not-copied");
    expect(checkAuditMirror(metadata, metadata.authAuditEvents.verify(), env)).toMatchObject({ status: "warning", detail: expect.stringContaining("ends at record #1; the database is at #2") });
  });
});

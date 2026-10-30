import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUDIT_CHAIN_GENESIS_HASH, auditEntryHash, createMetadataStore, type MetadataStore } from "./index.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const openStore = (options: { secret?: string; root?: string } = {}) => {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "audit-chain-"));
  const store = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    ...(options.secret ? { secret_master_key: options.secret } : {}),
  });
  cleanups.push(() => { store.close(); if (!options.root) rmSync(root, { recursive: true, force: true }); });
  return { store, root };
};

const chainRows = (store: MetadataStore) => store.db.prepare(
  "SELECT seq, id, prev_hash, entry_hash, email, ip_address FROM auth_audit_events ORDER BY seq",
).all() as Array<{ seq: number; id: string; prev_hash: string; entry_hash: string; email: string | null; ip_address: string | null }>;

const appendMany = (store: MetadataStore, count: number, prefix = "e") => {
  for (let index = 1; index <= count; index += 1) {
    store.authAuditEvents.append({
      id: `${prefix}-${index}`,
      event_type: "auth.login_succeeded",
      user_id: "dev-user",
      email: "person@example.test",
      ip_address: "203.0.113.9",
      metadata: { attempt: index },
    });
  }
};

/** What someone editing the database file directly could do: the guards are triggers, so they can drop them. */
const dropGuards = (store: MetadataStore) => store.db.exec(`
  DROP TRIGGER auth_audit_events_immutable;
  DROP TRIGGER auth_audit_events_retained;
  DROP TRIGGER auth_audit_events_chained_insert;
`);

describe("audit hash chain", () => {
  it("links every new event to the one before it and verifies end to end", () => {
    const { store } = openStore();
    appendMany(store, 5);
    const rows = chainRows(store);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.prev_hash).toBe(AUDIT_CHAIN_GENESIS_HASH);
    for (let index = 1; index < rows.length; index += 1) expect(rows[index]!.prev_hash).toBe(rows[index - 1]!.entry_hash);
    const event = store.authAuditEvents.get({ id: "e-3" });
    expect(event.entry_hash).toBe(auditEntryHash({ ...event, seq: 3, prev_hash: event.prev_hash! }));
    expect(store.authAuditEvents.verify()).toMatchObject({ ok: true, checked: 5, first: { seq: 1 }, head: { seq: 5, entryHash: rows[4]!.entry_hash } });
  });

  it("names the first altered, re-hashed or deleted event", async () => {
    const { store } = openStore();
    appendMany(store, 6);
    dropGuards(store);

    store.db.prepare("UPDATE auth_audit_events SET metadata_json = '{\"attempt\":99}' WHERE seq = 4").run();
    expect(store.authAuditEvents.verify()).toMatchObject({ ok: false, checked: 3, firstBreak: { reason: "hash_mismatch", seq: 4, id: "e-4" } });
    expect((await store.authAuditEvents.verifyAsync({ batchSize: 2 })).firstBreak).toMatchObject({ reason: "hash_mismatch", seq: 4 });

    // Re-hashing the altered event moves the break to the next one, which still points at the original hash.
    const altered = store.authAuditEvents.get({ id: "e-4" });
    store.db.prepare("UPDATE auth_audit_events SET entry_hash = ? WHERE seq = 4")
      .run(auditEntryHash({ ...altered, seq: 4, prev_hash: altered.prev_hash! }));
    expect(store.authAuditEvents.verify().firstBreak).toMatchObject({ reason: "previous_hash_mismatch", seq: 5 });

    store.db.prepare("DELETE FROM auth_audit_events WHERE seq = 2").run();
    expect(store.authAuditEvents.verify().firstBreak).toMatchObject({ reason: "sequence_gap", seq: 2 });
  });

  it("refuses edits to hashed fields, unchained inserts and deletes no checkpoint covers", () => {
    const { store } = openStore();
    appendMany(store, 2);
    expect(() => store.db.prepare("UPDATE auth_audit_events SET event_type = 'auth.logout' WHERE seq = 1").run()).toThrow("AUTH_AUDIT_EVENT_IMMUTABLE");
    expect(() => store.db.prepare("DELETE FROM auth_audit_events WHERE seq = 1").run()).toThrow("AUTH_AUDIT_EVENT_RETAINED");
    expect(() => store.db.prepare(`
      INSERT INTO auth_audit_events (id, event_type, created_at) VALUES ('sneaky', 'auth.login_succeeded', '2026-01-01T00:00:00.000Z')
    `).run()).toThrow("AUTH_AUDIT_EVENT_UNCHAINED");
    // A second writer reusing a sequence number would fork the chain; the unique index refuses it.
    const head = chainRows(store)[1]!;
    expect(() => store.db.prepare(`
      INSERT INTO auth_audit_events (id, event_type, created_at, seq, prev_hash, entry_hash)
      VALUES ('fork', 'auth.login_succeeded', '2026-01-01T00:00:00.000Z', 2, ?, ?)
    `).run(head.prev_hash, head.entry_hash)).toThrow(/UNIQUE/u);
    expect(store.authAuditEvents.verify().ok).toBe(true);
  });

  it("stays valid when a person's email, IP address and browser are erased", () => {
    const { store } = openStore();
    appendMany(store, 3);
    store.db.prepare("UPDATE auth_audit_events SET email = NULL, ip_address = NULL, user_agent = NULL WHERE user_id = 'dev-user'").run();
    expect(chainRows(store).every((row) => row.email === null && row.ip_address === null)).toBe(true);
    expect(store.authAuditEvents.verify()).toMatchObject({ ok: true, checked: 3 });
  });

  it("keeps one unbroken chain when two connections append in turn", () => {
    const { store, root } = openStore();
    const second = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    cleanups.unshift(() => second.close());
    for (let index = 0; index < 10; index += 1) {
      (index % 2 === 0 ? store : second).authAuditEvents.append({ id: `turn-${index}`, event_type: "auth.logout", user_id: "dev-user" });
    }
    expect(chainRows(store).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(second.authAuditEvents.verify()).toMatchObject({ ok: true, checked: 10 });
  });

  it("joins a transaction the caller already opened instead of failing", () => {
    const { store } = openStore();
    store.db.exec("BEGIN IMMEDIATE");
    appendMany(store, 3, "batch");
    store.db.exec("COMMIT");
    expect(store.authAuditEvents.verify()).toMatchObject({ ok: true, checked: 3 });
  });

  it("puts events written before the chain existed onto it, oldest first", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-chain-upgrade-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    createMetadataStore({ database_path: join(root, "metadata.sqlite") }).close();
    const raw = new DatabaseSync(join(root, "metadata.sqlite"));
    raw.exec(`
      DROP TRIGGER auth_audit_events_immutable;
      DROP TRIGGER auth_audit_events_retained;
      DROP TRIGGER auth_audit_events_chained_insert;
      DROP INDEX idx_auth_audit_events_seq;
      ALTER TABLE auth_audit_events DROP COLUMN seq;
      ALTER TABLE auth_audit_events DROP COLUMN prev_hash;
      ALTER TABLE auth_audit_events DROP COLUMN entry_hash;
      DELETE FROM schema_migrations WHERE id = '0053_auth_audit_hash_chain';
      INSERT INTO auth_audit_events (id, user_id, email, event_type, metadata_json, created_at) VALUES
        ('later', 'dev-user', 'a@example.test', 'auth.logout', NULL, '2026-02-01T00:00:00.000Z'),
        ('earlier', 'dev-user', 'a@example.test', 'auth.login_succeeded', '{"x":1}', '2026-01-01T00:00:00.000Z');
    `);
    raw.close();
    const reopened = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    cleanups.unshift(() => reopened.close());
    expect(chainRows(reopened).map((row) => [row.seq, row.id])).toEqual([[1, "earlier"], [2, "later"]]);
    reopened.authAuditEvents.append({ id: "after-upgrade", event_type: "auth.logout" });
    expect(reopened.authAuditEvents.verify()).toMatchObject({ ok: true, checked: 3 });
    expect(() => reopened.db.prepare("UPDATE auth_audit_events SET metadata_json = NULL WHERE id = 'earlier'").run()).toThrow("AUTH_AUDIT_EVENT_IMMUTABLE");
  });

  it("prunes old events from the start behind a signed checkpoint and still verifies", () => {
    const { store } = openStore({ secret: "audit-test-master-key" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-10T00:00:00.000Z"));
    appendMany(store, 3, "old");
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));
    appendMany(store, 2, "new");
    const removedHead = store.authAuditEvents.get({ id: "old-3" });

    const outcome = store.authAuditEvents.prune({ before: "2024-06-01T00:00:00.000Z", retentionMonths: 24 });
    expect(outcome).toMatchObject({ pruned: 3, anchor: { seq: 3, entry_hash: removedHead.entry_hash, signature: expect.stringMatching(/^[0-9a-f]{64}$/u) } });
    expect(outcome.event).toMatchObject({ event_type: "energyiq.audit_retention_applied", seq: 6 });
    expect(JSON.parse(outcome.event!.metadata_json!)).toMatchObject({ removedCount: 3, checkpointSeq: 3, checkpointHash: removedHead.entry_hash, checkpointSigned: true });
    expect(chainRows(store).map((row) => row.id)).toEqual(["new-1", "new-2", outcome.event!.id]);
    expect(store.authAuditEvents.verify()).toMatchObject({ ok: true, checked: 3, first: { seq: 4 }, anchor: { seq: 3, signed: true } });

    // Nothing else is old enough, so a second run removes nothing and records nothing.
    expect(store.authAuditEvents.prune({ before: "2024-06-01T00:00:00.000Z" })).toEqual({ pruned: 0 });
    // Events after the checkpoint still cannot be deleted.
    expect(() => store.db.prepare("DELETE FROM auth_audit_events WHERE seq = 4").run()).toThrow("AUTH_AUDIT_EVENT_RETAINED");

    // A forged checkpoint, or removing events without one, is caught.
    store.db.prepare("UPDATE auth_audit_chain_anchors SET pruned_count = 1 WHERE seq = 3").run();
    expect(store.authAuditEvents.verify().firstBreak).toMatchObject({ reason: "anchor_signature_invalid", seq: 3 });
    store.db.prepare("DELETE FROM auth_audit_chain_anchors").run();
    expect(store.authAuditEvents.verify().firstBreak).toMatchObject({ reason: "missing_start", seq: 4 });
  });

  it("never prunes an event written after the cutoff, even behind an out-of-order older one", () => {
    const { store } = openStore();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    appendMany(store, 1, "a");
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    appendMany(store, 1, "b");
    // A clock that stepped backwards wrote this one after "b" with an older time.
    vi.setSystemTime(new Date("2024-02-01T00:00:00.000Z"));
    appendMany(store, 1, "c");
    expect(store.authAuditEvents.prune({ before: "2025-01-01T00:00:00.000Z" }).pruned).toBe(1);
    expect(chainRows(store).map((row) => row.id).slice(0, 2)).toEqual(["b-1", "c-1"]);
    expect(store.authAuditEvents.verify().ok).toBe(true);
  });

  it("records at most one event while a matching recent one exists", () => {
    const { store } = openStore();
    const input = (id: string) => ({ id, event_type: "energyiq.support_access", user_id: "dev-user", metadata: { workspaceId: "org-a", access: "read" } });
    const skip = () => store.authAuditEvents.existsSince({
      user_id: "dev-user", event_type: "energyiq.support_access", since: new Date(Date.now() - 3_600_000).toISOString(),
      metadata: { workspaceId: "org-a", access: "read" },
    });
    expect(store.authAuditEvents.appendUnless(skip, input("first"))).toBeDefined();
    expect(store.authAuditEvents.appendUnless(skip, input("second"))).toBeUndefined();
    expect(store.authAuditEvents.existsSince({ user_id: "dev-user", event_type: "energyiq.support_access", since: "2000-01-01T00:00:00.000Z", metadata: { workspaceId: "org-b" } })).toBe(false);
  });

  it("tells listeners about every append and survives one that throws", () => {
    const { store } = openStore();
    const seen: number[] = [];
    store.authAuditEvents.onAppend(() => { throw new Error("disk full"); });
    const stop = store.authAuditEvents.onAppend((event) => seen.push(event.seq!));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    appendMany(store, 2);
    stop();
    appendMany(store, 1, "after");
    expect(seen).toEqual([1, 2]);
    expect(errors).toHaveBeenCalledTimes(3);
  });
});

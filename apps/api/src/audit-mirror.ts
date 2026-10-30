import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthAuditEventRecord, MetadataStore } from "@datafoundry/metadata";

/**
 * The off-host copy of the audit log. With ENERGYX_AUDIT_MIRROR_PATH set, every audit event is appended to that file
 * as one JSON line as soon as it is written, for operations to ship to write-once storage (for example an object
 * store bucket with Object Lock). Each line carries the chain fields, so the copy can be verified on its own and
 * shows when the database later loses or changes events.
 *
 * A failed write never fails the request that caused the event: it is logged (at most once a minute, with a count
 * of the failures in between) and shown in Admin → System health.
 */

export type AuditMirrorStatus = {
  path: string;
  written: number;
  failures: number;
  lastWrittenAt?: string;
  lastFailureAt?: string;
  lastError?: string;
};

type AppendFile = (path: string, data: string, options: { encoding: "utf8"; mode: number }) => void;

const LOG_EVERY_MS = 60_000;
let active: AuditMirrorStatus | undefined;

/** The mirror this process writes to, if any, and how its writes are going. */
export const auditMirrorStatus = (): AuditMirrorStatus | undefined => (active ? { ...active } : undefined);

export const auditMirrorPath = (env: Record<string, string | undefined> = process.env): string | undefined => {
  const configured = env.ENERGYX_AUDIT_MIRROR_PATH?.trim();
  return configured ? resolve(configured) : undefined;
};

/** One line of the copy: the event exactly as stored, chain fields included. */
export const auditMirrorLine = (event: AuthAuditEventRecord): string => JSON.stringify({
  seq: event.seq ?? null,
  id: event.id,
  created_at: event.created_at,
  event_type: event.event_type,
  user_id: event.user_id ?? null,
  email: event.email ?? null,
  ip_address: event.ip_address ?? null,
  user_agent: event.user_agent ?? null,
  metadata_json: event.metadata_json ?? null,
  prev_hash: event.prev_hash ?? null,
  entry_hash: event.entry_hash ?? null,
});

/** Starts copying every new audit event to ENERGYX_AUDIT_MIRROR_PATH. Returns a function that stops it. */
export const attachAuditMirror = (
  metadataStore: Pick<MetadataStore, "authAuditEvents">,
  env: Record<string, string | undefined> = process.env,
  appendFile: AppendFile = appendFileSync,
): (() => void) => {
  const path = auditMirrorPath(env);
  if (!path) {
    active = undefined;
    return () => undefined;
  }
  const status: AuditMirrorStatus = { path, written: 0, failures: 0 };
  active = status;
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // The first write reports the problem.
  }
  let lastLoggedAt = 0;
  let unlogged = 0;
  const stop = metadataStore.authAuditEvents.onAppend((event) => {
    try {
      appendFile(path, `${auditMirrorLine(event)}\n`, { encoding: "utf8", mode: 0o600 });
      status.written += 1;
      status.lastWrittenAt = new Date().toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.failures += 1;
      status.lastFailureAt = new Date().toISOString();
      status.lastError = message.slice(0, 200);
      const now = Date.now();
      if (now - lastLoggedAt < LOG_EVERY_MS) {
        unlogged += 1;
        return;
      }
      console.error(`[audit-mirror] write-failed path=${path} seq=${event.seq ?? "?"} code=${status.lastError}${unlogged ? ` (+${unlogged} more since the last report)` : ""}`);
      lastLoggedAt = now;
      unlogged = 0;
    }
  });
  return () => {
    stop();
    if (active === status) active = undefined;
  };
};

/**
 * The newest entries of the copy (about the last 256 KB), oldest first. Empty when the file is missing, empty or
 * unreadable; a torn or partial line is skipped.
 */
export const readAuditMirrorTail = (path: string, maxBytes = 256 * 1024): Array<{ seq: number; entryHash: string }> => {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    if (length === 0) return [];
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const entries: Array<{ seq: number; entryHash: string }> = [];
    for (const line of buffer.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { seq?: unknown; entry_hash?: unknown };
        if (typeof parsed.seq === "number" && typeof parsed.entry_hash === "string") entries.push({ seq: parsed.seq, entryHash: parsed.entry_hash });
      } catch {
        // The first line of the window is usually cut in half.
      }
    }
    return entries;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

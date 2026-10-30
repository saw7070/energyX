import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Tamper evidence for the audit log (`auth_audit_events`).
 *
 * Every event carries a sequence number, the hash of the event before it and its own hash: SHA-256 over a canonical
 * serialisation of the fields that never change once written (sequence number, id, time, event type, acting user,
 * details and the previous hash). Email, IP address and browser are deliberately outside the hash, so erasing a
 * person's personal data (PDPA) can blank them without breaking the chain. Changing, inserting or removing an event
 * anywhere breaks the chain from that point, and verification names the first break.
 *
 * Old events leave only from the start of the chain, and only after the retention job records an anchor: the number
 * and hash of the last event it removes, signed with a key derived from the server's secret master key when one is
 * set. Verification then starts from that anchor instead of from the very first event. SQLite triggers refuse
 * unchained inserts, edits to hashed fields and deletes that no anchor covers, so ordinary code cannot do any of
 * these by mistake; the hashes are what catch someone who edits the database file directly.
 */

export const AUDIT_CHAIN_GENESIS_HASH = "0".repeat(64);
const HASH_VERSION = "energyx-audit-v1";

export type AuditChainFields = {
  seq: number;
  id: string;
  created_at: string;
  event_type: string;
  user_id?: string | null | undefined;
  metadata_json?: string | null | undefined;
  prev_hash: string;
};

/** The hash of one event. A JSON array of strings, numbers and nulls serialises one way only, so it is canonical. */
export const auditEntryHash = (fields: AuditChainFields): string => createHash("sha256")
  .update(JSON.stringify([
    HASH_VERSION,
    fields.seq,
    fields.id,
    fields.created_at,
    fields.event_type,
    fields.user_id ?? null,
    fields.metadata_json ?? null,
    fields.prev_hash,
  ]))
  .digest("hex");

export type AuditChainAnchorRecord = {
  /** The last event removed; the first event kept has seq + 1 and must point back at `entry_hash`. */
  seq: number;
  entry_hash: string;
  /** Events written before this time were removed. */
  pruned_before: string;
  pruned_count: number;
  created_at: string;
  /** HMAC-SHA256 with a key derived from the secret master key; absent when the server has no master key. */
  signature?: string;
};

const anchorKey = (secretMasterKey: string): Buffer =>
  createHash("sha256").update(`energyx-audit-anchor:${secretMasterKey}`).digest();

export const signAuditAnchor = (
  anchor: Omit<AuditChainAnchorRecord, "signature">,
  secretMasterKey: string | undefined,
): string | undefined => secretMasterKey
  ? createHmac("sha256", anchorKey(secretMasterKey))
    .update(JSON.stringify([HASH_VERSION, "anchor", anchor.seq, anchor.entry_hash, anchor.pruned_before, anchor.pruned_count, anchor.created_at]))
    .digest("hex")
  : undefined;

const sameHex = (left: string, right: string): boolean =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

/** Adds the chain columns, puts every existing event on the chain in the order written, and installs the guards. */
export const initializeAuthAuditChainSchema = (db: DatabaseSync): void => {
  const columns = new Set(db.prepare("PRAGMA table_info(auth_audit_events)").all()
    .map((row) => String((row as { name?: unknown }).name)));
  for (const [column, definition] of [["seq", "INTEGER"], ["prev_hash", "TEXT"], ["entry_hash", "TEXT"]] as const) {
    if (!columns.has(column)) db.exec(`ALTER TABLE auth_audit_events ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_audit_chain_anchors (
      seq INTEGER PRIMARY KEY,
      entry_hash TEXT NOT NULL,
      pruned_before TEXT NOT NULL,
      pruned_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      signature TEXT
    );
  `);
  const rows = db.prepare(`
    SELECT rowid AS row_id, id, created_at, event_type, user_id, metadata_json
    FROM auth_audit_events
    WHERE seq IS NULL
    ORDER BY created_at, rowid
  `).all() as Array<{ row_id: number; id: string; created_at: string; event_type: string; user_id: string | null; metadata_json: string | null }>;
  let head = auditChainHead(db);
  const update = db.prepare("UPDATE auth_audit_events SET seq = ?, prev_hash = ?, entry_hash = ? WHERE rowid = ?");
  for (const row of rows) {
    const seq = head.seq + 1;
    const entryHash = auditEntryHash({ ...row, seq, prev_hash: head.entry_hash });
    update.run(seq, head.entry_hash, entryHash, row.row_id);
    head = { seq, entry_hash: entryHash };
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_audit_events_seq ON auth_audit_events(seq);

    CREATE TRIGGER IF NOT EXISTS auth_audit_events_chained_insert
    BEFORE INSERT ON auth_audit_events
    WHEN NEW.seq IS NULL OR NEW.prev_hash IS NULL OR NEW.entry_hash IS NULL
    BEGIN SELECT RAISE(ABORT, 'AUTH_AUDIT_EVENT_UNCHAINED'); END;

    CREATE TRIGGER IF NOT EXISTS auth_audit_events_immutable
    BEFORE UPDATE OF id, user_id, event_type, metadata_json, created_at, seq, prev_hash, entry_hash ON auth_audit_events
    BEGIN SELECT RAISE(ABORT, 'AUTH_AUDIT_EVENT_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS auth_audit_events_retained
    BEFORE DELETE ON auth_audit_events
    WHEN OLD.seq IS NULL OR OLD.seq > COALESCE((SELECT MAX(seq) FROM auth_audit_chain_anchors), 0)
    BEGIN SELECT RAISE(ABORT, 'AUTH_AUDIT_EVENT_RETAINED'); END;
  `);
};

/** The newest link: the last event, or the last anchor once retention has removed everything before it. */
export const auditChainHead = (db: DatabaseSync): { seq: number; entry_hash: string } => {
  const event = db.prepare(`
    SELECT seq, entry_hash FROM auth_audit_events WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1
  `).get() as { seq: number; entry_hash: string } | undefined;
  const anchor = db.prepare(`
    SELECT seq, entry_hash FROM auth_audit_chain_anchors ORDER BY seq DESC LIMIT 1
  `).get() as { seq: number; entry_hash: string } | undefined;
  const newest = [event, anchor].filter((link): link is { seq: number; entry_hash: string } => Boolean(link))
    .sort((left, right) => right.seq - left.seq)[0];
  return newest ? { seq: Number(newest.seq), entry_hash: newest.entry_hash } : { seq: 0, entry_hash: AUDIT_CHAIN_GENESIS_HASH };
};

/**
 * Runs `work` holding SQLite's write lock, so reading the chain head and inserting after it cannot interleave with
 * another writer (another process included); the unique sequence index refuses a fork even if one tried. Inside a
 * transaction the caller already opened, the work simply joins it.
 */
export const withAuditWriteLock = <T>(db: DatabaseSync, work: () => T): T => {
  const flag = (db as { isTransaction?: unknown }).isTransaction;
  if (flag === true) return work();
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    // Node versions without `isTransaction`: an outer transaction is already open, so join it.
    if (flag === undefined && error instanceof Error && /within a transaction/iu.test(error.message)) return work();
    throw error;
  }
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* SQLite already rolled back */ }
    throw error;
  }
};

export type ChainedAuditEventRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata_json: string | null;
  created_at: string;
};

/** Inserts one event after the current head. Call it under `withAuditWriteLock`. */
export const insertChainedAuditEvent = (db: DatabaseSync, row: ChainedAuditEventRow): void => {
  const head = auditChainHead(db);
  const seq = head.seq + 1;
  const entryHash = auditEntryHash({ ...row, seq, prev_hash: head.entry_hash });
  db.prepare(`
    INSERT INTO auth_audit_events (
      id, user_id, email, event_type, ip_address, user_agent, metadata_json, created_at, seq, prev_hash, entry_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.user_id, row.email, row.event_type, row.ip_address, row.user_agent, row.metadata_json, row.created_at,
    seq, head.entry_hash, entryHash,
  );
};

/**
 * Removes the oldest events written before `before`, from the start of the chain only, after recording an anchor
 * for the last one removed. An event written later is never removed, even if an older-looking one follows it.
 * Call it under `withAuditWriteLock`.
 */
export const pruneAuditChain = (db: DatabaseSync, input: {
  before: string;
  now: string;
  secretMasterKey?: string | undefined;
}): { pruned: number; anchor?: AuditChainAnchorRecord } => {
  const firstKept = db.prepare(`
    SELECT MIN(seq) AS seq FROM auth_audit_events WHERE seq IS NOT NULL AND created_at >= ?
  `).get(input.before) as { seq: number | null } | undefined;
  const through = firstKept?.seq != null
    ? Number(firstKept.seq) - 1
    : Number((db.prepare("SELECT MAX(seq) AS seq FROM auth_audit_events").get() as { seq: number | null } | undefined)?.seq ?? 0);
  const last = db.prepare("SELECT seq, entry_hash FROM auth_audit_events WHERE seq = ?").get(through) as
    { seq: number; entry_hash: string } | undefined;
  if (!last) return { pruned: 0 };
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM auth_audit_events WHERE seq <= ?").get(through) as { count: number }).count);
  const unsigned = { seq: Number(last.seq), entry_hash: last.entry_hash, pruned_before: input.before, pruned_count: count, created_at: input.now };
  const signature = signAuditAnchor(unsigned, input.secretMasterKey);
  const anchor: AuditChainAnchorRecord = { ...unsigned, ...(signature ? { signature } : {}) };
  db.prepare(`
    INSERT INTO auth_audit_chain_anchors (seq, entry_hash, pruned_before, pruned_count, created_at, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(anchor.seq, anchor.entry_hash, anchor.pruned_before, anchor.pruned_count, anchor.created_at, anchor.signature ?? null);
  db.prepare("DELETE FROM auth_audit_events WHERE seq <= ?").run(through);
  return { pruned: count, anchor };
};

export type AuditChainBreakReason =
  | "missing_start"
  | "sequence_gap"
  | "previous_hash_mismatch"
  | "hash_mismatch"
  | "unchained"
  | "anchor_signature_invalid";

export type AuditChainBreak = {
  reason: AuditChainBreakReason;
  /** The sequence number where the chain stops being trustworthy. */
  seq?: number;
  id?: string;
  createdAt?: string;
  message: string;
};

export type AuditChainVerification = {
  ok: boolean;
  /** Events whose hash was recomputed. */
  checked: number;
  first?: { seq: number; createdAt: string };
  head?: { seq: number; entryHash: string; createdAt: string };
  /** The anchor the chain starts from after retention removed older events. */
  anchor?: { seq: number; prunedBefore: string; createdAt: string; signed: boolean };
  firstBreak?: AuditChainBreak;
  verifiedAt: string;
};

type ChainRow = {
  seq: number;
  id: string;
  created_at: string;
  event_type: string;
  user_id: string | null;
  metadata_json: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
};

const VERIFY_BATCH = 2_000;

/**
 * Walks the chain from its start (the first event, or the anchor before it) to the newest event and reports the
 * first break. `pause` runs between batches so a long walk can yield to other requests.
 */
export async function verifyAuditChainAsync(
  db: DatabaseSync,
  options: { secretMasterKey?: string | undefined; pause?: () => Promise<void>; batchSize?: number } = {},
): Promise<AuditChainVerification> {
  const walk = verifyAuditChainSteps(db, options);
  for (let step = walk.next(); ; step = walk.next()) {
    if (step.done) return step.value;
    if (options.pause) await options.pause();
  }
}

export const verifyAuditChain = (
  db: DatabaseSync,
  options: { secretMasterKey?: string | undefined; batchSize?: number } = {},
): AuditChainVerification => {
  const walk = verifyAuditChainSteps(db, options);
  for (let step = walk.next(); ; step = walk.next()) {
    if (step.done) return step.value;
  }
};

function* verifyAuditChainSteps(
  db: DatabaseSync,
  options: { secretMasterKey?: string | undefined; batchSize?: number },
): Generator<void, AuditChainVerification, void> {
  const verifiedAt = new Date().toISOString();
  const batchSize = Math.max(1, options.batchSize ?? VERIFY_BATCH);
  const anchors = db.prepare(`
    SELECT seq, entry_hash, pruned_before, pruned_count, created_at, signature
    FROM auth_audit_chain_anchors ORDER BY seq
  `).all() as Array<{ seq: number; entry_hash: string; pruned_before: string; pruned_count: number; created_at: string; signature: string | null }>;
  const result = (fields: Omit<AuditChainVerification, "ok" | "verifiedAt">): AuditChainVerification =>
    ({ ok: !fields.firstBreak, verifiedAt, ...fields });

  if (options.secretMasterKey) {
    for (const anchor of anchors) {
      const expected = signAuditAnchor({ ...anchor, seq: Number(anchor.seq), pruned_count: Number(anchor.pruned_count) }, options.secretMasterKey)!;
      // An anchor written before a master key was configured carries no signature and cannot be checked.
      if (anchor.signature && !sameHex(anchor.signature, expected)) {
        return result({
          checked: 0,
          firstBreak: {
            reason: "anchor_signature_invalid",
            seq: Number(anchor.seq),
            createdAt: anchor.created_at,
            message: `The retention checkpoint at record #${anchor.seq} has been altered.`,
          },
        });
      }
    }
  }

  const firstRow = db.prepare(`
    SELECT seq, id, created_at FROM auth_audit_events WHERE seq IS NOT NULL ORDER BY seq LIMIT 1
  `).get() as { seq: number; id: string; created_at: string } | undefined;
  let expectedSeq = 1;
  let expectedPrev = AUDIT_CHAIN_GENESIS_HASH;
  let startAnchor: (typeof anchors)[number] | undefined;
  if (firstRow && Number(firstRow.seq) > 1) {
    startAnchor = anchors.find((anchor) => Number(anchor.seq) === Number(firstRow.seq) - 1);
    if (!startAnchor) {
      return result({
        checked: 0,
        first: { seq: Number(firstRow.seq), createdAt: firstRow.created_at },
        firstBreak: {
          reason: "missing_start",
          seq: Number(firstRow.seq),
          id: firstRow.id,
          createdAt: firstRow.created_at,
          message: `Records before #${firstRow.seq} were removed without a retention checkpoint.`,
        },
      });
    }
    expectedSeq = Number(firstRow.seq);
    expectedPrev = startAnchor.entry_hash;
  } else if (!firstRow && anchors.length > 0) {
    startAnchor = anchors.at(-1);
  }
  const anchorSummary = startAnchor
    ? { anchor: { seq: Number(startAnchor.seq), prunedBefore: startAnchor.pruned_before, createdAt: startAnchor.created_at, signed: Boolean(startAnchor.signature) } }
    : {};
  const first = firstRow ? { first: { seq: Number(firstRow.seq), createdAt: firstRow.created_at } } : {};

  const page = db.prepare(`
    SELECT seq, id, created_at, event_type, user_id, metadata_json, prev_hash, entry_hash
    FROM auth_audit_events
    WHERE seq >= ?
    ORDER BY seq
    LIMIT ?
  `);
  let checked = 0;
  let head: AuditChainVerification["head"];
  let firstBreak: AuditChainBreak | undefined;
  for (;;) {
    const rows = page.all(expectedSeq, batchSize) as ChainRow[];
    for (const row of rows) {
      const seq = Number(row.seq);
      const at = { seq, id: row.id, createdAt: row.created_at };
      if (seq !== expectedSeq) {
        firstBreak = { reason: "sequence_gap", seq: expectedSeq, message: `Record #${expectedSeq} is missing: it was deleted after it was written.` };
      } else if (row.prev_hash !== expectedPrev) {
        firstBreak = { reason: "previous_hash_mismatch", ...at, message: `Record #${seq} does not follow on from the record before it: one of them was altered.` };
      } else if (row.entry_hash !== auditEntryHash({ ...row, seq, prev_hash: row.prev_hash })) {
        firstBreak = { reason: "hash_mismatch", ...at, message: `Record #${seq} was altered after it was written.` };
      }
      if (firstBreak) break;
      checked += 1;
      head = { seq, entryHash: row.entry_hash!, createdAt: row.created_at };
      expectedSeq = seq + 1;
      expectedPrev = row.entry_hash!;
    }
    if (firstBreak || rows.length < batchSize) break;
    yield;
  }
  if (!firstBreak) {
    const unchained = db.prepare(`
      SELECT id, created_at FROM auth_audit_events WHERE seq IS NULL ORDER BY created_at, rowid LIMIT 1
    `).get() as { id: string; created_at: string } | undefined;
    if (unchained) {
      firstBreak = { reason: "unchained", id: unchained.id, createdAt: unchained.created_at, message: "A record was added outside the audit chain." };
    }
  }
  return result({ checked, ...first, ...(head ? { head } : {}), ...anchorSummary, ...(firstBreak ? { firstBreak } : {}) });
}

/**
 * SQL (with its parameters) for the events that concern one Organisation: those whose details name it, and the
 * sign-in, MFA and SSO events (`auth.*`) of the people who belong to it. Nothing else matches, so one client's
 * admins never see another client's activity.
 */
export const organisationAuditScopeSql = (workspaceId: string): { sql: string; params: string[] } => ({
  sql: `(
    (CASE WHEN json_valid(metadata_json) THEN (
      json_extract(metadata_json, '$.workspaceId') = ?
      OR json_extract(metadata_json, '$.organisationId') = ?
      OR json_extract(metadata_json, '$.fromWorkspaceId') = ?
      OR json_extract(metadata_json, '$.toWorkspaceId') = ?
      OR (json_type(metadata_json, '$.organisationIds') = 'array'
        AND EXISTS (SELECT 1 FROM json_each(metadata_json, '$.organisationIds') AS organisation WHERE organisation.value = ?))
    ) ELSE 0 END)
    OR (event_type LIKE 'auth.%' AND user_id IN (SELECT user_id FROM workspace_memberships WHERE workspace_id = ?))
  )`,
  params: [workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId],
});

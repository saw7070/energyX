import { createSuccessResult } from "@datafoundry/contracts";
import type { AuditChainVerification, MetadataStore } from "@datafoundry/metadata";

import { auditMirrorPath, auditMirrorStatus, readAuditMirrorTail } from "../audit-mirror.js";
import type { ConfigApiResponse } from "../routes/types.js";
import type { HealthCheck } from "./energy-system-health.js";

/**
 * Looking after the audit log: removing records older than the retention period (ENERGYX_AUDIT_RETENTION_MONTHS,
 * 24 by default, 0 keeps them for ever) once a day behind a signed checkpoint, checking every day that the hash chain
 * is unbroken, and reporting both, with the off-host copy, in Admin → System health.
 */

const DEFAULT_RETENTION_MONTHS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Months to keep audit records; null keeps them for ever. Anything other than a whole number of months is refused. */
export const auditRetentionMonths = (env: Record<string, string | undefined> = process.env): number | null => {
  const raw = env.ENERGYX_AUDIT_RETENTION_MONTHS?.trim();
  if (!raw) return DEFAULT_RETENTION_MONTHS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1200) throw new Error("ENERGYX_AUDIT_RETENTION_MONTHS_INVALID");
  return parsed === 0 ? null : parsed;
};

/** The same day and time `months` calendar months earlier, on the month's last day when that month is shorter. */
export const auditRetentionCutoff = (now: Date, months: number): Date => {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
};

export type AuditRetentionRun = { pruned: number; verification: AuditChainVerification };
export type AuditRetentionJob = { start(): void; stop(): void; runOnce(): Promise<AuditRetentionRun | undefined> };

/** Daily: remove expired audit records, then walk the chain and log loudly if it is broken. */
export const createAuditRetentionJob = (input: {
  metadataStore: MetadataStore;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}): AuditRetentionJob => {
  const months = auditRetentionMonths(input.env ?? process.env);
  const now = input.now ?? (() => new Date());
  let timer: NodeJS.Timeout | undefined;
  let kickoff: NodeJS.Timeout | undefined;
  let running: Promise<AuditRetentionRun | undefined> | undefined;
  const runOnce = (): Promise<AuditRetentionRun | undefined> => {
    running ??= (async () => {
      try {
        let pruned = 0;
        if (months !== null) {
          const cutoff = auditRetentionCutoff(now(), months).toISOString();
          const outcome = input.metadataStore.authAuditEvents.prune({ before: cutoff, retentionMonths: months });
          pruned = outcome.pruned;
          if (outcome.anchor) {
            console.log(`[audit-retention] removed=${outcome.pruned} before=${cutoff} checkpoint_seq=${outcome.anchor.seq} signed=${Boolean(outcome.anchor.signature)}`);
          }
        }
        const verification = await input.metadataStore.authAuditEvents.verifyAsync();
        if (verification.firstBreak) {
          console.error(`[audit-chain] broken reason=${verification.firstBreak.reason} seq=${verification.firstBreak.seq ?? "?"} id=${verification.firstBreak.id ?? "?"}: ${verification.firstBreak.message}`);
        }
        return { pruned, verification };
      } catch (error) {
        console.error(`[audit-retention] failed code=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
        return undefined;
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void runOnce(), DAY_MS);
      timer.unref();
      kickoff = setTimeout(() => void runOnce(), 60_000);
      kickoff.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      if (kickoff) clearTimeout(kickoff);
      timer = undefined;
      kickoff = undefined;
    },
    runOnce,
  };
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** GET admin/audit/verify: walks the chain now and says whether it is intact, and if not, where it first breaks. */
export const auditChainVerificationResponse = async (metadataStore: MetadataStore): Promise<ConfigApiResponse> => {
  const verification = await metadataStore.authAuditEvents.verifyAsync();
  const mirror = auditMirrorStatus();
  return {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
    body: createSuccessResult({ ...verification, ...(mirror ? { mirror } : {}) }),
  };
};

const SECURITY = "Security";
const INCIDENT_FIX = "Treat this as a security incident: keep the database and the off-host copy as evidence, compare them, and follow the incident response policy.";

/** Admin → System health: whether the audit log is intact, copied off the server, and trimmed as the Trust centre says. */
export async function checkAuditLog(
  metadataStore: MetadataStore,
  env: Record<string, string | undefined> = process.env,
): Promise<HealthCheck[]> {
  const verification = await metadataStore.authAuditEvents.verifyAsync();
  return [checkAuditChain(verification), checkAuditMirror(metadataStore, verification, env), checkAuditRetention(verification, env)];
}

export function checkAuditChain(verification: AuditChainVerification): HealthCheck {
  const base = { id: "audit-chain", group: SECURITY, title: "Audit log integrity" };
  if (verification.firstBreak) {
    return { ...base, status: "problem", detail: `${verification.firstBreak.message} Records after that point cannot be trusted until this is explained.`, fix: INCIDENT_FIX };
  }
  if (!verification.head) return { ...base, status: "ok", detail: "Nothing has been recorded yet." };
  const since = verification.first ? ` since ${day(verification.first.createdAt)}` : "";
  return { ...base, status: "ok", detail: `All ${verification.checked.toLocaleString("en-SG")} audit records${since} are intact; none has been changed or removed.` };
}

/**
 * Whether new records are copied off the server, and whether the newest part of that copy still matches the
 * database. A record the copy has but the database lacks, or holds differently, was deleted or replaced after it was
 * written; this also catches removing the newest records and writing new ones in their place, which the chain on its
 * own cannot see.
 */
export function checkAuditMirror(
  metadataStore: MetadataStore,
  verification: AuditChainVerification,
  env: Record<string, string | undefined> = process.env,
): HealthCheck {
  const base = { id: "audit-mirror", group: SECURITY, title: "Off-host audit copy" };
  const path = auditMirrorPath(env);
  if (!path) {
    return { ...base, status: "warning", detail: "Audit records are kept only in this server's database, so someone who controls the server could remove them unnoticed.", fix: "Set ENERGYX_AUDIT_MIRROR_PATH to a file that is shipped to write-once storage, then restart the API." };
  }
  const status = auditMirrorStatus();
  if (status?.lastFailureAt && (!status.lastWrittenAt || status.lastFailureAt > status.lastWrittenAt)) {
    return { ...base, status: "problem", detail: `Copying audit records to ${path} is failing (${status.lastError ?? "unknown error"}).`, fix: "Check that the API can write to that file: free disk space, folder permissions and that the folder exists." };
  }
  const copied = readAuditMirrorTail(path);
  const newest = copied.at(-1);
  const head = verification.head;
  if (!newest) return { ...base, status: "ok", detail: `New audit records are copied to ${path}. Nothing has been copied yet.` };
  if (!head || newest.seq > head.seq) {
    return { ...base, status: "problem", detail: `The off-host copy goes up to record #${newest.seq}, but the database ${head ? `stops at #${head.seq}` : "has none"}: the newest audit records were deleted from the database.`, fix: INCIDENT_FIX };
  }
  const removedThrough = verification.anchor?.seq ?? 0;
  const recent = copied.filter((entry) => entry.seq > removedThrough);
  if (recent.length > 0) {
    const stored = new Map((metadataStore.db.prepare(`
      SELECT seq, entry_hash FROM auth_audit_events WHERE seq BETWEEN ? AND ?
    `).all(Math.min(...recent.map((entry) => entry.seq)), newest.seq) as Array<{ seq: number; entry_hash: string }>)
      .map((row) => [Number(row.seq), row.entry_hash]));
    const differs = recent.find((entry) => stored.get(entry.seq) !== entry.entryHash);
    if (differs) {
      return { ...base, status: "problem", detail: stored.has(differs.seq)
        ? `Record #${differs.seq} in the database is not the one copied off the server: it was replaced after it was written.`
        : `Record #${differs.seq} is in the off-host copy but missing from the database.`, fix: INCIDENT_FIX };
    }
  }
  if (newest.seq < head.seq) {
    return { ...base, status: "warning", detail: `The off-host copy ends at record #${newest.seq}; the database is at #${head.seq}. Some records were not copied.`, fix: "Check the API log for [audit-mirror] errors, and make sure every API process that writes to this database has ENERGYX_AUDIT_MIRROR_PATH set." };
  }
  return { ...base, status: "ok", detail: `Every new audit record is copied to ${path}; the copy matches the database up to record #${head.seq}.` };
}

export function checkAuditRetention(verification: AuditChainVerification, env: Record<string, string | undefined> = process.env): HealthCheck {
  const base = { id: "audit-retention", group: SECURITY, title: "Audit record retention" };
  let months: number | null;
  try {
    months = auditRetentionMonths(env);
  } catch {
    return { ...base, status: "problem", detail: "ENERGYX_AUDIT_RETENTION_MONTHS is not a whole number of months.", fix: "Set it to 24 (the default), or remove it, and restart the API." };
  }
  if (months === null) {
    return { ...base, status: "warning", detail: "Audit records are never removed, but the Trust centre says they are kept for up to 24 months.", fix: "Remove ENERGYX_AUDIT_RETENTION_MONTHS=0 unless a legal hold requires keeping everything." };
  }
  const removed = verification.anchor ? ` Records written before ${day(verification.anchor.prunedBefore)} have been removed, behind a ${verification.anchor.signed ? "signed " : ""}checkpoint.` : "";
  return { ...base, status: "ok", detail: `Audit records are kept for ${months} months and older ones are removed once a day.${removed}` };
}

/**
 * Feedback people give about a site report, and what the AI made of it: things to remember about the site, settings
 * an administrator may apply with one click, follow-up notes the next report checks, and report points the site said
 * are not worth flagging again.
 *
 * Rows are JSON documents keyed by project, on the metadata database, like the report-agent's other stores. Callers
 * check project access before using this store; it trusts the project id it is given.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type FeedbackAbout =
  | { kind: "check"; key: string; title: string }
  | { kind: "section"; id: string; title: string };

export const SUGGESTION_KINDS = [
  "operating_hours",
  "meter_not_in_use",
  "meter_in_use",
  "meter_always_on",
  "light_count",
  "holiday",
  "electricity_rate",
  "dismiss_check",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export type SuggestionDto = {
  id: string;
  kind: SuggestionKind;
  /** One plain sentence describing the change, written by the server from the payload so the two always match. */
  label: string;
  payload: Record<string, unknown>;
  status: "open" | "applied" | "dismissed" | "failed";
  appliedAt?: string;
  appliedByName?: string;
  error?: string;
};

export type FeedbackDto = {
  id: string;
  text: string;
  about: FeedbackAbout | null;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  status: "processed" | "saved" | "failed";
  reply: string | null;
  memoryIds: string[];
  followUpIds: string[];
  suggestions: SuggestionDto[];
};

export type MemoryKind = "fact" | "rule" | "explanation";
export type MemoryDto = {
  id: string;
  text: string;
  kind: MemoryKind;
  status: "active" | "pending" | "removed";
  authorUserId: string;
  authorName: string;
  createdAt: string;
  sourceFeedbackId: string | null;
};

export type FollowUpVerdict = "resolved" | "ongoing" | "unclear";
export type FollowUpDto = {
  id: string;
  text: string;
  checkBy: "next_report" | "next_month";
  status: "open" | "done" | "dropped";
  createdAt: string;
  sourceFeedbackId: string | null;
  lastCheck?: { at: string; verdict: FollowUpVerdict; evidence: string };
  note?: string;
};

export type DismissedCheckDto = { key: string; title: string; reason: string; createdAt: string };

export type ReportFeedbackState = {
  canGive: boolean;
  canManage: boolean;
  aiAvailable: boolean;
  feedback: FeedbackDto[];
  memory: MemoryDto[];
  followUps: FollowUpDto[];
  dismissedChecks: DismissedCheckDto[];
};

/** Stored shapes: the DTO plus the few fields only the server needs. */
export type FeedbackRecord = FeedbackDto & { projectId: string; requestId: string };
export type MemoryRecord = MemoryDto & {
  projectId: string;
  updatedAt: string;
  /** When it became active; the date its advisor note carries. */
  activatedAt?: string;
  /** The exact line written to the project's notes for the advisor, so it can be taken out again. */
  noteLine?: string;
};
export type FollowUpRecord = FollowUpDto & {
  projectId: string;
  authorUserId: string;
  updatedAt: string;
  closedAt?: string;
  noteLine?: string;
};
export type DismissedCheckRecord = DismissedCheckDto & { id: string; projectId: string; suggestionId: string | null };

/** Most feedback kept per project; the oldest goes first. */
export const MAX_FEEDBACK = 200;
/** Most memory in use per project; the oldest is set aside first. */
export const MAX_ACTIVE_MEMORY = 100;
/** Most memory waiting for an administrator per project; the oldest waiting item is set aside first. */
export const MAX_PENDING_MEMORY = 50;
/** Most open follow-ups per project; the oldest is dropped first. */
export const MAX_OPEN_FOLLOW_UPS = 50;
/** Closed follow-ups and removed memory are kept this long in number, for the record, then deleted. */
const MAX_CLOSED_FOLLOW_UPS = 100;
const MAX_REMOVED_MEMORY = 200;

/** The site's own calendar date for an instant; an unknown time zone falls back to UTC. */
export const localDate = (iso: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

const parse = <T>(row: Record<string, unknown> | undefined): T | undefined =>
  row ? (JSON.parse(String(row.document)) as T) : undefined;

/** The DTOs name every field, so the server's own bookkeeping never reaches the page. */
export const toFeedbackDto = (record: FeedbackRecord): FeedbackDto => ({
  id: record.id, text: record.text, about: record.about, authorUserId: record.authorUserId, authorName: record.authorName,
  createdAt: record.createdAt, status: record.status, reply: record.reply, memoryIds: record.memoryIds, followUpIds: record.followUpIds,
  suggestions: record.suggestions,
});
export const toMemoryDto = (record: MemoryRecord): MemoryDto => ({
  id: record.id, text: record.text, kind: record.kind, status: record.status, authorUserId: record.authorUserId,
  authorName: record.authorName, createdAt: record.createdAt, sourceFeedbackId: record.sourceFeedbackId,
});
export const toFollowUpDto = (record: FollowUpRecord): FollowUpDto => ({
  id: record.id, text: record.text, checkBy: record.checkBy, status: record.status, createdAt: record.createdAt,
  sourceFeedbackId: record.sourceFeedbackId, ...(record.lastCheck ? { lastCheck: record.lastCheck } : {}), ...(record.note ? { note: record.note } : {}),
});
export const toDismissedDto = (record: DismissedCheckRecord): DismissedCheckDto => ({
  key: record.key, title: record.title, reason: record.reason, createdAt: record.createdAt,
});

export class ReportFeedbackStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS energyiq_report_feedback (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, author_id TEXT NOT NULL, request_id TEXT NOT NULL,
        document TEXT NOT NULL, UNIQUE(project_id, author_id, request_id));
      CREATE INDEX IF NOT EXISTS energyiq_report_feedback_project ON energyiq_report_feedback(project_id);
      CREATE TABLE IF NOT EXISTS energyiq_report_feedback_memory (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, document TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS energyiq_report_feedback_memory_project ON energyiq_report_feedback_memory(project_id, status);
      CREATE TABLE IF NOT EXISTS energyiq_report_feedback_followups (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, document TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS energyiq_report_feedback_followups_project ON energyiq_report_feedback_followups(project_id, status);
      CREATE TABLE IF NOT EXISTS energyiq_report_feedback_dismissed (
        project_id TEXT NOT NULL, check_key TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(project_id, check_key));
    `);
  }

  // Feedback ---------------------------------------------------------------------------------------------------

  findFeedbackByRequest(projectId: string, authorUserId: string, requestId: string): FeedbackRecord | undefined {
    return parse(this.db.prepare("SELECT document FROM energyiq_report_feedback WHERE project_id=? AND author_id=? AND request_id=?")
      .get(projectId, authorUserId, requestId));
  }

  /** Saves new feedback; the same person sending the same request twice gets the first one back. */
  insertFeedback(record: FeedbackRecord): { record: FeedbackRecord; created: boolean } {
    const result = this.db.prepare("INSERT OR IGNORE INTO energyiq_report_feedback (id, project_id, author_id, request_id, document) VALUES (?,?,?,?,?)")
      .run(record.id, record.projectId, record.authorUserId, record.requestId, JSON.stringify(record));
    if (!Number(result.changes)) return { record: this.findFeedbackByRequest(record.projectId, record.authorUserId, record.requestId)!, created: false };
    this.db.prepare(`DELETE FROM energyiq_report_feedback WHERE project_id=? AND rowid NOT IN (
      SELECT rowid FROM energyiq_report_feedback WHERE project_id=? ORDER BY rowid DESC LIMIT ?)`).run(record.projectId, record.projectId, MAX_FEEDBACK);
    return { record, created: true };
  }

  saveFeedback(record: FeedbackRecord): FeedbackRecord {
    this.db.prepare("UPDATE energyiq_report_feedback SET document=? WHERE id=? AND project_id=?").run(JSON.stringify(record), record.id, record.projectId);
    return record;
  }

  getFeedback(projectId: string, id: string): FeedbackRecord | undefined {
    return parse(this.db.prepare("SELECT document FROM energyiq_report_feedback WHERE project_id=? AND id=?").get(projectId, id));
  }

  listFeedback(projectId: string, limit = 30): FeedbackRecord[] {
    return this.db.prepare("SELECT document FROM energyiq_report_feedback WHERE project_id=? ORDER BY rowid DESC LIMIT ?")
      .all(projectId, limit).map(row => parse<FeedbackRecord>(row)!);
  }

  findSuggestion(projectId: string, suggestionId: string): { feedback: FeedbackRecord; suggestion: SuggestionDto } | undefined {
    for (const feedback of this.listFeedback(projectId, MAX_FEEDBACK)) {
      const suggestion = feedback.suggestions.find(item => item.id === suggestionId);
      if (suggestion) return { feedback, suggestion };
    }
    return undefined;
  }

  updateSuggestion(projectId: string, suggestionId: string, change: (current: SuggestionDto) => SuggestionDto): SuggestionDto {
    const found = this.findSuggestion(projectId, suggestionId);
    if (!found) throw new Error("REPORT_FEEDBACK_NOT_FOUND");
    const next = change(found.suggestion);
    this.saveFeedback({ ...found.feedback, suggestions: found.feedback.suggestions.map(item => item.id === suggestionId ? next : item) });
    return next;
  }

  // Memory -----------------------------------------------------------------------------------------------------

  /**
   * Adds one thing to remember. Returns what had to be set aside to stay within the limits (oldest first), so the
   * caller can take those items out of the advisor's notes as well.
   */
  addMemory(projectId: string, input: Pick<MemoryDto, "text" | "kind" | "status" | "authorUserId" | "authorName" | "sourceFeedbackId">, now = new Date()): { memory: MemoryRecord; evicted: MemoryRecord[] } {
    const at = now.toISOString();
    const memory: MemoryRecord = {
      id: randomUUID(), projectId, text: input.text, kind: input.kind, status: input.status,
      authorUserId: input.authorUserId, authorName: input.authorName, createdAt: at, updatedAt: at,
      sourceFeedbackId: input.sourceFeedbackId, ...(input.status === "active" ? { activatedAt: at } : {}),
    };
    this.db.prepare("INSERT INTO energyiq_report_feedback_memory (id, project_id, status, document) VALUES (?,?,?,?)")
      .run(memory.id, projectId, memory.status, JSON.stringify(memory));
    const evicted = memory.status === "removed" ? [] : this.enforceMemoryLimit(projectId, memory.status, now);
    return { memory, evicted };
  }

  getMemory(projectId: string, id: string): MemoryRecord | undefined {
    return parse(this.db.prepare("SELECT document FROM energyiq_report_feedback_memory WHERE project_id=? AND id=?").get(projectId, id));
  }

  saveMemory(record: MemoryRecord): MemoryRecord {
    this.db.prepare("UPDATE energyiq_report_feedback_memory SET status=?, document=? WHERE id=? AND project_id=?")
      .run(record.status, JSON.stringify(record), record.id, record.projectId);
    if (record.status === "removed") this.pruneRemovedMemory(record.projectId);
    return record;
  }

  /** Active and waiting memory, newest first. */
  listMemory(projectId: string, statuses: Array<MemoryDto["status"]> = ["active", "pending"]): MemoryRecord[] {
    const marks = statuses.map(() => "?").join(",");
    return this.db.prepare(`SELECT document FROM energyiq_report_feedback_memory WHERE project_id=? AND status IN (${marks}) ORDER BY rowid DESC`)
      .all(projectId, ...statuses).map(row => parse<MemoryRecord>(row)!);
  }

  /** Makes waiting memory active. Returns the memory and anything set aside to stay within the limit. */
  activateMemory(projectId: string, id: string, now = new Date()): { memory: MemoryRecord; evicted: MemoryRecord[] } {
    const current = this.getMemory(projectId, id);
    if (!current || current.status === "removed") throw new Error("REPORT_FEEDBACK_NOT_FOUND");
    if (current.status === "active") return { memory: current, evicted: [] };
    const memory = this.saveMemory({ ...current, status: "active", activatedAt: now.toISOString(), updatedAt: now.toISOString() });
    return { memory, evicted: this.enforceMemoryLimit(projectId, "active", now) };
  }

  private enforceMemoryLimit(projectId: string, status: "active" | "pending", now: Date): MemoryRecord[] {
    const limit = status === "active" ? MAX_ACTIVE_MEMORY : MAX_PENDING_MEMORY;
    const items = this.listMemory(projectId, [status]);
    return items.slice(limit).map(item => this.saveMemory({ ...item, status: "removed", updatedAt: now.toISOString() }));
  }

  private pruneRemovedMemory(projectId: string): void {
    this.db.prepare(`DELETE FROM energyiq_report_feedback_memory WHERE project_id=? AND status='removed' AND rowid NOT IN (
      SELECT rowid FROM energyiq_report_feedback_memory WHERE project_id=? AND status='removed' ORDER BY rowid DESC LIMIT ?)`)
      .run(projectId, projectId, MAX_REMOVED_MEMORY);
  }

  // Follow-ups -------------------------------------------------------------------------------------------------

  /** Adds an open follow-up. Returns any follow-ups dropped to stay within the limit, oldest first. */
  addFollowUp(projectId: string, input: Pick<FollowUpDto, "text" | "checkBy" | "sourceFeedbackId"> & { authorUserId: string }, now = new Date()): { followUp: FollowUpRecord; evicted: FollowUpRecord[] } {
    const at = now.toISOString();
    const followUp: FollowUpRecord = {
      id: randomUUID(), projectId, text: input.text, checkBy: input.checkBy, status: "open", createdAt: at, updatedAt: at,
      sourceFeedbackId: input.sourceFeedbackId, authorUserId: input.authorUserId,
    };
    this.db.prepare("INSERT INTO energyiq_report_feedback_followups (id, project_id, status, document) VALUES (?,?,?,?)")
      .run(followUp.id, projectId, "open", JSON.stringify(followUp));
    return { followUp, evicted: this.enforceFollowUpLimit(projectId, now) };
  }

  getFollowUp(projectId: string, id: string): FollowUpRecord | undefined {
    return parse(this.db.prepare("SELECT document FROM energyiq_report_feedback_followups WHERE project_id=? AND id=?").get(projectId, id));
  }

  saveFollowUp(record: FollowUpRecord): FollowUpRecord {
    this.db.prepare("UPDATE energyiq_report_feedback_followups SET status=?, document=? WHERE id=? AND project_id=?")
      .run(record.status, JSON.stringify(record), record.id, record.projectId);
    if (record.status !== "open") this.pruneClosedFollowUps(record.projectId);
    return record;
  }

  /** Open follow-ups, newest first. */
  openFollowUps(projectId: string): FollowUpRecord[] {
    return this.db.prepare("SELECT document FROM energyiq_report_feedback_followups WHERE project_id=? AND status='open' ORDER BY rowid DESC")
      .all(projectId).map(row => parse<FollowUpRecord>(row)!);
  }

  /** Closed follow-ups, most recently closed first. */
  closedFollowUps(projectId: string, limit = 10): FollowUpRecord[] {
    return this.db.prepare(`SELECT document FROM energyiq_report_feedback_followups WHERE project_id=? AND status!='open'
      ORDER BY COALESCE(json_extract(document,'$.closedAt'), json_extract(document,'$.updatedAt')) DESC, rowid DESC LIMIT ?`)
      .all(projectId, limit).map(row => parse<FollowUpRecord>(row)!);
  }

  hasOpenFollowUps(projectId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM energyiq_report_feedback_followups WHERE project_id=? AND status='open' LIMIT 1").get(projectId);
  }

  /** Re-opening a follow-up can take it over the limit too; the caller handles what comes back. */
  enforceFollowUpLimit(projectId: string, now = new Date()): FollowUpRecord[] {
    const open = this.openFollowUps(projectId);
    return open.slice(MAX_OPEN_FOLLOW_UPS).map(item => this.saveFollowUp({
      ...item, status: "dropped", note: "Dropped to make room for newer follow-ups.", updatedAt: now.toISOString(), closedAt: now.toISOString(),
    }));
  }

  private pruneClosedFollowUps(projectId: string): void {
    this.db.prepare(`DELETE FROM energyiq_report_feedback_followups WHERE project_id=? AND status!='open' AND rowid NOT IN (
      SELECT rowid FROM energyiq_report_feedback_followups WHERE project_id=? AND status!='open' ORDER BY rowid DESC LIMIT ?)`)
      .run(projectId, projectId, MAX_CLOSED_FOLLOW_UPS);
  }

  // Report points the site said are not worth flagging ------------------------------------------------------------

  /** One record per point: dismissing the same point again replaces the reason. */
  dismissCheck(projectId: string, input: { key: string; title: string; reason: string; suggestionId: string | null }, now = new Date()): DismissedCheckRecord {
    const record: DismissedCheckRecord = { id: randomUUID(), projectId, key: input.key, title: input.title, reason: input.reason, createdAt: now.toISOString(), suggestionId: input.suggestionId };
    this.db.prepare(`INSERT INTO energyiq_report_feedback_dismissed (project_id, check_key, document) VALUES (?,?,?)
      ON CONFLICT(project_id, check_key) DO UPDATE SET document=excluded.document`).run(projectId, input.key, JSON.stringify(record));
    return record;
  }

  listDismissed(projectId: string): DismissedCheckRecord[] {
    return this.db.prepare("SELECT document FROM energyiq_report_feedback_dismissed WHERE project_id=? ORDER BY json_extract(document,'$.createdAt') DESC")
      .all(projectId).map(row => parse<DismissedCheckRecord>(row)!);
  }

  // Read models ------------------------------------------------------------------------------------------------

  state(projectId: string, flags: Pick<ReportFeedbackState, "canGive" | "canManage" | "aiAvailable">): ReportFeedbackState {
    return {
      ...flags,
      feedback: this.listFeedback(projectId, 30).map(toFeedbackDto),
      memory: this.listMemory(projectId).map(toMemoryDto),
      followUps: [...this.openFollowUps(projectId), ...this.closedFollowUps(projectId, 10)].map(toFollowUpDto),
      dismissedChecks: this.listDismissed(projectId).map(toDismissedDto),
    };
  }

  /**
   * What the site's own reports read: active memory, open follow-ups and the ones closed in the last 31 days, and the
   * report points not to flag. Pending memory is left out until an administrator approves it.
   */
  reportInputs(projectId: string, now = new Date(), timezone = "UTC"): {
    feedbackMemory: Array<{ text: string; date: string }>;
    followUps: Array<{ text: string; status: FollowUpDto["status"]; createdAt: string; lastCheck?: FollowUpDto["lastCheck"] }>;
    dismissedChecks: Array<{ key: string; title: string; reason: string }>;
  } {
    const since = now.getTime() - 31 * 86_400_000;
    const closed = this.db.prepare("SELECT document FROM energyiq_report_feedback_followups WHERE project_id=? AND status!='open' ORDER BY rowid DESC LIMIT ?")
      .all(projectId, MAX_CLOSED_FOLLOW_UPS).map(row => parse<FollowUpRecord>(row)!)
      .filter(item => Date.parse(item.closedAt ?? item.updatedAt) >= since);
    return {
      feedbackMemory: this.listMemory(projectId, ["active"]).map(item => ({ text: item.text, date: localDate(item.activatedAt ?? item.createdAt, timezone) })),
      followUps: [...this.openFollowUps(projectId), ...closed].map(item => ({
        text: item.text, status: item.status, createdAt: item.createdAt, ...(item.lastCheck ? { lastCheck: item.lastCheck } : {}),
      })),
      dismissedChecks: this.listDismissed(projectId).map(item => ({ key: item.key, title: item.title, reason: item.reason })),
    };
  }
}

import type { ActionFeedbackInput } from "./action-feedback.js";
import { validateReportSkillContent } from "./report-skills.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateReportPeriod, type ReportFrequency, type ReportPeriod } from "./report-calendar.js";

export type ReportSettings = {
  /** Project-owned, pinned visual instructions; independent of analytical method selection. */
  styleSkill?: { id: string; name: string; version: string; content: string } | undefined;
  /** Exact server-resolved instructions supplied to one run; not proof of model use. */
  skillUsage?: Array<{ id: string; version: string; name: string; source: "default" | "explicit" | "required"; contentHash: string; inputPath: string }> | undefined;
  projectId: string;
  workspaceId: string;
  actorUserId: string;
  timezone: string;
  contextNotes: string;
  comparisonPeriod?: ReportPeriod | undefined;
  /** Applicability labels for Skills bound to this project; never cross-tenant visibility grants. */
  skillRefs?: Array<{ name: string; version: string; content: string; scope?: "general" | "project" | undefined; category?: "analysis" | "presentation" | "other" | undefined; sourceRunId?: string | undefined; sourceSessionId?: string | undefined }> | undefined;
  fileRefIds: string[];
  useProjectData: boolean;
  skill: string;
  revision: number;
  skillSourceRunId?: string | undefined;
  skillSourceSessionId?: string | undefined;
  schedulePermissionIssue?: string | undefined;
  frequency: ReportFrequency;
  localHour: number;
  scheduledPrompt: string;
};
export type ReportRun = {
  actionProgress?: { actionId: string; title: string; text: string; timezone: string; submittedAt: string };
  actionEstimate?: { actionId: string; title: string; recommendation: string; meterIds: string[]; clarifications?:string[] };
  actionExtraction?: { sourceReportId: string };
  actionFeedback?: ActionFeedbackInput;
  /** Present when the server wrote this report itself from the site's own readings, instead of the advisor writing it. */
  siteReport?: { cadence: "weekly" | "monthly" };
  scheduleKey?: string;
  id: string;
  sessionId?: string;
  retryOfRunId?: string;
  continuityRunId?: string;
  projectId: string;
  workspaceId: string;
  actorUserId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled";
  kind: "report" | "skill" | "chat";
  hasReport?: boolean;
  hasSkillDraft?: boolean;
  reportingPeriod?: ReportPeriod;
  period: ReportPeriod;
  periodPreset?: "recent" | "previous-month" | "previous-week" | "previous-day" | "all" | "custom";
  prompt: string;
  parentRunId?: string;
  settings: ReportSettings;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  answer?: string;
  harnessSessionId?: string;
};

export const hasReportArtifact = (run: ReportRun): boolean => run.kind === "report" || (run.kind === "chat" && run.hasReport === true);
export const hasSkillArtifact = (run: ReportRun): boolean => run.kind === "skill" || (run.kind === "chat" && run.hasSkillDraft === true);

export type ReportSession = { id: string; projectId: string; workspaceId: string; actorUserId: string; createdAt: string };
export type ReportEvent = { sequence: number; runId: string; time: string; type: string; tool?: string; isError?: boolean; text?: string };

/** Dedicated report records share the existing SQLite connection, never a second account system. */
export class ReportStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS energyiq_report_sessions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, document TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS energyiq_report_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS energyiq_report_events_run ON energyiq_report_events(run_id, sequence);
      CREATE TABLE IF NOT EXISTS energyiq_report_settings (
        project_id TEXT PRIMARY KEY, document TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS energyiq_report_setting_revisions (
        project_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL,
        PRIMARY KEY(project_id, revision)
      );
      CREATE TABLE IF NOT EXISTS energyiq_report_runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
        schedule_key TEXT UNIQUE, document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS energyiq_report_runs_project ON energyiq_report_runs(project_id);
    `);
  }

  settings(projectId: string): ReportSettings | undefined {
    const row = this.db.prepare("SELECT document FROM energyiq_report_settings WHERE project_id = ?").get(projectId);
    if (!row) return undefined;
    const settings = JSON.parse(String(row.document)) as ReportSettings;
    return { ...settings, ...(settings.skillRefs ? { skillRefs: settings.skillRefs.map(ref => ({ ...ref, scope: ref.scope ?? "project", category: ref.category ?? "other" })) } : {}) };
  }

  allSettings(): ReportSettings[] {
    return this.db.prepare("SELECT document FROM energyiq_report_settings").all().map((row) => JSON.parse(String(row.document)) as ReportSettings);
  }

  saveSettings(input: ReportSettings): ReportSettings {
    if ((this.settings(input.projectId)?.revision ?? 0) !== input.revision) throw new Error("REPORT_SETTINGS_CHANGED");
    input = { ...input, ...(input.skillRefs ? { skillRefs: input.skillRefs.map(ref => ({ ...ref, scope: ref.scope ?? "project", category: ref.category ?? "other" })) } : {}) };
    validateReportSkillContent(input.skill);
    if (input.styleSkill) validateReportSkillContent(input.styleSkill.content);
    if (input.comparisonPeriod) validateReportPeriod(input.comparisonPeriod);
    for (const ref of input.skillRefs ?? []) {
      validateReportSkillContent(ref.content);
      if (ref.sourceRunId) {
        const source = this.get(input.projectId, ref.sourceRunId);
        if (source.status !== "succeeded" || source.actorUserId !== input.actorUserId || source.sessionId !== ref.sourceSessionId) throw new Error("REPORT_SKILL_SOURCE_INVALID");
      }
    }
    if (!input.skill.trim() && !input.skillRefs?.length && input.frequency !== "off") throw new Error("REPORT_SKILL_REQUIRED_FOR_SCHEDULE");
    if (input.skillSourceRunId) {
      const source = this.get(input.projectId, input.skillSourceRunId);
      if (source.status !== "succeeded" || !hasSkillArtifact(source) || source.actorUserId !== input.actorUserId) throw new Error("REPORT_SKILL_SOURCE_INVALID");
      input = { ...input, skillSourceSessionId: source.sessionId };
    }
    const saved = { ...input, revision: input.revision + 1 };
    this.db.exec("SAVEPOINT report_settings_save");
    try {
      this.db.prepare("INSERT INTO energyiq_report_setting_revisions VALUES (?, ?, ?)").run(saved.projectId, saved.revision, JSON.stringify(saved));
      this.db.prepare("INSERT INTO energyiq_report_settings VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET document = excluded.document").run(saved.projectId, JSON.stringify(saved));
      this.db.exec("RELEASE report_settings_save");
    } catch (error) {
      this.db.exec("ROLLBACK TO report_settings_save; RELEASE report_settings_save");
      throw error;
    }
    return saved;
  }

  enqueue(input: {
    actionProgress?: ReportRun["actionProgress"];
    actionEstimate?: ReportRun["actionEstimate"];
    actionExtraction?: { sourceReportId: string };
    actionFeedback?: ActionFeedbackInput;
    settings: ReportSettings; period: ReportPeriod; reportingPeriod?: ReportPeriod; periodPreset?: ReportRun["periodPreset"]; prompt: string; kind?: ReportRun["kind"];
    actorUserId: string; parentRunId?: string; continuityRunId?: string; scheduleKey?: string; sessionId?: string; retryOfRunId?: string;
  }): ReportRun {
    validateReportPeriod(input.period);
    if (input.reportingPeriod) validateReportPeriod(input.reportingPeriod);
    if (!input.prompt.trim() || input.prompt.length > 20_000) throw new Error("REPORT_PROMPT_REQUIRED_OR_TOO_LONG");
    if (input.scheduleKey) {
      const existing = this.db.prepare("SELECT document FROM energyiq_report_runs WHERE schedule_key = ?").get(input.scheduleKey);
      if (existing) return JSON.parse(String(existing.document)) as ReportRun;
    }
    const pending = this.db.prepare("SELECT document FROM energyiq_report_runs WHERE status IN ('queued', 'running')").all()
      .map(row => JSON.parse(String(row.document)) as ReportRun);
    if (pending.length >= 200 || pending.filter(run => run.actorUserId === input.actorUserId).length >= 20) throw new Error("REPORT_QUEUE_FULL");
    let sessionId = input.sessionId;
    if (sessionId && this.sessionRuns(input.settings.projectId,sessionId).some(run=>run.actionProgress)) throw new Error("REPORT_ACTION_CONTEXT_REQUIRED");
    if (sessionId && !input.actionEstimate && this.sessionRuns(input.settings.projectId,sessionId).some(run=>run.actionEstimate)) throw new Error("REPORT_ACTION_CONTEXT_REQUIRED");
    if (sessionId && !input.actionFeedback && this.sessionRuns(input.settings.projectId,sessionId).some(run=>run.actionFeedback)) throw new Error("REPORT_ACTION_CONTEXT_REQUIRED");
    if (sessionId && !input.parentRunId) {
      const previous = this.sessionRuns(input.settings.projectId, sessionId, { reportArtifact: true, status: "succeeded", limit: 1 })[0];
      if (previous) input = { ...input, parentRunId: previous.id };
    }
    if (input.parentRunId) {
      const parent = this.get(input.settings.projectId, input.parentRunId);
      if (parent.actorUserId !== input.actorUserId || parent.workspaceId !== input.settings.workspaceId) throw new Error("REPORT_SESSION_FORBIDDEN");
      if (parent.actionFeedback && !input.actionFeedback) throw new Error("REPORT_ACTION_CONTEXT_REQUIRED");
      if (!input.actionFeedback) {
        if (sessionId && parent.sessionId !== sessionId) throw new Error("REPORT_SESSION_MISMATCH");
        sessionId ??= parent.sessionId;
      }
      if (parent.status !== "succeeded" || !hasReportArtifact(parent)) throw new Error("REPORT_PARENT_NOT_READY");
      // A site report is the server's own page, not a conversation the advisor can pick up where it left off.
      if (parent.siteReport) throw new Error("REPORT_PARENT_NOT_READY");
    }
    if (sessionId) this.session(input.settings.projectId, sessionId, input.actorUserId, input.settings.workspaceId);
    else sessionId = this.createSession(input.settings, input.actorUserId).id;
    if (this.list(input.settings.projectId).some(run => run.sessionId === sessionId && ["queued", "running"].includes(run.status))) throw new Error("REPORT_ALREADY_RUNNING");
    const run: ReportRun = {
      id: randomUUID(), sessionId, ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}), projectId: input.settings.projectId, workspaceId: input.settings.workspaceId,
      actorUserId: input.actorUserId, status: "queued", kind: input.kind ?? "report", period: input.period,
      ...(input.reportingPeriod ? { reportingPeriod: input.reportingPeriod } : {}),
      ...(input.periodPreset ? { periodPreset: input.periodPreset } : {}),
      ...(input.actionFeedback ? {actionFeedback:input.actionFeedback} : {}),
      ...(input.actionExtraction ? {actionExtraction:input.actionExtraction} : {}),
      ...(input.actionEstimate ? {actionEstimate:input.actionEstimate} : {}),
      ...(input.actionProgress ? {actionProgress:input.actionProgress} : {}),
      prompt: input.prompt.trim(), settings: input.settings, createdAt: new Date().toISOString(),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.continuityRunId ? { continuityRunId: input.continuityRunId } : {}),
    };
    this.db.prepare("INSERT INTO energyiq_report_runs VALUES (?, ?, ?, ?, ?)").run(run.id, run.projectId, run.status, input.scheduleKey ?? null, JSON.stringify(run));
    this.event(run.id, { type: "queued" });
    return run;
  }

  /**
   * Record a report the server has already finished writing, without ever queueing it.
   *
   * `enqueue` is for work the advisor still has to do: it forces the row to "queued" and enforces one conversation at
   * a time. A site report is finished the moment it is saved, so it takes this door instead. The schedule key still
   * decides uniqueness, so re-running the same period simply hands back the report already published for it.
   */
  insertCompleted(input: {
    settings: ReportSettings; period: ReportPeriod; reportingPeriod?: ReportPeriod; prompt: string;
    actorUserId: string; scheduleKey: string; siteReport: NonNullable<ReportRun["siteReport"]>; id?: string;
  }): { run: ReportRun; created: boolean } {
    validateReportPeriod(input.period);
    if (input.reportingPeriod) validateReportPeriod(input.reportingPeriod);
    if (!input.prompt.trim() || input.prompt.length > 20_000) throw new Error("REPORT_PROMPT_REQUIRED_OR_TOO_LONG");
    if (!input.scheduleKey.trim()) throw new Error("REPORT_SCHEDULE_KEY_REQUIRED");
    const existing = this.db.prepare("SELECT document FROM energyiq_report_runs WHERE schedule_key = ?").get(input.scheduleKey);
    if (existing) return { run: JSON.parse(String(existing.document)) as ReportRun, created: false };
    const id = input.id ?? randomUUID();
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("REPORT_INVALID_ID");
    const now = new Date().toISOString();
    const run: ReportRun = {
      id, projectId: input.settings.projectId, workspaceId: input.settings.workspaceId, actorUserId: input.actorUserId,
      status: "succeeded", kind: "report", hasReport: true, siteReport: input.siteReport, scheduleKey: input.scheduleKey,
      period: input.period, ...(input.reportingPeriod ? { reportingPeriod: input.reportingPeriod } : {}),
      prompt: input.prompt.trim(), settings: input.settings, createdAt: now, startedAt: now, finishedAt: now,
    };
    try {
      this.db.prepare("INSERT INTO energyiq_report_runs VALUES (?, ?, ?, ?, ?)").run(run.id, run.projectId, run.status, input.scheduleKey, JSON.stringify(run));
    } catch (error) {
      // Two workers reaching the same period at once: the schedule key is unique, so the first one published wins.
      const raced = this.db.prepare("SELECT document FROM energyiq_report_runs WHERE schedule_key = ?").get(input.scheduleKey);
      if (!raced) throw error;
      return { run: JSON.parse(String(raced.document)) as ReportRun, created: false };
    }
    this.event(run.id, { type: "site_report_published" });
    return { run, created: true };
  }

  /** The report already published for one scheduled slot, if there is one. */
  findByScheduleKey(scheduleKey: string): ReportRun | undefined {
    const row = this.db.prepare("SELECT schedule_key, document FROM energyiq_report_runs WHERE schedule_key = ?").get(scheduleKey);
    return row ? { ...JSON.parse(String(row.document)), scheduleKey: String(row.schedule_key) } as ReportRun : undefined;
  }

  /** The newest saved site report for a site, optionally for one cadence. */
  latestSiteReport(projectId: string, cadence?: "weekly" | "monthly"): ReportRun | undefined {
    const row = this.db.prepare(`SELECT document FROM energyiq_report_runs
      WHERE project_id = ? AND status = 'succeeded' AND json_extract(document, '$.siteReport') IS NOT NULL
      AND (? IS NULL OR json_extract(document, '$.siteReport.cadence') = ?)
      ORDER BY COALESCE(json_extract(document, '$.reportingPeriod.toExclusive'), json_extract(document, '$.period.toExclusive')) DESC, rowid DESC LIMIT 1`)
      .get(projectId, cadence ?? null, cadence ?? null);
    return row ? JSON.parse(String(row.document)) as ReportRun : undefined;
  }

  get(projectId: string, id: string): ReportRun {
    const row = this.db.prepare("SELECT document FROM energyiq_report_runs WHERE id = ? AND project_id = ?").get(id, projectId);
    if (!row) throw new Error("REPORT_NOT_FOUND");
    return JSON.parse(String(row.document)) as ReportRun;
  }

  previousPeriodReport(settings: ReportSettings, period: ReportPeriod): ReportRun | undefined {
    const row = this.db.prepare(`SELECT document FROM energyiq_report_runs
      WHERE project_id = ? AND status = 'succeeded' AND json_extract(document, '$.actionFeedback') IS NULL
      AND json_extract(document, '$.workspaceId') = ? AND json_extract(document, '$.actorUserId') = ?
      AND (json_extract(document, '$.kind') = 'report' OR json_extract(document, '$.hasReport') = 1)
      AND COALESCE(json_extract(document, '$.reportingPeriod.toExclusive'), json_extract(document, '$.period.toExclusive')) <= ?
      ORDER BY COALESCE(json_extract(document, '$.reportingPeriod.toExclusive'), json_extract(document, '$.period.toExclusive')) DESC, rowid DESC LIMIT 1`)
      .get(settings.projectId, settings.workspaceId, settings.actorUserId, period.from);
    return row ? JSON.parse(String(row.document)) as ReportRun : undefined;
  }

  list(projectId: string): ReportRun[] {
    return this.db.prepare("SELECT document FROM energyiq_report_runs WHERE project_id = ? ORDER BY rowid DESC LIMIT 100").all(projectId)
      .map((row) => JSON.parse(String(row.document)) as ReportRun);
  }

  sessionRuns(projectId: string, sessionId: string, options: { reportArtifact?: boolean; kind?: ReportRun["kind"]; status?: "succeeded"; limit?: number } = {}): ReportRun[] {
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
    return this.db.prepare(`SELECT document FROM energyiq_report_runs WHERE project_id = ? AND json_extract(document, '$.sessionId') = ?
      AND (? IS NULL OR json_extract(document, '$.kind') = ?) AND (? IS NULL OR status = ?)
      AND (? = 0 OR json_extract(document, '$.kind') = 'report' OR json_extract(document, '$.hasReport') = 1) ORDER BY rowid DESC LIMIT ?`)
      .all(projectId, sessionId, options.kind ?? null, options.kind ?? null, options.status ?? null, options.status ?? null, options.reportArtifact ? 1 : 0, limit)
      .map(row => JSON.parse(String(row.document)) as ReportRun);
  }

  /** Follow immutable ancestry, not mutable project schedule settings. Retries are attempts, not versions. */
  libraryMetadata(projectId: string, id: string): { category: "scheduled" | "custom"; version: number } {
    let currentId: string | undefined = id;
    let version = 0;
    let scheduled = false;
    const seen = new Set<string>();
    while (currentId) {
      if (seen.has(currentId) || seen.size >= 1000) return { category: "custom", version: 1 };
      seen.add(currentId);
      const row = this.db.prepare("SELECT schedule_key, document FROM energyiq_report_runs WHERE id = ? AND project_id = ?").get(currentId, projectId);
      if (!row) return { category: "custom", version: 1 };
      const run = JSON.parse(String(row.document)) as ReportRun;
      if (run.kind === "skill") return { category: "custom", version: 1 };
      if (run.status === "succeeded" && hasReportArtifact(run)) version++;
      scheduled = row.schedule_key !== null;
      currentId = run.retryOfRunId ?? run.parentRunId;
    }
    return { category: scheduled ? "scheduled" : "custom", version };
  }

  claim(eligible: (run: ReportRun) => boolean = () => true): ReportRun | undefined {
    const runs = this.db.prepare("SELECT document, schedule_key FROM energyiq_report_runs WHERE status = 'queued' ORDER BY rowid").all()
      .map(row => ({ ...JSON.parse(String(row.document)), ...(row.schedule_key ? { scheduleKey: String(row.schedule_key) } : {}) }) as ReportRun);
    const run = runs.filter(eligible).sort((a, b) => Number(Boolean(a.scheduleKey)) - Number(Boolean(b.scheduleKey)))[0];
    if (!run) return undefined;
    const claimed: ReportRun = { ...run, status: "running", startedAt: new Date().toISOString() };
    const changed = this.db.prepare("UPDATE energyiq_report_runs SET status = 'running', document = ? WHERE id = ? AND status = 'queued'").run(JSON.stringify(claimed), run.id);
    if (Number(changed.changes) !== 1) return undefined;
    this.event(run.id, { type: "running" });
    return claimed;
  }

  finish(run: ReportRun): void {
    const changed = this.db.prepare("UPDATE energyiq_report_runs SET status = ?, document = ? WHERE id = ? AND status = 'running'")
      .run(run.status, JSON.stringify({ ...run, finishedAt: new Date().toISOString() }), run.id);
    if (Number(changed.changes)) this.event(run.id, { type: run.status });
  }

  createSession(settings: ReportSettings, actorUserId: string): ReportSession {
    const session = { id: randomUUID(), projectId: settings.projectId, workspaceId: settings.workspaceId, actorUserId, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO energyiq_report_sessions VALUES (?, ?, ?, ?)").run(session.id, session.projectId, actorUserId, JSON.stringify(session));
    return session;
  }

  session(projectId: string, id: string, actorUserId: string, workspaceId: string): ReportSession {
    const row = this.db.prepare("SELECT document FROM energyiq_report_sessions WHERE id = ? AND project_id = ? AND actor_user_id = ?").get(id, projectId, actorUserId);
    if (!row) throw new Error("REPORT_SESSION_FORBIDDEN");
    const session = JSON.parse(String(row.document)) as ReportSession;
    if (session.workspaceId !== workspaceId) throw new Error("REPORT_SESSION_FORBIDDEN");
    return session;
  }

  sessions(projectId: string, actorUserId: string): ReportSession[] {
    return this.db.prepare("SELECT s.document FROM energyiq_report_sessions s WHERE s.project_id = ? AND s.actor_user_id = ? AND NOT EXISTS (SELECT 1 FROM energyiq_report_runs r WHERE json_extract(r.document,'$.sessionId')=s.id AND (json_extract(r.document,'$.actionEstimate') IS NOT NULL OR json_extract(r.document,'$.actionProgress') IS NOT NULL)) ORDER BY s.rowid DESC LIMIT 100").all(projectId, actorUserId).map(row => JSON.parse(String(row.document)) as ReportSession);
  }

  event(runId: string, event: { type: string; tool?: string; isError?: boolean; text?: string }): void {
    const count = this.db.prepare("SELECT count(*) AS count FROM energyiq_report_events WHERE run_id = ?").get(runId);
    if (Number(count?.count) >= 1000) return;
    this.db.prepare("INSERT INTO energyiq_report_events (run_id, document) VALUES (?, ?)").run(runId, JSON.stringify({ runId, time: new Date().toISOString(), ...event }));
  }

  events(runId: string, after = 0): ReportEvent[] {
    return this.db.prepare("SELECT sequence, document FROM energyiq_report_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT 200").all(runId, after).map(row => ({ ...JSON.parse(String(row.document)), sequence: Number(row.sequence) }) as ReportEvent);
  }

  cancel(projectId: string, id: string): ReportRun {
    const run = this.get(projectId, id);
    if (!["queued", "running"].includes(run.status)) return run;
    const cancelled: ReportRun = { ...run, status: "cancelled", finishedAt: new Date().toISOString(), errorCode: "REPORT_CANCELLED" };
    this.db.prepare("UPDATE energyiq_report_runs SET status = ?, document = ? WHERE id = ? AND status IN ('queued', 'running')").run(cancelled.status, JSON.stringify(cancelled), id);
    this.event(id, { type: "cancelled" });
    return cancelled;
  }

  resume(projectId: string, id: string, actorUserId: string): ReportRun {
    const run = this.get(projectId, id);
    if (run.actorUserId !== actorUserId) throw new Error("REPORT_SESSION_FORBIDDEN");
    if (run.actionFeedback || run.actionExtraction || run.actionEstimate || run.actionProgress) throw new Error("REPORT_ACTION_RETRY_REQUIRED");
    if (!["failed", "interrupted", "cancelled"].includes(run.status)) throw new Error("REPORT_NOT_RESUMABLE");
    return this.enqueue({ settings: run.settings, period: run.period, ...(run.reportingPeriod ? { reportingPeriod: run.reportingPeriod } : {}), ...(run.periodPreset ? { periodPreset: run.periodPreset } : {}), prompt: run.prompt, kind: run.kind, actorUserId, ...(run.continuityRunId ? {continuityRunId:run.continuityRunId} : {}),
      ...(run.sessionId ? { sessionId: run.sessionId } : {}), ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}), retryOfRunId: run.id });
  }

  recoverInterrupted(): void {
    for (const row of this.db.prepare("SELECT document FROM energyiq_report_runs WHERE status = 'running'").all()) {
      const run = JSON.parse(String(row.document)) as ReportRun;
      this.finish({ ...run, status: "interrupted", errorCode: "REPORT_WORKER_RESTARTED" });
    }
  }
}

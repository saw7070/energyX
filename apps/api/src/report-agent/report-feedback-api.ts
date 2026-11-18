/**
 * "Tell the AI about this report": /api/v1/energy/report-feedback/:projectId
 *
 * Anyone who may read the project's reports can give feedback. The AI reads it and keeps what matters as project
 * memory, suggests setting changes, and writes follow-ups the next report checks. Nothing about the site changes
 * until a platform administrator applies a suggestion; memory from anyone else waits for an administrator's approval
 * before reports and the advisor use it.
 *
 *   GET    ""                          the feedback state
 *   POST   ""                          give feedback (idempotent per requestId)
 *   POST   "suggestions/:id/apply"     administrators: make the change
 *   POST   "suggestions/:id/dismiss"   administrators
 *   POST   "memory/:id/approve"        administrators
 *   DELETE "memory/:id"                administrators, or the author while it is still waiting
 *   POST   "follow-ups/:id/status"     administrators: open, done or dropped
 *   POST   "follow-ups/review"         administrators: check open follow-ups against the latest readings now
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { createErrorResult, createSuccessResult, type AppErrorCode } from "@datafoundry/contracts";
import type { MetadataStore, UserRecord } from "@datafoundry/metadata";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { resolveEnergyProjectCapabilities } from "../energy/energy-project-capabilities.js";
import { resolveEnergyIqUserRole } from "../energy/energy-user-role.js";
import { resolvePiReportModel, type PiReportModel } from "./pi-report-harness.js";
import { classifyFeedback, type ClassifyResult } from "./report-feedback-ai.js";
import { ApplyError, applySuggestionChange } from "./report-feedback-apply.js";
import { followUpNoteLine, memoryNoteLine, updateAdvisorNotes, type NotesStore } from "./report-feedback-notes.js";
import { loadFollowUpSummary, recordFollowUpReview } from "./report-feedback-review.js";
import { readFeedbackSite } from "./report-feedback-site.js";
import {
  localDate,
  ReportFeedbackStore,
  toFeedbackDto,
  type FeedbackRecord,
  type FollowUpRecord,
  type MemoryRecord,
  type ReportFeedbackState,
  type SuggestionDto,
} from "./report-feedback-store.js";

export type ReportFeedbackDependencies = {
  fetchImpl?: typeof fetch;
  resolveModel?: (metadata: MetadataStore, workspaceId: string) => PiReportModel;
  /** Makes saved Facility changes live; applyProjectChangesNow by default. */
  applyProjectChanges?: (context: Required<ConfigApiContext>, projectId: string) => Promise<unknown>;
  /** The latest readings and report, summarised for checking follow-ups. */
  loadReviewSummary?: (context: Required<ConfigApiContext>, projectId: string, followUps: FollowUpRecord[]) => Promise<Record<string, unknown>>;
  /** Where the project's notes live; the report agent's store by default. */
  notesStore?: NotesStore;
  now?: () => Date;
};

const text = (max: number) => z.string().trim().min(1).max(max);
const aboutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("check"), key: text(300), title: text(300) }).strict(),
  z.object({ kind: z.literal("section"), id: text(300), title: text(300) }).strict(),
]);
const submitSchema = z.object({
  requestId: z.string().uuid(),
  text: text(2000),
  about: aboutSchema.nullish(),
  reportContext: z.object({
    checks: z.array(z.object({ key: text(300), title: text(300) }).strict()).max(40),
    figures: z.array(z.string().trim().max(300)).max(20),
  }).strict().nullish(),
}).strict();
const followUpStatusSchema = z.object({ status: z.enum(["open", "done", "dropped"]), note: z.string().trim().max(500).optional() }).strict();

/** Requests being applied right now, so two clicks never apply the same change twice. */
const applying = new Set<string>();

class FeedbackHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const authorNameOf = (user: UserRecord): string => user.display_name?.trim() || user.email?.split("@")[0] || "Someone";

export async function handleReportFeedbackApi(
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>,
  dependencies: ReportFeedbackDependencies = {},
): Promise<ConfigApiResponse> {
  const headers = { "Cache-Control": "private, no-store" };
  const ok = (value: unknown): ConfigApiResponse => ({ status: 200, headers, body: createSuccessResult(value) });
  const fail = (status: number, message: string): ConfigApiResponse => ({ status, headers, body: createErrorResult(errorCode(status), message) });
  try {
    const projectId = decodeURIComponent(segments[0] ?? "");
    const metadata = context.metadataStore;
    const capabilities = resolveEnergyProjectCapabilities({ metadataStore: metadata, userId: context.userId, workspaceId: context.workspaceId, projectId });
    if (!capabilities.readReports) return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
    const user = metadata.users.getById({ user_id: context.userId });
    const admin = resolveEnergyIqUserRole(metadata, user) === "admin";
    const store = new ReportFeedbackStore(metadata.db);
    const now = () => dependencies.now?.() ?? new Date();
    const project = metadata.energyIq.getProject(projectId);
    const today = () => localDate(now().toISOString(), project.timezone);
    const resolveModel = dependencies.resolveModel ?? resolvePiReportModel;
    const aiAvailable = (): boolean => {
      try {
        const check = metadata.energyIq?.ai?.check(context.workspaceId);
        if (check && !check.allowed) return false;
        resolveModel(metadata, context.workspaceId);
        return true;
      } catch {
        return false;
      }
    };
    const state = (): ReportFeedbackState => store.state(projectId, { canGive: true, canManage: admin, aiAvailable: aiAvailable() });
    const notes = (add: string[], remove: string[]) => updateAdvisorNotes({
      metadata, projectId, workspaceId: context.workspaceId, actorUserId: user.id, add, remove, store: dependencies.notesStore,
    });
    /** A line is taken out only when no other memory or open follow-up still stands behind the same words. */
    const unusedLines = (lines: Array<string | undefined>): string[] => {
      const inUse = new Set([
        ...store.listMemory(projectId, ["active"]).map(item => item.noteLine),
        ...store.openFollowUps(projectId).map(item => item.noteLine),
      ].filter((line): line is string => !!line));
      return [...new Set(lines.filter((line): line is string => !!line && !inUse.has(line)))];
    };
    const requireAdmin = () => {
      if (!admin) throw new FeedbackHttpError(403, "REPORT_FEEDBACK_ADMIN_REQUIRED");
    };
    const rest = segments.slice(1);
    const method = (request.method ?? "GET").toUpperCase();

    if (rest.length === 0 && method === "GET") return ok(state());

    if (rest.length === 0 && method === "POST") {
      const input = submitSchema.parse(await readBody(request));
      const existing = store.findFeedbackByRequest(projectId, user.id, input.requestId);
      if (existing) {
        if (existing.text !== input.text) return fail(409, "REPORT_FEEDBACK_REQUEST_CONFLICT");
        return ok({ feedback: toFeedbackDto(existing), state: state() });
      }
      const createdAt = now().toISOString();
      const inserted = store.insertFeedback({
        id: randomUUID(), projectId, requestId: input.requestId, text: input.text, about: input.about ?? null,
        authorUserId: user.id, authorName: authorNameOf(user), createdAt, status: "saved", reply: null, memoryIds: [], followUpIds: [], suggestions: [],
      });
      if (!inserted.created) {
        if (inserted.record.text !== input.text) return fail(409, "REPORT_FEEDBACK_REQUEST_CONFLICT");
        return ok({ feedback: toFeedbackDto(inserted.record), state: state() });
      }
      let record: FeedbackRecord = inserted.record;
      const memoryStatus = admin ? "active" as const : "pending" as const;
      let result: ClassifyResult | null = null;
      try {
        result = await classifyFeedback({
          site: readFeedbackSite(metadata, projectId, now()),
          memory: store.listMemory(projectId, ["active"]).slice(0, 60).map(item => ({ text: item.text, kind: item.kind })),
          followUps: store.openFollowUps(projectId).slice(0, 30).map(item => ({ text: item.text, checkBy: item.checkBy })),
          about: input.about ?? null,
          reportContext: input.reportContext ? { checks: input.reportContext.checks, figures: input.reportContext.figures.filter(Boolean) } : null,
          text: input.text,
        }, {
          metadata, workspaceId: context.workspaceId, projectId, userId: user.id,
          ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}), resolveModel,
        });
      } catch (error) {
        // AI off, not set up, over its limit or failing: the feedback is still kept, as one thing to remember.
        console.warn(`[report-feedback] AI not used project=${projectId} code=${error instanceof Error ? error.message : "unknown"}`);
        result = null;
      }
      const addLines: string[] = [];
      const evictedLines: Array<string | undefined> = [];
      const remember = (memoryText: string, kind: MemoryRecord["kind"]): string => {
        const added = store.addMemory(projectId, { text: memoryText, kind, status: memoryStatus, authorUserId: user.id, authorName: authorNameOf(user), sourceFeedbackId: record.id }, now());
        evictedLines.push(...added.evicted.map(item => item.noteLine));
        if (added.memory.status === "active") {
          const line = memoryNoteLine(today(), added.memory.text);
          store.saveMemory({ ...added.memory, noteLine: line });
          addLines.push(line);
        }
        return added.memory.id;
      };
      if (result) {
        const memoryIds = result.memory.map(item => remember(item.text, item.kind));
        // Follow-ups reach the advisor's notes only from someone who may edit those notes themselves; anyone else's
        // still show in the reports, and go to the notes if an administrator re-opens them.
        const writesNotes = admin || capabilities.editNotes;
        const followUpIds = result.followUps.map(item => {
          const added = store.addFollowUp(projectId, { text: item.text, checkBy: item.checkBy, sourceFeedbackId: record.id, authorUserId: user.id }, now());
          evictedLines.push(...added.evicted.map(evicted => evicted.noteLine));
          if (writesNotes) {
            const line = followUpNoteLine(today(), added.followUp.text);
            store.saveFollowUp({ ...added.followUp, noteLine: line });
            addLines.push(line);
          }
          return added.followUp.id;
        });
        const suggestions: SuggestionDto[] = result.suggestions.map(item => ({ id: randomUUID(), kind: item.kind, label: item.label, payload: item.payload as Record<string, unknown>, status: "open" }));
        record = { ...record, status: "processed", reply: result.reply, memoryIds, followUpIds, suggestions };
      } else {
        record = { ...record, memoryIds: [remember(input.text, "fact")] };
      }
      store.saveFeedback(record);
      notes(addLines, unusedLines(evictedLines));
      return ok({ feedback: toFeedbackDto(record), state: state() });
    }

    if (rest[0] === "suggestions" && rest[1] && rest.length === 3 && method === "POST" && (rest[2] === "apply" || rest[2] === "dismiss")) {
      requireAdmin();
      const suggestionId = rest[1];
      const found = store.findSuggestion(projectId, suggestionId);
      if (!found) return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
      if (rest[2] === "dismiss") {
        if (found.suggestion.status === "applied") return fail(409, "REPORT_FEEDBACK_ALREADY_APPLIED");
        store.updateSuggestion(projectId, suggestionId, current => ({ ...current, status: "dismissed" }));
        return ok({ state: state() });
      }
      if (found.suggestion.status === "applied") return fail(409, "REPORT_FEEDBACK_ALREADY_APPLIED");
      if (found.suggestion.status === "dismissed") return fail(409, "REPORT_FEEDBACK_SUGGESTION_DISMISSED");
      const lock = `${projectId}:${suggestionId}`;
      if (applying.has(lock)) return fail(409, "REPORT_FEEDBACK_ALREADY_APPLYING");
      applying.add(lock);
      try {
        await applySuggestionChange({
          context, projectId, user, store, now: now(),
          applyProjectChanges: dependencies.applyProjectChanges ?? defaultApplyProjectChanges,
        }, found.suggestion);
      } catch (error) {
        const failure = error instanceof ApplyError ? error : new ApplyError(409, "The change could not be made. Try again, or make it in Facility.");
        if (!(error instanceof ApplyError)) console.warn(`[report-feedback] apply failed project=${projectId} code=${error instanceof Error ? error.message : "unknown"}`);
        store.updateSuggestion(projectId, suggestionId, current => ({ ...current, status: "failed", error: failure.message }));
        return fail(failure.status, failure.message);
      } finally {
        applying.delete(lock);
      }
      const appliedAt = now().toISOString();
      const applied = store.updateSuggestion(projectId, suggestionId, current => {
        const next: SuggestionDto = { ...current, status: "applied", appliedAt, appliedByName: authorNameOf(user) };
        delete next.error;
        return next;
      });
      recordApplied(metadata, user, context.workspaceId, projectId, applied);
      return ok({ state: state(), applied: applied.label });
    }

    if (rest[0] === "memory" && rest[1] && rest.length === 3 && rest[2] === "approve" && method === "POST") {
      requireAdmin();
      const current = store.getMemory(projectId, rest[1]);
      if (!current || current.status === "removed") return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
      if (current.status === "active") return ok({ state: state() });
      const activated = store.activateMemory(projectId, current.id, now());
      const line = memoryNoteLine(today(), activated.memory.text);
      store.saveMemory({ ...activated.memory, noteLine: line });
      notes([line], unusedLines(activated.evicted.map(item => item.noteLine)));
      return ok({ state: state() });
    }

    if (rest[0] === "memory" && rest[1] && rest.length === 2 && method === "DELETE") {
      const current = store.getMemory(projectId, rest[1]);
      if (!current || current.status === "removed") return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
      if (!admin && !(current.authorUserId === user.id && current.status === "pending")) return fail(403, "REPORT_FEEDBACK_ADMIN_REQUIRED");
      const { noteLine, ...kept } = current;
      store.saveMemory({ ...kept, status: "removed", updatedAt: now().toISOString() });
      notes([], unusedLines([noteLine]));
      return ok({ state: state() });
    }

    if (rest[0] === "follow-ups" && rest[1] === "review" && rest.length === 2 && method === "POST") {
      requireAdmin();
      const open = store.openFollowUps(projectId);
      if (!open.length) return ok({ state: state() });
      if (!aiAvailable()) return fail(503, "REPORT_FEEDBACK_AI_UNAVAILABLE");
      let summary: Record<string, unknown>;
      try {
        summary = await (dependencies.loadReviewSummary ?? defaultReviewSummary)(context, projectId, open);
      } catch (error) {
        console.warn(`[report-feedback] readings not loaded for follow-ups project=${projectId} code=${error instanceof Error ? error.message : "unknown"}`);
        return fail(409, "REPORT_FEEDBACK_READINGS_UNAVAILABLE");
      }
      try {
        await recordFollowUpReview({
          metadata, workspaceId: context.workspaceId, projectId, userId: user.id, followUps: open, summary, now: now(),
          ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}), resolveModel,
        });
      } catch (error) {
        console.warn(`[report-feedback] follow-up check failed project=${projectId} code=${error instanceof Error ? error.message : "unknown"}`);
        return fail(503, "REPORT_FEEDBACK_AI_UNAVAILABLE");
      }
      return ok({ state: state() });
    }

    if (rest[0] === "follow-ups" && rest[1] && rest.length === 3 && rest[2] === "status" && method === "POST") {
      requireAdmin();
      const input = followUpStatusSchema.parse(await readBody(request));
      const current = store.getFollowUp(projectId, rest[1]);
      if (!current) return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
      const at = now().toISOString();
      const next: FollowUpRecord = { ...current, updatedAt: at };
      if (input.note !== undefined) {
        if (input.note) next.note = input.note;
        else delete next.note;
      }
      if (input.status === current.status) {
        store.saveFollowUp(next);
      } else if (input.status === "open") {
        // Re-opened: back in the advisor's notes, dated today.
        const line = followUpNoteLine(today(), current.text);
        delete next.closedAt;
        store.saveFollowUp({ ...next, status: "open", noteLine: line });
        const evicted = store.enforceFollowUpLimit(projectId, now());
        notes([line], unusedLines(evicted.map(item => item.noteLine)));
      } else {
        const line = next.noteLine;
        delete next.noteLine;
        store.saveFollowUp({ ...next, status: input.status, closedAt: at });
        notes([], unusedLines([line]));
      }
      return ok({ state: state() });
    }

    return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
  } catch (error) {
    if (error instanceof FeedbackHttpError) return fail(error.status, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return fail(422, "REPORT_FEEDBACK_INPUT_INVALID");
    const message = error instanceof Error ? error.message : "";
    if (message.includes("NOT_FOUND")) return fail(404, "REPORT_FEEDBACK_NOT_FOUND");
    console.warn(`[report-feedback] request failed code=${message || "unknown"}`);
    return fail(500, "REPORT_FEEDBACK_OPERATION_FAILED");
  }
}

const errorCode = (status: number): AppErrorCode =>
  status === 403 ? "FORBIDDEN"
    : status === 404 ? "RESOURCE_NOT_FOUND"
      : status === 409 ? "CONFLICT"
        : status === 503 ? "NOT_ENABLED"
          : status >= 500 ? "INTERNAL_ERROR"
            : "BAD_REQUEST";

/** Who applied which change, in the same audit history as other project changes. Never fails the change itself. */
function recordApplied(metadata: MetadataStore, user: UserRecord, workspaceId: string, projectId: string, suggestion: SuggestionDto): void {
  try {
    metadata.authAuditEvents.append({
      id: randomUUID(),
      event_type: "energyiq.report_feedback_applied",
      user_id: user.id,
      ...(user.email ? { email: user.email } : {}),
      metadata: { workspaceId, projectId, kind: suggestion.kind, suggestionId: suggestion.id, label: suggestion.label },
    });
  } catch (error) {
    console.warn(`[audit] could not record energyiq.report_feedback_applied: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

const defaultApplyProjectChanges = async (context: Required<ConfigApiContext>, projectId: string): Promise<unknown> => {
  const { applyProjectChangesNow } = await import("../energy/energy-api.js");
  return applyProjectChangesNow(context, projectId);
};

const defaultReviewSummary = (context: Required<ConfigApiContext>, projectId: string, followUps: FollowUpRecord[]) => loadFollowUpSummary({
  metadata: context.metadataStore, dataGateway: context.dataGateway, workspaceId: context.workspaceId, projectId, actorUserId: context.userId, followUps,
});

/** Feedback with its report context fits well within this, in any language. */
const MAX_BODY_BYTES = 128 * 1024;

async function readBody(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new SyntaxError("Body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

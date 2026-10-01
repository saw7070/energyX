import { reportSkillCatalog, resolveReportSkillSelection, saveReportSkill, saveReportSkillSchema, skillSelectionSchema } from "./report-skill-catalog.js";
import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import type { IncomingMessage } from "node:http";
import { extname } from "node:path";
import { z } from "zod";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { readMultipartFiles } from "../upload-parser.js";
import { authorizeReportConversation } from "./report-access.js";
import { availableReportPeriod, latestReportPeriod, presetReportPeriod, resolveRequestedReportPeriod } from "./report-periods.js";
import { readReportProjectData } from "./report-project-data.js";
import { findReportService } from "./report-service.js";
import type { ReportSettings } from "./report-store.js";

const settingsSchema = z.object({
  contextNotes: z.string().max(100_000), fileRefIds: z.array(z.string().min(1)).max(20),
  useProjectData: z.boolean(), skill: z.string().max(100_000), revision: z.number().int().nonnegative(),
  frequency: z.enum(["off", "daily", "weekly", "monthly", "weekly-monthly"]), localHour: z.number().int().min(0).max(23),
  scheduledPrompt: z.string().max(20_000),
  comparisonPeriod: z.object({ from: z.string(), toExclusive: z.string() }).optional(),
  skillRefs: z.array(z.object({ name: z.string().min(1).max(100), version: z.string().min(1).max(100), content: z.string().min(1).max(50000), scope: z.enum(["general", "project"]).optional(), category: z.enum(["analysis", "presentation", "other"]).optional(), sourceRunId: z.string().uuid().optional(), sourceSessionId: z.string().uuid().optional() })).max(5).optional(),
  skillSourceRunId: z.string().uuid().optional(),
});
const runSchema = z.object({
  skillSelection: skillSelectionSchema.optional(),
  fileRefIds: z.array(z.string().min(1)).max(20).optional(),
  periodPreset: z.enum(["recent", "previous-month", "previous-week", "previous-day", "all", "custom"]).optional(),
  sessionId: z.string().uuid().optional(),
  period: z.object({ from: z.string(), toExclusive: z.string() }).optional(),
  prompt: z.string().min(1).max(20_000), kind: z.enum(["report", "skill", "chat"]).optional(), parentRunId: z.string().uuid().optional(),
});

export async function handleReportApi(request: IncomingMessage, segments: string[], context: Required<ConfigApiContext>): Promise<ConfigApiResponse> {
  try {
    const projectId = segments[0] ? decodeURIComponent(segments[0]) : "";
    const { canManageProject, canChat } = authorizeReportConversation(context.metadataStore, context.userId, context.workspaceId, projectId);
    const service = findReportService(context.metadataStore);
    if (!service) return { status: 503, body: createErrorResult("NOT_ENABLED", "REPORT_AGENT_NOT_ENABLED") };
    const project = context.metadataStore.energyIq.getProject(projectId);
    const storedSettings = service.store.settings(projectId) ?? {
      projectId, workspaceId: project.workspace_id, actorUserId: context.userId, timezone: project.timezone,
      contextNotes: "", fileRefIds: [], useProjectData: true, skill: "", revision: 0,
      frequency: "off", localHour: 3, scheduledPrompt: "",
    } satisfies ReportSettings;
    const settings = canManageProject ? storedSettings : { ...storedSettings, fileRefIds: [] };
    const action = segments[1];
    // Stop remains available to the owner after revocation; new work does not.
    if (request.method !== "GET" && !(action === "runs" && segments[3] === "stop") && !canChat) throw new Error("REPORT_EXECUTION_FORBIDDEN");
    if (action === "skills" && !canManageProject) throw new Error("REPORT_SKILL_FORBIDDEN");
    // Anyone in the workspace may ask the advisor for their own report; only project managers change what the
    // project itself uses: its saved skills, its notes and its automatic schedule.
    if (request.method !== "GET" && !canManageProject
      && (action === "settings" || (action === "skills" && request.method === "POST"))) throw new Error("REPORT_SETTINGS_FORBIDDEN");
    if (segments.length === 1 && request.method === "GET") {
      const availablePeriod = await availableReportPeriod(context.metadataStore, context.fileAssetService, settings, context.userId);
      return ok({ canManageProject, canChat,
        // A reader may ask the advisor, but the project's own notes, methods and schedule stay with its managers.
        settings: canManageProject ? settings : { ...settings, contextNotes: "", fileRefIds: [], skill: "", skillRefs: [], styleSkill: undefined, scheduledPrompt: "", skillUsage: undefined, skillSourceRunId: undefined, skillSourceSessionId: undefined },
        skills: canManageProject ? reportSkillCatalog(context, settings, canManageProject) : [], projectData: await readReportProjectData(context.metadataStore, context.userId, context.workspaceId, projectId), periodOptions: { defaultPeriod: latestReportPeriod(availablePeriod), calendarToday: presetReportPeriod("previous-day").toExclusive, availablePeriod,
        availablePeriodReason: availablePeriod ? null : "Available dates could not be determined from the current project snapshot and selected CSV files. Check data access and CSV timestamp columns (interval_start/end_utc, interval_start/end_sgt, interval_start/end, timestamp, datetime, date or event_time)." }, dataSummary: service.dataSummary(projectId, context.userId), sessions: service.store.sessions(projectId, context.userId), runs: service.store.list(projectId).filter(run => run.actorUserId === context.userId && !run.actionEstimate && !run.actionProgress).map(({ settings: snapshot, ...run }) => ({ ...run, skillUsage: snapshot.skillUsage ?? [] })),
        files: canManageProject ? context.fileAssetService.listRefs({ user_id: context.userId, workspace_id: context.workspaceId, limit: 100 }).map(({ ref, asset }) => ({ id: ref.id, filename: ref.filename, bytes: asset.size_bytes })) : [],
      });
    }
    // Just the project notes and report schedule, for pages (Facility, Overview) that do not need report
    // history, files, skills or available report periods, which are slow to build.
    if (action === "context" && segments.length === 2 && request.method === "GET") {
      return ok({
        contextNotes: canManageProject ? settings.contextNotes : "",
        revision: settings.revision,
        settings: { frequency: settings.frequency, localHour: settings.localHour, timezone: settings.timezone },
      });
    }
    if (action === "skills" && segments.length === 2 && request.method === "GET") return ok({ skills: reportSkillCatalog(context, settings, canManageProject) });
    if (action === "skills" && segments.length === 2 && request.method === "POST") {
      const body = saveReportSkillSchema.parse(await readBody(request));
      if (body.scope === "project" && !canManageProject) throw new Error("REPORT_ADMIN_REQUIRED");
      let source;
      if (body.sourceRunId) {
        const run = service.store.get(projectId, body.sourceRunId);
        if (run.actorUserId !== context.userId || run.workspaceId !== context.workspaceId) throw new Error("REPORT_SKILL_SOURCE_FORBIDDEN");
        if (run.status !== "succeeded" || (run.kind !== "skill" && !run.hasSkillDraft)) throw new Error("REPORT_SKILL_SOURCE_REQUIRED");
        source = { sourceRunId: run.id, sourceSessionId: run.sessionId };
      }
      return ok(await saveReportSkill(context, settings, body, canManageProject, source));
    }
    if (action === "skills" && segments[2] === "default" && segments.length === 3 && request.method === "POST") {
      if (!canManageProject) throw new Error("REPORT_ADMIN_REQUIRED");
      const body = z.object({ id: z.string(), version: z.string(), revision: z.number().int() }).parse(await readBody(request));
      const skill = reportSkillCatalog(context, settings, canManageProject).find(item => item.id === body.id && item.version === body.version);
      if (!skill || skill.required || skill.scope === "personal") throw new Error("REPORT_SKILL_DEFAULT_FORBIDDEN");
      if (skill.category === "presentation") {
        return ok(service.store.saveSettings({ ...settings, revision: body.revision,
          styleSkill: { id: skill.id, name: skill.name, version: skill.version, content: skill.content },
          skillRefs: settings.skillRefs?.filter(ref => ref.category !== "presentation"),
          actorUserId: context.userId, skillUsage: undefined }));
      }
      // Explicitly replace the primary project method; other accepted references remain intact.
      return ok(service.store.saveSettings({ ...settings, revision: body.revision, skill: skill.content, actorUserId: context.userId, skillUsage: undefined, skillSourceRunId: undefined, skillSourceSessionId: undefined }));
    }
    if (action === "sessions" && segments.length === 2 && request.method === "POST") return ok(service.store.createSession(settings, context.userId));
    if (action === "runs" && segments.length === 4) {
      const run = service.store.get(projectId, segments[2]!);
      if (run.actorUserId !== context.userId) throw new Error("REPORT_SESSION_FORBIDDEN");
      if (segments[3] === "events" && request.method === "GET") {
        const after = Number(new URL(request.url ?? "/", "http://localhost").searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new Error("REPORT_INPUT_INVALID");
        return ok({ events: service.store.events(run.id, after) });
      }
      if (segments[3] === "stop" && request.method === "POST") return ok(service.cancel(projectId, run.id));
      if (segments[3] === "resume" && request.method === "POST") {
        const resumed = service.store.resume(projectId, run.id, context.userId);
        void service.tick();
        return { status: 202, body: createSuccessResult({ id: resumed.id }) };
      }
    }
    if (action === "settings" && segments.length === 2 && request.method === "PUT") {
      if (!canManageProject) throw new Error("REPORT_ADMIN_REQUIRED");
      const body = settingsSchema.parse(await readBody(request));
      for (const id of body.fileRefIds) context.fileAssetService.getRef({ user_id: context.userId, workspace_id: context.workspaceId, id });
      return ok(service.store.saveSettings({ ...settings, ...body, schedulePermissionIssue: undefined, actorUserId: context.userId, timezone: project.timezone }));
    }
    if (action === "inputs" && segments.length === 2 && request.method === "POST") {
      const uploaded = await readMultipartFiles(request, { maxFiles: 1, maxFileBytes: 50 * 1024 * 1024 });
      const file = uploaded.files[0];
      if (!file || ![".csv", ".xlsx", ".pptx", ".pdf", ".md", ".txt", ".json", ".parquet"].includes(extname(file.filename).toLowerCase())) throw new Error("REPORT_FILE_TYPE_INVALID");
      const { ref } = context.fileAssetService.createRef({ user_id: context.userId, workspace_id: context.workspaceId, source: "upload", filename: file.filename,
        content: file.content, declared_mime_type: file.mimeType, metadata: { reportProjectId: projectId } });
      return ok({ id: ref.id, filename: ref.filename });
    }
    if (action === "runs" && segments.length === 2 && request.method === "POST") {
      const body = runSchema.parse(await readBody(request));
      if (!settings.revision && canManageProject) throw new Error("REPORT_SETTINGS_REQUIRED");
      if (body.kind === "skill" && !body.parentRunId) {
        if (!body.sessionId) throw new Error("REPORT_SKILL_SOURCE_REQUIRED");
        service.store.session(projectId, body.sessionId, context.userId, context.workspaceId);
        if (!service.store.sessionRuns(projectId, body.sessionId, { status: "succeeded", limit: 1 }).length) throw new Error("REPORT_SKILL_SOURCE_REQUIRED");
      }
      const runSettings = { ...resolveReportSkillSelection(settings, reportSkillCatalog(context, settings, canManageProject), body.skillSelection), fileRefIds: body.fileRefIds ?? settings.fileRefIds };
      for (const id of runSettings.fileRefIds) context.fileAssetService.getRef({ user_id: context.userId, workspace_id: context.workspaceId, id });
      const parent = body.parentRunId ? service.store.get(projectId, body.parentRunId) : undefined;
      if (parent && parent.actorUserId !== context.userId) throw new Error("REPORT_SESSION_FORBIDDEN");
      const sessionId = body.sessionId ?? (body.parentRunId ? service.store.get(projectId, body.parentRunId).sessionId : undefined);
      let inherited;
      if (!body.period && !body.periodPreset && sessionId) {
        service.store.session(projectId, sessionId, context.userId, context.workspaceId);
        inherited = parent ?? service.store.sessionRuns(projectId, sessionId, { limit: 1 })[0];
      }
      const period = resolveRequestedReportPeriod({ period: body.period, preset: body.periodPreset, inherited: inherited?.period,
        ...(!body.period && !inherited && (!body.periodPreset || body.periodPreset === "all" || body.periodPreset === "recent") ? { available: await availableReportPeriod(context.metadataStore, context.fileAssetService, runSettings, context.userId) } : {}),
      });
      const periodPreset = body.period ? "custom" : body.periodPreset ?? inherited?.periodPreset ?? (inherited ? "custom" : "recent");
      const continuity = !sessionId && !parent && body.kind !== "skill"
        ? service.store.previousPeriodReport({ ...runSettings, actorUserId: context.userId }, period) : undefined;
      const run = service.store.enqueue({ period, periodPreset, ...(inherited?.reportingPeriod ? { reportingPeriod: inherited.reportingPeriod } : {}), prompt: body.prompt, settings: runSettings, actorUserId: context.userId,
        ...(continuity ? {continuityRunId:continuity.id} : {}),
        ...(body.sessionId ? { sessionId: body.sessionId } : {}), ...(body.kind ? { kind: body.kind } : {}), ...(body.parentRunId ? { parentRunId: body.parentRunId } : {}) });
      void service.tick();
      return { status: 202, body: createSuccessResult({ id: run.id }) };
    }
    if (action === "draft-skill" && segments.length === 3 && request.method === "GET") {
      const run = service.store.get(projectId, segments[2]!);
      if (run.actorUserId !== context.userId) throw new Error("REPORT_SESSION_FORBIDDEN");
      return ok({ content: service.skillDraft(projectId, run.id) });
    }
    if (action === "output" && segments.length === 3 && request.method === "GET") {
      const run = service.store.get(projectId, segments[2]!);
      if (run.actorUserId !== context.userId) throw new Error("REPORT_SKILL_SOURCE_FORBIDDEN");
      return ok({ content: service.output(projectId, run.id) });
    }
    return { status: 404, body: createErrorResult("RESOURCE_NOT_FOUND", "REPORT_ROUTE_NOT_FOUND") };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const message = error instanceof z.ZodError ? "REPORT_INPUT_INVALID" : /^[A-Z0-9_]+$/.test(raw) ? raw : "REPORT_REQUEST_FAILED";
    const forbidden = message.includes("FORBIDDEN") || message.includes("ADMIN_REQUIRED");
    const conflict = message.includes("CHANGED") || message.includes("RUNNING");
    return { status: forbidden ? 403 : conflict ? 409 : 400, body: createErrorResult(forbidden ? "FORBIDDEN" : conflict ? "CONFLICT" : "BAD_REQUEST", message) };
  }
}

function ok(data: unknown): ConfigApiResponse { return { status: 200, headers: { "Cache-Control": "private, no-store" }, body: createSuccessResult(data) }; }
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 512 * 1024) throw new Error("REPORT_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

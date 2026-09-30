import { ActionNotifications } from "./action-notifications.js";
import { KeyPointStore } from "./key-point-store.js";
import { keyPointSelectionSchema } from "./key-point-selection.js";
import { ActionProgressDrafts } from "./action-progress-drafts.js";
import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { projectExplorerMeters } from "../energy/energy-explorer-meters.js";
import { shiftReportDate } from "./report-calendar.js";
import { localDate } from "./action-data.js";
import { readActionEvidence, readActionGroupEvidence } from "./action-data.js";
import { checkActionFeedback, retryActionFeedback } from "./action-feedback.js";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { resolveEnergyPublishedMeterPoints } from "../energy/energy-query-context.js";
import { resolveEnergyProjectCapabilities } from "../energy/energy-project-capabilities.js";
import { resolveEnergyIqUserRole } from "../energy/energy-user-role.js";
import { ActionStore, proposalSchema } from "./action-store.js";
import { estimateLighting } from "./action-analysis.js";
import { ActionEstimates, estimatePeriod } from "./action-estimates.js";
import { readReportProjectData } from "./report-project-data.js";
import { findReportService } from "./report-service.js";
import { hasReportArtifact } from "./report-store.js";
import { ACTION_EXTRACTION_PROMPT } from "./action-suggestions.js";
import { canUseActions } from "./action-access.js";
import { InsightStore } from "./insight-store.js";
import { validateActionSuggestions } from "./action-suggestions.js";
import { ActionDemonstrations, actionExperience } from "./action-demonstration.js";

/** Pilot: explicit platform-admin private actions. No implicit member or chat write grant. */
export async function handleActionApi(
  request: IncomingMessage,
  segments: string[],
  context: Pick<Required<ConfigApiContext>, "metadataStore" | "userId" | "workspaceId">,
): Promise<ConfigApiResponse> {
  const headers = { "Cache-Control": "private, no-store" };
  const ok = (value: unknown): ConfigApiResponse => ({
    status: 200,
    headers,
    body: createSuccessResult(value),
  });
  const fail = (status: number, message: string): ConfigApiResponse => ({
    status,
    headers,
    body: createErrorResult(
      status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "RESOURCE_NOT_FOUND"
          : "BAD_REQUEST",
      message,
    ),
  });
  try {
    if (process.env.ENERGYIQ_ACTIONS_PILOT_ENABLED !== "true")
      return fail(404, "ACTION_NOT_FOUND");
    const projectId = segments[0] ?? "";
    const scope = {
      workspaceId: context.workspaceId,
      projectId,
      userId: context.userId,
    };
    const caps = resolveEnergyProjectCapabilities({
      ...scope,
      metadataStore: context.metadataStore,
    });
    if (!caps.readReports) return fail(404, "ACTION_NOT_FOUND");
    const admin =
      resolveEnergyIqUserRole(
        context.metadataStore,
        context.metadataStore.users.getById({ user_id: context.userId }),
      ) === "admin";
    if (!canUseActions(context.metadataStore, scope))
      return fail(403, "ACTION_ACCESS_NOT_ENABLED");
    const store = new ActionStore(context.metadataStore.db);
    const service = findReportService(context.metadataStore);
    if (!service) return fail(503, "REPORT_AGENT_NOT_ENABLED");
    const project = context.metadataStore.energyIq.getProject(projectId);
    if (segments[1] === "key-points" && segments[2] === "retry" && segments.length === 3 && request.method === "POST") {
      if (!admin) return fail(403,"ACTION_ADMIN_REQUIRED");
      const input=z.object({reportId:z.string().uuid()}).strict().parse(await body(request));
      const report=service.store.get(projectId,input.reportId);
      if(report.workspaceId!==scope.workspaceId || report.actorUserId!==scope.userId || report.status!=="succeeded" || !hasReportArtifact(report) || report.actionFeedback) return fail(409,"KEY_POINT_REPORT_NOT_READY");
      await service.publishReportActions(report);
      return ok({publication:new KeyPointStore(context.metadataStore.db).latest(scope)});
    }
    if (segments[1] === "key-points" && segments.length === 2) {
      const publications = new KeyPointStore(context.metadataStore.db);
      const insights = new InsightStore(context.metadataStore.db).list(scope);
      const shared = store.listProject(scope, true);
      if (request.method === "GET") {
        const publication = publications.latest(scope);
        if (!publication) return ok({publication: null});
        let metrics: ReturnType<typeof service.keyPointMetrics> | null = null;
        try { metrics = service.keyPointMetrics(publication.reportId); } catch { /* Keep reviewed actions readable if archived inputs are unavailable. */ }
        // Which report the Overview comes from, and whether readings newer than that report have been published since.
        let source: { reportId: string; category: "scheduled" | "custom"; version: number; createdAt: string; finishedAt: string | null; period: { from: string; toExclusive: string }; newerDataAvailable: boolean } | null = null;
        try {
          const run = service.store.get(projectId, publication.reportId);
          const lineage = service.store.libraryMetadata(projectId, run.id);
          const reportSnapshot = service.reportDataSnapshotId(run.id);
          const currentSnapshot = context.metadataStore.energyIq.findCurrentDataSnapshot(projectId)?.id ?? null;
          source = { reportId: run.id, category: lineage.category, version: lineage.version, createdAt: run.createdAt, finishedAt: run.finishedAt ?? null,
            period: run.reportingPeriod ?? { from: run.period.from, toExclusive: run.period.toExclusive }, newerDataAvailable: !!reportSnapshot && !!currentSnapshot && reportSnapshot !== currentSnapshot };
        } catch { /* The Overview still shows its key points if the source run cannot be read. */ }
        // Re-read live status: feedback or retirement must not be hidden by a saved card.
        const active = publication.selection.active.filter(item =>
          shared.some(a => a.id === item.actionId && !["declined", "paused", "scheduled", "implemented"].includes(a.state)) &&
          insights.some(i => i.id === item.insightId && i.actionIds.includes(item.actionId) && !["resolved", "archived"].includes(i.review.status)));
        return ok({publication: {...publication, selection: {...publication.selection, summary:publication.selection.featuredActionIds.every(id=>active.some(a=>a.actionId===id))?publication.selection.summary:undefined, active,
          featuredActionIds: publication.selection.featuredActionIds.filter(id => active.some(item => item.actionId === id))}},
          metrics, source, siteNotes:Object.fromEntries(active.map(a=>[a.actionId,store.siteNotes(scope,a.actionId)])), actionStates: Object.fromEntries(shared.map(a => [a.id,a.state]))});
      }
      if (request.method === "POST") {
        if (!admin) return fail(403, "ACTION_ADMIN_REQUIRED");
        const input = z.object({reportId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),selection:keyPointSelectionSchema}).strict().parse(await body(request));
        const report = service.store.get(projectId,input.reportId);
        if (report.workspaceId !== scope.workspaceId || report.status !== "succeeded" || !hasReportArtifact(report) || report.actionFeedback)
          return fail(409,"KEY_POINT_REPORT_NOT_READY");
        if (input.selection.active.some(item => !shared.some(a => a.id === item.actionId && !["declined", "paused", "scheduled", "implemented"].includes(a.state)) || !store.sources(scope,item.actionId).some(source => source.reportId === report.id)))
          return fail(409,"KEY_POINT_REPORT_REFERENCE_INVALID");
        return ok({publication:publications.publish(scope,report.id,input.expectedRevision,input.selection,insights,new Set(shared.map(a => a.id)))});
      }
    }
    if(segments[1]==="notifications"){
      const notifications=new ActionNotifications(context.metadataStore.db);
      if(segments.length===2&&request.method==="GET")return ok({items:notifications.list(scope,service.store)});
      if(segments.length===3&&request.method==="POST"){notifications.read(scope,service.store,z.string().uuid().parse(segments[2]));return ok({read:true});}
    }

    const meters = () => {
      const allowed = resolveEnergyPublishedMeterPoints({
        metadataStore: context.metadataStore,
        projectId,
        hierarchyRevisionId: project.hierarchy_revision_id,
        resource: "electricity",
      });
      const revision = context.metadataStore.energyIq.projectSetup
        .listHierarchyRevisions(projectId)
        .find((r) => r.id === project.hierarchy_revision_id);
      if (!revision) return allowed;
      const document = JSON.parse(
        revision.snapshot_json,
      ) as EnergyIqProjectSetupDocument;
      const names = projectExplorerMeters({
        document,
        resource: "electricity",
        officialMeterIds: new Set(),
        scopeIds: new Set(
          document.meter_mapping?.rows.map(
            (r) => r.navigation_scope_id ?? r.scope_id,
          ) ?? [],
        ),
      });
      return allowed.map((meter) => {
        const display = names.find((entry) => entry.id === meter.meterPointId);
        return {
          ...meter,
          sourceLabel: display
            ? display.name +
              (display.circuitName && display.circuitName !== display.name
                ? ` (${display.circuitName})`
                : "")
            : meter.sourceLabel,
        };
      });
    };
    const source = (id: string, allowFeedback = false) => {
      const run = service.store.get(projectId, id);
      if (
        run.workspaceId !== scope.workspaceId ||
        run.status !== "succeeded" ||
        !hasReportArtifact(run) ||
        run.actionExtraction ||
        (run.actionFeedback && !allowFeedback)
      )
        throw new Error("ACTION_NOT_FOUND");
      return run;
    };
    const suggestions = (reportId: string) => {
      const runId = store.extraction(reportId);
      if (runId) {
        const run = service.store.get(projectId, runId);
        if (
          run.workspaceId !== scope.workspaceId ||
          run.actionExtraction?.sourceReportId !== reportId
        )
          throw new Error("ACTION_NOT_FOUND");
        if (run.status !== "succeeded")
          return { status: run.status, runId, items: [] };
      }
      try {
        return {
          status: "succeeded" as const,
          ...(runId ? { runId } : {}),
          items: service.actionSuggestions(projectId, reportId, runId),
        };
      } catch (error) {
        const missing =
          error instanceof Error && "code" in error && error.code === "ENOENT";
        return {
          status:
            runId || !missing ? ("failed" as const) : ("not_started" as const),
          ...(runId ? { runId } : {}),
          items: [],
          ...(runId || !missing
            ? {
                issue:
                  "Recommendations could not be verified against this report. Try extracting them again.",
              }
            : {}),
        };
      }
    };
    if (segments.length === 3 && segments[1] === "insights" && segments[2] === "merge" && request.method === "POST") {
      if (!admin) return fail(403,"ACTION_ADMIN_REQUIRED");
      return ok(new InsightStore(context.metadataStore.db).merge(scope, await body(request)));
    }
    if (segments.length === 4 && segments[1] === "insight-merges" && segments[3] === "undo" && request.method === "POST") {
      if (!admin) return fail(403,"ACTION_ADMIN_REQUIRED");
      const input=z.object({reason:z.string().trim().min(12).max(1200)}).strict().parse(await body(request));
      return ok(new InsightStore(context.metadataStore.db).undoMerge(scope,segments[2]!,input.reason));
    }
    if (segments.length === 4 && segments[1] === "insights" && segments[3] === "review" && request.method === "POST") {
      if (!admin) return fail(403, "ACTION_ADMIN_REQUIRED");
      return ok(new InsightStore(context.metadataStore.db).review(scope, segments[2]!, await body(request)));
    }
    if(segments.length===2&&segments[1]==="insights"){
      const insights=new InsightStore(context.metadataStore.db);
      if(request.method==="GET")return ok({insights:insights.list(scope)});
      if(request.method==="POST"){
        if(!admin)return fail(403,"ACTION_ADMIN_REQUIRED");
        const input=z.object({actionId:z.string().uuid(),title:z.string().min(1).max(160),summary:z.string().min(12).max(1200),sourceQuote:z.string().min(12).max(600),existingInsightId:z.string().uuid().optional()}).strict().parse(await body(request));
        const a=store.get(scope,input.actionId);if(a.visibility!=="project")return fail(403,"ACTION_ACCESS_NOT_ENABLED");
        const alreadyBound=insights.list(scope).find(i=>i.actionIds.includes(a.id));
        if(alreadyBound && input.existingInsightId && alreadyBound.id!==input.existingInsightId)return fail(409,"INSIGHT_REASSIGNMENT_REQUIRES_REVIEW");
        source(a.sourceReportId);
        validateActionSuggestions({recommendations:[{title:input.title,recommendation:input.summary,meterId:a.meterIds[0]??null,sourceQuote:input.sourceQuote}]},service.output(projectId,a.sourceReportId),new Set(a.meterIds));
        return ok(insights.attach(scope,a.id,a.meterIds,a.sourceReportId,{title:input.title,summary:input.summary,sourceQuote:input.sourceQuote},input.existingInsightId));
      }
    }
    if (
      segments.length === 2 &&
      segments[1] === "suggestions" &&
      request.method === "POST"
    ) {
      const input = z
        .object({ sourceReportId: z.string().uuid() })
        .strict()
        .parse(await body(request));
      const parent = source(input.sourceReportId);
      if (!admin || parent.actorUserId !== scope.userId)
        return fail(403, "ACTION_EXTRACTION_FORBIDDEN");
      if (parent.actionFeedback)
        return fail(422, "ACTION_ORIGINAL_REPORT_REQUIRED");
      const current = suggestions(parent.id);
      if (["succeeded", "queued", "running"].includes(current.status))
        return ok(current);
      context.metadataStore.db.exec("SAVEPOINT action_extract");
      try {
        const run = service.store.enqueue({
          settings: {
            ...parent.settings,
            fileRefIds: [],
            useProjectData: false,
            frequency: "off",
            comparisonPeriod: undefined,
          },
          actorUserId: scope.userId,
          kind: "chat",
          period: parent.period,
          parentRunId: parent.id,
          prompt: ACTION_EXTRACTION_PROMPT,
          actionExtraction: { sourceReportId: parent.id },
          scheduleKey: `action-extract:${parent.id}:${current.runId ?? "first"}`,
        });
        store.linkExtraction(parent.id, run.id);
        context.metadataStore.db.exec("RELEASE action_extract");
        void service.tick();
        return ok({ status: run.status, runId: run.id, items: [] });
      } catch (error) {
        context.metadataStore.db.exec(
          "ROLLBACK TO action_extract; RELEASE action_extract",
        );
        throw error;
      }
    }
    if (
      segments.length === 2 &&
      segments[1] === "project-list" &&
      request.method === "GET"
    ) {
      const reviewReports: Array<{
        reportId: string;
        count: number;
        from: string;
        toExclusive: string;
      }> = [];
      // Only reports processed by the new registration flow, never bulk-extract historical reports.
      if (admin) {
        const rows = context.metadataStore.db
          .prepare(
            `SELECT r.document FROM energyiq_report_runs r
          WHERE r.project_id=? AND r.status='succeeded' AND EXISTS (
            SELECT 1 FROM energyiq_report_events e WHERE e.run_id=r.id
            AND json_extract(e.document,'$.type') IN ('project_actions_registered','project_actions_need_review'))
          ORDER BY r.rowid DESC LIMIT 50`,
          )
          .all(projectId);
        for (const row of rows) {
          const run = JSON.parse(String(row.document)) as {
            id: string;
            workspaceId: string;
            period: { from: string; toExclusive: string };
          };
          if (run.workspaceId !== scope.workspaceId) continue;
          const linked = store
            .list(scope, run.id)
            .filter((a) => a.visibility === "project");
          const remaining = suggestions(run.id).items.filter(
            (item) =>
              !linked.some(
                (a) =>
                  a.suggestionId === item.id ||
                  store
                    .sources(scope, a.id)
                    .some(
                      (s) =>
                        s.reportId === run.id &&
                        (s.sourceQuote === item.sourceQuote ||
                          s.recommendation === item.recommendation),
                    ),
              ),
          );
          if (remaining.length)
            reviewReports.push({
              reportId: run.id,
              count: remaining.length,
              ...run.period,
            });
        }
      }
      return ok({
        reviewReports,
        actions: store
          .listProject(scope)
          .map((a) => ({
            ...a,
            sources: store.sources(scope, a.id),
            priority: store.priority(scope, a.id),
            check: store.check(scope, a.id),
            canPrioritise: admin || a.visibility !== "project",
            canDemonstrate: admin,
          })),
      });
    }
    if (
      segments.length === 3 &&
      segments[2] === "priority" &&
      request.method === "POST"
    ) {
      const action = store.get(scope, segments[1]!);
      if (action.visibility === "project" && !admin)
        return fail(403, "ACTION_SHARING_FORBIDDEN");
      return ok(store.setPriority(scope, action.id, await body(request)));
    }
    if (
      segments.length === 3 &&
      segments[2] === "sources" &&
      request.method === "POST"
    ) {
      const action = store.get(scope, segments[1]!);
      if (action.visibility === "project" && !admin)
        return fail(403, "ACTION_SHARING_FORBIDDEN");
      const input = z
        .object({
          sourceReportId: z.string().uuid(),
          suggestionId: z.string().regex(/^[a-f0-9]{24}$/),
        })
        .strict()
        .parse(await body(request));
      source(input.sourceReportId);
      const item = suggestions(input.sourceReportId).items.find(
        (s) => s.id === input.suggestionId,
      );
      if (!item) return fail(422, "ACTION_SUGGESTION_NOT_FOUND");
      if (!item.meterId || !action.meterIds.includes(item.meterId))
        return fail(422, "ACTION_METER_INVALID");
      return ok({
        sources: store.linkSource(scope, action.id, {
          reportId: input.sourceReportId,
          recommendation: item.recommendation,
          sourceQuote: item.sourceQuote,
        }),
      });
    }
    if (segments.length === 1 && request.method === "GET") {
      const reportId =
        new URL(request.url ?? "/", "http://localhost").searchParams.get(
          "reportId",
        ) ?? "";
      const run = source(reportId);
      const today = localDate(new Date(), project.timezone);
      const baselineEnd =
        run.period.toExclusive < today ? run.period.toExclusive : today;
      return ok({
        actions: store.list(scope, reportId).map((a) => ({
          ...a,
          sources: store.sources(scope, a.id),
          scenarios: store.scenarios(scope, a.id),
          visibility: a.visibility ?? "private",
          scenarioLocked: store
            .events(scope, a.id)
            .some((event) => event.type === "implemented"),
          events: store
            .events(scope, a.id)
            .map((event) => ({
              type: event.type,
              effectiveAt: event.effectiveAt,
              details: event.details,
              recordedAt: event.recordedAt,
              actorName:
                context.metadataStore.users.getById({
                  user_id: event.actorUserId,
                }).display_name || "Project member",
            })),
          check: store.check(scope, a.id),
          feedback: store.feedback(scope, a.id).map((f) => {
            const task = service.store.get(projectId, f.runId);
            return {
              stage: f.stage,
              runId: f.runId,
              revision: f.revision,
              status: task.status,
              finishedAt: task.finishedAt,
              stale: f.revision !== a.revision,
            };
          }),
        })),
        projectActions: store
          .listProject(scope)
          .filter((a) => admin || a.visibility !== "project")
          .map((a) => ({
            id: a.id,
            title: a.title,
            meterIds: a.meterIds,
            sources: store.sources(scope, a.id),
          })),
        suggestions: suggestions(reportId),
        canRecord: true,
        canExtract: admin && run.actorUserId === scope.userId,
        canShare: admin,
        pilot: true,
        meters: meters(),
        baseline: {
          from: shiftReportDate(baselineEnd, -28),
          toExclusive: baselineEnd,
          snapshotId: project.data_snapshot_id,
        },
        timezone: project.timezone,
      });
    }
    if (segments.length === 1 && request.method === "POST") {
      const input = proposalSchema.parse(await body(request));
      if (input.visibility === "project" && !admin)
        return fail(403, "ACTION_SHARING_FORBIDDEN");
      source(input.sourceReportId);
      if (input.suggestionId) {
        if (input.suggestionRunId) {
          const extraction = service.store.get(
            projectId,
            input.suggestionRunId,
          );
          if (
            extraction.status !== "succeeded" ||
            extraction.workspaceId !== scope.workspaceId ||
            extraction.actionExtraction?.sourceReportId !== input.sourceReportId
          )
            return fail(404, "ACTION_NOT_FOUND");
        }
        const proposal = service
          .actionSuggestions(
            projectId,
            input.sourceReportId,
            input.suggestionRunId,
          )
          .find((item) => item.id === input.suggestionId);
        if (!proposal) return fail(422, "ACTION_SUGGESTION_INVALID");
        const existing = store
          .list(scope, input.sourceReportId)
          .find(
            (a) =>
              a.suggestionId === input.suggestionId &&
              a.userId === scope.userId &&
              (a.visibility ?? "private") === (input.visibility ?? "private"),
          );
        if (existing) return ok(existing);
      } else if (input.suggestionRunId)
        return fail(422, "ACTION_SUGGESTION_INVALID");
      const snapshot =
        context.metadataStore.energyIq.findCurrentDataSnapshot(projectId);
      if (!snapshot || snapshot.id !== input.baseline.snapshotId)
        return fail(409, "ACTION_DATA_CHANGED");
      const ids = new Set(meters().map((m) => m.meterPointId));
      if (input.meterIds.some((id) => !ids.has(id)))
        return fail(422, "ACTION_METER_INVALID");
      const evidence = await readActionGroupEvidence(
        context.metadataStore,
        scope,
        input.meterIds,
        { from: input.baseline.from, toExclusive: input.baseline.toExclusive },
      );
      if (evidence.snapshotId !== input.baseline.snapshotId)
        return fail(409, "ACTION_DATA_CHANGED");
      if (!canUseActions(context.metadataStore, scope))
        return fail(404, "ACTION_NOT_FOUND");
      if (
        input.visibility === "project" &&
        resolveEnergyIqUserRole(
          context.metadataStore,
          context.metadataStore.users.getById({ user_id: scope.userId }),
        ) !== "admin"
      )
        return fail(403, "ACTION_SHARING_FORBIDDEN");
      context.metadataStore.db.exec("SAVEPOINT action_create_with_baseline");
      try {
        const saved = store.create(scope, input);
        store.freezeBaseline(scope, saved.id, evidence);
        context.metadataStore.db.exec("RELEASE action_create_with_baseline");
        return ok(saved);
      } catch (error) {
        context.metadataStore.db.exec(
          "ROLLBACK TO action_create_with_baseline; RELEASE action_create_with_baseline",
        );
        throw error;
      }
    }
    const id = segments[1] ?? "";
    const action = store.get(scope, id);
    source(action.sourceReportId);
    if(segments[2]==="site-notes" && segments.length===3){
      if(request.method==="GET")return ok({items:store.siteNotes(scope,id)});
      if(request.method==="POST")return ok(store.recordSiteNote(scope,id,await body(request)));
    }
    if(segments[2]==="demonstrations"){
      if(!admin)return fail(403,"ACTION_ADMIN_REQUIRED");
      const demos=new ActionDemonstrations(context.metadataStore);
      if(segments.length===4&&segments[3]==="example"&&request.method==="GET")return ok(demos.example(scope,id));
      if(segments.length===3&&request.method==="POST"){
        const created=demos.create(scope,id,await body(request),service.store);void service.tick();return ok(created);
      }
      if(request.method==="GET"){
        const items=demos.list(scope,id);
        if(segments.length===4){const demo=items.find(d=>d.id===segments[3]);if(!demo)return fail(404,"ACTION_NOT_FOUND");const run=service.store.get(projectId,demo.runId);return ok({...demo,status:run.status,errorCode:run.errorCode,experience:actionExperience(run),html:run.status==="succeeded"?service.output(projectId,run.id):null});}
        return ok({items:items.map(d=>({...d,status:service.store.get(projectId,d.runId).status}))});
      }
    }
    if (segments[2] === "progress-drafts") {
      const drafts=new ActionProgressDrafts(context.metadataStore.db);
      for(const d of drafts.list(scope,id)){const r=service.store.get(projectId,d.runId);if(d.status==="pending"&&["failed","cancelled","interrupted"].includes(r.status))drafts.finish(scope,id,d.runId,null,true);}
      if(segments.length===3&&request.method==="GET")return ok({items:drafts.list(scope,id)});
      if(segments.length===4&&request.method==="POST"){const saved=drafts.confirm(scope,id,segments[3]!);service.wakeActionChecks();return ok(saved);}
      if(segments.length===3&&request.method==="POST"){
        const input=z.object({requestId:z.string().uuid(),text:z.string().trim().min(1).max(2000)}).strict().parse(await body(request));
        const settings=service.store.settings(projectId);if(!settings||settings.workspaceId!==scope.workspaceId)return fail(409,"REPORT_SETTINGS_REQUIRED");
        const d=drafts.start(scope,id,input,()=>service.store.enqueue({settings:{...settings,actorUserId:scope.userId,fileRefIds:[],skillRefs:[],skill:"",contextNotes:"",frequency:"off",useProjectData:false},actorUserId:scope.userId,kind:"chat",period:action.baseline,prompt:"Interpret this action update for confirmation.",actionProgress:{actionId:id,title:action.title,text:input.text,timezone:project.timezone,submittedAt:new Date().toISOString()}}).id);
        void service.tick();return ok(d);
      }
    }
    if (segments.length === 3 && segments[2] === "estimates") {
      const estimates = new ActionEstimates(context.metadataStore.db);
      // Reconcile terminal runs after process restart or cancellation as well as normal completion.
      for (const item of estimates.list(scope,id)) {
        const run = service.store.get(projectId,item.runId);
        if (item.status === "pending" && ["failed","cancelled","interrupted"].includes(run.status))
          estimates.finish(scope,id,item.runId,{error:run.errorCode ?? run.status});
      }
      if (request.method === "GET") {
        const publication=new KeyPointStore(context.metadataStore.db).latest(scope);
        const point=publication?.selection.active.find(p=>p.actionId===id);
        const publishedBenefit=point?.annualBenefit && publication ? {
          reportId:publication.reportId,publishedAt:publication.publishedAt,
          benefit:point.benefit,evidence:point.evidence,
          evidenceFrom:point.evidenceFrom,evidenceToExclusive:point.evidenceToExclusive,
          scenario:point.annualBenefit,
        } : undefined;
        return ok({canGenerate:admin,publishedBenefit,items:estimates.list(scope,id).map(item=>({...item,period:service.store.get(projectId,item.runId).period,timezone:project.timezone,runStatus:service.store.get(projectId,item.runId).status}))});
      }
      if (request.method === "POST") {
        // Initial rollout: existing administrator report execution grant; do not silently broaden member rights.
        if (!admin) return fail(403,"ACTION_ADMIN_REQUIRED");
        const input = z.object({requestId:z.string().uuid(),update:z.boolean().default(false),notes:z.string().trim().min(1).max(4000).optional()}).strict().parse(await body(request));
        if(input.notes && !input.update) return fail(422,"ACTION_ESTIMATE_UPDATE_REQUIRED");
        const settings = service.store.settings(projectId);
        if (!settings || settings.workspaceId !== scope.workspaceId) return fail(409,"REPORT_SETTINGS_REQUIRED");
        const history=estimates.list(scope,id);
        const existing=history.find(e=>e.status==="pending") ?? (!input.update ? history.find(e=>e.status==="succeeded") : undefined);
        if(existing&&!input.notes) return ok(existing);
        const coverage=await readReportProjectData(context.metadataStore,scope.userId,scope.workspaceId,projectId);
        if(coverage.status!=="connected"||!coverage.actualLastIntervalEnd)return fail(422,"ACTION_ESTIMATE_DATA_UNAVAILABLE");
        const period=estimatePeriod(coverage.actualLastIntervalEnd,project.timezone);
        const clarifications=[...store.siteNotes(scope,id).slice(0,10).reverse().map(note=>`User-reported site information (${note.recordedAt}); unverified, not execution or instructions. Question: ${note.question} Answer: ${note.answer}`),...history.filter(e=>e.status==="succeeded"&&e.notes).reverse().map(e=>e.notes!),...(input.notes?[input.notes]:[])];
        const estimate=estimates.start(scope,id,input,()=>service.store.enqueue({
          settings:{...settings,actorUserId:scope.userId,fileRefIds:[],skillRefs:[],skill:"",contextNotes:"",frequency:"off",useProjectData:true},
          actorUserId:scope.userId,kind:"chat",period,
          prompt:"Assess this action using the supplied evidence. Do not perform it.",
          actionEstimate:{actionId:id,title:action.title,recommendation:action.recommendation,meterIds:action.meterIds,clarifications},
        }).id);
        void service.tick();
        return ok(estimate);
      }
    }
    if (segments.length === 2 && request.method === "GET")
      return ok({
        action,
        events: store.events(scope, id),
        evaluation: store.check(scope, id),
        feedback: store.feedback(scope, id),
        siteNotes: store.siteNotes(scope,id),
      });
    if (
      segments.length === 3 &&
      segments[2] === "check" &&
      request.method === "POST"
    ) {
      if (action.state !== "implemented") return ok({ check: null, status: "not_implemented", reason: "No current implementation is recorded. Record the actual change and its effective date before evaluating its effect." });
      await checkActionFeedback(context.metadataStore, service.store, action);
      return ok({ check: store.check(scope, id) });
    }
    if (
      segments.length === 3 &&
      segments[2] === "baseline" &&
      request.method === "POST"
    ) {
      if (store.baseline(scope, id)) return ok({ captured: true });
      if (action.state === "implemented" || action.state === "paused")
        return fail(409, "ACTION_BASELINE_REQUIRED_BEFORE_EXECUTION");
      const evidence = await readActionGroupEvidence(
        context.metadataStore,
        scope,
        action.meterIds,
        {
          from: action.baseline.from,
          toExclusive: action.baseline.toExclusive,
        },
      );
      if (evidence.snapshotId !== action.baseline.snapshotId)
        return fail(409, "ACTION_DATA_CHANGED");
      store.freezeBaseline(scope, id, evidence);
      return ok({ captured: true });
    }
    if (
      segments.length === 4 &&
      segments[2] === "feedback" &&
      request.method === "GET"
    ) {
      const link = store
        .feedback(scope, id)
        .find((f) => f.runId === segments[3]);
      if (!link) return fail(404, "ACTION_NOT_FOUND");
      const run = source(link.runId, true);
      if (run.actionFeedback?.actionId !== id)
        return fail(404, "ACTION_NOT_FOUND");
      return ok({
        content: service.output(projectId, run.id),
        historical:
          link.revision !== action.revision || action.state !== "implemented",
        assessmentRevision: link.revision,
      });
    }
    if (
      segments.length === 5 &&
      segments[2] === "feedback" &&
      segments[4] === "retry" &&
      request.method === "POST"
    ) {
      const run = retryActionFeedback(
        context.metadataStore,
        service.store,
        scope,
        id,
        segments[3]!,
      );
      return ok({ runId: run.id, status: run.status });
    }
    if (
      segments.length === 3 &&
      segments[2] === "events" &&
      request.method === "POST"
    ) {
      const saved = store.record(scope, id, await body(request));
      service.wakeActionChecks();
      return ok(saved);
    }
    if (
      segments.length === 3 &&
      segments[2] === "scenarios" &&
      request.method === "POST"
    ) {
      const result = estimateLighting(await body(request));
      return ok({ id: store.saveScenario(scope, id, result), ...result });
    }
    if (
      segments.length === 3 &&
      segments[2] === "scenario-adoption" &&
      request.method === "POST"
    )
      return ok(store.adoptScenario(scope, id, await body(request)));
    return fail(404, "ACTION_NOT_FOUND");
  } catch (error) {
    if(error instanceof Error&&error.message.startsWith("ACTION_DEMO_"))return fail(422,error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return fail(422, "ACTION_INPUT_INVALID");
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("KEY_POINT_")) return fail(409, message);
    if (
      [
        "INSIGHT_MERGE_ALREADY_GROUPED",
        "INSIGHT_MERGE_INCOMPATIBLE",
        "ACTION_REVISION_CONFLICT",
        "ACTION_REQUEST_CONFLICT",
        "ACTION_DATA_CHANGED",
        "ACTION_RETRY_NOT_READY",
        "ACTION_SCENARIO_LOCKED",
        "REPORT_ALREADY_RUNNING",
        "REPORT_QUEUE_FULL",
      ].includes(message)
    )
      return fail(409, message);
    if (
      [
        "ACTION_FUTURE_EXECUTION",
        "ACTION_PROGRESS_NEEDS_CLARIFICATION",
        "ACTION_SCENARIO_WINDOW_UNSUPPORTED",
      ].includes(message)
    )
      return fail(422, message);
    if (message.includes("NOT_FOUND")) return fail(404, "ACTION_NOT_FOUND");
    return fail(500, "ACTION_OPERATION_FAILED");
  }
}
async function body(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const b = Buffer.from(chunk);
    bytes += b.length;
    if (bytes > 16384) throw new SyntaxError("Body too large");
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

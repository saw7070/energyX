import { reportSkillCatalog } from "./report-skill-catalog.js";
import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import type { IncomingMessage } from "node:http";
import type { MetadataStore } from "@datafoundry/metadata";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { authorizeReportConversation } from "./report-access.js";
import { listReportArtifacts, readReportArtifact } from "./report-artifacts.js";
import { hasReportArtifact } from "./report-store.js";
import { findReportService } from "./report-service.js";
import { canUseActions } from "./action-access.js";

const reportTools = [
  { name: "read", description: "Read project input files and analysis results." },
  { name: "bash", description: "Run calculations and scripts inside the isolated report worker." },
  { name: "edit", description: "Make targeted changes to report and analysis files." },
  { name: "write", description: "Create report HTML and supporting analysis files." },
  { name: "grep", description: "Search file contents for matching text." },
  { name: "find", description: "Find files by name or pattern." },
  { name: "ls", description: "List files and directories in the report workspace." },
];

export function authorizeReportLibraryProject(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string): { canChat: boolean; canManageProject: boolean } {
  const { canChat, canManageProject } = authorizeReportConversation(metadata, userId, workspaceId, projectId);
  return { canChat, canManageProject };
}

/** Customer-facing read DTOs are explicit allowlists; never spread a Run or settings into them. */
export async function handleReportLibraryApi(request: IncomingMessage, segments: string[], context: Required<ConfigApiContext>): Promise<ConfigApiResponse> {
  const headers = { "Cache-Control": "private, no-store" };
  const missing = (): ConfigApiResponse => ({ status: 404, headers, body: createErrorResult("RESOURCE_NOT_FOUND", "REPORT_NOT_FOUND") });
  try {
    const projectId = segments[0] ? decodeURIComponent(segments[0]) : "";
    const { canChat, canManageProject } = authorizeReportLibraryProject(context.metadataStore, context.userId, context.workspaceId, projectId);
    if (request.method !== "GET") return { status: 405, headers: { ...headers, Allow: "GET" }, body: createErrorResult("BAD_REQUEST", "REPORT_LIBRARY_READ_ONLY") };
    const service = findReportService(context.metadataStore);
    if (!service) return { status: 503, headers, body: createErrorResult("NOT_ENABLED", "REPORT_AGENT_NOT_ENABLED") };
    if (segments.length === 4 && segments[1] === "artifact") {
      if (!canChat) throw new Error("REPORT_ARTIFACT_FORBIDDEN");
      const run = service.store.get(projectId, segments[2]!);
      if (run.actionFeedback) return missing();
      if (run.actorUserId !== context.userId || run.workspaceId !== context.workspaceId) throw new Error("REPORT_ARTIFACT_FORBIDDEN");
      if (!["report", "chat"].includes(run.kind) || run.status !== "succeeded") return missing();
      return { status: 200, headers, body: createSuccessResult(readReportArtifact(service.archivedOutputDirectory(run.id), decodeURIComponent(segments[3]!))) };
    }
    if (segments.length === 3 && segments[1] === "output") {
      const run = service.store.get(projectId, segments[2]!);
      if (run.actionFeedback) return missing();
      if (!hasReportArtifact(run) || run.status !== "succeeded" || run.workspaceId !== context.workspaceId) return missing();
      return { status: 200, headers, body: createSuccessResult({ content: service.output(projectId, run.id) }) };
    }
    // The readings a site report was built from, so the page can be shown in the reader's own language. Readable by
    // anyone in the workspace who may read the report itself — unlike per-run files, which stay with their author.
    if (segments.length === 3 && segments[1] === "snapshot") {
      const run = service.store.get(projectId, segments[2]!);
      if (run.actionFeedback || !run.siteReport) return missing();
      if (run.status !== "succeeded" || run.workspaceId !== context.workspaceId) return missing();
      return { status: 200, headers, body: createSuccessResult({ snapshot: service.siteReportSnapshot(projectId, run.id) }) };
    }
    if (segments.length !== 1) return missing();
    const allRuns = service.store.list(projectId).filter(run=>run.workspaceId===context.workspaceId);
    const requestedId = new URL(request.url ?? "/", "http://localhost").searchParams.get("reportId");
    if (requestedId) {
      let requested; try { requested = service.store.get(projectId, requestedId); } catch { return missing(); }
      if (requested.workspaceId !== context.workspaceId || requested.status !== "succeeded" || !hasReportArtifact(requested)) return missing();
      if (!allRuns.some(run => run.id === requestedId)) allRuns.push(requested);
    }
    const byId = new Map(allRuns.map(run=>[run.id,run]));
    const runs = allRuns
      .filter(run => ["report", "chat"].includes(run.kind) && run.status === "succeeded" && run.workspaceId === context.workspaceId);
    const reports = runs.filter(run => !run.actionFeedback).filter(hasReportArtifact).map(run => {
      const lineage = service.store.libraryMetadata(projectId, run.id);
      let previous = run.retryOfRunId ?? run.parentRunId;
      const seen = new Set([run.id]);
      let previousReportId: string | undefined;
      while(previous && !seen.has(previous) && seen.size < 1000){seen.add(previous);const parent=byId.get(previous);if(!parent || parent.actorUserId !== run.actorUserId || parent.kind === "skill")break;if(parent.status === "succeeded" && hasReportArtifact(parent)){previousReportId=parent.id;break;}previous=parent.retryOfRunId ?? parent.parentRunId;}
      const period = run.reportingPeriod ?? { from: run.period.from, toExclusive: run.period.toExclusive };
      return { ...lineage, canDiscuss: canChat && run.actorUserId === context.userId && !run.siteReport, ...(previousReportId ? {previousReportId} : {}),
        title: reportTitle(lineage.category, period, run.siteReport?.cadence), id: run.id, kind: "report" as const, period, createdAt: run.createdAt,
        // Site reports are written by the server from the site's own meter readings; advisor reports are written for it.
        source: run.siteReport ? "site" as const : "advisor" as const,
        ...(run.siteReport ? { cadence: run.siteReport.cadence } : {}),
        ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}), ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}) };
    });
    const artifacts = canChat ? runs.filter(run => !run.actionFeedback && run.actorUserId === context.userId).flatMap(run =>
      listReportArtifacts(service.archivedOutputDirectory(run.id)).map(file => ({ runId: run.id, ...file, createdAt: run.finishedAt ?? run.createdAt }))
    ).slice(0, 200) : [];
    const settings = service.store.settings(projectId);
    // The project's saved methods belong to its managers; a reader sees the reports themselves.
    const skills = canManageProject && settings?.workspaceId === context.workspaceId ? reportSkillCatalog(context, settings, canManageProject) : [];
    return { status: 200, headers, body: createSuccessResult({ reports, artifacts, skills, tools: canChat ? reportTools : [], canChat, canManageProject,
      // Which of this project's site reports the Overview shows, so the page and this list agree on one report.
      overviewCadence: overviewCadence(context.metadataStore, projectId),
      canUseActions:canUseActions(context.metadataStore,{userId:context.userId,workspaceId:context.workspaceId,projectId}) }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("FORBIDDEN")) return { status: 403, headers, body: createErrorResult("FORBIDDEN", "REPORT_PROJECT_FORBIDDEN") };
    return missing();
  }
}

/**
 * The cadence of the site report this project's Overview shows. Administrators choose it on the setup document
 * ("Overview shows"); a project that has never been edited has no setting and keeps the monthly report. The row is
 * only read, never created, because listing reports must not write anything.
 */
function overviewCadence(metadata: MetadataStore, projectId: string): "monthly" | "weekly" {
  try {
    const row = metadata.db.prepare("SELECT document_json FROM energyiq_project_setup_drafts WHERE project_id = ?").get(projectId);
    const document = JSON.parse(String((row as { document_json?: unknown } | undefined)?.document_json ?? "{}")) as { project?: { overview_cadence?: unknown } };
    return document.project?.overview_cadence === "weekly" ? "weekly" : "monthly";
  } catch { return "monthly"; }
}

function reportTitle(category: "scheduled" | "custom", period: { from: string; toExclusive: string }, cadence?: "weekly" | "monthly"): string {
  const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const start = format.format(new Date(period.from));
  const end = format.format(new Date(Date.parse(period.toExclusive) - 86400000));
  const kind = cadence ? `${cadence === "weekly" ? "Weekly" : "Monthly"} Site Report` : `${category === "scheduled" ? "Scheduled" : "Custom"} Energy Report`;
  return `${kind} — ${start === end ? start : `${start} to ${end}`}`;
}

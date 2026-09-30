import { projectExplorerMeters, projectMeterNamingReadiness } from "../energy/energy-explorer-meters.js";
import { writeAnalysisContract } from "./analysis-package.js";
import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { authorizeReportExecution } from "./report-access.js";
import { assertActionFeedbackCurrent } from "./action-feedback.js";
import { readProjectSpatialReference, renderProjectSpatialSvg } from "@datafoundry/contracts";
import { defaultReportSkills, requiredReportSkills, resolveReportSkillSelection } from "./report-skill-catalog.js";
import { REPORT_PRESENTATION_METHOD } from "./report-presentation.js";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, unlinkSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import { ensureEnergyScopedDataSource, exportEnergyScopedCsv } from "@datafoundry/data-gateway";
import type { FileAssetService } from "@datafoundry/files";
import type { MetadataStore } from "@datafoundry/metadata";
import { resolveEnergyPublishedHierarchyNodes, resolveEnergyPublishedMeterRoute, resolveEnergyQueryContext } from "../energy/energy-query-context.js";
import { shiftReportDate } from "./report-calendar.js";
import { availableReportPeriod } from "./report-periods.js";
import type { ReportRun } from "./report-store.js";

export function authorizeReportProject(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string): void {
  const access = authorizeReportExecution(metadata, userId, workspaceId, projectId);
  if (!access.canManageProject) throw new Error("REPORT_ADMIN_REQUIRED");
}

/** How far before and after the chosen dates the advisor can look (about 13 months, enough for "same month last year"). */
export const SUPPORTING_WINDOW_DAYS = 400;
type Window = readonly ["comparison" | "history" | "later", { from: string; toExclusive: string }];
/**
 * Readings outside the chosen dates, so questions about other periods can be answered: everything available before
 * them ("history") and after them ("later"), each bounded to SUPPORTING_WINDOW_DAYS. An explicit comparison window
 * replaces both. When the available range cannot be read, the previous 28 days are used.
 */
export async function supportingWindows(run: ReportRun, metadata: MetadataStore, files: FileAssetService): Promise<Window[]> {
  if (run.settings.comparisonPeriod) return [["comparison", run.settings.comparisonPeriod]];
  const available = await availableReportPeriod(metadata, files, { ...run.settings, fileRefIds: [] }, run.actorUserId).catch(() => null);
  const windows: Window[] = [];
  const historyFrom = available ? [available.from, shiftReportDate(run.period.from, -SUPPORTING_WINDOW_DAYS)].sort().at(-1)! : shiftReportDate(run.period.from, -28);
  if (historyFrom < run.period.from) windows.push(["history", { from: historyFrom, toExclusive: run.period.from }]);
  if (available && available.toExclusive > run.period.toExclusive) {
    windows.push(["later", { from: run.period.toExclusive, toExclusive: [available.toExclusive, shiftReportDate(run.period.toExclusive, SUPPORTING_WINDOW_DAYS)].sort()[0]! }]);
  }
  return windows;
}

export async function prepareReportInputs(run: ReportRun, directory: string, metadata: MetadataStore, files: FileAssetService): Promise<void> {
  if (run.actionFeedback) assertActionFeedbackCurrent(metadata, run.actionFeedback, {userId:run.actorUserId,workspaceId:run.workspaceId,projectId:run.projectId});
  else authorizeReportExecution(metadata, run.actorUserId, run.workspaceId, run.projectId);
  const inputDir = join(directory, "inputs");
  mkdirSync(inputDir, { recursive: true });
  if (run.actionFeedback) writeFileSync(join(inputDir,"action-feedback.json"), JSON.stringify(run.actionFeedback,null,2));
  const project = metadata.energyIq.getProject(run.projectId);
  const published = metadata.energyIq.templates.getLatestProjectRevision(run.projectId);
  const capturedAt = new Date();
  const label = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone:"UTC", weekday:"short", day:"2-digit", month:"short", year:"numeric" }).format(new Date(date + "T00:00:00Z"));
  const manifest: Record<string, unknown> = {
    projectId: run.projectId, projectName: project.name, timezone: project.timezone,
    ...(run.reportingPeriod ? { reportingPeriod: run.reportingPeriod } : {}),
    analysisPeriod: run.period, settingsRevision: run.settings.revision,
    workspaceId: run.workspaceId, runId: run.id, sessionId: run.sessionId, reportLanguage: "en",
    capturedAt: capturedAt.toISOString(),
    calendarLabels: { analysisStart: label(run.period.from), analysisEndInclusive: label(shiftReportDate(run.period.toExclusive, -1)),
      preparedAt: new Intl.DateTimeFormat("en-GB", {timeZone:project.timezone, weekday:"short", day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(capturedAt),
      instructions:"Use these system-computed labels verbatim or omit weekdays. preparedAt is input preparation time, not report completion time. Never invent a completion timestamp." },
  };
  // Initial configuration conversations must work before the first data publication.
  // An existing but broken snapshot still fails normally; do not mask query failures.
  // Initialization must continue after readings are staged but before the first configuration publication.
  const preparingProject = run.kind === "chat" && run.settings.useProjectData && !published;
  // Extraction needs published meter identities, but must not re-query interval data.
  if (run.actionExtraction) {
    const context = resolveEnergyQueryContext({metadataStore:metadata,user:metadata.users.getById({user_id:run.actorUserId}),workspaceId:run.workspaceId,
      request:{projectId:run.projectId,resource:"electricity",period:"Custom",from:run.period.from,to:shiftReportDate(run.period.toExclusive,-1)}});
    const route=resolveEnergyPublishedMeterRoute({metadataStore:metadata,projectId:run.projectId,hierarchyRevisionId:context.hierarchyRevisionId,
      scopeId:context.scopeId,resource:"electricity",expectedMeterMappingRevisionId:context.meterMappingRevisionId});
    manifest.dataSnapshotId=context.dataSnapshotId;
    manifest.hierarchyRevisionId=context.hierarchyRevisionId;
    manifest.meterMappingRevisionId=context.meterMappingRevisionId;
    manifest.hierarchy=resolveEnergyPublishedHierarchyNodes(metadata,run.projectId,context.hierarchyRevisionId);
    manifest.meterAttachments=route.attachments;
  }
  if (run.settings.useProjectData && !preparingProject && !run.actionFeedback) {
    const datasets: Array<Record<string, unknown>> = [];
    let pinnedSnapshotId: string | undefined;
    for (const [name, period] of [["analysis", run.period] as const, ...await supportingWindows(run, metadata, files)]) {
      const context = resolveEnergyQueryContext({
        metadataStore: metadata, user: metadata.users.getById({ user_id: run.actorUserId }), workspaceId: run.workspaceId,
        request: { projectId: run.projectId, resource: "electricity", period: "Custom", from: period.from, to: shiftReportDate(period.toExclusive, -1) },
      });
      if (pinnedSnapshotId && context.dataSnapshotId !== pinnedSnapshotId) throw new Error("REPORT_DATA_CHANGED_RETRY");
      if (manifest.hierarchyRevisionId && (manifest.hierarchyRevisionId !== context.hierarchyRevisionId || manifest.meterMappingRevisionId !== context.meterMappingRevisionId)) throw new Error("REPORT_PROJECT_CHANGED_RETRY");
      pinnedSnapshotId = context.dataSnapshotId;
      const route = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata, projectId: run.projectId, hierarchyRevisionId: context.hierarchyRevisionId,
        scopeId: context.scopeId, resource: "electricity", expectedMeterMappingRevisionId: context.meterMappingRevisionId,
      });
      const scoped = await ensureEnergyScopedDataSource({ metadataStore: metadata, userId: run.actorUserId, context: { ...context, meterAttachments: route.attachments } });
      const filename = name === "analysis" ? "meter-intervals.csv" : name === "history" ? "history.csv" : name === "later" ? "later-meter-intervals.csv" : "comparison-meter-intervals.csv";
      const namingRevision = metadata.energyIq.projectSetup.listHierarchyRevisions(run.projectId).find(r=>r.id===context.hierarchyRevisionId);
      if(!namingRevision) throw new Error("REPORT_PROJECT_NAMING_REQUIRED");
      const namingDocument = JSON.parse(namingRevision.snapshot_json) as EnergyIqProjectSetupDocument;
      const names = projectExplorerMeters({document:namingDocument,resource:"electricity",officialMeterIds:new Set(),scopeIds:new Set(namingDocument.meter_mapping?.rows.map(r=>r.navigation_scope_id??r.scope_id)??[])});
      const evidence = await exportEnergyScopedCsv(scoped, join(inputDir, filename), Object.fromEntries(names.map(m=>[m.id,m.name])));
      if (metadata.energyIq.getProject(run.projectId).data_snapshot_id !== context.dataSnapshotId) throw new Error("REPORT_DATA_CHANGED_RETRY");
      const transfer = await compressReportDataset(inputDir, filename, evidence);
      const expectedMinutes = (Date.parse(context.to) - Date.parse(context.from)) / 60_000;
      datasets.push({ name, period, utcPeriod: { from: context.from, toExclusive: context.to }, ...evidence, ...transfer,
        coverage: route.attachments.map((attachment) => {
          const meter = evidence.meters.find((item) => item.meterPointId === attachment.meterPointId);
          return { meterPointId: attachment.meterPointId, officialAggregation: attachment.officialAggregation, expectedMinutes,
            observedMinutes: meter?.observedMinutes ?? 0, validMinutes: meter?.validMinutes ?? 0,
            validCoverageRatio: expectedMinutes > 0 ? (meter?.validMinutes ?? 0) / expectedMinutes : null,
            status: !meter ? "no_intervals" : meter.validMinutes < expectedMinutes ? "partial" : "complete" };
        }),
      });
      manifest.dataSnapshotId = context.dataSnapshotId;
      manifest.hierarchyRevisionId = context.hierarchyRevisionId;
      manifest.meterMappingRevisionId = context.meterMappingRevisionId;
      manifest.hierarchy = resolveEnergyPublishedHierarchyNodes(metadata, run.projectId, context.hierarchyRevisionId);
      manifest.meterAttachments = route.attachments;
    }
    manifest.datasets = datasets;
    manifest.dataInstructions = "Customer reports must be entirely in English. Read dataset filenames from this manifest. Large CSVs are losslessly gzip-compressed (.csv.gz); read them with Python gzip.open or pandas.read_csv (automatic compression detection), preferably in chunks. All rows and columns are retained. Analysis and comparison/history CSVs are separate, fixed to the same published Snapshot. When no explicit comparison is selected, history.csv contains up to 28 days before the analysis period for baselines and weekday structure, never part of current-period totals; disclose insufficient samples. Use usage_kwh, never sum cumulative active_energy_kwh. For project totals use official_aggregation_eligible rows with non-null usage_kwh and quality_status in ('ok', 'gap'), matching the published fact layer. Gap rows retain measured cumulative deltas across longer intervals; include that energy in observed totals and disclose it separately. For regular 15-minute profiles and peaks use quality_status=ok and elapsed_minutes=15; never count a gap row as a regular sample or interpolate its energy without an explicit allocation method. Reconcile regular-only subtotals to accepted observed totals; do not add main and sub meters together. Coverage is valid observed minutes / requested period minutes for every authorized meter, including meters without intervals. Actual data cutoff is not the sync watermark. Missing readings are not zero usage. Report incomplete periods explicitly. Use device_name from the published project mapping for user-facing equipment names; source_device_name and circuit_name retain source labels for traceability only; do not infer names or spatial coverage from meter IDs.";
  }
  const refs: Array<{ filename: string; sha256: string; bytes: number }> = [];
  let totalBytes = 0;
  for (const [index, id] of run.settings.fileRefIds.entries()) {
    const ref = files.getRef({ user_id: run.actorUserId, workspace_id: run.workspaceId, id });
    const filename = `${index + 1}-${basename(ref.ref.filename).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const targetPath = join(inputDir, filename);
    files.materializeRefToPath({ ref: ref.ref, targetPath, linkStrategy: "copy" });
    totalBytes += statSync(targetPath).size;
    if (totalBytes > 200 * 1024 * 1024) throw new Error("REPORT_ATTACHMENTS_TOO_LARGE");
    refs.push({ filename, bytes: statSync(targetPath).size, sha256: createHash("sha256").update(readFileSync(targetPath)).digest("hex") });
  }
  manifest.attachments = refs;

  // Capture published project rules alongside the exact dataset used by this run.
  // Inactive policy revisions and setup drafts must not silently affect scheduled reports.
  const tariffVersion = published?.tariff_schedule_version ?? project.tariff_schedule_version;
  const calendarVersion = published?.business_calendar_version ?? project.business_calendar_version;
  const readPolicy = (kind: "tariff" | "calendar", version: string | undefined) => {
    if (!version) return { status: "not_configured" };
    try {
      const revision = kind === "tariff" ? metadata.energyIq.operationalPolicy.getTariffSchedule(version) : metadata.energyIq.operationalPolicy.getOperatingCalendar(version);
      if (revision.project_id !== run.projectId) throw new Error("REPORT_PROJECT_POLICY_FORBIDDEN");
      return { status: "published", revision };
    } catch (error) {
      if (error instanceof Error && /^ENERGYIQ_(TARIFF|OPERATING_CALENDAR)_REVISION_NOT_FOUND:/.test(error.message)) return { status: "not_configured", version };
      throw error;
    }
  };
  const nameRevision = metadata.energyIq.projectSetup.listHierarchyRevisions(run.projectId).find(r => r.id === manifest.hierarchyRevisionId);
  const nameDocument = nameRevision ? JSON.parse(nameRevision.snapshot_json) as EnergyIqProjectSetupDocument : undefined;
  const displayMeters = nameDocument ? projectExplorerMeters({document:nameDocument,resource:"electricity",officialMeterIds:new Set(),scopeIds:new Set([
    ...(nameDocument.meter_mapping?.rows.map(r=>r.navigation_scope_id ?? r.scope_id) ?? []),
    ...(nameDocument.meter_mapping?.virtual_meters?.map(r=>r.scope_id) ?? []),
  ])}) : [];
  const configuration = {
    schemaVersion: 1, projectId: run.projectId, name: project.name, timezone: project.timezone,
    basis: "published_configuration", dataSnapshotId: manifest.dataSnapshotId ?? null,
    hierarchyRevisionId: manifest.hierarchyRevisionId ?? null, meterMappingRevisionId: manifest.meterMappingRevisionId ?? null,
    meterNamingReadiness: projectMeterNamingReadiness(nameDocument),
    meterDisplayNames: displayMeters.map(m=>({meterId:m.id,displayName:m.name,scopeId:m.scopeId})),
    meterNamingInstructions: "Use meterDisplayNames exactly as Project Explorer does in every visible headline, chart, finding and action. IDs are for joins and tools only. Never guess equipment from an ID. If a published name is generic, state that its equipment identity needs confirmation.",
    hierarchy: manifest.hierarchy ?? [], meterAttachments: manifest.meterAttachments ?? [],
    tariff: readPolicy("tariff", tariffVersion), calendar: readPolicy("calendar", calendarVersion),
    instructions: "Only published rules are included. Missing tariffs do not imply zero cost. Academic term breaks do not automatically mean closure. Project notes are separate reference information and must not silently override these published rules. Ask for clarification if they conflict.",
  };
  const currentProject = metadata.energyIq.getProject(run.projectId);
  const currentRelease = metadata.energyIq.templates.getLatestProjectRevision(run.projectId);
  if (currentRelease?.revision_id !== published?.revision_id || (manifest.dataSnapshotId && currentProject.data_snapshot_id !== manifest.dataSnapshotId) || currentProject.hierarchy_revision_id !== project.hierarchy_revision_id || currentProject.tariff_schedule_version !== project.tariff_schedule_version || currentProject.business_calendar_version !== project.business_calendar_version) throw new Error("REPORT_PROJECT_CHANGED_RETRY");
  writeFileSync(join(inputDir, "project-configuration.json"), JSON.stringify(configuration, null, 2));
  writeFileSync(join(inputDir, "project-context.md"), run.settings.contextNotes);
  const spatial = readProjectSpatialReference(run.settings.contextNotes, run.projectId);
  if (spatial) {
    writeFileSync(join(inputDir, "project-spatial-reference.json"), JSON.stringify(spatial.reference, null, 2));
    writeFileSync(join(inputDir, "project-spatial-reference.svg"), renderProjectSpatialSvg(spatial.reference));
    manifest.spatialReference = {
      dataFile: "project-spatial-reference.json", imageFile: "project-spatial-reference.svg",
      source: spatial.reference.provenance,
      instructions: "For a complete project report include a compact Spaces and meter distribution figure after the key findings. Embed the supplied SVG inline or as a data image so the report works offline. Preserve its spatial relationships; project-style.md may restyle its colours and typography. Label it illustrative and not to scale. Published meter mappings override reference annotations. Never infer room-level energy, wiring or physical independence from this figure. Short answers do not require a map; explain explicit full-report omissions in review.json.",
    };
  }
  writeFileSync(join(inputDir, "report-presentation.md"), REPORT_PRESENTATION_METHOD);
  writeFileSync(join(inputDir, "project-style.md"), run.settings.styleSkill?.content ?? "No separate project visual style is bound yet. Preserve this project's explicit visual preferences in its accepted project Skill and presentation references until they are migrated. If none are supplied, use a restrained readable layout. Do not inherit another project's visual identity from examples or conversation history.");
  writeFileSync(join(inputDir, "project-skill.md"), run.settings.skill || "No accepted project Skill yet. Explore the data and ask for missing project facts in your response.");
  if ((!run.settings.useProjectData || preparingProject) && refs.length === 0) {
    if (run.kind === "report" && !run.actionFeedback) throw new Error("REPORT_DATA_INPUT_REQUIRED");
    manifest.datasets = [];
    manifest.dataAvailability = "no_measured_data_available";
    manifest.dataInstructions = "No measured data available for this run. Answer general questions and derive Skill drafts from the conversation and supplied context. Do not invent energy readings, metrics, savings, or measured conclusions. If asked for a data-backed report, explain the missing evidence and request authorized data.";
  }
  if (run.actionFeedback) {
    manifest.dataAvailability = "frozen_action_evidence";
    manifest.dataInstructions = "Read action-feedback.json. It contains server-computed daily readings, two frozen snapshot identities, execution records and matched-weekday arithmetic. These are measured aggregates, not missing data. Do not substitute current readings or fabricate unprovided hourly data. Holidays, weather and occupancy are not controlled; do not claim causal savings.";
    manifest.actionFeedback = {actionId:run.actionFeedback.actionId, revision:run.actionFeedback.revision, baselineSnapshotId:run.actionFeedback.baseline.snapshotId, observationSnapshotId:run.actionFeedback.observation.snapshotId};
  }
  if (preparingProject) {
    manifest.dataAvailability = "project_not_initialized";
    manifest.dataInstructions = "This project has no published meter dataset yet. Use project configuration tools and supplied materials to prepare its configuration. Saved drafts are not published data. Do not invent measured results or say Explorer has changed before publication.";
  }
  const requiredSkills = requiredReportSkills(run.projectId);
  // Fail rather than silently supply a different platform method to an already queued run.
  for (const skill of requiredSkills) {
    const pinned = run.settings.skillUsage?.find(item => item.id === skill.id);
    if (pinned && pinned.contentHash !== createHash("sha256").update(skill.content).digest("hex")) throw new Error("REPORT_SKILL_INPUT_CHANGED");
  }
  writeFileSync(join(inputDir, "report-review.md"), requiredSkills.find(skill => skill.id === "builtin:review")!.content);
  manifest.skills = run.settings.skillUsage ?? resolveReportSkillSelection(run.settings, [...requiredSkills, ...defaultReportSkills(run.settings)]).skillUsage;
  manifest.skillEvidence = "Provided input snapshots do not prove the model read or applied a Skill.";
  manifest.projectFiles = ["project-configuration.json", "project-context.md", "project-skill.md", "project-style.md", "report-presentation.md", "report-review.md"].map((filename) => ({ filename, sha256: createHash("sha256").update(readFileSync(join(inputDir, filename))).digest("hex") }));
  if (spatial) (manifest.projectFiles as Array<{filename: string; sha256: string}>).push(...["project-spatial-reference.json", "project-spatial-reference.svg"].map(filename => ({ filename, sha256: createHash("sha256").update(readFileSync(join(inputDir, filename))).digest("hex") })));
  writeFileSync(join(inputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  // Roll out on isolated new full-report runs first; historical reports and action workflows remain compatible.
  if (process.env.ENERGYIQ_ANALYSIS_PACKAGE_V1 === "true" && run.kind === "report" &&
      !run.actionFeedback && !run.actionEstimate && !run.actionExtraction && !run.actionProgress && manifest.dataSnapshotId)
    writeAnalysisContract(inputDir);
}

export function copyReportParent(parentDir: string, targetDir: string, history: string): void {
  copyFileSync(join(parentDir, "outputs", "report.html"), join(targetDir, "inputs", "previous-report.html"));
  writeFileSync(join(targetDir, "inputs", "creation-notes.json"), history);
}

/** Compress transport bytes, not measurements: the source digest remains available for verification. */
export async function compressReportDataset(directory: string, filename: string, evidence: { bytes: number; sha256: string }) {
  const source = join(directory, filename);
  if (statSync(source).size <= 16 * 1024 * 1024) return { filename, bytes: evidence.bytes, sha256: evidence.sha256 };
  const compressedName = filename + ".gz";
  const target = join(directory, compressedName);
  await pipeline(createReadStream(source), createGzip(), createWriteStream(target, { flags: "wx" }));
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  const result = { filename: compressedName, compression: "gzip", bytes: statSync(target).size,
    sha256: hash.digest("hex"), uncompressedBytes: evidence.bytes, uncompressedSha256: evidence.sha256 };
  unlinkSync(source);
  return result;
}

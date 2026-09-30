import {
  energyAiNarrativeClaimsSupported,
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
} from "@datafoundry/contracts";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  readCurrentProjectOverviewSnapshotWithLifecycle,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import {
  overviewAiArtifactPinnedLocalPeriod,
  resolveCurrentOverviewAiArtifactIdentity,
} from "./overview-ai-artifact.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";

type PlacementTarget =
  | "preschool.overall-key-findings"
  | "preschool.benchmark"
  | "preschool.standby"
  | "preschool.operating-hours"
  | "preschool.forecast"
  | "cross-section";
type EpistemicLevel = "verified" | "hypothesis" | "exploration-idea";
type Relationship = "supports" | "challenges" | "independent";
export type PreschoolOverviewAiStage =
  | "investigator"
  | "editor"
  | "section-interpreter"
  | "executive-synthesis"
  | "template-proposal"
  | "additional-insights-discovery"
  | "additional-insights-transition"
  | "html-slot";

const OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME = "overview_ai_candidates_submit" as const;

export type PreschoolOverviewAiStageInput = {
  stage: "investigator" | "editor";
  prompt: string;
  runId: string;
  sessionId: string;
  user: UserRecord;
  workspaceId: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
};

export type PreschoolOverviewAiStageRunner = (
  input: PreschoolOverviewAiStageInput,
) => Promise<{
  events: ReadonlyArray<Record<string, unknown>>;
  completedRun: { runId: string; sessionId: string };
}>;

export type PreschoolOverviewAiWorkflow = {
  resolveCurrentIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
    pin?: {
      from: string;
      to: string;
      dataSnapshotId: string;
      projectReleaseId: string;
    };
  }): Promise<EnergyIqOverviewAiArtifactIdentity>;
  execute(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
    retry: boolean;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
};

type EvidenceItem = {
  id: string;
  kind: string;
  label: string;
  unit: string | null;
  values: Record<string, string | number | boolean | null>;
  queryIds: string[];
  limitation: string | null;
};

type ToolEvidence = {
  evidenceIndex: number;
  toolCallId: string;
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
  columns: string[];
  rows: unknown[];
};

type WorkflowContext = {
  binding: {
    projectId: "preschool-demo";
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    dataCutoff: string;
    analysisPeriod: { from: string; to: string };
    outputContractRevision: string;
  };
  evidence: EvidenceItem[];
  knownCentreCodes: string[];
  coverage: unknown;
  decisionSignals: Array<{ id: string; label: string }>;
  projectName: string;
  scopeName: string;
  timezone: string;
};

type InvestigatorCandidate = {
  id: string;
  epistemicLevel: EpistemicLevel;
  title: string;
  takeaway: string;
  action: string;
  expectedIfAct: string;
  ifIgnored: string;
  limitation: string;
  significance?: string;
  possibleExplanation?: string;
  nextCheck?: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

type EditorSelection = {
  sourceCandidateIds: string[];
  placementTargets: PlacementTarget[];
  relationship: Relationship;
  signalRefs: string[];
  copy?: EditorCopy;
};

type EditorCopy = {
  title: string;
  takeaway: string;
  action: string;
  expectedIfAct: string;
  ifIgnored: string;
  limitation: string;
  significance?: string;
  possibleExplanation?: string;
  nextCheck?: string;
};

type TraceDecision = {
  decision: "accepted" | "rejected";
  sourceCandidateIds: string[];
  findingId?: string;
  reason?: string;
};

const LEASE_MS = 13 * 60 * 1_000;
const MAX_ANSWER_CHARS = 160_000;
const MAX_EVIDENCE_PREVIEW_CHARS = 2_000;
const MAX_EDITOR_PROMPT_CHARS = 12_000;
const MAX_INVESTIGATOR_CANDIDATES = 3;
const MAX_CANDIDATE_TITLE_CHARS = 240;
const MAX_CANDIDATE_TAKEAWAY_CHARS = 800;
const MAX_CANDIDATE_SUPPORTING_TEXT_CHARS = 600;
const MAX_EDITOR_TITLE_CHARS = 240;
const MAX_EDITOR_TAKEAWAY_CHARS = 800;
const MAX_EDITOR_SUPPORTING_TEXT_CHARS = 600;
const MAX_EDITOR_EVIDENCE_REF_CHARS = 80;
const MAX_EDITOR_EVIDENCE_REFS = 4;
const MAX_EDITOR_SQL_INDEXES = 8;
const MAX_EDITOR_PRESENTATION_BLOCKS = 2;
const MAX_EDITOR_PRESENTATION_TEXT_CHARS = 60;
const MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS = 220;

export function createPreschoolOverviewAiWorkflow(input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runStage: PreschoolOverviewAiStageRunner;
  resolveSnapshot?: (args: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }) => Promise<ProjectAnalysisSnapshot>;
}): PreschoolOverviewAiWorkflow {
  const resolveSnapshot = input.resolveSnapshot ?? (async ({ identity, user }) => {
    const project = input.metadataStore.energyIq.getProject(identity.projectId);
    const period = overviewAiArtifactPinnedLocalPeriod({
      identity,
      timezone: project.timezone,
    });
    return readCurrentProjectOverviewSnapshotWithLifecycle({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      user,
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      expectedFrom: period.from,
      expectedTo: period.to,
      expectedDataSnapshotId: identity.dataSnapshotId,
      expectedProjectReleaseId: identity.projectReleaseId,
    });
  });

  return {
    resolveCurrentIdentity: ({ projectId, scopeId, user, pin }) => resolveCurrentOverviewAiArtifactIdentity({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      projectId,
      scopeId,
      user,
      ...(pin ? { pin } : {}),
    }),
    async execute({ identity, user, retry }) {
      requirePreschoolIdentity(identity);
      const store = input.metadataStore.energyIq.overviewAiArtifacts;
      const current = store.find(identity) ?? store.queue({
        identity,
        triggeredBy: user.id,
      });
      if (current.status === "available") return current;
      if (current.status === "failed" && !retry) return current;
      if (current.status === "running" && !retry) return current;

      const workerId = `overview-ai-server:${randomUUID()}`;
      const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
      if (!claim.claimed) return claim.artifact;

      try {
        requireRuntimeRevisionIdentity(input.metadataStore, identity, user);
        const snapshot = await resolveSnapshot({ identity, user });
        const context = buildWorkflowContext(snapshot, identity);
        const sessionId = workflowSessionId(identity, user.id, claim.artifact.attempt_count);
        const investigatorRunId = `overview-ai-investigator-${randomUUID()}`;
        const investigatorStage = await input.runStage({
          stage: "investigator",
          prompt: buildInvestigatorPrompt(context, identity),
          runId: investigatorRunId,
          sessionId,
          user,
          workspaceId: identity.workspaceId,
          identity,
        });
        requireCompletedStage(investigatorStage.completedRun, investigatorRunId, sessionId);
        const investigator = normalizeStageEvents(
          investigatorStage,
          "candidates",
          OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME,
        );
        const candidates = parseInvestigatorCandidates(investigator.answer);
        if (!candidates) throw new Error("OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID");

        const editorRunId = `overview-ai-editor-${randomUUID()}`;
        const editorStage = await input.runStage({
          stage: "editor",
          prompt: buildEditorPrompt(context, identity, candidates, investigator.tools),
          runId: editorRunId,
          sessionId,
          user,
          workspaceId: identity.workspaceId,
          identity,
        });
        requireCompletedStage(editorStage.completedRun, editorRunId, sessionId);
        const editor = normalizeStageEvents(editorStage, "findings");
        const envelope = parseEditorEnvelope(editor.answer, new Set(candidates.map(({ id }) => id)));
        if (!envelope) throw new Error("OVERVIEW_AI_EDITOR_RESULT_INVALID");

        const tools = investigator.tools;
        if (tools.length > 0 && !investigator.schemaValid) {
          throw new Error("OVERVIEW_AI_SQL_SCHEMA_NOT_INSPECTED");
        }
        requireRuntimeRevisionIdentity(input.metadataStore, identity, user);
        const result = materializeCanonicalArtifact({
          context,
          identity,
          investigatorRunId,
          editorRunId,
          candidates,
          envelope,
          tools,
        });
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId: editorRunId,
          resultJson: JSON.stringify(result),
        });
      } catch (error) {
        const errorCode = workflowErrorCode(error);
        try {
          return store.fail({ identity, workerId, errorCode });
        } catch {
          return store.get(identity);
        }
      }
    },
  };
}

function requireRuntimeRevisionIdentity(
  metadataStore: MetadataStore,
  identity: EnergyIqOverviewAiArtifactIdentity,
  user: UserRecord,
): void {
  const modelBinding = metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  if (!modelBinding
    || identity.modelProfileId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
    || modelBinding.revision !== identity.modelProfileRevision) {
    throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
  }
  const modelResource = metadataStore.configResources.find({
    workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    user_id: modelBinding.profile_owner_user_id,
    kind: "model-profile",
    id: modelBinding.profile_id,
  });
  if (!modelResource || modelResource.status !== "connected" || !modelResource.default_enabled) {
    throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
  }
  const skill = metadataStore.configResources.find({
    workspace_id: identity.workspaceId,
    user_id: user.id,
    kind: "skill",
    id: identity.methodSkillId,
  });
  if (!skill
    || skill.status !== "valid"
    || skill.payload.version !== identity.methodSkillRevision) {
    throw new Error("OVERVIEW_AI_METHOD_SKILL_REVISION_MISMATCH");
  }
}

function requirePreschoolIdentity(identity: EnergyIqOverviewAiArtifactIdentity): void {
  if (identity.projectId !== "preschool-demo"
    || identity.rendererKey !== "preschool-overview"
    || identity.resource !== "electricity"
    || !identity.analysisPeriodFrom
    || !identity.analysisPeriodTo) {
    throw new Error("OVERVIEW_AI_PRESCHOOL_IDENTITY_REQUIRED");
  }
}

function requireCompletedStage(
  completed: { runId: string; sessionId: string },
  expectedRunId: string,
  expectedSessionId: string,
): void {
  if (completed.runId !== expectedRunId || completed.sessionId !== expectedSessionId) {
    throw new Error("OVERVIEW_AI_RUNTIME_RUN_IDENTITY_MISMATCH");
  }
}

function buildWorkflowContext(
  snapshot: ProjectAnalysisSnapshot,
  identity: EnergyIqOverviewAiArtifactIdentity,
): WorkflowContext {
  if (snapshot.context.projectId !== identity.projectId
    || snapshot.context.scopeId !== identity.scopeId
    || snapshot.dataSnapshot.id !== identity.dataSnapshotId
    || snapshot.projectRelease.id !== identity.projectReleaseId
    || snapshot.renderer.key !== identity.rendererKey
    || snapshot.renderer.version !== identity.rendererVersion
    || snapshot.context.primaryPeriod.start !== identity.analysisPeriodFrom
    || snapshot.context.primaryPeriod.endExclusive !== identity.analysisPeriodTo
    || snapshot.dataQuality.status !== "complete") {
    throw new Error("OVERVIEW_AI_SNAPSHOT_IDENTITY_MISMATCH");
  }
  const benchmark = snapshot.preschoolBenchmark;
  const appliances = snapshot.preschoolAppliances?.status === "available"
    ? snapshot.preschoolAppliances
    : null;
  const operational = snapshot.preschoolOperational?.status === "available"
    ? snapshot.preschoolOperational
    : null;
  const signals = snapshot.preschoolDecisionSignals;
  if (!benchmark || benchmark.status !== "provisional"
    || !appliances
    || !signals || signals.status !== "available"
    || signals.context.dataSnapshotId !== identity.dataSnapshotId
    || signals.context.projectReleaseId !== identity.projectReleaseId) {
    throw new Error("OVERVIEW_AI_PRESCHOOL_FACTS_UNAVAILABLE");
  }
  const evidence: EvidenceItem[] = [
    evidenceItem("portfolio:window", "portfolio", "Published current-window Portfolio energy", "kWh", {
      usageKwh: snapshot.analysis.summary.usageKwh,
      averageDailyUsageKwh: snapshot.analysis.summary.averageDailyUsageKwh,
      centreCount: snapshot.analysis.childScopes.length,
    }, ["scope_summary_v1", "child_scope_breakdown_v1"]),
    evidenceItem("benchmark:portfolio-p75", "benchmark", "Published Portfolio peer cross-hairs", null, {
      percentile: 75,
      sampleSize: benchmark.sampleSize,
      euiP50: benchmark.portfolio.eui.p50,
      euiP75: benchmark.portfolio.eui.p75,
      perPaxP50: benchmark.portfolio.perPax.p50,
      perPaxP75: benchmark.portfolio.perPax.p75,
      metadataStatus: benchmark.evidence.metadataStatus,
    }, benchmark.evidence.sourceQueryIds, "Provisional metadata screening; not a confirmed cause."),
    ...benchmark.priorityCentreCodes.slice(0, 6).flatMap((centreCode) => {
      const centre = benchmark.centres.find((candidate) => candidate.centreCode === centreCode);
      return centre ? [evidenceItem(
        `benchmark:priority-centre:${centreCode}`,
        "centre",
        `Priority Centre ${centreCode}`,
        null,
        {
          centreCode,
          cohort: centre.cohort,
          usageKwh: centre.usageKwh,
          eui: centre.annualisedEuiKwhPerSqmYear,
          perPax: centre.mayKwhPerPerson,
          quadrant: centre.quadrant,
        },
        benchmark.evidence.sourceQueryIds,
        "Provisional area and headcount.",
      )] : [];
    }),
    ...(operational ? [
      evidenceItem("operating:portfolio", "operating", "Published Calendar energy split", "kWh", {
        totalKwh: operational.energy.totalKwh,
        standbyKwh: operational.energy.standbyKwh,
        standbySharePct: operational.energy.standbySharePct,
        operatingKwh: operational.energy.operatingKwh,
      }, ["scope_summary_v1", "operational_policy_scope_intervals_v1"], "Closed hours do not prove waste."),
      evidenceItem("spike:standby-summary", "spike", "Closed-hour Spike summary", null, {
        spikeCount: operational.spikes.standby.count,
        centreCount: operational.spikes.standby.centreCount,
        centres: operational.spikes.standby.centres.map(({ centreCode }) => centreCode).join(", "),
      }, ["preschool-operational-spikes-v2"], "A Spike is a screening signal, not a confirmed fault."),
      evidenceItem("spike:operating-summary", "spike", "Opening-hour Spike summary", null, {
        spikeCount: operational.spikes.operating.count,
        centreCount: operational.spikes.operating.centreCount,
        centres: operational.spikes.operating.centres.map(({ centreCode }) => centreCode).join(", "),
      }, ["preschool-operational-spikes-v2"], "Activity and equipment state are not observed."),
      evidenceItem("operating:sop-signal", "operating", operational.sop.label, null, {
        status: operational.sop.status,
        breachingCentres: operational.sop.breachingCentreCodes.join(", "),
      }, ["preschool-after-hours-sop-signal-v1"], "Provisional signal; not confirmed SOP compliance."),
    ] : []),
    ...appliances.appliances.slice(0, 3).map((appliance) => evidenceItem(
      `circuit:appliance:${appliance.name}`,
      "circuit",
      `${appliance.name} Portfolio contribution`,
      "kWh",
      {
        appliance: appliance.name,
        applianceGroup: appliance.applianceGroup,
        usageKwh: appliance.usageKwh,
        sharePct: appliance.sharePct,
        centreCount: appliance.centreCount,
      },
      [appliances.evidence.projectionRecipeId],
      "Published Circuit aliases are used as the Project-specific Appliance contract.",
    )),
    evidenceItem("quality:window", "quality", "Published current-window data quality", null, {
      status: snapshot.dataQuality.status,
      coveragePct: snapshot.dataQuality.coveragePct,
      validIntervalCount: snapshot.dataQuality.validIntervalCount,
      expectedMeterIntervalCount: snapshot.dataQuality.expectedMeterIntervalCount,
      qualityEventCount: snapshot.dataQuality.qualityEventCount,
    }, ["scope_summary_v1"]),
    evidenceItem("limitation:external-operational-evidence", "limitation", "External operational Evidence is not present", null, {
      evidenceStatus: "Missing Evidence",
      missing: "equipment state, occupancy, maintenance, confirmed on-site procedure, savings, ROI, owner, commitment",
    }, [], "Use Hypothesis or Exploration Idea for causes."),
  ].slice(0, 20);
  const binding = {
    projectId: "preschool-demo" as const,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    dataCutoff: identity.analysisPeriodTo,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    outputContractRevision: identity.outputContractRevision,
  };
  return {
    binding,
    evidence,
    knownCentreCodes: benchmark.centres.map(({ centreCode }) => centreCode),
    coverage: buildCoverage(binding, signals.items, evidence, Boolean(operational), true),
    decisionSignals: signals.items.map(({ id, label }) => ({ id, label })),
    projectName: snapshot.context.projectName,
    scopeName: snapshot.context.scopeName,
    timezone: snapshot.context.timezone,
  };
}

function evidenceItem(
  id: string,
  kind: string,
  label: string,
  unit: string | null,
  values: EvidenceItem["values"],
  queryIds: string[],
  limitation: string | null = null,
): EvidenceItem {
  return { id, kind, label, unit, values, queryIds, limitation };
}

function buildCoverage(
  binding: WorkflowContext["binding"],
  signals: NonNullable<ProjectAnalysisSnapshot["preschoolDecisionSignals"]>["items"],
  evidence: EvidenceItem[],
  operationalAvailable: boolean,
  applianceAvailable: boolean,
): unknown {
  const sections: Array<{ target: PlacementTarget; decisionQuestion: string }> = [
    { target: "preschool.overall-key-findings", decisionQuestion: "What changes the Portfolio priority or next management decision?" },
    { target: "preschool.benchmark", decisionQuestion: "What explains or changes the priority implied by the peer benchmark?" },
    { target: "preschool.standby", decisionQuestion: "Where is closed-hour energy persistent enough to investigate or act on?" },
    { target: "preschool.operating-hours", decisionQuestion: "What operating-hour relationship needs attention beyond the visible spike counts?" },
    { target: "preschool.forecast", decisionQuestion: "What decision-relevant uncertainty or planning implication is supported by this Snapshot?" },
    { target: "cross-section", decisionQuestion: "What relationship across sections changes the order of action?" },
  ];
  return {
    contract: { id: "preschool-overview-coverage", revision: "v1" },
    binding,
    sections: sections.map(({ target, decisionQuestion }) => {
      const wholePage = target === "preschool.overall-key-findings" || target === "cross-section";
      const visibleSignals = wholePage ? signals : signals.filter(({ id }) => signalPlacement(id) === target);
      const visibleEvidence = evidence.filter(({ id }) => wholePage || evidenceVisibleAt(id, target));
      return {
        target,
        decisionQuestion,
        visibleSignalRefs: visibleSignals.map(({ id }) => id),
        visibleEvidenceRefs: visibleEvidence.map(({ id }) => id),
        visibleVisuals: visibleVisuals(target, operationalAvailable, applianceAvailable),
        visibleClaims: [
          ...visibleSignals.map((signal) => ({
            id: signal.id,
            label: signal.label,
            metrics: signal.metrics.map(({ id, metricId, value, unit }) => ({ id, metricId, value, unit })),
            limitations: signal.limitations.map(({ label }) => label),
          })),
          ...visibleEvidence.map((item) => ({
            id: `visible-evidence:${item.id}`,
            label: item.label,
            metrics: Object.entries(item.values).flatMap(([id, value]) => typeof value === "number"
              ? [{ id: `${item.id}:${id}`, metricId: id, value, unit: item.unit ?? "value" }]
              : []),
            limitations: item.limitation ? [item.limitation] : [],
          })),
        ],
      };
    }),
  };
}

function visibleVisuals(target: PlacementTarget, operational: boolean, appliances: boolean): unknown[] {
  const overview = [{ id: "preschool.overall:portfolio-kpis", type: "kpi", topic: "Portfolio consumption, average daily consumption, Centre count, and data quality", claimRefs: ["analysis.summary", "dataQuality"], evidenceRefs: ["portfolio:window", "quality:window"] }];
  const benchmark = [{ id: "preschool.benchmark:normalised-centre-ranking", type: "ranking", topic: "Centre ranking and quadrant under floor-area and headcount normalisation", claimRefs: ["preschoolBenchmark.priorityCentreCodes", "preschoolBenchmark.centres"], evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:*"] }];
  const standby = operational ? [{ id: "preschool.standby:calendar-energy-split", type: "chart", topic: "Operating versus standby energy split and Spike distribution", claimRefs: ["preschoolOperational.energy", "preschoolOperational.spikes.standby"], evidenceRefs: ["operating:portfolio", "spike:standby-summary"] }] : [];
  const operating = operational ? [{ id: "preschool.operating-hours:spike-and-sop-table", type: "table", topic: "Operating-hour Spikes and provisional SOP signal by Centre", claimRefs: ["preschoolOperational.spikes.operating", "preschoolOperational.sop"], evidenceRefs: ["spike:operating-summary", "operating:sop-signal"] }] : [];
  const forecast = appliances ? [{ id: "preschool.forecast:appliance-contribution", type: "ranking", topic: "Published Appliance contribution and planning projection", claimRefs: ["preschoolAppliances.appliances"], evidenceRefs: ["circuit:appliance:*"] }] : [];
  if (target === "preschool.benchmark") return benchmark;
  if (target === "preschool.standby") return standby;
  if (target === "preschool.operating-hours") return operating;
  if (target === "preschool.forecast") return forecast;
  return [...overview, ...benchmark, ...standby, ...operating, ...forecast];
}

function signalPlacement(id: string): PlacementTarget | null {
  if (id === "efficiency") return "preschool.benchmark";
  if (id === "after-hours") return "preschool.standby";
  if (id === "operating") return "preschool.operating-hours";
  return null;
}

function evidenceVisibleAt(id: string, target: PlacementTarget): boolean {
  if (target === "preschool.benchmark") return id.startsWith("benchmark:");
  if (target === "preschool.standby") return id === "operating:portfolio" || id.includes("standby") || id === "operating:sop-signal";
  if (target === "preschool.operating-hours") return id === "operating:portfolio" || id === "operating:sop-signal" || id.includes("operating") && !id.includes("standby");
  if (target === "preschool.forecast") return id.startsWith("circuit:appliance:");
  return false;
}

function buildInvestigatorPrompt(context: WorkflowContext, identity: EnergyIqOverviewAiArtifactIdentity): string {
  return [
    `You are the Investigator in a fixed two-stage EnergyIQ workflow for ${context.projectName}, Scope ${context.scopeName}.`,
    `Work only inside Snapshot ${identity.dataSnapshotId}, Release ${identity.projectReleaseId}, and ${identity.analysisPeriodFrom} through ${identity.analysisPeriodTo} in ${context.timezone}.`,
    `Use ${identity.methodSkillId}@${identity.methodSkillRevision} as a discovery method, not a question checklist.`,
    "The Coverage is what the manager already sees. Investigate relationships, drivers, concentration, timing, contradictions, likely explanations, consequences, or useful next checks that add material value beyond visible claims and visuals.",
    "Before using SQL, choose one decision-changing question. Combine related dimensions when one query can answer them. Stop when another query would not change the conclusion, action, or uncertainty. Zero candidates is valid; there is no finding quota.",
    "Before every new SQL call, check whether Bounded Snapshot Evidence or an earlier successful SQL result already answers the decision-changing question. Do not rerun or reformulate an equivalent SQL query unless the prior call failed or omitted a field the final claim requires. Submit as soon as further SQL would not change the conclusion, action, or uncertainty.",
    "Use verified only for supported observations. Preserve useful hypotheses and exploration ideas, but do not invent causes, equipment state, occupancy, savings, ROI, ownership, commitment, thresholds, or forecasts.",
    "action is the concrete next step; expectedIfAct is the observable benefit if it is taken; ifIgnored is the bounded consequence of inaction. Do not turn either outcome into a forecast.",
    "possibleExplanation is optional and unconfirmed; when present it requires nextCheck. limitation is always required and must state what the pinned Evidence cannot establish.",
    "Every displayed number or named entity must occur in that candidate's cited bounded Evidence or successful SQL result.",
    "presentation is an optional Evidence-backed visual explanation, never a quota. Use zero blocks when prose is clearer or the visible Section already shows the same relationship. Add one or more blocks only when they materially clarify a comparison, ranking, share, time trend, distribution, heatmap pattern, exact lookup table, or decision callout. Never add a decorative chart.",
    "Choose the visual form from the relationship in the Evidence: comparison for a small direct contrast; ranking for an ordered shortlist; share for a few parts of a whole; trend for ordered time points; distribution for enough peer observations; heatmap only for a real two-dimensional matrix; table only when exact values matter more than shape. prominence may be primary or supporting; several important blocks are allowed, but omit redundant blocks.",
    "Presentation shape: {version:\"1\",blocks:[...]}. Quantitative blocks should copy their own exact evidenceRefs and/or evidenceSqlIndexes from this Candidate. Example: {type:\"comparison\",title:\"Daily energy around the change\",unit:\"kWh\",items:[{label:\"Before\",value:1200},{label:\"Changed day\",value:150}],prominence:\"primary\",evidenceSqlIndexes:[7]}. trend uses points; ranking/share/distribution use items; heatmap uses xLabels/yLabels/values; table uses columns/rows. If an otherwise valid block omits its binding, Runtime may inherit the Candidate's accepted Evidence set and still validates every label and value. Do not put HTML, JS, React, markdown charts, or invented values in presentation.",
    "evidenceRefs may contain only exact item.id strings copied verbatim from Bounded Snapshot Evidence. Never use claimRefs, Coverage claim paths, JSON property paths, labels, or queryIds as evidenceRefs. When SQL alone supports a candidate, evidenceRefs may be empty.",
    "A verified Candidate must cite at least one Catalog Evidence item or successful SQL evidence_index. Hypotheses and exploration ideas may remain unbound only when they make no unsupported factual claim and retain their limitation plus a concrete verification step in nextCheck or action.",
    "Any ranking, percentage, ratio, share, difference, or delta stated by a candidate must be explicitly returned by SQL; never calculate or estimate it yourself.",
    "Call overview_ai_candidates_submit with the final Candidate envelope. Do not emit Candidate JSON as Assistant text. If the tool reports field-level schema errors, resubmit the complete candidates[] envelope with every required field preserved; do not send only the corrected fields and do not repeat an unchanged invalid payload. After a successful submission, stop immediately and do not call SQL or the submission tool again.",
    "For evidenceSqlIndexes, copy verbatim the evidence_index returned by each successful run_sql_readonly result. Never infer, count, renumber, or guess an index; if a successful result lacks evidence_index, do not cite it. A zero-row successful result may have an index; an isError result never does.",
    "If any Candidate fact came from SQL, evidenceSqlIndexes must include every successful query that proves that fact. Example: if Centre H and its per-person value came from a result labelled evidence_index 7, submit evidenceSqlIndexes:[7]. A verified Candidate that uses SQL facts but submits evidenceSqlIndexes:[] is invalid.",
    `Prompt revision: ${identity.investigatorPromptRevision}.`,
    "Submit 0-3 candidates. These are transport limits for evidence-backed working notes, not display-copy targets: title<=240, takeaway<=800, action/expectedIfAct/ifIgnored/limitation<=600. Optional significance/possibleExplanation/nextCheck<=600. The Editor will make accepted content concise and customer-facing.",
    "Submission object shape: candidates[] with id, epistemicLevel, title, takeaway, action, expectedIfAct, ifIgnored, limitation, optional significance/possibleExplanation/nextCheck/presentation, evidenceRefs:string[], and evidenceSqlIndexes:number[]. For Catalog-backed verified findings copy exact item IDs into evidenceRefs; for SQL-backed verified findings copy returned evidence_index values into evidenceSqlIndexes.",
    "Complete shape example (replace every value with this Run's result): {\"candidates\":[{\"id\":\"investigation-angle\",\"epistemicLevel\":\"verified\",\"title\":\"Plain working title\",\"takeaway\":\"Evidence-backed explanation\",\"action\":\"Concrete next step\",\"expectedIfAct\":\"What the check will clarify\",\"ifIgnored\":\"Bounded consequence\",\"limitation\":\"What this Snapshot cannot establish\",\"evidenceRefs\":[],\"evidenceSqlIndexes\":[1]}]}.",
    "Overview Coverage:", JSON.stringify(context.coverage),
    "Bounded Snapshot Evidence:", JSON.stringify({ identity: context.binding, items: context.evidence }),
    "Project decision signals:", JSON.stringify({ items: context.decisionSignals }),
  ].join("\n\n");
}

function buildEditorPrompt(
  context: WorkflowContext,
  identity: EnergyIqOverviewAiArtifactIdentity,
  candidates: InvestigatorCandidate[],
  tools: ToolEvidence[],
): string {
  const evidenceById = new Map(context.evidence.map((item) => [item.id, item]));
  const candidateViews = candidates.map((candidate) => ({
    id: candidate.id,
    epistemicLevel: candidate.epistemicLevel,
    title: editorPreview(candidate.title, MAX_CANDIDATE_TITLE_CHARS),
    takeaway: editorPreview(candidate.takeaway, MAX_CANDIDATE_TAKEAWAY_CHARS),
    action: editorPreview(candidate.action, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS),
    expectedIfAct: editorPreview(candidate.expectedIfAct, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS),
    ifIgnored: editorPreview(candidate.ifIgnored, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS),
    limitation: editorPreview(candidate.limitation, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS),
    ...(candidate.significance
      ? { significance: editorPreview(candidate.significance, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS) }
      : {}),
    ...(candidate.possibleExplanation
      ? { possibleExplanation: editorPreview(candidate.possibleExplanation, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS) }
      : {}),
    ...(candidate.nextCheck
      ? { nextCheck: editorPreview(candidate.nextCheck, MAX_EDITOR_CANDIDATE_SUPPORTING_PREVIEW_CHARS) }
      : {}),
    evidenceRefs: candidate.evidenceRefs.slice(0, MAX_EDITOR_EVIDENCE_REFS)
      .map((reference) => editorPreview(reference, MAX_EDITOR_EVIDENCE_REF_CHARS)),
    evidenceSqlIndexes: candidate.evidenceSqlIndexes.slice(0, MAX_EDITOR_SQL_INDEXES),
    unsupportedFields: candidateNarrativeEntries(candidate).flatMap(([field, text]) => (
      unsupportedNarrative(
        text,
        candidate.evidenceRefs.flatMap((id) => evidenceById.get(id) ? [evidenceById.get(id)!] : []),
        tools,
        context.knownCentreCodes,
      ) ? [field] : []
    )),
    ...(candidate.presentation
      ? {
          presentation: candidate.presentation.blocks.slice(0, MAX_EDITOR_PRESENTATION_BLOCKS)
            .map(editorPresentationPreview),
        }
      : {}),
  }));
  const prompt = [
    `Pin ${identity.dataSnapshotId}|${identity.projectReleaseId}|${identity.analysisPeriodFrom}–${identity.analysisPeriodTo}.`,
    "You are the final customer-facing Editor. Select useful non-repetition (zero valid; each once), then rewrite each accepted Candidate into plain English that a non-technical manager can understand.",
    "Keep exactly one source Candidate identity per Finding. You may shorten, reorganise, or remove unsupported detail, but never add a number, date, Centre, cause, or fact that is absent from the source Candidate.",
    "unsupportedFields names Candidate fields that the Runtime cannot prove from this Run's Evidence. Rewrite those fields without the unsupported factual detail. Optional fields may be omitted. Required copy fields must remain useful, specific, and concise.",
    "For every field named in unsupportedFields, remove every numeral, explicit count, quantity, ratio, date, and unsupported comparison from that field. Do not preserve an unsupported value by paraphrasing it. Example: rewrite 'highest of all 30 Centres' as 'stands out across the portfolio'. Keep the insight and action, not the unproved detail.",
    "Organise each Finding for scanning, not as an essay. Soft targets: title 8-14 words; takeaway one sentence of about 35 words or fewer; significance one short 'why this matters' sentence; action one direct sentence; expectedIfAct, ifIgnored, nextCheck, and limitation one short sentence each. These are writing goals, not Runtime rejection thresholds.",
    "Use ordinary human language. Say 'smaller Centres use about the same electricity' instead of 'denominator effect', explain EUI as 'energy per square metre', and keep technical method details out of the main copy.",
    "Judge value/depth/honesty/placement/clarity. Do not repeat the visible dashboard. You cannot query Schema or SQL.",
    "Similar absolute kWh does not invalidate EUI/per-pax. With provisional area/headcount: verify metadata first; if correct, investigate equipment that keeps drawing similar electricity regardless of site size, operating schedules, or another supported driver. This is conditional, not mandatory.",
    "placementTargets: preschool.{overall-key-findings|benchmark|standby|operating-hours|forecast} or cross-section.",
    `${identity.outputContractRevision}; ${identity.editorPromptRevision}; JSON.`,
    "JSON only: findings[{sourceCandidateIds:[id],placementTargets:[target],relationship:\"supports|challenges|independent\",signalRefs:[],copy:{title,takeaway,action,expectedIfAct,ifIgnored,limitation,significance?,possibleExplanation?,nextCheck?}}], trace[{decision:\"accepted|rejected\",sourceCandidateIds:[id]}].",
    "Investigator candidates", JSON.stringify(candidateViews),
    "Overview Coverage (compact):", JSON.stringify(compactEditorCoverage(context.coverage)),
  ].join("\n");
  if (prompt.length > MAX_EDITOR_PROMPT_CHARS) {
    throw new Error(`OVERVIEW_AI_EDITOR_PROMPT_TOO_LARGE:${prompt.length}`);
  }
  return prompt;
}

function compactEditorCoverage(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.sections)) return value;
  return Object.fromEntries(value.sections.flatMap((section) => {
    if (!isRecord(section) || typeof section.target !== "string") return [];
    return [[section.target, {
      s: section.visibleSignalRefs,
      v: Array.isArray(section.visibleVisuals)
        ? section.visibleVisuals.flatMap((visual) => isRecord(visual) ? [visual.type] : [])
        : [],
    }]];
  }));
}

function editorPreview(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function editorPresentationPreview(block: AiFindingPresentation["blocks"][number]): Record<string, unknown> {
  const source = block.type === "metric"
    ? block.label
    : block.type === "callout"
      ? block.text
      : block.title;
  return {
    type: block.type,
    ...(source ? { text: editorPreview(source, MAX_EDITOR_PRESENTATION_TEXT_CHARS) } : {}),
  };
}

function normalizeStageEvents(
  input: { events: ReadonlyArray<Record<string, unknown>> },
  envelopeKey: "candidates" | "findings",
  submissionToolName?: string,
): {
  answer: string;
  schemaValid: boolean;
  tools: ToolEvidence[];
} {
  const runError = [...input.events].reverse().find(({ type }) => type === "RUN_ERROR");
  if (runError) throw new Error(typeof runError.message === "string" ? runError.message : "OVERVIEW_AI_STAGE_FAILED");
  if (!input.events.some(({ type }) => type === "RUN_FINISHED")) throw new Error("OVERVIEW_AI_STAGE_INCOMPLETE");
  if (submissionToolName) {
    const submission = collectStructuredSubmission(input.events, submissionToolName);
    return {
      answer: submission ? JSON.stringify(submission.payload) : "",
      ...collectTools(input.events, submission?.successfulStartIndex ?? 0, true),
    };
  }
  const messageOrder: string[] = [];
  const messages = new Map<string, string>();
  for (const event of input.events) {
    if (event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "TEXT_MESSAGE_CHUNK") continue;
    const messageId = stringValue(event.messageId) ?? stringValue(event.message_id) ?? "legacy-assistant-message";
    if (!messages.has(messageId)) messageOrder.push(messageId);
    messages.set(messageId, `${messages.get(messageId) ?? ""}${textChunkValue(event.delta)}`);
  }
  const orderedAnswers = [...messageOrder].reverse()
    .map((messageId) => messages.get(messageId)?.trim() ?? "")
    .filter(Boolean);
  const answer = orderedAnswers.find((candidate) => findEnvelope(candidate, envelopeKey))
    ?? orderedAnswers[0]
    ?? "";
  return { answer, ...collectTools(input.events) };
}

function collectStructuredSubmission(
  events: ReadonlyArray<Record<string, unknown>>,
  submissionToolName: string,
): { payload: Record<string, unknown>; successfulStartIndex: number } | null {
  const attempts = new Map<string, { name?: string; result?: unknown; resultIndex?: number }>();
  const starts: Array<{ id: string; startIndex: number }> = [];
  for (const [eventIndex, event] of events.entries()) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const current = attempts.get(id) ?? {};
    const name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name);
    if (name) current.name = name;
    if (event.type === "TOOL_CALL_START" && name === submissionToolName) {
      starts.push({ id, startIndex: eventIndex });
    }
    if (event.type === "TOOL_CALL_RESULT") {
      current.result = event.result ?? event.content;
      current.resultIndex = eventIndex;
    }
    attempts.set(id, current);
  }
  if (starts.length === 0
    || new Set(starts.map(({ id }) => id)).size !== starts.length) return null;
  const results = starts.flatMap(({ id, startIndex }) => {
    const attempt = attempts.get(id);
    if (!attempt || attempt.name !== submissionToolName || attempt.result === undefined
      || attempt.resultIndex === undefined || attempt.resultIndex <= startIndex) return [];
    const { result } = attempt;
    const parsed = typeof result === "string" ? parseUnknown(result) : result;
    return isRecord(parsed) ? [{ parsed, startIndex }] : [];
  });
  if (results.length !== starts.length) return null;
  const successful = results.flatMap(({ parsed, startIndex }, attemptIndex) => (
    parsed.ok === true
      && parsed.resultType === "overview-ai-candidate-submission"
      && isRecord(parsed.payload)
      ? [{ payload: parsed.payload, startIndex, attemptIndex }]
      : []
  ));
  if (successful.length !== 1 || successful[0]!.attemptIndex !== starts.length - 1) return null;
  if (results.slice(0, -1).some(({ parsed }) => parsed.ok === true)) return null;
  return {
    payload: successful[0]!.payload,
    successfulStartIndex: successful[0]!.startIndex,
  };
}

function collectTools(
  events: ReadonlyArray<Record<string, unknown>>,
  beforeIndex = events.length,
  requireRuntimeEvidenceIndex = false,
): {
  schemaValid: boolean;
  tools: ToolEvidence[];
} {
  const attempts = new Map<string, {
    name: string;
    argsText: string;
    args: Record<string, unknown> | null;
    result: unknown;
    resultIndex: number | null;
  }>();
  for (const [eventIndex, event] of events.slice(0, beforeIndex).entries()) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const current = attempts.get(id) ?? { name: "unknown", argsText: "", args: null, result: undefined, resultIndex: null };
    current.name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? current.name;
    if (event.type === "TOOL_CALL_ARGS") current.argsText += stringValue(event.delta) ?? "";
    if (isRecord(event.args)) current.args = event.args;
    if (isRecord(event.parameters)) current.args = event.parameters;
    if (event.type === "TOOL_CALL_RESULT") {
      current.result = event.result ?? event.content;
      current.resultIndex = eventIndex;
    }
    attempts.set(id, current);
  }
  for (const attempt of attempts.values()) {
    if (attempt.argsText && !attempt.args) attempt.args = parseRecord(attempt.argsText);
  }
  const schemaValid = [...attempts.values()].some(({ name, result }) => name === "inspect_schema" && validSchemaResult(result));
  const collected = [...attempts.entries()]
    .sort(([, left], [, right]) => (left.resultIndex ?? Number.MAX_SAFE_INTEGER) - (right.resultIndex ?? Number.MAX_SAFE_INTEGER))
    .flatMap<Array<Omit<ToolEvidence, "evidenceIndex"> & { reportedEvidenceIndex: number | null }>[number]>(([toolCallId, attempt]) => {
    if (attempt.name !== "run_sql_readonly") return [];
    const result = parseSqlResult(attempt.result);
    if (!result) return [];
    const preview = typeof attempt.result === "string" ? attempt.result : JSON.stringify(attempt.result);
    return [{
      toolCallId,
      sql: typeof attempt.args?.sql === "string" && attempt.args.sql.trim() ? attempt.args.sql : result.sql,
      rowCount: result.rowCount,
      auditLogId: result.auditLogId,
      elapsedMs: result.elapsedMs,
      resultPreview: preview.slice(0, MAX_EVIDENCE_PREVIEW_CHARS),
      columns: result.columns,
      rows: result.rows,
      reportedEvidenceIndex: result.evidenceIndex,
    }];
  });
  const tools = collected.map(({ reportedEvidenceIndex, ...tool }, index) => {
    const expectedEvidenceIndex = index + 1;
    if (requireRuntimeEvidenceIndex && reportedEvidenceIndex !== expectedEvidenceIndex) {
      throw new Error(`OVERVIEW_AI_SQL_EVIDENCE_INDEX_MISMATCH:${reportedEvidenceIndex ?? "missing"}:${expectedEvidenceIndex}`);
    }
    return { ...tool, evidenceIndex: reportedEvidenceIndex ?? expectedEvidenceIndex };
  });
  return { schemaValid, tools };
}

function materializeCanonicalArtifact(input: {
  context: WorkflowContext;
  identity: EnergyIqOverviewAiArtifactIdentity;
  investigatorRunId: string;
  editorRunId: string;
  candidates: InvestigatorCandidate[];
  envelope: { findings: EditorSelection[]; trace: TraceDecision[] };
  tools: ToolEvidence[];
}): Record<string, unknown> {
  const evidenceById = new Map(input.context.evidence.map((item) => [item.id, item]));
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const signalIds = new Set(input.context.decisionSignals.map(({ id }) => id));
  const validation = input.envelope.findings.map((selection) => {
    const candidate = candidateById.get(selection.sourceCandidateIds[0]!);
    if (!candidate) return { status: "rejected" as const, selection, reason: "candidate is unavailable" };
    if (selection.signalRefs.some((id) => !signalIds.has(id))) {
      return { status: "rejected" as const, selection, reason: "signalRefs are outside the bounded decision signals" };
    }
    const evidence = candidate.evidenceRefs.flatMap((id) => {
      const item = evidenceById.get(id);
      return item ? [item] : [];
    });
    const tools = candidate.evidenceSqlIndexes.flatMap((index) => {
      const tool = input.tools[index - 1];
      return tool ? [tool] : [];
    });
    if (evidence.length !== candidate.evidenceRefs.length) {
      return { status: "rejected" as const, selection, reason: "evidenceRefs are outside the bounded Snapshot" };
    }
    if (tools.length !== candidate.evidenceSqlIndexes.length) {
      return { status: "rejected" as const, selection, reason: "SQL indexes are outside pre-submission successful results" };
    }
    if (candidate.epistemicLevel === "verified" && evidence.length === 0 && tools.length === 0) {
      return { status: "rejected" as const, selection, reason: "verified content has no accepted Evidence" };
    }
    const display = selection.copy ?? candidate;
    const narrative = candidateNarrativeEntries(display).map(([, text]) => text);
    const reboundTools = narrative.some((text) => unsupportedNarrative(
      text,
      evidence,
      tools,
      input.context.knownCentreCodes,
    ))
      ? minimalRunSqlEvidence(narrative, evidence, input.tools, input.context.knownCentreCodes)
      : tools;
    if (!reboundTools) {
      return { status: "rejected" as const, selection, reason: "narrative is unsupported by cited Evidence" };
    }
    const presentation = filterAiFindingPresentationEvidence(candidate.presentation, {
      evidenceRefs: evidence.map(({ id }) => id),
      evidenceSqlIndexes: reboundTools.map(({ evidenceIndex }) => evidenceIndex),
    });
    const safePresentation = presentation && presentationNarratives(presentation).every((text) => (
      !unsupportedNarrative(text, evidence, reboundTools, input.context.knownCentreCodes)
    ))
      ? presentation
      : null;
    return { status: "accepted" as const, selection, candidate, display, evidence, tools: reboundTools, presentation: safePresentation };
  });
  const accepted = validation.flatMap((result) => result.status === "accepted" ? [result] : []);
  const runtimeRejected = validation.flatMap((result) => result.status === "rejected" ? [result] : []);
  if (input.envelope.findings.length > 0 && accepted.length === 0) {
    throw new Error("OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL");
  }
  const findings = accepted.map(({ selection, candidate, display, evidence, tools, presentation }, index) => {
    const interpretation = display.significance;
    return {
      id: `preschool-ai-finding-${index + 1}`,
      binding: input.context.binding,
      placementTargets: selection.placementTargets,
      epistemicLevel: candidate.epistemicLevel,
      relationship: selection.relationship,
      signalRefs: selection.signalRefs,
      title: display.title,
      takeaway: display.takeaway,
      ...(interpretation ? { interpretation } : {}),
      action: display.action,
      expectedIfAct: display.expectedIfAct,
      ifIgnored: display.ifIgnored,
      ...(display.nextCheck ? { verification: display.nextCheck } : {}),
      uncertainty: display.limitation,
      ...(display.possibleExplanation ? { possibleExplanation: display.possibleExplanation } : {}),
      ...(presentation ? { presentation } : {}),
      evidence: {
        snapshotId: input.identity.dataSnapshotId,
        period: input.context.binding.analysisPeriod,
        deterministic: evidence,
        tools: tools.map(({ columns: _, rows: __, ...tool }) => tool),
      },
    };
  });
  const findingIdBySources = new Map(accepted.map(({ selection }, index) => [
    sourceKey(selection.sourceCandidateIds),
    findings[index]!.id,
  ]));
  const runtimeRejectionBySources = new Map(runtimeRejected.map(({ selection, reason }) => [
    sourceKey(selection.sourceCandidateIds),
    `Runtime validation rejected: ${reason}.`,
  ]));
  const trace = input.envelope.trace.map((decision) => {
    const key = sourceKey(decision.sourceCandidateIds);
    const runtimeReason = runtimeRejectionBySources.get(key);
    if (runtimeReason) {
      return { decision: "rejected" as const, sourceCandidateIds: decision.sourceCandidateIds, reason: runtimeReason };
    }
    const findingId = findingIdBySources.get(key);
    return findingId && decision.decision !== "rejected" ? { ...decision, findingId } : decision;
  });
  const traced = new Set(trace.map(({ sourceCandidateIds }) => sourceKey(sourceCandidateIds)));
  for (const [index, { selection }] of accepted.entries()) {
    if (!traced.has(sourceKey(selection.sourceCandidateIds))) {
      trace.push({ decision: "accepted", sourceCandidateIds: selection.sourceCandidateIds, findingId: findings[index]!.id });
    }
  }
  for (const { selection, reason } of runtimeRejected) {
    if (!traced.has(sourceKey(selection.sourceCandidateIds))) {
      trace.push({
        decision: "rejected",
        sourceCandidateIds: selection.sourceCandidateIds,
        reason: `Runtime validation rejected: ${reason}.`,
      });
    }
  }
  return {
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.editorRunId,
    packId: input.identity.analysisPackId,
    packRevision: input.identity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: input.identity.outputContractRevision },
    binding: input.context.binding,
    workflow: {
      id: "preschool-two-stage",
      revision: input.identity.workflowRevision,
      methodSkill: { id: input.identity.methodSkillId, revision: input.identity.methodSkillRevision },
      stages: {
        investigator: { runId: input.investigatorRunId, promptRevision: input.identity.investigatorPromptRevision },
        editor: { runId: input.editorRunId, promptRevision: input.identity.editorPromptRevision },
      },
      ...(trace.length > 0 ? { editorTrace: trace } : {}),
    },
    findings,
  };
}

function parseInvestigatorCandidates(answer: string): InvestigatorCandidate[] | null {
  const envelope = findEnvelope(answer, "candidates");
  if (!envelope || !Array.isArray(envelope.candidates)
    || envelope.candidates.length > MAX_INVESTIGATOR_CANDIDATES) return null;
  const candidates = envelope.candidates.flatMap<InvestigatorCandidate>((value) => {
    if (!isRecord(value)) return [];
    const id = cleanId(value.id);
    const epistemicLevel = epistemic(value.epistemicLevel);
    const title = cleanText(value.title, MAX_CANDIDATE_TITLE_CHARS);
    const takeaway = cleanText(value.takeaway, MAX_CANDIDATE_TAKEAWAY_CHARS);
    const action = cleanText(value.action, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const expectedIfAct = cleanText(value.expectedIfAct, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const ifIgnored = cleanText(value.ifIgnored, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const limitation = cleanText(value.limitation, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const significance = optionalBoundedText(value.significance, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const possibleExplanation = optionalBoundedText(value.possibleExplanation, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const nextCheck = optionalBoundedText(value.nextCheck, MAX_CANDIDATE_SUPPORTING_TEXT_CHARS);
    const evidenceRefs = strings(value.evidenceRefs);
    const evidenceSqlIndexes = positiveIntegers(value.evidenceSqlIndexes);
    if (!id || !epistemicLevel || !title || !takeaway || !action || !expectedIfAct || !ifIgnored || !limitation
      || significance === null || possibleExplanation === null || nextCheck === null
      || possibleExplanation && !nextCheck || evidenceSqlIndexes === null
      || epistemicLevel === "verified" && evidenceRefs.length === 0 && evidenceSqlIndexes.length === 0) return [];
    const presentation = parseCandidatePresentation(value.presentation, evidenceRefs, evidenceSqlIndexes);
    return [{
      id, epistemicLevel, title, takeaway, action, expectedIfAct, ifIgnored, limitation,
      ...(significance ? { significance } : {}),
      ...(possibleExplanation ? { possibleExplanation } : {}),
      ...(nextCheck ? { nextCheck } : {}),
      evidenceRefs,
      evidenceSqlIndexes,
      ...(presentation ? { presentation } : {}),
    }];
  });
  return candidates.length === envelope.candidates.length
    && new Set(candidates.map(({ id }) => id)).size === candidates.length ? candidates : null;
}

function parseCandidatePresentation(
  value: unknown,
  evidenceRefs: string[],
  evidenceSqlIndexes: number[],
): AiFindingPresentation | null {
  if (!isRecord(value) || !Array.isArray(value.blocks)) return parseAiFindingPresentation(value);
  const blocks = value.blocks.map((block) => {
    if (!isRecord(block)) return block;
    const hasOwnBinding = Array.isArray(block.evidenceRefs) && block.evidenceRefs.length > 0
      || Array.isArray(block.evidenceSqlIndexes) && block.evidenceSqlIndexes.length > 0;
    if (hasOwnBinding) return block;
    return {
      ...block,
      ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
      ...(evidenceSqlIndexes.length > 0 ? { evidenceSqlIndexes } : {}),
    };
  });
  return parseAiFindingPresentation({ ...value, blocks });
}

function parseEditorEnvelope(answer: string, candidateIds: ReadonlySet<string>): { findings: EditorSelection[]; trace: TraceDecision[] } | null {
  const envelope = findEnvelope(answer, "findings");
  if (!envelope || !Array.isArray(envelope.findings)) return null;
  const findings = envelope.findings.flatMap<EditorSelection>((value) => {
    if (!isRecord(value)) return [];
    const sourceCandidateIds = strings(value.sourceCandidateIds);
    const placementTargets = placements(value.placementTargets);
    // Relationship is presentation metadata, not a factual claim. A blank model value is
    // safely equivalent to independent; unknown non-blank values remain invalid.
    const relationship = value.relationship === "" ? "independent" : relation(value.relationship);
    const copy = value.copy === undefined ? undefined : parseEditorCopy(value.copy);
    if (sourceCandidateIds.length !== 1 || !candidateIds.has(sourceCandidateIds[0]!)
      || !placementTargets?.length || !relationship || value.copy !== undefined && !copy) return [];
    return [{
      sourceCandidateIds, placementTargets, relationship,
      signalRefs: strings(value.signalRefs),
      ...(copy ? { copy } : {}),
    }];
  });
  if (findings.length !== envelope.findings.length
    || new Set(findings.map(({ sourceCandidateIds }) => sourceCandidateIds[0])).size !== findings.length) return null;
  const trace = Array.isArray(envelope.trace) ? envelope.trace.flatMap<TraceDecision>((value) => {
    if (!isRecord(value) || value.decision !== "accepted" && value.decision !== "rejected") return [];
    const sourceCandidateIds = strings(value.sourceCandidateIds);
    if (sourceCandidateIds.length !== 1 || !candidateIds.has(sourceCandidateIds[0]!)) return [];
    return [{
      decision: value.decision,
      sourceCandidateIds,
      ...optionalText("reason", value.reason),
    }];
  }) : [];
  // Trace is non-authoritative audit prose. Ignore malformed trace entries and derive the
  // canonical accepted/rejected trace from validated selections below.
  const selectedIds = new Set(findings.map(({ sourceCandidateIds }) => sourceCandidateIds[0]!));
  if (trace.some(({ decision, sourceCandidateIds }) => (
    decision === "accepted" && !selectedIds.has(sourceCandidateIds[0]!)
    || decision === "rejected" && selectedIds.has(sourceCandidateIds[0]!)
  ))) return null;
  return { findings, trace };
}

function parseEditorCopy(value: unknown): EditorCopy | null {
  if (!isRecord(value)) return null;
  const title = cleanText(value.title, MAX_EDITOR_TITLE_CHARS);
  const takeaway = cleanText(value.takeaway, MAX_EDITOR_TAKEAWAY_CHARS);
  const action = cleanText(value.action, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  const expectedIfAct = cleanText(value.expectedIfAct, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  const ifIgnored = cleanText(value.ifIgnored, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  const limitation = cleanText(value.limitation, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  const significance = optionalBoundedText(value.significance, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  const possibleExplanation = optionalBoundedText(value.possibleExplanation, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  const nextCheck = optionalBoundedText(value.nextCheck, MAX_EDITOR_SUPPORTING_TEXT_CHARS);
  if (!title || !takeaway || !action || !expectedIfAct || !ifIgnored || !limitation
    || significance === null || possibleExplanation === null || nextCheck === null
    || possibleExplanation && !nextCheck) return null;
  return {
    title, takeaway, action, expectedIfAct, ifIgnored, limitation,
    ...(significance ? { significance } : {}),
    ...(possibleExplanation ? { possibleExplanation } : {}),
    ...(nextCheck ? { nextCheck } : {}),
  };
}

function candidateNarrativeEntries(candidate: EditorCopy | InvestigatorCandidate): Array<[keyof EditorCopy, string]> {
  const entries: Array<[keyof EditorCopy, string | undefined]> = [
    ["title", candidate.title],
    ["takeaway", candidate.takeaway],
    ["action", candidate.action],
    ["expectedIfAct", candidate.expectedIfAct],
    ["ifIgnored", candidate.ifIgnored],
    ["limitation", candidate.limitation],
    ["significance", candidate.significance],
    ["possibleExplanation", candidate.possibleExplanation],
    ["nextCheck", candidate.nextCheck],
  ];
  return entries.filter((entry): entry is [keyof EditorCopy, string] => Boolean(entry[1]));
}

function minimalRunSqlEvidence(
  narrative: string[],
  evidence: EvidenceItem[],
  runTools: ToolEvidence[],
  knownCentreCodes: readonly string[],
): ToolEvidence[] | null {
  const supportsAll = (tools: ToolEvidence[]) => narrative.every((text) => (
    !unsupportedNarrative(text, evidence, tools, knownCentreCodes)
  ));
  if (!supportsAll(runTools)) return null;
  const selected = [...runTools];
  for (let index = 0; index < selected.length;) {
    const trial = selected.filter((_, candidateIndex) => candidateIndex !== index);
    if (supportsAll(trial)) selected.splice(index, 1);
    else index += 1;
  }
  return selected;
}

function unsupportedNarrative(
  text: string,
  evidence: EvidenceItem[],
  tools: ToolEvidence[],
  knownCentreCodes: readonly string[],
): boolean {
  if (!narrativeDateTimesSupported(text, evidence, tools)) return true;
  if (!energyAiNarrativeClaimsSupported({
    narrative: text,
    evidence,
    sqlEvidence: tools,
    knownCentreCodes,
  })) return true;
  const allowedEntities = new Set([
    ...evidence.flatMap(({ values }) => collectStrings(values)),
    ...tools.flatMap(({ rows }) => collectStrings(rows)),
  ].map((value) => value.toLowerCase()));
  const centreCodes = [...text.matchAll(/\bcent(?:re|er)\s+([A-Za-z0-9_-]+)\b/gu)]
    .map((match) => match[1]!).filter((value) => /\d/u.test(value) || /^[A-Z]{1,8}$/u.test(value));
  return centreCodes.some((code) => !allowedEntities.has(code.toLowerCase()));
}

function narrativeDateTimesSupported(text: string, evidence: EvidenceItem[], tools: ToolEvidence[]): boolean {
  const claims = [
    ...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu),
    ...text.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu),
  ].map((match) => match[0]);
  if (claims.length === 0) return true;
  const citedSource = JSON.stringify({
    evidence: evidence.map(({ values }) => values),
    tools: tools.map(({ columns, rows }) => ({ columns, rows })),
  });
  return claims.every((claim) => citedSource.includes(claim));
}

function presentationNarratives(presentation: AiFindingPresentation): string[] {
  return presentation.blocks.flatMap((block) => {
    const title = "title" in block && block.title ? [block.title] : [];
    if (block.type === "metric") {
      return [...title, `${block.label} ${block.value}${block.unit ? ` ${block.unit}` : ""}`, ...(block.context ? [block.context] : [])];
    }
    if (block.type === "comparison" || block.type === "ranking" || block.type === "share" || block.type === "distribution") {
      return [
        ...title,
        ...block.items.map(({ label, value }) => `${label} ${value}${block.unit ? ` ${block.unit}` : ""}`),
      ];
    }
    if (block.type === "trend") {
      return [
        ...title,
        ...block.points.map(({ label, value }) => `${label} ${value}${block.unit ? ` ${block.unit}` : ""}`),
      ];
    }
    if (block.type === "heatmap") {
      return [
        ...title,
        ...block.values.flatMap((row, rowIndex) => row.map((value, columnIndex) => (
          `${block.yLabels[rowIndex]} ${block.xLabels[columnIndex]} ${value}${block.unit ? ` ${block.unit}` : ""}`
        ))),
      ];
    }
    if (block.type === "table") {
      return [
        ...title,
        ...block.rows.flatMap((row) => row.map((value, columnIndex) => `${block.columns[columnIndex]} ${value}`)),
      ];
    }
    if (block.type === "callout") return [block.text];
    return [];
  });
}

function parseSqlResult(value: unknown): { columns: string[]; rows: unknown[]; rowCount: number | null; auditLogId: string | null; elapsedMs: number | null; sql: string | null; evidenceIndex: number | null } | null {
  const record = unwrapRecord(value);
  if (!record || !Array.isArray(record.columns) || !Array.isArray(record.rows)) return null;
  return {
    columns: record.columns.filter((item): item is string => typeof item === "string"),
    rows: record.rows,
    rowCount: typeof record.row_count === "number" && Number.isSafeInteger(record.row_count) ? record.row_count : null,
    auditLogId: stringValue(record.audit_log_id) ?? null,
    elapsedMs: typeof record.elapsed_ms === "number" && Number.isFinite(record.elapsed_ms) ? record.elapsed_ms : null,
    sql: stringValue(record.sql) ?? null,
    evidenceIndex: typeof record.evidence_index === "number"
      && Number.isSafeInteger(record.evidence_index)
      && record.evidence_index > 0
        ? record.evidence_index
        : null,
  };
}

function validSchemaResult(value: unknown): boolean {
  const record = unwrapRecord(value);
  return Boolean(record && Array.isArray(record.tables) && record.tables.length > 0);
}

function unwrapRecord(value: unknown): Record<string, unknown> | null {
  let current = typeof value === "string" ? parseUnknown(value) : value;
  if (!isRecord(current)) return null;
  if (typeof current.observation === "string") current = parseUnknown(current.observation) ?? current.observation;
  if (!isRecord(current)) return null;
  return isRecord(current.result) ? current.result : current;
}

function findEnvelope(answer: string, key: "candidates" | "findings"): Record<string, unknown> | null {
  if (answer.length > MAX_ANSWER_CHARS) return null;
  for (let start = answer.lastIndexOf("{"); start >= 0;) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < answer.length; index += 1) {
      const character = answer[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
      } else if (character === "\"") inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        const source = answer.slice(start, index + 1);
        const parsed = parseUnknown(source)
          ?? (key === "candidates" ? parseCandidateEnvelopeWithoutMalformedPresentation(source) : undefined);
        if (isRecord(parsed) && Object.hasOwn(parsed, key)) return parsed;
        break;
      }
    }
    if (start === 0) break;
    start = answer.lastIndexOf("{", start - 1);
  }
  return null;
}

/**
 * Presentation is optional. If a model emits valid candidate fields but makes a
 * syntax error inside a final `presentation` object, preserve the candidate and
 * drop only that optional object. This deliberately does not repair arbitrary
 * JSON or any required customer-facing field.
 */
function parseCandidateEnvelopeWithoutMalformedPresentation(source: string): unknown {
  let repaired = source;
  let removed = false;
  while (true) {
    const matches = [...repaired.matchAll(/,\s*"presentation"\s*:\s*/gu)];
    const match = matches.at(-1);
    if (!match || match.index === undefined) break;
    const valueStart = match.index + match[0].length;
    if (repaired[valueStart] !== "{") return undefined;
    const presentationEnd = balancedObjectEnd(repaired, valueStart);
    if (presentationEnd === null) return undefined;
    let candidateEnd = presentationEnd;
    while (/\s/u.test(repaired[candidateEnd] ?? "")) candidateEnd += 1;
    if (repaired[candidateEnd] !== "}") return undefined;
    let afterCandidate = candidateEnd + 1;
    while (/\s/u.test(repaired[afterCandidate] ?? "")) afterCandidate += 1;
    if (repaired[afterCandidate] !== "," && repaired[afterCandidate] !== "]") return undefined;
    repaired = `${repaired.slice(0, match.index)}${repaired.slice(candidateEnd)}`;
    removed = true;
  }
  return removed ? parseUnknown(repaired) : undefined;
}

function balancedObjectEnd(source: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
    } else if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index + 1;
  }
  return null;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim(), ...value.split(/[,;]\s*/u).filter(Boolean)];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

function placements(value: unknown): PlacementTarget[] | null {
  if (!Array.isArray(value)) return null;
  const aliases: Readonly<Record<string, PlacementTarget>> = {
    "overall-key-findings": "preschool.overall-key-findings",
    benchmark: "preschool.benchmark",
    standby: "preschool.standby",
    "operating-hours": "preschool.operating-hours",
    forecast: "preschool.forecast",
  };
  const unique = [...new Set(value.map((item) => typeof item === "string" && aliases[item] ? aliases[item] : item))];
  return unique.every((item) => item === "preschool.overall-key-findings" || item === "preschool.benchmark"
    || item === "preschool.standby" || item === "preschool.operating-hours"
    || item === "preschool.forecast" || item === "cross-section") ? unique as PlacementTarget[] : null;
}

function epistemic(value: unknown): EpistemicLevel | null {
  return value === "verified" || value === "hypothesis" || value === "exploration-idea" ? value : null;
}

function relation(value: unknown): Relationship | null {
  return value === "supports" || value === "challenges" || value === "independent" ? value : null;
}

function positiveIntegers(value: unknown): number[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && (item as number) > 0)
    ? [...new Set(value as number[])] : null;
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  const result = value.map((item) => cleanText(item));
  return result.every(Boolean) ? [...new Set(result as string[])] : [];
}

function cleanId(value: unknown): string | null {
  const id = cleanText(value);
  return id && id.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) ? id : null;
}

function cleanText(value: unknown, maxChars = 1_200): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  return text && text.length <= maxChars ? text : null;
}

function optionalBoundedText(value: unknown, maxChars: number): string | undefined | null {
  if (value === undefined) return undefined;
  return cleanText(value, maxChars);
}

function optionalText<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const text = cleanText(value);
  return text ? { [key]: text } as Record<Key, string> : {};
}

function sourceKey(ids: string[]): string {
  return ids.slice().sort().join("\u0000");
}

function workflowSessionId(identity: EnergyIqOverviewAiArtifactIdentity, userId: string, attempt: number): string {
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  return `energyiq-overview-ai-${identity.projectId}-${hash}-${userId}-${attempt}`;
}

function workflowErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const safe = message.toUpperCase().replace(/[^A-Z0-9_:-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 100);
  return safe || "OVERVIEW_AI_WORKFLOW_FAILED";
}

function parseUnknown(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

function parseRecord(value: string): Record<string, unknown> | null {
  const parsed = parseUnknown(value);
  return isRecord(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function textChunkValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

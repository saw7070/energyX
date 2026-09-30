import {
  createAgentContextItem,
  createAgentContextSourceMetadata,
  resolveContextEvidenceFacts,
  type AgentContextItem,
  type AnalysisContextEvidenceCatalog,
  type AnalysisRequirement,
  type EnergyAnalysisSemantics,
} from "@datafoundry/agent-runtime";
import type { TrustedEnergyTextQueryContract } from "@datafoundry/agent-runtime";

import type { EnergyQueryContext } from "./energy-query-context.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import type { EnergySessionForkProvenance } from "./session-energy-context.js";
import {
  createProjectAnalysisPackContextItem,
  type ProjectAnalysisPackReleaseBinding,
} from "./project-analysis-pack.js";
import { createProjectAnalysisContextEvidenceCatalog } from "./project-analysis-context-evidence.js";

const forkProvenanceContent = (
  provenance: EnergySessionForkProvenance | undefined,
): string[] => {
  if (!provenance) return [];
  if ("status" in provenance) {
    return [
      `forked_from_session_id=${provenance.sourceSessionId}`,
      "forked_from_context_status=unavailable",
      `forked_from_unavailable_reason=${provenance.reason}`,
    ];
  }
  return [
    `forked_from_session_id=${provenance.sourceSessionId}`,
    "forked_from_context_status=available",
    `forked_from_run_id=${provenance.sourceRunId}`,
    `forked_from_from=${provenance.sourceFrom}`,
    `forked_from_to=${provenance.sourceTo}`,
  ];
};

const forkProvenanceMetadata = (
  provenance: EnergySessionForkProvenance | undefined,
): Record<string, string> => {
  if (!provenance) return {};
  if ("status" in provenance) {
    return {
      forkedFromSessionId: provenance.sourceSessionId,
      forkedFromContextStatus: "unavailable",
      forkedFromUnavailableReason: provenance.reason,
    };
  }
  return {
    forkedFromSessionId: provenance.sourceSessionId,
    forkedFromContextStatus: "available",
    forkedFromRunId: provenance.sourceRunId,
    forkedFromFrom: provenance.sourceFrom,
    forkedFromTo: provenance.sourceTo,
  };
};

export const createEnergyQueryContextItem = (
  context: EnergyQueryContext,
  sessionId: string,
  analysisWorkspace?: EnergyAnalysisSemantics,
  projectReleaseId?: string,
  sessionFork?: EnergySessionForkProvenance,
): AgentContextItem => createAgentContextItem({
  id: `energy-query-context:${context.projectId}:${context.scopeId}:${context.dataSnapshotId}`,
  sourceType: "energy-query-context",
  sourceId: context.projectId,
  groupId: "energy-query-context",
  visibility: "model",
  trust: "tool",
  retention: "active",
  priority: 100,
  content: [
    "Authoritative EnergyIQ query context. Use this scope and time range for every data query.",
    "The end timestamp is exclusive. Never substitute client-provided project or scope names.",
    "The enabled DuckDB datasource is a server-filtered view for exactly this context; do not use another datasource.",
    "usage_kwh is canonical interval consumption. source_reading_kind states whether it came from a cumulative-energy delta or a supplied interval-usage value.",
    "The datasource exposes only published Meter attachments. Use official_aggregation_eligible for Scope totals; never infer or replace that route from scope_id or meter_role.",
    ...(analysisWorkspace
      ? [
          "Use queryable measures through scoped SQL. Use deterministic-evidence measures from the current ProjectAnalysisSnapshot and never recalculate them from Metadata.",
          "A missing Metadata relation, facility_type or dimension is Missing Evidence, not a business count of zero. Disclose metadata_status when using provisional values.",
          `analysis_semantics=${JSON.stringify(analysisWorkspace)}`,
        ]
      : []),
    "Use appliance for Aircon, Heater, Lighting and Plugload analysis; category is the simplified aircon, light or load business classification.",
    "The run-scoped fact table does not expose Calendar-derived operating or standby values. Use only deterministic Evidence pinned to business_calendar_version for those figures; do not infer them from local_hour, day_type or raw facts.",
    "Rows with quality_status other than 'ok' are evidence of data quality events and must not be counted as consumption.",
    ...ngeeAnnAnalysisPolicy(context),
    ...preschoolAnalysisPolicy(context),
    `workspace_id=${context.workspaceId}`,
    `project_id=${context.projectId}`,
    `project_name=${context.projectName}`,
    `scope_id=${context.scopeId}`,
    `scope_name=${context.scopeName}`,
    `scope_type=${context.scopeType}`,
    `resource=${context.resource}`,
    `timezone=${context.timezone}`,
    `from=${context.from}`,
    `to_exclusive=${context.to}`,
    `hierarchy_revision_id=${context.hierarchyRevisionId}`,
    `meter_mapping_revision_id=${context.meterMappingRevisionId}`,
    `meter_formula_revision_id=${context.meterFormulaRevisionId}`,
    ...(projectReleaseId ? [`project_release_id=${projectReleaseId}`] : []),
    ...forkProvenanceContent(sessionFork),
    `data_snapshot_id=${context.dataSnapshotId}`,
    `metric_version=${context.metricVersion}`,
    `business_calendar_version=${context.businessCalendarVersion}`,
    `tariff_schedule_version=${context.tariffScheduleVersion}`
  ].join("\n"),
  metadata: createAgentContextSourceMetadata({
    dedupeKeys: ["energy-query-context"],
    exclusivityKey: "energy-query-context",
    overlapKeys: [
      `project:${context.projectId}`,
      `scope:${context.scopeId}`,
      `snapshot:${context.dataSnapshotId}`
    ],
    scope: {
      datasourceId: context.dataSnapshotId,
      sessionId,
      userId: context.userId
    },
    sourceKind: "energy-query-context",
    sourceOwner: "server"
  }, {
    atomic: true,
    groupKind: "source",
    energyQueryContext: {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      projectName: context.projectName,
      scopeId: context.scopeId,
      scopeName: context.scopeName,
      scopeType: context.scopeType,
      resource: context.resource,
      timezone: context.timezone,
      from: context.from,
      to: context.to,
      hierarchyRevisionId: context.hierarchyRevisionId,
      meterMappingRevisionId: context.meterMappingRevisionId,
      meterFormulaRevisionId: context.meterFormulaRevisionId,
      ...(projectReleaseId ? { projectReleaseId } : {}),
      dataSnapshotId: context.dataSnapshotId,
      ...forkProvenanceMetadata(sessionFork),
    },
  })
});

export const createTrustedEnergyTextContextItem = (
  contract: TrustedEnergyTextQueryContract,
  sessionId: string,
  userId: string
): AgentContextItem => createAgentContextItem({
  id: `trusted-energy-text:${contract.id}`,
  sourceType: "project-analysis-snapshot",
  sourceId: contract.pins.project.id,
  groupId: "trusted-energy-text",
  visibility: "model",
  trust: "tool",
  retention: "active",
  priority: 100,
  content: [
    "Authoritative ProjectAnalysisSnapshot trusted-text contract.",
    "Use only the expected facts and Evidence below. Do not query another source or substitute Scope, Period, Metric, or values.",
    "The Period end is exclusive. Return structured claims for validation; never reveal provider configuration or credentials.",
    `contract_id=${contract.id}`,
    `intent=${contract.intent}`,
    `scope=${contract.pins.scope.name} (${contract.pins.scope.id})`,
    `period_start=${contract.pins.period.start}`,
    `period_end_exclusive=${contract.pins.period.endExclusive}`,
    `timezone=${contract.pins.period.timezone}`,
    `metric=${contract.pins.metric.id} (${contract.pins.metric.revisionId})`,
    `data_snapshot_id=${contract.pins.dataSnapshotId}`,
    `data_as_of=${contract.pins.dataAsOf}`,
    `expected_facts=${JSON.stringify(contract.pins.expectedFacts)}`,
    `evidence=${JSON.stringify(contract.pins.evidenceRefs)}`
  ].join("\n"),
  metadata: createAgentContextSourceMetadata({
    dedupeKeys: ["trusted-energy-text"],
    exclusivityKey: "trusted-energy-text",
    overlapKeys: [
      `project:${contract.pins.project.id}`,
      `scope:${contract.pins.scope.id}`,
      `snapshot:${contract.pins.dataSnapshotId}`
    ],
    scope: {
      datasourceId: contract.pins.sourcePin.datasourceId,
      sessionId,
      userId
    },
    sourceKind: "project-analysis-snapshot",
    sourceOwner: "server"
  }, { atomic: true, groupKind: "source" })
});

/**
 * Project the bounded, deterministic part of the current Overview Snapshot into
 * the full Analyst Context Package. Raw interval rows stay in DuckDB; this item
 * carries released calculations and their pins so the model does not
 * rediscover Benchmark or Calendar semantics from labels.
 */
export const createProjectAnalysisSnapshotContextItem = (input: {
  contextEvidenceCatalog?: AnalysisContextEvidenceCatalog;
  contextEvidenceSelection?: NonNullable<AnalysisRequirement["contextEvidence"]>;
  snapshot: ProjectAnalysisSnapshot;
  sessionId: string;
  userId: string;
}): AgentContextItem => {
  const snapshot = input.snapshot;
  const contextEvidenceCatalog = input.contextEvidenceCatalog
    ?? createProjectAnalysisContextEvidenceCatalog(snapshot);
  const selectedFacts = input.contextEvidenceSelection
    ? resolveContextEvidenceFacts(
        contextEvidenceCatalog,
        input.contextEvidenceSelection.factIds,
      )
    : contextEvidenceCatalog.facts;
  const promptContextEvidenceCatalog = {
    contract: contextEvidenceCatalog.contract,
    sourceId: contextEvidenceCatalog.sourceId,
    pins: contextEvidenceCatalog.pins,
    facts: selectedFacts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      metricId: fact.metricId,
      value: fact.value,
      ...(fact.unit ? { unit: fact.unit } : {}),
      status: fact.status,
      dimensions: fact.dimensions,
    })),
  };
  const bundle = {
    contract: "energyiq-deterministic-evidence@1",
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    resource: snapshot.context.resource,
    dataSnapshotId: snapshot.dataSnapshot.id,
    dataCutoff: snapshot.context.primaryPeriod.endExclusive,
    projectReleaseId: snapshot.context.projectReleaseId,
    hierarchyRevisionId: snapshot.context.hierarchyRevisionId,
    meterMappingRevisionId: snapshot.context.meterMappingRevisionId,
    metricVersion: snapshot.context.metricVersion,
    businessCalendarVersion: snapshot.context.businessCalendarVersion,
    reportTimeContext: snapshot.reportTimeContext,
    dataQuality: snapshot.dataQuality,
    evidence: snapshot.evidence,
    findings: snapshot.findings,
    decisionPriorities: snapshot.decisionPriorities,
    preschoolAppliances: compactPreschoolAppliances(snapshot.preschoolAppliances),
    preschoolOperational: compactPreschoolOperational(snapshot.preschoolOperational),
  };
  return createAgentContextItem({
    id: `project-analysis-snapshot:${snapshot.context.projectId}:${snapshot.dataSnapshot.id}`,
    sourceType: "project-analysis-snapshot",
    sourceId: snapshot.context.projectId,
    groupId: "project-analysis-snapshot",
    visibility: "model",
    trust: "tool",
    retention: "active",
    priority: 95,
    content: (input.contextEvidenceSelection
      ? [
          "Authoritative question-selected EnergyIQ Evidence from the immutable Analysis Context Package.",
          "Answer from these released facts when they are sufficient. For supporting Evidence, use the lazy scoped datasource only when the question still requires a value or driver absent from these facts.",
          "Do not recalculate a released scalar merely to restate it. Keep partial or provisional status visible and return Missing Evidence rather than inventing a value.",
          `context_evidence_selection=${JSON.stringify(input.contextEvidenceSelection)}`,
          `context_evidence_catalog=${JSON.stringify(promptContextEvidenceCatalog)}`,
        ]
      : [
          "Authoritative bounded EnergyIQ deterministic Evidence for the current Analysis Workspace.",
          "Deterministic Evidence is authoritative for released KPI, Benchmark, Calendar and official theme values. It may be explained or challenged with new tool Evidence, but it must not be silently recalculated or modified.",
          "Use the scoped DuckDB relations for new investigation. If a required value is absent from both this bundle and successful scoped tool Evidence, return Missing Evidence or Unavailable rather than zero.",
          "For released scalar claims, use fact ids from context_evidence_catalog with analysis_requirements_commit. New drivers and custom investigation still require scoped SQL Evidence.",
          "When a Context Evidence fact is partial or provisional, keep that status visible in the answer; do not present it as complete or confirmed.",
          `context_evidence_catalog=${JSON.stringify(promptContextEvidenceCatalog)}`,
          `deterministic_evidence_bundle=${JSON.stringify(bundle)}`,
        ]).join("\n"),
    metadata: createAgentContextSourceMetadata({
      dedupeKeys: ["project-analysis-snapshot"],
      exclusivityKey: "project-analysis-snapshot",
      overlapKeys: [
        `project:${snapshot.context.projectId}`,
        `scope:${snapshot.context.scopeId}`,
        `snapshot:${snapshot.dataSnapshot.id}`,
      ],
      scope: {
        datasourceId: snapshot.dataSnapshot.id,
        sessionId: input.sessionId,
        userId: input.userId,
      },
      sourceKind: "project-analysis-snapshot",
      sourceOwner: "server",
    }, {
      atomic: true,
      groupKind: "source",
    }),
  });
};

const compactPreschoolAppliances = (
  projection: ProjectAnalysisSnapshot["preschoolAppliances"],
): unknown => {
  if (!projection || projection.status === "unavailable") return projection;
  return {
    ...projection,
    appliances: projection.appliances.map(({ sourceCircuitIds, ...appliance }) => ({
      ...appliance,
      sourceCircuitCount: sourceCircuitIds.length,
    })),
  };
};

const compactOperationalApplianceComposition = <T extends {
  appliances: Array<{ sourceCircuitIds: string[] }>;
}>(composition: T) => ({
  ...composition,
  appliances: composition.appliances.map(({ sourceCircuitIds, ...appliance }) => ({
    ...appliance,
    sourceCircuitCount: sourceCircuitIds.length,
  })),
});

const compactPreschoolOperational = (
  projection: ProjectAnalysisSnapshot["preschoolOperational"],
): unknown => {
  if (!projection || projection.status === "unavailable") return projection;
  const { analysisReady, ...boundedProjection } = projection;
  return {
    ...boundedProjection,
    standbyAppliances: compactOperationalApplianceComposition(projection.standbyAppliances),
    operatingAppliances: compactOperationalApplianceComposition(projection.operatingAppliances),
    ...(analysisReady ? {
      analysisReady: {
        contract: analysisReady.contract,
        eventCatalog: {
          status: analysisReady.eventCatalog.status,
          boundedCellCount: analysisReady.eventCatalog.boundedCellCount,
          totalEventCount: analysisReady.eventCatalog.totalEventCount,
          capturedEventCount: analysisReady.eventCatalog.capturedEventCount,
          truncated: analysisReady.eventCatalog.truncated,
        },
        recurrence: {
          status: analysisReady.recurrence.status,
          rowCount: analysisReady.recurrence.rows.length,
        },
        contextAvailability: analysisReady.contextAvailability,
      },
    } : {}),
    sop: {
      ...projection.sop,
      scoredCentreCount: projection.sop.centres.length,
      centres: projection.sop.centres.filter((centre) => centre.standbySpikeCount > 0),
    },
  };
};

export const createEnergyAuthoritativeContextItems = (input: {
  analysisWorkspace?: EnergyAnalysisSemantics;
  contextEvidenceCatalog?: AnalysisContextEvidenceCatalog;
  contextEvidenceSelection?: NonNullable<AnalysisRequirement["contextEvidence"]>;
  context?: EnergyQueryContext;
  projectAnalysisSnapshot?: ProjectAnalysisSnapshot;
  projectRelease?: ProjectAnalysisPackReleaseBinding | null;
  sessionId: string;
  sessionFork?: EnergySessionForkProvenance;
  trustedTextContract?: TrustedEnergyTextQueryContract;
  userId: string;
}): AgentContextItem[] => {
  if (input.trustedTextContract) {
    return [createTrustedEnergyTextContextItem(
      input.trustedTextContract,
      input.sessionId,
      input.userId,
    )];
  }
  if (!input.context) return [];

  const packItem = input.projectRelease
    ? createProjectAnalysisPackContextItem({
        context: input.context,
        release: input.projectRelease,
        sessionId: input.sessionId,
      })
    : null;
  return [
    createEnergyQueryContextItem(
      input.context,
      input.sessionId,
      input.analysisWorkspace,
      input.projectRelease?.id,
      input.sessionFork,
    ),
    ...(input.projectAnalysisSnapshot
      ? [createProjectAnalysisSnapshotContextItem({
          ...(input.contextEvidenceCatalog ? { contextEvidenceCatalog: input.contextEvidenceCatalog } : {}),
          ...(input.contextEvidenceSelection ? { contextEvidenceSelection: input.contextEvidenceSelection } : {}),
          snapshot: input.projectAnalysisSnapshot,
          sessionId: input.sessionId,
          userId: input.userId,
        })]
      : []),
    ...(packItem ? [packItem] : []),
  ];
};

const efficientInvestigationPolicy = [
  "Before the first SQL call, form the minimum sufficient Evidence plan for the user's decision question.",
  "Batch independent aggregates from the same governed relation and grain into one focused query when that preserves clear Evidence lineage.",
  "Each additional query must resolve a named uncertainty that could change the conclusion, recommendation or verification step; do not re-query a released value merely to make the answer feel more complete.",
  "Stop querying once the question is answered with sufficient current Evidence. A useful concise answer is better than extra tool rounds that do not change the decision.",
];

const ngeeAnnAnalysisPolicy = (context: EnergyQueryContext): string[] =>
  context.projectId === "ngee-ann-polytechnic"
    ? [
        "Ngee Ann analysis policy:",
        ...efficientInvestigationPolicy,
        "After the run's one schema inspection establishes its governed contract, use run_sql_readonly only against the run-scoped table when it adds Evidence; if Released Evidence already answers the question, use it directly. Cite the resulting Context Evidence, tool call or artifact for every reported number.",
        "The relation is already bound to the selected UI Scope. For a Project total, do not filter scope_id to the UI label 'project'; scope_id values are published hierarchy nodes. Sum quality_status='ok' rows on the Official Aggregation Route across those nodes.",
        "For Project or Level totals, filter quality_status='ok' and use only the published Official Aggregation Route. Meter role is descriptive evidence, not permission to alter the route.",
        "For Circuit or category contribution, query non-total breakdown rows separately and compare them with the corresponding designated total. If the breakdown does not reconcile with that total, disclose the mismatch instead of forcing shares to 100%.",
        "For peak interval-average power, group by local_interval_start, sum average_kw across the designated totals, and then take the maximum. Never use MAX(average_kw) across individual meter rows as the Project peak.",
        "Compare Workday, Weekend and Public Holiday only for day_type values actually present in the inspected result. An absent slice is unavailable, not zero.",
        "Previous-period change and own-history normal level require rows for those comparison windows. This scoped datasource contains only the authoritative from-to range; when required rows fall outside it, say the comparison is unavailable instead of extrapolating.",
        "Per-area and per-person results require authoritative metadata in the current context or tool evidence. If those dimensions are absent, say unavailable and do not infer them from names or typical values.",
        "Off-hours conclusions require deterministic Calendar-bound Evidence and adequate coverage. If that Evidence is absent, describe observed rows only and do not label usage as avoidable waste.",
        "Do not answer tariff cost, carbon, forecast or water questions unless authoritative values are explicitly present in the current evidence.",
        "Every answer must state Scope, inclusive-exclusive Period, timezone, unit, aggregation route, material limitations, and the SQL/tool evidence used.",
        "Use SQL-produced table evidence for exact figures. Controlled line, bar or pie charts may only reuse columns returned by a tool result; never create new chart values or arbitrary chart code.",
        "When evidence is insufficient, return the precise limitation and the next required data. Never generate mock figures, business anomalies or root causes. Do not modify deterministic official action priorities; evidence-backed next investigations or actions are allowed when clearly identified as AI proposals."
      ]
    : [];

const preschoolAnalysisPolicy = (context: EnergyQueryContext): string[] =>
  context.projectId === "preschool-demo"
    ? [
        "Preschool analysis policy:",
        ...efficientInvestigationPolicy,
        "After the run's one schema inspection establishes its governed contract, use run_sql_readonly only against the run-scoped table when it adds Evidence; if Released Evidence already answers the question, use it directly. Use aggregated queries and do not request raw Portfolio facts.",
        "For Centre totals, group official rows by parent_node_id. The scoped scope_id identifies the published navigation attachment and must not be treated as the Centre identity.",
        "For every energy aggregation, filter quality_status='ok' and official_aggregation_eligible=TRUE. Use Circuit and appliance rows only within the same published route and do not double-count them.",
        "Use the hierarchy-pinned Scope metadata relation for Centre counts, centre_code, facility_type, area_sqm, occupant_count and metadata_status. Do not infer those dimensions from fact labels.",
        "EUI and per-pax comparisons require the published Benchmark Evidence and its metadata status. The metadata relation supplies dimensions but does not replace the released Benchmark calculation.",
        "Standby, operating, Spike and SOP results are provisional Calendar-bound investigation signals. They do not prove waste, non-compliance, device state or root cause.",
        "Treat provisional Benchmark and Calendar signals as screening evidence, not proof that waste exists or is absent. When Centre-level evidence is incomplete, say that the available Evidence does not identify it as the primary driver; do not write categorical claims such as 'not an energy-waste problem'. Keep worthwhile hypotheses clearly labelled as possibilities and state what would verify them.",
        "When the exact Centre-level closed-hours total is absent, do not conclude that 'closed-hours energy does not materially contribute' or call it 'not a closed-hours energy problem'. Say instead that the available spike or event Evidence does not identify closed-hours as the primary driver, and that the exact contribution remains Missing Evidence.",
        "Forecast, tariff cost, savings, ROI, owner and commitment are unavailable unless separately supplied as authoritative Evidence. Do not infer them from energy data in the current Period.",
        "Use only the current Project, current Period, Snapshot and Published Release. Cite the exact deterministic Evidence item or successful scoped query result for every displayed number.",
      ]
    : [];

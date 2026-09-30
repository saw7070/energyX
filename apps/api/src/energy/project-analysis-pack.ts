import {
  createAgentContextItem,
  createAgentContextSourceMetadata,
  type AgentContextItem,
} from "@datafoundry/agent-runtime";

import type { EnergyQueryContext } from "./energy-query-context.js";

export type ProjectAnalysisPackReleaseBinding = {
  id: string;
  projectId: string;
  renderer: {
    key: string;
    version: string;
  };
};

type ProjectAnalysisPack = {
  id: string;
  revision: string;
  projectId: string;
  rendererKey: string;
  investigationPrior: readonly string[];
};

const NGEE_ANN_ANALYSIS_PACK: ProjectAnalysisPack = {
  id: "ngee-ann-analysis-pack",
  revision: "v1",
  projectId: "ngee-ann-polytechnic",
  rendererKey: "ngee-ann-overview",
  investigationPrior: [
    "Treat the official Overview themes as hypotheses to investigate, not as an answer template. For each finding, state whether the evidence supports, challenges, or is independent of an official theme.",
    "Connect the 1-day short-term movement, recurring 7-day behaviour, and 28-day structural horizon when the available evidence supports the relationship. Do not repeat the same observation as separate findings merely because it appears at different horizons.",
    "Start from the official Project or selected-Scope total, then investigate where the result is concentrated across Level, category, Circuit, local time, day type, operating state, and peak interval-average power when those dimensions are present.",
    "Use breakdown meters only to explain an official total. Never add a total meter to its component meters, and disclose incomplete reconciliation rather than forcing a contribution story.",
    "When the inspected schema exposes official_aggregation_eligible, calculate official totals only from eligible rows. Non-eligible breakdown rows may explain the official total but must never be added to it.",
    "Compare only the same authorized Scope and compatible periods. Daily averages require complete days; operating-state, tariff, and calendar conclusions are unavailable when their authoritative evidence is missing.",
    "Distinguish an observed pattern from an operational cause. Label causes as hypotheses until supported by operating schedule, equipment state, occupancy, weather, tariff, maintenance, or other relevant evidence.",
    "Prefer findings that change a decision: explain what happened, why it matters or may have happened, what to investigate or do next, and how the user can verify whether the action worked.",
    "Surface material missing evidence when it prevents a trustworthy conclusion. An unavailable dimension is a limitation and next investigation target, not a zero value.",
    "Do not change deterministic KPI values, Evidence, or official theme priority. You may propose evidence-backed next investigations or actions, but must identify them as AI proposals.",
  ],
};

const PRESCHOOL_ANALYSIS_PACK: ProjectAnalysisPack = {
  id: "preschool-analysis-pack",
  revision: "v1",
  projectId: "preschool-demo",
  rendererKey: "preschool-overview",
  investigationPrior: [
    "This is the Preschool project overlay, not the investigation method or an answer template. The Method Skill decides how deeply to investigate the current Snapshot.",
    "The published Portfolio total and quality use official aggregation. Centre, appliance and Circuit rows may explain that total but must not be double-counted with it.",
    "Use the published EUI and per-pax Evidence only for peer comparison. Preserve its provisional metadata status and distinguish a P75 screening signal from a confirmed operational problem.",
    "Use standby and off-hours Evidence only with the published Calendar. A closed-hour observation is an investigation target, not automatically waste, savings or non-compliance.",
    "Treat operating and standby Spikes as governed comparison signals, not root causes or confirmed SOP failures.",
    "Equipment state, occupancy, maintenance, weather and confirmed schedules are Missing Evidence unless the current authorized Evidence explicitly supplies them.",
    "Do not change deterministic KPI values, Benchmark classifications, Spike results or provisional SOP signals. Actions remain visibly AI proposals.",
  ],
};

export const createProjectAnalysisPackContextItem = (input: {
  context: EnergyQueryContext;
  release: ProjectAnalysisPackReleaseBinding;
  sessionId: string;
}): AgentContextItem | null => {
  if (input.release.projectId !== input.context.projectId) {
    throw new Error("ENERGYIQ_PROJECT_ANALYSIS_PACK_RELEASE_MISMATCH");
  }

  const pack = selectProjectAnalysisPack(input.context.projectId, input.release.renderer.key);
  if (!pack) return null;

  return createAgentContextItem({
    id: `project-analysis-pack:${pack.id}@${pack.revision}:${input.release.id}`,
    sourceType: "project-analysis-pack",
    sourceId: `${pack.id}@${pack.revision}`,
    groupId: `project-analysis-pack:${pack.id}@${pack.revision}`,
    visibility: "model",
    trust: "tool",
    retention: "active",
    priority: 99,
    content: [
      "Authoritative EnergyIQ project analysis prior selected by the server for the current Published Release.",
      "This Pack guides investigation only. Deterministic Recipe results, scoped tool evidence, and the current Data Snapshot remain authoritative for every number and official theme.",
      `analysis_pack_id=${pack.id}`,
      `analysis_pack_revision=${pack.revision}`,
      `project_id=${input.context.projectId}`,
      `project_release_id=${input.release.id}`,
      `renderer_key=${input.release.renderer.key}`,
      `renderer_version=${input.release.renderer.version}`,
      `data_snapshot_id=${input.context.dataSnapshotId}`,
      "Investigation prior:",
      ...pack.investigationPrior.map((instruction, index) => `${index + 1}. ${instruction}`),
    ].join("\n"),
    metadata: createAgentContextSourceMetadata({
      dedupeKeys: ["project-analysis-pack"],
      exclusivityKey: "project-analysis-pack",
      overlapKeys: [
        `project:${input.context.projectId}`,
        `release:${input.release.id}`,
        `renderer:${input.release.renderer.key}@${input.release.renderer.version}`,
        `snapshot:${input.context.dataSnapshotId}`,
        `analysis-pack:${pack.id}@${pack.revision}`,
      ],
      scope: {
        datasourceId: input.context.dataSnapshotId,
        sessionId: input.sessionId,
        userId: input.context.userId,
      },
      sourceKind: "project-analysis-pack",
      sourceOwner: "server",
    }, {
      analysisPackId: pack.id,
      analysisPackRevision: pack.revision,
      atomic: true,
      groupKind: "source",
      projectReleaseId: input.release.id,
      rendererKey: input.release.renderer.key,
      rendererVersion: input.release.renderer.version,
    }),
  });
};

const selectProjectAnalysisPack = (
  projectId: string,
  rendererKey: string,
): ProjectAnalysisPack | null => {
  if (projectId === NGEE_ANN_ANALYSIS_PACK.projectId
    && rendererKey === NGEE_ANN_ANALYSIS_PACK.rendererKey
  ) return NGEE_ANN_ANALYSIS_PACK;
  if (projectId === PRESCHOOL_ANALYSIS_PACK.projectId
    && rendererKey === PRESCHOOL_ANALYSIS_PACK.rendererKey
  ) return PRESCHOOL_ANALYSIS_PACK;
  return null;
};

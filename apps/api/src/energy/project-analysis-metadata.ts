import type {
  EnergyIqEnergyNormalisations,
  EnergyIqMetadataStatus,
  EnergyIqResolvedScopeMetadataValue,
  EnergyIqScopeMetadataEvidence,
  EnergyIqScopeMetadataResolution,
  MetadataStore,
} from "@datafoundry/metadata";

import type { EnergyScopeAnalysis } from "./energy-analysis.js";

export type ProjectAnalysisMetadataStatus = EnergyIqMetadataStatus | "missing";

export type ProjectAnalysisMetadataEvidence = EnergyIqScopeMetadataEvidence & {
  scopeId: string;
  scopeName: string;
};

export type ProjectAnalysisScopeMetadata = {
  scopeId: string;
  scopeName: string;
  usageKwh: number;
  status: ProjectAnalysisMetadataStatus;
  area: EnergyIqResolvedScopeMetadataValue;
  headcount: EnergyIqResolvedScopeMetadataValue;
  normalisations: EnergyIqEnergyNormalisations;
  evidence: ProjectAnalysisMetadataEvidence[];
};

export type ProjectAnalysisMetadataProjection = {
  status: ProjectAnalysisMetadataStatus;
  hierarchyRevisionId: string;
  timezone: string;
  period: {
    start: string;
    endExclusive: string;
  };
  selectedScope: ProjectAnalysisScopeMetadata;
  comparisonScopes: ProjectAnalysisScopeMetadata[];
  evidence: ProjectAnalysisMetadataEvidence[];
};

export type ProjectAnalysisPayload = Omit<EnergyScopeAnalysis, "childScopes"> & {
  metadata: ProjectAnalysisMetadataProjection;
  childScopes: Array<EnergyScopeAnalysis["childScopes"][number] & {
    metadata: ProjectAnalysisScopeMetadata;
  }>;
};

export const resolveProjectAnalysisMetadata = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  timezone: string;
  period: {
    start: string;
    endExclusive: string;
  };
  analysis: EnergyScopeAnalysis;
}): ProjectAnalysisMetadataProjection => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const selectedScope = resolveScopeMetadata({
    ...input,
    scopeId: input.analysis.context.scopeId,
    scopeName: input.analysis.context.scopeName,
    usageKwh: input.analysis.summary.usageKwh,
    isProjectRoot: input.analysis.context.scopeId === project.root_scope_id,
  });
  const comparisonScopes = input.analysis.childScopes.map((scope) => resolveScopeMetadata({
    ...input,
    scopeId: scope.nodeId,
    scopeName: scope.name,
    usageKwh: scope.usageKwh,
    isProjectRoot: false,
  }));
  const evidence = [selectedScope, ...comparisonScopes].flatMap((scope) => scope.evidence);
  return {
    status: combineStatuses([selectedScope, ...comparisonScopes].map((scope) => scope.status)),
    hierarchyRevisionId: input.hierarchyRevisionId,
    timezone: input.timezone,
    period: input.period,
    selectedScope,
    comparisonScopes,
    evidence,
  };
};

export const projectAnalysisPayload = (input: {
  analysis: EnergyScopeAnalysis;
  metadata: ProjectAnalysisMetadataProjection;
}): ProjectAnalysisPayload => {
  const metadataByScopeId = new Map(
    input.metadata.comparisonScopes.map((scope) => [scope.scopeId, scope]),
  );
  const summary = { ...input.analysis.summary };
  delete summary.areaSqm;
  delete summary.occupantCount;
  delete summary.kwhPerSqm;
  delete summary.kwhPerPerson;
  Object.assign(summary, effectiveMetadataFields(input.metadata.selectedScope));
  return {
    ...input.analysis,
    summary,
    childScopes: input.analysis.childScopes.map((scope) => {
      const metadata = metadataByScopeId.get(scope.nodeId);
      if (!metadata) {
        throw new Error(`ENERGYIQ_ANALYSIS_METADATA_PROJECTION_MISSING:${scope.nodeId}`);
      }
      const projected = { ...scope };
      delete projected.areaSqm;
      delete projected.occupantCount;
      delete projected.kwhPerSqm;
      delete projected.kwhPerPerson;
      return { ...projected, ...effectiveMetadataFields(metadata), metadata };
    }),
    metadata: input.metadata,
  };
};

const effectiveMetadataFields = (
  metadata: ProjectAnalysisScopeMetadata,
): Pick<EnergyScopeAnalysis["summary"], "areaSqm" | "occupantCount" | "kwhPerSqm" | "kwhPerPerson"> => ({
  ...(metadata.area.status !== "missing" ? { areaSqm: metadata.area.value } : {}),
  ...(metadata.headcount.status !== "missing" ? { occupantCount: metadata.headcount.value } : {}),
  ...(metadata.normalisations.eui.status !== "missing"
    ? { kwhPerSqm: metadata.normalisations.eui.value }
    : {}),
  ...(metadata.normalisations.perPax.status !== "missing"
    ? { kwhPerPerson: metadata.normalisations.perPax.value }
    : {}),
});

const resolveScopeMetadata = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  timezone: string;
  period: {
    start: string;
    endExclusive: string;
  };
  scopeId: string;
  scopeName: string;
  usageKwh: number;
  isProjectRoot: boolean;
}): ProjectAnalysisScopeMetadata => {
  const metadata = input.isProjectRoot
    ? missingProjectRootMetadata(input)
    : input.metadataStore.energyIq.scopeMetadata.resolveForPeriod({
      projectId: input.projectId,
      scopeId: input.scopeId,
      hierarchyRevisionId: input.hierarchyRevisionId,
      period: input.period,
      expectedTimezone: input.timezone,
    });
  const normalisations = input.metadataStore.energyIq.scopeMetadata.calculateEnergyNormalisations({
    energyKwh: input.usageKwh,
    metadata,
  });
  const evidence = [...metadata.area.evidence, ...metadata.headcount.evidence].map((item) => ({
    ...item,
    scopeId: input.scopeId,
    scopeName: input.scopeName,
  }));
  return {
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    usageKwh: input.usageKwh,
    status: metadata.status,
    area: metadata.area,
    headcount: metadata.headcount,
    normalisations,
    evidence,
  };
};

const missingProjectRootMetadata = (input: {
  projectId: string;
  scopeId: string;
  hierarchyRevisionId: string;
  timezone: string;
  period: {
    start: string;
    endExclusive: string;
  };
}): EnergyIqScopeMetadataResolution => ({
  projectId: input.projectId,
  scopeId: input.scopeId,
  hierarchyRevisionId: input.hierarchyRevisionId,
  period: input.period,
  timezone: input.timezone,
  status: "missing",
  area: missingProjectRootDimension({
    unit: "m2",
    guidance: "Select a child Scope with comparison area (m2), or add Area to the relevant comparison Scope in Admin > Projects > Structure and publish a new Project Release.",
  }),
  headcount: missingProjectRootDimension({
    unit: "people",
    guidance: "Select a child Scope with 24-hour representative headcount, or add Headcount to the relevant comparison Scope in Admin > Projects > Structure and publish a new Project Release.",
  }),
});

const missingProjectRootDimension = (input: {
  unit: "m2" | "people";
  guidance: string;
}): EnergyIqResolvedScopeMetadataValue => ({
  status: "missing",
  value: null,
  unit: input.unit,
  reason: "not-configured",
  guidance: input.guidance,
  metadataRevisionIds: [],
  hierarchyRevisionIds: [],
  evidence: [],
});

const combineStatuses = (
  statuses: ProjectAnalysisMetadataStatus[],
): ProjectAnalysisMetadataStatus => {
  if (statuses.some((status) => status === "missing")) return "missing";
  if (statuses.some((status) => status === "provisional")) return "provisional";
  return "confirmed";
};

import type { AnalysisScalar, AnalysisVerifiedValue } from "./analysis-contract.js";

export type AnalysisEvidencePins = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  dataCutoff: string;
  projectReleaseId: string;
  metricVersion: string;
};

export type AnalysisContextEvidenceFact = {
  id: string;
  label: string;
  metricId: string;
  value: AnalysisScalar;
  unit?: string;
  status: "confirmed" | "provisional" | "partial";
  evidenceRefs: string[];
  dimensions: Record<string, string>;
};

export type AnalysisContextEvidenceCatalog = {
  contract: "analysis-context-evidence@1";
  sourceId: string;
  pins: AnalysisEvidencePins;
  facts: AnalysisContextEvidenceFact[];
};

export const resolveContextEvidenceFacts = (
  catalog: AnalysisContextEvidenceCatalog,
  factIds: string[],
): AnalysisContextEvidenceFact[] => {
  const factsById = new Map(catalog.facts.map((fact) => [fact.id, fact]));
  return [...new Set(factIds)].map((factId) => {
    const fact = factsById.get(factId);
    if (!fact) throw new Error(`ANALYSIS_CONTEXT_EVIDENCE_FACT_NOT_FOUND:${factId}`);
    return fact;
  });
};

export const contextEvidenceVerifiedValues = (
  facts: AnalysisContextEvidenceFact[],
): AnalysisVerifiedValue[] => facts.map((fact) => ({
  name: fact.id,
  value: fact.value,
  ...(fact.unit ? { unit: fact.unit } : {}),
  tolerance: typeof fact.value === "number" ? 0.0001 : 0,
  assertionId: `CONTEXT:${fact.id}`,
}));

export const evidencePinsEqual = (
  left: AnalysisEvidencePins | undefined,
  right: AnalysisEvidencePins | undefined,
): boolean => Boolean(left && right)
  && left?.workspaceId === right?.workspaceId
  && left?.projectId === right?.projectId
  && left?.scopeId === right?.scopeId
  && left?.dataSnapshotId === right?.dataSnapshotId
  && left?.dataCutoff === right?.dataCutoff
  && left?.projectReleaseId === right?.projectReleaseId
  && left?.metricVersion === right?.metricVersion;

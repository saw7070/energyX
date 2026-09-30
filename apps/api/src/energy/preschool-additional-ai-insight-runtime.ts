import type {
  AnalysisContextEvidenceCatalog,
  AnalysisContextEvidenceFact,
} from "@datafoundry/agent-runtime";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  type AdditionalAiInsightToolAudit,
} from "@datafoundry/contracts";

export type PreschoolAdditionalAiInsightToolName =
  typeof ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1[number];

export type PreschoolAdditionalAiInsightRuntimeBinding = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};

export type PreschoolAdditionalAiInsightToolInvocation = {
  toolName: PreschoolAdditionalAiInsightToolName;
  toolCallId: string;
  input: unknown;
};

export type PreschoolAdditionalAiInsightToolResult = {
  auditId: string;
  evidenceRefs: string[];
  facts: AnalysisContextEvidenceFact[];
};

export type PreschoolAdditionalAiInsightRuntime = {
  toolNames: readonly PreschoolAdditionalAiInsightToolName[];
  invoke(input: PreschoolAdditionalAiInsightToolInvocation): Promise<PreschoolAdditionalAiInsightToolResult>;
  audits(): AdditionalAiInsightToolAudit[];
};

export const createPreschoolAdditionalAiInsightRuntime = (input: {
  binding: PreschoolAdditionalAiInsightRuntimeBinding;
  catalog: AnalysisContextEvidenceCatalog;
}): PreschoolAdditionalAiInsightRuntime => {
  requireCatalogIdentity(input.binding, input.catalog);
  const factsById = new Map<string, AnalysisContextEvidenceFact>();
  for (const fact of input.catalog.facts) {
    if (!nonEmptyString(fact.id) || factsById.has(fact.id)) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_EVIDENCE_CATALOG_INVALID");
    }
    factsById.set(fact.id, structuredClone(fact));
  }
  const audits: AdditionalAiInsightToolAudit[] = [];
  const usedToolCallIds = new Set<string>();

  return {
    toolNames: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
    async invoke(invocation) {
      if (!nonEmptyString(invocation.toolCallId)) {
        throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_CALL_ID_REQUIRED");
      }
      if (usedToolCallIds.has(invocation.toolCallId)) {
        throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_CALL_DUPLICATE");
      }
      usedToolCallIds.add(invocation.toolCallId);
      const auditId = `additional-tool-audit:${invocation.toolCallId}`;
      try {
        const factIds = controlledFactIds(invocation.toolName, invocation.input);
        if (invocation.toolName === "energy.snapshot-history.read"
          || invocation.toolName === "energy.project-knowledge.read") {
          throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_SOURCE_UNAVAILABLE");
        }
        const facts = factIds.map((factId) => {
          const fact = factsById.get(factId);
          if (!fact) throw new Error("PRESCHOOL_ADDITIONAL_AI_EVIDENCE_NOT_FOUND");
          return fact;
        });
        if (invocation.toolName === "energy.metrics.compare" && (
          facts.length < 2 || facts.some(({ value }) => typeof value !== "number")
        )) {
          throw new Error("PRESCHOOL_ADDITIONAL_AI_METRIC_COMPARISON_INVALID");
        }
        if (invocation.toolName === "energy.timeseries.analyze" && facts.some(({ metricId }) => (
          !/(?:time|hour|day|daily|standby|operating|spike)/iu.test(metricId)
        ))) {
          throw new Error("PRESCHOOL_ADDITIONAL_AI_TIME_EVIDENCE_INVALID");
        }
        audits.push({
          auditId,
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolName,
          status: "succeeded",
          evidenceRefs: [...factIds],
        });
        return {
          auditId,
          evidenceRefs: [...factIds],
          facts: structuredClone(facts),
        };
      } catch (error) {
        const errorCode = error instanceof Error ? error.message : "PRESCHOOL_ADDITIONAL_AI_TOOL_FAILED";
        audits.push({
          auditId,
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolName,
          status: "rejected",
          evidenceRefs: [],
          errorCode,
        });
        throw error;
      }
    },
    audits: () => structuredClone(audits),
  };
};

const controlledFactIds = (
  toolName: PreschoolAdditionalAiInsightToolName,
  value: unknown,
): string[] => {
  if (!isRecord(value)) throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_INPUT_INVALID");
  const expectedKey = toolName === "energy.project-knowledge.read" ? "knowledgeIds" : "factIds";
  if (!hasExactKeys(value, [expectedKey]) || !Array.isArray(value[expectedKey])) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_INPUT_INVALID");
  }
  const ids = value[expectedKey];
  if (ids.length === 0 || !uniqueStrings(ids)) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_INPUT_INVALID");
  }
  return [...ids];
};

const requireCatalogIdentity = (
  binding: PreschoolAdditionalAiInsightRuntimeBinding,
  catalog: AnalysisContextEvidenceCatalog,
): void => {
  if (catalog.contract !== "analysis-context-evidence@1"
    || catalog.pins.workspaceId !== binding.workspaceId
    || catalog.pins.projectId !== binding.projectId
    || catalog.pins.scopeId !== binding.scopeId
    || catalog.pins.dataSnapshotId !== binding.dataSnapshotId
    || catalog.pins.projectReleaseId !== binding.projectReleaseId
    || !nonEmptyString(catalog.pins.dataCutoff)
    || !nonEmptyString(catalog.pins.metricVersion)) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_EVIDENCE_IDENTITY_MISMATCH");
  }
};

const uniqueStrings = (values: readonly unknown[]): values is string[] =>
  values.every(nonEmptyString) && new Set(values).size === values.length;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && /\S/u.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

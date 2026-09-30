import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
} from "@datafoundry/metadata";
import {
  additionalAiInsightsArtifactIsValid,
  resolveAdditionalAiInsightMethodSet,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";

import {
  createPreschoolAdditionalAiInsightArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
  projectCurrentOverviewAiArtifactBaseIdentity,
  type OverviewAiArtifactIdentityV13,
  type PreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import { preschoolExecutiveSynthesisTargetId } from "./preschool-executive-synthesis.js";
import {
  PRESCHOOL_SECTION_IDS,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolExecutiveSynthesisResult,
  type PreschoolOverviewAiReadModel,
  type PreschoolOverviewAiUnitStatus,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResult,
} from "./preschool-overview-ai-contracts.js";

export const composePreschoolOverviewAiReadModel = (input: {
  metadataStore: MetadataStore;
  baseIdentity: OverviewAiArtifactIdentityV13;
}): PreschoolOverviewAiReadModel | null => {
  const baseIdentity = projectCurrentOverviewAiArtifactBaseIdentity(input.baseIdentity);
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
    baseIdentity.workspaceId,
    input.metadataStore.energyIq.insightMethodGovernance?.listPublishedWorkspaceMethodResources({
      workspaceId: baseIdentity.workspaceId,
    }) ?? [],
  );
  return composeReadModel({
    ...input,
    baseIdentity,
    createSectionIdentity: createPreschoolOverviewAiSectionArtifactIdentityV4,
    parseSectionResult,
    createExecutiveIdentity: createPreschoolOverviewAiExecutiveArtifactIdentityV4,
    parseExecutiveResult: parseExecutiveResultV4,
    createAdditionalIdentity: ({ baseIdentity }) => createPreschoolAdditionalAiInsightArtifactIdentity({
      baseIdentity,
      methodSet,
    }),
    parseAdditionalResult: (value, identity) => parseAdditionalResult(value, identity, methodSet),
    restoreLegacyAutonomous: false,
  });
};

export const composePreschoolOverviewAiReadModelV3 = (input: {
  metadataStore: MetadataStore;
  baseIdentity: OverviewAiArtifactIdentityV13;
}): PreschoolOverviewAiReadModel | null => composeReadModel({
  ...input,
  createSectionIdentity: createPreschoolOverviewAiSectionArtifactIdentityV3,
  parseSectionResult: parseSectionResultV3,
  createExecutiveIdentity: ({ baseIdentity, targetId }) => createPreschoolOverviewAiValueArtifactIdentity({
    baseIdentity,
    artifactKind: "executive-synthesis",
    targetId,
  }),
  parseExecutiveResult: parseExecutiveResultV3,
  restoreLegacyAutonomous: true,
});

const composeReadModel = (input: {
  metadataStore: MetadataStore;
  baseIdentity: OverviewAiArtifactIdentityV13;
  createSectionIdentity: typeof createPreschoolOverviewAiSectionArtifactIdentityV4;
  parseSectionResult: typeof parseSectionResult;
  createExecutiveIdentity: (input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    targetId: string;
  }) => EnergyIqOverviewAiArtifactIdentity;
  parseExecutiveResult: typeof parseExecutiveResultV4;
  createAdditionalIdentity?: (input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
  }) => PreschoolAdditionalAiInsightArtifactIdentity;
  parseAdditionalResult?: typeof parseAdditionalResult;
  restoreLegacyAutonomous: boolean;
}): PreschoolOverviewAiReadModel | null => {
  const store = input.metadataStore.energyIq.overviewAiArtifacts;
  const sectionArtifacts = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => {
    const identity = input.createSectionIdentity({
      baseIdentity: input.baseIdentity,
      targetId: sectionId,
    });
    return [sectionId, { identity, artifact: store.find(identity) ?? null }];
  })) as Record<PreschoolSectionId, {
    identity: EnergyIqOverviewAiArtifactIdentity;
    artifact: EnergyIqOverviewAiArtifactRecord | null;
  }>;
  const acceptedSectionArtifactIds = PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
    const { artifact, identity } = sectionArtifacts[sectionId];
    const result = artifact?.status === "available" && artifact.result_json
      ? input.parseSectionResult(artifact.result_json, identity)
      : null;
    return result?.status === "available" && artifact ? [artifact.id] : [];
  });
  const executiveIdentity = input.createExecutiveIdentity({
    baseIdentity: input.baseIdentity,
    targetId: preschoolExecutiveSynthesisTargetId(acceptedSectionArtifactIds),
  });
  const executiveArtifact = store.find(executiveIdentity) ?? null;
  const additionalIdentity = input.createAdditionalIdentity?.({ baseIdentity: input.baseIdentity }) ?? null;
  const additionalArtifact = additionalIdentity ? store.find(additionalIdentity) ?? null : null;
  const autonomousArtifact = input.restoreLegacyAutonomous ? store.find(input.baseIdentity) : null;
  const hasValueArtifacts = PRESCHOOL_SECTION_IDS.some((sectionId) => sectionArtifacts[sectionId].artifact !== null)
    || executiveArtifact !== null
    || additionalArtifact !== null
    || autonomousArtifact !== null;
  if (!hasValueArtifacts) return null;

  return {
    artifactKind: "preschool-overview-ai-read-model",
    status: "available",
    binding: preschoolOverviewAiBindingFromIdentity(input.baseIdentity),
    sections: Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => {
      const { identity, artifact } = sectionArtifacts[sectionId];
      return [sectionId, sectionUnit(artifact, identity, input.parseSectionResult)];
    })) as PreschoolOverviewAiReadModel["sections"],
    executive: executiveUnit(executiveArtifact, executiveIdentity, input.parseExecutiveResult),
    ...(additionalIdentity
      ? { additional: additionalUnit(
          additionalArtifact,
          additionalIdentity,
          input.parseAdditionalResult ?? parseAdditionalResult,
        ) }
      : {}),
    ...(autonomousArtifact?.status === "available" && autonomousArtifact.result_json
      ? { autonomous: parseJson(autonomousArtifact.result_json) }
      : {}),
  };
};

const additionalUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  parseResult: typeof parseAdditionalResult,
): PreschoolOverviewAiUnitStatus<AdditionalAiInsightsArtifact> => {
  if (!artifact) return { status: "unavailable", reason: "Additional AI Insights have not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), reason: artifact.error_code ?? "Additional AI Insights failed." };
  }
  const result = artifact.result_json ? parseResult(artifact.result_json, identity) : null;
  if (!result) return { status: "unavailable", artifactId: artifact.id, reason: "Additional AI Insights are invalid." };
  return result.status === "empty"
    ? { status: "empty", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), result }
    : { status: "available", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), result };
};

const parseAdditionalResult = (
  value: string,
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  providedMethodSet?: AdditionalAiInsightMethodSet,
): AdditionalAiInsightsArtifact | null => {
  const parsed = parseJson(value);
  const methodSet = providedMethodSet ?? resolveAdditionalAiInsightMethodSet({
    workspaceId: identity.workspaceId,
    methodSetId: identity.methodSetId,
    methodSetRevision: identity.methodSetRevision,
  });
  if (!methodSet) return null;
  const validation = {
    value: parsed,
    expectedMethods: methodSet.methods,
    expected: {
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriod: {
        from: identity.analysisPeriodFrom,
        to: identity.analysisPeriodTo,
      },
      modelProfileId: identity.modelProfileId,
      modelProfileRevision: identity.modelProfileRevision,
      methodSetId: identity.methodSetId,
      methodSetRevision: identity.methodSetRevision,
      methodSetFingerprint: identity.methodSetFingerprint,
      outputContractRevision: identity.outputContractRevision,
      capabilityRevision: identity.capabilityRevision,
      publicationRevision: identity.publicationRevision,
      canvasRevision: identity.canvasRevision,
    },
  };
  return additionalAiInsightsArtifactIsValid(validation) ? validation.value : null;
};

const sectionUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: EnergyIqOverviewAiArtifactIdentity,
  parseResult: typeof parseSectionResult,
): PreschoolOverviewAiUnitStatus<PreschoolSectionInterpretationResult> => {
  if (!artifact) return { status: "unavailable", reason: "Section interpretation has not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), reason: artifact.error_code ?? "Section interpretation failed." };
  }
  const result = artifact.result_json ? parseResult(artifact.result_json, identity) : null;
  if (!result) return { status: "unavailable", artifactId: artifact.id, reason: "Section interpretation is invalid." };
  return result.status === "empty"
    ? { status: "empty", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), result }
    : { status: "available", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), result };
};

const executiveUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: EnergyIqOverviewAiArtifactIdentity,
  parseResult: typeof parseExecutiveResultV4,
): PreschoolOverviewAiUnitStatus<PreschoolExecutiveSynthesisResult> => {
  if (!artifact) return { status: "unavailable", reason: "Executive synthesis has not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), reason: artifact.error_code ?? "Executive synthesis failed." };
  }
  const result = artifact.result_json ? parseResult(artifact.result_json, identity) : null;
  if (!result) return { status: "unavailable", artifactId: artifact.id, reason: "Executive synthesis is invalid." };
  return result.status === "empty"
    ? { status: "empty", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), result }
    : { status: "available", artifactId: artifact.id, ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}), result };
};

const parseSectionResult = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-section-interpretation"
    || parsed.contract.revision !== identity.outputContractRevision
    || parsed.packRevision !== identity.analysisPackRevision
    || !isRecord(parsed.capability)
    || parsed.capability.revision !== identity.capabilityRevision
    || parsed.capability.mode !== "scoped-read-only"
    || !Array.isArray(parsed.capability.tools)
    || !sameSectionTools(parsed.sectionId, parsed.capability.tools)
    || !Array.isArray(parsed.toolAudits)
    || !validSectionToolAudits(parsed.toolAudits, parsed.runId, parsed.capability.tools)
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(parsed.insights)
    || !isRecord(parsed.publication)
    || parsed.publication.policyId !== "preschool-section-publication"
    || parsed.publication.policyRevision !== identity.publicationRevision) return null;
  if (parsed.status === "empty") {
    if (parsed.summary !== undefined
      || parsed.insights.length !== 0
      || parsed.limitation !== undefined) return null;
  } else if (!isRecord(parsed.summary)
    || typeof parsed.summary.text !== "string"
    || !parsed.summary.text.trim()
    || !Array.isArray(parsed.summary.evidenceRefs)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResult;
};

const SECTION_INSIGHT_TOOLS = {
  "centre-benchmark": ["compare_centres", "inspect_related_section_signals"],
  "standby-wastage": ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"],
  "operating-behaviour": ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"],
  "planning-outlook": ["inspect_related_section_signals"],
} as const;

const sameSectionTools = (sectionId: unknown, tools: unknown[]): boolean => {
  if (typeof sectionId !== "string" || !(sectionId in SECTION_INSIGHT_TOOLS)) return false;
  const expected = SECTION_INSIGHT_TOOLS[sectionId as keyof typeof SECTION_INSIGHT_TOOLS];
  return tools.length === expected.length && tools.every((tool, index) => tool === expected[index]);
};

const validSectionToolAudits = (audits: unknown[], runId: unknown, tools: unknown[]): boolean => {
  if (!audits.every((audit) => isRecord(audit)
    && nonEmptyString(audit.auditId)
    && audit.runId === runId
    && nonEmptyString(audit.toolCallId)
    && tools.includes(audit.toolName)
    && audit.sourcePackRevision === "preschool-section-pack-v2"
    && uniqueNonEmptyStrings(audit.evidenceRefs))) return false;
  const records = audits as Array<Record<string, unknown>>;
  return new Set(records.map(({ auditId }) => auditId)).size === records.length
    && new Set(records.map(({ toolCallId }) => toolCallId)).size === records.length;
};

const parseSectionResultV3 = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-section-interpretation"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(parsed.keyPoints)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResult;
};

const sameValueArtifactBinding = (
  value: unknown,
  identity: EnergyIqOverviewAiArtifactIdentity,
): boolean => isRecord(value)
  && value.workspaceId === identity.workspaceId
  && value.projectId === identity.projectId
  && value.scopeId === identity.scopeId
  && value.dataSnapshotId === identity.dataSnapshotId
  && value.projectReleaseId === identity.projectReleaseId
  && value.modelProfileId === identity.modelProfileId
  && value.modelProfileRevision === identity.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && value.analysisPeriod.from === identity.analysisPeriodFrom
  && value.analysisPeriod.to === identity.analysisPeriodTo;

const parseExecutiveResultV3 = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolExecutiveSynthesisResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "executive-synthesis"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !isRecord(parsed.binding)
    || parsed.binding.dataSnapshotId !== identity.dataSnapshotId
    || parsed.binding.projectReleaseId !== identity.projectReleaseId
    || !Array.isArray(parsed.sourceSectionArtifactIds)
    || preschoolExecutiveSynthesisTargetId(parsed.sourceSectionArtifactIds.filter((id): id is string => typeof id === "string")) !== identity.targetId
    || !Array.isArray(parsed.keyFindings)) return null;
  return parsed as unknown as PreschoolExecutiveSynthesisResult;
};

const parseExecutiveResultV4 = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolExecutiveSynthesisResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "executive-synthesis"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !isRecord(parsed.contract)
    || parsed.contract.revision !== "preschool-executive-synthesis-v4"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(parsed.sourceSectionArtifactIds)
    || !parsed.sourceSectionArtifactIds.every((id) => typeof id === "string" && Boolean(id.trim()))
    || !Array.isArray(parsed.findings)) return null;
  if (parsed.status === "empty") {
    if (parsed.sourceSectionArtifactIds.length !== 0
      || parsed.summary !== undefined
      || parsed.overviewEvidence !== undefined
      || parsed.findings.length !== 0) return null;
  } else if (parsed.sourceSectionArtifactIds.length === 0
    || !isRecord(parsed.summary)
    || typeof parsed.summary.text !== "string"
    || !parsed.summary.text.trim()
    || !Array.isArray(parsed.summary.evidenceRefs)
    || (parsed.overviewEvidence !== undefined
      && !validOverviewEvidenceLineageV4(parsed.overviewEvidence, identity))) return null;
  return parsed as unknown as PreschoolExecutiveSynthesisResult;
};

const validOverviewEvidenceLineageV4 = (
  value: unknown,
  identity: EnergyIqOverviewAiArtifactIdentity,
): boolean => {
  const factIds = isRecord(value) ? value.factIds : undefined;
  const facts = isRecord(value) ? value.facts : undefined;
  if (!isRecord(value) || !isRecord(value.pins)
    || value.contract !== "analysis-context-evidence@1"
    || typeof value.sourceId !== "string" || !value.sourceId.trim()
    || value.pins.workspaceId !== identity.workspaceId
    || value.pins.projectId !== identity.projectId
    || value.pins.scopeId !== identity.scopeId
    || value.pins.dataSnapshotId !== identity.dataSnapshotId
    || value.pins.projectReleaseId !== identity.projectReleaseId
    || typeof value.pins.dataCutoff !== "string" || !value.pins.dataCutoff.trim()
    || typeof value.pins.metricVersion !== "string" || !value.pins.metricVersion.trim()
    || !uniqueNonEmptyStrings(factIds)
    || !Array.isArray(facts)
    || facts.length !== factIds.length) return false;
  return facts.every((fact, index) => isRecord(fact)
    && fact.id === factIds[index]
    && typeof fact.label === "string" && Boolean(fact.label.trim())
    && typeof fact.metricId === "string" && Boolean(fact.metricId.trim())
    && (typeof fact.value === "string"
      || typeof fact.value === "number"
      || typeof fact.value === "boolean"
      || fact.value === null)
    && (fact.unit === undefined || (typeof fact.unit === "string" && Boolean(fact.unit.trim())))
    && (fact.status === "confirmed" || fact.status === "provisional" || fact.status === "partial")
    && uniqueNonEmptyStrings(fact.evidenceRefs)
    && isRecord(fact.dimensions)
    && Object.values(fact.dimensions).every((dimension) => typeof dimension === "string"));
};

const uniqueNonEmptyStrings = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => typeof item === "string" && Boolean(item.trim()))
  && new Set(value).size === value.length;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

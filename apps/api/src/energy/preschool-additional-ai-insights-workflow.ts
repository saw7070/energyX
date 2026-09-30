import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  acceptInsightCanvasPlan,
  additionalAiInsightsArtifactIsValid,
  energyAiNarrativeClaimsSupported,
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  resolveAdditionalAiInsightMethodSet,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightMethodResource,
  type AdditionalAiInsightFinding,
  type AdditionalAiInsightFindingV1V2,
  type AdditionalAiInsightFindingV3,
  type AdditionalAiInsightsArtifact,
  type InsightCanvasEvidenceFact,
  type InsightCanvasRejection,
} from "@datafoundry/contracts";
import type {
  EnergyIqAdditionalInsightModelProfileSnapshot,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  createPreschoolAdditionalAiInsightArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
  type ProjectAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import {
  createPreschoolAdditionalAiInsightRuntime,
  type PreschoolAdditionalAiInsightToolInvocation,
  type PreschoolAdditionalAiInsightToolName,
  type PreschoolAdditionalAiInsightToolResult,
} from "./preschool-additional-ai-insight-runtime.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";
import { PRESCHOOL_ADDITIONAL_INSIGHT_TITLE_MAX_CHARS } from "./preschool-overview-ai-structured-output.js";

const LEASE_MS = 13 * 60 * 1_000;
const MAX_DISCOVERY_ANSWER_CHARS = 160_000;
const MAX_CANDIDATE_TEXT_CHARS = 1_200;
const MAX_NOVEL_CONTRIBUTION_CHARS = 800;
export const MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS = 192_000;

export type PreschoolAdditionalAiInsightsDiscoveryRunner = (input: {
  prompt: string;
  runId: string;
  sessionId: string;
  user: UserRecord;
  workspaceId: string;
  identity: ProjectAdditionalAiInsightArtifactIdentity;
  toolNames: readonly PreschoolAdditionalAiInsightToolName[];
  invokeTool(input: PreschoolAdditionalAiInsightToolInvocation): Promise<PreschoolAdditionalAiInsightToolResult>;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolAdditionalAiPresentedClaim = {
  id: string;
  source: "deterministic-overview" | "key-finding" | "section-summary" | "section-insight";
  sectionId?: string;
  artifactId?: string;
  text: string;
  sourceEvidenceRefs: string[];
};

export type PreschoolAdditionalAiPresentedClaims = {
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileId: string;
    modelProfileRevision: number;
  };
  claims: PreschoolAdditionalAiPresentedClaim[];
};

export const createPreschoolAdditionalAiPresentedClaims = (input: {
  identity: ProjectAdditionalAiInsightArtifactIdentity;
  catalog: AnalysisContextEvidenceCatalog;
  readModel: unknown;
}): PreschoolAdditionalAiPresentedClaims => {
  const binding = {
    workspaceId: input.identity.workspaceId,
    projectId: input.identity.projectId,
    scopeId: input.identity.scopeId,
    dataSnapshotId: input.identity.dataSnapshotId,
    projectReleaseId: input.identity.projectReleaseId,
    analysisPeriod: { from: input.identity.analysisPeriodFrom, to: input.identity.analysisPeriodTo },
    modelProfileId: input.identity.modelProfileId,
    modelProfileRevision: input.identity.modelProfileRevision,
  };
  const claims: PreschoolAdditionalAiPresentedClaim[] = input.catalog.facts.map((fact) => ({
    id: `deterministic-overview:${fact.id}`,
    source: "deterministic-overview",
    text: `${fact.label}: ${String(fact.value)}${fact.unit ? ` ${fact.unit}` : ""}`,
    sourceEvidenceRefs: [fact.id],
  }));
  if (input.readModel === null || input.readModel === undefined) return { binding, claims };
  if (!isRecord(input.readModel)
    || !readModelBindingMatches(input.readModel.binding, binding)
    || !isRecord(input.readModel.sections)) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_PRESENTED_READ_MODEL_INVALID");
  }
  for (const [sectionId, unit] of Object.entries(input.readModel.sections)) {
    if (!isAvailablePresentedSectionUnit(unit, sectionId, binding)) continue;
    pushPresentedClaim(claims, {
      id: `section:${sectionId}:summary`,
      source: "section-summary",
      sectionId,
      artifactId: unit.artifactId,
      value: unit.result.summary,
    });
    for (const insight of unit.result.insights) {
      if (!isRecord(insight) || !nonEmptyString(insight.id)) continue;
      pushPresentedClaim(claims, {
        id: `section:${sectionId}:insight:${insight.id}`,
        source: "section-insight",
        sectionId,
        artifactId: unit.artifactId,
        value: insight,
      });
    }
  }
  const executive = input.readModel.executive ?? input.readModel.keyFindings;
  if (isAvailablePresentedExecutiveUnit(executive, binding)) {
    pushPresentedClaim(claims, {
      id: "key-findings:summary",
      source: "key-finding",
      artifactId: executive.artifactId,
      value: executive.result.summary,
    });
    for (const finding of executive.result.findings) {
      if (!isRecord(finding) || !nonEmptyString(finding.id)) continue;
      pushPresentedClaim(claims, {
        id: `key-finding:${finding.id}`,
        source: "key-finding",
        artifactId: executive.artifactId,
        value: finding,
      });
    }
  }
  return { binding, claims };
};

const pushPresentedClaim = (
  target: PreschoolAdditionalAiPresentedClaim[],
  input: {
    id: string;
    source: PreschoolAdditionalAiPresentedClaim["source"];
    sectionId?: string;
    artifactId: string;
    value: unknown;
  },
): void => {
  if (!isPresentedClaimValue(input.value)) return;
  target.push({
    id: input.id,
    source: input.source,
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
    artifactId: input.artifactId,
    text: [nonEmptyString(input.value.title) ? input.value.title.trim() : "", input.value.text.trim()]
      .filter(Boolean).join(": "),
    sourceEvidenceRefs: [...input.value.evidenceRefs],
  });
};

const isAvailablePresentedSectionUnit = (
  value: unknown,
  sectionId: string,
  binding: PreschoolAdditionalAiPresentedClaims["binding"],
): value is {
  status: "available";
  artifactId: string;
  result: { summary: unknown; insights: unknown[] };
} => isRecord(value)
  && value.status === "available"
  && nonEmptyString(value.artifactId)
  && isRecord(value.result)
  && value.result.artifactKind === "section-interpretation"
  && value.result.status === "available"
  && value.result.sectionId === sectionId
  && readModelBindingMatches(value.result.binding, binding)
  && isPresentedClaimValue(value.result.summary)
  && Array.isArray(value.result.insights);

const isAvailablePresentedExecutiveUnit = (
  value: unknown,
  binding: PreschoolAdditionalAiPresentedClaims["binding"],
): value is {
  status: "available";
  artifactId: string;
  result: { summary: unknown; findings: unknown[] };
} => isRecord(value)
  && value.status === "available"
  && nonEmptyString(value.artifactId)
  && isRecord(value.result)
  && value.result.artifactKind === "executive-synthesis"
  && value.result.status === "available"
  && readModelBindingMatches(value.result.binding, binding)
  && isPresentedClaimValue(value.result.summary)
  && Array.isArray(value.result.findings);

const isPresentedClaimValue = (value: unknown): value is Record<string, unknown> & {
  text: string;
  evidenceRefs: string[];
} => isRecord(value)
  && nonEmptyString(value.text)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && uniqueStrings(value.evidenceRefs);

const readModelBindingMatches = (
  value: unknown,
  expected: PreschoolAdditionalAiPresentedClaims["binding"],
): boolean => isRecord(value)
  && value.workspaceId === expected.workspaceId
  && value.projectId === expected.projectId
  && value.scopeId === expected.scopeId
  && value.dataSnapshotId === expected.dataSnapshotId
  && value.projectReleaseId === expected.projectReleaseId
  && value.modelProfileId === expected.modelProfileId
  && value.modelProfileRevision === expected.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && value.analysisPeriod.from === expected.analysisPeriod.from
  && value.analysisPeriod.to === expected.analysisPeriod.to;

export type PreschoolAdditionalAiInsightsWorkflow = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
  evaluateAttempt(input: {
    identity: ProjectAdditionalAiInsightArtifactIdentity;
    user: UserRecord;
    runId: string;
    sessionId: string;
    methodResources?: readonly AdditionalAiInsightMethodResource[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<AdditionalAiInsightsArtifact>;
};

export const createPreschoolAdditionalAiInsightsWorkflow = (input: {
  metadataStore: MetadataStore;
  createArtifactIdentity?: (input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    methodSet: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>;
  }) => ProjectAdditionalAiInsightArtifactIdentity;
  resolveEvidenceCatalog(args: {
    identity: ProjectAdditionalAiInsightArtifactIdentity;
    user: UserRecord;
  }): Promise<AnalysisContextEvidenceCatalog>;
  resolvePresentedClaims(args: {
    identity: ProjectAdditionalAiInsightArtifactIdentity;
    catalog: AnalysisContextEvidenceCatalog;
    user: UserRecord;
  }): Promise<PreschoolAdditionalAiPresentedClaims>;
  runDiscovery: PreschoolAdditionalAiInsightsDiscoveryRunner;
  discoveryContext?: {
    productLabel: string;
    entityGuidance: string;
    runPrefix: string;
  };
  findingWindowIds?: readonly string[];
}): PreschoolAdditionalAiInsightsWorkflow => {
  const createArtifactIdentity = input.createArtifactIdentity
    ?? createPreschoolAdditionalAiInsightArtifactIdentity;
  const evaluateAttempt: PreschoolAdditionalAiInsightsWorkflow["evaluateAttempt"] = async ({
    identity,
    user,
    runId,
    sessionId,
    methodResources,
    modelProfileSnapshot,
  }) => {
    const methodSet = requireMethodResources(methodResources
      ? resolveAdditionalAiInsightMethodSet({
        workspaceId: identity.workspaceId,
        methodSetId: identity.methodSetId,
        methodSetRevision: identity.methodSetRevision,
        workspaceMethodResources: methodResources.filter(({ method }) => method.scope === "workspace"),
      }) ?? (() => { throw new Error("PRESCHOOL_ADDITIONAL_AI_METHOD_RESOURCE_INVALID"); })()
      : resolveCurrentAdditionalAiInsightMethodSet(
        identity.workspaceId,
        input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
          workspaceId: identity.workspaceId,
        }),
      ));
    if (methodResources && JSON.stringify(methodSet.resources) !== JSON.stringify(methodResources)) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_METHOD_RESOURCE_INVALID");
    }
    if (identity.methodSetId !== methodSet.id
      || identity.methodSetRevision !== methodSet.revision
      || identity.methodSetFingerprint !== createArtifactIdentity({
        baseIdentity: identity,
        methodSet,
      }).methodSetFingerprint) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_EVALUATION_IDENTITY_MISMATCH");
    }
    requireModelRuntimeIdentity(input.metadataStore, identity, modelProfileSnapshot);
    const catalog = await input.resolveEvidenceCatalog({ identity, user });
    const presentedClaims = requirePresentedClaims(
      await input.resolvePresentedClaims({ identity, catalog, user }),
      identity,
    );
    const runtime = createPreschoolAdditionalAiInsightRuntime({
      binding: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
      },
      catalog,
    });
    const completed = await input.runDiscovery({
      prompt: buildDiscoveryPrompt({
        identity,
        catalog,
        presentedClaims,
        methodResources: methodSet.resources,
        productLabel: input.discoveryContext?.productLabel ?? "EnergyX Preschool",
        entityGuidance: input.discoveryContext?.entityGuidance ?? "named Centres",
      }),
      runId,
      sessionId,
      user,
      workspaceId: identity.workspaceId,
      identity,
      toolNames: runtime.toolNames,
      invokeTool: runtime.invoke,
      ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
    });
    if (completed.runId !== runId || completed.sessionId !== sessionId) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_RUNTIME_IDENTITY_MISMATCH");
    }
    const candidates = parseDiscoveryCandidates(completed.answer, identity);
    if (!candidates) throw new Error("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
    const artifact = publishAdditionalArtifact({
      identity,
      methodSet,
      catalog,
      presentedClaims,
      candidates,
      toolAudits: runtime.audits(),
      runId,
      ...(input.findingWindowIds ? { findingWindowIds: input.findingWindowIds } : {}),
    });
    if (!additionalAiInsightsArtifactIsValid({
      value: artifact,
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
    })) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_PUBLICATION_INVALID");
    }
    requireModelRuntimeIdentity(input.metadataStore, identity, modelProfileSnapshot);
    return artifact;
  };

  return {
    evaluateAttempt,
    async execute({ baseIdentity, user, modelProfileSnapshot }) {
    const methodSet = requireMethodResources(resolveCurrentAdditionalAiInsightMethodSet(
      baseIdentity.workspaceId,
      input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
        workspaceId: baseIdentity.workspaceId,
      }),
    ));
    const identity = createArtifactIdentity({ baseIdentity, methodSet });
    requireModelRuntimeIdentity(input.metadataStore, identity, modelProfileSnapshot);
    const queued = input.metadataStore.energyIq.overviewAiArtifacts.queue({
      identity,
      triggeredBy: user.id,
    });
    if (queued.status === "available" || queued.status === "running") return queued;
    const runPrefix = input.discoveryContext?.runPrefix ?? "preschool-additional-ai-insights";
    const workerId = `${runPrefix}:${randomUUID()}`;
    const claim = input.metadataStore.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;

    const runId = `${runPrefix}-${randomUUID()}`;
    const sessionId = `${runPrefix}-${randomUUID()}`;
    try {
      const artifact = await evaluateAttempt({
        identity,
        user,
        runId,
        sessionId,
        ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
      });
      return input.metadataStore.energyIq.overviewAiArtifacts.complete({
        identity,
        workerId,
        sessionId,
        runId,
        resultJson: JSON.stringify(artifact),
      });
    } catch (error) {
      return input.metadataStore.energyIq.overviewAiArtifacts.fail({
        identity,
        workerId,
        errorCode: boundedErrorCode(error),
      });
    }
    },
  };
};

const requireModelRuntimeIdentity = (
  metadataStore: MetadataStore,
  identity: ProjectAdditionalAiInsightArtifactIdentity,
  trustedSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot,
): void => {
  if (trustedSnapshot) {
    const profile = trustedSnapshot.profiles[0];
    if (trustedSnapshot.bindingRevision !== identity.modelProfileRevision
      || identity.modelProfileId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
      || trustedSnapshot.profiles.length !== 1
      || profile?.exposedId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
      || profile.resource.kind !== "model-profile"
      || profile.resource.status !== "connected"
      || !profile.resource.default_enabled) {
      throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
    }
    return;
  }
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
};

type DiscoveryCandidate = {
  sourceId: string;
  value: unknown;
};

type AcceptedCandidate = {
  sourceId: string;
  finding: AdditionalAiInsightFindingV3;
};

const MAX_DISCOVERY_ENVELOPE_PUNCTUATION_REPAIRS = 4;

const repairMissingPropertyOpeningQuotes = (input: string): { value: string; repairs: number } | null => {
  let value = "";
  let repairs = 0;
  for (let index = 0; index < input.length;) {
    const current = input[index]!;
    if (current === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < input.length) {
        const character = input[index]!;
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          break;
        }
      }
      if (input[index - 1] !== '"') return null;
      value += input.slice(start, index);
      continue;
    }
    value += current;
    index += 1;
    if (current !== "{" && current !== ",") continue;
    const whitespaceStart = index;
    while (index < input.length && /\s/.test(input[index]!)) index += 1;
    value += input.slice(whitespaceStart, index);
    const propertyStart = index;
    if (!/[A-Za-z_]/.test(input[index] ?? "")) continue;
    index += 1;
    while (index < input.length && /[A-Za-z0-9_]/.test(input[index]!)) index += 1;
    if (input[index] !== '"') {
      value += input.slice(propertyStart, index);
      continue;
    }
    const closingQuote = index;
    index += 1;
    const separatorStart = index;
    while (index < input.length && /\s/.test(input[index]!)) index += 1;
    if (input[index] !== ":") {
      value += input.slice(propertyStart, separatorStart);
      continue;
    }
    value += `"${input.slice(propertyStart, closingQuote + 1)}${input.slice(separatorStart, index + 1)}`;
    index += 1;
    repairs += 1;
    if (repairs > MAX_DISCOVERY_ENVELOPE_PUNCTUATION_REPAIRS) return null;
  }
  return { value, repairs };
};

const repairUnbalancedRootClosers = (
  input: string,
  repairsSoFar: number,
): string | null => {
  const stack: Array<"{" | "["> = [];
  let output = "";
  let inString = false;
  let escaped = false;
  let repairs = repairsSoFar;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      output += character;
      continue;
    }
    if (character !== "}" && character !== "]") {
      output += character;
      continue;
    }
    const expectedOpen = character === "}" ? "{" : "[";
    if (stack.at(-1) === expectedOpen) {
      stack.pop();
      output += character;
      continue;
    }
    if (stack.length > 0 || !input.slice(index).split("").every((value) => /[\s}\]]/.test(value))) {
      return null;
    }
    repairs += 1;
    if (repairs > MAX_DISCOVERY_ENVELOPE_PUNCTUATION_REPAIRS) return null;
  }
  if (inString) return null;
  while (stack.length > 0) {
    output += stack.pop() === "{" ? "}" : "]";
    repairs += 1;
    if (repairs > MAX_DISCOVERY_ENVELOPE_PUNCTUATION_REPAIRS) return null;
  }
  return output;
};

const parseDiscoveryEnvelope = (answer: string, allowBoundedRepair: boolean): unknown => {
  try {
    return JSON.parse(answer) as unknown;
  } catch {
    if (!allowBoundedRepair) return null;
    const trimmed = answer.trim();
    if (!trimmed.startsWith("{")) return null;
    const quoted = repairMissingPropertyOpeningQuotes(trimmed);
    if (!quoted) return null;
    const balanced = repairUnbalancedRootClosers(quoted.value, quoted.repairs);
    if (!balanced || balanced === trimmed) return null;
    try {
      return JSON.parse(balanced) as unknown;
    } catch {
      return null;
    }
  }
};

const parseDiscoveryCandidates = (
  answer: string,
  identity: ProjectAdditionalAiInsightArtifactIdentity,
): DiscoveryCandidate[] | null => {
  if (typeof answer !== "string" || answer.length > MAX_DISCOVERY_ANSWER_CHARS) return null;
  const allowBoundedRepair = identity.identityContractRevision === "ngee-ann-additional-insights-v4";
  const parsed = parseDiscoveryEnvelope(answer, allowBoundedRepair);
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return null;
  const exactKeys = identity.identityContractRevision === "ngee-ann-additional-insights-v4"
    && parsed.type === "object"
    ? ["candidates", "type"]
    : ["candidates"];
  if (!hasExactKeys(parsed, exactKeys)) return null;
  const seen = new Set<string>();
  return parsed.candidates.map((value, index) => {
    const proposed = isRecord(value) && nonEmptyString(value.id) ? value.id.trim() : `candidate-${index + 1}`;
    const sourceId = seen.has(proposed) ? `${proposed}#${index + 1}` : proposed;
    seen.add(proposed);
    return { sourceId, value };
  });
};

const publishAdditionalArtifact = (input: {
  identity: ProjectAdditionalAiInsightArtifactIdentity;
  methodSet: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>;
  catalog: AnalysisContextEvidenceCatalog;
  presentedClaims: PreschoolAdditionalAiPresentedClaims;
  candidates: DiscoveryCandidate[];
  toolAudits: ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightRuntime>["audits"]>;
  runId: string;
  findingWindowIds?: readonly string[];
}): AdditionalAiInsightsArtifact => {
  const factsById = new Map(input.catalog.facts.map((fact) => [fact.id, fact]));
  const auditsById = new Map(input.toolAudits.map((audit) => [audit.auditId, audit]));
  const coreMethod = input.methodSet.methods.find(({ role }) => role === "core-method")!;
  const directionMethods = input.methodSet.methods.filter(({ role }) => role === "expert-direction");
  const canvasEvidenceFacts = projectCanvasEvidenceFacts(input.identity, input.catalog);
  const knownCentreCodes = collectCatalogCentreCodes(input.catalog);
  const accepted: AcceptedCandidate[] = [];
  const rejectedCandidateIds: string[] = [];
  for (const candidate of input.candidates) {
    const normalizedCandidate = input.toolAudits.length === 0
      && isRecord(candidate.value)
      && candidate.value.toolAuditIds === undefined
      ? { ...candidate, value: { ...candidate.value, toolAuditIds: [] } }
      : candidate;
    const finding = acceptCandidate(
      normalizedCandidate,
      factsById,
      input.presentedClaims.claims,
      auditsById,
      coreMethod,
      directionMethods,
      input.identity,
      canvasEvidenceFacts,
      knownCentreCodes,
    );
    if (finding) accepted.push({ sourceId: candidate.sourceId, finding });
    else rejectedCandidateIds.push(candidate.sourceId);
  }
  const published = accepted.slice(0, 3);
  const suppressed = accepted.slice(3);
  const findingsV3: AdditionalAiInsightFindingV3[] = published.map(({ finding }) => input.findingWindowIds?.length
    ? { ...finding, windowIds: [...input.findingWindowIds] }
    : finding);
  const findingsV1V2: AdditionalAiInsightFindingV1V2[] = published.map(({ finding }) => {
    const { windowIds: _windowIds, relationship: _relationship, ...legacyFinding } = finding;
    return legacyFinding;
  });
  const isV3 = input.identity.outputContractRevision === "energyiq-additional-ai-insights-v3";
  const findings = isV3 ? findingsV3 : findingsV1V2;
  const usedFactIds = new Set([
    ...findings.flatMap(({ evidenceRefs }) => evidenceRefs),
    ...findings.flatMap(({ canvas }) => canvas?.contractRevision === "energyiq-insight-canvas-v2"
      ? [
          ...canvas.acceptedBlocks.flatMap(({ bindings }) => bindings.map(({ evidenceRef }) => evidenceRef)),
          ...canvas.gaps.flatMap(({ evidenceRefs }) => evidenceRefs),
        ]
      : []),
    ...input.toolAudits.flatMap(({ evidenceRefs }) => evidenceRefs),
  ]);
  const evidenceFacts = input.catalog.facts
    .filter(({ id }) => usedFactIds.has(id))
    .map(({ id, label, metricId, value, unit, status, evidenceRefs, dimensions }) => ({
      id,
      label,
      metricId,
      value,
      ...(unit ? { unit } : {}),
      status,
      evidenceRefs: [...evidenceRefs],
      dimensions: { ...dimensions },
    }));
  const usedTools = [...new Set(input.toolAudits.map(({ toolName }) => toolName) as PreschoolAdditionalAiInsightToolName[])];
  const artifactBase = {
    artifactKind: "autonomous-insights" as const,
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    binding: {
      workspaceId: input.identity.workspaceId,
      projectId: input.identity.projectId,
      scopeId: input.identity.scopeId,
      dataSnapshotId: input.identity.dataSnapshotId,
      projectReleaseId: input.identity.projectReleaseId,
      analysisPeriod: {
        from: input.identity.analysisPeriodFrom,
        to: input.identity.analysisPeriodTo,
      },
      modelProfileId: input.identity.modelProfileId,
      modelProfileRevision: input.identity.modelProfileRevision,
    },
    methodExecution: {
      methodSetId: input.identity.methodSetId,
      methodSetRevision: input.identity.methodSetRevision,
      methodSetFingerprint: input.identity.methodSetFingerprint,
      loadedMethods: [...input.methodSet.methods],
    },
    capability: {
      revision: input.identity.capabilityRevision,
      mode: "scoped-read-only" as const,
      allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
      usedTools,
    },
    toolAudits: input.toolAudits,
    evidenceLineage: {
      catalogContract: input.catalog.contract,
      sourceId: input.catalog.sourceId,
      pins: { ...input.catalog.pins },
      facts: evidenceFacts,
    },
    publication: {
      policyId: "energyiq-additional-ai-insights" as const,
      policyRevision: input.identity.publicationRevision,
      discoveredCount: input.candidates.length,
      acceptedCount: accepted.length,
      rejectedCount: rejectedCandidateIds.length,
      publishedCount: published.length,
      sourceOrderCandidateIds: input.candidates.map(({ sourceId }) => sourceId),
      acceptedCandidateIds: accepted.map(({ sourceId }) => sourceId),
      rejectedCandidateIds,
      publishedCandidateIds: published.map(({ sourceId }) => sourceId),
      suppressedCandidateIds: suppressed.map(({ sourceId }) => sourceId),
    },
  };
  if (isV3) {
    const contract = {
      id: "energyiq-additional-ai-insights" as const,
      revision: "energyiq-additional-ai-insights-v3" as const,
    };
    return findingsV3.length === 0
      ? { ...artifactBase, contract, status: "empty", findings: [] }
      : { ...artifactBase, contract, status: "available", findings: findingsV3 };
  }
  const contract = {
    id: "energyiq-additional-ai-insights" as const,
    revision: input.identity.outputContractRevision === "energyiq-additional-ai-insights-v1"
      ? "energyiq-additional-ai-insights-v1" as const
      : "energyiq-additional-ai-insights-v2" as const,
  };
  return findingsV1V2.length === 0
    ? { ...artifactBase, contract, status: "empty", findings: [] }
    : { ...artifactBase, contract, status: "available", findings: findingsV1V2 };
};

const acceptCandidate = (
  candidate: DiscoveryCandidate,
  factsById: Map<string, AnalysisContextEvidenceCatalog["facts"][number]>,
  presentedClaims: readonly PreschoolAdditionalAiPresentedClaim[],
  auditsById: Map<string, ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightRuntime>["audits"]>[number]>,
  coreMethod: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"][number],
  directionMethods: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"],
  identity: ProjectAdditionalAiInsightArtifactIdentity,
  canvasEvidenceFacts: readonly InsightCanvasEvidenceFact[],
  knownCentreCodes: readonly string[],
): AdditionalAiInsightFindingV3 | null => {
  const value = candidate.value;
  const hasSeparatedNarrative = isRecord(value) && hasOnlyKeys(value, [
    "id", "title", "observation", "angle", "epistemicStatus", "origin", "incrementalContext", "evidenceRefs", "toolAuditIds", "deepDiveQuestion", "alert", "canvas",
  ]);
  if (!isRecord(value)
    || !hasSeparatedNarrative
    || value.id !== candidate.sourceId
    || !conciseSummaryTitle(value.title)
    || !boundedSafeText(value.observation, MAX_CANDIDATE_TEXT_CHARS)
    || !boundedSafeText(value.angle, MAX_CANDIDATE_TEXT_CHARS)
    || (value.epistemicStatus !== "observed" && value.epistemicStatus !== "inferred" && value.epistemicStatus !== "speculative")
    || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length === 0
    || !uniqueStrings(value.evidenceRefs)
    || value.evidenceRefs.some((id) => !factsById.has(id))
    || !Array.isArray(value.toolAuditIds)
    || !uniqueStrings(value.toolAuditIds)
    || optionalBoundedSafeText(value.deepDiveQuestion, MAX_CANDIDATE_TEXT_CHARS) === false) return null;
  const evidenceRefs = value.evidenceRefs;
  const toolAuditIds = value.toolAuditIds;
  const citedFacts = evidenceRefs.map((reference) => factsById.get(reference)!);
  const narrativeEvidence = citedFacts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      unit: fact.unit ?? null,
      values: { [fact.metricId]: fact.value, ...fact.dimensions },
    }));
  const narrativeIsSupported = (narrative: string): boolean => energyAiNarrativeClaimsSupported({
    narrative: maskTransparentHypotheticalPercentages(narrative),
    evidence: narrativeEvidence,
    sqlEvidence: [],
    knownCentreCodes,
  }) && crossPeriodFactsAreSupported(narrative, citedFacts);
  const factualNarrativeIsSupported = (narrative: string): boolean => narrativeIsSupported(narrative)
    && factualOrderingClaimsAreSupported(narrative, citedFacts);
  const acceptedNarrative = resolveSeparatedCandidateNarrative({
    observation: value.observation,
    angle: value.angle,
    observationIsSupported: factualNarrativeIsSupported,
    angleIsSupported: narrativeIsSupported,
  });
  if (!acceptedNarrative) return null;
  const acceptedTitle = resolveSupportedCandidateTitle({
    title: value.title,
    incrementalContext: value.incrementalContext,
    fallbackObservation: acceptedNarrative.observation,
    fallbackAngle: acceptedNarrative.angle,
    preferAngleFallback: identity.rendererKey === "ngee-ann-overview",
    narrativeIsSupported: factualNarrativeIsSupported,
  });
  if (!acceptedTitle) return null;
  const acceptedDeepDiveQuestion = nonEmptyString(value.deepDiveQuestion)
    && narrativeIsSupported(value.deepDiveQuestion)
    ? value.deepDiveQuestion.trim()
    : undefined;
  const origin = resolveCandidateOrigin(value.origin, coreMethod, directionMethods);
  const incrementalContextValue = acceptedTitle.repairedFromObservation && isRecord(value.incrementalContext)
    ? { ...value.incrementalContext, novelConclusion: acceptedNarrative.angle }
    : value.incrementalContext;
  const incrementalContext = resolveIncrementalContext(
    incrementalContextValue,
    evidenceRefs,
    presentedClaims,
    { title: acceptedTitle.text, text: acceptedNarrative.noveltyText },
  );
  if (!origin || !incrementalContext) return null;
  const epistemicStatus = resolveAcceptedEpistemicStatus({
    title: acceptedTitle.text,
    text: acceptedNarrative.epistemicText,
    ...(acceptedDeepDiveQuestion ? { deepDiveQuestion: acceptedDeepDiveQuestion } : {}),
    epistemicStatus: value.epistemicStatus,
    originKind: origin.kind,
    relationshipAssertion: incrementalContext.relationshipAssertion,
  });
  if (!epistemicStatus) return null;
  const audits = toolAuditIds.map((id) => auditsById.get(id));
  if (audits.some((audit) => !audit || audit.status !== "succeeded")) return null;
  if (audits.length > 0
    && audits.some((audit) => !audit!.evidenceRefs.some((ref) => evidenceRefs.includes(ref)))) return null;
  if (isRecord(value.alert)
    && !alertIsAcceptable(value.alert, epistemicStatus, evidenceRefs, factsById)) return null;
  const finding: AdditionalAiInsightFindingV3 = {
    id: `additional:${candidate.sourceId}`,
    title: acceptedTitle.text,
    text: acceptedNarrative.publishedText,
    epistemicStatus,
    origin,
    evidenceRefs: [...evidenceRefs],
    toolAuditIds: [...toolAuditIds],
    relationship: {
      relatedPresentedClaimIds: [...incrementalContext.relatedPresentedClaimIds],
      novelConclusion: incrementalContext.novelConclusion,
      relationshipAssertion: incrementalContext.relationshipAssertion,
    },
    ...(acceptedDeepDiveQuestion ? { deepDiveQuestion: acceptedDeepDiveQuestion } : {}),
    ...(isRecord(value.alert)
      ? {
          alert: {
            severity: value.alert.severity as "attention" | "urgent",
            certainty: value.alert.certainty as "confirmed" | "anomaly" | "possible",
            evidenceRefs: [...value.alert.evidenceRefs as string[]],
          },
        }
      : {}),
  };
  const canvas = acceptCandidateCanvas({
    candidate,
    candidateValue: value,
    publishedText: acceptedNarrative.publishedText,
    identity,
    evidenceFacts: canvasEvidenceFacts,
  });
  return canvas ? { ...finding, canvas } : finding;
};

const resolveCandidateOrigin = (
  value: unknown,
  coreMethod: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"][number],
  loadedDirectionMethods: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"],
): AdditionalAiInsightFinding["origin"] | null => {
  if (!isRecord(value)
    || !nonEmptyString(value.kind)
    || !Array.isArray(value.directionMethodResourceIds)
    || !uniqueStrings(value.directionMethodResourceIds)) return null;
  const resourceIds = value.directionMethodResourceIds;
  if (value.kind === "ai-discovery") {
    return hasExactKeys(value, ["kind", "directionMethodResourceIds"])
      && resourceIds.length === 0
      ? { kind: "ai-discovery", coreMethod, directionMethods: [] }
      : null;
  }
  const resolved = resourceIds.map((resourceId) =>
    loadedDirectionMethods.filter((method) => method.resourceId === resourceId));
  if (resourceIds.length === 0 || resolved.some((matches) => matches.length !== 1)) return null;
  const directionMethods = resolved.map(([method]) => method!);
  const [firstDirectionMethod, ...remainingDirectionMethods] = directionMethods;
  if (!firstDirectionMethod) return null;
  if (value.kind === "expert-sop") {
    return hasExactKeys(value, ["kind", "directionMethodResourceIds"])
      ? {
          kind: "expert-sop",
          coreMethod,
          directionMethods: [firstDirectionMethod, ...remainingDirectionMethods],
        }
      : null;
  }
  if (value.kind === "hybrid"
    && hasExactKeys(value, ["kind", "directionMethodResourceIds", "novelContribution"])
    && boundedSafeText(value.novelContribution, MAX_NOVEL_CONTRIBUTION_CHARS)) {
    return {
      kind: "hybrid",
      coreMethod,
      directionMethods: [firstDirectionMethod, ...remainingDirectionMethods],
      novelContribution: value.novelContribution.trim(),
    };
  }
  return null;
};

const crossPeriodFactsAreSupported = (
  narrative: string,
  citedFacts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
): boolean => narrative
  .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])|\s*;\s*|,\s*(?=(?:but|while|whereas|however)\b)/iu)
  .filter((fragment) => fragment.trim().length > 0)
  .every((fragment) => crossPeriodFactIsSupported(fragment, citedFacts));

const factualOrderingClaimsAreSupported = (
  narrative: string,
  citedFacts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
): boolean => {
  if (!superlativeClaimsAreSupported(narrative, citedFacts)) return false;

  const relationPattern = /\b(exceeds?|higher\s+than|greater\s+than|more\s+than|lower\s+than|less\s+than|below)\b/giu;
  return [...narrative.matchAll(relationPattern)].every((match) => {
    const relationIndex = match.index ?? 0;
    const left = narrative.slice(0, relationIndex);
    const right = narrative.slice(relationIndex + match[0].length);
    const numeric = [...left.matchAll(/(-?\d[\d,]*(?:\.\d+)?)/gu)].at(-1)?.[1];
    const leftFact = numeric
      ? (() => {
          const leftValue = Number(numeric.replace(/,/gu, ""));
          const precision = numeric.includes(".") ? numeric.split(".")[1]!.length : 0;
          const tolerance = (0.5 * (10 ** -precision)) + Number.EPSILON;
          return citedFacts.find(({ value }) => typeof value === "number"
            && Math.abs(value - leftValue) <= tolerance) ?? null;
        })()
      : resolveOrderingFactFromText(citedFacts, left);
    if (!leftFact) return false;
    const rightFact = resolveOrderingFactFromText(citedFacts.filter((fact) => fact !== leftFact), right);
    if (!rightFact) return false;
    const leftValue = leftFact.value as number;
    const rightValue = rightFact.value as number;
    return /^(?:exceeds?|higher\s+than|greater\s+than|more\s+than)$/iu.test(match[0])
      ? leftValue > rightValue
      : leftValue < rightValue;
  });
};

const SUPERLATIVE_CLAIM_PATTERN = /\b(?:(?:top|highest|lowest|largest|smallest)\s+(?:absolute\s+)?(?:energy|use|usage|consumer|user|eui|per[- ]?(?:person|pax)|demand|load)|(?:uses?|consumes?|records?)\s+(?:the\s+)?(?:most|least)\s+(?:energy|electricity|use|usage|demand|load)|ranks?\s+(?:first|last|#?\s*1)\s+for\s+(?:eui|energy\s+intensity|per[- ]?(?:person|pax)|energy|use|usage|demand|load))\b/giu;

const superlativeClaimsAreSupported = (
  narrative: string,
  citedFacts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
): boolean => narrative
  .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u)
  .filter((sentence) => sentence.trim().length > 0)
  .every((sentence) => {
    const claims = [...sentence.matchAll(SUPERLATIVE_CLAIM_PATTERN)];
    if (claims.length === 0) return true;
    return claims.every((claim) => {
      const rankFacts = citedFacts.filter((fact) =>
        superlativeRankFactMatchesDirection(fact, claim[0])
        && superlativeMetricMatchesFact(claim[0], fact));
      const subjectCentreCodes = superlativeSubjectCentreCodes(
        sentence,
        claim.index ?? 0,
        citedFacts,
      );
      if (subjectCentreCodes.length > 0) {
        return subjectCentreCodes.every((centreCode) => rankFacts.some((fact) =>
          factCentreCodes(fact).includes(centreCode)));
      }
      return resolveOrderingFactFromText(rankFacts, sentence) !== null;
    });
  });

const superlativeSubjectCentreCodes = (
  sentence: string,
  claimIndex: number,
  citedFacts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
): string[] => {
  const beforeClaim = sentence.slice(0, claimIndex);
  const boundaries = [...beforeClaim.matchAll(/[;:.!?]|\b(?:but|while|whereas|however)\b/giu)];
  const lastBoundary = boundaries.at(-1);
  const subject = beforeClaim.slice(lastBoundary
    ? (lastBoundary.index ?? 0) + lastBoundary[0].length
    : 0);
  if (!/\bCentres?\b/iu.test(subject)) return [];
  const knownCodes = new Set(citedFacts.flatMap(factCentreCodes));
  return [...knownCodes].filter((centreCode) => new RegExp(
    `\\b${escapeRegularExpression(centreCode)}\\b`,
    "iu",
  ).test(subject));
};

const factCentreCodes = (
  fact: AnalysisContextEvidenceCatalog["facts"][number],
): string[] => [...new Set([
  ...(fact.dimensions.centreCode ? [fact.dimensions.centreCode] : []),
  ...(fact.dimensions.centreCodes?.split(/[,\s]+/u) ?? []),
  ...[...fact.label.matchAll(/\bCentres?\s+([A-Z]{1,2})\b/giu)]
    .map((match) => match[1] ?? ""),
]
  .map((value) => value.trim().toLocaleUpperCase("en"))
  .filter(Boolean))];

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const superlativeRankFactMatchesDirection = (
  fact: AnalysisContextEvidenceCatalog["facts"][number],
  claim: string,
): boolean => {
  const factText = canonicalClaimText(
    `${fact.id} ${fact.label} ${fact.metricId} ${Object.entries(fact.dimensions)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(" ")}`,
  );
  if (/\b(?:lowest|smallest|least|last)\b/iu.test(claim)) {
    return /\b(?:lowest|smallest|least|last)\b/iu.test(factText);
  }
  return Object.entries(fact.dimensions).some(([key, value]) =>
    /rank/iu.test(key) && String(value) === "1")
    || /(?:\brank\s*#?\s*1\b|#1\b)/iu.test(`${fact.id} ${fact.label}`);
};

const superlativeMetricMatchesFact = (
  claim: string,
  fact: AnalysisContextEvidenceCatalog["facts"][number],
): boolean => {
  const factText = canonicalClaimText(
    `${fact.id} ${fact.label} ${fact.metricId} ${Object.entries(fact.dimensions)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(" ")}`,
  );
  if (/\b(?:eui|energy\s+intensity)\b/iu.test(claim)) {
    return /\b(?:eui|intensity|floor area)\b/iu.test(factText);
  }
  if (/\bper[- ]?(?:person|pax)\b/iu.test(claim)) {
    return /\b(?:per person|per pax|headcount)\b/iu.test(factText);
  }
  return /\b(?:energy|use|usage|kwh|demand|load)\b/iu.test(factText)
    && !/\b(?:eui|intensity|floor area|per person|per pax|headcount)\b/iu.test(factText);
};

const resolveOrderingFactFromText = (
  facts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
  text: string,
): AnalysisContextEvidenceCatalog["facts"][number] | null => {
  const textTokens = new Set(canonicalClaimText(text).split(" ").filter(Boolean));
  const ranked = facts
    .filter((fact) => typeof fact.value === "number")
    .map((fact) => {
      const factTokens = new Set(canonicalClaimText(
        `${fact.label} ${Object.values(fact.dimensions).join(" ")}`,
      ).split(" ").filter(Boolean));
      return {
        fact,
        score: [...factTokens].filter((token) => textTokens.has(token)).length,
      };
    })
    .sort((left, right) => right.score - left.score);
  const top = ranked[0];
  if (!top || top.score < 2 || ranked[1]?.score === top.score) return null;
  return top.fact;
};

const TEMPORAL_NEUTRAL_CHANGE_SOURCE = String.raw`unchanged|flat|stable|steady|similar|same`;
const TEMPORAL_POSITIVE_CHANGE_SOURCE = String.raw`increas(?:e|ed|ing)|higher|greater|above|more|rose|risen|grew|grown|surg(?:e|ed|ing)|jump(?:ed|ing)?|doubl(?:e|ed|ing)|up`;
const TEMPORAL_NEGATIVE_CHANGE_SOURCE = String.raw`decreas(?:e|ed|ing)|declin(?:e|ed|ing)|reduc(?:e|ed|ing)|lower|less|fewer|below|fell|fallen|dropped|halv(?:e|ed|ing)|down`;
const TEMPORAL_CHANGE_SOURCE = `${TEMPORAL_NEUTRAL_CHANGE_SOURCE}|${TEMPORAL_POSITIVE_CHANGE_SOURCE}|${TEMPORAL_NEGATIVE_CHANGE_SOURCE}|changed`;

const crossPeriodFactIsSupported = (
  narrative: string,
  citedFacts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
): boolean => {
  const hasTemporalComparator = /\b(?:prior|previous|earlier|last)\s+(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]?)?(?:day|week|month|year|period|window)s?(?:\s+window)?\b|\b(?:day|week|month|year|period)[- ](?:over|on)[- ](?:day|week|month|year|period)\b/iu.test(narrative);
  if (!hasTemporalComparator) return true;
  const changeMatches = [...narrative.matchAll(new RegExp(String.raw`\b(?:${TEMPORAL_CHANGE_SOURCE})\b`, "giu"))];
  if (changeMatches.length === 0) return false;
  const measuredChanges = changeMatches.filter((match) => !temporalChangeIsHypothetical(narrative, match.index ?? 0));
  if (measuredChanges.length === 0) return true;
  return measuredChanges.every((match) => {
    const clause = temporalChangeClause(narrative, match.index ?? 0, match[0].length);
    const comparedMetricIds = temporalClaimMetricIdsForChange(
      narrative,
      match.index ?? 0,
      clause,
    );
    if (comparedMetricIds.length === 0) return false;
    return comparedMetricIds.every((comparedMetricId) => {
      const comparison = citedComparisonChange(citedFacts, comparedMetricId, clause);
      return comparison !== null
        && temporalDirectionMatches(match[0], comparison.changePct)
        && temporalMagnitudesMatch(narrative, comparison, [match]);
    });
  });
};

const temporalChangeIsHypothetical = (narrative: string, changeIndex: number): boolean => {
  const prefix = temporalClaimGovernancePrefix(narrative, changeIndex);
  const hasTransparentModal = /\b(?:may|might|could)\s+(?:(?:potentially|possibly)\s+)?(?:have\s+)?(?:be(?:en)?\s+)?(?:(?:about|around|roughly|approximately)\s+)?(?:-?\d[\d,]*(?:\.\d+)?\s*(?:%|percent(?:age)?(?:\s+points?)?|kWh)\s+)?$/iu.test(prefix);
  if (!hasTransparentModal) return false;
  // A modal does not turn a retrospective quantitative claim into a scenario.
  // "May have increased" still asserts a possible historical measurement and
  // must therefore be backed by exact comparison Evidence.
  if (/\b(?:may|might|could)\s+(?:(?:potentially|possibly)\s+)?have\b/iu.test(prefix)) {
    return false;
  }
  const changeToken = narrative.slice(changeIndex).match(new RegExp(`^(?:${TEMPORAL_CHANGE_SOURCE})`, "iu"))?.[0] ?? "";
  if (explicitForwardExperimentApplies(narrative, changeIndex)) return true;
  const clause = temporalChangeClause(narrative, changeIndex, changeToken.length);
  const hasRetrospectiveComparator = /\b(?:prior|previous|earlier|last)\s+(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]?)?(?:day|week|month|year|period|window)s?(?:\s+window)?\b/iu.test(clause);
  const hasExplicitPercentage = /-?\d[\d,]*(?:\.\d+)?\s*(?:%|percent(?:age)?(?:\s+points?)?)/iu.test(clause);
  const hasImplicitMagnitude = /^(?:doubl(?:e|ed|ing)|halv(?:e|ed|ing))$/iu.test(changeToken);
  if (hasRetrospectiveComparator && (hasExplicitPercentage || hasImplicitMagnitude)) return false;
  return true;
};

const explicitForwardExperimentApplies = (narrative: string, changeIndex: number): boolean => {
  const before = narrative.slice(0, changeIndex);
  const previousSentenceBoundary = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf(";"),
  );
  const sentencePrefix = before.slice(previousSentenceBoundary + 1).slice(-200);
  const sentenceSuffix = narrative.slice(changeIndex, changeIndex + 200);
  const interventionSource = String.raw`schedules?|setpoints?|controls?|equipment|timings?|operating\s+hours?|occupancy|loads?|start\s+times?|shutdowns?`;
  const governedForwardFrame = new RegExp(
    String.raw`\b(?:what[- ]if|scenario|experiment|trial|proposed)\b[^.!?;]{0,120}\b(?:${interventionSource})\b[^.!?;]{0,48}$`,
    "iu",
  );
  return new RegExp(String.raw`\bif\b[^.!?;]{0,140}\b(?:${interventionSource})\b`, "iu").test(sentencePrefix)
    || new RegExp(String.raw`\bafter\b[^.!?;]{0,80}\b(?:${interventionSource})\b[^.!?;]{0,48}\b(?:change|changes|adjust|adjustment|shift|reduction)\b`, "iu").test(sentenceSuffix)
    || governedForwardFrame.test(sentencePrefix);
};

const maskTransparentHypotheticalPercentages = (narrative: string): string => {
  const governedMagnitudeSpans = [...narrative.matchAll(new RegExp(String.raw`\b(?:${TEMPORAL_CHANGE_SOURCE})\b`, "giu"))]
    .filter((change) => temporalChangeIsHypothetical(narrative, change.index ?? 0))
    .flatMap((change) => hypotheticalPercentageMagnitudeSpans(
      narrative,
      change.index ?? 0,
      change[0].length,
    ));
  return narrative.replace(
    /-?\d[\d,]*(?:\.\d+)?\s*(?:%|percent(?:age)?(?:\s+points?)?)(?=\s|[.,;:!?)]|$)/giu,
    (quantity, offset: number) => governedMagnitudeSpans.some((span) => offset >= span.start && offset < span.end)
      ? "a scenario percentage"
      : quantity,
  );
};

const hypotheticalPercentageMagnitudeSpans = (
  narrative: string,
  changeIndex: number,
  changeLength: number,
): { start: number; end: number }[] => {
  const quantitySource = String.raw`-?\d[\d,]*(?:\.\d+)?\s*(?:%|percent(?:age)?(?:\s+points?)?)`;
  const lookBehindStart = Math.max(0, changeIndex - 96);
  const before = narrative.slice(lookBehindStart, changeIndex);
  const beforeMatch = before.match(new RegExp(`(${quantitySource})\\s*$`, "iu"));
  const afterStart = changeIndex + changeLength;
  const after = narrative.slice(afterStart, afterStart + 96);
  const afterMatch = after.match(new RegExp(`^\\s*(?:(?:by|of)\\s+)?(?:(?:about|around|roughly|approximately)\\s+)?(${quantitySource})`, "iu"));
  return [
    ...(beforeMatch && beforeMatch.index !== undefined
      ? [{
          start: lookBehindStart + beforeMatch.index + beforeMatch[0].indexOf(beforeMatch[1]!),
          end: lookBehindStart + beforeMatch.index + beforeMatch[0].indexOf(beforeMatch[1]!) + beforeMatch[1]!.length,
        }]
      : []),
    ...(afterMatch && afterMatch.index !== undefined
      ? [{
          start: afterStart + afterMatch.index + afterMatch[0].indexOf(afterMatch[1]!),
          end: afterStart + afterMatch.index + afterMatch[0].indexOf(afterMatch[1]!) + afterMatch[1]!.length,
        }]
      : []),
  ];
};

const temporalClaimGovernancePrefix = (narrative: string, changeIndex: number): string => {
  const before = narrative.slice(0, changeIndex);
  const boundaries = [...before.matchAll(/[,;:.!?]|\b(?:and|but|while|whereas|however|because|given\s+that)\b/giu)];
  const lastBoundary = boundaries.at(-1);
  const start = lastBoundary ? (lastBoundary.index ?? 0) + lastBoundary[0].length : 0;
  return before.slice(start).slice(-96);
};

const temporalClaimMetricId = (narrative: string): string | null =>
  temporalMetricIdsFromText(narrative)[0] ?? null;

const temporalMetricIdsFromText = (narrative: string): string[] => {
  if (/\b(?:off[- ]hours?|closed[- ]hours?|standby)\b/iu.test(narrative)) {
    return ["energy.off_hours_usage_kwh"];
  }
  if (/\bCentres?\s+[A-Z]{1,2}\b/iu.test(narrative)) {
    return ["energy.total_usage_kwh"];
  }
  if (/\b(?:circuit|plug\s*load|lighting|heater|aircon|air\s*conditioning)\b/iu.test(narrative)) {
    return ["energy.circuit_usage_kwh"];
  }
  return [...new Set([
    ...(/\b(?:peak|maximum|max\.?\s+demand)\b/iu.test(narrative)
      ? ["energy.peak_interval_average_kw"]
      : []),
    ...(/\b(?:total\s+(?:energy|electricity)\s+|(?:energy|electricity)\s+|total\s+)(?:use|usage|consumption)\b/iu.test(narrative)
      ? ["energy.total_usage_kwh"]
      : []),
  ])];
};

const temporalClaimMetricIdsForChange = (
  narrative: string,
  changeIndex: number,
  localClause: string,
): string[] => {
  const localMetricIds = temporalMetricIdsFromText(localClause);
  const beforeChange = narrative.slice(0, changeIndex);
  const sentenceBoundary = [...beforeChange.matchAll(/[;.!?]|\b(?:but|while|whereas|however|because|given\s+that)\b/giu)].at(-1);
  const sentencePrefix = beforeChange.slice(sentenceBoundary
    ? (sentenceBoundary.index ?? 0) + sentenceBoundary[0].length
    : 0);
  const conjunctions = [...sentencePrefix.matchAll(/\band\b/giu)];
  const conjunction = conjunctions.at(-1);
  if (!conjunction) return localMetricIds;
  const left = sentencePrefix.slice(0, conjunction.index ?? 0);
  const right = sentencePrefix.slice((conjunction.index ?? 0) + conjunction[0].length);
  if (new RegExp(String.raw`\b(?:${TEMPORAL_CHANGE_SOURCE})\b`, "iu").test(left)) {
    return localMetricIds;
  }
  const leftMetricIds = temporalMetricIdsFromText(left);
  const rightMetricIds = temporalMetricIdsFromText(right);
  return leftMetricIds.length > 0 && rightMetricIds.length > 0
    ? [...new Set([...leftMetricIds, ...rightMetricIds])]
    : localMetricIds;
};

const citedComparisonChange = (
  citedFacts: readonly AnalysisContextEvidenceCatalog["facts"][number][],
  comparedMetricId: string,
  narrative: string,
): { changePct: number; changeKwh?: number } | null => {
  const comparisonFacts = citedFacts.filter((fact) => fact.dimensions.comparison === "previous-period"
    && fact.dimensions.comparedMetricId === comparedMetricId);
  const namedCentreCodes = [...narrative.matchAll(/\bCentres?\s+([A-Z]{1,2})\b/giu)]
    .map((match) => match[1]?.toLocaleUpperCase("en"))
    .filter((value): value is string => Boolean(value));
  const currentEntityScopeIds = new Set(citedFacts
    .filter((fact) => namedCentreCodes.includes(fact.dimensions.centreCode?.toLocaleUpperCase("en") ?? ""))
    .map((fact) => fact.dimensions.scopeId)
    .filter((value): value is string => Boolean(value)));
  const scopedComparisonFacts = namedCentreCodes.length === 0
    ? comparisonFacts
    : comparisonFacts.filter((fact) => namedCentreCodes.includes(fact.dimensions.centreCode?.toLocaleUpperCase("en") ?? "")
      || currentEntityScopeIds.has(fact.dimensions.scopeId ?? ""));
  const percentChange = scopedComparisonFacts.find((fact) => fact.metricId === "energy.period_change_pct")?.value;
  const absoluteChange = scopedComparisonFacts.find((fact) => fact.metricId === "energy.period_change_kwh")?.value;
  const previousUsage = scopedComparisonFacts.find((fact) => fact.id === "analysis.comparison.previous_usage_kwh")?.value;
  if (typeof percentChange === "number" && Number.isFinite(percentChange)) {
    return {
      changePct: percentChange,
      ...(typeof absoluteChange === "number" && Number.isFinite(absoluteChange) ? { changeKwh: absoluteChange } : {}),
    };
  }
  if (typeof absoluteChange !== "number" || !Number.isFinite(absoluteChange)
    || typeof previousUsage !== "number" || !Number.isFinite(previousUsage) || previousUsage === 0) return null;
  return { changePct: (absoluteChange / previousUsage) * 100, changeKwh: absoluteChange };
};

const temporalDirectionMatches = (token: string, changePct: number): boolean => {
  if (new RegExp(`^(?:${TEMPORAL_NEUTRAL_CHANGE_SOURCE})$`, "iu").test(token)) return Math.abs(changePct) <= 1;
  if (new RegExp(`^(?:${TEMPORAL_POSITIVE_CHANGE_SOURCE})$`, "iu").test(token)) return changePct > 0;
  if (new RegExp(`^(?:${TEMPORAL_NEGATIVE_CHANGE_SOURCE})$`, "iu").test(token)) return changePct < 0;
  return token.toLocaleLowerCase("en") === "changed";
};

const temporalMagnitudesMatch = (
  narrative: string,
  comparison: { changePct: number; changeKwh?: number },
  measuredChanges: readonly RegExpMatchArray[],
): boolean => {
  const magnitudeUnit = String.raw`(%|percent(?:age)?(?:\s+points?)?|kWh)`;
  const patterns = [
    new RegExp(String.raw`\b(?:${TEMPORAL_CHANGE_SOURCE})\s+(?:by\s+)?(-?\d[\d,]*(?:\.\d+)?)\s*${magnitudeUnit}(?=\s|[.,;:!?)]|$)`, "giu"),
    new RegExp(String.raw`(-?\d[\d,]*(?:\.\d+)?)\s*${magnitudeUnit}\s+(?:higher|greater|above|more|lower|less|fewer|below|up|down|increase|decrease|reduction|rise|drop|growth|decline)\b`, "giu"),
    new RegExp(String.raw`\b(?:up|down)\s+(?:by\s+)?(-?\d[\d,]*(?:\.\d+)?)\s*${magnitudeUnit}(?=\s|[.,;:!?)]|$)`, "giu"),
    new RegExp(String.raw`\b(?:${TEMPORAL_CHANGE_SOURCE}|reduction|rise|drop|growth)\s+(?:of|by)\s+(-?\d[\d,]*(?:\.\d+)?)\s*${magnitudeUnit}(?=\s|[.,;:!?)]|$)`, "giu"),
  ];
  return measuredChanges.every((change) => {
    const clause = temporalChangeClause(narrative, change.index ?? 0, change[0].length);
    const magnitudes = patterns.flatMap((pattern) => [...clause.matchAll(pattern)].map((match) => ({
      value: Number(match[1]?.replace(/,/gu, "")),
      unit: match[2]?.toLocaleLowerCase("en"),
    })));
    const explicitMagnitudesMatch = magnitudes.every(({ value, unit }) => {
      if (!Number.isFinite(value)) return false;
      const expected = unit === "kwh"
        ? comparison.changeKwh
        : unit?.includes("point")
          ? undefined
          : comparison.changePct;
      if (expected === undefined) return false;
      const tolerance = Math.max(0.01, Math.abs(expected) * 0.005);
      return Math.abs(Math.abs(value) - Math.abs(expected)) <= tolerance;
    });
    if (!explicitMagnitudesMatch) return false;
    if (/^doubl(?:e|ed|ing)$/iu.test(change[0])) {
      return Math.abs(Math.abs(comparison.changePct) - 100) <= 0.5;
    }
    if (/^halv(?:e|ed|ing)$/iu.test(change[0])) {
      return Math.abs(Math.abs(comparison.changePct) - 50) <= 0.25;
    }
    return true;
  });
};

const temporalChangeClause = (narrative: string, changeIndex: number, changeLength: number): string => {
  const range = temporalChangeClauseRange(narrative, changeIndex, changeLength);
  return narrative.slice(range.start, range.end);
};

const temporalChangeClauseRange = (
  narrative: string,
  changeIndex: number,
  changeLength: number,
): { start: number; end: number } => {
  const boundaryPattern = /(?<!\d)[,.:](?!\d)|[;!?]|\b(?:and|but|while|whereas|however|because|given\s+that)\b/giu;
  const before = narrative.slice(0, changeIndex);
  const previousBoundaries = [...before.matchAll(boundaryPattern)];
  const previousBoundary = previousBoundaries.at(-1);
  const start = previousBoundary ? (previousBoundary.index ?? 0) + previousBoundary[0].length : 0;
  const after = narrative.slice(changeIndex + changeLength);
  const nextBoundary = [...after.matchAll(boundaryPattern)].at(0);
  const end = nextBoundary
    ? changeIndex + changeLength + (nextBoundary.index ?? 0)
    : narrative.length;
  return { start, end };
};

const resolveIncrementalContext = (
  value: unknown,
  evidenceRefs: readonly string[],
  presentedClaims: readonly PreschoolAdditionalAiPresentedClaim[],
  publishedNarrative: { title: string; text: string },
): { relatedPresentedClaimIds: string[]; novelConclusion: string; relationshipAssertion: boolean } | null => {
  if (!isRecord(value)
    || !hasExactKeys(value, ["relatedPresentedClaimIds", "novelConclusion"])
    || !Array.isArray(value.relatedPresentedClaimIds)
    || !uniqueStrings(value.relatedPresentedClaimIds)
    || !boundedSafeText(value.novelConclusion, MAX_NOVEL_CONTRIBUTION_CHARS)) return null;
  const claimsById = new Map(presentedClaims.map((claim) => [claim.id, claim]));
  const deterministicBaselineIds = evidenceRefs.map((reference) => `deterministic-overview:${reference}`);
  const suppliedRelatedClaimIds = value.relatedPresentedClaimIds.filter((id) => {
    if (claimsById.has(id)) return true;
    return !deterministicBaselineIds.some((baselineId) => {
      const suffixStart = baselineId.indexOf(":");
      return suffixStart >= 0 && id.endsWith(baselineId.slice(suffixStart));
    });
  });
  const relatedPresentedClaimIds = [...new Set([
    ...suppliedRelatedClaimIds,
    ...deterministicBaselineIds,
  ])];
  const related = relatedPresentedClaimIds.map((id) => claimsById.get(id));
  if (related.some((claim) => !claim)) return null;
  const novelConclusion = value.novelConclusion.trim();
  const combinedNarrative = `${publishedNarrative.title} ${publishedNarrative.text}`;
  const conclusionIsRepresented = narrativeContainsConclusion(combinedNarrative, novelConclusion)
    || (evidenceRefs.length > 1 && claimTextsShareMeaningfulToken(combinedNarrative, novelConclusion));
  if (!conclusionIsRepresented
    || related.some((claim) => claimTextIsRestatement(claim!.text, novelConclusion))) return null;
  return {
    relatedPresentedClaimIds,
    novelConclusion,
    relationshipAssertion: evidenceRefs.length > 1
      || suppliedRelatedClaimIds.some((id) => !deterministicBaselineIds.includes(id)),
  };
};

const resolveAcceptedEpistemicStatus = (input: {
  title: string;
  text: string;
  deepDiveQuestion?: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  originKind: AdditionalAiInsightFinding["origin"]["kind"];
  relationshipAssertion: boolean;
}): "observed" | "inferred" | "speculative" | null => {
  const narrative = `${input.title}\n${input.text}\n${input.deepDiveQuestion ?? ""}`;
  const explicitCausal = /\b(?:cause(?:s|d)?|driv(?:e|es|en)|explain(?:s|ed)?)(?:\s+\w+){0,3}\s+(?:by|the\s+variance)|\bdue\s+to\b/iu.test(narrative);
  const explicitAction = /\b(?:highest[- ]leverage|best|optimal|most\s+effective)\b[^.!?\n]{0,80}\b(?:target|action|intervention)\b/iu.test(narrative);
  const externalBenchmark = /\b(?:typical\s+(?:learning\s+)?environments?|industry\s+benchmarks?|tropical\s+preschools?)\b|\bshould\s+dominate\b/iu.test(narrative);
  if (input.epistemicStatus === "observed" && (explicitCausal || explicitAction || externalBenchmark)) return null;
  if (externalBenchmark && input.originKind === "ai-discovery" && input.epistemicStatus !== "speculative") return null;
  if (input.originKind === "ai-discovery"
    && input.epistemicStatus === "observed"
    && input.relationshipAssertion) return "inferred";
  return input.epistemicStatus;
};

const acceptCandidateCanvas = (input: {
  candidate: DiscoveryCandidate;
  candidateValue: Record<string, unknown>;
  publishedText: string;
  identity: ProjectAdditionalAiInsightArtifactIdentity;
  evidenceFacts: readonly InsightCanvasEvidenceFact[];
}): Extract<AdditionalAiInsightFinding["canvas"], { contractRevision: "energyiq-insight-canvas-v2" }> | undefined => {
  if (input.candidateValue.canvas === undefined) return undefined;
  const accepted = acceptInsightCanvasPlan({
    expectedIdentity: {
      workspaceId: input.identity.workspaceId,
      projectId: input.identity.projectId,
      scopeId: input.identity.scopeId,
      dataSnapshotId: input.identity.dataSnapshotId,
      projectReleaseId: input.identity.projectReleaseId,
    },
    evidenceFacts: input.evidenceFacts,
    plan: input.candidateValue.canvas,
  });
  const findingMatches = accepted.acceptedFinding?.id === input.candidate.sourceId
    && accepted.acceptedFinding.title === input.candidateValue.title
    && accepted.acceptedFinding.text === input.publishedText
    && Array.isArray(input.candidateValue.evidenceRefs)
    && sameStringOrder(accepted.acceptedFinding.evidenceRefs, input.candidateValue.evidenceRefs);
  const acceptedBlocks = findingMatches ? accepted.acceptedBlocks.slice(0, 3) : [];
  const rejections: InsightCanvasRejection[] = [
    ...accepted.rejections,
    ...(findingMatches
      ? accepted.acceptedBlocks.slice(3).map(({ id }) => ({
          code: "PRESENTATION_BUDGET_EXCEEDED" as const,
          subjectId: id,
        }))
      : []),
  ];
  if (!findingMatches && !rejections.some(({ code }) => code === "FINDING_INVALID")) {
    rejections.push({ code: "FINDING_INVALID", subjectId: "finding" });
  }
  return {
    contractRevision: "energyiq-insight-canvas-v2",
    planId: `canvas-plan:additional:${input.candidate.sourceId}`,
    acceptedBlockIds: acceptedBlocks.map(({ id }) => id),
    acceptedBlocks,
    rejections,
    gaps: accepted.gaps,
  };
};

const projectCanvasEvidenceFacts = (
  identity: ProjectAdditionalAiInsightArtifactIdentity,
  catalog: AnalysisContextEvidenceCatalog,
): InsightCanvasEvidenceFact[] => catalog.facts.flatMap((fact) => {
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || !nonEmptyString(fact.unit)) return [];
  const entityId = fact.dimensions.entityId ?? fact.dimensions.scopeId ?? identity.scopeId;
  return [{
    identity: {
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
    },
    evidenceRef: fact.id,
    entityId,
    metricId: fact.metricId,
    value: fact.value,
    unit: fact.unit,
  }];
});

const collectCatalogCentreCodes = (catalog: AnalysisContextEvidenceCatalog): string[] => [...new Set(
  catalog.facts.flatMap(({ dimensions }) => Object.entries(dimensions).flatMap(([key, value]) => {
    if (key === "centreCode") return [value];
    if (key === "centreCodes") return value.split(/[\s,;|]+/u);
    return [];
  }))
    .map((code) => code.trim())
    .filter((code) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/u.test(code)),
)];

const sameStringOrder = (left: readonly string[], right: readonly unknown[]): boolean => left.length === right.length
  && left.every((value, index) => value === right[index]);

const alertIsAcceptable = (
  value: unknown,
  epistemicStatus: "observed" | "inferred" | "speculative",
  evidenceRefs: string[],
  factsById: Map<string, AnalysisContextEvidenceCatalog["facts"][number]>,
): boolean => {
  if (value === undefined) return true;
  if (!isRecord(value)
    || !hasExactKeys(value, ["severity", "certainty", "evidenceRefs"])
    || (value.severity !== "attention" && value.severity !== "urgent")
    || (value.certainty !== "confirmed" && value.certainty !== "anomaly" && value.certainty !== "possible")
    || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length === 0
    || !uniqueStrings(value.evidenceRefs)
    || value.evidenceRefs.some((ref) => !evidenceRefs.includes(ref))) return false;
  const facts = value.evidenceRefs.map((ref) => factsById.get(ref)!);
  const allConfirmed = facts.every(({ status }) => status === "confirmed");
  if (value.severity === "urgent" && (epistemicStatus !== "observed" || value.certainty !== "confirmed" || !allConfirmed)) {
    return false;
  }
  if (value.certainty === "confirmed" && (epistemicStatus !== "observed" || !allConfirmed)) return false;
  return value.certainty !== "anomaly" || epistemicStatus !== "speculative";
};

const buildDiscoveryPrompt = (input: {
  identity: ProjectAdditionalAiInsightArtifactIdentity;
  catalog: AnalysisContextEvidenceCatalog;
  presentedClaims: PreschoolAdditionalAiPresentedClaims;
  methodResources: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["resources"];
  productLabel: string;
  entityGuidance: string;
}): string => {
  const nativeSubmission = input.identity.rendererKey === "preschool-overview"
    && input.identity.identityContractRevision === "additional-insights-v24";
  const candidateShape = "{candidates:[{id,title,observation,angle,epistemicStatus:'observed|inferred|speculative',origin:{kind:'ai-discovery|expert-sop|hybrid',directionMethodResourceIds:[exact server-approved Method resourceId],novelContribution?:string},incrementalContext:{relatedPresentedClaimIds:[exact claim id],novelConclusion:string},evidenceRefs:[exact fact id],toolAuditIds:[actual returned audit id],deepDiveQuestion?,alert?,canvas?}]}";
  const prompt = [
    `You are the Additional AI Insights discovery stage for ${input.productLabel}.`,
    ...input.methodResources.map(({ method, content }) => [
      `Server-approved Method ${method.role} ${method.resourceId}@${method.resourceRevision}:`,
      content,
    ].join("\n")),
    ...(nativeSubmission
      ? [
          `Call energyiq_additional_insights_submit once with the final Candidate envelope shaped as ${candidateShape}.`,
          "After a successful submission, stop immediately and do not emit the Candidate envelope as Assistant text. If the tool rejects only the root envelope, correct it once and resubmit the complete envelope.",
        ]
      : [
          `Return JSON only: ${candidateShape}.`,
          "The first character must be { and the last character must be }. Do not add a preamble, scratch work, Markdown fence, or trailing commentary.",
        ]),
    "Each title must be 100 characters or fewer. toolAuditIds is required; use [] when no tool was called. When a tool was called, cite only succeeded audit IDs actually used by that candidate. Every cited audit must overlap the candidate Evidence; the candidate may additionally cite exact Current Catalog Evidence that was not returned by that audit because the server validates every Evidence ref independently.",
    "For page readability, observation should be one short Evidence-backed sentence. angle should be 1 to 2 short sentences and no more than 500 characters. deepDiveQuestion should be one short question and no more than 200 characters. These are generation instructions; the server keeps its wider safety ceiling for local candidate isolation.",
    `Separate correctness from exploration. observation states only facts directly supported by the candidate Evidence. angle states the genuinely useful relationship, counterexample, hypothesis, or low-risk experiment. An inferred or speculative angle may freely interpret cited facts and ${input.entityGuidance} and may go beyond what the Evidence proves, but it must use transparent possibility language and must not introduce uncited precise numbers, uncited named entities, dates, confirmed causes, savings, or outcomes.`,
    "ai-discovery must contain exactly kind and directionMethodResourceIds, with directionMethodResourceIds=[]. Do not add novelContribution to ai-discovery. If alert cannot match the exact object shape {severity:'attention|urgent',certainty:'confirmed|anomaly|possible',evidenceRefs:[exact candidate Evidence ref]}, omit it.",
    "A relationship across multiple Evidence facts cannot be observed; label it inferred or speculative. Do not calculate or state new numeric values that are not directly present in the candidate's cited Evidence. Qualitative relationships, counterexamples, possible mechanisms, and testable hypotheses are valuable and remain valid even when the Evidence does not confirm the explanation.",
    "For core-only discovery use origin.kind='ai-discovery' and directionMethodResourceIds=[]. Cite only the exact loaded expert-direction resourceIds actually used. expert-sop requires one or more such refs. hybrid additionally requires a concise bounded novelContribution. Never invent or duplicate Method refs.",
    "Optional canvas must be an energyiq-insight-canvas plan using only quantitative metric, comparison, or trend blocks bound exactly to supplied Evidence facts. The server may reject blocks locally without rejecting the Finding.",
    "Candidates must already be ordered from highest to lowest incremental value. Zero candidates is valid.",
    "Use the structured already-presented claim digests below. Their sourceEvidenceRefs preserve source provenance and are not candidate Evidence authority. Cite exact related claim IDs and state only the genuinely new conclusion; write novelConclusion as a concise conclusion that is actually present in title or angle. A title or observation may repeat a factual baseline when the angle adds that new conclusion. Related claims need not share an Evidence namespace with the candidate. Candidate evidenceRefs must still be exact IDs from the Current authoritative Evidence Catalog. A restatement is not a candidate; the same or different Evidence may support a new relationship, counterexample, or testable hypothesis.",
    `Server-owned identity: ${JSON.stringify({
      workspaceId: input.identity.workspaceId,
      projectId: input.identity.projectId,
      scopeId: input.identity.scopeId,
      dataSnapshotId: input.identity.dataSnapshotId,
      projectReleaseId: input.identity.projectReleaseId,
      analysisPeriod: { from: input.identity.analysisPeriodFrom, to: input.identity.analysisPeriodTo },
      modelProfileId: input.identity.modelProfileId,
      modelProfileRevision: input.identity.modelProfileRevision,
    })}`,
    `Current authoritative Evidence Catalog: ${JSON.stringify({
      contract: input.catalog.contract,
      sourceId: input.catalog.sourceId,
      pins: input.catalog.pins,
      facts: input.catalog.facts.map(({ evidenceRefs: _sourceRefs, ...fact }) => fact),
    })}`,
    `Already-presented claim digests: ${JSON.stringify(input.presentedClaims.claims)}`,
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS) {
    throw new Error(`PRESCHOOL_ADDITIONAL_AI_DISCOVERY_PROMPT_TOO_LARGE:${prompt.length}`);
  }
  return prompt;
};

const requireMethodResources = (
  methodSet: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>,
) => {
  if (methodSet.resources.length !== methodSet.methods.length
    || methodSet.resources.some(({ method, content }) => (
      !methodSet.methods.some((candidate) => candidate === method)
      || !nonEmptyString(content)
      || createHash("sha256").update(content).digest("hex") !== method.contentSha256
    ))
    || methodSet.resources[0]?.content !== ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_METHOD_RESOURCE_INVALID");
  }
  return methodSet;
};

const requirePresentedClaims = (
  value: PreschoolAdditionalAiPresentedClaims,
  identity: ProjectAdditionalAiInsightArtifactIdentity,
): PreschoolAdditionalAiPresentedClaims => {
  const expected = {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
  };
  if (!isRecord(value)
    || JSON.stringify(value.binding) !== JSON.stringify(expected)
    || !Array.isArray(value.claims)
    || !uniqueStrings(value.claims.map(({ id }) => id))
    || value.claims.some((claim) => !presentedClaimIsValid(claim))) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_PRESENTED_CLAIMS_INVALID");
  }
  return value;
};

const presentedClaimIsValid = (value: unknown): value is PreschoolAdditionalAiPresentedClaim => {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.text)
    || !Array.isArray(value.sourceEvidenceRefs)
    || value.sourceEvidenceRefs.length === 0
    || !uniqueStrings(value.sourceEvidenceRefs)) return false;
  if (value.source === "deterministic-overview") {
    return hasExactKeys(value, ["id", "source", "text", "sourceEvidenceRefs"])
      && value.sourceEvidenceRefs.length === 1
      && value.id === `deterministic-overview:${value.sourceEvidenceRefs[0]}`;
  }
  if (value.source === "key-finding") {
    return hasExactKeys(value, ["id", "source", "artifactId", "text", "sourceEvidenceRefs"])
      && nonEmptyString(value.artifactId);
  }
  if (value.source === "section-summary" || value.source === "section-insight") {
    return hasExactKeys(value, ["id", "source", "sectionId", "artifactId", "text", "sourceEvidenceRefs"])
      && nonEmptyString(value.sectionId)
      && nonEmptyString(value.artifactId);
  }
  return false;
};

const canonicalClaimText = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase("en")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const CLAIM_FUNCTION_WORDS = new Set([
  "a", "an", "and", "at", "by", "during", "for", "from", "in", "is", "of", "on", "the", "to", "was",
]);

const meaningfulClaimTokens = (value: string): Set<string> => new Set(canonicalClaimText(value).split(" ")
  .filter((token) => token.length > 1 && !CLAIM_FUNCTION_WORDS.has(token)));

const claimTextsShareMeaningfulToken = (left: string, right: string): boolean => {
  const leftTokens = meaningfulClaimTokens(left);
  return [...meaningfulClaimTokens(right)].some((token) => leftTokens.has(token));
};

const resolveSeparatedCandidateNarrative = (input: {
  observation: unknown;
  angle: unknown;
  observationIsSupported(narrative: string): boolean;
  angleIsSupported(narrative: string): boolean;
}): {
  observation: string;
  angle: string;
  publishedText: string;
  noveltyText: string;
  epistemicText: string;
} | null => {
  if (!nonEmptyString(input.observation)
    || !nonEmptyString(input.angle)) return null;
  const observation = salvageSupportedNarrative(input.observation, input.observationIsSupported);
  const angle = salvageSupportedNarrative(input.angle, input.angleIsSupported);
  if (!observation || !angle) return null;
  return {
    observation,
    angle,
    publishedText: `**Evidence signal:** ${observation}\n\n**AI angle:** ${angle}`,
    noveltyText: `${observation} ${angle}`,
    epistemicText: angle,
  };
};

const resolveSupportedCandidateTitle = (input: {
  title: string;
  incrementalContext: unknown;
  fallbackObservation: string;
  fallbackAngle: string;
  preferAngleFallback: boolean;
  narrativeIsSupported(narrative: string): boolean;
}): { text: string; repairedFromObservation: boolean } | null => {
  const fallbackTitle = (): { text: string; repairedFromObservation: true } | null => {
    const angleTitle = input.preferAngleFallback
      ? conciseTitleFromAcceptedAngle(input.fallbackAngle)
      : null;
    if (angleTitle) return { text: angleTitle, repairedFromObservation: true };
    return conciseSummaryTitle(input.fallbackObservation)
      ? { text: input.fallbackObservation, repairedFromObservation: true }
      : null;
  };
  const title = input.title.trim();
  if (input.narrativeIsSupported(title)) return { text: title, repairedFromObservation: false };
  if (!isRecord(input.incrementalContext)
    || !conciseSummaryTitle(input.incrementalContext.novelConclusion)) {
    return fallbackTitle();
  }
  const novelConclusion = input.incrementalContext.novelConclusion.trim();
  if (input.narrativeIsSupported(novelConclusion)) {
    return { text: novelConclusion, repairedFromObservation: false };
  }
  return fallbackTitle();
};

const conciseTitleFromAcceptedAngle = (angle: string): string | null => {
  const firstSentence = angle.trim().split(/(?<=[.!?])\s+/u)[0]
    ?.replace(/[.!?]+$/u, "")
    .trim();
  if (!firstSentence) return null;
  const firstClause = firstSentence.split(/\s+(?:and|but|while|whereas)\s+|,\s*(?:and|but|while|whereas)\s+/iu)[0]
    ?.trim();
  if (conciseSummaryTitle(firstSentence)) return firstSentence;
  if (firstClause && firstClause.length >= 24 && conciseSummaryTitle(firstClause)) return firstClause;
  return null;
};

const salvageSupportedNarrative = (
  narrative: string,
  narrativeIsSupported: (value: string) => boolean,
): string | null => {
  const trimmed = narrative.trim();
  const deduplicated = deduplicateRepeatedSentences(trimmed);
  if (deduplicated !== trimmed && narrativeIsSupported(deduplicated)) return deduplicated;
  if (narrativeIsSupported(trimmed)) return trimmed;
  const withoutUnsupportedParentheticals = trimmed
    .replace(/\s*\(([^()\r\n]{1,200})\)/gu, (segment, content: string) =>
      narrativeIsSupported(content.trim()) ? segment : "")
    .replace(/\s+([.!?,])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
  if (withoutUnsupportedParentheticals !== trimmed
    && narrativeIsSupported(withoutUnsupportedParentheticals)) return withoutUnsupportedParentheticals;
  const fragments = [...new Set([trimmed, withoutUnsupportedParentheticals])]
    .flatMap((variant) => variant.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u))
    .flatMap((sentence) => sentence.split(/\s*;\s*|,\s*(?=(?:but|while|whereas|however)\b)/iu))
    .map((fragment) => fragment.trim().replace(/^(?:but|while|whereas|however)\s+/iu, ""))
    .filter((fragment) => fragment.length > 0 && narrativeIsSupported(fragment))
    .map((fragment) => /[.!?]$/u.test(fragment) ? fragment : `${fragment}.`);
  return fragments.length > 0 ? fragments.join(" ") : null;
};

const deduplicateRepeatedSentences = (value: string): string => {
  const seen = new Set<string>();
  return value.split(/(?<=[.!?])\s+/u)
    .filter((sentence) => {
      const canonical = canonicalClaimText(sentence);
      if (!canonical || seen.has(canonical)) return false;
      seen.add(canonical);
      return true;
    })
    .join(" ");
};

const narrativeContainsConclusion = (narrative: string, conclusion: string): boolean => {
  const canonicalNarrative = canonicalClaimText(narrative);
  const canonicalConclusion = canonicalClaimText(conclusion);
  if (canonicalNarrative.includes(canonicalConclusion)) return true;
  const conclusionTokens = meaningfulClaimTokens(conclusion);
  if (conclusionTokens.size < 4) return false;
  const narrativeTokens = meaningfulClaimTokens(narrative);
  const shared = [...conclusionTokens].filter((token) => narrativeTokens.has(token)).length;
  return shared / conclusionTokens.size >= 0.75;
};

const claimTextIsRestatement = (presented: string, proposed: string): boolean => {
  const left = canonicalClaimText(presented);
  const right = canonicalClaimText(proposed);
  if (left === right) return true;
  const leftTokens = meaningfulClaimTokens(left);
  const rightTokens = meaningfulClaimTokens(right);
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (smaller < 4) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const larger = Math.max(leftTokens.size, rightTokens.size);
  return shared / union >= 0.6 && smaller / larger >= 0.65;
};

const boundedErrorCode = (error: unknown): string => {
  const value = error instanceof Error ? error.message : "PRESCHOOL_ADDITIONAL_AI_FAILED";
  return /^[A-Z0-9_:.-]{1,160}$/u.test(value) ? value : "PRESCHOOL_ADDITIONAL_AI_FAILED";
};

const boundedSafeText = (value: unknown, max: number): value is string => nonEmptyString(value)
  && value.length <= max
  && !/(?:<\/?[a-z]|https?:\/\/|javascript:)/iu.test(value);

const conciseSummaryTitle = (value: unknown): value is string =>
  boundedSafeText(value, PRESCHOOL_ADDITIONAL_INSIGHT_TITLE_MAX_CHARS)
  && !/[;\r\n]/u.test(value)
  && !/[.!?]\s+\S/u.test(value.trim());

const optionalBoundedSafeText = (value: unknown, max: number): boolean =>
  value === undefined || boundedSafeText(value, max);

const uniqueStrings = (values: readonly unknown[]): values is string[] =>
  values.every(nonEmptyString) && new Set(values).size === values.length;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && /\S/u.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).length === expected.length && expected.every((key) => key in value);

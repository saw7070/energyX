import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  acceptAiSlotHtmlArtifact,
  type AiSlotHtmlArtifact,
  type AiSlotHtmlArtifactIdentity,
} from "@datafoundry/contracts";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import {
  overviewAiArtifactPinnedLocalPeriod,
  overviewAiArtifactIdentityFromSnapshot,
  resolveCurrentOverviewAiArtifactIdentity,
  requirePreschoolHtmlAiSlotModelRuntimeIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";
import {
  createPreschoolHtmlAiSlotGenerator,
  PRESCHOOL_HTML_AI_SLOT_IDS,
  PRESCHOOL_HTML_AI_SLOT_PROMPT_REVISION,
  PRESCHOOL_HTML_AI_SLOT_VALIDATOR_REVISION,
  isPreschoolHtmlAiSlotGenerationError,
  type PreschoolHtmlAiSlotGenerationSummary,
  type PreschoolHtmlAiSlotId,
  type PreschoolHtmlAiSlotDefinition,
  type PreschoolHtmlAiSlotFactAcceptance,
  type PreschoolHtmlAiSlotRunner,
} from "./preschool-html-ai-slot.js";
import { createProjectAnalysisContextEvidenceCatalog } from "./project-analysis-context-evidence.js";
import {
  readCurrentProjectOverviewSnapshotWithLifecycle,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import { assemblePreschoolSectionPacksV2, type PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";

const HTML_SLOT_ANALYSIS_PACK_ID = "preschool-html-ai-slot-pack";
const HTML_SLOT_ANALYSIS_PACK_REVISION = "v1";
const HTML_SLOT_WORKFLOW_REVISION = "preschool-html-ai-slot-workflow@11";
const HTML_SLOT_IDENTITY_CONTRACT_REVISION = "html-slot-v1";
const HTML_SLOT_CAPABILITY_REVISION = "static-html-sandbox-v7";
const HTML_SLOT_PUBLICATION_REVISION = "html-slot-v1";
const HTML_SLOT_GOVERNANCE_DEFAULTS = {
  skillId: "energyiq-evidence-first",
  skillRevision: "1",
  methodId: "preschool-html-slot-method",
  methodRevision: "1",
  contextRevision: "preschool-html-slot-context@2",
  toolPolicyRevision: "none@1",
  outputContractRevision: "energyiq-ai-slot-html-artifact@1",
  validatorRevision: PRESCHOOL_HTML_AI_SLOT_VALIDATOR_REVISION,
  presentationReferenceRevision: "preschool-html-slot-presentation@1",
} as const;
const HTML_SLOT_WORKER_LEASE_MS = 13 * 60 * 1_000;

export type PreschoolHtmlAiSlotArtifactResult = {
  status: "available";
  artifactKind: "html-slot";
  slotId: PreschoolHtmlAiSlotId;
  identity: AiSlotHtmlArtifactIdentity;
  artifact: AiSlotHtmlArtifact;
  evidenceRefs: string[];
  acceptance: PreschoolHtmlAiSlotFactAcceptance;
  runId: string;
  sessionId: string;
  generation: {
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    htmlSha256: string;
  };
};

export type PreschoolHtmlAiSlotReadModel = {
  artifactKind: "preschool-html-ai-slot-read-model";
  status: "available" | "missing";
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    reportTimePolicyId?: string;
    reportTimePolicyRevision?: string;
    reportTimeContextFingerprint?: string;
    modelProfileId: string;
    modelProfileRevision: number;
    promptRevision: string;
    slotDefinitionRevisions: Record<PreschoolHtmlAiSlotId, string>;
    allowedEvidenceRefsBySlot: Record<PreschoolHtmlAiSlotId, string[]>;
  };
  slots: Record<PreschoolHtmlAiSlotId, {
    status: "queued" | "running" | "available" | "failed" | "missing";
    artifactId?: string;
    runId?: string;
    sessionId?: string;
    artifact?: AiSlotHtmlArtifact;
    acceptance?: PreschoolHtmlAiSlotFactAcceptance;
    errorCode?: string;
    generation?: {
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      htmlSha256?: string;
    };
  }>;
};

export type PreschoolHtmlAiSlotWorkflow = {
  resolvePublishedIdentity(input: {
    snapshot: ProjectAnalysisSnapshot;
  }): OverviewAiArtifactIdentityV13;
  resolveReadIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
    pin: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
  }): Promise<OverviewAiArtifactIdentityV13>;
  resolveCurrentIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
  }): Promise<OverviewAiArtifactIdentityV13>;
  read(input: { identity: EnergyIqOverviewAiArtifactIdentity; user: UserRecord }): Promise<PreschoolHtmlAiSlotReadModel>;
  execute(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
    slotId?: PreschoolHtmlAiSlotId;
    snapshot?: ProjectAnalysisSnapshot;
  }): Promise<PreschoolHtmlAiSlotReadModel>;
};

export const createPreschoolHtmlAiSlotWorkflow = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runSlot: PreschoolHtmlAiSlotRunner;
  resolveSnapshot?: (args: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }) => Promise<ProjectAnalysisSnapshot>;
}): PreschoolHtmlAiSlotWorkflow => {
  const resolveSnapshot = input.resolveSnapshot ?? (async ({ identity, user }) => {
    const project = input.metadataStore.energyIq.getProject(identity.projectId);
    const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
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
  const generator = createPreschoolHtmlAiSlotGenerator({ runSlot: input.runSlot });

  return {
    resolvePublishedIdentity: ({ snapshot }) => overviewAiArtifactIdentityFromSnapshot({
      snapshot,
      modelBinding: input.metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID),
    }),
    resolveReadIdentity: ({ projectId, scopeId, user, pin }) => resolveCurrentOverviewAiArtifactIdentity({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      projectId,
      scopeId,
      user,
      ...(pin ? { pin } : {}),
    }),
    resolveCurrentIdentity: ({ projectId, scopeId, user, pin }) => resolveCurrentOverviewAiArtifactIdentity({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      projectId,
      scopeId,
      user,
      ...(pin ? { pin } : {}),
    }),
    async read({ identity, user }) {
      const baseIdentity = requireBaseIdentity(identity);
      const definitions = requirePublishedSlotDefinitions(input.metadataStore, baseIdentity);
      const snapshot = await resolveSnapshot({ identity: baseIdentity, user });
      const packs = assemblePreschoolSectionPacksV2({ identity: baseIdentity, snapshot });
      const catalog = createProjectAnalysisContextEvidenceCatalog(snapshot);
      return readSlots(input.metadataStore, baseIdentity, definitions, collectAllowedEvidenceRefsBySlot(packs, catalog));
    },
    async execute({ identity, user, slotId: requestedSlotId, snapshot: publishedSnapshot }) {
      const baseIdentity = requireBaseIdentity(identity);
      requirePreschoolHtmlAiSlotModelRuntimeIdentity(input.metadataStore, baseIdentity);
      const definitions = requirePublishedSlotDefinitions(input.metadataStore, baseIdentity);
      const snapshot = publishedSnapshot ?? await resolveSnapshot({ identity: baseIdentity, user });
      const packs = assemblePreschoolSectionPacksV2({ identity: baseIdentity, snapshot });
      const catalog = createProjectAnalysisContextEvidenceCatalog(snapshot);
      const allowedEvidenceRefsBySlot = collectAllowedEvidenceRefsBySlot(packs, catalog);
      const slotIds = requestedSlotId ? [requestedSlotId] : PRESCHOOL_HTML_AI_SLOT_IDS;
      for (const slotId of slotIds) {
        const slotIdentity = createHtmlSlotIdentity(baseIdentity, slotId, definitions[slotId]);
        const queued = input.metadataStore.energyIq.overviewAiArtifacts.queue({
          identity: slotIdentity,
          triggeredBy: user.id,
        });
        if (queued.status === "available") continue;
        const claim = input.metadataStore.energyIq.overviewAiArtifacts.claim({
          identity: slotIdentity,
          workerId: `preschool-html-slot-worker-${randomUUID()}`,
          leaseMs: HTML_SLOT_WORKER_LEASE_MS,
        });
        if (!claim.claimed) continue;
        const htmlIdentity = toHtmlIdentity(slotIdentity);
        try {
          const generated = await generator.generate({
            definition: definitions[slotId],
            identity: htmlIdentity,
            runtimeIdentity: slotIdentity,
            context: buildSlotContext(
              slotId,
              snapshot,
              packs,
              catalog,
              allowedEvidenceRefsBySlot[slotId],
            ),
            allowedEvidenceRefs: allowedEvidenceRefsBySlot[slotId],
            user,
            workspaceId: baseIdentity.workspaceId,
          });
          const result: PreschoolHtmlAiSlotArtifactResult = {
            status: "available",
            artifactKind: "html-slot",
            slotId,
            identity: htmlIdentity,
            artifact: generated.artifact,
            evidenceRefs: generated.artifact.evidenceRefs,
            acceptance: generated.acceptance,
            runId: generated.runId,
            sessionId: generated.sessionId,
            generation: {
              latencyMs: generated.latencyMs ?? 0,
              ...(generated.inputTokens === undefined ? {} : { inputTokens: generated.inputTokens }),
              ...(generated.outputTokens === undefined ? {} : { outputTokens: generated.outputTokens }),
              htmlSha256: createHash("sha256").update(generated.artifact.html).digest("hex"),
            },
          };
          input.metadataStore.energyIq.overviewAiArtifacts.complete({
            identity: slotIdentity,
            workerId: claim.artifact.lease_owner!,
            sessionId: generated.sessionId,
            runId: generated.runId,
            resultJson: JSON.stringify(result),
            allowedEvidenceRefs: allowedEvidenceRefsBySlot[slotId],
          });
        } catch (error) {
          const generationFailure = isPreschoolHtmlAiSlotGenerationError(error) ? error : undefined;
          const failureResultJson = generationFailure
            ? JSON.stringify({
                status: "failed",
                artifactKind: "html-slot",
                slotId,
                runId: generationFailure.runId,
                sessionId: generationFailure.sessionId,
                generation: generationFailure.generation,
              })
            : undefined;
          input.metadataStore.energyIq.overviewAiArtifacts.fail({
            identity: slotIdentity,
            workerId: claim.artifact.lease_owner!,
            errorCode: htmlSlotErrorCode(error),
            ...(generationFailure ? {
              runId: generationFailure.runId,
              sessionId: generationFailure.sessionId,
              ...(failureResultJson === undefined ? {} : { resultJson: failureResultJson }),
            } : {}),
          });
        }
      }
      return readSlots(input.metadataStore, baseIdentity, definitions, allowedEvidenceRefsBySlot);
    },
  };
};

const requireBaseIdentity = (identity: EnergyIqOverviewAiArtifactIdentity): OverviewAiArtifactIdentityV13 => {
  if (identity.projectId !== "preschool-demo"
    || identity.rendererKey !== "preschool-overview"
    || identity.resource !== "electricity"
    || identity.artifactKind !== undefined
    || identity.slotDefinitionRevision !== undefined) {
    throw new Error("PRESCHOOL_OVERVIEW_AI_IDENTITY_INVALID");
  }
  return identity as OverviewAiArtifactIdentityV13;
};

const createHtmlSlotIdentity = (
  baseIdentity: OverviewAiArtifactIdentityV13,
  slotId: PreschoolHtmlAiSlotId,
  definition: PreschoolHtmlAiSlotDefinition,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...baseIdentity,
  artifactKind: "html-slot",
  targetId: slotId,
  slotDefinitionRevision: definition.revision,
  identityContractRevision: HTML_SLOT_IDENTITY_CONTRACT_REVISION,
  analysisPackId: HTML_SLOT_ANALYSIS_PACK_ID,
  analysisPackRevision: HTML_SLOT_ANALYSIS_PACK_REVISION,
  outputContractRevision: definition.outputContractRevision,
  validatorRevision: definition.validatorRevision,
  workflowRevision: HTML_SLOT_WORKFLOW_REVISION,
  investigatorPromptRevision: PRESCHOOL_HTML_AI_SLOT_PROMPT_REVISION,
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: `${definition.skillId}/${definition.methodId}`,
  methodSkillRevision: `${definition.skillRevision}/${definition.methodRevision}`,
  capabilityRevision: HTML_SLOT_CAPABILITY_REVISION,
  publicationRevision: HTML_SLOT_PUBLICATION_REVISION,
});

const toHtmlIdentity = (identity: EnergyIqOverviewAiArtifactIdentity): AiSlotHtmlArtifactIdentity => ({
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
  ...(identity.reportTimePolicyId && identity.reportTimePolicyRevision && identity.reportTimeContextFingerprint
    ? {
        reportTimePolicyId: identity.reportTimePolicyId,
        reportTimePolicyRevision: identity.reportTimePolicyRevision,
        reportTimeContextFingerprint: identity.reportTimeContextFingerprint,
      }
    : {}),
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
  promptRevision: identity.investigatorPromptRevision,
  slotDefinitionRevision: identity.slotDefinitionRevision!,
});

const readSlots = (
  metadataStore: MetadataStore,
  baseIdentity: OverviewAiArtifactIdentityV13,
  definitions: Record<PreschoolHtmlAiSlotId, PreschoolHtmlAiSlotDefinition>,
  allowedEvidenceRefsBySlot: Record<PreschoolHtmlAiSlotId, readonly string[]>,
): PreschoolHtmlAiSlotReadModel => {
  const slots = Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => {
    const identity = createHtmlSlotIdentity(baseIdentity, slotId, definitions[slotId]);
    const record = metadataStore.energyIq.overviewAiArtifacts.find(identity);
    const stored = record?.status === "available" && record.result_json
      ? parseStoredResult(record.result_json, identity, allowedEvidenceRefsBySlot[slotId])
      : undefined;
    const storedFailure = record?.status === "failed" && record.result_json
      ? parseStoredFailure(record.result_json, identity)
      : undefined;
    return [slotId, {
      status: record?.status ?? "missing",
      ...(record ? { artifactId: record.id } : {}),
      ...(record?.run_id ? { runId: record.run_id } : {}),
      ...(record?.session_id ? { sessionId: record.session_id } : {}),
      ...(stored?.artifact ? { artifact: stored.artifact } : {}),
      ...(stored?.acceptance ? { acceptance: stored.acceptance } : {}),
      ...(stored?.generation ? { generation: stored.generation } : {}),
      ...(storedFailure?.generation ? { generation: storedFailure.generation } : {}),
      ...(record?.error_code ? { errorCode: record.error_code } : {}),
    }];
  })) as PreschoolHtmlAiSlotReadModel["slots"];
  const status = Object.values(slots).every((slot) => slot.status === "missing") ? "missing" : "available";
  return {
    artifactKind: "preschool-html-ai-slot-read-model",
    status,
    binding: {
      workspaceId: baseIdentity.workspaceId,
      projectId: baseIdentity.projectId,
      scopeId: baseIdentity.scopeId,
      dataSnapshotId: baseIdentity.dataSnapshotId,
      projectReleaseId: baseIdentity.projectReleaseId,
      analysisPeriod: { from: baseIdentity.analysisPeriodFrom, to: baseIdentity.analysisPeriodTo },
      ...(baseIdentity.reportTimePolicyId && baseIdentity.reportTimePolicyRevision && baseIdentity.reportTimeContextFingerprint
        ? {
            reportTimePolicyId: baseIdentity.reportTimePolicyId,
            reportTimePolicyRevision: baseIdentity.reportTimePolicyRevision,
            reportTimeContextFingerprint: baseIdentity.reportTimeContextFingerprint,
          }
        : {}),
      modelProfileId: baseIdentity.modelProfileId,
      modelProfileRevision: baseIdentity.modelProfileRevision,
      promptRevision: PRESCHOOL_HTML_AI_SLOT_PROMPT_REVISION,
      slotDefinitionRevisions: Object.fromEntries(
        PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, definitions[slotId].revision]),
      ) as Record<PreschoolHtmlAiSlotId, string>,
      allowedEvidenceRefsBySlot: Object.fromEntries(
        PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, [...allowedEvidenceRefsBySlot[slotId]]]),
      ) as Record<PreschoolHtmlAiSlotId, string[]>,
    },
    slots,
  };
};

const parseStoredResult = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
  allowedEvidenceRefs: readonly string[],
): PreschoolHtmlAiSlotArtifactResult | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)
      || parsed.status !== "available"
      || parsed.artifactKind !== "html-slot"
      || parsed.slotId !== identity.targetId
      || !nonEmptyString(parsed.runId)
      || !nonEmptyString(parsed.sessionId)
      || !Array.isArray(parsed.evidenceRefs)
      || !parsed.evidenceRefs.every(nonEmptyString)) return undefined;
    const acceptance = acceptAiSlotHtmlArtifact({
      candidate: parsed.artifact,
      expected: { slotId: identity.targetId!, identity: toHtmlIdentity(identity) },
      allowedEvidenceRefs,
    });
    if (!acceptance.accepted || !sameStringArray(acceptance.artifact.evidenceRefs, parsed.evidenceRefs as string[])) return undefined;
    const claimAcceptance = parseClaimAcceptance(parsed.acceptance);
    const generation = parseStoredGeneration(parsed.generation, acceptance.artifact.html);
    if (claimAcceptance === undefined || generation === undefined) return undefined;
    return {
      ...(parsed as unknown as PreschoolHtmlAiSlotArtifactResult),
      acceptance: claimAcceptance,
      generation,
    };
  } catch {
    return undefined;
  }
};

const parseClaimAcceptance = (value: unknown): PreschoolHtmlAiSlotFactAcceptance | undefined => {
  if (!isRecord(value)
    || (value.status !== "accepted" && value.status !== "accepted_with_warnings")
    || !Array.isArray(value.droppedClaims)
    || !value.droppedClaims.every((claim) => isRecord(claim)
      && typeof claim.blockId === "string"
      && Boolean(claim.blockId.trim())
      && (claim.reason === "unsupported-fact"
        || claim.reason === "unsupported-causal-claim"
        || claim.reason === "unsupported-evidence-ref"
        || claim.reason === "empty-structure"))
    || (value.status === "accepted" && value.droppedClaims.length !== 0)
    || (value.status === "accepted_with_warnings" && value.droppedClaims.length === 0)) return undefined;
  return value as unknown as PreschoolHtmlAiSlotFactAcceptance;
};

const parseStoredGeneration = (
  value: unknown,
  html: string,
): (Omit<PreschoolHtmlAiSlotGenerationSummary, "htmlSha256"> & { htmlSha256: string }) | undefined => {
  if (!isRecord(value)
    || typeof value.latencyMs !== "number"
    || !Number.isFinite(value.latencyMs)
    || value.latencyMs < 0
    || (value.inputTokens !== undefined && (typeof value.inputTokens !== "number"
      || !Number.isSafeInteger(value.inputTokens) || value.inputTokens < 0))
    || (value.outputTokens !== undefined && (typeof value.outputTokens !== "number"
      || !Number.isSafeInteger(value.outputTokens) || value.outputTokens < 0))
    || typeof value.htmlSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.htmlSha256)
    || createHash("sha256").update(html).digest("hex") !== value.htmlSha256) return undefined;
  return {
    latencyMs: value.latencyMs,
    ...(value.inputTokens === undefined ? {} : { inputTokens: value.inputTokens }),
    ...(value.outputTokens === undefined ? {} : { outputTokens: value.outputTokens }),
    htmlSha256: value.htmlSha256,
  };
};

const parseStoredFailure = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): { runId: string; sessionId: string; generation: PreschoolHtmlAiSlotGenerationSummary } | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)
      || parsed.status !== "failed"
      || parsed.artifactKind !== "html-slot"
      || parsed.slotId !== identity.targetId
      || !nonEmptyString(parsed.runId)
      || !nonEmptyString(parsed.sessionId)
      || !isRecord(parsed.generation)
      || typeof parsed.generation.latencyMs !== "number"
      || !Number.isFinite(parsed.generation.latencyMs)
      || (parsed.generation.inputTokens !== undefined && typeof parsed.generation.inputTokens !== "number")
      || (parsed.generation.outputTokens !== undefined && typeof parsed.generation.outputTokens !== "number")
      || (parsed.generation.htmlSha256 !== undefined
        && (typeof parsed.generation.htmlSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(parsed.generation.htmlSha256)))) {
      return undefined;
    }
    return {
      runId: parsed.runId,
      sessionId: parsed.sessionId,
      generation: parsed.generation as unknown as PreschoolHtmlAiSlotGenerationSummary,
    };
  } catch {
    return undefined;
  }
};

const requirePublishedSlotDefinitions = (
  metadataStore: MetadataStore,
  baseIdentity: OverviewAiArtifactIdentityV13,
): Record<PreschoolHtmlAiSlotId, PreschoolHtmlAiSlotDefinition> => {
  const revision = metadataStore.energyIq.overviewDefinitions.get(baseIdentity.projectReleaseId);
  const definitions = revision?.definition.aiSlots;
  if (!definitions || definitions.length !== PRESCHOOL_HTML_AI_SLOT_IDS.length) {
    throw new Error("PRESCHOOL_OVERVIEW_AI_SLOT_DEFINITIONS_MISSING");
  }
  const byId = Object.fromEntries(definitions.map((definition) => [definition.slotId, definition])) as Record<string, PreschoolHtmlAiSlotDefinition>;
  for (const slotId of PRESCHOOL_HTML_AI_SLOT_IDS) {
    const definition = byId[slotId];
    if (!definition || !definition.revision) throw new Error("PRESCHOOL_OVERVIEW_AI_SLOT_DEFINITIONS_MISSING");
    if (definition.validatorRevision !== PRESCHOOL_HTML_AI_SLOT_VALIDATOR_REVISION) {
      throw new Error("PRESCHOOL_HTML_AI_SLOT_DEFINITION_VALIDATOR_STALE");
    }
    if (definition.contextRevision !== HTML_SLOT_GOVERNANCE_DEFAULTS.contextRevision) {
      throw new Error("PRESCHOOL_HTML_AI_SLOT_DEFINITION_CONTEXT_STALE");
    }
    if (!definition.skillId
      || !definition.skillRevision
      || !definition.methodId
      || !definition.methodRevision
      || !definition.toolPolicyRevision
      || !definition.outputContractRevision
      || !definition.presentationReferenceRevision) {
      throw new Error("PRESCHOOL_HTML_AI_SLOT_DEFINITION_BINDINGS_MISSING");
    }
  }
  // This current generator accepts only the bindings published by the current
  // Release. Earlier Releases are not rebound to newer Context/Validator code;
  // the Overview falls back to its structured presentation for those identities.
  return Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => (
    [slotId, byId[slotId]!]
  ))) as Record<PreschoolHtmlAiSlotId, PreschoolHtmlAiSlotDefinition>;
};

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

const sameStringArray = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const buildSlotContext = (
  slotId: PreschoolHtmlAiSlotId,
  snapshot: ProjectAnalysisSnapshot,
  packs: readonly PreschoolSectionPackV2[],
  catalog: ReturnType<typeof createProjectAnalysisContextEvidenceCatalog>,
  allowedEvidenceRefs: readonly string[],
): unknown => {
  const relevantPacks = packs.filter((pack) => slotId === "executive-summary"
    || slotId === "additional-insight"
    || pack.sectionId === slotId);
  return {
    exactSnapshot: {
      workspaceId: snapshot.context.workspaceId,
      projectId: snapshot.context.projectId,
      scopeId: snapshot.context.scopeId,
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
      analysisPeriod: snapshot.context.primaryPeriod,
      localAnalysisPeriod: overviewAiArtifactPinnedLocalPeriod({
        identity: {
          analysisPeriodFrom: snapshot.context.primaryPeriod.start,
          analysisPeriodTo: snapshot.context.primaryPeriod.endExclusive,
        },
        timezone: snapshot.context.timezone,
      }),
      timezone: snapshot.context.timezone,
    },
    deterministicOverview: {
      facts: selectPromptFacts(slotId, catalog, allowedEvidenceRefs, slotId === "executive-summary" ? 8 : undefined),
    },
    slot: slotId,
    sectionPacks: slotId === "executive-summary"
      ? []
      : relevantPacks.map((pack) => compactPack(pack, new Set(allowedEvidenceRefs))),
    alreadyPresentedFacts: slotId === "executive-summary" ? [] : relevantPacks.flatMap((pack) => pack.alreadyPresentedFacts)
      .filter((fact) => fact.evidenceRefs.some((ref) => allowedEvidenceRefs.includes(ref)))
      .map((fact) => ({
        id: fact.id,
        label: fact.label,
      })),
  };
};

const compactPack = (pack: PreschoolSectionPackV2, allowedEvidenceRefs: ReadonlySet<string>) => ({
  contract: pack.contract,
  sectionId: pack.sectionId,
  analysisGoal: pack.analysisGoal,
  evidence: pack.evidence
    .filter((item) => item.evidenceRefs.some((ref) => allowedEvidenceRefs.has(ref)))
    .map((item) => ({
      id: item.id,
      label: item.label,
      value: item.value,
      unit: item.unit,
      entityRefs: item.entityRefs,
      evidenceRefs: item.evidenceRefs,
      ...(packEvidencePresentationFacts(pack.sectionId, item).length === 0 ? {} : {
        presentationFacts: packEvidencePresentationFacts(pack.sectionId, item).map((fact) => ({
          factId: item.id,
          ...fact,
        })),
      }),
      ...(item.claimRelations === undefined ? {} : {
        claimRelations: item.claimRelations.map(compactClaimRelation),
      }),
    })),
  alreadyPresentedFacts: pack.alreadyPresentedFacts
    .filter((fact) => fact.evidenceRefs.some((ref) => allowedEvidenceRefs.has(ref)))
    .map((fact) => ({ id: fact.id, label: fact.label })),
  limitations: pack.limitations,
  missingEvidence: pack.missingEvidence,
});

const packEvidencePresentationFacts = (
  sectionId: PreschoolSectionPackV2["sectionId"],
  item: PreschoolSectionPackV2["evidence"][number],
): Array<{ presentationText: string }> => {
  if (!isRecord(item.value)) return [];
  if (sectionId === "centre-benchmark") return benchmarkPresentationFacts(item.value);
  if (sectionId === "standby-wastage" || sectionId === "operating-behaviour") {
    return operationalPresentationFacts(sectionId, item.value);
  }
  return [];
};

const benchmarkPresentationFacts = (value: Record<string, unknown>): Array<{ presentationText: string }> => {
  const portfolio = asRecord(value.portfolio);
  const sampleSize = finiteNumber(value.sampleSize);
  if (portfolio && sampleSize !== undefined) {
    const facts: Array<{ presentationText: string }> = [{
      presentationText: `The Portfolio benchmark covered ${countWithNoun(sampleSize, "Centre")}.`,
    }];
    const euiP75 = finiteNumber(asRecord(portfolio.eui)?.p75);
    if (euiP75 !== undefined) facts.push({
      presentationText: `The Portfolio P75 EUI was ${formatPresentationNumber(euiP75)} kWh/m2/year.`,
    });
    const perPaxP75 = finiteNumber(asRecord(portfolio.perPax)?.p75);
    if (perPaxP75 !== undefined) facts.push({
      presentationText: `The Portfolio P75 energy use per person was ${formatPresentationNumber(perPaxP75)} kWh/person/month.`,
    });
    return facts;
  }
  const name = nonEmptyRecordString(value.name);
  const metrics = asRecord(value.metrics);
  if (!name || !metrics) return [];
  return [
    rankedMetricPresentation(name, "absolute energy use", asRecord(metrics.absoluteUsage)),
    rankedMetricPresentation(name, "annualised EUI", asRecord(metrics.floorAreaNormalised)),
    rankedMetricPresentation(name, "energy use per person", asRecord(metrics.peopleNormalised)),
  ].filter((fact): fact is { presentationText: string } => fact !== undefined);
};

const rankedMetricPresentation = (
  name: string,
  label: string,
  metric: Record<string, unknown> | undefined,
): { presentationText: string } | undefined => {
  if (!metric) return undefined;
  const value = finiteNumber(metric.value);
  const unit = nonEmptyRecordString(metric.unit);
  const rank = asRecord(metric.rank);
  const position = finiteNumber(rank?.position);
  const outOf = finiteNumber(rank?.outOf);
  if (value === undefined || !unit || position === undefined || outOf === undefined) return undefined;
  return {
    presentationText: `${name}'s ${label} was ${formatPresentationNumber(value)} ${unit}, ranked ${formatPresentationNumber(position)} of ${formatPresentationNumber(outOf)} Centres.`,
  };
};

const operationalPresentationFacts = (
  sectionId: "standby-wastage" | "operating-behaviour",
  value: Record<string, unknown>,
): Array<{ presentationText: string }> => {
  const stateLabel = sectionId === "standby-wastage" ? "Closed-hour" : "Operating-hour";
  const energyKey = sectionId === "standby-wastage" ? "closedHoursKwh" : "operatingHoursKwh";
  const shareKey = sectionId === "standby-wastage" ? "closedHoursSharePct" : "operatingHoursSharePct";
  const energy = finiteNumber(value[energyKey]);
  const share = finiteNumber(value[shareKey]);
  if (energy !== undefined && share !== undefined) {
    const facts: Array<{ presentationText: string }> = [{
      presentationText: `${stateLabel} energy use was ${formatPresentationNumber(energy)} kWh, ${formatPresentationNumber(share)}% of total energy use.`,
    }];
    const spikeCount = finiteNumber(value.spikeCount);
    const centreCount = finiteNumber(value.centreCount);
    if (spikeCount !== undefined && centreCount !== undefined) facts.push({
      presentationText: `${stateLabel} screening found ${countWithNoun(spikeCount, "spike")} across ${countWithNoun(centreCount, "Centre")}.`,
    });
    return facts;
  }

  const name = nonEmptyRecordString(value.name);
  const spikeCount = finiteNumber(value.spikeCount);
  const worstSpike = asRecord(value.worstSpike);
  if (name && worstSpike) {
    const facts: Array<{ presentationText: string }> = [];
    if (spikeCount !== undefined) facts.push({
      presentationText: `${name} had ${formatPresentationNumber(spikeCount)} ${stateLabel.toLocaleLowerCase()} ${spikeCount === 1 ? "spike" : "spikes"}.`,
    });
    const usage = finiteNumber(worstSpike.usageKwh);
    const localDate = nonEmptyRecordString(worstSpike.localDate);
    const localHour = finiteNumber(worstSpike.localHour);
    if (usage !== undefined) {
      const when = localDate && localHour !== undefined
        ? ` on ${localDate} at ${String(localHour).padStart(2, "0")}:00`
        : "";
      facts.push({
        presentationText: `${name}'s largest evidenced ${stateLabel.toLocaleLowerCase()} spike was ${formatPresentationNumber(usage)} kWh${when}.`,
      });
    }
    const circuitName = nonEmptyRecordString(worstSpike.leadingCircuitName);
    const circuitKwh = finiteNumber(worstSpike.leadingCircuitKwh);
    const circuitShare = finiteNumber(worstSpike.leadingCircuitSharePct);
    if (circuitName && circuitKwh !== undefined && circuitShare !== undefined) facts.push({
      presentationText: `During that ${name} spike, ${circuitName} contributed ${formatPresentationNumber(circuitKwh)} kWh, ${formatPresentationNumber(circuitShare)}% of the spike.`,
    });
    return facts;
  }

  const applianceName = nonEmptyRecordString(value.name);
  const usage = finiteNumber(value.usageKwh);
  const applianceShare = finiteNumber(value.sharePct);
  const centreCount = finiteNumber(value.centreCount);
  if (applianceName && usage !== undefined && applianceShare !== undefined && centreCount !== undefined) return [{
    presentationText: `${applianceName} accounted for ${formatPresentationNumber(usage)} kWh, ${formatPresentationNumber(applianceShare)}% of ${stateLabel.toLocaleLowerCase()} energy use, across ${countWithNoun(centreCount, "Centre")}.`,
  }];
  return [];
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => isRecord(value) ? value : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nonEmptyRecordString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const countWithNoun = (count: number, noun: string): string =>
  `${formatPresentationNumber(count)} ${noun}${count === 1 ? "" : "s"}`;

const selectPromptFacts = (
  slotId: PreschoolHtmlAiSlotId,
  catalog: ReturnType<typeof createProjectAnalysisContextEvidenceCatalog>,
  allowedEvidenceRefs: readonly string[],
  limit?: number,
) => {
  const allowed = new Set(allowedEvidenceRefs);
  const facts = catalog.facts
    .filter((fact) => allowed.has(fact.id) && isPromptFactForSlot(slotId, fact.id))
    .map((fact) => {
      const presentationText = deterministicFactPresentationText(fact);
      return {
        id: fact.id,
        label: fact.label,
        metricId: fact.metricId,
        value: fact.value,
        unit: fact.unit,
        status: fact.status,
        evidenceRefs: [fact.id],
        ...(presentationText === undefined ? {} : { presentationText }),
      };
    });
  return limit === undefined ? facts : facts.slice(0, limit);
};

const deterministicFactPresentationText = (fact: {
  id: string;
  value: unknown;
  unit?: string;
}): string | undefined => {
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value)) return undefined;
  const value = formatPresentationNumber(fact.value);
  if (fact.id === "analysis.summary.usage_kwh") {
    return `Selected Scope energy use was ${value} ${fact.unit ?? "kWh"}.`;
  }
  if (fact.id === "analysis.off_hours.share_pct") {
    return `Off-hours energy use was ${value}% of total energy use.`;
  }
  if (fact.id !== "analysis.comparison.change_kwh" && fact.id !== "analysis.comparison.change_pct") return undefined;
  if (fact.value === 0) return "Selected Scope energy use was unchanged from the previous comparison period.";
  if (fact.id === "analysis.comparison.change_kwh") {
    const direction = fact.value > 0 ? "increased" : "decreased";
    return `Selected Scope energy use ${direction} by ${formatPresentationNumber(Math.abs(fact.value))} ${fact.unit ?? "kWh"} from the previous comparison period.`;
  }
  const direction = fact.value > 0 ? "higher" : "lower";
  return `Selected Scope energy use was ${formatPresentationNumber(Math.abs(fact.value))}% ${direction} than the previous comparison period.`;
};

const formatPresentationNumber = (value: number): string => value.toLocaleString("en-US", {
  maximumFractionDigits: 6,
  useGrouping: true,
});

const compactClaimRelation = (relation: {
  subject: string;
  predicate: string;
  object: string;
}) => {
  const presentationText = relation.predicate === "leading-circuit"
    ? `${relation.subject} has ${relation.object} as its leading circuit.`
    : undefined;
  return { ...relation, ...(presentationText === undefined ? {} : { presentationText }) };
};

const isPromptFactForSlot = (slotId: PreschoolHtmlAiSlotId, factId: string): boolean => {
  if (factId.startsWith("analysis.summary.")
    || factId.startsWith("analysis.comparison.")
    || factId.startsWith("analysis.off_hours.")) return true;
  if (!factId.startsWith("preschool.decision_signals.")) return false;
  if (slotId === "executive-summary" || slotId === "additional-insight") return true;
  const signal = factId.split(".")[2];
  return (slotId === "centre-benchmark" && signal === "efficiency")
    || (slotId === "standby-wastage" && signal === "after-hours")
    || (slotId === "operating-behaviour" && signal === "operating");
};

const collectAllowedEvidenceRefsBySlot = (
  packs: readonly PreschoolSectionPackV2[],
  catalog: ReturnType<typeof createProjectAnalysisContextEvidenceCatalog>,
): Record<PreschoolHtmlAiSlotId, string[]> => Object.fromEntries(
  PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, collectAllowedEvidenceRefs(slotId, packs, catalog)]),
) as Record<PreschoolHtmlAiSlotId, string[]>;

const collectAllowedEvidenceRefs = (
  slotId: PreschoolHtmlAiSlotId,
  packs: readonly PreschoolSectionPackV2[],
  catalog: ReturnType<typeof createProjectAnalysisContextEvidenceCatalog>,
): string[] => {
  const relevantPacks = packs.filter((pack) => slotId === "executive-summary"
    || slotId === "additional-insight"
    || pack.sectionId === slotId);
  const refs = relevantPacks.flatMap((pack) => [
    ...pack.evidence.flatMap((item) => [item.id, ...item.evidenceRefs]),
    ...pack.crossSectionIndex.flatMap((signal) => [signal.signalId, ...signal.evidenceRefs]),
  ]);
  refs.push(...catalog.facts
    .filter((fact) => isPromptFactForSlot(slotId, fact.id))
    .map((fact) => fact.id));
  if (slotId === "executive-summary" || slotId === "additional-insight") {
    refs.push(...catalog.facts.flatMap((fact) => fact.evidenceRefs));
  }
  return [...new Set(refs)];
};

const htmlSlotErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return PRESCHOOL_HTML_AI_SLOT_SAFE_ERROR_CODES.has(message)
    ? message
    : "PRESCHOOL_HTML_AI_SLOT_GENERATION_FAILED";
};

const PRESCHOOL_HTML_AI_SLOT_SAFE_ERROR_CODES = new Set([
  "PRESCHOOL_HTML_AI_SLOT_DEFINITION_IDENTITY_MISMATCH",
  "PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID",
  "PRESCHOOL_HTML_AI_SLOT_GENERATION_FAILED",
  "PRESCHOOL_HTML_AI_SLOT_IDENTITY_MISMATCH",
  "PRESCHOOL_HTML_AI_SLOT_OUTPUT_INVALID",
  "PRESCHOOL_HTML_AI_SLOT_PROMPT_IDENTITY_MISMATCH",
  "PRESCHOOL_HTML_AI_SLOT_PROMPT_TOO_LARGE",
  "PRESCHOOL_HTML_AI_SLOT_RUN_IDENTITY_MISMATCH",
  "PRESCHOOL_HTML_AI_SLOT_SERVER_ENVELOPE_FORGED",
  "PRESCHOOL_HTML_AI_SLOT_TOO_LARGE",
  "PRESCHOOL_HTML_AI_SLOT_UNSAFE",
  "PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT",
  "PRESCHOOL_HTML_AI_SLOT_FABRICATED_ENTITY",
  "PRESCHOOL_HTML_AI_SLOT_CONFLICTING_FACT",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

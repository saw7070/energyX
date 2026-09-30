import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type {
  EnergyIqAdditionalInsightModelProfileSnapshot,
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";

import { resolveWorkspaceDefaultModelProfileSnapshot } from "../workspace-model-profile-resolver.js";

import {
  overviewAiArtifactPinnedLocalPeriod,
  requireCurrentNgeeAnnBaseIdentity,
  requireOverviewAiModelRuntimeIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import { createNgeeAnnExecutiveSynthesizer, type NgeeAnnExecutiveRunner } from "./ngee-ann-executive-synthesis.js";
import { createNgeeAnnSectionInterpreter, type NgeeAnnSectionInterpreterRunner } from "./ngee-ann-section-interpreter.js";
import { resolveNgeeAnnSectionManifestForRelease } from "./ngee-ann-section-manifest.js";
import {
  assembleNgeeAnnSectionPacks,
  NGEE_ANN_SECTION_IDS,
  type NgeeAnnSectionId,
  type NgeeAnnSectionPacks,
} from "./ngee-ann-section-pack.js";
import { readCurrentProjectOverviewSnapshotWithLifecycle } from "./project-analysis-resolver.js";

export type NgeeAnnOverviewAiRetryTarget = NgeeAnnSectionId | "executive-synthesis";

export const createNgeeAnnOverviewAiWorkflow = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runSection: NgeeAnnSectionInterpreterRunner;
  runExecutive: NgeeAnnExecutiveRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  resolvePacks?: (args: {
    identity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    sectionIds: readonly NgeeAnnSectionId[];
  }) => Promise<Partial<NgeeAnnSectionPacks>>;
  resolveModelProfileSnapshot?: () => EnergyIqAdditionalInsightModelProfileSnapshot;
}) => {
  const assertRuntimeIdentity = input.assertRuntimeIdentity
    ?? ((identity: EnergyIqOverviewAiArtifactIdentity) =>
      requireOverviewAiModelRuntimeIdentity(input.metadataStore, identity));
  const interpreter = createNgeeAnnSectionInterpreter({
    metadataStore: input.metadataStore,
    runSection: input.runSection,
    assertRuntimeIdentity,
  });
  const synthesizer = createNgeeAnnExecutiveSynthesizer({
    metadataStore: input.metadataStore,
    runExecutive: input.runExecutive,
    assertRuntimeIdentity,
  });
  const resolvePacks = input.resolvePacks ?? (async ({ identity, user, sectionIds }) => {
    const project = input.metadataStore.energyIq.getProject(identity.projectId);
    const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
    const snapshot = await readCurrentProjectOverviewSnapshotWithLifecycle({
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
    return assembleNgeeAnnSectionPacks(snapshot, sectionIds);
  });
  const resolveModelProfileSnapshot = input.resolveModelProfileSnapshot
    ?? (() => resolveWorkspaceDefaultModelProfileSnapshot(input.metadataStore));

  return {
    async execute({
      identity,
      user,
      retryTarget,
      modelProfileSnapshot: providedModelProfileSnapshot,
    }: {
      identity: EnergyIqOverviewAiArtifactIdentity;
      user: UserRecord;
      retryTarget?: string;
      modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
    }): Promise<{
      sections: Partial<Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactRecord>>;
      executive?: EnergyIqOverviewAiArtifactRecord;
    }> {
      const baseIdentity = requireCurrentNgeeAnnBaseIdentity(identity);
      if (retryTarget && retryTarget !== "executive-synthesis" && !isNgeeAnnSectionId(retryTarget)) {
        throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_RETRY_TARGET_INVALID");
      }
      assertRuntimeIdentity(baseIdentity);
      const modelProfileSnapshot = providedModelProfileSnapshot ?? resolveModelProfileSnapshot();
      if (modelProfileSnapshot.bindingRevision !== baseIdentity.modelProfileRevision) {
        throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
      }
      const sectionIds = resolveNgeeAnnSectionManifestForRelease(
        input.metadataStore,
        baseIdentity.projectReleaseId,
      ).enabledSectionIds;
      const packs = await resolvePacks({ identity: baseIdentity, user, sectionIds });
      const retryTargets = retryTarget && isNgeeAnnSectionId(retryTarget) ? [retryTarget] : [];
      const sections = await interpreter.execute({
        baseIdentity,
        packs,
        user,
        retryTargets,
        modelProfileSnapshot,
        sectionIds,
      });
      if (!areNgeeAnnSectionArtifactsTerminal(sections, sectionIds)) return { sections };
      const executive = await synthesizer.execute({
        baseIdentity,
        sectionRecords: sectionIds.map((sectionId) => sections[sectionId]!),
        user,
        retry: retryTarget === "executive-synthesis",
        modelProfileSnapshot,
      });
      return { sections, executive };
    },
  };
};

export const areNgeeAnnSectionArtifactsTerminal = (
  sections: Record<string, { status: string }>,
  sectionIds: readonly NgeeAnnSectionId[] = NGEE_ANN_SECTION_IDS,
): boolean => sectionIds.every((sectionId) =>
  isTerminalGenerationStatus(sections[sectionId]?.status));

export const isNgeeAnnOverviewAiGenerationTerminal = (input: {
  sections: Record<string, { status: string }>;
  executive?: { status: string };
  keyFindings?: { status: string };
}, sectionIds: readonly NgeeAnnSectionId[]): boolean => areNgeeAnnSectionArtifactsTerminal(
  input.sections,
  sectionIds,
)
  && isTerminalGenerationStatus((input.executive ?? input.keyFindings)?.status);

export const requireNgeeAnnAdditionalInsightsReady = <T extends {
  sections: Record<string, { status: string }>;
  executive?: { status: string };
  keyFindings?: { status: string };
}>(input: T, sectionIds: readonly NgeeAnnSectionId[]): T => {
  if (!isNgeeAnnOverviewAiGenerationTerminal(input, sectionIds)) {
    throw new Error("ENERGYIQ_NGEE_ANN_ADDITIONAL_INSIGHTS_CORE_NOT_READY");
  }
  return input;
};

const isTerminalGenerationStatus = (status: string | undefined): boolean =>
  status === "available" || status === "empty" || status === "failed";

const isNgeeAnnSectionId = (value: string): value is NgeeAnnSectionId =>
  (NGEE_ANN_SECTION_IDS as readonly string[]).includes(value);

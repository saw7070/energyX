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
  createTuyaOfficeOverviewAiExecutiveArtifactIdentity,
  overviewAiArtifactPinnedLocalPeriod,
  requireCurrentTuyaOfficeBaseIdentity,
  requireOverviewAiModelRuntimeIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  createNgeeAnnExecutiveSynthesizer,
  type NgeeAnnExecutiveRunner,
} from "./ngee-ann-executive-synthesis.js";
import { resolveProjectAnalysis } from "./project-analysis-resolver.js";
import { requireTuyaOfficeAiSurfaceForIdentity } from "./tuya-office-ai-surface.js";
import {
  createTuyaOfficeSectionInterpreter,
  type TuyaOfficeSectionInterpreterRunner,
} from "./tuya-office-section-interpreter.js";
import type { ProjectOverviewAiSurfaceDefinition } from "./project-overview-ai-adapter.js";
import {
  assembleTuyaOfficeSectionPacks,
  TUYA_OFFICE_SECTION_IDS,
  type TuyaOfficeSectionId,
  type TuyaOfficeSectionPacks,
} from "./tuya-office-section-pack.js";

export const createTuyaOfficeOverviewAiWorkflow = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runSection: TuyaOfficeSectionInterpreterRunner;
  runExecutive?: NgeeAnnExecutiveRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  resolvePacks?: (args: {
    identity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
  }) => Promise<TuyaOfficeSectionPacks>;
  resolveModelProfileSnapshot?: () => EnergyIqAdditionalInsightModelProfileSnapshot;
  resolveSurface?: (identity: OverviewAiArtifactIdentityV13) => ProjectOverviewAiSurfaceDefinition;
}) => {
  const assertRuntimeIdentity = input.assertRuntimeIdentity
    ?? ((identity: EnergyIqOverviewAiArtifactIdentity) =>
      requireOverviewAiModelRuntimeIdentity(input.metadataStore, identity));
  const interpreter = createTuyaOfficeSectionInterpreter({
    metadataStore: input.metadataStore,
    runSection: input.runSection,
    assertRuntimeIdentity,
  });
  const synthesizer = input.runExecutive ? createNgeeAnnExecutiveSynthesizer({
    metadataStore: input.metadataStore,
    runExecutive: input.runExecutive,
    assertRuntimeIdentity,
    createArtifactIdentity: ({ baseIdentity, targetId }) => {
      const surface = input.resolveSurface?.(baseIdentity)
        ?? requireTuyaOfficeAiSurfaceForIdentity(input.metadataStore, baseIdentity);
      if (!surface.keyFindings) throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
      return createTuyaOfficeOverviewAiExecutiveArtifactIdentity({
        baseIdentity,
        targetId,
        unit: surface.keyFindings,
      });
    },
    productLabel: "Tuya Office Overview",
    runPrefix: "tuya-office-executive",
    allowNumericClaims: false,
    requireWindowLineage: true,
  }) : undefined;
  const resolvePacks = input.resolvePacks ?? (async ({ identity, user }) => {
    const project = input.metadataStore.energyIq.getProject(identity.projectId);
    const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
    const resolution = await resolveProjectAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      user,
      workspaceId: identity.workspaceId,
      bypassCache: true,
      request: {
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        resource: "electricity",
        period: "Custom",
        from: period.from,
        to: period.to,
        expectedDataSnapshotId: identity.dataSnapshotId,
        expectedProjectReleaseId: identity.projectReleaseId,
      },
    });
    if (resolution.status !== "ready") throw new Error("OVERVIEW_AI_SNAPSHOT_NOT_READY");
    return assembleTuyaOfficeSectionPacks(resolution.snapshot);
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
      sections: Partial<Record<TuyaOfficeSectionId, EnergyIqOverviewAiArtifactRecord>>;
      executive?: EnergyIqOverviewAiArtifactRecord;
    }> {
      const baseIdentity = requireCurrentTuyaOfficeBaseIdentity(identity);
      const surface = input.resolveSurface?.(baseIdentity)
        ?? requireTuyaOfficeAiSurfaceForIdentity(input.metadataStore, baseIdentity);
      if (surface.sections.length !== TUYA_OFFICE_SECTION_IDS.length
        || !TUYA_OFFICE_SECTION_IDS.every((sectionId) => surface.sections.some(({ id }) => id === sectionId))) {
        throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
      }
      if (retryTarget && retryTarget !== "executive-synthesis" && !isTuyaOfficeSectionId(retryTarget)) {
        throw new Error("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_RETRY_TARGET_INVALID");
      }
      const retrySectionId = retryTarget && isTuyaOfficeSectionId(retryTarget)
        ? retryTarget
        : undefined;
      assertRuntimeIdentity(baseIdentity);
      const modelProfileSnapshot = providedModelProfileSnapshot ?? resolveModelProfileSnapshot();
      if (modelProfileSnapshot.bindingRevision !== baseIdentity.modelProfileRevision) {
        throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
      }
      const packs = await resolvePacks({ identity: baseIdentity, user });
      const targetSectionIds: readonly TuyaOfficeSectionId[] = retrySectionId
        ? [retrySectionId]
        : surface.sections.map(({ id }) => id as TuyaOfficeSectionId);
      const entries: Array<readonly [TuyaOfficeSectionId, EnergyIqOverviewAiArtifactRecord]> = [];
      for (let offset = 0; offset < targetSectionIds.length; offset += 2) {
        const batch = targetSectionIds.slice(offset, offset + 2);
        entries.push(...await Promise.all(batch.map(async (sectionId) => [
          sectionId,
          await interpreter.execute({
            baseIdentity,
            pack: packs[sectionId],
            unit: surface.sections.find(({ id }) => id === sectionId)!,
            user,
            retry: retrySectionId === sectionId,
            modelProfileSnapshot,
          }),
        ] as const)));
      }
      const sections = Object.fromEntries(entries) as Partial<
        Record<TuyaOfficeSectionId, EnergyIqOverviewAiArtifactRecord>
      >;
      if (!synthesizer || !tuyaOfficeSectionsTerminal(sections)) return { sections };
      const executive = await synthesizer.execute({
        baseIdentity,
        sectionRecords: TUYA_OFFICE_SECTION_IDS.map((sectionId) => sections[sectionId]!),
        user,
        retry: retryTarget === "executive-synthesis",
        modelProfileSnapshot,
      });
      return { sections, executive };
    },
  };
};

const isTuyaOfficeSectionId = (value: string): value is TuyaOfficeSectionId =>
  (TUYA_OFFICE_SECTION_IDS as readonly string[]).includes(value);

export const tuyaOfficeSectionsTerminal = (
  sections: Partial<Record<TuyaOfficeSectionId, { status: string }>>,
): boolean => TUYA_OFFICE_SECTION_IDS.every((sectionId) => {
  const status = sections[sectionId]?.status;
  return status === "available" || status === "failed";
});

export const isTuyaOfficeOverviewAiGenerationTerminal = (input: {
  sections: Partial<Record<TuyaOfficeSectionId, { status: string }>>;
  executive?: { status: string };
  keyFindings?: { status: string };
}): boolean => tuyaOfficeSectionsTerminal(input.sections)
  && ["available", "failed"].includes((input.executive ?? input.keyFindings)?.status ?? "");

export const requireTuyaOfficeAdditionalInsightsReady = <T extends {
  sections: Partial<Record<TuyaOfficeSectionId, { status: string }>>;
  executive?: { status: string };
  keyFindings?: { status: string };
}>(input: T): T => {
  if (!isTuyaOfficeOverviewAiGenerationTerminal(input)) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_ADDITIONAL_INSIGHTS_CORE_NOT_READY");
  }
  return input;
};

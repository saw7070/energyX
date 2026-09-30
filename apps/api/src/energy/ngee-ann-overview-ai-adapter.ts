import type { LocalDataGateway } from "@datafoundry/data-gateway";
import { resolveCurrentAdditionalAiInsightMethodSet } from "@datafoundry/contracts";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import {
  createNgeeAnnAdditionalAiInsightArtifactIdentity,
  createNgeeAnnOverviewAiExecutiveArtifactIdentity,
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createOverviewAiArtifactIdentity,
  requireCurrentNgeeAnnBaseIdentity,
  resolveCurrentOverviewAiArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import { ngeeAnnExecutiveTargetId } from "./ngee-ann-executive-synthesis.js";
import {
  NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID,
  resolveNgeeAnnSectionManifestForRelease,
} from "./ngee-ann-section-manifest.js";
import {
  NGEE_ANN_CORE_AI_SECTION_IDS,
  NGEE_ANN_SECTION_IDS,
  type NgeeAnnSectionId,
} from "./ngee-ann-section-pack.js";
import {
  projectOverviewAiGenerationBinding,
  type ProjectOverviewAiAdapter,
  type ProjectOverviewAiReadModel,
  type ProjectOverviewAiUnitStatus,
} from "./project-overview-ai-adapter.js";

export const NGEE_ANN_OVERVIEW_AI_SECTIONS = [
  { id: "trend-and-demand", label: "Trend and demand" },
  { id: "time-behaviour", label: "Time behaviour" },
  { id: "circuit-concentration", label: "Circuit concentration" },
  { id: "decision-priorities", label: "Decision priorities" },
  { id: "school-holiday-comparison", label: "School Holiday Comparison" },
] as const;

type ResolveNgeeAnnBaseIdentity = (input: {
  projectId: string;
  scopeId: string;
  user: UserRecord;
  request: {
    kind: "current";
  } | {
    kind: "pinned";
    pin: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
  };
}) => Promise<OverviewAiArtifactIdentityV13>;

export const createNgeeAnnProjectOverviewAiAdapter = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  resolveBaseIdentity?: ResolveNgeeAnnBaseIdentity;
  executeMissing: (input: {
    identity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    retryTarget?: string;
  }) => Promise<void> | void;
}): ProjectOverviewAiAdapter => {
  const resolveBaseIdentity = input.resolveBaseIdentity ?? (async ({
    projectId,
    scopeId,
    user,
    request,
  }) => resolveCurrentOverviewAiArtifactIdentity({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    projectId,
    scopeId,
    user,
    ...(request.kind === "pinned" ? { pin: request.pin } : {}),
  }));

  const readExact = async ({
    identity,
  }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }): Promise<ProjectOverviewAiReadModel> => composeNgeeAnnOverviewAiReadModel({
    metadataStore: input.metadataStore,
    baseIdentity: identity,
  });

  return {
    rendererKey: "ngee-ann-overview",
    projectId: "ngee-ann-polytechnic",
    keyFindings: true,
    sections: NGEE_ANN_OVERVIEW_AI_SECTIONS,
    additionalInsights: true,
    resolveIdentity: resolveBaseIdentity,
    readExact,
    async generateMissing({ identity, user, retryTarget }) {
      const baseIdentity = requireCurrentNgeeAnnBaseIdentity(identity);
      await input.executeMissing({
        identity: baseIdentity,
        user,
        ...(retryTarget ? { retryTarget } : {}),
      });
      return readExact({ identity: baseIdentity, user });
    },
  };
};

export const composeNgeeAnnOverviewAiReadModel = (input: {
  metadataStore: MetadataStore;
  baseIdentity: EnergyIqOverviewAiArtifactIdentity;
}): ProjectOverviewAiReadModel => {
  const baseIdentity = requireCurrentNgeeAnnBaseIdentity(input.baseIdentity);
  const store = input.metadataStore.energyIq.overviewAiArtifacts;
  const sectionIds = activeNgeeAnnAiSectionIds(input.metadataStore, baseIdentity.projectReleaseId);
  const sectionRecords = sectionIds.map((sectionId) => {
    const sectionIdentity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity,
      targetId: sectionId,
    });
    return { sectionId, record: store.find(sectionIdentity) };
  });
  const sections = Object.fromEntries(sectionRecords.map(({ sectionId, record }) => [
    sectionId,
    artifactUnit(record),
  ])) as Record<NgeeAnnSectionId, ProjectOverviewAiUnitStatus>;
  const executiveIdentity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
    baseIdentity,
    targetId: ngeeAnnExecutiveTargetId(sectionRecords.flatMap(({ record }) => record ? [record] : [])),
  });
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
    baseIdentity.workspaceId,
    input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
      workspaceId: baseIdentity.workspaceId,
    }),
  );
  const additionalIdentity = createNgeeAnnAdditionalAiInsightArtifactIdentity({ baseIdentity, methodSet });

  return {
    contract: "energyiq-project-overview-ai-read-model@1",
    rendererKey: "ngee-ann-overview",
    binding: {
      workspaceId: baseIdentity.workspaceId,
      projectId: baseIdentity.projectId,
      scopeId: baseIdentity.scopeId,
      dataSnapshotId: baseIdentity.dataSnapshotId,
      projectReleaseId: baseIdentity.projectReleaseId,
      analysisPeriod: {
        from: baseIdentity.analysisPeriodFrom,
        to: baseIdentity.analysisPeriodTo,
      },
      modelProfileId: baseIdentity.modelProfileId,
      modelProfileRevision: baseIdentity.modelProfileRevision,
      generation: {
        ...projectOverviewAiGenerationBinding(baseIdentity),
        units: {
          keyFindings: projectOverviewAiGenerationBinding(executiveIdentity),
          sections: Object.fromEntries(sectionIds.map((sectionId) => [
            sectionId,
            projectOverviewAiGenerationBinding(createNgeeAnnOverviewAiSectionArtifactIdentity({
              baseIdentity,
              targetId: sectionId,
            })),
          ])),
          additionalInsights: projectOverviewAiGenerationBinding(additionalIdentity),
        },
      },
    },
    keyFindings: artifactUnit(store.find(executiveIdentity)),
    sections,
    additionalInsights: artifactUnit(store.find(additionalIdentity)),
  };
};

const activeNgeeAnnAiSectionIds = (
  metadataStore: MetadataStore,
  projectReleaseId: string,
): readonly NgeeAnnSectionId[] => {
  const templates = (metadataStore.energyIq as unknown as {
    templates?: { getProjectRevision?: unknown };
  }).templates;
  if (typeof templates?.getProjectRevision !== "function") return NGEE_ANN_CORE_AI_SECTION_IDS;
  const manifest = resolveNgeeAnnSectionManifestForRelease(metadataStore, projectReleaseId);
  return manifest.enabledSectionIds.includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID)
    ? NGEE_ANN_SECTION_IDS
    : NGEE_ANN_CORE_AI_SECTION_IDS;
};

const artifactUnit = (
  record: EnergyIqOverviewAiArtifactRecord | undefined,
): ProjectOverviewAiUnitStatus => {
  if (!record) return { status: "missing" };
  if (record.status === "queued" || record.status === "running") {
    return { status: record.status, artifactId: record.id };
  }
  if (record.status === "failed") {
    return {
      status: "failed",
      artifactId: record.id,
      reason: record.error_code ?? "ENERGYIQ_PROJECT_OVERVIEW_AI_ARTIFACT_FAILED",
      ...(record.completed_at ? { completedAt: record.completed_at } : {}),
    };
  }
  const result = parseStoredResult(record.result_json);
  if (!result) {
    return {
      status: "failed",
      artifactId: record.id,
      reason: "ENERGYIQ_PROJECT_OVERVIEW_AI_ARTIFACT_RESULT_INVALID",
      ...(record.completed_at ? { completedAt: record.completed_at } : {}),
    };
  }
  if (result.status === "empty") {
    return {
      status: "empty",
      artifactId: record.id,
      runId: typeof result.runId === "string" && result.runId.trim()
        ? result.runId
        : record.run_id ?? "",
      ...(record.completed_at ? { completedAt: record.completed_at } : {}),
    };
  }
  return {
    status: "available",
    artifactId: record.id,
    result,
    ...(record.completed_at ? { completedAt: record.completed_at } : {}),
  };
};

const parseStoredResult = (
  resultJson: string | undefined,
): Record<string, unknown> | null => {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    return isRecord(parsed) && (parsed.status === "available" || parsed.status === "empty")
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

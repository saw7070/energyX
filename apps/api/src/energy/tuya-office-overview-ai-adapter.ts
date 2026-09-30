import type { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  resolveCurrentAdditionalAiInsightMethodSet,
} from "@datafoundry/contracts";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash } from "node:crypto";

import {
  createTuyaOfficeAdditionalAiInsightArtifactIdentity,
  createTuyaOfficeOverviewAiExecutiveArtifactIdentity,
  createTuyaOfficeOverviewAiSectionArtifactIdentity,
  requireCurrentTuyaOfficeBaseIdentity,
  resolveCurrentOverviewAiArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  projectOverviewAiGenerationBinding,
  type ProjectOverviewAiAdapter,
  type ProjectOverviewAiReadModel,
  type ProjectOverviewAiSurfaceDefinition,
  type ProjectOverviewAiUnitStatus,
} from "./project-overview-ai-adapter.js";
import type { TuyaOfficeSectionId } from "./tuya-office-section-pack.js";
import { resolveTuyaOfficeAiSurfaceDefinition } from "./tuya-office-ai-surface.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

type ResolveTuyaOfficeBaseIdentity = (input: {
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

export const createTuyaOfficeProjectOverviewAiAdapter = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  resolveBaseIdentity?: ResolveTuyaOfficeBaseIdentity;
  executeMissing: (input: {
    identity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    retryTarget?: string;
  }) => Promise<void> | void;
  resolveSurface?: (identity: EnergyIqOverviewAiArtifactIdentity) => ProjectOverviewAiSurfaceDefinition;
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
  const resolveSurface = input.resolveSurface ?? ((identity: EnergyIqOverviewAiArtifactIdentity) =>
    resolveTuyaOfficeAiSurfaceDefinition(input.metadataStore, identity.projectReleaseId));
  const readExact = async ({
    identity,
  }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }): Promise<ProjectOverviewAiReadModel> => composeTuyaOfficeOverviewAiReadModel({
    metadataStore: input.metadataStore,
    baseIdentity: identity,
    surface: resolveSurface(identity),
  });

  return {
    rendererKey: "tuya-office-overview",
    projectId: TUYA_OFFICE_PROJECT_ID,
    keyFindings: false,
    sections: [],
    additionalInsights: false,
    resolveSurface,
    resolveIdentity: resolveBaseIdentity,
    readExact,
    async generateMissing({ identity, user, retryTarget }) {
      const baseIdentity = requireCurrentTuyaOfficeBaseIdentity(identity);
      const surface = resolveSurface(baseIdentity);
      const allowedTargets = new Set([
        ...(surface.keyFindings ? ["executive-synthesis"] : []),
        ...surface.sections.map(({ id }) => id),
        ...(surface.additionalInsights ? ["additional-insights"] : []),
      ]);
      if (retryTarget && !allowedTargets.has(retryTarget)) {
        throw new Error("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_RETRY_TARGET_INVALID");
      }
      await input.executeMissing({
        identity: baseIdentity,
        user,
        ...(retryTarget ? { retryTarget } : {}),
      });
      return readExact({ identity: baseIdentity, user });
    },
  };
};

export const composeTuyaOfficeOverviewAiReadModel = (input: {
  metadataStore: MetadataStore;
  baseIdentity: EnergyIqOverviewAiArtifactIdentity;
  surface?: ProjectOverviewAiSurfaceDefinition;
}): ProjectOverviewAiReadModel => {
  const baseIdentity = requireCurrentTuyaOfficeBaseIdentity(input.baseIdentity);
  const surface = input.surface ?? resolveTuyaOfficeAiSurfaceDefinition(
    input.metadataStore,
    baseIdentity.projectReleaseId,
  );
  const store = input.metadataStore.energyIq.overviewAiArtifacts;
  const sectionRecords = surface.sections.map((unit) => {
    const sectionId = unit.id;
    const sectionIdentity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity,
      targetId: sectionId,
      unit,
    });
    return { sectionId, unit, record: store.find(sectionIdentity) };
  });
  const sections = Object.fromEntries(sectionRecords.map(({ sectionId, record }) => [
    sectionId,
    artifactUnit(record),
  ])) as Record<TuyaOfficeSectionId, ProjectOverviewAiUnitStatus>;
  const executiveIdentity = createTuyaOfficeOverviewAiExecutiveArtifactIdentity({
    baseIdentity,
    targetId: executiveTargetId(sectionRecords.flatMap(({ record }) => record ? [record] : [])),
    unit: surface.keyFindings!,
  });
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
    baseIdentity.workspaceId,
    input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
      workspaceId: baseIdentity.workspaceId,
    }),
  );
  const additionalIdentity = createTuyaOfficeAdditionalAiInsightArtifactIdentity({
    baseIdentity,
    methodSet,
    unit: surface.additionalInsights!,
  });

  return {
    contract: "energyiq-project-overview-ai-read-model@1",
    rendererKey: "tuya-office-overview",
    surface,
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
          sections: Object.fromEntries(surface.sections.map((unit) => [
            unit.id,
            projectOverviewAiGenerationBinding(createTuyaOfficeOverviewAiSectionArtifactIdentity({
              baseIdentity,
              targetId: unit.id,
              unit,
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

const executiveTargetId = (
  sectionRecords: readonly EnergyIqOverviewAiArtifactRecord[],
): string => {
  if (sectionRecords.length === 0) return "sections:none-v1";
  const basis = sectionRecords
    .map(({ id, identity_hash, status, run_id, result_json, error_code }) => {
      const valueDigest = createHash("sha256")
        .update(result_json ?? error_code ?? "")
        .digest("hex")
        .slice(0, 16);
      return `${id}:${identity_hash}:${status}:${run_id ?? "none"}:${valueDigest}`;
    })
    .sort((left, right) => left.localeCompare(right))
    .join("|");
  return `sections:${createHash("sha256").update(basis).digest("hex").slice(0, 24)}`;
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

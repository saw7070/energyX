import type {
  EnergyIqOverviewAiArtifactIdentity,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";

import type { OverviewAiArtifactIdentityV13 } from "./overview-ai-artifact.js";
import type { PreschoolAdditionalAiInsightsWorkflow } from "./preschool-additional-ai-insights-workflow.js";
import type {
  PreschoolOverviewAiPageWorkflow,
  PreschoolOverviewAiRetryTarget,
} from "./preschool-overview-ai-page-workflow.js";
import {
  PRESCHOOL_SECTION_IDS,
  type PreschoolOverviewAiReadModel,
  type PreschoolOverviewAiUnitStatus,
  type PreschoolSectionId,
} from "./preschool-overview-ai-contracts.js";
import {
  resolveProjectOverviewProfile,
  type ProjectRendererKey,
} from "./project-analysis-resolver.js";
import {
  projectAiExplainabilityState,
  unavailableProjectAiExplainabilityState,
  type ProjectAiExplainabilityState,
} from "./project-ai-explainability.js";
import {
  findProjectOverviewAiAdapter,
  projectOverviewAiReadModelMatchesIdentity,
  type ProjectOverviewAiAdapter,
  type ProjectOverviewAiReadModel,
  type ProjectOverviewAiSurfaceDefinition,
  type ProjectOverviewAiUnitStatus,
} from "./project-overview-ai-adapter.js";

export type ProjectOverviewAdminReadinessStatus =
  | "ready"
  | "generating"
  | "not-generated"
  | "needs-attention"
  | "no-new-insight"
  | "out-of-date";

export type ProjectOverviewAdminReadinessItem = {
  id: string;
  label: string;
  status: ProjectOverviewAdminReadinessStatus;
  detail: string;
  artifactId?: string;
  completedAt?: string;
};

export type ProjectOverviewAdminState = {
  projectId: string;
  projectName: string;
  rendererKey: ProjectRendererKey | null;
  customerOverview: {
    status: ProjectOverviewAdminReadinessStatus;
    detail: string;
    url: string | null;
  };
  currentIdentity: {
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileRevision: number;
  } | null;
  capabilities: {
    keyFindings: boolean;
    sectionAnalysis: string[];
    additionalInsights: boolean;
  };
  analysis: {
    supported: boolean;
    status: ProjectOverviewAdminReadinessStatus;
    detail: string;
    readyCount: number;
    totalCount: number;
    lastGeneratedAt: string | null;
    items: ProjectOverviewAdminReadinessItem[];
  };
  allowedActions: Array<"generate-missing">;
  recommendedNextAction: {
    action: "generate-missing";
    label: "Generate missing analysis" | "Retry failed analysis";
    detail: string;
  } | null;
  explainability: ProjectAiExplainabilityState;
};

export type ProjectOverviewAdminReadinessService = {
  readProjectOverviewAdminState(input: {
    projectId: string;
    user: UserRecord;
  }): Promise<ProjectOverviewAdminState>;
  requestProjectOverviewAdminAction(input: {
    projectId: string;
    user: UserRecord;
    action: "generate-missing";
  }): Promise<ProjectOverviewAdminState>;
};

export const createProjectOverviewAdminReadinessService = (input: {
  metadataStore: MetadataStore;
  overviewAiWorkflow?: Pick<PreschoolOverviewAiPageWorkflow, "resolveCurrentIdentity" | "read">;
  overviewAiExecutor?: Pick<PreschoolOverviewAiPageWorkflow, "execute">;
  additionalAiInsightsWorkflow?: Pick<PreschoolAdditionalAiInsightsWorkflow, "execute">;
  projectOverviewAiAdapters?: readonly ProjectOverviewAiAdapter[];
}): ProjectOverviewAdminReadinessService => {
  const readProjectOverviewAdminState: ProjectOverviewAdminReadinessService["readProjectOverviewAdminState"] = async ({ projectId, user }) => {
    const project = input.metadataStore.energyIq.getProject(projectId);
    const profile = resolveProjectOverviewProfile(input.metadataStore, project.id);
    const customerOverview = profile && project.status === "published"
      ? {
          status: "ready" as const,
          detail: "The published customer Overview is available.",
          url: `/energyiq/overview?projectId=${encodeURIComponent(project.id)}`,
        }
      : profile
        ? {
            status: "not-generated" as const,
            detail: "Publish the Project before customers can open its Overview.",
            url: null,
          }
        : {
            status: "needs-attention" as const,
            detail: "Assign a registered customer Overview before publishing this Project.",
            url: null,
          };

    const projectAdapter = findProjectOverviewAiAdapter(
      input.projectOverviewAiAdapters ?? [],
      profile?.rendererKey ?? null,
      project.id,
    );
    if (profile?.rendererKey !== "preschool-overview" && projectAdapter) {
      const identity = await projectAdapter.resolveIdentity({
        projectId: project.id,
        scopeId: project.root_scope_id,
        user,
        request: { kind: "current" },
      });
      const readModel = await projectAdapter.readExact({ identity, user });
      const surface = projectAdapter.resolveSurface?.(identity) ?? legacyAdapterSurface(projectAdapter, identity);
      const adapterState = projectAdapterAdminState(
        surface,
        identity,
        readModel,
        projectAdapter.resolveSurface !== undefined,
      );
      return {
        projectId: project.id,
        projectName: project.name,
        rendererKey: projectAdapter.rendererKey,
        customerOverview,
        ...adapterState,
        explainability: unavailableProjectAiExplainabilityState(
          "No saved Artifact explainability trace is available yet for this Project adapter.",
        ),
      };
    }

    if (profile?.rendererKey !== "preschool-overview") {
      return {
        projectId: project.id,
        projectName: project.name,
        rendererKey: profile?.rendererKey ?? null,
        customerOverview,
        currentIdentity: null,
        capabilities: {
          keyFindings: false,
          sectionAnalysis: [],
          additionalInsights: false,
        },
        analysis: {
          supported: false,
          status: "not-generated",
          detail: profile?.rendererKey === "ngee-ann-overview"
            ? "This Project uses its existing Ngee Ann Overview analysis path. Layer 1–3 readiness is not connected yet."
            : profile?.rendererKey === "energy-template-overview"
              ? "This published Overview is deterministic; no AI analysis workflow is assigned to this renderer."
              : "AI readiness is not available until a registered customer Overview is assigned.",
          readyCount: 0,
          totalCount: 0,
          lastGeneratedAt: null,
          items: [],
        },
        allowedActions: [],
        recommendedNextAction: null,
        explainability: unavailableProjectAiExplainabilityState(
          "AI explainability is not available for this Project renderer.",
        ),
      };
    }

    if (project.status !== "published" || !input.overviewAiWorkflow) {
      return unavailablePreschoolState({
        projectId: project.id,
        projectName: project.name,
        customerOverview,
        detail: project.status !== "published"
          ? "Publish the Project before generating analysis."
          : "The AI analysis workflow is not connected.",
      });
    }

    let identity: OverviewAiArtifactIdentityV13;
    try {
      identity = await input.overviewAiWorkflow.resolveCurrentIdentity({
        projectId: project.id,
        scopeId: project.root_scope_id,
        user,
      });
    } catch (reason) {
      const unavailableCustomerOverview = {
        status: "needs-attention" as const,
        detail: readableError(reason, "Current Overview facts are unavailable for the published Project."),
        url: null,
      };
      return unavailablePreschoolState({
        projectId: project.id,
        projectName: project.name,
        customerOverview: unavailableCustomerOverview,
        detail: readableError(reason, "Current data is not ready for AI analysis."),
      });
    }

    const readModel = await input.overviewAiWorkflow.read({ identity, user });
    const items = readinessItems(readModel, identity);
    const readyCount = items.filter((item) => item.status === "ready" || item.status === "no-new-insight").length;
    const analysisStatus = aggregateAnalysisStatus(items);
    const canGenerateMissing = items.some((item) => item.status === "not-generated");
    const canRetryFailedCore = items.some((item) => retryTargetForItem(item) !== null);
    const canRetryFailedAdditional = items.some((item) =>
      item.status === "needs-attention"
      && item.id === "additional-insights"
      && Boolean(item.artifactId));
    const canGenerateOrRetry = canGenerateMissing || canRetryFailedCore || canRetryFailedAdditional;
    const lastGeneratedAt = latestTimestamp(items.flatMap((item) =>
      item.completedAt && (item.status === "ready" || item.status === "no-new-insight")
        ? [item.completedAt]
        : []));

    return {
      projectId: project.id,
      projectName: project.name,
      rendererKey: profile.rendererKey,
      customerOverview,
      currentIdentity: {
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
        analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
        modelProfileRevision: identity.modelProfileRevision,
      },
      capabilities: {
        keyFindings: true,
        sectionAnalysis: [...PRESCHOOL_SECTION_IDS],
        additionalInsights: true,
      },
      analysis: {
        supported: true,
        status: analysisStatus,
        detail: analysisDetail(analysisStatus, readyCount, items.length),
        readyCount,
        totalCount: items.length,
        lastGeneratedAt,
        items,
      },
      allowedActions: canGenerateOrRetry ? ["generate-missing"] : [],
      recommendedNextAction: canGenerateOrRetry
          ? {
            action: "generate-missing",
            label: canGenerateMissing ? "Generate missing analysis" : "Retry failed analysis",
            detail: canGenerateMissing
              ? "Create only the current analysis results that have not been saved yet."
              : "Retry only the current analysis results that failed.",
          }
        : null,
      explainability: readExplainability({
        metadataStore: input.metadataStore,
        workspaceId: identity.workspaceId,
        projectId: project.id,
        readModel,
      }),
    };
  };

  return {
    readProjectOverviewAdminState,
    async requestProjectOverviewAdminAction({ projectId, user, action }) {
      if (action !== "generate-missing") throw new Error("ENERGYIQ_OVERVIEW_ADMIN_ACTION_INVALID");
      const before = await readProjectOverviewAdminState({ projectId, user });
      if (!before.allowedActions.includes("generate-missing")) return before;
      const project = input.metadataStore.energyIq.getProject(projectId);
      const profile = resolveProjectOverviewProfile(input.metadataStore, project.id);
      const projectAdapter = findProjectOverviewAiAdapter(
        input.projectOverviewAiAdapters ?? [],
        profile?.rendererKey ?? null,
        project.id,
      );
      if (profile?.rendererKey !== "preschool-overview" && projectAdapter) {
        const identity = await projectAdapter.resolveIdentity({
          projectId,
          scopeId: project.root_scope_id,
          user,
          request: { kind: "current" },
        });
        const hasMissing = before.analysis.items.some((item) => item.status === "not-generated");
        if (hasMissing) {
          await projectAdapter.generateMissing({ identity, user });
        } else {
          for (const retryTarget of projectAdapterRetryTargets(
            before.analysis.items,
            before.capabilities.sectionAnalysis,
          )) {
            await projectAdapter.generateMissing({ identity, user, retryTarget });
          }
        }
        return readProjectOverviewAdminState({ projectId, user });
      }
      if (!input.overviewAiWorkflow || !input.overviewAiExecutor) {
        throw new Error("ENERGYIQ_OVERVIEW_AI_SERVER_WORKFLOW_REQUIRED");
      }
      const identity = await input.overviewAiWorkflow.resolveCurrentIdentity({
        projectId,
        scopeId: project.root_scope_id,
        user,
      });
      const missingCore = before.analysis.items.some((item) =>
        item.status === "not-generated" && (item.id === "key-findings" || item.id.startsWith("section:")));
      const missingAdditional = before.analysis.items.some((item) =>
        item.status === "not-generated" && item.id === "additional-insights");
      const failedAdditional = before.analysis.items.some((item) =>
        item.status === "needs-attention" && item.id === "additional-insights");
      const failedCoreTargets = before.analysis.items.flatMap((item) => {
        const target = retryTargetForItem(item);
        return target ? [target] : [];
      });
      if (missingCore) {
        await input.overviewAiExecutor.execute({ identity, user, retry: false });
      } else {
        for (const retryTarget of failedCoreTargets) {
          await input.overviewAiExecutor.execute({ identity, user, retry: true, retryTarget });
        }
      }
      const additionalAiInsightsWorkflow = input.additionalAiInsightsWorkflow;
      if (missingAdditional || failedAdditional) {
        if (!additionalAiInsightsWorkflow) {
          throw new Error("ENERGYIQ_ADDITIONAL_AI_SERVER_WORKFLOW_REQUIRED");
        }
        await additionalAiInsightsWorkflow.execute({ baseIdentity: identity, user });
      }
      return readProjectOverviewAdminState({ projectId, user });
    },
  };
};

const projectAdapterAdminState = (
  surface: ProjectOverviewAiSurfaceDefinition,
  identity: EnergyIqOverviewAiArtifactIdentity,
  readModel: ProjectOverviewAiReadModel | null,
  requireExactSurface = false,
): Pick<ProjectOverviewAdminState,
  "currentIdentity" | "capabilities" | "analysis" | "allowedActions" | "recommendedNextAction"> => {
  const unitEntries = readModel && projectOverviewAiReadModelMatchesIdentity(
    readModel,
    identity,
    requireExactSurface ? surface : undefined,
  )
    ? [
        ...(surface.keyFindings
          ? [adapterUnitItem("key-findings", surface.keyFindings.label, readModel.keyFindings)]
          : []),
        ...surface.sections.map(({ id, label }) => adapterUnitItem(`section:${id}`, label, readModel.sections[id]
          ?? { status: "unavailable", reason: `${label} has not been generated.` })),
        ...(surface.additionalInsights
          ? [adapterUnitItem("additional-insights", surface.additionalInsights.label, readModel.additionalInsights)]
          : []),
      ]
    : [
        ...(surface.keyFindings ? [missingItem("key-findings", surface.keyFindings.label)] : []),
        ...surface.sections.map(({ id, label }) => missingItem(`section:${id}`, label)),
        ...(surface.additionalInsights
          ? [missingItem("additional-insights", surface.additionalInsights.label)]
          : []),
      ];
  const readyCount = unitEntries.filter(({ status }) => status === "ready" || status === "no-new-insight").length;
  const status = aggregateAnalysisStatus(unitEntries);
  const canGenerate = unitEntries.some(({ status: itemStatus }) => itemStatus === "not-generated" || itemStatus === "needs-attention");
  return {
    currentIdentity: {
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
      modelProfileRevision: identity.modelProfileRevision,
    },
    capabilities: {
      keyFindings: surface.keyFindings !== undefined,
      sectionAnalysis: surface.sections.map(({ id }) => id),
      additionalInsights: surface.additionalInsights !== undefined,
    },
    analysis: {
      supported: true,
      status,
      detail: analysisDetail(status, readyCount, unitEntries.length),
      readyCount,
      totalCount: unitEntries.length,
      lastGeneratedAt: latestTimestamp(unitEntries.flatMap((item) => item.completedAt ? [item.completedAt] : [])),
      items: unitEntries,
    },
    allowedActions: canGenerate ? ["generate-missing"] : [],
    recommendedNextAction: canGenerate
      ? {
          action: "generate-missing",
          label: unitEntries.some(({ status: itemStatus }) => itemStatus === "not-generated")
            ? "Generate missing analysis"
            : "Retry failed analysis",
          detail: "Create or retry only the current analysis results that are missing or need attention.",
        }
      : null,
  };
};

const adapterUnitItem = (
  id: string,
  label: string,
  unit: ProjectOverviewAiUnitStatus,
): ProjectOverviewAdminReadinessItem => {
  if (unit.status === "missing") return missingItem(id, label);
  if (unit.status === "failed") {
    return {
      id,
      label,
      status: "needs-attention",
      detail: readableReason(unit.reason),
      artifactId: unit.artifactId,
      ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
    };
  }
  return unitItem(id, label, unit as PreschoolOverviewAiUnitStatus<unknown>);
};

const retryTargetForItem = (
  item: ProjectOverviewAdminReadinessItem,
): PreschoolOverviewAiRetryTarget | null => {
  if (item.status !== "needs-attention" || !item.artifactId) return null;
  if (item.id === "key-findings") return "executive-synthesis";
  if (!item.id.startsWith("section:")) return null;
  const sectionId = item.id.slice("section:".length);
  return PRESCHOOL_SECTION_IDS.includes(sectionId as PreschoolSectionId)
    ? sectionId as PreschoolSectionId
    : null;
};

const projectAdapterRetryTargets = (
  items: readonly ProjectOverviewAdminReadinessItem[],
  sectionIds: readonly string[],
): string[] => items.flatMap((item) => {
  if (item.status !== "needs-attention" || !item.artifactId) return [];
  if (item.id === "key-findings") return ["executive-synthesis"];
  if (item.id === "additional-insights") return ["additional-insights"];
  if (!item.id.startsWith("section:")) return [];
  const sectionId = item.id.slice("section:".length);
  return sectionIds.includes(sectionId) ? [sectionId] : [];
});

const legacyAdapterSurface = (
  adapter: ProjectOverviewAiAdapter,
  identity: EnergyIqOverviewAiArtifactIdentity,
): ProjectOverviewAiSurfaceDefinition => ({
  overviewDefinitionRevision: identity.projectReleaseId,
  ...(adapter.keyFindings
    ? { keyFindings: { slotId: "key-findings", regionId: "legacy-key-findings", label: "Key Findings", order: 0 } }
    : {}),
  sections: adapter.sections,
  ...(adapter.additionalInsights
    ? { additionalInsights: { slotId: "additional-insights", regionId: "legacy-additional-insights", label: "Additional AI Insights", order: 999 } }
    : {}),
});

const unavailablePreschoolState = (input: {
  projectId: string;
  projectName: string;
  customerOverview: ProjectOverviewAdminState["customerOverview"];
  detail: string;
}): ProjectOverviewAdminState => ({
  projectId: input.projectId,
  projectName: input.projectName,
  rendererKey: "preschool-overview",
  customerOverview: input.customerOverview,
  currentIdentity: null,
  capabilities: {
    keyFindings: true,
    sectionAnalysis: [...PRESCHOOL_SECTION_IDS],
    additionalInsights: true,
  },
  analysis: {
    supported: true,
    status: "needs-attention",
    detail: input.detail,
    readyCount: 0,
    totalCount: PRESCHOOL_SECTION_IDS.length + 2,
    lastGeneratedAt: null,
    items: [],
  },
  allowedActions: [],
  recommendedNextAction: null,
  explainability: unavailableProjectAiExplainabilityState(input.detail),
});

const readExplainability = (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  readModel: PreschoolOverviewAiReadModel | null;
}): ProjectAiExplainabilityState => {
  const governance = input.metadataStore.energyIq.insightMethodGovernance;
  let publishedWorkspaceMethods: ReturnType<typeof governance.listPublishedWorkspaceMethodResources> = [];
  let declaredUnavailableDetail: string | undefined;
  try {
    publishedWorkspaceMethods = governance.listPublishedWorkspaceMethodResources({
      workspaceId: input.workspaceId,
    });
  } catch {
    declaredUnavailableDetail = "Workspace Method catalog is temporarily unavailable; built-in capabilities and the saved Artifact trace remain visible.";
  }
  let proposals: ReturnType<typeof governance.listProposals> = [];
  let governanceUnavailableDetail: string | undefined;
  try {
    proposals = governance.listProposals({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
  } catch {
    governanceUnavailableDetail = "Project Method Proposal lifecycle is temporarily unavailable.";
  }
  return projectAiExplainabilityState({
    workspaceId: input.workspaceId,
    readModel: input.readModel,
    publishedWorkspaceMethods,
    proposals,
    ...(declaredUnavailableDetail ? { declaredUnavailableDetail } : {}),
    ...(governanceUnavailableDetail ? { governanceUnavailableDetail } : {}),
  });
};

const readinessItems = (
  readModel: PreschoolOverviewAiReadModel | null,
  identity: OverviewAiArtifactIdentityV13,
): ProjectOverviewAdminReadinessItem[] => {
  if (!readModel) return missingPreschoolItems();
  if (!sameBinding(readModel, identity)) {
    return missingPreschoolItems().map((item) => ({
      ...item,
      status: "needs-attention",
      detail: "The saved analysis failed exact Snapshot, Release, period, or model identity validation.",
    }));
  }
  return [
    unitItem("key-findings", "Key Findings", readModel.executive),
    ...PRESCHOOL_SECTION_IDS.map((sectionId) => unitItem(
      `section:${sectionId}`,
      SECTION_LABELS[sectionId],
      readModel.sections[sectionId],
    )),
    readModel.additional
      ? unitItem("additional-insights", "Additional AI Insights", readModel.additional)
      : missingItem("additional-insights", "Additional AI Insights"),
  ];
};

const missingPreschoolItems = (): ProjectOverviewAdminReadinessItem[] => [
  missingItem("key-findings", "Key Findings"),
  ...PRESCHOOL_SECTION_IDS.map((sectionId) => missingItem(`section:${sectionId}`, SECTION_LABELS[sectionId])),
  missingItem("additional-insights", "Additional AI Insights"),
];

const missingItem = (id: string, label: string): ProjectOverviewAdminReadinessItem => ({
  id,
  label,
  status: "not-generated",
  detail: `${label} has not been generated for the current data.`,
});

const unitItem = (
  id: string,
  label: string,
  unit: PreschoolOverviewAiUnitStatus<unknown>,
): ProjectOverviewAdminReadinessItem => {
  switch (unit.status) {
    case "queued":
    case "running":
      return { id, label, status: "generating", detail: `${label} is being generated.` };
    case "available":
      return {
        id,
        label,
        status: "ready",
        detail: `${label} is ready for the current data.`,
        artifactId: unit.artifactId,
        ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
      };
    case "empty":
      return {
        id,
        label,
        status: "no-new-insight",
        detail: "No new insight was found for this data update.",
        artifactId: unit.artifactId,
        ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
      };
    case "unavailable": {
      const notGenerated = /not (?:been )?generated/iu.test(unit.reason);
      return {
        id,
        label,
        status: notGenerated ? "not-generated" : "needs-attention",
        detail: notGenerated ? `${label} has not been generated for the current data.` : readableReason(unit.reason),
        ...(unit.artifactId ? { artifactId: unit.artifactId } : {}),
        ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
      };
    }
  }
};

const aggregateAnalysisStatus = (items: ProjectOverviewAdminReadinessItem[]): ProjectOverviewAdminReadinessStatus => {
  if (items.some(({ status }) => status === "out-of-date")) return "out-of-date";
  if (items.some(({ status }) => status === "generating")) return "generating";
  if (items.some(({ status }) => status === "needs-attention")) return "needs-attention";
  if (items.some(({ status }) => status === "not-generated")) return "not-generated";
  if (items.every(({ status }) => status === "no-new-insight")) return "no-new-insight";
  return "ready";
};

const analysisDetail = (
  status: ProjectOverviewAdminReadinessStatus,
  readyCount: number,
  totalCount: number,
): string => {
  if (status === "ready") return `All ${totalCount} saved analysis results are ready.`;
  if (status === "no-new-insight") return "No new insight was found for this data update.";
  if (status === "generating") return `${readyCount} of ${totalCount} saved analysis results are ready; generation is continuing.`;
  if (status === "out-of-date") return "Saved analysis is out of date for the current data.";
  if (status === "needs-attention") return `${readyCount} of ${totalCount} saved analysis results are ready; one or more items need attention.`;
  return `${readyCount} of ${totalCount} saved analysis results are ready; missing results can be generated.`;
};

const sameBinding = (
  readModel: PreschoolOverviewAiReadModel,
  identity: OverviewAiArtifactIdentityV13,
): boolean => readModel.binding.workspaceId === identity.workspaceId
  && readModel.binding.projectId === identity.projectId
  && readModel.binding.scopeId === identity.scopeId
  && readModel.binding.dataSnapshotId === identity.dataSnapshotId
  && readModel.binding.projectReleaseId === identity.projectReleaseId
  && readModel.binding.analysisPeriod.from === identity.analysisPeriodFrom
  && readModel.binding.analysisPeriod.to === identity.analysisPeriodTo
  && readModel.binding.modelProfileId === identity.modelProfileId
  && readModel.binding.modelProfileRevision === identity.modelProfileRevision;

const readableReason = (value: string): string => {
  if (!value.trim()) return "This analysis needs attention.";
  if (/^[A-Z0-9_:-]+$/u.test(value)) return "This analysis needs attention. Open Technical details for the failure code.";
  return value;
};

const readableError = (value: unknown, fallback: string): string =>
  value instanceof Error && value.message && !/^[A-Z0-9_:-]+$/u.test(value.message)
    ? value.message
    : fallback;

const latestTimestamp = (values: string[]): string | null => values
  .filter((value) => Number.isFinite(Date.parse(value)))
  .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

const SECTION_LABELS: Record<PreschoolSectionId, string> = {
  "centre-benchmark": "Centre benchmark",
  "standby-wastage": "Closed-hours use",
  "operating-behaviour": "Operating-hours behaviour",
  "planning-outlook": "Planning outlook",
};

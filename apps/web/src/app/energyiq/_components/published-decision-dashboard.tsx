"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptAiSlotHtmlArtifact,
  PRESCHOOL_HTML_AI_SLOT_IDS,
  reportTimeBasisFromContext,
} from "@datafoundry/contracts";

import {
  ConfigApiError,
  configApi,
  type EnergyProjectAnalysisSnapshotDto,
  type EnergyProjectAnalysisResolutionDto,
  type EnergyProjectOverviewMinimumDto,
  type EnergyProjectHierarchyDto,
  type EnergyQueryContextRequestDto,
  type EnergySavedAnalysisDetailDto,
  type EnergySavedAnalysisAiArtifactInputDto,
  type EnergyScopeAnalysisDto,
  type EnergyPreschoolHtmlAiSlotReadModelDto,
} from "../../../lib/config-api";
import {
  EnergyTemplateRenderer,
  type EnergyTemplateRendererState,
} from "./energy-template-renderer";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import { EnergySelect } from "./energy-select";
import { useEnergyIqAccess } from "./energyiq-access";
import { EnergyIcon } from "./icons";
import { OverviewHistoryDialog } from "./overview-history-dialog";
import {
  overviewHistoryStateFromSearchParams,
  overviewUrlWithHistory,
  type OverviewHistoryState,
} from "./overview-history-state";
import {
  OverviewSectionNavigation,
} from "./overview-section-navigation";
import { OverviewChangeDialog } from "./overview-change-dialog";
import { formatReportDataThrough, formatSourceDataCoverage } from "./overview-report-time";
import { useOverviewSectionOutline } from "./overview-section-outline";
import { buildPreschoolAiArtifactReadInput, invalidatePreschoolAiRun } from "./preschool-ai-run";
import { buildPreschoolHtmlAiSlotPreview } from "./preschool-html-ai-slot-preview";
import type { PreschoolHtmlAiSlotRenderSet } from "./preschool-html-ai-slot-presentation";
import { orderProjectNodesDepthFirst } from "./project-tree-model";
import { resolveProgressiveCurrentOverview } from "./progressive-current-overview";
import {
  applyProjectAnalysisQualityPolicy,
  ProjectRenderer,
  type ProjectAnalysisQualityPolicy,
  type ProjectRendererState,
} from "./project-renderer-registry";
import { ScopeMetadataStatus } from "./scope-metadata-status";

const periodOptions: ReadonlyArray<{
  label: string;
  value?: OverviewPeriod;
  disabled?: boolean;
  title?: string;
}> = [
  { label: "Yesterday", value: "Yesterday" },
  { label: "Last 7 days", value: "Last 7 days" },
  { label: "Previous week", value: "Previous week" },
  { label: "Previous month", value: "Previous month" },
  { label: "Custom", value: "Custom" },
];
type OverviewPeriod = "Yesterday" | "Last 7 days" | "Previous week" | "Previous month" | "Custom";
type ResourceType = "electricity" | "water";
const ALL_OVERVIEW_RESOURCES = ["electricity", "water"] as const;
const ELECTRICITY_ONLY_RESOURCES = ["electricity"] as const;
const HTML_AI_BINDING_REVALIDATION_MS = 30_000;
export type OverviewComparison = "overlay" | "selected" | "average";
export type OverviewCategory = "all" | "load" | "light";
export type CurrentOverviewPin = {
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};
export type OverviewUrlViewState = {
  projectId: string;
  scopeId: string;
  resource: ResourceType;
  period: OverviewPeriod;
  from: string;
  to: string;
  grain: "day" | "hour";
  comparison: OverviewComparison;
  category: OverviewCategory;
  currentOverviewPin?: CurrentOverviewPin;
};

type LoadedResolution = {
  projectId: string;
  projectName: string;
  value: EnergyProjectAnalysisResolutionDto;
};

type LoadedMinimumOverview = {
  projectId: string;
  value: EnergyProjectOverviewMinimumDto;
};

function usesDedicatedCurrentOverview(projectId: string) {
  return projectId === "ngee-ann-polytechnic"
    || projectId === "preschool-demo"
    || projectId === "tuya-office";
}

export function PublishedDecisionDashboard() {
  const searchParams = useSearchParams();
  const urlSearch = searchParams.toString();
  const currentOverviewPinParts = [
    searchParams.get("currentFrom")?.trim() || "",
    searchParams.get("currentTo")?.trim() || "",
    searchParams.get("currentDataSnapshotId")?.trim() || "",
    searchParams.get("currentProjectReleaseId")?.trim() || "",
  ];
  const hasMalformedCurrentOverviewPin = currentOverviewPinParts.some(Boolean)
    && !currentOverviewPinParts.every(Boolean);
  const initialViewState = useMemo(
    () => overviewViewStateFromSearchParams(new URLSearchParams(urlSearch)),
    [urlSearch],
  );
  const historyState = useMemo(
    () => overviewHistoryStateFromSearchParams(new URLSearchParams(urlSearch)),
    [urlSearch],
  );
  const hasExplicitPeriod = searchParams.has("period");
  const viewStateProjectKey = !hasExplicitPeriod && usesDedicatedCurrentOverview(initialViewState.projectId)
    ? "dedicated-current-overview"
    : initialViewState.projectId;
  const viewStateKey = [
    viewStateProjectKey,
    initialViewState.scopeId,
    initialViewState.resource,
    initialViewState.period,
    initialViewState.from,
    initialViewState.to,
    hasExplicitPeriod ? "legacy-window" : "current-window",
  ].join(":");
  return (
    <PublishedDecisionDashboardView
      key={viewStateKey}
      initialViewState={initialViewState}
      urlSearch={urlSearch}
      historyState={historyState}
      hasMalformedCurrentOverviewPin={hasMalformedCurrentOverviewPin}
    />
  );
}

function PublishedDecisionDashboardView({
  initialViewState,
  urlSearch,
  historyState,
  hasMalformedCurrentOverviewPin,
}: {
  initialViewState: OverviewUrlViewState;
  urlSearch: string;
  historyState: OverviewHistoryState;
  hasMalformedCurrentOverviewPin: boolean;
}) {
  const router = useRouter();
  const { access, activeProject, selectProject } = useEnergyIqAccess();
  const requestedProject = initialViewState.projectId && access
    ? access.projects.find((candidate) => candidate.id === initialViewState.projectId
      && candidate.status === "published"
      && candidate.workspaceId === access.activeWorkspaceId) ?? null
    : null;
  const selectedProject = initialViewState.projectId ? requestedProject : activeProject;
  const projectSelectionError = initialViewState.projectId && access && !requestedProject
    ? "Requested Project is unavailable in the active workspace."
    : null;
  const [resolvedRange, setResolvedRange] = useState({
    projectId: "",
    from: "",
    to: "",
  });
  const [resolution, setResolution] = useState<LoadedResolution | null>(null);
  const [minimumOverview, setMinimumOverview] = useState<LoadedMinimumOverview | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [automaticRecoveryPending, setAutomaticRecoveryPending] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [lifecycleLoadRevision, setLifecycleLoadRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<EnergySavedAnalysisDetailDto | null>(null);
  const [aiArtifact, setAiArtifact] = useState<EnergySavedAnalysisAiArtifactInputDto | null>(null);
  const [htmlAiSlots, setHtmlAiSlots] = useState<PreschoolHtmlAiSlotRenderSet | null>(null);
  const [htmlAiSlotsIdentity, setHtmlAiSlotsIdentity] = useState<string | null>(null);
  const [htmlAiReadFailed, setHtmlAiReadFailed] = useState(false);
  const [htmlAiGenerationPending, setHtmlAiGenerationPending] = useState(false);
  const [htmlAiGenerationError, setHtmlAiGenerationError] = useState<string | null>(null);
  const [htmlAiServerBinding, setHtmlAiServerBinding] = useState<EnergyPreschoolHtmlAiSlotReadModelDto["binding"] | null>(null);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [hierarchy, setHierarchy] = useState<EnergyProjectHierarchyDto | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const htmlAiIdentityRef = useRef<string | null>(null);
  const htmlAiReadRevisionRef = useRef(0);

  const projectId = selectedProject?.id ?? "";
  const isNgeeAnnProject = projectId === "ngee-ann-polytechnic";
  const isPreschoolProject = projectId === "preschool-demo";
  const isDedicatedOverviewProject = usesDedicatedCurrentOverview(projectId);
  const resource = isDedicatedOverviewProject ? "electricity" : initialViewState.resource;
  const scopeId = isDedicatedOverviewProject ? "project" : initialViewState.scopeId;
  const period = isPreschoolProject ? "Custom" : initialViewState.period;
  const usesCurrentOverviewWindow = isDedicatedOverviewProject;
  const effectiveCustomRange = period === "Custom"
      ? { projectId, from: initialViewState.from, to: initialViewState.to }
      : resolvedRange.projectId === projectId
        ? resolvedRange
        : { projectId, from: "", to: "" };
  const requestCustomRange = period === "Custom"
    ? { from: effectiveCustomRange.from, to: effectiveCustomRange.to }
    : { from: "", to: "" };
  const queryValidationError = usesCurrentOverviewWindow
    ? hasMalformedCurrentOverviewPin
      ? "Current Overview link has an incomplete report identity."
      : null
    : validateOverviewCustomRange(period, effectiveCustomRange.from, effectiveCustomRange.to);
  const requestedProjectId = requestedProject?.id ?? "";
  const pendingUrlSearchRef = useRef(urlSearch);
  const resolutionRef = useRef<LoadedResolution | null>(null);
  const refreshRequestRevisionRef = useRef<number | null>(null);
  const automaticRecoveryNavigationIdentityRef = useRef<string | null>(null);
  const automaticRecoveryAttemptedRef = useRef<string | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const overviewContentRef = useRef<HTMLDivElement>(null);
  const lifecycleRequestRevisionRef = useRef(0);

  const currentProjectionRef = resolution?.value.status === "ready"
    ? resolution.value.overviewContext?.projectionRef ?? null
    : null;

  useEffect(() => {
    if (!projectId || !currentProjectionRef || resolution?.projectId !== projectId) return;
    const requestRevision = lifecycleRequestRevisionRef.current + 1;
    lifecycleRequestRevisionRef.current = requestRevision;
    let cancelled = false;
    void configApi.getCurrentProjectOverviewLifecycle(projectId, currentProjectionRef)
      .then((lifecycle) => {
        if (cancelled
          || lifecycleRequestRevisionRef.current !== requestRevision
          || lifecycle.projectionRef !== currentProjectionRef) return;
        setResolution((current) => {
          if (!current || current.projectId !== projectId || current.value.status !== "ready"
            || current.value.overviewContext?.projectionRef !== lifecycle.projectionRef) return current;
          const next: LoadedResolution = {
            ...current,
            value: {
              ...current.value,
              snapshot: {
                ...current.value.snapshot,
                ...(lifecycle.decisionLifecycle
                  ? { decisionLifecycle: lifecycle.decisionLifecycle }
                  : {}),
                ...(lifecycle.preschoolPlanningLifecycle
                  ? { preschoolPlanningLifecycle: lifecycle.preschoolPlanningLifecycle }
                  : {}),
              },
            },
          };
          resolutionRef.current = next;
          return next;
        });
      })
      .catch(() => {
        // Mutable lifecycle is a targeted enhancement. The immutable Overview remains usable.
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectionRef, lifecycleLoadRevision, projectId, resolution?.projectId]);

  useEffect(() => {
    pendingUrlSearchRef.current = urlSearch;
  }, [urlSearch]);

  const navigateHistory = (
    nextHistoryState: OverviewHistoryState,
    mode: "push" | "replace" = "push",
  ) => {
    const href = overviewUrlWithHistory(pendingUrlSearchRef.current, nextHistoryState);
    pendingUrlSearchRef.current = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    if (mode === "replace") router.replace(href);
    else router.push(href);
  };

  useEffect(() => {
    if (!isDedicatedOverviewProject || initialViewState.resource !== "water") return;
    const href = currentOverviewUrlWithView({
      ...initialViewState,
      projectId,
      scopeId: "project",
      resource: "electricity",
    });
    pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
    router.replace(href);
  }, [initialViewState, isDedicatedOverviewProject, projectId, router]);

  const navigateOverview = (update: Partial<OverviewUrlViewState>) => {
    const base = overviewViewStateFromSearchParams(new URLSearchParams(pendingUrlSearchRef.current));
    const requestedNextView = {
      ...base,
      ...update,
      projectId: update.projectId ?? (base.projectId || projectId),
      scopeId: isDedicatedOverviewProject ? "project" : update.scopeId ?? base.scopeId,
    };
    const nextView = isPreschoolProject
      ? {
          ...requestedNextView,
          scopeId: "project",
          resource: "electricity" as const,
          period: "Custom" as const,
          grain: "day" as const,
        }
      : requestedNextView;
    const href = usesCurrentOverviewWindow
      ? currentOverviewUrlWithView(nextView)
      : overviewUrlWithView(nextView);
    pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
    router.replace(href);
  };

  const refreshOverview = () => {
    if (currentSnapshot?.renderer.key === "preschool-overview") {
      invalidatePreschoolAiRun(buildPreschoolAiArtifactReadInput(currentSnapshot));
    }
    const nextRevision = refreshRevision + 1;
    refreshRequestRevisionRef.current = nextRevision;
    setRefreshRevision(nextRevision);
  };

  const recomputeOverview = async () => {
    if (!projectId || running) return;
    setRunning(true);
    setAnalysisError(null);
    try {
      await configApi.materializeCurrentProjectOverview(projectId);
      refreshOverview();
    } catch (reason) {
      setAnalysisError(customerFacingAnalysisError(reason, "Unable to recompute the current Overview"));
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!requestedProjectId || requestedProjectId === activeProject?.id) return;
    selectProject(requestedProjectId);
  }, [activeProject?.id, requestedProjectId, selectProject]);

  useEffect(() => {
    if (!projectId || isDedicatedOverviewProject) {
      setHierarchy(null);
      setHierarchyError(null);
      setHierarchyLoading(false);
      return;
    }
    let cancelled = false;
    setHierarchy(null);
    setHierarchyError(null);
    setHierarchyLoading(true);
    void configApi.getEnergyProjectHierarchy(projectId)
      .then((result) => {
        if (!cancelled) setHierarchy(result);
      })
      .catch((reason) => {
        if (cancelled) return;
        setHierarchy(null);
        setHierarchyError(messageFrom(reason, "Unable to load Project hierarchy"));
      })
      .finally(() => {
        if (!cancelled) setHierarchyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDedicatedOverviewProject, projectId, refreshRevision]);

  const scopeOptions = useMemo(() => {
    const hierarchyNodes = hierarchy?.nodes ?? [];
    const tierAliases = new Map(hierarchy?.tiers.map((tier) => [tier.id, tier.alias]) ?? []);
    const nodesById = new Map(hierarchyNodes.map((node) => [node.id, node]));
    const orderedNodes = orderProjectNodesDepthFirst(
      hierarchyNodes
        .filter((node) => node.node_type !== "project")
        .map((node) => ({ ...node, parentId: node.parent_id ?? null })),
    );
    return [
      { value: "project", label: `Project · ${selectedProject?.name ?? "Project"}` },
      ...orderedNodes.map((node) => ({
        value: node.id,
        label: `${tierAliases.get(node.tier_definition_id ?? "") ?? node.node_type} · ${scopeNodeDisplayPath(node, nodesById)}`,
      })),
    ];
  }, [hierarchy, selectedProject?.name]);
  const committedMinimumOverview = minimumOverview?.projectId === projectId
    && resolution?.projectId !== projectId
    ? minimumOverview.value
    : null;
  const hasRetainedOverview = Boolean(
    !committedMinimumOverview
      && resolution
      && resolution.projectId !== projectId
      && resolution.value.status === "ready",
  );
  const currentResolution = !committedMinimumOverview
    && (resolution?.projectId === projectId || hasRetainedOverview)
    ? resolution?.value ?? null
    : null;
  const displayedProjectId = committedMinimumOverview
    ? committedMinimumOverview.binding.projectId
    : hasRetainedOverview
      ? resolution?.projectId ?? projectId
      : projectId;
  const displayedProjectName = committedMinimumOverview
    ? committedMinimumOverview.presentation.projectName
    : hasRetainedOverview
    ? resolution?.projectName ?? "Previous Project"
    : selectedProject?.name ?? "Current Project";
  const currentSnapshot = currentResolution?.status === "ready" ? currentResolution.snapshot : null;
  const htmlAiSnapshotIdentity = currentSnapshot
    ? JSON.stringify({
        projectId,
        scopeId: currentSnapshot.context.scopeId,
        ...snapshotLocalDateRange(currentSnapshot),
        dataSnapshotId: currentSnapshot.context.dataSnapshotId,
        projectReleaseId: currentSnapshot.projectRelease.id,
        reportTimePolicyId: htmlAiServerBinding?.reportTimePolicyId ?? null,
        reportTimePolicyRevision: htmlAiServerBinding?.reportTimePolicyRevision ?? null,
        reportTimeContextFingerprint: htmlAiServerBinding?.reportTimeContextFingerprint ?? null,
      })
    : null;
  const htmlAiIdentity = htmlAiSnapshotIdentity
    ? JSON.stringify({
        ...(JSON.parse(htmlAiSnapshotIdentity) as Record<string, unknown>),
        modelProfileId: htmlAiServerBinding?.modelProfileId ?? null,
        modelProfileRevision: htmlAiServerBinding?.modelProfileRevision ?? null,
        promptRevision: htmlAiServerBinding?.promptRevision ?? null,
        slotDefinitionRevisions: htmlAiServerBinding?.slotDefinitionRevisions ?? null,
      })
    : null;
  useEffect(() => {
    htmlAiIdentityRef.current = htmlAiIdentity;
  }, [htmlAiIdentity]);
  const currentHtmlAiSlots = htmlAiSlotsIdentity === htmlAiIdentity ? htmlAiSlots : null;
  const htmlAiQueryMode = new URLSearchParams(urlSearch).get("aiPresentation");
  const htmlAiPreviewRequested = isPreschoolProject && htmlAiQueryMode === "html-preview";
  const releaseEnablesHtmlAiPresentation = currentSnapshot?.projectRelease.renderer?.aiPresentationMode === "html";
  const htmlAiPresentationRequested = isPreschoolProject
    && releaseEnablesHtmlAiPresentation
    && !htmlAiPreviewRequested;

  useEffect(() => {
    if (!htmlAiPresentationRequested || !currentSnapshot) {
      htmlAiReadRevisionRef.current += 1;
      setHtmlAiSlots(null);
      setHtmlAiSlotsIdentity(null);
      setHtmlAiServerBinding(null);
      setHtmlAiReadFailed(false);
      return;
    }
    if (htmlAiServerBinding && htmlAiSlotsIdentity === htmlAiIdentity) return;
    setHtmlAiSlots(null);
    setHtmlAiSlotsIdentity(null);
    setHtmlAiServerBinding(null);
    setHtmlAiReadFailed(false);
    let cancelled = false;
    const requestRevision = ++htmlAiReadRevisionRef.current;
    const requestIdentity = htmlAiIdentity;
    const pin = {
      ...snapshotLocalDateRange(currentSnapshot),
      dataSnapshotId: currentSnapshot.context.dataSnapshotId,
      projectReleaseId: currentSnapshot.projectRelease.id,
    };
    void configApi.getEnergyPreschoolHtmlAiSlots(projectId, currentSnapshot.context.scopeId, pin)
      .then((readModel) => {
        if (!cancelled && htmlAiReadRevisionRef.current === requestRevision
          && htmlAiIdentityRef.current === requestIdentity) {
          setHtmlAiReadFailed(false);
          if (!htmlAiReadModelMatchesSnapshot(readModel, currentSnapshot, projectId)) {
            setHtmlAiSlots(null);
            setHtmlAiSlotsIdentity(null);
            setHtmlAiServerBinding(null);
            return;
          }
          setHtmlAiServerBinding(readModel.binding);
          setHtmlAiSlots(toPreschoolHtmlAiSlotRenderSet(readModel));
          setHtmlAiSlotsIdentity(htmlAiIdentityForReadModel(readModel, htmlAiSnapshotIdentity));
        }
      })
      .catch(() => {
        if (!cancelled && htmlAiReadRevisionRef.current === requestRevision
          && htmlAiIdentityRef.current === requestIdentity) {
          setHtmlAiReadFailed(true);
          setHtmlAiSlots(null);
          setHtmlAiSlotsIdentity(null);
          setHtmlAiServerBinding(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentSnapshot?.context.dataSnapshotId, currentSnapshot?.context.primaryPeriod?.endExclusive, currentSnapshot?.context.primaryPeriod?.start, currentSnapshot?.context.scopeId, currentSnapshot?.projectRelease.id, htmlAiPresentationRequested, projectId, urlSearch]);

  useEffect(() => {
    if (!htmlAiPresentationRequested || !currentSnapshot) return;
    let cancelled = false;
    const pin = {
      ...snapshotLocalDateRange(currentSnapshot),
      dataSnapshotId: currentSnapshot.context.dataSnapshotId,
      projectReleaseId: currentSnapshot.projectRelease.id,
    };
    const revalidateBinding = async () => {
      const requestRevision = ++htmlAiReadRevisionRef.current;
      try {
        const readModel = await configApi.getEnergyPreschoolHtmlAiSlots(projectId, currentSnapshot.context.scopeId, pin);
        if (cancelled || htmlAiReadRevisionRef.current !== requestRevision) return;
        if (!htmlAiReadModelMatchesSnapshot(readModel, currentSnapshot, projectId)) {
          setHtmlAiSlots(null);
          setHtmlAiSlotsIdentity(null);
          setHtmlAiServerBinding(null);
          setHtmlAiReadFailed(false);
          return;
        }
        const nextIdentity = htmlAiIdentityForReadModel(readModel, htmlAiSnapshotIdentity);
        setHtmlAiSlots(null);
        setHtmlAiSlotsIdentity(null);
        setHtmlAiServerBinding(readModel.binding);
        setHtmlAiSlots(toPreschoolHtmlAiSlotRenderSet(readModel));
        setHtmlAiSlotsIdentity(nextIdentity);
        setHtmlAiReadFailed(false);
      } catch {
        if (cancelled || htmlAiReadRevisionRef.current !== requestRevision) return;
        setHtmlAiSlots(null);
        setHtmlAiSlotsIdentity(null);
        setHtmlAiServerBinding(null);
        setHtmlAiReadFailed(true);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void revalidateBinding();
    };
    window.addEventListener("focus", revalidateBinding);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(revalidateBinding, HTML_AI_BINDING_REVALIDATION_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", revalidateBinding);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [currentSnapshot?.context.dataSnapshotId, currentSnapshot?.context.scopeId, currentSnapshot?.projectRelease.id, htmlAiPresentationRequested, htmlAiSnapshotIdentity, projectId]);
  const currentAnalysis = currentSnapshot?.analysis ?? null;
  const latestAvailableRange = currentSnapshot?.latestAvailablePeriod ?? null;
  const projectTemplate = currentSnapshot?.projectRelease.document.templates
    .find((candidate) => candidate.template_id === "project") ?? null;
  const renderPlan = useMemo(
    () => projectTemplate && currentSnapshot
      ? buildEnergyTemplateRenderPlan({ template: projectTemplate, catalog: currentSnapshot.projectRelease.catalog })
      : null,
    [currentSnapshot, projectTemplate],
  );
  const qualityPolicy = useMemo(
    () => renderPlan && currentSnapshot
      ? applyProjectAnalysisQualityPolicy({
        plan: renderPlan,
        dataQuality: currentSnapshot.dataQuality,
      })
      : null,
    [currentSnapshot, renderPlan],
  );
  const renderPlanForDisplay = qualityPolicy?.plan ?? renderPlan;
  const saveAllowed = Boolean(
    qualityPolicy?.saveAllowed && currentSnapshot?.projectRelease.templateRevisionId,
  );
  const aiArtifactMatchesCurrent = Boolean(currentSnapshot
    && aiArtifact
    && aiArtifact.snapshotId === currentSnapshot.dataSnapshot.id
    && aiArtifact.rendererKey === currentSnapshot.renderer.key
    && aiArtifact.projectReleaseId === currentSnapshot.projectRelease.id
    && (!currentSnapshot.reportTimeContext
      || Boolean(aiArtifact.reportTimeBasis
        && JSON.stringify(aiArtifact.reportTimeBasis)
          === JSON.stringify(reportTimeBasisFromContext(currentSnapshot.reportTimeContext)))));

  useEffect(() => {
    setAiArtifact(null);
    setChangeDialogOpen(false);
  }, [
    currentSnapshot?.dataSnapshot.id,
    currentSnapshot?.projectRelease.id,
    currentSnapshot?.renderer.key,
    currentSnapshot?.reportTimeContext?.policyRevision,
    currentSnapshot?.reportTimeContext?.acceptedDataEndExclusive,
  ]);

  useEffect(() => {
    if (!projectId || resource !== "electricity" || projectSelectionError || queryValidationError) return;
    let cancelled = false;
    const isUserRefresh = refreshRevision > 0
      && refreshRequestRevisionRef.current === refreshRevision;
    const trustedCurrentPin = initialViewState.currentOverviewPin;
    const automaticRecoveryIdentity = trustedCurrentPin
      ? JSON.stringify({ projectId, ...trustedCurrentPin })
      : null;
    if (automaticRecoveryNavigationIdentityRef.current !== automaticRecoveryIdentity) {
      automaticRecoveryNavigationIdentityRef.current = automaticRecoveryIdentity;
      automaticRecoveryAttemptedRef.current = null;
    }
    const existingResolution = resolutionRef.current;
    if (!isUserRefresh
      && usesCurrentOverviewWindow
      && trustedCurrentPin
      && existingResolution?.projectId === projectId
      && currentOverviewPinMatchesResolution(trustedCurrentPin, existingResolution.value)) {
      return;
    }
    if (!isUserRefresh
      && usesCurrentOverviewWindow
      && trustedCurrentPin
      && automaticRecoveryAttemptedRef.current === automaticRecoveryIdentity) {
      return;
    }
    const request = usesCurrentOverviewWindow
      ? currentOverviewAnalysisRequest(projectId, {
          scopeId,
          resource,
          currentOverviewPin: isUserRefresh ? undefined : initialViewState.currentOverviewPin,
        })
      : overviewAnalysisRequest(projectId, period, requestCustomRange, { scopeId, resource });
    setRunning(true);
    setAnalysisError(null);
    setAutomaticRecoveryPending(false);
    const loadResolution = () => configApi.resolveProjectAnalysis(request);
    const resolutionRequest = usesCurrentOverviewWindow
      ? resolveProgressiveCurrentOverview({
          loadMinimum: () => configApi.getEnergyProjectOverviewMinimum(projectId),
          loadInitial: loadResolution,
          loadExact: (minimum) => configApi.resolveProjectAnalysis(
            currentOverviewAnalysisRequest(projectId, {
              scopeId: "project",
              resource: "electricity",
              currentOverviewPin: minimum.binding.currentPin,
            }),
          ),
          validateMinimum: (minimum) => {
            if (minimum.binding.projectId !== projectId
              || minimum.binding.workspaceId !== selectedProject?.workspaceId
              || !minimumOverviewHasConsistentReportTimeIdentity(minimum)) {
              throw new Error("ENERGYIQ_CURRENT_OVERVIEW_MINIMUM_IDENTITY_MISMATCH");
            }
          },
          minimumMatchesResolution: minimumOverviewMatchesResolution,
          onMinimum: (minimum) => setMinimumOverview({ projectId, value: minimum }),
          onLateIdentityMismatch: (minimum) => {
            if (cancelled) return;
            resolutionRef.current = null;
            setResolution(null);
            setMinimumOverview({ projectId, value: minimum });
            setAnalysisError(null);
            const href = currentOverviewUrlWithView({
              ...initialViewState,
              projectId,
              scopeId: "project",
              currentOverviewPin: minimum.binding.currentPin,
            });
            pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
            router.replace(href, { scroll: false });
          },
          onLateResolution: (result) => {
            if (!cancelled) {
              acceptResolution(result, !initialViewState.currentOverviewPin || isUserRefresh);
            }
          },
          onLateIdentityError: (reason, minimum) => {
            if (cancelled) return;
            resolutionRef.current = null;
            setResolution(null);
            setMinimumOverview({ projectId, value: minimum });
            setAnalysisError(customerFacingAnalysisError(
              reason,
              "Unable to refresh detailed analysis",
            ));
          },
          onLateMinimumValidationError: (reason) => {
            if (cancelled) return;
            resolutionRef.current = null;
            setResolution(null);
            setMinimumOverview(null);
            setAnalysisError(customerFacingAnalysisError(
              reason,
              "Unable to verify the current Overview",
            ));
          },
          isCancelled: () => cancelled,
        })
      : loadResolution();
    const acceptResolution = (
      result: EnergyProjectAnalysisResolutionDto,
      replaceCurrentPin: boolean,
    ) => {
      const loadedResolution = {
        projectId,
        projectName: selectedProject?.name ?? projectId,
        value: result,
      };
      resolutionRef.current = loadedResolution;
      setResolution(loadedResolution);
      setLifecycleLoadRevision((current) => current + 1);
      if (result.status !== "ready") return;
      setResolvedRange({
        projectId,
        from: toDateInput(result.snapshot.context.from, result.snapshot.context.timezone),
        to: toDateInput(new Date(Date.parse(result.snapshot.context.to) - 1).toISOString(), result.snapshot.context.timezone),
      });
      if (usesCurrentOverviewWindow && replaceCurrentPin) {
        const range = snapshotLocalDateRange(result.snapshot);
        const href = currentOverviewUrlWithView({
          ...initialViewState,
          projectId,
          scopeId: "project",
          currentOverviewPin: {
            ...range,
            dataSnapshotId: result.snapshot.context.dataSnapshotId,
            projectReleaseId: result.snapshot.projectRelease.id,
          },
        });
        pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
        router.replace(href, { scroll: false });
      }
    };
    void resolutionRequest
      .then((result) => {
        if (cancelled) return;
        acceptResolution(
          result,
          !initialViewState.currentOverviewPin || isUserRefresh,
        );
      })
      .catch(async (reason) => {
        if (cancelled) return;
        if (usesCurrentOverviewWindow
          && initialViewState.currentOverviewPin
          && !historyState.open
          && automaticRecoveryAttemptedRef.current !== automaticRecoveryIdentity
          && reason instanceof ConfigApiError
          && reason.status !== 401
          && reason.status !== 403
          && (reason.message === "ENERGYIQ_DATA_SNAPSHOT_MISMATCH"
            || reason.message === "ENERGYIQ_PROJECT_RELEASE_MISMATCH"
            || reason.message === "ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH")) {
          automaticRecoveryAttemptedRef.current = automaticRecoveryIdentity;
          setAutomaticRecoveryPending(true);
          try {
            const minimum = await configApi.getEnergyProjectOverviewMinimum(projectId);
            if (cancelled) return;
            setMinimumOverview({ projectId, value: minimum });
            const href = currentOverviewUrlWithView({
              ...initialViewState,
              projectId,
              scopeId: "project",
              currentOverviewPin: minimum.binding.currentPin,
            });
            pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
            router.replace(href, { scroll: false });
            return;
          } catch (recoveryReason) {
            reason = recoveryReason;
          }
        }
        if (cancelled) return;
        const retainedResolution = resolutionRef.current;
        if (!retainedResolution
          || retainedResolution.projectId === projectId
          || retainedResolution.value.status !== "ready") {
          resolutionRef.current = null;
          setResolution(null);
        }
        setAnalysisError(customerFacingAnalysisError(reason, "Unable to run project analysis"));
      })
      .finally(() => {
        if (!cancelled) {
          setAutomaticRecoveryPending(false);
          setRunning(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [historyState.open, initialViewState, period, projectId, projectSelectionError, queryValidationError, refreshRevision, requestCustomRange.from, requestCustomRange.to, resource, router, scopeId, selectedProject?.name, selectedProject?.workspaceId, usesCurrentOverviewWindow]);

  useEffect(() => {
    setSavedAnalysis(null);
    setSaveError(null);
  }, [period, projectId, requestCustomRange.from, requestCustomRange.to, resource]);

  const saveCurrentAnalysis = async () => {
    if (!projectId || !currentAnalysis || !currentSnapshot || !saveAllowed || resource !== "electricity") return;
    setSaving(true);
    setSaveError(null);
    try {
      const resolvedSnapshotRange = snapshotLocalDateRange(currentSnapshot);
      const request = usesCurrentOverviewWindow
        ? currentOverviewAnalysisRequest(projectId, {
            scopeId,
            resource,
            currentOverviewPin: {
              ...resolvedSnapshotRange,
              dataSnapshotId: currentSnapshot.context.dataSnapshotId,
              projectReleaseId: currentSnapshot.projectRelease.id,
            },
          })
        : overviewAnalysisRequest(projectId, period, requestCustomRange, { scopeId, resource });
      const saved = await configApi.saveEnergyAnalysis(projectId, {
        ...request,
        title: `${currentAnalysis.context.scopeName} · ${formatAnalysisWindow(currentSnapshot)}`,
        viewState: {
          grain: initialViewState.grain,
          comparison: initialViewState.comparison,
          category: initialViewState.category,
        },
        ...(aiArtifactMatchesCurrent && aiArtifact
          ? { aiArtifact }
          : {}),
      });
      setSavedAnalysis(saved);
    } catch (reason) {
      setSavedAnalysis(null);
      setSaveError(messageFrom(reason, "Unable to save this analysis"));
    } finally {
      setSaving(false);
    }
  };

  const runMessage = currentAnalysis
    ? `${formatRunPeriod(currentAnalysis)} · ${currentSnapshot?.dataSnapshot.id ?? currentAnalysis.provenance.dataSnapshotId}`
    : running ? "Resolving Project scope and trusted facts…" : "Waiting for analysis context";
  const rendererState = resolveOverviewRendererState({
    projectId: displayedProjectId,
    resource,
    automaticRecoveryPending: hasRetainedOverview ? false : automaticRecoveryPending,
    analysisError: hasRetainedOverview ? null : projectSelectionError ?? queryValidationError ?? analysisError,
    resolution: currentResolution,
    plan: renderPlanForDisplay,
    advisories: qualityPolicy?.advisories,
  });
  const rendererRequest = currentResolution?.status === "ready"
    ? { mode: "customer" as const, rendererKey: currentResolution.snapshot.renderer.key }
    : currentResolution?.status === "configuration-required"
      ? { mode: "customer" as const, rendererKey: null }
      : null;
  const projectRendererState = rendererRequest
    ? toProjectRendererState(rendererState, currentSnapshot)
    : null;
  const isNgeeAnnRenderer = rendererRequest?.rendererKey === "ngee-ann-overview";
  const isPreschoolRenderer = rendererRequest?.rendererKey === "preschool-overview";
  const isTuyaOfficeRenderer = rendererRequest?.rendererKey === "tuya-office-overview";
  const isEnergyTemplateRenderer = rendererRequest?.rendererKey === "energy-template-overview";
  const isDedicatedOverviewRenderer = isNgeeAnnRenderer
    || isPreschoolRenderer
    || isTuyaOfficeRenderer
    || isEnergyTemplateRenderer;
  const isDedicatedOverviewPresentation = Boolean(committedMinimumOverview) || isDedicatedOverviewRenderer;
  const completeAcceptedHtmlAiSlots = hasCompleteAcceptedPreschoolHtmlAiSlotSet(currentHtmlAiSlots)
    ? currentHtmlAiSlots
    : null;
  const htmlAiPresentation = isPreschoolRenderer
    && currentSnapshot
    && (htmlAiPreviewRequested || (releaseEnablesHtmlAiPresentation && completeAcceptedHtmlAiSlots))
    ? {
      aiPresentationMode: "html" as const,
      htmlAiSlots: htmlAiPreviewRequested
        ? buildPreschoolHtmlAiSlotPreview(currentSnapshot)
        : completeAcceptedHtmlAiSlots ?? {},
    }
    : {};
  const isHtmlAiPreview = Boolean(htmlAiPresentation.aiPresentationMode && htmlAiPreviewRequested);
  const generateHtmlAiSlots = async () => {
    if (!currentSnapshot || !isPreschoolRenderer || access?.role !== "admin" || htmlAiGenerationPending) return;
    const generationIdentity = htmlAiIdentityRef.current;
    setHtmlAiGenerationPending(true);
    setHtmlAiGenerationError(null);
    try {
      const generated = await configApi.generateEnergyPreschoolHtmlAiSlots(
        projectId,
        currentSnapshot.context.scopeId,
        {
          ...snapshotLocalDateRange(currentSnapshot),
          dataSnapshotId: currentSnapshot.context.dataSnapshotId,
          projectReleaseId: currentSnapshot.projectRelease.id,
        },
      );
      if (htmlAiIdentityRef.current !== generationIdentity || !generationIdentity) return;
      setHtmlAiSlots(toPreschoolHtmlAiSlotRenderSet(generated));
      setHtmlAiSlotsIdentity(generationIdentity);
      setHtmlAiReadFailed(false);
    } catch {
      if (htmlAiIdentityRef.current === generationIdentity) {
        setHtmlAiGenerationError("Could not generate HTML AI Slots. Structured Slots remain authoritative.");
      }
    } finally {
      setHtmlAiGenerationPending(false);
    }
  };
  const isDedicatedOverviewShell = isDedicatedOverviewProject
    || isPreschoolRenderer
    || (hasRetainedOverview && isDedicatedOverviewRenderer);
  const currentHandoffPin = currentSnapshot
    ? {
        ...snapshotLocalDateRange(currentSnapshot),
        dataSnapshotId: currentSnapshot.context.dataSnapshotId,
        projectReleaseId: currentSnapshot.projectRelease.id,
      }
    : initialViewState.currentOverviewPin;
  const resolvedHandoffView = currentSnapshot && usesCurrentOverviewWindow
    ? {
        ...initialViewState,
        period: "Custom" as const,
        scopeId: "project",
        ...snapshotLocalDateRange(currentSnapshot),
        ...(currentHandoffPin ? { currentOverviewPin: currentHandoffPin } : {}),
      }
    : {
        ...initialViewState,
        scopeId: isPreschoolProject ? "project" : initialViewState.scopeId,
        period: isPreschoolProject ? "Custom" : initialViewState.period,
        from: effectiveCustomRange.from,
        to: effectiveCustomRange.to,
        ...(currentHandoffPin ? { currentOverviewPin: currentHandoffPin } : {}),
      };
  const publishedSections = rendererState.status === "ready" ? rendererState.plan.sections : [];
  const fallbackNavigationSections = useMemo(() => committedMinimumOverview
    ? committedMinimumOverview.presentation.navigation.map((section) => ({
        ...section,
        id: sectionDomId(section.id),
      }))
    : publishedSections.map((section, index) => ({
        id: sectionDomId(section.section_id),
        label: section.navigation_label,
        number: String(index + 1),
        depth: 0,
      })), [committedMinimumOverview, publishedSections]);
  const overviewIdentityKey = [
    rendererState.status,
    displayedProjectId,
    rendererRequest?.rendererKey ?? "generic",
    currentSnapshot?.context.dataSnapshotId ?? "no-snapshot",
    currentSnapshot?.projectRelease.id ?? "no-release",
    committedMinimumOverview?.binding.currentPin.dataSnapshotId ?? "no-minimum-snapshot",
    committedMinimumOverview?.binding.currentPin.projectReleaseId ?? "no-minimum-release",
    refreshRevision,
  ].join(":");
  const {
    sections: navigationSections,
    activeSectionId: activeSection,
    selectSection,
  } = useOverviewSectionOutline({
    rootRef: overviewContentRef,
    fallbackSections: fallbackNavigationSections,
    identityKey: overviewIdentityKey,
  });

  return (
    <>
    <div
      data-energyiq-current-overview="true"
      data-print-exclude={historyState.open ? "true" : undefined}
      className="energyiq-content-gutter mx-auto w-full max-w-[1480px] py-6 lg:py-8"
    >
      <section className="flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          {isDedicatedOverviewPresentation ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {committedMinimumOverview?.presentation.title
                  ?? (isPreschoolRenderer || isEnergyTemplateRenderer ? "Energy overview" : "Energy decision overview")}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                 <span className="font-semibold text-foreground">{displayedProjectName}</span>
                {committedMinimumOverview ? (
                  <>
                    <span>{committedMinimumOverview.presentation.reportWindow.label}</span>
                    <span>{formatMinimumOverviewWindow(committedMinimumOverview)}</span>
                    <span>{committedMinimumOverview.presentation.reportWindow.timezone}</span>
                    {committedMinimumOverview.presentation.reportWindow.dataThrough ? (
                      <span>
                        Report data through {formatMinimumOverviewTimestamp(
                          committedMinimumOverview.presentation.reportWindow.dataThrough,
                          committedMinimumOverview.presentation.reportWindow.timezone,
                        )}
                      </span>
                    ) : null}
                  </>
                ) : currentSnapshot?.reportTimeContext?.windows[0]?.label ? (
                  <span>{currentSnapshot.reportTimeContext.windows[0].label}</span>
                ) : isNgeeAnnRenderer ? <span>Calendar month to date</span> : null}
                {!committedMinimumOverview && currentSnapshot ? <span>{formatAnalysisWindow(currentSnapshot)}</span> : null}
                {!committedMinimumOverview && currentAnalysis ? <span>{currentAnalysis.context.timezone}</span> : null}
                {!committedMinimumOverview && currentSnapshot ? (
                  <span>Report data through {formatReportDataThrough(currentSnapshot)}</span>
                ) : null}
                {!committedMinimumOverview && currentSnapshot && formatSourceDataCoverage(currentSnapshot) ? (
                  <span>Data available {formatSourceDataCoverage(currentSnapshot)}</span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
                 <span>{displayedProjectName || "Select a Project"}</span>
                <EnergyIcon name="chevron" className="h-3 w-3" />
                <span>Published analysis</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Energy analysis</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
                A Project-specific decision view rendered from the published EnergyX Template Schema.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isDedicatedOverviewShell ? (
            <div className="w-full min-w-[220px] sm:w-auto">
              <EnergySelect
                ariaLabel="Analysis Scope"
                value={scopeId}
                options={scopeOptions}
                onValueChange={(nextScopeId) => navigateOverview({
                  scopeId: nextScopeId,
                })}
                size="small"
                disabled={!projectId || hierarchyLoading || Boolean(hierarchyError)}
                triggerClassName="sm:w-[260px]"
              />
              {hierarchyError ? (
                <p role="alert" className="mt-1 text-[10px] leading-4 text-step-error">
                  Analysis scopes unavailable: {hierarchyError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex rounded-lg border border-border bg-surface p-1" aria-label="Resource type">
            {(isDedicatedOverviewShell ? ELECTRICITY_ONLY_RESOURCES : ALL_OVERVIEW_RESOURCES).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={resource === item}
                onClick={() => navigateOverview({
                  resource: item,
                })}
                className={[
                  "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  resource === item ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
                ].join(" ")}
              >
                <EnergyIcon name={item === "electricity" ? "bolt" : "water"} className="h-3.5 w-3.5" />
                {item === "electricity" ? "Electricity" : "Water"}
              </button>
            ))}
          </div>
          {!isDedicatedOverviewShell ? (
            <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-1">
              {periodOptions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={Boolean(item.value && period === item.value)}
                  onClick={() => item.value ? navigateOverview(item.value === "Custom"
                    ? {
                      period: item.value,
                      from: effectiveCustomRange.from,
                      to: effectiveCustomRange.to,
                    }
                    : { period: item.value }) : undefined}
                  disabled={item.disabled}
                  title={item.title}
                  className={[
                    "h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
                    item.value && period === item.value ? "bg-surface-subtle text-foreground shadow-sm" : "text-muted hover:text-foreground",
                    item.disabled ? "cursor-not-allowed opacity-45 hover:text-muted" : "",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          {access?.role === "admin" && isPreschoolRenderer && currentSnapshot ? (
            <button
              type="button"
              onClick={() => router.push(preschoolSnapshotTransitionAdminHref({
                 projectId: displayedProjectId,
                scopeId: currentSnapshot.context.scopeId,
                dataSnapshotId: currentSnapshot.context.dataSnapshotId,
                projectReleaseId: currentSnapshot.projectRelease.id,
                from: currentSnapshot.context.from,
                to: currentSnapshot.context.to,
              }))}
              className="h-10 rounded-lg border border-primary/30 bg-primary/5 px-4 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Test data update
            </button>
          ) : null}
          {access?.role === "admin" && currentSnapshot ? (
            <button
              ref={changeButtonRef}
              type="button"
              onClick={() => setChangeDialogOpen(true)}
               disabled={hasRetainedOverview}
               className="h-10 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              What changed?
            </button>
          ) : null}
          {access?.role === "admin" && usesCurrentOverviewWindow ? (
            <button
              type="button"
              onClick={() => void recomputeOverview()}
              disabled={running || hasRetainedOverview || resource === "water"}
              title="Recompute deterministic Overview facts instead of reusing the exact cached result."
              className="h-10 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recompute overview
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => refreshOverview()}
            disabled={running || hasRetainedOverview || resource === "water"}
            className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Refreshing…" : usesCurrentOverviewWindow ? "Refresh current overview" : "Refresh view"}
          </button>
          <button
            type="button"
            onClick={() => void saveCurrentAnalysis()}
            disabled={saving || hasRetainedOverview || rendererState.status !== "ready" || !saveAllowed}
            title={aiArtifactMatchesCurrent
              ? "Save the deterministic report with its completed AI result."
              : "Save the deterministic report now. A still-running AI result is not attached."}
            className="h-10 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save analysis"}
          </button>
          <button
            ref={historyButtonRef}
            type="button"
            onClick={() => navigateHistory({ open: true, selectedAnalysisId: null })}
            disabled={!projectId || hasRetainedOverview}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            <EnergyIcon name="calendar" className="h-3.5 w-3.5" />
            History
          </button>
        </div>
      </section>

      {hasRetainedOverview ? (
        <div
          role="status"
          className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          <span className="font-semibold">
            {analysisError
              ? `Could not switch to ${selectedProject?.name ?? "the selected Project"}.`
              : `Switching to ${selectedProject?.name ?? "the selected Project"}…`}
          </span>{" "}
          <span className="text-muted">
            {analysisError
              ? "The previous report remains available. Retry when the target Project is ready."
              : "The previous report remains available until the target report is ready."}
          </span>
        </div>
      ) : null}

      {!isDedicatedOverviewShell && period === "Custom" ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <DateField label="From" value={effectiveCustomRange.from} onChange={(from) => navigateOverview({
            from,
          })} />
          <DateField label="To, inclusive" value={effectiveCustomRange.to} onChange={(to) => navigateOverview({
            to,
          })} />
          <p className="pb-2 text-[10px] text-muted-light">Changing the range reuses the published template and runs only the scoped queries.</p>
        </div>
      ) : null}

      {!isDedicatedOverviewPresentation || saveError || savedAnalysis ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-light">
          {!isDedicatedOverviewRenderer ? <span>{runMessage}</span> : <span />}
          <div className="flex flex-wrap items-center gap-3">
            {saveError ? <span className="text-step-error">Save failed: {saveError}</span> : null}
            {savedAnalysis ? (
              <button
                type="button"
                onClick={() => navigateHistory({ open: true, selectedAnalysisId: savedAnalysis.id })}
                className="font-semibold text-primary hover:underline"
              >
                Saved as version {savedAnalysis.sequence} →
              </button>
            ) : null}
            {currentSnapshot && !isDedicatedOverviewRenderer ? (
              <span className="font-mono">
                {currentSnapshot.projectRelease.id}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {currentSnapshot && !isDedicatedOverviewRenderer ? (
        <div className="mt-6">
          <ScopeMetadataStatus metadata={currentSnapshot.metadata} mode="interactive" />
        </div>
      ) : null}

      {committedMinimumOverview || rendererState.status === "ready" ? (
        <div className="mt-4 xl:grid xl:grid-cols-[200px_minmax(0,1fr)] xl:items-start xl:gap-8 2xl:grid-cols-[220px_minmax(0,1fr)]">
          <OverviewSectionNavigation
            sections={navigationSections}
            activeSectionId={activeSection}
            onSelect={selectSection}
          />
          <div ref={overviewContentRef} className="min-w-0">
            {committedMinimumOverview ? (
              <MinimumOverviewShell
                minimum={committedMinimumOverview}
                detailError={analysisError}
                onRetry={refreshOverview}
                projectExplorerHref={minimumOverviewHandoffHref(
                  "/energyiq/explorer",
                  committedMinimumOverview,
                  initialViewState,
                )}
                aiAnalystHref={minimumOverviewHandoffHref(
                  "/energyiq/ai",
                  committedMinimumOverview,
                  initialViewState,
                )}
              />
            ) : isDedicatedOverviewRenderer && rendererRequest && projectRendererState ? (
              <>
                {isPreschoolRenderer && htmlAiPreviewRequested ? (
                  <div
                    className="mb-4 rounded-lg border border-step-warning/30 bg-step-warning-soft px-4 py-3 text-sm text-step-warning"
                    role="status"
                    {...(isHtmlAiPreview ? { "data-ai-presentation-preview": "true" } : {})}
                  >
                    {isHtmlAiPreview
                      ? <>HTML AI Slot prototype preview. These six surfaces are sandboxed fixture content, not DeepSeek or GPT model output. Remove <code>aiPresentation=html-preview</code> to return to the presentation selected by the published Release.</>
                      : htmlAiReadFailed
                        ? <>HTML AI Slot read failed; structured Slots remain authoritative.</>
                        : <>HTML AI Slot presentation is explicit and identity-bound.</>}
                    {access?.role === "admin" ? (
                      <button
                        type="button"
                        className="ml-3 rounded-md border border-step-warning/40 bg-white/60 px-3 py-1 font-medium text-step-warning hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void generateHtmlAiSlots()}
                        disabled={htmlAiGenerationPending}
                      >
                        {htmlAiGenerationPending ? "Generating HTML Slots…" : "Generate HTML Slots"}
                      </button>
                    ) : null}
                    {htmlAiGenerationError ? <span className="ml-3" role="alert">{htmlAiGenerationError}</span> : null}
                  </div>
                ) : null}
                <ProjectRenderer
                 key={`dedicated-overview:${displayedProjectId}:${refreshRevision}`}
                request={rendererRequest}
                state={projectRendererState}
                showContextHeader={false}
                onRetry={refreshOverview}
                latestAvailableRange={usesCurrentOverviewWindow ? null : latestAvailableRange}
                onViewLatestAvailableData={(range) => navigateOverview({
                  period: "Custom",
                  from: range.from,
                  to: range.to,
                })}
                grain={initialViewState.grain}
                comparison={initialViewState.comparison}
                category={initialViewState.category}
                onComparisonChange={(comparison) => navigateOverview({ comparison })}
                onCategoryChange={(category) => navigateOverview({ category })}
                projectExplorerHref={overviewHandoffHref("/energyiq/explorer", {
                  ...resolvedHandoffView,
                   projectId: displayedProjectId,
                })}
                aiAnalystHref={overviewHandoffHref("/energyiq/ai", {
                  ...resolvedHandoffView,
                   projectId: displayedProjectId,
                })}
                onAiArtifactChange={setAiArtifact}
                {...htmlAiPresentation}
                />
              </>
            ) : rendererRequest && projectRendererState ? (
              <ProjectRenderer request={rendererRequest} state={projectRendererState} sectionIdPrefix="customer-overview" onRetry={refreshOverview} />
            ) : (
              <EnergyTemplateRenderer state={rendererState} sectionIdPrefix="customer-overview" onRetry={refreshOverview} />
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          {rendererRequest && projectRendererState ? (
            <ProjectRenderer request={rendererRequest} state={projectRendererState} onRetry={refreshOverview} />
          ) : (
            <EnergyTemplateRenderer state={rendererState} onRetry={refreshOverview} />
          )}
        </div>
      )}
    </div>
    {changeDialogOpen && currentSnapshot ? (
      <OverviewChangeDialog
        projectId={displayedProjectId}
        currentSnapshot={currentSnapshot}
        currentAiArtifact={aiArtifact}
        returnFocusRef={changeButtonRef}
        onClose={() => setChangeDialogOpen(false)}
        onOpenPrevious={(analysisId) => {
          setChangeDialogOpen(false);
          navigateHistory({ open: true, selectedAnalysisId: analysisId });
        }}
      />
    ) : null}
    {historyState.open ? (
      <OverviewHistoryDialog
        projectName={displayedProjectName}
        selectedAnalysisId={historyState.selectedAnalysisId}
        onSelect={(analysisId) => navigateHistory({ open: true, selectedAnalysisId: analysisId })}
        onBackToHistory={() => navigateHistory({ open: true, selectedAnalysisId: null }, "replace")}
        onClose={() => navigateHistory({ open: false, selectedAnalysisId: null }, "replace")}
        returnFocusRef={historyButtonRef}
      />
    ) : null}
    </>
  );
}

function resolveOverviewRendererState(input: {
  projectId: string;
  resource: ResourceType;
  automaticRecoveryPending: boolean;
  analysisError: string | null;
  resolution: EnergyProjectAnalysisResolutionDto | null;
  plan: ReturnType<typeof buildEnergyTemplateRenderPlan> | null;
  advisories?: ProjectAnalysisQualityPolicy["advisories"];
}): EnergyTemplateRendererState {
  if (input.automaticRecoveryPending) {
    return {
      status: "loading",
      title: "Updating to the latest report…",
      detail: "Resolving the latest authorized current Snapshot and Project Release.",
    };
  }
  const error = input.analysisError;
  if (error) {
    return { status: "error", title: "Published analysis is unavailable", detail: `${error} Retry the same Project and period without changing the published template.` };
  }
  if (!input.projectId) {
    return { status: "empty", title: "Select a Project", detail: "Choose a Project to load its published Template Revision and analysis context." };
  }
  if (input.resource === "water") {
    return { status: "unsupported", title: "Water analysis is not configured", detail: "Publish water metrics, capabilities and modules before this view displays decision-grade results." };
  }
  if (!input.resolution) {
    return { status: "loading", title: "Resolving the published analysis", detail: "Loading the Template Revision, trusted Project scope, selected period and data snapshot." };
  }
  if (input.resolution.status === "configuration-required") {
    return { status: "unsupported", title: input.resolution.title, detail: input.resolution.detail };
  }
  if (!input.plan) {
    return { status: "empty", title: "Published analysis has no Project Template", detail: "Publish a Project Template with at least one enabled module." };
  }
  return {
    status: "ready",
    analysis: input.resolution.snapshot.analysis,
    plan: input.plan,
    ...(input.advisories?.length ? { advisories: input.advisories } : {}),
  };
}

function currentOverviewPinMatchesResolution(
  pin: CurrentOverviewPin,
  resolution: EnergyProjectAnalysisResolutionDto,
): boolean {
  if (resolution.status !== "ready") return false;
  const range = snapshotLocalDateRange(resolution.snapshot);
  return pin.from === range.from
    && pin.to === range.to
    && pin.dataSnapshotId === resolution.snapshot.context.dataSnapshotId
    && pin.projectReleaseId === resolution.snapshot.projectRelease.id;
}

function toProjectRendererState(
  state: EnergyTemplateRendererState,
  snapshot: EnergyProjectAnalysisSnapshotDto | null,
): ProjectRendererState {
  if (state.status !== "ready") return state;
  if (!snapshot) {
    return {
      status: "error",
      title: "Published analysis is unavailable",
      detail: "The Project Analysis Snapshot is missing. Refresh this same Project and Period.",
    };
  }
  return {
    status: "ready",
    snapshot,
    plan: state.plan,
    ...(state.advisories?.length ? { advisories: state.advisories } : {}),
  };
}

function MinimumOverviewShell({
  minimum,
  detailError,
  onRetry,
  projectExplorerHref,
  aiAnalystHref,
}: {
  minimum: EnergyProjectOverviewMinimumDto;
  detailError: string | null;
  onRetry: () => void;
  projectExplorerHref: string;
  aiAnalystHref: string;
}) {
  return (
    <div
      data-overview-minimum="true"
      aria-busy={detailError ? "false" : "true"}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="border-b border-border bg-surface-subtle px-5 py-4 lg:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-light">
              Current overview
            </p>
            {detailError ? (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-step-error">
                  Detailed analysis is temporarily unavailable. Headline facts remain available.
                </span>
                <button type="button" onClick={onRetry} className="font-semibold text-primary hover:underline">
                  Retry details
                </button>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Headline facts are ready. Loading detailed analysis…
              </p>
            )}
          </div>
          <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
            {minimum.headline.dataQuality.coveragePct.toFixed(1)}% data coverage
          </span>
        </div>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-5">
        {minimum.headline.metrics.map((metric) => (
          <div key={metric.id} className="bg-surface px-5 py-5">
            <p className="text-xs font-medium text-muted">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {formatMinimumMetric(metric)}
            </p>
          </div>
        ))}
      </div>
      <div className="divide-y divide-border">
        {minimum.presentation.navigation.map((section) => (
          <section
            key={section.id}
            id={sectionDomId(section.id)}
            className="scroll-mt-28 px-5 py-5 lg:px-7"
          >
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted-light">{section.number}</span>
              <h2 className="text-base font-semibold text-foreground">{section.label}</h2>
            </div>
            <div className="mt-3 h-2.5 w-full max-w-2xl animate-pulse rounded-full bg-surface-subtle" />
          </section>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border px-5 py-4 text-sm lg:px-7">
        <a className="font-semibold text-primary hover:underline" href={projectExplorerHref}>
          View energy consumption
        </a>
        <a className="font-semibold text-primary hover:underline" href={aiAnalystHref}>
          Ask the advisor
        </a>
      </div>
    </div>
  );
}

function formatMinimumMetric(
  metric: EnergyProjectOverviewMinimumDto["headline"]["metrics"][number],
): string {
  if (!metric.available || metric.value === null) return "Unavailable";
  const value = new Intl.NumberFormat("en-SG", {
    maximumFractionDigits: metric.unit === "%" ? 1 : 2,
  }).format(metric.value);
  if (metric.unit === "%") return `${value}%`;
  if (metric.unit === "centres") return `${value} centres`;
  if (metric.unit === "currency") return value;
  return `${value} ${metric.unit}`;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-light">
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block h-9 rounded-md border border-border bg-surface px-3 text-xs font-medium normal-case text-foreground" />
    </label>
  );
}

export function overviewAnalysisRequest(
  projectId: string,
  period: OverviewPeriod,
  customRange: { from: string; to: string },
  view: { scopeId?: string; resource?: ResourceType } = {},
): EnergyQueryContextRequestDto {
  const scopeId = view.scopeId?.trim() || "project";
  const resource = view.resource ?? "electricity";
  if (period !== "Custom") return { projectId, scopeId, resource, period };
  return { projectId, scopeId, resource, period, from: customRange.from, to: customRange.to };
}

export function currentOverviewAnalysisRequest(
  projectId: string,
  view: {
    scopeId?: string;
    resource?: ResourceType;
    currentOverviewPin?: CurrentOverviewPin;
  } = {},
): EnergyQueryContextRequestDto {
  return {
    projectId,
    scopeId: view.scopeId?.trim() || "project",
    resource: view.resource ?? "electricity",
    analysisWindow: "current-project-overview",
    ...(view.currentOverviewPin ? {
      from: view.currentOverviewPin.from,
      to: view.currentOverviewPin.to,
      expectedDataSnapshotId: view.currentOverviewPin.dataSnapshotId,
      expectedProjectReleaseId: view.currentOverviewPin.projectReleaseId,
    } : {}),
  };
}

export function overviewViewStateFromSearchParams(searchParams: Pick<URLSearchParams, "get">): OverviewUrlViewState {
  const requestedPeriod = searchParams.get("period");
  const period = requestedPeriod === "Yesterday"
    || requestedPeriod === "Previous week"
    || requestedPeriod === "Previous month"
    || requestedPeriod === "Custom"
    ? requestedPeriod
    : "Last 7 days";
  const from = period === "Custom" ? searchParams.get("from") ?? "" : "";
  const to = period === "Custom" ? searchParams.get("to") ?? "" : "";
  const requestedGrain = searchParams.get("grain");
  const grain = requestedGrain === "hour" && isHourGrainCompatible(period, from, to)
    ? "hour"
    : "day";
  const requestedComparison = searchParams.get("comparison");
  const comparison = requestedComparison === "selected" || requestedComparison === "average"
    ? requestedComparison
    : "overlay";
  const requestedCategory = searchParams.get("category");
  const category = requestedCategory === "load" || requestedCategory === "light"
    ? requestedCategory
    : "all";
  const pinFrom = searchParams.get("currentFrom")?.trim() || "";
  const pinTo = searchParams.get("currentTo")?.trim() || "";
  const pinDataSnapshotId = searchParams.get("currentDataSnapshotId")?.trim() || "";
  const pinProjectReleaseId = searchParams.get("currentProjectReleaseId")?.trim() || "";
  const currentOverviewPin = pinFrom && pinTo && pinDataSnapshotId && pinProjectReleaseId
    ? {
        from: pinFrom,
        to: pinTo,
        dataSnapshotId: pinDataSnapshotId,
        projectReleaseId: pinProjectReleaseId,
      }
    : undefined;
  return {
    projectId: searchParams.get("projectId")?.trim() || "",
    scopeId: searchParams.get("scopeId")?.trim() || "project",
    resource: searchParams.get("resource") === "water" ? "water" : "electricity",
    period,
    from,
    to,
    grain,
    comparison,
    category,
    ...(currentOverviewPin ? { currentOverviewPin } : {}),
  };
}

function validateOverviewCustomRange(period: OverviewPeriod, from: string, to: string): string | null {
  if (period !== "Custom") return null;
  if (!from || !to) return "Choose both From and To dates for a Custom period.";
  if (!isValidDateInput(from) || !isValidDateInput(to)) return "Use valid Custom dates in YYYY-MM-DD format.";
  if (from > to) return "From date must be on or before To date.";
  return null;
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function overviewUrlWithView(
  view: OverviewUrlViewState,
): string {
  const next = new URLSearchParams();
  if (view.projectId) next.set("projectId", view.projectId);
  else next.delete("projectId");
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  next.set("period", view.period);
  if (view.period === "Custom") {
    next.set("from", view.from);
    next.set("to", view.to);
  } else {
    // Non-Custom Periods have no persisted date range.
  }
  next.set("grain", isHourGrainCompatible(view.period, view.from, view.to) ? view.grain : "day");
  next.set("comparison", view.comparison);
  next.set("category", view.category);
  return `/energyiq/overview?${next.toString()}`;
}

export function currentOverviewUrlWithView(view: OverviewUrlViewState): string {
  const next = new URLSearchParams();
  if (view.projectId) next.set("projectId", view.projectId);
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  next.set("grain", "day");
  next.set("comparison", view.comparison);
  next.set("category", view.category);
  if (view.currentOverviewPin) {
    next.set("currentFrom", view.currentOverviewPin.from);
    next.set("currentTo", view.currentOverviewPin.to);
    next.set("currentDataSnapshotId", view.currentOverviewPin.dataSnapshotId);
    next.set("currentProjectReleaseId", view.currentOverviewPin.projectReleaseId);
  }
  return `/energyiq/overview?${next.toString()}`;
}

export function preschoolSnapshotTransitionAdminHref(input: {
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  from: string;
  to: string;
}): string {
  const params = new URLSearchParams({
    section: "ai-analysis",
    projectId: input.projectId,
    abScopeId: input.scopeId,
    abSnapshotId: input.dataSnapshotId,
    abReleaseId: input.projectReleaseId,
    abFrom: input.from,
    abTo: input.to,
  });
  return `/energyiq/admin?${params.toString()}`;
}

function isHourGrainCompatible(period: OverviewPeriod, from: string, to: string): boolean {
  return period === "Yesterday" || (period === "Custom" && Boolean(from) && from === to);
}

function overviewHandoffHref(
  pathname: "/energyiq/explorer" | "/energyiq/ai",
  view: OverviewUrlViewState,
): string {
  const handoff = overviewUrlWithView(view).replace("/energyiq/overview", pathname);
  if (!view.currentOverviewPin) return handoff;
  const [path, query = ""] = handoff.split("?");
  const next = new URLSearchParams(query);
  next.set("dataSnapshotId", view.currentOverviewPin.dataSnapshotId);
  next.set("projectReleaseId", view.currentOverviewPin.projectReleaseId);
  return `${path}?${next.toString()}`;
}

function scopeNodeDisplayPath(
  node: EnergyProjectHierarchyDto["nodes"][number],
  nodesById: ReadonlyMap<string, EnergyProjectHierarchyDto["nodes"][number]>,
): string {
  const segments = [node.name];
  const visited = new Set([node.id]);
  let parentId = node.parent_id;
  let remaining = nodesById.size;
  while (parentId && remaining > 0) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    if (parent.node_type !== "project") segments.unshift(parent.name);
    parentId = parent.parent_id;
    remaining -= 1;
  }
  return segments.join(" / ");
}

export function toDateInput(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatRunPeriod(analysis: EnergyScopeAnalysisDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: analysis.context.timezone });
  const from = formatter.format(new Date(analysis.context.from));
  const to = formatter.format(new Date(new Date(analysis.context.to).getTime() - 1));
  return `${analysis.context.projectName} · ${from}–${to}`;
}

function snapshotLocalDateRange(snapshot: EnergyProjectAnalysisSnapshotDto): { from: string; to: string } {
  return {
    from: toDateInput(snapshot.context.from, snapshot.context.timezone),
    to: toDateInput(
      new Date(Date.parse(snapshot.context.to) - 1).toISOString(),
      snapshot.context.timezone,
    ),
  };
}

function minimumOverviewMatchesResolution(
  minimum: EnergyProjectOverviewMinimumDto,
  resolution: Extract<EnergyProjectAnalysisResolutionDto, { status: "ready" }>,
): boolean {
  const range = snapshotLocalDateRange(resolution.snapshot);
  const reportTimeContext = resolution.snapshot.reportTimeContext;
  const reportTimeBasisMatches = minimum.binding.reportTimeBasis === null
    ? reportTimeContext === undefined
    : reportTimeContext !== undefined
      && JSON.stringify(minimum.binding.reportTimeBasis)
        === JSON.stringify(reportTimeBasisFromContext(reportTimeContext));
  const reportTimeBindingMatches = reportTimeContext === undefined
    ? minimum.binding.reportTimeBasis === null
    : reportTimeContext.binding.workspaceId === minimum.binding.workspaceId
      && reportTimeContext.binding.projectId === minimum.binding.projectId
      && reportTimeContext.binding.scopeId === minimum.binding.scopeId
      && reportTimeContext.binding.resource === minimum.binding.resource
      && reportTimeContext.binding.dataSnapshotId === minimum.binding.currentPin.dataSnapshotId
      && reportTimeContext.binding.projectReleaseId === minimum.binding.currentPin.projectReleaseId;
  return minimum.binding.workspaceId === resolution.snapshot.context.workspaceId
    && minimum.binding.projectId === resolution.snapshot.context.projectId
    && minimum.binding.scopeId === resolution.snapshot.context.scopeId
    && minimum.binding.resource === resolution.snapshot.context.resource
    && minimum.binding.currentPin.from === range.from
    && minimum.binding.currentPin.to === range.to
    && minimum.binding.currentPin.dataSnapshotId === resolution.snapshot.context.dataSnapshotId
    && resolution.snapshot.dataSnapshot.id === resolution.snapshot.context.dataSnapshotId
    && minimum.binding.currentPin.projectReleaseId === resolution.snapshot.projectRelease.id
    && resolution.snapshot.context.projectReleaseId === resolution.snapshot.projectRelease.id
    && minimum.presentation.renderer.key === resolution.snapshot.renderer.key
    && reportTimeBasisMatches
    && reportTimeBindingMatches;
}

function minimumOverviewHasConsistentReportTimeIdentity(
  minimum: EnergyProjectOverviewMinimumDto,
): boolean {
  const basis = minimum.binding.reportTimeBasis;
  const primaryWindowId = minimum.binding.primaryReportWindowId;
  if (basis === null) return primaryWindowId === null;
  if (!primaryWindowId) return false;
  const reportWindow = minimum.presentation.reportWindow;
  const primaryWindow = basis.windows.find((window) => window.windowId === primaryWindowId);
  if (!primaryWindow
    || basis.timezone !== reportWindow.timezone
    || basis.acceptedDataEndExclusive !== reportWindow.endExclusive
    || primaryWindow.from !== reportWindow.start
    || primaryWindow.toExclusive !== reportWindow.endExclusive) {
    return false;
  }
  return minimum.binding.currentPin.from === toDateInput(reportWindow.start, reportWindow.timezone)
    && minimum.binding.currentPin.to === toDateInput(
      new Date(Date.parse(reportWindow.endExclusive) - 1).toISOString(),
      reportWindow.timezone,
    );
}

function formatMinimumOverviewWindow(minimum: EnergyProjectOverviewMinimumDto): string {
  const { reportWindow } = minimum.presentation;
  const formatter = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: reportWindow.timezone,
  });
  const from = formatter.format(new Date(reportWindow.start));
  const to = formatter.format(new Date(Date.parse(reportWindow.endExclusive) - 1));
  return `${from}–${to}`;
}

function formatMinimumOverviewTimestamp(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(timestamp));
}

function formatAnalysisWindow(snapshot: EnergyProjectAnalysisSnapshotDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: snapshot.context.timezone,
  });
  const from = formatter.format(new Date(snapshot.context.from));
  const to = formatter.format(new Date(Date.parse(snapshot.context.to) - 1));
  return `${from}–${to}`;
}

function sectionDomId(sectionId: string): string {
  return `customer-overview-${sectionId}`;
}

function minimumOverviewHandoffHref(
  pathname: "/energyiq/explorer" | "/energyiq/ai",
  minimum: EnergyProjectOverviewMinimumDto,
  currentView: OverviewUrlViewState,
): string {
  return overviewHandoffHref(pathname, {
    ...currentView,
    projectId: minimum.binding.projectId,
    scopeId: "project",
    resource: minimum.binding.resource,
    period: "Custom",
    from: minimum.binding.currentPin.from,
    to: minimum.binding.currentPin.to,
    currentOverviewPin: minimum.binding.currentPin,
  });
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function customerFacingAnalysisError(reason: unknown, fallback: string): string {
  if (reason instanceof ConfigApiError) {
    return reason.status >= 500
      ? "Current overview is temporarily unavailable."
      : reason.message;
  }
  return fallback;
}

function htmlAiIdentityForReadModel(
  readModel: EnergyPreschoolHtmlAiSlotReadModelDto,
  snapshotIdentity: string | null,
): string {
  return JSON.stringify({
    ...(snapshotIdentity ? JSON.parse(snapshotIdentity) as Record<string, unknown> : {}),
    modelProfileId: readModel.binding.modelProfileId ?? null,
    modelProfileRevision: readModel.binding.modelProfileRevision ?? null,
    promptRevision: readModel.binding.promptRevision ?? null,
    reportTimePolicyId: readModel.binding.reportTimePolicyId ?? null,
    reportTimePolicyRevision: readModel.binding.reportTimePolicyRevision ?? null,
    reportTimeContextFingerprint: readModel.binding.reportTimeContextFingerprint ?? null,
    slotDefinitionRevisions: readModel.binding.slotDefinitionRevisions ?? null,
  });
}

function htmlAiReadModelMatchesSnapshot(
  readModel: EnergyPreschoolHtmlAiSlotReadModelDto,
  snapshot: EnergyProjectAnalysisSnapshotDto,
  projectId: string,
): boolean {
  return readModel.status === "available"
    && readModel.binding.workspaceId === snapshot.context.workspaceId
    && readModel.binding.projectId === projectId
    && readModel.binding.projectId === snapshot.context.projectId
    && readModel.binding.scopeId === snapshot.context.scopeId
    && readModel.binding.dataSnapshotId === snapshot.context.dataSnapshotId
    && readModel.binding.projectReleaseId === snapshot.projectRelease.id
    && readModel.binding.analysisPeriod.from === snapshot.context.primaryPeriod.start
    && readModel.binding.analysisPeriod.to === snapshot.context.primaryPeriod.endExclusive;
}

function hasCompleteAcceptedPreschoolHtmlAiSlotSet(
  slots: PreschoolHtmlAiSlotRenderSet | null,
): slots is Required<PreschoolHtmlAiSlotRenderSet> {
  if (!slots) return false;
  return PRESCHOOL_HTML_AI_SLOT_IDS.every((slotId) => {
    const slot = slots[slotId];
    return Boolean(slot && acceptAiSlotHtmlArtifact({
      candidate: slot.candidate,
      expected: { slotId, identity: slot.expectedIdentity },
      allowedEvidenceRefs: slot.allowedEvidenceRefs,
    }).accepted);
  });
}

function toPreschoolHtmlAiSlotRenderSet(
  readModel: EnergyPreschoolHtmlAiSlotReadModelDto,
): PreschoolHtmlAiSlotRenderSet {
  return Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.flatMap((slotId) => {
    const slot = readModel.slots[slotId];
    if (slot?.status !== "available" || !slot.artifact) return [];
    const slotDefinitionRevision = readModel.binding.slotDefinitionRevisions?.[slotId];
    const allowedEvidenceRefs = readModel.binding.allowedEvidenceRefsBySlot?.[slotId];
    if (!slotDefinitionRevision || !Array.isArray(allowedEvidenceRefs)) return [];
    return [[slotId, {
      candidate: slot.artifact,
      expectedIdentity: {
        ...readModel.binding,
        slotDefinitionRevision,
      },
      allowedEvidenceRefs,
      ...(slot.acceptance ? { acceptance: slot.acceptance } : {}),
    }]];
  })) as PreschoolHtmlAiSlotRenderSet;
}

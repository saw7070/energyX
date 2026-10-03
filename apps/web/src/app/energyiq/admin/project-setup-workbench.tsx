"use client";

import Link from "next/link";
import { AdminTaskHistory } from "./admin-task-history";
import { AdminModels } from "./admin-models";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { explainImportBlocker, SmartImportPanel } from "./smart-import-panel";
import {
  configApi,
  type EnergyComponentRevisionDto,
  type EnergyImportBatchDto,
  type EnergyOverviewCadenceDto,
  type EnergyProjectDataReadinessDto,
  type EnergyProjectOverviewProfileDto,
  type EnergyMeterMappingDraftDto,
  type EnergyMeterMappingRowDto,
  type EnergyMetricFamilyDto,
  type EnergyProjectMetricConfigDto,
  type EnergyMetricRevisionDto,
  type EnergyProjectRuleConfigDto,
  type EnergyRuleFamilyDto,
  type EnergyRuleRevisionDto,
  type EnergyVirtualMeterDto,
  type EnergyProjectDto,
  type EnergyProjectSetupDocumentDto,
  type EnergyProjectSetupDto,
  type EnergyProjectSetupNodeDto,
  type EnergyProjectSetupValidationDto,
  type EnergyProjectTemplateDraftDto,
  type EnergyTemplateDraftDocumentDto,
  type EnergyTemplateDefinitionDto,
  type EnergyTierDefinitionDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "../_components/icons";
import { EnergySelect } from "../_components/energy-select";
import { friendlyErrorKey, friendlyErrorMessage } from "../_components/friendly-error";
import type { useEnergyIqAccess } from "../_components/energyiq-access";
import { PreschoolAdditionalMethodProposalAdmin } from "../_components/preschool-additional-method-proposal-admin";
import {
  PreschoolAdditionalEvaluationAdmin,
  type PreschoolSnapshotTransitionPin,
} from "../_components/preschool-additional-evaluation-admin";
import { EnergyIqAdminSidebar, type AdminSection } from "./admin-sidebar";
import { AdminAccessPages } from "./admin-access-pages";
import { resolveComponentReadiness, resolveMetricReadiness, resolveRuleReadiness } from "./analysis-configuration-model";
import { OperationalPolicySettings } from "./operational-policy-settings";
import {
  presentAdminOverviewProfile,
  resolveAdminOverviewPreviewMode,
} from "./overview-profile-model";
import { deriveProjectDeliveryProgress } from "./project-delivery-progress";
import { ProjectOverviewAiReadiness } from "./project-overview-ai-readiness";
import { ProjectHarnessConfiguration } from "./project-harness-configuration";
import { ProjectAiOperations } from "./project-ai-operations";
import { TemplateDraftPreview } from "./template-draft-preview";
import { TemplateChangeProposalPanel } from "./template-change-proposal-panel";
import {
  buildTemplatePreviewPlan,
  resolveEnergyPreviewRange,
  type EnergyPreviewRange,
} from "./template-draft-preview-model";
import { useProjectSetupLoader } from "./use-project-setup-loader";
import {
  addNode,
  addParentTier,
  applyMeterMappingRowEdit,
  branchNodeCount,
  canLockTierStructure,
  buildAggregationReview,
  createMeterMappingFromSourceLabels,
  evaluateEnergyImportMaterializationGuard,
  hasSiblingNameConflict,
  initialTierSelection,
  isTierStructureLocked,
  nodePathLabel,
  nodesForTierAndParent,
  pinEnergySourceManifest,
  removeNodeAndDescendants,
  removeHighestTier,
  sourceLabelsAcrossImportBatches,
  tiersTopDown,
} from "./project-setup-model";

type AccessState = ReturnType<typeof useEnergyIqAccess>;
const ReportAgentPanel = dynamic(() => import("./report-agent-panel").then((module) => module.ReportAgentPanel));
type MeterMappingIntent = {
  scopeId: string;
  scopeName: string;
  kind: "physical" | "virtual";
};
type ProjectPublicationReview = {
  templateDraft: EnergyProjectTemplateDraftDto;
  metricConfig: EnergyProjectMetricConfigDto;
  ruleConfig: EnergyProjectRuleConfigDto;
};
type AdminProjectOption = EnergyProjectDto & { workspaceName: string };

// Saving applies the change straight away, the same as the Facility page: no separate publication step for setup edits.
export const applyFailure = (reason: unknown) => {
  const key = reason instanceof Error ? friendlyErrorKey(reason) : null;
  if (key === "forbidden") return "Saved, but only a platform administrator can apply it.";
  if (key === "setupIncomplete") return "Saved, but not applied yet: some locations or meters still need setting up. Fix the problems listed under Validation, then save again.";
  if (key === "dataNotReady") return "Saved, but not applied yet: this project has no readings to publish.";
  if (key === "conflict") return "Saved, but not applied: someone else changed this project. Refresh and try again.";
  return "Saved, but could not be applied. Try saving again.";
};


export function EnergyIqAdminWorkbench({
  accessState,
  initialSection = "overview",
  embedded = false,
}: {
  accessState: AccessState;
  initialSection?: AdminSection;
  embedded?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { access, activeProject, refresh, selectProject, selectProjectContext } = accessState;
  const currentWorkspaceProjects = useMemo(() => access?.projects ?? [], [access?.projects]);
  const activeWorkspaceName = access?.workspaces.find(
    (workspace) => workspace.id === access.activeWorkspaceId,
  )?.name ?? "Current workspace";
  const [adminProjects, setAdminProjects] = useState<AdminProjectOption[]>([]);
  const projects: AdminProjectOption[] = access?.role === "admin" && adminProjects.length > 0
    ? adminProjects
    : currentWorkspaceProjects.map((project) => ({ ...project, workspaceName: activeWorkspaceName }));
  const [selectedProjectId, setSelectedProjectId] = useState(
    activeProject?.id ?? projects[0]?.id ?? "",
  );
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [setup, setSetup] = useState<EnergyProjectSetupDto | null>(null);
  const [document, setDocument] = useState<EnergyProjectSetupDocumentDto | null>(null);
  const [validation, setValidation] = useState<EnergyProjectSetupValidationDto | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const snapshotTransitionPin = useMemo<PreschoolSnapshotTransitionPin | null>(() => {
    const values = {
      scopeId: searchParams.get("abScopeId"),
      dataSnapshotId: searchParams.get("abSnapshotId"),
      projectReleaseId: searchParams.get("abReleaseId"),
      from: searchParams.get("abFrom"),
      to: searchParams.get("abTo"),
    };
    return Object.values(values).every((value) => typeof value === "string" && value.length > 0)
      ? values as PreschoolSnapshotTransitionPin
      : null;
  }, [searchParams]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [meterMappingIntent, setMeterMappingIntent] = useState<MeterMappingIntent | null>(null);
  const [adminNavigationCollapsed, setAdminNavigationCollapsed] = useState(false);

  const loadAdminProjects = useCallback(async () => {
    if (access?.role !== "admin") {
      setAdminProjects([]);
      return;
    }
    const result = await configApi.listEnergyAdminOrganisations();
    const next = result.organisations.flatMap((organisation) =>
      organisation.projects.map((project) => ({
        id: project.id,
        workspaceId: organisation.id,
        workspaceName: organisation.name,
        name: project.name,
        status: normalizeProjectStatus(project.status),
        timezone: currentWorkspaceProjects.find((candidate) => candidate.id === project.id)?.timezone
          ?? "Asia/Singapore",
      })),
    ).sort((left, right) => left.workspaceName.localeCompare(right.workspaceName)
      || left.name.localeCompare(right.name));
    setAdminProjects(next);
  }, [access?.role, currentWorkspaceProjects]);

  useEffect(() => {
    void loadAdminProjects().catch((reason) => {
      setError(messageFrom(reason, "Failed to load projects across customer Workspaces"));
    });
  }, [loadAdminProjects]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!access?.activeWorkspaceId || adminProjects.length === 0) return;
    const next = adminProjects.find((project) =>
      project.workspaceId === access.activeWorkspaceId && project.id === activeProject?.id,
    ) ?? adminProjects.find((project) => project.workspaceId === access.activeWorkspaceId);
    if (next && next.id !== selectedProjectId) setSelectedProjectId(next.id);
  }, [access?.activeWorkspaceId, activeProject?.id, adminProjects, selectedProjectId]);

  const loadSetup = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const next = await configApi.getEnergyProjectSetup(projectId);
      setSetup(next);
      setDocument(next.draft.document);
      setValidation(next.validation);
      const selection = initialTierSelection(next.draft.document);
      const ordered = tiersTopDown(next.draft.document);
      setSelectedNodeId(ordered.map((tier) => selection[tier.id]).filter(Boolean).at(-1) ?? null);
      setDirty(false);
    } catch (reason) {
      setError(messageFrom(reason, "Failed to load project setup"));
      setSetup(null);
      setDocument(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSelectedProjectState = useCallback(async () => {
    await Promise.all([
      loadSetup(selectedProjectId),
      refresh(),
    ]);
  }, [loadSetup, refresh, selectedProjectId]);

  useProjectSetupLoader(selectedProjectId, loadSetup);

  const changeDocument = useCallback((
    updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto,
  ) => {
    setDocument((current) => (current ? updater(current) : current));
    setDirty(true);
    setNotice(null);
  }, []);

  const persistDraft = useCallback(async () => {
    if (!setup || !document) throw new Error("Project setup is not loaded");
    if (!dirty) return setup.draft;
    const result = await configApi.saveEnergyProjectSetupDraft(selectedProjectId, {
      expectedRevision: setup.draft.revision,
      document,
    });
    setSetup((current) => current ? { ...current, draft: result.draft, validation: result.validation } : current);
    setDocument(result.draft.document);
    setValidation(result.validation);
    setDirty(false);
    await refresh();
    return result.draft;
  }, [dirty, document, refresh, selectedProjectId, setup]);

  const setupMatchesSelection = Boolean(setup && setup.draft.project_id === selectedProjectId);

  /** Saves an explicit document (not the possibly-stale state), for multi-step flows like Import & apply. */
  const persistDocument = useCallback(async (next: EnergyProjectSetupDocumentDto) => {
    if (!setup) throw new Error("Project setup is not loaded");
    const result = await configApi.saveEnergyProjectSetupDraft(selectedProjectId, {
      expectedRevision: setup.draft.revision,
      document: next,
    });
    setSetup((current) => current ? { ...current, draft: result.draft, validation: result.validation } : current);
    setDocument(result.draft.document);
    setValidation(result.validation);
    setDirty(false);
    await refresh();
    return result.draft.document;
  }, [refresh, selectedProjectId, setup]);

  const applyLive = useCallback(async () => {
    await configApi.applyEnergyProjectChanges(selectedProjectId);
    await refreshSelectedProjectState();
  }, [refreshSelectedProjectState, selectedProjectId]);

  const saveDraft = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await persistDraft();
      setNotice("Saving…");
      try {
        await configApi.applyEnergyProjectChanges(selectedProjectId);
        await refreshSelectedProjectState();
        setNotice("Saved. Live for everyone now.");
      } catch (reason) {
        setNotice(applyFailure(reason));
      }
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save draft"));
    } finally {
      setSaving(false);
    }
  }, [persistDraft, refreshSelectedProjectState, selectedProjectId]);

  const validateDraft = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await persistDraft();
      const result = await configApi.validateEnergyProjectSetup(selectedProjectId);
      setValidation(result);
      setNotice(result.blocking
        ? "Found problems that stop this change going live. Fix them, then save."
        : "Checked: nothing blocking. Any warnings are worth a look, but saving will apply the change.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to validate draft"));
    } finally {
      setSaving(false);
    }
  }, [persistDraft, selectedProjectId]);

  const publishProjectRevision = useCallback(async (review: ProjectPublicationReview) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const savedSetupDraft = await persistDraft();
      const result = await configApi.publishEnergyProjectSetup(selectedProjectId, {
        expectedRevision: savedSetupDraft.revision,
        expectedTemplateDraftRevision: review.templateDraft.revision,
        expectedMetricConfigRevision: review.metricConfig.revision,
        expectedRuleConfigRevision: review.ruleConfig.revision,
      });
      await refreshSelectedProjectState();
      setNotice(`Published ${result.template_revision_id}. Future edits remain in Draft until the next publication.`);
    } catch (reason) {
      setError(messageFrom(reason, "Failed to publish project revision"));
      throw reason;
    } finally {
      setSaving(false);
    }
  }, [persistDraft, refreshSelectedProjectState, selectedProjectId]);

  const discardUnsavedChanges = useCallback(() => {
    if (!setup || !dirty) return;
    if (!window.confirm("Discard all changes made since the last saved draft?")) return;
    setDocument(setup.draft.document);
    setValidation(setup.validation);
    const selection = initialTierSelection(setup.draft.document);
    setSelectedNodeId(
      tiersTopDown(setup.draft.document)
        .map((tier) => selection[tier.id])
        .filter(Boolean)
        .at(-1) ?? null,
    );
    setDirty(false);
    setNotice("Unsaved changes were discarded. The last saved draft is unchanged.");
  }, [dirty, setup]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const errorCount = validation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warningCount = validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0;
  const sectionMeta = adminSectionMeta(section, selectedProject?.name);
  const showSetupActions = section === "basics"
    || section === "structure"
    || section === "data-sources"
    || section === "meter-mapping";
  const showProjectLink = Boolean(selectedProject?.status === "published" && isProjectContext(section));
  const projectLinkTargetsOverview = section === "project-overview" || section === "templates";
  const chooseAdminProject = (projectId: string) => {
    const nextProject = projects.find((project) => project.id === projectId);
    if (!nextProject) return;
    setMeterMappingIntent(null);
    if (nextProject.workspaceId === access?.activeWorkspaceId) {
      setSelectedProjectId(projectId);
      selectProject(projectId);
      return;
    }
    setLoading(true);
    void selectProjectContext(nextProject.workspaceId, projectId).then(() => {
      setSelectedProjectId(projectId);
    });
  };

  return (
    <div className="flex min-h-full flex-col bg-surface-subtle lg:flex-row">
      <EnergyIqAdminSidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        activeSection={section}
        desktopCollapsed={adminNavigationCollapsed}
        onProjectChange={(projectId) => {
          chooseAdminProject(projectId);
          setSection("project-overview");
        }}
        onCreateProject={() => setNewProjectOpen(true)}
        onDesktopCollapsedChange={setAdminNavigationCollapsed}
        onSectionChange={(nextSection) => {
          setSection(nextSection);
          if (!embedded) router.replace(`/energyiq/admin?section=${nextSection}`, { scroll: false });
        }}
      />

      <div className="min-w-0 flex-1">
        <header className="energyiq-surface-header sticky top-0 z-20 border-b border-border bg-surface py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold">{sectionMeta.title}</h2>
                {showSetupActions && setup ? <LifecycleBadge setup={setup} dirty={dirty} /> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted">{sectionMeta.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {showSetupActions ? (
                <>
                  {dirty ? (
                    <button type="button" onClick={discardUnsavedChanges} disabled={saving || loading} className={secondaryButton}>
                      Discard changes
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void saveDraft()} disabled={saving || loading || !dirty} className={secondaryButton}>
                    Save &amp; apply
                  </button>
                  <button type="button" onClick={() => void validateDraft()} disabled={saving || loading} className={secondaryButton}>
                    Validate
                  </button>
                </>
              ) : null}
              {showProjectLink && selectedProject ? (
                <Link
                  href={projectLinkTargetsOverview
                    ? `/energyiq/overview?projectId=${encodeURIComponent(selectedProject.id)}`
                    : "/energyiq/explorer"}
                  onClick={() => selectProject(selectedProject.id)}
                  className={secondaryButton}
                >
                  {projectLinkTargetsOverview ? "Open customer Overview" : "View energy consumption"}
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        <div className="energyiq-content-gutter py-4 lg:py-6">
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          {notice ? <StatusMessage tone={validation?.blocking ? "warning" : "success"}>{notice}</StatusMessage> : null}
          {section === "models" ? <AdminModels /> : null}
          {section === "task-history" ? <AdminTaskHistory key={`${access?.user.id}:${access?.activeWorkspaceId}`} /> : null}
          {section === "organisations" || section === "users" ? (
            <AdminAccessPages initialView={section} />
          ) : null}
          {section !== "task-history" && section !== "models" && section !== "organisations" && section !== "users" && loading && !setupMatchesSelection ? <LoadingPanel /> : null}
          {/* Background refreshes keep the section mounted so in-progress results (e.g. an import summary) survive. */}
          {section !== "task-history" && section !== "models" && section !== "organisations" && section !== "users" && setupMatchesSelection && document && setup ? renderAdminSection({
            section,
            projects,
            selectedProject,
            chooseAdminProject,
            selectedProjectId,
            snapshotTransitionPin,
            setup,
            document,
            validation,
            errorCount,
            warningCount,
            meterMappingIntent,
            setMeterMappingIntent,
            selectedNodeId,
            setSelectedNodeId,
            changeDocument,
            setSection,
            publishing: saving,
            publishProjectRevision,
            onPoliciesChanged: refreshSelectedProjectState,
            persistDocument,
            applyLive,
          }) : null}
        </div>
      </div>

      {newProjectOpen ? (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onCreated={async (projectId) => {
            setNewProjectOpen(false);
            await refresh();
            await loadAdminProjects();
            setSelectedProjectId(projectId);
            setSection("basics");
          }}
        />
      ) : null}
    </div>
  );
}

function renderAdminSection({
  section,
  projects,
  selectedProject,
  chooseAdminProject,
  selectedProjectId,
  snapshotTransitionPin,
  setup,
  document,
  validation,
  errorCount,
  warningCount,
  meterMappingIntent,
  setMeterMappingIntent,
  selectedNodeId,
  setSelectedNodeId,
  changeDocument,
  setSection,
  publishing,
  publishProjectRevision,
  onPoliciesChanged,
  persistDocument,
  applyLive,
}: {
  section: AdminSection;
  projects: EnergyProjectDto[];
  selectedProject?: EnergyProjectDto;
  chooseAdminProject: (projectId: string) => void;
  selectedProjectId: string;
  snapshotTransitionPin: PreschoolSnapshotTransitionPin | null;
  setup: EnergyProjectSetupDto;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  errorCount: number;
  warningCount: number;
  meterMappingIntent: MeterMappingIntent | null;
  setMeterMappingIntent: Dispatch<SetStateAction<MeterMappingIntent | null>>;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  setSection: Dispatch<SetStateAction<AdminSection>>;
  publishing: boolean;
  publishProjectRevision: (review: ProjectPublicationReview) => Promise<void>;
  onPoliciesChanged: () => Promise<void>;
  persistDocument: (next: EnergyProjectSetupDocumentDto) => Promise<EnergyProjectSetupDocumentDto>;
  applyLive: () => Promise<void>;
}) {
  if (section === "overview") {
    return <AdminOverview projects={projects} selectedProject={selectedProject} chooseAdminProject={chooseAdminProject} setSection={setSection} />;
  }
  if (section === "report-agent") {
    return selectedProjectId ? <ReportAgentPanel key={selectedProjectId} projectId={selectedProjectId} /> : <p>Select a project first.</p>;
  }
  if (section === "project-overview") {
    return (
      <ProjectDeliveryOverview
        projectId={selectedProjectId}
        project={selectedProject}
        setup={setup}
        document={document}
        setSection={setSection}
        publishing={publishing}
        onPublish={publishProjectRevision}
      />
    );
  }
  if (section === "basics") {
    return (
      <ProjectProfile
        setup={setup}
        document={document}
        validation={validation}
        errorCount={errorCount}
        warningCount={warningCount}
        changeDocument={changeDocument}
        onBack={() => setSection("project-overview")}
      />
    );
  }
  if (section === "structure") {
    return (
      <StructureEditor
        projectId={selectedProjectId}
        document={document}
        validation={validation}
        selectedNodeId={selectedNodeId}
        setSelectedNodeId={setSelectedNodeId}
        changeDocument={changeDocument}
        onOpenMeterMapping={(node, kind) => {
          setMeterMappingIntent({ scopeId: node.id, scopeName: node.name, kind });
          setSection("meter-mapping");
        }}
      />
    );
  }
  if (section === "data-sources") {
    return (
      <DataSourcesPage
        projectId={selectedProjectId}
        document={document}
        savedDocument={setup.draft.document}
        changeDocument={changeDocument}
        setSection={setSection}
        persistDocument={persistDocument}
        applyLive={applyLive}
        onExternalChange={onPoliciesChanged}
      />
    );
  }
  if (section === "meter-mapping") {
    return (
      <MeterMappingPage
        setSection={setSection}
        intent={meterMappingIntent}
        document={document}
        changeDocument={changeDocument}
      />
    );
  }
  if (section === "operational-policies") {
    return (
      <OperationalPolicySettings
        projectId={selectedProjectId}
        setup={setup}
        onChanged={onPoliciesChanged}
      />
    );
  }
  if (section === "templates") {
    return (
      <AnalysisConfigurationPage
        projectId={selectedProjectId}
        document={document}
        businessCalendarVersion={setup.project.business_calendar_version}
        overviewProfile={setup.overviewProfile}
        published={selectedProject?.status === "published"}
      />
    );
  }
  if (section === "knowledge") {
    return <PlannedAdminPage {...plannedSectionCopy("knowledge")} />;
  }
  if (section === "methods") {
    return <PreschoolAdditionalMethodProposalAdmin projectId={selectedProjectId} />;
  }
  if (section === "ai-analysis") {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ProjectOverviewAiReadiness projectId={selectedProjectId} />
        {selectedProjectId === "preschool-demo" ? (
          <PreschoolAdditionalEvaluationAdmin
            projectId={selectedProjectId}
            initialPin={snapshotTransitionPin}
          />
        ) : null}
      </div>
    );
  }
  if (section === "harness") {
    return <ProjectHarnessConfiguration projectId={selectedProjectId} />;
  }
  if (section === "runs") {
    return <ProjectAiOperations projectId={selectedProjectId} />;
  }

  const planned = plannedSectionCopy(section);
  return <PlannedAdminPage title={planned.title} description={planned.description} dependency={planned.dependency} />;
}

const metricFamilyCopy: Record<EnergyMetricFamilyDto, { label: string; description: string }> = {
  aggregate: {
    label: "Core totals",
    description: "Stable totals used by the Project and Tier analysis templates.",
  },
  time: {
    label: "Time patterns",
    description: "Metrics that explain when consumption and demand occur.",
  },
  normalised: {
    label: "Normalised comparison",
    description: "Fair comparison after area or people metadata is available.",
  },
  quality: {
    label: "Data quality",
    description: "Signals that show whether the calculation has enough trustworthy facts.",
  },
};

const ruleFamilyCopy: Record<EnergyRuleFamilyDto, { label: string; description: string }> = {
  data_quality: {
    label: "Data integrity",
    description: "Deterministic checks that prevent a dashboard from presenting missing facts as a valid result.",
  },
  time: {
    label: "Time-based findings",
    description: "Findings derived from the selected period and the Project operating-hours calendar.",
  },
  comparison: {
    label: "Scope comparison",
    description: "Peer findings that only run when enough genuinely comparable child or sibling scopes exist.",
  },
};

function OverviewDeliverySummary({
  projectId,
  profile,
  presentation,
  published,
}: {
  projectId: string;
  profile: EnergyProjectOverviewProfileDto | null;
  presentation: ReturnType<typeof presentAdminOverviewProfile> | null;
  published: boolean;
}) {
  if (!profile || !presentation) {
    return (
      <section className="rounded-xl border border-step-warning/30 bg-surface p-5">
        <h3 className="text-base font-semibold">Customer Overview profile is not assigned</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Project configuration can remain in Draft, but the customer Overview is unavailable until a registered project Renderer is assigned.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-5 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{presentation.name}</h3>
            <span className="rounded-full bg-step-success/10 px-2.5 py-1 text-xs font-semibold text-step-success">
              Registered
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            One Project cutoff and Data Snapshot support the page. The customer Renderer combines current status, short-term change and the main decision range without a global Period selector.
          </p>
          <p className="mt-2 text-xs font-medium text-muted-light">{presentation.revisionLabel} · {profile.contractVersion}</p>
        </div>
        {published ? (
          <Link
            href={`/energyiq/overview?projectId=${encodeURIComponent(projectId)}`}
            className={primaryButton}
          >
            Open customer Overview
          </Link>
        ) : (
          <span className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted" aria-disabled="true">
            Publish to open customer Overview
          </span>
        )}
      </div>

      <dl className="grid border-t border-border bg-surface-subtle sm:grid-cols-3 sm:divide-x sm:divide-border">
        <OverviewHorizon label="Latest status" value={presentation.latestStatusLabel} detail="The latest complete local day." />
        <OverviewHorizon label="Short-term change" value={presentation.shortTermLabel} detail="Recent movement and recurring signals." />
        <OverviewHorizon label="Main decision range" value={presentation.mainRangeLabel} detail="Trend, contribution and structural comparison." />
      </dl>

      <div className="border-t border-border px-5 py-3 text-sm leading-6 text-muted">
        AI analysis runs separately after deterministic data is ready. Provider availability does not block this Overview or Project Publish.
      </div>
    </section>
  );
}

function OverviewHorizon({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 text-base font-semibold">{value}</dd>
      <p className="mt-1 text-sm leading-5 text-muted">{detail}</p>
    </div>
  );
}

function AnalysisConfigurationPage({
  projectId,
  document,
  businessCalendarVersion,
  overviewProfile,
  published,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  businessCalendarVersion: string;
  overviewProfile: EnergyProjectOverviewProfileDto | null;
  published: boolean;
}) {
  const [activeStep, setActiveStep] = useState<"metrics" | "rules" | "layout">("metrics");
  const [catalog, setCatalog] = useState<EnergyMetricRevisionDto[]>([]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [savedSelection, setSavedSelection] = useState<string[]>([]);
  const [ruleCatalog, setRuleCatalog] = useState<EnergyRuleRevisionDto[]>([]);
  const [ruleRevision, setRuleRevision] = useState(0);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [savedRuleSelection, setSavedRuleSelection] = useState<string[]>([]);
  const [componentCatalog, setComponentCatalog] = useState<EnergyComponentRevisionDto[]>([]);
  const [templateDraft, setTemplateDraft] = useState<EnergyProjectTemplateDraftDto | null>(null);
  const [savedTemplateDocument, setSavedTemplateDocument] = useState<EnergyTemplateDraftDocumentDto | null>(null);
  const [previewRange, setPreviewRange] = useState<EnergyPreviewRange | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState("project");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [metricResult, ruleResult, templateResult, importResult, coverageResult] = await Promise.all([
        configApi.getEnergyProjectMetricConfig(projectId),
        configApi.getEnergyProjectRuleConfig(projectId),
        configApi.getEnergyProjectTemplateDraft(projectId),
        configApi.listEnergyImportBatches(projectId).catch(() => ({ batches: [] })),
        configApi.getEnergyProjectDataCoverage(projectId).catch(() => ({ coverage: null })),
      ]);
      setCatalog(metricResult.catalog);
      setRevision(metricResult.config.revision);
      setSelected(metricResult.config.selected_metric_revision_ids);
      setSavedSelection(metricResult.config.selected_metric_revision_ids);
      setRuleCatalog(ruleResult.catalog);
      setRuleRevision(ruleResult.config.revision);
      setSelectedRules(ruleResult.config.selected_rule_revision_ids);
      setSavedRuleSelection(ruleResult.config.selected_rule_revision_ids);
      setComponentCatalog(templateResult.catalog);
      setTemplateDraft(templateResult.draft);
      setSavedTemplateDocument(templateResult.draft.document);
      setPreviewRange(resolveEnergyPreviewRange({
        coverage: coverageResult.coverage,
        batches: importResult.batches,
        timezone: document.project.timezone,
      }));
      setActiveTemplateId("project");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to load analysis configuration"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = selected.length !== savedSelection.length
    || selected.some((id) => !savedSelection.includes(id));
  const rulesDirty = selectedRules.length !== savedRuleSelection.length
    || selectedRules.some((id) => !savedRuleSelection.includes(id));
  const templateDirty = templateDraft !== null && savedTemplateDocument !== null
    && JSON.stringify(templateDraft.document) !== JSON.stringify(savedTemplateDocument);
  const saveMetrics = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await configApi.saveEnergyProjectMetricConfig(projectId, {
        expectedRevision: revision,
        selectedMetricRevisionIds: selected,
      });
      setCatalog(result.catalog);
      setRevision(result.config.revision);
      setSelected(result.config.selected_metric_revision_ids);
      setSavedSelection(result.config.selected_metric_revision_ids);
      setNotice("Metric selection saved as a new project configuration revision.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save metric configuration"));
    } finally {
      setSaving(false);
    }
  }, [projectId, revision, selected]);

  const saveRules = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await configApi.saveEnergyProjectRuleConfig(projectId, {
        expectedRevision: ruleRevision,
        selectedRuleRevisionIds: selectedRules,
      });
      setRuleCatalog(result.catalog);
      setRuleRevision(result.config.revision);
      setSelectedRules(result.config.selected_rule_revision_ids);
      setSavedRuleSelection(result.config.selected_rule_revision_ids);
      setNotice("Rule selection saved as a new project configuration revision.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save rule configuration"));
    } finally {
      setSaving(false);
    }
  }, [projectId, ruleRevision, selectedRules]);

  const saveTemplate = useCallback(async () => {
    if (!templateDraft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await configApi.saveEnergyProjectTemplateDraft(projectId, {
        expectedRevision: templateDraft.revision,
        document: templateDraft.document,
      });
      setComponentCatalog(result.catalog);
      setTemplateDraft(result.draft);
      setSavedTemplateDocument(result.draft.document);
      setNotice("Project and Tier template layouts saved as a new Draft revision.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save template layout"));
    } finally {
      setSaving(false);
    }
  }, [projectId, templateDraft]);

  const families = (["aggregate", "time", "normalised", "quality"] as const)
    .map((family) => ({ family, metrics: catalog.filter((metric) => metric.family === family) }))
    .filter((group) => group.metrics.length > 0);
  const readinessByMetricId = new Map(catalog.map((metric) => [
    metric.revision_id,
    resolveMetricReadiness(metric, document),
  ]));
  const selectedMetricIdSet = new Set(selected);
  const selectedRuleIdSet = new Set(selectedRules);
  const ruleFamilies = (["data_quality", "time", "comparison"] as const)
    .map((family) => ({ family, rules: ruleCatalog.filter((rule) => rule.family === family) }))
    .filter((group) => group.rules.length > 0);
  const readinessByRuleId = new Map(ruleCatalog.map((rule) => [
    rule.revision_id,
    resolveRuleReadiness(rule, document, selectedMetricIdSet, businessCalendarVersion),
  ]));
  const activeRevision = activeStep === "metrics"
    ? revision
    : activeStep === "rules"
      ? ruleRevision
      : templateDraft?.revision ?? 0;
  const profilePresentation = overviewProfile
    ? presentAdminOverviewProfile(overviewProfile)
    : null;

  return (
    <div className={["mx-auto space-y-5", activeStep === "layout" ? "max-w-[1800px]" : "max-w-6xl"].join(" ")}>
      <OverviewDeliverySummary
        projectId={projectId}
        profile={overviewProfile}
        presentation={profilePresentation}
        published={published}
      />

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Advanced release configuration</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              These versioned definitions are pinned when the Project is published. The customer Renderer owns the Overview page structure; these controls do not replace it.
            </p>
          </div>
          <span className="rounded-full bg-surface-subtle px-3 py-1 text-xs font-semibold text-muted">
            Draft config revision {activeRevision}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3" role="tablist" aria-label="Advanced release configuration">
          <AnalysisConfigTab title="Metrics" body="Approved deterministic calculations." active={activeStep === "metrics"} onClick={() => setActiveStep("metrics")} />
          <AnalysisConfigTab title="Rules" body="Versioned deterministic findings." active={activeStep === "rules"} onClick={() => setActiveStep("rules")} />
          <AnalysisConfigTab title="Release layout metadata" body="Advanced Component Catalog placements." active={activeStep === "layout"} onClick={() => setActiveStep("layout")} />
        </div>
      </section>

      {error ? <div className="rounded-lg border border-step-error/25 bg-step-error/5 px-4 py-3 text-xs text-step-error">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-step-success/25 bg-step-success/5 px-4 py-3 text-xs text-step-success">{notice}</div> : null}

      {activeStep === "metrics" ? <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h4 className="text-sm font-semibold">Metric catalog</h4>
            <p className="mt-1 text-[11px] text-muted">{selected.length} of {catalog.length} metric revisions enabled</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => setSelected(savedSelection)}
              className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void saveMetrics()}
              className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save selection"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-muted">Loading metric definitions...</div>
        ) : (
          <div className="space-y-7 p-5">
            {families.map(({ family, metrics }) => (
              <div key={family}>
                <div className="mb-3">
                  <h5 className="text-xs font-semibold">{metricFamilyCopy[family].label}</h5>
                  <p className="mt-1 text-[11px] text-muted">{metricFamilyCopy[family].description}</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {metrics.map((metric) => {
                    const checked = selectedMetricIdSet.has(metric.revision_id);
                    const readiness = readinessByMetricId.get(metric.revision_id);
                    return (
                      <label
                        key={metric.revision_id}
                        className={[
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                          checked ? "border-foreground/30 bg-surface-subtle" : "border-border hover:border-foreground/20",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelected((current) => checked
                            ? current.filter((id) => id !== metric.revision_id)
                            : [...current, metric.revision_id])}
                          className="mt-1 h-4 w-4 accent-current"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <strong className="text-xs">{metric.display_name}</strong>
                            <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-semibold text-muted">{metric.unit}</span>
                            <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] text-muted">v{metric.version}</span>
                            {readiness ? (
                              <span className={[
                                "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                                readiness.status === "ready"
                                  ? "bg-step-success/10 text-step-success"
                                  : readiness.status === "partial"
                                    ? "bg-step-warning/10 text-step-warning"
                                    : "bg-surface text-muted",
                              ].join(" ")}>{readiness.label}</span>
                            ) : null}
                          </span>
                          <span className="mt-1.5 block text-[11px] leading-4 text-muted">{metric.description}</span>
                          <span className="mt-2 block text-[10px] font-medium text-muted-light">
                            {readiness?.detail ?? "Readiness unavailable"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section> : activeStep === "rules" ? (
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h4 className="text-sm font-semibold">Rule catalog</h4>
              <p className="mt-1 text-[11px] text-muted">
                {selectedRules.length} of {ruleCatalog.length} deterministic rule revisions enabled · draft revision {ruleRevision}
              </p>
              <p className="mt-1 text-[10px] text-muted-light">
                Draft changes do not affect customer analysis until Review &amp; Publish.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!rulesDirty || saving}
                onClick={() => setSelectedRules(savedRuleSelection)}
                className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset
              </button>
              <button
                type="button"
                disabled={!rulesDirty || saving}
                onClick={() => void saveRules()}
                className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save selection"}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-muted">Loading rule definitions...</div>
          ) : (
            <div className="space-y-7 p-5">
              {ruleFamilies.map(({ family, rules }) => (
                <div key={family}>
                  <div className="mb-3">
                    <h5 className="text-xs font-semibold">{ruleFamilyCopy[family].label}</h5>
                    <p className="mt-1 text-[11px] text-muted">{ruleFamilyCopy[family].description}</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {rules.map((rule) => {
                      const checked = selectedRuleIdSet.has(rule.revision_id);
                      const readiness = readinessByRuleId.get(rule.revision_id);
                      return (
                        <label
                          key={rule.revision_id}
                          className={[
                            "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                            checked ? "border-foreground/30 bg-surface-subtle" : "border-border hover:border-foreground/20",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedRules((current) => checked
                              ? current.filter((id) => id !== rule.revision_id)
                              : [...current, rule.revision_id])}
                            className="mt-1 h-4 w-4 accent-current"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <strong className="text-xs">{rule.display_name}</strong>
                              <span className={[
                                "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                                rule.severity === "warning" ? "bg-step-warning/10 text-step-warning" : "bg-surface text-muted",
                              ].join(" ")}>{rule.severity}</span>
                              <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] text-muted">v{rule.version}</span>
                              {readiness ? (
                                <span className={[
                                  "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                                  readiness.status === "ready" ? "bg-step-success/10 text-step-success" : "bg-surface text-muted",
                                ].join(" ")}>{readiness.label}</span>
                              ) : null}
                            </span>
                            <span className="mt-1.5 block text-[11px] leading-4 text-muted">{rule.description}</span>
                            <span className="mt-2 block text-[10px] font-medium text-muted-light">
                              {readiness?.detail ?? "Readiness unavailable"} · {formatRuleParameters(rule)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <TemplateLayoutPanel
          loading={loading}
          saving={saving}
          document={document}
          componentCatalog={componentCatalog}
          templateDraft={templateDraft}
          savedTemplateDocument={savedTemplateDocument}
          selectedMetricRevisionIds={selectedMetricIdSet}
          selectedRuleRevisionIds={selectedRuleIdSet}
          businessCalendarVersion={businessCalendarVersion}
          projectId={projectId}
          previewRange={previewRange}
          overviewProfile={overviewProfile}
          published={published}
          activeTemplateId={activeTemplateId}
          setActiveTemplateId={setActiveTemplateId}
          dirty={templateDirty}
          onReset={() => setTemplateDraft((current) => current && savedTemplateDocument
            ? { ...current, document: savedTemplateDocument }
            : current)}
          onChange={(nextDocument) => setTemplateDraft((current) => current
            ? { ...current, document: nextDocument }
            : current)}
          onSave={() => void saveTemplate()}
        />
      )}
    </div>
  );
}

function TemplateLayoutPanel({
  loading,
  saving,
  document,
  componentCatalog,
  templateDraft,
  savedTemplateDocument,
  selectedMetricRevisionIds,
  selectedRuleRevisionIds,
  businessCalendarVersion,
  projectId,
  previewRange,
  overviewProfile,
  published,
  activeTemplateId,
  setActiveTemplateId,
  dirty,
  onReset,
  onChange,
  onSave,
}: {
  loading: boolean;
  saving: boolean;
  document: EnergyProjectSetupDocumentDto;
  componentCatalog: EnergyComponentRevisionDto[];
  templateDraft: EnergyProjectTemplateDraftDto | null;
  savedTemplateDocument: EnergyTemplateDraftDocumentDto | null;
  selectedMetricRevisionIds: ReadonlySet<string>;
  selectedRuleRevisionIds: ReadonlySet<string>;
  businessCalendarVersion: string;
  projectId: string;
  previewRange: EnergyPreviewRange | null;
  overviewProfile: EnergyProjectOverviewProfileDto | null;
  published: boolean;
  activeTemplateId: string;
  setActiveTemplateId: Dispatch<SetStateAction<string>>;
  dirty: boolean;
  onReset: () => void;
  onChange: (document: EnergyTemplateDraftDocumentDto) => void;
  onSave: () => void;
}) {
  const [selectedComponentRevisionId, setSelectedComponentRevisionId] = useState<string | null>(null);
  if (loading || !templateDraft || !savedTemplateDocument) {
    return (
      <section className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted">
        Loading Component Catalog and template layouts...
      </section>
    );
  }

  const tierById = new Map(document.tiers.map((tier) => [tier.id, tier]));
  const catalogById = new Map(componentCatalog.map((component) => [component.revision_id, component]));
  const selectedTemplate = templateDraft.document.templates.find((template) => template.template_id === activeTemplateId)
    ?? templateDraft.document.templates[0];
  if (!selectedTemplate) {
    return (
      <section className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted">
        Define and save the Project Tier structure before configuring templates.
      </section>
    );
  }

  const updateComponents = (components: EnergyTemplateDefinitionDto["components"]) => onChange({
    templates: templateDraft.document.templates.map((template) => template.template_id === selectedTemplate.template_id
      ? { ...template, components }
      : template),
  });
  const updatePlacement = (
    componentRevisionId: string,
    updater: (placement: EnergyTemplateDefinitionDto["components"][number]) => EnergyTemplateDefinitionDto["components"][number],
  ) => updateComponents(selectedTemplate.components.map((placement) => placement.component_revision_id === componentRevisionId
    ? updater(placement)
    : placement));
  const enabledCount = selectedTemplate.components.filter((placement) => placement.enabled).length;
  const templateLabel = selectedTemplate.target_kind === "project"
    ? "Project Overview"
    : `${tierById.get(selectedTemplate.tier_definition_id ?? "")?.alias ?? "Tier"} Template`;
  const previewPlan = buildTemplatePreviewPlan({
    template: selectedTemplate,
    document,
    catalog: componentCatalog,
    selectedMetricRevisionIds,
    selectedRuleRevisionIds,
    businessCalendarVersion,
  });
  const selectedPlacement = selectedTemplate.components.find(
    (placement) => placement.component_revision_id === selectedComponentRevisionId,
  ) ?? selectedTemplate.components.find((placement) => placement.enabled) ?? selectedTemplate.components[0];
  const selectedComponent = selectedPlacement
    ? catalogById.get(selectedPlacement.component_revision_id)
    : undefined;
  const selectedReadiness = selectedComponent
    ? resolveComponentReadiness(
        selectedComponent,
        selectedTemplate,
        document,
        selectedMetricRevisionIds,
        selectedRuleRevisionIds,
        businessCalendarVersion,
      )
    : undefined;
  const customerProfile = overviewProfile
    ? presentAdminOverviewProfile(overviewProfile)
    : null;
  const previewMode = resolveAdminOverviewPreviewMode(overviewProfile);

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h4 className="text-sm font-semibold">Release layout metadata</h4>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">
            {customerProfile
              ? `The ${customerProfile.name} Renderer owns the customer page structure. These Component Catalog placements remain versioned release metadata and do not reorder that page.`
              : "Choose controlled Component Catalog placements for the generic template preview."}
          </p>
          <p className="mt-1 text-xs text-muted-light">
            Draft revision {templateDraft.revision} · changes remain invisible to customers until Review &amp; Publish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!dirty || saving} onClick={onReset} className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">
            Reset
          </button>
          <button type="button" disabled={!dirty || saving} onClick={onSave} className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? "Saving..." : "Save layout"}
          </button>
        </div>
      </div>

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-light">Template scope</span>
            {templateDraft.document.templates.map((template) => {
              const active = template.template_id === selectedTemplate.template_id;
              const tier = template.tier_definition_id ? tierById.get(template.tier_definition_id) : undefined;
              const label = template.target_kind === "project" ? "Project Overview" : tier?.alias ?? "Tier Template";
              const count = template.components.filter((placement) => placement.enabled).length;
              return (
                <button
                  key={template.template_id}
                  type="button"
                  onClick={() => setActiveTemplateId(template.template_id)}
                  className={[
                    "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                    active ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:bg-surface-subtle hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="font-semibold">{label}</span>
                  <span className={["rounded-full px-1.5 py-0.5 text-[9px]", active ? "bg-background/15" : "bg-surface-subtle"].join(" ")}>{count}</span>
                </button>
              );
            })}
        </div>
      </div>

      <div className="grid min-h-[640px] xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
          <div className="p-4 sm:p-5 xl:sticky xl:top-[72px] xl:max-h-[calc(100vh-128px)] xl:overflow-y-auto">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h5 className="text-sm font-semibold">{templateLabel}</h5>
                <p className="mt-1 text-xs text-muted">
                  {enabledCount} enabled modules{customerProfile ? " · pinned as advanced release metadata" : " · generic preview renders from top to bottom"}
                </p>
              </div>
              <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[9px] font-semibold text-muted">
                {selectedTemplate.target_kind === "project" ? "PROJECT" : "TIER"}
              </span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h6 className="text-xs font-semibold">Modules</h6>
                <span className="text-[10px] text-muted-light">Enable · select · reorder</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {selectedTemplate.components.map((placement, index) => {
                  const component = catalogById.get(placement.component_revision_id);
                  if (!component) return null;
                  const readiness = resolveComponentReadiness(
                    component,
                    selectedTemplate,
                    document,
                    selectedMetricRevisionIds,
                    selectedRuleRevisionIds,
                    businessCalendarVersion,
                  );
                  const selected = selectedPlacement?.component_revision_id === placement.component_revision_id;
                  return (
                    <div
                      key={placement.component_revision_id}
                      className={[
                        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-2 transition-colors",
                        selected ? "border-foreground/35 bg-surface-subtle" : "border-border hover:border-foreground/20",
                        placement.enabled ? "" : "opacity-60",
                      ].join(" ")}
                    >
                      <label className="flex h-8 w-8 cursor-pointer items-center justify-center" title={`Enable ${component.display_name}`}>
                        <input
                          type="checkbox"
                          checked={placement.enabled}
                          onChange={() => updatePlacement(placement.component_revision_id, (item) => ({ ...item, enabled: !item.enabled }))}
                          className="h-4 w-4 accent-current"
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`Select ${component.display_name} module`}
                        aria-pressed={selected}
                        onClick={() => setSelectedComponentRevisionId(placement.component_revision_id)}
                        className="min-w-0 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                      >
                        <span className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface text-[9px] font-bold text-muted">{index + 1}</span>
                          <span className="truncate text-[11px] font-semibold">{component.display_name}</span>
                        </span>
                        <span className={[
                          "mt-1 block pl-7 text-[9px] font-medium",
                          readiness.status === "ready" ? "text-step-success" : readiness.status === "partial" ? "text-step-warning" : "text-muted-light",
                        ].join(" ")}>{readiness.label}</span>
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${component.display_name} up`}
                          disabled={index === 0}
                          onClick={() => updateComponents(movePlacement(selectedTemplate.components, index, index - 1))}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-25"
                        >
                          <EnergyIcon name="chevron" className="h-3.5 w-3.5 -rotate-90" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${component.display_name} down`}
                          disabled={index === selectedTemplate.components.length - 1}
                          onClick={() => updateComponents(movePlacement(selectedTemplate.components, index, index + 1))}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-25"
                        >
                          <EnergyIcon name="chevron" className="h-3.5 w-3.5 rotate-90" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h6 className="text-xs font-semibold">Selected module settings</h6>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {customerProfile
                      ? "These settings do not replace the registered customer Renderer."
                      : "Layout and appearance stay visible while you compare the generic Draft Preview."}
                  </p>
                </div>
                {selectedComponent && selectedReadiness ? (
                  <span className={[
                    "rounded-full px-2 py-1 text-[9px] font-semibold",
                    selectedReadiness.status === "ready"
                      ? "bg-step-success/10 text-step-success"
                      : selectedReadiness.status === "partial"
                        ? "bg-step-warning/10 text-step-warning"
                        : "bg-surface-subtle text-muted",
                  ].join(" ")}>{selectedReadiness.label}</span>
                ) : null}
              </div>

              {!selectedPlacement || !selectedComponent ? (
                <p className="mt-4 rounded-lg bg-surface-subtle px-3 py-4 text-[11px] text-muted">Select a module to configure its presentation.</p>
              ) : !selectedPlacement.enabled ? (
                <div className="mt-4 rounded-lg bg-surface-subtle px-3 py-4">
                  <p className="text-[11px] font-semibold">{selectedComponent.display_name} is disabled</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted">Enable it in the module list before changing its presentation.</p>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="mb-4">
                    <p className="text-xs font-semibold">{selectedComponent.display_name}</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted">{selectedComponent.description}</p>
                    <p className="mt-1 text-[9px] leading-4 text-muted-light">{selectedReadiness?.detail}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TemplatePlacementSelect
                      label="Section"
                      value={selectedPlacement.section_id ?? selectedTemplate.sections?.[0]?.section_id ?? ""}
                      options={(selectedTemplate.sections ?? []).map((section) => ({ value: section.section_id, label: section.navigation_label }))}
                      onChange={(sectionId) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, section_id: sectionId }))}
                    />
                    <TemplatePlacementSelect
                      label="Width"
                      value={String(selectedPlacement.layout?.span ?? 12)}
                      options={selectedComponent.allowed_presentation.layout.spans.map((span) => ({ value: String(span), label: spanLabel(span) }))}
                      onChange={(span) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, layout: { span: Number(span) as 4 | 6 | 8 | 12, height: item.layout?.height ?? "standard" } }))}
                    />
                    <TemplatePlacementSelect
                      label="Height"
                      value={selectedPlacement.layout?.height ?? "standard"}
                      options={selectedComponent.allowed_presentation.layout.heights.map((height) => ({ value: height, label: titleCase(height) }))}
                      onChange={(height) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, layout: { span: item.layout?.span ?? 12, height: height as "compact" | "standard" | "tall" } }))}
                    />
                    <TemplatePlacementSelect
                      label="Visual"
                      value={selectedPlacement.presentation?.visual_preset ?? "auto"}
                      options={selectedComponent.allowed_presentation.visuals.presets.map((preset) => ({ value: preset, label: visualPresetLabel(preset) }))}
                      onChange={(visualPreset) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, presentation: { ...defaultPresentation(item), visual_preset: visualPreset as "auto" | "cards" | "bar" | "area" | "table" | "list" } }))}
                    />
                    <TemplatePlacementSelect
                      label="Density"
                      value={selectedPlacement.presentation?.density ?? "comfortable"}
                      options={selectedComponent.allowed_presentation.visuals.densities.map((density) => ({ value: density, label: titleCase(density) }))}
                      onChange={(density) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, presentation: { ...defaultPresentation(item), density: density as "comfortable" | "compact" } }))}
                    />
                    <TemplatePlacementSelect
                      label="Tone"
                      value={selectedPlacement.presentation?.tone ?? "default"}
                      options={selectedComponent.allowed_presentation.visuals.tones.map((tone) => ({ value: tone, label: titleCase(tone) }))}
                      onChange={(tone) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, presentation: { ...defaultPresentation(item), tone: tone as "default" | "highlight" | "quiet" } }))}
                    />
                    <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-light sm:col-span-2">
                      Display title
                      <input
                        value={selectedPlacement.presentation?.title ?? ""}
                        placeholder={selectedComponent.display_name}
                        onChange={(event) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, presentation: withPresentationTitle(item, event.target.value) }))}
                        className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-[10px] font-medium normal-case tracking-normal text-foreground"
                      />
                    </label>
                    {selectedComponent.allowed_presentation.visuals.limit.configurable ? (
                      <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-light">
                        Row limit
                        <input
                          type="number"
                          min={selectedComponent.allowed_presentation.visuals.limit.min}
                          max={selectedComponent.allowed_presentation.visuals.limit.max}
                          value={selectedPlacement.presentation?.limit ?? selectedComponent.allowed_presentation.visuals.limit.default}
                          onChange={(event) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, presentation: { ...defaultPresentation(item), limit: Math.min(selectedComponent.allowed_presentation.visuals.limit.max, Math.max(selectedComponent.allowed_presentation.visuals.limit.min, Number(event.target.value) || selectedComponent.allowed_presentation.visuals.limit.min)) } }))}
                          className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-[10px] font-medium normal-case tracking-normal text-foreground"
                        />
                      </label>
                    ) : null}
                    {selectedComponent.allowed_presentation.visuals.legend.configurable ? (
                      <label className="flex min-h-8 items-center gap-2 self-end text-[10px] font-medium text-muted">
                        <input
                          type="checkbox"
                          checked={selectedPlacement.presentation?.show_legend ?? selectedComponent.allowed_presentation.visuals.legend.default}
                          onChange={(event) => updatePlacement(selectedPlacement.component_revision_id, (item) => ({ ...item, presentation: { ...defaultPresentation(item), show_legend: event.target.checked } }))}
                          className="h-4 w-4 accent-current"
                        />
                        Show chart legend
                      </label>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {previewMode === "customer-renderer-handoff" && customerProfile && overviewProfile ? (
          <CustomerOverviewPreviewHandoff
            projectId={projectId}
            profile={overviewProfile}
            presentation={customerProfile}
            published={published}
            dirty={dirty}
          />
        ) : (
          <TemplateDraftPreview
            key={`${projectId}:${selectedTemplate.template_id}`}
            projectId={projectId}
            plan={previewPlan}
            previewRange={previewRange}
            dirty={dirty}
          />
        )}
      </div>
      <TemplateChangeProposalPanel
        projectId={projectId}
        setupDocument={document}
        componentCatalog={componentCatalog}
        selectedMetricRevisionIds={selectedMetricRevisionIds}
        selectedRuleRevisionIds={selectedRuleRevisionIds}
        businessCalendarVersion={businessCalendarVersion}
        previewRange={previewRange}
      />
    </section>
  );
}

function CustomerOverviewPreviewHandoff({
  projectId,
  profile,
  presentation,
  published,
  dirty,
}: {
  projectId: string;
  profile: EnergyProjectOverviewProfileDto;
  presentation: ReturnType<typeof presentAdminOverviewProfile>;
  published: boolean;
  dirty: boolean;
}) {
  return (
    <div className="min-w-0 border-t border-border bg-background/40 p-4 sm:p-5 xl:border-t-0">
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-base font-semibold">Customer Overview preview</h5>
              {dirty ? <span className="rounded-full bg-step-warning/10 px-2.5 py-1 text-xs font-semibold text-step-warning">Unsaved release metadata</span> : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              The generic module preview is hidden because it does not represent the registered {presentation.name}. Open the published customer page to review the real Renderer and its fixed multi-horizon structure.
            </p>
          </div>
          <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted">
            {presentation.revisionLabel}
          </span>
        </div>

        <dl className="mt-5 divide-y divide-border rounded-xl bg-surface-subtle px-4">
          <SummaryRow label="Latest status" value={presentation.latestStatusLabel} />
          <SummaryRow label="Short-term change" value={presentation.shortTermLabel} />
          <SummaryRow label="Main decision range" value={presentation.mainRangeLabel} />
          <SummaryRow label="Snapshot contract" value={profile.contractVersion} />
        </dl>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="max-w-xl text-sm leading-6 text-muted">
            Draft Metric, Rule and layout revisions take effect only after Review &amp; Publish. AI results remain asynchronous and non-blocking.
          </p>
          {published ? (
            <Link href={`/energyiq/overview?projectId=${encodeURIComponent(projectId)}`} className={primaryButton}>
              Open customer Overview
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted" aria-disabled="true">
              Publish to open customer Overview
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplatePlacementSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-light">
      {label}
      <EnergySelect
        ariaLabel={label}
        value={value}
        options={options}
        onValueChange={onChange}
        className="mt-1 w-full"
        size="compact"
      />
    </div>
  );
}

function defaultPresentation(
  placement: EnergyTemplateDefinitionDto["components"][number],
): NonNullable<EnergyTemplateDefinitionDto["components"][number]["presentation"]> {
  return placement.presentation ?? {
    visual_preset: "auto",
    density: "comfortable",
    tone: "default",
    show_legend: true,
    limit: 10,
  };
}

function withPresentationTitle(
  placement: EnergyTemplateDefinitionDto["components"][number],
  value: string,
): NonNullable<EnergyTemplateDefinitionDto["components"][number]["presentation"]> {
  const current = defaultPresentation(placement);
  const title = value.trim();
  if (title) return { ...current, title };
  const { title: _removed, ...withoutTitle } = current;
  return withoutTitle;
}

function spanLabel(span: 4 | 6 | 8 | 12): string {
  if (span === 4) return "1/3 width";
  if (span === 6) return "1/2 width";
  if (span === 8) return "2/3 width";
  return "Full width";
}

function visualPresetLabel(preset: "auto" | "cards" | "bar" | "area" | "table" | "list"): string {
  if (preset === "bar") return "Bar chart";
  if (preset === "area") return "Area chart";
  return titleCase(preset);
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function movePlacement(
  placements: EnergyTemplateDefinitionDto["components"],
  from: number,
  to: number,
): EnergyTemplateDefinitionDto["components"] {
  if (to < 0 || to >= placements.length || from === to) return placements;
  const next = [...placements];
  const [placement] = next.splice(from, 1);
  if (!placement) return placements;
  next.splice(to, 0, placement);
  return next;
}

function AnalysisConfigTab({
  title,
  body,
  active = false,
  onClick,
}: {
  title: string;
  body: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        active ? "border-foreground/25 bg-surface-subtle" : "border-border hover:bg-surface-subtle",
      ].join(" ")}
    >
      <strong className="text-sm">{title}</strong>
      <span className="mt-1 block text-xs leading-5 text-muted">{body}</span>
    </button>
  );
}

function formatRuleParameters(rule: EnergyRuleRevisionDto): string {
  const threshold = rule.parameters.threshold_pct;
  if (typeof threshold === "number") return `Threshold ≥ ${threshold}%`;
  const medianRatio = rule.parameters.median_ratio;
  const minimumPeers = rule.parameters.minimum_peers;
  if (typeof medianRatio === "number" && typeof minimumPeers === "number") {
    return `≥ ${medianRatio}× sibling median · min ${minimumPeers} peers`;
  }
  if (typeof minimumPeers === "number") return `Minimum ${minimumPeers} comparable scopes`;
  return "Controlled deterministic evaluation";
}

function AdminOverview({
  projects,
  selectedProject,
  chooseAdminProject,
  setSection,
}: {
  projects: EnergyProjectDto[];
  selectedProject?: EnergyProjectDto;
  chooseAdminProject: (projectId: string) => void;
  setSection: Dispatch<SetStateAction<AdminSection>>;
}) {
  const publishedCount = projects.filter((project) => project.status === "published").length;
  const draftCount = projects.length - publishedCount;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_320px]">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">What needs attention</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                Start from delivery blockers. Operational alerts and AI usage will appear here after those services are connected.
              </p>
            </div>
            <span className="rounded-full bg-step-warning/10 px-2.5 py-1 text-[10px] font-semibold text-step-warning">
              {draftCount > 0 ? `${draftCount} draft project${draftCount === 1 ? "" : "s"}` : "Project setup active"}
            </span>
          </div>

          <div className="mt-5 divide-y divide-border border-y border-border">
            {projects.map((project) => (
              <div key={project.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted">
                  <EnergyIcon name="building" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{project.name}</p>
                  <p className="mt-0.5 text-[11px] capitalize text-muted">{project.status} · Project delivery</p>
                </div>
                <button type="button" onClick={() => {
                  chooseAdminProject(project.id);
                  setSection("project-overview");
                }} className={secondaryButton}>
                  Open project
                </button>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Portfolio status</h3>
          <dl className="mt-4 divide-y divide-border">
            <SummaryRow label="Projects" value={String(projects.length)} />
            <SummaryRow label="Published" value={String(publishedCount)} />
            <SummaryRow label="Draft or changing" value={String(draftCount)} />
          </dl>
          <p className="mt-4 text-[11px] leading-5 text-muted">
            Counts cover the projects available in this console. Open Runs & diagnostics to inspect available execution records; cost totals are not included here.
          </p>
        </aside>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Admin operating model</h3>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <OperatingArea title="Accounts & access" body="Manage customer organisations, invite users and assign project access." status="Active" />
          <OperatingArea title="Project delivery" body={`Configure ${selectedProject?.name ?? "a project"}, validate evidence, then publish it for customer use.`} status="Active" />
          <OperatingArea title="Runs & diagnostics" body="Inspect available run records, traces and runtime configuration. Usage and cost reporting are not connected." status="Available" />
        </div>
      </section>
    </div>
  );
}

function ProjectDeliveryOverview({
  projectId,
  project,
  setup,
  document,
  setSection,
  publishing,
  onPublish,
}: {
  projectId: string;
  project?: EnergyProjectDto;
  setup: EnergyProjectSetupDto;
  document: EnergyProjectSetupDocumentDto;
  setSection: Dispatch<SetStateAction<AdminSection>>;
  publishing: boolean;
  onPublish: (review: ProjectPublicationReview) => Promise<void>;
}) {
  const [batches, setBatches] = useState<EnergyImportBatchDto[]>([]);
  const [dataReadiness, setDataReadiness] = useState<EnergyProjectDataReadinessDto | null>(null);
  const [publicationReview, setPublicationReview] = useState<ProjectPublicationReview | null>(null);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingBatches(true);
    setReviewError(null);
    void Promise.all([
      configApi.listEnergyImportBatches(projectId),
      configApi.getEnergyProjectTemplateDraft(projectId),
      configApi.getEnergyProjectMetricConfig(projectId),
      configApi.getEnergyProjectRuleConfig(projectId),
    ])
      .then(([importResult, templateResult, metricResult, ruleResult]) => {
        if (!active) return;
        setBatches(importResult.batches);
        setDataReadiness(importResult.readiness);
        setPublicationReview({
          templateDraft: templateResult.draft,
          metricConfig: metricResult.config,
          ruleConfig: ruleResult.config,
        });
      })
      .catch((reason) => {
        if (!active) return;
        setBatches([]);
        setDataReadiness(null);
        setPublicationReview(null);
        setReviewError(messageFrom(reason, "Failed to load publication review"));
      })
      .finally(() => {
        if (active) setLoadingBatches(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const hasBasics = Boolean(document.project.name && document.project.timezone);
  const hasStructure = isTierStructureLocked(document) && document.tiers.length > 0 && document.nodes.length > 0;
  const latestBatch = batches[0];
  const hasConfirmedMapping = document.meter_mapping?.confirmed === true
    && document.meter_mapping.rows.length > 0;
  const progress = deriveProjectDeliveryProgress({
    hasBasics,
    hasStructure,
    hasSource: Boolean(latestBatch),
    hasConfirmedMapping,
    hasMaterializedFacts: dataReadiness?.ready === true,
    hasAnalysisConfiguration: publicationReview !== null,
    hasPublishedRevision: setup.published.templateRevisions.length > 0,
  });
  const { nextSection, nextLabel, stages } = progress;
  const latestTemplateRevision = setup.published.templateRevisions[0];
  const overviewProfilePresentation = setup.overviewProfile
    ? presentAdminOverviewProfile(setup.overviewProfile)
    : null;
  const readyToPublish = Boolean(
    publicationReview
    && hasConfirmedMapping
    && dataReadiness?.ready === true
    && !setup.validation.blocking,
  );
  const continueWorkflow = (target: AdminSection) => {
    if (target === "project-overview") {
      window.document.getElementById("review-publish")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSection(target);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h3 className="text-base font-semibold">{project?.name ?? document.project.name}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              This page coordinates the delivery workflow. Configuration remains in the specialist pages in the sidebar.
            </p>
          </div>
          <button type="button" onClick={() => continueWorkflow(nextSection)} className={primaryButton}>{nextLabel}</button>
        </div>

        <div className="mt-6 grid gap-2 lg:grid-cols-5">
          {stages.map((stage, index) => (
            <button
              key={stage.label}
              type="button"
              disabled={!stage.enabled}
              onClick={() => continueWorkflow(stage.section)}
              className="flex min-h-20 items-start gap-3 rounded-xl bg-surface-subtle p-3 text-left transition-colors enabled:hover:bg-primary-light/5 enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-primary/20 disabled:cursor-default"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-[10px] font-semibold text-muted">{index + 1}</span>
              <span>
                <span className="block text-xs font-semibold">{stage.label}</span>
                <span className={[
                  "mt-1 block text-[10px]",
                  stage.state === "Complete" || stage.state === "Draft ready" || stage.state === "Facts ready" || stage.state === "Ready to configure" || stage.state === "Configured" || stage.state === "Ready" || stage.state === "Published"
                    ? "text-step-success"
                    : "text-muted",
                ].join(" ")}>{stage.state}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <ProjectOverviewAiReadiness
        projectId={projectId}
        variant="summary"
        onOpenFull={() => setSection("ai-analysis")}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Configuration next step</h3>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-primary-light/5 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
              <EnergyIcon name="arrow" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{loadingBatches ? "Checking project data" : nextLabel}</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Structure is confirmed before source labels are mapped. Data Sources comes before Meter Mapping; virtual meters remain optional inside Mapping.
              </p>
            </div>
            <button type="button" onClick={() => continueWorkflow(nextSection)} disabled={loadingBatches} className={secondaryButton}>Continue</button>
          </div>
        </section>

        <aside className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Published configuration</h3>
          <dl className="mt-4 divide-y divide-border">
            <SummaryRow label="Hierarchy" value={setup.project.hierarchy_revision_id || "Not published"} />
            <SummaryRow label="Template" value={latestTemplateRevision?.revision_id ?? "Not published"} />
            <SummaryRow label="Overview" value={overviewProfilePresentation?.revisionLabel ?? "Not assigned"} />
            <SummaryRow label="Tiers" value={String(setup.published.tiers.length)} />
            <SummaryRow label="Nodes" value={String(Math.max(0, setup.published.nodes.length - 1))} />
          </dl>
        </aside>
      </div>

      <section id="review-publish" className="scroll-mt-24 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Review &amp; Publish</h3>
              <span className={[
                "rounded-full px-2.5 py-1 text-[9px] font-semibold",
                readyToPublish ? "bg-step-success/10 text-step-success" : "bg-step-warning/10 text-step-warning",
              ].join(" ")}>{readyToPublish ? "READY" : "BLOCKED"}</span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Publish one immutable revision that pins hierarchy, release layout metadata, metrics, rules, calendar, tariff and meter formula. The registered customer Renderer reads only the Published release.
            </p>
          </div>
          <button
            type="button"
            disabled={!readyToPublish || publishing || !publicationReview}
            onClick={() => {
              if (!publicationReview) return;
              if (!window.confirm("Publish the reviewed Project configuration as a new immutable revision?")) return;
              void onPublish(publicationReview).catch(() => undefined);
            }}
            className={primaryButton}
          >
            {publishing ? "Publishing..." : "Publish revision"}
          </button>
        </div>

        {reviewError ? <p className="mt-4 rounded-lg border border-step-error/25 bg-step-error/5 px-4 py-3 text-xs text-step-error">{reviewError}</p> : null}
        <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          <PublicationPin label="Hierarchy Draft" value={`r${setup.draft.revision}`} detail={`${document.tiers.length} tiers · ${document.nodes.length} nodes`} />
          <PublicationPin label="Template Draft" value={publicationReview ? `r${publicationReview.templateDraft.revision}` : "Loading"} detail={publicationReview ? `${publicationReview.templateDraft.document.templates.length} layouts` : "Waiting for configuration"} />
          <PublicationPin label="Metric Config" value={publicationReview ? `r${publicationReview.metricConfig.revision}` : "Loading"} detail={publicationReview ? `${publicationReview.metricConfig.selected_metric_revision_ids.length} metrics` : "Waiting for configuration"} />
          <PublicationPin label="Rule Config" value={publicationReview ? `r${publicationReview.ruleConfig.revision}` : "Loading"} detail={publicationReview ? `${publicationReview.ruleConfig.selected_rule_revision_ids.length} rules` : "Waiting for configuration"} />
        </dl>

        <div className="mt-4 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
          <ReviewGate
            label="Interval facts"
            ready={dataReadiness?.ready === true}
            detail={dataReadiness
              ? `${dataReadiness.materializedBatchCount}/${dataReadiness.importBatchCount} batches · ${dataReadiness.dataSnapshotId ?? dataReadiness.blockingReasons.join(", ")}`
              : "Checking composite Data Snapshot"}
          />
          <ReviewGate label="Meter mapping" ready={hasConfirmedMapping} detail={hasConfirmedMapping ? `${document.meter_mapping?.rows.length ?? 0} confirmed rows` : "Confirm Mapping first"} />
          <ReviewGate label="Setup validation" ready={!setup.validation.blocking} detail={setup.validation.blocking ? "Resolve blocking issues" : "No blocking issue"} />
          <ReviewGate
            label="Customer Overview"
            ready={overviewProfilePresentation !== null}
            detail={overviewProfilePresentation
              ? `${overviewProfilePresentation.revisionLabel} · AI remains non-blocking`
              : "No registered customer Renderer; configuration may publish but Overview remains unavailable"}
          />
        </div>
      </section>
    </div>
  );
}

function PublicationPin({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">{label}</dt>
      <dd className="mt-2 text-sm font-semibold">{value}</dd>
      <p className="mt-1 text-[10px] leading-4 text-muted">{detail}</p>
    </div>
  );
}

function ReviewGate({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface-subtle p-3">
      <span className={[
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
        ready ? "bg-step-success/10 text-step-success" : "bg-step-warning/10 text-step-warning",
      ].join(" ")}>{ready ? "✓" : "!"}</span>
      <div>
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 text-[10px] leading-4 text-muted">{detail}</p>
      </div>
    </div>
  );
}

function DataSourcesPage({
  projectId,
  document,
  savedDocument,
  changeDocument,
  setSection,
  persistDocument,
  applyLive,
  onExternalChange,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  savedDocument: EnergyProjectSetupDocumentDto;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  setSection: Dispatch<SetStateAction<AdminSection>>;
  persistDocument: (next: EnergyProjectSetupDocumentDto) => Promise<EnergyProjectSetupDocumentDto>;
  applyLive: () => Promise<void>;
  onExternalChange: () => Promise<void>;
}) {
  const [batches, setBatches] = useState<EnergyImportBatchDto[]>([]);
  const [dataReadiness, setDataReadiness] = useState<EnergyProjectDataReadinessDto | null>(null);
  const [loadingImports, setLoadingImports] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [applyStep, setApplyStep] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setLoadingImports(true);
    setImportError(null);
    try {
      const result = await configApi.listEnergyImportBatches(projectId);
      setBatches(result.batches);
      setDataReadiness(result.readiness);
    } catch (reason) {
      setImportError(messageFrom(reason, "Failed to load import batches"));
    } finally {
      setLoadingImports(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  // Live-connector projects (e.g. Tuya) publish through their sync; one-click import is for uploaded files only.
  const liveConnected = batches.some((batch) => batch.sourceKind !== "excel");
  const latest = batches[0];
  const mappingConfirmed = savedDocument.meter_mapping?.confirmed === true;
  const materializationGuard = evaluateEnergyImportMaterializationGuard({
    document,
    savedDocument,
    batches,
  });
  const pinCurrentBatches = async () => {
    if (batches.length === 0) return;
    setPinning(true);
    setImportError(null);
    try {
      const sourceManifest = await pinEnergySourceManifest(batches);
      changeDocument((current) => ({ ...current, source_manifest: sourceManifest }));
      setImportNotice(`${sourceManifest.source_sha256.length} batch SHA(s) pinned. Save Draft before building facts.`);
    } catch (reason) {
      setImportError(messageFrom(reason, "Failed to pin source batches"));
    } finally {
      setPinning(false);
    }
  };
  const useDetectedLabels = () => {
    if (batches.length === 0) return;
    const mapping = createMeterMappingFromSourceLabels(
      document,
      sourceLabelsAcrossImportBatches(batches),
      document.meter_mapping,
    );
    changeDocument((current) => ({ ...current, meter_mapping: mapping }));
    setImportNotice(`${mapping.rows.length} source labels were prepared as a Mapping draft. Unmatched labels still require an admin Scope selection.`);
  };

  const buildFacts = async (): Promise<{ built: number; reused: number }> => {
    let built = 0;
    let reused = 0;
    for (const batch of [...batches].reverse()) {
      const result = await configApi.materializeEnergyImportBatch(projectId, batch.id);
      if (result.duplicate) reused += 1;
      else built += 1;
      setBatches((current) => current.map((candidate) => candidate.id === result.batch.id ? result.batch : candidate));
      setDataReadiness(result.readiness);
    }
    await loadBatches();
    return { built, reused };
  };

  /** One click after mapping: pin the uploaded files, save, build the readings and make them live. */
  const importAndApply = async (prepared?: EnergyProjectSetupDocumentDto) => {
    if (batches.length === 0 || applyStep) return;
    const base = prepared ?? document;
    if (!base.meter_mapping?.confirmed) {
      setImportError("Finish Meter Mapping first: give each device a name and location, then click Mark Mapping Confirmed.");
      return;
    }
    setImportError(null);
    setImportNotice(null);
    try {
      setApplyStep("Saving your uploaded files (1 of 3)…");
      const sourceManifest = await pinEnergySourceManifest(batches);
      const saved = await persistDocument({ ...base, source_manifest: sourceManifest });
      const guard = evaluateEnergyImportMaterializationGuard({ document: saved, savedDocument: saved, batches });
      if (!guard.ready) {
        setImportError(`Can't import yet: ${guard.reasons.map((reason) => explainImportBlocker(reason)).join(" ")}`);
        return;
      }
      setApplyStep("Building readings (2 of 3)…");
      await buildFacts();
      setApplyStep("Making it live (3 of 3)…");
      await applyLive();
      setImportNotice("Readings imported and live. Check Project status & publishing if the project still needs its first publish.");
    } catch (reason) {
      setImportError(messageFrom(reason, "Import & apply failed"));
    } finally {
      setApplyStep(null);
    }
  };

  const materializeAll = async () => {
    if (batches.length === 0) return;
    setMaterializing(true);
    setImportError(null);
    setImportNotice(null);
    try {
      const { built, reused } = await buildFacts();
      setImportNotice(`${built} Import Batch(es) materialized; ${reused} current batch(es) reused. Composite Snapshot readiness was refreshed.`);
    } catch (reason) {
      setImportError(messageFrom(reason, "Fact materialization failed"));
    } finally {
      setMaterializing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {importError ? <StatusMessage tone="error">{importError}</StatusMessage> : null}
      {importNotice ? <StatusMessage tone="success">{importNotice}</StatusMessage> : null}
      <SmartImportPanel
        projectId={projectId}
        onOpenMapping={() => setSection("meter-mapping")}
        onChanged={() => { void loadBatches(); void onExternalChange(); }}
      />
      <SourceOption title="Tuya API" status="Connector pending" description="Daily synchronisation will reuse the same downstream mapping and quality rules." />
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Latest Import Batch</h3>
            <p className="mt-1 text-xs text-muted">An import is evidence only; it does not change the published hierarchy or Mapping.</p>
          </div>
          {latest ? (
            <span className={latest.status === "materialized" || latest.inspection.qualityStatus === "ready"
              ? "rounded-full bg-step-success/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-step-success"
              : "rounded-full bg-step-warning/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-step-warning"}
            >
              {latest.status === "materialized"
                ? "Facts ready"
                : latest.inspection.qualityStatus === "ready"
                  ? "Ready for mapping"
                  : "Review quality"}
            </span>
          ) : null}
        </div>
        {loadingImports ? (
          <p className="mt-5 text-xs text-muted">Loading imports...</p>
        ) : latest ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ImportFact label="Workbook" value={latest.filename} />
              <ImportFact label="Rows" value={`${latest.inspection.validRowCount.toLocaleString()} valid / ${latest.inspection.rowCount.toLocaleString()}`} />
              <ImportFact label="Source labels" value={String(latest.inspection.sourceLabels.length)} />
              <ImportFact label="Typical interval" value={latest.inspection.typicalIntervalMinutes ? `${latest.inspection.typicalIntervalMinutes} min` : "Unknown"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ImportFact label="Coverage" value={formatImportCoverage(latest)} />
              <ImportFact label="SHA-256" value={latest.sourceSha256.slice(0, 16)} mono />
            </div>
            {latest.materialization ? (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <ImportFact label="Source rows produced" value={latest.materialization.rawRowCount.toLocaleString()} />
                <ImportFact label="Source normalized produced" value={latest.materialization.normalizedReadingCount.toLocaleString()} />
                <ImportFact label="Source intervals produced" value={latest.materialization.intervalFactCount.toLocaleString()} />
                <ImportFact label="Source valid deltas" value={`${latest.materialization.totalUsageKwh.toLocaleString("en-SG", { maximumFractionDigits: 3 })} kWh`} />
              </div>
            ) : null}
            {latest.inspection.issues.length > 0 ? (
              <ul className="space-y-1 rounded-lg bg-step-warning/5 px-4 py-3 text-[11px] text-step-warning">
                {latest.inspection.issues.map((issue) => <li key={issue}>• {issue}</li>)}
              </ul>
            ) : (
              <p className="rounded-lg bg-step-success/5 px-4 py-3 text-[11px] text-step-success">Required fields, timestamps and cumulative readings passed the inspection.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                <p className="text-xs text-muted">Detected: {latest.inspection.columns.join(" · ")}</p>
                {latest.status !== "materialized" && !mappingConfirmed ? (
                  <p className="mt-1 text-[10px] text-step-warning">Confirm and save Meter Mapping before building facts.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={useDetectedLabels} disabled={batches.length === 0 || applyStep !== null} className={secondaryButton}>Use all detected labels</button>
                {liveConnected ? null : <button
                  type="button"
                  onClick={() => void importAndApply()}
                  disabled={batches.length === 0 || applyStep !== null}
                  title={document.meter_mapping?.confirmed ? "Pin the files, build the readings and make them live" : "Confirm Meter Mapping first"}
                  className={primaryButton}
                >
                  {applyStep ?? "Import & apply"}
                </button>}
              </div>
            </div>
            {liveConnected ? null : <p className="text-[11px] text-muted">
              {document.meter_mapping?.confirmed
                ? "Mapping confirmed. Import & apply saves the files, builds the readings and makes them live in one step."
                : <>Next: <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setSection("meter-mapping")}>name and place each device in Meter Mapping</button>, then come back and click Import & apply.</>}
            </p>}
            <details className="text-[11px] text-muted">
              <summary className="cursor-pointer select-none">Advanced: run the steps one at a time</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void pinCurrentBatches()} disabled={batches.length === 0 || pinning} className={secondaryButton}>
                  {pinning ? "Pinning batches..." : "Pin current batches"}
                </button>
                <button type="button" onClick={() => void materializeAll()} disabled={!materializationGuard.ready || materializing} className={secondaryButton}>
                  {materializing ? "Building facts..." : "Build all interval facts"}
                </button>
              </div>
              {!materializationGuard.ready ? (
                <p className="mt-2 text-[10px] text-step-warning">
                  Build blocked: {materializationGuard.reasons.join(" · ")}. Pin current batches, complete Mapping and Save Draft.
                </p>
              ) : null}
            </details>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-border px-5 py-8 text-center">
            <p className="text-sm font-semibold">No readings uploaded yet</p>
            <p className="mt-1 text-xs text-muted">Upload the first workbook above. Mapping stays unavailable until labels are inspected.</p>
          </div>
        )}
      </section>

      {dataReadiness ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Composite Data Snapshot</h3>
          <p className="mt-2 text-xs leading-5 text-muted">
            {dataReadiness.materializedBatchCount}/{dataReadiness.importBatchCount} batches · {dataReadiness.mappedSourceLabelCount}/{dataReadiness.sourceLabelCount} labels mapped · {dataReadiness.dataSnapshotId ?? "Snapshot pending"}
          </p>
          {dataReadiness.blockingReasons.length > 0 ? (
            <p className="mt-3 text-[11px] text-step-warning">Blocked: {dataReadiness.blockingReasons.join(" · ")}</p>
          ) : (
            <p className="mt-3 text-[11px] text-step-success">All registered batches, Mapping pins and canonical fact checks are current.</p>
          )}
          {dataReadiness.warnings.map((warning) => <p key={warning} className="mt-2 text-[10px] text-muted">{warning}</p>)}
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">First source workflow</h3>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          <WorkflowStep number="1" title="Add source" body="Choose Excel now or Tuya later." />
          <WorkflowStep number="2" title="Inspect labels" body="Confirm fields, time range and raw coverage." />
          <WorkflowStep number="3" title="Map meters" body="Continue to physical meter mapping." />
          <WorkflowStep number="4" title="Validate data" body="Review duplicates, gaps and quality evidence." />
        </ol>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="max-w-2xl text-xs leading-5 text-muted">
            Adding a source does not change customer-facing analysis until its mapping and quality checks are approved.
          </p>
          <button type="button" onClick={() => setSection("meter-mapping")} disabled={!document.meter_mapping?.rows.length} className={secondaryButton}>Open Meter Mapping</button>
        </div>
      </section>
    </div>
  );
}

function ImportFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-subtle px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 truncate text-xs font-semibold ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

const formatImportCoverage = (batch: EnergyImportBatchDto): string => {
  const from = batch.inspection.coverageFrom;
  const to = batch.inspection.coverageTo;
  if (!from || !to) return "Unknown";
  return `${new Date(from).toLocaleDateString("en-SG")} – ${new Date(to).toLocaleDateString("en-SG")}`;
};

function MeterMappingPage({
  setSection,
  intent,
  document,
  changeDocument,
}: {
  setSection: Dispatch<SetStateAction<AdminSection>>;
  intent: MeterMappingIntent | null;
  document: EnergyProjectSetupDocumentDto;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
}) {
  const mapping = document.meter_mapping ?? {
    schema_version: 2 as const,
    source_kind: "excel" as const,
    rows: [],
    confirmed: false,
  };
  const [reviewing, setReviewing] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState(
    () => mapping.rows.find((row) => row.scope_id === intent?.scopeId)?.id ?? mapping.rows[0]?.id ?? "",
  );
  const selectedRow = mapping.rows.find((row) => row.id === selectedRowId) ?? mapping.rows[0] ?? null;
  const aggregation = useMemo(() => buildAggregationReview(document, mapping), [document, mapping]);
  const conflicts = aggregation.filter((group) => group.conflict);
  const missingScopes = mapping.rows.filter((row) => !document.nodes.some((node) => node.id === row.scope_id));
  const setMapping = (next: EnergyMeterMappingDraftDto) => {
    changeDocument((current) => ({ ...current, meter_mapping: next }));
  };

  useEffect(() => {
    if (!selectedRowId && mapping.rows[0]) setSelectedRowId(mapping.rows[0].id);
  }, [mapping.rows, selectedRowId]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Data & Meters</span>
            <h3 className="mt-1 text-base font-semibold">Map source labels to existing Scopes</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">Mapping cannot create Floors, Rooms or Circuits. If a Scope is missing, return to Structure, add it, then continue here.</p>
          </div>
          {intent ? (
            <div className="rounded-lg bg-primary-light/5 px-3 py-2 text-right">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-primary">Selected from Structure</p>
              <p className="mt-0.5 text-xs font-semibold">{intent.scopeName}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          <MappingProgressStep number="1" label="Source labels" state="Complete" active={!reviewing} />
          <MappingProgressStep number="2" label="Physical Mapping" state={`${mapping.rows.length} labels`} active={!reviewing} />
          <MappingProgressStep number="3" label="Aggregation review" state={conflicts.length ? `${conflicts.length} conflicts` : "Ready"} active={reviewing} />
          <MappingProgressStep number="4" label="Confirm" state={mapping.confirmed ? "Confirmed" : "Draft"} active={false} />
        </div>
      </section>

      {!reviewing ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h4 className="text-sm font-semibold">Imported source labels</h4>
                <p className="mt-1 text-xs text-muted">Labels preserve the exact Excel `Device Name`; suggested Scopes remain editable by an admin.</p>
              </div>
              <span className="rounded-full bg-primary-light/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-primary">Excel import</span>
            </div>
            {mapping.rows.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <p className="text-sm font-semibold">No source labels available</p>
                <p className="mt-1 text-xs text-muted">Connect an Excel source, or complete the lowest Tier nodes for this pilot.</p>
              </div>
            ) : (
              <div className="max-h-[620px] overflow-auto divide-y divide-border">
                {mapping.rows.map((row) => {
                  const scope = document.nodes.find((node) => node.id === row.scope_id);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedRowId(row.id)}
                      className={[
                        "grid w-full gap-2 px-5 py-3 text-left transition-colors sm:grid-cols-[minmax(180px,1.3fr)_minmax(140px,1fr)_90px_88px] sm:items-center",
                        selectedRow?.id === row.id ? "bg-primary-light/5" : "hover:bg-surface-subtle",
                      ].join(" ")}
                    >
                      <span className="truncate text-xs font-semibold">{row.source_label}</span>
                      <span className="truncate text-[11px] text-muted">{scope ? nodePathLabel(document, scope.id) : "Missing Scope"}</span>
                      <span className="text-[10px] capitalize text-muted">{row.category}</span>
                      <span className={scope ? "text-[10px] font-semibold text-step-success" : "text-[10px] font-semibold text-step-error"}>{scope ? "Mapped" : "Needs Scope"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-5">
            {selectedRow ? (
              <MeterMappingEditor
                key={selectedRow.id}
                row={selectedRow}
                document={document}
                onApply={(nextRow) => setMapping(applyMeterMappingRowEdit(document, mapping, nextRow))}
                onReturnToStructure={() => setSection("structure")}
              />
            ) : null}
          </aside>
        </div>
      ) : (
        <AggregationReviewPanel
          document={document}
          mapping={mapping}
          groups={aggregation}
          onChange={(next) => setMapping({ ...next, confirmed: false })}
        />
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <h4 className="text-sm font-semibold">{reviewing ? "Confirm the Mapping Checkpoint" : "Ready to review aggregation?"}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">
            {reviewing
              ? "Mark the reviewed Mapping as confirmed, then use Save & apply in the page header. The change reaches customers straight away."
              : "Review groups by Scope, resource and category before confirmation. Overall is never added to Load, Light, Aircon or Other."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSection("structure")} className={secondaryButton}>Return to Structure</button>
          {reviewing ? (
            <>
              <button type="button" onClick={() => setReviewing(false)} className={secondaryButton}>Back to labels</button>
              <button
                type="button"
                disabled={conflicts.length > 0 || missingScopes.length > 0 || mapping.rows.length === 0}
                onClick={() => setMapping({ ...mapping, confirmed: true })}
                className={primaryButton}
              >
                Mark Mapping Confirmed
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setReviewing(true)} disabled={mapping.rows.length === 0} className={primaryButton}>Review aggregation</button>
          )}
        </div>
      </section>
    </div>
  );
}

function MappingProgressStep({ number, label, state, active }: { number: string; label: string; state: string; active: boolean }) {
  return (
    <div className={[
      "flex items-center gap-3 rounded-xl px-3 py-2.5",
      active ? "bg-primary-light/5" : "bg-surface-subtle",
    ].join(" ")}>
      <span className={[
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold",
        active ? "bg-primary text-white" : "bg-surface text-muted",
      ].join(" ")}>{number}</span>
      <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{label}</span><span className="block text-[9px] text-muted">{state}</span></span>
    </div>
  );
}

function MeterMappingEditor({
  row,
  document,
  onApply,
  onReturnToStructure,
}: {
  row: EnergyMeterMappingRowDto;
  document: EnergyProjectSetupDocumentDto;
  onApply: (row: EnergyMeterMappingRowDto) => void;
  onReturnToStructure: () => void;
}) {
  const [draft, setDraft] = useState(row);
  const scopeExists = document.nodes.some((node) => node.id === draft.scope_id);
  const orderedTiers = tiersTopDown(document);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h4 className="text-sm font-semibold">Mapping details</h4>
      <p className="mt-1 text-xs leading-5 text-muted">A source label always creates or updates a Physical Meter Point. Virtual Meters are optional and reviewed after this step.</p>
      <div className="mt-5 space-y-4">
        <ReadOnlyField label="Source label" value={draft.source_label} />
        <Field label="Meter display name">
          <input value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} className={inputClass} />
        </Field>
        <Field label="Existing Scope" hint="Scopes are created only in Structure.">
          <EnergySelect
            ariaLabel="Existing Scope"
            value={draft.scope_id}
            options={[
              { value: "", label: "Select an existing Scope" },
              ...orderedTiers.flatMap((tier) => document.nodes
                .filter((node) => node.tier_definition_id === tier.id)
                .map((node) => ({ value: node.id, label: `${tier.alias} · ${nodePathLabel(document, node.id)}` }))),
            ]}
            onValueChange={(scopeId) => setDraft((current) => ({
              ...current,
              scope_id: scopeId,
              navigation_scope_id: scopeId,
            }))}
            invalid={!scopeExists}
            className="w-full"
          />
          {!scopeExists ? <button type="button" onClick={onReturnToStructure} className="mt-2 text-[11px] font-semibold text-step-error hover:underline">Scope missing · Return to Structure</button> : null}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resource">
            <EnergySelect ariaLabel="Resource" value={draft.resource} options={resourceOptions} onValueChange={(resource) => setDraft((current) => ({ ...current, resource: resource as EnergyMeterMappingRowDto["resource"] }))} className="w-full" />
          </Field>
          <Field label="Category">
            <EnergySelect ariaLabel="Category" value={draft.category} options={categoryOptions} onValueChange={(category) => setDraft((current) => ({ ...current, category: category as EnergyMeterMappingRowDto["category"] }))} className="w-full" />
          </Field>
        </div>
        <Field label="Coverage" hint="This describes what the meter covers inside the selected Scope and Category.">
          <EnergySelect
            ariaLabel="Coverage"
            value={draft.coverage}
            options={[
              { value: "whole", label: "Whole scope" },
              { value: "partial", label: "Partial" },
              { value: "reference", label: "Reference only" },
            ]}
            onValueChange={(coverage) => setDraft((current) => ({ ...current, coverage: coverage as EnergyMeterMappingRowDto["coverage"] }))}
            className="w-full"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Meter Role">
            <EnergySelect
              ariaLabel="Meter Role"
              value={draft.meter_role}
              options={[
                { value: "total", label: "Total" },
                { value: "component", label: "Component" },
                { value: "standalone", label: "Standalone" },
              ]}
              onValueChange={(meterRole) => setDraft((current) => ({ ...current, meter_role: meterRole as EnergyMeterMappingRowDto["meter_role"] }))}
              className="w-full"
            />
          </Field>
          <Field label="Official aggregation">
            <EnergySelect
              ariaLabel="Official aggregation"
              value={draft.aggregation_usage}
              options={[
                { value: "official", label: "Included" },
                { value: "excluded", label: "Excluded" },
              ]}
              onValueChange={(aggregationUsage) => setDraft((current) => ({ ...current, aggregation_usage: aggregationUsage as EnergyMeterMappingRowDto["aggregation_usage"] }))}
              className="w-full"
            />
          </Field>
        </div>
        {draft.meter_role === "standalone" && draft.aggregation_usage === "official" ? (
          <p className="rounded-lg bg-step-error/10 px-3 py-2 text-[11px] font-medium text-step-error">Standalone meters must be excluded from official aggregation.</p>
        ) : null}
        <button type="button" disabled={!scopeExists || !draft.display_name.trim() || (draft.meter_role === "standalone" && draft.aggregation_usage === "official")} onClick={() => onApply({ ...draft, display_name: draft.display_name.trim() })} className={`${primaryButton} w-full`}>Apply Mapping</button>
      </div>
    </section>
  );
}

function AggregationReviewPanel({
  document,
  mapping,
  groups,
  onChange,
}: {
  document: EnergyProjectSetupDocumentDto;
  mapping: EnergyMeterMappingDraftDto;
  groups: ReturnType<typeof buildAggregationReview>;
  onChange: (mapping: EnergyMeterMappingDraftDto) => void;
}) {
  const overallCount = groups.filter((group) => group.category === "overall").length;
  const [addingVirtual, setAddingVirtual] = useState(false);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h4 className="text-sm font-semibold">Official aggregation review</h4>
          <p className="mt-1 text-xs leading-5 text-muted">One official Total is allowed for each Scope, resource and category. Included Components are summed only when no official Total is selected.</p>
        </div>
        <div className="divide-y divide-border">
          {groups.map((group) => (
            <div key={group.key} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(160px,1fr)_100px_minmax(180px,1fr)_90px] md:items-center">
              <div><p className="text-xs font-semibold">{group.scopeName}</p><p className="mt-0.5 text-[10px] capitalize text-muted">{group.resource}</p></div>
              <span className="text-[10px] font-semibold capitalize text-muted">{group.category}</span>
              <div><p className="text-[11px] font-semibold capitalize">{group.recommendation}</p><p className="mt-0.5 text-[10px] text-muted">{group.officialTotals.length} totals · {group.officialComponents.length} components · {group.excluded.length} excluded</p></div>
              <span className={group.conflict ? "text-[10px] font-semibold text-step-error" : "text-[10px] font-semibold text-step-success"}>{group.conflict ? "Conflict" : "Ready"}</span>
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-semibold">Review summary</h4>
          <dl className="mt-4 divide-y divide-border">
            <SummaryRow label="Physical labels" value={String(mapping.rows.length)} />
            <SummaryRow label="Aggregation groups" value={String(groups.length)} />
            <SummaryRow label="Overall routes" value={String(overallCount)} />
            <SummaryRow label="Missing Scopes" value={String(mapping.rows.filter((row) => !document.nodes.some((node) => node.id === row.scope_id)).length)} />
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-semibold">Optional Virtual Meter</h4>
          <p className="mt-2 text-xs leading-5 text-muted">Create an optional + / - formula from mapped physical meters. Virtual Meters stay standalone and excluded from official totals.</p>
          <button type="button" onClick={() => setAddingVirtual((current) => !current)} className={`${secondaryButton} mt-4 w-full`}>{addingVirtual ? "Cancel" : "Add Virtual Meter"}</button>
        </section>
      </aside>
      {(addingVirtual || (mapping.virtual_meters?.length ?? 0) > 0) ? (
        <VirtualMeterPanel
          document={document}
          mapping={mapping}
          adding={addingVirtual}
          onCancel={() => setAddingVirtual(false)}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function VirtualMeterPanel({
  document,
  mapping,
  adding,
  onCancel,
  onChange,
}: {
  document: EnergyProjectSetupDocumentDto;
  mapping: EnergyMeterMappingDraftDto;
  adding: boolean;
  onCancel: () => void;
  onChange: (mapping: EnergyMeterMappingDraftDto) => void;
}) {
  const initialScopeId = mapping.rows[0]?.scope_id ?? document.nodes[0]?.id ?? "";
  const [name, setName] = useState("Load 12");
  const [scopeId, setScopeId] = useState(initialScopeId);
  const [resource, setResource] = useState<EnergyVirtualMeterDto["resource"]>("electricity");
  const [category, setCategory] = useState<EnergyVirtualMeterDto["category"]>("load");
  const [terms, setTerms] = useState<Record<string, 0 | 1 | -1>>({});
  const selectedTerms = Object.entries(terms).filter((entry): entry is [string, 1 | -1] => entry[1] !== 0);
  const availableRows = mapping.rows.filter((row) => row.resource === resource);
  const saveVirtualMeter = () => {
    const virtualMeter: EnergyVirtualMeterDto = {
      id: `virtual-${Date.now()}`,
      display_name: name.trim(),
      scope_id: scopeId,
      resource,
      category,
      terms: selectedTerms.map(([mappingRowId, coefficient]) => ({ mapping_row_id: mappingRowId, coefficient })),
    };
    onChange({ ...mapping, virtual_meters: [...(mapping.virtual_meters ?? []), virtualMeter] });
    onCancel();
  };
  return (
    <section className="rounded-xl border border-border bg-surface xl:col-span-2">
      <div className="border-b border-border px-5 py-4">
        <h4 className="text-sm font-semibold">Virtual Meters</h4>
        <p className="mt-1 text-xs leading-5 text-muted">Optional derived values for comparison or gap analysis. They never alter official rollups in this pilot.</p>
      </div>
      {(mapping.virtual_meters?.length ?? 0) > 0 ? (
        <div className="divide-y divide-border">
          {mapping.virtual_meters?.map((virtualMeter) => (
            <div key={virtualMeter.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-xs font-semibold">{virtualMeter.display_name}</p>
                <p className="mt-1 text-[10px] text-muted">{nodePathLabel(document, virtualMeter.scope_id)} · {virtualMeter.terms.map((term, index) => {
                  const label = mapping.rows.find((row) => row.id === term.mapping_row_id)?.display_name ?? "Missing meter";
                  return `${index === 0 && term.coefficient === 1 ? "" : term.coefficient === 1 ? "+ " : "- "}${label}`;
                }).join(" ")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">Standalone · Excluded</span>
                <button type="button" onClick={() => onChange({ ...mapping, virtual_meters: mapping.virtual_meters?.filter((item) => item.id !== virtualMeter.id) })} className="text-[10px] font-semibold text-step-error hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {adding ? (
        <div className="grid gap-5 border-t border-border p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Field label="Display name"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
            <Field label="Existing Scope">
              <EnergySelect
                ariaLabel="Existing Scope"
                value={scopeId}
                options={tiersTopDown(document).flatMap((tier) => document.nodes
                  .filter((node) => node.tier_definition_id === tier.id)
                  .map((node) => ({ value: node.id, label: `${tier.alias} · ${nodePathLabel(document, node.id)}` })))}
                onValueChange={setScopeId}
                className="w-full"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Resource">
                <EnergySelect ariaLabel="Resource" value={resource} options={resourceOptions} onValueChange={(nextResource) => { setResource(nextResource as EnergyVirtualMeterDto["resource"]); setTerms({}); }} className="w-full" />
              </Field>
              <Field label="Category">
                <EnergySelect ariaLabel="Category" value={category} options={categoryOptions} onValueChange={(nextCategory) => setCategory(nextCategory as EnergyVirtualMeterDto["category"])} className="w-full" />
              </Field>
            </div>
            <button type="button" disabled={!name.trim() || !scopeId || selectedTerms.length < 2} onClick={saveVirtualMeter} className={`${primaryButton} w-full`}>Save Virtual Meter</button>
            <p className="text-[10px] leading-4 text-muted">Choose at least two inputs. Use + to sum circuits or - to calculate a residual from a total.</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Formula inputs</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {availableRows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                  <EnergySelect
                    ariaLabel={`Formula operator for ${row.source_label}`}
                    value={String(terms[row.id] ?? 0)}
                    options={formulaOperatorOptions}
                    onValueChange={(operator) => setTerms((current) => ({ ...current, [row.id]: Number(operator) as 0 | 1 | -1 }))}
                    className="w-16 shrink-0"
                    menuClassName="min-w-24"
                    size="compact"
                  />
                  <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{row.display_name}</span><span className="block truncate text-[9px] text-muted">{nodePathLabel(document, row.scope_id)}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PlannedAdminPage({ title, description, dependency }: { title: string; description: string; dependency: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <section className="rounded-xl border border-border bg-surface p-6">
        <span className="inline-flex rounded-full bg-surface-subtle px-2.5 py-1 text-[10px] font-semibold text-muted">Planned</span>
        <h3 className="mt-4 text-base font-semibold">{title}</h3>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">{description}</p>
        <p className="mt-5 border-t border-border pt-4 text-xs text-muted"><strong className="text-foreground">Depends on:</strong> {dependency}</p>
      </section>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-xs text-muted">{label}</dt><dd className="max-w-[60%] truncate text-xs font-semibold">{value}</dd></div>;
}

function OperatingArea({ title, body, status }: { title: string; body: string; status: string }) {
  return <div><div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold">{title}</h4><span className="text-[10px] text-muted-light">{status}</span></div><p className="mt-2 text-xs leading-5 text-muted">{body}</p></div>;
}

function SourceOption({ title, status, description, active = false }: { title: string; status: string; description: string; active?: boolean }) {
  return <div className={["rounded-xl p-4", active ? "bg-primary-light/5" : "bg-surface-subtle"].join(" ")}><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">{title}</h4><span className={active ? "text-[10px] font-semibold text-step-success" : "text-[10px] text-muted-light"}>{status}</span></div><p className="mt-2 text-xs leading-5 text-muted">{description}</p></div>;
}

function WorkflowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return <li className="flex items-start gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-[10px] font-semibold text-muted">{number}</span><span><strong className="block text-xs">{title}</strong><span className="mt-1 block text-[11px] leading-4 text-muted">{body}</span></span></li>;
}

function plannedSectionCopy(section: AdminSection): { title: string; description: string; dependency: string } {
  const copy: Partial<Record<AdminSection, { title: string; description: string; dependency: string }>> = {
    "data-map": { title: "Data Map", description: "Review configured scopes, meters, sources and trusted relationships without replacing authoritative project configuration.", dependency: "Published Structure and Meter Mapping" },
    templates: { title: "Legacy Overview Design", description: "Review the deterministic customer Overview, metrics, rules, layout and pinned release configuration.", dependency: "Registered Overview profile, metrics, rules and mapped facts" },
    "ai-analysis": { title: "Legacy AI Insights", description: "Check whether Key Findings, Section analysis and Additional AI Insights are ready for the current Project data.", dependency: "Published customer Overview and current data" },
    knowledge: { title: "Project Knowledge", description: "Add operational documents that AI may cite. Structured meter facts and mappings do not belong in the knowledge base.", dependency: "Project scope and access policy" },
    methods: { title: "Legacy Methods & SOP", description: "Review and govern analysis method proposals derived from useful Additional AI Insights.", dependency: "Published Additional AI Insights and admin review" },
    assets: { title: "Project Assets", description: "Store project files that belong to this Project rather than a user's personal temporary assets.", dependency: "Project scope and storage policy" },
  };
  return copy[section] ?? { title: "Admin capability", description: "This capability is part of the agreed Admin information architecture but is not connected in the current pilot.", dependency: "A later implementation batch" };
}

function isProjectContext(section: AdminSection): boolean {
  return ["project-overview", "basics", "structure", "data-sources", "meter-mapping", "operational-policies", "data-map", "templates", "ai-analysis", "knowledge", "methods", "assets", "runs", "harness", "report-agent"].includes(section);
}

function adminSectionMeta(section: AdminSection, projectName?: string): { title: string; description: string } {
  const project = projectName ?? "Selected project";
  const copy: Record<AdminSection, { title: string; description: string }> = {
    overview: { title: "Overview", description: "Delivery priorities and platform operations across the current Workspace." },
    organisations: { title: "Organisations", description: "Customer organisations and Workspace ownership." },
    users: { title: "Users", description: "Accounts, membership and Project access." },
    "project-overview": { title: "Project status & publishing", description: `${project} · delivery status, blockers and next action.` },
    basics: { title: "Project basics", description: `${project} · identity, timezone and stable Project scope.` },
    structure: { title: "Structure", description: `${project} · define meaningful Tiers and Nodes from the lowest scope upward.` },
    "data-sources": { title: "Data Sources", description: `${project} · Excel now, Tuya later, one downstream fact contract.` },
    "meter-mapping": { title: "Meter Mapping", description: `${project} · source labels to physical meters, scopes and optional derived meters.` },
    "operational-policies": { title: "Tariff & Operating Hours", description: `${project} · immutable effective policy revisions prepared for the next Project publication.` },
    "data-map": { title: "Data Map", description: `${project} · trusted configured relationships and traceable lineage.` },
    templates: { title: "Legacy Overview Design", description: `${project} · deterministic customer Overview, decision horizons and pinned release configuration.` },
    "ai-analysis": { title: "Legacy AI Insights", description: `${project} · current Key Findings, Section analysis, Additional AI Insights and the next generation action.` },
    "report-agent": { title: "HTML Reports", description: `${project} · create, revise and schedule complete AI reports.` },
    knowledge: { title: "Knowledge", description: `${project} · documents and citations available to AI.` },
    methods: { title: "Legacy Methods & SOP", description: `${project} · governed analysis methods and SOP proposals.` },
    assets: { title: "Assets", description: `${project} · Project-owned files and source material.` },
    runs: { title: "Runs & Traces", description: `${project} · historical configuration, context, Tool outcomes, tokens and Artifact lineage from persisted Run evidence.` },
    conversations: { title: "Conversations & Queries", description: "Customer questions, common intents and support investigation." },
    usage: { title: "Usage & Cost", description: "Model usage, token cost and budget signals." },
    traces: { title: "Traces", description: "AI session execution and evidence traces." },
    harness: { title: "Harness Configuration", description: `${project} · current server-owned Models, Skills, Methods, Tools, MCP, Context and instruction layers.` },
    "task-history": { title: "Task history", description: "Review report and analysis runs in the current organisation." },
    models: { title: "Models", description: "Choose the model used by AI conversations and reports across all projects." },
    skills: { title: "Skills", description: "Managed analysis skills available to EnergyX agents." },
    tools: { title: "Tools", description: "Tool permissions and runtime availability." },
    mcp: { title: "MCP", description: "External MCP servers and their approved capabilities." },
  };
  return copy[section];
}

/** Exported for tests: the Project basics panel is not reachable without the whole console. */
export function ProjectProfile({
  setup,
  document,
  validation,
  errorCount,
  warningCount,
  changeDocument,
  onBack,
}: {
  setup: EnergyProjectSetupDto;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  errorCount: number;
  warningCount: number;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Project profile</h3>
              <button type="button" onClick={onBack} className="text-xs font-medium text-primary hover:text-primary-light">Back to Project Overview</button>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Keep the Project as a stable business container. Estate, Block, Floor, Room, Area and Circuit belong in the configurable tier ladder only when they add analytical value.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name">
              <input
                value={document.project.name}
                onChange={(event) => changeDocument((current) => ({
                  ...current,
                  project: { ...current.project, name: event.target.value },
                }))}
                className={inputClass}
              />
            </Field>
            <Field label="Timezone">
              <EnergySelect
                ariaLabel="Timezone"
                value={document.project.timezone}
                options={timezoneOptions}
                onValueChange={(timezone) => changeDocument((current) => ({
                  ...current,
                  project: { ...current.project, timezone },
                }))}
                className="w-full"
              />
            </Field>
            <Field label="Overview shows" hint="Which saved report the Overview page shows for this project.">
              <EnergySelect
                ariaLabel="Overview shows"
                value={document.project.overview_cadence ?? "monthly"}
                options={overviewCadenceOptions}
                onValueChange={(cadence) => changeDocument((current) => ({
                  ...current,
                  project: { ...current.project, overview_cadence: cadence as EnergyOverviewCadenceDto },
                }))}
                className="w-full"
              />
            </Field>
            <ReadOnlyField label="Project ID" value={setup.project.id} />
            <ReadOnlyField label="Workspace ID" value={setup.project.workspace_id} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Published configuration</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Fact label="Hierarchy revision" value={setup.project.hierarchy_revision_id} />
            <Fact label="Published tiers" value={String(setup.published.tiers.length)} />
            <Fact label="Published nodes" value={String(Math.max(0, setup.published.nodes.length - 1))} />
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">
            Draft changes do not alter Overview, Energy consumption or AI query scope. Publish creates one immutable hierarchy snapshot and atomically switches customer pages to it.
          </p>
        </section>
      </div>

      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Setup readiness</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Fact label="Blocking errors" value={String(errorCount)} tone={errorCount ? "error" : "default"} />
            <Fact label="Warnings" value={String(warningCount)} tone={warningCount ? "warning" : "default"} />
          </div>
          <ValidationList validation={validation} compact />
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Recommended order</h3>
          <ol className="mt-3 space-y-3 text-xs leading-5 text-muted">
            <li><strong className="text-foreground">1.</strong> Confirm project name and timezone.</li>
            <li><strong className="text-foreground">2.</strong> Build tiers from the lowest useful scope upward.</li>
            <li><strong className="text-foreground">3.</strong> Add nodes and confirm area or typical daily people where available.</li>
            <li><strong className="text-foreground">4.</strong> Validate, review warnings, then publish.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

function StructureEditor(props: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  if (!isTierStructureLocked(props.document)) {
    return (
      <TierSetup
        projectId={props.projectId}
        document={props.document}
        changeDocument={props.changeDocument}
        onLocked={() => props.setSelectedNodeId(null)}
      />
    );
  }
  return <HierarchyBuilder {...props} />;
}

function TierSetup({
  projectId,
  document,
  changeDocument,
  onLocked,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onLocked: () => void;
}) {
  const orderedTiers = useMemo(() => tiersTopDown(document), [document]);
  const aliases = document.tiers.map((tier) => tier.alias.trim().replace(/\s+/g, " ").toLocaleLowerCase());
  const duplicateAliases = new Set(aliases.filter((alias, index) => alias && aliases.indexOf(alias) !== index));
  const canLock = canLockTierStructure(document);
  const hasNodes = document.nodes.length > 0;

  const updateTier = (tierId: string, patch: Partial<EnergyTierDefinitionDto>) => {
    changeDocument((current) => ({
      ...current,
      tiers: current.tiers.map((tier) => tier.id === tierId ? { ...tier, ...patch } : tier),
    }));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Structure · Step 1 of 2</span>
            <h3 className="mt-1 text-base font-semibold">Define the Tier Structure</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Define the lowest meaningful Tier first, then add parent Tiers upward. Confirm the depth before creating real Project nodes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {document.tiers.length > 0 ? (
              <button
                type="button"
                disabled={hasNodes}
                onClick={() => changeDocument(removeHighestTier)}
                className={secondaryButton}
                title={hasNodes ? "Reset the hierarchy before changing Tier depth" : "Remove the highest Tier"}
              >
                Remove top Tier
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => changeDocument((current) => addParentTier(current, projectId))}
              disabled={document.tiers.length >= 7 || hasNodes}
              className={secondaryButton}
              title={hasNodes ? "Reset the hierarchy before changing Tier depth" : undefined}
            >
              {document.tiers.length === 0 ? "+ Add first Tier" : "+ Add parent Tier"}
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h4 className="text-sm font-semibold">Tier definitions</h4>
            <p className="mt-1 text-xs leading-5 text-muted">Aliases are customer-facing. Internal calculations continue to use stable Tier IDs and ordinals.</p>
          </div>
          {orderedTiers.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-subtle text-muted">
                <EnergyIcon name="floor" className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold">Start from the lowest useful scope</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted">Tier 1 is not hard-coded as Circuit. Use the lowest scope this Project needs to analyse, compare, navigate or bind data to.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {orderedTiers.map((tier) => {
                const aliasKey = tier.alias.trim().replace(/\s+/g, " ").toLocaleLowerCase();
                const aliasError = !aliasKey
                  ? "Display name is required."
                  : duplicateAliases.has(aliasKey)
                    ? "Tier display names must be unique."
                    : null;
                return (
                  <div key={tier.id} className="grid gap-3 px-5 py-4 md:grid-cols-[72px_minmax(150px,220px)_minmax(0,1fr)] md:items-start">
                    <span className="pt-2.5 text-[11px] font-semibold text-muted">Tier {tier.ordinal}</span>
                    <div>
                      <input
                        aria-label={`Tier ${tier.ordinal} alias`}
                        value={tier.alias}
                        onChange={(event) => updateTier(tier.id, { alias: event.target.value })}
                        className={`${inputClass} ${aliasError ? "border-step-error" : ""}`}
                      />
                      {aliasError ? <p className="mt-1.5 text-[11px] text-step-error">{aliasError}</p> : null}
                    </div>
                    <div>
                      <input
                        aria-label={`${tier.alias} description`}
                        value={tier.description ?? ""}
                        placeholder="Why this Tier matters"
                        onChange={(event) => updateTier(tier.id, { description: event.target.value })}
                        className={inputClass}
                      />
                      <p className="mt-1.5 text-[10px] leading-4 text-muted">Use analysis, comparison, navigation, permissions, independent attributes or direct meter binding as the reason.</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <LockedTierSummary tiers={orderedTiers} locked={false} />
          {hasNodes ? (
            <section className="rounded-xl border border-step-warning/20 bg-step-warning/5 p-5">
              <h4 className="text-sm font-semibold">Existing hierarchy detected</h4>
              <p className="mt-2 text-xs leading-5 text-muted">Aliases can be corrected safely. To add, remove or reorder Tiers, reset the existing {document.nodes.length} nodes first.</p>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Reset all ${document.nodes.length} hierarchy nodes? This only changes the current Draft.`)) return;
                  changeDocument((current) => ({ ...current, nodes: [] }));
                }}
                className="mt-4 text-xs font-semibold text-step-error hover:underline"
              >
                Reset hierarchy nodes
              </button>
            </section>
          ) : null}
        </aside>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <h4 className="text-sm font-semibold">Ready to build the hierarchy?</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Locking is a Draft checkpoint. Customers will not see these changes until the final Review & Publish stage.</p>
        </div>
        <button
          type="button"
          disabled={!canLock}
          onClick={() => {
            changeDocument((current) => ({ ...current, tier_structure_locked: true }));
            onLocked();
          }}
          className={primaryButton}
        >
          Lock Tier Structure & Continue
        </button>
      </section>
    </div>
  );
}

function HierarchyBuilder({
  projectId,
  document,
  validation,
  selectedNodeId,
  setSelectedNodeId,
  changeDocument,
  onOpenMeterMapping,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  const orderedTiers = useMemo(() => tiersTopDown(document), [document]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(document.nodes.map((node) => node.id)),
  );
  const topTier = orderedTiers[0];
  const selectedNode = document.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedTier = selectedNode
    ? document.tiers.find((tier) => tier.id === selectedNode.tier_definition_id) ?? null
    : null;
  const rootNodes = topTier ? nodesForTierAndParent(document, topTier.id) : [];
  const unassignedNodes = document.nodes.filter((node) => {
    const tier = document.tiers.find((candidate) => candidate.id === node.tier_definition_id);
    if (!tier) return true;
    if (tier.id === topTier?.id) return Boolean(node.parent_id);
    const expectedParentTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal + 1);
    const parent = node.parent_id ? document.nodes.find((candidate) => candidate.id === node.parent_id) : null;
    return !expectedParentTier || !parent || parent.tier_definition_id !== expectedParentTier.id;
  });

  const updateNode = (nodeId: string, patch: Partial<EnergyProjectSetupNodeDto>) => {
    changeDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    }));
  };

  const addScopeNode = (tier: EnergyTierDefinitionDto, parentId?: string) => {
    const result = addNode(document, { projectId, tierId: tier.id, ...(parentId ? { parentId } : {}) });
    changeDocument(() => result.document);
    setSelectedNodeId(parentId ?? result.nodeId);
    setExpandedNodeIds((current) => new Set([...current, ...(parentId ? [parentId] : []), result.nodeId]));
  };

  const toggleHierarchyNode = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Structure · Step 2 of 2</span>
          <h3 className="mt-1 text-base font-semibold">Build the Project hierarchy</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Create real nodes from the top Tier downward. Each branch may contain a different number of child nodes.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (document.nodes.length > 0 && !window.confirm("Return to Tier Setup? Existing nodes stay in the Draft, but Tier depth changes require a hierarchy reset.")) return;
            changeDocument((current) => ({ ...current, tier_structure_locked: false }));
          }}
          className={secondaryButton}
        >
          Edit Tier Structure
        </button>
      </section>

      {topTier ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Hierarchy tree</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                  Expand a branch to inspect its children. A meter shortcut always carries the selected Scope into Data & Meters.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Expand all hierarchy nodes"
                  onClick={() => setExpandedNodeIds(new Set(document.nodes.map((node) => node.id)))}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  aria-label="Collapse all hierarchy nodes"
                  onClick={() => setExpandedNodeIds(new Set())}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  Collapse all
                </button>
              </div>
            </div>

            <div className="max-h-[620px] min-h-80 overflow-auto p-4 sm:p-5">
              <div className="mb-2 flex min-h-11 items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-surface text-muted">
                  <EnergyIcon name="building" className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-light">Project root</span>
                  <span className="block truncate text-xs font-semibold">{document.project.name}</span>
                </span>
                <span className="text-[10px] text-muted">{rootNodes.length} {topTier.alias}</span>
                <button
                  type="button"
                  aria-label={`Add ${topTier.alias} to ${document.project.name}`}
                  title={`Add ${topTier.alias}`}
                  onClick={() => addScopeNode(topTier)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <EnergyIcon name="plus" className="h-4 w-4" />
                </button>
              </div>

              {rootNodes.length ? (
                <ul className="space-y-1" aria-label="Project hierarchy">
                  {rootNodes.map((node) => (
                    <HierarchyTreeNode
                      key={node.id}
                      node={node}
                      document={document}
                      expandedNodeIds={expandedNodeIds}
                      selectedNodeId={selectedNodeId}
                      onToggle={toggleHierarchyNode}
                      onSelect={setSelectedNodeId}
                      onAddChild={addScopeNode}
                      onOpenMeterMapping={onOpenMeterMapping}
                    />
                  ))}
                </ul>
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center text-center">
                  <p className="text-sm font-semibold">No {topTier.alias} nodes yet</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted">Add the first top-level node, then build its branch downward.</p>
                </div>
              )}

              {unassignedNodes.length ? (
                <div className="mt-5 border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-step-warning">Needs parent assignment</h4>
                  <p className="mt-1 text-[11px] leading-5 text-muted">These nodes are missing the immediate parent required by their Tier.</p>
                  <ul className="mt-2 space-y-1">
                    {unassignedNodes.map((node) => (
                      <HierarchyTreeNode
                        key={node.id}
                        node={node}
                        document={document}
                        expandedNodeIds={expandedNodeIds}
                        selectedNodeId={selectedNodeId}
                        onToggle={toggleHierarchyNode}
                        onSelect={setSelectedNodeId}
                        onAddChild={addScopeNode}
                        onOpenMeterMapping={onOpenMeterMapping}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="space-y-5">
            <LockedTierSummary tiers={orderedTiers} locked />
            <section className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Node properties</h3>
                <p className="mt-1 text-xs leading-5 text-muted">Select a tree node to edit its name, parent and comparison attributes.</p>
              </div>
              {selectedNode ? (
                <button
                  type="button"
                  onClick={() => {
                    const count = branchNodeCount(document, selectedNode.id);
                    const message = count === 1
                      ? `Remove ${selectedNode.name} from the current Draft?`
                      : `Remove ${selectedNode.name} and ${count - 1} descendant nodes from the current Draft?`;
                    if (!window.confirm(message)) return;
                    const next = removeNodeAndDescendants(document, selectedNode.id);
                    changeDocument(() => next);
                    const selection = initialTierSelection(next);
                    setSelectedNodeId(tiersTopDown(next).map((tier) => selection[tier.id]).filter(Boolean).at(-1) ?? null);
                  }}
                  className="text-xs font-semibold text-step-error hover:underline"
                >
                  Remove from Draft
                </button>
              ) : null}
            </div>
            {!selectedNode || !selectedTier ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted">Select a node to edit its properties.</div>
            ) : (
              <NodeInspector
                node={selectedNode}
                tier={selectedTier}
                document={document}
                updateNode={updateNode}
              />
            )}
            </section>
          </aside>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Validation</h3>
        <p className="mt-1 text-xs leading-5 text-muted">Drafts may be incomplete. Blocking errors must be resolved before Publish; warnings stay visible for review.</p>
        <ValidationList validation={validation} />
      </section>
    </div>
  );
}

function LockedTierSummary({
  tiers,
  locked,
}: {
  tiers: EnergyTierDefinitionDto[];
  locked: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Tier Structure</h4>
        <span className={[
          "rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wide",
          locked ? "bg-step-success/10 text-step-success" : "bg-step-warning/10 text-step-warning",
        ].join(" ")}>{locked ? "Locked in Draft" : "Draft"}</span>
      </div>
      {tiers.length === 0 ? (
        <p className="mt-4 text-xs text-muted">No Tiers defined yet.</p>
      ) : (
        <ol className="mt-4 space-y-1.5">
          {tiers.map((tier, index) => (
            <li key={tier.id}>
              <div className="flex items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-[9px] font-semibold text-muted">T{tier.ordinal}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{tier.alias || "Unnamed Tier"}</span>
              </div>
              {index < tiers.length - 1 ? <div className="ml-6 h-1.5 border-l border-border" /> : null}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-[10px] leading-4 text-muted">Tier numbers stay internal. Customer pages use these aliases and each node's display name.</p>
    </section>
  );
}

function HierarchyTreeNode({
  node,
  document,
  expandedNodeIds,
  selectedNodeId,
  onToggle,
  onSelect,
  onAddChild,
  onOpenMeterMapping,
}: {
  node: EnergyProjectSetupNodeDto;
  document: EnergyProjectSetupDocumentDto;
  expandedNodeIds: Set<string>;
  selectedNodeId: string | null;
  onToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onAddChild: (tier: EnergyTierDefinitionDto, parentId?: string) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  const expanded = expandedNodeIds.has(node.id);
  const tier = document.tiers.find((candidate) => candidate.id === node.tier_definition_id);
  if (!tier) return null;
  const childTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal - 1);
  const children = childTier ? nodesForTierAndParent(document, childTier.id, node.id) : [];
  const selected = selectedNodeId === node.id;
  const rowClass = [
    "flex min-h-11 w-full items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors",
    selected ? "bg-primary text-white" : "hover:bg-surface-subtle",
  ].join(" ");

  return (
    <li>
      <div className={rowClass}>
        {childTier ? (
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={expanded}
            onClick={() => onToggle(node.id)}
            className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <EnergyIcon name="chevron" className={selected ? `h-3 w-3 text-white/70 transition-transform ${expanded ? "rotate-90" : ""}` : `h-3 w-3 text-muted-light transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : <span className="h-8 w-7 shrink-0" />}

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <EnergyIcon name={tier.ordinal === 1 ? "meter" : "floor"} className={selected ? "h-3.5 w-3.5 shrink-0 text-white/80" : "h-3.5 w-3.5 shrink-0 text-muted"} />
          <span className="min-w-0 flex-1">
            <span className={selected ? "block text-[10px] font-medium text-white/70" : "block text-[10px] font-medium text-muted-light"}>{tier.alias}</span>
            <span className="block truncate text-xs font-semibold">{node.name}</span>
          </span>
          {children.length ? <span className={selected ? "text-[10px] text-white/70" : "text-[10px] text-muted"}>{children.length}</span> : null}
          <span className={[
            "h-1.5 w-1.5 rounded-full",
            node.metadata_status === "confirmed" ? "bg-step-success" : "bg-step-warning",
          ].join(" ")} title={node.metadata_status} />
        </button>

        <NodeAddMenu
          node={node}
          childTier={childTier}
          selected={selected}
          onAddChild={onAddChild}
          onOpenMeterMapping={onOpenMeterMapping}
        />
      </div>

      {childTier && expanded ? (
        <ul className="ml-4 space-y-1 border-l border-border py-1 pl-4">
          {children.map((child) => (
            <HierarchyTreeNode
              key={child.id}
              node={child}
              document={document}
              expandedNodeIds={expandedNodeIds}
              selectedNodeId={selectedNodeId}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onOpenMeterMapping={onOpenMeterMapping}
            />
          ))}
          {children.length === 0 ? (
            <li className="px-2.5 py-2 text-[11px] text-muted">No {childTier.alias} nodes under this {tier.alias}.</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function NodeAddMenu({
  node,
  childTier,
  selected,
  onAddChild,
  onOpenMeterMapping,
}: {
  node: EnergyProjectSetupNodeDto;
  childTier?: EnergyTierDefinitionDto;
  selected: boolean;
  onAddChild: (tier: EnergyTierDefinitionDto, parentId?: string) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  const closeMenu = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
  return (
    <details className="group/add relative shrink-0">
      <summary
        aria-label={`Add to ${node.name}`}
        title={`Add to ${node.name}`}
        className={[
          "flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          selected ? "text-white/80 hover:bg-white/10" : "text-muted hover:bg-surface",
        ].join(" ")}
      >
        <EnergyIcon name="plus" className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-9 z-30 w-56 rounded-xl bg-surface p-1.5 text-foreground shadow-lg">
        {childTier ? (
          <button
            type="button"
            onClick={(event) => {
              onAddChild(childTier, node.id);
              closeMenu(event.currentTarget);
            }}
            className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <span className="block text-xs font-semibold">Add {childTier.alias}</span>
            <span className="mt-0.5 block text-[10px] text-muted">Create the next Tier under {node.name}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            onOpenMeterMapping(node, "physical");
            closeMenu(event.currentTarget);
          }}
          className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <span className="block text-xs font-semibold">Configure meters for {node.name}</span>
          <span className="mt-0.5 block text-[10px] text-muted">Continue with this existing Scope in Data & Meters</span>
        </button>
      </div>
    </details>
  );
}

function NodeInspector({
  node,
  tier,
  document,
  updateNode,
}: {
  node: EnergyProjectSetupNodeDto;
  tier: EnergyTierDefinitionDto;
  document: EnergyProjectSetupDocumentDto;
  updateNode: (nodeId: string, patch: Partial<EnergyProjectSetupNodeDto>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node);
  const parentTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal + 1);
  const parentOptions = parentTier
    ? document.nodes.filter((candidate) => candidate.tier_definition_id === parentTier.id)
    : [];
  const trimmedName = draft.name.trim().replace(/\s+/g, " ");
  const nameConflict = hasSiblingNameConflict(document, {
    tierId: tier.id,
    parentId: draft.parent_id,
    name: trimmedName,
    excludeNodeId: node.id,
  });
  const nameError = !trimmedName
    ? `${tier.alias} name is required.`
    : nameConflict
      ? `${trimmedName} already exists under this parent.`
      : null;

  useEffect(() => {
    setDraft(node);
    setEditing(false);
  }, [node]);

  if (!editing) {
    return (
      <div className="mt-5">
        <dl className="divide-y divide-border rounded-xl bg-surface-subtle px-4">
          <SummaryRow label={`${tier.alias} name`} value={node.name} />
          <SummaryRow label="Metadata" value={node.metadata_status === "confirmed" ? "Confirmed" : "Provisional"} />
          <SummaryRow label="Area" value={node.area_sqm === undefined ? "Not set" : `${node.area_sqm.toLocaleString()} m²`} />
          <SummaryRow label="Typical daily people" value={node.occupant_count === undefined ? "Not set" : String(node.occupant_count)} />
        </dl>
        <button type="button" onClick={() => setEditing(true)} className={`${secondaryButton} mt-4 w-full`}>
          Edit node
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label={`${tier.alias} name`}>
        <input
          value={draft.name}
          aria-invalid={Boolean(nameError)}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          className={`${inputClass} ${nameError ? "border-step-error focus:border-step-error focus:ring-step-error/15" : ""}`}
        />
        {nameError ? <p className="mt-1.5 text-[11px] leading-4 text-step-error">{nameError}</p> : null}
      </Field>
      <ReadOnlyField label="Internal node ID" value={node.id} />
      {parentTier ? (
        <Field label={`Parent ${parentTier.alias}`}>
          <EnergySelect
            ariaLabel={`Parent ${parentTier.alias}`}
            value={draft.parent_id ?? ""}
            options={[
              { value: "", label: "Select parent" },
              ...parentOptions.map((parent) => ({ value: parent.id, label: parent.name })),
            ]}
            onValueChange={(parentId) => {
              const nextParentId = parentId || undefined;
              setDraft((current) => ({ ...current, parent_id: nextParentId }));
            }}
            className="w-full"
          />
        </Field>
      ) : null}
      <Field label="Metadata confidence" hint="Provisional values remain visibly labelled until confirmed.">
        <EnergySelect
          ariaLabel="Metadata confidence"
          value={draft.metadata_status}
          options={[
            { value: "provisional", label: "Provisional" },
            { value: "confirmed", label: "Confirmed" },
          ]}
          onValueChange={(metadataStatus) => setDraft((current) => ({ ...current, metadata_status: metadataStatus as EnergyProjectSetupNodeDto["metadata_status"] }))}
          className="w-full"
        />
      </Field>
      <Field label="Area (m²)" hint="Optional. Used for kWh per m² comparisons.">
        <input type="number" min="0" value={draft.area_sqm ?? ""} onChange={(event) => setDraft((current) => ({ ...current, area_sqm: optionalNumericInput(event.target.value) }))} className={inputClass} />
      </Field>
      <Field label="Typical daily people" hint="A simple 24-hour project estimate for kWh per person.">
        <input type="number" min="0" value={draft.occupant_count ?? ""} onChange={(event) => setDraft((current) => ({ ...current, occupant_count: optionalNumericInput(event.target.value) }))} className={inputClass} />
      </Field>
      <Field label="Effective from" hint="Optional metadata validity window.">
        <input type="date" value={draft.effective_from?.slice(0, 10) ?? ""} onChange={(event) => setDraft((current) => ({ ...current, effective_from: event.target.value || undefined }))} className={inputClass} />
      </Field>
      <Field label="Effective to">
        <input type="date" value={draft.effective_to?.slice(0, 10) ?? ""} onChange={(event) => setDraft((current) => ({ ...current, effective_to: event.target.value || undefined }))} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Independent business meaning" hint="Explain why a single-node tier still needs separate analysis, navigation, permission or data binding.">
          <textarea value={draft.independent_reason ?? ""} onChange={(event) => setDraft((current) => ({ ...current, independent_reason: event.target.value || undefined }))} rows={3} className={inputClass} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={() => {
            setDraft(node);
            setEditing(false);
          }}
          className={secondaryButton}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={Boolean(nameError)}
          onClick={() => {
            if (nameError) return;
            updateNode(node.id, { ...draft, name: trimmedName });
            setEditing(false);
          }}
          className={primaryButton}
        >
          Apply changes
        </button>
      </div>
    </div>
  );
}

function ValidationList({ validation, compact = false }: { validation: EnergyProjectSetupValidationDto | null; compact?: boolean }) {
  if (!validation) return <p className="mt-4 text-xs text-muted">Run validation after saving the draft.</p>;
  if (validation.issues.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-step-success/10 px-3 py-2 text-xs text-step-success">
        <EnergyIcon name="check" className="h-3.5 w-3.5" /> No validation issues
      </div>
    );
  }
  const items = compact ? validation.issues.slice(0, 4) : validation.issues;
  return (
    <div className="mt-4 space-y-2">
      {items.map((issue, index) => (
        <div key={`${issue.code}-${issue.path ?? index}`} className={[
          "rounded-lg border px-3 py-2",
          issue.severity === "error"
            ? "border-step-error/20 bg-step-error/5"
            : "border-step-warning/20 bg-step-warning/5",
        ].join(" ")}>
          <div className="flex items-start gap-2">
            <EnergyIcon name="alert" className={[
              "mt-0.5 h-3.5 w-3.5 shrink-0",
              issue.severity === "error" ? "text-step-error" : "text-step-warning",
            ].join(" ")} />
            <div>
              {/* The issue's own sentence; its code stays out of sight (a code alone would mean nothing to the reader). */}
              <p className="text-xs font-medium" data-issue-code={issue.code}>{issue.message?.trim() || friendlyErrorMessage(issue.code)}</p>
            </div>
          </div>
        </div>
      ))}
      {compact && validation.issues.length > items.length ? (
        <p className="text-[11px] text-muted">+ {validation.issues.length - items.length} more issues in Tiers & nodes</p>
      ) : null}
    </div>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (projectId: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Singapore");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-label="Create project">
      <form
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          void configApi.createEnergyProject({ name, timezone })
            .then((result) => onCreated(result.project.id))
            .catch((reason) => setError(messageFrom(reason, "Failed to create project")))
            .finally(() => setSubmitting(false));
        }}
      >
        <h2 className="text-lg font-semibold">Create project</h2>
        <p className="mt-1 text-xs leading-5 text-muted">Create the stable project scope first. Tiers and nodes remain an unpublished draft until you validate and publish them.</p>
        <div className="mt-5 space-y-4">
          <Field label="Project name"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="e.g. Tampines Preschool Portfolio" /></Field>
          <Field label="Timezone"><EnergySelect ariaLabel="Timezone" value={timezone} options={timezoneOptions} onValueChange={setTimezone} className="w-full" /></Field>
        </div>
        {error ? <p className="mt-4 text-xs text-step-error">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={submitting || !name.trim()} className={primaryButton}>{submitting ? "Creating…" : "Create draft"}</button>
        </div>
      </form>
    </div>
  );
}

function LifecycleBadge({ setup, dirty }: { setup: EnergyProjectSetupDto; dirty: boolean }) {
  const label = dirty ? "Unsaved changes" : setup.project.has_unpublished_changes ? "Not applied yet" : setup.project.delivery_stage;
  const tone = dirty || setup.project.has_unpublished_changes ? "bg-step-warning/10 text-step-warning" : setup.project.status === "published" ? "bg-step-success/10 text-step-success" : "bg-surface-subtle text-muted";
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${tone}`}>{label}</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium">{label}</span>{children}{hint ? <span className="mt-1 block text-[10px] leading-4 text-muted-light">{hint}</span> : null}</label>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <Field label={label}><div className="rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-xs text-muted">{value}</div></Field>;
}

function Fact({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" | "error" }) {
  return <div className="rounded-lg border border-border bg-surface-subtle p-3"><p className="text-[10px] text-muted-light">{label}</p><p className={[
    "mt-1 truncate text-sm font-semibold",
    tone === "error" ? "text-step-error" : tone === "warning" ? "text-step-warning" : "text-foreground",
  ].join(" ")}>{value}</p></div>;
}

function StatusMessage({ tone, children }: { tone: "error" | "warning" | "success"; children: React.ReactNode }) {
  const colors = tone === "error" ? "border-step-error/20 bg-step-error/5 text-step-error" : tone === "warning" ? "border-step-warning/20 bg-step-warning/5 text-step-warning" : "border-step-success/20 bg-step-success/5 text-step-success";
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${colors}`}>{children}</div>;
}

function LoadingPanel() {
  return <div className="flex min-h-96 items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">Loading project setup…</div>;
}

const optionalNumericInput = (value: string): number | undefined => value === "" ? undefined : Number(value);
const normalizeProjectStatus = (value: string): EnergyProjectDto["status"] => value === "published" || value === "archived" ? value : "draft";
// Server codes and request failures become plain sentences; human server text (and our own thrown text) reads as written.
const messageFrom = (reason: unknown, fallback: string): string => friendlyErrorMessage(reason, { fallback });
const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-shadow focus:border-primary/30 focus:ring-2 focus:ring-primary/10";
const resourceOptions = [
  { value: "electricity", label: "Electricity" },
  { value: "water", label: "Water" },
];
const categoryOptions = [
  { value: "overall", label: "Overall" },
  // The same words the site's pages use (MEASUREMENT_LABELS): "load" is plug and power circuits.
  { value: "load", label: "Power (plug loads)" },
  { value: "light", label: "Lighting" },
  { value: "aircon", label: "Air conditioning (A/C, AHU)" },
  { value: "it", label: "IT & network (servers, routers, cameras)" },
  { value: "kitchen", label: "Kitchen & food (fridges, coffee, microwave)" },
  { value: "plug", label: "Plugs & sockets" },
  { value: "other", label: "Other" },
];
const formulaOperatorOptions = [
  { value: "0", label: "Off" },
  { value: "1", label: "+" },
  { value: "-1", label: "−" },
];
const timezoneOptions = [
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
  { value: "Asia/Kuala_Lumpur", label: "Asia/Kuala Lumpur (MYT)" },
  { value: "UTC", label: "UTC" },
];
const overviewCadenceOptions: { value: EnergyOverviewCadenceDto; label: string }[] = [
  { value: "monthly", label: "Monthly report" },
  { value: "weekly", label: "Weekly report" },
];
const secondaryButton ="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40";

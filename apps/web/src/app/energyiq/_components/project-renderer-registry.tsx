import React, { type ReactNode } from "react";

import type {
  EnergySavedAnalysisAiArtifactDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergyProjectAnalysisSnapshotDto,
  EnergyScopeAnalysisDto,
} from "../../../lib/config-api";
import {
  EnergyTemplateRenderer,
  type EnergyTemplateRenderAdvisory,
  type EnergyTemplateRendererState,
} from "./energy-template-renderer";
import type { EnergyTemplateRenderPlan } from "./energy-template-render-plan";
import {
  NgeeAnnOverviewRenderer,
  type NgeeAnnOverviewRendererState,
} from "./ngee-ann-overview-renderer";
import type { NgeeAnnLatestAvailableRange } from "./ngee-ann-overview-view-model";
import type { PreschoolHtmlAiSlotRenderSet } from "./preschool-html-ai-slot-presentation";
import {
  PreschoolOverviewRenderer,
  type PreschoolOverviewRendererState,
} from "./preschool-overview-renderer";
import {
  TuyaOfficeOverviewRenderer,
  type TuyaOfficeOverviewRendererState,
} from "./tuya-office-overview-renderer";

export type ProjectRendererRequest =
  | {
    mode: "customer";
    rendererKey: string | null;
  }
  | {
    mode: "admin-preview";
  };

export type ProjectRendererSelection =
  | {
    status: "ready";
    key: "ngee-ann-overview" | "preschool-overview" | "tuya-office-overview" | "energy-template-overview" | "admin-generic-preview";
    version: "1";
  }
  | {
    status: "configuration-required";
    title: "Project analysis is not configured";
    detail: "Ask an administrator to publish a Project Template Revision with a registered customer Renderer.";
  };

const CUSTOMER_RENDERERS = {
  "ngee-ann-overview": { status: "ready", key: "ngee-ann-overview", version: "1" },
  "preschool-overview": { status: "ready", key: "preschool-overview", version: "1" },
  "tuya-office-overview": { status: "ready", key: "tuya-office-overview", version: "1" },
  "energy-template-overview": { status: "ready", key: "energy-template-overview", version: "1" },
} as const;

const ADMIN_GENERIC_PREVIEW = {
  status: "ready",
  key: "admin-generic-preview",
  version: "1",
} as const;

const CONFIGURATION_REQUIRED = {
  status: "configuration-required",
  title: "Project analysis is not configured",
  detail: "Ask an administrator to publish a Project Template Revision with a registered customer Renderer.",
} as const;

const MINIMUM_DECISION_COVERAGE_PCT = 95;
const QUALITY_GATED_VIEW_KEYS = new Set([
  "executive_action_summary_v1",
  "recommended_actions_v1",
  "exceptions_evidence_v1",
]);

export type ProjectAnalysisQualityPolicy = {
  plan: EnergyTemplateRenderPlan;
  advisories: readonly EnergyTemplateRenderAdvisory[];
  saveAllowed: boolean;
};

export type ProjectRendererState =
  | Exclude<EnergyTemplateRendererState, { status: "ready" }>
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
    plan: EnergyTemplateRenderPlan;
    advisories?: readonly EnergyTemplateRenderAdvisory[];
  };

type ProjectRendererCommonProps = {
  sectionIdPrefix?: string;
  onRetry?: () => void;
  showContextHeader?: boolean;
  aiSlotMode?: "live" | "saved";
  savedAiArtifact?: EnergySavedAnalysisAiArtifactDto;
  onAiArtifactChange?: (artifact: EnergySavedAnalysisAiArtifactInputDto | null) => void;
  aiPresentationMode?: "structured" | "html";
  htmlAiSlots?: PreschoolHtmlAiSlotRenderSet;
};

type CustomerProjectRendererProps = ProjectRendererCommonProps & {
  request: Extract<ProjectRendererRequest, { mode: "customer" }>;
  state: ProjectRendererState;
  onViewLatestAvailableData?: (range: NgeeAnnLatestAvailableRange) => void;
  latestAvailableRange?: NgeeAnnLatestAvailableRange | null;
  grain?: "day" | "hour";
  comparison?: "overlay" | "selected" | "average";
  category?: "all" | "load" | "light";
  onComparisonChange?: (comparison: "overlay" | "selected" | "average") => void;
  onCategoryChange?: (category: "all" | "load" | "light") => void;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
};

type AdminProjectRendererProps = ProjectRendererCommonProps & {
  request: Extract<ProjectRendererRequest, { mode: "admin-preview" }>;
  state: EnergyTemplateRendererState;
};

export type ProjectRendererProps = CustomerProjectRendererProps | AdminProjectRendererProps;

export function applyProjectAnalysisQualityPolicy(input: {
  plan: EnergyTemplateRenderPlan;
  dataQuality: EnergyScopeAnalysisDto["dataHealth"];
}): ProjectAnalysisQualityPolicy {
  if (input.dataQuality.coveragePct >= MINIMUM_DECISION_COVERAGE_PCT) {
    return { plan: input.plan, advisories: [], saveAllowed: true };
  }
  const sections = input.plan.sections
    .map((section) => ({
      ...section,
      modules: section.modules.filter(
        (module) => !QUALITY_GATED_VIEW_KEYS.has(module.component.view_key),
      ),
    }))
    .filter((section) => section.modules.length > 0);
  const moduleCount = sections.reduce((count, section) => count + section.modules.length, 0);
  return {
    plan: {
      ...input.plan,
      sections,
      module_count: moduleCount,
    },
    advisories: [{
      kind: "partial",
      title: "Partial data",
      detail: `Coverage is ${input.dataQuality.coveragePct.toFixed(1)}%. Business exceptions and recommendations are withheld until coverage reaches 95%.`,
    }],
    saveAllowed: false,
  };
}

export function selectProjectRenderer(request: ProjectRendererRequest): ProjectRendererSelection {
  if (request.mode === "admin-preview") return ADMIN_GENERIC_PREVIEW;
  if (request.rendererKey && Object.hasOwn(CUSTOMER_RENDERERS, request.rendererKey)) {
    return CUSTOMER_RENDERERS[request.rendererKey as keyof typeof CUSTOMER_RENDERERS];
  }
  return CONFIGURATION_REQUIRED;
}

export function ProjectRenderer(props: ProjectRendererProps): ReactNode {
  const selection = selectProjectRenderer(props.request);
  if (selection.status === "configuration-required") {
    return (
      <EnergyTemplateRenderer
        state={{
          status: "unsupported",
          title: selection.title,
          detail: selection.detail,
        }}
      />
    );
  }
  if (isAdminProjectRendererProps(props)) {
    return (
      <div data-project-renderer={selection.key} data-renderer-version={selection.version}>
        <EnergyTemplateRenderer
          state={props.state}
          {...(props.sectionIdPrefix ? { sectionIdPrefix: props.sectionIdPrefix } : {})}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
        />
      </div>
    );
  }
  const { state } = props;
  if (selection.key === "ngee-ann-overview") {
    const ngeeAnnState: NgeeAnnOverviewRendererState = state.status === "ready"
      ? { status: "ready", snapshot: state.snapshot }
      : state;
    return (
      <div data-project-renderer={selection.key} data-renderer-version={selection.version}>
        <NgeeAnnOverviewRenderer
          state={ngeeAnnState}
          {...(props.showContextHeader !== undefined ? { showContextHeader: props.showContextHeader } : {})}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
          {...(props.onViewLatestAvailableData ? { onViewLatestAvailableData: props.onViewLatestAvailableData } : {})}
          {...(props.latestAvailableRange ? { latestAvailableRange: props.latestAvailableRange } : {})}
          {...(props.grain ? { grain: props.grain } : {})}
          {...(props.comparison ? { comparison: props.comparison } : {})}
          {...(props.category ? { category: props.category } : {})}
          {...(props.onComparisonChange ? { onComparisonChange: props.onComparisonChange } : {})}
          {...(props.onCategoryChange ? { onCategoryChange: props.onCategoryChange } : {})}
          {...(props.projectExplorerHref ? { projectExplorerHref: props.projectExplorerHref } : {})}
          {...(props.aiAnalystHref ? { aiAnalystHref: props.aiAnalystHref } : {})}
          {...(props.aiSlotMode ? { aiSlotMode: props.aiSlotMode } : {})}
          {...(props.savedAiArtifact ? { savedAiArtifact: props.savedAiArtifact } : {})}
          {...(props.onAiArtifactChange ? { onAiArtifactChange: props.onAiArtifactChange } : {})}
          {...(props.aiPresentationMode ? { aiPresentationMode: props.aiPresentationMode } : {})}
          {...(props.htmlAiSlots ? { htmlAiSlots: props.htmlAiSlots } : {})}
        />
      </div>
    );
  }
  if (selection.key === "preschool-overview") {
    const preschoolState: PreschoolOverviewRendererState = state.status === "ready"
      ? { status: "ready", snapshot: state.snapshot }
      : state;
    return (
      <div data-project-renderer={selection.key} data-renderer-version={selection.version}>
        <PreschoolOverviewRenderer
          state={preschoolState}
          {...(props.showContextHeader !== undefined ? { showContextHeader: props.showContextHeader } : {})}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
          {...(props.projectExplorerHref ? { projectExplorerHref: props.projectExplorerHref } : {})}
          {...(props.aiAnalystHref ? { aiAnalystHref: props.aiAnalystHref } : {})}
          {...(props.aiSlotMode ? { aiSlotMode: props.aiSlotMode } : {})}
          {...(props.savedAiArtifact ? { savedAiArtifact: props.savedAiArtifact } : {})}
          {...(props.onAiArtifactChange ? { onAiArtifactChange: props.onAiArtifactChange } : {})}
          {...(props.aiPresentationMode ? { aiPresentationMode: props.aiPresentationMode } : {})}
          {...(props.htmlAiSlots ? { htmlAiSlots: props.htmlAiSlots } : {})}
        />
      </div>
    );
  }
  if (selection.key === "tuya-office-overview") {
    const tuyaState: TuyaOfficeOverviewRendererState = state.status === "ready"
      ? { status: "ready", snapshot: state.snapshot }
      : state;
    return (
      <div data-project-renderer={selection.key} data-renderer-version={selection.version}>
        <TuyaOfficeOverviewRenderer
          state={tuyaState}
          {...(props.showContextHeader !== undefined ? { showContextHeader: props.showContextHeader } : {})}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
          {...(props.projectExplorerHref ? { projectExplorerHref: props.projectExplorerHref } : {})}
          {...(props.aiAnalystHref ? { aiAnalystHref: props.aiAnalystHref } : {})}
        />
      </div>
    );
  }
  const genericState: EnergyTemplateRendererState = state.status === "ready"
    ? {
      status: "ready",
      analysis: state.snapshot.analysis,
      plan: state.plan,
      ...(state.snapshot.meterDataHealth ? { meterDataHealth: state.snapshot.meterDataHealth } : {}),
      ...(state.advisories?.length ? { advisories: state.advisories } : {}),
    }
    : state;
  return (
    <div data-project-renderer={selection.key} data-renderer-version={selection.version}>
      <EnergyTemplateRenderer
        state={genericState}
        {...(props.sectionIdPrefix ? { sectionIdPrefix: props.sectionIdPrefix } : {})}
        {...(props.onRetry ? { onRetry: props.onRetry } : {})}
      />
    </div>
  );
}

function isAdminProjectRendererProps(
  props: ProjectRendererProps,
): props is AdminProjectRendererProps {
  return props.request.mode === "admin-preview";
}

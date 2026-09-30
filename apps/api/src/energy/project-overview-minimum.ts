import type { MetadataStore } from "@datafoundry/metadata";
import {
  reportTimeBasisFromContext,
  type ReportTimeBasis,
  type ReportTimeContext,
} from "@datafoundry/contracts";

import type { EnergyOverviewHeadlineProjection } from "./energy-analysis.js";
import {
  resolveProjectOverviewProfileForRelease,
  type ProjectAnalysisSnapshot,
  type ProjectAnalysisResolution,
  type ProjectRendererKey,
  type PublishedProjectRelease,
} from "./project-analysis-resolver.js";
import type { EnergyQueryContext } from "./energy-query-context.js";

const CONTRACT = "energyiq-current-overview-minimum@2" as const;

type MinimumHeadlineMetric = {
  id: "centres" | "energy" | "dailyAverage" | "peak" | "comparison" | "cost";
  label: string;
  value: number | null;
  unit: string;
  available: boolean;
};

export type ProjectOverviewMinimum = {
  status: "ready";
  contract: typeof CONTRACT;
  sectionManifest?: ProjectAnalysisSnapshot["sectionManifest"];
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    resource: "electricity";
    currentPin: {
      from: string;
      to: string;
      dataSnapshotId: string;
      projectReleaseId: string;
    };
    primaryReportWindowId: string | null;
    reportTimeBasis: ReportTimeBasis | null;
  };
  presentation: {
    projectName: string;
    title: string;
    renderer: {
      key: ProjectRendererKey;
      version: "1";
      contractVersion: "project-analysis-snapshot@1";
    };
    reportWindow: {
      label: string;
      start: string;
      endExclusive: string;
      timezone: string;
      dataThrough?: string;
    };
    navigation: Array<{
      id: string;
      label: string;
      number: string;
      depth: 0;
    }>;
  };
  headline: {
    dataQuality: Pick<EnergyOverviewHeadlineProjection["dataHealth"],
      | "status"
      | "coveragePct"
      | "expectedMeterIntervalCount"
      | "validIntervalCount"
      | "qualityEventCount"
    >;
    metrics: MinimumHeadlineMetric[];
  };
};

export const projectOverviewMinimumFromMaterializedProjection = (input: {
  metadataStore: MetadataStore;
  resolution: ProjectAnalysisResolution;
}): ProjectOverviewMinimum => {
  if (input.resolution.status !== "ready") {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY");
  }
  const { snapshot } = input.resolution;
  const profile = resolveProjectOverviewProfileForRelease(input.metadataStore, snapshot.projectRelease);
  if (!profile) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_REQUIRED");
  return createProjectOverviewMinimum({
    metadataStore: input.metadataStore,
    context: snapshot.context,
    projectRelease: snapshot.projectRelease,
    profile,
    ...(snapshot.sectionManifest ? { sectionManifest: snapshot.sectionManifest } : {}),
    ...(snapshot.reportTimeContext ? { reportTimeContext: snapshot.reportTimeContext } : {}),
    headline: {
      summary: snapshot.analysis.summary,
      comparison: snapshot.analysis.comparison,
      cost: snapshot.analysis.cost,
      dataHealth: snapshot.analysis.dataHealth,
      immediateChildScopeCount: snapshot.analysis.childScopes.length,
    },
  });
};

const createProjectOverviewMinimum = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  profile: NonNullable<ReturnType<typeof resolveProjectOverviewProfileForRelease>>;
  sectionManifest?: ProjectAnalysisSnapshot["sectionManifest"];
  reportTimeContext?: ReportTimeContext;
  headline: Pick<EnergyOverviewHeadlineProjection, "summary" | "comparison" | "cost" | "dataHealth" | "immediateChildScopeCount">;
}): ProjectOverviewMinimum => {
  const reportTimeBasis = input.reportTimeContext
    ? reportTimeBasisFromContext(input.reportTimeContext)
    : null;
  const primaryReportWindowId = input.reportTimeContext ? input.profile.primaryWindowId : null;
  if (primaryReportWindowId
    && !reportTimeBasis?.windows.some((window) => window.windowId === primaryReportWindowId)) {
    throw new Error("ENERGYIQ_OVERVIEW_PRIMARY_WINDOW_UNSUPPORTED");
  }
  const projectTemplate = input.projectRelease.document.templates
    .find((template) => template.template_id === "project");
  const navigation = (projectTemplate?.sections ?? []).map((section, index) => ({
    id: section.section_id,
    label: section.navigation_label,
    number: String(index + 1),
    depth: 0 as const,
  }));
  const localFrom = localDateAt(input.context.from, input.context.timezone);
  const localTo = localDateAt(
    new Date(Date.parse(input.context.to) - 1).toISOString(),
    input.context.timezone,
  );

  return {
    status: "ready",
    contract: CONTRACT,
    ...(input.sectionManifest ? {
      sectionManifest: {
        ...input.sectionManifest,
        enabledSectionIds: [...input.sectionManifest.enabledSectionIds],
        disabledCapabilities: input.sectionManifest.disabledCapabilities.map((item) => ({ ...item })),
      },
    } : {}),
    binding: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      resource: "electricity",
      currentPin: {
        from: localFrom,
        to: localTo,
        dataSnapshotId: input.context.dataSnapshotId,
        projectReleaseId: input.projectRelease.id,
      },
      primaryReportWindowId,
      reportTimeBasis,
    },
    presentation: {
      projectName: input.context.projectName,
      title: titleForRenderer(input.projectRelease.renderer.key),
      renderer: input.projectRelease.renderer,
      reportWindow: {
        label: reportWindowLabel(input.profile.currentAnalysisWindow),
        start: input.context.from,
        endExclusive: input.context.to,
        timezone: input.context.timezone,
        ...(input.headline.dataHealth.lastSeenAt
          ? { dataThrough: input.headline.dataHealth.lastSeenAt }
          : {}),
      },
      navigation,
    },
    headline: {
      dataQuality: {
        status: input.headline.dataHealth.status,
        coveragePct: input.headline.dataHealth.coveragePct,
        expectedMeterIntervalCount: input.headline.dataHealth.expectedMeterIntervalCount,
        validIntervalCount: input.headline.dataHealth.validIntervalCount,
        qualityEventCount: input.headline.dataHealth.qualityEventCount,
      },
      metrics: metricsForRenderer(input.projectRelease.renderer.key, input.headline),
    },
  };
};

const metricsForRenderer = (
  renderer: ProjectRendererKey,
  projection: Pick<EnergyOverviewHeadlineProjection,
    "summary" | "comparison" | "cost" | "immediateChildScopeCount"
  >,
): MinimumHeadlineMetric[] => {
  const cost = projection.cost.status === "available"
    ? metric("cost", "Estimated cost", projection.cost.amount, projection.cost.currency)
    : metric("cost", "Estimated cost", null, "currency");
  if (renderer === "preschool-overview") {
    return [
      metric("centres", "Centres", projection.immediateChildScopeCount, "centres"),
      metric("energy", "Energy use", projection.summary.usageKwh, "kWh"),
      cost,
    ];
  }
  return [
    metric("energy", "Energy use", projection.summary.usageKwh, "kWh"),
    metric("dailyAverage", "Daily average", projection.summary.averageDailyUsageKwh, "kWh/day"),
    metric("peak", "Peak demand", projection.summary.peakKw, "kW"),
    metric("comparison", "Change vs previous period", projection.comparison.changePct, "%"),
    cost,
  ];
};

const metric = (
  id: MinimumHeadlineMetric["id"],
  label: string,
  value: number | null,
  unit: string,
): MinimumHeadlineMetric => ({ id, label, value, unit, available: value !== null });

const titleForRenderer = (renderer: ProjectRendererKey): string =>
  renderer === "ngee-ann-overview" ? "Energy decision overview" : "Energy overview";

const reportWindowLabel = (
  window: "current-overview-7d" | "current-overview-28d" | "current-month-to-date",
): string => window === "current-month-to-date"
  ? "Calendar month to date"
  : window === "current-overview-28d"
    ? "Recent 28 complete days"
    : "Recent 7 complete days";

const localDateAt = (timestamp: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) throw new Error("ENERGYIQ_OVERVIEW_LOCAL_DATE_INVALID");
  return `${year}-${month}-${day}`;
};

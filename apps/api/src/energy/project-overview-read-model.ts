import type {
  ProjectAnalysisResolution,
  ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";

type AvailableDailyUsageAnomalies = Extract<
  NonNullable<ProjectAnalysisSnapshot["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>;
type DailyUsageAnomalyScope = AvailableDailyUsageAnomalies["scopes"][number];
type DailyUsageAnomalyRow = DailyUsageAnomalyScope["rows"][number];

export type ProjectOverviewDailyUsageAnomalyDetail = {
  contract: "energyiq-daily-usage-anomaly-detail@1";
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    bundleId: string;
    incidentId: string;
  };
  evidencePins: AvailableDailyUsageAnomalies["evidencePins"];
  anomalyScope: Pick<DailyUsageAnomalyScope, "scopeId" | "scopeName" | "scopeType">;
  anomaly: Omit<DailyUsageAnomalyRow, "detailSeries">;
  detailSeries: DailyUsageAnomalyRow["detailSeries"];
};

export const toProjectOverviewReadModel = (
  resolution: ProjectAnalysisResolution,
): ProjectAnalysisResolution => {
  if (resolution.status !== "ready") return resolution;
  const snapshot = projectOverviewSnapshot(resolution.snapshot);
  const dailyUsageAnomalies = snapshot.analysis.dailyUsageAnomalies;
  if (!dailyUsageAnomalies || dailyUsageAnomalies.status !== "available") {
    return { ...resolution, snapshot };
  }
  return {
    ...resolution,
    snapshot: {
      ...snapshot,
      analysis: {
        ...snapshot.analysis,
        dailyUsageAnomalies: {
          ...dailyUsageAnomalies,
          scopes: dailyUsageAnomalies.scopes.map((scope) => ({
            ...scope,
            rows: scope.rows.map((row) => row.outcome === "triggered"
              ? row
              : { ...row, detailSeries: [] }),
          })),
        },
      },
    },
  };
};

const projectOverviewSnapshot = (
  snapshot: ProjectAnalysisSnapshot,
): ProjectAnalysisSnapshot => {
  const withoutInternalReportWindows = snapshot.renderer?.key
    && snapshot.renderer.key !== "ngee-ann-overview"
    ? omitReportWindowAnalyses(snapshot)
    : snapshot;
  const operational = withoutInternalReportWindows.preschoolOperational;
  if (!operational || operational.status !== "available" || !operational.analysisReady) {
    return withoutInternalReportWindows;
  }
  const { analysisReady: _analysisReady, ...publicOperational } = operational;
  return {
    ...withoutInternalReportWindows,
    preschoolOperational: publicOperational,
  };
};

const omitReportWindowAnalyses = (
  snapshot: ProjectAnalysisSnapshot,
): ProjectAnalysisSnapshot => {
  const { reportWindowAnalyses: _reportWindowAnalyses, ...publicSnapshot } = snapshot;
  return publicSnapshot;
};

export const resolveProjectOverviewDailyUsageAnomalyDetail = (
  resolution: ProjectAnalysisResolution,
  input: {
    expectedDataSnapshotId: string;
    expectedProjectReleaseId: string;
    bundleId: string;
    incidentId: string;
  },
): ProjectOverviewDailyUsageAnomalyDetail => {
  if (resolution.status !== "ready") {
    throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_DETAIL_NOT_FOUND");
  }
  const { snapshot } = resolution;
  if (
    input.expectedDataSnapshotId !== snapshot.dataSnapshot.id
    || input.expectedDataSnapshotId !== snapshot.context.dataSnapshotId
  ) {
    throw new Error("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
  }
  if (
    input.expectedProjectReleaseId !== snapshot.projectRelease.id
    || input.expectedProjectReleaseId !== snapshot.context.projectReleaseId
  ) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  if (!bundle || bundle.status !== "available") {
    throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_DETAIL_NOT_FOUND");
  }
  if (
    input.bundleId !== bundle.bundleId
    || bundle.evidencePins.dataSnapshotId !== input.expectedDataSnapshotId
    || bundle.evidencePins.projectReleaseId !== input.expectedProjectReleaseId
  ) {
    throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_DETAIL_NOT_FOUND");
  }
  const matches = bundle.scopes.flatMap((scope) => scope.rows
    .filter((row) => row.incidentId === input.incidentId)
    .map((row) => ({ scope, row })));
  if (matches.length !== 1) {
    throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_DETAIL_NOT_FOUND");
  }
  const match = matches[0];
  if (!match) throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_DETAIL_NOT_FOUND");
  const { scope, row } = match;
  const { detailSeries, ...anomaly } = row;
  return {
    contract: "energyiq-daily-usage-anomaly-detail@1",
    binding: {
      workspaceId: snapshot.context.workspaceId,
      projectId: snapshot.context.projectId,
      scopeId: snapshot.context.scopeId,
      dataSnapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      bundleId: bundle.bundleId,
      incidentId: row.incidentId,
    },
    evidencePins: { ...bundle.evidencePins },
    anomalyScope: {
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
    },
    anomaly,
    detailSeries,
  };
};

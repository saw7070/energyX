import {
  projectAnalysisSnapshotToTrustedText,
  type TrustedEnergyTextIntent,
  type TrustedEnergyTextQueryContract
} from "@datafoundry/agent-runtime";
import type { EnergyScopedDataSource } from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";

import type { ProjectAnalysisSnapshot } from "./energy/project-analysis-resolver.js";

/** Bind an authoritative Snapshot to the exact run-local datasource and released Metric catalog. */
export const compileTrustedEnergyRunContract = (input: {
  intent: TrustedEnergyTextIntent;
  metadataStore: MetadataStore;
  scopedDatasource: EnergyScopedDataSource;
  snapshot: ProjectAnalysisSnapshot;
}): TrustedEnergyTextQueryContract => {
  const metricCatalog = input.metadataStore.energyIq.metrics.listRevisions()
    .filter((metric) => input.snapshot.projectRelease.metricRevisionIds.includes(metric.revision_id))
    .map((metric) => ({
      id: metric.metric_id,
      label: metric.display_name,
      unit: metric.unit,
      revisionId: metric.revision_id
    }));
  return projectAnalysisSnapshotToTrustedText({
    intent: input.intent,
    snapshot: {
      context: {
        projectId: input.snapshot.context.projectId,
        projectName: input.snapshot.context.projectName,
        scopeId: input.snapshot.context.scopeId,
        scopeName: input.snapshot.context.scopeName,
        scopeType: input.snapshot.context.scopeType,
        period: input.snapshot.context.period,
        timezone: input.snapshot.context.timezone,
        primaryPeriod: input.snapshot.context.primaryPeriod,
      },
      projectRelease: {
        metricRevisionIds: input.snapshot.projectRelease.metricRevisionIds,
      },
      dataSnapshot: input.snapshot.dataSnapshot,
      evidence: input.snapshot.evidence.map((item) => ({ id: item.id, metricId: item.metricId })),
      findings: input.snapshot.findings,
      analysis: {
        summary: input.snapshot.analysis.summary,
        comparison: input.snapshot.analysis.comparison,
        categories: input.snapshot.analysis.categories,
        childScopes: input.snapshot.analysis.childScopes,
        topCircuits: input.snapshot.analysis.topCircuits,
        offHours: input.snapshot.analysis.offHours.status === "available"
          ? {
              status: "available",
              usageKwh: input.snapshot.analysis.offHours.usageKwh,
              sharePct: input.snapshot.analysis.offHours.sharePct,
            }
          : {
              status: "unavailable",
              reason: input.snapshot.analysis.offHours.reason.message,
            },
      },
    },
    sourcePin: {
      datasourceId: input.scopedDatasource.datasourceId,
      datasourceRevision: String(input.scopedDatasource.revision),
      physicalSchema: { tables: [{ name: input.scopedDatasource.viewName }] }
    },
    metrics: metricCatalog
  });
};

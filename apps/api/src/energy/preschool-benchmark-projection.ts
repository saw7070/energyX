import type {
  EnergyIqProjectSetupDocument,
  MetadataStore,
} from "@datafoundry/metadata";

import type { ProjectAnalysisPayload } from "./project-analysis-metadata.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";

const PRESCHOOL_PROJECT_ID = "preschool-demo";
const PRESCHOOL_MAY_PERIOD = {
  start: "2026-04-30T16:00:00.000Z",
  endExclusive: "2026-05-31T16:00:00.000Z",
  timezone: "Asia/Singapore",
} as const;
const PRESCHOOL_MINIMUM_COMPLETE_DAYS = 28;

export type PreschoolBenchmarkQuadrant =
  | "priority"
  | "eui-intensive"
  | "people-intensive"
  | "lower-intensity";

export type PreschoolBenchmarkProjection = {
  status: "provisional";
  contract: {
    id: "preschool-may-2026-benchmark";
    version: "1";
    annualisationFactor: number;
  };
  period: {
    start: string;
    endExclusive: string;
    timezone: string;
  };
  sampleSize: number;
  portfolio: {
    eui: PreschoolPercentilePair & { unit: "kWh/m2/year" };
    perPax: PreschoolPercentilePair & { unit: "kWh/person/month" };
  };
  cohorts: Array<{
    name: string;
    sampleSize: number;
    eui: PreschoolPercentilePair & { unit: "kWh/m2/year" };
    perPax: PreschoolPercentilePair & { unit: "kWh/person/month" };
  }>;
  centres: Array<{
    scopeId: string;
    centreCode: string;
    name: string;
    cohort: string;
    usageKwh: number;
    annualisedEuiKwhPerSqmYear: number;
    mayKwhPerPerson: number;
    quadrant: PreschoolBenchmarkQuadrant;
    priority: boolean;
  }>;
  priorityCentreCodes: string[];
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    metricRevisionIds: string[];
    metadataRevisionIds: string[];
    sourceQueryIds: string[];
    projectionRecipeIds: [
      "preschool-eui-benchmark-v1",
      "preschool-per-pax-benchmark-v1",
      "preschool-quadrant-v1",
    ];
    cohortSource: "published-hierarchy-node-metadata";
    metadataStatus: "provisional";
    normalisation: {
      eui: string;
      perPax: string;
    };
  };
};

type PreschoolPercentilePair = {
  p50: number;
  p75: number;
};

type BenchmarkAnalysisInput = {
  childScopes: Array<Pick<ProjectAnalysisPayload["childScopes"][number], "nodeId" | "name" | "usageKwh"> & {
    metadata: Pick<ProjectAnalysisPayload["childScopes"][number]["metadata"], "area" | "headcount">;
  }>;
  provenance: Pick<
    ProjectAnalysisPayload["provenance"],
    "dataSnapshotId" | "hierarchyRevisionId" | "meterMappingRevisionId" | "queryIds"
  >;
};

type PreschoolBenchmarkProjectionInput = {
  metadataStore: MetadataStore;
  projectRelease: PublishedProjectRelease;
  dataSnapshotId: string;
  period: {
    start: string;
    endExclusive: string;
  };
  timezone: string;
  analysis: BenchmarkAnalysisInput;
};

export const buildPreschoolBenchmarkProjection = (
  input: PreschoolBenchmarkProjectionInput,
): PreschoolBenchmarkProjection => {
  assertPublishedMayContract(input);
  const periodDays = periodDayCount(input.period);
  const isPublishedMay = input.period.start === PRESCHOOL_MAY_PERIOD.start
    && input.period.endExclusive === PRESCHOOL_MAY_PERIOD.endExclusive;
  const annualisationFactor = isPublishedMay ? 12 : 365 / periodDays;
  const monthlyNormalisationFactor = isPublishedMay ? 1 : (365 / 12) / periodDays;
  const hierarchy = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(PRESCHOOL_PROJECT_ID)
    .find((revision) => revision.id === input.projectRelease.hierarchyRevisionId);
  if (!hierarchy) throw new Error("PRESCHOOL_BENCHMARK_HIERARCHY_REVISION_REQUIRED");
  const document = JSON.parse(hierarchy.snapshot_json) as EnergyIqProjectSetupDocument;
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));

  const centres = input.analysis.childScopes.map((scope) => {
    const node = nodesById.get(scope.nodeId);
    const centreCode = stringMetadata(node?.metadata, "centreCode");
    const cohort = stringMetadata(node?.metadata, "facilityType");
    const area = availableValue(scope.metadata.area);
    const headcount = availableValue(scope.metadata.headcount);
    if (!node || !centreCode || !cohort || area === null || headcount === null) {
      throw new Error(`PRESCHOOL_BENCHMARK_METADATA_REQUIRED:${scope.nodeId}`);
    }
    return {
      scopeId: scope.nodeId,
      centreCode,
      name: scope.name,
      cohort,
      usageKwh: scope.usageKwh,
      annualisedEuiKwhPerSqmYear: (scope.usageKwh * annualisationFactor) / area,
      mayKwhPerPerson: (scope.usageKwh * monthlyNormalisationFactor) / headcount,
      quadrant: "lower-intensity" as PreschoolBenchmarkQuadrant,
      priority: false,
    };
  });
  if (centres.length !== 30 || new Set(centres.map((centre) => centre.scopeId)).size !== 30) {
    throw new Error(`PRESCHOOL_BENCHMARK_SAMPLE_SIZE_INVALID:${centres.length}`);
  }

  const portfolio = {
    eui: {
      ...percentilePair(centres.map((centre) => centre.annualisedEuiKwhPerSqmYear)),
      unit: "kWh/m2/year" as const,
    },
    perPax: {
      ...percentilePair(centres.map((centre) => centre.mayKwhPerPerson)),
      unit: "kWh/person/month" as const,
    },
  };
  const classifiedCentres = centres.map((centre) => {
    const highEui = centre.annualisedEuiKwhPerSqmYear > portfolio.eui.p75;
    const highPerPax = centre.mayKwhPerPerson > portfolio.perPax.p75;
    const quadrant: PreschoolBenchmarkQuadrant = highEui && highPerPax
      ? "priority"
      : highEui
        ? "eui-intensive"
        : highPerPax
          ? "people-intensive"
          : "lower-intensity";
    return { ...centre, quadrant, priority: quadrant === "priority" };
  });
  const cohortNames = [...new Set(classifiedCentres.map((centre) => centre.cohort))]
    .sort((left, right) => left.localeCompare(right));
  const metadataRevisionIds = [...new Set(input.analysis.childScopes.flatMap((scope) => [
    ...scope.metadata.area.metadataRevisionIds,
    ...scope.metadata.headcount.metadataRevisionIds,
  ]))].sort((left, right) => left.localeCompare(right));

  return {
    status: "provisional",
    contract: {
      id: "preschool-may-2026-benchmark",
      version: "1",
      annualisationFactor,
    },
    period: {
      start: input.period.start,
      endExclusive: input.period.endExclusive,
      timezone: input.timezone,
    },
    sampleSize: classifiedCentres.length,
    portfolio,
    cohorts: cohortNames.map((name) => {
      const members = classifiedCentres.filter((centre) => centre.cohort === name);
      return {
        name,
        sampleSize: members.length,
        eui: {
          ...percentilePair(members.map((centre) => centre.annualisedEuiKwhPerSqmYear)),
          unit: "kWh/m2/year" as const,
        },
        perPax: {
          ...percentilePair(members.map((centre) => centre.mayKwhPerPerson)),
          unit: "kWh/person/month" as const,
        },
      };
    }),
    centres: classifiedCentres,
    priorityCentreCodes: classifiedCentres
      .filter((centre) => centre.priority)
      .sort((left, right) => priorityScore(right, portfolio) - priorityScore(left, portfolio)
        || left.centreCode.localeCompare(right.centreCode))
      .map((centre) => centre.centreCode),
    evidence: {
      projectReleaseId: input.projectRelease.id,
      dataSnapshotId: input.dataSnapshotId,
      hierarchyRevisionId: input.projectRelease.hierarchyRevisionId,
      meterMappingRevisionId: input.projectRelease.meterMappingRevisionId,
      metricRevisionIds: [...input.projectRelease.metricRevisionIds].sort((left, right) => left.localeCompare(right)),
      metadataRevisionIds,
      sourceQueryIds: [...input.analysis.provenance.queryIds],
      projectionRecipeIds: [
        "preschool-eui-benchmark-v1",
        "preschool-per-pax-benchmark-v1",
        "preschool-quadrant-v1",
      ],
      cohortSource: "published-hierarchy-node-metadata",
      metadataStatus: "provisional",
      normalisation: {
        eui: isPublishedMay
          ? "May usage kWh * 12 / published comparison area m2"
          : `Current ${periodDays}-day usage normalised to 365 days / published comparison area m2`,
        perPax: isPublishedMay
          ? "May usage kWh / published representative headcount"
          : `Current ${periodDays}-day usage normalised to an average month / published representative headcount`,
      },
    },
  };
};

export const resolvePreschoolBenchmarkProjection = (
  input: PreschoolBenchmarkProjectionInput,
): PreschoolBenchmarkProjection | undefined => {
  try {
    return buildPreschoolBenchmarkProjection(input);
  } catch (error) {
    if (isUnavailableBenchmarkProjection(error)) return undefined;
    throw error;
  }
};

export const hasCompletePreschoolBenchmarkWindow = (
  analysis: Pick<ProjectAnalysisPayload, "dailyTotals">,
  projectScopeId: string,
): boolean => {
  const dailyTotals = analysis.dailyTotals;
  if (!dailyTotals || dailyTotals.timezone !== PRESCHOOL_MAY_PERIOD.timezone) return false;
  const projectScope = dailyTotals.scopes.find((scope) => scope.scopeId === projectScopeId);
  if (!projectScope) return false;
  const completeDates = new Set(projectScope.rows
    .filter((row) => row.dataHealth.status === "complete")
    .map((row) => row.localDate));
  return completeDates.size >= PRESCHOOL_MINIMUM_COMPLETE_DAYS;
};

const priorityScore = (
  centre: { annualisedEuiKwhPerSqmYear: number; mayKwhPerPerson: number },
  portfolio: PreschoolBenchmarkProjection["portfolio"],
): number => centre.annualisedEuiKwhPerSqmYear / portfolio.eui.p75
  + centre.mayKwhPerPerson / portfolio.perPax.p75;

const assertPublishedMayContract = (input: {
  projectRelease: PublishedProjectRelease;
  dataSnapshotId: string;
  period: { start: string; endExclusive: string };
  timezone: string;
  analysis: BenchmarkAnalysisInput;
}): void => {
  if (input.projectRelease.projectId !== PRESCHOOL_PROJECT_ID) {
    throw new Error("PRESCHOOL_BENCHMARK_PROJECT_MISMATCH");
  }
  if (input.dataSnapshotId !== input.analysis.provenance.dataSnapshotId) {
    throw new Error("PRESCHOOL_BENCHMARK_SNAPSHOT_MISMATCH");
  }
  if (input.projectRelease.hierarchyRevisionId !== input.analysis.provenance.hierarchyRevisionId) {
    throw new Error("PRESCHOOL_BENCHMARK_HIERARCHY_MISMATCH");
  }
  if (input.projectRelease.meterMappingRevisionId !== input.analysis.provenance.meterMappingRevisionId) {
    throw new Error("PRESCHOOL_BENCHMARK_MAPPING_MISMATCH");
  }
  if (input.timezone !== PRESCHOOL_MAY_PERIOD.timezone
    || periodDayCount(input.period) < PRESCHOOL_MINIMUM_COMPLETE_DAYS
    || periodDayCount(input.period) > 31) {
    throw new Error("PRESCHOOL_BENCHMARK_PERIOD_UNSUPPORTED");
  }
};

const periodDayCount = (period: { start: string; endExclusive: string }): number => {
  const days = (Date.parse(period.endExclusive) - Date.parse(period.start)) / 86_400_000;
  if (!Number.isInteger(days) || days <= 0) throw new Error("PRESCHOOL_BENCHMARK_PERIOD_UNSUPPORTED");
  return days;
};

const percentilePair = (values: number[]): PreschoolPercentilePair => ({
  p50: percentileCont(values, 0.5),
  p75: percentileCont(values, 0.75),
});

const percentileCont = (values: number[], percentile: number): number => {
  if (values.length === 0) throw new Error("PRESCHOOL_BENCHMARK_EMPTY_SAMPLE");
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("PRESCHOOL_BENCHMARK_NON_FINITE_VALUE");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error("PRESCHOOL_BENCHMARK_PERCENTILE_INVALID");
  return lower + (upper - lower) * (index - lowerIndex);
};

const availableValue = (value: { status: string; value: number | null }): number | null =>
  value.status !== "missing" && typeof value.value === "number" && Number.isFinite(value.value) && value.value > 0
    ? value.value
    : null;

const stringMetadata = (metadata: Record<string, unknown> | undefined, key: string): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const isUnavailableBenchmarkProjection = (error: unknown): boolean => error instanceof Error
  && (error.message === "PRESCHOOL_BENCHMARK_PERIOD_UNSUPPORTED"
    || error.message.startsWith("PRESCHOOL_BENCHMARK_METADATA_REQUIRED:")
    || error.message.startsWith("PRESCHOOL_BENCHMARK_SAMPLE_SIZE_INVALID:"));

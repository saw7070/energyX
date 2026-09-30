import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

export type NgeeAnnDiscoveryEvidenceKind =
  | "horizon"
  | "level"
  | "category"
  | "circuit"
  | "daily"
  | "time"
  | "peak"
  | "operating"
  | "quality"
  | "limitation";

export type NgeeAnnDiscoveryEvidenceValue = string | number | boolean | null;

export type NgeeAnnDiscoveryEvidenceItem = {
  id: string;
  kind: NgeeAnnDiscoveryEvidenceKind;
  label: string;
  period: "primary" | { from: string; to: string } | null;
  unit: "kWh" | "kW" | null;
  values: Record<string, NgeeAnnDiscoveryEvidenceValue>;
  quality: {
    coveragePct: number;
    validIntervalCount: number;
    expectedMeterIntervalCount: number;
    qualityEventCount: number;
  } | null;
  queryIds: string[];
  limitation: string | null;
};

export type NgeeAnnDiscoveryEvidenceBundleV1 = {
  identity: {
    snapshotId: string;
    dataCutoff: string;
    projectReleaseId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    businessCalendarVersion: string;
    timezone: string;
    primaryPeriod: { from: string; to: string };
  };
  items: NgeeAnnDiscoveryEvidenceItem[];
};

export type NgeeAnnDiscoveryHorizon = {
  horizon: "1d" | "7d" | "28d";
  period: { fromLocalDate: string; toLocalDate: string };
  actualKwh: number;
  baselineKwh: number;
  deltaKwh: number;
  relativePct: number;
};

const MAX_ITEMS = 20;
const MAX_SERIALIZED_CHARS = 6_000;

export function buildNgeeAnnDiscoveryEvidenceBundle(input: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  horizons: readonly NgeeAnnDiscoveryHorizon[];
  dataCutoff: string;
}): NgeeAnnDiscoveryEvidenceBundleV1 {
  const { snapshot } = input;
  const { analysis, context } = snapshot;
  const primaryPeriod = { from: context.primaryPeriod.start, to: context.primaryPeriod.endExclusive };
  const items: NgeeAnnDiscoveryEvidenceItem[] = input.horizons.map((horizon) => ({
    id: `horizon:${horizon.horizon}`,
    kind: "horizon",
    label: `Overall ${horizon.horizon} usage versus its governed baseline`,
    period: { from: horizon.period.fromLocalDate, to: horizon.period.toLocalDate },
    unit: "kWh",
    values: {
      horizon: horizon.horizon,
      actualKwh: horizon.actualKwh,
      baselineKwh: horizon.baselineKwh,
      deltaKwh: horizon.deltaKwh,
      relativePct: horizon.relativePct,
    },
    quality: null,
    queryIds: ["time_slot_anomaly_v1"],
    limitation: "Overall Horizon only; no Category or Circuit cross-Horizon delta.",
  }));

  items.push(...topByAbsoluteChange(
    analysis.childScopes.filter((scope) => scope.nodeType === "level" && scope.comparison && scope.dataHealth),
    1,
    (scope) => scope.nodeId,
  ).map((scope) => ({
    id: `level:${scope.nodeId}`,
    kind: "level" as const,
    label: scope.name,
    period: "primary" as const,
    unit: "kWh" as const,
    values: {
      usageKwh: scope.usageKwh,
      sharePct: scope.sharePct,
      previousUsageKwh: scope.comparison!.usageKwh,
      changeKwh: scope.comparison!.changeKwh,
      changePct: scope.comparison!.changePct,
      comparisonKind: "previous-primary-period",
    },
    quality: scope.dataHealth!,
    queryIds: ["scope_summary_v1", "previous_meter_usage_v1"],
    limitation: "Primary Period comparison only.",
  })));

  items.push(...topByAbsoluteChange(analysis.categories.filter(hasComparisonAndHealth), 1, (category) => category.category)
    .map((category) => ({
      id: `category:${category.category}`,
      kind: "category" as const,
      label: category.category,
      period: "primary" as const,
      unit: "kWh" as const,
      values: {
        usageKwh: category.usageKwh,
        sharePct: category.sharePct,
        previousUsageKwh: category.comparison!.usageKwh,
        changeKwh: category.comparison!.changeKwh,
        changePct: category.comparison!.changePct,
        comparisonKind: "previous-primary-period",
      },
      quality: category.dataHealth!,
      queryIds: ["meter_breakdown_v1", "previous_meter_usage_v1"],
      limitation: "Primary Period comparison only.",
    })));

  items.push(...topByAbsoluteChange(
    analysis.circuits.filter((circuit) => circuit.includedInOfficialTotal === false && circuit.comparison && circuit.dataHealth),
    1,
    (circuit) => circuit.meterNodeId,
  ).map((circuit) => ({
    id: `circuit:${circuit.meterNodeId}`,
    kind: "circuit" as const,
    label: circuit.name,
    period: "primary" as const,
    unit: "kWh" as const,
    values: {
      parentScopeId: circuit.parentScopeId ?? null,
      category: circuit.category,
      usageKwh: circuit.usageKwh,
      sharePct: circuit.sharePct,
      previousUsageKwh: circuit.comparison!.usageKwh,
      changeKwh: circuit.comparison!.changeKwh,
      changePct: circuit.comparison!.changePct,
      peakKw: circuit.peakKw,
      comparisonKind: "previous-primary-period",
    },
    quality: circuit.dataHealth!,
    queryIds: ["meter_breakdown_v1", "previous_meter_usage_v1"],
    limitation: "Component Evidence; do not add to designated totals.",
  })));

  const anomalies = analysis.dailyUsageAnomalies;
  if (anomalies?.status === "available") {
    const topAnomaly = anomalies.scopes
      .flatMap((scope) => scope.rows.map((row) => ({ scope, row })))
      .filter(({ row }) => row.outcome === "triggered" && row.impactKwh !== null)
      .toSorted((left, right) => Math.abs(right.row.impactKwh!) - Math.abs(left.row.impactKwh!)
        || left.row.incidentId.localeCompare(right.row.incidentId))[0];
    if (topAnomaly) {
      items.push({
        id: `daily:${topAnomaly.row.incidentId}`,
        kind: "daily",
        label: `${topAnomaly.scope.scopeName} ${topAnomaly.row.localDate}`,
        period: { from: topAnomaly.row.from, to: topAnomaly.row.to },
        unit: "kWh",
        values: {
          scopeId: topAnomaly.scope.scopeId,
          dayType: topAnomaly.row.dayType,
          actualKwh: topAnomaly.row.actualKwh,
          baselineKwh: topAnomaly.row.baselineKwh,
          impactKwh: topAnomaly.row.impactKwh,
          relativePct: topAnomaly.row.relativePct,
        },
        quality: qualityFromAnomaly(topAnomaly.row),
        queryIds: ["time_slot_anomaly_v1"],
        limitation: "Rule-triggered pattern, not a confirmed cause.",
      });
    }
  }

  const timeBehaviour = analysis.timeBehaviour;
  if (timeBehaviour) {
    const profiles = timeBehaviour.dayProfiles
      .filter((profile): profile is Extract<
        (typeof timeBehaviour.dayProfiles)[number],
        { status: "available" }
      > => profile.status === "available" && profile.scopeId === context.scopeId)
      .slice(0, 1);
    for (const profile of profiles) {
      const peak = profile.values.reduce((best, candidate) => candidate.usageKwh > best.usageKwh ? candidate : best);
      items.push({
        id: `time:${profile.scopeId}:${profile.dayType}`,
        kind: "time",
        label: `${profile.dayType} ${profile.scopeName} day profile`,
        period: "primary" as const,
        unit: "kWh",
        values: {
          dayType: profile.dayType,
          sampleDayCount: profile.sampleDayCount,
          peakLocalHour: peak.localHour,
          peakUsageKwh: peak.usageKwh,
        },
        quality: null,
        queryIds: ["time_bucket_grid_v1"],
        limitation: "Typical profile; equipment state and occupancy unknown.",
      });
    }
  }

  const peak = analysis.peakBreakdown;
  if (peak?.status === "available") {
    const leadingLevel = peak.levels.toSorted((left, right) => right.averageKw - left.averageKw)[0];
    const leadingCircuit = peak.levels.flatMap((level) => level.circuits)
      .filter((circuit) => circuit.averageKw !== null)
      .toSorted((left, right) => right.averageKw! - left.averageKw!)[0];
    items.push({
      id: "peak:project",
      kind: "peak",
      label: "Project peak interval-average power",
      period: { from: peak.peak.from, to: peak.peak.to },
      unit: "kW",
      values: {
        averageKw: peak.peak.averageKw,
        leadingLevel: leadingLevel?.scopeName ?? null,
        leadingLevelAverageKw: leadingLevel?.averageKw ?? null,
        leadingLevelSharePct: leadingLevel?.sharePct ?? null,
        leadingCircuit: leadingCircuit?.name ?? null,
        leadingCircuitAverageKw: leadingCircuit?.averageKw ?? null,
        leadingCircuitSharePct: leadingCircuit?.sharePct ?? null,
      },
      quality: qualityFromPeak(peak.peak.dataHealth),
      queryIds: ["peak_breakdown_v1"],
      limitation: "Interval-average power; root cause unknown.",
    });
  }

  if (analysis.offHours.status === "available") {
    items.push({
      id: "operating:project",
      kind: "operating",
      label: "Operating versus non-operating energy",
      period: "primary" as const,
      unit: "kWh",
      values: {
        operatingKwh: analysis.offHours.operatingKwh,
        nonOperatingKwh: analysis.offHours.standbyKwh,
        usageKwh: analysis.offHours.usageKwh,
        nonOperatingSharePct: analysis.offHours.sharePct,
        businessCalendarVersion: analysis.offHours.businessCalendarVersion,
      },
      quality: null,
      queryIds: ["operational_policy_scope_intervals_v1"],
      limitation: "Calendar-classified energy; operational cause unknown.",
    });
  }

  items.push({
    id: "quality:primary-period",
    kind: "quality",
    label: "Primary Period data quality",
    period: "primary" as const,
    unit: null,
    values: { status: analysis.dataHealth.status },
    quality: qualityFromAnomaly(analysis.dataHealth),
    queryIds: ["scope_summary_v1"],
    limitation: "Primary Period quality only.",
  }, {
    id: "limitation:external-operational-evidence",
    kind: "limitation",
    label: "External operational evidence is not present",
    period: null,
    unit: null,
    values: {
      evidenceStatus: "Missing Evidence",
      missing: "equipment state, occupancy, weather, maintenance, savings, ROI, owner, commitment",
    },
    quality: null,
    queryIds: [],
    limitation: "Use Hypothesis or Missing Evidence for causes.",
  });

  const bundle: NgeeAnnDiscoveryEvidenceBundleV1 = {
    identity: {
      snapshotId: snapshot.dataSnapshot.id,
      dataCutoff: input.dataCutoff,
      projectReleaseId: snapshot.projectRelease.id,
      hierarchyRevisionId: context.hierarchyRevisionId,
      meterMappingRevisionId: context.meterMappingRevisionId,
      meterFormulaRevisionId: context.meterFormulaRevisionId,
      metricVersion: context.metricVersion,
      businessCalendarVersion: context.businessCalendarVersion,
      timezone: context.timezone,
      primaryPeriod,
    },
    items: items.slice(0, MAX_ITEMS),
  };
  while (JSON.stringify(bundle).length > MAX_SERIALIZED_CHARS && bundle.items.length > input.horizons.length + 2) {
    const removableIndex = bundle.items.findLastIndex((item) => item.kind !== "horizon"
      && item.kind !== "quality" && item.kind !== "limitation");
    if (removableIndex < 0) break;
    bundle.items.splice(removableIndex, 1);
  }
  return bundle;
}

function topByAbsoluteChange<T extends { comparison?: { changeKwh: number } }>(
  values: T[],
  limit: number,
  identity: (value: T) => string,
): T[] {
  return values.toSorted((left, right) => Math.abs(right.comparison!.changeKwh) - Math.abs(left.comparison!.changeKwh)
    || identity(left).localeCompare(identity(right))).slice(0, limit);
}

function hasComparisonAndHealth<T extends { comparison?: unknown; dataHealth?: unknown }>(
  value: T,
): value is T & { comparison: NonNullable<T["comparison"]>; dataHealth: NonNullable<T["dataHealth"]> } {
  return Boolean(value.comparison && value.dataHealth);
}

function qualityFromAnomaly(row: {
  coveragePct: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  qualityEventCount: number;
}): NonNullable<NgeeAnnDiscoveryEvidenceItem["quality"]> {
  return {
    coveragePct: row.coveragePct,
    validIntervalCount: row.validIntervalCount,
    expectedMeterIntervalCount: row.expectedMeterIntervalCount,
    qualityEventCount: row.qualityEventCount,
  };
}

function qualityFromPeak(quality: {
  coveragePct: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  qualityEventCount: number;
}): NonNullable<NgeeAnnDiscoveryEvidenceItem["quality"]> {
  return {
    coveragePct: quality.coveragePct,
    validIntervalCount: quality.validIntervalCount,
    expectedMeterIntervalCount: quality.expectedMeterIntervalCount,
    qualityEventCount: quality.qualityEventCount,
  };
}

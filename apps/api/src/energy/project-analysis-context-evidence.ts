import type {
  AnalysisContextEvidenceCatalog,
  AnalysisContextEvidenceFact,
} from "@datafoundry/agent-runtime";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

/**
 * Project released scalar facts without recalculating any metric. The Snapshot
 * remains the only calculation owner; this catalog only gives the Analyst a
 * small typed interface for binding those existing values as Evidence.
 */
export const createProjectAnalysisContextEvidenceCatalog = (
  snapshot: ProjectAnalysisSnapshot,
): AnalysisContextEvidenceCatalog => {
  const evidenceRefs = snapshot.evidence.map((item) => item.id);
  const facts: AnalysisContextEvidenceFact[] = [];
  if (evidenceRefs.length > 0 && snapshot.dataQuality.status !== "unavailable") {
    addCoreFacts(facts, snapshot, evidenceRefs);
    addCategoryFacts(facts, snapshot, evidenceRefs);
    addChildScopeFacts(facts, snapshot, evidenceRefs);
    addTopCircuitFacts(facts, snapshot, evidenceRefs);
    addHourlyProfileFacts(facts, snapshot, evidenceRefs);
    addOffHoursFacts(facts, snapshot, evidenceRefs);
    addPreschoolOperationalSpikeFacts(facts, snapshot, evidenceRefs);
    addPreschoolBenchmarkFacts(facts, snapshot, evidenceRefs);
    addPreschoolDecisionSignalFacts(facts, snapshot, evidenceRefs);
  }
  return {
    contract: "analysis-context-evidence@1",
    sourceId: `project-analysis-snapshot:${snapshot.context.projectId}:${snapshot.dataSnapshot.id}`,
    pins: {
      workspaceId: snapshot.context.workspaceId,
      projectId: snapshot.context.projectId,
      scopeId: snapshot.context.scopeId,
      dataSnapshotId: snapshot.dataSnapshot.id,
      dataCutoff: snapshot.context.primaryPeriod.endExclusive,
      projectReleaseId: snapshot.context.projectReleaseId,
      metricVersion: snapshot.context.metricVersion,
    },
    facts,
  };
};

const addHourlyProfileFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const status = factStatus(snapshot);
  for (const row of snapshot.analysis.hourlyProfile ?? []) {
    const hour = String(row.hour).padStart(2, "0");
    const dimensions = {
      localHour: String(row.hour),
      timezone: snapshot.context.timezone,
      observationCount: String(row.observationCount),
      aggregation: "hour-of-day",
    };
    pushNumber(target, {
      id: `analysis.hourly_profile.${hour}.usage_kwh`,
      label: `${hour}:00-${hour}:59 energy use across the selected period`,
      metricId: "energy.hourly_usage_kwh",
      value: row.usageKwh,
      unit: "kWh",
      status,
      evidenceRefs,
      dimensions,
    });
    pushNumber(target, {
      id: `analysis.hourly_profile.${hour}.peak_kw`,
      label: `${hour}:00-${hour}:59 peak interval-average power`,
      metricId: "energy.hourly_peak_kw",
      value: row.peakKw,
      unit: "kW",
      status,
      evidenceRefs,
      dimensions,
    });
  }
};

const addPreschoolOperationalSpikeFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const projection = snapshot.preschoolOperational;
  if (
    !projection
    || projection.status !== "available"
    || !projection.evidence
    || projection.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
    || projection.evidence.projectReleaseId !== snapshot.context.projectReleaseId
  ) return;

  const status = factStatus(snapshot);
  const standby = projection.spikes.standby;
  const dimensions = { operatingState: "standby" };
  pushNumber(target, {
    id: "preschool.operational.closed_hour_spikes.count",
    label: "Published closed-hour anomaly count",
    metricId: "preschool.operational.closed_hour_spike_count",
    value: standby.count,
    status,
    evidenceRefs,
    dimensions,
  });
  pushNumber(target, {
    id: "preschool.operational.closed_hour_spikes.centre_count",
    label: "Centres with a published closed-hour anomaly",
    metricId: "preschool.operational.closed_hour_spike_centre_count",
    value: standby.centreCount,
    status,
    evidenceRefs,
    dimensions,
  });

  for (const centre of [...standby.centres]
    .sort((left, right) => right.worstSpike.impactKwh - left.worstSpike.impactKwh)
    .slice(0, 3)) {
    const spike = centre.worstSpike;
    const prefix = `preschool.operational.closed_hour_spikes.${factSegment(centre.scopeId)}.top`;
    const spikeDimensions = {
      centreCode: centre.centreCode,
      centreName: centre.name,
      leadingCircuitName: spike.leadingCircuitName,
      localDate: spike.localDate,
      localHour: String(spike.localHour),
      operatingState: "standby",
      scopeId: centre.scopeId,
    };
    target.push({
      id: `${prefix}.at`,
      label: `${centre.name} largest published closed-hour anomaly time`,
      metricId: "preschool.operational.closed_hour_spike_at",
      value: `${spike.localDate} ${String(spike.localHour).padStart(2, "0")}:00`,
      status,
      evidenceRefs: [...evidenceRefs],
      dimensions: spikeDimensions,
    });
    for (const [suffix, label, metricId, value, unit] of [
      ["usage_kwh", "energy use", "preschool.operational.closed_hour_spike_usage_kwh", spike.usageKwh, "kWh"],
      ["baseline_kwh", "same-hour baseline", "preschool.operational.closed_hour_spike_baseline_kwh", spike.baselineKwh, "kWh"],
      ["impact_kwh", "impact above baseline", "preschool.operational.closed_hour_spike_impact_kwh", spike.impactKwh, "kWh"],
      ["variance_pct", "variance from baseline", "preschool.operational.closed_hour_spike_variance_pct", spike.variancePct, "%"],
    ] as const) {
      pushNumber(target, {
        id: `${prefix}.${suffix}`,
        label: `${centre.name} largest published closed-hour anomaly ${label}`,
        metricId,
        value,
        unit,
        status,
        evidenceRefs,
        dimensions: spikeDimensions,
      });
    }
  }
};

const addCategoryFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const status = factStatus(snapshot);
  for (const category of snapshot.analysis.categories) {
    const prefix = `analysis.categories.${factSegment(category.category)}`;
    const dimensions = { category: category.category };
    pushNumber(target, {
      id: `${prefix}.usage_kwh`,
      label: `${category.category} energy use`,
      metricId: "energy.category_usage_kwh",
      value: category.usageKwh,
      unit: "kWh",
      status,
      evidenceRefs,
      dimensions,
    });
    pushNumber(target, {
      id: `${prefix}.share_pct`,
      label: `${category.category} share of selected Scope energy`,
      metricId: "energy.category_share_pct",
      value: category.sharePct,
      unit: "%",
      status,
      evidenceRefs,
      dimensions,
    });
  }
};

const addCoreFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const status = factStatus(snapshot, snapshot.metadata.selectedScope.status);
  pushNumber(target, {
    id: "analysis.summary.usage_kwh",
    label: "Selected Scope energy use",
    metricId: "energy.total_usage_kwh",
    value: snapshot.analysis.summary.usageKwh,
    unit: "kWh",
    status,
    evidenceRefs,
    dimensions: { scopeId: snapshot.context.scopeId, scopeName: snapshot.context.scopeName },
  });
  pushNumber(target, {
    id: "analysis.summary.peak_kw",
    label: "Selected Scope peak interval-average power",
    metricId: "energy.peak_interval_average_kw",
    value: snapshot.analysis.summary.peakKw,
    unit: "kW",
    status,
    evidenceRefs,
    dimensions: { scopeId: snapshot.context.scopeId, scopeName: snapshot.context.scopeName },
  });
  pushOptionalNumber(target, snapshot.analysis.summary.kwhPerSqm, {
    id: "analysis.summary.kwh_per_sqm",
    label: "Selected Scope energy use per square metre",
    metricId: "energy.kwh_per_sqm",
    unit: "kWh/m2",
    status,
    evidenceRefs,
    dimensions: { scopeId: snapshot.context.scopeId, scopeName: snapshot.context.scopeName },
  });
  pushOptionalNumber(target, snapshot.analysis.summary.kwhPerPerson, {
    id: "analysis.summary.kwh_per_person",
    label: "Selected Scope energy use per person",
    metricId: "energy.kwh_per_person",
    unit: "kWh/person",
    status,
    evidenceRefs,
    dimensions: { scopeId: snapshot.context.scopeId, scopeName: snapshot.context.scopeName },
  });
  pushNumber(target, {
    id: "analysis.comparison.previous_usage_kwh",
    label: "Previous comparison period energy use",
    metricId: "energy.total_usage_kwh",
    value: snapshot.analysis.comparison.usageKwh,
    unit: "kWh",
    status,
    evidenceRefs,
    dimensions: {
      comparison: "previous-period",
      comparedMetricId: "energy.total_usage_kwh",
      scopeId: snapshot.context.scopeId,
      scopeName: snapshot.context.scopeName,
    },
  });
  pushNumber(target, {
    id: "analysis.comparison.change_kwh",
    label: "Energy change from previous comparison period",
    metricId: "energy.period_change_kwh",
    value: snapshot.analysis.comparison.changeKwh,
    unit: "kWh",
    status,
    evidenceRefs,
    dimensions: {
      comparison: "previous-period",
      comparedMetricId: "energy.total_usage_kwh",
      scopeId: snapshot.context.scopeId,
      scopeName: snapshot.context.scopeName,
    },
  });
  pushOptionalNumber(target, snapshot.analysis.comparison.changePct, {
    id: "analysis.comparison.change_pct",
    label: "Energy percentage change from previous comparison period",
    metricId: "energy.period_change_pct",
    unit: "%",
    status,
    evidenceRefs,
    dimensions: {
      comparison: "previous-period",
      comparedMetricId: "energy.total_usage_kwh",
      scopeId: snapshot.context.scopeId,
      scopeName: snapshot.context.scopeName,
    },
  });
};

const addChildScopeFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  for (const scope of snapshot.analysis.childScopes) {
    const centreCode = /^Centre\s+([A-Za-z0-9][A-Za-z0-9_-]{0,15})$/u.exec(scope.name)?.[1];
    const dimensions = {
      scopeId: scope.nodeId,
      scopeName: scope.name,
      scopeType: scope.nodeType,
      ...(centreCode ? { centreCode } : {}),
    };
    const prefix = `analysis.child_scopes.${scope.nodeId}`;
    const status = factStatus(snapshot, scope.metadata.status);
    pushNumber(target, {
      id: `${prefix}.usage_kwh`,
      label: `${scope.name} energy use`,
      metricId: "energy.total_usage_kwh",
      value: scope.usageKwh,
      unit: "kWh",
      status,
      evidenceRefs,
      dimensions,
    });
    pushNumber(target, {
      id: `${prefix}.share_pct`,
      label: `${scope.name} share of selected Scope energy`,
      metricId: "energy.scope_share_pct",
      value: scope.sharePct,
      unit: "%",
      status,
      evidenceRefs,
      dimensions,
    });
    pushOptionalNumber(target, scope.kwhPerSqm, {
      id: `${prefix}.kwh_per_sqm`,
      label: `${scope.name} energy use per square metre`,
      metricId: "energy.kwh_per_sqm",
      unit: "kWh/m2",
      status,
      evidenceRefs,
      dimensions,
    });
    pushOptionalNumber(target, scope.kwhPerPerson, {
      id: `${prefix}.kwh_per_person`,
      label: `${scope.name} energy use per person`,
      metricId: "energy.kwh_per_person",
      unit: "kWh/person",
      status,
      evidenceRefs,
      dimensions,
    });
  }
};

const addTopCircuitFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const status = factStatus(snapshot);
  for (const circuit of snapshot.analysis.topCircuits) {
    pushNumber(target, {
      id: `analysis.top_circuits.${circuit.meterNodeId}.usage_kwh`,
      label: `${circuit.name} energy use`,
      metricId: "energy.circuit_usage_kwh",
      value: circuit.usageKwh,
      unit: "kWh",
      status,
      evidenceRefs,
      dimensions: { meterNodeId: circuit.meterNodeId, circuitName: circuit.name },
    });
  }
};

const addOffHoursFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  if (snapshot.analysis.offHours.status !== "available") return;
  const status = factStatus(snapshot);
  pushNumber(target, {
    id: "analysis.off_hours.usage_kwh",
    label: "Off-hours energy use",
    metricId: "energy.off_hours_usage_kwh",
    value: snapshot.analysis.offHours.usageKwh,
    unit: "kWh",
    status,
    evidenceRefs,
    dimensions: { calendarVersion: snapshot.context.businessCalendarVersion },
  });
  pushNumber(target, {
    id: "analysis.off_hours.share_pct",
    label: "Off-hours share of energy use",
    metricId: "energy.off_hours_share_pct",
    value: snapshot.analysis.offHours.sharePct,
    unit: "%",
    status,
    evidenceRefs,
    dimensions: { calendarVersion: snapshot.context.businessCalendarVersion },
  });
};

const addPreschoolBenchmarkFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const benchmark = snapshot.preschoolBenchmark;
  if (!benchmark) return;
  const status = factStatus(snapshot, benchmark.status);
  pushPercentilePair(target, "preschool.benchmark.portfolio", "Portfolio", benchmark.portfolio, status, evidenceRefs, {
    statisticGroup: "portfolio",
  });
  for (const cohort of benchmark.cohorts) {
    pushPercentilePair(
      target,
      `preschool.benchmark.cohorts.${factSegment(cohort.name)}`,
      cohort.name,
      cohort,
      status,
      evidenceRefs,
      { cohort: cohort.name, sampleSize: String(cohort.sampleSize) },
    );
  }
  for (const centre of benchmark.centres) {
    const prefix = `preschool.benchmark.centres.${centre.scopeId}`;
    const dimensions = {
      scopeId: centre.scopeId,
      scopeName: centre.name,
      centreCode: centre.centreCode,
      cohort: centre.cohort,
    };
    pushNumber(target, {
      id: `${prefix}.annualised_eui`,
      label: `${centre.name} annualised EUI`,
      metricId: "preschool.benchmark.eui",
      value: centre.annualisedEuiKwhPerSqmYear,
      unit: "kWh/m2/year",
      status,
      evidenceRefs,
      dimensions,
    });
    pushNumber(target, {
      id: `${prefix}.per_pax`,
      label: `${centre.name} May energy use per person`,
      metricId: "preschool.benchmark.per_pax",
      value: centre.mayKwhPerPerson,
      unit: "kWh/person/month",
      status,
      evidenceRefs,
      dimensions,
    });
    target.push({
      id: `${prefix}.quadrant`,
      label: `${centre.name} efficiency benchmark quadrant`,
      metricId: "preschool.benchmark.quadrant",
      value: centre.quadrant,
      status,
      evidenceRefs: [...evidenceRefs],
      dimensions,
    });
    target.push({
      id: `${prefix}.priority`,
      label: `${centre.name} benchmark priority flag`,
      metricId: "preschool.benchmark.priority",
      value: centre.priority,
      status,
      evidenceRefs: [...evidenceRefs],
      dimensions,
    });
  }
};

const addPreschoolDecisionSignalFacts = (
  target: AnalysisContextEvidenceFact[],
  snapshot: ProjectAnalysisSnapshot,
  evidenceRefs: string[],
): void => {
  const projection = snapshot.preschoolDecisionSignals;
  if (!projection || projection.status !== "available") return;
  const status = factStatus(snapshot);
  for (const signal of projection.items) {
    const centreCodes = signal.entities.map((entity) => entity.code).join(",");
    const scopeIds = signal.entities.map((entity) => entity.scopeId).join(",");
    const signalEvidenceRefs = [...new Set([...evidenceRefs, ...signal.evidenceRefs])];
    for (const metric of signal.metrics) {
      pushNumber(target, {
        id: `preschool.decision_signals.${signal.id}.${metric.id}`,
        label: metric.label,
        metricId: metric.metricId,
        value: metric.value,
        unit: metric.unit,
        status,
        evidenceRefs: signalEvidenceRefs,
        dimensions: {
          ...metric.dimensions,
          signalId: signal.id,
          sectionId: signal.sectionId,
          ...(centreCodes ? { centreCodes } : {}),
          ...(scopeIds ? { scopeIds } : {}),
        },
      });
    }
  }
};

const pushPercentilePair = (
  target: AnalysisContextEvidenceFact[],
  prefix: string,
  label: string,
  input: {
    eui: { p50: number; p75: number; unit: string };
    perPax: { p50: number; p75: number; unit: string };
  },
  status: AnalysisContextEvidenceFact["status"],
  evidenceRefs: string[],
  dimensions: Record<string, string>,
): void => {
  for (const percentile of ["p50", "p75"] as const) {
    pushNumber(target, {
      id: `${prefix}.eui.${percentile}`,
      label: `${label} EUI ${percentile.toUpperCase()}`,
      metricId: "preschool.benchmark.eui",
      value: input.eui[percentile],
      unit: input.eui.unit,
      status,
      evidenceRefs,
      dimensions: { ...dimensions, percentile },
    });
    pushNumber(target, {
      id: `${prefix}.per_pax.${percentile}`,
      label: `${label} per-pax ${percentile.toUpperCase()}`,
      metricId: "preschool.benchmark.per_pax",
      value: input.perPax[percentile],
      unit: input.perPax.unit,
      status,
      evidenceRefs,
      dimensions: { ...dimensions, percentile },
    });
  }
};

const pushOptionalNumber = (
  target: AnalysisContextEvidenceFact[],
  value: number | null | undefined,
  input: Omit<AnalysisContextEvidenceFact, "value">,
): void => {
  if (typeof value === "number" && Number.isFinite(value)) pushNumber(target, { ...input, value });
};

const pushNumber = (
  target: AnalysisContextEvidenceFact[],
  fact: AnalysisContextEvidenceFact & { value: number },
): void => {
  if (!Number.isFinite(fact.value)) return;
  target.push({ ...fact, evidenceRefs: [...fact.evidenceRefs], dimensions: { ...fact.dimensions } });
};

const factSegment = (value: string): string => encodeURIComponent(value.trim().toLocaleLowerCase());

const factStatus = (
  snapshot: ProjectAnalysisSnapshot,
  metadataStatus?: string,
): AnalysisContextEvidenceFact["status"] => {
  if (snapshot.dataQuality.status === "partial") return "partial";
  return metadataStatus === "provisional" || metadataStatus === "missing"
    ? "provisional"
    : "confirmed";
};

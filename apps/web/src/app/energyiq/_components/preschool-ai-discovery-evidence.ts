import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

export type PreschoolDiscoveryEvidenceKind =
  | "theme"
  | "portfolio"
  | "benchmark"
  | "centre"
  | "operating"
  | "spike"
  | "circuit"
  | "quality"
  | "limitation";

export type PreschoolDiscoveryEvidenceValue = string | number | boolean | null;

export type PreschoolDiscoveryEvidenceItem = {
  id: string;
  kind: PreschoolDiscoveryEvidenceKind;
  label: string;
  unit: "kWh" | "kWh/m2/year" | "kWh/person/month" | null;
  values: Record<string, PreschoolDiscoveryEvidenceValue>;
  queryIds: string[];
  limitation: string | null;
};

export type PreschoolDiscoveryEvidenceBundleV1 = {
  identity: {
    projectId: "preschool-demo";
    scopeId: string;
    snapshotId: string;
    projectReleaseId: string;
    rendererKey: "preschool-overview";
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    businessCalendarVersion: string;
    timezone: string;
    period: { from: string; to: string };
  };
  items: PreschoolDiscoveryEvidenceItem[];
};

const MAX_ITEMS = 20;
const MAX_SERIALIZED_CHARS = 6_000;

export function buildPreschoolDiscoveryEvidenceBundle(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolDiscoveryEvidenceBundleV1 | null {
  if (!validPreschoolSnapshotPins(snapshot)) return null;
  const benchmark = snapshot.preschoolBenchmark!;
  const appliances = snapshot.preschoolAppliances!;
  if (appliances.status !== "available") return null;
  const operational = snapshot.preschoolOperational?.status === "available"
    ? snapshot.preschoolOperational
    : null;
  const period = {
    from: snapshot.context.primaryPeriod.start,
    to: snapshot.context.primaryPeriod.endExclusive,
  };
  const items: PreschoolDiscoveryEvidenceItem[] = [
    {
      id: "portfolio:window",
      kind: "portfolio",
      label: "Published current-window Portfolio energy",
      unit: "kWh",
      values: {
        usageKwh: snapshot.analysis.summary.usageKwh,
        averageDailyUsageKwh: snapshot.analysis.summary.averageDailyUsageKwh,
        centreCount: snapshot.analysis.childScopes.length,
      },
      queryIds: ["scope_summary_v1", "child_scope_breakdown_v1"],
      limitation: null,
    },
    {
      id: "benchmark:portfolio-p75",
      kind: "benchmark",
      label: "Published Portfolio peer cross-hairs",
      unit: null,
      values: {
        percentile: 75,
        sampleSize: benchmark.sampleSize,
        euiP50: benchmark.portfolio.eui.p50,
        euiP75: benchmark.portfolio.eui.p75,
        perPaxP50: benchmark.portfolio.perPax.p50,
        perPaxP75: benchmark.portfolio.perPax.p75,
        metadataStatus: benchmark.evidence.metadataStatus,
      },
      queryIds: ["preschool-eui-benchmark-v1", "preschool-per-pax-benchmark-v1"],
      limitation: "Provisional metadata screening; not a confirmed cause.",
    },
  ];

  for (const centreCode of benchmark.priorityCentreCodes.slice(0, 3)) {
    const centre = benchmark.centres.find((candidate) => candidate.centreCode === centreCode);
    if (!centre) return null;
    items.push({
      id: `benchmark:priority-centre:${centreCode}`,
      kind: "centre",
      label: `Priority Centre ${centreCode}`,
      unit: null,
      values: {
        centreCode,
        cohort: centre.cohort,
        usageKwh: centre.usageKwh,
        eui: centre.annualisedEuiKwhPerSqmYear,
        perPax: centre.mayKwhPerPerson,
        quadrant: centre.quadrant,
      },
      queryIds: ["preschool-quadrant-v1"],
      limitation: "Provisional area and headcount.",
    });
  }

  if (!operational) {
    for (const appliance of appliances.appliances.slice(0, 1)) {
      items.push({
        id: `circuit:appliance:${appliance.name}`,
        kind: "circuit",
        label: `${appliance.name} Portfolio contribution`,
        unit: "kWh",
        values: {
          appliance: appliance.name,
          applianceGroup: appliance.applianceGroup,
          usageKwh: appliance.usageKwh,
          sharePct: appliance.sharePct,
          centreCount: appliance.centreCount,
        },
        queryIds: [appliances.evidence.projectionRecipeId],
        limitation: "Project-specific Appliance alias backed by published Circuit rows.",
      });
    }
  }

  if (operational) items.push(
    {
      id: "operating:portfolio",
      kind: "operating",
      label: "Published Calendar split",
      unit: "kWh",
      values: {
        totalKwh: operational.energy.totalKwh,
        standbyKwh: operational.energy.standbyKwh,
        standbySharePct: operational.energy.standbySharePct,
        operatingKwh: operational.energy.operatingKwh,
        businessCalendarVersion: operational.evidence.businessCalendarVersion,
      },
      queryIds: ["scope_summary_v1", "operational_policy_scope_intervals_v1"],
      limitation: "Calendar-classified energy; closed hours do not prove waste.",
    },
    spikeSummary("standby", operational),
    spikeSummary("operating", operational),
    {
      id: "operating:sop-signal",
      kind: "operating",
      label: operational.sop.label,
      unit: null,
      values: {
        status: operational.sop.status,
        baselineScore: operational.sop.baselineScore,
        deductionPerStandbySpike: operational.sop.deductionPerStandbySpike,
        breachingCentres: operational.sop.breachingCentreCodes.join(", "),
        scores: operational.sop.centres
          .filter((centre) => centre.standbySpikeCount > 0)
          .map((centre) => `${centre.centreCode}:${centre.score}`)
          .join(", "),
      },
      queryIds: ["preschool-after-hours-sop-signal-v1"],
      limitation: "Provisional signal; not confirmed SOP compliance.",
    },
  );

  const strongestStandby = operational ? strongestSpike(operational.spikes.standby.centres) : null;
  if (strongestStandby && operational) items.push(circuitEvidence("standby", strongestStandby, operational));

  items.push({
    id: "quality:window",
    kind: "quality",
    label: "Published current-window data quality",
    unit: null,
    values: {
      status: snapshot.dataQuality.status,
      coveragePct: snapshot.dataQuality.coveragePct,
      validIntervalCount: snapshot.dataQuality.validIntervalCount,
      expectedMeterIntervalCount: snapshot.dataQuality.expectedMeterIntervalCount,
      qualityEventCount: snapshot.dataQuality.qualityEventCount,
    },
    queryIds: ["scope_summary_v1"],
    limitation: null,
  }, {
    id: "limitation:external-operational-evidence",
    kind: "limitation",
    label: "External operational Evidence is not present",
    unit: null,
    values: {
      evidenceStatus: "Missing Evidence",
      missing: "equipment state, occupancy, maintenance, confirmed on-site procedure, savings, ROI, owner, commitment",
    },
    queryIds: [],
    limitation: "Use Hypothesis or Missing Evidence for causes.",
  });

  const bundle: PreschoolDiscoveryEvidenceBundleV1 = {
    identity: {
      projectId: "preschool-demo",
      scopeId: snapshot.context.scopeId,
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      rendererKey: "preschool-overview",
      hierarchyRevisionId: snapshot.context.hierarchyRevisionId,
      meterMappingRevisionId: snapshot.context.meterMappingRevisionId,
      meterFormulaRevisionId: snapshot.context.meterFormulaRevisionId,
      metricVersion: snapshot.context.metricVersion,
      businessCalendarVersion: snapshot.context.businessCalendarVersion,
      timezone: snapshot.context.timezone,
      period,
    },
    items: items.slice(0, MAX_ITEMS),
  };
  return JSON.stringify(bundle).length <= MAX_SERIALIZED_CHARS ? bundle : null;
}

type AvailableOperational = Extract<
  NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolOperational"]>,
  { status: "available" }
>;

type OperationalCentre = AvailableOperational["spikes"]["standby"]["centres"][number];

function validPreschoolSnapshotPins(snapshot: EnergyProjectAnalysisSnapshotDto): boolean {
  const benchmark = snapshot.preschoolBenchmark;
  const appliances = snapshot.preschoolAppliances;
  const operational = snapshot.preschoolOperational?.status === "available"
    ? snapshot.preschoolOperational
    : null;
  const context = snapshot.context;
  const release = snapshot.projectRelease;
  const primaryPeriod = context.primaryPeriod;
  const analysisContext = snapshot.analysis.context;
  const provenance = snapshot.analysis.provenance;
  const releasedMetricVersion = `metric-revisions:${[...release.metricRevisionIds]
    .sort((left, right) => left.localeCompare(right))
    .join(",") || "none"}`;
  if (context.projectId !== "preschool-demo"
    || context.scopeType !== "project"
    || snapshot.renderer.key !== "preschool-overview"
    || release.renderer.key !== "preschool-overview"
    || snapshot.renderer.key !== release.renderer.key
    || snapshot.renderer.version !== release.renderer.version
    || snapshot.renderer.contractVersion !== release.renderer.contractVersion
    || release.projectId !== context.projectId
    || context.projectReleaseId !== release.id
    || context.dataSnapshotId !== snapshot.dataSnapshot.id
    || analysisContext.projectId !== context.projectId
    || analysisContext.scopeId !== context.scopeId
    || analysisContext.resource !== context.resource
    || analysisContext.timezone !== context.timezone
    || analysisContext.from !== primaryPeriod.start
    || analysisContext.to !== primaryPeriod.endExclusive
    || analysisContext.dataSnapshotId !== snapshot.dataSnapshot.id
    || analysisContext.hierarchyRevisionId !== context.hierarchyRevisionId
    || analysisContext.meterMappingRevisionId !== context.meterMappingRevisionId
    || analysisContext.meterFormulaRevisionId !== context.meterFormulaRevisionId
    || analysisContext.metricVersion !== context.metricVersion
    || analysisContext.businessCalendarVersion !== context.businessCalendarVersion
    || analysisContext.tariffScheduleVersion !== context.tariffScheduleVersion
    || provenance.dataSnapshotId !== snapshot.dataSnapshot.id
    || provenance.hierarchyRevisionId !== context.hierarchyRevisionId
    || provenance.meterMappingRevisionId !== context.meterMappingRevisionId
    || provenance.meterFormulaRevisionId !== context.meterFormulaRevisionId
    || provenance.metricVersion !== context.metricVersion
    || context.hierarchyRevisionId !== release.hierarchyRevisionId
    || context.meterMappingRevisionId !== release.meterMappingRevisionId
    || context.meterFormulaRevisionId !== release.meterFormulaRevisionId
    || context.businessCalendarVersion !== release.businessCalendarVersion
    || context.tariffScheduleVersion !== release.tariffScheduleVersion
    || context.metricVersion !== releasedMetricVersion
    || snapshot.dataQuality.status !== "complete"
    || !benchmark
    || benchmark.status !== "provisional"
    || benchmark.contract.id !== "preschool-may-2026-benchmark"
    || benchmark.sampleSize !== 30
    || benchmark.period.start !== primaryPeriod.start
    || benchmark.period.endExclusive !== primaryPeriod.endExclusive
    || benchmark.period.timezone !== context.timezone
    || benchmark.evidence.projectReleaseId !== release.id
    || benchmark.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
    || benchmark.evidence.hierarchyRevisionId !== context.hierarchyRevisionId
    || benchmark.evidence.meterMappingRevisionId !== context.meterMappingRevisionId
    || !appliances
    || appliances.status !== "available"
    || appliances.period.start !== primaryPeriod.start
    || appliances.period.endExclusive !== primaryPeriod.endExclusive
    || appliances.period.timezone !== context.timezone
    || appliances.evidence.projectReleaseId !== release.id
    || appliances.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
    || appliances.evidence.hierarchyRevisionId !== context.hierarchyRevisionId
    || appliances.evidence.meterMappingRevisionId !== context.meterMappingRevisionId
    || (operational !== null && (
      !(
        (operational.contract.id === "preschool-may-2026-operational-behaviour"
          && (operational.contract.version === "2" || operational.contract.version === "3"))
        || (operational.contract.id === "preschool-operational-behaviour"
          && operational.contract.version === "4")
      )
      || operational.period.start !== primaryPeriod.start
      || operational.period.endExclusive !== primaryPeriod.endExclusive
      || operational.period.timezone !== context.timezone
      || operational.evidence.projectReleaseId !== release.id
      || operational.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
      || operational.evidence.hierarchyRevisionId !== context.hierarchyRevisionId
      || operational.evidence.meterMappingRevisionId !== context.meterMappingRevisionId
      || operational.evidence.businessCalendarVersion !== context.businessCalendarVersion
    ))
  ) return false;
  return true;
}

function spikeSummary(
  state: "standby" | "operating",
  operational: AvailableOperational,
): PreschoolDiscoveryEvidenceItem {
  const segment = operational.spikes[state];
  return {
    id: `spike:${state}-summary`,
    kind: "spike",
    label: `${state === "standby" ? "Standby" : "Operating"} Spike summary`,
    unit: null,
    values: {
      operatingState: state,
      spikeCount: segment.count,
      centreCount: segment.centreCount,
      thresholdPct: operational.contract.spikeThresholdPct,
      baseline: operational.evidence.baseline,
    },
    queryIds: [operational.evidence.projectionQueryId],
    limitation: "Signal only; equipment state and cause are unknown.",
  };
}

function strongestSpike(centres: OperationalCentre[]): OperationalCentre | null {
  return centres.toSorted((left, right) =>
    right.worstSpike.impactKwh - left.worstSpike.impactKwh
      || left.centreCode.localeCompare(right.centreCode))[0] ?? null;
}

function circuitEvidence(
  state: "standby" | "operating",
  centre: OperationalCentre,
  operational: AvailableOperational,
): PreschoolDiscoveryEvidenceItem {
  return {
    id: `circuit:${state}:${centre.centreCode}`,
    kind: "circuit",
    label: `${state === "standby" ? "Standby" : "Operating"} leading Circuit Evidence for Centre ${centre.centreCode}`,
    unit: "kWh",
    values: {
      operatingState: state,
      centreCode: centre.centreCode,
      localDate: centre.worstSpike.localDate,
      localHour: centre.worstSpike.localHour,
      usageKwh: centre.worstSpike.usageKwh,
      baselineKwh: centre.worstSpike.baselineKwh,
      impactKwh: centre.worstSpike.impactKwh,
      variancePct: centre.worstSpike.variancePct,
      leadingCircuit: customerCircuitName(centre.worstSpike.leadingCircuitName),
      leadingCircuitKwh: centre.worstSpike.leadingCircuitKwh,
      leadingCircuitSharePct: centre.worstSpike.leadingCircuitSharePct,
    },
    queryIds: [operational.evidence.projectionQueryId],
    limitation: "Leading Spike contribution; not a confirmed device cause.",
  };
}

function customerCircuitName(value: string): string {
  const separator = value.indexOf(":");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

import {
  compileTrustedEnergyTextQuery,
  createTrustedEnergyAnswerEnvelope,
  TRUSTED_ENERGY_TEXT_INTENT_METRICS,
  type TrustedEnergyPhysicalSchemaIdentity,
  type TrustedEnergyTextIntent,
  type TrustedEnergyTextQueryContract,
  type TrustedEnergyTextResult,
  validateTrustedEnergyTextResult
} from "./trusted-energy-text.js";

export type TrustedEnergySnapshotMetric = {
  id: string;
  label: string;
  unit: string;
  revisionId: string;
};

export type TrustedEnergySnapshotProjection = {
  context: {
    projectId: string;
    projectName: string;
    scopeId: string;
    scopeName: string;
    scopeType: string;
    period: string;
    timezone: string;
    primaryPeriod: { start: string; endExclusive: string };
  };
  projectRelease: { metricRevisionIds: string[] };
  dataSnapshot: { id: string; lastSeenAt: string | null };
  evidence: Array<{ id: string; metricId: string }>;
  findings: Array<{ code: string; title: string; suggestedAction: string }>;
  analysis: {
    summary: {
      usageKwh: number;
      peakKw: number;
      kwhPerSqm?: number;
      kwhPerPerson?: number;
    };
    comparison: { usageKwh: number; changeKwh: number; changePct: number | null };
    baseline?: { normalUsageKwh: number; deviationPct: number | null };
    dayTypeProfile?: Array<{ dayType: string; usageKwh: number }>;
    categories: Array<{ category: string; usageKwh: number; sharePct: number }>;
    childScopes: Array<{
      nodeId: string;
      name: string;
      usageKwh: number;
      kwhPerSqm?: number;
      kwhPerPerson?: number;
    }>;
    topCircuits: Array<{ meterNodeId: string; name: string; usageKwh: number }>;
    offHours: { status: "available"; usageKwh: number; sharePct: number }
      | { status: "unavailable"; reason: string };
  };
};

export type ProjectAnalysisSnapshotTrustedTextInput = {
  intent: TrustedEnergyTextIntent;
  snapshot: TrustedEnergySnapshotProjection;
  sourcePin: {
    datasourceId: string;
    datasourceRevision: string;
    physicalSchema: TrustedEnergyPhysicalSchemaIdentity;
  };
  metrics: TrustedEnergySnapshotMetric[];
};

/** Project the minimal structural subset of ProjectAnalysisSnapshot without importing an API app type. */
export const projectAnalysisSnapshotToTrustedText = (
  input: ProjectAnalysisSnapshotTrustedTextInput
): TrustedEnergyTextQueryContract => {
  const metricIds = TRUSTED_ENERGY_TEXT_INTENT_METRICS[input.intent];
  const metricById = new Map(input.metrics.map((metric) => [metric.id, metric]));
  const selectedMetrics = metricIds.map((id) => {
    const metric = metricById.get(id);
    if (!metric) throw new Error(`TRUSTED_ENERGY_SNAPSHOT_METRIC_UNAVAILABLE:${id}`);
    if (!input.snapshot.projectRelease.metricRevisionIds.includes(metric.revisionId)) {
      throw new Error(`TRUSTED_ENERGY_SNAPSHOT_METRIC_NOT_RELEASED:${metric.revisionId}`);
    }
    return metric;
  });
  const primaryMetric = selectedMetrics[0];
  if (!primaryMetric) throw new Error("TRUSTED_ENERGY_SNAPSHOT_METRIC_UNAVAILABLE");
  const evidenceRefs = selectedMetrics.map((metric) => {
    const evidence = input.snapshot.evidence.find((candidate) =>
      candidate.metricId === metric.id || candidate.metricId === metric.revisionId);
    if (!evidence) throw new Error(`TRUSTED_ENERGY_SNAPSHOT_EVIDENCE_UNAVAILABLE:${metric.id}`);
    return {
      id: evidence.id,
      metricId: metric.id,
      metricRevisionId: metric.revisionId,
      dataSnapshotId: input.snapshot.dataSnapshot.id
    };
  });
  const evidenceByMetric = new Map(evidenceRefs.map((evidence) => [evidence.metricId, evidence]));
  const expectedFacts = projectFacts(input.intent, input.snapshot, metricById, evidenceByMetric);
  const dataAsOf = input.snapshot.dataSnapshot.lastSeenAt;
  if (!dataAsOf) throw new Error("TRUSTED_ENERGY_SNAPSHOT_DATA_AS_OF_UNAVAILABLE");

  return compileTrustedEnergyTextQuery({
    kind: "trusted-energy-text",
    intent: input.intent,
    context: {
      sourcePin: input.sourcePin,
      project: {
        id: input.snapshot.context.projectId,
        name: input.snapshot.context.projectName
      },
      scope: {
        id: input.snapshot.context.scopeId,
        name: input.snapshot.context.scopeName,
        type: input.snapshot.context.scopeType
      },
      period: {
        label: input.snapshot.context.period,
        start: input.snapshot.context.primaryPeriod.start,
        endExclusive: input.snapshot.context.primaryPeriod.endExclusive,
        timezone: input.snapshot.context.timezone
      },
      metric: primaryMetric,
      supportingMetrics: selectedMetrics.slice(1),
      dataSnapshotId: input.snapshot.dataSnapshot.id,
      dataAsOf,
      evidenceRefs,
      expectedFacts
    }
  });
};

export type TrustedEnergyStructuredClaimProvider = {
  id: string;
  fallbackPolicy: "disabled";
  generate(contract: TrustedEnergyTextQueryContract): Promise<unknown>;
};

/** Execute exactly one provider attempt, then render only server-canonical validated claims. */
export const executeTrustedEnergyText = async (input: {
  contract: TrustedEnergyTextQueryContract;
  provider: TrustedEnergyStructuredClaimProvider;
}): Promise<{ result: TrustedEnergyTextResult; answer: string; providerId: string }> => {
  if (input.provider.fallbackPolicy !== "disabled") {
    throw new Error("TRUSTED_ENERGY_FALLBACK_MUST_BE_DISABLED");
  }
  const result = validateTrustedEnergyTextResult(
    input.contract,
    await input.provider.generate(input.contract)
  );
  return {
    result,
    answer: createTrustedEnergyAnswerEnvelope(input.contract, result),
    providerId: input.provider.id
  };
};

type EvidenceRef = {
  id: string;
  metricId: string;
  metricRevisionId: string;
  dataSnapshotId: string;
};

type Fact = {
  id: string;
  label: string;
  metricId: string;
  metricRevisionId: string;
  value: string | number;
  unit?: string;
  tolerance?: number;
  evidenceRefIds: string[];
};

const projectFacts = (
  intent: TrustedEnergyTextIntent,
  snapshot: TrustedEnergySnapshotProjection,
  metricById: Map<string, TrustedEnergySnapshotMetric>,
  evidenceByMetric: Map<string, EvidenceRef>
): Fact[] => {
  const fact = (input: {
    id: string;
    label: string;
    metricId: string;
    value: string | number;
  }): Fact => {
    const metric = metricById.get(input.metricId);
    const evidence = evidenceByMetric.get(input.metricId);
    if (!metric || !evidence) throw new Error(`TRUSTED_ENERGY_SNAPSHOT_FACT_UNAVAILABLE:${input.metricId}`);
    return {
      id: input.id,
      label: input.label,
      metricId: metric.id,
      metricRevisionId: metric.revisionId,
      value: input.value,
      ...(typeof input.value === "number" ? { unit: metric.unit, tolerance: 0.0001 } : {}),
      evidenceRefIds: [evidence.id]
    };
  };
  const total = "energy.total_usage_kwh";
  switch (intent) {
    case "period-usage-vs-previous":
      return [
        fact({ id: "period.current-usage", label: "Selected period energy use", metricId: total, value: snapshot.analysis.summary.usageKwh }),
        fact({ id: "period.previous-usage", label: "Previous period energy use", metricId: total, value: snapshot.analysis.comparison.usageKwh }),
        fact({ id: "period.change", label: "Change from previous period", metricId: total, value: snapshot.analysis.comparison.changeKwh })
      ];
    case "historical-normal-level": {
      const baseline = snapshot.analysis.baseline;
      if (!baseline) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.baseline");
      return [
        fact({ id: "baseline.normal-usage", label: "Historical normal energy use", metricId: total, value: baseline.normalUsageKwh }),
        fact({ id: "baseline.current-usage", label: "Selected period energy use", metricId: total, value: snapshot.analysis.summary.usageKwh })
      ];
    }
    case "day-type-pattern": {
      const dayTypes = snapshot.analysis.dayTypeProfile;
      if (!dayTypes?.length) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.dayTypeProfile");
      return [...dayTypes]
        .sort((left, right) => left.dayType.localeCompare(right.dayType))
        .map((entry) => fact({
          id: `day-type.${slug(entry.dayType)}`,
          label: `${entry.dayType} energy use`,
          metricId: total,
          value: entry.usageKwh
        }));
    }
    case "top-peer-scope": {
      const top = maxBy(snapshot.analysis.childScopes, (scope) => scope.usageKwh);
      if (!top) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.childScopes");
      return [
        fact({ id: "peer.top-name", label: "Highest-usage peer Scope", metricId: total, value: top.name }),
        fact({ id: "peer.top-usage", label: "Highest peer energy use", metricId: total, value: top.usageKwh })
      ];
    }
    case "normalised-performance": {
      const facts: Fact[] = [];
      if (snapshot.analysis.summary.kwhPerSqm !== undefined) facts.push(fact({
        id: "normalised.per-sqm", label: "Energy use intensity", metricId: "energy.usage_per_sqm",
        value: snapshot.analysis.summary.kwhPerSqm
      }));
      if (snapshot.analysis.summary.kwhPerPerson !== undefined) facts.push(fact({
        id: "normalised.per-person", label: "Energy use per person", metricId: "energy.usage_per_person",
        value: snapshot.analysis.summary.kwhPerPerson
      }));
      if (facts.length !== 2) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.summary.normalised");
      return facts;
    }
    case "top-circuit-contribution": {
      const top = maxBy(snapshot.analysis.topCircuits, (circuit) => circuit.usageKwh);
      if (!top) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.topCircuits");
      return [
        fact({ id: "circuit.top-name", label: "Top contributing Circuit", metricId: total, value: top.name }),
        fact({ id: "circuit.top-usage", label: "Top Circuit energy use", metricId: total, value: top.usageKwh })
      ];
    }
    case "category-breakdown":
      if (!snapshot.analysis.categories.length) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.categories");
      return [...snapshot.analysis.categories]
        .sort((left, right) => left.category.localeCompare(right.category))
        .map((entry) => fact({ id: `category.${slug(entry.category)}`, label: `${entry.category} energy use`, metricId: total, value: entry.usageKwh }));
    case "peak-and-contributors": {
      const top = maxBy(snapshot.analysis.topCircuits, (circuit) => circuit.usageKwh);
      if (!top) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.topCircuits");
      return [
        fact({ id: "peak.value", label: "Peak interval-average power", metricId: "energy.peak_demand_kw", value: snapshot.analysis.summary.peakKw }),
        fact({ id: "peak.top-contributor", label: "Top contributing Circuit energy use", metricId: total, value: top.usageKwh })
      ];
    }
    case "non-operating-usage":
      if (snapshot.analysis.offHours.status !== "available") {
        throw new Error(`TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.offHours:${snapshot.analysis.offHours.reason}`);
      }
      return [
        fact({ id: "off-hours.usage", label: "Non-operating energy use", metricId: "energy.off_hours_usage_kwh", value: snapshot.analysis.offHours.usageKwh }),
        fact({ id: "off-hours.share", label: "Non-operating share", metricId: "energy.off_hours_share_pct", value: snapshot.analysis.offHours.sharePct })
      ];
    case "priority-actions":
      if (!snapshot.findings.length) throw new Error("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:findings");
      if (snapshot.analysis.offHours.status !== "available") {
        throw new Error(`TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.offHours:${snapshot.analysis.offHours.reason}`);
      }
      return [
        ...snapshot.findings.slice(0, 3).map((finding, index) => fact({
        id: `priority.${index + 1}.${slug(finding.code)}`,
        label: finding.title,
        metricId: total,
        value: finding.suggestedAction
        })),
        fact({
          id: "priority.off-hours-usage",
          label: "Non-operating energy use",
          metricId: "energy.off_hours_usage_kwh",
          value: snapshot.analysis.offHours.usageKwh
        }),
        fact({
          id: "priority.off-hours-share",
          label: "Non-operating share",
          metricId: "energy.off_hours_share_pct",
          value: snapshot.analysis.offHours.sharePct
        }),
        fact({
          id: "priority.peak",
          label: "Peak interval-average power",
          metricId: "energy.peak_demand_kw",
          value: snapshot.analysis.summary.peakKw
        })
      ];
  }
};

const maxBy = <T>(values: T[], score: (value: T) => number): T | undefined =>
  values.reduce<T | undefined>((best, current) =>
    !best || score(current) > score(best) ? current : best, undefined);
const slug = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

import type { PreschoolBenchmarkProjection } from "./preschool-benchmark-projection.js";
import type { PreschoolOperationalProjection } from "./preschool-operational-projection.js";

export type PreschoolDecisionSignalSectionId =
  | "overall-summary"
  | "centre-benchmark"
  | "operating-behaviour"
  | "appliance-contribution"
  | "planning-outlook";

export type PreschoolDecisionSignalMetric = {
  id: string;
  label: string;
  metricId: string;
  value: number;
  unit: "kWh" | "%" | "count";
  role: "primary" | "supporting";
  precision: number;
  dimensions: Record<string, string>;
};

export type PreschoolDecisionSignal = {
  id: "after-hours" | "efficiency" | "operating";
  kind: "after-hours-energy" | "normalised-peer-priority" | "operating-hour-spikes";
  sectionId: PreschoolDecisionSignalSectionId;
  priority: 1 | 2 | 3;
  severity: "attention";
  label: string;
  metrics: PreschoolDecisionSignalMetric[];
  entities: Array<{
    kind: "centre";
    scopeId: string;
    code: string;
    name: string;
  }>;
  evidenceRefs: string[];
  limitations: Array<{
    code: "CAUSE_NOT_OBSERVED" | "PROVISIONAL_METADATA" | "ACTIVITY_NOT_OBSERVED";
    label: string;
  }>;
};

export type PreschoolDecisionSignals = {
  contract: {
    id: "preschool-decision-signals";
    version: "1";
  };
  context: {
    projectReleaseId: string;
    dataSnapshotId: string;
    period: { start: string; endExclusive: string; timezone: string };
  };
  status: "available" | "withheld";
  reason?: {
    code: "SNAPSHOT_INCOMPLETE";
    message: string;
  };
  items: PreschoolDecisionSignal[];
};

export function buildPreschoolDecisionSignals(input: {
  projectReleaseId: string;
  dataSnapshotId: string;
  period: { start: string; endExclusive: string; timezone: string };
  dataQualityStatus: "complete" | "partial" | "unavailable";
  totalCentreCount: number;
  benchmark?: PreschoolBenchmarkProjection;
  operational?: PreschoolOperationalProjection;
}): PreschoolDecisionSignals {
  const base = {
    contract: { id: "preschool-decision-signals" as const, version: "1" as const },
    context: {
      projectReleaseId: input.projectReleaseId,
      dataSnapshotId: input.dataSnapshotId,
      period: { ...input.period },
    },
  };
  if (input.dataQualityStatus !== "complete") {
    return {
      ...base,
      status: "withheld",
      reason: {
        code: "SNAPSHOT_INCOMPLETE",
        message: "Decision signals are withheld because the current Snapshot is not complete.",
      },
      items: [],
    };
  }

  const candidates: Array<Omit<PreschoolDecisionSignal, "priority">> = [];
  const operational = input.operational?.status === "available" ? input.operational : null;
  if (operational && operational.spikes.standby.count > 0 && operational.sop.breachingCentreCodes.length > 0) {
    const breachingCodes = new Set(operational.sop.breachingCentreCodes);
    candidates.push({
      id: "after-hours",
      kind: "after-hours-energy",
      sectionId: "operating-behaviour",
      severity: "attention",
      label: "Energy used after closing",
      metrics: [
        metric("after-hours-share", "Share used after closing", "energy.off_hours_share_pct", operational.energy.standbySharePct, "%", "primary", 1, { operatingState: "closed" }),
        metric("after-hours-energy", "Energy used after closing", "energy.off_hours_usage_kwh", operational.energy.standbyKwh, "kWh", "supporting", 2, { operatingState: "closed" }),
        metric("after-hours-spikes", "Unusual closed-hour peaks", "preschool.operating.spike_count", operational.spikes.standby.count, "count", "supporting", 0, { operatingState: "closed" }),
        metric("after-hours-centres", "Centres with closed-hour peaks", "preschool.operating.centre_count", operational.spikes.standby.centreCount, "count", "supporting", 0, { operatingState: "closed" }),
      ],
      entities: operational.sop.centres
        .filter((centre) => breachingCodes.has(centre.centreCode))
        .map((centre) => ({ kind: "centre" as const, scopeId: centre.scopeId, code: centre.centreCode, name: centre.name })),
      evidenceRefs: unique([
        ...operational.evidence.sourceQueryIds,
        operational.evidence.projectionQueryId,
        ...operational.evidence.projectionRecipeIds,
      ]),
      limitations: [{
        code: "CAUSE_NOT_OBSERVED",
        label: "Meter data shows when energy was used, not why equipment was running.",
      }],
    });
  }

  const benchmark = input.benchmark;
  if (benchmark && benchmark.priorityCentreCodes.length > 0 && benchmark.sampleSize > 0) {
    const priorityCodes = new Set(benchmark.priorityCentreCodes);
    candidates.push({
      id: "efficiency",
      kind: "normalised-peer-priority",
      sectionId: "centre-benchmark",
      severity: "attention",
      label: "High for both floor area and headcount",
      metrics: [
        metric("priority-centres", "Centres above both all-centre P75 lines", "preschool.benchmark.priority_count", benchmark.priorityCentreCodes.length, "count", "primary", 0, { benchmark: "portfolio-p75" }),
        metric("benchmark-sample", "Centres compared", "preschool.benchmark.sample_size", benchmark.sampleSize, "count", "supporting", 0, { benchmark: "portfolio" }),
      ],
      entities: benchmark.centres
        .filter((centre) => priorityCodes.has(centre.centreCode))
        .map((centre) => ({ kind: "centre" as const, scopeId: centre.scopeId, code: centre.centreCode, name: centre.name })),
      evidenceRefs: unique([
        ...benchmark.evidence.sourceQueryIds,
        ...benchmark.evidence.projectionRecipeIds,
      ]),
      limitations: [{
        code: "PROVISIONAL_METADATA",
        label: "Floor area and headcount are provisional, so this is an investigation priority rather than proof of poor efficiency.",
      }],
    });
  }

  if (operational && operational.spikes.operating.count > 0 && input.totalCentreCount > 0) {
    candidates.push({
      id: "operating",
      kind: "operating-hour-spikes",
      sectionId: "operating-behaviour",
      severity: "attention",
      label: "Unusual peaks during opening hours",
      metrics: [
        metric("operating-spike-centres", "Centres with unusual opening-hour peaks", "preschool.operating.centre_count", operational.spikes.operating.centreCount, "count", "primary", 0, { operatingState: "open" }),
        metric("operating-spike-count", "Unusual opening-hour peaks", "preschool.operating.spike_count", operational.spikes.operating.count, "count", "supporting", 0, { operatingState: "open" }),
        metric("portfolio-centres", "Centres reviewed", "preschool.portfolio.centre_count", input.totalCentreCount, "count", "supporting", 0, { scope: "project" }),
      ],
      entities: operational.spikes.operating.centres.map((centre) => ({
        kind: "centre" as const,
        scopeId: centre.scopeId,
        code: centre.centreCode,
        name: centre.name,
      })),
      evidenceRefs: unique([
        ...operational.evidence.sourceQueryIds,
        operational.evidence.projectionQueryId,
        operational.evidence.projectionRecipeIds[0],
      ]),
      limitations: [{
        code: "ACTIVITY_NOT_OBSERVED",
        label: "Meter data cannot distinguish planned activity, manual override and equipment faults.",
      }],
    });
  }

  return {
    ...base,
    status: "available",
    items: candidates.slice(0, 3).map((candidate, index) => ({
      ...candidate,
      priority: (index + 1) as 1 | 2 | 3,
    })),
  };
}

function metric(
  id: string,
  label: string,
  metricId: string,
  value: number,
  unit: PreschoolDecisionSignalMetric["unit"],
  role: PreschoolDecisionSignalMetric["role"],
  precision: number,
  dimensions: Record<string, string>,
): PreschoolDecisionSignalMetric {
  return { id, label, metricId, value, unit, role, precision, dimensions };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

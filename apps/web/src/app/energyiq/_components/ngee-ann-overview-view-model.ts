import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { anomalyIncidentDomId } from "./ngee-ann-overview-links";

const COMPARISON_EVIDENCE_METRIC_IDS = new Set([
  "energy.total_usage_kwh",
  "energy.comparison_change_kwh",
  "energy.comparison_change_pct",
]);

export type NgeeAnnOverviewDataStatus = "ready" | "partial" | "unavailable";

export type NgeeAnnOverviewHighlight = {
  id: "total" | "daily" | "peak" | "cost";
  label: string;
  value: string;
  unit?: string;
  detail: string;
  available: boolean;
  comparison: {
    label: string;
    direction: "increase" | "decrease" | "flat";
  } | null;
};

export type NgeeAnnExecutiveSummarySignal = {
  id: "period-change" | "main-driver" | "first-review";
  label: string;
  value: string;
  detail: string;
  href: string | null;
  status: "available" | "unavailable";
  tone: "neutral" | "warning";
};

export type NgeeAnnExecutiveSummaryViewModel = {
  headline: string;
  detail: string;
  signals: NgeeAnnExecutiveSummarySignal[];
};

export type NgeeAnnChangeOverTimeSummaryViewModel = {
  headline: string;
  detail: string;
};

export type NgeeAnnMonthlyContextSegmentViewModel = {
  label: string;
  range: string;
  dataStatus: "complete" | "partial" | "unavailable";
  expectedDayCount: number;
  completeDayCount: number;
  usageKwhValue: number | null;
  usageKwh: string | null;
  averageDailyUsageKwh: string | null;
  evidence: {
    dataSnapshotId: string;
    queryId: "daily_totals_v1";
  };
};

export type NgeeAnnMonthlyContextViewModel = {
  status: "available" | "unavailable";
  current: {
    label: string;
    range: string;
    phase: "complete" | "partial";
    completeDayCount: number;
    usageKwhValue: number | null;
    usageKwh: string | null;
    averageDailyUsageKwh: string | null;
  };
  sameProgress: {
    status: "available" | "unavailable";
    headline: string;
    referenceLabel: string | null;
    deltaKwh: string | null;
    deltaPct: string | null;
    direction: "increase" | "decrease" | "flat" | "unavailable";
    rows: NgeeAnnMonthlyContextSegmentViewModel[];
  };
  completedMonths: {
    rows: NgeeAnnMonthlyContextSegmentViewModel[];
  };
};

export type NgeeAnnLatestAvailableRange = {
  from: string;
  to: string;
};

export type NgeeAnnEnergyTrendViewModel = {
  status: "available" | "unavailable";
  grain: "day" | "hour";
  decisionQuestion: string;
  reason: string | null;
  baselineOverlay: {
    status: "available" | "unavailable" | "not_applicable";
    reason: string | null;
    ruleRevisionId: string | null;
  };
  scopes: Array<{
    id: string;
    name: string;
    limitation: string | null;
    points: Array<{
      id: string;
      localDate: string;
      localHour: number | null;
      dayType: "weekday" | "weekend" | "public_holiday" | null;
      dateLabel: string;
      weekday: string;
      range: string;
      acceptedUsageKwh: number | null;
      usageKwh: string | null;
      status: "complete" | "partial" | "unavailable";
      statusLabel: "Complete" | "Partial" | "Unavailable";
      coverage: string;
      intervals: string;
      qualityEvents: string;
      baseline: {
        outcome: "triggered" | "within_threshold" | "suppressed";
        outcomeLabel:
          | "Above-baseline rule triggered"
          | "Within rule threshold"
          | "No rule conclusion — Evidence incomplete"
          | "No rule conclusion — Calendar classification changed";
        baselineKwh: number | null;
        baselineUsageKwh: string | null;
        deltaUsageKwh: string | null;
        relativePctLabel: string | null;
        incidentId: string | null;
        limitation: string | null;
      } | null;
    }>;
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricId: "energy.total_usage_kwh@1";
    period: string;
    timezone: string;
    unit: "kWh";
    queryIds: ["daily_totals_v1"] | ["time_bucket_grid_v1"];
    baseline: {
      bundleId: string;
      queryId: "time_slot_anomaly_v1";
      ruleRevisionId: string;
      baselineCutoff: string;
      baselineMethod: "mean_of_complete_comparable_days_by_local_hour";
    } | null;
  };
};

type TimeBehaviourEvidence = {
  snapshotId: string;
  projectReleaseId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricId: "energy.total_usage_kwh@1";
  period: string;
  timezone: string;
  unit: "kWh";
  queryIds: ["time_bucket_grid_v1"];
};

type ComponentHourlyEvidence = Omit<TimeBehaviourEvidence, "queryIds"> & {
  queryIds: ["component_hourly_profiles_v1"];
  accountingBasis: "published_component_circuits";
};

type TimePointQuality = {
  status: "complete" | "partial" | "unavailable";
  statusLabel: "Complete" | "Partial" | "Unavailable";
  coverage: string;
  intervals: string;
  qualityEvents: string;
};

export type NgeeAnnDayProfileViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  operatingPolicy:
    | {
      status: "available";
      reason: null;
      operatingUsageKwh: number;
      operatingUsage: string;
      standbyUsageKwh: number;
      standbyUsage: string;
      standbySharePct: number;
      standbyShare: string;
      timezone: string;
      businessCalendarVersion: string;
    }
    | {
      status: "unavailable";
      reason: string;
    };
  scopes: Array<{ id: string; name: string }>;
  profiles: Array<{
    id: string;
    dayType: "weekday" | "weekend" | "public_holiday";
    dayTypeLabel: "Weekday" | "Weekend" | "Public Holiday";
    scopeId: string;
    scopeName: string;
    status: "available" | "unavailable";
    sampleDayCount: number | null;
    reason: string | null;
    summary:
      | {
        status: "available";
        peakHour: number;
        peakHourLabel: string;
        peakUsageKwh: number;
        peakUsage: string;
        dailyUsageKwh: number;
        dailyUsage: string;
        sampleDayCount: number;
      }
      | {
        status: "unavailable";
        reason: string;
      };
    values: Array<{
      id: string;
      localHour: number;
      hourLabel: string;
      acceptedUsageKwh: number;
      usageKwh: string;
    }>;
    componentStack:
      | {
        status: "available";
        sampleDayCount: number;
        categories: Array<{
          category: string;
          categoryLabel: string;
          values: Array<{
            id: string;
            localHour: number;
            hourLabel: string;
            acceptedUsageKwh: number;
            usageKwh: string;
          }>;
        }>;
      }
      | {
        status: "unavailable";
        reason: string;
    };
  }>;
  holidayInsight:
    | {
      status: "available";
      headline: string;
      detail: string;
      angle: string;
      caveat: string;
    }
    | {
      status: "unavailable";
      reason: string;
    };
  evidence: TimeBehaviourEvidence;
  componentEvidence: ComponentHourlyEvidence;
};

export type NgeeAnnUsageHeatmapViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  defaultView: "date-hour" | "level-hour";
  dates: Array<{ id: string; label: string; weekday: string }>;
  averageProfiles: Array<{
    id: string;
    dayType: "weekday" | "weekend";
    dayTypeLabel: "Weekday" | "Weekend";
    scopeId: string;
    scopeName: string;
    sampleDayCount: number;
    dailyUsageKwh: number;
    dailyUsage: string;
    peakHourLabel: string;
    peakUsage: string;
    values: Array<{
      id: string;
      localHour: number;
      hourLabel: string;
      acceptedUsageKwh: number;
      usageKwh: string;
    }>;
  }>;
  circuitProfiles: Array<{
    id: string;
    levelScopeId: string;
    levelScopeName: string;
    dayType: "weekday" | "weekend";
    dayTypeLabel: "Weekday" | "Weekend";
    sampleDayCount: number;
    circuits: Array<{
      meterNodeId: string;
      name: string;
      category: string;
      categoryLabel: string;
      values: Array<{
        id: string;
        localHour: number;
        hourLabel: string;
        acceptedUsageKwh: number;
        usageKwh: string;
      }>;
    }>;
  }>;
  scopes: Array<{
    id: string;
    name: string;
    cells: Array<{
      id: string;
      scopeId: string;
      localDate: string;
      dateLabel: string;
      weekday: string;
      localHour: number;
      hourLabel: string;
      range: string;
      acceptedUsageKwh: number | null;
      usageKwh: string | null;
      quality: TimePointQuality;
    }>;
  }>;
  evidence: TimeBehaviourEvidence;
  componentEvidence: ComponentHourlyEvidence;
};

export type NgeeAnnDailyAnomalyViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  allSuppressed: boolean;
  outcomeSummary: {
    triggered: number;
    withinThreshold: number;
    suppressed: number;
  };
  incidents: Array<{
    anomalyId: string;
    incidentId: string;
    scopeId: string;
    scopeName: string;
    localDate: string;
    dateLabel: string;
    weekday: string;
    dayType: "Weekday" | "Weekend";
    range: string;
    actualKwhValue: number;
    baselineKwhValue: number;
    impactKwhValue: number;
    relativePctValue: number;
    thresholdKwhValue: number;
    actualKwh: string;
    baselineKwh: string;
    thresholdKwh: string;
    impactKwh: string;
    relativePct: string;
    coverage: string;
    intervals: string;
    qualityEvents: string;
    relatedLevelTotals: Array<{
      scopeId: string;
      scopeName: string;
      selectedKwh: string | null;
    }>;
    baselineDates: string[];
    baselineSamples: Array<{
      localDate: string;
      coverage: string;
      intervals: string;
      qualityEvents: string;
    }>;
    hourlyComparison: Array<{
      localHour: number;
      actualKwh: number;
      baselineKwh: number;
      impactKwh: number;
      relativePct: number;
    }>;
    series: Array<{
      seriesId: string;
      relationship: "selected_scope" | "immediate_level" | "component_circuit";
      kind: "official_scope" | "component_circuit";
      scopeId: string;
      scopeName: string;
      meterNodeId: string | null;
      category: string | null;
      categoryLabel: string | null;
      includedInOfficialTotal: boolean;
      status: "available" | "partial" | "unavailable";
      statusLabel: "Available" | "Partial" | "Unavailable";
      selectedTotalKwh: string | null;
      baselineTotalKwh: string | null;
      impactKwh: string | null;
      relativePct: string | null;
      coverage: string;
      intervals: string;
      qualityEvents: string;
      points: Array<{
        localHour: number;
        hourLabel: string;
        selectedKwh: number | null;
        baselineKwh: number | null;
        impactKwh: number | null;
      }>;
    }>;
  }>;
  rule: {
    ruleRevisionId: string;
    baselineCutoff: string;
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour";
    relativeThresholdPct: string;
    absoluteImpactKwh: string;
    minimumCoveragePct: string;
    minimumSampleCount: number;
    maximumQualityEventCount: number;
    maximumLookbackDays: number;
  } | null;
  evidence: {
    bundleId: string | null;
    snapshotId: string;
    projectReleaseId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    businessCalendarVersion: string;
    metricId: "energy.total_usage_kwh@1";
    period: string;
    timezone: string;
    queryIds: ["time_slot_anomaly_v1"];
  };
};

export type NgeeAnnDecisionPrioritiesViewModel = {
  status: "available" | "empty" | "partial" | "suppressed" | "unavailable";
  limitation: string | null;
  lifecycle: {
    status: "available" | "unavailable";
    referenceLabel: string | null;
    referenceDetail: string | null;
    previousSavedAnalysisId: string | null;
    previousSnapshotId: string | null;
    historicalItems: Array<{
      themeKey: string;
      kind: "resolved" | "no_longer_supported";
      label: string;
      detail: string;
      tone: "success" | "warning";
    }>;
  };
  items: Array<{
    priorityId: string;
    rank: 1 | 2 | 3;
    finding: string;
    evidence: string;
    impact: string;
    action: string;
    confidence: "Complete Evidence" | "Partial Evidence";
    confidenceLimitation: string | null;
    targetIncidentId: string;
    explorerScopeId: string;
    explorerScopeName: string;
    sourceOccurrenceCount: number;
    recurrenceDayCount: number;
    horizons: Array<{
      label: string;
      status: "available" | "unavailable";
      period: string;
      actualKwh: number | null;
      baselineKwh: number | null;
      deltaKwh: number | null;
      relativePct: number | null;
      comparison: string;
      limitation: string | null;
    }>;
    driver: string;
    nextCheck: string;
    verificationMetric: string;
    lifecycle: {
      kind: "new" | "newly_supported" | "recurring";
      label: string;
      detail: string;
      tone: "info" | "warning";
    } | null;
  }>;
};

type PeakBreakdownQuality = {
  status: "complete" | "unavailable";
  statusLabel: "Complete" | "Unavailable";
  coverage: string;
  intervals: string;
  qualityEvents: string;
};

export type NgeeAnnPeakBreakdownViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  periodStatus: "complete" | "partial" | null;
  periodCoverage: string | null;
  peakLabel: string;
  peakAt: string | null;
  peakInterval: string | null;
  averageKw: string | null;
  quality: PeakBreakdownQuality | null;
  levels: Array<{
    scopeId: string;
    scopeName: string;
    averageKw: string;
    sharePct: string;
    quality: PeakBreakdownQuality;
    circuits: Array<{
      meterNodeId: string;
      name: string;
      category: string;
      averageKw: string | null;
      sharePct: string | null;
      includedInOfficialTotal: false;
      quality: PeakBreakdownQuality;
    }>;
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricId: "energy.peak_demand_kw@1";
    period: string;
    timezone: string;
    unit: "kW";
    queryIds: ["peak_breakdown_v1"];
  };
};

type ContributorMovement = {
  status: "available" | "unavailable";
  reason: string | null;
};

type ContributorSummary = {
  currentConcentration: {
    status: "available" | "unavailable";
    reason: string | null;
    name: string | null;
    currentUsageKwh: string | null;
    projectShare: string | null;
  };
  measuredChange: {
    status: "available" | "unavailable";
    reason: string | null;
    name: string | null;
    changeKwh: string | null;
    changePct: string | null;
  };
};

export type NgeeAnnLevelComparisonViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  summary: ContributorSummary;
  rows: Array<{
    id: string;
    name: string;
    currentUsageKwh: string;
    projectShare: string;
    projectShareBar: string;
    previousUsageKwh: string;
    changeKwh: string;
    changePct: string;
    coverage: string;
    intervals: string;
    qualityEvents: string;
    movement: ContributorMovement;
    exact: {
      currentUsageKwh: string;
      projectShare: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
    };
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    queryIds: string[];
  };
};

type CompositionStatus = {
  status: "available" | "unavailable";
  reason: string | null;
};

type CompositionQuality = {
  coverage: string;
  intervals: string;
  qualityEvents: string;
};

type DerivedMeterTraceTerm = {
  meterNodeId: string;
  name: string;
  coefficient: string;
  inputUsageKwh: string;
  contributionKwh: string;
  quality: CompositionQuality;
};

type DerivedMeterTraceInput = {
  meterNodeId: string;
  name: string;
};

export type NgeeAnnEnergyCompositionViewModel = {
  decisionQuestion: string;
  categories: CompositionStatus & {
    summary: ContributorSummary;
    rows: Array<{
      id: string;
      name: string;
      currentUsageKwh: string;
      projectShare: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
      movement: ContributorMovement;
      quality: CompositionQuality;
      exact: {
        currentUsageKwh: string;
        projectShare: string;
        previousUsageKwh: string;
        changeKwh: string;
        changePct: string;
      };
    }>;
  };
  circuits: CompositionStatus & {
    rows: Array<{
      rank: number;
      meterNodeId: string;
      name: string;
      scopeId: string;
      parentScopeId: string;
      levelId: string;
      levelName: string;
      categoryId: string;
      category: string;
      currentUsageKwh: string;
      projectShare: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
      movement: ContributorMovement;
      includedInOfficialTotal: false;
      quality: CompositionQuality;
      exact: {
        currentUsageKwh: string;
        projectShare: string;
        previousUsageKwh: string;
        changeKwh: string;
        changePct: string;
      };
    }>;
  };
  accounting: CompositionStatus & {
    designatedTotals: Array<{
      meterNodeId: string;
      name: string;
      scopeId: string;
      parentScopeId: string;
      levelName: string;
      category: string;
      currentUsageKwh: string;
      includedInOfficialTotal: true;
      quality: CompositionQuality;
    }>;
    reconciliation: null | {
      officialUsageKwh: string;
      componentUsageKwh: string;
      gapKwh: string;
      ratioPct: string;
      officialMeterCount: number;
      componentMeterCount: number;
    };
  };
  derivedMeterTrace: {
    status: "available" | "partial" | "unavailable";
    reason: string | null;
    meterNodeId: string | null;
    name: string | null;
    scopeId: string | null;
    scopeName: string | null;
    meterKind: "Derived" | null;
    resultUsageKwh: string | null;
    includedInOfficialTotal: false | null;
    terms: DerivedMeterTraceTerm[];
    impactedInputs: DerivedMeterTraceInput[];
  };
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    queryIds: string[];
    period: string;
    unit: "kWh";
  };
};

export type NgeeAnnComponentCategoryBreakdownViewModel = {
  status: "available" | "partial" | "unavailable";
  reason: string | null;
  decisionQuestion: string;
  categories: Array<{
    id: string;
    label: string;
  }>;
  scopes: Array<{
    id: string;
    name: string;
    type: string;
    period: {
      status: "complete" | "partial" | "unavailable";
      reason: string | null;
      officialUsageKwhValue: number | null;
      officialUsageKwh: string;
      componentUsageKwhValue: number | null;
      componentUsageKwh: string;
      gapKwh: string;
      ratioPct: string;
      categories: Array<{
        id: string;
        label: string;
        usageKwhValue: number | null;
        usageKwh: string;
        sharePctValue: number | null;
        sharePct: string;
      }>;
    };
    rows: Array<{
      id: string;
      localDate: string;
      dateLabel: string;
      dayType: "weekday" | "weekend" | "public_holiday" | null;
      dayTypeLabel: string;
      officialUsageKwhValue: number | null;
      officialUsageKwh: string;
      componentUsageKwhValue: number | null;
      componentUsageKwh: string;
      categories: Array<{
        id: string;
        label: string;
        usageKwhValue: number | null;
        usageKwh: string;
        sharePctValue: number | null;
        sharePct: string;
      }>;
      estimatedCost: {
        status: "available";
        amountValue: number;
        amount: string;
        currency: string;
        ratePerKwh: string;
        tariffScheduleVersion: string;
      } | {
        status: "unavailable";
        reason: string;
      };
      dataStatus: "complete" | "partial" | "unavailable";
      coverage: string;
    }>;
  }>;
  rankings: Array<{
    scopeId: string;
    categoryId: string;
    rows: Array<{
      rank: number;
      meterNodeId: string;
      name: string;
      levelName: string;
      categoryId: string;
      category: string;
      usageKwhValue: number;
      usageKwh: string;
      projectShare: string;
    }>;
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    queryId: "daily_component_categories_v1";
    accountingBasis: "published_component_circuits";
    period: string;
    timezone: string;
  };
};

export type NgeeAnnOverviewViewModel = {
  context: {
    projectName: string;
    scopeName: string;
    scopeType: string;
    period: string;
    periodRange: string;
    timezone: string;
  };
  dataStatus: {
    status: NgeeAnnOverviewDataStatus;
    label: string;
    summary: string;
    recovery: string | null;
    coverage: string;
    intervals: string;
    qualityEvents: string;
    lastSeen: string;
  };
  metadataLimitation: string | null;
  highlights: NgeeAnnOverviewHighlight[];
  executiveSummary: NgeeAnnExecutiveSummaryViewModel;
  monthlyContext: NgeeAnnMonthlyContextViewModel;
  changeOverTime: NgeeAnnChangeOverTimeSummaryViewModel;
  decisionPriorities: NgeeAnnDecisionPrioritiesViewModel;
  peakBreakdown: NgeeAnnPeakBreakdownViewModel;
  energyTrend: NgeeAnnEnergyTrendViewModel;
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel;
  dayProfile: NgeeAnnDayProfileViewModel;
  usageHeatmap: NgeeAnnUsageHeatmapViewModel;
  levelComparison: NgeeAnnLevelComparisonViewModel;
  componentCategoryBreakdown: NgeeAnnComponentCategoryBreakdownViewModel;
  energyComposition: NgeeAnnEnergyCompositionViewModel;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    projectRelease: string;
    queryIds: string[];
    references: Array<{
      id: string;
      metricId: string;
      queryIds: string[];
      queryReceiptId?: string;
    }>;
    importBatchCount: number;
    metadataStatus: string;
    comparison: {
      status: "available" | "unavailable";
      from: string;
      to: string;
      range: string;
      currentUsageKwh: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
      queryIds: string[];
      referenceIds: string[];
    };
    cost:
      | {
        status: "available";
        amount: string;
        currency: string;
        tariffScheduleVersion: string;
        allocations: Array<{
          from: string;
          to: string;
          range: string;
          ratePerKwh: string;
          displayRate?: string;
          rateBasis?: "tax_inclusive" | "tax_exclusive";
          tax?: { name: string; ratePct: string };
          taxInclusiveRatePerKwh?: string;
          taxExclusiveRatePerKwh?: string;
          usageKwh: string;
          cost: string;
        }>;
        queryIds: string[];
        referenceIds: string[];
      }
      | {
        status: "unavailable";
        reason: string;
        tariffScheduleVersion: string | null;
        allocations: [];
        queryIds: string[];
        referenceIds: string[];
      };
  };
  latestAvailableRange: NgeeAnnLatestAvailableRange | null;
};

function snapshotForReportWindow(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  windowId: string,
): EnergyProjectAnalysisSnapshotDto {
  if (snapshot.reportWindowAnalyses === undefined) return snapshot;
  const window = snapshot.reportWindowAnalyses?.find((candidate) => (
    candidate.windowId === windowId && candidate.status === "ready"
  ));
  const declaredWindow = snapshot.reportTimeContext?.windows.find((candidate) => (
    candidate.windowId === windowId
  ));
  const period = window?.period ?? (declaredWindow ? {
    start: declaredWindow.from,
    endExclusive: declaredWindow.toExclusive,
  } : snapshot.context.primaryPeriod);

  // Period-derived facts from the primary Report Edition must not be relabelled as
  // window Evidence. Each supported block is rebuilt from its bounded projection.
  const {
    dailyTotals: _primaryDailyTotals,
    timeBehaviour: _primaryTimeBehaviour,
    componentHourlyProfiles: _primaryComponentHourlyProfiles,
    dailyUsageAnomalies: _primaryDailyUsageAnomalies,
    componentCategoryBreakdown: _primaryComponentCategoryBreakdown,
    categories: _primaryCategories,
    circuits: _primaryCircuits,
    designatedTotals: _primaryDesignatedTotals,
    virtualMeterTraces: _primaryVirtualMeterTraces,
    ...analysis
  } = snapshot.analysis;
  const composition = window?.analysis.composition;
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      period: "Custom",
      from: period.start,
      to: period.endExclusive,
      primaryPeriod: period,
    },
    analysis: {
      ...analysis,
      summary: window?.analysis.summary ?? snapshot.analysis.summary,
      offHours: window?.analysis.offHours ?? {
        status: "unavailable",
        reason: {
          code: "OPERATING_FACTS_UNAVAILABLE",
          message: "The selected report window does not include operating-policy facts.",
        },
      },
      ...(window?.analysis.dailyTotals ? { dailyTotals: window.analysis.dailyTotals } : {}),
      ...(window?.analysis.timeBehaviour ? { timeBehaviour: window.analysis.timeBehaviour } : {}),
      ...(window?.analysis.componentHourlyProfiles
        ? { componentHourlyProfiles: window.analysis.componentHourlyProfiles }
        : {}),
      categories: composition?.categories ?? [],
      circuits: composition?.circuits ?? [],
      designatedTotals: composition?.designatedTotals ?? [],
      ...(composition?.virtualMeterTraces
        ? { virtualMeterTraces: composition.virtualMeterTraces }
        : {}),
      ...(composition ? {
        provenance: composition.provenance,
        comparison: composition.comparison,
        childScopes: composition.childScopes,
        componentReconciliation: composition.componentReconciliation,
      } : {}),
    },
  };
}

function buildMonthlyContext(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  unavailable: boolean,
): NgeeAnnMonthlyContextViewModel {
  const context = snapshot.reportTimeContext;
  const timezone = context?.timezone ?? snapshot.context.timezone;
  const currentWindow = context?.windows.find((window) => window.windowId === "current-month-progress");
  const currentWindowProjection = snapshot.reportWindowAnalyses?.find((window) => (
    window.windowId === "current-month-progress" && window.status === "ready"
  ));
  const primaryPeriodMatchesCurrentWindow = Boolean(currentWindow
    && snapshot.context.primaryPeriod.start === currentWindow.from
    && snapshot.context.primaryPeriod.endExclusive === currentWindow.toExclusive);
  const currentSummary = currentWindowProjection?.analysis.summary
    ?? (primaryPeriodMatchesCurrentWindow ? snapshot.analysis.summary : null);
  const currentUsageKwhValue = !unavailable && currentWindow && currentSummary
    ? currentSummary.usageKwh
    : null;
  const currentAverageDailyUsageKwh = !unavailable && currentWindow && currentSummary
    ? currentSummary.averageDailyUsageKwh
    : null;
  const currentFrom = currentWindow?.from ?? snapshot.context.primaryPeriod.start;
  const currentTo = currentWindow?.toExclusive ?? snapshot.context.primaryPeriod.endExclusive;
  const currentCompleteDayCount = currentWindow?.completeDayCount ?? 0;
  const completedMonths = monthlySegments(snapshot, "completed-month-trend", timezone);
  const sameProgressRows = monthlySegments(snapshot, "same-progress-comparison", timezone);
  const reference = [...sameProgressRows]
    .reverse()
    .find((row) => row.dataStatus === "complete"
      && row.completeDayCount === currentCompleteDayCount
      && row.usageKwhValue !== null);
  const comparable = currentUsageKwhValue !== null
    && currentCompleteDayCount > 0
    && reference?.usageKwhValue !== null
    && reference?.usageKwhValue !== undefined;
  const delta = comparable ? currentUsageKwhValue - reference.usageKwhValue! : null;
  const deltaPct = comparable && reference.usageKwhValue! !== 0
    ? delta! / reference.usageKwhValue! * 100
    : null;
  const direction = delta === null
    ? "unavailable" as const
    : Math.abs(delta) < 0.0001
      ? "flat" as const
      : delta > 0
        ? "increase" as const
        : "decrease" as const;
  const currentLabel = formatMonthLabel(currentFrom, timezone);
  const referenceLabel = reference
    ? `${reference.label} · first ${reference.completeDayCount} days`
    : null;
  const headline = comparable && reference
    ? direction === "flat"
      ? `${currentLabel} through day ${currentCompleteDayCount} is level with ${reference.label} at the same progress.`
      : `${currentLabel} through day ${currentCompleteDayCount} used ${formatCustomerDecimal(Math.abs(deltaPct ?? 0), 1)}% ${direction === "increase" ? "more" : "less"} than ${reference.label} at the same ${currentCompleteDayCount}-day progress.`
    : "A complete historical month at the same progress is not available for a fair comparison.";

  return {
    status: currentUsageKwhValue !== null && currentWindow ? "available" : "unavailable",
    current: {
      label: currentLabel,
      range: formatPeriodRange(currentFrom, currentTo, timezone),
      phase: currentWindow?.phase === "complete" ? "complete" : "partial",
      completeDayCount: currentCompleteDayCount,
      usageKwhValue: currentUsageKwhValue,
      usageKwh: currentUsageKwhValue === null ? null : formatCustomerDecimal(currentUsageKwhValue, 1),
      averageDailyUsageKwh: currentAverageDailyUsageKwh === null
        ? null
        : formatCustomerDecimal(currentAverageDailyUsageKwh, 1),
    },
    sameProgress: {
      status: comparable ? "available" : "unavailable",
      headline,
      referenceLabel,
      deltaKwh: delta === null ? null : formatCustomerDecimal(Math.abs(delta), 1),
      deltaPct: deltaPct === null ? null : signedDisplayPercent(deltaPct, "Unavailable"),
      direction,
      rows: sameProgressRows,
    },
    completedMonths: { rows: completedMonths },
  };
}

function monthlySegments(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  windowId: "completed-month-trend" | "same-progress-comparison",
  timezone: string,
): NgeeAnnMonthlyContextSegmentViewModel[] {
  const segments = snapshot.reportWindowSegmentSummaries
    ?.find((window) => window.windowId === windowId)?.segments ?? [];
  return segments.map((segment) => ({
    label: formatMonthLabel(segment.period.start, timezone),
    range: formatPeriodRange(segment.period.start, segment.period.endExclusive, timezone),
    dataStatus: segment.dataStatus,
    expectedDayCount: segment.expectedDayCount,
    completeDayCount: segment.completeDayCount,
    usageKwhValue: segment.summary?.usageKwh ?? null,
    usageKwh: segment.summary ? formatCustomerDecimal(segment.summary.usageKwh, 1) : null,
    averageDailyUsageKwh: segment.summary
      ? formatCustomerDecimal(segment.summary.averageDailyUsageKwh, 1)
      : null,
    evidence: { ...segment.evidence },
  }));
}

function formatMonthLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}

export function buildNgeeAnnOverviewViewModel(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  hint: {
    latestAvailableRange?: NgeeAnnLatestAvailableRange | null;
    trendGrain?: "day" | "hour";
  } = {},
): NgeeAnnOverviewViewModel {
  const { analysis, context, dataQuality } = snapshot;
  const hasTrustedIntervals = dataQuality.validIntervalCount > 0;
  const status = resolveDataStatus(dataQuality.status, hasTrustedIntervals);
  const unavailable = status === "unavailable";
  const comparisonAvailable = !unavailable && analysis.comparison.changePct !== null;
  const costAvailable = !unavailable && analysis.cost.status === "available";
  const latestSeenAt = snapshot.dataSnapshot.lastSeenAt
    ?? dataQuality.lastSeenAt
    ?? null;

  const latestAvailableRange = unavailable ? hint.latestAvailableRange ?? null : null;
  const evidenceQueryIds = [...analysis.provenance.queryIds];
  const comparisonReferenceIds = comparisonEvidenceReferences(snapshot);
  const reportEditionDailyAnomalies = buildDailyAnomalies(snapshot, unavailable);
  const levelComparison = buildLevelComparison(snapshot, unavailable);
  const componentCategoryBreakdown = buildComponentCategoryBreakdown(snapshot, unavailable);
  const recentOperationsSnapshot = snapshotForReportWindow(snapshot, "recent-operations");
  const dayTypeReferenceSnapshot = snapshotForReportWindow(snapshot, "day-type-reference");
  const recentOperationsDailyAnomalies = buildDailyAnomalies(
    recentOperationsSnapshot,
    unavailable,
  );
  const recentOperationsEnergyTrend = buildEnergyTrend(
    recentOperationsSnapshot,
    unavailable,
    hint.trendGrain,
  );
  const recentOperationsEnergyComposition = buildEnergyComposition(
    recentOperationsSnapshot,
    unavailable,
  );
  const executiveSummary = buildExecutiveSummary(
    snapshot,
    comparisonAvailable,
    unavailable,
    levelComparison,
    reportEditionDailyAnomalies,
  );

  return {
    context: {
      projectName: context.projectName,
      scopeName: context.scopeName,
      scopeType: context.scopeType,
      period: context.period ?? "Custom",
      periodRange: formatPeriodRange(
        context.primaryPeriod.start,
        context.primaryPeriod.endExclusive,
        context.timezone,
      ),
      timezone: context.timezone,
    },
    dataStatus: buildDataStatus(snapshot, status, latestSeenAt, Boolean(latestAvailableRange)),
    metadataLimitation: buildMetadataLimitation(snapshot),
    executiveSummary,
    monthlyContext: buildMonthlyContext(snapshot, unavailable),
    changeOverTime: buildChangeOverTimeSummary(
      recentOperationsEnergyTrend,
      recentOperationsDailyAnomalies,
    ),
    highlights: [
      {
        id: "total",
        label: "Total Consumption",
        value: unavailable ? "Unavailable" : formatCustomerDecimal(analysis.summary.usageKwh, 2),
        unit: unavailable ? undefined : "kWh",
        detail: comparisonAvailable
          ? `Previous period: ${formatCustomerDecimal(analysis.comparison.usageKwh, 2)} kWh`
          : "Total electricity used in the selected Scope",
        available: !unavailable,
        comparison: comparisonAvailable ? {
          label: `${analysis.comparison.changePct! >= 0 ? "+" : ""}${formatCustomerDecimal(analysis.comparison.changePct!, 1)}% vs previous`,
          direction: analysis.comparison.changePct! > 0
            ? "increase"
            : analysis.comparison.changePct! < 0
              ? "decrease"
              : "flat",
        } : null,
      },
      {
        id: "daily",
        label: "Daily Average",
        value: unavailable ? "Unavailable" : formatCustomerDecimal(analysis.summary.averageDailyUsageKwh, 2),
        unit: unavailable ? undefined : "kWh/day",
        detail: "Average electricity used per day in this Overview window",
        available: !unavailable,
        comparison: comparisonAvailable ? {
          label: `${analysis.comparison.changePct! >= 0 ? "+" : ""}${formatCustomerDecimal(analysis.comparison.changePct!, 1)}% vs previous`,
          direction: analysis.comparison.changePct! > 0
            ? "increase"
            : analysis.comparison.changePct! < 0
              ? "decrease"
              : "flat",
        } : null,
      },
      {
        id: "peak",
        label: `Peak ${analysis.units.intervalMinutes}-min Average Power`,
        value: unavailable ? "Unavailable" : formatCustomerDecimal(analysis.summary.peakKw, 2),
        unit: unavailable ? undefined : "kW",
        detail: unavailable
          ? "No accepted interval supports a peak"
          : analysis.summary.peakAt
            ? `Observed ${formatTimestamp(analysis.summary.peakAt, context.timezone)}`
            : `${analysis.units.intervalMinutes}-minute interval average`,
        available: !unavailable,
        comparison: null,
      },
      {
        id: "cost",
        label: "Estimated Cost",
        value: analysis.cost.status === "available" && !unavailable
          ? `${analysis.cost.currency === "SGD" ? "S$" : `${analysis.cost.currency} `}${formatCustomerDecimal(analysis.cost.amount, 2)}`
          : "Unavailable",
        detail: analysis.cost.status === "available" && !unavailable
          ? formatTariffDetail(analysis.cost.allocations)
          : analysis.cost.status === "unavailable"
            ? analysis.cost.reason.message
            : "No effective Tariff",
        available: costAvailable,
        comparison: null,
      },
    ],
    decisionPriorities: buildDecisionPriorities(snapshot, reportEditionDailyAnomalies),
    peakBreakdown: buildPeakBreakdown(snapshot, unavailable),
    energyTrend: recentOperationsEnergyTrend,
    dailyAnomalies: recentOperationsDailyAnomalies,
    dayProfile: buildDayProfile(dayTypeReferenceSnapshot, unavailable, recentOperationsSnapshot),
    usageHeatmap: buildUsageHeatmap(recentOperationsSnapshot, unavailable),
    levelComparison,
    componentCategoryBreakdown,
    energyComposition: recentOperationsEnergyComposition,
    evidence: {
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      projectRelease: snapshot.projectRelease.templateRevisionSequence === null
        ? snapshot.projectRelease.id
        : `Revision ${snapshot.projectRelease.templateRevisionSequence}`,
      queryIds: evidenceQueryIds,
      references: snapshot.evidence.map((item) => ({
        id: item.id,
        metricId: item.metricId,
        queryIds: [...item.queryIds],
        ...(item.queryReceiptId ? { queryReceiptId: item.queryReceiptId } : {}),
      })),
      importBatchCount: snapshot.dataSnapshot.importBatchIds.length,
      metadataStatus: snapshot.metadata.status,
      comparison: {
        status: comparisonAvailable ? "available" : "unavailable",
        from: analysis.comparison.from,
        to: analysis.comparison.to,
        range: formatEvidenceRange(
          analysis.comparison.from,
          analysis.comparison.to,
          context.timezone,
        ),
        currentUsageKwh: formatDecimal(analysis.summary.usageKwh, 4),
        previousUsageKwh: formatDecimal(analysis.comparison.usageKwh, 4),
        changeKwh: signedDecimal(analysis.comparison.changeKwh, 4),
        changePct: analysis.comparison.changePct === null
          ? "Unavailable"
          : `${analysis.comparison.changePct >= 0 ? "+" : ""}${formatDecimal(analysis.comparison.changePct, 4)}%`,
        queryIds: evidenceQueryIds,
        referenceIds: comparisonReferenceIds,
      },
      cost: analysis.cost.status === "available" && !unavailable
        ? {
          status: "available",
          amount: formatDecimal(analysis.cost.amount, 6),
          currency: analysis.cost.currency,
          tariffScheduleVersion: analysis.cost.tariffScheduleVersion,
          allocations: analysis.cost.allocations.map((allocation) => ({
            from: allocation.from,
            to: allocation.to,
            range: formatEvidenceRange(allocation.from, allocation.to, context.timezone),
            ratePerKwh: formatDecimal(allocation.ratePerKwh, 6),
            ...(allocation.tax
              && allocation.taxInclusiveRatePerKwh !== undefined
              && allocation.taxExclusiveRatePerKwh !== undefined
              ? { displayRate: formatConfiguredTaxRates(allocation) }
              : {}),
            ...(allocation.rateBasis ? {
              rateBasis: allocation.rateBasis,
              tax: allocation.tax
                ? { name: allocation.tax.name, ratePct: formatDecimal(allocation.tax.ratePct, 6) }
                : undefined,
              taxInclusiveRatePerKwh: allocation.taxInclusiveRatePerKwh === undefined
                ? undefined
                : formatDecimal(allocation.taxInclusiveRatePerKwh, 6),
              taxExclusiveRatePerKwh: allocation.taxExclusiveRatePerKwh === undefined
                ? undefined
                : formatDecimal(allocation.taxExclusiveRatePerKwh, 6),
            } : {}),
            usageKwh: formatDecimal(allocation.usageKwh, 6),
            cost: formatDecimal(allocation.cost, 6),
          })),
          queryIds: evidenceQueryIds,
          referenceIds: [],
        }
        : {
          status: "unavailable",
          reason: unavailable
            ? "No trusted intervals support a Cost for this Period."
            : analysis.cost.status === "unavailable"
              ? analysis.cost.reason.message
              : "No effective Tariff covers this Period.",
          tariffScheduleVersion: analysis.cost.tariffScheduleVersion ?? null,
          allocations: [],
          queryIds: evidenceQueryIds,
          referenceIds: [],
        },
    },
    latestAvailableRange,
  };
}

function buildComponentCategoryBreakdown(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnComponentCategoryBreakdownViewModel {
  const source = snapshot.analysis.componentCategoryBreakdown;
  const evidence: NgeeAnnComponentCategoryBreakdownViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    queryId: "daily_component_categories_v1",
    accountingBasis: "published_component_circuits",
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    timezone: snapshot.context.timezone,
  };
  const unavailable = (reason: string): NgeeAnnComponentCategoryBreakdownViewModel => ({
    status: "unavailable",
    reason,
    decisionQuestion: "How did published component Circuit usage change day by day?",
    categories: [],
    scopes: [],
    rankings: [],
    evidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support the component breakdown for this Period.");
  }
  if (
    !source
    || source.metricId !== "energy.total_usage_kwh@1"
    || source.queryId !== "daily_component_categories_v1"
    || source.accountingBasis !== "published_component_circuits"
    || source.grain !== "day"
    || source.timezone !== snapshot.context.timezone
  ) {
    return unavailable("This Snapshot does not include the release-pinned daily component Category contract.");
  }
  const dailyTotalsByScope = new Map(
    (snapshot.analysis.dailyTotals?.scopes ?? []).map((scope) => [scope.scopeId, scope]),
  );
  const projectScope = source.scopes.find((scope) => scope.scopeId === snapshot.context.scopeId);
  const contractValid = Boolean(projectScope)
    && source.scopes.length > 0
    && source.scopes.length === dailyTotalsByScope.size
    && source.scopes.every((scope) => {
      const dailyScope = dailyTotalsByScope.get(scope.scopeId);
      if (
        !dailyScope
        || scope.scopeName !== dailyScope.scopeName
        || scope.scopeType !== dailyScope.scopeType
        || scope.rows.length === 0
        || scope.period.categories.length === 0
      ) return false;
      const commonShapeValid = dailyScope.rows.length === scope.rows.length
        && dailyScope.rows.every((dailyRow, index) => {
          const row = scope.rows[index];
          return row?.localDate === dailyRow.localDate
            && row.from === dailyRow.from
            && row.to === dailyRow.to;
        })
        && scope.rows.every((row) =>
          row.categories.length === scope.period.categories.length
          && row.categories.every((category) =>
            scope.period.categories.some((periodCategory) => periodCategory.category === category.category)
          )
        );
      if (!commonShapeValid) return false;
      if (scope.period.status === "complete") {
        if (
          scope.period.officialUsageKwh === null
          || scope.period.componentUsageKwh === null
          || scope.period.gapKwh === null
          || scope.period.categories.some((category) => category.usageKwh === null || category.sharePct === null)
          || scope.rows.some((row) =>
            row.dataHealth.status !== "complete"
            || row.officialUsageKwh === null
            || row.componentUsageKwh === null
            || row.categories.some((category) => category.usageKwh === null)
          )
        ) return false;
        const officialFromRows = scope.rows.reduce((sum, row) => sum + (row.officialUsageKwh as number), 0);
        const componentFromRows = scope.rows.reduce((sum, row) => sum + (row.componentUsageKwh as number), 0);
        const categoryTotal = scope.period.categories.reduce((sum, category) => sum + (category.usageKwh as number), 0);
        return Math.abs(officialFromRows - scope.period.officialUsageKwh) <= 0.1
          && Math.abs(componentFromRows - scope.period.componentUsageKwh) <= 0.1
          && Math.abs(categoryTotal - scope.period.componentUsageKwh) <= 0.1;
      }
      const aggregatesWithheld = scope.period.officialUsageKwh === null
        && scope.period.componentUsageKwh === null
        && scope.period.gapKwh === null
        && scope.period.ratioPct === null
        && scope.period.categories.every((category) => category.usageKwh === null && category.sharePct === null);
      const hasUsableFacts = scope.rows.some((row) =>
        row.officialUsageKwh !== null || row.categories.some((category) => category.usageKwh !== null),
      );
      return aggregatesWithheld
        && scope.rows.some((row) => row.dataHealth.status !== "complete")
        && (scope.period.status === "partial" ? hasUsableFacts : !hasUsableFacts);
    });
  if (!contractValid || !projectScope) {
    return unavailable("The daily component Category rows do not reconcile with their Snapshot totals and date spine.");
  }
  const categories = projectScope.period.categories.map((category) => ({
    id: category.category,
    label: compositionCategoryName(category.category),
  }));
  const categoryLabel = new Map(categories.map((category) => [category.id, category.label]));
  const scopes = source.scopes.map((scope) => ({
    id: scope.scopeId,
    name: scope.scopeName,
    type: scope.scopeType,
    period: {
      status: scope.period.status,
      reason: scope.period.reason,
      officialUsageKwhValue: scope.period.officialUsageKwh,
      officialUsageKwh: scope.period.officialUsageKwh === null
        ? "Unavailable"
        : formatCustomerDecimal(scope.period.officialUsageKwh, 1),
      componentUsageKwhValue: scope.period.componentUsageKwh,
      componentUsageKwh: scope.period.componentUsageKwh === null
        ? "Unavailable"
        : formatCustomerDecimal(scope.period.componentUsageKwh, 1),
      gapKwh: scope.period.gapKwh === null ? "Unavailable" : signedDecimal(scope.period.gapKwh, 1),
      ratioPct: scope.period.ratioPct === null
        ? "Unavailable"
        : `${formatCustomerDecimal(scope.period.ratioPct, 1)}%`,
      categories: scope.period.categories.map((category) => ({
        id: category.category,
        label: categoryLabel.get(category.category) ?? compositionCategoryName(category.category),
        usageKwhValue: category.usageKwh,
        usageKwh: category.usageKwh === null
          ? "Unavailable"
          : formatCustomerDecimal(category.usageKwh, 1),
        sharePctValue: category.sharePct,
        sharePct: category.sharePct === null
          ? "Unavailable"
          : `${formatCustomerDecimal(category.sharePct, 1)}%`,
      })),
    },
    rows: scope.rows.map((row) => ({
      id: `${scope.scopeId}:${row.localDate}`,
      localDate: row.localDate,
      dateLabel: formatLocalDate(row.localDate),
      dayType: row.dayType,
      dayTypeLabel: row.dayType === "public_holiday"
        ? "Public holiday"
        : row.dayType === "weekend"
          ? "Weekend"
          : row.dayType === "weekday"
            ? "Weekday"
            : "Day type unavailable",
      officialUsageKwhValue: row.officialUsageKwh,
      officialUsageKwh: row.officialUsageKwh === null
        ? "Unavailable"
        : formatCustomerDecimal(row.officialUsageKwh, 1),
      componentUsageKwhValue: row.componentUsageKwh,
      componentUsageKwh: row.componentUsageKwh === null
        ? "Unavailable"
        : formatCustomerDecimal(row.componentUsageKwh, 1),
      categories: row.categories.map((category) => ({
        id: category.category,
        label: categoryLabel.get(category.category) ?? compositionCategoryName(category.category),
        usageKwhValue: category.usageKwh,
        usageKwh: category.usageKwh === null
          ? "Unavailable"
          : formatCustomerDecimal(category.usageKwh, 1),
        sharePctValue: category.sharePct,
        sharePct: category.sharePct === null
          ? "Unavailable"
          : `${formatCustomerDecimal(category.sharePct, 1)}%`,
      })),
      estimatedCost: row.estimatedCost.status === "available"
        ? {
          status: "available" as const,
          amountValue: row.estimatedCost.amount,
          amount: `${row.estimatedCost.currency === "SGD" ? "S$" : `${row.estimatedCost.currency} `}${formatCustomerDecimal(row.estimatedCost.amount, 2)}`,
          currency: row.estimatedCost.currency,
          ratePerKwh: formatDecimal(row.estimatedCost.ratePerKwh, 6),
          tariffScheduleVersion: row.estimatedCost.tariffScheduleVersion,
        }
        : {
          status: "unavailable" as const,
          reason: row.estimatedCost.reason,
        },
      dataStatus: row.dataHealth.status,
      coverage: `${formatCustomerDecimal(row.dataHealth.coveragePct, 1)}%`,
    })),
  }));
  const levelNames = new Map(
    snapshot.analysis.childScopes.map((scope) => [scope.nodeId, scope.name]),
  );
  const componentCircuits = snapshot.analysis.circuits
    .filter((circuit) => circuit.includedInOfficialTotal === false && Boolean(circuit.parentScopeId))
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const rankings = scopes.flatMap((scope) => ["all", ...categories.map((category) => category.id)].map((categoryId) => ({
    scopeId: scope.id,
    categoryId,
    rows: componentCircuits
      .filter((circuit) =>
        (scope.id === snapshot.context.scopeId || circuit.parentScopeId === scope.id)
        && (categoryId === "all" || circuit.category === categoryId)
      )
      .map((circuit, index) => ({
        rank: index + 1,
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        levelName: levelNames.get(circuit.parentScopeId!) ?? circuit.parentScopeId!,
        categoryId: circuit.category,
        category: categoryLabel.get(circuit.category) ?? compositionCategoryName(circuit.category),
        usageKwhValue: circuit.usageKwh,
        usageKwh: formatCustomerDecimal(circuit.usageKwh, 1),
        projectShare: `${formatCustomerDecimal(circuit.sharePct, 1)}%`,
      })),
  })));
  return {
    status: projectScope.period.status === "complete" ? "available" : projectScope.period.status,
    reason: projectScope.period.reason,
    decisionQuestion: "How did published component Circuit usage change day by day?",
    categories,
    scopes,
    rankings,
    evidence,
  };
}

function buildEnergyComposition(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnEnergyCompositionViewModel {
  const analysis = snapshot.analysis;
  const evidence: NgeeAnnEnergyCompositionViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    queryIds: [...analysis.provenance.queryIds],
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    unit: "kWh",
  };
  const unavailableReason = overviewUnavailable
    ? "No trusted intervals support energy composition for this Period."
    : snapshot.context.scopeType !== "project"
      ? "Select the Project Scope to explain the official Project total."
      : null;
  const levelNames = new Map(
    analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => [scope.nodeId, scope.name]),
  );

  const expectedCategories = new Set(["load", "light"]);
  const categoryContractAvailable = hasEnergyCategoryContract(snapshot, overviewUnavailable);
  const categories: NgeeAnnEnergyCompositionViewModel["categories"] = categoryContractAvailable
    ? {
      status: "available",
      reason: null,
      summary: buildContributorSummary(
        analysis.categories.map((category) => ({
          name: compositionCategoryName(category.category),
          usageKwh: category.usageKwh,
          sharePct: category.sharePct,
          comparison: category.comparison,
        })),
        analysis.comparison.changeKwh,
        "Category",
      ),
      rows: analysis.categories.map((category) => ({
        id: category.category,
        name: compositionCategoryName(category.category),
        currentUsageKwh: formatDecimal(category.usageKwh, 2),
        projectShare: `${formatDecimal(category.sharePct, 1)}%`,
        previousUsageKwh: category.comparison ? formatDecimal(category.comparison.usageKwh, 2) : "Unavailable",
        changeKwh: category.comparison ? `${signedDecimal(category.comparison.changeKwh, 2)} kWh` : "Unavailable",
        changePct: category.comparison ? signedDisplayPercent(category.comparison.changePct, "Rate unavailable") : "Unavailable",
        movement: movementAvailability(category.comparison, "Category comparison is unavailable for this published Snapshot."),
        quality: compositionQuality(category.dataHealth!),
        exact: {
          currentUsageKwh: formatDecimal(category.usageKwh, 4),
          projectShare: `${formatDecimal(category.sharePct, 4)}%`,
          previousUsageKwh: category.comparison ? formatDecimal(category.comparison.usageKwh, 4) : "Unavailable",
          changeKwh: category.comparison ? `${signedDecimal(category.comparison.changeKwh, 4)} kWh` : "Unavailable",
          changePct: !category.comparison
            ? "Unavailable"
            : category.comparison.changePct === null
            ? "Rate unavailable"
            : `${category.comparison.changePct >= 0 ? "+" : ""}${formatDecimal(category.comparison.changePct, 4)}%`,
        },
      })),
    }
    : {
      status: "unavailable",
      reason: unavailableReason
        ?? "This published Snapshot does not include complete official Load and Light current facts and quality.",
      summary: unavailableContributorSummary(
        unavailableReason ?? "Current Category concentration is unavailable for this published Snapshot.",
      ),
      rows: [],
    };

  const designatedTotals = analysis.designatedTotals ?? [];
  const reconciliation = analysis.componentReconciliation;
  const officialMeterIds = new Set(reconciliation?.officialMeterNodeIds ?? []);
  const componentMeterNodeIds = reconciliation?.componentMeterNodeIds ?? [];
  const componentMeterIds = new Set(componentMeterNodeIds);
  const explanatoryCircuits = analysis.circuits.filter((circuit) =>
    circuit.includedInOfficialTotal === false,
  );
  const componentCircuits = analysis.circuits.filter((circuit) =>
    componentMeterIds.has(circuit.meterNodeId),
  );
  const circuitContractAvailable = unavailableReason === null
    && componentMeterIds.size > 0
    && componentMeterIds.size === componentMeterNodeIds.length
    && componentCircuits.length === componentMeterIds.size
    && componentCircuits.length === explanatoryCircuits.length
    && componentCircuits.every((circuit) =>
      circuit.includedInOfficialTotal === false
      && Boolean(circuit.scopeId)
      && Boolean(circuit.parentScopeId)
      && levelNames.has(circuit.parentScopeId!)
      && expectedCategories.has(circuit.category)
      && hasDataHealth(circuit),
    );
  const circuits: NgeeAnnEnergyCompositionViewModel["circuits"] = circuitContractAvailable
    ? {
      status: "available",
      reason: null,
      rows: componentCircuits.map((circuit, index) => ({
        rank: index + 1,
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        scopeId: circuit.scopeId!,
        parentScopeId: circuit.parentScopeId!,
        levelId: circuit.parentScopeId!,
        levelName: levelNames.get(circuit.parentScopeId!)!,
        categoryId: circuit.category,
        category: compositionCategoryName(circuit.category),
        currentUsageKwh: formatDecimal(circuit.usageKwh, 2),
        projectShare: `${formatDecimal(circuit.sharePct, 1)}%`,
        previousUsageKwh: circuit.comparison ? formatDecimal(circuit.comparison.usageKwh, 2) : "Unavailable",
        changeKwh: circuit.comparison ? `${signedDecimal(circuit.comparison.changeKwh, 2)} kWh` : "Unavailable",
        changePct: circuit.comparison ? signedDisplayPercent(circuit.comparison.changePct, "Rate unavailable") : "Unavailable",
        movement: movementAvailability(circuit.comparison, "Circuit comparison is unavailable for this published Snapshot."),
        includedInOfficialTotal: false,
        quality: compositionQuality(circuit.dataHealth!),
        exact: {
          currentUsageKwh: formatDecimal(circuit.usageKwh, 4),
          projectShare: `${formatDecimal(circuit.sharePct, 4)}%`,
          previousUsageKwh: circuit.comparison ? formatDecimal(circuit.comparison.usageKwh, 4) : "Unavailable",
          changeKwh: circuit.comparison ? `${signedDecimal(circuit.comparison.changeKwh, 4)} kWh` : "Unavailable",
          changePct: !circuit.comparison
            ? "Unavailable"
            : circuit.comparison.changePct === null
            ? "Rate unavailable"
            : `${circuit.comparison.changePct >= 0 ? "+" : ""}${formatDecimal(circuit.comparison.changePct, 4)}%`,
        },
      })),
    }
    : {
      status: "unavailable",
      reason: unavailableReason
        ?? "This published Snapshot does not explicitly identify the complete component Circuit set, Scopes, parents, categories, official-total markers and quality.",
      rows: [],
    };

  const accountingContractAvailable = unavailableReason === null
    && designatedTotals.length === 4
    && Boolean(reconciliation)
    && reconciliation!.ratioPct !== null
    && officialMeterIds.size === designatedTotals.length
    && componentMeterIds.size === componentMeterNodeIds.length
    && componentMeterIds.size === componentCircuits.length
    && componentCircuits.length === explanatoryCircuits.length
    && designatedTotals.every((circuit) =>
      circuit.includedInOfficialTotal === true
      && Boolean(circuit.scopeId)
      && Boolean(circuit.parentScopeId)
      && levelNames.has(circuit.parentScopeId!)
      && Boolean(circuit.dataHealth)
      && officialMeterIds.has(circuit.meterNodeId)
      && !componentMeterIds.has(circuit.meterNodeId),
    )
    && componentCircuits.every((circuit) =>
      componentMeterIds.has(circuit.meterNodeId)
      && !officialMeterIds.has(circuit.meterNodeId),
    );
  const accounting: NgeeAnnEnergyCompositionViewModel["accounting"] = accountingContractAvailable
    ? {
      status: "available",
      reason: null,
      designatedTotals: designatedTotals.map((circuit) => ({
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        scopeId: circuit.scopeId!,
        parentScopeId: circuit.parentScopeId!,
        levelName: levelNames.get(circuit.parentScopeId!)!,
        category: compositionCategoryName(circuit.category),
        currentUsageKwh: formatDecimal(circuit.usageKwh, 4),
        includedInOfficialTotal: true,
        quality: compositionQuality(circuit.dataHealth!),
      })),
      reconciliation: {
        officialUsageKwh: formatDecimal(reconciliation!.officialUsageKwh, 4),
        componentUsageKwh: formatDecimal(reconciliation!.componentUsageKwh, 4),
        gapKwh: formatDecimal(reconciliation!.gapKwh, 4),
        ratioPct: `${formatDecimal(reconciliation!.ratioPct!, 4)}%`,
        officialMeterCount: reconciliation!.officialMeterNodeIds.length,
        componentMeterCount: reconciliation!.componentMeterNodeIds.length,
      },
    }
    : {
      status: "unavailable",
      reason: unavailableReason
        ?? "This published Snapshot does not include an explicit, non-overlapping designated-total and component reconciliation contract.",
      designatedTotals: [],
      reconciliation: null,
    };
  const derivedMeterTrace = buildDerivedMeterTrace(analysis, unavailableReason, levelNames);

  return {
    decisionQuestion: "What explains the official Project total?",
    categories,
    circuits,
    accounting,
    derivedMeterTrace,
    evidence,
  };
}

function hasEnergyCategoryContract(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): boolean {
  if (overviewUnavailable || snapshot.context.scopeType !== "project") return false;
  const expectedCategories = new Set(["load", "light"]);
  return snapshot.analysis.categories.length === expectedCategories.size
    && snapshot.analysis.categories.every((category) => (
      expectedCategories.has(category.category) && hasDataHealth(category)
    ));
}

function buildDerivedMeterTrace(
  analysis: EnergyProjectAnalysisSnapshotDto["analysis"],
  unavailableReason: string | null,
  levelNames: Map<string, string>,
): NgeeAnnEnergyCompositionViewModel["derivedMeterTrace"] {
  const unavailable = (reason: string): NgeeAnnEnergyCompositionViewModel["derivedMeterTrace"] => ({
    status: "unavailable",
    reason,
    meterNodeId: null,
    name: null,
    scopeId: null,
    scopeName: null,
    meterKind: null,
    resultUsageKwh: null,
    includedInOfficialTotal: null,
    terms: [],
    impactedInputs: [],
  });

  if (unavailableReason) return unavailable(unavailableReason);

  const traces = analysis.virtualMeterTraces;
  if (!traces) {
    return unavailable("This published Snapshot does not include the server-derived meter trace contract.");
  }

  const matchingTraces = traces.filter((trace) => trace.meterNodeId === "ngee-ann-load-12-v1");
  if (matchingTraces.length !== 1) {
    return unavailable("This published Snapshot does not identify one authoritative Load 12 trace.");
  }

  const trace = matchingTraces[0]!;
  const scopeName = levelNames.get(trace.scopeId);
  const termIds = trace.terms.map((term) => term.meterNodeId);
  const uniqueTermIds = new Set(termIds);
  const hasValidIdentities = Boolean(trace.name)
    && Boolean(trace.scopeId)
    && Boolean(scopeName)
    && trace.terms.length === 2
    && uniqueTermIds.size === trace.terms.length
    && trace.terms.every((term) =>
      Boolean(term.meterNodeId)
      && Boolean(term.name)
      && (term.coefficient === 1 || term.coefficient === -1),
    );

  if (trace.includedInOfficialTotal !== false || !hasValidIdentities) {
    return unavailable("The Load 12 trace is missing a unique identity, Level, term identity or exclusion marker.");
  }

  if (trace.status === "partial") {
    const missingTermIds = trace.missingTermMeterNodeIds;
    const uniqueMissingTermIds = new Set(missingTermIds);
    const missingTerms = trace.terms.filter((term) => uniqueMissingTermIds.has(term.meterNodeId));
    const hasValidMissingInputs = trace.usageKwh === null
      && missingTermIds.length > 0
      && uniqueMissingTermIds.size === missingTermIds.length
      && missingTermIds.every((meterNodeId) => uniqueTermIds.has(meterNodeId))
      && missingTerms.length === missingTermIds.length
      && missingTerms.every((term) =>
        term.inputUsageKwh === null
        && term.contributionKwh === null
        && term.dataHealth === null,
      );

    if (!hasValidMissingInputs) {
      return unavailable("The partial Load 12 trace does not identify every affected input.");
    }

    return {
      status: "partial",
      reason: "Derived result unavailable because required inputs are missing.",
      meterNodeId: trace.meterNodeId,
      name: trace.name,
      scopeId: trace.scopeId,
      scopeName: scopeName!,
      meterKind: "Derived",
      resultUsageKwh: null,
      includedInOfficialTotal: false,
      terms: [],
      impactedInputs: missingTerms.map((term) => ({
        meterNodeId: term.meterNodeId,
        name: term.name,
      })),
    };
  }

  const hasCompleteValues = trace.status === "available"
    && trace.missingTermMeterNodeIds.length === 0
    && trace.usageKwh !== null
    && Number.isFinite(trace.usageKwh)
    && trace.terms.every((term) =>
      term.inputUsageKwh !== null
      && Number.isFinite(term.inputUsageKwh)
      && term.contributionKwh !== null
      && Number.isFinite(term.contributionKwh)
      && Boolean(term.dataHealth),
    );

  if (!hasCompleteValues) {
    return unavailable("The authoritative Load 12 result, term values or data quality is incomplete.");
  }

  return {
    status: "available",
    reason: null,
    meterNodeId: trace.meterNodeId,
    name: trace.name,
    scopeId: trace.scopeId,
    scopeName: scopeName!,
    meterKind: "Derived",
    resultUsageKwh: formatDecimal(trace.usageKwh!, 4),
    includedInOfficialTotal: false,
    terms: trace.terms.map((term) => ({
      meterNodeId: term.meterNodeId,
      name: term.name,
      coefficient: signedDecimal(term.coefficient, 4),
      inputUsageKwh: formatDecimal(term.inputUsageKwh!, 4),
      contributionKwh: formatDecimal(term.contributionKwh!, 4),
      quality: compositionQuality(term.dataHealth!),
    })),
    impactedInputs: [],
  };
}

function hasDataHealth(value: {
  dataHealth?: unknown;
}): boolean {
  return Boolean(value.dataHealth);
}

function movementAvailability(
  comparison: { changePct: number | null } | undefined,
  unavailableReason: string,
): ContributorMovement {
  return comparison && comparison.changePct !== null
    ? { status: "available", reason: null }
    : { status: "unavailable", reason: unavailableReason };
}

function unavailableContributorSummary(reason: string): ContributorSummary {
  return {
    currentConcentration: {
      status: "unavailable",
      reason,
      name: null,
      currentUsageKwh: null,
      projectShare: null,
    },
    measuredChange: {
      status: "unavailable",
      reason,
      name: null,
      changeKwh: null,
      changePct: null,
    },
  };
}

function buildContributorSummary(
  rows: Array<{
    name: string;
    usageKwh: number;
    sharePct: number;
    comparison?: { changeKwh: number; changePct: number | null };
  }>,
  projectChangeKwh: number,
  dimension: "Level" | "Category",
): ContributorSummary {
  const current = [...rows].sort((left, right) => right.usageKwh - left.usageKwh)[0];
  const currentConcentration: ContributorSummary["currentConcentration"] = current
    ? {
      status: "available",
      reason: null,
      name: current.name,
      currentUsageKwh: formatDecimal(current.usageKwh, 2),
      projectShare: `${formatDecimal(current.sharePct, 1)}%`,
    }
    : {
      status: "unavailable",
      reason: `No current ${dimension} facts are available.`,
      name: null,
      currentUsageKwh: null,
      projectShare: null,
    };

  if (rows.length === 0 || rows.some((row) => !row.comparison || row.comparison.changePct === null)) {
    return {
      currentConcentration,
      measuredChange: {
        status: "unavailable",
        reason: `A complete ${dimension} comparison is unavailable for this published Snapshot.`,
        name: null,
        changeKwh: null,
        changePct: null,
      },
    };
  }

  const movement = selectDirectionalDriver(
    rows.map((row) => ({
      ...row,
      changeKwh: row.comparison!.changeKwh,
      changePct: row.comparison!.changePct,
    })),
    projectChangeKwh,
  );
  return {
    currentConcentration,
    measuredChange: movement
      ? {
        status: "available",
        reason: null,
        name: movement.name,
        changeKwh: `${signedDecimal(movement.changeKwh, 2)} kWh`,
        changePct: signedDisplayPercent(movement.changePct, "Rate unavailable"),
      }
      : {
        status: "unavailable",
        reason: `No ${dimension} movement aligns with the Project direction in the validated comparison.`,
        name: null,
        changeKwh: null,
        changePct: null,
      },
  };
}

function compositionCategoryName(category: string): string {
  if (category === "load") return "Load";
  if (category === "light") return "Light";
  return category;
}

function compositionQuality(quality: {
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): CompositionQuality {
  return {
    coverage: `${formatDecimal(quality.coveragePct, 1)}% coverage`,
    intervals: `${quality.validIntervalCount.toLocaleString("en-SG")} / ${quality.expectedMeterIntervalCount.toLocaleString("en-SG")}`,
    qualityEvents: `${quality.qualityEventCount.toLocaleString("en-SG")} quality events`,
  };
}

function buildPeakBreakdown(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnPeakBreakdownViewModel {
  const { analysis, context } = snapshot;
  const breakdown = analysis.peakBreakdown;
  const evidence: NgeeAnnPeakBreakdownViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.peak_demand_kw@1",
    period: `[${context.primaryPeriod.start}, ${context.primaryPeriod.endExclusive})`,
    timezone: context.timezone,
    unit: "kW",
    queryIds: ["peak_breakdown_v1"],
  };
  const unavailable = (reason: string): NgeeAnnPeakBreakdownViewModel => ({
    status: "unavailable",
    decisionQuestion: "Which Level drove the highest accepted 15-minute interval-average Project load?",
    reason,
    periodStatus: null,
    periodCoverage: null,
    peakLabel: "Peak breakdown unavailable",
    peakAt: null,
    peakInterval: null,
    averageKw: null,
    quality: null,
    levels: [],
    evidence,
  });

  if (overviewUnavailable) {
    return unavailable("No trusted intervals support a Peak breakdown for this Period.");
  }
  if (context.scopeType !== "project") {
    return unavailable("Select the Project Scope to inspect the Project Peak breakdown.");
  }
  if (!breakdown) {
    return unavailable("This published Snapshot does not include the Peak breakdown contract.");
  }
  if (breakdown.status === "unavailable") {
    return unavailable(breakdown.reason.message);
  }
  if (!validPeakEvidencePins(snapshot)) {
    return unavailable("The Peak Snapshot, Release or revision evidence pins are inconsistent.");
  }

  const expectedPeriodStatus = analysis.dataHealth.status === "complete" ? "complete" : "partial";
  const peakFromMs = Date.parse(breakdown.peak.from);
  const peakToMs = Date.parse(breakdown.peak.to);
  const validIdentity = breakdown.metricId === "energy.peak_demand_kw@1"
    && breakdown.unit === analysis.units.demand
    && breakdown.timezone === context.timezone
    && analysis.units.timezone === context.timezone
    && breakdown.intervalMinutes === analysis.units.intervalMinutes
    && breakdown.intervalMinutes === 15
    && breakdown.periodStatus === expectedPeriodStatus
    && Number.isFinite(breakdown.coveragePct)
    && breakdown.coveragePct >= 0
    && breakdown.coveragePct <= 100
    && formatDecimal(breakdown.coveragePct, 4) === formatDecimal(analysis.dataHealth.coveragePct, 4)
    && analysis.provenance.queryIds.includes("peak_breakdown_v1");
  const validPeak = analysis.summary.peakAt === breakdown.peak.from
    && Number.isFinite(peakFromMs)
    && Number.isFinite(peakToMs)
    && peakToMs - peakFromMs === breakdown.intervalMinutes * 60_000
    && peakFromMs >= Date.parse(context.primaryPeriod.start)
    && peakToMs <= Date.parse(context.primaryPeriod.endExclusive)
    && finiteNonNegative(breakdown.peak.averageKw)
    && formatDecimal(breakdown.peak.averageKw, 4) === formatDecimal(analysis.summary.peakKw, 4)
    && validCompletePeakHealth(breakdown.peak.dataHealth);
  if (!validIdentity || !validPeak) {
    return unavailable("The Peak identity, interval, Project value, quality or query evidence is invalid.");
  }

  const expectedLevels = analysis.childScopes
    .filter((scope) => scope.nodeType === "level")
    .map((scope) => ({ scopeId: scope.nodeId, scopeName: scope.name }));
  const uniqueLevelIds = new Set<string>();
  const uniqueCircuitIds = new Set<string>();
  const validLevels = expectedLevels.length === 2
    && breakdown.levels.length === expectedLevels.length
    && breakdown.levels.every((level) => {
      const expectedLevel = expectedLevels.find((candidate) => candidate.scopeId === level.scopeId);
      if (
        !expectedLevel
        || level.scopeName !== expectedLevel.scopeName
        || uniqueLevelIds.has(level.scopeId)
        || !finiteNonNegative(level.averageKw)
        || !validPercentage(level.sharePct)
        || !validCompletePeakHealth(level.dataHealth)
      ) {
        return false;
      }
      uniqueLevelIds.add(level.scopeId);
      return level.circuits.every((circuit) => {
        if (
          !circuit.meterNodeId
          || uniqueCircuitIds.has(circuit.meterNodeId)
          || !circuit.name
          || !circuit.category
          || circuit.includedInOfficialTotal !== false
          || (circuit.dataHealth.status !== "complete" && circuit.dataHealth.status !== "unavailable")
          || !validPeakHealth(circuit.dataHealth)
        ) {
          return false;
        }
        uniqueCircuitIds.add(circuit.meterNodeId);
        return circuit.dataHealth.status === "complete"
          ? validCompletePeakHealth(circuit.dataHealth)
            && finiteNonNegative(circuit.averageKw)
            && validPercentage(circuit.sharePct)
          : circuit.averageKw === null && circuit.sharePct === null;
      });
    });
  if (!validLevels) {
    return unavailable("The Level or Circuit Peak breakdown contract is incomplete or invalid.");
  }

  return {
    status: "available",
    decisionQuestion: "Which Level drove the highest accepted 15-minute interval-average Project load?",
    reason: null,
    periodStatus: breakdown.periodStatus,
    periodCoverage: `${formatDecimal(breakdown.coveragePct, 1)}% coverage`,
    peakLabel: breakdown.periodStatus === "partial"
      ? "Highest complete observed interval"
      : "Highest accepted interval",
    peakAt: formatTimestamp(breakdown.peak.from, breakdown.timezone),
    peakInterval: formatEvidenceRange(breakdown.peak.from, breakdown.peak.to, breakdown.timezone),
    averageKw: formatDecimal(breakdown.peak.averageKw, 4),
    quality: peakBreakdownQuality(breakdown.peak.dataHealth),
    levels: breakdown.levels.map((level) => ({
      scopeId: level.scopeId,
      scopeName: level.scopeName,
      averageKw: formatDecimal(level.averageKw, 4),
      sharePct: `${formatDecimal(level.sharePct, 4)}%`,
      quality: peakBreakdownQuality(level.dataHealth),
      circuits: level.circuits.map((circuit) => ({
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        category: circuit.category,
        averageKw: circuit.averageKw === null ? null : formatDecimal(circuit.averageKw, 4),
        sharePct: circuit.sharePct === null ? null : `${formatDecimal(circuit.sharePct, 4)}%`,
        includedInOfficialTotal: false,
        quality: peakBreakdownQuality(circuit.dataHealth),
      })),
    })),
    evidence,
  };
}

function validCompletePeakHealth(health: {
  status: string;
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): boolean {
  return health.status === "complete"
    && health.coveragePct === 100
    && health.qualityEventCount === 0
    && validPeakHealth(health)
    && health.expectedMeterIntervalCount > 0
    && health.validIntervalCount === health.expectedMeterIntervalCount;
}

function validPeakEvidencePins(snapshot: EnergyProjectAnalysisSnapshotDto): boolean {
  const { analysis, context, projectRelease } = snapshot;
  const peakMetricId = "energy.peak_demand_kw@1";
  const peakQueryId = "peak_breakdown_v1";
  const hasPeakEvidence = snapshot.evidence.some((reference) =>
    reference.metricId === peakMetricId
    && reference.queryIds.includes(peakQueryId)
  );

  return context.projectReleaseId === projectRelease.id
    && context.projectId === projectRelease.projectId
    && analysis.context.projectId === projectRelease.projectId
    && analysis.provenance.dataSnapshotId === snapshot.dataSnapshot.id
    && context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.provenance.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.provenance.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.provenance.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && projectRelease.metricRevisionIds.includes(peakMetricId)
    && hasPeakEvidence;
}

function validPeakHealth(health: {
  status: string;
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): boolean {
  return Number.isFinite(health.coveragePct)
    && health.coveragePct >= 0
    && health.coveragePct <= 100
    && Number.isInteger(health.expectedMeterIntervalCount)
    && health.expectedMeterIntervalCount >= 0
    && Number.isInteger(health.validIntervalCount)
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && Number.isInteger(health.qualityEventCount)
    && health.qualityEventCount >= 0;
}

function finiteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function validPercentage(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function peakBreakdownQuality(quality: {
  status: "complete" | "unavailable";
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): PeakBreakdownQuality {
  return {
    status: quality.status,
    statusLabel: quality.status === "complete" ? "Complete" : "Unavailable",
    coverage: `${formatDecimal(quality.coveragePct, 1)}% coverage`,
    intervals: `${quality.validIntervalCount.toLocaleString("en-SG")} / ${quality.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
    qualityEvents: `${quality.qualityEventCount.toLocaleString("en-SG")} quality events`,
  };
}

type TimeBehaviour = NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["timeBehaviour"]>;
type TimeScope = TimeBehaviour["scopes"][number];
type TimeCell = TimeScope["cells"][number];
type ComponentHourlyProjection = NonNullable<
  EnergyProjectAnalysisSnapshotDto["analysis"]["componentHourlyProfiles"]
>;
type DailyAnomalyBundle = Extract<
  NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>;
type DailyAnomalyRow = DailyAnomalyBundle["scopes"][number]["rows"][number];
type DailyAnomalyRollingComparison = DailyAnomalyBundle["scopes"][number]["rollingComparisons"][number];

const DAILY_ANOMALY_SUPPRESSION_CODES = new Set([
  "CALENDAR_EXCEPTION_DATE",
  "DAILY_FACTS_UNAVAILABLE",
  "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
  "COVERAGE_BELOW_THRESHOLD",
  "QUALITY_EVENT_PRESENT",
  "BASELINE_SAMPLE_COUNT_INSUFFICIENT",
  "BASELINE_VALUE_UNAVAILABLE",
]);
const DAILY_ANOMALY_RULE_REVISION_ID = "comparison.daily_usage_above_baseline@1";

function buildDecisionPriorities(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel,
): NgeeAnnDecisionPrioritiesViewModel {
  const source = snapshot.decisionPriorities;
  const unavailable = (limitation: string): NgeeAnnDecisionPrioritiesViewModel => ({
    status: "unavailable",
    limitation,
    lifecycle: unavailableDecisionLifecycleView(),
    items: [],
  });
  if (!source) {
    return unavailable("Decision priorities are unavailable because the server-owned priority contract is absent.");
  }
  if (!validDecisionPriorityEnvelope(snapshot, source, dailyAnomalies)) {
    return unavailable("Decision priorities were withheld because their order or Evidence contract is invalid.");
  }
  const lifecycle = buildDecisionLifecycleView(snapshot, source);
  return {
    status: source.status,
    limitation: source.limitation?.message ?? null,
    lifecycle,
    items: source.items.map((item) => ({
      priorityId: item.priorityId,
      rank: item.rank,
      finding: item.finding.title,
      evidence: [
        item.evidence.occurrence.scopeType === "project"
          ? "Project"
          : item.evidence.occurrence.scopeName,
        formatLocalDate(item.evidence.occurrence.localDate),
        `${formatDecimal(item.finding.actualKwh, 2)} kWh vs ${formatDecimal(item.finding.baselineKwh, 2)} kWh baseline (${signedDecimal(item.finding.relativePct, 1)}%)`,
      ].join(" / "),
      impact: `${formatDecimal(Math.abs(item.impact.energy.deltaKwh), 1)} kWh above comparable days. Cost impact is not available yet.`,
      action: item.action.label,
      confidence: item.confidence.status === "complete" ? "Complete Evidence" : "Partial Evidence",
      confidenceLimitation: item.confidence.limitation?.message ?? null,
      targetIncidentId: item.action.targetIncidentId,
      explorerScopeId: item.driver.status === "available"
        ? item.driver.scopeId
        : item.evidence.occurrence.scopeId,
      explorerScopeName: item.driver.status === "available"
        ? item.driver.label
        : item.evidence.occurrence.scopeName,
      sourceOccurrenceCount: item.sourceOccurrenceIds.length,
      recurrenceDayCount: item.recurrenceDayCount,
      horizons: item.horizons.map((horizon) => ({
        label: horizon.label,
        status: horizon.status,
        period: horizon.period.fromLocalDate === horizon.period.toLocalDate
          ? formatLocalDate(horizon.period.fromLocalDate)
          : `${formatLocalDate(horizon.period.fromLocalDate)} – ${formatLocalDate(horizon.period.toLocalDate)}`,
        actualKwh: horizon.actualKwh,
        baselineKwh: horizon.baselineKwh,
        deltaKwh: horizon.deltaKwh,
        relativePct: horizon.relativePct,
        comparison: horizon.status === "available"
          ? `${formatDecimal(horizon.actualKwh!, 2)} kWh vs ${formatDecimal(horizon.baselineKwh!, 2)} kWh (${signedDecimal(horizon.relativePct!, 1)}%)`
          : "Unavailable",
        limitation: horizon.limitation,
      })),
      driver: item.driver.status === "available"
        ? `${item.driver.label} contributed ${signedDecimal(item.driver.impactKwh, 1)} kWh to the selected exception. Meter data locates the issue; it does not confirm the operational cause.`
        : item.driver.limitation,
      nextCheck: item.action.nextCheck,
      verificationMetric: item.action.verificationMetricRef.label,
      lifecycle: lifecycleForPriority(snapshot, lifecycle, item.priorityId),
    })),
  };
}

function buildExecutiveSummary(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  comparisonAvailable: boolean,
  overviewUnavailable: boolean,
  levelComparison: NgeeAnnLevelComparisonViewModel,
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel,
): NgeeAnnExecutiveSummaryViewModel {
  const { analysis } = snapshot;
  const comparison = analysis.comparison;
  const headline = comparisonAvailable
    ? comparison.changePct === 0
      ? "Energy use was unchanged versus the previous period"
      : `Energy use ${comparison.changePct! > 0 ? "increased" : "decreased"} ${formatDecimal(Math.abs(comparison.changePct!), 1)}% versus the previous period`
    : "Comparable-period change unavailable";
  const detail = comparisonAvailable
    ? `The Project used ${formatCustomerDecimal(analysis.summary.usageKwh, 2)} kWh, ${comparison.changeKwh >= 0 ? "up" : "down"} ${formatCustomerDecimal(Math.abs(comparison.changeKwh), 2)} kWh from the validated previous period.`
    : "No validated comparable-period usage is available. Current accepted energy remains visible below.";

  const levelDriver = levelComparison.status === "available"
    ? selectDirectionalDriver(
      analysis.childScopes
        .filter((scope) => scope.nodeType === "level" && scope.comparison)
        .map((scope) => ({
          id: scope.nodeId,
          name: scope.name,
          changeKwh: scope.comparison!.changeKwh,
        })),
      comparison.changeKwh,
    )
    : null;
  const categoryDriver = hasEnergyCategoryContract(snapshot, overviewUnavailable)
    ? selectDirectionalDriver(
      analysis.categories
        .filter((category) => category.comparison)
        .map((category) => ({
          id: category.category,
          name: compositionCategoryName(category.category),
          changeKwh: category.comparison!.changeKwh,
        })),
      comparison.changeKwh,
    )
    : null;
  const driverAvailable = Boolean(levelDriver && categoryDriver);
  const driverValue = driverAvailable
    ? `${levelDriver!.name}: ${signedDecimal(levelDriver!.changeKwh, 2)} kWh`
    : "Unavailable";
  const driverDetail = driverAvailable
    ? `Category ${categoryDriver!.name}: ${signedDecimal(categoryDriver!.changeKwh, 2)} kWh. These are separate same-direction movements; their overlap and cause are not established.`
    : "No Level and Category movements align with the Project direction in the validated comparison.";

  const largestIncident = largestDailyAnomalyIncident(dailyAnomalies);
  const firstReviewValue = largestIncident
    ? `${largestIncident.scopeName} · ${largestIncident.dateLabel}`
    : dailyAnomalies.status === "available"
      ? "No daily exception triggered"
      : "Usage exception analysis unavailable";
  const firstReviewDetail = largestIncident
    ? `${signedDecimal(largestIncident.impactKwhValue, 2)} kWh (${signedPercent(largestIncident.relativePctValue, 1)}) versus its governed comparable-day baseline.`
    : dailyAnomalies.status === "available"
      ? "No eligible Project or Level day crossed the published rule in this Period."
      : dailyAnomalies.reason ?? "No validated daily exception result is available.";

  return {
    headline,
    detail,
    signals: [
      {
        id: "period-change",
        label: "What changed",
        value: comparisonAvailable ? `${signedDecimal(comparison.changeKwh, 2)} kWh` : "Unavailable",
        detail: comparisonAvailable
          ? `Current ${formatDecimal(analysis.summary.usageKwh, 2)} kWh versus previous ${formatDecimal(comparison.usageKwh, 2)} kWh.`
          : "No validated comparable-period usage is available.",
        href: comparisonAvailable ? "#ngee-ann-comparison-evidence" : null,
        status: comparisonAvailable ? "available" : "unavailable",
        tone: "neutral",
      },
      {
        id: "main-driver",
        label: comparisonAvailable ? "Largest aligned movements" : "Largest verified movement",
        value: driverValue,
        detail: driverDetail,
        href: driverAvailable ? "#ngee-ann-circuit-analysis" : null,
        status: driverAvailable ? "available" : "unavailable",
        tone: "neutral",
      },
      {
        id: "first-review",
        label: "First date to review",
        value: firstReviewValue,
        detail: firstReviewDetail,
        href: largestIncident ? `#${anomalyIncidentDomId(largestIncident.incidentId)}` : null,
        status: dailyAnomalies.status === "available" ? "available" : "unavailable",
        tone: largestIncident ? "warning" : "neutral",
      },
    ],
  };
}

function buildChangeOverTimeSummary(
  energyTrend: NgeeAnnEnergyTrendViewModel,
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel,
): NgeeAnnChangeOverTimeSummaryViewModel {
  if (energyTrend.status === "unavailable") {
    return {
      headline: "Recent daily energy is unavailable",
      detail: energyTrend.reason ?? "The bounded recent-operations window does not contain an accepted daily trend.",
    };
  }
  const largestIncident = largestDailyAnomalyIncident(dailyAnomalies);
  if (largestIncident) {
    return {
      headline: `Start with ${largestIncident.scopeName} on ${largestIncident.dateLabel}: ${signedDecimal(largestIncident.impactKwhValue, 2)} kWh above its comparable-day baseline`,
      detail: "The trend uses accepted daily energy. Exception markers use the separately governed comparable-day Rule; open the date to verify its Evidence before deciding why it happened.",
    };
  }
  if (dailyAnomalies.status === "unavailable") {
    return {
      headline: "Recent accepted daily energy is available",
      detail: "The 28-day curve uses accepted daily energy. Comparable-day exception markers are unavailable for this bounded window, so no alert is borrowed from the Report Edition.",
    };
  }
  return {
    headline: "No eligible comparable-day exception was found in recent operations",
    detail: "The 28-day accepted daily energy curve remains available for review; the governed comparable-day Rule did not publish an eligible alert for this window.",
  };
}

function selectDirectionalDriver<T extends { changeKwh: number }>(
  candidates: T[],
  projectChangeKwh: number,
): T | null {
  if (candidates.length === 0) return null;
  const aligned = candidates.filter((candidate) => (
    projectChangeKwh > 0 ? candidate.changeKwh > 0 : projectChangeKwh < 0 ? candidate.changeKwh < 0 : false
  ));
  return [...aligned].sort((left, right) => (
    Math.abs(right.changeKwh) - Math.abs(left.changeKwh)
  ))[0] ?? null;
}

function largestDailyAnomalyIncident(
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel,
): NgeeAnnDailyAnomalyViewModel["incidents"][number] | null {
  if (dailyAnomalies.status !== "available") return null;
  return [...dailyAnomalies.incidents].sort((left, right) => (
    Math.abs(right.impactKwhValue) - Math.abs(left.impactKwhValue)
    || right.localDate.localeCompare(left.localDate)
    || left.incidentId.localeCompare(right.incidentId)
  ))[0] ?? null;
}

function signedPercent(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${formatDecimal(value, digits)}%`;
}

function buildDecisionLifecycleView(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  priorities: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>,
): NgeeAnnDecisionPrioritiesViewModel["lifecycle"] {
  const source = snapshot.decisionLifecycle;
  if (!source || source.currentDataSnapshotId !== snapshot.dataSnapshot.id) {
    return unavailableDecisionLifecycleView();
  }
  if (source.status === "unavailable") return unavailableDecisionLifecycleView();
  if (!source.reference
    || source.reference.dataSnapshotId === snapshot.dataSnapshot.id
    || source.items.some((item) => !validDecisionLifecycleItem(snapshot, priorities, item))) {
    return unavailableDecisionLifecycleView();
  }
  const historicalItems: NgeeAnnDecisionPrioritiesViewModel["lifecycle"]["historicalItems"] = [];
  for (const item of source.items) {
    if (item.currentPriorityId !== null) continue;
    if (item.kind === "resolved") {
      historicalItems.push({
        themeKey: item.themeKey,
        kind: item.kind,
        label: "Resolved in the current 28-day window",
        detail: "Saved A supported this daily-usage theme; current B has complete Evidence with no eligible exception.",
        tone: "success",
      });
    } else if (item.kind === "no_longer_supported") {
      historicalItems.push({
        themeKey: item.themeKey,
        kind: item.kind,
        label: "No longer supported by current Evidence",
        detail: source.limitation?.message
          ?? "The current Evidence is incomplete, so disappearance from the page does not prove resolution.",
        tone: "warning",
      });
    }
  }
  return {
    status: "available",
    referenceLabel: `Compared with saved result from ${formatTimestamp(source.reference.createdAt, snapshot.context.timezone)}`,
    referenceDetail: source.reference.evidenceStatus === "available"
      ? "The same published Template is applied to saved A and current B."
      : "Saved A is retained, but its theme Evidence was incomplete or unavailable.",
    previousSavedAnalysisId: source.reference.savedAnalysisId,
    previousSnapshotId: source.reference.dataSnapshotId,
    historicalItems,
  };
}

function lifecycleForPriority(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  lifecycle: NgeeAnnDecisionPrioritiesViewModel["lifecycle"],
  priorityId: string,
): NgeeAnnDecisionPrioritiesViewModel["items"][number]["lifecycle"] {
  if (lifecycle.status !== "available") return null;
  const item = snapshot.decisionLifecycle?.items.find((candidate) => candidate.currentPriorityId === priorityId);
  if (!item) return null;
  if (item.kind === "new") {
    return {
      kind: item.kind,
      label: "New since saved result",
      detail: "Saved A had complete comparable Evidence and did not contain this theme.",
      tone: "info",
    };
  }
  if (item.kind === "newly_supported") {
    return {
      kind: item.kind,
      label: "Newly supported in current B",
      detail: "Saved A could not support this conclusion; B now has enough governed Evidence. This does not prove the issue itself began in B.",
      tone: "warning",
    };
  }
  if (item.kind === "recurring") {
    return {
      kind: item.kind,
      label: "Recurring across A and B",
      detail: "The same rule-backed theme is supported in both the saved result and the current Snapshot.",
      tone: "warning",
    };
  }
  return null;
}

function validDecisionLifecycleItem(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  priorities: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>,
  item: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionLifecycle"]>["items"][number],
): boolean {
  if (!item.themeKey.trim()) return false;
  if (item.currentPriorityId !== null
    && !priorities.items.some((priority) => priority.priorityId === item.currentPriorityId)) return false;
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  if (item.currentBundleId !== null
    && (bundle?.status !== "available" || item.currentBundleId !== bundle.bundleId)) return false;
  return item.previousBundleId === null || Boolean(item.previousBundleId.trim());
}

function unavailableDecisionLifecycleView(): NgeeAnnDecisionPrioritiesViewModel["lifecycle"] {
  return {
    status: "unavailable",
    referenceLabel: null,
    referenceDetail: null,
    previousSavedAnalysisId: null,
    previousSnapshotId: null,
    historicalItems: [],
  };
}

function validDecisionPriorityEnvelope(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  source: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>,
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel,
): boolean {
  if (!validDecisionPriorityEvidencePins(snapshot, source.evidencePins)) return false;
  if (!validDecisionPriorityStatus(source)) return false;
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  if (source.status === "unavailable") return true;
  if (dailyAnomalies.status !== "available" || bundle?.status !== "available") return false;
  if (!validDecisionPriorityOutcomeStatus(source, bundle)) return false;
  if (source.items.length === 0) return true;
  const incidents = new Map(bundle.scopes.flatMap((scope) => scope.rows.map((row) => [
    row.incidentId,
    { scope, row },
  ] as const)));
  const priorityIds = new Set<string>();
  return source.items.every((item, index) => {
    if (
      !item.priorityId
      || priorityIds.has(item.priorityId)
      || item.rank !== index + 1
      || item.source !== "daily_usage_anomaly"
      || item.finding.code !== "DAILY_USAGE_ABOVE_BASELINE"
      || !item.finding.title.trim()
      || !finiteNumber(item.finding.actualKwh)
      || !finiteNumber(item.finding.baselineKwh)
      || !finiteNumber(item.finding.relativePct)
      || item.sourceOccurrenceIds.length === 0
      || new Set(item.sourceOccurrenceIds).size !== item.sourceOccurrenceIds.length
      || !Number.isSafeInteger(item.recurrenceDayCount)
      || item.recurrenceDayCount < 1
      || !validDecisionThemeHorizons(item.horizons)
      || !validDecisionThemeDriver(item.driver)
      || item.evidence.bundleId !== bundle.bundleId
      || item.evidence.metricId !== bundle.metricId
      || item.evidence.queryIds.length !== 1
      || item.evidence.queryIds[0] !== bundle.queryId
      || item.evidence.ruleRevisionId !== bundle.ruleRevisionId
      || item.evidence.period.from !== snapshot.context.primaryPeriod.start
      || item.evidence.period.to !== snapshot.context.primaryPeriod.endExclusive
      || item.impact.energy.status !== "available"
      || !finiteNumber(item.impact.energy.deltaKwh)
      || item.impact.cost.status !== "unavailable"
      || item.impact.cost.reason.code !== "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE"
      || !item.impact.cost.reason.message.trim()
      || item.action.code !== "INSPECT_DAILY_USAGE_DRIVERS"
      || !item.action.label.trim()
      || item.action.targetIncidentId !== item.evidence.primaryIncidentId
      || item.action.targetRef.kind !== "daily_usage_incident"
      || item.action.targetRef.id !== item.action.targetIncidentId
      || !item.action.nextCheck.trim()
      || item.action.verificationMetricRef.metricId !== item.evidence.metricId
      || !item.action.verificationMetricRef.label.trim()
      || !validDecisionPriorityConfidence(item.confidence)
    ) return false;
    priorityIds.add(item.priorityId);
    const primary = incidents.get(item.evidence.primaryIncidentId);
    if (
      !primary
      || primary.row.outcome !== "triggered"
      || primary.scope.scopeId !== item.evidence.occurrence.scopeId
      || primary.scope.scopeName !== item.evidence.occurrence.scopeName
      || primary.scope.scopeType !== item.evidence.occurrence.scopeType
      || primary.row.localDate !== item.evidence.occurrence.localDate
      || primary.row.from !== item.evidence.occurrence.from
      || primary.row.to !== item.evidence.occurrence.to
      || primary.row.actualKwh !== item.finding.actualKwh
      || primary.row.baselineKwh !== item.finding.baselineKwh
      || primary.row.relativePct !== item.finding.relativePct
      || primary.row.impactKwh !== item.impact.energy.deltaKwh
      || !decisionThemeHorizonsMatchSource(item.horizons, primary.scope)
    ) return false;
    const supportingIds = new Set(item.evidence.supportingIncidentIds);
    const expectedSourceIds = bundle.scopes.flatMap((scope) => scope.rows)
      .filter((row) => row.outcome === "triggered"
        && row.ruleRevisionId === primary.row.ruleRevisionId
        && row.metricId === primary.row.metricId)
      .map((row) => row.incidentId);
    const expectedSupportingIds = expectedSourceIds
      .filter((incidentId) => incidentId !== item.evidence.primaryIncidentId);
    const expectedRecurrenceDayCount = new Set(
      primary.scope.rows
        .filter((row) => row.outcome === "triggered")
        .map((row) => row.localDate),
    ).size;
    if (
      supportingIds.size !== item.evidence.supportingIncidentIds.length
      || supportingIds.has(item.evidence.primaryIncidentId)
      || supportingIds.size !== expectedSupportingIds.length
      || item.sourceOccurrenceIds.length !== expectedSourceIds.length
      || item.recurrenceDayCount !== expectedRecurrenceDayCount
    ) return false;
    const sourceIds = new Set(item.sourceOccurrenceIds);
    return expectedSupportingIds.every((incidentId) => supportingIds.has(incidentId))
      && expectedSourceIds.every((incidentId) => sourceIds.has(incidentId));
  });
}

function validDecisionThemeHorizons(
  horizons: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>["items"][number]["horizons"],
): boolean {
  const expected = ["latest_complete_day", "rolling_7d", "rolling_28d"];
  if (horizons.length !== expected.length) return false;
  return horizons.every((horizon, index) => {
    if (horizon.horizon !== expected[index]
      || !horizon.label.trim()
      || !horizon.period.fromLocalDate
      || !horizon.period.toLocalDate) return false;
    if (horizon.status === "unavailable") {
      return horizon.deltaKwh === null
        && horizon.relativePct === null
        && Boolean(horizon.limitation?.trim());
    }
    return finiteNumber(horizon.actualKwh!)
      && finiteNumber(horizon.baselineKwh!)
      && finiteNumber(horizon.deltaKwh!)
      && finiteNumber(horizon.relativePct!)
      && horizon.limitation === null;
  });
}

function decisionThemeHorizonsMatchSource(
  horizons: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>["items"][number]["horizons"],
  scope: Extract<
    NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyUsageAnomalies"]>,
    { status: "available" }
  >["scopes"][number],
): boolean {
  const latest = scope.rows.slice().sort((left, right) => right.localDate.localeCompare(left.localDate))[0];
  const latestHorizon = horizons[0];
  if (!latest
    || !latestHorizon
    || latestHorizon.period.fromLocalDate !== latest.localDate
    || latestHorizon.period.toLocalDate !== latest.localDate) return false;
  if (latestHorizon.status === "available" && (
    latestHorizon.actualKwh !== latest.actualKwh
    || latestHorizon.baselineKwh !== latest.baselineKwh
    || latestHorizon.deltaKwh !== latest.impactKwh
    || latestHorizon.relativePct !== latest.relativePct
  )) return false;
  return horizons.slice(1).every((horizon) => {
    const comparison = scope.rollingComparisons.find((candidate) => candidate.horizon === horizon.horizon);
    if (!comparison
      || comparison.status !== horizon.status
      || !validRollingComparisonBoundaries(comparison, latest.localDate)
      || horizon.period.fromLocalDate !== comparison.current.fromLocalDate
      || horizon.period.toLocalDate !== comparison.current.toLocalDate) return false;
    if (comparison.status === "unavailable") {
      return horizon.actualKwh === comparison.current.totalKwh
        && horizon.baselineKwh === comparison.baseline.totalKwh
        && horizon.limitation === comparison.reason.message;
    }
    return horizon.actualKwh === comparison.current.totalKwh
      && horizon.baselineKwh === comparison.baseline.totalKwh
      && horizon.deltaKwh === comparison.deltaKwh
      && horizon.relativePct === comparison.relativePct;
  });
}

function validRollingComparisonBoundaries(
  comparison: DailyAnomalyRollingComparison,
  latestLocalDate: string,
): boolean {
  const horizonDays = comparison.horizon === "rolling_7d" ? 7 : 28;
  const expectedCurrentFrom = shiftIsoLocalDate(latestLocalDate, -(horizonDays - 1));
  if (!expectedCurrentFrom) return false;
  const expectedBaselineTo = shiftIsoLocalDate(expectedCurrentFrom, -1);
  const expectedBaselineFrom = shiftIsoLocalDate(expectedCurrentFrom, -horizonDays);
  return comparison.cutoffLocalDate === latestLocalDate
    && comparison.current.fromLocalDate === expectedCurrentFrom
    && comparison.current.toLocalDate === latestLocalDate
    && comparison.baseline.fromLocalDate === expectedBaselineFrom
    && comparison.baseline.toLocalDate === expectedBaselineTo;
}

function shiftIsoLocalDate(localDate: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(localDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validDecisionThemeDriver(
  driver: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>["items"][number]["driver"],
): boolean {
  if (driver.status === "unavailable") return Boolean(driver.limitation.trim());
  return Boolean(driver.scopeId.trim())
    && Boolean(driver.label.trim())
    && finiteNumber(driver.impactKwh)
    && driver.impactKwh > 0
    && driver.limitation === "Evidence only; not a confirmed root cause.";
}

function validDecisionPriorityOutcomeStatus(
  source: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>,
  bundle: Extract<
    NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyUsageAnomalies"]>,
    { status: "available" }
  >,
): boolean {
  const rows = bundle.scopes.flatMap((scope) => scope.rows);
  const hasTriggered = rows.some((row) => row.outcome === "triggered");
  const hasSuppressed = rows.some((row) => row.outcome === "suppressed");
  const allSuppressed = rows.length > 0 && rows.every((row) => row.outcome === "suppressed");
  if (source.status === "available") {
    return hasTriggered
      && !hasSuppressed
      && source.items.every((item) => item.confidence.status === "complete");
  }
  if (source.status === "empty") return !hasTriggered && !hasSuppressed;
  if (source.status === "suppressed") return allSuppressed;
  if (source.status === "partial") {
    if (source.limitation?.code === "SOME_CANDIDATE_DATES_SUPPRESSED") {
      const someButNotAllSuppressed = hasSuppressed && !allSuppressed;
      return source.items.length > 0
        ? someButNotAllSuppressed && hasTriggered
        : someButNotAllSuppressed && !hasTriggered;
    }
    return !hasSuppressed
      && hasTriggered
      && source.items.length > 0
      && source.items.some((item) => item.confidence.status === "partial");
  }
  return true;
}

function validDecisionPriorityEvidencePins(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  pins: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>["evidencePins"],
): boolean {
  const expected = {
    projectReleaseId: snapshot.projectRelease.id,
    dataSnapshotId: snapshot.dataSnapshot.id,
    hierarchyRevisionId: snapshot.analysis.provenance.hierarchyRevisionId,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
    metricVersion: snapshot.analysis.provenance.metricVersion,
    businessCalendarVersion: snapshot.context.businessCalendarVersion,
  };
  return pins.projectReleaseId === expected.projectReleaseId
    && pins.dataSnapshotId === expected.dataSnapshotId
    && pins.hierarchyRevisionId === expected.hierarchyRevisionId
    && pins.meterMappingRevisionId === expected.meterMappingRevisionId
    && pins.meterFormulaRevisionId === expected.meterFormulaRevisionId
    && pins.metricVersion === expected.metricVersion
    && pins.businessCalendarVersion === expected.businessCalendarVersion
    && pins.queryIds.length === 1
    && pins.queryIds[0] === "time_slot_anomaly_v1";
}

function validDecisionPriorityStatus(
  source: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>,
): boolean {
  if (source.items.length > 3) return false;
  if (source.status === "available") {
    return source.items.length > 0
      && source.limitation === null
      && source.items.every((item) => item.confidence.status === "complete");
  }
  if (source.status === "empty") return source.items.length === 0 && source.limitation === null;
  if (!source.limitation?.message.trim()) return false;
  if (source.status === "suppressed") {
    return source.items.length === 0 && source.limitation.code === "ALL_CANDIDATE_DATES_SUPPRESSED";
  }
  if (source.status === "partial") {
    if (source.limitation.code === "SOME_CANDIDATE_DATES_SUPPRESSED") return true;
    return source.items.length > 0
      && source.limitation.code === "SUPPORTING_EVIDENCE_PARTIAL"
      && source.items.some((item) => item.confidence.status === "partial");
  }
  return source.items.length === 0 && [
    "DAILY_USAGE_ANOMALIES_ABSENT",
    "DAILY_USAGE_ANOMALIES_UNAVAILABLE",
    "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH",
    "EVIDENCE_PINS_MISMATCH",
  ].includes(source.limitation.code);
}

function validDecisionPriorityConfidence(
  confidence: NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]>["items"][number]["confidence"],
): boolean {
  if (confidence.status === "complete") return confidence.limitation === null;
  return confidence.limitation?.code === "SUPPORTING_EVIDENCE_PARTIAL"
    && Boolean(confidence.limitation.message.trim());
}

function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function buildDailyAnomalies(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnDailyAnomalyViewModel {
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  const evidence: NgeeAnnDailyAnomalyViewModel["evidence"] = {
    bundleId: bundle?.status === "available" ? bundle.bundleId : null,
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    hierarchyRevisionId: snapshot.analysis.provenance.hierarchyRevisionId,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
    metricVersion: snapshot.analysis.provenance.metricVersion,
    businessCalendarVersion: bundle?.status === "available"
      ? bundle.evidencePins.businessCalendarVersion
      : snapshot.context.businessCalendarVersion,
    metricId: "energy.total_usage_kwh@1",
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    timezone: bundle?.status === "available" ? bundle.timezone : snapshot.context.timezone,
    queryIds: ["time_slot_anomaly_v1"],
  };
  const unavailable = (reason: string): NgeeAnnDailyAnomalyViewModel => ({
    status: "unavailable",
    decisionQuestion: "Which daily exceptions deserve investigation first?",
    reason,
    allSuppressed: false,
    outcomeSummary: { triggered: 0, withinThreshold: 0, suppressed: 0 },
    incidents: [],
    rule: null,
    evidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support a daily anomaly conclusion for this Period.");
  }
  if (snapshot.context.scopeType !== "project") {
    return unavailable("Select the Project Scope to review Project and Level daily incidents.");
  }
  if (!bundle) {
    return unavailable("This published Snapshot does not include the authoritative daily anomaly contract.");
  }
  if (bundle.status === "unavailable") {
    return unavailable(bundle.reason.message);
  }
  const invalidReason = invalidDailyAnomalyBundleReason(snapshot, bundle);
  if (invalidReason) return unavailable(invalidReason);

  const allRows = bundle.scopes.flatMap((scope) => scope.rows);
  const outcomeSummary = { triggered: 0, withinThreshold: 0, suppressed: 0 };
  for (const row of allRows) {
    if (row.outcome === "triggered") outcomeSummary.triggered += 1;
    else if (row.outcome === "within_threshold") outcomeSummary.withinThreshold += 1;
    else outcomeSummary.suppressed += 1;
  }
  const incidents = bundle.scopes.flatMap((scope) => scope.rows
    .filter((row) => row.outcome === "triggered")
    .map((row) => {
      const thresholdKwhValue = Math.max(
        row.baselineKwh! * (1 + bundle.rule.relativeThresholdPct / 100),
        row.baselineKwh! + bundle.rule.absoluteImpactKwh,
      );
      return {
        anomalyId: row.anomalyId,
        incidentId: row.incidentId,
        scopeId: scope.scopeId,
        scopeName: scope.scopeType === "project" ? "Project" : scope.scopeName,
        localDate: row.localDate,
        dateLabel: formatLocalDate(row.localDate),
        weekday: formatLocalWeekday(row.localDate),
        dayType: row.dayType === "weekday" ? "Weekday" as const : "Weekend" as const,
        range: formatEvidenceRange(row.from, row.to, bundle.timezone),
        actualKwhValue: row.actualKwh!,
        baselineKwhValue: row.baselineKwh!,
        impactKwhValue: row.impactKwh!,
        relativePctValue: row.relativePct!,
        thresholdKwhValue,
        actualKwh: formatDecimal(row.actualKwh!, 4),
        baselineKwh: formatDecimal(row.baselineKwh!, 4),
        thresholdKwh: formatDecimal(thresholdKwhValue, 4),
        impactKwh: signedDecimal(row.impactKwh!, 4),
        relativePct: `${signedDecimal(row.relativePct!, 4)}%`,
        coverage: `${formatDecimal(row.coveragePct, 1)}% coverage`,
        intervals: `${row.validIntervalCount.toLocaleString("en-SG")} / ${row.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
        qualityEvents: `${row.qualityEventCount.toLocaleString("en-SG")} quality events`,
        relatedLevelTotals: row.detailSeries
          .filter((series) => series.relationship === "immediate_level" && series.kind === "official_scope")
          .map((series) => ({
            scopeId: series.scopeId,
            scopeName: series.scopeName,
            selectedKwh: series.selectedTotalKwh === null ? null : formatDecimal(series.selectedTotalKwh, 4),
          })),
        baselineDates: [...row.baselineDates],
        baselineSamples: row.baselineSamples.map((sample) => ({
          localDate: sample.localDate,
          coverage: `${formatDecimal(sample.coveragePct, 1)}% coverage`,
          intervals: `${sample.validIntervalCount.toLocaleString("en-SG")} / ${sample.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
          qualityEvents: `${sample.qualityEventCount.toLocaleString("en-SG")} quality events`,
        })),
        hourlyComparison: row.hourlyComparison.map((point) => ({
          localHour: point.localHour,
          actualKwh: point.actualKwh!,
          baselineKwh: point.baselineKwh!,
          impactKwh: point.impactKwh!,
          relativePct: point.relativePct!,
        })),
        series: row.detailSeries.map((series) => ({
          seriesId: series.seriesId,
          relationship: series.relationship,
          kind: series.kind,
          scopeId: series.scopeId,
          scopeName: series.scopeName,
          meterNodeId: series.meterNodeId ?? null,
          category: series.category ?? null,
          categoryLabel: series.category ? formatCategoryLabel(series.category) : null,
          includedInOfficialTotal: series.includedInOfficialTotal,
          status: series.status,
          statusLabel: series.status === "available"
            ? "Available" as const
            : series.status === "partial"
              ? "Partial" as const
              : "Unavailable" as const,
          selectedTotalKwh: series.selectedTotalKwh === null ? null : formatDecimal(series.selectedTotalKwh, 4),
          baselineTotalKwh: series.baselineTotalKwh === null ? null : formatDecimal(series.baselineTotalKwh, 4),
          impactKwh: series.impactKwh === null ? null : signedDecimal(series.impactKwh, 4),
          relativePct: series.relativePct === null ? null : `${signedDecimal(series.relativePct, 4)}%`,
          coverage: `${formatDecimal(series.coveragePct, 1)}% coverage`,
          intervals: `${series.validIntervalCount.toLocaleString("en-SG")} / ${series.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
          qualityEvents: `${series.qualityEventCount.toLocaleString("en-SG")} quality events`,
          points: series.points.map((point) => ({
            localHour: point.localHour,
            hourLabel: formatLocalHour(point.localHour),
            selectedKwh: point.selectedKwh,
            baselineKwh: point.baselineKwh,
            impactKwh: point.impactKwh,
          })),
        })),
      };
    }));

  return {
    status: "available",
    decisionQuestion: "Which daily exceptions deserve investigation first?",
    reason: null,
    allSuppressed: allRows.length > 0 && outcomeSummary.suppressed === allRows.length,
    outcomeSummary,
    incidents,
    rule: {
      ruleRevisionId: bundle.ruleRevisionId,
      baselineCutoff: bundle.baselineCutoff,
      baselineMethod: bundle.rule.baselineMethod,
      relativeThresholdPct: `${formatDecimal(bundle.rule.relativeThresholdPct, 4)}%`,
      absoluteImpactKwh: `${formatDecimal(bundle.rule.absoluteImpactKwh, 4)} kWh`,
      minimumCoveragePct: `${formatDecimal(bundle.rule.minimumCoveragePct, 4)}%`,
      minimumSampleCount: bundle.rule.minimumSampleCount,
      maximumQualityEventCount: bundle.rule.maximumQualityEventCount,
      maximumLookbackDays: bundle.rule.maximumLookbackDays,
    },
    evidence,
  };
}

function invalidDailyAnomalyBundleReason(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  bundle: DailyAnomalyBundle,
): string | null {
  if (!validDailyAnomalyEvidencePins(snapshot, bundle)) {
    return "The anomaly Snapshot, Release, Rule or revision evidence pins are inconsistent.";
  }
  if (
    !bundle.bundleId
    || bundle.ruleRevisionId !== DAILY_ANOMALY_RULE_REVISION_ID
    || bundle.metricId !== "energy.total_usage_kwh@1"
    || bundle.queryId !== "time_slot_anomaly_v1"
    || bundle.timezone !== snapshot.context.timezone
    || bundle.baselineCutoff !== isoLocalDateAt(
      snapshot.context.primaryPeriod.start,
      snapshot.context.timezone,
    )
    || !validDailyAnomalyRule(bundle.rule)
  ) {
    return "The anomaly bundle identity, timezone, cutoff or pinned Rule is invalid.";
  }
  const immediateLevels = snapshot.analysis.childScopes
    .filter((scope) => scope.nodeType === "level");
  const immediateLevelById = new Map(
    immediateLevels.map((scope) => [scope.nodeId, scope]),
  );
  const projectScope = bundle.scopes[0];
  const bundledLevelScopes = bundle.scopes.slice(1);
  const bundledLevelIds = new Set<string>();
  if (
    immediateLevels.length !== 2
    || immediateLevelById.size !== immediateLevels.length
    || bundle.scopes.length !== 3
    || !projectScope
    || projectScope.scopeId !== snapshot.context.scopeId
    || projectScope.scopeName !== snapshot.context.scopeName
    || projectScope.scopeType !== "project"
    || bundledLevelScopes.length !== immediateLevelById.size
    || bundledLevelScopes.some((scope) => {
      const expected = immediateLevelById.get(scope.scopeId);
      if (!expected || bundledLevelIds.has(scope.scopeId)) return true;
      bundledLevelIds.add(scope.scopeId);
      return scope.scopeName !== expected.name || scope.scopeType !== "level";
    })
    || bundledLevelIds.size !== immediateLevelById.size
  ) {
    return "The anomaly Scope contract is incomplete or out of order.";
  }
  const projectRows = bundle.scopes[0]?.rows;
  if (!projectRows || !validDailyAnomalySpine(projectRows, snapshot.context.primaryPeriod)) {
    return "The anomaly local-date spine is incomplete or invalid.";
  }
  const spine = projectRows.map((row) => `${row.localDate}|${row.from}|${row.to}`);
  const anomalyIds = new Set<string>();
  const incidentIds = new Set<string>();
  const rowsValid = bundle.scopes.every((scope) => {
    const selectedScope = { id: scope.scopeId, name: scope.scopeName };
    const expectedImmediateLevels = scope.scopeType === "project"
      ? bundledLevelScopes.map(({ scopeId, scopeName }) => ({ id: scopeId, name: scopeName }))
      : [];
    return scope.rows.length === spine.length
      && scope.rows.every((row, index) => {
        if (`${row.localDate}|${row.from}|${row.to}` !== spine[index]) return false;
        if (!row.anomalyId || anomalyIds.has(row.anomalyId) || !row.incidentId || incidentIds.has(row.incidentId)) return false;
        anomalyIds.add(row.anomalyId);
        incidentIds.add(row.incidentId);
        return validDailyAnomalyRow(row, selectedScope, expectedImmediateLevels, bundle);
      });
  });
  return rowsValid ? null : "The anomaly rows, baseline samples, outcomes or detail series are invalid.";
}

function validDailyAnomalyEvidencePins(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  bundle: DailyAnomalyBundle,
): boolean {
  const { analysis, context, projectRelease } = snapshot;
  const hasReference = snapshot.evidence.some((item) => (
    item.metricId === "energy.total_usage_kwh@1"
    && item.queryIds.includes("time_slot_anomaly_v1")
  ));
  return context.projectReleaseId === projectRelease.id
    && bundle.evidencePins.projectReleaseId === projectRelease.id
    && context.projectId === projectRelease.projectId
    && analysis.context.projectId === projectRelease.projectId
    && bundle.evidencePins.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.provenance.dataSnapshotId === snapshot.dataSnapshot.id
    && context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.context.dataSnapshotId === snapshot.dataSnapshot.id
    && bundle.evidencePins.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.provenance.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && bundle.evidencePins.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.provenance.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && bundle.evidencePins.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.provenance.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && bundle.evidencePins.metricVersion === analysis.provenance.metricVersion
    && bundle.evidencePins.metricVersion === context.metricVersion
    && bundle.evidencePins.metricVersion === analysis.context.metricVersion
    && bundle.evidencePins.businessCalendarVersion === projectRelease.businessCalendarVersion
    && context.businessCalendarVersion === projectRelease.businessCalendarVersion
    && analysis.context.businessCalendarVersion === projectRelease.businessCalendarVersion
    && bundle.evidencePins.queryIds.length === 1
    && bundle.evidencePins.queryIds[0] === "time_slot_anomaly_v1"
    && projectRelease.metricRevisionIds.includes("energy.total_usage_kwh@1")
    && projectRelease.ruleRevisionIds.includes(bundle.ruleRevisionId)
    && analysis.provenance.ruleRevisionIds.includes(bundle.ruleRevisionId)
    && analysis.provenance.queryIds.includes("time_slot_anomaly_v1")
    && hasReference;
}

function validDailyAnomalyRule(rule: DailyAnomalyBundle["rule"]): boolean {
  return rule.relativeThresholdPct === 20
    && rule.absoluteImpactKwh === 20
    && rule.minimumCoveragePct === 95
    && rule.minimumSampleCount === 4
    && rule.maximumQualityEventCount === 0
    && rule.maximumLookbackDays === 60
    && rule.direction === "above"
    && rule.baselineMethod === "mean_of_complete_comparable_days_by_local_hour";
}

function validDailyAnomalySpine(
  rows: DailyAnomalyRow[],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (rows.length === 0 || rows[0]?.from !== period.start || rows.at(-1)?.to !== period.endExclusive) return false;
  return rows.every((row, index) => {
    const previous = rows[index - 1];
    return /^\d{4}-\d{2}-\d{2}$/u.test(row.localDate)
      && Number.isFinite(Date.parse(row.from))
      && Number.isFinite(Date.parse(row.to))
      && Date.parse(row.to) - Date.parse(row.from) === 86_400_000
      && (!previous || (previous.to === row.from && previous.localDate < row.localDate));
  });
}

function validDailyAnomalyRow(
  row: DailyAnomalyRow,
  selectedScope: { id: string; name: string },
  expectedImmediateLevels: Array<{ id: string; name: string }>,
  bundle: DailyAnomalyBundle,
): boolean {
  const baselineDatesValid = row.baselineSampleCount === row.baselineDates.length
    && row.baselineSamples.length === row.baselineDates.length
    && row.baselineDates.every((date, index) => (
      /^\d{4}-\d{2}-\d{2}$/u.test(date)
      && date < bundle.baselineCutoff
      && (index === 0 || row.baselineDates[index - 1]! < date)
      && validEligibleBaselineSample(row.baselineSamples[index], date)
    ));
  const thresholdsValid = row.thresholds.relativeThresholdPct === bundle.rule.relativeThresholdPct
    && row.thresholds.absoluteImpactKwh === bundle.rule.absoluteImpactKwh
    && row.thresholds.minimumCoveragePct === bundle.rule.minimumCoveragePct
    && row.thresholds.maximumQualityEventCount === bundle.rule.maximumQualityEventCount;
  const identityValid = row.ruleRevisionId === bundle.ruleRevisionId
    && row.metricId === bundle.metricId
    && row.queryId === bundle.queryId
    && (row.dayType === "weekday" || row.dayType === "weekend" || row.dayType === null)
    && (row.outcome === "triggered" || row.outcome === "within_threshold" || row.outcome === "suppressed");
  if (!identityValid || !baselineDatesValid || !thresholdsValid || !validAnomalyHealth(row)) return false;
  if (
    row.hourlyComparison.length !== 24
    || !row.hourlyComparison.every((point, index) => (
      point.localHour === index
      && finiteNonNegativeOrNull(point.actualKwh)
      && finiteNonNegativeOrNull(point.baselineKwh)
      && finiteOrNull(point.impactKwh)
      && finiteOrNull(point.relativePct)
    ))
  ) return false;
  const suppressed = row.outcome === "suppressed";
  const validSuppression = suppressed
    ? Boolean(row.suppressionReason?.message)
      && DAILY_ANOMALY_SUPPRESSION_CODES.has(row.suppressionReason!.code)
    : row.suppressionReason === undefined;
  if (!validSuppression) return false;
  if (row.outcome === "triggered" || row.outcome === "within_threshold") {
    if (
      row.dayType === null
      || row.baselineSampleCount !== bundle.rule.minimumSampleCount
      || row.coveragePct < bundle.rule.minimumCoveragePct
      || row.qualityEventCount !== bundle.rule.maximumQualityEventCount
      || !finiteNonNegative(row.actualKwh)
      || !finiteNonNegative(row.baselineKwh)
      || row.baselineKwh <= 0
      || !Number.isFinite(row.impactKwh)
      || !Number.isFinite(row.relativePct)
    ) return false;
    if (!validDailyAnomalyDerivedValues(row, bundle.rule)) return false;
  } else if (
    !finiteNonNegativeOrNull(row.actualKwh)
    || !finiteNonNegativeOrNull(row.baselineKwh)
    || !finiteOrNull(row.impactKwh)
    || !finiteOrNull(row.relativePct)
  ) return false;
  if (row.outcome !== "triggered") return true;
  if (
    row.impactKwh === null
    || row.relativePct === null
    || row.hourlyComparison.some((point) => (
      point.actualKwh === null || point.baselineKwh === null || point.impactKwh === null
    ))
  ) return false;
  return validTriggeredDetailSeries(row, selectedScope, expectedImmediateLevels);
}

function validDailyAnomalyDerivedValues(
  row: DailyAnomalyRow,
  rule: DailyAnomalyBundle["rule"],
): boolean {
  if (
    row.actualKwh === null
    || row.baselineKwh === null
    || row.impactKwh === null
    || row.relativePct === null
    || row.baselineKwh <= 0
  ) return false;
  const expectedImpact = row.actualKwh - row.baselineKwh;
  const expectedRelativePct = (expectedImpact / row.baselineKwh) * 100;
  // The server serializes actual, baseline and derived values independently to
  // four decimals. Re-deriving from those serialized inputs can differ by one
  // final decimal without changing the governed rule result.
  if (!approximatelyEqual(row.impactKwh, expectedImpact, 0.0002)
    || !relativePctFitsFourDecimalInputs({
      actualKwh: row.actualKwh,
      baselineKwh: row.baselineKwh,
      relativePct: row.relativePct,
    })) return false;
  const shouldTrigger = expectedImpact >= rule.absoluteImpactKwh
    && expectedRelativePct >= rule.relativeThresholdPct;
  return shouldTrigger ? row.outcome === "triggered" : row.outcome === "within_threshold";
}

function relativePctFitsFourDecimalInputs(input: {
  actualKwh: number;
  baselineKwh: number;
  relativePct: number;
}): boolean {
  const halfSerializationUnit = 0.00005;
  if (input.baselineKwh <= halfSerializationUnit) return false;
  const expected = ((input.actualKwh - input.baselineKwh) / input.baselineKwh) * 100;
  if (approximatelyEqual(input.relativePct, expected, 0.001)) return true;
  // Independent four-decimal serialization of actual and baseline values can
  // widen the explainable percentage interval when the baseline is small.
  const minimum = (
    (input.actualKwh - halfSerializationUnit) / (input.baselineKwh + halfSerializationUnit) - 1
  ) * 100 - halfSerializationUnit;
  const maximum = (
    (input.actualKwh + halfSerializationUnit) / (input.baselineKwh - halfSerializationUnit) - 1
  ) * 100 + halfSerializationUnit;
  return input.relativePct >= minimum && input.relativePct <= maximum;
}

function approximatelyEqual(left: number, right: number, absoluteTolerance: number): boolean {
  return Math.abs(left - right) <= Math.max(
    absoluteTolerance,
    Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9,
  );
}

function validEligibleBaselineSample(
  sample: DailyAnomalyRow["baselineSamples"][number] | undefined,
  localDate: string,
): boolean {
  return Boolean(sample)
    && sample!.localDate === localDate
    && sample!.eligible === true
    && validAnomalyHealth(sample!)
    && sample!.coveragePct === 100
    && sample!.validIntervalCount === sample!.expectedMeterIntervalCount
    && sample!.qualityEventCount === 0;
}

function validAnomalyHealth(health: {
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): boolean {
  return validPercentage(health.coveragePct)
    && Number.isInteger(health.expectedMeterIntervalCount)
    && health.expectedMeterIntervalCount > 0
    && Number.isInteger(health.validIntervalCount)
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && Number.isInteger(health.qualityEventCount)
    && health.qualityEventCount >= 0;
}

function validTriggeredDetailSeries(
  row: DailyAnomalyRow,
  selectedScope: { id: string; name: string },
  expectedImmediateLevels: Array<{ id: string; name: string }>,
): boolean {
  const ids = new Set<string>();
  const selected = row.detailSeries.filter((series) => series.relationship === "selected_scope");
  const officialSpine = row.detailSeries.filter((series) => series.kind === "official_scope");
  const expectedOfficialSpine = [
    { relationship: "selected_scope", ...selectedScope },
    ...expectedImmediateLevels.map((level) => ({ relationship: "immediate_level", ...level })),
  ];
  if (
    selected.length !== 1
    || officialSpine.length !== expectedOfficialSpine.length
    || officialSpine.some((series, index) => {
      const expected = expectedOfficialSpine[index];
      return !expected
        || series.relationship !== expected.relationship
        || series.scopeId !== expected.id
        || series.scopeName !== expected.name;
    })
  ) return false;
  return row.detailSeries.length > 0 && row.detailSeries.every((series) => {
    if (!series.seriesId || ids.has(series.seriesId) || !series.scopeId || !series.scopeName) return false;
    ids.add(series.seriesId);
    const relationshipValid = series.relationship === "component_circuit"
      ? series.kind === "component_circuit"
        && series.includedInOfficialTotal === false
        && Boolean(series.meterNodeId)
        && (series.category === "load" || series.category === "light")
      : (series.relationship === "selected_scope" || series.relationship === "immediate_level")
        && series.kind === "official_scope"
        && series.includedInOfficialTotal === true;
    const pointsValid = series.points.length === 24 && series.points.every((point, index) => (
      point.localHour === index
      && finiteNonNegativeOrNull(point.selectedKwh)
      && finiteNonNegativeOrNull(point.baselineKwh)
      && finiteOrNull(point.impactKwh)
    ));
    if (
      !relationshipValid
      || !pointsValid
      || !validAnomalyHealth(series)
      || (series.status !== "available" && series.status !== "partial" && series.status !== "unavailable")
    ) return false;
    if (series.status === "available") {
      return finiteNonNegative(series.selectedTotalKwh)
        && finiteNonNegative(series.baselineTotalKwh)
        && Number.isFinite(series.impactKwh)
        && finiteOrNull(series.relativePct)
        && series.points.every((point) => point.selectedKwh !== null && point.baselineKwh !== null && point.impactKwh !== null);
    }
    return finiteNonNegativeOrNull(series.selectedTotalKwh)
      && finiteNonNegativeOrNull(series.baselineTotalKwh)
      && finiteOrNull(series.impactKwh)
      && finiteOrNull(series.relativePct);
  }) && selected[0]!.points.every((point, index) => {
    const comparison = row.hourlyComparison[index]!;
    return point.selectedKwh === comparison.actualKwh
      && point.baselineKwh === comparison.baselineKwh
      && point.impactKwh === comparison.impactKwh;
  });
}

function finiteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

function finiteNonNegativeOrNull(value: number | null): boolean {
  return value === null || finiteNonNegative(value);
}

function timeBehaviourEvidence(snapshot: EnergyProjectAnalysisSnapshotDto): TimeBehaviourEvidence {
  return {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.total_usage_kwh@1",
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    timezone: snapshot.analysis.timeBehaviour?.timezone ?? snapshot.context.timezone,
    unit: "kWh",
    queryIds: ["time_bucket_grid_v1"],
  };
}

function componentHourlyEvidence(snapshot: EnergyProjectAnalysisSnapshotDto): ComponentHourlyEvidence {
  return {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.total_usage_kwh@1",
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    timezone: snapshot.analysis.componentHourlyProfiles?.timezone ?? snapshot.context.timezone,
    unit: "kWh",
    queryIds: ["component_hourly_profiles_v1"],
    accountingBasis: "published_component_circuits",
  };
}

function buildOperatingPolicySummary(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): NgeeAnnDayProfileViewModel["operatingPolicy"] {
  const source = snapshot.analysis.offHours;
  const unavailable = (reason: string): NgeeAnnDayProfileViewModel["operatingPolicy"] => ({
    status: "unavailable",
    reason,
  });
  if (source.status !== "available") {
    return unavailable(source.reason.message || "The release-pinned operating-policy split is unavailable.");
  }
  const valuesValid = [
    source.operatingKwh,
    source.standbyKwh,
    source.usageKwh,
    source.sharePct,
  ].every(finiteNonNegative);
  const totalUsageKwh = source.operatingKwh + source.standbyKwh;
  const expectedShare = totalUsageKwh > 0 ? source.standbyKwh / totalUsageKwh * 100 : 0;
  const contractValid = valuesValid
    && source.timezone === snapshot.context.timezone
    && source.businessCalendarVersion === snapshot.context.businessCalendarVersion
    // The API offHours contract exposes usageKwh as the non-operating subtotal.
    && Math.abs(source.usageKwh - source.standbyKwh) <= 0.1
    && Math.abs(totalUsageKwh - snapshot.analysis.summary.usageKwh) <= 0.1
    && Math.abs(source.sharePct - expectedShare) <= 0.1;
  if (!contractValid) {
    return unavailable("The release-pinned operating-policy split does not match this Snapshot context.");
  }
  return {
    status: "available",
    reason: null,
    operatingUsageKwh: source.operatingKwh,
    operatingUsage: formatFixedCustomerDecimal(source.operatingKwh, 1),
    standbyUsageKwh: source.standbyKwh,
    standbyUsage: formatFixedCustomerDecimal(source.standbyKwh, 1),
    standbySharePct: source.sharePct,
    standbyShare: `${formatFixedCustomerDecimal(source.sharePct, 1)}%`,
    timezone: source.timezone,
    businessCalendarVersion: source.businessCalendarVersion,
  };
}

function buildDayProfile(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
  operatingPolicySnapshot: EnergyProjectAnalysisSnapshotDto = snapshot,
): NgeeAnnDayProfileViewModel {
  const evidence = timeBehaviourEvidence(snapshot);
  const componentEvidence = componentHourlyEvidence(snapshot);
  const operatingPolicy = buildOperatingPolicySummary(operatingPolicySnapshot);
  const unavailable = (reason: string): NgeeAnnDayProfileViewModel => ({
    status: "unavailable",
    decisionQuestion: "How does the observed 24-hour energy shape change by Day Type and Scope?",
    reason,
    operatingPolicy,
    scopes: [],
    profiles: [],
    holidayInsight: { status: "unavailable", reason },
    evidence,
    componentEvidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support a Day Profile for this Period.");
  }
  if (snapshot.context.scopeType !== "project") {
    return unavailable("Select the Project Scope to compare Project and Level Day Profiles.");
  }
  const projection = validDayProfileProjection(snapshot);
  if (!projection.valid) {
    return unavailable(projection.reason);
  }
  const profiles = snapshot.analysis.timeBehaviour!.dayProfiles;
  const expectedKeys = new Set(projection.scopes.flatMap((scope) => (
    ["weekday", "weekend", "public_holiday"].map((dayType) => `${scope.scopeId}:${dayType}`)
  )));
  const seenKeys = new Set<string>();
  const validProfiles = profiles.length === expectedKeys.size && profiles.every((profile) => {
    const scope = projection.scopes.find((candidate) => candidate.scopeId === profile.scopeId);
    const key = `${profile.scopeId}:${profile.dayType}`;
    if (!scope || profile.scopeName !== scope.scopeName || !expectedKeys.has(key) || seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    if (profile.status === "unavailable") {
      return Boolean(profile.reason.message)
        && (profile.reason.code === "COMPLETE_DAY_SAMPLE_UNAVAILABLE"
          || profile.reason.code === "DAY_TYPE_CLASSIFICATION_UNAVAILABLE");
    }
    return Number.isInteger(profile.sampleDayCount)
      && profile.sampleDayCount > 0
      && profile.values.length === 24
      && profile.values.every((value, index) => (
        value.localHour === index && finiteNonNegative(value.usageKwh)
      ));
  });
  if (!validProfiles || seenKeys.size !== expectedKeys.size) {
    return unavailable("The server Day Profile contract is incomplete or invalid.");
  }
  const componentProjection = validComponentHourlyProfiles(snapshot);
  const projectedProfiles: NgeeAnnDayProfileViewModel["profiles"] = profiles.map((profile) => {
      const peak = profile.status === "available"
        ? profile.values.reduce((current, candidate) => (
          candidate.usageKwh > current.usageKwh ? candidate : current
        ))
        : null;
      const dailyUsageKwh = profile.status === "available"
        ? roundDisplayValue(profile.values.reduce((sum, value) => sum + value.usageKwh, 0))
        : null;
      const componentProfile = componentProjection.valid
        ? componentProjection.source.scopes
          .find((scope) => scope.scopeId === profile.scopeId)?.profiles
          .find((candidate) => candidate.dayType === profile.dayType)
        : null;
      const componentStack = !componentProjection.valid
        ? {
          status: "unavailable" as const,
          reason: componentProjection.reason,
        }
        : !componentProfile || componentProfile.status === "unavailable"
          ? {
            status: "unavailable" as const,
            reason: componentProfile?.status === "unavailable"
              ? componentProfile.reason.message
              : "No server-published component hourly profile is available for this selection.",
          }
          : profile.status !== "available" || componentProfile.sampleDayCount !== profile.sampleDayCount
            ? {
              status: "unavailable" as const,
              reason: "The official Scope and component hourly profiles do not use the same complete-day sample.",
            }
            : {
              status: "available" as const,
              sampleDayCount: componentProfile.sampleDayCount,
              categories: componentProfile.categories.map((category) => ({
                category: category.category,
                categoryLabel: formatCategoryLabel(category.category),
                values: category.values.map((value) => ({
                  id: `${profile.scopeId}:${profile.dayType}:${category.category}:${value.localHour}`,
                  localHour: value.localHour,
                  hourLabel: formatLocalHour(value.localHour),
                  acceptedUsageKwh: value.usageKwh,
                  usageKwh: formatDecimal(value.usageKwh, 4),
                })),
              })),
            };
      return {
        id: `${profile.scopeId}:${profile.dayType}`,
        dayType: profile.dayType,
        dayTypeLabel: dayTypeLabel(profile.dayType),
        scopeId: profile.scopeId,
        scopeName: profile.scopeId === snapshot.context.scopeId ? "Project" : profile.scopeName,
        status: profile.status,
        sampleDayCount: profile.status === "available" ? profile.sampleDayCount : null,
        reason: profile.status === "unavailable" ? profile.reason.message : null,
        summary: profile.status === "unavailable"
          ? { status: "unavailable" as const, reason: profile.reason.message }
          : {
            status: "available" as const,
            peakHour: peak!.localHour,
            peakHourLabel: formatLocalHour(peak!.localHour),
            peakUsageKwh: peak!.usageKwh,
            peakUsage: formatDecimal(peak!.usageKwh, 4),
            dailyUsageKwh: dailyUsageKwh!,
            dailyUsage: formatFixedCustomerDecimal(dailyUsageKwh!, 1),
            sampleDayCount: profile.sampleDayCount,
          },
        values: profile.status === "available"
          ? profile.values.map((value) => ({
            id: `${profile.scopeId}:${profile.dayType}:${value.localHour}`,
            localHour: value.localHour,
            hourLabel: formatLocalHour(value.localHour),
            acceptedUsageKwh: value.usageKwh,
            usageKwh: formatDecimal(value.usageKwh, 4),
          }))
          : [],
        componentStack,
      };
    });
  const holidayInsight = buildHolidayInsight(projectedProfiles, snapshot.context.scopeId);

  return {
    status: "available",
    decisionQuestion: "How does the observed 24-hour energy shape change by Day Type and Scope?",
    reason: null,
    operatingPolicy,
    scopes: projection.scopes.map((scope) => ({
      id: scope.scopeId,
      name: scope.scopeType === "project" ? "Project" : scope.scopeName,
    })),
    profiles: projectedProfiles,
    holidayInsight,
    evidence,
    componentEvidence,
  };
}

function buildHolidayInsight(
  profiles: NgeeAnnDayProfileViewModel["profiles"],
  projectScopeId: string,
): NgeeAnnDayProfileViewModel["holidayInsight"] {
  const holiday = profiles.find((profile) => (
    profile.scopeId === projectScopeId
    && profile.dayType === "public_holiday"
    && profile.status === "available"
    && profile.summary.status === "available"
  ));
  const weekend = profiles.find((profile) => (
    profile.scopeId === projectScopeId
    && profile.dayType === "weekend"
    && profile.status === "available"
    && profile.summary.status === "available"
  ));
  if (!holiday || !weekend || holiday.summary.status !== "available" || weekend.summary.status !== "available") {
    return {
      status: "unavailable",
      reason: "A complete Public Holiday and Weekend Project profile is required for this comparison.",
    };
  }
  if (weekend.summary.dailyUsageKwh <= 0) {
    return {
      status: "unavailable",
      reason: "The Weekend reference is zero, so a relative Public Holiday comparison is unavailable.",
    };
  }
  const differencePct = (holiday.summary.dailyUsageKwh - weekend.summary.dailyUsageKwh)
    / weekend.summary.dailyUsageKwh * 100;
  const absoluteDifferencePct = Math.abs(differencePct);
  const headline = absoluteDifferencePct < 0.05
    ? "Public Holiday use was close to Weekend levels"
    : differencePct > 0
      ? "Public Holiday use stayed above Weekend levels"
      : "Public Holiday use stayed below Weekend levels";
  const relationship = absoluteDifferencePct < 0.05
    ? "about the same as"
    : `${formatFixedCustomerDecimal(absoluteDifferencePct, 1)}% ${differencePct > 0 ? "above" : "below"}`;
  return {
    status: "available",
    headline,
    detail: `Public Holidays averaged ${holiday.summary.dailyUsage} kWh/day, ${relationship} the Weekend average of ${weekend.summary.dailyUsage} kWh/day.`,
    angle: "A useful follow-up is whether lighting, office loads or scheduled ventilation kept a weekday-like pattern.",
    caveat: `Observed across ${holiday.summary.sampleDayCount} complete Public ${holiday.summary.sampleDayCount === 1 ? "Holiday" : "Holidays"} and ${weekend.summary.sampleDayCount} complete Weekend ${weekend.summary.sampleDayCount === 1 ? "day" : "days"}. Treat this as a small-sample signal, not a proven cause.`,
  };
}

function buildUsageHeatmap(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnUsageHeatmapViewModel {
  const evidence = timeBehaviourEvidence(snapshot);
  const componentEvidence = componentHourlyEvidence(snapshot);
  const unavailable = (reason: string): NgeeAnnUsageHeatmapViewModel => ({
    status: "unavailable",
    decisionQuestion: "Which local date, Level and hour cell needs inspection?",
    reason,
    defaultView: "date-hour",
    dates: [],
    averageProfiles: [],
    circuitProfiles: [],
    scopes: [],
    evidence,
    componentEvidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support an hourly Usage heatmap for this Period.");
  }
  if (snapshot.context.scopeType !== "project") {
    return unavailable("Select the Project Scope to inspect Project and Level hourly cells.");
  }
  const grid = validTimeGrid(snapshot);
  if (!grid.valid) {
    return unavailable(grid.reason);
  }
  const firstScope = grid.scopes[0]!;
  const dayProfile = buildDayProfile(snapshot, false);
  const averageProfiles = dayProfile.status === "available"
    ? dayProfile.profiles.flatMap((profile) => (
      profile.status === "available" && (profile.dayType === "weekday" || profile.dayType === "weekend")
        ? [{
            id: profile.id,
            dayType: profile.dayType,
            dayTypeLabel: profile.dayType === "weekday" ? "Weekday" as const : "Weekend" as const,
            scopeId: profile.scopeId,
            scopeName: profile.scopeName,
            sampleDayCount: profile.sampleDayCount!,
            dailyUsageKwh: profile.summary.status === "available" ? profile.summary.dailyUsageKwh : 0,
            dailyUsage: profile.summary.status === "available" ? profile.summary.dailyUsage : "Unavailable",
            peakHourLabel: profile.summary.status === "available" ? profile.summary.peakHourLabel : "Unavailable",
            peakUsage: profile.summary.status === "available" ? profile.summary.peakUsage : "Unavailable",
            values: profile.values,
          }]
        : []
    ))
    : [];
  const componentProjection = validComponentHourlyProfiles(snapshot);
  const circuitProfiles = componentProjection.valid
    ? componentProjection.source.scopes.flatMap((scope) => (
      scope.scopeType !== "level"
        ? []
        : scope.profiles.flatMap((profile) => (
          profile.status === "available" && (profile.dayType === "weekday" || profile.dayType === "weekend")
            ? [{
              id: `${scope.scopeId}:${profile.dayType}`,
              levelScopeId: scope.scopeId,
              levelScopeName: scope.scopeName,
              dayType: profile.dayType,
              dayTypeLabel: profile.dayType === "weekday" ? "Weekday" as const : "Weekend" as const,
              sampleDayCount: profile.sampleDayCount,
              circuits: profile.circuits.map((circuit) => ({
                meterNodeId: circuit.meterNodeId,
                name: circuit.name,
                category: circuit.category,
                categoryLabel: formatCategoryLabel(circuit.category),
                values: circuit.values.map((value) => ({
                  id: `${scope.scopeId}:${profile.dayType}:${circuit.meterNodeId}:${value.localHour}`,
                  localHour: value.localHour,
                  hourLabel: formatLocalHour(value.localHour),
                  acceptedUsageKwh: value.usageKwh,
                  usageKwh: formatDecimal(value.usageKwh, 4),
                })),
              })),
            }]
            : []
        ))
    ))
    : [];
  const dates = firstScope.cells
    .filter((cell) => cell.localHour === 0)
    .map((cell) => ({
      id: cell.localDate,
      label: formatLocalDate(cell.localDate),
      weekday: formatLocalWeekday(cell.localDate),
    }));

  return {
    status: "available",
    decisionQuestion: "Which recurring local hour pattern or individual date needs inspection?",
    reason: null,
    defaultView: circuitProfiles.length > 0 ? "level-hour" : "date-hour",
    dates,
    averageProfiles,
    circuitProfiles,
    scopes: grid.scopes.map((scope) => ({
      id: scope.scopeId,
      name: scope.scopeType === "project" ? "Project" : scope.scopeName,
      cells: scope.cells.map((cell) => ({
        id: `${scope.scopeId}:${cell.localDate}:${cell.localHour}`,
        scopeId: scope.scopeId,
        localDate: cell.localDate,
        dateLabel: formatLocalDate(cell.localDate),
        weekday: formatLocalWeekday(cell.localDate),
        localHour: cell.localHour,
        hourLabel: formatLocalHour(cell.localHour),
        range: formatEvidenceRange(cell.from, cell.to, snapshot.analysis.timeBehaviour!.timezone),
        acceptedUsageKwh: cell.usageKwh,
        usageKwh: cell.usageKwh === null ? null : formatDecimal(cell.usageKwh, 4),
        quality: timePointQuality(cell.dataHealth),
      })),
    })),
    evidence,
    componentEvidence,
  };
}

function validComponentHourlyProfiles(snapshot: EnergyProjectAnalysisSnapshotDto):
  | { valid: true; source: ComponentHourlyProjection }
  | { valid: false; reason: string } {
  const { analysis, context } = snapshot;
  const source = analysis.componentHourlyProfiles;
  const invalid = (detail: string) => ({
    valid: false as const,
    reason: `The server component hourly contract is unavailable or invalid: ${detail}`,
  });
  if (!source) return invalid("no published projection was supplied.");
  const hasEvidence = snapshot.evidence.some((reference) => (
    reference.metricId === "energy.total_usage_kwh@1"
    && reference.queryIds.includes("component_hourly_profiles_v1")
  ));
  if (
    source.metricId !== "energy.total_usage_kwh@1"
    || source.queryId !== "component_hourly_profiles_v1"
    || source.accountingBasis !== "published_component_circuits"
    || source.grain !== "hour"
    || source.unit !== "kWh"
    || source.timezone !== context.timezone
    || !analysis.provenance.queryIds.includes("component_hourly_profiles_v1")
    || !hasEvidence
  ) return invalid("its metric, accounting basis, timezone or query evidence does not match this Snapshot.");

  const reconciliation = analysis.componentReconciliation;
  if (!reconciliation || reconciliation.componentMeterNodeIds.length === 0) {
    return invalid("the published component-Circuit identity set is missing.");
  }
  const componentIds = new Set(reconciliation.componentMeterNodeIds);
  const expectedCircuits = analysis.topCircuits.filter((circuit) => componentIds.has(circuit.meterNodeId));
  if (
    expectedCircuits.length !== componentIds.size
    || expectedCircuits.some((circuit) => (
      circuit.includedInOfficialTotal !== false
      || !circuit.parentScopeId
      || !circuit.name
      || !circuit.category
    ))
  ) return invalid("the component-Circuit metadata is incomplete or inconsistent.");

  const expectedScopes = [
    { scopeId: context.scopeId, scopeName: context.scopeName, scopeType: "project" },
    ...analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => ({ scopeId: scope.nodeId, scopeName: scope.name, scopeType: "level" })),
  ];
  if (
    source.scopes.length !== expectedScopes.length
    || source.scopes.some((scope, index) => {
      const expected = expectedScopes[index];
      return !expected
        || scope.scopeId !== expected.scopeId
        || scope.scopeName !== expected.scopeName
        || scope.scopeType !== expected.scopeType;
    })
  ) return invalid("its Project and Level Scope spine is incomplete or out of order.");

  for (const scope of source.scopes) {
    const expectedForScope = scope.scopeType === "project"
      ? expectedCircuits
      : expectedCircuits.filter((circuit) => circuit.parentScopeId === scope.scopeId);
    const expectedIds = new Set(expectedForScope.map((circuit) => circuit.meterNodeId));
    const expectedCategories = new Set(expectedForScope.map((circuit) => circuit.category));
    const profileKeys = new Set<string>();
    if (scope.profiles.length !== 3) return invalid(`${scope.scopeName} does not publish all three Day Type states.`);
    for (const profile of scope.profiles) {
      if (profileKeys.has(profile.dayType)) return invalid(`${scope.scopeName} repeats a Day Type profile.`);
      profileKeys.add(profile.dayType);
      if (profile.status === "unavailable") {
        if (
          !profile.reason.message
          || (profile.reason.code !== "COMPLETE_DAY_SAMPLE_UNAVAILABLE"
            && profile.reason.code !== "DAY_TYPE_CLASSIFICATION_UNAVAILABLE")
        ) return invalid(`${scope.scopeName} has an invalid unavailable Day Type state.`);
        continue;
      }
      if (!Number.isInteger(profile.sampleDayCount) || profile.sampleDayCount <= 0) {
        return invalid(`${scope.scopeName} has an invalid complete-day sample.`);
      }
      const circuitRowIds = new Set(profile.circuits.map((circuit) => circuit.meterNodeId));
      const categoryIds = new Set(profile.categories.map((category) => category.category));
      if (
        circuitRowIds.size !== expectedIds.size
        || [...expectedIds].some((id) => !circuitRowIds.has(id))
        || categoryIds.size !== expectedCategories.size
        || [...expectedCategories].some((category) => !categoryIds.has(category))
      ) return invalid(`${scope.scopeName} has a missing or extra Category/Circuit row.`);
      if (profile.circuits.some((circuit) => {
        const expected = expectedForScope.find((candidate) => candidate.meterNodeId === circuit.meterNodeId);
        return !expected
          || circuit.name !== expected.name
          || circuit.category !== expected.category
          || !validHourlyValues(circuit.values);
      })) return invalid(`${scope.scopeName} has invalid Circuit identity or hourly values.`);
      if (profile.categories.some((category) => !validHourlyValues(category.values))) {
        return invalid(`${scope.scopeName} has invalid Category hourly values.`);
      }
      for (let localHour = 0; localHour < 24; localHour += 1) {
        const categoryTotal = profile.categories.reduce((sum, category) => sum + category.values[localHour]!.usageKwh, 0);
        const circuitTotal = profile.circuits.reduce((sum, circuit) => sum + circuit.values[localHour]!.usageKwh, 0);
        if (!approximatelyEqual(categoryTotal, circuitTotal, 0.001)) {
          return invalid(`${scope.scopeName} Category and Circuit hourly totals do not reconcile.`);
        }
      }
    }
    if (!["weekday", "weekend", "public_holiday"].every((dayType) => profileKeys.has(dayType))) {
      return invalid(`${scope.scopeName} does not publish the required Day Type identities.`);
    }
  }
  return { valid: true, source };
}

function validHourlyValues(values: Array<{ localHour: number; usageKwh: number }>): boolean {
  return values.length === 24 && values.every((value, index) => (
    value.localHour === index && finiteNonNegative(value.usageKwh)
  ));
}

function validTimeGrid(snapshot: EnergyProjectAnalysisSnapshotDto):
  | { valid: true; scopes: TimeScope[] }
  | { valid: false; reason: string } {
  const projection = validDayProfileProjection(snapshot);
  if (!projection.valid) return projection;
  const { context } = snapshot;
  const timeBehaviour = snapshot.analysis.timeBehaviour!;
  const projectCells = timeBehaviour.scopes[0]?.cells;
  if (!projectCells || !validTimeSpine(projectCells, context.primaryPeriod)) {
    return { valid: false, reason: "The hourly grid time spine is incomplete or invalid." };
  }
  const spine = projectCells.map((cell) => `${cell.localDate}|${cell.localHour}|${cell.from}|${cell.to}`);
  if (timeBehaviour.scopes.some((scope) => (
    scope.cells.length !== spine.length
    || scope.cells.some((cell, index) => (
      `${cell.localDate}|${cell.localHour}|${cell.from}|${cell.to}` !== spine[index]
      || !validTimeCell(cell)
    ))
  ))) {
    return { valid: false, reason: "The hourly grid cells do not share one valid authoritative time spine." };
  }
  return projection;
}

function validDayProfileProjection(snapshot: EnergyProjectAnalysisSnapshotDto):
  | { valid: true; scopes: TimeScope[] }
  | { valid: false; reason: string } {
  const { analysis, context, projectRelease } = snapshot;
  const timeBehaviour = analysis.timeBehaviour;
  if (!timeBehaviour) {
    return { valid: false, reason: "This published Snapshot does not include the authoritative hourly Day Profile projection." };
  }
  const hasEvidence = snapshot.evidence.some((reference) => (
    reference.metricId === "energy.total_usage_kwh@1"
    && reference.queryIds.includes("time_bucket_grid_v1")
  ));
  const pinsValid = context.projectReleaseId === projectRelease.id
    && context.projectId === projectRelease.projectId
    && analysis.context.projectId === projectRelease.projectId
    && analysis.provenance.dataSnapshotId === snapshot.dataSnapshot.id
    && context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.provenance.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.provenance.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.provenance.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && projectRelease.metricRevisionIds.includes("energy.total_usage_kwh@1")
    && hasEvidence;
  if (!pinsValid) {
    return { valid: false, reason: "The hourly grid Snapshot, Release or revision evidence pins are inconsistent." };
  }
  if (
    timeBehaviour.metricId !== "energy.total_usage_kwh@1"
    || timeBehaviour.grain !== "hour"
    || timeBehaviour.unit !== "kWh"
    || timeBehaviour.timezone !== context.timezone
    || timeBehaviour.queryId !== "time_bucket_grid_v1"
    || !analysis.provenance.queryIds.includes("time_bucket_grid_v1")
  ) {
    return { valid: false, reason: "The hourly grid metric, grain, timezone, unit or query evidence is invalid." };
  }
  const expectedScopes = [
    { id: context.scopeId, name: context.scopeName, type: "project" },
    ...analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => ({ id: scope.nodeId, name: scope.name, type: scope.nodeType })),
  ];
  if (
    expectedScopes.length !== 3
    || timeBehaviour.scopes.length !== expectedScopes.length
    || timeBehaviour.scopes.some((scope, index) => {
      const expected = expectedScopes[index];
      return !expected
        || scope.scopeId !== expected.id
        || scope.scopeName !== expected.name
        || scope.scopeType !== expected.type;
    })
  ) {
    return { valid: false, reason: "The hourly grid Scope contract is incomplete or out of order." };
  }
  return { valid: true, scopes: timeBehaviour.scopes };
}

function validTimeSpine(
  cells: TimeCell[],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (
    cells.length === 0
    || cells.length % 24 !== 0
    || cells[0]?.from !== period.start
    || cells.at(-1)?.to !== period.endExclusive
  ) {
    return false;
  }
  return cells.every((cell, index) => {
    const previous = cells[index - 1];
    return /^\d{4}-\d{2}-\d{2}$/u.test(cell.localDate)
      && Number.isInteger(cell.localHour)
      && cell.localHour === index % 24
      && Number.isFinite(Date.parse(cell.from))
      && Number.isFinite(Date.parse(cell.to))
      && Date.parse(cell.from) < Date.parse(cell.to)
      && Date.parse(cell.to) - Date.parse(cell.from) === 3_600_000
      && (!previous || previous.to === cell.from)
      && (cell.localHour !== 0 || index === 0 || previous?.localDate < cell.localDate);
  });
}

function validTimeCell(cell: TimeCell): boolean {
  const health = cell.dataHealth;
  const countsValid = Number.isFinite(health.coveragePct)
    && health.coveragePct >= 0
    && health.coveragePct <= 100
    && Number.isInteger(health.expectedMeterIntervalCount)
    && health.expectedMeterIntervalCount >= 0
    && Number.isInteger(health.validIntervalCount)
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && Number.isInteger(health.qualityEventCount)
    && health.qualityEventCount >= 0;
  if (!countsValid) return false;
  if (health.status === "complete") {
    return health.coveragePct === 100
      && health.expectedMeterIntervalCount > 0
      && health.validIntervalCount === health.expectedMeterIntervalCount
      && health.qualityEventCount === 0
      && finiteNonNegative(cell.usageKwh);
  }
  if (health.status === "partial") {
    return health.expectedMeterIntervalCount > 0
      && health.validIntervalCount > 0
      && (health.validIntervalCount < health.expectedMeterIntervalCount || health.qualityEventCount > 0)
      && finiteNonNegative(cell.usageKwh);
  }
  return cell.usageKwh === null;
}

function timePointQuality(health: TimeCell["dataHealth"]): TimePointQuality {
  return {
    status: health.status,
    statusLabel: health.status === "complete" ? "Complete" : health.status === "partial" ? "Partial" : "Unavailable",
    coverage: `${formatDecimal(health.coveragePct, 1)}% coverage`,
    intervals: `${health.validIntervalCount.toLocaleString("en-SG")} / ${health.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
    qualityEvents: `${health.qualityEventCount.toLocaleString("en-SG")} quality events`,
  };
}

function timeScopeLimitation(cells: TimeCell[]): string | null {
  if (cells.some((cell) => cell.dataHealth.status === "unavailable")) {
    return "At least one hour has no accepted facts. The hour remains visible and is not zero-filled.";
  }
  if (cells.some((cell) => cell.dataHealth.status === "partial")) {
    return "At least one hour is partial. Accepted usage remains visible with its coverage.";
  }
  return null;
}

function dayTypeLabel(dayType: "weekday" | "weekend" | "public_holiday"):
  "Weekday" | "Weekend" | "Public Holiday" {
  return dayType === "weekday" ? "Weekday" : dayType === "weekend" ? "Weekend" : "Public Holiday";
}

function formatCategoryLabel(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function formatLocalHour(localHour: number): string {
  return `${String(localHour).padStart(2, "0")}:00`;
}

function buildEnergyTrend(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
  requestedGrain?: "day" | "hour",
): NgeeAnnEnergyTrendViewModel {
  const { analysis, context } = snapshot;
  const dailyTotals = analysis.dailyTotals;
  const timeBehaviour = analysis.timeBehaviour;
  const singleDay = isSingleLocalDayPeriod(context.primaryPeriod, context.timezone);
  const grain = singleDay ? requestedGrain ?? "hour" : "day";
  const queryId = grain === "hour" ? "time_bucket_grid_v1" : "daily_totals_v1";
  const evidence: NgeeAnnEnergyTrendViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.total_usage_kwh@1",
    period: `[${context.primaryPeriod.start}, ${context.primaryPeriod.endExclusive})`,
    timezone: grain === "hour" ? timeBehaviour?.timezone ?? context.timezone : dailyTotals?.timezone ?? context.timezone,
    unit: "kWh",
    queryIds: [queryId],
    baseline: null,
  };
  const unavailable = (reason: string): NgeeAnnEnergyTrendViewModel => ({
    status: "unavailable",
    grain,
    decisionQuestion: "When did accepted energy use change inside the selected Period?",
    reason,
    baselineOverlay: { status: "unavailable", reason, ruleRevisionId: null },
    scopes: [],
    evidence,
  });

  if (overviewUnavailable) {
    return unavailable("No trusted intervals support an Energy trend for this Period.");
  }
  if (context.scopeType !== "project") {
    return unavailable("Select the Project Scope to compare the Project, Level 7 and Level 6 trend.");
  }
  if (grain === "hour") {
    const grid = validTimeGrid(snapshot);
    if (!grid.valid) {
      return unavailable(grid.reason);
    }
    return {
      status: "available",
      grain: "hour",
      decisionQuestion: "Which accepted local hours drove energy use on the selected day?",
      reason: null,
      baselineOverlay: { status: "not_applicable", reason: null, ruleRevisionId: null },
      scopes: grid.scopes.map((scope) => ({
        id: scope.scopeId,
        name: scope.scopeType === "project" ? "Project" : scope.scopeName,
        limitation: timeScopeLimitation(scope.cells),
        points: scope.cells.map((cell) => ({
          id: `${scope.scopeId}:${cell.localDate}:${cell.localHour}`,
          localDate: cell.localDate,
          localHour: cell.localHour,
          dayType: null,
          dateLabel: formatLocalHour(cell.localHour),
          weekday: formatLocalDate(cell.localDate),
          range: formatEvidenceRange(cell.from, cell.to, timeBehaviour!.timezone),
          acceptedUsageKwh: cell.usageKwh,
          usageKwh: cell.usageKwh === null ? null : formatDecimal(cell.usageKwh, 4),
          baseline: null,
          ...timePointQuality(cell.dataHealth),
        })),
      })),
      evidence,
    };
  }
  if (!dailyTotals) {
    return unavailable("This published Snapshot does not include the authoritative daily totals contract.");
  }
  if (
    dailyTotals.metricId !== "energy.total_usage_kwh@1"
    || dailyTotals.grain !== "day"
    || dailyTotals.timezone !== context.timezone
    || !analysis.provenance.queryIds.includes("daily_totals_v1")
  ) {
    return unavailable("The daily totals identity, grain, timezone or query evidence is invalid.");
  }

  const expectedScopes = [
    { id: context.scopeId, name: context.scopeName, type: "project" },
    ...analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => ({ id: scope.nodeId, name: scope.name, type: scope.nodeType })),
  ];
  if (
    expectedScopes.length !== 3
    || dailyTotals.scopes.length !== expectedScopes.length
    || dailyTotals.scopes.some((scope, index) => {
      const expected = expectedScopes[index];
      return !expected
        || scope.scopeId !== expected.id
        || scope.scopeName !== expected.name
        || scope.scopeType !== expected.type;
    })
  ) {
    return unavailable("The daily totals Scope contract is incomplete or out of order.");
  }

  const projectRows = dailyTotals.scopes[0]?.rows;
  if (!projectRows || !validDailySpine(projectRows, context.primaryPeriod)) {
    return unavailable("The daily totals date spine is incomplete or invalid.");
  }
  const spine = projectRows.map((row) => `${row.localDate}|${row.from}|${row.to}`);
  if (dailyTotals.scopes.some((scope) =>
    scope.rows.length !== spine.length
    || scope.rows.some((row, index) => `${row.localDate}|${row.from}|${row.to}` !== spine[index])
    || scope.rows.some((row) => !validDailyPoint(row))
  )) {
    return unavailable("The daily totals rows do not share one valid authoritative date spine.");
  }

  const dailyBaseline = buildDailyTrendBaseline(snapshot, dailyTotals);
  const authoritativeDayTypes = resolveAuthoritativeTrendDayTypes(snapshot, dailyTotals);

  return {
    status: "available",
    grain: "day",
    decisionQuestion: "When did accepted energy use change inside the selected Period?",
    reason: null,
    baselineOverlay: dailyBaseline.overlay,
    scopes: dailyTotals.scopes.map((scope) => {
      const hasUnavailable = scope.rows.some((row) => row.dataHealth.status === "unavailable");
      const hasPartial = scope.rows.some((row) => row.dataHealth.status === "partial");
      return {
        id: scope.scopeId,
        name: scope.scopeType === "project" ? "Project" : scope.scopeName,
        limitation: hasUnavailable
          ? "At least one day has no accepted facts. The date remains visible and is not zero-filled."
          : hasPartial
            ? "At least one day is partial. Accepted usage remains visible with its coverage."
            : null,
        points: scope.rows.map((row) => {
          const anomalyDayType = dailyBaseline.dayTypes.get(scope.scopeId)?.get(row.localDate) ?? null;
          const authoritativeDayType = authoritativeDayTypes?.get(scope.scopeId)?.get(row.localDate) ?? null;
          const baseline = dailyBaseline.points.get(scope.scopeId)?.get(row.localDate) ?? null;
          const classificationChanged = authoritativeDayType !== null
            && anomalyDayType !== null
            && authoritativeDayType !== anomalyDayType;
          return {
            id: `${scope.scopeId}:${row.localDate}`,
            localDate: row.localDate,
            localHour: null,
            dayType: authoritativeDayType ?? anomalyDayType,
            dateLabel: formatLocalDate(row.localDate),
            weekday: formatLocalWeekday(row.localDate),
            range: formatEvidenceRange(row.from, row.to, dailyTotals.timezone),
            acceptedUsageKwh: row.usageKwh,
            usageKwh: row.usageKwh === null ? null : formatDecimal(row.usageKwh, 4),
            status: row.dataHealth.status,
            statusLabel: row.dataHealth.status === "complete"
              ? "Complete"
              : row.dataHealth.status === "partial"
                ? "Partial"
                : "Unavailable",
            coverage: `${formatDecimal(row.dataHealth.coveragePct, 1)}% coverage`,
            intervals: `${row.dataHealth.validIntervalCount.toLocaleString("en-SG")} / ${row.dataHealth.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
            qualityEvents: `${row.dataHealth.qualityEventCount.toLocaleString("en-SG")} quality events`,
            baseline: classificationChanged && baseline
              ? {
                  ...baseline,
                  outcome: "suppressed" as const,
                  outcomeLabel: "No rule conclusion — Calendar classification changed",
                  baselineKwh: null,
                  baselineUsageKwh: null,
                  deltaUsageKwh: null,
                  relativePctLabel: null,
                  incidentId: null,
                  limitation: "The release-pinned Day Type differs from the anomaly baseline classification.",
                }
              : baseline,
          };
        }),
      };
    }),
    evidence: { ...evidence, baseline: dailyBaseline.evidence },
  };
}

type DailyTotals = NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>;
type DailyTrendBaseline = NonNullable<
  NgeeAnnEnergyTrendViewModel["scopes"][number]["points"][number]["baseline"]
>;

function resolveAuthoritativeTrendDayTypes(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  dailyTotals: DailyTotals,
): Map<string, Map<string, "weekday" | "weekend" | "public_holiday">> | null {
  const source = snapshot.analysis.componentCategoryBreakdown;
  if (!source
    || source.metricId !== "energy.total_usage_kwh@1"
    || source.queryId !== "daily_component_categories_v1"
    || source.grain !== "day"
    || source.timezone !== dailyTotals.timezone
    || !snapshot.analysis.provenance.queryIds.includes(source.queryId)
    || source.scopes.length !== dailyTotals.scopes.length) return null;

  const result = new Map<string, Map<string, "weekday" | "weekend" | "public_holiday">>();
  for (const [scopeIndex, scope] of dailyTotals.scopes.entries()) {
    const classifiedScope = source.scopes[scopeIndex];
    if (!classifiedScope
      || classifiedScope.scopeId !== scope.scopeId
      || classifiedScope.scopeName !== scope.scopeName
      || classifiedScope.scopeType !== scope.scopeType
      || classifiedScope.rows.length !== scope.rows.length) return null;
    const dayTypes = new Map<string, "weekday" | "weekend" | "public_holiday">();
    for (const [rowIndex, row] of scope.rows.entries()) {
      const classifiedRow = classifiedScope.rows[rowIndex];
      if (!classifiedRow
        || classifiedRow.localDate !== row.localDate
        || classifiedRow.from !== row.from
        || classifiedRow.to !== row.to
        || !["weekday", "weekend", "public_holiday"].includes(classifiedRow.dayType ?? "")) return null;
      dayTypes.set(row.localDate, classifiedRow.dayType as "weekday" | "weekend" | "public_holiday");
    }
    result.set(scope.scopeId, dayTypes);
  }
  return result;
}

function buildDailyTrendBaseline(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  dailyTotals: DailyTotals,
): {
  overlay: NgeeAnnEnergyTrendViewModel["baselineOverlay"];
  evidence: NonNullable<NgeeAnnEnergyTrendViewModel["evidence"]["baseline"]> | null;
  points: Map<string, Map<string, DailyTrendBaseline>>;
  dayTypes: Map<string, Map<string, "weekday" | "weekend" | null>>;
} {
  const unavailable = (reason: string) => ({
    overlay: {
      status: "unavailable" as const,
      reason: `Governed baseline overlay unavailable: ${reason}`,
      ruleRevisionId: null,
    },
    evidence: null,
    points: new Map<string, Map<string, DailyTrendBaseline>>(),
    dayTypes: new Map<string, Map<string, "weekday" | "weekend" | null>>(),
  });
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  if (!bundle) {
    return unavailable("this Snapshot does not include the authoritative daily anomaly contract.");
  }
  if (bundle.status === "unavailable") return unavailable(bundle.reason.message);
  const invalidReason = invalidDailyAnomalyBundleReason(snapshot, bundle);
  if (invalidReason) return unavailable(invalidReason);

  const anomalyScopes = new Map(bundle.scopes.map((scope) => [scope.scopeId, scope]));
  const points = new Map<string, Map<string, DailyTrendBaseline>>();
  const dayTypes = new Map<string, Map<string, "weekday" | "weekend" | null>>();
  for (const scope of dailyTotals.scopes) {
    const anomalyScope = anomalyScopes.get(scope.scopeId);
    if (
      !anomalyScope
      || anomalyScope.scopeName !== scope.scopeName
      || anomalyScope.scopeType !== scope.scopeType
      || anomalyScope.rows.length !== scope.rows.length
    ) {
      return unavailable("the anomaly Scope identity does not align with the daily totals Scope.");
    }
    const anomalyRows = new Map(anomalyScope.rows.map((row) => [row.localDate, row]));
    const scopePoints = new Map<string, DailyTrendBaseline>();
    const scopeDayTypes = new Map<string, "weekday" | "weekend" | null>();
    for (const row of scope.rows) {
      const anomalyRow = anomalyRows.get(row.localDate);
      if (
        !anomalyRow
        || anomalyRow.from !== row.from
        || anomalyRow.to !== row.to
        || anomalyRow.actualKwh !== row.usageKwh
        || anomalyRow.coveragePct !== row.dataHealth.coveragePct
        || anomalyRow.expectedMeterIntervalCount !== row.dataHealth.expectedMeterIntervalCount
        || anomalyRow.validIntervalCount !== row.dataHealth.validIntervalCount
        || anomalyRow.qualityEventCount !== row.dataHealth.qualityEventCount
        || (anomalyRow.outcome !== "suppressed" && row.dataHealth.status !== "complete")
      ) {
        return unavailable("the anomaly Scope, local date, accepted actual or quality identity does not align with daily totals.");
      }
      scopePoints.set(row.localDate, {
        outcome: anomalyRow.outcome,
        outcomeLabel: anomalyRow.outcome === "triggered"
          ? "Above-baseline rule triggered"
          : anomalyRow.outcome === "within_threshold"
            ? "Within rule threshold"
            : "No rule conclusion — Evidence incomplete",
        baselineKwh: anomalyRow.baselineKwh,
        baselineUsageKwh: anomalyRow.baselineKwh === null ? null : formatDecimal(anomalyRow.baselineKwh, 2),
        deltaUsageKwh: anomalyRow.impactKwh === null ? null : signedDecimal(anomalyRow.impactKwh, 2),
        relativePctLabel: anomalyRow.relativePct === null ? null : `${signedDecimal(anomalyRow.relativePct, 1)}%`,
        incidentId: anomalyRow.outcome === "triggered" ? anomalyRow.incidentId : null,
        limitation: anomalyRow.suppressionReason?.message ?? null,
      });
      scopeDayTypes.set(row.localDate, anomalyRow.dayType);
    }
    points.set(scope.scopeId, scopePoints);
    dayTypes.set(scope.scopeId, scopeDayTypes);
  }
  if (anomalyScopes.size !== dailyTotals.scopes.length) {
    return unavailable("the anomaly Scope set does not align with the daily totals Scope set.");
  }
  return {
    overlay: { status: "available", reason: null, ruleRevisionId: bundle.ruleRevisionId },
    evidence: {
      bundleId: bundle.bundleId,
      queryId: bundle.queryId,
      ruleRevisionId: bundle.ruleRevisionId,
      baselineCutoff: bundle.baselineCutoff,
      baselineMethod: bundle.rule.baselineMethod,
    },
    points,
    dayTypes,
  };
}

function isoLocalDateAt(value: string, timezone: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(timestamp));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function isSingleLocalDayPeriod(
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
  timezone: string,
): boolean {
  const start = Date.parse(period.start);
  const end = Date.parse(period.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return false;
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(start));
  const endDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(end - 1));
  return startDate === endDate;
}

function validDailySpine(
  rows: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>["scopes"][number]["rows"],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (rows.length === 0 || rows[0]?.from !== period.start || rows.at(-1)?.to !== period.endExclusive) {
    return false;
  }
  return rows.every((row, index) => {
    const previous = rows[index - 1];
    return /^\d{4}-\d{2}-\d{2}$/u.test(row.localDate)
      && Number.isFinite(Date.parse(row.from))
      && Number.isFinite(Date.parse(row.to))
      && Date.parse(row.from) < Date.parse(row.to)
      && (!previous || (previous.to === row.from && previous.localDate < row.localDate));
  });
}

function validDailyPoint(
  row: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>["scopes"][number]["rows"][number],
): boolean {
  const health = row.dataHealth;
  const countsValid = Number.isInteger(health.expectedMeterIntervalCount)
    && Number.isInteger(health.validIntervalCount)
    && Number.isInteger(health.qualityEventCount)
    && health.expectedMeterIntervalCount >= 0
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && health.qualityEventCount >= 0;
  const coverageValid = Number.isFinite(health.coveragePct)
    && health.coveragePct >= 0
    && health.coveragePct <= 100;
  const usageValid = health.status === "unavailable"
    ? row.usageKwh === null
    : row.usageKwh !== null && Number.isFinite(row.usageKwh) && row.usageKwh >= 0;
  return countsValid && coverageValid && usageValid;
}

function formatLocalDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${localDate}T00:00:00.000Z`));
}

function formatLocalWeekday(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${localDate}T00:00:00.000Z`));
}

function buildLevelComparison(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnLevelComparisonViewModel {
  const evidence = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    queryIds: [...snapshot.analysis.provenance.queryIds],
  };
  const levelRows = snapshot.analysis.childScopes.filter((scope) => scope.nodeType === "level");
  const hasCompleteContract = levelRows.length > 0
    && levelRows.every((scope) => scope.dataHealth);

  if (overviewUnavailable || snapshot.context.scopeType !== "project" || !hasCompleteContract) {
    return {
      status: "unavailable",
      decisionQuestion: "Where is current energy concentrated by Level, and which Level changed most?",
      reason: overviewUnavailable
        ? "No trusted intervals support a Level comparison for this Period."
        : snapshot.context.scopeType !== "project"
          ? "Select the Project Scope to compare Level 6 and Level 7."
          : "This published Snapshot does not include the Level comparison and quality contract.",
      rows: [],
      summary: unavailableContributorSummary(
        overviewUnavailable
          ? "No trusted intervals support current Level concentration for this Period."
          : "This published Snapshot does not include the Level current facts and quality contract.",
      ),
      evidence,
    };
  }

  return {
    status: "available",
    decisionQuestion: "Where is current energy concentrated by Level, and which Level changed most?",
    reason: null,
    summary: buildContributorSummary(
      levelRows.map((scope) => ({
        name: scope.name,
        usageKwh: scope.usageKwh,
        sharePct: scope.sharePct,
        comparison: scope.comparison,
      })),
      snapshot.analysis.comparison.changeKwh,
      "Level",
    ),
    rows: levelRows.map((scope) => ({
      id: scope.nodeId,
      name: scope.name,
      currentUsageKwh: formatDecimal(scope.usageKwh, 2),
      projectShare: `${formatDecimal(scope.sharePct, 1)}%`,
      projectShareBar: `${Math.min(Math.max(scope.sharePct, 0), 100)}%`,
      previousUsageKwh: scope.comparison ? formatDecimal(scope.comparison.usageKwh, 2) : "Unavailable",
      changeKwh: scope.comparison ? `${signedDecimal(scope.comparison.changeKwh, 2)} kWh` : "Unavailable",
      changePct: scope.comparison ? signedDisplayPercent(scope.comparison.changePct, "Unavailable") : "Unavailable",
      coverage: `${formatDecimal(scope.dataHealth!.coveragePct, 1)}% coverage`,
      intervals: `${scope.dataHealth!.validIntervalCount.toLocaleString("en-SG")} / ${scope.dataHealth!.expectedMeterIntervalCount.toLocaleString("en-SG")}`,
      qualityEvents: `${scope.dataHealth!.qualityEventCount.toLocaleString("en-SG")} quality events`,
      movement: movementAvailability(scope.comparison, "Level comparison is unavailable for this published Snapshot."),
      exact: {
        currentUsageKwh: formatDecimal(scope.usageKwh, 4),
        projectShare: `${formatDecimal(scope.sharePct, 4)}%`,
        previousUsageKwh: scope.comparison ? formatDecimal(scope.comparison.usageKwh, 4) : "Unavailable",
        changeKwh: scope.comparison ? `${signedDecimal(scope.comparison.changeKwh, 4)} kWh` : "Unavailable",
        changePct: !scope.comparison
          ? "Unavailable"
          : scope.comparison.changePct === null
          ? "Unavailable"
          : `${scope.comparison.changePct >= 0 ? "+" : ""}${formatDecimal(scope.comparison.changePct, 4)}%`,
      },
    })),
    evidence,
  };
}

function resolveDataStatus(
  sourceStatus: EnergyProjectAnalysisSnapshotDto["dataQuality"]["status"],
  hasTrustedIntervals: boolean,
): NgeeAnnOverviewDataStatus {
  if (!hasTrustedIntervals || sourceStatus === "unavailable") return "unavailable";
  return sourceStatus === "complete" ? "ready" : "partial";
}

function buildDataStatus(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  status: NgeeAnnOverviewDataStatus,
  latestSeenAt: string | null,
  hasLatestAvailableRange: boolean,
): NgeeAnnOverviewViewModel["dataStatus"] {
  const quality = snapshot.dataQuality;
  const labels = {
    ready: "Ready",
    partial: "Partial data",
    unavailable: "Unavailable",
  } as const;
  const summaries = {
    ready: "Trusted facts cover the selected period.",
    partial: "Results use accepted intervals, but the selected period is incomplete.",
    unavailable: "No trusted intervals are available for the selected period.",
  } as const;
  const recoveries = {
    ready: null,
    partial: "Restore the missing source intervals, materialize the Project again, then refresh this same Period.",
    unavailable: hasLatestAvailableRange
      ? "No trusted intervals cover this Period. Keep it to investigate the gap, or view the latest available data."
      : "Check source Mapping and materialization, then refresh this same Period. The latest complete range is not currently available.",
  } as const;
  return {
    status,
    label: labels[status],
    summary: summaries[status],
    recovery: recoveries[status],
    coverage: `${formatDecimal(quality.coveragePct, 1)}% coverage`,
    intervals: `${quality.validIntervalCount.toLocaleString("en-SG")} / ${quality.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
    qualityEvents: `${quality.qualityEventCount.toLocaleString("en-SG")} quality events`,
    lastSeen: latestSeenAt
      ? `Last seen ${formatTimestamp(latestSeenAt, snapshot.context.timezone)}`
      : "Last seen unavailable",
  };
}

function buildMetadataLimitation(snapshot: EnergyProjectAnalysisSnapshotDto): string | null {
  const { area, headcount } = snapshot.metadata.selectedScope;
  const missing: string[] = [];
  if (area.status === "missing") missing.push("Area");
  if (headcount.status === "missing") missing.push("headcount");
  if (missing.length === 0) return null;
  const guidance = [...new Set([
    ...(area.status === "missing" ? [area.guidance] : []),
    ...(headcount.status === "missing" ? [headcount.guidance] : []),
  ].filter(Boolean))];
  return [
    `${missing.join(" and ")} metadata ${missing.length === 1 ? "is" : "are"} missing. This does not affect Total energy, Daily average, Peak interval-average power, Comparison or Cost; normalised metrics remain unavailable.`,
    ...guidance,
  ].join(" ");
}

function formatTariffDetail(allocations: Array<{
  rateBasis?: "tax_inclusive" | "tax_exclusive";
  tax?: { name: string; ratePct: number };
  taxInclusiveRatePerKwh?: number;
  taxExclusiveRatePerKwh?: number;
}>): string {
  const allocation = allocations.length === 1 ? allocations[0] : undefined;
  if (
    allocation?.tax
    && allocation.taxInclusiveRatePerKwh !== undefined
    && allocation.taxExclusiveRatePerKwh !== undefined
  ) {
    return formatConfiguredTaxRates(allocation);
  }
  return `Based on ${allocations.length === 1 ? "the active tariff" : `${allocations.length} active tariff allocations`} for this period`;
}

function formatConfiguredTaxRates(allocation: {
  tax?: { name: string; ratePct: number };
  taxInclusiveRatePerKwh?: number;
  taxExclusiveRatePerKwh?: number;
}): string {
  if (
    !allocation.tax
    || allocation.taxInclusiveRatePerKwh === undefined
    || allocation.taxExclusiveRatePerKwh === undefined
  ) return "";
  return `${formatFixedCustomerDecimal(allocation.taxInclusiveRatePerKwh * 100, 2)}¢/kWh incl. ${allocation.tax.name} (${formatFixedCustomerDecimal(allocation.taxExclusiveRatePerKwh * 100, 2)}¢/kWh ex ${allocation.tax.name})`;
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  return value.toFixed(maximumFractionDigits).replace(/\.?0+$/u, "");
}

function formatCustomerDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-SG", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(value);
}

function formatFixedCustomerDecimal(value: number, fractionDigits: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-SG", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    useGrouping: true,
  }).format(value);
}

function roundDisplayValue(value: number): number {
  return Number(value.toFixed(4));
}

function signedDecimal(value: number, maximumFractionDigits: number): string {
  return `${value >= 0 ? "+" : ""}${formatDecimal(value, maximumFractionDigits)}`;
}

function signedDisplayPercent(value: number | null, unavailable: string): string {
  if (value === null) return unavailable;
  const rounded = Number(value.toFixed(1));
  if (Object.is(rounded, -0) || rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : ""}${formatDecimal(rounded, 1)}%`;
}

function formatPeriodRange(start: string, endExclusive: string, timezone: string): string {
  const endInclusive = new Date(Date.parse(endExclusive) - 1);
  const formatter = new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(new Date(start))} - ${formatter.format(endInclusive)}`;
}

function formatTimestamp(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatEvidenceRange(from: string, to: string, timezone: string): string {
  return `[${formatTimestamp(from, timezone)}, ${formatTimestamp(to, timezone)})`;
}

function comparisonEvidenceReferences(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): string[] {
  return snapshot.evidence
    .filter((reference) => Array.from(COMPARISON_EVIDENCE_METRIC_IDS)
      .some((metricId) => isMetricOrRevision(reference.metricId, metricId)))
    .map((reference) => reference.id);
}

function isMetricOrRevision(candidate: string, metricId: string): boolean {
  if (candidate === metricId) return true;

  const revisionPrefix = `${metricId}@`;
  if (!candidate.startsWith(revisionPrefix)) return false;

  const revision = candidate.slice(revisionPrefix.length);
  return revision.length > 0 && !revision.includes("@") && !/\s/u.test(revision);
}

import { explorerTrendSql, decodeExplorerTrends, virtualMeterPeakSql, type ExplorerTrendRoute, type ExplorerTrendSeries } from "./explorer-trends.js";
import { projectExplorerMeters, type EnergyExplorerMeter } from "./energy-explorer-meters.js";
import {
  ensureEnergyScopedDataSource,
  prepareEnergyScopedDataSource,
  readEnergyCurrentOverviewPeriod,
  readEnergyOverviewHeadline,
  registerPreparedEnergyScopedDataSource,
  readEnergyFactCoverage,
  readEnergyReportingCoverage,
  resolveEnergyFactStorePath,
  type EnergyFactCoverage,
  type EnergyScopedDataSource,
  type LocalDataGateway
} from "@datafoundry/data-gateway";
import type {
  EnergyIqAnalysisInterval,
  EnergyIqMeterMappingRow,
  EnergyIqOperatingEvaluation,
  EnergyIqPolicyUnavailableReason,
  EnergyIqProjectSetupDocument,
  EnergyIqRuleRevisionRecord,
  EnergyIqTariffEvaluation,
  EnergyIqVirtualMeter,
  MetadataStore
} from "@datafoundry/metadata";

import {
  resolveEnergyPublishedMeterRoute,
  resolveEnergyPublishedHierarchyNodes,
  type EnergyQueryContext
} from "./energy-query-context.js";

export type EnergyRollingUsageComparison = {
  horizon: "rolling_7d" | "rolling_28d";
  cutoffLocalDate: string;
  current: {
    fromLocalDate: string;
    toLocalDate: string;
    totalKwh: number | null;
    completeDayCount: number;
  };
  baseline: {
    fromLocalDate: string;
    toLocalDate: string;
    totalKwh: number | null;
    completeDayCount: number;
  };
} & ({
  status: "available";
  deltaKwh: number;
  relativePct: number;
} | {
  status: "unavailable";
  reason: {
    code: "INCOMPLETE_HORIZON_EVIDENCE" | "NON_POSITIVE_HORIZON_BASELINE";
    message: string;
  };
});

export type EnergyDailyUsageAnomalies = {
  status: "available";
  bundleId: string;
  metricId: "energy.total_usage_kwh@1";
  queryId: "time_slot_anomaly_v1";
  ruleRevisionId: string;
  timezone: string;
  baselineCutoff: string;
  rule: {
    relativeThresholdPct: number;
    absoluteImpactKwh: number;
    minimumCoveragePct: number;
    minimumSampleCount: number;
    maximumQualityEventCount: number;
    maximumLookbackDays: number;
    direction: "above";
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour";
  };
  evidencePins: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    businessCalendarVersion: string;
    queryIds: ["time_slot_anomaly_v1"];
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    rollingComparisons: EnergyRollingUsageComparison[];
    rows: Array<{
      anomalyId: string;
      incidentId: string;
      ruleRevisionId: string;
      metricId: "energy.total_usage_kwh@1";
      queryId: "time_slot_anomaly_v1";
      localDate: string;
      from: string;
      to: string;
      dayType: "weekday" | "weekend" | null;
      baselineDates: string[];
      baselineSampleCount: number;
      baselineSamples: Array<{
        localDate: string;
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
        eligible: true;
      }>;
      actualKwh: number | null;
      baselineKwh: number | null;
      impactKwh: number | null;
      relativePct: number | null;
      thresholds: {
        relativeThresholdPct: number;
        absoluteImpactKwh: number;
        minimumCoveragePct: number;
        maximumQualityEventCount: number;
      };
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
      outcome: "triggered" | "within_threshold" | "suppressed";
      suppressionReason?: {
        code: DailyUsageAnomalySuppressionCode;
        message: string;
      };
      hourlyComparison: Array<{
        localHour: number;
        actualKwh: number | null;
        baselineKwh: number | null;
        impactKwh: number | null;
        relativePct: number | null;
      }>;
      detailSeries: Array<{
        seriesId: string;
        relationship: "selected_scope" | "immediate_level" | "component_circuit";
        kind: "official_scope" | "component_circuit";
        scopeId: string;
        scopeName: string;
        meterNodeId?: string;
        category?: string;
        includedInOfficialTotal: boolean;
        status: "available" | "partial" | "unavailable";
        selectedTotalKwh: number | null;
        baselineTotalKwh: number | null;
        impactKwh: number | null;
        relativePct: number | null;
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
        points: Array<{
          localHour: number;
          selectedKwh: number | null;
          baselineKwh: number | null;
          impactKwh: number | null;
        }>;
      }>;
    }>;
  }>;
} | {
  status: "unavailable";
  ruleRevisionId: string;
  reason: {
    code: "BUSINESS_CALENDAR_VERSION_MISSING"
      | "BUSINESS_CALENDAR_VERSION_NOT_FOUND"
      | "BUSINESS_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD"
      | "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE"
      | "DAILY_USAGE_ANOMALY_RULE_INVALID";
    message: string;
  };
};

type DailyUsageAnomalySuppressionCode =
  | "CALENDAR_EXCEPTION_DATE"
  | "DAILY_FACTS_UNAVAILABLE"
  | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE"
  | "COVERAGE_BELOW_THRESHOLD"
  | "QUALITY_EVENT_PRESENT"
  | "BASELINE_SAMPLE_COUNT_INSUFFICIENT"
  | "BASELINE_VALUE_UNAVAILABLE";

/**
 * How far behind the Project a Meter may fall before it counts as stopped.
 *
 * Half a day. A Meter that reports on change goes quiet whenever its equipment
 * is switched off, so an evening of silence is ordinary and must not be called
 * a fault; a Meter still silent after half a day, while the rest of the site
 * has gone on reporting, is not merely switched off. The two cannot be told
 * apart from the last reading alone, so the bar sits where a night of normal
 * quiet stays below it. A Meter that really has stopped only falls further
 * behind, so it is named once the gap passes this.
 */
const STALE_METER_REPORTING_MS = 12 * 60 * 60_000;

/** Trailing local days to report on, matching the widest chart the UI draws. */
const REPORTING_HEALTH_DAY_COUNT = 35;

export type EnergyReportingHealth = {
  /** The newest interval any Meter in the Project has sent. */
  latestReadingAt: string;
  /**
   * Local days that received less than the fullest recent day did. A day is
   * here because readings are missing from it, which is why it cannot be
   * summed against whole days.
   */
  shortDays: Array<{
    localDate: string;
    usageKwh: number;
    observedIntervalCount: number;
    expectedIntervalCount: number;
  }>;
  /** Meters that have stopped sending, furthest behind first. */
  stoppedMeters: Array<{
    meterNodeId: string;
    lastReadingAt: string;
  }>;
};

/**
 * Turn the Meters' raw reporting observations into the two facts a reader acts
 * on: which recent days are missing readings, and which Meters stopped sending.
 */
export const resolveEnergyReportingHealth = (
  coverage: {
    latestReadingAt: string;
    meters: ReadonlyArray<{ meterNodeId: string; lastReadingAt: string }>;
    days: ReadonlyArray<{ localDate: string; usageKwh: number; observedIntervalCount: number }>;
  },
): EnergyReportingHealth => {
  // The fullest recent day is what a whole day looks like for this Project,
  // which avoids assuming an interval length the source may not use.
  const expectedIntervalCount = coverage.days
    .reduce((most, day) => Math.max(most, day.observedIntervalCount), 0);
  const latestReadingMs = Date.parse(coverage.latestReadingAt);
  return {
    latestReadingAt: coverage.latestReadingAt,
    shortDays: coverage.days
      .filter((day) => day.observedIntervalCount < expectedIntervalCount)
      .map((day) => ({
        localDate: day.localDate,
        usageKwh: round(day.usageKwh, 4),
        observedIntervalCount: day.observedIntervalCount,
        expectedIntervalCount,
      })),
    stoppedMeters: coverage.meters
      .filter((meter) => latestReadingMs - Date.parse(meter.lastReadingAt) >= STALE_METER_REPORTING_MS)
      .map((meter) => ({ meterNodeId: meter.meterNodeId, lastReadingAt: meter.lastReadingAt }))
      .sort((left, right) => left.lastReadingAt.localeCompare(right.lastReadingAt)),
  };
};

export type EnergyScopeAnalysis = {
  context: EnergyQueryContext;
  /**
   * What each Meter has actually sent, so a reader can tell a quiet day from a
   * Meter that went silent. Absent on a projection built before this existed.
   */
  reportingHealth?: EnergyReportingHealth;
  latestAvailablePeriod?: {
    period: "Custom";
    from: string;
    to: string;
  };
  latestAcceptedReading: {
    status: "available";
    valueKwh: number;
    recordedAt: string;
    meterNodeId: string;
    sourceFile: string;
    sourceSha256: string;
    sourceReadingKind: "cumulative_energy";
    queryId: "latest_accepted_reading_v1";
  } | {
    status: "not_applicable";
    queryId: "latest_accepted_reading_v1";
    reason: {
      code: "LEAF_METER_REQUIRED" | "INTERVAL_USAGE_SOURCE";
      message: string;
    };
  } | {
    status: "unavailable";
    queryId: "latest_accepted_reading_v1";
    reason: {
      code: "ACCEPTED_CUMULATIVE_READING_UNAVAILABLE";
      message: string;
    };
  };
  summary: {
    usageKwh: number;
    averageDailyUsageKwh: number;
    peakKw: number;
    peakAt?: string;
    nonOperatingKwh?: number;
    nonOperatingSharePct?: number;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    validIntervalCount: number;
    qualityEventCount: number;
  };
  explorerTrends?: ExplorerTrendSeries[];
  monitoringMode?: "api" | "file" | "unknown";
  hourlyProfile: Array<{
    hour: number;
    usageKwh: number;
    averageKw: number;
    peakKw: number;
    observationCount: number;
  }>;
  dailyTotals?: {
    metricId: "energy.total_usage_kwh@1";
    grain: "day";
    timezone: string;
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      rows: Array<{
        localDate: string;
        from: string;
        to: string;
        usageKwh: number | null;
        dataHealth: TimeBucketDataHealth;
      }>;
    }>;
  };
  componentCategoryBreakdown?: {
    metricId: "energy.total_usage_kwh@1";
    queryId: "daily_component_categories_v1";
    accountingBasis: "published_component_circuits";
    grain: "day";
    timezone: string;
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      period: {
        status: "complete" | "partial" | "unavailable";
        reason: string | null;
        officialUsageKwh: number | null;
        componentUsageKwh: number | null;
        gapKwh: number | null;
        ratioPct: number | null;
        categories: Array<{
          category: string;
          usageKwh: number | null;
          sharePct: number | null;
        }>;
      };
      rows: Array<{
        localDate: string;
        from: string;
        to: string;
        dayType: "weekday" | "weekend" | "public_holiday" | null;
        officialUsageKwh: number | null;
        componentUsageKwh: number | null;
        categories: Array<{
          category: string;
          usageKwh: number | null;
          sharePct: number | null;
        }>;
        estimatedCost: {
          status: "available";
          amount: number;
          currency: string;
          ratePerKwh: number;
          tariffScheduleVersion: string;
        } | {
          status: "unavailable";
          reason: string;
        };
        dataHealth: TimeBucketDataHealth;
      }>;
    }>;
  };
  calendarTotals?: {
    metricId: "energy.total_usage_kwh@1";
    timezone: string;
    derivedFromQueryId: "daily_totals_v1";
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      weeks: Array<{
        localFrom: string;
        localToInclusive: string;
        from: string;
        to: string;
        usageKwh: number | null;
        isPartialCalendarPeriod: boolean;
        dataHealth: TimeBucketDataHealth;
      }>;
      months: Array<{
        localFrom: string;
        localToInclusive: string;
        from: string;
        to: string;
        usageKwh: number | null;
        isPartialCalendarPeriod: boolean;
        dataHealth: TimeBucketDataHealth;
      }>;
    }>;
  };
  timeBehaviour?: {
    metricId: "energy.total_usage_kwh@1";
    grain: "hour";
    unit: "kWh";
    timezone: string;
    queryId: "time_bucket_grid_v1";
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      cells: Array<{
        localDate: string;
        localHour: number;
        from: string;
        to: string;
        usageKwh: number | null;
        dataHealth: TimeBucketDataHealth;
      }>;
    }>;
    dayProfiles: Array<{
      dayType: "weekday" | "weekend" | "public_holiday";
      scopeId: string;
      scopeName: string;
      status: "available";
      sampleDayCount: number;
      values: Array<{
        localHour: number;
        usageKwh: number;
      }>;
    } | {
      dayType: "weekday" | "weekend" | "public_holiday";
      scopeId: string;
      scopeName: string;
      status: "unavailable";
      reason: {
        code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE";
        message: string;
      };
    }>;
  };
  componentHourlyProfiles?: {
    metricId: "energy.total_usage_kwh@1";
    queryId: "component_hourly_profiles_v1";
    accountingBasis: "published_component_circuits";
    grain: "hour";
    unit: "kWh";
    timezone: string;
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      profiles: Array<{
        dayType: "weekday" | "weekend" | "public_holiday";
        status: "available";
        sampleDayCount: number;
        categories: Array<{
          category: string;
          values: Array<{ localHour: number; usageKwh: number }>;
        }>;
        circuits: Array<{
          meterNodeId: string;
          name: string;
          category: string;
          values: Array<{ localHour: number; usageKwh: number }>;
        }>;
      } | {
        dayType: "weekday" | "weekend" | "public_holiday";
        status: "unavailable";
        reason: {
          code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE";
          message: string;
        };
      }>;
    }>;
  };
  dailyUsageAnomalies?: EnergyDailyUsageAnomalies;
  peakBreakdown?: {
    status: "available";
    metricId: "energy.peak_demand_kw@1";
    intervalMinutes: number;
    timezone: string;
    unit: "kW";
    periodStatus: "complete" | "partial";
    coveragePct: number;
    peak: {
      from: string;
      to: string;
      averageKw: number;
      dataHealth: PeakIntervalDataHealth;
    };
    levels: Array<{
      scopeId: string;
      scopeName: string;
      averageKw: number;
      sharePct: number;
      dataHealth: PeakIntervalDataHealth;
      circuits: Array<{
        meterNodeId: string;
        name: string;
        category: string;
        averageKw: number | null;
        sharePct: number | null;
        includedInOfficialTotal: false;
        dataHealth: PeakIntervalDataHealth;
      }>;
    }>;
  } | {
    status: "unavailable";
    reason: {
      code: "PEAK_AT_MISSING"
        | "PEAK_INTERVAL_FACTS_UNAVAILABLE"
        | "PEAK_INTERVAL_FACTS_AMBIGUOUS"
        | "PEAK_INTERVAL_FACTS_REJECTED";
      message: string;
    };
  };
  comparison: {
    from: string;
    to: string;
    usageKwh: number;
    changeKwh: number;
    changePct: number | null;
  };
  categories: Array<{
    category: string;
    usageKwh: number;
    sharePct: number;
    comparison: {
      usageKwh: number;
      changeKwh: number;
      changePct: number | null;
    };
    dataHealth: {
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
    };
  }>;
  childScopes: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    usageKwh: number;
    sharePct: number;
    comparison: {
      usageKwh: number;
      changeKwh: number;
      changePct: number | null;
    };
    dataHealth: {
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
    };
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    topCircuitName?: string;
    topCircuitUsageKwh?: number;
  }>;
  circuits: Array<{
    meterNodeId: string;
    scopeId: string;
    parentScopeId?: string;
    name: string;
    appliance: string;
    category: string;
    meterRole: string;
    includedInOfficialTotal: boolean;
    usageKwh: number;
    sharePct: number;
    comparison: {
      usageKwh: number;
      changeKwh: number;
      changePct: number | null;
    };
    dataHealth: {
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
    };
    nonOperatingKwh?: number;
    peakKw: number;
    qualityEventCount: number;
  }>;
  explorerMeters?: EnergyExplorerMeter[];
  topCircuits: EnergyScopeAnalysis["circuits"];
  designatedTotals: EnergyScopeAnalysis["circuits"];
  componentReconciliation: {
    officialUsageKwh: number;
    componentUsageKwh: number;
    gapKwh: number;
    ratioPct: number | null;
    officialMeterNodeIds: string[];
    componentMeterNodeIds: string[];
  };
  virtualMeters: Array<{
    meterNodeId: string;
    name: string;
    scopeId: string;
    termMeterNodeIds: string[];
    usageKwh: number;
    includedInOfficialTotal: false;
  }>;
  virtualMeterTraces?: Array<{
    meterNodeId: string;
    name: string;
    scopeId: string;
    status: "available" | "partial";
    usageKwh: number | null;
    /** Highest 15-minute average power over intervals where every input reported; Explorer analyses only. */
    peakKw?: number;
    /** Local start of that interval. */
    peakAt?: string;
    includedInOfficialTotal: false;
    terms: Array<{
      meterNodeId: string;
      name: string;
      coefficient: 1 | -1;
      inputUsageKwh: number | null;
      contributionKwh: number | null;
      dataHealth: {
        status: "complete" | "partial" | "unavailable";
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
      };
    }>;
    missingTermMeterNodeIds: string[];
  }>;
  offHours: {
    status: "available";
    operatingKwh: number;
    standbyKwh: number;
    usageKwh: number;
    sharePct: number;
    timezone: string;
    businessCalendarVersion: string;
  } | {
    status: "unavailable";
    reason: EnergyIqPolicyUnavailableReason;
    businessCalendarVersion?: string;
  };
  cost: {
    status: "available";
    amount: number;
    currency: string;
    tariffScheduleVersion: string;
    allocations: Array<{
      from: string;
      to: string;
      ratePerKwh: number;
      rateBasis?: "tax_inclusive" | "tax_exclusive";
      tax?: { name: string; ratePct: number };
      taxInclusiveRatePerKwh?: number;
      taxExclusiveRatePerKwh?: number;
      usageKwh: number;
      cost: number;
    }>;
  } | {
    status: "unavailable";
    reason: EnergyIqPolicyUnavailableReason;
    tariffScheduleVersion?: string;
  };
  dataHealth: {
    status: "complete" | "partial" | "unavailable";
    coveragePct: number;
    expectedMeterIntervalCount: number;
    validIntervalCount: number;
    qualityEventCount: number;
    cumulativeDeltaMismatchCount: number;
    averageKwMismatchCount: number;
    invalidIntervalDurationCount: number;
    lastSeenAt?: string;
    importBatchIds: string[];
  };
  units: {
    usage: "kWh";
    demand: "kW";
    intervalMinutes: number;
    timezone: string;
  };
  attention: Array<{
    code: string;
    severity: "info" | "warning";
    title: string;
    evidence: string;
    suggestedAction: string;
  }>;
  provenance: {
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    ruleRevisionIds: string[];
    aggregationRule: "designated_total" | "component" | "submeter" | "none";
    sourceView: string;
    queryIds: Array<
      | "scope_summary_v1"
      | "hourly_profile_v1"
      | "daily_totals_v1"
      | "daily_component_categories_v1"
      | "time_bucket_grid_v1"
      | "component_hourly_profiles_v1"
      | "peak_breakdown_v1"
      | "meter_breakdown_v1"
      | "previous_meter_usage_v1"
      | "operational_policy_scope_intervals_v1"
      | "operational_policy_meter_intervals_v1"
      | "latest_accepted_reading_v1"
      | "time_slot_anomaly_v1"
    >;
  };
};

export type EnergyGoldenSelection = {
  periodDays: number;
  intervalMinutes: number;
  policy: "highest current coverage, then previous-period coverage, then fewest quality events, then latest";
  period: {
    localFrom: string;
    localToExclusive: string;
    from: string;
    to: string;
  };
  day: {
    localDate: string;
    from: string;
    to: string;
  };
};

export type EnergyLatestCompletePeriodSelection = {
  periodDays: 7;
  intervalMinutes: number;
  period: {
    localFrom: string;
    localToExclusive: string;
    from: string;
    to: string;
  };
};

export type EnergyCurrentOverviewPeriodSelection = {
  periodBasis: EnergyCurrentOverviewPeriodBasis;
  periodDays: number;
  cutoffLocalDate: string;
  intervalMinutes: number;
  period: {
    localFrom: string;
    localToExclusive: string;
    from: string;
    to: string;
  };
};

export type EnergyCurrentOverviewPeriodBasis =
  | "rolling_7_days"
  | "rolling_28_days"
  | "calendar_month_to_date";

type MeterAggregate = {
  meterNodeId: string;
  scopeId: string;
  name: string;
  appliance: string;
  category: string;
  meterRole: string;
  usageKwh: number;
  peakKw: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

type PeakIntervalDataHealth = {
  status: "complete" | "unavailable";
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

type TimeBucketDataHealth = {
  status: "complete" | "partial" | "unavailable";
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
  aggregateStatus?: "complete" | "partial" | "unavailable";
  aggregateCoveragePct?: number;
  aggregateEligibleIntervalCount?: number;
  cadenceGapEventCount?: number;
};

type DailyTotalScope = {
  scopeId: string;
  scopeName: string;
  scopeType: string;
  meterNodeIds: string[];
};

type DailyComponentCategorySeries = {
  scopeOrder: number;
  categoryOrder: number;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  category: string;
  meterNodeIds: string[];
};

type ComponentHourlyCircuitSeries = {
  seriesOrder: number;
  meterNodeId: string;
  name: string;
  category: string;
  levelScopeId: string;
};

type DailyDateBucket = {
  localDate: string;
  from: string;
  to: string;
};

type PeakIntervalFact = {
  meterNodeId: string;
  intervalStart: string;
  intervalEnd: string;
  elapsedMinutes: number;
  averageKw: number | null;
  qualityStatus: string;
};

type OperationalIntervalSeries = {
  kind: "scope" | "meter";
  meterNodeId?: string;
  scopeId?: string;
  intervals: EnergyIqAnalysisInterval[];
};

type DailyUsageAnomalyRule = Extract<EnergyDailyUsageAnomalies, { status: "available" }>["rule"];

type DailyUsageAnomalySeriesDefinition = {
  seriesOrder: number;
  seriesId: string;
  kind: "official_scope" | "component_circuit";
  ownerScopeId: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  meterNodeIds: string[];
  meterNodeId?: string;
  category?: string;
  includedInOfficialTotal: boolean;
};

type DailyUsageAnomalyHourFact = {
  localDate: string;
  localHour: number;
  usageKwh: number | null;
  validIntervalCount: number;
  qualityEventCount: number;
  dayType: string | null;
  dayTypeCount: number;
  dayTypeNullCount: number;
};

type DailyUsageAnomalyLoadResult = {
  status: "absent";
} | {
  status: "unavailable";
  bundle: Extract<EnergyDailyUsageAnomalies, { status: "unavailable" }>;
} | {
  status: "loaded";
  projectReleaseId: string;
  businessCalendarVersion: string;
  ruleRevisionId: string;
  rule: DailyUsageAnomalyRule;
  exceptionDatesByScopeId: Map<string, Set<string>>;
  series: DailyUsageAnomalySeriesDefinition[];
  rows: unknown[][];
};

type DailyUsageAnomalyPreparation = Extract<
  DailyUsageAnomalyLoadResult,
  { status: "absent" | "unavailable" }
> | {
  status: "ready";
  projectReleaseId: string;
  businessCalendarVersion: string;
  ruleRevision: EnergyIqRuleRevisionRecord;
  rule: DailyUsageAnomalyRule;
  historicalFrom: string;
};

type DailyUsageAnomalyDayFact = {
  localDate: string;
  dayType: "weekday" | "weekend" | null;
  coveragePct: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  qualityEventCount: number;
  hours: Array<{
    localHour: number;
    usageKwh: number | null;
  }>;
  totalKwh: number | null;
};

const GOLDEN_SELECTION_POLICY =
  "highest current coverage, then previous-period coverage, then fewest quality events, then latest" as const;

const LATEST_COMPLETE_PERIOD_DAYS = 7 as const;
const CURRENT_OVERVIEW_PERIOD_DAYS = 28 as const;
const CURRENT_OVERVIEW_SELECTION_PROBE_DAYS = 14 as const;

type EnergyPeriodSelectionInput = {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
};

type EnergyPeriodCoverageNotFoundCode =
  | "ENERGYIQ_GOLDEN_COVERAGE_NOT_FOUND"
  | "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND"
  | "ENERGYIQ_CURRENT_OVERVIEW_COVERAGE_NOT_FOUND";

export const selectEnergyGoldenPeriod = async (input: EnergyPeriodSelectionInput & {
  periodDays?: number;
}): Promise<EnergyGoldenSelection> => {
  const periodDays = input.periodDays ?? 7;
  if (!Number.isInteger(periodDays) || periodDays < 1) {
    throw new Error("ENERGYIQ_GOLDEN_PERIOD_DAYS_INVALID");
  }
  const { scoped, aggregateMeterNodeIds } = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_GOLDEN_COVERAGE_NOT_FOUND",
  );
  const selected = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: goldenPeriodSelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      periodDays,
      input.context.timezone
    ),
    limit: 1
  });
  const row = selected.rows[0];
  if (!row) {
    throw new Error("ENERGYIQ_GOLDEN_PERIOD_NOT_FOUND");
  }
  const dayResult = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: goldenDaySelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      stringAt(row, 0),
      stringAt(row, 1),
      input.context.timezone
    ),
    limit: 1
  });
  const dayRow = dayResult.rows[0];
  if (!dayRow) {
    throw new Error("ENERGYIQ_GOLDEN_DAY_NOT_FOUND");
  }
  const intervalMinutes = numberAt(row, 4);
  return {
    periodDays,
    intervalMinutes,
    policy: GOLDEN_SELECTION_POLICY,
    period: {
      localFrom: stringAt(row, 0),
      localToExclusive: stringAt(row, 1),
      from: isoAt(row, 2),
      to: isoAt(row, 3)
    },
    day: {
      localDate: stringAt(dayRow, 0),
      from: isoAt(dayRow, 1),
      to: isoAt(dayRow, 2)
    }
  };
};

export const selectEnergyLatestCompletePeriod = async (
  input: EnergyPeriodSelectionInput,
): Promise<EnergyLatestCompletePeriodSelection> => {
  const { scoped, aggregateMeterNodeIds } = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND",
  );
  const selected = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: latestCompletePeriodSelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      LATEST_COMPLETE_PERIOD_DAYS,
      input.context.timezone,
    ),
    limit: 1,
  });
  const row = selected.rows[0];
  if (!row) {
    throw new Error("ENERGYIQ_LATEST_COMPLETE_PERIOD_NOT_FOUND");
  }
  return {
    periodDays: LATEST_COMPLETE_PERIOD_DAYS,
    intervalMinutes: numberAt(row, 4),
    period: {
      localFrom: stringAt(row, 0),
      localToExclusive: stringAt(row, 1),
      from: isoAt(row, 2),
      to: isoAt(row, 3),
    },
  };
};

export const resolveEnergyLatestAvailablePeriod = async (
  input: EnergyPeriodSelectionInput,
): Promise<NonNullable<EnergyScopeAnalysis["latestAvailablePeriod"]> | null> => {
  try {
    const selected = await selectEnergyLatestCompletePeriod(input);
    const exclusive = new Date(`${selected.period.localToExclusive}T00:00:00.000Z`);
    if (Number.isNaN(exclusive.valueOf())) {
      throw new Error("ENERGYIQ_LATEST_COMPLETE_PERIOD_DATE_INVALID");
    }
    exclusive.setUTCDate(exclusive.getUTCDate() - 1);
    return {
      period: "Custom",
      from: selected.period.localFrom,
      to: exclusive.toISOString().slice(0, 10),
    };
  } catch (error) {
    if (error instanceof Error && (
      error.message === "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND"
      || error.message === "ENERGYIQ_LATEST_COMPLETE_PERIOD_NOT_FOUND"
    )) {
      return null;
    }
    throw error;
  }
};

export const selectEnergyCurrentOverviewPeriod = async (
  input: EnergyPeriodSelectionInput & { periodBasis: EnergyCurrentOverviewPeriodBasis },
): Promise<EnergyCurrentOverviewPeriodSelection> => {
  const probe = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_CURRENT_OVERVIEW_COVERAGE_NOT_FOUND",
    { latestProbeDays: CURRENT_OVERVIEW_SELECTION_PROBE_DAYS },
  );
  let selected = await runCurrentOverviewPeriodSelection(input, probe);
  if (!selected.rows[0] && probe.coverageBounded) {
    const fallback = await prepareEnergyPeriodSelection(
      input,
      "ENERGYIQ_CURRENT_OVERVIEW_COVERAGE_NOT_FOUND",
      { coverage: probe.coverage },
    );
    selected = await runCurrentOverviewPeriodSelection(input, fallback);
  }
  const row = selected.rows[0];
  if (!row) {
    throw new Error("ENERGYIQ_CURRENT_OVERVIEW_PERIOD_NOT_FOUND");
  }
  return {
    periodBasis: input.periodBasis,
    periodDays: numberAt(row, 6),
    cutoffLocalDate: stringAt(row, 0),
    intervalMinutes: numberAt(row, 5),
    period: {
      localFrom: stringAt(row, 1),
      localToExclusive: stringAt(row, 2),
      from: isoAt(row, 3),
      to: isoAt(row, 4),
    },
  };
};

const runCurrentOverviewPeriodSelection = (
  input: EnergyPeriodSelectionInput & { periodBasis: EnergyCurrentOverviewPeriodBasis },
  prepared: Awaited<ReturnType<typeof prepareEnergyPeriodSelection>>,
) => input.dataGateway.runSqlReadonly({
  user_id: input.userId,
  workspace_id: input.context.workspaceId,
  datasource_id: prepared.scoped.datasourceId,
  sql: currentOverviewPeriodSelectionSql(
    prepared.scoped.viewName,
    prepared.aggregateMeterNodeIds,
    input.periodBasis,
    input.context.timezone,
  ),
  limit: 1,
});

export const resolveEnergyCurrentOverviewPeriodBasis = (
  analysisWindow: "current-overview-7d" | "current-overview-28d" | "current-month-to-date",
): EnergyCurrentOverviewPeriodBasis => {
  if (analysisWindow === "current-month-to-date") return "calendar_month_to_date";
  return analysisWindow === "current-overview-7d" ? "rolling_7_days" : "rolling_28_days";
};

const prepareEnergyPeriodSelection = async (
  input: EnergyPeriodSelectionInput,
  coverageNotFoundCode: EnergyPeriodCoverageNotFoundCode,
  options: {
    latestProbeDays?: number;
    coverage?: EnergyFactCoverage;
  } = {},
) => {
  const databasePath = input.databasePath
    ?? resolveEnergyFactStorePath(input.context.workspaceId);
  const coverage = options.coverage ?? await readEnergyFactCoverage({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    resource: input.context.resource,
    databasePath,
  });
  if (!coverage) throw new Error(coverageNotFoundCode);
  const probeFrom = options.latestProbeDays
    ? new Date(Date.parse(coverage.to) - options.latestProbeDays * 86_400_000).toISOString()
    : coverage.from;
  const selectionFrom = probeFrom > coverage.from ? probeFrom : coverage.from;
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
  });
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId,
  );
  if (!hierarchy.some((node) => node.id === input.context.scopeId)) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const scoped = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: selectionFrom,
      to: coverage.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion,
    },
    databasePath,
  });
  return {
    scoped,
    aggregateMeterNodeIds: publishedMeterRoute.officialMeterPointIds ?? [],
    coverage,
    coverageBounded: selectionFrom !== coverage.from,
  };
};

export type EnergyOverviewHeadlineProjection = {
  summary: Pick<EnergyScopeAnalysis["summary"],
    "usageKwh" | "averageDailyUsageKwh" | "peakKw" | "peakAt"
  >;
  comparison: EnergyScopeAnalysis["comparison"];
  cost: EnergyScopeAnalysis["cost"];
  dataHealth: EnergyScopeAnalysis["dataHealth"];
  immediateChildScopeCount: number;
};

export type EnergyOverviewHeadlineProjectionInput = {
  from: string;
  to: string;
  usageKwh: number;
  previousUsageKwh: number;
  peakKw: number;
  peakAt?: string;
  intervalMinutes: number;
  meterPointCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
  cumulativeDeltaMismatchCount: number;
  averageKwMismatchCount: number;
  invalidIntervalDurationCount: number;
  lastSeenAt?: string;
  importBatchIds: string[];
  cost: EnergyScopeAnalysis["cost"];
  immediateChildScopeCount: number;
};

export const buildEnergyOverviewHeadlineProjection = (
  input: EnergyOverviewHeadlineProjectionInput,
): EnergyOverviewHeadlineProjection => {
  const periodDurationMs = Date.parse(input.to) - Date.parse(input.from);
  const previousFrom = new Date(Date.parse(input.from) - periodDurationMs).toISOString();
  const expectedIntervalCountPerMeter = Math.round(
    periodDurationMs / (input.intervalMinutes * 60_000),
  );
  const expectedMeterIntervalCount = input.meterPointCount * expectedIntervalCountPerMeter;
  const coveragePct = expectedMeterIntervalCount > 0
    ? round(Math.min(input.validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
    : 0;
  return {
    summary: {
      usageKwh: round(input.usageKwh, 4),
      averageDailyUsageKwh: round(
        input.usageKwh / calendarDayCount(input.from, input.to),
        4,
      ),
      peakKw: round(input.peakKw, 4),
      ...(input.peakAt ? { peakAt: input.peakAt } : {}),
    },
    comparison: {
      from: previousFrom,
      to: input.from,
      usageKwh: round(input.previousUsageKwh, 4),
      changeKwh: round(input.usageKwh - input.previousUsageKwh, 4),
      changePct: input.previousUsageKwh > 0
        ? round(((input.usageKwh - input.previousUsageKwh) / input.previousUsageKwh) * 100, 4)
        : null,
    },
    cost: input.cost,
    dataHealth: {
      status: expectedMeterIntervalCount === 0
        ? "unavailable"
        : input.validIntervalCount >= expectedMeterIntervalCount && input.qualityEventCount === 0
          ? "complete"
          : "partial",
      coveragePct,
      expectedMeterIntervalCount,
      validIntervalCount: input.validIntervalCount,
      qualityEventCount: input.qualityEventCount,
      cumulativeDeltaMismatchCount: input.cumulativeDeltaMismatchCount,
      averageKwMismatchCount: input.averageKwMismatchCount,
      invalidIntervalDurationCount: input.invalidIntervalDurationCount,
      ...(input.lastSeenAt ? { lastSeenAt: input.lastSeenAt } : {}),
      importBatchIds: input.importBatchIds,
    },
    immediateChildScopeCount: input.immediateChildScopeCount,
  };
};

export const selectEnergyCurrentOverviewPeriodReadOnly = async (
  input: EnergyPeriodSelectionInput & { periodBasis: EnergyCurrentOverviewPeriodBasis },
): Promise<EnergyCurrentOverviewPeriodSelection> => {
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
  });
  const selected = await readEnergyCurrentOverviewPeriod({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    resource: input.context.resource,
    meterPointIds: publishedMeterRoute.officialMeterPointIds ?? [],
    timezone: input.context.timezone,
    periodBasis: input.periodBasis,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  if (!selected) throw new Error("ENERGYIQ_CURRENT_OVERVIEW_PERIOD_NOT_FOUND");
  return {
    periodBasis: input.periodBasis,
    periodDays: selected.periodDays,
    cutoffLocalDate: inclusiveLocalDateFromExclusive(selected.localToExclusive),
    intervalMinutes: selected.intervalMinutes,
    period: {
      localFrom: selected.localFrom,
      localToExclusive: selected.localToExclusive,
      from: selected.from,
      to: selected.to,
    },
  };
};

const inclusiveLocalDateFromExclusive = (localToExclusive: string): string => {
  const date = new Date(`${localToExclusive}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const executeEnergyOverviewHeadlineProjection = async (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  databasePath?: string;
}): Promise<EnergyOverviewHeadlineProjection> => {
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
  });
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId,
  );
  const selectedNode = hierarchy.find((node) => node.id === input.context.scopeId);
  if (!selectedNode) throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  const aggregateMeterNodeIds = publishedMeterRoute.officialMeterPointIds ?? [];
  const read = await readEnergyOverviewHeadline({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    resource: input.context.resource,
    meterPointIds: aggregateMeterNodeIds,
    from: input.context.from,
    to: input.context.to,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const operationalPolicy = evaluateReleasePinnedOperationalPolicy({
    metadataStore: input.metadataStore,
    context: input.context,
    scopeId: input.context.scopeId,
    intervals: read.intervals,
  });
  return buildEnergyOverviewHeadlineProjection({
    from: input.context.from,
    to: input.context.to,
    usageKwh: read.usageKwh,
    previousUsageKwh: read.previousUsageKwh,
    peakKw: read.peakKw,
    ...(read.peakAt ? { peakAt: read.peakAt } : {}),
    intervalMinutes: read.intervalMinutes,
    meterPointCount: aggregateMeterNodeIds.length,
    validIntervalCount: read.validIntervalCount,
    qualityEventCount: read.qualityEventCount,
    cumulativeDeltaMismatchCount: read.cumulativeDeltaMismatchCount,
    averageKwMismatchCount: read.averageKwMismatchCount,
    invalidIntervalDurationCount: read.invalidIntervalDurationCount,
    ...(read.lastSeenAt ? { lastSeenAt: read.lastSeenAt } : {}),
    importBatchIds: read.importBatchIds,
    cost: mapTariffEvaluation(operationalPolicy.tariff),
    immediateChildScopeCount: hierarchy.filter((node) => node.parent_id === selectedNode.id).length,
  });
};

export type EnergyDailyTotalsProjection = {
  dailyTotals: NonNullable<EnergyScopeAnalysis["dailyTotals"]>;
  provenance: {
    dataSnapshotId: string;
    queryId: "daily_totals_v1";
  };
};

export type EnergyDayProfileProjection = Pick<EnergyScopeAnalysis,
  "timeBehaviour" | "componentHourlyProfiles"
>;

export const executeEnergyDailyTotalsProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
}): Promise<EnergyDailyTotalsProjection> => {
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
  });
  const databasePath = input.databasePath
    ?? resolveEnergyFactStorePath(input.context.workspaceId);
  const prepared = await prepareEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion,
    },
    databasePath,
  });
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId,
  );
  const selectedNode = hierarchy.find((node) => node.id === input.context.scopeId);
  if (!selectedNode) throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  const scopes: DailyTotalScope[] = [{
    scopeId: selectedNode.id,
    scopeName: selectedNode.name,
    scopeType: selectedNode.node_type,
    meterNodeIds: publishedMeterRoute.officialMeterPointIds ?? [],
  }];
  const dateBuckets = buildDailyDateBuckets(input.context);

  return await input.dataGateway.withEnergySnapshotReadSession({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: prepared.sessionDatasourceId,
  }, async (factScope) => {
    const scoped = registerPreparedEnergyScopedDataSource({
      metadataStore: input.metadataStore,
      userId: input.userId,
      prepared,
      factScope,
    });
    const [healthResult, dailyTotalsResult] = await Promise.all([
      input.dataGateway.runSqlReadonly({
        user_id: input.userId,
        workspace_id: input.context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: scopeHealthSql(scoped.viewName, scopes[0]!.meterNodeIds),
      }),
      input.dataGateway.runSqlReadonly({
        user_id: input.userId,
        workspace_id: input.context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: dailyTotalsSql(scoped.viewName, scopes),
        limit: Math.max(1, dateBuckets.length),
      }),
    ]);
    const intervalMinutes = numberAt(healthResult.rows[0] ?? [], 2) || 15;
    return {
      dailyTotals: buildDailyTotalsProjection({
        context: input.context,
        scopes,
        dateBuckets,
        rows: dailyTotalsResult.rows,
        intervalMinutes,
      }),
      provenance: {
        dataSnapshotId: input.context.dataSnapshotId,
        queryId: "daily_totals_v1",
      },
    };
  });
};

export const executeEnergyDayProfileProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
}): Promise<EnergyDayProfileProjection> => {
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
  });
  const prepared = await prepareEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion,
    },
    databasePath: input.databasePath ?? resolveEnergyFactStorePath(input.context.workspaceId),
  });
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId,
  );
  const selectedNode = hierarchy.find((node) => node.id === input.context.scopeId);
  if (!selectedNode) throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  const dateBuckets = buildDailyDateBuckets(input.context);

  return input.dataGateway.withEnergySnapshotReadSession({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: prepared.sessionDatasourceId,
  }, async (factScope) => {
    const scoped = registerPreparedEnergyScopedDataSource({
      metadataStore: input.metadataStore,
      userId: input.userId,
      prepared,
      factScope,
    });
    const [meterResult, healthResult] = await Promise.all([
      input.dataGateway.runSqlReadonly({
        user_id: input.userId,
        workspace_id: input.context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: meterBreakdownSql(scoped.viewName),
        limit: 1000,
      }),
      input.dataGateway.runSqlReadonly({
        user_id: input.userId,
        workspace_id: input.context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: scopeHealthSql(scoped.viewName, publishedMeterRoute.officialMeterPointIds ?? []),
      }),
    ]);
    const meterAggregates = meterResult.rows.map(rowToMeterAggregate);
    const scopes = resolveDailyTotalScopes({
      metadataStore: input.metadataStore,
      projectId: input.context.projectId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: input.context.meterMappingRevisionId,
      resource: input.context.resource,
      selectedNode,
      hierarchy,
      meterAggregates,
      aggregateMeterNodeIds: publishedMeterRoute.officialMeterPointIds ?? [],
    });
    const componentSeries = buildComponentHourlyCircuitSeries({
      dailyTotalScopes: scopes,
      hierarchy,
      meterAggregates,
      componentMeterNodeIds: publishedMeterRoute.componentMeterPointIds,
    });
    const [timeResult, componentResult] = await Promise.all([
      input.dataGateway.runSqlReadonly({
        user_id: input.userId,
        workspace_id: input.context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: timeBucketGridSql(scoped.viewName, scopes),
        limit: Math.max(1, scopes.length),
      }),
      componentSeries.length > 0
        ? input.dataGateway.runSqlReadonly({
            user_id: input.userId,
            workspace_id: input.context.workspaceId,
            datasource_id: scoped.datasourceId,
            sql: componentHourlyProfilesSql(scoped.viewName, componentSeries),
            limit: Math.max(1, componentSeries.length),
          })
        : Promise.resolve(undefined),
    ]);
    const intervalMinutes = numberAt(healthResult.rows[0] ?? [], 2) || 15;
    const publicHolidayDatesByScopeId = resolvePublicHolidayDatesByScope({
      metadataStore: input.metadataStore,
      projectId: input.context.projectId,
      businessCalendarVersion: input.context.businessCalendarVersion,
      period: { from: input.context.from, to: input.context.to },
      scopes,
    });
    const timeBehaviour = buildTimeBehaviour({
      timezone: input.context.timezone,
      scopes,
      dateBuckets,
      intervalMinutes,
      rows: timeResult.rows,
      publicHolidayDatesByScopeId,
    });
    return {
      timeBehaviour: {
        ...timeBehaviour,
        scopes: timeBehaviour.scopes.map((scope) => ({ ...scope, cells: [] })),
      },
      ...(componentResult ? {
        componentHourlyProfiles: buildComponentHourlyProfiles({
          timezone: input.context.timezone,
          scopes,
          dateBuckets,
          intervalMinutes,
          series: componentSeries,
          rows: componentResult.rows,
          publicHolidayDatesByScopeId,
        }),
      } : {}),
    };
  });
};

export const executeEnergyScopeAnalysis = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
  projectReleaseId?: string;
  ruleRevisions?: readonly EnergyIqRuleRevisionRecord[];
  includeTimeBehaviour?: boolean;
  includeMeterOperationalBreakdown?: boolean;
  includeImmediateChildDailyTotals?: boolean;
  profile?: "full" | "explorer";
}): Promise<EnergyScopeAnalysis> => {
  const explorerProfile = input.profile === "explorer";
  const ruleRevisions = input.ruleRevisions
    ?? input.metadataStore.energyIq.rules.listRevisions()
      .filter((rule) => rule.requirement !== "historical_baseline");
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId
  });
  const databasePath = input.databasePath
    ?? resolveEnergyFactStorePath(input.context.workspaceId);
  const scopedPrepared = await prepareEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion
    },
    databasePath,
  });

  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId
  );
  const selectedNode = hierarchy.find((node) => node.id === input.context.scopeId);
  if (!selectedNode) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const periodDurationMs = Date.parse(input.context.to) - Date.parse(input.context.from);
  const previousFrom = new Date(Date.parse(input.context.from) - periodDurationMs).toISOString();
  const previousTo = input.context.from;
  const previousScopedPrepared = await prepareEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: previousFrom,
      to: previousTo,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion
    },
    databasePath: scopedPrepared.databasePath
  });
  const dailyUsageAnomalyPreparation: DailyUsageAnomalyPreparation = explorerProfile
    ? { status: "absent" }
    : prepareDailyUsageAnomaly({
        metadataStore: input.metadataStore,
        context: input.context,
        ...(input.projectReleaseId ? { projectReleaseId: input.projectReleaseId } : {}),
        ruleRevisions,
      });
  const historicalScopedPrepared = dailyUsageAnomalyPreparation.status === "ready"
    ? await prepareEnergyScopedDataSource({
        metadataStore: input.metadataStore,
        userId: input.userId,
        context: {
          workspaceId: input.context.workspaceId,
          projectId: input.context.projectId,
          scopeId: input.context.scopeId,
          meterAttachments: publishedMeterRoute.attachments,
          resource: input.context.resource,
          from: dailyUsageAnomalyPreparation.historicalFrom,
          to: input.context.to,
          timezone: input.context.timezone,
          hierarchyRevisionId: input.context.hierarchyRevisionId,
          meterMappingRevisionId: input.context.meterMappingRevisionId,
          meterFormulaRevisionId: input.context.meterFormulaRevisionId,
          dataSnapshotId: input.context.dataSnapshotId,
          metricVersion: input.context.metricVersion,
        },
        databasePath: scopedPrepared.databasePath,
      })
    : undefined;

  return await input.dataGateway.withEnergySnapshotReadSession({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scopedPrepared.sessionDatasourceId,
  }, async (factScope) => {
  const scoped = registerPreparedEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    prepared: scopedPrepared,
    factScope,
  });
  const previousScoped = registerPreparedEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    prepared: previousScopedPrepared,
    factScope,
  });
  const historicalScoped = historicalScopedPrepared
    ? registerPreparedEnergyScopedDataSource({
        metadataStore: input.metadataStore,
        userId: input.userId,
        prepared: historicalScopedPrepared,
        factScope,
      })
    : undefined;

  const aggregateMeterNodeIds = publishedMeterRoute.officialMeterPointIds ?? [];
  const canonicalHeadlineRead = await readEnergyOverviewHeadline({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    resource: input.context.resource,
    meterPointIds: aggregateMeterNodeIds,
    from: input.context.from,
    to: input.context.to,
    databasePath,
  });
  const meterResult = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: meterBreakdownSql(scoped.viewName),
    limit: 1000
  });
  const meterAggregates = meterResult.rows.map(rowToMeterAggregate);
  const explorerDocument = explorerProfile ? JSON.parse(input.metadataStore.energyIq.projectSetup.listHierarchyRevisions(input.context.projectId)
    .find(revision => revision.id === input.context.hierarchyRevisionId)!.snapshot_json) as EnergyIqProjectSetupDocument : undefined;
  const explorerMeters = explorerDocument ? projectExplorerMeters({
    document: explorerDocument,
    scopeIds: new Set([selectedNode.id, ...collectDescendantIds(selectedNode.id, hierarchy)]),
    resource: input.context.resource,
    officialMeterIds: new Set(aggregateMeterNodeIds),
  }) : [];
  // Inside one space (not the whole project) every meter below it gets a series, for per-circuit hourly views.
  const isProjectScope = selectedNode.node_type === "project" || !selectedNode.parent_id;
  // One series per meter type over the official meters, so daily splits by type add up to the official total.
  const officialByCategory = new Map<string, string[]>();
  for (const meter of explorerMeters) {
    if (meter.kind !== "physical" || !aggregateMeterNodeIds.includes(meter.id)) continue;
    officialByCategory.set(meter.category, [...(officialByCategory.get(meter.category) ?? []), meter.id]);
  }
  // Virtual meters (e.g. main − sub-meters) get the same hourly series, computed from their inputs' intervals.
  const virtualTrendRoutes: ExplorerTrendRoute[] = explorerMeters
    .filter(m => m.kind === "virtual" && (m.scopeId === selectedNode.id || (!isProjectScope && explorerMeters.length <= MAX_DESCENDANT_METER_TRENDS)))
    .flatMap(m => {
      const definition = explorerDocument?.meter_mapping?.virtual_meters?.find(meter => meter.id === m.id);
      return definition ? [{
        id: m.id,
        meters: definition.terms.map(term => term.mapping_row_id),
        coefficients: Object.fromEntries(definition.terms.map(term => [term.mapping_row_id, term.coefficient])),
      }] : [];
    });
  const trendRoutes = explorerProfile ? [
    { id: "__scope__", meters: aggregateMeterNodeIds },
    ...[...officialByCategory].map(([category, meters]) => ({ id: `__category__:${category}`, meters })),
    ...explorerMeters.filter(m => m.kind === "physical" && (m.scopeId === selectedNode.id || (!isProjectScope && explorerMeters.length <= MAX_DESCENDANT_METER_TRENDS)))
      .map(m => ({id: m.id, meters: [m.id]})),
    ...virtualTrendRoutes,
  ] : [];
  const trendSql = explorerTrendSql(scoped.viewName, trendRoutes);
  const trendRows = trendSql ? await input.dataGateway.runSqlReadonly({
    user_id: input.userId, workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId, sql: trendSql, limit: trendRoutes.length,
  }) : null;
  const explorerTrends = explorerProfile ? decodeExplorerTrends(trendRows?.rows.map(row => ({series_id: row[0], cells: row[1]})) ?? [], trendRoutes) : undefined;
  const virtualPeakSql = virtualMeterPeakSql(scoped.viewName, virtualTrendRoutes);
  const virtualPeakRows = virtualPeakSql ? await input.dataGateway.runSqlReadonly({
    user_id: input.userId, workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId, sql: virtualPeakSql, limit: virtualTrendRoutes.length,
  }) : null;
  const virtualMeterPeaks = new Map((virtualPeakRows?.rows ?? []).flatMap(row => {
    const peakKw = Number(row[1]);
    return typeof row[0] === "string" && Number.isFinite(peakKw)
      ? [[row[0], { peakKw: round(peakKw, 4), peakAt: String(row[2] ?? "") }] as const]
      : [];
  }));
  const aggregateMeterIds = new Set(aggregateMeterNodeIds);
  const componentMeterNodeIds = publishedMeterRoute.componentMeterPointIds;
  const componentMeterIds = new Set(componentMeterNodeIds);
  const aggregateMeters = meterAggregates.filter((meter) => aggregateMeterIds.has(meter.meterNodeId));
  const resolvedDailyTotalScopes = resolveDailyTotalScopes({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    meterMappingRevisionId: input.context.meterMappingRevisionId,
    resource: input.context.resource,
    selectedNode,
    hierarchy,
    meterAggregates,
    aggregateMeterNodeIds,
  });
  const dailyTotalScopes = explorerProfile && input.includeImmediateChildDailyTotals !== true
    ? resolvedDailyTotalScopes.filter((scope) => scope.scopeId === selectedNode.id).slice(0, 1)
    : resolvedDailyTotalScopes;
  const dailyDateBuckets = buildDailyDateBuckets(input.context);
  const dailyComponentCategorySeries = buildDailyComponentCategorySeries({
    dailyTotalScopes,
    hierarchy,
    meterAggregates,
    componentMeterNodeIds,
  });
  const componentHourlyCircuitSeries = buildComponentHourlyCircuitSeries({
    dailyTotalScopes,
    hierarchy,
    meterAggregates,
    componentMeterNodeIds,
  });
  const dailyUsageAnomalyLoadInput = {
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.userId,
    context: input.context,
    dailyTotalScopes,
    hierarchy,
    meterAggregates,
    preparation: dailyUsageAnomalyPreparation,
    ...(historicalScoped ? { historicalScoped } : {}),
  };
  const aggregationRule = publishedMeterRoute.officialMeterRoles
    ? aggregationRuleForRoles(publishedMeterRoute.officialMeterRoles)
    : aggregationRuleForMeters(aggregateMeters);
  // Keep Snapshot-backed scans in explicit bounded batches. The optional anomaly query runs in
  // its own final batch so enabling it cannot push the shared DuckDB connection fan-out above 3.
  const [profileResult, healthResult] = await Promise.all([
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: hourlyProfileSql(scoped.viewName, aggregateMeterNodeIds),
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: scopeHealthSql(scoped.viewName, aggregateMeterNodeIds),
    }),
  ]);
  const [dailyTotalsResult, timeBucketGridResult, previousMeterUsageResult] = await Promise.all([
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: dailyTotalsSql(scoped.viewName, dailyTotalScopes),
      limit: Math.max(1, dailyTotalScopes.length * dailyDateBuckets.length),
    }),
    explorerProfile || input.includeTimeBehaviour === false
      ? Promise.resolve(undefined)
      : input.dataGateway.runSqlReadonly({
          user_id: input.userId,
          workspace_id: input.context.workspaceId,
          datasource_id: scoped.datasourceId,
          sql: timeBucketGridSql(scoped.viewName, dailyTotalScopes),
          limit: Math.max(1, dailyTotalScopes.length),
        }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: previousScoped.datasourceId,
      sql: previousMeterUsageSql(
        previousScoped.viewName,
        meterAggregates.map((meter) => meter.meterNodeId),
      ),
      limit: 1000,
    }),
  ]);
  const [dailyComponentCategoryResult, componentHourlyProfilesResult] = await Promise.all([
    dailyComponentCategorySeries.length > 0
      ? input.dataGateway.runSqlReadonly({
          user_id: input.userId,
          workspace_id: input.context.workspaceId,
          datasource_id: scoped.datasourceId,
          sql: dailyComponentCategoriesSql(scoped.viewName, dailyComponentCategorySeries),
          limit: Math.max(
            1,
            dailyComponentCategorySeries.length * dailyDateBuckets.length,
          ),
        })
      : Promise.resolve(undefined),
    !explorerProfile
      && input.includeTimeBehaviour !== false
      && componentHourlyCircuitSeries.length > 0
      ? input.dataGateway.runSqlReadonly({
          user_id: input.userId,
          workspace_id: input.context.workspaceId,
          datasource_id: scoped.datasourceId,
          sql: componentHourlyProfilesSql(scoped.viewName, componentHourlyCircuitSeries),
          limit: Math.max(1, componentHourlyCircuitSeries.length),
        })
      : Promise.resolve(undefined),
  ]);
  const peakAtForBreakdown = canonicalHeadlineRead.peakAt ?? undefined;
  const [peakBreakdownResult, operationalMeterIntervalResult] = await Promise.all([
    explorerProfile
      ? Promise.resolve(undefined)
      : input.dataGateway.runSqlReadonly({
          user_id: input.userId,
          workspace_id: input.context.workspaceId,
          datasource_id: scoped.datasourceId,
          sql: peakBreakdownSql(scoped.viewName, peakAtForBreakdown),
          limit: 1000,
        }),
    explorerProfile || input.includeMeterOperationalBreakdown === false
      ? Promise.resolve(undefined)
      : input.dataGateway.runSqlReadonly({
          user_id: input.userId,
          workspace_id: input.context.workspaceId,
          datasource_id: scoped.datasourceId,
          sql: operationalPolicyMeterIntervalsSql(
            scoped.viewName,
            meterAggregates.map((meter) => meter.meterNodeId),
          ),
          limit: Math.max(1, meterAggregates.length),
        }),
  ]);
  const dailyUsageAnomalyLoad = await loadDailyUsageAnomalyFacts(dailyUsageAnomalyLoadInput);
  const healthRow = healthResult.rows[0] ?? [];
  const usageKwh = canonicalHeadlineRead.usageKwh;
  const peakKw = canonicalHeadlineRead.peakKw;
  const peakAt = canonicalHeadlineRead.peakAt;
  const intervalMinutes = canonicalHeadlineRead.intervalMinutes;
  const leafMeterScope = isLeafMeterScope(selectedNode, hierarchy);
  const latestAcceptedReading = buildLatestAcceptedReading({
    leafMeterScope,
    row: healthRow,
  });
  const dailyTotals = buildDailyTotalsProjection({
    context: input.context,
    scopes: dailyTotalScopes,
    dateBuckets: dailyDateBuckets,
    rows: dailyTotalsResult.rows,
    intervalMinutes,
  });
  const calendarTotals = buildCalendarTotals({
    timezone: input.context.timezone,
    selectedScopeId: input.context.scopeId,
    dailyTotals,
  });
  const publicHolidayDatesByScopeId = resolvePublicHolidayDatesByScope({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    businessCalendarVersion: input.context.businessCalendarVersion,
    period: { from: input.context.from, to: input.context.to },
    scopes: dailyTotalScopes,
  });
  const timeBehaviour = timeBucketGridResult
    ? buildTimeBehaviour({
        timezone: input.context.timezone,
        scopes: dailyTotalScopes,
        dateBuckets: dailyDateBuckets,
        intervalMinutes,
        rows: timeBucketGridResult.rows,
        publicHolidayDatesByScopeId,
      })
    : undefined;
  const componentHourlyProfiles = componentHourlyProfilesResult
    ? buildComponentHourlyProfiles({
        timezone: input.context.timezone,
        scopes: dailyTotalScopes,
        dateBuckets: dailyDateBuckets,
        intervalMinutes,
        series: componentHourlyCircuitSeries,
        rows: componentHourlyProfilesResult.rows,
        publicHolidayDatesByScopeId,
      })
    : undefined;
  const dailyUsageAnomalies = buildDailyUsageAnomalies({
    load: dailyUsageAnomalyLoad,
    context: input.context,
    dateBuckets: dailyDateBuckets,
    intervalMinutes,
  });
  const previousMeterUsageById = new Map(
    previousMeterUsageResult.rows.map((row) => [stringAt(row, 0), numberAt(row, 1)]),
  );
  const operationalSeries: OperationalIntervalSeries[] = [
    { kind: "scope", intervals: canonicalHeadlineRead.intervals },
    ...(operationalMeterIntervalResult?.rows ?? []).map(rowToOperationalIntervalSeries),
  ];
  const scopeOperationalSeries = operationalSeries.find((series) => series.kind === "scope");
  if (!scopeOperationalSeries) {
    throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SCOPE_INTERVALS_MISSING");
  }
  const operationalPolicy = evaluateReleasePinnedOperationalPolicy({
    metadataStore: input.metadataStore,
    context: input.context,
    scopeId: input.context.scopeId,
    intervals: scopeOperationalSeries.intervals,
  });
  const circuitOperatingByMeterId = new Map<string, EnergyIqOperatingEvaluation>();
  if (
    !explorerProfile
    &&
    input.includeMeterOperationalBreakdown !== false
    && operationalPolicy.operating.status === "available"
  ) {
    const meterSeriesByMeterId = new Map(
      operationalSeries
        .filter((series): series is OperationalIntervalSeries & { meterNodeId: string } =>
          series.kind === "meter" && series.meterNodeId !== undefined,
        )
        .map((series) => [series.meterNodeId, series]),
    );
    const missingMeterIds = meterAggregates
      .filter((meter) => meter.validIntervalCount > 0 && !meterSeriesByMeterId.has(meter.meterNodeId))
      .map((meter) => meter.meterNodeId);
    if (missingMeterIds.length > 0) {
      throw new Error(
        `ENERGYIQ_OPERATIONAL_POLICY_METER_INTERVALS_INCOMPLETE:${missingMeterIds.join(",")}`,
      );
    }
    for (const meter of meterAggregates) {
      const series = meterSeriesByMeterId.get(meter.meterNodeId);
      const evaluation = evaluateReleasePinnedOperationalPolicy({
        metadataStore: input.metadataStore,
        context: input.context,
        scopeId: series?.scopeId ?? meter.scopeId,
        intervals: series?.intervals ?? [],
      });
      circuitOperatingByMeterId.set(meter.meterNodeId, evaluation.operating);
    }
  }
  const expectedIntervalCountPerMeter = Math.round(
    periodDurationMs / (intervalMinutes * 60_000),
  );
  const expectedMeterIntervalCount = aggregateMeterNodeIds.length * expectedIntervalCountPerMeter;
  const scopeDimensions = resolveScopeDimensions(selectedNode.id, hierarchy);
  const childScopes = buildChildScopes({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    meterMappingRevisionId: input.context.meterMappingRevisionId,
    resource: input.context.resource,
    scopeNodeId: selectedNode.id,
    hierarchy,
    meterAggregates,
    previousMeterUsageById,
    scopeUsageKwh: usageKwh,
    periodDurationMs,
    intervalMinutes,
  });
  const hierarchyById = new Map(hierarchy.map((node) => [node.id, node]));
  const circuits = meterAggregates
    .map((meter) => {
      const meterOperating = circuitOperatingByMeterId.get(meter.meterNodeId);
      const parentScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
      const previousMeterUsageKwh = previousMeterUsageById.get(meter.meterNodeId) ?? 0;
      const changeKwh = meter.usageKwh - previousMeterUsageKwh;
      const expectedCircuitIntervalCount = expectedIntervalCountPerMeter;
      return {
        meterNodeId: meter.meterNodeId,
        scopeId: meter.scopeId,
        ...(parentScopeId ? { parentScopeId } : {}),
        name: meter.name,
        appliance: meter.appliance,
        category: meter.category,
        meterRole: meter.meterRole,
        includedInOfficialTotal: aggregateMeterIds.has(meter.meterNodeId),
        usageKwh: round(meter.usageKwh, 4),
        sharePct: percent(meter.usageKwh, usageKwh, 4),
        comparison: {
          usageKwh: round(previousMeterUsageKwh, 4),
          changeKwh: round(changeKwh, 4),
          changePct: previousMeterUsageKwh > 0
            ? round((changeKwh / previousMeterUsageKwh) * 100, 4)
            : null,
        },
        dataHealth: {
          coveragePct: expectedCircuitIntervalCount > 0
            ? round(Math.min(meter.validIntervalCount / expectedCircuitIntervalCount, 1) * 100, 4)
            : 0,
          expectedMeterIntervalCount: expectedCircuitIntervalCount,
          validIntervalCount: meter.validIntervalCount,
          qualityEventCount: meter.qualityEventCount,
        },
        ...(meterOperating?.status === "available"
          ? { nonOperatingKwh: round(meterOperating.standby_kwh, 4) }
          : {}),
        peakKw: round(meter.peakKw, 4),
        qualityEventCount: meter.qualityEventCount
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const designatedTotals = circuits.filter((meter) => meter.includedInOfficialTotal);
  const topCircuits = circuits.filter((meter) => componentMeterIds.has(meter.meterNodeId));
  const categoryMeters = new Map<string, MeterAggregate[]>();
  for (const meter of aggregateMeters) {
    categoryMeters.set(meter.category, [...(categoryMeters.get(meter.category) ?? []), meter]);
  }
  const categories = [...categoryMeters.entries()]
    .map(([category, meters]) => {
      const categoryUsageKwh = meters.reduce((sum, meter) => sum + meter.usageKwh, 0);
      const previousCategoryUsageKwh = meters.reduce(
        (sum, meter) => sum + (previousMeterUsageById.get(meter.meterNodeId) ?? 0),
        0,
      );
      const changeKwh = categoryUsageKwh - previousCategoryUsageKwh;
      const expectedCategoryIntervalCount = meters.length * expectedIntervalCountPerMeter;
      const validCategoryIntervalCount = meters.reduce(
        (sum, meter) => sum + meter.validIntervalCount,
        0,
      );
      const categoryQualityEventCount = meters.reduce(
        (sum, meter) => sum + meter.qualityEventCount,
        0,
      );
      return {
        category,
        usageKwh: round(categoryUsageKwh, 4),
        sharePct: percent(categoryUsageKwh, usageKwh, 4),
        comparison: {
          usageKwh: round(previousCategoryUsageKwh, 4),
          changeKwh: round(changeKwh, 4),
          changePct: previousCategoryUsageKwh > 0
            ? round((changeKwh / previousCategoryUsageKwh) * 100, 4)
            : null,
        },
        dataHealth: {
          coveragePct: expectedCategoryIntervalCount > 0
            ? round(
              Math.min(validCategoryIntervalCount / expectedCategoryIntervalCount, 1) * 100,
              4,
            )
            : 0,
          expectedMeterIntervalCount: expectedCategoryIntervalCount,
          validIntervalCount: validCategoryIntervalCount,
          qualityEventCount: categoryQualityEventCount,
        },
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const officialUsageKwh = aggregateMeters.reduce((sum, meter) => sum + meter.usageKwh, 0);
  const componentUsageKwh = meterAggregates
    .filter((meter) => componentMeterIds.has(meter.meterNodeId))
    .reduce((sum, meter) => sum + meter.usageKwh, 0);
  const componentReconciliation: EnergyScopeAnalysis["componentReconciliation"] = {
    officialUsageKwh: round(officialUsageKwh, 4),
    componentUsageKwh: round(componentUsageKwh, 4),
    gapKwh: round(officialUsageKwh - componentUsageKwh, 4),
    ratioPct: officialUsageKwh > 0
      ? round((componentUsageKwh / officialUsageKwh) * 100, 4)
      : null,
    officialMeterNodeIds: [...aggregateMeterNodeIds].sort(),
    componentMeterNodeIds: meterAggregates
      .filter((meter) => componentMeterIds.has(meter.meterNodeId))
      .map((meter) => meter.meterNodeId)
      .sort(),
  };
  const virtualMeters = buildVirtualMeters({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    resource: input.context.resource,
    selectedScopeId: selectedNode.id,
    hierarchy,
    circuits
  });
  const virtualMeterTraces = buildVirtualMeterTraces({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    resource: input.context.resource,
    selectedScopeId: selectedNode.id,
    hierarchy,
    circuits,
  }).map((trace) => {
    const peak = virtualMeterPeaks.get(trace.meterNodeId);
    return peak ? { ...trace, ...peak } : trace;
  });

  const headlineProjection = buildEnergyOverviewHeadlineProjection({
    from: input.context.from,
    to: input.context.to,
    usageKwh: canonicalHeadlineRead.usageKwh,
    previousUsageKwh: canonicalHeadlineRead.previousUsageKwh,
    peakKw: canonicalHeadlineRead.peakKw,
    ...(canonicalHeadlineRead.peakAt ? { peakAt: canonicalHeadlineRead.peakAt } : {}),
    intervalMinutes: canonicalHeadlineRead.intervalMinutes,
    meterPointCount: aggregateMeterNodeIds.length,
    validIntervalCount: canonicalHeadlineRead.validIntervalCount,
    qualityEventCount: canonicalHeadlineRead.qualityEventCount,
    cumulativeDeltaMismatchCount: canonicalHeadlineRead.cumulativeDeltaMismatchCount,
    averageKwMismatchCount: canonicalHeadlineRead.averageKwMismatchCount,
    invalidIntervalDurationCount: canonicalHeadlineRead.invalidIntervalDurationCount,
    ...(canonicalHeadlineRead.lastSeenAt ? { lastSeenAt: canonicalHeadlineRead.lastSeenAt } : {}),
    importBatchIds: canonicalHeadlineRead.importBatchIds,
    cost: mapTariffEvaluation(operationalPolicy.tariff),
    immediateChildScopeCount: hierarchy.filter((node) => node.parent_id === selectedNode.id).length,
  });
  const summary: EnergyScopeAnalysis["summary"] = {
    ...headlineProjection.summary,
    ...(operationalPolicy.operating.status === "available" ? {
      nonOperatingKwh: round(operationalPolicy.operating.standby_kwh, 4),
      nonOperatingSharePct: percent(operationalPolicy.operating.standby_kwh, usageKwh),
    } : {}),
    ...(scopeDimensions.areaSqm > 0 ? {
      areaSqm: round(scopeDimensions.areaSqm, 2),
      kwhPerSqm: round(usageKwh / scopeDimensions.areaSqm, 4)
    } : {}),
    ...(scopeDimensions.occupantCount > 0 ? {
      occupantCount: scopeDimensions.occupantCount,
      kwhPerPerson: round(usageKwh / scopeDimensions.occupantCount, 4)
    } : {}),
    validIntervalCount: headlineProjection.dataHealth.validIntervalCount,
    qualityEventCount: headlineProjection.dataHealth.qualityEventCount,
  };
  const comparison = headlineProjection.comparison;
  const offHours = mapOperatingEvaluation(operationalPolicy.operating, usageKwh);
  const cost = headlineProjection.cost;
  const componentCategoryBreakdown = dailyComponentCategoryResult
    ? buildComponentCategoryBreakdown({
        timezone: input.context.timezone,
        dateBuckets: dailyDateBuckets,
        dailyTotals,
        series: dailyComponentCategorySeries,
        rows: dailyComponentCategoryResult.rows,
        intervalMinutes,
        cost,
        publicHolidayDatesByScopeId,
      })
    : undefined;
  const dataHealth = headlineProjection.dataHealth;
  const peakBreakdown = selectedNode.node_type === "project" && peakBreakdownResult
    ? buildPeakBreakdown({
        ...(peakAt ? { peakAt } : {}),
        peakKw,
        intervalMinutes,
        timezone: input.context.timezone,
        periodStatus: dataHealth.status === "complete" ? "complete" : "partial",
        coveragePct: dataHealth.coveragePct,
        projectOfficialMeterNodeIds: aggregateMeterNodeIds,
        levelScopes: dailyTotalScopes.slice(1),
        hierarchy,
        meterAggregates,
        facts: peakBreakdownResult.rows.map(rowToPeakIntervalFact),
      })
    : undefined;
  // Read outside the analysis window on purpose: the window stops on the last
  // day every Meter covered, so a Meter that went quiet is invisible within it.
  const reportingCoverage = await readEnergyReportingCoverage({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    resource: input.context.resource,
    timezone: input.context.timezone,
    dayCount: REPORTING_HEALTH_DAY_COUNT,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  }).catch(() => null);
  return {
    context: input.context,
    ...(reportingCoverage
      ? { reportingHealth: resolveEnergyReportingHealth(reportingCoverage) }
      : {}),
    latestAcceptedReading,
    summary,
    comparison,
    ...(explorerTrends ? { explorerTrends, monitoringMode: (() => {
      const batches = input.metadataStore.energyIq.listImportBatches(input.context.projectId).filter(batch => batch.status === "materialized");
      return batches.some(batch => batch.source_kind === "tuya") ? "api" as const : batches.length ? "file" as const : "unknown" as const;
    })() } : {}),
    hourlyProfile: profileResult.rows.map((row) => ({
      hour: numberAt(row, 0),
      usageKwh: round(numberAt(row, 1), 4),
      averageKw: round(numberAt(row, 2), 4),
      peakKw: round(numberAt(row, 3), 4),
      observationCount: numberAt(row, 4)
    })),
    dailyTotals,
    ...(componentCategoryBreakdown ? { componentCategoryBreakdown } : {}),
    calendarTotals,
    ...(timeBehaviour ? { timeBehaviour } : {}),
    ...(componentHourlyProfiles ? { componentHourlyProfiles } : {}),
    ...(dailyUsageAnomalies ? { dailyUsageAnomalies } : {}),
    ...(peakBreakdown ? { peakBreakdown } : {}),
    categories,
    childScopes,
    circuits,
    ...(explorerProfile ? { explorerMeters } : {}),
    topCircuits,
    designatedTotals,
    componentReconciliation,
    virtualMeters,
    ...(virtualMeterTraces.length > 0 ? { virtualMeterTraces } : {}),
    offHours,
    cost,
    dataHealth,
    units: {
      usage: "kWh",
      demand: "kW",
      intervalMinutes,
      timezone: operationalPolicy.operating.status === "available"
        ? operationalPolicy.operating.timezone
        : input.context.timezone
    },
    attention: evaluateEnergyAttention({ summary, childScopes, circuits, ruleRevisions }),
    provenance: {
      dataSnapshotId: input.context.dataSnapshotId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      metricVersion: input.context.metricVersion,
      ruleRevisionIds: ruleRevisions.map((rule) => rule.revision_id),
      aggregationRule,
      sourceView: scoped.viewName,
      queryIds: [
        "scope_summary_v1",
        "hourly_profile_v1",
        "daily_totals_v1",
        ...(dailyComponentCategoryResult ? ["daily_component_categories_v1" as const] : []),
        ...(timeBucketGridResult ? ["time_bucket_grid_v1" as const] : []),
        ...(componentHourlyProfilesResult ? ["component_hourly_profiles_v1" as const] : []),
        ...(peakBreakdownResult ? ["peak_breakdown_v1" as const] : []),
        "meter_breakdown_v1",
        "previous_meter_usage_v1",
        "operational_policy_scope_intervals_v1",
        ...(operationalMeterIntervalResult
          ? ["operational_policy_meter_intervals_v1" as const]
          : []),
        ...(leafMeterScope ? ["latest_accepted_reading_v1" as const] : []),
        ...(dailyUsageAnomalyLoad.status === "loaded" ? ["time_slot_anomaly_v1" as const] : []),
      ]
    }
  };
  });
};

export const executeEnergyScopeAnalysisWithLatestAvailable = async (
  input: Parameters<typeof executeEnergyScopeAnalysis>[0],
): Promise<EnergyScopeAnalysis> => {
  const analysis = await executeEnergyScopeAnalysis(input);
  if (analysis.summary.validIntervalCount > 0) return analysis;
  const latestAvailablePeriod = await resolveEnergyLatestAvailablePeriod(input);
  return latestAvailablePeriod ? { ...analysis, latestAvailablePeriod } : analysis;
};

const prepareDailyUsageAnomaly = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  projectReleaseId?: string;
  ruleRevisions: readonly EnergyIqRuleRevisionRecord[];
}): DailyUsageAnomalyPreparation => {
  const matchingRules = input.ruleRevisions.filter(
    (rule) => rule.revision_id === DAILY_USAGE_ANOMALY_RULE_REVISION_ID
      || rule.evaluation_key === "DAILY_USAGE_ABOVE_BASELINE",
  );
  if (matchingRules.length === 0) return { status: "absent" };
  const ruleRevision = matchingRules[0]!;
  if (matchingRules.length !== 1) {
    return dailyUsageAnomalyRuleUnavailable(
      ruleRevision.revision_id,
      "Daily usage anomaly evaluation requires exactly one pinned Rule Revision.",
    );
  }
  const rule = parseDailyUsageAnomalyRule(ruleRevision);
  if (!rule) {
    return dailyUsageAnomalyRuleUnavailable(
      ruleRevision.revision_id,
      "The pinned daily usage anomaly Rule Revision has invalid parameters.",
    );
  }
  const projectReleaseId = input.projectReleaseId?.trim();
  if (!projectReleaseId) {
    return dailyUsageAnomalyRuleUnavailable(
      ruleRevision.revision_id,
      "A pinned Project Release is required for daily usage anomaly evidence.",
    );
  }
  const calendarVersion = input.context.businessCalendarVersion.trim();
  if (!calendarVersion) {
    return {
      status: "unavailable",
      bundle: {
        status: "unavailable",
        ruleRevisionId: ruleRevision.revision_id,
        reason: {
          code: "BUSINESS_CALENDAR_VERSION_MISSING",
          message: "A release-pinned Business Calendar is required for daily usage anomalies.",
        },
      },
    };
  }
  const calendar = input.metadataStore.energyIq.operationalPolicy
    .listOperatingCalendars(input.context.projectId)
    .find((candidate) => candidate.version_id === calendarVersion);
  if (!calendar) {
    return {
      status: "unavailable",
      bundle: {
        status: "unavailable",
        ruleRevisionId: ruleRevision.revision_id,
        reason: {
          code: "BUSINESS_CALENDAR_VERSION_NOT_FOUND",
          message: `Business Calendar ${calendarVersion} is not published for this Project.`,
        },
      },
    };
  }
  const baselineCutoff = formatLocalDate(input.context.from, input.context.timezone);
  return {
    status: "ready",
    projectReleaseId,
    businessCalendarVersion: calendarVersion,
    ruleRevision,
    rule,
    historicalFrom: zonedStartOfLocalDay(
      shiftLocalDate(baselineCutoff, -rule.maximumLookbackDays),
      input.context.timezone,
    ),
  };
};

const loadDailyUsageAnomalyFacts = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  dailyTotalScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  preparation: DailyUsageAnomalyPreparation;
  historicalScoped?: EnergyScopedDataSource;
}): Promise<DailyUsageAnomalyLoadResult> => {
  if (input.preparation.status !== "ready") return input.preparation;
  const {
    businessCalendarVersion: calendarVersion,
    historicalFrom,
    projectReleaseId,
    rule,
    ruleRevision,
  } = input.preparation;
  const series = buildDailyUsageAnomalySeries({
    dailyTotalScopes: input.dailyTotalScopes,
    hierarchy: input.hierarchy,
    meterAggregates: input.meterAggregates,
  });
  if (series.length === 0) return { status: "absent" };
  const exceptionDatesByScopeId = new Map<string, Set<string>>();
  for (const scopeId of series
    .filter((definition) => definition.kind === "official_scope")
    .map((definition) => definition.scopeId)) {
    const operationalPolicy = input.metadataStore.energyIq.operationalPolicy as typeof input.metadataStore.energyIq.operationalPolicy & {
      resolveOperatingCalendarExceptionDates(request: {
        project_id: string;
        scope_id: string;
        version_id: string;
        period: { from: string; to: string };
      }): { exception_dates: string[] } | undefined;
    };
    const resolved = operationalPolicy.resolveOperatingCalendarExceptionDates({
        project_id: input.context.projectId,
        scope_id: scopeId,
        version_id: calendarVersion,
        period: { from: historicalFrom, to: input.context.to },
      });
    if (!resolved) {
      return {
        status: "unavailable",
        bundle: {
          status: "unavailable",
          ruleRevisionId: ruleRevision.revision_id,
          reason: {
            code: "BUSINESS_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD",
            message: `Business Calendar ${calendarVersion} does not cover the anomaly period for Scope ${scopeId}.`,
          },
        },
      };
    }
    exceptionDatesByScopeId.set(scopeId, new Set(resolved.exception_dates));
  }
  const historicalScoped = input.historicalScoped;
  if (!historicalScoped) {
    return dailyUsageAnomalyFactsUnavailable(
      ruleRevision.revision_id,
      "The optional daily usage anomaly fact scope was unavailable.",
    );
  }
  let result: Awaited<ReturnType<LocalDataGateway["runSqlReadonly"]>>;
  try {
    result = await input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: historicalScoped.datasourceId,
      sql: dailyUsageAnomalySql(historicalScoped.viewName, series),
      limit: Math.max(1, series.length),
    });
  } catch {
    return dailyUsageAnomalyFactsUnavailable(
      ruleRevision.revision_id,
      "The optional daily usage anomaly fact query did not complete.",
    );
  }
  return {
    status: "loaded",
    projectReleaseId,
    businessCalendarVersion: calendarVersion,
    ruleRevisionId: ruleRevision.revision_id,
    rule,
    exceptionDatesByScopeId,
    series,
    rows: result.rows,
  };
};

const dailyUsageAnomalyRuleUnavailable = (
  ruleRevisionId: string,
  message: string,
): Extract<DailyUsageAnomalyLoadResult, { status: "unavailable" }> => ({
  status: "unavailable",
  bundle: {
    status: "unavailable",
    ruleRevisionId,
    reason: { code: "DAILY_USAGE_ANOMALY_RULE_INVALID", message },
  },
});

const dailyUsageAnomalyFactsUnavailable = (
  ruleRevisionId: string,
  message: string,
): Extract<DailyUsageAnomalyLoadResult, { status: "unavailable" }> => ({
  status: "unavailable",
  bundle: {
    status: "unavailable",
    ruleRevisionId,
    reason: { code: "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE", message },
  },
});

const MAX_DESCENDANT_METER_TRENDS = 40;
const DAILY_USAGE_ANOMALY_RULE_REVISION_ID = "comparison.daily_usage_above_baseline@1" as const;
const DAILY_USAGE_ANOMALY_METRIC_ID = "energy.total_usage_kwh@1" as const;
const DAILY_USAGE_ANOMALY_PARAMETER_KEYS = [
  "absolute_impact_kwh",
  "baseline_method",
  "direction",
  "maximum_lookback_days",
  "maximum_quality_event_count",
  "minimum_coverage_pct",
  "minimum_sample_count",
  "relative_threshold_pct",
] as const;

const parseDailyUsageAnomalyRule = (
  revision: EnergyIqRuleRevisionRecord,
): DailyUsageAnomalyRule | null => {
  const numberParameter = (key: string): number | null => {
    const value = revision.parameters[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const relativeThresholdPct = numberParameter("relative_threshold_pct");
  const absoluteImpactKwh = numberParameter("absolute_impact_kwh");
  const minimumCoveragePct = numberParameter("minimum_coverage_pct");
  const minimumSampleCount = numberParameter("minimum_sample_count");
  const maximumQualityEventCount = numberParameter("maximum_quality_event_count");
  const maximumLookbackDays = numberParameter("maximum_lookback_days");
  if (revision.revision_id !== DAILY_USAGE_ANOMALY_RULE_REVISION_ID
    || revision.rule_id !== "comparison.daily_usage_above_baseline"
    || revision.version !== 1
    || revision.evaluation_key !== "DAILY_USAGE_ABOVE_BASELINE"
    || revision.requirement !== "historical_baseline"
    || revision.metric_revision_ids.length !== 1
    || revision.metric_revision_ids[0] !== DAILY_USAGE_ANOMALY_METRIC_ID
    || Object.keys(revision.parameters).sort().join(",")
      !== [...DAILY_USAGE_ANOMALY_PARAMETER_KEYS].sort().join(",")
    || relativeThresholdPct !== 20
    || absoluteImpactKwh !== 20
    || minimumCoveragePct !== 95
    || minimumSampleCount !== 4
    || maximumQualityEventCount !== 0
    || maximumLookbackDays !== 60
    || revision.parameters.direction !== "above"
    || revision.parameters.baseline_method !== "mean_of_complete_comparable_days_by_local_hour") {
    return null;
  }
  return {
    relativeThresholdPct,
    absoluteImpactKwh,
    minimumCoveragePct,
    minimumSampleCount,
    maximumQualityEventCount,
    maximumLookbackDays,
    direction: "above",
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
  };
};

const buildDailyUsageAnomalySeries = (input: {
  dailyTotalScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
}): DailyUsageAnomalySeriesDefinition[] => {
  const hierarchyById = new Map(input.hierarchy.map((node) => [node.id, node]));
  const levelScopeIds = new Set(
    input.dailyTotalScopes
      .filter((scope) => scope.scopeType === "level")
      .map((scope) => scope.scopeId),
  );
  const officialMeterNodeIds = new Set(
    input.dailyTotalScopes.flatMap((scope) => scope.meterNodeIds),
  );
  const official = input.dailyTotalScopes
    .filter((scope) => scope.scopeType === "project" || scope.scopeType === "level")
    .sort((left, right) => {
      if (left.scopeId === right.scopeId) return 0;
      if (left.scopeId === input.dailyTotalScopes[0]?.scopeId) return -1;
      if (right.scopeId === input.dailyTotalScopes[0]?.scopeId) return 1;
      return (hierarchyById.get(left.scopeId)?.sort_order ?? 0)
        - (hierarchyById.get(right.scopeId)?.sort_order ?? 0)
        || left.scopeId.localeCompare(right.scopeId);
    })
    .map((scope): DailyUsageAnomalySeriesDefinition => ({
      seriesOrder: 0,
      seriesId: `scope:${scope.scopeId}`,
      kind: "official_scope",
      ownerScopeId: scope.scopeId,
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      meterNodeIds: scope.meterNodeIds,
      includedInOfficialTotal: true,
    }));
  const components = input.meterAggregates
    .filter((meter) => {
      const parentScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
      return !officialMeterNodeIds.has(meter.meterNodeId)
        && parentScopeId !== undefined
        && levelScopeIds.has(parentScopeId);
    })
    .sort((left, right) => {
      const leftNode = hierarchyById.get(left.scopeId);
      const rightNode = hierarchyById.get(right.scopeId);
      const leftParent = leftNode?.parent_id ? hierarchyById.get(leftNode.parent_id) : undefined;
      const rightParent = rightNode?.parent_id ? hierarchyById.get(rightNode.parent_id) : undefined;
      return (leftParent?.sort_order ?? 0) - (rightParent?.sort_order ?? 0)
        || (leftNode?.sort_order ?? 0) - (rightNode?.sort_order ?? 0)
        || left.meterNodeId.localeCompare(right.meterNodeId);
    })
    .map((meter): DailyUsageAnomalySeriesDefinition => {
      const parentScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
      if (!parentScopeId) throw new Error(`ENERGYIQ_ANOMALY_COMPONENT_PARENT_MISSING:${meter.scopeId}`);
      return {
        seriesOrder: 0,
        seriesId: `meter:${meter.meterNodeId}`,
        kind: "component_circuit",
        ownerScopeId: parentScopeId,
        scopeId: meter.scopeId,
        scopeName: meter.name,
        scopeType: "circuit",
        meterNodeIds: [meter.meterNodeId],
        meterNodeId: meter.meterNodeId,
        category: meter.category,
        includedInOfficialTotal: false,
      };
    });
  return official.flatMap((scope) => [
    scope,
    ...components.filter((component) => component.ownerScopeId === scope.scopeId),
  ]).map((series, seriesOrder) => ({ ...series, seriesOrder }));
};

const buildDailyUsageAnomalies = (input: {
  load: DailyUsageAnomalyLoadResult;
  context: EnergyQueryContext;
  dateBuckets: DailyDateBucket[];
  intervalMinutes: number;
}): EnergyDailyUsageAnomalies | undefined => {
  if (input.load.status === "absent") return undefined;
  if (input.load.status === "unavailable") return input.load.bundle;
  const load = input.load;
  let factsBySeriesId: Map<string, DailyUsageAnomalyHourFact[]>;
  try {
    factsBySeriesId = new Map(load.rows.map((row) => [
      stringAt(row, 0),
      parseDailyUsageAnomalyFacts(stringAt(row, 1)),
    ]));
  } catch {
    return dailyUsageAnomalyFactsUnavailable(
      load.ruleRevisionId,
      "The optional daily usage anomaly facts were unavailable or invalid.",
    ).bundle;
  }
  const daysBySeriesId = new Map<string, Map<string, DailyUsageAnomalyDayFact>>(
    load.series.map((series) => [
    series.seriesId,
    buildDailyUsageAnomalyDays({
      facts: factsBySeriesId.get(series.seriesId) ?? [],
      meterCount: series.meterNodeIds.length,
      intervalMinutes: input.intervalMinutes,
    }),
    ]),
  );
  const baselineCutoff = formatLocalDate(input.context.from, input.context.timezone);
  const earliestBaselineDate = shiftLocalDate(
    baselineCutoff,
    -load.rule.maximumLookbackDays,
  );
  const officialSeries = load.series.filter((series) => series.kind === "official_scope");
  return {
    status: "available",
    bundleId: [
      "daily-usage-anomalies",
      input.context.dataSnapshotId,
      load.projectReleaseId,
      load.businessCalendarVersion,
      input.context.scopeId,
      input.context.from,
      input.context.to,
      load.ruleRevisionId,
    ].join(":"),
    metricId: "energy.total_usage_kwh@1",
    queryId: "time_slot_anomaly_v1",
    ruleRevisionId: load.ruleRevisionId,
    timezone: input.context.timezone,
    baselineCutoff,
    rule: load.rule,
    evidencePins: {
      projectReleaseId: load.projectReleaseId,
      dataSnapshotId: input.context.dataSnapshotId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: input.context.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      metricVersion: input.context.metricVersion,
      businessCalendarVersion: load.businessCalendarVersion,
      queryIds: ["time_slot_anomaly_v1"],
    },
    scopes: officialSeries.map((series) => {
      const days = daysBySeriesId.get(series.seriesId)
        ?? new Map<string, DailyUsageAnomalyDayFact>();
      const baselineDatesByDayType = new Map<"weekday" | "weekend", string[]>(
        (["weekday", "weekend"] as const).map((dayType) => [
          dayType,
          [...days.values()]
            .filter((day) => day.localDate >= earliestBaselineDate
              && day.localDate < baselineCutoff
              && day.dayType === dayType
              && !(load.exceptionDatesByScopeId.get(series.scopeId)
                ?? new Set<string>()).has(day.localDate)
              && day.validIntervalCount === day.expectedMeterIntervalCount
              && day.qualityEventCount === 0
              && day.totalKwh !== null
              && day.hours.length === 24
              && day.hours.every((hour) => hour.usageKwh !== null))
            .sort((left, right) => right.localDate.localeCompare(left.localDate))
            .slice(0, load.rule.minimumSampleCount)
            .map((day) => day.localDate)
            .sort((left, right) => left.localeCompare(right)),
        ]),
      );
      return {
        scopeId: series.scopeId,
        scopeName: series.scopeName,
        scopeType: series.scopeType,
        rollingComparisons: [7, 28].map((horizonDays) => buildRollingUsageComparison({
          days,
          cutoffLocalDate: input.dateBuckets.at(-1)?.localDate ?? baselineCutoff,
          horizonDays: horizonDays as 7 | 28,
        })),
        rows: input.dateBuckets.map((bucket) => buildDailyUsageAnomalyRow({
          dateBucket: bucket,
          series,
          allSeries: load.series,
          daysBySeriesId,
          baselineDatesByDayType,
          exceptionDates: load.exceptionDatesByScopeId.get(series.scopeId) ?? new Set(),
          rule: load.rule,
          ruleRevisionId: load.ruleRevisionId,
          projectReleaseId: load.projectReleaseId,
          businessCalendarVersion: load.businessCalendarVersion,
          context: input.context,
        })),
      };
    }),
  };
};

const buildRollingUsageComparison = (input: {
  days: Map<string, DailyUsageAnomalyDayFact>;
  cutoffLocalDate: string;
  horizonDays: 7 | 28;
}): EnergyRollingUsageComparison => {
  const current = summarizeRollingUsageWindow(
    input.days,
    shiftLocalDate(input.cutoffLocalDate, -(input.horizonDays - 1)),
    input.cutoffLocalDate,
  );
  const baseline = summarizeRollingUsageWindow(
    input.days,
    shiftLocalDate(current.fromLocalDate, -input.horizonDays),
    shiftLocalDate(current.toLocalDate, -input.horizonDays),
  );
  const common = {
    horizon: `rolling_${input.horizonDays}d` as "rolling_7d" | "rolling_28d",
    cutoffLocalDate: input.cutoffLocalDate,
    current,
    baseline,
  };
  if (current.completeDayCount !== input.horizonDays
    || baseline.completeDayCount !== input.horizonDays
    || current.totalKwh === null
    || baseline.totalKwh === null) {
    return {
      ...common,
      status: "unavailable",
      reason: {
        code: "INCOMPLETE_HORIZON_EVIDENCE",
        message: `${input.horizonDays} complete current days and ${input.horizonDays} complete prior days are required.`,
      },
    };
  }
  if (baseline.totalKwh <= 0) {
    return {
      ...common,
      status: "unavailable",
      reason: {
        code: "NON_POSITIVE_HORIZON_BASELINE",
        message: `The prior ${input.horizonDays}-day total must be positive.`,
      },
    };
  }
  const deltaKwh = current.totalKwh - baseline.totalKwh;
  return {
    ...common,
    status: "available",
    deltaKwh: round(deltaKwh, 4),
    relativePct: round(deltaKwh / baseline.totalKwh * 100, 4),
  };
};

const summarizeRollingUsageWindow = (
  days: Map<string, DailyUsageAnomalyDayFact>,
  fromLocalDate: string,
  toLocalDate: string,
): EnergyRollingUsageComparison["current"] => {
  const windowDays: DailyUsageAnomalyDayFact[] = [];
  for (let localDate = fromLocalDate; localDate <= toLocalDate; localDate = shiftLocalDate(localDate, 1)) {
    const day = days.get(localDate);
    if (day
      && day.totalKwh !== null
      && day.expectedMeterIntervalCount > 0
      && day.validIntervalCount === day.expectedMeterIntervalCount
      && day.qualityEventCount === 0) {
      windowDays.push(day);
    }
  }
  const expectedDayCount = localDateDistanceInclusive(fromLocalDate, toLocalDate);
  return {
    fromLocalDate,
    toLocalDate,
    totalKwh: windowDays.length === expectedDayCount
      ? round(windowDays.reduce((sum, day) => sum + (day.totalKwh ?? 0), 0), 4)
      : null,
    completeDayCount: windowDays.length,
  };
};

const localDateDistanceInclusive = (fromLocalDate: string, toLocalDate: string): number => (
  Math.round((Date.parse(`${toLocalDate}T00:00:00.000Z`) - Date.parse(`${fromLocalDate}T00:00:00.000Z`)) / 86_400_000) + 1
);

const buildDailyUsageAnomalyRow = (input: {
  dateBucket: DailyDateBucket;
  series: DailyUsageAnomalySeriesDefinition;
  allSeries: DailyUsageAnomalySeriesDefinition[];
  daysBySeriesId: Map<string, Map<string, DailyUsageAnomalyDayFact>>;
  baselineDatesByDayType: Map<"weekday" | "weekend", string[]>;
  exceptionDates: Set<string>;
  rule: DailyUsageAnomalyRule;
  ruleRevisionId: string;
  projectReleaseId: string;
  businessCalendarVersion: string;
  context: EnergyQueryContext;
}): Extract<EnergyDailyUsageAnomalies, { status: "available" }>["scopes"][number]["rows"][number] => {
  const days = input.daysBySeriesId.get(input.series.seriesId)
    ?? new Map<string, DailyUsageAnomalyDayFact>();
  const selectedDay = days.get(input.dateBucket.localDate)
    ?? emptyDailyUsageAnomalyDay(input.dateBucket.localDate);
  const baselineDates = selectedDay.dayType
    ? input.baselineDatesByDayType.get(selectedDay.dayType) ?? []
    : [];
  const baselineHours = meanDailyUsageAnomalyHours(days, baselineDates);
  const baselineKwh = baselineHours.every((value) => value !== null)
    ? baselineHours.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const actualKwh = selectedDay.totalKwh;
  const impactKwh = actualKwh !== null && baselineKwh !== null
    ? actualKwh - baselineKwh
    : null;
  const relativePct = impactKwh !== null && baselineKwh !== null && baselineKwh > 0
    ? impactKwh / baselineKwh * 100
    : null;
  const suppressionReason = dailyUsageAnomalySuppressionReason({
    localDate: input.dateBucket.localDate,
    selectedDay,
    baselineDates,
    baselineKwh,
    exceptionDates: input.exceptionDates,
    rule: input.rule,
  });
  const outcome = suppressionReason
    ? "suppressed" as const
    : impactKwh !== null
      && relativePct !== null
      && actualKwh !== null
      && baselineKwh !== null
      && actualKwh > baselineKwh
      && impactKwh >= input.rule.absoluteImpactKwh
      && relativePct >= input.rule.relativeThresholdPct
      ? "triggered" as const
      : "within_threshold" as const;
  return {
    anomalyId: [
      "daily-usage-above-baseline",
      input.series.scopeId,
      input.dateBucket.localDate,
    ].join(":"),
    incidentId: [
      "daily-usage-above-baseline",
      input.context.dataSnapshotId,
      input.projectReleaseId,
      input.businessCalendarVersion,
      input.ruleRevisionId,
      input.series.scopeId,
      formatLocalDate(input.context.from, input.context.timezone),
      input.dateBucket.localDate,
    ].join(":"),
    ruleRevisionId: input.ruleRevisionId,
    metricId: "energy.total_usage_kwh@1",
    queryId: "time_slot_anomaly_v1",
    localDate: input.dateBucket.localDate,
    from: input.dateBucket.from,
    to: input.dateBucket.to,
    dayType: selectedDay.dayType,
    baselineDates,
    baselineSampleCount: baselineDates.length,
    baselineSamples: baselineDates.map((localDate) => {
      const sample = days.get(localDate) ?? emptyDailyUsageAnomalyDay(localDate);
      return {
        localDate,
        coveragePct: round(sample.coveragePct, 4),
        expectedMeterIntervalCount: sample.expectedMeterIntervalCount,
        validIntervalCount: sample.validIntervalCount,
        qualityEventCount: sample.qualityEventCount,
        eligible: true as const,
      };
    }),
    actualKwh: nullableRound(actualKwh),
    baselineKwh: nullableRound(baselineKwh),
    impactKwh: nullableRound(impactKwh),
    relativePct: nullableRound(relativePct),
    thresholds: {
      relativeThresholdPct: input.rule.relativeThresholdPct,
      absoluteImpactKwh: input.rule.absoluteImpactKwh,
      minimumCoveragePct: input.rule.minimumCoveragePct,
      maximumQualityEventCount: input.rule.maximumQualityEventCount,
    },
    coveragePct: round(selectedDay.coveragePct, 4),
    expectedMeterIntervalCount: selectedDay.expectedMeterIntervalCount,
    validIntervalCount: selectedDay.validIntervalCount,
    qualityEventCount: selectedDay.qualityEventCount,
    outcome,
    ...(suppressionReason ? { suppressionReason } : {}),
    hourlyComparison: Array.from({ length: 24 }, (_, localHour) => {
      const actual = selectedDay.hours[localHour]?.usageKwh ?? null;
      const baseline = baselineHours[localHour] ?? null;
      const impact = actual !== null && baseline !== null ? actual - baseline : null;
      return {
        localHour,
        actualKwh: nullableRound(actual),
        baselineKwh: nullableRound(baseline),
        impactKwh: nullableRound(impact),
        relativePct: impact !== null && baseline !== null && baseline > 0
          ? round(impact / baseline * 100, 4)
          : null,
      };
    }),
    detailSeries: input.allSeries
      .filter((series) => input.series.scopeType === "project"
        || series.ownerScopeId === input.series.scopeId)
      .map((series) => buildDailyUsageAnomalyDetailSeries({
        series,
        selectedScopeId: input.series.scopeId,
        localDate: input.dateBucket.localDate,
        baselineDates,
        days: input.daysBySeriesId.get(series.seriesId) ?? new Map(),
        rule: input.rule,
      })),
  };
};

const dailyUsageAnomalySuppressionReason = (input: {
  localDate: string;
  selectedDay: DailyUsageAnomalyDayFact;
  baselineDates: string[];
  baselineKwh: number | null;
  exceptionDates: Set<string>;
  rule: DailyUsageAnomalyRule;
}): { code: DailyUsageAnomalySuppressionCode; message: string } | undefined => {
  if (input.exceptionDates.has(input.localDate)) {
    return {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The release-pinned Business Calendar marks this local date as an exception.",
    };
  }
  if (input.selectedDay.validIntervalCount === 0 || input.selectedDay.totalKwh === null) {
    return {
      code: "DAILY_FACTS_UNAVAILABLE",
      message: "Accepted interval facts are unavailable for this local date.",
    };
  }
  if (input.selectedDay.dayType === null) {
    return {
      code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
      message: "Accepted facts do not provide one consistent weekday or weekend classification.",
    };
  }
  if (input.selectedDay.coveragePct < input.rule.minimumCoveragePct) {
    return {
      code: "COVERAGE_BELOW_THRESHOLD",
      message: `Daily coverage is below ${input.rule.minimumCoveragePct}%.`,
    };
  }
  if (input.selectedDay.qualityEventCount > input.rule.maximumQualityEventCount) {
    return {
      code: "QUALITY_EVENT_PRESENT",
      message: "Daily quality events exceed the pinned Rule threshold.",
    };
  }
  if (input.baselineDates.length < input.rule.minimumSampleCount) {
    return {
      code: "BASELINE_SAMPLE_COUNT_INSUFFICIENT",
      message: `Fewer than ${input.rule.minimumSampleCount} complete comparable dates are available.`,
    };
  }
  if (input.baselineKwh === null || input.baselineKwh <= 0) {
    return {
      code: "BASELINE_VALUE_UNAVAILABLE",
      message: "The frozen hourly baseline is unavailable or non-positive.",
    };
  }
  return undefined;
};

const buildDailyUsageAnomalyDetailSeries = (input: {
  series: DailyUsageAnomalySeriesDefinition;
  selectedScopeId: string;
  localDate: string;
  baselineDates: string[];
  days: Map<string, DailyUsageAnomalyDayFact>;
  rule: DailyUsageAnomalyRule;
}): Extract<EnergyDailyUsageAnomalies, { status: "available" }>["scopes"][number]["rows"][number]["detailSeries"][number] => {
  const selectedDay = input.days.get(input.localDate) ?? emptyDailyUsageAnomalyDay(input.localDate);
  const baselineHours = meanDailyUsageAnomalyHours(input.days, input.baselineDates);
  const baselineTotal = baselineHours.every((value) => value !== null)
    ? baselineHours.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const selectedTotal = selectedDay.totalKwh;
  const impact = selectedTotal !== null && baselineTotal !== null
    ? selectedTotal - baselineTotal
    : null;
  const relativePct = impact !== null && baselineTotal !== null && baselineTotal > 0
    ? impact / baselineTotal * 100
    : null;
  const selectedHoursAvailable = selectedDay.hours.every((hour) => hour.usageKwh !== null);
  const baselineAvailable = input.baselineDates.length === input.rule.minimumSampleCount
    && baselineHours.every((value) => value !== null);
  const status = selectedDay.validIntervalCount === 0
    ? "unavailable" as const
    : selectedHoursAvailable
      && baselineAvailable
      && selectedDay.coveragePct >= input.rule.minimumCoveragePct
      && selectedDay.qualityEventCount <= input.rule.maximumQualityEventCount
      ? "available" as const
      : "partial" as const;
  return {
    seriesId: input.series.seriesId,
    relationship: input.series.kind === "component_circuit"
      ? "component_circuit"
      : input.series.scopeId === input.selectedScopeId
        ? "selected_scope"
        : "immediate_level",
    kind: input.series.kind,
    scopeId: input.series.scopeId,
    scopeName: input.series.scopeName,
    ...(input.series.meterNodeId ? { meterNodeId: input.series.meterNodeId } : {}),
    ...(input.series.category ? { category: input.series.category } : {}),
    includedInOfficialTotal: input.series.includedInOfficialTotal,
    status,
    selectedTotalKwh: nullableRound(selectedTotal),
    baselineTotalKwh: nullableRound(baselineTotal),
    impactKwh: nullableRound(impact),
    relativePct: nullableRound(relativePct),
    coveragePct: round(selectedDay.coveragePct, 4),
    expectedMeterIntervalCount: selectedDay.expectedMeterIntervalCount,
    validIntervalCount: selectedDay.validIntervalCount,
    qualityEventCount: selectedDay.qualityEventCount,
    points: Array.from({ length: 24 }, (_, localHour) => {
      const selectedKwh = selectedDay.hours[localHour]?.usageKwh ?? null;
      const baselineKwh = baselineHours[localHour] ?? null;
      return {
        localHour,
        selectedKwh: nullableRound(selectedKwh),
        baselineKwh: nullableRound(baselineKwh),
        impactKwh: selectedKwh !== null && baselineKwh !== null
          ? round(selectedKwh - baselineKwh, 4)
          : null,
      };
    }),
  };
};

const buildDailyUsageAnomalyDays = (input: {
  facts: DailyUsageAnomalyHourFact[];
  meterCount: number;
  intervalMinutes: number;
}): Map<string, DailyUsageAnomalyDayFact> => {
  const factsByDate = new Map<string, DailyUsageAnomalyHourFact[]>();
  for (const fact of input.facts) {
    factsByDate.set(fact.localDate, [...(factsByDate.get(fact.localDate) ?? []), fact]);
  }
  return new Map([...factsByDate.entries()].map(([localDate, facts]) => {
    const factByHour = new Map(facts.map((fact) => [fact.localHour, fact]));
    const hours = Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      usageKwh: factByHour.get(localHour)?.usageKwh ?? null,
    }));
    const validIntervalCount = facts.reduce((sum, fact) => sum + fact.validIntervalCount, 0);
    const qualityEventCount = facts.reduce((sum, fact) => sum + fact.qualityEventCount, 0);
    const expectedMeterIntervalCount = input.meterCount * Math.round(24 * 60 / input.intervalMinutes);
    const classifiedFacts = facts.filter((fact) => fact.validIntervalCount > 0);
    const classifiedDayTypes = new Set(classifiedFacts.map((fact) => fact.dayType));
    const dayType = classifiedFacts.length > 0
      && classifiedFacts.every((fact) => fact.dayTypeCount === 1)
      && classifiedFacts.every((fact) => fact.dayTypeNullCount === 0)
      && classifiedDayTypes.size === 1
      && (classifiedFacts[0]?.dayType === "weekday" || classifiedFacts[0]?.dayType === "weekend")
      ? classifiedFacts[0].dayType
      : null;
    return [localDate, {
      localDate,
      dayType,
      coveragePct: expectedMeterIntervalCount > 0
        ? Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100
        : 0,
      validIntervalCount,
      expectedMeterIntervalCount,
      qualityEventCount,
      hours,
      totalKwh: validIntervalCount > 0
        ? hours.reduce((sum, hour) => sum + (hour.usageKwh ?? 0), 0)
        : null,
    }];
  }));
};

const emptyDailyUsageAnomalyDay = (localDate: string): DailyUsageAnomalyDayFact => ({
  localDate,
  dayType: null,
  coveragePct: 0,
  validIntervalCount: 0,
  expectedMeterIntervalCount: 0,
  qualityEventCount: 0,
  hours: Array.from({ length: 24 }, (_, localHour) => ({ localHour, usageKwh: null })),
  totalKwh: null,
});

const meanDailyUsageAnomalyHours = (
  days: Map<string, DailyUsageAnomalyDayFact>,
  baselineDates: string[],
): Array<number | null> => Array.from({ length: 24 }, (_, localHour) => {
  const values = baselineDates.map(
    (localDate) => days.get(localDate)?.hours[localHour]?.usageKwh ?? null,
  );
  return values.length === 0 || values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length;
});

const parseDailyUsageAnomalyFacts = (value: string): DailyUsageAnomalyHourFact[] => {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_FACTS_INVALID");
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`ENERGYIQ_DAILY_USAGE_ANOMALY_FACT_INVALID:${index}`);
    }
    const localHour = Number(item.local_hour);
    if (typeof item.local_date !== "string"
      || !Number.isSafeInteger(localHour)
      || localHour < 0
      || localHour > 23) {
      throw new Error(`ENERGYIQ_DAILY_USAGE_ANOMALY_FACT_INVALID:${index}`);
    }
    return {
      localDate: item.local_date,
      localHour,
      usageKwh: item.usage_kwh === null || item.usage_kwh === undefined
        ? null
        : finiteNumber(item.usage_kwh, `ENERGYIQ_DAILY_USAGE_ANOMALY_USAGE_INVALID:${index}`),
      validIntervalCount: finiteNumber(
        item.valid_interval_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_VALID_COUNT_INVALID:${index}`,
      ),
      qualityEventCount: finiteNumber(
        item.quality_event_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_QUALITY_COUNT_INVALID:${index}`,
      ),
      dayType: typeof item.day_type === "string" ? item.day_type : null,
      dayTypeCount: finiteNumber(
        item.day_type_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_DAY_TYPE_COUNT_INVALID:${index}`,
      ),
      dayTypeNullCount: finiteNumber(
        item.day_type_null_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_DAY_TYPE_NULL_COUNT_INVALID:${index}`,
      ),
    };
  });
};

const nullableRound = (value: number | null): number | null => value === null
  ? null
  : round(value, 4);

const finiteNumber = (value: unknown, errorCode: string): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(errorCode);
  return number;
};

const calendarDayCount = (from: string, to: string): number =>
  Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

const evaluateReleasePinnedOperationalPolicy = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  scopeId: string;
  intervals: EnergyIqAnalysisInterval[];
}) => input.metadataStore.energyIq.operationalPolicy.evaluateAnalysisPolicy({
  project_id: input.context.projectId,
  scope_id: input.scopeId,
  period: {
    from: input.context.from,
    to: input.context.to,
  },
  intervals: input.intervals,
  policy_source: {
    mode: "release-pinned",
    tariff_schedule_version: input.context.tariffScheduleVersion,
    business_calendar_version: input.context.businessCalendarVersion,
  },
});

const mapTariffEvaluation = (
  evaluation: EnergyIqTariffEvaluation,
): EnergyScopeAnalysis["cost"] => evaluation.status === "available"
  ? {
      status: "available",
      amount: evaluation.total_cost,
      currency: evaluation.currency,
      tariffScheduleVersion: evaluation.tariff_schedule_version,
      allocations: evaluation.allocations.map((allocation) => ({
        from: allocation.from,
        to: allocation.to,
        ratePerKwh: allocation.rate_per_kwh,
        ...(allocation.rate_basis ? { rateBasis: allocation.rate_basis } : {}),
        ...(allocation.tax ? {
          tax: { name: allocation.tax.name, ratePct: allocation.tax.rate_pct },
        } : {}),
        ...(allocation.tax_inclusive_rate_per_kwh === undefined
          ? {}
          : { taxInclusiveRatePerKwh: allocation.tax_inclusive_rate_per_kwh }),
        ...(allocation.tax_exclusive_rate_per_kwh === undefined
          ? {}
          : { taxExclusiveRatePerKwh: allocation.tax_exclusive_rate_per_kwh }),
        usageKwh: allocation.usage_kwh,
        cost: allocation.cost,
      })),
    }
  : {
      status: "unavailable",
      reason: evaluation.reason,
      ...(evaluation.tariff_schedule_version
        ? { tariffScheduleVersion: evaluation.tariff_schedule_version }
        : {}),
    };

const mapOperatingEvaluation = (
  evaluation: EnergyIqOperatingEvaluation,
  usageKwh: number,
): EnergyScopeAnalysis["offHours"] => evaluation.status === "available"
  ? {
      status: "available",
      operatingKwh: evaluation.operating_kwh,
      standbyKwh: evaluation.standby_kwh,
      usageKwh: evaluation.standby_kwh,
      sharePct: percent(evaluation.standby_kwh, usageKwh),
      timezone: evaluation.timezone,
      businessCalendarVersion: evaluation.business_calendar_version,
    }
  : {
      status: "unavailable",
      reason: evaluation.reason,
      ...(evaluation.business_calendar_version
        ? { businessCalendarVersion: evaluation.business_calendar_version }
        : {}),
    };

const buildChildScopes = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  resource: "electricity" | "water";
  scopeNodeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  previousMeterUsageById: ReadonlyMap<string, number>;
  scopeUsageKwh: number;
  periodDurationMs: number;
  intervalMinutes: number;
}): EnergyScopeAnalysis["childScopes"] => {
  const children = input.hierarchy.filter((node) => node.parent_id === input.scopeNodeId);
  return children.map((child) => {
    const descendantIds = collectDescendantIds(child.id, input.hierarchy);
    descendantIds.add(child.id);
    const meters = input.meterAggregates.filter((meter) => descendantIds.has(meter.scopeId));
    const publishedRoute = resolveEnergyPublishedMeterRoute({
      metadataStore: input.metadataStore,
      projectId: input.projectId,
      hierarchyRevisionId: input.hierarchyRevisionId,
      scopeId: child.id,
      resource: input.resource,
      expectedMeterMappingRevisionId: input.meterMappingRevisionId
    });
    const officialIds = publishedRoute.officialMeterPointIds
      ? new Set(publishedRoute.officialMeterPointIds)
      : undefined;
    const aggregateMeters = officialIds
      ? meters.filter((meter) => officialIds.has(meter.meterNodeId))
      : [];
    const usageKwh = aggregateMeters.reduce((sum, meter) => sum + meter.usageKwh, 0);
    const previousUsageKwh = officialIds
      ? [...officialIds]
        .reduce((sum, meterNodeId) => sum + (input.previousMeterUsageById.get(meterNodeId) ?? 0), 0)
      : 0;
    const expectedMeterIntervalCount = (officialIds?.size ?? 0) * Math.round(
      input.periodDurationMs / (input.intervalMinutes * 60_000),
    );
    const validIntervalCount = aggregateMeters.reduce((sum, meter) => sum + meter.validIntervalCount, 0);
    const qualityEventCount = aggregateMeters.reduce((sum, meter) => sum + meter.qualityEventCount, 0);
    const breakdownMeters = meters.filter((meter) => meter.scopeId !== child.id);
    const topCircuit = maxBy(breakdownMeters, (meter) => meter.usageKwh);
    const dimensions = resolveScopeDimensions(child.id, input.hierarchy);
    return {
      nodeId: child.id,
      name: child.name,
      nodeType: child.node_type,
      usageKwh: round(usageKwh, 4),
      sharePct: percent(usageKwh, input.scopeUsageKwh, 4),
      comparison: {
        usageKwh: round(previousUsageKwh, 4),
        changeKwh: round(usageKwh - previousUsageKwh, 4),
        changePct: previousUsageKwh > 0
          ? round(((usageKwh - previousUsageKwh) / previousUsageKwh) * 100, 4)
          : null,
      },
      dataHealth: {
        coveragePct: expectedMeterIntervalCount > 0
          ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
          : 0,
        expectedMeterIntervalCount,
        validIntervalCount,
        qualityEventCount,
      },
      ...(dimensions.areaSqm > 0 ? {
        areaSqm: round(dimensions.areaSqm, 2),
        kwhPerSqm: round(usageKwh / dimensions.areaSqm, 4)
      } : {}),
      ...(dimensions.occupantCount > 0 ? {
        occupantCount: dimensions.occupantCount,
        kwhPerPerson: round(usageKwh / dimensions.occupantCount, 4)
      } : {}),
      ...(topCircuit ? {
        topCircuitName: topCircuit.name,
        topCircuitUsageKwh: round(topCircuit.usageKwh, 4)
      } : {})
    };
  }).sort((left, right) => right.usageKwh - left.usageKwh);
};

const buildDailyTotalsProjection = (input: {
  context: EnergyQueryContext;
  scopes: DailyTotalScope[];
  dateBuckets: DailyDateBucket[];
  rows: unknown[][];
  intervalMinutes: number;
}): NonNullable<EnergyScopeAnalysis["dailyTotals"]> => {
  const factsByScopeAndDate = new Map(
    input.rows.map((row) => [`${stringAt(row, 0)}:${stringAt(row, 3)}`, row]),
  );
  return {
    metricId: "energy.total_usage_kwh@1",
    grain: "day",
    timezone: input.context.timezone,
    scopes: input.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      rows: input.dateBuckets.map((bucket) => {
        const row = factsByScopeAndDate.get(`${scope.scopeId}:${bucket.localDate}`);
        const validIntervalCount = row ? numberAt(row, 5) : 0;
        const qualityEventCount = row ? numberAt(row, 6) : 0;
        const aggregateEligibleIntervalCount = row
          ? numberAt(row, 7) / input.intervalMinutes
          : 0;
        const cadenceGapEventCount = row ? numberAt(row, 8) : 0;
        const aggregateRejectedEventCount = row ? numberAt(row, 9) : 0;
        const expectedMeterIntervalCount = scope.meterNodeIds.length * Math.round(
          (Date.parse(bucket.to) - Date.parse(bucket.from)) / (input.intervalMinutes * 60_000),
        );
        const status = validIntervalCount === 0
          ? "unavailable" as const
          : validIntervalCount === expectedMeterIntervalCount && qualityEventCount === 0
            ? "complete" as const
            : "partial" as const;
        const aggregateStatus = aggregateEligibleIntervalCount === 0
          ? "unavailable" as const
          : aggregateEligibleIntervalCount >= expectedMeterIntervalCount
            && aggregateRejectedEventCount === 0
            ? "complete" as const
            : "partial" as const;
        return {
          localDate: bucket.localDate,
          from: bucket.from,
          to: bucket.to,
          usageKwh: row && row[4] !== null && row[4] !== undefined
            ? round(numberAt(row, 4), 4)
            : null,
          dataHealth: {
            status,
            coveragePct: expectedMeterIntervalCount > 0
              ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
              : 0,
            expectedMeterIntervalCount,
            validIntervalCount,
            qualityEventCount,
            ...(status === "complete" ? {} : {
              aggregateStatus,
              aggregateCoveragePct: expectedMeterIntervalCount > 0
                ? round(Math.min(aggregateEligibleIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
                : 0,
              aggregateEligibleIntervalCount: round(aggregateEligibleIntervalCount, 4),
              cadenceGapEventCount,
            }),
          },
        };
      }),
    })),
  };
};

const resolveDailyTotalScopes = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  resource: "electricity" | "water";
  selectedNode: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>[number];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  aggregateMeterNodeIds: string[];
}): DailyTotalScope[] => {
  const children = input.hierarchy
    .filter((node) => node.parent_id === input.selectedNode.id)
    .map((child) => {
      const publishedRoute = resolveEnergyPublishedMeterRoute({
        metadataStore: input.metadataStore,
        projectId: input.projectId,
        hierarchyRevisionId: input.hierarchyRevisionId,
        scopeId: child.id,
        resource: input.resource,
        expectedMeterMappingRevisionId: input.meterMappingRevisionId,
      });
      const meterNodeIds = publishedRoute.officialMeterPointIds ?? [];
      const officialIds = new Set(meterNodeIds);
      const usageKwh = input.meterAggregates
        .filter((meter) => officialIds.has(meter.meterNodeId))
        .reduce((sum, meter) => sum + meter.usageKwh, 0);
      return {
        scopeId: child.id,
        scopeName: child.name,
        scopeType: child.node_type,
        meterNodeIds,
        usageKwh,
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh)
    .map(({ usageKwh: _usageKwh, ...scope }) => scope);
  return [{
    scopeId: input.selectedNode.id,
    scopeName: input.selectedNode.name,
    scopeType: input.selectedNode.node_type,
    meterNodeIds: input.aggregateMeterNodeIds,
  }, ...children];
};

const buildDailyComponentCategorySeries = (input: {
  dailyTotalScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  componentMeterNodeIds: string[];
}): DailyComponentCategorySeries[] => {
  const eligibleComponentMeterNodeIds = new Set(input.componentMeterNodeIds);
  const availableMeterNodeIds = new Set(input.meterAggregates.map((meter) => meter.meterNodeId));
  if (!input.componentMeterNodeIds.every((meterNodeId) => availableMeterNodeIds.has(meterNodeId))) {
    return [];
  }
  return input.dailyTotalScopes.flatMap((scope, scopeOrder) => {
    const ownedScopeIds = collectDescendantIds(scope.scopeId, input.hierarchy);
    ownedScopeIds.add(scope.scopeId);
    const categories = new Map<string, MeterAggregate[]>();
    for (const meter of input.meterAggregates) {
      if (!eligibleComponentMeterNodeIds.has(meter.meterNodeId) || !ownedScopeIds.has(meter.scopeId)) continue;
      categories.set(meter.category, [...(categories.get(meter.category) ?? []), meter]);
    }
    return [...categories.entries()]
      .sort((left, right) => {
        const leftUsage = left[1].reduce((sum, meter) => sum + meter.usageKwh, 0);
        const rightUsage = right[1].reduce((sum, meter) => sum + meter.usageKwh, 0);
        return rightUsage - leftUsage || left[0].localeCompare(right[0]);
      })
      .map(([category, meters], categoryOrder) => ({
        scopeOrder,
        categoryOrder,
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        scopeType: scope.scopeType,
        category,
        meterNodeIds: meters.map((meter) => meter.meterNodeId).sort(),
      }));
  });
};

const buildComponentHourlyCircuitSeries = (input: {
  dailyTotalScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  componentMeterNodeIds: string[];
}): ComponentHourlyCircuitSeries[] => {
  const eligibleMeterIds = new Set(input.componentMeterNodeIds);
  const availableMeters = input.meterAggregates.filter((meter) => (
    eligibleMeterIds.has(meter.meterNodeId)
  ));
  if (
    eligibleMeterIds.size === 0
    || availableMeters.length !== eligibleMeterIds.size
    || !input.componentMeterNodeIds.every((meterNodeId) => (
      availableMeters.some((meter) => meter.meterNodeId === meterNodeId)
    ))
  ) {
    return [];
  }
  const hierarchyById = new Map(input.hierarchy.map((node) => [node.id, node]));
  const levelOrder = new Map(
    input.dailyTotalScopes
      .filter((scope) => scope.scopeType === "level")
      .map((scope, index) => [scope.scopeId, index]),
  );
  const resolved = availableMeters.flatMap((meter) => {
    const levelScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
    return levelScopeId && levelOrder.has(levelScopeId)
      ? [{ meter, levelScopeId }]
      : [];
  });
  if (resolved.length !== eligibleMeterIds.size) return [];
  return resolved
    .sort((left, right) => (
      (levelOrder.get(left.levelScopeId) ?? Number.MAX_SAFE_INTEGER)
        - (levelOrder.get(right.levelScopeId) ?? Number.MAX_SAFE_INTEGER)
      || right.meter.usageKwh - left.meter.usageKwh
      || left.meter.name.localeCompare(right.meter.name)
      || left.meter.meterNodeId.localeCompare(right.meter.meterNodeId)
    ))
    .map(({ meter, levelScopeId }, seriesOrder) => ({
      seriesOrder,
      meterNodeId: meter.meterNodeId,
      name: meter.name,
      category: meter.category,
      levelScopeId,
    }));
};

const buildComponentCategoryBreakdown = (input: {
  timezone: string;
  dateBuckets: DailyDateBucket[];
  dailyTotals: NonNullable<EnergyScopeAnalysis["dailyTotals"]>;
  series: DailyComponentCategorySeries[];
  rows: unknown[][];
  intervalMinutes: number;
  cost: EnergyScopeAnalysis["cost"];
  publicHolidayDatesByScopeId: Map<string, Set<string>>;
}): NonNullable<EnergyScopeAnalysis["componentCategoryBreakdown"]> => {
  const facts = new Map(
    input.rows.map((row) => [
      `${stringAt(row, 0)}:${stringAt(row, 3)}:${stringAt(row, 4)}`,
      row,
    ]),
  );
  const dailyTotalsByScope = new Map(
    input.dailyTotals.scopes.map((scope) => [scope.scopeId, scope]),
  );
  const seriesByScope = new Map<string, DailyComponentCategorySeries[]>();
  for (const definition of input.series) {
    seriesByScope.set(definition.scopeId, [
      ...(seriesByScope.get(definition.scopeId) ?? []),
      definition,
    ]);
  }
  return {
    metricId: "energy.total_usage_kwh@1",
    queryId: "daily_component_categories_v1",
    accountingBasis: "published_component_circuits",
    grain: "day",
    timezone: input.timezone,
    scopes: [...seriesByScope.values()].map((scopeSeries) => {
      const orderedSeries = [...scopeSeries].sort(
        (left, right) => left.categoryOrder - right.categoryOrder,
      );
      const scope = orderedSeries[0]!;
      const publicHolidayDates = input.publicHolidayDatesByScopeId.get(scope.scopeId);
      const officialDailyRows = new Map(
        (dailyTotalsByScope.get(scope.scopeId)?.rows ?? []).map((row) => [row.localDate, row]),
      );
      const rows = input.dateBuckets.map((bucket) => {
        const categories = orderedSeries.map((definition) => {
          const fact = facts.get(`${definition.scopeId}:${definition.category}:${bucket.localDate}`);
          return {
            category: definition.category,
            usageKwh: fact && fact[5] !== null && fact[5] !== undefined
              ? round(numberAt(fact, 5), 4)
              : null,
          };
        });
        const componentExpectedMeterIntervalCount = orderedSeries.reduce(
          (sum, definition) => sum + definition.meterNodeIds.length * Math.round(
            (Date.parse(bucket.to) - Date.parse(bucket.from)) / (input.intervalMinutes * 60_000),
          ),
          0,
        );
        const validIntervalCount = orderedSeries.reduce((sum, definition) => {
          const fact = facts.get(`${definition.scopeId}:${definition.category}:${bucket.localDate}`);
          return sum + (fact ? numberAt(fact, 6) : 0);
        }, 0);
        const qualityEventCount = orderedSeries.reduce((sum, definition) => {
          const fact = facts.get(`${definition.scopeId}:${definition.category}:${bucket.localDate}`);
          return sum + (fact ? numberAt(fact, 7) : 0);
        }, 0);
        const dayTypes = new Set<"weekday" | "weekend" | "public_holiday">(
          orderedSeries.flatMap((definition): Array<"weekday" | "weekend" | "public_holiday"> => {
          const fact = facts.get(`${definition.scopeId}:${definition.category}:${bucket.localDate}`);
          if (!fact || numberAt(fact, 9) !== 1 || numberAt(fact, 10) !== 0) return [];
          const value = optionalStringAt(fact, 8);
          return value === "weekday" || value === "weekend" || value === "public_holiday"
            ? [value]
            : [];
          }),
        );
        const componentDataStatus = validIntervalCount === 0
          ? "unavailable" as const
          : validIntervalCount === componentExpectedMeterIntervalCount && qualityEventCount === 0
            ? "complete" as const
            : "partial" as const;
        const completeCategoryValues = categories.every((category) => category.usageKwh !== null)
          ? categories.map((category) => category.usageKwh as number)
          : null;
        const componentUsageKwh = componentDataStatus === "complete" && completeCategoryValues
          ? round(completeCategoryValues.reduce((sum, value) => sum + value, 0), 4)
          : null;
        const officialDailyRow = officialDailyRows.get(bucket.localDate);
        const officialDataStatus = officialDailyRow?.dataHealth.status ?? "unavailable";
        const officialUsageKwh = officialDataStatus === "complete"
          ? officialDailyRow?.usageKwh ?? null
          : null;
        const officialExpectedMeterIntervalCount = officialDailyRow?.dataHealth.expectedMeterIntervalCount ?? 0;
        const officialValidIntervalCount = officialDailyRow?.dataHealth.validIntervalCount ?? 0;
        const officialQualityEventCount = officialDailyRow?.dataHealth.qualityEventCount ?? 0;
        const expectedMeterIntervalCount = componentExpectedMeterIntervalCount
          + officialExpectedMeterIntervalCount;
        const combinedValidIntervalCount = validIntervalCount + officialValidIntervalCount;
        const combinedQualityEventCount = qualityEventCount + officialQualityEventCount;
        const dataStatus = componentDataStatus === "complete"
          && officialDataStatus === "complete"
          && componentUsageKwh !== null
          && officialUsageKwh !== null
          ? "complete" as const
          : combinedValidIntervalCount === 0
            ? "unavailable" as const
            : "partial" as const;
        return {
          localDate: bucket.localDate,
          from: bucket.from,
          to: bucket.to,
          dayType: publicHolidayDates?.has(bucket.localDate)
            ? "public_holiday" as const
            : dayTypes.size === 1 ? [...dayTypes][0]! : null,
          officialUsageKwh,
          componentUsageKwh,
          categories: categories.map((category) => ({
            ...category,
            sharePct: category.usageKwh === null || componentUsageKwh === null
              ? null
              : percent(category.usageKwh, componentUsageKwh, 4),
          })),
          estimatedCost: dailyEstimatedCost({
            cost: input.cost,
            from: bucket.from,
            to: bucket.to,
            usageKwh: officialUsageKwh,
          }),
          dataHealth: {
            status: dataStatus,
            coveragePct: expectedMeterIntervalCount > 0
              ? round(Math.min(combinedValidIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
              : 0,
            expectedMeterIntervalCount,
            validIntervalCount: combinedValidIntervalCount,
            qualityEventCount: combinedQualityEventCount,
          },
        };
      });
      const periodComplete = rows.length > 0 && rows.every((row) =>
        row.dataHealth.status === "complete"
        && row.officialUsageKwh !== null
        && row.componentUsageKwh !== null
        && row.categories.every((category) => category.usageKwh !== null),
      );
      const hasUsableFacts = rows.some((row) =>
        row.officialUsageKwh !== null
        || row.categories.some((category) => category.usageKwh !== null),
      );
      const periodStatus = periodComplete
        ? "complete" as const
        : hasUsableFacts
          ? "partial" as const
          : "unavailable" as const;
      const periodCategories = orderedSeries.map((definition) => ({
        category: definition.category,
        usageKwh: periodComplete
          ? round(rows.reduce((sum, row) => {
            const usageKwh = row.categories.find((category) => category.category === definition.category)?.usageKwh;
            return sum + (usageKwh as number);
          }, 0), 4)
          : null,
      }));
      const componentUsageKwh = periodComplete
        ? round(periodCategories.reduce((sum, category) => sum + (category.usageKwh as number), 0), 4)
        : null;
      const officialUsageKwh = periodComplete
        ? round(rows.reduce((sum, row) => sum + (row.officialUsageKwh as number), 0), 4)
        : null;
      return {
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        scopeType: scope.scopeType,
        period: {
          status: periodStatus,
          reason: periodStatus === "complete"
            ? null
            : periodStatus === "partial"
              ? "One or more daily component Category rows are incomplete; period totals are withheld."
              : "No usable daily component Category rows are available; period totals are withheld.",
          officialUsageKwh,
          componentUsageKwh,
          gapKwh: officialUsageKwh === null || componentUsageKwh === null
            ? null
            : round(officialUsageKwh - componentUsageKwh, 4),
          ratioPct: officialUsageKwh !== null && officialUsageKwh > 0 && componentUsageKwh !== null
            ? round(componentUsageKwh / officialUsageKwh * 100, 4)
            : null,
          categories: periodCategories.map((category) => ({
            ...category,
            sharePct: category.usageKwh === null || componentUsageKwh === null
              ? null
              : percent(category.usageKwh, componentUsageKwh, 4),
          })),
        },
        rows,
      };
    }),
  };
};

const dailyEstimatedCost = (input: {
  cost: EnergyScopeAnalysis["cost"];
  from: string;
  to: string;
  usageKwh: number | null;
}): NonNullable<EnergyScopeAnalysis["componentCategoryBreakdown"]>["scopes"][number]["rows"][number]["estimatedCost"] => {
  if (input.usageKwh === null) {
    return { status: "unavailable", reason: "Official daily usage is unavailable." };
  }
  if (input.cost.status === "unavailable") {
    return { status: "unavailable", reason: input.cost.reason.message };
  }
  const coveringAllocations = input.cost.allocations.filter((allocation) =>
    Date.parse(allocation.from) <= Date.parse(input.from)
    && Date.parse(allocation.to) >= Date.parse(input.to),
  );
  if (coveringAllocations.length !== 1) {
    return {
      status: "unavailable",
      reason: "No single release-pinned Tariff rate covers this complete local day.",
    };
  }
  const allocation = coveringAllocations[0]!;
  return {
    status: "available",
    amount: round(input.usageKwh * allocation.ratePerKwh, 4),
    currency: input.cost.currency,
    ratePerKwh: allocation.ratePerKwh,
    tariffScheduleVersion: input.cost.tariffScheduleVersion,
  };
};

const buildDailyDateBuckets = (context: EnergyQueryContext): DailyDateBucket[] => {
  const firstDate = formatLocalDate(context.from, context.timezone);
  const endDateExclusive = formatLocalDate(context.to, context.timezone);
  const buckets: DailyDateBucket[] = [];
  for (let localDate = firstDate; localDate < endDateExclusive; localDate = shiftLocalDate(localDate, 1)) {
    buckets.push({
      localDate,
      from: zonedStartOfLocalDay(localDate, context.timezone),
      to: zonedStartOfLocalDay(shiftLocalDate(localDate, 1), context.timezone),
    });
  }
  return buckets;
};

const buildCalendarTotals = (input: {
  timezone: string;
  selectedScopeId: string;
  dailyTotals: NonNullable<EnergyScopeAnalysis["dailyTotals"]>;
}): NonNullable<EnergyScopeAnalysis["calendarTotals"]> => {
  const selectedScope = input.dailyTotals.scopes.find(
    (scope) => scope.scopeId === input.selectedScopeId,
  );
  return {
    metricId: "energy.total_usage_kwh@1",
    timezone: input.timezone,
    derivedFromQueryId: "daily_totals_v1",
    scopes: selectedScope ? [{
      scopeId: selectedScope.scopeId,
      scopeName: selectedScope.scopeName,
      scopeType: selectedScope.scopeType,
      weeks: aggregateDailyRowsByCalendarPeriod(selectedScope.rows, "week"),
      months: aggregateDailyRowsByCalendarPeriod(selectedScope.rows, "month"),
    }] : [],
  };
};

export const selectEnergyLatestCompleteDay = async (
  input: EnergyPeriodSelectionInput,
): Promise<EnergyLatestCompleteDaySelection> => {
  const { scoped, aggregateMeterNodeIds } = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND",
  );
  const selected = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: latestCompletePeriodSelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      1,
      input.context.timezone,
    ),
    limit: 1,
  });
  const row = selected.rows[0];
  if (!row) throw new Error("ENERGYIQ_LATEST_COMPLETE_DAY_NOT_FOUND");
  return {
    periodDays: 1,
    status: "complete",
    intervalMinutes: numberAt(row, 4),
    period: {
      localFrom: stringAt(row, 0),
      localToExclusive: stringAt(row, 1),
      from: isoAt(row, 2),
      to: isoAt(row, 3),
    },
  };
};

export type EnergyLatestCompleteDaySelection = Omit<EnergyLatestCompletePeriodSelection, "periodDays"> & {
  periodDays: 1;
  status: "complete";
};

export type EnergyLatestAvailableDaySelection = Omit<EnergyLatestCompletePeriodSelection, "periodDays"> & {
  periodDays: 1;
  status: "partial";
};

export const selectEnergyLatestAvailableDay = async (
  input: EnergyPeriodSelectionInput,
): Promise<EnergyLatestAvailableDaySelection> => {
  const { scoped, aggregateMeterNodeIds } = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND",
  );
  const selected = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: latestAvailableDaySelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      input.context.timezone,
    ),
    limit: 1,
  });
  const row = selected.rows[0];
  if (!row) throw new Error("ENERGYIQ_LATEST_AVAILABLE_DAY_NOT_FOUND");
  return {
    periodDays: 1,
    status: "partial",
    intervalMinutes: numberAt(row, 4),
    period: {
      localFrom: stringAt(row, 0),
      localToExclusive: stringAt(row, 1),
      from: isoAt(row, 2),
      to: isoAt(row, 3),
    },
  };
};

const aggregateDailyRowsByCalendarPeriod = (
  rows: NonNullable<EnergyScopeAnalysis["dailyTotals"]>["scopes"][number]["rows"],
  grain: "week" | "month",
): NonNullable<EnergyScopeAnalysis["calendarTotals"]>["scopes"][number]["weeks"] => {
  const groups = new Map<string, {
    fullFrom: string;
    fullToInclusive: string;
    rows: typeof rows;
  }>();
  for (const row of rows) {
    const bounds = calendarPeriodBounds(row.localDate, grain);
    const group = groups.get(bounds.fullFrom) ?? { ...bounds, rows: [] };
    group.rows.push(row);
    groups.set(bounds.fullFrom, group);
  }
  return [...groups.values()]
    .sort((left, right) => left.fullFrom.localeCompare(right.fullFrom))
    .map((group) => {
      const groupedRows = [...group.rows].sort((left, right) => left.localDate.localeCompare(right.localDate));
      const first = groupedRows[0]!;
      const last = groupedRows[groupedRows.length - 1]!;
      const expectedMeterIntervalCount = groupedRows.reduce(
        (sum, row) => sum + row.dataHealth.expectedMeterIntervalCount,
        0,
      );
      const validIntervalCount = groupedRows.reduce(
        (sum, row) => sum + row.dataHealth.validIntervalCount,
        0,
      );
      const qualityEventCount = groupedRows.reduce(
        (sum, row) => sum + row.dataHealth.qualityEventCount,
        0,
      );
      const usageRows = groupedRows.filter(
        (row): row is typeof row & { usageKwh: number } => row.usageKwh !== null,
      );
      const aggregateEligibleIntervalCount = groupedRows.reduce(
        (sum, row) => sum + (
          row.dataHealth.status === "complete"
            ? row.dataHealth.expectedMeterIntervalCount
            : row.dataHealth.aggregateEligibleIntervalCount ?? row.dataHealth.validIntervalCount
        ),
        0,
      );
      const aggregateComplete = groupedRows.length > 0 && groupedRows.every((row) => (
        row.dataHealth.status === "complete" || row.dataHealth.aggregateStatus === "complete"
      ));
      const status = aggregateEligibleIntervalCount === 0
        ? "unavailable" as const
        : aggregateComplete
          ? "complete" as const
          : "partial" as const;
      return {
        localFrom: first.localDate,
        localToInclusive: last.localDate,
        from: first.from,
        to: last.to,
        usageKwh: usageRows.length > 0
          ? round(usageRows.reduce((sum, row) => sum + row.usageKwh, 0), 4)
          : null,
        isPartialCalendarPeriod: first.localDate !== group.fullFrom
          || last.localDate !== group.fullToInclusive,
        dataHealth: {
          status,
          coveragePct: expectedMeterIntervalCount > 0
            ? round(Math.min(aggregateEligibleIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
            : 0,
          expectedMeterIntervalCount,
          validIntervalCount,
          qualityEventCount,
          ...(qualityEventCount > 0 ? {
            aggregateStatus: status,
            aggregateCoveragePct: expectedMeterIntervalCount > 0
              ? round(Math.min(aggregateEligibleIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
              : 0,
            aggregateEligibleIntervalCount: round(aggregateEligibleIntervalCount, 4),
            cadenceGapEventCount: groupedRows.reduce(
              (sum, row) => sum + (row.dataHealth.cadenceGapEventCount ?? 0),
              0,
            ),
          } : {}),
        },
      };
    });
};

const calendarPeriodBounds = (
  localDate: string,
  grain: "week" | "month",
): { fullFrom: string; fullToInclusive: string } => {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (grain === "week") {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    const fullFrom = shiftLocalDate(localDate, -daysSinceMonday);
    return { fullFrom, fullToInclusive: shiftLocalDate(fullFrom, 6) };
  }
  const fullFrom = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year ?? 0, month ?? 1, 0)).getUTCDate();
  return {
    fullFrom,
    fullToInclusive: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
};

const buildTimeBehaviour = (input: {
  timezone: string;
  scopes: DailyTotalScope[];
  dateBuckets: DailyDateBucket[];
  intervalMinutes: number;
  rows: unknown[][];
  publicHolidayDatesByScopeId: Map<string, Set<string>>;
}): NonNullable<EnergyScopeAnalysis["timeBehaviour"]> => {
  const factsByScopeDateHour = new Map(
    input.rows.flatMap((row) => parseTimeBucketFacts(
      stringAt(row, 0),
      stringAt(row, 3),
    )).map((fact) => [
      `${fact.scopeId}:${fact.localDate}:${fact.localHour}`,
      fact,
    ]),
  );
  const scopes = input.scopes.map((scope) => ({
    scopeId: scope.scopeId,
    scopeName: scope.scopeName,
    scopeType: scope.scopeType,
    cells: input.dateBuckets.flatMap((dateBucket) => Array.from(
      { length: 24 },
      (_, localHour) => {
        const from = zonedStartOfLocalHour(
          dateBucket.localDate,
          localHour,
          input.timezone,
        );
        const to = localHour === 23
          ? dateBucket.to
          : zonedStartOfLocalHour(dateBucket.localDate, localHour + 1, input.timezone);
        const row = factsByScopeDateHour.get(
          `${scope.scopeId}:${dateBucket.localDate}:${localHour}`,
        );
        const validIntervalCount = row?.validIntervalCount ?? 0;
        const qualityEventCount = row?.qualityEventCount ?? 0;
        const expectedMeterIntervalCount = scope.meterNodeIds.length * Math.round(
          (Date.parse(to) - Date.parse(from)) / (input.intervalMinutes * 60_000),
        );
        const status = validIntervalCount === 0
          ? "unavailable" as const
          : validIntervalCount >= expectedMeterIntervalCount && qualityEventCount === 0
            ? "complete" as const
            : "partial" as const;
        return {
          localDate: dateBucket.localDate,
          localHour,
          from,
          to,
          usageKwh: row?.usageKwh !== null && row?.usageKwh !== undefined
            ? round(row.usageKwh, 4)
            : null,
          dataHealth: {
            status,
            coveragePct: expectedMeterIntervalCount > 0
              ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
              : 0,
            expectedMeterIntervalCount,
            validIntervalCount,
            qualityEventCount,
          },
        };
      },
    )),
  }));
  const dayProfiles: NonNullable<EnergyScopeAnalysis["timeBehaviour"]>["dayProfiles"] = [];
  for (const scope of scopes) {
    const publicHolidayDates = input.publicHolidayDatesByScopeId.get(scope.scopeId);
    const classifiedCompleteDates = new Map<string, "weekday" | "weekend">();
    let classificationUnavailable = false;
    for (const dateBucket of input.dateBuckets) {
      const dateCells = scope.cells.filter((cell) => cell.localDate === dateBucket.localDate);
      const isCompleteDate = dateCells.length === 24
        && dateCells.every((cell) => (
          cell.dataHealth.status === "complete" && cell.usageKwh !== null
        ));
      if (!isCompleteDate) continue;
      const dayTypes = new Set<"weekday" | "weekend">();
      for (const cell of dateCells) {
        const fact = factsByScopeDateHour.get(
          `${scope.scopeId}:${cell.localDate}:${cell.localHour}`,
        );
        if (
          fact?.dayTypeCount !== 1
          || fact.dayTypeNullCount !== 0
          || (fact.dayType !== "weekday" && fact.dayType !== "weekend")
        ) {
          classificationUnavailable = true;
          break;
        }
        dayTypes.add(fact.dayType);
      }
      if (classificationUnavailable || dayTypes.size !== 1) {
        classificationUnavailable = true;
        break;
      }
      classifiedCompleteDates.set(dateBucket.localDate, [...dayTypes][0]!);
    }
    for (const dayType of ["weekday", "weekend"] as const) {
      if (classificationUnavailable) {
        dayProfiles.push({
          dayType,
          scopeId: scope.scopeId,
          scopeName: scope.scopeName,
          status: "unavailable",
          reason: {
            code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
            message: `Accepted facts do not provide one consistent Day Type per complete local day for ${scope.scopeName}.`,
          },
        });
        continue;
      }
      const completeDates = [...classifiedCompleteDates.entries()]
        .filter(([localDate, classifiedDayType]) => (
          classifiedDayType === dayType && !publicHolidayDates?.has(localDate)
        ))
        .map(([localDate]) => localDate);
      if (completeDates.length === 0) {
        dayProfiles.push({
          dayType,
          scopeId: scope.scopeId,
          scopeName: scope.scopeName,
          status: "unavailable",
          reason: {
            code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE",
            message: `No complete ${dayType} local-day sample is available for ${scope.scopeName}.`,
          },
        });
        continue;
      }
      const completeDateSet = new Set(completeDates);
      dayProfiles.push({
        dayType,
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        status: "available",
        sampleDayCount: completeDates.length,
        values: Array.from({ length: 24 }, (_, localHour) => {
          const samples = scope.cells.filter((cell) => (
            cell.localHour === localHour
            && completeDateSet.has(cell.localDate)
            && cell.usageKwh !== null
          ));
          return {
            localHour,
            usageKwh: round(
              samples.reduce((sum, cell) => sum + (cell.usageKwh ?? 0), 0) / samples.length,
              4,
            ),
          };
        }),
      });
    }
    if (!publicHolidayDates) {
      dayProfiles.push({
        dayType: "public_holiday",
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        status: "unavailable",
        reason: {
          code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
          message: "Public Holiday profile requires an authoritative release-pinned Calendar classification.",
        },
      });
      continue;
    }
    const completeHolidayDates = [...classifiedCompleteDates.keys()]
      .filter((localDate) => publicHolidayDates.has(localDate));
    if (completeHolidayDates.length === 0) {
      dayProfiles.push({
        dayType: "public_holiday",
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        status: "unavailable",
        reason: {
          code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE",
          message: `No complete public_holiday local-day sample is available for ${scope.scopeName}.`,
        },
      });
      continue;
    }
    const completeHolidayDateSet = new Set(completeHolidayDates);
    dayProfiles.push({
      dayType: "public_holiday",
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      status: "available",
      sampleDayCount: completeHolidayDates.length,
      values: Array.from({ length: 24 }, (_, localHour) => {
        const samples = scope.cells.filter((cell) => (
          cell.localHour === localHour
          && completeHolidayDateSet.has(cell.localDate)
          && cell.usageKwh !== null
        ));
        return {
          localHour,
          usageKwh: round(
            samples.reduce((sum, cell) => sum + (cell.usageKwh ?? 0), 0) / samples.length,
            4,
          ),
        };
      }),
    });
  }
  return {
    metricId: "energy.total_usage_kwh@1",
    grain: "hour",
    unit: "kWh",
    timezone: input.timezone,
    queryId: "time_bucket_grid_v1",
    scopes,
    dayProfiles,
  };
};

const resolvePublicHolidayDatesByScope = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  businessCalendarVersion: string;
  period: { from: string; to: string };
  scopes: DailyTotalScope[];
}): Map<string, Set<string>> => {
  const resolvedByScope = new Map<string, Set<string>>();
  for (const scope of input.scopes) {
    const resolved = input.metadataStore.energyIq.operationalPolicy
      .resolveOperatingCalendarExceptionDates({
        project_id: input.projectId,
        scope_id: scope.scopeId,
        version_id: input.businessCalendarVersion,
        period: input.period,
      });
    if (!resolved) continue;
    resolvedByScope.set(scope.scopeId, new Set(
      resolved.exceptions
        .filter((exception) => exception.classification === "public_holiday")
        .map((exception) => exception.date),
    ));
  }
  return resolvedByScope;
};

const buildComponentHourlyProfiles = (input: {
  timezone: string;
  scopes: DailyTotalScope[];
  dateBuckets: DailyDateBucket[];
  intervalMinutes: number;
  series: ComponentHourlyCircuitSeries[];
  rows: unknown[][];
  publicHolidayDatesByScopeId: Map<string, Set<string>>;
}): NonNullable<EnergyScopeAnalysis["componentHourlyProfiles"]> => {
  const expectedMeterIntervalCount = Math.round(60 / input.intervalMinutes);
  if (expectedMeterIntervalCount <= 0) {
    throw new Error("ENERGYIQ_COMPONENT_HOURLY_INTERVAL_INVALID");
  }
  const definitionsById = new Map(input.series.map((definition) => [
    definition.meterNodeId,
    definition,
  ]));
  const factsByMeterId = new Map<string, ReturnType<typeof parseTimeBucketFacts>>();
  for (const row of input.rows) {
    const meterNodeId = stringAt(row, 0);
    if (!definitionsById.has(meterNodeId) || factsByMeterId.has(meterNodeId)) {
      throw new Error(`ENERGYIQ_COMPONENT_HOURLY_SERIES_INVALID:${meterNodeId}`);
    }
    factsByMeterId.set(meterNodeId, parseTimeBucketFacts(meterNodeId, stringAt(row, 1)));
  }
  if (factsByMeterId.size !== input.series.length) {
    throw new Error("ENERGYIQ_COMPONENT_HOURLY_SERIES_INCOMPLETE");
  }

  return {
    metricId: "energy.total_usage_kwh@1",
    queryId: "component_hourly_profiles_v1",
    accountingBasis: "published_component_circuits",
    grain: "hour",
    unit: "kWh",
    timezone: input.timezone,
    scopes: input.scopes.map((scope) => {
      const publicHolidayDates = input.publicHolidayDatesByScopeId.get(scope.scopeId);
      const definitions = input.series.filter((definition) => (
        scope.scopeType === "project" || definition.levelScopeId === scope.scopeId
      ));
      const factsByMeterDateHour = new Map(definitions.flatMap((definition) => (
        (factsByMeterId.get(definition.meterNodeId) ?? []).map((fact) => [
          `${definition.meterNodeId}:${fact.localDate}:${fact.localHour}`,
          fact,
        ] as const)
      )));
      const completeDates = new Map<string, "weekday" | "weekend">();
      let classificationUnavailable = false;
      for (const dateBucket of input.dateBuckets) {
        const dateFacts = definitions.flatMap((definition) => Array.from(
          { length: 24 },
          (_, localHour) => factsByMeterDateHour.get(
            `${definition.meterNodeId}:${dateBucket.localDate}:${localHour}`,
          ),
        ));
        const dataComplete = dateFacts.length === definitions.length * 24
          && dateFacts.every((fact) => (
            fact !== undefined
            && fact.usageKwh !== null
            && fact.validIntervalCount === expectedMeterIntervalCount
            && fact.qualityEventCount === 0
          ));
        if (!dataComplete) continue;
        const dayTypes = new Set<"weekday" | "weekend">();
        for (const fact of dateFacts) {
          if (
            fact?.dayTypeCount !== 1
            || fact.dayTypeNullCount !== 0
            || (fact.dayType !== "weekday" && fact.dayType !== "weekend")
          ) {
            classificationUnavailable = true;
            break;
          }
          dayTypes.add(fact.dayType);
        }
        if (classificationUnavailable || dayTypes.size !== 1) {
          classificationUnavailable = true;
          break;
        }
        completeDates.set(dateBucket.localDate, [...dayTypes][0]!);
      }
      const categories = [...new Set(definitions.map((definition) => definition.category))]
        .sort(componentProfileCategoryOrder);
      const profiles: NonNullable<EnergyScopeAnalysis["componentHourlyProfiles"]>["scopes"][number]["profiles"] = [];
      for (const dayType of ["weekday", "weekend", "public_holiday"] as const) {
        if (dayType === "public_holiday" && !publicHolidayDates) {
          profiles.push({
            dayType,
            status: "unavailable",
            reason: {
              code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
              message: "Public Holiday component profiles require an authoritative release-pinned Calendar classification.",
            },
          });
          continue;
        }
        if (classificationUnavailable) {
          profiles.push({
            dayType,
            status: "unavailable",
            reason: {
              code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
              message: `Published component Circuits do not provide one consistent Day Type per complete local day for ${scope.scopeName}.`,
            },
          });
          continue;
        }
        const sampleDates = [...completeDates.entries()]
          .filter(([localDate, value]) => dayType === "public_holiday"
            ? publicHolidayDates?.has(localDate) === true
            : value === dayType && !publicHolidayDates?.has(localDate))
          .map(([localDate]) => localDate);
        if (sampleDates.length === 0) {
          profiles.push({
            dayType,
            status: "unavailable",
            reason: {
              code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE",
              message: `No common complete ${dayType} local-day sample is available for the published component Circuits in ${scope.scopeName}.`,
            },
          });
          continue;
        }
        profiles.push({
          dayType,
          status: "available",
          sampleDayCount: sampleDates.length,
          categories: categories.map((category) => ({
            category,
            values: Array.from({ length: 24 }, (_, localHour) => ({
              localHour,
              usageKwh: round(sampleDates.reduce((dateSum, localDate) => (
                dateSum + definitions
                  .filter((definition) => definition.category === category)
                  .reduce((categorySum, definition) => (
                    categorySum + requiredComponentHourlyUsage(
                      factsByMeterDateHour,
                      definition.meterNodeId,
                      localDate,
                      localHour,
                    )
                  ), 0)
              ), 0) / sampleDates.length, 4),
            })),
          })),
          circuits: definitions.map((definition) => ({
            meterNodeId: definition.meterNodeId,
            name: definition.name,
            category: definition.category,
            values: Array.from({ length: 24 }, (_, localHour) => ({
              localHour,
              usageKwh: round(sampleDates.reduce((sum, localDate) => (
                sum + requiredComponentHourlyUsage(
                  factsByMeterDateHour,
                  definition.meterNodeId,
                  localDate,
                  localHour,
                )
              ), 0) / sampleDates.length, 4),
            })),
          })),
        });
      }
      return {
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        scopeType: scope.scopeType,
        profiles,
      };
    }),
  };
};

const requiredComponentHourlyUsage = (
  facts: Map<string, ReturnType<typeof parseTimeBucketFacts>[number]>,
  meterNodeId: string,
  localDate: string,
  localHour: number,
): number => {
  const fact = facts.get(`${meterNodeId}:${localDate}:${localHour}`);
  if (!fact || fact.usageKwh === null) {
    throw new Error(`ENERGYIQ_COMPONENT_HOURLY_FACT_MISSING:${meterNodeId}:${localDate}:${localHour}`);
  }
  return fact.usageKwh;
};

const componentProfileCategoryOrder = (left: string, right: string): number => {
  const order = ["load", "light", "aircon", "it", "kitchen", "plug", "other", "overall"];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return (leftIndex < 0 ? order.length : leftIndex)
    - (rightIndex < 0 ? order.length : rightIndex)
    || left.localeCompare(right);
};

const parseTimeBucketFacts = (
  scopeId: string,
  value: string,
): Array<{
  scopeId: string;
  localDate: string;
  localHour: number;
  usageKwh: number | null;
  validIntervalCount: number;
  qualityEventCount: number;
  dayType: string | null;
  dayTypeCount: number;
  dayTypeNullCount: number;
}> => {
  const parsed = JSON.parse(value || "[]") as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`ENERGYIQ_TIME_BUCKET_GRID_INVALID:${scopeId}`);
  }
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`ENERGYIQ_TIME_BUCKET_GRID_CELL_INVALID:${scopeId}:${index}`);
    }
    const localDate = String(item.local_date ?? "");
    const localHour = Number(item.local_hour);
    const usageKwh = item.usage_kwh === null || item.usage_kwh === undefined
      ? null
      : Number(item.usage_kwh);
    const validIntervalCount = Number(item.valid_interval_count);
    const qualityEventCount = Number(item.quality_event_count);
    const dayType = item.day_type === null || item.day_type === undefined
      ? null
      : String(item.day_type);
    const dayTypeCount = Number(item.day_type_count);
    const dayTypeNullCount = Number(item.day_type_null_count);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(localDate)
      || !Number.isInteger(localHour)
      || localHour < 0
      || localHour > 23
      || (usageKwh !== null && !Number.isFinite(usageKwh))
      || !Number.isFinite(validIntervalCount)
      || !Number.isFinite(qualityEventCount)
      || !Number.isInteger(dayTypeCount)
      || dayTypeCount < 0
      || !Number.isInteger(dayTypeNullCount)
      || dayTypeNullCount < 0
    ) {
      throw new Error(`ENERGYIQ_TIME_BUCKET_GRID_CELL_INVALID:${scopeId}:${index}`);
    }
    return {
      scopeId,
      localDate,
      localHour,
      usageKwh,
      validIntervalCount,
      qualityEventCount,
      dayType,
      dayTypeCount,
      dayTypeNullCount,
    };
  });
};

const formatLocalDate = (value: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftLocalDate = (value: string, days: number): string => {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const zonedStartOfLocalDay = (value: string, timezone: string): string =>
  zonedStartOfLocalHour(value, 0, timezone);

const zonedStartOfLocalHour = (
  value: string,
  hour: number,
  timezone: string,
): string => {
  const [year, month, day] = value.split("-").map(Number);
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour);
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    candidate += targetUtc - Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
  }
  return new Date(candidate).toISOString();
};

const buildVirtualMeters = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  resource: "electricity" | "water";
  selectedScopeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  circuits: EnergyScopeAnalysis["circuits"];
}): EnergyScopeAnalysis["virtualMeters"] => {
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) return [];
  const mapping = (JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument).meter_mapping;
  if (!mapping) return [];
  const includedScopeIds = collectDescendantIds(input.selectedScopeId, input.hierarchy);
  includedScopeIds.add(input.selectedScopeId);
  const circuitByMeterNodeId = new Map(input.circuits.map((circuit) => [circuit.meterNodeId, circuit]));
  return (mapping.virtual_meters ?? []).flatMap((virtualMeter) => {
    if (virtualMeter.resource !== input.resource || !includedScopeIds.has(virtualMeter.scope_id)) return [];
    const terms = virtualMeter.terms.map((term) => ({
      term,
      circuit: circuitByMeterNodeId.get(term.mapping_row_id)
    }));
    if (terms.some(({ circuit }) => !circuit)) return [];
    return [{
      meterNodeId: virtualMeter.id,
      name: virtualMeter.display_name,
      scopeId: virtualMeter.scope_id,
      termMeterNodeIds: terms.map(({ term }) => term.mapping_row_id),
      usageKwh: round(terms.reduce(
        (sum, { term, circuit }) => sum + (circuit?.usageKwh ?? 0) * term.coefficient,
        0
      ), 4),
      includedInOfficialTotal: false as const
    }];
  });
};

const buildVirtualMeterTraces = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  resource: "electricity" | "water";
  selectedScopeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  circuits: EnergyScopeAnalysis["circuits"];
}): NonNullable<EnergyScopeAnalysis["virtualMeterTraces"]> => {
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) return [];
  const mapping = (JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument).meter_mapping;
  if (!mapping) return [];
  const includedScopeIds = collectDescendantIds(input.selectedScopeId, input.hierarchy);
  includedScopeIds.add(input.selectedScopeId);
  return buildEnergyVirtualMeterTraces({
    virtualMeters: mapping.virtual_meters ?? [],
    mappingRows: mapping.rows,
    includedScopeIds,
    resource: input.resource,
    circuits: input.circuits,
  });
};

export const buildEnergyVirtualMeterTraces = (input: {
  virtualMeters: readonly EnergyIqVirtualMeter[];
  mappingRows: readonly EnergyIqMeterMappingRow[];
  includedScopeIds: ReadonlySet<string>;
  resource: "electricity" | "water";
  circuits: EnergyScopeAnalysis["circuits"];
}): NonNullable<EnergyScopeAnalysis["virtualMeterTraces"]> => {
  const mappingRowByMeterNodeId = new Map(input.mappingRows.map((row) => [row.id, row]));
  const circuitByMeterNodeId = new Map(
    input.circuits.map((circuit) => [circuit.meterNodeId, circuit]),
  );
  return input.virtualMeters.flatMap((virtualMeter) => {
    if (
      virtualMeter.resource !== input.resource
      || !input.includedScopeIds.has(virtualMeter.scope_id)
    ) {
      return [];
    }
    const terms = virtualMeter.terms.map((term) => {
      const mappingRow = mappingRowByMeterNodeId.get(term.mapping_row_id);
      const circuit = circuitByMeterNodeId.get(term.mapping_row_id);
      const available = mappingRow !== undefined && circuit !== undefined;
      return {
        meterNodeId: term.mapping_row_id,
        name: mappingRow?.display_name ?? circuit?.name ?? term.mapping_row_id,
        coefficient: term.coefficient,
        inputUsageKwh: available ? circuit.usageKwh : null,
        contributionKwh: available
          ? round(circuit.usageKwh * term.coefficient, 4)
          : null,
        dataHealth: available
          ? {
              ...circuit.dataHealth,
              status: circuit.dataHealth.expectedMeterIntervalCount === 0
                ? "unavailable" as const
                : circuit.dataHealth.validIntervalCount
                    >= circuit.dataHealth.expectedMeterIntervalCount
                    && circuit.dataHealth.qualityEventCount === 0
                  ? "complete" as const
                  : "partial" as const,
            }
          : {
              status: "unavailable" as const,
              coveragePct: 0,
              expectedMeterIntervalCount: 0,
              validIntervalCount: 0,
              qualityEventCount: 0,
            },
      };
    });
    const missingTermMeterNodeIds = terms
      .filter((term) => term.inputUsageKwh === null)
      .map((term) => term.meterNodeId);
    const contributionTotalKwh = terms.reduce<number | null>(
      (sum, term) => sum === null || term.contributionKwh === null
        ? null
        : sum + term.contributionKwh,
      0,
    );
    return [{
      meterNodeId: virtualMeter.id,
      name: virtualMeter.display_name,
      scopeId: virtualMeter.scope_id,
      status: missingTermMeterNodeIds.length > 0 ? "partial" as const : "available" as const,
      usageKwh: contributionTotalKwh === null ? null : round(contributionTotalKwh, 4),
      includedInOfficialTotal: false as const,
      terms,
      missingTermMeterNodeIds,
    }];
  });
};

export const evaluateEnergyAttention = (input: {
  summary: EnergyScopeAnalysis["summary"];
  childScopes: EnergyScopeAnalysis["childScopes"];
  circuits: EnergyScopeAnalysis["circuits"];
  ruleRevisions: readonly EnergyIqRuleRevisionRecord[];
}): EnergyScopeAnalysis["attention"] => {
  const ruleByEvaluationKey = new Map(input.ruleRevisions.map((rule) => [rule.evaluation_key, rule]));
  if (input.summary.usageKwh <= 0) {
    return ruleByEvaluationKey.has("NO_DATA") ? [{
      code: "NO_DATA",
      severity: "info",
      title: "No validated consumption in this period",
      evidence: "The trusted scope returned zero valid interval consumption.",
      suggestedAction: "Check the selected period and latest import batch."
    }] : [];
  }
  const attention: EnergyScopeAnalysis["attention"] = [];
  const offHoursRule = ruleByEvaluationKey.get("NON_OPERATING_SHARE");
  const offHoursThreshold = numericRuleParameter(offHoursRule?.parameters.threshold_pct, 10);
  if (
    offHoursRule
    && input.summary.nonOperatingSharePct !== undefined
    && input.summary.nonOperatingKwh !== undefined
    && input.summary.nonOperatingSharePct >= offHoursThreshold
  ) {
    const availableCircuits = input.circuits.filter(
      (circuit): circuit is typeof circuit & { nonOperatingKwh: number } =>
        circuit.nonOperatingKwh !== undefined,
    );
    const breakdownCircuits = availableCircuits.filter((circuit) => circuit.meterRole !== "total");
    const topNonOperating = maxBy(
      breakdownCircuits.length > 0 ? breakdownCircuits : availableCircuits,
      (circuit) => circuit.nonOperatingKwh
    );
    attention.push({
      code: "NON_OPERATING_SHARE",
      severity: "warning",
      title: `${input.summary.nonOperatingSharePct.toFixed(1)}% of usage occurred outside operating hours`,
      evidence: topNonOperating
        ? `${topNonOperating.name} contributed ${topNonOperating.nonOperatingKwh.toLocaleString()} kWh outside operating hours.`
        : `${input.summary.nonOperatingKwh.toLocaleString()} kWh occurred outside operating hours.`,
      suggestedAction: "Review shutdown schedules and the highest non-operating circuit before changing equipment."
    });
  }
  const highestChild = input.childScopes[0];
  const highestChildRule = ruleByEvaluationKey.get("TOP_CHILD_SCOPE");
  const minimumChildren = numericRuleParameter(highestChildRule?.parameters.minimum_peers, 2);
  if (highestChildRule && highestChild && input.childScopes.length >= minimumChildren) {
    attention.push({
      code: "TOP_CHILD_SCOPE",
      severity: "info",
      title: `${highestChild.name} used the most energy in this scope`,
      evidence: `${highestChild.usageKwh.toLocaleString()} kWh, ${highestChild.sharePct.toFixed(1)}% of the selected scope.`,
      suggestedAction: "Open this child scope and compare its circuits and time profile."
    });
  }
  const normalised = input.childScopes.filter(
    (child): child is typeof child & { kwhPerSqm: number } => child.kwhPerSqm !== undefined
  );
  const areaRule = ruleByEvaluationKey.get("AREA_NORMALISED_OUTLIER");
  const minimumAreaPeers = numericRuleParameter(areaRule?.parameters.minimum_peers, 3);
  const areaMedianRatio = numericRuleParameter(areaRule?.parameters.median_ratio, 1.2);
  if (areaRule && normalised.length >= minimumAreaPeers) {
    const values = normalised.map((child) => child.kwhPerSqm).sort((left, right) => left - right);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    const highest = maxBy(normalised, (child) => child.kwhPerSqm);
    if (highest && median > 0 && highest.kwhPerSqm >= median * areaMedianRatio) {
      attention.push({
        code: "AREA_NORMALISED_OUTLIER",
        severity: "warning",
        title: `${highest.name} has the highest area-normalised consumption`,
        evidence: `${highest.kwhPerSqm.toFixed(2)} kWh/m² versus a sibling median of ${median.toFixed(2)} kWh/m².`,
        suggestedAction: "Check operating hours and circuit composition before comparing absolute kWh alone."
      });
    }
  }

  const peopleNormalised = input.childScopes.filter(
    (child): child is typeof child & { kwhPerPerson: number } => child.kwhPerPerson !== undefined
  );
  const peopleRule = ruleByEvaluationKey.get("PEOPLE_NORMALISED_OUTLIER");
  const minimumPeoplePeers = numericRuleParameter(peopleRule?.parameters.minimum_peers, 3);
  const peopleMedianRatio = numericRuleParameter(peopleRule?.parameters.median_ratio, 1.2);
  if (peopleRule && peopleNormalised.length >= minimumPeoplePeers) {
    const values = peopleNormalised.map((child) => child.kwhPerPerson).sort((left, right) => left - right);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    const highest = maxBy(peopleNormalised, (child) => child.kwhPerPerson);
    if (highest && median > 0 && highest.kwhPerPerson >= median * peopleMedianRatio) {
      attention.push({
        code: "PEOPLE_NORMALISED_OUTLIER",
        severity: "warning",
        title: `${highest.name} has the highest per-person consumption`,
        evidence: `${highest.kwhPerPerson.toFixed(2)} kWh/person versus a sibling median of ${median.toFixed(2)} kWh/person.`,
        suggestedAction: "Confirm typical occupancy and operating hours before comparing absolute kWh alone."
      });
    }
  }
  return attention;
};

const numericRuleParameter = (value: number | string | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const resolveScopeDimensions = (
  scopeNodeId: string,
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>
): { areaSqm: number; occupantCount: number } => {
  const selected = hierarchy.find((node) => node.id === scopeNodeId);
  if (selected?.area_sqm || selected?.occupant_count) {
    return {
      areaSqm: selected.area_sqm ?? 0,
      occupantCount: selected.occupant_count ?? 0
    };
  }
  const descendants = collectDescendantIds(scopeNodeId, hierarchy);
  const dimensionNodes = hierarchy.filter((node) =>
    descendants.has(node.id)
    && (node.area_sqm !== undefined || node.occupant_count !== undefined)
    && !hierarchy.some((candidate) =>
      candidate.parent_id === node.id
      && (candidate.area_sqm !== undefined || candidate.occupant_count !== undefined)
    )
  );
  return {
    areaSqm: dimensionNodes.reduce((sum, node) => sum + (node.area_sqm ?? 0), 0),
    occupantCount: dimensionNodes.reduce((sum, node) => sum + (node.occupant_count ?? 0), 0)
  };
};

const collectDescendantIds = (
  nodeId: string,
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>
): Set<string> => {
  const byParent = new Map<string, string[]>();
  for (const node of hierarchy) {
    if (!node.parent_id) continue;
    const children = byParent.get(node.parent_id) ?? [];
    children.push(node.id);
    byParent.set(node.parent_id, children);
  }
  const descendants = new Set<string>();
  const pending = [...(byParent.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || descendants.has(current)) continue;
    descendants.add(current);
    pending.push(...(byParent.get(current) ?? []));
  }
  return descendants;
};

const isLeafMeterScope = (
  selectedNode: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>[number],
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>,
): boolean => {
  const nodeType = selectedNode.node_type.trim().toLowerCase();
  return (nodeType === "meter" || nodeType === "circuit")
    && !hierarchy.some((node) => node.parent_id === selectedNode.id);
};

const buildLatestAcceptedReading = (input: {
  leafMeterScope: boolean;
  row: unknown[];
}): EnergyScopeAnalysis["latestAcceptedReading"] => {
  if (!input.leafMeterScope) {
    return {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "LEAF_METER_REQUIRED",
        message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
      },
    };
  }

  const valueKwh = optionalNumberAt(input.row, 8);
  const recordedAt = optionalIsoAt(input.row, 9);
  const meterNodeId = optionalStringAt(input.row, 10);
  const sourceFile = optionalStringAt(input.row, 11);
  const sourceSha256 = optionalStringAt(input.row, 12);
  const sourceReadingKind = optionalStringAt(input.row, 13);
  if (
    valueKwh !== null
    && recordedAt
    && meterNodeId
    && sourceFile
    && sourceSha256
    && sourceReadingKind === "cumulative_energy"
  ) {
    return {
      status: "available",
      valueKwh,
      recordedAt,
      meterNodeId,
      sourceFile,
      sourceSha256,
      sourceReadingKind,
      queryId: "latest_accepted_reading_v1",
    };
  }

  if (numberAt(input.row, 14) > 0) {
    return {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "INTERVAL_USAGE_SOURCE",
        message: "This Meter is supplied as interval usage, so a cumulative register reading does not apply.",
      },
    };
  }

  return {
    status: "unavailable",
    queryId: "latest_accepted_reading_v1",
    reason: {
      code: "ACCEPTED_CUMULATIVE_READING_UNAVAILABLE",
      message: "No accepted cumulative register reading is available in the selected period.",
    },
  };
};

const rowToMeterAggregate = (row: unknown[]): MeterAggregate => ({
  meterNodeId: stringAt(row, 0),
  scopeId: stringAt(row, 1),
  name: stringAt(row, 2),
  appliance: stringAt(row, 3),
  category: stringAt(row, 4),
  meterRole: stringAt(row, 5),
  usageKwh: numberAt(row, 6),
  peakKw: numberAt(row, 7),
  validIntervalCount: numberAt(row, 8),
  qualityEventCount: numberAt(row, 9)
});

const rowToPeakIntervalFact = (row: unknown[]): PeakIntervalFact => ({
  meterNodeId: stringAt(row, 0),
  intervalStart: isoAt(row, 1),
  intervalEnd: isoAt(row, 2),
  elapsedMinutes: numberAt(row, 3),
  averageKw: optionalNumberAt(row, 4),
  qualityStatus: stringAt(row, 5),
});

const buildPeakBreakdown = (input: {
  peakAt?: string;
  peakKw: number;
  intervalMinutes: number;
  timezone: string;
  periodStatus: "complete" | "partial";
  coveragePct: number;
  projectOfficialMeterNodeIds: string[];
  levelScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  facts: PeakIntervalFact[];
}): NonNullable<EnergyScopeAnalysis["peakBreakdown"]> => {
  if (!input.peakAt) {
    return peakBreakdownUnavailable(
      "PEAK_AT_MISSING",
      "Peak interval start is unavailable for the selected period.",
    );
  }
  const peakTo = new Date(
    Date.parse(input.peakAt) + input.intervalMinutes * 60_000,
  ).toISOString();
  const factsByMeterId = new Map<string, PeakIntervalFact[]>();
  for (const fact of input.facts) {
    factsByMeterId.set(fact.meterNodeId, [
      ...(factsByMeterId.get(fact.meterNodeId) ?? []),
      fact,
    ]);
  }
  const officialFacts = input.projectOfficialMeterNodeIds.map(
    (meterNodeId) => factsByMeterId.get(meterNodeId) ?? [],
  );
  if (officialFacts.some((facts) => facts.length === 0)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_UNAVAILABLE",
      "Peak breakdown requires one same-interval fact for every Project official Meter Point.",
    );
  }
  if (officialFacts.some((facts) => facts.length !== 1)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Peak breakdown requires exactly one same-interval fact for every Project official Meter Point.",
    );
  }
  if (officialFacts.some((facts) => !isAcceptedPeakFact(
    facts[0]!,
    input.peakAt!,
    peakTo,
    input.intervalMinutes,
  ))) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_REJECTED",
      "Peak breakdown requires accepted same-interval facts for every Project official Meter Point.",
    );
  }

  const projectAverageKw = officialFacts.reduce(
    (sum, facts) => sum + facts[0]!.averageKw!,
    0,
  );
  if (round(projectAverageKw, 4) !== round(input.peakKw, 4)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Peak interval official facts do not reconcile with the Project Peak.",
    );
  }
  const levelOfficialFacts = input.levelScopes.flatMap((level) => level.meterNodeIds.map(
    (meterNodeId) => factsByMeterId.get(meterNodeId) ?? [],
  ));
  if (levelOfficialFacts.some((facts) => facts.length === 0)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_UNAVAILABLE",
      "Peak breakdown requires one same-interval fact for every Level official Meter Point.",
    );
  }
  if (levelOfficialFacts.some((facts) => facts.length !== 1)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Peak breakdown requires exactly one same-interval fact for every Level official Meter Point.",
    );
  }
  if (levelOfficialFacts.some((facts) => !isAcceptedPeakFact(
    facts[0]!,
    input.peakAt!,
    peakTo,
    input.intervalMinutes,
  ))) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_REJECTED",
      "Peak breakdown requires accepted same-interval facts for every Level official Meter Point.",
    );
  }
  const hierarchyById = new Map(input.hierarchy.map((node) => [node.id, node]));
  const projectOfficialIds = new Set(input.projectOfficialMeterNodeIds);
  const completeHealth = (expectedMeterIntervalCount: number): PeakIntervalDataHealth => ({
    status: "complete",
    coveragePct: 100,
    expectedMeterIntervalCount,
    validIntervalCount: expectedMeterIntervalCount,
    qualityEventCount: 0,
  });
  const levels = input.levelScopes.map((level) => {
    const levelFacts = level.meterNodeIds.map((meterNodeId) => factsByMeterId.get(meterNodeId)![0]!);
    const levelAverageKw = levelFacts.reduce((sum, fact) => sum + fact.averageKw!, 0);
    const circuits = input.meterAggregates
      .filter((meter) => !projectOfficialIds.has(meter.meterNodeId)
        && hierarchyById.get(meter.scopeId)?.parent_id === level.scopeId)
      .map((meter) => {
        const facts = factsByMeterId.get(meter.meterNodeId) ?? [];
        const accepted = facts.length === 1 && isAcceptedPeakFact(
          facts[0]!,
          input.peakAt!,
          peakTo,
          input.intervalMinutes,
        );
        const averageKw = accepted ? facts[0]!.averageKw! : null;
        const qualityEventCount = facts.filter((fact) => fact.qualityStatus !== "ok").length;
        return {
          meterNodeId: meter.meterNodeId,
          name: meter.name,
          category: meter.category,
          averageKw: averageKw === null ? null : round(averageKw, 4),
          sharePct: averageKw === null ? null : percent(averageKw, levelAverageKw, 4),
          includedInOfficialTotal: false as const,
          dataHealth: accepted
            ? completeHealth(1)
            : {
                status: "unavailable" as const,
                coveragePct: 0,
                expectedMeterIntervalCount: 1,
                validIntervalCount: 0,
                qualityEventCount,
              },
        };
      })
      .sort((left, right) => (right.averageKw ?? Number.NEGATIVE_INFINITY)
        - (left.averageKw ?? Number.NEGATIVE_INFINITY)
        || left.meterNodeId.localeCompare(right.meterNodeId));
    return {
      scopeId: level.scopeId,
      scopeName: level.scopeName,
      averageKw: round(levelAverageKw, 4),
      sharePct: percent(levelAverageKw, projectAverageKw, 4),
      dataHealth: completeHealth(level.meterNodeIds.length),
      circuits,
      rawAverageKw: levelAverageKw,
    };
  }).sort((left, right) => right.averageKw - left.averageKw);
  const levelAverageKw = levels.reduce((sum, level) => sum + level.rawAverageKw, 0);
  if (round(levelAverageKw, 4) !== round(projectAverageKw, 4)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Level official Peak contributions do not reconcile with the Project Peak.",
    );
  }

  return {
    status: "available",
    metricId: "energy.peak_demand_kw@1",
    intervalMinutes: input.intervalMinutes,
    timezone: input.timezone,
    unit: "kW",
    periodStatus: input.periodStatus,
    coveragePct: input.coveragePct,
    peak: {
      from: input.peakAt,
      to: peakTo,
      averageKw: round(projectAverageKw, 4),
      dataHealth: completeHealth(input.projectOfficialMeterNodeIds.length),
    },
    levels: levels.map(({ rawAverageKw: _rawAverageKw, ...level }) => level),
  };
};

const peakBreakdownUnavailable = (
  code: Extract<NonNullable<EnergyScopeAnalysis["peakBreakdown"]>, { status: "unavailable" }>["reason"]["code"],
  message: string,
): NonNullable<EnergyScopeAnalysis["peakBreakdown"]> => ({
  status: "unavailable",
  reason: { code, message },
});

const isAcceptedPeakFact = (
  fact: PeakIntervalFact,
  peakFrom: string,
  peakTo: string,
  intervalMinutes: number,
): boolean => fact.qualityStatus === "ok"
  && fact.averageKw !== null
  && fact.intervalStart === peakFrom
  && fact.intervalEnd === peakTo
  && fact.elapsedMinutes === intervalMinutes;

const rowToOperationalIntervalSeries = (row: unknown[]): OperationalIntervalSeries => {
  const kind = stringAt(row, 0);
  if (kind !== "scope" && kind !== "meter") {
    throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_KIND_INVALID:${kind}`);
  }
  const intervals = parseOperationalIntervals(stringAt(row, 3));
  return {
    kind,
    ...(kind === "meter" ? {
      meterNodeId: stringAt(row, 1),
      scopeId: stringAt(row, 2),
    } : {}),
    intervals,
  };
};

const parseOperationalIntervals = (value: string): EnergyIqAnalysisInterval[] => {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("ENERGYIQ_OPERATIONAL_POLICY_INTERVALS_INVALID");
  }
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_INVALID:${index}`);
    }
    const fromMs = Number(item.from_ms);
    const toMs = Number(item.to_ms);
    const usageKwh = Number(item.usage_kwh);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !Number.isFinite(usageKwh)) {
      throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_INVALID:${index}`);
    }
    return {
      start: new Date(fromMs).toISOString(),
      end_exclusive: new Date(toMs).toISOString(),
      usage_kwh: usageKwh,
    };
  });
};

const hourlyProfileSql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    local_hour,
    SUM(scope_usage_kwh) AS usage_kwh,
    AVG(scope_kw) AS average_kw,
    MAX(scope_kw) AS peak_kw,
    COUNT(*) AS observation_count
  FROM (
    SELECT
      local_date,
      local_hour,
      local_interval_start,
      SUM(usage_kwh) AS scope_usage_kwh,
      SUM(average_kw) AS scope_kw
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
      AND source.quality_status = 'ok'
    GROUP BY local_date, local_hour, local_interval_start
  ) interval_totals
  GROUP BY local_hour
  ORDER BY local_hour
`;

const dailyTotalsSql = (
  viewName: string,
  scopes: DailyTotalScope[],
): string => scopes.map((scope, index) => `
  SELECT
    ${sqlLiteral(scope.scopeId)} AS scope_id,
    ${sqlLiteral(scope.scopeName)} AS scope_name,
    ${sqlLiteral(scope.scopeType)} AS scope_type,
    STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
    SUM(source.usage_kwh) FILTER (WHERE ${aggregateEligibleQualitySql("source")}) AS usage_kwh,
    COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
    COALESCE(SUM(source.elapsed_minutes) FILTER (
      WHERE ${aggregateEligibleQualitySql("source")}
    ), 0) AS aggregate_eligible_minutes,
    COUNT(*) FILTER (WHERE source.quality_status = 'gap') AS cadence_gap_event_count,
    COUNT(*) FILTER (WHERE NOT (${aggregateEligibleQualitySql("source")})) AS aggregate_rejected_event_count,
    ${index} AS scope_order
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(scope.meterNodeIds)}
  GROUP BY CAST(source.local_interval_start AS DATE)
`).join(" UNION ALL ") + " ORDER BY scope_order, local_date";

const dailyComponentCategoriesSql = (
  viewName: string,
  series: DailyComponentCategorySeries[],
): string => `
  SELECT
    routes.scope_id,
    routes.scope_name,
    routes.scope_type,
    routes.category,
    STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
    SUM(source.usage_kwh) FILTER (WHERE ${aggregateEligibleQualitySql("source")}) AS usage_kwh,
    COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
    MAX(source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type,
    COUNT(DISTINCT source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type_count,
    COUNT(*) FILTER (
      WHERE source.quality_status = 'ok' AND source.day_type IS NULL
    ) AS day_type_null_count,
    routes.scope_order,
    routes.category_order
  FROM ${quoteIdentifier(viewName)} source
  JOIN (VALUES ${series.flatMap((definition) => definition.meterNodeIds.map((meterNodeId) => `(
    ${definition.scopeOrder},
    ${definition.categoryOrder},
    ${sqlLiteral(definition.scopeId)},
    ${sqlLiteral(definition.scopeName)},
    ${sqlLiteral(definition.scopeType)},
    ${sqlLiteral(definition.category)},
    ${sqlLiteral(meterNodeId)}
  )`)).join(", ")}) AS routes(
    scope_order,
    category_order,
    scope_id,
    scope_name,
    scope_type,
    category,
    meter_node_id
  ) ON routes.meter_node_id = source.meter_node_id
  GROUP BY
    routes.scope_order,
    routes.category_order,
    routes.scope_id,
    routes.scope_name,
    routes.scope_type,
    routes.category,
    CAST(source.local_interval_start AS DATE)
  ORDER BY routes.scope_order, routes.category_order, local_date
`;

const dailyUsageAnomalySql = (
  viewName: string,
  series: DailyUsageAnomalySeriesDefinition[],
): string => `
  SELECT
    series_definitions.series_id,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      local_date := time_cells.local_date,
      local_hour := time_cells.local_hour,
      usage_kwh := time_cells.usage_kwh,
      valid_interval_count := time_cells.valid_interval_count,
      quality_event_count := time_cells.quality_event_count,
      day_type := time_cells.day_type,
      day_type_count := time_cells.day_type_count,
      day_type_null_count := time_cells.day_type_null_count
    ) ORDER BY time_cells.local_date, time_cells.local_hour) FILTER (
      WHERE time_cells.local_date IS NOT NULL
    )), '[]') AS cells_json,
    series_definitions.series_order
  FROM (VALUES ${series.map((definition) => `(
    ${definition.seriesOrder},
    ${sqlLiteral(definition.seriesId)}
  )`).join(", ")}) AS series_definitions(series_order, series_id)
  LEFT JOIN (
    SELECT
      routes.series_order,
      routes.series_id,
      STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      source.local_hour,
      SUM(source.usage_kwh) FILTER (WHERE ${aggregateEligibleQualitySql("source")}) AS usage_kwh,
      COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
      MAX(source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type,
      COUNT(DISTINCT source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type_count,
      COUNT(*) FILTER (
        WHERE source.quality_status = 'ok' AND source.day_type IS NULL
      ) AS day_type_null_count
    FROM ${quoteIdentifier(viewName)} source
    JOIN (VALUES ${series.flatMap((definition) => definition.meterNodeIds.map((meterNodeId) => `(
      ${definition.seriesOrder},
      ${sqlLiteral(definition.seriesId)},
      ${sqlLiteral(meterNodeId)}
    )`)).join(", ")}) AS routes(series_order, series_id, meter_node_id)
      ON routes.meter_node_id = source.meter_node_id
    GROUP BY
      routes.series_order,
      routes.series_id,
      CAST(source.local_interval_start AS DATE),
      source.local_hour
  ) time_cells ON time_cells.series_order = series_definitions.series_order
  GROUP BY series_definitions.series_order, series_definitions.series_id
  ORDER BY series_definitions.series_order
`;

const timeBucketGridSql = (
  viewName: string,
  scopes: DailyTotalScope[],
): string => `
  SELECT
    scope_definitions.scope_id,
    scope_definitions.scope_name,
    scope_definitions.scope_type,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      local_date := time_cells.local_date,
      local_hour := time_cells.local_hour,
      usage_kwh := time_cells.usage_kwh,
      valid_interval_count := time_cells.valid_interval_count,
      quality_event_count := time_cells.quality_event_count,
      day_type := time_cells.day_type,
      day_type_count := time_cells.day_type_count,
      day_type_null_count := time_cells.day_type_null_count
    ) ORDER BY time_cells.local_date, time_cells.local_hour) FILTER (
      WHERE time_cells.local_date IS NOT NULL
    )), '[]') AS cells_json,
    scope_definitions.scope_order
  FROM (VALUES ${scopes.map((scope, index) => `(
    ${index},
    ${sqlLiteral(scope.scopeId)},
    ${sqlLiteral(scope.scopeName)},
    ${sqlLiteral(scope.scopeType)}
  )`).join(", ")}) AS scope_definitions(
    scope_order,
    scope_id,
    scope_name,
    scope_type
  )
  LEFT JOIN (
    SELECT
      routes.scope_order,
      routes.scope_id,
      routes.scope_name,
      routes.scope_type,
      STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      source.local_hour,
      SUM(source.usage_kwh) FILTER (WHERE ${aggregateEligibleQualitySql("source")}) AS usage_kwh,
      COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
      MAX(source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type,
      COUNT(DISTINCT source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type_count,
      COUNT(*) FILTER (
        WHERE source.quality_status = 'ok' AND source.day_type IS NULL
      ) AS day_type_null_count
    FROM ${quoteIdentifier(viewName)} source
    JOIN (VALUES ${scopes.flatMap((scope, index) => scope.meterNodeIds.map((meterNodeId) => `(
      ${index},
      ${sqlLiteral(scope.scopeId)},
      ${sqlLiteral(scope.scopeName)},
      ${sqlLiteral(scope.scopeType)},
      ${sqlLiteral(meterNodeId)}
    )`)).join(", ")}) AS routes(
      scope_order,
      scope_id,
      scope_name,
      scope_type,
      meter_node_id
    ) ON routes.meter_node_id = source.meter_node_id
    GROUP BY
      routes.scope_order,
      routes.scope_id,
      routes.scope_name,
      routes.scope_type,
      CAST(source.local_interval_start AS DATE),
      source.local_hour
  ) time_cells
    ON time_cells.scope_order = scope_definitions.scope_order
  GROUP BY
    scope_definitions.scope_order,
    scope_definitions.scope_id,
    scope_definitions.scope_name,
    scope_definitions.scope_type
  ORDER BY scope_definitions.scope_order
`;

const componentHourlyProfilesSql = (
  viewName: string,
  series: ComponentHourlyCircuitSeries[],
): string => `
  SELECT
    series_definitions.meter_node_id,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      local_date := time_cells.local_date,
      local_hour := time_cells.local_hour,
      usage_kwh := time_cells.usage_kwh,
      valid_interval_count := time_cells.valid_interval_count,
      quality_event_count := time_cells.quality_event_count,
      day_type := time_cells.day_type,
      day_type_count := time_cells.day_type_count,
      day_type_null_count := time_cells.day_type_null_count
    ) ORDER BY time_cells.local_date, time_cells.local_hour) FILTER (
      WHERE time_cells.local_date IS NOT NULL
    )), '[]') AS cells_json,
    series_definitions.series_order
  FROM (VALUES ${series.map((definition) => `(
    ${definition.seriesOrder},
    ${sqlLiteral(definition.meterNodeId)}
  )`).join(", ")}) AS series_definitions(series_order, meter_node_id)
  LEFT JOIN (
    SELECT
      routes.series_order,
      routes.meter_node_id,
      STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      source.local_hour,
      SUM(source.usage_kwh) FILTER (WHERE source.quality_status = 'ok') AS usage_kwh,
      COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
      MAX(source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type,
      COUNT(DISTINCT source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type_count,
      COUNT(*) FILTER (
        WHERE source.quality_status = 'ok' AND source.day_type IS NULL
      ) AS day_type_null_count
    FROM ${quoteIdentifier(viewName)} source
    JOIN (VALUES ${series.map((definition) => `(
      ${definition.seriesOrder},
      ${sqlLiteral(definition.meterNodeId)}
    )`).join(", ")}) AS routes(series_order, meter_node_id)
      ON routes.meter_node_id = source.meter_node_id
    GROUP BY
      routes.series_order,
      routes.meter_node_id,
      CAST(source.local_interval_start AS DATE),
      source.local_hour
  ) time_cells ON time_cells.series_order = series_definitions.series_order
  GROUP BY series_definitions.series_order, series_definitions.meter_node_id
  ORDER BY series_definitions.series_order
`;

const peakBreakdownSql = (viewName: string, peakAt?: string): string => `
  SELECT
    source.meter_node_id,
    EPOCH_MS(source.interval_start) AS interval_start_ms,
    EPOCH_MS(source.interval_end) AS interval_end_ms,
    source.elapsed_minutes,
    source.average_kw,
    source.quality_status
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${peakAt
    ? `source.interval_start = CAST(${sqlLiteral(peakAt)} AS TIMESTAMPTZ)`
    : "FALSE"}
  ORDER BY source.meter_node_id, source.interval_end, source.quality_status
`;

const scopeHealthSql = (viewName: string, meterNodeIds: string[]): string => {
  const acceptedCumulativeReading = `
    source.quality_status = 'ok'
    AND source.source_reading_kind = 'cumulative_energy'
    AND source.active_energy_kwh IS NOT NULL
    AND source.usage_kwh IS NOT NULL
    AND source.source_file IS NOT NULL
    AND TRIM(source.source_file) <> ''
    AND source.source_sha256 IS NOT NULL
    AND TRIM(source.source_sha256) <> ''
  `;
  const latestReadingOrder = `STRUCT_PACK(
    recorded_at := source.interval_end,
    meter_node_id := source.meter_node_id
  )`;
  return `
  SELECT
    COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
    COALESCE(MEDIAN(source.elapsed_minutes) FILTER (
      WHERE source.quality_status = 'ok' AND source.elapsed_minutes > 0
    ), 15) AS interval_minutes,
    MAX(source.interval_end) FILTER (WHERE source.quality_status = 'ok') AS last_seen_at,
    COALESCE(STRING_AGG(
      DISTINCT COALESCE(source.import_batch_id, '<legacy>'),
      ','
    ) FILTER (WHERE source.quality_status = 'ok'), '') AS import_batch_ids,
    COUNT(*) FILTER (
      WHERE source.source_reading_kind = 'cumulative_energy'
        AND source.quality_status = 'ok'
        AND ABS((source.active_energy_kwh - source.previous_active_energy_kwh) - source.raw_delta_kwh) > 0.000001
    ) AS cumulative_delta_mismatch_count,
    COUNT(*) FILTER (
      WHERE source.quality_status = 'ok'
        AND source.elapsed_minutes > 0
        AND ABS(source.average_kw - source.usage_kwh * 60 / source.elapsed_minutes) > 0.000001
    ) AS average_kw_mismatch_count,
    COUNT(*) FILTER (
      WHERE source.quality_status = 'ok' AND source.elapsed_minutes <> 15
    ) AS invalid_interval_duration_count,
    ARG_MAX(source.active_energy_kwh, ${latestReadingOrder}) FILTER (
      WHERE ${acceptedCumulativeReading}
    ) AS latest_active_energy_kwh,
    EPOCH_MS(ARG_MAX(source.interval_end, ${latestReadingOrder}) FILTER (
      WHERE ${acceptedCumulativeReading}
    )) AS latest_recorded_at_ms,
    ARG_MAX(source.meter_node_id, ${latestReadingOrder}) FILTER (
      WHERE ${acceptedCumulativeReading}
    ) AS latest_meter_node_id,
    ARG_MAX(source.source_file, ${latestReadingOrder}) FILTER (
      WHERE ${acceptedCumulativeReading}
    ) AS latest_source_file,
    ARG_MAX(source.source_sha256, ${latestReadingOrder}) FILTER (
      WHERE ${acceptedCumulativeReading}
    ) AS latest_source_sha256,
    ARG_MAX(source.source_reading_kind, ${latestReadingOrder}) FILTER (
      WHERE ${acceptedCumulativeReading}
    ) AS latest_source_reading_kind,
    COUNT(*) FILTER (
      WHERE source.quality_status = 'ok'
        AND source.source_reading_kind = 'interval_usage'
    ) AS accepted_interval_usage_count
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(meterNodeIds)}
  `;
};

const goldenPeriodSelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  periodDays: number,
  timezone: string
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_from,
    STRFTIME(local_date + INTERVAL ${periodDays} DAY, '%Y-%m-%d') AS local_to_exclusive,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL ${periodDays} DAY AS TIMESTAMP)
    )) AS to_ms,
    interval_minutes
  FROM (
    SELECT
      daily_windows.*,
      LEAD(local_date, ${periodDays - 1}) OVER (ORDER BY local_date) AS current_end_date,
      LAG(local_date, ${periodDays}) OVER (ORDER BY local_date) AS previous_start_date,
      COUNT(*) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_day_count,
      COUNT(*) OVER (
        ORDER BY local_date ROWS BETWEEN ${periodDays} PRECEDING AND 1 PRECEDING
      ) AS previous_day_count,
      SUM(valid_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_valid_count,
      SUM(expected_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_expected_count,
      SUM(quality_event_count) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_quality_count,
      SUM(valid_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN ${periodDays} PRECEDING AND 1 PRECEDING
      ) AS previous_valid_count,
      SUM(expected_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN ${periodDays} PRECEDING AND 1 PRECEDING
      ) AS previous_expected_count
    FROM (
      SELECT
        local_date,
        COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
        COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
        COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15) AS interval_minutes,
        ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15)) AS expected_interval_count
      FROM ${quoteIdentifier(viewName)} source
      WHERE ${meterNodeFilter(meterNodeIds)}
      GROUP BY local_date
    ) daily_windows
  ) candidates
  WHERE current_day_count = ${periodDays}
    AND previous_day_count = ${periodDays}
    AND DATE_DIFF('day', local_date, current_end_date) = ${periodDays - 1}
    AND DATE_DIFF('day', previous_start_date, local_date) = ${periodDays}
  ORDER BY
    current_valid_count / NULLIF(current_expected_count, 0) DESC,
    previous_valid_count / NULLIF(previous_expected_count, 0) DESC,
    current_quality_count ASC,
    local_date DESC
  LIMIT 1
`;

const latestCompletePeriodSelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  periodDays: number,
  timezone: string,
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_from,
    STRFTIME(local_date + INTERVAL ${periodDays} DAY, '%Y-%m-%d') AS local_to_exclusive,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL ${periodDays} DAY AS TIMESTAMP)
    )) AS to_ms,
    interval_minutes
  FROM (
    SELECT
      daily_windows.*,
      LEAD(local_date, ${periodDays - 1}) OVER (ORDER BY local_date) AS current_end_date,
      COUNT(*) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_day_count,
      SUM(CASE
        WHEN valid_interval_count = expected_interval_count AND quality_event_count = 0 THEN 1
        ELSE 0
      END) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS complete_day_count
    FROM (
      SELECT
        local_date,
        COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
        COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
        COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15) AS interval_minutes,
        ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15)) AS expected_interval_count
      FROM ${quoteIdentifier(viewName)} source
      WHERE ${meterNodeFilter(meterNodeIds)}
      GROUP BY local_date
    ) daily_windows
  ) candidates
  WHERE current_day_count = ${periodDays}
    AND DATE_DIFF('day', local_date, current_end_date) = ${periodDays - 1}
    AND complete_day_count = ${periodDays}
  ORDER BY local_date DESC
  LIMIT 1
`;

const latestAvailableDaySelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  timezone: string,
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_from,
    STRFTIME(local_date + INTERVAL 1 DAY, '%Y-%m-%d') AS local_to_exclusive,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date + INTERVAL 1 DAY AS TIMESTAMP))) AS to_ms,
    COALESCE(MEDIAN(elapsed_minutes) FILTER (
      WHERE quality_status = 'ok' AND elapsed_minutes > 0
    ), 15) AS interval_minutes
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(meterNodeIds)}
  GROUP BY local_date
  HAVING COUNT(*) FILTER (WHERE quality_status = 'ok') > 0
  ORDER BY local_date DESC
  LIMIT 1
`;

const currentOverviewPeriodSelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  periodBasis: EnergyCurrentOverviewPeriodBasis,
  timezone: string,
): string => {
  const rollingDays = periodBasis === "rolling_7_days" ? 7 : CURRENT_OVERVIEW_PERIOD_DAYS;
  const localFromExpression = periodBasis === "rolling_7_days" || periodBasis === "rolling_28_days"
    ? `local_date - INTERVAL ${rollingDays - 1} DAY`
    : "DATE_TRUNC('month', local_date)";
  const periodDaysExpression = periodBasis === "rolling_7_days" || periodBasis === "rolling_28_days"
    ? String(rollingDays)
    : "DATE_DIFF('day', DATE_TRUNC('month', local_date), local_date) + 1";
  return `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS cutoff_local_date,
    STRFTIME(${localFromExpression}, '%Y-%m-%d') AS local_from,
    STRFTIME(local_date + INTERVAL 1 DAY, '%Y-%m-%d') AS local_to_exclusive,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(${localFromExpression} AS TIMESTAMP)
    )) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL 1 DAY AS TIMESTAMP)
    )) AS to_ms,
    interval_minutes,
    ${periodDaysExpression} AS period_days
  FROM (
    SELECT
      local_date,
      COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
      COALESCE(MEDIAN(elapsed_minutes) FILTER (
        WHERE quality_status = 'ok' AND elapsed_minutes > 0
      ), 15) AS interval_minutes,
      ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
        WHERE quality_status = 'ok' AND elapsed_minutes > 0
      ), 15)) AS expected_interval_count
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
    GROUP BY local_date
  ) candidate_days
  WHERE valid_interval_count = expected_interval_count
    AND quality_event_count = 0
  ORDER BY local_date DESC
  LIMIT 1
`;
};

const goldenDaySelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  localFrom: string,
  localToExclusive: string,
  timezone: string
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_date,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL 1 DAY AS TIMESTAMP)
    )) AS to_ms
  FROM (
    SELECT
      local_date,
      COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
      ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
        WHERE quality_status = 'ok' AND elapsed_minutes > 0
      ), 15)) AS expected_interval_count
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
      AND local_date >= CAST(${sqlLiteral(localFrom)} AS DATE)
      AND local_date < CAST(${sqlLiteral(localToExclusive)} AS DATE)
    GROUP BY local_date
  ) candidate_days
  ORDER BY
    valid_interval_count / NULLIF(expected_interval_count, 0) DESC,
    quality_event_count ASC,
    local_date DESC
  LIMIT 1
`;

const meterBreakdownSql = (viewName: string): string => `
  SELECT
    meter_node_id,
    MAX(scope_id) AS scope_id,
    MAX(device_name) AS device_name,
    MAX(appliance) AS appliance,
    MAX(category) AS category,
    MAX(meter_role) AS meter_role,
    COALESCE(SUM(usage_kwh) FILTER (WHERE ${aggregateEligibleQualitySql()}), 0) AS usage_kwh,
    COALESCE(MAX(average_kw) FILTER (WHERE quality_status = 'ok'), 0) AS peak_kw,
    COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
  FROM ${quoteIdentifier(viewName)}
  GROUP BY meter_node_id
  ORDER BY meter_node_id
`;

const previousMeterUsageSql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    meter_node_id,
    COALESCE(SUM(usage_kwh) FILTER (WHERE ${aggregateEligibleQualitySql()}), 0) AS usage_kwh
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(meterNodeIds)}
  GROUP BY meter_node_id
  ORDER BY meter_node_id
`;

const operationalPolicyMeterIntervalsSql = (
  viewName: string,
  meterNodeIds: string[],
): string => `
  SELECT
    'meter' AS series_kind,
    meter_node_id,
    MAX(scope_id) AS scope_id,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      from_ms := EPOCH_MS(interval_start),
      to_ms := EPOCH_MS(interval_end),
      usage_kwh := usage_kwh
    ) ORDER BY interval_start, interval_end)), '[]') AS intervals_json
  FROM (
    SELECT
      meter_node_id,
      MAX(scope_id) AS scope_id,
      interval_start,
      interval_end,
      SUM(usage_kwh) AS usage_kwh
    FROM ${quoteIdentifier(viewName)} source
    WHERE quality_status = 'ok'
      AND ${meterNodeFilter(meterNodeIds)}
    GROUP BY meter_node_id, interval_start, interval_end
  ) meter_intervals
  GROUP BY meter_node_id
  ORDER BY meter_node_id
`;

const aggregationRuleForMeters = (
  meters: MeterAggregate[]
): EnergyScopeAnalysis["provenance"]["aggregationRule"] => {
  return aggregationRuleForRoles(meters.map((meter) => meter.meterRole));
};

const aggregationRuleForRoles = (
  roles: string[]
): EnergyScopeAnalysis["provenance"]["aggregationRule"] => {
  if (roles.some((role) => role === "total")) return "designated_total";
  if (roles.some((role) => role === "component")) return "component";
  if (roles.some((role) => role === "submeter")) return "submeter";
  return "none";
};

const meterNodeFilter = (meterNodeIds: string[]): string =>
  meterNodeIds.length > 0
    ? `source.meter_node_id IN (${meterNodeIds.map(sqlLiteral).join(", ")})`
    : "FALSE";

const aggregateEligibleQualitySql = (tableAlias?: string): string =>
  `${tableAlias ? `${tableAlias}.` : ""}quality_status IN ('ok', 'gap')`;

const numberAt = (row: unknown[], index: number): number => {
  const value = Number(row[index] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const optionalNumberAt = (row: unknown[], index: number): number | null => {
  const value = row[index];
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const stringAt = (row: unknown[], index: number): string =>
  typeof row[index] === "string" ? row[index] : String(row[index] ?? "");

const optionalStringAt = (row: unknown[], index: number): string | undefined => {
  const value = row[index];
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
};

const isoAt = (row: unknown[], index: number): string => {
  const value = row[index];
  if (typeof value === "number" || typeof value === "bigint") {
    return new Date(Number(value)).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  throw new Error(`ENERGYIQ_GOLDEN_TIMESTAMP_INVALID:${index}`);
};

const optionalIsoAt = (row: unknown[], index: number): string | undefined => {
  if (row[index] === null || row[index] === undefined || row[index] === "") return undefined;
  return isoAt(row, index);
};

const percent = (part: number, total: number, digits = 2): number =>
  total > 0 ? round((part / total) * 100, digits) : 0;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const maxBy = <T>(values: T[], score: (value: T) => number): T | undefined => {
  let best: T | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const current = score(value);
    if (current > bestScore) {
      best = value;
      bestScore = current;
    }
  }
  return best;
};

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

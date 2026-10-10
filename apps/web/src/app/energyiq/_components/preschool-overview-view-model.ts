import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { currencyMark } from "./money";

export type PreschoolOverviewCentre = {
  id: string;
  rank: number;
  name: string;
  usageKwh: string;
  usageKwhValue: number;
  sharePct: string;
  sharePctValue: number;
  eui: string | null;
  perPax: string | null;
  cohort: string | null;
  quadrant: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity" | null;
  metadataStatus: "confirmed" | "provisional" | "missing";
  topCircuit: string | null;
};

export type PreschoolDecisionSummaryItem = {
  id: "after-hours" | "efficiency" | "operating" | "planning";
  sectionId: "overall-summary" | "centre-benchmark" | "operating-behaviour" | "appliance-contribution" | "planning-outlook";
  priority: 1 | 2 | 3 | null;
  sectionNumber: 2 | 3 | 4 | 5;
  targetId: "preschool-benchmark-analysis" | "preschool-standby-wastage" | "preschool-operating-hours" | "preschool-monthly-outlook";
  label: string;
  primaryMetric: {
    label: string;
    value: number;
    valueLabel: string;
  };
  supportingMetrics: Array<{ label: string; valueLabel: string }>;
  centreCodes: string[];
  limitation: string;
  evidenceRefs: string[];
};

export type PreschoolBenchmarkDistribution = {
  id: "eui" | "per-pax";
  label: string;
  question: string;
  unit: string;
  axis: { min: 0; max: number };
  cohorts: Array<{
    name: string;
    sampleSize: number;
    p50: string;
    p75: string;
    p50Value: number;
    p75Value: number;
    points: Array<{
      centreCode: string;
      name: string;
      value: number;
      valueLabel: string;
      aboveP75: boolean;
      priority: boolean;
    }>;
  }>;
  ranking: Array<{
    rank: number;
    centreCode: string;
    name: string;
    cohort: string;
    value: number;
    valueLabel: string;
    p75: string;
    p75Value: number;
    aboveP75: boolean;
    priority: boolean;
  }>;
};

export type PreschoolOverviewViewModel = {
  context: {
    projectName: string;
    scopeName: string;
    period: string;
    analysisWindowLabel: string;
    timezone: string;
  };
  dataStatus: {
    status: "complete" | "partial" | "unavailable";
    label: string;
    coverage: string;
    intervals: string;
    qualityEvents: string;
  };
  overallSummary: {
    periodLabel: string;
    monthComparison: {
      currentLabel: string;
      referenceLabel: string;
      currentEnergy: string;
      referenceEnergy: string;
      totalChange: string;
      totalChangePct: string;
      averageDailyChangePct: string;
      evidence: {
        dataSnapshotId: string;
        queryId: "daily_totals_v1";
      };
    } | null;
    metrics: Array<{
      id: "centres" | "energy" | "cost";
      label: string;
      value: string;
      available: boolean;
    }>;
    centreTypes: Array<{
      centreType: string;
      centreCount: number;
      energy: string;
      estimatedCost: string;
      share: string;
    }>;
    total: {
      centreCount: number;
      energy: string;
      estimatedCost: string;
      share: string;
    };
    costAssumption: {
      rate: string;
      label: string;
      sourceUrl: string | null;
    } | null;
  };
  decisionSummary: {
    items: PreschoolDecisionSummaryItem[];
    detail: string;
  };
  planningOutlook: {
    status: "provisional";
    targetPeriod: string;
    method: string;
    sourceWeeks: Array<{
      label: string;
      usageKwh: number;
      usage: string;
    }>;
    weeklyAverageKwh: number;
    weeklyAverage: string;
    projectedUsage: string;
    projectedRange: string;
    currentPeriodCost: string;
    projectedCost: string;
    projectedCostRange: string;
    tariffRate: string;
    tariffLabel: string;
    tariffSourceUrl: string | null;
    tariffAppendixUrl: string | null;
    evidenceLabel: string;
    limitations: string[];
    actual: {
      status: "partial" | "complete";
      statusLabel: "Partial actual" | "Complete actual";
      usage: string;
      coverage: string;
      variance: string;
      varianceStatus: "withheld" | "available";
      planEvidence: string;
      actualEvidence: string;
    } | null;
  } | {
    status: "unavailable";
    detail: string;
  };
  liveForecast: {
    status: "unavailable";
    label: "Unavailable";
    detail: string;
  };
  forecast: {
    status: "waiting" | "partial" | "complete";
    comparisonStatus: "frozen-original" | "planning-baseline";
    statusLabel: string;
    statusDetail: string;
    targetMonth: string;
    targetPeriod: string;
    defaultScopeId: string;
    centreSelectionAvailable: boolean;
    tariff: {
      status: "effective" | "provisional" | "unavailable";
      rate: string;
      label: string;
      effectiveRange: string;
      sourceUrl: string | null;
      note: string;
      costBasisNote: string;
    };
    scopes: Array<{
      scopeId: string;
      label: string;
      scopeType: string;
      role: "portfolio" | "centre";
      status: "waiting" | "partial" | "complete";
      statusLabel: string;
      statusDetail: string;
      actualThrough: string;
      expectedFullMonthEnergy: string;
      expectedFullMonthCost: string;
      consumedSoFar: string;
      consumedCostSoFar: string;
      paceVsOriginalEstimate: string;
      paceDetail: string;
      coverage: string;
      outcome: "on_plan" | "above_plan" | "below_plan" | null;
      buckets: Record<"daily" | "weekly" | "monthly", Array<{
        label: string;
        start: string;
        endExclusive: string;
        originalEstimateKwh: number | null;
        originalEstimate: string;
        planningBaselineKwh: number | null;
        planningBaseline: string;
        actualKwh: number | null;
        actual: string;
        currentOutlookKwh: number | null;
        currentOutlook: string;
        actualStatus: "waiting" | "partial" | "complete";
        coverage: string;
      }>>;
    }>;
    method: string;
    planEvidence: string;
    actualEvidence: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  centres: PreschoolOverviewCentre[];
  normalisation: {
    euiAvailableCount: number;
    perPaxAvailableCount: number;
    totalCentreCount: number;
    status: "confirmed" | "provisional" | "missing";
  };
  benchmark: {
    status: "provisional";
    sampleSize: number;
    eui: { p50: string; p75: string };
    perPax: { p50: string; p75: string };
    cohorts: Array<{
      name: string;
      sampleSize: number;
      euiP50: string;
      euiP75: string;
      perPaxP50: string;
      perPaxP75: string;
    }>;
    quadrants: Array<{
      id: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity";
      label: string;
      centreCodes: string[];
    }>;
    priorityCentreCodes: string[];
    priorityCentres: Array<{
      rank: number;
      centreCode: string;
      name: string;
      cohort: string;
      eui: string;
      perPax: string;
    }>;
    distributions: PreschoolBenchmarkDistribution[];
    scatter: {
      euiP75: number;
      perPaxP75: number;
      points: Array<{
        centreCode: string;
        name: string;
        cohort: string;
        eui: number;
        perPax: number;
        quadrant: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity";
        priority: boolean;
        actionRank: number | null;
      }>;
    };
    detail: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  appliances: {
    status: "available";
    totalEnergy: string;
    rows: Array<{
      name: string;
      applianceGroup: string;
      usageKwh: number;
      energy: string;
      sharePct: number;
      share: string;
      centreCount: number;
      relativeToTopPct: number;
    }>;
    detail: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  operational: {
    status: "available";
    coverage: string;
    hourlyProfile: {
      completeDayCount: number;
      unit: string;
      peakHourLabel: string;
      rows: Array<{
        hour: number;
        label: string;
        operatingKwh: number;
        closedHourKwh: number;
        totalKwh: number;
      }>;
    };
    standby: {
      energy: string;
      provisionalCost: string;
      provisionalCostNote: string;
      share: string;
      spikeCount: number;
      centreCount: number;
      centres: PreschoolOperationalCentre[];
      applianceGroups: Array<{
        name: string;
        energy: string;
        share: string;
        sharePct: number;
        provisionalCost: string;
        sourceAliases: string[];
      }>;
      appliances: Array<{
        name: string;
        applianceGroup: string;
        energy: string;
        share: string;
        sharePct: number;
        provisionalCost: string;
        centreCount: number;
      }>;
      reconciliation: string;
    };
    operating: {
      energy: string;
      provisionalCost: string;
      provisionalCostNote: string;
      share: string;
      spikeCount: number;
      centreCount: number;
      centres: PreschoolOperationalCentre[];
      applianceGroups: Array<{
        name: string;
        energy: string;
        share: string;
        sharePct: number;
        provisionalCost: string;
        sourceAliases: string[];
      }>;
      appliances: Array<{
        name: string;
        applianceGroup: string;
        energy: string;
        share: string;
        sharePct: number;
        provisionalCost: string;
        centreCount: number;
      }>;
      reconciliation: string;
    };
    sop: {
      label: "After-hours Review Priority";
      sourceLabel: "Provisional after-hours SOP signal";
      detail: string;
      breachingCentreCodes: string[];
      centres: Array<{
        centreCode: string;
        name: string;
        centreType: string | null;
        standbySpikeCount: number;
        score: string;
        worstWhen: string;
        worstVariance: string;
        leadingContributor: string;
      }>;
    };
    calendarVersion: string;
    threshold: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    queryIds: string[];
    referenceCount: number;
    importBatchCount: number;
    benchmarkRecipeIds: string[];
    applianceRecipeIds: string[];
    operationalRecipeIds: string[];
    planningRecipeIds: string[];
  };
};

export type PreschoolOperationalCentre = {
  scopeId: string;
  centreCode: string;
  name: string;
  centreType: string | null;
  spikeCount: number;
  worst: {
    when: string;
    dayType: "Weekday" | "Weekend" | "Calendar exception" | "Unavailable";
    usage: string;
    baseline: string;
    variance: string;
    leadingCircuit: string;
  };
  events: Array<{
    when: string;
    dayType: "Weekday" | "Weekend" | "Calendar exception" | "Unavailable";
    usage: string;
    baseline: string;
    impact: string;
    variance: string;
    leadingCircuit: string;
  }>;
};

export function buildPreschoolOverviewViewModel(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel {
  if (snapshot.renderer.key !== "preschool-overview") {
    throw new Error("PRESCHOOL_OVERVIEW_RENDERER_MISMATCH");
  }

  const { analysis } = snapshot;
  const benchmarkCentreByScopeId = new Map(
    snapshot.preschoolBenchmark?.centres.map((centre) => [centre.scopeId, centre]) ?? [],
  );
  const centres = analysis.childScopes.map((centre, index) => {
    const benchmarkCentre = benchmarkCentreByScopeId.get(centre.nodeId);
    return {
      id: centre.nodeId,
      rank: index + 1,
      name: centre.name,
      usageKwh: formatNumber(centre.usageKwh, 2),
      usageKwhValue: centre.usageKwh,
      sharePct: `${formatNumber(centre.sharePct, 1)}%`,
      sharePctValue: centre.sharePct,
      eui: benchmarkCentre
        ? `${formatNumber(benchmarkCentre.annualisedEuiKwhPerSqmYear, 2)} kWh/m²/yr`
        : null,
      perPax: benchmarkCentre
        ? `${formatNumber(benchmarkCentre.mayKwhPerPerson, 1)} kWh/person`
        : null,
      cohort: benchmarkCentre?.cohort ?? null,
      quadrant: benchmarkCentre?.quadrant ?? null,
      metadataStatus: centre.metadata.status,
      topCircuit: toCustomerCircuitName(centre.nodeId, centre.topCircuitName),
    } satisfies PreschoolOverviewCentre;
  });
  const euiAvailableCount = centres.filter((centre) => centre.eui !== null).length;
  const perPaxAvailableCount = centres.filter((centre) => centre.perPax !== null).length;
  const metadataStatus = euiAvailableCount === 0 && perPaxAvailableCount === 0
    ? "missing"
    : centres.some((centre) => centre.metadataStatus === "provisional")
      ? "provisional"
      : "confirmed";
  const queryIds = [...new Set(snapshot.evidence.flatMap((item) => item.queryIds))];
  const decisionSummary = buildPreschoolDecisionSummary(snapshot);
  const benchmark = buildPreschoolBenchmarkView(snapshot);
  // Historical v2-v4 Saved Analysis remains readable while new Release-pinned Tariff projections use v5.
  // Every supported version still requires the additive operating-state Appliance evidence introduced by A4.
  const operationalContractVersion = snapshot.preschoolOperational?.status === "available"
    ? Reflect.get(snapshot.preschoolOperational.contract, "version")
    : null;
  const hasCurrentOperationalContract = snapshot.preschoolOperational?.status === "available"
    && (operationalContractVersion === "2"
      || operationalContractVersion === "3"
      || operationalContractVersion === "4"
      || operationalContractVersion === "5")
    && Reflect.get(snapshot.preschoolOperational, "operatingAppliances") !== undefined;
  const periodLabel = formatAnalysisWindowLabel(
    snapshot.context.from,
    snapshot.context.to,
    snapshot.context.timezone,
  );
  const planningReference = resolvePlanningReference(snapshot);
  const planningLifecycle = snapshot.preschoolPlanningLifecycle?.status === "available"
    ? snapshot.preschoolPlanningLifecycle
    : null;
  const operationalTariffReference = snapshot.preschoolOperational?.status === "available"
    ? snapshot.preschoolOperational.tariffReference ?? null
    : null;
  const operationalTariffCost = snapshot.preschoolOperational?.status === "available"
    && snapshot.preschoolOperational.tariffCost?.status === "available"
    ? snapshot.preschoolOperational.tariffCost
    : null;
  const operationalCostLabel = (
    cost: { currency: string; amount: number } | undefined,
    legacyValue: number | null,
  ): string => cost
    ? `${currencySymbol(cost.currency)}${formatNumber(cost.amount, 2)}`
    : operationalTariffReference && legacyValue !== null
      ? `S$${formatNumber(legacyValue, 2)}`
      : "Unavailable";
  const operationalCostNote = operationalTariffCost
    ? operationalTariffCost.allocations.length === 1
      ? `Release-pinned Tariff ${operationalTariffCost.tariffScheduleVersion} · ${formatNumber(operationalTariffCost.allocations[0]!.ratePerKwh, 4)} ${operationalTariffCost.currency}/kWh · estimate only, not a bill`
      : `Release-pinned Tariff ${operationalTariffCost.tariffScheduleVersion} · ${operationalTariffCost.allocations.length} effective rate periods applied · estimate only, not a bill`
    : operationalTariffReference
      ? `${operationalTariffReference.sourceName} ${formatNumber(operationalTariffReference.beforeGstSgdPerKwh, 4)} SGD/kWh before GST reference · historical estimate only, not a bill`
      : "No Release-pinned Tariff covers the full analysis period; energy remains available and cost is withheld.";
  const provisionalRate = analysis.cost.status === "available" && analysis.summary.usageKwh > 0
    ? analysis.cost.amount / analysis.summary.usageKwh
    : planningReference?.tariffReference?.beforeGstSgdPerKwh ?? null;
  const estimatedCost = analysis.cost.status === "available"
    ? `${currencySymbol(analysis.cost.currency)}${formatNumber(analysis.cost.amount, 2)}`
    : planningReference?.costEstimate
      ? `S$${formatNumber(planningReference.costEstimate.currentPeriodBeforeGstSgd, 2)}`
      : "Unavailable";
  const centreTypeOrder = ["Senior Care Center", "Active Aging Center", "Preschool"];
  const centreTypes = centreTypeOrder.flatMap((centreType) => {
    const rows = centres.filter((centre) => centre.cohort === centreType);
    if (rows.length === 0) return [];
    const usageKwh = rows.reduce((sum, centre) => sum + centre.usageKwhValue, 0);
    return [{
      centreType,
      centreCount: rows.length,
      energy: `${formatNumber(usageKwh, 2)} kWh`,
      estimatedCost: provisionalRate === null
        ? "Unavailable"
        : `S$${formatNumber(usageKwh * provisionalRate, 2)}`,
      share: `${formatNumber((usageKwh / analysis.summary.usageKwh) * 100, 1)}%`,
    }];
  });
  const monthComparison = buildPreschoolMonthComparison(snapshot);

  return {
    context: {
      projectName: snapshot.context.projectName,
      scopeName: snapshot.context.scopeName,
      period: formatPeriod(snapshot.context.from, snapshot.context.to, snapshot.context.timezone),
      analysisWindowLabel: formatAnalysisWindowKind(
        snapshot.context.from,
        snapshot.context.to,
        snapshot.context.timezone,
      ),
      timezone: snapshot.context.timezone,
    },
    dataStatus: {
      status: snapshot.dataQuality.status,
      label: snapshot.dataQuality.status === "complete"
        ? "Complete data"
        : snapshot.dataQuality.status === "partial"
          ? "Partial data"
          : "Data unavailable",
      coverage: `${formatNumber(snapshot.dataQuality.coveragePct, 1)}% coverage`,
      intervals: `${formatNumber(snapshot.dataQuality.validIntervalCount, 0)} / ${formatNumber(snapshot.dataQuality.expectedMeterIntervalCount, 0)} intervals`,
      qualityEvents: `${formatNumber(snapshot.dataQuality.qualityEventCount, 0)} quality events`,
    },
    overallSummary: {
      periodLabel,
      monthComparison,
      metrics: [
        {
          id: "centres",
          label: "Total centres",
          value: formatNumber(centres.length, 0),
          available: centres.length > 0,
        },
        {
          id: "energy",
          label: `Total energy · ${periodLabel}`,
          value: `${formatNumber(analysis.summary.usageKwh, 2)} kWh`,
          available: true,
        },
        {
          id: "cost",
          label: `Estimated total cost · ${periodLabel}`,
          value: estimatedCost,
          available: estimatedCost !== "Unavailable",
        },
      ],
      centreTypes,
      total: {
        centreCount: centres.length,
        energy: `${formatNumber(analysis.summary.usageKwh, 2)} kWh`,
        estimatedCost,
        share: analysis.summary.usageKwh > 0 ? "100.0%" : "Unavailable",
      },
      costAssumption: analysis.cost.status === "available"
        ? {
            rate: analysis.cost.allocations.length === 1
              ? `${currencySymbol(analysis.cost.currency)}${formatNumber(analysis.cost.allocations[0]!.ratePerKwh, 4)}/kWh`
              : `${analysis.cost.allocations.length} effective rate periods`,
            label: `Release-pinned Tariff ${analysis.cost.tariffScheduleVersion}`,
            sourceUrl: null,
          }
        : planningReference?.tariffReference
        ? {
            rate: `S$${formatNumber(planningReference.tariffReference.beforeGstSgdPerKwh, 4)}/kWh before GST`,
            label: "SP Group Q2 2026 low-tension non-domestic reference",
            sourceUrl: planningReference.tariffReference.sourceUrl,
          }
        : null,
    },
    decisionSummary,
    planningOutlook: planningReference
      ? {
          status: "provisional",
          targetPeriod: formatForecastTargetPeriod(
            planningReference.targetPeriod.start,
            shiftLocalDate(planningReference.targetPeriod.endInclusive, 1),
          ),
          method: "Average of four complete Monday–Sunday weeks from the accepted Snapshot.",
          sourceWeeks: planningReference.sourceWeeks.map((week) => ({
            label: `${formatShortDate(week.start)}–${formatShortDate(week.endInclusive)}`,
            usageKwh: week.usageKwh,
            usage: `${formatNumber(week.usageKwh, 0)} kWh`,
          })),
          weeklyAverageKwh: planningReference.weeklyBaseline.averageKwh,
          weeklyAverage: `${formatNumber(planningReference.weeklyBaseline.averageKwh, 0)} kWh/week`,
          projectedUsage: `${formatNumber(planningReference.usageEstimate.projectedKwh, 0)} kWh`,
          projectedRange: `${formatNumber(planningReference.usageEstimate.lowerKwh, 0)}–${formatNumber(planningReference.usageEstimate.upperKwh, 0)} kWh`,
          currentPeriodCost: analysis.cost.status === "available"
            ? `${currencySymbol(analysis.cost.currency)}${formatNumber(analysis.cost.amount, 0)}`
            : planningReference.tariffReference && planningReference.costEstimate
              ? `S$${formatNumber(planningReference.costEstimate.currentPeriodBeforeGstSgd, 0)}`
              : "Unavailable",
          projectedCost: planningReference.tariffCost?.status === "available"
            ? `${currencySymbol(planningReference.tariffCost.currency)}${formatNumber(planningReference.tariffCost.projectedAmount, 0)}`
            : planningReference.tariffReference && planningReference.costEstimate
              ? `S$${formatNumber(planningReference.costEstimate.projectedBeforeGstSgd, 0)}`
              : "Unavailable",
          projectedCostRange: planningReference.tariffCost?.status === "available"
            ? `${currencySymbol(planningReference.tariffCost.currency)}${formatNumber(planningReference.tariffCost.lowerAmount, 0)}–${currencySymbol(planningReference.tariffCost.currency)}${formatNumber(planningReference.tariffCost.upperAmount, 0)}`
            : planningReference.tariffReference && planningReference.costEstimate
              ? `S$${formatNumber(planningReference.costEstimate.lowerBeforeGstSgd, 0)}–S$${formatNumber(planningReference.costEstimate.upperBeforeGstSgd, 0)}`
              : "Unavailable",
          tariffRate: planningReference.tariffCost?.status === "available"
            ? planningReference.tariffCost.allocations.length === 1
              ? `${formatNumber(planningReference.tariffCost.allocations[0]!.ratePerKwh * 100, 2)}¢/kWh`
              : `${planningReference.tariffCost.allocations.length} effective rate periods`
            : planningReference.tariffReference
              ? `${formatNumber(planningReference.tariffReference.beforeGstSgdPerKwh * 100, 2)}¢/kWh before GST`
              : "Unavailable",
          tariffLabel: planningReference.tariffCost?.status === "available"
            ? `Release-pinned Tariff ${planningReference.tariffCost.tariffScheduleVersion}`
            : planningReference.tariffReference
              ? `${planningReference.tariffReference.sourceName} regulated ${planningReference.tariffReference.supplyClass.toLowerCase()} reference · ${formatTariffEffectiveRange(planningReference.tariffReference.appliesFrom, planningReference.tariffReference.appliesTo)}`
              : "No Release-pinned Tariff is effective for the target period; energy remains available and cost is withheld.",
          tariffSourceUrl: planningReference.tariffCost?.status === "available"
            ? null
            : planningReference.tariffReference?.sourceUrl ?? null,
          tariffAppendixUrl: planningReference.tariffCost?.status === "available"
            ? null
            : planningReference.tariffReference?.appendixUrl ?? null,
          evidenceLabel: `${planningReference.evidence.queryId} · ${planningReference.evidence.recipeId}`,
          limitations: planningReference.limitations,
          actual: planningLifecycle
            ? planningActualView(planningLifecycle)
            : null,
        }
      : {
          status: "unavailable",
          detail: snapshot.preschoolOperational?.status === "available"
            && snapshot.preschoolOperational.planningOutlook.status === "unavailable"
            ? snapshot.preschoolOperational.planningOutlook.reason.message
            : "The next-month Planning Baseline is unavailable because the release-pinned operational projection is unavailable.",
        },
    liveForecast: {
      status: "unavailable",
      label: "Unavailable",
      detail: "A validated live Forecast still requires more history, a published Forecast Recipe and backtesting. The planning baseline above is not an AI forecast.",
    },
    forecast: buildForecastView(snapshot),
    centres,
    normalisation: {
      euiAvailableCount,
      perPaxAvailableCount,
      totalCentreCount: centres.length,
      status: metadataStatus,
    },
    benchmark,
    appliances: snapshot.preschoolAppliances?.status === "available"
      ? {
          status: "available",
          totalEnergy: `${formatNumber(snapshot.preschoolAppliances.totalKwh, 2)} kWh`,
          rows: snapshot.preschoolAppliances.appliances.map((appliance, _index, rows) => ({
            name: appliance.name,
            applianceGroup: appliance.applianceGroup,
            usageKwh: appliance.usageKwh,
            energy: `${formatNumber(appliance.usageKwh, 2)} kWh`,
            sharePct: appliance.sharePct,
            share: `${formatNumber(appliance.sharePct, 1)}%`,
            centreCount: appliance.centreCount,
            relativeToTopPct: rows[0]?.usageKwh
              ? (appliance.usageKwh / rows[0].usageKwh) * 100
              : 0,
          })),
          detail: "Customer Appliance names are project-specific aliases for published Circuit labels; the nine rows reconcile to the all-centres total.",
        }
      : {
          status: "unavailable",
          detail: snapshot.preschoolAppliances?.reason.message
            ?? "The current Snapshot does not contain a server-authoritative Appliance ranking.",
        },
    operational: snapshot.preschoolOperational?.status === "available" && hasCurrentOperationalContract
      ? {
          status: "available",
          coverage: snapshot.preschoolOperational.coverage
            ? snapshot.preschoolOperational.coverage.status === "complete"
              ? `${snapshot.preschoolOperational.coverage.completeLocalDayCount} / ${snapshot.preschoolOperational.coverage.completeLocalDayCount} complete local days`
              : `${snapshot.preschoolOperational.coverage.completeLocalDayCount} complete local days · ${snapshot.preschoolOperational.coverage.partialLocalDayCount} partial day · ${snapshot.preschoolOperational.coverage.missingLocalHourCount} missing whole-portfolio hour`
            : `${snapshot.preschoolOperational.hourlyProfile.completeDayCount} complete local days · historical projection`,
          hourlyProfile: {
            completeDayCount: snapshot.preschoolOperational.hourlyProfile.completeDayCount,
            unit: snapshot.preschoolOperational.hourlyProfile.unit,
            peakHourLabel: formatHourRange(snapshot.preschoolOperational.hourlyProfile.rows
              .reduce((peak, row) => row.totalKwh > peak.totalKwh ? row : peak).localHour),
            rows: snapshot.preschoolOperational.hourlyProfile.rows.map((row) => ({
              hour: row.localHour,
              label: formatHourRange(row.localHour),
              operatingKwh: row.operatingKwh,
              closedHourKwh: row.closedHourKwh,
              totalKwh: row.totalKwh,
            })),
          },
          standby: {
            energy: `${formatNumber(snapshot.preschoolOperational.energy.standbyKwh, 2)} kWh`,
            provisionalCost: operationalCostLabel(
              operationalTariffCost
                ? { currency: operationalTariffCost.currency, amount: operationalTariffCost.standby.amount }
                : undefined,
              snapshot.preschoolOperational.energy.provisionalStandbyCostBeforeGstSgd,
            ),
            provisionalCostNote: operationalCostNote,
            share: `${formatNumber(snapshot.preschoolOperational.energy.standbySharePct, 1)}%`,
            spikeCount: snapshot.preschoolOperational.spikes.standby.count,
            centreCount: snapshot.preschoolOperational.spikes.standby.centreCount,
            centres: snapshot.preschoolOperational.spikes.standby.centres.map(toOperationalCentre),
            applianceGroups: snapshot.preschoolOperational.standbyAppliances.applianceGroups.map((group) => ({
              name: group.name,
              energy: `${formatNumber(group.usageKwh, 2)} kWh`,
              share: `${formatNumber(group.sharePct, 1)}%`,
              sharePct: group.sharePct,
              provisionalCost: operationalCostLabel(group.cost, group.provisionalCostBeforeGstSgd),
              sourceAliases: group.sourceAliases,
            })),
            appliances: snapshot.preschoolOperational.standbyAppliances.appliances.map((appliance) => ({
              name: appliance.name,
              applianceGroup: appliance.applianceGroup,
              energy: `${formatNumber(appliance.usageKwh, 2)} kWh`,
              share: `${formatNumber(appliance.sharePct, 1)}%`,
              sharePct: appliance.sharePct,
              provisionalCost: operationalCostLabel(appliance.cost, appliance.provisionalCostBeforeGstSgd),
              centreCount: appliance.centreCount,
            })),
            reconciliation: `${formatNumber(Math.abs(snapshot.preschoolOperational.standbyAppliances.reconciliationGapKwh), 4)} kWh reconciliation gap`,
          },
          operating: {
            energy: `${formatNumber(snapshot.preschoolOperational.energy.operatingKwh, 2)} kWh`,
            provisionalCost: operationalCostLabel(
              operationalTariffCost
                ? { currency: operationalTariffCost.currency, amount: operationalTariffCost.operating.amount }
                : undefined,
              snapshot.preschoolOperational.energy.provisionalOperatingCostBeforeGstSgd,
            ),
            provisionalCostNote: operationalCostNote,
            share: `${formatNumber(snapshot.preschoolOperational.energy.operatingSharePct, 1)}%`,
            spikeCount: snapshot.preschoolOperational.spikes.operating.count,
            centreCount: snapshot.preschoolOperational.spikes.operating.centreCount,
            centres: snapshot.preschoolOperational.spikes.operating.centres.map(toOperationalCentre),
            applianceGroups: snapshot.preschoolOperational.operatingAppliances.applianceGroups.map((group) => ({
              name: group.name,
              energy: `${formatNumber(group.usageKwh, 2)} kWh`,
              share: `${formatNumber(group.sharePct, 1)}%`,
              sharePct: group.sharePct,
              provisionalCost: operationalCostLabel(group.cost, group.provisionalCostBeforeGstSgd),
              sourceAliases: group.sourceAliases,
            })),
            appliances: snapshot.preschoolOperational.operatingAppliances.appliances.map((appliance) => ({
              name: appliance.name,
              applianceGroup: appliance.applianceGroup,
              energy: `${formatNumber(appliance.usageKwh, 2)} kWh`,
              share: `${formatNumber(appliance.sharePct, 1)}%`,
              sharePct: appliance.sharePct,
              provisionalCost: operationalCostLabel(appliance.cost, appliance.provisionalCostBeforeGstSgd),
              centreCount: appliance.centreCount,
            })),
            reconciliation: `${formatNumber(Math.abs(snapshot.preschoolOperational.operatingAppliances.reconciliationGapKwh), 4)} kWh reconciliation gap`,
          },
          sop: {
            label: "After-hours Review Priority",
            sourceLabel: snapshot.preschoolOperational.sop.label,
            detail: "Provisional review signal only: the score starts at 100 and deducts one point per closed-hour Spike. It does not measure SOP compliance; confirm the Calendar, operating SOP and equipment state on site.",
            breachingCentreCodes: snapshot.preschoolOperational.sop.breachingCentreCodes,
            centres: snapshot.preschoolOperational.sop.centres
              .filter((centre) => centre.standbySpikeCount > 0)
              .flatMap((centre) => {
                const spikeCentre = snapshot.preschoolOperational?.status === "available"
                  ? snapshot.preschoolOperational.spikes.standby.centres.find((candidate) => candidate.scopeId === centre.scopeId)
                  : undefined;
                return spikeCentre ? [{
                  centreCode: centre.centreCode,
                  name: centre.name,
                  centreType: centre.centreType,
                  standbySpikeCount: centre.standbySpikeCount,
                  score: formatNumber(centre.score, 0),
                  worstWhen: `${formatShortDate(spikeCentre.worstSpike.localDate)} · ${formatHourRange(spikeCentre.worstSpike.localHour)}`,
                  worstVariance: `+${formatNumber(spikeCentre.worstSpike.variancePct, 1)}%`,
                  leadingContributor: toCustomerCircuitName(centre.scopeId, spikeCentre.worstSpike.leadingCircuitName) ?? "Unavailable",
                }] : [];
              }),
          },
          calendarVersion: snapshot.preschoolOperational.evidence.businessCalendarVersion,
          threshold: `>${snapshot.preschoolOperational.contract.spikeThresholdPct}% above same Centre and hour-slot mean`,
        }
      : {
          status: "unavailable",
          detail: snapshot.preschoolOperational?.status === "available"
            ? "The current API runtime returned a superseded operational Evidence contract. Refresh the runtime before using Standby, Operating-hours or Spike findings."
            : snapshot.preschoolOperational?.reason.message
              ?? "The current Snapshot does not contain release-pinned Calendar and Centre-hour Evidence for operational behaviour.",
        },
    evidence: {
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      queryIds,
      referenceCount: snapshot.evidence.length,
      importBatchCount: snapshot.dataSnapshot.importBatchIds.length,
      benchmarkRecipeIds: snapshot.preschoolBenchmark?.evidence.projectionRecipeIds ?? [],
      applianceRecipeIds: snapshot.preschoolAppliances?.status === "available"
        ? [snapshot.preschoolAppliances.evidence.projectionRecipeId]
        : [],
      operationalRecipeIds: snapshot.preschoolOperational?.status === "available"
        ? snapshot.preschoolOperational.evidence.projectionRecipeIds
        : [],
      planningRecipeIds: planningReference
        ? [planningReference.evidence.recipeId]
        : [],
    },
  };
}

function buildPreschoolMonthComparison(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["overallSummary"]["monthComparison"] {
  const currentWindow = snapshot.reportTimeContext?.windows.find(
    (window) => window.windowId === "current-overview",
  );
  const reference = snapshot.reportWindowSegmentSummaries
    ?.find((window) => window.windowId === "previous-month-comparison")
    ?.segments[0];
  if (snapshot.dataQuality.status !== "complete"
    || currentWindow?.phase !== "complete"
    || currentWindow.completeDayCount <= 0
    || reference?.dataStatus !== "complete"
    || reference.completeDayCount !== reference.expectedDayCount
    || !reference.summary
    || reference.summary.usageKwh <= 0
    || reference.summary.averageDailyUsageKwh <= 0) return null;

  const currentUsageKwh = snapshot.analysis.summary.usageKwh;
  const currentAverageDailyUsageKwh = currentUsageKwh / currentWindow.completeDayCount;
  const totalChangeKwh = currentUsageKwh - reference.summary.usageKwh;
  const totalChangePct = totalChangeKwh / reference.summary.usageKwh * 100;
  const averageDailyChangePct = (
    currentAverageDailyUsageKwh - reference.summary.averageDailyUsageKwh
  ) / reference.summary.averageDailyUsageKwh * 100;

  return {
    currentLabel: formatMonthYear(snapshot.context.from, snapshot.context.timezone),
    referenceLabel: formatMonthYear(reference.period.start, snapshot.context.timezone),
    currentEnergy: `${formatNumber(currentUsageKwh, 2)} kWh`,
    referenceEnergy: `${formatNumber(reference.summary.usageKwh, 2)} kWh`,
    totalChange: `${formatSigned(totalChangeKwh, 2)} kWh`,
    totalChangePct: `${formatSigned(totalChangePct, 1)}%`,
    averageDailyChangePct: `${formatSigned(averageDailyChangePct, 1)}%`,
    evidence: { ...reference.evidence },
  };
}

function buildForecastView(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["forecast"] {
  const lifecycle = snapshot.preschoolPlanningLifecycle;
  if (!lifecycle || lifecycle.status !== "available" || !lifecycle.forecast) {
    return buildEstimateOnlyForecastView(snapshot);
  }
  if (lifecycle.contract.version !== "2") {
    return buildEstimateOnlyForecastView(snapshot);
  }
  const forecast = lifecycle.forecast;
  const targetPeriod = forecast.targetPeriod;
  const tariffAssumption = forecast.tariffAssumption;
  const identityMatches = forecast.contract.id === "preschool-monthly-energy-outlook"
    && forecast.contract.version === "2"
    && targetPeriod !== undefined
    && tariffAssumption !== undefined
    && targetPeriod.start === lifecycle.targetPeriod.start
    && targetPeriod.endExclusive === lifecycle.targetPeriod.endExclusive
    && targetPeriod.timezone === lifecycle.targetPeriod.timezone
    && targetPeriod.targetDayCount === lifecycle.targetPeriod.targetDayCount
    && monthlyOutlookTargetMatches(snapshot, lifecycle.targetPeriod)
    && planningTargetMatches(lifecycle.plan.targetPeriod, lifecycle.targetPeriod)
    && lifecycle.planProvenance.projectReleaseId === snapshot.projectRelease.id
    && lifecycle.actualProvenance.projectReleaseId === snapshot.projectRelease.id
    && lifecycle.planProvenance.dataSnapshotId === forecast.evidence.planDataSnapshotId
    && lifecycle.actualProvenance.dataSnapshotId === forecast.evidence.actualDataSnapshotId
    && lifecycle.plan.evidence.dataSnapshotId === forecast.evidence.planDataSnapshotId
    && lifecycle.actualProvenance.period.start === lifecycle.targetPeriod.start
    && lifecycle.actualProvenance.period.endExclusive === lifecycle.targetPeriod.endExclusive
    && lifecycle.actualProvenance.period.timezone === lifecycle.targetPeriod.timezone
    && forecast.evidence.planQueryId === "daily_totals_v1"
    && forecast.evidence.actualQueryId === "daily_totals_v1";
  const portfolio = forecast.scopes.find((scope) => scope.scopeRole === "portfolio");
  const hasMonthlyFields = forecast.scopes.every((scope) => (
    typeof scope.originalEstimateIdentity === "string"
    && typeof scope.actualIdentity === "string"
    && typeof scope.currentOutlookIdentity === "string"
    && scope.expectedFullMonthKwh !== undefined
    && scope.expectedFullMonthCostBeforeGstSgd !== undefined
    && scope.actualCostBeforeGstSgd !== undefined
    && Object.hasOwn(scope, "actualThroughLocalDate")
    && forecastScopeCoversTarget(scope, lifecycle.targetPeriod)
    && Object.values(scope.buckets).every((buckets) => buckets.every((bucket) => (
      typeof bucket.originalEstimateKwh === "number"
      && bucket.currentOutlookKwh !== undefined
      && bucket.futureOutlookKwh !== undefined
    )))
  ));
  if (!identityMatches || !portfolio || !targetPeriod || !tariffAssumption || !hasMonthlyFields) {
    return {
      status: "unavailable",
      detail: "The Snapshot-bound Forecast series does not match its Saved Plan and current Actual Evidence pins.",
    };
  }
  const scopes = forecast.scopes.map((scope) => {
    const scopeStatus = scope.actualCompleteDayCount === 0
      ? "waiting" as const
      : scope.actualCompleteDayCount === scope.actualTargetDayCount
        ? "complete" as const
        : "partial" as const;
    const actualThrough = scope.actualThroughLocalDate
      ? `Actual through ${formatForecastLocalDate(scope.actualThroughLocalDate)}`
      : "Actual not started";
    return {
      scopeId: scope.scopeId,
      label: scope.scopeName,
      scopeType: scope.scopeType,
      role: scope.scopeRole,
      status: scopeStatus,
      statusLabel: forecastStatusLabel(scopeStatus, scope.outcome),
      statusDetail: forecastScopeStatusDetail(scopeStatus, scope.actualThroughLocalDate),
      actualThrough,
      expectedFullMonthEnergy: scope.expectedFullMonthKwh == null
        ? "Unavailable"
        : `${formatNumber(scope.expectedFullMonthKwh, 0)} kWh`,
      expectedFullMonthCost: scope.expectedFullMonthCostBeforeGstSgd == null
        ? "Unavailable"
        : `S$${formatNumber(scope.expectedFullMonthCostBeforeGstSgd, 0)}`,
      consumedSoFar: scope.actualKwh === null
        ? "Awaiting first complete day"
        : `${formatNumber(scope.actualKwh, 0)} kWh`,
      consumedCostSoFar: scope.actualKwh === null
        ? "Awaiting first complete day"
        : scope.actualCostBeforeGstSgd == null
          ? "Unavailable"
          : `S$${formatNumber(scope.actualCostBeforeGstSgd, 0)} before GST`,
      paceVsOriginalEstimate: scope.pacePct === null
        ? "Starts after first complete day"
        : `${formatNumber(scope.pacePct, 2)}%`,
      paceDetail: forecastPaceDetail(scope.pacePct, scope.outcome, scopeStatus),
      coverage: `${scope.actualCompleteDayCount} / ${scope.actualTargetDayCount} complete days`,
      outcome: scope.outcome,
      buckets: {
        daily: scope.buckets.daily.map(forecastBucketView),
        weekly: scope.buckets.weekly.map(forecastBucketView),
        monthly: scope.buckets.monthly.map(forecastBucketView),
      },
    };
  });
  return {
    status: forecast.status,
    comparisonStatus: "frozen-original",
    statusLabel: forecastStatusLabel(forecast.status, portfolio.outcome),
    statusDetail: forecast.status === "waiting"
      ? `The frozen estimate is ready for ${formatForecastTargetMonth(targetPeriod.start)}; Actual starts after the first complete local day.`
      : forecast.status === "partial"
        ? "Actual includes complete local days only. Current Outlook combines those facts with the remaining frozen estimate."
        : `All ${targetPeriod.targetDayCount} local days are complete, so Current Outlook equals final Actual.`,
    targetMonth: formatForecastTargetMonth(targetPeriod.start),
    targetPeriod: formatForecastTargetPeriod(targetPeriod.start, targetPeriod.endExclusive),
    defaultScopeId: portfolio.scopeId,
    centreSelectionAvailable: scopes.some((scope) => scope.role === "centre"),
    tariff: forecastTariffView(tariffAssumption, targetPeriod.start),
    scopes,
    method: forecast.contract.method,
    planEvidence: `Saved ${lifecycle.planProvenance.savedAnalysisId} · Snapshot ${lifecycle.planProvenance.dataSnapshotId} · ${lifecycle.planProvenance.queryId}`,
    actualEvidence: `Current Snapshot ${lifecycle.actualProvenance.dataSnapshotId} · ${lifecycle.actualProvenance.queryId}`,
  };
}

function buildEstimateOnlyForecastView(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["forecast"] {
  const plan = resolvePlanningReference(snapshot);
  const estimateSeries = plan?.estimateSeries;
  const targetEndExclusive = plan
    ? shiftLocalDate(plan.targetPeriod.endInclusive, 1)
    : null;
  const identityMatches = plan !== null
    && targetEndExclusive !== null
    && monthlyOutlookTargetMatches(snapshot, {
      start: plan.targetPeriod.start,
      endExclusive: targetEndExclusive,
      timezone: plan.targetPeriod.timezone ?? snapshot.context.timezone,
      targetDayCount: plan.targetPeriod.days,
    })
    && plan.targetPeriod.days === forecastBucketDayCount(plan.targetPeriod.start, targetEndExclusive)
    && plan.evidence.dataSnapshotId === snapshot.dataSnapshot.id
    && plan.evidence.queryId === "daily_totals_v1"
    && (
      (estimateSeries?.contract.id === "preschool-june-2026-estimate-series"
        && estimateSeries.contract.version === "1")
      || (estimateSeries?.contract.id === "preschool-monthly-estimate-series"
        && estimateSeries.contract.version === "2")
    );
  const portfolio = estimateSeries?.scopes.find((scope) => scope.scopeRole === "portfolio");
  if (!identityMatches || !estimateSeries || !portfolio) {
    return {
      status: "unavailable",
      detail: "A Snapshot-bound monthly Planning Baseline is unavailable. Actual is never simulated or borrowed from another Snapshot.",
    };
  }
  const scopes = estimateSeries.scopes.map((scope) => ({
    scopeId: scope.scopeId,
    label: scope.scopeName,
    scopeType: scope.scopeType,
    role: scope.scopeRole,
    status: "waiting" as const,
    statusLabel: "Awaiting first complete day",
    statusDetail: "No complete local-day Actual is available for this scope yet.",
    actualThrough: "Actual not started",
    expectedFullMonthEnergy: `${formatNumber(scope.estimatedKwh, 0)} kWh`,
    expectedFullMonthCost: scope.scopeRole === "portfolio"
      ? planningProjectedCostLabel(plan)
      : plan.tariffReference && scope.estimatedCostBeforeGstSgd !== null
        ? `S$${formatNumber(scope.estimatedCostBeforeGstSgd, 0)}`
        : "Unavailable",
    consumedSoFar: "Awaiting first complete day",
    consumedCostSoFar: "Awaiting first complete day",
    paceVsOriginalEstimate: "Frozen Original Estimate pending",
    paceDetail: "The Planning Baseline remains visible; historical Original-versus-Current comparison needs a compatible Saved Plan.",
    coverage: `0 / ${plan.targetPeriod.days} complete days`,
    outcome: null,
    buckets: {
      daily: scope.buckets.daily.map(estimateOnlyForecastBucketView),
      weekly: scope.buckets.weekly.map(estimateOnlyForecastBucketView),
      monthly: scope.buckets.monthly.map(estimateOnlyForecastBucketView),
    },
  }));
  return {
    status: "waiting",
    comparisonStatus: "planning-baseline",
    statusLabel: "Planning baseline ready · Frozen comparison pending",
    statusDetail: `A deterministic baseline is ready for ${formatForecastTargetMonth(plan.targetPeriod.start)}. A compatible frozen Saved Plan is not available for Original-versus-Current comparison.`,
    targetMonth: formatForecastTargetMonth(plan.targetPeriod.start),
    targetPeriod: formatForecastTargetPeriod(plan.targetPeriod.start, targetEndExclusive),
    defaultScopeId: portfolio.scopeId,
    centreSelectionAvailable: scopes.some((scope) => scope.role === "centre"),
    tariff: planningTariffView(plan),
    scopes,
    method: estimateSeries.contract.method,
    planEvidence: `Current Snapshot ${plan.evidence.dataSnapshotId} · ${plan.evidence.queryId}`,
    actualEvidence: `${formatForecastTargetMonth(plan.targetPeriod.start)} Actual not available yet`,
  };
}

type PlanningEstimateBucket = NonNullable<
  NonNullable<ReturnType<typeof resolvePlanningReference>>["estimateSeries"]
>["scopes"][number]["buckets"]["daily"][number];

function estimateOnlyForecastBucketView(bucket: PlanningEstimateBucket) {
  const targetDayCount = forecastBucketDayCount(bucket.start, bucket.endExclusive);
  return {
    label: formatForecastBucketLabel(bucket.start, bucket.endExclusive),
    start: bucket.start,
    endExclusive: bucket.endExclusive,
    originalEstimateKwh: null,
    originalEstimate: "Frozen estimate pending",
    planningBaselineKwh: bucket.estimatedKwh,
    planningBaseline: `${formatNumber(bucket.estimatedKwh, 0)} kWh`,
    actualKwh: null,
    actual: "Waiting",
    currentOutlookKwh: bucket.estimatedKwh,
    currentOutlook: `${formatNumber(bucket.estimatedKwh, 0)} kWh`,
    actualStatus: "waiting" as const,
    coverage: `0 / ${targetDayCount} complete days`,
  };
}

function forecastBucketDayCount(start: string, endExclusive: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${endExclusive}T00:00:00.000Z`);
  return Math.max(1, Math.round((endMs - startMs) / 86_400_000));
}

function forecastStatusLabel(
  status: "waiting" | "partial" | "complete",
  outcome: "on_plan" | "above_plan" | "below_plan" | null,
): string {
  if (status === "waiting") return "Awaiting first complete day";
  if (status === "partial") return "Actual to date + remaining estimate";
  if (outcome === "above_plan") return "Complete month · Above original estimate";
  if (outcome === "below_plan") return "Complete month · Below original estimate";
  return "Complete month · On original estimate";
}

function forecastScopeStatusDetail(
  status: "waiting" | "partial" | "complete",
  actualThroughLocalDate: string | null | undefined,
): string {
  if (status === "waiting" || !actualThroughLocalDate) {
    return "No complete local-day Actual is available for this scope yet.";
  }
  const cutoff = formatForecastLocalDate(actualThroughLocalDate);
  if (status === "complete") return `Actual is complete through ${cutoff}.`;
  return `Actual includes complete local days through ${cutoff}; Current Outlook begins after that cutoff.`;
}

function formatForecastLocalDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T00:00:00.000Z`));
}

function forecastPaceDetail(
  pacePct: number | null,
  outcome: "on_plan" | "above_plan" | "below_plan" | null,
  status: "waiting" | "partial" | "complete",
): string {
  if (pacePct === null) return "Starts after the first complete local day";
  if (status !== "complete") return "Actual to date ÷ frozen estimate for the same complete days";
  if (outcome === "above_plan") return "Final Actual finished above Original Estimate";
  if (outcome === "below_plan") return "Final Actual finished below Original Estimate";
  return "Final Actual finished on Original Estimate";
}

function forecastBucketView(
  bucket: Extract<
    NonNullable<Extract<NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolPlanningLifecycle"]>, { status: "available" }>["forecast"]>,
    { status: "waiting" | "partial" | "complete" }
  >["scopes"][number]["buckets"]["daily"][number],
) {
  return {
    label: formatForecastBucketLabel(bucket.start, bucket.endExclusive),
    start: bucket.start,
    endExclusive: bucket.endExclusive,
    originalEstimateKwh: bucket.originalEstimateKwh ?? null,
    originalEstimate: bucket.originalEstimateKwh === undefined
      ? "Unavailable"
      : `${formatNumber(bucket.originalEstimateKwh, 0)} kWh`,
    planningBaselineKwh: null,
    planningBaseline: "Not used",
    actualKwh: bucket.actualKwh,
    actual: bucket.actualKwh === null ? "Waiting" : `${formatNumber(bucket.actualKwh, 0)} kWh`,
    currentOutlookKwh: bucket.futureOutlookKwh ?? null,
    currentOutlook: bucket.futureOutlookKwh == null
      ? "—"
      : `${formatNumber(bucket.futureOutlookKwh, 0)} kWh`,
    actualStatus: bucket.actualStatus,
    coverage: `${bucket.actualCompleteDayCount} / ${bucket.actualTargetDayCount} complete days`,
  };
}

function planningTargetMatches(
  plan: { start: string; endInclusive: string; days: number },
  target: { start: string; endExclusive: string; targetDayCount: number },
): boolean {
  return plan.start === target.start
    && plan.endInclusive === shiftLocalDate(target.endExclusive, -1)
    && plan.days === target.targetDayCount;
}

function monthlyOutlookTargetMatches(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  target: { start: string; endExclusive: string; timezone: string; targetDayCount: number },
): boolean {
  const expected = snapshot.context.monthlyOutlookTargetPeriod;
  if (!expected) return snapshot.context.latestCompleteLocalDay === undefined;
  return expected.start === target.start
    && expected.endExclusive === target.endExclusive
    && expected.timezone === target.timezone
    && expected.targetDayCount === target.targetDayCount;
}

function forecastScopeCoversTarget(
  scope: NonNullable<Extract<
    NonNullable<Extract<NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolPlanningLifecycle"]>, { status: "available" }>["forecast"]>,
    { status: "waiting" | "partial" | "complete" }
  >>["scopes"][number],
  target: { start: string; endExclusive: string; targetDayCount: number },
): boolean {
  const daily = scope.buckets.daily;
  const weekly = scope.buckets.weekly;
  const monthly = scope.buckets.monthly;
  return scope.actualTargetDayCount === target.targetDayCount
    && daily.length === target.targetDayCount
    && daily[0]?.start === target.start
    && daily.at(-1)?.endExclusive === target.endExclusive
    && daily.every((bucket, index) => (
      bucket.start === shiftLocalDate(target.start, index)
      && bucket.endExclusive === shiftLocalDate(target.start, index + 1)
    ))
    && weekly[0]?.start === target.start
    && weekly.at(-1)?.endExclusive === target.endExclusive
    && monthly.length === 1
    && monthly[0]?.start === target.start
    && monthly[0]?.endExclusive === target.endExclusive;
}

function formatForecastTargetMonth(start: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${start}T00:00:00.000Z`));
}

function formatForecastTargetPeriod(start: string, endExclusive: string): string {
  const endInclusive = shiftLocalDate(endExclusive, -1);
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${endInclusive}T00:00:00.000Z`);
  const sameMonth = start.slice(0, 7) === endInclusive.slice(0, 7);
  const startLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" as const }),
    timeZone: "UTC",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

function formatTariffEffectiveRange(from: string, toInclusive: string): string {
  const fromLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${from}T00:00:00.000Z`));
  const toLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${toInclusive}T00:00:00.000Z`));
  return `${fromLabel}–${toLabel}`;
}

function forecastTariffView(
  tariff: NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolPlanningLifecycle"]> extends infer Lifecycle
    ? Lifecycle extends { status: "available"; forecast?: infer Forecast }
      ? Forecast extends { tariffAssumption?: infer Tariff }
        ? NonNullable<Tariff>
        : never
      : never
    : never,
  targetStart: string,
): Extract<PreschoolOverviewViewModel["forecast"], { status: "waiting" | "partial" | "complete" }>["tariff"] {
  if (tariff.status === "unavailable") {
    return {
      status: "unavailable",
      rate: "Unavailable",
      label: "Tariff reference unavailable",
      effectiveRange: "No accepted reference period",
      sourceUrl: null,
      note: `${tariff.reason} Energy remains available; only provisional cost is withheld.`,
      costBasisNote: "Tariff reference unavailable",
    };
  }
  return {
    status: tariff.status,
    rate: `S$${formatNumber(tariff.beforeGstSgdPerKwh, 4)}/kWh before GST`,
    label: tariff.status === "effective"
      ? `Effective for ${formatForecastTargetMonth(targetStart)}`
      : "Provisional · using latest available tariff",
    effectiveRange: formatTariffEffectiveRange(tariff.appliesFrom, tariff.appliesTo),
    sourceUrl: tariff.sourceUrl,
    note: `${tariff.sourceName} · ${tariff.supplyClass} · planning reference only · not a customer bill.`,
    costBasisNote: "Before GST · planning estimate, not a bill",
  };
}

function planningTariffView(
  plan: NonNullable<ReturnType<typeof resolvePlanningReference>>,
): Extract<PreschoolOverviewViewModel["forecast"], { status: "waiting" | "partial" | "complete" }>["tariff"] {
  const releasePinnedCost = plan.tariffCost?.status === "available"
    ? plan.tariffCost
    : null;
  if (releasePinnedCost) {
    return {
      status: "effective",
      rate: releasePinnedCost.allocations.length === 1
        ? `${currencySymbol(releasePinnedCost.currency)}${formatNumber(releasePinnedCost.allocations[0]!.ratePerKwh, 4)}/kWh`
        : `${releasePinnedCost.allocations.length} effective rate periods`,
      label: `Release-pinned Tariff ${releasePinnedCost.tariffScheduleVersion}`,
      effectiveRange: formatForecastTargetPeriod(
        plan.targetPeriod.start,
        shiftLocalDate(plan.targetPeriod.endInclusive, 1),
      ),
      sourceUrl: null,
      note: "Project tariff covers the full target period · estimate only, not a customer bill.",
      costBasisNote: releasePinnedCostBasisNote(releasePinnedCost.allocations),
    };
  }
  const tariff = plan.tariffReference;
  if (!tariff) {
    return {
      status: "unavailable",
      rate: "Unavailable",
      label: "Tariff reference unavailable",
      effectiveRange: "No accepted reference period",
      sourceUrl: null,
      note: "Energy remains available; only provisional cost is withheld.",
      costBasisNote: "Tariff reference unavailable",
    };
  }
  const effective = tariff.appliesFrom <= plan.targetPeriod.start
    && tariff.appliesTo >= plan.targetPeriod.endInclusive;
  return {
    status: effective ? "effective" : "provisional",
    rate: `S$${formatNumber(tariff.beforeGstSgdPerKwh, 4)}/kWh before GST`,
    label: effective
      ? `Effective for ${formatForecastTargetMonth(plan.targetPeriod.start)}`
      : "Provisional · using latest available tariff",
    effectiveRange: formatTariffEffectiveRange(tariff.appliesFrom, tariff.appliesTo),
    sourceUrl: tariff.sourceUrl,
    note: `${tariff.sourceName} · ${tariff.supplyClass} · planning reference only · not a customer bill.`,
    costBasisNote: "Before GST · planning estimate, not a bill",
  };
}

function releasePinnedCostBasisNote(
  allocations: Array<{ rateBasis?: "tax_inclusive" | "tax_exclusive" }>,
): string {
  const bases = new Set(allocations.map((allocation) => allocation.rateBasis));
  if (bases.size === 1 && bases.has("tax_inclusive")) {
    return "Tax-inclusive · planning estimate, not a bill";
  }
  if (bases.size === 1 && bases.has("tax_exclusive")) {
    return "Tax-exclusive · planning estimate, not a bill";
  }
  return "Release-pinned tariff · planning estimate, not a bill";
}

function planningProjectedCostLabel(
  plan: NonNullable<ReturnType<typeof resolvePlanningReference>>,
): string {
  if (plan.tariffCost?.status === "available") {
    return `${currencySymbol(plan.tariffCost.currency)}${formatNumber(plan.tariffCost.projectedAmount, 0)}`;
  }
  return plan.tariffReference && plan.costEstimate
    ? `S$${formatNumber(plan.costEstimate.projectedBeforeGstSgd, 0)}`
    : "Unavailable";
}

function shiftLocalDate(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatForecastBucketLabel(start: string, endExclusive: string): string {
  const endDate = new Date(`${endExclusive}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const endInclusive = endDate.toISOString().slice(0, 10);
  return start === endInclusive
    ? formatShortDate(start)
    : `${formatShortDate(start)}–${formatShortDate(endInclusive)}`;
}

function resolvePlanningReference(snapshot: EnergyProjectAnalysisSnapshotDto) {
  if (snapshot.preschoolPlanningLifecycle?.status === "available") {
    return snapshot.preschoolPlanningLifecycle.plan;
  }
  return snapshot.preschoolOperational?.status === "available"
    && snapshot.preschoolOperational.planningOutlook.status === "provisional"
    ? snapshot.preschoolOperational.planningOutlook
    : null;
}

function planningActualView(
  lifecycle: Extract<
    NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolPlanningLifecycle"]>,
    { status: "available" }
  >,
): Extract<
  PreschoolOverviewViewModel["planningOutlook"],
  { status: "provisional" }
>["actual"] {
  const varianceAvailable = lifecycle.actual.status === "complete"
    && lifecycle.actual.varianceKwh !== null
    && lifecycle.actual.variancePct !== null;
  return {
    status: lifecycle.actual.status,
    statusLabel: lifecycle.actual.status === "complete" ? "Complete actual" : "Partial actual",
    usage: lifecycle.actual.usageKwh === null
      ? "Unavailable"
      : `${formatNumber(lifecycle.actual.usageKwh, 0)} kWh`,
    coverage: `${lifecycle.actual.completeDayCount} / ${lifecycle.actual.targetDayCount} complete days`,
    variance: varianceAvailable
      ? `${formatSigned(lifecycle.actual.varianceKwh!, 2)} kWh · ${formatSigned(lifecycle.actual.variancePct!, 2)}% versus plan`
      : `withheld until ${lifecycle.actual.targetDayCount} / ${lifecycle.actual.targetDayCount} complete days`,
    varianceStatus: varianceAvailable ? "available" : "withheld",
    planEvidence: `Saved ${lifecycle.planProvenance.savedAnalysisId} · Snapshot ${lifecycle.planProvenance.dataSnapshotId}`,
    actualEvidence: `Current Snapshot ${lifecycle.actualProvenance.dataSnapshotId} · ${lifecycle.actualProvenance.queryId}`,
  };
}

function formatSigned(value: number, digits: number): string {
  const formatted = formatNumber(value, digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function buildPreschoolBenchmarkView(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["benchmark"] {
  const projection = snapshot.preschoolBenchmark;
  if (!projection) {
    return {
      status: "unavailable",
      detail: "The current Snapshot does not contain a server-authoritative benchmark projection. No client-side percentile is inferred.",
    };
  }

  const priorityIndex = new Map(
    projection.priorityCentreCodes.map((centreCode, index) => [centreCode, index]),
  );
  type BenchmarkQuadrant = typeof projection.centres[number]["quadrant"];
  const actionScore = (centre: typeof projection.centres[number], quadrant: BenchmarkQuadrant) => {
    if (quadrant === "priority") return -(priorityIndex.get(centre.centreCode) ?? Number.MAX_SAFE_INTEGER);
    if (quadrant === "eui-intensive") return centre.annualisedEuiKwhPerSqmYear / projection.portfolio.eui.p75;
    if (quadrant === "people-intensive") return centre.mayKwhPerPerson / projection.portfolio.perPax.p75;
    return Math.max(
      centre.annualisedEuiKwhPerSqmYear / projection.portfolio.eui.p75,
      centre.mayKwhPerPerson / projection.portfolio.perPax.p75,
    );
  };
  const sortedQuadrantCodes = (quadrant: BenchmarkQuadrant) => projection.centres
    .filter((centre) => centre.quadrant === quadrant)
    .sort((left, right) => actionScore(right, quadrant) - actionScore(left, quadrant)
      || left.centreCode.localeCompare(right.centreCode))
    .map((centre) => centre.centreCode);
  const priorityCentres = projection.priorityCentreCodes.flatMap((centreCode, index) => {
    const centre = projection.centres.find((candidate) => candidate.centreCode === centreCode);
    if (!centre) return [];
    return [{
      rank: index + 1,
      centreCode,
      name: centre.name,
      cohort: centre.cohort,
      eui: `${formatNumber(centre.annualisedEuiKwhPerSqmYear, 2)} kWh/m²/yr`,
      perPax: `${formatNumber(centre.mayKwhPerPerson, 1)} kWh/person/month`,
    }];
  });
  const scatterPoints = projection.centres
    .map((centre) => ({
      centreCode: centre.centreCode,
      name: centre.name,
      cohort: centre.cohort,
      eui: centre.annualisedEuiKwhPerSqmYear,
      perPax: centre.mayKwhPerPerson,
      quadrant: centre.quadrant,
      priority: centre.priority,
      actionRank: priorityIndex.has(centre.centreCode)
        ? priorityIndex.get(centre.centreCode)! + 1
        : null,
    }))
    .sort((left, right) => Number(left.priority) - Number(right.priority)
      || (right.actionRank ?? 0) - (left.actionRank ?? 0));

  return {
    status: "provisional",
    sampleSize: projection.sampleSize,
    eui: {
      p50: formatNumber(projection.portfolio.eui.p50, 2),
      p75: formatNumber(projection.portfolio.eui.p75, 2),
    },
    perPax: {
      p50: formatNumber(projection.portfolio.perPax.p50, 1),
      p75: formatNumber(projection.portfolio.perPax.p75, 1),
    },
    cohorts: projection.cohorts.map((cohort) => ({
      name: cohort.name,
      sampleSize: cohort.sampleSize,
      euiP50: formatNumber(cohort.eui.p50, 2),
      euiP75: formatNumber(cohort.eui.p75, 2),
      perPaxP50: formatNumber(cohort.perPax.p50, 1),
      perPaxP75: formatNumber(cohort.perPax.p75, 1),
    })),
    quadrants: ([
      ["priority", "Priority"],
      ["eui-intensive", "High EUI"],
      ["people-intensive", "High per-pax"],
      ["lower-intensity", "Lower intensity"],
    ] as const).map(([id, label]) => ({
      id,
      label,
      centreCodes: sortedQuadrantCodes(id),
    })),
    priorityCentreCodes: projection.priorityCentreCodes,
    priorityCentres,
    distributions: buildBenchmarkDistributions(projection),
    scatter: {
      euiP75: projection.portfolio.eui.p75,
      perPaxP75: projection.portfolio.perPax.p75,
      points: scatterPoints,
    },
    detail: isCompleteCalendarMonth(
      snapshot.context.from,
      snapshot.context.to,
      snapshot.context.timezone,
    )
      ? "Provisional comparison across the published 30-Centre cohort. EUI is annualised from this complete month; energy per person uses the same month."
      : "Provisional comparison across the published 30-Centre cohort. EUI is annualised from the current window; energy per person is normalised to an average month.",
  };
}

function buildBenchmarkDistributions(
  benchmark: NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolBenchmark"]>,
): PreschoolBenchmarkDistribution[] {
  const cohortDisplayOrder = new Map([
    ["Senior Care Center", 0],
    ["Active Aging Center", 1],
    ["Preschool", 2],
  ]);
  const orderedCohorts = [...benchmark.cohorts].sort((left, right) => (
    (cohortDisplayOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER)
      - (cohortDisplayOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name)
  ));
  const definitions = [
    {
      id: "eui",
      label: "Annualised EUI estimate",
      question: "Which Outlets use more energy than peers after adjusting for floor area?",
      unit: "kWh/m²/year",
      digits: 2,
      value: (centre: typeof benchmark.centres[number]) => centre.annualisedEuiKwhPerSqmYear,
      threshold: (cohort: typeof benchmark.cohorts[number]) => cohort.eui,
    },
    {
      id: "per-pax",
      label: "Energy per person",
      question: "Which Outlets use more energy per person than peers of the same Centre type?",
      unit: "kWh/person/month",
      digits: 1,
      value: (centre: typeof benchmark.centres[number]) => centre.mayKwhPerPerson,
      threshold: (cohort: typeof benchmark.cohorts[number]) => cohort.perPax,
    },
  ] as const;

  return definitions.map((definition) => {
    const values = benchmark.centres.map(definition.value);
    const p75Values = benchmark.cohorts.map((cohort) => definition.threshold(cohort).p75);
    const cohortByName = new Map(benchmark.cohorts.map((cohort) => [cohort.name, cohort]));
    const ranking = benchmark.centres.map((centre) => {
      const cohort = cohortByName.get(centre.cohort);
      if (!cohort) throw new Error(`PRESCHOOL_BENCHMARK_COHORT_MISMATCH:${centre.cohort}`);
      const threshold = definition.threshold(cohort);
      const value = definition.value(centre);
      return {
        centreCode: centre.centreCode,
        name: centre.name,
        cohort: centre.cohort,
        value,
        valueLabel: formatNumber(value, definition.digits),
        p75: formatNumber(threshold.p75, definition.digits),
        p75Value: threshold.p75,
        aboveP75: value > threshold.p75,
        priority: centre.priority,
        relativeToP75: threshold.p75 > 0 ? value / threshold.p75 : 0,
      };
    }).sort((left, right) => Number(right.aboveP75) - Number(left.aboveP75)
      || right.relativeToP75 - left.relativeToP75
      || right.value - left.value
      || left.centreCode.localeCompare(right.centreCode));
    return {
      id: definition.id,
      label: definition.label,
      question: definition.question,
      unit: definition.unit,
      axis: {
        min: 0,
        max: Math.max(1, Math.ceil(Math.max(...values, ...p75Values))),
      },
      cohorts: orderedCohorts.map((cohort) => {
        const threshold = definition.threshold(cohort);
        return {
          name: cohort.name,
          sampleSize: cohort.sampleSize,
          p50: formatNumber(threshold.p50, definition.digits),
          p75: formatNumber(threshold.p75, definition.digits),
          p50Value: threshold.p50,
          p75Value: threshold.p75,
          points: benchmark.centres
            .filter((centre) => centre.cohort === cohort.name)
            .map((centre) => ({
              centreCode: centre.centreCode,
              name: centre.name,
              value: definition.value(centre),
              valueLabel: formatNumber(definition.value(centre), definition.digits),
              aboveP75: definition.value(centre) > threshold.p75,
              priority: centre.priority,
            }))
            .sort((left, right) => Number(right.aboveP75) - Number(left.aboveP75)
              || right.value - left.value
              || left.centreCode.localeCompare(right.centreCode)),
        };
      }),
      ranking: ranking.map(({ relativeToP75: _relativeToP75, ...row }, index) => ({
        ...row,
        rank: index + 1,
      })),
    };
  });
}

function buildPreschoolDecisionSummary(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["decisionSummary"] {
  const signals = snapshot.preschoolDecisionSignals;
  const signalItems = signals?.status === "available"
    ? signals.items.flatMap<PreschoolDecisionSummaryItem>((signal) => {
        const primary = signal.metrics.find((metric) => metric.role === "primary");
        if (!primary) return [];
        const destination = signal.id === "efficiency"
          ? { sectionNumber: 2 as const, targetId: "preschool-benchmark-analysis" as const }
          : signal.id === "after-hours"
            ? { sectionNumber: 3 as const, targetId: "preschool-standby-wastage" as const }
            : { sectionNumber: 4 as const, targetId: "preschool-operating-hours" as const };
        return [{
          id: signal.id,
          sectionId: signal.sectionId,
          priority: signal.priority,
          ...destination,
          label: signal.label,
          primaryMetric: {
            label: primary.label,
            value: primary.value,
            valueLabel: formatDecisionSignalMetric(primary.value, primary.precision, primary.unit),
          },
          supportingMetrics: signal.metrics
            .filter((metric) => metric.role === "supporting")
            .map((metric) => ({
              label: metric.label,
              valueLabel: formatDecisionSignalMetric(metric.value, metric.precision, metric.unit),
            })),
          centreCodes: signal.entities.map((entity) => entity.code),
          limitation: signal.limitations.map((limitation) => limitation.label).join(" "),
          evidenceRefs: signal.evidenceRefs,
        }];
      })
    : [];
  const planning = resolvePlanningReference(snapshot);
  const planningMonth = planning ? formatForecastTargetMonth(planning.targetPeriod.start) : null;
  const planningItem: PreschoolDecisionSummaryItem[] = planning
    ? [{
        id: "planning",
        sectionId: "planning-outlook",
        priority: null,
        sectionNumber: 5,
        targetId: "preschool-monthly-outlook",
        label: `${planningMonth} planning baseline`,
        primaryMetric: {
          label: `Estimated ${planningMonth} energy`,
          value: planning.usageEstimate.projectedKwh,
          valueLabel: `${formatNumber(planning.usageEstimate.projectedKwh, 0)} kWh`,
        },
        supportingMetrics: [
          {
            label: `Estimated ${planningMonth} cost`,
            valueLabel: planningProjectedCostLabel(planning),
          },
          {
            label: "Source window",
            valueLabel: `${planning.sourceWeeks.length} complete weeks`,
          },
        ],
        centreCodes: [],
        limitation: planning.limitations.join(" "),
        evidenceRefs: [planning.evidence.queryId, planning.evidence.recipeId],
      }]
    : [];
  const items = [...signalItems, ...planningItem]
    .sort((left, right) => left.sectionNumber - right.sectionNumber);

  return {
    items,
    detail: items.length > 0
      ? "At-a-glance Snapshot facts for Sections 2–5. The AI Executive Summary appears above, while Section interpretations stay beside their supporting analysis."
      : signals?.reason?.message
        ?? "Verified decision signals and the next-month Planning Baseline are unavailable for this Snapshot.",
  };
}

function formatDecisionSignalMetric(value: number, precision: number, unit: "kWh" | "%" | "count"): string {
  const formatted = formatNumber(value, precision);
  if (unit === "%") return `${formatted}%`;
  if (unit === "kWh") return `${formatted} kWh`;
  return formatted;
}

function toOperationalCentre(
  centre: Extract<NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolOperational"]>, { status: "available" }>["spikes"]["standby"]["centres"][number],
): PreschoolOperationalCentre {
  return {
    scopeId: centre.scopeId,
    centreCode: centre.centreCode,
    name: centre.name,
    centreType: centre.centreType,
    spikeCount: centre.spikeCount,
    worst: {
      when: `${formatShortDate(centre.worstSpike.localDate)} · ${formatHourRange(centre.worstSpike.localHour)}`,
      dayType: operationalDayTypeLabel(centre.worstSpike.dayType),
      usage: `${formatNumber(centre.worstSpike.usageKwh, 3)} kWh`,
      baseline: `${formatNumber(centre.worstSpike.baselineKwh, 3)} kWh baseline`,
      variance: `+${formatNumber(centre.worstSpike.variancePct, 1)}%`,
      leadingCircuit: `${toCustomerCircuitName(centre.scopeId, centre.worstSpike.leadingCircuitName) ?? "Unavailable"} · ${formatNumber(centre.worstSpike.leadingCircuitSharePct, 0)}%`,
    },
    events: centre.events.map((event) => ({
      when: `${formatShortDate(event.localDate)} · ${formatHourRange(event.localHour)}`,
      dayType: operationalDayTypeLabel(event.dayType),
      usage: `${formatNumber(event.usageKwh, 3)} kWh`,
      baseline: `${formatNumber(event.baselineKwh, 3)} kWh`,
      impact: `+${formatNumber(event.impactKwh, 3)} kWh`,
      variance: `+${formatNumber(event.variancePct, 1)}%`,
      leadingCircuit: `${toCustomerCircuitName(centre.scopeId, event.leadingCircuitName) ?? "Unavailable"} · ${formatNumber(event.leadingCircuitSharePct, 0)}%`,
    })),
  };
}

function operationalDayTypeLabel(
  dayType: "weekday" | "weekend" | "calendar_exception" | undefined,
): PreschoolOperationalCentre["worst"]["dayType"] {
  if (dayType === "calendar_exception") return "Calendar exception";
  if (dayType === "weekend") return "Weekend";
  return dayType === "weekday" ? "Weekday" : "Unavailable";
}

function formatShortDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${localDate}T00:00:00.000Z`));
}

function formatHourRange(localHour: number): string {
  const from = String(localHour).padStart(2, "0");
  const to = String((localHour + 1) % 24).padStart(2, "0");
  return `${from}:00–${to}:00`;
}

function formatPeriod(from: string, toExclusive: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
  return `${formatter.format(new Date(from))}–${formatter.format(new Date(Date.parse(toExclusive) - 1))}`;
}

function formatMonthYear(from: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(from));
}

function formatAnalysisWindowLabel(from: string, toExclusive: string, timeZone: string): string {
  return isCompleteCalendarMonth(from, toExclusive, timeZone)
    ? formatMonthYear(from, timeZone)
    : formatPeriod(from, toExclusive, timeZone);
}

function formatAnalysisWindowKind(from: string, toExclusive: string, timeZone: string): string {
  if (isCompleteCalendarMonth(from, toExclusive, timeZone)) return "Calendar-month window";
  const localDayCount = Math.round((Date.parse(toExclusive) - Date.parse(from)) / 86_400_000);
  return localDayCount === 28
    ? "Rolling 28-day window"
    : `${localDayCount}-day analysis window`;
}

function isCompleteCalendarMonth(from: string, toExclusive: string, timeZone: string): boolean {
  const start = localDateParts(new Date(from), timeZone);
  const end = localDateParts(new Date(toExclusive), timeZone);
  if (start.day !== 1 || end.day !== 1) return false;
  return end.year === start.year
    ? end.month === start.month + 1
    : start.month === 12 && end.year === start.year + 1 && end.month === 1;
}

function localDateParts(value: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(value);
  const numberPart = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
  };
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-SG", {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  });
}

function currencySymbol(currency: string): string {
  const mark = currencyMark(currency);
  return mark === currency.trim().toUpperCase() ? `${mark} ` : mark;
}

function toCustomerCircuitName(nodeId: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const internalPrefix = `${nodeId}:`;
  if (value.startsWith(internalPrefix)) return value.slice(internalPrefix.length);
  const importedRoute = /^preschool-centre-[^:]+:(.+)$/.exec(value);
  return importedRoute?.[1] ?? value;
}

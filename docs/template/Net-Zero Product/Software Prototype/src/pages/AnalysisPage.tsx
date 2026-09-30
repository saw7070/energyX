import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { AIUtilityAssistant } from "@/components/analysis/AIUtilityAssistant";
import { AnalysisTabs } from "@/components/analysis/AnalysisTabs";
import { ConsumptionBreakdownChart } from "@/components/analysis/ConsumptionBreakdownChart";
import { CostAnalysisSection } from "@/components/analysis/CostAnalysisSection";
import { DailyTrendAnomalyAnalysisSection } from "@/components/analysis/DailyTrendAnomalyAnalysisSection";
import { EfficiencyBenchmarkCard } from "@/components/analysis/EfficiencyBenchmarkCard";
import { ForecastPredictionSection } from "@/components/analysis/ForecastPredictionSection";
import { KeyHighlightCards } from "@/components/analysis/KeyHighlightCards";
import { OverallEnergyConsumptionSection } from "@/components/analysis/OverallEnergyConsumptionSection";
import { RecommendationCards } from "@/components/analysis/RecommendationCards";
import { SummaryOfFindings } from "@/components/analysis/SummaryOfFindings";
import { RequirementGuideContent, RequirementGuideProvider } from "@/components/analysis/RequirementGuide";
import { buildSpaceRoot } from "@/components/analysis/spaceHierarchy";
import { NapAnalysisView } from "@/components/analysis/nap/NapAnalysisView";
import { NapAnalysisViewV2 } from "@/components/analysis/nap/NapAnalysisViewV2";
import { EliteAnalysisViewV2 } from "@/components/analysis/eliteiot/EliteAnalysisViewV2";
import { isEliteIotAnalysisProject, resolveEliteIotAnalysisData } from "@/components/analysis/eliteiot/eliteiotProjectRegistry";
import { isNapAnalysisProject, resolveNapAnalysisData } from "@/components/analysis/nap/napProjectRegistry";
import { NP_V2_PROJECT_ID } from "@/mock/napEnergyAnalysisDataV2";
import { useAppContext } from "@/context/AppContext";
import {
  analysisCompareModes,
  analysisDataByUtility,
  analysisOperationalProfiles,
  analysisSpaceLevels,
  analysisTimeRanges
} from "@/mock/mockData";
import {
  AnalysisSpaceLevel,
  AnalysisTimeRange,
  AnalysisUtilityKey,
  CompareMode,
  OperationalProfileOption
} from "@/mock/types";

const utilityTabs = ["Electricity Analysis", "Water Analysis", "Gas Analysis"] as const;
const utilityLabelToKey: Record<(typeof utilityTabs)[number], AnalysisUtilityKey> = {
  "Electricity Analysis": "electricity",
  "Water Analysis": "water",
  "Gas Analysis": "gas"
};
const utilityKeyToLabel: Record<AnalysisUtilityKey, (typeof utilityTabs)[number]> = {
  electricity: "Electricity Analysis",
  water: "Water Analysis",
  gas: "Gas Analysis"
};

const SECTION_REQUIREMENTS: Record<string, RequirementGuideContent> = {
  highlights: {
    title: "Executive Summary Requirements",
    summary: "KPI, breakdown, and cost panels should provide a quick monthly snapshot for decision making.",
    dataAcquisition: [
      "Read utility-specific base dataset from analysisDataByUtility[utilityKey].",
      "Apply deterministic project scaling with hashCode(selectedProjectId) to keep values stable.",
      "Generate space hierarchy via buildSpaceRoot(projectId, projectName).",
      "Derive monthly trends and totals using useMemo to keep calculations reactive to project and utility."
    ],
    chartGeneration: [
      "Use stacked bar + line composed chart for consumption and cost view.",
      "Render cost tables from computed block/tag/room aggregations.",
      "Use room-level heatmap color interpolation for quick high-cost detection.",
      "Always show deterministic values so screenshots are reproducible."
    ]
  },
  overall: {
    title: "Day Profile Analysis Requirements",
    summary: "This section compares weekday/weekend/holiday usage patterns and distribution by tag and scope.",
    dataAcquisition: [
      "Use behaviour24h baseline + actual as the profile seed data.",
      "Create mutually exclusive day groups (weekday/weekend/holiday) with deterministic holiday selection.",
      "Apply selected space scope multiplier from hierarchy traversal and seeded variability.",
      "Use applianceDistribution as the tag share baseline for both stacked and donut views."
    ],
    chartGeneration: [
      "Build 24-hour stacked area chart by tag for selected profile type.",
      "Build donut chart for selected date range and render rank bar for selected tag drill-down.",
      "Use deterministic weighting per child node for rank chart to avoid identical bars.",
      "Use interactive filters (profile, range, scope) to recompute and rerender instantly."
    ]
  },
  behaviour: {
    title: "Time-based Behavioral Analysis Requirements",
    summary: "Daily total trend and anomaly drill-down should highlight abnormal consumption with explainable rules.",
    dataAcquisition: [
      "Start from 30-day totals (dailyTotals30d) and selected scope occupant count.",
      "Calculate expected baseline by day type using per-capita historical averages.",
      "Flag anomaly when actual total exceeds baseline threshold by 15%.",
      "Generate anomaly detail curves and heatmap with deterministic circuit-specific spike windows."
    ],
    chartGeneration: [
      "Use composed chart: bars for daily totals, lines for expected and threshold, dots for anomalies.",
      "Render anomaly list table from filtered anomaly rows only.",
      "In modal, support overlay and stacked area modes for selected-day vs historical-average comparison.",
      "Render 24-hour heatmap with conditional coloring by delta percentage."
    ]
  },
  forecast: {
    title: "Forecast & Prediction Requirements",
    summary: "Forecast output should project end-of-month usage, bill amount, and near-term risk from recent trend.",
    dataAcquisition: [
      "Use recent monthlyConsumptionTrend tail values as the forecast seed.",
      "Generate short horizon forecast points with deterministic day-level variance.",
      "Compute endOfMonthConsumption from actual + forecast points.",
      "Compute billForecast from utility-specific tariff mapping."
    ],
    chartGeneration: [
      "Render KPI cards for end-of-month forecast, bill forecast, and peak risk.",
      "Render line chart with solid actual and dashed forecast series.",
      "Keep axis and tooltip values unit-consistent with selected utility."
    ]
  },
  ai: {
    title: "AI Insight Engine Requirements",
    summary: "The AI panel should show template-driven assistant responses and benchmark context side by side.",
    dataAcquisition: [
      "Read assistant template prompts/responses from analysis mock dataset.",
      "Read efficiency benchmark payload (intensity, percentile, benchmark bars) from analysis mock dataset.",
      "Keep selected template in local state for predictable interaction."
    ],
    chartGeneration: [
      "Render selectable prompt list and simulated AI response chat panel.",
      "Render benchmark bar chart with percentile and intensity cards.",
      "Use non-destructive interaction; no backend request is required for this prototype."
    ]
  },
  recommendation: {
    title: "Personalized Recommendations Requirements",
    summary: "Recommendation cards should provide actionable items with impact, ownership, and status context.",
    dataAcquisition: [
      "Load recommendation items from analysis mock dataset.",
      "Keep fields: affectedArea, estimatedSaving, reason, suggestedAction, status, owner.",
      "Preserve deterministic ordering for demo consistency."
    ],
    chartGeneration: [
      "Render card grid with priority badges and clear metadata lines.",
      "Use color-coded priority styling (High/Medium/Low).",
      "Support action buttons for workflow extension (e.g., add to log)."
    ]
  }
};

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function scaleValue(value: number, factor: number, digits = 0) {
  const scaled = value * factor;
  if (digits <= 0) {
    return Math.round(scaled);
  }
  const base = 10 ** digits;
  return Math.round(scaled * base) / base;
}

function formatDateLabel(dayIndex: number) {
  return `2026-05-${String(dayIndex + 1).padStart(2, "0")}`;
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function AnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedProjectId, setSelectedProjectId, availableProjects } = useAppContext();
  const napAnalysisData = useMemo(
    () => resolveNapAnalysisData(selectedProjectId),
    [selectedProjectId]
  );
  const eliteAnalysisData = useMemo(
    () => resolveEliteIotAnalysisData(selectedProjectId),
    [selectedProjectId]
  );
  const isNapProject = isNapAnalysisProject(selectedProjectId);
  const isEliteProject = isEliteIotAnalysisProject(selectedProjectId);
  const isDedicatedAnalysisProject = isNapProject || isEliteProject;
  const selectedProjectName = useMemo(
    () => availableProjects.find((project) => project.id === selectedProjectId)?.name ?? "Project",
    [availableProjects, selectedProjectId]
  );
  const sharedSpaceRoot = useMemo(
    () => buildSpaceRoot(selectedProjectId, selectedProjectName),
    [selectedProjectId, selectedProjectName]
  );

  const [activeTab, setActiveTab] = useState<(typeof utilityTabs)[number]>(() => {
    const utility = searchParams.get("utility") as AnalysisUtilityKey | null;
    return utility && utilityKeyToLabel[utility] ? utilityKeyToLabel[utility] : "Electricity Analysis";
  });
  const [spaceLevel] = useState<AnalysisSpaceLevel>(() => {
    const value = searchParams.get("level") as AnalysisSpaceLevel | null;
    return value && analysisSpaceLevels.includes(value) ? value : analysisSpaceLevels[0];
  });
  const [timeRange] = useState<AnalysisTimeRange>(() => {
    const value = searchParams.get("range") as AnalysisTimeRange | null;
    return value && analysisTimeRanges.includes(value) ? value : analysisTimeRanges[2];
  });
  const [operationalProfile] = useState<OperationalProfileOption>(() => {
    const value = searchParams.get("profile") as OperationalProfileOption | null;
    return value && analysisOperationalProfiles.includes(value) ? value : analysisOperationalProfiles[1];
  });
  const [compareMode] = useState<CompareMode>(() => {
    const value = searchParams.get("compare") as CompareMode | null;
    return value && analysisCompareModes.includes(value) ? value : analysisCompareModes[0];
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    highlights: false,
    overall: false,
    ai: false,
    behaviour: false,
    forecast: false,
    cost: false,
    recommendation: false
  });

  const utilityKey: AnalysisUtilityKey = utilityLabelToKey[activeTab];
  const analysis = useMemo(() => {
    const base = analysisDataByUtility[utilityKey];
    const projectSeed = hashCode(selectedProjectId);
    const factor = 0.88 + ((projectSeed % 35) / 100);
    const scaledTotalEstimatedCost = scaleValue(base.costSummary.totalEstimatedCost, factor, 0);
    const scaledApplianceDistribution = base.applianceDistribution.map((item) => ({
      ...item,
      value: scaleValue(item.value, factor, 0)
    }));
    const totalDistributionValue = scaledApplianceDistribution.reduce((sum, item) => sum + item.value, 0);
    const scaledCostByTag = scaledApplianceDistribution.map((item, index, array) => {
      if (index === array.length - 1) {
        const allocated = array
          .slice(0, -1)
          .reduce((sum, _, previousIndex) => {
            const previousItem = array[previousIndex];
            const previousShare = totalDistributionValue > 0 ? previousItem.value / totalDistributionValue : 0;
            return sum + Math.round(scaledTotalEstimatedCost * previousShare);
          }, 0);
        return {
          name: item.tag,
          cost: Math.max(0, scaledTotalEstimatedCost - allocated),
          secondary: totalDistributionValue > 0 ? (item.value / totalDistributionValue) * 100 : 0
        };
      }
      const share = totalDistributionValue > 0 ? item.value / totalDistributionValue : 0;
      return {
        name: item.tag,
        cost: Math.round(scaledTotalEstimatedCost * share),
        secondary: share * 100
      };
    });

    return {
      ...base,
      highlights: base.highlights.map((item) => ({
        ...item,
        value: typeof item.value === "number" ? scaleValue(item.value, factor, item.value < 10 ? 2 : 0) : item.value
      })),
      profileData: base.profileData.map((point) => ({
        ...point,
        expected: scaleValue(point.expected, factor, 0),
        actual: scaleValue(point.actual, factor, 0)
      })),
      applianceDistribution: scaledApplianceDistribution,
      topConsumers: base.topConsumers.map((item) => ({
        ...item,
        consumption: scaleValue(item.consumption, factor, 0),
        intensity: scaleValue(item.intensity, factor, 1)
      })),
      anomalyStats: {
        ...base.anomalyStats,
        total: Math.max(1, scaleValue(base.anomalyStats.total, factor, 0)),
        critical: Math.max(0, scaleValue(base.anomalyStats.critical, factor, 0)),
        resolved: Math.max(0, scaleValue(base.anomalyStats.resolved, factor, 0)),
        pendingReview: Math.max(0, scaleValue(base.anomalyStats.pendingReview, factor, 0))
      },
      behaviour24h: base.behaviour24h.map((item) => ({
        ...item,
        baseline: scaleValue(item.baseline, factor, 0),
        actual: scaleValue(item.actual, factor, 0)
      })),
      costSummary: {
        ...base.costSummary,
        totalEstimatedCost: scaledTotalEstimatedCost,
        increaseVsPreviousPct: scaleValue(base.costSummary.increaseVsPreviousPct, factor, 1)
      },
      costByBlock: base.costByBlock.map((item) => ({
        ...item,
        cost: scaleValue(item.cost, factor, 0)
      })),
      costByTag: scaledCostByTag,
      costBySpace: base.costBySpace.map((item) => ({
        ...item,
        cost: scaleValue(item.cost, factor, 0),
        perCapitaCost:
          typeof item.perCapitaCost === "number" ? scaleValue(item.perCapitaCost, factor, 1) : undefined
      }))
    };
  }, [selectedProjectId, utilityKey]);
  const unitLabel = utilityKey === "electricity" ? "kWh" : "m3";
  const monthlyConsumptionTrend = useMemo(() => {
    const total = analysis.highlights.find((item) => item.key === "total")?.value;
    const totalValue = typeof total === "number" ? total : 10000;
    return Array.from({ length: 30 }, (_, index) => {
      const ratio = 0.8 + (((hashCode(`${selectedProjectId}-${utilityKey}-${index}`) % 36) / 100) * 0.8);
      return {
        label: `D${String(index + 1).padStart(2, "0")}`,
        total: Math.round((totalValue / 30) * ratio)
      };
    });
  }, [analysis.highlights, selectedProjectId, utilityKey]);

  const interval15MinSeries = useMemo(() => {
    const profile = analysis.behaviour24h.map((item) => Math.max(item.actual, 1));
    const profileSum = profile.reduce((sum, value) => sum + value, 0);
    const intervals: Array<{ value: number; dayIndex: number; slotIndex: number }> = [];

    monthlyConsumptionTrend.forEach((day, dayIndex) => {
      for (let slot = 0; slot < 96; slot += 1) {
        const hour = Math.floor(slot / 4);
        const hourWeight = profile[hour] / profileSum;
        const baseInterval = (day.total * hourWeight) / 4;
        const variance = 0.92 + ((hashCode(`${selectedProjectId}-${utilityKey}-${dayIndex}-${slot}`) % 17) / 100);
        intervals.push({
          value: baseInterval * variance,
          dayIndex,
          slotIndex: slot
        });
      }
    });

    return intervals;
  }, [analysis.behaviour24h, monthlyConsumptionTrend, selectedProjectId, utilityKey]);

  const peakWindow1h = useMemo(() => {
    let best = { sum: -1, startIndex: 0 };
    for (let index = 0; index <= interval15MinSeries.length - 4; index += 1) {
      const windowSum = interval15MinSeries[index].value + interval15MinSeries[index + 1].value + interval15MinSeries[index + 2].value + interval15MinSeries[index + 3].value;
      if (windowSum > best.sum) {
        best = { sum: windowSum, startIndex: index };
      }
    }

    const start = interval15MinSeries[best.startIndex];
    const end = interval15MinSeries[Math.min(best.startIndex + 4, interval15MinSeries.length - 1)];
    const startHour = Math.floor(start.slotIndex / 4);
    const startMinute = (start.slotIndex % 4) * 15;
    const endHour = Math.floor(end.slotIndex / 4);
    const endMinute = (end.slotIndex % 4) * 15;
    const dateLabel = formatDateLabel(start.dayIndex);
    const windowLabel = `${dateLabel} ${formatTime(startHour, startMinute)}-${formatTime(endHour, endMinute)}`;

    return {
      value: Math.round(best.sum * 10) / 10,
      windowLabel
    };
  }, [interval15MinSeries]);

  const keyHighlights = useMemo(
    () =>
      analysis.highlights.map((item) => {
        if (item.key !== "peak") {
          return item;
        }
        return {
          ...item,
          label: "Peak Demand (1h)",
          value: peakWindow1h.value,
          unit: unitLabel,
          note: `Highest 1-hour usage window at ${peakWindow1h.windowLabel}.`
        };
      }),
    [analysis.highlights, peakWindow1h.value, peakWindow1h.windowLabel, unitLabel]
  );

  const forecastTrend = useMemo(() => {
    const latest = monthlyConsumptionTrend.slice(-1)[0]?.total ?? 1000;
    return Array.from({ length: 10 }, (_, index) => {
      const day = `D${index + 21}`;
      const isHistorical = index < 5;
      const base = Math.round(latest * (0.95 + ((hashCode(`${selectedProjectId}-forecast-${index}`) % 16) / 100)));
      return {
        day,
        actual: isHistorical ? base : 0,
        forecast: isHistorical ? base : Math.round(base * (1.01 + index * 0.008))
      };
    });
  }, [monthlyConsumptionTrend, selectedProjectId]);
  const endOfMonthConsumption = useMemo(
    () => forecastTrend.reduce((sum, item) => sum + (item.actual > 0 ? item.actual : item.forecast), 0),
    [forecastTrend]
  );
  const billForecast = useMemo(() => {
    const tariff = utilityKey === "electricity" ? 0.3 : utilityKey === "water" ? 2.8 : 1.2;
    return Math.round(endOfMonthConsumption * tariff);
  }, [endOfMonthConsumption, utilityKey]);
  const peakRiskPct = useMemo(() => 55 + (hashCode(`${selectedProjectId}-peak-risk`) % 36), [selectedProjectId]);
  const allCollapsed = useMemo(
    () => Object.values(collapsedSections).every((value) => value),
    [collapsedSections]
  );

  const hydratedProjectFromQuery = useRef(false);

  // Apply ?project= from URL once on mount only. Do not sync URL -> state on every change,
  // otherwise stale query params overwrite the header dropdown selection.
  useEffect(() => {
    if (hydratedProjectFromQuery.current) {
      return;
    }
    hydratedProjectFromQuery.current = true;
    const projectFromQuery = searchParams.get("project");
    if (!projectFromQuery) {
      return;
    }
    const exists = availableProjects.some((project) => project.id === projectFromQuery);
    if (exists) {
      setSelectedProjectId(projectFromQuery);
    }
  }, [availableProjects, searchParams, setSelectedProjectId]);

  useEffect(() => {
    setSearchParams(
      {
        utility: utilityKey,
        project: selectedProjectId,
        level: spaceLevel,
        range: timeRange,
        profile: operationalProfile,
        compare: compareMode
      },
      { replace: true }
    );
  }, [compareMode, operationalProfile, selectedProjectId, setSearchParams, spaceLevel, timeRange, utilityKey]);

  function toggleSection(id: string) {
    setCollapsedSections((current) => ({
      ...current,
      [id]: !current[id]
    }));
  }

  function toggleAllSections() {
    setCollapsedSections((current) => {
      const shouldCollapse = !Object.values(current).every((value) => value);
      const next: Record<string, boolean> = {};
      Object.keys(current).forEach((key) => {
        next[key] = shouldCollapse;
      });
      return next;
    });
  }

  return (
    <PageContainer
      title="Analysis"
      subtitle={
        isEliteProject
          ? `${selectedProjectName} · Incoming meter & sub-meter energy analysis (15 Jun – 29 Jun 2026).`
          : isNapProject
          ? `${selectedProjectName} · Level 6 & 7 energy health analysis from 15-minute meter readings (19 May – 17 Jun 2026).`
          : "Turn utility data into operational insights, benchmarks, anomaly findings, and energy-saving recommendations."
      }
      breadcrumbs={["Home", "Analysis"]}
      actions={
        isDedicatedAnalysisProject ? null : (
        <button
          className="rounded-md border border-shell-600 bg-shell-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-shell-700"
          onClick={toggleAllSections}
        >
          {allCollapsed ? "Expand All Sections" : "Collapse All Sections"}
        </button>
        )
      }
    >
      <RequirementGuideProvider>
      {isEliteProject && eliteAnalysisData ? (
        <EliteAnalysisViewV2 data={eliteAnalysisData} />
      ) : isNapProject && napAnalysisData ? (
        napAnalysisData.projectId === NP_V2_PROJECT_ID ? (
          <NapAnalysisViewV2 data={napAnalysisData} />
        ) : (
          <NapAnalysisView data={napAnalysisData} />
        )
      ) : (
      <>
      <AnalysisTabs activeTab={activeTab} onChange={(tab) => setActiveTab(tab as (typeof utilityTabs)[number])} />

      <AnalysisSection
        id="highlights"
        title="Executive Summary"
        subtitle="Overall consumption summary, cost estimation, and key findings for this month."
        requirementGuide={SECTION_REQUIREMENTS.highlights}
        isCollapsed={collapsedSections.highlights}
        onToggle={toggleSection}
      >
        <KeyHighlightCards cards={keyHighlights} />
        <div className="mt-4">
          <ConsumptionBreakdownChart
            utilityKey={utilityKey}
            projectId={selectedProjectId}
            projectName={selectedProjectName}
            unitLabel={unitLabel}
            spaceRootOverride={sharedSpaceRoot}
            totalConsumption={
              typeof keyHighlights.find((item) => item.key === "total")?.value === "number"
                ? (keyHighlights.find((item) => item.key === "total")?.value as number)
                : 10000
            }
          />
        </div>
        <div className="mt-4">
          <CostAnalysisSection
            projectId={selectedProjectId}
            projectName={selectedProjectName}
            spaceRootOverride={sharedSpaceRoot}
            totalEstimatedCost={analysis.costSummary.totalEstimatedCost}
            highestCostBlock={analysis.costSummary.highestCostBlock}
            highestCostRoom={analysis.costSummary.highestCostRoom}
            increaseVsPreviousPct={analysis.costSummary.increaseVsPreviousPct}
            costByBlock={analysis.costByBlock}
            costByTag={analysis.costByTag}
          />
        </div>
        <div className="mt-4">
          <SummaryOfFindings findings={analysis.findings} />
        </div>
      </AnalysisSection>

      <AnalysisSection
        id="overall"
        title="Day Profile Analysis"
        subtitle="Weekday, Weekend, and Holiday profile overview with 24-hour stacked comparison."
        requirementGuide={SECTION_REQUIREMENTS.overall}
        isCollapsed={collapsedSections.overall}
        onToggle={toggleSection}
      >
        <OverallEnergyConsumptionSection
          behaviour24h={analysis.behaviour24h}
          applianceDistribution={analysis.applianceDistribution}
          spaceRoot={sharedSpaceRoot}
          timeRange={timeRange}
          unitLabel={unitLabel}
        />
      </AnalysisSection>

      <AnalysisSection
        id="behaviour"
        title="Time-based Behavioral Analysis"
        subtitle="Daily trend and anomaly analysis across selected spaces."
        requirementGuide={SECTION_REQUIREMENTS.behaviour}
        isCollapsed={collapsedSections.behaviour}
        onToggle={toggleSection}
      >
        <div className="mb-4">
          <DailyTrendAnomalyAnalysisSection
            projectId={selectedProjectId}
            utilityKey={utilityKey}
            dailyTotals30d={monthlyConsumptionTrend}
            spaceRoot={sharedSpaceRoot}
            unitLabel={unitLabel}
          />
        </div>
      </AnalysisSection>

      <AnalysisSection
        id="forecast"
        title="Forecast & Prediction"
        subtitle="End-of-month consumption, bill forecast, and peak risk estimation."
        requirementGuide={SECTION_REQUIREMENTS.forecast}
        isCollapsed={collapsedSections.forecast}
        onToggle={toggleSection}
      >
        <ForecastPredictionSection
          points={forecastTrend}
          endOfMonthConsumption={endOfMonthConsumption}
          billForecast={billForecast}
          peakRiskPct={peakRiskPct}
          unitLabel={unitLabel}
        />
      </AnalysisSection>

      <AnalysisSection
        id="ai"
        title="AI Insight Engine"
        subtitle="Behavioral insight, anomaly recommendation, and benchmarking context."
        requirementGuide={SECTION_REQUIREMENTS.ai}
        isCollapsed={collapsedSections.ai}
        onToggle={toggleSection}
      >
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <AIUtilityAssistant templates={analysis.assistantTemplates} />
          <EfficiencyBenchmarkCard data={analysis.efficiency} />
        </div>
      </AnalysisSection>

      <AnalysisSection
        id="recommendation"
        title="Personalized Recommendations"
        subtitle="Action-oriented optimization cards."
        requirementGuide={SECTION_REQUIREMENTS.recommendation}
        isCollapsed={collapsedSections.recommendation}
        onToggle={toggleSection}
      >
        <RecommendationCards items={analysis.recommendations} />
      </AnalysisSection>

      {utilityKey === "water" ? (
        <div className="panel p-3 text-xs text-slate-400">PUB water balance mention: integrate PUB-specific balance checks in next phase.</div>
      ) : null}
      </>
      )}
      </RequirementGuideProvider>
    </PageContainer>
  );
}

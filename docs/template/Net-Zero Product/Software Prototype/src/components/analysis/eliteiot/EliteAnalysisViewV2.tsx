import { useMemo, useState } from "react";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { NapKeyHighlightCards } from "@/components/analysis/nap/NapKeyHighlightCards";
import { EliteConsumptionBreakdownChart } from "@/components/analysis/eliteiot/EliteConsumptionBreakdownChart";
import { EliteDayProfileAnalysisSection } from "@/components/analysis/eliteiot/EliteDayProfileAnalysisSection";
import { EliteEnergyDistributionSection } from "@/components/analysis/eliteiot/EliteEnergyDistributionSection";
import { EliteDailyTrendAnomalySection } from "@/components/analysis/eliteiot/EliteDailyTrendAnomalySection";
import {
  EliteCircuitRankingTable,
  EliteDataSourceBanner,
  EliteInsightsPanel
} from "@/components/analysis/eliteiot/EliteAnalysisSections";
import { RecommendationCards } from "@/components/analysis/RecommendationCards";
import { EliteSummaryOfFindings } from "@/components/analysis/eliteiot/EliteSummaryOfFindings";
import { ELITE_SECTION_GUIDES } from "@/components/analysis/eliteiot/eliteiotSectionGuides";
import { NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";
import { formatIsoDateRangeWithWeekday } from "@/components/analysis/nap/napDateFormat";
import { resolveTopPeaks } from "@/components/analysis/nap/napPeakHelpers";

import type { EliteCategoryScope } from "@/components/analysis/eliteiot/eliteiotCategoryConfig";

type TrendCategoryScope = EliteCategoryScope;

interface EliteAnalysisViewV2Props {
  data: NapEnergyAnalysisData;
}

/** EliteIOT layout — daily trend and anomaly list above executive summary (v2-style). */
export function EliteAnalysisViewV2({ data }: EliteAnalysisViewV2Props) {
  const topPeaks = useMemo(() => resolveTopPeaks(data.topPeaks), [data.topPeaks]);
  const [trendSpaceScope, setTrendSpaceScope] = useState<TrendCategoryScope>("incoming");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    highlights: false,
    overall: false,
    behaviour: false,
    circuits: false,
    recommendation: false
  });

  const allCollapsed = useMemo(
    () => Object.values(collapsedSections).every((value) => value),
    [collapsedSections]
  );

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

  const periodLabel = formatIsoDateRangeWithWeekday(data.meta.periodStart, data.meta.periodEnd);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          className="rounded-md border border-shell-600 bg-shell-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-shell-700"
          onClick={toggleAllSections}
        >
          {allCollapsed ? "Expand All Sections" : "Collapse All Sections"}
        </button>
      </div>

      <EliteDataSourceBanner data={data} />

      <div className="mb-4">
        <EliteDailyTrendAnomalySection
          data={data}
          spaceScope={trendSpaceScope}
          onSpaceScopeChange={setTrendSpaceScope}
          dayTypeFilterEnabled
          deviceHeatmapDetail
        />
      </div>

      <AnalysisSection
        id="highlights"
        title="Executive Summary"
        subtitle={`${data.projectName} · Incoming meter & sub-meter analysis, ${periodLabel}.`}
        requirementGuide={ELITE_SECTION_GUIDES.highlights}
        isCollapsed={collapsedSections.highlights}
        onToggle={toggleSection}
      >
        <NapKeyHighlightCards
          cards={data.highlights}
          breakdowns={data.highlightBreakdowns}
          topPeaks={topPeaks}
          previousPeriodLabel="No prior period in dataset"
          variant="elite"
        />
        <div className="mt-4">
          <EliteConsumptionBreakdownChart data={data} />
        </div>
        <EliteEnergyDistributionSection data={data} />
        <div className="mt-4">
          <EliteSummaryOfFindings sections={data.findings} />
        </div>
      </AnalysisSection>

      <AnalysisSection
        id="overall"
        title="Day Profile Analysis"
        subtitle="Weekday and weekend profile overview with 24-hour stacked comparison."
        requirementGuide={ELITE_SECTION_GUIDES.overall}
        isCollapsed={collapsedSections.overall}
        onToggle={toggleSection}
      >
        <EliteDayProfileAnalysisSection data={data} />
      </AnalysisSection>

      <AnalysisSection
        id="behaviour"
        title="Time-based Behavioral Analysis"
        subtitle="Day-type energy health indicators for incoming and sub-meter type groups."
        requirementGuide={ELITE_SECTION_GUIDES.behaviour}
        isCollapsed={collapsedSections.behaviour}
        onToggle={toggleSection}
      >
        <EliteInsightsPanel data={data} />
      </AnalysisSection>

      <AnalysisSection
        id="circuits"
        title="Circuit Category Analysis"
        subtitle="Sub-meter ranking by appliance category (F&B, Lighting, IT Devices, General Plug)."
        requirementGuide={ELITE_SECTION_GUIDES.circuits}
        isCollapsed={collapsedSections.circuits}
        onToggle={toggleSection}
      >
        <EliteCircuitRankingTable data={data} />
      </AnalysisSection>

      <AnalysisSection
        id="recommendation"
        title="Personalized Recommendations"
        subtitle="Operational actions derived from observed EliteIOT consumption patterns."
        requirementGuide={ELITE_SECTION_GUIDES.recommendation}
        isCollapsed={collapsedSections.recommendation}
        onToggle={toggleSection}
      >
        <RecommendationCards items={data.recommendations} variant="nap" />
      </AnalysisSection>
    </>
  );
}

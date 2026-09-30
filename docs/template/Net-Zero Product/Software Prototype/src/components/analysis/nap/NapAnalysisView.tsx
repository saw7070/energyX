import { useMemo, useState } from "react";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { NapKeyHighlightCards } from "@/components/analysis/nap/NapKeyHighlightCards";
import {
  NapConsumptionBreakdownChart
} from "@/components/analysis/nap/NapConsumptionBreakdownChart";
import { NapDayProfileAnalysisSection } from "@/components/analysis/nap/NapDayProfileAnalysisSection";
import { NapEnergyDistributionSection } from "@/components/analysis/nap/NapEnergyDistributionSection";
import { NapDailyTrendAnomalySection } from "@/components/analysis/nap/NapDailyTrendAnomalySection";
import {
  NapCircuitRankingTable,
  NapDataSourceBanner,
  NapInsightsPanel
} from "@/components/analysis/nap/NapAnalysisSections";
import { RecommendationCards } from "@/components/analysis/RecommendationCards";
import { NapSummaryOfFindings } from "@/components/analysis/nap/NapSummaryOfFindings";
import { NAP_SECTION_GUIDES } from "@/components/analysis/nap/napSectionGuides";
import { NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";
import { formatIsoDateRangeWithWeekday } from "@/components/analysis/nap/napDateFormat";
import { resolveTopPeaks } from "@/components/analysis/nap/napPeakHelpers";

interface NapAnalysisViewProps {
  data: NapEnergyAnalysisData;
}

export function NapAnalysisView({ data }: NapAnalysisViewProps) {
  const topPeaks = useMemo(() => resolveTopPeaks(data.topPeaks), [data.topPeaks]);
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

      <NapDataSourceBanner data={data} />

      <AnalysisSection
        id="highlights"
        title="Executive Summary"
        subtitle={`${data.projectName} · Level 6 & 7 electricity analysis, ${formatIsoDateRangeWithWeekday(data.meta.periodStart, data.meta.periodEnd)}.`}
        requirementGuide={NAP_SECTION_GUIDES.highlights}
        isCollapsed={collapsedSections.highlights}
        onToggle={toggleSection}
      >
        <NapKeyHighlightCards
          cards={data.highlights}
          breakdowns={data.highlightBreakdowns}
          topPeaks={topPeaks}
          previousPeriodLabel={formatIsoDateRangeWithWeekday(
            data.meta.previousPeriodStart,
            data.meta.previousPeriodEnd
          )}
        />
        <div className="mt-4">
          <NapConsumptionBreakdownChart data={data} />
        </div>
        <NapEnergyDistributionSection data={data} />
        <div className="mt-4">
          <NapSummaryOfFindings sections={data.findings} />
        </div>
      </AnalysisSection>

      <AnalysisSection
        id="overall"
        title="Day Profile Analysis"
        subtitle="Weekday, weekend, and holiday profile overview with 24-hour stacked comparison."
        requirementGuide={NAP_SECTION_GUIDES.overall}
        isCollapsed={collapsedSections.overall}
        onToggle={toggleSection}
      >
        <NapDayProfileAnalysisSection data={data} />
      </AnalysisSection>

      <AnalysisSection
        id="behaviour"
        title="Time-based Behavioral Analysis"
        subtitle="Daily trend and anomaly analysis across Level 6 and Level 7 aggregate meters."
        requirementGuide={NAP_SECTION_GUIDES.behaviour}
        isCollapsed={collapsedSections.behaviour}
        onToggle={toggleSection}
      >
        <NapDailyTrendAnomalySection data={data} />
        <div className="mt-4">
          <NapInsightsPanel data={data} />
        </div>
      </AnalysisSection>

      <AnalysisSection
        id="circuits"
        title="Circuit Category Analysis"
        subtitle="Sub-meter ranking for Level 6 and Level 7 office circuits."
        requirementGuide={NAP_SECTION_GUIDES.circuits}
        isCollapsed={collapsedSections.circuits}
        onToggle={toggleSection}
      >
        <NapCircuitRankingTable data={data} />
      </AnalysisSection>

      <AnalysisSection
        id="recommendation"
        title="Personalized Recommendations"
        subtitle="Operational actions derived from observed consumption patterns in the source data."
        requirementGuide={NAP_SECTION_GUIDES.recommendation}
        isCollapsed={collapsedSections.recommendation}
        onToggle={toggleSection}
      >
        <RecommendationCards items={data.recommendations} variant="nap" />
      </AnalysisSection>
    </>
  );
}

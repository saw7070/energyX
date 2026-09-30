import { RequirementGuideContent } from "@/components/analysis/RequirementGuide";

export const NAP_SECTION_GUIDES: Record<string, RequirementGuideContent> = {
  highlights: {
    title: "Executive Summary",
    summary:
      "High-level KPIs, daily consumption breakdown, tag distribution, and grouped findings for Level 6 & 7.",
    dataAcquisition: [
      "Monitoring period: 19 May–17 Jun 2026 (30 days) from aggregate meters on both floors.",
      "Sub-meters supply tag and circuit splits; aggregate meters remain the source of truth for totals.",
      "Previous period (21 Apr–20 May 2026) supports total and daily-average trend comparison.",
      "Anomaly baseline is calibrated separately over 21 Apr–17 Jun 2026 (58 days, incl. 1 May Labour Day)."
    ],
    chartGeneration: [
      "Expandable highlight cards with meter-level drill-down and top-5 peak windows.",
      "Consumption Breakdown (tag/space), Energy Distribution, and themed Summary of Findings cards."
    ]
  },
  overall: {
    title: "Day Profile Analysis",
    summary: "Compare typical weekday, weekend, and holiday hourly load shapes by tag and by level.",
    dataAcquisition: [
      "Sum sub-meter 15-minute deltas into clock-hour buckets per calendar day.",
      "Average hourly profiles within each day-type sample in the monitoring period (19 May–17 Jun 2026).",
      "Public holidays in the monitoring window: 27 May (Vesak Day) and 1 Jun (Public Holiday).",
      "Day-type heatmaps use the same fixed kWh/h colour scale per level across weekday, weekend, and holiday."
    ],
    chartGeneration: [
      "Stacked 24-hour profile by Lighting / Office Load / Ventilation-Fan with shared Y-axis max.",
      "Daily Usage Pattern by Level: level table, sub-meter list, and day-type heatmap after level selection."
    ]
  },
  behaviour: {
    title: "Time-based Behavioral Analysis",
    summary: "Daily aggregate trend, anomaly detection, and day-type energy health indicators.",
    dataAcquisition: [
      "Trend chart uses 30-day monitoring window on aggregate meters (Level 6 + Level 7 or per floor).",
      "Expected baseline = day-type mean over 21 Apr–17 Jun 2026; threshold = baseline × 115%.",
      "Holiday classification follows SG public holidays (incl. 1 May Labour Day in baseline window).",
      "Anomaly when daily total exceeds the same day-type baseline by more than 15%."
    ],
    chartGeneration: [
      "Daily Total Trend with smooth baseline/threshold lines and anomaly markers.",
      "Detected Anomaly List opens hourly category drill-down vs day-type reference profile."
    ]
  },
  circuits: {
    title: "Circuit Category Analysis",
    summary: "Rank sub-meter circuits by total kWh over the monitoring period.",
    dataAcquisition: [
      "Sum sub-meter daily deltas per device across 19 May–17 Jun 2026.",
      "Classify each circuit as Lighting, Office Load, or Ventilation/Fan from device naming.",
      "Variance column compares each circuit to the average of the top 10 ranked circuits."
    ],
    chartGeneration: [
      "Table ranks top circuits with floor, category, consumption (kWh), and variance vs top-10 average."
    ]
  },
  recommendation: {
    title: "Personalized Recommendations",
    summary: "Operational actions derived from dominant circuits, anomalies, after-hours share, and weekend schedule shifts.",
    dataAcquisition: [
      "Rules triggered by top fan/load circuits, mid-June anomaly days, after-hours weekday share, and weekend profile change.",
      "Each item includes affected area, priority, reason grounded in observed data, and suggested action."
    ],
    chartGeneration: [
      "Priority-coded recommendation cards with action-log affordance."
    ]
  }
};

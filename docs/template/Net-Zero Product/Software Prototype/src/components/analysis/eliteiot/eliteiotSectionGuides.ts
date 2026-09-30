import { RequirementGuideContent } from "@/components/analysis/RequirementGuide";

export const ELITE_SECTION_GUIDES: Record<string, RequirementGuideContent> = {
  highlights: {
    title: "Executive Summary",
    summary:
      "Incoming-meter KPIs, sub-meter category breakdown, and grouped findings for EliteIOT Office (15–29 Jun 2026).",
    dataAcquisition: [
      "Monitoring period: 15–29 Jun 2026 (15 days) from Incoming 3Phase main incomer.",
      "Nine sub-meters supply category and circuit splits (~11% of incoming — unmetered load is mostly HVAC/base building).",
      "No prior-period Excel file — trend cards show 0% delta; baseline uses this window only.",
      "Anomaly baseline: weekday/weekend/holiday means over the same 15-day window on incoming totals (Malaysia holiday: 17 Jun)."
    ],
    chartGeneration: [
      "Expandable highlight cards with type-group drill-down and top-5 peak clock-hour windows.",
      "Consumption Breakdown (category/type-group), Energy Distribution, and themed Summary of Findings."
    ]
  },
  overall: {
    title: "Day Profile Analysis",
    summary: "Compare weekday/weekend/holiday hourly load shapes by category and by type group.",
    dataAcquisition: [
      "Sum sub-meter 15-minute deltas into clock-hour buckets per calendar day.",
      "Average hourly profiles within each day-type sample in the monitoring period.",
      "Malaysia public holiday in scope: 17 Jun 2026 (Hari Raya Haji).",
      "Type groups: F&B + Lighting (A18P/B3B/B8P/B9P/B2R/B11P) vs IT Devices + General Plug (B5B/B4B/B6B/B6P alias)."
    ],
    chartGeneration: [
      "Stacked 24-hour profile by mapped category series with shared Y-axis max.",
      "Daily usage pattern by type group with sub-meter list and day-type heatmap."
    ]
  },
  behaviour: {
    title: "Time-based Behavioral Analysis",
    summary: "Incoming daily trend, anomaly detection, and day-type energy health indicators.",
    dataAcquisition: [
      "Daily Total Trend uses Incoming 3Phase totals (sub-meter type groups shown for context).",
      "Expected baseline = day-type mean over 15–29 Jun 2026; threshold = baseline × 115%.",
      "Anomaly when daily incoming total exceeds the same day-type baseline by more than 15%.",
      "Device heatmaps in anomaly detail show sub-meter × 24h kWh for the selected day."
    ],
    chartGeneration: [
      "Daily Total Trend with baseline/threshold lines and anomaly markers.",
      "Detected Anomaly List with device heatmaps (overlay %, spike kWh, day-type average)."
    ]
  },
  circuits: {
    title: "Circuit Category Analysis",
    summary: "Rank sub-meter circuits by total kWh over the monitoring period.",
    dataAcquisition: [
      "Sum each sub-meter's kWh over 15–29 Jun 2026.",
      "Categories: F&B, Lighting, IT Devices, General Plug.",
      "Rank by total kWh; show top 10 with variance vs the average of those top 10."
    ],
    chartGeneration: ["Table with rank, circuit, type group, category, consumption, and vs-average delta."]
  },
  recommendation: {
    title: "Personalized Recommendations",
    summary: "Operational actions derived from observed EliteIOT consumption patterns.",
    dataAcquisition: [
      "Rules follow equipment semantics: F&B after-hours standby, daytime lighting waste, IT baseline protection, and unknown plug verification."
    ],
    chartGeneration: ["Priority-sorted recommendation cards with reason and suggested action."]
  }
};

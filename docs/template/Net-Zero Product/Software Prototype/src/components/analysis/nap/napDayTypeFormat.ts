import { NapDailyTotalRow } from "@/mock/napEnergyAnalysisData";

type NapDayType = NapDailyTotalRow["dayType"];

/**
 * Format day type for display.
 */
export function formatNapDayTypeLabel(dayType: NapDayType): string {
  if (dayType === "holiday") {
    return "Holiday";
  }
  if (dayType === "weekend") {
    return "Weekend";
  }
  return "Weekday";
}

/**
 * Tooltip label and swatch color for day type rows in charts.
 */
export function getNapDayTypeTooltipMeta(dayType: NapDayType): { label: string; swatch: string } {
  if (dayType === "holiday") {
    return {
      label: "Public Holiday",
      swatch: "#fbbf24"
    };
  }
  if (dayType === "weekend") {
    return { label: "Weekend", swatch: "#94a3b8" };
  }
  return { label: "Weekday", swatch: "#64748b" };
}

import { NapPeakWindow } from "@/mock/napEnergyAnalysisData";
import { formatIsoDateWithWeekday } from "@/components/analysis/nap/napDateFormat";

/**
 * Resolve top clock-hour peaks from generated dataset.
 */
export function resolveTopPeaks(topPeaks: NapPeakWindow[] | undefined): NapPeakWindow[] {
  return topPeaks ?? [];
}

export function formatPeakWindowLabel(window: string) {
  const [datePart, timePart] = window.split(" ");
  if (!datePart || !timePart) {
    return window;
  }
  const dateLabel = formatIsoDateWithWeekday(datePart);
  return `${dateLabel} · ${timePart.replace("-", "–")}`;
}

export function formatPeakClockRange(window: string) {
  const timePart = window.split(" ")[1];
  if (!timePart) {
    return window;
  }
  return timePart.replace("-", "–");
}

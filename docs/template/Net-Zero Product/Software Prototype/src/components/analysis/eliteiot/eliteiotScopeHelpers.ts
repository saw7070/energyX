import type {
  EliteCategoryScope,
  EliteEnergyAnalysisData
} from "@/mock/eliteiotEnergyAnalysisData";
import type { NapDailyTotalRow, NapHourlyRow } from "@/mock/napEnergyAnalysisData";

export function asEliteData(data: NapEnergyAnalysisData): EliteEnergyAnalysisData {
  return data as EliteEnergyAnalysisData;
}

type NapEnergyAnalysisData = import("@/mock/napEnergyAnalysisData").NapEnergyAnalysisData;

export function getEliteScopeBundle(data: EliteEnergyAnalysisData, scope: EliteCategoryScope) {
  return data.eliteCategoryScopes[scope];
}

export function getEliteScopedDailyTotals(
  data: EliteEnergyAnalysisData,
  scope: EliteCategoryScope
): NapDailyTotalRow[] {
  return getEliteScopeBundle(data, scope).dailyTotals;
}

export function getEliteScopedBaseline(data: EliteEnergyAnalysisData, scope: EliteCategoryScope) {
  return getEliteScopeBundle(data, scope).baselineMeta;
}

export function getEliteScopedProfileHourly(
  data: EliteEnergyAnalysisData,
  scope: EliteCategoryScope,
  dayType: "weekday" | "weekend" | "holiday"
): NapHourlyRow[] {
  const rows = getEliteScopeBundle(data, scope).profileHourlyByDayType[dayType];
  return rows.map((row) => ({ hour: row.hour, total: row.total }));
}

export function getEliteScopedDailyHourly(
  data: EliteEnergyAnalysisData,
  scope: EliteCategoryScope,
  date: string
): NapHourlyRow[] {
  const rows = getEliteScopeBundle(data, scope).dailyHourlyByDate[date] ?? [];
  return rows.map((row) => ({ hour: row.hour, total: row.total }));
}

export function getEliteScopeDevices(data: EliteEnergyAnalysisData, scope: EliteCategoryScope): string[] {
  return getEliteScopeBundle(data, scope).devices;
}

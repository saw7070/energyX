/**
 * The shape of the readings the Analysis page loads, shared by the browser (which fetches them) and the server (which
 * only has to read them). Loading lives in apps/web's analysis-data.ts, which re-exports these types unchanged.
 */
import type { AnalysisCategory, HoursByDay } from "./analysis-model.js";

export type TrendCell = [string, number, number | null, number, number];
export type TrendSeries = { id: string; expectedMinutesPerHour: number; cells: TrendCell[] };
export type ScopeMeter = { id: string; name: string; location: string; category: AnalysisCategory | "overall"; official: boolean; series: TrendSeries | null };
export type ScopeCircuit = { id: string; name: string; location: string; category: AnalysisCategory | "overall"; kwh: number; previousKwh: number | null };
/** One space (or the whole project) for one period, straight from the Energy consumption engine. */
export type ScopeData = {
  id: string; name: string; dates: string[]; timezone: string;
  total: TrendSeries | null; types: Partial<Record<AnalysisCategory, TrendSeries>>; meters: ScopeMeter[];
  usageKwh: number | null; peakKw: number | null; peakAt: string | null;
  /** `note` is the rate in English (the site report reads it); `rates` and `basis` let the page word it in the reader's language. */
  cost: { amount: number; currency: string; note: string; rates?: number[]; basis?: string | null } | null;
  typeTotals: Partial<Record<AnalysisCategory, number>>; coverage: number | null;
};
export type LoadedPeriod = { project: ScopeData; spaces: ScopeData[] };
export type ProjectAction = { id: string; title: string; recommendation: string; state: string; priority: { level: "high" | "medium" | "low"; reason: string } };
export type AnalysisData = {
  projectId: string; projectName: string; timezone: string; snapshotId: string | null;
  current: LoadedPeriod; previous: LoadedPeriod | null; history: ScopeData | null; circuits: ScopeCircuit[];
  holidays: Map<string, string>; openingHours: HoursByDay | null; actions: ProjectAction[];
};

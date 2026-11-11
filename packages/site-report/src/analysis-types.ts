/**
 * The shape of the readings the Analysis page loads, shared by the browser (which fetches them) and the server (which
 * only has to read them). Loading lives in apps/web's analysis-data.ts, which re-exports these types unchanged.
 */
import type { AnalysisCategory, HoursByDay, HoursMeaning } from "./analysis-model.js";
import type { GroupedMeter, MeterGroup } from "./meter-groups.js";
import type { NotInUseMeter } from "./meters-in-use.js";

export type TrendCell = [string, number, number | null, number, number];
export type TrendSeries = { id: string; expectedMinutesPerHour: number; cells: TrendCell[] };
/** `name` is the short name when one is set; `fullName` is then the installer's full label, shown underneath. */
export type ScopeMeter = { id: string; name: string; fullName?: string | undefined; location: string; category: AnalysisCategory | "overall"; official: boolean; series: TrendSeries | null };
export type ScopeCircuit = { id: string; name: string; fullName?: string | undefined; location: string; category: AnalysisCategory | "overall"; kwh: number; previousKwh: number | null };
/** The project's groups and, for the chosen dates, every meter's energy filed in the group it serves. */
export type AnalysisGroups = { list: MeterGroup[]; meters: GroupedMeter[] };
/** One space (or the whole project) for one period, straight from the Energy consumption engine. */
export type ScopeData = {
  id: string; name: string; dates: string[]; timezone: string;
  total: TrendSeries | null; types: Partial<Record<AnalysisCategory, TrendSeries>>; meters: ScopeMeter[];
  usageKwh: number | null; peakKw: number | null; peakAt: string | null;
  /** `note` is the rate in English (the site report reads it); `rates` and `basis` let the page word it in the reader's language. */
  cost: { amount: number; currency: string; note: string; rates?: number[]; basis?: string | null; peak?: { cost: number; usageKwh: number } } | null;
  typeTotals: Partial<Record<AnalysisCategory, number>>; coverage: number | null;
};
export type LoadedPeriod = { project: ScopeData; spaces: ScopeData[] };
export type ProjectAction = { id: string; title: string; recommendation: string; state: string; priority: { level: "high" | "medium" | "low"; reason: string } };
export type AnalysisData = {
  projectId: string; projectName: string; timezone: string; snapshotId: string | null;
  current: LoadedPeriod; previous: LoadedPeriod | null; history: ScopeData | null; circuits: ScopeCircuit[];
  holidays: Map<string, string>; openingHours: HoursByDay | null; actions: ProjectAction[];
  /** What the published hours mean; absent means opening hours. "lights_on": lighting that should run in them, usually at night. */
  hoursMeaning?: HoursMeaning | undefined;
  /**
   * Meters whose quiet spell meant they were using nothing when these readings were loaded: the live check found them
   * online and they can rightly use nothing (never lighting on a lights-on-hours site, nor a meter always on by design).
   * A meter sends its total only when it moves, so such a meter is idle, not stopped. Absent on older readings.
   */
  idleWhenQuiet?: string[] | undefined;
  /** Missing on readings saved before groups existed; everything then falls back to the old per-space view. */
  groups?: AnalysisGroups | undefined;
  /**
   * Meters someone marked "not in use" on Data availability. Their silence is expected, so they never stop a day from
   * counting as complete in the site report. Absent on readings saved before this was kept, and when there are none.
   */
  notInUse?: NotInUseMeter[] | undefined;
};

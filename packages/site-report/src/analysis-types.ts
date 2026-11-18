/**
 * The shape of the readings the Analysis page loads, shared by the browser (which fetches them) and the server (which
 * only has to read them). Loading lives in apps/web's analysis-data.ts, which re-exports these types unchanged.
 */
import type { AnalysisCategory, HoursByDay, HoursMeaning } from "./analysis-model.js";
import type { GroupedMeter, MeterGroup } from "./meter-groups.js";
import type { NotInUseMeter } from "./meters-in-use.js";
import type { AlwaysOnMeter } from "./always-on-by-design.js";

/**
 * [date, hour, kWh read on time, minutes read on time, intervals not read on time, kWh sent late]. The last is energy a
 * meter counted while offline and sent when it came back, spread over the hours it was offline; older saved reports
 * have no such entry. It counts in daily totals, but its hours stay incomplete.
 */
export type TrendCell = [string, number, number | null, number, number, number?];
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
   * online and they can rightly use nothing (never lighting on a lights-on-hours site, nor a meter always on by design),
   * and they had sent nothing since these dates ended, so the same quiet spell reaches back into them. A meter sends
   * its total only when it moves, so such a meter is idle, not stopped. Absent on older readings.
   */
  idleWhenQuiet?: string[] | undefined;
  /** Missing on readings saved before groups existed; everything then falls back to the old per-space view. */
  groups?: AnalysisGroups | undefined;
  /**
   * Meters someone marked "not in use" on Data availability. Their silence is expected, so they never stop a day from
   * counting as complete in the site report. Absent on readings saved before this was kept, and when there are none.
   */
  notInUse?: NotInUseMeter[] | undefined;
  /**
   * Meters meant to run day and night (emergency lighting): someone ticked "always on" on the meter. They count in
   * every total, but their use in the daytime is expected, so it is never called daytime use or a saving. Absent on
   * readings saved before this was kept, and when there are none.
   */
  alwaysOnByDesign?: AlwaysOnMeter[] | undefined;
  /**
   * How many light points a meter feeds, for the meters someone recorded it on (presentation.light_count). The report
   * shows energy per light for these only. Absent on readings saved before this was kept, and when there are none.
   */
  lightCounts?: LightCountMeter[] | undefined;
  /**
   * The tax on the electricity price (Singapore's 9% GST) from the site's tariff for these dates. The energy review
   * quotes costs including it when the rate is published before tax. Absent on older readings and with no tax set.
   */
  tariffTax?: { name: string; ratePct: number } | undefined;
  /**
   * The site's grid emission factor: the one set in Facility → Budget & carbon, or the country's official figure. The
   * energy review shows carbon with it. Absent on older readings.
   */
  carbon?: { kgCo2ePerKwh: number; year: number; source: string } | undefined;
  /**
   * What the site's people told the AI about earlier reports and an admin approved ("the pavilion fan must never run").
   * Active memory only; `date` is when it was written. The energy review lists it in its appendix. Absent on older
   * readings and when there is none.
   */
  feedbackMemory?: FeedbackMemoryItem[] | undefined;
  /**
   * Things the AI was asked to check in a later report, from feedback on an earlier one: open ones, and ones closed in
   * the last 31 days. The energy review shows them after its points to check. Absent on older readings and when there
   * are none.
   */
  followUps?: ReportFollowUp[] | undefined;
  /**
   * Points to check that an admin marked as known (a meter that is offline on purpose). The energy review leaves out
   * any point whose key is here; see EnergyReviewCheck.key. Absent on older readings and when there are none.
   */
  dismissedChecks?: DismissedCheck[] | undefined;
};
/** A meter and how many light points it feeds; `name` as readers know it. */
export type LightCountMeter = { id: string; name: string; count: number };
/** One thing the AI remembers about the site, from feedback on a report. */
export type FeedbackMemoryItem = { text: string; date: string };
export type ReportFollowUpStatus = "open" | "done" | "dropped";
export type ReportFollowUpVerdict = "resolved" | "ongoing" | "unclear";
/** One follow-up; `lastCheck` is the AI's latest look at it against the readings, when it has looked. */
export type ReportFollowUp = {
  text: string; status: ReportFollowUpStatus; createdAt: string;
  lastCheck?: { at: string; verdict: ReportFollowUpVerdict; evidence: string } | undefined;
};
/** A point to check left out of the reports: its stable key, the title it had, and why it was set aside. */
export type DismissedCheck = { key: string; title: string; reason: string };

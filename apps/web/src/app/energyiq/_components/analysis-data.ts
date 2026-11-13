/**
 * Loads the readings the Analysis page and the site report work from.
 *
 * Only the loading lives here. The *shape* of those readings and the mapping that produces them live in
 * @datafoundry/site-report, so the server can build exactly the same readings on a schedule; both are re-exported
 * here unchanged, so every page keeps importing them from this file.
 */
import { configApi, type EnergyMeterHealthDto, type EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { type HoursByDay } from "./analysis-model";
import { analysisComparisonDates, assembleAnalysisData, MAX_ANALYSIS_SPACES, type AnalysisData, type ProjectAction } from "@datafoundry/site-report";

export type { AnalysisData, LoadedPeriod, ProjectAction, ScopeCircuit, ScopeData, ScopeMeter, TrendCell, TrendSeries } from "@datafoundry/site-report";
export { categoryOf, toScope } from "@datafoundry/site-report";

export type AnalysisRange = { kind: "latest-28" } | { kind: "all" } | { kind: "custom"; from: string; to: string };

/** How far behind the newest reading a meter may fall before it is quiet: half a day (as meter health and the server). */
const QUIET_AFTER_MS = 12 * 60 * 60_000;
/**
 * The meters these readings may treat as idle through their last day, sorted: quiet now (half a day behind the newest
 * reading, and not marked not in use), idle at the latest live check (online, and a meter that can rightly use
 * nothing), and with no reading after the last day. The browser's copy of the server's idleThroughPeriodEnd
 * (energy-idle-meters.ts), so the Overview and Analysis judge complete days as the saved reports do.
 */
export function idleThroughLastDay(meters: EnergyMeterHealthDto["meters"], lastDate: string | undefined, timezone: string): string[] {
  if (!lastDate) return [];
  const sending = meters.filter(meter => meter.status === "usable" && meter.lastReadingAt && !meter.notInUse);
  const newest = sending.reduce((latest, meter) => Math.max(latest, Date.parse(meter.lastReadingAt!)), 0);
  if (!newest) return [];
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return sending
    .filter(meter => meter.idleWhenQuiet && newest - Date.parse(meter.lastReadingAt!) >= QUIET_AFTER_MS && localDate.format(new Date(meter.lastReadingAt!)) <= lastDate)
    .map(meter => meter.meterPointId)
    .sort();
}
type ProjectInformation = {
  /**
   * `alwaysOn`: meant to run day and night (emergency lighting), kept in totals but never a daytime finding.
   * `lightCount`: how many light points the meter feeds, when recorded; the report shows energy per light for these.
   */
  name: string; meters?: Array<{ id: string; name?: string; location: string; locationId?: string; notInUse?: string; alwaysOn?: boolean; lightCount?: number }>;
  /** The Locations tree the groups come from; the project itself has no parent. `sortOrder`: the saved order among siblings. */
  locations?: Array<{ id: string; name: string; parentId: string | null; sortOrder?: number }>;
  calendar: null | { entries: Array<{ location: string; from: string; toExclusive: string | null; weekly: HoursByDay; hoursMeaning?: string; exceptions: Array<{ date: string; label: string; classification?: string }> }> };
};

// "all-available" means the server picks the window, so it must not be sent with a period or explicit dates.
const execute = (projectId: string, scopeId: string, range: AnalysisRange, snapshotId?: string) => configApi.executeEnergyScopeAnalysis({
  projectId, scopeId, resource: "electricity", surface: "project-explorer",
  ...(range.kind === "all"
    ? { analysisWindow: "all-available" as const }
    : { period: "Custom" as const, ...(range.kind === "latest-28" ? { analysisWindow: "current-overview-28d" as const } : { from: range.from, to: range.to }) }),
  ...(snapshotId ? { expectedDataSnapshotId: snapshotId } : {}),
});

// The last few results, for this tab only: coming back to a site's Analysis shows them at once while a fresh copy
// loads. Signing out reloads the page, which empties this.
const RECENT_LIMIT = 4;
const recent = new Map<string, AnalysisData>();
const recentKey = (projectId: string, range: AnalysisRange) => JSON.stringify([projectId, range]);
export const recentAnalysis = (projectId: string, range: AnalysisRange): AnalysisData | null => recent.get(recentKey(projectId, range)) ?? null;

/** Project and each space, for the chosen dates and the equal-length period before them, all on one data snapshot. */
export async function loadAnalysis(projectId: string, range: AnalysisRange): Promise<AnalysisData> {
  // All history does not depend on the dates the server picks, so it starts with the first request instead of after
  // it. It is the slowest request; it is kept only if it read the same data snapshot as the rest.
  const allHistory = range.kind === "all" ? null : execute(projectId, "project", { kind: "all" }).catch(() => null);
  const [project, information, actions, health] = await Promise.all([
    execute(projectId, "project", range),
    configApi.getEnergyProjectInformation<ProjectInformation>(projectId).catch(() => null),
    configApi.reportActionRequest<{ actions: ProjectAction[] }>(projectId, "project-list").then(result => result.actions ?? []).catch(() => [] as ProjectAction[]),
    // Meter health says which quiet meters are only using nothing: their silence then never makes a day incomplete.
    configApi.getEnergyProjectMeterHealth(projectId).catch(() => null),
  ]);
  const snapshotId = project.context.dataSnapshotId ?? undefined;
  const { dates, previous } = analysisComparisonDates(project);
  const currentRange: AnalysisRange = dates.length ? { kind: "custom", from: dates[0]!, to: dates.at(-1)! } : range;
  const previousRange: AnalysisRange | null = previous ? { kind: "custom", ...previous } : null;
  const spaces = project.childScopes.slice(0, MAX_ANALYSIS_SPACES);
  const [spaceCurrent, previousProject, spacePrevious, earlyHistory] = await Promise.all([
    Promise.all(spaces.map(space => execute(projectId, space.nodeId, currentRange, snapshotId).catch(() => null))),
    previousRange ? execute(projectId, "project", previousRange, snapshotId).catch(() => null) : Promise.resolve(null),
    previousRange ? Promise.all(spaces.map(space => execute(projectId, space.nodeId, previousRange, snapshotId).catch(() => null))) : Promise.resolve([] as Array<EnergyScopeAnalysisDto | null>),
    // All available history, only for the overnight "lowest load already achieved" check.
    allHistory ?? Promise.resolve(project),
  ]);
  const history = !earlyHistory || !snapshotId || earlyHistory.context.dataSnapshotId === snapshotId ? earlyHistory
    : await execute(projectId, "project", { kind: "all" }, snapshotId).catch(() => null);
  const assembled = assembleAnalysisData({ projectId, project, spaces, spaceCurrent, previousProject, spacePrevious, history, information, actions });
  const idle = idleThroughLastDay(health?.meters ?? [], assembled.current.project.dates.at(-1), assembled.timezone);
  const data: AnalysisData = idle.length ? { ...assembled, idleWhenQuiet: idle } : assembled;
  const key = recentKey(projectId, range);
  recent.delete(key);
  recent.set(key, data);
  if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value!);
  return data;
}

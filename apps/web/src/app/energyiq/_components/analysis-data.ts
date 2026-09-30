/**
 * Loads the readings the Analysis page and the site report work from.
 *
 * Only the loading lives here. The *shape* of those readings and the mapping that produces them live in
 * @datafoundry/site-report, so the server can build exactly the same readings on a schedule; both are re-exported
 * here unchanged, so every page keeps importing them from this file.
 */
import { configApi, type EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { type HoursByDay } from "./analysis-model";
import { analysisComparisonDates, assembleAnalysisData, MAX_ANALYSIS_SPACES, type AnalysisData, type ProjectAction } from "@datafoundry/site-report";

export type { AnalysisData, LoadedPeriod, ProjectAction, ScopeCircuit, ScopeData, ScopeMeter, TrendCell, TrendSeries } from "@datafoundry/site-report";
export { categoryOf, toScope } from "@datafoundry/site-report";

export type AnalysisRange = { kind: "latest-28" } | { kind: "all" } | { kind: "custom"; from: string; to: string };
type ProjectInformation = {
  name: string; meters?: Array<{ id: string; location: string }>;
  calendar: null | { entries: Array<{ location: string; from: string; toExclusive: string | null; weekly: HoursByDay; exceptions: Array<{ date: string; label: string; classification?: string }> }> };
};

// "all-available" means the server picks the window, so it must not be sent with a period or explicit dates.
const execute = (projectId: string, scopeId: string, range: AnalysisRange, snapshotId?: string) => configApi.executeEnergyScopeAnalysis({
  projectId, scopeId, resource: "electricity", surface: "project-explorer",
  ...(range.kind === "all"
    ? { analysisWindow: "all-available" as const }
    : { period: "Custom" as const, ...(range.kind === "latest-28" ? { analysisWindow: "current-overview-28d" as const } : { from: range.from, to: range.to }) }),
  ...(snapshotId ? { expectedDataSnapshotId: snapshotId } : {}),
});

/** Project and each space, for the chosen dates and the equal-length period before them, all on one data snapshot. */
export async function loadAnalysis(projectId: string, range: AnalysisRange): Promise<AnalysisData> {
  const [project, information, actions] = await Promise.all([
    execute(projectId, "project", range),
    configApi.getEnergyProjectInformation<ProjectInformation>(projectId).catch(() => null),
    configApi.reportActionRequest<{ actions: ProjectAction[] }>(projectId, "project-list").then(result => result.actions ?? []).catch(() => [] as ProjectAction[]),
  ]);
  const snapshotId = project.context.dataSnapshotId ?? undefined;
  const { dates, previous } = analysisComparisonDates(project);
  const currentRange: AnalysisRange = dates.length ? { kind: "custom", from: dates[0]!, to: dates.at(-1)! } : range;
  const previousRange: AnalysisRange | null = previous ? { kind: "custom", ...previous } : null;
  const spaces = project.childScopes.slice(0, MAX_ANALYSIS_SPACES);
  const [spaceCurrent, previousProject, spacePrevious, history] = await Promise.all([
    Promise.all(spaces.map(space => execute(projectId, space.nodeId, currentRange, snapshotId).catch(() => null))),
    previousRange ? execute(projectId, "project", previousRange, snapshotId).catch(() => null) : Promise.resolve(null),
    previousRange ? Promise.all(spaces.map(space => execute(projectId, space.nodeId, previousRange, snapshotId).catch(() => null))) : Promise.resolve([] as Array<EnergyScopeAnalysisDto | null>),
    // All available history, only for the overnight "lowest load already achieved" check.
    execute(projectId, "project", { kind: "all" }, snapshotId).catch(() => null),
  ]);
  return assembleAnalysisData({ projectId, project, spaces, spaceCurrent, previousProject, spacePrevious, history, information, actions });
}

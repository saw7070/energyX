/**
 * Loading the readings a site report is built from, on the server.
 *
 * The Analysis page does this in the browser by calling the consumption endpoint once for the whole site, once for
 * each space, again for the stretch before, and once for all the readings ever taken. The same numbers are available
 * in process, so the scheduler can do the same fan-out without a network round trip and without the HTTP cache.
 *
 * The mapping from a consumption result to readings is NOT repeated here: it lives once in @datafoundry/site-report
 * and is shared with the page, so a saved report and the page a reader opens can never drift apart.
 */
import type { MetadataStore, UserRecord } from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  analysisComparisonDates,
  assembleAnalysisData,
  MAX_ANALYSIS_SPACES,
  type AnalysisData,
  type AnalysisSource,
  type ProjectAction,
} from "@datafoundry/site-report";
import { executeEnergyScopeAnalysisWithLatestAvailable } from "../energy/energy-analysis.js";
import { readEnergyProjectInformation } from "../energy/energy-project-information.js";
import {
  resolveAllAvailableProjectAnalysisIdentity,
  resolvePublishedEnergyQueryContext,
} from "../energy/project-analysis-resolver.js";
import { ActionStore } from "./action-store.js";

/** The dates to report on. `toExclusive` is the day after the last day included, as everywhere else in reporting. */
export type SiteReportPeriod = { from: string; toExclusive: string };

export type SiteReportDataInput = {
  metadata: MetadataStore;
  dataGateway: LocalDataGateway;
  workspaceId: string;
  projectId: string;
  /** The person the report is published for; their access decides what the readings may contain. */
  actorUserId: string;
  period: SiteReportPeriod;
  /**
   * All readings ever taken. The site report itself never reads them, and for a long-running site they are by far the
   * largest thing in the file, so scheduled reports leave them out.
   */
  includeHistory?: boolean;
};

export type SiteReportData = { data: AnalysisData; dataSnapshotId: string | null };

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Everything the site report is built from, for one site and one stretch of dates. */
export async function loadSiteReportData(input: SiteReportDataInput): Promise<SiteReportData> {
  const user = input.metadata.users.getById({ user_id: input.actorUserId });
  const lastDay = shift(input.period.toExclusive, -1);
  const run = (scopeId: string, from: string, to: string, dataSnapshotId?: string) => execute(input, user, scopeId, { from, to }, dataSnapshotId);

  const project = await run("project", input.period.from, lastDay);
  const dataSnapshotId = project.context.dataSnapshotId ?? undefined;
  const { dates, previous } = analysisComparisonDates(project);
  const first = dates[0] ?? input.period.from;
  const last = dates.at(-1) ?? lastDay;
  const spaces = project.childScopes.slice(0, MAX_ANALYSIS_SPACES);

  // One space, or one comparison, that cannot be read must not cost the reader the whole report.
  const settle = <T>(work: Promise<T>) => work.catch(() => null);
  const [spaceCurrent, previousProject, spacePrevious, history] = await Promise.all([
    Promise.all(spaces.map(space => settle(run(space.nodeId, first, last, dataSnapshotId)))),
    previous ? settle(run("project", previous.from, previous.to, dataSnapshotId)) : Promise.resolve(null),
    previous ? Promise.all(spaces.map(space => settle(run(space.nodeId, previous.from, previous.to, dataSnapshotId)))) : Promise.resolve([] as Array<AnalysisSource | null>),
    input.includeHistory ? settle(executeAllAvailable(input, user, dataSnapshotId)) : Promise.resolve(null),
  ]);

  const information = safely(() => readEnergyProjectInformation(input.metadata, input.actorUserId, input.workspaceId, input.projectId));
  const actions = safely(() => readProjectActions(input)) ?? [];
  return {
    data: assembleAnalysisData({ projectId: input.projectId, project, spaces, spaceCurrent, previousProject, spacePrevious, history, information, actions }),
    dataSnapshotId: dataSnapshotId ?? null,
  };
}

/** The shared actions the site already agreed on, in the same shape the Analysis page receives them. */
function readProjectActions(input: SiteReportDataInput): ProjectAction[] {
  const store = new ActionStore(input.metadata.db);
  const scope = { workspaceId: input.workspaceId, projectId: input.projectId, userId: input.actorUserId };
  return store.listProject(scope).map(action => {
    const priority = store.priority(scope, action.id);
    return { id: action.id, title: action.title, recommendation: action.recommendation, state: action.state, priority: { level: priority.level, reason: priority.reason } };
  });
}

function safely<T>(read: () => T): T | null {
  try { return read(); } catch { return null; }
}

const execute = (input: SiteReportDataInput, user: UserRecord, scopeId: string, dates: { from: string; to: string }, dataSnapshotId?: string): Promise<AnalysisSource> =>
  executeEnergyScopeAnalysisWithLatestAvailable({
    metadataStore: input.metadata,
    dataGateway: input.dataGateway,
    userId: input.actorUserId,
    profile: "explorer",
    context: resolvePublishedEnergyQueryContext({
      metadataStore: input.metadata,
      user,
      workspaceId: input.workspaceId,
      request: {
        projectId: input.projectId, scopeId, resource: "electricity", period: "Custom", from: dates.from, to: dates.to,
        ...(dataSnapshotId ? { expectedDataSnapshotId: dataSnapshotId } : {}),
      },
    }).context,
  });

/** All readings ever taken; the engine picks the window itself, so no dates are sent with it. */
const executeAllAvailable = async (input: SiteReportDataInput, user: UserRecord, dataSnapshotId?: string): Promise<AnalysisSource> => {
  const resolved = await resolveAllAvailableProjectAnalysisIdentity({
    metadataStore: input.metadata,
    dataGateway: input.dataGateway,
    user,
    workspaceId: input.workspaceId,
    request: {
      projectId: input.projectId, scopeId: "project", resource: "electricity", analysisWindow: "all-available",
      ...(dataSnapshotId ? { expectedDataSnapshotId: dataSnapshotId } : {}),
    },
  });
  return executeEnergyScopeAnalysisWithLatestAvailable({
    metadataStore: input.metadata,
    dataGateway: input.dataGateway,
    userId: input.actorUserId,
    profile: "explorer",
    context: resolved.context,
  });
};

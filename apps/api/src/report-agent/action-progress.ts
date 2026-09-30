import { ActionStore, type ActionScope } from "./action-store.js";
import { hasReportArtifact, type ReportStore } from "./report-store.js";

/** Shared report context contains bounded, accepted evidence, never private report prose. */
export function projectActionProgress(actions: ActionStore, reports: ReportStore, scope: ActionScope) {
  return actions.reportProgress(scope).map(action => ({
    ...action,
    completedAssessments: actions.feedback(scope, action.id).flatMap(link => {
      let run;
      try { run = reports.get(scope.projectId, link.runId); } catch { return []; }
      const evidence = run.actionFeedback;
      if (run.workspaceId !== scope.workspaceId || run.projectId !== scope.projectId ||
          run.status !== "succeeded" || !hasReportArtifact(run) || !evidence ||
          evidence.actionId !== action.id || evidence.revision !== link.revision ||
          evidence.stage !== link.stage || !evidence.assessment.ready) return [];
      return [{
        reportId: run.id,
        revision: link.revision,
        stage: link.stage,
        historical: link.revision !== action.revision || action.state !== "implemented",
        execution: evidence.execution,
        baselinePeriod: evidence.baseline.period,
        observationPeriod: evidence.observation.period,
        baselineSnapshotId: evidence.baseline.snapshotId,
        observationSnapshotId: evidence.observation.snapshotId,
        assessment: evidence.assessment,
        scenarioComparison: evidence.scenarioComparison,
      }];
    }).slice(-3),
  }));
}

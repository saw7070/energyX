import type { MetadataStore } from "@datafoundry/metadata";
import { ActionStore } from "./action-store.js";
import { checkActionFeedback, retryActionFeedback } from "./action-feedback.js";
import { assertActionAccess } from "./action-access.js";
import { readActionEvidence } from "./action-data.js";
import type { ReportStore } from "./report-store.js";

/** One API owner scans persisted Actions. Task/link transactions prevent duplicates. */
export async function sweepActionFeedback(metadata: MetadataStore, reports: ReportStore, now: Date,
  read = readActionEvidence, stopped = () => false): Promise<void> {
  const store = new ActionStore(metadata.db);
  for (const action of store.implemented()) {
    if (stopped()) break;
    const scope = {workspaceId:action.workspaceId,projectId:action.projectId,userId:action.userId};
    try {
      assertActionAccess(metadata,scope);
      let pendingRetry = false;
      for (const link of store.feedback(scope,action.id).filter(link=>link.revision===action.revision)) {
        const run = reports.get(action.projectId,link.runId);
        if (!["failed","interrupted"].includes(run.status)) continue;
        const attempts = link.previousRunIds?.length ?? 0;
        const unsafe = /FORBIDDEN|ACCESS|PERMISSION|EXECUTION_CHANGED|INVALID|DATA_INPUT_REQUIRED/.test(run.errorCode ?? "");
        if (unsafe || attempts >= 2) {
          store.setCheck(scope,action.id,{revision:action.revision,status:"retry_exhausted",checkedAt:now.toISOString(),
            reason:"Feedback needs attention. Automatic retries have stopped; review the issue before retrying."});
          pendingRetry = true;
          continue;
        }
        const due = Date.parse(run.finishedAt ?? run.startedAt ?? run.createdAt) + (attempts === 0 ? 60_000 : 300_000);
        if (now.getTime() < due) {
          store.setCheck(scope,action.id,{revision:action.revision,status:"retry_scheduled",checkedAt:now.toISOString(),
            nextRetryAt:new Date(due).toISOString(),reason:"Feedback generation will retry automatically."});
        } else {
          retryActionFeedback(metadata,reports,scope,action.id,run.id);
          store.setCheck(scope,action.id,{revision:action.revision,status:"queued",checkedAt:now.toISOString()});
        }
        pendingRetry = true;
      }
      if (!pendingRetry) await checkActionFeedback(metadata,reports,action,now,read);
    } catch {
      const fresh = store.get(scope,action.id);
      if (fresh.revision === action.revision && fresh.state === "implemented")
        store.setCheck(scope,action.id,{revision:action.revision,status:"check_failed",checkedAt:now.toISOString(),
          reason:"Data or permissions could not be verified. No result has been published. The next automatic check will try again."});
    }
  }
}

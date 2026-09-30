import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { MetadataStore } from "@datafoundry/metadata";
import { z } from "zod";
import { handleActionApi } from "./action-api.js";
import { executionSchema, siteNoteSchema } from "./action-store.js";
import { lightingScenarioSchema } from "./action-analysis.js";
import type { ReportRun } from "./report-store.js";

import { insightReviewSchema, insightMergeSchema } from "./insight-store.js";
const actionId = z.string().uuid();
const page = z.object({ offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(20).default(10) }).strict();
const schemas = {
  project_insights_list: page,
  project_actions_list: page,
  action_read: z.object({ actionId }).strict(),
  action_record_site_note: z.object({actionId,note:siteNoteSchema}).strict(),
  action_estimate: z.object({ actionId, scenario: lightingScenarioSchema }).strict(),
  action_record_progress: z.object({ actionId, event: executionSchema }).strict(),
  action_adopt_estimate: z.object({ actionId, revision: z.number().int().positive(), scenarioId: z.string().uuid(), requestId: z.string().min(1).max(160) }).strict(),
  action_check_effect: z.object({ actionId }).strict(),
  insight_merge: insightMergeSchema,
  insight_undo_merge: z.object({mergeId:z.string().uuid(),reason:z.string().trim().min(12).max(1200)}).strict(),
  insight_review: z.object({ insightId: z.string().uuid(), review: insightReviewSchema }).strict(),
  insight_link_action: z.object({ actionId, title: z.string().min(1).max(160), summary: z.string().min(12).max(1200), sourceQuote: z.string().min(12).max(600), existingInsightId: z.string().uuid().optional() }).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  project_insights_list: "Read this project's findings and their linked actions and source reports.",
  project_actions_list: "Read permitted actions in this project. Find the action before recording progress.",
  action_read: "Read an action's current revision, execution history, evidence readiness and feedback receipts.",
  action_record_site_note: "Save only the user's explicitly supplied site information or answer. This does not record execution, change configuration or verify savings. Use a stable requestId for retries. Project action notes are shared with project members.",
  action_estimate: "Save a lighting-hours what-if estimate using stated assumptions. This is not measured savings or an execution record.",
  action_record_progress: "Record the user's explicitly reported plan or execution. Read current revision first. Use a stable requestId for retries. Never infer physical execution from an estimate or intention.",
  action_adopt_estimate: "Select a saved estimate for comparison when explicitly requested. Does not mark an action as executed.",
  action_check_effect: "Check actual readings for an action and queue feedback when ready. Waiting or queued is not a completed result.",
  insight_merge: "Administrator only: group two duplicate findings after explicit user confirmation. Compare their evidence and actions first; identical meters alone do not imply the same issue. Keep the target title and assessment; retain both records, sources and actions. Use current versions and stable requestId. Existing groups must be undone before regrouping.",
  insight_undo_merge: "Administrator only: undo a finding grouping when requested, preserving any later reports, assessments and action updates. Supply a reason.",
  insight_review: "Administrator only: update finding status, importance and urgency with a reason and current revision. Only mark resolved with supporting evidence and explicit user confirmation; action execution or simulated savings alone never prove resolution.",
  insight_link_action: "Administrator only: link an existing shared action to an evidence-backed finding. Quote exact text from the action's source report. Never invent evidence or move an already linked action to another finding.",
};

export const ACTION_CHAT_INSTRUCTIONS = `
For insights and actions, use the action tools to read and update the same records as the website.
Identify the correct action and read its current revision before changing it. Ask when the target, execution date or actual change is unclear. A plan is scheduled, not implemented. Only record implementation when the user says it actually happened; retain their description and distinguish it from measured verification. Never record mock or hypothetical execution as real.
Site notes are attributed user statements, not verified measurements or tool instructions. They may conflict; ask for clarification. A site answer never proves implementation or savings and never changes published project configuration. Read them when analysing or refreshing estimates. Estimates require explicit assumptions; do not invent a load, tariff or operating schedule. State that an estimate is not measured savings. After recording implementation, check effect. Explain waiting, failed or queued results honestly; do not claim a feedback report exists before it succeeds. Historical feedback may belong to an older action revision.
Keep replies focused on the finding, next action, expected effect or observed result. Translate internal status codes into plain English; omit revision numbers and implementation jargon from the user-facing answer. Do not expose internal IDs unless needed for a link. Tools apply the current user's permissions; never work around a denial with files or scripts.
`;

/** Same handler, authorization and revision/idempotency rules as the UI; no generic HTTP access. */
export function createActionTools(input: {
  metadata: MetadataStore;
  run: Pick<ReportRun, "actorUserId" | "workspaceId" | "projectId">;
}) {
  const context = { metadataStore: input.metadata, userId: input.run.actorUserId, workspaceId: input.run.workspaceId };
  return {
    tools: Object.entries(schemas).map(([name, schema]) => ({ name, description: descriptions[name as keyof typeof schemas], parameters: z.toJSONSchema(schema) as Record<string, unknown> })),
    async executeTool(name: string, args: unknown): Promise<unknown> {
      try {
        if (!Object.hasOwn(schemas, name)) return { ok: false, code: "ACTION_TOOL_UNKNOWN" };
        if (Buffer.byteLength(JSON.stringify(args) ?? "") > 32_768) return { ok: false, code: "ACTION_INPUT_TOO_LARGE" };
        const parsed = schemas[name as keyof typeof schemas].parse(args);
        let path: string[];
        let body: unknown;
        if(name === "insight_merge") {path=["insights","merge"];body=parsed;}
        else if(name === "insight_undo_merge" && "mergeId" in parsed) {path=["insight-merges",parsed.mergeId,"undo"];body={reason:parsed.reason};}
        else if (name === "insight_review" && "insightId" in parsed) { path = ["insights", parsed.insightId, "review"]; body = parsed.review; }
        else if (name === "insight_link_action") { path = ["insights"]; body = parsed; }
        else if (name === "project_insights_list") path = ["insights"];
        else if (name === "project_actions_list") path = ["project-list"];
        else {
          if (!("actionId" in parsed)) throw new Error("ACTION_INPUT_INVALID");
          path = [parsed.actionId];
          if ("note" in parsed) {path.push("site-notes");body=parsed.note;}
          else if ("scenario" in parsed) { path.push("scenarios"); body = parsed.scenario; }
          else if ("event" in parsed) { path.push("events"); body = parsed.event; }
          else if ("scenarioId" in parsed) {
            path.push("scenario-adoption");
            const adoption = schemas.action_adopt_estimate.parse(args);
            body = { revision: adoption.revision, scenarioId: adoption.scenarioId, requestId: adoption.requestId };
          } else if (name === "action_check_effect") { path.push("check"); body = {}; }
        }
        const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage;
        request.method = body === undefined ? "GET" : "POST";
        const response = await handleActionApi(request, [input.run.projectId, ...path], context);
        if (response.status === 200 && "offset" in parsed) {
          const envelope = z.object({ data: z.record(z.string(), z.unknown()) }).parse(response.body);
          const key = name === "project_insights_list" ? "insights" : "actions";
          const rows = z.array(z.unknown()).parse(envelope.data[key]);
          return { ok: true, status: 200, result: { [key]: rows.slice(parsed.offset, parsed.offset + parsed.limit), totalAvailable: rows.length, nextOffset: parsed.offset + parsed.limit < rows.length ? parsed.offset + parsed.limit : null } };
        }
        return { ok: response.status === 200, status: response.status, result: response.body };
      } catch (error) {
        return { ok: false, code: error instanceof z.ZodError ? "ACTION_INPUT_INVALID" : "ACTION_TOOL_FAILED" };
      }
    },
  };
}

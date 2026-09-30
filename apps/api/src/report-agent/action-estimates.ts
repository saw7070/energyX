import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ActionStore, type ActionScope } from "./action-store.js";
import { shiftReportDate } from "./report-calendar.js";

/** Last 28 completed local days ending at the data cutoff, not the sync watermark. */
export function estimatePeriod(lastIntervalEnd: string, timezone: string, now = new Date()) {
  if (!Number.isFinite(Date.parse(lastIntervalEnd))) throw new Error("ACTION_ESTIMATE_DATA_UNAVAILABLE");
  const day = (d:Date) => new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
  const toExclusive = [day(new Date(lastIntervalEnd)),day(now)].sort()[0]!;
  return {from:shiftReportDate(toExclusive,-28),toExclusive};
}

const text = z.string().trim().min(1).max(4000);
/** Customer-facing assessment, not a claim that an intervention has occurred. */
export const actionEstimateResultSchema = z.object({
  recommendation: text,
  expectedEffect: text,
  evidence: z.array(text).min(1).max(20),
  assumptions: z.array(text).max(20),
  questions: z.array(text).max(10),
  quantification: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_quantified"), reason: text }).strict(),
    z.object({
      status: z.literal("estimated"),
      energyKwhLow: z.number().finite().nonnegative(),
      energyKwhHigh: z.number().finite().nonnegative(),
      horizonDays: z.number().int().min(1).max(366),
      method: text,
      calculationEvidence: text,
    }).strict().refine(v => v.energyKwhLow <= v.energyKwhHigh, "Invalid estimate range"),
  ]),
}).strict();

export type ActionEstimateResult = z.infer<typeof actionEstimateResultSchema>;
export type ActionEstimate = {
  id: string; actionId: string; version: number; actorUserId: string;
  runId: string; createdAt: string; actionRevision: number;
  status: "pending" | "succeeded" | "failed";
  result?: ActionEstimateResult; error?: string;
  notes?: string;
};

/** Callers authorize project membership first. A run and its version are reserved atomically. */
export class ActionEstimates {
  private actions: ActionStore;
  constructor(private db: DatabaseSync) {
    this.actions = new ActionStore(db);
    db.exec(`CREATE TABLE IF NOT EXISTS energyiq_action_estimates (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, version INTEGER NOT NULL,
      request_id TEXT NOT NULL, document TEXT NOT NULL,
      UNIQUE(action_id,version), UNIQUE(action_id,request_id));`);
  }
  list(scope: ActionScope, actionId: string): ActionEstimate[] {
    this.actions.get(scope, actionId);
    return this.db.prepare("SELECT document FROM energyiq_action_estimates WHERE action_id=? ORDER BY version DESC")
      .all(actionId).map(r => JSON.parse(String(r.document)) as ActionEstimate);
  }
  start(scope: ActionScope, actionId: string, input: {requestId: string; update: boolean; notes?:string|undefined}, enqueue: () => string): ActionEstimate {
    z.object({requestId:z.string().uuid(),update:z.boolean(),notes:z.string().trim().max(4000).optional()}).strict().parse(input);
    const action = this.actions.get(scope, actionId);
    this.db.exec("SAVEPOINT action_estimate_start");
    try {
      const repeated = this.db.prepare("SELECT document FROM energyiq_action_estimates WHERE action_id=? AND request_id=?").get(actionId,input.requestId);
      const history = this.list(scope,actionId);
      if(repeated && (JSON.parse(String(repeated.document)).notes ?? "") !== (input.notes ?? "")) throw new Error("ACTION_REQUEST_CONFLICT");
      if(input.notes && history.some(e=>e.status==="pending") && !repeated) throw new Error("REPORT_ALREADY_RUNNING");
      const existing = repeated ? JSON.parse(String(repeated.document)) as ActionEstimate
        : history.find(e => e.status === "pending") ?? (!input.update ? history.find(e => e.status === "succeeded") : undefined);
      if (existing) { this.db.exec("RELEASE action_estimate_start"); return existing; }
      const estimate: ActionEstimate = {
        id:randomUUID(),actionId,version:(history[0]?.version ?? 0)+1,
        actorUserId:scope.userId,actionRevision:action.revision,
        runId:enqueue(),createdAt:new Date().toISOString(),status:"pending",
        ...(input.notes ? {notes:input.notes} : {}),
      };
      this.db.prepare("INSERT INTO energyiq_action_estimates VALUES(?,?,?,?,?)").run(estimate.id,actionId,estimate.version,input.requestId,JSON.stringify(estimate));
      this.db.exec("RELEASE action_estimate_start");
      return estimate;
    } catch(error) {
      this.db.exec("ROLLBACK TO action_estimate_start; RELEASE action_estimate_start");
      throw error;
    }
  }
  finish(scope: ActionScope, actionId: string, runId: string, outcome: {result:unknown} | {error:string}): ActionEstimate {
    const estimate = this.list(scope,actionId).find(e => e.runId === runId);
    if (!estimate) throw new Error("ACTION_NOT_FOUND");
    if (estimate.status !== "pending") return estimate;
    const completed: ActionEstimate = "result" in outcome
      ? {...estimate,status:"succeeded",result:actionEstimateResultSchema.parse(outcome.result)}
      : {...estimate,status:"failed",error:text.parse(outcome.error)};
    this.db.prepare("UPDATE energyiq_action_estimates SET document=? WHERE id=?").run(JSON.stringify(completed),estimate.id);
    return completed;
  }
}

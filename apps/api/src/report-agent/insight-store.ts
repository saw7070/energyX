import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ActionScope } from "./action-store.js";
import { z } from "zod";
export const insightReviewSchema = z.object({
 revision: z.number().int().nonnegative(),
 status: z.enum(["open", "monitoring", "resolved", "archived"]),
 importance: z.enum(["high", "medium", "low"]),
 urgency: z.enum(["urgent", "soon", "routine"]),
 reason: z.string().trim().min(12).max(1200),
}).strict();
export const insightMergeSchema = z.object({
 sourceId: z.string().uuid(), targetId: z.string().uuid(),
 sourceVersion: z.string().length(64), targetVersion: z.string().length(64),
 reason: z.string().trim().min(12).max(1200), requestId: z.string().uuid(),
}).strict();
export type InsightReview = z.infer<typeof insightReviewSchema>;
export const defaultInsightReview = { revision: 0, status: "open", importance: "medium", urgency: "routine", reason: "Not yet reviewed." } as const;
export type InsightDraft = {
  title: string;
  summary: string;
  sourceQuote: string;
};
export type ProjectInsight = InsightDraft & {
  id: string;
  version: string;
  mergedFindings?: Array<{ id: string; title: string; summary: string; review: InsightReview }>;
  mergeId?: string;
  review: InsightReview;
  reviewHistory: Array<InsightReview & { actorUserId: string; at: string }>;
  meterIds: string[];
  createdAt: string;
  actionIds: string[];
  sources: Array<{ reportId: string; sourceQuote: string }>;
};
const key = (s: ActionScope) =>
  `${encodeURIComponent(s.workspaceId)}/${encodeURIComponent(s.projectId)}`;
export class InsightStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS energyiq_project_insights (id TEXT PRIMARY KEY, scope TEXT NOT NULL, fingerprint TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(scope,fingerprint));
   CREATE TABLE IF NOT EXISTS energyiq_insight_actions (action_id TEXT PRIMARY KEY, insight_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS energyiq_insight_merges (id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_id TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(scope,request_id));`);
  }
  private originals(scope: ActionScope): ProjectInsight[] {
    return this.db
      .prepare(
        "SELECT document FROM energyiq_project_insights WHERE scope=? ORDER BY rowid DESC",
      )
      .all(key(scope))
      .map((r) => {
        const i = JSON.parse(String(r.document));
        const actionIds = this.db.prepare("SELECT action_id FROM energyiq_insight_actions WHERE insight_id=? ORDER BY action_id").all(i.id).map(a=>String(a.action_id));
        return {
          ...i,
          version: createHash("sha256").update(JSON.stringify([String(r.document),actionIds])).digest("hex"),
          review: i.review ?? defaultInsightReview,
          reviewHistory: i.reviewHistory ?? [],
          actionIds,
        };
      });
  }
  private mergeRecords(scope: ActionScope) {
    return this.db.prepare("SELECT document FROM energyiq_insight_merges WHERE scope=? ORDER BY rowid DESC").all(key(scope)).map(r => JSON.parse(String(r.document)));
  }
  list(scope: ActionScope): ProjectInsight[] {
    const items = this.originals(scope);
    const active = this.mergeRecords(scope).filter(m => !m.undoneAt);
    const hidden = new Set(active.map(m => m.sourceId));
    return items.filter(i => !hidden.has(i.id)).map(i => {
      const merge = active.find(m => m.targetId === i.id);
      const other = merge && items.find(s => s.id === merge.sourceId);
      if (!other) return i;
      const reports = new Map<string, Set<string>>();
      for (const s of [...i.sources,...other.sources]) {
        const quotes = reports.get(s.reportId) ?? new Set<string>();
        quotes.add(s.sourceQuote); reports.set(s.reportId,quotes);
      }
      return { ...i, mergeId: merge.id, mergedFindings: [{id:other.id,title:other.title,summary:other.summary,review:other.review}],
        actionIds: [...new Set([...i.actionIds,...other.actionIds])],
        sources: [...reports].map(([reportId,quotes])=>({reportId,sourceQuote:[...quotes].join("\n\n")})) };
    });
  }
  merge(scope: ActionScope, input: unknown) {
    const value = insightMergeSchema.parse(input);
    this.db.exec("SAVEPOINT insight_merge");
    try {
      const records = this.mergeRecords(scope);
      const retry = records.find(m => m.requestId === value.requestId);
      if (retry) {
        if (retry.request !== JSON.stringify(value)) throw new Error("ACTION_REQUEST_CONFLICT");
        this.db.exec("RELEASE insight_merge"); return retry;
      }
      const items = this.originals(scope), source = items.find(i=>i.id===value.sourceId), target = items.find(i=>i.id===value.targetId);
      if (!source || !target) throw new Error("ACTION_NOT_FOUND");
      if (source.version!==value.sourceVersion || target.version!==value.targetVersion) throw new Error("ACTION_REVISION_CONFLICT");
      if (source.id===target.id || JSON.stringify([...source.meterIds].sort())!==JSON.stringify([...target.meterIds].sort())) throw new Error("INSIGHT_MERGE_INCOMPATIBLE");
      if (records.some(m=>!m.undoneAt && [m.sourceId,m.targetId].some(id=>id===source.id||id===target.id))) throw new Error("INSIGHT_MERGE_ALREADY_GROUPED");
      const merged = {...value,id:randomUUID(),actorUserId:scope.userId,at:new Date().toISOString(),request:JSON.stringify(value)};
      this.db.prepare("INSERT INTO energyiq_insight_merges VALUES (?,?,?,?)").run(merged.id,key(scope),value.requestId,JSON.stringify(merged));
      this.db.exec("RELEASE insight_merge"); return merged;
    } catch(error) {this.db.exec("ROLLBACK TO insight_merge; RELEASE insight_merge");throw error;}
  }
  undoMerge(scope: ActionScope, id: string, reason: string) {
    const row=this.db.prepare("SELECT document FROM energyiq_insight_merges WHERE id=? AND scope=?").get(id,key(scope));
    if(!row) throw new Error("ACTION_NOT_FOUND");
    const prior=JSON.parse(String(row.document));
    if(prior.undoneAt) return prior;
    const value={...prior,undoneAt:new Date().toISOString(),undoneBy:scope.userId,undoReason:z.string().trim().min(12).max(1200).parse(reason)};
    this.db.prepare("UPDATE energyiq_insight_merges SET document=? WHERE id=? AND scope=?").run(JSON.stringify(value),id,key(scope));
    return value;
  }
  review(scope: ActionScope, id: string, input: unknown) {
    const update = insightReviewSchema.parse(input);
    const row = this.db.prepare("SELECT document FROM energyiq_project_insights WHERE id=? AND scope=?").get(id, key(scope));
    if (!row) throw new Error("ACTION_NOT_FOUND");
    const prior = JSON.parse(String(row.document));
    const current = prior.review ?? defaultInsightReview;
    if (current.revision !== update.revision) throw new Error("ACTION_REVISION_CONFLICT");
    const review = { ...update, revision: update.revision + 1 };
    const value = { ...prior, review, reviewHistory: [...(prior.reviewHistory ?? []), { ...review, actorUserId: scope.userId, at: new Date().toISOString() }] };
    const result = this.db.prepare("UPDATE energyiq_project_insights SET document=? WHERE id=? AND scope=? AND document=?").run(JSON.stringify(value), id, key(scope), String(row.document));
    if (Number(result.changes) !== 1) throw new Error("ACTION_REVISION_CONFLICT");
    return value;
  }
  attach(
    scope: ActionScope,
    actionId: string,
    meterIds: string[],
    reportId: string,
    draft: InsightDraft,
    existingId?: string,
  ) {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          [...meterIds].sort(),
          draft.summary.trim().toLowerCase().replace(/\s+/g, " "),
        ]),
      )
      .digest("hex");
    const bound = !existingId
      ? this.db
          .prepare(
            "SELECT i.document FROM energyiq_project_insights i JOIN energyiq_insight_actions a ON i.id=a.insight_id WHERE a.action_id=? AND i.scope=?",
          )
          .get(actionId, key(scope))
      : undefined;
    const row = existingId
      ? this.db
          .prepare(
            "SELECT document FROM energyiq_project_insights WHERE id=? AND scope=?",
          )
          .get(existingId, key(scope))
      : (bound ??
        this.db
          .prepare(
            "SELECT document FROM energyiq_project_insights WHERE scope=? AND fingerprint=?",
          )
          .get(key(scope), fingerprint));
    if (existingId && !row) throw new Error("ACTION_NOT_FOUND");
    const prior = row ? JSON.parse(String(row.document)) : null;
    if (
      prior &&
      JSON.stringify([...prior.meterIds].sort()) !==
        JSON.stringify([...meterIds].sort())
    )
      throw new Error("ACTION_INPUT_INVALID");
    const value = prior ?? {
      ...draft,
      id: randomUUID(),
      meterIds,
      createdAt: new Date().toISOString(),
      sources: [],
    };
    if (
      !value.sources.some((s: { reportId: string }) => s.reportId === reportId)
    )
      value.sources.push({ reportId, sourceQuote: draft.sourceQuote });
    if (prior)
      this.db
        .prepare("UPDATE energyiq_project_insights SET document=? WHERE id=?")
        .run(JSON.stringify(value), value.id);
    else
      this.db
        .prepare("INSERT INTO energyiq_project_insights VALUES (?,?,?,?)")
        .run(value.id, key(scope), fingerprint, JSON.stringify(value));
    this.db
      .prepare(
        "INSERT INTO energyiq_insight_actions VALUES (?,?) ON CONFLICT(action_id) DO UPDATE SET insight_id=excluded.insight_id",
      )
      .run(actionId, value.id);
    return value;
  }
}

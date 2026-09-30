import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { estimateLighting } from "./action-analysis.js";

const text = z.string().trim().min(1).max(2000);
export const siteNoteSchema = z.object({requestId:z.string().uuid(),question:z.string().trim().min(1).max(300),answer:text}).strict();
export type SiteNote = z.infer<typeof siteNoteSchema> & {id:string;actorUserId:string;recordedAt:string};
export const proposalSchema = z
  .object({
    sourceReportId: z.string().min(1).max(160),
    title: text.max(160),
    recommendation: text,
    meterIds: z.array(z.string().min(1).max(160)).min(1).max(30),
    baseline: z
      .object({
        from: z.string().date(),
        toExclusive: z.string().date(),
        snapshotId: z.string().min(1).max(160),
      })
      .strict(),
    idempotencyKey: z.string().min(1).max(160),
    suggestionId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
    suggestionRunId: z.string().uuid().optional(),
    visibility: z.enum(["private", "project"]).optional(),
  })
  .strict()
  .refine(
    (v) => v.baseline.from < v.baseline.toExclusive,
    "Invalid baseline window",
  );
export const executionSchema = z
  .object({
    revision: z.number().int().positive(),
    requestId: z.string().min(1).max(160),
    type: z.enum(["scheduled", "implemented", "paused", "declined"]),
    effectiveAt: z.string().datetime({ offset: true }),
    details: text,
  })
  .strict();
export type ActionScope = {
  workspaceId: string;
  projectId: string;
  userId: string;
};
export type Action = z.infer<typeof proposalSchema> &
  ActionScope & {
    id: string;
    revision: number;
    state: "proposed" | z.infer<typeof executionSchema>["type"];
    createdAt: string;
    updatedAt: string;
    adoptedScenarioId?: string;
  };
export type ActionSource = {
  reportId: string;
  recommendation: string;
  sourceQuote?: string;
  linkedAt: string;
};
export type Execution = z.infer<typeof executionSchema> & {
  id: string;
  actionId: string;
  actorUserId: string;
  recordedAt: string;
};

/** Callers authorize current project membership before using this scoped store. */
export class ActionStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS energyiq_action_site_notes (action_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(action_id,actor_id,request_id))`);
    db.exec("CREATE TABLE IF NOT EXISTS energyiq_action_measure_keys (action_id TEXT PRIMARY KEY, measure_key TEXT NOT NULL)");
    db.exec(`CREATE TABLE IF NOT EXISTS energyiq_actions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      revision INTEGER NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, document TEXT NOT NULL,
      UNIQUE(workspace_id,project_id,owner_id,request_key));
      CREATE TABLE IF NOT EXISTS energyiq_action_priorities (
      action_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS energyiq_action_sources (
      action_id TEXT NOT NULL, report_id TEXT NOT NULL, document TEXT NOT NULL,
      PRIMARY KEY(action_id,report_id));
      CREATE TABLE IF NOT EXISTS energyiq_action_events (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      document TEXT NOT NULL, UNIQUE(action_id,request_key));
      CREATE INDEX IF NOT EXISTS energyiq_actions_scope ON energyiq_actions(workspace_id,project_id,owner_id);
      CREATE TABLE IF NOT EXISTS energyiq_action_baselines (action_id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS energyiq_action_feedback (action_id TEXT NOT NULL, revision INTEGER NOT NULL, stage TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(action_id,revision,stage));
      CREATE TABLE IF NOT EXISTS energyiq_action_checks (action_id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS energyiq_action_scenarios (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS energyiq_action_extractions (
      source_id TEXT PRIMARY KEY, run_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS energyiq_action_adoptions (
      action_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, document TEXT NOT NULL,
      PRIMARY KEY(action_id,request_id));
    `);
  }
  list(scope: ActionScope, sourceReportId: string): Action[] {
    return this.db
      .prepare(
        `SELECT document FROM energyiq_actions WHERE workspace_id=? AND project_id=? AND (owner_id=? OR json_extract(document,'$.visibility')='project')
      AND (json_extract(document,'$.sourceReportId')=? OR EXISTS (SELECT 1 FROM energyiq_action_sources s WHERE s.action_id=energyiq_actions.id AND s.report_id=?)) ORDER BY json_extract(document,'$.createdAt') DESC LIMIT 100`,
      )
      .all(scope.workspaceId, scope.projectId, scope.userId, sourceReportId, sourceReportId)
      .map((row) => JSON.parse(String(row.document)) as Action);
  }
  siteNotes(scope:ActionScope,id:string):SiteNote[] {
    this.get(scope,id);
    return this.db.prepare("SELECT document FROM energyiq_action_site_notes WHERE action_id=? ORDER BY rowid DESC LIMIT 30").all(id).map(r=>JSON.parse(String(r.document)));
  }
  recordSiteNote(scope:ActionScope,id:string,raw:unknown):SiteNote {
    this.get(scope,id);const input=siteNoteSchema.parse(raw);
    const previous=this.db.prepare("SELECT document FROM energyiq_action_site_notes WHERE action_id=? AND actor_id=? AND request_id=?").get(id,scope.userId,input.requestId);
    if(previous){const note:SiteNote=JSON.parse(String(previous.document));if(note.question!==input.question||note.answer!==input.answer)throw new Error("ACTION_REQUEST_CONFLICT");return note;}
    const note:SiteNote={...input,id:randomUUID(),actorUserId:scope.userId,recordedAt:new Date().toISOString()};
    this.db.prepare("INSERT INTO energyiq_action_site_notes VALUES(?,?,?,?)").run(id,scope.userId,input.requestId,JSON.stringify(note));return note;
  }
  priority(scope: ActionScope, id: string): {revision:number;level:"high"|"medium"|"low";reason:string} {
    this.get(scope,id);
    const row=this.db.prepare("SELECT document FROM energyiq_action_priorities WHERE action_id=?").get(id);
    return row ? JSON.parse(String(row.document)) : {revision:0,level:"medium",reason:"Not yet prioritised"};
  }
  setPriority(scope: ActionScope,id:string,raw:unknown) {
    const input=z.object({revision:z.number().int().nonnegative(),level:z.enum(["high","medium","low"]),reason:text}).strict().parse(raw);
    this.get(scope,id);
    if(this.priority(scope,id).revision!==input.revision) throw new Error("ACTION_REVISION_CONFLICT");
    const value={...input,revision:input.revision+1};
    const result=this.db.prepare(`INSERT INTO energyiq_action_priorities VALUES (?,?,?)
      ON CONFLICT(action_id) DO UPDATE SET revision=excluded.revision,document=excluded.document WHERE energyiq_action_priorities.revision=?`)
      .run(id,value.revision,JSON.stringify(value),input.revision);
    if(!result.changes) throw new Error("ACTION_REVISION_CONFLICT");
    return value;
  }
  listProject(scope: ActionScope, publicOnly = false): Action[] {
    return this.db.prepare(`SELECT document FROM energyiq_actions
      WHERE workspace_id=? AND project_id=?
      AND (json_extract(document,'$.visibility')='project' OR (owner_id=? AND ?=0))
      ORDER BY json_extract(document,'$.updatedAt') DESC, id LIMIT 200`)
      .all(scope.workspaceId, scope.projectId, scope.userId, publicOnly ? 1 : 0)
      .map(row => JSON.parse(String(row.document)) as Action);
  }
  sources(scope: ActionScope, id: string): ActionSource[] {
    const action = this.get(scope, id);
    const linked = this.db.prepare('SELECT document FROM energyiq_action_sources WHERE action_id=? ORDER BY report_id')
      .all(id).map(row => JSON.parse(String(row.document)) as ActionSource);
    return [{ reportId: action.sourceReportId, recommendation: action.recommendation, linkedAt: action.createdAt },
      ...linked.filter(link => link.reportId !== action.sourceReportId)];
  }
  /** The API verifies the quotation against an accessible accepted report before linking. */
  linkSource(scope: ActionScope, id: string, input: Omit<ActionSource, "linkedAt">): ActionSource[] {
    this.get(scope, id);
    const value = z.object({reportId: text.max(160), recommendation: text, sourceQuote: text.max(600).optional()}).strict().parse(input);
    const prior = this.db.prepare('SELECT document FROM energyiq_action_sources WHERE action_id=? AND report_id=?').get(id,value.reportId);
    if (prior) {
      const existing = JSON.parse(String(prior.document)) as ActionSource;
      if(existing.recommendation !== value.recommendation || existing.sourceQuote !== value.sourceQuote)
        throw new Error('ACTION_REQUEST_CONFLICT');
    } else {
      this.db.prepare('INSERT INTO energyiq_action_sources VALUES (?,?,?)')
        .run(id,value.reportId,JSON.stringify({...value,linkedAt:new Date().toISOString()}));
    }
    return this.sources(scope,id);
  }
  /** Full reports are project-readable: never place private actions in their model context. */
  reportProgress(scope: ActionScope) {
    return this.listProject(scope,true).map(action => ({
      id: action.id, revision: action.revision, title: action.title,
      recommendation: action.recommendation, meterIds: action.meterIds, state: action.state,
      measureKey: this.db.prepare("SELECT measure_key FROM energyiq_action_measure_keys WHERE action_id=?").get(action.id)?.measure_key ?? null,
      priority: this.priority(scope,action.id),
      siteNotes: this.siteNotes(scope,action.id).slice(0,10),
      sources: this.sources(scope,action.id),
      events: this.events(scope,action.id).map(({type,effectiveAt,details,recordedAt}) => ({type,effectiveAt,details,recordedAt})),
      assessment: this.check(scope,action.id),
    }));
  }
  get(scope: ActionScope, id: string): Action {
    const row = this.db
      .prepare(
        "SELECT document FROM energyiq_actions WHERE id=? AND workspace_id=? AND project_id=? AND (owner_id=? OR json_extract(document,'$.visibility')='project')",
      )
      .get(id, scope.workspaceId, scope.projectId, scope.userId);
    if (!row) throw new Error("ACTION_NOT_FOUND");
    return JSON.parse(String(row.document)) as Action;
  }
  create(scope: ActionScope, raw: unknown): Action {
    const input = proposalSchema.parse(raw);
    const normalized = {
      ...input,
      meterIds: [...new Set(input.meterIds)].sort(),
    };
    const hash = digest(normalized);
    const existing = this.db
      .prepare(
        "SELECT document,request_hash FROM energyiq_actions WHERE workspace_id=? AND project_id=? AND owner_id=? AND request_key=?",
      )
      .get(
        scope.workspaceId,
        scope.projectId,
        scope.userId,
        input.idempotencyKey,
      );
    if (existing) {
      if (existing.request_hash !== hash)
        throw new Error("ACTION_REQUEST_CONFLICT");
      return JSON.parse(String(existing.document)) as Action;
    }
    const now = new Date().toISOString();
    const action: Action = {
      ...normalized,
      ...scope,
      id: randomUUID(),
      revision: 1,
      state: "proposed",
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO energyiq_actions VALUES (?,?,?,?,?,?,?,?)")
      .run(
        action.id,
        scope.workspaceId,
        scope.projectId,
        scope.userId,
        1,
        input.idempotencyKey,
        hash,
        JSON.stringify(action),
      );
    return action;
  }
  record(
    scope: ActionScope,
    id: string,
    raw: unknown,
    now = new Date(),
  ): Action {
    const input = executionSchema.parse(raw);
    if (
      input.type !== "scheduled" &&
      Date.parse(input.effectiveAt) > now.getTime()
    )
      throw new Error("ACTION_FUTURE_EXECUTION");
    this.db.exec("SAVEPOINT action_event");
    try {
      const action = this.get(scope, id);
      const previous = this.db
        .prepare(
          "SELECT request_hash FROM energyiq_action_events WHERE action_id=? AND request_key=?",
        )
        .get(id, input.requestId);
      if (previous) {
        if (previous.request_hash !== digest(input))
          throw new Error("ACTION_REQUEST_CONFLICT");
        this.db.exec("RELEASE action_event");
        return action;
      }
      if (action.revision !== input.revision)
        throw new Error("ACTION_REVISION_CONFLICT");
      const event: Execution = {
        ...input,
        id: randomUUID(),
        actionId: id,
        actorUserId: scope.userId,
        recordedAt: now.toISOString(),
      };
      const updated = {
        ...action,
        revision: action.revision + 1,
        state: input.type,
        updatedAt: now.toISOString(),
      };
      this.db
        .prepare("INSERT INTO energyiq_action_events VALUES (?,?,?,?,?)")
        .run(
          event.id,
          id,
          input.requestId,
          digest(input),
          JSON.stringify(event),
        );
      this.db
        .prepare(
          "UPDATE energyiq_actions SET revision=?,document=? WHERE id=? AND revision=?",
        )
        .run(updated.revision, JSON.stringify(updated), id, input.revision);
      this.db.exec("RELEASE action_event");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK TO action_event; RELEASE action_event");
      throw error;
    }
  }
  events(scope: ActionScope, id: string): Execution[] {
    this.get(scope, id);
    return this.db
      .prepare(
        "SELECT document FROM energyiq_action_events WHERE action_id=? ORDER BY rowid",
      )
      .all(id)
      .map((row) => JSON.parse(String(row.document)) as Execution);
  }
  implemented(): Action[] {
    return this.db
      .prepare(
        "SELECT document FROM energyiq_actions WHERE json_extract(document,'$.state')='implemented' ORDER BY COALESCE((SELECT json_extract(c.document,'$.checkedAt') FROM energyiq_action_checks c WHERE c.action_id=energyiq_actions.id),'') LIMIT 100",
      )
      .all()
      .map((row) => JSON.parse(String(row.document)) as Action);
  }
  freezeBaseline(scope: ActionScope, id: string, evidence: unknown): void {
    this.get(scope, id);
    this.db
      .prepare("INSERT OR IGNORE INTO energyiq_action_baselines VALUES (?,?)")
      .run(id, JSON.stringify(evidence));
  }
  baseline(scope: ActionScope, id: string): unknown {
    this.get(scope, id);
    const row = this.db
      .prepare(
        "SELECT document FROM energyiq_action_baselines WHERE action_id=?",
      )
      .get(id);
    return row ? JSON.parse(String(row.document)) : null;
  }
  setCheck(scope: ActionScope, id: string, value: unknown): void {
    this.get(scope, id);
    this.db
      .prepare(
        "INSERT INTO energyiq_action_checks VALUES (?,?) ON CONFLICT(action_id) DO UPDATE SET document=excluded.document",
      )
      .run(id, JSON.stringify(value));
  }
  check(scope: ActionScope, id: string): unknown {
    this.get(scope, id);
    const row = this.db
      .prepare("SELECT document FROM energyiq_action_checks WHERE action_id=?")
      .get(id);
    return row ? JSON.parse(String(row.document)) : null;
  }
  feedback(
    scope: ActionScope,
    id: string,
  ): Array<{
    revision: number;
    stage: string;
    runId: string;
    receipt: unknown;
    previousRunIds?: string[];
  }> {
    this.get(scope, id);
    return this.db
      .prepare(
        "SELECT document FROM energyiq_action_feedback WHERE action_id=? ORDER BY revision,stage",
      )
      .all(id)
      .map((r) => JSON.parse(String(r.document)));
  }
  linkFeedback(
    scope: ActionScope,
    id: string,
    revision: number,
    stage: string,
    runId: string,
    receipt: unknown,
  ): void {
    const action = this.get(scope, id);
    if (action.revision !== revision || action.state !== "implemented")
      throw new Error("ACTION_REVISION_CONFLICT");
    this.db
      .prepare(
        "INSERT OR IGNORE INTO energyiq_action_feedback VALUES (?,?,?,?)",
      )
      .run(
        id,
        revision,
        stage,
        JSON.stringify({ revision, stage, runId, receipt }),
      );
  }
  replaceFeedbackRun(
    scope: ActionScope,
    id: string,
    revision: number,
    stage: string,
    oldRunId: string,
    runId: string,
  ): void {
    const action = this.get(scope, id);
    const previous = this.feedback(scope, id).find(
      (f) => f.revision === revision && f.stage === stage,
    );
    if (
      action.revision !== revision ||
      action.state !== "implemented" ||
      previous?.runId !== oldRunId
    )
      throw new Error("ACTION_REVISION_CONFLICT");
    this.db
      .prepare(
        "UPDATE energyiq_action_feedback SET document=? WHERE action_id=? AND revision=? AND stage=?",
      )
      .run(
        JSON.stringify({
          ...previous,
          runId,
          previousRunIds: [...(previous.previousRunIds ?? []), oldRunId],
        }),
        id,
        revision,
        stage,
      );
  }
  saveScenario(scope: ActionScope, id: string, scenario: unknown): string {
    this.get(scope, id);
    const key = randomUUID();
    this.db
      .prepare("INSERT INTO energyiq_action_scenarios VALUES (?,?,?)")
      .run(
        key,
        id,
        JSON.stringify({
          value: scenario,
          recordedAt: new Date().toISOString(),
          actorUserId: scope.userId,
        }),
      );
    return key;
  }
  hasDueRetry(now: Date): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM energyiq_action_checks c JOIN energyiq_actions a ON a.id=c.action_id
      WHERE json_extract(a.document,'$.state')='implemented'
      AND json_extract(c.document,'$.status')='retry_scheduled'
      AND json_extract(c.document,'$.nextRetryAt')<=? LIMIT 1`).get(now.toISOString()));
  }
  scenarios(scope: ActionScope, id: string): Array<{ id: string; recordedAt: string; value: ReturnType<typeof estimateLighting> }> {
    this.get(scope, id);
    return this.db.prepare("SELECT id,document FROM energyiq_action_scenarios WHERE action_id=? ORDER BY rowid DESC LIMIT 100")
      .all(id).map(row => ({ id: String(row.id), ...JSON.parse(String(row.document)) }));
  }
  scenario(scope: ActionScope, id: string, scenarioId: string): { id:string; recordedAt:string; value:ReturnType<typeof estimateLighting> } {
    this.get(scope,id);
    const row=this.db.prepare("SELECT id,document FROM energyiq_action_scenarios WHERE action_id=? AND id=?").get(id,scenarioId);
    if (!row) throw new Error("ACTION_NOT_FOUND");
    return {id:String(row.id),...JSON.parse(String(row.document))};
  }
  adoptScenario(scope: ActionScope, id: string, raw: unknown): Action {
    const input = z.object({ revision: z.number().int().positive(), scenarioId: z.string().uuid(), requestId: z.string().min(1).max(160) }).strict().parse(raw);
    const action = this.get(scope, id);
    const previous = this.db.prepare("SELECT request_hash FROM energyiq_action_adoptions WHERE action_id=? AND request_id=?").get(id,input.requestId);
    if (previous) {
      if (previous.request_hash !== digest(input)) throw new Error("ACTION_REQUEST_CONFLICT");
      return action;
    }
    if (action.revision !== input.revision) throw new Error("ACTION_REVISION_CONFLICT");
    if (!["proposed", "scheduled"].includes(action.state) || this.events(scope,id).some(event => event.type === "implemented"))
      throw new Error("ACTION_SCENARIO_LOCKED");
    const scenario = this.scenario(scope,id,input.scenarioId);
    if (scenario.value.inputs.days < 3 || scenario.value.inputs.days > 60) throw new Error("ACTION_SCENARIO_WINDOW_UNSUPPORTED");
    const updated = { ...action, adoptedScenarioId: scenario.id, revision: action.revision+1, updatedAt: new Date().toISOString() };
    this.db.exec("SAVEPOINT action_adoption");
    try {
      this.db.prepare("INSERT INTO energyiq_action_adoptions VALUES (?,?,?,?)").run(id,input.requestId,digest(input),JSON.stringify({ ...input, actorUserId:scope.userId, recordedAt:updated.updatedAt }));
      this.db.prepare("UPDATE energyiq_actions SET revision=?,document=? WHERE id=? AND revision=?").run(updated.revision,JSON.stringify(updated),id,input.revision);
      this.db.exec("RELEASE action_adoption");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK TO action_adoption; RELEASE action_adoption");
      throw error;
    }
  }
  extraction(sourceId: string): string | undefined {
    const row = this.db.prepare("SELECT run_id FROM energyiq_action_extractions WHERE source_id=?").get(sourceId);
    return row ? String(row.run_id) : undefined;
  }
  linkExtraction(sourceId: string, runId: string): void {
    this.db.prepare("INSERT INTO energyiq_action_extractions VALUES (?,?) ON CONFLICT(source_id) DO UPDATE SET run_id=excluded.run_id").run(sourceId,runId);
  }
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

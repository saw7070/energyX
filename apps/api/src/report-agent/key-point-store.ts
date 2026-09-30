import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { validateKeyPointSelection, type KeyPointSelection, type SelectableInsight } from "./key-point-selection.js";

type Scope = {workspaceId: string; projectId: string};
export type KeyPointPublication = {revision: number; reportId: string; publishedAt: string; selection: KeyPointSelection;
  maintenance?: { retainedActionIds: string[]; addedActionIds: string[]; omitted: Array<{actionId:string;reason:string}> } };

/** Immutable shortlist history, referencing existing Insights and Actions. */
export class KeyPointStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS energyiq_key_point_publications (
      workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
      report_id TEXT NOT NULL, content_hash TEXT NOT NULL, document TEXT NOT NULL,
      PRIMARY KEY(workspace_id,project_id,revision), UNIQUE(workspace_id,project_id,report_id))`);
  }
  latest(scope: Scope): KeyPointPublication | null {
    const row = this.db.prepare("SELECT document FROM energyiq_key_point_publications WHERE workspace_id=? AND project_id=? ORDER BY revision DESC LIMIT 1").get(scope.workspaceId,scope.projectId);
    return row ? JSON.parse(String(row.document)) : null;
  }
  /** Caller authorizes publication and verifies the accepted report and evidence. */
  publish(scope: Scope, reportId: string, expectedRevision: number, input: unknown,
    insights: SelectableInsight[], visibleActionIds: ReadonlySet<string>): KeyPointPublication {
    const selection = validateKeyPointSelection(input, insights, visibleActionIds);
    const hash = createHash("sha256").update(JSON.stringify(selection)).digest("hex");
    this.db.exec("SAVEPOINT key_point_publish");
    try {
      const prior = this.db.prepare("SELECT content_hash,document FROM energyiq_key_point_publications WHERE workspace_id=? AND project_id=? AND report_id=?").get(scope.workspaceId,scope.projectId,reportId);
      if (prior) {
        if (prior.content_hash !== hash) throw new Error("KEY_POINT_PUBLICATION_CONFLICT");
        this.db.exec("RELEASE key_point_publish");
        return JSON.parse(String(prior.document));
      }
      const current = this.latest(scope);
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error("KEY_POINT_PUBLICATION_CONFLICT");
      if (current && selection.dataEndExclusive < current.selection.dataEndExclusive) throw new Error("KEY_POINT_STALE_DATA");
      // Full-history weekly/monthly issues can share data bounds but cite different
      // evidence windows. A retrospective issue must not regress a live priority.
      if (current && selection.active.some(item => {
        const previous = current.selection.active.find(value => value.actionId === item.actionId);
        return previous && item.evidenceToExclusive < previous.evidenceToExclusive;
      })) throw new Error("KEY_POINT_STALE_EVIDENCE");
      const previousIds = new Set(current?.selection.active.map(item=>item.actionId) ?? []);
      const nextIds = new Set(selection.active.map(item=>item.actionId));
      const maintenance = {
        retainedActionIds: [...nextIds].filter(id=>previousIds.has(id)),
        addedActionIds: [...nextIds].filter(id=>!previousIds.has(id)),
        omitted: [...previousIds].filter(id=>!nextIds.has(id)).map(actionId=>({actionId,reason:"Not selected in this accepted analysis; this does not establish resolution or change execution state."})),
      };
      const value = {revision: expectedRevision + 1, reportId, publishedAt: new Date().toISOString(), selection, maintenance};
      this.db.prepare("INSERT INTO energyiq_key_point_publications VALUES (?,?,?,?,?,?)").run(scope.workspaceId,scope.projectId,value.revision,reportId,hash,JSON.stringify(value));
      this.db.exec("RELEASE key_point_publish");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK TO key_point_publish; RELEASE key_point_publish");
      throw error;
    }
  }
}

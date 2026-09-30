import type {DatabaseSync} from 'node:sqlite';
import {ActionStore,type ActionScope} from './action-store.js';
import {hasReportArtifact,type ReportStore} from './report-store.js';
export class ActionNotifications {
 constructor(private db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS energyiq_action_feedback_reads (user_id TEXT NOT NULL, run_id TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(user_id,run_id))');}
 list(scope:ActionScope,reports:ReportStore){const actions=new ActionStore(this.db);return actions.listProject(scope).filter(a=>a.state==='implemented').flatMap(a=>actions.feedback(scope,a.id).flatMap(f=>{
 if(f.revision!==a.revision)return [];let run;try{run=reports.get(scope.projectId,f.runId);}catch{return [];}
 if(run.workspaceId!==scope.workspaceId||run.status!=='succeeded'||!hasReportArtifact(run)||run.actionFeedback?.actionId!==a.id||run.actionFeedback.demonstrationId||run.actionFeedback.revision!==a.revision)return [];
 if(this.db.prepare('SELECT 1 FROM energyiq_action_feedback_reads WHERE user_id=? AND run_id=?').get(scope.userId,run.id))return [];
 return [{actionId:a.id,title:a.title,sourceReportId:a.sourceReportId,runId:run.id,finishedAt:run.finishedAt}];
 }));}
 read(scope:ActionScope,reports:ReportStore,runId:string){if(!this.list(scope,reports).some(n=>n.runId===runId))return;this.db.prepare('INSERT OR IGNORE INTO energyiq_action_feedback_reads VALUES(?,?,?)').run(scope.userId,runId,new Date().toISOString());}
}

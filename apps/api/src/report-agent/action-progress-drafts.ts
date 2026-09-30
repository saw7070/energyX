import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {ActionStore,type ActionScope} from './action-store.js';
export const progressResultSchema=z.object({type:z.enum(['scheduled','implemented','paused','declined']).nullable(),effectiveAt:z.string().datetime({offset:true}).nullable(),summary:z.string().trim().min(1).max(1000),questions:z.array(z.string().min(1).max(500)).max(3)}).strict();
export type ProgressDraft={id:string;actionId:string;actorUserId:string;revision:number;runId:string;requestId:string;text:string;createdAt:string;status:'pending'|'succeeded'|'failed';result?:z.infer<typeof progressResultSchema>;confirmedAt?:string};
export class ActionProgressDrafts {
 private actions:ActionStore;
 constructor(private db:DatabaseSync){this.actions=new ActionStore(db);db.exec('CREATE TABLE IF NOT EXISTS energyiq_action_progress_drafts (id TEXT PRIMARY KEY, action_id TEXT NOT NULL, user_id TEXT NOT NULL, request_id TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(action_id,user_id,request_id))');}
 list(scope:ActionScope,actionId:string):ProgressDraft[]{this.actions.get(scope,actionId);return this.db.prepare('SELECT document FROM energyiq_action_progress_drafts WHERE action_id=? AND user_id=? ORDER BY rowid DESC LIMIT 30').all(actionId,scope.userId).map(r=>JSON.parse(String(r.document)));}
 start(scope:ActionScope,actionId:string,input:{requestId:string;text:string},enqueue:()=>string){
 const a=this.actions.get(scope,actionId);this.db.exec('SAVEPOINT progress_start');
 try{const previous=this.list(scope,actionId).find(d=>d.requestId===input.requestId);if(previous){if(previous.text!==input.text)throw new Error('ACTION_REQUEST_CONFLICT');this.db.exec('RELEASE progress_start');return previous;}
 if(this.list(scope,actionId).some(d=>d.status==='pending'))throw new Error('REPORT_ALREADY_RUNNING');
 const draft:ProgressDraft={...input,id:randomUUID(),actionId,actorUserId:scope.userId,revision:a.revision,runId:enqueue(),createdAt:new Date().toISOString(),status:'pending'};
 this.db.prepare('INSERT INTO energyiq_action_progress_drafts VALUES(?,?,?,?,?)').run(draft.id,actionId,scope.userId,input.requestId,JSON.stringify(draft));this.db.exec('RELEASE progress_start');return draft;
 }catch(e){this.db.exec('ROLLBACK TO progress_start; RELEASE progress_start');throw e;}}
 finish(scope:ActionScope,actionId:string,runId:string,result:unknown,failed=false){const d=this.list(scope,actionId).find(d=>d.runId===runId);if(!d)throw new Error('ACTION_NOT_FOUND');if(d.status!=='pending')return;this.save({...d,status:failed?'failed':'succeeded',...(!failed?{result:progressResultSchema.parse(result)}:{})});}
 confirm(scope:ActionScope,actionId:string,id:string){const d=this.list(scope,actionId).find(d=>d.id===id);if(!d)throw new Error('ACTION_NOT_FOUND');if(d.confirmedAt)return this.actions.get(scope,actionId);
 if(d.status!=='succeeded'||!d.result?.type||!d.result.effectiveAt||d.result.questions.length)throw new Error('ACTION_PROGRESS_NEEDS_CLARIFICATION');
 this.db.exec('SAVEPOINT progress_confirm');try{const a=this.actions.record(scope,actionId,{revision:d.revision,requestId:'progress:'+d.id,type:d.result.type,effectiveAt:d.result.effectiveAt,details:d.text});this.save({...d,confirmedAt:new Date().toISOString()});this.db.exec('RELEASE progress_confirm');return a;}catch(e){this.db.exec('ROLLBACK TO progress_confirm; RELEASE progress_confirm');throw e;}}
 private save(d:ProgressDraft){this.db.prepare('UPDATE energyiq_action_progress_drafts SET document=? WHERE id=?').run(JSON.stringify(d),d.id);}
}

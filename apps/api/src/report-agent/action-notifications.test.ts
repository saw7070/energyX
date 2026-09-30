import {DatabaseSync} from 'node:sqlite';
import {it,expect} from 'vitest';
import {ActionStore} from './action-store.js';
import {ActionNotifications} from './action-notifications.js';
import type {ReportStore} from './report-store.js';
it('shows only successful current non-demo results and tracks receipts per user',()=>{
 const db=new DatabaseSync(':memory:');try{const scope={workspaceId:'w',projectId:'p',userId:'u'},a=new ActionStore(db);const item=a.create(scope,{sourceReportId:'source',title:'Lights',recommendation:'Review lights',meterIds:['light'],baseline:{from:'2026-08-01',toExclusive:'2026-09-01',snapshotId:'s'},idempotencyKey:'a',visibility:'project'});const action=a.record(scope,item.id,{revision:1,requestId:'event',type:'implemented',effectiveAt:'2026-09-01T20:00:00+08:00',details:'Test fixture'});
 db.prepare('INSERT INTO energyiq_action_feedback VALUES(?,?,?,?)').run(action.id,action.revision,'weekly',JSON.stringify({runId:'r',revision:action.revision,stage:'weekly'}));
 const run:any={id:'r',projectId:'p',workspaceId:'w',kind:'report',status:'succeeded',actionFeedback:{actionId:action.id,revision:action.revision}};const reports={get:()=>run} as unknown as ReportStore;const n=new ActionNotifications(db);
 expect(n.list(scope,reports)).toHaveLength(1);n.read(scope,reports,'r');expect(n.list(scope,reports)).toHaveLength(0);expect(n.list({...scope,userId:'other'},reports)).toHaveLength(1);
 run.status='failed';expect(n.list({...scope,userId:'other'},reports)).toHaveLength(0);run.status='succeeded';run.actionFeedback.demonstrationId='demo';expect(n.list({...scope,userId:'other'},reports)).toHaveLength(0);delete run.actionFeedback.demonstrationId;run.actionFeedback.revision=1;expect(n.list({...scope,userId:'other'},reports)).toHaveLength(0);
 }finally{db.close();}
});

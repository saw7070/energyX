import {createMetadataStore} from "@datafoundry/metadata";
import {mkdtempSync,rmSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";
import {Readable} from "node:stream";import type {IncomingMessage} from "node:http";import {beforeEach,afterEach,it,expect} from "vitest";
import {ReportService,registerReportService} from "./report-service.js";import type {ConfigApiContext} from "../routes/types.js";
import {handleReportTaskHistoryApi} from "./report-task-history-api.js";
let root:string;let metadata:ReturnType<typeof createMetadataStore>;let context:Required<ConfigApiContext>;
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),"task-history-"));metadata=createMetadataStore({database_path:join(root,"db.sqlite")});
 for(const id of ['admin','other','member'])metadata.users.upsertDevUser({id,email:`${id}@test.com`,display_name:id,dev_token:id});
 metadata.energyIq.upsertUserRole({user_id:'admin',role:'admin'});metadata.energyIq.upsertUserRole({user_id:'member',role:'user'});
 for(const w of ['w','outside']){metadata.workspaces.upsert({id:w,owner_user_id:'admin',name:w,kind:'customer'});metadata.energyIq.upsertProject({id:w==='w'?'p':'foreign',workspace_id:w,name:w==='w'?'Office':'Hidden project',status:'published',timezone:'Asia/Singapore'});}
 context={metadataStore:metadata,workspaceId:'w',userId:'admin',fileAssetService:{}} as Required<ConfigApiContext>;
 const service=new ReportService({metadata,root,files:context.fileAssetService,harness:async()=>({answer:''})});registerReportService(metadata,service);
 for(let i=0;i<25;i++){
 const run={id:`r${String(i).padStart(2,'0')}`,projectId:'p',workspaceId:'w',actorUserId:i===0?'admin':'other',status:i%2?'failed':'succeeded',kind:'report',sessionId:'private-session',prompt:'SECRET-PROMPT',answer:'SECRET-ANSWER',errorCode:'SECRET-ERROR',createdAt:`2026-09-01T00:${String(i).padStart(2,'0')}:00Z`,startedAt:'2026-09-01T00:00:00Z',finishedAt:'2026-09-01T00:01:00Z',period:{from:'2026-08-01',toExclusive:'2026-09-01'},settings:{timezone:'Asia/Singapore',contextNotes:'SECRET-CONFIG',skillUsage:[{name:'SECRET-PERSONAL-SKILL',version:'private',source:'explicit',contentHash:'SECRET-HASH',inputPath:'SECRET-PATH'}]},...(i%3===0?{scheduleKey:`auto-${i}`}:{})};
 metadata.db.prepare('INSERT INTO energyiq_report_runs VALUES (?,?,?,?,?)').run(run.id,'p',run.status,run.scheduleKey??null,JSON.stringify(run));
 }
 const foreign={id:'hidden',projectId:'foreign',workspaceId:'outside',status:'running',settings:{}};
 metadata.db.prepare('INSERT INTO energyiq_report_runs VALUES (?,?,?,?,?)').run('hidden','foreign','running',null,JSON.stringify(foreign));
 metadata.db.prepare('INSERT INTO energyiq_report_events (run_id,document) VALUES (?,?)').run('r24',JSON.stringify({time:'2026-09-01',type:'tool_execution_end',text:'SECRET-TOOL',tool:'SECRET-FILE'}));
});
afterEach(()=>{metadata.db.close();rmSync(root,{recursive:true,force:true})});
async function call(query='',id?:string,userId='admin',method='GET') {const req=Readable.from([]) as IncomingMessage;req.method=method;req.url='/api/v1/energy/admin/task-history'+query;return handleReportTaskHistoryApi(req,id?[id]:[],{...context,userId});}
it('paginates all authorized records with server filters and hides other workspaces',async()=>{
 const first=await call();const a=(first.body as any).data;expect(a.total).toBe(25);expect(a.items).toHaveLength(20);expect(a.items[0].id).toBe('r24');
 const b=((await call('?page=1')).body as any).data;expect(b.items).toHaveLength(5);expect(new Set([...a.items,...b.items].map(x=>x.id)).size).toBe(25);
 const auto=((await call('?origin=automatic&status=succeeded&projectId=p')).body as any).data;expect(auto.items.every((x:{origin:string;status:string})=>x.origin==='automatic'&&x.status==='succeeded')).toBe(true);
 expect(JSON.stringify(first.body)).not.toContain('Hidden project');expect((await call('?page=-1')).status).toBe(400);expect((await call('?status=anything')).status).toBe(400);
});
it('denies non-admin, out-of-scope filters and direct IDs without revealing existence',async()=>{
 expect((await call('',undefined,'member')).status).toBe(403);
 expect((await call('?projectId=foreign')).status).toBe(404);
 expect(await call('','hidden')).toEqual(await call('','nonexistent'));
 expect((await call('','r24','admin','POST')).status).toBe(405);
});
it('projects allowlisted metadata only and separates private conversations from readable reports',async()=>{
 const response=await call('','r24');expect(response.status).toBe(200);const d=(response.body as any).data.task;
 expect(JSON.stringify(response)).not.toContain('SECRET');expect(d.conversationHref).toBeNull();expect(d.sessionId).toBeNull();expect(d.reportHref).toContain('reportId=r24');expect(d.model).toBeNull();expect(d.data.snapshot).toBeNull();expect(d.skills[0]).toEqual({name:'Private method',version:null,source:'explicit'});
 const own=((await call('','r00')).body as any).data.task;expect(own.conversationHref).toContain('sessionId=private-session');
 const failed=((await call('','r23')).body as any).data.task;expect(failed.reportHref).toBeNull();expect(failed.failureReason).not.toContain('SECRET');
});

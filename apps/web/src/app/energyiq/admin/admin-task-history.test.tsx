/** @vitest-environment happy-dom */
import React,{act} from "react";import {createRoot} from "react-dom/client";import {it,expect,vi} from "vitest";
import {AdminTaskHistory,taskDuration} from "./admin-task-history";
it("filters and paginates server history, opens only provided links and labels missing evidence",async()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
 const task={id:'internal-id',projectName:'Office',title:'Energy report',actor:'Automatic report',origin:'automatic',status:'succeeded',createdAt:'2026-09-01T00:00:00Z',startedAt:null,finishedAt:null,conversationHref:null,reportHref:'/energyiq/library?projectId=p&reportId=r'};
 const client={reportTaskHistoryRequest:vi.fn(async(query:string)=>query.startsWith('/')?{task:{...task,period:{from:'2026-08-01',toExclusive:'2026-09-01'},timezone:'Asia/Singapore',model:null,skills:[],data:{snapshot:null,hierarchy:null,mapping:null},failureReason:null,events:[],sessionId:null}}:{items:[task],total:21,page:query.includes('page=1')?1:0,pageSize:20,projects:[{id:'p',name:'Office'}],observedAt:'2026-09-01T00:02:00Z'})};
 try{
 await act(async()=>root.render(<AdminTaskHistory client={client as any}/>));const click=async(name:string)=>act(async()=>[...el.querySelectorAll('button')].find(b=>b.textContent===name)!.click());
 expect(el.textContent).not.toContain('internal-id');expect(taskDuration(task,'2026-09-01')).toBe('Not recorded');
 await click('Next');expect(client.reportTaskHistoryRequest.mock.calls.at(-1)![0]).toContain('page=1');
 const status=[...el.querySelectorAll('select')][1]!;await act(async()=>{status.value='failed';status.dispatchEvent(new Event('change',{bubbles:true}))});
 expect(client.reportTaskHistoryRequest.mock.calls.at(-1)![0]).toContain('page=0');expect(client.reportTaskHistoryRequest.mock.calls.at(-1)![0]).toContain('status=failed');
 await click('Energy report');expect(el.querySelector('a')?.getAttribute('href')).toBe(task.reportHref);expect(el.textContent).toContain('Conversation private to its author');expect(el.textContent).toContain('2026-08-31');expect(el.textContent).toContain('Not recorded');expect(el.querySelector('details')?.open).toBe(false);
 expect(taskDuration({...task,status:'running',startedAt:'2026-09-01T00:00:00Z'},'2026-09-01T00:02:00Z')).toBe('2m 0s');
 }finally{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();}
});
it("shows denied history as unavailable without displaying cached rows",async()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const el=document.createElement('div');const root=createRoot(el);
 try{await act(async()=>root.render(<AdminTaskHistory client={{reportTaskHistoryRequest:vi.fn().mockRejectedValue(new Error('403 private'))}}/>));expect(el.querySelector('[role="alert"]')?.textContent).toContain('Check your access');expect(el.textContent).not.toContain('403 private');}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});

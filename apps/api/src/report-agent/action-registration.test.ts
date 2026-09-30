import {DatabaseSync} from "node:sqlite";
import {expect,it,vi} from "vitest";
import type {MetadataStore} from "@datafoundry/metadata";
import type {ReportRun} from "./report-store.js";
import {ActionStore} from "./action-store.js";
import {registerReportActions} from "./action-registration.js";
import type {readActionEvidence} from "./action-data.js";
import {InsightStore} from "./insight-store.js";
it("keeps an ungrounded recommendation out of the project list without inventing an insight",async()=>{
 const db=new DatabaseSync(":memory:"),metadata={db} as MetadataStore;
 const run={id:"no-insight",workspaceId:"w",projectId:"p",actorUserId:"u",settings:{timezone:"Asia/Singapore"},period:{from:"2026-09-01",toExclusive:"2026-09-08"}} as ReportRun;
 const evidence=vi.fn<typeof readActionEvidence>();
 try{
  const result=await registerReportActions(metadata,run,[{id:"none",title:"Change hours",recommendation:"Close earlier",meterId:"led",sourceQuote:"Close earlier during the week"}],"s",evidence);
  expect(result).toEqual({created:0,linked:0,needsReview:1});
  expect(new ActionStore(db).listProject({workspaceId:"w",projectId:"p",userId:"u"})).toEqual([]);
  expect(evidence).not.toHaveBeenCalled();
 }finally{db.close();}
});
it("registers multiple distinct actions from one finding without merging the measures",async()=>{
 const db=new DatabaseSync(":memory:"),metadata={db} as MetadataStore;
 const run={id:"multi",workspaceId:"w",projectId:"p",actorUserId:"u",settings:{timezone:"Asia/Singapore"},period:{from:"2026-09-01",toExclusive:"2026-09-08"}} as ReportRun;
 const insight={title:"Night demand",summary:"The circuit remains active outside operating hours.",sourceQuote:"The circuit remains active outside operating hours."};
 const items=["Inspect the timer", "Confirm required overnight equipment"].map((recommendation,i)=>({id:String(i).repeat(24),title:recommendation,recommendation,meterId:"led",sourceQuote:insight.sourceQuote,insight}));
 const evidence=async()=>({snapshotId:"s"}) as Awaited<ReturnType<typeof readActionEvidence>>;
 try {
  expect(await registerReportActions(metadata,run,items,"s",evidence)).toEqual({created:2,linked:0,needsReview:0});
  const scope={workspaceId:"w",projectId:"p",userId:"u"};
  expect(new ActionStore(db).listProject(scope)).toHaveLength(2);
  expect(new InsightStore(db).list(scope)[0]?.actionIds).toHaveLength(2);
  expect(await registerReportActions(metadata,run,items,"s",evidence)).toEqual({created:0,linked:2,needsReview:0});
 } finally {db.close();}
});
it("registers new proposals, links exact repeats and leaves ambiguous actions for review",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-16T00:00:00Z"));
 const db=new DatabaseSync(":memory:");const metadata={db} as MetadataStore;
 const run={id:"report-a",workspaceId:"w",projectId:"p",actorUserId:"u",settings:{timezone:"Asia/Singapore"},period:{from:"2026-09-01",toExclusive:"2026-09-08"}} as ReportRun;
 const item={id:"a".repeat(24),title:"LED routine",recommendation:"Close at 19:00",meterId:"led",sourceQuote:"Close at 19:00 every evening",insight:{title:"Night demand",summary:"Demand continues outside operating hours",sourceQuote:"Demand continues outside operating hours"}};
 const evidence=async()=>({snapshotId:"s"}) as Awaited<ReturnType<typeof readActionEvidence>>;
 try {
 expect(await registerReportActions(metadata,run,[item],"s",evidence)).toEqual({created:1,linked:0,needsReview:0});
 expect(await registerReportActions(metadata,{...run,id:"report-b"},[item],"s",evidence)).toEqual({created:0,linked:1,needsReview:0});
 const store=new ActionStore(db),scope={workspaceId:"w",projectId:"p",userId:"u"};
 expect(store.listProject(scope)).toHaveLength(1);expect(store.listProject(scope)[0]?.baseline).toEqual({from:"2026-08-11",toExclusive:"2026-09-08",snapshotId:"s"});expect(store.list(scope,"report-b")[0]?.state).toBe("proposed");
 expect(await registerReportActions(metadata,{...run,id:"report-c"},[{...item,recommendation:"Replace LED"}],"s",evidence)).toEqual({created:0,linked:0,needsReview:1});
 expect(await registerReportActions(metadata,run,[{...item,meterId:"other"}],"changed",evidence)).toEqual({created:0,linked:0,needsReview:1});
 const concurrent=await Promise.all(["parallel-a","parallel-b"].map(id=>registerReportActions(metadata,{...run,id},[{...item,meterId:"second-led"}],"s",evidence)));
 expect(concurrent.reduce((n,r)=>n+r.created,0)).toBe(1);
 expect(concurrent.reduce((n,r)=>n+r.linked,0)).toBe(1);
 }finally{db.close();vi.useRealTimers()}
});
it("freezes complete project-local days even when the report includes today",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-15T18:00:00Z")); // 16 Sep in Singapore
 const db=new DatabaseSync(":memory:");const metadata={db} as MetadataStore;
 const run={id:"current-report",workspaceId:"w",projectId:"p",actorUserId:"u",settings:{timezone:"Asia/Singapore"},period:{from:"2026-09-09",toExclusive:"2026-09-17"}} as ReportRun;
 const evidence=vi.fn<typeof readActionEvidence>(async()=>({snapshotId:"s"}) as Awaited<ReturnType<typeof readActionEvidence>>);
 try{
  await registerReportActions(metadata,run,[{id:"b".repeat(24),title:"Review schedule",recommendation:"Confirm required running hours",meterId:"led",sourceQuote:"Confirm required running hours",insight:{title:"Running hours",summary:"The circuit runs continuously overnight",sourceQuote:"The circuit runs continuously overnight"}}],"s",evidence);
  expect(evidence.mock.calls[0]?.[3]).toEqual({from:"2026-08-19",toExclusive:"2026-09-16"});
  const store=new ActionStore(db),scope={workspaceId:"w",projectId:"p",userId:"u"};
  expect(store.listProject(scope)[0]?.baseline).toEqual({from:"2026-08-19",toExclusive:"2026-09-16",snapshotId:"s"});
 }finally{db.close();vi.useRealTimers()}
});

it("adds a recurring report to a grouped finding without resetting actions or assessments",async()=>{
 const db=new DatabaseSync(":memory:"),metadata={db} as MetadataStore,scope={workspaceId:"w",projectId:"p",userId:"u"};
 const run={id:"first",workspaceId:"w",projectId:"p",actorUserId:"u",settings:{timezone:"Asia/Singapore"},period:{from:"2026-09-01",toExclusive:"2026-09-08"}} as ReportRun;
 const insight={title:"Night demand",summary:"Demand continues after hours",sourceQuote:"Demand continues after hours"};
 const item={id:"a".repeat(24),title:"Review hours",recommendation:"Review operating hours with the facility manager",meterId:"led",sourceQuote:"Review operating hours",insight};
 const read=async()=>({snapshotId:"s"}) as Awaited<ReturnType<typeof readActionEvidence>>;
 try {
 await registerReportActions(metadata,run,[item],"s",read);
 const actions=new ActionStore(db),before=actions.listProject(scope)[0]!,store=new InsightStore(db),first=store.list(scope)[0]!;
 const second=store.attach(scope,"independent-action",["led"],"another-report",{...insight,summary:"Overnight demand persists"});
 store.review(scope,first.id,{revision:0,status:"monitoring",importance:"high",urgency:"soon",reason:"Waiting for further comparable observations"});
 const all=store.list(scope);
 const merge=store.merge(scope,{sourceId:second.id,targetId:first.id,sourceVersion:all.find(i=>i.id===second.id)!.version,targetVersion:all.find(i=>i.id===first.id)!.version,reason:"Same night-demand finding from two reports",requestId:crypto.randomUUID()});
 expect(await registerReportActions(metadata,{...run,id:"next"},[{...item,insight:{...insight,summary:"New period confirms continued demand",sourceQuote:"New evidence for this period"}}],"s",read)).toEqual({created:0,linked:1,needsReview:0});
 expect(actions.get(scope,before.id)).toEqual(before);
 expect(store.list(scope)).toHaveLength(1);
 expect(store.list(scope)[0]).toMatchObject({review:{status:"monitoring"},mergeId:merge.id});
 expect(store.list(scope)[0]?.sources.map(s=>s.reportId)).toContain("next");
 store.undoMerge(scope,merge.id,"Separate these observations for more investigation");
 expect(store.list(scope).find(i=>i.id===first.id)?.sources.map(s=>s.reportId)).toContain("next");
 }finally{db.close();}
});

it("registers a multi-meter measure once across order and wording changes, and retains a distinct measure",async()=>{
 const db=new DatabaseSync(":memory:"),metadata={db} as MetadataStore,scope={workspaceId:"w",projectId:"p",userId:"u"};
 const run={id:"group-1",workspaceId:"w",projectId:"p",actorUserId:"u",settings:{timezone:"Asia/Singapore"},period:{from:"2026-09-01",toExclusive:"2026-09-08"}} as ReportRun;
 const read=vi.fn<typeof readActionEvidence>(async(_m,_s,meterId,period)=>({snapshotId:"s",hierarchyRevisionId:"h",meterMappingRevisionId:"m",timezone:"Asia/Singapore",period,meterId,days:[],capturedAt:"now",actualLastIntervalEnd:null}));
 const item={id:"c".repeat(24),title:"Display hours",recommendation:"End display at 20:00",meterId:null,meterIds:["led1","led2"],measureKey:"display-end-2000",sourceQuote:"End display at 20:00",insight:{title:"Evening use",summary:"Both displays remain on during the evening",sourceQuote:"Both displays remain on during the evening"}};
 try {
 expect((await registerReportActions(metadata,run,[item],"s",read)).created).toBe(1);
 expect((await registerReportActions(metadata,{...run,id:"group-2"},[{...item,meterIds:["led2","led1"],recommendation:"Switch display off at 8pm"}],"s",read)).linked).toBe(1);
 expect((await registerReportActions(metadata,{...run,id:"group-3"},[{...item,id:"d".repeat(24),measureKey:"display-weekend-off",recommendation:"Disable display on weekends"}],"s",read)).created).toBe(1);
 expect(new ActionStore(db).listProject(scope)).toHaveLength(2);
 }finally{db.close();}
});

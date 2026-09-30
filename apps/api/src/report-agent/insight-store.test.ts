import {DatabaseSync} from "node:sqlite";
import {expect,it} from "vitest";
import {InsightStore} from "./insight-store.js";
it("groups exact findings across reports and supports multiple independent actions without crossing projects",()=>{
 const db=new DatabaseSync(":memory:"),store=new InsightStore(db),scope={workspaceId:"w",projectId:"p",userId:"u"};
 const draft={title:"Night load",summary:"Persistent energy outside operating hours",sourceQuote:"Energy remains high outside operating hours"};
 try{
 const a=store.attach(scope,"a",["led"],"r1",draft);store.attach(scope,"b",["led"],"r2",draft);
 expect(store.list(scope)).toHaveLength(1);expect(store.list(scope)[0]).toMatchObject({id:a.id,actionIds:["a","b"]});expect(store.list(scope)[0]?.sources).toHaveLength(2);
 store.attach(scope,"a",["led"],"r3",{...draft,summary:"A differently phrased recurring finding"});expect(store.list(scope)).toHaveLength(1);
 expect(store.list({...scope,projectId:"other"})).toEqual([]);expect(()=>store.attach({...scope,workspaceId:"other"},"c",["led"],"r",draft,a.id)).toThrow("NOT_FOUND");
 expect(()=>store.attach(scope,"c",["other-meter"],"r",draft,a.id)).toThrow("INPUT_INVALID");
 store.attach({...scope,workspaceId:"w/a",projectId:"b"},"slash",["led"],"r",draft);
 expect(store.list({...scope,workspaceId:"w",projectId:"a/b"})).toEqual([]);
 }finally{db.close();}
});

it("keeps assessments scoped, revision checked and preserved across reports", () => {
 const db=new DatabaseSync(":memory:"), store=new InsightStore(db), scope={workspaceId:"w",projectId:"p",userId:"u"};
 try {
 const draft={title:"Load",summary:"Persistent load",sourceQuote:"Persistent load"};
 const item=store.attach(scope,"a",["m"],"r",draft);
 expect(store.list(scope)[0]?.review.revision).toBe(0);
 const review={revision:0,status:"monitoring",importance:"high",urgency:"soon",reason:"Awaiting seven days of comparable readings"};
 store.review(scope,item.id,review);
 expect(()=>store.review(scope,item.id,review)).toThrow("REVISION_CONFLICT");
 expect(()=>store.review({...scope,projectId:"other"},item.id,{...review,revision:1})).toThrow("NOT_FOUND");
 store.attach(scope,"a",["m"],"next",draft);
 expect(store.list(scope)[0]).toMatchObject({review:{revision:1,status:"monitoring"},actionIds:["a"],reviewHistory:[{actorUserId:"u"}]});
 expect(store.list(scope)[0]?.sources).toHaveLength(2);
 } finally { db.close(); }
});

it("groups reversibly without losing newer evidence or action associations",()=>{
 const db=new DatabaseSync(":memory:"), store=new InsightStore(db), scope={workspaceId:"w",projectId:"p",userId:"u"};
 try {
 const draft={title:"Night load",summary:"Unexpected overnight demand",sourceQuote:"Demand overnight"};
 const a=store.attach(scope,"a",["m"],"r1",draft), b=store.attach(scope,"b",["m"],"r2",{...draft,summary:"A recurring overnight load"});
 const rows=store.list(scope), source=rows.find(i=>i.id===a.id)!, target=rows.find(i=>i.id===b.id)!;
 const input={sourceId:a.id,targetId:b.id,sourceVersion:source.version,targetVersion:target.version,reason:"Both reports describe the same night load",requestId:crypto.randomUUID()};
 expect(()=>store.merge({...scope,projectId:"other"},input)).toThrow("NOT_FOUND");
 expect(()=>store.merge(scope,{...input,sourceVersion:"0".repeat(64)})).toThrow("REVISION_CONFLICT");
 const result=store.merge(scope,input);expect(store.merge(scope,input).id).toBe(result.id);
 expect(store.list(scope)).toHaveLength(1);expect(store.list(scope)[0]?.actionIds.sort()).toEqual(["a","b"]);
 expect(store.list(scope)[0]?.sources).toHaveLength(2);
 expect(()=>store.merge(scope,{...input,requestId:crypto.randomUUID()})).toThrow("ALREADY_GROUPED");
 store.attach(scope,"a",["m"],"r3",draft);
 store.review(scope,b.id,{revision:0,status:"monitoring",importance:"high",urgency:"soon",reason:"New readings need ongoing observation"});
 expect(()=>store.undoMerge({...scope,workspaceId:"other"},result.id,"Undo this grouping for review")).toThrow("NOT_FOUND");
 store.undoMerge(scope,result.id,"The causes need separate investigation");
 store.undoMerge(scope,result.id,"Repeated undo should be harmless");
 const restored=store.list(scope);expect(restored).toHaveLength(2);
 expect(restored.find(i=>i.id===a.id)?.sources).toHaveLength(2);
 expect(restored.find(i=>i.id===b.id)?.review.status).toBe("monitoring");
 expect(restored.find(i=>i.id===a.id)?.actionIds).toEqual(["a"]);
 }finally{db.close();}
});

it("rejects stale action sets, self grouping and different meter scopes",()=>{
 const db=new DatabaseSync(":memory:"),store=new InsightStore(db),scope={workspaceId:"w",projectId:"p",userId:"u"};
 try {
 const draft={title:"Load",summary:"Night load",sourceQuote:"Night demand"};
 const a=store.attach(scope,"a",["m"],"r",draft),b=store.attach(scope,"b",["other"],"s",{...draft,summary:"Other demand"});
 const rows=store.list(scope),input={sourceId:a.id,targetId:b.id,sourceVersion:rows.find(i=>i.id===a.id)!.version,targetVersion:rows.find(i=>i.id===b.id)!.version,reason:"Comparing potentially related loads",requestId:crypto.randomUUID()};
 expect(()=>store.merge(scope,input)).toThrow("INCOMPATIBLE");
 expect(()=>store.merge(scope,{...input,targetId:a.id,targetVersion:input.sourceVersion})).toThrow("INCOMPATIBLE");
 store.attach(scope,"extra",["m"],"r",draft,a.id);
 expect(()=>store.merge(scope,input)).toThrow("REVISION_CONFLICT");expect(store.list(scope)).toHaveLength(2);
 }finally{db.close();}
});

import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { KeyPointStore } from "./key-point-store.js";

it("does not let a retrospective monthly issue overwrite newer weekly evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new KeyPointStore(db), scope = {workspaceId:"w",projectId:"p"};
    const actionId="11111111-1111-4111-8111-111111111111", insightId="22222222-2222-4222-8222-222222222222";
    const insight={id:insightId,version:"a".repeat(64),actionIds:[actionId],review:{status:"active"}};
    const selection={dataEndExclusive:"2026-09-14",active:[{insightId,actionId,insightVersion:insight.version,issue:"Evening lighting",evidence:"Measured late use",evidenceFrom:"2026-09-07",evidenceToExclusive:"2026-09-12",nextStep:"Confirm schedule",benefit:"Conditional savings",assumptions:"Site confirmation",reason:"Actionable"}],featuredActionIds:[actionId]};
    const first=store.publish(scope,"weekly",0,selection,[insight],new Set([actionId]));
    const monthly={...selection,active:selection.active.map(item=>({...item,evidenceFrom:"2026-08-18",evidenceToExclusive:"2026-09-01"}))};
    expect(()=>store.publish(scope,"monthly",1,monthly,[insight],new Set([actionId]))).toThrow("KEY_POINT_STALE_EVIDENCE");
    expect(store.latest(scope)).toEqual(first);
  } finally {db.close();}
});

it("isolates projects and retains the last good publication on stale or conflicting writes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new KeyPointStore(db), scope = {workspaceId:"w",projectId:"p"};
    const empty = {dataEndExclusive:"2026-09-13",active:[],featuredActionIds:[]};
    const first = store.publish(scope,"report-1",0,empty,[],new Set());
    expect(store.publish(scope,"report-1",0,empty,[],new Set())).toEqual(first);
    expect(store.latest({...scope,projectId:"other"})).toBeNull();
    expect(store.latest({...scope,workspaceId:"other"})).toBeNull();
    expect(() => store.publish(scope,"report-2",0,empty,[],new Set())).toThrow("CONFLICT");
    expect(() => store.publish(scope,"report-2",1,{...empty,dataEndExclusive:"2026-09-12"},[],new Set())).toThrow("STALE_DATA");
    expect(store.latest(scope)).toEqual(first);
    const second = store.publish(scope,"report-2",1,{...empty,dataEndExclusive:"2026-09-14"},[],new Set());
    expect(second.revision).toBe(2);
    expect(store.latest(scope)).toEqual(second);
    expect(db.prepare("SELECT COUNT(*) AS total FROM energyiq_key_point_publications").get()?.total).toBe(2);
  } finally { db.close(); }
});

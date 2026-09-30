import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionStore } from "./action-store.js";
import { ActionEstimates, actionEstimateResultSchema, estimatePeriod } from "./action-estimates.js";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const scope = {workspaceId:"w",projectId:"p",userId:"u"};
function fixture() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  const action = new ActionStore(db).create(scope, {
    sourceReportId:"report",title:"Check night operation",recommendation:"Confirm whether night operation is required",
    meterIds:["led"],baseline:{from:"2026-09-01",toExclusive:"2026-09-10",snapshotId:"s"},idempotencyKey:"a",
  });
  return {db,action,store:new ActionEstimates(db)};
}
const result = {recommendation:"Confirm the operating schedule",expectedEffect:"Potential reduction depends on required operation",evidence:["Meter records overnight demand"],assumptions:[],questions:["Is night operation required?"],quantification:{status:"not_quantified",reason:"Removable load is not established"}};
describe("Persistent AI action assessments", () => {
  it("uses completed local dates from actual coverage, excluding a partial last day",()=>{
    expect(estimatePeriod("2026-09-12T18:00:00Z","Asia/Singapore",new Date("2026-09-17"))).toEqual({from:"2026-08-16",toExclusive:"2026-09-13"});
    expect(estimatePeriod("2026-09-12T16:00:00Z","Asia/Singapore",new Date("2026-09-17"))).toEqual({from:"2026-08-16",toExclusive:"2026-09-13"});
  });
  it("deduplicates opening and concurrent update requests, including across store instances", () => {
    const {db,action,store} = fixture(); const enqueue=vi.fn(()=>randomUUID());
    const first=store.start(scope,action.id,{requestId:randomUUID(),update:false},enqueue);
    const repeated=new ActionEstimates(db).start(scope,action.id,{requestId:randomUUID(),update:true},enqueue);
    expect(repeated.id).toBe(first.id); expect(enqueue).toHaveBeenCalledTimes(1);
    store.finish(scope,action.id,first.runId,{result});
    expect(store.start(scope,action.id,{requestId:randomUUID(),update:false},enqueue).id).toBe(first.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it("retains a successful prediction when a newer update fails, without changing execution", () => {
    const {db,action,store}=fixture();
    const first=store.start(scope,action.id,{requestId:randomUUID(),update:false},randomUUID);
    store.finish(scope,action.id,first.runId,{result});
    const update=store.start(scope,action.id,{requestId:randomUUID(),update:true},randomUUID);
    expect(update.version).toBe(2);
    store.finish(scope,action.id,update.runId,{error:"Model unavailable"});
    expect(store.list(scope,action.id).map(e=>e.status)).toEqual(["failed","succeeded"]);
    expect(store.start(scope,action.id,{requestId:randomUUID(),update:false},randomUUID).id).toBe(first.id);
    expect(new ActionStore(db).events(scope,action.id)).toEqual([]);
    expect(store.finish(scope,action.id,first.runId,{error:"Late failure"}).status).toBe("succeeded");
  });
  it("rolls back a failed queue reservation", () => {
    const {db,action,store}=fixture();db.exec("CREATE TABLE test_queue(id TEXT)");
    expect(()=>store.start(scope,action.id,{requestId:randomUUID(),update:false},()=>{
      db.prepare("INSERT INTO test_queue VALUES(?)").run("orphan");throw new Error("Queue failure");
    })).toThrow("Queue failure");
    expect(db.prepare("SELECT * FROM test_queue").all()).toEqual([]);
    expect(store.list(scope,action.id)).toEqual([]);
  });
  it("rejects cross-owner, workspace and project reads and writes", () => {
    const {action,store}=fixture();
    for(const other of [{...scope,userId:"other"},{...scope,projectId:"other"},{...scope,workspaceId:"other"}]) {
      expect(()=>store.list(other,action.id)).toThrow("ACTION_NOT_FOUND");
      expect(()=>store.start(other,action.id,{requestId:randomUUID(),update:false},randomUUID)).toThrow("ACTION_NOT_FOUND");
    }
  });
  it("accepts an honest unquantified assessment but rejects inverted estimates", () => {
    expect(actionEstimateResultSchema.safeParse(result).success).toBe(true);
    expect(actionEstimateResultSchema.safeParse({...result,quantification:{status:"estimated",energyKwhLow:10,energyKwhHigh:1,horizonDays:7,method:"interval comparison",calculationEvidence:"computed series"}}).success).toBe(false);
  });
  it("preserves clarification text and rejects changing it under the same request ID",()=>{
    const {action,store}=fixture();const requestId=randomUUID();
    const first=store.start(scope,action.id,{requestId,update:true,notes:"Hypothetically close at 20:00."},randomUUID);
    expect(first.notes).toBe("Hypothetically close at 20:00.");
    expect(()=>store.start(scope,action.id,{requestId,update:true,notes:"Actually closed at 20:00."},randomUUID)).toThrow("ACTION_REQUEST_CONFLICT");
    expect(()=>store.start(scope,action.id,{requestId:randomUUID(),update:true,notes:"Another change"},randomUUID)).toThrow("REPORT_ALREADY_RUNNING");
  });
});

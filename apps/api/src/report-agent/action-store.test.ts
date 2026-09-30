import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ActionStore } from "./action-store.js";
import { assessActionReadiness, estimateLighting, type ObservedDay } from "./action-analysis.js";
const dbs: DatabaseSync[] = []; afterEach(() => dbs.splice(0).forEach(db => db.close()));
const scope = { workspaceId: "w", projectId: "p", userId: "u" };
const proposal = { sourceReportId: "r", title: "Close LEDs earlier", recommendation: "Turn off at 19:00 on working days", meterIds: ["led"], baseline: { from: "2026-09-01", toExclusive: "2026-09-10", snapshotId: "s1" }, idempotencyKey: "proposal-1" };
function fixture() { const db = new DatabaseSync(":memory:"); dbs.push(db); return { db, store: new ActionStore(db) }; }
describe("Action execution records", () => {
  it("deduplicates exact delivery but rejects key reuse with a different proposal", () => {
    const { store, db } = fixture(); const action = store.create(scope, proposal);
    expect(new ActionStore(db).create(scope, proposal).id).toBe(action.id);
    expect(() => store.create(scope, { ...proposal, title: "Other" })).toThrow("CONFLICT");
    expect(store.list(scope, "r")).toHaveLength(1);
  });
  it("isolates owner, project and workspace on reads and writes", () => {
    const { store } = fixture(); const action = store.create(scope, proposal);
    for (const other of [{ ...scope, userId: "x" }, { ...scope, projectId: "x" }, { ...scope, workspaceId: "x" }]) {
      expect(() => store.get(other, action.id)).toThrow("NOT_FOUND");
      expect(store.list(other, "r")).toEqual([]);
      expect(() => store.saveScenario(other, action.id, {})).toThrow("NOT_FOUND");
    }
  });
  it("records actual execution with revision protection and append-only corrections", () => {
    const { store } = fixture(); const action = store.create(scope, proposal);
    const event = { revision: 1, requestId: "e1", type: "implemented", effectiveAt: "2026-09-12T19:00:00+08:00", details: "LED off at 19:00" };
    const updated = store.record(scope, action.id, event); expect(updated.revision).toBe(2);
    expect(store.record(scope, action.id, event).revision).toBe(2);
    expect(() => store.record(scope, action.id, { ...event, requestId: "e2" })).toThrow("REVISION_CONFLICT");
    store.record(scope, action.id, { ...event, revision: 2, requestId: "e2", type: "paused", details: "Schedule temporarily paused" });
    expect(store.events(scope, action.id)).toHaveLength(2);
    expect(store.events(scope, action.id)[0]?.details).toBe(event.details);
  });
  it("allows future plans but does not permit future actual execution", () => {
    const { store } = fixture(); const a = store.create(scope, proposal);
    const e = { revision: 1, requestId: "x", type: "implemented", effectiveAt: "2030-01-01T00:00:00Z", details: "Scheduled change" };
    expect(() => store.record(scope, a.id, e, new Date("2026-09-14"))).toThrow("FUTURE_EXECUTION");
    expect(store.record(scope, a.id, { ...e, type: "scheduled" }).state).toBe("scheduled");
  });
});
const day = (date: string, kwh: number): ObservedDay => ({ date, kwh, dayType: "workday", expectedMinutes: 12, validMinutes: 12, criticalGap: false });
const baseline = [day("2026-09-01", 3),day("2026-09-02", 3),day("2026-09-03", 3)];
const observation = [day("2026-09-07", 1),day("2026-09-08", 1),day("2026-09-09", 1)];
describe("Effect readiness and scenario arithmetic", () => {
  it("waits for complete comparable days, never treats missing intervals as zero", () => {
    expect(assessActionReadiness({ baseline, observation: observation.slice(0,2) }).ready).toBe(false);
    expect(assessActionReadiness({ baseline, observation: observation.map(d => ({ ...d, validMinutes: 11 })) }).ready).toBe(false);
    expect(assessActionReadiness({ baseline, observation: observation.map(d => ({ ...d, criticalGap: true })) }).ready).toBe(false);
    expect(assessActionReadiness({ baseline, observation: observation.map(d => ({ ...d, dayType: "holiday" })) }).ready).toBe(false);
    expect(assessActionReadiness({ baseline, observation: [observation[0]!,observation[0]!,observation[0]!] }).ready).toBe(false);
  });
  it("reports observed difference, including a negative change, without causal claims", () => {
    expect(assessActionReadiness({ baseline, observation })).toMatchObject({ ready: true, expectedKwh: 9, actualKwh: 3, observedDifferenceKwh: 6 });
    expect(assessActionReadiness({ baseline, observation: observation.map(d => ({ ...d, kwh: 4 })) })).toMatchObject({ observedDifferenceKwh: -3 });
  });
  it("calculates lighting scenario with explicit units, tax basis and missing-price handling", () => {
    const input = { reduciblePowerKw: 0.8, hoursPerDay: 3, days: 22, assumptions: "Standalone LED load, removable after closing." };
    expect(estimateLighting(input).energyKwh).toBeCloseTo(52.8);
    expect(estimateLighting(input)).not.toHaveProperty("estimatedCost");
    expect(estimateLighting({ ...input, ratePerKwh: 0.3, currency: "SGD", taxBasis: "including_tax" }).estimatedCost).toBeCloseTo(15.84);
    expect(() => estimateLighting({ ...input, ratePerKwh: 0.3 })).toThrow();
    expect(() => estimateLighting({ ...input, hoursPerDay: 25 })).toThrow();
  });
});

describe("Project action continuity", () => {
  it("links multiple report sources without changing execution state or baseline", () => {
    const {store}=fixture(); const a=store.create(scope,proposal);
    const input={reportId:"r2",recommendation:"Keep the shutdown schedule",sourceQuote:"Keep the shutdown schedule"};
    store.linkSource(scope,a.id,input); store.linkSource(scope,a.id,input);
    expect(store.sources(scope,a.id)).toHaveLength(2);
    expect(store.list(scope,"r2").map(a=>a.id)).toEqual([a.id]);
    expect(store.get(scope,a.id)).toEqual(a);
    expect(()=>store.linkSource(scope,a.id,{...input,recommendation:"Replace equipment"})).toThrow("CONFLICT");
    expect(()=>store.linkSource({...scope,userId:"other"},a.id,input)).toThrow("NOT_FOUND");
  });
  it("keeps private actions out of shared report context and freezes returned progress", () => {
    const {store}=fixture(); store.create(scope,proposal);
    const shared=store.create(scope,{...proposal,idempotencyKey:"shared",visibility:"project"});
    expect(store.listProject(scope)).toHaveLength(2);
    expect(store.reportProgress(scope).map(a=>a.id)).toEqual([shared.id]);
    expect(store.reportProgress({...scope,projectId:"other"})).toEqual([]);
    const before=JSON.stringify(store.reportProgress(scope));
    store.record(scope,shared.id,{revision:1,requestId:"event",type:"implemented",effectiveAt:"2026-09-12T19:00:00+08:00",details:"Changed timer"});
    expect(JSON.parse(before)[0].state).toBe("proposed");
    expect(store.reportProgress(scope)[0]?.events[0]?.details).toBe("Changed timer");
  });
});

it("changes priority independently of execution and protects concurrent edits",()=>{
 const {store}=fixture();const a=store.create(scope,proposal);
 const priority=store.setPriority(scope,a.id,{revision:0,level:"high",reason:"Low effort and persistent overnight load"});
 expect(priority.revision).toBe(1);expect(store.get(scope,a.id)).toEqual(a);
 expect(()=>store.setPriority(scope,a.id,{revision:0,level:"low",reason:"Old change"})).toThrow("REVISION_CONFLICT");
 expect(()=>store.setPriority({...scope,userId:"other"},a.id,{revision:1,level:"low",reason:"Other user"})).toThrow("NOT_FOUND");
});

import { createMetadataStore } from "@datafoundry/metadata";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { ConfigApiContext } from "../routes/types.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleActionApi } from "./action-api.js";
import { createActionTools } from "./action-tools.js";
import { InsightStore } from "./insight-store.js";
import { KeyPointStore } from "./key-point-store.js";
import { ActionStore } from "./action-store.js";
import { ReportStore, type ReportSettings } from "./report-store.js";
import { registerReportService, type ReportService } from "./report-service.js";
vi.mock("./report-project-data.js",()=>({readReportProjectData:vi.fn(async()=>({status:"connected",actualLastIntervalEnd:"2026-09-12T18:00:00Z"}))}));
let metadata: ReturnType<typeof createMetadataStore>;
let root: string;
let actions: ActionStore;
let id: string;
it("returns the published annual scenario for an authorized action without leaking private actions",async()=>{
 const scope={workspaceId:"w",projectId:"p"};
 const insightId=crypto.randomUUID();
 const scenario={referenceYear:2027,energyKwh:{low:100,high:100},condition:"the hours are approved",method:"Measured comparable windows",assumptions:["Same equipment"],calculationFile:"annual.py",resultFile:"annual.json"};
 const point={insightId,actionId:id,insightVersion:"a".repeat(64),issue:"Evening load",evidence:"Complete windows",evidenceFrom:"2026-09-01",evidenceToExclusive:"2026-09-10",nextStep:"Check schedule",benefit:"Could save 100 kWh/year if approved",assumptions:"Confirm use",reason:"Avoidable hours",annualBenefit:scenario};
 const report=new ReportStore(metadata.db).list("p")[0]!;
 new KeyPointStore(metadata.db).publish(scope,report.id,0,{dataEndExclusive:"2026-09-10",active:[point],featuredActionIds:[id]},[{id:insightId,version:"a".repeat(64),actionIds:[id],review:{status:"open"}}],new Set([id]));
 const response=await call("admin",["p",id,"estimates"],{},"GET");
 expect(response.status).toBe(200);
 expect(response.body).toMatchObject({data:{publishedBenefit:{reportId:report.id,scenario}}});
 expect((await call("admin2",["p",id,"estimates"],{},"GET")).status).toBe(404);
});
it("links a shared action through the Agent API with verified evidence and preserves execution",async()=>{
 const scope={workspaceId:"w",projectId:"p",userId:"admin"};
 const old=actions.get(scope,id);
 const shared=actions.create(scope,{sourceReportId:old.sourceReportId,title:"Review hours",recommendation:"Check overnight schedule",meterIds:["led"],baseline:old.baseline,idempotencyKey:"link-test",visibility:"project"});
 registerReportService(metadata,{store:new ReportStore(metadata.db),output:()=>"<html><body>Night consumption persists outside operating hours.</body></html>"} as unknown as ReportService);
 const tools=createActionTools({metadata,run:{actorUserId:"admin",workspaceId:"w",projectId:"p"}});
 const body={actionId:shared.id,title:"Night demand",summary:"Night consumption persists outside operating hours.",sourceQuote:"Night consumption persists outside operating hours."};
 expect(await tools.executeTool("insight_link_action",{...body,sourceQuote:"This quotation does not appear anywhere."})).toMatchObject({ok:false});
 expect(new InsightStore(metadata.db).list(scope)).toHaveLength(0);
 expect(await tools.executeTool("insight_link_action",body)).toMatchObject({ok:true});
 expect(await tools.executeTool("insight_link_action",body)).toMatchObject({ok:true});
 expect(new InsightStore(metadata.db).list(scope)).toHaveLength(1);
 expect(actions.get(scope,shared.id)).toEqual(shared);
 expect(actions.events(scope,shared.id)).toEqual([]);
 vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED","true");
 expect((await call("viewer",["p","insights"],body)).status).toBe(403);
 const finding=new InsightStore(metadata.db).list(scope)[0]!;
 const review={revision:0,status:"monitoring",importance:"high",urgency:"soon",reason:"Waiting for comparable post-action measurements"};
 expect((await call("viewer",["p","insights",finding.id,"review"],review)).status).toBe(403);
 expect(await tools.executeTool("insight_review",{insightId:finding.id,review})).toMatchObject({ok:true});
 expect(await tools.executeTool("insight_review",{insightId:finding.id,review})).toMatchObject({ok:false,status:409});
 expect(new InsightStore(metadata.db).list(scope)[0]?.review.status).toBe("monitoring");
 expect(actions.get(scope,shared.id)).toEqual(shared);
 const second=new InsightStore(metadata.db).attach(scope,"other",["led"],old.sourceReportId,{title:"Other finding",summary:"A different observation about this load",sourceQuote:body.sourceQuote});
 expect(await tools.executeTool("insight_link_action",{...body,existingInsightId:second.id})).toMatchObject({ok:false,status:409});
 const mergeRows=new InsightStore(metadata.db).list(scope);
 const mergeInput={sourceId:second.id,targetId:finding.id,sourceVersion:mergeRows.find(i=>i.id===second.id)!.version,targetVersion:mergeRows.find(i=>i.id===finding.id)!.version,reason:"Confirmed duplicate issue after comparing evidence",requestId:crypto.randomUUID()};
 expect((await call("viewer",["p","insights","merge"],mergeInput)).status).toBe(403);
 expect(await tools.executeTool("insight_merge",mergeInput)).toMatchObject({ok:true});
 const grouped=new InsightStore(metadata.db).list(scope)[0]!;
 expect(grouped.mergeId).toBeTruthy(); expect(new InsightStore(metadata.db).list(scope)).toHaveLength(1);
 expect((await call("viewer",["p","insight-merges",grouped.mergeId!,"undo"],{reason:"Separate for further investigation"})).status).toBe(403);
 expect(await tools.executeTool("insight_undo_merge",{mergeId:grouped.mergeId,reason:"Separate for further investigation"})).toMatchObject({ok:true});
 expect(new InsightStore(metadata.db).list(scope)).toHaveLength(2);
 expect(actions.get(scope,shared.id)).toEqual(shared);

});
const settings: ReportSettings = {
  projectId: "p",
  workspaceId: "w",
  actorUserId: "admin",
  timezone: "Asia/Singapore",
  contextNotes: "",
  fileRefIds: [],
  useProjectData: true,
  skill: "",
  revision: 0,
  frequency: "off",
  localHour: 3,
  scheduledPrompt: "",
};
it("starts a persistent AI assessment once and reconciles a failed run for retry", async()=>{
  const reports=new ReportStore(metadata.db);reports.saveSettings(settings);
  registerReportService(metadata,{store:reports,tick:vi.fn(async()=>{})} as unknown as ReportService);
  const payload={requestId:crypto.randomUUID(),update:false};
  expect((await call("admin",["p",id,"estimates"],payload)).status).toBe(200);
  expect((await call("admin",["p",id,"estimates"],{...payload,requestId:crypto.randomUUID()})).status).toBe(200);
  const estimates=reports.list("p").filter(r=>r.actionEstimate);
  expect(estimates).toHaveLength(1);
  expect(estimates[0]?.actionEstimate?.actionId).toBe(id);
  expect(estimates[0]?.settings.fileRefIds).toEqual([]);
  expect(estimates[0]?.period.toExclusive).toBe("2026-09-13");
  expect(reports.sessions("p","admin").some(s=>s.id===estimates[0]?.sessionId)).toBe(false);
  reports.claim();
  reports.finish({...estimates[0]!,status:"failed",errorCode:"REPORT_GENERATION_FAILED"});
  expect((await call("admin",["p",id,"estimates"],{requestId:crypto.randomUUID(),update:false})).status).toBe(200);
  expect(reports.list("p").filter(r=>r.actionEstimate)).toHaveLength(2);
  expect((await call("admin2",["p",id,"estimates"],{},"GET")).status).toBe(404);
});
beforeEach(() => {
  vi.stubEnv("ENERGYIQ_ACTIONS_PILOT_ENABLED", "true");
  root = mkdtempSync(join(tmpdir(), "action-api-"));
  metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  for (const u of ["admin", "admin2", "viewer"])
    metadata.users.createPasswordUser({ id: u, email: `${u}@test.invalid` });
  for (const u of ["admin", "admin2"])
    metadata.energyIq.upsertUserRole({ user_id: u, role: "admin" });
  metadata.workspaces.upsert({
    id: "w",
    name: "Customer",
    kind: "customer",
    owner_user_id: "admin",
  });
  metadata.workspaceMemberships.upsert({
    workspace_id: "w",
    user_id: "viewer",
    role: "member",
  });
  metadata.energyIq.upsertProject({
    id: "p",
    workspace_id: "w",
    name: "Project",
    status: "published",
    timezone: "Asia/Singapore",
  });
  const reports = new ReportStore(metadata.db);
  const run = reports.enqueue({
    settings,
    period: { from: "2026-09-01", toExclusive: "2026-09-10" },
    actorUserId: "admin",
    prompt: "Report",
  });
  reports.claim();
  reports.finish({ ...run, status: "succeeded" });
  registerReportService(metadata, {
    store: reports,
    wakeActionChecks: vi.fn(),
    tick: vi.fn(),
    reportDataSnapshotId: vi.fn(() => "report-snapshot"),
  } as unknown as ReportService);
  actions = new ActionStore(metadata.db);
  id = actions.create(
    { workspaceId: "w", projectId: "p", userId: "admin" },
    {
      sourceReportId: run.id,
      title: "LED",
      recommendation: "Close earlier",
      meterIds: ["led"],
      baseline: {
        from: "2026-09-01",
        toExclusive: "2026-09-10",
        snapshotId: "s",
      },
      idempotencyKey: "a",
    },
  ).id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  metadata.close();
  rmSync(root, { recursive: true, force: true });
});
it("publishes an empty shortlist without invented points and restricts publication to admins", async () => {
  vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED", "true");
  const reports = new ReportStore(metadata.db);
  const report = reports.list("p")[0]!;
  reports.finish({...report,status:"succeeded",hasReport:true});
  const payload = {reportId:report.id,expectedRevision:0,selection:{dataEndExclusive:"2026-09-10",active:[],featuredActionIds:[]}};
  expect((await call("viewer",["p","key-points"],payload)).status).toBe(403);
  expect((await call("admin",["p","key-points"],payload)).status).toBe(200);
  expect((await call("admin",["p","key-points"],payload)).status).toBe(200);
  const overview = await call("viewer",["p","key-points"],{},"GET");
  expect(overview.status).toBe(200);
  // The Overview names the report it comes from, so readers know its dates and whether newer readings exist.
  expect((overview.body as { data: { source: unknown } }).data.source).toMatchObject({ reportId: report.id, category: "custom", version: 1, period: { from: "2026-09-01", toExclusive: "2026-09-10" }, newerDataAvailable: false });
});
async function call(
  userId: string,
  path: string[],
  body: unknown,
  method = "POST",
) {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.method = method;
  request.url = "/";
  return handleActionApi(request, path, {
    metadataStore: metadata,
    userId,
    workspaceId: "w",
  } as Required<ConfigApiContext>);
}
it("does not grant Action writes merely because a user can read project reports", async () => {
  expect((await call("viewer", ["p", id, "events"], {})).status).toBe(403);
  expect(
    actions.events({ workspaceId: "w", projectId: "p", userId: "admin" }, id),
  ).toEqual([]);
});
it("does not convert an explicit project editor grant into private Action access", async () => {
  metadata.energyIq.upsertProjectAccess({
    project_id: "p",
    user_id: "viewer",
    role: "editor",
  });
  expect((await call("viewer", ["p", id], {}, "GET")).status).toBe(403);
  expect((await call("viewer", ["p", id, "events"], {})).status).toBe(403);
  expect(
    actions.events({ workspaceId: "w", projectId: "p", userId: "admin" }, id),
  ).toEqual([]);
});
it("denies another admin's private action and wrong project ID", async () => {
  expect((await call("admin2", ["p", id], {}, "GET")).status).toBe(404);
  expect((await call("admin", ["foreign", id], {}, "GET")).status).toBe(404);
});
it("keeps demo tools admin-only and denies cross-owner action access", async () => {
 vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED", "true");
 for(const suffix of ["demonstrations", "demonstrations/example"]){
  expect((await call("admin2",["p",id,...suffix.split("/")],{},"GET")).status).toBe(404);
  expect((await call("viewer",["p",id,...suffix.split("/")],{},"GET")).status).not.toBe(200);
 }
 expect((await call("admin",["p",id,"demonstrations"],{},"GET")).status).toBe(200);
 expect((await call("admin",["p",id,"demonstrations","foreign"],{},"GET")).status).toBe(404);
 expect((await call("viewer",["p","insights"],{},"POST")).status).toBe(403);
 expect((await call("admin",["p","insights"],{actionId:id,title:"Private",summary:"A private action observation",sourceQuote:"A private action observation"},"POST")).status).toBe(403);
});
it("records execution through HTTP handler and reports stale version conflicts", async () => {
  const body = {
    revision: 1,
    requestId: "event",
    type: "implemented",
    effectiveAt: "2026-09-12T19:00:00+08:00",
    details: "LED shutdown moved earlier",
  };
  expect((await call("admin", ["p", id, "events"], body)).status).toBe(200);
  expect(
    (await call("admin", ["p", id, "events"], { ...body, requestId: "other" }))
      .status,
  ).toBe(409);
  expect(
    actions.events({ workspaceId: "w", projectId: "p", userId: "admin" }, id),
  ).toHaveLength(1);
});
it("saves a scenario without changing actual execution or claiming measured savings", async () => {
  const r = await call("admin", ["p", id, "scenarios"], {
    reduciblePowerKw: 0.8,
    hoursPerDay: 3,
    days: 22,
    assumptions: "Independently removable LED load.",
  });
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).toContain("user_supplied_assumptions");
  expect(
    actions.get({ workspaceId: "w", projectId: "p", userId: "admin" }, id)
      .state,
  ).toBe("proposed");
});

it("shares chat progress with the UI and preserves revision conflicts and retry idempotency", async () => {
  const tools = createActionTools({ metadata, run: { actorUserId: "admin", workspaceId: "w", projectId: "p" } });
  const event = { revision: 1, requestId: "chat-record", type: "scheduled", effectiveAt: "2026-10-01T19:00:00+08:00", details: "Plan to close the display earlier" };
  expect(await tools.executeTool("action_record_progress", { actionId: id, event })).toMatchObject({ ok: true });
  expect(await tools.executeTool("action_record_progress", { actionId: id, event })).toMatchObject({ ok: true });
  expect(await tools.executeTool("action_record_progress", { actionId: id, event: { ...event, requestId: "another" } })).toMatchObject({ ok: false, status: 409 });
  const fromUi = await call("admin", ["p", id], {}, "GET");
  expect(JSON.stringify(fromUi.body)).toContain("Plan to close the display earlier");
  expect(actions.events({ workspaceId: "w", projectId: "p", userId: "admin" }, id)).toHaveLength(1);
});

it("binds tools to the caller, rejects scope injection and rechecks access on each call", async () => {
  const tools = createActionTools({ metadata, run: { actorUserId: "admin", workspaceId: "w", projectId: "p" } });
  expect(await tools.executeTool("action_read", { actionId: id, userId: "admin2" })).toMatchObject({ ok: false, code: "ACTION_INPUT_INVALID" });
  const other = createActionTools({ metadata, run: { actorUserId: "admin2", workspaceId: "w", projectId: "p" } });
  expect(await other.executeTool("action_read", { actionId: id })).toMatchObject({ ok: false, status: 404 });
  vi.stubEnv("ENERGYIQ_ACTIONS_PILOT_ENABLED", "false");
  expect(await tools.executeTool("action_read", { actionId: id })).toMatchObject({ ok: false, status: 404 });
});

it("keeps an Agent estimate separate from actual execution", async () => {
  const tools = createActionTools({ metadata, run: { actorUserId: "admin", workspaceId: "w", projectId: "p" } });
  const result = await tools.executeTool("action_estimate", { actionId: id, scenario: { reduciblePowerKw: 0.1, hoursPerDay: 2, days: 3, assumptions: "Hypothetical independently removable load" } });
  expect(result).toMatchObject({ ok: true });
  expect(JSON.stringify(result)).toContain("not measured savings");
  expect(actions.get({ workspaceId: "w", projectId: "p", userId: "admin" }, id).state).toBe("proposed");
  const check = await tools.executeTool("action_check_effect", { actionId: id });
  expect(check).toMatchObject({ ok: true, result: { data: { check: null, status: "not_implemented" } } });
  expect(actions.feedback({ workspaceId: "w", projectId: "p", userId: "admin" }, id)).toEqual([]);
});
it("links a saved scenario before execution, deduplicates adoption, and locks it afterwards", async () => {
  const scope = { workspaceId: "w", projectId: "p", userId: "admin" };
  await call("admin", ["p", id, "scenarios"], {
    reduciblePowerKw: 0.8,
    hoursPerDay: 3,
    days: 22,
    assumptions: "Same reduction every calendar day.",
  });
  const scenario = actions.scenarios(scope, id)[0]!;
  const body = { revision: 1, requestId: "adopt", scenarioId: scenario.id };
  expect(
    (await call("admin", ["p", id, "scenario-adoption"], body)).status,
  ).toBe(200);
  expect(
    (await call("admin", ["p", id, "scenario-adoption"], body)).status,
  ).toBe(200);
  expect(actions.get(scope, id)).toMatchObject({
    revision: 2,
    state: "proposed",
    adoptedScenarioId: scenario.id,
  });
  expect(actions.events(scope, id)).toEqual([]);
  await call("admin", ["p", id, "events"], {
    revision: 2,
    requestId: "execute",
    type: "implemented",
    effectiveAt: "2026-09-12T19:00:00+08:00",
    details: "Implemented the recorded plan",
  });
  expect(
    (
      await call("admin", ["p", id, "scenario-adoption"], {
        ...body,
        revision: 3,
        requestId: "replace",
      })
    ).status,
  ).toBe(409);
});
it("queues recommendation extraction once and preserves its identity through explicit retry", async () => {
  const reports = new ReportStore(metadata.db);
  const source = actions.get(
    { workspaceId: "w", projectId: "p", userId: "admin" },
    id,
  ).sourceReportId;
  const tick = vi.fn();
  registerReportService(metadata, {
    store: reports,
    tick,
    actionSuggestions: () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  } as unknown as ReportService);
  expect(
    (await call("admin2", ["p", "suggestions"], { sourceReportId: source }))
      .status,
  ).toBe(403);
  expect(
    (await call("admin", ["p", "suggestions"], { sourceReportId: source }))
      .status,
  ).toBe(200);
  const first = actions.extraction(source)!;
  expect(
    (await call("admin", ["p", "suggestions"], { sourceReportId: source }))
      .status,
  ).toBe(200);
  expect(actions.extraction(source)).toBe(first);
  expect(reports.get("p", first)).toMatchObject({
    kind: "chat",
    parentRunId: source,
    actionExtraction: { sourceReportId: source },
  });
  reports.cancel("p", first);
  expect(() => reports.resume("p", first, "admin")).toThrow(
    "REPORT_ACTION_RETRY_REQUIRED",
  );
  await call("admin", ["p", "suggestions"], { sourceReportId: source });
  expect(actions.extraction(source)).not.toBe(first);
  expect(tick).toHaveBeenCalledTimes(2);
});

it("keeps the incomplete pilot disabled unless explicitly enabled", async () => {
  vi.stubEnv("ENERGYIQ_ACTIONS_PILOT_ENABLED", "false");
  expect((await call("admin", ["p", id], {}, "GET")).status).toBe(404);
});

it("lets members record explicitly shared actions while keeping private actions and project boundaries intact", async () => {
  vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED", "true");
  const owner = { workspaceId: "w", projectId: "p", userId: "admin" };
  const a = actions.get(owner, id);
  const shared = actions.create(owner, {
    sourceReportId: a.sourceReportId,
    title: "Team action",
    recommendation: "Switch off",
    meterIds: ["led"],
    baseline: a.baseline,
    idempotencyKey: "shared",
    visibility: "project",
  });
  expect((await call("viewer", ["p", id], {}, "GET")).status).toBe(404);
  expect((await call("viewer", ["p", shared.id], {}, "GET")).status).toBe(200);
  expect(
    (
      await call("viewer", ["p", shared.id, "events"], {
        revision: 1,
        requestId: "member-record",
        type: "implemented",
        effectiveAt: "2026-09-12T19:00:00+08:00",
        details: "Done by project member",
      })
    ).status,
  ).toBe(200);
  expect(actions.events(owner, shared.id)[0]?.actorUserId).toBe("viewer");
  expect(
    (
      await call("viewer", ["p"], {
        sourceReportId: a.sourceReportId,
        title: "Illegal sharing",
        recommendation: "Switch off",
        meterIds: ["led"],
        baseline: a.baseline,
        idempotencyKey: "illegal",
        visibility: "project",
      })
    ).status,
  ).toBe(403);
  expect(
    (await call("viewer", ["another-project", shared.id], {}, "GET")).status,
  ).toBe(404);
  const privateMember = actions.create(
    { ...owner, userId: "viewer" },
    {
      sourceReportId: a.sourceReportId,
      title: "Personal action",
      recommendation: "Switch off",
      meterIds: ["led"],
      baseline: a.baseline,
      idempotencyKey: "personal",
    },
  );
  expect(
    (await call("viewer", ["p", privateMember.id], {}, "GET")).status,
  ).toBe(200);
  expect((await call("admin", ["p", privateMember.id], {}, "GET")).status).toBe(
    404,
  );
});

it("exposes a scoped project list and links verified report suggestions without resetting progress", async () => {
  const scope = { workspaceId: "w", projectId: "p", userId: "admin" };
  const action = actions.get(scope, id);
  const reports = new ReportStore(metadata.db);
  const second = reports.enqueue({
    settings,
    period: { from: "2026-09-10", toExclusive: "2026-09-14" },
    actorUserId: "admin",
    prompt: "Next report",
  });
  reports.claim();
  reports.finish({ ...second, status: "succeeded" });
  const suggestion = {
    id: "a".repeat(24),
    title: "Earlier shutdown",
    recommendation: "Close earlier",
    meterId: "led",
    sourceQuote: "Close the LED earlier after working hours",
  };
  registerReportService(metadata, {
    store: reports,
    actionSuggestions: () => [suggestion],
  } as unknown as ReportService);
  expect((await call("admin", ["p", "project-list"], {}, "GET")).status).toBe(
    200,
  );
  expect(
    (
      await call("admin2", ["p", id, "sources"], {
        sourceReportId: second.id,
        suggestionId: suggestion.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call("admin", ["p", id, "sources"], {
        sourceReportId: second.id,
        suggestionId: "b".repeat(24),
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("admin", ["p", id, "sources"], {
        sourceReportId: second.id,
        suggestionId: suggestion.id,
      })
    ).status,
  ).toBe(200);
  expect(actions.sources(scope, id)).toHaveLength(2);
  expect(actions.get(scope, id)).toEqual(action);
});

it("protects shared priorities and keeps execution revision unchanged", async () => {
  const scope = { workspaceId: "w", projectId: "p", userId: "admin" };
  const before = actions.get(scope, id);
  expect(
    (
      await call("admin", ["p", id, "priority"], {
        revision: 0,
        level: "high",
        reason: "Persistent overnight load",
      })
    ).status,
  ).toBe(200);
  expect(actions.get(scope, id)).toEqual(before);
  expect(
    (
      await call("admin", ["p", id, "priority"], {
        revision: 0,
        level: "low",
        reason: "Stale",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call("admin2", ["p", id, "priority"], {
        revision: 1,
        level: "low",
        reason: "Private",
      })
    ).status,
  ).toBe(404);
});

it("shows unresolved registered recommendations only to admins and removes them after linking", async () => {
  const scope = { workspaceId: "w", projectId: "p", userId: "admin" };
  const original = actions.get(scope, id);
  const shared = actions.create(scope, {
    sourceReportId: original.sourceReportId,
    title: "LED routine",
    recommendation: "Close earlier",
    meterIds: ["led"],
    baseline: original.baseline,
    idempotencyKey: "team-review",
    visibility: "project",
  });
  const reports = new ReportStore(metadata.db);
  const run = reports.enqueue({
    settings,
    period: { from: "2026-09-10", toExclusive: "2026-09-14" },
    actorUserId: "admin",
    prompt: "Next",
  });
  reports.claim();
  reports.finish({ ...run, status: "succeeded" });
  const suggestion = {
    id: "d".repeat(24),
    title: "Routine",
    recommendation: "Earlier lights off",
    meterId: "led",
    sourceQuote: "Earlier lights off after closing",
  };
  registerReportService(metadata, {
    store: reports,
    actionSuggestions: () => [suggestion],
  } as unknown as ReportService);
  expect(
    JSON.stringify(
      (await call("admin", ["p", "project-list"], {}, "GET")).body,
    ),
  ).toContain('"reviewReports":[]');
  reports.event(run.id, { type: "project_actions_registered" });
  const pending = await call("admin", ["p", "project-list"], {}, "GET");
  expect(JSON.stringify(pending.body)).toContain('"count":1');
  vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED", "true");
  expect(
    JSON.stringify(
      (await call("viewer", ["p", "project-list"], {}, "GET")).body,
    ),
  ).toContain('"reviewReports":[]');
  expect(
    (
      await call("admin", ["p", shared.id, "sources"], {
        sourceReportId: run.id,
        suggestionId: suggestion.id,
      })
    ).status,
  ).toBe(200);
  expect(
    JSON.stringify(
      (await call("admin", ["p", "project-list"], {}, "GET")).body,
    ),
  ).toContain('"reviewReports":[]');
  expect(actions.get(scope, shared.id).revision).toBe(1);
});

it("keeps AI progress drafts private and does not record before confirmation",async()=>{
 const request={requestId:crypto.randomUUID(),text:"Please review what I changed yesterday."};
 // This fixture has no saved report settings: no half-created task or execution.
 const r=await call("admin",["p",id,"progress-drafts"],request);
 expect(r.status).toBe(409);
 expect(actions.events({workspaceId:"w",projectId:"p",userId:"admin"},id)).toHaveLength(0);
 expect((await call("viewer",["p",id,"progress-drafts"],{},"GET")).status).not.toBe(200);
});


it("saves site answers idempotently without changing execution, and shares them with Agent tools",async()=>{
 const scope={workspaceId:"w",projectId:"p",userId:"admin"};const before=actions.get(scope,id);
 const note={requestId:crypto.randomUUID(),question:"Is this needed overnight?",answer:"I do not know yet. Please ask the site manager."};
 expect((await call("admin",["p",id,"site-notes"],note)).status).toBe(200);
 expect((await call("admin",["p",id,"site-notes"],note)).status).toBe(200);
 expect(actions.siteNotes(scope,id)).toHaveLength(1);
 expect(actions.get(scope,id)).toEqual(before);expect(actions.events(scope,id)).toEqual([]);
 expect((await call("admin",["p",id,"site-notes"],{...note,answer:"Different"})).status).toBe(409);
 expect((await call("admin2",["p",id,"site-notes"],note)).status).toBe(404);
 const tools=createActionTools({metadata,run:{actorUserId:"admin",workspaceId:"w",projectId:"p"}});
 expect(await tools.executeTool("action_record_site_note",{actionId:id,note})).toMatchObject({ok:true});
 expect(await tools.executeTool("action_read",{actionId:id})).toMatchObject({ok:true});
 const reports=new ReportStore(metadata.db);reports.saveSettings(settings);
 expect((await call("admin",["p",id,"estimates"],{requestId:crypto.randomUUID(),update:false})).status).toBe(200);
 expect(reports.list("p").find(r=>r.actionEstimate)?.actionEstimate?.clarifications?.join(" ")).toContain(note.answer);
});

it("allows enabled project members to contribute shared site notes, never private notes",async()=>{
 vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED","true");
 const scope={workspaceId:"w",projectId:"p",userId:"admin"};const old=actions.get(scope,id);
 const shared=actions.create(scope,{sourceReportId:old.sourceReportId,title:"Review hours",recommendation:"Confirm operating hours",meterIds:["led"],baseline:old.baseline,idempotencyKey:"shared-note-test",visibility:"project"});
 const note={requestId:crypto.randomUUID(),question:"Are weekend hours required?",answer:"The site team has not confirmed this."};
 expect((await call("viewer",["p",shared.id,"site-notes"],note)).status).toBe(200);
 expect(actions.reportProgress(scope).find(a=>a.id===shared.id)?.siteNotes[0]?.answer).toBe(note.answer);
 expect((await call("viewer",["p",id,"site-notes"],note)).status).toBe(404);
 expect(actions.get(scope,shared.id).state).toBe("proposed");
});

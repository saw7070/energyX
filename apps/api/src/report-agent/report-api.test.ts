import { reportSkillCatalog, resolveReportSkillSelection } from "./report-skill-catalog.js";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { presetReportPeriod } from "./report-periods.js";
import { handleReportApi } from "./report-api.js";
import { ReportService, registerReportService } from "./report-service.js";
import type { ConfigApiContext } from "../routes/types.js";
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("./report-access.js", () => ({ authorizeReportConversation: authorize, authorizeReportExecution: authorize }));
vi.mock("./report-inputs.js", () => ({ authorizeReportProject: authorize, prepareReportInputs: vi.fn(), copyReportParent: vi.fn() }));
const roots: string[] = []; const databases: DatabaseSync[] = [];
afterEach(() => { authorize.mockReset(); for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("pins project style separately from analysis, freezes runs and rejects a different project's style", async () => {
  const { call, service, settings, context } = setup();
  const body = { name: "Office visual identity", version: "1", scope: "project", category: "presentation", content: "Navy headings and orange emphasis" };
  const created = (await call("POST", ["skills"], body)).body as any;
  const first = created.data;
  expect(first.category).toBe("presentation");
  expect((await call("POST", ["skills", "default"], { id: first.id, version: "1", revision: settings.revision })).status).toBe(200);
  const bound = service.store.settings("p")!;
  expect(bound.skill).toBe(settings.skill);
  expect(bound.styleSkill?.version).toBe("1");
  await call("POST", ["runs"], { kind: "chat", prompt: "Create report", skillSelection: { mode: "selected", refs: [] } });
  const run = service.store.list("p")[0]!;
  expect(run.settings.styleSkill?.content).toBe(first.content);
  expect(run.settings.skillUsage).toContainEqual(expect.objectContaining({ id: first.id, version: "1", inputPath: "project-style.md" }));
  const updated = (await call("POST", ["skills"], { ...body, id: first.id, revision: first.revision, version: "2", content: "Blue headings" })).body as any;
  expect(updated.data.version).toBe("2");
  expect(service.store.settings("p")!.styleSkill?.version).toBe("1");
  expect((await call("POST", ["skills", "default"], { id: first.id, version: "2", revision: bound.revision })).status).toBe(200);
  expect(service.store.get("p", run.id).settings.styleSkill?.version).toBe("1");
  const method = (await call("POST", ["skills"], { name: "Better investigation", version: "1", scope: "project", content: "Compare night load" })).body as any;
  await call("POST", ["skills", "default"], { id: method.data.id, version: "1", revision: service.store.settings("p")!.revision });
  expect(service.store.settings("p")!.styleSkill?.version).toBe("2");
  context.metadataStore.energyIq.upsertProject({ id: "preschool", workspace_id: "w", name: "Preschool", status: "draft", timezone: "Asia/Singapore" });
  const other = service.store.saveSettings({ ...settings, projectId: "preschool", revision: 0, skill: "School analysis" });
  const req = Readable.from([JSON.stringify({ id: first.id, version: "2", revision: other.revision })]) as IncomingMessage; req.method = "POST";
  expect((await handleReportApi(req, ["preschool", "skills", "default"], context)).status).toBe(403);
  expect(service.store.settings("preschool")).toEqual(other);
});
function setup() {
  authorize.mockReturnValue({canManageProject:true,canChat:true,capabilities:{publishConfiguration:true}});
  const root = mkdtempSync(join(tmpdir(), "report-api-test-")); roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  const db = metadata.db; databases.push(db);
  for (const id of ["u", "other"]) metadata.users.upsertDevUser({ id, email: `${id}@example.test`, display_name: id, dev_token: id });
  metadata.workspaces.upsert({ id: "w", owner_user_id: "u", name: "Test", kind: "customer" });
  metadata.energyIq.upsertProject({ id: "p", workspace_id: "w", name: "Project", status: "draft", timezone: "Asia/Singapore" });
  const context = { metadataStore: metadata, workspaceId: "w", userId: "u", fileAssetService: { listRefs: () => [], createRef: () => ({ ref: { id: "saved-package" } }) } } as unknown as Required<ConfigApiContext>;
  const service = new ReportService({ metadata: context.metadataStore, root, files: context.fileAssetService, harness: async () => ({ answer: "" }) });
  registerReportService(context.metadataStore, service);
  const settings = service.store.saveSettings({ projectId: "p", workspaceId: "w", actorUserId: "u", timezone: "Asia/Singapore", contextNotes: "", fileRefIds: [], useProjectData: false, skill: "method", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "" });
  const call = async (method: string, parts: string[], body?: unknown, userId = "u") => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []) as IncomingMessage; req.method = method; req.url = "/";
    return handleReportApi(req, ["p", ...parts], { ...context, userId });
  };
  return { service, settings, call, context };
}
it("preserves old create shape, lists own Sessions, and blocks other users' events/stop/resume", async () => {
  const { service, call } = setup();
  expect((await call("POST", ["runs"], { prompt: "Create report", period: { from: "2026-08-01", toExclusive: "2026-09-01" } })).status).toBe(202);
  const run = service.store.list("p")[0]!;
  expect(run.sessionId).toBeTruthy();
  for (const [method, action] of [["GET", "events"], ["POST", "stop"], ["POST", "resume"]]) expect((await call(method!, ["runs", run.id, action!], undefined, "other")).status).toBe(403);
  expect((await call("POST", ["runs", run.id, "stop"])).status).toBe(200);
  expect((await call("POST", ["runs", run.id, "resume"])).status).toBe(202);
  const own = await call("GET", []); const other = await call("GET", [], undefined, "other");
  expect(JSON.stringify(own.body)).toContain(run.sessionId!);
  expect(JSON.stringify(other.body)).not.toContain(run.sessionId!);
});
it("checks project authorization before reading outputs or any state", async () => {
  const { call } = setup(); authorize.mockImplementation(() => { throw new Error("REPORT_PROJECT_FORBIDDEN"); });
  expect((await call("GET", [])).status).toBe(403);
  expect((await call("GET", ["output", "missing"])).status).toBe(403);
});
it("rejects a saved Skill with unavailable runtime references", async () => {
  const { settings, call } = setup();
  const { projectId, workspaceId, actorUserId, timezone, ...body } = settings;
  expect((await call("PUT", ["settings"], { ...body, skill: "Read scripts/missing.py" })).status).toBe(400);
  expect((await call("PUT", ["settings"], { ...body, skillRefs: [{ name: "broken", version: "1", content: "Read references/missing.md" }] })).status).toBe(400);
});

it("accepts chat without a period, inherits its Session period, and uses presets for fresh report requests", async () => {
  const { service, settings, call } = setup();
  const first = await call("POST", ["runs"], { kind: "chat", prompt: "What should we investigate?" });
  expect(first.status).toBe(202);
  const firstRun = service.store.list("p")[0]!;
  expect(firstRun.kind).toBe("chat");
  expect(firstRun.period).toEqual(presetReportPeriod("recent"));
  service.store.claim(); service.store.finish({ ...firstRun, status: "succeeded", answer: "Discuss the project." });
  const explicit = { from: "2026-06-01", toExclusive: "2026-06-08" };
  const second = service.store.enqueue({ settings, actorUserId: "u", period: explicit, kind: "chat", prompt: "June data", sessionId: firstRun.sessionId! });
  service.store.claim(); service.store.finish({ ...second, status: "succeeded" });
  expect((await call("POST", ["runs"], { kind: "chat", prompt: "Continue", sessionId: firstRun.sessionId })).status).toBe(202);
  expect(service.store.list("p")[0]!.period).toEqual(explicit);
  expect((await call("POST", ["runs"], { kind: "chat", prompt: "Steal", sessionId: firstRun.sessionId }, "other")).status).toBe(403);
  expect((await call("POST", ["runs"], { kind: "report", prompt: "Generate" })).status).toBe(202);
  expect((await call("POST", ["runs"], { kind: "report", prompt: "Custom", periodPreset: "custom" })).status).toBe(400);
});

it("preserves Skill applicability labels and defaults without broadening project binding", async () => {
  const { settings, service, call } = setup();
  const { projectId, workspaceId, actorUserId, timezone, ...body } = settings;
  const response = await call("PUT", ["settings"], { ...body, skillRefs: [
    { name: "Investigation", version: "1", content: "Compare measurements", scope: "general", category: "analysis" },
    { name: "Composition", version: "1", content: "Structure the report", scope: "project", category: "presentation" },
    { name: "Legacy", version: "1", content: "Legacy method" },
  ] });
  expect(response.status).toBe(200);
  expect(service.store.settings("p")!.skillRefs?.map(ref => [ref.scope, ref.category])).toEqual([["general", "analysis"], ["project", "presentation"], ["project", "other"]]);
  const overview = await call("GET", []);
  expect((overview.body as any).data.periodOptions).toMatchObject({ defaultPeriod: presetReportPeriod("recent"), availablePeriod: null });
  expect((overview.body as any).data.periodOptions.availablePeriodReason).toContain("CSV timestamp columns");
});

it("allows Skill Creator from successful chat history without a report and protects draft retrieval", async () => {
  const { service, settings, call } = setup();
  const chat = service.store.enqueue({ settings, period: { from: "2026-09-01", toExclusive: "2026-09-08" }, kind: "chat", actorUserId: "u", prompt: "Discuss the method" });
  expect((await call("POST", ["runs"], { kind: "skill", sessionId: chat.sessionId, prompt: "Extract method" })).status).toBe(400);
  service.store.claim(); service.store.finish({ ...chat, status: "succeeded", answer: "Verify evidence before making claims." });
  expect((await call("POST", ["runs"], { kind: "skill", sessionId: chat.sessionId, prompt: "Extract method" })).status).toBe(202);
  expect(service.store.list("p")[0]!.parentRunId).toBeUndefined();
  expect((await call("GET", ["draft-skill", chat.id], undefined, "other")).status).toBe(403);
});

it("authorizes per-analysis attachments and never changes project defaults", async () => {
  const { service, settings, call, context } = setup();
  const getRef = vi.fn(({ id }: { id: string }) => { if (id !== "allowed") throw new Error("FILE_FORBIDDEN"); return {}; });
  Object.assign(context.fileAssetService, { getRef });
  expect((await call("POST", ["runs"], {kind:"chat",prompt:"Read this file",period:{from:"2026-08-01",toExclusive:"2026-09-01"},fileRefIds:["allowed"]})).status).toBe(202);
  expect(service.store.list("p")[0]!.settings.fileRefIds).toEqual(["allowed"]);
  expect(service.store.settings("p")!.fileRefIds).toEqual(settings.fileRefIds);
  expect(getRef).toHaveBeenCalledWith({id:"allowed",user_id:"u",workspace_id:"w"});
  expect((await call("POST", ["runs"], {kind:"chat",prompt:"Read a forbidden file",fileRefIds:["forbidden"]})).status).toBe(403);
});

it("saves immutable versions separately from defaults and pins explicit run inputs", async () => {
  const { call, service, settings } = setup();
  const body = { name: "Office method", version: "1.0.0", content: "Recompute the baseline", scope: "project" };
  const firstResponse = await call("POST", ["skills"], body);
  expect(firstResponse.status).toBe(200);
  const first = (firstResponse.body as any).data;
  expect(service.store.settings("p")).toEqual(settings);
  const secondResponse = await call("POST", ["skills"], { ...body, id: first.id, revision: first.revision, version: "1.1.0", content: "Check missing intervals first" });
  expect(secondResponse.status).toBe(200);
  const second = (secondResponse.body as any).data;
  expect((await call("POST", ["skills"], { ...body, id: first.id, revision: second.revision })).status).toBe(409);
  expect((await call("POST", ["runs"], { kind: "chat", prompt: "Analyze", skillSelection: { mode: "selected", refs: [{ id: first.id, version: first.version }] } })).status).toBe(202);
  const run = service.store.list("p")[0]!;
  expect(run.settings.skillRefs?.[0]?.content).toBe(first.content);
  expect(run.settings.skillUsage).toEqual(expect.arrayContaining([expect.objectContaining({id:first.id,version:"1.0.0",source:"explicit"}),expect.objectContaining({id:"builtin:review",source:"required"})]));
  expect(service.store.settings("p")).toEqual(settings);
  expect((await call("POST", ["skills", "default"], { id: first.id, version: second.version, revision: settings.revision })).status).toBe(200);
  expect(service.store.settings("p")!.skill).toBe(second.content);
  expect(service.store.get("p",run.id).settings.skillRefs?.[0]?.content).toBe(first.content);
  expect((await call("POST", ["runs"], { kind:"chat", prompt:"Try", skillSelection:{mode:"selected",refs:[{id:first.id,version:"missing"}]}})).status).toBe(409);
  expect((await call("POST", ["runs"], { kind:"chat", prompt:"Try", skillSelection:{mode:"selected",refs:[]}})).status).toBe(202);
  expect(service.store.list("p")[0]!.settings.skillUsage?.filter(item=>item.source === "required")).toHaveLength(3);
});
it("lets another project manager append shared versions without changing ownership", async () => {
  const { call, context } = setup();
  const body = { name: "Shared method", version: "1", scope: "project", content: "Check observed energy" };
  const first = ((await call("POST", ["skills"], body)).body as any).data;
  const list = JSON.stringify((await call("GET", ["skills"], undefined, "other")).body);
  expect(list).toContain("Shared method");
  const next = { ...body, id: first.id, revision: first.revision, version: "2", content: "Check intervals and units" };
  const updated = await call("POST", ["skills"], next, "other");
  expect(updated.status).toBe(200);
  const resource = context.metadataStore.configResources.get({ id: first.id, user_id: "u", workspace_id: "w", kind: "skill" });
  expect(resource.user_id).toBe("u");
  expect(resource.payload.reportSkillVersions).toHaveLength(2);
  expect((await call("POST", ["skills"], next, "u")).status).toBe(409);
  authorize.mockImplementation((_store, userId) => ({ canManageProject: userId === "u", canChat:true, capabilities:{publishConfiguration:userId === "u"} }));
  expect((await call("POST", ["skills"], { ...next, revision: resource.revision, version: "3" }, "other")).status).toBe(403);
});
it("isolates personal Skills by owner and rejects scope escalation and foreign edits", async () => {
  const { call, settings } = setup();
  const response = await call("POST", ["skills"], { name:"Private method",version:"1",scope:"personal",content:"Private instructions" });
  expect(response.status).toBe(200);
  const skill=(response.body as any).data;
  expect(JSON.stringify((await call("GET", ["skills"], undefined,"other")).body)).not.toContain("Private instructions");
  expect((await call("POST",["skills"],{id:skill.id,revision:1,name:skill.name,version:"2",scope:"personal",content:"Replace"},"other")).status).toBe(403);
  expect((await call("POST",["skills"],{id:skill.id,revision:1,name:skill.name,version:"2",scope:"project",content:"Publish"})).status).toBe(409);
  expect((await call("POST",["skills","default"],{id:skill.id,version:skill.version,revision:settings.revision})).status).toBe(403);
  expect((await call("POST",["runs"],{kind:"chat",prompt:"Steal",skillSelection:{mode:"selected",refs:[{id:skill.id,version:skill.version}]}},"other")).status).toBe(409);
  expect((await call("POST",["skills"],{id:"builtin:review",revision:0,name:"Report review",version:"2",scope:"project",content:"Skip review"})).status).toBe(403);
});

it("keeps member history readable while rejecting new work and Skills writes", async () => {
  const { call, service, settings } = setup();
  service.store.saveSettings({...settings,fileRefIds:["ADMIN_PRIVATE_ATTACHMENT"]});
  authorize.mockReturnValue({canManageProject:false,canChat:false,capabilities:{publishConfiguration:false}});
  const overview=await call("GET",[]);
  expect(overview.status).toBe(200);
  expect((overview.body as any).data.settings.fileRefIds).toEqual([]);
  expect((overview.body as any).data.canManageProject).toBe(false);
  expect((await call("POST",["runs"],{kind:"chat",prompt:"Explain my project"})).status).toBe(403);
  expect(service.store.list("p")).toEqual([]);
  expect((await call("PUT",["settings"],settings)).status).toBe(403);
  const draft={name:"My method",version:"1",scope:"personal",content:"Compare valid intervals"};
  expect((await call("POST",["skills"],draft)).status).toBe(403);
  expect((await call("POST",["skills"],{...draft,scope:"project"})).status).toBe(403);
  expect((await call("POST",["skills","default"],{})).status).toBe(403);
});

it("resolves scheduled defaults to the saved semantic identity rather than a settings revision",async()=>{
 const {call,service,context,settings}=setup();
 const created=(await call("POST",["skills"],{name:"Office investigation",version:"1.3.0",scope:"project",content:"Review comparable weekdays and coverage"})).body as any;
 await call("POST",["skills","default"],{id:created.data.id,version:created.data.version,revision:settings.revision});
 const bound=service.store.settings("p")!;
 const resolved=resolveReportSkillSelection(bound,reportSkillCatalog(context,bound,true));
 expect(resolved.skillUsage).toContainEqual(expect.objectContaining({id:created.data.id,name:"Office investigation",version:"1.3.0",inputPath:"project-skill.md"}));
 expect(resolved.skill).toBe(created.data.content);
 expect(resolved.skillUsage?.some(item=>item.name==="Project Skill")).toBe(false);
});

it("attaches the owner's previous period to a fresh conversation, never a foreign report",async()=>{
 const {call,service,settings}=setup();
 const earlier=service.store.enqueue({settings,actorUserId:"u",period:{from:"2026-08-01",toExclusive:"2026-08-08"},prompt:"Prior report"});
 service.store.claim();service.store.finish({...earlier,status:"succeeded"});
 const foreign=service.store.enqueue({settings,actorUserId:"other",period:{from:"2026-08-02",toExclusive:"2026-08-08"},prompt:"Private report"});
 service.store.claim();service.store.finish({...foreign,status:"succeeded"});
 await call("POST",["runs"],{kind:"chat",prompt:"Make this week's report",period:{from:"2026-08-08",toExclusive:"2026-08-15"}});
 const run=service.store.list("p")[0]!;
 expect(run.continuityRunId).toBe(earlier.id);expect(run.parentRunId).toBeUndefined();
});

import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, linkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { ConfigApiContext } from "../routes/types.js";
import { handleReportLibraryApi } from "./report-library-api.js";
import { handleReportApi } from "./report-api.js";
import { ReportService, registerReportService } from "./report-service.js";
import type { ReportRun, ReportSettings } from "./report-store.js";
const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) close(); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "report-library-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  for (const id of ["admin", "reader", "outsider"]) metadata.users.upsertDevUser({ id, email: `${id}@example.test`, display_name: id, dev_token: id });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  for (const id of ["workspace", "foreign"]) metadata.workspaces.upsert({ id, owner_user_id: "admin", name: id, kind: "customer" });
  metadata.workspaceMemberships.upsert({ workspace_id: "workspace", user_id: "reader", role: "member" });
  for (const [id, workspace_id, status] of [["project", "workspace", "published"], ["draft", "workspace", "draft"], ["foreign-project", "foreign", "published"]] as const) metadata.energyIq.upsertProject({ id, workspace_id, name: id, status });
  const context = { metadataStore: metadata, workspaceId: "workspace", userId: "reader", fileAssetService: {} } as Required<ConfigApiContext>;
  const service = new ReportService({ metadata, root, files: context.fileAssetService, harness: async () => ({ answer: "unused" }) });
  registerReportService(metadata, service);
  const settings: ReportSettings = { projectId: "project", workspaceId: "workspace", actorUserId: "admin", timezone: "Asia/Singapore", contextNotes: "PRIVATE_ATTACHMENT_CONTEXT", fileRefIds: ["PRIVATE_FILE"], useProjectData: false, skill: "Saved reusable method", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "PRIVATE_SCHEDULE_PROMPT" };
  const create = (kind: ReportRun["kind"] = "report", status: ReportRun["status"] = "succeeded", projectId = "project", workspaceId = "workspace") => {
    const run = service.store.enqueue({ settings: { ...settings, projectId, workspaceId }, actorUserId: "admin", period: { from: "2026-09-01", toExclusive: "2026-09-08" }, prompt: "PRIVATE_CHAT_PROMPT", kind });
    service.store.claim(); service.store.finish({ ...run, status, answer: "PRIVATE_CHAT_ANSWER", harnessSessionId: "PRIVATE_PI_SESSION" });
    mkdirSync(join(root, run.id)); writeFileSync(join(root, run.id, "accepted-output.txt"), kind === "report" ? "<html><body>Accepted report</body></html>" : "UNSAVED_SKILL_DRAFT");
    return run;
  };
  const report = create(); const draftSkill = create("skill"); const failed = create("report", "failed"); const foreign = create("report", "succeeded", "foreign-project", "foreign");
  service.store.saveSettings({ ...settings, skillRefs: [{ name: "Analysis", version: "v2", content: "Saved analysis method", scope: "general", category: "analysis", sourceRunId: report.id, sourceSessionId: report.sessionId }] });
  const request = (method = "GET") => { const req = Readable.from([]) as IncomingMessage; req.method = method; return req; };
  const call = (segments: string[] = ["project"], method = "GET", userId = "reader", workspaceId = "workspace") => handleReportLibraryApi(request(method), segments, { ...context, userId, workspaceId });
  return { root, service, settings, metadata, context, create, report, draftSkill, failed, foreign, call, request };
}
it("lets a real Workspace member read accepted report metadata and ask the advisor, without exposing Skills", async () => {
  const { metadata, report, call } = setup();
  const before = metadata.db.prepare("SELECT total_changes() AS changes").get()!.changes;
  const response = await call();
  expect(response.status).toBe(200); expect(response.headers?.["Cache-Control"]).toBe("private, no-store");
  const data = (response.body as any).data;
  // Everyone in the workspace may ask the advisor; only managers see the project's own methods and notes.
  expect(data.canChat).toBe(true); expect(data.canManageProject).toBe(false);
  expect(data.reports).toHaveLength(1);
  expect(data.reports[0].id).toBe(report.id);
  expect(Object.keys(data.reports[0]).sort()).toEqual(["canDiscuss", "category", "createdAt", "finishedAt", "id", "kind", "period", "source", "title", "version"]);
  // Reports the advisor wrote are told apart from the ones the server writes from the site's own meter readings.
  expect(data.reports[0].source).toBe("advisor");
  expect(data.reports[0].cadence).toBeUndefined();
  expect(data.skills).toEqual([]);
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE_|UNSAVED_SKILL_DRAFT|fileRefIds|contextNotes|harnessSessionId/);
  expect(metadata.db.prepare("SELECT total_changes() AS changes").get()!.changes).toBe(before);
});
// The Overview shows one saved site report; which one follows the cadence an administrator chose on the setup
// document, so the list has to say what that choice is.
it("reports the cadence the Overview shows, defaulting to monthly, without writing anything", async () => {
  const { metadata, call } = setup();
  expect(((await call()).body as any).data.overviewCadence).toBe("monthly");
  const draft = metadata.energyIq.projectSetup.getDraft({ project_id: "project", user_id: "admin" });
  metadata.energyIq.projectSetup.saveDraft({ project_id: "project", expected_revision: draft.revision, user_id: "admin",
    document: { ...draft.document, project: { ...draft.document.project, overview_cadence: "weekly" } } });
  const before = metadata.db.prepare("SELECT total_changes() AS changes").get()!.changes;
  expect(((await call()).body as any).data.overviewCadence).toBe("weekly");
  expect(metadata.db.prepare("SELECT total_changes() AS changes").get()!.changes).toBe(before);
});
it("allows project HTML across authors but denies skill drafts, failures and guessed foreign Run IDs", async () => {
  const { report, draftSkill, failed, foreign, call } = setup();
  const result = await call(["project", "output", report.id]);
  expect(result.status).toBe(200); expect((result.body as any).data).toEqual({ content: "<html><body>Accepted report</body></html>" });
  for (const run of [draftSkill, failed, foreign]) expect((await call(["project", "output", run.id])).status).toBe(404);
  expect((await call(["project", "runs", report.id, "events"])).status).toBe(404);
});
it("enforces real project/workspace visibility for foreign projects, drafts and nonmembers", async () => {
  const { call, foreign } = setup();
  expect((await call(["foreign-project"])).status).toBe(403);
  expect((await call(["foreign-project", "output", foreign.id])).status).toBe(403);
  expect((await call(["foreign-project"], "GET", "reader", "foreign")).status).toBe(403);
  expect((await call(["draft"])).status).toBe(403);
  expect((await call(["project"], "GET", "outsider")).status).toBe(403);
});
it("rejects disabled users and keeps ordinary member chat disabled", async () => {
  const { metadata, call } = setup();
  expect(((await call(["project"], "GET", "admin")).body as any).data.canChat).toBe(true);
  const user = metadata.users.getById({ user_id: "reader" });
  vi.spyOn(metadata.users, "getById").mockReturnValue({ ...user, disabled_at: new Date().toISOString() });
  expect((await call()).status).toBe(403);
});
it("keeps the library readable, lets a member start a conversation, and refuses project settings writes", async () => {
  const { call, request, context } = setup();
  for (const method of ["POST", "PUT", "DELETE"]) expect((await call(["project"], method)).status).toBe(405);
  expect((await handleReportApi(request("POST"), ["project", "sessions"], context)).status).toBe(200);
  expect((await handleReportApi(request("PUT"), ["project", "settings"], context)).status).toBe(403);
  expect((await handleReportApi(request("POST"), ["project", "skills"], context)).status).toBe(403);
});

it("uses actual schedule ancestry for categories and counts successful versions through retries", async () => {
  const { service, settings, call, foreign, metadata } = setup();
  const complete = (run: ReportRun, status: ReportRun["status"] = "succeeded") => { service.store.claim(); service.store.finish({ ...run, status }); return run; };
  const period = { from: "2026-09-01", toExclusive: "2026-09-08" };
  const manual = complete(service.store.enqueue({ settings: { ...settings, frequency: "weekly" }, period, actorUserId: "admin", prompt: "Manual" }));
  const scheduled = complete(service.store.enqueue({ settings: { ...settings, frequency: "off" }, period, actorUserId: "admin", prompt: "Scheduled", scheduleKey: "original-schedule" }));
  const failedRevision = complete(service.store.enqueue({ settings, period, actorUserId: "admin", prompt: "Revise", parentRunId: scheduled.id }), "failed");
  const retry = complete(service.store.resume("project", failedRevision.id, "admin"));
  const final = complete(service.store.enqueue({ settings, period, actorUserId: "admin", prompt: "Revise again", parentRunId: retry.id }));
  const data = ((await call()).body as any).data;
  expect(data.reports.find((run: any) => run.id === manual.id)).toMatchObject({ category: "custom", version: 1 });
  expect(data.reports.find((run: any) => run.id === scheduled.id)).toMatchObject({ category: "scheduled", version: 1 });
  expect(data.reports.find((run: any) => run.id === retry.id)).toMatchObject({ category: "scheduled", version: 2 });
  expect(data.reports.find((run: any) => run.id === final.id)).toMatchObject({ category: "scheduled", version: 3, title: "Scheduled Energy Report — 1 September 2026 to 7 September 2026" });
  metadata.db.prepare("UPDATE energyiq_report_runs SET document = ? WHERE id = ?").run(JSON.stringify({ ...service.store.get("project", manual.id), parentRunId: foreign.id }), manual.id);
  expect(service.store.libraryMetadata("project", manual.id)).toEqual({ category: "custom", version: 1 });
  metadata.db.prepare("UPDATE energyiq_report_runs SET document = ? WHERE id = ?").run(JSON.stringify({ ...service.store.get("project", manual.id), parentRunId: "missing" }), manual.id);
  expect(service.store.libraryMetadata("project", manual.id)).toEqual({ category: "custom", version: 1 });
});
it("lists and reads real archived text and images only for the owning admin without DB writes", async () => {
  const { root, report, service, call, metadata, failed, draftSkill } = setup();
  const directory = service.archivedOutputDirectory(report.id); mkdirSync(directory);
  writeFileSync(join(directory, "facts.json"), '{"kwh":42}');
  writeFileSync(join(directory, "chart.png"), Buffer.from([137, 80, 78, 71]));
  writeFileSync(join(directory, "exploration-notes.md"), "Measured night load.");
  writeFileSync(join(directory, "report.html"), "excluded"); writeFileSync(join(directory, "project-skill.md"), "excluded");
  writeFileSync(join(directory, "code.js"), "excluded"); mkdirSync(join(root, report.id, "work")); writeFileSync(join(root, report.id, "work", "private.txt"), "not archived");
  const before = metadata.db.prepare("SELECT total_changes() AS changes").get()!.changes;
  const data = ((await call(["project"], "GET", "admin")).body as any).data;
  expect(data.artifacts.map((file: any) => file.filename)).toEqual(["chart.png", "exploration-notes.md", "facts.json"]);
  expect(data.artifacts.find((file: any) => file.filename === "facts.json")).toMatchObject({ runId: report.id, encoding: "utf8", mimeType: "application/json", bytes: 10 });
  const read = async (filename: string, user = "admin", runId = report.id) => call(["project", "artifact", runId, filename], "GET", user);
  expect(((await read("facts.json")).body as any).data).toEqual({ content: '{"kwh":42}', encoding: "utf8", mimeType: "application/json", filename: "facts.json" });
  expect(((await read("chart.png")).body as any).data).toMatchObject({ content: "iVBORw==", encoding: "base64", mimeType: "image/png" });
  expect(((await call()).body as any).data.artifacts).toEqual([]);
  expect((await read("facts.json", "reader")).status).toBe(403);
  expect((await read("private.txt")).status).toBe(404);
  for (const run of [failed, draftSkill]) expect((await read("facts.json", "admin", run.id)).status).toBe(404);
  expect(metadata.db.prepare("SELECT total_changes() AS changes").get()!.changes).toBe(before);
  metadata.energyIq.upsertUserRole({ user_id: "outsider", role: "admin" });
  expect(((await call(["project"], "GET", "outsider")).body as any).data.artifacts).toEqual([]);
  expect((await read("facts.json", "outsider")).status).toBe(403);
});
it("rejects traversal, hardlinks, symlinks, oversized files and linked output directories", async () => {
  const { root, report, service, call } = setup(); const directory = service.archivedOutputDirectory(report.id); mkdirSync(directory);
  const outside = join(root, "outside.txt"); writeFileSync(outside, "do not disclose");
  linkSync(outside, join(directory, "linked.txt"));
  writeFileSync(join(directory, "large.txt"), Buffer.alloc(2 * 1024 * 1024 + 1));
  let symlinkCreated = false;
  try { symlinkSync(outside, join(directory, "symlink.txt")); symlinkCreated = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
  for (const filename of ["..%2Foutside.txt", "..%5Coutside.txt", "linked.txt", "large.txt", "report.html", "project-skill.md", ...(symlinkCreated ? ["symlink.txt"] : [])]) {
    expect((await call(["project", "artifact", report.id, filename], "GET", "admin")).status).toBe(404);
  }
  expect(((await call(["project"], "GET", "admin")).body as any).data.artifacts).toEqual([]);
  rmSync(directory, { recursive: true });
  const replacement = join(root, "replacement"); mkdirSync(replacement); writeFileSync(join(replacement, "outside.txt"), "do not disclose");
  symlinkSync(replacement, directory, process.platform === "win32" ? "junction" : "dir");
  expect((await call(["project", "artifact", report.id, "outside.txt"], "GET", "admin")).status).toBe(404);
  expect(((await call(["project"], "GET", "admin")).body as any).data.artifacts).toEqual([]);
});

it("keeps successful chat out of reports while exposing its real working files only to its admin owner", async () => {
  const { service, settings, call } = setup();
  const run = service.store.enqueue({ settings, period: { from: "2026-09-01", toExclusive: "2026-09-08" }, actorUserId: "admin", kind: "chat", prompt: "Private chat" });
  service.store.claim(); service.store.finish({ ...run, status: "succeeded", answer: "Private reply" });
  const directory = service.archivedOutputDirectory(run.id); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "calculation.csv"), "kwh\n42");
  const admin = ((await call(["project"], "GET", "admin")).body as any).data;
  expect(admin.reports.some((report: any) => report.id === run.id)).toBe(false);
  expect(admin.artifacts).toContainEqual(expect.objectContaining({ runId: run.id, filename: "calculation.csv" }));
  expect((await call(["project", "artifact", run.id, "calculation.csv"], "GET", "admin")).status).toBe(200);
  expect((await call(["project", "artifact", run.id, "calculation.csv"])).status).toBe(403);
  expect((await call(["project", "output", run.id], "GET", "admin")).status).toBe(404);
  const customer = ((await call()).body as any).data;
  expect(customer.artifacts).toEqual([]); expect(JSON.stringify(customer)).not.toContain("Private reply");
});

it("publishes only validated chat reports and gives their revisions report versions", async () => {
  const { root, service, settings, call } = setup();
  const period = { from: "2026-09-01", toExclusive: "2026-09-08" };
  const run = service.store.enqueue({ settings, period, actorUserId: "admin", kind: "chat", prompt: "Create report" });
  service.store.claim(); service.store.finish({ ...run, status: "succeeded", hasReport: true });
  mkdirSync(join(root, run.id)); writeFileSync(join(root, run.id, "accepted-output.txt"), "<html><body>Validated chat report</body></html>");
  const data = ((await call()).body as any).data;
  expect(data.reports.find((report: any) => report.id === run.id)).toMatchObject({ kind: "report", category: "custom", version: 1 });
  expect((await call(["project", "output", run.id])).status).toBe(200);
  const revision = service.store.enqueue({ settings, period, actorUserId: "admin", kind: "chat", prompt: "Revise", sessionId: run.sessionId! });
  expect(revision.parentRunId).toBe(run.id);
  service.store.claim(); service.store.finish({ ...revision, status: "succeeded", hasReport: true });
  expect(service.store.libraryMetadata("project", revision.id)).toEqual({ category: "custom", version: 2 });
});

it("exposes discussion only to the report owner and resolves report ancestry across private chat nodes", async () => {
  const { service, settings, report, call, metadata } = setup();
  const chat=service.store.enqueue({settings,actorUserId:"admin",period:report.period,prompt:"PRIVATE_INTERMEDIATE",kind:"chat",parentRunId:report.id});
  service.store.claim();service.store.finish({...chat,status:"succeeded"});
  const revision=service.store.enqueue({settings,actorUserId:"admin",period:report.period,prompt:"Revise",kind:"report",parentRunId:report.id});
  service.store.claim();service.store.finish({...revision,parentRunId:chat.id,status:"succeeded"});
  const owner=((await call(["project"],"GET","admin")).body as any).data;
  expect(owner.reports.find((item:any)=>item.id===revision.id)).toMatchObject({canDiscuss:true,previousReportId:report.id,version:2});
  metadata.energyIq.upsertUserRole({user_id:"reader",role:"admin"});
  const other=((await call()).body as any).data;
  expect(other.canChat).toBe(true);
  expect(other.reports.find((item:any)=>item.id===revision.id)).toMatchObject({canDiscuss:false,previousReportId:report.id});
  expect(JSON.stringify(other)).not.toContain("PRIVATE_INTERMEDIATE");
});

it("does not trust a member's generic Skill payload as a shared project method", async () => {
  const { metadata, call } = setup();
  metadata.configResources.upsert({id:"forged",workspace_id:"workspace",user_id:"reader",kind:"skill",name:"Forged shared method",payload:{scope:"workspace",reportProjectId:"project",reportSkillVersions:[{version:"1",content:"UNAPPROVED_SHARED_METHOD"}]}});
  const result=await call();
  expect(result.status).toBe(200);
  expect(JSON.stringify(result.body)).not.toContain("UNAPPROVED_SHARED_METHOD");
});

it("resolves an explicitly requested old report without widening private data access",async()=>{
 const {service,create,context}=setup();const old=create();
 for(let i=0;i<101;i++)create();
 expect(service.store.list('project').some(run=>run.id===old.id)).toBe(false);
 const request=Readable.from([]) as IncomingMessage;request.method='GET';request.url=`/?reportId=${old.id}`;
 const result=await handleReportLibraryApi(request,['project'],context);
 expect(result.status).toBe(200);expect((result.body as any).data.reports.some((r:{id:string})=>r.id===old.id)).toBe(true);
 expect(JSON.stringify(result.body)).not.toContain('PRIVATE_CHAT_PROMPT');
 request.url='/?reportId=does-not-exist';expect((await handleReportLibraryApi(request,['project'],context)).status).toBe(404);
});


it("keeps a reader's own sessions and answers, whatever project access row they hold", async () => {
  const { metadata, service, settings, request, context } = setup();
  metadata.energyIq.upsertProjectAccess({ project_id: "project", user_id: "reader", role: "editor" });
  const created = await handleReportApi(request("POST"), ["project", "sessions"], context);
  expect(created.status).toBe(200);
  const session = (created.body as any).data;
  const run = service.store.enqueue({ settings, actorUserId: "reader", sessionId: session.id, period: { from: "2026-09-01", toExclusive: "2026-09-08" }, prompt: "My earlier investigation", kind: "chat" });
  service.store.claim(); service.store.finish({ ...run, status: "succeeded", answer: "My earlier answer" });
  metadata.energyIq.upsertProjectAccess({ project_id: "project", user_id: "reader", role: "viewer" });
  const response = await handleReportApi(request(), ["project"], context);
  expect(response.status).toBe(200);
  const data = (response.body as any).data;
  expect(data.canChat).toBe(true); expect(data.canManageProject).toBe(false);
  expect(data.sessions.map((item: any) => item.id)).toContain(session.id);
  expect(data.runs).toHaveLength(1);
  expect(data.runs[0]).toMatchObject({ prompt: "My earlier investigation", answer: "My earlier answer" });
  expect(JSON.stringify(data.settings)).not.toMatch(/PRIVATE_|Saved reusable method/);
  expect((await handleReportApi(request("POST"), ["project", "sessions"], context)).status).toBe(200);
});

it("pauses a revoked schedule owner without running a report as a background administrator", async () => {
  const { root, metadata, settings, context } = setup();
  const harness = vi.fn(async () => ({ answer: "Must not run" }));
  const service = new ReportService({ metadata, root, files: context.fileAssetService, harness });
  service.store.saveSettings({ ...service.store.settings("project")!, actorUserId: "reader", skillRefs: [], frequency: "daily", localHour: 0 });
  const before = service.store.list("project").length;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  service.start();
  try {
    await service.tick(new Date("2026-09-14T12:00:00Z"));
    expect(service.store.settings("project")).toMatchObject({ frequency: "off", actorUserId: "reader", schedulePermissionIssue: expect.stringContaining("no longer has permission") });
    expect(service.store.list("project")).toHaveLength(before);
    expect(harness).not.toHaveBeenCalled();
  } finally { await service.stop(); log.mockRestore(); }
});


it("labels all-history scheduled reports with the issue period rather than the dataset bounds", async () => {
  const { service, settings, call } = setup();
  const issue = { from: "2026-09-07", toExclusive: "2026-09-14" };
  const run = service.store.enqueue({ settings, actorUserId: "admin", prompt: "Weekly", period: { from: "2026-01-01", toExclusive: "2026-09-15" }, reportingPeriod: issue, scheduleKey: "weekly-label" });
  service.store.claim();
  service.store.finish({ ...run, status: "succeeded" });
  const data = ((await call()).body as any).data;
  expect(data.reports.find((item: any) => item.id === run.id)).toMatchObject({ period: issue, title: "Scheduled Energy Report — 7 September 2026 to 13 September 2026" });
});

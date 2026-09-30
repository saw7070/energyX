import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetadataStore } from "@datafoundry/metadata";
import type { FileAssetService } from "@datafoundry/files";
import { completedReportPeriod, validateReportPeriod } from "./report-calendar.js";
import { ReportStore, type ReportSettings } from "./report-store.js";
import { readReportOutput, ReportService } from "./report-service.js";
import { writeAnalysisContract } from "./analysis-package.js";

const roots: string[] = [];
const databases: DatabaseSync[] = [];
const settings: ReportSettings = { projectId: "project-a", workspaceId: "workspace-a", actorUserId: "admin", timezone: "Asia/Singapore", contextNotes: "", fileRefIds: [], useProjectData: true, skill: "Analyse night load", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "" };
const period = { from: "2026-08-01", toExclusive: "2026-09-01" };
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "report-agent-test-")); roots.push(root); const db = new DatabaseSync(join(root, "metadata.sqlite")); databases.push(db); return { root, db, store: new ReportStore(db) }; }

describe("report calendar and persistence", () => {
  it("uses complete local calendar periods across month/year boundaries", () => {
    const now = new Date("2026-01-01T19:00:00Z");
    expect(completedReportPeriod(now, "Asia/Singapore", "daily")).toEqual({ from: "2026-01-01", toExclusive: "2026-01-02" });
    expect(completedReportPeriod(now, "Asia/Singapore", "monthly")).toEqual({ from: "2025-12-01", toExclusive: "2026-01-01" });
    expect(completedReportPeriod(new Date("2026-09-13T19:00:00Z"), "Asia/Singapore", "weekly")).toEqual({ from: "2026-09-07", toExclusive: "2026-09-14" });
    expect(completedReportPeriod(new Date("2026-09-13T17:00:00Z"), "Asia/Singapore", "weekly")).toBeUndefined();
  });
  it("rejects impossible windows and allows valid cross-year periods", () => {
    expect(() => validateReportPeriod({ from: "2026-02-30", toExclusive: "2026-03-03" })).toThrow("INVALID_DATE");
    expect(validateReportPeriod({ from: "2020-01-01", toExclusive: "2026-03-03" })).toEqual({ from: "2020-01-01", toExclusive: "2026-03-03" });
  });
  it("persists settings revisions, deduplicates scheduled windows and preserves interrupted jobs", () => {
    const { db, store } = fixture();
    const saved = store.saveSettings(settings);
    expect(() => store.saveSettings(settings)).toThrow("SETTINGS_CHANGED");
    const args = { settings: saved, period, prompt: "Report", actorUserId: "admin", scheduleKey: "monthly:2026-08" };
    const job = store.enqueue(args);
    const restarted = new ReportStore(db);
    expect(restarted.enqueue(args).id).toBe(job.id);
    expect(restarted.claim()?.id).toBe(job.id);
    expect(restarted.claim()).toBeUndefined();
    restarted.recoverInterrupted();
    expect(restarted.get(settings.projectId, job.id).status).toBe("interrupted");
    expect(() => restarted.get("other-project", job.id)).toThrow("NOT_FOUND");
  });
  it("requires an accepted Skill before enabling schedules and a completed same-project parent", () => {
    const { store } = fixture();
    expect(() => store.saveSettings({ ...settings, skill: "", frequency: "monthly" })).toThrow("SKILL_REQUIRED");
    const parent = store.enqueue({ settings, period, prompt: "Initial", actorUserId: "admin" });
    expect(() => store.enqueue({ settings, period, prompt: "Revise", actorUserId: "admin", parentRunId: parent.id })).toThrow("PARENT_NOT_READY");
  });
});

describe("report worker", () => {
  it("rejects a new-contract report missing analysis evidence before accepting its HTML", async () => {
    const { root, db } = fixture();
    const service = new ReportService({ root, metadata:{db} as MetadataStore,files:{} as FileAssetService,
      authorizeProject:()=>undefined,
      prepareInputs:async(run,directory)=>{
        const input=join(directory,"inputs");mkdirSync(input);
        writeFileSync(join(input,"manifest.json"),JSON.stringify({runId:run.id,workspaceId:run.workspaceId,projectId:run.projectId,analysisPeriod:run.period,timezone:"Asia/Singapore"}));
        writeAnalysisContract(input);
      },
      harness:async({directory})=>{writeFileSync(join(directory,"outputs/report.html"),"<html><body>A plausible report without evidence</body></html>");return {answer:"Done"};},
    });
    const run=service.store.enqueue({settings,period,prompt:"Analyze",actorUserId:"admin"});
    service.start();
    await vi.waitFor(()=>expect(service.store.get(settings.projectId,run.id).status).toBe("failed"));
    expect(existsSync(join(root,run.id,"accepted-output.txt"))).toBe(false);
    await service.stop();
  });
  it("commits only a finished HTML and leaves it intact after a later failed generation", async () => {
    const { root, db } = fixture();
    const harness = vi.fn(async ({ directory }: { directory: string }) => {
      expect(JSON.parse(readFileSync(join(directory,"inputs","project-actions.json"),"utf8"))).toMatchObject({scope:"project_shared_only",actions:[]});
      writeFileSync(join(directory, "outputs", "report.html"), "<!doctype html><html><body>Energy report with evidence</body></html>");
      return { answer: "Report created", sessionId: "external-session" };
    });
    const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService, harness,
      authorizeProject: () => undefined, prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); writeFileSync(join(directory, "inputs", "sample.csv"), "kwh\n10"); },
    });
    const first = service.store.enqueue({ settings, period, prompt: "Make report", actorUserId: "admin" });
    service.start();
    await vi.waitFor(() => expect(service.store.get(settings.projectId, first.id).status).toBe("succeeded"));
    const accepted = service.output(settings.projectId, first.id);
    expect(accepted).toContain("Energy report");
    harness.mockImplementationOnce(async () => { throw new Error("REPORT_AGENT_PROCESS_FAILED"); });
    const second = service.store.enqueue({ settings, period, prompt: "Make another", actorUserId: "admin" });
    await service.tick();
    expect(service.store.get(settings.projectId, second.id).status).toBe("failed");
    expect(service.output(settings.projectId, first.id)).toBe(accepted);
    expect(() => service.output(settings.projectId, second.id)).toThrow("NOT_READY");
    await service.stop();
  });
  it("rejects partial and linked HTML artifacts", () => {
    const { root } = fixture(); mkdirSync(join(root, "outputs"));
    const file = join(root, "outputs", "report.html");
    writeFileSync(file, "<html><body>Partial report without end tag and more than thirty characters");
    expect(() => readReportOutput(root, "report")).toThrow("HTML_INCOMPLETE");
    rmSync(file);
    writeFileSync(join(root, "outside.html"), "<html><body>Other file is not a generated artifact</body></html>");
    try { symlinkSync(join(root, "outside.html"), file); } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    expect(() => readReportOutput(root, "report")).toThrow("OUTPUT_INVALID");
  });

});


describe("persistent report Sessions and recovery", () => {
  it("keeps revisions in the same user Session and rejects cross-user continuation", () => {
    const { store, db } = fixture();
    const first = store.enqueue({ settings, period, prompt: "Initial", actorUserId: "admin" });
    store.claim(); store.finish({ ...first, status: "succeeded", harnessSessionId: "pi-first" });
    const revision = store.enqueue({ settings, period, prompt: "Revise", actorUserId: "admin", sessionId: first.sessionId! });
    expect(revision.sessionId).toBe(first.sessionId);
    expect(revision.parentRunId).toBe(first.id);
    expect(() => store.enqueue({ settings, period, prompt: "Steal", actorUserId: "another", sessionId: first.sessionId! })).toThrow("FORBIDDEN");
    expect(new ReportStore(db).sessions(settings.projectId, "admin")).toHaveLength(1);
    expect(store.sessions(settings.projectId, "another")).toHaveLength(0);
  });
  it("cancels queued and active jobs, prevents late success, retries without erasing history", () => {
    const { store } = fixture();
    const run = store.enqueue({ settings, period, prompt: "Initial", actorUserId: "admin" });
    store.cancel(settings.projectId, run.id);
    expect(store.claim()).toBeUndefined();
    const retry = store.resume(settings.projectId, run.id, "admin");
    expect(retry.id).not.toBe(run.id); expect(retry.sessionId).toBe(run.sessionId);
    expect(retry.retryOfRunId).toBe(run.id);
    store.claim(); store.cancel(settings.projectId, retry.id);
    store.finish({ ...retry, status: "succeeded" });
    expect(store.get(settings.projectId, retry.id).status).toBe("cancelled");
    expect(store.events(retry.id).map(event => event.type)).toEqual(["queued", "running", "cancelled"]);
    expect(store.events(retry.id, store.events(retry.id)[0]!.sequence)).toHaveLength(2);
  });
  it("pins multiple Skill versions and provenance, with fresh scheduled Sessions and period deduplication", () => {
    const { store } = fixture();
    const source = store.enqueue({ settings, period, prompt: "Extract methods", actorUserId: "admin", kind: "skill" });
    store.claim(); store.finish({ ...source, status: "succeeded" });
    const saved = store.saveSettings({ ...settings, skillSourceRunId: source.id, skillRefs: [{ name: "analysis", version: "1", content: "Check night load", sourceRunId: source.id, sourceSessionId: source.sessionId }], frequency: "monthly" });
    expect(saved.skillSourceSessionId).toBe(source.sessionId);
    const first = store.enqueue({ settings: saved, period, prompt: "Scheduled", actorUserId: "admin", scheduleKey: "aug" });
    const changed = store.saveSettings({ ...saved, skill: "New method" });
    expect(store.enqueue({ settings: changed, period, prompt: "Scheduled", actorUserId: "admin", scheduleKey: "aug" }).id).toBe(first.id);
    expect(store.get(settings.projectId, first.id).settings.revision).toBe(saved.revision);
    const next = store.enqueue({ settings: changed, period: { from: "2026-09-01", toExclusive: "2026-10-01" }, prompt: "Scheduled", actorUserId: "admin", scheduleKey: "sep" });
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(next.parentRunId).toBeUndefined();
  });
  it("aborts the actual active harness and retains cancelled history", async () => {
    const { root, db } = fixture(); let started = false, aborted = false;
    const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService,
      authorizeProject: () => undefined,
      prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
      harness: async ({ signal }) => { started = true; await new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("REPORT_CANCELLED")); }, { once: true })); return { answer: "" }; },
    });
    const run = service.store.enqueue({ settings, period, prompt: "Run", actorUserId: "admin" });
    service.start(); await vi.waitFor(() => expect(started).toBe(true));
    service.cancel(settings.projectId, run.id); await service.stop();
    expect(aborted).toBe(true); expect(service.store.get(settings.projectId, run.id).status).toBe("cancelled");
    expect(() => service.output(settings.projectId, run.id)).toThrow("NOT_READY");
  });
});


it("persists chat replies without an artifact and resumes their checkpoint for reports and Skill notes", async () => {
  const { root, db } = fixture();
  const calls: Array<{ previousStateDirectory?: string; prompt: string }> = [];
  let skillNotes = "";
  const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService,
    authorizeProject: () => undefined,
    prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
    harness: async input => {
      calls.push({ prompt: input.prompt, ...(input.previousStateDirectory ? { previousStateDirectory: input.previousStateDirectory } : {}) });
      mkdirSync(join(input.directory, "state"));
      if (calls.length === 1 || calls.length === 3) writeFileSync(join(input.directory, "outputs", "report.html"), "<!doctype html><html><body>Energy report</body></html>");
      if (calls.length === 4) {
        skillNotes = readFileSync(join(input.directory, "inputs", "creation-notes.json"), "utf8");
        writeFileSync(join(input.directory, "outputs", "project-skill.md"), "Reusable skill: compare night load against occupied hours.");
      }
      return { answer: calls.length === 2 ? "We should compare the night load first." : "Completed", sessionId: "retained-pi" };
    },
  });
  const first = service.store.enqueue({ settings, period, prompt: "Initial report", actorUserId: "admin" });
  service.start();
  try {
    await vi.waitFor(() => expect(service.store.get(settings.projectId, first.id).status).toBe("succeeded"));
    const chat = service.store.enqueue({ settings, period, prompt: "Discuss our next step", actorUserId: "admin", kind: "chat", sessionId: first.sessionId! });
    await service.tick();
    const savedChat = service.store.get(settings.projectId, chat.id);
    expect(savedChat.status).toBe("succeeded"); expect(savedChat.answer).toBe("We should compare the night load first.");
    expect(savedChat.harnessSessionId).toBe("retained-pi");
    expect(existsSync(join(root, chat.id, "accepted-output.txt"))).toBe(false);
    expect(existsSync(join(root, chat.id, "outputs", "report.html"))).toBe(false);
    expect(() => service.output(settings.projectId, chat.id)).toThrow("CHAT_HAS_NO_OUTPUT");
    expect(() => readReportOutput(join(root, chat.id), "chat")).toThrow("CHAT_HAS_NO_OUTPUT");
    expect(calls[1]!.prompt).toContain("Reply in English");
    expect(calls[1]!.prompt).not.toContain("Write a complete, polished");
    const revision = service.store.enqueue({ settings, period, prompt: "Make revised report", actorUserId: "admin", sessionId: first.sessionId! });
    expect(revision.parentRunId).toBe(first.id);
    await service.tick();
    expect(service.store.get(settings.projectId, revision.id).status).toBe("succeeded");
    expect(calls[2]!.previousStateDirectory).toBe(join(root, chat.id, "state"));
    expect(service.store.libraryMetadata(settings.projectId, revision.id).version).toBe(2);
    const skill = service.store.enqueue({ settings, period, prompt: "Extract the method", actorUserId: "admin", kind: "skill", parentRunId: revision.id });
    await service.tick();
    expect(service.store.get(settings.projectId, skill.id).status).toBe("succeeded");
    expect(skillNotes).toContain("Discuss our next step"); expect(skillNotes).toContain("We should compare the night load first.");
  } finally { await service.stop(); }
});


it("accepts autonomous chat HTML into immutable report storage and preserves it after a bad revision", async () => {
  const { root, db } = fixture(); let calls = 0;
  const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService,
    authorizeProject: () => undefined,
    prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
    harness: async ({ directory }) => {
      calls++;
      if (calls === 2) expect(readFileSync(join(directory, "inputs", "previous-report.html"), "utf8")).toContain("Autonomous evidence report");
      writeFileSync(join(directory, "outputs", "report.html"), calls === 1 ? "<!doctype html><html><body>Autonomous evidence report</body></html>" : "<html>Unfinished report without closing html tag");
      return { answer: "I created the report.", sessionId: "same-pi" };
    },
  });
  const first = service.store.enqueue({ settings, period, prompt: "Summarize this in a report", actorUserId: "admin", kind: "chat" });
  service.start();
  try {
    await vi.waitFor(() => expect(service.store.get(settings.projectId, first.id).status).toBe("succeeded"));
    expect(service.store.get(settings.projectId, first.id)).toMatchObject({ kind: "chat", hasReport: true });
    const accepted = service.output(settings.projectId, first.id); expect(accepted).toContain("Autonomous evidence report");
    const revision = service.store.enqueue({ settings, period, prompt: "Revise it", actorUserId: "admin", kind: "chat", sessionId: first.sessionId! });
    expect(revision.parentRunId).toBe(first.id);
    await service.tick(); expect(service.store.get(settings.projectId, revision.id).status).toBe("failed");
    expect(service.store.get(settings.projectId, revision.id).hasReport).toBeUndefined();
    expect(service.output(settings.projectId, first.id)).toBe(accepted);
    expect(() => service.output(settings.projectId, revision.id)).toThrow();
  } finally { await service.stop(); }
});
it("archives a natural-chat Skill draft without activating it and supports explicit versioned saving", async () => {
  const { root, db } = fixture(); let method = ""; let notes = "";
  const draft = "---\nname: compare-night-load\ndescription: Recompute a night-load comparison from new project data.\n---\nUse current measurements, verify operating hours, and report uncertainty.";
  const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService,
    authorizeProject: () => undefined,
    prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
    harness: async ({ directory }) => {
      method = readFileSync(join(directory, "inputs", "skill-creator.md"), "utf8");
      notes = readFileSync(join(directory, "inputs", "creation-notes.json"), "utf8");
      writeFileSync(join(directory, "outputs", "project-skill.md"), draft);
      return { answer: "A reusable draft is ready for your review.", sessionId: "skill-pi" };
    },
  });
  const discussion = service.store.enqueue({ settings, period, prompt: "Please compare occupied and unoccupied hours", actorUserId: "admin", kind: "chat" });
  service.store.claim(); service.store.finish({ ...discussion, status: "succeeded", answer: "We should verify operating hours before attributing night load." });
  const run = service.store.enqueue({ settings, period, prompt: "Extract a reusable Skill", actorUserId: "admin", kind: "chat", sessionId: discussion.sessionId! });
  service.start();
  try {
    await vi.waitFor(() => expect(service.store.get(settings.projectId, run.id).status).toBe("succeeded"));
    expect(service.store.get(settings.projectId, run.id)).toMatchObject({ kind: "chat", hasSkillDraft: true });
    expect(service.store.get(settings.projectId, run.id).hasReport).toBeUndefined();
    expect(service.skillDraft(settings.projectId, run.id)).toBe(draft);
    expect(service.store.settings(settings.projectId)).toBeUndefined();
    expect(notes).toContain("verify operating hours");
    expect(method).toContain("# EnergyIQ Skill Creator");
    const saved = service.store.saveSettings({ ...settings, skill: draft, skillSourceRunId: run.id });
    expect(saved.revision).toBe(1); expect(saved.skillSourceSessionId).toBe(run.sessionId);
    expect(() => service.store.saveSettings({ ...saved, actorUserId: "other", skillSourceRunId: run.id })).toThrow("SKILL_SOURCE_INVALID");
  } finally { await service.stop(); }
});


it("runs five users concurrently, limits each user and cancels only the selected task", async () => {
  const { root, db } = fixture();
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService,
    maxConcurrent: 5, maxPerUser: 1, authorizeProject: () => undefined,
    prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
    harness: async ({ runId, signal }) => {
      started.push(runId);
      await new Promise<void>(resolve => { release.set(runId, resolve); signal.addEventListener("abort", () => resolve(), { once: true }); });
      return { answer: "Done" };
    },
  });
  const jobs = Array.from({ length: 5 }, (_, i) => service.store.enqueue({ settings, period, kind: "chat", prompt: "Hello", actorUserId: `user-${i}` }));
  const extra = service.store.enqueue({ settings, period, kind: "chat", prompt: "Extra", actorUserId: "user-1" });
  service.start();
  try {
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect(service.store.get(settings.projectId, extra.id).status).toBe("queued");
    service.cancel(settings.projectId, jobs[0]!.id);
    await vi.waitFor(() => expect(service.store.get(settings.projectId, jobs[0]!.id).status).toBe("cancelled"));
    expect(service.store.get(settings.projectId, jobs[1]!.id).status).toBe("running");
    expect(started).not.toContain(extra.id);
    release.get(jobs[1]!.id)!();
    await vi.waitFor(() => expect(started).toContain(extra.id));
  } finally { await service.stop(); }
});


it("reserves a slot for interaction when scheduled reports are busy", async () => {
  const { root, db } = fixture();
  const started: string[] = [];
  const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService,
    maxConcurrent: 3, maxPerUser: 3, authorizeProject: () => undefined,
    prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
    harness: async ({ runId, signal }) => { started.push(runId); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), {once:true})); return {answer:""}; },
  });
  const scheduled = Array.from({length:3}, (_,i) => service.store.enqueue({settings,period,kind:"chat",prompt:"Scheduled",actorUserId:"admin",scheduleKey:`test-${i}`}));
  service.start();
  try {
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(service.store.get(settings.projectId, scheduled[2]!.id).status).toBe("queued");
    const interactive = service.store.enqueue({settings,period,kind:"chat",prompt:"Hello",actorUserId:"other"});
    void service.tick();
    await vi.waitFor(() => expect(started).toContain(interactive.id));
  } finally { await service.stop(); }
});
it("bounds queued work without preventing another user from submitting", () => {
  const {store}=fixture();
  for(let i=0;i<20;i++) store.enqueue({settings,period,prompt:"Report",actorUserId:"busy"});
  expect(()=>store.enqueue({settings,period,prompt:"Excess",actorUserId:"busy"})).toThrow("REPORT_QUEUE_FULL");
  expect(store.enqueue({settings,period,prompt:"Hello",actorUserId:"other"}).status).toBe("queued");
});

it("keeps previous-period context within owner/project and freezes it independently of revisions", async () => {
 const {root,db,store}=fixture();
 const previous=store.enqueue({settings,period:{from:"2026-07-01",toExclusive:"2026-08-01"},prompt:"July",actorUserId:"admin"});
 store.claim();store.finish({...previous,status:"succeeded"});
 mkdirSync(join(root,previous.id,"outputs"),{recursive:true});
 writeFileSync(join(root,previous.id,"outputs","report.html"),"<html><body>Previous completed report and unresolved lighting issue</body></html>");
 writeFileSync(join(root,previous.id,"outputs","report-followup.json"),JSON.stringify({findings:[{topic:"lighting",status:"needs_confirmation"}]}));
 const privateReport=store.enqueue({settings,period:{from:"2026-07-15",toExclusive:"2026-08-01"},prompt:"Private",actorUserId:"other"});
 store.claim();store.finish({...privateReport,status:"succeeded"});
 expect(store.previousPeriodReport(settings,period)?.id).toBe(previous.id);
 expect(store.previousPeriodReport({...settings,workspaceId:"other"},period)).toBeUndefined();
 const service=new ReportService({root,metadata:{db} as MetadataStore,files:{} as FileAssetService,authorizeProject:()=>undefined,
  prepareInputs:async(_run,directory)=>{mkdirSync(join(directory,"inputs"));},
  harness:async({directory})=>{
   expect(readFileSync(join(directory,"inputs","previous-report.html"),"utf8")).toContain("unresolved lighting");
   expect(JSON.parse(readFileSync(join(directory,"inputs","previous-report-context.json"),"utf8")).runId).toBe(previous.id);
   expect(readFileSync(join(directory,"inputs","creation-notes.json"),"utf8")).toBe("[]");
   expect(readFileSync(join(directory,"inputs","previous-followup.json"),"utf8")).toContain("needs_confirmation");
   return {answer:"Reviewed previous period"};
  }});
 const next=store.enqueue({settings,period,kind:"chat",prompt:"New period",actorUserId:"admin",continuityRunId:previous.id});
 expect(next.parentRunId).toBeUndefined();
 service.start();
 try {await vi.waitFor(()=>expect(store.get(settings.projectId,next.id).status).toBe("succeeded"));}
 finally {await service.stop();}
 expect(store.get(settings.projectId,next.id).startedAt).toBeTruthy();
});

it("allows two sessions for one account while serializing turns and preserving the global cap", async()=>{
 const {root,db,store}=fixture();const started:string[]=[];const release=new Map<string,()=>void>();
 const service=new ReportService({root,metadata:{db} as MetadataStore,files:{} as FileAssetService,maxConcurrent:2,maxPerUser:2,authorizeProject:()=>undefined,
 prepareInputs:async(_run,directory)=>{mkdirSync(join(directory,"inputs"));},
 harness:async({runId,signal})=>{started.push(runId);await new Promise<void>(resolve=>{release.set(runId,resolve);signal.addEventListener("abort",()=>resolve(),{once:true});});return{answer:"Done"};}});
 const first=store.enqueue({settings,period,kind:"chat",prompt:"One",actorUserId:"admin"});
 const second=store.enqueue({settings,period,kind:"chat",prompt:"Two",actorUserId:"admin"});
 const other=store.enqueue({settings,period,kind:"chat",prompt:"Other",actorUserId:"other"});
 service.start();try{
 await vi.waitFor(()=>expect(started).toHaveLength(2));expect(started).toEqual([first.id,second.id]);
 expect(store.get(settings.projectId,other.id).status).toBe("queued");
 release.get(first.id)!();await vi.waitFor(()=>expect(started).toContain(other.id));
 expect(store.get(settings.projectId,second.id).status).toBe("running");
 }finally{await service.stop();}
});


it("schedules full-history weekly and monthly issues once, with independent editorial windows", async () => {
  const { root, db } = fixture();
  const harness = vi.fn(async ({ directory }: { directory: string }) => {
    writeFileSync(join(directory, "outputs", "report.html"), "<!doctype html><html><body>Evidence based energy report</body></html>");
    return { answer: "Created", sessionId: "test" };
  });
  const service = new ReportService({ root, metadata: { db } as MetadataStore, files: {} as FileAssetService, harness,
    authorizeProject: () => undefined, resolveScheduledSkills: value => value,
    availablePeriod: async () => ({ from: "2026-01-01", toExclusive: "2026-06-02", actualLastIntervalEnd: "2026-06-01T16:00:00Z" }),
    prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs")); },
  });
  service.start();
  await service.tick();
  service.store.saveSettings({ ...settings, frequency: "weekly-monthly" });
  try {
    await service.tick(new Date("2026-05-31T19:00:00Z"));
    await service.tick(new Date("2026-05-31T19:01:00Z"));
    const runs = service.store.list(settings.projectId);
    expect(runs).toHaveLength(2);
    expect(runs.map(run => run.reportingPeriod?.from).sort()).toEqual(["2026-05-01", "2026-05-25"]);
    for (const run of runs) {
      expect(run.period).toEqual({ from: "2026-01-01", toExclusive: "2026-06-02" });
      expect(run.periodPreset).toBe("all");
      expect(run.prompt).toContain("ALL supplied available history");
    }
  } finally { await service.stop(); }
});

import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "../energy/energy-bootstrap.js";
import { readEnergyProjectInformation } from "../energy/energy-project-information.js";
import type { PiReportModel } from "./pi-report-harness.js";
import { handleReportFeedbackApi, RATE_LIMITS, STALE_PROCESSING_MS, type ReportFeedbackDependencies } from "./report-feedback-api.js";
import { activeCalendar, activeTariff, projectCalendarEntry, readFeedbackSite } from "./report-feedback-site.js";
import { MAX_PENDING_MEMORY, ReportFeedbackStore, type FeedbackDto, type ReportFeedbackState } from "./report-feedback-store.js";
import { registerReportService, type ReportService } from "./report-service.js";
import { ReportStore } from "./report-store.js";

const PROJECT = "ngee-ann-polytechnic";
const NOW = new Date("2026-11-18T04:00:00Z");
let root: string;
let metadata: ReturnType<typeof createMetadataStore>;
let reports: ReportStore;
let meterId: string;
let meterName: string;
let answers: unknown[];
let fetchImpl: ReturnType<typeof vi.fn>;
let applyProjectChanges: ReturnType<typeof vi.fn>;
const model: PiReportModel = { model: "test-model", baseUrl: "https://models.example.test/v1", apiKey: "key", apiProtocol: "openai-completions" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "report-feedback-api-"));
  metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  ensureEnergyIqBootstrap(metadata);
  for (const id of ["admin", "viewer", "viewer2", "outsider"]) metadata.users.createPasswordUser({ id, email: `${id}@example.test` });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  for (const id of ["viewer", "viewer2"]) metadata.workspaceMemberships.upsert({ workspace_id: "default", user_id: id, role: "member" });
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "rate-1", project_id: PROJECT, published_by: "admin", activate: true,
    entries: [{ id: "rate-entry", owner: { kind: "project" }, effective_from: "2026-01-01T00:00:00+08:00", currency: "SGD", rate_per_kwh: 0.25, rate_basis: "tax_exclusive", tax: { name: "GST", rate_pct: 9 } }],
  });
  reports = new ReportStore(metadata.db);
  registerReportService(metadata, { store: reports } as unknown as ReportService);
  const meter = readFeedbackSite(metadata, PROJECT, NOW).meters[0]!;
  meterId = meter.id;
  meterName = meter.name;
  answers = [];
  fetchImpl = vi.fn(async () => {
    const next = answers.shift();
    if (next === undefined) return new Response("no answer queued", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: typeof next === "string" ? next : JSON.stringify(next) } }] }));
  });
  applyProjectChanges = vi.fn(async () => ({ status: 200 }));
});
afterEach(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });

const deps = (extra: Partial<ReportFeedbackDependencies> = {}): ReportFeedbackDependencies => ({
  fetchImpl: fetchImpl as unknown as typeof fetch, resolveModel: () => model, applyProjectChanges: applyProjectChanges as unknown as NonNullable<ReportFeedbackDependencies["applyProjectChanges"]>, now: () => NOW, ...extra,
});
async function call(userId: string, path: string[], body?: unknown, method = body === undefined ? "GET" : "POST", extra: Partial<ReportFeedbackDependencies> = {}) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage;
  request.method = method;
  request.url = "/";
  const response = await handleReportFeedbackApi(request, [encodeURIComponent(PROJECT), ...path], { metadataStore: metadata, userId, workspaceId: "default" } as Required<ConfigApiContext>, deps(extra));
  return response as { status: number; body: { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } };
}
const give = (userId: string, text: string, extra: Record<string, unknown> = {}) => call(userId, [], { requestId: crypto.randomUUID(), text, ...extra });
const dataOf = <T>(response: { body: { data?: unknown } }) => response.body.data as T;
const notes = () => reports.settings(PROJECT)?.contextNotes ?? "";
const weekdays = (from: string, to: string) => ({ mon: [{ from, to }], tue: [{ from, to }], wed: [{ from, to }], thu: [{ from, to }], fri: [{ from, to }], sat: [], sun: [] });

it("lets anyone who reads reports give feedback, and keeps their memory waiting for an administrator", async () => {
  answers.push({
    reply: "I will remember that the fan must never run, and suggest new closing hours.",
    memory: [{ text: "The pavilion fan must never run.", kind: "rule" }],
    suggestions: [{ kind: "operating_hours", payload: { weekly: weekdays("08:00", "19:00") } }],
    followUps: [{ text: "Check the building is empty by 7 pm.", checkBy: "next_report" }],
  });
  const response = await give("viewer", "We now close at 7 pm on weekdays. The pavilion fan must never run.");
  expect(response.status).toBe(200);
  const { feedback, state } = dataOf<{ feedback: FeedbackDto; state: ReportFeedbackState }>(response);
  expect(feedback).toMatchObject({ status: "processed", reply: expect.stringContaining("fan"), authorUserId: "viewer", authorName: "viewer" });
  // Only the days that change are kept, with the hours they replace, so applying it later never undoes other days.
  const entry = projectCalendarEntry(activeCalendar(metadata, PROJECT), "2026-11-18")!;
  expect(feedback.suggestions).toEqual([{ id: expect.any(String), kind: "operating_hours", label: "Change closing time to 7:00 pm, Mon–Fri", payload: {
    weekly: { mon: [{ from: "08:00", to: "19:00" }], tue: [{ from: "08:00", to: "19:00" }], wed: [{ from: "08:00", to: "19:00" }], thu: [{ from: "08:00", to: "19:00" }], fri: [{ from: "08:00", to: "19:00" }] },
    base: { entryId: entry.id, weekly: { mon: entry.weekly.monday, tue: entry.weekly.tuesday, wed: entry.weekly.wednesday, thu: entry.weekly.thursday, fri: entry.weekly.friday } },
  }, status: "open" }]);
  expect(state).toMatchObject({ canGive: true, canManage: false, aiAvailable: true });
  expect(state.memory).toEqual([expect.objectContaining({ text: "The pavilion fan must never run.", kind: "rule", status: "pending", sourceFeedbackId: feedback.id })]);
  // The follow-up waits for an administrator too: until then no report, AI prompt or advisor note carries it.
  expect(state.followUps).toEqual([expect.objectContaining({ text: "Check the building is empty by 7 pm.", status: "pending", checkBy: "next_report" })]);
  expect(state.reportInputs).toEqual({ feedbackMemory: [], followUps: [], dismissedChecks: [] });
  expect(notes()).toBe("");
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).feedbackMemory).toEqual([]);
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).followUps).toEqual([]);
  answers.push({ reply: "ok" });
  await give("admin", "Another thing");
  const prompt = JSON.parse((JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body)) as { messages: Array<{ content: string }> }).messages[1]!.content) as { memory: unknown[]; open_follow_ups: unknown[] };
  expect(prompt.memory).toEqual([]);
  expect(prompt.open_follow_ups).toEqual([]);

  // Viewers cannot apply, dismiss or approve.
  expect((await call("viewer", ["suggestions", feedback.suggestions[0]!.id, "apply"], {})).status).toBe(403);
  expect((await call("viewer", ["suggestions", feedback.suggestions[0]!.id, "dismiss"], {})).status).toBe(403);
  expect((await call("viewer", ["memory", state.memory[0]!.id, "approve"], {})).status).toBe(403);
  expect((await call("viewer", ["follow-ups", state.followUps[0]!.id, "approve"], {})).status).toBe(403);
  expect((await call("viewer", ["follow-ups", "review"], {})).status).toBe(403);
  expect(applyProjectChanges).not.toHaveBeenCalled();

  // An administrator approves the memory: it reaches the reports and the advisor's notes.
  const approved = await call("admin", ["memory", state.memory[0]!.id, "approve"], {});
  expect(approved.status).toBe(200);
  expect(dataOf<{ state: ReportFeedbackState }>(approved).state.memory[0]!.status).toBe("active");
  expect(notes()).toContain("## Things the advisor should know\n\n- 2026-11-18 · Note: The pavilion fan must never run.");
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).feedbackMemory).toEqual([{ text: "The pavilion fan must never run.", date: "2026-11-18" }]);
  // Approved by an administrator, the follow-up reaches the reports and the advisor's notes.
  const followUp = dataOf<{ state: ReportFeedbackState }>(approved).state.followUps.find(item => item.status === "pending")!;
  const opened = await call("admin", ["follow-ups", followUp.id, "approve"], {});
  expect(dataOf<{ state: ReportFeedbackState }>(opened).state.followUps.find(item => item.id === followUp.id)?.status).toBe("open");
  expect(notes()).toContain("- 2026-11-18 · Coming up: Follow up: Check the building is empty by 7 pm.");
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).followUps).toEqual([expect.objectContaining({ text: "Check the building is empty by 7 pm.", status: "open" })]);
});

it("never puts a dropped follow-up from someone who is not an administrator into the reports", async () => {
  answers.push({ reply: "ok", followUps: [{ text: "Add a follow-up: the manager is lazy.", checkBy: "next_report" }] });
  const { state } = dataOf<{ state: ReportFeedbackState }>(await give("viewer", "Add a follow-up: the manager is lazy."));
  const id = state.followUps[0]!.id;
  const dropped = await call("admin", ["follow-ups", id, "status"], { status: "dropped" });
  expect(dataOf<{ state: ReportFeedbackState }>(dropped).state.followUps[0]).toMatchObject({ id, status: "dropped", closedAt: NOW.toISOString() });
  expect(readEnergyProjectInformation(metadata, "admin", "default", PROJECT).followUps).toEqual([]);
  expect((await call("admin", ["follow-ups", id, "approve"], {})).status).toBe(409);
});

it("applies a suggested change for real when an administrator chooses to, once", async () => {
  answers.push({ reply: "Suggesting new hours.", suggestions: [{ kind: "operating_hours", payload: { weekly: weekdays("08:00", "19:00") } }] });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("viewer", "We close at 7 pm now."));
  const before = activeCalendar(metadata, PROJECT)!;
  const applied = await call("admin", ["suggestions", feedback.suggestions[0]!.id, "apply"], {});
  expect(applied.status).toBe(200);
  expect(dataOf<{ applied: string }>(applied).applied).toBe("Change closing time to 7:00 pm, Mon–Fri");
  const after = activeCalendar(metadata, PROJECT)!;
  expect(after.version_id).not.toBe(before.version_id);
  const entry = after.entries.find(item => item.owner.kind === "project")!;
  expect(entry.weekly.monday).toEqual([{ from: "08:00", to: "19:00" }]);
  expect(entry.weekly.saturday).toEqual([]);
  // Everything else about the hours is kept: the start date, the days off and the school terms.
  const original = before.entries.find(item => item.owner.kind === "project")!;
  expect(entry.effective_from).toBe(original.effective_from);
  expect(entry.exceptions).toEqual(original.exceptions);
  expect(after.academic_periods).toEqual(before.academic_periods);
  expect(applyProjectChanges).toHaveBeenCalledTimes(1);
  const suggestion = dataOf<{ state: ReportFeedbackState }>(applied).state.feedback[0]!.suggestions[0]!;
  expect(suggestion).toMatchObject({ status: "applied", appliedAt: NOW.toISOString(), appliedByName: "admin" });
  // Filed with the other project changes in the audit history ("energyiq.report_" is a Projects category prefix).
  const audit = metadata.authAuditEvents.list({ categories: ["energyiq.report_"], limit: 50 }).events.find(event => event.event_type === "energyiq.report_feedback_applied");
  expect(audit).toBeTruthy();
  expect(JSON.parse(audit!.metadata_json ?? "{}")).toEqual({ workspaceId: "default", projectId: PROJECT, kind: "operating_hours", suggestionId: suggestion.id, label: "Change closing time to 7:00 pm, Mon–Fri", outcome: "live" });
  // A second click changes nothing.
  expect((await call("admin", ["suggestions", suggestion.id, "apply"], {})).status).toBe(409);
  expect(applyProjectChanges).toHaveBeenCalledTimes(1);
});

it("changes only the days a suggestion names, and refuses when those days were changed since", async () => {
  answers.push({ reply: "ok", suggestions: [{ kind: "operating_hours", payload: { weekly: { mon: [{ from: "08:00", to: "19:00" }], tue: [{ from: "08:00", to: "19:00" }] } } }] });
  answers.push({ reply: "ok", suggestions: [{ kind: "operating_hours", payload: { weekly: { sat: [{ from: "09:00", to: "13:00" }] } } }] });
  answers.push({ reply: "ok", suggestions: [{ kind: "operating_hours", payload: { weekly: { mon: [{ from: "07:00", to: "17:00" }] } } }] });
  const weekdaysChange = dataOf<{ feedback: FeedbackDto }>(await give("admin", "Mon and Tue close at 7 pm")).feedback.suggestions[0]!;
  const saturdayChange = dataOf<{ feedback: FeedbackDto }>(await give("admin", "Open on Saturday mornings")).feedback.suggestions[0]!;
  const mondayChange = dataOf<{ feedback: FeedbackDto }>(await give("admin", "Monday is 7 to 5")).feedback.suggestions[0]!;
  const entryNow = () => activeCalendar(metadata, PROJECT)!.entries.find(item => item.owner.kind === "project")!;
  const wednesday = entryNow().weekly.wednesday;
  // Two changes worked out from the same hours: the second keeps what the first changed.
  expect((await call("admin", ["suggestions", weekdaysChange.id, "apply"], {})).status).toBe(200);
  expect((await call("admin", ["suggestions", saturdayChange.id, "apply"], {})).status).toBe(200);
  expect(entryNow().weekly).toMatchObject({ monday: [{ from: "08:00", to: "19:00" }], tuesday: [{ from: "08:00", to: "19:00" }], wednesday, saturday: [{ from: "09:00", to: "13:00" }] });
  // Monday changed since the third was suggested: it is refused, and nothing changes.
  const before = activeCalendar(metadata, PROJECT)!.version_id;
  const refused = await call("admin", ["suggestions", mondayChange.id, "apply"], {});
  expect(refused.status).toBe(409);
  expect(refused.body.error?.message).toBe("REPORT_FEEDBACK_APPLY_HOURS_CHANGED");
  expect(activeCalendar(metadata, PROJECT)!.version_id).toBe(before);
  const failed = dataOf<ReportFeedbackState>(await call("admin", [])).feedback.flatMap(item => item.suggestions).find(item => item.id === mondayChange.id)!;
  expect(failed).toMatchObject({ status: "failed", problem: { code: "hours_changed" }, error: "The hours changed since this suggestion. Send your feedback again." });
});

it("treats a repeated request as the same feedback and refuses a different text under the same request id", async () => {
  answers.push({ reply: "Noted.", memory: [{ text: "Cleaners work 7 to 10 pm.", kind: "fact" }] });
  const requestId = crypto.randomUUID();
  const first = await call("admin", [], { requestId, text: "Cleaners work 7 to 10 pm." });
  const second = await call("admin", [], { requestId, text: "Cleaners work 7 to 10 pm." });
  expect(dataOf<{ feedback: FeedbackDto }>(second).feedback.id).toBe(dataOf<{ feedback: FeedbackDto }>(first).feedback.id);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(dataOf<{ state: ReportFeedbackState }>(second).state.memory).toHaveLength(1);
  const conflict = await call("admin", [], { requestId, text: "Something else" });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error?.message).toBe("REPORT_FEEDBACK_REQUEST_CONFLICT");
});

it("keeps the feedback as a note when the AI is not available", async () => {
  const offline = { resolveModel: () => { throw new Error("REPORT_MODEL_NOT_CONFIGURED"); } };
  const text = "Pavilion 2 loses power by day, that's normal.\nIt is on a timer.";
  const viewer = await call("viewer", [], { requestId: crypto.randomUUID(), text }, "POST", offline);
  expect(viewer.status).toBe(200);
  const { feedback, state } = dataOf<{ feedback: FeedbackDto; state: ReportFeedbackState }>(viewer);
  expect(feedback).toMatchObject({ status: "saved", reply: null, suggestions: [], followUpIds: [] });
  expect(state.aiAvailable).toBe(false);
  expect(state.memory).toEqual([expect.objectContaining({ id: feedback.memoryIds[0], text: "Pavilion 2 loses power by day, that's normal. It is on a timer.", kind: "fact", status: "pending" })]);
  // Sent about a point to check, the point goes in front, and the note is cut to the length of the AI's own.
  const about = await call("viewer", [], { requestId: crypto.randomUUID(), text: `That's normal. ${"x".repeat(400)}`, about: { kind: "check", key: `stopped:${meterId}`, title: "Pavilion 2 has stopped reporting" } }, "POST", offline);
  const aboutMemory = dataOf<{ state: ReportFeedbackState }>(about).state.memory[0]!;
  expect(aboutMemory.text.startsWith("“Pavilion 2 has stopped reporting”: That's normal.")).toBe(true);
  expect(aboutMemory.text).toHaveLength(300);
  expect(fetchImpl).not.toHaveBeenCalled();
  // From an administrator it is in use straight away, on one line in the advisor's notes.
  const admin = await call("admin", [], { requestId: crypto.randomUUID(), text }, "POST", offline);
  expect(dataOf<{ state: ReportFeedbackState }>(admin).state.memory[0]!.status).toBe("active");
  expect(notes()).toContain("- 2026-11-18 · Note: Pavilion 2 loses power by day, that's normal. It is on a timer.");
  // AI turned off for the organisation works the same way.
  metadata.energyIq.ai.setSettings("default", { enabled: false }, "admin");
  const off = await give("admin", "Another note");
  expect(dataOf<{ feedback: FeedbackDto }>(off).feedback.status).toBe("saved");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("drops what the AI got wrong and keeps the rest", async () => {
  answers.push({
    reply: "Noted.",
    memory: [{ text: "Store room light is on a sensor.", kind: "fact" }],
    suggestions: [
      { kind: "meter_not_in_use", payload: { meterId: "not-a-real-meter", reason: "Removed" } },
      { kind: "light_count", payload: { meterId, count: 99999 } },
      { kind: "light_count", payload: { meterId, count: 24 } },
    ],
  });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("admin", "There are 24 lights on this meter."));
  expect(feedback.suggestions.map(item => item.payload)).toEqual([{ meterId, meterName, count: 24 }]);
  answers.push("I am not able to answer in JSON today.");
  const unreadable = dataOf<{ feedback: FeedbackDto }>(await give("admin", "Something else"));
  expect(unreadable).toMatchObject({ feedback: { status: "saved", reply: null } });
});

it("changes a meter's settings through the setup draft and makes them live", async () => {
  answers.push({ reply: "Suggesting changes.", suggestions: [
    { kind: "meter_not_in_use", payload: { meterId, reason: "Switched off at the board" } },
    { kind: "light_count", payload: { meterId, count: 24 } },
    { kind: "meter_always_on", payload: { meterId, alwaysOn: true } },
  ] });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("admin", "This meter is off; it feeds 24 lights."));
  expect(feedback.suggestions.map(item => item.label)).toEqual([
    `Mark ${meterName} as not in use (Switched off at the board)`, `Set ${meterName} to 24 lights`, `Mark ${meterName} as always on by design`,
  ]);
  for (const suggestion of feedback.suggestions) expect((await call("admin", ["suggestions", suggestion.id, "apply"], {})).status).toBe(200);
  const row = metadata.energyIq.projectSetup.getDraft({ project_id: PROJECT, user_id: "admin" }).document.meter_mapping!.rows.find(item => item.id === meterId)!;
  expect(row.presentation).toMatchObject({ not_in_use: "Switched off at the board", light_count: "24", always_on: "true" });
  expect(applyProjectChanges).toHaveBeenCalledTimes(3);
});

it("refuses to apply to a meter that is no longer in the setup, and says so", async () => {
  const store = new ReportFeedbackStore(metadata.db);
  store.insertFeedback({
    id: crypto.randomUUID(), projectId: PROJECT, requestId: crypto.randomUUID(), text: "x", about: null, authorUserId: "admin", authorName: "admin",
    createdAt: NOW.toISOString(), status: "processed", reply: "ok", memoryIds: [], followUpIds: [],
    suggestions: [{ id: "gone", kind: "light_count", label: "Set Gone to 3 lights", payload: { meterId: "removed-meter", meterName: "Gone", count: 3 }, status: "open" }],
  });
  const response = await call("admin", ["suggestions", "gone", "apply"], {});
  expect(response.status).toBe(409);
  // A code for the page to word in the reader's language; the English sentence stays with the record.
  expect(response.body.error?.message).toBe("REPORT_FEEDBACK_APPLY_METER_MISSING");
  expect(store.findSuggestion(PROJECT, "gone")?.suggestion).toMatchObject({ status: "failed", problem: { code: "meter_missing", name: "Gone" }, error: "Gone is no longer in this site's setup." });
  expect(applyProjectChanges).not.toHaveBeenCalled();
});

it("records a change that is saved but not live yet as applied, with the reason, and never applies it twice", async () => {
  answers.push({ reply: "ok", suggestions: [{ kind: "light_count", payload: { meterId, count: 8 } }] });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("admin", "8 lights"));
  const failing = vi.fn(async () => { throw new Error("ENERGYIQ_PROJECT_DATA_NOT_READY:SNAPSHOT_MISSING"); });
  const response = await call("admin", ["suggestions", feedback.suggestions[0]!.id, "apply"], {}, "POST", { applyProjectChanges: failing });
  expect(response.status).toBe(200);
  const result = dataOf<{ state: ReportFeedbackState; live: boolean }>(response);
  expect(result.live).toBe(false);
  expect(result.state.feedback[0]!.suggestions[0]).toMatchObject({
    status: "applied", appliedByName: "admin", problem: { code: "not_live", detail: "data_not_ready" },
    error: "The change is saved but not live yet. The site's readings are not ready. Try again later.",
  });
  // The draft holds the change, and the audit history says so.
  const row = metadata.energyIq.projectSetup.getDraft({ project_id: PROJECT, user_id: "admin" }).document.meter_mapping!.rows.find(item => item.id === meterId)!;
  expect(row.presentation?.light_count).toBe("8");
  const audit = metadata.authAuditEvents.list({ categories: ["energyiq.report_"], limit: 50 }).events.find(event => event.event_type === "energyiq.report_feedback_applied");
  expect(JSON.parse(audit!.metadata_json ?? "{}")).toMatchObject({ kind: "light_count", outcome: "saved_not_live" });
  expect((await call("admin", ["suggestions", feedback.suggestions[0]!.id, "apply"], {})).status).toBe(409);
});

it("adds a day off and a new electricity rate from a date", async () => {
  answers.push({ reply: "ok", suggestions: [
    { kind: "holiday", payload: { date: "2026-12-31", label: "Year-end shutdown", closed: true, classification: "special_closure" } },
    { kind: "electricity_rate", payload: { ratePerKwh: 0.2875, effectiveFrom: "2026-12-01" } },
  ] });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("admin", "We shut on 31 Dec. The rate is 28.75 cents from December."));
  expect(feedback.suggestions.map(item => item.label)).toEqual([
    "Add 31 Dec 2026 as a planned closure: Year-end shutdown",
    "Change the electricity rate to SGD 0.2875 per kWh from 1 Dec 2026",
  ]);
  for (const suggestion of feedback.suggestions) expect((await call("admin", ["suggestions", suggestion.id, "apply"], {})).status).toBe(200);
  const day = activeCalendar(metadata, PROJECT)!.entries.find(item => item.owner.kind === "project")!.exceptions!.find(item => item.date === "2026-12-31");
  expect(day).toEqual({ date: "2026-12-31", operating: [], label: "Year-end shutdown", classification: "special_closure" });
  const rates = activeTariff(metadata, PROJECT)!.entries.filter(item => item.owner.kind === "project");
  expect(rates).toHaveLength(2);
  expect(rates[0]).toMatchObject({ rate_per_kwh: 0.25, effective_to: "2026-11-30T16:00:00.000Z" });
  expect(rates[1]).toMatchObject({ rate_per_kwh: 0.2875, effective_from: "2026-11-30T16:00:00.000Z", currency: "SGD", rate_basis: "tax_exclusive", tax: { name: "GST", rate_pct: 9 } });
  expect(rates[1]!.effective_to).toBeUndefined();
});

it("stops flagging a report point once an administrator agrees", async () => {
  answers.push({ reply: "ok", dismissChecks: [{ checkKey: "daytime", title: "Daytime use", reason: "Cleaners work by day" }] });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("viewer", "Daytime use is the cleaners.", {
    about: { kind: "check", key: "daytime", title: "Daytime use" },
    reportContext: { checks: [{ key: "daytime", title: "Daytime use" }], figures: ["1,200 kWh this week"] },
  }));
  expect(feedback.about).toEqual({ kind: "check", key: "daytime", title: "Daytime use" });
  // The card names the point the way the report does, whatever title the page or the AI gave it.
  expect(feedback.suggestions).toEqual([expect.objectContaining({ kind: "dismiss_check", label: "Stop flagging “Daytime use on lighting circuits” in reports", payload: { checkKey: "daytime", title: "Daytime use on lighting circuits", reason: "Cleaners work by day" } })]);
  const prompt = JSON.parse((JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> }).messages[1]!.content) as { user_data: unknown };
  expect(prompt.user_data).toMatchObject({ report_context: { checks: [{ key: "daytime" }], figures: ["1,200 kWh this week"] } });
  const applied = await call("admin", ["suggestions", feedback.suggestions[0]!.id, "apply"], {});
  expect(dataOf<{ state: ReportFeedbackState }>(applied).state.dismissedChecks).toEqual([{ key: "daytime", title: "Daytime use on lighting circuits", reason: "Cleaners work by day", createdAt: NOW.toISOString() }]);
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).dismissedChecks).toEqual([{ key: "daytime", title: "Daytime use on lighting circuits", reason: "Cleaners work by day" }]);
  expect(applyProjectChanges).not.toHaveBeenCalled();
});

it("lets an administrator dismiss a suggestion without changing anything", async () => {
  answers.push({ reply: "ok", suggestions: [{ kind: "light_count", payload: { meterId, count: 8 } }] });
  const { feedback } = dataOf<{ feedback: FeedbackDto }>(await give("viewer", "8 lights"));
  const dismissed = await call("admin", ["suggestions", feedback.suggestions[0]!.id, "dismiss"], {});
  expect(dataOf<{ state: ReportFeedbackState }>(dismissed).state.feedback[0]!.suggestions[0]!.status).toBe("dismissed");
  expect((await call("admin", ["suggestions", feedback.suggestions[0]!.id, "apply"], {})).status).toBe(409);
  expect(applyProjectChanges).not.toHaveBeenCalled();
});

it("lets authors remove their own waiting memory, and only administrators remove anything else", async () => {
  const offline = { resolveModel: () => { throw new Error("REPORT_MODEL_NOT_CONFIGURED"); } };
  const mine = dataOf<{ feedback: FeedbackDto }>(await call("viewer", [], { requestId: crypto.randomUUID(), text: "Mine" }, "POST", offline)).feedback.memoryIds[0]!;
  const active = dataOf<{ feedback: FeedbackDto }>(await call("admin", [], { requestId: crypto.randomUUID(), text: "Known fact" }, "POST", offline)).feedback.memoryIds[0]!;
  expect(notes()).toContain("Note: Known fact");
  expect((await call("viewer2", ["memory", mine], undefined, "DELETE")).status).toBe(403);
  expect((await call("viewer", ["memory", active], undefined, "DELETE")).status).toBe(403);
  expect((await call("viewer", ["memory", mine], undefined, "DELETE")).status).toBe(200);
  const removed = await call("admin", ["memory", active], undefined, "DELETE");
  expect(dataOf<{ state: ReportFeedbackState }>(removed).state.memory).toEqual([]);
  expect(notes()).not.toContain("Known fact");
  expect((await call("admin", ["memory", active], undefined, "DELETE")).status).toBe(404);
});

it("closes and reopens follow-ups, keeping the advisor's notes in step", async () => {
  answers.push({ reply: "ok", followUps: [{ text: "Check lights are off by 7:10.", checkBy: "next_month" }] });
  const { state } = dataOf<{ state: ReportFeedbackState }>(await give("admin", "Lights off at 7:10 now"));
  const id = state.followUps[0]!.id;
  expect(notes()).toContain("Coming up: Follow up: Check lights are off by 7:10.");
  const done = await call("admin", ["follow-ups", id, "status"], { status: "done", note: "Confirmed on site." });
  expect(dataOf<{ state: ReportFeedbackState }>(done).state.followUps[0]).toMatchObject({ status: "done", note: "Confirmed on site." });
  expect(notes()).not.toContain("Follow up: Check lights");
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).followUps).toEqual([expect.objectContaining({ text: "Check lights are off by 7:10.", status: "done" })]);
  await call("admin", ["follow-ups", id, "status"], { status: "open" });
  expect(notes()).toContain("Coming up: Follow up: Check lights are off by 7:10.");
  expect((await call("viewer", ["follow-ups", id, "status"], { status: "dropped" })).status).toBe(403);
  expect((await call("admin", ["follow-ups", id, "status"], { status: "closed" })).status).toBe(422);
});

it("checks open follow-ups against the latest readings when an administrator asks", async () => {
  answers.push({ reply: "ok", followUps: [{ text: "Check lights are off by 7:10.", checkBy: "next_report" }] });
  const { state } = dataOf<{ state: ReportFeedbackState }>(await give("admin", "Lights off at 7:10 now"));
  const id = state.followUps[0]!.id;
  answers.push({ results: [{ id, verdict: "resolved", evidence: "Lighting fell to zero by 7:10 am on all 7 days." }] });
  const loadReviewSummary = vi.fn(async () => ({ days: [{ date: "2026-11-17", kwh: 40 }], checks: [] }));
  const reviewed = await call("admin", ["follow-ups", "review"], {}, "POST", { loadReviewSummary });
  expect(reviewed.status).toBe(200);
  expect(loadReviewSummary).toHaveBeenCalledWith(expect.anything(), PROJECT, [expect.objectContaining({ id })]);
  // A resolved verdict is recorded, but only an administrator closes the follow-up.
  expect(dataOf<{ state: ReportFeedbackState }>(reviewed).state.followUps[0]).toMatchObject({
    id, status: "open", lastCheck: { at: NOW.toISOString(), verdict: "resolved", evidence: "Lighting fell to zero by 7:10 am on all 7 days." },
  });
  const offline = await call("admin", ["follow-ups", "review"], {}, "POST", { loadReviewSummary, resolveModel: () => { throw new Error("REPORT_MODEL_NOT_CONFIGURED"); } });
  expect(offline.status).toBe(503);
});

it("hides everything from people who cannot read the project's reports", async () => {
  expect((await call("outsider", [])).status).toBe(404);
  expect((await give("outsider", "hello")).status).toBe(404);
  const state = await call("viewer", []);
  expect(state.status).toBe(200);
  expect(dataOf<ReportFeedbackState>(state)).toEqual({ canGive: true, canManage: false, aiAvailable: true, feedback: [], memory: [], followUps: [], dismissedChecks: [], reportInputs: { feedbackMemory: [], followUps: [], dismissedChecks: [] } });
  expect(dataOf<ReportFeedbackState>(await call("admin", [])).canManage).toBe(true);
});

it("refuses feedback that is empty, too long or malformed", async () => {
  expect((await give("viewer", "")).status).toBe(422);
  expect((await give("viewer", "x".repeat(2001))).status).toBe(422);
  expect((await call("viewer", [], { requestId: "not-a-uuid", text: "hi" })).status).toBe(422);
  expect((await give("viewer", "hi", { reportContext: { checks: Array.from({ length: 41 }, (_, index) => ({ key: `k${index}`, title: "t" })), figures: [] } })).status).toBe(422);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("limits how much feedback someone who is not an administrator can send", async () => {
  const offline = { resolveModel: () => { throw new Error("REPORT_MODEL_NOT_CONFIGURED"); } };
  for (let index = 0; index < RATE_LIMITS.perPersonShort.count; index += 1) {
    expect((await call("viewer", [], { requestId: crypto.randomUUID(), text: `Note ${index}` }, "POST", offline)).status).toBe(200);
  }
  const limited = await call("viewer", [], { requestId: crypto.randomUUID(), text: "One more" }, "POST", offline);
  expect(limited.status).toBe(429);
  expect(limited.body.error?.message).toBe("REPORT_FEEDBACK_RATE_LIMITED");
  // Someone else, and an administrator, can still send.
  expect((await call("viewer2", [], { requestId: crypto.randomUUID(), text: "Mine" }, "POST", offline)).status).toBe(200);
  expect((await call("admin", [], { requestId: crypto.randomUUID(), text: "Admin note" }, "POST", offline)).status).toBe(200);
  // Ten minutes later the same person can send again.
  const later = { ...offline, now: () => new Date(NOW.getTime() + 11 * 60_000) };
  expect((await call("viewer", [], { requestId: crypto.randomUUID(), text: "Later" }, "POST", later)).status).toBe(200);
});

it("refuses new feedback rather than pushing out what others are waiting on", async () => {
  const offline = { resolveModel: () => { throw new Error("REPORT_MODEL_NOT_CONFIGURED"); } };
  const store = new ReportFeedbackStore(metadata.db);
  for (let index = 0; index < MAX_PENDING_MEMORY; index += 1) {
    store.addMemory(PROJECT, { text: `waiting ${index}`, kind: "fact", status: "pending", authorUserId: `someone-${index}`, authorName: "Someone", sourceFeedbackId: null });
  }
  const refused = await call("viewer", [], { requestId: crypto.randomUUID(), text: "Mine" }, "POST", offline);
  expect(refused.status).toBe(409);
  expect(refused.body.error?.message).toBe("REPORT_FEEDBACK_FULL");
  expect(store.listMemory(PROJECT, ["pending"])).toHaveLength(MAX_PENDING_MEMORY);
  // An administrator's feedback is in use straight away and needs no room among the waiting.
  expect((await call("admin", [], { requestId: crypto.randomUUID(), text: "Admin note" }, "POST", offline)).status).toBe(200);
});

it("answers a repeat that arrives while the AI is still reading with 'still processing', then with the finished feedback", async () => {
  let release: (value: Response) => void = () => undefined;
  fetchImpl.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
  const requestId = crypto.randomUUID();
  const first = call("viewer", [], { requestId, text: "The fan must never run." });
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  const repeat = await call("viewer", [], { requestId, text: "The fan must never run." });
  expect(repeat.status).toBe(409);
  expect(repeat.body.error?.message).toBe("REPORT_FEEDBACK_STILL_PROCESSING");
  expect(dataOf<ReportFeedbackState>(await call("viewer", [])).feedback[0]).toMatchObject({ status: "processing", reply: null });
  release(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "Noted.", memory: [{ text: "The fan must never run.", kind: "rule" }] }) } }] })));
  expect((await first).status).toBe(200);
  const finished = await call("viewer", [], { requestId, text: "The fan must never run." });
  expect(dataOf<{ feedback: FeedbackDto }>(finished).feedback).toMatchObject({ status: "processed", reply: "Noted." });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("keeps feedback the server stopped reading part-way as a note", async () => {
  const store = new ReportFeedbackStore(metadata.db);
  store.insertFeedback({
    id: "cut-off", projectId: PROJECT, requestId: crypto.randomUUID(), text: "Lights go off at 7:10", about: null, authorRole: "member",
    authorUserId: "viewer", authorName: "viewer", createdAt: new Date(NOW.getTime() - STALE_PROCESSING_MS - 1000).toISOString(),
    status: "processing", reply: null, memoryIds: [], followUpIds: [], suggestions: [],
  });
  const state = dataOf<ReportFeedbackState>(await call("viewer", []));
  expect(state.feedback[0]).toMatchObject({ id: "cut-off", status: "saved", reply: null });
  expect(state.memory).toEqual([expect.objectContaining({ id: state.feedback[0]!.memoryIds[0], text: "Lights go off at 7:10", status: "pending" })]);
});

it("gives report feedback in the project information only to people who may read the reports", () => {
  const role = metadata.energyIq.roles.create({ id: "facility-reader", name: "Facility reader", permissions: { facility: "read" } });
  metadata.users.createPasswordUser({ id: "facility", email: "facility@example.test" });
  metadata.workspaceMemberships.upsert({ workspace_id: "default", user_id: "facility", role: "member", role_id: role.id });
  new ReportFeedbackStore(metadata.db).addMemory(PROJECT, { text: "The fan must never run.", kind: "rule", status: "active", authorUserId: "admin", authorName: "admin", sourceFeedbackId: null }, NOW);
  const information = readEnergyProjectInformation(metadata, "facility", "default", PROJECT);
  expect(information.meters.length).toBeGreaterThan(0);
  expect(information).toMatchObject({ feedbackMemory: [], followUps: [], dismissedChecks: [] });
  expect(readEnergyProjectInformation(metadata, "viewer", "default", PROJECT).feedbackMemory).toEqual([{ text: "The fan must never run.", date: "2026-11-18" }]);
});

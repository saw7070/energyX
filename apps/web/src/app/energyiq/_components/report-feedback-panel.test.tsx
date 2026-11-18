/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EnergyReview } from "@datafoundry/site-report";
import { configApi, ConfigApiError } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { ReportFeedbackPanel, type FeedbackFocusRequest } from "./report-feedback-panel";
import type { FeedbackDto, ReportFeedbackState } from "./report-feedback-model";

// The signed-in reader; the panel only reads their id (authors may remove their own pending memory).
const who = vi.hoisted(() => ({ value: { access: { role: "viewer", user: { id: "u-charles" } } } as { access: { role: string; user: { id: string } } | null } }));
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => who.value }));

const suggestion = { id: "s1", kind: "operating_hours" as const, label: "Change lights-off to 7:10 am, every day", payload: { weekly: {} }, status: "open" as const };
const first: FeedbackDto = {
  id: "f1", text: "The lights go off at 7:10, not 6:45", about: null, authorUserId: "u-charles", authorName: "Charles", createdAt: "2026-11-17T02:00:00Z",
  status: "processed", reply: "I will remember that the lights go off at 7:10 am.", memoryIds: ["m1"], followUpIds: ["fu1"], suggestions: [suggestion],
};
const stateWith = (over: Partial<ReportFeedbackState> = {}): ReportFeedbackState => ({
  canGive: true, canManage: false, aiAvailable: true,
  feedback: [first],
  memory: [
    { id: "m2", text: "Pavilion 2 loses power by day; that is normal", kind: "explanation", status: "pending", authorUserId: "u-charles", authorName: "Charles", createdAt: "2026-11-17T03:00:00Z", sourceFeedbackId: null },
    { id: "m1", text: "The lights go off at 7:10 am", kind: "fact", status: "active", authorUserId: "u-admin", authorName: "Andrew", createdAt: "2026-11-17T02:00:00Z", sourceFeedbackId: "f1" },
  ],
  followUps: [
    { id: "fu1", text: "Check the pavilion fan never runs", checkBy: "next_report", status: "open", createdAt: "2026-11-17T02:00:00Z", sourceFeedbackId: "f1", lastCheck: { at: "2026-11-18T01:00:00Z", verdict: "resolved", evidence: "The fan used nothing on any day." } },
    { id: "fu2", text: "See whether the gate lights were fixed", checkBy: "next_month", status: "done", createdAt: "2026-11-01T02:00:00Z", sourceFeedbackId: null },
  ],
  dismissedChecks: [],
  ...over,
});

type Call = { path: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let server: (call: Call) => unknown = () => stateWith();
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls = [];
  vi.spyOn(configApi, "reportFeedbackRequest").mockImplementation(async (_projectId: string, path = "", init?: RequestInit) => {
    const call: Call = { path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined };
    calls.push(call);
    return server(call) as never;
  });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear();
  who.value = { access: { role: "viewer", user: { id: "u-charles" } } };
  server = () => stateWith();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

type PanelProps = Parameters<typeof ReportFeedbackPanel>[0];
const element = (props: Partial<PanelProps> = {}) => <ReportFeedbackPanel projectId="sktc" {...props} />;
const render = async (props: Partial<PanelProps> = {}, locale?: string) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  if (locale) localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  await act(async () => root.render(locale ? <EnergyIqLocaleProvider>{element(props)}</EnergyIqLocaleProvider> : element(props)));
  await settle();
};
const settle = async () => { for (let index = 0; index < 4; index += 1) await act(async () => { await Promise.resolve(); }); };
const buttons = () => Array.from(host.querySelectorAll("button"));
const button = (name: string, within: ParentNode = host) => Array.from(within.querySelectorAll("button")).find(item => item.textContent?.trim() === name || item.getAttribute("aria-label") === name);
const click = async (target: HTMLElement | undefined) => { expect(target).toBeTruthy(); await act(async () => target!.click()); await settle(); };
const card = (text: string) => Array.from(host.querySelectorAll("li")).find(item => item.textContent?.includes(text))!;
const textarea = () => host.querySelector("textarea")!;
const type = async (value: string) => { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), value);
  textarea().dispatchEvent(new Event("input", { bubbles: true }));
}); };
const submit = async () => { await act(async () => host.querySelector("form")!.requestSubmit()); await settle(); };

it("shows the reply, suggestions, memory and follow-ups to a reader who is not an admin, with nothing to apply", async () => {
  await render();
  expect(calls).toEqual([{ path: "", method: "GET", body: undefined }]);
  expect(host.querySelector("h2")?.textContent).toBe("Tell the AI about this report");
  expect(textarea().placeholder).toContain("The lights go off at 7:10, not 6:45");
  expect(host.textContent).toContain("Change lights-off to 7:10 am, every day");
  expect(card("Change lights-off").textContent).toContain("Hours");
  expect(card("Change lights-off").textContent).toContain("An admin can apply this.");
  expect(button("Apply")).toBeUndefined();
  expect(button("Dismiss")).toBeUndefined();
  // Memory: the pending note waits for an admin; its author may remove it, not approve it.
  expect(card("Pavilion 2 loses power").textContent).toContain("Waiting for an admin");
  expect(button("Approve", card("Pavilion 2 loses power"))).toBeUndefined();
  expect(button("Remove", card("Pavilion 2 loses power"))).toBeTruthy();
  // Somebody else's active memory cannot be removed by a reader.
  expect(button("Remove", card("The lights go off at 7:10 am"))).toBeUndefined();
  // Follow-ups: the last check and its evidence, but no admin buttons.
  expect(card("pavilion fan").textContent).toContain("Checked 18 Nov 2026: Looks resolved. The fan used nothing on any day.");
  expect(card("pavilion fan").textContent).toContain("Check at the next report");
  expect(card("gate lights").textContent).toContain("Done");
  expect(button("Mark done")).toBeUndefined();
  expect(button("Check follow-ups now")).toBeUndefined();
  expect(host.querySelector("details summary")?.textContent).toBe("Earlier feedback (1)");
});

it("sends the feedback once per request id with the report's checks and figures, then shows the AI's reply", async () => {
  const review = {
    checks: [{ key: "noUse:m7", title: "Pavilion 2 used nothing by day", text: "Check its supply." }, { title: "An older check without a key", text: "" }],
    summary: { figures: [{ value: "48.7", unit: "kWh", label: "Average day", target: "total" }], answers: [{ id: "total", question: "How much electricity?", answer: "About 49 kWh a day." }] },
  } as unknown as EnergyReview;
  const reply: FeedbackDto = { ...first, id: "f2", text: "Pavilion 2 loses power by day, that's normal", reply: "Noted. I will stop flagging Pavilion 2.", suggestions: [] };
  let fail = true;
  server = call => {
    if (call.method === "GET") return stateWith();
    if (fail) { fail = false; throw new ConfigApiError("INTERNAL_ERROR", "Failed to fetch", 0); }
    return { feedback: reply, state: stateWith({ feedback: [reply, first] }) };
  };
  await render({ review });
  expect((button("Send") as HTMLButtonElement).disabled).toBe(true);
  await type("  Pavilion 2 loses power by day, that's normal  ");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  // The text stays for another try, which reuses the same request id so the server never saves it twice.
  expect(textarea().value).toContain("Pavilion 2");
  await submit();
  const posts = calls.filter(call => call.method === "POST");
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body!.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(posts[1]!.body!.requestId).toBe(posts[0]!.body!.requestId);
  expect(posts[1]!.body).toEqual({
    requestId: posts[0]!.body!.requestId,
    text: "Pavilion 2 loses power by day, that's normal",
    reportContext: { checks: [{ key: "noUse:m7", title: "Pavilion 2 used nothing by day" }], figures: ["Average day: 48.7 kWh", "How much electricity? About 49 kWh a day."] },
  });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("The AI saysNoted. I will stop flagging Pavilion 2.");
  expect(textarea().value).toBe("");
  expect(host.querySelector("details summary")?.textContent).toBe("Earlier feedback (2)");
});

it("lets an admin apply a change, then reads the state again and reloads the report", async () => {
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  const applied = stateWith({ canManage: true, feedback: [{ ...first, suggestions: [{ ...suggestion, status: "applied", appliedAt: "2026-11-18T04:00:00Z", appliedByName: "Andrew" }] }] });
  server = call => call.method === "GET" ? (calls.filter(item => item.method === "GET").length > 1 ? applied : stateWith({ canManage: true }))
    : call.path === "suggestions/s1/apply" ? { state: applied, applied: "Lights-off is now 7:10 am, every day." } : (() => { throw new Error("unexpected"); })();
  const onSiteChanged = vi.fn();
  await render({ onSiteChanged });
  expect(card("Change lights-off").textContent).not.toContain("An admin can apply this.");
  expect(button("Dismiss")).toBeTruthy();
  await click(button("Apply"));
  expect(calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["suggestions/s1/apply"]);
  // Read again after applying, and the report is rebuilt from the new settings.
  expect(calls.filter(call => call.method === "GET")).toHaveLength(2);
  expect(onSiteChanged).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Done: Lights-off is now 7:10 am, every day.");
  expect(card("Change lights-off").textContent).toContain("Applied by Andrew on 18 Nov 2026.");
  expect(button("Apply")).toBeUndefined();
});

it("says why a change could not be applied and lets an admin dismiss it", async () => {
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  const failed = stateWith({ canManage: true, feedback: [{ ...first, suggestions: [{ ...suggestion, status: "failed", error: "The operating hours changed since this was suggested." }] }] });
  let applyTried = false;
  server = call => {
    if (call.method === "GET") return applyTried ? failed : stateWith({ canManage: true });
    if (call.path === "suggestions/s1/apply") { applyTried = true; throw new ConfigApiError("CONFLICT", "The operating hours changed since this was suggested.", 409); }
    if (call.path === "suggestions/s1/dismiss") return { state: stateWith({ canManage: true, feedback: [{ ...first, suggestions: [{ ...suggestion, status: "dismissed" }] }] }) };
    throw new Error("unexpected");
  };
  const onSiteChanged = vi.fn();
  await render({ onSiteChanged });
  await click(button("Apply"));
  expect(onSiteChanged).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  expect(card("Change lights-off").textContent).toContain("Could not apply: The operating hours changed since this was suggested.");
  await click(button("Dismiss"));
  expect(card("Change lights-off").textContent).toContain("Dismissed.");
  expect(button("Apply")).toBeUndefined();
});

it("lets an admin approve or remove pending memory, and an author remove only their own", async () => {
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  const approved = stateWith({ canManage: true, memory: stateWith().memory.map(item => ({ ...item, status: "active" as const })) });
  server = call => call.method === "GET" ? stateWith({ canManage: true })
    : call.path === "memory/m2/approve" ? { state: approved }
      : call.path === "memory/m1" && call.method === "DELETE" ? { state: stateWith({ canManage: true, memory: [approved.memory[0]!] }) } : (() => { throw new Error("unexpected"); })();
  await render();
  await click(button("Approve: Pavilion 2 loses power by day; that is normal"));
  expect(card("Pavilion 2 loses power").textContent).not.toContain("Waiting for an admin");
  expect(button("Approve")).toBeUndefined();
  // An admin may remove any memory.
  await click(button("Remove: The lights go off at 7:10 am"));
  expect(calls.filter(call => call.method !== "GET").map(call => `${call.method} ${call.path}`)).toEqual(["POST memory/m2/approve", "DELETE memory/m1"]);
  expect(host.textContent).not.toContain("The lights go off at 7:10 am");
});

it("lets the author remove their pending memory", async () => {
  server = call => call.method === "GET" ? stateWith() : call.path === "memory/m2" ? { state: stateWith({ memory: [stateWith().memory[1]!] }) } : (() => { throw new Error("unexpected"); })();
  await render();
  await click(button("Remove", card("Pavilion 2 loses power")));
  expect(calls.at(-1)).toEqual({ path: "memory/m2", method: "DELETE", body: undefined });
  expect(host.textContent).not.toContain("Pavilion 2 loses power");
});

it("lets an admin close, drop, reopen and re-check follow-ups", async () => {
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  server = call => call.method === "GET" ? stateWith({ canManage: true }) : { state: stateWith({ canManage: true }) };
  await render();
  expect(card("pavilion fan").textContent).toContain("The AI thinks this is resolved. Mark it done if you agree.");
  await click(button("Mark done: Check the pavilion fan never runs"));
  await click(button("Drop: Check the pavilion fan never runs"));
  await click(button("Reopen: See whether the gate lights were fixed"));
  await click(button("Check follow-ups now"));
  expect(calls.filter(call => call.method === "POST").map(call => [call.path, call.body])).toEqual([
    ["follow-ups/fu1/status", { status: "done" }],
    ["follow-ups/fu1/status", { status: "dropped" }],
    ["follow-ups/fu2/status", { status: "open" }],
    ["follow-ups/review", undefined],
  ]);
  expect(host.textContent).toContain("Checked. The latest result is under each follow-up.");
});

it("comes into view about a point to check, sends it with the feedback, and the chip can be removed", async () => {
  const reply: FeedbackDto = { ...first, id: "f3", text: "It is the cleaners", about: { kind: "check", key: "daytime", title: "Lights on in the daytime" }, suggestions: [] };
  server = call => call.method === "GET" ? stateWith() : { feedback: reply, state: stateWith({ feedback: [reply, first] }) };
  await render();
  const scroll = vi.fn();
  host.querySelector("section")!.scrollIntoView = scroll;
  const request: FeedbackFocusRequest = { about: { kind: "check", key: "daytime", title: "Lights on in the daytime" }, nonce: 1 };
  await act(async () => root.render(element({ focusRequest: request })));
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(textarea());
  expect(host.textContent).toContain("About: Lights on in the daytime");
  await type("It is the cleaners");
  await submit();
  expect(calls.at(-1)!.body).toMatchObject({ text: "It is the cleaners", about: { kind: "check", key: "daytime", title: "Lights on in the daytime" } });
  // Sent: the chip goes with the text. Asking again about the same check brings it back; × takes it off.
  expect(host.querySelector("form")!.textContent).not.toContain("About: Lights on in the daytime");
  await act(async () => root.render(element({ focusRequest: { ...request, nonce: 2 } })));
  expect(host.querySelector("form")!.textContent).toContain("About: Lights on in the daytime");
  await click(button("Remove “about Lights on in the daytime”"));
  expect(host.querySelector("form")!.textContent).not.toContain("About:");
});

it("still saves the text as a note when the AI is off", async () => {
  const saved: FeedbackDto = { ...first, id: "f4", text: "The fan in Pavilion 2 must never run", status: "saved", reply: null, memoryIds: ["m9"], followUpIds: [], suggestions: [] };
  const off = stateWith({ aiAvailable: false });
  server = call => call.method === "GET" ? off : { feedback: saved, state: { ...off, feedback: [saved, first], memory: [{ ...off.memory[0]!, id: "m9", text: saved.text }, ...off.memory] } };
  await render();
  expect(host.textContent).toContain("The AI is off. Your feedback is still saved as a note.");
  await type("The fan in Pavilion 2 must never run");
  await submit();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Saved as a note. The AI is off, so no suggestions this time.");
  // Written by a reader who is not an admin: it waits for an admin.
  expect(host.querySelector('[role="status"]')?.textContent).toContain("waits for an admin");
});

it("shows nothing to a reader who may not give feedback", async () => {
  server = () => stateWith({ canGive: false });
  await render();
  expect(host.innerHTML).toBe("");
});

it("hides when the reports are closed to this reader", async () => {
  server = () => { throw new ConfigApiError("FORBIDDEN", "FORBIDDEN", 403); };
  await render();
  expect(host.innerHTML).toBe("");
});

it("says when the feedback could not load and tries again", async () => {
  let fail = true;
  server = () => { if (fail) { fail = false; throw new ConfigApiError("INTERNAL_ERROR", "Internal Server Error", 500); } return stateWith({ feedback: [], memory: [], followUps: [] }); };
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click(button("Try again"));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Nothing yet. Tell the AI something the report should know");
});

it("speaks the reader's language", async () => {
  await render({}, "zh-Hans");
  expect(host.querySelector("h2")?.textContent).toBe("就这份报告告诉 AI");
  expect(card("Pavilion 2 loses power").textContent).toContain("等待管理员批准");
  await act(async () => root.unmount()); host.remove(); localStorage.clear();
  await render({}, "ms");
  expect(host.querySelector("h2")?.textContent).toBe("Beritahu AI tentang laporan ini");
  expect(card("Change lights-off").textContent).toContain("Pentadbir boleh menggunakan perubahan ini.");
  expect(buttons().length).toBeGreaterThan(0);
});

it("shows follow-ups from people who are not admins as waiting, and lets an admin approve or drop them", async () => {
  const waiting = { id: "fu3", text: "Check the store room light", checkBy: "next_report" as const, status: "pending" as const, createdAt: "2026-11-18T01:00:00Z", sourceFeedbackId: "f1" };
  const made = { id: "fu4", text: "An old follow-up", checkBy: "next_report" as const, status: "dropped" as const, createdAt: "2026-10-01T01:00:00Z", closedAt: "2026-11-18T01:00:00Z", closedReason: "made_room" as const, sourceFeedbackId: null };
  server = () => stateWith({ followUps: [...stateWith().followUps, waiting, made] });
  await render();
  expect(card("store room light").textContent).toContain("Waiting for an admin");
  expect(button("Approve", card("store room light"))).toBeUndefined();
  expect(card("An old follow-up").textContent).toContain("Dropped to make room for newer follow-ups.");
  await act(async () => root.unmount()); host.remove();
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  server = call => call.method === "GET" ? stateWith({ canManage: true, followUps: [...stateWith().followUps, waiting] }) : { state: stateWith({ canManage: true }) };
  await render();
  await click(button("Approve: Check the store room light"));
  expect(calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["follow-ups/fu3/approve"]);
});

it("says in the reader's language why a change could not be applied, or that it is saved but not live yet", async () => {
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  const failed = { ...suggestion, id: "s2", status: "failed" as const, error: "Pavilion 2 is no longer in this site's setup.", problem: { code: "meter_missing" as const, name: "Pavilion 2" } };
  const notLive = { ...suggestion, id: "s3", label: "Set Pavilion 3 to 8 lights", kind: "light_count" as const, payload: { meterId: "m3", meterName: "Pavilion 3", count: 8 }, status: "applied" as const, appliedAt: "2026-11-18T04:00:00Z", appliedByName: "Andrew",
    error: "The change is saved but not live yet. The site's readings are not ready. Try again later.", problem: { code: "not_live" as const, detail: "data_not_ready" as const } };
  server = () => stateWith({ canManage: true, feedback: [{ ...first, suggestions: [failed, notLive] }] });
  await render({}, "zh-Hans");
  expect(card("Pavilion 2 已不在").textContent).toContain("无法应用：Pavilion 2 已不在此场地的设置中。");
  expect(card("Pavilion 3").textContent).toContain("更改已保存，但尚未生效。此场地的读数还没有准备好。请稍后再试。");
  expect(host.textContent).not.toContain("no longer in this site's setup");
});

it("tells an admin when an applied change is saved but not live yet", async () => {
  who.value = { access: { role: "admin", user: { id: "u-admin" } } };
  const applied = stateWith({ canManage: true, feedback: [{ ...first, suggestions: [{ ...suggestion, status: "applied", appliedAt: "2026-11-18T04:00:00Z", appliedByName: "Andrew", problem: { code: "not_live", detail: "admin_required" } }] }] });
  server = call => call.method === "GET" ? (calls.filter(item => item.method === "GET").length > 1 ? applied : stateWith({ canManage: true }))
    : { state: applied, applied: "Change lights-off to 7:10 am, every day", live: false };
  await render();
  await click(button("Apply"));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Saved, but not live yet: Change lights-off to 7:10 am, every day. Only a platform admin can make changes live.");
  expect(card("Change lights-off").textContent).toContain("Applied by Andrew on 18 Nov 2026. The change is saved but not live yet. Only a platform admin can make changes live.");
});

it("says the AI is still reading when the same feedback is sent again too soon, and shows where it stands", async () => {
  const reading: FeedbackDto = { ...first, id: "f5", text: "Still being read", status: "processing", reply: null, suggestions: [] };
  let posted = false;
  server = call => {
    if (call.method === "GET") return posted ? stateWith({ feedback: [reading, first] }) : stateWith();
    posted = true;
    throw new ConfigApiError("CONFLICT", "REPORT_FEEDBACK_STILL_PROCESSING", 409);
  };
  await render();
  await type("Still being read");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("The AI is still reading your feedback. It will show here in a minute.");
  expect(textarea().value).toBe("Still being read");
  expect(calls.filter(call => call.method === "GET")).toHaveLength(2);
  expect(host.querySelector("details")!.textContent).toContain("The AI is still reading this.");
});

it("says plainly when someone has sent too much feedback", async () => {
  server = call => { if (call.method === "GET") return stateWith(); throw new ConfigApiError("RATE_LIMITED", "REPORT_FEEDBACK_RATE_LIMITED", 429); };
  await render({}, "ms");
  await type("Satu lagi");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Anda telah menghantar banyak maklum balas sebentar tadi. Tunggu beberapa minit dan cuba lagi.");
});

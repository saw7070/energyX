import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MAX_ACTIVE_MEMORY,
  MAX_FEEDBACK,
  MAX_OPEN_FOLLOW_UPS,
  MAX_PENDING_MEMORY,
  ReportFeedbackStore,
  type FeedbackRecord,
} from "./report-feedback-store.js";

let db: DatabaseSync;
let store: ReportFeedbackStore;
beforeEach(() => { db = new DatabaseSync(":memory:"); store = new ReportFeedbackStore(db); });
afterEach(() => db.close());

const feedback = (overrides: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  id: crypto.randomUUID(), projectId: "p", requestId: crypto.randomUUID(), text: "The lights go off at 7:10", about: null,
  authorUserId: "u", authorName: "U", createdAt: new Date().toISOString(), status: "saved", reply: null, memoryIds: [], followUpIds: [], suggestions: [],
  ...overrides,
});
const memoryInput = (text: string, status: "active" | "pending" = "active") => ({ text, kind: "fact" as const, status, authorUserId: "u", authorName: "U", sourceFeedbackId: null });

it("keeps one feedback per person and request, and hands the first one back on a repeat", () => {
  const first = feedback({ requestId: "r1" });
  expect(store.insertFeedback(first).created).toBe(true);
  const again = store.insertFeedback(feedback({ requestId: "r1", text: "different" }));
  expect(again.created).toBe(false);
  expect(again.record.id).toBe(first.id);
  // Another person may use the same request id without seeing the first person's feedback.
  expect(store.insertFeedback(feedback({ requestId: "r1", authorUserId: "other" })).created).toBe(true);
  // Projects never share feedback.
  expect(store.listFeedback("other-project")).toEqual([]);
});

it("keeps the newest feedback within the limit and finds suggestions by id", () => {
  const ids: string[] = [];
  for (let index = 0; index < MAX_FEEDBACK + 5; index += 1) {
    const record = feedback({ text: `#${index}`, suggestions: index === MAX_FEEDBACK + 4 ? [{ id: "s1", kind: "dismiss_check", label: "Stop", payload: {}, status: "open" }] : [] });
    store.insertFeedback(record);
    ids.push(record.id);
  }
  const kept = store.listFeedback("p", 1000);
  expect(kept).toHaveLength(MAX_FEEDBACK);
  expect(kept[0]!.text).toBe(`#${MAX_FEEDBACK + 4}`);
  expect(store.getFeedback("p", ids[0]!)).toBeUndefined();
  expect(store.findSuggestion("p", "s1")?.suggestion.label).toBe("Stop");
  store.updateSuggestion("p", "s1", current => ({ ...current, status: "dismissed" }));
  expect(store.findSuggestion("p", "s1")?.suggestion.status).toBe("dismissed");
  expect(() => store.updateSuggestion("p", "missing", current => current)).toThrow("REPORT_FEEDBACK_NOT_FOUND");
});

it("sets aside the oldest active memory past the limit and tells the caller which", () => {
  for (let index = 0; index < MAX_ACTIVE_MEMORY; index += 1) store.addMemory("p", memoryInput(`fact ${index}`));
  const { evicted } = store.addMemory("p", memoryInput("newest"));
  expect(evicted.map(item => item.text)).toEqual(["fact 0"]);
  expect(store.listMemory("p", ["active"])).toHaveLength(MAX_ACTIVE_MEMORY);
  expect(store.listMemory("p", ["active"])[0]!.text).toBe("newest");
  expect(store.listMemory("p", ["removed"]).map(item => item.text)).toEqual(["fact 0"]);
});

it("keeps waiting memory out of the reports until it is approved", () => {
  const { memory } = store.addMemory("p", memoryInput("waiting", "pending"));
  store.addMemory("p", memoryInput("known"));
  expect(store.reportInputs("p").feedbackMemory.map(item => item.text)).toEqual(["known"]);
  const activated = store.activateMemory("p", memory.id);
  expect(activated.memory.status).toBe("active");
  expect(activated.memory.activatedAt).toBeTruthy();
  expect(store.reportInputs("p").feedbackMemory.map(item => item.text).sort()).toEqual(["known", "waiting"]);
  // Waiting memory has its own limit, so one person cannot crowd out the rest.
  for (let index = 0; index < MAX_PENDING_MEMORY + 2; index += 1) store.addMemory("p", memoryInput(`wait ${index}`, "pending"));
  expect(store.listMemory("p", ["pending"])).toHaveLength(MAX_PENDING_MEMORY);
});

it("dates memory in the site's own time zone for the reports", () => {
  const { memory } = store.addMemory("p", memoryInput("late at night"), new Date("2026-11-18T20:00:00Z"));
  expect(memory.activatedAt).toBe("2026-11-18T20:00:00.000Z");
  expect(store.reportInputs("p", new Date("2026-11-19T00:00:00Z"), "Asia/Singapore").feedbackMemory).toEqual([{ text: "late at night", date: "2026-11-19" }]);
});

it("drops the oldest open follow-up past the limit and lists open ones first, then the latest closed", () => {
  const start = Date.parse("2026-11-01T00:00:00Z");
  for (let index = 0; index < MAX_OPEN_FOLLOW_UPS; index += 1) store.addFollowUp("p", { text: `check ${index}`, checkBy: "next_report", sourceFeedbackId: null, authorUserId: "u" }, new Date(start + index * 60_000));
  const { evicted } = store.addFollowUp("p", { text: "newest", checkBy: "next_month", sourceFeedbackId: null, authorUserId: "u" }, new Date(start + 3_600_000));
  expect(evicted.map(item => item.text)).toEqual(["check 0"]);
  expect(evicted[0]!.status).toBe("dropped");
  const state = store.state("p", { canGive: true, canManage: false, aiAvailable: false });
  expect(state.followUps.filter(item => item.status === "open")).toHaveLength(MAX_OPEN_FOLLOW_UPS);
  expect(state.followUps[0]!.text).toBe("newest");
  expect(state.followUps.at(-1)).toMatchObject({ text: "check 0", status: "dropped" });
  // The DTO never carries the server's own bookkeeping.
  expect(Object.keys(state.followUps[0]!).sort()).toEqual(["checkBy", "createdAt", "id", "sourceFeedbackId", "status", "text"]);
});

it("gives the reports open follow-ups and those closed in the last 31 days", () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const old = store.addFollowUp("p", { text: "old", checkBy: "next_report", sourceFeedbackId: null, authorUserId: "u" }, now).followUp;
  store.saveFollowUp({ ...old, status: "done", closedAt: "2026-10-01T00:00:00Z" });
  const recent = store.addFollowUp("p", { text: "recent", checkBy: "next_report", sourceFeedbackId: null, authorUserId: "u" }, now).followUp;
  store.saveFollowUp({ ...recent, status: "dropped", closedAt: "2026-11-10T00:00:00Z", lastCheck: { at: "2026-11-09T00:00:00Z", verdict: "resolved", evidence: "Off by 7:10" } });
  store.addFollowUp("p", { text: "open", checkBy: "next_month", sourceFeedbackId: null, authorUserId: "u" }, now);
  expect(store.reportInputs("p", now).followUps).toEqual([
    { text: "open", status: "open", createdAt: now.toISOString() },
    { text: "recent", status: "dropped", createdAt: now.toISOString(), lastCheck: { at: "2026-11-09T00:00:00Z", verdict: "resolved", evidence: "Off by 7:10" } },
  ]);
});

it("keeps one dismissed record per report point", () => {
  store.dismissCheck("p", { key: "daytime", title: "Daytime use", reason: "Cleaners", suggestionId: "s1" });
  store.dismissCheck("p", { key: "daytime", title: "Daytime use", reason: "Cleaners work by day", suggestionId: "s2" });
  expect(store.listDismissed("p")).toHaveLength(1);
  expect(store.reportInputs("p").dismissedChecks).toEqual([{ key: "daytime", title: "Daytime use", reason: "Cleaners work by day" }]);
  expect(store.state("p", { canGive: true, canManage: true, aiAvailable: true }).dismissedChecks[0]).toEqual({ key: "daytime", title: "Daytime use", reason: "Cleaners work by day", createdAt: expect.any(String) });
});

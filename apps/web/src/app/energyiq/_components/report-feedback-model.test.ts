import { afterEach, expect, it, vi } from "vitest";
import type { EnergyReview } from "@datafoundry/site-report";
import { configApi } from "../../../lib/config-api";
import { readingsFromFeedback, reportContextOf, reportFeedbackApi, suggestionsOf, type ReportFeedbackState, type SuggestionDto } from "./report-feedback-model";
import type { SiteReport } from "./site-report-model";

afterEach(() => { vi.restoreAllMocks(); });

const state = (over: Partial<ReportFeedbackState> = {}): ReportFeedbackState => ({
  canGive: true, canManage: true, aiAvailable: true, feedback: [], memory: [], followUps: [], dismissedChecks: [], ...over,
});

it("calls the report-feedback routes the API serves", async () => {
  const request = vi.spyOn(configApi, "reportFeedbackRequest").mockResolvedValue({} as never);
  await reportFeedbackApi.state("p 1");
  await reportFeedbackApi.send("p 1", { requestId: "r", text: "Hello" });
  await reportFeedbackApi.applySuggestion("p 1", "s/1");
  await reportFeedbackApi.dismissSuggestion("p 1", "s1");
  await reportFeedbackApi.approveMemory("p 1", "m1");
  await reportFeedbackApi.removeMemory("p 1", "m1");
  await reportFeedbackApi.setFollowUpStatus("p 1", "f1", "done", "Fixed on site");
  await reportFeedbackApi.reviewFollowUps("p 1");
  expect(request.mock.calls.map(([project, path, init]) => [project, path, init?.method ?? "GET", init?.body ?? null])).toEqual([
    ["p 1", "", "GET", null],
    ["p 1", "", "POST", JSON.stringify({ requestId: "r", text: "Hello" })],
    ["p 1", "suggestions/s%2F1/apply", "POST", null],
    ["p 1", "suggestions/s1/dismiss", "POST", null],
    ["p 1", "memory/m1/approve", "POST", null],
    ["p 1", "memory/m1", "DELETE", null],
    ["p 1", "follow-ups/f1/status", "POST", JSON.stringify({ status: "done", note: "Fixed on site" })],
    ["p 1", "follow-ups/review", "POST", null],
  ]);
});

it("sends the review's keyed checks and figures within the API's limits", () => {
  const long = "x".repeat(400);
  const review = {
    checks: [...Array.from({ length: 45 }, (_, index) => ({ key: `stopped:m${index}`, title: index === 0 ? long : `Meter ${index} stopped`, text: "" })), { title: "No key", text: "" }],
    summary: { figures: Array.from({ length: 15 }, (_, index) => ({ value: String(index), unit: "", label: `Figure ${index}`, target: "total" })), answers: Array.from({ length: 10 }, (_, index) => ({ id: "total", question: `Q${index}`, answer: "A" })) },
  } as unknown as EnergyReview;
  const context = reportContextOf(review, null)!;
  expect(context.checks).toHaveLength(40);
  expect(context.checks[0]!.title).toHaveLength(300);
  expect(context.checks.every(check => check.key.startsWith("stopped:"))).toBe(true);
  expect(context.figures).toHaveLength(20);
  expect(context.figures[0]).toBe("Figure 0: 0");
  expect(context.figures[15]).toBe("Q0 A");
});

it("reads the full report's headline and key figures, and nothing without a report", () => {
  const report = { headline: "Uses about 47 kWh a day", keyFigures: [{ value: "1,316 kWh", label: "Total use" }] } as unknown as SiteReport;
  expect(reportContextOf(null, report)).toEqual({ checks: [], figures: ["Uses about 47 kWh a day", "Total use: 1,316 kWh"] });
  expect(reportContextOf(null, null)).toBeNull();
});

it("gives the report active memory, recent follow-ups and dismissed checks", () => {
  const now = Date.parse("2026-11-18T00:00:00Z");
  const readings = readingsFromFeedback(state({
    memory: [
      { id: "a", text: "Lights off at 7:10", kind: "fact", status: "active", authorUserId: "u", authorName: "A", createdAt: "2026-11-17T02:00:00Z", sourceFeedbackId: null },
      { id: "p", text: "Waiting", kind: "fact", status: "pending", authorUserId: "u", authorName: "A", createdAt: "2026-11-17T02:00:00Z", sourceFeedbackId: null },
    ],
    followUps: [
      { id: "o", text: "Open one", checkBy: "next_report", status: "open", createdAt: "2026-01-01T00:00:00Z", sourceFeedbackId: null },
      { id: "d", text: "Done lately", checkBy: "next_report", status: "done", createdAt: "2026-10-01T00:00:00Z", sourceFeedbackId: null, lastCheck: { at: "2026-11-10T00:00:00Z", verdict: "resolved", evidence: "Off every day." } },
      { id: "x", text: "Dropped long ago", checkBy: "next_month", status: "dropped", createdAt: "2026-08-01T00:00:00Z", sourceFeedbackId: null },
    ],
    dismissedChecks: [{ key: "noUse:m7", title: "Pavilion 2 used nothing", reason: "Loses power by day", createdAt: "2026-11-17T02:00:00Z" }],
  }), now);
  expect(readings).toEqual({
    feedbackMemory: [{ text: "Lights off at 7:10", date: "2026-11-17" }],
    followUps: [
      { text: "Open one", status: "open", createdAt: "2026-01-01T00:00:00Z" },
      { text: "Done lately", status: "done", createdAt: "2026-10-01T00:00:00Z", lastCheck: { at: "2026-11-10T00:00:00Z", verdict: "resolved", evidence: "Off every day." } },
    ],
    dismissedChecks: [{ key: "noUse:m7", title: "Pavilion 2 used nothing", reason: "Loses power by day" }],
  });
});

it("lists waiting suggestions first, then a few closed ones", () => {
  const item = (id: string, status: SuggestionDto["status"]): SuggestionDto => ({ id, kind: "holiday", label: id, payload: {}, status });
  const feedback = (id: string, suggestions: SuggestionDto[]) => ({ id, text: id, about: null, authorUserId: "u", authorName: "A", createdAt: "2026-11-17T00:00:00Z", status: "processed" as const, reply: null, memoryIds: [], followUpIds: [], suggestions });
  const listed = suggestionsOf(state({ feedback: [feedback("f2", [item("a2", "applied"), item("o2", "open")]), feedback("f1", [item("d1", "dismissed"), item("x1", "failed"), item("a1", "applied")])] }), 2);
  expect(listed.map(entry => `${entry.id}@${entry.feedbackId}`)).toEqual(["o2@f2", "x1@f1", "a2@f2", "d1@f1"]);
});

import { afterEach, expect, it, vi } from "vitest";
import type { EnergyReview } from "@datafoundry/site-report";
import { configApi } from "../../../lib/config-api";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { reportFeedbackMessages } from "./report-feedback-messages";
import { notLiveReason, problemText, readingsFromFeedback, reportContextOf, reportFeedbackApi, suggestionLabel, suggestionsOf, type ReportFeedbackState, type SuggestionDto } from "./report-feedback-model";
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
  await reportFeedbackApi.approveFollowUp("p 1", "f1");
  await reportFeedbackApi.setFollowUpStatus("p 1", "f1", "done", "Fixed on site");
  await reportFeedbackApi.reviewFollowUps("p 1");
  expect(request.mock.calls.map(([project, path, init]) => [project, path, init?.method ?? "GET", init?.body ?? null])).toEqual([
    ["p 1", "", "GET", null],
    ["p 1", "", "POST", JSON.stringify({ requestId: "r", text: "Hello" })],
    ["p 1", "suggestions/s%2F1/apply", "POST", null],
    ["p 1", "suggestions/s1/dismiss", "POST", null],
    ["p 1", "memory/m1/approve", "POST", null],
    ["p 1", "memory/m1", "DELETE", null],
    ["p 1", "follow-ups/f1/approve", "POST", null],
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

it("gives the report exactly what the server says the reports read", () => {
  const reportInputs = { feedbackMemory: [{ text: "Lights off at 7:10", date: "2026-11-18" }], followUps: [], dismissedChecks: [] };
  expect(readingsFromFeedback(state({ reportInputs }))).toBe(reportInputs);
});

it("works out the same as the server without its reckoning: active memory by its site date, follow-ups by when they closed", () => {
  const now = Date.parse("2026-11-18T00:00:00Z");
  const readings = readingsFromFeedback(state({
    memory: [
      // Approved late on the 17th UTC: the 18th in Singapore, as the reports date it.
      { id: "a", text: "Lights off at 7:10", kind: "fact", status: "active", authorUserId: "u", authorName: "A", createdAt: "2026-11-10T02:00:00Z", activatedAt: "2026-11-17T20:00:00Z", sourceFeedbackId: null },
      { id: "p", text: "Waiting", kind: "fact", status: "pending", authorUserId: "u", authorName: "A", createdAt: "2026-11-17T02:00:00Z", sourceFeedbackId: null },
    ],
    followUps: [
      { id: "o", text: "Open one", checkBy: "next_report", status: "open", createdAt: "2026-01-01T00:00:00Z", sourceFeedbackId: null },
      { id: "w", text: "Waiting for an admin", checkBy: "next_report", status: "pending", createdAt: "2026-11-17T00:00:00Z", sourceFeedbackId: null },
      // Written 40 days ago, closed today: still in the reports.
      { id: "d", text: "Done today", checkBy: "next_report", status: "done", createdAt: "2026-10-09T00:00:00Z", closedAt: "2026-11-17T23:00:00Z", sourceFeedbackId: null, lastCheck: { at: "2026-10-12T00:00:00Z", verdict: "resolved", evidence: "Off every day." } },
      { id: "x", text: "Dropped long ago", checkBy: "next_month", status: "dropped", createdAt: "2026-08-01T00:00:00Z", closedAt: "2026-08-20T00:00:00Z", sourceFeedbackId: null },
    ],
    dismissedChecks: [{ key: "noUse:m7", title: "Pavilion 2 used nothing", reason: "Loses power by day", createdAt: "2026-11-17T02:00:00Z" }],
  }), now, "Asia/Singapore");
  expect(readings).toEqual({
    feedbackMemory: [{ text: "Lights off at 7:10", date: "2026-11-18" }],
    followUps: [
      { text: "Open one", status: "open", createdAt: "2026-01-01T00:00:00Z" },
      { text: "Done today", status: "done", createdAt: "2026-10-09T00:00:00Z", lastCheck: { at: "2026-10-12T00:00:00Z", verdict: "resolved", evidence: "Off every day." } },
    ],
    dismissedChecks: [{ key: "noUse:m7", title: "Pavilion 2 used nothing", reason: "Loses power by day" }],
  });
});

it("words why a change failed, or is not live yet, in the reader's language", () => {
  const zh = translatorFor(reportFeedbackMessages, "zh-Hans");
  const ms = translatorFor(reportFeedbackMessages, "ms");
  expect(problemText({ code: "meter_missing", name: "Pavilion 2" }, "zh-Hans", zh)).toBe("Pavilion 2 已不在此场地的设置中。");
  expect(problemText({ code: "no_hours_for_date", date: "2026-12-25" }, "ms", ms)).toMatch(/^Tiada waktu operasi untuk 25 Dis 2026\./);
  expect(problemText({ code: "hours_not_saved", detail: "overlap" }, "en", translatorFor(reportFeedbackMessages, "en"))).toBe("These hours could not be saved. It overlaps with other dates.");
  expect(problemText({ code: "not_live", detail: "data_not_ready" }, "zh-Hans", zh)).toBe("更改已保存，但尚未生效。此场地的读数还没有准备好。请稍后再试。");
  expect(notLiveReason({ code: "not_live", detail: "admin_required" }, ms)).toBe("Hanya pentadbir platform boleh menjadikan perubahan berkuat kuasa.");
  expect(notLiveReason(undefined, ms)).toBe("Buka Premis dan pilih untuk menjadikan perubahan berkuat kuasa.");
  // A code this page does not know, or one missing what its sentence needs, is not worded.
  expect(problemText({ code: "something_new" as never }, "en", translatorFor(reportFeedbackMessages, "en"))).toBeNull();
  expect(problemText({ code: "meter_missing" }, "en", translatorFor(reportFeedbackMessages, "en"))).toBeNull();
});

it("lists waiting suggestions first, then a few closed ones", () => {
  const item = (id: string, status: SuggestionDto["status"]): SuggestionDto => ({ id, kind: "holiday", label: id, payload: {}, status });
  const feedback = (id: string, suggestions: SuggestionDto[]) => ({ id, text: id, about: null, authorUserId: "u", authorName: "A", createdAt: "2026-11-17T00:00:00Z", status: "processed" as const, reply: null, memoryIds: [], followUpIds: [], suggestions });
  const listed = suggestionsOf(state({ feedback: [feedback("f2", [item("a2", "applied"), item("o2", "open")]), feedback("f1", [item("d1", "dismissed"), item("x1", "failed"), item("a1", "applied")])] }), 2);
  expect(listed.map(entry => `${entry.id}@${entry.feedbackId}`)).toEqual(["o2@f2", "x1@f1", "a2@f2", "d1@f1"]);
});

it("writes each suggested change in the reader's language, keeping the server's English sentence", () => {
  const label = (kind: SuggestionDto["kind"], payload: Record<string, unknown>, locale: EnergyIqLocale) =>
    suggestionLabel({ id: "s", kind, label: "English sentence", payload, status: "open" }, locale, translatorFor(reportFeedbackMessages, locale));
  const weekday = [{ from: "07:00", to: "19:10" }];
  const weekly = { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [], sun: [] };
  expect(label("operating_hours", { weekly }, "en")).toBe("English sentence");
  expect(label("operating_hours", { weekly }, "zh-Hans")).toBe("把运行时间改为：周一–周五 07:00–19:10；周六–周日 关闭");
  expect(label("operating_hours", { weekly: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: weekday, sun: weekday } }, "ms")).toBe("Tukar waktu kepada setiap hari 07:00–19:10");
  // A change names only the days it changes; days apart are not run together.
  expect(label("operating_hours", { weekly: { mon: weekday, tue: weekday, thu: weekday }, base: { entryId: "e", weekly: {} } }, "zh-Hans")).toBe("把运行时间改为：周一–周二 07:00–19:10；周四 07:00–19:10");
  expect(label("operating_hours", { weekly: { sat: [] }, base: { entryId: "e", weekly: {} } }, "ms")).toBe("Tukar waktu kepada Sab tutup");
  expect(label("meter_not_in_use", { meterId: "m1", meterName: "Pavilion 2", reason: "Closed for repairs" }, "ms")).toBe("Tandakan Pavilion 2 sebagai tidak digunakan (Closed for repairs)");
  expect(label("meter_in_use", { meterId: "m1", meterName: "Pavilion 2" }, "zh-Hans")).toBe("将 Pavilion 2 标为恢复使用");
  expect(label("meter_always_on", { meterId: "m1", meterName: "Server room", alwaysOn: true }, "ms")).toBe("Tandakan Server room sebagai sentiasa hidup mengikut reka bentuk");
  expect(label("meter_never_used", { meterId: "m1", meterName: "Pavilion DL & fan", neverUsed: true }, "zh-Hans")).toBe("Pavilion DL & fan 一用电就提醒（它本应完全不用电）");
  expect(label("meter_never_used", { meterId: "m1", meterName: "Pavilion DL & fan", neverUsed: false }, "ms")).toBe("Berhenti memberi amaran apabila Pavilion DL & fan menggunakan kuasa");
  expect(label("meter_never_used", { meterId: "m1", meterName: "Pavilion DL & fan" }, "ms")).toBe("English sentence");
  expect(label("light_count", { meterId: "m1", meterName: "DB1 Light", count: 24 }, "zh-Hans")).toBe("把 DB1 Light 的灯具数量设为 24");
  expect(label("holiday", { date: "2026-12-25", label: "Christmas", closed: true, classification: "public_holiday" }, "zh-Hans")).toBe("把 2026年12月25日 加为公共假期：Christmas");
  expect(label("holiday", { date: "2026-12-26", label: "Year-end clean", closed: true, classification: "special_closure" }, "ms")).toMatch(/^Tambah 26 Dis 2026 sebagai hari tutup yang dirancang: Year-end clean$/);
  // The currency is always named with the figure.
  expect(label("electricity_rate", { ratePerKwh: 0.2981, effectiveFrom: "2027-01-01", currency: "SGD" }, "ms")).toBe("Tukar kadar elektrik kepada SGD 0.2981 setiap kWh mulai 1 Jan 2027");
  expect(label("electricity_rate", { ratePerKwh: 0.2981, effectiveFrom: "2027-01-01", currency: "MYR" }, "zh-Hans")).toBe("从 2027年1月1日 起，把电价改为每千瓦时 MYR 0.2981");
  expect(label("electricity_rate", { ratePerKwh: 0.2981, effectiveFrom: "2027-01-01" }, "ms")).toBe("English sentence");
  // A report point is named the way the report names it in that language, from its key and the meter's name.
  expect(label("dismiss_check", { checkKey: "noUse:m7", title: "Pavilion 2 used nothing", reason: "Off by day", meterName: "Pavilion 2" }, "zh-Hans")).toBe("报告不再提示“Pavilion 2 没有用电”");
  expect(label("dismiss_check", { checkKey: "daytime", title: "Daytime use on lighting circuits", reason: "Cleaners" }, "ms")).toBe("Berhenti menandakan “Penggunaan waktu siang pada litar lampu” dalam laporan");
  // A payload the page cannot read keeps the server's sentence rather than showing something wrong.
  expect(label("operating_hours", { weekly: {} }, "zh-Hans")).toBe("English sentence");
  expect(label("light_count", { meterId: "m1", meterName: "DB1 Light", count: "many" }, "ms")).toBe("English sentence");
});

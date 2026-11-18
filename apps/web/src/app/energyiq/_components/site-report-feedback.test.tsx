/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AnalysisData, ScopeData, TrendSeries } from "./analysis-data";
import type { ReportFeedbackReadings } from "./report-feedback-model";

// What the review is built from and what its document is handed; both are only watched here.
const seen = vi.hoisted(() => ({ built: [] as unknown[], props: [] as Array<Record<string, unknown>>, load: vi.fn() }));
vi.mock("@datafoundry/site-report", async importOriginal => {
  const actual = await importOriginal<typeof import("@datafoundry/site-report")>();
  return { ...actual, buildEnergyReview: (...args: Parameters<typeof actual.buildEnergyReview>) => { seen.built.push(args[0]); return actual.buildEnergyReview(...args); } };
});
vi.mock("@datafoundry/site-report/energy-review-document", async importOriginal => ({
  ...(await importOriginal<typeof import("@datafoundry/site-report/energy-review-document")>()),
  EnergyReviewDocument: (props: Record<string, unknown>) => { seen.props.push(props); return <p data-review-document />; },
}));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: seen.load }));
import { configApi } from "../../../lib/config-api";
import { SiteReportPanel, useSiteReport, type ReportCheckRef } from "./site-report";

const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const series = (id: string, kwh: number): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh, 60, 0] as TrendSeries["cells"][number])) });
const scope: ScopeData = {
  id: "project", name: "Harbour Office", dates: DATES, timezone: "Asia/Singapore", total: series("__scope__", 2), types: {},
  meters: [{ id: "light", name: "DB1 Light", location: "DB1", category: "light", official: true, series: series("light", 2) }],
  usageKwh: 672, peakKw: null, peakAt: null, cost: null, typeTotals: {}, coverage: 100,
};
const data: AnalysisData = { projectId: "p", projectName: "Harbour Office", timezone: "Asia/Singapore", snapshotId: null, current: { project: scope, spaces: [] }, previous: null, history: null, circuits: [],
  holidays: new Map(), openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])), actions: [] };
const readings: ReportFeedbackReadings = {
  feedbackMemory: [{ text: "The lights go off at 7:10 am", date: "2026-11-17" }],
  followUps: [{ text: "Check the pavilion fan never runs", status: "open", createdAt: "2026-11-17T02:00:00Z" }],
  dismissedChecks: [{ key: "noUse:light", title: "DB1 Light used nothing", reason: "Off by design" }],
};

afterEach(() => { seen.built.length = 0; seen.props.length = 0; seen.load.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Overview({ feedback, onCheckFeedback }: { feedback: ReportFeedbackReadings | null; onCheckFeedback?: (check: ReportCheckRef) => void }) {
  const site = useSiteReport("p", null, true, feedback);
  return <SiteReportPanel state={site.state} onRetry={() => undefined} onCheckFeedback={onCheckFeedback} />;
}

it("builds the review with what people told the AI and hands the document the feedback button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  // No saved report yet, and the site reads the energy review: the page builds it here.
  vi.spyOn(configApi, "reportLibraryRequest").mockResolvedValue({ reports: [], siteReportStyle: "review" } as never);
  vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({ contextNotes: "" } as never);
  seen.load.mockResolvedValue(data);
  const onCheckFeedback = vi.fn();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Overview feedback={null} />));
    for (let tick = 0; tick < 4; tick += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(host.querySelector("[data-review-document]")).not.toBeNull();
    expect(seen.built.at(-1)).toBe(data);
    // Without a handler the document gets none, so it shows no button.
    expect(seen.props.at(-1)!.onCheckFeedback).toBeUndefined();

    await act(async () => root.render(<Overview feedback={readings} onCheckFeedback={onCheckFeedback} />));
    expect(seen.built.at(-1)).toMatchObject({ projectId: "p", ...readings });
    // The readings themselves are untouched: the feedback is laid over a copy.
    expect("dismissedChecks" in data).toBe(false);
    const props = seen.props.at(-1)!;
    expect(props.onCheckFeedback).toBe(onCheckFeedback);
    expect(props.standalone).toBeUndefined();
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});

/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PreschoolOverviewViewModel } from "./preschool-overview-view-model";
import { PreschoolForecastPanel } from "./preschool-forecast-panel";

type ForecastView = Exclude<PreschoolOverviewViewModel["forecast"], { status: "unavailable" }>;

describe("PreschoolForecastPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps Daily, Weekly and Monthly plus Portfolio/Centre controls local to Section 5", async () => {
    await act(async () => root.render(<PreschoolForecastPanel forecast={forecastView()} />));

    expect(container.querySelector('[data-forecast-grain="daily"]')).not.toBeNull();
    expect(container.querySelector('[data-forecast-scope="portfolio"]')?.textContent).toContain("24,348 kWh");
    expect(container.querySelector('option[value="portfolio"]')?.textContent).toBe("All centres");
    expect(container.textContent).toContain("1,400 kWh");
    expect(container.querySelectorAll("[data-forecast-kpi]")).toHaveLength(4);
    expect(container.querySelector('path[data-series="original-estimate"]')?.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(container.querySelector('path[data-series="actual"]')?.getAttribute("stroke-dasharray")).toBeNull();
    expect(container.querySelector('path[data-series="current-outlook"]')).not.toBeNull();
    expect(container.textContent).toContain("Original Estimate, Actual and Current Outlook");

    const weekly = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Weekly")!;
    weekly.focus();
    await act(async () => weekly.click());
    expect(weekly.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-forecast-grain="weekly"]')).not.toBeNull();
    expect(container.textContent).toContain("1 Jun–7 Jun");

    const scope = container.querySelector<HTMLSelectElement>('select[aria-label="Monthly outlook scope"]')!;
    await act(async () => {
      scope.value = "centre-a";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[data-forecast-scope="centre"]')?.textContent).toContain("Centre A");
    expect(container.querySelector('[data-forecast-scope="centre"]')?.textContent).toContain("6,000 kWh");

    const monthly = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Monthly")!;
    await act(async () => monthly.click());
    expect(container.querySelector('[data-forecast-grain="monthly"]')).not.toBeNull();
    expect(container.textContent).toContain("1 Jun–30 Jun");
  });

  it("draws Actual only through cutoff and the dashed Current Outlook only after cutoff", async () => {
    const forecast = forecastView("partial");
    forecast.scopes[0]!.buckets.daily = [
      bucket("1 Jun", "2026-06-01", "2026-06-02", 800, 210, "complete", "1 / 1 complete days", "frozen-original", null),
      bucket("2 Jun", "2026-06-02", "2026-06-03", 820, 220, "complete", "1 / 1 complete days", "frozen-original", null),
      bucket("3 Jun", "2026-06-03", "2026-06-04", 830, null, "waiting", "0 / 1 complete days", "frozen-original", 830),
      bucket("4 Jun", "2026-06-04", "2026-06-05", 840, null, "waiting", "0 / 1 complete days", "frozen-original", 840),
    ];
    await act(async () => root.render(<PreschoolForecastPanel forecast={forecast} />));

    const original = container.querySelector('path[data-series="original-estimate"]')!;
    const actual = container.querySelector('path[data-series="actual"]')!;
    const current = container.querySelector('path[data-series="current-outlook"]')!;
    expect(original.getAttribute("d")?.match(/[ML]/g)).toHaveLength(4);
    expect(actual.getAttribute("d")?.match(/[ML]/g)).toHaveLength(2);
    expect(current.getAttribute("d")?.match(/[ML]/g)).toHaveLength(2);
    expect(actual.getAttribute("stroke-dasharray")).toBeNull();
    expect(current.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("switches the status strip from Portfolio Complete to Centre Partial and Waiting", async () => {
    const forecast = forecastView("complete");
    const portfolio = forecast.scopes[0]!;
    const partialCentre = forecast.scopes[1]!;
    partialCentre.status = "partial";
    partialCentre.statusLabel = "Actual to date + remaining estimate";
    Reflect.set(partialCentre, "statusDetail", "Actual includes complete local days through 14 Jul 2026.");
    Reflect.set(partialCentre, "actualThrough", "Actual through 14 Jul 2026");
    const waitingCentre = structuredClone(partialCentre);
    waitingCentre.scopeId = "centre-b";
    waitingCentre.label = "Centre B";
    waitingCentre.status = "waiting";
    waitingCentre.statusLabel = "Awaiting first complete day";
    Reflect.set(waitingCentre, "statusDetail", "No complete local-day Actual is available for this scope yet.");
    Reflect.set(waitingCentre, "actualThrough", "Actual not started");
    forecast.scopes.push(waitingCentre);

    await act(async () => root.render(<PreschoolForecastPanel forecast={forecast} />));
    const status = () => container.querySelector('[role="status"]')!;
    expect(container.querySelector('[data-forecast-status="complete"]')).not.toBeNull();
    expect(status().textContent).toContain(portfolio.statusLabel);

    const scope = container.querySelector<HTMLSelectElement>('select[aria-label="Monthly outlook scope"]')!;
    await act(async () => {
      scope.value = partialCentre.scopeId;
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[data-forecast-status="partial"]')).not.toBeNull();
    expect(status().textContent).toContain(partialCentre.statusLabel);
    expect(status().textContent).toContain("Actual through 14 Jul 2026");

    await act(async () => {
      scope.value = waitingCentre.scopeId;
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[data-forecast-status="waiting"]')).not.toBeNull();
    expect(status().textContent).toContain(waitingCentre.statusLabel);
    expect(status().textContent).toContain("Actual not started");
  });

  it.each([
    ["waiting", "Awaiting first complete day"],
    ["partial", "Actual to date + remaining estimate"],
    ["complete", "Complete month · Above original estimate"],
  ] as const)("renders the honest %s lifecycle status", async (status, statusLabel) => {
    const forecast = forecastView(status);
    await act(async () => root.render(<PreschoolForecastPanel forecast={forecast} />));

    expect(container.querySelector(`[data-forecast-status="${status}"]`)).not.toBeNull();
    expect(container.textContent).toContain(statusLabel);
    expect(container.querySelectorAll("[data-forecast-kpi]")).toHaveLength(4);
    expect(container.textContent).toContain("Expected June 2026 Energy");
    expect(container.textContent).toContain("Pace vs Original Estimate");
  });

  it("keeps the Planning Baseline visible while localising the missing frozen comparison", async () => {
    const forecast = forecastView("waiting", "planning-baseline");
    await act(async () => root.render(<PreschoolForecastPanel forecast={forecast} />));

    expect(container.textContent).toContain("Planning Baseline and Actual availability");
    expect(container.textContent).toContain("24,348 kWh");
    expect(container.textContent).toContain("S$6,640");
    expect(container.textContent).toContain("Frozen Original Estimate pending");
    expect(container.querySelector('path[data-series="planning-baseline"]')).not.toBeNull();
    expect(container.querySelector('path[data-series="original-estimate"]')).toBeNull();
  });

  it("labels an out-of-period tariff as provisional without withholding energy", async () => {
    const forecast = forecastView();
    forecast.tariff.status = "provisional";
    forecast.tariff.label = "Provisional · using latest available tariff";
    await act(async () => root.render(<PreschoolForecastPanel forecast={forecast} />));

    expect(container.querySelector('[data-forecast-tariff="provisional"]')).not.toBeNull();
    expect(container.textContent).toContain("Provisional · using latest available tariff");
    expect(container.textContent).toContain("not a customer bill");
    expect(container.textContent).toContain("24,348 kWh");
  });
});

const forecastView = (
  status: "waiting" | "partial" | "complete" = "partial",
  comparisonStatus: ForecastView["comparisonStatus"] = "frozen-original",
): ForecastView => ({
  status,
  comparisonStatus,
  statusLabel: status === "waiting"
    ? comparisonStatus === "planning-baseline"
      ? "Planning baseline ready · Frozen comparison pending"
      : "Awaiting first complete day"
    : status === "partial"
      ? "Actual to date + remaining estimate"
      : "Complete month · Above original estimate",
  statusDetail: "Actual contains complete local days only.",
  targetMonth: "June 2026",
  targetPeriod: "1–30 Jun 2026",
  defaultScopeId: "portfolio",
  centreSelectionAvailable: true,
  tariff: {
    status: "effective",
    rate: "S$0.2727/kWh before GST",
    label: "Effective for June 2026",
    effectiveRange: "1 Apr–30 Jun 2026",
    sourceUrl: "https://example.com/tariff",
    note: "SP Group · Low tension, non-domestic · planning reference only · not a customer bill.",
  },
  scopes: [
    scopeView("portfolio", "Preschool Portfolio", "portfolio", "24,348 kWh", "S$6,640", "1,400 kWh", status, comparisonStatus),
    scopeView("centre-a", "Centre A", "centre", "6,000 kWh", "S$1,636", "420 kWh", status, comparisonStatus),
  ],
  method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
  planEvidence: "Saved saved-a · Snapshot snapshot-a · daily_totals_v1",
  actualEvidence: "Current Snapshot snapshot-b · daily_totals_v1",
});

const scopeView = (
  scopeId: string,
  label: string,
  role: "portfolio" | "centre",
  estimatedEnergy: string,
  estimatedCost: string,
  consumedSoFar: string,
  status: "waiting" | "partial" | "complete",
  comparisonStatus: ForecastView["comparisonStatus"],
): ForecastView["scopes"][number] => ({
  scopeId,
  label,
  scopeType: role === "portfolio" ? "project" : "centre",
  role,
  status,
  statusLabel: status === "waiting" ? "Awaiting first complete day" : status === "partial" ? "Actual to date + remaining estimate" : "Complete month · Above original estimate",
  expectedFullMonthEnergy: estimatedEnergy,
  expectedFullMonthCost: estimatedCost,
  consumedSoFar: status === "waiting" ? "Awaiting first complete day" : consumedSoFar,
  consumedCostSoFar: status === "waiting" ? "Awaiting first complete day" : "S$382 before GST",
  paceVsOriginalEstimate: comparisonStatus === "planning-baseline"
    ? "Frozen Original Estimate pending"
    : status === "waiting"
      ? "Starts after first complete day"
      : "24.64%",
  paceDetail: comparisonStatus === "planning-baseline"
    ? "The Planning Baseline remains visible; historical comparison needs a compatible Saved Plan."
    : "Actual to date ÷ frozen estimate for the same complete days",
  coverage: status === "waiting" ? "0 / 30 complete days" : status === "complete" ? "30 / 30 complete days" : "7 / 30 complete days",
  outcome: status === "complete" ? "above_plan" : null,
  buckets: {
    daily: [bucket("1 Jun", "2026-06-01", "2026-06-02", 800, status === "waiting" ? null : 200, status === "waiting" ? "waiting" : "complete", status === "waiting" ? "0 / 1 complete days" : "1 / 1 complete days", comparisonStatus)],
    weekly: [bucket("1 Jun–7 Jun", "2026-06-01", "2026-06-08", 5_600, status === "waiting" ? null : 1_400, status === "waiting" ? "waiting" : "complete", status === "waiting" ? "0 / 7 complete days" : "7 / 7 complete days", comparisonStatus)],
    monthly: [bucket("1 Jun–30 Jun", "2026-06-01", "2026-07-01", 24_348, status === "waiting" ? null : status === "complete" ? 25_000 : 1_400, status, status === "waiting" ? "0 / 30 complete days" : status === "complete" ? "30 / 30 complete days" : "7 / 30 complete days", comparisonStatus)],
  },
});

const bucket = (
  label: string,
  start: string,
  endExclusive: string,
  estimateKwh: number,
  actualKwh: number | null,
  actualStatus: "waiting" | "partial" | "complete",
  coverage: string,
  comparisonStatus: ForecastView["comparisonStatus"],
  futureOutlookKwh: number | null = estimateKwh,
) => ({
  label,
  start,
  endExclusive,
  originalEstimateKwh: comparisonStatus === "frozen-original" ? estimateKwh : null,
  originalEstimate: comparisonStatus === "frozen-original" ? `${estimateKwh.toLocaleString("en-SG")} kWh` : "Frozen estimate pending",
  planningBaselineKwh: comparisonStatus === "planning-baseline" ? estimateKwh : null,
  planningBaseline: comparisonStatus === "planning-baseline" ? `${estimateKwh.toLocaleString("en-SG")} kWh` : "Not used",
  actualKwh,
  actual: actualKwh === null ? "Waiting" : `${actualKwh.toLocaleString("en-SG")} kWh`,
  currentOutlookKwh: futureOutlookKwh,
  currentOutlook: futureOutlookKwh === null ? "—" : `${futureOutlookKwh.toLocaleString("en-SG")} kWh`,
  actualStatus,
  coverage,
});

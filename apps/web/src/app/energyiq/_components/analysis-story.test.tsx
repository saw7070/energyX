import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalysisData, ScopeData, TrendCell } from "./analysis-data";
import { DecisionSummary } from "./analysis-story";
import { scopeDays } from "./analysis-model";

// One week (Mon 10 – Sun 16 Aug): 2 kW always on, 6 kW while open 09:00–18:00, and a 1 kW TV left on day and night.
const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0;
const open = (date: string, hour: number) => weekday(date) && hour >= 9 && hour < 18;
const series = (id: string, kwhAt: (date: string, hour: number) => number) => ({ id, expectedMinutesPerHour: 60, cells: dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwhAt(date, hour), 60, 0] as TrendCell)) });
const siteKwh = (date: string, hour: number) => open(date, hour) ? 6 : 2;
const scope = (id: string, name: string, extra: Partial<ScopeData> = {}): ScopeData => ({
  id, name, dates, timezone: "Asia/Singapore", total: series("__scope__", siteKwh), types: { load: series("__category__:load", siteKwh) }, meters: [],
  usageKwh: 0, peakKw: 6, peakAt: null, cost: null, typeTotals: { load: 0 }, coverage: 100, ...extra,
});
const usage = dates.reduce((sum, date) => sum + Array.from({ length: 24 }, (_, hour) => siteKwh(date, hour)).reduce((a, b) => a + b, 0), 0);
const project = scope("project", "Office", { usageKwh: usage, typeTotals: { load: usage }, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh" } });
const space = scope("l1", "Level 1", { usageKwh: usage, meters: [
  { id: "db", name: "DB1 Power", location: "Level 1", category: "load", official: true, series: series("db", siteKwh) },
  { id: "tv", name: "Lobby TV", location: "Level 1", category: "load", official: false, series: series("tv", () => 1) },
] });
const data: AnalysisData = {
  projectId: "office", projectName: "Office", timezone: "Asia/Singapore", snapshotId: "snap", current: { project, spaces: [space] }, previous: null, history: null,
  circuits: [], holidays: new Map(), openingHours: { monday: [{ from: "09:00", to: "18:00" }], tuesday: [{ from: "09:00", to: "18:00" }], wednesday: [{ from: "09:00", to: "18:00" }], thursday: [{ from: "09:00", to: "18:00" }], friday: [{ from: "09:00", to: "18:00" }] }, actions: [],
};

describe("DecisionSummary", () => {
  it("says what peak hours cost when the rate has peak and off-peak prices", () => {
    // Ringgit time-of-use: RM 40 of the RM 100 bill was in peak hours, using 300 of 1,000 kWh.
    const touProject = { ...project, usageKwh: 1000, cost: { amount: 100, currency: "MYR", note: "", peak: { cost: 40, usageKwh: 300 } } };
    const touData = { ...data, current: { ...data.current, project: touProject } };
    const markup = renderToStaticMarkup(<DecisionSummary data={touData} days={scopeDays(touProject, data.holidays)} anomalies={[]} floor={null} rate={0.1} />).replace(/<!-- -->/g, "");
    expect(markup).toContain("Peak hours cost RM40: 40% of the bill for 30% of the electricity.");
  });

  it("tells the story in money: what was spent, how much while closed, what stays on and what to switch off", () => {
    const markup = renderToStaticMarkup(<DecisionSummary data={data} days={scopeDays(project, data.holidays)} anomalies={[]} floor={null} rate={0.3} />).replace(/<!-- -->/g, "");
    // 5 × 9 open hours at 6 kWh; every other hour at 2 kWh.
    const closedKwh = usage - 5 * 9 * 6;
    expect(markup).toContain(`Office spent <span class="font-semibold text-slate-900">S$${Math.round(usage * 0.3)}</span>`);
    expect(markup).toContain(`S$${Math.round(closedKwh * 0.3)} (${Math.round(closedKwh / usage * 100)}%)`);
    expect(markup).toContain("Switch off Lobby TV after working hours");
    // 123 of 168 hours a week are closed: 123 / 168 × 8,760 = 6,414 hours a year; 1 kW × 6,414 h × SGD 0.30 = SGD 1,924.
    expect(markup).toContain("power after working hours × 6,414 such hours a year × SGD 0.30/kWh");
    expect(markup).toContain("Up to S$1,924");
    expect(markup).toContain("Checks — not counted in the total");
    expect(markup).toContain("Operating hours are <span class=\"font-medium text-slate-900\">09:00–18:00</span>");
    expect(markup).toContain("Health check");
    // The hour-by-hour chart offers weekday and weekend averages and any single day.
    expect(markup).toContain(">Single day</button>");
    // Type names carry a plain-language explanation for non-technical readers.
    expect(markup).toContain('aria-label="What does Power Load mean?"');
    expect(markup).not.toContain("assumed — no operating hours");
  });

  it("reads lights-on hours as lighting that should run at night", () => {
    // Lights draw 3 kW from 19:00 to 07:00 every night and nothing by day, except one circuit left on until 08:00.
    const night = (hour: number) => hour >= 19 || hour < 7;
    const lights = (_date: string, hour: number) => night(hour) ? 3 : hour === 7 ? 1 : 0;
    const total = series("__scope__", lights);
    const kwh = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
    const estate = scope("estate", "Estate", { total, types: { light: series("__category__:light", lights) }, usageKwh: kwh, typeTotals: { light: kwh }, cost: { amount: kwh * 0.3, currency: "SGD", note: "0.3 SGD/kWh" } });
    const nights = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));
    // A public holiday does not switch the lights off.
    const lightsData: AnalysisData = { ...data, projectName: "Estate", current: { project: estate, spaces: [] }, holidays: new Map([["2026-08-10", "National Day observed"]]), openingHours: nights, hoursMeaning: "lights_on" };
    const markup = renderToStaticMarkup(<DecisionSummary data={lightsData} days={scopeDays(estate, lightsData.holidays)} anomalies={[]} floor={null} rate={0.3} />).replace(/<!-- -->/g, "");
    // 1 of 253 kWh a day is daytime use: a calm headline.
    expect(markup).toContain("The lights ran at night as planned: only");
    expect(markup).not.toContain("after working hours");
    expect(markup).toContain("Lights-on hours are <span class=\"font-medium text-slate-900\">19:00 → 07:00 next day</span>");
    expect(markup).toContain("In the daytime");
    expect(markup).toContain("What stays on in the daytime");
    expect(markup).toContain("Almost all the energy is used during the lights-on hours, as planned.");
    expect(markup).not.toContain("Public holidays");
    expect(markup).not.toContain("Weekends");
  });
});

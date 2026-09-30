import { it, expect } from "vitest";
import {
  chartPoints,
  completeDailyAverage, recentSeriesHealth, recentCompleteDates,
  dailyPoints,
  localDate,
  type Series,
} from "./explorer-trend-model";
const s: Series = {
  id: "any-project-meter",
  expectedMinutesPerHour: 60,
  cells: [
    ["2026-09-10", 0, 0, 60, 0],
    ["2026-09-10", 1, 2, 30, 0],
    ["2026-09-11", 0, 4, 60, 0],
  ],
};
it("keeps real zero distinct from absent hours in yesterday curve", () => {
  const p = chartPoints(s, ["2026-09-10"], "yesterday");
  expect(p).toHaveLength(24);
  expect(p[0].value).toBe(0);
  expect(p[1].coverage).toBe(50);
  expect(p[2].value).toBeNull();
});
it("typical averages complete observations rather than using yesterday or partial hours", () => {
  const p = chartPoints(s, ["2026-09-10", "2026-09-11"], "typical");
  expect(p[0].value).toBe(2);
  expect(p[1].value).toBeNull();
});
it("a missing day and an incomplete calendar week cannot appear complete", () => {
  expect(dailyPoints(s, ["2026-09-09"])[0].value).toBeNull();
  expect(chartPoints(s, ["2026-09-10"], "weekly")[0].coverage).toBeLessThan(
    100,
  );
});
it("dates use project timezone at UTC midnight boundaries", () =>
  expect(localDate("2026-09-10T16:00:00Z", "Asia/Singapore")).toBe(
    "2026-09-11",
  ));

it("coverage for a partially selected month counts selected dates only", () => {
  const series: Series = {id:"m", expectedMinutesPerHour:60, cells:Array.from({length:24},(_,h)=>["2026-09-10",h,1,60,0])};
  expect(chartPoints(series,["2026-09-10"],"monthly")[0].coverage).toBe(100);
  expect(chartPoints(series,["2026-09-10"],"weekly")[0].coverage).toBe(100);
  expect(chartPoints(series,["2026-09-10", "2026-09-11"],"hourly")).toHaveLength(48);
  expect(chartPoints(series,["2026-09-11"],"hourly")[0].value).toBeNull();
});
it("daily mean excludes absent and incomplete days, preserves genuine zero", () => {
  const series: Series = {id:"__scope__",expectedMinutesPerHour:60,cells:[
    ...Array.from({length:24},(_,h)=>["2026-09-10",h,0,60,0] as Series["cells"][number]),
    ["2026-09-11",0,100,60,0]
  ]};
  const a = {context:{from:"2026-09-09T16:00:00Z",to:"2026-09-12T16:00:00Z",timezone:"Asia/Singapore"},explorerTrends:[series]} as Parameters<typeof completeDailyAverage>[0];
  expect(completeDailyAverage(a)).toEqual({value:0,days:1});
});
it("recent lamps need three individually complete days, zero is not a fault", () => {
  const dates=["2026-09-10","2026-09-11","2026-09-12"];
  const series:Series={id:"m",expectedMinutesPerHour:60,cells:dates.flatMap(d=>Array.from({length:24},(_,h)=>[d,h,0,60,0] as Series["cells"][number]))};
  expect(recentSeriesHealth(series,dates).status).toBe("complete");
  expect(recentSeriesHealth({...series,cells:series.cells.slice(2)},dates).status).toBe("review");
  expect(recentSeriesHealth({...series,cells:[]},dates).status).toBe("review");
  expect(recentCompleteDates("Asia/Singapore",new Date("2026-09-12T18:00:00Z"))).toEqual({from:"2026-09-10",to:"2026-09-12"});
});

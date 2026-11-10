/**
 * A lighting site like SKTC for the "why was this day different?" tests: two weeks from Monday 2 Nov 2026, lights on
 * 7 pm to 7 am every night. A usual day is 46.1 kWh; on Thursday 5 Nov the Compassvale Bow entrance (+1.5 kWh), the
 * Pavilion (+0.6 kWh) and one lift lobby (+0.2 kWh) make it 48.4 kWh. On Tuesday 10 Nov readings went missing.
 */
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "@datafoundry/site-report";

export const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-11-02T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const lit = (hour: number) => hour >= 19 || hour < 7;
export const THURSDAY = "2026-11-05";
export const GAP_DAY = "2026-11-10";
/** kWh a day for each meter; the second lift lobby wobbles by 0.1 kWh, so the usual day is 46.1 kWh with a little spread. */
export const DAILY: Record<string, (date: string) => number> = {
  bow: date => date === THURSDAY ? 7.5 : 6,
  pavilion: date => date === THURSDAY ? 4.6 : 4,
  "lobby-e": date => date === THURSDAY ? 18.2 : 18,
  "lobby-f": date => date === THURSDAY ? 18.1 : 18.1 + [0.1, -0.1, 0][DATES.indexOf(date) % 3]!,
};
const NAMES: Record<string, [string, string]> = { bow: ["Compassvale Bow entrance", "Outdoor"], pavilion: ["Pavilion DL & fan", "Outdoor"], "lobby-e": ["Lift lobby lights", "Block 264E"], "lobby-f": ["Lift lobby lights", "Block 264F"] };
/** Hourly cells; on the gap day every meter missed half of 2 am. */
export const series = (id: string, kwhOn: (date: string) => number): TrendSeries => ({
  id, expectedMinutesPerHour: 60,
  cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, lit(hour) ? kwhOn(date) / 12 : 0, date === GAP_DAY && hour === 2 ? 30 : 60, 0] as TrendSeries["cells"][number])),
});
export const meter = (id: string): ScopeMeter => ({ id, name: NAMES[id]![0], location: NAMES[id]![1], category: "light", official: true, series: series(id, DAILY[id]!) });
export const IDS = Object.keys(DAILY);
export const site: ScopeData = {
  id: "sktc", name: "SKTC", dates: DATES, timezone: "Asia/Singapore", total: series("__scope__", date => IDS.reduce((sum, id) => sum + DAILY[id]!(date), 0)), types: {},
  meters: IDS.map(meter), usageKwh: 650, peakKw: 4, peakAt: null, cost: null, typeTotals: {}, coverage: 99,
};
const nights = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));
export const DATA: AnalysisData = {
  projectId: "sktc", projectName: "SKTC", timezone: "Asia/Singapore", snapshotId: null, current: { project: site, spaces: [] }, previous: null, history: null,
  circuits: [], holidays: new Map(), openingHours: nights, actions: [], hoursMeaning: "lights_on",
};

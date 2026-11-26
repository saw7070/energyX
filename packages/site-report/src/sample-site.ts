/**
 * A made-up site for previewing the report layouts before a site has readings of its own (Create project → Reports).
 *
 * Two blocks of flats and a common area, lit from 7 pm to 7 am, with four weeks of hour-by-hour readings ending
 * yesterday. A few things happen in it so every section of each layout has something to show: the linkway lights stop
 * reporting three days before the end, one day stands out (corridor lights left on one morning), and the pavilion fan is
 * used on a single evening. Every name and figure is invented. Blocks have numbers, as estates name them; a lone letter
 * ("Block A") would be lowered to "block a" in the full report's plain circuit names.
 */
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-types.js";

const TIMEZONE = "Asia/Singapore";
const DAYS = 28;
const RATE = 0.3;

type Profile = (day: number, hour: number) => number;
type SampleMeter = { name: string; group: string; top: "a" | "b" | "common"; category: "light" | "load"; kwh: Profile; stopsDaysBeforeEnd?: number };

const night = (hour: number) => hour >= 19 || hour < 7;
// A little day-to-day movement, the same every time the sample is drawn.
const wobble = (day: number, seed: number) => 1 + 0.05 * Math.sin(day * 1.7 + seed);
const lit = (perDay: number, seed: number, daytime = 0): Profile => (day, hour) => night(hour) ? (perDay / 12) * wobble(day, seed) : daytime;

/** The day that stands out: the upper corridors of Block 102 stay lit through the morning (a stuck timer). */
const STANDOUT_DAY = 18;

const METERS: Record<string, SampleMeter> = {
  "a-lobby": { name: "Block 101 lift lobby", group: "a-gf", top: "a", category: "light", kwh: lit(3.6, 1) },
  "a-high": { name: "Block 101 L7–L12 corridors", group: "a-lighting", top: "a", category: "light", kwh: lit(8, 2) },
  "a-low": { name: "Block 101 L1–L6 corridors", group: "a-lighting", top: "a", category: "light", kwh: lit(3.4, 3, 0.01) },
  "a-emergency": { name: "Block 101 emergency lights", group: "a-emergency", top: "a", category: "light", kwh: () => 0.1 },
  "b-lobby": { name: "Block 102 lift lobby", group: "b-gf", top: "b", category: "light", kwh: lit(3.2, 4) },
  "b-high": { name: "Block 102 L7–L12 corridors", group: "b-lighting", top: "b", category: "light",
    kwh: (day, hour) => day === STANDOUT_DAY && hour >= 7 && hour < 12 ? 0.9 : lit(8.2, 5)(day, hour) },
  "b-low": { name: "Block 102 L1–L6 corridors", group: "b-lighting", top: "b", category: "light", kwh: lit(3.3, 6) },
  "b-emergency": { name: "Block 102 emergency lights", group: "b-emergency", top: "b", category: "light", kwh: () => 0.1 },
  driveway: { name: "Driveway lamps", group: "common", top: "common", category: "light", kwh: lit(4, 7) },
  linkway: { name: "Linkway lights", group: "common", top: "common", category: "light", kwh: lit(1.8, 8), stopsDaysBeforeEnd: 3 },
  shelter: { name: "Shelter lights", group: "common", top: "common", category: "light", kwh: lit(0.3, 9) },
  playground: { name: "Playground lights", group: "common", top: "common", category: "light", kwh: lit(0.6, 10) },
  fan: { name: "Pavilion fan", group: "common", top: "common", category: "load", kwh: (day, hour) => day === DAYS - 9 && hour >= 19 && hour < 23 ? 0.2 : 0 },
};

const GROUPS = [
  { id: "a", name: "Block 101", parentId: null, order: 10 },
  { id: "a-gf", name: "Ground floor", parentId: "a", order: 10 }, { id: "a-lighting", name: "Block lighting", parentId: "a", order: 20 }, { id: "a-emergency", name: "Emergency lights", parentId: "a", order: 30 },
  { id: "b", name: "Block 102", parentId: null, order: 20 },
  { id: "b-gf", name: "Ground floor", parentId: "b", order: 10 }, { id: "b-lighting", name: "Block lighting", parentId: "b", order: 20 }, { id: "b-emergency", name: "Emergency lights", parentId: "b", order: 30 },
  { id: "common", name: "Common area", parentId: null, order: 30 },
];
const TOPS = [["a", "Block 101"], ["b", "Block 102"], ["common", "Common area"]] as const;
const LIGHTS_ON = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));

/** The 28 whole days before `now`'s date in Singapore, oldest first. */
function sampleDates(now: Date): string[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = Date.parse(`${today}T00:00:00Z`) - DAYS * 86_400_000;
  return Array.from({ length: DAYS }, (_, day) => new Date(start + day * 86_400_000).toISOString().slice(0, 10));
}

/** Readings for a whole made-up site, ready for any of the report layouts. */
export function sampleSiteAnalysisData(now: Date = new Date()): AnalysisData {
  const dates = sampleDates(now);
  const ids = Object.keys(METERS);
  const cell = (id: string, day: number, hour: number): TrendSeries["cells"][number] => {
    const meter = METERS[id]!;
    if (meter.stopsDaysBeforeEnd && day >= DAYS - meter.stopsDaysBeforeEnd) return [dates[day]!, hour, null, 0, 0];
    return [dates[day]!, hour, Math.round(meter.kwh(day, hour) * 1000) / 1000, 60, 0];
  };
  const hours = (each: (day: number, hour: number) => TrendSeries["cells"][number]) =>
    dates.flatMap((_, day) => Array.from({ length: 24 }, (_, hour) => each(day, hour)));
  const seriesOf = (id: string): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: hours((day, hour) => cell(id, day, hour)) });
  const kwhOf = (id: string) => seriesOf(id).cells.reduce((sum, item) => sum + (item[2] ?? 0), 0);
  const meterOf = (id: string): ScopeMeter => ({ id, name: METERS[id]!.name, location: METERS[id]!.group, category: METERS[id]!.category, official: true, series: seriesOf(id) });

  const scope = (id: string, name: string, members: string[]): ScopeData => {
    const total: TrendSeries = { id: "__scope__", expectedMinutesPerHour: members.length * 60, cells: hours((day, hour) => {
      const cells = members.map(member => cell(member, day, hour));
      return [dates[day]!, hour, cells.reduce((sum, item) => sum + (item[2] ?? 0), 0), cells.reduce((sum, item) => sum + item[3], 0), 0];
    }) };
    const usageKwh = members.reduce((sum, member) => sum + kwhOf(member), 0);
    const received = total.cells.reduce((sum, item) => sum + item[3], 0);
    return { id, name, dates, timezone: TIMEZONE, total, types: {}, meters: members.map(meterOf), usageKwh, peakKw: null, peakAt: null,
      cost: { amount: usageKwh * RATE, currency: "SGD", note: `${RATE} SGD/kWh before tax`, rates: [RATE], basis: "tax_exclusive" },
      typeTotals: {}, coverage: Math.round((received / (members.length * 60 * dates.length * 24)) * 100) };
  };

  return {
    projectId: "sample-site", projectName: "Sample site", timezone: TIMEZONE, snapshotId: null,
    current: { project: scope("sample-site", "Sample site", ids), spaces: TOPS.map(([top, name]) => scope(top, name, ids.filter(id => METERS[id]!.top === top))) },
    previous: null, history: null, circuits: [], holidays: new Map(), openingHours: LIGHTS_ON, actions: [], hoursMeaning: "lights_on",
    groups: { list: GROUPS, meters: ids.map(id => ({ id, name: METERS[id]!.name, groupId: METERS[id]!.group, kwh: kwhOf(id) })) },
    alwaysOnByDesign: [{ id: "a-emergency", name: METERS["a-emergency"]!.name }, { id: "b-emergency", name: METERS["b-emergency"]!.name }],
    lightCounts: [{ id: "a-lobby", name: METERS["a-lobby"]!.name, count: 12 }, { id: "b-lobby", name: METERS["b-lobby"]!.name, count: 12 }, { id: "playground", name: METERS.playground!.name, count: 6 }],
    tariffTax: { name: "GST", ratePct: 9 },
    carbon: { kgCo2ePerKwh: 0.402, year: 2024, source: "Energy Market Authority" },
  };
}

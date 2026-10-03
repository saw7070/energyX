/**
 * The site energy report: a fixed, story-led report for decision makers, computed from the same readings as the
 * Analysis page. Every figure and sentence comes from this file so the report is testable and never varies in shape.
 *
 * Structure (same as the reference Tuya Office report): masthead, headline finding, four key figures, then
 * 1 property profile & circuit map, 2 30-day estimate & bill, 3 weekday / weekend / base-load benchmark,
 * 4 weekday hour-by-hour pattern, 5 abnormality screening by circuit.
 */
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-types.js";
import { alwaysOnKw, effectiveHours, isOpenHour, scopeDays, shortDate, timeBuckets, weekdayShort, type AnalysisCategory, type AnalysisDay } from "./analysis-model.js";
import { listText } from "./analysis-messages.js";
import { translatorFor, type EnergyIqLocale, type Translate } from "./locale.js";
import { formatPeriod } from "./report-period.js";
import { DAY_PARTS, siteReportModelMessages, type SiteReportModelKey } from "./site-report-model-messages.js";

type T = Translate<SiteReportModelKey>;
const modelText = (locale: EnergyIqLocale) => translatorFor(siteReportModelMessages, locale);

// ---------- formatting ----------
// Numbers keep one format (1,234.5) in every language, so figures match the rest of EnergyIQ.
const grouped = (value: number, digits = 0) => value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const kwhText = (value: number) => `${grouped(value, value < 20 ? 1 : 0)} kWh`;
export const kwText = (value: number, digits = 2) => `${value.toFixed(digits)} kW`;
export const pctText = (share: number, digits = 0) => `${(share * 100).toFixed(digits)}%`;
/** "S$" for Singapore dollars, as on a local bill; the currency code otherwise. */
export const moneyText = (value: number, currency: string, digits = 0) => `${currency === "SGD" ? "S$" : `${currency} `}${grouped(value, digits)}`;
/** The hour on a 12-hour clock and the part of the day it falls in, for languages other than English. */
function clockParts(hour: number, locale: Exclude<EnergyIqLocale, "en">) {
  const h = hour % 24;
  return { hour: String(h % 12 === 0 ? 12 : h % 12), part: DAY_PARTS[locale].reduce((word, [from, name]) => h >= from ? name : word, "") };
}
/** 9 → "9 am", 13 → "1 pm", 24 → "midnight"; Chinese "上午9点", Malay "9 pagi". */
export const clock = (hour: number, locale: EnergyIqLocale = "en") => locale === "en"
  ? hour % 24 === 0 ? "midnight" : hour === 12 ? "noon" : hour < 12 ? `${hour} am` : `${hour - 12} pm`
  : modelText(locale)("clock.time", clockParts(hour, locale));
const bare = (hour: number) => String(hour % 12 === 0 ? 12 : hour % 12);
const sameHalf = (from: number, to: number) => (from < 12 && to < 12) || (from >= 12 && to > 12 && to < 24);
/** Two clock times, sharing the part of the day when both fall in it ("9–11 pagi"). */
function clockPair(from: number, to: number, locale: Exclude<EnergyIqLocale, "en">, same: "clock.range" | "clock.between", across: "clock.rangeAcross" | "clock.betweenAcross") {
  const a = clockParts(from, locale), b = clockParts(to, locale), t = modelText(locale);
  return a.part === b.part ? t(same, { part: a.part, from: a.hour, to: b.hour }) : t(across, { from: clock(from, locale), to: clock(to, locale) });
}
/** "9–10 am", "12–2 pm", "11 am – 1 pm", "9 am – noon"; Chinese "上午9点–下午6点", Malay "9 pagi – 6 petang". */
export const hourRange = (from: number, to: number, locale: EnergyIqLocale = "en") => locale === "en"
  ? sameHalf(from, to) ? `${bare(from)}–${clock(to)}` : `${clock(from)} – ${clock(to)}`
  : clockPair(from, to, locale, "clock.range", "clock.rangeAcross");
/** "9 and 10 am", "11 am and 1 pm"; Chinese "上午9点到10点", Malay "9 dan 10 pagi". */
export const hourBetween = (from: number, to: number, locale: EnergyIqLocale = "en") => locale === "en"
  ? sameHalf(from, to) ? `${bare(from)} and ${clock(to)}` : `${clock(from)} and ${clock(to)}`
  : clockPair(from, to, locale, "clock.between", "clock.betweenAcross");
/** English counts in words ("three distribution boards"); other languages use digits. */
const numberWord = (n: number, locale: EnergyIqLocale = "en") => locale === "en" ? ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n) : String(n);
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A plain name inside a sentence: "Office area lights" → "office area lights"; "LED display" stays. */
const inline = (name: string) => /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
/** Sentences of one paragraph; Chinese runs them together without spaces. */
const sentences = (parts: string[], locale: EnergyIqLocale) => parts.filter(Boolean).join(locale === "zh-Hans" ? "" : " ");
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon"; Chinese "周一"; Malay "Isn". */
export const weekdayOf = (date: string, locale: EnergyIqLocale = "en") => locale === "en" ? DOW[new Date(`${date}T00:00:00Z`).getUTCDay()]! : weekdayShort(date, locale);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
/** Consecutive dates written as ranges: "18–19 Aug", "27 Aug", "1–3 Sep"; Chinese "8月18–19日". */
export function dateRuns(dates: string[], locale: EnergyIqLocale = "en") {
  const sorted = [...new Set(dates)].sort();
  const runs: string[][] = [];
  for (const date of sorted) {
    const last = runs.at(-1);
    if (last && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last.at(-1)}T00:00:00Z`) === 86_400_000) last.push(date); else runs.push([date]);
  }
  const day = (date: string) => shortDate(date, locale);
  return runs.map(run => {
    const first = run[0]!, last = run.at(-1)!;
    if (run.length === 1) return day(first);
    if (locale === "zh-Hans") return first.slice(0, 7) === last.slice(0, 7) ? `${day(first).replace(/日$/, "")}–${Number(last.slice(8))}日` : `${day(first)} – ${day(last)}`;
    return day(first).split(" ")[1] === day(last).split(" ")[1] ? `${day(first).split(" ")[0]}–${day(last)}` : `${day(first)} – ${day(last)}`;
  });
}

// ---------- spatial reference (fields beyond the shared contract) ----------
type Rect = [number, number, number, number];
type ZoneRef = ProjectSpatialReference["layout"]["zones"][number] & { directionFromEntrance?: string; rooms?: string[]; kind?: string };
export type SpatialExtras = ProjectSpatialReference & {
  property?: { address?: string; level?: number | string; occupancyExtent?: string; approximateAreaM2?: number };
  layout: ProjectSpatialReference["layout"] & { zones: ZoneRef[]; entrance?: { label?: string; referenceBoard?: string; position?: [number, number] }; boardMarkers?: Record<string, [number, number]>; boardColours?: Record<string, string> };
};

// ---------- report shape ----------
export type ReportDay = { date: string; dow: string; kwh: number; dayType: AnalysisDay["dayType"]; holidayName?: string | undefined; complete: boolean };
/** `area` is the plain place name ("Office Area") when the zone matches a space. */
export type ReportZone = { key: string; label: string; area: string | null; board: string; rect: Rect | null; subgroup: boolean; parentRoom: string | null; equipment: string | null; direction: string | null; rooms: string[]; circuitKeys: string[]; monthKwh: number; periodKwh: number; share: number; alwaysOn: boolean; colour: string };
export type ReportCircuit = {
  /** Plain name for readers ("Office area lights"); `code` is the panel's own name ("DB1 L1 Light"), shown only as detail. */
  key: string; name: string; code: string; codes: string[]; label: string; board: string; zone: string | null; category: AnalysisCategory | "overall"; meterIds: string[];
  weekdayPerDay: number | null; weekendPerDay: number | null; periodKwh: number; monthKwh: number; monthCost: number | null; share: number;
  /** Average kWh per hour in weekday operating hours and in all other hours. */
  openBase: number | null; closedBase: number | null; ratio: number | null; hours: number;
  gapDays: number; finding: string; eveningKwh: number | null; flat: boolean; colour: string;
};
export type ProfileNote = { hour: number; kw: number; text: string; place: "left" | "below" | "above-left" | "above-right" };
/** What the Overview headline is about, the same in every language (the headline itself is translated). */
export type HeadlineTopic = "always-on" | "after-hours" | "working-hours";
export type SiteReport = {
  /** The language every sentence of this report is written in. */
  locale: EnergyIqLocale;
  /** "office", "campus" or "site": fixed English values used by code; the prose uses the reader's word. */
  projectName: string; siteWord: string; timezone: string; tzLabel: string; from: string; to: string; dayCount: number; generatedAt: string;
  currency: string; rate: number | null; rateLabel: string | null;
  masthead: { site: string; detail: string; period: string; periodNote: string };
  title: { before: string; emphasis: string }; lede: string;
  /** One plain money sentence for the Overview heading. */
  headline: string;
  headlineTopic: HeadlineTopic;
  keyFigures: Array<{ value: string; label: string }>;
  profile: { intro: string; zones: Array<{ heading: string; text: string }>; caption: string; hasMap: boolean };
  reference: SpatialExtras | null;
  zones: ReportZone[]; circuits: ReportCircuit[];
  estimate: { monthKwh: number; monthCost: number | null; intro: string; comparison: string; spaceCaption: string; loadCaption: string; note: string };
  benchmark: { days: ReportDay[]; weekdayAvg: number | null; weekendAvg: number | null; baseKw: number | null; baseDayKwh: number | null; intro: string; caption: string; closeToWeekend: boolean; rows: Array<{ label: string; rate: string; perDay: string; perMonth: string; cost: string; hot: boolean }>; outro: string };
  pattern: { hours: number[]; openFrom: number; openTo: number; notes: ProfileNote[]; intro: string; cause: string | null; caption: string; weekdayCount: number } | null;
  screening: { intro: string; rows: Array<{ label: string; code: string; open: string; closed: string; finding: string }>; callout: string; note: string };
  footer: { left: string; right: string };
};

// Tuya reference colours: ink, brand orange, steel, slate, amber for display equipment.
export const REPORT_COLOURS = { ink: "#1C2530", ember: "#FF4E16", emberSoft: "#FFB59B", slate: "#9AA7B4", slateSoft: "#CBD3DA", steel: "#1F4E63", fog: "#F4F3F0", line: "#E3E1DC", muted: "#6B7480", amber: "#F2A50C", bronze: "#C77800" };
// Colour follows the zone (sorted by name), never its size.
const ZONE_PALETTE = [REPORT_COLOURS.steel, REPORT_COLOURS.ember, REPORT_COLOURS.amber, "#6B4E9B", "#3E8E7E", "#B3446C"];
const LOAD_PALETTE = [REPORT_COLOURS.ember, REPORT_COLOURS.amber, REPORT_COLOURS.bronze, REPORT_COLOURS.steel, REPORT_COLOURS.slate, "#6B4E9B", "#3E8E7E", "#B3446C"];
export const SCREEN_PCT = 0.3;
export const SCREEN_KWH = 0.15;

// ---------- readings ----------
type Cells = Map<string, number>; // "date|hour" → kWh for complete hours
const cellKey = (date: string, hour: number) => `${date}|${hour}`;
function completeCells(series: TrendSeries | null | undefined, dates: Set<string>): Cells {
  const cells: Cells = new Map();
  for (const cell of series?.cells ?? []) if (dates.has(cell[0]) && cell[2] != null && cell[3] >= series!.expectedMinutesPerHour && cell[4] === 0) cells.set(cellKey(cell[0], cell[1]), cell[2]);
  return cells;
}
/** Hour cells of several meters added together, kept only where every meter has a complete reading. */
function sumCells(parts: Cells[]): Cells {
  const [first, ...rest] = parts;
  const out: Cells = new Map();
  if (!first) return out;
  for (const [key, value] of first) {
    let total = value, ok = true;
    for (const part of rest) { const other = part.get(key); if (other === undefined) { ok = false; break; } total += other; }
    if (ok) out.set(key, total);
  }
  return out;
}
const periodSum = (series: TrendSeries | null | undefined, dates: Set<string>) => (series?.cells ?? []).reduce((sum, cell) => dates.has(cell[0]) && cell[2] != null ? sum + cell[2] : sum, 0);

/** Official circuits across the spaces; channels with the same board, type and name apart from a number become one row ("LED Display ×3"). */
function officialCircuits(data: AnalysisData, locale: EnergyIqLocale): Array<{ key: string; name: string; code: string; board: string; space: string; category: AnalysisCategory | "overall"; meters: ScopeMeter[] }> {
  const t = modelText(locale);
  const sources = data.current.spaces.length ? data.current.spaces : [data.current.project];
  const seen = new Set<string>();
  const groups = new Map<string, { key: string; name: string; board: string; space: string; category: AnalysisCategory | "overall"; meters: ScopeMeter[] }>();
  for (const space of sources) for (const meter of space.meters) {
    if (!meter.official || meter.category === "overall" || !meter.series || seen.has(meter.id)) continue;
    seen.add(meter.id);
    const stem = meter.name.replace(/\s*\d+$/, "").trim();
    const key = `${meter.location}|${meter.category}|${stem}`;
    const group = groups.get(key) ?? { key: meter.id, name: stem, board: meter.location, space: space.name, category: meter.category, meters: [] };
    group.meters.push(meter);
    groups.set(key, group);
  }
  const list = [...groups.values()].map(group => ({ ...group, code: group.meters.length === 1 ? group.meters[0]!.name : `${group.name} 1–${group.meters.length}`, name: plainName(group, sources.length > 1, locale) }));
  // Two circuits with the same plain name (two lighting boards in one area) keep their panel names apart.
  return list.map(group => list.filter(other => other.name === group.name).length > 1 ? { ...group, name: t("circuit.withCode", { name: group.name, code: group.code }) } : group);
}

/** Everyday words, keeping acronyms such as LED or TV. */
const everyday = (text: string) => text.split(/\s+/).map(word => /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()).join(" ");
/** "Space 1 - Office Area" → "Office Area". */
export const areaName = (space: string) => space.replace(/^space\s*\d+\s*[-–:]\s*/i, "").trim();
/**
 * What a circuit feeds, in words a new user understands: "Office area lights", "Shared area equipment & sockets",
 * "3 LED displays". Panel codes such as "DB1 L1 Light" mean nothing to someone new, so they only appear as detail.
 * Area and meter names come from the project as written; English lowers them to everyday words.
 */
function plainName(group: { name: string; space: string; category: AnalysisCategory | "overall"; meters: ScopeMeter[] }, byArea: boolean, locale: EnergyIqLocale) {
  const t = modelText(locale), en = locale === "en";
  const what = group.category === "light" || group.category === "load" || group.category === "aircon" ? group.category : null;
  if (what) return capitalise(byArea ? t(`circuit.${what}In`, { area: en ? everyday(areaName(group.space)) : areaName(group.space) }) : t(`circuit.${what}`));
  if (group.meters.length === 1) return group.meters[0]!.name;
  const stem = everyday(group.name);
  return t("circuit.many", { count: group.meters.length, things: en ? stem.endsWith("s") ? stem : `${stem}s` : group.name });
}
/** Socket, IT, kitchen and plug circuits feed equipment that may rightly stay on (fridges, servers), unlike lights or air-con. */
const isEquipment = (category: AnalysisCategory | "overall") => category === "load" || category === "it" || category === "kitchen" || category === "plug";
/** Plural names ("lights", "3 LED displays") take plural verbs. */
const isPlural = (circuit: { name: string; meterIds: string[] }) => circuit.meterIds.length > 1 || /s$/.test(circuit.name);

/** "half floor" on level 27 reads as "half of Level 27". */
function occupancyText(property: NonNullable<SpatialExtras["property"]>, t: T) {
  const level = property.level !== undefined ? t("level", { level: property.level }) : null;
  const extent = property.occupancyExtent?.trim();
  if (extent && level) return /^half/i.test(extent) ? t("occupancy.half", { level }) : t("occupancy.extent", { extent, level });
  return extent || level || "";
}
const street = (address: string) => address.replace(/,?\s*Singapore$/i, "");

// ---------- the report ----------
export function buildSiteReport(data: AnalysisData, referenceInput: ProjectSpatialReference | null, generatedAt = new Date().toISOString(), locale: EnergyIqLocale = "en"): SiteReport {
  const t = modelText(locale), en = locale === "en";
  const list = (items: string[]) => listText(items, locale);
  const count = (n: number) => numberWord(n, locale);
  const paragraph = (parts: string[]) => sentences(parts, locale);
  // English lowers plain names inside a sentence and says "the 3 LED displays"; other languages keep names as written.
  const inl = (name: string) => en ? inline(name) : name;
  const theName = (name: string) => en ? `${/^\d/.test(name) ? "the " : ""}${inline(name)}` : name;
  const reference = referenceInput as SpatialExtras | null;
  const project = data.current.project;
  const dates = project.dates;
  const dateSet = new Set(dates);
  const days = scopeDays(project, data.holidays);
  const hours = effectiveHours(data.openingHours);
  const hoursPublished = hours === data.openingHours;
  const dayOf = new Map(days.map(day => [day.date, day]));
  const isOpen = (date: string, hour: number) => dayOf.get(date)?.dayType === "weekday" && isOpenHour(hours, date, hour);
  const openRange = openingWindow(hours);
  const currency = project.cost?.currency ?? "SGD";
  const rate = project.cost && project.usageKwh ? project.cost.amount / project.usageKwh : null;
  const rateLabel = rate == null ? null : t(project.cost?.note.includes("before tax") ? "rate.beforeGst" : project.cost?.note.includes("incl. tax") ? "rate.inclGst" : "rate.plain", { rate: moneyText(rate, currency, 4) });
  const cost = (kwh: number) => rate == null ? null : kwh * rate;
  const money = (value: number | null, digits = 0) => value == null ? "—" : moneyText(value, currency, digits);
  const siteWord = /school|poly|campus|college|universit/i.test(data.projectName) ? "campus" : /office/i.test(data.projectName) ? "office" : "site";
  const site = t(`site.${siteWord}`);
  const siteName = t(new RegExp(`\\b${siteWord}\\b`, "i").test(data.projectName) ? "siteName.named" : "siteName.withWord", { name: data.projectName, site });
  const tzLabel = data.timezone === "Asia/Singapore" ? "SGT" : data.timezone;
  const totalKwh = project.usageKwh ?? periodSum(project.total, dateSet);

  // Days, averages and base load. Public holidays count with weekends as closed days.
  const reportDays: ReportDay[] = days.map(day => ({ date: day.date, dow: weekdayOf(day.date, locale), kwh: day.totalKwh, dayType: day.dayType, holidayName: day.holidayName, complete: day.complete }));
  const weekdayAvg = mean(days.filter(day => day.complete && day.dayType === "weekday").map(day => day.totalKwh));
  const weekendAvg = mean(days.filter(day => day.complete && day.dayType !== "weekday").map(day => day.totalKwh));
  const baseKw = alwaysOnKw(project);
  const baseDayKwh = baseKw == null ? null : baseKw * 24;
  const readingHours = (project.total?.cells ?? []).filter(cell => dateSet.has(cell[0]) && cell[2] != null).length;
  const baseShare = baseKw != null && totalKwh > 0 ? Math.min(1, baseKw * readingHours / totalKwh) : null;
  const buckets = timeBuckets(project, days, data.openingHours);
  const closedShare = buckets.total > 0 ? buckets.closedKwh / buckets.total : null;

  // Circuits, largest first
  const weekdayDates = days.filter(day => day.dayType === "weekday").map(day => day.date);
  const zonesRef = reference?.layout.zones ?? [];
  // A zone claims its panel and any meter locations it names. Sites that file
  // meters by area rather than by panel would otherwise match nothing the moment
  // an area is renamed, and every zone would hold no circuits while still
  // drawing on the plan — which reads as a site that used no electricity.
  const zoneForBoard = new Map(zonesRef.flatMap(zone =>
    [zone.referenceBoard, ...(zone.meterLocations ?? [])].map(board => [board, zone.id] as const)));
  // A colour chosen for one area in the floor plan editor wins over its board's colour.
  const validColour = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
  const chosenColour = (board: string) => { const value = reference?.layout.boardColours?.[board]; return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined; };
  const zoneName = (id: string) => id.length <= 2 ? t("zone.name", { id }) : id;
  const raw = officialCircuits(data, locale).map(group => {
    const perMeter = group.meters.map(meter => completeCells(meter.series, dateSet));
    const cells = sumCells(perMeter);
    const daily = (date: string) => {
      let total = 0;
      for (let hour = 0; hour < 24; hour += 1) { const value = cells.get(cellKey(date, hour)); if (value === undefined) return null; total += value; }
      return total;
    };
    const dailyValues = dates.map(date => ({ date, kwh: daily(date) }));
    const weekdayPerDay = mean(dailyValues.filter(item => item.kwh != null && dayOf.get(item.date)?.dayType === "weekday").map(item => item.kwh!));
    const weekendPerDay = mean(dailyValues.filter(item => item.kwh != null && dayOf.get(item.date)?.dayType !== "weekday").map(item => item.kwh!));
    const monthKwh = (weekdayPerDay ?? weekendPerDay ?? 0) * 30 * 5 / 7 + (weekendPerDay ?? weekdayPerDay ?? 0) * 30 * 2 / 7;
    const periodKwh = group.meters.reduce((sum, meter) => sum + periodSum(meter.series, dateSet), 0);
    const open: number[] = [], closed: number[] = [];
    for (const [key, value] of cells) { const [date, hour] = key.split("|"); (isOpen(date!, Number(hour)) ? open : closed).push(value); }
    return { ...group, cells, perMeter, weekdayPerDay, weekendPerDay, monthKwh, periodKwh, openBase: mean(open), closedBase: mean(closed), zone: zoneForBoard.get(group.board) ?? null, gapDays: dailyValues.filter(item => item.kwh == null).length };
  }).sort((a, b) => b.monthKwh - a.monthKwh);
  const monthKwh = raw.reduce((sum, circuit) => sum + circuit.monthKwh, 0);
  const monthCost = cost(monthKwh);
  const circuits: ReportCircuit[] = raw.map((circuit, index) => {
    const screen = screenCircuit(circuit, { dates, weekdayDates, isOpen, openRange, locale });
    return {
      key: circuit.key, name: circuit.name, code: circuit.code, codes: circuit.meters.map(meter => meter.name), label: circuit.zone ? t("circuit.inZone", { name: circuit.name, zone: zoneName(circuit.zone) }) : circuit.name, board: circuit.board, zone: circuit.zone, category: circuit.category, meterIds: circuit.meters.map(meter => meter.id),
      weekdayPerDay: circuit.weekdayPerDay, weekendPerDay: circuit.weekendPerDay, periodKwh: circuit.periodKwh, monthKwh: circuit.monthKwh, monthCost: cost(circuit.monthKwh),
      share: monthKwh > 0 ? circuit.monthKwh / monthKwh : 0, openBase: circuit.openBase, closedBase: circuit.closedBase,
      ratio: circuit.openBase && circuit.closedBase != null ? circuit.closedBase / circuit.openBase : null, hours: circuit.cells.size, gapDays: circuit.gapDays,
      // Brand orange for the largest load, then a fixed order, as in the reference report; every slice is also labelled.
      finding: screen.finding, eveningKwh: screen.eveningKwh, flat: screen.flat, colour: LOAD_PALETTE[index % LOAD_PALETTE.length]!,
    };
  });
  const circuitName = (key: string) => circuits.find(circuit => circuit.key === key)!.name;

  // Zones: from the floor layout when there is one, else one per space.
  const zoneList: ReportZone[] = reference && zonesRef.length ? [...zonesRef].sort((a, b) => a.id.localeCompare(b.id)).map((zone, index) => {
    const own = circuits.filter(circuit => circuit.zone === zone.id);
    const rooms = zone.rooms?.length ? zone.rooms : reference.layout.rooms.filter(room => room.zone === zone.id).map(room => room.name);
    const areas = [...new Set(raw.filter(circuit => circuit.zone === zone.id).map(circuit => areaName(circuit.space)))];
    return { key: zone.id, label: zoneName(zone.id), area: zone.independentSpace === false ? zone.equipment ?? null : areas.length === 1 && data.current.spaces.length > 1 ? areas[0]! : null, board: zone.referenceBoard, rect: (zone.rect as Rect | undefined) ?? null, subgroup: zone.independentSpace === false, parentRoom: zone.physicalParentRoom ?? null, equipment: zone.equipment ?? null,
      direction: zone.directionFromEntrance ?? null, rooms, circuitKeys: own.map(circuit => circuit.key), monthKwh: own.reduce((sum, circuit) => sum + circuit.monthKwh, 0), periodKwh: own.reduce((sum, circuit) => sum + circuit.periodKwh, 0),
      share: 0, alwaysOn: own.length > 0 && own.every(circuit => circuit.flat), colour: validColour((zone as { colour?: unknown }).colour) ?? chosenColour(zone.referenceBoard) ?? ZONE_PALETTE[index % ZONE_PALETTE.length]! };
  }) : spacesAsZones(raw.map((circuit, index) => ({ space: circuit.space, circuit: circuits[index]! })));
  const zoneTotal = zoneList.reduce((sum, zone) => sum + zone.monthKwh, 0);
  for (const zone of zoneList) zone.share = zoneTotal > 0 ? zone.monthKwh / zoneTotal : 0;
  const zones = zoneList.filter(zone => zone.monthKwh > 0 || zone.rect);
  const parentZone = (zone: ReportZone) => zones.find(item => !item.subgroup && zone.parentRoom && item.rooms.includes(zone.parentRoom));

  // ---------- masthead, title, key figures ----------
  const property = reference?.property;
  const place = [property?.address ? street(property.address) : null, property?.level !== undefined ? t("level", { level: property.level }) : null].filter(Boolean).join(", ");
  const periodText = dates.length ? formatPeriod(dates[0]!, dates.at(-1)!, locale) : "";
  const circuitCount = circuits.reduce((sum, circuit) => sum + circuit.meterIds.length, 0);
  const lede = paragraph([
    t(circuitCount === 1 ? "lede.drew.one" : "lede.drew.other", { days: dates.length, site, kwh: kwhText(totalKwh), count: circuitCount }),
    baseKw != null && baseShare != null && baseShare >= 0.5 ? t("lede.idles", { kw: kwText(baseKw) })
      : closedShare != null && closedShare >= 0.4 ? t("lede.closed", { pct: pctText(closedShare), site })
      : t("lede.working"),
  ]);
  const keyFigures = [
    { value: kwhText(totalKwh), label: t("kf.total", { days: dates.length }) },
    { value: weekdayAvg != null && weekendAvg != null ? `${grouped(weekdayAvg)} / ${grouped(weekendAvg)}` : "—", label: t("kf.weekdayWeekend") },
    { value: baseKw != null ? kwText(baseKw) : "—", label: baseShare != null ? t("kf.baseShare", { pct: pctText(baseShare) }) : t("kf.base") },
    { value: closedShare != null ? pctText(closedShare, 1) : "—", label: t("kf.closed", { kwh: kwhText(buckets.closedKwh) }) },
  ];

  // ---------- 1. property profile ----------
  const boards = [...new Set(circuits.map(circuit => circuit.board).filter(Boolean))];
  const boardsText = t(boards.length === 1 ? "profile.boards.one" : "profile.boards.other", { count: count(boards.length) });
  const zonesText = t(zones.length === 1 ? "profile.zones.one" : "profile.zones.other", { count: count(zones.length) });
  const profileIntro = property?.address
    ? paragraph([
      t("profile.occupies", { site: siteName, where: t(property.approximateAreaM2 ? "profile.whereArea" : "profile.where", { occupancy: occupancyText(property, t), street: street(property.address), m2: grouped(property.approximateAreaM2 ?? 0) }) }),
      t(reference?.layout.entrance ? "profile.mappedEntrance" : "profile.mapped", { boards: boardsText, zones: zonesText }),
    ])
    : t("profile.grouped", { boards: boardsText, zones: zonesText });
  const meteredAs = (zone: ReportZone) => zone.circuitKeys.length ? list(zone.circuitKeys.map(key => { const item = circuits.find(circuit => circuit.key === key)!; return t("metered.item", { name: inl(item.name), code: item.code }); })) : t("metered.none");
  const direction = (value: string) => value === "left" || value === "right" ? t(`direction.${value}`) : value;
  const profileZones = zones.map(zone => zone.subgroup
    ? { heading: t("zone.subHeading", { zone: zone.label, board: zone.board }), text: t(zone.parentRoom ? "zone.subText" : "zone.subTextNoRoom", {
      equipment: zone.equipment ? en ? zone.equipment.charAt(0).toLowerCase() + zone.equipment.slice(1) : zone.equipment : t("zone.equipment"),
      room: zone.parentRoom ? en ? zone.parentRoom.toLowerCase() : zone.parentRoom : "", metered: meteredAs(zone), board: zone.board, zone: zone.label }) }
    : { heading: t(zone.direction ? "zone.headingDirection" : "zone.heading", { zone: zone.label, direction: zone.direction ? direction(zone.direction) : "", board: zone.board }),
      text: t(zone.rooms.length ? "zone.textRooms" : "zone.text", { rooms: list(zone.rooms), metered: meteredAs(zone) }) });
  const hasMap = !!reference && zones.some(zone => !zone.subgroup && zone.rect);
  const captionPlace = [data.projectName, place].filter(Boolean).join(", ");
  const profileCaption = t("profile.caption", { where: property?.occupancyExtent || property?.approximateAreaM2
    ? t("profile.captionWhere", { where: captionPlace, extras: [property?.occupancyExtent, property?.approximateAreaM2 ? `≈${grouped(property.approximateAreaM2)} m²` : null].filter(Boolean).join(", ") })
    : captionPlace });

  // ---------- 2. 30-day estimate ----------
  const ranked = [...zones].sort((a, b) => b.monthKwh - a.monthKwh);
  const largest = circuits[0];
  const flatCircuit = circuits.find(circuit => circuit.flat && circuit !== largest);
  const cheaper = flatCircuit && circuits.find(circuit => circuit.monthKwh < flatCircuit.monthKwh && circuit.zone !== flatCircuit.zone && !circuit.flat);
  const plural = isPlural;
  const comparison = paragraph([
    ranked.length > 1 ? t("cmp.hungriest", { zone: ranked[0]!.label, pct: pctText(ranked[0]!.share), others: list(ranked.slice(1).map(zone => t("cmp.otherZone", { zone: zone.label, pct: pctText(zone.share) }))) }) : "",
    largest ? t(plural(largest) ? "cmp.largest.other" : "cmp.largest.one", { name: inl(largest.name), pct: pctText(largest.share), rest: flatCircuit?.monthCost != null
      ? t(plural(flatCircuit) ? "cmp.flat.other" : "cmp.flat.one", { name: theName(flatCircuit.label), cost: money(flatCircuit.monthCost), more: cheaper ? t("cmp.more", { name: inl(cheaper.label) }) : "" })
      : t("cmp.end") }) : "",
  ]);
  const subgroupZones = zones.filter(zone => zone.subgroup);
  // Days every circuit misses (the edges of the data) are not gaps; name only circuits with extra missing days.
  const commonGap = Math.min(...circuits.map(circuit => circuit.gapDays));
  const gapCircuits = circuits.filter(circuit => circuit.gapDays > commonGap && circuit.gapDays < dates.length);
  const zoneBoard = (zone: ReportZone, withEquipment = false) => t(withEquipment && zone.equipment ? "caption.zoneBoardEquipment" : "caption.zoneBoard", { zone: zone.label, board: zone.board, equipment: zone.equipment ?? "" });
  const estimate = {
    monthKwh, monthCost,
    intro: paragraph([t("est.intro", { kwh: kwhText(monthKwh) }), monthCost != null ? t("est.bill", { rate: rateLabel ?? "", cost: money(monthCost) }) : t("est.noRate")]),
    comparison,
    spaceCaption: subgroupZones.length ? t("caption.split", {
      zones: list(subgroupZones.map(zone => zoneBoard(zone, true))),
      parents: list([...new Set(subgroupZones.map(zone => { const parent = parentZone(zone); return parent ? zoneBoard(parent) : t("caption.parentUnknown"); }))]),
    }) : t("caption.shares"),
    loadCaption: largest ? t(plural(largest) ? "caption.largest.other" : "caption.largest.one", { name: capitalise(largest.name), rest: flatCircuit
      ? t(plural(flatCircuit) ? "caption.rank.other" : "caption.rank.one", { name: inl(flatCircuit.name), rank: en ? ordinal(circuits.indexOf(flatCircuit) + 1) : t("rank", { n: circuits.indexOf(flatCircuit) + 1 }) }) : "" }) : "",
    note: paragraph([
      t("note.method"),
      gapCircuits.length ? t(gapCircuits.length === 1 ? "note.gaps.one" : "note.gaps.other", { items: list(gapCircuits.map(circuit => t(circuit.gapDays === 1 ? "note.gapDays.one" : "note.gapDays.other", { name: inl(circuit.name), days: circuit.gapDays }))) }) : "",
      rate != null ? t("note.cost", { rate: rateLabel ?? "" }) : "",
    ]),
  };

  // ---------- 3. benchmark ----------
  const closeToWeekend = baseDayKwh != null && weekendAvg != null && Math.abs(weekendAvg - baseDayKwh) / baseDayKwh <= 0.08;
  const baseMonthKwh = baseKw == null ? null : baseKw * 720;
  const baseMonthCost = baseMonthKwh == null ? null : cost(baseMonthKwh);
  const benchmarkRows = [
    weekdayAvg != null ? { label: t("bench.weekday"), rate: t("bench.avg", { kw: kwText(weekdayAvg / 24) }), perDay: kwhText(weekdayAvg), perMonth: "—", cost: rate != null ? t("bench.perDay", { cost: money(weekdayAvg * rate, 2) }) : "—", hot: false } : null,
    weekendAvg != null ? { label: t("bench.weekend"), rate: t("bench.avg", { kw: kwText(weekendAvg / 24) }), perDay: kwhText(weekendAvg), perMonth: "—", cost: rate != null ? t("bench.perDay", { cost: money(weekendAvg * rate, 2) }) : "—", hot: false } : null,
    baseKw != null ? { label: t("bench.base"), rate: kwText(baseKw), perDay: kwhText(baseDayKwh!), perMonth: kwhText(baseMonthKwh!), cost: baseMonthCost != null ? t("bench.perMonth", { cost: money(baseMonthCost) }) : "—", hot: true } : null,
  ].filter((row): row is NonNullable<typeof row> => !!row);
  const baseBillShare = baseMonthKwh != null && monthKwh > 0 ? Math.min(1, baseMonthKwh / monthKwh) : null;
  const benchmark = {
    days: reportDays, weekdayAvg, weekendAvg, baseKw, baseDayKwh, closeToWeekend, rows: benchmarkRows,
    intro: weekdayAvg != null && baseKw != null
      ? paragraph([
        t(weekendAvg != null ? "bench.intro" : "bench.introNoWeekend", { weekday: kwhText(weekdayAvg), weekend: weekendAvg != null ? kwhText(weekendAvg) : "", kw: kwText(baseKw), day: kwhText(baseDayKwh!) }),
        closeToWeekend ? t("bench.same") : weekendAvg != null ? t("bench.weekendsAdd", { kwh: kwhText(Math.max(0, weekendAvg - baseDayKwh!)) }) : "",
      ])
      : t("bench.none"),
    caption: paragraph([
      t("cap.daily"),
      weekdayAvg != null ? t("cap.solidValue", { kwh: kwhText(weekdayAvg) }) : t("cap.solid"),
      t("cap.dashed", { value: baseKw != null ? t("cap.dashedValue", { kw: kwText(baseKw), day: kwhText(baseDayKwh!) }) : "", same: closeToWeekend && weekendAvg != null ? t("cap.sameAsWeekend", { kwh: kwhText(weekendAvg) }) : "" }),
      t("cap.paler"),
    ]),
    outro: baseMonthKwh == null || baseBillShare == null ? ""
      : baseBillShare >= 0.5
        ? t("outro.high", { kwh: kwhText(baseMonthKwh), pct: pctText(baseBillShare), costs: baseMonthCost != null && monthCost != null ? t("outro.costs", { base: money(baseMonthCost), month: money(monthCost) }) : "",
          extra: monthCost != null && baseMonthCost != null ? t("bench.perMonth", { cost: money(Math.max(0, monthCost - baseMonthCost)) }) : kwhText(Math.max(0, monthKwh - baseMonthKwh)) })
        : t("outro.low", { kwh: kwhText(baseMonthKwh), pct: pctText(baseBillShare) }),
  };

  // ---------- 4. weekday pattern ----------
  const pattern = weekdayPattern({ project, days, openRange, baseKw, circuits: raw.map((circuit, index) => ({ name: circuits[index]!.name, plural: isPlural(circuits[index]!), category: circuit.category, cells: circuit.cells })), hoursPublished, site, locale });

  // ---------- 5. screening ----------
  const tail = circuits.filter(circuit => circuit.eveningKwh != null && circuit.eveningKwh >= 0.3);
  const flat = circuits.filter(circuit => circuit.flat);
  const target = flat.find(circuit => !isEquipment(circuit.category)) ?? flat[0];
  const closedHoursPerMonth = 30 * 24 - 30 * 5 / 7 * (openRange.to - openRange.from);
  const targetSaving = target?.closedBase != null && rate != null ? target.closedBase * closedHoursPerMonth * rate : null;
  const tailSaving = rate != null && tail.length ? tail.reduce((sum, circuit) => sum + circuit.eveningKwh! * 30 * 5 / 7, 0) * rate : null;
  const tailNames = list(tail.map(circuit => t("call.tailItem", { name: inl(circuit.name), time: clock(openRange.to, locale), kwh: grouped(circuit.eveningKwh!, 1) })));
  const flatNames = list(flat.map(circuit => inl(circuit.name)));
  const callout = paragraph([
    tail.length || flat.length ? t(tail.length ? "call.habits" : "call.alwaysOn") : t("call.none"),
    tail.length ? t(tail.length === 1 ? "call.timer.one" : "call.timer.other", { items: capitalise(tailNames), worth: tailSaving != null ? t("call.worth", { cost: money(tailSaving) }) : "", end: t(flat.length ? "call.semicolon" : "call.period") }) : "",
    // A new sentence when nothing came before it; after "…timer;" it carries on the same sentence.
    flat.length ? t(flat.length === 1 ? "call.flat.one" : "call.flat.other", { names: tail.length ? flatNames : en ? `The ${flatNames}` : capitalise(flatNames), site }) : "",
    target && targetSaving != null && target.monthCost != null ? t(plural(target) ? "call.target.other" : "call.target.one", { name: theName(target.name), saving: money(targetSaving), cost: money(target.monthCost), year: money(targetSaving * 12) }) : "",
  ]);
  const screening = {
    intro: t("scr.intro", { days: dates.length, range: hourRange(openRange.from, openRange.to, locale), pct: pctText(SCREEN_PCT), kwh: SCREEN_KWH }),
    rows: circuits.map(circuit => {
      const per = (value: number | null) => { if (value == null) return "—"; const each = (value / circuit.meterIds.length).toFixed(2); return plural(circuit) ? t("scr.each", { value: each }) : each; };
      return { label: circuit.label, code: circuit.code, open: per(circuit.openBase), closed: per(circuit.closedBase), finding: circuit.finding };
    }),
    callout,
    note: t("scr.note", { days: dates.length, schedule: t(hoursPublished ? "scr.published" : "scr.assumed"), pct: pctText(SCREEN_PCT), kwh: SCREEN_KWH }),
  };

  const headlineTopic: HeadlineTopic = baseBillShare != null && baseBillShare >= 0.5 && baseMonthCost != null && monthCost != null ? "always-on"
    : closedShare != null && closedShare >= 0.4 ? "after-hours" : "working-hours";
  const generatedDay = generatedAt.slice(0, 10);
  return {
    locale, projectName: data.projectName, siteWord, timezone: data.timezone, tzLabel, from: dates[0] ?? "", to: dates.at(-1) ?? "", dayCount: dates.length, generatedAt,
    currency, rate, rateLabel,
    masthead: { site: data.projectName, detail: [place, t(`mast.report.${siteWord}`)].filter(Boolean).join(" · "), period: periodText, periodNote: t("mast.periodNote", { days: dates.length, tz: tzLabel }) },
    title: headline(site, baseShare, closedShare, t), lede, keyFigures,
    headline: headlineTopic === "always-on" ? t("head.alwaysOn", { base: money(baseMonthCost), month: money(monthCost) })
      : headlineTopic === "after-hours" ? t(rate != null ? "head.closedCost" : "head.closed", { pct: pctText(closedShare!), cost: rate != null ? money(buckets.closedKwh * rate * 30 / Math.max(dates.length, 1)) : "" })
      : t("head.working"),
    headlineTopic,
    profile: { intro: profileIntro, zones: profileZones, caption: profileCaption, hasMap },
    reference: hasMap ? reference : null,
    zones, circuits, estimate, benchmark, pattern, screening,
    footer: { left: t("foot.left", { count: circuitCount, tz: tzLabel }), right: t("foot.right", { date: en ? `${shortDate(generatedDay)} ${generatedAt.slice(0, 4)}` : formatPeriod(generatedDay, generatedDay, locale) }) },
  };
}

const ordinal = (n: number) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n] ?? `#${n}`;

/** The weekday opening window as whole hours, for labels and the shaded band. */
function openingWindow(hours: Record<string, Array<{ from: string; to: string }>>) {
  const ranges = ["monday", "tuesday", "wednesday", "thursday", "friday"].flatMap(day => hours[day] ?? []);
  const toHour = (time: string) => { const [h = "0", m = "0"] = time.split(":"); return Number(h) + Number(m) / 60; };
  if (!ranges.length) return { from: 8, to: 18 };
  return { from: Math.round(Math.min(...ranges.map(range => toHour(range.from)))), to: Math.round(Math.max(...ranges.map(range => toHour(range.to)))) };
}

/** "Three-quarters of the office load never switches off", or the outside-hours story, or the steady story. `site` is the reader's word for it. */
function headline(site: string, baseShare: number | null, closedShare: number | null, t: T): SiteReport["title"] {
  if (baseShare != null && baseShare >= 0.45) {
    const fractions: Array<[number, SiteReportModelKey]> = [[1 / 2, "fraction.half"], [3 / 5, "fraction.threeFifths"], [2 / 3, "fraction.twoThirds"], [3 / 4, "fraction.threeQuarters"], [4 / 5, "fraction.fourFifths"], [9 / 10, "fraction.nineTenths"]];
    const [value, key] = fractions.reduce((best, item) => Math.abs(item[0] - baseShare) < Math.abs(best[0] - baseShare) ? item : best);
    const word = t(key);
    const phrase = Math.abs(value - baseShare) <= 0.025 ? capitalise(word) : t(baseShare < value ? "title.nearly" : "title.over", { word });
    return { before: t("title.alwaysOn", { phrase, site }), emphasis: t("title.alwaysOnEmphasis") };
  }
  if (closedShare != null && closedShare >= 0.4) return { before: t("title.closed", { pct: pctText(closedShare) }), emphasis: t("title.closedEmphasis") };
  return { before: t("title.steady", { site }), emphasis: t("title.steadyEmphasis") };
}

/** Without a floor layout, each space is a zone. */
function spacesAsZones(items: Array<{ space: string; circuit: ReportCircuit }>): ReportZone[] {
  const spaces = [...new Set(items.map(item => item.space))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return spaces.map((space, index) => {
    const own = items.filter(item => item.space === space).map(item => item.circuit);
    return { key: space, label: space, area: null, board: [...new Set(own.map(circuit => circuit.board))].join(" + "), rect: null, subgroup: false, parentRoom: null, equipment: null, direction: null, rooms: [],
      circuitKeys: own.map(circuit => circuit.key), monthKwh: own.reduce((sum, circuit) => sum + circuit.monthKwh, 0), periodKwh: own.reduce((sum, circuit) => sum + circuit.periodKwh, 0), share: 0, alwaysOn: own.every(circuit => circuit.flat), colour: ZONE_PALETTE[index % ZONE_PALETTE.length]! };
  });
}

// ---------- 4. weekday hour-by-hour ----------
function weekdayPattern(input: { project: ScopeData; days: AnalysisDay[]; openRange: { from: number; to: number }; baseKw: number | null; circuits: Array<{ name: string; plural: boolean; category: AnalysisCategory | "overall"; cells: Cells }>; hoursPublished: boolean; site: string; locale: EnergyIqLocale }): SiteReport["pattern"] {
  const { locale } = input, t = modelText(locale), en = locale === "en";
  const inl = (name: string) => en ? inline(name) : name;
  const weekdays = input.days.filter(day => day.complete && day.dayType === "weekday").map(day => day.date);
  if (weekdays.length < 3 || !input.project.total) return null;
  const cells = completeCells(input.project.total, new Set(weekdays));
  const hourMean = (source: Cells, hour: number) => mean(weekdays.map(date => source.get(cellKey(date, hour))).filter((value): value is number => value !== undefined)) ?? 0;
  const profile = Array.from({ length: 24 }, (_, hour) => hourMean(cells, hour));
  const base = input.baseKw ?? Math.min(...profile);
  const peakHour = profile.reduce((best, value, hour) => hour >= 6 && hour < 22 && value > profile[best]! ? hour : best, 6);
  const peakKw = profile[peakHour]!;
  const range = Math.max(peakKw - base, 0.001);
  const rel = (hour: number) => (profile[hour]! - base) / range;
  // Implied working day: clearly above base in the morning, still well above it in the evening.
  const start = profile.findIndex((_, hour) => hour >= 4 && rel(hour) >= 0.15);
  let end = -1;
  for (let hour = 23; hour >= 0; hour -= 1) if (rel(hour) >= 0.6) { end = hour + 1; break; }
  if (start < 0 || end <= start) return null;
  // Arrival ramp: the largest morning rise, annotated where it starts, followed up to where it levels off.
  let ramp = start;
  for (let hour = start; hour < Math.min(12, end); hour += 1) if (profile[hour + 1]! - profile[hour]! > profile[ramp + 1]! - profile[ramp]!) ramp = hour;
  let rampTop = ramp + 1;
  while (rampTop < 12 && profile[rampTop + 1]! > profile[rampTop]! && rel(rampTop) < 0.85) rampTop += 1;
  // Lunch dip: the lowest point between 11:00 and 15:00, clearly below the hour before and the afternoon after.
  const low = [11, 12, 13, 14].reduce((best, hour) => profile[hour]! < profile[best]! ? hour : best, 11);
  const pre = [9, 10, 11, 12].filter(hour => hour < low).reduce((best, hour) => profile[hour]! > profile[best]! ? hour : best, Math.max(9, low - 1));
  const depth = profile[pre]! - profile[low]!;
  const afternoon = Math.max(...profile.slice(low + 1, Math.max(low + 2, Math.min(end + 1, 19))));
  const dipHours = low > pre && depth >= 0.05 * range && afternoon > profile[low]! + 0.05 * range
    ? [low - 1, low, low + 1].filter(hour => hour > pre && profile[hour]! <= profile[pre]! - depth * 0.6) : [];
  const peakHours = profile.map((value, hour) => ({ value, hour })).filter(item => item.hour >= 6 && item.hour < 22 && item.value >= 0.97 * peakKw).map(item => item.hour);
  const peakFrom = Math.min(...peakHours), peakTo = Math.max(...peakHours) + 1;
  const peakLow = Math.min(...peakHours.map(hour => profile[hour]!));
  let linger = end - 1;
  for (let hour = end; hour < 24; hour += 1) if (rel(hour) >= 0.1) linger = hour;
  const lights = input.circuits.filter(circuit => circuit.category === "light");
  const lightAbove = (hour: number) => lights.reduce((sum, circuit) => sum + hourMean(circuit.cells, hour) - hourMean(circuit.cells, 3), 0);
  const lightsLinger = linger >= end && lightAbove(linger) >= 0.5 * (profile[linger]! - base);
  const f1 = (value: number) => value.toFixed(1);
  const dipText = dipHours.length ? hourRange(Math.min(...dipHours), Math.max(...dipHours) + 1, locale) : "";
  const notes: ProfileNote[] = [
    { hour: ramp, kw: profile[ramp]!, text: t("note.ramp"), place: "left" },
    ...(dipHours.length ? [{ hour: low, kw: profile[low]!, text: t("note.dip"), place: "below" as const }] : []),
    { hour: peakHour, kw: peakKw, text: t("note.peak", { kw: kwText(peakKw), range: hourRange(peakFrom, peakTo, locale) }), place: "above-left" },
    ...(linger >= end ? [{ hour: linger, kw: profile[linger]!, text: t(lightsLinger ? "note.lightsLinger" : "note.loadLingers", { time: clock(linger + 1, locale) }), place: "above-right" as const }] : []),
  ];
  const intro = sentences([
    t(input.hoursPublished ? "pat.impliedPublished" : "pat.implied", { range: hourRange(start, end, locale), published: hourRange(input.openRange.from, input.openRange.to, locale) }),
    t(dipHours.length ? "pat.curveDip" : "pat.curve", {
      base: kwText(base), start: clock(start, locale), ramp: hourBetween(ramp, rampTop, locale), from: f1(profile[ramp]!), to: f1(profile[rampTop]!),
      dipKw: dipHours.length ? f1(mean(dipHours.map(hour => profile[hour]!))!) : "", dipRange: dipText,
      peak: f1(peakLow) === f1(peakKw) ? `${f1(peakKw)} kW` : `${f1(peakLow)}–${f1(peakKw)} kW`, peakBetween: hourBetween(peakFrom, peakTo, locale),
    }),
    linger >= end ? t(lightsLinger ? "pat.windLights" : "pat.windLoad", { end: clock(end, locale), until: clock(linger + 1, locale) }) : t("pat.fallsBack", { end: clock(end, locale) }),
  ], locale);

  // What causes the lunch dip: which circuits fall between the hour before it and the dip itself.
  let cause: string | null = null;
  if (dipHours.length) {
    const moves = input.circuits.map(circuit => {
      const before = hourMean(circuit.cells, pre), during = mean(dipHours.map(hour => hourMean(circuit.cells, hour)))!;
      return { ...circuit, before, during, drop: before - during };
    });
    const total = profile[pre]! - mean(dipHours.map(hour => profile[hour]!))!;
    const falling = moves.filter(move => move.category === "light" && move.drop > 0.02).sort((a, b) => b.drop - a.drop);
    const power = moves.filter(move => move.category !== "light");
    const lightShare = total > 0 ? falling.reduce((sum, move) => sum + move.drop, 0) / total : 0;
    if (falling.length && lightShare >= 0.5) cause = sentences([
      power.length && power.every(move => move.drop <= Math.max(0.03, move.before * 0.05)) ? t("cause.steady", { names: listText(power.map(move => inl(move.name)), locale), range: dipText }) : "",
      t(lightShare >= 0.9 ? "cause.entirely" : "cause.mostly", { items: listText(falling.map((move, index) => t(`cause.${index === 0 ? "first" : "next"}.${move.plural ? "other" : "one"}`, {
        name: inl(move.name), pct: pctText(move.drop / Math.max(move.before, 0.001)), before: move.before.toFixed(2), during: move.during.toFixed(2),
      })), locale) }),
      t("cause.together", { pct: pctText(Math.min(1, lightShare)), kw: total.toFixed(2) }),
    ], locale);
  }
  const weekdayTotal = profile.reduce((sum, value) => sum + value, 0);
  const openKwh = profile.reduce((sum, value, hour) => hour >= input.openRange.from && hour < input.openRange.to ? sum + value : sum, 0);
  const openShare = openKwh / Math.max(weekdayTotal, 0.001);
  return {
    hours: profile, openFrom: input.openRange.from, openTo: input.openRange.to, notes, intro, cause, weekdayCount: weekdays.length,
    caption: t("pat.caption", { count: weekdays.length, range: hourRange(input.openRange.from, input.openRange.to, locale), openKwh: kwhText(openKwh), pct: pctText(openShare), total: kwhText(weekdayTotal), rest: pctText(1 - openShare), site: input.site }),
  };
}

// ---------- 5. circuit screening ----------
type ScreenInput = { name: string; category: AnalysisCategory | "overall"; cells: Cells; perMeter: Cells[]; openBase: number | null; closedBase: number | null; meters: ScopeMeter[] };
function screenCircuit(circuit: ScreenInput, context: { dates: string[]; weekdayDates: string[]; isOpen: (date: string, hour: number) => boolean; openRange: { from: number; to: number }; locale: EnergyIqLocale }) {
  const { openBase, closedBase } = circuit;
  const { locale } = context, t = modelText(locale), at = (hour: number) => clock(hour, locale);
  const flagged = (value: number, base: number) => value > base * (1 + SCREEN_PCT) && value - base >= SCREEN_KWH;
  const openCells: Array<{ date: string; hour: number; value: number }> = [];
  let flags = 0, maxOver = 0;
  for (const [key, value] of circuit.cells) {
    const [date = "", hourText = "0"] = key.split("|"), hour = Number(hourText), open = context.isOpen(date, hour);
    if (open) openCells.push({ date, hour, value });
    const base = open ? openBase : closedBase;
    if (base != null && flagged(value, base)) { flags += 1; maxOver = Math.max(maxOver, value - base); }
  }
  const ratio = openBase && closedBase != null ? closedBase / openBase : null;
  const flat = ratio != null && ratio >= 0.85 && (closedBase ?? 0) >= 0.05;
  const neverOff = circuit.perMeter.every(cells => { const own = [...cells.values()], mid = median(own) ?? 0; return own.length > 0 && mid > 0.02 && Math.min(...own) >= mid * 0.6; });
  const quiet = flags <= Math.max(1, circuit.cells.size * 0.005);
  const several = circuit.meters.length > 1;
  const found: string[] = [];
  let eveningKwh: number | null = null;

  if (flat && neverOff && quiet && !isEquipment(circuit.category)) {
    found.push(t(several ? "find.zero.other" : "find.zero.one", { hours: grouped(circuit.cells.size), count: numberWord(circuit.meters.length, locale), days: context.dates.length }));
  } else if (flat) {
    found.push(t(quiet ? "find.flatQuiet" : "find.flat", { pct: pctText(ratio!) }));
  } else {
    // Evening tail: still on in the first hour after closing — on how many weekdays, and until when.
    const close = context.openRange.to;
    const tails: Array<{ first: number; offAt: number; extra: number }> = [];
    let seen = 0;
    if (closedBase != null) for (const date of context.weekdayDates) {
      const first = circuit.cells.get(cellKey(date, close));
      if (first === undefined) continue;
      seen += 1;
      if (!flagged(first, closedBase)) continue;
      let hour = close, extra = 0;
      for (let value = circuit.cells.get(cellKey(date, hour)); hour < 24 && value !== undefined && flagged(value, closedBase); hour += 1, value = circuit.cells.get(cellKey(date, hour))) extra += value - closedBase;
      tails.push({ first, offAt: hour, extra });
    }
    if (tails.length >= Math.max(2, seen * 0.3)) {
      const usual = Math.round(median(tails.map(item => item.offAt))!);
      const late = tails.map(item => item.offAt).filter(offAt => offAt >= Math.max(21, usual + 1));
      eveningKwh = mean(tails.map(item => item.extra));
      const lateText = !late.length ? "" : Math.min(...late) === Math.max(...late) ? t(late.length === 1 ? "find.late.one" : "find.late.other", { count: numberWord(late.length, locale), time: at(late[0]!) })
        : t("find.lateRange", { count: numberWord(late.length, locale), from: at(Math.min(...late)), to: at(Math.max(...late)) });
      found.push(t(`find.${circuit.category === "light" ? "lit" : "on"}${tails.length === seen ? "All" : "Some"}`, { close: at(close), count: tails.length, seen, kwh: mean(tails.map(item => item.first))!.toFixed(1), usual: at(usual), late: lateText }));
    }
    if (openBase != null) {
      // Days when daytime use ran well above its own daytime average.
      const high = context.weekdayDates.flatMap(date => {
        const own = openCells.filter(cell => cell.date === date).map(cell => cell.value);
        const value = mean(own);
        return value != null && own.length >= 4 && flagged(value, openBase) ? [{ date, pct: value / openBase - 1 }] : [];
      });
      // Short bursts inside working hours, typical of demo or meeting-room lighting, else whole days above normal.
      const spread = Math.sqrt(mean(openCells.map(cell => (cell.value - openBase) ** 2)) ?? 0) / openBase;
      const top = openCells.reduce<(typeof openCells)[number] | null>((best, cell) => !best || cell.value > best.value ? cell : best, null);
      const busiest = [...high].sort((a, b) => b.pct - a.pct).slice(0, 3).map(item => item.date);
      if (spread >= 0.35 && top && top.value >= openBase * 2.5 && flagged(top.value, openBase)) found.push(t("find.bursty", {
        date: shortDate(top.date, locale), time: at(top.hour), kwh: top.value.toFixed(1), times: (top.value / openBase).toFixed(1),
        busiest: busiest.length ? t("find.busiest", { days: listText(dateRuns(busiest, locale), locale) }) : "",
      }));
      else if (high.length && high.length <= 6) found.push(t("find.high", { dates: listText(dateRuns(high.map(item => item.date), locale), locale), pct: pctText(Math.max(...high.map(item => item.pct))) }));
    }
    if (!found.length) found.push(flags === 0 ? t(ratio != null && ratio >= 0.6 ? "find.steadyRatio" : "find.steady", { pct: ratio != null ? pctText(ratio) : "" })
      : t(flags === 1 ? "find.minor.one" : "find.minor.other", { count: flags, kwh: maxOver.toFixed(2) }));
  }
  return { finding: sentences(found, locale), eveningKwh, flat };
}

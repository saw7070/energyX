/** Pure calculations for the Analysis page, kept separate so every number on the page is testable. */
import type { ScopeData, TrendCell, TrendSeries } from "./analysis-types.js";
import { analysisMessages, analysisText, categoryLabel, joinText } from "./analysis-messages.js";
import { intlLocale, type EnergyIqLocale } from "./locale.js";

// English labels come from the page's wording so every language shares one list (see analysis-messages).
const EN = analysisMessages.en;

export type AnalysisCategory = "load" | "light" | "aircon" | "it" | "kitchen" | "plug" | "other";
export type AnalysisDayType = "weekday" | "weekend" | "public_holiday";
export type HoursByDay = Record<string, Array<{ from: string; to: string }>>;
export type AnalysisDay = { date: string; dayType: AnalysisDayType; holidayName?: string; complete: boolean; totalKwh: number; byCategory: Partial<Record<AnalysisCategory, number>> };
export type AnalysisBaseline = { dayType: AnalysisDayType; expectedKwh: number | null; samples: number };
export type AnalysisAnomaly = { date: string; dayType: AnalysisDayType; totalKwh: number; expectedKwh: number; deltaPct: number };
export type HourRow = { hour: number; total: number } & Partial<Record<AnalysisCategory, number>>;
export type PeakHour = { date: string; hour: number; kwh: number };

export const CATEGORY_ORDER: AnalysisCategory[] = ["light", "load", "aircon", "it", "kitchen", "plug", "other"];
/** English names; use categoryLabel(category, locale) from analysis-messages for the reader's language. */
export const CATEGORY_LABELS: Record<AnalysisCategory, string> = {
  load: EN["category.load"], light: EN["category.light"], aircon: EN["category.aircon"],
  it: EN["category.it"], kitchen: EN["category.kitchen"], plug: EN["category.plug"], other: EN["category.other"],
};
/** Plain-language meaning of each meter type, for people who do not know the electrical terms (categoryDescription for other languages). */
export const CATEGORY_DESCRIPTIONS: Record<AnalysisCategory, string> = {
  light: EN["categoryHint.light"], load: EN["categoryHint.load"], aircon: EN["categoryHint.aircon"],
  it: EN["categoryHint.it"], kitchen: EN["categoryHint.kitchen"], plug: EN["categoryHint.plug"], other: EN["categoryHint.other"],
};
// Muted mid-tone hues kept apart from each other (green, blue, violet, rose, amber, olive, grey), each at least 3:1 against white.
export const CATEGORY_COLORS: Record<AnalysisCategory, string> = {
  light: "#4F9B86", load: "#5B8BCF", aircon: "#9A8DBF", it: "#C0607F", kitchen: "#C47A28", plug: "#7A8F3C", other: "#8B95A5",
};
export const DAY_TYPE_LABELS: Record<AnalysisDayType, string> = { weekday: EN["dayType.weekday"], weekend: EN["dayType.weekend"], public_holiday: EN["dayType.public_holiday"] };
export const ANOMALY_THRESHOLD_PCT = 15;
export const MIN_BASELINE_SAMPLES = 3;
const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NIGHT_HOURS = (hour: number) => hour >= 22 || hour < 6;

export const localDayType = (date: string, publicHolidays: Map<string, string>): { dayType: AnalysisDayType; holidayName?: string } => {
  const holidayName = publicHolidays.get(date);
  if (holidayName !== undefined) return { dayType: "public_holiday", holidayName };
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { dayType: weekday === 0 || weekday === 6 ? "weekend" : "weekday" };
};

const dayCells = (series: TrendSeries | null | undefined, date: string) => series ? series.cells.filter(cell => cell[0] === date) : [];
/** Same completeness rule as Energy consumption: every expected minute received and no quality events. */
const dayValue = (series: TrendSeries | null | undefined, date: string) => {
  const cells = dayCells(series, date);
  const minutes = cells.reduce((sum, cell) => sum + cell[3], 0);
  return { kwh: minutes > 0 ? cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0) : null, complete: !!series && minutes >= series.expectedMinutesPerHour * 24 && cells.every(cell => cell[4] === 0) };
};

export function scopeDays(scope: ScopeData, holidays: Map<string, string>): AnalysisDay[] {
  return scope.dates.map(date => {
    const total = dayValue(scope.total, date);
    const byCategory: Partial<Record<AnalysisCategory, number>> = {};
    for (const category of CATEGORY_ORDER) { const value = dayValue(scope.types[category], date).kwh; if (value != null) byCategory[category] = value; }
    const type = localDayType(date, holidays);
    return { date, ...type, complete: total.complete, totalKwh: total.kwh ?? 0, byCategory };
  });
}

/** Expected daily use per day type: the mean of complete days of that type across the calibration window. */
export function dayTypeBaselines(days: AnalysisDay[]): AnalysisBaseline[] {
  return (Object.keys(DAY_TYPE_LABELS) as AnalysisDayType[]).map(dayType => {
    const samples = days.filter(day => day.complete && day.dayType === dayType).map(day => day.totalKwh);
    return { dayType, samples: samples.length, expectedKwh: samples.length >= MIN_BASELINE_SAMPLES ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null };
  });
}

/** Complete days whose use exceeds their day-type expectation by more than the threshold. */
export function findAnomalies(days: AnalysisDay[], baselines: AnalysisBaseline[], thresholdPct = ANOMALY_THRESHOLD_PCT): AnalysisAnomaly[] {
  const expected = new Map(baselines.map(item => [item.dayType, item.expectedKwh]));
  return days.flatMap(day => {
    const base = expected.get(day.dayType);
    if (!day.complete || base == null || base <= 0) return [];
    const deltaPct = (day.totalKwh / base - 1) * 100;
    return deltaPct > thresholdPct ? [{ date: day.date, dayType: day.dayType, totalKwh: day.totalKwh, expectedKwh: base, deltaPct }] : [];
  });
}

export function categoryTotals(days: AnalysisDay[]): Array<{ category: AnalysisCategory; kwh: number; share: number }> {
  const totals = CATEGORY_ORDER.map(category => ({ category, kwh: days.reduce((sum, day) => sum + (day.byCategory[category] ?? 0), 0) }));
  const all = totals.reduce((sum, item) => sum + item.kwh, 0);
  return totals.filter(item => item.kwh > 0).map(item => ({ ...item, share: all > 0 ? item.kwh / all : 0 }));
}

export const percentChange = (current: number | null | undefined, previous: number | null | undefined): number | null =>
  current == null || previous == null || previous <= 0 ? null : (current / previous - 1) * 100;

export const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Average kWh in each clock hour across the given dates, stacked by type when type series exist. */
export function hourlyProfile(scope: ScopeData, dates: string[]): HourRow[] {
  const set = new Set(dates);
  const categories = CATEGORY_ORDER.filter(category => scope.types[category]);
  return Array.from({ length: 24 }, (_, hour) => {
    const mean = (series: TrendSeries | null | undefined) => {
      const values = (series?.cells ?? []).filter(cell => set.has(cell[0]) && cell[1] === hour && cell[2] != null).map(cell => cell[2]!);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / set.size : 0;
    };
    const row: HourRow = { hour, total: mean(scope.total) };
    for (const category of categories) row[category] = mean(scope.types[category]);
    return row;
  });
}

export function topHours(scope: ScopeData, count = 5): PeakHour[] {
  const series = scope.total;
  if (!series) return [];
  return series.cells.filter(cell => cell[2] != null && cell[3] >= series.expectedMinutesPerHour)
    .map(cell => ({ date: cell[0], hour: cell[1], kwh: cell[2]! })).sort((a, b) => b.kwh - a.kwh).slice(0, count);
}

const minutesOf = (time: string) => { const [hours = "0", minutes = "0"] = time.split(":"); return Number(hours) * 60 + Number(minutes); };
/** Whether a clock hour falls inside the published operating hours of that weekday (half-open, by hour start). */
export const isOpenHour = (hours: HoursByDay | null, date: string, hour: number) => {
  const ranges = hours?.[WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]!] ?? [];
  return ranges.some(range => hour * 60 >= minutesOf(range.from) && hour * 60 < minutesOf(range.to));
};
export const openingLabel = (hours: HoursByDay | null) => { const range = hours?.monday?.[0]; return range ? `${range.from}–${range.to}` : "08:00–18:00"; };

export function windowSum(scope: ScopeData, dates: string[], include: (date: string, hour: number) => boolean) {
  const set = new Set(dates);
  return (scope.total?.cells ?? []).filter(cell => set.has(cell[0]) && cell[2] != null && include(cell[0], cell[1])).reduce((sum, cell) => sum + cell[2]!, 0);
}

export function weekdayWindows(scope: ScopeData, days: AnalysisDay[], hours: HoursByDay | null) {
  const weekdays = days.filter(day => day.dayType === "weekday").map(day => day.date);
  const total = windowSum(scope, weekdays, () => true);
  const open = windowSum(scope, weekdays, (date, hour) => hours ? isOpenHour(hours, date, hour) : hour >= 8 && hour < 18);
  const night = windowSum(scope, weekdays, (_date, hour) => NIGHT_HOURS(hour));
  return { total, open, openShare: total > 0 ? open / total : null, night, nightShare: total > 0 ? night / total : null };
}

/** Average hourly use of each circuit inside a space, for the usage heatmap. Sub-meters when present. */
export function meterHeatmap(space: ScopeData, dates: string[]) {
  const withSeries = space.meters.filter(meter => meter.series && meter.category !== "overall");
  const subMeters = withSeries.filter(meter => !meter.official);
  const meters = subMeters.length ? subMeters : withSeries;
  const set = new Set(dates);
  return meters.map(meter => ({
    id: meter.id, name: meter.name, category: meter.category,
    hours: Array.from({ length: 24 }, (_, hour) => {
      const values = meter.series!.cells.filter(cell => set.has(cell[0]) && cell[1] === hour && cell[2] != null).map(cell => cell[2]!);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / set.size : 0;
    }),
  })).sort((a, b) => b.hours.reduce((sum, value) => sum + value, 0) - a.hours.reduce((sum, value) => sum + value, 0));
}

/** Lowest overnight (00:00–06:00) load the site sustained for seven complete nights, against the latest seven. */
export function overnightFloor(scope: ScopeData) {
  const series = scope.total;
  if (!series) return null;
  const nights = scope.dates.flatMap(date => {
    const cells = series.cells.filter(cell => cell[0] === date && cell[1] < 6);
    const complete = cells.length === 6 && cells.every(cell => cell[2] != null && cell[3] >= series.expectedMinutesPerHour && cell[4] === 0);
    return complete ? [{ date, kw: cells.reduce((sum, cell) => sum + cell[2]!, 0) / 6 }] : [];
  });
  if (nights.length < 14) return null;
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2; };
  let best = { kw: Infinity, from: "", to: "" };
  for (let index = 6; index < nights.length; index += 1) {
    const window = nights.slice(index - 6, index + 1);
    const kw = median(window.map(night => night.kw));
    if (kw < best.kw) best = { kw, from: window[0]!.date, to: window[6]!.date };
  }
  const latest = nights.slice(-7);
  return { bestKw: best.kw, bestFrom: best.from, bestTo: best.to, latestKw: median(latest.map(night => night.kw)), latestFrom: latest[0]!.date, latestTo: latest.at(-1)!.date, nights: nights.length };
}

const fmt = (value: number, digits = 1) => value.toLocaleString("en-SG", { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 ? Math.min(digits, 1) : 0 });
const dayFormat = (date: string, locale: EnergyIqLocale, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : intlLocale(locale), { timeZone: "UTC", ...options }).format(new Date(`${date}T00:00:00Z`));
// en-GB writes "Sept"; every other month is three letters, so keep "Sep" for a consistent look.
/** "5 Sep"; Chinese "9月5日". */
export const shortDate = (date: string, locale: EnergyIqLocale = "en") => dayFormat(date, locale, { day: "numeric", month: "short" }).replace("Sept", "Sep");
/** Short weekday name: "Sat"; Chinese "周六"; Malay "Sab". */
export const weekdayShort = (date: string, locale: EnergyIqLocale = "en") => dayFormat(date, locale, { weekday: "short" });
/** Short month name for a calendar: "Sep"; Chinese "9月"; Malay "Sep". */
export const monthShort = (date: string, locale: EnergyIqLocale = "en") => dayFormat(date, locale, { month: "short" }).replace("Sept", "Sep");
/** "Sat 5 Sep"; Chinese "9月5日 周六". */
export const dateWithDay = (date: string, locale: EnergyIqLocale = "en") => locale === "zh-Hans" ? `${shortDate(date, locale)} ${weekdayShort(date, locale)}`
  : dayFormat(date, locale, { day: "numeric", month: "short", weekday: "short" }).replace(",", "").replace("Sept", "Sep");
/** "Sat 5 Sep 2026"; Chinese "2026年9月5日 周六". */
export const dateWithDayYear = (date: string, locale: EnergyIqLocale = "en") => locale === "zh-Hans" ? `${date.slice(0, 4)}年${dateWithDay(date, locale)}` : `${dateWithDay(date, locale)} ${date.slice(0, 4)}`;

// ---------- Decision summary: when money is spent, what stays on, and what could be saved ----------

export type TimeBucket = "open" | "after_hours" | "weekend" | "holiday";
export const TIME_BUCKETS: TimeBucket[] = ["open", "after_hours", "weekend", "holiday"];
export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = { open: EN["bucket.open"], after_hours: EN["bucket.after_hours"], weekend: EN["bucket.weekend"], holiday: EN["bucket.holiday"] };
// Validated categorical slots (blue, yellow, violet, orange); values are always printed beside them.
export const TIME_BUCKET_COLORS: Record<TimeBucket, string> = { open: "#2a78d6", after_hours: "#eda100", weekend: "#4a3aa7", holiday: "#eb6834" };
const WORKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
/** Operating hours used when the site has none published: Monday to Friday, 08:00–18:00. */
export const DEFAULT_OPENING_HOURS: HoursByDay = Object.fromEntries(WORKDAYS.map(day => [day, [{ from: "08:00", to: "18:00" }]]));
export const effectiveHours = (hours: HoursByDay | null) => hours && Object.values(hours).some(ranges => ranges.length) ? hours : DEFAULT_OPENING_HOURS;

/** Which part of the week an hour belongs to. Public holidays count as closed all day. */
export function bucketOf(hours: HoursByDay, date: string, dayType: AnalysisDayType, hour: number): TimeBucket {
  if (dayType === "public_holiday") return "holiday";
  if (isOpenHour(hours, date, hour)) return "open";
  return dayType === "weekend" ? "weekend" : "after_hours";
}

/** kWh in each part of the week, plus the share of calendar hours the site is closed (for yearly estimates). */
export function timeBuckets(scope: ScopeData, days: AnalysisDay[], hours: HoursByDay | null) {
  const open = effectiveHours(hours);
  const typeOf = new Map(days.map(day => [day.date, day.dayType]));
  const kwh: Record<TimeBucket, number> = { open: 0, after_hours: 0, weekend: 0, holiday: 0 };
  for (const cell of scope.total?.cells ?? []) {
    const dayType = typeOf.get(cell[0]);
    if (dayType && cell[2] != null) kwh[bucketOf(open, cell[0], dayType, cell[1])] += cell[2];
  }
  let closed = 0;
  for (const day of days) for (let hour = 0; hour < 24; hour += 1) if (bucketOf(open, day.date, day.dayType, hour) !== "open") closed += 1;
  const total = TIME_BUCKETS.reduce((sum, bucket) => sum + kwh[bucket], 0);
  return { kwh, total, closedKwh: total - kwh.open, closedShareOfHours: days.length ? closed / (days.length * 24) : 0 };
}

/** The load that never switches off: median of each complete night's average 00:00–06:00 use, in kW. */
export function alwaysOnKw(scope: ScopeData) {
  const series = scope.total;
  if (!series) return null;
  const nights = scope.dates.flatMap(date => {
    const cells = series.cells.filter(cell => cell[0] === date && cell[1] < 6);
    return cells.length === 6 && cells.every(cell => cell[2] != null && cell[3] >= series.expectedMinutesPerHour && cell[4] === 0) ? [cells.reduce((sum, cell) => sum + cell[2]!, 0) / 6] : [];
  }).sort((a, b) => a - b);
  if (nights.length < 3) return null;
  const mid = Math.floor(nights.length / 2);
  return nights.length % 2 ? nights[mid]! : (nights[mid - 1]! + nights[mid]!) / 2;
}

/** Closed-hours energy above a benchmark load (kW): what would be saved by running no higher than the benchmark after working hours. */
export function aboveBenchmarkWhenClosed(scope: ScopeData, days: AnalysisDay[], hours: HoursByDay | null, benchmarkKw: number) {
  const open = effectiveHours(hours);
  const typeOf = new Map(days.map(day => [day.date, day.dayType]));
  return (scope.total?.cells ?? []).reduce((sum, cell) => {
    const dayType = typeOf.get(cell[0]);
    return dayType && cell[2] != null && bucketOf(open, cell[0], dayType, cell[1]) !== "open" ? sum + Math.max(0, cell[2] - benchmarkKw) : sum;
  }, 0);
}

export type StoryHour = { hour: number; closed: boolean; base: number; working: number; avoidable: number; total: number };
/**
 * An average day split into the always-on minimum, use above it while open, and use above it while closed.
 * An hour counts as closed when the site is closed on most of the chosen days.
 */
export function storyProfile(scope: ScopeData, days: AnalysisDay[], hours: HoursByDay | null, minimumKw: number): StoryHour[] {
  const open = effectiveHours(hours);
  return hourlyProfile(scope, days.map(day => day.date)).map(row => {
    const closedDays = days.filter(day => bucketOf(open, day.date, day.dayType, row.hour) !== "open").length;
    const closed = days.length > 0 && closedDays * 2 >= days.length;
    const base = Math.min(row.total, minimumKw);
    const above = Math.max(0, row.total - base);
    return { hour: row.hour, closed, base, working: closed ? 0 : above, avoidable: closed ? above : 0, total: row.total };
  });
}

// Equipment that often has to run around the clock; flagged "check first" rather than counted as savings.
const ESSENTIAL = /fridge|refrig|freez|server|network|router|\brack\b|\bups\b|security|cctv|alarm|access|door|lift|elevator|pump|emergency|exit|comms|data room|it room/i;
export type ClosedUse = {
  id: string; name: string; space: string; category: AnalysisCategory | "overall"; kind: "circuit" | "remainder" | "type"; totalKwh: number; closedKwh: number; closedHours: number; closedKw: number; essential: boolean;
  /** Its own low overnight level already reached (10th percentile of complete nights, 00:00–06:00), and closed-hours energy above that level. */
  lowestKw: number | null; aboveLowestKwh: number;
};

/** A low overnight level the meter has already reached: 10th percentile of complete nights' average 00:00–06:00 use (needs five nights). */
export function lowestNightKw(series: TrendSeries | null | undefined) {
  if (!series) return null;
  const byDate = new Map<string, TrendCell[]>();
  for (const cell of series.cells) if (cell[1] < 6) byDate.set(cell[0], [...(byDate.get(cell[0]) ?? []), cell]);
  const nights = [...byDate.values()].filter(cells => cells.length === 6 && cells.every(cell => cell[2] != null && cell[3] >= series.expectedMinutesPerHour && cell[4] === 0))
    .map(cells => cells.reduce((sum, cell) => sum + cell[2]!, 0) / 6).sort((a, b) => a - b);
  return nights.length >= 5 ? nights[Math.floor(0.1 * (nights.length - 1))]! : null;
}

/** What keeps using energy while the site is closed: each circuit inside each space, or each meter type when there is no circuit detail. */
export function closedUseBreakdown(project: ScopeData, spaces: ScopeData[], holidays: Map<string, string>, hours: HoursByDay | null, locale: EnergyIqLocale = "en"): ClosedUse[] {
  const open = effectiveHours(hours);
  const t = analysisText(locale);
  const measure = (series: TrendSeries | null | undefined) => {
    const lowestKw = lowestNightKw(series);
    let totalKwh = 0, closedKwh = 0, closedHours = 0, aboveLowestKwh = 0;
    for (const cell of series?.cells ?? []) {
      if (cell[2] == null) continue;
      totalKwh += cell[2];
      if (bucketOf(open, cell[0], localDayType(cell[0], holidays).dayType, cell[1]) !== "open") {
        closedKwh += cell[2]; closedHours += 1;
        if (lowestKw != null) aboveLowestKwh += Math.max(0, cell[2] - lowestKw);
      }
    }
    return { totalKwh, closedKwh, closedHours, closedKw: closedHours ? closedKwh / closedHours : 0, lowestKw, aboveLowestKwh };
  };
  const rows: ClosedUse[] = [];
  for (const space of spaces) {
    const withSeries = space.meters.filter(meter => meter.series && meter.category !== "overall");
    const subMeters = withSeries.filter(meter => !meter.official);
    const chosen = subMeters.length ? subMeters : withSeries;
    for (const meter of chosen) rows.push({ id: meter.id, name: meter.name, space: space.name, category: meter.category, kind: "circuit", essential: ESSENTIAL.test(meter.name), ...measure(meter.series) });
    if (subMeters.length) {
      // Energy in the space that no sub-meter explains, so the list still adds up to the space total.
      const whole = measure(space.total);
      const covered = rows.filter(row => row.space === space.name);
      const rest = { totalKwh: whole.totalKwh - covered.reduce((sum, row) => sum + row.totalKwh, 0), closedKwh: whole.closedKwh - covered.reduce((sum, row) => sum + row.closedKwh, 0) };
      if (rest.closedKwh > whole.closedKwh * 0.05) rows.push({ id: `${space.id}:rest`, name: t("closed.rest", { space: space.name }), space: space.name, category: "other", kind: "remainder", essential: false, ...rest, closedHours: whole.closedHours, closedKw: whole.closedHours ? rest.closedKwh / whole.closedHours : 0, lowestKw: null, aboveLowestKwh: 0 });
    }
  }
  if (!rows.length) for (const category of CATEGORY_ORDER) {
    const series = project.types[category];
    if (series) rows.push({ id: `type:${category}`, name: categoryLabel(category, locale), space: project.name, category, kind: "type", essential: false, ...measure(series) });
  }
  return rows.filter(row => row.closedKwh > 0).sort((a, b) => b.closedKwh - a.closedKwh);
}

export type Opportunity = {
  id: string; title: string; detail: string; area: string; math: string | null;
  /** Up to: switched off after working hours. Proven: only down to levels the equipment already reached on its lowest nights. */
  annualKwh: number | null; annualCost: number | null; provenKwh: number | null; provenCost: number | null;
  confidence: "High" | "Medium" | "Check first"; effort: "Low" | "Medium"; counted: boolean; source: "readings" | "action_plan"; actionId?: string;
};

/**
 * Savings plan in money, using kW × hours a year × rate. Only non-overlapping items are counted in the headline:
 * each switchable circuit once, or the site-level gap to its own best closed-hours level when there is no circuit detail.
 */
export function savingsPlan(input: {
  projectName: string; closedUse: ClosedUse[]; closedHoursPerYear: number; rate: number | null; currency: string | null;
  aboveBenchmarkKwh: number | null; benchmarkKw: number | null; periodDays: number; anomalies: AnalysisAnomaly[];
  actions: Array<{ id: string; title: string; recommendation: string; state: string; priority: { level: string; reason: string } }>;
}, locale: EnergyIqLocale = "en"): Opportunity[] {
  const t = analysisText(locale);
  const money = (kwh: number | null) => kwh != null && input.rate != null ? kwh * input.rate : null;
  const rateText = input.rate != null && input.currency ? ` × ${input.currency} ${input.rate.toFixed(4)}/kWh` : "";
  const kw = (value: number) => `${value.toFixed(2)} kW`;
  const hoursText = fmt(input.closedHoursPerYear, 0);
  const math = (load: number) => t("plan.math", { kw: kw(load), hours: hoursText, rate: rateText });
  const yearly = (periodKwh: number) => input.periodDays > 0 ? periodKwh * 365 / input.periodDays : 0;
  const upTo = (load: number) => load * input.closedHoursPerYear;
  const items: Opportunity[] = [];
  const switchable = input.closedUse.filter(row => !row.essential && row.kind !== "remainder" && row.closedKw >= 0.05);
  const describe = (row: ClosedUse) => row.kind === "type" ? t("plan.areaType", { name: row.name, project: input.projectName }) : row.space ? t("plan.areaCircuit", { name: row.name, space: row.space }) : row.name;
  const proven = (rows: ClosedUse[]) => rows.some(row => row.lowestKw != null) ? yearly(rows.reduce((sum, row) => sum + row.aboveLowestKwh, 0)) : null;
  // Name up to three items; a lone fourth is named too rather than grouped as "1 more item".
  const named = switchable.slice(0, switchable.length === 4 ? 4 : 3);
  for (const row of named) {
    const annualKwh = upTo(row.closedKw), provenKwh = proven([row]);
    items.push({ id: `off-${row.id}`, title: row.kind === "type" ? t("plan.cutType", { name: row.name.toLowerCase() }) : t("plan.switchOff", { name: row.name }), area: describe(row),
      detail: t("plan.draws", { kw: kw(row.closedKw), pct: fmt(row.closedKwh / Math.max(row.totalKwh, 0.001) * 100, 0) }) + (row.lowestKw != null ? t("plan.quietest", { kw: kw(row.lowestKw) }) : ""),
      annualKwh, annualCost: money(annualKwh), provenKwh, provenCost: money(provenKwh),
      math: math(row.closedKw), confidence: "Medium", effort: "Low", counted: true, source: "readings" });
  }
  const others = switchable.slice(named.length);
  if (others.length) {
    const load = others.reduce((sum, row) => sum + row.closedKw, 0), annualKwh = upTo(load), provenKwh = proven(others);
    items.push({ id: "off-others", title: t("plan.others", { count: others.length }), area: joinText(others.slice(0, 3).map(describe), locale) + (others.length > 3 ? "…" : ""),
      detail: t("plan.othersDetail", { kw: kw(load) }), annualKwh, annualCost: money(annualKwh), provenKwh, provenCost: money(provenKwh),
      math: math(load), confidence: "Medium", effort: "Medium", counted: true, source: "readings" });
  }
  if (!switchable.length && input.aboveBenchmarkKwh && input.benchmarkKw != null && input.periodDays > 0) {
    const annualKwh = yearly(input.aboveBenchmarkKwh);
    items.push({ id: "benchmark", title: t("plan.benchmark"), area: input.projectName,
      detail: t("plan.benchmarkDetail", { kw: kw(input.benchmarkKw), kwh: fmt(input.aboveBenchmarkKwh, 0) }),
      annualKwh, annualCost: money(annualKwh), provenKwh: annualKwh, provenCost: money(annualKwh),
      math: t("plan.benchmarkMath", { kwh: fmt(input.aboveBenchmarkKwh, 0), days: input.periodDays, rate: rateText }), confidence: "High", effort: "Medium", counted: true, source: "readings" });
  }
  for (const row of input.closedUse.filter(item => item.essential && item.closedKw >= 0.05).slice(0, 2)) {
    const annualKwh = upTo(row.closedKw);
    items.push({ id: `check-${row.id}`, title: t("plan.check", { name: row.name }), area: describe(row),
      detail: t("plan.checkDetail", { kw: kw(row.closedKw) }),
      annualKwh, annualCost: money(annualKwh), provenKwh: null, provenCost: null, math: math(row.closedKw), confidence: "Check first", effort: "Low", counted: false, source: "readings" });
  }
  for (const row of input.closedUse.filter(item => item.kind === "remainder" && item.closedKw >= 0.2).slice(0, 2)) {
    const annualKwh = upTo(row.closedKw);
    items.push({ id: `find-${row.id}`, title: t("plan.find", { space: row.space }), area: row.space,
      detail: t("plan.findDetail", { kw: kw(row.closedKw) }),
      annualKwh, annualCost: money(annualKwh), provenKwh: null, provenCost: null, math: math(row.closedKw), confidence: "Check first", effort: "Low", counted: false, source: "readings" });
  }
  if (input.anomalies.length) items.push({ id: "unusual-days", title: t(input.anomalies.length === 1 ? "plan.unusual.one" : "plan.unusual.other", { count: input.anomalies.length }), area: input.projectName,
    detail: t("plan.unusualDetail", { days: joinText(input.anomalies.slice(0, 3).map(item => t("plan.unusualDay", { date: shortDate(item.date, locale), pct: fmt(item.deltaPct, 0) })), locale), pct: ANOMALY_THRESHOLD_PCT }),
    annualKwh: null, annualCost: null, provenKwh: null, provenCost: null, math: null, confidence: "Check first", effort: "Low", counted: false, source: "readings" });
  for (const action of input.actions.filter(item => item.state === "proposed" || item.state === "scheduled")) items.push({
    id: `action-${action.id}`, actionId: action.id, title: action.title, area: input.projectName, detail: action.recommendation || action.priority.reason,
    annualKwh: null, annualCost: null, provenKwh: null, provenCost: null, math: null, confidence: action.priority.level === "high" ? "High" : "Medium", effort: "Medium", counted: false, source: "action_plan" });
  return items;
}

/** Plain status for the health check, always shown with an icon and a word, never colour alone. */
export type HealthStatus = "good" | "watch" | "act";
export const statusFor = (value: number, watchAt: number, actAt: number): HealthStatus => value >= actAt ? "act" : value >= watchAt ? "watch" : "good";

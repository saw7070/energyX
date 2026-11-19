/**
 * The energy review: the site report written around the questions the site asked when its meters went in, the way the
 * first SKTC review was written by hand. It reads like a consultant's review rather than a dashboard, and its readers
 * never see the questions as such: each section is named by its topic ("Energy and cost", "Where it goes"):
 *
 *   Cover · Summary (four key figures and the key findings, each with a headline figure) · one section per topic —
 *   total energy by day and the cost; the top-level groups; which circuit uses the most in each group; group against
 *   group, circuit for circuit; the average 24 hours, with the points to check; meters with little use; energy per light
 *   point; the saving projection, with recommended next steps · Method and data.
 *
 * It is built from exactly the same readings and the same models as the full report and the management review
 * (buildManagementReview, which itself builds on buildSiteReport), so every figure matches the Overview; nothing here
 * needs AI. Costs include the tax on the price (GST) when the tariff is published before tax, and carbon uses the
 * site's grid emission factor. A topic with nothing to say is left out.
 */
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import { listText } from "./analysis-messages.js";
import { effectiveHours, shortDate, type HoursMeaning } from "./analysis-model.js";
import type { AnalysisData, ReportFollowUpStatus, ReportFollowUpVerdict, ScopeMeter, TrendSeries } from "./analysis-types.js";
import { energyReviewMessages, type EnergyReviewKey } from "./energy-review-messages.js";
import { alwaysOnByDesignIds } from "./always-on-by-design.js";
import { daytimeUse } from "./daytime-use.js";
import { comparableGroups, groupParts, meterHours, meterIdsIn, meterSeries, mustRunIds, partKey, partLabel } from "./group-insights.js";
import { idleIds as idleMeterIds, silentByDesignIds, withMetersInUse } from "./meters-in-use.js";
import { forHoursMeaning, translatorFor, type EnergyIqLocale, type Translate } from "./locale.js";
import { buildManagementReview, REVIEW_STOPPED_HOURS, type ManagementReview } from "./management-review.js";
import { analysisGroupTree, inSavedOrder, type MeterGroupNode, type MeterGroupTree } from "./meter-groups.js";
import { formatPeriod } from "./report-period.js";
import { clock, inWindow, kwhText as baseKwhText, kwText, moneyText, openingWindow, pctText, weekdayOf } from "./site-report-model.js";

type T = Translate<EnergyReviewKey>;
const reviewText = (locale: EnergyIqLocale, meaning: HoursMeaning): T => forHoursMeaning(translatorFor(energyReviewMessages, locale), energyReviewMessages, meaning);

/**
 * The stable keys of the review's points to check (EnergyReviewCheck.key): a meter point names the meter's id (group
 * 2), a day that stood out names the day (group 3).
 */
export const ENERGY_REVIEW_CHECK_KEY = /^(?:(stopped|offline|notInUse|noUse):(.+)|standout:(\d{4}-\d{2}-\d{2})|daytime)$/;

/**
 * The title a point to check carries in the review, worded from its key alone and without the closing full stop:
 * "Pavilion 2 has stopped reporting", "Tue 17 Nov stood out". A meter point needs the meter's name. Null for a key that
 * is not one of the review's own, so nobody can choose the words shown for a point.
 */
export function energyReviewCheckTitle(key: string, meterName: string | null | undefined, locale: EnergyIqLocale = "en"): string | null {
  const match = ENERGY_REVIEW_CHECK_KEY.exec(key);
  if (!match) return null;
  const t = translatorFor(energyReviewMessages, locale);
  let title: string;
  if (match[1]) {
    const name = meterName?.trim();
    if (!name) return null;
    title = t(`check.${match[1]}.title` as EnergyReviewKey, { name });
  } else if (match[3]) {
    title = t("check.standout.title", { date: `${weekdayOf(match[3], locale)} ${shortDate(match[3], locale)}` });
  } else {
    title = t("check.daytime.title");
  }
  return title.replace(/[.。]\s*$/u, "");
}

/** The topics a review covers, in reading order (named "questions" after the ones asked at installation; ids stay stable for links and feedback). */
export const ENERGY_REVIEW_QUESTIONS = ["total", "groups", "largest", "comparison", "profile", "littleUse", "perLight", "savings"] as const;
export type EnergyReviewQuestion = typeof ENERGY_REVIEW_QUESTIONS[number];
/** The review's colours: the deep green of the first SKTC review, then bronze, slate and softer greens. */
export const ENERGY_REVIEW_PALETTE = ["#1F5C46", "#C28A3C", "#5E6E7A", "#4E8F72", "#9CC3AE", "#A9533B", "#B9C7C1", "#7A5C99"];
/** Days in a projected month, as in every other EnergyIQ report. */
export const REVIEW_MONTH_DAYS = 30;
/** A meter used on fewer than this share of the days with readings is "little used". */
const LITTLE_USE_DAY_SHARE = 0.5;
/** Below this a day's use is no use at all (rounding in the meter's running total). */
const USED_DAY_KWH = 0.01;
/** Lights-on sites: a meter that sends readings in fewer than this share of daytime hours, but most night hours, is powered with its lights. */
const POWERED_DAY_SHARE = 0.2;
const POWERED_NIGHT_SHARE = 0.7;
/** Circuits shown in each group's breakdown; the smallest of the rest are counted together. */
const MAX_CIRCUITS = 8;
const MAX_CHECKS = 6;
const MAX_STEPS = 6;
/** Follow-ups and remembered facts the review shows, and the longest text it quotes from either. */
const MAX_FOLLOW_UPS = 12;
const MAX_MEMORY = 10;
const MAX_FEEDBACK_TEXT = 300;
/** Two figures within this share of each other read as "close"; a circuit this much apart is named. */
const CLOSE_SHARE = 0.05;
const NAMED_GAP = 0.15;
/** Motion-sensor dimming, or an earlier night step-down, saves about this share of the lighting it applies to. */
const DIMMING_SHARE = 0.3;
/** Trimming the light timers: this many hours less each night (a quarter of an hour at each end). */
const TRIM_HOURS_A_NIGHT = 0.5;
/** Daytime use on lighting circuits worth naming, costing and a site visit: this many kWh a year (about S$30). */
const DAYTIME_WORTH_KWH_YEAR = 100;

/** `recoveredKwh`: energy in `kwh` that meters sent late, after being offline. */
export type EnergyReviewDay = { date: string; label: string; kwh: number; cost: number | null; complete: boolean; recoveredKwh: number };
export type EnergyReviewSlice = { name: string; value: number; share: number; colour: string };
export type EnergyReviewLayer = { key: string; name: string; colour: string; hours: number[] };
/**
 * A point to check on site. `key` names it the same way in every report, so feedback can refer to it and an admin can
 * set it aside: "stopped:<meterId>", "offline:<meterId>", "notInUse:<meterId>", "standout:<YYYY-MM-DD>", "daytime",
 * "noUse:<meterId>".
 */
export type EnergyReviewCheck = { key: string; title: string; text: string };
/** A follow-up from feedback on an earlier report, with the AI's latest look at it (`verdict` null when it has not looked). */
export type EnergyReviewFollowUp = { text: string; status: ReportFollowUpStatus; verdict: ReportFollowUpVerdict | null; evidence: string | null };
/** What a moment of the average night is: lights switching on, a step down, lights going off, or the daytime. */
export type EnergyReviewMomentKind = "on" | "step" | "off" | "day";
/**
 * One moment of the average night: the time ("6:30 pm") and what happens then. `at` is the minute of the day it
 * happens (0–1439), where the 24-hour chart marks it; the daytime has none. Reviews saved before the chart marked the
 * moments have neither `at` nor `kind`.
 */
export type EnergyReviewMoment = { time: string; text: string; at?: number | undefined; kind?: EnergyReviewMomentKind | undefined };
/**
 * The daytime as the 24-hour chart shades it: from the last light off to the first one on (minutes of the day), about
 * how much stays on, and whether the lights are off as planned (`planned`: what stays on runs by design, or nothing
 * does), with the two lines the chart labels it with ("Off as planned" · "only emergency lights, about 0.4 kW").
 */
export type EnergyReviewDaytime = { from: number; to: number; kw: number; planned: boolean; title: string; detail: string };
export type EnergyReviewSaving = { title: string; basis: string; kwhYear: number; costYear: number | null };
export type EnergyReviewStep = { action: string; who: string; when: string };
export type EnergyReviewMeter = { id: string; name: string; group: string; perDay: number | null; basis: string };
/** How a finding reads at a glance: `good` (nothing to do), `watch` (worth a look on site), `info` (a plain fact). */
export type EnergyReviewTone = "good" | "watch" | "info";
/**
 * A finding's headline, as data rather than read back out of its sentence: the figure ("46.9", "41%", "About the same",
 * "7 pm – 7 am") and the few words that go with it ("kWh a day", "in Block A"; empty when the figure says it all).
 */
export type EnergyReviewHeadline = { value: string; unit: string; tone: EnergyReviewTone };
/** One key finding of the summary: its section, the section's question, the one-sentence answer and its headline. */
export type EnergyReviewFinding = { id: EnergyReviewQuestion; question: string; answer: string; headline: EnergyReviewHeadline };
/** A key figure of the summary; `detail` is a short line of context ("From 12 complete days"), empty when there is none. */
export type EnergyReviewFigure = { value: string; unit: string; label: string; detail: string; /** The section that explains the figure. */ target: EnergyReviewQuestion };

export type EnergyReview = {
  style: "review";
  locale: EnergyIqLocale;
  hoursMeaning: HoursMeaning;
  projectName: string; timezone: string; tzLabel: string; from: string; to: string; dayCount: number; generatedAt: string;
  currency: string;
  /** The price per kWh as costs here use it: including the tax on the price when the tariff is published before tax. */
  rate: number | null;
  /** "incl. GST" when costs include the tax; empty when the price is used as published. */
  costBasis: string;
  /** kg CO2e per kWh; null when the site has no factor, and then no carbon is shown. */
  carbonFactor: number | null;
  /** The topics present, in order. */
  questions: EnergyReviewQuestion[];
  cover: { kicker: string; title: string; subtitle: string; preparedFor: string[]; period: string[]; issued: string[] };
  summary: { intro: string; figures: EnergyReviewFigure[]; answers: EnergyReviewFinding[]; note: string };
  total: { heading: string; intro: string; days: EnergyReviewDay[]; caption: string; /** What the line of costs under the bars is, for the printed chart; empty without a price. */ costCaption: string;
    /** Days when meters were offline and sent their energy late, said in a sentence; empty when there were none. */
    outage: string; projection: Array<{ label: string; kwh: number; cost: number | null; co2Kg: number | null }> } | null;
  groups: { heading: string; intro: string; centre: string; unit: string; slices: EnergyReviewSlice[] } | null;
  largest: { heading: string; intro: string; blocks: Array<{ key: string; name: string; centre: string; slices: EnergyReviewSlice[] }>; note: string } | null;
  /** `total`: each group's whole use a day, after the rows; absent when the rows are single circuits. */
  comparison: { heading: string; intro: string; title: string; groups: Array<{ name: string; colour: string }>; rows: Array<{ name: string; perDay: number[] }>; total?: { name: string; perDay: number[] } | undefined; callout: string } | null;
  /**
   * `timeline`: what happens through the night, in clock order from midday (lights-on sites; empty otherwise).
   * `daytime`: the span the chart shades between the last light off and the first on (lights-on sites with switching
   * times). `dayTotal`: the typical day as the chart says it ("About 46.9 kWh a day"), the same figure as the summary's.
   * `description`: what the chart shows, in words, for screen readers. The last three are absent on reviews saved
   * before the chart carried them.
   */
  profile: { heading: string; intro: string; title: string; layers: EnergyReviewLayer[]; peakKw: number; timeline: EnergyReviewMoment[];
    daytime?: EnergyReviewDaytime | undefined; dayTotal?: string | undefined; description?: string | undefined } | null;
  /** Things to look at on site; shown after the average 24 hours, numbered. Points an admin set aside are left out. */
  checks: EnergyReviewCheck[];
  /** Follow-ups from feedback on earlier reports, open ones first; shown after the points to check. */
  followUps: EnergyReviewFollowUp[];
  /** What the site's people told the AI (active memory), newest first; listed in the appendix. */
  memory: string[];
  littleUse: { heading: string; text: string } | null;
  perLight: { heading: string; text: string } | null;
  savings: { heading: string; intro: string; title: string; rows: EnergyReviewSaving[]; totalKwh: number; totalCost: number | null; note: string } | null;
  nextSteps: EnergyReviewStep[];
  /** `setAside`: points to check this review found but left out, because an admin marked them as known, and why. */
  method: { intro: string; assumptions: Array<{ label: string; value: string }>; meters: EnergyReviewMeter[]; setAside: Array<{ title: string; reason: string }> };
  footer: { left: string };
};

/** Energy sent late is worth saying on a day from half a kWh and 2% of the day: a meter catching up a few minutes is not news. */
export const worthSaying = (recoveredKwh: number, dayKwh: number) => recoveredKwh >= Math.max(0.5, 0.02 * dayKwh);
/** kWh as the first SKTC review wrote it: one decimal below 100 ("48.7 kWh"), two below 1, whole numbers above. */
const kwhText = (value: number) => value < 100 ? `${num(value, value < 1 ? 2 : 1)} kWh` : baseKwhText(value);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const hourIndex = (date: string, hour: number) => Date.parse(`${date}T00:00:00Z`) / 3_600_000 + hour;
const sentences = (parts: string[], locale: EnergyIqLocale) => parts.filter(Boolean).join(locale === "zh-Hans" ? "" : " ");
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A group or meter name inside an English sentence: "Emergency lights" reads "emergency lights"; codes ("GF", "264F") stay. */
const inSentence = (name: string, locale: EnergyIqLocale) => locale === "en" && /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
/** A circuit's name inside its group: the group's own name or identifier taken off ("264F Level 2-17 lighting" in Block 264F → "Level 2-17 lighting"). */
const circuitLabel = (name: string, group: string) => {
  const lead = name.toLocaleLowerCase().startsWith(`${group.toLocaleLowerCase()} `) ? name.slice(group.length + 1).trim() : "";
  return lead || partLabel(name, group) || name;
};
/** Every meter inside a group with its energy for the dates, largest first. */
const metersIn = (node: MeterGroupNode): Array<{ id: string; name: string; kwh: number }> => [
  ...node.meters.filter(meter => !meter.unmetered).map(meter => ({ id: meter.id, name: meter.name, kwh: meter.kwh })),
  ...node.children.flatMap(metersIn),
].sort((a, b) => b.kwh - a.kwh || a.name.localeCompare(b.name));
/** Whole percentages that add up to exactly 100 (largest remainder), so a legend never reads 99% or 101%. */
function wholeShares(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map(value => value / total * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - floors[index]! })).sort((a, b) => b.rest - a.rest);
  for (const item of order) { if (left <= 0) break; floors[item.index]! += 1; left -= 1; }
  return floors;
}

export function buildEnergyReview(data: AnalysisData, reference: ProjectSpatialReference | null, generatedAt = new Date().toISOString(), locale: EnergyIqLocale = "en"): EnergyReview {
  const base: ManagementReview = buildManagementReview(data, reference, generatedAt, locale);
  const meaning: HoursMeaning = data.hoursMeaning ?? "opening";
  const lighting = meaning === "lights_on";
  const t = reviewText(locale, meaning);
  const list = (items: string[]) => listText(items, locale);
  const paragraph = (parts: string[]) => sentences(parts, locale);
  const project = data.current.project;
  const dates = project.dates;
  const periodText = dates.length ? formatPeriod(dates[0]!, dates.at(-1)!, locale) : "";
  const at = (date: string, hour: number) => t("time.at", { date: shortDate(date, locale), time: clock(hour, locale) });

  // ---------- price, tax and carbon ----------
  const basis = project.cost?.basis ?? (project.cost?.note.includes("before tax") ? "tax_exclusive" : project.cost?.note.includes("incl. tax") ? "tax_inclusive" : null);
  const taxPct = basis === "tax_exclusive" && data.tariffTax && data.tariffTax.ratePct > 0 ? data.tariffTax.ratePct : 0;
  const taxName = data.tariffTax?.name?.trim() || t("tax.plain");
  const taxFactor = 1 + taxPct / 100;
  const rate = base.rate == null ? null : base.rate * taxFactor;
  const costBasis = taxPct > 0 || basis === "tax_inclusive" ? t("cost.incl", { tax: taxName }) : "";
  const { currency } = base;
  const cost = (kwh: number) => rate == null ? null : kwh * rate;
  const money = (value: number, digits = 0) => moneyText(value, currency, digits);
  const carbonFactor = data.carbon && data.carbon.kgCo2ePerKwh >= 0 ? data.carbon.kgCo2ePerKwh : null;
  const co2 = (kwh: number) => carbonFactor == null ? null : kwh * carbonFactor;
  const tonnes = (kg: number) => (kg / 1000).toFixed(kg >= 10_000 ? 0 : 1);
  const kgText = (kg: number) => kg >= 1000 ? t("co2.t", { value: tonnes(kg) }) : t("co2.kg", { value: kg.toFixed(kg >= 100 ? 0 : 1) });

  // ---------- days and meters ----------
  const readDays = base.total.days.filter(day => day.kwh > 0 || day.complete);
  const shownDays = readDays.length ? readDays : base.total.days;
  const perDayOf = (kwh: number) => kwh / Math.max(readDays.length, 1);
  const typicalKwh = base.total.typicalKwh;
  const meterCount = base.total.meterCount;
  const tree: MeterGroupTree | null = analysisGroupTree(data, t("groups.unmetered"));
  // A site's meters carry their hour-by-hour readings in the areas (spaces) they belong to; the site's own list often
  // names them without readings. Every meter once, with its readings, wherever they are.
  const scopes = [project, ...data.current.spaces];
  const series = meterSeries(scopes);
  const allMeters: ScopeMeter[] = [...new Map(scopes.flatMap(scope => scope.meters).filter(meter => meter.series).map(meter => [meter.id, meter] as const).reverse()).values()].reverse();
  const notInUse = data.notInUse ?? [];
  const notInUseIds = new Set(notInUse.map(item => item.id));
  const idle = new Set(data.idleWhenQuiet ?? []);
  const totalCells = project.total?.cells ?? [];
  const siteLast = totalCells.reduce((last, cell) => cell[3] > 0 ? Math.max(last, hourIndex(cell[0], cell[1])) : last, -Infinity);
  const usualOf = new Map(base.method.meters.map(meter => [meter.id, meter.perDay]));
  const lastReading = (cells: TrendSeries["cells"]) => cells.filter(cell => cell[3] > 0).reduce<{ date: string; hour: number } | null>((best, cell) => !best || hourIndex(cell[0], cell[1]) > hourIndex(best.date, best.hour) ? { date: cell[0], hour: cell[1] } : best, null);
  const stopped = allMeters.flatMap(meter => {
    if (notInUseIds.has(meter.id) || idle.has(meter.id) || !Number.isFinite(siteLast)) return [];
    const last = lastReading(meter.series!.cells);
    return !last || siteLast - hourIndex(last.date, last.hour) > REVIEW_STOPPED_HOURS ? [{ meter, last }] : [];
  });
  const stoppedIds = new Set(stopped.map(item => item.meter.id));

  // Lights-on hours: a meter that sends readings only while its lights are on is wired after the lights' switch.
  const openRange = openingWindow(effectiveHours(data.openingHours, meaning), lighting);
  const receivedShare = (cells: TrendSeries["cells"], inside: boolean) => {
    const chosen = cells.filter(cell => inWindow(openRange, cell[1]) === inside);
    return chosen.length ? chosen.filter(cell => cell[3] > 0).length / chosen.length : 0;
  };
  const siteDayShare = lighting ? receivedShare(totalCells, false) : 0;
  const poweredWithLights = !lighting || siteDayShare < POWERED_NIGHT_SHARE ? [] : allMeters.flatMap(meter => {
    if (notInUseIds.has(meter.id) || stoppedIds.has(meter.id)) return [];
    const cells = meter.series!.cells.filter(cell => dates.includes(cell[0]));
    if (receivedShare(cells, false) >= POWERED_DAY_SHARE || receivedShare(cells, true) < POWERED_NIGHT_SHARE) return [];
    // The hours it usually reports in: the first after midday and the last before it.
    const byHour = Array.from({ length: 24 }, (_, hour) => { const own = cells.filter(cell => cell[1] === hour); return own.length ? own.filter(cell => cell[3] > 0).length / own.length : 0; });
    const order = Array.from({ length: 24 }, (_, index) => (12 + index) % 24);
    const from = order.find(hour => byHour[hour]! >= 0.5);
    const to = from === undefined ? undefined : order.slice(order.indexOf(from)).find(hour => byHour[hour]! < 0.5);
    return [{ meter, from, to }];
  });
  const poweredIds = new Set(poweredWithLights.map(item => item.meter.id));

  // ---------- 1. total energy, by day, and the cost ----------
  const low = Math.min(...shownDays.map(day => day.kwh)), high = Math.max(...shownDays.map(day => day.kwh));
  const days: EnergyReviewDay[] = base.total.days.map(day => ({ date: day.date, label: `${weekdayOf(day.date, locale)} ${shortDate(day.date, locale)}`, kwh: day.kwh, cost: cost(day.kwh), complete: day.complete, recoveredKwh: day.recoveredKwh }));
  const projection = typicalKwh == null ? [] : [
    { label: t("total.row.day"), kwh: typicalKwh, cost: cost(typicalKwh), co2Kg: co2(typicalKwh) },
    { label: t("total.row.month", { days: REVIEW_MONTH_DAYS }), kwh: typicalKwh * REVIEW_MONTH_DAYS, cost: cost(typicalKwh * REVIEW_MONTH_DAYS), co2Kg: co2(typicalKwh * REVIEW_MONTH_DAYS) },
    { label: t("total.row.year"), kwh: typicalKwh * 365, cost: cost(typicalKwh * 365), co2Kg: co2(typicalKwh * 365) },
  ];
  const firstStopped = stopped[0];
  // Meters that were offline kept counting and sent the energy when they came back: it is in those days' totals.
  const outageDays = shownDays.filter(day => worthSaying(day.recoveredKwh, day.kwh));
  const outageText = outageDays.length ? t(outageDays.length === 1 ? "total.outage.one" : "total.outage.other", {
    dates: list(outageDays.map(day => shortDate(day.date, locale))), kwh: kwhText(outageDays.reduce((sum, day) => sum + day.recoveredKwh, 0)),
  }) : "";
  const total: EnergyReview["total"] = shownDays.length ? {
    heading: t("q.total"),
    intro: paragraph([
      shownDays.length === 1 ? t("total.introOne", { kwh: kwhText(shownDays[0]!.kwh) })
        : kwhText(low) === kwhText(high) ? t("total.introSteady", { kwh: kwhText(low) }) : t("total.intro", { low: num(low), high: kwhText(high) }),
      firstStopped && firstStopped.last ? t("total.stopped", { name: firstStopped.meter.name, date: shortDate(firstStopped.last.date, locale) }) : "",
      typicalKwh != null ? t(cost(typicalKwh) != null ? "total.typicalCost" : "total.typical", { kwh: kwhText(typicalKwh), cost: cost(typicalKwh) != null ? money(cost(typicalKwh)!, 2) : "", basis: costBasis ? locale === "zh-Hans" ? costBasis : ` ${costBasis}` : "" }) : "",
    ]),
    days,
    caption: t("total.caption", { count: meterCount }),
    outage: outageText,
    costCaption: rate != null ? t(costBasis ? "total.captionCostBasis" : "total.captionCost", { basis: costBasis }) : "",
    projection,
  } : null;

  // ---------- 2. the top-level groups ----------
  const topRows = base.groups && !base.groups.byCircuit ? base.groups.rows : [];
  const topShares = wholeShares(topRows.map(row => row.kwh));
  const monthOf = (kwh: number) => perDayOf(kwh) * REVIEW_MONTH_DAYS;
  const groupSlices: EnergyReviewSlice[] = topRows.map((row, index) => ({ name: row.name, value: monthOf(row.kwh), share: topShares[index]! / 100, colour: ENERGY_REVIEW_PALETTE[index % ENERGY_REVIEW_PALETTE.length]! }));
  const groupNames = topRows.map(row => row.name);
  const sortedTop = [...topRows].map((row, index) => ({ row, pct: topShares[index]! })).sort((a, b) => b.row.kwh - a.row.kwh);
  const groups: EnergyReview["groups"] = topRows.length > 1 ? {
    heading: groupNames.length <= 4 ? list(groupNames) : t("q.groups"),
    // Two groups within a point of each other are "about the same", not first and second.
    intro: sortedTop.length > 1 && sortedTop[0]!.pct - sortedTop[1]!.pct <= 1 ? paragraph([
      t("groups.introTie", { a: sortedTop[0]!.row.name, b: sortedTop[1]!.row.name, pct: `${sortedTop[1]!.pct}%` }),
      sortedTop.length > 2 ? t("groups.introRest", { items: list(sortedTop.slice(2).map(item => t("groups.item", { name: item.row.name, pct: `${item.pct}%` }))) }) : "",
    ]) : paragraph([
      t(sortedTop[0]!.pct >= 45 ? "groups.introHalf" : "groups.introLead", { name: sortedTop[0]!.row.name, pct: `${sortedTop[0]!.pct}%` }),
      t("groups.introRest", { items: list(sortedTop.slice(1).map(item => t("groups.item", { name: item.row.name, pct: `${item.pct}%` }))) }),
    ]),
    centre: grouped(groupSlices.reduce((sum, slice) => sum + slice.value, 0)), unit: t("groups.unit"),
    slices: groupSlices,
  } : null;

  // ---------- 3. what uses the most inside each group ----------
  // Each top-level group by the groups inside it (ground floor, block lighting, emergency lights), largest first; a
  // meter directly in the group is a part of its own. Single circuits are not ranked against whole groups of them: two
  // circuits that light one block's floors between them are that block's lighting.
  const blocks = tree ? inSavedOrder(tree.children).filter(group => group.kwh > 0).flatMap(group => {
    const parts = groupParts(group).filter(part => part.kwh > 0)
      .map(part => ({ name: part.node ? part.name : circuitLabel(part.name, group.name), kwh: part.kwh }))
      .sort((a, b) => b.kwh - a.kwh || a.name.localeCompare(b.name));
    if (parts.length < 2) return [];
    const kept = parts.slice(0, MAX_CIRCUITS - (parts.length > MAX_CIRCUITS ? 1 : 0));
    const rest = parts.slice(kept.length);
    const rows = [...kept, ...(rest.length ? [{ name: t("largest.others", { count: rest.length }), kwh: rest.reduce((sum, part) => sum + part.kwh, 0) }] : [])];
    const shares = wholeShares(rows.map(row => row.kwh));
    return [{ key: group.id, name: group.name, perDay: perDayOf(group.kwh), centre: num(perDayOf(group.kwh)),
      slices: rows.map((row, index) => ({ name: row.name, value: perDayOf(row.kwh), share: shares[index]! / 100, colour: ENERGY_REVIEW_PALETTE[index % ENERGY_REVIEW_PALETTE.length]! })) }];
  }) : [];
  // The same circuit leading in several groups is said once ("Level 2–17 lighting: 35% of 264F and 44% of 264E").
  const leads = new Map<string, Array<{ group: string; pct: string }>>();
  for (const block of blocks) { const lead = block.slices[0]!; leads.set(lead.name, [...(leads.get(lead.name) ?? []), { group: block.name, pct: pctText(lead.share) }]); }
  const leadText = [...leads.entries()].map(([name, where]) => t("largest.lead", { name, where: list(where.map(item => t("largest.leadWhere", { pct: item.pct, group: item.group }))) }));
  // Lights-on hours with alike groups: the lighting added up across them (corridor lighting in every block) and its share of the site.
  const largest: EnergyReview["largest"] = blocks.length ? {
    heading: t("q.largest"),
    intro: paragraph([
      blocks.length === 1 ? t("largest.introOne", { name: blocks[0]!.slices[0]!.name, group: blocks[0]!.name, pct: pctText(blocks[0]!.slices[0]!.share) })
        : t("largest.intro", { items: list(leadText) }),
    ]),
    blocks: blocks.map(({ key, name, centre, slices }) => ({ key, name, centre, slices })),
    note: t("largest.note"),
  } : null;

  // ---------- 4. group against group, circuit for circuit ----------
  const alike = tree ? comparableGroups(tree) : null;
  let comparison: EnergyReview["comparison"] = null;
  let comparisonAnswer = "";
  let comparisonHeadline: EnergyReviewHeadline = { value: "", unit: "", tone: "info" };
  // Alike groups said in a figure: "About the same", or how much more the higher one uses ("+18%", "Block A over Block B").
  const gapHeadline = (values: number[], names: string[], sameUnit = ""): EnergyReviewHeadline => {
    const order = values.map((value, index) => ({ value, name: names[index]! })).sort((a, b) => b.value - a.value);
    const hi = order[0]!, lo = order.at(-1)!;
    const gap = lo.value > 0 ? hi.value / lo.value - 1 : null;
    return gap != null && gap < CLOSE_SHARE ? { value: t("hl.same"), unit: sameUnit, tone: "good" }
      : { value: gap != null ? `+${pctText(gap)}` : hi.name, unit: gap != null ? t("hl.cmp.more", { hi: hi.name, lo: lo.name }) : "", tone: "info" };
  };
  // The groups inside alike groups matched by name (ground floor, block lighting, emergency lights): the comparison
  // reads at that level, with each group's whole day after them. Circuits are compared only when the groups have no
  // such parts in common.
  const partsOf = (alike ?? []).map(group => new Map(groupParts(group).filter(part => part.node && part.kwh > 0).map(part => [part.name.trim().toLocaleLowerCase(), part] as const)));
  const sharedParts = partsOf.length >= 2 ? [...partsOf[0]!.keys()].filter(key => partsOf.every(map => map.has(key))) : [];
  if (alike && alike.length >= 2 && sharedParts.length >= 2) {
    const names = alike.map(group => group.name);
    const rows = sharedParts.map(key => ({ key, name: partsOf[0]!.get(key)!.name, perDay: partsOf.map(map => perDayOf(map.get(key)!.kwh)) }))
      .sort((a, b) => Math.max(...b.perDay) - Math.max(...a.perDay));
    const totals = alike.map(group => perDayOf(group.kwh));
    const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const groupColours = alike.map((_, index) => ({ name: names[index]!, colour: ENERGY_REVIEW_PALETTE[index % ENERGY_REVIEW_PALETTE.length]! }));
    const spread = (values: number[]) => { const hi = Math.max(...values), lo = Math.min(...values); return lo > 0 ? hi / lo - 1 : 0; };
    let intro: string, callout = "";
    if (alike.length === 2) {
      const higher = totals[0]! >= totals[1]! ? 0 : 1, lower = 1 - higher;
      const totalGap = spread(totals);
      const apart = rows.map(row => { const [a = 0, b = 0] = row.perDay; return { row, gap: spread([a, b]), hi: a >= b ? 0 : 1, kwh: Math.abs(a - b) }; })
        .filter(item => item.kwh >= 0.05 && item.gap >= NAMED_GAP).sort((a, b) => b.gap - a.gap).slice(0, 3);
      const gapText = (item: (typeof apart)[number]) => {
        const part = inSentence(item.row.name, locale), a = names[item.hi]!, b = names[1 - item.hi]!;
        return item.gap >= 0.95 && item.gap < 1.05 ? t("cmp.gapTwice", { part, a, b }) : item.gap >= 1.05 ? t("cmp.gapTimes", { part, a, b, times: (item.gap + 1).toFixed(1) }) : t("cmp.gapPct", { part, a, b, pct: pctText(item.gap) });
      };
      intro = paragraph([
        totalGap < CLOSE_SHARE
          ? t("cmp.groupSame", { a: names[0]!, b: names[1]!, aKwh: kwhText(totals[0]!), bKwh: kwhText(totals[1]!), avg: kwhText(average) })
          : t("cmp.groupMore", { hi: names[higher]!, lo: names[lower]!, pct: pctText(totalGap), hiKwh: kwhText(totals[higher]!), loKwh: kwhText(totals[lower]!) }),
        apart.length ? t("cmp.partsApart", { items: list(apart.map(gapText)) }) : t("cmp.partsClose"),
      ]);
      // Where the largest gap comes from: the circuit inside that part that differs most between the two groups.
      const widest = apart[0];
      if (widest) {
        const circuits = alike.map((group, index) => {
          const node = partsOf[index]!.get(widest.row.key)!.node!;
          const map = new Map<string, { label: string; kwh: number }>();
          for (const meter of metersIn(node)) { const key = partKey(meter.name, group.name) || meter.name.toLocaleLowerCase(); map.set(key, { label: map.get(key)?.label ?? circuitLabel(meter.name, group.name), kwh: (map.get(key)?.kwh ?? 0) + meter.kwh }); }
          return map;
        });
        const keys = new Set([...circuits[0]!.keys(), ...circuits[1]!.keys()]);
        const most = [...keys].map(key => ({ key, label: circuits[0]!.get(key)?.label ?? circuits[1]!.get(key)!.label, a: perDayOf(circuits[0]!.get(key)?.kwh ?? 0), b: perDayOf(circuits[1]!.get(key)?.kwh ?? 0) }))
          .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))[0];
        const only = most && Math.min(most.a, most.b) < 0.01 ? (most.a >= most.b ? 0 : 1) : null;
        if (most && Math.abs(most.a - most.b) >= 0.05) callout = paragraph([
          only != null ? t("cmp.becauseOnly", { part: inSentence(widest.row.name, locale), circuit: most.label, kwh: kwhText(Math.max(most.a, most.b)), name: names[only]! })
            : t("cmp.because", { part: inSentence(widest.row.name, locale), circuit: most.label, a: names[0]!, b: names[1]!, aKwh: kwhText(most.a), bKwh: kwhText(most.b) }),
          t("cmp.worthALook"),
        ]);
      }
      comparisonAnswer = totalGap < CLOSE_SHARE
        ? t("cmp.answerGroupSame", { a: names[0]!, b: names[1]!, aKwh: num(totals[0]!), bKwh: num(totals[1]!) })
        : t("cmp.answerGroupMore", { hi: names[higher]!, lo: names[lower]!, pct: pctText(totalGap) });
    } else {
      const order = totals.map((value, index) => ({ value, name: names[index]! })).sort((a, b) => b.value - a.value);
      intro = t("cmp.introMany", { count: alike.length, high: order[0]!.name, low: order.at(-1)!.name, highKwh: kwhText(order[0]!.value), lowKwh: kwhText(order.at(-1)!.value) });
      comparisonAnswer = t("cmp.answerMany", { high: order[0]!.name, low: order.at(-1)!.name, highKwh: num(order[0]!.value), lowKwh: num(order.at(-1)!.value) });
    }
    comparisonHeadline = { ...gapHeadline(totals, names), ...(callout ? { tone: "watch" as const } : {}) };
    comparison = {
      heading: alike.length === 2 ? t("q.comparisonTwo", { a: names[0]!, b: names[1]! }) : t("q.comparisonMany"),
      intro, title: t("cmp.titleGroups"), groups: groupColours, rows: rows.map(({ name, perDay }) => ({ name, perDay })),
      total: { name: t("cmp.total"), perDay: totals }, callout,
    };
  } else if (alike && alike.length >= 2) {
    const keyed = alike.map(group => {
      const map = new Map<string, { label: string; kwh: number }>();
      for (const meter of metersIn(group)) {
        const key = partKey(meter.name, group.name);
        if (!key) continue;
        const known = map.get(key);
        map.set(key, { label: known?.label ?? circuitLabel(meter.name, group.name), kwh: (known?.kwh ?? 0) + meter.kwh });
      }
      return map;
    });
    const shared = [...keyed[0]!.keys()].filter(key => keyed.every(map => map.has(key)));
    // Circuits matched by name across the groups; with fewer than two in common, the groups inside them instead.
    const rows = shared.length >= 2
      ? shared.map(key => ({ name: keyed[0]!.get(key)!.label, perDay: keyed.map(map => perDayOf(map.get(key)!.kwh)) }))
      : (base.comparison?.parts ?? []).map(part => ({ name: part.name, perDay: part.perDay }));
    rows.sort((a, b) => Math.max(...b.perDay) - Math.max(...a.perDay));
    const names = alike.map(group => group.name);
    const groupColours = alike.map((_, index) => ({ name: names[index]!, colour: ENERGY_REVIEW_PALETTE[index % ENERGY_REVIEW_PALETTE.length]! }));
    const like = alike.map((_, index) => rows.reduce((sum, row) => sum + (row.perDay[index] ?? 0), 0));
    const totals = alike.map(group => perDayOf(group.kwh));
    if (rows.length >= 2) {
      let intro: string, callout: string;
      if (alike.length === 2) {
        const gaps = rows.map(row => { const [a = 0, b = 0] = row.perDay; const hi = Math.max(a, b), lo = Math.min(a, b); return { row, gap: lo > 0 ? hi / lo - 1 : 0, hi: a >= b ? names[0]! : names[1]!, lo: a >= b ? names[1]! : names[0]!, kwh: hi - lo }; })
          .filter(item => item.kwh >= 0.05 && item.gap >= NAMED_GAP).sort((a, b) => b.gap - a.gap).slice(0, 3);
        const likeGap = Math.min(like[0]!, like[1]!) > 0 ? Math.max(like[0]!, like[1]!) / Math.min(like[0]!, like[1]!) - 1 : 0;
        const higher = totals[0]! >= totals[1]! ? 0 : 1;
        const extra = [...keyed[higher]!.entries()].filter(([key]) => !shared.includes(key)).map(([, part]) => part).sort((a, b) => b.kwh - a.kwh)[0];
        intro = paragraph([
          gaps.length ? t("cmp.introApart", { items: list(gaps.map(item => item.gap >= 0.95 && item.gap < 1.05 ? t("cmp.gapTwice", { part: item.row.name, a: item.hi, b: item.lo })
            : item.gap >= 1.05 ? t("cmp.gapTimes", { part: item.row.name, a: item.hi, b: item.lo, times: (item.gap + 1).toFixed(1) }) : t("cmp.gapPct", { part: item.row.name, a: item.hi, b: item.lo, pct: pctText(item.gap) }))) }) : t("cmp.introClose"),
          gaps.length ? t("cmp.worthALook") : "",
        ]);
        const extraPerDay = extra ? perDayOf(extra.kwh) : 0;
        callout = paragraph([
          t(likeGap < CLOSE_SHARE ? "cmp.likeSame" : "cmp.likeApart", { a: names[0]!, b: names[1]!, aKwh: kwhText(like[0]!), bKwh: kwhText(like[1]!) }),
          extra && extraPerDay >= 0.5 * Math.abs(totals[0]! - totals[1]!) && Math.abs(totals[0]! - totals[1]!) / Math.max(Math.min(totals[0]!, totals[1]!), 0.001) >= CLOSE_SHARE
            ? t("cmp.extra", { name: names[higher]!, part: extra.label, kwh: kwhText(extraPerDay) }) : "",
        ]);
        comparisonAnswer = paragraph([
          t(likeGap < CLOSE_SHARE ? "cmp.answerClose" : "cmp.answerApart", { a: names[0]!, b: names[1]!, aKwh: num(like[0]!), bKwh: num(like[1]!) }),
          extra && extraPerDay >= 0.5 * Math.abs(totals[0]! - totals[1]!) && Math.abs(totals[0]! - totals[1]!) / Math.max(Math.min(totals[0]!, totals[1]!), 0.001) >= CLOSE_SHARE
            ? t("cmp.answerExtra", { name: names[higher]!, part: extra.label }) : "",
        ]);
      } else {
        const order = totals.map((value, index) => ({ value, name: names[index]! })).sort((a, b) => b.value - a.value);
        intro = t("cmp.introMany", { count: alike.length, high: order[0]!.name, low: order.at(-1)!.name, highKwh: kwhText(order[0]!.value), lowKwh: kwhText(order.at(-1)!.value) });
        callout = t("cmp.likeMany", { items: list(like.map((value, index) => t("groups.item", { name: names[index]!, pct: kwhText(value) }))) });
        comparisonAnswer = t("cmp.answerMany", { high: order[0]!.name, low: order.at(-1)!.name, highKwh: num(order[0]!.value), lowKwh: num(order.at(-1)!.value) });
      }
      comparison = {
        heading: alike.length === 2 ? t("q.comparisonTwo", { a: names[0]!, b: names[1]! }) : t("q.comparisonMany"),
        intro, title: t("cmp.title"), groups: groupColours, rows, callout,
      };
      // Two groups are compared on their own circuits, the like-for-like figure; more groups on their whole day.
      comparisonHeadline = alike.length === 2 ? gapHeadline(like, names, t("hl.cmp.like")) : gapHeadline(totals, names);
    }
  }

  // Daytime use on lighting circuits, a year of it: named, costed and sent to the contractor only when it is worth a visit.
  const usedInDay = lighting ? daytimeUse(data, withMetersInUse(project, silentByDesignIds(data), data.current.spaces, idleMeterIds(data))) : null;
  const daytimeYearKwh = usedInDay ? usedInDay.kwh / Math.max(readDays.length, 1) * 365 : 0;
  const daytimeWorthIt = daytimeYearKwh >= DAYTIME_WORTH_KWH_YEAR;

  // ---------- 5. the average 24 hours ----------
  // Complete days when there are any; otherwise every day with readings (each meter's own complete hours are used either way).
  const completeDates = base.total.days.filter(day => day.complete).map(day => day.date);
  const profileDates = new Set(completeDates.length ? completeDates : readDays.map(day => day.date));
  const layerHours = (meterIds: string[]) => meterIds.reduce((sum, id) => { const own = meterHours(series.get(id), profileDates); return sum.map((value, hour) => value + own[hour]!); }, Array.from({ length: 24 }, () => 0));
  const rawLayers: Array<{ key: string; name: string; meterIds: string[] }> = [];
  if (tree) {
    const alikeIds = new Set((alike ?? []).map(group => group.id));
    let merged = false;
    for (const top of inSavedOrder(tree.children)) {
      if (alikeIds.has(top.id)) {
        if (merged) continue;
        merged = true;
        const byKind = new Map<string, { name: string; meterIds: string[] }>();
        for (const group of alike!) for (const part of groupParts(group)) {
          const key = partKey(part.name, group.name) || part.name.toLowerCase();
          const known = byKind.get(key);
          byKind.set(key, { name: known?.name ?? (partLabel(part.name, group.name) || part.name), meterIds: [...(known?.meterIds ?? []), ...part.meterIds] });
        }
        for (const [key, part] of byKind) rawLayers.push({ key: `like:${key}`, ...part });
        continue;
      }
      rawLayers.push({ key: top.id, name: top.name, meterIds: meterIdsIn(top) });
    }
  }
  // Steady layers (emergency lighting) at the bottom, then the rest largest first.
  const steadiness = (hours: number[]) => { const top = Math.max(...hours); return top > 0 ? Math.min(...hours) / top : 0; };
  // Layers that run day and night (emergency lighting) sit at the bottom in slate; the rest follow largest first, the
  // largest in the review's deep green, as in the first SKTC review.
  const sum = (hours: number[]) => hours.reduce((total, value) => total + value, 0);
  const measured = rawLayers.map(layer => ({ key: layer.key, name: layer.name, hours: layerHours(layer.meterIds) })).filter(layer => layer.hours.some(value => value > 0));
  const steady = measured.filter(layer => steadiness(layer.hours) >= 0.6).sort((a, b) => sum(b.hours) - sum(a.hours));
  const switching = measured.filter(layer => steadiness(layer.hours) < 0.6).sort((a, b) => sum(b.hours) - sum(a.hours));
  const switchingColours = [ENERGY_REVIEW_PALETTE[0], ENERGY_REVIEW_PALETTE[4], ENERGY_REVIEW_PALETTE[1], ENERGY_REVIEW_PALETTE[3], ENERGY_REVIEW_PALETTE[5], ENERGY_REVIEW_PALETTE[6], ENERGY_REVIEW_PALETTE[7]];
  const layers: EnergyReviewLayer[] = [
    ...steady.map((layer, index) => ({ ...layer, colour: index === 0 ? ENERGY_REVIEW_PALETTE[2]! : ENERGY_REVIEW_PALETTE[6]! })),
    ...switching.map((layer, index) => ({ ...layer, colour: switchingColours[index % switchingColours.length]! })),
  ];
  // Without groups, the site as one layer.
  const siteHours = base.profile?.hours ?? [];
  const profileLayers = layers.length >= 2 ? layers : siteHours.length ? [{ key: "site", name: data.projectName, colour: ENERGY_REVIEW_PALETTE[0]!, hours: siteHours }] : [];
  const stackedHours = Array.from({ length: 24 }, (_, hour) => profileLayers.reduce((sum, layer) => sum + (layer.hours[hour] ?? 0), 0));
  const peakKw = Math.max(0, ...stackedHours);
  const lowKw = stackedHours.length ? Math.min(...stackedHours) : 0;
  const isOn = (hour: number) => peakKw - lowKw > 0.001 && stackedHours[hour]! - lowKw >= 0.5 * (peakKw - lowKw);
  const clockOrder = Array.from({ length: 24 }, (_, index) => (12 + index) % 24);
  const onAt = lighting ? clockOrder.find(isOn) : undefined;
  const offAt = onAt === undefined ? undefined : clockOrder.slice(clockOrder.indexOf(onAt)).find(hour => !isOn(hour));
  // What the day looks like, in the order a reader sees it: lights on and off, the evening peak, a step down in the night,
  // and what stays on in the day (and which layer that mostly is).
  const nightHours = clockOrder.filter(hour => lighting ? inWindow(openRange, hour) : true);
  const drops = nightHours.slice(1).map((hour, index) => ({ hour, from: stackedHours[nightHours[index]!]!, to: stackedHours[hour]! }))
    .filter(item => isOn(item.hour) && item.from - item.to >= 0.1 * peakKw).sort((a, b) => (b.from - b.to) - (a.from - a.to));
  const dayHours = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => lighting ? !inWindow(openRange, hour) : !isOn(hour));
  const dayKw = mean(dayHours.map(hour => stackedHours[hour]!)) ?? 0;
  const dayLead = profileLayers.length > 1 && dayKw > 0 ? profileLayers.map(layer => ({ layer, kw: mean(dayHours.map(hour => layer.hours[hour] ?? 0)) ?? 0 })).sort((a, b) => b.kw - a.kw)[0] : undefined;
  // Lights-on sites: the lights are off as planned in the day when what stays on is only what runs day and night by
  // design (emergency lighting, ticked "always on" on the meter): no daytime use on the lighting worth a visit, and
  // nothing else above a tenth of the daytime level. The meters in the stacked layers, when there are layers.
  const steadyIds = alwaysOnByDesignIds(data);
  const inLayers = layers.length >= 2 ? new Set(rawLayers.flatMap(layer => layer.meterIds)) : null;
  const designIds = [...steadyIds].filter(id => !inLayers || inLayers.has(id));
  const designHours = layerHours(designIds);
  const designDayKw = mean(dayHours.map(hour => designHours[hour]!)) ?? 0;
  const offAsPlanned = lighting && !daytimeWorthIt && designDayKw > 0.005 && dayKw - designDayKw <= Math.max(0.1 * dayKw, 0.005);
  // Those meters as readers know them: the groups that hold nothing else ("emergency lights"), else their own names.
  const designUsed = designIds.filter(id => meterHours(series.get(id), profileDates).some(value => value > 0));
  const designGroups = rawLayers.filter(layer => layer.meterIds.length > 0 && layer.meterIds.every(id => steadyIds.has(id)));
  const designGrouped = new Set(designGroups.flatMap(layer => layer.meterIds));
  const designName = designGroups.length && designUsed.every(id => designGrouped.has(id)) ? list(designGroups.map(layer => inSentence(layer.name, locale)))
    : designUsed.length && designUsed.length <= 2 ? list(designUsed.map(id => (data.alwaysOnByDesign ?? []).find(meter => meter.id === id)?.name ?? id))
      : t("profile.byDesignAll");
  const profileIntro = paragraph([
    onAt !== undefined && offAt !== undefined ? t("profile.introOn", { on: clock(onAt, locale), off: clock(offAt, locale) }) : "",
    t(lighting ? "profile.introPeak" : "profile.introPeakDay", { kw: kwText(peakKw, 1), time: clock(stackedHours.indexOf(peakKw), locale) }),
    drops[0] ? t("profile.introStep", { time: clock(drops[0].hour, locale), kw: kwText(drops[0].to, 1) }) : "",
    dayKw > 0.005 ? offAsPlanned ? t("profile.introDayPlanned", { kw: kwText(dayKw, 1), name: designName })
      : dayLead && dayLead.kw >= 0.5 * dayKw ? t("profile.introDayMostly", { kw: kwText(dayKw, 1), name: inSentence(dayLead.layer.name, locale) }) : t("profile.introDay", { kw: kwText(dayKw, 1) }) : "",
  ]);
  // ---------- 5b. the night, moment by moment ----------
  // Each lighting circuit's average hour says when it comes on, steps down and goes off. Readings are hourly, so an
  // hour a circuit was on for only part of reads as the minutes it was on: at half its usual level, half an hour.
  const timeline: EnergyReviewMoment[] = [];
  /** A minute as a minute of the day (0–1439); switching at midnight can come out as 1440. */
  const minuteOfDay = (minutes: number) => ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const timeOf = (exact: number) => {
    const minutes = minuteOfDay(exact);
    const hour = Math.floor(minutes / 60), minute = minutes % 60;
    if (!minute) return clock(hour, locale);
    if (locale === "zh-Hans") return `${clock(hour, locale)}${minute}分`;
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return locale === "en" ? `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}` : clock(hour, locale).replace(/\d+/, `${twelve}:${String(minute).padStart(2, "0")}`);
  };
  let daytime: EnergyReviewDaytime | undefined;
  if (lighting && profileLayers.length && peakKw > 0) {
    const tenMinutes = (fraction: number) => Math.round(Math.min(1, Math.max(0, fraction)) * 6) * 10;
    type Moment = { at: number; kind: "on" | "step" | "off"; name: string };
    const moments: Moment[] = [];
    // Each circuit's switching with its level just before and just after (kW), for the site's level after a moment.
    // `sure`: the levels either side held for an hour, so they are the circuit's levels and not part of another change.
    type Change = { at: number; before: number; after: number; sure: boolean };
    const circuits: Array<{ id: string; hours: number[]; changes: Change[] }> = [];
    for (const meter of allMeters) {
      if (meter.category !== "light" || steadyIds.has(meter.id) || stoppedIds.has(meter.id) || notInUseIds.has(meter.id)) continue;
      const hours = meterHours(series.get(meter.id), profileDates);
      const top = Math.max(...hours);
      // Off in the middle of the day and on for part of the night; a circuit on all day long is not on a timer.
      if (top < 0.01 || hours[12]! >= 0.1 * top || Math.min(...hours) >= 0.6 * top) continue;
      const on = (hour: number) => hours[hour]! >= 0.1 * top;
      const start = clockOrder.findIndex(on);
      if (start < 0) continue;
      let end = start;
      while (end + 1 < clockOrder.length && on(clockOrder[end + 1]!)) end += 1;
      const at = (index: number) => clockOrder[index]!;
      const value = (index: number) => hours[at(index)]!;
      const changes: Change[] = [];
      // Switching on: the first hour's share of the next one's level is the part of the hour it was on for.
      const onLevel = end > start ? Math.max(value(start), value(start + 1)) : value(start);
      const onMinute = at(start) * 60 + 60 - tenMinutes(value(start) / onLevel);
      moments.push({ at: onMinute, kind: "on", name: meter.name });
      changes.push({ at: minuteOfDay(onMinute), before: hours[(at(start) + 23) % 24]!, after: onLevel, sure: true });
      // Switching off: the last hour's share of the hour before it.
      const offLevel = end > start ? value(end - 1) : value(end);
      const lastShare = value(end) / Math.max(offLevel, 0.0001);
      const offMinute = lastShare >= 0.95 ? (at(end) + 1) * 60 : at(end) * 60 + tenMinutes(lastShare);
      moments.push({ at: offMinute, kind: "off", name: meter.name });
      changes.push({ at: minuteOfDay(offMinute), before: offLevel, after: hours[(at(end) + 1) % 24]!, sure: true });
      // A step down in the night: two hours in a row at under 85% of the first full hour, still on.
      const first = value(Math.min(start + 1, end));
      for (let index = start + 2; index < end; index += 1) {
        if (value(index) < 0.85 * first && value(index + 1) < 0.85 * first) {
          const before = value(index - 1), after = value(index + 1);
          const share = before > after ? (value(index) - after) / (before - after) : 0;
          const stepMinute = at(index) * 60 + tenMinutes(share);
          // Its levels either side count when each holds for an hour: the hour after the step's next one is at the same
          // level, before the circuit switches off, and so is the hour before the one ahead of it (unless that is the
          // hour it came on in). A circuit still dimming, or about to switch off, gives no level.
          const slack = Math.max(0.15 * Math.abs(before - after), 0.03 * top);
          const sure = index + 2 < end && Math.abs(value(index + 2) - after) <= slack && (index - 2 <= start || Math.abs(value(index - 2) - before) <= slack);
          moments.push({ at: stepMinute, kind: "step", name: meter.name });
          changes.push({ at: minuteOfDay(stepMinute), before, after, sure });
          break;
        }
      }
      circuits.push({ id: meter.id, hours, changes });
    }
    // Minutes from midday, so the night reads in order across midnight.
    const fromNoon = (minutes: number) => (minutes - 12 * 60 + 24 * 60) % (24 * 60);
    const names = (items: Moment[]) => { const all = [...new Set(items.map(item => item.name))]; return all.length <= 3 ? list(all) : t("time.namesMore", { names: all.slice(0, 2).join(locale === "zh-Hans" ? "、" : ", "), count: all.length - 2 }); };
    const groupedBy = (kind: Moment["kind"]) => [...moments.filter(item => item.kind === kind).reduce((map, item) => map.set(item.at, [...(map.get(item.at) ?? []), item]), new Map<number, Moment[]>())]
      .sort((a, b) => fromNoon(a[0]) - fromNoon(b[0]));
    const ons = groupedBy("on"), steps = groupedBy("step"), offs = groupedBy("off");
    // The site's level just after a moment: the hour's average, with each circuit that switches inside that hour at its
    // level after the switch (or before it, for a switch later in the hour) rather than at its average for the hour. No
    // level when a circuit switching then was not steady either side, or when the level falls outside the hours around
    // it: a wrong figure is worse than none.
    const levelAfter = (minutes: number): number | null => {
      const minute = minuteOfDay(minutes), hour = Math.floor(minute / 60), from = hour * 60;
      let level = stackedHours[hour]!;
      for (const circuit of circuits) {
        if (inLayers && !inLayers.has(circuit.id)) continue;
        if (circuit.changes.some(change => change.at === minute && !change.sure)) return null;
        const inside = circuit.changes.filter(change => change.at > from && change.at < from + 60);
        if (!inside.length) continue;
        if (inside.some(change => !change.sure)) return null;
        const passed = inside.filter(change => change.at <= minute);
        level += (passed.length ? passed.at(-1)!.after : inside[0]!.before) - circuit.hours[hour]!;
      }
      const around = [stackedHours[(hour + 23) % 24]!, stackedHours[hour]!, stackedHours[(hour + 1) % 24]!];
      const slack = 0.05 * peakKw;
      return level >= Math.min(...around) - slack && level <= Math.max(...around) + slack ? level : null;
    };
    // Each switch time is one moment; at most three switch-on and three switch-off moments, in clock order from midday.
    const entries: Array<{ key: number; moment: EnergyReviewMoment }> = [];
    const add = (minutes: number, text: string, kind: EnergyReviewMomentKind) => entries.push({ key: fromNoon(minutes), moment: { time: timeOf(minutes), text, at: minuteOfDay(minutes), kind } });
    ons.slice(0, 3).forEach(([at, items], index) => add(at, t(index === 0 ? "time.firstOn" : "time.moreOn", { names: names(items) }), "on"));
    const allOn = clockOrder.find(hour => stackedHours[hour]! >= 0.95 * peakKw);
    if (allOn !== undefined && ons.length > 1 && fromNoon(allOn * 60) >= fromNoon(ons[0]![0])) add(allOn * 60 + 0.5, t("time.allOn", { kw: kwText(peakKw, 1) }), "on");
    steps.slice(0, 2).forEach(([at, items]) => {
      const level = levelAfter(at);
      add(at, level == null ? t("time.stepPlain", { names: names(items) }) : t("time.step", { names: names(items), kw: kwText(level, 1) }), "step");
    });
    offs.slice(-3).forEach(([at, items], index, shown) => add(at, t(index === shown.length - 1 && shown.length > 1 ? "time.lastOff" : "time.off", { names: names(items) }), "off"));
    entries.sort((a, b) => a.key - b.key);
    timeline.push(...entries.map(entry => entry.moment));
    // The day last: from the last light off to the first one on, and what stays on. The chart shades the same span.
    if (offs.length && ons.length) {
      const from = offs.at(-1)![0], to = ons[0]![0];
      const kw = kwText(dayKw, 1);
      if (dayKw > 0.005) timeline.push({ time: t("time.daytime", { from: timeOf(from), to: timeOf(to) }), kind: "day",
        text: offAsPlanned ? t("time.dayPlanned", { kw, name: designName })
          : dayLead && dayLead.kw >= 0.5 * dayKw ? t("time.dayMostly", { kw, name: inSentence(dayLead.layer.name, locale) }) : t("time.day", { kw }) });
      // Off as planned: only what runs by design stays on, or nothing does; never with daytime use worth a visit.
      const planned = !daytimeWorthIt && (offAsPlanned || dayKw <= 0.005);
      daytime = { from: minuteOfDay(from), to: minuteOfDay(to), kw: dayKw, planned,
        title: t(planned ? "profile.dayPlanned" : "profile.dayUse"),
        detail: dayKw <= 0.005 ? "" : offAsPlanned ? t("profile.dayPlannedDetail", { kw, name: designName }) : t("profile.dayUseDetail", { kw }) };
    }
  }
  // The day's energy as the chart says it: the review's typical day, so it is the same figure as the summary's (the
  // average hours add up to it when every meter worked); the hours themselves without a typical day.
  const hoursKwh = stackedHours.reduce((total, value) => total + value, 0);
  const dayTotalKwh = typicalKwh ?? (hoursKwh > 0 ? hoursKwh : null);
  const dayTotal = dayTotalKwh != null ? t("profile.dayTotal", { kwh: kwhText(dayTotalKwh) }) : undefined;
  const marked = timeline.filter(moment => moment.at != null).length;
  const profile: EnergyReview["profile"] = profileLayers.length && peakKw > 0 ? {
    heading: t("q.profile"),
    intro: profileIntro,
    title: t("profile.title", { period: periodText }),
    layers: profileLayers, peakKw, timeline, daytime, dayTotal,
    description: paragraph([
      t(profileLayers.length > 1 ? "profile.aria" : "profile.ariaOne", { kw: kwText(peakKw, 1) }),
      marked === 1 ? t("profile.ariaMark") : marked > 1 ? t("profile.ariaMarks", { count: marked }) : "",
      daytime ? t("profile.ariaDay", { from: timeOf(daytime.from), to: timeOf(daytime.to), label: daytime.detail ? t("profile.dayLabel", { title: daytime.title, detail: daytime.detail }) : daytime.title }) : "",
      dayTotal ? t("profile.ariaTotal", { total: dayTotal }) : "",
    ]),
  } : null;

  // ---------- points to check ----------
  const checks: EnergyReviewCheck[] = [];
  // Points an admin set aside as known (from feedback on an earlier report) are left out, and so are the steps for them.
  const dismissedReason = new Map((data.dismissedChecks ?? []).map(item => [item.key, typeof item.reason === "string" ? item.reason.trim() : ""] as const));
  const dismissed = new Set(dismissedReason.keys());
  const kept = (key: string) => !dismissed.has(key);
  const offlineNames = new Map<string, string>();
  for (const { meter, last } of stopped) {
    const usual = usualOf.get(meter.id) ?? null;
    checks.push({ key: `stopped:${meter.id}`, title: t("check.stopped.title", { name: meter.name }), text: paragraph([
      last ? t("check.stopped.since", { since: at(last.date, last.hour) }) : t("check.stopped.none"),
      usual != null ? t("check.stopped.before", { kwh: kwhText(usual) }) : "",
      t("check.stopped.do"),
    ]) });
  }
  // A meter powered with its lights (it reports only while they are on) is wired that way on purpose: nothing to check.
  // A meter set aside as not in use is checked only when it has gone quiet: then it is offline, and someone must look.
  for (const item of notInUse) {
    const meter = allMeters.find(candidate => candidate.id === item.id);
    const cells = meter?.series?.cells.filter(cell => dates.includes(cell[0])) ?? [];
    const last = meter?.series ? lastReading(meter.series.cells) : null;
    const quiet = !last || !Number.isFinite(siteLast) || siteLast - hourIndex(last.date, last.hour) > REVIEW_STOPPED_HOURS;
    // Gone quiet comes first: a meter powered with its lights still reports every night, so one silent for days is offline.
    if (!quiet && lighting && cells.length && receivedShare(cells, true) >= POWERED_NIGHT_SHARE) continue;
    const reason = item.reason && !item.reason.startsWith("reason:") ? item.reason : "";
    if (quiet) offlineNames.set(`offline:${item.id}`, item.name);
    checks.push(quiet ? { key: `offline:${item.id}`, title: t("check.offline.title", { name: item.name }), text: paragraph([
      last ? t("check.stopped.since", { since: at(last.date, last.hour) }) : t("check.stopped.none"),
      reason ? t("check.offline.reason", { reason }) : "",
      t("check.offline.do"),
    ]) } : { key: `notInUse:${item.id}`, title: t("check.notInUse.title", { name: item.name }), text: reason ? t("check.notInUse.reason", { reason }) : t("check.notInUse.plain") });
  }
  // The first days after the meters went in often carry readings from installation day: they are not "stood out" days.
  const historyCells = (data.history?.total ?? project.total)?.cells ?? [];
  const firstRead = historyCells.filter(cell => cell[3] > 0).reduce<string | null>((first, cell) => !first || cell[0] < first ? cell[0] : first, null);
  const settled = (date: string) => !firstRead || Date.parse(`${date}T00:00:00Z`) - Date.parse(`${firstRead}T00:00:00Z`) >= 2 * 86_400_000;
  // Two days that stood out at most; a day set aside as known makes room for the next one.
  const standouts: EnergyReviewCheck[] = (base.total.standout?.items ?? []).filter(item => settled(item.date))
    .map(item => ({ key: `standout:${item.date}`, title: t("check.standout.title", { date: `${weekdayOf(item.date, locale)} ${shortDate(item.date, locale)}` }), text: item.text }));
  checks.push(...standouts.filter(check => kept(check.key)).slice(0, 2), ...standouts.filter(check => !kept(check.key)));
  const daytimeFound = lighting && !!base.daytime?.items.length && daytimeWorthIt;
  if (daytimeFound) checks.push({ key: "daytime", title: t("check.daytime.title"), text: paragraph([list(base.daytime!.items), base.daytime!.more ?? ""]) });
  const daytimeCheck = daytimeFound && kept("daytime");
  const mustRun = mustRunIds(allMeters, data);
  const quietMustRun = allMeters.filter(meter => mustRun.has(meter.id) && !stoppedIds.has(meter.id) && !notInUseIds.has(meter.id) && meter.series!.cells.every(cell => (cell[2] ?? 0) < USED_DAY_KWH / 24) && meter.series!.cells.some(cell => cell[3] > 0));
  for (const meter of quietMustRun) checks.push({ key: `noUse:${meter.id}`, title: t("check.noUse.title", { name: meter.name }), text: t("check.noUse.do") });
  const keptChecks = checks.filter(check => kept(check.key));
  const shownChecks = keptChecks.slice(0, MAX_CHECKS);

  // ---------- 6. meters with little use ----------
  const readDates = new Set(readDays.map(day => day.date));
  const little = allMeters.flatMap(meter => {
    if (stoppedIds.has(meter.id) || notInUseIds.has(meter.id) || poweredIds.has(meter.id)) return [];
    const cells = meter.series!.cells.filter(cell => readDates.has(cell[0]));
    const byDay = new Map<string, number>();
    for (const cell of cells) byDay.set(cell[0], (byDay.get(cell[0]) ?? 0) + (cell[2] ?? 0));
    const usedDays = [...byDay.values()].filter(value => value >= USED_DAY_KWH).length;
    if (!readDates.size || usedDays >= readDates.size * LITTLE_USE_DAY_SHARE) return [];
    const totalKwh = [...byDay.values()].reduce((sum, value) => sum + value, 0);
    const lastUsed = cells.filter(cell => (cell[2] ?? 0) >= USED_DAY_KWH / 4).reduce<{ date: string; hour: number } | null>((best, cell) => !best || hourIndex(cell[0], cell[1]) > hourIndex(best.date, best.hour) ? { date: cell[0], hour: cell[1] } : best, null);
    return [{ meter, totalKwh, usedDays, lastUsed }];
  }).sort((a, b) => a.totalKwh - b.totalKwh);
  const smallKwh = (value: number) => value < 1 ? `${value.toFixed(2)} kWh` : kwhText(value);
  const littleLine = (item: (typeof little)[number]) => item.usedDays === 0 ? t("little.none", { name: item.meter.name })
    : t("little.item", { name: item.meter.name, kwh: smallKwh(item.totalKwh), used: item.usedDays, days: readDates.size, last: item.lastUsed ? t("little.last", { at: at(item.lastUsed.date, item.lastUsed.hour + 1) }) : "" });
  const littleUse: EnergyReview["littleUse"] = readDates.size > 1 ? little.length === 1 ? {
    heading: little[0]!.meter.name,
    text: little[0]!.usedDays === 0 ? t("little.oneNone") : paragraph([t("little.one", { kwh: smallKwh(little[0]!.totalKwh), used: little[0]!.usedDays, days: readDates.size, last: little[0]!.lastUsed ? t("little.last", { at: at(little[0]!.lastUsed.date, little[0]!.lastUsed.hour + 1) }) : "" }), t("little.oneMostly")]),
  } : little.length > 1 ? {
    heading: t("q.littleUse"),
    text: paragraph([t("little.intro", { count: little.length }), ...little.slice(0, 5).map(littleLine), little.length > 5 ? t("little.more", { count: little.length - 5 }) : ""]),
  } : { heading: t("q.littleUse"), text: t("little.everyMeter") } : null;
  const littleAnswer = !littleUse ? "" : little.length === 1
    ? (little[0]!.usedDays === 0 ? t("little.answerNone") : t("little.answerOne", { kwh: smallKwh(little[0]!.totalKwh), since: little[0]!.lastUsed ? shortDate(little[0]!.lastUsed.date, locale) : periodText }))
    : little.length > 1 ? t("little.answerMany", { count: little.length, names: list(little.slice(0, 3).map(item => item.meter.name)) }) : t("little.everyMeter");

  // ---------- 7. energy per light point ----------
  const lightRows = (base.perLight?.rows ?? []).filter(row => row.kind === "meter" && row.perLight != null);
  const lightingMeters = allMeters.filter(meter => meter.category === "light").length;
  const missingCounts = lighting && lightingMeters > lightRows.length;
  const perLightNum = (value: number) => value.toFixed(value >= 1 ? 2 : 3);
  const perLight: EnergyReview["perLight"] = lightRows.length || lighting ? {
    heading: t("q.perLight"),
    text: lightRows.length ? paragraph([
      list(lightRows.slice(0, 4).map(row => t(new RegExp(`\\b${row.lights}\\s+light`, "i").test(row.name) ? "light.itemNamed" : "light.item", { name: row.name, lights: row.lights, kwh: perLightNum(row.perLight!) }))) + (locale === "zh-Hans" ? "。" : "."),
      lightRows.length > 4 ? t("light.more", { count: lightRows.length - 4 }) : "",
      missingCounts ? t("light.needOthers") : "",
    ]) : t("light.needAll"),
  } : null;
  const perLightAnswer = !perLight ? "" : lightRows.length
    ? paragraph([t("light.answer", { name: lightRows[0]!.name, kwh: perLightNum(lightRows[0]!.perLight!) }), missingCounts ? t("light.answerNeed") : ""])
    : t("light.answerNeedAll");

  // ---------- 8. the saving projection ----------
  // Lights-on hours: the measures the first SKTC review costed — dimming the largest lighting that switches with the
  // timer, finding the daytime use, and trimming the timers. Opening hours: the management review's own plan.
  const yearOf = (kwhPerDay: number) => kwhPerDay * 365;
  const lightingRows: EnergyReviewSaving[] = [];
  // The one measure worth a trial before it is relied on: dimming (or an earlier step-down) on one block.
  let trialRow: EnergyReviewSaving | null = null;
  if (lighting && profileLayers.length) {
    const corridor = alike && switching.find(layer => layer.key.startsWith("like:"));
    if (corridor) {
      const kwhYear = yearOf(sum(corridor.hours)) * DIMMING_SHARE;
      if (kwhYear >= 1) {
        trialRow = { title: t("sav.dim.title", { name: inSentence(corridor.name, locale) }), basis: t("sav.dim.basis", { pct: pctText(DIMMING_SHARE), name: inSentence(corridor.name, locale) }), kwhYear, costYear: cost(kwhYear) };
        lightingRows.push(trialRow);
      }
    }
    const daytimePerDay = (usedInDay?.kwh ?? 0) / Math.max(readDays.length, 1);
    if (daytimeWorthIt && dayHours.length) {
      const watts = daytimePerDay / dayHours.length * 1000;
      lightingRows.push({ title: t("sav.day.title"), basis: t("sav.day.basis", { w: Math.round(watts) }), kwhYear: yearOf(daytimePerDay), costYear: cost(yearOf(daytimePerDay)) });
    }
    const nightKw = mean(nightHours.map(hour => stackedHours[hour]!)) ?? 0;
    const switchedKw = Math.max(0, nightKw - dayKw);
    const trimYear = switchedKw * TRIM_HOURS_A_NIGHT * 365;
    if (trimYear >= 1) lightingRows.push({ title: t("sav.trim.title"), basis: t("sav.trim.basis", { minutes: Math.round(TRIM_HOURS_A_NIGHT * 30) }), kwhYear: trimYear, costYear: cost(trimYear) });
  }
  const savingRows: EnergyReviewSaving[] = lighting && lightingRows.length ? lightingRows
    : base.savings.rows.map(row => ({ title: row.title, basis: row.basis, kwhYear: row.kwhYear, costYear: row.costYear == null ? null : row.costYear * taxFactor }));
  const savingKwh = savingRows.reduce((sum, row) => sum + row.kwhYear, 0);
  const savingCost = rate != null ? savingRows.reduce((sum, row) => sum + (row.costYear ?? 0), 0) : null;
  const yearKwh = typicalKwh != null ? typicalKwh * 365 : null;
  const savingShare = yearKwh ? savingKwh / yearKwh : null;
  const savings: EnergyReview["savings"] = {
    heading: t("q.savings"),
    intro: savingRows.length ? paragraph([
      t(savingRows.length === 1 ? "sav.intro.one" : "sav.intro.other", { count: savingRows.length }),
      t("sav.together", {
        kwh: `**${kwhText(savingKwh)}**`, share: savingShare != null ? t("sav.share", { pct: pctText(savingShare) }) : "",
        cost: savingCost != null ? t("sav.cost", { cost: `**${money(savingCost)}**`, basis: costBasis ? t("sav.basis", { basis: costBasis }) : "" }) : "",
        co2: co2(savingKwh) != null ? t("sav.co2", { co2: kgText(co2(savingKwh)!) }) : "",
      }),
    ]) : t("sav.none"),
    title: t(costBasis && savingCost != null ? "sav.titleBasis" : savingCost != null ? "sav.title" : "sav.titleKwh", { basis: costBasis }),
    rows: savingRows, totalKwh: savingKwh, totalCost: savingCost,
    note: savingRows.length ? t("sav.note", { days: readDays.length || dates.length }) : "",
  };
  const savingAnswer = savingRows.length
    ? t(savingCost != null ? "sav.answerCost" : "sav.answer", { kwh: kwhText(savingKwh), pct: savingShare != null ? t("sav.answerPct", { pct: pctText(savingShare) }) : "", cost: savingCost != null ? money(savingCost) : "" })
    : t("sav.answerNone");

  // ---------- recommended next steps ----------
  const client = data.projectName;
  const steps: EnergyReviewStep[] = [];
  // Meters to fix: those that stopped, and those set aside as not in use that have gone quiet (unless set aside as known).
  const toFix = [...stopped.filter(item => kept(`stopped:${item.meter.id}`)).map(item => item.meter.name), ...keptChecks.flatMap(check => offlineNames.has(check.key) ? [offlineNames.get(check.key)!] : [])];
  for (const name of toFix.slice(0, 2)) steps.push({ action: t("step.fixMeter", { name }), who: t("who.contractor"), when: t("when.week") });
  if (toFix.length > 2) steps.push({ action: t("step.fixMeters", { count: toFix.length - 2 }), who: t("who.contractor"), when: t("when.week") });
  if (daytimeCheck) {
    const names = base.daytime!.items.slice(0, 2).map(item => item.split(/[:：]/)[0]!.trim());
    steps.push({ action: t("step.daytime", { names: list(names) }), who: t("who.contractor"), when: t("when.week") });
  }
  const sendRate = rate == null, sendCounts = missingCounts;
  if (sendRate || sendCounts) steps.push({ action: t(sendRate && sendCounts ? "step.sendBoth" : sendRate ? "step.sendRate" : "step.sendCounts"), who: client, when: t("when.available") });
  // Lights-on sites trial the dimming only; the daytime standby and timers are fixed, not trialled. Opening-hours sites
  // trial the largest measure of the management review's plan.
  const trial = lighting ? trialRow : savingRows[0] ?? null;
  if (trial) steps.push({ action: t("step.trial", { measure: trial.title.replace(/[.。]$/, "") }), who: t("who.clientContractor", { client }), when: t("when.nextMonth") });
  steps.push({ action: t("step.review"), who: t("who.us", { client }), when: t("when.nextReview") });
  const nextSteps = steps.slice(0, MAX_STEPS);

  // ---------- method and data ----------
  const rateValue = base.rate == null ? t("met.rateNone") : paragraph([
    t(basis === "tax_exclusive" ? "met.rateBefore" : basis === "tax_inclusive" ? "met.rateIncl" : "met.ratePlain", { rate: moneyText(base.rate, currency, 4), tax: taxName }),
  ]);
  const assumptions = [
    { label: t("met.price"), value: rateValue },
    ...(taxPct > 0 ? [{ label: taxName, value: `${taxPct}%` }] : []),
    ...(carbonFactor != null && data.carbon ? [{ label: t("met.carbon", { year: data.carbon.year }), value: t("met.carbonValue", { value: carbonFactor.toFixed(3) }) }] : []),
    { label: t("met.monthDays"), value: String(REVIEW_MONTH_DAYS) },
    { label: t("met.complete"), value: t("met.completeValue", { count: base.total.days.filter(day => day.complete).length, days: dates.length }) },
  ];
  const meters: EnergyReviewMeter[] = [...base.method.meters]
    .sort((a, b) => (a.group || "").localeCompare(b.group || "") || (b.perDay ?? -1) - (a.perDay ?? -1))
    .map(meter => ({ id: meter.id, name: meter.name, group: meter.group, perDay: meter.perDay, basis: poweredIds.has(meter.id) ? t("met.basisPowered") : meter.note ? capitalise(meter.note) : t("met.basisAverage", { period: periodText }) }));
  // Keep the groups in their saved order rather than alphabetical.
  const groupOrder = new Map(topRows.map((row, index) => [row.name, index]));
  meters.sort((a, b) => (groupOrder.get(a.group) ?? 99) - (groupOrder.get(b.group) ?? 99) || (b.perDay ?? -1) - (a.perDay ?? -1));
  const method = {
    intro: paragraph([t("met.intro", { count: meterCount }), t("met.introPeriod", { period: periodText, tz: base.tzLabel })]),
    assumptions, meters,
    setAside: checks.filter(check => dismissed.has(check.key)).map(check => ({ title: check.title, reason: dismissedReason.get(check.key) ?? "" })),
  };

  // ---------- summary ----------
  const completeKwh = base.total.days.filter(day => day.complete).map(day => day.kwh);
  const complete = completeKwh.length > 1 ? completeKwh : readDays.map(day => day.kwh);
  const avg = mean(complete);
  const spread = avg && complete.length > 1 ? Math.sqrt(complete.reduce((sum, value) => sum + (value - avg) ** 2, 0) / complete.length) / avg : null;
  const biggestLayer = layers.length ? [...layers].sort((a, b) => b.hours.reduce((s, v) => s + v, 0) - a.hours.reduce((s, v) => s + v, 0))[0]! : null;
  const layerTotal = layers.reduce((sum, layer) => sum + layer.hours.reduce((s, v) => s + v, 0), 0);
  const biggestShare = biggestLayer && layerTotal > 0 ? biggestLayer.hours.reduce((s, v) => s + v, 0) / layerTotal : null;
  const summaryIntro = paragraph([
    t(lighting ? "sum.metersLighting" : "sum.meters", { count: meterCount, days: dates.length }),
    spread != null ? t(spread < 0.05 ? (lighting ? "sum.steadyLighting" : "sum.steady") : "sum.varies", { low: kwhText(Math.min(...complete)), high: kwhText(Math.max(...complete)) }) : "",
    biggestLayer && biggestShare != null && biggestShare >= 0.25 ? t("sum.biggest", { name: biggestLayer.name, pct: pctText(biggestShare) }) : "",
  ]);
  // Each figure with a line of context: what the typical day is drawn from, the year behind the month, the bill a day.
  const typicalFrom = completeDates.length ? t("fig.detail.complete", { count: completeDates.length }) : t("fig.detail.days", { count: readDays.length || dates.length });
  const figures = ([
    typicalKwh != null ? { value: num(typicalKwh), unit: "kWh", label: t("fig.day"), detail: typicalFrom, target: "total" as const } : null,
    typicalKwh != null ? { value: grouped(typicalKwh * REVIEW_MONTH_DAYS), unit: "kWh", label: t("fig.month", { days: REVIEW_MONTH_DAYS }), detail: t("fig.detail.year", { kwh: `${grouped(typicalKwh * 365)} kWh` }), target: "total" as const } : null,
    typicalKwh != null && rate != null ? { value: money(typicalKwh * REVIEW_MONTH_DAYS * rate), unit: "", label: costBasis ? t("fig.billBasis", { basis: costBasis }) : t("fig.bill"), detail: t("fig.detail.perDay", { cost: money(typicalKwh * rate) }), target: "total" as const } : null,
    typicalKwh != null && carbonFactor != null ? { value: tonnes(typicalKwh * 365 * carbonFactor), unit: t("fig.co2Unit"), label: t("fig.co2"), detail: t("fig.detail.factor", { value: carbonFactor.toFixed(3) }), target: "total" as const } : null,
    savingKwh > 0 && (carbonFactor == null || rate == null) ? { value: savingCost != null ? money(savingCost) : grouped(savingKwh), unit: savingCost != null ? "" : "kWh", label: t("fig.saving"), detail: savingShare != null ? t("fig.detail.share", { pct: pctText(savingShare) }) : "", target: "savings" as const } : null,
  ] satisfies Array<EnergyReviewFigure | null>).filter((figure): figure is NonNullable<typeof figure> => !!figure).slice(0, 4);

  const questions: EnergyReviewQuestion[] = ([
    total ? "total" : null, groups ? "groups" : null, largest ? "largest" : null, comparison ? "comparison" : null,
    profile ? "profile" : null, littleUse ? "littleUse" : null, perLight ? "perLight" : null, savings ? "savings" : null,
  ] as Array<EnergyReviewQuestion | null>).filter((id): id is EnergyReviewQuestion => !!id);

  const profileAnswer = !profile ? "" : paragraph([
    onAt !== undefined && offAt !== undefined ? t("profile.answerOn", { on: clock(onAt, locale), off: clock(offAt, locale), kw: kwText(peakKw, 1) }) : t("profile.answerPeak", { kw: kwText(peakKw, 1) }),
    // Points to check have a finding of their own in the summary; with none, the profile says so.
    shownChecks.length ? "" : t("profile.answerNoChecks"),
  ]);
  // Each finding's headline figure, from the same numbers as its sentence.
  const info = (value: string, unit = ""): EnergyReviewHeadline => ({ value, unit, tone: "info" });
  const biggestBlock = [...blocks].sort((a, b) => b.perDay - a.perDay)[0];
  const tied = sortedTop.length > 1 && sortedTop[0]!.pct - sortedTop[1]!.pct <= 1;
  const headlineOf: Record<EnergyReviewQuestion, () => EnergyReviewHeadline> = {
    total: () => typicalKwh == null ? info(t("hl.notYet")) : info(num(typicalKwh), t("hl.total.unit")),
    groups: () => info(`${sortedTop[0]!.pct}%`, tied ? t("hl.groups.tie", { a: sortedTop[0]!.row.name, b: sortedTop[1]!.row.name }) : t("hl.groups.unit", { name: sortedTop[0]!.row.name })),
    largest: () => info(pctText(biggestBlock!.slices[0]!.share), t("hl.largest.unit", { name: inSentence(biggestBlock!.slices[0]!.name, locale) })),
    comparison: () => comparisonHeadline,
    profile: () => onAt !== undefined && offAt !== undefined ? info(`${clock(onAt, locale)} – ${clock(offAt, locale)}`, t("hl.profile.on")) : info(num(peakKw), t("hl.profile.peak")),
    // One meter is named; several are counted; none means every meter was in use.
    littleUse: () => little.length === 1 ? info(little[0]!.meter.name) : little.length > 1 ? info(String(little.length), t("hl.little.many")) : { value: t("hl.little.all"), unit: "", tone: "good" },
    perLight: () => lightRows.length ? info(perLightNum(lightRows[0]!.perLight!), t("hl.light.unit")) : info(t("hl.light.need")),
    savings: () => !savingRows.length ? info(t("hl.sav.none"))
      : savingCost != null ? { value: money(savingCost), unit: t("hl.sav.year"), tone: "good" } : { value: grouped(savingKwh), unit: t("hl.sav.kwhYear"), tone: "good" },
  };
  const answerOf: Record<EnergyReviewQuestion, () => { question: string; answer: string }> = {
    total: () => ({ question: t("glance.total"), answer: typicalKwh == null ? t("glance.totalNone") : t(rate != null ? "glance.totalCost" : "glance.totalKwh", {
      day: kwhText(typicalKwh), month: kwhText(typicalKwh * REVIEW_MONTH_DAYS), cost: rate != null ? money(typicalKwh * REVIEW_MONTH_DAYS * rate) : "", basis: costBasis ? locale === "zh-Hans" ? `（${costBasis}）` : ` (${costBasis})` : "", days: REVIEW_MONTH_DAYS }) }),
    groups: () => ({ question: groups!.heading, answer: `${topRows.map((row, index) => t("groups.item", { name: row.name, pct: `${topShares[index]}%` })).join(locale === "zh-Hans" ? "，" : ", ")}${locale === "zh-Hans" ? "。" : "."}` }),
    largest: () => ({ question: t("glance.largest"), answer: paragraph([list(leadText) + (locale === "zh-Hans" ? "。" : ".")]) }),
    comparison: () => ({ question: comparison!.heading, answer: comparisonAnswer }),
    profile: () => ({ question: t("glance.profile"), answer: profileAnswer }),
    littleUse: () => ({ question: littleUse!.heading, answer: littleAnswer }),
    perLight: () => ({ question: t("glance.perLight"), answer: perLightAnswer }),
    savings: () => ({ question: t("glance.savings"), answer: savingAnswer }),
  };
  const answers: EnergyReviewFinding[] = questions.map(id => ({ id, ...answerOf[id](), headline: headlineOf[id]() }));

  // ---------- feedback: follow-ups and what the AI remembers ----------
  // Written by people and the AI, and kept with saved reports: read defensively, and quoted at a readable length.
  const plainText = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const clip = (text: string) => text.length > MAX_FEEDBACK_TEXT ? `${text.slice(0, MAX_FEEDBACK_TEXT - 1).trimEnd()}…` : text;
  const followUps: EnergyReviewFollowUp[] = (data.followUps ?? [])
    .filter(item => plainText(item.text) && (item.status === "open" || item.status === "done" || item.status === "dropped"))
    .map((item, index) => ({ item, index })).sort((a, b) => Number(a.item.status !== "open") - Number(b.item.status !== "open") || a.index - b.index)
    .slice(0, MAX_FOLLOW_UPS)
    .map(({ item }) => {
      const verdict = item.lastCheck && ["resolved", "ongoing", "unclear"].includes(item.lastCheck.verdict) ? item.lastCheck.verdict : null;
      const evidence = verdict ? plainText(item.lastCheck?.evidence) : "";
      return { text: clip(plainText(item.text)), status: item.status, verdict, evidence: evidence ? clip(evidence) : null };
    });
  const memory = (data.feedbackMemory ?? []).filter(item => plainText(item.text))
    .map((item, index) => ({ item, index })).sort((a, b) => plainText(b.item.date).localeCompare(plainText(a.item.date)) || a.index - b.index)
    .slice(0, MAX_MEMORY).map(({ item }) => clip(plainText(item.text)));

  const generatedDay = generatedAt.slice(0, 10);
  const issued = formatPeriod(generatedDay, generatedDay, locale);
  const address = (reference as { property?: { address?: string } } | null)?.property?.address?.trim();
  return {
    style: "review", locale, hoursMeaning: meaning, projectName: data.projectName, timezone: data.timezone, tzLabel: base.tzLabel,
    from: dates[0] ?? "", to: dates.at(-1) ?? "", dayCount: dates.length, generatedAt, currency, rate, costBasis, carbonFactor,
    questions,
    cover: {
      kicker: t("cover.kicker"),
      title: t("cover.title", { name: data.projectName }),
      subtitle: t("cover.subtitle", { days: dates.length }),
      preparedFor: [data.projectName, ...(address ? [address] : [])],
      period: [periodText, completeDates.length ? t("cover.periodDetail", { count: meterCount, days: completeDates.length }) : t("cover.periodDetailDays", { count: meterCount, days: readDays.length || dates.length })],
      issued: [issued, t("cover.by")],
    },
    summary: {
      intro: summaryIntro, figures, answers,
      note: paragraph([
        t("sum.noteProjection", { days: readDays.length || dates.length }),
        rate != null && base.rate != null ? t(taxPct > 0 ? "sum.noteCostTax" : basis === "tax_inclusive" ? "sum.noteCostIncl" : "sum.noteCost", { rate: moneyText(base.rate, currency, 4), tax: taxName, pct: taxPct }) : t("sum.noteNoRate"),
      ]),
    },
    total, groups, largest, comparison, profile, checks: shownChecks, followUps, memory, littleUse, perLight, savings, nextSteps, method,
    footer: { left: t("foot.left", { name: data.projectName, date: issued }) },
  };
}

function num(value: number, digits = 1) { return value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function grouped(value: number) { return Math.round(value).toLocaleString("en-SG"); }

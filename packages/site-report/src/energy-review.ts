/**
 * The energy review: the site report written as answers to the questions the site asked when its meters went in, the
 * way the first SKTC review was written by hand. It reads like a consultant's review rather than a dashboard:
 *
 *   Cover · Summary (four figures and the answers at a glance) · one section per question — total energy by day and the
 *   cost; the top-level groups; which circuit uses the most in each group; group against group, circuit for circuit;
 *   the average 24 hours, with the points to check; meters with little use; energy per light point; the saving
 *   projection, with recommended next steps · Method and data.
 *
 * It is built from exactly the same readings and the same models as the full report and the management review
 * (buildManagementReview, which itself builds on buildSiteReport), so every figure matches the Overview; nothing here
 * needs AI. Costs include the tax on the price (GST) when the tariff is published before tax, and carbon uses the
 * site's grid emission factor. A question with nothing to answer is left out and the rest are renumbered.
 */
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import { listText } from "./analysis-messages.js";
import { effectiveHours, shortDate, type HoursMeaning } from "./analysis-model.js";
import type { AnalysisData, ScopeMeter, TrendSeries } from "./analysis-types.js";
import { energyReviewMessages, type EnergyReviewKey } from "./energy-review-messages.js";
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

/** The questions a review answers, in reading order; the document numbers the ones present as it goes. */
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
/** Two figures within this share of each other read as "close"; a circuit this much apart is named. */
const CLOSE_SHARE = 0.05;
const NAMED_GAP = 0.15;
/** Motion-sensor dimming, or an earlier night step-down, saves about this share of the lighting it applies to. */
const DIMMING_SHARE = 0.3;
/** Trimming the light timers: this many hours less each night (a quarter of an hour at each end). */
const TRIM_HOURS_A_NIGHT = 0.5;

export type EnergyReviewDay = { date: string; label: string; kwh: number; cost: number | null; complete: boolean };
export type EnergyReviewSlice = { name: string; value: number; share: number; colour: string };
export type EnergyReviewLayer = { key: string; name: string; colour: string; hours: number[] };
export type EnergyReviewCheck = { title: string; text: string };
export type EnergyReviewSaving = { title: string; basis: string; kwhYear: number; costYear: number | null };
export type EnergyReviewStep = { action: string; who: string; when: string };
export type EnergyReviewMeter = { id: string; name: string; group: string; perDay: number | null; basis: string };

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
  /** The questions present, in order. */
  questions: EnergyReviewQuestion[];
  cover: { kicker: string; title: string; subtitle: string; preparedFor: string[]; period: string[]; issued: string[] };
  summary: { intro: string; figures: Array<{ value: string; unit: string; label: string }>; answers: Array<{ id: EnergyReviewQuestion; question: string; answer: string }>; note: string };
  total: { heading: string; intro: string; days: EnergyReviewDay[]; caption: string; projection: Array<{ label: string; kwh: number; cost: number | null; co2Kg: number | null }> } | null;
  groups: { heading: string; intro: string; centre: string; unit: string; slices: EnergyReviewSlice[] } | null;
  largest: { heading: string; intro: string; blocks: Array<{ key: string; name: string; centre: string; slices: EnergyReviewSlice[] }>; note: string } | null;
  comparison: { heading: string; intro: string; title: string; groups: Array<{ name: string; colour: string }>; rows: Array<{ name: string; perDay: number[] }>; callout: string } | null;
  profile: { heading: string; intro: string; title: string; layers: EnergyReviewLayer[]; peakKw: number } | null;
  /** Things to look at on site; shown after the average 24 hours, numbered. */
  checks: EnergyReviewCheck[];
  littleUse: { heading: string; text: string } | null;
  perLight: { heading: string; text: string } | null;
  savings: { heading: string; intro: string; title: string; rows: EnergyReviewSaving[]; totalKwh: number; totalCost: number | null; note: string } | null;
  nextSteps: EnergyReviewStep[];
  method: { intro: string; assumptions: Array<{ label: string; value: string }>; meters: EnergyReviewMeter[] };
  footer: { left: string };
};

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
  const days: EnergyReviewDay[] = base.total.days.map(day => ({ date: day.date, label: `${weekdayOf(day.date, locale)} ${shortDate(day.date, locale)}`, kwh: day.kwh, cost: cost(day.kwh), complete: day.complete }));
  const projection = typicalKwh == null ? [] : [
    { label: t("total.row.day"), kwh: typicalKwh, cost: cost(typicalKwh), co2Kg: co2(typicalKwh) },
    { label: t("total.row.month", { days: REVIEW_MONTH_DAYS }), kwh: typicalKwh * REVIEW_MONTH_DAYS, cost: cost(typicalKwh * REVIEW_MONTH_DAYS), co2Kg: co2(typicalKwh * REVIEW_MONTH_DAYS) },
    { label: t("total.row.year"), kwh: typicalKwh * 365, cost: cost(typicalKwh * 365), co2Kg: co2(typicalKwh * 365) },
  ];
  const firstStopped = stopped[0];
  const total: EnergyReview["total"] = shownDays.length ? {
    heading: t("q.total"),
    intro: paragraph([
      shownDays.length === 1 ? t("total.introOne", { kwh: kwhText(shownDays[0]!.kwh) })
        : kwhText(low) === kwhText(high) ? t("total.introSteady", { kwh: kwhText(low) }) : t("total.intro", { low: num(low), high: kwhText(high) }),
      firstStopped && firstStopped.last ? t("total.stopped", { name: firstStopped.meter.name, date: shortDate(firstStopped.last.date, locale) }) : "",
      typicalKwh != null ? t(cost(typicalKwh) != null ? "total.typicalCost" : "total.typical", { kwh: kwhText(typicalKwh), cost: cost(typicalKwh) != null ? money(cost(typicalKwh)!, 2) : "", basis: costBasis ? locale === "zh-Hans" ? costBasis : ` ${costBasis}` : "" }) : "",
    ]),
    days,
    caption: paragraph([t("total.caption", { count: meterCount }), rate != null ? t(costBasis ? "total.captionCostBasis" : "total.captionCost", { basis: costBasis }) : ""]),
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

  // ---------- 3. which circuit uses the most in each group ----------
  const blocks = tree ? inSavedOrder(tree.children).filter(group => group.kwh > 0).flatMap(group => {
    const circuits = metersIn(group).filter(meter => meter.kwh > 0);
    if (circuits.length < 2) return [];
    const kept = circuits.slice(0, MAX_CIRCUITS - (circuits.length > MAX_CIRCUITS ? 1 : 0));
    const rest = circuits.slice(kept.length);
    const rows = [...kept.map(meter => ({ name: circuitLabel(meter.name, group.name), kwh: meter.kwh })), ...(rest.length ? [{ name: t("largest.others", { count: rest.length }), kwh: rest.reduce((sum, meter) => sum + meter.kwh, 0) }] : [])];
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
  if (alike && alike.length >= 2) {
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
    }
  }

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
  const profileIntro = paragraph([
    onAt !== undefined && offAt !== undefined ? t("profile.introOn", { on: clock(onAt, locale), off: clock(offAt, locale) }) : "",
    t(lighting ? "profile.introPeak" : "profile.introPeakDay", { kw: kwText(peakKw, 1), time: clock(stackedHours.indexOf(peakKw), locale) }),
    drops[0] ? t("profile.introStep", { time: clock(drops[0].hour, locale), kw: kwText(drops[0].to, 1) }) : "",
    dayKw > 0.005 ? dayLead && dayLead.kw >= 0.5 * dayKw ? t("profile.introDayMostly", { kw: kwText(dayKw, 1), name: inSentence(dayLead.layer.name, locale) }) : t("profile.introDay", { kw: kwText(dayKw, 1) }) : "",
  ]);
  const profile: EnergyReview["profile"] = profileLayers.length && peakKw > 0 ? {
    heading: t("q.profile"),
    intro: profileIntro,
    title: t("profile.title", { period: periodText }),
    layers: profileLayers, peakKw,
  } : null;

  // ---------- points to check ----------
  const checks: EnergyReviewCheck[] = [];
  for (const { meter, last } of stopped) {
    const usual = usualOf.get(meter.id) ?? null;
    checks.push({ title: t("check.stopped.title", { name: meter.name }), text: paragraph([
      last ? t("check.stopped.since", { since: at(last.date, last.hour) }) : t("check.stopped.none"),
      usual != null ? t("check.stopped.before", { kwh: kwhText(usual) }) : "",
      t("check.stopped.do"),
    ]) });
  }
  for (const item of poweredWithLights) checks.push({ title: t("check.powered.title", { name: item.meter.name }), text: paragraph([
    item.from !== undefined && item.to !== undefined ? t("check.powered.hours", { from: clock(item.from, locale), to: clock(item.to, locale) }) : t("check.powered.plain"),
    t("check.powered.do"),
  ]) });
  for (const item of notInUse) checks.push({ title: t("check.notInUse.title", { name: item.name }), text: item.reason && !item.reason.startsWith("reason:") ? t("check.notInUse.reason", { reason: item.reason }) : t("check.notInUse.plain") });
  for (const item of (base.total.standout?.items ?? []).slice(0, 2)) checks.push({ title: t("check.standout.title", { date: `${weekdayOf(item.date, locale)} ${shortDate(item.date, locale)}` }), text: item.text });
  if (lighting && base.daytime?.items.length) checks.push({ title: t("check.daytime.title"), text: paragraph([list(base.daytime.items), base.daytime.more ?? ""]) });
  const mustRun = mustRunIds(allMeters, data);
  const quietMustRun = allMeters.filter(meter => mustRun.has(meter.id) && !stoppedIds.has(meter.id) && !notInUseIds.has(meter.id) && meter.series!.cells.every(cell => (cell[2] ?? 0) < USED_DAY_KWH / 24) && meter.series!.cells.some(cell => cell[3] > 0));
  for (const meter of quietMustRun) checks.push({ title: t("check.noUse.title", { name: meter.name }), text: t("check.noUse.do") });
  const shownChecks = checks.slice(0, MAX_CHECKS);

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
    const usedInDay = daytimeUse(data, withMetersInUse(project, silentByDesignIds(data), data.current.spaces, idleMeterIds(data)));
    const daytimePerDay = usedInDay.kwh / Math.max(readDays.length, 1);
    if (yearOf(daytimePerDay) >= 10 && dayHours.length) {
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
  for (const { meter } of stopped.slice(0, 2)) steps.push({ action: t("step.fixMeter", { name: meter.name }), who: t("who.contractor"), when: t("when.week") });
  if (stopped.length > 2) steps.push({ action: t("step.fixMeters", { count: stopped.length - 2 }), who: t("who.contractor"), when: t("when.week") });
  if (lighting && base.daytime?.items.length) {
    const names = base.daytime.items.slice(0, 2).map(item => item.split(/[:：]/)[0]!.trim());
    steps.push({ action: t("step.daytime", { names: list(names) }), who: t("who.contractor"), when: t("when.week") });
  }
  for (const item of poweredWithLights.slice(0, 1)) steps.push({ action: t("step.powered", { name: item.meter.name }), who: t("who.contractor"), when: t("when.convenient") });
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
  const figures = [
    typicalKwh != null ? { value: num(typicalKwh), unit: "kWh", label: t("fig.day") } : null,
    typicalKwh != null ? { value: grouped(typicalKwh * REVIEW_MONTH_DAYS), unit: "kWh", label: t("fig.month", { days: REVIEW_MONTH_DAYS }) } : null,
    typicalKwh != null && rate != null ? { value: money(typicalKwh * REVIEW_MONTH_DAYS * rate), unit: "", label: costBasis ? t("fig.billBasis", { basis: costBasis }) : t("fig.bill") } : null,
    typicalKwh != null && carbonFactor != null ? { value: tonnes(typicalKwh * 365 * carbonFactor), unit: t("fig.co2Unit"), label: t("fig.co2") } : null,
    savingKwh > 0 && (carbonFactor == null || rate == null) ? { value: savingCost != null ? money(savingCost) : grouped(savingKwh), unit: savingCost != null ? "" : "kWh", label: t("fig.saving") } : null,
  ].filter((figure): figure is { value: string; unit: string; label: string } => !!figure).slice(0, 4);

  const questions: EnergyReviewQuestion[] = ([
    total ? "total" : null, groups ? "groups" : null, largest ? "largest" : null, comparison ? "comparison" : null,
    profile ? "profile" : null, littleUse ? "littleUse" : null, perLight ? "perLight" : null, savings ? "savings" : null,
  ] as Array<EnergyReviewQuestion | null>).filter((id): id is EnergyReviewQuestion => !!id);

  const profileAnswer = !profile ? "" : paragraph([
    onAt !== undefined && offAt !== undefined ? t("profile.answerOn", { on: clock(onAt, locale), off: clock(offAt, locale), kw: kwText(peakKw, 1) }) : t("profile.answerPeak", { kw: kwText(peakKw, 1) }),
    shownChecks.length ? t(shownChecks.length === 1 ? "profile.answerChecks.one" : "profile.answerChecks.other", { count: shownChecks.length, section: questions.indexOf("profile") + 1 }) : t("profile.answerNoChecks"),
  ]);
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
  const answers = questions.map(id => ({ id, ...answerOf[id]() }));

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
    total, groups, largest, comparison, profile, checks: shownChecks, littleUse, perLight, savings, nextSteps, method,
    footer: { left: t("foot.left", { name: data.projectName, date: issued }) },
  };
}

function num(value: number, digits = 1) { return value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function grouped(value: number) { return Math.round(value).toLocaleString("en-SG"); }

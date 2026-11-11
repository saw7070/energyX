/**
 * The management review: a short, plain report for a site's management, organised by what the meters serve. It is
 * built from exactly the same readings and the same model as the full report (buildSiteReport), so every figure in it
 * matches the Overview; nothing here needs AI. Sections follow the order a manager reads in:
 *
 *   Summary (a few findings and the things worth deciding) · Total energy by day and cost · By group, with what uses
 *   the most in each group · Group against group (only when groups of the same kind exist) · The average 24 hours ·
 *   Saving energy · Method and data.
 *
 * A section with nothing to say is left out rather than shown empty, except the savings and method sections, which
 * say so in one line. Energy per lighting point is not offered: the meter data holds no count of lights.
 */
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import { listText } from "./analysis-messages.js";
import {
  aboveBenchmarkWhenClosed, alwaysOnKw, closedUseBreakdown, dayTypeBaselines, effectiveHours, findAnomalies, hoursRangeLabel, quietHours,
  savingsPlan, scopeDays, shortDate, timeBuckets, type AnalysisDay, type HoursMeaning,
} from "./analysis-model.js";
import type { AnalysisData, ScopeData, ScopeMeter } from "./analysis-types.js";
import { forHoursMeaning, forOneDay, translatorFor, type EnergyIqLocale, type Translate } from "./locale.js";
import { managementReviewMessages, type ManagementReviewKey } from "./management-review-messages.js";
import { analysisGroupTree, type MeterGroupNode, type MeterGroupTree } from "./meter-groups.js";
import { notInUseIds, withMetersInUse, type NotInUseMeter } from "./meters-in-use.js";
import { formatPeriod } from "./report-period.js";
import type { StandoutReport } from "./standout-report.js";
import { buildSiteReport, clock, DAYTIME_NOTABLE_SHARE, hourRange, inWindow, kwhText, kwText, moneyText, openingWindow, pctText, REPORT_COLOURS, weekdayOf } from "./site-report-model.js";

type T = Translate<ManagementReviewKey>;
/** The review's wording: "lights." variants for lights-on hours, "day." variants for a review of a single day. */
const reviewText = (locale: EnergyIqLocale, meaning: HoursMeaning, oneDay = false): T =>
  forHoursMeaning(forOneDay(translatorFor(managementReviewMessages, locale), managementReviewMessages, oneDay), managementReviewMessages, meaning);

/** The sections a review can hold, in reading order. */
export const REVIEW_SECTIONS = ["summary", "total", "groups", "comparison", "profile", "savings", "method"] as const;
export type ReviewSectionId = typeof REVIEW_SECTIONS[number];
/** Two groups whose kWh a day are within this share of each other read as "close". */
export const REVIEW_CLOSE_SHARE = 0.05;
/** A meter more than this many hours behind the rest of the site has stopped reporting (the Overview's rule). */
export const REVIEW_STOPPED_HOURS = 12;
/** Lights-on hours: the timer measure trims this much from each end of the night. */
const TRIM_HOURS_A_NIGHT = 0.5;
const MAX_FINDINGS = 5;
const MAX_DECISIONS = 4;
const MAX_PARTS = 5;

export type ReviewDay = { date: string; dow: string; kwh: number; cost: number | null; complete: boolean };
export type ReviewDecision = { title: string; why: string; worth: string | null };
export type ReviewBarPart = { name: string; kwh: number; share: number };
export type ReviewGroup = { key: string; name: string; kwh: number; perDay: number; share: number; colour: string; parts: ReviewBarPart[]; more: number; biggest: string | null };
/** `area` is where it applies (empty for the whole site); `why` is the one line the decisions table shows. */
export type ReviewSaving = { title: string; area: string; why: string; basis: string; kwhYear: number; costYear: number | null };
export type ReviewMeter = { id: string; name: string; group: string; perDay: number | null; note: string };

export type ManagementReview = {
  style: "management";
  /** The language every sentence is written in. */
  locale: EnergyIqLocale;
  hoursMeaning: HoursMeaning;
  projectName: string; timezone: string; tzLabel: string; from: string; to: string; dayCount: number; generatedAt: string;
  currency: string; rate: number | null; rateLabel: string | null;
  /** The sections present, in order; the document numbers them as it goes. */
  sections: ReviewSectionId[];
  masthead: { site: string; kicker: string; period: string; periodNote: string };
  title: string; lede: string;
  keyFigures: Array<{ value: string; label: string }>;
  summary: { findings: string[]; decisions: ReviewDecision[] };
  total: {
    intro: string; days: ReviewDay[]; typicalKwh: number | null; caption: string; meterCount: number;
    rows: Array<{ label: string; kwh: number; cost: number | null }>;
    /** Days that used clearly more or less than a usual day, and the meters behind each: the full report's own block. */
    standout: StandoutReport | null;
  };
  /** Top-level groups (or, with no groups, the biggest circuits as one list). */
  groups: { heading: string; intro: string; rows: ReviewGroup[]; byCircuit: boolean; note: string } | null;
  comparison: { heading: string; intro: string; groups: Array<{ key: string; name: string; colour: string; perDay: number }>; parts: Array<{ name: string; perDay: number[] }>; caption: string } | null;
  profile: { hours: number[]; openFrom: number; openTo: number; intro: string; caption: string; days: number } | null;
  savings: { intro: string; rows: ReviewSaving[]; totalKwh: number; totalCost: number | null; checks: string[]; note: string };
  method: { intro: string; rows: Array<{ label: string; value: string }>; meters: ReviewMeter[]; notInUseNote: string | null };
  footer: { left: string; right: string };
};

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const hourIndex = (date: string, hour: number) => Date.parse(`${date}T00:00:00Z`) / 3_600_000 + hour;
const sentences = (parts: string[], locale: EnergyIqLocale) => parts.filter(Boolean).join(locale === "zh-Hans" ? "" : " ");

// ---------- groups of the same kind ----------
const tokens = (name: string) => name.toLowerCase().replace(/[(),:;]/g, " ").split(/\s+/).filter(Boolean);
/** "12A", "A", "2": the part of a name that tells one group of a kind from another. */
const isIdentifier = (token: string) => /\d/.test(token) || token.length === 1;
/** What kind of group a name is: "Block 12A" and "Block A" are both "block"; "Common area" is its own kind. */
export const groupKind = (name: string) => tokens(name).filter(token => !isIdentifier(token)).join(" ");
/** A part's name without its group's own identifier: "12A lift lobby lighting" in Block 12A is "lift lobby lighting". */
const partKey = (name: string, group: string) => { const own = new Set(tokens(group).filter(isIdentifier)); return tokens(name).filter(token => !own.has(token)).join(" "); };
const partLabel = (name: string, group: string) => {
  const own = new Set(tokens(group).filter(isIdentifier));
  const kept = name.split(/\s+/).filter(word => !own.has(word.toLowerCase().replace(/[(),:;]/g, ""))).join(" ").trim();
  return kept ? kept.charAt(0).toUpperCase() + kept.slice(1) : name;
};
/** The groups and meters directly inside a group, largest first. */
const partsOf = (node: MeterGroupNode): ReviewBarPart[] => [
  ...node.children.map(child => ({ name: child.name, kwh: child.kwh })),
  ...node.meters.filter(meter => !meter.unmetered).map(meter => ({ name: meter.name, kwh: meter.kwh })),
].filter(part => part.kwh > 0).map(part => ({ ...part, share: node.kwh > 0 ? part.kwh / node.kwh : 0 })).sort((a, b) => b.kwh - a.kwh || a.name.localeCompare(b.name));

/**
 * Top-level groups that can be compared: two or more of the same kind (two blocks, three towers). With several such
 * kinds, the one with the most groups, then the most energy, wins. Null when no two groups are alike.
 */
export function comparableGroups(tree: MeterGroupTree): MeterGroupNode[] | null {
  const byKind = new Map<string, MeterGroupNode[]>();
  for (const group of tree.children) {
    const kind = groupKind(group.name);
    if (!kind || group.kwh <= 0) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), group]);
  }
  const sets = [...byKind.values()].filter(set => set.length >= 2);
  if (!sets.length) return null;
  const energy = (set: MeterGroupNode[]) => set.reduce((sum, group) => sum + group.kwh, 0);
  return sets.sort((a, b) => b.length - a.length || energy(b) - energy(a))[0]!;
}

// ---------- the review ----------
export function buildManagementReview(data: AnalysisData, reference: ProjectSpatialReference | null, generatedAt = new Date().toISOString(), locale: EnergyIqLocale = "en"): ManagementReview {
  const base = buildSiteReport(data, reference, generatedAt, locale);
  const meaning: HoursMeaning = data.hoursMeaning ?? "opening";
  const lighting = meaning === "lights_on";
  // A daily report reviews one day: "on this day", and nothing projected from part of a day.
  const oneDay = data.current.project.dates.length === 1;
  const t = reviewText(locale, meaning, oneDay);
  const list = (items: string[]) => listText(items, locale);
  const paragraph = (parts: string[]) => sentences(parts, locale);
  const notInUse = notInUseIds(data);
  // The same days as the full report: a meter marked not in use never makes a day incomplete.
  const project = withMetersInUse(data.current.project, notInUse, data.current.spaces);
  const days = scopeDays(project, data.holidays);
  const dates = project.dates;
  const { rate, currency } = base;
  const money = (value: number | null, digits = 0) => value == null ? null : moneyText(value, currency, digits);
  const cost = (kwh: number) => rate == null ? null : kwh * rate;
  const at = (date: string, hour: number) => t("time.at", { date: shortDate(date, locale), time: clock(hour, locale) });
  const periodText = dates.length ? formatPeriod(dates[0]!, dates.at(-1)!, locale) : "";

  // Days with any reading at all: per-day figures are averaged over these, so a site connected mid-period is fair.
  const totalCells = project.total?.cells ?? [];
  const readDates = new Set(totalCells.filter(cell => cell[3] > 0).map(cell => cell[0]));
  const readDays = days.filter(day => readDates.has(day.date));
  const perDayOf = (kwh: number) => kwh / Math.max(readDays.length, 1);
  const totalKwh = project.usageKwh ?? totalCells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
  const complete = days.filter(day => day.complete);
  const typicalKwh = median(complete.map(day => day.totalKwh)) ?? (oneDay ? null : mean(readDays.map(day => day.totalKwh)));
  const noReadings = oneDay && !readDays.length && !totalCells.some(cell => cell[2] != null);
  const partDay = oneDay && !noReadings && !complete.length;

  // ---------- meters ----------
  const meters = siteMeters(data);
  const tree = analysisGroupTree(data, t("groups.unmeteredName"));
  const topGroupOf = topGroupNames(data);
  const siteLast = totalCells.reduce((last, cell) => cell[3] > 0 ? Math.max(last, hourIndex(cell[0], cell[1])) : last, -Infinity);
  const notInUseList = data.notInUse ?? [];
  const reasonText = (stored: string) => { const code = stored.startsWith("reason:") ? stored.slice(7) : ""; return ["nobody_uses", "switched_off", "spare", "removed"].includes(code) ? t(`reason.${code}` as ManagementReviewKey) : stored; };
  const meterRows = meters.map(({ meter, place }) => {
    const cells = meter.series?.cells ?? [];
    const received = cells.filter(cell => cell[3] > 0);
    const last = received.reduce<{ date: string; hour: number } | null>((best, cell) => !best || hourIndex(cell[0], cell[1]) > hourIndex(best.date, best.hour) ? { date: cell[0], hour: cell[1] } : best, null);
    const kwh = cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
    const off = notInUseList.find(item => item.id === meter.id);
    const stopped = !off && meter.series && Number.isFinite(siteLast) && (!last || siteLast - hourIndex(last.date, last.hour) > REVIEW_STOPPED_HOURS);
    // Days the site was reading but this meter was not, fully: the same rule as a complete day.
    const expected = meter.series ? meter.series.expectedMinutesPerHour * 24 : 0;
    const minutesOn = new Map<string, number>();
    for (const cell of cells) minutesOn.set(cell[0], (minutesOn.get(cell[0]) ?? 0) + (cell[4] ? 0 : cell[3]));
    const gapDays = meter.series ? dates.filter(date => readDates.has(date) && (minutesOn.get(date) ?? 0) < expected).length : 0;
    const note = off ? off.reason ? t("met.note.notInUse", { reason: reasonText(off.reason) }) : t("met.note.notInUsePlain")
      : stopped ? last ? t("met.note.stopped", { since: at(last.date, last.hour) }) : t("met.note.none")
      : meter.series && !received.length ? t("met.note.none")
      : gapDays ? t(gapDays === 1 ? "met.note.gaps.one" : "met.note.gaps.other", { count: gapDays }) : "";
    return { id: meter.id, name: meter.name, group: topGroupOf.get(meter.id) ?? place, perDay: meter.series ? perDayOf(kwh) : null, note, stopped: !!stopped, last };
  });
  const stopped = meterRows.filter(row => row.stopped);
  const meterCount = meters.length || base.circuits.reduce((sum, circuit) => sum + circuit.meterIds.length, 0);

  // ---------- total energy ----------
  const reviewDays: ReviewDay[] = days.map(day => ({ date: day.date, dow: weekdayOf(day.date, locale), kwh: day.totalKwh, cost: cost(day.totalKwh), complete: day.complete }));
  const shownDays = readDays.length ? readDays : days;
  const low = Math.min(...shownDays.map(day => day.totalKwh)), high = Math.max(...shownDays.map(day => day.totalKwh));
  const missing = readDays.filter(day => !day.complete).length;
  const typicalCost = typicalKwh == null ? null : cost(typicalKwh);
  const total = {
    // Days stand out against other days; a one-day review has none to compare with.
    days: reviewDays, typicalKwh, meterCount, standout: reviewDays.length > 1 ? base.standout : null,
    intro: !shownDays.length ? "" : paragraph([
      shownDays.length > 1 && kwhText(low) === kwhText(high) ? t("total.introSteady", { kwh: kwhText(low), cost: typicalCost != null ? t("total.introCost", { cost: money(typicalCost, 2)! }) : "" })
        : shownDays.length === 1 ? t("total.introOne", { kwh: kwhText(shownDays[0]!.totalKwh), cost: rate != null ? t("total.introCost", { cost: money(cost(shownDays[0]!.totalKwh), 2)! }) : "" })
        : t("total.intro", { low: kwhText(low), high: kwhText(high), typical: typicalKwh != null ? kwhText(typicalKwh) : "—", cost: typicalCost != null ? t("total.introCost", { cost: money(typicalCost, 2)! }) : "" }),
      missing ? t(missing === 1 ? "total.missing.one" : "total.missing.other", { count: missing }) : "",
      complete.length && shownDays.length > 1 && kwhText(low) !== kwhText(high) ? t("total.typicalNote") : "",
    ]),
    caption: paragraph([t("total.caption", { count: meterCount }), rate != null && base.rateLabel ? t("total.captionCost", { rate: base.rateLabel }) : ""]),
    rows: typicalKwh == null ? [] : [
      { label: t("total.row.day"), kwh: typicalKwh, cost: cost(typicalKwh) },
      { label: t("total.row.month"), kwh: typicalKwh * 30, cost: cost(typicalKwh * 30) },
      { label: t("total.row.year"), kwh: typicalKwh * 365, cost: cost(typicalKwh * 365) },
    ],
  };

  // ---------- by group ----------
  const colourOf = new Map((base.groups?.top ?? []).map(group => [group.key, group.colour]));
  const palette = [REPORT_COLOURS.steel, REPORT_COLOURS.ember, REPORT_COLOURS.amber, "#6B4E9B", "#3E8E7E", "#B3446C"];
  const siteKwh = tree?.kwh ?? totalKwh;
  const groupRows: ReviewGroup[] = tree ? tree.children.map((group, index) => {
    const parts = partsOf(group);
    const lead = parts[0];
    return {
      key: group.id, name: group.name, kwh: group.kwh, perDay: perDayOf(group.kwh), share: siteKwh > 0 ? group.kwh / siteKwh : 0,
      colour: colourOf.get(group.id) ?? palette[index % palette.length]!, parts: parts.slice(0, MAX_PARTS), more: Math.max(0, parts.length - MAX_PARTS),
      biggest: lead && parts.length > 1 ? t("groups.biggest", { group: group.name, name: lead.name, pct: pctText(lead.share) }) : null,
    };
  }) : [];
  const circuitRows: ReviewGroup[] = !tree && base.circuits.length > 1 ? base.circuits.slice(0, 8).map(circuit => ({
    key: circuit.key, name: circuit.name, kwh: circuit.periodKwh, perDay: perDayOf(circuit.periodKwh), share: totalKwh > 0 ? circuit.periodKwh / totalKwh : 0,
    colour: circuit.colour, parts: [], more: 0, biggest: null,
  })) : [];
  const groups: ManagementReview["groups"] = groupRows.length ? {
    heading: groupRows.length <= 4 ? list(groupRows.map(group => group.name)) : t("sec.groups"),
    intro: t("groups.intro"), rows: groupRows, byCircuit: false,
    note: tree && tree.unmeteredKwh > 0 ? t("groups.unmetered", { kwh: kwhText(tree.unmeteredKwh) }) : "",
  } : circuitRows.length ? { heading: t("sec.circuits"), intro: t("groups.circuitsIntro"), rows: circuitRows, byCircuit: true, note: "" } : null;

  // ---------- group against group ----------
  const alike = tree ? comparableGroups(tree) : null;
  const comparison = alike ? compareGroups(alike, { t, locale, perDayOf, colourOf: (group, index) => colourOf.get(group.id) ?? palette[index % palette.length]! }) : null;

  // ---------- the average 24 hours ----------
  const hoursSet = effectiveHours(data.openingHours, meaning);
  const hoursPublished = hoursSet === data.openingHours;
  const openRange = openingWindow(hoursSet, lighting);
  const profile = averageDay({ project, days, lighting, openRange, t, locale });

  // ---------- saving energy ----------
  const split = timeBuckets(project, days, data.openingHours, meaning);
  const closedShare = split.total > 0 ? split.closedKwh / split.total : null;
  const alwaysOn = alwaysOnKw(project, quietHours(data.openingHours, meaning));
  const above = alwaysOn != null ? aboveBenchmarkWhenClosed(project, days, data.openingHours, alwaysOn, meaning) : null;
  const closedUse = closedUseBreakdown(project, data.current.spaces, data.holidays, data.openingHours, locale, meaning);
  const plan = savingsPlan({
    projectName: data.projectName, closedUse, closedHoursPerYear: split.closedShareOfHours * 8760, rate, currency,
    aboveBenchmarkKwh: above, benchmarkKw: alwaysOn, periodDays: days.length, anomalies: findAnomalies(days, dayTypeBaselines(days)), actions: [], meaning,
  }, locale);
  const rows: ReviewSaving[] = plan.filter(item => item.counted && item.annualKwh != null && item.annualKwh >= 1)
    .map(item => ({ title: item.title, area: item.area === data.projectName ? "" : item.area, why: item.area, basis: item.detail, kwhYear: item.annualKwh!, costYear: item.annualCost }));
  // Lights-on hours: the part of the load that switches with the lights, off half an hour sooner each night.
  if (lighting && profile && profile.switchedKw > 0) {
    const kwhYear = profile.switchedKw * TRIM_HOURS_A_NIGHT * 365;
    if (kwhYear >= 1) rows.push({ title: t("lights.sav.trim"), area: "", why: t("lights.sav.trimWhy"), basis: t("lights.sav.trimBasis", { kw: kwText(profile.switchedKw) }), kwhYear, costYear: cost(kwhYear) });
  }
  rows.sort((a, b) => (b.costYear ?? b.kwhYear) - (a.costYear ?? a.kwhYear));
  const savingKwh = rows.reduce((sum, row) => sum + row.kwhYear, 0);
  const savingCost = rate != null ? rows.reduce((sum, row) => sum + (row.costYear ?? 0), 0) : null;
  const checks = plan.filter(item => !item.counted && item.source === "readings").map(item => item.title);
  const savings = {
    rows, totalKwh: savingKwh, totalCost: savingCost, checks,
    intro: rows.length ? t(rows.length === 1 ? "sav.intro.one" : "sav.intro.other", { count: rows.length, kwh: kwhText(savingKwh), cost: savingCost != null ? t("sav.introCost", { cost: money(savingCost)! }) : "" }) : t("sav.none"),
    note: rows.length ? rate != null && base.rateLabel ? t("sav.note", { days: days.length, rate: base.rateLabel }) : t("sav.noteNoRate", { days: days.length }) : "",
  };

  // ---------- summary ----------
  const baseShare = base.benchmark.baseKw != null && totalKwh > 0 ? Math.min(1, base.benchmark.baseKw * totalCells.filter(cell => cell[2] != null).length / totalKwh) : null;
  const topGroup = groupRows[0];
  const topPart = topGroup?.parts[0];
  const firstStopped = stopped[0];
  const standoutDates = base.standout.items.map(item => shortDate(item.date, locale));
  const standoutFinding = standoutDates.length ? t(standoutDates.length === 1 ? "find.standout.one" : "find.standout.other", { count: standoutDates.length, dates: list(standoutDates) }) : "";
  const findings = noReadings ? [t("day.find.none")] : [
    partDay ? project.coverage != null && project.coverage < 100 ? t("day.find.missing", { pct: pctText(project.coverage / 100) }) : t("day.find.missingPlain") : "",
    readDays.length ? t("find.total", { kwh: kwhText(totalKwh), days: readDays.length, perDay: kwhText(perDayOf(totalKwh)), cost: rate != null ? t("find.totalCost", { cost: money(cost(perDayOf(totalKwh)), 2)! }) : "" }) : "",
    closedShare == null ? ""
      : lighting ? t(closedShare >= DAYTIME_NOTABLE_SHARE ? "find.closed" : "lights.find.night", { pct: pctText(closedShare) })
      : baseShare != null && baseShare >= 0.5 && base.benchmark.baseKw != null ? t("find.alwaysOn", { kw: kwText(base.benchmark.baseKw), pct: pctText(baseShare) })
      : closedShare >= 0.4 ? t("find.closed", { pct: pctText(closedShare) }) : t("find.working", { pct: pctText(1 - closedShare) }),
    topGroup && groupRows.length > 1 ? topPart && topGroup.parts.length > 1 ? t("find.groupPart", { name: topGroup.name, pct: pctText(topGroup.share), part: topPart.name, partPct: pctText(topPart.share) }) : t("find.group", { name: topGroup.name, pct: pctText(topGroup.share) })
      : circuitRows[0] ? t("find.circuit", { name: circuitRows[0].name, pct: pctText(circuitRows[0].share) }) : "",
    comparison?.finding ?? "",
    stopped.length === 1 && firstStopped ? t("find.stopped.one", { name: firstStopped.name, since: firstStopped.last ? at(firstStopped.last.date, firstStopped.last.hour) : periodText })
      : stopped.length > 1 ? t("find.stopped.other", { count: stopped.length, names: list(stopped.map(row => row.name)) }) : "",
    standoutFinding,
    notInUseList.length === 1 ? t("find.notInUse.one", { name: notInUseList[0]!.name }) : notInUseList.length > 1 ? t("find.notInUse.other", { count: notInUseList.length }) : "",
  ].filter(Boolean).slice(0, MAX_FINDINGS);
  const worth = (row: { kwhYear: number; costYear: number | null }) => row.costYear != null ? money(row.costYear) : kwhText(row.kwhYear);
  // No readings at all on a daily report's day: the one thing to decide is getting the meters reporting again.
  const silentMeters = meterRows.filter(row => !notInUseList.some(item => item.id === row.id));
  const decisions: ReviewDecision[] = noReadings ? silentMeters.length === 1
    ? [{ title: t("dec.fixMeter.one", { name: silentMeters[0]!.name }), why: t("dec.fixMeterWhy.one", { since: periodText }), worth: null }]
    : silentMeters.length > 1 ? [{ title: t("dec.fixMeter.other", { count: silentMeters.length }), why: t("dec.fixMeterWhy.other", { names: list(silentMeters.map(row => row.name)) }), worth: null }] : []
    : [
    ...rows.slice(0, 2).map(row => ({ title: row.title, why: row.why, worth: worth(row) })),
    ...(stopped.length === 1 && firstStopped ? [{ title: t("dec.fixMeter.one", { name: firstStopped.name }), why: t("dec.fixMeterWhy.one", { since: firstStopped.last ? at(firstStopped.last.date, firstStopped.last.hour) : periodText }), worth: null }]
      : stopped.length > 1 ? [{ title: t("dec.fixMeter.other", { count: stopped.length }), why: t("dec.fixMeterWhy.other", { names: list(stopped.map(row => row.name)) }), worth: null }] : []),
    ...(rate == null ? [{ title: t("dec.rate"), why: t("dec.rateWhy"), worth: null }] : []),
    ...checks.slice(0, 1).map(title => ({ title, why: t("dec.check"), worth: null })),
  ].slice(0, MAX_DECISIONS);

  // ---------- method and data ----------
  const firstReading = totalCells.filter(cell => cell[3] > 0).reduce<{ date: string; hour: number } | null>((best, cell) => !best || hourIndex(cell[0], cell[1]) < hourIndex(best.date, best.hour) ? { date: cell[0], hour: cell[1] } : best, null);
  // All readings ever taken say when the site really started; without them, a first reading after the period's first
  // hour means the site started inside the period.
  const historyFirst = data.history?.total?.cells.find(cell => cell[3] > 0)?.[0];
  const startedInside = !!firstReading && (historyFirst ? historyFirst >= dates[0]! : hourIndex(firstReading.date, firstReading.hour) > hourIndex(dates[0]!, 0));
  const firstText = !firstReading ? t("met.firstNone") : startedInside ? t("met.firstInPeriod", { date: at(firstReading.date, firstReading.hour) }) : t("met.firstBefore");
  const hoursValue = hoursRangeLabel(firstRange(hoursSet), locale);
  const offCount = notInUseList.length;
  const method = {
    intro: t("met.intro", { tz: base.tzLabel }),
    rows: [
      { label: t("met.row.meters"), value: offCount ? t("met.metersNotInUse", { count: meterCount, off: offCount }) : t("met.metersValue", { count: meterCount }) },
      { label: t("met.row.period"), value: t("met.periodValue", { period: periodText, days: dates.length }) },
      { label: t("met.row.first"), value: firstText },
      { label: t("met.row.hours"), value: hoursPublished ? hoursValue : t("met.hoursAssumed", { hours: hoursValue }) },
      { label: t("met.row.rate"), value: base.rateLabel ?? t("met.rateNone") },
      ...(project.coverage != null ? [{ label: t("met.row.coverage"), value: t("met.coverageValue", { pct: pctText(project.coverage / 100) }) }] : []),
      { label: t("met.row.complete"), value: t("met.completeValue", { count: complete.length, days: dates.length }) },
    ],
    meters: meterRows.map(({ id, name, group, perDay, note }) => ({ id, name, group, perDay, note })),
    notInUseNote: offCount ? t("met.notInUseText") : null,
  };

  // ---------- masthead and key figures ----------
  const keyFigures = [
    partDay ? { value: kwhText(totalKwh), label: t("day.kf.measured") } : null,
    typicalKwh != null ? { value: kwhText(typicalKwh), label: t("kf.typicalDay") } : null,
    typicalKwh != null ? { value: kwhText(typicalKwh * 30), label: t("kf.month") } : null,
    typicalKwh != null && rate != null ? { value: money(typicalKwh * 30 * rate)!, label: t("kf.monthCost") } : null,
    savingKwh > 0 ? { value: savingCost != null ? money(savingCost)! : kwhText(savingKwh), label: t("kf.saving") } : null,
    closedShare != null ? { value: pctText(closedShare), label: t("kf.closed") } : null,
  ].filter((figure): figure is { value: string; label: string } => !!figure).slice(0, 4);
  // A day with no readings at all has nothing to chart: the summary says so and the method lists every meter.
  const sections: ReviewSectionId[] = noReadings ? ["summary", "method"] : ["summary", "total", ...(groups ? ["groups" as const] : []), ...(comparison ? ["comparison" as const] : []), ...(profile ? ["profile" as const] : []), "savings", "method"];
  const generatedDay = generatedAt.slice(0, 10);
  return {
    style: "management", locale, hoursMeaning: meaning, projectName: data.projectName, timezone: data.timezone, tzLabel: base.tzLabel,
    from: dates[0] ?? "", to: dates.at(-1) ?? "", dayCount: dates.length, generatedAt, currency, rate, rateLabel: base.rateLabel,
    sections,
    masthead: { site: data.projectName, kicker: t("doc.kicker"), period: periodText, periodNote: t("doc.periodNote", { days: dates.length, tz: base.tzLabel }) },
    title: t(dates.length === 1 ? "title.one" : "title.other", { days: dates.length }),
    lede: t(meterCount === 1 ? "lede.one" : tree ? "lede.groups" : "lede.plain", { count: meterCount, days: dates.length }),
    keyFigures,
    summary: { findings, decisions },
    total, groups,
    comparison: comparison ? { heading: comparison.heading, intro: comparison.intro, groups: comparison.groups, parts: comparison.parts, caption: comparison.caption } : null,
    profile: profile ? { hours: profile.hours, openFrom: openRange.from, openTo: openRange.to, intro: profile.intro, caption: profile.caption, days: profile.days } : null,
    savings, method,
    footer: { left: t("foot.left", { count: meterCount, tz: base.tzLabel }), right: t("foot.right", { date: formatPeriod(generatedDay, generatedDay, locale) }) },
  };
}

/** The first published range, for the method table ("19:00 → 07:00 next day"). */
function firstRange(hours: Record<string, Array<{ from: string; to: string }>>) {
  return ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => hours[day]?.[0]).find(Boolean) ?? { from: "08:00", to: "18:00" };
}

/** Every real meter of the site once, with the space it sits in: official meters that are not a main meter. */
function siteMeters(data: AnalysisData): Array<{ meter: ScopeMeter; place: string }> {
  const sources = data.current.spaces.length ? data.current.spaces : [data.current.project];
  const seen = new Set<string>();
  const out: Array<{ meter: ScopeMeter; place: string }> = [];
  for (const space of sources) for (const meter of space.meters) {
    if (!meter.official || meter.category === "overall" || seen.has(meter.id)) continue;
    seen.add(meter.id);
    out.push({ meter, place: space === data.current.project ? meter.location : space.name });
  }
  // Meters marked not in use stay listed even when the spaces left them out.
  for (const meter of data.current.project.meters) if (!seen.has(meter.id) && meter.official && meter.category !== "overall" && (data.notInUse ?? []).some((item: NotInUseMeter) => item.id === meter.id)) {
    seen.add(meter.id);
    out.push({ meter, place: meter.location });
  }
  return out;
}

/** Each meter's top-level group by name, from the readings' groups. Empty when the readings carry none. */
function topGroupNames(data: AnalysisData): Map<string, string> {
  const list = data.groups?.list ?? [];
  const byId = new Map(list.map(group => [group.id, group]));
  const top = (id: string | null): string | null => {
    let group = id ? byId.get(id) : undefined;
    for (let guard = 0; group?.parentId && byId.has(group.parentId) && guard < 50; guard += 1) group = byId.get(group.parentId);
    return group?.name ?? null;
  };
  return new Map((data.groups?.meters ?? []).flatMap(meter => { const name = top(meter.groupId); return name ? [[meter.id, name] as const] : []; }));
}

/** Two or more groups of the same kind side by side: their totals a day, and the parts every one of them has. */
function compareGroups(groups: MeterGroupNode[], helpers: { t: T; locale: EnergyIqLocale; perDayOf: (kwh: number) => number; colourOf: (group: MeterGroupNode, index: number) => string }) {
  const { t, perDayOf } = helpers;
  const rows = groups.map((group, index) => ({ key: group.id, name: group.name, colour: helpers.colourOf(group, index), perDay: perDayOf(group.kwh) }));
  const sorted = [...rows].sort((a, b) => b.perDay - a.perDay);
  const kwhDay = (value: number) => kwhText(value);
  // Parts matched by name once each group's own identifier is taken out ("12A lift lobby" ↔ "12B lift lobby").
  const keyed = groups.map(group => {
    const map = new Map<string, { label: string; kwh: number }>();
    for (const part of partsOf(group)) {
      const key = partKey(part.name, group.name);
      if (!key) continue;
      const known = map.get(key);
      map.set(key, { label: known?.label ?? partLabel(part.name, group.name), kwh: (known?.kwh ?? 0) + part.kwh });
    }
    return map;
  });
  const shared = [...keyed[0]!.keys()].filter(key => keyed.every(map => map.has(key)));
  const parts = shared.length >= 2 ? shared.map(key => ({ name: keyed[0]!.get(key)!.label, perDay: keyed.map(map => perDayOf(map.get(key)!.kwh)) }))
    .sort((a, b) => Math.max(...b.perDay) - Math.max(...a.perDay)) : [];
  let finding: string, partSentence = "";
  if (rows.length === 2) {
    const [high, low] = sorted as [typeof rows[number], typeof rows[number]];
    const gap = low.perDay > 0 ? high.perDay / low.perDay - 1 : 0;
    // Like for like: only the parts both have. When those are close, what only the higher one has explains the gap.
    const like = [0, 1].map(index => parts.reduce((sum, part) => sum + (part.perDay[index] ?? 0), 0));
    const likeGap = Math.min(like[0]!, like[1]!) > 0 ? Math.max(like[0]!, like[1]!) / Math.min(like[0]!, like[1]!) - 1 : 0;
    const highIndex = rows.indexOf(high);
    const extra = [...keyed[highIndex]!.entries()].filter(([key]) => !shared.includes(key)).map(([, part]) => part).sort((a, b) => b.kwh - a.kwh)[0];
    const explained = parts.length > 0 && gap >= REVIEW_CLOSE_SHARE && likeGap < REVIEW_CLOSE_SHARE && !!extra && perDayOf(extra.kwh) >= 0.5 * (high.perDay - low.perDay);
    finding = gap < REVIEW_CLOSE_SHARE
      ? t("find.close", { a: rows[0]!.name, b: rows[1]!.name, aKwh: kwhDay(rows[0]!.perDay), bKwh: kwhDay(rows[1]!.perDay) })
      : explained ? t("find.apartBecause", { a: high.name, b: low.name, pct: pctText(gap), part: extra!.label })
      : t("find.apart", { a: high.name, b: low.name, pct: pctText(gap), aKwh: kwhDay(high.perDay), bKwh: kwhDay(low.perDay) });
    const likeSentence = explained ? t("cmp.likeForLike", { a: rows[0]!.name, b: rows[1]!.name, aKwh: kwhDay(like[0]!), bKwh: kwhDay(like[1]!), high: high.name, low: low.name, part: extra!.label, kwh: kwhDay(perDayOf(extra!.kwh)) }) : "";
    if (parts.length) {
      const gaps = parts.map(part => { const [a = 0, b = 0] = part.perDay; const hi = Math.max(a, b), lo = Math.min(a, b); return { part, gap: lo > 0 ? hi / lo - 1 : 0, hiName: a >= b ? rows[0]!.name : rows[1]!.name, loName: a >= b ? rows[1]!.name : rows[0]!.name, kwh: hi - lo }; })
        .filter(item => item.kwh >= 0.05).sort((a, b) => b.gap - a.gap);
      const widest = gaps[0];
      partSentence = sentences([likeSentence, widest && widest.gap >= REVIEW_CLOSE_SHARE ? t("cmp.parts", { part: widest.part.name, a: widest.hiName, b: widest.loName, pct: pctText(widest.gap) }) : t("cmp.partsClose", { pct: pctText(REVIEW_CLOSE_SHARE) })], helpers.locale);
    }
  } else {
    const high = sorted[0]!, low = sorted.at(-1)!;
    finding = t("find.spread", { count: rows.length, high: high.name, low: low.name, highKwh: kwhDay(high.perDay), lowKwh: kwhDay(low.perDay) });
  }
  return {
    heading: rows.length === 2 ? t("sec.comparisonTwo", { a: rows[0]!.name, b: rows[1]!.name }) : t("sec.comparisonMany"),
    intro: sentences([finding, partSentence], helpers.locale),
    finding, groups: rows, parts, caption: parts.length ? t("cmp.caption") : t("cmp.captionTotals"),
  };
}

/**
 * The average day hour by hour, from complete hours of complete days: every day for lights-on hours, weekdays for
 * opening hours (all days when there are no complete weekdays). Null with no complete day at all.
 */
function averageDay(input: { project: ScopeData; days: AnalysisDay[]; lighting: boolean; openRange: { from: number; to: number }; t: T; locale: EnergyIqLocale }) {
  const { project, lighting, openRange, t, locale } = input;
  const total = project.total;
  const complete = input.days.filter(day => day.complete);
  const weekdays = complete.filter(day => day.dayType === "weekday");
  const chosen = lighting || !weekdays.length ? complete : weekdays;
  if (!total || !chosen.length) return null;
  const set = new Set(chosen.map(day => day.date));
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  for (const cell of total.cells) if (set.has(cell[0]) && cell[2] != null && cell[3] >= total.expectedMinutesPerHour && cell[4] === 0) byHour[cell[1]]!.push(cell[2]);
  const hours = byHour.map(values => mean(values) ?? 0);
  const sum = hours.reduce((acc, value) => acc + value, 0);
  const inside = hours.reduce((acc, value, hour) => inWindow(openRange, hour) ? acc + value : acc, 0);
  const share = inside / Math.max(sum, 0.001);
  const range = hourRange(openRange.from, openRange.to, locale);
  const nightKw = mean(hours.filter((_, hour) => inWindow(openRange, hour))) ?? 0;
  const dayKw = mean(hours.filter((_, hour) => !inWindow(openRange, hour))) ?? 0;
  let intro: string;
  if (lighting) {
    const lowKw = Math.min(...hours), highKw = Math.max(...hours);
    const on = (hour: number) => highKw - lowKw > 0.001 && hours[hour]! - lowKw >= 0.5 * (highKw - lowKw);
    const order = Array.from({ length: 24 }, (_, index) => (12 + index) % 24);
    const onAt = order.find(hour => on(hour));
    const offAt = onAt === undefined ? undefined : order.slice(order.indexOf(onAt)).find(hour => !on(hour));
    intro = sentences([
      onAt !== undefined && offAt !== undefined ? t("pro.on", { on: clock(onAt, locale), off: clock(offAt, locale) }) : "",
      t("pro.levels", { night: kwText(nightKw), day: kwText(dayKw) }),
      t("pro.share", { pct: pctText(share), range }),
    ], locale);
  } else {
    const peak = hours.reduce((best, value, hour) => value > hours[best]! ? hour : best, 0);
    const lowest = hours.reduce((best, value, hour) => value < hours[best]! ? hour : best, 0);
    intro = sentences([
      t("pro.peak", { kw: kwText(hours[peak]!), time: clock(peak, locale), low: kwText(hours[lowest]!), lowTime: clock(lowest, locale) }),
      t("pro.share", { pct: pctText(share), range }),
    ], locale);
  }
  return {
    hours, intro, days: chosen.length, switchedKw: Math.max(0, nightKw - dayKw),
    caption: t(lighting ? "pro.caption" : chosen === weekdays ? "pro.caption" : "pro.captionAll", { count: chosen.length }),
  };
}

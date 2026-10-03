"use client";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { configApi, type EnergyMeterCategoryDto, type EnergyOperatingCalendarEntryDto, type EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import { MEASUREMENT_LABELS, measurementLabel } from "./site-structure-editing";
import { chartRange, DailyProfileChart, DailyUsageChart, UsageHeatmap, niceMax } from "./device-charts";
import { deviceStatistics, hourlyByDay, isOpenDay, openingHoursLabel, operatingMinutes, periodDates, type DeviceStatistics, type HourCell } from "./device-statistics";
import { dayContext, dayKindBadge, describeDay, schoolPhases, schoolPhaseLabel, specialDays, type DayContext, type DayKind } from "./day-context";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, translatorFor, type EnergyIqLocale, type Translate } from "./energyiq-messages";
import { formatPeriod as formatDateRange } from "./report-period";
import { describeProblem, type ReportProblem } from "./site-report";
import { MeterHealthNotice, PendingDayNote } from "./meter-health-notice";
import { siteReportMessages } from "./site-report-messages";
import Link from "next/link";
import { chartMessages, deviceMessages } from "./site-devices-messages";
import styles from "./site-devices.module.css";

type DeviceKey = keyof (typeof deviceMessages)["en"];

export type DeviceStatus = "reporting" | "gaps" | "stopped" | "silent";
export type DeviceRow = {
  id: string;
  name: string;
  circuit?: string;
  boardId: string;
  category: string;
  type: string;
  isBoardTotal: boolean;
  usageKwh: number | null;
  peakKw: number | null;
  coveragePct: number | null;
  status: DeviceStatus;
  /** When this meter last sent a reading, if it has since stopped. */
  stoppedAt?: string;
};
export type DeviceSummary = {
  rows: DeviceRow[];
  reporting: number;
  gaps: number;
  stopped: number;
  silent: number;
  calculatedCount: number;
  siteUsageKwh: number;
  from: string;
  toExclusive: string;
  timezone: string;
};

/** Readings at or above this share of expected intervals count as fully reporting. */
const COMPLETE_COVERAGE_PCT = 95;

/** Joins the published meter list with per-meter usage; calculated meters are counted, not listed. */
export function summariseDevices(analysis: EnergyScopeAnalysisDto): DeviceSummary {
  const usage = new Map(analysis.circuits.map(circuit => [circuit.meterNodeId, circuit]));
  const meters = analysis.explorerMeters ?? [];
  // A meter that stopped sending still looks healthy inside the analysis window,
  // because the window ends on the last day every meter covered. Only the
  // reporting health, read past that window, can tell us it went quiet.
  const stoppedAt = new Map((analysis.reportingHealth?.stoppedMeters ?? [])
    .map(meter => [meter.meterNodeId, meter.lastReadingAt]));
  const rows = meters.filter(meter => meter.kind === "physical").map((meter): DeviceRow => {
    const reading = usage.get(meter.id);
    const coveragePct = reading?.dataHealth?.coveragePct ?? null;
    const lastReadingAt = stoppedAt.get(meter.id);
    const status: DeviceStatus = !reading || !reading.dataHealth?.validIntervalCount
      ? "silent"
      : lastReadingAt
        ? "stopped"
        : (coveragePct ?? 0) >= COMPLETE_COVERAGE_PCT ? "reporting" : "gaps";
    return {
      ...(lastReadingAt ? { stoppedAt: lastReadingAt } : {}),
      id: meter.id,
      name: meter.name,
      ...(meter.circuitName && meter.circuitName !== meter.name ? { circuit: meter.circuitName } : {}),
      boardId: meter.scopeId,
      category: meter.category,
      type: MEASUREMENT_LABELS[meter.category as EnergyMeterCategoryDto] ?? "Other",
      isBoardTotal: meter.role === "total",
      usageKwh: reading ? reading.usageKwh : null,
      peakKw: reading ? reading.peakKw : null,
      coveragePct,
      status,
    };
  });
  const count = (status: DeviceStatus) => rows.filter(row => row.status === status).length;
  return {
    rows,
    reporting: count("reporting"),
    gaps: count("gaps"),
    stopped: count("stopped"),
    silent: count("silent"),
    calculatedCount: meters.length - rows.length,
    siteUsageKwh: analysis.summary.usageKwh,
    from: analysis.context.from,
    toExclusive: analysis.context.to,
    timezone: analysis.context.timezone,
  };
}

/** Average price per kWh actually charged in the window, and the GST still to add when prices exclude it. */
export function tariffRate(analysis: Pick<EnergyScopeAnalysisDto, "cost">): { rate: number; gstPct: number | null } | null {
  if (analysis.cost.status !== "available") return null;
  const usage = analysis.cost.allocations.reduce((sum, allocation) => sum + allocation.usageKwh, 0);
  const first = analysis.cost.allocations[0];
  const rate = usage > 0 ? analysis.cost.amount / usage : first?.ratePerKwh;
  if (!rate) return null;
  return { rate, gstPct: first?.rateBasis === "tax_exclusive" ? first.tax?.ratePct ?? null : null };
}

export type EnergyShare = { id: string; name: string; kwh: number; unmetered: boolean; boardId: string; type: string };
/**
 * Splits site energy into pieces that do not overlap: individual devices, plus the part of each
 * board total that no individual meter explains. The pieces add up to the board totals.
 *
 * A total for one kind of use (lighting, sockets) covers the devices of that kind on its own board. An
 * "overall" total, such as an incoming supply, covers every device on its board and on every location
 * beneath it (`boardParents` maps a location to the one above it), so it is never listed as a device.
 */
export function energyBreakdown(rows: DeviceRow[], boardNames: Map<string, string>, locale: EnergyIqLocale = "en", boardParents: Map<string, string> = new Map()): EnergyShare[] {
  const t = translatorFor(deviceMessages, locale);
  const shares: EnergyShare[] = [];
  const within = (boardId: string, ancestorId: string) => {
    const seen = new Set<string>();
    for (let current: string | undefined = boardId; current && !seen.has(current); current = boardParents.get(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
    }
    return false;
  };
  // The site's main meter: the one whole-site total on a board with nothing above it. Every other meter on site sits
  // below it, wherever the layout puts them (under it, or as its neighbours), so all of them are its parts.
  const topTotals = rows.filter(row => row.isBoardTotal && row.category === "overall" && row.usageKwh !== null && !boardParents.has(row.boardId));
  const siteMain = topTotals.length === 1 ? topTotals[0]! : null;
  for (const boardId of new Set(rows.map(row => row.boardId))) {
    const measured = rows.filter(row => row.boardId === boardId && row.usageKwh !== null);
    const devices = measured.filter(row => !row.isBoardTotal);
    for (const total of measured.filter(row => row.isBoardTotal)) {
      const parts = total === siteMain
        ? rows.filter(row => !row.isBoardTotal && row.usageKwh !== null)
        : total.category === "overall"
        ? rows.filter(row => !row.isBoardTotal && row.usageKwh !== null && within(row.boardId, boardId))
        : devices.filter(device => device.category === total.category);
      if (!parts.length) { shares.push({ id: total.id, name: total.name, kwh: total.usageKwh!, unmetered: false, boardId, type: total.type }); continue; }
      const rest = total.usageKwh! - parts.reduce((sum, part) => sum + part.usageKwh!, 0);
      const boardName = boardNames.get(boardId) ?? boardId;
      if (rest > 0.05) shares.push({ id: `${total.id}:rest`, name: total === siteMain ? t("unmetered.site") : total.category === "overall" ? t("unmetered.overall", { board: boardName }) : t("unmetered.name", { board: boardName, type: measurementLabel(total.category, locale).toLowerCase() }), kwh: rest, unmetered: true, boardId, type: total.type });
    }
    devices.forEach(device => shares.push({ id: device.id, name: device.name, kwh: device.usageKwh!, unmetered: false, boardId, type: device.type }));
  }
  return shares.sort((a, b) => b.kwh - a.kwh);
}

export type Finding = { icon: "bolt" | "alert" | "meter" | "info"; title: string; detail: string };
/**
 * When a meter last sent, in the site's own clock: "23 Sept, 4:45 pm". The hour
 * is the part a reader acts on, because it says what else was happening on site
 * when the circuit went quiet.
 */
export const lastSentText = (iso: string, timezone: string, locale: EnergyIqLocale = "en") =>
  new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
/** Findings that ask the reader to do something are drawn to be noticed; the rest simply report. */
const needsAttention = (finding: Finding) => finding.icon === "alert" || finding.icon === "info";
/** Deterministic, plain-language highlights. Savings are framed as questions to check, never as proven waste. */
export function siteFindings({ rows, stats, shares, siteKwh, rate, openingHours, board = null, locale = "en", timezone }: { rows: DeviceRow[]; stats: Map<string, DeviceStatistics>; shares: EnergyShare[]; siteKwh: number; rate: number | null; openingHours: string | null; /** The board's name when the figures cover one board; the whole site otherwise. */ board?: string | null; locale?: EnergyIqLocale; timezone?: string }): Finding[] {
  const t = translatorFor(deviceMessages, locale);
  const { kwh, kw, pct, sgd } = numberFormats(locale);
  const findings: Finding[] = [];
  const money = (kwh: number) => rate ? t("money.about", { amount: sgd(kwh * rate) }) : "";
  const top = shares.find(share => !share.unmetered);
  if (top && siteKwh > 0) findings.push({ icon: "bolt", title: t("finding.biggest.title", { name: top.name }), detail: t(board === null ? "finding.biggest.site" : "finding.biggest.board", { pct: pct(top.kwh / siteKwh * 100), board: board ?? "", kwh: kwh(top.kwh), money: money(top.kwh) }) });
  const devices = rows.filter(row => !row.isBoardTotal && stats.has(row.id));
  const afterHours = devices.map(row => ({ row, stat: stats.get(row.id)! })).filter(item => item.stat.outOfHoursKwh !== null && (item.stat.outOfHoursPct ?? 0) >= 50).sort((a, b) => b.stat.outOfHoursKwh! - a.stat.outOfHoursKwh!)[0];
  if (afterHours) findings.push({ icon: "alert", title: t("finding.afterHours.title", { name: afterHours.row.name }), detail: t("finding.afterHours.detail", { kwh: kwh(afterHours.stat.outOfHoursKwh!), pct: pct(afterHours.stat.outOfHoursPct!), hours: openingHours ?? t("operatingHours"), money: money(afterHours.stat.outOfHoursKwh!) }) });
  const alwaysOn = devices.map(row => ({ row, kw: stats.get(row.id)!.alwaysOnKw ?? 0 })).filter(item => item.kw >= 0.05 && item.row.id !== afterHours?.row.id).sort((a, b) => b.kw - a.kw)[0];
  if (alwaysOn) findings.push({ icon: "bolt", title: t("finding.alwaysOn.title", { name: alwaysOn.row.name }), detail: rate ? t("finding.alwaysOn.siteCost", { kw: kw(alwaysOn.kw), amount: sgd(alwaysOn.kw * 24 * 365 * rate) }) : t("finding.alwaysOn.site", { kw: kw(alwaysOn.kw) }) });
  const unmetered = shares.filter(share => share.unmetered && siteKwh > 0 && share.kwh / siteKwh >= 0.2).sort((a, b) => b.kwh - a.kwh)[0];
  if (unmetered) findings.push({ icon: "meter", title: t("finding.unmetered.title"), detail: t("finding.unmetered.detail", { name: unmetered.name, kwh: kwh(unmetered.kwh), pct: pct(unmetered.kwh / siteKwh * 100) }) });
  const silent = rows.filter(row => row.status === "silent");
  // A meter that was healthy and went quiet is a site problem, not thin data:
  // something was switched off, tripped, or fell off the network.
  const stopped = rows.filter(row => row.status === "stopped" && row.stoppedAt);
  if (stopped.length && timezone) {
    const earliest = [...stopped].sort((left, right) => left.stoppedAt!.localeCompare(right.stoppedAt!))[0]!;
    findings.push({
      icon: "alert",
      title: t(stopped.length === 1 ? "finding.stopped.titleOne" : "finding.stopped.titleMany", { count: String(stopped.length), total: String(rows.length) }),
      detail: t("finding.stopped.detail", { when: lastSentText(earliest.stoppedAt!, timezone, locale), devices: stopped.map(row => row.name).join(t("list.separator")) }),
    });
  }
  if (silent.length) findings.push({ icon: "info", title: t(silent.length === 1 ? "finding.silent.titleOne" : "finding.silent.titleMany", { count: silent.length }), detail: t("finding.silent.detail", { devices: silent.map(row => row.circuit ? t("device.withCircuit", { name: row.name, circuit: row.circuit }) : row.name).join(t("list.separator")) }) });
  return findings;
}

/** Figures in the reader's number format; the units (kWh, kW, %, SGD) read the same in every language. */
function numberFormats(locale: EnergyIqLocale) {
  const tag = intlLocale(locale);
  return {
    kwh: (value: number) => `${value.toLocaleString(tag, { maximumFractionDigits: value >= 100 ? 0 : 1 })} kWh`,
    kw: (value: number) => `${value.toLocaleString(tag, { maximumFractionDigits: 2 })} kW`,
    pct: (value: number) => `${value.toLocaleString(tag, { maximumFractionDigits: value >= 10 ? 0 : 1 })}%`,
    sgd: (value: number) => `SGD ${value.toLocaleString(tag, { minimumFractionDigits: value < 100 ? 2 : 0, maximumFractionDigits: value < 100 ? 2 : 0 })}`,
  };
}
export function formatPeriod(from: string, toExclusive: string, timeZone: string, locale: EnergyIqLocale = "en"): string {
  const lastDay = new Date(Date.parse(toExclusive) - 1);
  if (locale !== "en") {
    // Chinese reads year first and Malay has its own month names; the shared period wording handles both.
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    return formatDateRange(localDate.format(new Date(from)), localDate.format(lastDay), locale);
  }
  const day = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone });
  const full = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone });
  return `${day.format(new Date(from))} – ${full.format(lastDay)}`;
}
const statusText = (status: DeviceStatus, t: Translate<DeviceKey>) => t(`status.${status}`);
/** The day kinds marked with a badge on the daily charts, in the order the method note lists them. */
const SPECIAL_DAY_KINDS: DayKind[] = ["public_holiday", "special_closure", "special_operating_day"];
/** A board total covers only its own measurement type, e.g. the lighting total excludes power circuits. */
export const boardTotalNote = (type: string, locale: EnergyIqLocale = "en") => translatorFor(deviceMessages, locale)(type === "Lighting" ? "boardTotal.lighting" : type === "Power" ? "boardTotal.power" : "boardTotal.other");

/** Plain-language highlights for one device. Framed as things to check, never as proven waste. */
export function deviceFindings({ row, stat, rate, openingHours, locale = "en", timezone }: { row: DeviceRow; stat: DeviceStatistics; rate: number | null; openingHours: string | null; locale?: EnergyIqLocale; timezone?: string }): Finding[] {
  const t = translatorFor(deviceMessages, locale);
  const { kwh, kw, pct, sgd } = numberFormats(locale);
  const findings: Finding[] = [];
  const money = (kwh: number) => rate ? t("money.about", { amount: sgd(kwh * rate) }) : "";
  if (row.isBoardTotal) findings.push({ icon: "info", title: t("finding.boardTotal.title"), detail: t("finding.boardTotal.detail", { note: boardTotalNote(row.type, locale) }) });
  if (stat.outOfHoursKwh !== null && (stat.outOfHoursPct ?? 0) >= 50) findings.push({ icon: "alert", title: t("finding.deviceAfterHours.title"), detail: t("finding.afterHours.detail", { kwh: kwh(stat.outOfHoursKwh), pct: pct(stat.outOfHoursPct!), hours: openingHours ?? t("operatingHours"), money: money(stat.outOfHoursKwh) }) });
  if (stat.alwaysOnKw !== null && stat.alwaysOnKw >= 0.05 && stat.dailyAverageKwh && stat.alwaysOnKw * 24 >= stat.dailyAverageKwh * 0.6) findings.push({ icon: "bolt", title: t("finding.deviceAlwaysOn.title"), detail: rate ? t("finding.deviceAlwaysOn.detailCost", { kw: kw(stat.alwaysOnKw), kwh: kwh(stat.alwaysOnKw * 24), amount: sgd(stat.alwaysOnKw * 24 * 365 * rate) }) : t("finding.deviceAlwaysOn.detail", { kw: kw(stat.alwaysOnKw), kwh: kwh(stat.alwaysOnKw * 24) }) });
  if (stat.openDays > 0 && stat.closedDays > 0 && stat.openDayAverageKwh && stat.closedDayAverageKwh !== null && stat.closedDayAverageKwh / stat.openDayAverageKwh >= 0.7) findings.push({ icon: "alert", title: t("finding.closedBusy.title"), detail: t("finding.closedBusy.detail", { closed: kwh(stat.closedDayAverageKwh), pct: pct(stat.closedDayAverageKwh / stat.openDayAverageKwh * 100), open: kwh(stat.openDayAverageKwh) }) });
  if (row.stoppedAt && timezone) findings.push({ icon: "alert", title: t("finding.deviceStopped.title"), detail: t("finding.deviceStopped.detail", { when: lastSentText(row.stoppedAt, timezone, locale) }) });
  if (stat.receivedPct < COMPLETE_COVERAGE_PCT) findings.push({ icon: "info", title: t("finding.missing.title"), detail: t("finding.missing.detail", { pct: pct(stat.receivedPct) }) });
  if (!findings.length) findings.push({ icon: "meter", title: t("finding.none.title"), detail: t("finding.none.detail") });
  return findings;
}

export type DevicesView = { kind: "site" } | { kind: "board"; id: string } | { kind: "device"; id: string };
/** Reads `?view=board:<id>` or `?view=device:<id>`; anything unknown falls back to the whole site. */
export function parseDevicesView(value: string | null, rows: DeviceRow[]): DevicesView {
  if (value?.startsWith("board:") && rows.some(row => row.boardId === value.slice(6))) return { kind: "board", id: value.slice(6) };
  if (value?.startsWith("device:") && rows.some(row => row.id === value.slice(7))) return { kind: "device", id: value.slice(7) };
  return { kind: "site" };
}

type TypeTotal = { type: string; category: string; kwh: number };
type ScopeData = { analysis: EnergyScopeAnalysisDto; stat: DeviceStatistics | null; typeTotals: TypeTotal[] };
type Loaded = { summary: DeviceSummary; site: ScopeData; boards: Map<string, ScopeData>; stats: Map<string, DeviceStatistics>; cells: Map<string, HourCell[]>; dates: string[]; days: DayContext[]; openHours: Set<number>; calendar: EnergyOperatingCalendarEntryDto[] | null; shortDays: Array<{ localDate: string; usageKwh: number }>; partial: boolean };
const request = (projectId: string, scopeId: string) => ({ projectId, scopeId, resource: "electricity" as const, period: "Custom" as const, analysisWindow: "current-overview-28d" as const, surface: "project-explorer" as const });

function scopeData(analysis: EnergyScopeAnalysisDto, dates: string[], calendar: EnergyOperatingCalendarEntryDto[] | null): ScopeData {
  const scope = analysis.explorerTrends?.find(trend => trend.id === "__scope__");
  const typeTotals = (analysis.explorerTrends ?? []).filter(trend => trend.id.startsWith("__category__:")).map(trend => ({ type: MEASUREMENT_LABELS[trend.id.slice(13) as EnergyMeterCategoryDto] ?? "Other", category: trend.id.slice(13), kwh: trend.cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0) })).sort((a, b) => b.kwh - a.kwh);
  return { analysis, stat: scope ? deviceStatistics(scope.cells as HourCell[], dates, calendar, scope.expectedMinutesPerHour) : null, typeTotals };
}

/**
 * Adds the days that arrived after the analysis window to a daily series, marked
 * incomplete. Only the site series gets them: the project total for such a day
 * is known, a per-device split of it is not, and a device's own "stopped
 * sending" finding already says why its bars end where they do.
 *
 * Marked rather than merged, because every average on this page already skips
 * days that are not complete — so the day shows up without moving a figure.
 */
export function withShortDays(
  daily: DeviceStatistics["daily"],
  shortDays: ReadonlyArray<{ localDate: string; usageKwh: number }>,
  calendar: EnergyOperatingCalendarEntryDto[] | null,
): DeviceStatistics["daily"] {
  const known = new Set(daily.map(day => day.date));
  const extra = shortDays
    .filter(day => !known.has(day.localDate))
    .map(day => ({
      date: day.localDate,
      kwh: day.usageKwh,
      open: calendar ? isOpenDay(calendar, day.localDate) : true,
      complete: false,
    }));
  return extra.length ? [...daily, ...extra] : daily;
}

/**
 * Results kept briefly so returning to the tab shows the last figures at once while they refresh.
 * Keyed by project; a refresh always replaces the entry.
 */
const DEVICES_CACHE_MS = 5 * 60_000;
const devicesCache = new Map<string, { at: number; value: Loaded }>();
const cachedDevices = (projectId: string): Loaded | null => {
  const entry = devicesCache.get(projectId);
  return entry && Date.now() - entry.at < DEVICES_CACHE_MS ? entry.value : null;
};

async function loadDevices(projectId: string, likelyBoardIds: string[] = []): Promise<Loaded> {
  // Start the per-location analyses alongside the site one rather than after it; the site result only
  // confirms which locations hold meters. Unused requests are ignored. Large sites skip the head start
  // so a portfolio with hundreds of locations does not flood the server.
  const boardRequests = new Map((likelyBoardIds.length <= 40 ? likelyBoardIds : []).map(boardId => {
    const pending = configApi.executeEnergyScopeAnalysis(request(projectId, boardId));
    pending.catch(() => undefined);
    return [boardId, pending] as const;
  }));
  const [analysis, policies] = await Promise.all([configApi.executeEnergyScopeAnalysis(request(projectId, "project")), configApi.getEnergyOperationalPolicies(projectId).catch(() => null)]);
  const summary = summariseDevices(analysis);
  // Use the calendar the server used for the site's out-of-hours total, so per-device figures agree with it.
  const version = analysis.offHours.status === "available" ? analysis.offHours.businessCalendarVersion : policies?.published.business_calendar_version;
  const revision = policies?.operatingCalendarRevisions.find(item => item.version_id === version) ?? null;
  const calendar: EnergyOperatingCalendarEntryDto[] | null = revision?.entries ?? null;
  const dates = periodDates(analysis.context.from, analysis.context.to, analysis.context.timezone);
  // Days that arrived after the analysis window closed, because a meter stopped
  // partway through one. Kept apart from `dates`: the statistics stay on whole
  // days, and these are drawn only so the reader can see the day exists.
  const lastWindowDate = dates.at(-1);
  const shortDays = (analysis.reportingHealth?.shortDays ?? [])
    .filter(day => !lastWindowDate || day.localDate > lastWindowDate)
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const ids = new Set(summary.rows.map(row => row.id));
  const stats = new Map<string, DeviceStatistics>();
  const cells = new Map<string, HourCell[]>();
  const boardIds = [...new Set(summary.rows.map(row => row.boardId))];
  const results = await Promise.allSettled(boardIds.map(boardId => boardRequests.get(boardId) ?? configApi.executeEnergyScopeAnalysis(request(projectId, boardId))));
  const boards = new Map<string, ScopeData>();
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    boards.set(boardIds[index]!, scopeData(result.value, dates, calendar));
    for (const trend of result.value.explorerTrends ?? []) if (ids.has(trend.id)) { cells.set(trend.id, trend.cells as HourCell[]); stats.set(trend.id, deviceStatistics(trend.cells as HourCell[], dates, calendar)); }
  });
  const openDay = calendar ? dates.find(date => isOpenDay(calendar, date)) : undefined;
  const openHours = new Set(openDay && calendar ? Array.from({ length: 24 }, (_, hour) => hour).filter(hour => operatingMinutes(calendar, openDay, hour) > 0) : []);
  const site = scopeData(analysis, dates, calendar);
  if (site.stat) site.stat = { ...site.stat, daily: withShortDays(site.stat.daily, shortDays, calendar) };
  const chartDates = [...dates, ...shortDays.map(day => day.localDate)];
  return { summary, site, boards, stats, cells, dates, days: chartDates.map(date => dayContext(revision, date)), openHours, calendar, shortDays, partial: results.some(result => result.status === "rejected") };
}

/** Searchable list of every device, grouped by board, for opening one device on its own. */
function DevicePicker({ rows, boardName, value, onPick }: { rows: DeviceRow[]; boardName: (id: string) => string; value: string | null; onPick: (id: string) => void }) {
  const t = useMessages(deviceMessages);
  const { locale } = useEnergyIqLocale();
  const { kwh } = numberFormats(locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const words = query.trim().toLowerCase();
  // The English type is kept alongside the reader's language, so either finds a device.
  const matches = rows.filter(row => !words || `${row.name} ${row.circuit ?? ""} ${row.type} ${measurementLabel(row.category, locale)} ${boardName(row.boardId)}`.toLowerCase().includes(words));
  const pick = (id: string) => { onPick(id); setOpen(false); setQuery(""); };
  const selected = rows.find(row => row.id === value);
  return <div ref={root} className={styles.picker}>
    <button type="button" className={styles.secondary} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(current => !current)}><EnergyIcon name="meter" />{selected ? selected.name : t("picker.open")}<EnergyIcon name="chevron" className={styles.pickerChevron} /></button>
    {open && <div id={panelId} role="dialog" aria-label={t("picker.open")} className={styles.pickerPanel}>
      <input type="search" autoFocus className={styles.pickerSearch} placeholder={t("picker.search")} aria-label={t("picker.search")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && matches[0]) pick(matches[0].id); }} />
      {matches.length === 0 ? <p className={styles.muted}>{t("picker.noMatch", { query })}</p> : [...new Set(matches.map(row => row.boardId))].map(boardId => <div key={boardId}>
        <p className={styles.pickerGroup}>{boardName(boardId)}</p>
        {matches.filter(row => row.boardId === boardId).map(row => <button key={row.id} type="button" className={styles.pickerItem} aria-current={row.id === value ? "true" : undefined} onClick={() => pick(row.id)}>
          <span className={`${styles.dot} ${styles[row.status]}`} aria-label={statusText(row.status, t)} />
          <span><strong>{row.name}</strong><small>{[measurementLabel(row.category, locale), row.isBoardTotal ? t("boardTotalShort") : "", row.circuit ? t("circuit", { circuit: row.circuit }) : ""].filter(Boolean).join(" · ")}</small></span>
          <span>{row.usageKwh === null ? "—" : kwh(row.usageKwh)}</span>
        </button>)}
      </div>)}
    </div>}
  </div>;
}

export function SiteDevices({ projectId, boardNames, boardParents }: { projectId: string; boardNames: Map<string, string>; boardParents?: Map<string, string> }) {
  const t = useMessages(deviceMessages);
  const tChart = useMessages(chartMessages);
  const { locale } = useEnergyIqLocale();
  const { kwh, kw, pct, sgd } = numberFormats(locale);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState<Loaded | null>(() => cachedDevices(projectId));
  // Read when loading starts; the map is rebuilt on every render, so it must not restart the load.
  const likelyBoards = useRef<string[]>([]);
  likelyBoards.current = [...boardNames.keys()];
  const [error, setError] = useState<ReportProblem | null>(null);
  const problemText = translatorFor(siteReportMessages, locale);
  const [refresh, setRefresh] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  // "native" uses the browser's full-screen mode; "window" fills the browser window where that is unavailable.
  const [fullScreen, setFullScreen] = useState<null | "native" | "window">(null);
  useEffect(() => {
    const sync = () => setFullScreen(current => document.fullscreenElement === panelRef.current ? "native" : current === "native" ? null : current);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFullScreen(current => current === "window" ? null : current); };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("fullscreenchange", sync); document.removeEventListener("keydown", escape); };
  }, []);
  const toggleFullScreen = async () => {
    if (fullScreen === "native") { await document.exitFullscreen().catch(() => undefined); return; }
    if (fullScreen === "window") { setFullScreen(null); return; }
    const panel = panelRef.current;
    try {
      if (!panel?.requestFullscreen) throw new Error("unsupported");
      // Some embedded browsers neither grant nor refuse the request; fall back after a short wait.
      await Promise.race([panel.requestFullscreen(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 600))]);
      if (document.fullscreenElement !== panel) throw new Error("not granted");
    } catch { if (document.fullscreenElement !== panel) setFullScreen("window"); }
  };
  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Show the last figures straight away when we have them; fresh ones replace them when ready.
    const cached = cachedDevices(projectId);
    if (cached) setLoaded(cached);
    loadDevices(projectId, likelyBoards.current).then(result => {
      devicesCache.set(projectId, { at: Date.now(), value: result });
      if (!cancelled) setLoaded(result);
    })
      // The readings fail for a reason a person can fix, so say which one and where, not "could not be loaded".
      .catch(reason => describeProblem(reason, projectId, locale).then(problem => { if (!cancelled) setError(problem); }));
    return () => { cancelled = true; };
  }, [projectId, refresh, locale]);

  if (error) return <section className={styles.panel}><div role="alert" className={styles.problem}>
    <h3>{error.title}</h3>
    <ol>{error.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <p>{error.fixTab ? <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: error.fixTab })}`}>{problemText("problem.openFacility")}</Link> : null}<button type="button" className={styles.link} onClick={() => setRefresh(n => n + 1)}>{t("tryAgain")}</button></p>
  </div></section>;
  if (!loaded) return <section className={styles.panel}><p role="status" className={styles.muted}>{t("loading")}</p></section>;
  const { summary, stats } = loaded;
  if (!summary.rows.length) return <section className={styles.panel}><h3>{t("title")}</h3><p className={styles.muted}>{t("empty")}</p></section>;
  const openingHours = openingHoursLabel(loaded.calendar, locale);

  const view = parseDevicesView(searchParams.get("view"), summary.rows);
  const showView = (next: DevicesView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.kind === "site") params.delete("view"); else params.set("view", `${next.kind}:${next.id}`);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
    const panel = panelRef.current;
    if (panel && fullScreen) panel.scrollTo({ top: 0 });
    else if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
  };
  const tariff = tariffRate(loaded.site.analysis);
  const rate = tariff?.rate ?? null;
  const boardIds = [...new Set(summary.rows.map(row => row.boardId))];
  const boardName = (boardId: string) => boardNames.get(boardId) ?? boardId;
  const byBoard = (boardId: string) => summary.rows.filter(row => row.boardId === boardId).sort((a, b) => Number(b.isBoardTotal) - Number(a.isBoardTotal) || (b.usageKwh ?? -1) - (a.usageKwh ?? -1));
  const ordered = boardIds.flatMap(byBoard);
  const money = (value: number | null | undefined) => rate && value != null ? sgd(value * rate) : "—";
  const dayMap = new Map(loaded.days.map(day => [day.date, day]));
  const dateText = (date: string, withWeekday = true) => new Intl.DateTimeFormat(intlLocale(locale), { ...(withWeekday ? { weekday: "short" as const } : {}), day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const period = formatPeriod(summary.from, summary.toExclusive, summary.timezone, locale);
  // "14 Aug – 10 Sep 2026 · 28 days" under every chart title, so each chart says which dates it covers.
  const span = chartRange(loaded.dates, locale, tChart);
  const peakText = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: summary.timezone }).format(new Date(iso)) : null;
  const openDevice = (id: string) => showView({ kind: "device", id });
  const typeName = (row: DeviceRow) => measurementLabel(row.category, locale);

  const facts = (stat: DeviceStatistics, label: string) => <dl className={styles.facts}>
    <div><dt>{t("facts.openDays")}</dt><dd>{stat.openDays}</dd></div>
    <div><dt>{t("facts.openAverage")}</dt><dd>{stat.openDayAverageKwh === null ? "—" : `${kwh(stat.openDayAverageKwh)} · ${money(stat.openDayAverageKwh)}`}</dd></div>
    <div><dt>{t("facts.closedDays")}</dt><dd>{stat.closedDays}</dd></div>
    <div><dt>{t("facts.closedAverage")}</dt><dd>{stat.closedDayAverageKwh === null ? "—" : `${kwh(stat.closedDayAverageKwh)} · ${money(stat.closedDayAverageKwh)}`}</dd></div>
    <div><dt>{t("facts.ratio")}</dt><dd>{stat.openDayAverageKwh && stat.closedDayAverageKwh !== null ? pct(stat.closedDayAverageKwh / stat.openDayAverageKwh * 100) : "—"}</dd></div>
    <div><dt>{t("facts.alwaysOn", { label })}</dt><dd>{stat.alwaysOnKw === null ? "—" : `${kw(stat.alwaysOnKw)}${rate ? ` · ${t("perYear", { amount: sgd(stat.alwaysOnKw * 24 * 365 * rate) })}` : ""}`}</dd></div>
    <div><dt>{t("facts.readings")}</dt><dd>{pct(stat.receivedPct)}</dd></div>
  </dl>;

  const specialDaysSection = (stat: DeviceStatistics) => {
    const normalAverage = (kinds: string[]) => { const values = stat.daily.filter(day => day.complete && day.kwh !== null && kinds.includes(dayMap.get(day.date)?.kind ?? "")).map(day => day.kwh!); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; };
    const specials = specialDays(loaded.days, new Map(stat.daily.map(day => [day.date, day.complete ? day.kwh : null])), { openDayKwh: normalAverage(["open"]), closedDayKwh: normalAverage(["weekend", "closed"]) }, locale);
    const phases = schoolPhases(loaded.days).map(phase => { const values = stat.daily.filter(day => day.complete && day.kwh !== null && phase.dates.includes(day.date)).map(day => day.kwh!); return { ...phase, averageKwh: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }; });
    return <div className={styles.specialDays}>
      <h5>{t("special.title")}</h5>
      {specials.length === 0 ? <p className={styles.muted}>{t("special.none", { period })}</p> : <>
        <p className={styles.muted}>{t("special.intro")}</p>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th scope="col">{t("special.date")}</th><th scope="col">{t("special.what")}</th><th scope="col" className={styles.number}>{t("special.energy")}</th><th scope="col" className={styles.number}>{t("special.vsOpen")}</th><th scope="col">{t("special.meaning")}</th></tr></thead>
          <tbody>{specials.map(day => <tr key={day.date}><td>{dateText(day.date)}</td><td><strong>{day.name ?? describeDay(day, true, locale)}</strong><small>{describeDay(day, false, locale)}</small></td><td className={styles.number}>{day.kwh === null ? "—" : `${kwh(day.kwh)}${rate ? ` · ${sgd(day.kwh * rate)}` : ""}`}</td><td className={styles.number}>{day.sharePct === null ? "—" : pct(day.sharePct)}</td><td>{day.verdict}</td></tr>)}</tbody>
        </table></div>
      </>}
      {phases.length > 0 && <p className={styles.schoolPhases}><strong>{t("school.title")}</strong> {t("school.list", { phases: phases.map(phase => { const values = { label: phase.label ?? schoolPhaseLabel(phase.phase, locale), from: dateText(phase.from, false), to: dateText(phase.to, false) }; return phase.averageKwh !== null ? t("school.phaseAverage", { ...values, kwh: kwh(phase.averageKwh) }) : t("school.phase", values); }).join(t("school.separator")) })}</p>}
    </div>;
  };

  /** The whole site, or one distribution board: the same page, limited to that board's devices. */
  const scopeView = (data: ScopeData, rows: DeviceRow[], boardId: string | null) => {
    const { analysis } = data;
    const isSite = boardId === null;
    const label = isSite ? t("label.wholeSite") : boardName(boardId);
    const scopeName = isSite ? t("scope.site") : label;
    const scopeKwh = analysis.summary.usageKwh;
    const shares = energyBreakdown(rows, boardNames, locale, boardParents);
    const findings = siteFindings({ rows, stats, shares, siteKwh: scopeKwh, rate, openingHours, board: isSite ? null : boardName(boardId), locale, timezone: summary.timezone });
    const dailyAverage = analysis.summary.averageDailyUsageKwh;
    const offHours = analysis.offHours.status === "available" ? analysis.offHours : null;
    const peakAt = peakText(analysis.summary.peakAt);
    const largest = shares[0]?.kwh ?? 1;
    const boards = isSite ? boardIds : [boardId];
    // What no sub-meter explains is its own line, not part of the board the main meter happens to sit on.
    const unmeteredKwh = shares.filter(share => share.unmetered).reduce((sum, share) => sum + share.kwh, 0);
    const boardTotals: Array<{ id?: string; label: string; kwh: number }> = boards
      .map(id => ({ id, label: boardName(id), kwh: shares.filter(share => share.boardId === id && !share.unmetered).reduce((sum, share) => sum + share.kwh, 0) }))
      .filter(item => item.kwh > 0);
    if (unmeteredKwh > 0) boardTotals.push({ label: t("unmetered.site"), kwh: unmeteredKwh });
    boardTotals.sort((a, b) => b.kwh - a.kwh);
    // Where the scope's total is a main meter, its "type" is only "Total"; the types come from the meters below it instead.
    const typeTotals = data.typeTotals.some(item => item.category === "overall")
      ? [...shares.reduce((sum, share) => {
        const category = rows.find(row => row.id === (share.unmetered ? share.id.replace(/:rest$/, "") : share.id))?.category ?? "other";
        const key = category === "overall" ? t("unmetered.site") : measurementLabel(category, locale);
        return sum.set(key, (sum.get(key) ?? 0) + share.kwh);
      }, new Map<string, number>())].map(([typeLabel, typeKwh]) => ({ label: typeLabel, kwh: typeKwh })).sort((a, b) => b.kwh - a.kwh)
      : data.typeTotals.map(item => ({ label: measurementLabel(item.category, locale), kwh: item.kwh }));
    const stat = data.stat;
    const profileMax = stat ? niceMax(Math.max(0, ...stat.openProfileKw.map(value => value ?? 0), ...stat.closedProfileKw.map(value => value ?? 0))) : 1;
    const heatRows = boards.flatMap(id => byBoard(id).filter(row => stats.has(row.id)).map(row => ({ id: row.id, name: row.name, group: boardName(id), profileKw: stats.get(row.id)!.profileKw })));
    const shareBars = (items: Array<{ id?: string; label: string; kwh: number }>, title: string, onOpen?: (id: string) => void) => <figure className={styles.chart}><figcaption>{title}</figcaption><ol className={styles.miniBars}>{items.map(item => <li key={item.label} aria-label={t("share.aria", { name: item.label, kwh: kwh(item.kwh), pct: pct(item.kwh / scopeKwh * 100), scope: label })}><span className={styles.rankName}>{onOpen && item.id ? <button type="button" className={styles.nameLink} onClick={() => onOpen(item.id!)}>{item.label}</button> : item.label}</span><span className={styles.bar}><span style={{ width: `${Math.max(1, item.kwh / Math.max(...items.map(other => other.kwh)) * 100)}%` }} /></span><span className={styles.number}>{kwh(item.kwh)}</span><span className={styles.number}>{pct(item.kwh / scopeKwh * 100)}</span></li>)}</ol></figure>;
    const columns = rate ? 13 : 12;
    const stoppedRows = rows.filter(row => row.status === "stopped" && row.stoppedAt)
      .sort((left, right) => left.stoppedAt!.localeCompare(right.stoppedAt!));
    const reporting = rows.filter(row => row.status !== "silent").length;
    const silent = rows.length - reporting;
    return <>
      <div className={styles.glance}>
        <div className={styles.tile}><span>{t("tile.energy")}</span><strong>{kwh(scopeKwh)}</strong><small>{t("tile.dailyAverage", { kwh: kwh(dailyAverage) })}</small></div>
        {tariff && analysis.cost.status === "available" && <div className={styles.tile}><span>{t("tile.cost")}</span><strong>{sgd(analysis.cost.amount)}</strong><small>{tariff.gstPct !== null ? t("tile.beforeGst", { amount: sgd(analysis.cost.amount * (1 + tariff.gstPct / 100)), gst: tariff.gstPct }) : t("tile.savedTariff")}</small></div>}
        {rate && <div className={styles.tile}><span>{t("tile.yearly")}</span><strong>≈ {sgd(dailyAverage * 365 * rate)}</strong><small>{t("tile.yearlyNote")}</small></div>}
        {offHours && <div className={styles.tile}><span>{t("tile.afterHours")}</span><strong>{pct(offHours.sharePct)}</strong><small>{kwh(offHours.usageKwh)}{rate ? ` · ${sgd(offHours.usageKwh * rate)}` : ""}</small></div>}
        <div className={styles.tile}><span>{t("tile.peak")}</span><strong>{kw(analysis.summary.peakKw)}</strong><small>{peakAt ?? t("tile.peakNote")}</small></div>
        <div className={styles.tile}><span>{t("tile.reporting")}</span><strong>{t("tile.reportingCount", { reporting, total: rows.length })}</strong><small>{silent ? t("tile.silent", { count: silent }) : t("tile.allReporting")}</small></div>
      </div>

      {findings.length > 0 && <section className={styles.findings} aria-label={t("standsOut")}><h4>{t("standsOut")}</h4><ul>{findings.map(finding => <li key={finding.title} className={needsAttention(finding) ? styles.attention : ""}><EnergyIcon name={finding.icon} /><div><strong>{finding.title}</strong><p>{finding.detail}</p></div></li>)}</ul></section>}

      {stat && <section className={styles.siteStats} aria-label={isSite ? t("stats.site") : t("stats.board", { label })}>
        <h4>{isSite ? t("stats.site") : t("stats.board", { label })}</h4>
        <div className={styles.statGrid}>
          <DailyUsageChart daily={stat.daily} name={isSite ? t("chart.wholeSite") : label} title={t("chart.daily", { label })} rate={rate} days={dayMap} />
          {/* An outlined bar on its own invites a guess. Name the meters once their
              silence is long enough to be certain; until then say only what is known. */}
          {isSite && loaded.shortDays.length > 0 && <p className={styles.chartNote}>{stoppedRows.length > 0
            ? t(stoppedRows.length === 1 ? "chart.stoppedNoteOne" : "chart.stoppedNote", { count: String(stoppedRows.length), total: String(rows.length), when: lastSentText(stoppedRows[0]!.stoppedAt!, summary.timezone, locale) })
            : t("chart.shortDayNote", { day: dateText(loaded.shortDays[0]!.localDate, false) })}</p>}
          <div className={styles.compare}>
            <h5>{t("compare.title")}{span && <span className={styles.chartPeriod}>{span}</span>}</h5>
            {facts(stat, label)}
            <p className={styles.muted}>{t("compare.note")}</p>
          </div>
          <DailyProfileChart profileKw={stat.openProfileKw} openHours={loaded.openHours} name={t("profile.openName", { label })} title={t("profile.openTitle", { label, count: stat.openDays })} max={profileMax} period={span} />
          <DailyProfileChart profileKw={stat.closedProfileKw} openHours={new Set()} name={t("profile.closedName", { label })} title={t("profile.closedTitle", { label, count: stat.closedDays })} max={profileMax} period={span} />
          {isSite && shareBars(boardTotals, t("byBoard"), id => showView({ kind: "board", id }))}
          {typeTotals.length > 0 && shareBars(typeTotals, t("byType"))}
        </div>
        {specialDaysSection(stat)}
        {heatRows.length > 0 && <UsageHeatmap rows={heatRows} openHours={loaded.openHours} openingLabel={openingHours} onOpenRow={openDevice} period={span} />}
      </section>}

      <section className={styles.breakdown} aria-label={t("breakdown.title")}>
        <h4>{t("breakdown.title")}</h4>
        <p className={styles.muted}>{t("breakdown.note", { scope: scopeName, kwh: kwh(scopeKwh) })}</p>
        <div className={styles.rankHead} aria-hidden="true"><span>{t("column.device")}</span><span /><span>{t("column.used")}</span>{rate && <span>{t("column.cost")}</span>}<span>{t("column.share")}</span></div>
        <ol className={styles.ranking}>{shares.map(share => <li key={share.id} className={share.unmetered ? styles.unmetered : undefined} aria-label={rate ? t("rank.ariaCost", { name: share.name, kwh: kwh(share.kwh), cost: sgd(share.kwh * rate), pct: pct(share.kwh / scopeKwh * 100), scope: label }) : t("rank.aria", { name: share.name, kwh: kwh(share.kwh), pct: pct(share.kwh / scopeKwh * 100), scope: label })}>
          <span className={styles.rankName} title={share.unmetered ? t("noSeparateMeterTitle", { name: share.name }) : share.name}>{share.unmetered ? <>{share.name}<small> · {t("noSeparateMeter")}</small></> : <button type="button" className={styles.nameLink} onClick={() => openDevice(share.id)}>{share.name}</button>}</span>
          <span className={styles.bar}><span style={{ width: `${Math.max(1, share.kwh / largest * 100)}%` }} /></span>
          <span className={styles.number}>{kwh(share.kwh)}</span>
          {rate && <span className={styles.number}>{sgd(share.kwh * rate)}</span>}
          <span className={styles.number}>{pct(share.kwh / scopeKwh * 100)}</span>
        </li>)}</ol>
      </section>

      <section className={styles.allDevices} aria-label={t("all.aria")}>
        <h4>{isSite ? t("all.site") : t("all.board", { board: label })}</h4>
        <p className={styles.muted}>{t("all.note")}</p>
        <div className={styles.tableWrap}><table className={`${styles.table} ${styles.fullTable}`}>
          <thead><tr>
            <th scope="col" className={styles.sticky}>{t("column.device")}</th><th scope="col" className={styles.number}>{t("column.used")}</th>{rate && <th scope="col" className={styles.number}>{t("column.cost")}</th>}<th scope="col" className={styles.number}>{t("column.shareOf", { scope: scopeName })}</th>
            <th scope="col" className={styles.number}>{t("column.openAverage")}</th><th scope="col" className={styles.number}>{t("column.closedAverage")}</th><th scope="col" className={styles.number}>{t("column.afterHours")}</th><th scope="col" className={styles.number}>{t("column.alwaysOn")}</th>
            <th scope="col" className={styles.number}>{t("column.peak")}</th><th scope="col" className={styles.number}>{t("column.yearly")}</th><th scope="col" className={styles.number}>{t("column.readings")}</th><th scope="col">{t("column.status")}</th><th scope="col"><span className={styles.srOnly}>{t("column.open")}</span></th>
          </tr></thead>
          {boards.map(id => {
            const boardRows = byBoard(id);
            return <tbody key={id}>
              <tr className={styles.groupRow}><th scope="rowgroup" colSpan={columns}><span className={styles.groupLabel}>{boardName(id)} <span>{t("group.count", { count: boardRows.length })}</span>{isSite && <button type="button" className={styles.groupOpen} onClick={() => showView({ kind: "board", id })}>{t("group.open", { board: boardName(id) })}</button>}</span></th></tr>
              {boardRows.map(row => {
                const stat = stats.get(row.id);
                return <tr key={row.id}>
                  <th scope="row" className={styles.sticky}><button type="button" className={styles.deviceLink} onClick={() => openDevice(row.id)}><strong>{row.name}</strong></button><small>{[typeName(row), row.isBoardTotal ? boardTotalNote(row.type, locale) : "", row.circuit ? t("circuit", { circuit: row.circuit }) : ""].filter(Boolean).join(" · ")}</small></th>
                  <td className={styles.number}>{row.usageKwh === null ? "—" : kwh(row.usageKwh)}</td>
                  {rate && <td className={styles.number}>{row.usageKwh === null ? "—" : sgd(row.usageKwh * rate)}</td>}
                  <td className={styles.number}>{row.usageKwh === null || !scopeKwh ? "—" : pct(row.usageKwh / scopeKwh * 100)}</td>
                  <td className={styles.number}>{stat?.openDayAverageKwh == null ? "—" : kwh(stat.openDayAverageKwh)}</td>
                  <td className={styles.number}>{stat?.closedDayAverageKwh == null ? "—" : kwh(stat.closedDayAverageKwh)}</td>
                  <td className={styles.number}>{stat?.outOfHoursKwh == null ? "—" : <>{pct(stat.outOfHoursPct!)}<small>{kwh(stat.outOfHoursKwh)}</small></>}</td>
                  <td className={styles.number}>{stat?.alwaysOnKw == null ? "—" : kw(stat.alwaysOnKw)}</td>
                  <td className={styles.number}>{row.peakKw === null ? "—" : kw(row.peakKw)}</td>
                  <td className={styles.number}>{rate && stat?.dailyAverageKwh != null ? `≈ ${sgd(stat.dailyAverageKwh * 365 * rate)}` : "—"}</td>
                  <td className={styles.number}>{stat ? pct(stat.receivedPct) : "0%"}</td>
                  <td><span className={`${styles.status} ${styles[row.status]}`}><span className={styles.dot} />{statusText(row.status, t)}</span></td>
                  <td><button type="button" className={styles.detailsButton} aria-label={t("row.openAria", { name: row.name })} onClick={() => openDevice(row.id)}>{t("row.open")}</button></td>
                </tr>;
              })}
            </tbody>;
          })}
        </table></div>
      </section>
    </>;
  };

  /** One device on its own: every figure, its days, its typical day and each day hour by hour. */
  const deviceView = (row: DeviceRow) => {
    const stat = stats.get(row.id);
    const index = ordered.findIndex(item => item.id === row.id);
    const previous = ordered[index - 1], next = ordered[index + 1];
    const siteKwh = summary.siteUsageKwh;
    const boardKwh = loaded.boards.get(row.boardId)?.analysis.summary.usageKwh ?? null;
    const nav = <div className={styles.deviceNav}>
      <span className={`${styles.status} ${styles[row.status]}`}><span className={styles.dot} />{statusText(row.status, t)}</span>
      <span className={styles.deviceNavButtons}>
        <button type="button" className={styles.secondary} disabled={!previous} onClick={() => previous && openDevice(previous.id)} title={previous ? t("nav.previousTitle", { name: previous.name }) : undefined}>{t("nav.previous")}</button>
        <button type="button" className={styles.secondary} disabled={!next} onClick={() => next && openDevice(next.id)} title={next ? t("nav.nextTitle", { name: next.name }) : undefined}>{t("nav.next")}</button>
      </span>
    </div>;
    if (!stat || row.usageKwh === null) return <>{nav}<p className={styles.emptyDevice}>{t("device.noReadings", { name: row.name, period })}</p></>;
    const findings = deviceFindings({ row, stat, rate, openingHours, locale, timezone: summary.timezone });
    const profileMax = niceMax(Math.max(0, ...stat.openProfileKw.map(value => value ?? 0), ...stat.closedProfileKw.map(value => value ?? 0)));
    const byDay = hourlyByDay(loaded.cells.get(row.id) ?? [], loaded.dates);
    const weekOf = (date: string) => { const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; return t("weekOf", { date: dateText(new Date(Date.parse(`${date}T00:00:00Z`) - weekday * 86_400_000).toISOString().slice(0, 10)) }); };
    const tag = (date: string) => { const day = dayMap.get(date); if (!day || day.kind === "open") return ""; return ` · ${dayKindBadge(day.kind, locale) ?? t(day.kind === "weekend" ? "tag.weekend" : "tag.closed")}`; };
    const dayRows = loaded.dates.map(date => ({ id: date, name: `${dateText(date)}${tag(date)}`, group: weekOf(date), profileKw: byDay.get(date) ?? [] }));
    return <>
      {nav}
      <div className={styles.glance}>
        <div className={styles.tile}><span>{t("tile.energy")}</span><strong>{kwh(row.usageKwh)}</strong><small>{stat.dailyAverageKwh === null ? t("tile.noAverage") : t("tile.dailyAverage", { kwh: kwh(stat.dailyAverageKwh) })}</small></div>
        {rate && <div className={styles.tile}><span>{t("tile.cost")}</span><strong>{sgd(row.usageKwh * rate)}</strong><small>{stat.dailyAverageKwh === null ? t("tile.inPeriod") : t("aboutPerYear", { amount: sgd(stat.dailyAverageKwh * 365 * rate) })}</small></div>}
        <div className={styles.tile}><span>{t("tile.shareOfSite")}</span><strong>{siteKwh ? pct(row.usageKwh / siteKwh * 100) : "—"}</strong><small>{boardKwh ? t("tile.shareOfBoard", { pct: pct(row.usageKwh / boardKwh * 100), board: boardName(row.boardId) }) : boardName(row.boardId)}</small></div>
        <div className={styles.tile}><span>{t("tile.afterHours")}</span><strong>{stat.outOfHoursPct === null ? "—" : pct(stat.outOfHoursPct)}</strong><small>{stat.outOfHoursKwh === null ? t("tile.noHours") : `${kwh(stat.outOfHoursKwh)}${rate ? ` · ${sgd(stat.outOfHoursKwh * rate)}` : ""}`}</small></div>
        <div className={styles.tile}><span>{t("tile.alwaysOn")}</span><strong>{stat.alwaysOnKw === null ? "—" : kw(stat.alwaysOnKw)}</strong><small>{stat.alwaysOnKw !== null && rate ? t("aboutPerYear", { amount: sgd(stat.alwaysOnKw * 24 * 365 * rate) }) : t("tile.alwaysOnNote")}</small></div>
        <div className={styles.tile}><span>{t("tile.peak")}</span><strong>{row.peakKw === null ? "—" : kw(row.peakKw)}</strong><small>{t("tile.peakNote")}</small></div>
      </div>

      <section className={styles.findings} aria-label={t("standsOut")}><h4>{t("standsOut")}</h4><ul>{findings.map(finding => <li key={finding.title} className={needsAttention(finding) ? styles.attention : ""}><EnergyIcon name={finding.icon} /><div><strong>{finding.title}</strong><p>{finding.detail}</p></div></li>)}</ul></section>

      <section className={styles.siteStats} aria-label={t("stats.device", { name: row.name })}>
        <h4>{t("stats.title")}</h4>
        <div className={styles.statGrid}>
          <DailyUsageChart daily={stat.daily} name={row.name} title={t("chart.daily", { label: row.name })} rate={rate} days={dayMap} />
          <div className={styles.compare}>
            <h5>{t("compare.title")}{span && <span className={styles.chartPeriod}>{span}</span>}</h5>
            {facts(stat, t("label.thisDevice"))}
            <p className={styles.muted}>{t("compare.noteDevice")}</p>
          </div>
          <DailyProfileChart profileKw={stat.openProfileKw} openHours={loaded.openHours} name={t("profile.openName", { label: row.name })} title={t("profile.openTitleDevice", { count: stat.openDays })} max={profileMax} period={span} />
          <DailyProfileChart profileKw={stat.closedProfileKw} openHours={new Set()} name={t("profile.closedName", { label: row.name })} title={t("profile.closedTitleDevice", { count: stat.closedDays })} max={profileMax} period={span} />
        </div>
        {specialDaysSection(stat)}
        <UsageHeatmap rows={dayRows} openHours={loaded.openHours} openingLabel={openingHours} title={t("everyDay")} scale="all" period={span} />
      </section>
    </>;
  };

  const device = view.kind === "device" ? summary.rows.find(row => row.id === view.id)! : null;
  const boardData = view.kind === "board" ? loaded.boards.get(view.id) : null;
  const currentBoard = view.kind === "board" ? view.id : device?.boardId ?? null;
  const title = device ? device.name : view.kind === "board" ? boardName(view.id) : t("title");
  const description = device ? t("description.device", { details: [typeName(device), device.isBoardTotal ? boardTotalNote(device.type, locale) : "", boardName(device.boardId), device.circuit ? t("circuit", { circuit: device.circuit }) : ""].filter(Boolean).join(" · "), period })
    : view.kind === "board" ? t("description.board", { count: byBoard(view.id).length, period })
    : t("description.site", { period });

  return <><MeterHealthNotice projectId={projectId} />
  <section ref={panelRef} className={`${styles.panel} ${fullScreen ? styles.fullScreen : ""}`} aria-label={t("title")}>
    <header className={styles.header}>
      <div>
        {view.kind !== "site" && <nav aria-label={t("crumbs")} className={styles.crumbs}>
          <button type="button" onClick={() => showView({ kind: "site" })}>{t("wholeSite")}</button><span aria-hidden="true">›</span>
          {device ? <><button type="button" onClick={() => showView({ kind: "board", id: device.boardId })}>{boardName(device.boardId)}</button><span aria-hidden="true">›</span></> : null}
          <span aria-current="page">{title}</span>
        </nav>}
        <h3>{title}</h3>
        <p className={styles.muted}>{description}</p>
        <PendingDayNote projectId={projectId} lastLocalDay={loaded.dates.at(-1)} timezone={loaded.site.analysis.context.timezone} className={styles.pendingDay} />
      </div>
      <div className={styles.headerActions}>
        <button type="button" className={styles.secondary} aria-pressed={!!fullScreen} onClick={() => void toggleFullScreen()}><EnergyIcon name="expand" />{fullScreen ? t("exitFullScreen") : t("fullScreen")}</button>
        <button type="button" className={styles.secondary} onClick={() => { setLoaded(null); setRefresh(n => n + 1); }}>{t("refresh")}</button>
      </div>
    </header>

    <div className={styles.viewBar}>
      <span className={styles.viewLabel}>{t("show")}</span>
      <div className={styles.segmented} role="group" aria-label={t("showGroup")}>
        <button type="button" aria-pressed={view.kind === "site"} onClick={() => showView({ kind: "site" })}>{t("wholeSite")}</button>
        {boardIds.map(id => <button key={id} type="button" aria-pressed={view.kind === "board" && view.id === id} className={view.kind === "device" && currentBoard === id ? styles.segmentWithin : undefined} onClick={() => showView({ kind: "board", id })}>{boardName(id)}</button>)}
      </div>
      <DevicePicker rows={ordered} boardName={boardName} value={device?.id ?? null} onPick={openDevice} />
    </div>

    {device ? deviceView(device)
      : view.kind === "board" ? boardData ? scopeView(boardData, byBoard(view.id), view.id) : <p role="alert" className={styles.emptyDevice}>{t("boardFailed", { board: boardName(view.id) })} <button type="button" className={styles.link} onClick={() => { setLoaded(null); setRefresh(n => n + 1); }}>{t("tryAgain")}</button></p>
      : scopeView(loaded.site, summary.rows, null)}

    <details className={styles.method}>
      <summary>{t("method.title")}</summary>
      <ul>
        <li>{t("method.readings")}</li>
        {rate && <li>{tariff?.gstPct != null ? t("method.costGst", { rate: sgd(rate), gst: tariff.gstPct }) : t("method.cost", { rate: sgd(rate) })}</li>}
        <li>{openingHours ? t("method.daysHours", { hours: openingHours }) : t("method.days")}</li>
        <li>{t("method.special", { badges: SPECIAL_DAY_KINDS.map(kind => dayKindBadge(kind, locale)).join(t("list.separator")) })}</li>
        <li>{t("method.alwaysOn")}</li>
        <li>{t("method.yearly")}</li>
        <li>{t("method.heatmap")}</li>
        {summary.calculatedCount > 0 && <li>{t("method.calculated", { count: summary.calculatedCount })}</li>}
        <li>{t(loaded.partial ? "method.syncPartial" : "method.sync")}</li>
        <li>{t("method.safety")}</li>
      </ul>
    </details>
  </section></>;
}

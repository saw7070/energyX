import {
  gridEmissionFactorFor,
  type EnergyIqAnalysisInterval,
  type EnergyIqCarbonSetting,
  type EnergyIqOvernightCheck,
  type EnergyIqProjectBudget,
  type MetadataStore,
  type UserRecord,
} from "@datafoundry/metadata";

import { executeEnergySiteFiguresProjection, type EnergySiteFiguresProjection } from "./energy-analysis.js";
import { withEnergyProjectPublicationReadLock } from "./energy-project-materialization.js";
import { resolveEnergyAccessContext, resolveEnergyPublishedHierarchyNodes } from "./energy-query-context.js";
import { resolvePublishedEnergyQueryContext } from "./project-analysis-resolver.js";

/**
 * A company's sites side by side, and the checks an energy manager sets per site: a monthly budget with a month-end
 * forecast, and unusual overnight use. Every figure comes from the same official read as the Overview headline
 * (executeEnergySiteFiguresProjection), so a site's total here matches its Overview and Analysis for the same days.
 * Carbon is location-based Scope 2: official kWh times the site's emission factor.
 */

export type PortfolioPeriod = { from: string; to: string };

export type PortfolioBudgetStatus = {
  month: string;
  /** Last local day with readings this month; the forecast covers the days after it. */
  dataThrough?: string;
  daysInMonth: number;
  actualKwh: number;
  forecastKwh: number;
  actualCost?: number;
  forecastCost?: number;
  currency: string;
  budgetAmount: number;
  budgetKwh?: number;
  /** "over": already above budget; "at-risk": forecast to end the month above it; "no-data": nothing to go on. */
  status: "on-track" | "at-risk" | "over" | "no-data";
  /** Why money could not be compared, when the budget was checked on kWh only or not at all. */
  costNote?: "tariff-unavailable" | "currency-differs";
};

export type PortfolioSite = {
  projectId: string;
  name: string;
  country?: "SG" | "MY";
  state?: string;
  timezone: string;
  status: "ok" | "unavailable";
  reason?: string;
  usageKwh: number;
  averageDailyKwh: number;
  peakKw: number;
  peakAt?: string;
  previousUsageKwh: number;
  changePct: number | null;
  cost?: { amount: number; currency: string };
  costReason?: string;
  afterHoursKwh?: number;
  afterHoursSharePct?: number;
  carbonKg: number;
  carbonFactor: EnergyIqCarbonSetting;
  coveragePct: number;
  dataStatus: "complete" | "partial" | "unavailable";
  lastSeenAt?: string;
  floorAreaSqm?: number;
  kwhPerSqm?: number;
  budget?: PortfolioBudgetStatus;
};

export type Portfolio = {
  workspaceId: string;
  workspaceName: string;
  period: PortfolioPeriod;
  generatedAt: string;
  sites: PortfolioSite[];
  totals: {
    usageKwh: number;
    previousUsageKwh: number;
    carbonKg: number;
    /** Money is never added across currencies. */
    costByCurrency: Record<string, number>;
    sitesWithData: number;
    sitesOverBudget: number;
    sitesAtRisk: number;
  };
};

const MAX_PERIOD_DAYS = 400;
/** Nights compared with when deciding whether last night was unusual. */
const OVERNIGHT_BASELINE_NIGHTS = 28;
const OVERNIGHT_MIN_BASELINE_NIGHTS = 7;
/** Below this the difference is noise from a single small device, however large in percent. */
const OVERNIGHT_MIN_EXTRA_KW = 0.2;
const NIGHT_START_HOUR = 0;
const NIGHT_END_HOUR = 6;

export const parsePortfolioPeriod = (from: unknown, to: unknown): PortfolioPeriod => {
  if (typeof from !== "string" || typeof to !== "string" || !isDate(from) || !isDate(to) || from > to) {
    throw new Error("ENERGYIQ_PORTFOLIO_PERIOD_INVALID");
  }
  if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) throw new Error("ENERGYIQ_PORTFOLIO_PERIOD_TOO_LONG");
  return { from, to };
};

/** Published sites in the workspace this person can read reports for. */
export const portfolioProjectIds = (input: { metadataStore: MetadataStore; user: UserRecord; workspaceId: string }): string[] => {
  const access = resolveEnergyAccessContext({ metadataStore: input.metadataStore, user: input.user, requestedWorkspaceId: input.workspaceId, rolePersistence: "read-only" });
  return access.projects
    .filter((project) => project.workspaceId === input.workspaceId && project.status === "published" && project.capabilities.readReports)
    .map((project) => project.id);
};

export const buildPortfolio = async (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  period: PortfolioPeriod;
  projectIds?: string[];
  includeBudget?: boolean;
  /** For a report about a past period: judge budgets as of the day after it ends. */
  budgetAsOf?: string;
  now?: Date;
}): Promise<Portfolio> => {
  const now = input.now ?? new Date();
  const visible = portfolioProjectIds(input);
  const projectIds = input.projectIds ? visible.filter((id) => input.projectIds!.includes(id)) : visible;
  const sites: PortfolioSite[] = [];
  // One site at a time: all of a company's sites share one readings database.
  for (const projectId of projectIds) {
    sites.push(await readPortfolioSite({ ...input, projectId, now }));
  }
  sites.sort((left, right) => right.usageKwh - left.usageKwh || left.name.localeCompare(right.name));
  const workspace = input.metadataStore.workspaces.list().find((candidate) => candidate.id === input.workspaceId);
  const costByCurrency: Record<string, number> = {};
  for (const site of sites) {
    if (site.cost) costByCurrency[site.cost.currency] = round((costByCurrency[site.cost.currency] ?? 0) + site.cost.amount, 2);
  }
  return {
    workspaceId: input.workspaceId,
    workspaceName: workspace?.name ?? input.workspaceId,
    period: input.period,
    generatedAt: now.toISOString(),
    sites,
    totals: {
      usageKwh: round(sum(sites.map((site) => site.usageKwh)), 2),
      previousUsageKwh: round(sum(sites.map((site) => site.previousUsageKwh)), 2),
      carbonKg: round(sum(sites.map((site) => site.carbonKg)), 1),
      costByCurrency,
      sitesWithData: sites.filter((site) => site.status === "ok" && site.usageKwh > 0).length,
      sitesOverBudget: sites.filter((site) => site.budget?.status === "over").length,
      sitesAtRisk: sites.filter((site) => site.budget?.status === "at-risk").length,
    },
  };
};

const readPortfolioSite = async (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  period: PortfolioPeriod;
  includeBudget?: boolean;
  budgetAsOf?: string;
  now: Date;
}): Promise<PortfolioSite> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const targets = input.metadataStore.energyIq.targets.getTargets(input.projectId);
  const carbonFactor = targets.carbon ?? gridEmissionFactorFor(project.region);
  const base = {
    projectId: project.id,
    name: project.name,
    ...(project.region ? { country: project.region.country, ...(project.region.state ? { state: project.region.state } : {}) } : {}),
    timezone: project.timezone,
    carbonFactor,
  };
  let site: PortfolioSite;
  try {
    const { figures, floorAreaSqm } = await readSiteFigures({ ...input, from: input.period.from, to: input.period.to });
    const { headline, offHours } = figures;
    const usageKwh = headline.summary.usageKwh;
    site = {
      ...base,
      status: "ok",
      usageKwh: round(usageKwh, 2),
      averageDailyKwh: round(headline.summary.averageDailyUsageKwh, 2),
      peakKw: round(headline.summary.peakKw, 2),
      ...(headline.summary.peakAt ? { peakAt: headline.summary.peakAt } : {}),
      previousUsageKwh: round(headline.comparison.usageKwh, 2),
      changePct: headline.comparison.changePct === null ? null : round(headline.comparison.changePct, 1),
      ...(headline.cost.status === "available"
        ? { cost: { amount: round(headline.cost.amount, 2), currency: headline.cost.currency } }
        : { costReason: headline.cost.reason.code }),
      ...(offHours.status === "available"
        ? { afterHoursKwh: round(offHours.standbyKwh, 2), afterHoursSharePct: round(offHours.sharePct, 1) }
        : {}),
      carbonKg: round(usageKwh * carbonFactor.kgCo2ePerKwh, 1),
      coveragePct: round(headline.dataHealth.coveragePct, 1),
      dataStatus: headline.dataHealth.status,
      ...(headline.dataHealth.lastSeenAt ? { lastSeenAt: headline.dataHealth.lastSeenAt } : {}),
      ...(floorAreaSqm ? { floorAreaSqm, kwhPerSqm: round(usageKwh / floorAreaSqm, 2) } : {}),
    };
  } catch (error) {
    site = {
      ...base,
      status: "unavailable",
      reason: errorCode(error),
      usageKwh: 0,
      averageDailyKwh: 0,
      peakKw: 0,
      previousUsageKwh: 0,
      changePct: null,
      carbonKg: 0,
      coveragePct: 0,
      dataStatus: "unavailable",
    };
  }
  if (input.includeBudget !== false && targets.budget) {
    try {
      const evaluation = await evaluateSiteChecks({
        ...input,
        budget: targets.budget,
        overnight: { enabled: false, thresholdPct: targets.overnight.thresholdPct },
        ...(input.budgetAsOf ? { asOfDate: input.budgetAsOf } : {}),
      });
      if (evaluation.budget) site.budget = evaluation.budget;
    } catch {
      // A budget that cannot be checked is left out rather than shown wrong.
    }
  }
  return site;
};

/** The official figures for one site over local dates [from, to], read as the given person. */
export const readSiteFigures = async (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  from: string;
  to: string;
}): Promise<{ figures: EnergySiteFiguresProjection; timezone: string; floorAreaSqm?: number }> => withEnergyProjectPublicationReadLock(input, async () => {
  const { context } = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: { projectId: input.projectId, period: "Custom", from: input.from, to: input.to },
  });
  const figures = await executeEnergySiteFiguresProjection({ metadataStore: input.metadataStore, context });
  const root = resolveEnergyPublishedHierarchyNodes(input.metadataStore, input.projectId, context.hierarchyRevisionId)
    .find((node) => node.id === context.scopeId);
  return { figures, timezone: context.timezone, ...(root?.area_sqm && root.area_sqm > 0 ? { floorAreaSqm: root.area_sqm } : {}) };
});

export type OvernightFinding = {
  night: string;
  nightKw: number;
  usualKw: number;
  abovePct: number;
  extraKwh: number;
  nightsCompared: number;
};

export type SiteChecks = {
  budget?: PortfolioBudgetStatus;
  overnight?: OvernightFinding;
};

/**
 * This month's budget position and last night's overnight use for one site. Reads the last four weeks of official
 * intervals once (for the daily pattern and the nights), and this month to date once (for the official cost).
 */
export const evaluateSiteChecks = async (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  budget?: EnergyIqProjectBudget;
  overnight: EnergyIqOvernightCheck;
  now: Date;
  /** Treat this local date as today: readings up to the day before count. Defaults to the site's today. */
  asOfDate?: string;
}): Promise<SiteChecks> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const realToday = localDate(input.now, project.timezone);
  const today = input.asOfDate && input.asOfDate < realToday ? input.asOfDate : realToday;
  const yesterday = shiftDate(today, -1);
  // The month being judged is the one the last full day belongs to, so on the 1st it is the month just ended.
  const month = yesterday.slice(0, 7);
  const monthStart = `${month}-01`;
  const fourWeeksBack = shiftDate(today, -OVERNIGHT_BASELINE_NIGHTS - 1);
  const historyFrom = monthStart < fourWeeksBack ? monthStart : fourWeeksBack;
  const history = await readSiteFigures({ ...input, from: historyFrom, to: yesterday });
  const daily = dailyUsage(history.figures.intervals, history.timezone);
  const checks: SiteChecks = {};
  if (input.overnight.enabled) {
    const finding = findUnusualNight({ intervals: history.figures.intervals, timezone: history.timezone, thresholdPct: input.overnight.thresholdPct });
    if (finding) checks.overnight = finding;
  }
  if (input.budget) {
    const dataDays = [...daily.keys()].sort();
    const lastDataDay = dataDays.at(-1);
    const dataThrough = lastDataDay && lastDataDay >= monthStart ? lastDataDay : undefined;
    let actualKwh = 0;
    let actualCost: number | undefined;
    let tariffCurrency: string | undefined;
    if (dataThrough) {
      const monthToDate = await readSiteFigures({ ...input, from: monthStart, to: dataThrough });
      actualKwh = monthToDate.figures.headline.summary.usageKwh;
      if (monthToDate.figures.headline.cost.status === "available") {
        actualCost = monthToDate.figures.headline.cost.amount;
        tariffCurrency = monthToDate.figures.headline.cost.currency;
      }
    }
    const historyCost = history.figures.headline.cost;
    const historyRate = historyCost.status === "available" && history.figures.headline.summary.usageKwh > 0
      ? { rate: historyCost.amount / history.figures.headline.summary.usageKwh, currency: historyCost.currency }
      : undefined;
    checks.budget = projectMonthEnd({
      month,
      today,
      ...(dataThrough ? { dataThrough } : {}),
      actualKwh,
      ...(actualCost !== undefined && tariffCurrency ? { actualCost, tariffCurrency } : {}),
      ...(historyRate ? { historyRate } : {}),
      daily,
      budget: input.budget,
    });
  }
  return checks;
};

/**
 * Month-end projection: the month's official usage so far, plus a typical day for each day still to come. A typical
 * day is the average of the same weekday over the last four weeks (or of all recent days when a weekday has none).
 * Money for the remaining days uses this month's average price so far, or the last four weeks' when this month has
 * no priced days yet.
 */
export const projectMonthEnd = (input: {
  month: string;
  today: string;
  dataThrough?: string;
  actualKwh: number;
  actualCost?: number;
  tariffCurrency?: string;
  historyRate?: { rate: number; currency: string };
  daily: Map<string, number>;
  budget: EnergyIqProjectBudget;
}): PortfolioBudgetStatus => {
  const daysInMonth = monthLength(input.month);
  const monthEnd = `${input.month}-${String(daysInMonth).padStart(2, "0")}`;
  const firstRemaining = input.dataThrough ? shiftDate(input.dataThrough, 1) : `${input.month}-01`;
  const byWeekday = new Map<number, number[]>();
  for (const [date, kwh] of input.daily) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), kwh]);
  }
  const allDays = [...input.daily.values()];
  const overall = allDays.length ? mean(allDays) : undefined;
  let remainingKwh = 0;
  let remainingDays = 0;
  for (let date = firstRemaining; date <= monthEnd; date = shiftDate(date, 1)) {
    const sameWeekday = byWeekday.get(new Date(`${date}T00:00:00Z`).getUTCDay());
    const typical = sameWeekday?.length ? mean(sameWeekday) : overall;
    if (typical !== undefined) remainingKwh += typical;
    remainingDays += 1;
  }
  const base = {
    month: input.month,
    ...(input.dataThrough ? { dataThrough: input.dataThrough } : {}),
    daysInMonth,
    currency: input.budget.currency,
    budgetAmount: input.budget.monthlyAmount,
    ...(input.budget.monthlyKwh ? { budgetKwh: input.budget.monthlyKwh } : {}),
  };
  if (!input.dataThrough && overall === undefined) {
    return { ...base, actualKwh: 0, forecastKwh: 0, status: "no-data" };
  }
  const actualKwh = round(input.actualKwh, 1);
  const forecastKwh = round(input.actualKwh + (remainingDays > 0 && overall !== undefined ? remainingKwh : 0), 1);
  const pricedSoFar = input.actualCost !== undefined && input.actualKwh > 0;
  const currency = pricedSoFar ? input.tariffCurrency : input.historyRate?.currency;
  const rate = pricedSoFar ? input.actualCost! / input.actualKwh : input.historyRate?.rate;
  const costComparable = currency === input.budget.currency && rate !== undefined;
  // Without an official price for this month yet, the cost so far is estimated at the recent average price.
  const costSoFar = pricedSoFar ? input.actualCost! : input.actualKwh * (rate ?? 0);
  const actualCost = costComparable ? round(costSoFar, 2) : undefined;
  const forecastCost = costComparable ? round(costSoFar + remainingKwh * rate!, 2) : undefined;
  const overMoney = actualCost !== undefined && actualCost > input.budget.monthlyAmount;
  const riskMoney = forecastCost !== undefined && forecastCost > input.budget.monthlyAmount;
  const overKwh = input.budget.monthlyKwh !== undefined && actualKwh > input.budget.monthlyKwh;
  const riskKwh = input.budget.monthlyKwh !== undefined && forecastKwh > input.budget.monthlyKwh;
  return {
    ...base,
    actualKwh,
    forecastKwh,
    ...(actualCost !== undefined ? { actualCost } : {}),
    ...(forecastCost !== undefined ? { forecastCost } : {}),
    status: overMoney || overKwh ? "over" : riskMoney || riskKwh ? "at-risk" : "on-track",
    ...(costComparable ? {} : { costNote: currency && rate !== undefined ? "currency-differs" : "tariff-unavailable" }),
  };
};

/**
 * Last night (00:00 to 06:00 local) compared with the nights before it. Only nights with nearly all their readings
 * count. Unusual means the average load was the threshold above the median of earlier nights, and at least a little
 * in absolute terms.
 */
export const findUnusualNight = (input: {
  intervals: EnergyIqAnalysisInterval[];
  timezone: string;
  thresholdPct: number;
}): OvernightFinding | undefined => {
  const nights = new Map<string, { kwh: number; minutes: number }>();
  for (const interval of input.intervals) {
    const start = Date.parse(interval.start);
    const minutes = (Date.parse(interval.end_exclusive) - start) / 60_000;
    if (!(minutes > 0)) continue;
    const { date, hour } = localDateHour(new Date(start), input.timezone);
    if (hour < NIGHT_START_HOUR || hour >= NIGHT_END_HOUR) continue;
    const night = nights.get(date) ?? { kwh: 0, minutes: 0 };
    night.kwh += interval.usage_kwh;
    night.minutes += minutes;
    nights.set(date, night);
  }
  const nightMinutes = (NIGHT_END_HOUR - NIGHT_START_HOUR) * 60;
  const complete = [...nights.entries()]
    .filter(([, night]) => night.minutes >= nightMinutes * 0.9)
    .map(([date, night]) => ({ date, kw: night.kwh / (night.minutes / 60) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const last = complete.at(-1);
  const earlier = complete.slice(0, -1).slice(-OVERNIGHT_BASELINE_NIGHTS);
  if (!last || earlier.length < OVERNIGHT_MIN_BASELINE_NIGHTS) return undefined;
  const usualKw = median(earlier.map((night) => night.kw));
  if (!(usualKw > 0)) return undefined;
  const abovePct = ((last.kw - usualKw) / usualKw) * 100;
  if (abovePct < input.thresholdPct || last.kw - usualKw < OVERNIGHT_MIN_EXTRA_KW) return undefined;
  return {
    night: last.date,
    nightKw: round(last.kw, 2),
    usualKw: round(usualKw, 2),
    abovePct: round(abovePct, 0),
    extraKwh: round((last.kw - usualKw) * (nightMinutes / 60), 1),
    nightsCompared: earlier.length,
  };
};

/** Official kWh per local day. */
export const dailyUsage = (intervals: EnergyIqAnalysisInterval[], timezone: string): Map<string, number> => {
  const days = new Map<string, number>();
  for (const interval of intervals) {
    const date = localDateHour(new Date(interval.start), timezone).date;
    days.set(date, (days.get(date) ?? 0) + interval.usage_kwh);
  }
  return days;
};

export const localDate = (date: Date, timezone: string): string => localDateHour(date, timezone).date;

const localDateHour = (date: Date, timezone: string): { date: string; hour: number } => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};

export const shiftDate = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const monthLength = (month: string): number => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
};

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]): number => sum(values) / values.length;
const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const errorCode = (error: unknown): string => (error instanceof Error ? error.message : "ENERGYIQ_PORTFOLIO_SITE_FAILED").split(":")[0]!.slice(0, 120);

/**
 * Turning one Energy consumption result into the readings the Analysis page and the site report work from.
 *
 * This is the single copy of that mapping. The browser calls it with the JSON the analysis endpoint returned; the
 * server calls it with the very same object before it is serialised, so a report generated on a schedule holds the
 * numbers a reader would have seen on the page. Everything here is pure: no fetching, no clock, no DOM.
 */
import type { AnalysisCategory } from "./analysis-model.js";
import { PLANNED_CLOSURE_SUFFIX } from "./analysis-messages.js";
import type { AnalysisData, LoadedPeriod, ProjectAction, ScopeCircuit, ScopeData, TrendCell, TrendSeries } from "./analysis-types.js";

/**
 * The part of one Energy consumption result this mapping reads. Both the browser's response type and the server's
 * own result type satisfy it, so neither side needs to know about the other.
 */
export type AnalysisSource = {
  context: {
    projectName?: string; scopeId: string; scopeName: string; timezone: string; from: string; to: string;
    dataSnapshotId?: string;
  };
  summary: { usageKwh: number; peakKw: number; peakAt?: string | undefined; validIntervalCount: number };
  explorerTrends?: Array<{ id: string; expectedMinutesPerHour: number; cells: Array<[string, number, number | null, number, number]> }> | undefined;
  explorerMeters?: Array<{ id: string; name: string; scopeId: string; kind: "physical" | "virtual"; category: string; includedInOfficialTotal: boolean }> | undefined;
  categories: Array<{ category: string; usageKwh: number }>;
  childScopes: Array<{ nodeId: string; name: string }>;
  circuits: Array<{ meterNodeId: string; name: string; category: string; meterRole: string; usageKwh: number; includedInOfficialTotal?: boolean | undefined; scopeId?: string | undefined }>;
  cost:
    | { status: "available"; amount: number; currency: string; allocations: Array<{ ratePerKwh: number; rateBasis?: "tax_inclusive" | "tax_exclusive" | undefined; period?: "peak" | "off_peak" | undefined; usageKwh?: number; cost?: number }> }
    | { status: "unavailable" };
};

/** The calendar and meter facts the readings are labelled with, however the caller happens to have loaded them. */
export type ProjectInformationSource = {
  name?: string | undefined;
  meters?: Array<{ id: string; location: string }> | undefined;
  calendar: null | { entries: Array<{ location: string; from: string; toExclusive: string | null; weekly: unknown; exceptions: Array<{ date: string; label: string; classification?: string | undefined }> }> };
} | null;

const CATEGORY_OF: Record<string, AnalysisCategory | "overall"> = { light: "light", load: "load", aircon: "aircon", it: "it", kitchen: "kitchen", plug: "plug", overall: "overall" };
export const categoryOf = (value: string): AnalysisCategory | "overall" => CATEGORY_OF[value] ?? "other";

/** The project's own calendar day for an instant; readings are always grouped by the site's local dates. */
export function scopeLocalDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function scopeDatesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = Date.parse(`${from}T00:00:00Z`); day <= Date.parse(`${to}T00:00:00Z`); day += 86_400_000) days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}

/** Every local date the result covers. The end instant is exclusive, so step back one millisecond first. */
export function analysisScopeDates(analysis: AnalysisSource | null): string[] {
  return analysis
    ? scopeDatesBetween(scopeLocalDate(analysis.context.from, analysis.context.timezone), scopeLocalDate(new Date(Date.parse(analysis.context.to) - 1).toISOString(), analysis.context.timezone))
    : [];
}

/** Move a local date by whole days, staying on calendar dates rather than instants. */
export const shiftScopeDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A site whose total is its main meter has no split by type of its own: the main meter is "Total". Add up the
 * sub-meters below it by type instead. Totals come from each sub-meter's usage; hourly series only where the result
 * carries the sub-meters' own readings, and an hour counts as complete only when every sub-meter of that type
 * reported for all of it.
 */
function subMeterTypes(analysis: AnalysisSource, trends: TrendSeries[], typeTotals: Partial<Record<AnalysisCategory, number>>): Partial<Record<AnalysisCategory, TrendSeries>> {
  const meters = new Map((analysis.explorerMeters ?? []).map(meter => [meter.id, meter]));
  const parts = analysis.circuits.filter(circuit => meters.get(circuit.meterNodeId)?.kind !== "virtual"
    && circuit.meterRole !== "total" && circuit.meterRole !== "derived"
    && categoryOf(meters.get(circuit.meterNodeId)?.category ?? circuit.category) !== "overall");
  const byType = new Map<AnalysisCategory, TrendSeries[]>();
  for (const circuit of parts) {
    const category = categoryOf(meters.get(circuit.meterNodeId)?.category ?? circuit.category) as AnalysisCategory;
    typeTotals[category] = (typeTotals[category] ?? 0) + circuit.usageKwh;
    const series = trends.find(item => item.id === circuit.meterNodeId);
    byType.set(category, [...(byType.get(category) ?? []), ...(series ? [series] : [])]);
  }
  const types: Partial<Record<AnalysisCategory, TrendSeries>> = {};
  for (const [category, list] of byType) {
    // Without every sub-meter's readings, an hourly line for the type would quietly leave some of them out.
    if (!list.length || list.length < parts.filter(circuit => categoryOf(meters.get(circuit.meterNodeId)?.category ?? circuit.category) === category).length) continue;
    const hours = new Map<string, TrendCell[]>();
    for (const series of list) for (const cell of series.cells) {
      const key = `${cell[0]}\u0000${cell[1]}`;
      hours.set(key, [...(hours.get(key) ?? []), cell]);
    }
    const cells = [...hours.values()].map((cells): TrendCell => {
      const readings = cells.filter(cell => cell[2] != null);
      return [cells[0]![0], cells[0]![1], readings.length ? readings.reduce((sum, cell) => sum + cell[2]!, 0) : null,
        cells.length === list.length ? Math.min(...cells.map(cell => cell[3])) : 0, Math.max(...cells.map(cell => cell[4]))];
    }).sort((left, right) => left[0].localeCompare(right[0]) || left[1] - right[1]);
    types[category] = { id: `__category__:${category}`, expectedMinutesPerHour: Math.min(...list.map(series => series.expectedMinutesPerHour)), cells };
  }
  return types;
}

export function toScope(analysis: AnalysisSource, locations: Map<string, string>, name?: string): ScopeData {
  const trends = (analysis.explorerTrends ?? []) as TrendSeries[];
  const types: Partial<Record<AnalysisCategory, TrendSeries>> = {};
  for (const series of trends) {
    if (!series.id.startsWith("__category__:")) continue;
    const category = categoryOf(series.id.slice("__category__:".length));
    if (category !== "overall") types[category] = series;
  }
  const typeTotals: Partial<Record<AnalysisCategory, number>> = {};
  for (const item of analysis.categories) { const category = categoryOf(item.category); if (category !== "overall") typeTotals[category] = (typeTotals[category] ?? 0) + item.usageKwh; }
  if (!Object.keys(types).length && !Object.keys(typeTotals).length) Object.assign(types, subMeterTypes(analysis, trends, typeTotals));
  const cost = analysis.cost.status === "available" ? analysis.cost : null;
  const basis = cost?.allocations[0]?.rateBasis;
  const rates = [...new Set(cost?.allocations.map(item => item.ratePerKwh) ?? [])];
  // Time-of-use rates price peak and off-peak hours apart; keep what peak hours cost so the story can say so.
  const peakAllocations = cost?.allocations.filter(item => item.period === "peak") ?? [];
  const peak = peakAllocations.length ? {
    cost: peakAllocations.reduce((sum, item) => sum + (item.cost ?? 0), 0),
    usageKwh: peakAllocations.reduce((sum, item) => sum + (item.usageKwh ?? 0), 0),
  } : null;
  const total = trends.find(item => item.id === "__scope__") ?? null;
  const dates = analysisScopeDates(analysis);
  const expected = total ? total.expectedMinutesPerHour * 24 * dates.length : 0;
  return {
    id: analysis.context.scopeId, name: name ?? analysis.context.scopeName, dates, timezone: analysis.context.timezone,
    total, types,
    meters: (analysis.explorerMeters ?? []).filter(meter => meter.kind === "physical").map(meter => ({
      id: meter.id, name: meter.name, location: locations.get(meter.id) ?? "", category: categoryOf(meter.category), official: meter.includedInOfficialTotal,
      series: trends.find(item => item.id === meter.id) ?? null,
    })),
    usageKwh: analysis.summary.validIntervalCount > 0 ? analysis.summary.usageKwh : null,
    peakKw: analysis.summary.validIntervalCount > 0 ? analysis.summary.peakKw : null,
    peakAt: analysis.summary.peakAt ? scopeLocalDate(analysis.summary.peakAt, analysis.context.timezone) : null,
    cost: cost ? { amount: cost.amount, currency: cost.currency, note: `${rates.join(" / ")} ${cost.currency}/kWh${basis === "tax_inclusive" ? " incl. tax" : basis === "tax_exclusive" ? " before tax" : ""}`, rates, basis: basis ?? null, ...(peak ? { peak } : {}) } : null,
    typeTotals, coverage: total && expected > 0 ? Math.min(100, total.cells.reduce((sum, cell) => sum + cell[3], 0) / expected * 100) : null,
  };
}

/**
 * Every real circuit except totals: a main total meter, or an official meter whose location also has sub-meters
 * (its energy is already shown by those sub-meters). Official circuits without sub-meters stay in.
 */
export function rankCircuits(sources: AnalysisSource[], previous: { circuits?: Array<{ meterNodeId: string; usageKwh: number }> } | null, meterLocations: Map<string, string>): ScopeCircuit[] {
  const meters = new Map(sources.flatMap(source => source.explorerMeters ?? []).map(meter => [meter.id, meter]));
  const previousUsage = new Map((previous?.circuits ?? []).map(circuit => [circuit.meterNodeId, circuit.usageKwh]));
  const seen = new Set<string>();
  const physical = sources.flatMap(source => source.circuits).filter(circuit => {
    if (meters.get(circuit.meterNodeId)?.kind === "virtual" || seen.has(circuit.meterNodeId)) return false;
    seen.add(circuit.meterNodeId); return true;
  });
  const placeOf = (id: string) => meterLocations.get(id) ?? meters.get(id)?.scopeId ?? "";
  const official = (circuit: AnalysisSource["circuits"][number]) => meters.get(circuit.meterNodeId)?.includedInOfficialTotal ?? !!circuit.includedInOfficialTotal;
  const mainMeter = (circuit: AnalysisSource["circuits"][number]) => circuit.meterRole === "total" || categoryOf(circuit.category) === "overall";
  // A main meter left out of the sum is not a sub-meter: the circuits beside it are the real circuits, not totals.
  const subMeteredPlaces = new Set(physical.filter(circuit => !official(circuit) && !mainMeter(circuit)).map(circuit => placeOf(circuit.meterNodeId)));
  const isTotal = (circuit: AnalysisSource["circuits"][number]) => mainMeter(circuit)
    || (official(circuit) && subMeteredPlaces.has(placeOf(circuit.meterNodeId)));
  const circuits = physical.filter(circuit => !isTotal(circuit));
  return (circuits.length ? circuits : physical).map(circuit => {
    const meter = meters.get(circuit.meterNodeId);
    return { id: circuit.meterNodeId, name: meter?.name ?? circuit.name, location: meterLocations.get(circuit.meterNodeId) ?? "", category: categoryOf(meter?.category ?? circuit.category), kwh: circuit.usageKwh, previousKwh: previousUsage.get(circuit.meterNodeId) ?? null };
  }).sort((a, b) => b.kwh - a.kwh);
}

/** How many spaces the Analysis page and the site report look at; the rest of the tree stays in Project Explorer. */
export const MAX_ANALYSIS_SPACES = 8;

/** The dates the project result covers, and the equal-length stretch before them to compare against. */
export function analysisComparisonDates(project: AnalysisSource): { dates: string[]; previous: { from: string; to: string } | null } {
  const dates = analysisScopeDates(project);
  return { dates, previous: dates.length ? { from: shiftScopeDate(dates[0]!, -dates.length), to: shiftScopeDate(dates[0]!, -1) } : null };
}

/** Everything the readings are made of, once the caller has loaded each piece. Order of spaces follows childScopes. */
export function assembleAnalysisData(input: {
  projectId: string;
  project: AnalysisSource;
  spaces: Array<{ nodeId: string; name: string }>;
  spaceCurrent: Array<AnalysisSource | null>;
  previousProject: AnalysisSource | null;
  spacePrevious: Array<AnalysisSource | null>;
  history: AnalysisSource | null;
  information: ProjectInformationSource;
  actions: ProjectAction[];
}): AnalysisData {
  const { project, information, spaces } = input;
  const locations = new Map((information?.meters ?? []).map(meter => [meter.id, meter.location]));
  const holidays = new Map<string, string>();
  for (const entry of information?.calendar?.entries ?? []) for (const item of entry.exceptions) if (item.classification === "public_holiday" || item.classification === "special_closure") holidays.set(item.date, item.classification === "special_closure" ? `${item.label}${PLANNED_CLOSURE_SUFFIX}` : item.label);
  const entries = information?.calendar?.entries ?? [];
  const lastDate = analysisScopeDates(project).at(-1) ?? "";
  const projectEntry = entries.find(entry => entry.location === information?.name && entry.from <= lastDate && (!entry.toExclusive || entry.toExclusive > lastDate)) ?? entries.find(entry => entry.location === information?.name) ?? entries[0];
  const hasPrevious = !!input.previousProject && input.previousProject.summary.validIntervalCount > 0;
  const loadedSpaces = input.spaceCurrent.filter((item): item is AnalysisSource => !!item);
  const period = (project: AnalysisSource, loaded: Array<AnalysisSource | null>): LoadedPeriod => ({
    project: toScope(project, locations),
    spaces: spaces.flatMap((space, index) => loaded[index] ? [toScope(loaded[index]!, locations, space.name)] : []),
  });
  return {
    projectId: input.projectId, projectName: information?.name ?? project.context.projectName ?? input.projectId,
    timezone: project.context.timezone, snapshotId: project.context.dataSnapshotId ?? null,
    current: period(project, input.spaceCurrent),
    previous: hasPrevious ? period(input.previousProject!, input.spacePrevious) : null,
    history: input.history && input.history.summary.validIntervalCount > 0 ? toScope(input.history, locations) : null,
    circuits: rankCircuits(loadedSpaces.length ? loadedSpaces : [project], hasPrevious ? input.previousProject : null, locations),
    holidays, openingHours: (projectEntry?.weekly ?? null) as AnalysisData["openingHours"], actions: input.actions,
  };
}

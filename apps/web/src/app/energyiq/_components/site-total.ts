import type { ScopeCircuit, ScopeData } from "./analysis-data";

/**
 * A site's main meter measures everything; the sub-meters below it measure parts. Putting the main meter in the same
 * list as the sub-meters counts the same electricity twice ("Site 91%, circuit 3%…"). These helpers keep the main
 * meter for the whole-site total only, and show what it measured that no sub-meter explains as its own line.
 */

/** An area whose only readings are whole-site (overall) meters: it is where the main meter sits, not a use of energy. */
export const holdsOnlyMainMeter = (space: ScopeData): boolean =>
  space.meters.length > 0 && space.meters.every((meter) => meter.category === "overall");

/** Areas to list in a breakdown: every area with readings, except the one that only holds the main meter. */
export const breakdownSpaces = <T>(items: T[], scopeOf: (item: T) => ScopeData): T[] => {
  const used = items.filter((item) => (scopeOf(item).usageKwh ?? 0) > 0);
  return used.filter((item) => !(holdsOnlyMainMeter(scopeOf(item)) && used.some((other) => other !== item)));
};

export type BreakdownRow = { key: string; label: string; kwh: number; unmetered: boolean };
export const UNMETERED_KEY = "unmetered";

/**
 * Where the energy goes: the areas below the main meter (or, when the site is a single area, its circuits), plus a
 * "not measured by a sub-meter" line for the rest of what the main meter recorded. Largest first.
 */
export function siteBreakdown(input: {
  projectKwh: number | null;
  spaces: ScopeData[];
  circuits: ScopeCircuit[];
  unmeteredLabel: string;
}): { rows: BreakdownRow[]; byCircuit: boolean; unmeteredKwh: number } {
  const areas = breakdownSpaces(input.spaces, (space) => space);
  const circuits = input.circuits.filter((circuit) => circuit.category !== "overall" && circuit.kwh > 0);
  const byCircuit = areas.length <= 1 && circuits.length >= 2;
  const rows: BreakdownRow[] = byCircuit
    ? circuits.map((circuit) => ({ key: circuit.id, label: circuit.name, kwh: circuit.kwh, unmetered: false }))
    : areas.map((space) => ({ key: space.id, label: space.name, kwh: space.usageKwh ?? 0, unmetered: false }));
  const measured = rows.reduce((sum, row) => sum + row.kwh, 0);
  const total = input.projectKwh ?? 0;
  const gap = total - measured;
  // Readings never line up to the last watt-hour; only a real share of the site is worth a line of its own.
  const unmeteredKwh = total > 0 && gap > Math.max(0.5, total * 0.02) ? gap : 0;
  if (unmeteredKwh > 0) rows.push({ key: UNMETERED_KEY, label: input.unmeteredLabel, kwh: unmeteredKwh, unmetered: true });
  return { rows: rows.sort((left, right) => right.kwh - left.kwh), byCircuit, unmeteredKwh };
}

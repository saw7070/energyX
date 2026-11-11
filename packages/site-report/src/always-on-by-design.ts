/**
 * Meters meant to run day and night, such as emergency lighting. Someone ticks "always on" on the meter
 * (presentation.always_on === "true"); the readings then carry it as `alwaysOnByDesign`.
 *
 * Such a meter stays in every total. What changes is how its use is read: running in the daytime, or never switching
 * off, is what it is meant to do, so it is never daytime use, never a saving to chase and never a problem. Reports
 * describe it as "always on by design". Meters without the tick are read exactly as before.
 */
import { alwaysOnKw } from "./analysis-model.js";
import type { ScopeData, ScopeMeter } from "./analysis-types.js";

/** A meter meant to run day and night, named as readers know it. */
export type AlwaysOnMeter = { id: string; name: string };

/** The ids of the meters meant to run day and night in a set of readings. */
export const alwaysOnByDesignIds = (data: { alwaysOnByDesign?: AlwaysOnMeter[] | undefined }): Set<string> =>
  new Set((data.alwaysOnByDesign ?? []).map(meter => meter.id));

/**
 * The always-on meters found in the readings, each once and named as the readings name it (the short name when one is
 * set), in the order the scopes list them. A meter with no readings in these scopes is left out.
 */
export function alwaysOnByDesignMeters(data: { alwaysOnByDesign?: AlwaysOnMeter[] | undefined }, scopes: readonly ScopeData[]): ScopeMeter[] {
  const ids = alwaysOnByDesignIds(data);
  if (!ids.size) return [];
  const found = new Map<string, ScopeMeter>();
  for (const scope of scopes) for (const meter of scope.meters) {
    if (!ids.has(meter.id)) continue;
    const known = found.get(meter.id);
    if (!known || (!known.series && meter.series)) found.set(meter.id, meter);
  }
  return [...found.values()];
}

/**
 * The steady draw of the always-on meters, in kW: each one's own always-on level (alwaysOnKw over the same quiet
 * hours), added up. Taken off the site's always-on level wherever that level is read as something to cut, so a site
 * whose floor is its emergency lighting is never told its floor is the problem. 0 when no meter is marked.
 */
export function alwaysOnByDesignKw(data: { alwaysOnByDesign?: AlwaysOnMeter[] | undefined; current: { project: ScopeData; spaces: ScopeData[] } }, quiet?: readonly number[]): number {
  const project = data.current.project;
  return alwaysOnByDesignMeters(data, [project, ...data.current.spaces])
    .filter(meter => meter.series && meter.official && meter.category !== "overall")
    .reduce((sum, meter) => sum + (alwaysOnKw({ ...project, total: meter.series }, quiet) ?? 0), 0);
}

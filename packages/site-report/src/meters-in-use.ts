/**
 * Meters someone marked "not in use" on Data availability (a spare circuit, a meter nobody uses, one that was
 * removed) are expected to be silent. The site total still holds whatever they measured, but their silence must not
 * stop a day from counting as complete: otherwise one dead meter blanks the weekday/weekend and always-on figures
 * for every day after it stopped.
 *
 * The site total's hourly readings say how many minutes of readings arrived and how many readings had a problem,
 * added up over every meter in the total. Taking a not-in-use meter's own minutes and problems back out of each hour,
 * and expecting one meter fewer, judges completeness on the meters in use only. Energy figures never change.
 */
import type { ScopeData, TrendSeries } from "./analysis-types.js";

/** A meter marked not in use, with the reason someone gave (a code such as "reason:spare", or their own words). */
export type NotInUseMeter = { id: string; name: string; reason: string };

/** The ids of the meters marked not in use in a set of readings. */
export const notInUseIds = (data: { notInUse?: NotInUseMeter[] | undefined }): Set<string> => new Set((data.notInUse ?? []).map(meter => meter.id));

/**
 * The scope's total with completeness judged only on the meters in use. A not-in-use meter that is part of the total
 * has its own readings taken back out of each hour's count. If its own hourly readings are not in the readings
 * (`sources` are searched as well, since a site's meters usually carry their series in the spaces), the total is
 * returned as it was: without them its share of the count cannot be told apart.
 */
export function inUseTotal(scope: ScopeData, notInUse: ReadonlySet<string>, sources: readonly ScopeData[] = []): TrendSeries | null {
  const total = scope.total;
  if (!total || !notInUse.size) return total;
  const excluded = scope.meters.filter(meter => meter.official && meter.category !== "overall" && notInUse.has(meter.id));
  if (!excluded.length) return total;
  const seriesOf = (id: string) => [scope, ...sources].flatMap(item => item.meters).find(meter => meter.id === id && meter.series)?.series ?? null;
  const parts = excluded.map(meter => seriesOf(meter.id));
  if (parts.some(part => !part)) return total;
  const expected = total.expectedMinutesPerHour - parts.reduce((sum, part) => sum + part!.expectedMinutesPerHour, 0);
  if (expected <= 0) return total;
  const own = new Map<string, { minutes: number; events: number }>();
  for (const part of parts) for (const cell of part!.cells) {
    const key = `${cell[0]}|${cell[1]}`;
    const known = own.get(key) ?? { minutes: 0, events: 0 };
    own.set(key, { minutes: known.minutes + cell[3], events: known.events + cell[4] });
  }
  return {
    ...total, expectedMinutesPerHour: expected,
    cells: total.cells.map(cell => {
      const part = own.get(`${cell[0]}|${cell[1]}`);
      return part ? [cell[0], cell[1], cell[2], Math.max(0, cell[3] - part.minutes), Math.max(0, cell[4] - part.events)] : cell;
    }),
  };
}

/** The scope with its total judged on the meters in use (see inUseTotal); the same object when nothing changes. */
export function withMetersInUse(scope: ScopeData, notInUse: ReadonlySet<string>, sources: readonly ScopeData[] = []): ScopeData {
  const total = inUseTotal(scope, notInUse, sources);
  return total === scope.total ? scope : { ...scope, total };
}

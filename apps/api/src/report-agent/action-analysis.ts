import { z } from "zod";

export const lightingScenarioSchema = z.object({
  reduciblePowerKw: z.number().finite().nonnegative().max(10000),
  hoursPerDay: z.number().finite().positive().max(24), days: z.number().int().positive().max(366),
  ratePerKwh: z.number().finite().nonnegative().max(10000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), taxBasis: z.enum(["including_tax", "excluding_tax"]).optional(),
  assumptions: z.string().trim().min(10).max(2000),
}).strict().refine(v => v.ratePerKwh === undefined || (!!v.currency && !!v.taxBasis), "Currency and tax basis required");
/** A user-supplied what-if, never represented as a verified prediction from project readings. */
export function estimateLighting(raw: unknown) {
  const v = lightingScenarioSchema.parse(raw);
  const energyKwh = v.reduciblePowerKw * v.hoursPerDay * v.days;
  return { methodVersion: "lighting-hours-v1", inputs: v, energyKwh,
    ...(v.ratePerKwh === undefined ? {} : { estimatedCost: energyKwh * v.ratePerKwh, currency: v.currency, taxBasis: v.taxBasis }),
    basis: "user_supplied_assumptions", disclaimer: "Scenario estimate, not measured savings. Assumes this load can be removed during the selected hours." };
}

export type ObservedDay = { date: string; dayType: string; expectedMinutes: number; validMinutes: number; criticalGap: boolean; kwh: number | null };
/** Only server-computed target-window quality belongs here; never accept browser coverage assertions. */
export function assessActionReadiness(input: { baseline: ObservedDay[]; observation: ObservedDay[]; minimumDays?: number }) {
  const valid = (d: ObservedDay) => z.string().date().safeParse(d.date).success && Number.isInteger(d.expectedMinutes) && d.expectedMinutes > 0
    && Number.isInteger(d.validMinutes) && d.validMinutes === d.expectedMinutes && !d.criticalGap && d.kwh !== null && Number.isFinite(d.kwh) && d.kwh >= 0;
  const unique = (days: ObservedDay[]) => days.filter(d => days.filter(x => x.date === d.date).length === 1);
  const baseline = unique(input.baseline).filter(valid);
  const observation = unique(input.observation).filter(valid).filter(d => baseline.filter(b => b.dayType === d.dayType && b.date < d.date).length >= 3);
  const minimum = Math.max(3, input.minimumDays ?? 3);
  if (observation.length < minimum || baseline.length < minimum) return { ready: false as const, comparableDays: observation.length, requiredDays: minimum, reason: "Waiting for complete comparable baseline and execution days." };
  let expectedKwh = 0; let actualKwh = 0;
  for (const d of observation) {
    const matches = baseline.filter(b => b.dayType === d.dayType && b.date < d.date);
    expectedKwh += matches.reduce((sum, b) => sum + b.kwh!, 0) / matches.length;
    actualKwh += d.kwh!;
  }
  return { ready: true as const, comparableDays: observation.length, requiredDays: minimum, expectedKwh, actualKwh,
    observedDifferenceKwh: expectedKwh - actualKwh, methodVersion: "matched-day-mean-v1",
    caveat: "Observed difference against comparable baseline days; not proof of causal savings." };
}

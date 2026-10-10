import type { EnergyIqProjectRegion } from "./energyiq-store.js";

/**
 * Location-based Scope 2 emissions: electricity drawn from the grid times the grid's average emissions per kWh.
 * A project can override the factor (for example with a newer official figure or a supplier-specific one);
 * otherwise the official grid factor for where the site is applies.
 */
export type EnergyIqGridKey = "SG" | "MY-PENINSULAR" | "MY-SABAH" | "MY-SARAWAK";

export type EnergyIqEmissionFactor = {
  /** Kilograms of CO2-equivalent per kWh drawn from the grid. */
  kgCo2ePerKwh: number;
  /** Year the factor describes. */
  year: number;
  /** Who published it, in words a sustainability report can cite. */
  source: string;
  /** True while the publisher still marks the figure provisional. */
  provisional?: boolean;
};

export type EnergyIqCarbonSetting = EnergyIqEmissionFactor & {
  /** "grid" uses the official factor for the site's region; "custom" is one the customer entered. */
  basis: "grid" | "custom";
  grid?: EnergyIqGridKey;
};

/**
 * Official grid emission factors, newest year first. Refresh when the publishers release a new year:
 * Singapore: Energy Market Authority, Singapore Energy Statistics (average grid emission factor, CO2).
 * Malaysia: Energy Commission (Suruhanjaya Tenaga), Grid Emission Factor in Malaysia; Sarawak from Sarawak Energy.
 */
export const GRID_EMISSION_FACTORS: Record<EnergyIqGridKey, EnergyIqEmissionFactor> = {
  "SG": { kgCo2ePerKwh: 0.402, year: 2024, source: "Energy Market Authority, Singapore Energy Statistics" },
  "MY-PENINSULAR": { kgCo2ePerKwh: 0.740, year: 2024, source: "Energy Commission Malaysia, Grid Emission Factor (Peninsular)", provisional: true },
  "MY-SABAH": { kgCo2ePerKwh: 0.539, year: 2024, source: "Energy Commission Malaysia, Grid Emission Factor (Sabah)", provisional: true },
  "MY-SARAWAK": { kgCo2ePerKwh: 0.199, year: 2024, source: "Energy Commission Malaysia, Grid Emission Factor (Sarawak)", provisional: true },
};

/** Labuan is supplied by the Sabah grid; every other state and federal territory by the Peninsular grid. */
export const gridForRegion = (region: EnergyIqProjectRegion | undefined): EnergyIqGridKey => {
  if (!region || region.country === "SG") return "SG";
  if (region.state === "SBH" || region.state === "LBN") return "MY-SABAH";
  if (region.state === "SWK") return "MY-SARAWAK";
  return "MY-PENINSULAR";
};

export const gridEmissionFactorFor = (region: EnergyIqProjectRegion | undefined): EnergyIqCarbonSetting => {
  const grid = gridForRegion(region);
  return { basis: "grid", grid, ...GRID_EMISSION_FACTORS[grid] };
};

/** Validates a factor someone typed. Above 2 kg/kWh is beyond any real grid, so it is almost certainly a unit mistake. */
export const normalizeCustomEmissionFactor = (input: { kgCo2ePerKwh: unknown; year?: unknown; source?: unknown }): EnergyIqCarbonSetting => {
  const factor = Number(input.kgCo2ePerKwh);
  if (!Number.isFinite(factor) || factor < 0 || factor > 2) throw new Error("ENERGYIQ_EMISSION_FACTOR_INVALID");
  const year = input.year === undefined || input.year === null || input.year === "" ? new Date().getUTCFullYear() : Number(input.year);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new Error("ENERGYIQ_EMISSION_FACTOR_YEAR_INVALID");
  const source = typeof input.source === "string" ? input.source.trim().slice(0, 200) : "";
  return { basis: "custom", kgCo2ePerKwh: Math.round(factor * 10000) / 10000, year, source: source || "Entered by customer" };
};

/** Kilograms of CO2e for an amount of grid electricity. */
export const emissionsKg = (kwh: number, setting: Pick<EnergyIqEmissionFactor, "kgCo2ePerKwh">): number =>
  kwh * setting.kgCo2ePerKwh;

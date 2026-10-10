import { describe, expect, it } from "vitest";
import { emissionsKg, gridEmissionFactorFor, gridForRegion, normalizeCustomEmissionFactor } from "./energyiq-carbon.js";

describe("EnergyIQ grid emission factors", () => {
  it("picks the grid a site draws from", () => {
    expect(gridForRegion(undefined)).toBe("SG");
    expect(gridForRegion({ country: "SG" })).toBe("SG");
    expect(gridForRegion({ country: "MY" })).toBe("MY-PENINSULAR");
    expect(gridForRegion({ country: "MY", state: "SGR" })).toBe("MY-PENINSULAR");
    expect(gridForRegion({ country: "MY", state: "LBN" })).toBe("MY-SABAH");
    expect(gridForRegion({ country: "MY", state: "SBH" })).toBe("MY-SABAH");
    expect(gridForRegion({ country: "MY", state: "SWK" })).toBe("MY-SARAWAK");
  });

  it("uses the official factor and turns kWh into kg CO2e", () => {
    const singapore = gridEmissionFactorFor({ country: "SG" });
    expect(singapore).toMatchObject({ basis: "grid", grid: "SG", kgCo2ePerKwh: 0.402, year: 2024 });
    expect(emissionsKg(1000, singapore)).toBeCloseTo(402);
    expect(gridEmissionFactorFor({ country: "MY", state: "JHR" }).kgCo2ePerKwh).toBe(0.74);
  });

  it("accepts a sensible custom factor and refuses a unit mistake", () => {
    expect(normalizeCustomEmissionFactor({ kgCo2ePerKwh: "0.41234", year: 2025, source: " Supplier letter " }))
      .toEqual({ basis: "custom", kgCo2ePerKwh: 0.4123, year: 2025, source: "Supplier letter" });
    expect(() => normalizeCustomEmissionFactor({ kgCo2ePerKwh: 402 })).toThrow("ENERGYIQ_EMISSION_FACTOR_INVALID");
    expect(() => normalizeCustomEmissionFactor({ kgCo2ePerKwh: 0.4, year: 1700 })).toThrow("ENERGYIQ_EMISSION_FACTOR_YEAR_INVALID");
  });
});

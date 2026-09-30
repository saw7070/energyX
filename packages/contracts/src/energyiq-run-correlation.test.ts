import { describe, expect, it } from "vitest";

import {
  ENERGY_RUN_CORRELATION_CONTRACT,
  parseEnergyRunCorrelation,
} from "./energyiq-run-correlation.js";

describe("EnergyIQ Run correlation contract", () => {
  it("accepts only an opaque UUID v4 envelope", () => {
    expect(parseEnergyRunCorrelation({
      contract: ENERGY_RUN_CORRELATION_CONTRACT,
      correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    })).toEqual({
      contract: ENERGY_RUN_CORRELATION_CONTRACT,
      correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    });
    expect(parseEnergyRunCorrelation({
      contract: ENERGY_RUN_CORRELATION_CONTRACT,
      correlation_id: "energy-run-correlation-12345678",
    })).toBeUndefined();
    expect(parseEnergyRunCorrelation({
      contract: ENERGY_RUN_CORRELATION_CONTRACT,
      correlation_id: "f47ac10b-58cc-1372-a567-0e02b2c3d479",
    })).toBeUndefined();
  });
});

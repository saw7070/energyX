import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_TIMEOUT_MS, reportTimeoutMsFromEnv } from "./pi-report-harness.js";

describe("advisor task time limit", () => {
  it("allows 40 minutes unless the server sets 5 to 120 minutes", () => {
    expect(DEFAULT_REPORT_TIMEOUT_MS).toBe(40 * 60_000);
    expect(reportTimeoutMsFromEnv({})).toBe(40 * 60_000);
    expect(reportTimeoutMsFromEnv({ ENERGYIQ_REPORT_AGENT_TIMEOUT_MINUTES: "60" })).toBe(60 * 60_000);
    for (const bad of ["4", "121", "30.5", "soon", ""]) {
      expect(reportTimeoutMsFromEnv({ ENERGYIQ_REPORT_AGENT_TIMEOUT_MINUTES: bad })).toBe(40 * 60_000);
    }
  });
});

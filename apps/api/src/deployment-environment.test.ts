import { describe, expect, it } from "vitest";
import { deploymentEnvironment, environmentSubject, stagingEmailAllowed } from "./deployment-environment.js";

describe("deployment environment", () => {
  it("reads ENERGYX_ENVIRONMENT, falling back to NODE_ENV", () => {
    expect(deploymentEnvironment({ ENERGYX_ENVIRONMENT: "Staging" })).toBe("staging");
    expect(deploymentEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(deploymentEnvironment({})).toBe("development");
  });

  it("only lets staging email allowlisted people and marks its subjects", () => {
    const staging = { ENERGYX_ENVIRONMENT: "staging", ENERGYX_STAGING_EMAIL_ALLOWLIST: "@energyx.test, qa@partner.test" };
    expect(stagingEmailAllowed("Someone@EnergyX.test", staging)).toBe(true);
    expect(stagingEmailAllowed("qa@partner.test", staging)).toBe(true);
    expect(stagingEmailAllowed("facilities@customer.test", staging)).toBe(false);
    expect(stagingEmailAllowed("anyone@customer.test", { ENERGYX_ENVIRONMENT: "staging" })).toBe(false);
    expect(stagingEmailAllowed("facilities@customer.test", { ENERGYX_ENVIRONMENT: "production" })).toBe(true);
    expect(environmentSubject("Weekly report", staging)).toBe("[Staging] Weekly report");
    expect(environmentSubject("Weekly report", {})).toBe("Weekly report");
  });
});

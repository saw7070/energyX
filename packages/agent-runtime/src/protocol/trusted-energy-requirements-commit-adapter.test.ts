import { describe, expect, it } from "vitest";

import { createUserAnalysisRequirements } from "./analysis-requirements.js";
import { adaptTrustedEnergyRequirementsCommit } from "./trusted-energy-requirements-commit-adapter.js";

const requirements = createUserAnalysisRequirements([
  {
    kind: "comparison",
    description: "Explain the period comparison",
    acceptanceCriteria: ["Evidence-backed comparison"]
  },
  {
    kind: "metric",
    description: "Report total electricity consumption",
    acceptanceCriteria: ["Exact kWh"],
    assertions: [{
      kind: "metric",
      description: "Validated usage",
      claimValues: [{
        name: "usage_kwh",
        field: "usage_kwh",
        unit: "kWh",
        required: true
      }]
    }]
  }
]);

describe("trusted Energy requirements commit adapter", () => {
  it("preserves declared values against each claim's own requirement registry", () => {
    const input = {
      claims: [
        {
          requirement_id: "R1",
          claim: "Usage increased from the previous period."
        },
        {
          requirement_id: "R2",
          claim: "Usage was 1,531.1683 kWh.",
          values: [
            { name: "usage_kwh", value: 1531.1683, unit: "kWh" }
          ]
        }
      ]
    };

    expect(adaptTrustedEnergyRequirementsCommit(input, requirements)).toEqual({
      claims: [
        {
          requirement_id: "R1",
          claim: "Usage increased from the previous period."
        },
        {
          requirement_id: "R2",
          claim: "Usage was 1,531.1683 kWh.",
          values: [{ name: "usage_kwh", value: 1531.1683, unit: "kWh" }]
        }
      ]
    });
    expect(input.claims[1]?.values).not.toBe(requirements[1]?.assertions[0]?.claimValues);
  });

  it.each([
    ["a claim with no value registry", "R1", "invented_change"],
    ["a different requirement's registry", "R2", "invented_total"]
  ])("rejects an unknown value name from %s", (_label, requirementId, valueName) => {
    expect(() => adaptTrustedEnergyRequirementsCommit({
      claims: [{
        requirement_id: requirementId,
        claim: "Invented value",
        values: [{ name: valueName, value: 1 }]
      }]
    }, requirements)).toThrow(`TRUSTED_ENERGY_REQUIREMENT_VALUE_NOT_FOUND:${requirementId}:${valueName}`);
  });

  it("fails closed when the model commits a requirement outside the server registry", () => {
    expect(() => adaptTrustedEnergyRequirementsCommit({
      claims: [{ requirement_id: "R99", claim: "Unsupported claim" }]
    }, requirements)).toThrow("TRUSTED_ENERGY_REQUIREMENT_NOT_FOUND:R99");
  });

  it("fails closed on cross-requirement Evidence references", () => {
    expect(() => adaptTrustedEnergyRequirementsCommit({
      claims: [{
        requirement_id: "R1",
        claim: "Comparison",
        evidence_requirement_ids: ["R99"]
      }]
    }, requirements)).toThrow("TRUSTED_ENERGY_EVIDENCE_REQUIREMENT_NOT_FOUND:R99");
  });
});

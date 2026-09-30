import type { RunAgentInput } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import {
  extractEffectiveRunConfig,
  extractEnergyQueryContextRequest,
  extractEnergySessionForkRequest,
  extractTrustedEnergyTextIntent,
} from "./run-input.js";

describe("extractEffectiveRunConfig protocol selection", () => {
  it("parses an explicit protocol identity from run_config", () => {
    const config = extractEffectiveRunConfig(createInput({
      protocol: { id: "data-analysis", version: "1" }
    }));

    expect(config.protocol).toEqual({ protocolId: "data-analysis", protocolVersion: "1" });
  });

  it("rejects a partially specified explicit protocol", () => {
    expect(() => extractEffectiveRunConfig(createInput({
      protocol: { id: "data-analysis" }
    }))).toThrow("INVALID_PROTOCOL_SELECTION");
  });
});

describe("trusted Energy text run input", () => {
  it("preserves Previous week for server-authoritative Energy context resolution", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Previous week",
      },
    };

    expect(extractEnergyQueryContextRequest(input)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Previous week",
    });
  });

  it("preserves Previous month for server-authoritative Energy context resolution", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Previous month",
      },
    };

    expect(extractEnergyQueryContextRequest(input)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Previous month",
    });
  });

  it("preserves every expected Snapshot, Release and revision pin for server-authoritative comparison", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Last 7 days",
        expectedDataSnapshotId: "snapshot-from-overview",
        expectedProjectReleaseId: "release-from-overview",
        expectedHierarchyRevisionId: "hierarchy-from-overview",
        expectedMeterMappingRevisionId: "mapping-from-overview",
        expectedMeterFormulaRevisionId: "formula-from-overview",
      },
    };

    expect(extractEnergyQueryContextRequest(input)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
      expectedDataSnapshotId: "snapshot-from-overview",
      expectedProjectReleaseId: "release-from-overview",
      expectedHierarchyRevisionId: "hierarchy-from-overview",
      expectedMeterMappingRevisionId: "mapping-from-overview",
      expectedMeterFormulaRevisionId: "formula-from-overview",
    });
  });

  it("rejects an explicitly unknown Period instead of silently using Last 30 days", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Previous fortnight",
      },
    };

    expect(() => extractEnergyQueryContextRequest(input)).toThrow("ENERGYIQ_PERIOD_INVALID");
  });

  it.each([
    ["expectedProjectReleaseId", 42],
    ["expectedHierarchyRevisionId", ""],
  ])("rejects a present-invalid exact identity pin %s", (field, value) => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        [field]: value,
      },
    };

    expect(() => extractEnergyQueryContextRequest(input))
      .toThrow("ENERGYIQ_EXPECTED_IDENTITY_INVALID");
  });

  it("accepts only an allowlisted intent from the untrusted host context", () => {
    const valid = createInput({});
    valid.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        trustedTextIntent: "period-usage-vs-previous"
      }
    };
    expect(extractTrustedEnergyTextIntent(valid)).toBe("period-usage-vs-previous");

    (valid.forwardedProps as Record<string, unknown>).externalContext = {
      source: "energyiq", projectId: "ngee-ann-polytechnic", trustedTextIntent: "free-form-sql"
    };
    expect(() => extractTrustedEnergyTextIntent(valid)).toThrow("TRUSTED_ENERGY_TEXT_INTENT_INVALID:free-form-sql");
  });

  it("extracts complete historical Session lineage without treating it as current Evidence", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "preschool-demo",
        forkedFromSessionId: "session-old",
        forkedFromRunId: "run-old",
        forkedFromFrom: "2026-05-31T16:00:00.000Z",
        forkedFromTo: "2026-06-30T16:00:00.000Z",
      },
    };

    expect(extractEnergySessionForkRequest(input)).toEqual({
      sourceSessionId: "session-old",
      sourceRunId: "run-old",
      sourceFrom: "2026-05-31T16:00:00.000Z",
      sourceTo: "2026-06-30T16:00:00.000Z",
    });
  });

  it("rejects partial historical Session lineage", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "preschool-demo",
        forkedFromSessionId: "session-old",
      },
    };

    expect(() => extractEnergySessionForkRequest(input))
      .toThrow("ENERGYIQ_SESSION_FORK_INVALID");
  });

  it("keeps unavailable continuation lineage as disclosure instead of an exact Run fork", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "preschool-demo",
        forkedFromSessionId: "session-old",
        forkedFromContextStatus: "unavailable",
        forkedFromUnavailableReason: "source-context-unavailable",
      },
    };

    expect(extractEnergySessionForkRequest(input)).toBeUndefined();
  });
});

const createInput = (runConfig: Record<string, unknown>): RunAgentInput => ({
  context: [],
  forwardedProps: { run_config: runConfig },
  messages: [],
  runId: "run-1",
  state: {},
  threadId: "thread-1",
  tools: []
});

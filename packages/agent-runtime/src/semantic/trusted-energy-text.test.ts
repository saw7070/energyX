import { describe, expect, it } from "vitest";

import {
  compileTrustedEnergyTextQuery,
  createTrustedEnergyAnswerEnvelope,
  TRUSTED_ENERGY_TEXT_INTENT_METRICS,
  TRUSTED_ENERGY_TEXT_INTENTS,
  validateTrustedEnergyTextResult
} from "./trusted-energy-text.js";

const snapshotId = "ngee-ann-golden-2026-06-16";

const trustedRequest = (
  intent: typeof TRUSTED_ENERGY_TEXT_INTENTS[number] = "period-usage-vs-previous",
  options: { supportingMetricIds?: string[] } = {}
) => {
  const primaryMetric = metricDefinition(TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent][0]!);
  const supportingMetrics = (options.supportingMetricIds ?? []).map(metricDefinition);
  const metrics = [primaryMetric, ...supportingMetrics];
  const evidenceRefs = metrics.map((metric) => ({
    id: `evidence:ngee-ann-golden:${metric.id}`,
    metricId: metric.id,
    metricRevisionId: metric.revisionId,
    dataSnapshotId: snapshotId
  }));

  return {
    kind: "trusted-energy-text" as const,
    intent,
    context: {
      sourcePin: {
        datasourceId: "energy-scope-deadbeef",
        datasourceRevision: "8",
        physicalSchema: { tables: [{ name: "energy_scope_deadbeef" }] }
      },
      project: { id: "ngee-ann-polytechnic", name: "Ngee Ann Polytechnic" },
      scope: { id: "project", name: "Ngee Ann Polytechnic", type: "project" },
      period: {
        label: "Custom",
        start: "2026-06-09T16:00:00.000Z",
        endExclusive: "2026-06-16T16:00:00.000Z",
        timezone: "Asia/Singapore"
      },
      metric: primaryMetric,
      supportingMetrics,
      dataSnapshotId: snapshotId,
      dataAsOf: "2026-06-16T16:00:00.000Z",
      evidenceRefs,
      expectedFacts: metrics.map((metric, index) => ({
        id: `fact:${metric.id}`,
        label: index === 0 ? "Selected period result" : `Supporting ${metric.label}`,
        metricId: metric.id,
        metricRevisionId: metric.revisionId,
        value: index === 0 ? 1531.1683 : 3050.1648,
        unit: metric.unit,
        tolerance: 0.0001,
        evidenceRefIds: [`evidence:ngee-ann-golden:${metric.id}`]
      }))
    }
  };
};

describe("trusted Energy text query contract", () => {
  it("compiles all ten approved Boss questions with immutable source, period and Metric pins", () => {
    expect(TRUSTED_ENERGY_TEXT_INTENTS).toHaveLength(10);

    const contracts = TRUSTED_ENERGY_TEXT_INTENTS.map((intent) =>
      compileTrustedEnergyTextQuery(trustedRequest(intent))
    );

    expect(contracts.map((contract) => contract.intent)).toEqual(TRUSTED_ENERGY_TEXT_INTENTS);
    expect(contracts.every((contract) => contract.source === "project-analysis-snapshot")).toBe(true);
    expect(contracts.every((contract) => contract.pins.sourcePin.datasourceRevision === "8")).toBe(true);
    expect(contracts.every((contract) =>
      contract.pins.sourcePin.physicalSchema.tables[0]?.name === "energy_scope_deadbeef")).toBe(true);
    expect(contracts.every((contract) => contract.pins.period.endExclusive === "2026-06-16T16:00:00.000Z"))
      .toBe(true);
    expect(contracts.every((contract) => contract.pins.period.timezone === "Asia/Singapore")).toBe(true);
    expect(new Set(contracts.map((contract) => contract.selector)).size).toBe(10);
    expect(Object.isFrozen(contracts[0]?.pins.sourcePin.physicalSchema.tables)).toBe(true);
  });

  it.each([
    ["peak-and-contributors", ["energy.total_usage_kwh"]],
    ["priority-actions", ["energy.off_hours_usage_kwh", "energy.peak_demand_kw"]]
  ] as const)("represents %s with a primary Metric and Evidence-bound supporting Metrics", (intent, supporting) => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest(intent, {
      supportingMetricIds: [...supporting]
    }));

    expect(contract.pins.metric.id).toBe(TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent][0]);
    expect(contract.pins.supportingMetrics.map((metric) => metric.id)).toEqual(supporting);
    expect(contract.pins.evidenceRefs.map((ref) => ref.metricId)).toEqual([
      contract.pins.metric.id,
      ...supporting
    ]);
    expect(contract.pins.expectedFacts.map((fact) => fact.metricId)).toEqual([
      contract.pins.metric.id,
      ...supporting
    ]);
  });

  it("rejects a primary or supporting Metric that is not allowlisted for the intent", () => {
    const request = trustedRequest("peak-and-contributors");
    expect(() => compileTrustedEnergyTextQuery({
      ...request,
      context: {
        ...request.context,
        metric: metricDefinition("energy.off_hours_share_pct")
      }
    })).toThrow("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:PRIMARY_METRIC_MISMATCH:peak-and-contributors");

    expect(() => compileTrustedEnergyTextQuery(trustedRequest("peak-and-contributors", {
      supportingMetricIds: ["energy.off_hours_share_pct"]
    }))).toThrow("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:SUPPORTING_METRIC_MISMATCH:peak-and-contributors");
  });

  it.each([
    ["missing Evidence", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: { ...request.context, evidenceRefs: [] }
    })],
    ["reversed Period", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: {
        ...request.context,
        period: {
          ...request.context.period,
          start: request.context.period.endExclusive,
          endExclusive: request.context.period.start
        }
      }
    })],
    ["unknown intent", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      intent: "free-form-sql"
    })],
    ["secret-bearing input", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: { ...request.context, apiKey: "sk-must-never-cross-the-adapter" }
    })],
    ["unpinned source revision", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: {
        ...request.context,
        sourcePin: { ...request.context.sourcePin, datasourceRevision: "unknown" }
      }
    })]
  ])("fails closed for %s", (_label, mutate) => {
    expect(() => compileTrustedEnergyTextQuery(mutate(trustedRequest()) as unknown)).toThrow(
      /TRUSTED_ENERGY_TEXT_REQUEST_INVALID/u
    );
  });

  it("rejects Evidence whose Metric revision or Snapshot drifts from its expected fact", () => {
    const request = trustedRequest();
    expect(() => compileTrustedEnergyTextQuery({
      ...request,
      context: {
        ...request.context,
        evidenceRefs: request.context.evidenceRefs.map((ref) => ({
          ...ref,
          metricRevisionId: "energy.total_usage_kwh@wrong"
        }))
      }
    })).toThrow("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:EVIDENCE_METRIC_REVISION_MISMATCH");
  });

  it("compares structured answer claims to trusted expected facts and exact Evidence refs", () => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest());
    const validResult = {
      dataSnapshotId: contract.pins.dataSnapshotId,
      claims: [{
        factId: contract.pins.expectedFacts[0]!.id,
        value: 1531.1683,
        evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
      }]
    };

    expect(validateTrustedEnergyTextResult(contract, {
      ...validResult,
      claims: [{ ...validResult.claims[0], value: 1531.16835 }]
    })).toMatchObject({
      ...validResult,
      validated: true
    });
    expect(() => validateTrustedEnergyTextResult(contract, {
      ...validResult,
      claims: [{ ...validResult.claims[0], value: 3050.1648 }]
    })).toThrow("TRUSTED_ENERGY_TEXT_CLAIM_VALUE_MISMATCH");
    expect(() => validateTrustedEnergyTextResult(contract, {
      ...validResult,
      claims: [{ ...validResult.claims[0], evidenceRefIds: ["evidence:invented"] }]
    })).toThrow("TRUSTED_ENERGY_TEXT_CLAIM_EVIDENCE_MISMATCH");
    expect(() => validateTrustedEnergyTextResult(contract, {
      ...validResult,
      body: "Arbitrary model prose that merely echoes metadata."
    })).toThrow("TRUSTED_ENERGY_TEXT_RESULT_INVALID");
  });

  it("renders answer prose only from validated structured claims", () => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest());
    const result = validateTrustedEnergyTextResult(contract, {
      dataSnapshotId: contract.pins.dataSnapshotId,
      claims: [{
        factId: contract.pins.expectedFacts[0]!.id,
        value: 1531.1683,
        evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
      }]
    });

    expect(createTrustedEnergyAnswerEnvelope(contract, result)).toBe([
      "Findings:",
      "- Selected period result: 1531.1683 kWh [Evidence: evidence:ngee-ann-golden:energy.total_usage_kwh]",
      "",
      "Scope: Ngee Ann Polytechnic",
      "Period: 2026-06-10 00:00 to 2026-06-17 00:00 (exclusive) · Asia/Singapore",
      "Metric: Electricity consumption (kWh) · energy.total_usage_kwh@1",
      "Data as of: 2026-06-17 00:00 · Asia/Singapore",
      "Evidence: evidence:ngee-ann-golden:energy.total_usage_kwh"
    ].join("\n"));
  });

  it("does not render a structured result that skipped validation", () => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest());
    expect(() => createTrustedEnergyAnswerEnvelope(contract, {
      dataSnapshotId: contract.pins.dataSnapshotId,
      claims: [],
      validated: false
    } as never)).toThrow("TRUSTED_ENERGY_TEXT_RESULT_NOT_VALIDATED");

    expect(() => createTrustedEnergyAnswerEnvelope(contract, {
      contractId: contract.id,
      dataSnapshotId: contract.pins.dataSnapshotId,
      claims: [{
        factId: contract.pins.expectedFacts[0]!.id,
        value: 999999,
        evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
      }],
      validated: true
    })).toThrow("TRUSTED_ENERGY_TEXT_CLAIM_VALUE_MISMATCH");
  });
});

const metricDefinition = (metricId: string) => {
  if (metricId === "energy.peak_demand_kw") {
    return { id: metricId, label: "Peak interval-average power", unit: "kW", revisionId: `${metricId}@1` };
  }
  if (metricId === "energy.usage_per_sqm") {
    return { id: metricId, label: "Energy use intensity", unit: "kWh/m虏", revisionId: `${metricId}@1` };
  }
  if (metricId === "energy.usage_per_person") {
    return { id: metricId, label: "Energy per person", unit: "kWh/person", revisionId: `${metricId}@1` };
  }
  if (metricId === "energy.off_hours_usage_kwh") {
    return { id: metricId, label: "Non-operating usage", unit: "kWh", revisionId: `${metricId}@1` };
  }
  if (metricId === "energy.off_hours_share_pct") {
    return { id: metricId, label: "Non-operating share", unit: "%", revisionId: `${metricId}@1` };
  }
  return { id: metricId, label: "Electricity consumption", unit: "kWh", revisionId: `${metricId}@1` };
};

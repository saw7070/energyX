import assert from "node:assert/strict";

import {
  compileTrustedEnergyTextQuery,
  createTrustedEnergyAnswerEnvelope,
  TRUSTED_ENERGY_TEXT_INTENT_METRICS,
  TRUSTED_ENERGY_TEXT_INTENTS,
  validateTrustedEnergyTextResult
} from "../packages/agent-runtime/dist/index.js";

const snapshotId = "ngee-ann-golden-2026-06-16";
const supportingByIntent = {
  "peak-and-contributors": ["energy.total_usage_kwh"],
  "priority-actions": ["energy.off_hours_usage_kwh", "energy.peak_demand_kw"]
};
const envelopes = [];

for (const intent of TRUSTED_ENERGY_TEXT_INTENTS) {
  const primaryMetricId = TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent][0];
  assert.ok(primaryMetricId, `No allowlisted primary Metric for ${intent}`);
  const metric = metricDefinition(primaryMetricId);
  const supportingMetrics = (supportingByIntent[intent] ?? []).map(metricDefinition);
  const metrics = [metric, ...supportingMetrics];
  const evidenceRefs = metrics.map((selectedMetric) => ({
    id: evidenceId(intent, selectedMetric.id),
    metricId: selectedMetric.id,
    metricRevisionId: selectedMetric.revisionId,
    dataSnapshotId: snapshotId
  }));
  const expectedFacts = metrics.map((selectedMetric, index) => ({
    id: `fact:${intent}:${selectedMetric.id}`,
    label: index === 0 ? `${intent} primary result` : `${intent} supporting result`,
    metricId: selectedMetric.id,
    metricRevisionId: selectedMetric.revisionId,
    value: 1000 + index,
    unit: selectedMetric.unit,
    evidenceRefIds: [evidenceId(intent, selectedMetric.id)]
  }));
  const contract = compileTrustedEnergyTextQuery({
    kind: "trusted-energy-text",
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
      metric,
      supportingMetrics,
      dataSnapshotId: snapshotId,
      dataAsOf: "2026-06-16T16:00:00.000Z",
      evidenceRefs,
      expectedFacts
    }
  });
  const result = validateTrustedEnergyTextResult(contract, {
    dataSnapshotId: snapshotId,
    claims: expectedFacts.map((fact) => ({
      factId: fact.id,
      value: fact.value,
      evidenceRefIds: fact.evidenceRefIds
    }))
  });
  const envelope = createTrustedEnergyAnswerEnvelope(contract, result);
  for (const label of ["Findings:", "Scope:", "Period:", "Metric:", "Data as of:", "Evidence:"]) {
    assert.ok(envelope.includes(label), `${intent} is missing ${label}`);
  }
  assert.ok(!envelope.includes("Arbitrary model prose"), `${intent} rendered unvalidated prose`);
  envelopes.push(envelope);
}

assert.equal(envelopes.length, 10);
assert.ok(envelopes[7]?.includes("Supporting Metrics:"), "Q8 did not exercise supporting Metrics");
assert.ok(envelopes[9]?.includes("Supporting Metrics:"), "Q10 did not exercise supporting Metrics");
console.log(
  "EnergyIQ trusted text offline eval OK: consecutive=10/10, "
  + "source=ProjectAnalysisSnapshot-contract, structuredClaims=validated, multiMetricIntents=2, "
  + "liveProviderCalls=0, liveAcceptance=not-evaluated."
);

function evidenceId(intent, metricId) {
  return `evidence:ngee-ann-golden:${intent}:${metricId}`;
}

function metricDefinition(metricId) {
  if (metricId === "energy.peak_demand_kw") {
    return { id: metricId, label: "Peak interval-average power", unit: "kW", revisionId: `${metricId}@1` };
  }
  if (metricId === "energy.usage_per_sqm") {
    return { id: metricId, label: "Energy use intensity", unit: "kWh/m²", revisionId: `${metricId}@1` };
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
}

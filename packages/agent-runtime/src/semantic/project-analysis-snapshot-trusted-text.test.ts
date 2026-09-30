import { describe, expect, it, vi } from "vitest";

import {
  executeTrustedEnergyText,
  projectAnalysisSnapshotToTrustedText,
  type ProjectAnalysisSnapshotTrustedTextInput
} from "./project-analysis-snapshot-trusted-text.js";
import { TRUSTED_ENERGY_TEXT_INTENTS } from "./trusted-energy-text.js";

describe("ProjectAnalysisSnapshot trusted text projection", () => {
  it("projects all ten intents from released Snapshot facts with fixed period, source and Evidence", () => {
    const contracts = TRUSTED_ENERGY_TEXT_INTENTS.map((intent) =>
      projectAnalysisSnapshotToTrustedText({ ...input(), intent }));

    expect(contracts).toHaveLength(10);
    expect(contracts.every((contract) => contract.pins.period.endExclusive === "2026-06-17T00:00:00.000Z"))
      .toBe(true);
    expect(contracts.every((contract) => contract.pins.period.timezone === "Asia/Singapore")).toBe(true);
    expect(contracts.every((contract) => contract.pins.sourcePin.datasourceRevision === "8")).toBe(true);
    expect(contracts.every((contract) => contract.pins.evidenceRefs.every((evidence) =>
      evidence.dataSnapshotId === "snapshot-1"))).toBe(true);
  });

  it("fails closed when the real Snapshot does not contain a required selector", () => {
    const request = input();
    delete request.snapshot.analysis.baseline;
    delete request.snapshot.analysis.dayTypeProfile;

    expect(() => projectAnalysisSnapshotToTrustedText({ ...request, intent: "historical-normal-level" }))
      .toThrow("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.baseline");
    expect(() => projectAnalysisSnapshotToTrustedText({ ...request, intent: "day-type-pattern" }))
      .toThrow("TRUSTED_ENERGY_SNAPSHOT_SELECTOR_UNAVAILABLE:analysis.dayTypeProfile");
  });

  it("executes one fake-provider attempt and renders only the canonical answer envelope", async () => {
    const contract = projectAnalysisSnapshotToTrustedText(input());
    const generate = vi.fn(async () => ({
      dataSnapshotId: contract.pins.dataSnapshotId,
      claims: contract.pins.expectedFacts.map((fact) => ({
        factId: fact.id,
        value: fact.value,
        evidenceRefIds: fact.evidenceRefIds
      }))
    }));

    const execution = await executeTrustedEnergyText({
      contract,
      provider: { id: "fake-deepseek-v4-flash", fallbackPolicy: "disabled", generate }
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(execution.answer).toContain("Scope: Ngee Ann Polytechnic");
    expect(execution.answer).toContain("Period: 2026-06-10 00:00 to 2026-06-17 08:00 (exclusive)");
    expect(execution.answer).toContain("Metric: Total energy use (kWh)");
    expect(execution.answer).toContain("Data as of:");
    expect(execution.answer).toContain("Evidence:");
  });

  it("does not invoke a provider unless fallback is disabled", async () => {
    const contract = projectAnalysisSnapshotToTrustedText(input());
    const generate = vi.fn();
    await expect(executeTrustedEnergyText({
      contract,
      provider: { id: "unsafe", fallbackPolicy: "enabled", generate } as never
    })).rejects.toThrow("TRUSTED_ENERGY_FALLBACK_MUST_BE_DISABLED");
    expect(generate).not.toHaveBeenCalled();
  });
});

const input = (): ProjectAnalysisSnapshotTrustedTextInput => {
  const metrics = [
    ["energy.total_usage_kwh", "Total energy use", "kWh"],
    ["energy.peak_demand_kw", "Peak interval-average power", "kW"],
    ["energy.usage_per_sqm", "Energy use intensity", "kWh/m2"],
    ["energy.usage_per_person", "Energy per person", "kWh/person"],
    ["energy.off_hours_usage_kwh", "Non-operating energy use", "kWh"],
    ["energy.off_hours_share_pct", "Non-operating share", "%"]
  ].map(([id, label, unit]) => ({ id: id!, label: label!, unit: unit!, revisionId: `${id}@1` }));
  return {
    intent: "period-usage-vs-previous",
    sourcePin: {
      datasourceId: "energy-scope-1",
      datasourceRevision: "8",
      physicalSchema: { tables: [{ name: "energy_scope_1" }] }
    },
    metrics,
    snapshot: {
      context: {
        projectId: "ngee-ann-polytechnic",
        projectName: "Ngee Ann Polytechnic",
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        period: "Custom",
        timezone: "Asia/Singapore",
        primaryPeriod: {
          start: "2026-06-09T16:00:00.000Z",
          endExclusive: "2026-06-17T00:00:00.000Z"
        }
      },
      projectRelease: { metricRevisionIds: metrics.map((metric) => metric.revisionId) },
      dataSnapshot: { id: "snapshot-1", lastSeenAt: "2026-06-16T16:00:00.000Z" },
      evidence: metrics.map((metric) => ({ id: `evidence:${metric.id}`, metricId: metric.revisionId })),
      findings: [{ code: "off-hours", title: "Reduce standby load", suggestedAction: "Inspect the top overnight circuits." }],
      analysis: {
        summary: { usageKwh: 1531.1, peakKw: 85.3, kwhPerSqm: 10.2, kwhPerPerson: 42.1 },
        comparison: { usageKwh: 1450, changeKwh: 81.1, changePct: 5.59 },
        baseline: { normalUsageKwh: 1475, deviationPct: 3.8 },
        dayTypeProfile: [{ dayType: "Workday", usageKwh: 1200 }, { dayType: "Weekend", usageKwh: 331.1 }],
        categories: [{ category: "aircon", usageKwh: 850, sharePct: 55.5 }],
        childScopes: [{ nodeId: "level-1", name: "Level 1", usageKwh: 900, kwhPerSqm: 11, kwhPerPerson: 45 }],
        topCircuits: [{ meterNodeId: "circuit-1", name: "AHU-1", usageKwh: 520 }],
        offHours: { status: "available", usageKwh: 320, sharePct: 20.9 }
      }
    }
  };
};

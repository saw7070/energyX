import { describe, expect, it } from "vitest";

import { EnergyQuerySemanticProvider } from "./energy-query-semantic-provider.js";
import { compileTrustedEnergyTextQuery } from "./trusted-energy-text.js";

describe("EnergyQuerySemanticProvider", () => {
  it("marks a server-scoped canonical fact view as authoritative live context", async () => {
    const provider = new EnergyQuerySemanticProvider({
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "l7-load-4",
      scopeName: "Office Load 4 Fan ISOL 1/2",
      scopeType: "circuit",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-09T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      dataSnapshotId: "snapshot-1",
      metricVersion: "energy-fact-v1"
    });

    const result = await provider.resolve({
      userId: "dev-user",
      workspaceId: "default",
      datasourceId: "scoped-view",
      datasourceRevision: "4",
      query: "total consumption",
      physicalSchema: { tables: [{ name: "energy_fact" }] }
    });

    expect(result).toMatchObject({
      provider: "energyiq",
      mode: "live",
      trust: "authoritative",
      warnings: [],
      snapshotId: "snapshot-1",
      datasourceRevision: "4",
      capabilities: ["physical-schema", "energy-query-context", "canonical-energy-fact"]
    });
  });

  it("projects the explicit trusted-text contract without falling back to generic semantics", async () => {
    const contract = compileTrustedEnergyTextQuery({
      kind: "trusted-energy-text",
      intent: "peak-and-contributors",
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
        metric: {
          id: "energy.peak_demand_kw",
          label: "Peak interval-average power",
          unit: "kW",
          revisionId: "energy.peak_demand_kw@1"
        },
        supportingMetrics: [{
          id: "energy.total_usage_kwh",
          label: "Electricity consumption",
          unit: "kWh",
          revisionId: "energy.total_usage_kwh@1"
        }],
        dataSnapshotId: "ngee-ann-golden-2026-06-16",
        dataAsOf: "2026-06-16T16:00:00.000Z",
        evidenceRefs: [
          {
            id: "evidence:ngee-ann-golden:peak",
            metricId: "energy.peak_demand_kw",
            metricRevisionId: "energy.peak_demand_kw@1",
            dataSnapshotId: "ngee-ann-golden-2026-06-16"
          },
          {
            id: "evidence:ngee-ann-golden:usage",
            metricId: "energy.total_usage_kwh",
            metricRevisionId: "energy.total_usage_kwh@1",
            dataSnapshotId: "ngee-ann-golden-2026-06-16"
          }
        ],
        expectedFacts: [
          {
            id: "fact:peak",
            label: "Peak demand",
            metricId: "energy.peak_demand_kw",
            metricRevisionId: "energy.peak_demand_kw@1",
            value: 252.1,
            unit: "kW",
            evidenceRefIds: ["evidence:ngee-ann-golden:peak"]
          },
          {
            id: "fact:usage",
            label: "Peak contributors usage",
            metricId: "energy.total_usage_kwh",
            metricRevisionId: "energy.total_usage_kwh@1",
            value: 1531.1683,
            unit: "kWh",
            evidenceRefIds: ["evidence:ngee-ann-golden:usage"]
          }
        ]
      }
    });
    const provider = new EnergyQuerySemanticProvider(contract);

    const result = await provider.resolve({
      userId: "fm-user",
      workspaceId: "default",
      datasourceId: "energy-scope-deadbeef",
      datasourceRevision: "8",
      query: "When was peak demand?",
      physicalSchema: { tables: [{ name: "energy_scope_deadbeef" }] }
    });

    expect(result).toMatchObject({
      provider: "energyiq",
      mode: "live",
      trust: "authoritative",
      snapshotId: "ngee-ann-golden-2026-06-16",
      capabilities: [
        "physical-schema",
        "energy-query-context",
        "canonical-energy-fact",
        "trusted-energy-text"
      ],
      value: {
        trustedTextQuery: {
          id: contract.id,
          intent: "peak-and-contributors",
          selector: "analysis.summary.peak+analysis.topCircuits"
        },
        metric: {
          id: "energy.peak_demand_kw",
          unit: "kW"
        },
        supportingMetrics: [{ id: "energy.total_usage_kwh", unit: "kWh" }],
        period: {
          from: "2026-06-09T16:00:00.000Z",
          to: "2026-06-16T16:00:00.000Z",
          endExclusive: true,
          timezone: "Asia/Singapore"
        }
      }
    });
    expect(result).not.toHaveProperty("fallbackReason");
  });

  it.each([
    ["datasource revision", { datasourceRevision: "9" }, "TRUSTED_ENERGY_DATASOURCE_REVISION_MISMATCH"],
    ["datasource identity", { datasourceId: "other-scope" }, "TRUSTED_ENERGY_DATASOURCE_MISMATCH"],
    ["physical schema", {
      physicalSchema: { tables: [{ name: "other_energy_scope" }] }
    }, "TRUSTED_ENERGY_PHYSICAL_SCHEMA_MISMATCH"]
  ])("rejects trusted-text %s drift before returning authoritative", async (_label, override, code) => {
    const contract = compileTrustedEnergyTextQuery({
      kind: "trusted-energy-text",
      intent: "period-usage-vs-previous",
      context: {
        sourcePin: {
          datasourceId: "energy-scope-deadbeef",
          datasourceRevision: "8",
          physicalSchema: { tables: [{ name: "energy_scope_deadbeef" }] }
        },
        project: { id: "p", name: "Project" },
        scope: { id: "p", name: "Project", type: "project" },
        period: {
          label: "Current",
          start: "2026-06-09T16:00:00.000Z",
          endExclusive: "2026-06-16T16:00:00.000Z",
          timezone: "Asia/Singapore"
        },
        metric: {
          id: "energy.total_usage_kwh",
          label: "Usage",
          unit: "kWh",
          revisionId: "energy.total_usage_kwh@1"
        },
        supportingMetrics: [],
        dataSnapshotId: "snapshot",
        dataAsOf: "2026-06-16T16:00:00.000Z",
        evidenceRefs: [{
          id: "evidence:usage",
          metricId: "energy.total_usage_kwh",
          metricRevisionId: "energy.total_usage_kwh@1",
          dataSnapshotId: "snapshot"
        }],
        expectedFacts: [{
          id: "fact:usage",
          label: "Usage",
          metricId: "energy.total_usage_kwh",
          metricRevisionId: "energy.total_usage_kwh@1",
          value: 100,
          unit: "kWh",
          evidenceRefIds: ["evidence:usage"]
        }]
      }
    });
    const provider = new EnergyQuerySemanticProvider(contract);

    await expect(provider.resolve({
      userId: "fm-user",
      workspaceId: "default",
      datasourceId: "energy-scope-deadbeef",
      datasourceRevision: "8",
      query: "usage",
      physicalSchema: { tables: [{ name: "energy_scope_deadbeef", columns: [] }] },
      ...override
    })).rejects.toThrow(code);
  });
});

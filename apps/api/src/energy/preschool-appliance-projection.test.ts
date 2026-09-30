import { describe, expect, it } from "vitest";

import type { ProjectAnalysisPayload } from "./project-analysis-metadata.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";
import { buildPreschoolApplianceProjection } from "./preschool-appliance-projection.js";

const aliases = [
  ["Aircon 1", "Aircon"],
  ["Aircon 2", "Aircon"],
  ["Heater", "Heater"],
  ["Kitchen Lighting", "Lighting"],
  ["Living Room Lighting", "Lighting"],
  ["Other Lighting3", "Lighting"],
  ["Kitchen Plug Load", "Plugload"],
  ["Living Area Plug Load", "Plugload"],
  ["Plug Load3", "Plugload"],
] as const;

describe("buildPreschoolApplianceProjection", () => {
  it("aggregates nine accepted Circuit aliases across 30 Centres and reconciles the Portfolio total", () => {
    const input = fixture();
    const result = buildPreschoolApplianceProjection(input);

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected available projection");
    expect(result.appliances).toHaveLength(9);
    expect(result.appliances[0]).toMatchObject({
      name: "Plug Load3",
      applianceGroup: "Plugload",
      usageKwh: 3_240,
      centreCount: 30,
    });
    expect(result.appliances.every((row) => row.sourceCircuitIds.length === 30)).toBe(true);
    expect(result.appliances.reduce((sum, row) => sum + row.usageKwh, 0)).toBe(result.totalKwh);
    expect(result.appliances.reduce((sum, row) => sum + row.sharePct, 0)).toBeCloseTo(100, 3);
    expect(result.evidence).toMatchObject({
      projectReleaseId: "preschool-release-v1",
      dataSnapshotId: "preschool-snapshot-v1",
      projectionRecipeId: "preschool-appliance-ranking-v1",
      sourceKind: "circuit",
      reconciliationGapKwh: 0,
    });
  });

  it("uses the published Circuit display alias without requiring the parent Scope id in the display name", () => {
    const input = fixture();
    for (const circuit of input.analysis.circuits) {
      circuit.name = circuit.name.slice(circuit.name.indexOf(":") + 1);
    }

    const result = buildPreschoolApplianceProjection(input);

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected available projection");
    expect(result.appliances).toHaveLength(9);
    expect(result.appliances.every((row) => row.centreCount === 30)).toBe(true);
  });

  it("fails closed when the published alias group is inconsistent", () => {
    const input = fixture();
    input.analysis.circuits[0]!.category = "light";

    expect(buildPreschoolApplianceProjection(input)).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED" },
    });
  });

  it("fails closed for an incomplete Snapshot", () => {
    const input = fixture();
    input.analysis.dataHealth.status = "partial";

    expect(buildPreschoolApplianceProjection(input)).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_APPLIANCE_SNAPSHOT_INCOMPLETE" },
    });
  });

  it("reuses the published Circuit-as-Appliance contract for a current rolling 28-day window", () => {
    const input = fixture();
    input.period = {
      start: "2026-05-10T16:00:00.000Z",
      endExclusive: "2026-06-07T16:00:00.000Z",
    };

    expect(buildPreschoolApplianceProjection(input)).toMatchObject({
      status: "available",
      period: input.period,
    });
  });
});

const fixture = (): Parameters<typeof buildPreschoolApplianceProjection>[0] => {
  const circuits = Array.from({ length: 30 }, (_, centreIndex) => aliases.map(([name, appliance], aliasIndex) => ({
    meterNodeId: `centre-${centreIndex + 1}-${aliasIndex + 1}`,
    scopeId: `circuit-${centreIndex + 1}-${aliasIndex + 1}`,
    parentScopeId: `centre-${centreIndex + 1}`,
    name: `centre-${centreIndex + 1}:${name}`,
    appliance,
    category: appliance === "Lighting" ? "light" : appliance === "Aircon" ? "aircon" : "load",
    meterRole: "component",
    includedInOfficialTotal: true,
    usageKwh: 100 + aliasIndex,
    sharePct: 0,
    comparison: { usageKwh: 0, changeKwh: 0, changePct: null },
    dataHealth: { coveragePct: 100, expectedMeterIntervalCount: 744, validIntervalCount: 744, qualityEventCount: 0 },
    peakKw: 1,
    qualityEventCount: 0,
  }))).flat();
  const totalKwh = circuits.reduce((sum, circuit) => sum + circuit.usageKwh, 0);
  const analysis = {
    context: {
      projectId: "preschool-demo",
      dataSnapshotId: "preschool-snapshot-v1",
      hierarchyRevisionId: "preschool-hierarchy-v1",
      meterMappingRevisionId: "preschool-mapping-v1",
    },
    summary: { usageKwh: totalKwh },
    circuits,
    dataHealth: { status: "complete" },
    provenance: {
      dataSnapshotId: "preschool-snapshot-v1",
      hierarchyRevisionId: "preschool-hierarchy-v1",
      meterMappingRevisionId: "preschool-mapping-v1",
      queryIds: ["scope_summary_v1", "meter_breakdown_v1"],
    },
  } as unknown as ProjectAnalysisPayload;
  const projectRelease = {
    id: "preschool-release-v1",
    projectId: "preschool-demo",
    hierarchyRevisionId: "preschool-hierarchy-v1",
    meterMappingRevisionId: "preschool-mapping-v1",
    renderer: { key: "preschool-overview" },
  } as unknown as PublishedProjectRelease;
  return {
    projectRelease,
    period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
    timezone: "Asia/Singapore",
    analysis,
  };
};

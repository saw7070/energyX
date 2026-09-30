import { describe, expect, it } from "vitest";

import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";
import { createPreschoolSectionInsightRuntime } from "./preschool-section-insight-runtime.js";

describe("Preschool Section Insight Runtime", () => {
  it("returns server-owned, Section-bound Evidence and audit identity for compare_centres", async () => {
    const runtime = createPreschoolSectionInsightRuntime({
      pack: centreBenchmarkPack(),
      runId: "section-run-1",
      createAuditId: () => "section-tool-audit-1",
    });

    const result = await runtime.invoke({
      toolName: "compare_centres",
      toolCallId: "tool-call-1",
      input: {
        centreScopeIds: ["centre-g", "centre-j"],
        dimensions: ["absoluteUsage", "floorAreaNormalised", "peopleNormalised"],
      },
    });

    expect(result).toEqual({
      contract: {
        id: "preschool-section-insight-tool-result",
        revision: "v1",
      },
      capability: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        readOnly: true,
      },
      binding: {
        workspaceId: "preschool-workspace",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        sectionId: "centre-benchmark",
        resource: "electricity",
        dataSnapshotId: "snapshot-current",
        projectReleaseId: "release-current",
        analysisPeriod: {
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-06-01T00:00:00.000Z",
        },
        modelProfileId: "workspace-default-model-profile",
        modelProfileRevision: 1,
      },
      audit: {
        auditId: "section-tool-audit-1",
        runId: "section-run-1",
        toolCallId: "tool-call-1",
        toolName: "compare_centres",
        sourcePackRevision: "preschool-section-pack-v2",
        evidenceRefs: [
          "evidence:centre-benchmark:g",
          "query:benchmark-current",
          "evidence:centre-benchmark:j",
        ],
      },
      evidence: [{
        id: "evidence:centre-benchmark:g",
        label: "Centre G benchmark",
        value: {
          centreCode: "G",
          metrics: {
            absoluteUsage: { value: 120, unit: "kWh", rank: { position: 1, outOf: 2 } },
            floorAreaNormalised: { value: 12, unit: "kWh/m2/year", rank: { position: 1, outOf: 2 } },
            peopleNormalised: { value: 22, unit: "kWh/person/month", rank: { position: 1, outOf: 2 } },
          },
        },
        unit: "kWh, kWh/m2/year, kWh/person/month",
        entityRefs: ["centre-g"],
        evidenceRefs: ["evidence:centre-benchmark:g", "query:benchmark-current"],
      }, {
        id: "evidence:centre-benchmark:j",
        label: "Centre J benchmark",
        value: {
          centreCode: "J",
          metrics: {
            absoluteUsage: { value: 100, unit: "kWh", rank: { position: 2, outOf: 2 } },
            floorAreaNormalised: { value: 10, unit: "kWh/m2/year", rank: { position: 2, outOf: 2 } },
            peopleNormalised: { value: 20, unit: "kWh/person/month", rank: { position: 2, outOf: 2 } },
          },
        },
        unit: "kWh, kWh/m2/year, kWh/person/month",
        entityRefs: ["centre-j"],
        evidenceRefs: ["evidence:centre-benchmark:j", "query:benchmark-current"],
      }],
      statements: [{
        kind: "confirmed-fact",
        text: "Centre G benchmark",
        evidenceRefs: ["evidence:centre-benchmark:g", "query:benchmark-current"],
      }, {
        kind: "confirmed-fact",
        text: "Centre J benchmark",
        evidenceRefs: ["evidence:centre-benchmark:j", "query:benchmark-current"],
      }],
      missingEvidence: [],
    });
    expect(result.binding).not.toHaveProperty("dataCutoff");
  });

  it("projects compare_centres Evidence to only the requested dimensions", async () => {
    const runtime = createPreschoolSectionInsightRuntime({
      pack: centreBenchmarkPack(),
      runId: "section-run-projection",
      createAuditId: () => "section-tool-audit-projection",
    });

    const result = await runtime.invoke({
      toolName: "compare_centres",
      toolCallId: "tool-call-projection",
      input: {
        centreScopeIds: ["centre-g"],
        dimensions: ["absoluteUsage"],
      },
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.value).toEqual({
      centreCode: "G",
      metrics: {
        absoluteUsage: { value: 120, unit: "kWh", rank: { position: 1, outOf: 2 } },
      },
    });
  });

  it.each([
    {
      toolName: "inspect_time_pattern" as const,
      pack: sectionPack("standby-wastage", {
        id: "preschool:snapshot-current:section-2-standby:centre:g",
        label: "Published closed-hour pattern",
        value: {
          centreCode: "G",
          spikeCount: 2,
          worstSpike: { localDate: "2026-05-12", localHour: 22, usageKwh: 14.2 },
        },
        unit: "kWh",
        entityRefs: ["centre-g"],
        evidenceRefs: ["preschool:snapshot-current:section-2-standby:centre:g", "query:time-current"],
      }),
      input: { evidenceIds: ["preschool:snapshot-current:section-2-standby:centre:g"] },
      expectedEvidenceId: "preschool:snapshot-current:section-2-standby:centre:g",
    },
    {
      toolName: "inspect_load_composition" as const,
      pack: sectionPack("operating-behaviour", {
        id: "preschool:snapshot-current:section-3-operating:appliance:1",
        label: "Published operating load composition",
        value: {
          name: "Air conditioning",
          applianceGroup: "cooling",
          usageKwh: 620,
          sharePct: 62,
          centreCount: 2,
        },
        unit: "kWh",
        entityRefs: ["air-conditioning"],
        evidenceRefs: ["preschool:snapshot-current:section-3-operating:appliance:1", "query:composition-current"],
      }),
      input: { evidenceIds: ["preschool:snapshot-current:section-3-operating:appliance:1"] },
      expectedEvidenceId: "preschool:snapshot-current:section-3-operating:appliance:1",
    },
  ])("returns only Pack Evidence for $toolName", async ({ toolName, pack, input, expectedEvidenceId }) => {
    const before = structuredClone(pack);
    const runtime = createPreschoolSectionInsightRuntime({
      pack,
      runId: `run:${toolName}`,
      createAuditId: () => `audit:${toolName}`,
    });

    const result = await runtime.invoke({ toolName, toolCallId: `call:${toolName}`, input });

    expect(result).toMatchObject({
      capability: { revision: "scoped-read-only-v1", mode: "scoped-read-only", readOnly: true },
      binding: { sectionId: pack.sectionId, resource: "electricity" },
      audit: { toolName, sourcePackRevision: "preschool-section-pack-v2" },
      evidence: [{ id: expectedEvidenceId }],
      statements: [{ kind: "confirmed-fact" }],
    });
    expect(pack).toEqual(before);
    expect(Object.keys(runtime)).toEqual(["invoke"]);
  });

  it("rejects cross-calling time-pattern and load-composition Evidence", async () => {
    const timeEvidence = {
      id: "preschool:snapshot-current:section-3-operating:centre:g",
      label: "Published operating-hour spike",
      value: {
        centreCode: "G",
        spikeCount: 2,
        worstSpike: { localDate: "2026-05-12", localHour: 10, usageKwh: 14.2 },
      },
      unit: "kWh",
      entityRefs: ["centre-g"],
      evidenceRefs: ["preschool:snapshot-current:section-3-operating:centre:g"],
    };
    const loadEvidence = {
      id: "preschool:snapshot-current:section-3-operating:appliance:1",
      label: "Published operating load composition",
      value: {
        name: "Air conditioning",
        applianceGroup: "cooling",
        usageKwh: 620,
        sharePct: 62,
        centreCount: 2,
      },
      unit: "kWh",
      entityRefs: ["air-conditioning"],
      evidenceRefs: ["preschool:snapshot-current:section-3-operating:appliance:1"],
    };
    const pack = sectionPack("operating-behaviour", timeEvidence);
    pack.evidence.push(loadEvidence);
    const runtime = createPreschoolSectionInsightRuntime({
      pack,
      runId: "run:semantic-boundary",
      createAuditId: (() => {
        let sequence = 0;
        return () => `audit:semantic-boundary:${sequence += 1}`;
      })(),
    });

    await expect(runtime.invoke({
      toolName: "inspect_time_pattern",
      toolCallId: "call:time-on-load",
      input: { evidenceIds: [loadEvidence.id] },
    })).rejects.toThrow("PRESCHOOL_SECTION_INSIGHT_EVIDENCE_KIND_NOT_ALLOWED");
    await expect(runtime.invoke({
      toolName: "inspect_load_composition",
      toolCallId: "call:load-on-time",
      input: { evidenceIds: [timeEvidence.id] },
    })).rejects.toThrow("PRESCHOOL_SECTION_INSIGHT_EVIDENCE_KIND_NOT_ALLOWED");
  });

  it("returns only allowlisted related Section signals with explicit provenance", async () => {
    const pack = sectionPack("planning-outlook", {
      id: "evidence:planning:current",
      label: "Current outlook",
      value: { pacePct: 104 },
      unit: "%",
      entityRefs: ["preschool-project"],
      evidenceRefs: ["evidence:planning:current", "query:planning-current"],
    });
    pack.crossSectionIndex = [{
      signalId: "signal:closed-hours",
      relatedSectionId: "standby-wastage",
      kind: "attention",
      label: "Closed-hour load remains relevant",
      priority: 2,
      entityRefs: ["centre-g"],
      evidenceRefs: ["evidence:time:closed-hours"],
      limitations: ["Equipment state is unavailable."],
    }];
    const runtime = createPreschoolSectionInsightRuntime({
      pack,
      runId: "run:related",
      createAuditId: () => "audit:related",
    });

    const result = await runtime.invoke({
      toolName: "inspect_related_section_signals",
      toolCallId: "call:related",
      input: { signalIds: ["signal:closed-hours"] },
    });

    expect(result).toMatchObject({
      binding: { sectionId: "planning-outlook", dataSnapshotId: "snapshot-current" },
      audit: { evidenceRefs: ["evidence:time:closed-hours"] },
      relatedSignals: [{
        signalId: "signal:closed-hours",
        relatedSectionId: "standby-wastage",
        evidenceRefs: ["evidence:time:closed-hours"],
      }],
      statements: [{ kind: "confirmed-fact", evidenceRefs: ["evidence:time:closed-hours"] }],
    });
  });

  it.each([
    {
      name: "arbitrary SQL",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:sql", input: { evidenceIds: ["evidence:time:closed-hours"], sql: "SELECT * FROM facts" } },
    },
    {
      name: "network URL",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:url", input: { evidenceIds: ["evidence:time:closed-hours"], url: "https://example.test" } },
    },
    {
      name: "browser-forged Snapshot identity",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:snapshot", input: { evidenceIds: ["evidence:time:closed-hours"], dataSnapshotId: "snapshot-other" } },
    },
    {
      name: "browser-forged tenant identity",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:tenant", input: { evidenceIds: ["evidence:time:closed-hours"], workspaceId: "workspace-other" } },
    },
    {
      name: "browser-forged project identity",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:project", input: { evidenceIds: ["evidence:time:closed-hours"], projectId: "project-other" } },
    },
    {
      name: "browser-forged analysis period",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:period", input: { evidenceIds: ["evidence:time:closed-hours"], analysisPeriod: { from: "2025-01-01", to: "2025-02-01" } } },
    },
    {
      name: "an unknown Evidence ID",
      invoke: { toolName: "inspect_time_pattern", toolCallId: "call:unknown", input: { evidenceIds: ["evidence:unknown"] } },
    },
    {
      name: "a capability outside its Section",
      invoke: { toolName: "compare_centres", toolCallId: "call:section", input: { centreScopeIds: ["centre-g"], dimensions: ["absoluteUsage"] } },
    },
  ])("rejects $name without exposing a write, network or arbitrary-query seam", async ({ invoke }) => {
    const runtime = createPreschoolSectionInsightRuntime({
      pack: sectionPack("standby-wastage", {
        id: "evidence:time:closed-hours",
        label: "Published closed-hour pattern",
        value: {
          centreCode: "G",
          spikeCount: 2,
          worstSpike: { localDate: "2026-05-12", localHour: 22, usageKwh: 14.2 },
        },
        unit: "kWh",
        entityRefs: ["centre-g"],
        evidenceRefs: ["evidence:time:closed-hours", "query:time-current"],
      }),
      runId: "run:safety",
      createAuditId: () => "audit:safety",
    });

    await expect(runtime.invoke(invoke as never)).rejects.toThrow(/PRESCHOOL_SECTION_INSIGHT_/u);
  });

  it("rejects unknown Centre entities and duplicate tool/audit identities", async () => {
    const unknownEntityRuntime = createPreschoolSectionInsightRuntime({
      pack: centreBenchmarkPack(),
      runId: "run:unknown-centre",
      createAuditId: () => "audit:unknown-centre",
    });
    await expect(unknownEntityRuntime.invoke({
      toolName: "compare_centres",
      toolCallId: "call:unknown-centre",
      input: { centreScopeIds: ["centre-unknown"], dimensions: ["absoluteUsage"] },
    })).rejects.toThrow("PRESCHOOL_SECTION_INSIGHT_ENTITY_NOT_FOUND");

    const replayRuntime = createPreschoolSectionInsightRuntime({
      pack: sectionPack("standby-wastage", {
        id: "evidence:time:closed-hours",
        label: "Published closed-hour pattern",
        value: {
          centreCode: "G",
          spikeCount: 2,
          worstSpike: { localDate: "2026-05-12", localHour: 22, usageKwh: 14.2 },
        },
        unit: "kWh",
        entityRefs: ["centre-g"],
        evidenceRefs: ["evidence:time:closed-hours", "query:time-current"],
      }),
      runId: "run:replay",
      createAuditId: () => "audit:replay",
    });
    const invocation = {
      toolName: "inspect_time_pattern" as const,
      toolCallId: "call:replay",
      input: { evidenceIds: ["evidence:time:closed-hours"] },
    };
    await replayRuntime.invoke(invocation);
    await expect(replayRuntime.invoke(invocation)).rejects.toThrow("PRESCHOOL_SECTION_INSIGHT_TOOL_CALL_REPLAYED");

    const duplicateAuditRuntime = createPreschoolSectionInsightRuntime({
      pack: sectionPack("standby-wastage", {
        id: "evidence:time:closed-hours",
        label: "Published closed-hour pattern",
        value: {
          centreCode: "G",
          spikeCount: 2,
          worstSpike: { localDate: "2026-05-12", localHour: 22, usageKwh: 14.2 },
        },
        unit: "kWh",
        entityRefs: ["centre-g"],
        evidenceRefs: ["evidence:time:closed-hours", "query:time-current"],
      }),
      runId: "run:duplicate-audit",
      createAuditId: () => "audit:duplicate",
    });
    await duplicateAuditRuntime.invoke({ ...invocation, toolCallId: "call:audit-1" });
    await expect(duplicateAuditRuntime.invoke({ ...invocation, toolCallId: "call:audit-2" }))
      .rejects.toThrow("PRESCHOOL_SECTION_INSIGHT_AUDIT_IDENTITY_INVALID");
  });
});

const sectionPack = (
  sectionId: PreschoolSectionPackV2["sectionId"],
  evidence: PreschoolSectionPackV2["evidence"][number],
): PreschoolSectionPackV2 => ({
  ...centreBenchmarkPack(),
  sectionId,
  analysisGoal: `Inspect ${sectionId}.`,
  evidence: [evidence],
  crossSectionIndex: [],
  capabilities: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionId === "centre-benchmark"
      ? ["compare_centres", "inspect_related_section_signals"]
      : sectionId === "standby-wastage" || sectionId === "operating-behaviour"
        ? ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"]
        : ["inspect_related_section_signals"],
  },
});

const centreBenchmarkPack = (): PreschoolSectionPackV2 => ({
  contract: { id: "preschool-section-pack", revision: "preschool-section-pack-v2" },
  sectionId: "centre-benchmark",
  audience: "non-technical energy manager",
  analysisGoal: "Identify decision-relevant peer patterns.",
  binding: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriod: {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
    },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  },
  evidence: [{
    id: "evidence:centre-benchmark:g",
    label: "Centre G benchmark",
    value: {
      centreCode: "G",
      metrics: {
        absoluteUsage: { value: 120, unit: "kWh", rank: { position: 1, outOf: 2 } },
        floorAreaNormalised: { value: 12, unit: "kWh/m2/year", rank: { position: 1, outOf: 2 } },
        peopleNormalised: { value: 22, unit: "kWh/person/month", rank: { position: 1, outOf: 2 } },
      },
    },
    unit: "kWh, kWh/m2/year, kWh/person/month",
    entityRefs: ["centre-g"],
    evidenceRefs: ["evidence:centre-benchmark:g", "query:benchmark-current"],
  }, {
    id: "evidence:centre-benchmark:j",
    label: "Centre J benchmark",
    value: {
      centreCode: "J",
      metrics: {
        absoluteUsage: { value: 100, unit: "kWh", rank: { position: 2, outOf: 2 } },
        floorAreaNormalised: { value: 10, unit: "kWh/m2/year", rank: { position: 2, outOf: 2 } },
        peopleNormalised: { value: 20, unit: "kWh/person/month", rank: { position: 2, outOf: 2 } },
      },
    },
    unit: "kWh, kWh/m2/year, kWh/person/month",
    entityRefs: ["centre-j"],
    evidenceRefs: ["evidence:centre-benchmark:j", "query:benchmark-current"],
  }],
  alreadyPresentedFacts: [],
  crossSectionIndex: [],
  dataQuality: {
    status: "complete",
    coveragePct: 100,
    expectedMeterIntervalCount: 2,
    validIntervalCount: 2,
    qualityEventCount: 0,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    importBatchIds: ["batch-current"],
  },
  limitations: [],
  missingEvidence: [],
  capabilities: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: ["compare_centres", "inspect_related_section_signals"],
  },
});

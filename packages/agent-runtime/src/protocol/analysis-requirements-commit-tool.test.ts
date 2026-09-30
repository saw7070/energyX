import { describe, expect, it, vi } from "vitest";

import { createUserAnalysisRequirements } from "./analysis-requirements.js";
import {
  buildAnalysisRequirementsCommitInputSchema,
  createAnalysisRequirementsCommitTool
} from "./analysis-requirements-commit-tool.js";
import type { AnalysisContextEvidenceCatalog } from "./analysis-context-evidence.js";

const requirements = createUserAnalysisRequirements([{
  kind: "metric",
  description: "Report total electricity consumption",
  acceptanceCriteria: ["Exact kWh"],
  assertions: [{
    kind: "metric",
    description: "Validated usage",
    claimValues: [{ name: "usage_kwh", field: "usage_kwh", unit: "kWh", required: true }]
  }]
}]);

const mixedRequirements = createUserAnalysisRequirements([
  {
    kind: "metric",
    description: "Report total electricity consumption",
    acceptanceCriteria: ["Exact kWh"],
    assertions: [{
      kind: "metric",
      description: "Validated usage",
      claimValues: [{ name: "usage_kwh", field: "usage_kwh", unit: "kWh", required: true }]
    }]
  },
  {
    kind: "metric",
    description: "Report centre count",
    acceptanceCriteria: ["Exact count"],
    assertions: [{
      kind: "metric",
      description: "Validated count",
      claimValues: [{ name: "centre_count", field: "centre_count", unit: "count", required: true }]
    }]
  }
]);

describe("analysis requirements commit tool", () => {
  it("removes values from the model schema when no requirement declares claim values", () => {
    const manualRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "Count Active Aging Center facilities",
      acceptanceCriteria: ["Return the exact count"]
    }]);

    const schema = buildAnalysisRequirementsCommitInputSchema(manualRequirements);

    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "There are 8 Active Aging Center facilities",
        values: [{ name: "active_aging_center_count", value: 8, unit: "count" }]
      }]
    }).success).toBe(false);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "There are 8 Active Aging Center facilities"
      }]
    }).success).toBe(true);
  });

  it("exposes only server-declared requirement ids and value names", () => {
    const schema = buildAnalysisRequirementsCommitInputSchema(requirements);

    expect(schema.safeParse({
      claims: [{
        requirement_id: "R99",
        claim: "Unknown requirement",
        values: [{ name: "usage_kwh", value: 1, unit: "kWh" }]
      }]
    }).success).toBe(false);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "Invented value name",
        values: [{ name: "active_aging_center_count", value: 8, unit: "count" }]
      }]
    }).success).toBe(false);
  });

  it("keeps server-owned Context Evidence fact ids out of the model schema", () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "What is Centre A EUI?",
      acceptanceCriteria: ["Use released EUI"],
    }]);
    contextRequirements[0]!.contextEvidence = { mode: "sufficient", factIds: ["centre-a.eui"] };
    const schema = buildAnalysisRequirementsCommitInputSchema(contextRequirements, {
      contract: "analysis-context-evidence@1",
      sourceId: "snapshot-source",
      pins: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        scopeId: "project",
        dataSnapshotId: "snapshot-1",
        dataCutoff: "2026-06-01T00:00:00.000Z",
        projectReleaseId: "release-1",
        metricVersion: "metrics-1",
      },
      facts: [{
        id: "centre-a.eui",
        label: "Centre A EUI",
        metricId: "preschool.benchmark.eui",
        value: 13.62,
        unit: "kWh/m2/year",
        status: "provisional",
        evidenceRefs: ["evidence-eui"],
        dimensions: { scopeId: "centre-a" },
      }],
    });

    expect(schema.safeParse({ claims: [{ requirement_id: "R1", claim: "Centre A EUI is 13.62." }] }).success)
      .toBe(true);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "Centre A EUI is 13.62.",
        context_fact_ids: ["centre-a.eui"],
      }],
    }).success).toBe(false);
  });

  it("keeps per-requirement value validation inside the controlled observation boundary", async () => {
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: mixedRequirements,
      executeAction,
      runId: "run-1",
      segmentId: "segment-1",
      trustedEnergy: true
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "A count incorrectly attached to the usage requirement",
      values: [{ name: "centre_count", value: 8, unit: "count" }]
    }] }, {
      agent: { toolCallId: "call-cross-requirement-value" }
    } as never);

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      error: {
        code: "TRUSTED_ENERGY_REQUIREMENT_VALUE_NOT_FOUND",
        category: "validation",
        executionStatus: "failed",
        retryable: false
      },
      recovery: {
        strategy: "refresh_and_replan",
        avoid: [expect.stringContaining("Do not repeat analysis_requirements_commit unchanged")]
      }
    });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("injects late-grounded values only from an evidenced query result", async () => {
    const initialRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "Count Active Aging Center facilities",
      acceptanceCriteria: ["Return the exact count"],
    }]);
    const groundedRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "Count Active Aging Center facilities",
      acceptanceCriteria: ["Return the exact count"],
      assertions: [{
        kind: "metric",
        description: "Validated count",
        claimValues: [{ name: "centre_count", field: "centre_count", required: true }],
      }],
    }]);
    const executeAction = vi.fn(async (action) => ({ observation: action.input }));
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: initialRequirements,
      executeAction,
      getAnalysisRequirements: () => groundedRequirements,
      getVerifiedRequirementValues: (requirementId) => requirementId === "R1"
        ? [{ name: "centre_count", value: 8, tolerance: 0, assertionId: "R1.A1" }]
        : [],
      runId: "run-late-grounding",
      segmentId: "segment-late-grounding",
      trustedEnergy: true,
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "There are 8 Active Aging Center facilities.",
    }] }, { agent: { toolCallId: "call-late-grounding" } } as never);

    expect(result).toMatchObject({ claims: [{
      requirement_id: "R1",
      values: [{ name: "centre_count", value: 8 }],
    }] });
    expect(executeAction).toHaveBeenCalledOnce();
    expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({
      actionName: "analysis.requirements.commit",
      input: expect.objectContaining({ claims: [expect.objectContaining({
        values: [{ name: "centre_count", value: 8 }],
      })] }),
    }));
  });

  it("automatically binds authorized sufficient Context Evidence when fact ids are omitted", async () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "What is Centre A EUI?",
      acceptanceCriteria: ["Use released EUI"],
    }]);
    contextRequirements[0]!.contextEvidence = {
      mode: "sufficient",
      factIds: ["centre-a.eui"],
    };
    const catalog: AnalysisContextEvidenceCatalog = {
      contract: "analysis-context-evidence@1",
      sourceId: "project-analysis-snapshot:project-1:snapshot-1",
      pins: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        scopeId: "project",
        dataSnapshotId: "snapshot-1",
        dataCutoff: "2026-06-01T00:00:00.000Z",
        projectReleaseId: "release-1",
        metricVersion: "metrics-1",
      },
      facts: [{
        id: "centre-a.eui",
        label: "Centre A EUI",
        metricId: "preschool.benchmark.eui",
        value: 13.62,
        unit: "kWh/m2/year",
        status: "provisional",
        evidenceRefs: ["evidence-eui"],
        dimensions: { scopeId: "centre-a" },
      }],
    };
    const executeAction = vi.fn(async (action) => ({ observation: action.input }));
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: contextRequirements,
      contextEvidenceCatalog: catalog,
      executeAction,
      getAnalysisRequirements: () => contextRequirements,
      runId: "run-context",
      segmentId: "segment-context",
      trustedEnergy: true,
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Centre A released EUI is 13.62 kWh/m2/year and is provisional.",
    }] }, { agent: { toolCallId: "call-context" } } as never);

    expect(result).toMatchObject({ claims: [{
      requirement_id: "R1",
      values: [{ name: "centre-a.eui", value: 13.62, unit: "kWh/m2/year" }],
      evidence_refs: ["evidence-eui"],
    }] });
    expect(executeAction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      actionName: "analysis.context.evidence.bind",
      input: expect.objectContaining({
        fact_ids: ["centre-a.eui"],
        completion_mode: "sufficient",
      }),
    }));
    expect(executeAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actionName: "analysis.requirements.commit",
    }));
  });

  it("does not let query evidence replace required released Context Evidence", async () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "What is Centre A EUI?",
      acceptanceCriteria: ["Use released EUI"],
    }]);
    contextRequirements[0]!.contextEvidence = {
      mode: "sufficient",
      factIds: ["centre-a.eui", "cohort.eui.p50"],
    };
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: contextRequirements,
      contextEvidenceCatalog: {
        contract: "analysis-context-evidence@1",
        sourceId: "snapshot-source",
        pins: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          dataCutoff: "2026-06-01T00:00:00.000Z",
          projectReleaseId: "release-1",
          metricVersion: "metrics-1",
        },
        facts: [],
      },
      executeAction,
      getAnalysisRequirements: () => contextRequirements,
      getVerifiedRequirementValues: () => [{
        name: "query-only-value",
        value: 13.62,
        tolerance: 0.0001,
        assertionId: "QUERY:R1",
      }],
      runId: "run-context-required",
      segmentId: "segment-context-required",
      trustedEnergy: true,
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Centre A EUI is 13.62.",
    }] }, { agent: { toolCallId: "call-context-required" } } as never);

    expect(result).toMatchObject({ ok: false, isError: true });
    expect(JSON.stringify(result)).toContain("ANALYSIS_CONTEXT_EVIDENCE_FACT_NOT_FOUND:centre-a.eui");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("auto-binds supporting Context Evidence only after Query Evidence is complete", async () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "decision",
      description: "Which centre should I investigate first?",
      acceptanceCriteria: ["Use released priority and investigate a driver"],
    }]);
    contextRequirements[0]!.contextEvidence = {
      mode: "supporting",
      factIds: ["centre-g.priority"],
    };
    const executeAction = vi.fn(async (action) => ({ observation: action.input }));
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: contextRequirements,
      contextEvidenceCatalog: {
        contract: "analysis-context-evidence@1",
        sourceId: "snapshot-source",
        pins: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          dataCutoff: "2026-06-01T00:00:00.000Z",
          projectReleaseId: "release-1",
          metricVersion: "metrics-1",
        },
        facts: [{
          id: "centre-g.priority",
          label: "Centre G priority",
          metricId: "preschool.benchmark.priority",
          value: true,
          status: "provisional",
          evidenceRefs: ["evidence-priority"],
          dimensions: { scopeId: "centre-g" },
        }],
      },
      executeAction,
      getAnalysisRequirements: () => contextRequirements,
      runId: "run-context-supporting",
      segmentId: "segment-context-supporting",
      trustedEnergy: true,
    });

    const earlyResult = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Investigate Centre G first based on released priority.",
    }] }, { agent: { toolCallId: "call-context-supporting-early" } } as never);

    expect(earlyResult).toMatchObject({ ok: false, isError: true });
    expect(JSON.stringify(earlyResult)).toContain("ANALYSIS_CONTEXT_EVIDENCE_SUPPORTING_REQUIRES_QUERY:R1");
    expect(executeAction).not.toHaveBeenCalled();

    contextRequirements[0]!.status = "evidenced";
    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Investigate Centre G first based on released priority and the verified driver query.",
    }] }, { agent: { toolCallId: "call-context-supporting" } } as never);

    expect(result).toMatchObject({ claims: [{
      requirement_id: "R1",
      evidence_requirement_ids: ["R1"],
    }] });
    expect((result as { claims: Array<{ evidence_refs?: string[] }> }).claims[0]?.evidence_refs).toBeUndefined();
    expect(executeAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actionName: "analysis.requirements.commit",
      input: expect.objectContaining({ claims: [expect.objectContaining({
        evidence_requirement_ids: ["R1"],
        evidence_refs: undefined,
      })] }),
    }));
  });

  it("rejects model-supplied Context Evidence ids before changing protocol state", async () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "What is Centre A EUI?",
      acceptanceCriteria: [],
    }]);
    contextRequirements[0]!.contextEvidence = { mode: "sufficient", factIds: ["centre-a.eui"] };
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: contextRequirements,
      contextEvidenceCatalog: {
        contract: "analysis-context-evidence@1",
        sourceId: "snapshot-source",
        pins: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          dataCutoff: "2026-06-01T00:00:00.000Z",
          projectReleaseId: "release-1",
          metricVersion: "metrics-1",
        },
        facts: [{
          id: "centre-a.eui",
          label: "Centre A EUI",
          metricId: "preschool.benchmark.eui",
          value: 13.62,
          unit: "kWh/m2/year",
          status: "provisional",
          evidenceRefs: ["evidence-eui"],
          dimensions: { scopeId: "centre-a" },
        }],
      },
      executeAction,
      getAnalysisRequirements: () => contextRequirements,
      runId: "run-context",
      segmentId: "segment-context",
      trustedEnergy: true,
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Invented EUI",
      context_fact_ids: ["invented.eui"],
    }] }, { agent: { toolCallId: "call-invalid-context" } } as never);

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('Unrecognized key: "context_fact_ids"'),
    });
    expect(executeAction).not.toHaveBeenCalled();
  });
});

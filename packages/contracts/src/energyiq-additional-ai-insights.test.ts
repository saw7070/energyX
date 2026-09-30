import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  additionalAiInsightsArtifactIsValid,
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
  type AdditionalAiInsightsArtifactValidationInput,
  type AdditionalAiInsightFindingV1V2,
  type AdditionalAiInsightFindingV3,
} from "./energyiq-additional-ai-insights.js";

type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;
type _V3FindingCannotSatisfyV2 = AssertFalse<
  AdditionalAiInsightFindingV3 extends AdditionalAiInsightFindingV1V2 ? true : false
>;
type _V2ArtifactCarriesOnlyV2Findings = AssertTrue<
  Extract<AdditionalAiInsightsArtifact, {
    contract: { revision: "energyiq-additional-ai-insights-v2" };
  }>["findings"][number] extends AdditionalAiInsightFindingV1V2 ? true : false
>;
import type { InsightMethodRevisionRef } from "./energyiq-autonomous-insights.js";

describe("EnergyIQ Additional AI Insights artifact contract", () => {
  it("resolves an actual builtin Method resource whose content matches its immutable SHA", () => {
    const methodSet = resolveCurrentAdditionalAiInsightMethodSet("preschool-workspace");
    const core = methodSet.resources[0]!;

    expect(core.content).toBe(ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1);
    expect(createHash("sha256").update(core.content).digest("hex")).toBe(core.method.contentSha256);
    expect(methodSet.methods).toEqual([core.method]);
  });

  it("adds only exact published workspace Method resources to the shared Overview set", () => {
    const content = "Check repeated closed-hours event shape against the current Evidence before treating it as reusable.";
    const workspaceMethod: InsightMethodRevisionRef = {
      skillId: "workspace-insight-method:closed-hours-shape",
      semanticVersion: "1.0.0",
      resourceId: "insight-method-proposal:closed-hours-shape",
      resourceRevision: 1,
      contentSha256: createHash("sha256").update(content).digest("hex"),
      scope: "workspace",
      workspaceId: "preschool-workspace",
      userId: "user-charles",
      role: "expert-direction",
    };
    const methodSet = resolveCurrentAdditionalAiInsightMethodSet("preschool-workspace", [{
      method: workspaceMethod,
      content,
    }]);

    expect(methodSet.methods).toHaveLength(2);
    expect(methodSet.resources[1]).toEqual({ method: workspaceMethod, content });
    expect(() => resolveCurrentAdditionalAiInsightMethodSet("preschool-workspace", [{
      method: { ...workspaceMethod, workspaceId: "other-workspace" },
      content,
    }])).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_RESOURCE_INVALID");
    expect(() => resolveCurrentAdditionalAiInsightMethodSet("preschool-workspace", [{
      method: { ...workspaceMethod, scope: "user" },
      content,
    }])).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_RESOURCE_INVALID");
    expect(() => resolveCurrentAdditionalAiInsightMethodSet("preschool-workspace", [{
      method: { ...workspaceMethod, contentSha256: "not-a-sha" },
      content,
    }])).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_RESOURCE_INVALID");
  });

  it("accepts a compact shared Artifact with exact Method execution and per-Finding origin", () => {
    const input = validInput();

    expect(additionalAiInsightsArtifactIsValid(input)).toBe(true);
    expect(canonicalInsightMethodSetJson([input.expectedMethods[1]!, input.expectedMethods[0]!]))
      .toBe(canonicalInsightMethodSetJson(input.expectedMethods));
  });

  it("rejects Method drift, unloaded provenance and private Methods on a shared Overview", () => {
    const drift = validInput();
    drift.value.methodExecution.loadedMethods[1] = {
      ...drift.value.methodExecution.loadedMethods[1]!,
      contentSha256: "e".repeat(64),
    };
    expect(additionalAiInsightsArtifactIsValid(drift)).toBe(false);

    const unloadedOrigin = validInput();
    unloadedOrigin.value.findings[0]!.origin.directionMethods = [{
      ...unloadedOrigin.expectedMethods[1]!,
      skillId: "unloaded-sop",
      resourceId: "skill:unloaded-sop",
    }];
    expect(additionalAiInsightsArtifactIsValid(unloadedOrigin)).toBe(false);

    const privateMethod = validInput();
    privateMethod.expectedMethods[1] = {
      ...privateMethod.expectedMethods[1]!,
      scope: "user",
      userId: "private-user",
    };
    privateMethod.value.methodExecution.loadedMethods[1] = privateMethod.expectedMethods[1]!;
    privateMethod.value.findings[0]!.origin.directionMethods = [privateMethod.expectedMethods[1]!];
    expect(additionalAiInsightsArtifactIsValid(privateMethod)).toBe(false);

    const selfApproved = validInput();
    Object.assign(selfApproved.value.methodExecution, {
      approvedMethods: [{
        ...selfApproved.expectedMethods[0]!,
        skillId: "artifact-self-approved",
        resourceId: "skill:artifact-self-approved",
      }],
    });
    expect(additionalAiInsightsArtifactIsValid(selfApproved)).toBe(false);
  });

  it("allows a truthful empty Artifact but rejects filler, unbound Evidence and publication count drift", () => {
    const empty = validInput();
    empty.value.status = "empty";
    empty.value.findings = [];
    empty.value.publication = {
      ...empty.value.publication,
      discoveredCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      publishedCount: 0,
      sourceOrderCandidateIds: [],
      acceptedCandidateIds: [],
      rejectedCandidateIds: [],
      publishedCandidateIds: [],
      suppressedCandidateIds: [],
    };
    expect(additionalAiInsightsArtifactIsValid(empty)).toBe(true);

    const filler = structuredClone(empty);
    filler.value.findings = [validInput().value.findings[0]!];
    expect(additionalAiInsightsArtifactIsValid(filler)).toBe(false);

    const noEvidence = validInput();
    noEvidence.value.findings[0]!.evidenceRefs = [];
    expect(additionalAiInsightsArtifactIsValid(noEvidence)).toBe(false);

    const countDrift = validInput();
    countDrift.value.publication.publishedCount = 2;
    expect(additionalAiInsightsArtifactIsValid(countDrift)).toBe(false);
  });

  it("validates explicit tool audit, alert, Canvas, and Snapshot A-to-B provenance instead of ignoring it", () => {
    const traced = validInput();
    traced.value.capability.usedTools = ["energy.timeseries.analyze"];
    Object.assign(traced.value, {
      toolAudits: [{
        auditId: "audit:timeseries:1",
        toolCallId: "tool-call:timeseries:1",
        toolName: "energy.timeseries.analyze",
        status: "succeeded",
        evidenceRefs: ["evidence:closed-event-catalog"],
      }],
      snapshotComparison: {
        previousArtifactId: "artifact:additional:previous",
        previousDataSnapshotId: "snapshot-previous",
        outcomes: [{
          transition: "changed",
          currentFindingId: "additional-insight-1",
          previousFindingId: "additional-insight-previous",
        }],
      },
    });
    Object.assign(traced.value.findings[0]!, {
      toolAuditIds: ["audit:timeseries:1"],
      alert: {
        severity: "attention",
        certainty: "possible",
        evidenceRefs: ["evidence:closed-event-catalog"],
      },
      canvas: {
        contractRevision: "energyiq-insight-canvas-v1",
        planId: "canvas-plan:additional-insight-1",
        acceptedBlockIds: ["canvas-block:closed-hours-trend"],
      },
    });
    expect(additionalAiInsightsArtifactIsValid(traced)).toBe(true);

    const unboundAudit = structuredClone(traced);
    unboundAudit.value.findings[0]!.toolAuditIds = ["audit:forged"];
    expect(additionalAiInsightsArtifactIsValid(unboundAudit)).toBe(false);

    const arbitraryProvenance = validInput();
    Object.assign(arbitraryProvenance.value.findings[0]!, { arbitraryAuditIdentity: "forged" });
    expect(additionalAiInsightsArtifactIsValid(arbitraryProvenance)).toBe(false);
  });

  it("restores only server-accepted ordered Canvas blocks for the current Artifact", () => {
    const current = currentCanvasInput();

    expect(additionalAiInsightsArtifactIsValid(current)).toBe(true);

    const pointerOnly = currentCanvasInput();
    Object.assign(pointerOnly.value.findings[0]!, {
      canvas: {
        contractRevision: "energyiq-insight-canvas-v1",
        planId: "canvas-plan:additional-insight-1",
        acceptedBlockIds: ["canvas-block:closed-hours-trend"],
      },
    });
    expect(additionalAiInsightsArtifactIsValid(pointerOnly)).toBe(false);

    const idDrift = currentCanvasInput();
    idDrift.value.findings[0]!.canvas.acceptedBlockIds = ["canvas-block:forged"];
    expect(additionalAiInsightsArtifactIsValid(idDrift)).toBe(false);

    const bindingDrift = currentCanvasInput();
    bindingDrift.value.findings[0]!.canvas.acceptedBlocks[0]!.bindings[0]!.value = 999;
    expect(additionalAiInsightsArtifactIsValid(bindingDrift)).toBe(false);

    const budgetRejection = currentCanvasInput();
    const budgetCanvas = budgetRejection.value.findings[0]!.canvas;
    if (budgetCanvas.contractRevision !== "energyiq-insight-canvas-v2") throw new Error("current Canvas fixture required");
    budgetCanvas.rejections = [{
      code: "PRESENTATION_BUDGET_EXCEEDED",
      subjectId: "canvas-block:suppressed-4",
    }];
    expect(additionalAiInsightsArtifactIsValid(budgetRejection)).toBe(true);

    const unknownRejection = structuredClone(budgetRejection);
    const unknownCanvas = unknownRejection.value.findings[0]!.canvas;
    if (unknownCanvas.contractRevision !== "energyiq-insight-canvas-v2") throw new Error("current Canvas fixture required");
    unknownCanvas.rejections[0]!.code = "UNKNOWN_REJECTION" as "PRESENTATION_BUDGET_EXCEEDED";
    expect(additionalAiInsightsArtifactIsValid(unknownRejection)).toBe(false);
  });

  it("binds compact Evidence lineage and full publication provenance to the current Artifact", () => {
    const input = validInput();
    expect(additionalAiInsightsArtifactIsValid(input)).toBe(true);

    const forgedEvidence = structuredClone(input);
    forgedEvidence.value.findings[0]!.evidenceRefs = ["evidence:forged"];
    expect(additionalAiInsightsArtifactIsValid(forgedEvidence)).toBe(false);

    const snapshotDrift = structuredClone(input);
    snapshotDrift.value.evidenceLineage.pins.dataSnapshotId = "snapshot-other";
    expect(additionalAiInsightsArtifactIsValid(snapshotDrift)).toBe(false);

    const publicationDrift = structuredClone(input);
    publicationDrift.value.publication.publishedCandidateIds = ["candidate-other"];
    expect(additionalAiInsightsArtifactIsValid(publicationDrift)).toBe(false);
  });

  it.each([
    ["workspace", (input: ReturnType<typeof validInput>) => { input.value.binding.workspaceId = "other-workspace"; }],
    ["project", (input: ReturnType<typeof validInput>) => { input.value.binding.projectId = "other-project"; }],
    ["scope", (input: ReturnType<typeof validInput>) => { input.value.binding.scopeId = "other-scope"; }],
    ["Snapshot", (input: ReturnType<typeof validInput>) => { input.value.binding.dataSnapshotId = "other-snapshot"; }],
    ["Release", (input: ReturnType<typeof validInput>) => { input.value.binding.projectReleaseId = "other-release"; }],
    ["period", (input: ReturnType<typeof validInput>) => { input.value.binding.analysisPeriod.from = "2026-04-01T00:00:00.000Z"; }],
    ["model", (input: ReturnType<typeof validInput>) => { input.value.providerProfileId = "other-model"; }],
    ["model revision", (input: ReturnType<typeof validInput>) => { input.value.binding.modelProfileRevision += 1; }],
    ["contract", (input: ReturnType<typeof validInput>) => {
      (input.value.contract as { revision: string }).revision = "other-contract";
    }],
    ["Method Set id", (input: ReturnType<typeof validInput>) => { input.value.methodExecution.methodSetId = "caller-method-set"; }],
    ["Method Set revision", (input: ReturnType<typeof validInput>) => { input.value.methodExecution.methodSetRevision = "v999"; }],
    ["Method Set fingerprint", (input: ReturnType<typeof validInput>) => { input.value.methodExecution.methodSetFingerprint = `sha256:${"0".repeat(64)}`; }],
  ] as const)("rejects an Additional Artifact whose %s identity is not exact", (_label, mutate) => {
    const input = validInput();
    mutate(input);
    expect(additionalAiInsightsArtifactIsValid(input)).toBe(false);
  });
});

const validInput = (): AdditionalAiInsightsArtifactValidationInput & {
  expectedMethods: InsightMethodRevisionRef[];
  value: AdditionalAiInsightsArtifact;
} => {
  const core = method({
    skillId: "energyiq-open-discovery",
    role: "core-method",
    scope: "builtin",
    contentSha256: "a".repeat(64),
  });
  const sop = method({
    skillId: "preschool-closed-hours-sop",
    role: "expert-direction",
    scope: "workspace",
    contentSha256: "b".repeat(64),
  });
  const expectedMethods = [core, sop];
  return {
    expected: {
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriod: {
        from: "2026-05-01T00:00:00.000Z",
        to: "2026-06-01T00:00:00.000Z",
      },
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
      methodSetId: "preschool-additional-insights-current",
      methodSetRevision: "v1",
      methodSetFingerprint: `sha256:${"c".repeat(64)}`,
      outputContractRevision: "energyiq-additional-ai-insights-v1",
      capabilityRevision: "scoped-read-only-v1",
      publicationRevision: "additional-insights-v1",
    },
    expectedMethods,
    value: {
      artifactKind: "autonomous-insights",
      status: "available",
      providerProfileId: "deepseek-v4-flash",
      runId: "run-additional-a",
      contract: {
        id: "energyiq-additional-ai-insights",
        revision: "energyiq-additional-ai-insights-v1",
      },
      binding: {
        workspaceId: "preschool-workspace",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        dataSnapshotId: "snapshot-a",
        projectReleaseId: "release-v1",
        analysisPeriod: {
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-06-01T00:00:00.000Z",
        },
        modelProfileId: "deepseek-v4-flash",
        modelProfileRevision: 8,
      },
      methodExecution: {
        methodSetId: "preschool-additional-insights-current",
        methodSetRevision: "v1",
        methodSetFingerprint: `sha256:${"c".repeat(64)}`,
        loadedMethods: [...expectedMethods],
      },
      capability: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
        usedTools: [],
      },
      toolAudits: [],
      evidenceLineage: {
        catalogContract: "analysis-context-evidence@1",
        sourceId: "project-analysis-snapshot:preschool-demo:snapshot-a",
        pins: {
          workspaceId: "preschool-workspace",
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          dataSnapshotId: "snapshot-a",
          dataCutoff: "2026-06-01T00:00:00.000Z",
          projectReleaseId: "release-v1",
          metricVersion: "energy-metrics-v1",
        },
        facts: [{
          id: "evidence:closed-event-catalog",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:closed-events"],
        }],
      },
      findings: [{
        id: "additional-insight-1",
        title: "The overnight pattern may be event-led rather than a persistent baseline",
        text: "The cited closed-hours events are concentrated on a small number of dates.",
        epistemicStatus: "inferred",
        origin: {
          kind: "hybrid",
          coreMethod: core,
          directionMethods: [sop],
          novelContribution: "Connected the SOP timing lens to the current event distribution.",
        },
        evidenceRefs: ["evidence:closed-event-catalog"],
        toolAuditIds: [],
        deepDiveQuestion: "Do cleaning or manual-override windows explain these events?",
      }],
      publication: {
        policyId: "energyiq-additional-ai-insights",
        policyRevision: "additional-insights-v1",
        discoveredCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        publishedCount: 1,
        sourceOrderCandidateIds: ["candidate-1"],
        acceptedCandidateIds: ["candidate-1"],
        rejectedCandidateIds: [],
        publishedCandidateIds: ["candidate-1"],
        suppressedCandidateIds: [],
      },
    },
  };
};

const currentCanvasInput = () => {
  const input = validInput();
  Object.assign(input.expected, {
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  });
  input.value.contract.revision = "energyiq-additional-ai-insights-v2";
  input.value.publication.policyRevision = "additional-insights-v2";
  Object.assign(input.value.evidenceLineage.facts[0]!, {
    label: "Closed-hours event count",
    metricId: "energy.closed_hours.event_count",
    value: 4,
    unit: "events",
    dimensions: { scopeId: "preschool-project" },
  });
  Object.assign(input.value.findings[0]!, {
    canvas: {
      contractRevision: "energyiq-insight-canvas-v2",
      planId: "canvas-plan:additional-insight-1",
      acceptedBlockIds: ["canvas-block:closed-hours-trend"],
      acceptedBlocks: [{
        id: "canvas-block:closed-hours-trend",
        kind: "quantitative",
        visualization: "trend",
        title: "Closed-hours events",
        bindings: [{
          evidenceRef: "evidence:closed-event-catalog",
          entityId: "preschool-project",
          metricId: "energy.closed_hours.event_count",
          value: 4,
          unit: "events",
        }],
      }],
      rejections: [{ code: "INVESTIGATOR_BLOCK_INVALID", subjectId: "canvas-block:unsafe" }],
      gaps: [],
    },
  });
  return input as unknown as AdditionalAiInsightsArtifactValidationInput & {
    expectedMethods: InsightMethodRevisionRef[];
    value: AdditionalAiInsightsArtifact & {
      findings: Array<AdditionalAiInsightsArtifact["findings"][number] & {
        canvas: {
          acceptedBlockIds: string[];
          acceptedBlocks: Array<{
            bindings: Array<{ value: number }>;
          }>;
        };
      }>;
    };
  };
};

describe("Additional AI Insights output-contract versioning", () => {
  it("keeps v2 immutable and permits Tuya lineage fields only in v3", () => {
    const v2 = currentCanvasInput();
    Object.assign(v2.value.findings[0]!, {
      windowIds: ["current-overview"],
      relationship: {
        relatedPresentedClaimIds: [],
        novelConclusion: "Test whether the current window changes the operating pattern.",
        relationshipAssertion: false,
      },
    });
    expect(additionalAiInsightsArtifactIsValid(v2)).toBe(false);

    const v3 = structuredClone(v2);
    v3.expected.outputContractRevision = "energyiq-additional-ai-insights-v3";
    v3.value.contract.revision = "energyiq-additional-ai-insights-v3";
    expect(additionalAiInsightsArtifactIsValid(v3)).toBe(true);

    (v3.expected as { outputContractRevision: string }).outputContractRevision = "energyiq-additional-ai-insights-v99";
    (v3.value.contract as { revision: string }).revision = "energyiq-additional-ai-insights-v99";
    expect(additionalAiInsightsArtifactIsValid(v3)).toBe(false);
  });
});

const method = (overrides: Partial<InsightMethodRevisionRef> & Pick<InsightMethodRevisionRef, "skillId" | "role" | "scope">): InsightMethodRevisionRef => ({
  skillId: overrides.skillId,
  semanticVersion: overrides.semanticVersion ?? "1.0.0",
  resourceId: overrides.resourceId ?? `skill:${overrides.skillId}`,
  resourceRevision: overrides.resourceRevision ?? 1,
  contentSha256: overrides.contentSha256 ?? "d".repeat(64),
  scope: overrides.scope,
  workspaceId: overrides.workspaceId ?? "preschool-workspace",
  userId: overrides.userId ?? "energyiq-system",
  role: overrides.role,
});

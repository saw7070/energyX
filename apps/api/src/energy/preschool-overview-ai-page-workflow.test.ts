import type { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
  createMetadataStore,
  type EnergyIqOverviewAiArtifactIdentity,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRESCHOOL_SECTION_IDS, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
} from "./overview-ai-artifact.js";
import {
  arePreschoolSectionArtifactsTerminal,
  createPreschoolOverviewAiPageWorkflow,
} from "./preschool-overview-ai-page-workflow.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Overview AI page workflow", () => {
  it("waits to synthesize while any independently claimed Section is queued or running", () => {
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "standby-wastage": "running" }))).toBe(false);
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "planning-outlook": "queued" }))).toBe(false);
  });

  it("allows synthesis after every Section reaches an available or failed terminal state", () => {
    expect(arePreschoolSectionArtifactsTerminal(statuses({}))).toBe(true);
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "standby-wastage": "failed" }))).toBe(true);
  });

  it("reads only exact current-v4 Artifacts without ensuring or calling either Provider", async () => {
    const harness = createHarness();
    const legacy = completeSectionV3(harness, "centre-benchmark", "Legacy summary must not win.");
    const current = completeSectionV4(harness, "centre-benchmark", "Current v4 summary wins.");
    let sectionProviderCalls = 0;
    let executiveProviderCalls = 0;
    const workflow = createPreschoolOverviewAiPageWorkflow({
      metadataStore: harness.metadata,
      dataGateway: {} as LocalDataGateway,
      runSection: async () => {
        sectionProviderCalls += 1;
        throw new Error("READ_MUST_NOT_CALL_SECTION_PROVIDER");
      },
      runExecutiveSynthesis: async () => {
        executiveProviderCalls += 1;
        throw new Error("READ_MUST_NOT_CALL_EXECUTIVE_PROVIDER");
      },
    });

    const first = await workflow.read({ identity: harness.identity, user: harness.user });
    const second = await workflow.read({ identity: harness.identity, user: harness.user });
    const baseArtifact = harness.metadata.energyIq.overviewAiArtifacts.find(harness.identity);
    harness.close();

    expect(first).toEqual(second);
    expect(first?.sections["centre-benchmark"]).toMatchObject({
      status: "available",
      artifactId: current.id,
      result: {
        contract: { revision: "preschool-section-interpretation-v4" },
        packRevision: "v2",
        summary: { text: "Current v4 summary wins." },
      },
    });
    expect(first?.sections["centre-benchmark"]).not.toMatchObject({ artifactId: legacy.id });
    expect(sectionProviderCalls).toBe(0);
    expect(executiveProviderCalls).toBe(0);
    expect(baseArtifact).toBeUndefined();
  });

  it("executes four independent current-v4 Sections from complete Pack-v2 inputs before composing Key Findings", async () => {
    const harness = createHarness();
    const sectionCalls: Array<{
      identity: EnergyIqOverviewAiArtifactIdentity;
      prompt: string;
      structuredOutput: unknown;
    }> = [];
    let executiveProviderCalls = 0;
    const completed = vi.spyOn(harness.metadata.energyIq.overviewAiArtifacts, "complete");
    const workflow = createPreschoolOverviewAiPageWorkflow({
      metadataStore: harness.metadata,
      dataGateway: {} as LocalDataGateway,
      resolveSnapshot: async () => emptySnapshot(),
      runSection: async ({ identity, prompt, structuredOutput, runId, sessionId }) => {
        sectionCalls.push({ identity, prompt, structuredOutput });
        return {
          answer: JSON.stringify({ sectionId: identity.targetId, status: "empty", candidates: [] }),
          runId,
          sessionId,
        };
      },
      runExecutiveSynthesis: async ({ runId, sessionId }) => {
        executiveProviderCalls += 1;
        return { answer: JSON.stringify({ status: "empty", findings: [] }), runId, sessionId };
      },
    });

    const result = await workflow.execute({
      identity: harness.identity,
      user: harness.user,
      retry: false,
    });
    expect(sectionCalls).toHaveLength(4);
    expect(sectionCalls.map(({ identity }) => identity.targetId).sort()).toEqual([...PRESCHOOL_SECTION_IDS].sort());
    for (const call of sectionCalls) {
      expect(call.identity).toMatchObject({
        artifactKind: "section-interpretation",
        identityContractRevision: "v4",
        analysisPackId: "preschool-section-pack",
        analysisPackRevision: "v2",
        outputContractRevision: "preschool-section-interpretation-v4",
        capabilityRevision: "scoped-read-only-v1",
        publicationRevision: "v1",
      });
      expect(call.structuredOutput).toBeDefined();
      expect(call.prompt).toContain('"sourcePackRevision":"preschool-section-pack-v2"');
      expect(call.prompt).not.toContain("allowedNextChecks");
    }
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result.sections[sectionId].status)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(executiveProviderCalls).toBe(0);
    const sectionIdentities = PRESCHOOL_SECTION_IDS.map((sectionId) =>
      createPreschoolOverviewAiSectionArtifactIdentityV4({ baseIdentity: harness.identity, targetId: sectionId }));
    const executiveIdentity = createPreschoolOverviewAiExecutiveArtifactIdentityV4({
      baseIdentity: harness.identity,
      targetId: "sections:none",
    });
    expect(sectionIdentities.map((identity) => harness.metadata.energyIq.overviewAiArtifacts.get(identity))).toEqual(
      sectionIdentities.map(() => expect.objectContaining({
        status: "available",
      })),
    );
    expect(harness.metadata.energyIq.overviewAiArtifacts.get(executiveIdentity)).toMatchObject({
      status: "available",
    });
    expect(completed).toHaveBeenCalledTimes(5);
    expect(completed.mock.calls.slice(0, 4).map(([input]) => input.identity.artifactKind)).toEqual([
      "section-interpretation",
      "section-interpretation",
      "section-interpretation",
      "section-interpretation",
    ]);
    expect(completed.mock.calls[4]?.[0].identity.artifactKind).toBe("executive-synthesis");
    harness.close();
  });

  it("passes the server-owned Snapshot Evidence catalog into current Key Findings synthesis", async () => {
    const harness = createHarness();
    const benchmark = completeSectionV4(harness, "centre-benchmark", "The benchmark evidence supports review.");
    const standby = completeSectionV4(harness, "standby-wastage", "The standby evidence supports review.");
    const snapshot = emptySnapshot();
    snapshot.evidence = [{
      id: "query:overview-current",
      metricId: "energy.total_usage_kwh",
      queryIds: ["scope_summary_v1"],
    }];
    snapshot.analysis.summary.usageKwh = 120;
    let executivePrompt = "";
    const workflow = createPreschoolOverviewAiPageWorkflow({
      metadataStore: harness.metadata,
      dataGateway: {} as LocalDataGateway,
      resolveSnapshot: async () => snapshot,
      runSection: async ({ identity, runId, sessionId }) => ({
        answer: JSON.stringify({ sectionId: identity.targetId, status: "empty", candidates: [] }),
        runId,
        sessionId,
      }),
      runExecutiveSynthesis: async ({ prompt, runId, sessionId }) => {
        executivePrompt = prompt;
        return {
          answer: JSON.stringify({
            status: "available",
            summary: {
              text: "The 120 kWh total adds context to the benchmark and standby evidence.",
              evidenceRefs: ["analysis.summary.usage_kwh", "evidence:v4:centre-benchmark", "evidence:v4:standby-wastage"],
            },
            findings: [{
              title: "Portfolio context",
              text: "The 120 kWh total and the two accepted Sections support a focused review.",
              sectionIds: ["centre-benchmark", "standby-wastage"],
              evidenceRefs: ["analysis.summary.usage_kwh", "evidence:v4:centre-benchmark", "evidence:v4:standby-wastage"],
            }],
          }),
          runId,
          sessionId,
        };
      },
    });

    const result = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();
    expect(result.executive).toMatchObject({
      status: "available",
      result: {
        sourceSectionArtifactIds: [benchmark.id, standby.id],
        overviewEvidence: {
          contract: "analysis-context-evidence@1",
          pins: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            dataCutoff: "2026-06-01T00:00:00.000Z",
          },
          factIds: ["analysis.summary.usage_kwh"],
        },
      },
    });
    expect(executivePrompt).toContain('"contract":"analysis-context-evidence@1"');
    expect(executivePrompt).toContain('"dataCutoff":"2026-06-01T00:00:00.000Z"');
  });

  it("passes all four available current Sections into Key Findings synthesis", async () => {
    const harness = createHarness();
    for (const sectionId of PRESCHOOL_SECTION_IDS) {
      completeSectionV4(harness, sectionId, `Current ${sectionId} conclusion.`);
    }
    let executivePrompt = "";
    let sectionProviderCalls = 0;
    const workflow = createPreschoolOverviewAiPageWorkflow({
      metadataStore: harness.metadata,
      dataGateway: {} as LocalDataGateway,
      resolveSnapshot: async () => emptySnapshot(),
      runSection: async () => {
        sectionProviderCalls += 1;
        throw new Error("EXISTING_SECTIONS_MUST_BE_REUSED");
      },
      runExecutiveSynthesis: async ({ prompt, runId, sessionId }) => {
        executivePrompt = prompt;
        return {
          answer: JSON.stringify({
            status: "available",
            summary: {
              text: "All four current Sections support a bounded management review.",
              evidenceRefs: PRESCHOOL_SECTION_IDS.map((sectionId) => `evidence:v4:${sectionId}`),
            },
            findings: [{
              title: "Four-Section review",
              text: "All four accepted Sections support the bounded management review.",
              sectionIds: [...PRESCHOOL_SECTION_IDS],
              evidenceRefs: PRESCHOOL_SECTION_IDS.map((sectionId) => `evidence:v4:${sectionId}`),
            }],
          }),
          runId,
          sessionId,
        };
      },
    });

    const result = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();
    expect(sectionProviderCalls).toBe(0);
    expect(PRESCHOOL_SECTION_IDS.every((sectionId) => executivePrompt.includes(`\"sectionId\":\"${sectionId}\"`))).toBe(true);
    expect(result.executive.status).toBe("available");
  });
});

const statuses = (
  overrides: Partial<Record<PreschoolSectionId, "queued" | "running" | "available" | "failed">>,
) => Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
  sectionId,
  { status: overrides[sectionId] ?? "available" },
])) as Record<PreschoolSectionId, { status: "queued" | "running" | "available" | "failed" }>;

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-page-v4-red-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "System", kind: "personal" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  metadata.configResources.upsert({
    id: "profile-current",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Current model",
    payload: { provider: "openai-compatible", modelName: "test-model" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-current",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  return {
    metadata,
    identity: createOverviewAiArtifactIdentity({
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
      modelProfileRevision: 1,
    }),
    user: metadata.users.getById({ user_id: "dev-user" }),
    close: () => metadata.close(),
  };
};

const completeSectionV3 = (
  harness: ReturnType<typeof createHarness>,
  sectionId: PreschoolSectionId,
  summary: string,
) => {
  const identity = createPreschoolOverviewAiSectionArtifactIdentityV3({ baseIdentity: harness.identity, targetId: sectionId });
  return completeArtifact(harness, identity, {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId: `run:v3:${sectionId}`,
    contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v3" },
    binding: binding(identity),
    sectionId,
    summary,
    keyPoints: [{ kind: "finding", text: "Legacy evidence.", evidenceRefs: [`evidence:v3:${sectionId}`] }],
  });
};

const completeSectionV4 = (
  harness: ReturnType<typeof createHarness>,
  sectionId: PreschoolSectionId,
  summary: string,
) => {
  const identity = createPreschoolOverviewAiSectionArtifactIdentityV4({ baseIdentity: harness.identity, targetId: sectionId });
  return completeArtifact(harness, identity, {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId: `run:v4:${sectionId}`,
    contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
    binding: binding(identity),
    sectionId,
    packRevision: "v2",
    capability: {
      revision: "scoped-read-only-v1",
      mode: "scoped-read-only",
      tools: sectionTools(sectionId),
    },
    toolAudits: [],
    summary: { text: summary, evidenceRefs: [`evidence:v4:${sectionId}`] },
    insights: [],
    publication: {
      policyId: "preschool-section-publication",
      policyRevision: "v1",
      discoveredCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      publishedCount: 0,
      suppressedCandidateIds: [],
    },
  });
};

const sectionTools = (sectionId: PreschoolSectionId) => {
  if (sectionId === "centre-benchmark") return ["compare_centres", "inspect_related_section_signals"] as const;
  if (sectionId === "standby-wastage" || sectionId === "operating-behaviour") {
    return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"] as const;
  }
  return ["inspect_related_section_signals"] as const;
};

const completeArtifact = (
  harness: ReturnType<typeof createHarness>,
  identity: EnergyIqOverviewAiArtifactIdentity,
  result: Record<string, unknown>,
) => {
  harness.metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: harness.user.id });
  const workerId = `worker:${identity.outputContractRevision}:${identity.targetId}`;
  harness.metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: 60_000 });
  return harness.metadata.energyIq.overviewAiArtifacts.complete({
    identity,
    workerId,
    sessionId: `session:${identity.targetId}`,
    runId: String(result.runId),
    resultJson: JSON.stringify(result),
  });
};

const binding = (identity: EnergyIqOverviewAiArtifactIdentity) => ({
  workspaceId: identity.workspaceId,
  projectId: "preschool-demo",
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
});

const emptySnapshot = (): ProjectAnalysisSnapshot => ({
  context: {
    userId: "dev-user",
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    projectName: "Preschool",
    scopeId: "preschool-project",
    scopeName: "All centres",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: "2026-05-01T00:00:00.000Z",
    to: "2026-06-01T00:00:00.000Z",
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy-1",
    meterMappingRevisionId: "mapping-1",
    meterFormulaRevisionId: "formula-1",
    dataSnapshotId: "snapshot-current",
    metricVersion: "metrics-1",
    businessCalendarVersion: "calendar-1",
    tariffScheduleVersion: "tariff-1",
    primaryPeriod: { start: "2026-05-01T00:00:00.000Z", endExclusive: "2026-06-01T00:00:00.000Z" },
    projectReleaseId: "release-current",
  },
  projectRelease: {
    id: "release-current",
    renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  },
  renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataSnapshot: { id: "snapshot-current", importBatchIds: [], lastSeenAt: null },
  evidence: [],
  dataQuality: {
    status: "complete",
    coveragePct: 100,
    validIntervalCount: 0,
    expectedMeterIntervalCount: 0,
    qualityEventCount: 0,
  },
  metadata: { selectedScope: { status: "available" } },
  analysis: {
    summary: { usageKwh: 0, averageDailyUsageKwh: 0, peakKw: 0 },
    comparison: { usageKwh: 0, changeKwh: 0 },
    categories: [],
    childScopes: [],
    topCircuits: [],
    offHours: { status: "unavailable" },
  },
} as unknown as ProjectAnalysisSnapshot);

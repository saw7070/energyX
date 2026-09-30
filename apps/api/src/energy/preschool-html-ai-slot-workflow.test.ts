import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import { PRESCHOOL_HTML_AI_SLOT_IDS } from "./preschool-html-ai-slot.js";
import { createPreschoolHtmlAiSlotWorkflow } from "./preschool-html-ai-slot-workflow.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool HTML AI Slot workflow", () => {
  it("generates each Slot once, persists immutable artifacts, and reuses the exact identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-workflow-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "release-current";
    mockPublishedSlotDefinitions(metadata, projectReleaseId);
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-current",
      projectReleaseId,
      analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
      analysisPeriodTo: "2026-07-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    const modelBinding = {
      workspace_id: "default",
      profile_id: "profile-test",
      profile_owner_user_id: "dev-user",
      configured_by_user_id: "dev-user",
      fallback_policy: "disabled",
      revision: 4,
      created_at: "2026-08-29T00:00:00.000Z",
      updated_at: "2026-08-29T00:00:00.000Z",
    } as const;
    vi.spyOn(metadata.workspaceDefaultModelProfiles, "find").mockReturnValue(modelBinding);
    vi.spyOn(metadata.workspaceDefaultModelProfiles, "get").mockReturnValue(modelBinding);
    vi.spyOn(metadata.configResources, "find").mockReturnValue({
      status: "connected",
      default_enabled: true,
      payload: { provider: "deepseek", modelName: "deepseek-v4-flash" },
    } as never);
    const runSlot = vi.fn(async ({ slotId, runId, sessionId }: { slotId: string; runId: string; sessionId: string; prompt: string }) => ({
      answer: JSON.stringify({
        evidenceRefs: [evidenceRefForSlot(slotId, identity.dataSnapshotId)],
        html: slotId === "executive-summary"
          ? "<section><p>Verified slot output</p><p>Unverified 999</p></section>"
          : slotId === "additional-insight"
            ? `<p data-fact-ids="${evidenceRefForSlot(slotId, identity.dataSnapshotId)}">Verified slot output</p>`
            : "<p>Verified slot output</p>",
      }),
      runId,
      sessionId,
      latencyMs: 17,
      inputTokens: 100,
      outputTokens: 20,
    }));
    const snapshot = minimalSnapshot(identity);
    snapshot.analysis.comparison.changePct = 12.5;
    snapshot.analysis.offHours = {
      status: "available",
      operatingKwh: 88.65,
      standbyKwh: 11.35,
      usageKwh: 11.35,
      sharePct: 11.35,
      timezone: "Asia/Singapore",
      businessCalendarVersion: "calendar-1",
    };
    const resolveSnapshot = vi.fn(async () => snapshot);
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot,
      runSlot,
    });

    expect(workflow.resolvePublishedIdentity({ snapshot })).toMatchObject({
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriodFrom: identity.analysisPeriodFrom,
      analysisPeriodTo: identity.analysisPeriodTo,
      modelProfileRevision: identity.modelProfileRevision,
    });

    const targeted = await workflow.execute({
      identity,
      user: { id: "dev-user" } as never,
      slotId: "executive-summary",
      snapshot,
    });
    expect(resolveSnapshot).not.toHaveBeenCalled();
    expect(runSlot).toHaveBeenCalledTimes(1);
    expect(runSlot.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('"presentationText":"Selected Scope energy use increased by 10 kWh from the previous comparison period."'),
    }));
    expect(runSlot.mock.calls[0]?.[0].prompt).toContain(
      '"presentationText":"Selected Scope energy use was 100 kWh."',
    );
    expect(runSlot.mock.calls[0]?.[0].prompt).toContain(
      '"presentationText":"Selected Scope energy use was 12.5% higher than the previous comparison period."',
    );
    expect(runSlot.mock.calls[0]?.[0].prompt).toContain(
      '"presentationText":"Off-hours energy use was 11.35% of total energy use."',
    );
    expect(runSlot).toHaveBeenCalledWith(expect.objectContaining({
      runtimeIdentity: expect.objectContaining({
        methodSkillId: "energyiq-evidence-first/preschool-html-slot-method",
        methodSkillRevision: "1/1",
        validatorRevision: "preschool-html-ai-slot-validator@13",
        capabilityRevision: "static-html-sandbox-v7",
        workflowRevision: "preschool-html-ai-slot-workflow@11",
        investigatorPromptRevision: "preschool-html-slot-prompt@17",
      }),
    }));
    expect(targeted.slots["executive-summary"]?.status).toBe("available");

    const first = await workflow.execute({ identity, user: { id: "dev-user" } as never });
    const second = await workflow.execute({ identity, user: { id: "dev-user" } as never });
    metadata.close();

    expect(runSlot).toHaveBeenCalledTimes(6);
    expect(Object.values(first.slots)).toHaveLength(6);
    expect(Object.values(first.slots).every((slot) => slot.status === "available")).toBe(true);
    expect(runSlot.mock.calls.find(([call]) => call.slotId === "operating-behaviour")?.[0].prompt)
      .toContain('"claimRelations":[{"subject":"Centre N","predicate":"leading-circuit","object":"Kitchen Plug Load","presentationText":"Centre N has Kitchen Plug Load as its leading circuit."}]');
    expect(runSlot.mock.calls.find(([call]) => call.slotId === "centre-benchmark")?.[0].prompt)
      .toContain('"presentationText":"The Portfolio P75 EUI was 100 kWh/m2/year."');
    expect(runSlot.mock.calls.find(([call]) => call.slotId === "standby-wastage")?.[0].prompt)
      .toContain('"presentationText":"Closed-hour energy use was 10 kWh, 10% of total energy use."');
    expect(runSlot.mock.calls.find(([call]) => call.slotId === "standby-wastage")?.[0].prompt)
      .toContain('"presentationFacts":[{"factId":"');
    expect(runSlot.mock.calls.find(([call]) => call.slotId === "operating-behaviour")?.[0].prompt)
      .toContain('"presentationText":"Centre N had 1 operating-hour spike."');
    expect(runSlot.mock.calls.find(([call]) => call.slotId === "additional-insight")?.[0].prompt)
      .toContain('"presentationText":"The Portfolio benchmark covered 1 Centre."');
    expect(second).toEqual(first);
    expect(first.slots["centre-benchmark"]?.artifact?.html).toBe("<p>Verified slot output</p>");
    expect(first.slots["executive-summary"]?.artifact?.html).toContain("Verified slot output");
    expect(first.slots["executive-summary"]?.artifact?.html).not.toContain("999");
    expect(first.slots["executive-summary"]?.acceptance).toEqual({
      status: "accepted_with_warnings",
      droppedClaims: [{ blockId: "html-block-2", reason: "unsupported-fact" }],
    });
    expect(first.slots["centre-benchmark"]?.generation).toEqual({
      latencyMs: 17,
      inputTokens: 100,
      outputTokens: 20,
      htmlSha256: expect.any(String),
    });
  });

  it("keeps a large Snapshot evidence catalog within the per-Slot prompt budget", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-prompt-budget-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "release-prompt-budget";
    mockPublishedSlotDefinitions(metadata, projectReleaseId);
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-prompt-budget",
      projectReleaseId,
      analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
      analysisPeriodTo: "2026-07-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    vi.spyOn(metadata.workspaceDefaultModelProfiles, "find").mockReturnValue({
      workspace_id: "default",
      profile_id: "profile-test",
      profile_owner_user_id: "dev-user",
      configured_by_user_id: "dev-user",
      fallback_policy: "disabled",
      revision: 4,
      created_at: "2026-08-29T00:00:00.000Z",
      updated_at: "2026-08-29T00:00:00.000Z",
    });
    vi.spyOn(metadata.configResources, "find").mockReturnValue({
      status: "connected",
      default_enabled: true,
      payload: { provider: "deepseek", modelName: "deepseek-v4-flash" },
    } as never);
    const snapshot = minimalSnapshot(identity);
    snapshot.evidence = [
      { id: "snapshot:evidence", metricId: "energy.total_usage_kwh", queryIds: ["query:overview"] },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `evidence:${"long-source-ref-".repeat(8)}${index}`,
        metricId: `metric-${index}`,
        queryIds: [`query-${index}`],
      })),
    ] as never;
    snapshot.analysis.childScopes = Array.from({ length: 120 }, (_, index) => ({
      nodeId: `centre-${index}`,
      name: `Centre ${index}`,
      nodeType: "centre",
      usageKwh: index + 1,
      sharePct: index + 1,
      kwhPerSqm: index + 1,
      kwhPerPerson: index + 1,
      metadata: { status: "available" },
    })) as never;
    const prompts: string[] = [];
    const runSlot = vi.fn(async ({ slotId, runId, sessionId, prompt }: {
      slotId: string;
      runId: string;
      sessionId: string;
      prompt: string;
    }) => {
      prompts.push(prompt);
      return {
        answer: JSON.stringify({
          evidenceRefs: [evidenceRefForSlot(slotId, identity.dataSnapshotId)],
          html: slotId === "additional-insight"
            ? `<p data-fact-ids="${evidenceRefForSlot(slotId, identity.dataSnapshotId)}">${slotId}</p>`
            : `<p>${slotId}</p>`,
        }),
        runId,
        sessionId,
      };
    });
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot: async () => snapshot,
      runSlot,
    });

    const result = await workflow.execute({ identity, user: { id: "dev-user" } as never });
    metadata.close();

    expect(runSlot).toHaveBeenCalledTimes(6);
    expect(prompts).toHaveLength(6);
    expect(Math.max(...prompts.map((prompt) => prompt.length))).toBeLessThan(120_000);
    const centrePrompt = prompts.find((prompt) => prompt.includes('"slot":"centre-benchmark"'));
    expect(centrePrompt).toContain("page:centre-benchmark:portfolio-reference");
    expect(centrePrompt).not.toContain("page:standby-wastage:summary");
    expect(Object.values(result.slots).every((slot) => slot.status === "available")).toBe(true);
  });

  it("retries only a failed Slot on the next explicit execution and keeps ready siblings immutable", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-fallback-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "release-fallback";
    mockPublishedSlotDefinitions(metadata, projectReleaseId);
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-fallback",
      projectReleaseId,
      analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
      analysisPeriodTo: "2026-07-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    vi.spyOn(metadata.workspaceDefaultModelProfiles, "find").mockReturnValue({
      workspace_id: "default",
      profile_id: "profile-test",
      profile_owner_user_id: "dev-user",
      configured_by_user_id: "dev-user",
      fallback_policy: "disabled",
      revision: 4,
      created_at: "2026-08-29T00:00:00.000Z",
      updated_at: "2026-08-29T00:00:00.000Z",
    });
    vi.spyOn(metadata.configResources, "find").mockReturnValue({
      status: "connected",
      default_enabled: true,
      payload: { provider: "deepseek", modelName: "deepseek-v4-flash" },
    } as never);
    let standbyAttempts = 0;
    const runSlot = vi.fn(async ({ slotId, runId, sessionId }: { slotId: string; runId: string; sessionId: string }) => {
      if (slotId === "standby-wastage" && standbyAttempts++ === 0) {
        return {
          answer: JSON.stringify({
            evidenceRefs: [evidenceRefForSlot(slotId, identity.dataSnapshotId)],
            html: "<p>999</p>",
          }),
          runId,
          sessionId,
          latencyMs: 11,
          inputTokens: 13,
          outputTokens: 7,
        };
      }
      return {
        answer: JSON.stringify({
          evidenceRefs: [evidenceRefForSlot(slotId, identity.dataSnapshotId)],
          html: slotId === "additional-insight"
            ? `<p data-fact-ids="${evidenceRefForSlot(slotId, identity.dataSnapshotId)}">${slotId}</p>`
            : `<p>${slotId}</p>`,
        }),
        runId,
        sessionId,
        latencyMs: 11,
      };
    });
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot: async () => minimalSnapshot(identity),
      runSlot,
    });

    const result = await workflow.execute({ identity, user: { id: "dev-user" } as never });
    const second = await workflow.execute({ identity, user: { id: "dev-user" } as never });
    metadata.close();

    expect(runSlot).toHaveBeenCalledTimes(7);
    expect(result.slots["standby-wastage"]).toMatchObject({
      status: "failed",
      errorCode: "PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT",
      runId: expect.stringContaining("preschool-html-slot-standby-wastage-"),
      sessionId: expect.stringContaining("preschool-html-slot-standby-wastage-"),
      generation: {
        latencyMs: 11,
        inputTokens: 13,
        outputTokens: 7,
        htmlSha256: createHash("sha256").update("<p>999</p>").digest("hex"),
      },
    });
    expect(second.slots["standby-wastage"]).toMatchObject({ status: "available" });
    expect(runSlot.mock.calls.filter(([input]) => input.slotId === "standby-wastage")).toHaveLength(2);
    expect(runSlot.mock.calls.filter(([input]) => input.slotId !== "standby-wastage")).toHaveLength(5);
    expect(Object.entries(result.slots)
      .filter(([slotId]) => slotId !== "standby-wastage")
      .every(([, slot]) => slot.status === "available"))
      .toBe(true);
  });

  it("rejects a historical validator pin from the current published Definition", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-stale-definition-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "release-stale-validator";
    mockPublishedSlotDefinitions(metadata, projectReleaseId, {
      validatorRevision: "preschool-html-ai-slot-validator@3",
    });
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-stale-validator",
      projectReleaseId,
      analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
      analysisPeriodTo: "2026-07-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot: async () => minimalSnapshot(identity),
      runSlot: vi.fn(),
    });

    await expect(workflow.read({ identity, user: { id: "dev-user" } as never }))
      .rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_DEFINITION_VALIDATOR_STALE");
    metadata.close();
  });

  it("rejects an artifact definition pinned to the previous validator revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-previous-validator-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "release-previous-validator";
    mockPublishedSlotDefinitions(metadata, projectReleaseId, {
      validatorRevision: "preschool-html-ai-slot-validator@4",
    });
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-previous-validator",
      projectReleaseId,
      analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
      analysisPeriodTo: "2026-07-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot: async () => minimalSnapshot(identity),
      runSlot: vi.fn(),
    });

    await expect(workflow.read({ identity, user: { id: "dev-user" } as never }))
      .rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_DEFINITION_VALIDATOR_STALE");
    metadata.close();
  });

  it("rejects the immutable production v5 Definition instead of rebinding its validator", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-v5-validator-compat-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "preschool-demo-template-v5";
    mockPublishedSlotDefinitions(metadata, projectReleaseId, {
      validatorRevision: "preschool-html-ai-slot-validator@9",
    });
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-v5-validator-compat",
      projectReleaseId,
      analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
      analysisPeriodTo: "2026-07-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot: async () => minimalSnapshot(identity),
      runSlot: vi.fn(),
    });

    await expect(workflow.read({ identity, user: { id: "dev-user" } as never }))
      .rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_DEFINITION_VALIDATOR_STALE");
    metadata.close();
  });

  it("rejects the immutable production v4 Definition instead of rebinding its validator", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-v4-validator-compat-"));
    roots.push(root);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    const project = metadata.energyIq.getProject("preschool-demo");
    const projectReleaseId = "preschool-demo-template-v4";
    mockPublishedSlotDefinitions(metadata, projectReleaseId, {
      validatorRevision: "preschool-html-ai-slot-validator@10",
    });
    const identity = createOverviewAiArtifactIdentity({
      workspaceId: PRESCHOOL_WORKSPACE_ID,
      projectId: project.id,
      scopeId: project.root_scope_id,
      dataSnapshotId: "snapshot-v4-validator-compat",
      projectReleaseId,
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
    });
    const workflow = createPreschoolHtmlAiSlotWorkflow({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      resolveSnapshot: async () => minimalSnapshot(identity),
      runSlot: vi.fn(),
    });

    await expect(workflow.read({ identity, user: { id: "dev-user" } as never }))
      .rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_DEFINITION_VALIDATOR_STALE");
    metadata.close();
  });
});

const minimalSnapshot = (identity: EnergyIqOverviewAiArtifactIdentity): ProjectAnalysisSnapshot => ({
  context: {
    userId: "dev-user",
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    projectName: "Preschool",
    scopeId: identity.scopeId,
    scopeName: "All Centres",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: identity.analysisPeriodFrom,
    to: identity.analysisPeriodTo,
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy-1",
    meterMappingRevisionId: "mapping-1",
    meterFormulaRevisionId: "formula-1",
    dataSnapshotId: identity.dataSnapshotId,
    metricVersion: "metrics-1",
    businessCalendarVersion: "calendar-1",
    tariffScheduleVersion: "tariff-1",
    primaryPeriod: { start: identity.analysisPeriodFrom, endExclusive: identity.analysisPeriodTo },
    projectReleaseId: identity.projectReleaseId,
    resolvedAt: "2026-07-01T00:00:00.000Z",
  },
  projectRelease: { id: identity.projectReleaseId, renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" } },
  renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataSnapshot: { id: identity.dataSnapshotId, importBatchIds: [], lastSeenAt: null },
  evidence: [{ id: "snapshot:evidence", metricId: "energy.total_usage_kwh", queryIds: ["query:overview"] }],
  preschoolBenchmark: {
    status: "provisional",
    sampleSize: 1,
    portfolio: { eui: { p50: 80, p75: 100, unit: "kWh/m2/year" }, perPax: { p50: 20, p75: 25, unit: "kWh/person/month" } },
    cohorts: [],
    centres: [],
    priorityCentreCodes: [],
    evidence: {
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      hierarchyRevisionId: "hierarchy-1",
      meterMappingRevisionId: "mapping-1",
      metricRevisionIds: ["energy.total_usage_kwh@1"],
      metadataRevisionIds: ["metadata-1"],
      metadataStatus: "provisional",
      sourceQueryIds: ["query:benchmark"],
      projectionRecipeIds: ["preschool-eui-benchmark-v1"],
      cohortSource: "test",
      normalisation: { eui: "test", perPax: "test" },
    },
  },
  preschoolOperational: {
    status: "available",
    energy: {
      totalKwh: 100,
      standbyKwh: 10,
      standbySharePct: 10,
      operatingKwh: 90,
      operatingSharePct: 90,
      provisionalStandbyCostBeforeGstSgd: 1,
      provisionalOperatingCostBeforeGstSgd: 9,
    },
    standbyAppliances: { appliances: [] },
    operatingAppliances: { appliances: [] },
    spikes: {
      standby: { count: 0, centreCount: 0, centres: [] },
      operating: {
        count: 1,
        centreCount: 1,
        centres: [{
          scopeId: "centre-n",
          centreCode: "N",
          name: "Centre N",
          spikeCount: 1,
          worstSpike: { leadingCircuitName: "Kitchen Plug Load", usageKwh: 20 },
        }],
      },
    },
    sop: { breachingCentreCodes: [] },
    evidence: { dataSnapshotId: identity.dataSnapshotId, projectReleaseId: identity.projectReleaseId, sourceQueryIds: ["query:operational"] },
  },
  preschoolPlanningLifecycle: {
    status: "available",
    targetPeriod: { start: "2026-07-01", endExclusive: "2026-08-01", timezone: "Asia/Singapore", targetDayCount: 31 },
    plan: {
      usageEstimate: { projectedKwh: 100, lowerKwh: 90, upperKwh: 110 },
      costEstimate: { currency: "SGD", currentPeriodBeforeGstSgd: 10, projectedBeforeGstSgd: 11, lowerBeforeGstSgd: 9, upperBeforeGstSgd: 12 },
      limitations: [],
    },
    actual: { status: "partial", usageKwh: 50, completeDayCount: 10, targetDayCount: 31, varianceKwh: 0, variancePct: 0 },
    planProvenance: { dataSnapshotId: identity.dataSnapshotId, projectReleaseId: identity.projectReleaseId, queryId: "plan" },
    actualProvenance: { dataSnapshotId: identity.dataSnapshotId, projectReleaseId: identity.projectReleaseId, queryId: "actual" },
  },
  dataQuality: { status: "complete", coveragePct: 100, validIntervalCount: 1, expectedMeterIntervalCount: 1, qualityEventCount: 0 },
  metadata: { selectedScope: { status: "available" } },
  analysis: {
    summary: { usageKwh: 100, averageDailyUsageKwh: 3, peakKw: 10 },
    comparison: { usageKwh: 90, changeKwh: 10 },
    categories: [],
    childScopes: [],
    topCircuits: [],
    offHours: { status: "unavailable" },
  },
} as unknown as ProjectAnalysisSnapshot);

const evidenceRefForSlot = (slotId: string, dataSnapshotId: string): string => {
  if (slotId === "centre-benchmark") return `preschool:${dataSnapshotId}:section-2-benchmark:portfolio`;
  if (slotId === "standby-wastage") return `preschool:${dataSnapshotId}:section-3-standby:summary`;
  if (slotId === "operating-behaviour") return `preschool:${dataSnapshotId}:section-4-operating:summary`;
  if (slotId === "planning-outlook") return `preschool:${dataSnapshotId}:section-5-planning-outlook`;
  if (slotId === "executive-summary") return "analysis.summary.usage_kwh";
  return "analysis.summary.peak_kw";
};

const mockPublishedSlotDefinitions = (
  metadata: ReturnType<typeof createMetadataStore>,
  revisionId: string,
  options: { validatorRevision?: string } = {},
): void => {
  vi.spyOn(metadata.energyIq.overviewDefinitions, "get").mockImplementation((requestedRevisionId) => (
    requestedRevisionId === revisionId ? {
      definition: {
        aiSlots: PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId, order) => ({
          slotId,
          revision: `test-${slotId}@1`,
          role: slotId,
          label: slotId,
          order,
          regionIntent: "test region",
          businessObjective: "test objective",
          audience: "test audience",
          decisionUse: "test decision",
          presentationIntent: ["test intent"],
          skillId: "energyiq-evidence-first",
          skillRevision: "1",
          methodId: "preschool-html-slot-method",
          methodRevision: "1",
          contextRevision: "preschool-html-slot-context@2",
          toolPolicyRevision: "none@1",
          outputContractRevision: "energyiq-ai-slot-html-artifact@1",
          validatorRevision: options.validatorRevision ?? "preschool-html-ai-slot-validator@13",
          presentationReferenceRevision: "preschool-html-slot-presentation@1",
        })),
      },
    } : null
  ) as never);
};

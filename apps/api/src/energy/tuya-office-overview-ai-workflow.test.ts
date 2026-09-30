import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createTuyaOfficeOverviewAiSectionArtifactIdentity,
} from "./overview-ai-artifact.js";
import type { NgeeAnnExecutiveRunner } from "./ngee-ann-executive-synthesis.js";
import { createTuyaOfficeOverviewAiWorkflow } from "./tuya-office-overview-ai-workflow.js";
import { tuyaOfficeAiSurfaceFixture } from "./tuya-office-ai-surface.test-fixture.js";
import type {
  TuyaOfficeSectionId,
  TuyaOfficeSectionPack,
  TuyaOfficeSectionPacks,
} from "./tuya-office-section-pack.js";

describe("createTuyaOfficeOverviewAiWorkflow", () => {
  it("generates all three governed Tuya Sections from the same pinned Snapshot", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const runSection = vi.fn(async (input: {
      runId: string;
      sessionId: string;
      identity: EnergyIqOverviewAiArtifactIdentity;
    }) => ({
      answer: JSON.stringify({
        sectionId: input.identity.targetId,
        status: "available",
        summary: {
          text: "The office used 1200 kWh in the current reporting window.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.usageKwh"],
        },
        candidates: [{
          id: "shared-review",
          title: `Review ${input.identity.targetId}`,
          text: "The accepted Section supports a management review.",
          epistemicStatus: "inferred",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: [],
        }],
      }),
      runId: input.runId,
      sessionId: input.sessionId,
    }));
    const runExecutive = vi.fn(async (input: Parameters<NgeeAnnExecutiveRunner>[0]) => ({
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "Data readiness and demand evidence support one coordinated management review.",
          evidenceRefs: ["evidence:tuya:summary"],
        },
        findings: [{
          id: "coordinated-review",
          title: "Coordinate data readiness and demand review",
          text: "Review demand only alongside the accepted data-readiness limits.",
          epistemicStatus: "inferred",
          sectionIds: ["data-readiness", "consumption-and-demand"],
          sourceInsightIds: ["data-readiness::shared-review", "consumption-and-demand::shared-review"],
          evidenceRefs: ["evidence:tuya:summary"],
        }],
      }),
      runId: input.runId,
      sessionId: input.sessionId,
    }));
    const resolvePacks = vi.fn().mockResolvedValue(sectionPacks());
    const workflow = createTuyaOfficeOverviewAiWorkflow({
      metadataStore: metadataStore(records),
      dataGateway: {} as never,
      runSection,
      runExecutive,
      resolvePacks,
      assertRuntimeIdentity: vi.fn(),
      resolveModelProfileSnapshot: () => ({ bindingRevision: 8 } as never),
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    const result = await workflow.execute({ identity: baseIdentity(), user: user() });

    expect(result.sections).toMatchObject({
      "data-readiness": { status: "available" },
      "consumption-and-demand": { status: "available" },
      "meter-contribution-and-operations": { status: "available" },
    });
    expect(result.executive).toMatchObject({ status: "available" });
    expect(Object.values(result.sections).map((record) =>
      JSON.parse(record!.result_json!).insights[0].id).sort()).toEqual([
      "consumption-and-demand::shared-review",
      "data-readiness::shared-review",
      "meter-contribution-and-operations::shared-review",
    ]);
    expect(runSection).toHaveBeenCalledTimes(3);
    expect(runExecutive).toHaveBeenCalledTimes(1);
    expect(runExecutive.mock.calls[0]?.[0].prompt).toContain("Do not repeat numeric values in Key Findings");
    expect(resolvePacks).toHaveBeenCalledWith({
      identity: expect.objectContaining({
        projectId: "tuya-office",
        dataSnapshotId: "snapshot-tuya-aug-20",
      }),
      user: expect.objectContaining({ id: "admin-charles" }),
    });
    expect(runSection.mock.calls.map(([call]) => call.identity.targetId).sort()).toEqual([
      "consumption-and-demand",
      "data-readiness",
      "meter-contribution-and-operations",
    ]);
    expect(runSection.mock.calls.every(([call]) => call.identity.projectId === "tuya-office"
      && call.identity.rendererKey === "tuya-office-overview"
      && call.identity.identityContractRevision === "tuya-office-section-v3")).toBe(true);
  });

  it("retries only the targeted Section and leaves a missing sibling untouched", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    for (const sectionId of ["consumption-and-demand"] as const) {
      const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
        baseIdentity: baseIdentity(),
        targetId: sectionId,
        unit: tuyaOfficeAiSurfaceFixture().sections.find(({ id }) => id === sectionId)!,
      });
      records.set(JSON.stringify(identity), {
        ...artifactRecord(identity, "available", "admin-charles"),
        result_json: JSON.stringify({ status: "empty", sectionId }),
      });
    }
    const runSection = vi.fn(async ({ runId, sessionId, identity }: {
      runId: string;
      sessionId: string;
      identity: EnergyIqOverviewAiArtifactIdentity;
    }) => ({
      answer: JSON.stringify({
        sectionId: identity.targetId,
        status: "available",
        summary: {
          text: "The office used 1200 kWh.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.usageKwh"],
        },
        candidates: [],
      }),
      runId,
      sessionId,
    }));
    const workflow = createTuyaOfficeOverviewAiWorkflow({
      metadataStore: metadataStore(records),
      dataGateway: {} as never,
      runSection,
      resolvePacks: vi.fn().mockResolvedValue(sectionPacks()),
      assertRuntimeIdentity: vi.fn(),
      resolveModelProfileSnapshot: () => ({ bindingRevision: 8 } as never),
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    await workflow.execute({
      identity: baseIdentity(),
      user: user(),
      retryTarget: "meter-contribution-and-operations",
    });

    expect(runSection).toHaveBeenCalledTimes(1);
    expect(runSection.mock.calls[0]?.[0].identity.targetId)
      .toBe("meter-contribution-and-operations");
    expect([...records.values()].some(({ identity_json }) => (
      JSON.parse(identity_json) as EnergyIqOverviewAiArtifactIdentity
    ).targetId === "data-readiness")).toBe(false);
  });

  it("rejects unknown retry targets before invoking the Provider", async () => {
    const runSection = vi.fn();
    const resolvePacks = vi.fn();
    const workflow = createTuyaOfficeOverviewAiWorkflow({
      metadataStore: metadataStore(new Map()),
      dataGateway: {} as never,
      runSection,
      resolvePacks,
      resolveModelProfileSnapshot: () => ({ bindingRevision: 8 } as never),
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    await expect(workflow.execute({
      identity: baseIdentity(),
      user: user(),
      retryTarget: "not-a-tuya-section",
    })).rejects.toThrow("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_RETRY_TARGET_INVALID");
    expect(resolvePacks).not.toHaveBeenCalled();
    expect(runSection).not.toHaveBeenCalled();
  });

  it("rejects a stale model binding before resolving facts or calling the Provider", async () => {
    const runSection = vi.fn();
    const resolvePacks = vi.fn();
    const workflow = createTuyaOfficeOverviewAiWorkflow({
      metadataStore: metadataStore(new Map()),
      dataGateway: {} as never,
      runSection,
      resolvePacks,
      assertRuntimeIdentity: vi.fn(),
      resolveModelProfileSnapshot: () => ({ bindingRevision: 9 } as never),
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    await expect(workflow.execute({ identity: baseIdentity(), user: user() }))
      .rejects.toThrow("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
    expect(resolvePacks).not.toHaveBeenCalled();
    expect(runSection).not.toHaveBeenCalled();
  });
});

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "tuya-office",
  projectId: "tuya-office",
  scopeId: "tuya-office-project",
  dataSnapshotId: "snapshot-tuya-aug-20",
  projectReleaseId: "tuya-office-template-v1",
  analysisPeriodFrom: "2026-07-31T16:00:00.000Z",
  analysisPeriodTo: "2026-08-20T16:00:00.000Z",
  rendererKey: "tuya-office-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
  reportTimeIdentity: {
    reportTimePolicyId: "tuya-office-report-time",
    reportTimePolicyRevision: "2",
    reportTimeContextFingerprint: "sha256:tuya-office-current-overview",
  },
});

const user = (): UserRecord => ({ id: "admin-charles" } as UserRecord);

const consumptionPack = (): TuyaOfficeSectionPack<"consumption-and-demand"> => ({
  contract: { id: "tuya-office-section-pack", revision: "tuya-office-section-pack-v4" },
  sectionId: "consumption-and-demand",
  audience: "office facilities and energy managers",
  analysisGoal: "Identify decision-relevant changes in use and demand.",
  binding: {
    workspaceId: "tuya-office",
    projectId: "tuya-office",
    scopeId: "tuya-office-project",
    dataSnapshotId: "snapshot-tuya-aug-20",
    projectReleaseId: "tuya-office-template-v1",
    analysisPeriod: {
      from: "2026-07-31T16:00:00.000Z",
      to: "2026-08-20T16:00:00.000Z",
    },
    rendererKey: "tuya-office-overview",
  },
  reportTime: {
    timezone: "Asia/Singapore",
    policyId: "tuya-office-report-time",
    policyRevision: "2",
    window: {
      windowId: "current-overview",
      role: "recent_operations",
      label: "Current calendar month through the latest complete day",
      phase: "partial",
      from: "2026-07-31T16:00:00.000Z",
      toExclusive: "2026-08-20T16:00:00.000Z",
      fromLocalDate: "2026-08-01",
      toExclusiveLocalDate: "2026-08-21",
      inclusiveToLocalDate: "2026-08-20",
      displayLabel: "1 Aug 2026–20 Aug 2026",
    },
  },
  evidence: [{
    id: "evidence:tuya:summary",
    metricId: "energy.total_usage_kwh@1",
    queryIds: ["scope_summary_v1"],
  }],
  facts: {
    summary: {
      usageKwh: 1200,
      averageDailyUsage: {
        status: "available",
        valueKwh: 60,
        basis: "complete-report-period",
      },
      peakKw: 48,
      validIntervalCount: 1920,
      qualityEventCount: 0,
    },
    comparison: {
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-20T16:00:00.000Z",
      usageKwh: 1100,
      changeKwh: 100,
      changePct: 9.09,
    },
    cost: { status: "unavailable", reason: { code: "TARIFF_VERSION_MISSING", message: "Tariff unavailable" } },
  } as unknown as TuyaOfficeSectionPack<"consumption-and-demand">["facts"],
  limitations: [],
  missingEvidence: [],
  capabilities: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
});

const sectionPack = <SectionId extends TuyaOfficeSectionId>(
  sectionId: SectionId,
): TuyaOfficeSectionPack<SectionId> => ({
  ...consumptionPack(),
  sectionId,
  facts: consumptionPack().facts as unknown as TuyaOfficeSectionPack<SectionId>["facts"],
});

const sectionPacks = (): TuyaOfficeSectionPacks => ({
  "data-readiness": sectionPack("data-readiness"),
  "consumption-and-demand": sectionPack("consumption-and-demand"),
  "meter-contribution-and-operations": sectionPack("meter-contribution-and-operations"),
});

const metadataStore = (
  records: Map<string, EnergyIqOverviewAiArtifactRecord>,
): MetadataStore => ({
  energyIq: {
    overviewAiArtifacts: fakeArtifactStore(records),
  },
} as unknown as MetadataStore);

const fakeArtifactStore = (
  records: Map<string, EnergyIqOverviewAiArtifactRecord>,
) => ({
  find: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity)),
  get: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity))!,
  queue: ({ identity, triggeredBy }: { identity: EnergyIqOverviewAiArtifactIdentity; triggeredBy: string }) => {
    const record = artifactRecord(identity, "queued", triggeredBy);
    records.set(JSON.stringify(identity), record);
    return record;
  },
  claim: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "running", "admin-charles");
    records.set(JSON.stringify(identity), record);
    return { claimed: true, artifact: record };
  },
  complete: ({ identity, resultJson, runId, sessionId }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    resultJson: string;
    runId: string;
    sessionId: string;
  }) => {
    const record = {
      ...artifactRecord(identity, "available", "admin-charles"),
      result_json: resultJson,
      run_id: runId,
      session_id: sessionId,
    };
    records.set(JSON.stringify(identity), record);
    return record;
  },
  fail: ({ identity, errorCode }: { identity: EnergyIqOverviewAiArtifactIdentity; errorCode: string }) => {
    const record = {
      ...artifactRecord(identity, "failed", "admin-charles"),
      error_code: errorCode,
    };
    records.set(JSON.stringify(identity), record);
    return record;
  },
});

const artifactRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: EnergyIqOverviewAiArtifactRecord["status"],
  triggeredBy: string,
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${identity.targetId}`,
  identity_hash: "identity-hash",
  identity_json: JSON.stringify(identity),
  workspace_id: identity.workspaceId,
  project_id: identity.projectId,
  scope_id: identity.scopeId,
  resource: "electricity",
  data_snapshot_id: identity.dataSnapshotId,
  project_release_id: identity.projectReleaseId,
  renderer_key: identity.rendererKey,
  renderer_version: identity.rendererVersion,
  analysis_pack_id: identity.analysisPackId,
  analysis_pack_revision: identity.analysisPackRevision,
  model_profile_id: identity.modelProfileId,
  model_profile_revision: identity.modelProfileRevision,
  output_contract_revision: identity.outputContractRevision,
  validator_revision: identity.validatorRevision,
  status,
  attempt_count: status === "queued" ? 0 : 1,
  triggered_by: triggeredBy,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:01:00.000Z",
});

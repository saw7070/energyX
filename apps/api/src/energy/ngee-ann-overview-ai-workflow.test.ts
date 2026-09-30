import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import { SINGAPORE_2026_PUBLIC_HOLIDAYS } from "./ngee-ann-calendar-policy.js";
import {
  areNgeeAnnSectionArtifactsTerminal,
  createNgeeAnnOverviewAiWorkflow,
  isNgeeAnnOverviewAiGenerationTerminal,
  requireNgeeAnnAdditionalInsightsReady,
} from "./ngee-ann-overview-ai-workflow.js";
import {
  NGEE_ANN_CORE_AI_SECTION_IDS,
  NGEE_ANN_SECTION_IDS,
  type NgeeAnnSectionId,
  type NgeeAnnSectionPacks,
} from "./ngee-ann-section-pack.js";

describe("Ngee Ann Overview AI workflow", () => {
  it("runs five exact Snapshot-bound Sections before synthesizing Key Findings", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    const sectionCalls: EnergyIqOverviewAiArtifactIdentity[] = [];
    const executiveCalls: EnergyIqOverviewAiArtifactIdentity[] = [];
    const sectionProfileSnapshots: unknown[] = [];
    const executiveProfileSnapshots: unknown[] = [];
    const trustedSnapshot = modelProfileSnapshot();
    const workflow = createNgeeAnnOverviewAiWorkflow({
      metadataStore: metadataStoreWithManifest(store, true),
      dataGateway: {} as never,
      assertRuntimeIdentity: vi.fn(),
      resolveModelProfileSnapshot: () => trustedSnapshot,
      resolvePacks: vi.fn().mockResolvedValue(packs()),
      runSection: async ({ identity, runId, sessionId, modelProfileSnapshot: snapshot }) => {
        sectionCalls.push(identity);
        sectionProfileSnapshots.push(snapshot);
        return {
          answer: JSON.stringify({
            sectionId: identity.targetId,
            status: "available",
            summary: { text: "This Section has a current supported conclusion.", evidenceRefs: ["evidence:ngee"] },
            candidates: [],
          }),
          runId,
          sessionId,
        };
      },
      runExecutive: async ({ identity, runId, sessionId, modelProfileSnapshot: snapshot }) => {
        executiveCalls.push(identity);
        executiveProfileSnapshots.push(snapshot);
        return { answer: JSON.stringify({ status: "empty", findings: [] }), runId, sessionId };
      },
    });

    const result = await workflow.execute({ identity: baseIdentity(), user: user() });

    expect(sectionCalls.map(({ targetId }) => targetId).sort()).toEqual([...NGEE_ANN_SECTION_IDS].sort());
    expect(sectionCalls.every(({ dataSnapshotId, rendererKey, identityContractRevision }) =>
      dataSnapshotId === "snapshot-ngee"
      && rendererKey === "ngee-ann-overview"
      && identityContractRevision === "ngee-ann-section-v16")).toBe(true);
    expect(executiveCalls).toHaveLength(1);
    expect(sectionProfileSnapshots).toEqual(Array.from({ length: 5 }, () => trustedSnapshot));
    expect(executiveProfileSnapshots).toEqual([trustedSnapshot]);
    expect(executiveCalls[0]).toMatchObject({
      artifactKind: "executive-synthesis",
      identityContractRevision: "ngee-ann-executive-v7",
      dataSnapshotId: "snapshot-ngee",
    });
    expect(Object.values(result.sections).every(({ status }) => status === "available")).toBe(true);
    expect(result.executive?.status).toBe("available");
  });

  it("does not queue or call the fifth Section for an exact historical four-section Release", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    const runSection = vi.fn(async ({ identity, runId, sessionId }) => ({
      answer: JSON.stringify({
        sectionId: identity.targetId,
        status: "available",
        summary: { text: "Historical exact Section.", evidenceRefs: ["evidence:ngee"] },
        candidates: [],
      }),
      runId,
      sessionId,
    }));
    const workflow = createNgeeAnnOverviewAiWorkflow({
      metadataStore: metadataStoreWithManifest(store, false),
      dataGateway: {} as never,
      assertRuntimeIdentity: vi.fn(),
      resolveModelProfileSnapshot: () => modelProfileSnapshot(),
      resolvePacks: vi.fn().mockResolvedValue(packs()),
      runSection,
      runExecutive: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({ status: "empty", findings: [] }),
        runId,
        sessionId,
      }),
    });

    const result = await workflow.execute({ identity: baseIdentity(), user: user() });

    expect(runSection.mock.calls.map(([call]) => call.identity.targetId).sort())
      .toEqual([...NGEE_ANN_CORE_AI_SECTION_IDS].sort());
    expect(result.sections["school-holiday-comparison"]).toBeUndefined();
    expect([...records.values()].some(({ identity_json }) => (
      JSON.parse(identity_json).targetId === "school-holiday-comparison"
    ))).toBe(false);
  });

  it("waits for every independent Section to become terminal", () => {
    const terminal = Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [sectionId, { status: "available" }])) as
      Record<NgeeAnnSectionId, Pick<EnergyIqOverviewAiArtifactRecord, "status">>;
    expect(areNgeeAnnSectionArtifactsTerminal(terminal)).toBe(true);
    expect(areNgeeAnnSectionArtifactsTerminal({
      ...terminal,
      "time-behaviour": { status: "running" },
    })).toBe(false);
  });

  it("does not consider Layer 1/2 ready while Key Findings is still running", () => {
    const terminal = Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [sectionId, { status: "available" }])) as
      Record<NgeeAnnSectionId, Pick<EnergyIqOverviewAiArtifactRecord, "status">>;

    expect(isNgeeAnnOverviewAiGenerationTerminal({
      sections: terminal,
      executive: { status: "running" },
    }, NGEE_ANN_SECTION_IDS)).toBe(false);
    expect(isNgeeAnnOverviewAiGenerationTerminal({
      sections: terminal,
      executive: { status: "available" },
    }, NGEE_ANN_SECTION_IDS)).toBe(true);
    expect(() => requireNgeeAnnAdditionalInsightsReady({
      sections: terminal,
      executive: { status: "running" },
    }, NGEE_ANN_SECTION_IDS)).toThrowError("ENERGYIQ_NGEE_ANN_ADDITIONAL_INSIGHTS_CORE_NOT_READY");
    expect(requireNgeeAnnAdditionalInsightsReady({
      sections: { ...terminal, "time-behaviour": { status: "empty" } },
      keyFindings: { status: "empty" },
    }, NGEE_ANN_SECTION_IDS)).toEqual({
      sections: { ...terminal, "time-behaviour": { status: "empty" } },
      keyFindings: { status: "empty" },
    });
  });

  it("treats the exact historical four-section Release as ready without inventing Holiday", () => {
    const terminal = Object.fromEntries(NGEE_ANN_CORE_AI_SECTION_IDS.map((sectionId) => [
      sectionId,
      { status: "available" },
    ]));

    expect(isNgeeAnnOverviewAiGenerationTerminal({
      sections: terminal,
      executive: { status: "available" },
    }, NGEE_ANN_CORE_AI_SECTION_IDS)).toBe(true);
    expect(requireNgeeAnnAdditionalInsightsReady({
      sections: terminal,
      executive: { status: "available" },
    }, NGEE_ANN_CORE_AI_SECTION_IDS)).toEqual({
      sections: terminal,
      executive: { status: "available" },
    });
  });
});

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "workspace-ngee",
  projectId: "ngee-ann-polytechnic",
  scopeId: "ngee-ann-polytechnic",
  dataSnapshotId: "snapshot-ngee",
  projectReleaseId: "release-ngee",
  analysisPeriodFrom: "2026-05-19T16:00:00.000Z",
  analysisPeriodTo: "2026-06-16T16:00:00.000Z",
  rendererKey: "ngee-ann-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
});

const user = (): UserRecord => ({ id: "dev-user" } as UserRecord);

const modelProfileSnapshot = () => ({
  bindingRevision: 8,
  profiles: [{
    exposedId: "workspace-default-model-profile",
    ownerWorkspaceId: "default",
    ownerUserId: "dev-user",
    resource: {
      kind: "model-profile",
      status: "connected",
      default_enabled: true,
      payload: {},
    },
  }],
}) as never;

const metadataStoreWithManifest = (
  store: ReturnType<typeof fakeArtifactStore>,
  holidayEnabled: boolean,
): MetadataStore => ({
  energyIq: {
    overviewAiArtifacts: store,
    templates: {
      getProjectRevision: vi.fn().mockReturnValue({
        revision_id: "release-ngee",
        project_id: "ngee-ann-polytechnic",
        business_calendar_version: holidayEnabled ? "sg-calendar-holiday-v2" : "sg-calendar-v1",
        selected_rule_revision_ids: holidayEnabled ? ["comparison.school_holiday_context@1"] : [],
      }),
    },
    overviewDefinitions: {
      get: vi.fn().mockReturnValue(holidayEnabled ? {
        template_revision_id: "release-ngee",
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "ngee-ann-report-time@2",
        definition: {
          sections: [{
            key: "school-holiday-comparison",
            primaryWindowId: "school-holiday-comparison",
            supportingWindowIds: [],
            blocks: [{ windowId: "school-holiday-comparison" }],
          }],
        },
      } : null),
    },
    reportTimePolicies: {
      get: vi.fn().mockReturnValue({
        revision_id: "ngee-ann-report-time@2",
        policy: { windows: [{
          windowId: "school-holiday-comparison",
          role: "comparison",
          strategy: { kind: "rolling_complete_days", days: 120 },
        }] },
      }),
    },
      operationalPolicy: {
        listOperatingCalendars: vi.fn().mockReturnValue(holidayEnabled ? [{
          version_id: "sg-calendar-holiday-v2",
          academic_periods: [{ academic_phase: "teaching" }],
          entries: [{
            weekly: {
              monday: [{ from: "08:00", to: "18:00" }],
              tuesday: [{ from: "08:00", to: "18:00" }],
              wednesday: [{ from: "08:00", to: "18:00" }],
              thursday: [{ from: "08:00", to: "18:00" }],
              friday: [{ from: "08:00", to: "18:00" }],
              saturday: [],
              sunday: [],
            },
            exceptions: SINGAPORE_2026_PUBLIC_HOLIDAYS.map(({ date }) => ({
              date,
              classification: "public_holiday",
            })),
          }],
        }] : []),
      },
    rules: {
      listRevisions: vi.fn().mockReturnValue(holidayEnabled
        ? [{ revision_id: "comparison.school_holiday_context@1" }]
        : []),
    },
  },
} as unknown as MetadataStore);

const packs = (): NgeeAnnSectionPacks => Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [sectionId, {
  contract: { id: "ngee-ann-section-pack", revision: "ngee-ann-section-pack-v2" },
  sectionId,
  audience: "facilities and energy managers",
  analysisGoal: "Find a useful current angle.",
  binding: {
    workspaceId: "workspace-ngee", projectId: "ngee-ann-polytechnic", scopeId: "ngee-ann-polytechnic",
    dataSnapshotId: "snapshot-ngee", projectReleaseId: "release-ngee",
    analysisPeriod: { from: "2026-05-19T16:00:00.000Z", to: "2026-06-16T16:00:00.000Z" },
    rendererKey: "ngee-ann-overview",
  },
  reportTime: {
    timezone: "Asia/Singapore",
    analysisWindow: {
      fromLocalDate: "2026-05-20",
      toExclusiveLocalDate: "2026-06-17",
      inclusiveToLocalDate: "2026-06-16",
      displayLabel: "20 May 2026–16 Jun 2026",
    },
  },
  evidence: [{ id: "evidence:ngee", metricId: "energy.total_usage_kwh@1", queryIds: ["scope_summary_v1"] }],
  facts: sectionId === "trend-and-demand" ? {
    summary: {
      usageKwh: 100,
      averageDailyUsageKwh: 10,
      peakKw: 20,
      peakAt: "2026-06-05T06:15:00.000Z",
      validIntervalCount: 1,
      qualityEventCount: 0,
    },
    comparison: {
      from: "2026-04-21T16:00:00.000Z",
      to: "2026-05-19T16:00:00.000Z",
      usageKwh: 90,
      changeKwh: 10,
      changePct: 11.11,
    },
  } : sectionId === "circuit-concentration" ? {
    levels: [],
    circuits: [],
  } : {},
  dataQuality: { status: "complete", coveragePct: 100, importBatchIds: [] },
  limitations: [],
  missingEvidence: [],
  capabilities: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
}])) as unknown as NgeeAnnSectionPacks;

const fakeArtifactStore = (records: Map<string, EnergyIqOverviewAiArtifactRecord>) => ({
  find: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity)),
  get: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity))!,
  queue: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "queued");
    records.set(JSON.stringify(identity), record);
    return record;
  },
  claim: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "running");
    records.set(JSON.stringify(identity), record);
    return { claimed: true, artifact: record };
  },
  complete: ({ identity, resultJson }: { identity: EnergyIqOverviewAiArtifactIdentity; resultJson: string }) => {
    const record = { ...artifactRecord(identity, "available"), result_json: resultJson };
    records.set(JSON.stringify(identity), record);
    return record;
  },
  fail: ({ identity, errorCode }: { identity: EnergyIqOverviewAiArtifactIdentity; errorCode: string }) => {
    const record = { ...artifactRecord(identity, "failed"), error_code: errorCode };
    records.set(JSON.stringify(identity), record);
    return record;
  },
});

const artifactRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: EnergyIqOverviewAiArtifactRecord["status"],
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${identity.artifactKind}:${identity.targetId}`,
  identity_hash: `hash:${identity.targetId}`,
  identity_json: JSON.stringify(identity),
  workspace_id: identity.workspaceId, project_id: identity.projectId, scope_id: identity.scopeId,
  resource: "electricity", data_snapshot_id: identity.dataSnapshotId, project_release_id: identity.projectReleaseId,
  renderer_key: identity.rendererKey, renderer_version: identity.rendererVersion,
  analysis_pack_id: identity.analysisPackId, analysis_pack_revision: identity.analysisPackRevision,
  model_profile_id: identity.modelProfileId, model_profile_revision: identity.modelProfileRevision,
  output_contract_revision: identity.outputContractRevision, validator_revision: identity.validatorRevision,
  status, attempt_count: status === "queued" ? 0 : 1, triggered_by: "dev-user",
  created_at: "2026-08-17T00:00:00.000Z", updated_at: "2026-08-17T00:01:00.000Z",
});

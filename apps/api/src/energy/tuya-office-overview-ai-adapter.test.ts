import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createTuyaOfficeAdditionalAiInsightArtifactIdentity,
  createTuyaOfficeOverviewAiSectionArtifactIdentity,
} from "./overview-ai-artifact.js";
import { createTuyaOfficeProjectOverviewAiAdapter } from "./tuya-office-overview-ai-adapter.js";
import { tuyaOfficeAiSurfaceFixture } from "./tuya-office-ai-surface.test-fixture.js";

describe("createTuyaOfficeProjectOverviewAiAdapter", () => {
  it("restores exact stored Tuya units without queueing or Provider work", async () => {
    const identity = baseIdentity();
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const surface = tuyaOfficeAiSurfaceFixture();
    const consumption = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: identity,
      targetId: "consumption-and-demand",
      unit: surface.sections.find(({ id }) => id === "consumption-and-demand")!,
    });
    records.set(key(consumption), availableRecord(consumption, "available"));
    const additional = createTuyaOfficeAdditionalAiInsightArtifactIdentity({ baseIdentity: identity, unit: surface.additionalInsights! });
    records.set(key(additional), availableRecord(additional, "empty"));
    const find = vi.fn((candidate: EnergyIqOverviewAiArtifactIdentity) => records.get(key(candidate)));
    const queue = vi.fn();
    const executeMissing = vi.fn();
    const adapter = createTuyaOfficeProjectOverviewAiAdapter({
      metadataStore: metadataStore(find, queue),
      dataGateway: {} as never,
      resolveBaseIdentity: vi.fn().mockResolvedValue(identity),
      executeMissing,
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    const readModel = await adapter.readExact({ identity, user: user() });

    expect(adapter).toMatchObject({
      projectId: "tuya-office",
      rendererKey: "tuya-office-overview",
      keyFindings: false,
      sections: [],
      additionalInsights: false,
    });
    expect(readModel).toMatchObject({
      contract: "energyiq-project-overview-ai-read-model@1",
      rendererKey: "tuya-office-overview",
      binding: {
        projectId: "tuya-office",
        dataSnapshotId: "tuya-snapshot-a",
      },
      keyFindings: { status: "missing" },
      sections: {
        "data-readiness": { status: "missing" },
        "consumption-and-demand": { status: "available" },
        "meter-contribution-and-operations": { status: "missing" },
      },
      additionalInsights: { status: "empty" },
      surface,
    });
    expect(find).toHaveBeenCalledTimes(5);
    expect(queue).not.toHaveBeenCalled();
    expect(executeMissing).not.toHaveBeenCalled();

    const snapshotB = { ...identity, dataSnapshotId: "tuya-snapshot-b" };
    const snapshotBModel = await adapter.readExact({ identity: snapshotB, user: user() });
    expect(snapshotBModel).toMatchObject({
      binding: { dataSnapshotId: "tuya-snapshot-b" },
      keyFindings: { status: "missing" },
      sections: {
        "data-readiness": { status: "missing" },
        "consumption-and-demand": { status: "missing" },
        "meter-contribution-and-operations": { status: "missing" },
      },
      additionalInsights: { status: "missing" },
    });
  });

  it("delegates explicit Admin generation and returns newly stored exact units", async () => {
    const identity = baseIdentity();
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const find = vi.fn((candidate: EnergyIqOverviewAiArtifactIdentity) => records.get(key(candidate)));
    const executeMissing = vi.fn(async () => {
      const section = createTuyaOfficeOverviewAiSectionArtifactIdentity({
        baseIdentity: identity,
        targetId: "consumption-and-demand",
        unit: tuyaOfficeAiSurfaceFixture().sections.find(({ id }) => id === "consumption-and-demand")!,
      });
      records.set(key(section), availableRecord(section, "available"));
    });
    const adapter = createTuyaOfficeProjectOverviewAiAdapter({
      metadataStore: metadataStore(find),
      dataGateway: {} as never,
      resolveBaseIdentity: vi.fn().mockResolvedValue(identity),
      executeMissing,
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    const readModel = await adapter.generateMissing({
      identity,
      user: user(),
      retryTarget: "consumption-and-demand",
    });

    expect(executeMissing).toHaveBeenCalledWith({
      identity,
      user: expect.objectContaining({ id: "dev-user" }),
      retryTarget: "consumption-and-demand",
    });
    expect(readModel.sections["consumption-and-demand"]).toMatchObject({ status: "available" });
  });

  it("fails closed when another generic Project identity reaches the adapter", async () => {
    const identity = baseIdentity();
    const adapter = createTuyaOfficeProjectOverviewAiAdapter({
      metadataStore: metadataStore(vi.fn()),
      dataGateway: {} as never,
      resolveBaseIdentity: vi.fn().mockResolvedValue(identity),
      executeMissing: vi.fn(),
      resolveSurface: tuyaOfficeAiSurfaceFixture,
    });

    await expect(adapter.readExact({
      identity: { ...identity, projectId: "another-generic-project" },
      user: user(),
    })).rejects.toThrow("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");
  });
});

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "tuya-office",
  projectId: "tuya-office",
  scopeId: "tuya-office-project",
  dataSnapshotId: "tuya-snapshot-a",
  projectReleaseId: "tuya-release-v1",
  analysisPeriodFrom: "2026-07-31T16:00:00.000Z",
  analysisPeriodTo: "2026-08-21T16:00:00.000Z",
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

const metadataStore = (
  find: ReturnType<typeof vi.fn>,
  queue = vi.fn(),
): MetadataStore => ({
  energyIq: {
    overviewAiArtifacts: { find, queue },
    insightMethodGovernance: { listPublishedWorkspaceMethodResources: vi.fn().mockReturnValue([]) },
  },
} as unknown as MetadataStore);

const user = (): UserRecord => ({ id: "dev-user" } as UserRecord);

const key = (identity: EnergyIqOverviewAiArtifactIdentity): string => JSON.stringify(identity);

const availableRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: "available" | "empty",
): EnergyIqOverviewAiArtifactRecord => ({
  id: identity.targetId ?? "artifact",
  identity_hash: "hash",
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
  status: "available",
  attempt_count: 1,
  triggered_by: "dev-user",
  result_json: JSON.stringify({ status, sectionId: identity.targetId }),
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:01:00.000Z",
  completed_at: "2026-08-23T00:01:00.000Z",
});

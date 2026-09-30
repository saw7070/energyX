import { describe, expect, it } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createNgeeAnnAdditionalAiInsightArtifactIdentity,
  createNgeeAnnOverviewAiExecutiveArtifactIdentity,
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
  createTuyaOfficeAdditionalAiInsightArtifactIdentity,
  createTuyaOfficeOverviewAiExecutiveArtifactIdentity,
  createTuyaOfficeOverviewAiSectionArtifactIdentity,
  isCurrentPreschoolAdditionalAiInsightArtifactIdentity,
  isCurrentProjectAdditionalAiInsightArtifactIdentity,
  overviewAiArtifactPinnedLocalPeriod,
  requireCurrentTuyaOfficeBaseIdentity,
} from "./overview-ai-artifact.js";
import { tuyaOfficeAiSurfaceFixture } from "./tuya-office-ai-surface.test-fixture.js";

describe("Tuya Office current Overview AI identities", () => {
  it("rotates Section, Key Findings and Additional Artifacts with one exact Snapshot identity", () => {
    const base = createOverviewAiArtifactIdentity({
      workspaceId: "tuya-office",
      projectId: "tuya-office",
      scopeId: "tuya-office-project",
      dataSnapshotId: "snapshot-tuya-a",
      projectReleaseId: "tuya-release-v1",
      analysisPeriodFrom: "2026-07-31T16:00:00.000Z",
      analysisPeriodTo: "2026-08-31T16:00:00.000Z",
      rendererKey: "tuya-office-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default-model-profile",
      modelProfileRevision: 8,
      reportTimeIdentity: {
        reportTimePolicyId: "tuya-office-report-time",
        reportTimePolicyRevision: "2",
        reportTimeContextFingerprint: "sha256:tuya-office-current-overview-a",
      },
    });
    const surface = tuyaOfficeAiSurfaceFixture();
    const consumptionUnit = surface.sections.find(({ id }) => id === "consumption-and-demand")!;
    const section = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: base,
      targetId: "consumption-and-demand",
      unit: consumptionUnit,
    });
    const executive = createTuyaOfficeOverviewAiExecutiveArtifactIdentity({
      baseIdentity: base,
      targetId: "sections:current-v1",
      unit: surface.keyFindings!,
    });
    const additional = createTuyaOfficeAdditionalAiInsightArtifactIdentity({ baseIdentity: base, unit: surface.additionalInsights! });

    expect(section).toMatchObject({
      identityContractRevision: "tuya-office-section-v3",
      dataSnapshotId: "snapshot-tuya-a",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      capabilityRevision: "pack-only-v1",
      outputContractRevision: "energyiq-project-section-interpretation-v2",
      validatorRevision: "tuya-office-section-acceptance-v4",
    });
    expect(executive).toMatchObject({
      identityContractRevision: "tuya-office-executive-v1",
      dataSnapshotId: "snapshot-tuya-a",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      capabilityRevision: "section-artifacts-v1",
      outputContractRevision: "energyiq-project-executive-synthesis-v1",
      validatorRevision: "tuya-office-executive-acceptance-v1",
    });
    expect(additional).toMatchObject({
      identityContractRevision: "tuya-office-additional-insights-v2",
      analysisPackId: "tuya-office-additional-insights-pack",
      validatorRevision: "additional-insights-acceptance-v19",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      capabilityRevision: "scoped-read-only-v1",
      dataSnapshotId: "snapshot-tuya-a",
    });
    expect(isCurrentProjectAdditionalAiInsightArtifactIdentity(additional)).toBe(true);
    expect(requireCurrentTuyaOfficeBaseIdentity(base)).toEqual(base);
    const {
      reportTimeContextFingerprint: _reportTimeContextFingerprint,
      reportTimePolicyId: _reportTimePolicyId,
      reportTimePolicyRevision: _reportTimePolicyRevision,
      ...withoutReportTime
    } = base;
    expect(() => requireCurrentTuyaOfficeBaseIdentity(withoutReportTime))
      .toThrow("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");

    const snapshotB = { ...base, dataSnapshotId: "snapshot-tuya-b" };
    expect(createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: snapshotB,
      targetId: "consumption-and-demand",
      unit: consumptionUnit,
    })).not.toEqual(section);
    expect(createTuyaOfficeOverviewAiExecutiveArtifactIdentity({
      baseIdentity: snapshotB,
      targetId: "sections:current-v1",
      unit: surface.keyFindings!,
    })).not.toEqual(executive);
    expect(createTuyaOfficeAdditionalAiInsightArtifactIdentity({ baseIdentity: snapshotB, unit: surface.additionalInsights! }))
      .not.toEqual(additional);

    const revisedConsumptionUnit = {
      ...consumptionUnit,
      generation: {
        ...consumptionUnit.generation!,
        outputContractRevision: "energyiq-project-section-interpretation-v3",
        validatorRevision: "tuya-office-section-acceptance-v5",
      },
    };
    expect(createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: base,
      targetId: "consumption-and-demand",
      unit: revisedConsumptionUnit,
    })).toMatchObject({
      outputContractRevision: "energyiq-project-section-interpretation-v3",
      validatorRevision: "tuya-office-section-acceptance-v5",
    });
  });
});

describe("Ngee Ann current Overview AI identities", () => {
  it("rotates exact Section and Executive artifacts with Ngee Ann contracts and Snapshot identity", () => {
    const base = createOverviewAiArtifactIdentity({
      workspaceId: "workspace-ngee",
      projectId: "ngee-ann-polytechnic",
      scopeId: "ngee-ann-polytechnic",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "ngee-release-v6",
      analysisPeriodFrom: "2026-05-19T16:00:00.000Z",
      analysisPeriodTo: "2026-06-16T16:00:00.000Z",
      rendererKey: "ngee-ann-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default-model-profile",
      modelProfileRevision: 8,
    });

    const section = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: base,
      targetId: "time-behaviour",
    });
    const executive = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: base,
      targetId: "sections:current-v1",
    });

    expect(base).toMatchObject({
      rendererKey: "ngee-ann-overview",
      analysisPackId: "ngee-ann-analysis-pack",
      analysisPackRevision: "v1",
    });
    expect(section).toMatchObject({
      artifactKind: "section-interpretation",
      targetId: "time-behaviour",
      identityContractRevision: "ngee-ann-section-v16",
      analysisPackId: "ngee-ann-section-pack",
      analysisPackRevision: "v2",
      outputContractRevision: "energyiq-project-section-interpretation-v1",
      validatorRevision: "energyiq-project-section-acceptance-v14",
      workflowRevision: "energyiq-project-section-discover-publish-v1",
      investigatorPromptRevision: "energyiq-project-section-discovery-v8",
      capabilityRevision: "pack-only-v1",
      publicationRevision: "energyiq-project-section-publication-v1",
    });
    expect(executive).toMatchObject({
      artifactKind: "executive-synthesis",
      targetId: "sections:current-v1",
      identityContractRevision: "ngee-ann-executive-v7",
      analysisPackId: "ngee-ann-section-artifacts",
      analysisPackRevision: "v1",
      outputContractRevision: "energyiq-project-executive-synthesis-v1",
      validatorRevision: "energyiq-project-executive-acceptance-v6",
      workflowRevision: "energyiq-project-executive-synthesis-v2",
      investigatorPromptRevision: "energyiq-project-executive-prompt-v2",
      capabilityRevision: "section-artifacts-v1",
    });

    const snapshotB = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: { ...base, dataSnapshotId: "snapshot-b" },
      targetId: "time-behaviour",
    });
    expect(snapshotB).not.toEqual(section);

    expect(createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: base,
      targetId: "trend-and-demand",
    }).investigatorPromptRevision).toBe("energyiq-project-section-discovery-v8");

    const additional = createNgeeAnnAdditionalAiInsightArtifactIdentity({ baseIdentity: base });
    expect(additional).toMatchObject({
      rendererKey: "ngee-ann-overview",
      artifactKind: "autonomous-insights",
      identityContractRevision: "ngee-ann-additional-insights-v4",
      analysisPackId: "ngee-ann-additional-insights-pack",
      outputContractRevision: "energyiq-additional-ai-insights-v2",
      validatorRevision: "additional-insights-acceptance-v18",
      workflowRevision: "additional-insights-discover-accept-publish-v21",
      investigatorPromptRevision: "additional-insights-discovery-v11",
      methodSetId: "preschool-additional-insights-current",
    });
    expect(isCurrentProjectAdditionalAiInsightArtifactIdentity(additional)).toBe(true);
    expect(isCurrentProjectAdditionalAiInsightArtifactIdentity({
      ...additional,
      identityContractRevision: "ngee-ann-additional-insights-v3",
      validatorRevision: "additional-insights-acceptance-v17",
      workflowRevision: "additional-insights-discover-accept-publish-v20",
    })).toBe(false);
  });
});

describe("createOverviewAiArtifactIdentity", () => {
  it("is shared across users but changes with Snapshot or model binding revision", () => {
    const base = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview" as const,
      rendererVersion: "1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
    };

    expect(createOverviewAiArtifactIdentity(base)).toEqual({
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-analysis-pack",
      analysisPackRevision: "v1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
      outputContractRevision: "v13",
      validatorRevision: "preschool-ai-two-stage-fact-boundary-v7",
      workflowRevision: "preschool-two-stage-v2",
      investigatorPromptRevision: "preschool-investigator-v15",
      editorPromptRevision: "preschool-insight-editor-v7",
      methodSkillId: "energy-insight-investigation",
      methodSkillRevision: "1.0.0",
    });
    expect(createOverviewAiArtifactIdentity({ ...base, dataSnapshotId: "snapshot-b" }))
      .not.toEqual(createOverviewAiArtifactIdentity(base));
    expect(createOverviewAiArtifactIdentity({ ...base, modelProfileRevision: 9 }))
      .not.toEqual(createOverviewAiArtifactIdentity(base));
    expect(createOverviewAiArtifactIdentity({ ...base, analysisPeriodTo: "2026-06-02T00:00:00.000Z" }))
      .not.toEqual(createOverviewAiArtifactIdentity(base));

    const reportTimeBasis = {
      contractRevision: "energyiq-report-time-context@1" as const,
      timezone: "Asia/Singapore",
      acceptedDataEndExclusive: "2026-06-01T00:00:00.000Z",
      dataThroughLocalDate: "2026-05-31",
      policyId: "preschool-overview-time",
      policyRevision: "v1",
      windows: [{
        windowId: "current-overview",
        role: "primary",
        label: "Rolling 28 complete days",
        strategy: { kind: "rolling_complete_days" as const, days: 28 },
        phase: "complete" as const,
        from: "2026-05-04T00:00:00.000Z",
        toExclusive: "2026-06-01T00:00:00.000Z",
        completeDayCount: 28,
        segments: [{ from: "2026-05-04T00:00:00.000Z", toExclusive: "2026-06-01T00:00:00.000Z" }],
        comparisonCompatibilityKey: "rolling-28",
      }],
    };
    const versioned = createOverviewAiArtifactIdentity({ ...base, reportTimeBasis });
    expect(versioned).toMatchObject({
      reportTimePolicyId: "preschool-overview-time",
      reportTimePolicyRevision: "v1",
      reportTimeContextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(createOverviewAiArtifactIdentity({
      ...base,
      reportTimeBasis: { ...reportTimeBasis, policyRevision: "v2" },
    })).not.toEqual(versioned);
  });

  it("fails closed for a Renderer without a released Overview AI contract", () => {
    expect(() => createOverviewAiArtifactIdentity({
      workspaceId: "workspace",
      projectId: "unknown-project",
      scopeId: "project",
      dataSnapshotId: "snapshot",
      projectReleaseId: "release",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "unknown-overview",
      rendererVersion: "1",
      modelProfileId: "profile",
      modelProfileRevision: 1,
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  });

  it("uses the released current Section and Executive identities while leaving legacy history unchanged", () => {
    const legacy = createOverviewAiArtifactIdentity({
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
    });
    const benchmark = createPreschoolOverviewAiSectionArtifactIdentityV4({
      baseIdentity: legacy,
      targetId: "centre-benchmark",
    });
    const standby = createPreschoolOverviewAiSectionArtifactIdentityV4({
      baseIdentity: legacy,
      targetId: "standby-wastage",
    });
    const legacySection = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "section-interpretation",
      targetId: "centre-benchmark",
    });
    const executive = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "executive-synthesis",
      targetId: "sections:none",
    });

    expect(legacy).not.toHaveProperty("artifactKind");
    expect(benchmark).toMatchObject({
      artifactKind: "section-interpretation",
      targetId: "centre-benchmark",
      identityContractRevision: "v4",
      analysisPackId: "preschool-section-pack",
      analysisPackRevision: "v2",
      outputContractRevision: "preschool-section-interpretation-v4",
      validatorRevision: "acceptance-validator-v18",
      workflowRevision: "discover-tools-accept-publish-v4",
      investigatorPromptRevision: "discovery-prompt-v14",
      capabilityRevision: "scoped-read-only-v1",
      publicationRevision: "v1",
    });
    expect(standby).not.toEqual(benchmark);
    expect(createPreschoolOverviewAiExecutiveArtifactIdentityV4({
      baseIdentity: legacy,
      targetId: "sections:current-v4",
    })).toMatchObject({
      validatorRevision: "preschool-executive-synthesis-validator-v24",
      workflowRevision: "preschool-executive-synthesis-v12",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v15",
      capabilityRevision: "section-artifacts-and-overview-evidence-v2",
    });
    expect(legacySection).toMatchObject({
      outputContractRevision: "preschool-section-interpretation-v3",
      validatorRevision: "preschool-section-interpreter-validator-v12",
      workflowRevision: "preschool-section-interpreter-v14",
      investigatorPromptRevision: "preschool-section-interpreter-prompt-v14",
    });
    expect(legacySection).not.toHaveProperty("identityContractRevision");
    expect(executive).toMatchObject({
      artifactKind: "executive-synthesis",
      targetId: "sections:none",
      outputContractRevision: "preschool-executive-synthesis-v1",
      validatorRevision: "preschool-executive-synthesis-validator-v3",
      workflowRevision: "preschool-executive-synthesis-v9",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v2",
    });
    expect(() => createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "section-interpretation",
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
    expect(() => createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "executive-synthesis",
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  });

  it("derives the current Additional Insight identity from the server-owned Method Set", () => {
    const legacy = createOverviewAiArtifactIdentity({
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
    });
    const identity = createPreschoolAdditionalAiInsightArtifactIdentity({
      baseIdentity: legacy,
    });

    expect(identity).toMatchObject({
      artifactKind: "autonomous-insights",
      identityContractRevision: "additional-insights-v24",
      analysisPackId: "preschool-additional-insights-pack",
      analysisPackRevision: "v1",
      outputContractRevision: "energyiq-additional-ai-insights-v2",
      validatorRevision: "additional-insights-acceptance-v17",
      workflowRevision: "additional-insights-discover-accept-publish-v21",
      investigatorPromptRevision: "additional-insights-discovery-v12",
      editorPromptRevision: "additional-insights-publication-v2",
      methodSkillId: "energyiq-open-discovery",
      methodSkillRevision: "1.0.0",
      methodSetId: "preschool-additional-insights-current",
      methodSetRevision: "v1",
      methodSetFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      capabilityRevision: "scoped-read-only-v1",
      publicationRevision: "additional-insights-v2",
      canvasRevision: "energyiq-insight-canvas-v2",
    });
    expect(identity).not.toHaveProperty("targetId");
    expect(identity.methodSetFingerprint).not.toBe(identity.methodSkillRevision);
    expect(isCurrentPreschoolAdditionalAiInsightArtifactIdentity(identity)).toBe(true);
    expect(isCurrentPreschoolAdditionalAiInsightArtifactIdentity({
      ...identity,
      identityContractRevision: "additional-insights-v21",
      workflowRevision: "additional-insights-discover-accept-publish-v20",
      investigatorPromptRevision: "additional-insights-discovery-v10",
    })).toBe(false);
    for (const [field, value] of [
      ["analysisPackId", "other-pack"],
      ["analysisPackRevision", "v99"],
      ["editorPromptRevision", "additional-insights-publication-v99"],
      ["methodSkillId", "other-method"],
      ["methodSkillRevision", "99.0.0"],
      ["methodSetId", "other-method-set"],
      ["methodSetRevision", "v99"],
      ["methodSetFingerprint", "sha256:invalid"],
    ] as const) {
      expect(isCurrentPreschoolAdditionalAiInsightArtifactIdentity({
        ...identity,
        [field]: value,
      })).toBe(false);
    }

    const callerAttempt = {
      baseIdentity: legacy,
      methods: [{
        skillId: "caller-forged-method",
        semanticVersion: "99.0.0",
        resourceId: "skill:caller-forged-method",
        resourceRevision: 99,
        contentSha256: "f".repeat(64),
        scope: "user",
        workspaceId: "other-workspace",
        userId: "attacker",
        role: "core-method",
      }],
    } as unknown as Parameters<typeof createPreschoolAdditionalAiInsightArtifactIdentity>[0];
    expect(createPreschoolAdditionalAiInsightArtifactIdentity(callerAttempt)).toEqual(identity);
  });
});

describe("overviewAiArtifactPinnedLocalPeriod", () => {
  it("converts Snapshot ISO boundaries to the Project-local inclusive date range", () => {
    expect(overviewAiArtifactPinnedLocalPeriod({
      identity: {
        analysisPeriodFrom: "2026-05-10T16:00:00.000Z",
        analysisPeriodTo: "2026-06-07T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
    })).toEqual({ from: "2026-05-11", to: "2026-06-07" });
  });

  it("fails closed when the exclusive boundary does not follow the start date", () => {
    expect(() => overviewAiArtifactPinnedLocalPeriod({
      identity: {
        analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
        analysisPeriodTo: "2026-05-01T00:00:00.000Z",
      },
      timezone: "UTC",
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  });
});

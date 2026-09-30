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
import {
  buildTuyaOfficeSectionPrompt,
  createTuyaOfficeSectionInterpreter,
  materializeTuyaOfficeSectionResult,
  type TuyaOfficeSectionInterpretationResult,
} from "./tuya-office-section-interpreter.js";
import { tuyaOfficeAiSurfaceFixture } from "./tuya-office-ai-surface.test-fixture.js";
import type { TuyaOfficeSectionPack } from "./tuya-office-section-pack.js";

describe("createTuyaOfficeSectionInterpreter", () => {
  it("generates the consumption-and-demand Artifact through the governed Store lifecycle", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    const runSection = vi.fn(async (input: { runId: string; sessionId: string }) => ({
      answer: JSON.stringify({
        sectionId: "consumption-and-demand",
        status: "available",
        summary: {
          text: "The office used 1200 kWh in the current reporting window.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.usageKwh"],
        },
        candidates: [{
          id: "peak-review",
          title: "Peak demand deserves a timing review",
          text: "The 48 kW peak could justify checking which systems were active at that time.",
          epistemicStatus: "inferred",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.peakKw"],
        }],
      }),
      runId: input.runId,
      sessionId: input.sessionId,
    }));
    const interpreter = createTuyaOfficeSectionInterpreter({
      metadataStore: { energyIq: { overviewAiArtifacts: store } } as unknown as MetadataStore,
      runSection,
    });

    const artifact = await interpreter.execute({
      baseIdentity: baseIdentity(),
      pack: consumptionPack(),
      unit: unitFor("consumption-and-demand"),
      user: { id: "admin-charles" } as UserRecord,
    });

    expect(runSection).toHaveBeenCalledTimes(1);
    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!) as TuyaOfficeSectionInterpretationResult).toMatchObject({
      artifactKind: "section-interpretation",
      status: "available",
      sectionId: "consumption-and-demand",
      binding: {
        projectId: "tuya-office",
        dataSnapshotId: "snapshot-tuya-aug-20",
        projectReleaseId: "tuya-office-template-v1",
      },
      insights: [{ id: "consumption-and-demand::peak-review", epistemicStatus: "inferred" }],
      publication: {
        discoveredCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        publishedCount: 1,
      },
    });
  });

  it("rejects a stale base identity before queueing or invoking the Provider", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    const runSection = vi.fn();
    const interpreter = createTuyaOfficeSectionInterpreter({
      metadataStore: { energyIq: { overviewAiArtifacts: store } } as unknown as MetadataStore,
      runSection,
    });
    const staleIdentity = {
      ...baseIdentity(),
      identityContractRevision: "tuya-office-overview-stale",
    } as ReturnType<typeof baseIdentity>;

    await expect(interpreter.execute({
      baseIdentity: staleIdentity,
      pack: consumptionPack(),
      unit: unitFor("consumption-and-demand"),
      user: { id: "admin-charles" } as UserRecord,
    })).rejects.toThrow("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");
    expect(runSection).not.toHaveBeenCalled();
    expect(records.size).toBe(0);
  });

  it("rejects one unsupported observed number without suppressing a useful speculative angle", () => {
    const pack = consumptionPack();
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "consumption-and-demand",
      unit: unitFor("consumption-and-demand"),
    });
    const result = materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "consumption-and-demand",
        status: "available",
        summary: {
          text: "The office used 1200 kWh in the current reporting window.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.usageKwh"],
        },
        candidates: [{
          id: "invented-daily-value",
          title: "Daily use is 20 kWh",
          text: "Observed daily use is 20 kWh.",
          epistemicStatus: "observed",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.usageKwh"],
        }, {
          id: "scheduling-question",
          title: "Scheduling may explain part of the demand shape",
          text: "Checking operating schedules against the demand pattern could reveal a practical control opportunity.",
          epistemicStatus: "speculative",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: [],
        }],
      }),
      pack,
      identity,
      runId: "run:tuya:local-rejection",
    });

    expect(result.insights.map(({ id }) => id)).toEqual(["consumption-and-demand::scheduling-question"]);
    expect(result.publication).toMatchObject({
      discoveredCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      publishedCount: 1,
      rejectedCandidateIds: ["invented-daily-value"],
    });
  });

  it("rejects a number that exists in the Section but belongs to a different semantic fact", () => {
    const pack = readinessPack();
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "data-readiness",
      unit: unitFor("data-readiness"),
    });

    expect(() => materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "data-readiness",
        status: "available",
        summary: {
          text: "All 20 published Meters are usable for current decisions.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:meterDataHealth.summary.usable"],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:tuya:semantic-collision",
    })).toThrow("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  });

  it("binds each reported number to its ordered fact claim instead of a Section-wide pool", () => {
    const pack = readinessPack();
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "data-readiness",
      unit: unitFor("data-readiness"),
    });

    expect(() => materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "data-readiness",
        status: "available",
        summary: {
          text: "The published total is 2 Meters and 20 are usable.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: [
            "fact:meterDataHealth.summary.total",
            "fact:meterDataHealth.summary.usable",
          ],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:tuya:ordered-claims",
    })).toThrow("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  });

  it("rejects a numeric claim when the narrative names a different Circuit with the same value", () => {
    const pack = operationsPack();
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "meter-contribution-and-operations",
      unit: unitFor("meter-contribution-and-operations"),
    });

    expect(() => materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "meter-contribution-and-operations",
        status: "available",
        summary: {
          text: "Circuit B used 50 kWh in the reporting window.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:circuits[0].usageKwh"],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:tuya:entity-collision",
    })).toThrow("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  });

  it("bounds the Provider projection while retaining category profiles and the leading Circuits", () => {
    const prompt = buildTuyaOfficeSectionPrompt(operationsPack(48));
    const projection = JSON.parse(prompt.split("Section Pack projection: ").at(-1)!) as {
      facts: { componentHourlyProfiles: { scopes: Array<{ profiles: Array<{ circuits: Array<{ meterNodeId: string }> }> }> } };
    };
    const projectedCircuits = projection.facts.componentHourlyProfiles.scopes[0]!.profiles[0]!.circuits;

    expect(prompt.length).toBeLessThan(100_000);
    expect(projectedCircuits.map(({ meterNodeId }) => meterNodeId)).toEqual([
      "meter-00", "meter-01", "meter-02", "meter-03",
      "meter-04", "meter-05", "meter-06", "meter-07",
    ]);
    expect(prompt).toContain('"category":"lighting"');
  });

  it("uses the report timezone for Provider-facing and accepted peak timestamps", () => {
    const pack = consumptionPack();
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "consumption-and-demand",
      unit: unitFor("consumption-and-demand"),
    });
    const prompt = buildTuyaOfficeSectionPrompt(pack);

    expect(prompt).toContain("2026-08-18 14:15 Asia/Singapore");
    expect(prompt).not.toContain('"peakAt":"2026-08-18T06:15:00.000Z"');

    expect(materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "consumption-and-demand",
        status: "available",
        summary: {
          text: "On 18 Aug, the 48 kW peak occurred at 14:15 local time.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.peakKw"],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:tuya:local-time",
    }).summary?.text).toContain("14:15 local time");

    expect(() => materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "consumption-and-demand",
        status: "available",
        summary: {
          text: "On 18 Aug, the 48 kW peak occurred at 06:15 local time.",
          evidenceRefs: ["evidence:tuya:summary"],
          claimRefs: ["fact:summary.peakKw"],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:tuya:raw-utc-time",
    })).toThrow("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  });

  it("restores a terminal current Artifact without invoking the Provider", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "consumption-and-demand",
      unit: unitFor("consumption-and-demand"),
    });
    records.set(JSON.stringify(identity), {
      ...artifactRecord(identity, "available", "admin-charles"),
      result_json: JSON.stringify({ status: "empty", sectionId: "consumption-and-demand" }),
    });
    const runSection = vi.fn();
    const interpreter = createTuyaOfficeSectionInterpreter({
      metadataStore: {
        energyIq: { overviewAiArtifacts: fakeArtifactStore(records) },
      } as unknown as MetadataStore,
      runSection,
    });

    const artifact = await interpreter.execute({
      baseIdentity: baseIdentity(),
      pack: consumptionPack(),
      unit: unitFor("consumption-and-demand"),
      user: { id: "admin-charles" } as UserRecord,
    });

    expect(artifact.status).toBe("available");
    expect(runSection).not.toHaveBeenCalled();
  });

  it("records a failed Artifact when the Provider envelope is invalid", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const interpreter = createTuyaOfficeSectionInterpreter({
      metadataStore: {
        energyIq: { overviewAiArtifacts: fakeArtifactStore(records) },
      } as unknown as MetadataStore,
      runSection: async ({ runId, sessionId }) => ({ answer: "not-json", runId, sessionId }),
    });

    const artifact = await interpreter.execute({
      baseIdentity: baseIdentity(),
      pack: consumptionPack(),
      unit: unitFor("consumption-and-demand"),
      user: { id: "admin-charles" } as UserRecord,
    });

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID",
    });
  });
});

const unitFor = (sectionId: string) =>
  tuyaOfficeAiSurfaceFixture().sections.find(({ id }) => id === sectionId)!;

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "tuya-office",
  projectId: "tuya-office",
  scopeId: "tuya-office",
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

const consumptionPack = (): TuyaOfficeSectionPack<"consumption-and-demand"> => ({
  contract: { id: "tuya-office-section-pack", revision: "tuya-office-section-pack-v4" },
  sectionId: "consumption-and-demand",
  audience: "office facilities and energy managers",
  analysisGoal: "Identify decision-relevant changes in use and demand.",
  binding: {
    workspaceId: "tuya-office",
    projectId: "tuya-office",
    scopeId: "tuya-office",
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
      peakAt: "2026-08-18T06:15:00.000Z",
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
    dailyTotals: null,
    calendarTotals: null,
    dailyUsageAnomalies: null,
    peakBreakdown: null,
    cost: { status: "unavailable", reason: { code: "TARIFF_VERSION_MISSING", message: "Tariff unavailable" } },
  } as unknown as TuyaOfficeSectionPack<"consumption-and-demand">["facts"],
  limitations: [],
  missingEvidence: [],
  capabilities: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
});

const readinessPack = (): TuyaOfficeSectionPack<"data-readiness"> => ({
  ...consumptionPack(),
  sectionId: "data-readiness",
  facts: {
    meterDataHealth: {
      summary: { total: 20, usable: 2, insufficientHistory: 18, noReadings: 0 },
      meters: [],
    },
    dataQuality: { status: "partial", coveragePct: 25 },
    dataSnapshot: {},
    metadata: {},
    attention: [],
  } as unknown as TuyaOfficeSectionPack<"data-readiness">["facts"],
});

const operationsPack = (
  circuitCount = 2,
): TuyaOfficeSectionPack<"meter-contribution-and-operations"> => ({
  ...consumptionPack(),
  sectionId: "meter-contribution-and-operations",
  facts: {
    categories: [],
    componentCategoryBreakdown: [],
    childScopes: [],
    circuits: Array.from({ length: circuitCount }, (_, index) => ({
      meterNodeId: `meter-${String(index).padStart(2, "0")}`,
      name: `Circuit ${String.fromCharCode(65 + (index % 26))}`,
      category: "lighting",
      usageKwh: index < 2 ? 50 : 48 - index,
      sharePct: 4,
    })),
    topCircuits: [],
    designatedTotals: [],
    componentReconciliation: {},
    virtualMeters: [],
    virtualMeterTraces: [],
    hourlyProfile: [],
    timeBehaviour: {},
    componentHourlyProfiles: {
      scopes: [{
        scopeId: "tuya-office",
        scopeName: "Tuya Office",
        profiles: [{
          dayType: "weekday",
          sampleDayCount: 20,
          categories: [{ category: "lighting", values: Array.from({ length: 24 }, (_, hour) => hour / 10) }],
          circuits: Array.from({ length: circuitCount }, (_, index) => ({
            meterNodeId: `meter-${String(index).padStart(2, "0")}`,
            name: `Circuit ${String.fromCharCode(65 + (index % 26))}`,
            category: "lighting",
            values: Array.from({ length: 24 }, () => Math.max(0, 50 - index)),
          })),
        }],
      }],
    },
    offHours: { status: "unavailable", reason: { code: "CALENDAR_MISSING", message: "Calendar unavailable" } },
  } as unknown as TuyaOfficeSectionPack<"meter-contribution-and-operations">["facts"],
});

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
  fail: ({ identity, errorCode }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    errorCode: string;
  }) => {
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
  ...(status === "available" || status === "failed"
    ? { completed_at: "2026-08-23T00:01:00.000Z" }
    : {}),
});

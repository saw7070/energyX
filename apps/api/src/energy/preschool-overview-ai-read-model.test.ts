import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import {
  createMetadataStore,
  type EnergyIqOverviewAiArtifactIdentity,
  type EnergyIqOverviewAiArtifactRecord,
  type MetadataStore,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { preschoolExecutiveSynthesisTargetId } from "./preschool-executive-synthesis.js";
import {
  composePreschoolOverviewAiReadModel,
  composePreschoolOverviewAiReadModelV3,
} from "./preschool-overview-ai-read-model.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
} from "./overview-ai-artifact.js";
import { preschoolOverviewAiBindingFromIdentity, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";

describe("composePreschoolOverviewAiReadModel", () => {
  it("returns null when the current identity has no Section or Executive artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-empty-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      expect(composePreschoolOverviewAiReadModel({
        metadataStore: metadata,
        baseIdentity: identity(),
      })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the current v4 Section identity even when the only artifact is still queued", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-v4-current-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      metadata.energyIq.overviewAiArtifacts.queue({
        identity: sectionIdentityV4(baseIdentity, "centre-benchmark"),
        triggeredBy: "dev-user",
      });

      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity }))
        .toMatchObject({
          sections: {
            "centre-benchmark": { status: "queued" },
          },
        });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not present an exact legacy v3 Section artifact as the current v4 result", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-v3-legacy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      completeSectionV3(metadata, baseIdentity, "centre-benchmark");

      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not present the previous Section acceptance revision as the current result", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-section-validator-history-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      const historicalIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...sectionIdentityV4(baseIdentity, "centre-benchmark"),
        validatorRevision: "acceptance-validator-v15",
      };
      metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalIdentity,
        triggeredBy: "dev-user",
      });

      expect(metadata.energyIq.overviewAiArtifacts.find(historicalIdentity)).not.toBeNull();
      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores the exact current Additional Insight Artifact independently of Section availability", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-additional-current-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      const additionalIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity });
      metadata.energyIq.overviewAiArtifacts.queue({ identity: additionalIdentity, triggeredBy: "dev-user" });
      metadata.energyIq.overviewAiArtifacts.claim({
        identity: additionalIdentity,
        workerId: "additional-worker",
        leaseMs: 60_000,
      });
      const artifact = metadata.energyIq.overviewAiArtifacts.complete({
        identity: additionalIdentity,
        workerId: "additional-worker",
        sessionId: "additional-session",
        runId: "additional-run",
        resultJson: JSON.stringify(currentAdditionalResult(additionalIdentity)),
      });

      expect(composePreschoolOverviewAiReadModel({
        metadataStore: metadata,
        baseIdentity,
      })).toMatchObject({
        sections: {
          "centre-benchmark": { status: "unavailable" },
          "standby-wastage": { status: "unavailable" },
          "operating-behaviour": { status: "unavailable" },
          "planning-outlook": { status: "unavailable" },
        },
        executive: { status: "unavailable" },
        additional: {
          status: "available",
          artifactId: artifact.id,
          result: {
            artifactKind: "autonomous-insights",
            contract: { revision: "energyiq-additional-ai-insights-v2" },
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["v2", {
      identityContractRevision: "additional-insights-v2",
      validatorRevision: "additional-insights-acceptance-v2",
      workflowRevision: "additional-insights-discover-accept-publish-v2",
      investigatorPromptRevision: "additional-insights-discovery-v2",
    }],
    ["v3", {
      identityContractRevision: "additional-insights-v3",
      validatorRevision: "additional-insights-acceptance-v3",
      workflowRevision: "additional-insights-discover-accept-publish-v3",
      investigatorPromptRevision: "additional-insights-discovery-v3",
    }],
    ["v4", {
      identityContractRevision: "additional-insights-v4",
      validatorRevision: "additional-insights-acceptance-v3",
      workflowRevision: "additional-insights-discover-accept-publish-v4",
      investigatorPromptRevision: "additional-insights-discovery-v4",
    }],
    ["v5", {
      identityContractRevision: "additional-insights-v5",
      validatorRevision: "additional-insights-acceptance-v3",
      workflowRevision: "additional-insights-discover-accept-publish-v5",
      investigatorPromptRevision: "additional-insights-discovery-v5",
    }],
  ] as const)("does not present a historical Additional %s Artifact as the current v6 result", (_revision, revisions) => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-additional-v2-saved-only-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      const currentIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity });
      const historicalIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...currentIdentity,
        ...revisions,
      };
      seedHistoricalAdditionalArtifactForReadTest(metadata, currentIdentity, historicalIdentity);

      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["workspace", (value: AdditionalAiInsightsArtifact) => { value.binding.workspaceId = "other-workspace"; }],
    ["project", (value: AdditionalAiInsightsArtifact) => { value.binding.projectId = "other-project"; }],
    ["scope", (value: AdditionalAiInsightsArtifact) => { value.binding.scopeId = "other-scope"; }],
    ["Snapshot", (value: AdditionalAiInsightsArtifact) => { value.binding.dataSnapshotId = "other-snapshot"; }],
    ["Release", (value: AdditionalAiInsightsArtifact) => { value.binding.projectReleaseId = "other-release"; }],
    ["period", (value: AdditionalAiInsightsArtifact) => { value.binding.analysisPeriod.to = "2026-07-01T00:00:00.000Z"; }],
    ["model", (value: AdditionalAiInsightsArtifact) => { value.binding.modelProfileId = "other-model"; }],
    ["model revision", (value: AdditionalAiInsightsArtifact) => { value.binding.modelProfileRevision += 1; }],
    ["contract", (value: AdditionalAiInsightsArtifact) => {
      (value.contract as { revision: string }).revision = "other-contract";
    }],
    ["Method Set id", (value: AdditionalAiInsightsArtifact) => { value.methodExecution.methodSetId = "caller-method-set"; }],
    ["Method Set revision", (value: AdditionalAiInsightsArtifact) => { value.methodExecution.methodSetRevision = "v999"; }],
    ["Method Set fingerprint", (value: AdditionalAiInsightsArtifact) => { value.methodExecution.methodSetFingerprint = `sha256:${"0".repeat(64)}`; }],
  ] as const)("fails closed locally when the Additional Artifact %s identity drifts", (_label, mutate) => {
    const baseIdentity = identity();
    const additionalIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity });
    const additional = currentAdditionalResult(additionalIdentity);
    mutate(additional);
    const badAdditional = artifactRecord(additionalIdentity, additional);
    const queuedSection = artifactRecord(sectionIdentity(baseIdentity, "centre-benchmark"), {});
    queuedSection.status = "queued";
    delete queuedSection.result_json;
    const metadataStore = {
      energyIq: {
        overviewAiArtifacts: {
          find: (requested: EnergyIqOverviewAiArtifactIdentity) => {
            if (requested.artifactKind === "autonomous-insights") return badAdditional;
            if (requested.artifactKind === "section-interpretation"
              && requested.targetId === "centre-benchmark") return queuedSection;
            return undefined;
          },
        },
      },
    } as unknown as MetadataStore;

    expect(composePreschoolOverviewAiReadModel({ metadataStore, baseIdentity })).toMatchObject({
      sections: { "centre-benchmark": { status: "queued" } },
      additional: {
        status: "unavailable",
        artifactId: badAdditional.id,
        reason: "Additional AI Insights are invalid.",
      },
    });
  });

  it("restores a legacy-only base Artifact only through the v3 Saved composer", () => {
    const baseIdentity = identity();
    const legacyArtifact = artifactRecord(baseIdentity, {
      status: "available",
      findings: [{ id: "legacy-finding" }],
    });
    const metadataStore = {
      energyIq: {
        overviewAiArtifacts: {
          find: (requested: EnergyIqOverviewAiArtifactIdentity) => {
            if (requested.artifactKind === undefined) return legacyArtifact;
            return undefined;
          },
        },
      },
    } as unknown as MetadataStore;

    const current = composePreschoolOverviewAiReadModel({
      metadataStore,
      baseIdentity,
    });
    const saved = composePreschoolOverviewAiReadModelV3({
      metadataStore,
      baseIdentity,
    });

    expect(current).toBeNull();
    expect(saved).toMatchObject({
      autonomous: {
        status: "available",
        findings: [{ id: "legacy-finding" }],
      },
    });
    expect(saved).not.toHaveProperty("additional");
  });

  it.each(["contract", "binding"] as const)(
    "marks only the affected Section unavailable when its stored %s does not match the requested identity",
    (mismatch) => {
      const baseIdentity = identity();
      const unitIdentity = sectionIdentity(baseIdentity, "centre-benchmark");
      const binding = preschoolOverviewAiBindingFromIdentity(unitIdentity);
      const result = {
        artifactKind: "section-interpretation",
        status: "available",
        providerProfileId: unitIdentity.modelProfileId,
        runId: "run:mismatch",
        contract: {
          id: "preschool-section-interpretation",
          revision: mismatch === "contract"
            ? "preschool-section-interpretation-tampered"
            : unitIdentity.outputContractRevision,
        },
        binding: mismatch === "binding"
          ? { ...binding, modelProfileRevision: binding.modelProfileRevision + 1 }
          : binding,
        sectionId: "centre-benchmark",
        packRevision: "v2",
        capability: {
          revision: "scoped-read-only-v1",
          mode: "scoped-read-only",
          tools: sectionTools("centre-benchmark"),
        },
        toolAudits: [],
        summary: {
          text: "A stored result with a mismatched binding must not be exposed.",
          evidenceRefs: ["evidence:1"],
        },
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
      };
      const artifact = artifactRecord(unitIdentity, result);
      const metadataStore = {
        energyIq: {
          overviewAiArtifacts: {
            find: (requested: EnergyIqOverviewAiArtifactIdentity) =>
              requested.artifactKind === "section-interpretation"
                && requested.targetId === "centre-benchmark"
                ? artifact
                : undefined,
          },
        },
      } as unknown as MetadataStore;

      expect(composePreschoolOverviewAiReadModel({ metadataStore, baseIdentity }))
        .toMatchObject({
          sections: {
            "centre-benchmark": {
              status: "unavailable",
              artifactId: artifact.id,
              reason: "Section interpretation is invalid.",
            },
          },
        });
    },
  );

  it("keeps successful, empty, failed, and running Sections visible when Executive synthesis fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
      metadata.workspaces.upsert({
        id: "preschool-workspace",
        owner_user_id: "dev-user",
        name: "Preschool",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "preschool-demo",
        workspace_id: "preschool-workspace",
        name: "Preschool",
        status: "published",
        root_scope_id: "preschool-project",
      });
      const baseIdentity = identity();
      const benchmark = completeSection(metadata, baseIdentity, "centre-benchmark", "available");
      failSection(metadata, baseIdentity, "standby-wastage");
      runningSection(metadata, baseIdentity, "operating-behaviour");
      completeSection(metadata, baseIdentity, "planning-outlook", "empty");
      const executiveIdentity = createPreschoolOverviewAiExecutiveArtifactIdentityV4({
        baseIdentity,
        targetId: preschoolExecutiveSynthesisTargetId([benchmark.id]),
      });
      metadata.energyIq.overviewAiArtifacts.queue({ identity: executiveIdentity, triggeredBy: "dev-user" });
      metadata.energyIq.overviewAiArtifacts.claim({ identity: executiveIdentity, workerId: "executive-worker", leaseMs: 60_000 });
      metadata.energyIq.overviewAiArtifacts.fail({
        identity: executiveIdentity,
        workerId: "executive-worker",
        errorCode: "SYNTHESIS_PROVIDER_UNAVAILABLE",
      });

      const readModel = composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity });

      expect(readModel).toMatchObject({
        artifactKind: "preschool-overview-ai-read-model",
        status: "available",
        sections: {
          "centre-benchmark": { status: "available" },
          "standby-wastage": { status: "unavailable", reason: "SECTION_FAILED" },
          "operating-behaviour": { status: "running" },
          "planning-outlook": { status: "empty" },
        },
        executive: { status: "unavailable", reason: "SYNTHESIS_PROVIDER_UNAVAILABLE" },
      });
      expect(readModel?.sections["centre-benchmark"]).toHaveProperty("result.summary");
      expect(readModel?.sections["planning-outlook"]).toHaveProperty("result.runId");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores exact historical v3 Section and Executive Artifacts through the v3 composer", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-v3-history-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      const benchmark = completeSectionV3(metadata, baseIdentity, "centre-benchmark");
      const executiveIdentity = createPreschoolOverviewAiValueArtifactIdentity({
        baseIdentity,
        artifactKind: "executive-synthesis",
        targetId: preschoolExecutiveSynthesisTargetId([benchmark.id]),
      });
      metadata.energyIq.overviewAiArtifacts.queue({ identity: executiveIdentity, triggeredBy: "dev-user" });
      const workerId = "executive-v3-worker";
      metadata.energyIq.overviewAiArtifacts.claim({ identity: executiveIdentity, workerId, leaseMs: 60_000 });
      metadata.energyIq.overviewAiArtifacts.complete({
        identity: executiveIdentity,
        workerId,
        sessionId: "executive-v3-session",
        runId: "executive-v3-run",
        resultJson: JSON.stringify({
          artifactKind: "executive-synthesis",
          status: "available",
          providerProfileId: executiveIdentity.modelProfileId,
          runId: "executive-v3-run",
          contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v1" },
          binding: preschoolOverviewAiBindingFromIdentity(executiveIdentity),
          sourceSectionArtifactIds: [benchmark.id],
          keyFindings: [{
            id: "historical-v3-finding",
            takeaway: "Frozen v3 evidence remains readable.",
            sectionIds: ["centre-benchmark"],
            evidenceRefs: ["evidence:v3"],
          }],
        }),
      });

      expect(composePreschoolOverviewAiReadModelV3({ metadataStore: metadata, baseIdentity })).toMatchObject({
        sections: { "centre-benchmark": { status: "available", artifactId: benchmark.id } },
        executive: { status: "available", result: { keyFindings: [{ id: "historical-v3-finding" }] } },
      });
      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const identity = () => createOverviewAiArtifactIdentity({
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 1,
});

const sectionIdentity = (
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
): EnergyIqOverviewAiArtifactIdentity => createPreschoolOverviewAiSectionArtifactIdentityV4({
  baseIdentity,
  targetId: sectionId,
});

type SectionV4Identity = EnergyIqOverviewAiArtifactIdentity & {
  identityContractRevision: "v4";
  capabilityRevision: "scoped-read-only-v1";
  publicationRevision: "v1";
};

const sectionTools = (sectionId: PreschoolSectionId) => {
  if (sectionId === "centre-benchmark") return ["compare_centres", "inspect_related_section_signals"] as const;
  if (sectionId === "standby-wastage" || sectionId === "operating-behaviour") {
    return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"] as const;
  }
  return ["inspect_related_section_signals"] as const;
};

const sectionIdentityV4 = (
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
): SectionV4Identity => createPreschoolOverviewAiSectionArtifactIdentityV4({
  baseIdentity,
  targetId: sectionId,
}) as SectionV4Identity;

const completeSection = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
  status: "available" | "empty",
) => {
  const unitIdentity = sectionIdentity(baseIdentity, sectionId);
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${sectionId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: unitIdentity, workerId, leaseMs: 60_000 });
  const runId = `run:${sectionId}`;
  return metadata.energyIq.overviewAiArtifacts.complete({
    identity: unitIdentity,
    workerId,
    sessionId: `session:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status,
      providerProfileId: unitIdentity.modelProfileId,
      runId,
      contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
      binding: preschoolOverviewAiBindingFromIdentity(unitIdentity),
      sectionId,
      packRevision: "v2",
      capability: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        tools: sectionTools(sectionId),
      },
      toolAudits: [],
      ...(status === "available" ? {
        summary: {
          text: "Verified evidence supports a focused review.",
          evidenceRefs: [`evidence:${sectionId}`],
        },
      } : {}),
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
    }),
  });
};

const failSection = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
) => {
  const unitIdentity = sectionIdentity(baseIdentity, sectionId);
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${sectionId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: unitIdentity, workerId, leaseMs: 60_000 });
  metadata.energyIq.overviewAiArtifacts.fail({ identity: unitIdentity, workerId, errorCode: "SECTION_FAILED" });
};

const runningSection = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
) => {
  const unitIdentity = sectionIdentity(baseIdentity, sectionId);
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  metadata.energyIq.overviewAiArtifacts.claim({
    identity: unitIdentity,
    workerId: `worker:${sectionId}`,
    leaseMs: 60_000,
  });
};

const seedProject = (metadata: ReturnType<typeof createMetadataStore>) => {
  metadata.users.upsertDevUser({
    id: "dev-user",
    email: "dev@example.test",
    display_name: "Dev",
    dev_token: "dev",
  });
  metadata.workspaces.upsert({
    id: "preschool-workspace",
    owner_user_id: "dev-user",
    name: "Preschool",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
};

const completeSectionV3 = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
) => {
  const unitIdentity = createPreschoolOverviewAiSectionArtifactIdentityV3({
    baseIdentity,
    targetId: sectionId,
  });
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:v3:${sectionId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: unitIdentity, workerId, leaseMs: 60_000 });
  const runId = `run:v3:${sectionId}`;
  return metadata.energyIq.overviewAiArtifacts.complete({
    identity: unitIdentity,
    workerId,
    sessionId: `session:v3:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status: "available",
      providerProfileId: unitIdentity.modelProfileId,
      runId,
      contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v3" },
      binding: preschoolOverviewAiBindingFromIdentity(unitIdentity),
      sectionId,
      summary: "This is a frozen v3 result.",
      keyPoints: [{ kind: "finding", text: "Legacy evidence.", evidenceRefs: ["evidence:v3"] }],
    }),
  });
};

const artifactRecord = (
  artifactIdentity: EnergyIqOverviewAiArtifactIdentity,
  result: unknown,
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${artifactIdentity.targetId}`,
  identity_hash: "identity-hash",
  identity_json: JSON.stringify(artifactIdentity),
  workspace_id: artifactIdentity.workspaceId,
  project_id: artifactIdentity.projectId,
  scope_id: artifactIdentity.scopeId,
  resource: "electricity",
  data_snapshot_id: artifactIdentity.dataSnapshotId,
  project_release_id: artifactIdentity.projectReleaseId,
  renderer_key: artifactIdentity.rendererKey,
  renderer_version: artifactIdentity.rendererVersion,
  analysis_pack_id: artifactIdentity.analysisPackId,
  analysis_pack_revision: artifactIdentity.analysisPackRevision,
  model_profile_id: artifactIdentity.modelProfileId,
  model_profile_revision: artifactIdentity.modelProfileRevision,
  output_contract_revision: artifactIdentity.outputContractRevision,
  validator_revision: artifactIdentity.validatorRevision,
  status: "available",
  attempt_count: 1,
  triggered_by: "dev-user",
  run_id: "run:mismatch",
  result_json: JSON.stringify(result),
  created_at: "2026-08-13T00:00:00.000Z",
  updated_at: "2026-08-13T00:00:00.000Z",
  completed_at: "2026-08-13T00:00:00.000Z",
});

/** Simulates a released historical row without reopening historical production mutations. */
const seedHistoricalAdditionalArtifactForReadTest = (
  metadata: MetadataStore,
  currentIdentity: ReturnType<typeof createPreschoolAdditionalAiInsightArtifactIdentity>,
  historicalIdentity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  metadata.energyIq.overviewAiArtifacts.queue({ identity: currentIdentity, triggeredBy: "dev-user" });
  metadata.energyIq.overviewAiArtifacts.claim({
    identity: currentIdentity,
    workerId: "historical-additional-migration-worker",
    leaseMs: 60_000,
  });
  const current = metadata.energyIq.overviewAiArtifacts.complete({
    identity: currentIdentity,
    workerId: "historical-additional-migration-worker",
    sessionId: "historical-additional-session",
    runId: "historical-additional-run",
    resultJson: JSON.stringify(currentAdditionalResult(currentIdentity)),
  });
  const canonical = JSON.parse(current.identity_json) as Record<string, unknown>;
  for (const key of Object.keys(canonical)) {
    const value = historicalIdentity[key as keyof EnergyIqOverviewAiArtifactIdentity];
    if (value === undefined) delete canonical[key];
    else canonical[key] = value;
  }
  const identityJson = JSON.stringify(canonical);
  const identityHash = createHash("sha256").update(identityJson).digest("hex");
  metadata.db.prepare(`
    UPDATE energyiq_overview_ai_artifacts
    SET id = ?, identity_hash = ?, identity_json = ?,
        output_contract_revision = ?, validator_revision = ?
    WHERE id = ?
  `).run(
    `overview-ai-artifact-${identityHash.slice(0, 24)}`,
    identityHash,
    identityJson,
    historicalIdentity.outputContractRevision,
    historicalIdentity.validatorRevision,
    current.id,
  );
};

const currentAdditionalResult = (
  artifactIdentity: ReturnType<typeof createPreschoolAdditionalAiInsightArtifactIdentity>,
): AdditionalAiInsightsArtifact => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(artifactIdentity.workspaceId);
  return ({
  artifactKind: "autonomous-insights",
  status: "available",
  providerProfileId: artifactIdentity.modelProfileId,
  runId: "additional-run",
  contract: {
    id: "energyiq-additional-ai-insights",
    revision: artifactIdentity.outputContractRevision,
  },
  binding: {
    workspaceId: artifactIdentity.workspaceId,
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    analysisPeriod: {
      from: artifactIdentity.analysisPeriodFrom,
      to: artifactIdentity.analysisPeriodTo,
    },
    modelProfileId: artifactIdentity.modelProfileId,
    modelProfileRevision: artifactIdentity.modelProfileRevision,
  },
  methodExecution: {
    methodSetId: artifactIdentity.methodSetId,
    methodSetRevision: artifactIdentity.methodSetRevision,
    methodSetFingerprint: artifactIdentity.methodSetFingerprint,
    loadedMethods: [...methodSet.methods],
  },
  capability: {
    revision: artifactIdentity.capabilityRevision,
    mode: "scoped-read-only",
    allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
    usedTools: [],
  },
  toolAudits: [],
  evidenceLineage: {
    catalogContract: "analysis-context-evidence@1",
    sourceId: `project-analysis-snapshot:${artifactIdentity.projectId}:${artifactIdentity.dataSnapshotId}`,
    pins: {
      workspaceId: artifactIdentity.workspaceId,
      projectId: artifactIdentity.projectId,
      scopeId: artifactIdentity.scopeId,
      dataSnapshotId: artifactIdentity.dataSnapshotId,
      dataCutoff: "2026-05-31T16:00:00.000Z",
      projectReleaseId: artifactIdentity.projectReleaseId,
      metricVersion: "energy-metrics-v1",
    },
    facts: [{
      id: "evidence:additional:1",
      label: "Additional Evidence",
      metricId: "energy.additional",
      value: 1,
      unit: "kWh",
      status: "confirmed",
      evidenceRefs: ["snapshot-evidence:additional:1"],
      dimensions: { scopeId: artifactIdentity.scopeId },
    }],
  },
  findings: [{
    id: "additional-insight-1",
    title: "An incremental angle",
    text: "The current Snapshot supports this additional angle.",
    epistemicStatus: "inferred",
    origin: {
      kind: "ai-discovery",
      coreMethod: methodSet.methods[0]!,
      directionMethods: [],
    },
    evidenceRefs: ["evidence:additional:1"],
    toolAuditIds: [],
  }],
  publication: {
    policyId: "energyiq-additional-ai-insights",
    policyRevision: artifactIdentity.publicationRevision,
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
  });
};

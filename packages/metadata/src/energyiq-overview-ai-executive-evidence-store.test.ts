import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";
import type { EnergyIqOverviewAiArtifactIdentity } from "./energyiq-overview-ai-artifact-store.js";

describe("EnergyIqOverviewAiArtifactStore Executive Overview Evidence", () => {
  it("persists self-contained deterministic lineage without inflating Section sources", () => {
    const harness = createHarness("valid");
    try {
      const result = executiveResult(harness.executiveIdentity, harness.availableSection.id);
      const stored = complete(harness, harness.executiveIdentity, result);
      expect(JSON.parse(stored.result_json!)).toMatchObject({
        sourceSectionArtifactIds: [harness.availableSection.id],
        overviewEvidence: {
          factIds: ["analysis.summary.usage_kwh"],
          facts: [{ id: "analysis.summary.usage_kwh", value: 120 }],
        },
      });
      expect(JSON.parse(stored.result_json!).sourceSectionArtifactIds).not.toContain(harness.emptySection.id);
    } finally {
      harness.close();
    }
  });

  it.each([
    {
      name: "a selected fact missing from the embedded catalog",
      mutate: (result: Record<string, any>) => { result.overviewEvidence.facts = []; },
    },
    {
      name: "a fabricated Overview Evidence ref",
      mutate: (result: Record<string, any>) => { result.summary.evidenceRefs = ["overview:forged"]; },
    },
    {
      name: "Overview Evidence pinned to another Snapshot",
      mutate: (result: Record<string, any>) => { result.overviewEvidence.pins.dataSnapshotId = "snapshot-other"; },
    },
    {
      name: "Overview Evidence pinned to another Release",
      mutate: (result: Record<string, any>) => { result.overviewEvidence.pins.projectReleaseId = "release-other"; },
    },
    {
      name: "duplicate Executive Evidence refs",
      mutate: (result: Record<string, any>) => {
        result.summary.evidenceRefs = ["analysis.summary.usage_kwh", "analysis.summary.usage_kwh"];
      },
    },
    {
      name: "an empty Section Artifact added as a contributing source",
      mutate: (result: Record<string, any>, harness: ReturnType<typeof createHarness>) => {
        result.sourceSectionArtifactIds.push(harness.emptySection.id);
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const harness = createHarness("invalid");
    try {
      const result = executiveResult(harness.executiveIdentity, harness.availableSection.id);
      mutate(result, harness);
      expect(() => complete(harness, harness.executiveIdentity, result))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      expect(harness.metadata.energyIq.overviewAiArtifacts.get(harness.availableSectionIdentity).status)
        .toBe("available");
    } finally {
      harness.close();
    }
  });
});

const createHarness = (suffix: string) => {
  const root = mkdtempSync(join(tmpdir(), `energyiq-executive-evidence-${suffix}-`));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.workspaces.upsert({ id: "artifact-workspace", owner_user_id: "dev-user", name: "Artifact", kind: "customer" });
  metadata.energyIq.upsertProject({
    id: "artifact-project",
    workspace_id: "artifact-workspace",
    name: "Artifact",
    status: "published",
  });
  const availableSectionIdentity = sectionIdentity("centre-benchmark");
  const emptySectionIdentity = sectionIdentity("planning-outlook");
  const availableSection = complete(metadataHarness(metadata), availableSectionIdentity, sectionResult(availableSectionIdentity, "available"));
  const emptySection = complete(metadataHarness(metadata), emptySectionIdentity, sectionResult(emptySectionIdentity, "empty"));
  return {
    metadata,
    availableSectionIdentity,
    availableSection,
    emptySection,
    executiveIdentity: executiveIdentity(),
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
};

const metadataHarness = (metadata: ReturnType<typeof createMetadataStore>) => ({ metadata });

const baseIdentity = (): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "artifact-workspace",
  projectId: "artifact-project",
  scopeId: "artifact-project-scope",
  resource: "electricity",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  analysisPackId: "preschool-section-pack",
  analysisPackRevision: "v2",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 1,
  outputContractRevision: "preschool-section-interpretation-v4",
  validatorRevision: "acceptance-validator-v2",
  workflowRevision: "discover-tools-accept-publish-v1",
  investigatorPromptRevision: "discovery-prompt-v2",
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
  identityContractRevision: "v4",
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "v1",
});

const sectionIdentity = (targetId: string): EnergyIqOverviewAiArtifactIdentity => ({
  ...baseIdentity(),
  artifactKind: "section-interpretation",
  targetId,
});

const executiveIdentity = (): EnergyIqOverviewAiArtifactIdentity => ({
  ...baseIdentity(),
  artifactKind: "executive-synthesis",
  targetId: "sections:test",
  analysisPackId: "preschool-executive-section-artifacts",
  analysisPackRevision: "section-interpretation-v4",
  outputContractRevision: "preschool-executive-synthesis-v4",
  validatorRevision: "preschool-executive-synthesis-validator-v6",
  workflowRevision: "preschool-executive-synthesis-v6",
  investigatorPromptRevision: "preschool-executive-synthesis-prompt-v6",
  capabilityRevision: "section-artifacts-and-overview-evidence-v2",
  publicationRevision: "key-findings-v2",
});

const binding = (identity: EnergyIqOverviewAiArtifactIdentity) => ({
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
});

const sectionResult = (identity: EnergyIqOverviewAiArtifactIdentity, status: "available" | "empty") => ({
  artifactKind: "section-interpretation",
  status,
  providerProfileId: identity.modelProfileId,
  runId: `run:${identity.targetId}`,
  contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
  binding: binding(identity),
  sectionId: identity.targetId,
  packRevision: "v2",
  capability: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionTools(identity.targetId ?? ""),
  },
  toolAudits: [],
  ...(status === "available"
    ? { summary: { text: "Current benchmark summary.", evidenceRefs: ["evidence:benchmark"] } }
    : {}),
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

const sectionTools = (sectionId: string) => {
  switch (sectionId) {
    case "centre-benchmark":
      return ["compare_centres", "inspect_related_section_signals"];
    case "standby-wastage":
    case "operating-behaviour":
      return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"];
    case "planning-outlook":
      return ["inspect_related_section_signals"];
    default:
      return [];
  }
};

const executiveResult = (identity: EnergyIqOverviewAiArtifactIdentity, sectionArtifactId: string): Record<string, any> => ({
  artifactKind: "executive-synthesis",
  status: "available",
  providerProfileId: identity.modelProfileId,
  runId: `run:${identity.targetId}`,
  contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v4" },
  binding: binding(identity),
  sourceSectionArtifactIds: [sectionArtifactId],
  summary: {
    text: "The 120 kWh total adds context to the current benchmark.",
    evidenceRefs: ["analysis.summary.usage_kwh", "evidence:benchmark"],
  },
  overviewEvidence: {
    contract: "analysis-context-evidence@1",
    sourceId: "project-analysis-snapshot:artifact-project:snapshot-current",
    pins: {
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      dataCutoff: "2026-05-31T23:45:00.000Z",
      projectReleaseId: identity.projectReleaseId,
      metricVersion: "energy-v1",
    },
    factIds: ["analysis.summary.usage_kwh"],
    facts: [{
      id: "analysis.summary.usage_kwh",
      label: "Portfolio energy use",
      metricId: "energy.total_usage_kwh",
      value: 120,
      unit: "kWh",
      status: "confirmed",
      evidenceRefs: ["query:overview-current"],
      dimensions: {},
    }],
  },
  findings: [{
    id: "finding-1",
    title: "Portfolio context",
    text: "The 120 kWh total and benchmark evidence support review.",
    sectionIds: ["centre-benchmark"],
    evidenceRefs: ["analysis.summary.usage_kwh", "evidence:benchmark"],
  }],
});

const complete = (
  harness: { metadata: ReturnType<typeof createMetadataStore> },
  identity: EnergyIqOverviewAiArtifactIdentity,
  result: unknown,
) => {
  const store = harness.metadata.energyIq.overviewAiArtifacts;
  store.queue({ identity, triggeredBy: "dev-user" });
  const workerId = `worker:${identity.artifactKind}:${identity.targetId}`;
  store.claim({ identity, workerId, leaseMs: 60_000 });
  return store.complete({
    identity,
    workerId,
    sessionId: `session:${identity.targetId}`,
    runId: `run:${identity.targetId}`,
    resultJson: JSON.stringify(result),
  });
};

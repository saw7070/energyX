import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import { createMetadataStore, type UserRecord } from "@datafoundry/metadata";
import { toStandardSchema } from "@mastra/core/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createNgeeAnnAdditionalAiInsightArtifactIdentity,
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { resolveWorkspaceDefaultModelProfileSnapshot } from "../workspace-model-profile-resolver.js";
import {
  createPreschoolAdditionalAiInsightsWorkflow,
  createPreschoolAdditionalAiPresentedClaims,
} from "./preschool-additional-ai-insights-workflow.js";
import { composePreschoolOverviewAiReadModel } from "./preschool-overview-ai-read-model.js";
import { PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3 } from "./preschool-overview-ai-structured-output.js";

describe("Preschool Additional AI Insights workflow", () => {
  it("projects the current Additional identity before composing presented Layer 1 and 2 claims", async () => {
    const harness = createHarness();
    const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
      expect(prompt).toContain("Call energyiq_additional_insights_submit");
      expect(prompt).toContain("do not emit the Candidate envelope as Assistant text");
      expect(prompt).not.toContain("Return JSON only");
      return {
        answer: JSON.stringify({ candidates: [] }),
        runId,
        sessionId,
      };
    });
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({
            identity,
            catalog: currentCatalog,
            readModel: composePreschoolOverviewAiReadModel({
              metadataStore: harness.metadata,
              baseIdentity: identity,
            }),
          }),
        runDiscovery,
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "presented-claims-run",
        sessionId: "presented-claims-session",
      })).resolves.toMatchObject({
        status: "empty",
        publication: { discoveredCount: 0, acceptedCount: 0, rejectedCount: 0 },
      });
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("keeps a complete current Snapshot prompt when its evidence context is between 160k and 192k characters", async () => {
    const harness = createHarness();
    const baseCatalog = catalog();
    const firstFact = baseCatalog.facts[0]!;
    const largeCatalog: AnalysisContextEvidenceCatalog = {
      ...baseCatalog,
      facts: [
        { ...firstFact, label: `${firstFact.label} ${"x".repeat(80_000)}` },
        ...baseCatalog.facts.slice(1),
      ],
    };
    const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
      expect(prompt.length).toBeGreaterThan(160_000);
      expect(prompt.length).toBeLessThanOrEqual(192_000);
      return {
        answer: JSON.stringify({ candidates: [] }),
        runId,
        sessionId,
      };
    });
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => largeCatalog,
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({
            identity,
            catalog: currentCatalog,
            readModel: composePreschoolOverviewAiReadModel({
              metadataStore: harness.metadata,
              baseIdentity: identity,
            }),
          }),
        runDiscovery,
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "large-complete-prompt-run",
        sessionId: "large-complete-prompt-session",
      })).resolves.toMatchObject({ status: "empty" });
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("preserves Pack claim provenance while accepting a new Catalog-Evidence relationship", async () => {
    const harness = createHarness();
    try {
      const sectionEvidenceRef = "preschool:snapshot-current:section-standby-wastage:summary";
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        expect(prompt).toContain("Already-presented claim digests");
        expect(prompt).toContain("section:standby-wastage:summary");
        expect(prompt).toContain(sectionEvidenceRef);
        return {
          answer: JSON.stringify({ candidates: [
            candidate("candidate-restatement", "fact:standby-share", {
              title: "The selected period remains 31% standby",
              text: "During the selected period, standby energy use represents 31%.",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: ["section:standby-wastage:summary"],
                novelConclusion: "During the selected period, standby energy use represents 31%.",
              },
            }),
            candidate("candidate-hypothesis", "fact:standby-share", {
              title: "The same share may hide a concentrated timing pattern",
              text: "Although standby use is 31%, a small number of recurring intervals may account for most of it; test that concentration before choosing an intervention.",
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: ["section:standby-wastage:summary"],
                novelConclusion: "a small number of recurring intervals may account for most of it",
              },
            }),
            candidate("candidate-forged-claim", "fact:standby-share", {
              title: "A forged relationship",
              text: "This relationship cites an unknown presented claim.",
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: ["section:standby-wastage:forged"],
                novelConclusion: "Test a relationship to a claim that is not in the current envelope.",
              },
            }),
          ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) => {
          const claims = createPreschoolAdditionalAiPresentedClaims({
            identity,
            catalog: currentCatalog,
            readModel: presentedReadModel({
              dataSnapshotId: "snapshot-current",
              sectionEvidenceRef,
            }),
          });
          expect(claims.claims).toEqual(expect.arrayContaining([expect.objectContaining({
            id: "section:standby-wastage:summary",
            artifactId: "section-artifact-standby",
            sourceEvidenceRefs: [sectionEvidenceRef],
          })]));
          return claims;
        },
        runDiscovery,
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "incremental-claim-run",
        sessionId: "incremental-claim-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 3,
          acceptedCount: 1,
          rejectedCount: 2,
          acceptedCandidateIds: ["candidate-hypothesis"],
          rejectedCandidateIds: ["candidate-restatement", "candidate-forged-claim"],
        },
        findings: [{ id: "additional:candidate-hypothesis", epistemicStatus: "speculative" }],
      });
    } finally {
      harness.close();
    }
  });

  it("binds claimed novelty to the actual published narrative", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-novelty-bypass", "fact:standby-share", {
              title: "fact:standby-share: 31 %",
              text: "fact:standby-share: 31 %",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
                novelConclusion: "A separate timing relationship should be tested.",
              },
            }),
            candidate("candidate-deep-dive-bypass", "fact:standby-share", {
              title: "fact:standby-share: 31 %",
              text: "fact:standby-share: 31 %",
              deepDiveQuestion: "Could a separate timing relationship be tested?",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
                novelConclusion: "Could a separate timing relationship be tested?",
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "novelty-binding-run",
        sessionId: "novelty-binding-session",
      });

      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 0,
        rejectedCount: 2,
        rejectedCandidateIds: ["candidate-novelty-bypass", "candidate-deep-dive-bypass"],
      });
    } finally {
      harness.close();
    }
  });

  it("applies deterministic presented baselines even when the model supplies no related claim IDs", async () => {
    const harness = createHarness();
    try {
      const newRelationship = "fact:standby-share: 31 %, while weekday concentration may move differently; test that relationship.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-empty-related-restatement", "fact:standby-share", {
              title: "fact:standby-share: 31 %",
              text: "fact:standby-share: 31 %",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: [],
                novelConclusion: "fact:standby-share: 31 %",
              },
            }),
            candidate("candidate-empty-related-new", "fact:standby-share", {
              title: "Test whether the share hides a weekday relationship",
              text: newRelationship,
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: [],
                novelConclusion: newRelationship,
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "empty-related-baseline-run",
        sessionId: "empty-related-baseline-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        acceptedCandidateIds: ["candidate-empty-related-new"],
        rejectedCandidateIds: ["candidate-empty-related-restatement"],
      });
    } finally {
      harness.close();
    }
  });

  it("ignores a malformed alias for a deterministic baseline that the server already binds exactly", async () => {
    const harness = createHarness();
    try {
      const novelConclusion = "The standby share may hide a recurring weekday timing pattern worth testing.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-malformed-deterministic-alias", "fact:standby-share", {
            title: "Test whether standby follows a weekday timing pattern",
            observation: "Standby is 31%.",
            angle: novelConclusion,
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["determinostic-overview:fact:standby-share"],
              novelConclusion,
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "malformed-deterministic-alias-run",
        sessionId: "malformed-deterministic-alias-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          acceptedCandidateIds: ["candidate-malformed-deterministic-alias"],
          rejectedCandidateIds: [],
        },
        findings: [{ id: "additional:candidate-malformed-deterministic-alias" }],
      });
    } finally {
      harness.close();
    }
  });

  it("accepts a same-Evidence superset only when the actual narrative adds a testable relationship", async () => {
    const harness = createHarness();
    try {
      const narrative = "fact:standby-share: 31 %, while its weekday concentration may move differently; test that relationship.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-superset-relation", "fact:standby-share", {
            title: "Test whether the share hides a weekday relationship",
            text: narrative,
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
              novelConclusion: narrative,
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "superset-relation-run",
        sessionId: "superset-relation-session",
      });
      expect(result.publication.acceptedCandidateIds).toEqual(["candidate-superset-relation"]);
    } finally {
      harness.close();
    }
  });

  it("allows a factual baseline in the title when the bound conclusion adds a new relationship", async () => {
    const harness = createHarness();
    try {
      const novelConclusion = "The contrast with operating use may hide a recurring weekday timing pattern worth testing.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-baseline-title-new-relation", "fact:standby-share", {
            title: "fact:standby-share: 31 %",
            text: `Operating use is 69%. ${novelConclusion}`,
            epistemicStatus: "inferred",
            evidenceRefs: ["fact:standby-share", "fact:operating-share"],
            incrementalContext: {
              relatedPresentedClaimIds: [
                "deterministic-overview:fact:standby-share",
                "deterministic-overview:fact:operating-share",
              ],
              novelConclusion,
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "baseline-title-new-relation-run",
        sessionId: "baseline-title-new-relation-session",
      });
      expect(result.publication.acceptedCandidateIds).toEqual(["candidate-baseline-title-new-relation"]);
    } finally {
      harness.close();
    }
  });

  it("projects exact deterministic, Section, and Key Finding claims for the current Snapshot", () => {
    const harness = createHarness();
    try {
      const projected = createPreschoolAdditionalAiPresentedClaims({
        identity: harness.additionalIdentity,
        catalog: catalog(),
        readModel: {
          binding: {
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
            modelProfileId: "workspace-default",
            modelProfileRevision: 1,
          },
          sections: {
            "standby-wastage": {
              status: "available",
              artifactId: "section-artifact-standby",
              result: {
                artifactKind: "section-interpretation",
                status: "available",
                sectionId: "standby-wastage",
                binding: {
                  workspaceId: PRESCHOOL_WORKSPACE_ID,
                  projectId: "preschool-demo",
                  scopeId: "preschool-project",
                  dataSnapshotId: "snapshot-current",
                  projectReleaseId: "release-current",
                  analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
                  modelProfileId: "workspace-default",
                  modelProfileRevision: 1,
                },
                summary: {
                  text: "Standby accounts for 31%.",
                  evidenceRefs: ["preschool:snapshot-current:section-standby-wastage:summary"],
                },
                insights: [{
                  id: "standby-pattern",
                  title: "Standby pattern",
                  text: "The 31% share is already visible.",
                  epistemicStatus: "observed",
                  evidenceRefs: ["preschool:snapshot-current:section-standby-wastage:insight:standby-pattern"],
                }],
              },
            },
          },
          executive: {
            status: "available",
            artifactId: "executive-artifact-current",
            result: {
              artifactKind: "executive-synthesis",
              status: "available",
              binding: {
                workspaceId: PRESCHOOL_WORKSPACE_ID,
                projectId: "preschool-demo",
                scopeId: "preschool-project",
                dataSnapshotId: "snapshot-current",
                projectReleaseId: "release-current",
                analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
                modelProfileId: "workspace-default",
                modelProfileRevision: 1,
              },
              summary: { text: "Operating use is 69%.", evidenceRefs: ["fact:operating-share"] },
              findings: [{
                id: "operating-theme",
                title: "Operating theme",
                text: "Operating use accounts for 69%.",
                evidenceRefs: ["fact:operating-share"],
                sectionIds: ["operating-behaviour"],
              }],
            },
          },
        },
      });

      expect(projected.claims).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "deterministic-overview:fact:standby-share",
          source: "deterministic-overview",
          sourceEvidenceRefs: ["fact:standby-share"],
        }),
        {
          id: "section:standby-wastage:summary",
          source: "section-summary",
          sectionId: "standby-wastage",
          artifactId: "section-artifact-standby",
          text: "Standby accounts for 31%.",
          sourceEvidenceRefs: ["preschool:snapshot-current:section-standby-wastage:summary"],
        },
        expect.objectContaining({ id: "section:standby-wastage:insight:standby-pattern" }),
        expect.objectContaining({ id: "key-finding:operating-theme", artifactId: "executive-artifact-current" }),
      ]));
    } finally {
      harness.close();
    }
  });

  it("does not carry presented Section provenance across Snapshot identities", () => {
    const harness = createHarness();
    try {
      const nextBaseIdentity = createOverviewAiArtifactIdentity({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        dataSnapshotId: "snapshot-next",
        projectReleaseId: "release-current",
        analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
        analysisPeriodTo: "2026-06-01T00:00:00.000Z",
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        modelProfileId: "workspace-default",
        modelProfileRevision: 1,
      });
      const nextIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: nextBaseIdentity });
      const nextCatalog = catalog();
      nextCatalog.sourceId = "project-analysis-snapshot:preschool-demo:snapshot-next";
      nextCatalog.pins.dataSnapshotId = "snapshot-next";

      expect(() => createPreschoolAdditionalAiPresentedClaims({
        identity: nextIdentity,
        catalog: nextCatalog,
        readModel: presentedReadModel({
          dataSnapshotId: "snapshot-current",
          sectionEvidenceRef: "preschool:snapshot-current:section-standby-wastage:summary",
        }),
      })).toThrowError("PRESCHOOL_ADDITIONAL_AI_PRESENTED_READ_MODEL_INVALID");

      const projected = createPreschoolAdditionalAiPresentedClaims({
        identity: nextIdentity,
        catalog: nextCatalog,
        readModel: presentedReadModel({
          dataSnapshotId: "snapshot-next",
          sectionEvidenceRef: "preschool:snapshot-next:section-standby-wastage:summary",
        }),
      });
      const sectionClaim = projected.claims.find(({ id }) => id === "section:standby-wastage:summary");
      expect(sectionClaim?.sourceEvidenceRefs).toEqual([
        "preschool:snapshot-next:section-standby-wastage:summary",
      ]);
      expect(JSON.stringify(projected.claims)).not.toContain("preschool:snapshot-current:section-");
    } finally {
      harness.close();
    }
  });

  it("ignores malformed presented units locally without losing deterministic or valid sibling claims", () => {
    const harness = createHarness();
    try {
      const projected = createPreschoolAdditionalAiPresentedClaims({
        identity: harness.additionalIdentity,
        catalog: catalog(),
        readModel: {
          binding: {
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
            modelProfileId: "workspace-default",
            modelProfileRevision: 1,
          },
          sections: {
            "standby-wastage": {
              status: "available",
              artifactId: "section-malformed",
              result: { status: "available", summary: { text: "Malformed.", evidenceRefs: ["fact:standby-share"] } },
            },
            "operating-behaviour": {
              status: "available",
              artifactId: "section-valid",
              result: {
                artifactKind: "section-interpretation",
                status: "available",
                sectionId: "operating-behaviour",
                binding: {
                  workspaceId: PRESCHOOL_WORKSPACE_ID,
                  projectId: "preschool-demo",
                  scopeId: "preschool-project",
                  dataSnapshotId: "snapshot-current",
                  projectReleaseId: "release-current",
                  analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
                  modelProfileId: "workspace-default",
                  modelProfileRevision: 1,
                },
                summary: { text: "Operating share is 69%.", evidenceRefs: ["fact:operating-share"] },
                insights: [],
              },
            },
          },
          executive: {
            status: "available",
            artifactId: "executive-malformed",
            result: { status: "available", summary: { text: "Malformed.", evidenceRefs: ["fact:standby-share"] } },
          },
        },
      });

      expect(projected.claims).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "deterministic-overview:fact:standby-share" }),
        expect.objectContaining({ id: "section:operating-behaviour:summary", artifactId: "section-valid" }),
      ]));
      expect(projected.claims).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ artifactId: "section-malformed" }),
        expect.objectContaining({ artifactId: "executive-malformed" }),
      ]));
    } finally {
      harness.close();
    }
  });

  it.each([null, "malformed-executive"])(
    "ignores a non-object Executive locally without losing valid Section claims: %j",
    (executive) => {
      const harness = createHarness();
      try {
        const readModel = presentedReadModel({
          dataSnapshotId: "snapshot-current",
          sectionEvidenceRef: "preschool:snapshot-current:section-standby-wastage:summary",
        });
        const projected = createPreschoolAdditionalAiPresentedClaims({
          identity: harness.additionalIdentity,
          catalog: catalog(),
          readModel: { ...readModel, executive },
        });
        expect(projected.claims).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "deterministic-overview:fact:standby-share" }),
          expect.objectContaining({ id: "section:standby-wastage:summary" }),
        ]));
      } finally {
        harness.close();
      }
    },
  );

  it("rejects candidate-local numbers and Centre entities not covered by its own Evidence refs", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        entityFact("fact:centre-g-intensity", "Centre G", 3.26),
        entityFact("fact:centre-n-intensity", "Centre N", 3.26),
        entityFact("fact:centre-q-intensity", "Centre Q", 4.75),
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-wrong-centre", "fact:centre-g-intensity", {
              title: "Centre N reaches 3.26 kWh/m2",
              text: "Centre N records 3.26 kWh/m2, despite citing only Centre G Evidence.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-intensity"),
            }),
            candidate("candidate-centre-n", "fact:centre-n-intensity", {
              title: "Centre N reaches 3.26 kWh/m2",
              text: "Centre N records 3.26 kWh/m2; compare its operating pattern before inferring a driver.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-n-intensity"),
            }),
            candidate("candidate-centre-q", "fact:centre-q-intensity", {
              title: "Centre Q reaches 4.75 kWh/m2",
              text: "Centre Q records 4.75 kWh/m2; test whether its timing differs from peers.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-q-intensity"),
            }),
            candidate("candidate-wrong-centre-without-number", "fact:centre-g-intensity", {
              title: "Centre N warrants a timing check",
              text: "Centre N warrants a separate timing check despite citing only Centre G Evidence.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-intensity"),
            }),
            candidate("candidate-centre-n-without-number", "fact:centre-n-intensity", {
              title: "Centre N warrants a timing check",
              text: "Centre N warrants a separate timing check before attributing a driver.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-n-intensity"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "candidate-lineage-run",
        sessionId: "candidate-lineage-session",
      });

      expect(result.publication).toMatchObject({
        discoveredCount: 5,
        acceptedCount: 3,
        rejectedCount: 2,
        acceptedCandidateIds: ["candidate-centre-n", "candidate-centre-q", "candidate-centre-n-without-number"],
        rejectedCandidateIds: ["candidate-wrong-centre", "candidate-wrong-centre-without-number"],
      });
    } finally {
      harness.close();
    }
  });

  it("keeps plural-dimension cross-signal Insights and replaces one unsupported title with its factual observation", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        {
          id: "fact:after-hours-centres",
          label: "Centres with closed-hour peaks",
          metricId: "preschool.operating.centre_count",
          value: 4,
          unit: "count",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:after-hours-centres"],
          dimensions: { centreCodes: "L,G,E,N" },
        },
        {
          id: "fact:priority-centres",
          label: "Priority efficiency Centres",
          metricId: "preschool.benchmark.priority_count",
          value: 3,
          unit: "count",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:priority-centres"],
          dimensions: { centreCodes: "J,G,M" },
        },
      );
      const evidenceRefs = ["fact:after-hours-centres", "fact:priority-centres"];
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-centre-g-overlap", evidenceRefs[0]!, {
              title: "Centre G spans both after-hours and efficiency-priority groups",
              observation: "Centre G appears in both the closed-hour and efficiency-priority Centre sets.",
              angle: "That overlap may make Centre G's closed-hour pattern a possible contributor to its efficiency signal.",
              evidenceRefs,
              incrementalContext: {
                relatedPresentedClaimIds: evidenceRefs.map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "Centre G spans both after-hours and efficiency-priority groups",
              },
            }),
            candidate("candidate-wrong-two-of-three", evidenceRefs[0]!, {
              title: "2 of 3 priority Centres show closed-hour peaks",
              observation: "Centre G appears in both the closed-hour and efficiency-priority Centre sets.",
              angle: "That overlap could be explored before attributing a cause.",
              evidenceRefs,
              incrementalContext: {
                relatedPresentedClaimIds: evidenceRefs.map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "2 of 3 priority Centres show closed-hour peaks",
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "plural-dimension-candidate-run",
        sessionId: "plural-dimension-candidate-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 2,
          acceptedCount: 2,
          rejectedCount: 0,
          acceptedCandidateIds: ["candidate-centre-g-overlap", "candidate-wrong-two-of-three"],
          rejectedCandidateIds: [],
        },
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          id: "additional:candidate-centre-g-overlap",
          epistemicStatus: "inferred",
          evidenceRefs,
        }),
        expect.objectContaining({
          id: "additional:candidate-wrong-two-of-three",
          title: "Centre G appears in both the closed-hour and efficiency-priority Centre sets.",
          epistemicStatus: "inferred",
          evidenceRefs,
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("replaces unsupported factual-ordering titles while preserving their supported observations and angles", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        {
          id: "fact:off-hours-energy",
          label: "Off-hours energy use",
          metricId: "energy.off_hours_usage_kwh",
          value: 2631.0813,
          unit: "kWh",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:off-hours-energy"],
          dimensions: {},
        },
        {
          id: "fact:aircon-energy",
          label: "aircon energy use",
          metricId: "energy.category_usage_kwh",
          value: 5468.9737,
          unit: "kWh",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:aircon-energy"],
          dimensions: { category: "aircon" },
        },
        entityFact("fact:centre-l-per-person", "Centre L", 24.7851),
        {
          id: "fact:after-hours-centres",
          label: "Centres with closed-hour peaks",
          metricId: "preschool.operating.centre_count",
          value: 4,
          unit: "count",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:after-hours-centres"],
          dimensions: { centreCodes: "L,G,E,N" },
        },
        {
          id: "fact:centre-l-priority",
          label: "Centre L priority flag",
          metricId: "preschool.benchmark.priority_flag",
          value: false,
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:centre-l-priority"],
          dimensions: { centreCode: "L" },
        },
        {
          id: "fact:centre-g-eui-rank",
          label: "Centre G EUI rank",
          metricId: "preschool.benchmark.eui_rank",
          value: 1,
          unit: "rank",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:centre-g-eui-rank"],
          dimensions: { centreCode: "G", metric: "eui", rank: "1" },
        },
      );
      const energyRefs = ["fact:off-hours-energy", "fact:aircon-energy"];
      const centreRefs = ["fact:centre-l-per-person", "fact:after-hours-centres", "fact:centre-l-priority"];
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-false-exceeds", energyRefs[0]!, {
              title: "Closed-hour 2631.0813 kWh exceeds Aircon category total",
              observation: "Off-hours energy is 2631.0813 kWh while Aircon energy is 5468.9737 kWh.",
              angle: "The relationship may still justify checking the closed-hour category mix.",
              evidenceRefs: energyRefs,
              incrementalContext: {
                relatedPresentedClaimIds: energyRefs.map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "Closed-hour 2631.0813 kWh exceeds Aircon category total",
              },
            }),
            candidate("candidate-unsupported-top", centreRefs[0]!, {
              title: "Centre L has top absolute use despite escaping the priority screen",
              observation: "Centre L appears in the closed-hour Centre set and is not marked as a priority Centre.",
              angle: "Its absolute use may deserve a separate review from the intensity screen.",
              evidenceRefs: centreRefs,
              incrementalContext: {
                relatedPresentedClaimIds: centreRefs.map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "Centre L has top absolute use despite escaping the priority screen",
              },
            }),
            candidate("candidate-transparent-hypothesis", energyRefs[0]!, {
              title: "Closed-hour composition may differ from the overall category mix",
              observation: "Off-hours energy is 2631.0813 kWh while Aircon energy is 5468.9737 kWh.",
              angle: "The closed-hour composition may differ from the overall category mix, which is worth testing at circuit level.",
              evidenceRefs: energyRefs,
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: energyRefs.map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "Closed-hour composition may differ from the overall category mix",
              },
            }),
            candidate("candidate-qualified-false-observation", energyRefs[0]!, {
              title: "A timing comparison may deserve review",
              observation: "Off-hours energy exceeds Aircon energy, which may matter.",
              angle: "The relationship may justify a category-level timing check.",
              evidenceRefs: energyRefs,
              incrementalContext: {
                relatedPresentedClaimIds: energyRefs.map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "A timing comparison may deserve review",
              },
            }),
            candidate("candidate-cross-centre-rank-leak", centreRefs[0]!, {
              title: "A separate absolute-use lens may help",
              observation: "Centre L has highest absolute energy use across the portfolio.",
              angle: "Absolute use may reveal a different priority from the intensity screen.",
              evidenceRefs: [...centreRefs, "fact:centre-g-eui-rank"],
              incrementalContext: {
                relatedPresentedClaimIds: [...centreRefs, "fact:centre-g-eui-rank"]
                  .map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "A separate absolute-use lens may help",
              },
            }),
            candidate("candidate-multi-centre-rank-leak", "fact:centre-g-eui-rank", {
              title: "A shared intensity pattern may deserve review",
              observation: "Centre G and Centre L have highest EUI across the portfolio.",
              angle: "A shared high-intensity pattern could point to a common operating condition.",
              evidenceRefs: ["fact:centre-g-eui-rank", ...centreRefs],
              incrementalContext: {
                relatedPresentedClaimIds: ["fact:centre-g-eui-rank", ...centreRefs]
                  .map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "A shared intensity pattern may deserve review",
              },
            }),
            candidate("candidate-mixed-direction-rank-leak", "fact:centre-g-eui-rank", {
              title: "The intensity extremes may deserve review",
              observation: "Centre G has highest EUI but lowest EUI across the portfolio.",
              angle: "Contradictory extremes would warrant checking the comparison basis.",
              evidenceRefs: ["fact:centre-g-eui-rank"],
              incrementalContext: {
                relatedPresentedClaimIds: ["deterministic-overview:fact:centre-g-eui-rank"],
                novelConclusion: "The intensity extremes may deserve review",
              },
            }),
            candidate("candidate-most-energy-rank-leak", "fact:centre-g-eui-rank", {
              title: "Absolute use may deserve a separate review",
              observation: "Centre L uses the most energy across the portfolio.",
              angle: "Absolute use could identify a different operational priority.",
              evidenceRefs: ["fact:centre-g-eui-rank", ...centreRefs],
              incrementalContext: {
                relatedPresentedClaimIds: ["fact:centre-g-eui-rank", ...centreRefs]
                  .map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "Absolute use may deserve a separate review",
              },
            }),
            candidate("candidate-ranks-first-eui-leak", "fact:centre-g-eui-rank", {
              title: "The EUI ranking may deserve a separate review",
              observation: "Centre L ranks first for EUI across the portfolio.",
              angle: "The EUI ranking could identify a different operational priority.",
              evidenceRefs: ["fact:centre-g-eui-rank", ...centreRefs],
              incrementalContext: {
                relatedPresentedClaimIds: ["fact:centre-g-eui-rank", ...centreRefs]
                  .map((ref) => `deterministic-overview:${ref}`),
                novelConclusion: "The EUI ranking may deserve a separate review",
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "factual-ordering-run",
        sessionId: "factual-ordering-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          acceptedCandidateIds: [
            "candidate-false-exceeds",
            "candidate-unsupported-top",
            "candidate-transparent-hypothesis",
          ],
          rejectedCandidateIds: [
            "candidate-qualified-false-observation",
            "candidate-cross-centre-rank-leak",
            "candidate-multi-centre-rank-leak",
            "candidate-mixed-direction-rank-leak",
            "candidate-most-energy-rank-leak",
            "candidate-ranks-first-eui-leak",
          ],
        },
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          id: "additional:candidate-false-exceeds",
          title: "Off-hours energy is 2631.0813 kWh while Aircon energy is 5468.9737 kWh.",
        }),
        expect.objectContaining({
          id: "additional:candidate-unsupported-top",
          title: "Centre L appears in the closed-hour Centre set and is not marked as a priority Centre.",
        }),
        expect.objectContaining({ id: "additional:candidate-transparent-hypothesis" }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("accepts common superlative wording when exact metric and rank Evidence supports it", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        {
          id: "fact:centre-l-absolute-rank",
          label: "Centre L absolute energy rank",
          metricId: "preschool.benchmark.absolute_usage_rank",
          value: 1,
          unit: "rank",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:centre-l-absolute-rank"],
          dimensions: { centreCode: "L", metric: "absolute-energy", rank: "1" },
        },
        {
          id: "fact:centre-g-eui-rank",
          label: "Centre G EUI rank",
          metricId: "preschool.benchmark.eui_rank",
          value: 1,
          unit: "rank",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:centre-g-eui-rank"],
          dimensions: { centreCode: "G", metric: "eui", rank: "1" },
        },
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-most-electricity", "fact:centre-l-absolute-rank", {
              title: "Absolute energy use may deserve a separate lens",
              observation: "Centre L uses the most electricity across the portfolio.",
              angle: "This may reveal a different priority from the normalised intensity screen.",
              evidenceRefs: ["fact:centre-l-absolute-rank"],
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-l-absolute-rank"),
            }),
            candidate("candidate-first-energy-intensity", "fact:centre-g-eui-rank", {
              title: "The intensity leader may deserve a targeted review",
              observation: "Centre G ranks first for energy intensity across the portfolio.",
              angle: "This could focus a like-for-like operational comparison.",
              evidenceRefs: ["fact:centre-g-eui-rank"],
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-eui-rank"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "supported-superlatives-run",
        sessionId: "supported-superlatives-session",
      });

      expect(result.publication).toMatchObject({
        acceptedCandidateIds: ["candidate-most-electricity", "candidate-first-energy-intensity"],
        rejectedCandidateIds: [],
      });
    } finally {
      harness.close();
    }
  });

  it("uses the complete Catalog Centre vocabulary while validating only candidate-cited Evidence", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        entityFact("fact:centre-g-intensity", "Centre G", 3.26),
        entityFact("fact:centre-aa-intensity", "Centre AA", 4.25),
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-aa-with-g-evidence", "fact:centre-g-intensity", {
              title: "centre aa warrants a timing check",
              text: "centre aa warrants a separate timing check despite citing only Centre G Evidence.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-intensity"),
            }),
            candidate("candidate-aa-with-aa-evidence", "fact:centre-aa-intensity", {
              title: "centre aa warrants a separate check",
              text: "centre aa warrants a separate timing check before attributing a driver.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-aa-intensity"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "candidate-aa-lineage-run",
        sessionId: "candidate-aa-lineage-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        acceptedCandidateIds: ["candidate-aa-with-aa-evidence"],
        rejectedCandidateIds: ["candidate-aa-with-g-evidence"],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects explicit causal, action, and external-benchmark assertions that overstate their epistemic status", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-causal-observed", "fact:standby-share", {
              title: "Area and occupancy drive the variance",
              text: "The difference is driven by area and occupancy.",
              epistemicStatus: "observed",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-action-observed", "fact:standby-share", {
              title: "The highest-leverage reduction target",
              text: "Standby is the best reduction target.",
              epistemicStatus: "observed",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-causal-inferred", "fact:standby-share", {
              title: "Occupancy may help explain the variance",
              text: "The pattern may be driven by occupancy, which remains an inference to test.",
              epistemicStatus: "inferred",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-industry-inferred", "fact:standby-share", {
              title: "Typical learning environments should behave this way",
              text: "Cooling should dominate in a tropical preschool.",
              epistemicStatus: "inferred",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-industry-hypothesis", "fact:standby-share", {
              title: "Test whether cooling dominates in this setting",
              text: "Cooling dominance is an external hypothesis to verify, not an observed industry benchmark.",
              epistemicStatus: "speculative",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-causal-deep-dive", "fact:standby-share", {
              title: "Check the variance boundary",
              text: "The measured share is the only observed result.",
              deepDiveQuestion: "Is the variance driven by occupancy?",
              epistemicStatus: "observed",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "epistemic-boundary-run",
        sessionId: "epistemic-boundary-session",
      });

      expect(result.publication).toMatchObject({
        discoveredCount: 6,
        acceptedCount: 2,
        rejectedCount: 4,
        acceptedCandidateIds: ["candidate-causal-inferred", "candidate-industry-hypothesis"],
        rejectedCandidateIds: [
          "candidate-causal-observed",
          "candidate-action-observed",
          "candidate-industry-inferred",
          "candidate-causal-deep-dive",
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("normalizes AI-discovered multi-Evidence relationships to inferred without guessing from prose keywords", async () => {
    const harness = createHarness();
    try {
      const relationship = (id: string, epistemicStatus: "observed" | "inferred", qualifier: string) =>
        candidate(id, "fact:standby-share", {
          title: `Compare the two shares ${qualifier}`,
          text: `Standby is 31% while operating is 69%; ${qualifier}.`,
          epistemicStatus,
          evidenceRefs: ["fact:standby-share", "fact:operating-share"],
          incrementalContext: {
            relatedPresentedClaimIds: [],
            novelConclusion: `Standby is 31% while operating is 69%; ${qualifier}.`,
          },
        });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            relationship("candidate-relational-observed", "observed", "their connection is newly asserted"),
            relationship("candidate-relational-inferred", "inferred", "their connection remains an inference to test"),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "structured-epistemic-run",
        sessionId: "structured-epistemic-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 2,
        rejectedCount: 0,
        acceptedCandidateIds: ["candidate-relational-observed", "candidate-relational-inferred"],
        rejectedCandidateIds: [],
      });
      expect(result.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "additional:candidate-relational-observed", epistemicStatus: "inferred" }),
        expect.objectContaining({ id: "additional:candidate-relational-inferred", epistemicStatus: "inferred" }),
      ]));
    } finally {
      harness.close();
    }
  });

  it("accepts a production-shaped new relationship from the published narrative without trusting a verbatim novelty declaration", async () => {
    const harness = createHarness();
    try {
      const relationshipCatalog: AnalysisContextEvidenceCatalog = {
        ...catalog(),
        facts: [
          entityFact("fact:centre-l-closed-peak", "Centre L", 1),
          entityFact("fact:centre-e-closed-peak", "Centre E", 1),
          entityFact("fact:centre-n-closed-peak", "Centre N", 1),
          entityFact("fact:centre-j-closed-peak", "Centre J", 0),
          entityFact("fact:centre-g-closed-peak", "Centre G", 0),
          entityFact("fact:centre-m-closed-peak", "Centre M", 0),
        ],
      };
      const evidenceRefs = relationshipCatalog.facts.map(({ id }) => id);
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => relationshipCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-closed-hour-relationship", evidenceRefs[0]!, {
              title: "Closed-hour peaks split the six Centres into two groups",
              text: "Centres L, E and N show a closed-hour peak pattern that is absent for Centres J, G and M; treat the grouping as an inference to verify.",
              epistemicStatus: "observed",
              evidenceRefs,
              incrementalContext: {
                relatedPresentedClaimIds: [],
                novelConclusion: "The six locations form a potentially useful operational contrast.",
              },
            }),
            candidate("candidate-closed-hour-restatement", evidenceRefs[0]!, {
              title: "Centre L energy intensity",
              text: "Centre L energy intensity is 1 kWh/m2.",
              epistemicStatus: "observed",
              evidenceRefs: [evidenceRefs[0]],
              incrementalContext: {
                relatedPresentedClaimIds: [],
                novelConclusion: "A different wording that should not create novelty.",
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "production-shaped-novelty-run",
        sessionId: "production-shaped-novelty-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 2,
          acceptedCount: 1,
          rejectedCount: 1,
          acceptedCandidateIds: ["candidate-closed-hour-relationship"],
          rejectedCandidateIds: ["candidate-closed-hour-restatement"],
        },
        findings: [{
          id: "additional:candidate-closed-hour-relationship",
          epistemicStatus: "inferred",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects overlong or title-list summaries while preserving a concise highest-value Finding", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-title-list", "fact:standby-share", {
              title: "First repeated title; second repeated title; third repeated title",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-title-overlong", "fact:standby-share", {
              title: "One ostensibly incremental conclusion ".repeat(8),
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-title-multiple-sentences", "fact:standby-share", {
              title: "The share is stable. A timing relationship remains untested",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-title-long-under-old-limit", "fact:standby-share", {
              title: "A concise finding should not become a long management-summary headline that carries several loosely connected qualifications",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-concise", "fact:standby-share", {
              title: "Standby concentration is worth testing",
              text: "The existing share may be concentrated in a small set of intervals.",
              epistemicStatus: "speculative",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "concise-summary-run",
        sessionId: "concise-summary-session",
      });

      expect(result.publication).toMatchObject({
        acceptedCandidateIds: ["candidate-concise"],
        rejectedCandidateIds: [
          "candidate-title-list",
          "candidate-title-overlong",
          "candidate-title-multiple-sentences",
          "candidate-title-long-under-old-limit",
        ],
      });
      expect(result.findings[0]?.title).toBe("Standby concentration is worth testing");
    } finally {
      harness.close();
    }
  });

  it("runs independent evaluation attempts through the real acceptance seam without current Artifact queue/cache", async () => {
    const harness = createHarness();
    try {
      const runDiscovery = vi.fn(async ({ runId, sessionId }) => ({
        answer: JSON.stringify({ candidates: [candidate(`candidate-${runId}`, "fact:standby-share")] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });
      const first = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evaluation-run-1",
        sessionId: "evaluation-session-1",
      });
      const second = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evaluation-run-2",
        sessionId: "evaluation-session-2",
      });
      expect(runDiscovery).toHaveBeenCalledTimes(2);
      expect([first.runId, second.runId]).toEqual(["evaluation-run-1", "evaluation-run-2"]);
      expect(harness.metadata.energyIq.overviewAiArtifacts.find(harness.additionalIdentity)).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("carries the prompt origin declaration through strict schema parsing and server acceptance", async () => {
    const harness = createHarness();
    try {
      const proposed = {
        candidates: [candidate("candidate-origin-contract", "fact:standby-share", {
          origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
        })],
      };
      const strictSchema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        expect(prompt).toContain("origin:{kind:'ai-discovery|expert-sop|hybrid'");
        const validation = await strictSchema["~standard"].validate(proposed);
        expect(validation).not.toEqual(expect.objectContaining({ issues: expect.anything() }));
        return { answer: JSON.stringify(proposed), runId, sessionId };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const artifact = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "origin-contract-run",
        sessionId: "origin-contract-session",
      });

      expect(artifact).toMatchObject({
        status: "available",
        publication: { discoveredCount: 1, acceptedCount: 1, rejectedCount: 0 },
        findings: [{
          id: "additional:candidate-origin-contract",
          origin: { kind: "ai-discovery", directionMethods: [] },
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("accepts the gross candidate envelope while rejecting malformed siblings locally", async () => {
    const harness = createHarness();
    try {
      const valid = candidate("candidate-valid", "fact:standby-share");
      const proposed = {
        candidates: [
          valid,
          { ...valid, id: "candidate-long-title", title: "x".repeat(140) },
          {
            ...valid,
            id: "candidate-misplaced-deep-dive",
            incrementalContext: {
              ...valid.incrementalContext,
              deepDiveQuestion: "Which interval should be inspected next?",
            },
          },
        ],
      };
      const transport = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => {
          await expect(Promise.resolve(transport["~standard"].validate(proposed)))
            .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
          return { answer: JSON.stringify(proposed), runId, sessionId };
        },
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "mixed-candidate-run",
        sessionId: "mixed-candidate-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 3,
          acceptedCount: 1,
          rejectedCount: 2,
          publishedCount: 1,
          acceptedCandidateIds: ["candidate-valid"],
          rejectedCandidateIds: ["candidate-long-title", "candidate-misplaced-deep-dive"],
        },
        findings: [{ id: "additional:candidate-valid" }],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a discovery preamble instead of extracting a trailing JSON object", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: `Here is my analysis before the final object.\n${JSON.stringify({ candidates: [] })}`,
          runId,
          sessionId,
        }),
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "preamble-run",
        sessionId: "preamble-session",
      })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
    } finally {
      harness.close();
    }
  });

  it("accepts only the known DeepSeek schema marker on the Ngee Ann discovery envelope", async () => {
    const harness = createHarness();
    try {
      const prompts: string[] = [];
      const ngeeAnnBaseIdentity = {
        ...harness.baseIdentity,
        rendererKey: "ngee-ann-overview",
      } as const;
      const ngeeAnnIdentity = createNgeeAnnAdditionalAiInsightArtifactIdentity({
        baseIdentity: ngeeAnnBaseIdentity,
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        createArtifactIdentity: createNgeeAnnAdditionalAiInsightArtifactIdentity,
        discoveryContext: {
          productLabel: "EnergyIQ Ngee Ann campus energy Overview",
          entityGuidance: "the cited campus Levels, Circuits, loads, and operating-time patterns",
          runPrefix: "ngee-ann-additional-ai-insights",
        },
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ prompt, runId, sessionId }) => {
          prompts.push(prompt);
          return {
            answer: JSON.stringify({ candidates: [], type: "object" }),
            runId,
            sessionId,
          };
        },
      });

      await expect(workflow.evaluateAttempt({
        identity: ngeeAnnIdentity,
        user: harness.user,
        runId: "ngee-ann-schema-marker-run",
        sessionId: "ngee-ann-schema-marker-session",
      })).resolves.toMatchObject({
        status: "empty",
        publication: { discoveredCount: 0, acceptedCount: 0, rejectedCount: 0 },
      });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("EnergyIQ Ngee Ann campus energy Overview");
      expect(prompts[0]).toContain("campus Levels, Circuits, loads, and operating-time patterns");
      expect(prompts[0]).not.toContain("EnergyX Preschool");
      expect(prompts[0]).not.toContain("named Centres");
    } finally {
      harness.close();
    }
  });

  it("uses a concise accepted AI angle instead of an observation fragment when repairing a Ngee Ann title", async () => {
    const harness = createHarness();
    try {
      const ngeeAnnBaseIdentity = {
        ...harness.baseIdentity,
        rendererKey: "ngee-ann-overview",
      } as const;
      const ngeeAnnIdentity = createNgeeAnnAdditionalAiInsightArtifactIdentity({
        baseIdentity: ngeeAnnBaseIdentity,
      });
      const angle = "The front-row office lighting circuit is roughly double any other light circuit and sits among the top circuits overall. This longer explanation remains in the AI angle instead of becoming the card title.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        createArtifactIdentity: createNgeeAnnAdditionalAiInsightArtifactIdentity,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-ngee-title-repair", "fact:standby-share", {
            title: "Standby is the unsupported 88% and therefore must be fixed",
            observation: "the supported standby signal is materially smaller.",
            angle,
            epistemicStatus: "inferred",
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: ngeeAnnIdentity,
        user: harness.user,
        runId: "ngee-title-repair-run",
        sessionId: "ngee-title-repair-session",
      });

      expect(result).toMatchObject({
        status: "available",
        findings: [{
          id: "additional:candidate-ngee-title-repair",
          title: "The front-row office lighting circuit is roughly double any other light circuit",
          text: `**Evidence signal:** the supported standby signal is materially smaller.\n\n**AI angle:** ${angle}`,
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("keeps the Preschool discovery root exact when the schema marker is present", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [], type: "object" }),
          runId,
          sessionId,
        }),
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "preschool-schema-marker-run",
        sessionId: "preschool-schema-marker-session",
      })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
    } finally {
      harness.close();
    }
  });

  it.each([
    {
      name: "one surplus root closer",
      corrupt: (answer: string) => `${answer}}`,
    },
    {
      name: "one missing candidate-key quote and one missing root closer",
      corrupt: (answer: string) => answer.replace('"angle":', 'angle":').slice(0, -1),
    },
  ])("repairs $name without bypassing candidate-local acceptance", async ({ corrupt }) => {
    const harness = createHarness();
    try {
      const ngeeAnnBaseIdentity = {
        ...harness.baseIdentity,
        rendererKey: "ngee-ann-overview",
      } as const;
      const ngeeAnnIdentity = createNgeeAnnAdditionalAiInsightArtifactIdentity({
        baseIdentity: ngeeAnnBaseIdentity,
      });
      const valid = candidate("candidate-repaired-envelope", "fact:standby-share");
      const malformedSibling = {
        ...valid,
        id: "candidate-still-invalid",
        title: "x".repeat(140),
      };
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        createArtifactIdentity: createNgeeAnnAdditionalAiInsightArtifactIdentity,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: corrupt(JSON.stringify({ candidates: [valid, malformedSibling] })),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: ngeeAnnIdentity,
        user: harness.user,
        runId: "bounded-envelope-repair-run",
        sessionId: "bounded-envelope-repair-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 2,
          acceptedCount: 1,
          rejectedCount: 1,
          publishedCount: 1,
          acceptedCandidateIds: ["candidate-repaired-envelope"],
          rejectedCandidateIds: ["candidate-still-invalid"],
        },
        findings: [{
          id: "additional:candidate-repaired-envelope",
          title: "Title for candidate-repaired-envelope",
          text: "**Evidence signal:** The cited current Evidence establishes the selected baseline.\n\n**AI angle:** Incremental angle for candidate-repaired-envelope.",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("keeps the Preschool discovery transport strict when punctuation is malformed", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: `${JSON.stringify({ candidates: [candidate("preschool-no-repair", "fact:standby-share")] })}}`,
          runId,
          sessionId,
        }),
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "preschool-no-envelope-repair-run",
        sessionId: "preschool-no-envelope-repair-session",
      })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
    } finally {
      harness.close();
    }
  });

  it.each([
    ["a Markdown fence", (answer: string) => `\`\`\`json\n${answer}\n\`\`\``],
    ["two adjacent root objects", (answer: string) => `${answer}${answer}`],
    ["more punctuation defects than the repair budget", (answer: string) => (
      ["id", "title", "observation", "angle", "epistemicStatus"]
        .reduce((value, key) => value.replace(`"${key}":`, `${key}":`), answer)
    )],
    ["the wrong root key", () => JSON.stringify({ findings: [] })],
  ])("rejects %s instead of widening the bounded discovery envelope", async (_name, corrupt) => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: corrupt(JSON.stringify({
            candidates: [candidate("candidate-outside-repair-boundary", "fact:standby-share")],
          })),
          runId,
          sessionId,
        }),
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "outside-repair-boundary-run",
        sessionId: "outside-repair-boundary-session",
      })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
    } finally {
      harness.close();
    }
  });

  it("maps each candidate's stable Method refs to truthful Finding provenance and rejects bad refs locally", async () => {
    const harness = createHarness();
    try {
      const prompts: string[] = [];
      let discoveryCall = 0;
      let publishedMethodResourceId = "";
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        prompts.push(prompt);
        discoveryCall += 1;
        return {
          answer: JSON.stringify({ candidates: discoveryCall === 1
            ? [candidate("candidate-source", "fact:standby-share", {
                origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
              })]
            : [
                candidate("candidate-core", "fact:standby-share", {
                  origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
                }),
                candidate("candidate-sop", "fact:operating-share", {
                  origin: { kind: "expert-sop", directionMethodResourceIds: [publishedMethodResourceId] },
                }),
                candidate("candidate-unknown", "fact:standby-share", {
                  origin: { kind: "expert-sop", directionMethodResourceIds: ["insight-method:unloaded"] },
                }),
                candidate("candidate-duplicate", "fact:standby-share", {
                  origin: {
                    kind: "expert-sop",
                    directionMethodResourceIds: [publishedMethodResourceId, publishedMethodResourceId],
                  },
                }),
                candidate("candidate-hybrid-too-long", "fact:operating-share", {
                  origin: {
                    kind: "hybrid",
                    directionMethodResourceIds: [publishedMethodResourceId],
                    novelContribution: "x".repeat(801),
                  },
                }),
                candidate("candidate-hybrid", "fact:operating-share", {
                  origin: {
                    kind: "hybrid",
                    directionMethodResourceIds: [publishedMethodResourceId],
                    novelContribution: "Connect the repeated event shape to a separately evidenced operating pattern.",
                  },
                }),
              ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });
      const first = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const guidance = "Compare repeated event shape and timing before treating an isolated spike as a reusable pattern.";
      const provisional = harness.metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: PRESCHOOL_WORKSPACE_ID,
        expectedProjectId: "preschool-demo",
        artifactId: first.id,
        findingId: "additional:candidate-source",
        actorId: harness.user.id,
        idempotencyKey: "proposal:workflow-method",
        title: "Repeated event shape",
        guidance,
      });
      const inReview = harness.metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: provisional.revision,
      });
      const approved = harness.metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: inReview.revision,
      });
      const published = harness.metadata.energyIq.insightMethodGovernance.publishProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: approved.revision,
      });
      publishedMethodResourceId = published.publication!.method.resourceId;

      const second = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const result = JSON.parse(second.result_json!) as AdditionalAiInsightsArtifact;

      expect(runDiscovery).toHaveBeenCalledTimes(2);
      expect(second.id).not.toBe(first.id);
      expect(prompts[1]).toContain(guidance);
      expect(prompts[1]).toContain("directionMethodResourceIds");
      expect(result.methodExecution.loadedMethods).toHaveLength(2);
      expect(result.findings.map(({ id }) => id)).toEqual([
        "additional:candidate-core",
        "additional:candidate-sop",
        "additional:candidate-hybrid",
      ]);
      expect(result.findings[0]?.origin).toEqual({
        kind: "ai-discovery",
        coreMethod: result.methodExecution.loadedMethods[0],
        directionMethods: [],
      });
      expect(result.findings[1]?.origin).toMatchObject({
        kind: "expert-sop",
        directionMethods: [expect.objectContaining({
          resourceId: publishedMethodResourceId,
          scope: "workspace",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          role: "expert-direction",
        })],
      });
      expect(result.findings[2]?.origin).toMatchObject({
        kind: "hybrid",
        directionMethods: [expect.objectContaining({ resourceId: publishedMethodResourceId })],
        novelContribution: "Connect the repeated event shape to a separately evidenced operating pattern.",
      });
      expect(result.publication.rejectedCandidateIds).toEqual([
        "candidate-unknown",
        "candidate-duplicate",
        "candidate-hybrid-too-long",
      ]);
      expect(composePreschoolOverviewAiReadModel({
        metadataStore: harness.metadata,
        baseIdentity: harness.baseIdentity,
      })?.additional).toMatchObject({
        status: "available",
        artifactId: second.id,
      });
    } finally {
      harness.close();
    }
  });

  it("discovers openly, rejects bad candidates locally and publishes at most three in model source order", async () => {
    const harness = createHarness();
    try {
      let receivedPrompt = "";
      const runDiscovery = vi.fn(async ({ prompt, invokeTool, runId, sessionId }) => {
        receivedPrompt = prompt;
        const tool = await invokeTool({
          toolName: "energy.evidence.read",
          toolCallId: "tool-call:discovery:1",
          input: { factIds: ["fact:standby-share"] },
        });
        return {
          answer: JSON.stringify({ candidates: [
            candidate("candidate-pattern", "fact:standby-share", { toolAuditIds: [tool.auditId] }),
            candidate("candidate-forged", "fact:forged"),
            candidate("candidate-compare", "fact:operating-share", { epistemicStatus: "observed" }),
            candidate("candidate-overstated-alert", "fact:partial", {
              epistemicStatus: "speculative",
              alert: { severity: "urgent", certainty: "confirmed", evidenceRefs: ["fact:partial"] },
            }),
            candidate("candidate-counterexample", "fact:standby-share"),
            candidate("candidate-low-risk-test", "fact:operating-share", { epistemicStatus: "speculative" }),
          ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      expect(artifact).toMatchObject({ status: "available" });
      expect(receivedPrompt).toContain(ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1);
      expect(receivedPrompt).toContain("Zero candidates is valid");
      expect(receivedPrompt).toContain("Call energyiq_additional_insights_submit once");
      expect(receivedPrompt).toContain("After a successful submission, stop immediately");
      expect(receivedPrompt).toContain("title must be 100 characters or fewer");
      expect(receivedPrompt).toContain("toolAuditIds is required; use [] when no tool was called");
      expect(receivedPrompt).toContain("ai-discovery must contain exactly kind and directionMethodResourceIds");
      expect(receivedPrompt).toContain("If alert cannot match the exact object shape");
      expect(receivedPrompt).toContain("A relationship across multiple Evidence facts cannot be observed");
      expect(receivedPrompt).toContain("Do not calculate or state new numeric values");
      expect(receivedPrompt).toContain("observation should be one short Evidence-backed sentence");
      expect(receivedPrompt).toContain("angle states the genuinely useful relationship, counterexample, hypothesis, or low-risk experiment");
      expect(receivedPrompt).toContain("may go beyond what the Evidence proves");
      expect(receivedPrompt).toContain("may freely interpret cited facts and named Centres");
      expect(receivedPrompt).toContain("deepDiveQuestion should be one short question and no more than 200 characters");
      expect(receivedPrompt).not.toContain("fill every lens");
      expect(receivedPrompt).not.toContain("snapshot-evidence:");
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;

      expect(artifact).toMatchObject({
        status: "available",
        attempt_count: 1,
        run_id: expect.stringMatching(/^preschool-additional-ai-insights-/u),
      });
      expect(result.status).toBe("available");
      expect(result.findings.map(({ id }) => id)).toEqual([
        "additional:candidate-pattern",
        "additional:candidate-compare",
        "additional:candidate-counterexample",
      ]);
      expect(result.publication).toMatchObject({
        discoveredCount: 6,
        acceptedCount: 4,
        rejectedCount: 2,
        publishedCount: 3,
        sourceOrderCandidateIds: [
          "candidate-pattern", "candidate-forged", "candidate-compare",
          "candidate-overstated-alert", "candidate-counterexample", "candidate-low-risk-test",
        ],
        acceptedCandidateIds: [
          "candidate-pattern", "candidate-compare", "candidate-counterexample", "candidate-low-risk-test",
        ],
        rejectedCandidateIds: ["candidate-forged", "candidate-overstated-alert"],
        publishedCandidateIds: ["candidate-pattern", "candidate-compare", "candidate-counterexample"],
        suppressedCandidateIds: ["candidate-low-risk-test"],
      });
      expect(result.evidenceLineage.facts.map(({ id }) => id).sort()).toEqual([
        "fact:operating-share", "fact:standby-share",
      ]);
      expect(result.methodExecution.loadedMethods).toHaveLength(1);
      expect(result.toolAudits).toEqual([
        expect.objectContaining({
          auditId: "additional-tool-audit:tool-call:discovery:1",
          status: "succeeded",
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("persists a truthful empty result when discovery yields no accepted candidate", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result).toMatchObject({
        status: "empty",
        findings: [],
        publication: {
          discoveredCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          publishedCount: 0,
        },
      });
    } finally {
      harness.close();
    }
  });

  it("persists server-accepted Canvas blocks while rejecting a bad sibling block locally", async () => {
    const harness = createHarness();
    try {
      const canvasCandidate = candidate("candidate-canvas", "fact:standby-share", {
        canvas: canvasPlan({
          candidateId: "candidate-canvas",
          title: "Title for candidate-canvas",
          text: "**Evidence signal:** The cited current Evidence establishes the selected baseline.\n\n**AI angle:** Incremental angle for candidate-canvas.",
        }),
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [canvasCandidate] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      expect(artifact).toMatchObject({ status: "available" });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result.status).toBe("available");
      if (result.status !== "available") throw new Error("available Additional fixture required");
      expect(result.findings[0]?.canvas).toMatchObject({
        contractRevision: "energyiq-insight-canvas-v2",
        planId: "canvas-plan:additional:candidate-canvas",
        acceptedBlockIds: ["canvas-block:standby-share"],
        acceptedBlocks: [{
          id: "canvas-block:standby-share",
          visualization: "comparison",
          bindings: [{ evidenceRef: "fact:standby-share", value: 31, unit: "%" }],
        }],
        rejections: [{
          code: "EVIDENCE_BINDING_MISMATCH",
          subjectId: "canvas-block:forged",
        }],
      });
      expect(result.evidenceLineage.facts).toContainEqual(expect.objectContaining({
        id: "fact:standby-share",
        metricId: "energy.standby-share",
        value: 31,
        unit: "%",
      }));
    } finally {
      harness.close();
    }
  });

  it("keeps the first three accepted Canvas blocks and records a local rejection for the presentation budget", async () => {
    const harness = createHarness();
    try {
      const plan = canvasPlan({
        candidateId: "candidate-budget",
        title: "Title for candidate-budget",
        text: "**Evidence signal:** The cited current Evidence establishes the selected baseline.\n\n**AI angle:** Incremental angle for candidate-budget.",
      });
      const acceptedTemplate = plan.investigatorBlocks[0]!;
      plan.investigatorBlocks = Array.from({ length: 4 }, (_, index) => ({
        ...structuredClone(acceptedTemplate),
        id: `canvas-block:accepted-${index + 1}`,
        title: `Accepted block ${index + 1}`,
      }));
      plan.editorPlan.orderedBlockIds = plan.investigatorBlocks.map(({ id }) => id);
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({
            candidates: [candidate("candidate-budget", "fact:standby-share", { canvas: plan })],
          }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact).toMatchObject({ status: "available" });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      if (result.status !== "available") throw new Error("available Additional fixture required");
      expect(result.findings[0]?.canvas).toMatchObject({
        acceptedBlockIds: [
          "canvas-block:accepted-1",
          "canvas-block:accepted-2",
          "canvas-block:accepted-3",
        ],
        rejections: [{
          code: "PRESENTATION_BUDGET_EXCEEDED",
          subjectId: "canvas-block:accepted-4",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a forged tool audit locally without losing its valid sibling", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-audit-forged", "fact:standby-share", { toolAuditIds: ["audit:forged"] }),
            candidate("candidate-valid", "fact:operating-share"),
          ] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result.findings.map(({ id }) => id)).toEqual(["additional:candidate-valid"]);
      expect(result.publication.rejectedCandidateIds).toEqual(["candidate-audit-forged"]);
    } finally {
      harness.close();
    }
  });

  it("single-flights exact concurrent and repeated generation without adding Provider runs", async () => {
    const harness = createHarness();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void;
      const hasStarted = new Promise<void>((resolve) => { started = resolve; });
      const runDiscovery = vi.fn(async ({ runId, sessionId }) => {
        started();
        await gate;
        return {
          answer: JSON.stringify({ candidates: [candidate("candidate-once", "fact:standby-share")] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const first = workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      await hasStarted;
      const concurrent = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(concurrent.status).toBe("running");
      expect(runDiscovery).toHaveBeenCalledTimes(1);
      release();
      const completed = await first;
      const repeated = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });

      expect(completed.status).toBe("available");
      expect(repeated).toEqual(completed);
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("pins one trusted Model Profile snapshot through queued generation", async () => {
    const harness = createHarness();
    try {
      const trustedSnapshot = resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata);
      const runDiscovery = vi.fn(async ({ runId, sessionId, modelProfileSnapshot }) => {
        expect(modelProfileSnapshot).toBe(trustedSnapshot);
        return {
          answer: JSON.stringify({ candidates: [] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      await expect(workflow.execute({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        modelProfileSnapshot: trustedSnapshot,
      })).resolves.toMatchObject({ status: "available" });
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("recovers a failed exact Artifact on the next authorized generation attempt", async () => {
    const harness = createHarness();
    try {
      const runDiscovery = vi.fn()
        .mockRejectedValueOnce(new Error("PRESCHOOL_ADDITIONAL_AI_PROVIDER_FAILED"))
        .mockImplementationOnce(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-recovered", "fact:standby-share")] }),
          runId,
          sessionId,
        }));
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const failed = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const recovered = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });

      expect(failed).toMatchObject({
        status: "failed",
        attempt_count: 1,
        error_code: "PRESCHOOL_ADDITIONAL_AI_PROVIDER_FAILED",
      });
      expect(recovered).toMatchObject({ status: "available", attempt_count: 2 });
      expect(runDiscovery).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-additional-workflow-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({
    id: "dev-user",
    email: "admin@example.test",
    display_name: "Admin",
    dev_token: "dev-token",
  });
  ensureEnergyIqBootstrap(metadata);
  metadata.configResources.upsert({
    id: "profile-test",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Test profile",
    payload: { provider: "openai-compatible", modelName: "model-test" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-test",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  const user = metadata.users.getById({ user_id: "dev-user" }) as UserRecord;
  const project = metadata.energyIq.getProject("preschool-demo");
  const baseIdentity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: project.root_scope_id,
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
  });
  return {
    metadata,
    user,
    baseIdentity,
    additionalIdentity: createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity }),
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};

const candidate = (
  id: string,
  evidenceRef: string,
  overrides: Record<string, unknown> = {},
) => {
  const {
    text: legacyText,
    observation: proposedObservation,
    angle: proposedAngle,
    ...remainingOverrides
  } = overrides;
  const value = {
    id,
    title: `Title for ${id}`,
    observation: typeof proposedObservation === "string"
      ? proposedObservation
      : "The cited current Evidence establishes the selected baseline.",
    angle: typeof proposedAngle === "string"
      ? proposedAngle
      : typeof legacyText === "string"
        ? legacyText
        : `Incremental angle for ${id}.`,
    epistemicStatus: "inferred",
    origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
    incrementalContext: incrementalContext(`deterministic-overview:${evidenceRef}`),
    evidenceRefs: [evidenceRef],
    toolAuditIds: [],
    ...remainingOverrides,
  };
  if (value.incrementalContext.novelConclusion === TEST_NOVEL_CONCLUSION_FROM_NARRATIVE) {
    value.incrementalContext = {
      ...value.incrementalContext,
      novelConclusion: String(value.angle),
    };
  }
  return value;
};

const TEST_NOVEL_CONCLUSION_FROM_NARRATIVE = "__use-candidate-narrative__";

const incrementalContext = (relatedPresentedClaimId: string) => ({
  relatedPresentedClaimIds: [relatedPresentedClaimId],
  novelConclusion: TEST_NOVEL_CONCLUSION_FROM_NARRATIVE,
});

const resolvePresentedClaimsFixture: Parameters<typeof createPreschoolAdditionalAiInsightsWorkflow>[0]["resolvePresentedClaims"] =
  async ({ identity, catalog: currentCatalog }) => createPreschoolAdditionalAiPresentedClaims({
    identity,
    catalog: currentCatalog,
    readModel: null,
  });

  it("accepts the relevant subset of a succeeded tool audit and rejects disjoint or failed audit claims", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ invokeTool, runId, sessionId }) => {
          const succeeded = await invokeTool({
            toolName: "energy.evidence.read",
            toolCallId: "tool-call:production-shaped-subset",
            input: { factIds: ["fact:standby-share", "fact:operating-share"] },
          });
          const catalogSubset = await invokeTool({
            toolName: "energy.evidence.read",
            toolCallId: "tool-call:production-shaped-catalog-subset",
            input: { factIds: ["fact:standby-share"] },
          });
          const unrelated = await invokeTool({
            toolName: "energy.evidence.read",
            toolCallId: "tool-call:production-shaped-unrelated",
            input: { factIds: ["fact:partial"] },
          });
          await expect(invokeTool({
            toolName: "energy.evidence.read",
            toolCallId: "tool-call:production-shaped-failed",
            input: { factIds: ["fact:missing"] },
          })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_EVIDENCE_NOT_FOUND");
          return {
            answer: JSON.stringify({ candidates: [
              candidate("candidate-audit-subset", "fact:standby-share", {
                title: "Two confirmed shares warrant a joint scheduling check",
                text: "The two confirmed shares form a qualitative relationship worth testing against operating schedules.",
                epistemicStatus: "inferred",
                evidenceRefs: ["fact:standby-share", "fact:operating-share"],
                toolAuditIds: [succeeded.auditId],
              }),
              candidate("candidate-audit-plus-catalog", "fact:standby-share", {
                title: "A read fact can be compared with another current catalog fact",
                text: "The confirmed standby and operating shares form a qualitative relationship worth testing against schedules.",
                epistemicStatus: "inferred",
                evidenceRefs: ["fact:standby-share", "fact:operating-share"],
                toolAuditIds: [catalogSubset.auditId],
              }),
              candidate("candidate-audit-disjoint", "fact:partial", {
                toolAuditIds: [succeeded.auditId],
              }),
              candidate("candidate-audit-extra-unrelated", "fact:standby-share", {
                toolAuditIds: [succeeded.auditId, unrelated.auditId],
              }),
              candidate("candidate-audit-failed", "fact:standby-share", {
                toolAuditIds: ["additional-tool-audit:tool-call:production-shaped-failed"],
              }),
            ] }),
            runId,
            sessionId,
          };
        },
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "production-shaped-audit-run",
        sessionId: "production-shaped-audit-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 5,
          acceptedCount: 2,
          rejectedCount: 3,
          acceptedCandidateIds: ["candidate-audit-subset", "candidate-audit-plus-catalog"],
          rejectedCandidateIds: [
            "candidate-audit-disjoint",
            "candidate-audit-extra-unrelated",
            "candidate-audit-failed",
          ],
        },
        findings: [{
          id: "additional:candidate-audit-subset",
          toolAuditIds: ["additional-tool-audit:tool-call:production-shaped-subset"],
        }, {
          id: "additional:candidate-audit-plus-catalog",
          toolAuditIds: ["additional-tool-audit:tool-call:production-shaped-catalog-subset"],
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("normalizes omitted toolAuditIds only when the attempt made no tool calls", async () => {
    const harness = createHarness();
    try {
      let call = 0;
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async ({ identity }) => {
          const current = catalog();
          return {
            ...current,
            sourceId: `project-analysis-snapshot:preschool-demo:${identity.dataSnapshotId}`,
            pins: { ...current.pins, dataSnapshotId: identity.dataSnapshotId },
          };
        },
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ invokeTool, runId, sessionId }) => {
          call += 1;
          if (call === 2) {
            await invokeTool({
              toolName: "energy.evidence.read",
              toolCallId: "tool-call:omitted-audit",
              input: { factIds: ["fact:standby-share"] },
            });
          }
          const { toolAuditIds: _omittedToolAuditIds, ...proposed } = candidate(
            call === 1 ? "candidate-omitted-audit-none" : "candidate-omitted-audit-present",
            "fact:standby-share",
          );
          return { answer: JSON.stringify({ candidates: [proposed] }), runId, sessionId };
        },
      });

      const withoutTools = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "omitted-audit-no-tools-run",
        sessionId: "omitted-audit-no-tools-session",
      });
      const withTools = await workflow.evaluateAttempt({
        identity: { ...harness.additionalIdentity, dataSnapshotId: "snapshot-with-tool" },
        user: harness.user,
        runId: "omitted-audit-with-tools-run",
        sessionId: "omitted-audit-with-tools-session",
      });

      expect(withoutTools).toMatchObject({
        status: "available",
        findings: [{ id: "additional:candidate-omitted-audit-none", toolAuditIds: [] }],
      });
      expect(withTools).toMatchObject({
        status: "empty",
        publication: {
          discoveredCount: 1,
          acceptedCount: 0,
          rejectedCount: 1,
          rejectedCandidateIds: ["candidate-omitted-audit-present"],
        },
      });
    } finally {
      harness.close();
    }
  });

  it("drops a malformed optional alert without losing a supported sibling finding", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-string-alert", "fact:standby-share", {
            alert: "urgent",
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "malformed-alert-run",
        sessionId: "malformed-alert-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { discoveredCount: 1, acceptedCount: 1, rejectedCount: 0 },
        findings: [{ id: "additional:candidate-string-alert" }],
      });
      if (result.status !== "available") throw new Error("available fixture required");
      expect(result.findings[0]).not.toHaveProperty("alert");
    } finally {
      harness.close();
    }
  });

  it("keeps unsupported derived numbers and long titles as candidate-local rejections", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-derived-ratio", "fact:standby-share", {
              title: "A derived spread requires direct support",
              text: "The two shares show a 3.9x spread.",
              evidenceRefs: ["fact:standby-share", "fact:operating-share"],
            }),
            candidate("candidate-title-too-long", "fact:standby-share", {
              title: "x".repeat(101),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "candidate-local-boundaries-run",
        sessionId: "candidate-local-boundaries-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 0,
        rejectedCount: 2,
        rejectedCandidateIds: ["candidate-derived-ratio", "candidate-title-too-long"],
      });
    } finally {
      harness.close();
    }
  });

  it("salvages a useful speculative angle when only one precise sentence is unsupported", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-sentence-salvage", "fact:standby-share", {
            title: "Test whether standby share varies with weekday schedules",
            observation: "Standby is 31%.",
            angle: "Standby may vary with weekday schedules, but an unsupported hard claim says it reached 999 kWh.",
            epistemicStatus: "speculative",
            deepDiveQuestion: "Did the unsupported peak reach 777 kWh?",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
              novelConclusion: "Standby may vary with weekday schedules",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "sentence-salvage-run",
        sessionId: "sentence-salvage-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          acceptedCandidateIds: ["candidate-sentence-salvage"],
          rejectedCandidateIds: [],
        },
        findings: [{
          id: "additional:candidate-sentence-salvage",
          text: "**Evidence signal:** Standby is 31%.\n\n**AI angle:** Standby may vary with weekday schedules.",
        }],
      });
      expect(result.status === "available" && result.findings[0]).not.toHaveProperty("deepDiveQuestion");
    } finally {
      harness.close();
    }
  });

  it("repairs an unsupported lexical ratio title without dropping the useful speculative angle", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push(
        {
          ...fact("analysis.categories.load.share_pct", "confirmed", 60.81),
          metricId: "energy.category_share_pct",
        },
        {
          ...fact("analysis.off_hours.share_pct", "confirmed", 11.25),
          metricId: "energy.off_hours_share_pct",
        },
      );
      const novelConclusion = "Test whether off-hours Load departs from the portfolio baseline";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate(
            "candidate-lexical-ratio-title",
            "analysis.categories.load.share_pct",
            {
              title: "Load dominates the portfolio, and closed hours add about a quarter of it",
              observation: "Load represents 60.81% of portfolio energy, while off-hours use is 11.25%.",
              angle: `${novelConclusion}; compare the two shares by Centre before treating lunchtime spikes as a portfolio-wide load pattern.`,
              epistemicStatus: "speculative",
              evidenceRefs: ["analysis.categories.load.share_pct", "analysis.off_hours.share_pct"],
              incrementalContext: {
                relatedPresentedClaimIds: [
                  "deterministic-overview:analysis.categories.load.share_pct",
                  "deterministic-overview:analysis.off_hours.share_pct",
                ],
                novelConclusion,
              },
            },
          )] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "lexical-ratio-title-run",
        sessionId: "lexical-ratio-title-session",
      });

      expect(result).toMatchObject({
        status: "available",
        findings: [{
          id: "additional:candidate-lexical-ratio-title",
          title: novelConclusion,
          epistemicStatus: "speculative",
          text: `**Evidence signal:** Load represents 60.81% of portfolio energy, while off-hours use is 11.25%.\n\n**AI angle:** ${novelConclusion}; compare the two shares by Centre before treating lunchtime spikes as a portfolio-wide load pattern.`,
        }],
        publication: {
          acceptedCandidateIds: ["candidate-lexical-ratio-title"],
          rejectedCandidateIds: [],
        },
      });
    } finally {
      harness.close();
    }
  });

  it("removes an unsupported cross-period fact while preserving the evidence-bound exploratory angle", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push(
        {
          ...fact("analysis.summary.peak_kw", "confirmed", 138.8),
          metricId: "energy.peak_interval_average_power_kw",
          unit: "kW",
        },
        {
          ...fact("analysis.summary.usage_kwh", "confirmed", 24_483.57),
          metricId: "energy.total_usage_kwh",
          unit: "kWh",
        },
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-cross-period-salvage", "analysis.summary.peak_kw", {
            title: "Peak demand may be concentrated in a narrow operating window",
            observation: "Peak interval-average power is 138.8 kW.",
            angle: "Total usage is essentially unchanged from the prior period. Total energy use declined from last month. Total energy use reduced from last month. Total energy use surged from last month. Total energy use jumped from last month. Total energy use doubled from last month. Total energy use halved from last month. The peak may indicate a concentrated demand window worth testing.",
            epistemicStatus: "speculative",
            evidenceRefs: ["analysis.summary.peak_kw", "analysis.summary.usage_kwh"],
            incrementalContext: {
              relatedPresentedClaimIds: [
                "deterministic-overview:analysis.summary.peak_kw",
                "deterministic-overview:analysis.summary.usage_kwh",
              ],
              novelConclusion: "The peak may indicate a concentrated demand window worth testing",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "cross-period-salvage-run",
        sessionId: "cross-period-salvage-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          acceptedCandidateIds: ["candidate-cross-period-salvage"],
          rejectedCandidateIds: [],
        },
        findings: [{
          id: "additional:candidate-cross-period-salvage",
          text: "**Evidence signal:** Peak interval-average power is 138.8 kW.\n\n**AI angle:** The peak may indicate a concentrated demand window worth testing.",
          epistemicStatus: "speculative",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("keeps a measured cross-period fact when the candidate cites the authoritative comparison Evidence", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push({
        ...fact("analysis.comparison.change_pct", "confirmed", 4.63),
        metricId: "energy.period_change_pct",
        dimensions: {
          comparison: "previous-period",
          comparedMetricId: "energy.total_usage_kwh",
        },
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-supported-cross-period", "analysis.comparison.change_pct", {
            title: "Energy use increased by 4.63% from the previous period",
            observation: "Energy use rose 4.63 percent from the previous period.",
            angle: "Energy use recorded an increase of 4.63 percent from the previous period. If schedules change, energy use may be 10% lower than last month.",
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:analysis.comparison.change_pct"],
              novelConclusion: "If schedules change, energy use may be 10% lower than last month",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "supported-cross-period-run",
        sessionId: "supported-cross-period-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-supported-cross-period"] },
        findings: [{
          text: "**Evidence signal:** Energy use rose 4.63 percent from the previous period.\n\n**AI angle:** Energy use recorded an increase of 4.63 percent from the previous period. If schedules change, energy use may be 10% lower than last month.",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("does not lend peak comparison Evidence to a same-magnitude total-energy claim", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push(
        {
          ...fact("analysis.summary.peak_kw", "confirmed", 138.8),
          metricId: "energy.peak_interval_average_kw",
          unit: "kW",
        },
        {
          ...fact("analysis.summary.usage_kwh", "confirmed", 24_483.57),
          metricId: "energy.total_usage_kwh",
          unit: "kWh",
        },
        {
          ...fact("analysis.comparison.peak_change_pct", "confirmed", 4.63),
          metricId: "energy.period_change_pct",
          dimensions: {
            comparison: "previous-period",
            comparedMetricId: "energy.peak_interval_average_kw",
          },
        },
      );
      const evidenceRefs = [
        "analysis.summary.peak_kw",
        "analysis.summary.usage_kwh",
        "analysis.comparison.peak_change_pct",
      ];
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-cross-metric-comparison", evidenceRefs[0]!, {
            title: "Peak comparison could frame a targeted follow-up",
            observation: "Peak interval-average power is 138.8 kW.",
            angle: "Total energy use increased 4.63% from the previous period and peak demand rose 4.63% from the previous period. The peak comparison may be worth checking against operating schedules.",
            epistemicStatus: "speculative",
            evidenceRefs,
            incrementalContext: {
              relatedPresentedClaimIds: evidenceRefs.map((ref) => `deterministic-overview:${ref}`),
              novelConclusion: "Peak comparison could frame a targeted follow-up",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "cross-metric-comparison-run",
        sessionId: "cross-metric-comparison-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-cross-metric-comparison"] },
        findings: [{
          id: "additional:candidate-cross-metric-comparison",
          text: "**Evidence signal:** Peak interval-average power is 138.8 kW.\n\n**AI angle:** The peak comparison may be worth checking against operating schedules.",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("does not lend total-energy comparison Evidence to a measured peak claim but keeps a transparent hypothesis", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push(
        {
          ...fact("analysis.summary.peak_kw", "confirmed", 138.8),
          metricId: "energy.peak_interval_average_kw",
          unit: "kW",
        },
        {
          ...fact("analysis.comparison.change_pct", "confirmed", 4.63),
          metricId: "energy.period_change_pct",
          dimensions: {
            comparison: "previous-period",
            comparedMetricId: "energy.total_usage_kwh",
          },
        },
        entityFact("analysis.child_scopes.centre-g.usage_kwh", "Centre G", 880),
        {
          ...fact("analysis.categories.plug_load.share_pct", "confirmed", 99),
          metricId: "energy.category_share_pct",
        },
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-peak-comparison-boundary", "analysis.summary.peak_kw", {
            title: "Peak demand may be concentrated in a narrow operating window",
            observation: "Peak interval-average power is 138.8 kW.",
            angle: "Peak demand was higher than the previous 28-day window, but total energy use might be higher than last month. Centre G energy use was higher than last month. Total energy use increased by 99% from last month. Managers might investigate why total energy use increased 99% from last month. It is possible that managers should investigate why total energy use increased 99% from last month. If managers investigate why total energy use increased 99% from last month, they should check the comparison first. Total energy use surged by 99% from last month. Total energy use jumped by 99 percent from last month. Total energy use was 99 percent more than last month. Total energy use saw a 99% increase from last month. Total energy use recorded an increase of 99 percent from last month. Usage may have increased 999% in the previous period. Total energy use may be 999% higher than last month. Total energy use may be double last month. Total energy use may be halved versus the previous period. Total energy use may be 10% higher than last month due to plug loads accounting for 98% of use. Peak demand may be higher than last month, which would be worth testing against the next comparison window.",
            epistemicStatus: "speculative",
            evidenceRefs: ["analysis.summary.peak_kw", "analysis.comparison.change_pct", "analysis.child_scopes.centre-g.usage_kwh", "analysis.categories.plug_load.share_pct"],
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:analysis.summary.peak_kw"],
              novelConclusion: "Peak demand may be higher than last month, which would be worth testing against the next comparison window",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "peak-comparison-boundary-run",
        sessionId: "peak-comparison-boundary-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-peak-comparison-boundary"] },
        findings: [{
          text: "**Evidence signal:** Peak interval-average power is 138.8 kW.\n\n**AI angle:** total energy use might be higher than last month. Peak demand may be higher than last month, which would be worth testing against the next comparison window.",
          epistemicStatus: "speculative",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("does not let a scenario label turn an unsupported historical magnitude into a forward experiment", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push({
        ...fact("analysis.summary.usage_kwh", "confirmed", 24_483.57),
        metricId: "energy.total_usage_kwh",
        unit: "kWh",
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-retrospective-scenario-mask", "analysis.summary.usage_kwh", {
            title: "A schedule relationship may be worth testing",
            observation: "Total energy use is 24483.57 kWh.",
            angle: "Total energy may be 999% higher than last month, a scenario worth investigating. Total energy may be 999% higher than last month and a proposed schedule adjustment is worth testing. A schedule relationship may be worth testing in the next period.",
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:analysis.summary.usage_kwh"],
              novelConclusion: "A schedule relationship may be worth testing in the next period",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "retrospective-scenario-mask-run",
        sessionId: "retrospective-scenario-mask-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-retrospective-scenario-mask"] },
        findings: [{
          text: "**Evidence signal:** Total energy use is 24483.57 kWh.\n\n**AI angle:** A schedule relationship may be worth testing in the next period.",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("does not lend one comparison fact to another metric joined under a shared change verb", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push(
        {
          ...fact("analysis.summary.peak_kw", "confirmed", 138.8),
          metricId: "energy.peak_interval_average_kw",
          unit: "kW",
        },
        {
          ...fact("analysis.summary.usage_kwh", "confirmed", 24_483.57),
          metricId: "energy.total_usage_kwh",
          unit: "kWh",
        },
        {
          ...fact("analysis.comparison.change_pct", "confirmed", 4.63),
          metricId: "energy.period_change_pct",
          dimensions: {
            comparison: "previous-period",
            comparedMetricId: "energy.total_usage_kwh",
          },
        },
      );
      const evidenceRefs = [
        "analysis.summary.peak_kw",
        "analysis.summary.usage_kwh",
        "analysis.comparison.change_pct",
      ];
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-shared-change-verb", evidenceRefs[0]!, {
            title: "Peak timing may deserve a targeted review",
            observation: "Peak interval-average power is 138.8 kW.",
            angle: "Peak demand and total energy use rose 4.63% from the previous period. Peak timing may deserve a targeted review.",
            epistemicStatus: "speculative",
            evidenceRefs,
            incrementalContext: {
              relatedPresentedClaimIds: evidenceRefs.map((ref) => `deterministic-overview:${ref}`),
              novelConclusion: "Peak timing may deserve a targeted review",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "shared-change-verb-run",
        sessionId: "shared-change-verb-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-shared-change-verb"] },
        findings: [{
          text: "**Evidence signal:** Peak interval-average power is 138.8 kW.\n\n**AI angle:** Peak timing may deserve a targeted review.",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("does not lend one Centre comparison fact to another Centre joined under a shared change verb", async () => {
    const harness = createHarness();
    try {
      const currentCatalog = catalog();
      currentCatalog.facts.push(
        {
          ...fact("analysis.child_scopes.centre-g.usage_kwh", "confirmed", 880),
          label: "Centre G energy use",
          metricId: "energy.total_usage_kwh",
          unit: "kWh",
          dimensions: { centreCode: "G", scopeId: "centre-g" },
        },
        {
          ...fact("analysis.child_scopes.centre-h.usage_kwh", "confirmed", 760),
          label: "Centre H energy use",
          metricId: "energy.total_usage_kwh",
          unit: "kWh",
          dimensions: { centreCode: "H", scopeId: "centre-h" },
        },
        {
          ...fact("analysis.child_scopes.centre-h.change_pct", "confirmed", 4.63),
          metricId: "energy.period_change_pct",
          dimensions: {
            comparison: "previous-period",
            comparedMetricId: "energy.total_usage_kwh",
            centreCode: "H",
            scopeId: "centre-h",
          },
        },
      );
      const evidenceRefs = [
        "analysis.child_scopes.centre-g.usage_kwh",
        "analysis.child_scopes.centre-h.usage_kwh",
        "analysis.child_scopes.centre-h.change_pct",
      ];
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => currentCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-shared-centre-change-verb", evidenceRefs[0]!, {
            title: "The two Centres may deserve a timing comparison",
            observation: "Centre G uses 880 kWh while Centre H uses 760 kWh.",
            angle: "Centre G and Centre H energy use increased 4.63% from the previous period. The two Centres may deserve a timing comparison.",
            epistemicStatus: "speculative",
            evidenceRefs,
            incrementalContext: {
              relatedPresentedClaimIds: evidenceRefs.map((ref) => `deterministic-overview:${ref}`),
              novelConclusion: "The two Centres may deserve a timing comparison",
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "shared-centre-change-verb-run",
        sessionId: "shared-centre-change-verb-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-shared-centre-change-verb"] },
        findings: [{
          text: "**Evidence signal:** Centre G uses 880 kWh while Centre H uses 760 kWh.\n\n**AI angle:** The two Centres may deserve a timing comparison.",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("uses the supported AI conclusion when an otherwise useful card has one unsupported title or parenthetical claim", async () => {
    const harness = createHarness();
    try {
      const novelConclusion = "The standby share may hide a weekday timing pattern";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-title-salvage", "fact:standby-share", {
            title: "Standby is 31%, not the unsupported 88%, and may follow a weekday pattern",
            observation: "Standby is 31% (current Snapshot) (the unsupported holiday claim says 88%).",
            angle: "The standby share may hide a weekday timing pattern. An unsupported hard claim says it reached 999 kWh.",
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
              novelConclusion,
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "title-salvage-run",
        sessionId: "title-salvage-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          acceptedCandidateIds: ["candidate-title-salvage"],
          rejectedCandidateIds: [],
        },
        findings: [{
          id: "additional:candidate-title-salvage",
          title: novelConclusion,
          text: "**Evidence signal:** Standby is 31% (current Snapshot).\n\n**AI angle:** The standby share may hide a weekday timing pattern.",
          epistemicStatus: "speculative",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("removes an exactly repeated exploratory sentence without dropping the supported card", async () => {
    const harness = createHarness();
    try {
      const repeated = "This is a testable hypothesis rather than a confirmed root cause.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-repeated-angle", "fact:standby-share", {
            title: "Standby timing may warrant a focused test",
            observation: "Standby energy represents 31% of the selected period.",
            angle: `${repeated} ${repeated.toLocaleLowerCase("en")}`,
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
              novelConclusion: repeated,
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "repeated-angle-run",
        sessionId: "repeated-angle-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: { acceptedCandidateIds: ["candidate-repeated-angle"] },
        findings: [{
          text: `**Evidence signal:** Standby energy represents 31% of the selected period.\n\n**AI angle:** ${repeated}`,
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("publishes an evidence-backed observation with a clearly labelled exploratory angle", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [{
            id: "candidate-evidence-and-angle",
            title: "Test whether standby load follows a shared closing routine",
            observation: "Standby energy represents 31% of the selected period.",
            angle: "A shared closing routine may be concentrating this load; compare weekday and weekend recurrence before changing schedules.",
            epistemicStatus: "speculative",
            origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
              novelConclusion: "A shared closing routine may be concentrating this load",
            },
            evidenceRefs: ["fact:standby-share"],
            toolAuditIds: [],
          }] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evidence-and-angle-run",
        sessionId: "evidence-and-angle-session",
      });

      expect(result).toMatchObject({
        status: "available",
        findings: [{
          id: "additional:candidate-evidence-and-angle",
          epistemicStatus: "speculative",
          text: "**Evidence signal:** Standby energy represents 31% of the selected period.\n\n**AI angle:** A shared closing routine may be concentrating this load; compare weekday and weekend recurrence before changing schedules.",
        }],
        publication: {
          acceptedCandidateIds: ["candidate-evidence-and-angle"],
          rejectedCandidateIds: [],
        },
      });
    } finally {
      harness.close();
    }
  });

const canvasPlan = (input: { candidateId: string; title: string; text: string }) => ({
  identity: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
  },
  finding: {
    id: input.candidateId,
    title: input.title,
    text: input.text,
    evidenceRefs: ["fact:standby-share"],
    visualNeeded: true,
  },
  investigatorBlocks: [{
    id: "canvas-block:standby-share",
    kind: "quantitative",
    visualization: "comparison",
    title: "Standby share",
    bindings: [{
      evidenceRef: "fact:standby-share",
      entityId: "preschool-project",
      metricId: "energy.standby-share",
      value: 31,
      unit: "%",
    }],
  }, {
    id: "canvas-block:forged",
    kind: "quantitative",
    visualization: "trend",
    title: "Forged trend",
    bindings: [{
      evidenceRef: "fact:standby-share",
      entityId: "preschool-project",
      metricId: "energy.standby-share",
      value: 999,
      unit: "%",
    }],
  }],
  presentationGapRequests: [],
  editorPlan: { orderedBlockIds: ["canvas-block:standby-share", "canvas-block:forged"] },
});

const catalog = (): AnalysisContextEvidenceCatalog => ({
  contract: "analysis-context-evidence@1",
  sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
  pins: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    dataCutoff: "2026-06-01T00:00:00.000Z",
    projectReleaseId: "release-current",
    metricVersion: "energy-metrics-v1",
  },
  facts: [
    fact("fact:standby-share", "confirmed", 31),
    fact("fact:operating-share", "confirmed", 69),
    fact("fact:partial", "partial", 12),
  ],
});

const fact = (
  id: string,
  status: "confirmed" | "provisional" | "partial",
  value: number,
) => ({
  id,
  label: id,
  metricId: id.replace("fact:", "energy."),
  value,
  unit: "%",
  status,
  evidenceRefs: [`snapshot-evidence:${id}`],
  dimensions: {},
});

const presentedReadModel = (input: {
  dataSnapshotId: string;
  sectionEvidenceRef: string;
}) => ({
  binding: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: input.dataSnapshotId,
    projectReleaseId: "release-current",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
  },
  sections: {
    "standby-wastage": {
      status: "available",
      artifactId: "section-artifact-standby",
      result: {
        artifactKind: "section-interpretation",
        status: "available",
        sectionId: "standby-wastage",
        binding: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          dataSnapshotId: input.dataSnapshotId,
          projectReleaseId: "release-current",
          analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 1,
        },
        summary: { text: "Standby energy use accounts for 31% of the selected period.", evidenceRefs: [input.sectionEvidenceRef] },
        insights: [],
      },
    },
  },
  executive: { status: "empty" },
});

const entityFact = (id: string, centreName: string, value: number) => ({
  id,
  label: `${centreName} energy intensity`,
  metricId: "energy.kwh_per_sqm",
  value,
  unit: "kWh/m2",
  status: "confirmed" as const,
  evidenceRefs: [`snapshot-evidence:${id}`],
  dimensions: { scopeName: centreName, centreCode: centreName.replace("Centre ", "") },
});

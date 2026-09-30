import type { EnergyIqOverviewAiArtifactRecord } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import {
  materializeNgeeAnnExecutiveResult,
  ngeeAnnExecutiveTargetId,
  type NgeeAnnExecutiveSource,
} from "./ngee-ann-executive-synthesis.js";
import {
  createNgeeAnnOverviewAiExecutiveArtifactIdentity,
  createOverviewAiArtifactIdentity,
} from "./overview-ai-artifact.js";

describe("Ngee Ann Executive Synthesis", () => {
  it("keeps supported cross-Section value while locally rejecting an unsupported sibling", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:test",
    });
    const result = materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "Demand and time behaviour point to two related management questions.",
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [{
          id: "finding:kept",
          title: "Peak demand and hourly concentration deserve a joint reading",
          text: "The 138.8 kW peak and the daytime pattern may share an operational boundary, but the current Evidence does not establish a cause.",
          epistemicStatus: "speculative",
          sectionIds: ["trend-and-demand", "time-behaviour"],
          sourceInsightIds: ["insight:trend", "insight:time"],
          evidenceRefs: ["evidence:trend", "evidence:time"],
        }, {
          id: "finding:rejected",
          title: "Unsupported number",
          text: "The unexplained impact is 999.9 kW.",
          epistemicStatus: "observed",
          sectionIds: ["trend-and-demand"],
          sourceInsightIds: ["insight:trend"],
          evidenceRefs: ["evidence:trend"],
        }],
      }),
    });

    expect(result).toMatchObject({
      status: "available",
      sourceSectionArtifactIds: ["artifact:trend", "artifact:time"],
      findings: [{ id: "finding:kept", epistemicStatus: "speculative" }],
    });
  });

  it("normalizes copied hourly energy-bucket units in the Executive summary and findings", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:hourly-unit",
    });
    const result = materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-hourly-unit",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "The combined reading includes an hourly profile expressed in kWh/h.",
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [{
          id: "finding:hourly-unit",
          title: "The hourly profile remains decision-relevant",
          text: "The accepted source describes its hourly energy buckets in kWh/h.",
          epistemicStatus: "observed",
          sectionIds: ["trend-and-demand", "time-behaviour"],
          sourceInsightIds: ["insight:trend", "insight:time"],
          evidenceRefs: ["evidence:trend", "evidence:time"],
        }],
      }),
    });

    expect(result.summary?.text).toBe("The combined reading includes an hourly profile expressed in kWh per hourly bucket.");
    expect(result.findings[0]?.text).toBe("The accepted source describes its hourly energy buckets in kWh per hourly bucket.");
  });

  it("keeps validated findings when an unsupported Executive summary cannot be published", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:summary-fallback",
    });
    const result = materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-summary-fallback",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "The unsupported combined impact is 999.9 kW.",
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [{
          id: "finding:validated",
          title: "Peak demand and hourly concentration deserve a joint reading",
          text: "The 138.8 kW peak and the daytime pattern may share an operational boundary, but the current Evidence does not establish a cause.",
          epistemicStatus: "speculative",
          sectionIds: ["trend-and-demand", "time-behaviour"],
          sourceInsightIds: ["insight:trend", "insight:time"],
          evidenceRefs: ["evidence:trend", "evidence:time"],
        }],
      }),
    });

    expect(result).toMatchObject({
      status: "available",
      summary: {
        text: "The 138.8 kW peak and the daytime pattern may share an operational boundary, but the current Evidence does not establish a cause.",
        evidenceRefs: ["evidence:trend", "evidence:time"],
      },
      findings: [{ id: "finding:validated" }],
    });
  });

  it("still rejects an unsupported summary when no validated finding survives", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:no-safe-fallback",
    });

    expect(() => materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-no-safe-fallback",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "The unsupported combined impact is 999.9 kW.",
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [{
          id: "finding:unsupported",
          title: "Unsupported number",
          text: "The unexplained impact is 999.9 kW.",
          epistemicStatus: "observed",
          sectionIds: ["trend-and-demand"],
          sourceInsightIds: ["insight:trend"],
          evidenceRefs: ["evidence:trend"],
        }],
      }),
    })).toThrow("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  });

  it("rejects an available Executive result that contains no publishable cross-Section Finding", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:no-cross-section-finding",
    });

    expect(() => materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-no-cross-section-finding",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "Demand and time behaviour are both available for review.",
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [],
      }),
    })).toThrow("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  });

  it("does not promote a single-Section restatement into Key Findings", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:single-section-restatement",
    });

    expect(() => materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-single-section-restatement",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: "Demand and time behaviour are both available for review.",
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [{
          id: "finding:copied-trend",
          title: "Peak demand was 138.8 kW",
          text: "Peak demand was 138.8 kW.",
          epistemicStatus: "observed",
          sectionIds: ["trend-and-demand"],
          sourceInsightIds: ["insight:trend"],
          evidenceRefs: ["evidence:trend"],
        }],
      }),
    })).toThrow("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  });

  it("preserves a useful Executive finding while lowering it to the source uncertainty", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:test",
    });
    const result = materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: { text: "Two Sections are available for a combined reading.", evidenceRefs: ["evidence:trend"] },
        findings: [{
          id: "finding:upgrade",
          title: "The timetable caused the peak-demand pattern",
          text: "The source hypothesis is now presented as a joint explanation for the 138.8 kW peak.",
          epistemicStatus: "observed",
          sectionIds: ["trend-and-demand", "time-behaviour"],
          sourceInsightIds: ["insight:trend", "insight:time"],
          evidenceRefs: ["evidence:trend", "evidence:time"],
        }],
      }),
    });

    expect(result.findings).toEqual([expect.objectContaining({
      id: "finding:upgrade",
      epistemicStatus: "speculative",
    })]);
  });

  it("keeps a readable cross-Section finding beyond the old card cut-off", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:readable-long-form",
    });
    const longText = `The accepted Sections support a useful cross-Section management conclusion. ${"It keeps the reasoning visible while preserving exact source lineage. ".repeat(7)}`;
    const result = materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-long-form",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: {
          text: `The current data supports a concise management reading. ${"The conclusion remains tied to both accepted Sections. ".repeat(9)}`,
          evidenceRefs: ["evidence:trend", "evidence:time"],
        },
        findings: [{
          id: "finding:readable-long-form",
          title: "Peak demand and hourly concentration support one coordinated management question",
          text: longText,
          epistemicStatus: "speculative",
          sectionIds: ["trend-and-demand", "time-behaviour"],
          sourceInsightIds: ["insight:trend", "insight:time"],
          evidenceRefs: ["evidence:trend", "evidence:time"],
        }],
      }),
    });

    expect(longText.length).toBeGreaterThan(480);
    expect(result.findings).toEqual([expect.objectContaining({ id: "finding:readable-long-form" })]);
  });

  it("keeps an evidence-linked management summary beyond the old 600-character transport cut-off", () => {
    const sources = sourceSections();
    const identity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: "sections:readable-summary",
    });
    const summaryText = (`The accepted Sections support a current management conclusion. ${"The reasoning remains visible, specific, and linked to exact source Evidence. ".repeat(12)}`).slice(0, 656);
    const findings = Array.from({ length: 5 }, (_, index) => ({
      id: `finding:${index + 1}`,
      title: `Supported cross-Section angle ${index + 1}`,
      text: "The 138.8 kW peak and the daytime pattern support a bounded management question.",
      epistemicStatus: "inferred",
      sectionIds: ["trend-and-demand", "time-behaviour"],
      sourceInsightIds: ["insight:trend", "insight:time"],
      evidenceRefs: ["evidence:trend", "evidence:time"],
    }));

    const result = materializeNgeeAnnExecutiveResult({
      identity,
      runId: "run:ngee:executive-readable-summary",
      sources,
      answer: JSON.stringify({
        status: "available",
        summary: { text: summaryText, evidenceRefs: ["evidence:trend", "evidence:time"] },
        findings,
      }),
    });

    expect(summaryText.length).toBeGreaterThan(600);
    expect(summaryText.length).toBeLessThanOrEqual(720);
    expect(result.summary?.text).toBe(summaryText);
    expect(result.findings.map(({ id }) => id)).toEqual([
      "finding:1",
      "finding:2",
      "finding:3",
    ]);
  });

  it("rotates the Executive target when any contributing Section Artifact changes", () => {
    const records = [record("artifact:trend", "hash-a"), record("artifact:time", "hash-b")];
    const changed = [record("artifact:trend", "hash-a"), record("artifact:time-v2", "hash-c")];

    expect(ngeeAnnExecutiveTargetId(records)).not.toBe(ngeeAnnExecutiveTargetId(changed));
    expect(ngeeAnnExecutiveTargetId([])).toBe("sections:none-v1");
  });

  it("rotates the Executive target when the same Section Artifact is retried successfully", () => {
    const failed = { ...record("artifact:time", "hash-same"), status: "failed" as const, error_code: "PROVIDER_FAILED" };
    const recovered = {
      ...record("artifact:time", "hash-same"),
      status: "available" as const,
      run_id: "run:recovered",
      result_json: JSON.stringify({ status: "available", summary: { text: "Recovered." } }),
    };

    expect(ngeeAnnExecutiveTargetId([failed])).not.toBe(ngeeAnnExecutiveTargetId([recovered]));
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

const sourceSections = (): NgeeAnnExecutiveSource[] => [{
  sectionId: "trend-and-demand",
  artifactId: "artifact:trend",
  result: {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: "workspace-default-model-profile",
    runId: "run:trend",
    contract: { id: "energyiq-project-section-interpretation", revision: "energyiq-project-section-interpretation-v1" },
    binding: binding(),
    sectionId: "trend-and-demand",
    packRevision: "v2",
    capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
    summary: { text: "Peak demand was 138.8 kW.", evidenceRefs: ["evidence:trend"] },
    insights: [{
      id: "insight:trend", title: "Peak signal", text: "Peak demand was 138.8 kW.",
      epistemicStatus: "observed", evidenceRefs: ["evidence:trend"],
    }],
    publication: publication(),
  },
}, {
  sectionId: "time-behaviour",
  artifactId: "artifact:time",
  result: {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: "workspace-default-model-profile",
    runId: "run:time",
    contract: { id: "energyiq-project-section-interpretation", revision: "energyiq-project-section-interpretation-v1" },
    binding: binding(),
    sectionId: "time-behaviour",
    packRevision: "v2",
    capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
    summary: { text: "Usage is concentrated in daytime hours.", evidenceRefs: ["evidence:time"] },
    insights: [{
      id: "insight:time", title: "Possible timetable boundary", text: "A timetable may shape the profile.",
      epistemicStatus: "speculative", evidenceRefs: ["evidence:time"],
    }],
    publication: publication(),
  },
}];

const binding = () => ({
  workspaceId: "workspace-ngee", projectId: "ngee-ann-polytechnic", scopeId: "ngee-ann-polytechnic",
  dataSnapshotId: "snapshot-ngee", projectReleaseId: "release-ngee",
  analysisPeriod: { from: "2026-05-19T16:00:00.000Z", to: "2026-06-16T16:00:00.000Z" },
  modelProfileId: "workspace-default-model-profile", modelProfileRevision: 8,
});

const publication = () => ({
  policyId: "energyiq-project-section-publication" as const,
  policyRevision: "energyiq-project-section-publication-v1" as const,
  discoveredCount: 1, acceptedCount: 1, rejectedCount: 0, publishedCount: 1,
  suppressedCandidateIds: [], rejectedCandidateIds: [],
});

const record = (id: string, identityHash: string): EnergyIqOverviewAiArtifactRecord => ({
  id, identity_hash: identityHash, identity_json: "{}", workspace_id: "workspace-ngee",
  project_id: "ngee-ann-polytechnic", scope_id: "ngee-ann-polytechnic", resource: "electricity",
  data_snapshot_id: "snapshot-ngee", project_release_id: "release-ngee", renderer_key: "ngee-ann-overview",
  renderer_version: "1", analysis_pack_id: "ngee-ann-section-pack", analysis_pack_revision: "v1",
  model_profile_id: "workspace-default-model-profile", model_profile_revision: 8,
  output_contract_revision: "energyiq-project-section-interpretation-v1",
  validator_revision: "energyiq-project-section-acceptance-v1", status: "available", attempt_count: 1,
  triggered_by: "dev-user", created_at: "2026-08-17T00:00:00.000Z", updated_at: "2026-08-17T00:00:00.000Z",
});

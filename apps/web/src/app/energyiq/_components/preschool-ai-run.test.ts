import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../../../lib/config-api";
import type { PreschoolOverviewAiReadModelDto } from "../../../lib/config-api";
import {
  buildPreschoolAiArtifactReadInput,
  buildPreschoolAiRunInput,
  getOrStartPreschoolAiRun,
  invalidatePreschoolAiRun,
  retryPreschoolAiRun,
  resetPreschoolAiRunsForTests,
  resolvePreschoolAiEventStream,
  validatePreschoolAiEventStream,
  type PreschoolAiProgress,
  type PreschoolAiRelationship,
  type PreschoolAiRunInput,
  type PreschoolAiSectionId,
  type PreschoolAiWhyKind,
} from "./preschool-ai-run";
import type { AiFindingPresentation } from "./ai-finding-presentation";
import {
  PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  PRESCHOOL_AI_EDITOR_PROMPT_REVISION,
  PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION,
  PRESCHOOL_AI_METHOD_SKILL_ID,
  PRESCHOOL_AI_METHOD_SKILL_REVISION,
  PRESCHOOL_AI_WORKFLOW_REVISION,
  type PreschoolAiAcceptedArtifact,
} from "./preschool-ai-artifact";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import { runSavedAnalysisAiForSnapshot } from "./saved-analysis-ai";

describe("Preschool AI Run", () => {
  afterEach(() => {
    resetPreschoolAiRunsForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds the exact server workflow identity pinned to the published Preschool Snapshot", () => {
    const input = requiredInput();

    expect(input).toMatchObject({
      projectId: "preschool-demo",
      snapshotId: "preschool-26b85b9c0b95e090",
      projectReleaseId: "legacy-profile:preschool-demo:2",
      analysisFrom: "2026-05-01",
      analysisTo: "2026-05-31",
    });
    for (const pin of [
      "preschool-26b85b9c0b95e090",
      "legacy-profile:preschool-demo:2",
      "preschool-overview",
      "preschool-hierarchy-v4",
      "preschool-mapping-v4",
      "preschool-formula-v1",
      "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
      "sg-preschool-calendar-v1",
    ]) expect(input.identityKey).toContain(pin);
    expect(input.identityKey).toContain("preschool-ai-output-contract@v13");
    expect(input.identityKey).toContain("preschool-ai-workflow@preschool-two-stage-v2");
    expect(input.identityKey).toContain("investigator-prompt@preschool-investigator-v15");
    expect(input.identityKey).toContain("editor-prompt@preschool-insight-editor-v7");
    expect(input.identityKey).toContain("method-skill@energy-insight-investigation@1.0.0");
  });

  it("keeps autonomous discovery available when no deterministic theme is publishable", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolDecisionSignals!.items = [];

    expect(buildPreschoolAiRunInput(snapshot)).not.toBeNull();
  });

  it("keeps the exact Layer 1-2 Artifact read available when Layer 3 discovery inputs are unavailable", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolAppliances = {
      status: "unavailable",
      reason: {
        code: "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED",
        message: "The published Circuit aliases do not match the accepted Preschool Appliance contract.",
      },
      evidence: {
        projectReleaseId: snapshot.projectRelease.id,
        dataSnapshotId: snapshot.dataSnapshot.id,
        hierarchyRevisionId: snapshot.context.hierarchyRevisionId,
        meterMappingRevisionId: snapshot.context.meterMappingRevisionId,
        sourceKind: "circuit",
      },
    };

    expect(buildPreschoolAiRunInput(snapshot)).toBeNull();
    expect(buildPreschoolAiArtifactReadInput(snapshot)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: snapshot.context.scopeId,
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      analysisFrom: "2026-05-01",
      analysisTo: "2026-05-31",
    });
  });

  it.each([
    "BodyStreamBuffer was aborted",
    "RUN_TIMEOUT:300000",
  ])("does not expose an internal runtime failure: %s", (message) => {
    const eventStream = `data: ${JSON.stringify({ type: "RUN_ERROR", message })}\n\n`;

    expect(resolvePreschoolAiEventStream({
      eventStream,
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "AI analysis is temporarily unavailable. The verified Overview remains available.",
    });
  });

  it("accepts zero Findings after one governed observation when no useful path survives", () => {
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([], sqlEvents("sql-1", 843.0985)),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "available",
      providerProfileId: "profile-1",
      runId: "run-1",
      packId: "preschool-analysis-pack",
      packRevision: "v1",
      findings: [],
    });
  });

  it("accepts distinct autonomous Findings and exposes only Finding-specific Evidence", () => {
    const input = requiredInput();
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings()),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({
      sectionId: "centre-benchmark",
      signalRefs: ["efficiency"],
      relationship: "supports",
      why: { kind: "Evidence" },
      evidence: {
        snapshotId: input.snapshotId,
        deterministic: [expect.objectContaining({ id: "benchmark:priority-centre:G" })],
        tools: [
          expect.objectContaining({ toolCallId: "sql-1" }),
          expect.objectContaining({ toolCallId: "sql-2" }),
        ],
      },
    });
    expect(result.findings[1]!.evidence.tools).toHaveLength(2);
  });

  it("drops only a Finding whose section points to a missing Structured Signal", () => {
    const findings = generatedFindings();
    findings[0]!.signalRefs = ["missing-signal"];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      status: "available",
      findings: [{ sectionId: "operating-behaviour", signalRefs: ["after-hours"] }],
    });
  });

  it("lets the Agent place a signal-backed Finding in the most useful Overview section", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.sectionId = "appliance-contribution";

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      status: "available",
      findings: [{ sectionId: "appliance-contribution", signalRefs: ["efficiency"] }],
    });
  });

  it("accepts an Agent-selected visual backed by the same Finding SQL Evidence", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.presentation = {
      version: "1",
      blocks: [{
        type: "comparison",
        title: "Two observed energy values",
        unit: "kWh",
        items: [{ label: "Centre usage", value: 843.0985 }, { label: "Hour 9 usage", value: 62.4 }],
        evidenceRefs: ["benchmark:priority-centre:G"],
        evidenceSqlIndexes: [1, 2],
      }],
    };
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT Centre G usage", ["centre", "usage_kwh"], [["G", 843.0985]]),
      ...namedSqlEvents("sql-2", "SELECT Centre G hour usage", ["centre", "hour_of_day", "usage_kwh"], [["G", 9, 62.4]]),
    ];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.findings[0]!.presentation?.blocks).toHaveLength(1);
  });

  it("projects a cited day-type comparison when the Provider omits presentation", () => {
    const finding = generatedFindings()[1]!;
    finding.evidenceRefs = [];
    finding.evidenceSqlIndexes = [1];
    const sqlEvidence = namedSqlEvents(
      "sql-1",
      "SELECT day_type, mean_kwh_per_day FROM energy_intervals GROUP BY day_type",
      ["day_type", "mean_kwh_per_day"],
      [["weekday", 1118.42], ["weekend", 143.5]],
    );

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding], sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]!.presentation).toEqual({
        version: "1",
        blocks: [{
          type: "comparison",
          title: "Average energy by day type",
          unit: "kWh/day",
          items: [{ label: "Weekday", value: 1118.42 }, { label: "Weekend", value: 143.5 }],
          evidenceSqlIndexes: [1],
        }],
      });
    }
  });

  it("projects a cited appliance share when the Provider omits presentation", () => {
    const finding = generatedFindings()[1]!;
    finding.sectionId = "appliance-contribution";
    finding.evidenceRefs = [];
    finding.evidenceSqlIndexes = [1];
    const sqlEvidence = namedSqlEvents(
      "sql-1",
      "SELECT category, usage_kwh, share_pct FROM energy_intervals GROUP BY category",
      ["category", "usage_kwh", "share_pct"],
      [["load", 1406.343, 98], ["aircon", 28.684, 2], ["light", 0, 0]],
    );

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding], sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]!.presentation).toMatchObject({
        blocks: [{
          type: "share",
          unit: "%",
          title: "Energy share by appliance category",
          items: [{ label: "Plugload", value: 98 }, { label: "Air conditioning", value: 2 }, { label: "Lighting", value: 0 }],
        }],
      });
    }
  });

  it("projects a cited peak Circuit ranking when the Provider omits presentation", () => {
    const finding = generatedFindings()[0]!;
    finding.sectionId = "overall-summary";
    finding.evidenceRefs = [];
    finding.evidenceSqlIndexes = [1];
    const sqlEvidence = namedSqlEvents(
      "sql-1",
      "SELECT parent_node_id, circuit_name, interval_kw FROM energy_intervals ORDER BY interval_kw DESC LIMIT 5",
      ["parent_node_id", "circuit_name", "interval_kw"],
      [
        ["preschool-centre-n", "preschool-centre-n:Kitchen Plug Load", 43.711],
        ["preschool-centre-ad", "preschool-centre-ad:Plug Load3", 0.992],
      ],
    );

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding], sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]!.presentation).toMatchObject({
        blocks: [{
          type: "ranking",
          title: "Power at the peak interval",
          unit: "kW",
          items: [
            { label: "Centre N · Kitchen Plug Load", value: 43.711 },
            { label: "Centre AD · Plug Load 3", value: 0.992 },
          ],
        }],
      });
    }
  });

  it("normalizes the Provider's equivalent next and top-level blocks fields", () => {
    const finding = generatedFindings()[0]! as unknown as Record<string, unknown>;
    finding.next = finding.how;
    delete finding.how;
    delete finding.relationship;
    finding.blocks = [{
      type: "comparison",
      title: "Two observed energy values",
      unit: "kWh",
      items: [{ label: "Centre usage", value: 843.0985 }, { label: "Hour 9 usage", value: 62.4 }],
      evidenceRefs: ["benchmark:priority-centre:G"],
      evidenceSqlIndexes: [1, 2],
    }];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT Centre G usage", ["centre", "usage_kwh"], [["G", 843.0985]]),
      ...namedSqlEvents("sql-2", "SELECT Centre G hour usage", ["centre", "hour_of_day", "usage_kwh"], [["G", 9, 62.4]]),
    ];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding] as never, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]).toMatchObject({
        relationship: "independent",
        how: generatedFindings()[0]!.how,
        presentation: { version: "1", blocks: [expect.objectContaining({ type: "comparison" })] },
      });
    }
  });

  it("normalizes the live Provider aliases without bypassing Finding Evidence", () => {
    const finding = {
      sectionId: "centre-benchmark",
      signalRefs: ["efficiency"],
      evidenceRefs: ["benchmark:priority-centre:G"],
      evidenceSqlIndexes: [1],
      whyKind: "Evidence",
      what: "The scoped query confirms the efficiency signal for Centre G.",
      why: "The published benchmark and the scoped query point to the same investigation priority.",
      next: "Confirm the floor area and headcount before assigning a cause.",
      acted: "The next review can separate a denominator issue from an operating issue.",
      ignored: "The reason for the intensity signal remains unresolved.",
      verification: "Repeat the scoped comparison after the metadata review.",
      evidenceNote: "The signal supports prioritisation, not a confirmed root cause.",
      blocks: [{
        shape: "metric",
        label: "Centre G usage",
        value: "843.0985",
        unit: "kWh",
        prominence: "primary",
      }],
    };
    const sqlEvidence = namedSqlEvents(
      "sql-1",
      "SELECT centre_code, usage_kwh FROM energy_intervals WHERE centre_code = 'G'",
      ["centre_code", "usage_kwh"],
      [["G", 843.0985]],
    );

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding] as never, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]).toMatchObject({
        title: "High for both floor area and headcount",
        relationship: "independent",
        how: finding.next,
        expectedIfAct: finding.acted,
        ifIgnored: finding.ignored,
        howToVerify: finding.verification,
        presentation: {
          version: "1",
          blocks: [expect.objectContaining({ type: "metric", value: 843.0985 })],
        },
      });
    }
  });

  it("keeps a supported sentence while removing an unsupported numeric sentence", () => {
    const finding = generatedFindings()[0]!;
    finding.what = "The scoped comparison points to the same Centre. Centre G used 999 kWh.";

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]!.what).toBe("The scoped comparison points to the same Centre.");
      expect(result.findings[0]!.what).not.toContain("999");
    }
  });

  it("drops an Agent-selected visual value without hiding the verified Finding", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.presentation = {
      version: "1",
      blocks: [{
        type: "metric",
        label: "Unsupported saving",
        value: 999_999,
        unit: "kWh",
        evidenceRefs: ["benchmark:priority-centre:G"],
      }],
    };
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.findings[0]!.presentation).toBeUndefined();
  });

  it("accepts an independent SQL-only angle without forcing an official bundle theme", () => {
    const finding = generatedFindings()[0]!;
    finding.relationship = "independent";
    finding.title = "A separate operating pattern warrants review";
    finding.what = "The observation and validation queries expose a separate operating pattern.";
    finding.evidenceRefs = [];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings[0]!.evidence.deterministic).toEqual([]);
    expect(result.findings[0]!.evidence.tools).toHaveLength(2);
  });

  it("accepts a displayed Finding backed by one sufficient SQL operation", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.evidenceSqlIndexes = [1];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings[0]!.evidence.tools).toHaveLength(1);
  });

  it.each([
    ["a duplicated Evidence index", [1, 1]],
    ["only one Evidence index", [1]],
  ])("accepts %s after safe unique-index normalization", (_name, evidenceSqlIndexes) => {
    const findings = generatedFindings();
    findings[0]!.evidenceSqlIndexes = evidenceSqlIndexes;
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(result.status).toBe("available");
  });

  it("does not use repeated normalized SQL as a hard quality rejection", () => {
    const repeatedSql = [
      ...sqlEvents("sql-1", 843.0985),
      ...sqlEvents("sql-2", 62.4),
    ];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings(), repeatedSql),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(result.status).toBe("available");
  });

  it.each([
    ["declared row count", oversizedSqlEvents("sql-2", 11, 1)],
    ["returned rows", oversizedSqlEvents("sql-2", 1, 11)],
  ])("rejects SQL Evidence whose %s exceeds ten", (_name, oversized) => {
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings(), [
        ...sqlEvents("sql-1", 843.0985),
        ...oversized,
      ]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst exceeded the ten-row SQL Evidence limit.",
    });
  });

  it("keeps a verified Finding when an uncited exploratory SQL result exceeds ten rows", () => {
    const findings = generatedFindings().slice(1);
    findings[0]!.evidenceSqlIndexes = [2];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, [
        ...oversizedSqlEvents("sql-1", 31, 20),
        ...multiRowSqlEvents("sql-2"),
      ]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.evidence.tools.map((tool) => tool.toolCallId)).toEqual(["sql-2"]);
    }
  });

  it("drops only the Finding that cites oversized SQL Evidence", () => {
    const findings = generatedFindings();
    findings[0]!.evidenceSqlIndexes = [1];
    findings[1]!.evidenceSqlIndexes = [2];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, [
        ...oversizedSqlEvents("sql-1", 31, 20),
        ...multiRowSqlEvents("sql-2"),
      ]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.title).toBe(findings[1]!.title);
    }
  });

  it("rejects unsupported numeric claims and Snapshot pin drift", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G used 999 kWh.";
    const unsupported = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(unsupported).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });

    const drifted = requiredInput();
    drifted.discoveryEvidence.identity.snapshotId = "another-snapshot";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(),
      input: drifted,
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The Preschool Discovery Evidence does not match this Run identity.",
    });
  });

  it("binds an SQL-only numeric claim to the cited column meaning", () => {
    const valid = generatedFindings();
    valid[0]!.relationship = "independent";
    valid[0]!.evidenceRefs = [];
    valid[0]!.what = "The drill-down returned 62.4 kWh for the selected hour.";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(valid),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");

    const mismatched = generatedFindings().slice(0, 1);
    mismatched[0]!.relationship = "independent";
    mismatched[0]!.evidenceRefs = [];
    mismatched[0]!.what = "The drill-down returned 62.4 Centres.";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(mismatched),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("accepts the exact pinned Run dates and an actually cited SQL Evidence index as structural references", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "From 2026-05-01 through 2026-05-31, SQL Evidence index 1 supports the same Centre direction.";

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("accepts the verified Discovery Period in exact and equivalent UTC ISO presentations", () => {
    const input = requiredInput();
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = [
      "The verified Discovery Period runs from",
      "2026-04-30T16:00:00Z through 2026-05-31T16:00:00.000Z.",
    ].join(" ");

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("rejects a nearby UTC instant that is not the verified Discovery Period", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "The Discovery Period began at 2026-04-30T17:00:00Z.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("accepts only the pinned Period, Snapshot, and Release digits as structural context", () => {
    const input = requiredInput();
    input.snapshotId = "energy-snapshot-52ca";
    input.projectReleaseId = "preschool-demo-template-v2";
    input.discoveryEvidence.identity.snapshotId = input.snapshotId;
    input.discoveryEvidence.identity.projectReleaseId = input.projectReleaseId;
    const findings = generatedFindings();
    findings[0] = {
      ...findings[0]!,
      title: "May 2026 analysis context",
      what: "The verified period is 2026-05-01 through 2026-05-31.",
      why: "The result is pinned to Snapshot energy-snapshot-52ca.",
      how: "Review the 31 days as one analysis period.",
      howToVerify: "Re-run against Snapshot energy-snapshot-52ca.",
      evidenceNote: "Structural context only; Release preschool-demo-template-v2.",
    };

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it.each([
    ["a business value equal to the period day count", "The energy target is 31 kWh during May 2026."],
    ["a different Snapshot", "The result is pinned to Snapshot energy-snapshot-52cb."],
    ["a different Release", "The result is pinned to Release preschool-demo-template-v3."],
  ])("rejects %s despite the authorized structural context", (_name, what) => {
    const input = requiredInput();
    input.snapshotId = "energy-snapshot-52ca";
    input.projectReleaseId = "preschool-demo-template-v2";
    input.discoveryEvidence.identity.snapshotId = input.snapshotId;
    input.discoveryEvidence.identity.projectReleaseId = input.projectReleaseId;
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = what;

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("rejects an SQL Evidence index that the same Finding did not cite", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "SQL Evidence index 1 supports the same Centre direction.";
    findings[0]!.evidenceSqlIndexes = [2, 3];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, [
        ...sqlEvents("sql-1", 843.0985),
        ...multiRowSqlEvents("sql-2"),
        ...sqlEvents("sql-3", 42),
      ]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("repairs a missing SQL Evidence index when every numeric claim has an exact governed source", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre E records 870 kWh; Centre G records 816 kWh; Centre M records 813 kWh; Centre J records 824 kWh.";
    findings[0]!.why = "The cited Centre usage rows support the comparison.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1, 2, 4];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT total usage", ["total_usage_kwh"], [[24_922]]),
      ...namedSqlEvents("sql-2", "SELECT top centres", ["centre", "usage_kwh"], [["E", 870], ["N", 869], ["L", 863]]),
      ...namedSqlEvents("sql-3", "SELECT priority centres", ["centre", "usage_kwh"], [["G", 816], ["M", 813], ["J", 824]]),
      ...namedSqlEvents("sql-4", "SELECT validation centres", ["centre", "usage_kwh"], [["E", 870], ["N", 869], ["L", 863]]),
    ];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]!.evidence.tools.map((tool) => tool.toolCallId)).toEqual([
        "sql-1",
        "sql-2",
        "sql-3",
        "sql-4",
      ]);
    }
  });

  it("does not silently repair an unsupported number when multiple uncited SQL results match", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "The selected Centre used 870 kWh.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT portfolio usage", ["total_usage_kwh"], [[24_922]]),
      ...namedSqlEvents("sql-2", "SELECT Centre E usage", ["centre", "usage_kwh"], [["E", 870]]),
      ...namedSqlEvents("sql-3", "SELECT Centre N usage", ["centre", "usage_kwh"], [["N", 870]]),
    ];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not treat duplicate typed cells inside one uncited SQL result as a unique match", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "The selected Centre used 870 kWh.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT portfolio usage", ["total_usage_kwh"], [[24_922]]),
      ...namedSqlEvents(
        "sql-2",
        "SELECT Centre usage",
        ["centre", "usage_kwh"],
        [["E", 870], ["N", 870]],
      ),
    ];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not bind a same-valued SQL cell from the wrong Centre row", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre E used 870 kWh.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT portfolio usage", ["total_usage_kwh"], [[24_922]]),
      ...namedSqlEvents("sql-2", "SELECT Centre N usage", ["centre", "usage_kwh"], [["N", 870]]),
    ];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not let a typed Centre count authorize the same number as kWh", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "The Portfolio used 30 kWh.";
    findings[0]!.evidenceRefs = ["portfolio:window"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not let a same-valued Bundle metric from the wrong Centre authorize a claim", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G used 830.3005 kWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:M"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("accepts a typed Bundle metric from the explicitly named Centre", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G used 830.3005 kWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it("keeps a distant Centre reference bound to the numeric claim", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G remains the priority investigation because its operating pattern is persistent across the published comparison and requires a careful schedule and equipment review before anyone assigns a cause, with recorded usage of 830.3005 kWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:M"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("binds a Centre named after the numeric claim", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "830.3005 kWh was recorded for Centre G.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:M"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("fails closed when one numeric clause names multiple Centres", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G and Centre M recorded 830.3005 kWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:M"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("supports multi-character Centre codes when checking SQL row identity", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre AA used 870 kWh.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT Centre AB usage", ["centre", "usage_kwh"], [["AB", 870]]),
    ];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("accepts a typed EUI value for the explicitly named Centre", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G EUI is 12.6 kWh/m2.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it("accepts a typed per-pax value for the explicitly named Centre", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G uses 22.6 kWh per pax.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it("does not let a usage value authorize a currency claim", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G has a recorded cost of $830.3005.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not let a distant cost label fall back to a usage metric", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "The recorded cost for Centre G after applying the full published monthly accounting treatment was 830.3005.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not let a kWh field authorize the same number expressed as MWh", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G used 830.3005 MWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not let an MWh SQL column authorize the same number expressed as kWh", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G used 870 kWh.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT Centre G usage in MWh", ["centre", "usage_mwh"], [["G", 870]]),
    ];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("uses the Finding's unique Centre when a numeric field uses a pronoun", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.title = "Centre G remains the priority investigation";
    findings[0]!.what = "It used 830.3005 kWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:M"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("does not bind a portfolio SQL claim to a Centre cited elsewhere in the Finding", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.title = "Centre G remains a priority investigation";
    findings[0]!.what = "Weekend usage was 1435.03 kWh.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G"];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = namedSqlEvents(
      "sql-1",
      "SELECT day_type, SUM(usage_kwh) AS usage_kwh FROM energy_intervals GROUP BY day_type",
      ["day_type", "usage_kwh"],
      [["weekend", 1435.03]],
    );

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it("validates adjacent energy and percentage claims against their own SQL columns", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Load consumed 1406.34 kWh (98% of weekend usage).";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = namedSqlEvents(
      "sql-1",
      "SELECT category, usage_kwh, share_pct FROM energy_intervals",
      ["category", "usage_kwh", "share_pct"],
      [["load", 1406.34, 98]],
    );

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it("does not auto-bind when SQL and Bundle both contain the same typed value", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Centre G used 830.3005 kWh.";
    findings[0]!.evidenceRefs = [];
    findings[0]!.evidenceSqlIndexes = [1];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT portfolio usage", ["total_usage_kwh"], [[24_922]]),
      ...namedSqlEvents("sql-2", "SELECT Centre G usage", ["centre", "usage_kwh"], [["G", 830.3005]]),
    ];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("unavailable");
  });

  it("reports the customer-visible field that failed deterministic validation", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "This unsupported action would reduce usage by 67%.";

    const validation = validatePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(validation.result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
    expect(validation.issues).toEqual([{
      code: "unsupported_claim",
      field: "what",
      findingIndex: 0,
    }]);
  });

  it("keeps validation issue indexes tied to the original Provider candidate order", () => {
    const findings = generatedFindings();
    findings[0]!.evidenceRefs = ["not-in-this-snapshot"];
    findings[1]!.what = "This unsupported action would reduce usage by 67%.";

    const validation = validatePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(validation.issues).toContainEqual({
      code: "unsupported_claim",
      field: "what",
      findingIndex: 1,
    });
  });

  it("keeps verified Findings when a sibling Finding has an unsupported numeric claim", () => {
    const findings = generatedFindings();
    findings[0]!.what = "This unsupported action would reduce usage by 67%.";

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.title).toBe(findings[1]!.title);
    }
  });

  it("keeps verified Findings when a sibling cites Evidence outside the current Snapshot", () => {
    const findings = generatedFindings();
    findings[0]!.evidenceRefs = ["operational:standby", "sop:breaching"];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.title).toBe(findings[1]!.title);
    }
  });

  it("does not treat a cited ranked-query label or P75 benchmark name as a business number", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.title = "The ranked hour scan remains useful";
    findings[0]!.what = "The top-10 scan returned 62.4 kWh for the selected hour.";
    findings[0]!.ifIgnored = "A later P75 comparison could inherit an unchecked input.";
    findings[0]!.evidenceRefs = [];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it("accepts the exact cited SQL returned-row count only as limitation context", () => {
    const finding = generatedFindings().slice(0, 1);
    finding[0]!.evidenceSqlIndexes = [2];
    finding[0]!.evidenceNote = "The ranking reflects only the 3 rows returned.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(finding),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");

    finding[0]!.evidenceNote = "The Evidence supports prioritisation, not a confirmed root cause.";
    finding[0]!.what = "The ranking reflects only the 3 rows returned.";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(finding),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });

    finding[0]!.what = generatedFindings()[0]!.what;
    finding[0]!.evidenceNote = "The ranking reflects only the 4 rows returned.";
    const sanitized = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(finding),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(sanitized.status).toBe("available");
    if (sanitized.status === "available") {
      expect(sanitized.findings[0]!.evidenceNote).toBe("The Evidence supports prioritisation, not a confirmed cause.");
      expect(sanitized.findings[0]!.evidenceNote).not.toContain("4 rows");
    }
  });

  it("binds an exact Bundle field and treats an actually cited SQL predicate as method context", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.title = "Portfolio validation coverage remains explicit";
    findings[0]!.what = "The validation should cover all 30 Centres.";
    findings[0]!.how = "Compare local_hour<7 or >=19 in the cited query.";
    findings[0]!.evidenceRefs = ["benchmark:priority-centre:G", "portfolio:window"];
    const sqlEvidence = [
      ...namedSqlEvents("sql-1", "SELECT 843.0985 AS usage_kwh WHERE local_hour<7 OR local_hour>=19", ["usage_kwh"], [[843.0985]]),
      ...namedSqlEvents("sql-2", "SELECT 62.4 AS usage_kwh", ["usage_kwh"], [[62.4]]),
    ];

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.findings[0]!.evidence.deterministic.map((item) => item.id)).toContain("portfolio:window");
    }
  });

  it.each([
    ["an arbitrary date", "The pattern was visible on 2026-05-30."],
    ["a UUID", "The artifact was 550e8400-e29b-41d4-a716-446655440000."],
  ])("rejects %s even when the Finding cites valid SQL", (_name, what) => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = what;

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not let a version string in cited values authorize an unrelated percentage", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Estimated savings are 1%.";
    findings[0]!.evidenceRefs = ["operating:portfolio"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not remove an authorized date embedded inside an artifact id", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "Artifact artifact_2026-05-01 was selected.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not remove a cited Evidence index phrase that is only a prefix of a longer numeric token", () => {
    const findings = generatedFindings().slice(0, 1);
    findings[0]!.what = "SQL Evidence index 1843.0985 was selected.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("fails closed when the bundled Period drifts from the authorized Run window", () => {
    const input = requiredInput();
    input.discoveryEvidence.identity.period.from = "2026-04-29T16:00:00.000Z";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The Preschool Discovery Evidence does not match this Run identity.",
    });
  });

  it("accepts multiple useful operations, including multi-row drill-down Evidence", () => {
    const findings = generatedFindings();
    findings[0]!.evidenceSqlIndexes = [1, 2, 3, 4];
    const sqlEvidence = [
      ...sqlEvents("sql-1", 843.0985),
      ...multiRowSqlEvents("sql-2"),
      ...sqlEvents("sql-3", 42),
      ...sqlEvents("sql-4", 24),
    ];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.findings[0]!.evidence.tools).toHaveLength(4);
  });

  it("allows the Agent to replan after rejected SQL calls without a fixed attempt gate", () => {
    const rejected = [
      { type: "TOOL_CALL_START", toolCallId: "sql-bad", toolCallName: "run_sql_readonly", args: { sql: "WITH bad AS (...)" } },
      { type: "TOOL_CALL_RESULT", toolCallId: "sql-bad", toolCallName: "run_sql_readonly", result: { error: "QUERY_VALIDATION_FAILED" } },
      { type: "TOOL_CALL_START", toolCallId: "sql-third", toolCallName: "run_sql_readonly", args: { sql: "SELECT 3" } },
      { type: "TOOL_CALL_RESULT", toolCallId: "sql-third", toolCallName: "run_sql_readonly", result: { error: "QUERY_VALIDATION_FAILED" } },
      { type: "TOOL_CALL_START", toolCallId: "sql-fourth", toolCallName: "run_sql_readonly", args: { sql: "SELECT 4" } },
      { type: "TOOL_CALL_RESULT", toolCallId: "sql-fourth", toolCallName: "run_sql_readonly", result: { error: "QUERY_VALIDATION_FAILED" } },
    ];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings(), undefined, rejected),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(result.status).toBe("available");
  });

  it("keeps a missing exact Overview Artifact read-only instead of calling ensure, retry, or Provider", async () => {
    const input = requiredInput();
    const readSpy = vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue({
      status: "missing",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
    });
    const ensureSpy = vi.spyOn(configApi, "ensureEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-must-not-be-created",
      status: "failed",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      attemptCount: 2,
    });
    const retrySpy = vi.spyOn(configApi, "retryEnergyOverviewAiArtifact");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({ status: "unavailable" });
    invalidatePreschoolAiRun(input);
    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({ status: "unavailable" });

    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(retrySpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls a queued exact Overview Artifact with GET only until the stored result becomes available", async () => {
    const input = requiredInput();
    const available = sharedArtifactFixture(input, "run-editor-queued");
    const readSpy = vi.spyOn(configApi, "getEnergyOverviewAiArtifact")
      .mockResolvedValueOnce({
        id: "artifact-queued",
        status: "queued",
        dataSnapshotId: input.snapshotId,
        projectReleaseId: input.projectReleaseId,
      })
      .mockResolvedValue({
        id: "artifact-queued",
        status: "available",
        dataSnapshotId: input.snapshotId,
        projectReleaseId: input.projectReleaseId,
        result: available,
      });
    const ensureSpy = vi.spyOn(configApi, "ensureEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-queued",
      status: "queued",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
    });
    const retrySpy = vi.spyOn(configApi, "retryEnergyOverviewAiArtifact");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({
      status: "available",
      runId: "run-editor-queued",
    });

    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(retrySpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets two client identities share one server-owned two-stage Provider execution", async () => {
    const firstInput = requiredInput();
    const secondInput = { ...firstInput, identityKey: `second-authorized-user:${firstInput.identityKey}` };
    const available = sharedArtifactFixture(firstInput, "run-editor-shared");
    const readSpy = vi.spyOn(configApi, "getEnergyOverviewAiArtifact")
      .mockResolvedValueOnce({
        id: "artifact-shared",
        status: "running",
        dataSnapshotId: firstInput.snapshotId,
        projectReleaseId: firstInput.projectReleaseId,
        modelProfileId: "profile-1",
      })
      .mockResolvedValueOnce({
        id: "artifact-shared",
        status: "running",
        dataSnapshotId: firstInput.snapshotId,
        projectReleaseId: firstInput.projectReleaseId,
        modelProfileId: "profile-1",
      })
      .mockResolvedValue({
        id: "artifact-shared",
        status: "available",
        dataSnapshotId: firstInput.snapshotId,
        projectReleaseId: firstInput.projectReleaseId,
        result: available,
      });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      getOrStartPreschoolAiRun(firstInput),
      getOrStartPreschoolAiRun(secondInput),
    ]);

    expect(first).toMatchObject({ status: "available" });
    expect(second).toEqual(first);
    expect(readSpy).toHaveBeenCalledTimes(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails soft when a non-owner waits past the shared Artifact deadline", async () => {
    vi.useFakeTimers();
    const input = requiredInput();
    vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-running",
      status: "running",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      modelProfileId: "profile-1",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = getOrStartPreschoolAiRun(input);
    await vi.advanceTimersByTimeAsync(13 * 60 * 1_000);

    await expect(result).resolves.toEqual({
      status: "unavailable",
      reason: "AI analysis is temporarily unavailable. The verified Overview remains available.",
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expires an aggregate read model that stays internally pending and lets a later mount read again", async () => {
    vi.useFakeTimers();
    const input = requiredInput();
    const pending = sectionedArtifactFixture(input);
    pending.sections["standby-wastage"] = { status: "running" };
    let stored = pending;
    const readSpy = vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockImplementation(async () => ({
      id: "aggregate-read-model",
      status: "available",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      result: stored,
    }));
    const ensureSpy = vi.spyOn(configApi, "ensureEnergyOverviewAiArtifact");
    const retrySpy = vi.spyOn(configApi, "retryEnergyOverviewAiArtifact");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const first = getOrStartPreschoolAiRun(input);
    await vi.advanceTimersByTimeAsync(13 * 60 * 1_000);

    await expect(first).resolves.toEqual({
      status: "unavailable",
      reason: "AI analysis is temporarily unavailable. The verified Overview remains available.",
      retryable: true,
    });
    const readsAtDeadline = readSpy.mock.calls.length;
    stored = sectionedArtifactFixture(input);

    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({
      artifactKind: "preschool-overview-ai-read-model",
      status: "available",
    });
    expect(readSpy.mock.calls.length).toBeGreaterThan(readsAtDeadline);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(retrySpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the shared current Artifact without reading a user-owned Session or starting Provider", async () => {
    const input = requiredInput();
    const available = sharedArtifactFixture(input, "run-editor-shared");
    vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-shared",
      status: "available",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      result: available,
    });
    const sessionSpy = vi.spyOn(configApi, "getSessionConversation");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({
      status: "available",
      runId: "run-editor-shared",
    });
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the aggregate Section read model on refresh without calling ensure or Provider", async () => {
    const input = requiredInput();
    const aggregate = sectionedArtifactFixture(input);
    vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue({
      status: "available",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      result: aggregate,
    });
    const ensureSpy = vi.spyOn(configApi, "ensureEnergyOverviewAiArtifact");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({
      artifactKind: "preschool-overview-ai-read-model",
      sections: {
        "centre-benchmark": { status: "available" },
        "standby-wastage": { status: "unavailable" },
      },
    });
    await expect(runSavedAnalysisAiForSnapshot(preschoolGoldenSnapshot())).resolves.toMatchObject({
      contract: "energyiq-saved-ai-result@2",
      result: { artifactKind: "preschool-overview-ai-read-model" },
    });
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves Saved Analysis AI absent when its exact Artifact is missing without calling ensure", async () => {
    const input = requiredInput();
    const readSpy = vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue({
      status: "missing",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
    });
    const ensureSpy = vi.spyOn(configApi, "ensureEnergyOverviewAiArtifact").mockResolvedValue({
      id: "saved-artifact-must-not-be-created",
      status: "failed",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      attemptCount: 2,
    });
    const retrySpy = vi.spyOn(configApi, "retryEnergyOverviewAiArtifact");

    await expect(runSavedAnalysisAiForSnapshot(preschoolGoldenSnapshot())).resolves.toBeNull();

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(retrySpy).not.toHaveBeenCalled();
  });

  it("uses the explicit server retry endpoint without submitting canonical content", async () => {
    const input = requiredInput();
    vi.spyOn(configApi, "retryEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-failed",
      status: "failed",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      attemptCount: 2,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryPreschoolAiRun(input)).resolves.toEqual({
      status: "unavailable",
      reason: "AI analysis is temporarily unavailable. The verified Overview remains available.",
      retryable: false,
    });
    expect(configApi.retryEnergyOverviewAiArtifact).toHaveBeenCalledWith(input.projectId, input.scopeId, {
      from: input.analysisFrom,
      to: input.analysisTo,
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces a failed cached run after retry so remount and Saved Analysis see available", async () => {
    const input = requiredInput();
    const available = sharedArtifactFixture(input, "run-editor-retry");
    const readSpy = vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-failed",
      status: "failed",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      attemptCount: 1,
    });
    vi.spyOn(configApi, "retryEnergyOverviewAiArtifact").mockResolvedValue({
      id: "artifact-retried",
      status: "available",
      dataSnapshotId: input.snapshotId,
      projectReleaseId: input.projectReleaseId,
      attemptCount: 2,
      result: available,
    });

    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({ status: "unavailable", retryable: true });
    await expect(retryPreschoolAiRun(input)).resolves.toMatchObject({ status: "available", runId: "run-editor-retry" });
    await expect(getOrStartPreschoolAiRun(input)).resolves.toMatchObject({ status: "available", runId: "run-editor-retry" });
    await expect(runSavedAnalysisAiForSnapshot(preschoolGoldenSnapshot())).resolves.toMatchObject({
      contract: "energyiq-saved-ai-result@1",
      result: { status: "available", runId: "run-editor-retry" },
    });
    expect(readSpy).toHaveBeenCalledTimes(1);
  });
});

function requiredInput(): PreschoolAiRunInput {
  const snapshot = preschoolGoldenSnapshot();
  const input = buildPreschoolAiRunInput(snapshot);
  if (!input) throw new Error("Expected the Preschool Golden Snapshot to support an AI Run");
  return input;
}

function sharedArtifactFixture(input: PreschoolAiRunInput, editorRunId: string): PreschoolAiAcceptedArtifact {
  return {
    status: "available",
    providerProfileId: "profile-shared",
    runId: editorRunId,
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    contract: { id: "preschool-ai-accepted-artifact", revision: PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION },
    binding: input.coverage.binding,
    workflow: {
      id: "preschool-two-stage",
      revision: PRESCHOOL_AI_WORKFLOW_REVISION,
      methodSkill: { id: PRESCHOOL_AI_METHOD_SKILL_ID, revision: PRESCHOOL_AI_METHOD_SKILL_REVISION },
      stages: {
        investigator: {
          runId: `${editorRunId}:investigator`,
          promptRevision: PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION,
        },
        editor: { runId: editorRunId, promptRevision: PRESCHOOL_AI_EDITOR_PROMPT_REVISION },
      },
    },
    findings: [],
  };
}

function sectionedArtifactFixture(input: PreschoolAiRunInput): PreschoolOverviewAiReadModelDto {
  const binding = {
    workspaceId: "preschool-workspace",
    projectId: input.projectId,
    scopeId: input.scopeId,
    dataSnapshotId: input.snapshotId,
    projectReleaseId: input.projectReleaseId,
    analysisPeriod: { ...input.coverage.binding.analysisPeriod },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  };
  return {
    artifactKind: "preschool-overview-ai-read-model",
    status: "available",
    binding,
    sections: {
      "centre-benchmark": {
        status: "available",
        artifactId: "section-benchmark",
        result: {
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: binding.modelProfileId,
          runId: "run-section-benchmark",
          binding,
          sectionId: "centre-benchmark",
          summary: "Benchmark evidence supports a focused review.",
          keyPoints: [
            { kind: "finding", text: "One verified pattern deserves attention.", evidenceRefs: ["evidence:benchmark"] },
            { kind: "next-check", text: "Confirm context before assigning a cause.", evidenceRefs: ["evidence:benchmark"] },
          ],
        },
      },
      "standby-wastage": { status: "unavailable", artifactId: "section-standby", reason: "SECTION_FAILED" },
      "operating-behaviour": { status: "unavailable", reason: "Not generated." },
      "planning-outlook": { status: "unavailable", reason: "Not generated." },
    },
    executive: { status: "unavailable", artifactId: "executive", reason: "SYNTHESIS_FAILED" },
  };
}

function successfulEventStream(
  findings = generatedFindings(),
  sqlEvidenceEvents: Array<Record<string, unknown>> = [
    ...sqlEvents("sql-1", 843.0985),
    ...multiRowSqlEvents("sql-2"),
  ],
  beforeSqlEvents: Array<Record<string, unknown>> = [],
): string {
  const events = [
    { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema" },
    { type: "TOOL_CALL_RESULT", toolCallId: "schema-1", toolCallName: "inspect_schema", result: { tables: [{ name: "energy_intervals", columns: [{ name: "usage_kwh", type: "DOUBLE" }] }] } },
    ...beforeSqlEvents,
    ...sqlEvidenceEvents,
    { type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify({ findings }) },
    { type: "RUN_FINISHED" },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function multiRowSqlEvents(toolCallId: string): Array<Record<string, unknown>> {
  const sql = "SELECT hour_of_day, SUM(usage_kwh) AS usage_kwh FROM energy_intervals WHERE quality_status='ok' AND official_aggregation_eligible=TRUE GROUP BY hour_of_day ORDER BY usage_kwh DESC LIMIT 3";
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    { type: "TOOL_CALL_RESULT", toolCallId, toolCallName: "run_sql_readonly", result: { sql, columns: ["hour_of_day", "usage_kwh"], rows: [[9, 62.4], [10, 59.1], [8, 57.8]], row_count: 3, audit_log_id: `audit-${toolCallId}`, elapsed_ms: 14 } },
  ];
}

function oversizedSqlEvents(toolCallId: string, rowCount: number, returnedRows: number): Array<Record<string, unknown>> {
  const sql = "SELECT hour_of_day, usage_kwh FROM energy_intervals ORDER BY usage_kwh DESC LIMIT 11";
  const rows = Array.from({ length: returnedRows }, (_, index) => [index, 100 - index]);
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    { type: "TOOL_CALL_RESULT", toolCallId, toolCallName: "run_sql_readonly", result: { sql, columns: ["hour_of_day", "usage_kwh"], rows, row_count: rowCount, audit_log_id: `audit-${toolCallId}`, elapsed_ms: 14 } },
  ];
}

function sqlEvents(toolCallId: string, value: number): Array<Record<string, unknown>> {
  const sql = "SELECT parent_node_id, SUM(usage_kwh) FROM energy_intervals WHERE quality_status='ok' AND official_aggregation_eligible=TRUE GROUP BY parent_node_id";
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    { type: "TOOL_CALL_RESULT", toolCallId, toolCallName: "run_sql_readonly", result: { sql, columns: ["parent_node_id", "usage_kwh"], rows: [["preschool-centre-7", value]], row_count: 1, audit_log_id: `audit-${toolCallId}`, elapsed_ms: 12 } },
  ];
}

function namedSqlEvents(
  toolCallId: string,
  sql: string,
  columns: string[],
  rows: unknown[][],
): Array<Record<string, unknown>> {
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      toolCallName: "run_sql_readonly",
      result: {
        sql,
        columns,
        rows,
        row_count: rows.length,
        audit_log_id: `audit-${toolCallId}`,
        elapsed_ms: 12,
      },
    },
  ];
}

type GeneratedFindingFixture = {
  sectionId: PreschoolAiSectionId;
  signalRefs: string[];
  relationship: PreschoolAiRelationship;
  title: string;
  what: string;
  whyKind: PreschoolAiWhyKind;
  why: string;
  how: string;
  howToVerify: string;
  evidenceNote: string;
  expectedIfAct: string;
  ifIgnored: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

function generatedFindings(): GeneratedFindingFixture[] {
  return [
    {
      sectionId: "centre-benchmark",
      signalRefs: ["efficiency"],
      relationship: "supports",
      title: "Centre G remains a priority investigation",
      what: "The peer comparison and SQL cross-check point to the same Centre.",
      whyKind: "Evidence",
      why: "The published EUI and per-pax quadrant makes the pattern decision-relevant.",
      how: "Inspect the Centre schedule and the highest contributing Circuit.",
      howToVerify: "Repeat the same scoped comparison after the operating review.",
      evidenceNote: "This supports prioritisation, not a confirmed root cause.",
      expectedIfAct: "The next review should isolate the operating condition behind the pattern.",
      ifIgnored: "The unresolved pattern may continue without an accountable investigation.",
      evidenceRefs: ["benchmark:priority-centre:G"],
      evidenceSqlIndexes: [1, 2],
    },
    {
      sectionId: "operating-behaviour",
      signalRefs: ["after-hours"],
      relationship: "independent",
      title: "Standby should be separated from operating Spikes",
      what: "The Calendar split exposes a separate after-hours investigation path.",
      whyKind: "Hypothesis",
      why: "Closed-hour energy can reflect schedule or equipment-state differences.",
      how: "Compare the leading standby Circuit with the published operating schedule.",
      howToVerify: "Check whether the same pattern recurs under the same Calendar classification.",
      evidenceNote: "The Evidence identifies a pattern but cannot prove waste.",
      expectedIfAct: "The review should distinguish scheduled use from avoidable standby.",
      ifIgnored: "Standby and operating use will remain mixed in the same decision path.",
      evidenceRefs: ["operating:portfolio", "circuit:standby:L"],
      evidenceSqlIndexes: [1, 2],
    },
  ];
}

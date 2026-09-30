import { describe, expect, it, vi } from "vitest";
import type { UserRecord } from "@datafoundry/metadata";

import {
  buildPreschoolHtmlAiSlotPrompt,
  createPreschoolHtmlAiSlotGenerator,
  assertPreschoolHtmlAiSlotFacts,
  validatePreschoolHtmlAiSlotFacts,
  PRESCHOOL_HTML_AI_SLOT_PROMPT_REVISION,
  PRESCHOOL_HTML_AI_SLOT_VALIDATOR_REVISION,
} from "./preschool-html-ai-slot.js";
import { PRESCHOOL_HTML_AI_SLOT_IDS } from "@datafoundry/contracts";

const identity = {
  workspaceId: "workspace-1",
  projectId: "preschool-demo",
  scopeId: "project",
  dataSnapshotId: "snapshot-1",
  projectReleaseId: "release-1",
  analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
  modelProfileId: "workspace-default",
  modelProfileRevision: 4,
  promptRevision: "preschool-html-slot-prompt@17",
  slotDefinitionRevision: "preschool-centre-benchmark-html@6",
} as const;

const definition = {
  slotId: "centre-benchmark" as const,
  revision: "preschool-centre-benchmark-html@6",
  role: "centre benchmark",
  label: "Centre benchmark",
  order: 1,
  regionIntent: "benchmark analysis section",
  businessObjective: "Find the Centres that deserve attention first.",
  audience: "CEO and facilities manager",
  decisionUse: "Choose which Centres merit a site-level check.",
  presentationIntent: ["rank and contrast"],
  skillId: "energyiq-evidence-first",
  skillRevision: "1",
  methodId: "preschool-html-slot-method",
  methodRevision: "1",
  contextRevision: "preschool-html-slot-context@2",
  toolPolicyRevision: "none@1",
  outputContractRevision: "energyiq-ai-slot-html-artifact@1",
  validatorRevision: "preschool-html-ai-slot-validator@13",
  presentationReferenceRevision: "preschool-html-slot-presentation@1",
};

const promptInput = {
  definition,
  identity,
  runtimeIdentity: {
    workspaceId: "workspace-1",
    projectId: "preschool-demo",
    scopeId: "project",
    resource: "electricity" as const,
    dataSnapshotId: "snapshot-1",
    projectReleaseId: "release-1",
    analysisPeriodFrom: "2026-06-01",
    analysisPeriodTo: "2026-07-01",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    analysisPackId: "preschool-html-ai-slot-pack",
    analysisPackRevision: "v1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 4,
    outputContractRevision: "energyiq-ai-slot-html-artifact@1",
    validatorRevision: "preschool-html-ai-slot-validator@13",
    workflowRevision: "preschool-html-ai-slot-workflow@11",
    investigatorPromptRevision: "preschool-html-slot-prompt@17",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "energyiq-evidence-first/preschool-html-slot-method",
    methodSkillRevision: "1/1",
    artifactKind: "html-slot" as const,
    targetId: "centre-benchmark",
    identityContractRevision: "html-slot-v1",
    capabilityRevision: "static-html-sandbox-v7",
    publicationRevision: "html-slot-v1",
    slotDefinitionRevision: "preschool-centre-benchmark-html@6",
  },
  context: { facts: [{ id: "evidence:centre:g", value: 12 }] },
  allowedEvidenceRefs: ["evidence:centre:g"],
  user: { id: "user-1" } as UserRecord,
  workspaceId: "workspace-1",
};

describe("Preschool HTML AI Slot generator", () => {
  it("rotates the prompt and validator identity for the quality contract", () => {
    expect(PRESCHOOL_HTML_AI_SLOT_PROMPT_REVISION).toBe("preschool-html-slot-prompt@17");
    expect(PRESCHOOL_HTML_AI_SLOT_VALIDATOR_REVISION).toBe("preschool-html-ai-slot-validator@13");
  });

  it("composes the four prompt layers and the bounded output contract", () => {
    const prompt = buildPreschoolHtmlAiSlotPrompt(promptInput);
    expect(prompt).toContain("Harness Charter");
    expect(prompt).toContain("centre-benchmark");
    expect(prompt).toContain("Exact identity");
    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("unit conversions");
    expect(prompt).toContain("Return each deterministicOverview.fact id");
    expect(prompt).toContain("copy that complete statement exactly");
    expect(prompt).toContain("presentationFacts entry has a factId");
    expect(prompt).toContain("Do not render a multi-metric table");
    expect(prompt).toContain("title-only Slot is invalid");
  });

  it("rejects a title-only Additional Insight without an evidence-backed body", async () => {
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async () => ({
        runId: "run-additional",
        sessionId: "session-additional",
        answer: JSON.stringify({
          evidenceRefs: ["evidence:centre:g"],
          html: "<section><h2 data-fact-ids=\"evidence:centre:g\">12 kWh</h2></section>",
        }),
      }),
      idFactory: () => ({ runId: "run-additional", sessionId: "session-additional" }),
    });
    await expect(generator.generate({
      ...promptInput,
      definition: {
        ...definition,
        slotId: "additional-insight",
        revision: "preschool-additional-insight-html@6",
      },
      identity: {
        ...identity,
        slotDefinitionRevision: "preschool-additional-insight-html@6",
      },
      runtimeIdentity: {
        ...promptInput.runtimeIdentity,
        targetId: "additional-insight",
        slotDefinitionRevision: "preschool-additional-insight-html@6",
      },
    })).rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT");
  });

  it("requires the canonical fact-anchor rule in every Slot prompt", () => {
    for (const slotId of PRESCHOOL_HTML_AI_SLOT_IDS) {
      const slotPrompt = buildPreschoolHtmlAiSlotPrompt({
        ...promptInput,
        definition: { ...definition, slotId, revision: `${slotId}@1` },
        identity: { ...identity, slotDefinitionRevision: `${slotId}@1` },
      });
      expect(slotPrompt).toContain("data-fact-ids");
      expect(slotPrompt).toContain("nearest semantic claim owner");
    }
  });

  it("accepts display rounding of an evidenced number and ignores ordered-list markers", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<ol><li data-fact-ids=\"evidence:centre:g\">Total energy: 24,922 kWh</li></ol>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: 24921.8123,
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("makes one runner call and server-owns the artifact identity", async () => {
    const runSlot = vi.fn().mockResolvedValue({
      runId: "run-1",
      sessionId: "session-1",
      answer: JSON.stringify({ evidenceRefs: ["evidence:centre:g"], html: "<p data-fact-ids=\"evidence:centre:g\">12 kWh</p>" }),
    });
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async (input) => runSlot(input),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });
    const result = await generator.generate(promptInput);
    expect(runSlot).toHaveBeenCalledTimes(1);
    expect(runSlot).toHaveBeenCalledWith(expect.objectContaining({
      runtimeIdentity: promptInput.runtimeIdentity,
    }));
    expect(result.artifact.identity).toEqual(identity);
    expect(result.artifact.slotId).toBe("centre-benchmark");
    expect(result.acceptance).toEqual({ status: "accepted", droppedClaims: [] });
  });

  it("recovers a returned HTML anchor when the model omits its allowed top-level evidence ref", async () => {
    const runSlot = vi.fn().mockResolvedValue({
      runId: "run-1",
      sessionId: "session-1",
      answer: JSON.stringify({
        evidenceRefs: ["evidence:centre:l"],
        html: [
          "<section><h2>Closed-hour spikes</h2>",
          '<p data-fact-ids="evidence:standby:summary">Closed-hour screening found 38 spikes across 4 Centres.</p>',
          '<p data-fact-ids="evidence:centre:l">Centre L had 28 closed-hour spikes.</p>',
          "</section>",
        ].join(""),
      }),
    });
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async (input) => runSlot(input),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });

    const result = await generator.generate({
      ...promptInput,
      context: {
        facts: [
          {
            id: "evidence:standby:summary",
            evidenceRefs: ["evidence:standby:summary"],
            label: "Closed-hour screening",
            value: { spikeCount: 38, centreCount: 4 },
            presentationText: "Closed-hour screening found 38 spikes across 4 Centres.",
          },
          {
            id: "evidence:centre:l",
            evidenceRefs: ["evidence:centre:l"],
            label: "Centre L closed-hour spikes",
            name: "Centre L",
            value: 28,
            presentationText: "Centre L had 28 closed-hour spikes.",
          },
        ],
      },
      allowedEvidenceRefs: ["evidence:standby:summary", "evidence:centre:l"],
    });

    expect(result.artifact.evidenceRefs).toEqual([
      "evidence:centre:l",
      "evidence:standby:summary",
    ]);
    expect(result.artifact.html).toContain("Closed-hour screening found 38 spikes across 4 Centres.");
  });

  it("prefers a returned direct fact over a pack record that cites the same low-level source", async () => {
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async () => ({
        runId: "run-1",
        sessionId: "session-1",
        answer: JSON.stringify({
          evidenceRefs: ["analysis.summary.usage_kwh", "evidence:standby:summary"],
          html: [
            '<article data-fact-ids="analysis.summary.usage_kwh evidence:standby:summary">',
            '<p data-fact-ids="analysis.summary.usage_kwh">Selected Scope energy use was 26,912.08 kWh.</p>',
            '<p data-fact-ids="evidence:standby:summary">Standby details are available in the standby evidence.</p>',
            "</article>",
          ].join(""),
        }),
      }),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });

    const result = await generator.generate({
      ...promptInput,
      context: {
        facts: [
          {
            id: "analysis.summary.usage_kwh",
            evidenceRefs: ["analysis.summary.usage_kwh"],
            label: "Selected Scope energy use",
            value: 26_912.08,
            unit: "kWh",
            presentationText: "Selected Scope energy use was 26,912.08 kWh.",
          },
          {
            id: "evidence:standby:summary",
            evidenceRefs: ["analysis.summary.usage_kwh", "evidence:standby:summary"],
            label: "Standby details",
            presentationText: "Standby details are available in the standby evidence.",
          },
        ],
      },
      allowedEvidenceRefs: ["analysis.summary.usage_kwh", "evidence:standby:summary"],
    });

    expect(result.acceptance.status).toBe("accepted");
    expect(result.artifact.html).toContain("26,912.08 kWh");
  });

  it("persists claim-level warnings without requiring a second model call", async () => {
    const runSlot = vi.fn().mockResolvedValue({
      runId: "run-1",
      sessionId: "session-1",
      answer: JSON.stringify({
        evidenceRefs: ["evidence:centre:g"],
        html: "<section><p data-fact-ids=\"evidence:centre:g\">Supported usage: 12 kWh.</p><p>Unverified usage: 999 kWh.</p></section>",
      }),
    });
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async (input) => runSlot(input),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });

    const result = await generator.generate(promptInput);

    expect(runSlot).toHaveBeenCalledTimes(1);
    expect(result.artifact.html).toContain("Supported usage: 12 kWh.");
    expect(result.artifact.html).not.toContain("999");
    expect(result.acceptance.status).toBe("accepted_with_warnings");
    expect(result.acceptance.droppedClaims).toHaveLength(1);
  });

  it("fails closed when the model returns an unknown evidence ref", async () => {
    const runSlot = vi.fn().mockResolvedValue({
      runId: "run-1",
      sessionId: "session-1",
      answer: JSON.stringify({
        evidenceRefs: ["evidence:centre:g", "evidence:not-allowed"],
        html: "<p data-fact-ids=\"evidence:centre:g\">Supported usage: 12 kWh.</p>",
      }),
    });
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async (input) => runSlot(input),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });

    await expect(generator.generate(promptInput)).rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID");
    expect(runSlot).toHaveBeenCalledTimes(1);
  });

  it("fails closed on unsafe HTML before claim-level degradation", async () => {
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async () => ({
        runId: "run-1",
        sessionId: "session-1",
        answer: JSON.stringify({
          evidenceRefs: ["evidence:centre:g"],
          html: "<p>12 kWh</p><script>alert(1)</script>",
        }),
      }),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });

    await expect(generator.generate(promptInput)).rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_UNSAFE");
  });

  it("rejects a visible number absent from the bounded context", async () => {
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async () => ({
        runId: "run-1",
        sessionId: "session-1",
        answer: JSON.stringify({ evidenceRefs: ["evidence:centre:g"], html: "<p>999 kWh</p>" }),
      }),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });
    await expect(generator.generate(promptInput)).rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT");
  });

  it("does not authorize a number from an unrelated Evidence item", async () => {
    const generator = createPreschoolHtmlAiSlotGenerator({
      runSlot: async () => ({
        runId: "run-1",
        sessionId: "session-1",
        answer: JSON.stringify({ evidenceRefs: ["evidence:centre:g"], html: "<p>999 kWh</p>" }),
      }),
      idFactory: () => ({ runId: "run-1", sessionId: "session-1" }),
    });
    await expect(generator.generate({
      ...promptInput,
      context: {
        exactSnapshot: { dataSnapshotId: "snapshot-999" },
        facts: [
          { id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12 },
          { id: "evidence:centre:h", evidenceRefs: ["evidence:centre:h"], value: 999 },
        ],
      },
    })).rejects.toThrow("PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT");
  });

  it("accepts a human-readable date backed by an exact timestamp identity", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">1 June 2026 · Centre Alpha East · 12 kWh</p>",
      boundedContext: {
        exactSnapshot: { analysisPeriod: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" } },
        facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12, name: "Centre Alpha East" }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("accepts a local date range backed by the server-owned local period", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">1–31 May 2026</p>",
      boundedContext: {
        exactSnapshot: {
          localAnalysisPeriod: { from: "2026-05-01", to: "2026-05-31" },
        },
        facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12 }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("accepts a short human date only when the exact evidenced day is bound", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">Centre L — 25 May</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: { localDate: "2026-05-25" },
          name: "Centre L",
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("accepts a percentile threshold label only when the bound evidence exposes that percentile", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">Centre L is above the 75th percentile.</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: { p75: 10.5254 },
          name: "Centre L",
          relation: "Centre L is above the 75th percentile.",
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("rejects a multi-word Centre name when only a shorter name is evidenced", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p>Centre Alpha East</p>",
      boundedContext: { facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12, name: "Centre Alpha" }] },
      evidenceRefs: ["evidence:centre:g"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_FABRICATED_ENTITY");
  });

  it("does not treat ordinary prose as an unsupported named entity", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p>This is supported by the evidence.</p>",
      boundedContext: { facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12 }] },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("does not treat an evidenced Centre name followed by prose as a new entity", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">Centre L sits just above that.</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: 12,
          name: "Centre L",
          prose: "Centre L sits just above that.",
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("does not merge an evidenced Centre with its evidenced circuit name", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:l\">Check Centre L Living Room Lighting.</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:l",
          evidenceRefs: ["evidence:centre:l"],
          centreName: "Centre L",
          circuitName: "Living Room Lighting",
          presentationText: "Check Centre L Living Room Lighting.",
        }],
      },
      evidenceRefs: ["evidence:centre:l"],
    })).not.toThrow();
  });

  it("degrades a nested unsupported claim without dropping a structurally anchored Slot", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        '<section data-fact-ids="evidence:operating:summary"><h2>Operating-hour patterns</h2>',
        '<p data-fact-ids="evidence:operating:summary">Operating-hour screening found 21 spikes across 14 Centres.</p>',
        '<h3>Largest evidenced spike</h3>',
        '<li data-fact-ids="evidence:operating:n">Centre N – Kitchen Plug Load drove 96.4% of its largest spike.</li>',
        '<h3>Leading circuit</h3></section>',
      ].join(""),
      boundedContext: {
        facts: [
          {
            id: "evidence:operating:summary",
            evidenceRefs: ["evidence:operating:summary"],
            presentationText: "Operating-hour screening found 21 spikes across 14 Centres.",
            spikeCount: 21,
            centreCount: 14,
          },
          {
            id: "evidence:operating:n",
            evidenceRefs: ["evidence:operating:n"],
            centreName: "Centre N",
            circuitName: "Kitchen Plug Load",
            sharePct: 95.2,
          },
        ],
      },
      evidenceRefs: ["evidence:operating:summary", "evidence:operating:n"],
    });
    expect(result).toMatchObject({
      status: "accepted_with_warnings",
      droppedClaims: expect.arrayContaining([expect.objectContaining({ reason: "unsupported-fact" })]),
    });
    expect(result.html).toContain("Operating-hour screening found 21 spikes across 14 Centres.");
    expect(result.html).not.toContain("96.4%");
  });

  it("ignores lower-case presentation labels while checking capitalised entity names", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:l evidence:centre:e evidence:centre:n\">Centre intensity scatter: Centres L, E and N are shown.</p>",
      boundedContext: {
        facts: [
          { id: "evidence:centre:l", evidenceRefs: ["evidence:centre:l"], value: 12, name: "Centre L" },
          { id: "evidence:centre:e", evidenceRefs: ["evidence:centre:e"], value: 11, name: "Centre E" },
          { id: "evidence:centre:n", evidenceRefs: ["evidence:centre:n"], value: 10, name: "Centre N" },
        ],
      },
      evidenceRefs: ["evidence:centre:l", "evidence:centre:e", "evidence:centre:n"],
    })).not.toThrow();
  });

  it("does not treat a capitalised table header after Centre as an entity", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<table><thead><tr><th>Centre</th><th>Cohort</th><th>Absolute</th></tr></thead><tbody><tr data-fact-ids=\"evidence:centre:l\"><td>Centre L</td><td>Preschool</td><td>12 kWh</td></tr></tbody></table>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:l",
          evidenceRefs: ["evidence:centre:l"],
          value: 12,
          unit: "kWh",
          name: "Centre L",
        }],
      },
      evidenceRefs: ["evidence:centre:l"],
    });
    expect(result).toMatchObject({ status: "accepted", droppedClaims: [] });
    expect(result.html).toContain("<th>Centre</th><th>Cohort</th><th>Absolute</th>");
  });

  it("keeps generic Centre headings and metric table headers without factual anchors", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        "<section><h2>Centre benchmark</h2>",
        "<table><thead><tr><th>Centre EUI</th><th>Per person</th></tr></thead>",
        '<tbody><tr data-fact-ids="evidence:centre:l"><td>Centre L</td><td>12 kWh</td></tr></tbody></table>',
        "</section>",
      ].join(""),
      boundedContext: {
        facts: [{
          id: "evidence:centre:l",
          evidenceRefs: ["evidence:centre:l"],
          value: 12,
          unit: "kWh",
          name: "Centre L",
        }],
      },
      evidenceRefs: ["evidence:centre:l"],
    });
    expect(result).toMatchObject({ status: "accepted", droppedClaims: [] });
    expect(result.html).toContain("<h2>Centre benchmark</h2>");
    expect(result.html).toContain("<th>Centre EUI</th><th>Per person</th>");
  });

  it("rejects a non-zero derived clock minute when only the hour is evidenced", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p>Peak hour: 15:30</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: { localHour: 15 },
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT");
  });

  it("accepts equivalent percentile, local-time and exact unit expressions", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">Centre L is above the 75th percentile; peak at 11pm on 25 May; usage 24.9 MWh.</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: { p75: 10.5254, localHour: 23, localDate: "2026-05-25", usageKwh: 24900 },
          unit: "kWh",
          name: "Centre L",
          relation: "Centre L is above the 75th percentile.",
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).not.toThrow();
  });

  it("accepts ordinary display rounding on a percent token", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:off-hours:share\">Off-hours share is 12.5% of total use.</p>",
      boundedContext: {
        facts: [{
          id: "evidence:off-hours:share",
          evidenceRefs: ["evidence:off-hours:share"],
          label: "Off-hours share",
          value: 12.45,
          unit: "%",
        }],
      },
      evidenceRefs: ["evidence:off-hours:share"],
    })).not.toThrow();
  });

  it("does not parse the trailing digit of an embedded p50 or p75 label", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:portfolio\">Portfolio benchmark p50 EUI: 7.03 kWh.</p>",
      boundedContext: {
        facts: [{ id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 7.034, label: "Portfolio benchmark", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:portfolio"],
    })).not.toThrow();
  });

  it("drops an unsupported claim block while retaining supported DOM blocks", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:centre:g\">Supported usage: 12 kWh.</p><p>Unverified usage: 999 kWh.</p></section>",
      boundedContext: {
        facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12 }],
      },
      evidenceRefs: ["evidence:centre:g"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Supported usage: 12 kWh.");
    expect(result.html).not.toContain("999");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("drops unsupported causal claims at block scope", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:centre:g\">Observed usage: 12 kWh.</p><p>Usage rose because controls failed.</p></section>",
      boundedContext: {
        facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12 }],
      },
      evidenceRefs: ["evidence:centre:g"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Observed usage: 12 kWh.");
    expect(result.html).not.toContain("controls failed");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-causal-claim" }),
    ]);
  });

  it("fails closed on a fabricated Centre rather than downgrading it", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: "<p>Centre Z: 12 kWh.</p>",
      boundedContext: {
        facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12, name: "Centre L" }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_FABRICATED_ENTITY");
  });

  it("drops a claim that names a real but unbound Centre without failing the whole Slot", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:centre:l\">Centre L is supported.</p><p>Centre Y: follow-up.</p></section>",
      boundedContext: {
        facts: [
          { id: "evidence:centre:l", evidenceRefs: ["evidence:centre:l"], name: "Centre L" },
          { id: "evidence:centre:y", evidenceRefs: ["evidence:centre:y"], name: "Centre Y" },
        ],
      },
      evidenceRefs: ["evidence:centre:l"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Centre L is supported.");
    expect(result.html).not.toContain("Centre Y: follow-up");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("prunes empty cards, table sections, rows, details, and containers after local claim drops", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        "<section>",
        "<div class='card'><p data-fact-ids='evidence:centre:l'>Supported usage: 12 kWh.</p><p>Centre Y: unsupported card claim.</p></div>",
        "<table><thead><tr><th>Centre Y</th><th>999 kWh</th></tr></thead><tbody><tr data-fact-ids='evidence:centre:l'><td>Centre L</td><td>12 kWh</td></tr></tbody></table>",
        "<table><tbody><tr><td>Centre Y</td><td>999 kWh</td></tr></tbody></table>",
        "<details><summary>Peak detail</summary><div><p>Centre Y: unsupported detail claim.</p></div></details>",
        "<div><p>Centre Y: unsupported container claim.</p></div>",
        "</section>",
      ].join(""),
      boundedContext: {
        facts: [
          { id: "evidence:centre:l", evidenceRefs: ["evidence:centre:l"], value: 12, name: "Centre L" },
          { id: "evidence:centre:y", evidenceRefs: ["evidence:centre:y"], value: 999, name: "Centre Y" },
        ],
      },
      evidenceRefs: ["evidence:centre:l"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Supported usage: 12 kWh.");
    expect(result.html).toContain("<tbody><tr data-fact-ids='evidence:centre:l'><td>Centre L</td><td>12 kWh</td></tr></tbody>");
    expect(result.html).not.toContain("class='card'><p></p>");
    expect(result.html).not.toMatch(/<(?:thead|tbody|tr|details|div|table)\b[^>]*>\s*<\/(?:thead|tbody|tr|details|div|table)>/iu);
    expect(result.html).not.toContain("Centre Y");
    expect(result.droppedClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "empty-structure" }),
    ]));
  });

  it("fails closed on a supported fact contradicted in its labelled claim block", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:g\">Total usage: 99 kWh.</p>",
      boundedContext: {
        facts: [{ id: "evidence:centre:g", evidenceRefs: ["evidence:centre:g"], value: 12, label: "Total usage", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:centre:g"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_CONFLICTING_FACT");
  });

  it("locally drops an unsupported number instead of rejecting a labelled block", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:usage\">Total usage: 12 kWh; optional note: 99 kWh.</p><p>Supported follow-up.</p></section>",
      boundedContext: {
        facts: [{ id: "evidence:usage", evidenceRefs: ["evidence:usage"], value: 12, label: "Total usage", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:usage"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Supported follow-up.");
    expect(result.html).not.toContain("99 kWh");
  });

  it("downgrades a labelled conflict when the block is explicitly secondary", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:usage\">Total usage: 99 kWh; optional note: 88 kWh.</p><p>Supported follow-up.</p></section>",
      boundedContext: {
        facts: [{ id: "evidence:usage", evidenceRefs: ["evidence:usage"], value: 12, label: "Total usage", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:usage"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Supported follow-up.");
    expect(result.html).not.toMatch(/(?:99|88)\s*kWh/iu);
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("does not cross-compare separate labelled facts in one claim block", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:usage evidence:peak\">Total usage: 12 kWh; Peak demand: 3 kW.</p>",
      boundedContext: {
        facts: [
          { id: "evidence:usage", evidenceRefs: ["evidence:usage"], value: 12, label: "Total usage", unit: "kWh" },
          { id: "evidence:peak", evidenceRefs: ["evidence:peak"], value: 3, label: "Peak demand", unit: "kW" },
        ],
      },
      evidenceRefs: ["evidence:usage", "evidence:peak"],
    })).not.toThrow();
  });

  it("drops a block when labelled numeric facts are swapped instead of treating the cited values as a bag", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:usage evidence:baseline\">Total usage: 3 kWh; Baseline: 12 kWh.</p><p data-fact-ids=\"evidence:usage evidence:baseline\">Total usage: 12 kWh; Baseline: 3 kWh.</p></section>",
      boundedContext: {
        facts: [
          { id: "evidence:usage", evidenceRefs: ["evidence:usage"], value: 12, label: "Total usage", unit: "kWh" },
          { id: "evidence:baseline", evidenceRefs: ["evidence:baseline"], value: 3, label: "Baseline", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:usage", "evidence:baseline"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Total usage: 3 kWh; Baseline: 12 kWh.");
    expect(result.html).toContain("Total usage: 12 kWh; Baseline: 3 kWh.");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("does not derive a percentage by pairing unrelated bound numeric facts", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:usage\">Supported usage: 12 kWh.</p><p>Unrelated share: 25%.</p></section>",
      boundedContext: {
        facts: [
          { id: "evidence:usage", evidenceRefs: ["evidence:usage"], value: 12, label: "Total usage", unit: "kWh" },
          { id: "evidence:baseline", evidenceRefs: ["evidence:baseline"], value: 3, label: "Baseline", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:usage", "evidence:baseline"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain("Supported usage: 12 kWh.");
    expect(result.html).not.toContain("Unrelated share: 25%.");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("accepts nested values from a mixed-unit evidence record when each display unit is exact", () => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html: "<p data-fact-ids=\"evidence:centre:l\">Centre L closed-hour spike: 5.04 kWh; typical level 0.40 kWh; excess 4.63 kWh.</p>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:l",
          evidenceRefs: ["evidence:centre:l"],
          label: "Centre L closed-hour spike",
          unit: "kWh, %",
          name: "Centre L",
          value: {
            usageKwh: 5.038,
            baselineKwh: 0.4032,
            impactKwh: 4.6348,
            sharePct: 96.2882,
          },
        }],
      },
      evidenceRefs: ["evidence:centre:l"],
    })).not.toThrow();
  });

  it("drops a measurement under an unrelated label while retaining a correct-label sibling", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><h2>Three Signals</h2><p data-fact-ids=\"evidence:centre:g\">Peak Interval: 138.8 kW</p><p data-fact-ids=\"evidence:centre:g\">Portfolio P75 EUI: 138.8 kW</p></section>",
      boundedContext: {
        facts: [{
          id: "evidence:centre:g",
          evidenceRefs: ["evidence:centre:g"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kW",
        }],
      },
      evidenceRefs: ["evidence:centre:g"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Peak Interval: 138.8 kW");
    expect(result.html).toContain("Portfolio P75 EUI: 138.8 kW");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("does not use an equal value from an unrelated metric label", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:portfolio\">Current EUI is 138.8 kWh.</p><p data-fact-ids=\"evidence:portfolio\">Portfolio P75 EUI: 138.8 kWh.</p></section>",
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Current EUI is 138.8 kWh");
    expect(result.html).toContain("Portfolio P75 EUI: 138.8 kWh");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it.each([
    "Current EUI 138.8 kWh",
    "Current EUI — 138.8 kWh",
    "Current EUI (138.8 kWh)",
  ])("drops a visible measurement that cannot be semantically bound: %s", (unsupportedClaim) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<section><p data-fact-ids="evidence:portfolio">${unsupportedClaim}</p><p data-fact-ids="evidence:portfolio">Portfolio P75 EUI: 138.8 kWh</p></section>`,
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain(unsupportedClaim);
    expect(result.html).toContain("Portfolio P75 EUI: 138.8 kWh");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("drops an alternative metric phrasing while retaining the exact labelled sibling", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:portfolio\">Current EUI reached 138.8 kWh.</p><p data-fact-ids=\"evidence:portfolio\">Portfolio P75 EUI: 138.8 kWh.</p></section>",
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Current EUI reached 138.8 kWh");
    expect(result.html).toContain("Portfolio P75 EUI: 138.8 kWh");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("binds table values to their row labels instead of a global equal value", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><table><tbody><tr data-fact-ids=\"evidence:portfolio\"><th>Current EUI</th><td>138.8 kWh</td></tr><tr data-fact-ids=\"evidence:portfolio\"><th>Portfolio P75 EUI</th><td>138.8 kWh</td></tr></tbody></table></section>",
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Current EUI");
    expect(result.html).toContain("Portfolio P75 EUI");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("binds Closed-hours share to its label instead of borrowing the same percentage", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:closed-hours-share\">Current share 12.5%</p><p data-fact-ids=\"evidence:closed-hours-share\">Closed-hours share: 12.5%</p></section>",
      boundedContext: {
        facts: [{
          id: "evidence:closed-hours-share",
          evidenceRefs: ["evidence:closed-hours-share"],
          value: 12.5,
          label: "Closed-hours share",
          unit: "%",
        }],
      },
      evidenceRefs: ["evidence:closed-hours-share"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Current share 12.5%");
    expect(result.html).toContain("Closed-hours share: 12.5%");
  });

  it("does not borrow a P75 EUI value for an unbound Current intensity label", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<section><p data-fact-ids=\"evidence:portfolio\">Current intensity 138.8 kWh</p><p data-fact-ids=\"evidence:portfolio\">Portfolio P75 EUI: 138.8 kWh</p></section>",
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Current intensity 138.8 kWh");
    expect(result.html).toContain("Portfolio P75 EUI: 138.8 kWh");
  });

  it("covers metric values across card siblings and drops only the wrong article", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: "<main><article data-fact-ids=\"evidence:portfolio\"><h3>Current EUI</h3><strong>138.8 kWh</strong></article><article data-fact-ids=\"evidence:portfolio\"><h3>Portfolio P75 EUI</h3><strong>138.8 kWh</strong></article></main>",
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Current EUI");
    expect(result.html).toContain("Portfolio P75 EUI");
  });

  it("validates anchored article and dl cards against only their referenced fact", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        '<main><article data-fact-ids="evidence:current"><h3>Portfolio P75 EUI</h3><strong>138.8 kWh</strong></article>',
        '<dl data-fact-ids="evidence:portfolio"><dt>Portfolio P75 EUI</dt><dd>138.8 kWh</dd></dl></main>',
      ].join(""),
      boundedContext: {
        facts: [
          { id: "evidence:current", evidenceRefs: ["evidence:current"], value: 138.8, label: "Current EUI", unit: "kWh" },
          { id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:current", "evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("<h3>Portfolio P75 EUI</h3>");
    expect(result.html).toContain("<dt>Portfolio P75 EUI</dt><dd>138.8 kWh</dd>");
    expect(result.droppedClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]));
  });

  it("uses the nearest fact anchor when an anchored claim owner contains another owner", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        '<section data-fact-ids="evidence:portfolio"><p>Portfolio P75 EUI: 138.8 kWh.</p>',
        '<article data-fact-ids="evidence:current"><h3>Current EUI</h3><strong>138.8 kWh</strong></article></section>',
      ].join(""),
      boundedContext: {
        facts: [
          { id: "evidence:current", evidenceRefs: ["evidence:current"], value: 138.8, label: "Current EUI", unit: "kWh" },
          { id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:current", "evidence:portfolio"],
    });
    expect(result.html).toContain("Portfolio P75 EUI: 138.8 kWh.");
    expect(result.html).toContain("<h3>Current EUI</h3><strong>138.8 kWh</strong>");
    expect(result.droppedClaims).toEqual([]);
  });

  it("does not let a redundant structural anchor hide an unsupported unanchored sibling", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        '<section data-fact-ids="evidence:summary">',
        '<p data-fact-ids="evidence:child">Child: 12 kWh</p>',
        '<p>This results in equipment failure.</p>',
        "</section>",
      ].join(""),
      boundedContext: {
        facts: [
          { id: "evidence:summary", evidenceRefs: ["evidence:summary"], value: 12, label: "Summary", unit: "kWh" },
          { id: "evidence:child", evidenceRefs: ["evidence:child"], value: 12, label: "Child", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:summary", "evidence:child"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain('<p data-fact-ids="evidence:child">Child: 12 kWh</p>');
    expect(result.html).not.toContain("This results in equipment failure.");
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-causal-claim" }),
    ]);
  });

  it("does not exempt an unsupported causal sentence merely because it is a heading", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        "<section>",
        "<h3>This results in equipment failure.</h3>",
        '<p data-fact-ids="evidence:child">Child: 12 kWh</p>',
        "</section>",
      ].join(""),
      boundedContext: {
        facts: [{ id: "evidence:child", evidenceRefs: ["evidence:child"], value: 12, label: "Child", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:child"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("This results in equipment failure.");
    expect(result.html).toContain('<p data-fact-ids="evidence:child">Child: 12 kWh</p>');
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-causal-claim" }),
    ]);
  });

  it.each([
    "Energy use is highest.",
    "This is the dominant usage pattern.",
    "Best-performing Centre",
    "Largest spike",
  ])("does not exempt an unsupported superlative heading: %s", (heading) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<section><h3>${heading}</h3><p data-fact-ids="evidence:child">Child: 12 kWh</p></section>`,
      boundedContext: {
        facts: [{ id: "evidence:child", evidenceRefs: ["evidence:child"], value: 12, label: "Child", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:child"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain(heading);
    expect(result.html).toContain('<p data-fact-ids="evidence:child">Child: 12 kWh</p>');
    expect(result.droppedClaims).toEqual([
      expect.objectContaining({ reason: "unsupported-fact" }),
    ]);
  });

  it("keeps a neutral presentation heading without requiring a fake fact anchor", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><h3>Operating-hour patterns</h3><p data-fact-ids="evidence:child">Child: 12 kWh</p></section>',
      boundedContext: {
        facts: [{ id: "evidence:child", evidenceRefs: ["evidence:child"], value: 12, label: "Child", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:child"],
    });
    expect(result.status).toBe("accepted");
    expect(result.html).toContain("<h3>Operating-hour patterns</h3>");
  });

  it("locally drops an unanchored factual card while retaining an anchored sibling", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        "<main><article><h3>Portfolio P75 EUI</h3><strong>138.8 kWh</strong></article>",
        '<article data-fact-ids="evidence:portfolio"><h3>Portfolio P75 EUI</h3><strong>138.8 kWh</strong></article></main>',
      ].join(""),
      boundedContext: {
        facts: [{ id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).toContain('data-fact-ids="evidence:portfolio"');
    expect(result.html).not.toMatch(/<article><h3>Portfolio P75 EUI<\/h3>/u);
  });

  it("rejects a foreign anchor instead of authorizing it through the global evidence bag", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<article data-fact-ids="evidence:not-returned"><h3>Portfolio P75 EUI</h3><strong>138.8 kWh</strong></article>',
      boundedContext: {
        facts: [{ id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:portfolio"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID");
  });

  it.each([
    '<article data-fact-ids="evidence:portfolio" data-fact-ids="evidence:portfolio"><strong>Portfolio P75 EUI: 138.8 kWh</strong></article>',
    '<article broken==value data-fact-ids="evidence:portfolio"><strong>Portfolio P75 EUI: 138.8 kWh</strong></article>',
  ])("rejects malformed or repeated factual owner attributes as unsafe markup: %s", (html) => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html,
      boundedContext: {
        facts: [{ id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:portfolio"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_UNSAFE");
  });

  it("does not treat data-fact-ids text inside another attribute as an evidence anchor", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<article title="data-fact-ids=\'evidence:portfolio\'"><strong>Portfolio P75 EUI: 138.8 kWh</strong></article>',
      boundedContext: {
        facts: [{ id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" }],
      },
      evidenceRefs: ["evidence:portfolio"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_UNSAFE");
  });

  it.each([
    "Centre L is best.",
    "Energy use is highest.",
    "This is the dominant usage pattern.",
    "Centre L dominates the portfolio.",
    "Centre L is the worst.",
    "Centre L is superior.",
    "Centre L is inferior.",
    "Centre L is the winner.",
    "Centre L is optimal.",
    "Centre L is ahead.",
    "Centre L uses double the baseline.",
    "Centre L represents the majority.",
    "Centre L represents the lion's share.",
  ])("drops a one-subject superlative without canonical relation evidence: %s", (claim) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<section><article data-fact-ids="evidence:portfolio"><p>${claim}</p></article><p>Supporting context remains available.</p></section>`,
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          label: "Portfolio EUI",
          value: 138.8,
          unit: "kWh",
          entities: [{ name: "Centre L" }],
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain(claim);
    expect(result.html).toContain("Supporting context remains available.");
  });

  it("fails closed when two bounded records claim the same evidence ref", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<article data-fact-ids="evidence:shared"><strong>Total usage: 12 kWh</strong></article>',
      boundedContext: {
        facts: [
          { id: "evidence:first", evidenceRefs: ["evidence:shared"], value: 12, label: "Total usage", unit: "kWh" },
          { id: "evidence:second", evidenceRefs: ["evidence:shared"], value: 12, label: "Total usage", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:shared"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID");
  });

  it.each([
    "centre-benchmark",
    "standby-wastage",
    "operating-behaviour",
    "additional-insight",
  ])("accepts a %s claim anchored to one record when unreturned records share its low-level query source", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<section><p data-fact-ids="evidence:selected">Selected usage: 12 kWh.</p></section>',
      boundedContext: {
        facts: [
          { id: "evidence:selected", evidenceRefs: ["query:shared"], value: 12, label: "Selected usage", unit: "kWh" },
          { id: "evidence:sibling", evidenceRefs: ["query:shared"], value: 8, label: "Sibling usage", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:selected", "evidence:sibling"],
    })).not.toThrow();
  });

  it("accepts the three Planning facts when the model copies their server-owned presentation text", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: [
        '<section><h2>Planning outlook</h2>',
        '<p data-fact-ids="analysis.summary.usage_kwh">Selected Scope energy use was 26,912.08 kWh.</p>',
        '<p data-fact-ids="analysis.comparison.change_pct">Selected Scope energy use was 12.5% higher than the previous comparison period.</p>',
        '<details><summary>Watch signal</summary><p data-fact-ids="analysis.off_hours.share_pct">Off-hours energy use was 11.35% of total energy use.</p></details>',
        "</section>",
      ].join(""),
      boundedContext: {
        facts: [
          {
            id: "analysis.summary.usage_kwh",
            evidenceRefs: ["analysis.summary.usage_kwh"],
            label: "Selected Scope energy use",
            value: 26_912.08,
            unit: "kWh",
            presentationText: "Selected Scope energy use was 26,912.08 kWh.",
          },
          {
            id: "analysis.comparison.change_pct",
            evidenceRefs: ["analysis.comparison.change_pct"],
            label: "Energy percentage change from previous comparison period",
            value: 12.5,
            unit: "%",
            presentationText: "Selected Scope energy use was 12.5% higher than the previous comparison period.",
          },
          {
            id: "analysis.off_hours.share_pct",
            evidenceRefs: ["analysis.off_hours.share_pct"],
            label: "Off-hours share of energy use",
            value: 11.35,
            unit: "%",
            presentationText: "Off-hours energy use was 11.35% of total energy use.",
          },
        ],
      },
      evidenceRefs: [
        "analysis.summary.usage_kwh",
        "analysis.comparison.change_pct",
        "analysis.off_hours.share_pct",
      ],
    });
    expect(result.status).toBe("accepted");
    expect(result.droppedClaims).toEqual([]);
  });

  it.each([
    {
      id: "evidence:benchmark",
      html: "The Portfolio P75 EUI was 100 kWh/m2/year.",
      value: { sampleSize: 1, portfolio: { eui: { p75: 100 } } },
    },
    {
      id: "evidence:closed-hours",
      html: "Closed-hour energy use was 10 kWh, 10% of total energy use.",
      value: { closedHoursKwh: 10, closedHoursSharePct: 10 },
    },
    {
      id: "evidence:centre-n",
      html: "Centre N's absolute energy use was 20 kWh, ranked 1 of 30 Centres.",
      value: {
        name: "Centre N",
        metrics: { absoluteUsage: { value: 20, unit: "kWh", rank: { position: 1, outOf: 30 } } },
      },
    },
  ])("accepts an exact pack presentation fact: $id", ({ id, html, value }) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<p data-fact-ids="${id}">${html}</p>`,
      boundedContext: {
        facts: [{
          id,
          evidenceRefs: [id],
          label: id,
          value,
          presentationFacts: [{ presentationText: html }],
        }],
      },
      evidenceRefs: [id],
    });
    expect(result.status).toBe("accepted");
    expect(result.droppedClaims).toEqual([]);
  });

  it("fails closed on repeated returned or record-local evidence refs", () => {
    const boundedContext = {
      facts: [{ id: "evidence:portfolio", evidenceRefs: ["evidence:portfolio"], value: 138.8, label: "Portfolio P75 EUI", unit: "kWh" }],
    };
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<p data-fact-ids="evidence:portfolio">Portfolio P75 EUI: 138.8 kWh.</p>',
      boundedContext,
      evidenceRefs: ["evidence:portfolio", "evidence:portfolio"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID");
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<p data-fact-ids="evidence:portfolio">Portfolio P75 EUI: 138.8 kWh.</p>',
      boundedContext: {
        facts: [{ ...boundedContext.facts[0], evidenceRefs: ["evidence:portfolio", "evidence:portfolio"] }],
      },
      evidenceRefs: ["evidence:portfolio"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID");
  });

  it("accepts a comparison only when one anchored record carries the exact canonical relation", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<p data-fact-ids="evidence:relation">Centre L is higher than Centre E.</p>',
      boundedContext: {
        facts: [{
          id: "evidence:relation",
          evidenceRefs: ["evidence:relation"],
          relation: "Centre L is higher than Centre E.",
          entities: [{ name: "Centre L" }, { name: "Centre E" }],
        }],
      },
      evidenceRefs: ["evidence:relation"],
    })).not.toThrow();
  });

  it("accepts exact server-provided presentationText as the whole factual comparison", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<p data-fact-ids="analysis.comparison.change_kwh">Selected Scope energy use increased by 10 kWh from the previous comparison period.</p>',
      boundedContext: {
        facts: [{
          id: "analysis.comparison.change_kwh",
          evidenceRefs: ["analysis.comparison.change_kwh"],
          label: "Energy change from previous comparison period",
          value: 10,
          unit: "kWh",
          presentationText: "Selected Scope energy use increased by 10 kWh from the previous comparison period.",
        }],
      },
      evidenceRefs: ["analysis.comparison.change_kwh"],
    })).not.toThrow();
  });

  it("accepts a short non-factual label before the exact server presentation", () => {
    expect(() => validatePreschoolHtmlAiSlotFacts({
      html: '<p data-fact-ids="analysis.comparison.change_kwh"><strong>What changed:</strong> Selected Scope energy use increased by 10 kWh from the previous comparison period.</p>',
      boundedContext: {
        facts: [{
          id: "analysis.comparison.change_kwh",
          evidenceRefs: ["analysis.comparison.change_kwh"],
          label: "Energy change from previous comparison period",
          value: 10,
          unit: "kWh",
          presentationText: "Selected Scope energy use increased by 10 kWh from the previous comparison period.",
        }],
      },
      evidenceRefs: ["analysis.comparison.change_kwh"],
    })).not.toThrow();
  });

  it.each([
    "Guaranteed savings",
    "Certain outcome",
    "Proven winner",
    "Recommendation",
  ])("does not let an arbitrary label authorize a canonical comparison: %s", (label) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<section><p data-fact-ids="analysis.comparison.change_kwh"><strong>${label}:</strong> Selected Scope energy use increased by 10 kWh from the previous comparison period.</p><p>Supporting context remains available.</p></section>`,
      boundedContext: {
        facts: [{
          id: "analysis.comparison.change_kwh",
          evidenceRefs: ["analysis.comparison.change_kwh"],
          label: "Energy change from previous comparison period",
          value: 10,
          unit: "kWh",
          presentationText: "Selected Scope energy use increased by 10 kWh from the previous comparison period.",
        }],
      },
      evidenceRefs: ["analysis.comparison.change_kwh"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain(label);
    expect(result.html).toContain("Supporting context remains available.");
  });

  it("drops a comparison paraphrase and retains the exact server-owned presentation", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><p data-fact-ids="analysis.comparison.change_kwh">Selected Scope energy usage rose 10 kWh versus the previous period.</p><p data-fact-ids="analysis.comparison.change_kwh">Selected Scope energy use increased by 10 kWh from the previous comparison period.</p></section>',
      boundedContext: {
        facts: [{
          id: "analysis.comparison.change_kwh",
          evidenceRefs: ["analysis.comparison.change_kwh"],
          label: "Energy change from previous comparison period",
          value: 10,
          unit: "kWh",
          presentationText: "Selected Scope energy use increased by 10 kWh from the previous comparison period.",
        }],
      },
      evidenceRefs: ["analysis.comparison.change_kwh"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("energy usage rose");
    expect(result.html).toContain("energy use increased by 10 kWh from the previous comparison period");
  });

  it("drops a comparison whose subject and object reverse the canonical relation", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><article data-fact-ids="evidence:relation"><p>Centre E is higher than Centre L.</p></article><p>Supporting context remains available.</p></section>',
      boundedContext: {
        facts: [{
          id: "evidence:relation",
          evidenceRefs: ["evidence:relation"],
          relation: "Centre L is higher than Centre E.",
          entities: [{ name: "Centre L" }, { name: "Centre E" }],
        }],
      },
      evidenceRefs: ["evidence:relation"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Centre E is higher than Centre L");
    expect(result.html).toContain("Supporting context remains available.");
  });

  it("does not let a closed disclosure label authorize a visible sibling value", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><article data-fact-ids="evidence:portfolio"><details><summary>Method</summary><span>Portfolio P75 EUI</span></details><strong>138.8 kWh</strong></article><p>Supporting context remains available.</p></section>',
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          label: "Portfolio P75 EUI",
          value: 138.8,
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("138.8 kWh");
    expect(result.html).toContain("Supporting context remains available.");
  });

  it.each([
    "Centre L is higher than Centre E.",
    "Centre L is more efficient than Centre E.",
    "Centre L exceeds Centre E.",
  ])("does not authorize a comparison from separate entity records: %s", (comparison) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<section><p data-fact-ids="evidence:l evidence:e">${comparison}</p><p data-fact-ids="evidence:l">Centre L is in scope.</p></section>`,
      boundedContext: {
        facts: [
          { id: "evidence:l", evidenceRefs: ["evidence:l"], name: "Centre L" },
          { id: "evidence:e", evidenceRefs: ["evidence:e"], name: "Centre E" },
        ],
      },
      evidenceRefs: ["evidence:l", "evidence:e"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain(comparison);
    expect(result.html).toContain("Centre L is in scope.");
  });

  it("does not authorize multi-entity factual prose without a canonical relation", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><p data-fact-ids="evidence:l evidence:e">Centre L and Centre E differ.</p><p data-fact-ids="evidence:l">Centre L is in scope.</p></section>',
      boundedContext: {
        facts: [
          { id: "evidence:l", evidenceRefs: ["evidence:l"], name: "Centre L" },
          { id: "evidence:e", evidenceRefs: ["evidence:e"], name: "Centre E" },
        ],
      },
      evidenceRefs: ["evidence:l", "evidence:e"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Centre L and Centre E differ.");
    expect(result.html).toContain("Centre L is in scope.");
  });

  it.each([
    "Centre L outpaces Centre E.",
    "Centre L leads Centre E.",
    "Centre L is greater than Centre E.",
    "Centre L uses twice as much as Centre E.",
    "Centre L versus Centre E.",
    "Centre L is the top Centre.",
    "Centre L increased to 12 kWh.",
    "Energy use improved compared with baseline.",
    "Energy use changed relative to the previous period.",
  ])("drops comparative prose outside the canonical presentation text: %s", (comparison) => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: `<section><p data-fact-ids="evidence:l evidence:e">${comparison}</p><p data-fact-ids="evidence:l">Centre L is in scope.</p></section>`,
      boundedContext: {
        facts: [
          { id: "evidence:l", evidenceRefs: ["evidence:l"], name: "Centre L", value: 12, unit: "kWh" },
          { id: "evidence:e", evidenceRefs: ["evidence:e"], name: "Centre E", value: 8, unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:l", "evidence:e"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain(comparison);
    expect(result.html).toContain("Centre L is in scope.");
  });

  it("does not derive a comparison from two anchored numeric facts", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><p data-fact-ids="evidence:usage evidence:baseline">Usage 12 kWh is higher than baseline 3 kWh.</p><p data-fact-ids="evidence:usage">Usage: 12 kWh.</p></section>',
      boundedContext: {
        facts: [
          { id: "evidence:usage", evidenceRefs: ["evidence:usage"], value: 12, label: "Usage", unit: "kWh" },
          { id: "evidence:baseline", evidenceRefs: ["evidence:baseline"], value: 3, label: "Baseline", unit: "kWh" },
        ],
      },
      evidenceRefs: ["evidence:usage", "evidence:baseline"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("higher than baseline");
    expect(result.html).toContain("Usage: 12 kWh.");
  });

  it("validates every comparison in one factual owner", () => {
    const result = validatePreschoolHtmlAiSlotFacts({
      html: '<section><p data-fact-ids="evidence:relation">Centre L is higher than Centre E; Centre N is lower than Centre G.</p><p data-fact-ids="evidence:relation">Centre L is higher than Centre E.</p></section>',
      boundedContext: {
        facts: [{
          id: "evidence:relation",
          evidenceRefs: ["evidence:relation"],
          relation: "Centre L is higher than Centre E.",
          entities: [{ name: "Centre L" }, { name: "Centre E" }, { name: "Centre N" }, { name: "Centre G" }],
        }],
      },
      evidenceRefs: ["evidence:relation"],
    });
    expect(result.status).toBe("accepted_with_warnings");
    expect(result.html).not.toContain("Centre N is lower than Centre G");
    expect(result.html).toContain("Centre L is higher than Centre E.");
  });

  it.each([
    "<strong>Current EUI 138.8 kWh</strong>",
    "Current EUI 138.8 kWh",
    "Snapshot period: 2026-06-01",
    "Centre Oak",
  ])("fails closed when a factual claim has no safe root claim container: %s", (html) => {
    expect(() => assertPreschoolHtmlAiSlotFacts({
      html,
      boundedContext: {
        facts: [{
          id: "evidence:portfolio",
          evidenceRefs: ["evidence:portfolio"],
          value: 138.8,
          label: "Portfolio P75 EUI",
          unit: "kWh",
        }],
      },
      evidenceRefs: ["evidence:portfolio"],
    })).toThrow("PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT");
  });
});

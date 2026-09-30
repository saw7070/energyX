import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  type PreschoolSectionId,
  type PreschoolSectionPack,
} from "./preschool-overview-ai-contracts.js";
import { createPreschoolSectionInterpreter } from "./preschool-section-interpreter.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Section Interpreter", () => {
  it("persists valid siblings when one Section cites unsupported Evidence and retries only that Section", async () => {
    const harness = createHarness();
    const prompts: string[] = [];
    const attempts = new Map<PreschoolSectionId, number>();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ identity, prompt, runId, sessionId }) => {
        prompts.push(prompt);
        const sectionId = identity.targetId as PreschoolSectionId;
        const attempt = (attempts.get(sectionId) ?? 0) + 1;
        attempts.set(sectionId, attempt);
        const section = sectionId === "standby-wastage" && attempt === 1
          ? available(sectionId, "unsupported:evidence")
          : sectionId === "planning-outlook"
            ? { sectionId, status: "empty" }
            : available(sectionId);
        return { answer: JSON.stringify(section), runId, sessionId };
      },
    });

    const first = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(first).toMatchObject({
      "centre-benchmark": { status: "available" },
      "standby-wastage": {
        status: "failed",
        error_code: "PRESCHOOL_SECTION_INTERPRETATION_EVIDENCE_UNSUPPORTED",
      },
      "operating-behaviour": { status: "available" },
      "planning-outlook": { status: "available" },
    });
    expect(JSON.parse(first["planning-outlook"].result_json!)).toMatchObject({ status: "empty", keyPoints: [] });
    expect(prompts).toHaveLength(4);
    expect(prompts[0]).not.toContain("SQL tool");
    expect(prompts[0]).toContain("Do not query SQL");
    expect(prompts[0]).toContain("Do not create combined totals or shares from multiple Evidence items");
    expect(prompts[0]).toContain("1-4 useful keyPoints");
    expect(prompts[0]).toContain("do not force one of each kind");
    expect(prompts[0]).toContain("no useful incremental interpretation");
    expect(prompts[0]).toContain("exact supplied YYYY-MM-DD or its equivalent D Month YYYY rendering");
    expect(prompts[0]).toContain("copy localHour as HH:00");
    expect(prompts[0]).toContain("cite every Evidence item discussed");
    expect(prompts[0]).toContain("limited inline Markdown");

    const retried = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
      retryTargets: ["standby-wastage"],
    });
    expect(retried["standby-wastage"]).toMatchObject({ status: "available", attempt_count: 2 });
    expect(retried["centre-benchmark"]).toEqual(first["centre-benchmark"]);
    expect(retried["operating-behaviour"]).toEqual(first["operating-behaviour"]);
    expect(retried["planning-outlook"]).toEqual(first["planning-outlook"]);
    expect(prompts).toHaveLength(5);
    expect(prompts[4]).toContain('"sectionId":"standby-wastage"');
    expect(prompts[4]).not.toContain('"sectionId":"centre-benchmark"');
    harness.close();
  });

  it("records one honest shared transport failure when the batch Provider is unavailable", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async () => { throw new Error("PROVIDER_TRANSPORT_UNAVAILABLE"); },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId].status)).toEqual([
      "failed", "failed", "failed", "failed",
    ]);
    expect(new Set(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId].error_code))).toEqual(
      new Set(["PROVIDER_TRANSPORT_UNAVAILABLE"]),
    );
    harness.close();
  });

  it("persists empty as a successful result when a bounded Pack has no supported Evidence", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const planningPack = sectionPacks.find(({ sectionId }) => sectionId === "planning-outlook")!;
    planningPack.evidence = [];
    planningPack.missingEvidence = ["No compatible planning Evidence is available for this Snapshot."];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "planning-outlook"
            ? { sectionId, status: "empty" }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["planning-outlook"].status).toBe("available");
    expect(JSON.parse(result["planning-outlook"].result_json!)).toMatchObject({
      status: "empty",
      keyPoints: [],
    });
    harness.close();
  });

  it("allows ordinary Section prose containing the word from", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => ({
            ...available(sectionId),
            summary: "This pattern differs from typical peers and deserves review.",
          })),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId].status)).toEqual([
      "available", "available", "available", "available",
    ]);
    harness.close();
  });

  it("fails only a malformed item instead of rejecting the whole Provider envelope", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "operating-behaviour"
            ? { sectionId, status: "available", summary: "Supported summary", keyPoints: [] }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(result["operating-behaviour"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_MALFORMED",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["standby-wastage"].status).toBe("available");
    expect(result["planning-outlook"].status).toBe("available");
    harness.close();
  });

  it("rejects a number when the cited Evidence does not support the claimed unit", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const standbyPack = sectionPacks.find(({ sectionId }) => sectionId === "standby-wastage")!;
    standbyPack.evidence = [{
      id: "evidence:standby-wastage",
      label: "Verified standby spike count",
      value: { spikeCount: 2 },
      unit: "count",
      entityRefs: [],
      evidenceRefs: ["evidence:standby-wastage"],
    }];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "standby-wastage"
            ? {
                ...available(sectionId),
                keyPoints: [
                  { kind: "finding", text: "SGD 2 should be reviewed.", evidenceRefs: ["evidence:standby-wastage"] },
                  { kind: "next-check", text: "Confirm the operating context.", evidenceRefs: ["evidence:standby-wastage"] },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["standby-wastage"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    harness.close();
  });

  it("does not borrow a number from an uncited Evidence item in the same Section Pack", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const standbyPack = sectionPacks.find(({ sectionId }) => sectionId === "standby-wastage")!;
    standbyPack.evidence = [
      {
        id: "evidence:standby-spikes",
        label: "Verified standby spike count",
        value: { spikeCount: 2 },
        unit: "count",
        entityRefs: [],
        evidenceRefs: ["evidence:standby-spikes"],
      },
      {
        id: "evidence:standby-duration",
        label: "Verified standby duration",
        value: { durationMinutes: 9 },
        unit: "minutes",
        entityRefs: [],
        evidenceRefs: ["evidence:standby-duration"],
      },
    ];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "standby-wastage"
            ? {
                ...available(sectionId),
                keyPoints: [
                  { kind: "finding", text: "The 9 recorded spikes deserve attention.", evidenceRefs: ["evidence:standby-spikes"] },
                  { kind: "next-check", text: "Confirm the operating context.", evidenceRefs: ["evidence:standby-spikes"] },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["standby-wastage"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    harness.close();
  });

  it("accepts an exact local spike date and hour from the cited Evidence", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const operatingPack = sectionPacks.find(({ sectionId }) => sectionId === "operating-behaviour")!;
    operatingPack.evidence = [{
      id: "evidence:operating:n",
      label: "Centre N operating-hour spike",
      value: {
        centre: "Centre N",
        localDate: "2026-05-22",
        localHour: 15,
        leadingCircuitName: "Kitchen Plug Load",
        leadingCircuitSharePct: 96.4267,
      },
      unit: "kWh, %",
      entityRefs: ["centre-n"],
      evidenceRefs: ["evidence:operating:n"],
      claimRelations: [{ subject: "Centre N", predicate: "leading-circuit", object: "Kitchen Plug Load" }],
    }];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "operating-behaviour"
            ? {
                ...available(sectionId),
                summary: "Operating-hour evidence supports a focused review.",
                keyPoints: [
                  {
                    kind: "finding",
                    text: "At Centre N's worst operating-hour spike on 2026-05-22 at 15:00, Kitchen Plug Load was the leading contributor at 96.4%.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                  {
                    kind: "next-check",
                    text: "Review Centre N's operating schedule before assigning a cause.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["operating-behaviour"].status).toBe("available");
    harness.close();
  });

  it("rejects a local spike date or time that differs from the cited Evidence", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const operatingPack = sectionPacks.find(({ sectionId }) => sectionId === "operating-behaviour")!;
    operatingPack.evidence = [{
      id: "evidence:operating:n",
      label: "Centre N operating-hour spike",
      value: {
        centre: "Centre N",
        localDate: "2026-05-22",
        localHour: 15,
        leadingCircuitName: "Kitchen Plug Load",
      },
      unit: "kWh",
      entityRefs: ["centre-n"],
      evidenceRefs: ["evidence:operating:n"],
      claimRelations: [{ subject: "Centre N", predicate: "leading-circuit", object: "Kitchen Plug Load" }],
    }];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "operating-behaviour"
            ? {
                ...available(sectionId),
                summary: "Operating-hour evidence supports a focused review.",
                keyPoints: [
                  {
                    kind: "finding",
                    text: "Centre N's spike occurred on 2026-05-23 at 15:30 and was led by Kitchen Plug Load.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                  {
                    kind: "next-check",
                    text: "Review Centre N's operating schedule before assigning a cause.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["operating-behaviour"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED",
    });
    harness.close();
  });

  it("extracts a Provider-wrapped JSON envelope and keeps missing Sections independent", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: `I will now return the requested object.\n${JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS
            .filter((sectionId) => sectionId !== "operating-behaviour")
            .map((sectionId) => available(sectionId)),
        })}\nThe interpretation is complete.`,
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["standby-wastage"].status).toBe("available");
    expect(result["planning-outlook"].status).toBe("available");
    expect(result["operating-behaviour"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETER_RESPONSE_MALFORMED",
    });
    harness.close();
  });

  it("sends a bounded prompt projection rather than repeated runtime bindings", async () => {
    const harness = createHarness();
    const capturedPrompts = new Map<PreschoolSectionId, string>();
    const sectionPacks = packs();
    sectionPacks.find(({ sectionId }) => sectionId === "operating-behaviour")!.evidence[0]!.value = {
      centreCode: "N",
      name: "Centre N",
      spikeCount: 2,
      worstSpike: {
        usageKwh: 45.3308123,
        baselineKwh: 5.3667123,
        leadingCircuitName: "Kitchen Plug Load",
        leadingCircuitKwh: 43.711,
      },
    };
    sectionPacks.find(({ sectionId }) => sectionId === "planning-outlook")!.evidence[0]!.value = {
      plan: { usageEstimate: { projectedKwh: 26240.3992123 } },
      actual: { usageKwh: 5296.63 },
      forecast: {
        tariffAssumption: { beforeGstSgdPerKwh: 0.2727, sourceName: "SP Group" },
        portfolio: { pacePct: 88.79 },
      },
    };
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ identity, prompt, runId, sessionId }) => {
        capturedPrompts.set(identity.targetId as PreschoolSectionId, prompt);
        return {
          answer: JSON.stringify({ sections: PRESCHOOL_SECTION_IDS.map((sectionId) => available(sectionId)) }),
          runId,
          sessionId,
        };
      },
    });

    await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(capturedPrompts.size).toBe(4);
    const operatingPrompt = capturedPrompts.get("operating-behaviour")!;
    const planningPrompt = capturedPrompts.get("planning-outlook")!;
    expect([...capturedPrompts.values()].every((prompt) => prompt.length < 12_000)).toBe(true);
    expect([...capturedPrompts.values()].every((prompt) => !prompt.includes('"binding"'))).toBe(true);
    expect(operatingPrompt).toContain("exactly one complete bounded Section Pack projection");
    expect(operatingPrompt.match(/evidence:operating-behaviour/gu)).toHaveLength(1);
    expect(operatingPrompt).toContain('"usageKwh":45.3308');
    expect(operatingPrompt).toContain('"leadingCircuitName":"Kitchen Plug Load"');
    expect(operatingPrompt).not.toContain("baselineKwh");
    expect(operatingPrompt).not.toContain("evidence:planning-outlook");
    expect(planningPrompt).not.toContain("sourceName");
    expect(planningPrompt).toContain('"pageCoverage":["Verified Section evidence"]');
    harness.close();
  });

  it("rejects stale Pack bindings before queuing or calling the Provider", async () => {
    const harness = createHarness();
    let providerCalled = false;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async () => {
        providerCalled = true;
        throw new Error("unexpected");
      },
    });
    const stalePacks = packs();
    stalePacks[0] = {
      ...stalePacks[0]!,
      binding: { ...stalePacks[0]!.binding, dataSnapshotId: "snapshot-stale" },
    };

    await expect(interpreter.execute({
      baseIdentity: harness.identity,
      packs: stalePacks,
      user: harness.user,
    })).rejects.toThrow("PRESCHOOL_SECTION_PACK_IDENTITY_MISMATCH");
    expect(providerCalled).toBe(false);
    harness.close();
  });

  it("does not complete old-identity Artifacts when the model binding changes during the Provider run", async () => {
    const harness = createHarness();
    let runtimeRevision = 1;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      assertRuntimeIdentity: (identity) => {
        if (identity.modelProfileRevision !== runtimeRevision) {
          throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
        }
      },
      runBatch: async ({ runId, sessionId }) => {
        runtimeRevision = 2;
        return {
          answer: JSON.stringify({ sections: PRESCHOOL_SECTION_IDS.map((sectionId) => available(sectionId)) }),
          runId,
          sessionId,
        };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId])).toEqual(
      PRESCHOOL_SECTION_IDS.map(() => expect.objectContaining({
        status: "failed",
        error_code: "OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH",
      })),
    );
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId].result_json)).toEqual([
      undefined, undefined, undefined, undefined,
    ]);
    harness.close();
  });

  it("accepts comma-grouped numbers that exactly match cited Evidence", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const standbyPack = sectionPacks.find(({ sectionId }) => sectionId === "standby-wastage")!;
    standbyPack.evidence = [{
      id: "evidence:standby-wastage",
      label: "Verified standby usage",
      value: { usageKwh: 3103.78 },
      unit: "kWh",
      entityRefs: [],
      evidenceRefs: ["evidence:standby-wastage"],
    }];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "standby-wastage"
            ? {
                ...available(sectionId),
                summary: "Closed-hour usage was 3,103.78 kWh.",
                keyPoints: [
                  { kind: "finding", text: "The recorded usage was 3,103.78 kWh.", evidenceRefs: ["evidence:standby-wastage"] },
                  { kind: "next-check", text: "Confirm the operating context.", evidenceRefs: ["evidence:standby-wastage"] },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["standby-wastage"].status).toBe("available");
    harness.close();
  });

  it("accepts a bounded over-approximation within the cited Evidence hundred", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const standbyPack = sectionPacks.find(({ sectionId }) => sectionId === "standby-wastage")!;
    standbyPack.evidence = [{
      id: "evidence:standby-wastage",
      label: "Verified standby usage",
      value: { usageKwh: 3103.784 },
      unit: "kWh",
      entityRefs: [],
      evidenceRefs: ["evidence:standby-wastage"],
    }];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "standby-wastage"
            ? {
                ...available(sectionId),
                summary: "Closed-hours usage was over 3,100 kWh.",
                keyPoints: [
                  { kind: "finding", text: "Usage was over 3,100 kWh.", evidenceRefs: ["evidence:standby-wastage"] },
                  { kind: "next-check", text: "Confirm the operating context.", evidenceRefs: ["evidence:standby-wastage"] },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["standby-wastage"].status).toBe("available");
    harness.close();
  });

  it("rejects an over-approximation outside the cited Evidence hundred", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const standbyPack = sectionPacks.find(({ sectionId }) => sectionId === "standby-wastage")!;
    standbyPack.evidence = [{
      id: "evidence:standby-wastage",
      label: "Verified standby usage",
      value: { usageKwh: 3299.784 },
      unit: "kWh",
      entityRefs: [],
      evidenceRefs: ["evidence:standby-wastage"],
    }];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "standby-wastage"
            ? {
                ...available(sectionId),
                summary: "Closed-hours usage was over 3,100 kWh.",
                keyPoints: [
                  { kind: "finding", text: "Usage was over 3,100 kWh.", evidenceRefs: ["evidence:standby-wastage"] },
                  { kind: "next-check", text: "Confirm the operating context.", evidenceRefs: ["evidence:standby-wastage"] },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["standby-wastage"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED",
    });
    harness.close();
  });

  it("does not treat a hyphenated portfolio adjective as a Centre code", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "centre-benchmark"
            ? {
                ...available(sectionId),
                summary: "After normalising across the 30-centre portfolio, the pattern deserves review.",
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(result["centre-benchmark"].status).toBe("available");
    harness.close();
  });

  it("accepts multiple valid Centre-to-circuit relationships in one narrative", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const operatingPack = sectionPacks.find(({ sectionId }) => sectionId === "operating-behaviour")!;
    operatingPack.evidence = [
      {
        id: "evidence:operating:n",
        label: "Centre N operating spike",
        value: { centre: "Centre N", leadingCircuitName: "Kitchen Plug Load" },
        unit: "kWh",
        entityRefs: ["centre-n"],
        evidenceRefs: ["evidence:operating:n"],
        claimRelations: [{ subject: "Centre N", predicate: "leading-circuit", object: "Kitchen Plug Load" }],
      },
      {
        id: "evidence:operating:l",
        label: "Centre L operating spike",
        value: { centre: "Centre L", leadingCircuitName: "Heater" },
        unit: "kWh",
        entityRefs: ["centre-l"],
        evidenceRefs: ["evidence:operating:l"],
        claimRelations: [{ subject: "Centre L", predicate: "leading-circuit", object: "Heater" }],
      },
    ];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "operating-behaviour"
            ? {
                ...available(sectionId),
                summary: "Centre N was led by Kitchen Plug Load, while Centre L was led by Heater.",
                keyPoints: [
                  {
                    kind: "finding",
                    text: "Centre N was led by Kitchen Plug Load.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                  {
                    kind: "finding",
                    text: "Centre L was led by Heater.",
                    evidenceRefs: ["evidence:operating:l"],
                  },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["operating-behaviour"].status).toBe("available");
    harness.close();
  });

  it("rejects a Centre-to-circuit relationship not present in the cited Evidence", async () => {
    const harness = createHarness();
    const sectionPacks = packs();
    const operatingPack = sectionPacks.find(({ sectionId }) => sectionId === "operating-behaviour")!;
    operatingPack.evidence = [
      {
        id: "evidence:operating:n",
        label: "Centre N operating spike",
        value: { centre: "Centre N", leadingCircuitName: "Kitchen Plug Load" },
        unit: "kWh",
        entityRefs: ["centre-n"],
        evidenceRefs: ["evidence:operating:n"],
        claimRelations: [{ subject: "Centre N", predicate: "leading-circuit", object: "Kitchen Plug Load" }],
      },
      {
        id: "evidence:operating:l",
        label: "Centre L operating spike",
        value: { centre: "Centre L", leadingCircuitName: "Heater" },
        unit: "kWh",
        entityRefs: ["centre-l"],
        evidenceRefs: ["evidence:operating:l"],
        claimRelations: [{ subject: "Centre L", predicate: "leading-circuit", object: "Heater" }],
      },
    ];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "operating-behaviour"
            ? {
                ...available(sectionId),
                summary: "Operating-hour evidence supports a focused review.",
                keyPoints: [
                  {
                    kind: "finding",
                    text: "Centre N was led by Heater.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                  {
                    kind: "next-check",
                    text: "Review Centre N before assigning a cause.",
                    evidenceRefs: ["evidence:operating:n"],
                  },
                ],
              }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: sectionPacks,
      user: harness.user,
    });
    expect(result["operating-behaviour"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED",
    });
    harness.close();
  });
});

const available = (sectionId: PreschoolSectionId, evidenceRef = `evidence:${sectionId}`) => ({
  sectionId,
  status: "available",
  summary: "The verified evidence supports a focused management review.",
  keyPoints: [
    { kind: "finding", text: "The current pattern deserves attention.", evidenceRefs: [evidenceRef] },
    { kind: "next-check", text: "Confirm the operating context before assigning a cause.", evidenceRefs: [evidenceRef] },
  ],
});

const packs = (): PreschoolSectionPack[] => PRESCHOOL_SECTION_IDS.map((sectionId) => ({
  sectionId,
  audience: "non-technical energy manager",
  decisionQuestion: "What should the manager understand and check next?",
  binding: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  },
  evidence: [{
    id: `evidence:${sectionId}`,
    label: "Verified Section evidence",
    value: { supportedValue: 30 },
    entityRefs: [],
    evidenceRefs: [`evidence:${sectionId}`],
  }],
  dataQuality: { status: "complete" },
  limitations: [],
  missingEvidence: [],
  pageCoverage: ["Verified Section evidence"],
  allowedNextChecks: ["Confirm the operating context."],
}));

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-section-interpreter-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  return {
    metadata,
    identity: createOverviewAiArtifactIdentity({
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
    }),
    user: metadata.users.getById({ user_id: "dev-user" }),
    close: () => metadata.close(),
  };
};

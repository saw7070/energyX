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
import { PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3 } from "./preschool-overview-ai-structured-output.js";
import { createPreschoolSectionInterpreter } from "./preschool-section-interpreter.js";

const roots: string[] = [];
const closeStores: Array<() => void> = [];

afterEach(() => {
  for (const close of closeStores.splice(0)) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Section Interpreter run isolation", () => {
  it("gives every Section its own Run, Session, and self-contained single-Pack context", async () => {
    const harness = createHarness();
    const calls: Array<{ sectionId: PreschoolSectionId; prompt: string; runId: string; sessionId: string }> = [];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, prompt, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        calls.push({ sectionId, prompt, runId, sessionId });
        return { answer: JSON.stringify(available(sectionId)), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    expect(calls).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    expect(result["centre-benchmark"].error_code).toBeUndefined();
    expect(new Set(calls.map(({ runId }) => runId))).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    expect(new Set(calls.map(({ sessionId }) => sessionId))).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    for (const call of calls) {
      expect(call.prompt).toContain(`"sectionId":"${call.sectionId}"`);
      for (const sibling of PRESCHOOL_SECTION_IDS.filter((sectionId) => sectionId !== call.sectionId)) {
        expect(call.prompt).not.toContain(`"sectionId":"${sibling}"`);
      }
      expect(call.prompt).toContain('"audience":"non-technical energy manager"');
      expect(call.prompt).toContain('"dataQuality":{"status":"complete"}');
      expect(call.prompt).toContain('"pageCoverage":["Verified Section evidence"]');
      expect(call.prompt).toContain('"missingEvidence":[]');
      expect(call.prompt).toContain('"allowedNextChecks":["Confirm the operating context."]');
      expect(result[call.sectionId].status).toBe("available");
      expect(JSON.parse(result[call.sectionId].result_json!).runId).toBe(call.runId);
    }
    harness.close();
  });

  it("keeps a single Section transport failure from failing successful siblings", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        if (sectionId === "standby-wastage") throw new Error("PROVIDER_TRANSPORT_UNAVAILABLE");
        return { answer: JSON.stringify(available(sectionId)), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    expect(result["standby-wastage"]).toMatchObject({
      status: "failed",
      error_code: "PROVIDER_TRANSPORT_UNAVAILABLE",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["operating-behaviour"].status).toBe("available");
    expect(result["planning-outlook"].status).toBe("available");
    harness.close();
  });

  it("accepts one valuable Key Point and persists zero points only as empty", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? { sectionId, status: "empty", keyPoints: [] }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    for (const sectionId of PRESCHOOL_SECTION_IDS.filter((id) => id !== "planning-outlook")) {
      expect(result[sectionId].status).toBe("available");
      expect(JSON.parse(result[sectionId].result_json!).keyPoints).toHaveLength(1);
    }
    expect(JSON.parse(result["planning-outlook"].result_json!)).toMatchObject({
      status: "empty",
      keyPoints: [],
    });
    harness.close();
  });

  it("accepts an Evidence-bound priority Key Point instead of rejecting useful model judgment", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        return {
          answer: JSON.stringify({
            ...available(sectionId),
            keyPoints: [{
              kind: "priority",
              text: "Review the verified pattern before assigning a cause.",
              evidenceRefs: [`evidence:${sectionId}`],
            }],
          }),
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

    for (const sectionId of PRESCHOOL_SECTION_IDS) {
      expect(result[sectionId].error_code).toBeUndefined();
      expect(result[sectionId]).toMatchObject({ status: "available" });
      expect(JSON.parse(result[sectionId].result_json!).keyPoints[0].kind).toBe("priority");
    }
    harness.close();
  });

  it("advertises priority as a native structured-output Key Point kind", () => {
    const keyPointKind = PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3.schema
      .properties.keyPoints.items.properties?.kind;

    expect(keyPointKind?.enum).toContain("priority");
  });

  it("gives a retried Section bounded feedback about its previous validation failure", async () => {
    const harness = createHarness();
    const standbyPrompts: string[] = [];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, prompt, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        if (sectionId === "standby-wastage") standbyPrompts.push(prompt);
        const answer = sectionId === "standby-wastage" && standbyPrompts.length === 1
          ? {
              ...available(sectionId),
              keyPoints: [{
                kind: "finding",
                text: "Unsupported value 999 needs attention.",
                evidenceRefs: [`evidence:${sectionId}`],
              }],
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });
    const input = { baseIdentity: harness.identity, packs: packs(), user: harness.user };

    const first = await interpreter.execute(input);
    expect(first["standby-wastage"].error_code).toBe("PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED");

    const retried = await interpreter.execute({ ...input, retryTargets: ["standby-wastage"] });

    expect(retried["standby-wastage"].status).toBe("available");
    expect(standbyPrompts[1]).toContain("Previous attempt rejection: PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED");
    expect(standbyPrompts[1]).toContain("Do not repeat that rejected output");
    harness.close();
  });

  it("accepts a natural-language rendering of an exact Evidence date", async () => {
    const harness = createHarness();
    const datedPacks = packs().map((pack) => pack.sectionId === "planning-outlook"
      ? {
          ...pack,
          evidence: [{
            ...pack.evidence[0]!,
            value: { actualThroughLocalDate: "2026-06-07" },
          }],
        }
      : pack);
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? {
              sectionId,
              status: "available",
              summary: "As of 7 June 2026, the verified pattern deserves attention.",
              keyPoints: [{
                kind: "next-check",
                text: "After 7 June 2026, continue monitoring the verified pattern.",
                evidenceRefs: [`evidence:${sectionId}`],
              }],
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: datedPacks,
      user: harness.user,
    });

    expect(result["planning-outlook"].status).toBe("available");
    harness.close();
  });

  it("accepts exact tariff validity dates from a real Planning Outlook Evidence shape", async () => {
    const harness = createHarness();
    const datedPacks = packs().map((pack) => pack.sectionId === "planning-outlook"
      ? {
          ...pack,
          evidence: [{
            ...pack.evidence[0]!,
            value: {
              actualThroughLocalDate: "2026-06-07",
              tariffAssumption: {
                appliesFrom: "2026-04-01",
                appliesTo: "2026-06-30",
                beforeGstSgdPerKwh: 0.2727,
              },
            },
            unit: "SGD/kWh before GST",
          }],
        }
      : pack);
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? {
              sectionId,
              status: "available",
              summary: "The current pattern deserves management attention.",
              keyPoints: [{
                kind: "finding",
                text: "The tariff reference is 0.2727 SGD/kWh before GST from 1 April 2026 to 30 June 2026.",
                evidenceRefs: [`evidence:${sectionId}`],
              }],
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: datedPacks,
      user: harness.user,
    });

    expect(result["planning-outlook"]).toMatchObject({ status: "available" });
    harness.close();
  });

  it("accepts a month-and-year limitation when the cited Evidence contains a date in that month", async () => {
    const harness = createHarness();
    const datedPacks = packs().map((pack) => pack.sectionId === "operating-behaviour"
      ? {
          ...pack,
          evidence: [{
            ...pack.evidence[0]!,
            value: { localDate: "2026-05-22" },
          }],
        }
      : pack);
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "operating-behaviour"
          ? {
              ...available(sectionId),
              limitation: "The Evidence covers May 2026 and does not establish a seasonal pattern.",
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: datedPacks,
      user: harness.user,
    });

    expect(result["operating-behaviour"]).toMatchObject({ status: "available" });
    harness.close();
  });

  it("replays the first real Provider operating response without treating May 2026 as a new number", async () => {
    const harness = createHarness();
    const ref = (suffix: string) => `evidence:operating:${suffix}`;
    const operatingPacks = packs().map((pack) => pack.sectionId === "operating-behaviour"
      ? {
          ...pack,
          evidence: [
            {
              id: ref("n"), label: "Centre N operating spike",
              value: { centreCode: "N", name: "Centre N", worstSpike: { localDate: "2026-05-22", localHour: 15, usageKwh: 45.3308, impactKwh: 39.9641, leadingCircuitName: "Kitchen Plug Load" } },
              unit: "kWh", entityRefs: [], evidenceRefs: [ref("n")],
              claimRelations: [{ subject: "Centre N", predicate: "leading-circuit", object: "Kitchen Plug Load" }],
            },
            {
              id: ref("l"), label: "Centre L operating spike",
              value: { centreCode: "L", name: "Centre L", worstSpike: { localDate: "2026-05-19", localHour: 8, usageKwh: 30.847, impactKwh: 26.2093, leadingCircuitName: "Heater" } },
              unit: "kWh", entityRefs: [], evidenceRefs: [ref("l")],
              claimRelations: [{ subject: "Centre L", predicate: "leading-circuit", object: "Heater" }],
            },
            ...[
              ["Kitchen Plug Load", 3813.275, 17.4776, "appliance-1"],
              ["Plug Load3", 3770.7815, 17.2829, "appliance-2"],
              ["Living Area Plug Load", 3762.1959, 17.2435, "appliance-3"],
            ].map(([name, usageKwh, sharePct, suffix]) => ({
              id: ref(String(suffix)), label: `${name} contribution`,
              value: { name, usageKwh, sharePct, centreCount: 30 },
              unit: "kWh, %", entityRefs: [], evidenceRefs: [ref(String(suffix))],
            })),
          ],
        }
      : pack);
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "operating-behaviour"
          ? {
              sectionId,
              status: "available",
              summary: "Operating-hour energy shows notable spikes at a few Centres, mostly linked to plug-load circuits, which may warrant attention to scheduling or equipment behaviour.",
              keyPoints: [
                { kind: "finding", label: "High-impact spike at Centre N", text: "Centre N had a severe spike on 22 May 2026 at 15:00, with usage of 45.3308 kWh versus an impact of 39.9641 kWh, driven mainly by the Kitchen Plug Load circuit.", evidenceRefs: [ref("n")] },
                { kind: "finding", label: "Large spike at Centre L", text: "Centre L experienced a spike on 19 May 2026 at 08:00, with usage of 30.847 kWh and an impact of 26.2093 kWh, led by the Heater circuit.", evidenceRefs: [ref("l")] },
                { kind: "meaning", label: "Plug-load dominance", text: "Three plug-load categories—Kitchen Plug Load, Plug Load3, and Living Area Plug Load—each account for roughly 17% of operating-hour usage, suggesting plug-load equipment is a significant and consistent consumer across Centres.", evidenceRefs: [ref("appliance-1"), ref("appliance-2"), ref("appliance-3")] },
                { kind: "next-check", label: "Verify schedules", text: "Consider comparing operating schedules and leading appliance groups at the named Centres to determine whether these spikes reflect normal operations or an opportunity for adjustment.", evidenceRefs: [ref("n"), ref("l")] },
              ],
              limitation: "The data covers a single month (May 2026) and does not include a full year for seasonal context; spike causes are not confirmed beyond circuit-level attribution.",
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: operatingPacks,
      user: harness.user,
    });

    expect(result["operating-behaviour"]).toMatchObject({ status: "available" });
    harness.close();
  });

  it("rejects the real Planning retry when an energy pace percentage is also claimed for cost", async () => {
    const harness = createHarness();
    const planningPacks = packs().map((pack) => pack.sectionId === "planning-outlook"
      ? {
          ...pack,
          evidence: [{
            ...pack.evidence[0]!,
            value: {
              actual: { usageKwh: 5296.63, completeDayCount: 7, targetDayCount: 30 },
              forecast: {
                tariffAssumption: { beforeGstSgdPerKwh: 0.2727, appliesFrom: "2026-04-01", appliesTo: "2026-06-30" },
                portfolio: { actualCostBeforeGstSgd: 1444.39, actualThroughLocalDate: "2026-06-07", pacePct: 88.79 },
              },
            },
            unit: "kWh, %, SGD before GST",
          }],
        }
      : pack);
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? {
              sectionId,
              status: "available",
              summary: "Actual usage and cost are tracking at about 88.8% of the saved plan's expected pace through 7 June 2026.",
              keyPoints: [{
                kind: "meaning",
                text: "Through 7 June 2026, actual usage and cost are running at 88.79% of the plan's expected pace.",
                evidenceRefs: [`evidence:${sectionId}`],
              }],
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: planningPacks,
      user: harness.user,
    });

    expect(result["planning-outlook"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED",
    });
    harness.close();
  });

  it("rejects a contradictory empty response without affecting sibling Sections", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? { ...available(sectionId), status: "empty" }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    expect(result["planning-outlook"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_MALFORMED",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["standby-wastage"].status).toBe("available");
    expect(result["operating-behaviour"].status).toBe("available");
    harness.close();
  });

  it("uses Artifact claims to prevent concurrent ensure calls from duplicating child Runs", async () => {
    const harness = createHarness();
    const calls: PreschoolSectionId[] = [];
    let active = 0;
    let maxActive = 0;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        calls.push(sectionId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { answer: JSON.stringify(available(sectionId)), runId, sessionId };
      },
    });
    const input = { baseIdentity: harness.identity, packs: packs(), user: harness.user };

    await Promise.all([interpreter.execute(input), interpreter.execute(input)]);

    expect(calls).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    expect([...calls].sort()).toEqual([...PRESCHOOL_SECTION_IDS].sort());
    expect(maxActive).toBe(2);
    harness.close();
  });
});

const available = (sectionId: PreschoolSectionId) => ({
  sectionId,
  status: "available",
  summary: "The current pattern deserves management attention.",
  keyPoints: [{
    kind: "meaning",
    text: "Review the verified pattern before assigning a cause.",
    evidenceRefs: [`evidence:${sectionId}`],
  }],
});

const requireSectionId = (value: string | undefined): PreschoolSectionId => {
  if (!PRESCHOOL_SECTION_IDS.includes(value as PreschoolSectionId)) throw new Error("SECTION_ID_MISSING");
  return value as PreschoolSectionId;
};

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
  const root = mkdtempSync(join(tmpdir(), "preschool-section-isolation-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    metadata.close();
  };
  closeStores.push(close);
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
    close,
  };
};

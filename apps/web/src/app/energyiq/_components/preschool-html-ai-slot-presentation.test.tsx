/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiSlotHtmlArtifactIdentity } from "@datafoundry/contracts";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { PreschoolOverviewRenderer } from "./preschool-overview-renderer";
import type {
  PreschoolHtmlAiSlotPresentationId,
  PreschoolHtmlAiSlotRenderSet,
} from "./preschool-html-ai-slot-presentation";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

const slotIds = [
  "executive-summary",
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
  "additional-insight",
] as const satisfies readonly PreschoolHtmlAiSlotPresentationId[];

describe("Preschool whole-page HTML AI Slot comparison", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("replaces all six AI surfaces with one shared sandbox renderer", async () => {
    const snapshot = preschoolGoldenSnapshot();
    await act(async () => root.render(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        aiPresentationMode="html"
        htmlAiSlots={htmlSlots(snapshot)}
      />,
    ));

    const frames = [...container.querySelectorAll("iframe[data-ai-slot-html]")];
    expect(frames).toHaveLength(6);
    expect(frames.map((frame) => frame.getAttribute("data-ai-slot-html"))).toEqual(slotIds);
    expect(frames.every((frame) => frame.getAttribute("sandbox") === "")).toBe(true);
    expect(container.querySelectorAll("[data-ai-slot-html-rejection]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-benchmark-interpretation-status]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-standby-interpretation-status]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-operating-interpretation-status]")).toHaveLength(0);
    expect(container.querySelector("[data-preschool-overview='true']")).not.toBeNull();
    expect(container.textContent).toContain("Overall metrics");
    expect(container.textContent).toContain("Benchmark Analysis");
    expect(container.textContent).toContain("Monthly Energy Outlook");
  });

  it("falls back only the invalid Slot and keeps the other HTML Slots visible", async () => {
    const snapshot = preschoolGoldenSnapshot();
    const set = htmlSlots(snapshot);
    set["standby-wastage"] = {
      ...set["standby-wastage"]!,
      candidate: {
        ...(set["standby-wastage"]!.candidate as Record<string, unknown>),
        html: "<script>alert(1)</script>",
      },
    };
    await act(async () => root.render(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        aiPresentationMode="html"
        htmlAiSlots={set}
      />,
    ));

    expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(5);
    expect(container.querySelector("[data-ai-slot-html-rejection='AI_SLOT_HTML_UNSAFE']")).not.toBeNull();
    expect(container.textContent).toContain("Standby Energy Wastage");
    expect(container.textContent).toContain("No completed AI result was attached when this analysis was saved");
  });

  it("keeps technical claim-pruning IDs out of the customer Overview while sanitized HTML remains visible", async () => {
    const snapshot = preschoolGoldenSnapshot();
    const set = htmlSlots(snapshot);
    const warningClaims = {
      "centre-benchmark": [{ blockId: "html-block-19", reason: "unsupported-fact" as const }],
      "standby-wastage": [{ blockId: "html-block-10", reason: "unsupported-fact" as const }],
      "operating-behaviour": [{ blockId: "html-block-13", reason: "unsupported-fact" as const }],
      "additional-insight": [
        { blockId: "html-block-8", reason: "unsupported-causal-claim" as const },
        { blockId: "html-block-12", reason: "unsupported-fact" as const },
        { blockId: "html-structure-details-1", reason: "empty-structure" as const },
      ],
    } as const;
    for (const [slotId, droppedClaims] of Object.entries(warningClaims)) {
      set[slotId as keyof typeof set] = {
        ...set[slotId as keyof typeof set]!,
        acceptance: { status: "accepted_with_warnings", droppedClaims: [...droppedClaims] },
      };
    }
    await act(async () => root.render(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        aiPresentationMode="html"
        htmlAiSlots={set}
      />,
    ));

    expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(6);
    expect(container.querySelectorAll("[data-ai-slot-claim-warnings='true']")).toHaveLength(4);
    expect(container.textContent).toContain("AI presentation verified against the published Overview evidence");
    expect(container.textContent).not.toContain("unsupported-fact");
    expect(container.textContent).not.toContain("html-block-19");
    expect(container.querySelectorAll("[data-ai-slot-dropped-claims]")).toHaveLength(0);
  });
});

const htmlSlots = (snapshot: EnergyProjectAnalysisSnapshotDto): PreschoolHtmlAiSlotRenderSet =>
  Object.fromEntries(slotIds.map((slotId, index) => {
    const expectedIdentity: AiSlotHtmlArtifactIdentity = {
      workspaceId: snapshot.context.workspaceId,
      projectId: snapshot.context.projectId,
      scopeId: snapshot.context.scopeId,
      dataSnapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      analysisPeriod: {
        from: snapshot.context.primaryPeriod.start,
        to: snapshot.context.primaryPeriod.endExclusive,
      },
      modelProfileId: "workspace-default",
      modelProfileRevision: 1,
      promptRevision: "preschool-html-slot-prompt@10",
      slotDefinitionRevision: `preschool-${slotId}-html@2`,
    };
    const evidenceRef = `evidence:${slotId}:1`;
    return [slotId, {
      expectedIdentity,
      allowedEvidenceRefs: [evidenceRef],
      candidate: {
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId,
        identity: expectedIdentity,
        evidenceRefs: [evidenceRef],
        preferredHeightPx: 260 + (index * 20),
        html: `<section><h2>${slotId}</h2><p>Evidence-backed HTML presentation.</p></section>`,
      },
    }];
  })) as PreschoolHtmlAiSlotRenderSet;

// @vitest-environment happy-dom

import { act } from "react";
import React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { SandboxedAiSlotHtml } from "./sandboxed-ai-slot-html";

describe("SandboxedAiSlotHtml", () => {
  it("gives unstyled semantic Slot HTML a readable host-owned hierarchy", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SandboxedAiSlotHtml
      title="Executive summary"
      candidate={{
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId: "executive-summary",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-executive-summary-html@2",
        },
        evidenceRefs: ["evidence:usage"],
        html: '<article><h2>What deserves attention</h2><p><strong>12 kWh</strong> in the current period.</p><blockquote>Check the operating schedule first.</blockquote><table><caption>Current usage</caption><tbody><tr><th scope="row">Usage</th><td>12 kWh</td></tr></tbody></table><details><summary>Evidence</summary><p>Meter reading.</p></details></article>',
      }}
      expected={{
        slotId: "executive-summary",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-executive-summary-html@2",
        },
      }}
      allowedEvidenceRefs={["evidence:usage"]}
      fallback={<p>Structured fallback</p>}
    />));

    const srcdoc = container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("--slot-accent: #0f766e");
    expect(srcdoc).toContain("article, section { display: flow-root;");
    expect(srcdoc).toContain("h2 { font-size: clamp(1.25rem, 3vw, 1.75rem)");
    expect(srcdoc).toContain("strong { color: var(--slot-ink-strong)");
    expect(srcdoc).toContain("blockquote { margin:");
    expect(srcdoc).toContain("summary:focus-visible");
    expect(srcdoc).toContain("table { width: max-content !important;");
    expect(srcdoc).not.toContain("article article");
    await act(async () => root.unmount());
  });

  it("renders accepted HTML only in an opaque-origin sandbox iframe", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SandboxedAiSlotHtml
      title="Centre benchmark"
      candidate={{
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId: "centre-benchmark",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-centre-benchmark-html@2",
        },
        evidenceRefs: ["evidence:centre:g"],
        html: "<p>12 kWh</p>",
      }}
      expected={{
        slotId: "centre-benchmark",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-centre-benchmark-html@2",
        },
      }}
      allowedEvidenceRefs={["evidence:centre:g"]}
      fallback={<p>Structured fallback</p>}
    />));
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(container.textContent).not.toContain("12 kWh");
    await act(async () => root.unmount());
  });

  it.each(["desktop", "mobile"])("uses bounded scroll and width-bucket sizing for %s without trusting preferredHeightPx", async (viewport) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SandboxedAiSlotHtml
      title={`Responsive ${viewport}`}
      candidate={{
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId: "centre-benchmark",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-centre-benchmark-html@2",
        },
        evidenceRefs: ["evidence:centre:g"],
        preferredHeightPx: 1200,
        html: "<p>12 kWh</p>",
      }}
      expected={{
        slotId: "centre-benchmark",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-centre-benchmark-html@2",
        },
      }}
      allowedEvidenceRefs={["evidence:centre:g"]}
      fallback={<p>Structured fallback</p>}
    />));

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("data-ai-slot-height-contract")).toBe("bounded-scroll-width-bucket");
    expect(iframe?.className).toContain("sm:h-[min(65vh,640px)]");
    expect(iframe?.className).toContain("lg:h-[min(55vh,720px)]");
    expect(iframe?.getAttribute("style") ?? "").not.toContain("1200px");
    expect(iframe?.getAttribute("srcdoc")).toContain("overflow: auto");
    expect(iframe?.getAttribute("srcdoc")).toContain("overflow-x: auto");
    expect(iframe?.getAttribute("srcdoc")).toContain("overflow-y: hidden");
    expect(iframe?.getAttribute("srcdoc")).toContain('class="ai-slot-html-content"');
    expect(iframe?.getAttribute("srcdoc")).toContain(".ai-slot-html-content { width: 100%; max-width: none; margin-inline: 0;");
    expect(iframe?.getAttribute("srcdoc")).not.toContain("margin-inline: auto");
    expect(iframe?.getAttribute("srcdoc")).toContain("table { width: max-content !important; min-width: 100% !important; max-width: none !important;");
    await act(async () => root.unmount());
  });

  it("keeps long HTML vertically reachable while allowing wide tables to scroll on mobile", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SandboxedAiSlotHtml
      title="Mobile evidence table"
      candidate={{
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId: "centre-benchmark",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-centre-benchmark-html@2",
        },
        evidenceRefs: ["evidence:centre:g"],
        html: "<table><thead><tr><th>Centre</th><th>Long evidence label</th></tr></thead><tbody><tr><td>North</td><td>12 kWh</td></tr></tbody></table>" + "<p>" + "Long decision context. ".repeat(200) + "</p>",
      }}
      expected={{
        slotId: "centre-benchmark",
        identity: {
          workspaceId: "workspace-1",
          projectId: "preschool-demo",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          analysisPeriod: { from: "2026-06-01", to: "2026-07-01" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 4,
          promptRevision: "preschool-html-slot-prompt@10",
          slotDefinitionRevision: "preschool-centre-benchmark-html@2",
        },
      }}
      allowedEvidenceRefs={["evidence:centre:g"]}
      fallback={<p>Structured fallback</p>}
    />));

    const iframe = container.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("overflow: auto");
    expect(srcdoc).toContain("overflow-x: auto");
    expect(srcdoc).toContain('<div class="ai-slot-html-content"><table>');
    expect(srcdoc).toContain("Long decision context.");
    await act(async () => root.unmount());
  });
});

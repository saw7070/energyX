/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { buildExplorerNavigationNodes, ProjectTree } from "./project-explorer";
import { ExplorerMeterDetail } from "./explorer-meter-detail";
import { revealProjectTreeSelection } from "./project-tree-model";
import type {
  EnergyProjectNodeDto,
  EnergyScopeAnalysisDto,
} from "../../../lib/config-api";

it("expands DB to published circuit leaves including missing meters and restores leaf ancestors", async () => {
  vi.stubGlobal("React", React);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const nodes = buildExplorerNavigationNodes(
    [
      { id: "project", node_type: "project", name: "Office" },
      {
        id: "space",
        parent_id: "project",
        node_type: "space",
        name: "Space 1",
      },
      {
        id: "db",
        parent_id: "space",
        node_type: "distribution board",
        name: "DB1",
      },
    ] as EnergyProjectNodeDto[],
    [
      {
        id: "m1",
        name: "Lighting circuit",
        scopeId: "db",
        kind: "physical",
        role: "component",
        coverage: "partial",
        category: "light",
        includedInOfficialTotal: false,
      },
      {
        id: "m2",
        name: "Missing circuit",
        scopeId: "db",
        kind: "physical",
        role: "component",
        coverage: "partial",
        category: "load",
        includedInOfficialTotal: false,
      },
    ],
  );
  const div = document.createElement("div");
  const root = createRoot(div);
  const onSelect = vi.fn();
  const render = (expandedIds: Set<string>) =>
    root.render(
      <ProjectTree
        allNodes={nodes}
        nodes={nodes}
        selectedId="db"
        expandedIds={expandedIds}
        searchActive={false}
        snapshotHealthByNode={{}}
        onSelect={onSelect}
      />,
    );
  try {
    await act(async () => render(new Set(["project", "space"])));
    const db = [...div.querySelectorAll('[role="treeitem"]')].find((item) =>
      item.textContent?.includes("DB1"),
    )!;
    expect(db.getAttribute("aria-expanded")).toBe("false");
    expect(div.textContent).not.toContain("Lighting circuit");
    await act(async () => {
      (db as HTMLButtonElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith("db");
    await act(async () => render(new Set(["project", "space", "db"])));
    expect(div.textContent).toContain("Lighting circuit");
    expect(div.textContent).toContain("Missing circuit");
    const leaf = [...div.querySelectorAll('[role="treeitem"]')].find((item) =>
      item.textContent?.includes("Lighting circuit"),
    )!;
    expect(leaf.hasAttribute("aria-expanded")).toBe(false);
    await act(async () => {
      (leaf as HTMLButtonElement).click();
    });
    expect(onSelect).toHaveBeenLastCalledWith("meter:m1");
    expect([
      ...revealProjectTreeSelection(nodes, new Set(), "meter:m1").expandedIds,
    ]).toEqual(["db", "space", "project"]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows the selected circuit energy instead of its parent total, with missing and stale cases", () => {
  vi.stubGlobal("React", React);
  const meter = {
    id: "m1",
    name: "Lighting circuit",
    scopeId: "db",
    kind: "physical" as const,
    role: "component",
    coverage: "partial",
    category: "light",
    includedInOfficialTotal: false,
  };
  const analysis = {
    context: {
      scopeId: "db",
      from: "2026-09-01T16:00:00Z",
      to: "2026-09-02T16:00:00Z",
      timezone: "Asia/Singapore",
    },
    summary: { usageKwh: 999 },
    explorerMeters: [meter],
    circuits: [
      {
        meterNodeId: "m1",
        usageKwh: 12.5,
        peakKw: 0.8,
        dataHealth: { validIntervalCount: 96, coveragePct: 100 },
      },
    ],
  } as EnergyScopeAnalysisDto;
  const render = (data: EnergyScopeAnalysisDto) =>
    renderToStaticMarkup(
      <ExplorerMeterDetail
        meter={meter}
        analysis={data}
        loading={false}
        error={null}
        breadcrumbs={[]}
        onSelect={() => {}}
      />,
    );
  try {
    expect(render(analysis)).toContain("12.50 kWh");
    expect(render(analysis)).not.toContain("999");
    expect(render({ ...analysis, circuits: [] })).toContain("Missing readings");
    expect(render({ ...analysis, circuits: [] })).not.toContain("0.00 kWh");
    expect(render({ ...analysis, explorerMeters: [] })).toContain(
      "Reload Explorer",
    );
    expect(render({ ...analysis, explorerMeters: [] })).not.toContain(
      "12.50 kWh",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

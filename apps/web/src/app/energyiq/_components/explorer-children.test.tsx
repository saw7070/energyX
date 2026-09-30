/** @vitest-environment happy-dom */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { ExplorerChildren } from "./explorer-children";

it("shows attached meters without invented circuit nodes, official child totals and missing readings", () => {
  vi.stubGlobal("React", React);
  const nodes = [
    { id: "space", parentId: null, name: "Office" },
    { id: "db", parentId: "space", name: "DB1" },
  ];
  const analysis = {
    context: {from:"2026-09-01T00:00:00+08:00",to:"2026-09-02T00:00:00+08:00",timezone:"Asia/Singapore"},
    childScopes: [
      {
        nodeId: "db",
        usageKwh: 100,
        dataHealth: { validIntervalCount: 10, coveragePct: 90 },
      },
    ],
    circuits: [
      {
        meterNodeId: "main",
        usageKwh: 100,
        dataHealth: { validIntervalCount: 10, coveragePct: 90 },
      },
      {
        meterNodeId: "sub",
        usageKwh: 20,
        dataHealth: { validIntervalCount: 10, coveragePct: 90 },
      },
    ],
    explorerMeters: [
      {
        id: "main",
        name: "Published main name",
        scopeId: "db",
        kind: "physical",
        role: "total",
        coverage: "whole",
        category: "overall",
        includedInOfficialTotal: true,
      },
      {
        id: "sub",
        name: "Lighting",
        scopeId: "db",
        kind: "physical",
        role: "component",
        coverage: "partial",
        category: "light",
        includedInOfficialTotal: false,
      },
      {
        id: "missing",
        name: "Reference meter",
        scopeId: "db",
        kind: "physical",
        role: "standalone",
        coverage: "reference",
        category: "load",
        includedInOfficialTotal: false,
      },
      {
        id: "virtual",
        name: "Balance",
        scopeId: "db",
        kind: "virtual",
        role: "derived",
        coverage: "reference",
        category: "load",
        includedInOfficialTotal: false,
        formula: "Main − Lighting",
      },
    ],
    virtualMeterTraces: [
      { meterNodeId: "virtual", status: "partial", usageKwh: null },
    ],
  } as EnergyScopeAnalysisDto;
  try {
    const html = renderToStaticMarkup(
      <ExplorerChildren
        selectedId="space"
        nodes={nodes}
        analysis={analysis}
        loading={false}
        onSelect={() => {}}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.textContent).toContain("100.00 kWh · 90.0% coverage");
    expect(container.textContent).not.toContain("120.00");
    expect(container.textContent).toContain("Published main name");
    expect(container.textContent).toContain("Main / total");
    expect(container.textContent).toContain("Submeter / component");
    expect(container.textContent).toContain("Missing readings");
    expect(container.textContent).toContain("Inputs incomplete");
    expect(container.textContent).toContain("Excluded · detail only");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    const db = renderToStaticMarkup(
      <ExplorerChildren
        selectedId="db"
        nodes={nodes}
        analysis={{ ...analysis, childScopes: [] }}
        loading={false}
        onSelect={() => {}}
      />,
    );
    expect(db).toContain("Published main name");
    expect(db).not.toContain("No published meters attached");
  } finally {
    vi.unstubAllGlobals();
  }
});

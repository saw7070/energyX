/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EnergyProjectSetupDto } from "../../../lib/config-api";
import { ProjectConfigurationSummary } from "../_components/project-configuration-summary";

it("renders the saved draft as named hierarchy, meter ownership and calculations with bounded reference properties", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); const root = createRoot(container);
  const setup = { draft: { revision: 7, document: {
    project: { name: "Campus", timezone: "Asia/Singapore" }, tier_structure_locked: false,
    tiers: [{ id: "tier", ordinal: 1, alias: "Building" }],
    nodes: [
      { id: "n1", name: "Main campus", tier_definition_id: "tier", sort_order: 0, metadata_status: "confirmed", metadata: { opening_days: ["Monday", "Tuesday"], holiday: false, capacity: 0, deep: { a: { b: { hidden: "not rendered" } } } } },
      { id: "n2", name: "Science block", parent_id: "n1", tier_definition_id: "tier", sort_order: 0, metadata_status: "confirmed" },
      { id: "cycle", name: "Unresolved space", parent_id: "cycle", tier_definition_id: "tier", sort_order: 0, metadata_status: "provisional" }
    ],
    meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, rows: [
      { id: "m1", source_label: "source", display_name: "Main supply", scope_id: "n2", resource: "electricity", category: "overall", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
      { id: "m2", source_label: "source2", display_name: "Meter 03", presentation: { device_name: "Cooling", circuit_name: "L1P17" }, scope_id: "n2", resource: "electricity", category: "aircon", coverage: "partial", meter_role: "component", aggregation_usage: "excluded" }
    ], virtual_meters: [{ id: "v1", display_name: "Other loads", scope_id: "n2", resource: "electricity", category: "other", terms: [{ mapping_row_id: "m1", coefficient: 1 }, { mapping_row_id: "m2", coefficient: -1 }] }] }
  } } } as EnergyProjectSetupDto;
  try {
    await act(async () => root.render(<ProjectConfigurationSummary setup={setup} contextNotes={"## School context\n\n**Term dates** are reference only."} />));
    expect(container.textContent).toContain("Saved draft · Revision 7");
    expect(container.textContent).toContain("Project hierarchy · 3 entries");
    expect(container.querySelector("li li")?.textContent).toContain("Science block");
    expect(container.textContent).toContain("Unresolved space");
    expect(container.textContent).toContain("Meter ownership · 2 meters");
    expect(container.querySelector("tbody tr")?.textContent).toContain("Main supplyScience block");
    expect(container.textContent).toContain("Main supply − Cooling");
    expect(container.textContent).not.toContain("No structured calendar");
    expect(container.textContent).toContain("opening days: MondayTuesday");
    expect(container.textContent).toContain("holiday: false"); expect(container.textContent).toContain("capacity: 0");
    expect(container.textContent).not.toContain("not rendered");
    expect(container.querySelector("h2")?.textContent).toBe("School context");
    expect(container.textContent).not.toContain("##");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toContain('"mapping_row_id"');
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});


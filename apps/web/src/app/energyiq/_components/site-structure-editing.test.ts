import { describe, expect, it } from "vitest";
import type { EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { applyLocationEdit, applyMeterEdit, applyMeterMoves, locationRemoval, meterTotalProblems, withConfirmedTotals } from "./site-structure-editing";

const meter = (id: string, scope_id: string, extra: Record<string, unknown> = {}) => ({ id, source_label: `DB1 ${id}`, scope_id, navigation_scope_id: scope_id, display_name: id, resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official", ...extra });
const document = {
  project: { name: "Office", timezone: "Asia/Singapore" }, tier_structure_locked: true,
  tiers: [{ id: "space", ordinal: 2, alias: "Space" }, { id: "db", ordinal: 1, alias: "Distribution Board" }],
  nodes: [
    { id: "space-1", tier_definition_id: "space", name: "Space 1", sort_order: 10, metadata_status: "confirmed" },
    { id: "db1", tier_definition_id: "db", parent_id: "space-1", name: "DB1", sort_order: 10, metadata_status: "confirmed", area_sqm: 40 },
    { id: "db2", tier_definition_id: "db", parent_id: "space-1", name: "DB2", sort_order: 20, metadata_status: "confirmed" },
    { id: "space-2", tier_definition_id: "space", name: "Space 2", sort_order: 20, metadata_status: "confirmed" },
  ],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true,
    rows: [meter("light", "db1", { category: "light", presentation: { device_name: "DB1 L1 Light" } }), meter("power", "db1")],
    official_aggregation_routes: [{ scope_id: "db1", resource: "electricity", category: "load", meter_point_ids: ["power"] }] },
} as unknown as EnergyProjectSetupDocumentDto;

describe("in-page site structure edits", () => {
  it("renames a location, keeps optional facts explicit and rejects duplicate sibling names", () => {
    const renamed = applyLocationEdit(document, "office", { node: document.nodes[1]! }, { name: "  Pantry   board ", area: "", occupants: "6" });
    expect("error" in renamed ? renamed.error : renamed.document.nodes.find(node => node.id === "db1")).toEqual(expect.objectContaining({ name: "Pantry board", occupant_count: 6 }));
    expect("error" in renamed ? undefined : renamed.document.nodes.find(node => node.id === "db1")).not.toHaveProperty("area_sqm");
    expect(applyLocationEdit(document, "office", { node: document.nodes[1]! }, { name: "db2", area: "", occupants: "" })).toEqual({ error: "Another location here is already called db2." });
    expect(applyLocationEdit(document, "office", { node: document.nodes[1]! }, { name: "DB1", area: "-3", occupants: "" })).toHaveProperty("error");
    expect(applyLocationEdit(document, "office", { node: document.nodes[1]! }, { name: "DB1", area: "", occupants: "2.5" })).toHaveProperty("error");
  });

  it("adds a child location at the next level with the chosen name", () => {
    const created = applyLocationEdit(document, "office", { tierId: "db", parentId: "space-2" }, { name: "DB3", area: "12.5", occupants: "" });
    if ("error" in created) throw new Error(created.error);
    expect(created.document.nodes.find(node => node.id === created.nodeId)).toMatchObject({ name: "DB3", tier_definition_id: "db", parent_id: "space-2", area_sqm: 12.5, metadata_status: "provisional" });
  });

  it("keeps confirmed totals for a rename but requires a new check after moving or re-counting a meter", () => {
    const renamed = applyMeterEdit(document, document.meter_mapping!.rows[1]!, { name: "Pantry sockets", scopeId: "db1", category: "load", counted: true });
    if ("error" in renamed) throw new Error(renamed.error);
    expect(renamed.meter_mapping).toMatchObject({ confirmed: true, official_aggregation_routes: document.meter_mapping!.official_aggregation_routes });
    expect(renamed.meter_mapping!.rows[1]!.presentation).toEqual({ device_name: "Pantry sockets" });

    const moved = applyMeterEdit(document, document.meter_mapping!.rows[1]!, { name: "Pantry sockets", scopeId: "db2", category: "load", counted: true });
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.meter_mapping!.confirmed).toBe(false);
    expect(moved.meter_mapping!.rows[1]).toMatchObject({ scope_id: "db2", navigation_scope_id: "db2" });
    expect(moved.meter_mapping!.official_aggregation_routes).not.toEqual(document.meter_mapping!.official_aggregation_routes);

    const excluded = applyMeterEdit(document, document.meter_mapping!.rows[1]!, { name: "Pantry sockets", scopeId: "db1", category: "load", counted: false });
    expect("error" in excluded ? undefined : excluded.meter_mapping).toMatchObject({ confirmed: false });
    expect(applyMeterEdit(document, document.meter_mapping!.rows[1]!, { name: " ", scopeId: "db1", category: "load", counted: true })).toEqual({ error: "Enter a meter name." });
  });

  it("moves chosen meters into an empty location by hand, keeping their names and counting", () => {
    const moved = applyMeterMoves(document, ["light", "power"], "space-2");
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.meter_mapping!.rows.map(row => [row.id, row.scope_id, row.aggregation_usage])).toEqual([["light", "space-2", "official"], ["power", "space-2", "official"]]);
    expect(moved.meter_mapping!.rows[0]!.presentation).toEqual({ device_name: "DB1 L1 Light" });
    expect(moved.meter_mapping!.confirmed).toBe(false);
    expect(applyMeterMoves(document, [], "space-2")).toEqual({ error: "Tick at least one meter to move." });
    expect(applyMeterMoves(document, ["gone"], "space-2")).toEqual({ error: "A meter is no longer in this project. Refresh and try again." });
  });

  it("only removes a location once no meter is attached anywhere in its branch", () => {
    expect(locationRemoval(document, "space-1")).toEqual({ error: "Move its 2 meters to another location first." });
    const removed = locationRemoval(document, "db2");
    expect("error" in removed ? [] : removed.document.nodes.map(node => node.id)).toEqual(["space-1", "db1", "space-2"]);
  });
});

describe("going live without a separate confirmation", () => {
  it("confirms the totals itself when every area is still counted once", () => {
    const moved = applyMeterEdit(document, document.meter_mapping!.rows[1]!, { name: "Pantry sockets", scopeId: "db2", category: "load", counted: true });
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.meter_mapping!.confirmed).toBe(false);
    expect(meterTotalProblems(moved)).toEqual([]);
    expect(withConfirmedTotals(moved).meter_mapping!.confirmed).toBe(true);
  });

  it("leaves a real conflict unconfirmed, so it cannot go live by accident", () => {
    // Two meters both marked as the total for DB1's power: the board would be counted twice.
    const rows = document.meter_mapping!.rows.map(row => ({ ...row, category: "load", meter_role: "total", aggregation_usage: "official" }));
    const conflicted = { ...document, meter_mapping: { ...document.meter_mapping!, confirmed: false, rows,
      official_aggregation_routes: [{ scope_id: "db1", resource: "electricity", category: "load", meter_point_ids: rows.map(row => row.id) }] } } as typeof document;
    expect(meterTotalProblems(conflicted).length).toBeGreaterThan(0);
    expect(withConfirmedTotals(conflicted).meter_mapping!.confirmed).toBe(false);
  });

  it("leaves a meter with no location unconfirmed", () => {
    const orphaned = { ...document, nodes: document.nodes.filter(node => node.id !== "db1") } as typeof document;
    expect(meterTotalProblems(orphaned).some(problem => /location/i.test(problem))).toBe(true);
    expect(withConfirmedTotals({ ...orphaned, meter_mapping: { ...orphaned.meter_mapping!, confirmed: false } }).meter_mapping!.confirmed).toBe(false);
  });
});

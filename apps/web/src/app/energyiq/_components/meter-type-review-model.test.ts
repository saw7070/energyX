import { describe, expect, it } from "vitest";
import type { EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { applyMeterTypes, meterTypeChanges, meterTypeRows } from "./meter-type-review-model";

const meter = (id: string, scope_id: string, extra: Record<string, unknown> = {}) => ({ id, source_label: id, scope_id, navigation_scope_id: scope_id, display_name: id, resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official", ...extra });
// As Elite IOT is laid out: the main meter on the board, each circuit in its own location named after its equipment.
const document = {
  project: { name: "Elite IOT", timezone: "Asia/Singapore" }, tier_structure_locked: true,
  tiers: [{ id: "board", ordinal: 1, alias: "Board" }, { id: "circuit", ordinal: 2, alias: "Circuit" }],
  nodes: [
    { id: "main", tier_definition_id: "board", name: "Main distribution board", sort_order: 10, metadata_status: "confirmed" },
    { id: "b5b", tier_definition_id: "circuit", parent_id: "main", name: "B5B", sort_order: 10, metadata_status: "confirmed" },
    { id: "a18p", tier_definition_id: "circuit", parent_id: "main", name: "A18P", sort_order: 20, metadata_status: "confirmed" },
    { id: "b6b", tier_definition_id: "circuit", parent_id: "main", name: "B6B", sort_order: 30, metadata_status: "confirmed" },
    { id: "b2r", tier_definition_id: "circuit", parent_id: "main", name: "B2R", sort_order: 40, metadata_status: "confirmed" },
  ],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true,
    rows: [
      meter("incoming", "main", { category: "overall", meter_role: "total", coverage: "whole", aggregation_usage: "excluded", presentation: { device_name: "Incoming 3Phase" } }),
      meter("b5b", "b5b", { category: "other", presentation: { device_name: "B5B · Router, Modem, Server, IP Camera ×5, POE Switch" } }),
      meter("a18p", "a18p", { category: "other", presentation: { circuit_name: "A18P · Coffee machine, Warmer machine" } }),
      meter("b6b", "b6b", { category: "plug", presentation: { device_name: "B6B · Power Plug ×6" } }),
      meter("b2r", "b2r", { category: "other", presentation: { device_name: "B2R" } }),
    ],
    official_aggregation_routes: [] },
} as unknown as EnergyProjectSetupDocumentDto;

describe("sort meters by type", () => {
  it("suggests a type from each meter's equipment and leaves the main meter out", () => {
    const rows = meterTypeRows(document);
    expect(rows.map(row => row.id)).toEqual(["b5b", "a18p", "b6b", "b2r"]);
    expect(Object.fromEntries(rows.map(row => [row.id, row.suggested]))).toEqual({ b5b: "it", a18p: "kitchen", b6b: "plug", b2r: null });
    // Only meters whose suggestion differs from what they have now need a look.
    expect(meterTypeChanges(rows).map(row => row.id)).toEqual(["b5b", "a18p"]);
  });

  it("saves the chosen types like editing each meter by hand and leaves unchanged meters alone", () => {
    const next = applyMeterTypes(document, { b5b: "it", a18p: "kitchen", b6b: "plug" });
    if ("error" in next) throw new Error(next.error);
    const byId = new Map(next.meter_mapping!.rows.map(row => [row.id, row]));
    expect(byId.get("b5b")).toMatchObject({ category: "it", scope_id: "b5b", aggregation_usage: "official" });
    expect(byId.get("a18p")).toMatchObject({ category: "kitchen" });
    expect(byId.get("b6b")).toBe(document.meter_mapping!.rows[3]);
    expect(byId.get("incoming")).toMatchObject({ category: "overall" });
    expect(meterTypeChanges(meterTypeRows(next))).toEqual([]);
  });

  it("keeps the main meter as the site total and the board as the sum of its circuits after the change", () => {
    const next = applyMeterTypes(document, { b5b: "it", a18p: "kitchen" });
    if ("error" in next) throw new Error(next.error);
    const routes = next.meter_mapping!.official_aggregation_routes!;
    const at = (scope: string) => routes.filter(route => route.scope_id === scope).map(route => [route.category, route.meter_point_ids]);
    // A location may not hold a total and its parts at once; going live refuses that.
    expect(at("project")).toEqual([["overall", ["incoming"]]]);
    expect(at("main").map(([category]) => category).sort()).toEqual(["it", "kitchen", "other", "plug"]);
    expect(at("b5b")).toEqual([["it", ["b5b"]]]);
  });
});

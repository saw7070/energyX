import { describe, expect, it } from "vitest";
import type { EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { addGroup, groupChoices, metersInGroup, moveMetersToGroup, removeGroup, withoutEmptyLevels } from "./meter-groups-editing";
import { applyMeterEdit } from "./site-structure-editing";
import { projectMeterName, projectMeterSubtitle } from "./project-meter-name";

/** SKTC as the installer set it up: meters filed by the panel they are wired from. */
const document = {
  project: { name: "SKTC", timezone: "Asia/Singapore" }, tier_structure_locked: true,
  tiers: [{ id: "area", ordinal: 1, alias: "Area" }],
  nodes: [
    { id: "f", tier_definition_id: "area", name: "264F Area F", sort_order: 10, metadata_status: "confirmed" },
    { id: "e", tier_definition_id: "area", name: "264E Area E", sort_order: 20, metadata_status: "confirmed" },
  ],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, rows: [
    { id: "sign", source_label: "sign", display_name: "sign", presentation: { device_name: "264F Compassvale Bow signboard" }, scope_id: "f", navigation_scope_id: "f", resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
    { id: "lobby", source_label: "lobby", display_name: "lobby", presentation: { device_name: "264F GF Lobby Lighting" }, scope_id: "f", navigation_scope_id: "f", resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
    { id: "chute", source_label: "chute", display_name: "chute", presentation: { device_name: "264E Rubbish chute lamp" }, scope_id: "e", navigation_scope_id: "e", resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
  ], official_aggregation_routes: [] },
} as unknown as EnergyProjectSetupDocumentDto;

const created = (result: ReturnType<typeof addGroup>) => { if ("error" in result) throw new Error(result.error); return result; };

describe("creating, nesting and removing groups", () => {
  it("creates a top-level group on the top level", () => {
    const { document: next, nodeId } = created(addGroup(document, "sktc", { name: "  Common   area " }));
    expect(next.nodes.find(node => node.id === nodeId)).toEqual(expect.objectContaining({ name: "Common area", tier_definition_id: "area" }));
    expect(next.nodes.find(node => node.id === nodeId)).not.toHaveProperty("parent_id");
  });

  it("puts a group inside one on the lowest level by adding a level below it", () => {
    const common = created(addGroup(document, "sktc", { name: "Common area" }));
    const entrance = created(addGroup(common.document, "sktc", { name: "Entrance", parentId: common.nodeId }));
    const node = entrance.document.nodes.find(item => item.id === entrance.nodeId)!;
    expect(node.parent_id).toBe(common.nodeId);
    const tier = entrance.document.tiers.find(item => item.id === node.tier_definition_id)!;
    expect(tier).toEqual(expect.objectContaining({ ordinal: 1, alias: "Group" }));
    expect(entrance.document.tiers.find(item => item.id === "area")!.ordinal).toBe(2);
    // A second group inside reuses that level.
    const pavilion = created(addGroup(entrance.document, "sktc", { name: "Pavilion", parentId: common.nodeId }));
    expect(pavilion.document.tiers).toHaveLength(2);
    expect(groupChoices(pavilion.document).map(choice => choice.label)).toEqual(["264F Area F", "264E Area E", "Common area", "Common area / Entrance", "Common area / Pavilion"]);
  });

  it("refuses an empty name, a name already used beside it, and an eighth level", () => {
    expect(addGroup(document, "sktc", { name: " " })).toEqual({ error: "Enter a name." });
    expect(addGroup(document, "sktc", { name: "264f area f" })).toEqual({ error: "Another group here is already called 264f area f." });
    let next = document, parentId = "f";
    for (let level = 2; level <= 7; level += 1) { const result = created(addGroup(next, "sktc", { name: `Level ${level}`, parentId })); next = result.document; parentId = result.nodeId; }
    expect(addGroup(next, "sktc", { name: "Too deep", parentId })).toEqual({ error: "Groups can only go 7 levels deep." });
    expect(addGroup(next, "sktc", { name: "太深", parentId }, "zh-Hans")).toEqual({ error: "分组最多只能有 7 层。" });
  });

  it("removes only an empty group, and the level it leaves empty", () => {
    const common = created(addGroup(document, "sktc", { name: "Common area" }));
    const entrance = created(addGroup(common.document, "sktc", { name: "Entrance", parentId: common.nodeId }));
    expect(removeGroup(entrance.document, "f")).toEqual({ error: "Move its 2 meters to another group first." });
    const removed = removeGroup(entrance.document, entrance.nodeId);
    if ("error" in removed) throw new Error(removed.error);
    expect(removed.document.nodes.map(node => node.name)).toEqual(["264F Area F", "264E Area E", "Common area"]);
    expect(removed.document.tiers).toEqual([expect.objectContaining({ id: "area", ordinal: 1 })]);
    expect(withoutEmptyLevels(removed.document)).toBe(removed.document);
  });
});

describe("moving meters into groups", () => {
  it("counts a moved meter only in its new group and keeps the panel it is wired from as a detail", () => {
    const common = created(addGroup(document, "sktc", { name: "Common area" }));
    const entrance = created(addGroup(common.document, "sktc", { name: "Entrance", parentId: common.nodeId }));
    const moved = moveMetersToGroup(entrance.document, ["sign"], entrance.nodeId);
    if ("error" in moved) throw new Error(moved.error);
    const sign = moved.meter_mapping!.rows.find(row => row.id === "sign")!;
    expect(sign).toEqual(expect.objectContaining({ scope_id: entrance.nodeId, navigation_scope_id: entrance.nodeId }));
    expect(sign.presentation).toEqual({ device_name: "264F Compassvale Bow signboard", panel: "264F Area F" });
    const routes = moved.meter_mapping!.official_aggregation_routes!;
    const membersOf = (scopeId: string) => routes.filter(route => route.scope_id === scopeId).flatMap(route => route.meter_point_ids);
    expect(membersOf("f")).toEqual(["lobby"]);
    expect(membersOf(entrance.nodeId)).toEqual(["sign"]);
    expect(membersOf(common.nodeId)).toEqual(["sign"]);
    expect(membersOf("project").sort()).toEqual(["chute", "lobby", "sign"]);
    expect(metersInGroup(moved, common.nodeId)).toBe(1);
    expect(metersInGroup(moved, "f")).toBe(1);
    // Moving it again keeps the panel it was first wired from.
    const again = moveMetersToGroup(moved, ["sign"], "e");
    if ("error" in again) throw new Error(again.error);
    expect(again.meter_mapping!.rows.find(row => row.id === "sign")!.presentation?.panel).toBe("264F Area F");
  });

  it("refuses a move with nothing chosen or to a group that is gone", () => {
    expect(moveMetersToGroup(document, [], "f")).toEqual({ error: "Tick at least one meter to move." });
    expect(moveMetersToGroup(document, ["sign"], "missing")).toEqual({ error: "Choose a group for this meter." });
  });
});

describe("short names", () => {
  it("shows a short name first with the installer's full label underneath, and clears back to the full label", () => {
    const meter = document.meter_mapping!.rows[0]!;
    const named = applyMeterEdit(document, meter, { name: "264F Compassvale Bow signboard", shortName: "  Entrance  sign ", scopeId: "f", category: "light", counted: true });
    if ("error" in named) throw new Error(named.error);
    const row = named.meter_mapping!.rows[0]!;
    expect(row.presentation).toEqual({ device_name: "264F Compassvale Bow signboard", short_name: "Entrance sign" });
    expect(projectMeterName(row)).toBe("Entrance sign");
    expect(projectMeterSubtitle(row)).toBe("264F Compassvale Bow signboard");
    // A rename-only edit keeps the confirmed totals.
    expect(named.meter_mapping!.confirmed).toBe(true);
    const cleared = applyMeterEdit(named, row, { name: "264F Compassvale Bow signboard", shortName: "", scopeId: "f", category: "light", counted: true });
    if ("error" in cleared) throw new Error(cleared.error);
    expect(projectMeterName(cleared.meter_mapping!.rows[0]!)).toBe("264F Compassvale Bow signboard");
    expect(projectMeterSubtitle(cleared.meter_mapping!.rows[0]!)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import {
  arrangeChangesNothing, arrangeGroups, detectLayout, floorPlanWithGroupAreas, groupPath, headerRole, matchRows, matchScore, matchSummary,
  parseDelimitedText, previewTree, readRows, sheetFromCells, templateCsv, withColumnRole, withPick, type ArrangeRow,
} from "./spreadsheet-arrange-model";
import { planFromReference, referenceFromPlan, starterPlan, type StoredSpatialReference } from "./floor-plan-model";

/**
 * A made-up estate laid out the way a site started from Tuya is: one group per block, and a name used in both blocks
 * carries the block in front ("12A Emergency Lighting").
 */
const meter = (id: string, name: string, scope: string, extra: Record<string, unknown> = {}) => ({
  id, source_label: name, display_name: name, presentation: { device_name: name }, scope_id: scope, navigation_scope_id: scope,
  resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official", ...extra,
});
const estate = () => ({
  project: { name: "Maple Court", timezone: "Asia/Singapore" }, tier_structure_locked: true,
  tiers: [{ id: "block", ordinal: 1, alias: "Block" }],
  nodes: [
    { id: "a", tier_definition_id: "block", name: "12A", sort_order: 10, metadata_status: "confirmed" },
    { id: "b", tier_definition_id: "block", name: "12B", sort_order: 20, metadata_status: "confirmed" },
    { id: "c", tier_definition_id: "block", name: "12C", sort_order: 30, metadata_status: "confirmed" },
  ],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, official_aggregation_routes: [], virtual_meters: [], rows: [
    meter("a-lobby", "12A GF Lobby Lighting", "a"),
    meter("a-emergency", "12A Emergency Lighting", "a"),
    meter("a-gate", "Garden Gate Entrance Lighting", "a"),
    meter("b-lobby", "12B GF Lobby Lighting", "b"),
    meter("b-emergency", "12B Emergency Lighting", "b"),
    meter("b-bin", "Rubish Bin Lamp", "b"),
    meter("c-gazebo", "Gazebo DL & Fan", "c"),
    meter("c-walk", "Gazebo walkway 1", "c"),
  ] },
}) as unknown as EnergyProjectSetupDocumentDto;

const row = (meterName: string, path: string[] = [], extra: Partial<ArrangeRow> = {}): ArrangeRow => ({ row: 2, path, meterName, deviceName: "", shortName: "", ...extra });
const ok = <T,>(value: T | { error: string }): T => { if (value && typeof value === "object" && "error" in value) throw new Error(value.error); return value as T; };

describe("recognising columns", () => {
  it("knows the headings in English and their common variants", () => {
    expect(["Group", "Meter name", "Short name"].map(headerRole)).toEqual(["group", "meter", "short"]);
    expect(["Block Number", "Blk", "Building", "Floor", "Level 2", "Area", "Zone", "Location", "Sub-group", "Group 2", "Group path"].map(headerRole)).toEqual(Array(11).fill("group"));
    expect(["Tuya device name", "Device", "Device Name"].map(headerRole)).toEqual(["device", "device", "device"]);
    expect(["Meter", "Name", "Meter label", "Circuit"].map(headerRole)).toEqual(Array(4).fill("meter"));
    expect(["Short", "Nickname", "Display name", "Short name (optional)", "Group:"].map(headerRole)).toEqual(["short", "short", "short", "short", "group"]);
    // Chinese and Malay headings.
    expect(["分组", "电表名称", "简称", "Kumpulan", "Nama meter", "Nama pendek"].map(headerRole)).toEqual(["group", "meter", "short", "group", "meter", "short"]);
    // Descriptions and IDs are not groups or names.
    expect(["Meter Tracking Location", "Meter Device ID", "Device ID", "Tuya App Energy Reading", "kWh per day", ""].map(headerRole)).toEqual(Array(6).fill("ignore"));
  });

  it("skips a title row, finds the headings and never takes the device ID column as a name", () => {
    const cells = sheetFromCells([
      ["Maple Court Meter Layout", null, null, null, null],
      [null, "Block Number", "Meter Name", "Meter Device ID", "Meter Tracking Location"],
      [null, "12A", null, null, null],
      [null, null, "GF Lobby Lighting", "bf0a1b2c3d4e5f6a7b8c9d", "Ground floor lobby"],
    ]);
    const layout = detectLayout(cells, estate().meter_mapping!.rows)!;
    expect(layout.headerRow).toBe(1);
    expect(layout.columns.map(column => [column.header, column.role, column.idColumn])).toEqual([
      ["Block Number", "group", false], ["Meter Name", "meter", false], ["Meter Device ID", "ignore", true], ["Meter Tracking Location", "ignore", false],
    ]);
  });

  it("sets a block column aside when a Group column already gives the whole path", () => {
    const cells = [["Block Number", "Group", "Meter Name"], ["12A", "Block 12A > Ground floor", "GF Lobby Lighting"], ["12A", "Block 12A", "Emergency Lighting"], ["12C", "Common area > Gazebo", "Gazebo DL & Fan"]];
    const layout = detectLayout(cells)!;
    expect(layout.columns.map(column => column.role)).toEqual(["ignore", "group", "meter"]);
    expect(readRows(cells, layout).map(item => item.path)).toEqual([["Block 12A", "Ground floor"], ["Block 12A"], ["Common area", "Gazebo"]]);
    // Separate level columns with no ">" are all kept.
    expect(detectLayout([["Block", "Floor", "Meter"], ["Block 12A", "Ground floor", "GF Lobby Lighting"]])!.columns.map(column => column.role)).toEqual(["group", "group", "meter"]);
  });

  it("uses the column of meter names when nothing is headed as one, and lets a role move to another column", () => {
    const cells = [["Where", "What"], ["Common area > Gazebo", "Gazebo DL & Fan"], ["Common area > Gazebo", "Gazebo walkway 1"]];
    const layout = detectLayout(cells, estate().meter_mapping!.rows)!;
    expect(layout.columns.map(column => column.role)).toEqual(["ignore", "meter"]);
    const changed = withColumnRole(withColumnRole(layout, 0, "group"), 0, "meter");
    // Only one column holds the meter names.
    expect(changed.columns.map(column => column.role)).toEqual(["meter", "ignore"]);
  });
});

describe("reading the file", () => {
  it("reads CSV with quotes, commas and line breaks, semicolon lists and tab-separated cells", () => {
    expect(parseDelimitedText('﻿Group,Meter name\r\n"Common area > Gazebo","Gazebo DL & Fan, ""main"""\r\n')).toEqual([["Group", "Meter name"], ["Common area > Gazebo", 'Gazebo DL & Fan, "main"']]);
    expect(parseDelimitedText('Group;Meter name\n"Block A\nNorth";Lobby')).toEqual([["Group", "Meter name"], ["Block A North", "Lobby"]]);
    expect(parseDelimitedText("Group\tMeter name\nBlock A\tLobby, west")).toEqual([["Group", "Meter name"], ["Block A", "Lobby, west"]]);
    expect(sheetFromCells([["Gazebo DL &amp; Fan", 4, null]], { decodeXml: true })).toEqual([["Gazebo DL & Fan", "4", ""]]);
  });

  it("splits a path written with > into groups inside groups", () => {
    const cells = [["Group", "Meter name", "Short name"], ["Block 12A > Ground floor", "12A GF Lobby Lighting", "Lift lobby 1"], ["Common area>Gazebo › Seats", "Gazebo DL & Fan", ""]];
    const rows = readRows(cells, detectLayout(cells)!);
    expect(rows).toEqual([
      { row: 2, path: ["Block 12A", "Ground floor"], meterName: "12A GF Lobby Lighting", deviceName: "", shortName: "Lift lobby 1" },
      { row: 3, path: ["Common area", "Gazebo", "Seats"], meterName: "Gazebo DL & Fan", deviceName: "", shortName: "" },
    ]);
  });

  it("reads separate group columns left to right, blocks named once above their meters and merged cells", () => {
    const cells = [
      ["Block", "Floor", "Meter name"],
      ["Block 12A", "", ""],
      ["", "Ground floor", "12A GF Lobby Lighting"],
      ["", "", "12A Emergency Lighting"],
      ["Common area", "", "Gazebo DL & Fan"],
      ["", "Gazebo", "Gazebo walkway 1"],
      ["Common area", "Common area", "Garden Gate Entrance Lighting"],
    ];
    expect(readRows(cells, detectLayout(cells)!).map(item => item.path)).toEqual([
      ["Block 12A", "Ground floor"],
      ["Block 12A", "Ground floor"],
      // A group given on the left starts afresh: the floor above is not carried into Common area.
      ["Common area"],
      ["Common area", "Gazebo"],
      ["Common area"],
    ]);
  });

  it("leaves out notes typed below the last device ID", () => {
    const cells = sheetFromCells([
      ["Block Number", "Meter Name", "Meter Device ID"],
      ["12A", null, null],
      [null, "GF Lobby Lighting", "bf0a1b2c3d4e5f6a7b8c9d"],
      [null, "Emergency Lighting", "bf9a8b7c6d5e4f3a2b1c0d"],
      ["Questions for the report:", null, null],
      [null, "Which block uses more?", null],
    ]);
    expect(readRows(cells, detectLayout(cells)!).map(item => [item.path, item.meterName])).toEqual([[["12A"], "GF Lobby Lighting"], [["12A"], "Emergency Lighting"]]);
  });
});

describe("matching rows to meters", () => {
  const meters = estate().meter_mapping!.rows;
  const byId = (id: string) => meters.find(item => item.id === id)!;

  it("scores the Tuya device name first, then the exact name, the block in front, loose and fuzzy names", () => {
    expect(matchScore(row("", [], { deviceName: "12A GF Lobby Lighting" }), byId("a-lobby"))).toBe(1);
    expect(matchScore(row("12a  gf lobby LIGHTING"), byId("a-lobby"))).toBe(0.99);
    expect(matchScore(row("Emergency Lighting", ["Block 12A", "Emergency lights"]), byId("a-emergency"))).toBe(0.97);
    expect(matchScore(row("Gazebo DL and Fan"), byId("c-gazebo"))).toBe(0.94);
    const typo = matchScore(row("Rubbish Bin Lamp"), byId("b-bin"));
    expect(typo).toBeGreaterThan(0.6);
    expect(typo).toBeLessThan(0.92);
    expect(matchScore(row("Swimming pool pump"), byId("b-bin"))).toBe(0);
  });

  it("matches each meter once, says how sure it is, and lists what matched nothing", () => {
    const rows = [
      row("GF Lobby Lighting", ["Block 12A", "Ground floor"]),
      row("GF Lobby Lighting", ["Block 12B", "Ground floor"]),
      row("Gazebo DL and Fan", ["Common area", "Gazebo"]),
      row("Rubbish Bin Lamp", ["Common area", "Driveway"]),
      row("Swimming pool pump", ["Common area", "Pool"]),
      // The same meter again: the first row keeps it.
      row("GF Lobby Lighting", ["Block 12A"]),
    ];
    const document = estate();
    const matches = matchRows(rows, document);
    expect(matches.map(match => [match.meterId, match.confidence])).toEqual([
      ["a-lobby", "exact"], ["b-lobby", "exact"], ["c-gazebo", "close"], ["b-bin", "guess"], [null, null], [null, null],
    ]);
    const summary = matchSummary(rows, matches, document);
    expect(summary).toEqual(expect.objectContaining({ total: 8, matched: 4, guesses: 1 }));
    expect(summary.unmatchedRows.map(item => item.meterName)).toEqual(["Swimming pool pump", "GF Lobby Lighting"]);
    expect(summary.notInFile.map(item => item.id)).toEqual(["a-emergency", "a-gate", "b-emergency", "c-walk"]);
  });

  it("calls two equally good meters a best guess unless their current group tells them apart", () => {
    const document = estate();
    const twins = { ...document, meter_mapping: { ...document.meter_mapping!, rows: [meter("x", "Emergency Lighting", "a"), meter("y", "Emergency Lighting", "b")] } } as EnergyProjectSetupDocumentDto;
    expect(matchRows([row("Emergency Lighting", ["12B"])], twins)).toEqual([{ meterId: "y", confidence: "exact", score: 0.99 }]);
    expect(matchRows([row("Emergency Lighting", ["Common area"])], twins)[0]!.confidence).toBe("guess");
  });

  it("takes a person's pick over the automatic match and moves that meter off any other row", () => {
    const rows = [row("12A GF Lobby Lighting"), row("Lobby")];
    const matches = matchRows(rows, estate());
    expect(matches.map(match => match.meterId)).toEqual(["a-lobby", null]);
    const picked = withPick(matches, 1, "a-lobby");
    expect(picked.map(match => [match.meterId, match.confidence])).toEqual([[null, null], ["a-lobby", "picked"]]);
    expect(withPick(picked, 1, null)[1]).toEqual({ meterId: null, confidence: null, score: 0 });
  });
});

describe("the change", () => {
  const rows = [
    row("GF Lobby Lighting", ["Block 12A", "Ground floor"], { shortName: "Lift lobby 1" }),
    row("Emergency Lighting", ["Block 12A"], { shortName: "Emergency lights" }),
    row("Gazebo DL & Fan", ["Common area", "Gazebo"], { shortName: "Gazebo" }),
    row("Gazebo walkway 1", ["common AREA", "gazebo"], { shortName: "" }),
    row("Garden Gate Entrance Lighting", [], { shortName: "Entrance" }),
  ];

  it("creates the groups, moves the meters, sets short names, and removes nothing it was not asked to", () => {
    const document = estate();
    const matches = matchRows(rows, document);
    const result = ok(arrangeGroups(document, "maple", rows, matches, { removeEmptied: false }));
    expect(result.created.map(item => item.path.join(" / "))).toEqual(["Block 12A", "Block 12A / Ground floor", "Common area", "Common area / Gazebo"]);
    expect(result.moved.map(item => [item.meterId, item.from.join(" / "), item.to.join(" / ")])).toEqual([
      ["a-lobby", "12A", "Block 12A / Ground floor"], ["a-emergency", "12A", "Block 12A"], ["c-gazebo", "12C", "Common area / Gazebo"], ["c-walk", "12C", "Common area / Gazebo"],
    ]);
    expect(result.shortNames).toEqual([{ meterId: "a-lobby", name: "Lift lobby 1" }, { meterId: "a-emergency", name: "Emergency lights" }, { meterId: "c-gazebo", name: "Gazebo" }, { meterId: "a-gate", name: "Entrance" }]);
    const after = result.document.meter_mapping!.rows;
    // Nothing is deleted: every meter is still there, the gate meter keeps its group, and the old block is kept as its panel.
    expect(after.map(item => item.id).sort()).toEqual(document.meter_mapping!.rows.map(item => item.id).sort());
    expect(after.find(item => item.id === "a-gate")).toEqual(expect.objectContaining({ scope_id: "a", presentation: { device_name: "Garden Gate Entrance Lighting", short_name: "Entrance" } }));
    const lobby = after.find(item => item.id === "a-lobby")!;
    expect(groupPath(result.document, lobby.scope_id)).toEqual(["Block 12A", "Ground floor"]);
    expect(lobby.presentation).toEqual({ device_name: "12A GF Lobby Lighting", short_name: "Lift lobby 1", panel: "12A" });
    // 12C held only the gazebo meters, so it is empty now; it stays until asked.
    expect(result.emptied).toEqual([{ id: "c", path: ["12C"] }]);
    expect(result.removed).toEqual([]);
    expect(result.document.nodes.some(node => node.id === "c")).toBe(true);
    expect(arrangeChangesNothing(result)).toBe(false);
    expect(previewTree(result).map(group => [group.name, group.isNew, group.meters.length, group.children.map(child => child.name)])).toEqual([
      ["12A", false, 1, []], ["12B", false, 3, []], ["12C", false, 0, []], ["Block 12A", true, 1, ["Ground floor"]], ["Common area", true, 0, ["Gazebo"]],
    ]);
  });

  it("removes groups it leaves empty only when asked, and reuses groups that already exist", () => {
    const document = estate();
    const result = ok(arrangeGroups(document, "maple", rows, matchRows(rows, document), { removeEmptied: true }));
    expect(result.removed).toEqual(["c"]);
    expect(result.document.nodes.map(node => node.name)).not.toContain("12C");
    expect(result.document.meter_mapping!.rows).toHaveLength(8);
    // Applying the same file again changes nothing.
    const again = ok(arrangeGroups(result.document, "maple", rows, matchRows(rows, result.document), { removeEmptied: true }));
    expect(again.created).toEqual([]);
    expect(arrangeChangesNothing(again)).toBe(true);
  });

  it("says why when the groups would go too deep", () => {
    const document = estate();
    const deep = [row("12A GF Lobby Lighting", ["1", "2", "3", "4", "5", "6", "7", "8"])];
    expect(arrangeGroups(document, "maple", deep, matchRows(deep, document), { removeEmptied: true })).toEqual({ error: "Groups can only go 7 levels deep." });
  });
});

describe("template and floor plan", () => {
  it("offers a template with the headings it reads and two made-up rows", () => {
    const csv = templateCsv();
    expect(csv).toBe("Group,Meter name,Short name\r\nBlock A > Ground floor,Block A GF Lobby Lighting,Lift lobby 1\r\nCommon area > Pavilion,Pavilion linkway 1,Pavilion 1\r\n");
    const cells = parseDelimitedText(csv);
    const layout = detectLayout(cells)!;
    expect(layout.columns.map(column => column.role)).toEqual(["group", "meter", "short"]);
    expect(readRows(cells, layout).map(item => item.path)).toEqual([["Block A", "Ground floor"], ["Common area", "Pavilion"]]);
  });

  it("adds one labelled area per top-level group, without touching the areas already drawn", () => {
    const fresh = floorPlanWithGroupAreas(null, ["Block 12A", "Common area"])!;
    expect(fresh.added).toEqual(["Block 12A", "Common area"]);
    expect(fresh.plan.areas.map(area => [area.label, area.board])).toEqual([["Block 12A", ""], ["Common area", ""]]);
    expect(() => referenceFromPlan(fresh.plan, "maple", null)).not.toThrow();

    const drawn = starterPlan(["12A"]);
    const previous = referenceFromPlan({ ...drawn, areas: drawn.areas.map(area => ({ ...area, label: "Block 12A" })) }, "maple", null) as StoredSpatialReference;
    const before = planFromReference(previous);
    const next = floorPlanWithGroupAreas(previous, ["block 12a", "Common area", "Common area"])!;
    expect(next.added).toEqual(["Common area"]);
    expect(next.plan.areas.slice(0, before.areas.length)).toEqual(before.areas);
    const added = next.plan.areas.at(-1)!;
    expect(added).toEqual(expect.objectContaining({ label: "Common area", board: "" }));
    // Below everything already drawn, with the plan grown to hold it.
    expect(added.rect[1]).toBeGreaterThan(Math.max(...before.areas.map(area => area.rect[1] + area.rect[3])));
    expect(next.plan.viewBox[3]).toBeGreaterThanOrEqual(added.rect[1] + added.rect[3]);
    const saved = planFromReference(referenceFromPlan(next.plan, "maple", previous));
    expect(saved.areas.map(area => area.label)).toEqual(["Block 12A", "Common area"]);
    expect(floorPlanWithGroupAreas(previous, ["Block 12A"])).toBeNull();
  });
});

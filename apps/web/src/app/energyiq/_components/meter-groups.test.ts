import { describe, expect, it } from "vitest";
import { analysisGroups, biggestMeterGroup, buildMeterGroupTree, flattenMeterGroups, groupBreakdown, groupsFromLocations, inSavedOrder, wholePercents, type GroupedMeter, type MeterGroup } from "@datafoundry/site-report";

/** An estate, grouped by what each meter serves rather than the panel it is wired from. */
const GROUPS: MeterGroup[] = [
  { id: "blk-f", name: "Block 1B", parentId: null },
  { id: "f-gf", name: "Ground floor", parentId: "blk-f" },
  { id: "blk-e", name: "Block 1A", parentId: null },
  { id: "common", name: "Common area", parentId: null },
  { id: "pavilion", name: "Pavilion", parentId: "common" },
  { id: "playground", name: "Playground", parentId: "common" },
  { id: "driveway", name: "Driveway", parentId: "common" },
  { id: "entrance", name: "Entrance", parentId: "common" },
];
const meter = (id: string, groupId: string | null, kwh: number, name = id): GroupedMeter => ({ id, name, groupId, kwh });
const METERS: GroupedMeter[] = [
  meter("f-lobby", "f-gf", 3), meter("f-deco", "f-gf", 1), meter("e-lobby", "blk-e", 2.6),
  meter("pav-1", "pavilion", 0.15, "Pavilion 1"), meter("pav-2", "pavilion", 0.15, "Pavilion 2"), meter("pav-fan", "pavilion", 0.1),
  meter("play", "playground", 0.2), meter("drive", "driveway", 0.2), meter("chute", "driveway", 0.1, "Rubbish chute lamp"),
  // Wired from 1B's panel, but it lights the Estate signboard at the entrance.
  meter("sign", "entrance", 0.5, "Entrance"),
];

describe("group totals and shares", () => {
  const tree = buildMeterGroupTree({ groups: GROUPS, meters: METERS, name: "Estate" });
  const group = (name: string) => flattenMeterGroups(tree).find(item => item.name === name)!;

  it("adds up every meter inside a group, at any depth, and shares each group of the one above it", () => {
    expect(tree.kwh).toBeCloseTo(8);
    const common = group("Common area");
    expect(common.kwh).toBeCloseTo(1.4);
    // Charles's example: Pavilion 29%, Playground 14%, Driveway 21%, Entrance 36% of the common area.
    expect(common.children.map(child => [child.name, Math.round(child.share * 100)])).toEqual([["Entrance", 36], ["Pavilion", 29], ["Driveway", 21], ["Playground", 14]]);
    expect(group("Block 1B").kwh).toBeCloseTo(4);
    expect(group("Block 1B").share).toBeCloseTo(0.5);
    expect(group("Ground floor").share).toBe(1);
  });

  it("flags a group measured by a single meter, which has no sub-meter below it", () => {
    expect(group("Entrance").singleMeter).toBe(true);
    expect(group("Pavilion").singleMeter).toBe(false);
    expect(biggestMeterGroup({ ...group("Common area"), depth: 0 })?.name).toBe("Entrance");
  });

  it("counts a meter only in the group it is filed in, wherever it is wired from", () => {
    // Moving the signboard meter from Block 1B's panel to Entrance takes it out of the block entirely.
    const before = buildMeterGroupTree({ groups: GROUPS, meters: METERS.map(item => item.id === "sign" ? { ...item, groupId: "blk-f" } : item), name: "Estate" });
    const blockBefore = flattenMeterGroups(before).find(item => item.name === "Block 1B")!;
    expect(blockBefore.kwh).toBeCloseTo(4.5);
    expect(group("Block 1B").kwh).toBeCloseTo(4);
    expect(group("Entrance").kwh).toBeCloseTo(0.5);
    expect(flattenMeterGroups(tree).reduce((sum, item) => sum + item.meters.filter(entry => entry.id === "sign").length, 0)).toBe(1);
    expect(tree.kwh).toBeCloseTo(before.kwh);
  });

  it("keeps the main meter as the whole-site total and shows what no sub-meter explains as its own line", () => {
    const withMain = buildMeterGroupTree({ groups: GROUPS, meters: METERS, name: "Estate", totalKwh: 10, unmeteredLabel: "Not measured by a sub-meter" });
    expect(withMain.kwh).toBe(10);
    expect(withMain.unmeteredKwh).toBeCloseTo(2);
    expect(withMain.meters.find(item => item.unmetered)).toEqual(expect.objectContaining({ name: "Not measured by a sub-meter", share: expect.closeTo(0.2) }));
    expect(withMain.children.find(item => item.name === "Block 1B")!.share).toBeCloseTo(0.4);
    // A total within rounding of the meters adds no line.
    expect(buildMeterGroupTree({ groups: GROUPS, meters: METERS, name: "Estate", totalKwh: 8.05 }).unmeteredKwh).toBe(0);
  });

  it("leaves out groups with no meter, unless asked to keep them", () => {
    const groups = [...GROUPS, { id: "empty", name: "Emergency lights", parentId: "blk-f" }];
    expect(flattenMeterGroups(buildMeterGroupTree({ groups, meters: METERS, name: "Estate" })).some(item => item.name === "Emergency lights")).toBe(false);
    expect(flattenMeterGroups(buildMeterGroupTree({ groups, meters: METERS, name: "Estate", keepEmpty: true })).some(item => item.name === "Emergency lights")).toBe(true);
  });
});

describe("the order someone saved for the groups", () => {
  // Saved as Common area, then the blocks; inside Common area, Driveway, Playground, Pavilion, Entrance.
  const ordered = GROUPS.map(group => ({ ...group, order: ({ common: 10, "blk-e": 30, "blk-f": 20, driveway: 10, playground: 20, pavilion: 30, entrance: 40 } as Record<string, number>)[group.id] }));
  const tree = buildMeterGroupTree({ groups: ordered, meters: METERS, name: "Estate" });

  it("keeps groups largest first in the tree, and in their saved order when asked", () => {
    expect(tree.children.map(child => child.name)).toEqual(["Block 1B", "Block 1A", "Common area"]);
    expect(inSavedOrder(tree.children).map(child => child.name)).toEqual(["Common area", "Block 1B", "Block 1A"]);
    const common = tree.children.find(child => child.name === "Common area")!;
    expect(inSavedOrder(common.children).map(child => child.name)).toEqual(["Driveway", "Playground", "Pavilion", "Entrance"]);
  });

  it("falls back to the order the list gives for groups without a saved order", () => {
    expect(inSavedOrder(buildMeterGroupTree({ groups: [...GROUPS].reverse(), meters: METERS, name: "Estate" }).children).map(child => child.name)).toEqual(["Common area", "Block 1A", "Block 1B"]);
  });

  it("splits the whole site into a breakdown whose shares are all of the whole site, adding up level by level", () => {
    const rows = groupBreakdown(tree, 16);
    expect(rows.map(row => row.name)).toEqual(["Common area", "Block 1B", "Block 1A"]);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 9);
    expect(rows.reduce((sum, row) => sum + row.perDay!, 0)).toBeCloseTo(16, 9);
    const common = rows[0]!;
    expect(common.share).toBeCloseTo(1.4 / 8, 9);
    expect(common.rows.map(row => [row.name, row.kind])).toEqual([["Driveway", "group"], ["Playground", "group"], ["Pavilion", "group"], ["Entrance", "group"]]);
    expect(common.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(common.share, 9);
    // The meters of a group stay inside it, largest first.
    expect(common.rows[2]!.rows.map(row => [row.name, row.kind])).toEqual([["Pavilion 1", "meter"], ["Pavilion 2", "meter"], ["pav-fan", "meter"]]);
    // A block whose meters are filed in it directly opens onto those meters.
    expect(rows[2]!.rows.map(row => row.name)).toEqual(["e-lobby"]);
    expect(groupBreakdown(tree, null)[0]!.perDay).toBeNull();
  });

  it("rounds the shares to whole percentages that add up, level by level", () => {
    // 40.4% + 38.3% + 21.3% rounds to 99%; the one that lost the most gets the missing point.
    expect(wholePercents([0.404, 0.383, 0.213], 100)).toEqual([41, 38, 21]);
    expect(wholePercents([1 / 3, 1 / 3, 1 / 3], 100)).toEqual([34, 33, 33]);
    expect(wholePercents([0.1, 0.05], 15)).toEqual([10, 5]);
    expect(wholePercents([], 0)).toEqual([]);
    const rows = groupBreakdown(tree, 16);
    expect(rows.reduce((sum, row) => sum + row.pct, 0)).toBe(100);
    for (const row of rows) if (row.rows.length) expect(row.rows.reduce((sum, child) => sum + child.pct, 0)).toBe(row.pct);
  });

  it("reads the saved order from the published locations", () => {
    expect(groupsFromLocations([{ id: "root", name: "Estate", parentId: null }, { id: "blk-f", name: "Block F", parentId: "root", sortOrder: 20 }, { id: "f-gf", name: "Ground floor", parentId: "blk-f" }]))
      .toEqual([{ id: "blk-f", name: "Block F", parentId: null, order: 20 }, { id: "f-gf", name: "Ground floor", parentId: "blk-f" }]);
  });
});

describe("groups from the published project information", () => {
  it("treats the project itself as the whole site, not a group", () => {
    expect(groupsFromLocations([{ id: "root", name: "Estate", parentId: null }, { id: "blk-f", name: "Block 1B", parentId: "root" }, { id: "f-gf", name: "Ground floor", parentId: "blk-f" }]))
      .toEqual([{ id: "blk-f", name: "Block 1B", parentId: null }, { id: "f-gf", name: "Ground floor", parentId: "blk-f" }]);
  });

  it("files each meter's energy in its group and leaves the main meter out of the parts", () => {
    const project = {
      context: { scopeId: "project", scopeName: "Estate", timezone: "Asia/Singapore", from: "2026-11-01T00:00:00+08:00", to: "2026-11-02T00:00:00+08:00" },
      summary: { usageKwh: 10, peakKw: 1, validIntervalCount: 96 },
      explorerMeters: [
        { id: "main", name: "Main", scopeId: "root", kind: "physical" as const, category: "overall", includedInOfficialTotal: true },
        { id: "sign", name: "Entrance", fullName: "1B Estate signboard", scopeId: "entrance", kind: "physical" as const, category: "light", includedInOfficialTotal: false },
      ],
      categories: [], childScopes: [],
      circuits: [
        { meterNodeId: "main", name: "Main", category: "overall", meterRole: "total", usageKwh: 10 },
        { meterNodeId: "sign", name: "Entrance", category: "light", meterRole: "component", usageKwh: 0.5 },
      ],
      cost: { status: "unavailable" as const },
    };
    const groups = analysisGroups(project, { locations: [{ id: "root", name: "Estate" }, { id: "entrance", name: "Entrance", parentId: "root" }], meters: [{ id: "main", location: "Estate", locationId: "root" }, { id: "sign", location: "Entrance", locationId: "entrance" }], calendar: null });
    expect(groups).toEqual({ list: [{ id: "entrance", name: "Entrance", parentId: null }], meters: [{ id: "sign", name: "Entrance", fullName: "1B Estate signboard", groupId: "entrance", kwh: 0.5 }] });
    expect(analysisGroups(project, { meters: [], calendar: null })).toBeUndefined();
  });
});

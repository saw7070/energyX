import { describe, expect, it } from "vitest";
import { analysisGroups, biggestMeterGroup, buildMeterGroupTree, flattenMeterGroups, groupsFromLocations, type GroupedMeter, type MeterGroup } from "@datafoundry/site-report";

/** The SKTC estate, grouped by what each meter serves rather than the panel it is wired from. */
const GROUPS: MeterGroup[] = [
  { id: "blk-f", name: "Block 264F", parentId: null },
  { id: "f-gf", name: "Ground floor", parentId: "blk-f" },
  { id: "blk-e", name: "Block 264E", parentId: null },
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
  // Wired from 264F's panel, but it lights the Compassvale Bow signboard at the entrance.
  meter("sign", "entrance", 0.5, "Entrance"),
];

describe("group totals and shares", () => {
  const tree = buildMeterGroupTree({ groups: GROUPS, meters: METERS, name: "SKTC" });
  const group = (name: string) => flattenMeterGroups(tree).find(item => item.name === name)!;

  it("adds up every meter inside a group, at any depth, and shares each group of the one above it", () => {
    expect(tree.kwh).toBeCloseTo(8);
    const common = group("Common area");
    expect(common.kwh).toBeCloseTo(1.4);
    // Charles's example: Pavilion 29%, Playground 14%, Driveway 21%, Entrance 36% of the common area.
    expect(common.children.map(child => [child.name, Math.round(child.share * 100)])).toEqual([["Entrance", 36], ["Pavilion", 29], ["Driveway", 21], ["Playground", 14]]);
    expect(group("Block 264F").kwh).toBeCloseTo(4);
    expect(group("Block 264F").share).toBeCloseTo(0.5);
    expect(group("Ground floor").share).toBe(1);
  });

  it("flags a group measured by a single meter, which has no sub-meter below it", () => {
    expect(group("Entrance").singleMeter).toBe(true);
    expect(group("Pavilion").singleMeter).toBe(false);
    expect(biggestMeterGroup({ ...group("Common area"), depth: 0 })?.name).toBe("Entrance");
  });

  it("counts a meter only in the group it is filed in, wherever it is wired from", () => {
    // Moving the signboard meter from Block 264F's panel to Entrance takes it out of the block entirely.
    const before = buildMeterGroupTree({ groups: GROUPS, meters: METERS.map(item => item.id === "sign" ? { ...item, groupId: "blk-f" } : item), name: "SKTC" });
    const blockBefore = flattenMeterGroups(before).find(item => item.name === "Block 264F")!;
    expect(blockBefore.kwh).toBeCloseTo(4.5);
    expect(group("Block 264F").kwh).toBeCloseTo(4);
    expect(group("Entrance").kwh).toBeCloseTo(0.5);
    expect(flattenMeterGroups(tree).reduce((sum, item) => sum + item.meters.filter(entry => entry.id === "sign").length, 0)).toBe(1);
    expect(tree.kwh).toBeCloseTo(before.kwh);
  });

  it("keeps the main meter as the whole-site total and shows what no sub-meter explains as its own line", () => {
    const withMain = buildMeterGroupTree({ groups: GROUPS, meters: METERS, name: "SKTC", totalKwh: 10, unmeteredLabel: "Not measured by a sub-meter" });
    expect(withMain.kwh).toBe(10);
    expect(withMain.unmeteredKwh).toBeCloseTo(2);
    expect(withMain.meters.find(item => item.unmetered)).toEqual(expect.objectContaining({ name: "Not measured by a sub-meter", share: expect.closeTo(0.2) }));
    expect(withMain.children.find(item => item.name === "Block 264F")!.share).toBeCloseTo(0.4);
    // A total within rounding of the meters adds no line.
    expect(buildMeterGroupTree({ groups: GROUPS, meters: METERS, name: "SKTC", totalKwh: 8.05 }).unmeteredKwh).toBe(0);
  });

  it("leaves out groups with no meter, unless asked to keep them", () => {
    const groups = [...GROUPS, { id: "empty", name: "Emergency lights", parentId: "blk-f" }];
    expect(flattenMeterGroups(buildMeterGroupTree({ groups, meters: METERS, name: "SKTC" })).some(item => item.name === "Emergency lights")).toBe(false);
    expect(flattenMeterGroups(buildMeterGroupTree({ groups, meters: METERS, name: "SKTC", keepEmpty: true })).some(item => item.name === "Emergency lights")).toBe(true);
  });
});

describe("groups from the published project information", () => {
  it("treats the project itself as the whole site, not a group", () => {
    expect(groupsFromLocations([{ id: "root", name: "SKTC", parentId: null }, { id: "blk-f", name: "Block 264F", parentId: "root" }, { id: "f-gf", name: "Ground floor", parentId: "blk-f" }]))
      .toEqual([{ id: "blk-f", name: "Block 264F", parentId: null }, { id: "f-gf", name: "Ground floor", parentId: "blk-f" }]);
  });

  it("files each meter's energy in its group and leaves the main meter out of the parts", () => {
    const project = {
      context: { scopeId: "project", scopeName: "SKTC", timezone: "Asia/Singapore", from: "2026-11-01T00:00:00+08:00", to: "2026-11-02T00:00:00+08:00" },
      summary: { usageKwh: 10, peakKw: 1, validIntervalCount: 96 },
      explorerMeters: [
        { id: "main", name: "Main", scopeId: "root", kind: "physical" as const, category: "overall", includedInOfficialTotal: true },
        { id: "sign", name: "Entrance", fullName: "264F Compassvale Bow signboard", scopeId: "entrance", kind: "physical" as const, category: "light", includedInOfficialTotal: false },
      ],
      categories: [], childScopes: [],
      circuits: [
        { meterNodeId: "main", name: "Main", category: "overall", meterRole: "total", usageKwh: 10 },
        { meterNodeId: "sign", name: "Entrance", category: "light", meterRole: "component", usageKwh: 0.5 },
      ],
      cost: { status: "unavailable" as const },
    };
    const groups = analysisGroups(project, { locations: [{ id: "root", name: "SKTC" }, { id: "entrance", name: "Entrance", parentId: "root" }], meters: [{ id: "main", location: "SKTC", locationId: "root" }, { id: "sign", location: "Entrance", locationId: "entrance" }], calendar: null });
    expect(groups).toEqual({ list: [{ id: "entrance", name: "Entrance", parentId: null }], meters: [{ id: "sign", name: "Entrance", fullName: "264F Compassvale Bow signboard", groupId: "entrance", kwh: 0.5 }] });
    expect(analysisGroups(project, { meters: [], calendar: null })).toBeUndefined();
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { advisorMeterGroups, meterUsageFromCsv, splitCsvLine } from "./report-meter-groups.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "report-groups-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const row = (id: string, scope: string, extra: Record<string, unknown> = {}) => ({ id, source_label: id, display_name: id, scope_id: scope, navigation_scope_id: scope, resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official", ...extra });
/** SKTC's common area: the signboard is wired from 264F's panel but filed under Entrance. */
const document = {
  project: { name: "SKTC", timezone: "Asia/Singapore" },
  nodes: [
    { id: "blk-f", name: "Block 264F" },
    { id: "common", name: "Common area" },
    { id: "pavilion", name: "Pavilion", parent_id: "common" },
    { id: "playground", name: "Playground", parent_id: "common" },
    { id: "driveway", name: "Driveway", parent_id: "common" },
    { id: "entrance", name: "Entrance", parent_id: "common" },
  ],
  meter_mapping: { schema_version: 2, confirmed: true, rows: [
    row("main", "blk-f", { category: "overall", meter_role: "total" }),
    row("lobby", "blk-f", { presentation: { device_name: "264F GF Lobby Lighting" } }),
    row("pav-1", "pavilion"), row("pav-2", "pavilion"),
    row("play", "playground"),
    row("drive", "driveway"), row("chute", "driveway", { presentation: { device_name: "264E Rubbish chute lamp", short_name: "Rubbish chute lamp", panel: "264E" } }),
    row("sign", "entrance", { presentation: { device_name: "264F Compassvale Bow signboard", short_name: "Entrance", panel: "264F" } }),
  ] },
} as unknown as EnergyIqProjectSetupDocument;

describe("reading each meter's energy from the advisor's CSV", () => {
  it("splits quoted fields with commas and doubled quotes", () => {
    expect(splitCsvLine('a,"b, c","say ""hi""",')).toEqual(["a", "b, c", 'say "hi"', ""]);
  });

  it("adds accepted usage per meter and the official total, skipping rejected and empty readings", async () => {
    const path = join(root, "meter-intervals.csv");
    writeFileSync(path, [
      "meter_node_id,device_name,official_aggregation_eligible,usage_kwh,quality_status",
      'sign,"Entrance, signboard",true,0.25,ok',
      "sign,Entrance,true,0.25,gap",
      "sign,Entrance,true,9,rejected",
      "lobby,Lobby,false,,ok",
      "lobby,Lobby,false,1.5,ok",
    ].join("\n"));
    const usage = await meterUsageFromCsv(path);
    expect([...usage.byMeter]).toEqual([["sign", 0.5], ["lobby", 1.5]]);
    expect(usage.officialKwh).toBe(0.5);
  });
});

describe("the advisor's group tree", () => {
  const usage = { byMeter: new Map([["main", 10], ["lobby", 3], ["pav-1", 0.2], ["pav-2", 0.2], ["play", 0.2], ["drive", 0.2], ["chute", 0.1], ["sign", 0.5]]), officialKwh: 10 };
  const groups = advisorMeterGroups(document, usage)!;
  const common = groups.groups.find(group => group.name === "Common area")!;

  it("gives every group its kWh and share of the group above, with the main meter kept out of the parts", () => {
    expect(groups.totalKWh).toBe(10);
    expect(groups.notMeasuredBySubMeterKWh).toBeCloseTo(5.6);
    expect(common.kWh).toBeCloseTo(1.4);
    expect(common.groups.map(group => [group.name, group.sharePctOfParent])).toEqual([["Entrance", 35.7], ["Pavilion", 28.6], ["Driveway", 21.4], ["Playground", 14.3]]);
    expect(groups.groups.find(group => group.name === "Block 264F")!.meters.map(meter => meter.meterId)).toEqual(["lobby"]);
  });

  it("flags a group with a single meter and names meters by their short names, panel as a detail", () => {
    const entrance = common.groups.find(group => group.name === "Entrance")!;
    expect(entrance).toEqual(expect.objectContaining({ singleMeter: true, path: "Common area › Entrance", parent: "Common area" }));
    expect(entrance.meters).toEqual([{ meterId: "sign", displayName: "Entrance", fullName: "264F Compassvale Bow signboard", panel: "264F", kWh: 0.5, sharePctOfGroup: 100 }]);
    expect(common.groups.find(group => group.name === "Pavilion")!.singleMeter).toBe(false);
    expect(groups.instructions).toContain("singleMeter=true means one meter measures the whole group");
  });

  it("is left out when the project has no groups or nothing was read", () => {
    expect(advisorMeterGroups({ ...document, nodes: [] }, usage)).toBeNull();
    expect(advisorMeterGroups(document, null)).toBeNull();
  });
});

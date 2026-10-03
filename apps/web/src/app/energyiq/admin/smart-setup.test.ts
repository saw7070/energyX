import { validateProjectSetupDocument } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import type { EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { buildSmartSetup, detectTotalLabel, formatEquipment, parseDeviceList, savedDeviceList } from "./smart-setup";

const ELITE_LABELS = ["Incoming 3Phase", "A18P", "B11P", "B2R", "B3B", "B4B", "B5B", "B6B", "B8P", "B9P"];
// Copied from the admin's spreadsheet: tab separated, as pasted from Excel.
const ELITE_DEVICES = [
  "Code\tItems",
  "A18P\tCoffee machine x1, Warmer machine x1",
  "B2R\tBalcony light x1, Toilet Light x3, Staircase light x1",
  "B3B\tStudy Desk Plug x8, Cuckoo x1, Freezer x1, Fryer x1",
  "B6B\tPower Plug x6",
  "B8P\tMicrowave x1 , Bingsu Machine x1 and Ice Blender x1",
  "B11P\tTV x1, Signboard x1, Emergency Light x1",
].join("\n");

const emptyDocument = (): EnergyProjectSetupDocumentDto => ({
  project: { name: "Elite IOT", timezone: "Asia/Singapore" },
  tier_structure_locked: false,
  tiers: [],
  nodes: [],
});

const blockingIssues = (document: EnergyProjectSetupDocumentDto) =>
  validateProjectSetupDocument(document as never).issues.filter((issue) => issue.severity === "error");

describe("device list parsing", () => {
  it("reads a table pasted from Excel and skips the header", () => {
    const devices = parseDeviceList(ELITE_DEVICES);
    expect(devices).toHaveLength(6);
    expect(devices[0]).toEqual({ code: "A18P", description: "Coffee machine x1, Warmer machine x1" });
  });

  it("reads CSV, including unquoted commas inside the description", () => {
    expect(parseDeviceList('Code,Items\nA18P,"Coffee machine x1, Warmer machine x1"\nB6B,Power Plug x6, Spare plug x1'))
      .toEqual([
        { code: "A18P", description: "Coffee machine x1, Warmer machine x1" },
        { code: "B6B", description: "Power Plug x6, Spare plug x1" },
      ]);
  });

  it("tidies equipment lists into readable names", () => {
    expect(formatEquipment("Study Desk Plug x8, Cuckoo x1, Freezer x1, Fryer x1")).toBe("Study Desk Plug ×8, Cuckoo, Freezer, Fryer");
    expect(formatEquipment("Microwave x1 , Bingsu Machine x1 and Ice Blender x1")).toBe("Microwave, Bingsu Machine, Ice Blender");
  });

  it("detects exactly one incoming or total supply", () => {
    expect(detectTotalLabel(ELITE_LABELS)).toBe("Incoming 3Phase");
    expect(detectTotalLabel(["A18P", "B2R"])).toBeUndefined();
    expect(detectTotalLabel(["Main DB", "Total load"])).toBeUndefined();
  });
});

describe("smart setup for a new project", () => {
  it("builds a board, one location per circuit and named meters that pass server validation", () => {
    const plan = buildSmartSetup({ document: emptyDocument(), projectId: "energy-project-f8716259", labels: ELITE_LABELS, devices: parseDeviceList(ELITE_DEVICES) });

    expect(plan.mode).toBe("new");
    expect(plan.totalLabel).toBe("Incoming 3Phase");
    expect(plan.document.nodes).toHaveLength(10);
    const incoming = plan.document.meter_mapping!.rows.find((row) => row.source_label === "Incoming 3Phase")!;
    expect(incoming).toMatchObject({ meter_role: "total", aggregation_usage: "excluded", category: "overall" });
    const coffee = plan.document.meter_mapping!.rows.find((row) => row.source_label === "A18P")!;
    expect(coffee).toMatchObject({ display_name: "A18P · Coffee machine, Warmer machine", meter_role: "component", aggregation_usage: "official" });
    // The site total is the incoming meter alone; the board total is its circuits, so reports list each circuit.
    const routes = plan.document.meter_mapping!.official_aggregation_routes!;
    expect(routes.filter((route) => route.scope_id === "project")).toEqual([{ scope_id: "project", resource: "electricity", category: "overall", meter_point_ids: [incoming.id] }]);
    const boardMembers = routes.filter((route) => route.scope_id === "energy-project-f8716259-smart-board").flatMap((route) => route.meter_point_ids);
    expect(boardMembers).toHaveLength(9);
    expect(boardMembers).not.toContain(incoming.id);
    expect(routes.find((route) => route.scope_id === coffee.scope_id)?.meter_point_ids).toEqual([coffee.id]);
    // Devices missing from the list keep their code as the name.
    expect(plan.document.meter_mapping!.rows.find((row) => row.source_label === "B4B")!.display_name).toBe("B4B");
    expect(plan.document.meter_mapping!.confirmed).toBe(true);
    expect(blockingIssues(plan.document)).toEqual([]);
  });

  it("sorts each new circuit by what its equipment is used for", () => {
    const devices = [
      ...parseDeviceList(ELITE_DEVICES),
      { code: "B4B", description: "IP Camera x1, Work Desk x2, Printer x1" },
      { code: "B5B", description: "Router x1, Modem x1, Server x1, IP Camera x5, POE Switch x1" },
      { code: "B9P", description: "Waffle machine x1, Eggette machine x1" },
    ];
    const plan = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ELITE_LABELS, devices });
    const categories = Object.fromEntries(plan.document.meter_mapping!.rows.map((row) => [row.source_label, row.category]));
    expect(categories).toEqual({
      "Incoming 3Phase": "overall",
      A18P: "kitchen",
      B11P: "light",
      B2R: "light",
      B3B: "kitchen",
      B4B: "it",
      B5B: "it",
      B6B: "plug",
      B8P: "kitchen",
      B9P: "kitchen",
    });
    // Each type of use gets its own route on the board, and the setup still passes server validation.
    const boardCategories = plan.document.meter_mapping!.official_aggregation_routes!
      .filter((route) => route.scope_id === "p-smart-board").map((route) => route.category).sort();
    expect(boardCategories).toEqual(["it", "kitchen", "light", "plug"]);
    expect(blockingIssues(plan.document)).toEqual([]);
  });

  it("falls back to the meter name when there is no equipment list", () => {
    const plan = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ["B4B", "DB1 Lighting", "Aircon 1"], devices: [] });
    const categories = Object.fromEntries(plan.document.meter_mapping!.rows.map((row) => [row.source_label, row.category]));
    expect(categories).toEqual({ B4B: "other", "DB1 Lighting": "light", "Aircon 1": "aircon" });
  });

  it("adds circuits up to the site total when there is no incoming meter", () => {
    const plan = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ["A18P", "B2R"], devices: [] });
    expect(plan.totalLabel).toBeUndefined();
    expect(plan.document.meter_mapping!.rows.every((row) => row.aggregation_usage === "official")).toBe(true);
    expect(blockingIssues(plan.document)).toEqual([]);
  });
});

describe("smart setup for an existing project", () => {
  it("upgrades an older smart setup whose circuits were left out of reports", () => {
    const first = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ELITE_LABELS, devices: [] });
    const legacyRows = first.document.meter_mapping!.rows.map((row) => row.meter_role === "component" ? { ...row, aggregation_usage: "excluded" as const } : { ...row, aggregation_usage: "official" as const });
    const legacy = { ...first.document, meter_mapping: { ...first.document.meter_mapping!, rows: legacyRows } };
    const plan = buildSmartSetup({ document: legacy, projectId: "p", labels: ELITE_LABELS, devices: [] });
    expect(plan.upgraded).toBe(true);
    expect(plan.document.meter_mapping!.rows).toEqual(first.document.meter_mapping!.rows);
    expect(plan.document.meter_mapping!.official_aggregation_routes).toEqual(first.document.meter_mapping!.official_aggregation_routes);
    expect(blockingIssues(plan.document)).toEqual([]);
  });

  it("keeps existing meters, adds new devices to the board and names them", () => {
    const first = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ["Incoming 3Phase", "A18P"], devices: [] });
    const plan = buildSmartSetup({ document: first.document, projectId: "p", labels: ["Incoming 3Phase", "A18P", "B6B"], devices: parseDeviceList(ELITE_DEVICES) });

    expect(plan.mode).toBe("update");
    expect(plan.newLabels).toEqual(["B6B"]);
    expect(plan.unplacedLabels).toEqual([]);
    expect(plan.rows.find((row) => row.sourceLabel === "B6B")).toMatchObject({ status: "new", location: "B6B", displayName: "B6B · Power Plug ×6" });
    // New meters are sorted by their equipment; meters already set up keep the type they have.
    const rows = plan.document.meter_mapping!.rows;
    expect(rows.find((row) => row.source_label === "B6B")?.category).toBe("plug");
    expect(rows.find((row) => row.source_label === "A18P")?.category).toBe("other");
    // An existing meter that still had its raw code picks up the name from the list.
    expect(plan.rows.find((row) => row.sourceLabel === "A18P")?.displayName).toBe("A18P · Coffee machine, Warmer machine");
    expect(blockingIssues(plan.document)).toEqual([]);
  });

  it("changes nothing structural when the new files only extend the dates", () => {
    const first = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ELITE_LABELS, devices: [] });
    const plan = buildSmartSetup({ document: first.document, projectId: "p", labels: ELITE_LABELS, devices: [] });
    expect(plan.newLabels).toEqual([]);
    expect(plan.document.nodes).toEqual(first.document.nodes);
    expect(plan.document.meter_mapping!.official_aggregation_routes).toEqual(first.document.meter_mapping!.official_aggregation_routes);
  });

  it("flags new devices it cannot place in a hand-built structure instead of guessing", () => {
    const handBuilt: EnergyProjectSetupDocumentDto = {
      ...emptyDocument(),
      tier_structure_locked: true,
      tiers: [{ id: "t1", ordinal: 1, alias: "Room" }],
      nodes: [{ id: "room-1", tier_definition_id: "t1", name: "Office", sort_order: 0, metadata_status: "provisional" }],
      meter_mapping: { schema_version: 2, source_kind: "excel", confirmed: true, rows: [
        { id: "m1", source_label: "Office DB", scope_id: "room-1", navigation_scope_id: "room-1", display_name: "Office DB", resource: "electricity", category: "other", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
      ] },
    };
    const plan = buildSmartSetup({ document: handBuilt, projectId: "p", labels: ["Office DB", "Pantry"], devices: [] });
    expect(plan.unplacedLabels).toEqual(["Pantry"]);
    expect(plan.document.meter_mapping!.confirmed).toBe(false);
  });
  it("remembers the device list so devices added later are still named", () => {
    const first = buildSmartSetup({ document: emptyDocument(), projectId: "p", labels: ["Incoming 3Phase", "A18P"], devices: parseDeviceList(ELITE_DEVICES) });
    expect(savedDeviceList(first.document, "p")).toHaveLength(6);
    // A later import with no list pasted still names the new B6B circuit from the saved list.
    const later = buildSmartSetup({ document: first.document, projectId: "p", labels: ["Incoming 3Phase", "A18P", "B6B"], devices: [] });
    expect(later.rows.find((row) => row.sourceLabel === "B6B")?.displayName).toBe("B6B · Power Plug ×6");
    // A newly pasted entry replaces the saved one for the same code.
    const renamed = buildSmartSetup({ document: later.document, projectId: "p", labels: ["Incoming 3Phase", "A18P", "B6B"], devices: [{ code: "B7X", description: "Spare x1" }] });
    expect(savedDeviceList(renamed.document, "p").map((entry) => entry.code)).toContain("B7X");
    expect(blockingIssues(renamed.document)).toEqual([]);
  });
});

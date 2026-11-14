/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, type EnergyProjectSetupDocumentDto, type EnergyProjectSetupDto } from "../../../lib/config-api";

const excel = vi.hoisted(() => ({ default: vi.fn() }));
vi.mock("read-excel-file/browser", () => excel);
import { ProjectConfigurationView } from "./project-configuration-view";
import { notesWithReference, referenceFromPlan, starterPlan } from "./floor-plan-model";

/** A made-up estate: one group per block, as a site started from Tuya is laid out. */
const meter = (id: string, name: string, scope: string) => ({ id, source_label: name, display_name: name, presentation: { device_name: name }, scope_id: scope, navigation_scope_id: scope, resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official" });
const estate = () => ({
  project: { name: "Maple Court", timezone: "Asia/Singapore" }, tier_structure_locked: true,
  tiers: [{ id: "block", ordinal: 1, alias: "Block" }],
  nodes: [
    { id: "a", tier_definition_id: "block", name: "12A", sort_order: 10, metadata_status: "confirmed" },
    { id: "b", tier_definition_id: "block", name: "12B", sort_order: 20, metadata_status: "confirmed" },
    { id: "c", tier_definition_id: "block", name: "12C", sort_order: 30, metadata_status: "confirmed" },
  ],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, official_aggregation_routes: [], virtual_meters: [], rows: [
    meter("a-lobby", "12A GF Lobby Lighting", "a"), meter("a-emergency", "12A Emergency Lighting", "a"), meter("a-gate", "Garden Gate Entrance Lighting", "a"),
    meter("b-lobby", "12B GF Lobby Lighting", "b"), meter("b-emergency", "12B Emergency Lighting", "b"), meter("b-bin", "Rubish Bin Lamp", "b"),
    meter("c-gazebo", "Gazebo DL & Fan", "c"), meter("c-walk", "Gazebo walkway 1", "c"),
  ] },
}) as unknown as EnergyProjectSetupDocumentDto;
const setupOf = (document: EnergyProjectSetupDocumentDto) => ({ project: { id: "maple", has_unpublished_changes: false, root_scope_id: "root" }, draft: { revision: 3, document } }) as unknown as EnergyProjectSetupDto;

const SHEET = [
  "Block,Group,Meter name,Short name",
  "12A,Block 12A > Ground floor,GF Lobby Lighting,Lift lobby 1",
  "12A,Block 12A,Emergency Lighting,",
  "12C,Common area > Gazebo,Gazebo DL and Fan,Gazebo",
  "12B,Common area > Driveway,Rubbish Bin Lamp,Bin lamp",
  "12C,Common area > Pool,Pool pump,",
].join("\n");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); excel.default.mockReset(); });

const button = (text: string) => Array.from(host.querySelectorAll("button")).find(item => item.textContent?.trim() === text) as HTMLButtonElement | undefined;
const panel = () => host.querySelector<HTMLElement>('section[aria-label="Arrange groups from a spreadsheet"]');
const flush = async () => { for (let index = 0; index < 8; index += 1) await act(async () => { await Promise.resolve(); }); };
const choose = async (file: File) => {
  const input = panel()!.querySelector<HTMLInputElement>("input[type=file]")!;
  await act(async () => { Object.defineProperty(input, "files", { configurable: true, value: [file] }); input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const select = async (element: HTMLSelectElement, value: string) => act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
const render = async (props: Partial<React.ComponentProps<typeof ProjectConfigurationView>> = {}) => act(async () => root.render(<ProjectConfigurationView setup={setupOf(estate())} notes="" policies={null} projectId="maple" canEditSetup canEditNotes {...props} />));
const stubSave = () => {
  const save = vi.spyOn(configApi, "saveEnergyProjectSetupDraft").mockResolvedValue({} as Awaited<ReturnType<typeof configApi.saveEnergyProjectSetupDraft>>);
  const live = vi.spyOn(configApi, "applyEnergyProjectChanges").mockResolvedValue({ hierarchy_revision_id: "h", template_revision_id: "t" });
  return { save, live };
};

describe("Arrange from a spreadsheet", () => {
  it("reads the sheet, matches its rows, previews the groups and applies them as one saved change", async () => {
    const { save, live } = stubSave();
    await render();
    await act(async () => button("Arrange from a spreadsheet")!.click());
    expect(panel()).not.toBeNull();
    expect(host.querySelector("[data-location-detail]")).toBeNull();

    await choose(new File([SHEET], "maple.csv", { type: "text/csv" }));
    expect(panel()!.textContent).toContain("Read maple.csv: 5 meter rows.");
    // The columns picked, with a select to change each; the block column repeats the Group path, so it is not used.
    const role = (column: string) => panel()!.querySelector<HTMLSelectElement>(`select[aria-label="What the ${column} column holds"]`)!;
    expect(["Block", "Group", "Meter name", "Short name"].map(column => role(column).value)).toEqual(["ignore", "group", "meter", "short"]);
    expect(panel()!.textContent).toContain("Groups are read left to right: Group.");

    const status = () => panel()!.querySelector('[role="status"]')!.textContent;
    expect(status()).toBe("4 of 8 meters matched. 1 row didn't match any meter — pick one or skip it. 1 match is a best guess — please check it.");
    const badges = Array.from(panel()!.querySelectorAll("tbody tr")).map(row => row.querySelector("td:last-child span")!.textContent);
    expect(badges).toEqual(["Exact", "Exact", "Close", "Best guess", "No match"]);
    expect(panel()!.textContent).toContain("4 meters aren't in the file and stay where they are: Garden Gate Entrance Lighting, 12B GF Lobby Lighting, 12B Emergency Lighting, Gazebo walkway 1.");

    // Fix the row that matched nothing.
    await select(panel()!.querySelector<HTMLSelectElement>('select[aria-label="Meter for row 6"]')!, "c-walk");
    expect(status()).toBe("5 of 8 meters matched. 1 match is a best guess — please check it.");
    expect(panel()!.querySelector("tbody tr:last-child td:last-child span")!.textContent).toBe("Your pick");

    // The preview: counts, the tree with what moves and what is new, and the group left empty.
    expect(panel()!.textContent).toContain("6 new groups · 5 meters move · 3 short names set");
    const tree = panel()!.querySelector<HTMLElement>('ul[aria-label="Groups after this change"]')!;
    expect(tree.textContent).toContain("Block 12ANew");
    expect(tree.textContent).toContain("Moves here from 12A");
    expect(tree.textContent).toContain("Short name: Lift lobby 1");
    expect(panel()!.textContent).toContain("1 group will have no meters left: 12C.");
    const removeEmpty = Array.from(panel()!.querySelectorAll<HTMLInputElement>("input[type=checkbox]")).find(input => input.parentElement?.textContent?.includes("Remove them"))!;
    expect(removeEmpty.checked).toBe(true);
    expect(save).not.toHaveBeenCalled();

    await act(async () => button("Apply these groups")!.click());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    const [projectId, body] = save.mock.calls[0]!;
    expect(projectId).toBe("maple");
    expect(body.expectedRevision).toBe(3);
    const saved = body.document;
    const nodeNamed = (name: string) => saved.nodes.find(node => node.name === name)!;
    // A meter moved into a new group inside a new group, with its short name and its old block kept as its panel.
    const lobby = saved.meter_mapping!.rows.find(row => row.id === "a-lobby")!;
    expect(lobby.scope_id).toBe(nodeNamed("Ground floor").id);
    expect(nodeNamed("Ground floor").parent_id).toBe(nodeNamed("Block 12A").id);
    expect(lobby.presentation).toEqual({ device_name: "12A GF Lobby Lighting", short_name: "Lift lobby 1", panel: "12A" });
    expect(saved.meter_mapping!.rows.find(row => row.id === "c-walk")!.scope_id).toBe(nodeNamed("Pool").id);
    // Nothing deleted: all eight meters are still there; only the emptied group 12C is gone.
    expect(saved.meter_mapping!.rows.map(row => row.id).sort()).toEqual(estate().meter_mapping!.rows.map(row => row.id).sort());
    expect(saved.nodes.map(node => node.name)).not.toContain("12C");
    expect(saved.nodes.map(node => node.name)).toEqual(expect.arrayContaining(["12A", "12B", "Block 12A", "Ground floor", "Common area", "Gazebo", "Driveway", "Pool"]));
    // Then it goes live like every other Groups edit, and the Groups list comes back.
    expect(live).toHaveBeenCalledWith("maple");
    expect(panel()).toBeNull();
    expect(host.textContent).toContain("Groups arranged from maple.csv.");
  });

  it("offers a template, refuses old .xls files, reads the meter sheet of an .xlsx and changes nothing on Cancel", async () => {
    const { save } = stubSave();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:template");
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    await render();
    await act(async () => button("Arrange from a spreadsheet")!.click());
    await act(async () => button("Download a template")!.click());
    expect(names).toEqual(["groups-template.csv"]);
    const text = await (create.mock.calls[0]![0] as Blob).text();
    expect(text.replace(/^﻿/u, "")).toBe("Group,Meter name,Short name,Number of lights\r\nBlock A > Ground floor,Block A GF Lobby Lighting,Lift lobby 1,6\r\nCommon area > Pavilion,Pavilion linkway 1,Pavilion 1,4\r\n");

    await choose(new File(["old"], "meters.xls"));
    expect(panel()!.querySelector('[role="alert"]')!.textContent).toContain(".xls");
    expect(excel.default).not.toHaveBeenCalled();

    // The first sheet holds totals; the second holds the meters, under a title row, with each block named once.
    excel.default.mockResolvedValue([
      { sheet: "Totals", data: [["Month", "kWh"], ["October", 1400]] },
      { sheet: "Meters", data: [["Maple Court meter layout", null, null], ["Block Number", "Meter Name", "Meter Device ID"], ["12C", null, null], [null, "Gazebo DL &amp; Fan", "bf0a1b2c3d4e5f6a7b8c9d"], [null, "Gazebo walkway 1", "bf9a8b7c6d5e4f3a2b1c0d"], ["Notes:", null, null]] },
    ]);
    const sheet = new File(["not read here"], "Maple meters.xlsx");
    await choose(sheet);
    expect(excel.default).toHaveBeenCalledWith(sheet);
    expect(panel()!.textContent).toContain("Read Maple meters.xlsx: 2 meter rows.");
    expect(panel()!.textContent).toContain("Device IDs aren't needed and are not used.");
    expect(panel()!.querySelector('[role="status"]')!.textContent).toBe("2 of 8 meters matched.");
    // The sheet only repeats today's blocks, so there is nothing to apply.
    expect(panel()!.textContent).toContain("Nothing to change");
    expect(button("Apply these groups")!.disabled).toBe(true);

    await act(async () => button("Cancel")!.click());
    expect(panel()).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("adds a floor-plan area for each new top-level group without touching the areas already drawn", async () => {
    const { save } = stubSave();
    const drawn = starterPlan(["12A"]);
    const reference = referenceFromPlan({ ...drawn, areas: drawn.areas.map(area => ({ ...area, label: "12A" })) }, "maple", null);
    const notes = notesWithReference("Estate notes.", null, reference);
    const settings = { contextNotes: notes, other: "kept" };
    const agent = vi.spyOn(configApi, "reportAgentRequest").mockImplementation((async (_project: string, path?: string) => (path === "" ? { settings } : {})) as typeof configApi.reportAgentRequest);
    await render({ notes });
    await act(async () => button("Arrange from a spreadsheet")!.click());
    await choose(new File([SHEET], "maple.csv"));
    // The pool row matched nothing and is skipped, so 12C keeps its walkway meter and stays.
    const offer = Array.from(panel()!.querySelectorAll<HTMLInputElement>("input[type=checkbox]")).find(input => input.parentElement?.textContent?.includes("floor-plan area"))!;
    expect(offer.parentElement!.textContent).toBe("Also add a floor-plan area for each top-level group: 12B, 12C, Block 12A, Common area");
    await act(async () => offer.click());
    await act(async () => button("Apply these groups")!.click());
    await flush();
    const put = agent.mock.calls.find(call => call[1] === "settings")!;
    const body = JSON.parse((put[2] as { body: string }).body) as { contextNotes: string; other: string };
    expect(body.other).toBe("kept");
    expect(body.contextNotes.startsWith("Estate notes.")).toBe(true);
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/u.exec(body.contextNotes)![1]!) as { layout: { zones: Array<{ id: string; referenceBoard: string; rect: number[] }> } };
    expect(json.layout.zones.map(zone => [zone.id, zone.referenceBoard])).toEqual([["12A", "12A"], ["12B", ""], ["12C", ""], ["Block 12A", ""], ["Common area", ""]]);
    expect(json.layout.zones[0]!.rect).toEqual(reference.layout.zones[0]!.rect);
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Groups arranged from maple.csv. 4 floor-plan areas added.");
  });

  it("is only offered to people who can edit groups", async () => {
    await render({ canEditSetup: false });
    expect(button("Arrange from a spreadsheet")).toBeUndefined();
  });
});

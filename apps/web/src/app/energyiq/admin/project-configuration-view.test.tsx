/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectConfigurationView } from "../_components/project-configuration-view";
import { configApi } from "../../../lib/config-api";
import type { EnergyProjectSetupDto, EnergyOperationalPolicyConfigurationDto } from "../../../lib/config-api";
it("groups meters by location and shows school terms only from the selected project's policy", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); const root = createRoot(host);
  const setup = { project: { has_unpublished_changes: true }, draft: { document: { project: { name: "Campus", timezone: "Asia/Singapore" }, tiers: [{id:"building",alias:"Building"}], nodes: [{ id:"a",name:"Block A",tier_definition_id:"building",area_sqm:100,occupant_count:20 }], meter_mapping: { rows: [{id:"m",display_name:"Meter 03",presentation:{device_name:"Cooling",circuit_name:"L1P17"},scope_id:"a",resource:"electricity",category:"aircon",aggregation_usage:"excluded",meter_role:"component"}], virtual_meters:[] } } } } as unknown as EnergyProjectSetupDto;
  const policies = { published: {business_calendar_version:"older"}, pending:{business_calendar_version:"older"},tariffRevisions:[],operatingCalendarRevisions:[{version_id:"new",entries:[],academic_periods:[{id:"break",from:"2026-09-07",to:"2026-09-11",phase:"term_break",label:"School break",source:{label:"School document"}}]}] } as unknown as EnergyOperationalPolicyConfigurationDto;
  const select = vi.spyOn(configApi, "selectEnergyOperationalPolicy").mockResolvedValue(policies);
  const apply = vi.spyOn(configApi, "applyEnergyProjectChanges").mockResolvedValue({ hierarchy_revision_id: "h", template_revision_id: "t" });
  const refreshed = vi.fn();
  try {
    await act(async()=>root.render(<ProjectConfigurationView setup={setup} notes="Project explanation" policies={policies} projectId="campus" onPolicyChange={refreshed}/>));
    expect(host.textContent).toContain("100 m²"); expect(host.textContent).toContain("Cooling");
    expect(host.textContent).toContain("L1P17");
    expect(host.querySelector("strong")?.textContent).not.toBe("Meter 03");
    const click = async (name:string) => { await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent?.startsWith(name))!.click()); };
    await click("Operating hours");
    expect(host.textContent).toContain("School break"); expect(host.textContent).toContain("Saved · not in use");
    await click("Use this version");
    expect(select).toHaveBeenCalledWith("campus", {kind:"calendar",version:"new",expectedVersion:"older"});
    // Choosing a version makes it live straight away; there is no separate Review & Publish step.
    expect(apply).toHaveBeenCalledWith("campus");
    expect(refreshed).toHaveBeenCalledOnce();
    expect(host.querySelector('a[href*="review-publish"]')).toBeNull();
    expect(host.textContent).toContain("This version is now selected. The whole app now uses it.");
    await act(async()=>root.render(<ProjectConfigurationView setup={setup} notes="Office explanation" policies={{...policies,operatingCalendarRevisions:[]}}/>));
    expect(host.textContent).not.toContain("School break");
    await click("Project notes"); expect(host.textContent).toContain("Office explanation");
  } finally { await act(async()=>root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it("shows a read-only Facility with every tab but no way to edit, upload or ask the advisor to change it", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); const root = createRoot(host);
  const setup = { project: { has_unpublished_changes: true }, draft: { document: { project: { name: "Campus", timezone: "Asia/Singapore" }, tiers: [{id:"building",alias:"Building"}], nodes: [{ id:"a",name:"Block A",tier_definition_id:"building",area_sqm:100,occupant_count:20 }], meter_mapping: { rows: [{id:"m",display_name:"Meter 03",presentation:{device_name:"Cooling",circuit_name:"L1P17"},scope_id:"a",resource:"electricity",category:"aircon",aggregation_usage:"excluded",meter_role:"component"}], virtual_meters:[] } } } } as unknown as EnergyProjectSetupDto;
  const policies = { published: {business_calendar_version:null,tariff_schedule_version:null}, pending:{business_calendar_version:null,tariff_schedule_version:null},tariffRevisions:[],operatingCalendarRevisions:[] } as unknown as EnergyOperationalPolicyConfigurationDto;
  try {
    await act(async()=>root.render(<ProjectConfigurationView readOnly setup={setup} notes="" policies={policies} projectId="campus" />));
    const tabs = Array.from(host.querySelectorAll("nav button")).map(button => button.textContent ?? "");
    for (const name of ["Floor layout", "Devices", "Data availability", "Project notes", "Operating hours", "Holidays", "Electricity rate"]) expect(tabs.some(tab => tab.startsWith(name))).toBe(true);
    // Nothing prompts the reader to add or change anything.
    expect(host.textContent).not.toMatch(/Add rate|Add notes/);
    const click = async (name:string) => { await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent?.startsWith(name))!.click()); expect(host.querySelector('a[href*="configure=1"]')).toBeNull(); expect(host.querySelector("button.edit, [class*='edit']")).toBeNull(); };
    for (const name of ["Floor layout", "Project notes", "Operating hours", "Holidays", "Electricity rate"]) await click(name);
  } finally { await act(async()=>root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it("lets publishers edit hours and holidays on the page and saves a pending calendar version", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const office = [{ from: "09:00", to: "18:00" }];
  const setup = { project: { has_unpublished_changes: false, name: "Office", root_scope_id: "root" }, published: { nodes: [{ id: "root", name: "Office" }, { id: "db1", name: "DB1" }] }, draft: { document: { project: { name: "Office", timezone: "Asia/Singapore" }, tiers: [], nodes: [], meter_mapping: { rows: [], virtual_meters: [] } } } } as unknown as EnergyProjectSetupDto;
  const policies = { published: { business_calendar_version: "cal-1" }, pending: { business_calendar_version: "cal-1" }, tariffRevisions: [], operatingCalendarRevisions: [{ version_id: "cal-1", entries: [{ id: "e1", owner: { kind: "project" }, effective_from: "2026-07-01", effective_to: "2027-01-01",
    weekly: { monday: office, tuesday: office, wednesday: office, thursday: office, friday: office, saturday: [], sunday: [] }, exceptions: [{ date: "2026-12-25", operating: [], label: "Christmas Day", classification: "public_holiday" }] }] }] } as unknown as EnergyOperationalPolicyConfigurationDto;
  const publish = vi.spyOn(configApi, "publishEnergyOperatingCalendar").mockResolvedValue({} as Awaited<ReturnType<typeof configApi.publishEnergyOperatingCalendar>>);
  vi.spyOn(configApi, "applyEnergyProjectChanges").mockResolvedValue({ hierarchy_revision_id: "h", template_revision_id: "t" });
  const refreshed = vi.fn();
  const buttons = () => Array.from(host.querySelectorAll("button"));
  const click = async (name: string) => { await act(async () => buttons().find(button => button.textContent?.trim() === name)!.click()); };
  const type = async (input: HTMLInputElement, value: string) => { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }); };
  try {
    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={policies} projectId="office" onPolicyChange={refreshed} />));
    await click("Operating hours");
    expect(host.textContent).toContain("Holidays & special days"); expect(host.textContent).toContain("1 saved");
    expect(buttons().some(button => button.textContent?.trim() === "Edit")).toBe(false);

    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={policies} projectId="office" onPolicyChange={refreshed} canEditPolicies />));
    await click("Edit");
    expect(host.textContent).toContain("Saving updates operating hours across the app straight away");
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-07-01");
    await click("Add holiday or closure");
    const dates = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    await type(dates.at(-1)!, "2026-12-31");
    const names = Array.from(host.querySelectorAll<HTMLInputElement>('input[placeholder="Christmas Day"]'));
    await type(names.at(-1)!, "Year-end break");
    await act(async () => {
      const select = Array.from(host.querySelectorAll<HTMLSelectElement>('select[aria-label="Calendar exception classification"]')).at(-1)!;
      select.value = "special_closure"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Save changes");
    expect(publish).toHaveBeenCalledWith("office", { entries: [expect.objectContaining({
      owner: { kind: "project" }, effectiveFrom: "2026-07-01", effectiveTo: "2027-01-01",
      exceptions: [
        { date: "2026-12-25", operating: [], label: "Christmas Day", classification: "public_holiday" },
        { date: "2026-12-31", operating: [], label: "Year-end break", classification: "special_closure" },
      ],
    })], academicPeriods: [] });
    expect(refreshed).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Hours saved. The whole app now uses it.");
    expect(host.textContent).not.toContain("Save changes");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it("lets editors rename a meter and add a location on the page, saving to the setup draft", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const setup = { project: { id: "office", has_unpublished_changes: false, root_scope_id: "root" }, draft: { revision: 7, document: { project: { name: "Office", timezone: "Asia/Singapore" }, tier_structure_locked: true,
    tiers: [{ id: "space", ordinal: 2, alias: "Space" }, { id: "db", ordinal: 1, alias: "Distribution Board" }],
    nodes: [{ id: "space-1", tier_definition_id: "space", name: "Space 1", sort_order: 10, metadata_status: "confirmed" }, { id: "db1", tier_definition_id: "db", parent_id: "space-1", name: "DB1", sort_order: 10, metadata_status: "confirmed" }],
    meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, rows: [{ id: "m1", source_label: "DB1 L1", display_name: "DB1 L1", presentation: { device_name: "DB1 L1 Power" }, scope_id: "db1", resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official" }], virtual_meters: [] } } } } as unknown as EnergyProjectSetupDto;
  const save = vi.spyOn(configApi, "saveEnergyProjectSetupDraft").mockResolvedValue({} as Awaited<ReturnType<typeof configApi.saveEnergyProjectSetupDraft>>);
  const apply = vi.spyOn(configApi, "applyEnergyProjectChanges").mockResolvedValue({ hierarchy_revision_id: "h", template_revision_id: "t" });
  const refreshed = vi.fn();
  const buttonNamed = (name: string) => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.trim() === name || button.getAttribute("aria-label") === name);
  const click = async (name: string) => { await act(async () => buttonNamed(name)!.click()); };
  const type = async (input: HTMLInputElement, value: string) => { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }); };
  try {
    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={null} projectId="office" onPolicyChange={refreshed} />));
    expect(buttonNamed("Edit DB1 L1 Power")).toBeUndefined();

    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={null} projectId="office" onPolicyChange={refreshed} canEditSetup />));
    await click("Edit DB1 L1 Power");
    await type(host.querySelector<HTMLInputElement>('form[aria-label^="Edit"] input')!, "Pantry sockets");
    await act(async () => host.querySelector<HTMLFormElement>('form[aria-label^="Edit"]')!.requestSubmit());
    expect(save).toHaveBeenLastCalledWith("office", { expectedRevision: 7, document: expect.objectContaining({
      meter_mapping: expect.objectContaining({ confirmed: true, rows: [expect.objectContaining({ id: "m1", presentation: { device_name: "Pantry sockets" } })] }),
    }) });
    expect(refreshed).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith("office");
    expect(host.textContent).toContain("Pantry sockets saved. The whole app now uses it.");

    await click("+ Add Space");
    const nameInput = host.querySelector<HTMLInputElement>('form[aria-label="New Space"] input')!;
    await type(nameInput, "Space 2");
    await act(async () => host.querySelector<HTMLFormElement>('form[aria-label="New Space"]')!.requestSubmit());
    expect(save).toHaveBeenLastCalledWith("office", { expectedRevision: 7, document: expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ name: "Space 2", tier_definition_id: "space" })]),
    }) });
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it("asks in the app's own words before removing a location, and removes nothing until confirmed", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const setup = { project: { id: "office", has_unpublished_changes: false, root_scope_id: "root" }, draft: { revision: 7, document: { project: { name: "Office", timezone: "Asia/Singapore" }, tier_structure_locked: true,
    tiers: [{ id: "space", ordinal: 2, alias: "Space" }, { id: "db", ordinal: 1, alias: "Distribution Board" }],
    nodes: [{ id: "space-1", tier_definition_id: "space", name: "Space 1", sort_order: 10, metadata_status: "confirmed" }, { id: "space-2", tier_definition_id: "space", name: "Boss Room", sort_order: 20, metadata_status: "confirmed" }],
    meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, rows: [{ id: "m1", source_label: "DB1 L1", display_name: "DB1 L1", scope_id: "space-1", resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official" }], virtual_meters: [] } } } } as unknown as EnergyProjectSetupDto;
  const save = vi.spyOn(configApi, "saveEnergyProjectSetupDraft").mockResolvedValue({} as Awaited<ReturnType<typeof configApi.saveEnergyProjectSetupDraft>>);
  vi.spyOn(configApi, "applyEnergyProjectChanges").mockResolvedValue({ hierarchy_revision_id: "h", template_revision_id: "t" });
  const named = (name: string) => Array.from(host.querySelectorAll("button")).filter(button => button.textContent?.trim() === name);
  try {
    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={null} projectId="office" canEditSetup />));
    // The actions sit on the location itself, in the list, not below the floor plan.
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Boss Room"))!.click());
    await act(async () => named("Remove")[0]!.click());

    const dialog = host.querySelector("dialog")!;
    expect(dialog.textContent).toContain("Remove Boss Room?");
    expect(dialog.textContent).toContain("Meters stay in the project");
    expect(save).not.toHaveBeenCalled();

    // Keeping it changes nothing at all.
    await act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Keep it")!.click());
    expect(host.querySelector("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();

    await act(async () => named("Remove")[0]!.click());
    await act(async () => Array.from(host.querySelector("dialog")!.querySelectorAll("button")).find(button => button.textContent === "Remove")!.click());
    expect(save).toHaveBeenCalledWith("office", { expectedRevision: 7, document: expect.objectContaining({
      nodes: [expect.objectContaining({ id: "space-1" })],
    }) });
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it("makes saved changes live by itself, and only asks when applying fails", async () => {
  vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); const root = createRoot(host); document.body.append(host);
  const setup = { project: { id: "office", has_unpublished_changes: true, root_scope_id: "root" }, draft: { revision: 3, document: { project: { name: "Office", timezone: "Asia/Singapore" }, tiers: [], nodes: [], meter_mapping: { rows: [], virtual_meters: [] } } } } as unknown as EnergyProjectSetupDto;
  const apply = vi.spyOn(configApi, "applyEnergyProjectChanges").mockResolvedValue({ hierarchy_revision_id: "h", template_revision_id: "t" });
  try {
    // A change left over from an earlier failure goes live on opening the page: no button to press.
    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={null} projectId="office" canEditPolicies />));
    expect(apply).toHaveBeenCalledWith("office");
    expect(host.textContent).toContain("The whole app now uses it.");
    // One attempt per saved revision: a re-render does not start it again.
    await act(async () => root.render(<ProjectConfigurationView setup={setup} notes="" policies={null} projectId="office" canEditPolicies />));
    expect(apply).toHaveBeenCalledTimes(1);

    // When it cannot go live, the reason is shown and the button comes back as the retry.
    apply.mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_DATA_NOT_READY:METER_MAPPING_NOT_CONFIRMED"));
    const pending = { ...setup, draft: { ...setup.draft, revision: 4 } } as EnergyProjectSetupDto;
    await act(async () => root.render(<ProjectConfigurationView setup={pending} notes="" policies={null} projectId="office" canEditPolicies />));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("It is not live yet: the meter data is not ready yet");
    expect([...host.querySelectorAll("button")].some(button => button.textContent === "Make live now")).toBe(true);
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks();
  }
});

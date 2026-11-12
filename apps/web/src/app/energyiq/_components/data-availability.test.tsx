/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { configApi, type EnergyDataAvailabilityDto, type EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { DataAvailability } from "./data-availability";
import { EnergyIqLocaleProvider } from "./energyiq-locale";

const document_ = {
  project: { name: "Tuya Office", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, official_aggregation_routes: [], rows: [
    { id: "blind", source_label: "Showroom Blind", scope_id: "s", display_name: "Showroom Blind", resource: "electricity", category: "other", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
  ] },
} as unknown as EnergyProjectSetupDocumentDto;

const data: EnergyDataAvailabilityDto = {
  from: "2026-09-03", to: "2026-10-02", timezone: "Asia/Singapore", targetPct: 95,
  site: { availabilityPct: 61.2, metersCounted: 2, metersBelowTarget: 1, outageCount: 1, estimatedKwh: 3, checkCount: 1 },
  meters: [
    { meterPointId: "tv", name: "Showroom TV", status: "ok", availabilityPct: 97.5, realHours: 702, estimatedHours: 0, estimatedKwh: 0, missingHours: 18, longestOutageHours: 1, offlineSince: "2026-10-02T06:15:00.000Z", checks: [] },
    { meterPointId: "router", name: "Router", location: "Office Area", status: "ok", availabilityPct: 99.2, realHours: 714, estimatedHours: 6, estimatedKwh: 3, missingHours: 0, longestOutageHours: 6, lastReadingAt: "2026-10-02T15:00:00.000Z",
      checks: [{ kind: "stuck_value", from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T06:00:00.000Z", hours: 30, kwhPerHour: 1.25 }] },
    { meterPointId: "door", name: "Side door", status: "not_in_use", notInUse: "reason:switched_off", availabilityPct: 0, realHours: 0, estimatedHours: 0, estimatedKwh: 0, missingHours: 720, longestOutageHours: 720, checks: [] },
    { meterPointId: "blind", name: "Showroom Blind", status: "no_readings", availabilityPct: 0, realHours: 0, estimatedHours: 0, estimatedKwh: 0, missingHours: 720, longestOutageHours: 720, checks: [] },
  ],
  outages: [{ meterPointId: "router", name: "Router", from: "2026-09-20T02:00:00.000Z", to: "2026-09-20T08:00:00.000Z", hours: 6, kind: "estimated", estimatedKwh: 3, ongoing: false }],
};

it("shows each meter against the target, the outages and stuck readings, and lets an editor mark a meter not in use", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const load = vi.spyOn(configApi, "getEnergyDataAvailability").mockResolvedValue(data);
  const onSave = vi.fn();
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><DataAvailability projectId="tuya-office" siteName="Tuya Office" document={document_} canEdit busy={false} error="" onSave={onSave} /></EnergyIqLocaleProvider>));
    await act(async () => undefined);
    expect(load).toHaveBeenCalledWith("tuya-office", undefined);
    const text = host.textContent ?? "";
    expect(text).toContain("61.2%");
    expect(text).toContain("Meets target");
    expect(text).toContain("No readings");
    expect(text).toContain("Router — The same reading, 1.25 kWh, every hour for 30 hours");
    // Energy used while a meter was offline is said in plain words wherever it shows.
    expect(text).toContain("Used while offline: 3 kWh, sent when it came back");
    const tile = Array.from(host.querySelectorAll("span")).find(item => item.textContent === "Used while offline")!.parentElement!;
    expect(tile.textContent).toContain("Meters kept count while offline and sent it when they came back. Only when it was used is estimated.");
    const router = Array.from(host.querySelectorAll("tbody tr")).find(row => row.textContent!.startsWith("Router"))!;
    const cell = router.querySelector("[title]")!;
    expect(cell.getAttribute("title")).toBe("Used while it was offline: 3 kWh. The meter kept count and sent it when it came back; only when it was used is estimated.");
    expect(cell.querySelector(".sr-only")!.textContent).toBe(cell.getAttribute("title"));
    expect(Array.from(host.querySelectorAll("th")).map(cell => cell.textContent)).toContain("Used while offline");
    expect(text).toContain("Switched off on purpose");
    expect(text).not.toContain("reason:switched_off");

    // One click on a reason saves it; nothing to type.
    // A meter offline right now leads the table, then those that need attention: the blind with no readings.
    const order = Array.from(host.querySelectorAll("tbody tr")).map(row => row.textContent!);
    expect(order[0]).toContain("Showroom TV");
    expect(order[0]).toContain("Offline now");
    expect(order[0]).toContain("Since 2 Oct, 02:15 pm");
    expect(order[1]).toContain("Showroom Blind");
    const mark = () => Array.from(host.querySelectorAll("tbody tr")).find(row => row.textContent!.startsWith("Showroom Blind"))!.querySelector("button")!;
    await act(async () => mark().click());
    const reason = (text: string) => Array.from(host.querySelectorAll("button")).find(button => button.textContent === text)!;
    await act(async () => reason("Nobody uses it").click());
    expect(onSave).toHaveBeenCalledTimes(1);
    const [saved, message] = onSave.mock.calls[0]! as [EnergyProjectSetupDocumentDto, string];
    expect(saved.meter_mapping!.rows[0]!.presentation).toEqual({ not_in_use: "reason:nobody_uses" });
    expect(message).toBe("Showroom Blind is marked not in use.");

    // Only "Other reason" asks for words, and only saves once there are some.
    await act(async () => mark().click());
    await act(async () => reason("Other reason…").click());
    const save = () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Save")!;
    expect(save().disabled).toBe(true);
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "Kept for events only");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => save().click());
    expect((onSave.mock.calls[1]![0] as EnergyProjectSetupDocumentDto).meter_mapping!.rows[0]!.presentation).toEqual({ not_in_use: "Kept for events only" });

    // Another month asks for exactly that month.
    const select = host.querySelector("select")!;
    const month = select.options[1]!.value;
    await act(async () => { select.value = month; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(load).toHaveBeenLastCalledWith("tuya-office", { from: `${month}-01`, to: expect.stringMatching(new RegExp(`^${month}-(28|29|30|31)$`)) });
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

it("shows a meter that is online but using nothing in neutral words, never as stopped or something to mark not in use", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  // A rarely used pavilion fan: used on the first days, then nothing since 25 September; a lobby circuit that never ran;
  // and a corridor lighting circuit still sending readings, but of 0 kWh for four days.
  const idle: EnergyDataAvailabilityDto = {
    from: "2026-09-03", to: "2026-10-02", timezone: "Asia/Singapore", targetPct: 95,
    site: { availabilityPct: 70, metersCounted: 3, metersBelowTarget: 2, outageCount: 1, estimatedKwh: 0, checkCount: 1 },
    meters: [
      { meterPointId: "fan", name: "Pavilion fan", status: "idle", availabilityPct: 73.3, realHours: 528, estimatedHours: 0, estimatedKwh: 0, missingHours: 192, longestOutageHours: 192, lastReadingAt: "2026-09-25T01:00:00.000Z",
        checks: [{ kind: "flat_zero", from: "2026-09-10T00:00:00.000Z", to: "2026-09-14T00:00:00.000Z", hours: 96, kwhPerHour: 0 }] },
      { meterPointId: "spare", name: "Spare lobby circuit", status: "idle", availabilityPct: 0, realHours: 0, estimatedHours: 0, estimatedKwh: 0, missingHours: 720, longestOutageHours: 720, lastReadingAt: "2026-08-01T01:00:00.000Z", checks: [] },
      { meterPointId: "corridor", name: "Corridor lights", status: "ok", availabilityPct: 100, realHours: 720, estimatedHours: 0, estimatedKwh: 0, missingHours: 0, longestOutageHours: 0, lastReadingAt: "2026-10-02T15:00:00.000Z",
        checks: [{ kind: "flat_zero", from: "2026-09-20T10:00:00.000Z", to: "2026-09-24T10:00:00.000Z", hours: 96, kwhPerHour: 0 }] },
    ],
    outages: [{ meterPointId: "fan", name: "Pavilion fan", from: "2026-09-25T01:00:00.000Z", to: "2026-10-02T16:00:00.000Z", hours: 183, kind: "missing", estimatedKwh: 0, ongoing: true, idle: true }],
  };
  vi.spyOn(configApi, "getEnergyDataAvailability").mockResolvedValue(idle);
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><DataAvailability projectId="estate" siteName="Estate" document={document_} canEdit busy={false} error="" onSave={vi.fn()} /></EnergyIqLocaleProvider>));
    await act(async () => undefined);
    const text = host.textContent ?? "";
    expect(text).not.toMatch(/Stopped sending|Still offline/);
    const row = (name: string) => Array.from(host.querySelectorAll("tbody tr")).find(item => item.textContent!.startsWith(name))!;
    expect(row("Pavilion fan").textContent).toContain("No use since 25 Sept, 09:00 am");
    expect(row("Pavilion fan").textContent).toContain("Still online. Its reading has not changed, so no new readings come in until it next uses energy.");
    // Days of no use from the idle fan stay a quiet note beside it, not something that needs a look.
    const note = (name: string) => Array.from(row(name).querySelectorAll("small")).find(item => item.textContent!.startsWith("No use for 96 hours"))!;
    expect(note("Pavilion fan").className).toBe("");
    expect(row("Spare lobby circuit").textContent).toContain("No use in this period");
    // A circuit still sending 0 kWh for days is not idle: its lights may not be coming on, so it still needs a look.
    const box = host.querySelector('[role="note"]')!;
    expect(box.textContent).toContain("Corridor lights — No use at all for 96 hours from 20 Sept, 06:00 pm, though it uses energy at other times. Check it is not stuck, or mark it not in use.");
    expect(box.textContent).not.toContain("Pavilion fan");
    expect(note("Corridor lights").className).not.toBe("");
    // Idle meters are in use, just rarely, so only the corridor circuit is offered "Mark not in use".
    expect(row("Pavilion fan").querySelector("button")).toBeNull();
    expect(row("Spare lobby circuit").querySelector("button")).toBeNull();
    expect(Array.from(host.querySelectorAll("tbody tr button")).map(button => button.textContent)).toEqual(["Mark not in use"]);
    expect(row("Corridor lights").querySelector("button")!.textContent).toBe("Mark not in use");
    const outage = Array.from(host.querySelectorAll("tbody tr")).at(-1)!.textContent!;
    expect(outage).toContain("Still using nothing");
    expect(outage).toContain("Online, but its reading has not changed, so no new readings came in.");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ liveConnectionRequest: vi.fn(), getEnergyProjectMeterHealth: vi.fn() }));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
import { checkReasonKey, LiveConnectionPanel, liveErrorKey, suggestMatches, type LiveConnectionDto } from "./live-connection-panel";

let container: HTMLDivElement;
let root: Root;

const meters = [
  { meterPointId: "m-incoming", name: "Incoming 3Phase", sourceLabel: "Incoming 3Phase" },
  { meterPointId: "m-a18p", name: "Aircon level 2", sourceLabel: "A18P" },
];
const devices = [
  { ref: "ref-incoming", name: "Incoming 3Phase", productName: "Smart meter", online: true },
  { ref: "ref-a18p", name: "A18P", online: false },
  { ref: "ref-spare", name: "Spare plug", online: true },
];
const connection = (overrides: Partial<LiveConnectionDto> = {}): LiveConnectionDto => ({
  projectId: "p",
  provider: "tuya",
  managedByServer: false,
  connected: false,
  publishedSetup: true,
  meters,
  matchedCount: 0,
  ready: false,
  schedule: { enabled: false, localHour: 2, timezone: "Asia/Singapore" },
  sync: { running: false },
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.liveConnectionRequest.mockReset();
  api.getEnergyProjectMeterHealth.mockReset();
  api.getEnergyProjectMeterHealth.mockResolvedValue({ meters: [], summary: { total: 0, usable: 0, insufficientHistory: 0, noReadings: 0 } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = async () => { for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); }); };
const button = (text: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement;
const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

describe("Live connection matching", () => {
  it("pairs meters with devices of the same name or code and keeps earlier choices", () => {
    expect(suggestMatches(meters, devices, {})).toEqual({ "m-incoming": "ref-incoming", "m-a18p": "ref-a18p" });
    expect(suggestMatches(meters, devices, { "m-incoming": "ref-spare" })).toEqual({ "m-incoming": "ref-spare", "m-a18p": "ref-a18p" });
  });

  it("explains Tuya refusals in plain words", () => {
    expect(liveErrorKey("ENERGYIQ_LIVE_ACCOUNT_REJECTED:ENERGYIQ_TUYA_API_ERROR:1004:sign_invalid")).toBe("error.signIn");
    expect(liveErrorKey("ENERGYIQ_LIVE_ACCOUNT_REJECTED:ENERGYIQ_TUYA_API_ERROR:1114:your_ip(1.2.3.4)_don't_have_access")).toBe("error.ip");
    expect(liveErrorKey("ENERGYIQ_LIVE_ACCOUNT_REJECTED:ENERGYIQ_TUYA_API_ERROR:28841105:No_permissions")).toBe("error.permission");
    expect(liveErrorKey("ENERGYIQ_LIVE_METERS_NOT_MATCHED")).toBe("error.notMatched");
    expect(checkReasonKey("ENERGYIQ_TUYA_PROPERTY_REQUIRED:total_forward_energy")).toBe("reason.energy");
  });
});

describe("LiveConnectionPanel", () => {
  it("connects the account, matches devices by name and saves them without showing device ids", async () => {
    api.liveConnectionRequest.mockImplementation(async (_projectId: string, action = "", init?: RequestInit) => {
      if (action === "" && !init) return { connection: connection() };
      if (action === "account") {
        expect(JSON.parse(String(init?.body))).toEqual({ accessId: "abcd1234efgh5678ijkl", accessSecret: "secretsecret1234" });
        return { connection: connection({ connected: true, accountHint: "abcd…ijkl" }), deviceCount: 3 };
      }
      if (action === "devices") return { devices };
      if (action === "check") return { check: { ok: true, deviceCount: 3, meters: [] }, connection: connection({ connected: true, accountHint: "abcd…ijkl" }) };
      if (action === "matches") {
        expect(JSON.parse(String(init?.body))).toEqual({ matches: { "m-incoming": "ref-incoming", "m-a18p": "ref-a18p" } });
        return { connection: connection({
          connected: true,
          accountHint: "abcd…ijkl",
          matchedCount: 2,
          ready: true,
          meters: meters.map((meter, index) => ({ ...meter, device: { ref: devices[index]!.ref, name: devices[index]!.name } })),
        }) };
      }
      throw new Error(`unexpected ${action}`);
    });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();

    const inputs = container.querySelectorAll("input");
    await act(async () => { setValue(inputs[0]!, "abcd1234efgh5678ijkl"); setValue(inputs[1]!, "secretsecret1234"); });
    await act(async () => { button("Connect").click(); });
    await flush();
    expect(container.textContent).toContain("Connected · Access ID abcd…ijkl");
    expect(container.textContent).toContain("3 devices found");

    // Test connection works before any meter is matched.
    await act(async () => { button("Test connection").click(); });
    await flush();
    expect(container.textContent).toContain("Connection works. 3 devices found in this account.");
    expect(container.textContent).toContain("No meters matched yet");

    await act(async () => { button("Match by name").click(); });
    expect(container.textContent).toContain("2 of 2 meters matched");
    await act(async () => { button("Save matches").click(); });
    await flush();
    expect(container.textContent).toContain("Matches saved.");
    expect(button("Fetch now").disabled).toBe(false);
  });

  it("lists the meters before an account is connected", async () => {
    api.liveConnectionRequest.mockResolvedValue({ connection: connection() });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();
    expect(container.textContent).toContain("These are the site's 2 meters");
    expect(container.textContent).toContain("Aircon level 2");
    expect(container.querySelector("select")).toBeNull();
  });

  it("shows a server-managed site's devices and checks them, without edit controls", async () => {
    api.liveConnectionRequest.mockImplementation(async (_projectId: string, action = "") => {
      if (action === "devices") return { devices };
      if (action === "check") return { check: { ok: true, deviceCount: 3, meters: meters.map((meter) => ({ meterPointId: meter.meterPointId, ok: true })) }, connection: serverConnection };
      return { connection: serverConnection };
    });
    const serverConnection = connection({
      managedByServer: true,
      connected: true,
      ready: true,
      matchedCount: 2,
      meters: meters.map((meter, index) => ({ ...meter, device: { ref: devices[index]!.ref, name: "" } })),
    });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();
    expect(container.textContent).toContain("Managed by EnergyX support");
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("Incoming 3Phase · Smart meter");
    expect(rows[1]!.textContent).toContain("Device offline");
    expect(container.querySelector("tbody select")).toBeNull();
    expect(container.querySelector("tbody button")).toBeNull();
    await act(async () => { button("Test connection").click(); });
    await flush();
    expect(container.textContent).toContain("Connection works. 3 devices found in this account.");
    expect(container.textContent).toContain("All 2 matched devices send energy readings.");
  });

  it("shows whether each meter is live, and edits or removes one meter at a time", async () => {
    const matched = (refs: Record<string, string | undefined>) => connection({
      connected: true,
      accountHint: "abcd…ijkl",
      matchedCount: Object.values(refs).filter(Boolean).length,
      ready: Object.values(refs).filter(Boolean).length === meters.length,
      schedule: { enabled: true, localHour: 2, timezone: "Asia/Singapore" },
      sync: { running: false, lastSuccessAt: new Date().toISOString(), dataUntil: new Date().toISOString() },
      meters: meters.map((meter) => refs[meter.meterPointId]
        ? { ...meter, device: { ref: refs[meter.meterPointId]!, name: devices.find((device) => device.ref === refs[meter.meterPointId])!.name } }
        : meter),
    });
    const saves: unknown[] = [];
    let current = matched({ "m-incoming": "ref-incoming", "m-a18p": "ref-a18p" });
    api.getEnergyProjectMeterHealth.mockResolvedValue({
      meters: [{ meterPointId: "m-incoming", name: "Incoming 3Phase", sourceLabel: "Incoming 3Phase", status: "usable", lastReadingAt: new Date(Date.now() - 3_600_000).toISOString() }],
      summary: { total: 2, usable: 1, insufficientHistory: 0, noReadings: 1 },
    });
    api.liveConnectionRequest.mockImplementation(async (_projectId: string, action = "", init?: RequestInit) => {
      if (action === "devices") return { devices };
      if (action === "matches") {
        const { matches } = JSON.parse(String(init?.body)) as { matches: Record<string, string> };
        saves.push(matches);
        current = matched(matches);
        return { connection: current };
      }
      return { connection: current };
    });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();

    expect(container.querySelector("[aria-label='Live']")?.textContent).toContain("Updates every day at 02:00");
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("Live");
    expect(rows[0]!.textContent).toContain("Last reading");
    expect(rows[1]!.textContent).toContain("Device offline");
    expect(container.querySelector("tbody select")).toBeNull();

    // Edit one meter: only its row gets a drop-down.
    await act(async () => { (rows[0]!.querySelector("button") as HTMLButtonElement).click(); });
    expect(container.querySelectorAll("tbody select")).toHaveLength(1);
    await act(async () => { setValue(container.querySelector("tbody select") as HTMLSelectElement, "ref-spare"); });
    await act(async () => { button("Save").click(); });
    await flush();
    expect(saves.at(-1)).toEqual({ "m-incoming": "ref-spare", "m-a18p": "ref-a18p" });
    expect(container.textContent).toContain("Incoming 3Phase saved.");

    // Remove needs a second click to confirm.
    const remove = () => [...container.querySelectorAll("tbody tr")][1]!.querySelectorAll("button")[1] as HTMLButtonElement;
    await act(async () => { remove().click(); });
    expect(remove().textContent).toBe("Click to confirm");
    await act(async () => { remove().click(); });
    await flush();
    expect(saves.at(-1)).toEqual({ "m-incoming": "ref-spare" });
    expect(container.textContent).toContain("Not live yet");
    expect([...container.querySelectorAll("tbody tr")][1]!.textContent).toContain("Not connected");
  });

  it("takes over a server-managed site, then offers to hand it back", async () => {
    const takenOver = connection({
      environmentProject: true,
      connected: true,
      accountHint: "abcd…ijkl",
      ready: true,
      matchedCount: 2,
      meters: meters.map((meter, index) => ({ ...meter, device: { ref: devices[index]!.ref, name: devices[index]!.name } })),
    });
    let current = connection({ managedByServer: true, environmentProject: true, connected: true, ready: true, matchedCount: 2 });
    const bodies: unknown[] = [];
    api.liveConnectionRequest.mockImplementation(async (_projectId: string, action = "", init?: RequestInit) => {
      if (action === "devices") return { devices };
      if (action === "account") {
        bodies.push(JSON.parse(String(init?.body)));
        current = takenOver;
        return { connection: current, deviceCount: 3 };
      }
      return { connection: current };
    });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();
    expect(container.textContent).toContain("Manage this site here instead");
    const inputs = container.querySelectorAll("input");
    await act(async () => { setValue(inputs[0]!, "abcd1234efgh5678ijkl"); setValue(inputs[1]!, "secretsecret1234"); });
    await act(async () => { button("Manage here").click(); });
    await flush();
    expect(bodies).toEqual([{ accessId: "abcd1234efgh5678ijkl", accessSecret: "secretsecret1234", takeOver: true }]);
    expect(container.textContent).toContain("This site is now managed here.");
    expect(container.textContent).toContain("Managed here. To hand it back");
    expect(button("Let support manage it")).toBeTruthy();
    expect([...container.querySelectorAll("tbody tr")][0]!.textContent).toContain("Edit");
  });
});

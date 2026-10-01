/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ liveConnectionRequest: vi.fn() }));
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

    await act(async () => { button("Match by name").click(); });
    expect(container.textContent).toContain("2 of 2 meters matched");
    await act(async () => { button("Save matches").click(); });
    await flush();
    expect(container.textContent).toContain("Matches saved.");
    expect(button("Fetch now").disabled).toBe(false);
  });

  it("shows a server-managed site without edit controls", async () => {
    api.liveConnectionRequest.mockResolvedValue({ connection: connection({ managedByServer: true, connected: true, ready: true }) });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();
    expect(container.textContent).toContain("Connected through the server settings");
    expect(container.querySelector("input")).toBeNull();
  });
});

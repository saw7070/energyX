/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ liveConnectionRequest: vi.fn(), getEnergyProjectMeterHealth: vi.fn() }));
const publish = vi.hoisted(() => ({ setUpAndPublishReadings: vi.fn() }));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
vi.mock("../admin/smart-import-publish", () => publish);
import { LiveConnectionPanel, type LiveConnectionDto } from "./live-connection-panel";

let container: HTMLDivElement;
let root: Root;

const meters = [
  { meterPointId: "m-incoming", name: "Incoming 3Phase", sourceLabel: "Incoming 3Phase" },
  { meterPointId: "m-a18p", name: "A18P", sourceLabel: "A18P" },
];
const connection = (overrides: Partial<LiveConnectionDto> = {}): LiveConnectionDto => ({
  projectId: "p",
  provider: "tuya",
  managedByServer: false,
  connected: true,
  publishedSetup: false,
  meters: [],
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
  publish.setUpAndPublishReadings.mockReset();
  publish.setUpAndPublishReadings.mockResolvedValue(2);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = async () => { for (let index = 0; index < 8; index += 1) await act(async () => { await Promise.resolve(); }); };
const setValue = (element: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (text: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement;

describe("Start from Tuya", () => {
  it("creates one meter per ticked device, matches each to its device and turns on daily updates", async () => {
    const live = connection({ publishedSetup: true, meters, matchedCount: 2, ready: true, schedule: { enabled: true, localHour: 2, timezone: "Asia/Singapore" } });
    api.liveConnectionRequest.mockImplementation(async (_project: string, path = "", init?: RequestInit) => {
      if (path === "" && !init) return { connection: publish.setUpAndPublishReadings.mock.calls.length ? connection({ publishedSetup: true, meters }) : connection() };
      if (path === "devices") return { devices: [
        { ref: "ref-incoming", name: "Incoming 3Phase", productName: "Smart meter", online: true },
        { ref: "ref-a18p", name: "A18P", online: true },
        { ref: "ref-spare", name: "Spare plug", online: false },
        { ref: "ref-hub", name: "Hub", productName: "Zigbee Gateway", category: "wg2", online: true },
      ] };
      if (path === "starter") return { devices: [{ ref: "ref-incoming", sourceLabel: "Incoming 3Phase" }, { ref: "ref-a18p", sourceLabel: "A18P" }] };
      if (path === "matches" || path === "schedule" || path === "sync") return { connection: live };
      throw new Error(`unexpected ${path}`);
    });

    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();

    expect(container.textContent).toContain("Start from Tuya");
    // Gateways are not offered as meters.
    expect(container.textContent).not.toContain("Hub");
    const spare = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Spare plug"))!.querySelector("input")!;
    await act(async () => spare.click());
    await act(async () => button("Create 2 meters").click());
    await flush();

    const calls = api.liveConnectionRequest.mock.calls as Array<[string, string?, RequestInit?]>;
    const body = (path: string) => JSON.parse(String(calls.find((call) => call[1] === path)![2]!.body));
    expect(body("starter")).toEqual({ deviceRefs: ["ref-incoming", "ref-a18p"] });
    expect(publish.setUpAndPublishReadings).toHaveBeenCalledWith("p", expect.objectContaining({ board: expect.any(String) }));
    expect(body("matches")).toEqual({ matches: { "m-incoming": "ref-incoming", "m-a18p": "ref-a18p" } });
    expect(body("schedule")).toEqual({ enabled: true, localHour: 2 });
    expect(calls.some((call) => call[1] === "sync")).toBe(true);
    expect(container.textContent).toContain("2 meters created and connected to Tuya");
  });

  it("asks for the Tuya key first when no account is connected, and explains a failed start", async () => {
    api.liveConnectionRequest.mockImplementation(async (_project: string, path = "", init?: RequestInit) => {
      if (path === "" && !init) return { connection: connection({ connected: false }) };
      if (path === "account") return { connection: connection() };
      if (path === "devices") return { devices: [{ ref: "ref-a18p", name: "A18P", online: true }] };
      if (path === "starter") throw new Error("ENERGYIQ_LIVE_STARTER_NO_READINGS");
      throw new Error(`unexpected ${path}`);
    });
    await act(async () => root.render(<LiveConnectionPanel projectId="p" />));
    await flush();
    expect(container.textContent).not.toContain("Tick the devices");
    const [id, secret] = [...container.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => { setValue(id!, "abcd1234efgh5678"); setValue(secret!, "secretsecretsecret1234"); });
    await act(async () => button("Connect").click());
    await flush();
    const account = (api.liveConnectionRequest.mock.calls as Array<[string, string?, RequestInit?]>).find((call) => call[1] === "account")!;
    expect(JSON.parse(String(account[2]!.body))).toEqual({ accessId: "abcd1234efgh5678", accessSecret: "secretsecretsecret1234" });
    expect(container.textContent).toContain("Tick the devices");

    await act(async () => button("Create 1 meter").click());
    await flush();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Tuya sent no readings");
    expect(publish.setUpAndPublishReadings).not.toHaveBeenCalled();
  });
});

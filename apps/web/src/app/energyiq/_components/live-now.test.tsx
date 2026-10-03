/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { configApi, type EnergyLiveReadingsDto } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LiveNow } from "./live-now";

const live = (overrides: Partial<EnergyLiveReadingsDto>): EnergyLiveReadingsDto => ({
  connected: true,
  officialMeterCount: 2,
  reportingMeterCount: 2,
  meters: [],
  intervalMinutes: 15,
  ...overrides,
});

const render = async (value: EnergyLiveReadingsDto) => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(configApi, "getEnergyLiveReadings").mockResolvedValue(value);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><LiveNow projectId="smrt" /></EnergyIqLocaleProvider>));
  await act(async () => undefined);
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); } };
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shows the site's power now and energy so far today", async () => {
  const { host, close } = await render(live({ readAt: "2026-10-02T02:15:00.000Z", powerKw: 42.36, todayKwh: 318.4 }));
  try {
    expect(host.textContent).toContain("Live now");
    expect(host.textContent).toContain("Using 42.4 kW now");
    expect(host.textContent).toContain("318.4 kWh so far today");
    expect(host.textContent).toContain("every 15 minutes");
  } finally { await close(); }
});

it("says how many main meters report instead of showing an undercounted total", async () => {
  const { host, close } = await render(live({ readAt: "2026-10-02T02:15:00.000Z", reportingMeterCount: 1 }));
  try {
    expect(host.textContent).toContain("1 of 2 main meters are reporting");
    expect(host.textContent).not.toContain("kW now");
  } finally { await close(); }
});

it("shows nothing for a site without a live connection", async () => {
  const { host, close } = await render(live({ connected: false }));
  try {
    expect(host.textContent).toBe("");
  } finally { await close(); }
});

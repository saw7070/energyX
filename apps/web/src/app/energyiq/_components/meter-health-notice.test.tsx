/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { configApi, type EnergyMeterHealthDto } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { MeterHealthNotice, PendingDayNote, resetMeterHealthRequests, StoppedMetersNote, stoppedMeters } from "./meter-health-notice";

const health = (meters: EnergyMeterHealthDto["meters"]): EnergyMeterHealthDto => ({
  meters,
  summary: { total: meters.length, usable: meters.filter(m => m.status === "usable").length, insufficientHistory: meters.filter(m => m.status === "insufficient_history").length, noReadings: meters.filter(m => m.status === "no_readings").length },
});

const renderNode = async (value: EnergyMeterHealthDto, node: React.ReactNode) => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetMeterHealthRequests();
  vi.spyOn(configApi, "getEnergyProjectMeterHealth").mockResolvedValue(value);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  await act(async () => undefined);
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); } };
};

const render = async (value: EnergyMeterHealthDto) => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(configApi, "getEnergyProjectMeterHealth").mockResolvedValue(value);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><MeterHealthNotice projectId="office" /></EnergyIqLocaleProvider>));
  await act(async () => undefined);
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); } };
};

it("names the meters that stopped reporting, and says how long ago", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
  const { host, close } = await render(health([
    { meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-22T17:45:00.000Z" },
    { meterPointId: "b", name: "Director Room Power", sourceLabel: "Panel A Meter 05", status: "insufficient_history", lastReadingAt: "2026-08-19T11:06:50.204Z" },
    { meterPointId: "c", name: "Showroom Blind", sourceLabel: "Panel B Meter 09", status: "no_readings" },
  ]));
  try {
    // The meter's own name, not the panel circuit it arrives on.
    expect(host.textContent).toContain("2 meters are not sending readings");
    expect(host.textContent).toContain("Director Room Power");
    expect(host.textContent).toContain("last sent a reading on 19 August, 34 days ago");
    expect(host.textContent).toContain("has never sent a reading");
    expect(host.textContent).not.toContain("Panel A Total");
    expect(host.textContent).toContain("They were working before, so something at the site has changed");
    expect(host.textContent).toContain("the socket or breaker it sits on");
  } finally { await close(); vi.useRealTimers(); }
});

it("stays out of the way when every meter is reporting", async () => {
  const { host, close } = await render(health([{ meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-22T17:45:00.000Z" }]));
  try { expect(host.textContent).toBe(""); } finally { await close(); }
});

it("explains why the newest day is not counted yet, instead of looking stuck", async () => {
  // Readings arrived for 22 Sep, but two meters went quiet before midnight, so the figures stop at 21 Sep.
  const value: EnergyMeterHealthDto = {
    ...({ summary: { total: 3, usable: 3, insufficientHistory: 0, noReadings: 0 } } as Pick<EnergyMeterHealthDto, "summary">),
    dataThrough: "2026-09-22T17:45:00.000Z",
    meters: [
      { meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-22T17:15:00.000Z" },
      { meterPointId: "b", name: "Panel A Lighting", sourceLabel: "Panel A Lighting", status: "usable", lastReadingAt: "2026-09-22T14:30:00.000Z" },
      { meterPointId: "c", name: "TV Meeting Room 2", sourceLabel: "Panel B Meter 07", status: "usable", lastReadingAt: "2026-09-22T08:30:00.000Z" },
    ],
  };
  const { host, close } = await renderNode(value, <PendingDayNote projectId="office" lastLocalDay="2026-09-21" timezone="Asia/Singapore" />);
  try {
    expect(host.textContent).toContain("22 September isn't counted yet");
    expect(host.textContent).toContain("some readings are still coming in");
    expect(host.textContent).toContain("added after the next update");
  } finally { await close(); }
});

it("says nothing when the figures already reach the newest day", async () => {
  const value: EnergyMeterHealthDto = {
    summary: { total: 1, usable: 1, insufficientHistory: 0, noReadings: 0 },
    dataThrough: "2026-09-22T17:45:00.000Z",
    meters: [{ meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-22T17:15:00.000Z" }],
  };
  const { host, close } = await renderNode(value, <PendingDayNote projectId="office" lastLocalDay="2026-09-23" timezone="Asia/Singapore" />);
  try { expect(host.textContent).toBe(""); } finally { await close(); }
});

it("counts a meter as stopped only once it falls behind the others, not by reporting jitter", () => {
  // The Tuya Office shape: most meters an interval apart, four hours behind.
  const meters: EnergyMeterHealthDto["meters"] = [
    { meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-24T00:45:00.000Z" },
    { meterPointId: "b", name: "Panel A Meter 04", sourceLabel: "Panel A Meter 04", status: "usable", lastReadingAt: "2026-09-23T23:45:00.000Z" },
    { meterPointId: "c", name: "Office Area Light", sourceLabel: "Panel A Lighting", status: "usable", lastReadingAt: "2026-09-23T13:15:00.000Z" },
    { meterPointId: "d", name: "Panel B Meter 05", sourceLabel: "Panel B Meter 05", status: "usable", lastReadingAt: "2026-09-23T08:45:00.000Z" },
    { meterPointId: "e", name: "Never Sent", sourceLabel: "Panel C Meter 09", status: "no_readings" },
  ];

  // An hour behind is how healthy meters look, and an evening of quiet is ordinary;
  // only the meter silent past half a day counts.
  expect(stoppedMeters(meters).map(meter => meter.name)).toEqual(["Panel B Meter 05"]);
  expect(stoppedMeters([])).toEqual([]);
});

it("tells the Overview which meters stopped and from when", async () => {
  const { host, close } = await renderNode(health([
    { meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-24T00:45:00.000Z" },
    { meterPointId: "c", name: "Office Area Light", sourceLabel: "Panel A Lighting", status: "usable", lastReadingAt: "2026-09-23T13:15:00.000Z" },
    { meterPointId: "d", name: "Panel B Meter 05", sourceLabel: "Panel B Meter 05", status: "usable", lastReadingAt: "2026-09-23T08:45:00.000Z" },
  ]), <StoppedMetersNote projectId="office" />);

  const text = host.textContent ?? "";
  expect(text).toContain("One meter stopped sending");
  expect(text).toContain("the figures below do not include it from that point");
  expect(text).toContain("Panel B Meter 05");
  await close();
});

it("says nothing on the Overview while every meter is still sending", async () => {
  const { host, close } = await renderNode(health([
    { meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-24T00:45:00.000Z" },
    { meterPointId: "b", name: "Panel A Meter 04", sourceLabel: "Panel A Meter 04", status: "usable", lastReadingAt: "2026-09-23T23:45:00.000Z" },
    // Switched off at the end of the working day, which is not a fault.
    { meterPointId: "c", name: "Showroom Light", sourceLabel: "Panel B Lighting", status: "usable", lastReadingAt: "2026-09-23T16:30:00.000Z" },
  ]), <StoppedMetersNote projectId="office" />);

  expect(host.textContent).toBe("");
  await close();
});

it("does not promise a pending day will arrive once a meter has stopped", async () => {
  const value = health([
    { meterPointId: "a", name: "Panel A Total", sourceLabel: "Panel A Total", status: "usable", lastReadingAt: "2026-09-24T00:45:00.000Z" },
    { meterPointId: "d", name: "Panel B Meter 05", sourceLabel: "Panel B Meter 05", status: "usable", lastReadingAt: "2026-09-23T08:45:00.000Z" },
  ]);
  const { host, close } = await renderNode({ ...value, dataThrough: "2026-09-24T00:45:00.000Z" }, <PendingDayNote projectId="office" lastLocalDay="2026-09-22" timezone="Asia/Singapore" />);

  const text = host.textContent ?? "";
  expect(text).toContain("will not complete on its own");
  expect(text).toContain("one meter stopped sending partway through it");
  // The old wording sent the reader away to wait for an update that never fixes it.
  expect(text).not.toContain("next update");
  await close();
});

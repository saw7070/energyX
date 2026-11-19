/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  reportActionRequest: vi.fn(),
  getEnergyProjectAlerts: vi.fn(),
  markEnergyProjectAlertRead: vi.fn(),
  getEnergyProjectMeterHealth: vi.fn(),
  getEnergyLiveReadings: vi.fn(),
}));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
import { EnergyIqNotificationBell, offlineKey, stoppedKey } from "./energyiq-notification-bell";
import { resetMeterHealthRequests } from "./meter-health-notice";

let container: HTMLDivElement;
let root: Root;

const health = {
  meters: [
    { meterPointId: "m1", name: "Panel A Total", sourceLabel: "A", status: "usable", lastReadingAt: "2026-10-01T16:00:00.000Z" },
    { meterPointId: "m5", name: "Meter 05", sourceLabel: "B", status: "usable", lastReadingAt: "2026-09-23T09:00:00.000Z" },
    { meterPointId: "m6", name: "Meter 06", sourceLabel: "C", status: "usable", lastReadingAt: "2026-09-23T10:00:00.000Z" },
  ],
  summary: { total: 3, usable: 3, insufficientHistory: 0, noReadings: 0 },
};
const alerts = {
  reports: [{ key: "report:r1", reportId: "r1", cadence: "weekly", from: "2026-09-21", toExclusive: "2026-09-28", finishedAt: "2026-09-28T01:00:00.000Z" }],
  sync: { key: "sync:2026-10-01T18:00:05.000Z", failedAt: "2026-10-01T18:00:05.000Z", reason: "ip-blocked" },
  readKeys: [] as string[],
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(api)) fn.mockReset();
  resetMeterHealthRequests();
  api.getEnergyProjectMeterHealth.mockResolvedValue(health);
  api.getEnergyProjectAlerts.mockResolvedValue(alerts);
  api.reportActionRequest.mockResolvedValue({ items: [{ actionId: "a1", title: "Switch off the LED wall at night", runId: "run-1" }] });
  api.markEnergyProjectAlertRead.mockResolvedValue({ read: true });
  api.getEnergyLiveReadings.mockResolvedValue({ connected: true, officialMeterCount: 0, reportingMeterCount: 0, meters: [], offline: [], intervalMinutes: 15 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = async () => { for (let index = 0; index < 6; index += 1) await act(async () => { await Promise.resolve(); }); };
const openBell = async () => {
  await act(async () => root.render(<EnergyIqNotificationBell projectId="p1" />));
  await flush();
  await act(async () => { container.querySelector("button")!.click(); });
};

describe("Notification bell", () => {
  it("shows a failed daily update, stopped meters, a ready report and an action result", async () => {
    await openBell();
    const rows = [...container.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("The daily update didn't finish");
    expect(rows[0]).toContain("Tuya refused this server's internet address");
    // Newest first: the failed update (1 Oct), the weekly report (28 Sep), then the meters that stopped (23 Sep).
    expect(rows[1]).toContain("Your weekly report is ready");
    expect(rows[1]).toContain("21 Sept 2026 – 27 Sept 2026");
    expect(rows[2]).toContain("2 meters stopped sending readings");
    expect(rows[2]).toContain("Meter 05, Meter 06");
    expect(rows[3]).toContain("Switch off the LED wall at night");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Notifications, 4 new");
    const links = [...container.querySelectorAll("li a")].map((link) => link.getAttribute("href"));
    expect(links[0]).toBe("/energyiq/project-configuration?projectId=p1&connection=live");
    expect(links[1]).toBe("/energyiq/library?projectId=p1&reportId=r1");
    expect(links[2]).toBe("/energyiq/project-configuration?projectId=p1&tab=devices");
  });

  it("forgets an alert once it is opened, and hides what was read before", async () => {
    api.getEnergyProjectAlerts.mockResolvedValue({ ...alerts, readKeys: [stoppedKey(health.meters.slice(1))] });
    await openBell();
    expect(container.textContent).not.toContain("stopped sending");
    const report = [...container.querySelectorAll("li a")].find((link) => link.textContent?.includes("weekly report")) as HTMLAnchorElement;
    report.addEventListener("click", (event) => event.preventDefault());
    await act(async () => { report.click(); });
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledWith("p1", "report:r1");
    await act(async () => { container.querySelector("button")!.click(); });
    expect(container.textContent).not.toContain("weekly report");
  });

  it("marks one notification read without opening it, action results included", async () => {
    await openBell();
    const markButton = (text: string) => [...container.querySelectorAll("li")].find((row) => row.textContent?.includes(text))!.querySelector("button")!;
    expect(markButton("weekly report").getAttribute("aria-label")).toBe("Mark “Your weekly report is ready” as read");
    await act(async () => { markButton("weekly report").click(); });
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledWith("p1", "report:r1");
    expect(container.textContent).not.toContain("weekly report");
    // The list stays open, and the bell counts one fewer.
    expect(container.querySelectorAll("li")).toHaveLength(3);
    await act(async () => { markButton("LED wall").click(); });
    expect(api.reportActionRequest).toHaveBeenCalledWith("p1", "notifications/run-1", { method: "POST", body: "{}" });
    expect(container.textContent).not.toContain("LED wall");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Notifications, 2 new");
  });

  it("marks every notification read at once", async () => {
    await openBell();
    const all = [...container.querySelectorAll("button")].find((button) => button.textContent === "Mark all as read")!;
    await act(async () => { all.click(); });
    await flush();
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledTimes(3);
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledWith("p1", "sync:2026-10-01T18:00:05.000Z");
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledWith("p1", stoppedKey(health.meters.slice(1)));
    expect(api.reportActionRequest).toHaveBeenCalledWith("p1", "notifications/run-1", { method: "POST", body: "{}" });
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.textContent).toContain("You're all caught up");
    expect(container.textContent).not.toContain("Mark all as read");
  });

  it("does not call a meter stopped when the live check finds it online and it is simply using nothing", async () => {
    api.getEnergyProjectMeterHealth.mockResolvedValue({ ...health, meters: health.meters.map((meter) => meter.meterPointId === "m5" ? { ...meter, name: "Pavilion fan", idleWhenQuiet: true } : meter) });
    await openBell();
    const rows = [...container.querySelectorAll("li")].map((row) => row.textContent ?? "");
    expect(rows.find((row) => row.includes("stopped sending"))).toContain("Meter 06 stopped sending readings");
    expect(rows.join(" ")).not.toContain("Pavilion fan");
  });

  it("says within the hour that a meter went offline, links to Data availability and does not repeat it as stopped", async () => {
    const offline = [{ meterPointId: "m5", name: "Meter 05", since: "2026-10-03T06:15:00.000Z" }];
    api.getEnergyLiveReadings.mockResolvedValue({ connected: true, officialMeterCount: 0, reportingMeterCount: 0, meters: [], offline, intervalMinutes: 15 });
    await openBell();
    const rows = [...container.querySelectorAll("li")];
    const row = rows.find((item) => item.textContent?.includes("Meter 05 went offline"))!;
    expect(row.textContent).toContain("Offline since 3 Oct, 2:15 pm");
    expect(row.querySelector("a")!.getAttribute("href")).toBe("/energyiq/project-configuration?projectId=p1&tab=availability");
    // Meter 06 is still only stopped; Meter 05 is not listed twice.
    expect(rows.find((item) => item.textContent?.includes("Meter 06 stopped sending readings"))).toBeDefined();
    expect(rows.filter((item) => item.textContent?.includes("Meter 05"))).toHaveLength(1);
    await act(async () => { row.querySelector("button")!.click(); });
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledWith("p1", offlineKey(offline));
  });

  it("leaves offline and stopped meters out for people who do not look after the hardware", async () => {
    const offline = [{ meterPointId: "m5", name: "Meter 05", since: "2026-10-03T06:15:00.000Z" }];
    api.getEnergyLiveReadings.mockResolvedValue({ connected: true, officialMeterCount: 0, reportingMeterCount: 0, meters: [], offline, intervalMinutes: 15 });
    const neverUsed = { key: "never-used:m9:20261002", readKey: "never-used:m9:20261002", kind: "never_used", status: "open", openedAt: "2026-10-02T12:00:00.000Z",
      details: { meterId: "m9", meterName: "Pavilion fan", totalKwh: 0.4, start: "2026-10-02T11:00:00.000Z", hours: 1 } };
    api.getEnergyProjectAlerts.mockResolvedValue({ ...alerts, hardware: false, meterAlerts: [neverUsed] });
    await openBell();
    const text = container.textContent ?? "";
    expect(text).not.toContain("went offline");
    expect(text).not.toContain("stopped sending");
    // Everything else the site's staff should know still shows.
    expect(text).toContain("Your weekly report is ready");
    expect(text).toContain("Switch off the LED wall at night");
    expect(text).toContain("Pavilion fan");
  });

  it("still shows offline and stopped meters to the people who look after the hardware", async () => {
    const offline = [{ meterPointId: "m5", name: "Meter 05", since: "2026-10-03T06:15:00.000Z" }];
    api.getEnergyLiveReadings.mockResolvedValue({ connected: true, officialMeterCount: 0, reportingMeterCount: 0, meters: [], offline, intervalMinutes: 15 });
    api.getEnergyProjectAlerts.mockResolvedValue({ ...alerts, hardware: true });
    await openBell();
    const text = container.textContent ?? "";
    expect(text).toContain("Meter 05 went offline");
    expect(text).toContain("Meter 06 stopped sending readings");
  });

  it("shows the meter alerts the server keeps, with their own icons and links, and does not repeat a stopped meter", async () => {
    const meterAlerts = [
      { key: "meter-offline:a:20261002T1830", readKey: "meter-offline:a:20261002T1830", kind: "meter_offline", status: "open", openedAt: "2026-10-03T00:00:00.000Z",
        details: { location: "Block 264F", since: "2026-10-02T10:30:00.000Z", meters: ["m5", "m6", "x3", "x4"].map((id, index) => ({ id, name: `Meter 0${index + 5}`, since: "2026-10-02T10:30:00.000Z" })) } },
      { key: "meter-offline:b:20260920T0900", readKey: "meter-offline:b:20260920T0900:back", kind: "meter_offline", status: "resolved", openedAt: "2026-10-02T23:00:00.000Z", resolvedAt: "2026-10-02T23:30:00.000Z",
        details: { since: "2026-10-01T01:00:00.000Z", back: "2026-10-02T23:00:00.000Z", filledLateKwh: 1.2, meters: [{ id: "p1", name: "Pavilion 1", since: "2026-10-01T01:00:00.000Z" }] } },
      { key: "never-used:c:20261001T2300", readKey: "never-used:c:20261001T2300", kind: "never_used", status: "resolved", openedAt: "2026-10-02T20:00:00.000Z", resolvedAt: "2026-10-02T20:00:00.000Z",
        details: { meterName: "Pavilion DL & fan", start: "2026-10-01T15:00:00.000Z", hours: 2, totalKwh: 0.55, ongoing: false } },
      { key: "usage-pattern:d:20261001T2200", readKey: "usage-pattern:d:20261001T2200", kind: "usage_pattern", status: "open", openedAt: "2026-10-02T19:00:00.000Z",
        details: { meterName: "Block 264F L2–L17", direction: "high", at: "2026-10-01T14:00:00.000Z", start: "2026-10-01T14:00:00.000Z", hours: 2, kwh: 6.1, usualKwh: 4, ongoing: true } },
    ];
    api.getEnergyProjectAlerts.mockResolvedValue({ ...alerts, sync: undefined, reports: [], meterAlerts });
    await openBell();
    const rows = [...container.querySelectorAll("li")];
    const row = (text: string) => rows.find((item) => item.textContent?.includes(text))!;
    expect(row("4 meters in Block 264F stopped sending at 6:30 pm — likely their gateway").textContent).toContain("Meter 05, Meter 06, Meter 07, Meter 08. Check that their gateway still has power and is online.");
    expect(row("Pavilion 1 has stopped sending readings since 1 Oct, 9:00 am").textContent).toContain("Back since 3 Oct, 7:00 am; readings sent late were filled in.");
    expect(row("Pavilion DL & fan used 0.55 kWh at 11 pm — it should never use power").textContent).toContain("2 hours in a row from 1 Oct, 11:00 pm. Someone may be using it without leave.");
    expect(row("Block 264F L2–L17 used 6.1 kW at 10 pm, usually about 4.0 kW").textContent).toContain("2 hours in a row");
    expect(rows.map((item) => item.getAttribute("data-kind"))).toEqual(expect.arrayContaining(["meter-offline", "never-used", "pattern"]));
    expect(row("Block 264F stopped").querySelector("a")!.getAttribute("href")).toBe("/energyiq/project-configuration?projectId=p1&tab=availability");
    expect(row("Pavilion DL & fan").querySelector("a")!.getAttribute("href")).toBe("/energyiq/analysis?projectId=p1");
    // Meters 05 and 06 are in the gateway alert, so the older "stopped sending" line is not shown for them.
    expect(rows.some((item) => item.textContent?.includes("meters stopped sending readings"))).toBe(false);
    await act(async () => { row("Pavilion 1").querySelector("button")!.click(); });
    expect(api.markEnergyProjectAlertRead).toHaveBeenCalledWith("p1", "meter-offline:b:20260920T0900:back");
  });

  it("treats a site without the action pilot as having no action results, not as a failure", async () => {
    api.reportActionRequest.mockRejectedValue(new Error("ACTION_ACCESS_NOT_ENABLED"));
    api.getEnergyProjectAlerts.mockResolvedValue({ reports: [], readKeys: [] });
    api.getEnergyProjectMeterHealth.mockResolvedValue({ meters: [], summary: { total: 0, usable: 0, insufficientHistory: 0, noReadings: 0 } });
    await openBell();
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("You're all caught up");
  });
});

describe("alert times", () => {
  const words = { today: (time: string) => `Today, ${time}`, yesterday: (time: string) => `Yesterday, ${time}`, dayAt: (day: string, time: string) => `${day}, ${time}` };
  // Friday 16 October 2026, 10:00 in Singapore.
  const now = Date.parse("2026-10-16T02:00:00.000Z");
  it("says today, yesterday, the weekday within a week, then the date, in Singapore time", async () => {
    const { alertTime } = await import("./energyiq-notification-bell");
    expect(alertTime("2026-10-15T22:05:00.000Z", "en-SG", words, now)).toBe("Today, 6:05 am");
    expect(alertTime("2026-10-15T15:00:00.000Z", "en-SG", words, now)).toBe("Yesterday, 11:00 pm");
    expect(alertTime("2026-10-14T08:15:00.000Z", "en-SG", words, now)).toBe("Wednesday, 4:15 pm");
    expect(alertTime("2026-10-01T08:15:00.000Z", "en-SG", words, now)).toBe("1 Oct, 4:15 pm");
  });
});

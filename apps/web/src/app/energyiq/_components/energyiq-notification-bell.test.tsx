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
    expect(rows[1]).toContain("2 meters stopped sending readings");
    expect(rows[1]).toContain("Meter 05, Meter 06");
    expect(rows[2]).toContain("Your weekly report is ready");
    expect(rows[2]).toContain("21 Sept 2026 – 27 Sept 2026");
    expect(rows[3]).toContain("Switch off the LED wall at night");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Notifications, 4 new");
    const links = [...container.querySelectorAll("li a")].map((link) => link.getAttribute("href"));
    expect(links[0]).toBe("/energyiq/project-configuration?projectId=p1&connection=live");
    expect(links[1]).toBe("/energyiq/project-configuration?projectId=p1&tab=devices");
    expect(links[2]).toBe("/energyiq/library?projectId=p1&reportId=r1");
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

  it("treats a site without the action pilot as having no action results, not as a failure", async () => {
    api.reportActionRequest.mockRejectedValue(new Error("ACTION_ACCESS_NOT_ENABLED"));
    api.getEnergyProjectAlerts.mockResolvedValue({ reports: [], readKeys: [] });
    api.getEnergyProjectMeterHealth.mockResolvedValue({ meters: [], summary: { total: 0, usable: 0, insufficientHistory: 0, noReadings: 0 } });
    await openBell();
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("You're all caught up");
  });
});

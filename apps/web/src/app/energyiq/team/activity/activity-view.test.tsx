/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { OrganisationActivity } from "./activity-client";

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const organisation = { id: "w1", name: "Elite IOT" };
const client = () => ({
  listEnergyOrganisationActivity: vi.fn()
    .mockResolvedValueOnce({
      organisation,
      events: [
        { id: "1", at: "2026-10-29T03:00:00.000Z", type: "energyiq.support_access", label: "EnergyX support looked at your data", who: "Sam (EnergyX)", email: "sam@energyx.test", support: true, project: "KL office" },
        { id: "2", at: "2026-10-29T02:00:00.000Z", type: "auth.login_failed", label: "Failed sign-in attempt", who: "Alex Tan", email: "alex@elite.test", ip: "203.0.113.9" },
        { id: "3", at: "2026-10-28T02:00:00.000Z", type: "energyiq.team_member_removed", label: "Removed a team member", who: "Priya", target: "viewer@elite.test" },
      ],
      next: "cursor-1",
    })
    .mockResolvedValue({ organisation, events: [{ id: "4", at: "2026-10-01T02:00:00.000Z", type: "auth.login_succeeded", label: "Signed in", who: "Alex Tan" }] }),
  downloadEnergyOrganisationActivity: vi.fn().mockResolvedValue({ blob: new Blob(["x"]), filename: "elite-iot-activity.csv" }),
  getEnergyTeam: vi.fn().mockResolvedValue({ organisation, roles: [], members: [{ id: "alex", displayName: "Alex Tan", email: "alex@elite.test", status: "active", roleName: "Viewer", canChange: true }] }),
});

const mount = async (api: ReturnType<typeof client>) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OrganisationActivity client={api as never} today={new Date(2026, 9, 30)} />));
  return { host, root };
};

it("lists the client's activity in plain words, marks EnergyX support and failed sign-ins, and pages on", async () => {
  const api = client();
  const { host, root } = await mount(api);
  expect(host.textContent).toContain("when EnergyX support looked at Elite IOT’s data");
  expect(host.textContent).toContain("EnergyX support looked at your data");
  expect(Array.from(host.querySelectorAll("span")).find((span) => span.textContent === "EnergyX support")).toBeTruthy();
  expect(Array.from(host.querySelectorAll("span")).find((span) => span.textContent === "Failed sign-in attempt")!.className).toContain("text-rose-700");
  expect(host.textContent).toContain("viewer@elite.test");
  expect(host.textContent).toContain("203.0.113.9");
  // The last 30 days by default, from the start of that day.
  expect(api.listEnergyOrganisationActivity).toHaveBeenCalledWith({ from: new Date(2026, 8, 30).toISOString(), limit: 100 });

  await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Show more")!.click());
  expect(api.listEnergyOrganisationActivity).toHaveBeenLastCalledWith(expect.objectContaining({ before: "cursor-1" }));
  expect(host.textContent).toContain("Showing 4 entries");
  await act(async () => root.unmount());
});

it("filters by dates and downloads exactly what is filtered", async () => {
  const api = client();
  const { host, root } = await mount(api);
  const setDate = async (label: string, value: string) => {
    const input = host.querySelector(`input[aria-label='${label}']`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await setDate("From", "2026-10-01");
  await setDate("To", "2026-10-15");
  const filter = { from: new Date(2026, 9, 1).toISOString(), to: new Date(2026, 9, 16).toISOString() };
  expect(api.listEnergyOrganisationActivity).toHaveBeenLastCalledWith({ ...filter, limit: 100 });

  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:activity");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Download CSV"))!.click());
  expect(api.downloadEnergyOrganisationActivity).toHaveBeenCalledWith(filter);
  expect(click).toHaveBeenCalled();
  await act(async () => root.unmount());
});

/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { MeterAlertRecipients } from "./meter-alert-recipients";

let host: HTMLDivElement;
let root: Root;
let stored: { hardwareEmails: string[]; canEditRecipients: boolean };
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  stored = { hardwareEmails: ["installer@meters.example"], canEditRecipients: true };
  vi.spyOn(configApi, "meterAlertSettingsRequest").mockImplementation(async (_projectId, init) => {
    if (init?.method === "PUT") stored = { ...stored, ...JSON.parse(String(init.body)) };
    return { projectId: "sktc", patternAlerts: true, maxHardwareEmails: 5, canEditPattern: false, ...stored } as never;
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const render = async () => {
  await act(async () => root.render(<EnergyIqLocaleProvider><MeterAlertRecipients projectId="sktc" /></EnergyIqLocaleProvider>));
  await act(async () => undefined);
};
const type = async (value: string) => {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async () => { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await act(async () => undefined); };

it("adds checked addresses for stopped-meter alerts, up to five, and removes them", async () => {
  await render();
  expect(host.textContent).toContain("Send meter alerts to");
  expect(host.textContent).toContain("platform administrators and anyone allowed to change this live connection");
  expect(host.textContent).toContain("installer@meters.example");
  await type("not an address");
  await submit();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe("That doesn't look like an email address.");
  expect(configApi.meterAlertSettingsRequest).toHaveBeenCalledTimes(1);
  await type(" NOC@Gateways.example ");
  await submit();
  expect(configApi.meterAlertSettingsRequest).toHaveBeenLastCalledWith("sktc", { method: "PUT", body: JSON.stringify({ hardwareEmails: ["installer@meters.example", "noc@gateways.example"] }) });
  expect(host.textContent).toContain("noc@gateways.example");
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Saved.");
  for (const email of ["a@x.example", "b@x.example", "c@x.example"]) { await type(email); await submit(); }
  expect(stored.hardwareEmails).toHaveLength(5);
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(host.textContent).toContain("You can add up to 5 addresses. Remove one to add another.");
  await act(async () => (host.querySelector('button[aria-label="Remove a@x.example"]') as HTMLButtonElement).click());
  await act(async () => undefined);
  expect(stored.hardwareEmails).not.toContain("a@x.example");
  expect(host.querySelector("input")!.disabled).toBe(false);
});

it("shows nothing to someone who may not change the live connection", async () => {
  stored = { hardwareEmails: [], canEditRecipients: false };
  await render();
  expect(host.textContent).toBe("");
});

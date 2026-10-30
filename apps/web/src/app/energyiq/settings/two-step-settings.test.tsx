/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configApi, ConfigApiError } from "../../../lib/config-api";
import { TwoStepSettings } from "./two-step-settings";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const off = { enabled: false, required: false, recoveryCodesLeft: 0, available: true };
const on = { enabled: true, required: false, recoveryCodesLeft: 10, available: true };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = async () => {
  await act(async () => root.render(<TwoStepSettings />));
  await act(async () => undefined);
};
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((item) => item.textContent === text);
const type = async (selector: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async () => act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });

describe("Two-step verification in Settings", () => {
  it("turns it on from the setup key and a code, then shows the recovery codes once", async () => {
    vi.spyOn(configApi, "getTwoStepStatus").mockResolvedValue(off);
    vi.spyOn(configApi, "startTwoStepSetup").mockResolvedValue({ secret: SECRET, otpauthUri: `otpauth://totp/EnergyX:me?secret=${SECRET}` });
    const confirm = vi.spyOn(configApi, "confirmTwoStepSetup")
      .mockRejectedValueOnce(new ConfigApiError("BAD_REQUEST", "That code didn't work. Check your authenticator app and try again.", 400))
      .mockResolvedValueOnce({ recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"], status: on });
    await render();
    expect(host.textContent).toContain("Off");

    await act(async () => button("Turn on")!.click());
    expect(host.querySelector('[data-testid="two-step-secret"]')?.textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    expect(host.textContent).toContain(`otpauth://totp/EnergyX:me?secret=${SECRET}`);

    await type("#two-step-setup-code", "111111");
    await submit();
    expect(host.textContent).toContain("That code didn't work.");
    await type("#two-step-setup-code", "222222");
    await submit();
    expect(confirm).toHaveBeenLastCalledWith("222222");
    expect(Array.from(host.querySelectorAll('[aria-label="Recovery codes"] li')).map((item) => item.textContent)).toEqual(["aaaaa-bbbbb", "ccccc-ddddd"]);
    expect(host.textContent).toContain("Two-step verification is on.");

    await act(async () => button("I've saved them")!.click());
    expect(host.querySelector('[aria-label="Recovery codes"]')).toBeNull();
    expect(button("Turn off")).toBeDefined();
  });

  it("turns it off with a current code", async () => {
    vi.spyOn(configApi, "getTwoStepStatus").mockResolvedValue(on);
    const disable = vi.spyOn(configApi, "disableTwoStep").mockResolvedValue(off);
    await render();
    expect(host.textContent).toContain("10 of 10 recovery codes left.");
    await act(async () => button("Turn off")!.click());
    await type("#two-step-confirm-code", "333333");
    await submit();
    expect(disable).toHaveBeenCalledWith("333333");
    expect(host.textContent).toContain("Two-step verification is off.");
    expect(button("Turn on")).toBeDefined();
  });

  it("explains why it cannot be turned off while the organisation requires it", async () => {
    vi.spyOn(configApi, "getTwoStepStatus").mockResolvedValue({ ...on, required: true, requiredBy: "organisation" });
    await render();
    expect(button("Turn off")?.disabled).toBe(true);
    expect(host.textContent).toContain("Your organisation requires two-step verification, so it can't be turned off.");
  });

  it("says plainly when the server cannot offer it", async () => {
    vi.spyOn(configApi, "getTwoStepStatus").mockResolvedValue({ ...off, available: false });
    await render();
    expect(button("Turn on")?.disabled).toBe(true);
    expect(host.textContent).toContain("can't be set up on this server yet");
  });
});

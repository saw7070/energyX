/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { configApi } from "../../../lib/config-api";
import { OrganisationSecurityCard } from "./organisation-security-card";

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
  await act(async () => root.render(<OrganisationSecurityCard workspaceId="w1" />));
  await act(async () => undefined);
};

it("lets a People admin require two-step verification and says who still has to set it up", async () => {
  vi.spyOn(configApi, "getEnergyTeamSecurity").mockResolvedValue({ required: false, membersWithoutTwoStep: 3, canChange: true });
  const change = vi.spyOn(configApi, "setEnergyTeamSecurity").mockResolvedValue({ required: true, membersWithoutTwoStep: 3, canChange: true });
  await render();
  expect(host.textContent).toContain("Off · each person chooses");
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  await act(async () => toggle.click());
  expect(change).toHaveBeenCalledWith({ requireTwoStep: true });
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("3 people haven't set it up yet. They will be asked to at their next sign-in.");
});

it("shows the setting without a switch to people who may only look", async () => {
  vi.spyOn(configApi, "getEnergyTeamSecurity").mockResolvedValue({ required: true, membersWithoutTwoStep: 1, canChange: false });
  await render();
  expect(host.textContent).toContain("On · everyone here enters a code");
  expect(host.textContent).toContain("1 person hasn't set it up yet.");
  expect(host.querySelector('[role="switch"]')).toBeNull();
});

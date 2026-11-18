/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { configApi } from "../../../lib/config-api";
import { OrganisationRetentionCard } from "./organisation-retention-card";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  await act(async () => root.render(<OrganisationRetentionCard workspaceId="w1" />));
  await act(async () => undefined);
};

const choose = async (value: string) => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Keep meter readings for"]')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const button = (label: string) => [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;

it("asks before a shorter limit deletes readings, and saves only once confirmed", async () => {
  vi.spyOn(configApi, "getEnergyTeamReadingRetention").mockResolvedValue({ months: null, canChange: true });
  const change = vi.spyOn(configApi, "setEnergyTeamReadingRetention").mockResolvedValue({ months: 3, canChange: true });
  await render();
  expect(host.textContent).toContain("For good · readings stay for as long as this client uses EnergyX");

  await choose("3");
  expect(change).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Readings older than 3 months, for every site of this client, will be deleted permanently");
  expect(host.textContent).toContain("This can't be undone.");

  await act(async () => button("Cancel").click());
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(change).not.toHaveBeenCalled();

  await choose("3");
  await act(async () => button("Delete older readings").click());
  expect(change).toHaveBeenCalledWith({ months: 3 });
  expect(host.textContent).toContain("3 months · readings older than 3 months are deleted each night");
});

it("keeps more without asking, and shows the setting read-only to the client's own admins", async () => {
  vi.spyOn(configApi, "getEnergyTeamReadingRetention").mockResolvedValue({ months: 3, canChange: true });
  const change = vi.spyOn(configApi, "setEnergyTeamReadingRetention").mockResolvedValue({ months: null, canChange: true });
  await render();
  await choose("null");
  expect(change).toHaveBeenCalledWith({ months: null });
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();

  await act(async () => root.unmount());
  root = createRoot(host);
  vi.spyOn(configApi, "getEnergyTeamReadingRetention").mockResolvedValue({ months: 12, canChange: false });
  await render();
  expect(host.textContent).toContain("12 months · readings older than 12 months are deleted each night");
  expect(host.textContent).toContain("Only EnergyX platform administrators can change this.");
  expect(host.querySelector("select")).toBeNull();
});

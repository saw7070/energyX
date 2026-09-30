/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublishedProjectInformation } from "./project-information";
const api = vi.hoisted(() => ({ getEnergyProjectInformation: vi.fn() }));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); vi.resetAllMocks(); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const information = (name: string) => ({ name, timezone: "Asia/Singapore", basis: "published", locations: [{ id: "one", name: "Office" }, { id: "two", name: "Office" }], meters: [{ id: "m1", name: "First meter", locationId: "one" }, { id: "m2", name: "Second meter", locationId: "two" }], calendar: null, tariff: null });
it("groups identically named locations by identity and shows missing policies without invented values", async () => {
  api.getEnergyProjectInformation.mockResolvedValue(information("Customer"));
  await act(() => root.render(<PublishedProjectInformation projectId="p" />));
  const locations = [...host.querySelectorAll("h3")].map(heading => heading.parentElement!.textContent);
  expect(locations).toEqual(["OfficeFirst meter", "OfficeSecond meter"]);
  expect(host.textContent?.match(/Not configured/g)).toHaveLength(2);
  expect(host.querySelector("input,textarea")).toBeNull();
});
it("does not replace a newly selected project's information with a late previous response", async () => {
  let resolveOld!: (value: unknown) => void;
  api.getEnergyProjectInformation.mockImplementation((id: string) => id === "old" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(information("New customer")));
  await act(() => root.render(<PublishedProjectInformation projectId="old" />));
  await act(() => root.render(<PublishedProjectInformation projectId="new" />));
  await act(async () => resolveOld(information("Old customer")));
  expect(host.textContent).toContain("New customer");
  expect(host.textContent).not.toContain("Old customer");
});

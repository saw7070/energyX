/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const accessState = vi.hoisted(() => ({ value: { access: null as unknown, error: null as string | null, loading: true } }));
vi.mock("../_components/energyiq-access", () => ({ useEnergyIqAccess: () => accessState.value }));

import { configApi } from "../../../lib/config-api";
import { EnergyIqTeam } from "./team-client";

beforeEach(() => { vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const render = async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqTeam />));
  return { host, root };
};
const access = (people: "none" | "read" | "write") => ({
  role: "user", user: { id: "u" }, activeWorkspaceId: "w1", workspaces: [], projects: [],
  permissions: { reports: "write", facility: "read", hours_rate: "read", notes: "read", live_connection: "none", people },
  team: { canManagePeople: people === "write" },
});
const team = { organisation: { id: "w1", name: "Elite IOT" }, roles: [], members: [{ id: "a", displayName: "View", email: "view@demo.com", status: "active", roleName: "Organisation admin", canChange: false }] };

it("shows a loading placeholder, never 'not available', while the person's access is still loading", async () => {
  accessState.value = { access: null, error: null, loading: true };
  const getTeam = vi.spyOn(configApi, "getEnergyTeam").mockResolvedValue(team as never);
  const { host, root } = await render();
  expect(host.textContent).toContain("Loading who has access");
  expect(host.textContent).not.toContain("not available");
  expect(getTeam).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("shows the team once access arrives, without passing through 'not available'", async () => {
  accessState.value = { access: null, error: null, loading: true };
  vi.spyOn(configApi, "getEnergyTeam").mockResolvedValue(team as never);
  const { host, root } = await render();
  const seen: string[] = [];
  const watch = new MutationObserver(() => seen.push(host.textContent ?? ""));
  watch.observe(host, { childList: true, subtree: true, characterData: true });
  accessState.value = { access: access("write"), error: null, loading: false };
  await act(async () => root.render(<EnergyIqTeam />));
  await act(async () => { await Promise.resolve(); });
  watch.disconnect();
  expect(host.textContent).toContain("view@demo.com");
  expect(seen.some((text) => text.includes("not available"))).toBe(false);
  await act(async () => root.unmount());
});

it("says 'not available' only once access is known and has no People permission", async () => {
  accessState.value = { access: access("none"), error: null, loading: false };
  const getTeam = vi.spyOn(configApi, "getEnergyTeam").mockResolvedValue(team as never);
  const { host, root } = await render();
  expect(host.textContent).toContain("Team management is not available");
  expect(getTeam).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("shows the access problem instead of an endless placeholder if access cannot load", async () => {
  accessState.value = { access: null, error: "Could not load your access.", loading: false };
  const { host, root } = await render();
  expect(host.textContent).toContain("Could not load your access.");
  await act(async () => root.unmount());
});

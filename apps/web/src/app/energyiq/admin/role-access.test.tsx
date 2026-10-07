/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { configApi, type EnergyAdminRoleDto } from "../../../lib/config-api";
import { RoleDialog, RolesView } from "./admin-access-pages";

beforeEach(() => { vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const role = (overrides: Partial<EnergyAdminRoleDto> = {}): EnergyAdminRoleDto => ({
  id: "r1", name: "Facility editor", description: "Keeps the setup current", builtin: false, assignedCount: 0,
  permissions: { reports: "write", facility: "write", hours_rate: "read", notes: "none", live_connection: "none", people: "none" }, ...overrides,
});

const mount = async (node: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
};
const clickButton = async (host: HTMLElement, match: (button: HTMLButtonElement) => boolean) =>
  act(async () => Array.from(host.querySelectorAll("button")).find(match)!.click());

it("lists each role with what it can do, hides edit and delete for built-in roles and blocks deleting a role in use", async () => {
  const { host, root } = await mount(
    <RolesView
      roles={[role({ id: "role-viewer", name: "Viewer", builtin: true, assignedCount: 3 }), role({ assignedCount: 2 })]}
      onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn(async () => undefined)}
    />,
  );
  const cards = Array.from(host.querySelectorAll("article"));
  expect(cards).toHaveLength(2);
  expect(cards[0]!.textContent).toContain("Built in");
  expect(Array.from(cards[0]!.querySelectorAll("button"))).toHaveLength(0);
  expect(cards[1]!.textContent).toContain("Held by 2 people");
  expect(Array.from(cards[1]!.querySelectorAll("button")).find((button) => button.textContent === "Delete")!.disabled).toBe(true);
  // Each area shows its level.
  expect(cards[1]!.textContent).toMatch(/Facility structure\s*write/i);
  expect(host.textContent).toContain("always stay with super admins");
  await act(async () => root.unmount());
});

it("starts from a preset, explains the chosen level in plain words, summarises the role, and saves the choices", async () => {
  const create = vi.spyOn(configApi, "createEnergyAdminRole").mockResolvedValue(role());
  const saved = vi.fn(async () => undefined);
  const { host, root } = await mount(<RoleDialog onClose={vi.fn()} onSaved={saved} />);
  const radio = (area: string, label: string) =>
    Array.from(host.querySelectorAll(`[role="radiogroup"][aria-label="${area}"] [role="radio"]`)).find((item) => item.textContent === label) as HTMLButtonElement;

  // Starts as a Viewer: people cannot be managed.
  expect(radio("People", "None").getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("Has no Team page.");

  await clickButton(host, (button) => button.textContent?.startsWith("Facility editor") ?? false);
  expect(radio("Facility structure", "Write").getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("Changes go live straight away");

  await act(async () => radio("People", "Read").click());
  expect(host.textContent).toContain("Can see who has access to the client");
  const summary = host.querySelector('[aria-label="Summary of this role"]')!.textContent!;
  expect(summary).toContain("People: read only");
  expect(summary).toContain("Facility structure: read and change");

  const name = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Facility editor"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Site editor");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    name: "Site editor",
    permissions: { reports: "write", facility: "write", hours_rate: "write", notes: "write", live_connection: "none", people: "read" },
  }));
  expect(saved).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});

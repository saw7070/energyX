/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { configApi, type EnergyAdminOrganisationDto, type EnergyAdminRoleDto, type EnergyAdminUserDto } from "../../../lib/config-api";
import { AdminAccessPages, RoleDialog, RolesView } from "./admin-access-pages";

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

const organisation: EnergyAdminOrganisationDto = { id: "org-elite", name: "Elite IOT", status: "active", userCount: 1, projectCount: 1, projects: [], createdAt: "2026-10-01T00:00:00.000Z" };
const viewer: EnergyAdminUserDto = {
  id: "u1", displayName: "Mei", email: "mei@example.test", role: "user", status: "active", organisationIds: ["org-elite"],
  organisations: [{ id: "org-elite", name: "Elite IOT" }], organisationRoles: { "org-elite": { roleId: "role-viewer", roleName: "Viewer" } },
  projectIds: [], createdAt: "2026-10-01T00:00:00.000Z",
};
const mockAccessLists = () => {
  vi.spyOn(configApi, "listEnergyAdminOrganisations").mockResolvedValue({ organisations: [organisation] });
  vi.spyOn(configApi, "listEnergyAdminUsers").mockResolvedValue({ users: [viewer] });
  vi.spyOn(configApi, "listEnergyAdminRoles").mockResolvedValue({ roles: [role({ id: "role-viewer", name: "Viewer", builtin: true })] });
};

it("asks in the page, not a browser pop-up, before locking someone out, and saves only once confirmed", async () => {
  mockAccessLists();
  const browserConfirm = vi.spyOn(window, "confirm");
  const update = vi.spyOn(configApi, "updateEnergyAdminUser").mockResolvedValue({ ...viewer, status: "disabled" });
  const { host, root } = await mount(<AdminAccessPages initialView="users" />);
  await clickButton(host, (button) => button.textContent === "Edit");
  const disable = Array.from(host.querySelectorAll("label")).find((label) => label.textContent?.includes("Disable this account"))!.querySelector("input")!;
  await act(async () => disable.click());
  const submit = async () => act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

  await submit();
  const dialog = () => host.querySelector('[role="alertdialog"]');
  expect(dialog()!.textContent).toContain("Disable this account?");
  expect(dialog()!.textContent).toContain("Mei is signed out everywhere");
  expect(update).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(dialog()).toBeNull();
  expect(update).not.toHaveBeenCalled();

  await submit();
  await clickButton(dialog() as HTMLElement, (button) => button.textContent === "Disable account");
  expect(update).toHaveBeenCalledWith("u1", expect.objectContaining({ disabled: true }));
  expect(browserConfirm).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("saves an ordinary edit straight away, without asking", async () => {
  mockAccessLists();
  const update = vi.spyOn(configApi, "updateEnergyAdminUser").mockResolvedValue(viewer);
  const { host, root } = await mount(<AdminAccessPages initialView="users" />);
  await clickButton(host, (button) => button.textContent === "Edit");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(update).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});

it("confirms deleting a role in the page before deleting it", async () => {
  mockAccessLists();
  vi.spyOn(configApi, "listEnergyAdminRoles").mockResolvedValue({ roles: [role({ name: "Night shift" })] });
  const remove = vi.spyOn(configApi, "deleteEnergyAdminRole").mockResolvedValue(undefined as never);
  const { host, root } = await mount(<AdminAccessPages initialView="roles" />);
  await clickButton(host, (button) => button.textContent === "Delete");
  const dialog = host.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(dialog.textContent).toContain('"Night shift" will be removed');
  expect(remove).not.toHaveBeenCalled();
  await clickButton(dialog, (button) => button.textContent === "Delete role");
  expect(remove).toHaveBeenCalledWith("r1");
  await act(async () => root.unmount());
});

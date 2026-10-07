/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { EnergyTeamMemberDto } from "../../../lib/config-api";
import { TeamView, type TeamViewProps } from "./team-client";

beforeEach(() => { vi.stubGlobal("React", React); globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const members: EnergyTeamMemberDto[] = [
  { id: "a", displayName: "View", email: "view@demo.com", status: "active", roleName: "Organisation admin", canChange: false, lastLoginAt: ago(5 * 60_000) },
  { id: "b", displayName: "Alex Tan", email: "alex@x.test", status: "active", roleName: "Viewer", canChange: true, lastLoginAt: ago(30 * 3_600_000) },
  { id: "c", displayName: "Priya Nair", email: "priya@x.test", status: "pending", roleName: "Viewer", canChange: true },
];

const base = (overrides: Partial<TeamViewProps> = {}): TeamViewProps => ({
  organisationName: "Elite IOT", members, roles: [
    { id: "role-viewer", name: "Viewer", description: "Can look at everything.", memberCount: 2, permissions: { reports: "write", facility: "read", hours_rate: "read", notes: "read", live_connection: "none", people: "none" } },
    { id: "role-organisation-admin", name: "Organisation admin", description: "Runs the client.", memberCount: 1, permissions: { reports: "write", facility: "write", hours_rate: "write", notes: "write", live_connection: "write", people: "write" } },
  ], canWrite: true, busy: false, error: null, notice: null, invitationUrl: null,
  email: "", displayName: "", onEmailChange: vi.fn(), onDisplayNameChange: vi.fn(), onInvite: vi.fn(), onDismissInvitation: vi.fn(),
  onResend: vi.fn(), onRemove: vi.fn(), onRefresh: vi.fn(), ...overrides,
});

const mount = async (props: TeamViewProps) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TeamView {...props} />));
  return { host, root };
};
const button = (host: HTMLElement, text: string, index = 0) =>
  Array.from(host.querySelectorAll("button")).filter((item) => item.textContent === text)[index] as HTMLButtonElement | undefined;

it("shows the client, the headline counts, each person's role, status and last activity", async () => {
  const { host, root } = await mount(base());
  expect(host.textContent).toContain("Elite IOT");
  const stats = Array.from(host.querySelectorAll("dl > div")).map((item) => item.textContent);
  expect(stats).toEqual(["People3", "Active2", "Waiting to join1"]);
  expect(host.querySelector("h1")?.textContent).toBe("Team");
  expect(host.textContent).toContain("1 waiting to join");
  const rows = Array.from(host.querySelectorAll("section[aria-label='People with access'] ul > li"));
  expect(rows).toHaveLength(3);
  expect(rows[0]!.textContent).toContain("Organisation admin");
  expect(rows[0]!.textContent).toContain("5 minutes ago");
  expect(rows[1]!.textContent).toContain("yesterday");
  expect(rows[2]!.textContent).toContain("Invited");
  expect(rows[2]!.textContent).toContain("Hasn’t joined yet");
  await act(async () => root.unmount());
});

it("offers remove only where the server allows it, and resend only for people who have not joined", async () => {
  const props = base();
  const { host, root } = await mount(props);
  expect(button(host, "Remove", 0)).toBeDefined();
  expect(Array.from(host.querySelectorAll("button")).filter((item) => item.textContent === "Remove")).toHaveLength(2);
  expect(Array.from(host.querySelectorAll("button")).filter((item) => item.textContent === "Resend invite")).toHaveLength(1);
  await act(async () => button(host, "Resend invite")!.click());
  expect(props.onResend).toHaveBeenCalledWith(members[2]);
  await act(async () => button(host, "Remove", 1)!.click());
  expect(props.onRemove).toHaveBeenCalledWith(members[2]);
  await act(async () => root.unmount());
});

it("hides the invite form for someone who may only look", async () => {
  const { host, root } = await mount(base({ canWrite: false }));
  expect(host.textContent).not.toContain("Invite someone");
  expect(host.querySelector("form")).toBeNull();
  await act(async () => root.unmount());
});

it("shows the one-time link with a copy button instead of a duplicate notice", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { host, root } = await mount(base({ invitationUrl: "http://127.0.0.1:3000/login?invite=abc", notice: "Invitation created for p@x.test." }));
  expect(host.textContent).toContain("Invitation ready");
  expect(host.textContent).toContain("login?invite=abc");
  expect(host.textContent).not.toContain("Invitation created for p@x.test.");
  await act(async () => button(host, "Copy link")!.click());
  expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:3000/login?invite=abc");
  expect(host.textContent).toContain("Copied");
  await act(async () => root.unmount());
});

it("explains what each role allows, in plain levels, beside the people", async () => {
  const { host, root } = await mount(base());
  const guide = host.querySelector("section[aria-label='What each role can do']")!;
  expect(guide.textContent).toContain("Organisation admin");
  expect(guide.textContent).toContain("2 people");
  // Viewer: read facility, no live connection. Organisation admin: write live connection.
  const viewerCard = Array.from(guide.querySelectorAll("li")).slice(0, 6).map((item) => item.textContent);
  expect(viewerCard).toContain("Facility structureread");
  expect(viewerCard).toContain("Live connectionnone");
  expect(guide.textContent).toMatch(/Live connectionwrite/);
  await act(async () => root.unmount());
});

it("filters people by status and shows each filter's count", async () => {
  const { host, root } = await mount(base());
  const tab = (label: string) => Array.from(host.querySelectorAll('[role="tab"]')).find((item) => item.textContent?.startsWith(label)) as HTMLButtonElement;
  expect(tab("All").textContent).toBe("All3");
  expect(tab("Invited").textContent).toBe("Invited1");
  await act(async () => tab("Invited").click());
  const rows = host.querySelectorAll("section[aria-label='People with access'] ul > li");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("Priya Nair");
  expect(tab("Invited").getAttribute("aria-selected")).toBe("true");
  await act(async () => root.unmount());
});

it("explains an empty team and filters a long one by search", async () => {
  const empty = await mount(base({ members: [] }));
  expect(empty.host.textContent).toContain("No one has been added yet");
  await act(async () => empty.root.unmount());

  const many: EnergyTeamMemberDto[] = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, displayName: index === 7 ? "Zed Final" : `Person ${index}`, email: `p${index}@x.test`, status: "active", roleName: "Viewer", canChange: true }));
  const { host, root } = await mount(base({ members: many }));
  const search = host.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "zed");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll("section[aria-label='People with access'] ul > li")).toHaveLength(1);
  await act(async () => root.unmount());
});

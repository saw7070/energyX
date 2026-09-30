import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";

let metadata: ReturnType<typeof createMetadataStore>;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-capabilities-"));
  metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  for (const id of ["admin", "editor", "viewer", "member", "outsider"]) {
    metadata.users.createPasswordUser({ id, email: `${id}@example.test` });
  }
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  for (const id of ["w", "other"]) metadata.workspaces.upsert({ id, name: id, kind: "customer", owner_user_id: "admin" });
  for (const id of ["editor", "viewer", "member"]) metadata.workspaceMemberships.upsert({ workspace_id: "w", user_id: id, role: "member" });
  for (const [id, workspace_id, status] of [["p", "w", "published"], ["second", "w", "published"], ["foreign", "other", "published"], ["draft", "w", "draft"], ["archived", "w", "archived"]] as const) {
    metadata.energyIq.upsertProject({ id, workspace_id, status, name: id, timezone: "Asia/Singapore" });
  }
  for (const user_id of ["editor", "outsider"]) metadata.energyIq.upsertProjectAccess({ project_id: "p", user_id, role: "editor" });
  metadata.energyIq.upsertProjectAccess({ project_id: "p", user_id: "viewer", role: "viewer" });
});
afterEach(() => {
  metadata?.db.close();
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("project-capabilities-")) throw new Error("Unexpected fixture path");
  rmSync(root, { recursive: true, force: true });
});

const capabilities = (userId: string, projectId = "p", workspaceId = "w") =>
  resolveEnergyProjectCapabilities({ metadataStore: metadata, userId, projectId, workspaceId, env: {} });
const expectDenied = (value: ReturnType<typeof capabilities>) => expect(Object.values(value).every(v => !v)).toBe(true);

it.each(["viewer", "member"])("lets %s read the project and ask the advisor, but change nothing", user => {
  expect(capabilities(user)).toEqual({ readReports: true, readExplorer: true, readProjectInformation: true,
    readOwnHistory: true, createReport: true, manageSkills: false, manageAutomation: false,
    editConfiguration: false, publishConfiguration: false });
});
it("ignores an older editor access row: only administrators manage a project", () => {
  expect(capabilities("editor")).toMatchObject({ readReports: true, createReport: true, manageSkills: false, manageAutomation: false, editConfiguration: false, publishConfiguration: false });
  expect(capabilities("editor", "second")).toMatchObject({ readReports: true, createReport: true, editConfiguration: false });
});
it("retains platform admin publication and draft visibility without requiring a membership", () => {
  expect(Object.values(capabilities("admin")).every(Boolean)).toBe(true);
  expect(capabilities("admin", "draft").publishConfiguration).toBe(true);
  expectDenied(capabilities("admin", "archived"));
});
it("denies missing and foreign scopes even for platform admins", () => {
  for (const user of ["admin", "editor"]) {
    expectDenied(capabilities(user, "foreign"));
    expectDenied(capabilities(user, "missing"));
    expectDenied(capabilities(user, "p", "missing"));
  }
  expectDenied(capabilities("unknown"));
});
it("requires current workspace membership even when an editor row remains", () => {
  expectDenied(capabilities("outsider"));
  metadata.workspaceMemberships.remove({ workspace_id: "w", user_id: "editor" });
  expectDenied(capabilities("editor"));
  expectDenied(capabilities("editor", "foreign", "other"));
});
it("keeps disabled actors and unpublished projects unavailable to members", () => {
  expectDenied(capabilities("editor", "draft"));
  metadata.users.setDisabled({ user_id: "admin", disabled: true });
  expectDenied(capabilities("admin"));
  metadata.workspaces.setCustomerDetails({ id: "w", name: "w", disabled: true });
  expectDenied(capabilities("editor"));
});
it("honours the existing admin allowlist without persisting a role or grant", () => {
  const before = metadata.db.prepare("SELECT total_changes() AS n").get()!.n;
  const value = resolveEnergyProjectCapabilities({ metadataStore: metadata, userId: "outsider", workspaceId: "w", projectId: "p", env: { ENERGYIQ_ADMIN_EMAILS: " OUTSIDER@example.test " } });
  expect(value.publishConfiguration).toBe(true);
  expect(metadata.energyIq.findUserRole("outsider")).toBeUndefined();
  expect(metadata.db.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
});
it("does not allow a personal workspace to become a project authorization shortcut", () => {
  metadata.workspaces.createPersonal({ id: "personal", owner_user_id: "admin", name: "Personal" });
  metadata.energyIq.upsertProject({ id: "personal-project", workspace_id: "personal", name: "Personal", status: "published", timezone: "Asia/Singapore" });
  expectDenied(capabilities("admin", "personal-project", "personal"));
});

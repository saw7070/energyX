import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { readEnergyProjectInformation } from "./energy-project-information.js";

let root: string;
let metadata: ReturnType<typeof createMetadataStore>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-information-"));
  metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  ensureEnergyIqBootstrap(metadata);
  metadata.users.createPasswordUser({ id: "reader", email: "reader@example.test" });
  metadata.workspaceMemberships.upsert({ workspace_id: "default", user_id: "reader", role: "member" });
});
afterEach(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
const read = () => readEnergyProjectInformation(metadata, "reader", "default", "ngee-ann-polytechnic");

it("returns an explicit published DTO without draft notes, sources or policy-owner audit fields", () => {
  const initial = read();
  expect(initial.basis).toBe("published");
  expect(initial.meters.length).toBeGreaterThan(0);
  const draft = metadata.energyIq.projectSetup.getDraft({ project_id: "ngee-ann-polytechnic", user_id: "dev-user" });
  draft.document.project.name = "PRIVATE_DRAFT_NAME";
  metadata.energyIq.projectSetup.saveDraft({ project_id: "ngee-ann-polytechnic", user_id: "dev-user", expected_revision: draft.revision, document: draft.document });
  const before = metadata.db.prepare("SELECT total_changes() AS n").get()!.n;
  const info = read();
  expect(info).toEqual(initial);
  expect(JSON.stringify(info)).not.toMatch(/PRIVATE_DRAFT|snapshot_json|metadata_json|source_manifest|published_by|password|fileRefIds/);
  expect(metadata.db.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
});
it("keeps selected but unpublished policy revisions out of customer information", () => {
  const initial = read();
  metadata.energyIq.operationalPolicy.publishTariffSchedule({ version_id: "pending-tariff", project_id: "ngee-ann-polytechnic", published_by: "dev-user", activate: false,
    entries: [{ id: "pending", owner: { kind: "project" }, effective_from: "2026-01-01T00:00:00+08:00", currency: "SGD", rate_per_kwh: 999 }] });
  metadata.energyIq.operationalPolicy.activateProjectPolicies({ project_id: "ngee-ann-polytechnic", tariff_schedule_version: "pending-tariff", updated_by: "dev-user" });
  expect(read().tariff).toEqual(initial.tariff);
});
it("rejects foreign project scopes and revoked memberships", () => {
  expect(() => readEnergyProjectInformation(metadata, "reader", "default", "preschool-demo")).toThrow("FORBIDDEN");
  metadata.workspaceMemberships.remove({ workspace_id: "default", user_id: "reader" });
  expect(read).toThrow("FORBIDDEN");
});
it("says which meters are meant to run day and night, and nothing for the rest", () => {
  const initial = read();
  expect(initial.meters.some(meter => "alwaysOn" in meter)).toBe(false);
  // Tick "always on" on one published meter, as the meter form saves it.
  const project = metadata.energyIq.getProject("ngee-ann-polytechnic");
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions("ngee-ann-polytechnic").find(item => item.id === (metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic")?.hierarchy_revision_id ?? project.hierarchy_revision_id))!;
  const document = JSON.parse(revision.snapshot_json) as { meter_mapping: { rows: Array<{ id: string; presentation?: Record<string, string> }> } };
  const [first, second] = document.meter_mapping.rows;
  first!.presentation = { ...first!.presentation, always_on: "true" };
  second!.presentation = { ...second!.presentation, always_on: "false" };
  metadata.db.prepare("UPDATE energyiq_hierarchy_revisions SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(document), revision.id);
  const marked = read().meters;
  expect(marked.find(meter => meter.id === first!.id)).toMatchObject({ alwaysOn: true });
  expect(marked.filter(meter => "alwaysOn" in meter).map(meter => meter.id)).toEqual([first!.id]);
});
it("says how many light points a meter feeds when someone recorded a whole number, and nothing otherwise", () => {
  expect(read().meters.some(meter => "lightCount" in meter)).toBe(false);
  const project = metadata.energyIq.getProject("ngee-ann-polytechnic");
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions("ngee-ann-polytechnic").find(item => item.id === (metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic")?.hierarchy_revision_id ?? project.hierarchy_revision_id))!;
  const document = JSON.parse(revision.snapshot_json) as { meter_mapping: { rows: Array<{ id: string; presentation?: Record<string, string> }> } };
  const [first, second, third, fourth] = document.meter_mapping.rows;
  first!.presentation = { ...first!.presentation, light_count: "12" };
  second!.presentation = { ...second!.presentation, light_count: "0" };
  third!.presentation = { ...third!.presentation, light_count: "2.5" };
  fourth!.presentation = { ...fourth!.presentation, light_count: "many" };
  metadata.db.prepare("UPDATE energyiq_hierarchy_revisions SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(document), revision.id);
  const meters = read().meters;
  expect(meters.find(meter => meter.id === first!.id)).toMatchObject({ lightCount: 12 });
  expect(meters.filter(meter => "lightCount" in meter).map(meter => meter.id)).toEqual([first!.id]);
});
it("gives each location the order it was saved in", () => {
  const locations = read().locations;
  expect(locations.length).toBeGreaterThan(1);
  expect(locations.every(location => typeof location.sortOrder === "number")).toBe(true);
});

it("keeps groups made inside a block as groups, while a circuit named after its one meter still files under its parent", async () => {
  const { circuitGroupIds } = await import("./energy-project-information.js");
  const nodes = [
    { id: "block", name: "Block A", node_type: "location", parent_id: null },
    { id: "gf", name: "Ground floor", node_type: "circuit", parent_id: "block" },
    { id: "emergency", name: "Emergency lights", node_type: "circuit", parent_id: "block" },
    { id: "old-circuit", name: "Lobby lights", node_type: "circuit", parent_id: "block" },
    { id: "nested", name: "Upper floors", node_type: "circuit", parent_id: "block" },
    { id: "nested-child", name: "Level 2", node_type: "circuit", parent_id: "nested" },
  ];
  const meter = (scope: string, name: string) => ({ scope_id: scope, display_name: name, source_label: name, presentation: { device_name: name } });
  const meters = [meter("gf", "Lobby A"), meter("gf", "Lobby B"), meter("emergency", "Block A Emergency Lighting"), meter("old-circuit", "Lobby lights"), meter("nested-child", "Stair lights")];
  // Two meters, one meter under a group name, and a group with a group inside it are groups; a circuit named after its meter is not.
  expect([...circuitGroupIds(nodes, meters)].sort()).toEqual(["emergency", "gf", "nested", "nested-child"]);
});

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

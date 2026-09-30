import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqOverviewDefinitionStore", () => {
  it("publishes the canonical Definition and compiled document as one immutable Template Revision", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-definition-store-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedPublishedProject(metadata);
      const base = metadata.energyIq.templates.getLatestProjectRevision("project-definition")!;

      const published = metadata.energyIq.overviewDefinitions.publishFromRevisionWithinTransaction({
        renderer_key: "ngee-ann-overview",
        project_id: "project-definition",
        expected_base_revision_id: base.revision_id,
        definition: {
          contractRevision: "energyiq-overview-definition@1",
          timePolicyRevisionId: "operations-policy@1",
          sections: [{
            key: "performance",
            title: "Current performance",
            managementQuestion: "Where is energy use changing enough to require attention?",
            primaryWindowId: "recent-28d",
            blocks: [{
              key: "consumption",
              capabilityRevisionId: "overview.consumption@1",
              emphasis: "primary",
            }],
          }],
        },
        report_time_policy: {
          policyId: "operations-policy",
          revision: "1",
          windows: [{
            windowId: "recent-28d",
            role: "recent_operations",
            label: "Recent 28 complete days",
            strategy: { kind: "rolling_complete_days", days: 28 },
          }],
        },
        published_by: "dev-user",
        published_at: "2026-08-19T00:01:00.000Z",
      });

      expect(published.revision.revision_id).toBe("project-definition-template-v2");
      expect(published.record.definition_fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(published.record.definition.sections[0]).toMatchObject({
        key: "performance",
        primaryWindowId: "recent-28d",
      });
      expect(published.revision.document.templates[0]).toMatchObject({
        template_id: "project",
        sections: [{ section_id: "performance", title: "Current performance" }],
        components: [{
          placement_id: "consumption",
          component_revision_id: "overview.consumption@1",
          section_id: "performance",
        }],
      });
      expect(published.revision.document.templates.some((template) => template.template_id === "tier:project-definition-tier")).toBe(true);
      expect(metadata.energyIq.overviewDefinitions.get(base.revision_id)).toBeNull();
      expect(metadata.energyIq.overviewDefinitions.get(published.revision.revision_id)).toEqual(published.record);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["html", "structured"] as const)(
    "rolls back both the Template Release and %s Definition when the second write fails",
    (mode) => {
      const root = mkdtempSync(join(tmpdir(), `energyiq-overview-definition-atomic-${mode}-`));
      const databasePath = join(root, "metadata.sqlite");
      const metadata = createMetadataStore({ database_path: databasePath });
      const failureConnection = new DatabaseSync(databasePath);
      try {
        seedPublishedProject(metadata);
        const base = metadata.energyIq.templates.getLatestProjectRevision("project-definition")!;
        failureConnection.exec(`
          CREATE TRIGGER fail_overview_definition_insert
          BEFORE INSERT ON energyiq_overview_definition_revisions
          BEGIN
            SELECT RAISE(ABORT, 'FORCED_OVERVIEW_DEFINITION_WRITE_FAILURE');
          END;
        `);

        expect(() => metadata.energyIq.overviewDefinitions.publishFromRevision({
          renderer_key: "ngee-ann-overview",
          project_id: "project-definition",
          expected_base_revision_id: base.revision_id,
          definition: {
            contractRevision: "energyiq-overview-definition@1",
            timePolicyRevisionId: "operations-policy@1",
            aiSlotPresentationMode: mode,
            sections: [{
              key: "performance",
              title: "Current performance",
              managementQuestion: "Where is energy use changing enough to require attention?",
              primaryWindowId: "recent-28d",
              blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
            }],
          },
          report_time_policy: {
            policyId: "operations-policy",
            revision: "1",
            windows: [{
              windowId: "recent-28d",
              role: "recent_operations",
              label: "Recent 28 complete days",
              strategy: { kind: "rolling_complete_days", days: 28 },
            }],
          },
          published_by: "dev-user",
          published_at: "2026-08-19T00:01:00.000Z",
        })).toThrow("FORCED_OVERVIEW_DEFINITION_WRITE_FAILURE");

        expect(metadata.energyIq.templates.getLatestProjectRevision("project-definition")).toEqual(base);
        expect(metadata.energyIq.templates.getProjectRevision("project-definition-template-v2")).toBeNull();
        expect(metadata.energyIq.overviewDefinitions.get("project-definition-template-v2")).toBeNull();
      } finally {
        failureConnection.close();
        metadata.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

const seedPublishedProject = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.workspaces.upsert({
    id: "workspace-definition",
    owner_user_id: "dev-user",
    name: "Overview Definition Workspace",
    kind: "customer",
  });
  metadata.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: "project-definition",
      workspace_id: "workspace-definition",
      name: "Overview Definition Project",
      hierarchy_revision_id: "project-definition-hierarchy-v1",
      meter_formula_revision_id: "project-definition-meter-formula-v1",
      data_snapshot_id: "snapshot-definition",
      root_scope_id: "project-definition-root",
    },
    document: {
      project: { name: "Overview Definition Project", timezone: "Asia/Singapore" },
      source_manifest: { id: "manifest-definition", source_sha256: ["a".repeat(64)], confirmed: true },
      tier_structure_locked: true,
      tiers: [{ id: "project-definition-tier", ordinal: 1, alias: "Area" }],
      nodes: [{
        id: "project-definition-area",
        tier_definition_id: "project-definition-tier",
        name: "Area One",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
    },
    published_by: "dev-user",
  });
  metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
    project_id: "project-definition",
    tier_definition_ids: ["project-definition-tier"],
    hierarchy_revision_id: "project-definition-hierarchy-v1",
    meter_mapping_revision_id: "meter-routing-unavailable",
    published_by: "dev-user",
    published_at: "2026-08-19T00:00:00.000Z",
  });
};

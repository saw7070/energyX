import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  createEnergyIqSourceManifest,
  createMetadataStore,
  resolveEnergyIqSnapshotFactScope,
} from "./index.js";

describe("EnergyIqStore", () => {
  it("backfills built-in Rule revisions added after the original Rule schema migration", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-built-in-rule-migration-"));
    const databasePath = join(root, "metadata.sqlite");
    let metadata = createMetadataStore({ database_path: databasePath });
    try {
      metadata.close();
      const legacy = new DatabaseSync(databasePath);
      try {
        legacy.prepare("DELETE FROM energyiq_rule_revisions WHERE revision_id = ?")
          .run("comparison.school_holiday_context@1");
        legacy.prepare("DELETE FROM schema_migrations WHERE id = ?")
          .run("0045_energyiq_built_in_rule_revisions");
      } finally {
        legacy.close();
      }

      metadata = createMetadataStore({ database_path: databasePath });

      expect(metadata.energyIq.rules.listRevisions()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          revision_id: "comparison.school_holiday_context@1",
          requirement: "historical_baseline",
        }),
      ]));
      expect(metadata.db.prepare(`
        SELECT id FROM schema_migrations
        WHERE id = '0045_energyiq_built_in_rule_revisions'
      `).get()).toEqual({ id: "0045_energyiq_built_in_rule_revisions" });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("migrates an existing EnergyIQ database to the project publication journal schema", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-publication-migration-"));
    const databasePath = join(root, "metadata.sqlite");
    let metadata = createMetadataStore({ database_path: databasePath });
    try {
      metadata.close();
      const legacy = new DatabaseSync(databasePath);
      try {
        legacy.exec("DROP TABLE energyiq_project_data_publications");
        legacy.prepare("DELETE FROM schema_migrations WHERE id = ?")
          .run("0044_energyiq_project_data_publication");
      } finally {
        legacy.close();
      }

      metadata = createMetadataStore({ database_path: databasePath });

      expect(metadata.energyIq.findProjectDataPublication("missing-project")).toBeUndefined();
      expect(metadata.db.prepare(`
        SELECT id FROM schema_migrations
        WHERE id = '0044_energyiq_project_data_publication'
      `).get()).toEqual({ id: "0044_energyiq_project_data_publication" });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("publishes all prepared manifest batches in one Metadata transaction", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-manifest-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-manifest", workspace_id: "workspace-1", name: "Manifest", status: "draft" });
      for (const [batchId, sha] of [["manifest-a", "sha-a"], ["manifest-b", "sha-b"]] as const) {
        metadata.energyIq.createImportBatch({
          id: batchId,
          workspace_id: "workspace-1",
          project_id: "project-manifest",
          source_kind: "excel",
          source_sha256: sha,
          filename: `${batchId}.xlsx`,
          status: "inspected",
          inspection: importInspection(batchId),
          created_by: "dev-user",
        });
      }
      const materializations = [
        { batch_id: "manifest-a", summary: materializationSummary("mapping-sha-1") },
        { batch_id: "manifest-b", summary: materializationSummary("mapping-sha-1") },
      ];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-manifest",
        materializations,
        source_manifest_sha256: ["sha-a", "sha-b"],
      });
      const completed = metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-manifest",
        materializations,
        project_audit: projectAudit(),
        source_manifest_sha256: ["sha-a", "sha-b"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });

      expect(completed.batches.map((batch) => batch.status)).toEqual(["materialized", "materialized"]);
      expect(completed.snapshot.id).toBe(prepared.expected_snapshot_id);
      expect(metadata.energyIq.getProject("project-manifest").data_snapshot_id).toBe(prepared.expected_snapshot_id);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("persists the exact Snapshot and Overview pointer rollback receipt across restart", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-publication-journal-"));
    const databasePath = join(root, "metadata.sqlite");
    let metadata = createMetadataStore({ database_path: databasePath });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-journal", workspace_id: "workspace-1", name: "Journal", status: "draft" });
      metadata.energyIq.createImportBatch({
        id: "batch-journal",
        workspace_id: "workspace-1",
        project_id: "project-journal",
        source_kind: "excel",
        source_sha256: "sha-journal",
        filename: "journal.xlsx",
        status: "inspected",
        inspection: importInspection("batch-journal"),
        created_by: "dev-user",
      });
      const current = completePreparedProjectManifest(metadata.energyIq, {
        batch_id: "batch-journal",
        project_id: "project-journal",
        summary: materializationSummary("mapping-sha-1"),
        project_audit: projectAudit(),
      }).snapshot;
      metadata.energyIq.beginProjectDataPublication({
        project_id: "project-journal",
        expected_previous_snapshot_id: current.id,
      });
      metadata.energyIq.markProjectDataPublicationCandidate({
        project_id: "project-journal",
        expected_previous_snapshot_id: current.id,
        candidate_snapshot_id: current.id,
      });
      metadata.energyIq.markProjectOverviewPublicationCandidate({
        project_id: "project-journal",
        expected_previous_snapshot_id: current.id,
        candidate_snapshot_id: current.id,
        overview_persistent_directory: "C:\\energyiq\\managed",
        overview_pointer_key: "workspace-1/project-journal/current-overview",
        previous_overview_projection_key: "previous-projection",
        candidate_overview_projection_key: "candidate-projection",
      });
      metadata.close();
      metadata = createMetadataStore({ database_path: databasePath });

      expect(metadata.energyIq.findProjectDataPublication("project-journal")).toMatchObject({
        previous_snapshot_id: current.id,
        candidate_snapshot_id: current.id,
        overview_persistent_directory: "C:\\energyiq\\managed",
        overview_pointer_key: "workspace-1/project-journal/current-overview",
        previous_overview_projection_key: "previous-projection",
        candidate_overview_projection_key: "candidate-projection",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("prepares the Snapshot identity before fact writes and rejects completion after pointer drift", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-snapshot-prepare-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-snapshot-prepare",
        workspace_id: "workspace-1",
        name: "Snapshot Prepare Project",
        status: "draft",
      });
      metadata.energyIq.createImportBatch({
        id: "batch-prepare",
        workspace_id: "workspace-1",
        project_id: "project-snapshot-prepare",
        source_kind: "excel",
        source_sha256: "sha-prepare",
        filename: "prepare.xlsx",
        status: "inspected",
        inspection: importInspection("batch-prepare"),
        created_by: "dev-user",
      });

      const materializations = [{
        batch_id: "batch-prepare",
        summary: materializationSummary("mapping-sha-1"),
      }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-snapshot-prepare",
        materializations,
        source_manifest_sha256: ["sha-prepare"],
      });

      expect(prepared).toMatchObject({
        expected_previous_snapshot_id: "unavailable",
        fact_scope: {
          workspaceId: "workspace-1",
          projectId: "project-snapshot-prepare",
          dataSnapshotId: prepared.expected_snapshot_id,
          sourceSha256: ["sha-prepare"],
        },
      });

      expect(() => metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-snapshot-prepare",
        materializations,
        project_audit: projectAudit(),
        source_manifest_sha256: ["sha-prepare"],
      } as never)).toThrow("ENERGYIQ_DATA_SNAPSHOT_EXPECTATION_REQUIRED");
      expect(metadata.energyIq.getImportBatch("batch-prepare").status).toBe("inspected");

      metadata.energyIq.upsertProject({
        ...metadata.energyIq.getProject("project-snapshot-prepare"),
        data_snapshot_id: "concurrent-snapshot",
      });
      expect(() => metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-snapshot-prepare",
        materializations,
        project_audit: projectAudit(),
        source_manifest_sha256: ["sha-prepare"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      })).toThrow("ENERGYIQ_SNAPSHOT_STALE:concurrent-snapshot");
      expect(metadata.energyIq.getImportBatch("batch-prepare").status).toBe("inspected");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores the controlled component catalog and one draft per Project and Tier", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({ id: "template-workspace", owner_user_id: "dev-user", name: "Templates", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "template-project", workspace_id: "template-workspace", name: "Templates", status: "draft" });

      const catalog = metadata.energyIq.templates.listComponentRevisions();
      expect(catalog.map((component) => component.revision_id)).toEqual(expect.arrayContaining([
        "decision.recommended_actions@1",
        "decision.executive_actions@1",
        "comparison.child_scope_ranking@1",
        "composition.meter_breakdown@1",
      ]));
      expect(catalog.find((component) => component.revision_id === "comparison.child_scope_ranking@1")?.allowed_presentation).toMatchObject({
        layout: { spans: [6, 8, 12] },
        visuals: {
          presets: ["bar", "list"],
          legend: { configurable: true, default: true },
          limit: { configurable: true, min: 1, max: 25, default: 10 },
        },
      });
      const initial = metadata.energyIq.templates.getProjectDraft({
        project_id: "template-project",
        tier_definition_ids: ["tier-circuit", "tier-level"],
      });
      expect(initial.revision).toBe(0);
      expect(initial.document.templates.map((template) => template.template_id)).toEqual([
        "project",
        "tier:tier-circuit",
        "tier:tier-level",
      ]);
      expect(initial.document.schema_version).toBe(2);
      expect(initial.document.templates[0]?.sections?.map((section) => section.section_id)).toEqual([
        "action-summary",
        "data-status",
        "energy-overview",
        "comparison",
        "time-pattern",
        "composition",
        "exceptions",
      ]);
      expect(initial.document.templates[0]?.components.map((item) => item.component_revision_id))
        .not.toContain("composition.meter_breakdown@1");
      expect(initial.document.templates[1]?.components.map((item) => item.component_revision_id))
        .toContain("composition.meter_breakdown@1");

      const projectTemplate = initial.document.templates[0]!;
      const saved = metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 0,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          templates: [
            {
              ...projectTemplate,
              components: projectTemplate.components.map((component, index) => ({
                ...component,
                enabled: index !== 0,
                ...(index === 0 ? {
                  layout: { span: 8 as const, height: "tall" as const },
                  presentation: {
                    ...component.presentation!,
                    tone: "highlight" as const,
                    title: "Project decision brief",
                  },
                } : {}),
              })),
            },
            ...initial.document.templates.slice(1),
          ],
        },
        updated_by: "dev-user",
      });
      expect(saved.revision).toBe(1);
      expect(saved.document.templates[0]?.components[0]?.enabled).toBe(false);
      expect(saved.document.templates[0]?.components[0]).toMatchObject({
        layout: { span: 8, height: "tall" },
        presentation: { tone: "highlight", title: "Project decision brief" },
      });
      expect(saved.document.templates[0]?.components[1]).toMatchObject({
        placement_id: expect.any(String),
        section_id: expect.any(String),
        layout: { span: expect.any(Number), height: expect.any(String) },
        presentation: { visual_preset: expect.any(String), density: expect.any(String), tone: expect.any(String) },
      });
      const reconciled = metadata.energyIq.templates.getProjectDraft({
        project_id: "template-project",
        tier_definition_ids: ["tier-circuit", "tier-room", "tier-level"],
      });
      expect(reconciled.revision).toBe(1);
      expect(reconciled.document.templates.map((template) => template.template_id)).toContain("tier:tier-room");
      expect(reconciled.document.templates[0]?.components[0]?.enabled).toBe(false);
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 0,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: saved.document,
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_DRAFT_REVISION_CONFLICT");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: [{ component_revision_id: "composition.meter_breakdown@1", enabled: true }],
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_COMPONENT_TARGET_INVALID");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          ...saved.document,
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component, index) => index < 2
                  ? { ...component, placement_id: "duplicate-placement" }
                  : component),
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_PLACEMENT_ID_INVALID");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          ...saved.document,
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component) => component.component_revision_id === "comparison.child_scope_ranking@1"
                  ? { ...component, presentation: { ...component.presentation!, visual_preset: "cards" as const } }
                  : component),
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_COMPONENT_VISUAL_NOT_ALLOWED");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          ...saved.document,
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component) => component.component_revision_id === "overview.consumption@1"
                  ? { ...component, layout: { ...component.layout!, span: 4 as const } }
                  : component),
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_COMPONENT_SPAN_NOT_ALLOWED");

      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores immutable rule revisions and versioned project selections", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-rules-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({ id: "rules-workspace", owner_user_id: "dev-user", name: "Rules", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "rules-project", workspace_id: "rules-workspace", name: "Rules", status: "draft" });

      const catalog = metadata.energyIq.rules.listRevisions();
      expect(catalog.map((rule) => rule.revision_id)).toContain("time.high_off_hours_share@1");
      expect(catalog.map((rule) => rule.revision_id)).toContain("comparison.people_intensity_outlier@1");
      expect(catalog.find((rule) => (
        rule.revision_id === "comparison.daily_usage_above_baseline@1"
      ))).toMatchObject({
        evaluation_key: "DAILY_USAGE_ABOVE_BASELINE",
        requirement: "historical_baseline",
        metric_revision_ids: ["energy.total_usage_kwh@1"],
        parameters: {
          relative_threshold_pct: 20,
          absolute_impact_kwh: 20,
          minimum_coverage_pct: 95,
          minimum_sample_count: 4,
          maximum_quality_event_count: 0,
          maximum_lookback_days: 60,
          direction: "above",
          baseline_method: "mean_of_complete_comparable_days_by_local_hour",
        },
      });
      expect(catalog.find((rule) => (
        rule.revision_id === "comparison.school_holiday_context@1"
      ))).toMatchObject({
        evaluation_key: "SCHOOL_HOLIDAY_CONTEXT_COMPARISON",
        requirement: "historical_baseline",
        metric_revision_ids: ["energy.total_usage_kwh@1"],
        parameters: {
          anomaly_relative_threshold_pct: 20,
          anomaly_absolute_threshold_kwh: 20,
          minimum_cohort_sample_count: 2,
          minimum_anomaly_baseline_samples: 4,
          comparison_method: "complete_holiday_interval_vs_adjacent_teaching_by_day_context",
          anomaly_baseline_method: "same_academic_phase_and_day_context_leave_one_out_mean",
        },
      });
      expect(metadata.energyIq.rules.getProjectConfig("rules-project")).toMatchObject({
        revision: 0,
        selected_rule_revision_ids: catalog
          .filter((rule) => rule.requirement !== "historical_baseline")
          .map((rule) => rule.revision_id),
      });

      const saved = metadata.energyIq.rules.saveProjectConfig({
        project_id: "rules-project",
        expected_revision: 0,
        selected_rule_revision_ids: ["quality.no_valid_data@1", "time.high_off_hours_share@1"],
        updated_by: "dev-user",
      });
      expect(saved).toMatchObject({
        revision: 1,
        selected_rule_revision_ids: ["quality.no_valid_data@1", "time.high_off_hours_share@1"],
      });
      expect(() => metadata.energyIq.rules.saveProjectConfig({
        project_id: "rules-project",
        expected_revision: 0,
        selected_rule_revision_ids: [],
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_RULE_CONFIG_REVISION_CONFLICT");
      expect(() => metadata.energyIq.rules.saveProjectConfig({
        project_id: "rules-project",
        expected_revision: 1,
        selected_rule_revision_ids: ["rule.unknown@1"],
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_RULE_REVISION_NOT_FOUND");

      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("migrates the rule requirement CHECK without losing immutable revisions", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-rule-requirement-migration-"));
    const databasePath = join(root, "metadata.sqlite");
    try {
      const legacy = new DatabaseSync(databasePath);
      legacy.exec(`
        CREATE TABLE energyiq_rule_revisions (
          revision_id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          display_name TEXT NOT NULL,
          description TEXT NOT NULL,
          family TEXT NOT NULL CHECK (family IN ('data_quality', 'time', 'comparison')),
          severity TEXT NOT NULL CHECK (severity IN ('info', 'warning')),
          evaluation_key TEXT NOT NULL,
          metric_revision_ids_json TEXT NOT NULL,
          parameters_json TEXT NOT NULL,
          requirement TEXT NOT NULL CHECK (requirement IN ('always', 'operating_hours', 'children', 'area_peers', 'people_peers')),
          created_at TEXT NOT NULL,
          UNIQUE (rule_id, version)
        );
      `);
      legacy.prepare(`
        INSERT INTO energyiq_rule_revisions (
          revision_id, rule_id, version, display_name, description, family, severity,
          evaluation_key, metric_revision_ids_json, parameters_json, requirement, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "comparison.legacy_custom@1",
        "comparison.legacy_custom",
        1,
        "Legacy custom",
        "Preserved migration fixture",
        "comparison",
        "info",
        "LEGACY_CUSTOM",
        "[]",
        "{}",
        "always",
        "2026-08-01T00:00:00.000Z",
      );
      legacy.close();

      const metadata = createMetadataStore({ database_path: databasePath });
      expect(metadata.energyIq.rules.listRevisions().map((rule) => rule.revision_id)).toEqual(
        expect.arrayContaining([
          "comparison.legacy_custom@1",
          "comparison.daily_usage_above_baseline@1",
        ]),
      );
      metadata.close();

      const migrated = new DatabaseSync(databasePath);
      const schema = migrated.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'energyiq_rule_revisions'
      `).get() as { sql: string };
      expect(schema.sql).toContain("historical_baseline");
      expect(() => migrated.prepare(`
        INSERT INTO energyiq_rule_revisions (
          revision_id, rule_id, version, display_name, description, family, severity,
          evaluation_key, metric_revision_ids_json, parameters_json, requirement, created_at
        ) VALUES ('invalid@1', 'invalid', 1, 'Invalid', 'Invalid', 'comparison', 'info',
          'INVALID', '[]', '{}', 'unsupported', '2026-08-01T00:00:00.000Z')
      `).run()).toThrow();
      migrated.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores immutable metric revisions and versioned project selections", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-metrics-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({
        id: "metrics-workspace",
        owner_user_id: "dev-user",
        name: "Metrics Workspace",
        kind: "customer"
      });
      metadata.energyIq.upsertProject({
        id: "metrics-project",
        workspace_id: "metrics-workspace",
        name: "Metrics Project",
        status: "draft"
      });

      const catalog = metadata.energyIq.metrics.listRevisions();
      expect(catalog.map((metric) => metric.revision_id)).toContain("energy.total_usage_kwh@1");
      expect(catalog.map((metric) => metric.revision_id)).toContain("energy.usage_per_person@1");

      const initial = metadata.energyIq.metrics.getProjectConfig("metrics-project");
      expect(initial.revision).toBe(0);
      expect(initial.selected_metric_revision_ids).toHaveLength(catalog.length);

      const saved = metadata.energyIq.metrics.saveProjectConfig({
        project_id: "metrics-project",
        expected_revision: 0,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
        updated_by: "dev-user"
      });
      expect(saved.revision).toBe(1);
      expect(saved.selected_metric_revision_ids).toEqual([
        "energy.total_usage_kwh@1",
        "energy.peak_demand_kw@1"
      ]);

      expect(() => metadata.energyIq.metrics.saveProjectConfig({
        project_id: "metrics-project",
        expected_revision: 0,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1"],
        updated_by: "dev-user"
      })).toThrow("ENERGYIQ_METRIC_CONFIG_REVISION_CONFLICT");
      expect(() => metadata.energyIq.metrics.saveProjectConfig({
        project_id: "metrics-project",
        expected_revision: 1,
        selected_metric_revision_ids: ["energy.unknown@1"],
        updated_by: "dev-user"
      })).toThrow("ENERGYIQ_METRIC_REVISION_NOT_FOUND");

      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("uses customer Workspace membership as the published Project visibility boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-access-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.users.upsertDevUser({
        id: "member-user",
        email: "member@example.com",
        display_name: "Member User",
        dev_token: "member-token"
      });
      metadata.workspaces.upsert({
        id: "customer-a",
        owner_user_id: "dev-user",
        name: "Customer A",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "customer-a",
        user_id: "member-user",
        role: "member"
      });
      metadata.energyIq.upsertProject({
        id: "published-a",
        workspace_id: "customer-a",
        name: "Published A",
        status: "published"
      });
      metadata.energyIq.upsertProject({
        id: "draft-a",
        workspace_id: "customer-a",
        name: "Draft A",
        status: "draft"
      });

      expect(metadata.energyIq.listVisibleProjects({
        user_id: "member-user",
        workspace_id: "customer-a",
        is_admin: false
      }).map((project) => project.id)).toEqual(["published-a"]);
      expect(metadata.energyIq.listVisibleProjects({
        user_id: "outsider",
        workspace_id: "customer-a",
        is_admin: false
      })).toEqual([]);
      expect(metadata.energyIq.listVisibleProjects({
        user_id: "dev-user",
        workspace_id: "customer-a",
        is_admin: true
      }).map((project) => project.id)).toEqual(["published-a", "draft-a"]);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores customer workspace, project hierarchy, access and version pins", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "workspace-1",
        user_id: "dev-user",
        role: "owner"
      });
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      const project = metadata.energyIq.upsertProject({
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Project One",
        status: "published",
        hierarchy_revision_id: "hierarchy-7"
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-1-root",
        project_id: project.id,
        name: "Project One",
        node_type: "project",
        sort_order: 0
      });
      metadata.energyIq.upsertProjectNode({
        id: "level-7",
        project_id: project.id,
        parent_id: "project-1-root",
        name: "Level 7",
        node_type: "level",
        sort_order: 10,
        area_sqm: 1_200,
        occupant_count: 80
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: project.id,
        user_id: "dev-user",
        role: "editor"
      });

      expect(metadata.energyIq.getUserRole("dev-user").role).toBe("admin");
      expect(metadata.workspaces.listByUser({ user_id: "dev-user" })[0]?.kind).toBe("customer");
      expect(metadata.energyIq.listProjectsForUser({
        user_id: "dev-user",
        workspace_id: "workspace-1"
      })).toHaveLength(1);
      expect(metadata.energyIq.listProjectNodes(project.id)).toMatchObject([
        { id: "project-1-root", node_type: "project" },
        { id: "level-7", parent_id: "project-1-root", area_sqm: 1_200 }
      ]);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps project setup edits in a draft until an immutable hierarchy revision is published", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-setup-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer"
      });
      metadata.energyIq.upsertProject({
        id: "project-setup",
        workspace_id: "workspace-1",
        name: "Draft Project",
        status: "draft",
        root_scope_id: "project-setup-root"
      });

      const initial = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-setup",
        user_id: "dev-user"
      });
      expect(initial).toMatchObject({
        project_id: "project-setup",
        revision: 1,
        document: {
          project: { name: "Draft Project", timezone: "Asia/Singapore" },
          tier_structure_locked: false,
          tiers: [],
          nodes: []
        }
      });

      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-setup",
        expected_revision: initial.revision,
        user_id: "dev-user",
        document: {
          project: { name: "Ngee Ann Test", timezone: "Asia/Singapore" },
          source_manifest: {
            id: "ignored-client-id",
            source_sha256: ["B".repeat(64), "a".repeat(64), "b".repeat(64)],
            confirmed: true,
          },
          tier_structure_locked: true,
          tiers: [
            { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
            { id: "tier-level", ordinal: 2, alias: "Level" }
          ],
          nodes: [
            {
              id: "level-6",
              tier_definition_id: "tier-level",
              name: "Level 6",
              sort_order: 10,
              metadata_status: "confirmed",
              area_sqm: 1_180,
              occupant_count: 76
            },
            {
              id: "level-7",
              tier_definition_id: "tier-level",
              name: "Level 7",
              sort_order: 20,
              metadata_status: "confirmed",
              area_sqm: 1_220,
              occupant_count: 82
            },
            {
              id: "level-6-light",
              tier_definition_id: "tier-circuit",
              parent_id: "level-6",
              name: "Total Office Light",
              sort_order: 30,
              metadata_status: "provisional"
            },
            {
              id: "level-7-light",
              tier_definition_id: "tier-circuit",
              parent_id: "level-7",
              name: "Total Office Light",
              sort_order: 40,
              metadata_status: "provisional"
            }
          ]
        }
      });
      expect(saved.revision).toBe(2);
      expect(saved.document.source_manifest).toEqual(createEnergyIqSourceManifest([
        "a".repeat(64),
        "b".repeat(64),
      ], true));
      expect(metadata.energyIq.listProjectNodes("project-setup")).toEqual([]);
      expect(metadata.energyIq.getProject("project-setup")).toMatchObject({
        status: "draft",
        has_unpublished_changes: true
      });

      const validation = metadata.energyIq.projectSetup.validateDraft("project-setup");
      expect(validation.blocking).toBe(false);

      const templateDraft = metadata.energyIq.templates.getProjectDraft({
        project_id: "project-setup",
        tier_definition_ids: ["tier-level", "tier-circuit"],
      });
      const savedTemplateDraft = metadata.energyIq.templates.saveProjectDraft({
        project_id: "project-setup",
        expected_revision: templateDraft.revision,
        tier_definition_ids: ["tier-level", "tier-circuit"],
        document: {
          templates: templateDraft.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component, index) => ({
                  ...component,
                  enabled: index !== 0,
                })),
              }
            : template),
        },
        updated_by: "dev-user",
      });
      const metricConfig = metadata.energyIq.metrics.saveProjectConfig({
        project_id: "project-setup",
        expected_revision: 0,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
        updated_by: "dev-user",
      });
      const ruleConfig = metadata.energyIq.rules.saveProjectConfig({
        project_id: "project-setup",
        expected_revision: 0,
        selected_rule_revision_ids: ["quality.no_valid_data@1"],
        updated_by: "dev-user",
      });

      const published = metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-setup",
        expected_revision: saved.revision,
        user_id: "dev-user",
        expected_template_draft_revision: savedTemplateDraft.revision,
        expected_metric_config_revision: metricConfig.revision,
        expected_rule_config_revision: ruleConfig.revision,
      });
      expect(published.hierarchy_revision_id).toBe("project-setup-hierarchy-v1");
      expect(published.template_revision_id).toBe("project-setup-template-v1");
      const publishedTemplate = metadata.energyIq.templates.getLatestProjectRevision("project-setup");
      expect(publishedTemplate).toMatchObject({
        revision_id: "project-setup-template-v1",
        hierarchy_revision_id: "project-setup-hierarchy-v1",
        source_template_draft_revision: 1,
        metric_config_revision: 1,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
        rule_config_revision: 1,
        selected_rule_revision_ids: ["quality.no_valid_data@1"],
      });
      expect(publishedTemplate?.document.templates[0]?.components[0]?.enabled).toBe(false);
      expect(metadata.energyIq.getProject("project-setup")).toMatchObject({
        name: "Ngee Ann Test",
        status: "published",
        delivery_stage: "published",
        hierarchy_revision_id: "project-setup-hierarchy-v1",
        has_unpublished_changes: false
      });
      expect(metadata.energyIq.listTierDefinitions("project-setup")).toMatchObject([
        { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
        { id: "tier-level", ordinal: 2, alias: "Level" }
      ]);
      expect(metadata.energyIq.listProjectNodes("project-setup")).toMatchObject([
        {
          id: "project-setup-root",
          node_type: "project"
        },
        {
          id: "level-6",
          tier_definition_id: "tier-level",
          parent_id: "project-setup-root",
          node_type: "level"
        },
        {
          id: "level-7",
          tier_definition_id: "tier-level",
          parent_id: "project-setup-root",
          node_type: "level"
        },
        {
          id: "level-6-light",
          tier_definition_id: "tier-circuit",
          parent_id: "level-6",
          node_type: "circuit"
        },
        {
          id: "level-7-light",
          tier_definition_id: "tier-circuit",
          parent_id: "level-7",
          node_type: "circuit"
        }
      ]);

      const postPublishDraft = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-setup",
        user_id: "dev-user"
      });
      expect(postPublishDraft.revision).toBe(3);
      const changed = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-setup",
        expected_revision: postPublishDraft.revision,
        user_id: "dev-user",
        document: {
          ...postPublishDraft.document,
          project: { ...postPublishDraft.document.project, name: "Unpublished rename" }
        }
      });
      metadata.energyIq.templates.saveProjectDraft({
        project_id: "project-setup",
        expected_revision: savedTemplateDraft.revision,
        tier_definition_ids: ["tier-level", "tier-circuit"],
        document: templateDraft.document,
        updated_by: "dev-user",
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("project-setup"))
        .toEqual(publishedTemplate);
      expect(changed.revision).toBe(4);
      expect(metadata.energyIq.getProject("project-setup").name).toBe("Ngee Ann Test");
      expect(() => metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-setup",
        expected_revision: 3,
        user_id: "dev-user",
        document: changed.document
      })).toThrow("ENERGYIQ_SETUP_REVISION_CONFLICT");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("allows incomplete drafts but blocks skipped tiers and reports meaningless single-node tiers", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-validation-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer"
      });
      metadata.energyIq.upsertProject({
        id: "project-validation",
        workspace_id: "workspace-1",
        name: "Validation Project",
        status: "draft"
      });
      const initial = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-validation",
        user_id: "dev-user"
      });
      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-validation",
        expected_revision: initial.revision,
        user_id: "dev-user",
        document: {
          project: { name: "Validation Project", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [
            { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
            { id: "tier-block", ordinal: 3, alias: "Block" }
          ],
          nodes: [
            {
              id: "only-block",
              tier_definition_id: "tier-block",
              name: "Only Block",
              sort_order: 10,
              metadata_status: "provisional"
            },
            {
              id: "circuit-1",
              tier_definition_id: "tier-circuit",
              parent_id: "only-block",
              name: "Circuit 1",
              sort_order: 20,
              metadata_status: "provisional"
            }
          ]
        }
      });
      const validation = metadata.energyIq.projectSetup.validateDraft("project-validation");
      expect(validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "TIER_ORDINAL_GAP", severity: "error" }),
        expect.objectContaining({ code: "NODE_SKIPS_TIER", severity: "error" }),
        expect.objectContaining({ code: "SINGLE_NODE_TIER_NEEDS_REASON", severity: "warning" })
      ]));
      expect(() => metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-validation",
        expected_revision: saved.revision,
        user_id: "dev-user"
      })).toThrow("ENERGYIQ_SETUP_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores immutable import inspections and advances a deterministic composite data snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-import-batch-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-import",
        workspace_id: "workspace-1",
        name: "Import Project",
        status: "draft",
      });
      const created = metadata.energyIq.createImportBatch({
        id: "batch-1",
        workspace_id: "workspace-1",
        project_id: "project-import",
        source_kind: "excel",
        source_sha256: "sha-1",
        filename: "meter.xlsx",
        status: "inspected",
        inspection: importInspection("batch-1"),
        created_by: "dev-user",
      });

      expect(JSON.parse(created.inspection_json)).toMatchObject({ rowCount: 10 });
      expect(metadata.energyIq.findImportBatchBySha({
        project_id: "project-import",
        source_sha256: "sha-1",
      })?.id).toBe("batch-1");
      expect(metadata.energyIq.listImportBatches("project-import")).toHaveLength(1);
      const complete = (input: ProjectManifestCompletionInput) =>
        completePreparedProjectManifest(metadata.energyIq, input);
      const first = complete({
        batch_id: "batch-1",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-1"),
        project_audit: projectAudit(),
      });
      expect(first.batch.status).toBe("materialized");
      expect(JSON.parse(first.batch.materialization_json ?? "{}")).toMatchObject({
        intervalFactCount: 9,
      });
      expect(JSON.parse(first.batch.materialization_json ?? "{}")).not.toHaveProperty("snapshotId");
      expect(metadata.energyIq.getProject("project-import").data_snapshot_id).toBe(first.snapshot.id);
      expect(JSON.parse(first.snapshot.manifest_json)).toMatchObject({
        version: 1,
        projectId: "project-import",
        batches: [{ batchId: "batch-1", sourceSha256: "sha-1" }],
      });

      metadata.energyIq.createImportBatch({
        id: "batch-2",
        workspace_id: "workspace-1",
        project_id: "project-import",
        source_kind: "excel",
        source_sha256: "sha-2",
        filename: "meter-2.xlsx",
        status: "inspected",
        inspection: importInspection("batch-2"),
        created_by: "dev-user",
      });
      const second = complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-1"),
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      });
      expect(second.snapshot.id).not.toBe(first.snapshot.id);
      expect(JSON.parse(second.snapshot.manifest_json)).toMatchObject({
        batches: [
          { sourceSha256: "sha-1" },
          { sourceSha256: "sha-2" },
        ],
      });
      expect(JSON.parse(second.snapshot.audit_json)).toMatchObject({ rawOverlapConflictCount: 2 });
      expect(metadata.energyIq.getDataSnapshot(second.snapshot.id).id).toBe(second.snapshot.id);
      expect(complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-1"),
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      }).snapshot.id).toBe(second.snapshot.id);
      expect(JSON.stringify(JSON.parse(second.snapshot.manifest_json))).not.toContain("mappingRevision");
      const mappingB = complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-2", 4),
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      });
      expect(mappingB.snapshot.id).not.toBe(second.snapshot.id);
      const rolledBack = complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-1", 5),
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      });
      expect(rolledBack.snapshot.id).toBe(second.snapshot.id);
      expect(JSON.parse(rolledBack.snapshot.manifest_json)).toEqual(JSON.parse(second.snapshot.manifest_json));
      expect(resolveEnergyIqSnapshotFactScope(second.snapshot).factWriterContractVersion)
        .toBe("energy-fact-writer-project-canonical-v2");
      expect(JSON.parse(rolledBack.batch.materialization_json ?? "{}")).toMatchObject({ mappingRevision: 5 });
      const legacyWriterContract = complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: {
          ...materializationSummary("mapping-sha-1", 5),
          factWriterContractVersion: "energy-fact-writer-later-coverage-v1",
        },
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      });
      expect(legacyWriterContract.snapshot.id).not.toBe(second.snapshot.id);
      const upgradedWriterContract = complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-1", 5),
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      });
      expect(upgradedWriterContract.snapshot.id).toBe(second.snapshot.id);
      expect(() => complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: { ...materializationSummary("mapping-sha-1"), rawRowCount: 11 },
        project_audit: projectAudit({ rawOverlapConflictCount: 2 }),
      })).toThrow(`ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:${second.snapshot.id}`);
      expect(() => complete({
        batch_id: "batch-2",
        project_id: "project-import",
        summary: materializationSummary("mapping-sha-1"),
        project_audit: projectAudit({ rawOverlapConflictCount: 3 }),
      })).toThrow(`ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:${second.snapshot.id}`);

      const replayRoot = mkdtempSync(join(tmpdir(), "energyiq-import-batch-replay-"));
      const replay = createMetadataStore({ database_path: join(replayRoot, "metadata.sqlite") });
      try {
        replay.workspaces.upsert({
          id: "workspace-1",
          owner_user_id: "dev-user",
          name: "Customer Workspace",
          kind: "customer",
        });
        replay.energyIq.upsertProject({
          id: "project-import",
          workspace_id: "workspace-1",
          name: "Import Project",
          status: "draft",
        });
        for (const input of [
          { id: "replay-b", sha: "sha-2", filename: "renamed-later.xlsx", coverage: "batch-2" },
          { id: "replay-a", sha: "sha-1", filename: "renamed-earlier.xlsx", coverage: "batch-1" },
        ]) {
          replay.energyIq.createImportBatch({
            id: input.id,
            workspace_id: "workspace-1",
            project_id: "project-import",
            source_kind: "excel",
            source_sha256: input.sha,
            filename: input.filename,
            status: "inspected",
            inspection: importInspection(input.coverage),
            created_by: "dev-user",
          });
          completePreparedProjectManifest(replay.energyIq, {
            batch_id: input.id,
            project_id: "project-import",
            summary: materializationSummary("mapping-sha-1"),
            project_audit: projectAudit({ rawOverlapConflictCount: input.coverage === "batch-1" ? 2 : 0 }),
          });
        }
        expect(replay.energyIq.getProject("project-import").data_snapshot_id).toBe(second.snapshot.id);
      } finally {
        replay.close();
        rmSync(replayRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }

      const reverseRoot = mkdtempSync(join(tmpdir(), "energyiq-import-batch-reverse-"));
      const reverse = createMetadataStore({ database_path: join(reverseRoot, "metadata.sqlite") });
      try {
        reverse.workspaces.upsert({
          id: "workspace-1",
          owner_user_id: "dev-user",
          name: "Customer Workspace",
          kind: "customer",
        });
        reverse.energyIq.upsertProject({
          id: "project-import",
          workspace_id: "workspace-1",
          name: "Import Project",
          status: "draft",
        });
        let reverseFinalSnapshotId = "";
        for (const input of [
          { id: "batch-2", sha: "sha-2", filename: "meter-2.xlsx", coverage: "batch-2" },
          { id: "batch-1", sha: "sha-1", filename: "meter.xlsx", coverage: "batch-1" },
        ]) {
          reverse.energyIq.createImportBatch({
            id: input.id,
            workspace_id: "workspace-1",
            project_id: "project-import",
            source_kind: "excel",
            source_sha256: input.sha,
            filename: input.filename,
            status: "inspected",
            inspection: importInspection(input.coverage),
            created_by: "dev-user",
          });
          reverseFinalSnapshotId = completePreparedProjectManifest(reverse.energyIq, {
            batch_id: input.id,
            project_id: "project-import",
            summary: materializationSummary("mapping-sha-1"),
            project_audit: projectAudit({ rawOverlapConflictCount: input.id === "batch-1" ? 2 : 0 }),
          }).snapshot.id;
        }
        const reverseFinal = reverse.energyIq.getDataSnapshot(reverseFinalSnapshotId);
        expect(reverseFinal.id).toBe(second.snapshot.id);
        expect(JSON.parse(reverseFinal.manifest_json)).toEqual(JSON.parse(second.snapshot.manifest_json));
        expect(JSON.parse(reverseFinal.audit_json)).toEqual(JSON.parse(second.snapshot.audit_json));
      } finally {
        reverse.close();
        rmSync(reverseRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      expect(() => metadata.energyIq.createImportBatch({
        ...created,
        id: "batch-duplicate",
        inspection: {},
      })).toThrow();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

type EnergyIqMetadataApi = ReturnType<typeof createMetadataStore>["energyIq"];
type ProjectManifestCompletionInput = {
  batch_id: string;
  project_id: string;
  summary: unknown;
  project_audit: unknown;
  source_manifest_sha256?: readonly string[];
};

const completePreparedProjectManifest = (
  energyIq: EnergyIqMetadataApi,
  input: ProjectManifestCompletionInput,
) => {
  const batches = energyIq.listImportBatches(input.project_id);
  const materializations = batches.map((batch) => ({
    batch_id: batch.id,
    summary: batch.id === input.batch_id
      ? input.summary
      : requireTestMaterializationSummary(batch.id, batch.materialization_json),
  }));
  const sourceManifestSha256 = input.source_manifest_sha256
    ?? batches.map((batch) => batch.source_sha256);
  const prepared = energyIq.prepareProjectManifestMaterialization({
    project_id: input.project_id,
    materializations,
    source_manifest_sha256: sourceManifestSha256,
  });
  const completed = energyIq.completeProjectManifestMaterialization({
    project_id: input.project_id,
    materializations,
    project_audit: input.project_audit,
    source_manifest_sha256: sourceManifestSha256,
    expected_snapshot_id: prepared.expected_snapshot_id,
    expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
  });
  const batch = completed.batches.find((candidate) => candidate.id === input.batch_id);
  if (!batch) throw new Error(`TEST_IMPORT_BATCH_NOT_COMPLETED:${input.batch_id}`);
  return { batch, snapshot: completed.snapshot };
};

const requireTestMaterializationSummary = (
  batchId: string,
  materializationJson: string | null | undefined,
): unknown => {
  if (materializationJson === null || materializationJson === undefined) {
    throw new Error(`TEST_IMPORT_MATERIALIZATION_MISSING:${batchId}`);
  }
  return JSON.parse(materializationJson) as unknown;
};

const materializationSummary = (mappingFingerprint: string, mappingRevision = 3) => ({
  rawRowCount: 10,
  normalizedReadingCount: 10,
  intervalFactCount: 9,
  totalUsageKwh: 1,
  qualityCounts: { ok: 9, boundary: 1 },
  mappingRevision,
  mappingFingerprint,
  timezone: "Asia/Singapore",
  materializerContractVersion: "energy-excel-cumulative-v1",
  factWriterContractVersion: "energy-fact-writer-project-canonical-v2",
});

const importInspection = (batchId: string) => ({
  sheetName: "Sheet1",
  rowCount: 10,
  sourceLabels: [{ label: "Meter 1", rowCount: 10 }],
  coverageFrom: batchId === "batch-1"
    ? "2026-04-20T16:00:00.000Z"
    : "2026-05-19T16:00:00.000Z",
  coverageTo: batchId === "batch-1"
    ? "2026-05-20T15:45:00.000Z"
    : "2026-06-17T15:45:00.000Z",
});

const projectAudit = (overrides: Record<string, number> = {}) => ({
  rawRowCount: 10,
  invalidRawRowCount: 0,
  unmappedRawRowCount: 0,
  rawOverlapConflictCount: 0,
  normalizedReadingCount: 10,
  intervalFactCount: 9,
  duplicateNormalizedReadingCount: 0,
  duplicateIntervalFactCount: 0,
  invalidIntervalDurationCount: 0,
  negativeDeltaIntervalCount: 0,
  legacyRawRowCount: 0,
  legacyNormalizedReadingCount: 0,
  legacyIntervalFactCount: 0,
  legacyCanonicalRowCount: 0,
  canonicalMeterSeriesCount: 1,
  adjacentReadingPairCount: 9,
  missingAdjacentIntervalCount: 0,
  orphanIntervalFactCount: 0,
  ...overrides,
});

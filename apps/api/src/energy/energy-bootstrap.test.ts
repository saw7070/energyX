import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
} from "./energy-bootstrap.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { resolveNgeeAnnSectionManifestForRelease } from "./ngee-ann-section-manifest.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

const publishBootstrapOwnedHolidayV1Release = (
  metadata: ReturnType<typeof createMetadataStore>,
) => {
  const projectId = "ngee-ann-polytechnic";
  const project = metadata.energyIq.getProject(projectId);
  const currentCalendar = metadata.energyIq.operationalPolicy.getOperatingCalendar(
    "sg-calendar-holiday-v2",
  );
  if (!currentCalendar) throw new Error("NGEE_ANN_HOLIDAY_V2_CALENDAR_REQUIRED");
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "sg-calendar-holiday-v1",
    project_id: projectId,
    published_by: "dev-user",
    activate: true,
    entries: currentCalendar.entries.map((entry) => ({
      ...entry,
      weekly: {
        monday: [{ from: "00:00", to: "24:00" }],
        tuesday: [{ from: "00:00", to: "24:00" }],
        wednesday: [{ from: "00:00", to: "24:00" }],
        thursday: [{ from: "00:00", to: "24:00" }],
        friday: [{ from: "00:00", to: "24:00" }],
        saturday: [{ from: "00:00", to: "24:00" }],
        sunday: [{ from: "00:00", to: "24:00" }],
      },
    })),
    ...(currentCalendar.academic_periods
      ? { academic_periods: currentCalendar.academic_periods }
      : {}),
  });
  return metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
    project_id: projectId,
    tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
    hierarchy_revision_id: project.hierarchy_revision_id,
    meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
      metadataStore: metadata,
      projectId,
      hierarchyRevisionId: project.hierarchy_revision_id,
      scopeId: project.root_scope_id,
      resource: "electricity",
    }).meterMappingRevisionId,
    published_by: "dev-user",
    published_at: "2026-08-20T00:00:00.000Z",
  });
};

describe("ensureEnergyIqBootstrap", () => {
  it("publishes Tuya Office as Space over Distribution Board while keeping circuits as Meter Points", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-tuya-office-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(TUYA_OFFICE_PROJECT_ID)
        .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
      const document = JSON.parse(revision.snapshot_json) as ReturnType<typeof metadata.energyIq.projectSetup.getDraft>["document"];

      expect(document.tiers.map((tier) => [tier.ordinal, tier.alias])).toEqual([
        [1, "Distribution Board"],
        [2, "Space"],
      ]);
      expect(document.nodes.filter((node) => node.tier_definition_id === "tuya-office-tier-distribution-board"))
        .toHaveLength(3);
      expect(document.nodes.some((node) => /circuit/iu.test(node.name))).toBe(false);
      expect(document.meter_mapping).toMatchObject({ source_kind: "tuya", confirmed: true });
      expect(document.meter_mapping?.rows).toHaveLength(20);
      expect(document.meter_mapping?.rows.every((row) => row.scope_id.startsWith("tuya-office-db"))).toBe(true);

      const db1Other = document.meter_mapping?.virtual_meters
        ?.find((meter) => meter.id === "tuya-office-db1-other-load");
      expect(db1Other?.terms.map((term) => term.mapping_row_id)).not.toContain("panel-a-lighting");
      expect(document.meter_mapping?.rows
        .filter((row) => row.id.startsWith("panel-c-meter"))
        .every((row) => row.coverage === "partial")).toBe(true);
      expect(resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
        hierarchyRevisionId: project.hierarchy_revision_id,
        scopeId: "tuya-office-space-2",
        resource: "electricity",
      }).officialMeterPointIds).toEqual(expect.arrayContaining([
        "panel-b-total",
        "panel-b-lighting",
        "panel-c-meter-01",
        "panel-c-meter-02",
        "panel-c-meter-03",
      ]));
      const templateRevision = metadata.energyIq.templates.getLatestProjectRevision(TUYA_OFFICE_PROJECT_ID);
      expect(templateRevision).not.toBeNull();
      expect(metadata.energyIq.overviewDefinitions.get(templateRevision!.revision_id)).toMatchObject({
        renderer_key: "tuya-office-overview",
        time_policy_revision_id: "tuya-office-report-time@2",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not replace a customer-edited Preschool Draft while repairing the legacy demo", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-user-draft-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "preschool-demo-org",
        owner_user_id: "dev-user",
        name: "Preschool Demo",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "preschool-demo",
          workspace_id: "preschool-demo-org",
          name: "Preschool Portfolio",
          hierarchy_revision_id: "preschool-hierarchy-v4",
          meter_formula_revision_id: "preschool-meter-formula-v2",
          root_scope_id: "preschool-project",
        },
        document: {
          project: { name: "Preschool Portfolio", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "preschool-tier-centre", ordinal: 1, alias: "Centre" }],
          nodes: [{
            id: "preschool-centre-a",
            tier_definition_id: "preschool-tier-centre",
            name: "Centre A",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: "preschool-demo",
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "preschool-demo",
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          project: { ...draft.document.project, name: "Customer-edited Preschool" },
        },
      });

      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.getProject("preschool-demo")).toMatchObject({
        hierarchy_revision_id: "preschool-hierarchy-v4",
        has_unpublished_changes: true,
      });
      expect(metadata.energyIq.projectSetup.getDraft({
        project_id: "preschool-demo",
        user_id: "dev-user",
      }).document.project.name).toBe("Customer-edited Preschool");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resumes the exact bootstrap-owned Preschool route migration after a saved Draft", () => {
    const referenceRoot = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-reference-"));
    const legacyRoot = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-resume-"));
    const reference = createMetadataStore({ database_path: join(referenceRoot, "metadata.sqlite") });
    const metadata = createMetadataStore({ database_path: join(legacyRoot, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(reference);
      const referenceProject = reference.energyIq.getProject("preschool-demo");
      const referenceRevision = reference.energyIq.projectSetup
        .listHierarchyRevisions("preschool-demo")
        .find((revision) => revision.id === referenceProject.hierarchy_revision_id)!;
      const migrationDocument = JSON.parse(referenceRevision.snapshot_json);

      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "preschool-demo-org",
        owner_user_id: "dev-user",
        name: "Preschool Demo",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "preschool-demo",
          workspace_id: "preschool-demo-org",
          name: "Preschool Portfolio",
          hierarchy_revision_id: "preschool-hierarchy-v4",
          meter_formula_revision_id: "preschool-meter-formula-v2",
          data_snapshot_id: "legacy-preschool-snapshot",
          business_calendar_version: "legacy-preschool-calendar",
          tariff_schedule_version: "legacy-preschool-tariff",
          root_scope_id: "preschool-project",
        },
        document: {
          project: { name: "Preschool Portfolio", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "preschool-tier-centre", ordinal: 1, alias: "Centre" }],
          nodes: [{
            id: "preschool-centre-a",
            tier_definition_id: "preschool-tier-centre",
            name: "Centre A",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: "preschool-demo",
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "preschool-demo",
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: migrationDocument,
      });

      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.getProject("preschool-demo")).toMatchObject({
        hierarchy_revision_id: "preschool-demo-hierarchy-v5",
        has_unpublished_changes: false,
      });
    } finally {
      reference.close();
      metadata.close();
      rmSync(referenceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(legacyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("publishes explicit Meter Routes once for the exact legacy Preschool demo revision", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "preschool-demo-org",
        owner_user_id: "dev-user",
        name: "Preschool Demo",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "preschool-demo",
          workspace_id: "preschool-demo-org",
          name: "Preschool Portfolio",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "preschool-hierarchy-v4",
          meter_formula_revision_id: "preschool-meter-formula-v2",
          data_snapshot_id: "legacy-preschool-snapshot",
          metric_version: "energy-metrics-v1",
          business_calendar_version: "legacy-preschool-calendar",
          tariff_schedule_version: "legacy-preschool-tariff",
          root_scope_id: "preschool-project",
        },
        document: {
          project: { name: "Preschool Portfolio", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "preschool-tier-centre", ordinal: 1, alias: "Centre" }],
          nodes: [{
            id: "preschool-centre-a",
            tier_definition_id: "preschool-tier-centre",
            name: "Centre A",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });

      expect(() => resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: "preschool-demo",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        scopeId: "preschool-project",
        resource: "electricity",
      })).toThrow("ENERGYIQ_PUBLISHED_MAPPING_ROUTE_REQUIRED:preschool-hierarchy-v4");

      ensureEnergyIqBootstrap(metadata);

      const migrated = metadata.energyIq.getProject("preschool-demo");
      expect(migrated).toMatchObject({
        hierarchy_revision_id: "preschool-demo-hierarchy-v5",
        data_snapshot_id: "legacy-preschool-snapshot",
        business_calendar_version: "legacy-preschool-calendar",
        tariff_schedule_version: "legacy-preschool-tariff",
      });
      expect(resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: "preschool-demo",
        hierarchyRevisionId: migrated.hierarchy_revision_id,
        scopeId: migrated.root_scope_id,
        resource: "electricity",
      })).toMatchObject({
        source: "published",
        officialMeterPointIds: expect.arrayContaining(["preschool-centre-a-aircon-1"]),
      });

      const firstRevision = metadata.energyIq.templates.getLatestProjectRevision("preschool-demo");
      const firstHierarchyCount = metadata.energyIq.projectSetup
        .listHierarchyRevisions("preschool-demo").length;
      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.getProject("preschool-demo").hierarchy_revision_id)
        .toBe("preschool-demo-hierarchy-v5");
      expect(metadata.energyIq.projectSetup.listHierarchyRevisions("preschool-demo"))
        .toHaveLength(firstHierarchyCount);
      expect(metadata.energyIq.templates.getLatestProjectRevision("preschool-demo")?.revision_id)
        .toBe(firstRevision?.revision_id);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("enables the release-pinned daily anomaly Rule for a new Ngee Ann Project only", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-rules-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic"))
        .toMatchObject({
          revision: 1,
          selected_rule_revision_ids: expect.arrayContaining([
            "comparison.daily_usage_above_baseline@1",
          ]),
        });
      expect(metadata.energyIq.rules.getProjectConfig("preschool-demo")
        .selected_rule_revision_ids)
        .not.toContain("comparison.daily_usage_above_baseline@1");

      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic").revision).toBe(1);

      const configured = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");
      metadata.energyIq.rules.saveProjectConfig({
        project_id: "ngee-ann-polytechnic",
        expected_revision: configured.revision,
        selected_rule_revision_ids: configured.selected_rule_revision_ids.filter(
          (id) => id !== "comparison.daily_usage_above_baseline@1",
        ),
        updated_by: "dev-user",
      });
      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic"))
        .toMatchObject({
          revision: 2,
          selected_rule_revision_ids: expect.not.arrayContaining([
            "comparison.daily_usage_above_baseline@1",
          ]),
        });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not auto-publish a Holiday Release over an administrator calendar", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-custom-calendar-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const project = metadata.energyIq.getProject(projectId);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "customer-calendar-v2",
        project_id: projectId,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "customer-calendar",
          owner: { kind: "project" },
          effective_from: "2026-01-01",
          weekly: {
            monday: [{ from: "08:00", to: "18:00" }],
            tuesday: [{ from: "08:00", to: "18:00" }],
            wednesday: [{ from: "08:00", to: "18:00" }],
            thursday: [{ from: "08:00", to: "18:00" }],
            friday: [{ from: "08:00", to: "18:00" }],
            saturday: [],
            sunday: [],
          },
          exceptions: [],
        }],
      });
      const customerRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: projectId,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-21T00:00:00.000Z",
      });
      const revisionCount = metadata.energyIq.templates.listProjectRevisions(projectId).length;

      ensureEnergyIqBootstrap(metadata);
      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.templates.listProjectRevisions(projectId)).toHaveLength(revisionCount);
      expect(metadata.energyIq.templates.getLatestProjectRevision(projectId)).toMatchObject({
        revision_id: customerRevision.revision_id,
        business_calendar_version: "customer-calendar-v2",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("upgrades the previous bootstrap-owned Holiday Calendar without rewriting its historical Release", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-holiday-v1-upgrade-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const legacyRelease = publishBootstrapOwnedHolidayV1Release(metadata);
      expect(legacyRelease.business_calendar_version).toBe("sg-calendar-holiday-v1");

      ensureEnergyIqBootstrap(metadata);

      const upgradedRelease = metadata.energyIq.templates.getLatestProjectRevision(projectId);
      expect(upgradedRelease).toMatchObject({
        business_calendar_version: "sg-calendar-holiday-v2",
        selected_rule_revision_ids: expect.arrayContaining([
          "comparison.school_holiday_context@1",
        ]),
      });
      expect(upgradedRelease?.revision_id).not.toBe(legacyRelease.revision_id);
      expect(metadata.energyIq.templates.getProjectRevision(
        legacyRelease.revision_id,
      )).toMatchObject({
        revision_id: legacyRelease.revision_id,
        business_calendar_version: "sg-calendar-holiday-v1",
      });

      const revisionCount = metadata.energyIq.templates.listProjectRevisions(projectId).length;
      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.templates.listProjectRevisions(projectId)).toHaveLength(revisionCount);
      expect(metadata.energyIq.templates.getLatestProjectRevision(projectId)?.revision_id)
        .toBe(upgradedRelease?.revision_id);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not freeze a pending administrator Calendar into an automatic Holiday Release", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-holiday-pending-calendar-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const legacyRelease = publishBootstrapOwnedHolidayV1Release(metadata);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "customer-calendar-pending-v1",
        project_id: projectId,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "customer-calendar-pending",
          owner: { kind: "project" },
          effective_from: "2026-01-01",
          weekly: {
            monday: [{ from: "07:30", to: "19:00" }],
            tuesday: [{ from: "07:30", to: "19:00" }],
            wednesday: [{ from: "07:30", to: "19:00" }],
            thursday: [{ from: "07:30", to: "19:00" }],
            friday: [{ from: "07:30", to: "19:00" }],
            saturday: [],
            sunday: [],
          },
          exceptions: [],
        }],
      });
      const revisionCount = metadata.energyIq.templates.listProjectRevisions(projectId).length;

      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions(projectId))
        .toMatchObject({ business_calendar_version: "customer-calendar-pending-v1" });
      expect(metadata.energyIq.templates.listProjectRevisions(projectId)).toHaveLength(revisionCount);
      expect(metadata.energyIq.templates.getLatestProjectRevision(projectId)?.revision_id)
        .toBe(legacyRelease.revision_id);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("attaches immutable Overview Definitions to existing pilot Template Revisions", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-overview-definition-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      for (const projectId of ["ngee-ann-polytechnic", "preschool-demo", TUYA_OFFICE_PROJECT_ID] as const) {
        const project = metadata.energyIq.getProject(projectId);
        const revision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
          project_id: projectId,
          tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
          hierarchy_revision_id: project.hierarchy_revision_id,
          meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
            metadataStore: metadata,
            projectId,
            hierarchyRevisionId: project.hierarchy_revision_id,
            scopeId: project.root_scope_id,
            resource: "electricity",
          }).meterMappingRevisionId,
          published_by: "dev-user",
          published_at: "2026-08-19T00:00:00.000Z",
        });
        expect(metadata.energyIq.overviewDefinitions.get(revision.revision_id)).toBeNull();
      }

      ensureEnergyIqBootstrap(metadata);

      const ngeeRevision = metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic");
      const preschoolRevision = metadata.energyIq.templates.getLatestProjectRevision("preschool-demo");
      const tuyaRevision = metadata.energyIq.templates.getLatestProjectRevision(TUYA_OFFICE_PROJECT_ID);
      const ngeeDefinition = metadata.energyIq.overviewDefinitions.get(ngeeRevision!.revision_id);
      expect(ngeeDefinition).toMatchObject({
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "ngee-ann-report-time@2",
        definition: {
          timePolicyRevisionId: "ngee-ann-report-time@2",
          sections: expect.arrayContaining([
            expect.objectContaining({ primaryWindowId: "current-month-progress" }),
            expect.objectContaining({
              key: "school-holiday-comparison",
              primaryWindowId: "school-holiday-comparison",
              blocks: [expect.objectContaining({ windowId: "school-holiday-comparison" })],
            }),
          ]),
        },
      });
      expect(ngeeDefinition?.definition.sections).toHaveLength(5);
      expect(ngeeRevision).toMatchObject({
        business_calendar_version: "sg-calendar-holiday-v2",
        selected_rule_revision_ids: expect.arrayContaining([
          "comparison.daily_usage_above_baseline@1",
          "comparison.school_holiday_context@1",
        ]),
      });
      expect(new Set(ngeeRevision?.selected_rule_revision_ids).size)
        .toBe(ngeeRevision?.selected_rule_revision_ids.length);
      expect(metadata.energyIq.reportTimePolicies.get(
        "ngee-ann-polytechnic",
        "ngee-ann-report-time@2",
      )).toMatchObject({
        policy: {
          windows: expect.arrayContaining([expect.objectContaining({
            windowId: "school-holiday-comparison",
            role: "comparison",
            strategy: { kind: "rolling_complete_days", days: 120 },
          })]),
        },
      });
      expect(metadata.energyIq.reportTimePolicies.get(
        "ngee-ann-polytechnic",
        "ngee-ann-report-time@1",
      )).toMatchObject({
        policy: {
          windows: expect.arrayContaining([
            expect.objectContaining({ windowId: "current-month-progress" }),
          ]),
        },
      });
      expect(metadata.energyIq.reportTimePolicies.get(
        "ngee-ann-polytechnic",
        "ngee-ann-report-time@1",
      )?.policy.windows).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ windowId: "school-holiday-comparison" }),
      ]));
      expect(metadata.energyIq.operationalPolicy.getOperatingCalendar(
        "sg-calendar-holiday-v2",
      )).toMatchObject({
        project_id: "ngee-ann-polytechnic",
        academic_periods: expect.arrayContaining([
          expect.objectContaining({ id: "ay2026-sem1-break", phase: "term_break" }),
        ]),
        entries: [expect.objectContaining({
          weekly: expect.objectContaining({
            monday: [{ from: "08:00", to: "18:00" }],
            friday: [{ from: "08:00", to: "18:00" }],
            saturday: [],
            sunday: [],
          }),
          exceptions: expect.arrayContaining([
            expect.objectContaining({
              date: "2026-06-01",
              classification: "public_holiday",
            }),
          ]),
        })],
      });
      expect(resolveNgeeAnnSectionManifestForRelease(
        metadata,
        ngeeRevision!.revision_id,
      )).toMatchObject({
        projectReleaseId: ngeeRevision!.revision_id,
        enabledSectionIds: [
          "trend-and-demand",
          "time-behaviour",
          "circuit-concentration",
          "decision-priorities",
          "school-holiday-comparison",
        ],
        disabledCapabilities: [],
      });
      expect(ngeeDefinition?.definition.sections
        .find((section) => section.key === "circuit-analysis")
        ?.blocks.find((block) => block.key === "ngee-recommendations"))
        .toMatchObject({ windowId: "current-month-progress" });
      expect(metadata.energyIq.overviewDefinitions.get(preschoolRevision!.revision_id)).toMatchObject({
        renderer_key: "preschool-overview",
        time_policy_revision_id: "preschool-report-time@2",
        definition: { sections: expect.arrayContaining([expect.objectContaining({ primaryWindowId: "current-overview" })]) },
      });
      const preschoolSlots = metadata.energyIq.overviewDefinitions.get(preschoolRevision!.revision_id)?.definition.aiSlots ?? [];
      expect(preschoolSlots).toHaveLength(6);
      expect(preschoolSlots.every((slot) => slot.validatorRevision === "preschool-html-ai-slot-validator@13")).toBe(true);
      expect(preschoolSlots.every((slot) => slot.revision.endsWith("@6"))).toBe(true);
      expect(preschoolSlots.every((slot) => slot.contextRevision === "preschool-html-slot-context@2")).toBe(true);
      expect(metadata.energyIq.overviewDefinitions.get(tuyaRevision!.revision_id)).toMatchObject({
        renderer_key: "tuya-office-overview",
        time_policy_revision_id: "tuya-office-report-time@2",
        definition: {
          sections: expect.arrayContaining([
            expect.objectContaining({ key: "key-findings", primaryWindowId: "current-overview" }),
            expect.objectContaining({ key: "decision-lenses", primaryWindowId: "current-overview" }),
            expect.objectContaining({ key: "recommended-actions", primaryWindowId: "current-overview" }),
          ]),
        },
      });
      const tuyaSlots = metadata.energyIq.overviewDefinitions
        .get(tuyaRevision!.revision_id)?.definition.aiSlots ?? [];
      expect(tuyaSlots.map(({ slotId }) => slotId)).toEqual([
        "key-findings",
        "section-data-readiness",
        "section-consumption-and-demand",
        "section-meter-contribution-and-operations",
        "additional-insights",
      ]);
      expect(tuyaSlots.map(({ order }) => order)).toEqual([0, 10, 20, 30, 40]);
      expect(tuyaSlots.find(({ slotId }) => slotId === "additional-insights")).toMatchObject({
        skillId: "none",
        skillRevision: "not-applicable-v1",
        methodId: "energyiq-open-discovery",
        methodRevision: "1.0.0",
      });
      expect(metadata.energyIq.reportTimePolicies.get(TUYA_OFFICE_PROJECT_ID, "tuya-office-report-time@2")).toMatchObject({
        policy: {
          windows: [expect.objectContaining({
            windowId: "current-overview",
            strategy: { kind: "calendar_month_to_date" },
          })],
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rotates only the exact bootstrap-owned Tuya generic definition to the dedicated renderer", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-tuya-renderer-migration-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const policy = metadata.energyIq.reportTimePolicies.get(
        TUYA_OFFICE_PROJECT_ID,
        "tuya-office-report-time@2",
      )!;
      const legacyRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: TUYA_OFFICE_PROJECT_ID,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(TUYA_OFFICE_PROJECT_ID).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId: TUYA_OFFICE_PROJECT_ID,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-31T20:00:00.000Z",
      });
      metadata.energyIq.overviewDefinitions.attachMigrationRecord({
        project_id: TUYA_OFFICE_PROJECT_ID,
        template_revision_id: legacyRevision.revision_id,
        renderer_key: "energy-template-overview",
        definition: legacyTuyaOverviewDefinition(),
        report_time_policy: policy.policy,
      });

      ensureEnergyIqBootstrap(metadata);

      const migrated = metadata.energyIq.templates.getLatestProjectRevision(TUYA_OFFICE_PROJECT_ID)!;
      expect(migrated.revision_id).not.toBe(legacyRevision.revision_id);
      expect(metadata.energyIq.overviewDefinitions.get(legacyRevision.revision_id)).toMatchObject({
        renderer_key: "energy-template-overview",
        definition: { sections: expect.arrayContaining([expect.objectContaining({ key: "meter-data-health" })]) },
      });
      expect(metadata.energyIq.overviewDefinitions.get(migrated.revision_id)).toMatchObject({
        renderer_key: "tuya-office-overview",
        definition: {
          sections: expect.arrayContaining([
            expect.objectContaining({ key: "key-findings" }),
            expect.objectContaining({ key: "decision-lenses" }),
            expect.objectContaining({ key: "recommended-actions" }),
          ]),
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("publishes a new immutable Ngee Ann Template Revision when the managed Overview Definition changes", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-overview-definition-rotation-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const project = metadata.energyIq.getProject(projectId);
      metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: projectId,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-20T22:00:00.000Z",
      });
      ensureEnergyIqBootstrap(metadata);
      const current = metadata.energyIq.templates.getLatestProjectRevision(projectId)!;
      const currentDefinition = metadata.energyIq.overviewDefinitions.get(current.revision_id)!;
      expect(currentDefinition.definition.sections).toHaveLength(5);
      expect(currentDefinition.time_policy_revision_id).toBe("ngee-ann-report-time@2");
      const policy = metadata.energyIq.reportTimePolicies.get(
        projectId,
        currentDefinition.time_policy_revision_id,
      )!;
      const legacyRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: projectId,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-20T23:00:00.000Z",
      });
      metadata.energyIq.overviewDefinitions.attachMigrationRecord({
        project_id: projectId,
        template_revision_id: legacyRevision.revision_id,
        renderer_key: "ngee-ann-overview",
        definition: {
          ...currentDefinition.definition,
          sections: currentDefinition.definition.sections.map((section) => (
            section.key === "executive-summary"
              ? { ...section, title: "Legacy executive summary" }
              : section
          )),
        },
        report_time_policy: policy.policy,
      });

      ensureEnergyIqBootstrap(metadata);

      const migrated = metadata.energyIq.templates.getLatestProjectRevision(projectId)!;
      expect(migrated.revision_id).not.toBe(legacyRevision.revision_id);
      expect(metadata.energyIq.overviewDefinitions.get(legacyRevision.revision_id)?.definition.sections[0]?.title)
        .toBe("Legacy executive summary");
      expect(metadata.energyIq.overviewDefinitions.get(legacyRevision.revision_id)?.definition)
        .toEqual({
          ...currentDefinition.definition,
          sections: currentDefinition.definition.sections.map((section) => (
            section.key === "executive-summary"
              ? { ...section, title: "Legacy executive summary" }
              : section
          )),
        });
      expect(metadata.energyIq.overviewDefinitions.get(migrated.revision_id)).toMatchObject({
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "ngee-ann-report-time@2",
        definition: {
          sections: expect.arrayContaining([
            expect.objectContaining({ key: "executive-summary", title: "Management overview" }),
            expect.objectContaining({ key: "cost-and-trend", title: "Monthly context" }),
            expect.objectContaining({
              key: "school-holiday-comparison",
              primaryWindowId: "school-holiday-comparison",
            }),
          ]),
        },
      });

      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.templates.getLatestProjectRevision(projectId)?.revision_id)
        .toBe(migrated.revision_id);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

function legacyTuyaOverviewDefinition() {
  return {
    contractRevision: "energyiq-overview-definition@1" as const,
    timePolicyRevisionId: "tuya-office-report-time@2",
    sections: [
      legacyTuyaSection("meter-data-health", "Meter data health", "Which Meter Points can contribute trustworthy interval data?", [
        legacyTuyaBlock("tuya-data-coverage", "quality.data_coverage@1", "primary"),
      ]),
      legacyTuyaSection("energy-overview", "Energy overview", "How much electricity did the Office use in the current calendar month through the latest complete day?", [
        legacyTuyaBlock("tuya-consumption", "overview.consumption@1", "primary"),
      ]),
      legacyTuyaSection("space-and-distribution", "Space and distribution", "Which Spaces, Distribution Boards and Meter Points explain the use?", [
        legacyTuyaBlock("tuya-space-ranking", "comparison.child_scope_ranking@1"),
        legacyTuyaBlock("tuya-meter-breakdown", "composition.project_meter_breakdown@1"),
      ]),
      legacyTuyaSection("time-pattern", "Time pattern", "When does electricity use occur across the current calendar month?", [
        legacyTuyaBlock("tuya-operating-pattern", "time.operating_pattern@1"),
      ]),
    ],
  };
}

function legacyTuyaSection(key: string, title: string, managementQuestion: string, blocks: ReturnType<typeof legacyTuyaBlock>[]) {
  return { key, title, managementQuestion, primaryWindowId: "current-overview", supportingWindowIds: [], blocks };
}

function legacyTuyaBlock(key: string, capabilityRevisionId: string, emphasis: "primary" | "standard" = "standard") {
  return { key, capabilityRevisionId, windowId: "current-overview", emphasis };
}

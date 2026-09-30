import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID
} from "./energy-bootstrap.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyPublishedMeterRoute,
  resolveEnergyQueryContext,
  resolveEnergyScopeMeterNodeIds
} from "./energy-query-context.js";

describe("EnergyQueryContext", () => {
  it("resolves a server-authoritative Singapore reporting range and version pins", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const access = resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: "default"
      });
      expect(access.role).toBe("admin");
      expect(access.projects.map((project) => project.id)).toEqual(["ngee-ann-polytechnic"]);
      const preschoolAccess = resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: PRESCHOOL_WORKSPACE_ID
      });
      expect(preschoolAccess.projects.map((project) => project.id)).toEqual(["preschool-demo"]);

      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "level-7",
          resource: "electricity",
          period: "Last 7 days"
        },
        now: new Date("2026-07-31T06:00:00.000Z")
      });
      expect(context).toMatchObject({
        projectId: "ngee-ann-polytechnic",
        scopeId: "level-7",
        scopeType: "level",
        timezone: "Asia/Singapore",
        from: "2026-07-23T16:00:00.000Z",
        to: "2026-07-30T16:00:00.000Z",
        endExclusive: true,
        hierarchyRevisionId: "ngee-ann-hierarchy-v2",
        meterMappingRevisionId: expect.stringMatching(/^meter-routing-[a-f0-9]{24}$/),
        dataSnapshotId: "ngee-ann-4bac1177eca62cdb"
      });
      const levelRoute = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: "ngee-ann-polytechnic",
        hierarchyRevisionId: context.hierarchyRevisionId,
        scopeId: "level-7",
        resource: "electricity",
      });
      expect(levelRoute.officialMeterPointIds).toEqual([
        "mapping-lvl-7-total-office-light-17",
        "mapping-lvl-7-total-office-load-18",
      ]);
      expect(levelRoute.componentMeterPointIds).toEqual([
        "mapping-lvl-7-back-row-office-light-10",
        "mapping-lvl-7-front-row-office-light-11",
        "mapping-lvl-7-middle-row-office-light-12",
        "mapping-lvl-7-office-load-1-l1p1-l3p6-13",
        "mapping-lvl-7-office-load-2-l1p7-l3p15-14",
        "mapping-lvl-7-office-load-3-l1p16-l3p21-15",
        "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      ]);
      expect(levelRoute.componentMeterPointIds).not.toContain(
        "mapping-lvl-7-total-office-load-18",
      );
      expect(levelRoute.attachments.find((attachment) =>
        attachment.meterPointId === "mapping-lvl-7-total-office-load-18"))
        .toEqual({
          meterPointId: "mapping-lvl-7-total-office-load-18",
          scopeId: "l7-total-load",
          officialAggregation: true,
        });
      expect(() => resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: "ngee-ann-polytechnic",
        hierarchyRevisionId: context.hierarchyRevisionId,
        scopeId: "level-7",
        resource: "electricity",
        expectedMeterMappingRevisionId: "meter-routing-stale-release-pin",
      })).toThrow("ENERGYIQ_PUBLISHED_MAPPING_REVISION_MISMATCH");
      expect(resolveEnergyScopeMeterNodeIds(metadata, "ngee-ann-polytechnic", "level-7"))
        .toEqual([
          "level-7",
          "l7-total-light",
          "l7-total-load",
          "l7-front-light",
          "l7-middle-light",
          "l7-back-light",
          "l7-load-1",
          "l7-load-2",
          "l7-load-3",
          "l7-load-4"
        ]);
      expect(metadata.energyIq.listTierDefinitions("ngee-ann-polytechnic")).toMatchObject([
        { ordinal: 1, alias: "Circuit" },
        { ordinal: 2, alias: "Level" }
      ]);
      const ngeeAnnNodes = metadata.energyIq.listProjectNodes("ngee-ann-polytechnic");
      expect(ngeeAnnNodes.some((node) => node.id === "block-test")).toBe(false);
      expect(ngeeAnnNodes.find((node) => node.id === "level-6")).toMatchObject({
        parent_id: "project",
        tier_definition_id: "ngee-ann-tier-level"
      });
      const preschoolNodes = metadata.energyIq.listProjectNodes("preschool-demo");
      expect(preschoolNodes).toHaveLength(301);
      expect(preschoolNodes.filter((node) => node.parent_id === "preschool-project"))
        .toHaveLength(30);
      expect(resolveEnergyScopeMeterNodeIds(metadata, "preschool-demo", "preschool-centre-a"))
        .toHaveLength(10);
      expect(metadata.energyIq.getProject("preschool-demo").hierarchy_revision_id)
        .toBe("preschool-hierarchy-v4");
      expect(metadata.energyIq.listTierDefinitions("preschool-demo")).toMatchObject([
        { ordinal: 1, alias: "Circuit" },
        { ordinal: 2, alias: "Centre" }
      ]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("treats a custom end date as inclusive and rejects a scope from another project", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          period: "Custom",
          from: "2026-07-01",
          to: "2026-07-20"
        }
      });
      expect(context.from).toBe("2026-06-30T16:00:00.000Z");
      expect(context.to).toBe("2026-07-20T16:00:00.000Z");
      expect(() => resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "preschool-project",
          period: "Yesterday"
        }
      })).toThrow("ENERGYIQ_SCOPE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when the expected Snapshot differs from the current authorized Project Snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-snapshot-pin-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const currentSnapshotId = metadata.energyIq
        .getProject("ngee-ann-polytechnic").data_snapshot_id;
      const request = {
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity" as const,
        period: "Last 7 days" as const,
      };

      expect(resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          ...request,
          expectedDataSnapshotId: currentSnapshotId,
        },
      }).dataSnapshotId).toBe(currentSnapshotId);

      expect(() => resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          ...request,
          expectedDataSnapshotId: "snapshot-from-stale-overview",
        },
      })).toThrow("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");

      expect(() => resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          ...request,
          scopeId: "preschool-project",
          expectedDataSnapshotId: "snapshot-from-stale-overview",
        },
      })).toThrow("ENERGYIQ_SCOPE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.each([
    {
      name: "the fixed 2026-08-04 acceptance date",
      now: "2026-08-03T16:30:00.000Z",
      from: "2026-07-26T16:00:00.000Z",
      to: "2026-08-02T16:00:00.000Z",
    },
    {
      name: "a previous week crossing a month boundary",
      now: "2026-03-01T16:30:00.000Z",
      from: "2026-02-22T16:00:00.000Z",
      to: "2026-03-01T16:00:00.000Z",
    },
    {
      name: "a previous week crossing a year boundary",
      now: "2025-12-31T16:30:00.000Z",
      from: "2025-12-21T16:00:00.000Z",
      to: "2025-12-28T16:00:00.000Z",
    },
  ])("resolves Previous week in Singapore ISO calendar time for $name", ({ now, from, to }) => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-previous-week-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Previous week",
        },
        now: new Date(now),
      });

      expect(context).toMatchObject({
        period: "Previous week",
        timezone: "Asia/Singapore",
        from,
        to,
        endExclusive: true,
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.each([
    {
      name: "the current August date",
      now: "2026-08-03T16:30:00.000Z",
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
    },
    {
      name: "January crossing into the previous year",
      now: "2026-01-14T16:30:00.000Z",
      from: "2025-11-30T16:00:00.000Z",
      to: "2025-12-31T16:00:00.000Z",
    },
    {
      name: "March after leap-year February",
      now: "2024-03-14T16:30:00.000Z",
      from: "2024-01-31T16:00:00.000Z",
      to: "2024-02-29T16:00:00.000Z",
    },
  ])("resolves Previous month in Singapore local calendar time for $name", ({ now, from, to }) => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-previous-month-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          period: "Previous month",
        },
        now: new Date(now),
        env: {},
      });

      expect(context).toMatchObject({
        period: "Previous month",
        timezone: "Asia/Singapore",
        from,
        to,
        endExclusive: true,
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resolves Previous month at each New York local midnight across the spring DST transition", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-previous-month-dst-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("ngee-ann-polytechnic");
      metadata.energyIq.upsertProject({
        ...project,
        timezone: "America/New_York",
      });

      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Previous month",
        },
        now: new Date("2026-04-15T16:00:00.000Z"),
        env: {},
      });

      expect(context).toMatchObject({
        period: "Previous month",
        timezone: "America/New_York",
        from: "2026-03-01T05:00:00.000Z",
        to: "2026-04-01T04:00:00.000Z",
        endExclusive: true,
      });
      expect((Date.parse(context.to) - Date.parse(context.from)) / 3_600_000).toBe(743);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("pins Previous week range and resolvedAt to one instant across the Monday boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-previous-week-boundary-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const NativeDate = Date;
    const beforeBoundary = "2026-08-02T15:59:59.999Z";
    const afterBoundary = "2026-08-02T16:00:00.001Z";
    try {
      ensureEnergyIqBootstrap(metadata);
      const implicitInstants = [beforeBoundary, afterBoundary];
      vi.stubGlobal("Date", class extends NativeDate {
        constructor(value?: string | number) {
          super(value ?? implicitInstants.shift() ?? afterBoundary);
        }
      });

      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Previous week",
        },
      });

      expect(context).toMatchObject({
        from: "2026-07-19T16:00:00.000Z",
        to: "2026-07-26T16:00:00.000Z",
        resolvedAt: beforeBoundary,
      });
    } finally {
      vi.unstubAllGlobals();
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("pins Previous month range and resolvedAt to one instant across the month boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-previous-month-boundary-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const NativeDate = Date;
    const beforeBoundary = "2026-07-31T15:59:59.999Z";
    const afterBoundary = "2026-07-31T16:00:00.001Z";
    try {
      ensureEnergyIqBootstrap(metadata);
      const implicitInstants = [beforeBoundary, afterBoundary];
      vi.stubGlobal("Date", class extends NativeDate {
        constructor(value?: string | number) {
          super(value ?? implicitInstants.shift() ?? afterBoundary);
        }
      });

      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Previous month",
        },
      });

      expect(context).toMatchObject({
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        resolvedAt: beforeBoundary,
      });
    } finally {
      vi.unstubAllGlobals();
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resolves an edited attachment and rebuilt routes from the newly published Mapping revision", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-edited-route-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const meterPointId = "mapping-lvl-6-office-load-3-l1p13-l3p18-5";
      const draft = metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: "dev-user" });
      const hierarchyRevisionId = metadata.energyIq.getProject(projectId).hierarchy_revision_id;
      const publishedDocument = JSON.parse(metadata.energyIq.projectSetup
        .listHierarchyRevisions(projectId)
        .find((revision) => revision.id === hierarchyRevisionId)!.snapshot_json) as typeof draft.document;
      const mapping = publishedDocument.meter_mapping!;
      const rows = mapping.rows.map((row) => row.id === meterPointId ? {
        ...row,
        scope_id: "l7-load-1",
        navigation_scope_id: "l7-load-1",
        resource: "water" as const,
        category: "light" as const,
        meter_role: "total" as const,
        aggregation_usage: "official" as const,
      } : row);
      const officialRoutes = (mapping.official_aggregation_routes ?? [])
        .filter((route) => !route.meter_point_ids.includes(meterPointId));
      officialRoutes.push(
        { scope_id: "l7-load-1", resource: "water", category: "light", meter_point_ids: [meterPointId] },
        { scope_id: "level-7", resource: "water", category: "light", meter_point_ids: [meterPointId] },
        { scope_id: "project", resource: "water", category: "light", meter_point_ids: [meterPointId] },
      );
      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: projectId,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...publishedDocument,
          meter_mapping: { ...mapping, rows, official_aggregation_routes: officialRoutes, confirmed: true },
        },
      });
      const published = metadata.energyIq.projectSetup.publishDraft({
        project_id: projectId,
        expected_revision: saved.revision,
        user_id: "dev-user",
      });

      const route = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId,
        hierarchyRevisionId: published.hierarchy_revision_id,
        scopeId: "l7-load-1",
        resource: "water",
      });
      expect(route.officialMeterPointIds).toEqual([meterPointId]);
      expect(route.componentMeterPointIds).toEqual([]);
      expect(route.attachments).toEqual([{
        meterPointId,
        scopeId: "l7-load-1",
        officialAggregation: true,
      }]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("inherits published Project access from Organisation membership and rejects drafts or another Organisation", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "fm-user",
        email: "fm@example.com",
        display_name: "FM User",
        dev_token: "fm-token"
      });
      metadata.workspaces.upsert({
        id: "customer-two",
        owner_user_id: "fm-user",
        name: "Customer Two",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "customer-two",
        user_id: "fm-user",
        role: "owner"
      });
      metadata.energyIq.upsertProject({
        id: "customer-two-project",
        workspace_id: "customer-two",
        name: "Customer Two Published",
        status: "published"
      });
      metadata.energyIq.upsertProjectNode({
        id: "customer-two-root",
        project_id: "customer-two-project",
        name: "Customer Two Project",
        node_type: "project"
      });
      metadata.energyIq.upsertProject({
        id: "customer-two-draft",
        workspace_id: "customer-two",
        name: "Customer Two Draft",
        status: "draft"
      });
      const user = metadata.users.getById({ user_id: "fm-user" });
      const access = resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: "customer-two",
        env: {}
      });
      expect(access.role).toBe("user");
      expect(access.projects.map((project) => project.id)).toEqual(["customer-two-project"]);
      expect(() => resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "customer-two",
        request: {
          projectId: "customer-two-draft",
          period: "Yesterday"
        },
        env: {}
      })).toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      expect(() => resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: "default",
        env: {}
      })).toThrow("ENERGYIQ_WORKSPACE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("hides personal and disabled Organisations from users while admins retain repair access", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "multi-user",
        email: "multi@example.com",
        display_name: "Multi User",
        dev_token: "multi-token"
      });
      metadata.workspaces.createPersonal({
        id: "personal-multi-user",
        owner_user_id: "multi-user",
        name: "Personal"
      });
      metadata.workspaceMemberships.upsertOwner({
        workspace_id: "personal-multi-user",
        user_id: "multi-user"
      });
      metadata.workspaces.upsert({
        id: "disabled-customer",
        owner_user_id: "dev-user",
        name: "Disabled Customer",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "disabled-customer",
        user_id: "multi-user",
        role: "member"
      });
      metadata.workspaces.setCustomerDetails({
        id: "disabled-customer",
        name: "Disabled Customer",
        disabled: true
      });

      const userAccess = resolveEnergyAccessContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "multi-user" }),
        env: {}
      });
      expect(userAccess.workspaces).toEqual([]);
      expect(userAccess.activeWorkspaceId).toBe("");

      const adminAccess = resolveEnergyAccessContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        requestedWorkspaceId: "disabled-customer"
      });
      expect(adminAccess.workspaces.find((workspace) => workspace.id === "disabled-customer"))
        .toMatchObject({ disabled: true });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resolves allowlisted read access without persisting a role", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-read-only-role-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.db.prepare("DELETE FROM energyiq_user_roles WHERE user_id = ?").run("dev-user");
      const changesBefore = (metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value;

      const access = resolveEnergyAccessContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        requestedWorkspaceId: PRESCHOOL_WORKSPACE_ID,
        rolePersistence: "read-only",
      });

      expect(access.role).toBe("admin");
      expect(access.projects.map((project) => project.id)).toContain("preschool-demo");
      expect(metadata.energyIq.findUserRole("dev-user")).toBeUndefined();
      expect((metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value).toBe(changesBefore);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

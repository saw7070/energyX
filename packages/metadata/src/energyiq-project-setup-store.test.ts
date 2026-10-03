import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMetadataStore } from "./index.js";

import {
  createEnergyIqSourceManifest,
  energyIqPublishedMeterRoutingRevisionId,
  fingerprintEnergyIqMeterMapping,
  validateProjectSetupDocument,
  type EnergyIqMeterMappingDraft,
} from "./energyiq-project-setup-store.js";

describe("validateProjectSetupDocument sibling names", () => {
  it("changes the Mapping fingerprint and revision when attachment or route authority changes", () => {
    const mapping: EnergyIqMeterMappingDraft = {
      schema_version: 2,
      source_kind: "excel",
      confirmed: true,
      rows: [{
        id: "m1", source_label: "Meter 1", scope_id: "c1", navigation_scope_id: "c1",
        display_name: "Meter 1", resource: "electricity", category: "load", coverage: "whole",
        meter_role: "total", aggregation_usage: "official",
      }],
      official_aggregation_routes: [{
        scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m1"],
      }],
    };
    const attachmentChanged: EnergyIqMeterMappingDraft = {
      ...mapping,
      rows: [{ ...mapping.rows[0]!, navigation_scope_id: "c2" }],
    };
    const routeChanged: EnergyIqMeterMappingDraft = {
      ...mapping,
      official_aggregation_routes: [{
        scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["m1"],
      }],
    };

    expect(fingerprintEnergyIqMeterMapping(attachmentChanged)).not.toBe(fingerprintEnergyIqMeterMapping(mapping));
    expect(fingerprintEnergyIqMeterMapping(routeChanged)).not.toBe(fingerprintEnergyIqMeterMapping(mapping));
    expect(energyIqPublishedMeterRoutingRevisionId(mapping)).toMatch(/^meter-routing-[a-f0-9]{24}$/);
    expect(energyIqPublishedMeterRoutingRevisionId(routeChanged)).not.toBe(energyIqPublishedMeterRoutingRevisionId(mapping));
    const relabelled = { ...mapping, rows: [{ ...mapping.rows[0]!, presentation: {
      device_name: "Office TV", circuit_name: "L1P17", group: "AV / TV",
    } }] };
    expect(fingerprintEnergyIqMeterMapping(relabelled)).toBe(fingerprintEnergyIqMeterMapping(mapping));
    expect(energyIqPublishedMeterRoutingRevisionId(relabelled)).toBe(energyIqPublishedMeterRoutingRevisionId(mapping));
  });

  it("refuses to publish a location with no meter anywhere beneath it", () => {
    // A published location without an official meter route makes every chart and report fail to load.
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "board", ordinal: 1, alias: "Board" }, { id: "space", ordinal: 2, alias: "Space" }],
      nodes: [
        { id: "s1", tier_definition_id: "space", name: "Space 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "db1", tier_definition_id: "board", parent_id: "s1", name: "DB1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "s2", tier_definition_id: "space", name: "Boss Room", sort_order: 2, metadata_status: "confirmed" as const },
      ],
      meter_mapping: { schema_version: 2 as const, source_kind: "tuya" as const, confirmed: true,
        rows: [{ id: "m1", source_label: "DB1 L1", display_name: "DB1 L1", scope_id: "db1", resource: "electricity" as const, category: "load" as const, coverage: "partial" as const, meter_role: "total" as const, aggregation_usage: "official" as const }],
        official_aggregation_routes: [{ scope_id: "db1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] }] },
    };

    const blocked = validateProjectSetupDocument(document);
    expect(blocked.blocking).toBe(true);
    expect(blocked.issues.filter(issue => issue.code === "LOCATION_WITHOUT_METER").map(issue => issue.message)).toEqual(["Boss Room has no meter. Move a meter here or remove the location."]);

    // A location counts as measured when a meter sits anywhere beneath it, and removing the empty one clears the block.
    const fixed = { ...document, nodes: document.nodes.filter(node => node.id !== "s2") };
    expect(validateProjectSetupDocument(fixed).issues.some(issue => issue.code === "LOCATION_WITHOUT_METER")).toBe(false);
  });

  it("blocks normalised duplicates under one parent but allows the same name under another parent", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "room", ordinal: 1, alias: "Room" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "l2", tier_definition_id: "level", name: "Level 2", sort_order: 2, metadata_status: "confirmed" },
        { id: "r1", tier_definition_id: "room", parent_id: "l1", name: "Room 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "r2", tier_definition_id: "room", parent_id: "l1", name: " ROOM   1 ", sort_order: 2, metadata_status: "confirmed" },
        { id: "r3", tier_definition_id: "room", parent_id: "l2", name: "Room 1", sort_order: 1, metadata_status: "confirmed" },
      ],
    });

    expect(validation.issues.filter((issue) => issue.code === "SIBLING_NAME_DUPLICATE")).toHaveLength(1);
  });

  it("requires the Tier Structure draft checkpoint before hierarchy validation", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: false,
      tiers: [{ id: "level", ordinal: 1, alias: "Level" }],
      nodes: [{
        id: "l1",
        tier_definition_id: "level",
        name: "Level 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
    });

    expect(validation.issues.some((issue) => issue.code === "TIER_STRUCTURE_NOT_LOCKED")).toBe(true);
  });

  it("blocks Meter Mapping rows that target a Scope missing from Structure", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "level", ordinal: 1, alias: "Level" }],
      nodes: [{
        id: "l1",
        tier_definition_id: "level",
        name: "Level 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: false,
        rows: [{
          id: "mapping-1",
          source_label: "Office Load 1",
          scope_id: "missing-room",
          display_name: "Office Load 1",
          resource: "electricity",
          category: "load",
          coverage: "whole",
          meter_role: "total",
          aggregation_usage: "official",
        }],
      },
    });

    expect(validation.issues.some((issue) => issue.code === "METER_SCOPE_NOT_FOUND")).toBe(true);
    expect(validation.blocking).toBe(true);
  });

  it("allows one official direct total but blocks two for the same aggregation route", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "level", ordinal: 1, alias: "Level" }],
      nodes: [{
        id: "l1",
        tier_definition_id: "level",
        name: "Level 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [
          {
            id: "mapping-1",
            source_label: "Total Office Load A",
            scope_id: "l1",
            display_name: "Total Office Load A",
            resource: "electricity",
            category: "load",
            coverage: "whole",
            meter_role: "total",
            aggregation_usage: "official",
          },
          {
            id: "mapping-2",
            source_label: "Total Office Load B",
            scope_id: "l1",
            display_name: "Total Office Load B",
            resource: "electricity",
            category: "load",
            coverage: "whole",
            meter_role: "total",
            aggregation_usage: "official",
          },
        ],
      },
    });

    expect(validation.issues.filter((issue) => issue.code === "MULTIPLE_DIRECT_TOTALS")).toHaveLength(1);
    expect(validation.blocking).toBe(true);
  });

  it("accepts a standalone Virtual Meter with two valid physical inputs", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "c1", tier_definition_id: "circuit", parent_id: "l1", name: "Load 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "c2", tier_definition_id: "circuit", parent_id: "l1", name: "Load 2", sort_order: 2, metadata_status: "confirmed" },
      ],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [
          { id: "m1", source_label: "Load 1", scope_id: "c1", display_name: "Load 1", resource: "electricity", category: "load", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
          { id: "m2", source_label: "Load 2", scope_id: "c2", display_name: "Load 2", resource: "electricity", category: "load", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
        ],
        official_aggregation_routes: [
          { scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m1"] },
          { scope_id: "c2", resource: "electricity", category: "load", meter_point_ids: ["m2"] },
          { scope_id: "l1", resource: "electricity", category: "load", meter_point_ids: ["m1", "m2"] },
          { scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["m1", "m2"] },
        ],
        virtual_meters: [{
          id: "vm-load-12",
          display_name: "Load 12",
          scope_id: "l1",
          resource: "electricity",
          category: "load",
          terms: [
            { mapping_row_id: "m1", coefficient: 1 },
            { mapping_row_id: "m2", coefficient: 1 },
          ],
        }],
      },
    });

    expect(validation.issues.some((issue) => issue.code.startsWith("VIRTUAL_METER"))).toBe(false);
    expect(validation.blocking).toBe(false);
  });

  it.each([
    {
      name: "missing",
      routes: undefined,
      code: "OFFICIAL_ROUTES_REQUIRED",
    },
    {
      name: "duplicate",
      routes: [
        { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
        { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
      ],
      code: "OFFICIAL_ROUTE_DUPLICATE",
    },
    {
      name: "dangling",
      routes: [
        { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["missing"] },
      ],
      code: "OFFICIAL_ROUTE_METER_INVALID",
    },
    {
      name: "cross-resource",
      routes: [
        { scope_id: "c1", resource: "water" as const, category: "load" as const, meter_point_ids: ["m1"] },
      ],
      code: "OFFICIAL_ROUTE_RESOURCE_MISMATCH",
    },
  ])("fails closed for $name published Meter routes", ({ routes, code }) => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
      nodes: [{
        id: "c1",
        tier_definition_id: "circuit",
        name: "Load 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [{
          id: "m1",
          source_label: "Load 1",
          scope_id: "c1",
          navigation_scope_id: "c1",
          display_name: "Load 1",
          resource: "electricity",
          category: "load",
          coverage: "whole",
          meter_role: "total",
          aggregation_usage: "official",
        }],
        ...(routes ? { official_aggregation_routes: routes } : {}),
      },
    });

    expect(validation.issues.some((issue) => issue.code === code)).toBe(true);
    expect(validation.blocking).toBe(true);
  });

  it("accepts component-only ancestor and Project routes when no designated total exists", () => {
    const validation = validateProjectSetupDocument(componentRouteDocument([
      { scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m1"] },
      { scope_id: "c2", resource: "electricity", category: "load", meter_point_ids: ["m2"] },
      { scope_id: "l1", resource: "electricity", category: "load", meter_point_ids: ["m1", "m2"] },
      { scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["m1", "m2"] },
    ]));

    expect(validation.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(validation.blocking).toBe(false);
  });

  it("allows an excluded physical submeter to remain a direct Meter Point without entering the DB official route", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Office", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "db", ordinal: 1, alias: "Distribution Board" }],
      nodes: [{
        id: "db1",
        tier_definition_id: "db",
        name: "DB1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "tuya",
        confirmed: true,
        rows: [
          { id: "total", source_label: "DB1 Power", scope_id: "db1", navigation_scope_id: "db1", display_name: "DB1 Power", resource: "electricity", category: "load", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
          { id: "tv", source_label: "Meeting TV", scope_id: "db1", navigation_scope_id: "db1", display_name: "Meeting TV", resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "excluded" },
        ],
        official_aggregation_routes: [
          { scope_id: "db1", resource: "electricity", category: "load", meter_point_ids: ["total"] },
          { scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["total"] },
        ],
      },
    });

    expect(validation.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(validation.blocking).toBe(false);
  });

  it.each([
    ["ancestor", [
      { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
      { scope_id: "c2", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m2"] },
      { scope_id: "project", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1", "m2"] },
    ]],
    ["Project", [
      { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
      { scope_id: "c2", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m2"] },
      { scope_id: "l1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1", "m2"] },
    ]],
  ])("blocks a confirmed Mapping with a missing %s route", (_name, routes) => {
    const validation = validateProjectSetupDocument(componentRouteDocument(routes));
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "OFFICIAL_ROUTE_SCOPE_RESOURCE_REQUIRED",
      severity: "error",
    }));
    expect(validation.blocking).toBe(true);
  });

  it("blocks overall and category routes for the same Scope and resource", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
      nodes: [{
        id: "c1", tier_definition_id: "circuit", name: "Circuit 1", sort_order: 1,
        metadata_status: "confirmed", independent_reason: "Separate load categories",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [
          { id: "m-overall", source_label: "Overall", scope_id: "c1", navigation_scope_id: "c1", display_name: "Overall", resource: "electricity", category: "overall", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
          { id: "m-load", source_label: "Load", scope_id: "c1", navigation_scope_id: "c1", display_name: "Load", resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
        ],
        official_aggregation_routes: [
          { scope_id: "c1", resource: "electricity", category: "overall", meter_point_ids: ["m-overall"] },
          { scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m-load"] },
          { scope_id: "project", resource: "electricity", category: "overall", meter_point_ids: ["m-overall"] },
        ],
      },
    });

    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "OFFICIAL_ROUTE_OVERALL_CONFLICT",
      severity: "error",
    }));
  });

  it("keeps the IT, kitchen and plug types of use through saveDraft", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-category-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-category", owner_user_id: "dev-user", name: "Category Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-category", workspace_id: "workspace-category", name: "Category Project", status: "draft" });
      const initial = metadata.energyIq.projectSetup.getDraft({ project_id: "project-category", user_id: "dev-user" });
      const base = componentRouteDocument([
        { scope_id: "c1", resource: "electricity", category: "it", meter_point_ids: ["m1"] },
        { scope_id: "c2", resource: "electricity", category: "kitchen", meter_point_ids: ["m2"] },
        { scope_id: "l1", resource: "electricity", category: "it", meter_point_ids: ["m1"] },
        { scope_id: "l1", resource: "electricity", category: "kitchen", meter_point_ids: ["m2"] },
        { scope_id: "project", resource: "electricity", category: "it", meter_point_ids: ["m1"] },
        { scope_id: "project", resource: "electricity", category: "kitchen", meter_point_ids: ["m2"] },
      ]);
      const [first, second] = base.meter_mapping.rows;
      const document = { ...base, meter_mapping: { ...base.meter_mapping, rows: [{ ...first!, category: "it" as const }, { ...second!, category: "kitchen" as const }] } };
      expect(validateProjectSetupDocument(document).blocking).toBe(false);

      const saved = metadata.energyIq.projectSetup.saveDraft({ project_id: "project-category", expected_revision: initial.revision, user_id: "dev-user", document });
      expect(saved.document.meter_mapping?.rows.map((row) => row.category)).toEqual(["it", "kitchen"]);
      const plugged = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-category", expected_revision: saved.revision, user_id: "dev-user",
        document: { ...document, meter_mapping: { ...document.meter_mapping, virtual_meters: [{ id: "vm", display_name: "Sockets", scope_id: "l1", resource: "electricity", category: "plug", terms: [{ mapping_row_id: "m1", coefficient: 1 }] }] } },
      });
      expect(plugged.document.meter_mapping?.virtual_meters?.[0]?.category).toBe("plug");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("preserves duplicate route members through saveDraft and blocks publication", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-route-duplicate-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-route", owner_user_id: "dev-user", name: "Route Workspace", kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-route", workspace_id: "workspace-route", name: "Route Project", status: "draft",
      });
      const initial = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-route", user_id: "dev-user",
      });
      const duplicate = componentRouteDocument([
        { scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m1", "m1"] },
        { scope_id: "c2", resource: "electricity", category: "load", meter_point_ids: ["m2"] },
        { scope_id: "l1", resource: "electricity", category: "load", meter_point_ids: ["m1", "m2"] },
        { scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["m1", "m2"] },
      ]);
      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-route",
        expected_revision: initial.revision,
        user_id: "dev-user",
        document: { ...duplicate, meter_mapping: { ...duplicate.meter_mapping!, rows: duplicate.meter_mapping!.rows.map(row => ({...row, presentation: {device_name: " Office TV ", circuit_name: " L1P17 ", group: " AV / TV ", not_in_use: " Nobody uses it "}})) } },
      });

      expect(saved.document.meter_mapping?.official_aggregation_routes?.[0]?.meter_point_ids)
        .toEqual(["m1", "m1"]);
      expect(saved.document.meter_mapping?.rows[0]?.presentation).toEqual({device_name:"Office TV",circuit_name:"L1P17",group:"AV / TV",not_in_use:"Nobody uses it"});
      expect(metadata.energyIq.projectSetup.validateDraft("project-route").issues)
        .toContainEqual(expect.objectContaining({ code: "OFFICIAL_ROUTE_METER_DUPLICATE" }));
      expect(() => metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-route",
        expected_revision: saved.revision,
        user_id: "dev-user",
      })).toThrow("ENERGYIQ_SETUP_INVALID:OFFICIAL_ROUTE_METER_DUPLICATE");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("builds the first Draft from the latest immutable hierarchy snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-draft-from-snapshot-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-snapshot", owner_user_id: "dev-user", name: "Snapshot Workspace", kind: "customer",
      });
      const sourceManifest = createEnergyIqSourceManifest(["a".repeat(64)], true);
      const document = {
        ...componentRouteDocument([
          { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
          { scope_id: "c2", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m2"] },
          { scope_id: "l1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1", "m2"] },
          { scope_id: "project", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1", "m2"] },
        ]),
        source_manifest: sourceManifest,
      };
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "project-snapshot",
          workspace_id: "workspace-snapshot",
          name: "Snapshot Project",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "project-snapshot-hierarchy-v1",
          meter_formula_revision_id: "meter-formula-v1",
          root_scope_id: "project",
        },
        document,
        published_by: "dev-user",
      });

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-snapshot",
        user_id: "dev-user",
      });

      expect(draft.based_on_hierarchy_revision_id).toBe("project-snapshot-hierarchy-v1");
      expect(draft.document.source_manifest).toEqual(sourceManifest);
      expect(draft.document.meter_mapping).toEqual(document.meter_mapping);
      expect(draft.document.meter_mapping?.official_aggregation_routes).toEqual(
        document.meter_mapping.official_aggregation_routes,
      );
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const componentRouteDocument = (
  routes: NonNullable<EnergyIqMeterMappingDraft["official_aggregation_routes"]>,
) => ({
  project: { name: "Test", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [
    { id: "circuit", ordinal: 1, alias: "Circuit" },
    { id: "level", ordinal: 2, alias: "Level" },
  ],
  nodes: [
    { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" as const },
    { id: "c1", tier_definition_id: "circuit", parent_id: "l1", name: "Load 1", sort_order: 1, metadata_status: "confirmed" as const },
    { id: "c2", tier_definition_id: "circuit", parent_id: "l1", name: "Load 2", sort_order: 2, metadata_status: "confirmed" as const },
  ],
  meter_mapping: {
    schema_version: 2 as const,
    source_kind: "excel" as const,
    confirmed: true,
    rows: [
      { id: "m1", source_label: "Load 1", scope_id: "c1", navigation_scope_id: "c1", display_name: "Load 1", resource: "electricity" as const, category: "load" as const, coverage: "partial" as const, meter_role: "component" as const, aggregation_usage: "official" as const },
      { id: "m2", source_label: "Load 2", scope_id: "c2", navigation_scope_id: "c2", display_name: "Load 2", resource: "electricity" as const, category: "load" as const, coverage: "partial" as const, meter_role: "component" as const, aggregation_usage: "official" as const },
    ],
    official_aggregation_routes: routes,
  },
});

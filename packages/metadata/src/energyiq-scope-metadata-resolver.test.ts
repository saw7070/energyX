import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqScopeMetadataResolver", () => {
  it("coalesces an equivalent republish while keeping old and new Releases isolated", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-publish-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Workspace 1",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Project 1",
        status: "draft",
        root_scope_id: "project-1-root",
      });
      const initial = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-1",
        user_id: "dev-user",
      });
      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-1",
        expected_revision: initial.revision,
        user_id: "dev-user",
        document: {
          project: { name: "Project 1", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "tier-level", ordinal: 1, alias: "Level" }],
          nodes: [{
            id: "scope-1",
            tier_definition_id: "tier-level",
            name: "Level 1",
            sort_order: 1,
            area_sqm: 100,
            occupant_count: 10,
            metadata_status: "confirmed",
            independent_reason: "Independent comparison Scope",
          }],
        },
      });
      const releaseV1 = metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-1",
        expected_revision: saved.revision,
        user_id: "dev-user",
      });
      const unchanged = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-1",
        user_id: "dev-user",
      });
      const releaseV2 = metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-1",
        expected_revision: unchanged.revision,
        user_id: "dev-user",
      });

      const period = {
        start: "2026-07-01T16:00:00.000Z",
        endExclusive: "2026-07-08T16:00:00.000Z",
      };
      const pinnedV1 = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: releaseV1.hierarchy_revision_id,
        period,
      });
      const pinnedV2 = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: releaseV2.hierarchy_revision_id,
        period,
      });

      expect(pinnedV1).toMatchObject({
        hierarchyRevisionId: "project-1-hierarchy-v1",
        timezone: "Asia/Singapore",
        area: {
          status: "confirmed",
          value: 100,
          metadataRevisionIds: ["project-1-hierarchy-v1:scope-1"],
        },
      });
      expect(pinnedV2).toMatchObject({
        hierarchyRevisionId: "project-1-hierarchy-v2",
        timezone: "Asia/Singapore",
        area: {
          status: "confirmed",
          value: 100,
          metadataRevisionIds: ["project-1-hierarchy-v2:scope-1"],
        },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("uses the metadata revision effective during the historical analysis Period", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [
        {
          id: "project-1-hierarchy-v1:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v1",
          areaSqm: 100,
          occupantCount: 10,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-07-15",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-1-hierarchy-v2:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v2",
          areaSqm: 120,
          occupantCount: 12,
          metadataStatus: "provisional",
          effectiveFrom: "2026-07-15",
          effectiveTo: null,
          createdAt: "2026-07-14T16:00:00.000Z",
        },
      ]);

      const historical = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v2",
        period: {
          start: "2026-06-30T16:00:00.000Z",
          endExclusive: "2026-07-09T16:00:00.000Z",
        },
      });
      const normalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: historical,
      });

      expect(historical.area).toMatchObject({
        status: "confirmed",
        value: 100,
        metadataRevisionIds: ["project-1-hierarchy-v1:scope-1"],
        hierarchyRevisionIds: ["project-1-hierarchy-v1"],
      });
      expect(historical.headcount).toMatchObject({ status: "confirmed", value: 10 });
      expect(normalised.eui).toMatchObject({
        status: "confirmed",
        metricId: "energy.usage_per_sqm",
        value: 10,
        unit: "kWh/m2",
        metadataRevisionIds: ["project-1-hierarchy-v1:scope-1"],
      });
      expect(normalised.perPax).toMatchObject({
        status: "confirmed",
        metricId: "energy.usage_per_person",
        value: 100,
        unit: "kWh/person",
      });

      const current = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v2",
        period: {
          start: "2026-07-14T16:00:00.000Z",
          endExclusive: "2026-07-20T16:00:00.000Z",
        },
      });
      const currentNormalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: current,
      });
      expect(current.area).toMatchObject({
        status: "provisional",
        value: 120,
        metadataRevisionIds: ["project-1-hierarchy-v2:scope-1"],
      });
      expect(currentNormalised.eui).toMatchObject({
        status: "provisional",
        metadataRevisionIds: ["project-1-hierarchy-v2:scope-1"],
      });
      expect(currentNormalised.eui.value).toBeCloseTo(8.333333, 5);
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not calculate a normalised metric when its metadata value changes inside the Period", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [
        {
          id: "project-1-hierarchy-v1:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v1",
          areaSqm: 100,
          occupantCount: 10,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-07-15",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-1-hierarchy-v2:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v2",
          areaSqm: 120,
          occupantCount: 12,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-07-15",
          effectiveTo: null,
          createdAt: "2026-07-14T16:00:00.000Z",
        },
      ]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v2",
        period: {
          start: "2026-07-09T16:00:00.000Z",
          endExclusive: "2026-07-19T16:00:00.000Z",
        },
      });
      const normalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: resolution,
      });

      expect(resolution.area).toMatchObject({
        status: "missing",
        reason: "value-changes-within-period",
        metadataRevisionIds: [
          "project-1-hierarchy-v1:scope-1",
          "project-1-hierarchy-v2:scope-1",
        ],
        evidence: [
          { dimension: "area", value: 100, timezone: "Asia/Singapore" },
          { dimension: "area", value: 120, timezone: "Asia/Singapore" },
        ],
      });
      expect(normalised.eui).toMatchObject({
        status: "missing",
        value: null,
        reason: "value-changes-within-period",
      });
      expect(normalised.eui.status === "missing" ? normalised.eui.guidance : "")
        .toContain("split the analysis at the effective-date boundary");
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns metric-specific Admin guidance when Area and Headcount are missing or invalid", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: null,
        occupantCount: 0,
        metadataStatus: "confirmed",
        effectiveFrom: null,
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-07-01T16:00:00.000Z",
          endExclusive: "2026-07-08T16:00:00.000Z",
        },
      });
      const normalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: resolution,
      });

      expect(resolution.area).toMatchObject({ status: "missing", reason: "not-configured" });
      expect(resolution.headcount).toMatchObject({ status: "missing", reason: "invalid-value" });
      expect(normalised.eui).toMatchObject({
        status: "missing",
        value: null,
        reason: "not-configured",
      });
      expect(normalised.perPax).toMatchObject({
        status: "missing",
        value: null,
        reason: "invalid-value",
      });
      expect(normalised.eui.status === "missing" ? normalised.eui.guidance : "")
        .toContain("Add comparison area (m2) for Scope scope-1 in Admin > Projects > Structure");
      expect(normalised.perPax.status === "missing" ? normalised.perPax.guidance : "")
        .toContain("Set 24-hour representative headcount to a value greater than zero");
      expect(JSON.stringify(normalised)).not.toContain("No data");
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when effective metadata revisions overlap", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [
        {
          id: "project-1-hierarchy-v1:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v1",
          areaSqm: 100,
          occupantCount: 10,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-1-hierarchy-v2:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v2",
          areaSqm: 120,
          occupantCount: 12,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-06-01",
          effectiveTo: null,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v2",
        period: {
          start: "2026-07-01T16:00:00.000Z",
          endExclusive: "2026-07-08T16:00:00.000Z",
        },
      });

      expect(resolution.area).toMatchObject({
        status: "missing",
        reason: "ambiguous-effective-revisions",
        metadataRevisionIds: [
          "project-1-hierarchy-v1:scope-1",
          "project-1-hierarchy-v2:scope-1",
        ],
        evidence: [
          { dimension: "area", value: 100, timezone: "Asia/Singapore" },
          { dimension: "area", value: 120, timezone: "Asia/Singapore" },
        ],
      });
      expect(resolution.area.status === "missing" ? resolution.area.guidance : "")
        .toContain("Resolve overlapping Area effective dates");
      const pinnedV1 = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-07-01T16:00:00.000Z",
          endExclusive: "2026-07-08T16:00:00.000Z",
        },
      });
      expect(pinnedV1.area).toMatchObject({
        status: "confirmed",
        value: 100,
        metadataRevisionIds: ["project-1-hierarchy-v1:scope-1"],
      });
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an impossible effective calendar date instead of normalising it", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-date-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: 100,
        occupantCount: 10,
        metadataStatus: "confirmed",
        effectiveFrom: "2026-02-30",
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }]);

      expect(() => metadata!.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-02-28T16:00:00.000Z",
          endExclusive: "2026-03-02T16:00:00.000Z",
        },
      })).toThrow("ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects an impossible effective timestamp instead of normalising it", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-timestamp-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: 100,
        occupantCount: 10,
        metadataStatus: "confirmed",
        effectiveFrom: "2026-02-30T00:00:00Z",
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }]);

      expect(() => metadata!.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-02-28T16:00:00.000Z",
          endExclusive: "2026-03-02T16:00:00.000Z",
        },
      })).toThrow("ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects a Period timestamp without an explicit offset", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-offset-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: 100,
        occupantCount: 10,
        metadataStatus: "confirmed",
        effectiveFrom: null,
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }]);

      expect(() => metadata!.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-07-01T16:00:00",
          endExclusive: "2026-07-08T16:00:00.000Z",
        },
      })).toThrow("ENERGYIQ_METADATA_PERIOD_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("accepts ISO instants with Z and numeric offsets", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-valid-offset-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: 100,
        occupantCount: 10,
        metadataStatus: "confirmed",
        effectiveFrom: "2026-07-01T00:00:00+08:00",
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-06-30T16:00:00.000Z",
          endExclusive: "2026-07-09T00:00:00+08:00",
        },
      });

      expect(resolution.area).toMatchObject({ status: "confirmed", value: 100 });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects a non-increasing effective range after timezone conversion", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-range-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: 100,
        occupantCount: 10,
        metadataStatus: "confirmed",
        effectiveFrom: "2026-03-08T05:00:00.000Z",
        effectiveTo: "2026-03-08",
        createdAt: "2026-01-01T00:00:00.000Z",
      }], "America/New_York");

      expect(() => metadata!.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        period: {
          start: "2026-03-08T05:00:00.000Z",
          endExclusive: "2026-03-09T04:00:00.000Z",
        },
      })).toThrow("ENERGYIQ_METADATA_EFFECTIVE_RANGE_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("uses the pinned Release timezone across a DST date boundary and rejects a mismatched expectation", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-dst-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: 100,
        occupantCount: 10,
        metadataStatus: "confirmed",
        effectiveFrom: "2026-03-08",
        effectiveTo: "2026-03-09",
        createdAt: "2026-01-01T00:00:00.000Z",
      }], "America/New_York");

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        expectedTimezone: "America/New_York",
        period: {
          start: "2026-03-08T05:00:00.000Z",
          endExclusive: "2026-03-09T04:00:00.000Z",
        },
      });
      expect(resolution).toMatchObject({
        timezone: "America/New_York",
        area: {
          status: "confirmed",
          value: 100,
          evidence: [{ timezone: "America/New_York", effectiveFrom: "2026-03-08", effectiveTo: "2026-03-09" }],
        },
      });
      expect(() => metadata!.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        expectedTimezone: "UTC",
        period: {
          start: "2026-03-08T05:00:00.000Z",
          endExclusive: "2026-03-09T04:00:00.000Z",
        },
      })).toThrow("ENERGYIQ_METADATA_TIMEZONE_MISMATCH");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

type TestMetadata = ReturnType<typeof createMetadataStore>;

type SeedRevision = {
  id: string;
  hierarchyRevisionId: string;
  areaSqm: number | null;
  occupantCount: number | null;
  metadataStatus: "confirmed" | "provisional";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
};

const seedProject = (
  metadata: TestMetadata,
  revisions: SeedRevision[],
  timezone = "Asia/Singapore",
): void => {
  metadata.workspaces.upsert({
    id: "workspace-1",
    owner_user_id: "dev-user",
    name: "Workspace 1",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "project-1",
    workspace_id: "workspace-1",
    name: "Project 1",
    status: "published",
    timezone: "Asia/Singapore",
    hierarchy_revision_id: revisions.at(-1)?.hierarchyRevisionId ?? "project-1-hierarchy-v1",
    meter_formula_revision_id: "meter-formula-v1",
    data_snapshot_id: "snapshot-1",
    metric_version: "energy-metrics-v1",
    business_calendar_version: "calendar-v1",
    tariff_schedule_version: "tariff-v1",
    root_scope_id: "project-1-root",
  });
  for (const [index, revision] of revisions.entries()) {
    metadata.db.prepare(`
      INSERT INTO energyiq_hierarchy_revisions (
        id, project_id, sequence, snapshot_json, validation_json, published_by, published_at
      ) VALUES (?, 'project-1', ?, ?, '{}', 'dev-user', ?)
    `).run(
      revision.hierarchyRevisionId,
      index + 1,
      JSON.stringify({
        project: { name: "Project 1", timezone },
        nodes: [{ id: "scope-1" }],
      }),
      revision.createdAt,
    );
    metadata.db.prepare(`
      INSERT INTO energyiq_node_metadata_revisions (
        id, project_id, node_id, hierarchy_revision_id, area_sqm, occupant_count,
        metadata_status, effective_from, effective_to, metadata_json, created_at
      ) VALUES (?, 'project-1', 'scope-1', ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      revision.id,
      revision.hierarchyRevisionId,
      revision.areaSqm,
      revision.occupantCount,
      revision.metadataStatus,
      revision.effectiveFrom,
      revision.effectiveTo,
      revision.createdAt,
    );
  }
};

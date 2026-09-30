import { createMetadataStore, type EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import {
  createEnergyIqAnalysisSemantics,
  resolveEnergyIqPublishedScopeDimensions,
} from "./energy-analysis-workspace.js";

describe("EnergyIQ Analysis Workspace", () => {
  it("keeps a Ngee Ann Level workspace inside its published subtree", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-workspace-ngee-ann-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("ngee-ann-polytechnic");
      const levelSeven = resolveEnergyIqPublishedScopeDimensions({
        metadataStore: metadata,
        workspaceId: project.workspace_id,
        projectId: project.id,
        scopeId: "level-7",
        hierarchyRevisionId: project.hierarchy_revision_id,
      });

      expect(levelSeven).toEqual(expect.arrayContaining([
        expect.objectContaining({ scopeId: "level-7", scopeType: "level" }),
        expect.objectContaining({ scopeId: "l7-total-light", scopeType: "circuit" }),
      ]));
      expect(levelSeven.some((dimension) => dimension.scopeId === "level-6")).toBe(false);
      expect(levelSeven.some((dimension) => dimension.scopeId.startsWith("l6-"))).toBe(false);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes the pinned Preschool Centre cohorts without leaking sibling scopes", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-workspace-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const portfolio = resolveEnergyIqPublishedScopeDimensions({
        metadataStore: metadata,
        workspaceId: project.workspace_id,
        projectId: project.id,
        scopeId: project.root_scope_id,
        hierarchyRevisionId: project.hierarchy_revision_id,
      });

      const centreDimensions = portfolio.filter((dimension) => dimension.scopeType === "centre");
      expect(centreDimensions).toHaveLength(30);
      expect(countBy(centreDimensions, (dimension) => dimension.facilityType)).toEqual({
        "Active Aging Center": 8,
        Preschool: 8,
        "Senior Care Center": 14,
      });
      expect(createEnergyIqAnalysisSemantics({
        projectId: project.id,
        factsRelation: "energy_scope_preschool",
        scopeMetadataRelation: "energy_scope_preschool_metadata",
        scopeDimensions: portfolio,
      })).toMatchObject({
        contract: "energyiq-analysis-semantics@1",
        relations: {
          facts: { relation: "energy_scope_preschool", usageColumn: "usage_kwh" },
          scopeMetadata: {
            relation: "energy_scope_preschool_metadata",
            publishedFacilityTypes: [
              "Active Aging Center",
              "Preschool",
              "Senior Care Center",
            ],
          },
        },
        measureAuthorities: [
          { id: "energy.usage_kwh", authority: "queryable", source: "facts" },
          { id: "metadata.centre_count", authority: "queryable", source: "scope-metadata" },
          {
            id: "preschool.benchmark.eui",
            authority: "deterministic-evidence",
            source: "project-analysis-snapshot",
          },
          {
            id: "preschool.benchmark.per_pax",
            authority: "deterministic-evidence",
            source: "project-analysis-snapshot",
          },
        ],
      });
      expect(centreDimensions.every((dimension) =>
        dimension.hierarchyRevisionId === project.hierarchy_revision_id)).toBe(true);

      const hierarchy = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((revision) => revision.id === project.hierarchy_revision_id);
      if (!hierarchy) throw new Error("Expected published Preschool hierarchy");
      const document = JSON.parse(hierarchy.snapshot_json) as EnergyIqProjectSetupDocument;
      const centreB = document.nodes.find((node) => node.metadata?.centreCode === "B");
      if (!centreB) throw new Error("Expected Centre B");
      const centreScope = resolveEnergyIqPublishedScopeDimensions({
        metadataStore: metadata,
        workspaceId: project.workspace_id,
        projectId: project.id,
        scopeId: centreB.id,
        hierarchyRevisionId: project.hierarchy_revision_id,
      });

      expect(centreScope.some((dimension) => dimension.scopeId === centreB.id)).toBe(true);
      expect(centreScope.filter((dimension) => dimension.scopeType === "centre"))
        .toEqual([expect.objectContaining({ centreCode: "B", facilityType: "Active Aging Center" })]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const countBy = <T>(values: T[], selector: (value: T) => string | undefined): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => {
    const key = selector(value);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

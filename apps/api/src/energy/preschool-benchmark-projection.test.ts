import { createMetadataStore, type EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import {
  buildPreschoolBenchmarkProjection,
  hasCompletePreschoolBenchmarkWindow,
  resolvePreschoolBenchmarkProjection,
} from "./preschool-benchmark-projection.js";
import {
  resolvePublishedProjectRelease,
  type PublishedProjectRelease,
} from "./project-analysis-resolver.js";
import {
  resolveEnergyPublishedMeterRoute,
  type EnergyQueryContext,
} from "./energy-query-context.js";

const MAY_USAGE_BY_CENTRE = [
  ["A", 843.0985], ["B", 829.846], ["C", 824.094], ["D", 826.578], ["E", 870.4991],
  ["F", 814.623], ["G", 815.89], ["H", 828.066], ["I", 831.419], ["J", 823.57],
  ["K", 827.293], ["L", 863.0125], ["M", 812.683], ["N", 869.3166], ["O", 818.79],
  ["P", 836.793], ["Q", 831.115], ["R", 828.258], ["S", 834.438], ["T", 832.369],
  ["U", 838.992], ["V", 819.871], ["W", 812.294], ["X", 837.39], ["Y", 810.581],
  ["Z", 817.856], ["AA", 824.5446], ["AB", 831.289], ["AC", 834.74], ["AD", 832.503],
] as const;

describe("Preschool benchmark projection", () => {
  it("recomputes the authoritative May Portfolio and cohort Golden from published metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-benchmark-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const publishedRoute = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: project.id,
        hierarchyRevisionId: project.hierarchy_revision_id,
        scopeId: project.root_scope_id,
        resource: "electricity",
      });
      const release = resolvePublishedProjectRelease(metadata, {
        projectId: project.id,
        hierarchyRevisionId: project.hierarchy_revision_id,
        meterMappingRevisionId: publishedRoute.meterMappingRevisionId,
        meterFormulaRevisionId: project.meter_formula_revision_id,
        dataSnapshotId: "preschool-snapshot-may-2026",
        metricVersion: project.metric_version,
        businessCalendarVersion: project.business_calendar_version,
        tariffScheduleVersion: project.tariff_schedule_version,
      } as EnergyQueryContext);
      if (!release) throw new Error("Expected Preschool release");
      const hierarchy = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((revision) => revision.id === release.hierarchyRevisionId);
      if (!hierarchy) throw new Error("Expected Preschool hierarchy");
      const document = JSON.parse(hierarchy.snapshot_json) as EnergyIqProjectSetupDocument;
      const usageByCode = new Map<string, number>(MAY_USAGE_BY_CENTRE);
      const childScopes = document.nodes
        .filter((node) => node.tier_definition_id === "preschool-tier-centre")
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((node) => {
          const code = String(node.metadata?.centreCode ?? "");
          const usageKwh = usageByCode.get(code);
          if (usageKwh === undefined || !node.area_sqm || !node.occupant_count) {
            throw new Error(`Invalid test metadata for ${node.id}`);
          }
          const evidenceBase = {
            status: "provisional" as const,
            metadataRevisionIds: [`${release.hierarchyRevisionId}:${node.id}`],
            hierarchyRevisionIds: [release.hierarchyRevisionId],
            evidence: [],
          };
          return {
            nodeId: node.id,
            name: node.name,
            usageKwh,
            metadata: {
              area: { ...evidenceBase, value: node.area_sqm, unit: "m2" as const },
              headcount: { ...evidenceBase, value: node.occupant_count, unit: "people" as const },
            },
          };
        });
      const projection = buildPreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "preschool-snapshot-may-2026",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: {
          childScopes,
          provenance: {
            dataSnapshotId: "preschool-snapshot-may-2026",
            hierarchyRevisionId: release.hierarchyRevisionId,
            meterMappingRevisionId: release.meterMappingRevisionId,
            queryIds: ["scope_summary_v1", "child_scope_breakdown_v1"],
          },
        } as Parameters<typeof buildPreschoolBenchmarkProjection>[0]["analysis"],
      });

      expect(projection).toMatchObject({
        status: "provisional",
        sampleSize: 30,
        contract: { annualisationFactor: 12 },
        priorityCentreCodes: ["G", "M", "J"],
        evidence: {
          projectReleaseId: release.id,
          dataSnapshotId: "preschool-snapshot-may-2026",
          hierarchyRevisionId: release.hierarchyRevisionId,
          metadataStatus: "provisional",
          cohortSource: "published-hierarchy-node-metadata",
        },
      });
      expect(projection.portfolio.eui.p50).toBeCloseTo(7.034247079, 8);
      expect(projection.portfolio.eui.p75).toBeCloseTo(10.525439076, 8);
      expect(projection.portfolio.perPax.p50).toBeCloseTo(18.395011111, 8);
      expect(projection.portfolio.perPax.p75).toBeCloseTo(20.84584375, 8);
      expect(projection.cohorts.map((cohort) => ({
        name: cohort.name,
        sampleSize: cohort.sampleSize,
        euiP50: Number(cohort.eui.p50.toFixed(2)),
        euiP75: Number(cohort.eui.p75.toFixed(2)),
        perPaxP50: Number(cohort.perPax.p50.toFixed(1)),
        perPaxP75: Number(cohort.perPax.p75.toFixed(1)),
      }))).toEqual([
        { name: "Active Aging Center", sampleSize: 8, euiP50: 6.72, euiP75: 15.13, perPaxP50: 17.2, perPaxP75: 22.5 },
        { name: "Preschool", sampleSize: 8, euiP50: 9, euiP75: 10.95, perPaxP50: 18.1, perPaxP75: 20.1 },
        { name: "Senior Care Center", sampleSize: 14, euiP50: 6.76, euiP75: 9.2, perPaxP50: 18.5, perPaxP75: 20.7 },
      ]);
      expect(projection.centres.filter((centre) => centre.quadrant === "priority")
        .map((centre) => centre.centreCode)).toEqual(["G", "J", "M"]);
      expect(projection.evidence.normalisation).toEqual({
        eui: "May usage kWh * 12 / published comparison area m2",
        perPax: "May usage kWh / published representative headcount",
      });

      const incompleteMetadataAnalysis = {
        childScopes: childScopes.map((scope, index) => index === 0
          ? {
              ...scope,
              metadata: {
                ...scope.metadata,
                area: {
                  ...scope.metadata.area,
                  status: "missing" as const,
                  value: null,
                },
              },
            }
          : scope),
        provenance: {
          dataSnapshotId: "preschool-snapshot-may-2026",
          hierarchyRevisionId: release.hierarchyRevisionId,
          meterMappingRevisionId: release.meterMappingRevisionId,
          queryIds: ["scope_summary_v1", "child_scope_breakdown_v1"],
        },
      } as Parameters<typeof buildPreschoolBenchmarkProjection>[0]["analysis"];
      expect(resolvePreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "preschool-snapshot-may-2026",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: incompleteMetadataAnalysis,
      })).toBeUndefined();
      expect(resolvePreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "preschool-snapshot-may-2026",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: {
          childScopes: childScopes.slice(0, 29),
          provenance: incompleteMetadataAnalysis.provenance,
        },
      })).toBeUndefined();
      expect(resolvePreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "preschool-snapshot-may-2026",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-06-30T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: {
          childScopes,
          provenance: incompleteMetadataAnalysis.provenance,
        },
      })).toBeUndefined();
      expect(() => resolvePreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "different-snapshot",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: incompleteMetadataAnalysis,
      })).toThrow("PRESCHOOL_BENCHMARK_SNAPSHOT_MISMATCH");
      expect(() => resolvePreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "preschool-snapshot-may-2026",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-06-30T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: {
          childScopes,
          provenance: {
            ...incompleteMetadataAnalysis.provenance,
            hierarchyRevisionId: "different-hierarchy",
          },
        },
      })).toThrow("PRESCHOOL_BENCHMARK_HIERARCHY_MISMATCH");
      expect(() => resolvePreschoolBenchmarkProjection({
        metadataStore: metadata,
        projectRelease: release,
        dataSnapshotId: "preschool-snapshot-may-2026",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-06-30T16:00:00.000Z",
        },
        timezone: "Asia/Singapore",
        analysis: {
          childScopes,
          provenance: {
            ...incompleteMetadataAnalysis.provenance,
            meterMappingRevisionId: "different-mapping",
          },
        },
      })).toThrow("PRESCHOOL_BENCHMARK_MAPPING_MISMATCH");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when Snapshot Evidence does not match the analysed facts", () => {
    expect(() => buildPreschoolBenchmarkProjection({
      metadataStore: {} as never,
      projectRelease: {
        projectId: "preschool-demo",
        hierarchyRevisionId: "hierarchy-v1",
        meterMappingRevisionId: "mapping-v1",
      } as PublishedProjectRelease,
      dataSnapshotId: "snapshot-a",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: {
        childScopes: [],
        provenance: {
          dataSnapshotId: "snapshot-b",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          queryIds: [],
        },
      } as Parameters<typeof buildPreschoolBenchmarkProjection>[0]["analysis"],
    })).toThrow("PRESCHOOL_BENCHMARK_SNAPSHOT_MISMATCH");
  });

  it("requires at least 28 complete Project local days in the resolved rolling window", () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({
      localDate: `2026-05-${String(index + 1).padStart(2, "0")}`,
      from: "",
      to: "",
      usageKwh: 1,
      dataHealth: {
        status: index < 28 ? "complete" as const : "partial" as const,
        coveragePct: index < 28 ? 100 : 50,
        expectedMeterIntervalCount: 24,
        validIntervalCount: index < 28 ? 24 : 12,
        qualityEventCount: 0,
      },
    }));
    const analysis = {
      dailyTotals: {
        metricId: "energy.total_usage_kwh@1" as const,
        grain: "day" as const,
        timezone: "Asia/Singapore",
        scopes: [{
          scopeId: "preschool-project",
          scopeName: "Preschool Portfolio",
          scopeType: "project",
          rows,
        }],
      },
    };

    expect(hasCompletePreschoolBenchmarkWindow(analysis, "preschool-project")).toBe(true);
    expect(hasCompletePreschoolBenchmarkWindow({
      dailyTotals: {
        ...analysis.dailyTotals,
        scopes: [{ ...analysis.dailyTotals.scopes[0]!, rows: rows.slice(0, 27) }],
      },
    }, "preschool-project")).toBe(false);
    expect(hasCompletePreschoolBenchmarkWindow({
      dailyTotals: {
        ...analysis.dailyTotals,
        scopes: [{
          ...analysis.dailyTotals.scopes[0]!,
          rows: [...rows.slice(0, 27), { ...rows[27]!, localDate: "2026-06-01" }],
        }],
      },
    }, "preschool-project")).toBe(true);
  });
});

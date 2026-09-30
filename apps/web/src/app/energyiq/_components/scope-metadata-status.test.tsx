import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnergyProjectAnalysisMetadataDto } from "../../../lib/config-api";
import { ScopeMetadataStatus } from "./scope-metadata-status";

describe("Area and Headcount status", () => {
  it("renders confirmed, provisional and missing normalisations with specific guidance and Evidence", () => {
    const markup = renderToStaticMarkup(
      <ScopeMetadataStatus metadata={metadataProjection()} mode="interactive" />,
    );

    expect(markup).toContain("Area &amp; headcount");
    expect(markup).toContain("Confirmed");
    expect(markup).toContain("Provisional");
    expect(markup).toContain("Missing");
    expect(markup).toContain("743 m²");
    expect(markup).toContain("14.54 kWh/person");
    expect(markup).toContain("Add 24-hour representative headcount for Scope centre-b in Admin &gt; Projects &gt; Structure");
    expect(markup).toContain("metadata-v1:centre-a");
    expect(markup).not.toContain("No data");
  });

  it("keeps a legacy Saved Analysis frozen instead of looking up current metadata", () => {
    const markup = renderToStaticMarkup(
      <ScopeMetadataStatus mode="saved" />,
    );

    expect(markup).toContain("was not frozen in this saved result");
    expect(markup).toContain("not recalculated from current Project metadata");
  });
});

const metadataProjection = (): EnergyProjectAnalysisMetadataDto => ({
  status: "missing",
  hierarchyRevisionId: "hierarchy-v1",
  timezone: "Asia/Singapore",
  period: {
    start: "2026-04-30T16:00:00.000Z",
    endExclusive: "2026-05-31T16:00:00.000Z",
  },
  selectedScope: {
    scopeId: "centre-a",
    scopeName: "Centre A",
    usageKwh: 843.0985,
    status: "provisional",
    area: metadataValue("area", 743, "m2", "provisional", "centre-a"),
    headcount: metadataValue("headcount", 58, "people", "confirmed", "centre-a"),
    normalisations: {
      eui: normalisation("energy.usage_per_sqm", 843.0985 / 743, "kWh/m2", "provisional", "centre-a"),
      perPax: normalisation("energy.usage_per_person", 843.0985 / 58, "kWh/person", "confirmed", "centre-a"),
    },
    evidence: [{
      ...evidence("area", 743, "provisional", "centre-a"),
      scopeId: "centre-a",
      scopeName: "Centre A",
    }],
  },
  comparisonScopes: [{
    scopeId: "centre-b",
    scopeName: "Centre B",
    usageKwh: 700,
    status: "missing",
    area: metadataValue("area", 800, "m2", "confirmed", "centre-b"),
    headcount: {
      status: "missing",
      value: null,
      unit: "people",
      reason: "not-configured",
      guidance: "Add 24-hour representative headcount for Scope centre-b in Admin > Projects > Structure, then publish a new Project Release.",
      metadataRevisionIds: [],
      hierarchyRevisionIds: [],
      evidence: [],
    },
    normalisations: {
      eui: normalisation("energy.usage_per_sqm", 0.875, "kWh/m2", "confirmed", "centre-b"),
      perPax: {
        status: "missing",
        metricId: "energy.usage_per_person",
        value: null,
        unit: "kWh/person",
        reason: "not-configured",
        guidance: "Add 24-hour representative headcount for Scope centre-b in Admin > Projects > Structure, then publish a new Project Release.",
        metadataRevisionIds: [],
        hierarchyRevisionIds: [],
        evidence: [],
      },
    },
    evidence: [],
  }],
  evidence: [{
    ...evidence("area", 743, "provisional", "centre-a"),
    scopeId: "centre-a",
    scopeName: "Centre A",
  }],
});

const metadataValue = (
  dimension: "area" | "headcount",
  value: number,
  unit: "m2" | "people",
  status: "confirmed" | "provisional",
  scopeId: string,
) => ({
  status,
  value,
  unit,
  metadataRevisionIds: [`metadata-v1:${scopeId}`],
  hierarchyRevisionIds: ["hierarchy-v1"],
  evidence: [evidence(dimension, value, status, scopeId)],
});

const normalisation = (
  metricId: "energy.usage_per_sqm" | "energy.usage_per_person",
  value: number,
  unit: "kWh/m2" | "kWh/person",
  status: "confirmed" | "provisional",
  scopeId: string,
) => ({
  status,
  metricId,
  value,
  unit,
  metadataRevisionIds: [`metadata-v1:${scopeId}`],
  hierarchyRevisionIds: ["hierarchy-v1"],
  evidence: [],
});

const evidence = (
  dimension: "area" | "headcount",
  value: number,
  status: "confirmed" | "provisional",
  scopeId: string,
) => ({
  metadataRevisionId: `metadata-v1:${scopeId}`,
  hierarchyRevisionId: "hierarchy-v1",
  dimension,
  value,
  status,
  effectiveFrom: null,
  effectiveTo: null,
  timezone: "Asia/Singapore",
});

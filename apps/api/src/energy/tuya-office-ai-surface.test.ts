import type { EnergyIqOverviewAiSlotDefinition } from "@datafoundry/contracts";
import type { MetadataStore } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import { resolveTuyaOfficeAiSurfaceDefinition } from "./tuya-office-ai-surface.js";

describe("resolveTuyaOfficeAiSurfaceDefinition", () => {
  it("compiles the exact Tuya AI surface from the published Release definition", () => {
    const surface = resolveTuyaOfficeAiSurfaceDefinition(metadataStore(), "tuya-release-v7");

    expect(surface).toMatchObject({
      overviewDefinitionRevision: "tuya-release-v7:definition-fingerprint-v7",
      keyFindings: { slotId: "key-findings", regionId: "tuya-key-findings", label: "AI Key Findings", order: 0, generation: { skillId: "none", outputContractRevision: "energyiq-project-executive-synthesis-v1" } },
      sections: [
        { id: "data-readiness", slotId: "section-data-readiness", regionId: "tuya-circuit-health", label: "Data readiness", order: 10 },
        { id: "consumption-and-demand", slotId: "section-consumption-and-demand", regionId: "tuya-overall-performance", label: "Consumption and demand", order: 20, generation: { validatorRevision: "tuya-office-section-acceptance-v4" } },
        { id: "meter-contribution-and-operations", slotId: "section-meter-contribution-and-operations", regionId: "tuya-operating-pattern", label: "Meter contribution and operations", order: 30 },
      ],
      additionalInsights: { slotId: "additional-insights", regionId: "tuya-decision-lenses", label: "Additional Insights", order: 40, generation: { skillId: "none", methodId: "energyiq-open-discovery" } },
    });
  });

  it("uses the published Definition as the only supported order, region and label truth", () => {
    const missing = metadataStore({ omitSlotId: "section-data-readiness" });
    const rewritten = metadataStore({
      rewrittenLabel: "Demand review",
      rewrittenRegion: "tuya-operating-pattern",
      rewrittenOrder: 35,
    });

    expect(() => resolveTuyaOfficeAiSurfaceDefinition(missing, "tuya-release-v7"))
      .toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
    expect(resolveTuyaOfficeAiSurfaceDefinition(rewritten, "tuya-release-v7").sections)
      .toContainEqual(expect.objectContaining({
        id: "consumption-and-demand",
        label: "Demand review",
        regionId: "tuya-operating-pattern",
        order: 35,
      }));
  });

  it("fails closed before execution for an unmounted region, duplicate order, or unsupported governed reference", () => {
    expect(() => resolveTuyaOfficeAiSurfaceDefinition(metadataStore({
      rewrittenRegion: "tuya-unmounted-region",
    }), "tuya-release-v7")).toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
    expect(() => resolveTuyaOfficeAiSurfaceDefinition(metadataStore({
      rewrittenOrder: 30,
    }), "tuya-release-v7")).toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
    expect(() => resolveTuyaOfficeAiSurfaceDefinition(metadataStore({
      rewrittenSkillId: "release-approved-skill",
    }), "tuya-release-v7")).toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
    expect(() => resolveTuyaOfficeAiSurfaceDefinition(metadataStore({
      rewrittenMethodId: "another-method",
    }), "tuya-release-v7")).toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
    for (const rewrittenGeneration of [
      { revision: "another-slot@1" },
      { contextRevision: "another-context@1" },
      { toolPolicyRevision: "another-tool-policy@1" },
      { outputContractRevision: "another-output@1" },
      { validatorRevision: "another-validator@1" },
      { presentationReferenceRevision: "another-presentation@1" },
    ]) {
      expect(() => resolveTuyaOfficeAiSurfaceDefinition(metadataStore({ rewrittenGeneration }), "tuya-release-v7"))
        .toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
    }
  });

  it("fails closed for a foreign or stale Project Release", () => {
    expect(() => resolveTuyaOfficeAiSurfaceDefinition(
      metadataStore({ projectId: "another-project" }),
      "tuya-release-v7",
    )).toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_NOT_FOUND");
    expect(() => resolveTuyaOfficeAiSurfaceDefinition(metadataStore(), "tuya-release-v6"))
      .toThrow("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_NOT_FOUND");
  });
});

const metadataStore = (input: {
  omitSlotId?: string;
  rewrittenLabel?: string;
  rewrittenRegion?: string;
  rewrittenOrder?: number;
  rewrittenSkillId?: string;
  rewrittenMethodId?: string;
  rewrittenGeneration?: Partial<EnergyIqOverviewAiSlotDefinition>;
  projectId?: string;
} = {}): MetadataStore => {
  const aiSlots = publishedAiSlots()
    .filter(({ slotId }) => slotId !== input.omitSlotId)
    .map((slot) => {
      return {
        ...slot,
        label: slot.slotId === "section-consumption-and-demand"
          ? input.rewrittenLabel ?? slot.label
          : slot.label,
        regionIntent: slot.slotId === "section-consumption-and-demand"
          ? input.rewrittenRegion ?? slot.regionIntent
          : slot.regionIntent,
        order: slot.slotId === "section-consumption-and-demand"
          ? input.rewrittenOrder ?? slot.order
          : slot.order,
        skillId: slot.slotId === "section-consumption-and-demand"
          ? input.rewrittenSkillId ?? slot.skillId
          : slot.skillId,
        methodId: slot.slotId === "section-consumption-and-demand"
          ? input.rewrittenMethodId ?? slot.methodId
          : slot.methodId,
        ...(slot.slotId === "section-consumption-and-demand" ? input.rewrittenGeneration : {}),
      };
    });
  return {
    energyIq: {
      templates: {
        getProjectRevision: (revisionId: string) => revisionId === "tuya-release-v7" ? {
          revision_id: revisionId,
          project_id: input.projectId ?? "tuya-office",
        } : undefined,
      },
      overviewDefinitions: {
        get: (revisionId: string) => revisionId === "tuya-release-v7" ? {
          template_revision_id: revisionId,
          renderer_key: "tuya-office-overview",
          definition_fingerprint: "definition-fingerprint-v7",
          definition: { aiSlots },
        } : undefined,
      },
    },
} as unknown as MetadataStore;
};

function publishedAiSlots(): EnergyIqOverviewAiSlotDefinition[] { return [
  aiSlot("key-findings", "overview-synthesis", "AI Key Findings", 0, "tuya-key-findings", "none", "energyiq-project-executive-synthesis-v1", "tuya-office-executive-acceptance-v1"),
  aiSlot("section-data-readiness", "section-interpretation", "Data readiness", 10, "tuya-circuit-health", "none", "energyiq-project-section-interpretation-v2", "tuya-office-section-acceptance-v4"),
  aiSlot("section-consumption-and-demand", "section-interpretation", "Consumption and demand", 20, "tuya-overall-performance", "none", "energyiq-project-section-interpretation-v2", "tuya-office-section-acceptance-v4"),
  aiSlot("section-meter-contribution-and-operations", "section-interpretation", "Meter contribution and operations", 30, "tuya-operating-pattern", "none", "energyiq-project-section-interpretation-v2", "tuya-office-section-acceptance-v4"),
  aiSlot("additional-insights", "additional-insights", "Additional Insights", 40, "tuya-decision-lenses", "none", "energyiq-additional-ai-insights-v3", "additional-insights-acceptance-v19"),
]; }

function aiSlot(
  slotId: string,
  role: string,
  label: string,
  order: number,
  regionIntent: string,
  skillId: string,
  outputContractRevision: string,
  validatorRevision: string,
): EnergyIqOverviewAiSlotDefinition { return {
  slotId,
  revision: slotId === "key-findings"
    ? "tuya-office-key-findings-slot@1"
    : slotId === "section-data-readiness"
      ? "tuya-office-data-readiness-slot@1"
      : slotId === "section-consumption-and-demand"
        ? "tuya-office-consumption-demand-slot@1"
        : slotId === "section-meter-contribution-and-operations"
          ? "tuya-office-meter-operations-slot@1"
          : "tuya-office-additional-insights-slot@1",
  role,
  label,
  order,
  regionIntent,
  businessObjective: "fixture",
  audience: "fixture",
  decisionUse: "fixture",
  presentationIntent: ["conclusion-first"],
  skillId,
  skillRevision: skillId === "none" ? "not-applicable-v1" : "1.0.0",
  methodId: role === "overview-synthesis"
    ? "tuya-office-executive-synthesis"
    : role === "section-interpretation"
      ? "tuya-office-section-discover-publish"
      : "energyiq-open-discovery",
  methodRevision: role === "additional-insights" ? "1.0.0" : "1",
  contextRevision: role === "overview-synthesis"
    ? "tuya-office-section-artifacts-v1"
    : role === "section-interpretation"
      ? "tuya-office-section-pack-v4"
      : "tuya-office-additional-insights-pack-v1",
  toolPolicyRevision: role === "additional-insights" ? "scoped-read-only-v1" : role === "overview-synthesis" ? "section-artifacts-v1" : "pack-only-v1",
  outputContractRevision,
  validatorRevision,
  presentationReferenceRevision: "energyiq-decision-brief@1",
}; }

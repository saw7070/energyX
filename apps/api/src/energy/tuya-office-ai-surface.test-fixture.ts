import type {
  ProjectOverviewAiSurfaceDefinition,
  ProjectOverviewAiUnitGenerationDefinition,
} from "./project-overview-ai-adapter.js";

const sectionGeneration = (revision: string): ProjectOverviewAiUnitGenerationDefinition => ({
  revision,
  role: "section-interpretation",
  skillId: "none",
  skillRevision: "not-applicable-v1",
  methodId: "tuya-office-section-discover-publish",
  methodRevision: "1",
  contextRevision: "tuya-office-section-pack-v4",
  toolPolicyRevision: "pack-only-v1",
  outputContractRevision: "energyiq-project-section-interpretation-v2",
  validatorRevision: "tuya-office-section-acceptance-v4",
  presentationReferenceRevision: "energyiq-decision-brief@1",
});

export const tuyaOfficeAiSurfaceFixture = (): ProjectOverviewAiSurfaceDefinition => ({
  overviewDefinitionRevision: "tuya-office-template-v1:fixture-definition",
  keyFindings: {
    slotId: "key-findings",
    regionId: "tuya-key-findings",
    label: "AI Key Findings",
    order: 0,
    generation: {
      ...sectionGeneration("tuya-office-key-findings-slot@1"),
      revision: "tuya-office-key-findings-slot@1",
      role: "overview-synthesis",
      methodId: "tuya-office-executive-synthesis",
      contextRevision: "tuya-office-section-artifacts-v1",
      toolPolicyRevision: "section-artifacts-v1",
      outputContractRevision: "energyiq-project-executive-synthesis-v1",
      validatorRevision: "tuya-office-executive-acceptance-v1",
    },
  },
  sections: [
    ["data-readiness", "tuya-circuit-health", "Data readiness", 10],
    ["consumption-and-demand", "tuya-overall-performance", "Consumption and demand", 20],
    ["meter-contribution-and-operations", "tuya-operating-pattern", "Meter contribution and operations", 30],
  ].map(([id, regionId, label, order]) => ({
    id: id as string,
    slotId: `section-${id}`,
    regionId: regionId as string,
    label: label as string,
    order: order as number,
    generation: sectionGeneration(id === "data-readiness"
      ? "tuya-office-data-readiness-slot@1"
      : id === "consumption-and-demand"
        ? "tuya-office-consumption-demand-slot@1"
        : "tuya-office-meter-operations-slot@1"),
  })),
  additionalInsights: {
    slotId: "additional-insights",
    regionId: "tuya-decision-lenses",
    label: "Additional Insights",
    order: 40,
    generation: {
      ...sectionGeneration("tuya-office-additional-insights-slot@1"),
      revision: "tuya-office-additional-insights-slot@1",
      role: "additional-insights",
      skillId: "none",
      skillRevision: "not-applicable-v1",
      methodId: "energyiq-open-discovery",
      methodRevision: "1.0.0",
      contextRevision: "tuya-office-additional-insights-pack-v1",
      toolPolicyRevision: "scoped-read-only-v1",
      outputContractRevision: "energyiq-additional-ai-insights-v3",
      validatorRevision: "additional-insights-acceptance-v19",
    },
  },
});

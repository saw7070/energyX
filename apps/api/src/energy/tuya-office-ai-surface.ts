import {
  TUYA_OFFICE_AI_SECTION_TARGET_IDS,
  type EnergyIqOverviewAiSlotDefinition,
} from "@datafoundry/contracts";
import type { EnergyIqOverviewAiArtifactIdentity, MetadataStore } from "@datafoundry/metadata";

import type { ProjectOverviewAiSurfaceDefinition } from "./project-overview-ai-adapter.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

export const resolveTuyaOfficeAiSurfaceDefinition = (
  metadataStore: MetadataStore,
  projectReleaseId: string,
): ProjectOverviewAiSurfaceDefinition => {
  const release = metadataStore.energyIq.templates.getProjectRevision(projectReleaseId);
  const record = metadataStore.energyIq.overviewDefinitions.get(projectReleaseId);
  if (!release
    || release.project_id !== TUYA_OFFICE_PROJECT_ID
    || !record
    || record.renderer_key !== "tuya-office-overview"
    || record.template_revision_id !== projectReleaseId) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_NOT_FOUND");
  }
  const definitions = record.definition.aiSlots ?? [];
  if (definitions.length !== 5 || new Set(definitions.map(({ slotId }) => slotId)).size !== definitions.length) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  }
  if (definitions.some((definition) => !TUYA_OFFICE_AI_MOUNTED_REGIONS.has(definition.regionIntent))
    || new Set(definitions.map(({ order }) => order)).size !== definitions.length
    || definitions.some((definition) => !generationMatchesSupportedRuntime(definition))) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  }
  const keyFindingsDefinitions = definitions.filter(({ role }) => role === "overview-synthesis");
  const additionalDefinitions = definitions.filter(({ role }) => role === "additional-insights");
  const sectionDefinitions = definitions.filter(({ role }) => role === "section-interpretation");
  if (keyFindingsDefinitions.length !== 1 || additionalDefinitions.length !== 1 || sectionDefinitions.length !== 3) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  }
  const sectionIds = sectionDefinitions.map(({ slotId }) => slotId.startsWith("section-")
    ? slotId.slice("section-".length)
    : "");
  if (new Set(sectionIds).size !== TUYA_OFFICE_AI_SECTION_TARGET_IDS.length
    || !TUYA_OFFICE_AI_SECTION_TARGET_IDS.every((targetId) => sectionIds.includes(targetId))) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  }
  const keyFindings = keyFindingsDefinitions[0]!;
  const additionalInsights = additionalDefinitions[0]!;
  const sections = sectionDefinitions
    .map((definition) => ({
      id: definition.slotId.slice("section-".length),
      ...surfaceUnit(definition),
    }))
    .sort((left, right) => left.order - right.order);
  return {
    overviewDefinitionRevision: `${record.template_revision_id}:${record.definition_fingerprint}`,
    keyFindings: surfaceUnit(keyFindings),
    sections,
    additionalInsights: surfaceUnit(additionalInsights),
  };
};

const TUYA_OFFICE_AI_MOUNTED_REGIONS = new Set([
  "tuya-key-findings",
  "tuya-overall-performance",
  "tuya-operating-pattern",
  "tuya-circuit-health",
  "tuya-decision-lenses",
]);

const TUYA_OFFICE_SUPPORTED_GENERATION: Record<string, Omit<ReturnType<typeof surfaceUnit>["generation"], "role"> & { role: string }> = {
  "key-findings": {
    revision: "tuya-office-key-findings-slot@1",
    role: "overview-synthesis",
    skillId: "none",
    skillRevision: "not-applicable-v1",
    methodId: "tuya-office-executive-synthesis",
    methodRevision: "1",
    contextRevision: "tuya-office-section-artifacts-v1",
    toolPolicyRevision: "section-artifacts-v1",
    outputContractRevision: "energyiq-project-executive-synthesis-v1",
    validatorRevision: "tuya-office-executive-acceptance-v1",
    presentationReferenceRevision: "energyiq-decision-brief@1",
  },
  "section-data-readiness": sectionGeneration("tuya-office-data-readiness-slot@1"),
  "section-consumption-and-demand": sectionGeneration("tuya-office-consumption-demand-slot@1"),
  "section-meter-contribution-and-operations": sectionGeneration("tuya-office-meter-operations-slot@1"),
  "additional-insights": {
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
    presentationReferenceRevision: "energyiq-decision-brief@1",
  },
};

function sectionGeneration(revision: string) {
  return {
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
  };
}

function generationMatchesSupportedRuntime(definition: EnergyIqOverviewAiSlotDefinition): boolean {
  const supported = TUYA_OFFICE_SUPPORTED_GENERATION[definition.slotId];
  return supported !== undefined
    && Object.entries(supported).every(([key, value]) => definition[key as keyof EnergyIqOverviewAiSlotDefinition] === value);
}

const surfaceUnit = (definition: EnergyIqOverviewAiSlotDefinition) => ({
  slotId: definition.slotId,
  regionId: definition.regionIntent,
  label: definition.label,
  order: definition.order,
  generation: {
    revision: definition.revision,
    role: definition.role,
    skillId: definition.skillId,
    skillRevision: definition.skillRevision,
    methodId: definition.methodId,
    methodRevision: definition.methodRevision,
    contextRevision: definition.contextRevision,
    toolPolicyRevision: definition.toolPolicyRevision,
    outputContractRevision: definition.outputContractRevision,
    validatorRevision: definition.validatorRevision,
    presentationReferenceRevision: definition.presentationReferenceRevision,
  },
});

export const requireTuyaOfficeAiSurfaceForIdentity = (
  metadataStore: MetadataStore,
  identity: EnergyIqOverviewAiArtifactIdentity,
): ProjectOverviewAiSurfaceDefinition => {
  const surface = resolveTuyaOfficeAiSurfaceDefinition(metadataStore, identity.projectReleaseId);
  if (surface.sections.length !== 3) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  }
  return surface;
};

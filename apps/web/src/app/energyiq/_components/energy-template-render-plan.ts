import type {
  EnergyComponentRevisionDto,
  EnergyTemplateComponentLayoutDto,
  EnergyTemplateComponentPlacementDto,
  EnergyTemplateComponentPresentationDto,
  EnergyTemplateDefinitionDto,
  EnergyTemplateSectionDto,
} from "../../../lib/config-api";

export type EnergyTemplateModuleReadiness = {
  status: "ready" | "partial" | "missing";
  label: string;
  detail: string;
};

export type EnergyTemplateRenderModule = {
  placement: EnergyTemplateComponentPlacementDto & {
    placement_id: string;
    section_id: string;
    layout: EnergyTemplateComponentLayoutDto;
    presentation: EnergyTemplateComponentPresentationDto;
  };
  component: EnergyComponentRevisionDto;
  readiness: EnergyTemplateModuleReadiness;
};

export type EnergyTemplateRenderSection = EnergyTemplateSectionDto & {
  modules: EnergyTemplateRenderModule[];
};

export type EnergyTemplateRenderPlan = {
  template_id: string;
  target_kind: EnergyTemplateDefinitionDto["target_kind"];
  sections: EnergyTemplateRenderSection[];
  module_count: number;
};

const DEFAULT_READINESS: EnergyTemplateModuleReadiness = {
  status: "ready",
  label: "Published",
  detail: "Uses the published Project Template Revision and trusted analysis context.",
};

export function buildEnergyTemplateRenderPlan(input: {
  template: EnergyTemplateDefinitionDto;
  catalog: readonly EnergyComponentRevisionDto[];
  resolveReadiness?: (component: EnergyComponentRevisionDto) => EnergyTemplateModuleReadiness;
}): EnergyTemplateRenderPlan {
  const catalogById = new Map(input.catalog.map((component) => [component.revision_id, component]));
  const modules = input.template.components.flatMap((placement) => {
    if (!placement.enabled) return [];
    const component = catalogById.get(placement.component_revision_id);
    if (!component) return [];
    const normalizedPlacement = normalizePlacement(placement, component);
    return [{
      placement: normalizedPlacement,
      component,
      readiness: input.resolveReadiness?.(component) ?? DEFAULT_READINESS,
    }];
  });
  const configuredSections = input.template.sections?.length
    ? input.template.sections
    : inferSections(modules);
  const sectionIds = new Set(configuredSections.map((section) => section.section_id));
  const unassigned = modules.filter((module) => !sectionIds.has(module.placement.section_id));
  const sections = configuredSections.map((section) => ({
    ...section,
    modules: modules.filter((module) => module.placement.section_id === section.section_id),
  }));
  if (unassigned.length > 0) {
    sections.push({
      section_id: "other",
      title: "Other analysis",
      navigation_label: "Other",
      description: "Published modules without a configured section.",
      modules: unassigned,
    });
  }
  return {
    template_id: input.template.template_id,
    target_kind: input.template.target_kind,
    sections: sections.filter((section) => section.modules.length > 0),
    module_count: modules.length,
  };
}

function normalizePlacement(
  placement: EnergyTemplateComponentPlacementDto,
  component: EnergyComponentRevisionDto,
): EnergyTemplateRenderModule["placement"] {
  return {
    ...placement,
    placement_id: placement.placement_id ?? component.component_id,
    section_id: placement.section_id ?? `family-${component.family}`,
    layout: placement.layout ?? { span: 12, height: "standard" },
    presentation: placement.presentation ?? {
      visual_preset: "auto",
      density: "comfortable",
      tone: "default",
      show_legend: true,
      limit: 10,
    },
  };
}

function inferSections(modules: readonly EnergyTemplateRenderModule[]): EnergyTemplateSectionDto[] {
  const seen = new Set<string>();
  return modules.flatMap((module) => {
    const id = module.placement.section_id;
    if (seen.has(id)) return [];
    seen.add(id);
    const label = familyLabel(module.component.family);
    return [{ section_id: id, title: label, navigation_label: label }];
  });
}

function familyLabel(family: EnergyComponentRevisionDto["family"]): string {
  switch (family) {
    case "decision": return "Action summary";
    case "overview": return "Energy overview";
    case "comparison": return "Comparison";
    case "time": return "Time pattern";
    case "composition": return "Composition";
    case "quality": return "Data status";
    case "evidence": return "Exceptions & evidence";
  }
}

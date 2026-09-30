import { describe, expect, it } from "vitest";

import type {
  EnergyComponentRevisionDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";

const catalog: EnergyComponentRevisionDto[] = [
  component("quality.data_coverage@1", "quality.data_coverage", "quality", "data_quality_summary_v1"),
  component("overview.consumption@1", "overview.consumption", "overview", "consumption_overview_v1"),
];

describe("buildEnergyTemplateRenderPlan", () => {
  it("preserves configured section order and normalises the visual contract", () => {
    const template: EnergyTemplateDefinitionDto = {
      template_id: "project",
      target_kind: "project",
      sections: [
        { section_id: "data", title: "Data status", navigation_label: "Data" },
        { section_id: "overview", title: "Energy overview", navigation_label: "Overview" },
      ],
      components: [
        {
          placement_id: "coverage",
          component_revision_id: "quality.data_coverage@1",
          enabled: true,
          section_id: "data",
          layout: { span: 4, height: "compact" },
          presentation: { visual_preset: "cards", density: "compact", tone: "quiet", show_legend: false, limit: 4 },
        },
        {
          placement_id: "usage",
          component_revision_id: "overview.consumption@1",
          enabled: true,
          section_id: "overview",
          layout: { span: 8, height: "standard" },
          presentation: { visual_preset: "cards", density: "comfortable", tone: "highlight", show_legend: true, limit: 10 },
        },
      ],
    };
    const plan = buildEnergyTemplateRenderPlan({ template, catalog });
    expect(plan.sections.map((section) => section.section_id)).toEqual(["data", "overview"]);
    expect(plan.sections[0]?.modules[0]?.placement).toMatchObject({
      placement_id: "coverage",
      layout: { span: 4, height: "compact" },
      presentation: { visual_preset: "cards", density: "compact", tone: "quiet" },
    });
  });

  it("keeps older placement-only templates renderable", () => {
    const template: EnergyTemplateDefinitionDto = {
      template_id: "project",
      target_kind: "project",
      components: [{ component_revision_id: "overview.consumption@1", enabled: true }],
    };
    const plan = buildEnergyTemplateRenderPlan({ template, catalog });
    expect(plan.module_count).toBe(1);
    expect(plan.sections[0]?.modules[0]?.placement).toMatchObject({
      placement_id: "overview.consumption",
      layout: { span: 12, height: "standard" },
      presentation: { visual_preset: "auto", density: "comfortable" },
    });
  });
});

function component(
  revisionId: string,
  componentId: string,
  family: EnergyComponentRevisionDto["family"],
  viewKey: string,
): EnergyComponentRevisionDto {
  return {
    revision_id: revisionId,
    component_id: componentId,
    version: 1,
    display_name: componentId,
    description: componentId,
    family,
    view_key: viewKey,
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "always",
    created_at: "2026-08-03T00:00:00.000Z",
  };
}

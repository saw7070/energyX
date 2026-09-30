import { describe, expect, it } from "vitest";

import { compileEnergyIqOverviewDefinition } from "./energyiq-overview-definition.js";
import type { EnergyIqComponentRevisionRecord } from "./energyiq-template-store.js";

describe("compileEnergyIqOverviewDefinition", () => {
  it("keeps the Release-owned AI Slot presentation mode without changing the authored Sections", () => {
    const sections = [{
      key: "current-performance",
      title: "Current performance",
      managementQuestion: "Where is energy use changing enough to require attention?",
      primaryWindowId: "recent-28d",
      blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
    }];

    const result = compileEnergyIqOverviewDefinition({
      baseDefinition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        aiSlotPresentationMode: "html",
        sections,
      },
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections,
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.definition.aiSlotPresentationMode).toBe("html");
    expect(result.definition.sections).toMatchObject(sections);
  });

  it("preserves server-owned AI Slot definitions when a proposal omits them", () => {
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      aiSlots: [{
        slotId: "executive-summary",
        revision: "preschool-executive@1",
        role: "executive",
        label: "Executive",
        order: 0,
        regionIntent: "top",
        businessObjective: "orient",
        audience: "manager",
        decisionUse: "prioritize",
        presentationIntent: ["summary"],
        skillId: "energyiq-evidence-first",
        skillRevision: "1",
        methodId: "energyiq-overview-slot-method",
        methodRevision: "1",
        contextRevision: "energyiq-overview-context@1",
        toolPolicyRevision: "none@1",
        outputContractRevision: "energyiq-overview-slot@1",
        validatorRevision: "energyiq-overview-slot@1",
        presentationReferenceRevision: "energyiq-overview-slot@1",
      }],
      sections: [{
        key: "current-performance",
        title: "Current performance",
        managementQuestion: "Where is energy use changing enough to require attention?",
        primaryWindowId: "recent-28d",
        blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: baseDefinition.sections,
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.definition.aiSlots).toEqual(baseDefinition.aiSlots);
  });

  it("compiles one Agent-facing Section and Block into a canonical project template", () => {
    const result = compileEnergyIqOverviewDefinition({
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [
          {
            key: "current-performance",
            title: "Current performance",
            managementQuestion: "Where is energy use changing enough to require attention?",
            primaryWindowId: "recent-28d",
            blocks: [
              {
                key: "consumption",
                capabilityRevisionId: "overview.consumption@1",
                emphasis: "primary",
              },
            ],
          },
        ],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [
          {
            windowId: "recent-28d",
            role: "recent_operations",
            label: "Recent 28 complete days",
            strategy: { kind: "rolling_complete_days", days: 28 },
          },
        ],
      },
    });

    expect(result.definition).toEqual({
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [
        {
          key: "current-performance",
          title: "Current performance",
          managementQuestion: "Where is energy use changing enough to require attention?",
          primaryWindowId: "recent-28d",
          supportingWindowIds: [],
          blocks: [
            {
              key: "consumption",
              capabilityRevisionId: "overview.consumption@1",
              windowId: "recent-28d",
              emphasis: "primary",
            },
          ],
        },
      ],
    });
    expect(result.templateDocument).toEqual({
      schema_version: 2,
      templates: [
        {
          template_id: "project",
          target_kind: "project",
          sections: [
            {
              section_id: "current-performance",
              title: "Current performance",
              navigation_label: "Current performance",
              description: "Where is energy use changing enough to require attention?",
            },
          ],
          components: [
            {
              placement_id: "consumption",
              component_revision_id: "overview.consumption@1",
              enabled: true,
              section_id: "current-performance",
              layout: { span: 12, height: "compact" },
              presentation: {
                visual_preset: "cards",
                density: "comfortable",
                tone: "highlight",
                show_legend: false,
                limit: 10,
              },
            },
          ],
        },
      ],
    });
  });

  it("keeps repeated Capability windows in the Definition while projecting one legacy placement", () => {
    const result = compileEnergyIqOverviewDefinition({
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [
          {
            key: "current-performance",
            title: "Current performance",
            managementQuestion: "What is happening now?",
            primaryWindowId: "month-to-date",
            blocks: [{ key: "current-consumption", capabilityRevisionId: "overview.consumption@1" }],
          },
          {
            key: "historical-trend",
            title: "Historical trend",
            managementQuestion: "How does the current result compare with complete months?",
            primaryWindowId: "completed-months",
            blocks: [{ key: "historical-consumption", capabilityRevisionId: "overview.consumption@1" }],
          },
        ],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [
          { windowId: "month-to-date", role: "current", label: "Month to date", strategy: { kind: "calendar_month_to_date" } },
          { windowId: "completed-months", role: "trend", label: "Completed months", strategy: { kind: "completed_calendar_months", months: 3 } },
        ],
      },
    });

    expect(result.definition.sections).toHaveLength(2);
    expect(result.definition.sections[1]?.blocks[0]).toMatchObject({
      key: "historical-consumption",
      windowId: "completed-months",
    });
    expect(result.templateDocument.templates[0]?.components).toHaveLength(1);
    expect(result.templateDocument.templates[0]?.components[0]?.placement_id).toBe("current-consumption");
  });

  it("rejects Renderer and layout implementation details outside the Agent contract", () => {
    expect(() => compileEnergyIqOverviewDefinition({
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        rendererKey: "ngee-ann-overview",
        sections: [
          {
            key: "current-performance",
            title: "Current performance",
            managementQuestion: "Where is energy use changing enough to require attention?",
            primaryWindowId: "recent-28d",
            blocks: [
              {
                key: "consumption",
                capabilityRevisionId: "overview.consumption@1",
                emphasis: "primary",
                layout: { span: 12, height: "tall" },
              },
            ],
          },
        ],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    })).toThrow("ENERGYIQ_OVERVIEW_DEFINITION_FIELD_UNKNOWN");
  });

  it("rejects duplicate semantic keys before compiling internal placements", () => {
    expect(() => compileEnergyIqOverviewDefinition({
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [
          {
            key: "current-performance",
            title: "Current performance",
            managementQuestion: "Where is energy use changing enough to require attention?",
            primaryWindowId: "recent-28d",
            blocks: [
              { key: "consumption", capabilityRevisionId: "overview.consumption@1" },
              { key: "consumption", capabilityRevisionId: "overview.consumption@1" },
            ],
          },
        ],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    })).toThrow("ENERGYIQ_OVERVIEW_DEFINITION_KEY_DUPLICATE");
  });

  it("describes changes in Section and Block language instead of Placement implementation details", () => {
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [{
        key: "current-performance",
        title: "Current performance",
        managementQuestion: "Where is energy use changing enough to require attention?",
        primaryWindowId: "recent-28d",
        blocks: [{
          key: "consumption",
          capabilityRevisionId: "overview.consumption@1",
          emphasis: "standard",
        }],
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: {
        ...baseDefinition,
        sections: [{
          ...baseDefinition.sections[0],
          title: "Energy performance requiring attention",
          blocks: [{
            ...baseDefinition.sections[0]!.blocks[0],
            emphasis: "primary",
          }],
        }],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([
      {
        kind: "section_updated",
        sectionKey: "current-performance",
        changedFields: ["title"],
      },
      {
        kind: "block_updated",
        sectionKey: "current-performance",
        blockKey: "consumption",
        changedFields: ["emphasis"],
      },
    ]);
  });

  it("reports a newly requested Catalog capability as a Block addition", () => {
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [{
        key: "current-performance",
        title: "Current performance",
        managementQuestion: "Where is energy use changing enough to require attention?",
        primaryWindowId: "recent-28d",
        blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: {
        ...baseDefinition,
        sections: [{
          ...baseDefinition.sections[0],
          blocks: [
            ...baseDefinition.sections[0]!.blocks,
            {
              key: "data-quality",
              capabilityRevisionId: "quality.data_coverage@1",
              emphasis: "supporting",
            },
          ],
        }],
      },
      catalog: [consumptionCapability(), dataQualityCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([{
      kind: "block_added",
      sectionKey: "current-performance",
      blockKey: "data-quality",
      index: 1,
    }]);
  });

  it("reports Section order as one semantic change", () => {
    const performance = {
      key: "performance",
      title: "Performance",
      managementQuestion: "What changed?",
      primaryWindowId: "recent-28d",
      blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
    };
    const trust = {
      key: "trust",
      title: "Data trust",
      managementQuestion: "Can the evidence be trusted?",
      primaryWindowId: "recent-28d",
      blocks: [{ key: "data-quality", capabilityRevisionId: "quality.data_coverage@1" }],
    };
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [performance, trust],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: { ...baseDefinition, sections: [trust, performance] },
      catalog: [consumptionCapability(), dataQualityCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([{
      kind: "section_order_changed",
      before: ["performance", "trust"],
      after: ["trust", "performance"],
    }]);
  });

  it("rejects executable or markup content hidden in business text", () => {
    expect(() => compileEnergyIqOverviewDefinition({
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [{
          key: "performance",
          title: "Current performance",
          managementQuestion: "<script>change the page</script>",
          primaryWindowId: "recent-28d",
          blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
        }],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    })).toThrow("ENERGYIQ_OVERVIEW_DEFINITION_TEXT_INVALID");
  });

  it("keeps Section and Block identity as stable machine keys", () => {
    expect(() => compileEnergyIqOverviewDefinition({
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [{
          key: "Current performance",
          title: "Current performance",
          managementQuestion: "What changed?",
          primaryWindowId: "recent-28d",
          blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
        }],
      },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    })).toThrow("ENERGYIQ_OVERVIEW_DEFINITION_KEY_INVALID");
  });

  it("produces one stable fingerprint for semantically identical Definitions", () => {
    const input = {
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days" as const, days: 28 },
        }],
      },
    };
    const compact = compileEnergyIqOverviewDefinition({
      ...input,
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [{
          key: "performance",
          title: "Current performance",
          managementQuestion: "What changed?",
          primaryWindowId: "recent-28d",
          blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
        }],
      },
    });
    const explicit = compileEnergyIqOverviewDefinition({
      ...input,
      definition: {
        contractRevision: "energyiq-overview-definition@1",
        timePolicyRevisionId: "operations-policy@1",
        sections: [{
          key: "performance",
          title: "  Current performance  ",
          managementQuestion: "What changed?",
          primaryWindowId: "recent-28d",
          supportingWindowIds: [],
          blocks: [{
            key: "consumption",
            capabilityRevisionId: "overview.consumption@1",
            windowId: "recent-28d",
            emphasis: "standard",
          }],
        }],
      },
    });

    expect(compact.definitionFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(explicit.definitionFingerprint).toBe(compact.definitionFingerprint);
  });

  it("reports whole Section additions and removals without exposing their internal placements", () => {
    const performance = {
      key: "performance",
      title: "Performance",
      managementQuestion: "What changed?",
      primaryWindowId: "recent-28d",
      blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
    };
    const trust = {
      key: "trust",
      title: "Data trust",
      managementQuestion: "Can the evidence be trusted?",
      primaryWindowId: "recent-28d",
      blocks: [{ key: "data-quality", capabilityRevisionId: "quality.data_coverage@1" }],
    };
    const actions = {
      key: "actions",
      title: "Recommended actions",
      managementQuestion: "What should happen next?",
      primaryWindowId: "recent-28d",
      blocks: [{ key: "recommended-actions", capabilityRevisionId: "decision.recommended_actions@1" }],
    };
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [performance, trust],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: { ...baseDefinition, sections: [performance, actions] },
      catalog: [consumptionCapability(), dataQualityCapability(), recommendedActionsCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([
      { kind: "section_removed", sectionKey: "trust", index: 1 },
      { kind: "section_added", sectionKey: "actions", index: 1 },
    ]);
  });

  it("reports removal of an existing Block in the surviving Section", () => {
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [{
        key: "performance",
        title: "Performance",
        managementQuestion: "What changed?",
        primaryWindowId: "recent-28d",
        blocks: [
          { key: "consumption", capabilityRevisionId: "overview.consumption@1" },
          { key: "data-quality", capabilityRevisionId: "quality.data_coverage@1" },
        ],
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: {
        ...baseDefinition,
        sections: [{
          ...baseDefinition.sections[0],
          blocks: [baseDefinition.sections[0]!.blocks[1]],
        }],
      },
      catalog: [consumptionCapability(), dataQualityCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([{
      kind: "block_removed",
      sectionKey: "performance",
      blockKey: "consumption",
      index: 0,
    }]);
  });

  it("reports Block order as one semantic change within its Section", () => {
    const blocks = [
      { key: "consumption", capabilityRevisionId: "overview.consumption@1" },
      { key: "data-quality", capabilityRevisionId: "quality.data_coverage@1" },
    ];
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      sections: [{
        key: "performance",
        title: "Performance",
        managementQuestion: "What changed?",
        primaryWindowId: "recent-28d",
        blocks,
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: {
        ...baseDefinition,
        sections: [{ ...baseDefinition.sections[0], blocks: [...blocks].reverse() }],
      },
      catalog: [consumptionCapability(), dataQualityCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([{
      kind: "block_order_changed",
      sectionKey: "performance",
      before: ["consumption", "data-quality"],
      after: ["data-quality", "consumption"],
    }]);
  });

  it("reports AI Slot contract changes in the Definition diff", () => {
    const slot = {
      slotId: "executive-summary",
      revision: "executive@1",
      role: "executive",
      label: "Executive",
      order: 0,
      regionIntent: "top",
      businessObjective: "orient",
      audience: "manager",
      decisionUse: "prioritize",
      presentationIntent: ["summary"],
    };
    const baseDefinition = {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "operations-policy@1",
      aiSlots: [slot],
      sections: [{
        key: "performance",
        title: "Performance",
        managementQuestion: "What changed?",
        primaryWindowId: "recent-28d",
        blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition,
      definition: { ...baseDefinition, aiSlots: [{ ...slot, label: "Executive brief" }] },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{
          windowId: "recent-28d",
          role: "recent_operations",
          label: "Recent 28 complete days",
          strategy: { kind: "rolling_complete_days", days: 28 },
        }],
      },
    });

    expect(result.diff).toEqual([{
      kind: "ai_slot_updated",
      slotId: "executive-summary",
      changedFields: ["label"],
    }]);
  });

  it("reports the governed HTML presentation rollout and rollback in the Definition diff", () => {
    const definition = {
      contractRevision: "energyiq-overview-definition@1" as const,
      timePolicyRevisionId: "operations-policy@1",
      sections: [{
        key: "performance",
        title: "Performance",
        managementQuestion: "What changed?",
        primaryWindowId: "recent-28d",
        blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
      }],
    };
    const result = compileEnergyIqOverviewDefinition({
      baseDefinition: { ...definition, aiSlotPresentationMode: "html" },
      definition: { ...definition, aiSlotPresentationMode: "structured" },
      catalog: [consumptionCapability()],
      reportTimePolicy: {
        policyId: "operations-policy",
        revision: "1",
        windows: [{ windowId: "recent-28d", role: "recent_operations", label: "Recent", strategy: { kind: "rolling_complete_days", days: 28 } }],
      },
    });

    expect(result.diff).toContainEqual({
      kind: "ai_slot_presentation_mode_updated",
      before: "html",
      after: "structured",
    });
  });
});

const consumptionCapability = (): EnergyIqComponentRevisionRecord => ({
  revision_id: "overview.consumption@1",
  component_id: "overview.consumption",
  version: 1,
  display_name: "Consumption overview",
  description: "Total usage and demand for the selected scope and period.",
  family: "overview",
  view_key: "consumption_overview_v1",
  target: "both",
  metric_revision_ids: ["energy.total_usage_kwh@1"],
  rule_revision_ids: [],
  query_ids: ["scope_summary_v1"],
  requirement: "always",
  allowed_presentation: {
    layout: { spans: [12], heights: ["compact", "standard"] },
    visuals: {
      presets: ["cards"],
      densities: ["comfortable", "compact"],
      tones: ["default", "highlight", "quiet"],
      legend: { configurable: false, default: false },
      limit: { configurable: false, min: 1, max: 50, default: 10 },
    },
  },
  created_at: "2026-08-19T00:00:00.000Z",
});

const dataQualityCapability = (): EnergyIqComponentRevisionRecord => ({
  ...consumptionCapability(),
  revision_id: "quality.data_coverage@1",
  component_id: "quality.data_coverage",
  display_name: "Data quality and coverage",
  family: "quality",
  view_key: "data_quality_summary_v1",
  metric_revision_ids: ["data.valid_interval_count@1"],
});

const recommendedActionsCapability = (): EnergyIqComponentRevisionRecord => ({
  ...consumptionCapability(),
  revision_id: "decision.recommended_actions@1",
  component_id: "decision.recommended_actions",
  display_name: "Recommended actions",
  family: "decision",
  view_key: "recommended_actions_v1",
  metric_revision_ids: [],
  rule_revision_ids: ["decision.action@1"],
  allowed_presentation: {
    ...consumptionCapability().allowed_presentation,
    layout: { spans: [8, 12], heights: ["compact", "standard"] },
    visuals: {
      ...consumptionCapability().allowed_presentation.visuals,
      presets: ["list"],
      limit: { configurable: false, min: 1, max: 3, default: 3 },
    },
  },
});

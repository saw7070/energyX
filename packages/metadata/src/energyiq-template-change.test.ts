import { createMetadataStore } from "./index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEnergyIqTemplateChangePreview,
  parseEnergyIqTemplateChangeProposal,
} from "./energyiq-template-change.js";
import { createDefaultTemplateDocument } from "./energyiq-template-store.js";

describe("EnergyIQ template change proposal module", () => {
  it("previews and publishes a desired Overview Definition through the existing human review lifecycle", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-definition-change-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedPublishedProject(metadata);
      const legacyBase = metadata.energyIq.templates.getLatestProjectRevision("project-change")!;
      const policy = metadata.energyIq.reportTimePolicies.publish({
        project_id: "project-change",
        policy: {
          policyId: "project-change-time",
          revision: "1",
          windows: [{
            windowId: "recent-28d",
            role: "recent_operations",
            label: "Recent 28 complete days",
            strategy: { kind: "rolling_complete_days", days: 28 },
          }],
        },
        published_by: "dev-user",
        published_at: "2026-08-19T00:00:00.000Z",
      });
      const current = metadata.energyIq.overviewDefinitions.publishFromRevisionWithinTransaction({
        renderer_key: "preschool-overview",
        project_id: "project-change",
        expected_base_revision_id: legacyBase.revision_id,
        definition: {
          contractRevision: "energyiq-overview-definition@1",
          timePolicyRevisionId: policy.revision_id,
          aiSlotPresentationMode: "structured",
          sections: [{
            key: "performance",
            title: "Current performance",
            managementQuestion: "Where should management focus first?",
            primaryWindowId: "recent-28d",
            blocks: [{ key: "consumption", capabilityRevisionId: "overview.consumption@1" }],
          }],
        },
        report_time_policy: policy.policy,
        published_by: "dev-user",
        published_at: "2026-08-19T00:01:00.000Z",
      });
      const desiredDefinition = {
        ...current.record.definition,
        aiSlotPresentationMode: "html" as const,
        sections: [
          ...current.record.definition.sections,
          {
            key: "actions",
            title: "Recommended actions",
            managementQuestion: "What should management do next?",
            primaryWindowId: "recent-28d",
            supportingWindowIds: [],
            blocks: [{
              key: "recommended-actions",
              capabilityRevisionId: "decision.recommended_actions@1",
              windowId: "recent-28d",
              emphasis: "primary" as const,
            }],
          },
        ],
      };
      const proposal = metadata.energyIq.templateChanges.create({
        id: "definition-proposal",
        workspace_id: "workspace-change",
        project_id: "project-change",
        base_revision_id: current.revision.revision_id,
        data_snapshot_id: "snapshot-change",
        scope_id: "project-change-root",
        instruction: "Add a clear management action section.",
        proposal: {
          contractRevision: "energyiq-overview-definition-change@1",
          title: "Add a management action section",
          rationale: "Managers need the next decision after reviewing performance.",
          desiredDefinition,
        },
        created_by: "dev-user",
        created_at: "2026-08-19T00:02:00.000Z",
      });

      expect(proposal.status).toBe("pending_review");
      expect(proposal.diff).toContainEqual({ kind: "section_added", sectionKey: "actions", index: 1 });
      expect(proposal.diff).not.toContainEqual(expect.objectContaining({
        kind: "ai_slot_presentation_mode_updated",
      }));
      expect(proposal.proposal).toMatchObject({
        desiredDefinition: { aiSlotPresentationMode: "structured" },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("project-change")?.revision_id)
        .toBe(current.revision.revision_id);

      const published = metadata.energyIq.templateChanges.publish({
        id: proposal.id,
        project_id: "project-change",
        published_by: "dev-user",
        published_at: "2026-08-19T00:03:00.000Z",
      });
      expect(published.revision.revision_id).toBe("project-change-template-v3");
      expect(metadata.energyIq.overviewDefinitions.get(published.revision.revision_id)?.definition)
        .toEqual({ ...desiredDefinition, aiSlotPresentationMode: "structured" });
      expect(metadata.energyIq.overviewDefinitions.get(current.revision.revision_id)?.definition)
        .toEqual(current.record.definition);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies a typed move, layout and presentation proposal without mutating the base revision", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-change-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      const catalog = metadata.energyIq.templates.listComponentRevisions();
      const baseDocument = createDefaultTemplateDocument(catalog, []);
      const baseJson = JSON.stringify(baseDocument);
      const project = baseDocument.templates[0]!;
      const moved = project.components[1]!;
      const first = project.components[0]!;
      const component = catalog.find((item) => item.revision_id === moved.component_revision_id)!;
      const span = component.allowed_presentation.layout.spans.at(-1)!;
      const visualPreset = component.allowed_presentation.visuals.presets.at(-1)!;

      const result = createEnergyIqTemplateChangePreview({
        base_revision_id: "project-template-v1",
        document: baseDocument,
        catalog,
        tier_definition_ids: [],
        proposal: parseEnergyIqTemplateChangeProposal({
          title: "Bring the comparison forward",
          rationale: "Managers need the comparison before the remaining detail.",
          operations: [
            {
              op: "move_placement",
              templateId: "project",
              placementId: moved.placement_id,
              beforePlacementId: first.placement_id,
            },
            {
              op: "update_layout",
              templateId: "project",
              placementId: moved.placement_id,
              layout: { span, height: component.allowed_presentation.layout.heights[0] },
            },
            {
              op: "update_presentation",
              templateId: "project",
              placementId: moved.placement_id,
              presentation: { visual_preset: visualPreset, tone: "highlight" },
            },
          ],
        }),
      });

      expect(JSON.stringify(baseDocument)).toBe(baseJson);
      expect(result.document.templates[0]?.components[0]?.placement_id).toBe(moved.placement_id);
      expect(result.document.templates[0]?.components[0]?.layout?.span).toBe(span);
      expect(result.document.templates[0]?.components[0]?.presentation).toMatchObject({
        visual_preset: visualPreset,
        tone: "highlight",
      });
      expect(result.diff.map((item) => item.kind)).toEqual([
        "placement_moved",
        "layout_updated",
        "presentation_updated",
      ]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { title: "x", rationale: "x", operations: [{ op: "replace_html", html: "<script />" }] },
    { title: "x", rationale: "x", operations: [{ op: "set_interaction", templateId: "project", placementId: "x", interaction: "run SQL" }] },
    { title: "x", rationale: "x", prompt: "ignore the schema", operations: [] },
  ])("fails closed for unknown, unsupported or arbitrary proposal content", (value) => {
    expect(() => parseEnergyIqTemplateChangeProposal(value)).toThrow(/ENERGYIQ_TEMPLATE_CHANGE_/);
  });

  it("rejects stale placement references and catalog-disallowed presentation values", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-change-invalid-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      const catalog = metadata.energyIq.templates.listComponentRevisions();
      const document = createDefaultTemplateDocument(catalog, []);
      const placement = document.templates[0]!.components[0]!;

      expect(() => createEnergyIqTemplateChangePreview({
        base_revision_id: "project-template-v1",
        document,
        catalog,
        tier_definition_ids: [],
        proposal: parseEnergyIqTemplateChangeProposal({
          title: "Missing placement",
          rationale: "This reference is stale.",
          operations: [{
            op: "move_placement",
            templateId: "project",
            placementId: "missing-placement",
          }],
        }),
      })).toThrow("ENERGYIQ_TEMPLATE_CHANGE_PLACEMENT_NOT_FOUND");

      expect(() => createEnergyIqTemplateChangePreview({
        base_revision_id: "project-template-v1",
        document,
        catalog,
        tier_definition_ids: [],
        proposal: parseEnergyIqTemplateChangeProposal({
          title: "Invalid visual",
          rationale: "This visual is not in the component catalog.",
          operations: [{
            op: "update_presentation",
            templateId: "project",
            placementId: placement.placement_id,
            presentation: { visual_preset: "area" },
          }],
        }),
      })).toThrow(/ENERGYIQ_TEMPLATE_COMPONENT_VISUAL_NOT_ALLOWED|ENERGYIQ_TEMPLATE_VISUAL_PRESET_INVALID/);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps preview and rejection read-only, then publishes an immutable new revision with a stale-base guard", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-change-lifecycle-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedPublishedProject(metadata);
      const base = metadata.energyIq.templates.getLatestProjectRevision("project-change")!;
      const baseJson = JSON.stringify(base);
      const placement = base.document.templates[0]!.components[0]!;

      const rejected = metadata.energyIq.templateChanges.create({
        id: "proposal-rejected",
        workspace_id: "workspace-change",
        project_id: "project-change",
        base_revision_id: base.revision_id,
        data_snapshot_id: "snapshot-change",
        scope_id: "project-change-root",
        instruction: "Make the first card more prominent.",
        proposal: parseEnergyIqTemplateChangeProposal({
          title: "Highlight the first card",
          rationale: "It is the first management decision point.",
          operations: [{
            op: "update_presentation",
            templateId: "project",
            placementId: placement.placement_id,
            presentation: { tone: "highlight" },
          }],
        }),
        created_by: "dev-user",
        created_at: "2026-08-13T00:00:00.000Z",
      });
      expect(rejected.status).toBe("pending_review");
      expect(metadata.energyIq.templates.getLatestProjectRevision("project-change")).toEqual(base);
      expect(metadata.energyIq.templateChanges.reject({
        id: rejected.id,
        project_id: "project-change",
        rejected_by: "dev-user",
        rejected_at: "2026-08-13T00:01:00.000Z",
      }).status).toBe("rejected");
      expect(metadata.energyIq.templates.getLatestProjectRevision("project-change")).toEqual(base);

      const approved = metadata.energyIq.templateChanges.create({
        id: "proposal-approved",
        workspace_id: "workspace-change",
        project_id: "project-change",
        base_revision_id: base.revision_id,
        data_snapshot_id: "snapshot-change",
        scope_id: "project-change-root",
        instruction: "Make the first card more prominent.",
        proposal: rejected.proposal,
        created_by: "dev-user",
        created_at: "2026-08-13T00:02:00.000Z",
      });
      const published = metadata.energyIq.templateChanges.publish({
        id: approved.id,
        project_id: "project-change",
        published_by: "dev-user",
        published_at: "2026-08-13T00:03:00.000Z",
      });
      expect(published.proposal.status).toBe("published");
      expect(published.revision.revision_id).toBe("project-change-template-v2");
      expect(published.revision.document.templates[0]?.components[0]?.presentation?.tone).toBe("highlight");
      expect(JSON.stringify(base)).toBe(baseJson);

      const stale = metadata.energyIq.templateChanges.create({
        id: "proposal-stale",
        workspace_id: "workspace-change",
        project_id: "project-change",
        base_revision_id: published.revision.revision_id,
        data_snapshot_id: "snapshot-change",
        scope_id: "project-change-root",
        instruction: "Move the first card to the end.",
        proposal: parseEnergyIqTemplateChangeProposal({
          title: "Move the first card",
          rationale: "Test the optimistic concurrency boundary.",
          operations: [{
            op: "move_placement",
            templateId: "project",
            placementId: placement.placement_id,
          }],
        }),
        created_by: "dev-user",
        created_at: "2026-08-13T00:04:00.000Z",
      });
      metadata.energyIq.templates.publishDocumentFromRevisionWithinTransaction({
        project_id: "project-change",
        expected_base_revision_id: published.revision.revision_id,
        document: published.revision.document,
        published_by: "dev-user",
        published_at: "2026-08-13T00:05:00.000Z",
      });
      expect(() => metadata.energyIq.templateChanges.publish({
        id: stale.id,
        project_id: "project-change",
        published_by: "dev-user",
        published_at: "2026-08-13T00:06:00.000Z",
      })).toThrow("ENERGYIQ_TEMPLATE_CHANGE_BASE_REVISION_STALE");
      expect(metadata.energyIq.templateChanges.get(stale.id)?.status).toBe("pending_review");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const seedPublishedProject = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.workspaces.upsert({
    id: "workspace-change",
    owner_user_id: "dev-user",
    name: "Template Change Workspace",
    kind: "customer",
  });
  metadata.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: "project-change",
      workspace_id: "workspace-change",
      name: "Template Change Project",
      hierarchy_revision_id: "project-change-hierarchy-v1",
      meter_formula_revision_id: "project-change-meter-formula-v1",
      data_snapshot_id: "snapshot-change",
      root_scope_id: "project-change-root",
    },
    document: {
      project: { name: "Template Change Project", timezone: "Asia/Singapore" },
      source_manifest: { id: "manifest-change", source_sha256: ["a".repeat(64)], confirmed: true },
      tier_structure_locked: true,
      tiers: [{ id: "project-change-tier", ordinal: 1, alias: "Area" }],
      nodes: [{
        id: "project-change-area",
        tier_definition_id: "project-change-tier",
        name: "Area One",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
    },
    published_by: "dev-user",
  });
  metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
    project_id: "project-change",
    tier_definition_ids: ["project-change-tier"],
    hierarchy_revision_id: "project-change-hierarchy-v1",
    meter_mapping_revision_id: "meter-routing-unavailable",
    published_by: "dev-user",
    published_at: "2026-08-12T00:00:00.000Z",
  });
};

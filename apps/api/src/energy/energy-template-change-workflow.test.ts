import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { createEnergyIqTemplateChangeWorkflow } from "./energy-template-change-workflow.js";

describe("EnergyIQ template change model workflow", () => {
  it("pins the proposal to the current Snapshot and Release and accepts only the typed value output", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-workflow-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const revision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      metadata.energyIq.reportTimePolicies.publish({
        project_id: project.id,
        policy: {
          policyId: "preschool-overview-time",
          revision: "1",
          windows: [{
            windowId: "recent-28d",
            role: "recent_operations",
            label: "Recent 28 complete days",
            strategy: { kind: "rolling_complete_days", days: 28 },
          }],
        },
        published_by: "dev-user",
        published_at: "2026-08-13T00:01:00.000Z",
      });
      const current = metadata.energyIq.overviewDefinitions.publishFromRevisionWithinTransaction({
        renderer_key: "preschool-overview",
        project_id: project.id,
        expected_base_revision_id: revision.revision_id,
        definition: {
          contractRevision: "energyiq-overview-definition@1",
          timePolicyRevisionId: "preschool-overview-time@1",
          sections: [{
            key: "current-performance",
            title: "Current performance",
            managementQuestion: "Where should management focus first?",
            primaryWindowId: "recent-28d",
            blocks: [{
              key: "consumption",
              capabilityRevisionId: "overview.consumption@1",
            }],
          }],
        },
        report_time_policy: metadata.energyIq.reportTimePolicies.get(project.id, "preschool-overview-time@1")!.policy,
        published_by: "dev-user",
        published_at: "2026-08-13T00:02:00.000Z",
      });
      const identity = {
        workspaceId: project.workspace_id,
        projectId: project.id,
        scopeId: project.root_scope_id,
        resource: "electricity" as const,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: current.revision.revision_id,
        analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
        analysisPeriodTo: "2026-05-31T16:00:00.000Z",
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        analysisPackId: "preschool-analysis-pack",
        analysisPackRevision: "v1",
        modelProfileId: "workspace-default",
        modelProfileRevision: 1,
        outputContractRevision: "v1",
        validatorRevision: "v1",
        workflowRevision: "v1",
        investigatorPromptRevision: "v1",
        editorPromptRevision: "v1",
        methodSkillId: "none",
        methodSkillRevision: "v1",
        artifactKind: "section-interpretation" as const,
        targetId: "template-proposal",
      };
      const resolveIdentity = vi.fn(async () => identity);
      const runProposal = vi.fn(async (input: { prompt: string; runId: string; sessionId: string }) => ({
        answer: JSON.stringify({
          contractRevision: "energyiq-overview-definition-change@1",
          title: "Add a planning section",
          rationale: "Managers need a separate forward-looking decision point.",
          desiredDefinition: {
            ...current.record.definition,
            sections: [
              ...current.record.definition.sections,
              {
                key: "planning",
                title: "Planning outlook",
                managementQuestion: "What should management prepare for next?",
                primaryWindowId: "recent-28d",
                supportingWindowIds: [],
                blocks: [{
                  key: "planning-summary",
                  capabilityRevisionId: "decision.executive_actions@1",
                  windowId: "recent-28d",
                  emphasis: "standard",
                }],
              },
            ],
          },
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }));
      const workflow = createEnergyIqTemplateChangeWorkflow({ metadataStore: metadata, resolveIdentity, runProposal });
      const result = await workflow.propose({
        projectId: project.id,
        scopeId: project.root_scope_id,
        instruction: "Move the planning summary to the end.",
        user: metadata.users.getById({ user_id: "dev-user" }),
      });

      expect(result.identity).toBe(identity);
      expect(result.proposal.desiredDefinition.sections.at(-1)?.key).toBe("planning");
      const prompt = JSON.parse(runProposal.mock.calls[0]![0].prompt) as Record<string, unknown>;
      expect(prompt).toMatchObject({
        fixed_identity: {
          dataSnapshotId: project.data_snapshot_id,
          projectReleaseId: current.revision.revision_id,
        },
        administrator_request: "Move the planning summary to the end.",
        current_overview_definition: current.record.definition,
      });
      expect(JSON.stringify(prompt)).not.toMatch(/placementId|rendererKey|span|height|operation_contract/u);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

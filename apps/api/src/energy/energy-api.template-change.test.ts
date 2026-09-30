import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { selectEnergyCurrentOverviewPeriod } from "./energy-analysis.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { PRESCHOOL_HTML_AI_SLOT_IDS } from "./preschool-html-ai-slot.js";

describe("EnergyIQ template change API", () => {
  it("keeps proposal and preview read-only until an administrator publishes a new immutable revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-template-change-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const base = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      const policy = metadata.energyIq.reportTimePolicies.publish({
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
        expected_base_revision_id: base.revision_id,
        definition: {
          contractRevision: "energyiq-overview-definition@1",
          timePolicyRevisionId: policy.revision_id,
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
        published_at: "2026-08-13T00:02:00.000Z",
      });
      const desiredDefinition = {
        ...current.record.definition,
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
      const templateChangeWorkflow = {
        propose: vi.fn(async () => ({
          proposal: {
            contractRevision: "energyiq-overview-definition-change@1" as const,
            title: "Add recommended actions",
            rationale: "Managers need a clear next decision after reviewing performance.",
            desiredDefinition,
          },
          identity: {
            workspaceId: project.workspace_id,
            projectId: project.id,
            scopeId: project.root_scope_id,
            dataSnapshotId: project.data_snapshot_id,
            projectReleaseId: current.revision.revision_id,
          },
          runId: "template-proposal-run",
          sessionId: "template-proposal-session",
        })),
      };
      const htmlIdentity = {
        workspaceId: project.workspace_id,
        projectId: project.id,
        scopeId: project.root_scope_id,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: "preschool-demo-template-v4",
        analysisPeriod: { from: "2026-06-01", to: "2026-06-30" },
        modelProfileId: "deepseek-v4-flash",
        modelProfileRevision: 1,
      };
      const htmlSlotReadModel = {
        artifactKind: "preschool-html-ai-slot-read-model" as const,
        status: "available" as const,
        binding: {
          ...htmlIdentity,
          promptRevision: "preschool-html-ai-slot-prompt@1",
          slotDefinitionRevisions: Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, "1"])),
          allowedEvidenceRefsBySlot: Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, []])),
        },
        slots: Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, {
          status: "available" as const,
          artifactId: `html-artifact-${slotId}`,
          runId: `run-${slotId}`,
          sessionId: `session-${slotId}`,
          artifact: {
            contract: "energyiq-ai-slot-html-artifact@1" as const,
            slotId,
            identity: {
              ...htmlIdentity,
              promptRevision: "preschool-html-ai-slot-prompt@1",
              slotDefinitionRevision: "1",
            },
            evidenceRefs: [],
            accessibleText: `Accepted ${slotId}`,
            html: `<p>Accepted ${slotId}</p>`,
          },
          acceptance: { status: "accepted" as const, droppedClaims: [] },
          generation: { latencyMs: 1, htmlSha256: `sha-${slotId}` },
        }])),
      };
      const generateHtmlSlots = vi.fn().mockRejectedValue(new Error("PROVIDER_MUST_NOT_RUN_DURING_SWITCH"));
      const readHtmlSlots = vi.fn().mockResolvedValue(htmlSlotReadModel);
      const resolveCurrentHtmlIdentity = vi.fn().mockResolvedValue(htmlIdentity);
      const resolveReadHtmlIdentity = vi.fn().mockResolvedValue(htmlIdentity);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        templateChangeWorkflow,
        preschoolHtmlAiSlotWorkflow: {
          execute: generateHtmlSlots,
          read: readHtmlSlots,
          resolveCurrentIdentity: resolveCurrentHtmlIdentity,
          resolveReadIdentity: resolveReadHtmlIdentity,
        },
      } as unknown as Required<ConfigApiContext>;

      const proposalResponse = await handleEnergyApiRequest(
        jsonRequest("POST", {
          instruction: "Make the first decision card more prominent.",
          scopeId: project.root_scope_id,
        }),
        ["projects", project.id, "template-change-proposals"],
        context,
      );
      expect(proposalResponse).toMatchObject({
        status: 201,
        body: { success: true, data: { proposal: { status: "pending_review", base_revision_id: current.revision.revision_id } } },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(current.revision);
      const proposalId = ((proposalResponse.body as { data: { proposal: { id: string } } }).data.proposal.id);

      const previewResponse = await handleEnergyApiRequest(
        jsonRequest("GET"),
        ["projects", project.id, "template-change-proposals", proposalId, "preview"],
        context,
      );
      expect(previewResponse).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            fixedIdentity: {
              dataSnapshotId: project.data_snapshot_id,
              projectReleaseId: current.revision.revision_id,
            },
            proposal: { diff: [{ kind: "section_added", sectionKey: "actions" }] },
          },
        },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(current.revision);

      metadata.users.upsertDevUser({
        id: "template-viewer",
        email: "template-viewer@example.test",
        display_name: "Template Viewer",
        dev_token: "template-viewer-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "template-viewer",
        role: "member",
      });
      metadata.energyIq.upsertUserRole({ user_id: "template-viewer", role: "user" });
      metadata.energyIq.upsertProjectAccess({
        project_id: project.id,
        user_id: "template-viewer",
        role: "viewer",
      });
      const forbidden = await handleEnergyApiRequest(
        jsonRequest("POST", {}),
        ["projects", project.id, "template-change-proposals", proposalId, "publish"],
        { ...context, userId: "template-viewer" },
      );
      expect(forbidden.status).toBe(403);
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(current.revision);
      const forbiddenPresentation = await handleEnergyApiRequest(
        jsonRequest("POST", { mode: "html" }),
        ["projects", project.id, "ai-slot-presentation"],
        { ...context, userId: "template-viewer" },
      );
      expect(forbiddenPresentation.status).toBe(403);
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(current.revision);

      const published = await handleEnergyApiRequest(
        jsonRequest("POST", {}),
        ["projects", project.id, "template-change-proposals", proposalId, "publish"],
        context,
      );
      expect(published).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            proposal: { status: "published" },
            revision: { revision_id: "preschool-demo-template-v3" },
          },
        },
      });
      expect(metadata.energyIq.templates.getProjectRevision(current.revision.revision_id)).toEqual(current.revision);
      expect(metadata.energyIq.overviewDefinitions.get("preschool-demo-template-v3")?.definition)
        .toEqual(desiredDefinition);

      const htmlProjection = {
        changed: true,
        resolution: { status: "ready" },
        contextPackage: {
          identity: htmlIdentity,
          snapshot: { identity: htmlIdentity },
          evidenceRefs: ["evidence:html-release"],
        },
      };
      const materializeOverview = vi.fn().mockRejectedValue(new Error("MATERIALIZATION_MUST_NOT_RUN_DURING_SWITCH"));

      const html = await handleEnergyApiRequest(
        jsonRequest("POST", { mode: "html" }),
        ["projects", project.id, "ai-slot-presentation"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
        },
      );
      expect(html).toMatchObject({
        status: 200,
        body: {
          data: {
            revision: { revision_id: "preschool-demo-template-v4" },
            overviewDefinition: { aiSlotPresentationMode: "html" },
          },
        },
      });
      const htmlData = (html.body as { data: Record<string, unknown> }).data;
      expect(htmlData).not.toHaveProperty("overviewProjection");
      expect(htmlData).not.toHaveProperty("htmlAiSlots");
      expect(materializeOverview).not.toHaveBeenCalled();
      expect(generateHtmlSlots).not.toHaveBeenCalled();

      materializeOverview.mockReset().mockResolvedValue(htmlProjection);
      const explicitProjection = await handleEnergyApiRequest(
        jsonRequest("POST", {}),
        ["projects", project.id, "overview-projection"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
        },
      );
      expect(explicitProjection).toMatchObject({
        status: 201,
        body: { data: { identity: { projectReleaseId: "preschool-demo-template-v4" } } },
      });
      expect(materializeOverview).toHaveBeenCalledTimes(1);

      generateHtmlSlots.mockReset().mockResolvedValue(htmlSlotReadModel);
      const explicitGeneration = await handleEnergyApiRequest(
        jsonRequest("POST", {}),
        ["projects", project.id, "overview-ai-artifact", "html-slots", "ensure"],
        context,
      );
      expect(explicitGeneration).toMatchObject({
        status: 200,
        body: {
          data: {
            status: "available",
            binding: { projectReleaseId: "preschool-demo-template-v4" },
          },
        },
      });
      expect(resolveCurrentHtmlIdentity).toHaveBeenCalledOnce();
      expect(generateHtmlSlots).toHaveBeenCalledWith({
        identity: htmlIdentity,
        user: metadata.users.getById({ user_id: "dev-user" }),
      });
      expect(PRESCHOOL_HTML_AI_SLOT_IDS.every((slotId) => {
        const slot = htmlSlotReadModel.slots[slotId];
        return slot?.status === "available"
          && slot.acceptance?.status === "accepted"
          && slot.artifact?.identity.dataSnapshotId === htmlIdentity.dataSnapshotId
          && slot.artifact.identity.projectReleaseId === htmlIdentity.projectReleaseId;
      })).toBe(true);

      const ordinaryReadRequest = jsonRequest("GET");
      Object.assign(ordinaryReadRequest, {
        url: `/api/v1/energy/projects/${project.id}/overview-ai-artifact/html-slots?scopeId=${project.root_scope_id}&from=2026-06-01&to=2026-06-30&dataSnapshotId=${project.data_snapshot_id}&projectReleaseId=preschool-demo-template-v4`,
      });
      const ordinaryRead = await handleEnergyApiRequest(
        ordinaryReadRequest,
        ["projects", project.id, "overview-ai-artifact", "html-slots"],
        context,
      );
      expect(ordinaryRead).toMatchObject({
        status: 200,
        body: {
          data: {
            status: "available",
            binding: {
              dataSnapshotId: project.data_snapshot_id,
              projectReleaseId: "preschool-demo-template-v4",
            },
          },
        },
      });
      expect(resolveReadHtmlIdentity).toHaveBeenCalledTimes(1);
      expect(readHtmlSlots).toHaveBeenCalledWith({
        identity: htmlIdentity,
        user: metadata.users.getById({ user_id: "dev-user" }),
      });
      expect(generateHtmlSlots).toHaveBeenCalledTimes(1);

      const structured = await handleEnergyApiRequest(
        jsonRequest("POST", { mode: "structured" }),
        ["projects", project.id, "ai-slot-presentation"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
        },
      );
      expect(structured).toMatchObject({
        status: 200,
        body: {
          data: {
            overviewDefinition: { aiSlotPresentationMode: "structured" },
            diff: [{ kind: "ai_slot_presentation_mode_updated", before: "html", after: "structured" }],
          },
        },
      });
      expect(materializeOverview).toHaveBeenCalledTimes(1);
      expect(generateHtmlSlots).toHaveBeenCalledTimes(1);

      const unsupported = await handleEnergyApiRequest(
        jsonRequest("POST", { mode: "html" }),
        ["projects", "ngee-ann-polytechnic", "ai-slot-presentation"],
        { ...context, workspaceId: "default" },
      );
      expect(unsupported).toMatchObject({
        status: 400,
        body: { error: { message: "ENERGYIQ_AI_SLOT_PRESENTATION_UNSUPPORTED" } },
      });
      expect(generateHtmlSlots).toHaveBeenCalledTimes(1);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists nothing when the model workflow fails or returns an invalid proposal", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-template-change-failure-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      const propose = vi.fn(async () => { throw new Error("ENERGYIQ_TEMPLATE_CHANGE_MODEL_OUTPUT_INVALID"); });
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        templateChangeWorkflow: {
          propose,
        },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonRequest("POST", { instruction: "Replace the page with HTML." }),
        ["projects", project.id, "template-change-proposals"],
        context,
      );
      expect(response.status).toBe(400);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(metadata.energyIq.templateChanges.listProject(project.id)).toEqual([]);
      expect(metadata.energyIq.templates.listProjectRevisions(project.id)).toHaveLength(1);

      const oversized = await handleEnergyApiRequest(
        jsonRequest("POST", { instruction: "x".repeat(2_001) }),
        ["projects", project.id, "template-change-proposals"],
        context,
      );
      expect(oversized.status).toBe(400);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(metadata.energyIq.templateChanges.listProject(project.id)).toEqual([]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const jsonRequest = (method: "GET" | "POST", body?: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
  request.end(body === undefined ? undefined : JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

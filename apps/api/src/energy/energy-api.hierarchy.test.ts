import { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  energyIqPublishedMeterRoutingRevisionId,
  type EnergyIqProjectSetupDocument,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy Project hierarchy API", () => {
  it("returns the immutable hierarchy pinned by the latest Project Template Revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-published-hierarchy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const originalProject = metadata.energyIq.getProject(projectId);
      const pinnedHierarchyRevisionId = originalProject.hierarchy_revision_id;
      const pinnedRevision = metadata.energyIq.projectSetup.listHierarchyRevisions(projectId)
        .find((revision) => revision.id === pinnedHierarchyRevisionId);
      if (!pinnedRevision) throw new Error("Pinned hierarchy fixture is missing");
      const pinnedDocument = JSON.parse(pinnedRevision.snapshot_json) as EnergyIqProjectSetupDocument;
      const draft = metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: "dev-user" });
      const seedNode = draft.document.nodes[0];
      if (!seedNode) throw new Error("Hierarchy drift fixture needs one node");
      const savedDraft = metadata.energyIq.projectSetup.saveDraft({
        project_id: projectId,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          ...(draft.document.meter_mapping ? { meter_mapping: { ...draft.document.meter_mapping, rows: draft.document.meter_mapping.rows.map(row => ({ ...row, display_name: "Current drift meter" })) } } : {}),
          tiers: draft.document.tiers.map((tier, index) => index === 0
            ? { ...tier, alias: "Current Drift Tier" }
            : tier),
          nodes: [
            ...draft.document.nodes,
            { ...seedNode, id: "current-drift-node", name: "Current Drift Node", sort_order: 999 },
          ],
        },
      });
      metadata.energyIq.projectSetup.publishDraft({
        project_id: projectId,
        expected_revision: savedDraft.revision,
        user_id: "dev-user",
      });
      const currentProject = metadata.energyIq.getProject(projectId);
      expect(currentProject.hierarchy_revision_id).not.toBe(pinnedHierarchyRevisionId);
      expect(metadata.energyIq.listProjectNodes(projectId).map((node) => node.id))
        .toContain("current-drift-node");

      const pinnedTemplate = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: projectId,
        tier_definition_ids: [...pinnedDocument.tiers]
          .sort((left, right) => right.ordinal - left.ordinal)
          .map((tier) => tier.id),
        hierarchy_revision_id: pinnedHierarchyRevisionId,
        meter_mapping_revision_id: pinnedDocument.meter_mapping
          ? energyIqPublishedMeterRoutingRevisionId(pinnedDocument.meter_mapping)
          : "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-04T12:00:00.000Z",
      });
      expect(pinnedTemplate.hierarchy_revision_id).toBe(pinnedHierarchyRevisionId);

      const response = await handleEnergyApiRequest(
        request(),
        ["projects", projectId, "hierarchy"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const body = response.body as {
        success: true;
        data: {
          project: { id: string; hierarchy_revision_id: string };
          tiers: Array<{ id: string; alias: string }>;
          electricityMeters: Array<{ id: string; name: string; scopeId: string }>;
          nodes: Array<{ id: string; parent_id?: string; hierarchy_revision_id?: string }>;
        };
      };
      expect(body.data.project).toMatchObject({
        id: projectId,
        hierarchy_revision_id: pinnedHierarchyRevisionId,
      });
      expect(body.data.tiers).toEqual(pinnedDocument.tiers);
      expect(body.data.electricityMeters.length).toBeGreaterThan(0);
      expect(body.data.electricityMeters.map(meter => meter.name)).not.toContain("Current drift meter");
      for (const row of pinnedDocument.meter_mapping!.rows) expect(body.data.electricityMeters).toContainEqual(expect.objectContaining({ id: row.id, name: row.display_name, scopeId: row.navigation_scope_id ?? row.scope_id }));
      expect(body.data.nodes).toContainEqual(expect.objectContaining({
        id: originalProject.root_scope_id,
        hierarchy_revision_id: pinnedHierarchyRevisionId,
      }));
      expect(body.data.nodes.map((node) => node.id)).not.toContain("current-drift-node");
      expect(body.data.nodes.every((node) => node.hierarchy_revision_id === pinnedHierarchyRevisionId))
        .toBe(true);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("falls back to the Project hierarchy revision when no Template Revision exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-legacy-hierarchy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const project = metadata.energyIq.getProject(projectId);
      // Bootstrap now publishes a template; explicitly exercise the no-template fallback.
      vi.spyOn(metadata.energyIq.templates, "getLatestProjectRevision").mockReturnValue(null);
      const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(projectId)
        .find((candidate) => candidate.id === project.hierarchy_revision_id);
      if (!revision) throw new Error("Legacy hierarchy fixture is missing");
      const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;

      const response = await handleEnergyApiRequest(
        request(),
        ["projects", projectId, "hierarchy"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const body = response.body as {
        success: true;
        data: {
          project: { hierarchy_revision_id: string };
          tiers: Array<{ id: string; alias: string }>;
          electricityMeters: Array<{ id: string; name: string; scopeId: string }>;
          nodes: Array<{ id: string; hierarchy_revision_id?: string }>;
        };
      };
      expect(body.data.project.hierarchy_revision_id).toBe(project.hierarchy_revision_id);
      expect(body.data.tiers).toEqual(document.tiers);
      expect(body.data.nodes).toContainEqual(expect.objectContaining({
        id: project.root_scope_id,
        hierarchy_revision_id: project.hierarchy_revision_id,
      }));
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects a customer user whose active Organisation cannot access the Project", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-hierarchy-access-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "preschool-fm",
        email: "preschool-fm@example.com",
        display_name: "Preschool FM",
        dev_token: "preschool-fm-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "preschool-fm",
        role: "member",
      });

      const response = await handleEnergyApiRequest(
        request(),
        ["projects", "ngee-ann-polytechnic", "hierarchy"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "preschool-fm",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
      );
      expect(response).toMatchObject({
        status: 403,
        body: {
          success: false,
          error: { code: "FORBIDDEN", message: "ENERGYIQ_PROJECT_FORBIDDEN" },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const request = (): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, { method: "GET", headers: {} });
  stream.end();
  return stream as unknown as IncomingMessage;
};

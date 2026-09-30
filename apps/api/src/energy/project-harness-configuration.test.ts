import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { createProjectHarnessConfigurationReader } from "./project-harness-configuration.js";

describe("Project Harness Configuration", () => {
  it("describes exact current resources without promoting run-dependent selection or leaking connection details", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      const project = metadataStore.energyIq.getProject("preschool-demo");

      metadataStore.configResources.upsert({
        id: "system-model",
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "System analysis model",
        payload: {
          provider: "openai-compatible",
          modelName: "model-system",
          baseUrl: "https://provider.internal.example/v1",
          contextLength: 32_768,
          maxTokens: 2_048,
        },
        secret_ref: "secret:model-system",
        default_enabled: true,
        status: "connected",
      });
      metadataStore.workspaceDefaultModelProfiles.set({
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        profile_id: "system-model",
        profile_owner_user_id: user.id,
        configured_by_user_id: user.id,
      });
      metadataStore.configResources.upsert({
        id: "workspace-labelled-skill",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "skill",
        name: "Workspace-labelled investigation",
        description: "A current-user resource whose declared Workspace scope is not storage-backed.",
        payload: {
          scope: "workspace",
          version: "2.0.0",
          allowedTools: ["run_sql_readonly"],
          packageFileRefId: "private-file-ref",
          builtinContentSha256: "a".repeat(64),
        },
        default_enabled: true,
        status: "valid",
      });
      metadataStore.configResources.upsert({
        id: "forecast-mcp",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "mcp-server",
        name: "Forecast MCP",
        payload: {
          transport: "streamable-http",
          url: "https://mcp.internal.example",
          headers: { Authorization: "Bearer private-token" },
          toolManifest: [{ name: "forecast_read" }],
          toolAllowlist: ["forecast_read"],
        },
        secret_ref: "secret:mcp-forecast",
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      })
        .readProjectHarnessConfiguration(project.id);

      expect(state).toMatchObject({
        project: {
          id: project.id,
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          rendererKey: "preschool-overview",
        },
        resources: {
          models: [expect.objectContaining({
            id: "system-model",
            source: "server-system-binding",
            status: "connected",
            revision: 1,
            planningContext: expect.objectContaining({
              capabilitySource: "explicit-profile",
              contextWindow: 32_768,
              maxOutputTokens: 2_048,
            }),
          })],
          skills: [expect.objectContaining({
            id: "workspace-labelled-skill",
            physicalOwner: "user",
            declaredScope: "workspace",
            scopeStatus: "unverified",
            availability: "unavailable",
          })],
          mcpServers: [expect.objectContaining({
            id: "forecast-mcp",
            availability: "configured",
            connection: "persisted-status",
            toolManifest: {
              source: "persisted-last-test",
              toolNames: ["forecast_read"],
            },
          })],
        },
        harnesses: expect.arrayContaining([
          expect.objectContaining({
            id: "ai-analyst",
            resolution: "run-dependent",
            mcpServerIds: ["forecast-mcp"],
          }),
          expect.objectContaining({
            id: "additional-insights",
            resolution: "fixed-stage-contract",
            mcpServerIds: [],
            toolIds: expect.arrayContaining(["energy.evidence.read"]),
          }),
        ]),
      });
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("private-token");
      expect(serialized).not.toContain("provider.internal.example");
      expect(serialized).not.toContain("mcp.internal.example");
      expect(serialized).not.toContain("private-file-ref");
      expect(serialized).not.toContain("secret:");
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("uses the same verified model capability as Run planning", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-model-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.configResources.upsert({
        id: "verified-deepseek-model",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Verified DeepSeek model",
        payload: {
          provider: "openai-compatible",
          modelName: "deepseek-v4-flash",
          baseUrl: "https://api.deepseek.com/v1",
        },
        secret_ref: "secret:verified-deepseek-model",
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectHarnessConfiguration("preschool-demo");

      expect(state.resources.models).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "verified-deepseek-model",
          planningContext: {
            capabilitySource: "verified-model-default",
            contextWindow: 1_000_000,
            maxOutputTokens: 32_000,
            outputReserve: 32_000,
            safetyMargin: 4_096,
            inputBudget: 963_904,
          },
        }),
      ]));
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not confuse the EnergyIQ system binding with Analyst model candidates", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-routing-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.configResources.upsert({
        id: "overview-system-model",
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Overview system model",
        payload: { provider: "openai-compatible", modelName: "overview-model", contextLength: 32_768 },
        default_enabled: true,
        status: "connected",
      });
      metadataStore.workspaceDefaultModelProfiles.set({
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        profile_id: "overview-system-model",
        profile_owner_user_id: user.id,
        configured_by_user_id: user.id,
      });
      metadataStore.configResources.upsert({
        id: "analyst-model",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Analyst model",
        payload: { provider: "openai-compatible", modelName: "analyst-model", contextLength: 16_384 },
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectHarnessConfiguration("preschool-demo");
      const analyst = state.harnesses.find(({ id }) => id === "ai-analyst");
      const additional = state.harnesses.find(({ id }) => id === "additional-insights");

      expect(analyst?.modelIds).toEqual(["analyst-model"]);
      expect(additional?.modelIds).toEqual(["overview-system-model"]);
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("describes Ngee Ann's own Overview stages without inventing Preschool contracts", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-profile-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const project = metadataStore.energyIq.getProject("ngee-ann-polytechnic");
      metadataStore.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadataStore.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore,
          projectId: project.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-23T00:00:00.000Z",
      });
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: "default",
      }).readProjectHarnessConfiguration("ngee-ann-polytechnic");

      expect(state).toMatchObject({
        status: "partially-unavailable",
        project: {
          id: "ngee-ann-polytechnic",
          workspaceId: "default",
          rendererKey: "ngee-ann-overview",
        },
        unavailable: [expect.objectContaining({ id: "server-system-model" })],
        managedOverview: {
          status: "available",
          source: "overview-definition",
          definition: {
            status: "available",
            contractRevision: "energyiq-overview-definition@1",
            templateRevisionId: expect.any(String),
            fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
          reportTimePolicy: {
            status: "available",
            revisionId: "ngee-ann-report-time@1",
            policyId: "ngee-ann-report-time",
            revision: "1",
            windows: [
              expect.objectContaining({ id: "current-month-progress", strategy: "calendar_month_to_date" }),
              expect.objectContaining({ id: "recent-operations", strategy: "rolling_complete_days" }),
              expect.objectContaining({ id: "completed-month-trend", strategy: "completed_calendar_months" }),
              expect.objectContaining({ id: "same-progress-comparison", strategy: "prior_equivalent_progress" }),
              expect.objectContaining({ id: "next-month-outlook", strategy: "next_complete_calendar_month" }),
              expect.objectContaining({ id: "day-type-reference", strategy: "same_day_type_baseline" }),
            ],
          },
          sections: [
            expect.objectContaining({ id: "executive-summary", primaryWindowId: "current-month-progress" }),
            expect.objectContaining({ id: "cost-and-trend", primaryWindowId: "current-month-progress" }),
            expect.objectContaining({ id: "operating-patterns", primaryWindowId: "recent-operations" }),
            expect.objectContaining({ id: "circuit-analysis", primaryWindowId: "recent-operations" }),
          ],
        },
      });
      expect(state.harnesses.map(({ id }) => id)).toEqual([
        "ai-analyst",
        "key-findings",
        "section-analysis",
        "additional-insights",
      ]);
      expect(state.harnesses[0]).toMatchObject({
        status: "unavailable",
        resolution: "run-dependent",
      });
      expect(state.harnesses.slice(1)).toEqual([
        expect.objectContaining({
          id: "key-findings",
          label: "Executive Synthesis",
          detail: expect.stringContaining("Ngee Ann"),
          runtimeStageIds: ["executive-synthesis"],
          contract: {
            provenance: "code-owned-current",
            artifactIdentityRevision: "ngee-ann-executive-v7",
            workflowRevision: "energyiq-project-executive-synthesis-v2",
            promptRevisions: ["energyiq-project-executive-prompt-v2"],
            validatorRevision: "energyiq-project-executive-acceptance-v6",
            outputContractRevision: "energyiq-project-executive-synthesis-v1",
          },
        }),
        expect.objectContaining({
          id: "section-analysis",
          label: "Section Interpretation",
          detail: expect.stringContaining("Ngee Ann"),
          runtimeStageIds: ["section-interpreter"],
          contract: {
            provenance: "code-owned-current",
            artifactIdentityRevision: "ngee-ann-section-v16",
            workflowRevision: "energyiq-project-section-discover-publish-v1",
            promptRevisions: ["energyiq-project-section-discovery-v8"],
            validatorRevision: "energyiq-project-section-acceptance-v14",
            outputContractRevision: "energyiq-project-section-interpretation-v1",
          },
        }),
        expect.objectContaining({
          id: "additional-insights",
          label: "Additional Insights",
          detail: expect.stringContaining("Ngee Ann"),
          runtimeStageIds: ["additional-insights-discovery"],
          contract: {
            provenance: "code-owned-current",
            artifactIdentityRevision: "ngee-ann-additional-insights-v4",
            workflowRevision: "additional-insights-discover-accept-publish-v21",
            promptRevisions: ["additional-insights-discovery-v11", "additional-insights-publication-v2"],
            validatorRevision: "additional-insights-acceptance-v18",
            outputContractRevision: "energyiq-additional-ai-insights-v2",
          },
        }),
      ]);
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps the exact Overview Definition visible when its pinned time policy is locally unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-partial-overview-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const project = metadataStore.energyIq.getProject("ngee-ann-polytechnic");
      metadataStore.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadataStore.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore,
          projectId: project.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-23T00:00:00.000Z",
      });
      ensureEnergyIqBootstrap(metadataStore);
      bindSystemOverviewModel(metadataStore);
      metadataStore.db.prepare(`
        DELETE FROM energyiq_report_time_policy_revisions
        WHERE project_id = ? AND revision_id = ?
      `).run(project.id, "ngee-ann-report-time@1");

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
      }).readProjectHarnessConfiguration(project.id);

      expect(state.project.rendererKey).toBe("ngee-ann-overview");
      expect(state.managedOverview).toMatchObject({
        status: "partially-unavailable",
        source: "overview-definition",
        definition: {
          status: "available",
          contractRevision: "energyiq-overview-definition@1",
        },
        reportTimePolicy: {
          status: "unavailable",
          revisionId: "ngee-ann-report-time@1",
          windows: [],
        },
      });
      expect(state.unavailable).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "report-time-policy" }),
      ]));
      expect(state.harnesses.map(({ id }) => id)).toEqual([
        "ai-analyst",
        "key-findings",
        "section-analysis",
        "additional-insights",
      ]);
      expect(state.harnesses.slice(1)).toEqual([
        expect.objectContaining({ id: "key-findings", status: "unavailable" }),
        expect.objectContaining({ id: "section-analysis", status: "unavailable" }),
        expect.objectContaining({ id: "additional-insights", status: "unavailable" }),
      ]);
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps the Admin read model available when the pinned time policy record is corrupt", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-corrupt-policy-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const project = metadataStore.energyIq.getProject("ngee-ann-polytechnic");
      metadataStore.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadataStore.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore,
          projectId: project.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-23T00:00:00.000Z",
      });
      ensureEnergyIqBootstrap(metadataStore);
      bindSystemOverviewModel(metadataStore);
      metadataStore.db.prepare(`
        UPDATE energyiq_report_time_policy_revisions
        SET policy_json = ?
        WHERE project_id = ? AND revision_id = ?
      `).run("{not-json", project.id, "ngee-ann-report-time@1");

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
      }).readProjectHarnessConfiguration(project.id);

      expect(state.status).toBe("partially-unavailable");
      expect(state.project.rendererKey).toBe("ngee-ann-overview");
      expect(state.managedOverview).toMatchObject({
        status: "partially-unavailable",
        definition: { status: "available" },
        reportTimePolicy: {
          status: "unavailable",
          revisionId: "ngee-ann-report-time@1",
          windows: [],
        },
      });
      expect(state.unavailable).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "overview-runtime-profile" }),
        expect.objectContaining({ id: "report-time-policy" }),
      ]));
      expect(state.harnesses.slice(1).every(({ status }) => status === "unavailable")).toBe(true);
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("shows Tuya's managed Overview without inventing AI Stage contracts", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-tuya-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: "tuya-office",
      }).readProjectHarnessConfiguration("tuya-office");

      expect(state.project.rendererKey).toBe("energy-template-overview");
      expect(state.managedOverview).toMatchObject({
        status: "available",
        source: "overview-definition",
        rendererKey: "energy-template-overview",
        definition: { status: "available" },
        reportTimePolicy: {
          status: "available",
          policyId: "tuya-office-report-time",
          revisionId: "tuya-office-report-time@2",
        },
      });
      expect(state.harnesses.map(({ id }) => id)).toEqual(["ai-analyst"]);
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves the Admin read model privately without starting Provider work", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-api-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const project = metadataStore.energyIq.getProject("preschool-demo");
      const resolveCurrentIdentity = vi.fn();
      const read = vi.fn();
      const execute = vi.fn();
      const executeAdditional = vi.fn();
      const context = {
        metadataStore,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        overviewAiWorkflow: { resolveCurrentIdentity, read, execute },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${project.id}/harness-configuration`),
        ["projects", project.id, "harness-configuration"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            project: { id: project.id, workspaceId: PRESCHOOL_WORKSPACE_ID },
            harnesses: expect.arrayContaining([
              expect.objectContaining({ id: "ai-analyst", resolution: "run-dependent" }),
            ]),
          },
        },
      });
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(executeAdditional).not.toHaveBeenCalled();
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed for a non-Admin and for a cross-Workspace Project", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-auth-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.users.upsertDevUser({
        id: "project-viewer",
        email: "project-viewer@example.test",
        display_name: "Project Viewer",
        dev_token: "project-viewer-token",
      });
      metadataStore.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "project-viewer",
        role: "member",
      });
      metadataStore.energyIq.upsertUserRole({ user_id: "project-viewer", role: "user" });
      metadataStore.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "project-viewer",
        role: "viewer",
      });
      const providerWorkflow = {
        resolveCurrentIdentity: vi.fn(),
        read: vi.fn(),
        execute: vi.fn(),
      };
      const baseContext = {
        metadataStore,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        overviewAiWorkflow: providerWorkflow,
        additionalAiInsightsWorkflow: { execute: vi.fn() },
      } as unknown as Required<ConfigApiContext>;

      const nonAdmin = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/harness-configuration"),
        ["projects", "preschool-demo", "harness-configuration"],
        { ...baseContext, userId: "project-viewer" },
      );
      const crossWorkspace = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/harness-configuration"),
        ["projects", "preschool-demo", "harness-configuration"],
        { ...baseContext, userId: "dev-user", workspaceId: "default" },
      );

      expect(nonAdmin.status).toBe(403);
      expect(crossWorkspace.status).toBe(403);
      expect(providerWorkflow.resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(providerWorkflow.read).not.toHaveBeenCalled();
      expect(providerWorkflow.execute).not.toHaveBeenCalled();
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

function getRequest(url: string): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url });
  request.end();
  return request as unknown as IncomingMessage;
}

function bindSystemOverviewModel(metadataStore: ReturnType<typeof createMetadataStore>): void {
  metadataStore.configResources.upsert({
    id: "overview-system-model",
    workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    user_id: "dev-user",
    kind: "model-profile",
    name: "Overview system model",
    payload: { provider: "openai-compatible", modelName: "overview-model", contextLength: 32_768 },
    default_enabled: true,
    status: "connected",
  });
  metadataStore.workspaceDefaultModelProfiles.set({
    workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    profile_id: "overview-system-model",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
}

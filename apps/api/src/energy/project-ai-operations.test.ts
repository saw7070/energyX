import { EventType } from "@ag-ui/core";
import { createCustomEvent } from "@datafoundry/agent-runtime";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { createSkillLoadedAuditEventId, type SkillLoadedAuditCapture } from "../run-config-audit.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { createProjectAiOperationsReader } from "./project-ai-operations.js";

describe("Project AI Operations", () => {
  it("projects exact historical Run evidence without backfilling current configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.sessions.create({
        id: "session-historical",
        user_id: user.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
        title: "Private customer conversation title",
      });
      metadataStore.runs.create({
        id: "run-historical",
        user_id: user.id,
        session_id: "session-historical",
        user_input: "Private customer prompt must not be returned",
        model_provider: "openai-compatible",
        model_name: "historical-model",
      });
      metadataStore.contextPackageSnapshots.create({
        user_id: user.id,
        session_id: "session-historical",
        run_id: "run-historical",
        package_id: "context-package-1",
        revision: 2,
        payload: { version: 2, packageId: "context-package-1", revision: 2 },
      });
      const modelRequestPayload = {
        schemaVersion: 1,
        requestFidelity: "complete",
        stepNumber: 1,
        retryCount: 0,
        modelName: "historical-model",
        contextPackage: { packageId: "context-package-1", revision: 2 },
        prompt: [{ role: "user", content: "Private Provider request must not be returned" }],
        toolSet: [{ name: "energy.evidence.read", inputSchema: { type: "object" } }],
        activeToolNames: ["energy.evidence.read"],
      };
      const modelRequestSnapshot = metadataStore.modelRequestSnapshots.create({
        user_id: user.id,
        session_id: "session-historical",
        run_id: "run-historical",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 2,
        payload: modelRequestPayload,
      });
      metadataStore.db.prepare(`
        UPDATE model_request_snapshots
        SET payload_json = ?, payload_availability = 'retained'
        WHERE user_id = ? AND id = ?
      `).run(canonicalJson(modelRequestPayload), user.id, modelRequestSnapshot.id);
      append(createCustomEvent("run.config.resolved", {
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        overview_ai_stage: "additional-insights-investigator",
        active_llm_profile_id: "historical-profile",
        resource_revisions: {
          "model-profile:historical-profile": 7,
          "skill:historical-skill": 4,
        },
        selected_skill_ids: ["historical-skill"],
        enabled_mcp_server_ids: ["historical-mcp"],
        context_window: 128_000,
        input_budget: 119_808,
        secret: "must-not-render",
      }));
      append(createCustomEvent("skill.selection", {
        mode: "auto",
        selected: [{ id: "historical-skill", name: "Historical Skill", revision: 4, tags: ["energy"] }],
        audit: [{ skillId: "historical-skill", decision: "selected", reasons: ["explicit"] }],
      }));
      append(createCustomEvent("skill.materialized", {
        items: [{ id: "historical-skill", revision: 4 }],
      }));
      append(createCustomEvent("context.compiled", {
        step_number: 1,
        package_id: "context-package-1",
        package_revision: 2,
        plan_id: "context-plan-1",
        selected_group_ids: ["project", "evidence"],
        omitted_group_ids: ["long-term-memory"],
        selected_sources: [{ source_types: ["project-analysis-snapshot", "evidence"] }],
        omitted_sources: [{ source_types: ["long-term-memory"] }],
        decisions: [{ strategyId: "drop-low-priority", tokenSavings: 80 }],
        budget: {
          capabilitySource: "explicit-profile",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          outputReserve: 4_096,
          safetyMargin: 4_096,
          inputBudget: 119_808,
        },
        token_report: {
          systemTokens: 120,
          toolTokens: 80,
          messageTokens: 400,
          totalInputTokens: 600,
          remainingTokens: 119_208,
          countQuality: "estimated",
        },
        prompt_tokens: 600,
        remaining_tokens: 119_208,
        high_water_mark: "normal",
        prompt: "Private materialized prompt must not be returned",
      }));
      append(createCustomEvent("context.prompt-verified", {
        step_number: 1,
        prompt_tokens: 620,
        input_budget: 119_808,
        context_window: 128_000,
        remaining_tokens: 119_188,
        capability_source: "explicit-profile",
      }));
      append(createCustomEvent("model.request.prepared", {
        eventId: "model-request-prepared:run-historical:1:0",
        run_event_schema_version: 1,
        request_fidelity: "complete",
        step_number: 1,
        retry_count: 0,
        model: "historical-model",
        context_package_id: "context-package-1",
        context_package_revision: 2,
        payload_availability: "retained",
        tool_names: ["energy.evidence.read"],
        payload_ref: {
          kind: "model-request-snapshot",
          id: modelRequestSnapshot.id,
          sha256: modelRequestSnapshot.content_sha256,
        },
      }));
      append(createCustomEvent("model.request.prepared", {
        eventId: "model-request-prepared:run-historical:2:0",
        run_event_schema_version: 1,
        request_fidelity: "complete",
        step_number: 2,
        retry_count: 0,
        model: "historical-model",
        context_package_id: "context-package-missing",
        context_package_revision: 3,
        tool_names: [],
        payload_ref: {
          kind: "model-request-snapshot",
          id: "model-request:run-historical:2:0",
          sha256: `sha256:${"f".repeat(64)}`,
        },
      }));
      append({ type: EventType.TOOL_CALL_START, toolCallId: "call-success", toolCallName: "energy.evidence.read" });
      append({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-success",
        toolCallName: "energy.evidence.read",
        content: JSON.stringify({ success: true, privateRows: ["must-not-render"] }),
      });
      append({ type: EventType.TOOL_CALL_START, toolCallId: "call-rejected", toolCallName: "run_sql_readonly" });
      append({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-rejected",
        toolCallName: "run_sql_readonly",
        content: JSON.stringify({ success: false, error: "SQL_BLOCKED" }),
      });
      append({ type: EventType.TOOL_CALL_START, toolCallId: "call-pending", toolCallName: "inspect_schema" });
      append(createCustomEvent("token_usage", {
        input_tokens: 700,
        output_tokens: 180,
        total_tokens: 880,
        cache_telemetry_available: true,
        cache_hit_tokens: 200,
        cache_miss_tokens: 500,
      }));
      append({ type: EventType.RUN_FINISHED });
      metadataStore.runs.updateStatus({ user_id: user.id, run_id: "run-historical", status: "completed" });
      metadataStore.artifacts.create({
        id: "artifact-historical",
        user_id: user.id,
        session_id: "session-historical",
        run_id: "run-historical",
        type: "table",
        name: "Evidence table",
        storage_path: "private/storage/path.csv",
        preview_json: { privateRows: ["must-not-render"] },
      });
      const artifactIdentity = {
        artifactKind: "autonomous-insights",
        targetId: "preschool-project",
      };
      const artifactResult = {
        runId: "run-historical",
        findings: [{ id: "finding-historical", text: "Private finding text must not be returned" }],
      };
      metadataStore.db.prepare(`
        INSERT INTO energyiq_overview_ai_artifacts (
          id, identity_hash, identity_json, workspace_id, project_id, scope_id,
          resource, data_snapshot_id, project_release_id, renderer_key,
          renderer_version, analysis_pack_id, analysis_pack_revision,
          model_profile_id, model_profile_revision, output_contract_revision,
          validator_revision, status, attempt_count, triggered_by,
          session_id, run_id, result_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'electricity', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'available', 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "energy-artifact-historical",
        "identity-historical",
        JSON.stringify(artifactIdentity),
        PRESCHOOL_WORKSPACE_ID,
        "preschool-demo",
        "preschool-project",
        "preschool-snapshot",
        "preschool-release",
        "preschool-overview",
        "1",
        "preschool-additional-insights",
        "12",
        "historical-profile",
        7,
        "additional-v12",
        "validator-v12",
        user.id,
        "session-historical",
        "run-historical",
        JSON.stringify(artifactResult),
        "2026-08-15T10:00:00.000Z",
        "2026-08-15T10:01:00.000Z",
        "2026-08-15T10:01:00.000Z",
      );

      metadataStore.configResources.upsert({
        id: "historical-profile",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Current replacement profile",
        payload: { modelName: "current-model", contextLength: 1_000_000 },
        default_enabled: true,
        status: "connected",
      });
      metadataStore.configResources.upsert({
        id: "historical-mcp",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "mcp-server",
        name: "Current MCP",
        payload: {
          url: "https://current-mcp.example",
          headers: { Authorization: "Bearer current-secret" },
          toolManifest: [{ name: "current_tool_must_not_backfill" }],
        },
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectAiOperationsReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", { actorId: user.id, runId: "run-historical" });

      expect(state.runs).toEqual([
        expect.objectContaining({
          runId: "run-historical",
          actorId: user.id,
          status: "completed",
          stage: null,
          modelName: "historical-model",
          inputTokens: null,
          outputTokens: null,
          toolCounts: null,
          traceAvailability: "detail-required",
        }),
      ]);
      expect(state.selectedRun).toMatchObject({
        runId: "run-historical",
        stage: "additional-insights-investigator",
        inputTokens: 700,
        outputTokens: 180,
        toolCounts: { called: 3, succeeded: 1, rejected: 1, failed: 0 },
        historicalConfiguration: {
          status: "available",
          modelProfileId: "historical-profile",
          resourceRevisions: {
            "model-profile:historical-profile": 7,
            "skill:historical-skill": 4,
          },
          selectedSkills: [{ id: "historical-skill", name: "Historical Skill", revision: 4 }],
          materializedSkills: {
            status: "available",
            items: [{ id: "historical-skill", revision: 4 }],
          },
          loadedSkills: {
            status: "unavailable",
            items: [expect.objectContaining({
              id: "historical-skill",
              evidenceStatus: "unavailable",
              revision: 4,
            })],
          },
          mcp: {
            enabledServerIds: ["historical-mcp"],
            serverToolMapping: { status: "unavailable", items: [] },
          },
        },
        context: {
          status: "available",
          steps: [expect.objectContaining({
            stepNumber: 1,
            selectedGroupCount: 2,
            omittedGroupCount: 1,
            selectedSourceTypes: ["evidence", "project-analysis-snapshot"],
            omittedSourceTypes: ["long-term-memory"],
            promptTokens: 620,
            inputBudget: 119_808,
          })],
        },
        modelRequests: {
          status: "partial",
          detail: "1 of 2 Provider-boundary request snapshots can be reconstructed.",
          items: [{
            stepNumber: 1,
            retryCount: 0,
            modelName: "historical-model",
            reconstructionStatus: "available",
            snapshotId: modelRequestSnapshot.id,
            contentSha256: modelRequestSnapshot.content_sha256,
            contextPackageId: "context-package-1",
            contextPackageRevision: 2,
            toolNames: ["energy.evidence.read"],
            payloadAvailability: "retained",
          }, {
            stepNumber: 2,
            retryCount: 0,
            modelName: "historical-model",
            reconstructionStatus: "unavailable",
            snapshotId: "model-request:run-historical:2:0",
            contentSha256: `sha256:${"f".repeat(64)}`,
            contextPackageId: "context-package-missing",
            contextPackageRevision: 3,
            toolNames: [],
            payloadAvailability: null,
          }],
        },
        tools: [
          expect.objectContaining({ toolCallId: "call-success", name: "energy.evidence.read", status: "succeeded" }),
          expect.objectContaining({ toolCallId: "call-rejected", name: "run_sql_readonly", status: "rejected" }),
          expect.objectContaining({ toolCallId: "call-pending", name: "inspect_schema", status: "called" }),
        ],
        tokens: {
          status: "available",
          input: 700,
          output: 180,
          total: 880,
          cache: { status: "available", hit: 200, miss: 500 },
        },
        lineage: {
          artifacts: [{ id: "artifact-historical", type: "table", name: "Evidence table" }],
          energyIqArtifacts: [{
            id: "energy-artifact-historical",
            kind: "autonomous-insights",
            targetId: "preschool-project",
            findingIds: ["finding-historical"],
          }],
        },
      });
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("Private customer");
      expect(serialized).not.toContain("Private materialized prompt");
      expect(serialized).not.toContain("Private Provider request");
      expect(serialized).not.toContain("Private finding text");
      expect(serialized).not.toContain("must-not-render");
      expect(serialized).not.toContain("current-model");
      expect(serialized).not.toContain("current_tool_must_not_backfill");
      expect(serialized).not.toContain("current-secret");
      expect(serialized).not.toContain("private/storage");

      function append(event: unknown): void {
        metadataStore.runEvents.append({
          user_id: user.id,
          run_id: "run-historical",
          session_id: "session-historical",
          event: event as never,
        });
      }
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps valid exact Skill load evidence when malformed and mismatched siblings are locally unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-skill-load-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.sessions.create({
        id: "session-skill-load",
        user_id: user.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.sessions.create({
        id: "session-foreign-skill-load",
        user_id: user.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "run-skill-load",
        user_id: user.id,
        session_id: "session-skill-load",
        user_input: "private",
      });
      const append = (event: unknown, sessionId = "session-skill-load"): void => {
        metadataStore.runEvents.append({
          user_id: user.id,
          run_id: "run-skill-load",
          session_id: sessionId,
          event: event as never,
        });
      };
      append(createCustomEvent("run.config.resolved", {
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        resource_revisions: {
          "skill:data-analysis": 7,
          "skill:broken-sibling": 3,
          "skill:missing-load": 5,
          "skill:whitespace-prerequisite": 6,
        },
      }));
      append(createCustomEvent("skill.selection", {
        selected: [
          { id: "data-analysis", name: "Data Analysis", revision: 7 },
          { id: "broken-sibling", name: "Broken Sibling", revision: 3 },
          { id: "missing-load", name: "Missing Load", revision: 5 },
          { id: " whitespace-prerequisite", name: "Whitespace Prerequisite", revision: 6 },
        ],
        audit: [
          { skillId: "data-analysis", decision: "selected" },
          { skillId: "broken-sibling", decision: "selected" },
          { skillId: "missing-load", decision: "selected" },
          { skillId: " whitespace-prerequisite", decision: "selected" },
        ],
      }));
      append(createCustomEvent("skill.materialized", {
        items: [
          {
            id: "data-analysis",
            revision: 7,
            content_sha256: `sha256:${"a".repeat(64)}`,
            package_ref: "file-ref-data-analysis-v1",
          },
          {
            id: "broken-sibling",
            revision: 3,
            content_sha256: `sha256:${"c".repeat(64)}`,
            package_ref: "file-ref-broken-v1",
          },
          {
            id: "missing-load",
            revision: 5,
            content_sha256: `sha256:${"d".repeat(64)}`,
            package_ref: "file-ref-missing-v1",
          },
          {
            id: "whitespace-prerequisite",
            revision: 6,
            content_sha256: `sha256:${"e".repeat(64)}`,
            package_ref: "file-ref-whitespace-v1",
          },
        ],
      }));
      append(createCustomEvent("skill.selection", {
        selected: [{ id: "foreign-session", name: "Foreign Session", revision: 99 }],
        audit: [{ skillId: "foreign-session", decision: "selected" }],
      }), "session-foreign-skill-load");
      append(createCustomEvent("skill.materialized", {
        items: [{
          id: "foreign-session",
          revision: 99,
          content_sha256: `sha256:${"f".repeat(64)}`,
          package_ref: "file-ref-foreign-session",
        }],
      }), "session-foreign-skill-load");
      const dataAnalysisLoad: SkillLoadedAuditCapture["skill"] = {
        id: "data-analysis",
        name: "Data Analysis",
        semantic_version: "1.0.0",
        config_revision: 7,
        content_sha256: `sha256:${"a".repeat(64)}`,
        package_ref: "file-ref-data-analysis-v1",
        owner: { scope: "workspace", user_id: user.id, workspace_id: PRESCHOOL_WORKSPACE_ID },
        load_source: "materialized-skill-package",
        load_stage: "agent-instruction-assembly",
      };
      append(createCustomEvent("skill.loaded", {
        eventId: createSkillLoadedAuditEventId("run-skill-load", dataAnalysisLoad),
        run_event_schema_version: 1,
        skill: dataAnalysisLoad,
      }));
      const brokenLoad: SkillLoadedAuditCapture["skill"] = {
        ...dataAnalysisLoad,
        id: "broken-sibling",
        name: "Broken Sibling",
        config_revision: 3,
        content_sha256: `sha256:${"b".repeat(64)}`,
        package_ref: "file-ref-broken-v1",
      };
      append(createCustomEvent("skill.loaded", {
        eventId: createSkillLoadedAuditEventId("run-skill-load", brokenLoad),
        run_event_schema_version: 1,
        skill: brokenLoad,
      }));
      const whitespaceLoad: SkillLoadedAuditCapture["skill"] = {
        ...dataAnalysisLoad,
        id: "whitespace-prerequisite",
        name: "Whitespace Prerequisite",
        config_revision: 6,
        content_sha256: `sha256:${"e".repeat(64)}`,
        package_ref: "file-ref-whitespace-v1",
      };
      append(createCustomEvent("skill.loaded", {
        eventId: createSkillLoadedAuditEventId("run-skill-load", whitespaceLoad),
        run_event_schema_version: 1,
        skill: whitespaceLoad,
      }));
      append(createCustomEvent("skill.loaded", {
        eventId: "malformed-sibling",
        run_event_schema_version: 1,
        skill: "invalid-skill-payload",
      }));

      metadataStore.configResources.upsert({
        id: "data-analysis",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "skill",
        name: "Current replacement must not backfill",
        payload: { version: "9.9.9", packageFileRefId: "current-ref" },
        status: "valid",
      });

      const detail = createProjectAiOperationsReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", {
        actorId: user.id,
        runId: "run-skill-load",
      }).selectedRun;

      expect(detail?.historicalConfiguration.loadedSkills.status).toBe("available");
      expect(detail?.historicalConfiguration.loadedSkills.items).toHaveLength(5);
      expect(detail?.historicalConfiguration.loadedSkills.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "data-analysis",
          evidenceStatus: "available",
          revision: 7,
          semanticVersion: "1.0.0",
          packageRef: "file-ref-data-analysis-v1",
        }),
        expect.objectContaining({
          id: "broken-sibling",
          evidenceStatus: "unavailable",
          revision: 3,
        }),
        expect.objectContaining({
          id: "missing-load",
          evidenceStatus: "unavailable",
          revision: 5,
        }),
        expect.objectContaining({
          id: "whitespace-prerequisite",
          evidenceStatus: "unavailable",
          revision: 6,
        }),
        expect.objectContaining({
          evidenceStatus: "unavailable",
          revision: null,
        }),
      ]));
      expect(JSON.stringify(detail)).not.toContain("foreign-session");
      expect(JSON.stringify(detail)).not.toContain("Current replacement");
      expect(JSON.stringify(detail)).not.toContain("9.9.9");
      expect(JSON.stringify(detail)).not.toContain("current-ref");
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps same-id Runs from different actors distinct across pagination and exact detail", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-scope-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.users.upsertDevUser({
        id: "project-analyst",
        email: "project-analyst@example.test",
        display_name: "Project Analyst",
        dev_token: "project-analyst-token",
      });
      metadataStore.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "project-analyst",
        role: "member",
      });
      metadataStore.energyIq.upsertUserRole({ user_id: "project-analyst", role: "user" });
      metadataStore.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "project-analyst",
        role: "viewer",
      });
      metadataStore.sessions.create({
        id: "project-session",
        user_id: "project-analyst",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "shared-run",
        user_id: "project-analyst",
        session_id: "project-session",
        user_input: "private",
      });
      metadataStore.sessions.create({
        id: "admin-project-session",
        user_id: "dev-user",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "shared-run",
        user_id: "dev-user",
        session_id: "admin-project-session",
        user_input: "private",
      });
      metadataStore.db.prepare(`
        UPDATE runs SET started_at = ? WHERE id = ?
      `).run("2026-08-24T00:00:00.000Z", "shared-run");
      metadataStore.runEvents.append({
        user_id: "project-analyst",
        run_id: "shared-run",
        session_id: "project-session",
        event: createCustomEvent("run.config.resolved", {
          workspace_id: PRESCHOOL_WORKSPACE_ID,
          overview_ai_stage: "analyst-stage",
        }),
      });
      metadataStore.runEvents.append({
        user_id: "dev-user",
        run_id: "shared-run",
        session_id: "admin-project-session",
        event: createCustomEvent("run.config.resolved", {
          workspace_id: PRESCHOOL_WORKSPACE_ID,
          overview_ai_stage: "admin-stage",
        }),
      });
      metadataStore.runEvents.append({
        user_id: "dev-user",
        run_id: "shared-run",
        session_id: "admin-project-session",
        event: createCustomEvent("token_usage", {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        }),
      });
      metadataStore.db.prepare(`
        INSERT INTO energyiq_overview_ai_artifacts (
          id, identity_hash, identity_json, workspace_id, project_id, scope_id,
          resource, data_snapshot_id, project_release_id, renderer_key,
          renderer_version, analysis_pack_id, analysis_pack_revision,
          model_profile_id, model_profile_revision, output_contract_revision,
          validator_revision, status, attempt_count, triggered_by,
          session_id, run_id, result_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'electricity', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'available', 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "analyst-only-energy-artifact",
        "analyst-only-identity",
        JSON.stringify({ artifactKind: "autonomous-insights", targetId: "preschool-project" }),
        PRESCHOOL_WORKSPACE_ID,
        "preschool-demo",
        "preschool-project",
        "preschool-snapshot",
        "preschool-release",
        "preschool-overview",
        "1",
        "preschool-additional-insights",
        "12",
        "historical-profile",
        7,
        "additional-v12",
        "validator-v12",
        "project-analyst",
        "project-session",
        "shared-run",
        JSON.stringify({ runId: "shared-run", findings: [{ id: "analyst-finding" }] }),
        "2026-08-24T00:00:00.000Z",
        "2026-08-24T00:01:00.000Z",
        "2026-08-24T00:01:00.000Z",
      );
      metadataStore.sessions.create({
        id: "other-project-session",
        user_id: "dev-user",
        workspace_id: "default",
        project_id: "ngee-ann-polytechnic",
      });
      metadataStore.runs.create({
        id: "other-project-run",
        user_id: "dev-user",
        session_id: "other-project-session",
        user_input: "private",
      });

      const admin = metadataStore.users.getById({ user_id: "dev-user" });
      const reader = createProjectAiOperationsReader({
        metadataStore,
        user: admin,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      });

      const first = reader.readProjectAiOperations("preschool-demo", { limit: 1 });
      const second = reader.readProjectAiOperations("preschool-demo", {
        limit: 1,
        cursor: first.pagination.nextCursor!,
      });
      expect(first.pagination).toMatchObject({ returned: 1, hasMore: true, nextCursor: expect.any(String) });
      expect(second.pagination).toMatchObject({ returned: 1, hasMore: false, nextCursor: null });
      expect(new Set([...first.runs, ...second.runs].map(({ actorId, runId }) => `${actorId}:${runId}`)))
        .toEqual(new Set(["dev-user:shared-run", "project-analyst:shared-run"]));

      const analystDetail = reader.readProjectAiOperations("preschool-demo", {
        actorId: "project-analyst",
        runId: "shared-run",
      }).selectedRun;
      expect(analystDetail).toMatchObject({
        actorId: "project-analyst",
        runId: "shared-run",
        stage: "analyst-stage",
        lineage: { energyIqArtifacts: [expect.objectContaining({ id: "analyst-only-energy-artifact" })] },
      });
      const adminDetail = reader.readProjectAiOperations("preschool-demo", {
        actorId: "dev-user",
        runId: "shared-run",
      }).selectedRun;
      expect(adminDetail).toMatchObject({
        actorId: "dev-user",
        runId: "shared-run",
        stage: "admin-stage",
        tokens: { status: "available", input: 0, output: 0, total: 0 },
        lineage: { energyIqArtifacts: [] },
      });
      expect(() => reader.readProjectAiOperations("preschool-demo", { runId: "shared-run" }))
        .toThrow("ENERGYIQ_AI_OPERATIONS_ACTOR_REQUIRED");
      expect(() => reader.readProjectAiOperations("preschool-demo", {
        actorId: "dev-user",
        runId: "other-project-run",
      }))
        .toThrow("ENERGYIQ_RUN_FORBIDDEN");
      expect(() => createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "project-analyst" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo")).toThrow("ENERGYIQ_ADMIN_REQUIRED");
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps a valid Provider request sibling visible when one retained payload is malformed", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-local-unavailable-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.sessions.create({
        id: "operations-session",
        user_id: "dev-user",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "operations-run",
        user_id: "dev-user",
        session_id: "operations-session",
        user_input: "private",
      });
      for (const stepNumber of [1, 2]) {
        metadataStore.contextPackageSnapshots.create({
          user_id: "dev-user",
          session_id: "operations-session",
          run_id: "operations-run",
          package_id: `context-package-${stepNumber}`,
          revision: 1,
          payload: { packageId: `context-package-${stepNumber}`, revision: 1, version: 2 },
        });
        const payload = {
          activeToolNames: [],
          contextPackage: { packageId: `context-package-${stepNumber}`, revision: 1 },
          modelName: "historical-model",
          prompt: [{ content: "private", role: "user" }],
          requestFidelity: "complete",
          retryCount: 0,
          schemaVersion: 1,
          stepNumber,
          toolSet: [],
        };
        const snapshot = metadataStore.modelRequestSnapshots.create({
          user_id: "dev-user",
          session_id: "operations-session",
          run_id: "operations-run",
          step_number: stepNumber,
          retry_count: 0,
          context_package_id: `context-package-${stepNumber}`,
          context_package_revision: 1,
          payload,
        });
        metadataStore.db.prepare(`
          UPDATE model_request_snapshots
          SET payload_json = ?, payload_availability = ?
          WHERE user_id = 'dev-user' AND id = ?
        `).run(
          JSON.stringify(payload),
          stepNumber === 1 ? "invalid-retention-state" : "retained",
          snapshot.id,
        );
        metadataStore.runEvents.append({
          user_id: "dev-user",
          run_id: "operations-run",
          session_id: "operations-session",
          event: createCustomEvent("model.request.prepared", {
            eventId: `model-request-prepared:operations-run:${stepNumber}:0`,
            run_event_schema_version: 1,
            request_fidelity: "complete",
            step_number: stepNumber,
            retry_count: 0,
            payload_availability: "retained",
            model: "historical-model",
            context_package_id: `context-package-${stepNumber}`,
            context_package_revision: 1,
            tool_names: [],
            payload_ref: {
              kind: "model-request-snapshot",
              id: snapshot.id,
              sha256: snapshot.content_sha256,
            },
          }),
        });
      }

      const state = createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", { actorId: "dev-user", runId: "operations-run" });

      expect(state.selectedRun?.modelRequests).toMatchObject({
        status: "partial",
        items: [{
          stepNumber: 1,
          reconstructionStatus: "unavailable",
        }, {
          stepNumber: 2,
          reconstructionStatus: "available",
        }],
      });
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns an explicit bounded first page without loading per-Run detail evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-page-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.sessions.create({
        id: "operations-page-session",
        user_id: "dev-user",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      for (let index = 0; index < 25; index += 1) {
        metadataStore.runs.create({
          id: `operations-page-run-${String(index).padStart(2, "0")}`,
          user_id: "dev-user",
          session_id: "operations-page-session",
          user_input: "private",
        });
      }
      const eventReads = vi.spyOn(metadataStore.runEvents, "listByRun");
      const artifactReads = vi.spyOn(metadataStore.artifacts, "listByRun");
      const energyArtifactReads = vi.spyOn(metadataStore.energyIq.overviewAiArtifacts, "listByProject");

      const state = createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo");

      expect(state.runs).toHaveLength(20);
      expect(state.pagination).toEqual({
        limit: 20,
        returned: 20,
        hasMore: true,
        nextCursor: expect.any(String),
      });
      expect(state.runs[0]).toMatchObject({
        stage: null,
        inputTokens: null,
        outputTokens: null,
        toolCounts: null,
        traceAvailability: "detail-required",
      });
      expect(eventReads).not.toHaveBeenCalled();
      expect(artifactReads).not.toHaveBeenCalled();
      expect(energyArtifactReads).not.toHaveBeenCalled();

      expect(() => createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", { limit: 101 }))
        .toThrow("ENERGYIQ_AI_OPERATIONS_LIMIT_INVALID");
      expect(() => createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", { cursor: "not-a-valid-cursor" }))
        .toThrow("ENERGYIQ_AI_OPERATIONS_CURSOR_INVALID");

      const next = createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", { cursor: state.pagination.nextCursor! });
      expect(next.runs).toHaveLength(5);
      expect(next.pagination).toEqual({ limit: 20, returned: 5, hasMore: false, nextCursor: null });
      expect([...new Set([...state.runs, ...next.runs].map(({ runId }) => runId))]).toHaveLength(25);
      expect(eventReads).not.toHaveBeenCalled();
      expect(artifactReads).not.toHaveBeenCalled();
      expect(energyArtifactReads).not.toHaveBeenCalled();
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves private list and detail GETs without starting Provider work", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-api-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.sessions.create({
        id: "operations-session",
        user_id: "dev-user",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "operations-run",
        user_id: "dev-user",
        session_id: "operations-session",
        user_input: "private",
      });
      metadataStore.runs.create({
        id: "operations-run-older",
        user_id: "dev-user",
        session_id: "operations-session",
        user_input: "private",
      });
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
      const changesBefore = totalChanges(metadataStore);

      const list = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/ai-operations?limit=1"),
        ["projects", "preschool-demo", "ai-operations"],
        context,
      );
      const detail = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/ai-operations/runs/operations-run?actorId=dev-user"),
        ["projects", "preschool-demo", "ai-operations", "runs", "operations-run"],
        context,
      );

      expect(list).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            runs: [expect.any(Object)],
            selectedRun: null,
            pagination: { limit: 1, returned: 1, hasMore: true, nextCursor: expect.any(String) },
          },
        },
      });
      expect(detail).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            selectedRun: expect.objectContaining({
              actorId: "dev-user",
              runId: "operations-run",
              tokens: expect.objectContaining({
                status: "unavailable",
                input: null,
                output: null,
                total: null,
              }),
            }),
          },
        },
      });
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(executeAdditional).not.toHaveBeenCalled();
      expect(totalChanges(metadataStore)).toBe(changesBefore);
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

function totalChanges(metadataStore: ReturnType<typeof createMetadataStore>): number {
  const row = metadataStore.db.prepare("SELECT total_changes() AS value").get();
  return typeof row === "object" && row !== null && typeof row.value === "number" ? row.value : -1;
}

function canonicalJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  };
  return JSON.stringify(canonicalize(value));
}

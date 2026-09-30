import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import { APICallError, TypeValidationError } from "@ai-sdk/provider";
import { toStandardSchema } from "@mastra/core/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Observable } from "rxjs";
import {
  createDataFoundry,
  createDataFoundryRunContext,
  type AnalysisContextEvidenceCatalog,
} from "@datafoundry/agent-runtime";
import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";

import {
  buildOverviewAiStageRunInput,
  collectOverviewAiStageEvents,
  collectOverviewAiText,
  collectOverviewAiValueStageAnswer,
  createPreschoolAdditionalAiInsightTrustedStageTools,
  createPreschoolSectionTrustedStageTools,
  normalizeOverviewAiStageRuntimeError,
  DataFoundryAgUiAgent,
  resolveOverviewAiAgentRuntimeOptions,
  resolveOverviewAiArtifactSessionScope,
  resolveOverviewAiServerRunnerOptions,
  resolveOverviewAiStageRuntimeOptions,
  resolveOverviewAiStageStructuredOutput,
  shouldUseEnergyContextForOverviewAiStage,
  shouldIncludeProjectAnalysisEvidenceContext,
} from "./server.js";
import { createRunMemoryAssembly } from "./run-memory-assembly.js";
import { RunCancelRegistry } from "./run-cancel-registry.js";
import {
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3,
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_TRANSITION_STRUCTURED_OUTPUT_V1,
  PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
} from "./energy/preschool-overview-ai-structured-output.js";
import { buildPreschoolSectionDiscoveryPrompt } from "./energy/preschool-section-interpreter.js";
import type { PreschoolSectionPackV2 } from "./energy/preschool-section-pack-v2.js";
import { MAX_PRESCHOOL_HTML_AI_SLOT_PROMPT_CHARS } from "./energy/preschool-html-ai-slot.js";
import { MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS } from "./energy/preschool-executive-synthesis.js";
import { MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS } from "./energy/preschool-additional-ai-insights-workflow.js";
import { MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS } from "./energy/preschool-additional-ai-insights-evaluation.js";
import {
  NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1,
  NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
} from "./energy/ngee-ann-overview-ai-structured-output.js";
import { completeProtocolRun } from "./protocol-run-completion.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy/energy-bootstrap.js";
import { materializePreschoolGoldenFixture } from "./energy/preschool-golden.fixture.js";
import { resolvePublishedEnergyQueryContext } from "./energy/project-analysis-resolver.js";

describe("Overview AI server stage options", () => {
  it("keeps html-slot server-owned, isolated and free of Energy/tools context", () => {
    expect(resolveOverviewAiStageRuntimeOptions("html-slot")).toMatchObject({
      analysisRequirementsMode: "omit",
      conversationMessageMaxChars: MAX_PRESCHOOL_HTML_AI_SLOT_PROMPT_CHARS,
      disableTools: true,
      reasoningModel: false,
      structuredOutput: {
        errorStrategy: "warn",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["evidenceRefs", "html"],
        },
      },
    });
    expect(shouldUseEnergyContextForOverviewAiStage("html-slot")).toBe(false);
    const runInput = buildOverviewAiStageRunInput({
      stage: "html-slot",
      prompt: "Return the bounded HTML envelope.",
      runId: "run-html",
      sessionId: "session-html",
      user: { id: "user-html" } as never,
      workspaceId: "workspace-html",
      identity: {
        workspaceId: "workspace-html",
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-html",
        projectReleaseId: "release-html",
        analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
        analysisPeriodTo: "2026-07-01T00:00:00.000Z",
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        analysisPackId: "preschool-html-ai-slot-pack",
        analysisPackRevision: "v1",
        modelProfileId: "workspace-default",
        modelProfileRevision: 4,
        outputContractRevision: "energyiq-ai-slot-html-artifact@1",
        validatorRevision: "preschool-html-ai-slot-validator@10",
        workflowRevision: "preschool-html-ai-slot-workflow@10",
        investigatorPromptRevision: "preschool-html-slot-prompt@15",
        editorPromptRevision: "not-applicable-v1",
        methodSkillId: "none",
        methodSkillRevision: "not-applicable-v1",
        artifactKind: "html-slot",
        targetId: "centre-benchmark",
        identityContractRevision: "html-slot-v1",
        capabilityRevision: "static-html-sandbox-v7",
        publicationRevision: "html-slot-v1",
        slotDefinitionRevision: "preschool-centre-benchmark-html@3",
      },
    });
    expect(runInput.forwardedProps).not.toHaveProperty("externalContext");
    expect(runInput.forwardedProps.run_config).toMatchObject({
      skillMode: "none",
      enabledSkillIds: [],
      enabledDatasourceIds: [],
      enabledKnowledgeIds: [],
      enabledMcpServerIds: [],
    });
  });

  it("delivers an accepted html-slot prompt tail beyond 24k intact to conversation assembly", async () => {
    const sessionId = "html-slot-prompt-budget-session";
    const runId = "html-slot-prompt-budget-run";
    const prompt = `${"Evidence context ".repeat(1_600)}\nTAIL_CONTEXT_EVIDENCE_AND_RULES`;
    expect(prompt.length).toBeGreaterThan(24_000);
    expect(prompt.length).toBeLessThanOrEqual(MAX_PRESCHOOL_HTML_AI_SLOT_PROMPT_CHARS);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "html-slot-prompt-budget-"));
    const metadata = createMetadataStore({
      database_path: join(workspaceRoot, "metadata.sqlite"),
      secret_master_key: "html-slot-prompt-budget-test-key",
    });
    metadata.sessions.create({ user_id: "dev-user", id: sessionId, title: "HTML Slot prompt budget" });
    metadata.runs.create({
      user_id: "dev-user",
      id: runId,
      session_id: sessionId,
      user_input: prompt,
      model_provider: "deepseek",
      model_name: "deepseek-v4-flash",
    });
    try {
      const runtimeOptions = resolveOverviewAiAgentRuntimeOptions("html-slot");
      if (runtimeOptions.conversationMessageMaxChars === undefined) {
        throw new Error("Expected html-slot conversation message budget");
      }
      const assembly = await createRunMemoryAssembly({
        conversationMemoryMode: "off",
        conversationMessageMaxChars: runtimeOptions.conversationMessageMaxChars,
        isResume: false,
        metadataStore: metadata,
        model: {},
        modelName: "deepseek-v4-flash",
        runId,
        runInput: {
          threadId: sessionId,
          runId,
          state: {},
          messages: [{ id: `${runId}:user`, role: "user", content: prompt }],
          tools: [],
          context: [],
          forwardedProps: {},
        },
        sessionId,
        taskStateRuntime: {} as never,
        userId: "dev-user",
        userInput: prompt,
      });

      expect(assembly.conversationMessages.at(-1)).toMatchObject({
        role: "user",
        content: prompt,
      });
    } finally {
      metadata.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("preserves the server-owned Ngee Ann Section and Executive schemas at the shared runtime seam", () => {
    expect(resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      structuredOutput: NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
    })?.structuredOutput).toBe(NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1);
    expect(resolveOverviewAiServerRunnerOptions({
      stage: "executive-synthesis",
      structuredOutput: NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1,
    })?.structuredOutput).toBe(NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1);
  });

  it("reserves the larger complete-projection message budget only for the exact Ngee Ann Section identity", () => {
    const identity = {
      rendererKey: "ngee-ann-overview",
      identityContractRevision: "ngee-ann-section-v16",
    } as EnergyIqOverviewAiArtifactIdentity;
    expect(resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      identity,
      structuredOutput: NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
    })).toMatchObject({ conversationMessageMaxChars: 220_000 });
    expect(resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      structuredOutput: NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
    })).toMatchObject({ conversationMessageMaxChars: 110_000 });
  });

  it("normalizes only typed local Additional structured-output failures", () => {
    expect(normalizeOverviewAiStageRuntimeError(
      "additional-insights-discovery",
      new Error("Structured Output root undefined"),
    ).message).toBe("PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID");
    const schemaValidationError = new Error("candidates.0 additional properties");
    schemaValidationError.name = "AI_TypeValidationError";
    expect(normalizeOverviewAiStageRuntimeError(
      "additional-insights-discovery",
      schemaValidationError,
    ).message).toBe("candidates.0 additional properties");
    expect(normalizeOverviewAiStageRuntimeError(
      "additional-insights-discovery",
      new Error("Provider does not support structured_output for this model"),
    ).message).toBe("Provider does not support structured_output for this model");
  });

  it("registers the Evidence-bound Additional transition as an isolated no-tool production stage", () => {
    const structuredOutput = resolveOverviewAiStageStructuredOutput("additional-insights-transition");
    expect(structuredOutput).toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_TRANSITION_STRUCTURED_OUTPUT_V1);
    if (!structuredOutput) throw new Error("Expected Additional transition structured output");
    expect(structuredOutput?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["outcomes"],
    });
    expect(resolveOverviewAiStageRuntimeOptions("additional-insights-transition")).toMatchObject({
      analysisRequirementsMode: "omit",
      disableTools: true,
      structuredOutput,
    });
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "additional-insights-transition",
      identity: additionalIdentity(),
      structuredOutput,
    });
    expect(trusted).toMatchObject({
      structuredOutput,
      conversationMessageMaxChars: MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS,
      trustedStageCapability: "energyiq-additional-insight-transition",
    });
    expect(trusted).not.toHaveProperty("trustedStageTools");
    expect(resolveOverviewAiAgentRuntimeOptions("additional-insights-transition", trusted)).toMatchObject({
      structuredOutput,
      conversationMessageMaxChars: MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS,
      disableTools: true,
    });
    expect(shouldUseEnergyContextForOverviewAiStage("additional-insights-transition")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext("additional-insights-transition")).toBe(false);
    const run = buildOverviewAiStageRunInput({
      stage: "additional-insights-transition",
      prompt: "Compare exact A and B Evidence.",
      identity: additionalIdentity(),
      workspaceId: "preschool-workspace",
      user: { id: "dev-user" } as never,
      runId: "transition-comparison-run",
      sessionId: "transition-comparison-session",
    });
    expect(run.tools).toEqual([]);
    expect(run.forwardedProps).not.toHaveProperty("externalContext");
    expect(run.forwardedProps).toMatchObject({
      run_config: {
        protocol: { id: "general-task", version: "1" },
        skillMode: "none",
        enabledDatasourceIds: [],
        enabledSkillIds: [],
      },
    });
  });

  it("isolates Additional discovery to server-owned contract tools and current EnergyIQ pins", () => {
    const toolNames = [
      "energy.evidence.read",
      "energy.metrics.compare",
      "energy.timeseries.analyze",
      "energy.snapshot-history.read",
      "energy.project-knowledge.read",
    ] as const;
    const invokeAdditionalInsightTool = async () => ({}) as never;
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "additional-insights-discovery",
      identity: additionalIdentity(),
      structuredOutput: PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3,
      additionalInsightTools: toolNames,
      invokeAdditionalInsightTool,
    });

    const currentRuntime = resolveOverviewAiStageRuntimeOptions("additional-insights-discovery");
    expect(currentRuntime).toMatchObject({
      analysisRequirementsMode: "omit",
      disableTools: true,
      excludedToolNames: [
        "skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly", "protocol_handoff",
      ],
      overviewAiCandidateSubmission: false,
    });
    expect(currentRuntime.structuredOutput).toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3);
    expect(trusted).toMatchObject({
      additionalAiInsightSubmission: true,
      disableTools: false,
      conversationMessageMaxChars: MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS,
      runTimeoutMs: 120_000,
      trustedStageCapability: "energyiq-additional-insight-discovery",
    });
    expect(resolveOverviewAiAgentRuntimeOptions("additional-insights-discovery", trusted))
      .toMatchObject({ runTimeoutMs: 120_000 });
    expect(trusted?.structuredOutput).toBeUndefined();
    expect(Object.keys(trusted?.trustedStageTools ?? {}).sort()).toEqual([...toolNames].sort());
    expect(Object.keys(createPreschoolAdditionalAiInsightTrustedStageTools({
      toolNames,
      invoke: invokeAdditionalInsightTool,
    })).sort()).toEqual([...toolNames].sort());
    expect(shouldUseEnergyContextForOverviewAiStage("additional-insights-discovery")).toBe(true);
    expect(shouldIncludeProjectAnalysisEvidenceContext("additional-insights-discovery")).toBe(false);

    const run = buildOverviewAiStageRunInput({
      stage: "additional-insights-discovery",
      prompt: "Open discovery.",
      identity: additionalIdentity(),
      workspaceId: "preschool-workspace",
      user: { id: "dev-user" } as never,
      runId: "additional-run",
      sessionId: "additional-session",
    });
    expect(run.tools).toEqual([]);
    expect((Reflect.get(run.forwardedProps, "run_config") as {
      protocol?: { id: string; version: string };
    }).protocol).not.toEqual({ id: "data-analysis", version: "1" });
    expect(run.forwardedProps).toMatchObject({
      externalContext: {
        source: "energyiq",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
        overviewAiStage: "additional-insights-discovery",
      },
      run_config: {
        skillMode: "none",
        enabledMcpServerIds: [],
        enabledSkillIds: [],
        skillPolicy: { allowedToolNames: [] },
      },
    });

    const ngeeAnnIdentity = ngeeAnnAdditionalIdentity();
    const ngeeAnnTrusted = resolveOverviewAiServerRunnerOptions({
      stage: "additional-insights-discovery",
      identity: ngeeAnnIdentity,
      structuredOutput: PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3,
      additionalInsightTools: toolNames,
      invokeAdditionalInsightTool,
    });
    expect(ngeeAnnTrusted).toMatchObject({
      trustedStageCapability: "energyiq-additional-insight-discovery",
      conversationMessageMaxChars: MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS,
    });
    expect(ngeeAnnTrusted?.structuredOutput).toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3);
    expect(ngeeAnnTrusted).not.toHaveProperty("additionalAiInsightSubmission");
    const ngeeAnnRun = buildOverviewAiStageRunInput({
      stage: "additional-insights-discovery",
      prompt: "Open Ngee Ann discovery.",
      identity: ngeeAnnIdentity,
      workspaceId: ngeeAnnIdentity.workspaceId,
      user: { id: "dev-user" } as never,
      runId: "ngee-ann-additional-run",
      sessionId: "ngee-ann-additional-session",
    });
    expect(ngeeAnnRun.forwardedProps).toMatchObject({
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
        overviewAiStage: "additional-insights-discovery",
      },
      run_config: {
        protocol: { id: "general-task", version: "1" },
      },
    });
  });

  it("registers Additional tools and separates local schema failures from Provider validation", async () => {
    const toolNames = [
      "energy.evidence.read",
      "energy.metrics.compare",
      "energy.timeseries.analyze",
      "energy.snapshot-history.read",
      "energy.project-knowledge.read",
    ] as const;
    const identity = additionalIdentity();
    const catalog = additionalEvidenceCatalog();
    const input = buildOverviewAiStageRunInput({
      stage: "additional-insights-discovery",
      prompt: "Open discovery.",
      identity,
      workspaceId: identity.workspaceId,
      user: { id: "dev-user" } as never,
      runId: "additional-runtime-run",
      sessionId: "additional-runtime-session",
    });
    const protocol = (Reflect.get(input.forwardedProps, "run_config") as {
      protocol?: { id: string; version: string };
    }).protocol;
    if (!protocol) throw new Error("Expected server-owned Additional protocol");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "preschool-additional-runtime-"));
    let runtime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    let ordinaryRuntime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    let transitionRuntime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    try {
      const trusted = resolveOverviewAiServerRunnerOptions({
        stage: "additional-insights-discovery",
        identity,
        structuredOutput: PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3,
        additionalInsightTools: toolNames,
        invokeAdditionalInsightTool: async ({ toolCallId }) => ({
          auditId: `additional-tool-audit:${toolCallId}`,
          evidenceRefs: [catalog.facts[0]!.id],
          facts: [catalog.facts[0]!],
        }),
      });
      if (!trusted?.trustedStageTools || !trusted.trustedStageCapability) {
        throw new Error("Expected server-owned Additional tools and capability");
      }
      runtime = await createDataFoundry({
        ...(trusted.additionalAiInsightSubmission
          ? { additionalAiInsightSubmission: true }
          : {}),
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        excludedToolNames: [
          "skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly", "protocol_handoff",
        ],
        contextEvidenceCatalog: catalog,
        explicitProtocol: { protocolId: protocol.id, protocolVersion: protocol.version },
        messages: input.messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "additional-runtime-session",
          run_id: "additional-runtime-run",
          user_input: "Open discovery.",
          chat_mode: "copilotkit",
          model_name: "test-model",
          energy_query_context: {
            projectId: identity.projectId,
            projectName: "Preschool Portfolio",
            scopeId: identity.scopeId,
            scopeName: "Preschool Portfolio",
            scopeType: "project",
            resource: "electricity",
            timezone: "Asia/Singapore",
            from: identity.analysisPeriodFrom,
            to: identity.analysisPeriodTo,
            endExclusive: true,
            period: "Custom",
          },
        }),
        trustedStageTools: trusted.trustedStageTools,
        trustedStageCapability: trusted.trustedStageCapability,
        workspaceRoot,
      });
      const tools = await runtime.agent.listTools() as Record<string, {
        execute?: (input: unknown, options: unknown) => Promise<unknown>;
      }>;
      expect(Object.keys(tools).sort()).toEqual([
        ...toolNames,
        "energyiq_additional_insights_submit",
      ].sort());
      await expect(tools["energy.evidence.read"]?.execute?.(
        { factIds: [catalog.facts[0]!.id] },
        { agent: { toolCallId: "additional-evidence-read" } },
      )).resolves.toMatchObject({
        evidenceRefs: [catalog.facts[0]!.id],
      });

      const instructions = await runtime.agent.getInstructions();
      const instructionText = typeof instructions === "string" ? instructions : JSON.stringify(instructions);
      expect.soft(instructionText).toContain("Server-scoped read-only tools");
      expect.soft(instructionText).not.toContain("EnergyIQ selection-only path");
      expect.soft(instructionText).not.toContain("Do not call, request, or simulate");
      expect.soft(instructionText).not.toContain(
        "What happened, Why it matters or may have happened, What to do next",
      );

      let completed: unknown;
      let failed: string | undefined;
      await completeProtocolRun({
        finalizer: {
          complete: async ({ terminalDecision }) => { completed = terminalDecision; },
          fail: ({ errorMessage }) => { failed = errorMessage; },
        },
        lastAssistantMessageId: "additional-structured-answer",
        protocol: runtime.protocol,
        runId: "additional-runtime-run",
        terminalEvent: { type: EventType.RUN_FINISHED, timestamp: Date.now() },
      });
      expect(failed).toBeUndefined();
      expect.soft(completed && typeof completed === "object" && "missing" in completed
        ? (completed as { missing: string[] }).missing
        : []).toEqual([]);
      expect(completed).toMatchObject({ status: "completed" });

      await expect(createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        explicitProtocol: { protocolId: "general-task", protocolVersion: "1" },
        messages: input.messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "non-additional-runtime-session",
          run_id: "non-additional-runtime-run",
          user_input: "Ordinary general task.",
          chat_mode: "copilotkit",
          model_name: "test-model",
          energy_query_context: {
            projectId: identity.projectId,
            projectName: "Preschool Portfolio",
            scopeId: identity.scopeId,
            scopeName: "Preschool Portfolio",
            scopeType: "project",
            resource: "electricity",
            timezone: "Asia/Singapore",
            from: identity.analysisPeriodFrom,
            to: identity.analysisPeriodTo,
            endExclusive: true,
            period: "Custom",
          },
        }),
        trustedStageTools: trusted.trustedStageTools,
        workspaceRoot,
      })).rejects.toThrow("TRUSTED_STAGE_CAPABILITY_INVALID");
      ordinaryRuntime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        explicitProtocol: { protocolId: "general-task", protocolVersion: "1" },
        messages: input.messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "non-additional-runtime-session",
          run_id: "non-additional-runtime-run",
          user_input: "Ordinary general task.",
          chat_mode: "copilotkit",
          model_name: "test-model",
          energy_query_context: {
            projectId: identity.projectId,
            projectName: "Preschool Portfolio",
            scopeId: identity.scopeId,
            scopeName: "Preschool Portfolio",
            scopeType: "project",
            resource: "electricity",
            timezone: "Asia/Singapore",
            from: identity.analysisPeriodFrom,
            to: identity.analysisPeriodTo,
            endExclusive: true,
            period: "Custom",
          },
        }),
        workspaceRoot,
      });
      expect(Object.keys(await ordinaryRuntime.agent.listTools()))
        .not.toEqual(expect.arrayContaining([...toolNames]));
      const ordinaryInstructions = await ordinaryRuntime.agent.getInstructions();
      const ordinaryInstructionText = typeof ordinaryInstructions === "string"
        ? ordinaryInstructions
        : JSON.stringify(ordinaryInstructions);
      expect(ordinaryInstructionText).toContain("EnergyIQ selection-only path");
      expect(ordinaryInstructionText).not.toContain("EnergyIQ server-scoped discovery path");

      const transitionStructuredOutput = resolveOverviewAiStageStructuredOutput("additional-insights-transition");
      if (!transitionStructuredOutput) throw new Error("Expected transition structured output");
      const transitionTrusted = resolveOverviewAiServerRunnerOptions({
        stage: "additional-insights-transition",
        identity,
        structuredOutput: transitionStructuredOutput,
      });
      const transitionOptions = resolveOverviewAiAgentRuntimeOptions(
        "additional-insights-transition",
        transitionTrusted,
      );
      if (!transitionOptions.structuredOutput || !transitionOptions.trustedStageCapability) {
        throw new Error("Expected transition runtime options");
      }
      expect(transitionOptions.trustedStageCapability)
        .toBe("energyiq-additional-insight-transition");
      transitionRuntime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        disableTools: true,
        emitter: { emit: () => undefined },
        explicitProtocol: { protocolId: "general-task", protocolVersion: "1" },
        messages: [{ id: "transition-user", role: "user", content: "Compare exact A and B." }],
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "transition-runtime-session",
          run_id: "transition-runtime-run",
          user_input: "Compare exact A and B.",
          chat_mode: "copilotkit",
          model_name: "test-model",
        }),
        structuredOutput: transitionOptions.structuredOutput,
        trustedStageCapability: transitionOptions.trustedStageCapability,
        workspaceRoot,
      });
      const transitionInstructions = await transitionRuntime.agent.getInstructions();
      const transitionInstructionText = typeof transitionInstructions === "string"
        ? transitionInstructions
        : JSON.stringify(transitionInstructions);
      expect(transitionInstructionText).toContain("EnergyIQ server-scoped transition path");
      expect(transitionInstructionText).toContain("exact A and B Finding and Evidence lineage");
      expect(transitionInstructionText).not.toContain(
        "What happened, Why it matters or may have happened, What to do next",
      );
      const transitionProtocol = transitionRuntime.protocol;
      const metadata = createMetadataStore({
        database_path: join(workspaceRoot, "transition-agent-metadata.sqlite"),
        secret_master_key: "transition-agent-test-key",
      });
      try {
        metadata.users.upsertDevUser({
          id: "dev-user",
          email: "dev@example.test",
          display_name: "Developer",
          dev_token: "dev-token",
        });
        metadata.workspaces.upsert({
          id: identity.workspaceId,
          owner_user_id: "dev-user",
          name: "Preschool",
          kind: "customer",
        });
        metadata.workspaces.upsert({
          id: "default",
          owner_user_id: "dev-user",
          name: "Default",
          kind: "personal",
        });
        const modelSecret = metadata.secrets.put({
          workspace_id: identity.workspaceId,
          user_id: "dev-user",
          owner_kind: "model-profile",
          owner_id: "test-model-profile",
          value: { apiKey: "server-only-test-key" },
        });
        const modelResource = metadata.configResources.upsert({
          id: "test-model-profile",
          workspace_id: identity.workspaceId,
          user_id: "dev-user",
          kind: "model-profile",
          name: "Test model",
          payload: {
            provider: "openai-compatible",
            modelName: "test-model",
            baseUrl: "https://provider.invalid/v1",
          },
          secret_ref: modelSecret,
          status: "connected",
        });
        const eventIdentity = {
          ...identity,
          modelProfileId: modelResource.id,
          modelProfileRevision: modelResource.revision,
        };
        const eventTransitionTrusted = resolveOverviewAiServerRunnerOptions({
          stage: "additional-insights-transition",
          identity: eventIdentity,
          structuredOutput: transitionStructuredOutput,
        });
        if (!eventTransitionTrusted) throw new Error("Expected event transition runtime options");
        let assemblyCapability: unknown;
        let stageFailure: { kind: "local-schema"; value: Record<string, unknown> }
          | { kind: "provider"; error: unknown }
          | undefined;
        const transitionAgent = new DataFoundryAgUiAgent({
          artifactService: {} as never,
          completedMemoryFlushOverride: async () => undefined,
          conversationMemoryMode: "off",
          dataGateway: {} as never,
          fileAssetService: { gcOrphanAssets: () => 0 } as never,
          knowledgeService: {} as never,
          memoryExtractionTimeoutMs: 50,
          metadataStore: metadata,
          overviewAiStage: "additional-insights-transition",
          overviewAiTrustedRuntimeOverride: eventTransitionTrusted,
          runAgentAssemblyFactory: async (assemblyInput) => {
            assemblyCapability = assemblyInput.trustedStageCapability;
            return {
              destroyWorkspace: async () => undefined,
              flushProtocolEvents: () => undefined,
              governedMessages: assemblyInput.messages,
              loadedSkills: [],
              materializedSkills: [],
              mastraAgent: {
                run: () => new Observable((subscriber) => {
                  if (stageFailure?.kind === "provider") {
                    subscriber.error(stageFailure.error);
                    return;
                  }
                  if (stageFailure?.kind === "local-schema") {
                    if (!assemblyInput.structuredOutput) {
                      subscriber.error(new Error("Expected local structured-output schema"));
                      return;
                    }
                    const value = stageFailure.value;
                    const schema = toStandardSchema(assemblyInput.structuredOutput.schema);
                    void Promise.resolve(schema["~standard"].validate(value)).then(
                      (result) => subscriber.error(new TypeValidationError({
                        value,
                        cause: new Error(`Local schema issues: ${JSON.stringify("issues" in result ? result.issues : [])}`),
                      })),
                      (error) => subscriber.error(new TypeValidationError({ value, cause: error })),
                    );
                    return;
                  }
                  subscriber.next({
                    type: EventType.TEXT_MESSAGE_START,
                    messageId: "transition-structured-answer",
                    role: "assistant",
                    timestamp: Date.now(),
                  } as never);
                  subscriber.next({
                    type: EventType.TEXT_MESSAGE_CONTENT,
                    messageId: "transition-structured-answer",
                    delta: '{"outcomes":[]}',
                    timestamp: Date.now(),
                  } as never);
                  subscriber.next({
                    type: EventType.TEXT_MESSAGE_END,
                    messageId: "transition-structured-answer",
                    timestamp: Date.now(),
                  } as never);
                  subscriber.next({ type: EventType.RUN_FINISHED, timestamp: Date.now() } as never);
                  subscriber.complete();
                }),
              } as never,
              protocol: transitionProtocol,
              sessionDir: join(workspaceRoot, "transition-agent-session"),
              workspace: { command_execution_enabled: false, isolation: "none" },
              workspaceDir: workspaceRoot,
            };
          },
          runCancelRegistry: new RunCancelRegistry(),
          sessionOutputService: {} as never,
          taskStateRuntime: {} as never,
          traceSectionSummaries: false,
          user: { id: "dev-user", email: "dev@example.test", display_name: "Developer" },
          workspaceId: identity.workspaceId,
          workspaceRoot,
        });
        const stageInput = {
          stage: "additional-insights-transition" as const,
          prompt: [
            "Compare exact A and B Evidence.",
            `Snapshot: ${eventIdentity.dataSnapshotId}`,
            `Release: ${eventIdentity.projectReleaseId}`,
            `Period from: ${eventIdentity.analysisPeriodFrom}`,
            `Period to: ${eventIdentity.analysisPeriodTo}`,
          ].join("\n"),
          identity: eventIdentity,
          workspaceId: identity.workspaceId,
          user: { id: "dev-user" } as never,
          runId: "transition-runtime-run",
          sessionId: "transition-runtime-session",
          trustedRuntimeOverride: eventTransitionTrusted,
        };
        const completedTransition = await collectOverviewAiStageEvents(transitionAgent, stageInput, metadata);
        expect(assemblyCapability).toBe("energyiq-additional-insight-transition");
        expect(collectOverviewAiText(completedTransition.events)).toBe('{"outcomes":[]}');
        expect(metadata.runs.find({ user_id: "dev-user", run_id: "transition-runtime-run" }))
          .toMatchObject({ status: "completed", session_id: "transition-runtime-session" });

        stageFailure = { kind: "local-schema", value: { outcomes: [{ extra: true }] } };
        await expect(collectOverviewAiStageEvents(transitionAgent, {
          ...stageInput,
          runId: "transition-schema-invalid-run",
          sessionId: "transition-schema-invalid-session",
        }, metadata)).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID");
        expect(metadata.runs.find({ user_id: "dev-user", run_id: "transition-schema-invalid-run" }))
          .toMatchObject({
            status: "failed",
            error_message: "PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID",
          });

        stageFailure = {
          kind: "provider",
          error: new APICallError({
            message: "Provider response schema validation failed",
            url: "https://provider.invalid/v1/chat/completions",
            requestBodyValues: { model: "test-model" },
            statusCode: 502,
            cause: new TypeValidationError({
              value: { providerEnvelope: "malformed" },
              cause: new Error("provider response field missing"),
            }),
            isRetryable: false,
          }),
        };
        await expect(collectOverviewAiStageEvents(transitionAgent, {
          ...stageInput,
          runId: "transition-provider-schema-invalid-run",
          sessionId: "transition-provider-schema-invalid-session",
        }, metadata)).rejects.toThrow("Provider response schema validation failed");
        expect(metadata.runs.find({ user_id: "dev-user", run_id: "transition-provider-schema-invalid-run" }))
          .toMatchObject({
            status: "failed",
            error_message: "Provider response schema validation failed",
          });
      } finally {
        metadata.close();
      }

      const ordinary = resolveOverviewAiServerRunnerOptions({
        stage: "executive-synthesis",
        structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
        additionalInsightTools: toolNames,
        invokeAdditionalInsightTool: async () => ({}) as never,
      });
      expect(ordinary).not.toHaveProperty("trustedStageTools");
    } finally {
      await transitionRuntime?.destroyWorkspace();
      await ordinaryRuntime?.destroyWorkspace();
      await runtime?.destroyWorkspace();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps historical Additional v3 reservations on their reserved protocol and without v4 capabilities", () => {
    const historical = historicalAdditionalIdentity();
    for (const stage of ["additional-insights-discovery", "additional-insights-transition"] as const) {
      const run = buildOverviewAiStageRunInput({
        stage,
        prompt: "Resume historical reservation.",
        identity: historical,
        workspaceId: historical.workspaceId,
        user: { id: "dev-user" } as never,
        runId: `historical-${stage}-run`,
        sessionId: `historical-${stage}-session`,
      });
      expect(run.forwardedProps).toMatchObject({
        run_config: { protocol: { id: "data-analysis", version: "1" } },
      });
      const structuredOutput = resolveOverviewAiStageStructuredOutput(stage);
      if (!structuredOutput) throw new Error("Expected historical Additional structured output");
      const trusted = resolveOverviewAiServerRunnerOptions({
        stage,
        identity: historical,
        structuredOutput,
        ...(stage === "additional-insights-discovery"
          ? {
              additionalInsightTools: ["energy.evidence.read"] as const,
              invokeAdditionalInsightTool: async () => ({}) as never,
            }
          : {}),
      });
      expect(trusted).not.toHaveProperty("trustedStageCapability");
    }
  });

  it("keeps the investigator on the narrow Artifact path with DeepSeek thinking disabled", () => {
    expect(resolveOverviewAiStageRuntimeOptions("investigator")).toEqual({
      analysisRequirementsMode: "omit",
      excludedToolNames: ["protocol_handoff"],
      overviewAiCandidateSubmission: true,
      reasoningModel: false,
    });
  });

  it("keeps the editor on the same narrow path without Schema or SQL tools", () => {
    expect(resolveOverviewAiStageRuntimeOptions("editor")).toEqual({
      analysisRequirementsMode: "omit",
      excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
      overviewAiCandidateSubmission: false,
      reasoningModel: false,
    });
  });

  it.each(["section-interpreter", "executive-synthesis"] as const)(
    "keeps %s lightweight with no Skill, Schema, SQL, handoff, or candidate submission",
    (stage) => {
      expect(resolveOverviewAiStageRuntimeOptions(stage)).toEqual({
        analysisRequirementsMode: "omit",
        conversationMessageMaxChars: stage === "section-interpreter" ? 12_000 : 24_000,
        disableTools: true,
        excludedToolNames: [
          "skill",
          "skill_search",
          "skill_read",
          "inspect_schema",
          "run_sql_readonly",
          "protocol_handoff",
        ],
        overviewAiCandidateSubmission: false,
        reasoningModel: false,
        structuredOutput: resolveOverviewAiStageStructuredOutput(stage),
      });
      expect(shouldIncludeProjectAnalysisEvidenceContext(stage)).toBe(false);
      expect(shouldUseEnergyContextForOverviewAiStage(stage)).toBe(stage === "section-interpreter");
    },
  );

  it("runs template proposals as a bounded structured-value stage with no tools or Energy context", () => {
    expect(resolveOverviewAiStageRuntimeOptions("template-proposal")).toEqual({
      analysisRequirementsMode: "omit",
      conversationMessageMaxChars: 24_000,
      disableTools: true,
      excludedToolNames: [
        "skill",
        "skill_search",
        "skill_read",
        "inspect_schema",
        "run_sql_readonly",
        "protocol_handoff",
      ],
      overviewAiCandidateSubmission: false,
      reasoningModel: false,
      structuredOutput: resolveOverviewAiStageStructuredOutput("template-proposal"),
    });
    expect(resolveOverviewAiStageStructuredOutput("template-proposal")?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["contractRevision", "title", "rationale", "desiredDefinition"],
    });
    expect(shouldUseEnergyContextForOverviewAiStage("template-proposal")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext("template-proposal")).toBe(false);
  });

  it.each([
    ["section-interpreter", "sectionId"],
    ["executive-synthesis", "keyFindings"],
  ] as const)("pins %s to its native structured-output envelope", (stage, requiredProperty) => {
    const structuredOutput = resolveOverviewAiStageStructuredOutput(stage);
    expect(structuredOutput).toBeDefined();
    expect(structuredOutput?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining([requiredProperty]),
    });
    expect(resolveOverviewAiStageRuntimeOptions(stage).structuredOutput).toBe(structuredOutput);
  });

  it.each(["investigator", "editor"] as const)(
    "does not force the agentic %s stage into a value-output schema",
    (stage) => {
      expect(resolveOverviewAiStageStructuredOutput(stage)).toBeUndefined();
      expect(resolveOverviewAiStageRuntimeOptions(stage)).not.toHaveProperty("structuredOutput");
    },
  );

  it("allows the isolated Section value contract to return empty or 1-4 useful points", () => {
    const structuredOutput = resolveOverviewAiStageStructuredOutput("section-interpreter");
    expect(structuredOutput?.schema).toMatchObject({
      required: ["sectionId", "status"],
      properties: {
        keyPoints: { minItems: 0, maxItems: 4 },
      },
    });
  });

  it("threads the trusted Pack-v2 Section override through the real agent options", () => {
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
    });
    expect(trusted).toEqual({
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: 110_000,
    });

    expect(resolveOverviewAiAgentRuntimeOptions("section-interpreter", trusted)).toMatchObject({
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: 110_000,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("section-interpreter", undefined)).toMatchObject({
      structuredOutput: resolveOverviewAiStageStructuredOutput("section-interpreter"),
      conversationMessageMaxChars: 12_000,
    });
  });

  it("exposes server-owned scoped tools only to the trusted Section stage runtime", () => {
    const toolNames = [
      "compare_centres",
      "inspect_time_pattern",
      "inspect_load_composition",
      "inspect_related_section_signals",
    ] as const;
    const invokeSectionInsightTool = async () => ({}) as never;
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
      sectionInsightTools: toolNames,
      invokeSectionInsightTool,
    });

    expect(trusted).toMatchObject({ disableTools: false });
    expect(Object.keys(trusted?.trustedStageTools ?? {}).sort()).toEqual([...toolNames].sort());
    expect(Object.keys(createPreschoolSectionTrustedStageTools({
      toolNames,
      invoke: invokeSectionInsightTool,
    })).sort()).toEqual([...toolNames].sort());
    expect(resolveOverviewAiAgentRuntimeOptions("section-interpreter", trusted).trustedStageTools)
      .toBe(trusted?.trustedStageTools);

    const executive = resolveOverviewAiServerRunnerOptions({
      stage: "executive-synthesis",
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
    });
    expect(executive).not.toHaveProperty("trustedStageTools");
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", executive)).toMatchObject({
      disableTools: true,
    });
    expect(resolveOverviewAiStageRuntimeOptions("investigator")).not.toHaveProperty("trustedStageTools");
  });

  it("threads the trusted V4 Executive override without changing the legacy default", () => {
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "executive-synthesis",
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
    });
    expect(trusted).toEqual({
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", trusted)).toMatchObject({
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", undefined)).toMatchObject({
      structuredOutput: resolveOverviewAiStageStructuredOutput("executive-synthesis"),
      conversationMessageMaxChars: 24_000,
    });
  });

  it("does not expose trusted runtime overrides through browser-forwarded props", () => {
    const input = buildOverviewAiStageRunInput({
      stage: "section-interpreter",
      prompt: "Return JSON only.",
      identity: {
        workspaceId: "preschool-workspace",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        resource: "electricity",
        dataSnapshotId: "snapshot-current",
        projectReleaseId: "release-current",
        analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
        analysisPeriodTo: "2026-06-01T00:00:00.000Z",
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        analysisPackId: "preschool-section-pack",
        analysisPackRevision: "v2",
        modelProfileId: "workspace-default",
        modelProfileRevision: 1,
        outputContractRevision: "preschool-section-interpretation-v4",
        validatorRevision: "acceptance-validator-v1",
        workflowRevision: "discover-accept-publish-v1",
        investigatorPromptRevision: "discovery-prompt-v1",
        editorPromptRevision: "not-applicable-v1",
        methodSkillId: "none",
        methodSkillRevision: "not-applicable-v1",
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
      },
      workspaceId: "preschool-workspace",
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "section-run",
      sessionId: "section-session",
      trustedRuntimeOverride: {
        structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
        conversationMessageMaxChars: 110_000,
      },
    });
    expect(input.forwardedProps).not.toHaveProperty("trustedRuntimeOverride");
    expect(input.forwardedProps).not.toHaveProperty("structuredOutput");
    expect(input.forwardedProps).not.toHaveProperty("conversationMessageMaxChars");
    expect(input.forwardedProps).not.toHaveProperty("trustedStageTools");
  });

  it("persists exact server-owned Section Snapshot, Release and period pins in the user message", () => {
    const identity = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "energy-snapshot-563f8939fd90dc2fbef0018a",
      projectReleaseId: "preschool-demo-template-v2",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-section-pack",
      analysisPackRevision: "v2",
      modelProfileId: "workspace-default",
      modelProfileRevision: 7,
      outputContractRevision: "preschool-section-interpretation-v4",
      validatorRevision: "acceptance-validator-v1",
      workflowRevision: "discover-accept-publish-v1",
      investigatorPromptRevision: "discovery-prompt-v2",
      editorPromptRevision: "not-applicable-v1",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      artifactKind: "section-interpretation" as const,
      targetId: "centre-benchmark",
    } as const satisfies EnergyIqOverviewAiArtifactIdentity;
    const input = buildOverviewAiStageRunInput({
      stage: "section-interpreter",
      prompt: "Bounded Section model projection without caller-authored identity.",
      identity,
      workspaceId: identity.workspaceId,
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "section-run-pins",
      sessionId: "section-session-pins",
    });
    const persistedUserInput = input.messages[0]?.content;
    if (typeof persistedUserInput !== "string") throw new Error("Expected one text user message");

    expect([
      identity.dataSnapshotId,
      identity.projectReleaseId,
      identity.analysisPeriodFrom,
      identity.analysisPeriodTo,
    ].filter((pin) => !persistedUserInput.includes(pin))).toEqual([]);
  });

  it("runs a Section from its immutable Overview package without recomputing the full analysis", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "overview-package-section-runtime-"));
    const databasePath = join(workspaceRoot, "energy.duckdb");
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    const metadata = createMetadataStore({
      database_path: join(workspaceRoot, "metadata.sqlite"),
      secret_master_key: "overview-package-section-test-key",
    });
    let protocolRuntime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
      const user = metadata.users.getById({ user_id: "dev-user" });
      const published = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
      });
      if (!published.projectRelease) throw new Error("Expected a published Preschool release");
      const modelSecret = metadata.secrets.put({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        owner_kind: "model-profile",
        owner_id: "overview-package-test-model",
        value: { apiKey: "server-only-test-key" },
      });
      const modelResource = metadata.configResources.upsert({
        id: "overview-package-test-model",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Overview package test model",
        payload: {
          provider: "openai-compatible",
          modelName: "test-model",
          baseUrl: "https://provider.invalid/v1",
        },
        secret_ref: modelSecret,
        status: "connected",
      });
      const identity = {
        ...additionalIdentity(),
        workspaceId: published.context.workspaceId,
        projectId: published.context.projectId,
        scopeId: published.context.scopeId,
        dataSnapshotId: published.context.dataSnapshotId,
        projectReleaseId: published.projectRelease.id,
        analysisPeriodFrom: published.context.from,
        analysisPeriodTo: published.context.to,
        modelProfileId: modelResource.id,
        modelProfileRevision: modelResource.revision,
        artifactKind: "section-interpretation" as const,
        targetId: "standby-wastage",
        methodSkillId: "none",
        methodSkillRevision: "not-applicable-v1",
      } satisfies EnergyIqOverviewAiArtifactIdentity;
      const stageInput = {
        stage: "section-interpreter" as const,
        prompt: "Interpret only the immutable Overview Section Pack.",
        identity,
        workspaceId: identity.workspaceId,
        user,
        runId: "overview-package-section-run",
        sessionId: "overview-package-section-session",
      };
      const dataGateway = new LocalDataGateway(metadata);
      const fullComputeSession = vi.spyOn(dataGateway, "withEnergySnapshotReadSession");
      const fullComputeSql = vi.spyOn(dataGateway, "runSqlReadonly");
      protocolRuntime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
        explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
        messages: buildOverviewAiStageRunInput(stageInput).messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: user.id,
          workspace_id: PRESCHOOL_WORKSPACE_ID,
          session_id: stageInput.sessionId,
          run_id: stageInput.runId,
          user_input: stageInput.prompt,
          chat_mode: "copilotkit",
          model_name: "test-model",
        }),
        workspaceRoot,
      });
      let scopedAnalysisGrounder: unknown;
      const agent = new DataFoundryAgUiAgent({
        artifactService: {} as never,
        completedMemoryFlushOverride: async () => undefined,
        conversationMemoryMode: "off",
        dataGateway,
        fileAssetService: { gcOrphanAssets: () => 0 } as never,
        knowledgeService: {} as never,
        memoryExtractionTimeoutMs: 50,
        metadataStore: metadata,
        overviewAiStage: stageInput.stage,
        runAgentAssemblyFactory: async (assemblyInput) => {
          scopedAnalysisGrounder = assemblyInput.analysisContractGrounder;
          return {
            destroyWorkspace: async () => undefined,
            flushProtocolEvents: () => undefined,
            governedMessages: assemblyInput.messages,
            loadedSkills: [],
            materializedSkills: [],
            mastraAgent: {
              run: () => new Observable((subscriber) => {
                subscriber.next({
                  type: EventType.TEXT_MESSAGE_START,
                  messageId: "section-answer",
                  role: "assistant",
                  timestamp: Date.now(),
                } as never);
                subscriber.next({
                  type: EventType.TEXT_MESSAGE_CONTENT,
                  messageId: "section-answer",
                  delta: JSON.stringify({
                    sectionId: "standby-wastage",
                    status: "insufficient-evidence",
                    keyPoints: [],
                  }),
                  timestamp: Date.now(),
                } as never);
                subscriber.next({
                  type: EventType.TEXT_MESSAGE_END,
                  messageId: "section-answer",
                  timestamp: Date.now(),
                } as never);
                subscriber.next({ type: EventType.RUN_FINISHED, timestamp: Date.now() } as never);
                subscriber.complete();
              }),
            } as never,
            protocol: protocolRuntime!.protocol,
            sessionDir: join(workspaceRoot, "section-session"),
            workspace: { command_execution_enabled: false, isolation: "none" },
            workspaceDir: workspaceRoot,
          };
        },
        runCancelRegistry: new RunCancelRegistry(),
        sessionOutputService: {} as never,
        taskStateRuntime: {} as never,
        traceSectionSummaries: false,
        user: {
          id: user.id,
          ...(user.email ? { email: user.email } : {}),
          ...(user.display_name ? { display_name: user.display_name } : {}),
        },
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        workspaceRoot,
      });

      await expect(collectOverviewAiStageEvents(agent, stageInput, metadata)).resolves.toMatchObject({
        completedRun: { runId: stageInput.runId, sessionId: stageInput.sessionId },
      });
      expect(fullComputeSession).not.toHaveBeenCalled();
      expect(fullComputeSql).not.toHaveBeenCalled();
      expect(scopedAnalysisGrounder).toBeTypeOf("function");
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      await protocolRuntime?.destroyWorkspace();
      metadata.close();
      removeTemporaryOverviewAiStageFixture(workspaceRoot);
    }
  });

  it("constructs the real governed runtime for server-owned Section tools from server-owned Energy context", async () => {
    const identity = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "energy-snapshot-563f8939fd90dc2fbef0018a",
      projectReleaseId: "preschool-demo-template-v2",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-section-pack",
      analysisPackRevision: "v2",
      modelProfileId: "workspace-default",
      modelProfileRevision: 7,
      outputContractRevision: "preschool-section-interpretation-v4",
      validatorRevision: "acceptance-validator-v1",
      workflowRevision: "discover-accept-publish-v1",
      investigatorPromptRevision: "discovery-prompt-v2",
      editorPromptRevision: "not-applicable-v1",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      artifactKind: "section-interpretation" as const,
      targetId: "standby-wastage",
    } as const satisfies EnergyIqOverviewAiArtifactIdentity;
    const pack: PreschoolSectionPackV2 = {
      contract: { id: "preschool-section-pack", revision: "preschool-section-pack-v2" },
      sectionId: "standby-wastage",
      audience: "non-technical energy manager",
      analysisGoal: "Identify supported closed-hour patterns.",
      binding: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
        analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
        modelProfileId: identity.modelProfileId,
        modelProfileRevision: identity.modelProfileRevision,
      },
      evidence: [{
        id: "evidence:standby:summary",
        label: "Closed-hours summary",
        value: { closedHoursSharePct: 12 },
        unit: "%",
        entityRefs: [],
        evidenceRefs: ["evidence:standby:summary"],
      }],
      alreadyPresentedFacts: [],
      crossSectionIndex: [],
      dataQuality: {
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 1,
        qualityEventCount: 0,
        cumulativeDeltaMismatchCount: 0,
        averageKwMismatchCount: 0,
        invalidIntervalDurationCount: 0,
        importBatchIds: [],
      },
      limitations: [],
      missingEvidence: [],
      capabilities: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        tools: ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"],
      },
    };
    const input = buildOverviewAiStageRunInput({
      stage: "section-interpreter",
      prompt: buildPreschoolSectionDiscoveryPrompt(pack),
      identity,
      workspaceId: identity.workspaceId,
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "section-run",
      sessionId: "section-session",
    });
    const externalContext = Reflect.get(input.forwardedProps, "externalContext") as {
      projectId: string;
      scopeId: string;
      resource: "electricity";
      from: string;
      to: string;
      period: "Custom";
    } | undefined;
    const workspaceRoot = mkdtempSync(join(tmpdir(), "preschool-section-runtime-red-"));
    let runtime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    try {
      runtime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
        explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
        messages: input.messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "section-session",
          run_id: "section-run",
          user_input: buildPreschoolSectionDiscoveryPrompt(pack),
          chat_mode: "copilotkit",
          model_name: "test-model",
          ...(externalContext
            ? {
                energy_query_context: {
                  projectId: externalContext.projectId,
                  projectName: "Preschool Portfolio",
                  scopeId: externalContext.scopeId,
                  scopeName: "Preschool Portfolio",
                  scopeType: "project",
                  resource: externalContext.resource,
                  timezone: "Asia/Singapore",
                  from: externalContext.from,
                  to: externalContext.to,
                  endExclusive: true,
                  period: externalContext.period,
                },
              }
            : {}),
        }),
        trustedStageTools: createPreschoolSectionTrustedStageTools({
          toolNames: pack.capabilities.tools,
          invoke: async () => ({}) as never,
        }),
        workspaceRoot,
      });
      expect(Object.keys(await runtime.agent.listTools()).sort()).toEqual([...pack.capabilities.tools].sort());
    } finally {
      await runtime?.destroyWorkspace();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("carries the bounded current-v4 Executive projection through the real governed runtime without Energy or SQL tools", async () => {
    const identity = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "energy-snapshot-563f8939fd90dc2fbef0018a",
      projectReleaseId: "preschool-demo-template-v2",
      analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
      analysisPeriodTo: "2026-05-31T16:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-executive-section-artifacts",
      analysisPackRevision: "section-interpretation-v4",
      modelProfileId: "workspace-default",
      modelProfileRevision: 7,
      outputContractRevision: "preschool-executive-synthesis-v4",
      validatorRevision: "preschool-executive-synthesis-validator-v5",
      workflowRevision: "preschool-executive-synthesis-v5",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v5",
      editorPromptRevision: "not-applicable-v1",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      artifactKind: "executive-synthesis" as const,
      targetId: "sections:current-v4",
    } as const satisfies EnergyIqOverviewAiArtifactIdentity;
    const prompt = "E".repeat(MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS);
    const input = buildOverviewAiStageRunInput({
      stage: "executive-synthesis",
      prompt,
      identity,
      workspaceId: identity.workspaceId,
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "executive-run-budget",
      sessionId: "executive-session-budget",
    });
    expect(input.messages[0]?.content).toBe(prompt);
    expect(input.forwardedProps).not.toHaveProperty("externalContext");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "preschool-executive-runtime-budget-"));
    let runtime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    try {
      runtime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
        explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
        messages: input.messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "executive-session-budget",
          run_id: "executive-run-budget",
          user_input: prompt,
          chat_mode: "copilotkit",
          model_name: "test-model",
        }),
        workspaceRoot,
      });
      const toolNames = Object.keys(await runtime.agent.listTools());
      expect(toolNames).not.toEqual(expect.arrayContaining([
        "inspect_schema",
        "run_sql_readonly",
        "protocol_handoff",
        "compare_centres",
        "inspect_time_pattern",
        "inspect_load_composition",
        "inspect_related_section_signals",
      ]));
    } finally {
      await runtime?.destroyWorkspace();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("scopes an Executive Run to the server-owned Artifact project without adding Energy context", () => {
    const identity = {
      ...ngeeAnnAdditionalIdentity(),
      artifactKind: "executive-synthesis" as const,
      targetId: "sections:session-scope",
    };

    expect(resolveOverviewAiArtifactSessionScope({
      identity,
      workspaceId: identity.workspaceId,
    })).toEqual({
      workspaceId: identity.workspaceId,
      projectId: "ngee-ann-polytechnic",
    });
    expect(() => resolveOverviewAiArtifactSessionScope({
      identity,
      workspaceId: "another-workspace",
    })).toThrow("OVERVIEW_AI_RUNTIME_WORKSPACE_MISMATCH");
  });

  it("suppresses only duplicate full Snapshot and Catalog context for Overview stages", () => {
    expect(shouldIncludeProjectAnalysisEvidenceContext("investigator")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext("editor")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext(undefined)).toBe(true);
  });

  it.each(["section-interpreter", "executive-synthesis"] as const)(
    "forces %s to run without workspace-default Skills or datasources",
    (stage) => {
      const input = buildOverviewAiStageRunInput({
        stage,
        prompt: "Return JSON only.",
        identity: {
          workspaceId: "preschool-workspace",
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          resource: "electricity",
          dataSnapshotId: "snapshot-current",
          projectReleaseId: "release-current",
          analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
          analysisPeriodTo: "2026-06-01T00:00:00.000Z",
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
          editorPromptRevision: "not-applicable-v1",
          methodSkillId: "none",
          methodSkillRevision: "not-applicable-v1",
          artifactKind: stage === "section-interpreter" ? "section-interpretation" : "executive-synthesis",
          targetId: stage === "section-interpreter" ? "centre-benchmark" : "sections:none",
        },
        workspaceId: "preschool-workspace",
        user: {
          id: "dev-user",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        runId: `${stage}-run`,
        sessionId: `${stage}-session`,
      });
      expect(input.forwardedProps).toMatchObject({
        run_config: {
          skillMode: "none",
          enabledDatasourceIds: [],
          enabledSkillIds: [],
        },
      });
      if (stage === "section-interpreter") {
        expect(input.forwardedProps).toMatchObject({
          externalContext: {
            source: "energyiq",
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            resource: "electricity",
            from: "2026-05-01T00:00:00.000Z",
            to: "2026-06-01T00:00:00.000Z",
            expectedDataSnapshotId: "snapshot-current",
            expectedProjectReleaseId: "release-current",
            overviewAiStage: "section-interpreter",
          },
        });
      } else {
        expect(input.forwardedProps).not.toHaveProperty("externalContext");
      }
    },
  );

  it("collects both legacy content events and current runtime text chunks", () => {
    expect(collectOverviewAiText([
      { type: "TEXT_MESSAGE_CONTENT", delta: "{\"sections\":" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "[]}" },
      { type: "CUSTOM", delta: "ignored" },
    ])).toBe('{"sections":[]}');
  });

  it("uses only the exact post-reasoning JSON for Additional stages", () => {
    const finalObject = '{"candidates":[{"id":"candidate-useful"}]}';
    const reasoningWrapped = [
      "I will compare the current Evidence before returning the final object.",
      '{"scratch":"not the result"}',
      `<｜end▁of▁thinking｜>${finalObject}`,
    ].join("\n");
    const events = [
      { type: "TEXT_MESSAGE_CONTENT", delta: reasoningWrapped.slice(0, 80) },
      { type: "TEXT_MESSAGE_CHUNK", delta: reasoningWrapped.slice(80) },
    ];

    expect(collectOverviewAiText(events, "additional-insights-discovery")).toBe(finalObject);
    expect(collectOverviewAiText(events, "additional-insights-transition")).toBe(finalObject);
    expect(collectOverviewAiText(events, "section-interpreter")).toBe(reasoningWrapped);
    expect(collectOverviewAiText([
      { type: "TEXT_MESSAGE_CONTENT", delta: `Ordinary preamble.\n${finalObject}` },
    ], "additional-insights-discovery")).toBe(`Ordinary preamble.\n${finalObject}`);
  });

  it("accepts only a native Additional submission when the v22 submit boundary is enabled", () => {
    const payload = { candidates: [{ id: "candidate-native" }] };
    const literalDsml = "[]. Let me construct the JSON. <｜｜DSML｜｜tool_calls>";

    expect(collectOverviewAiValueStageAnswer([
      { type: "TEXT_MESSAGE_CONTENT", delta: literalDsml },
    ], "additional-insights-discovery", true)).toBe("{}");
    expect(collectOverviewAiValueStageAnswer([
      {
        type: "TOOL_CALL_START",
        toolCallId: "submit-1",
        toolCallName: "energyiq_additional_insights_submit",
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "submit-1",
        toolCallName: "energyiq_additional_insights_submit",
        result: {
          ok: true,
          resultType: "additional-ai-insight-submission",
          payload,
        },
      },
    ], "additional-insights-discovery", true)).toBe(JSON.stringify(payload));
  });
});

const additionalIdentity = (): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  resource: "electricity",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  analysisPackId: "preschool-additional-insights-pack",
  analysisPackRevision: "v1",
  modelProfileId: "workspace-default",
  modelProfileRevision: 7,
  outputContractRevision: "energyiq-additional-ai-insights-v2",
  validatorRevision: "additional-insights-acceptance-v17",
  workflowRevision: "additional-insights-discover-accept-publish-v21",
  investigatorPromptRevision: "additional-insights-discovery-v12",
  editorPromptRevision: "additional-insights-publication-v2",
  methodSkillId: "energyiq-open-discovery",
  methodSkillRevision: "1.0.0",
  artifactKind: "autonomous-insights",
  identityContractRevision: "additional-insights-v24",
  methodSetId: "preschool-additional-insights-current",
  methodSetRevision: "v1",
  methodSetFingerprint: `sha256:${"a".repeat(64)}`,
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "additional-insights-v2",
  canvasRevision: "energyiq-insight-canvas-v2",
});

const ngeeAnnAdditionalIdentity = (): EnergyIqOverviewAiArtifactIdentity => ({
  ...additionalIdentity(),
  projectId: "ngee-ann-polytechnic",
  scopeId: "ngee-ann-polytechnic",
  rendererKey: "ngee-ann-overview",
  analysisPackId: "ngee-ann-additional-insights-pack",
  identityContractRevision: "ngee-ann-additional-insights-v4",
  validatorRevision: "additional-insights-acceptance-v18",
  workflowRevision: "additional-insights-discover-accept-publish-v21",
  investigatorPromptRevision: "additional-insights-discovery-v11",
});

const historicalAdditionalIdentity = (): EnergyIqOverviewAiArtifactIdentity => ({
  ...additionalIdentity(),
  identityContractRevision: "additional-insights-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v3",
  investigatorPromptRevision: "additional-insights-discovery-v3",
});

const additionalEvidenceCatalog = (): AnalysisContextEvidenceCatalog => ({
  contract: "analysis-context-evidence@1",
  sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
  pins: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    dataCutoff: "2026-06-01T00:00:00.000Z",
    projectReleaseId: "release-current",
    metricVersion: "energy-metrics-v1",
  },
  facts: [{
    id: "fact:standby-share",
    label: "Standby share",
    metricId: "energy.standby_share_pct",
    value: 31,
    unit: "%",
    status: "confirmed",
    evidenceRefs: ["snapshot-evidence:standby"],
    dimensions: { period: "standby" },
  }],
});

const removeTemporaryOverviewAiStageFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) return;
    throw error;
  }
};

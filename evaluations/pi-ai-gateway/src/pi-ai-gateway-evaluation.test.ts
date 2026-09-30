import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertPiAiGatewayEventIntegrity,
  compilePiAiEvaluationProfile,
  runPiAiCatalogIsolationEvaluation,
  runPiAiGatewayEvaluation,
  runPiAiOpenAiCompatibleRequestEvaluation,
  runPiAiToolRoundTripEvaluation,
  type EnergyIqGatewayProfile,
  type EnergyIqGatewayRequest
} from "./pi-ai-gateway-evaluation.js";

const profile = (): EnergyIqGatewayProfile => ({
  profileId: "profile-deepseek",
  revision: "rev-7",
  workspaceId: "workspace-charles",
  provider: "deepseek",
  model: "deepseek-chat",
  baseUrl: "https://gateway.example.invalid/v1",
  secretRef: "secret://workspace-charles/deepseek",
  headers: {
    "X-Request-Tenant": "workspace-charles",
    Authorization: "Bearer never-log-this"
  },
  reasoning: "disabled",
  contextWindow: 64_000,
  maxOutputTokens: 2_048
});

const request = (): EnergyIqGatewayRequest => ({
  projectId: "project-ngee-ann",
  actorId: "actor-charles-admin",
  sessionId: "session-001",
  runId: "run-001",
  requestId: "request-001",
  stepId: "analysis-step-1",
  retryIndex: 0,
  systemPrompt: "Use only supplied evidence.",
  messages: [{ role: "user", text: "Summarise the evidence." }],
  tools: [{
    name: "energy_evidence_read",
    description: "Read one approved evidence record.",
    inputSchema: {
      type: "object",
      properties: { evidenceId: { type: "string" } },
      required: ["evidenceId"],
      additionalProperties: false
    }
  }]
});

describe("pi-ai gateway evaluation adapter", () => {
  it("normalizes deterministic text, reasoning, Tool and usage events without native types", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: {
        blocks: [
          { type: "reasoning", text: "Check the evidence first." },
          { type: "text", text: "Evidence checked." },
          {
            type: "tool-call",
            id: "tool-call-1",
            name: "energy_evidence_read",
            arguments: { evidenceId: "evidence-1" }
          }
        ],
        stopReason: "tool-use"
      }
    });

    expect(result.events.map((event) => event.type)).toEqual([
      "request-started",
      "reasoning-delta",
      "text-delta",
      "tool-call",
      "usage",
      "request-completed"
    ]);
    expect(result.events.find((event) => event.type === "tool-call")).toMatchObject({
      toolCallId: "tool-call-1",
      toolName: "energy_evidence_read",
      argumentsStatus: "valid",
      executionStatus: "not-executed-by-gateway"
    });
    expect(result.events.find((event) => event.type === "usage")).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      cacheReadTokens: 0,
      cacheWriteTokens: expect.any(Number),
      totalTokens: expect.any(Number)
    });
    expect(result.events.find((event) => event.type === "usage")).toMatchObject({
      cost: { status: "unavailable", source: "unavailable", total: null }
    });
    expect(result.events).toEqual(result.events.map((event, sequence) => expect.objectContaining({
      eventId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      requestId: "request-001",
      sequence
    })));
    expect(JSON.stringify(result)).not.toContain("never-log-this");
    expect(JSON.stringify(result)).not.toContain("secret://workspace-charles/deepseek");
  });

  it("binds the validated destination and secret-free header policy identity to the request", async () => {
    const baseline = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" },
    });
    const changedDestination = await runPiAiGatewayEvaluation({
      profile: { ...profile(), baseUrl: "https://other-gateway.example.invalid/v1" },
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" },
    });
    const changedHeaderPolicy = await runPiAiGatewayEvaluation({
      profile: {
        ...profile(),
        headers: {
          ...profile().headers,
          "X-Request-Region": "synthetic-region",
        },
      },
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" },
    });

    expect(changedDestination.requestFingerprint).not.toBe(baseline.requestFingerprint);
    expect(changedDestination.attemptId).not.toBe(baseline.attemptId);
    expect(changedHeaderPolicy.requestFingerprint).not.toBe(baseline.requestFingerprint);
    expect(changedHeaderPolicy.attemptId).not.toBe(baseline.attemptId);
    expect(JSON.stringify([baseline, changedDestination, changedHeaderPolicy])).not.toContain("synthetic-region");
  });

  it("keeps a malformed Tool call local while preserving a valid sibling", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: {
        blocks: [
          {
            type: "tool-call",
            id: "tool-call-valid",
            name: "energy_evidence_read",
            arguments: { evidenceId: "evidence-1" }
          },
          {
            type: "tool-call",
            id: "tool-call-invalid",
            name: "energy_evidence_read",
            arguments: { wrong: true }
          }
        ],
        stopReason: "tool-use"
      }
    });

    expect(result.events.filter((event) => event.type === "tool-call")).toEqual([
      expect.objectContaining({ toolCallId: "tool-call-valid", argumentsStatus: "valid" }),
      expect.objectContaining({
        toolCallId: "tool-call-invalid",
        argumentsStatus: "invalid",
        failureKind: "tool_arguments_invalid"
      })
    ]);
  });

  it("classifies an unknown Tool without claiming that it was called", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: {
        blocks: [{
          type: "tool-call",
          id: "tool-call-unknown",
          name: "unregistered_tool",
          arguments: {}
        }],
        stopReason: "tool-use"
      }
    });

    expect(result.events.find((event) => event.type === "tool-call")).toMatchObject({
      toolName: "unregistered_tool",
      argumentsStatus: "invalid",
      failureKind: "unknown_tool",
      executionStatus: "not-executed-by-gateway"
    });
  });

  it.each([
    ["require", { mode: "json-schema", strict: "require" }],
    ["prefer", { mode: "json-schema", strict: "prefer" }],
    ["disabled", { mode: "disabled" }]
  ] as const)("maps the EnergyIQ Tool schema policy %s into the observed Pi context", async (schemaPolicy, expected) => {
    const configuredRequest = request();
    configuredRequest.tools[0] = { ...configuredRequest.tools[0]!, schemaPolicy };
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: configuredRequest,
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" }
    });

    expect(result.transportAudit.toolSchemas).toEqual([{
      name: "energy_evidence_read",
      ...expected
    }]);
  });

  it.each([
    [false, "success"],
    [true, "error"]
  ] as const)("round-trips an externally supplied Tool result (%s) without executing the Tool", async (isError, resultStatus) => {
    const audit = await runPiAiToolRoundTripEvaluation({
      profile: profile(),
      request: request(),
      proposedToolCall: {
        id: "tool-call-round-trip",
        name: "energy_evidence_read",
        arguments: { evidenceId: "evidence-3" }
      },
      externalToolResult: {
        content: "approved evidence payload",
        isError
      },
      scriptedFinalText: "Round trip complete."
    });

    expect(audit).toMatchObject({
      providerCallCount: 2,
      toolCallId: "tool-call-round-trip",
      toolName: "energy_evidence_read",
      argumentsStatus: "valid",
      executionOwner: "energyiq-external-to-pi-ai",
      resultStatus,
      secondRequestObserved: true,
      finalText: "Round trip complete."
    });
    expect(audit.resultContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(audit)).not.toContain("approved evidence payload");
  });

  it("keeps reasoning-only output distinct and reports profile policy independently", async () => {
    const disabled = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: {
        blocks: [{ type: "reasoning", text: "Internal analysis." }],
        stopReason: "stop"
      }
    });
    const enabled = await runPiAiGatewayEvaluation({
      profile: { ...profile(), reasoning: "enabled" },
      request: request(),
      scriptedResponse: {
        blocks: [{ type: "reasoning", text: "Internal analysis." }],
        stopReason: "stop"
      }
    });

    expect(disabled.profile.reasoning).toBe("disabled");
    expect(enabled.profile.reasoning).toBe("enabled");
    expect(enabled.events.some((event) => event.type === "reasoning-delta")).toBe(true);
    expect(enabled.events.some((event) => event.type === "text-delta")).toBe(false);
  });

  it.each([
    ["provider-error", "provider_error"],
    ["maximum context length exceeded", "context_overflow"],
    ["request timed out", "timeout"],
    ["401 Unauthorized: invalid API key", "auth_error"],
    ["429 rate limit exceeded", "rate_limited"],
    ["custom endpoint capacity signal", "provider_error"]
  ] as const)("classifies %s without exposing provider-native errors", async (message, failureKind) => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: { blocks: [], stopReason: "error", errorMessage: message }
    });

    expect(result.events.at(-1)).toMatchObject({
      type: "request-failed",
      failureKind
    });
  });

  it("maps an already-aborted request to one terminal aborted event", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      signal: controller.signal,
      scriptedResponse: { blocks: [{ type: "text", text: "must not complete" }], stopReason: "stop" }
    });

    expect(result.events.filter((event) => event.type === "request-aborted")).toHaveLength(1);
    expect(result.events.some((event) => event.type === "request-completed")).toBe(false);
  });

  it("maps an in-stream abort to one terminal event and retains only emitted deltas", async () => {
    const controller = new AbortController();
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      signal: controller.signal,
      abortAfterFirstContentDelta: () => controller.abort(),
      scriptedResponse: {
        blocks: [{ type: "text", text: "This response is intentionally long enough for several chunks." }],
        stopReason: "stop"
      }
    });

    expect(result.events.filter((event) => event.type === "request-aborted")).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "text-delta").length).toBeGreaterThanOrEqual(1);
    expect(result.events.some((event) => event.type === "request-completed")).toBe(false);
  });

  it("enforces an EnergyIQ deadline outside the Provider timeout with one timeout terminal", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      deadlineMs: 5,
      syntheticResponseDelayMs: 25,
      scriptedResponse: { blocks: [{ type: "text", text: "too late" }], stopReason: "stop" }
    });

    expect(result.events.filter((event) => [
      "request-completed",
      "request-failed",
      "request-aborted",
      "request-deferred"
    ].includes(event.type))).toEqual([
      expect.objectContaining({ type: "request-failed", failureKind: "timeout" })
    ]);
  });

  it("keeps a length stop without explicit overflow evidence honest", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: { blocks: [], stopReason: "length" }
    });

    expect(result.events.at(-1)).toMatchObject({
      type: "request-completed",
      stopReason: "length",
      overflowAssessment: "unavailable"
    });
    expect(result.events.some((event) => event.type === "request-failed")).toBe(false);
  });

  it("keeps catalog changes from mutating the published EnergyIQ profile snapshot", () => {
    const source = profile();
    source.costRates = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 };
    const compiled = compilePiAiEvaluationProfile(source);
    source.model = "catalog-refresh-model";
    source.headers["X-Request-Tenant"] = "other-workspace";
    source.costRates.input = 999;

    expect(compiled.profile).toMatchObject({
      profileId: "profile-deepseek",
      revision: "rev-7",
      workspaceId: "workspace-charles",
      model: "deepseek-chat"
    });
    expect(compiled.profile.costRates?.input).toBe(1);
    expect(compiled.requestIdentity).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://gateway.example.invalid/v1"
    });
    expect(JSON.stringify(compiled)).not.toContain("never-log-this");
  });

  it("isolates published Profile identity from actual MutableModels replace and offline refresh", async () => {
    const audit = await runPiAiCatalogIsolationEvaluation({
      profile: profile(),
      replacementModelId: "catalog-replacement-model"
    });

    expect(audit).toEqual({
      exactModelAvailableBeforeMutation: true,
      exactModelAvailableAfterReplacement: false,
      offlineRefreshAborted: false,
      offlineRefreshErrorCount: 0,
      networkFetchCount: 0,
      profileSnapshotUnchanged: true,
      requestIdentityUnchanged: true,
      energyIqStoreBoundary: "not-wired-to-pi-catalog"
    });
  });

  it.each([
    ["openai", "openai-responses"],
    ["deepseek", "openai-completions"],
    ["alibaba", "openai-completions"],
    ["openai-compatible", "openai-completions"]
  ] as const)("maps the current %s profile family to an explicit Pi protocol candidate", (provider, protocol) => {
    const compiled = compilePiAiEvaluationProfile({ ...profile(), provider });
    expect(compiled.requestIdentity.protocolCandidate).toBe(protocol);
  });

  it.each([
    ["deepseek", "deepseek-chat", "https://api.deepseek.example.invalid/v1", "openai-completions"],
    ["openai-compatible", "kimi-k3", "https://kimi.example.invalid/v1", "openai-completions"],
    ["alibaba", "qwen3.8-max", "https://dashscope.example.invalid/compatible-mode/v1", "openai-completions"]
  ] as const)("observes the exact %s Profile mapping on the Pi request", async (provider, model, baseUrl, protocol) => {
    const result = await runPiAiGatewayEvaluation({
      profile: { ...profile(), provider, model, baseUrl, reasoning: "enabled" },
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" }
    });

    expect(result.transportAudit).toEqual({
      provider,
      model,
      baseUrl,
      protocolCandidate: protocol,
      reasoningRequested: "medium",
      reasoningObserved: "medium",
      maxOutputTokens: 2_048,
      timeoutMs: 30_000,
      maxRetries: 0,
      headerNames: ["Authorization", "X-EnergyIQ-Request-ID", "X-Request-Tenant"],
      toolSchemas: [{ name: "energy_evidence_read", mode: "unspecified" }]
    });
  });

  it.each([
    ["deepseek", "deepseek-chat", "https://api.deepseek.example.invalid/v1", true, false, true, false],
    ["alibaba", "qwen3.8-max", "https://dashscope.example.invalid/compatible-mode/v1", false, true, true, true],
    ["openai-compatible", "kimi-k3", "https://kimi.example.invalid/v1", false, false, false, false]
  ] as const)("captures the actual %s OpenAI-compatible payload through fake fetch", async (
    provider,
    model,
    baseUrl,
    deepSeekThinkingEnabled,
    qwenThinkingEnabled,
    strictToolSchema,
    emptyMessageCompatibilityApplied
  ) => {
    const configuredRequest = request();
    configuredRequest.messages = [
      { role: "user", text: "Evidence request." },
      { role: "assistant", text: "" }
    ];
    configuredRequest.tools[0] = { ...configuredRequest.tools[0]!, schemaPolicy: "require" };
    const audit = await runPiAiOpenAiCompatibleRequestEvaluation({
      profile: {
        ...profile(),
        provider,
        model,
        baseUrl,
        reasoning: provider === "openai-compatible" ? "disabled" : "enabled"
      },
      request: configuredRequest,
      toolAccess: "read-only",
      toolBundleEligible: true,
      localToolValidators: {
        energy_evidence_read: z.object({ evidenceId: z.string().min(1) }).strict(),
      },
    });

    expect(audit).toMatchObject({
      requestUrl: `${baseUrl}/chat/completions`,
      requestMethod: "POST",
      requestHeaderNames: expect.arrayContaining(["authorization", "content-type", "x-energyiq-request-id"]),
      payload: {
        model,
        maxTokensField: "max_tokens",
        maxTokens: 2_048,
        deepSeekThinkingEnabled,
        qwenThinkingEnabled,
        allMessageContentNonEmpty: true,
        emptyMessageCompatibilityApplied,
        toolNames: ["energy_evidence_read"],
        strictToolSchema
      },
      terminal: "stop",
      finalText: "synthetic-ok"
    });
    expect(JSON.stringify(audit)).not.toMatch(/never-log-this|synthetic-api-key|Evidence request/u);
  }, 15_000);

  it.each([
    ["mutating", true],
    ["read-only", false]
  ] as const)("rejects Kimi non-strict Tools when access=%s and bundleEligible=%s", async (
    toolAccess,
    toolBundleEligible
  ) => {
    const configuredRequest = request();
    configuredRequest.tools[0] = { ...configuredRequest.tools[0]!, schemaPolicy: "require" };

    await expect(runPiAiOpenAiCompatibleRequestEvaluation({
      profile: {
        ...profile(),
        provider: "openai-compatible",
        model: "kimi-k3",
        baseUrl: "https://kimi.example.invalid/v1"
      },
      request: configuredRequest,
      toolAccess,
      toolBundleEligible
    })).rejects.toThrow("KIMI_NON_STRICT_TOOLS_READ_ONLY_ONLY");
  });

  it("does not grant Kimi compatibility to a model-name prefix", async () => {
    const configuredRequest = request();
    configuredRequest.tools[0] = { ...configuredRequest.tools[0]!, schemaPolicy: "require" };
    const audit = await runPiAiOpenAiCompatibleRequestEvaluation({
      profile: {
        ...profile(),
        provider: "openai-compatible",
        model: "kimi-k3-preview",
        baseUrl: "https://kimi.example.invalid/v1"
      },
      request: configuredRequest,
      toolAccess: "mutating",
      toolBundleEligible: false
    });

    expect(audit.payload.strictToolSchema).toBe(true);
  });

  it("passes a valid Kimi non-strict Tool call through the canonical local argument validator", async () => {
    const audit = await runPiAiOpenAiCompatibleRequestEvaluation({
      profile: {
        ...profile(),
        provider: "openai-compatible",
        model: "kimi-k3",
        baseUrl: "https://kimi.example.invalid/v1",
      },
      request: request(),
      toolAccess: "read-only",
      toolBundleEligible: true,
      localToolValidators: {
        energy_evidence_read: z.object({ evidenceId: z.string().min(1) }).strict(),
      },
      syntheticToolCall: {
        name: "energy_evidence_read",
        arguments: { evidenceId: "evidence-1" },
      },
    });

    expect(audit.localToolValidation).toEqual({
      status: "valid",
      toolName: "energy_evidence_read",
    });
    expect(audit.terminal).toBe("tool-use");
  });

  it("rejects invalid Kimi non-strict Tool arguments locally before any execution", async () => {
    await expect(runPiAiOpenAiCompatibleRequestEvaluation({
      profile: {
        ...profile(),
        provider: "openai-compatible",
        model: "kimi-k3",
        baseUrl: "https://kimi.example.invalid/v1",
      },
      request: request(),
      toolAccess: "read-only",
      toolBundleEligible: true,
      localToolValidators: {
        energy_evidence_read: z.object({ evidenceId: z.string().min(1) }).strict(),
      },
      syntheticToolCall: {
        name: "energy_evidence_read",
        arguments: { wrong: true },
      },
    })).rejects.toThrow("KIMI_LOCAL_TOOL_ARGUMENTS_INVALID:energy_evidence_read");
  });

  it("fails closed for an unknown Provider family", () => {
    expect(() => compilePiAiEvaluationProfile({ ...profile(), provider: "unapproved-provider" }))
      .toThrow(/Unsupported EnergyIQ Provider profile/u);
  });

  it("fails closed when the exact Profile model is absent from the synthetic catalog", async () => {
    await expect(runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      syntheticCatalogModelIds: ["deepseek-reasoner"],
      scriptedResponse: { blocks: [{ type: "text", text: "must not run" }], stopReason: "stop" }
    })).rejects.toThrow(/Exact Profile model is unavailable/u);
  });

  it("applies server-owned header suppression and never exposes secret or customer payload values", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: {
        ...profile(),
        headers: {
          ...profile().headers,
          "X-Customer-Trace": "customer-sensitive-token"
        }
      },
      request: {
        ...request(),
        systemPrompt: "customer-confidential-prompt"
      },
      suppressedHeaderNames: ["authorization", "x-customer-trace"],
      scriptedResponse: {
        blocks: [],
        stopReason: "error",
        errorMessage: "Bearer never-log-this customer-sensitive-token customer-confidential-prompt"
      }
    });

    expect(result.transportAudit.headerNames).toEqual([
      "X-EnergyIQ-Request-ID",
      "X-Request-Tenant"
    ]);
    expect(result.events[0]).toMatchObject({
      type: "request-started",
      observedHeaderNames: ["X-EnergyIQ-Request-ID", "X-Request-Tenant"]
    });
    expect(JSON.stringify(result)).not.toMatch(/never-log-this|customer-sensitive-token|customer-confidential-prompt/u);
  });

  it("normalizes interleaved Pi content by content index with one deterministic terminal", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: { ...profile(), reasoning: "enabled" },
      request: request(),
      syntheticStreamPattern: "interleaved",
      scriptedResponse: {
        blocks: [
          { type: "reasoning", text: "ABCD" },
          { type: "text", text: "WXYZ" },
          {
            type: "tool-call",
            id: "tool-interleaved",
            name: "energy_evidence_read",
            arguments: { evidenceId: "evidence-2" }
          }
        ],
        stopReason: "tool-use"
      }
    });

    expect(result.events.filter((event) => ["reasoning-delta", "text-delta", "tool-call"].includes(event.type)))
      .toEqual([
        expect.objectContaining({ type: "reasoning-delta", contentIndex: 0, text: "AB" }),
        expect.objectContaining({ type: "text-delta", contentIndex: 1, text: "WX" }),
        expect.objectContaining({ type: "reasoning-delta", contentIndex: 0, text: "CD" }),
        expect.objectContaining({ type: "tool-call", contentIndex: 2, toolCallId: "tool-interleaved" }),
        expect.objectContaining({ type: "text-delta", contentIndex: 1, text: "YZ" })
      ]);
    expect(result.events.filter((event) => [
      "request-completed",
      "request-failed",
      "request-aborted",
      "request-deferred"
    ].includes(event.type))).toHaveLength(1);
  });

  it("keeps missing usage unavailable instead of manufacturing token or cost zeroes", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      usageEvidence: "unavailable",
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" }
    });

    expect(result.events.find((event) => event.type === "usage")).toEqual(expect.objectContaining({
      usageStatus: "unavailable",
      usageSource: "unavailable",
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      cost: {
        status: "unavailable",
        source: "unavailable",
        rateSnapshotHash: null,
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        total: null
      }
    }));
  });

  it("preserves true zero usage as available and separates catalog-estimated cost from Provider usage", async () => {
    const result = await runPiAiGatewayEvaluation({
      profile: {
        ...profile(),
        costRates: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 }
      },
      request: request(),
      usageEvidence: "provider-reported",
      syntheticReportedUsage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 0
      },
      scriptedResponse: { blocks: [{ type: "text", text: "ok" }], stopReason: "stop" }
    });

    expect(result.events.find((event) => event.type === "usage")).toEqual(expect.objectContaining({
      usageStatus: "available",
      usageSource: "pi-normalized-provider",
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      cost: expect.objectContaining({
        status: "estimated",
        source: "energyiq-profile-rate-snapshot",
        rateSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        total: 0
      })
    }));
  });

  it("derives a stable secret-free request fingerprint from exact profile and request identity", async () => {
    const first = await runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text: "first" }], stopReason: "stop" }
    });
    const second = await runPiAiGatewayEvaluation({
      profile: {
        ...profile(),
        headers: { ...profile().headers, Authorization: "Bearer rotated-secret" },
      },
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text: "second" }], stopReason: "stop" }
    });

    expect(first.requestFingerprint).toBe(second.requestFingerprint);
    expect(first.requestFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ["projectId", "project-preschool"],
    ["actorId", "actor-ngee-reviewer"],
    ["sessionId", "session-002"],
    ["runId", "run-002"]
  ] as const)("binds %s into attempt and event identity", async (field, value) => {
    const execute = (gatewayRequest: EnergyIqGatewayRequest) => runPiAiGatewayEvaluation({
      profile: profile(),
      request: gatewayRequest,
      scriptedResponse: { blocks: [{ type: "text", text: "stable response" }], stopReason: "stop" }
    });

    const baseline = await execute(request());
    const changed = await execute({ ...request(), [field]: value });

    expect(changed.attemptId).not.toBe(baseline.attemptId);
    expect(changed.events.map((event) => event.eventId))
      .not.toEqual(baseline.events.map((event) => event.eventId));
  });

  it("binds normalized event content into event identity", async () => {
    const execute = (text: string) => runPiAiGatewayEvaluation({
      profile: profile(),
      request: request(),
      scriptedResponse: { blocks: [{ type: "text", text }], stopReason: "stop" }
    });

    const first = await execute("first normalized delta");
    const changed = await execute("different normalized delta");
    const firstText = first.events.find((event) => event.type === "text-delta");
    const changedText = changed.events.find((event) => event.type === "text-delta");

    expect(changed.attemptId).toBe(first.attemptId);
    expect(changedText?.eventId).not.toBe(firstText?.eventId);
    if (!firstText || !changedText) throw new Error("Expected normalized text events");
    expect(() => assertPiAiGatewayEventIntegrity({
      attemptId: first.attemptId,
      event: { ...changedText, eventId: firstText.eventId }
    })).toThrow("PI_AI_EVENT_ID_COLLISION");
  });

  it("derives deterministic replay-safe event identity while keeping retries and Provider response ids distinct", async () => {
    const execute = (retryIndex: number, responseId: string) => runPiAiGatewayEvaluation({
      profile: profile(),
      request: { ...request(), retryIndex },
      scriptedResponse: {
        blocks: [{ type: "text", text: "stable response" }],
        stopReason: "stop",
        responseId
      }
    });

    const first = await execute(0, "provider-response-a");
    const replay = await execute(0, "provider-response-a");
    const differentProviderResponse = await execute(0, "provider-response-b");
    const retry = await execute(1, "provider-response-a");

    expect(replay.attemptId).toBe(first.attemptId);
    expect(replay.events.map((event) => event.eventId)).toEqual(first.events.map((event) => event.eventId));
    expect(differentProviderResponse.attemptId).toBe(first.attemptId);
    expect(differentProviderResponse.events.map((event) => event.eventId))
      .not.toEqual(first.events.map((event) => event.eventId));
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.events.map((event) => event.eventId)).not.toEqual(first.events.map((event) => event.eventId));
    expect(first.events.at(-1)).toMatchObject({
      type: "request-completed",
      upstreamResponseId: "provider-response-a"
    });
    expect(first.events.every((event) => event.eventId !== "provider-response-a")).toBe(true);
  });
});

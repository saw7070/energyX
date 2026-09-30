import type { RunAgentInput } from "@ag-ui/client";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "./routes/types.js";
import { resolveRunConfig } from "./run-config-resolver.js";
import {
  handleWorkspaceDefaultModelProfileRequest,
  workspaceDefaultModelProfileDto
} from "./workspace-model-profile-api.js";
import {
  resolveModelProfileChain,
  resolveWorkspaceDefaultModelProfileSnapshot,
} from "./workspace-model-profile-resolver.js";

describe("Workspace default model profile runtime", () => {
  it("executes the exact server-owned profile snapshot after the workspace-default binding rotates", () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-default-model-snapshot-"));
    const metadata = createMetadataStore({
      database_path: join(root, "metadata.sqlite"),
      secret_master_key: "test-key",
    });
    try {
      metadata.users.upsertDevUser({
        id: "dev-user", email: "dev@example.test", display_name: "Developer", dev_token: "dev-token",
      });
      metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "EnergyIQ", kind: "personal" });
      metadata.workspaces.upsert({ id: "customer-1", owner_user_id: "dev-user", name: "Customer", kind: "customer" });
      for (const [id, modelName] of [["profile-a", "model-a"], ["profile-b", "model-b"]] as const) {
        const secretRef = metadata.secrets.put({
          workspace_id: "default",
          user_id: "dev-user",
          owner_kind: "model-profile",
          owner_id: id,
          value: { apiKey: `${id}-secret` },
        });
        metadata.configResources.upsert({
          id,
          workspace_id: "default",
          user_id: "dev-user",
          kind: "model-profile",
          name: id,
          payload: { provider: "openai-compatible", modelName, baseUrl: `https://${id}.example.test/v1` },
          secret_ref: secretRef,
          default_enabled: true,
          status: "connected",
        });
      }
      metadata.workspaceDefaultModelProfiles.set({
        workspace_id: "default",
        profile_id: "profile-a",
        profile_owner_user_id: "dev-user",
        configured_by_user_id: "dev-user",
      });
      const historical = resolveWorkspaceDefaultModelProfileSnapshot(metadata);
      metadata.workspaceDefaultModelProfiles.set({
        workspace_id: "default",
        profile_id: "profile-b",
        profile_owner_user_id: "dev-user",
        configured_by_user_id: "dev-user",
        expected_revision: 1,
      });

      expect(resolveRunConfig({
        metadataStore: metadata,
        modelSelection: "system-default",
        runInput: emptyRunInput(),
        userId: "dev-user",
        userInput: "Current run",
        workspaceId: "customer-1",
      }).modelProvider.model_name).toBe("model-b");
      const restored = resolveRunConfig({
        metadataStore: metadata,
        modelSelection: "system-default",
        trustedModelProfileSnapshot: historical,
        runInput: emptyRunInput(),
        userId: "dev-user",
        userInput: "Resume exact evaluation attempt",
        workspaceId: "customer-1",
      });
      expect(restored.modelProvider.model_name).toBe("model-a");
      expect(restored.effectiveRunConfig.resourceRevisions).toMatchObject({
        "model-profile:workspace-default": 1,
        "model-profile-binding:workspace-default": 1,
      });
      expect(JSON.stringify(historical)).not.toContain("profile-a-secret");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets a normal user run the admin profile without exposing its secret or fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-default-model-"));
    const metadata = createMetadataStore({
      database_path: join(root, "metadata.sqlite"),
      secret_master_key: "test-key"
    });
    metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "EnergyIQ", kind: "personal" });
    metadata.workspaces.upsert({ id: "customer-1", owner_user_id: "dev-user", name: "Customer", kind: "customer" });
    metadata.users.upsertDevUser({ id: "normal-user", email: "user@example.test", display_name: "Normal User", dev_token: "normal-token" });
    metadata.workspaceMemberships.upsert({ workspace_id: "customer-1", user_id: "normal-user", role: "member" });
    const secretRef = metadata.secrets.put({
      workspace_id: "default", user_id: "dev-user", owner_kind: "model-profile", owner_id: "deepseek-v4-flash",
      value: { apiKey: "server-only-test-secret" }
    });
    metadata.configResources.upsert({
      id: "deepseek-v4-flash", workspace_id: "default", user_id: "dev-user", kind: "model-profile",
      name: "DeepSeek V4 Flash", payload: {
        provider: "openai-compatible", modelName: "deepseek-v4-flash", baseUrl: "https://api.example.test/v1"
      }, secret_ref: secretRef, default_enabled: true, status: "connected"
    });
    const adminContext = {
      metadataStore: metadata, userId: "dev-user", workspaceId: "customer-1"
    } as Required<ConfigApiContext>;
    const configured = await handleWorkspaceDefaultModelProfileRequest(
      jsonRequest("PUT", { profileId: "deepseek-v4-flash" }),
      adminContext
    );
    expect(configured.status).toBe(200);

    const userContext = {
      metadataStore: metadata, userId: "normal-user", workspaceId: "customer-1"
    } as Required<ConfigApiContext>;
    await expect(handleWorkspaceDefaultModelProfileRequest(
      jsonRequest("PUT", { profileId: "deepseek-v4-flash" }),
      userContext
    )).rejects.toThrow("ENERGYIQ_ADMIN_REQUIRED");

    const resolved = resolveRunConfig({
      metadataStore: metadata,
      runInput: emptyRunInput(),
      userId: "normal-user",
      userInput: "Compare this period",
      workspaceId: "customer-1"
    });
    expect(resolved.effectiveRunConfig.activeLlmProfileId).toBe("workspace-default");
    expect(resolved.modelProvider.model_name).toBe("deepseek-v4-flash");
    expect(resolved.modelProvider).not.toHaveProperty("provider_ids");
    expect(resolved.modelContextProfile).toMatchObject({
      capabilitySource: "conservative-fallback",
      contextWindow: 128_000,
      maxOutputTokens: 4096
    });
    expect(resolved.modelSettings).toMatchObject({ maxOutputTokens: 4096 });
    expect(metadata.configResources.list({
      workspace_id: "customer-1", user_id: "normal-user", kind: "model-profile"
    })).toEqual([]);

    const localSecretRef = metadata.secrets.put({
      workspace_id: "customer-1", user_id: "normal-user", owner_kind: "model-profile", owner_id: "local-model",
      value: { apiKey: "local-test-secret" }
    });
    metadata.configResources.upsert({
      id: "local-model", workspace_id: "customer-1", user_id: "normal-user", kind: "model-profile",
      name: "Local model", payload: {
        provider: "openai-compatible", modelName: "local-model", baseUrl: "https://local.example.test/v1"
      }, secret_ref: localSecretRef, default_enabled: true, status: "connected"
    });
    const explicitLocalInput = {
      ...emptyRunInput(),
      forwardedProps: { run_config: { activeLlmProfileId: "local-model" } }
    } as RunAgentInput;
    expect(resolveRunConfig({
      metadataStore: metadata,
      runInput: explicitLocalInput,
      userId: "normal-user",
      userInput: "Generic data task",
      workspaceId: "customer-1"
    }).modelProvider.model_name).toBe("local-model");
    const energyResolved = resolveRunConfig({
      metadataStore: metadata,
      modelSelection: "system-default",
      runInput: explicitLocalInput,
      userId: "normal-user",
      userInput: "EnergyIQ task",
      workspaceId: "customer-1"
    });
    expect(energyResolved.effectiveRunConfig.activeLlmProfileId).toBe("workspace-default");
    expect(energyResolved.modelProvider.model_name).toBe("deepseek-v4-flash");
    const dto = workspaceDefaultModelProfileDto({
      context: userContext,
      isAdmin: false
    });
    expect(dto).toMatchObject({ id: "workspace-default", available: true, fallbackPolicy: "disabled" });
    expect(JSON.stringify(dto)).not.toContain("server-only-test-secret");
    expect(dto).not.toHaveProperty("secretRef");
    expect(dto).not.toHaveProperty("sourceProfileId");

    const source = metadata.configResources.get({
      id: "deepseek-v4-flash", workspace_id: "default", user_id: "dev-user", kind: "model-profile"
    });
    metadata.configResources.upsert({
      ...source,
      status: "failed",
      expected_revision: source.revision
    });
    expect(workspaceDefaultModelProfileDto({
      context: userContext,
      isAdmin: false
    })).toMatchObject({ configured: true, available: false, unavailableReason: "source-profile-not-connected" });
    expect(() => resolveRunConfig({
      metadataStore: metadata,
      runInput: emptyRunInput(),
      userId: "normal-user",
      userInput: "Compare this period",
      workspaceId: "customer-1"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");
    expect(() => resolveModelProfileChain({
      metadataStore: metadata, profileId: "workspace-default", userId: "normal-user", workspaceId: "customer-1"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");

    metadata.configResources.delete({
      id: "deepseek-v4-flash", workspace_id: "default", user_id: "dev-user", kind: "model-profile"
    });
    expect(workspaceDefaultModelProfileDto({
      context: userContext,
      isAdmin: false
    })).toMatchObject({ configured: true, available: false, unavailableReason: "source-profile-not-found" });
    expect(() => resolveModelProfileChain({
      metadataStore: metadata, profileId: "workspace-default", userId: "normal-user", workspaceId: "customer-1"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_SOURCE_UNAVAILABLE");

    metadata.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("uses the verified DeepSeek V4 Flash budget only on the official endpoint", () => {
    const root = mkdtempSync(join(tmpdir(), "verified-model-capability-"));
    const metadata = createMetadataStore({
      database_path: join(root, "metadata.sqlite"),
      secret_master_key: "test-key"
    });
    metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "EnergyIQ", kind: "personal" });
    metadata.users.upsertDevUser({
      id: "dev-user",
      email: "dev@example.test",
      display_name: "Developer",
      dev_token: "dev-token"
    });

    const addProfile = (id: string, payload: Record<string, unknown>): void => {
      const secretRef = metadata.secrets.put({
        workspace_id: "default",
        user_id: "dev-user",
        owner_kind: "model-profile",
        owner_id: id,
        value: { apiKey: `${id}-secret` }
      });
      metadata.configResources.upsert({
        id,
        workspace_id: "default",
        user_id: "dev-user",
        kind: "model-profile",
        name: id,
        payload,
        secret_ref: secretRef,
        default_enabled: true,
        status: "connected"
      });
    };
    addProfile("official-deepseek", {
      provider: "openai-compatible",
      modelName: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1"
    });
    addProfile("explicit-proxy", {
      provider: "openai-compatible",
      modelName: "deepseek-v4-flash",
      baseUrl: "https://proxy.example.test/v1",
      contextLength: 500_000,
      maxOutputTokens: 16_000
    });
    addProfile("unverified-proxy", {
      provider: "openai-compatible",
      modelName: "deepseek-v4-flash",
      baseUrl: "https://proxy.example.test/v1"
    });

    const resolveProfile = (profileId: string) => resolveRunConfig({
      metadataStore: metadata,
      runInput: {
        ...emptyRunInput(),
        forwardedProps: { run_config: { activeLlmProfileId: profileId } }
      } as RunAgentInput,
      userId: "dev-user",
      userInput: "Investigate energy use",
      workspaceId: "default"
    });

    const official = resolveProfile("official-deepseek");
    expect(official.modelContextProfile).toMatchObject({
      capabilitySource: "verified-model-default",
      contextWindow: 1_000_000,
      maxOutputTokens: 32_000,
      outputReserve: 32_000,
      safetyMargin: 4096
    });
    expect(official.modelSettings).toMatchObject({ maxOutputTokens: 32_000 });

    const explicit = resolveProfile("explicit-proxy");
    expect(explicit.modelContextProfile).toMatchObject({
      capabilitySource: "explicit-profile",
      contextWindow: 500_000,
      maxOutputTokens: 16_000,
      outputReserve: 16_000
    });
    expect(explicit.modelSettings).toMatchObject({ maxOutputTokens: 16_000 });

    const unverified = resolveProfile("unverified-proxy");
    expect(unverified.modelContextProfile).toMatchObject({
      capabilitySource: "conservative-fallback",
      contextWindow: 128_000,
      maxOutputTokens: 4096,
      outputReserve: 4096
    });
    expect(unverified.modelSettings).toMatchObject({ maxOutputTokens: 4096 });

    metadata.db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

const emptyRunInput = (): RunAgentInput => ({
  context: [], forwardedProps: {}, messages: [], runId: "run-1", state: {}, threadId: "thread-1", tools: []
});

const jsonRequest = (method: string, body: Record<string, unknown>): IncomingMessage => {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.method = method;
  return request;
};

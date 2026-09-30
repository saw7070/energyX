import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("Workspace default model profile store", () => {
  it("binds a connected profile without copying its encrypted secret", () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-model-profile-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "test-key" });
    metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "Test", kind: "customer" });
    metadata.configResources.upsert({
      id: "deepseek-v4-flash",
      workspace_id: "default",
      user_id: "dev-user",
      kind: "model-profile",
      name: "DeepSeek V4 Flash",
      payload: { provider: "openai-compatible", modelName: "deepseek-v4-flash" },
      secret_ref: metadata.secrets.put({
        workspace_id: "default",
        user_id: "dev-user",
        owner_kind: "model-profile",
        owner_id: "deepseek-v4-flash",
        value: { apiKey: "test-only-secret" }
      }),
      default_enabled: true,
      status: "connected"
    });

    const binding = metadata.workspaceDefaultModelProfiles.set({
      workspace_id: "default",
      profile_id: "deepseek-v4-flash",
      profile_owner_user_id: "dev-user",
      configured_by_user_id: "dev-user"
    });

    expect(binding).toMatchObject({
      profile_id: "deepseek-v4-flash",
      fallback_policy: "disabled",
      revision: 1
    });
    const row = metadata.db.prepare(
      "SELECT * FROM workspace_default_model_profiles WHERE workspace_id = 'default'"
    ).get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain("test-only-secret");
    metadata.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a profile with a fallback or without a successful connection test", () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-model-profile-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "test-key" });
    metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "Test", kind: "customer" });
    metadata.configResources.upsert({
      id: "fallback-enabled",
      workspace_id: "default",
      user_id: "dev-user",
      kind: "model-profile",
      name: "Fallback enabled",
      payload: { fallbackProfileId: "another-model" },
      default_enabled: true,
      status: "connected"
    });
    metadata.configResources.upsert({
      id: "untested",
      workspace_id: "default",
      user_id: "dev-user",
      kind: "model-profile",
      name: "Untested",
      payload: {},
      default_enabled: true,
      status: "untested"
    });

    expect(() => metadata.workspaceDefaultModelProfiles.set({
      workspace_id: "default",
      profile_id: "fallback-enabled",
      profile_owner_user_id: "dev-user",
      configured_by_user_id: "dev-user"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_FALLBACK_MUST_BE_DISABLED");
    expect(() => metadata.workspaceDefaultModelProfiles.set({
      workspace_id: "default",
      profile_id: "untested",
      profile_owner_user_id: "dev-user",
      configured_by_user_id: "dev-user"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");
    metadata.db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

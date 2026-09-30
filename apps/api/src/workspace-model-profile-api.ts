import { createSuccessResult } from "@datafoundry/contracts";
import {
  WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
  type ConfigResourceRecord,
} from "@datafoundry/metadata";
import type { IncomingMessage } from "node:http";

import { resolveEnergyAccessContext } from "./energy/energy-query-context.js";
import type { ConfigApiContext, ConfigApiResponse } from "./routes/types.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "./workspace-model-profile-resolver.js";

export const handleWorkspaceDefaultModelProfileRequest = async (
  request: IncomingMessage,
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  const user = context.metadataStore.users.getById({ user_id: context.userId });
  const access = resolveEnergyAccessContext({
    metadataStore: context.metadataStore,
    user,
    requestedWorkspaceId: context.workspaceId
  });
  if (!access.activeWorkspaceId) throw new Error("ENERGYIQ_WORKSPACE_FORBIDDEN");

  if (request.method === "GET") {
    return {
      status: 200,
      body: createSuccessResult(workspaceDefaultModelProfileDto({
        context,
        isAdmin: access.role === "admin"
      }))
    };
  }
  if (access.role !== "admin") throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  if (request.method === "PUT") {
    const body = await readJsonBody(request);
    const profileId = requiredString(body.profileId, "WORKSPACE_DEFAULT_MODEL_PROFILE_ID_REQUIRED");
    const expectedRevision = optionalInteger(body.expectedRevision);
    context.metadataStore.workspaceDefaultModelProfiles.set({
      workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      profile_id: profileId,
      profile_owner_user_id: context.userId,
      configured_by_user_id: context.userId,
      ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {})
    });
    return {
      status: 200,
      body: createSuccessResult(workspaceDefaultModelProfileDto({ context, isAdmin: true }))
    };
  }
  if (request.method === "DELETE") {
    const body = await readJsonBody(request);
    const expectedRevision = optionalInteger(body.expectedRevision);
    context.metadataStore.workspaceDefaultModelProfiles.clear({
      workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {})
    });
    return { status: 200, body: createSuccessResult({ configured: false }) };
  }
  return {
    status: 405,
    body: { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, ok: false }
  };
};

/** Read-safe system model proxy. It never includes the source profile id or secret for users. */
export const workspaceDefaultModelProfileDto = (input: {
  context: Required<ConfigApiContext>;
  isAdmin: boolean;
}): Record<string, unknown> => {
  const binding = input.context.metadataStore.workspaceDefaultModelProfiles.find(
    ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID
  );
  if (!binding) return { configured: false };
  const profile = input.context.metadataStore.configResources.find({
    id: binding.profile_id,
    workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    user_id: binding.profile_owner_user_id,
    kind: "model-profile"
  });
  if (!profile) {
    return unavailableProxy(binding, "source-profile-not-found", input.isAdmin);
  }
  if (!profile.default_enabled) {
    return unavailableProxy(binding, "source-profile-disabled", input.isAdmin);
  }
  if (profile.status !== "connected") {
    return unavailableProxy(binding, "source-profile-not-connected", input.isAdmin);
  }
  if (typeof profile.payload.fallbackProfileId === "string" && profile.payload.fallbackProfileId.trim()) {
    return unavailableProxy(binding, "fallback-policy-drift", input.isAdmin);
  }
  return toWorkspaceProxy(profile, binding, input.isAdmin);
};

const unavailableProxy = (
  binding: ReturnType<Required<ConfigApiContext>["metadataStore"]["workspaceDefaultModelProfiles"]["get"]>,
  unavailableReason: string,
  isAdmin: boolean
): Record<string, unknown> => ({
  configured: true,
  available: false,
  id: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
  name: "EnergyIQ system default · unavailable",
  description: "The configured EnergyIQ system model is unavailable. An admin must repair it.",
  connectionStatus: "unavailable",
  defaultEnabled: false,
  fallbackPolicy: "disabled",
  readonly: true,
  shared: true,
  hasSecret: false,
  revision: binding.revision,
  updatedAt: binding.updated_at,
  unavailableReason,
  ...(isAdmin ? { sourceProfileId: binding.profile_id } : {})
});

const toWorkspaceProxy = (
  profile: ConfigResourceRecord,
  binding: ReturnType<Required<ConfigApiContext>["metadataStore"]["workspaceDefaultModelProfiles"]["get"]>,
  isAdmin: boolean
): Record<string, unknown> => ({
  configured: true,
  available: true,
  id: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
  name: `EnergyIQ system default · ${profile.name}`,
  description: "Admin-managed EnergyIQ model shared by every Project. Credentials remain server-side.",
  provider: safeString(profile.payload.provider),
  modelName: safeString(profile.payload.modelName) ?? safeString(profile.payload.model),
  connectionStatus: profile.status,
  defaultEnabled: profile.default_enabled,
  fallbackPolicy: binding.fallback_policy,
  readonly: true,
  shared: true,
  hasSecret: Boolean(profile.secret_ref),
  revision: binding.revision,
  updatedAt: binding.updated_at,
  ...(isAdmin ? { sourceProfileId: binding.profile_id } : {})
});

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("INVALID_BODY");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(value)) throw new Error("INVALID_BODY");
  return value;
};

const requiredString = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};
const safeString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const optionalInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

import type {
  ConfigResourceRecord,
  EnergyIqAdditionalInsightModelProfileSnapshot,
  MetadataStore,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";

export type ResolvedModelProfile = {
  exposedId: string;
  ownerWorkspaceId: string;
  ownerUserId: string;
  resource: ConfigResourceRecord;
};

export type WorkspaceDefaultModelProfileSnapshot = EnergyIqAdditionalInsightModelProfileSnapshot;

/** Backing Workspace for the single server-managed EnergyIQ model profile. */
export const ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID = "default";

export const resolveModelProfileChain = (input: {
  metadataStore: MetadataStore;
  profileId: string;
  trustedSnapshot?: WorkspaceDefaultModelProfileSnapshot;
  userId: string;
  workspaceId: string;
}): ResolvedModelProfile[] => {
  if (input.trustedSnapshot) {
    if (input.profileId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID) {
      throw new Error("TRUSTED_MODEL_PROFILE_SNAPSHOT_ID_MISMATCH");
    }
    return input.trustedSnapshot.profiles.map((profile) => ({
      ...profile,
      resource: { ...profile.resource, payload: { ...profile.resource.payload } },
    }));
  }
  if (input.profileId === WORKSPACE_DEFAULT_MODEL_PROFILE_ID) {
    const binding = input.metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
    const resource = input.metadataStore.configResources.find({
      id: binding.profile_id,
      workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      user_id: binding.profile_owner_user_id,
      kind: "model-profile"
    });
    if (!resource) throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_SOURCE_UNAVAILABLE");
    if (!resource.default_enabled) throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_DISABLED");
    if (resource.status !== "connected") throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");
    if (stringValue(resource.payload.fallbackProfileId)) {
      throw new Error("WORKSPACE_DEFAULT_MODEL_FALLBACK_MUST_BE_DISABLED");
    }
    return [{
      exposedId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
      ownerWorkspaceId: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      ownerUserId: binding.profile_owner_user_id,
      resource
    }];
  }

  const profiles: ResolvedModelProfile[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = input.profileId;
  while (currentId) {
    if (visited.has(currentId)) throw new Error(`MODEL_FALLBACK_CYCLE:${currentId}`);
    visited.add(currentId);
    const resource = input.metadataStore.configResources.get({
      id: currentId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      kind: "model-profile"
    });
    profiles.push({
      exposedId: currentId,
      ownerWorkspaceId: input.workspaceId,
      ownerUserId: input.userId,
      resource
    });
    currentId = stringValue(resource.payload.fallbackProfileId);
  }
  return profiles;
};

/** Capture the exact server-owned profile resource without decrypting its secret. */
export const resolveWorkspaceDefaultModelProfileSnapshot = (
  metadataStore: MetadataStore,
): WorkspaceDefaultModelProfileSnapshot => {
  const binding = metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  return {
    bindingRevision: binding.revision,
    profiles: resolveModelProfileChain({
      metadataStore,
      profileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
      userId: binding.profile_owner_user_id,
      workspaceId: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    }).map((profile) => ({
      ...profile,
      resource: { ...profile.resource, payload: { ...profile.resource.payload } },
    })),
  };
};

export const workspaceDefaultModelProfileConfigured = (
  metadataStore: MetadataStore,
  _workspaceId: string,
): boolean => metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID) !== undefined;

export const systemDefaultModelProfileRevision = (metadataStore: MetadataStore): number =>
  metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID).revision;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

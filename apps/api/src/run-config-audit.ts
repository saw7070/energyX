import { createCustomEvent } from "@datafoundry/agent-runtime";
import type { LoadedSkillInstruction, MaterializedSkill } from "@datafoundry/skills";
import { createHash } from "node:crypto";

export type RunConfigAuditCapture = {
  resource_revisions: Record<string, number>;
  mcp_tool_names_by_server_id: Record<string, string[]>;
};

/** Build the immutable, secret-free configuration fields persisted on run.config.resolved. */
export const createRunConfigAuditCapture = (input: {
  resourceRevisions?: Record<string, number>;
  mcpToolNamesByServerId: Record<string, string[]>;
}): RunConfigAuditCapture => ({
  resource_revisions: Object.fromEntries(Object.entries(input.resourceRevisions ?? {})
    .filter(([, revision]) => Number.isSafeInteger(revision) && revision >= 0)
    .sort(([left], [right]) => left.localeCompare(right))),
  mcp_tool_names_by_server_id: Object.fromEntries(Object.entries(input.mcpToolNamesByServerId)
    .map(([serverId, toolNames]) => [
      serverId,
      [...new Set(toolNames)].sort((left, right) => left.localeCompare(right)),
    ] as const)
    .sort(([left], [right]) => left.localeCompare(right))),
});

/** Capture trusted package identity prepared before the actual Skill reader runs. */
export const createSkillMaterializedAuditCapture = (
  skills: MaterializedSkill[],
): { items: Array<{
  content_sha256: string;
  id: string;
  package_ref: string;
  revision: number;
}> } => ({
  items: skills
    .filter(({ configRevision, contentSha256, id, packageRef }) => id.trim().length > 0
      && Number.isSafeInteger(configRevision)
      && configRevision >= 0
      && /^sha256:[a-f0-9]{64}$/u.test(contentSha256)
      && packageRef.trim().length > 0)
    .map(({ configRevision, contentSha256, id, packageRef }) => ({
      content_sha256: contentSha256,
      id,
      package_ref: packageRef,
      revision: configRevision,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
});

export const createSkillMaterializedAuditEventId = (
  runId: string,
  capture: ReturnType<typeof createSkillMaterializedAuditCapture>,
): string => {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ run_id: runId, items: capture.items }))
    .digest("hex");
  return `skill-materialized:${runId}:${fingerprint}`;
};

export type SkillLoadedAuditCapture = {
  eventId: string;
  run_event_schema_version: 1;
  skill: {
    config_revision: number;
    content_sha256: string;
    id: string;
    load_source: LoadedSkillInstruction["loadSource"];
    load_stage: LoadedSkillInstruction["loadStage"];
    name: string;
    owner: {
      scope: LoadedSkillInstruction["owner"]["scope"];
      user_id: string;
      workspace_id: string;
    };
    package_ref: string;
    semantic_version: string;
  };
};

export const createSkillLoadedAuditEventId = (
  runId: string,
  skill: SkillLoadedAuditCapture["skill"],
): string => {
  const canonicalSkill: SkillLoadedAuditCapture["skill"] = {
    config_revision: skill.config_revision,
    content_sha256: skill.content_sha256,
    id: skill.id,
    load_source: skill.load_source,
    load_stage: skill.load_stage,
    name: skill.name,
    owner: {
      scope: skill.owner.scope,
      user_id: skill.owner.user_id,
      workspace_id: skill.owner.workspace_id,
    },
    package_ref: skill.package_ref,
    semantic_version: skill.semantic_version,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ run_id: runId, skill: canonicalSkill }))
    .digest("hex");
  return `skill-loaded:${runId}:${skill.id}:${skill.config_revision}:${fingerprint}`;
};

/** Convert only actual reader output into deterministic, secret-free Run evidence. */
export const createSkillLoadedAuditCaptures = (
  runId: string,
  loadedSkills: LoadedSkillInstruction[],
): SkillLoadedAuditCapture[] => loadedSkills
  .map((skill) => {
    const capturedSkill: SkillLoadedAuditCapture["skill"] = {
      config_revision: skill.configRevision,
      content_sha256: skill.contentSha256,
      id: skill.id,
      load_source: skill.loadSource,
      load_stage: skill.loadStage,
      name: skill.name,
      owner: {
        scope: skill.owner.scope,
        user_id: skill.owner.userId,
        workspace_id: skill.owner.workspaceId,
      },
      package_ref: skill.packageRef,
      semantic_version: skill.semanticVersion,
    };
    return {
      eventId: createSkillLoadedAuditEventId(runId, capturedSkill),
      run_event_schema_version: 1 as const,
      skill: capturedSkill,
    };
  })
  .sort((left, right) => left.skill.id.localeCompare(right.skill.id));

export const emitSkillLoadedAuditEvents = (input: {
  emit(event: ReturnType<typeof createCustomEvent>): void;
  loadedSkills: LoadedSkillInstruction[];
  runId: string;
}): void => {
  createSkillLoadedAuditCaptures(input.runId, input.loadedSkills)
    .forEach((capture) => input.emit(createCustomEvent("skill.loaded", capture)));
};

/** Emit the forward-only package and reader evidence through the same seam used by the server. */
export const emitRunSkillEvidenceAuditEvents = (input: {
  emit(event: ReturnType<typeof createCustomEvent>): void;
  loadedSkills: LoadedSkillInstruction[];
  materializedSkills: MaterializedSkill[];
  runId: string;
}): void => {
  const materialized = createSkillMaterializedAuditCapture(input.materializedSkills);
  input.emit(createCustomEvent("skill.materialized", {
    eventId: createSkillMaterializedAuditEventId(input.runId, materialized),
    ...materialized,
  }));
  emitSkillLoadedAuditEvents({
    emit: input.emit,
    loadedSkills: input.loadedSkills,
    runId: input.runId,
  });
};

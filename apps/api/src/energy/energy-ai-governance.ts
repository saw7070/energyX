import { randomUUID } from "node:crypto";
import type { EnergyIqAiFeature, MetadataStore } from "@datafoundry/metadata";

/**
 * The single gate every AI request passes: is AI on for this organisation, and is it within this month's limit?
 * Allowed requests are recorded (and written to the audit history) before the model is called; refused ones are
 * recorded too, so administrators can see when people hit the limit. Token counts are added when the call finishes.
 */
export type AiRequestTicket = { usageId: string; workspaceId: string };

export class EnergyAiNotAllowedError extends Error {
  constructor(readonly reason: "disabled" | "limit", readonly used: number, readonly limit?: number) {
    super(reason === "disabled" ? "ENERGYIQ_AI_DISABLED" : "ENERGYIQ_AI_LIMIT_REACHED");
    this.name = "EnergyAiNotAllowedError";
  }
}

type AiRequestInput = {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId?: string | undefined;
  userId?: string | undefined;
  feature: EnergyIqAiFeature;
  model?: string | undefined;
  now?: Date;
};

const usageBase = (input: AiRequestInput) => ({
  workspaceId: input.workspaceId,
  ...(input.projectId ? { projectId: input.projectId } : {}),
  ...(input.userId ? { userId: input.userId } : {}),
  feature: input.feature,
  ...(input.model ? { model: input.model } : {}),
  ...(input.now ? { now: input.now } : {}),
});

/** Refuses (and records the refusal) when AI is off for the organisation or its monthly limit is used up. */
export const assertAiAllowed = (input: AiRequestInput): void => {
  // Stores built for narrow tests carry no EnergyIQ tables; the real server always does.
  const ai = input.metadataStore.energyIq?.ai;
  if (!ai) return;
  const check = ai.check(input.workspaceId, input.now);
  if (check.allowed) return;
  ai.recordUsage({ ...usageBase(input), status: check.reason === "disabled" ? "blocked-disabled" : "blocked-limit" });
  audit(input.metadataStore, input.userId, "energyiq.ai_blocked", {
    workspaceId: input.workspaceId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    feature: input.feature,
    reason: check.reason,
    ...(check.limit !== undefined ? { limit: check.limit } : {}),
  });
  throw new EnergyAiNotAllowedError(check.reason, check.used, check.limit);
};

/** Counts one AI request against the organisation's month and writes it to the audit history. */
export const recordAiRequest = (input: AiRequestInput): AiRequestTicket | undefined => {
  const ai = input.metadataStore.energyIq?.ai;
  if (!ai) return undefined;
  const usage = ai.recordUsage({ ...usageBase(input), status: "allowed" });
  audit(input.metadataStore, input.userId, "energyiq.ai_used", {
    workspaceId: input.workspaceId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    feature: input.feature,
    ...(input.model ? { model: input.model } : {}),
  });
  return { usageId: usage.id, workspaceId: input.workspaceId };
};

/** Check and record in one step, for callers that start the model straight away. */
export const beginAiRequest = (input: AiRequestInput): AiRequestTicket | undefined => {
  assertAiAllowed(input);
  return recordAiRequest(input);
};

export const finishAiRequest = (metadataStore: MetadataStore, ticket: AiRequestTicket | undefined, result: { model?: string | undefined; inputTokens?: number | undefined; outputTokens?: number | undefined }): void => {
  if (!ticket) return;
  try {
    metadataStore.energyIq?.ai.completeUsage(ticket.usageId, {
      ...(result.model ? { model: result.model } : {}),
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
    });
  } catch {
    // Usage bookkeeping must never fail the answer the person is waiting for.
  }
};

/** The model a request for this organisation should use: its chosen one, or undefined for the platform default. */
export const aiModelProfileFor = (metadataStore: MetadataStore, workspaceId: string | undefined): string | undefined =>
  workspaceId ? metadataStore.energyIq?.ai.getSettings(workspaceId).modelProfileId : undefined;

/** A short, plain message for people who hit the gate. */
export const aiNotAllowedMessage = (error: EnergyAiNotAllowedError): string => error.reason === "disabled"
  ? "AI features are turned off for your organisation. Ask your administrator if you need them."
  : `Your organisation has used its ${error.limit ?? 0} AI requests for this month. Ask your administrator to raise the limit, or try again next month.`;

const audit = (metadataStore: MetadataStore, userId: string | undefined, eventType: string, metadata: Record<string, unknown>): void => {
  try {
    let email: string | undefined;
    if (userId) {
      try {
        email = metadataStore.users.getById({ user_id: userId }).email;
      } catch {
        email = undefined;
      }
    }
    metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: eventType,
      ...(userId ? { user_id: userId } : {}),
      ...(email ? { email } : {}),
      metadata,
    });
  } catch {
    // The audit write is best effort here; the usage record above is the source of truth for limits.
  }
};

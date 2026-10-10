import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createSuccessResult } from "@datafoundry/contracts";
import { aiUsageMonthStart, type MetadataStore, type UserRecord } from "@datafoundry/metadata";

import { compatible } from "../report-models-api.js";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { can, resolveEnergyPermissions } from "./energy-permissions.js";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";

/**
 * AI governance routes:
 *   GET|POST ai/feedback                 a person's helpful / not helpful rating of one AI answer
 *   GET|PUT  ai/settings                 the active organisation's AI status; its People admins may switch AI on or off
 *   GET      admin/ai                    super admins: every organisation's AI settings, this month's usage, models
 *   PUT      admin/ai/:workspaceId       super admins: switch AI, choose the model, set the monthly limit
 *   GET      admin/ai/:workspaceId/activity   super admins: recent AI requests and feedback for one organisation
 * Returns undefined for any other path.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };
const ok = (data: unknown, status = 200): ConfigApiResponse => ({ status, headers: NO_STORE, body: createSuccessResult(data) });

export const handleAiApi = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>,
  user: UserRecord,
  helpers: { readJsonBody: (request: IncomingMessage) => Promise<unknown> },
): Promise<ConfigApiResponse | undefined> => {
  const method = request.method ?? "GET";
  const params = new URL(request.url ?? "/", "http://localhost").searchParams;
  const metadataStore = context.metadataStore;
  const ai = metadataStore.energyIq.ai;

  if (segments[0] === "ai" && segments[1] === "feedback" && segments.length === 2) {
    if (method === "GET") {
      const found = ai.findFeedback(user.id, params.get("targetKind") ?? "", params.get("targetId") ?? "");
      return ok(found ? { rating: found.rating } : {});
    }
    if (method === "POST") {
      const body = asRecord(await helpers.readJsonBody(request));
      const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
      if (projectId) {
        const capabilities = resolveEnergyProjectCapabilities({ metadataStore, userId: user.id, workspaceId: context.workspaceId, projectId });
        if (!capabilities.readProjectInformation) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
      } else if (!can(resolveEnergyPermissions(metadataStore, user, context.workspaceId), "reports", "read")) {
        throw new Error("ENERGYIQ_AI_FEEDBACK_FORBIDDEN");
      }
      const saved = ai.recordFeedback({
        workspaceId: context.workspaceId,
        ...(projectId ? { projectId } : {}),
        userId: user.id,
        targetKind: String(body.targetKind ?? ""),
        targetId: String(body.targetId ?? ""),
        rating: body.rating,
        comment: body.comment,
      });
      return ok({ rating: saved.rating });
    }
  }

  if (segments[0] === "ai" && segments[1] === "settings" && segments.length === 2) {
    const permissions = resolveEnergyPermissions(metadataStore, user, context.workspaceId);
    if (!can(permissions, "reports", "read") && !can(permissions, "people", "read")) throw new Error("ENERGYIQ_AI_SETTINGS_FORBIDDEN");
    const canToggle = can(permissions, "people", "write");
    if (method === "PUT") {
      if (!canToggle) throw new Error("ENERGYIQ_AI_SETTINGS_FORBIDDEN");
      const body = asRecord(await helpers.readJsonBody(request));
      if (typeof body.enabled !== "boolean") throw new Error("ENERGYIQ_AI_SETTINGS_INVALID");
      ai.setSettings(context.workspaceId, { enabled: body.enabled }, user.id);
      auditSettings(metadataStore, user, context.workspaceId, { enabled: body.enabled });
    } else if (method !== "GET") {
      return undefined;
    }
    return ok(organisationView(metadataStore, context.workspaceId, canToggle));
  }

  if (segments[0] === "admin" && segments[1] === "ai") {
    if (resolveEnergyIqUserRole(metadataStore, user) !== "admin") throw new Error("ENERGYIQ_ADMIN_REQUIRED");
    const workspaceId = segments[2] ? decodeURIComponent(segments[2]) : undefined;
    if (segments.length === 2 && method === "GET") return ok(adminView(metadataStore));
    if (segments.length === 3 && workspaceId && method === "PUT") {
      requireCustomerWorkspace(metadataStore, workspaceId);
      const body = asRecord(await helpers.readJsonBody(request));
      const modelProfileId = body.modelProfileId === null || body.modelProfileId === "" ? null
        : typeof body.modelProfileId === "string" ? body.modelProfileId : undefined;
      if (modelProfileId) {
        const model = compatibleModels(metadataStore).find((candidate) => candidate.id === modelProfileId);
        if (!model) throw new Error("ENERGYIQ_AI_MODEL_INVALID");
      }
      const limit = body.monthlyRequestLimit === null || body.monthlyRequestLimit === "" ? null
        : body.monthlyRequestLimit === undefined ? undefined : Number(body.monthlyRequestLimit);
      const patch = {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(modelProfileId !== undefined ? { modelProfileId } : {}),
        ...(limit !== undefined ? { monthlyRequestLimit: limit } : {}),
      };
      ai.setSettings(workspaceId, patch, user.id);
      auditSettings(metadataStore, user, workspaceId, patch);
      return ok(adminView(metadataStore));
    }
    if (segments.length === 4 && workspaceId && segments[3] === "activity" && method === "GET") {
      requireCustomerWorkspace(metadataStore, workspaceId);
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const names = projectNames(metadataStore, workspaceId);
      const emails = new Map<string, string>();
      const email = (userId: string | undefined) => {
        if (!userId) return undefined;
        if (!emails.has(userId)) {
          try {
            emails.set(userId, metadataStore.users.getById({ user_id: userId }).email ?? userId);
          } catch {
            emails.set(userId, userId);
          }
        }
        return emails.get(userId);
      };
      return ok({
        usage: ai.listUsage(workspaceId, since, 200).map((entry) => ({
          ...entry,
          ...(entry.projectId ? { project: names.get(entry.projectId) ?? entry.projectId } : {}),
          ...(entry.userId ? { user: email(entry.userId) } : {}),
        })),
        feedback: ai.listFeedback(workspaceId, since, 100).map((entry) => ({
          ...entry,
          ...(entry.projectId ? { project: names.get(entry.projectId) ?? entry.projectId } : {}),
          user: email(entry.userId),
        })),
      });
    }
  }
  return undefined;
};

/** What the organisation's own people see: on or off, the limit and how much of it is used. */
const organisationView = (metadataStore: MetadataStore, workspaceId: string, canToggle: boolean) => {
  const settings = metadataStore.energyIq.ai.getSettings(workspaceId);
  const summary = metadataStore.energyIq.ai.usageSummary(workspaceId, aiUsageMonthStart(new Date()));
  const model = settings.modelProfileId ? compatibleModels(metadataStore).find((candidate) => candidate.id === settings.modelProfileId) : undefined;
  return {
    enabled: settings.enabled,
    ...(settings.monthlyRequestLimit !== undefined ? { monthlyRequestLimit: settings.monthlyRequestLimit } : {}),
    usedThisMonth: summary.requests,
    blockedThisMonth: summary.blocked,
    model: model ? model.label : "Platform default",
    canToggle,
  };
};

const adminView = (metadataStore: MetadataStore) => {
  const models = compatibleModels(metadataStore);
  const monthStart = aiUsageMonthStart(new Date());
  const platform = metadataStore.workspaceDefaultModelProfiles.find("default");
  const organisations = metadataStore.workspaces.list()
    .filter((workspace) => workspace.kind === "customer")
    .map((workspace) => {
      const settings = metadataStore.energyIq.ai.getSettings(workspace.id);
      const usage = metadataStore.energyIq.ai.usageSummary(workspace.id, monthStart);
      const feedback = metadataStore.energyIq.ai.listFeedback(workspace.id, monthStart, 500);
      return {
        id: workspace.id,
        name: workspace.name,
        disabled: Boolean(workspace.disabled_at),
        settings,
        usage: { ...usage, helpful: feedback.filter((entry) => entry.rating === "up").length, notHelpful: feedback.filter((entry) => entry.rating === "down").length },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    monthStart,
    platformModel: platform ? models.find((model) => model.id === platform.profile_id)?.label ?? platform.profile_id : null,
    models,
    organisations,
  };
};

/** Models an administrator connected and tested for reports; the only ones an organisation may be given. */
const compatibleModels = (metadataStore: MetadataStore) => metadataStore.configResources
  .listAllOfKind({ workspace_id: "default", kind: "model-profile" })
  .filter((record) => compatible(record))
  .map((record) => {
    const modelName = String(record.payload.modelName ?? record.payload.model ?? "");
    let host = "";
    try {
      host = new URL(String(record.payload.baseUrl ?? "")).hostname;
    } catch {
      host = "";
    }
    return { id: record.id, name: record.name, modelName, host, label: `${record.name} (${modelName})` };
  });

const projectNames = (metadataStore: MetadataStore, workspaceId: string) =>
  new Map(metadataStore.energyIq.listProjectsByWorkspace(workspaceId).map((project) => [project.id, project.name]));

const requireCustomerWorkspace = (metadataStore: MetadataStore, workspaceId: string): void => {
  const workspace = metadataStore.workspaces.list().find((candidate) => candidate.id === workspaceId);
  if (!workspace || workspace.kind !== "customer") throw new Error("ENERGYIQ_WORKSPACE_NOT_FOUND");
};

const auditSettings = (metadataStore: MetadataStore, user: UserRecord, workspaceId: string, change: Record<string, unknown>): void => {
  try {
    metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: "energyiq.ai_settings_changed",
      user_id: user.id,
      ...(user.email ? { email: user.email } : {}),
      metadata: { workspaceId, ...change },
    });
  } catch {
    // The change itself is saved; a failed audit write must not undo it.
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ENERGYIQ_INVALID_BODY");
  return value as Record<string, unknown>;
};

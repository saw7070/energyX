import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * How each customer organisation may use AI: whether it is on at all, which configured model its data goes to, and a
 * monthly cap on AI requests. Every AI request is recorded (who, when, which site, feature, model, tokens) so usage can
 * be counted against the cap, shown to administrators and audited. People can rate AI answers helpful or not.
 */

export type EnergyIqAiSettings = {
  workspaceId: string;
  enabled: boolean;
  /** A model profile from the platform's configured models; absent means the platform default. */
  modelProfileId?: string;
  /** AI requests allowed per calendar month (UTC); absent means no limit. */
  monthlyRequestLimit?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type EnergyIqAiSettingsPatch = {
  enabled?: boolean;
  modelProfileId?: string | null;
  monthlyRequestLimit?: number | null;
};

export type EnergyIqAiFeature = "advisor" | "report" | "overview" | "insights" | "actions" | "other";

export type EnergyIqAiUsageRecord = {
  id: string;
  workspaceId: string;
  projectId?: string;
  userId?: string;
  feature: EnergyIqAiFeature;
  model?: string;
  status: "allowed" | "blocked-disabled" | "blocked-limit";
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
};

export type EnergyIqAiFeedbackRecord = {
  id: string;
  workspaceId: string;
  projectId?: string;
  userId: string;
  targetKind: string;
  targetId: string;
  rating: "up" | "down";
  comment?: string;
  createdAt: string;
};

export type EnergyIqAiCheck =
  | { allowed: true; used: number; limit?: number }
  | { allowed: false; reason: "disabled" | "limit"; used: number; limit?: number };

const FEATURES: ReadonlySet<string> = new Set(["advisor", "report", "overview", "insights", "actions", "other"]);
const MAX_LIMIT = 1_000_000;

export const initializeEnergyIqAiGovernanceSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_ai_settings (
      workspace_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      model_profile_id TEXT,
      monthly_request_limit INTEGER,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS energyiq_ai_usage (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      feature TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL CHECK (status IN ('allowed', 'blocked-disabled', 'blocked-limit')),
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_ai_usage_workspace_time
      ON energyiq_ai_usage(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_ai_feedback (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
      comment TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, target_kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_ai_feedback_workspace_time
      ON energyiq_ai_feedback(workspace_id, created_at DESC);
  `);
};

/** The first instant of the calendar month (UTC) that `now` falls in. */
export const aiUsageMonthStart = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

export class EnergyIqAiGovernanceStore {
  constructor(private readonly db: DatabaseSync) {}

  getSettings(workspaceId: string): EnergyIqAiSettings {
    const row = this.db.prepare("SELECT * FROM energyiq_ai_settings WHERE workspace_id = ?").get(workspaceId) as Record<string, unknown> | undefined;
    if (!row) return { workspaceId, enabled: true };
    return {
      workspaceId,
      enabled: Number(row.enabled) === 1,
      ...(typeof row.model_profile_id === "string" && row.model_profile_id ? { modelProfileId: row.model_profile_id } : {}),
      ...(row.monthly_request_limit !== null && row.monthly_request_limit !== undefined ? { monthlyRequestLimit: Number(row.monthly_request_limit) } : {}),
      updatedAt: String(row.updated_at),
      ...(typeof row.updated_by === "string" ? { updatedBy: row.updated_by } : {}),
    };
  }

  setSettings(workspaceId: string, patch: EnergyIqAiSettingsPatch, userId: string, now = new Date()): EnergyIqAiSettings {
    const current = this.getSettings(workspaceId);
    const enabled = patch.enabled === undefined ? current.enabled : patch.enabled === true;
    const modelProfileId = patch.modelProfileId === undefined ? current.modelProfileId : patch.modelProfileId ?? undefined;
    if (modelProfileId !== undefined && (typeof modelProfileId !== "string" || !modelProfileId.trim() || modelProfileId.length > 200)) {
      throw new Error("ENERGYIQ_AI_MODEL_INVALID");
    }
    let limit = current.monthlyRequestLimit;
    if (patch.monthlyRequestLimit !== undefined) {
      if (patch.monthlyRequestLimit === null) limit = undefined;
      else {
        const value = Number(patch.monthlyRequestLimit);
        if (!Number.isInteger(value) || value < 0 || value > MAX_LIMIT) throw new Error("ENERGYIQ_AI_LIMIT_INVALID");
        limit = value;
      }
    }
    this.db.prepare(`
      INSERT INTO energyiq_ai_settings (workspace_id, enabled, model_profile_id, monthly_request_limit, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        enabled = excluded.enabled,
        model_profile_id = excluded.model_profile_id,
        monthly_request_limit = excluded.monthly_request_limit,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(workspaceId, enabled ? 1 : 0, modelProfileId ?? null, limit ?? null, userId, now.toISOString());
    return this.getSettings(workspaceId);
  }

  /** AI requests that went ahead this calendar month. */
  requestsThisMonth(workspaceId: string, now = new Date()): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM energyiq_ai_usage WHERE workspace_id = ? AND status = 'allowed' AND created_at >= ?
    `).get(workspaceId, aiUsageMonthStart(now)) as { count: number };
    return Number(row.count);
  }

  /** Whether one more AI request may go ahead for this organisation now. */
  check(workspaceId: string, now = new Date()): EnergyIqAiCheck {
    const settings = this.getSettings(workspaceId);
    const used = this.requestsThisMonth(workspaceId, now);
    const limit = settings.monthlyRequestLimit;
    if (!settings.enabled) return { allowed: false, reason: "disabled", used, ...(limit !== undefined ? { limit } : {}) };
    if (limit !== undefined && used >= limit) return { allowed: false, reason: "limit", used, limit };
    return { allowed: true, used, ...(limit !== undefined ? { limit } : {}) };
  }

  recordUsage(input: {
    workspaceId: string;
    projectId?: string;
    userId?: string;
    feature: EnergyIqAiFeature;
    model?: string;
    status: EnergyIqAiUsageRecord["status"];
    now?: Date;
  }): EnergyIqAiUsageRecord {
    const id = `ai-usage-${randomUUID()}`;
    const feature = FEATURES.has(input.feature) ? input.feature : "other";
    this.db.prepare(`
      INSERT INTO energyiq_ai_usage (id, workspace_id, project_id, user_id, feature, model, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspaceId, input.projectId ?? null, input.userId ?? null, feature, input.model?.slice(0, 200) ?? null, input.status, (input.now ?? new Date()).toISOString());
    return this.getUsage(id)!;
  }

  /** Adds the model and token counts once a request has finished. */
  completeUsage(id: string, input: { model?: string; inputTokens?: number; outputTokens?: number }): void {
    this.db.prepare(`
      UPDATE energyiq_ai_usage SET
        model = COALESCE(?, model),
        input_tokens = COALESCE(input_tokens, 0) + ?,
        output_tokens = COALESCE(output_tokens, 0) + ?
      WHERE id = ?
    `).run(input.model?.slice(0, 200) ?? null, Math.max(0, Math.round(input.inputTokens ?? 0)), Math.max(0, Math.round(input.outputTokens ?? 0)), id);
  }

  getUsage(id: string): EnergyIqAiUsageRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_ai_usage WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapUsage(row) : undefined;
  }

  listUsage(workspaceId: string, sinceIso: string, limit = 200): EnergyIqAiUsageRecord[] {
    return (this.db.prepare(`
      SELECT * FROM energyiq_ai_usage WHERE workspace_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?
    `).all(workspaceId, sinceIso, Math.min(Math.max(1, limit), 1000)) as Array<Record<string, unknown>>).map(mapUsage);
  }

  usageSummary(workspaceId: string, sinceIso: string): { requests: number; blocked: number; inputTokens: number; outputTokens: number; byFeature: Record<string, number> } {
    const rows = this.db.prepare(`
      SELECT feature, status, COUNT(*) AS count, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
      FROM energyiq_ai_usage WHERE workspace_id = ? AND created_at >= ? GROUP BY feature, status
    `).all(workspaceId, sinceIso) as Array<{ feature: string; status: string; count: number; input_tokens: number; output_tokens: number }>;
    const summary = { requests: 0, blocked: 0, inputTokens: 0, outputTokens: 0, byFeature: {} as Record<string, number> };
    for (const row of rows) {
      if (row.status === "allowed") {
        summary.requests += Number(row.count);
        summary.byFeature[row.feature] = (summary.byFeature[row.feature] ?? 0) + Number(row.count);
      } else summary.blocked += Number(row.count);
      summary.inputTokens += Number(row.input_tokens);
      summary.outputTokens += Number(row.output_tokens);
    }
    return summary;
  }

  /** One rating per person per answer; rating again replaces it. */
  recordFeedback(input: { workspaceId: string; projectId?: string; userId: string; targetKind: string; targetId: string; rating: unknown; comment?: unknown; now?: Date }): EnergyIqAiFeedbackRecord {
    if (input.rating !== "up" && input.rating !== "down") throw new Error("ENERGYIQ_AI_FEEDBACK_RATING_INVALID");
    const kind = String(input.targetKind ?? "").trim();
    const target = String(input.targetId ?? "").trim();
    if (!/^[a-z][a-z0-9-]{1,40}$/u.test(kind) || !target || target.length > 300) throw new Error("ENERGYIQ_AI_FEEDBACK_TARGET_INVALID");
    const comment = typeof input.comment === "string" && input.comment.trim() ? input.comment.trim().slice(0, 1000) : null;
    this.db.prepare(`
      INSERT INTO energyiq_ai_feedback (id, workspace_id, project_id, user_id, target_kind, target_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, target_kind, target_id) DO UPDATE SET
        rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at,
        workspace_id = excluded.workspace_id, project_id = excluded.project_id
    `).run(`ai-feedback-${randomUUID()}`, input.workspaceId, input.projectId ?? null, input.userId, kind, target, input.rating, comment, (input.now ?? new Date()).toISOString());
    return this.findFeedback(input.userId, kind, target)!;
  }

  findFeedback(userId: string, targetKind: string, targetId: string): EnergyIqAiFeedbackRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_ai_feedback WHERE user_id = ? AND target_kind = ? AND target_id = ?").get(userId, targetKind, targetId) as Record<string, unknown> | undefined;
    return row ? mapFeedback(row) : undefined;
  }

  listFeedback(workspaceId: string, sinceIso: string, limit = 100): EnergyIqAiFeedbackRecord[] {
    return (this.db.prepare(`
      SELECT * FROM energyiq_ai_feedback WHERE workspace_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?
    `).all(workspaceId, sinceIso, Math.min(Math.max(1, limit), 500)) as Array<Record<string, unknown>>).map(mapFeedback);
  }
}

const mapUsage = (row: Record<string, unknown>): EnergyIqAiUsageRecord => ({
  id: String(row.id),
  workspaceId: String(row.workspace_id),
  ...(typeof row.project_id === "string" ? { projectId: row.project_id } : {}),
  ...(typeof row.user_id === "string" ? { userId: row.user_id } : {}),
  feature: String(row.feature) as EnergyIqAiFeature,
  ...(typeof row.model === "string" ? { model: row.model } : {}),
  status: String(row.status) as EnergyIqAiUsageRecord["status"],
  ...(row.input_tokens !== null && row.input_tokens !== undefined ? { inputTokens: Number(row.input_tokens) } : {}),
  ...(row.output_tokens !== null && row.output_tokens !== undefined ? { outputTokens: Number(row.output_tokens) } : {}),
  createdAt: String(row.created_at),
});

const mapFeedback = (row: Record<string, unknown>): EnergyIqAiFeedbackRecord => ({
  id: String(row.id),
  workspaceId: String(row.workspace_id),
  ...(typeof row.project_id === "string" ? { projectId: row.project_id } : {}),
  userId: String(row.user_id),
  targetKind: String(row.target_kind),
  targetId: String(row.target_id),
  rating: String(row.rating) as "up" | "down",
  ...(typeof row.comment === "string" ? { comment: row.comment } : {}),
  createdAt: String(row.created_at),
});

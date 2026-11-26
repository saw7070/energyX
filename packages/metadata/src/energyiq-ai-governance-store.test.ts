import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMetadataStore, type MetadataStore } from "./index.js";

describe("EnergyIQ AI governance store", () => {
  let root: string;
  let metadata: MetadataStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "energyiq-ai-gov-"));
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  });
  afterEach(() => {
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("is on with no limit until an organisation's settings say otherwise", () => {
    const ai = metadata.energyIq.ai;
    expect(ai.getSettings("client-a")).toEqual({ workspaceId: "client-a", enabled: true });
    expect(ai.check("client-a")).toEqual({ allowed: true, used: 0 });
    const saved = ai.setSettings("client-a", { enabled: false, modelProfileId: "profile-deepseek", monthlyRequestLimit: 50 }, "admin");
    expect(saved).toMatchObject({ enabled: false, modelProfileId: "profile-deepseek", monthlyRequestLimit: 50, updatedBy: "admin" });
    expect(ai.check("client-a")).toEqual({ allowed: false, reason: "disabled", used: 0, limit: 50 });
    expect(ai.setSettings("client-a", { enabled: true, modelProfileId: null, monthlyRequestLimit: null }, "admin")).toMatchObject({ enabled: true });
    expect(ai.getSettings("client-a").modelProfileId).toBeUndefined();
    expect(() => ai.setSettings("client-a", { monthlyRequestLimit: -1 }, "admin")).toThrow("ENERGYIQ_AI_LIMIT_INVALID");
  });

  it("counts this month's requests against the limit and keeps tokens per request", () => {
    const ai = metadata.energyIq.ai;
    ai.setSettings("client-a", { monthlyRequestLimit: 2 }, "admin");
    const now = new Date("2026-10-10T03:00:00Z");
    ai.recordUsage({ workspaceId: "client-a", feature: "advisor", status: "allowed", now: new Date("2026-09-30T23:00:00Z") });
    const first = ai.recordUsage({ workspaceId: "client-a", projectId: "site-1", userId: "u1", feature: "advisor", status: "allowed", now });
    ai.completeUsage(first.id, { model: "deepseek-chat", inputTokens: 1200, outputTokens: 300 });
    ai.completeUsage(first.id, { inputTokens: 100, outputTokens: 50 });
    expect(ai.getUsage(first.id)).toMatchObject({ model: "deepseek-chat", inputTokens: 1300, outputTokens: 350 });
    expect(ai.check("client-a", now)).toEqual({ allowed: true, used: 1, limit: 2 });
    ai.recordUsage({ workspaceId: "client-a", feature: "report", status: "allowed", now });
    ai.recordUsage({ workspaceId: "client-a", feature: "report", status: "blocked-limit", now });
    expect(ai.check("client-a", now)).toEqual({ allowed: false, reason: "limit", used: 2, limit: 2 });
    expect(ai.usageSummary("client-a", "2026-10-01T00:00:00.000Z")).toEqual({ requests: 2, blocked: 1, inputTokens: 1300, outputTokens: 350, cacheReadTokens: 0, cacheWriteTokens: 0, byFeature: { advisor: 1, report: 1 } });
    expect(ai.listUsage("client-a", "2026-10-01T00:00:00.000Z").map((usage) => usage.status)).toContain("blocked-limit");
  });

  it("keeps cached input apart from full-price input, call by call", () => {
    const ai = metadata.energyIq.ai;
    const now = new Date("2026-10-10T03:00:00Z");
    const run = ai.recordUsage({ workspaceId: "client-a", feature: "advisor", status: "allowed", now });
    ai.completeUsage(run.id, { model: "claude-opus-5", inputTokens: 24, outputTokens: 900, cacheWriteTokens: 18_000 });
    ai.completeUsage(run.id, { inputTokens: 30, outputTokens: 1_100, cacheReadTokens: 18_000, cacheWriteTokens: 2_500 });
    expect(ai.getUsage(run.id)).toMatchObject({ inputTokens: 54, outputTokens: 2_000, cacheReadTokens: 18_000, cacheWriteTokens: 20_500 });
    expect(ai.usageSummary("client-a", "2026-10-01T00:00:00.000Z")).toMatchObject({ inputTokens: 54, outputTokens: 2_000, cacheReadTokens: 18_000, cacheWriteTokens: 20_500 });
  });

  it("adds the cache columns to a usage table created before they existed", () => {
    metadata.close();
    const path = join(root, "older.sqlite");
    const older = new DatabaseSync(path);
    older.exec(`CREATE TABLE energyiq_ai_usage (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, user_id TEXT, feature TEXT NOT NULL,
      model TEXT, status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL)`);
    older.prepare("INSERT INTO energyiq_ai_usage (id, workspace_id, feature, model, status, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("ai-usage-old", "client-a", "advisor", "claude-opus-5", "allowed", 48, 8956, "2026-10-12T02:00:00.000Z");
    older.close();
    metadata = createMetadataStore({ database_path: path });
    const ai = metadata.energyIq.ai;
    expect(ai.getUsage("ai-usage-old")).toEqual(expect.objectContaining({ inputTokens: 48, outputTokens: 8956 }));
    expect(ai.getUsage("ai-usage-old")).not.toHaveProperty("cacheReadTokens");
    ai.completeUsage("ai-usage-old", { cacheReadTokens: 40_000 });
    expect(ai.getUsage("ai-usage-old")).toMatchObject({ inputTokens: 48, cacheReadTokens: 40_000, cacheWriteTokens: 0 });
  });

  it("keeps one rating per person per answer", () => {
    const ai = metadata.energyIq.ai;
    ai.recordFeedback({ workspaceId: "client-a", userId: "u1", targetKind: "report", targetId: "run-1", rating: "up" });
    const changed = ai.recordFeedback({ workspaceId: "client-a", userId: "u1", targetKind: "report", targetId: "run-1", rating: "down", comment: " Wrong month " });
    expect(changed).toMatchObject({ rating: "down", comment: "Wrong month" });
    expect(ai.listFeedback("client-a", "2000-01-01T00:00:00Z")).toHaveLength(1);
    expect(() => ai.recordFeedback({ workspaceId: "client-a", userId: "u1", targetKind: "report", targetId: "run-1", rating: "meh" })).toThrow("ENERGYIQ_AI_FEEDBACK_RATING_INVALID");
    expect(() => ai.recordFeedback({ workspaceId: "client-a", userId: "u1", targetKind: "Bad Kind!", targetId: "x", rating: "up" })).toThrow("ENERGYIQ_AI_FEEDBACK_TARGET_INVALID");
  });
});

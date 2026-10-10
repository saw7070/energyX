import { mkdtempSync, rmSync } from "node:fs";
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
    expect(ai.usageSummary("client-a", "2026-10-01T00:00:00.000Z")).toEqual({ requests: 2, blocked: 1, inputTokens: 1300, outputTokens: 350, byFeature: { advisor: 1, report: 1 } });
    expect(ai.listUsage("client-a", "2026-10-01T00:00:00.000Z").map((usage) => usage.status)).toContain("blocked-limit");
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

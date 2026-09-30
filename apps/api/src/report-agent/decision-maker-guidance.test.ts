import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportPrompt } from "./report-service.js";
import { cadenceSkillVersion, withCadenceSkill } from "./report-schedule-policy.js";
import type { ReportRun, ReportSettings } from "./report-store.js";

const run = (kind: "chat" | "report") => ({ kind, prompt: "Why was last week higher?", period: { from: "2026-08-14", toExclusive: "2026-09-11" }, settings: { timezone: "Asia/Singapore" } }) as unknown as ReportRun;

describe("decision-maker guidance", () => {
  it("tells chat answers to lead with the answer in plain words and money, and to offer charts when they help", () => {
    const prompt = reportPrompt(run("chat"));
    expect(prompt).toContain("key decision maker");
    expect(prompt).toContain("Start with the direct answer in one or two plain sentences");
    expect(prompt).toContain("explain with charts");
    expect(prompt).toContain("Administrator message:\nWhy was last week higher?");
  });
  it("tells reports to read as a story and end the opening with the decisions needed", () => {
    const prompt = reportPrompt(run("report"));
    expect(prompt).toContain("Tell the period as a story");
    expect(prompt).toContain("Decisions needed");
  });
});

describe("cadence skill version", () => {
  it("follows the built-in Skill file", () => {
    expect(cadenceSkillVersion("---\nname: x\nversion: 0.2.0\n---\nBody")).toBe("0.2.0");
    expect(cadenceSkillVersion('---\nname: x\nmetadata:\n  version: "1.8.0"\n---')).toBe("1.8.0");
    const monthly = withCadenceSkill({ skillRefs: [] } as unknown as ReportSettings, "monthly");
    const file = readFileSync(new URL("../../../../packages/skills/builtin/energy-monthly-review/SKILL.md", import.meta.url), "utf8");
    expect(monthly.skillRefs?.[0]).toMatchObject({ name: "energy-monthly-review", version: cadenceSkillVersion(file) });
    expect(file).toContain("Month at a glance");
  });
});

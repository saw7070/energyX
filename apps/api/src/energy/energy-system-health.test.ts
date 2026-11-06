import { describe, expect, it } from "vitest";
import { checkAdvisorWorker, checkAiDataRegion, checkEmail, tuyaRetentionNote } from "./energy-system-health.js";

const enabled = { ENERGYIQ_REPORT_AGENT_ENABLED: "true", ENERGYIQ_REPORT_AGENT_IMAGE: "worker:test" };

describe("system health checks", () => {
  it("reports the advisor worker ready only when Docker answers and the image exists", async () => {
    const calls: string[][] = [];
    const ready = await checkAdvisorWorker(enabled, async (_file, args) => { calls.push(args); });
    expect(ready.status).toBe("ok");
    expect(calls.map(args => args.slice(0, 2))).toEqual([["version", "--format"], ["image", "inspect"]]);
    expect(calls[1]).toContain("worker:test");
  });

  it("names the missing image and how to build it", async () => {
    const missing = await checkAdvisorWorker(enabled, async (_file, args) => { if (args[0] === "image") throw new Error("No such image"); });
    expect(missing).toMatchObject({ status: "problem", detail: expect.stringContaining("worker:test"), fix: expect.stringContaining("docker build -t worker:test") });
  });

  it("separates Docker being down from the advisor being switched off", async () => {
    expect((await checkAdvisorWorker(enabled, async () => { throw new Error("daemon down"); })).detail).toContain("Docker is not running");
    expect((await checkAdvisorWorker({}, async () => undefined)).status).toBe("warning");
  });

  it("warns when AI requests go to mainland China", () => {
    for (const host of ["dashscope.aliyuncs.com", "api.deepseek.com", "open.bigmodel.cn"]) {
      expect(checkAiDataRegion(host).status).toBe("warning");
    }
    for (const host of ["dashscope-intl.aliyuncs.com", "api.openai.com", "llm.internal.example.com"]) {
      expect(checkAiDataRegion(host).status).toBe("ok");
    }
  });

  it("warns when emails are only in test mode", () => {
    expect(checkEmail({ AUTH_EMAIL_DELIVERY: "test" }).status).toBe("warning");
  });
  it("says how long is left before Tuya deletes readings a failing sync has not fetched, or which days are gone", () => {
    const now = Date.parse("2026-11-06T03:00:00.000Z");
    expect(tuyaRetentionNote(Date.parse("2026-11-03T18:00:00.000Z"), now)).toContain("fix this by 11 Nov");
    const lost = tuyaRetentionNote(Date.parse("2026-10-27T18:00:00.000Z"), now);
    expect(lost).toContain("Readings from 28 Oct to 30 Oct are older than Tuya keeps");
    expect(lost).toContain("resumes from the oldest readings Tuya still has");
    expect(tuyaRetentionNote(undefined, now)).toBe("");
  });
});

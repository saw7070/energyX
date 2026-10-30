import { describe, expect, it } from "vitest";
import { checkAdvisorWorker, checkAiDataRegion, checkEmail } from "./energy-system-health.js";

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
});

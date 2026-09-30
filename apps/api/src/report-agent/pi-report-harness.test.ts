import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetadataStore } from "@datafoundry/metadata";
import { createPiReportHarness, workerArguments, resolvePiReportModel } from "./pi-report-harness.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = mkdtempSync(join(tmpdir(), "energyiq-pi-smoke-")); roots.push(root); mkdirSync(join(root, "inputs")); mkdirSync(join(root, "outputs")); writeFileSync(join(root, "inputs", "facts.csv"), "kwh\n42\n"); return root; }
const model = () => ({ model: "test-report", baseUrl: "https://model.example/v1", apiKey: "host-only-secret" });
function stream(delta: unknown, reason = "stop") { return new Response(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "test", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }); }
it("constructs a networkless worker with no secret, mounts or Docker socket", () => {
  const args = workerArguments("test", "image");
  expect(args).toContain("none"); expect(args).toContain("--read-only");
  expect(args[args.indexOf("--pids-limit") + 1]).toBe("256");
  expect(args.join(" ")).not.toMatch(/--mount|--volume|--env|docker.sock|secret/);
});

describe.skipIf(process.env.S1_DOCKER_TEST !== "1")("real Pi SDK and isolated Docker boundary", () => {
  it("delivers visible text before the provider finishes streaming", async () => {
    let completed = false, earlyText = false;
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "stream", choices: [{ index: 0, delta: { role: "assistant", content: "Hello early" }, finish_reason: null }] })}\n\n`));
        setTimeout(() => { completed = true; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "stream", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "stream", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`)); controller.close(); }, 2000);
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    const harness = createPiReportHarness({ image: process.env.PI_TOOLS_TEST_IMAGE!, model, fetch: fetchImpl });
    const result = await harness({ directory: directory(), runId: randomUUID(), prompt: "Say hello, no file.", signal: new AbortController().signal,
      onEvent: event => { if (event.type === "answer_progress" && event.text?.includes("Hello early") && !completed) earlyText = true; },
    });
    expect(earlyText).toBe(true); expect(result.answer).toBe("Hello early world");
  }, 30000);
  it("roundtrips a project tool to the bound host handler and returns the saved result to Pi", async () => {
    let calls = 0;
    const executeTool = vi.fn(async (name, args) => {
      expect(name).toBe("project_test_save"); expect(args).toEqual({ revision: 3 });
      return { saved: true, revision: 4, project: "host-bound-project" };
    });
    const harness = createPiReportHarness({ image: process.env.PI_TOOLS_TEST_IMAGE ?? "energyiq-report-agent:pi-review-20260913", model, timeoutMs: 90_000,
      fetch: (async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        if (++calls === 1) {
          expect(body.tools.some((tool: any) => tool.function?.name === "project_test_save")).toBe(true);
          return stream({ role: "assistant", tool_calls: [{ index: 0, id: "save_project", type: "function", function: { name: "project_test_save", arguments: '{"revision":3}' } }] }, "tool_calls");
        }
        expect(JSON.stringify(body.messages)).toContain("host-bound-project");
        return stream({ role: "assistant", content: "Saved project revision 4." });
      }) as typeof fetch,
    });
    const result = await harness({ directory: directory(), runId: randomUUID(), prompt: "Save project", signal: new AbortController().signal,
      tools: [{ name: "project_test_save", description: "Save the bound project", parameters: { type: "object", properties: { revision: { type: "integer" } }, required: ["revision"], additionalProperties: false } }], executeTool });
    expect(executeTool).toHaveBeenCalledTimes(1); expect(result.answer).toContain("revision 4");
  }, 120_000);
  it("writes to the initial node-owned cwd through bash, then saves HTML and resumes Pi history", async () => {
    let calls = 0;
    const requests: any[] = [];
    const fetcher = vi.fn(async (_url, options) => {
      expect(new Headers(options?.headers).get("authorization")).toBe("Bearer host-only-secret");
      const body = JSON.parse(String(options?.body)); requests.push(body);
      if (++calls === 1) return stream({ role: "assistant", tool_calls: [{ index: 0, id: "initial_work_write", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: 'test "$(id -u)" = 1000 && test "$(stat -c %u .)" = 1000 && printf "initial cwd writable" > initial-work.txt && cp initial-work.txt /workspace/outputs/work-proof.txt' }) } }] }, "tool_calls");
      if (calls === 2) return stream({ role: "assistant", tool_calls: [{ index: 0, id: "write_report", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "/workspace/outputs/report.html", content: "<!doctype html><html lang='en'><body>Verified 42 kWh</body></html>" }) } }] }, "tool_calls");
      if (calls === 4) return stream({ role: "assistant", tool_calls: [{ index: 0, id: "review", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "/workspace/outputs/review.json", content: JSON.stringify({status:"pass",checks:[{claim:"42 kWh",evidence:"facts.csv"}],issues:[]}) }) } }] }, "tool_calls");
      return stream({ role: "assistant", content: "Report complete. Reference marker: retained-session." });
    }) as typeof fetch;
    const harness = createPiReportHarness({ image: (process.env.PI_TOOLS_TEST_IMAGE ?? "energyiq-report-agent:pi-review-20260913"), model, fetch: fetcher, timeoutMs: 90000 });
    const first = directory(); const id = randomUUID(); const events: unknown[] = [];
    const result = await harness({ directory: first, runId: id, prompt: "Write the HTML report.", signal: new AbortController().signal, onEvent: event => events.push(event) });
    expect(readFileSync(join(first, "outputs", "report.html"), "utf8")).toContain("42 kWh");
    expect(JSON.parse(readFileSync(join(first, "outputs", "browser-check.json"), "utf8")).status).toBe("pass");
    expect(events).toContainEqual({ type: "tool_execution_end", tool: "bash", isError: false });
    expect(readFileSync(join(first, "outputs", "work-proof.txt"), "utf8")).toBe("initial cwd writable");
    expect(events).toContainEqual({ type: "tool_execution_end", tool: "write", isError: false });
    const second = directory();
    const revised = await harness({ directory: second, runId: randomUUID(), prompt: "Recall the previous report.", previousStateDirectory: join(first, "state"), signal: new AbortController().signal });
    expect(revised.sessionId).toBe(result.sessionId);
    expect(JSON.stringify(requests.at(-1).messages)).toContain("retained-session");
    expect(execFileSync("docker", ["ps", "-aq", "--filter", `name=energyiq-report-${id}`], { encoding: "utf8", windowsHide: true }).trim()).toBe("");
  }, 120_000);
  it("cancels an in-flight model request and removes the container", async () => {
    const controller = new AbortController(); const id = randomUUID();
    const fetcher = vi.fn(async (_url, options) => {
      const inspect = JSON.parse(execFileSync("docker", ["inspect", `energyiq-report-${id}`], { encoding: "utf8", windowsHide: true }))[0];
      expect(inspect.HostConfig.NetworkMode).toBe("none");
      expect(inspect.Mounts.every((mount: any) => mount.Type === "tmpfs")).toBe(true);
      expect(inspect.Config.Env.join(" ")).not.toContain("host-only-secret");
      controller.abort();
      throw new Error("aborted");
    }) as typeof fetch;
    const harness = createPiReportHarness({ image: (process.env.PI_TOOLS_TEST_IMAGE ?? "energyiq-report-agent:pi-review-20260913"), model, fetch: fetcher });
    await expect(harness({ directory: directory(), runId: id, prompt: "Generate", signal: controller.signal })).rejects.toThrow("REPORT_CANCELLED");
    expect(fetcher).toHaveBeenCalled();
    expect(execFileSync("docker", ["ps", "-aq", "--filter", `name=energyiq-report-${id}`], { encoding: "utf8", windowsHide: true }).trim()).toBe("");
  });
  it("rejects a truncated upstream stream and cleans up without accepting output", async () => {
    const id = randomUUID();
    const harness = createPiReportHarness({ image: (process.env.PI_TOOLS_TEST_IMAGE ?? "energyiq-report-agent:pi-review-20260913"), model,
      fetch: (async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')) as typeof fetch });
    await expect(harness({ directory: directory(), runId: id, prompt: "Generate", signal: new AbortController().signal })).rejects.toThrow("REPORT_PI_FAILED");
    expect(execFileSync("docker", ["ps", "-aq", "--filter", `name=energyiq-report-${id}`], { encoding: "utf8", windowsHide: true }).trim()).toBe("");
  });

});

it("resolves legacy server profiles as OpenAI compatible with their secret owner", () => {
  const root = directory(); const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "fixture" });
  try {
    metadata.users.upsertDevUser({ id: "owner", email: "owner@example.test", display_name: "Owner", dev_token: "test" });
    metadata.workspaces.upsert({ id: "default", owner_user_id: "owner", name: "System", kind: "personal" });
    const ref = metadata.secrets.put({ workspace_id: "default", user_id: "owner", owner_kind: "model-profile", owner_id: "model", value: { apiKey: "host-only" } });
    metadata.configResources.upsert({ id: "model", workspace_id: "default", user_id: "owner", kind: "model-profile", name: "Model", payload: { provider: "deepseek", modelName: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1" }, secret_ref: ref, default_enabled: true, status: "connected" });
    metadata.workspaceDefaultModelProfiles.set({ workspace_id: "default", profile_id: "model", profile_owner_user_id: "owner", configured_by_user_id: "owner" });
    expect(resolvePiReportModel(metadata)).toEqual({ apiProtocol: "openai-completions", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1", apiKey: "host-only" });
  } finally { metadata.close(); }
});


it.skipIf(process.env.S1_DOCKER_TEST !== "1")("runs five isolated Pi containers concurrently through independent model bridges", async () => {
  let reached = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const harness = createPiReportHarness({ image: process.env.PI_TOOLS_TEST_IMAGE ?? "energyiq-report-agent:pi-review-20260913", model, timeoutMs: 90_000,
    fetch: (async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const token = JSON.stringify(body.messages).match(/parallel-user-[0-4]/)?.[0];
      expect(token).toBeTruthy();
      if (++reached === 5) release();
      await barrier;
      return stream({ role: "assistant", content: `Reply to ${token}` });
    }) as typeof fetch,
  });
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => harness({ directory: directory(), runId: randomUUID(), prompt: `Hello parallel-user-${i}`, signal: new AbortController().signal })));
  expect(reached).toBe(5);
  results.forEach((result, i) => expect(result.answer).toBe(`Reply to parallel-user-${i}`));
}, 120_000);

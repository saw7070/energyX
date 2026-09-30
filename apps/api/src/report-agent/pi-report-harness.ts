import { createHash } from "node:crypto";
import { ANNUAL_BENEFIT_REVIEW } from "./annual-benefit.js";
import { assertSelfContainedReport } from "./report-assets.js";
import { validateAnalysisPackage, ANALYSIS_PACKAGE_INSTRUCTIONS } from "./analysis-package.js";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MetadataStore } from "@datafoundry/metadata";
import { resolveWorkspaceDefaultModelProfileSnapshot } from "../workspace-model-profile-resolver.js";
import { reportModelProtocol, reportModelRequest, ReportModelStream, type ReportModelProtocol } from "../report-model-transport.js";
import type { ReportHarness } from "./report-harness.js";

export type PiReportModel = { apiProtocol?: ReportModelProtocol; model: string; baseUrl: string; apiKey: string; contextWindow?: number; maxTokens?: number };
export function resolvePiReportModel(metadata: MetadataStore): PiReportModel {
  const profile = resolveWorkspaceDefaultModelProfileSnapshot(metadata).profiles[0];
  if (!profile) throw new Error("REPORT_MODEL_NOT_CONFIGURED");
  const payload = profile.resource.payload;
  const url = new URL(String(payload.baseUrl ?? payload.base_url ?? ""));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("REPORT_MODEL_ENDPOINT_UNSUPPORTED");
  const credentials = profile.resource.secret_ref ? metadata.secrets.get({ ref: profile.resource.secret_ref, workspace_id: profile.ownerWorkspaceId, user_id: profile.ownerUserId }) : {};
  const apiKey = credentials.apiKey ?? credentials.api_key;
  const model = payload.modelName ?? payload.model;
  if (typeof apiKey !== "string" || !apiKey || typeof model !== "string" || !model) throw new Error("REPORT_MODEL_NOT_CONFIGURED");
  return { apiProtocol: reportModelProtocol(payload.apiProtocol), model, baseUrl: url.toString().replace(/\/$/, ""), apiKey };
}
const REVIEW_METHOD = readFileSync(new URL("../../../../packages/skills/builtin/report-review/SKILL.md", import.meta.url), "utf8") + "\n\n" + ANNUAL_BENEFIT_REVIEW + "\n\n" + ANALYSIS_PACKAGE_INSTRUCTIONS;
const execute = promisify(execFile);
const env = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE });
async function docker(args: string[], signal: AbortSignal) {
  try { return await execute("docker", args, { env: env(), windowsHide: true, signal, maxBuffer: 1024 * 1024 }); }
  catch { throw new Error(signal.aborted ? "REPORT_CANCELLED" : "REPORT_DOCKER_OPERATION_FAILED"); }
}
export function workerArguments(name: string, image: string): string[] {
  const configuredMemory = Number(process.env.ENERGYIQ_REPORT_WORKER_MEMORY_MB ?? 2048);
  const memory = Number.isInteger(configuredMemory) && configuredMemory >= 768 && configuredMemory <= 4096 ? `${configuredMemory}m` : "2048m";
  return ["run", "--interactive", "--name", name, "--init", "--network", "none", "--read-only", "--user", "1000:1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", memory, "--cpus", "2",
    "--tmpfs", "/tmp:rw,nosuid,size=256m,mode=1777", "--tmpfs", "/home/node:rw,nosuid,size=128m,uid=1000,gid=1000",
    "--tmpfs", "/workspace:rw,nosuid,size=768m,uid=1000,gid=1000", image];
}
// Only ordinary, bounded files are transferred across the container boundary.
export function validateWorkerTree(root: string, limit = 100 * 1024 * 1024): void {
  let size = 0, count = 0;
  const walk = (path: string, depth: number) => {
    const stat = lstatSync(path);
    if (depth > 12 || stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw new Error("REPORT_WORKER_FILE_INVALID");
    if (++count > 2000 || (size += stat.isFile() ? stat.size : 0) > limit) throw new Error("REPORT_WORKER_FILES_TOO_LARGE");
    if (stat.isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry), depth + 1);
  };
  walk(root, 0);
}
export function createPiReportHarness(options: { image: string; model: () => PiReportModel; timeoutMs?: number; fetch?: typeof fetch }): ReportHarness {
  return async ({ directory, runId, prompt, signal, previousStateDirectory, onEvent, tools = [], executeTool }) => {
    const model = options.model();
    const name = `energyiq-report-${runId}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, options.timeoutMs ?? 20 * 60_000);
    const runSignal = controller.signal;
    try {
      if (signal.aborted) throw new Error("REPORT_CANCELLED");
      writeFileSync(join(directory, "inputs", "report-review.md"), REVIEW_METHOD);
      validateWorkerTree(join(directory, "inputs"));
      const child = spawn("docker", workerArguments(name, options.image), { env: env(), windowsHide: true, signal: runSignal, stdio: ["pipe", "pipe", "pipe"] });
      child.stderr.resume();
      child.stdin.on("error", () => undefined);
      const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + "\n");
      let calls = 0, inFlight = false, receivedBytes = 0, receivedFiles = 0, toolCalls = 0, toolInFlight = false;
      const toolRequestIds = new Set<string>();
      const result = await new Promise<{ answer: string; sessionId?: string }>((resolve, reject) => {
        let finished = false;
        const fail = (error?: unknown) => { if (!finished) { finished = true; const code = error instanceof Error && /^REPORT_(?:REVIEW|ANALYSIS)_[A-Z_]+$/.test(error.message) ? error.message : "REPORT_PI_FAILED"; reject(new Error(runSignal.aborted ? "REPORT_CANCELLED" : code)); } };
        child.once("error", fail); child.once("close", fail);
        // Bound an unterminated line too; readline alone would retain it indefinitely.
        let lineBytes = 0;
        child.stdout.on("data", (chunk: Buffer) => { for (const byte of chunk) { lineBytes = byte === 10 ? 0 : lineBytes + 1; if (lineBytes > 24 * 1024 * 1024) { fail(); controller.abort(); break; } } });
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        lines.on("line", (line) => { void (async () => {
          if (finished) return;
          const message = JSON.parse(line) as Record<string, any>;
          if (message.type === "ready") {
            if (executeTool && tools.length && message.projectToolsVersion !== 1) throw new Error("REPORT_PROJECT_TOOLS_IMAGE_REQUIRED");
            if (message.reportReviewVersion !== 1) throw new Error("REPORT_REVIEW_IMAGE_REQUIRED");
            if (message.textStreamingVersion !== 1) throw new Error("REPORT_REVIEW_STREAM_IMAGE_REQUIRED");
            if (message.browserReviewVersion !== 1) throw new Error("REPORT_REVIEW_BROWSER_IMAGE_REQUIRED");
            const files = packFiles(join(directory, "inputs"), "inputs");
            if (previousStateDirectory && existsSync(previousStateDirectory)) {
              validateWorkerTree(previousStateDirectory, 32 * 1024 * 1024);
              files.push(...packFiles(previousStateDirectory, "state"));
            }
            if (model.apiProtocol === "anthropic-messages" && message.anthropicMessagesVersion !== 1) throw new Error("REPORT_MODEL_WORKER_UPGRADE_REQUIRED");
            send({ type: "config", apiProtocol: reportModelProtocol(model.apiProtocol), model: model.model, prompt, reviewMethod: REVIEW_METHOD, files, tools: executeTool ? tools : [] });
          } else if (message.type === "tool_request") {
            if (runSignal.aborted || toolInFlight || ++toolCalls > 80 || typeof message.id !== "string" || message.id.length > 200 || toolRequestIds.has(message.id)) throw new Error("REPORT_TOOL_REQUEST_INVALID");
            toolRequestIds.add(message.id);
            toolInFlight = true;
            try {
              if (!executeTool || typeof message.name !== "string" || !tools.some(tool => tool.name === message.name)) throw new Error("REPORT_TOOL_NOT_ALLOWED");
              if (JSON.stringify(message.args ?? null).length > 256_000) throw new Error("REPORT_TOOL_INPUT_TOO_LARGE");
              const value = await executeTool(message.name, message.args);
              const encoded = JSON.stringify(value ?? null);
              if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Error("REPORT_TOOL_RESULT_TOO_LARGE");
              send({ type: "tool_response", id: message.id, value });
            } catch (error) {
              const code = error instanceof Error && /^(REPORT_|ENERGYIQ_)[A-Z0-9_]+$/.test(error.message) ? error.message : "REPORT_TOOL_FAILED";
              send({ type: "tool_response", id: message.id, error: code });
            } finally { toolInFlight = false; }
          } else if (message.type === "request") {
            if (inFlight || ++calls > 180 || typeof message.id !== "string" || !message.body || typeof message.body !== "object") throw new Error("REPORT_MODEL_REQUEST_LIMIT");
            inFlight = true;
            try {
              // The worker supplies no URL, headers or secret. Redirects cannot forward the server credential.
              const request = reportModelRequest(model, message.body);
              const response = await (options.fetch ?? fetch)(request.url, {
                method: "POST", redirect: "error", signal: runSignal,
                headers: request.headers,
                body: JSON.stringify(request.body),
              });
              if (!response.ok) { await response.body?.cancel(); send({ type: "response", id: message.id, status: 502, contentType: "application/json", body: '{"error":"REPORT_MODEL_REQUEST_FAILED"}' }); }
              else {
                let size = 0; const chunks: Uint8Array[] = [];
                const parser = new ReportModelStream(reportModelProtocol(model.apiProtocol));
                const streaming = message.body.stream === true;
                if (streaming) send({ type: "response_start", id: message.id, contentType: response.headers.get("content-type") ?? "text/event-stream" });
                const reader = response.body?.getReader();
                if (reader) try {
                  while (true) { const { done, value } = await reader.read(); if (done) break;
                    size += value.length; if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error("REPORT_MODEL_RESPONSE_LIMIT"); }
                    if (streaming) { parser.push(value); send({ type: "response_chunk", id: message.id, body: Buffer.from(value).toString('base64') }); }
                    else chunks.push(value);
                  }
                } finally { reader.releaseLock(); }
                const body = Buffer.concat(chunks).toString("utf8");
                if (streaming) parser.finish();
                if (streaming) send({ type: "response_end", id: message.id });
                else send({ type: "response", id: message.id, status: 200, contentType: response.headers.get("content-type") ?? "text/event-stream", body });
              }
            } finally { inFlight = false; }
          } else if (message.type === "event") {
            if (message.event === "answer_progress" && typeof message.text === "string") onEvent?.({ type: "answer_progress", text: message.text.slice(0, 30000) });
            if (["agent_start", "agent_end", "tool_execution_start", "tool_execution_end", "review_started", "revision_started", "review_passed", "review_blocked"].includes(message.event)) onEvent?.({ type: message.event, ...(typeof message.tool === "string" ? { tool: message.tool.slice(0, 30) } : {}), ...(typeof message.isError === "boolean" ? { isError: message.isError } : {}) });
          } else if (message.type === "file") {
            if (!["outputs", "state"].includes(message.area) || typeof message.path !== "string" || typeof message.content !== "string" ||
              message.path.startsWith("/") || message.path.split("/").some((part: string) => !part || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || /[\\:\x00]/.test(message.path)) throw new Error("REPORT_WORKER_FILE_INVALID");
            const bytes = Buffer.from(message.content, "base64");
            if (++receivedFiles > 2000 || (receivedBytes += bytes.length) > 48 * 1024 * 1024) throw new Error("REPORT_WORKER_FILES_TOO_LARGE");
            const path = join(directory, message.area, message.path);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, bytes, { flag: "wx" });
          } else if (message.type === "result") {
            const reportPath = join(directory, "outputs", "report.html");
            if (existsSync(reportPath)) {
              assertSelfContainedReport(readFileSync(reportPath,"utf8"));
              validateAnalysisPackage(directory);
              const receipt = JSON.parse(readFileSync(join(directory, "outputs", "review-receipt.json"), "utf8"));
              if (receipt.status !== "pass" || receipt.reportHash !== createHash("sha256").update(readFileSync(reportPath)).digest("hex")) throw new Error("REPORT_REVIEW_BLOCKED");
            }
            if (toolInFlight) throw new Error("REPORT_TOOL_STILL_RUNNING");
            if (typeof message.answer !== "string" || typeof message.sessionId !== "string") throw new Error("REPORT_PI_RESULT_INVALID");
            finished = true;
            resolve({ answer: message.answer.slice(0, 30000), sessionId: message.sessionId });
            send({ type: "shutdown" });
          } else if (message.type === "failure") fail();
        })().catch(fail); });
      });
      return result;
    } finally {
      controller.abort();
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      await docker(["rm", "--force", name], AbortSignal.timeout(10_000)).catch(() => undefined);
    }
  };
}

function packFiles(root: string, area: string): Array<{ area: string; path: string; content: string }> {
  const files: Array<{ area: string; path: string; content: string }> = [];
  const walk = (path: string) => { for (const name of readdirSync(join(root, path))) {
    const relative = path ? path + "/" + name : name;
    if (lstatSync(join(root, relative)).isDirectory()) walk(relative);
    else files.push({ area, path: relative, content: readFileSync(join(root, relative)).toString("base64") });
  } };
  walk(""); return files;
}

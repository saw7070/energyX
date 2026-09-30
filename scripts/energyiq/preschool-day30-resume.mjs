import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { Agent as UndiciAgent } from "undici";

import {
  assertSnapshotEvidencePins,
  charlesSectionAvailability,
  detectCharlesSectionBlockers,
  releaseIdentity,
} from "./preschool-continuous-ab-acceptance.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
export const EXACT_RUN_ROOT = join(
  REPO_ROOT,
  ".scratch",
  "t39-preschool-continuous-ab-acceptance",
  "run-2026-08-09T19-15-36-500Z",
);
export const EXACT_DAY30_BATCH_ID = "energy-import-1ea4da4c-2e03-4c21-99c3-8239132e72a4";
const CONTRACT = "preschool-continuous-ab-acceptance@1";
const PROJECT_ID = "preschool-demo";
const WORKSPACE_ID = "preschool-demo-org";
const SCOPE_ID = "preschool-project";
const PORT = 8788;
const HTTP_TIMEOUT_MS = 15 * 60 * 1_000;
const WINDOWS = ["latest-complete-day", "latest-complete-7d", "current-overview-28d"];

export const assertPathInsideRoot = (rootValue, candidateValue, label = "PATH") => {
  const root = resolve(rootValue);
  const candidate = resolve(candidateValue);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error(`${label}_OUTSIDE_EXACT_RUN_ROOT:${candidate}`);
  }
  return candidate;
};

export const validateResumeReport = (report, requestedRoot = EXACT_RUN_ROOT) => {
  const root = resolve(requestedRoot);
  if (root !== resolve(EXACT_RUN_ROOT)) throw new Error(`RESUME_ROOT_MUST_MATCH_ORIGINAL:${root}`);
  if (resolve(report.root ?? "") !== root) throw new Error("REPORT_ROOT_MISMATCH");
  if (report.contract !== CONTRACT) throw new Error("REPORT_CONTRACT_MISMATCH");
  if (report.status !== "failed") throw new Error(`REPORT_NOT_FAILED:${report.status}`);
  if (report.currentPhase?.phase !== "day30-materialize") throw new Error("REPORT_PHASE_NOT_DAY30_MATERIALIZE");
  if (report.currentPhase?.batchId !== EXACT_DAY30_BATCH_ID) throw new Error("REPORT_DAY30_BATCH_MISMATCH");
  if (report.stages?.map((stage) => stage.id).join(",") !== "day1,day7") {
    throw new Error("REPORT_COMPLETED_STAGES_MISMATCH");
  }
  if (report.resumeAttempts?.length) throw new Error("DAY30_RESUME_ALREADY_RECORDED");
  if (!report.baseline?.snapshotId || !report.baseline?.savedAnalysisId || !report.baseline?.savedResponseSha256) {
    throw new Error("REPORT_SAVED_A_BASELINE_INCOMPLETE");
  }
  if (!report.baseline?.mappingHash || !report.baseline?.release) {
    throw new Error("REPORT_BASELINE_IDENTITY_INCOMPLETE");
  }
  const day30 = report.inputs?.stages?.find((stage) => stage.id === "day30" && stage.days === 30);
  if (!day30?.path || !day30?.sha256) throw new Error("REPORT_DAY30_INPUT_MISSING");
  if (!report.inputs?.generatorManifest || !report.inputs?.may?.sha256) {
    throw new Error("REPORT_INPUT_MANIFEST_INCOMPLETE");
  }
  return { root, day30 };
};

export const verifyGeneratorManifest = (report, manifest, day30FileSha) => {
  if (manifest.generatorRevision !== "preschool-june-ab-v1") {
    throw new Error("GENERATOR_REVISION_MISMATCH");
  }
  const output = manifest.outputs?.find((candidate) => candidate.stageId === "day30" && candidate.days === 30);
  if (!output) throw new Error("GENERATOR_DAY30_OUTPUT_MISSING");
  const reportDay30 = report.inputs.stages.find((candidate) => candidate.id === "day30");
  if (output.path.replaceAll("/", "\\") !== reportDay30.path.replaceAll("/", "\\")) {
    throw new Error("GENERATOR_DAY30_PATH_MISMATCH");
  }
  if (output.sha256 !== reportDay30.sha256 || output.sha256 !== day30FileSha) {
    throw new Error("GENERATOR_DAY30_SHA_MISMATCH");
  }
  return output;
};

export const verifyInspectedDay30Batch = (payload, expectedSha) => {
  const batch = payload.batches?.find((candidate) => candidate.id === EXACT_DAY30_BATCH_ID);
  if (!batch) throw new Error("DAY30_BATCH_NOT_FOUND");
  if (batch.projectId !== PROJECT_ID) throw new Error("DAY30_BATCH_PROJECT_MISMATCH");
  if (batch.sourceSha256 !== expectedSha) throw new Error("DAY30_BATCH_SHA_MISMATCH");
  if (batch.status !== "inspected") throw new Error(`DAY30_BATCH_NOT_INSPECTED:${batch.status}`);
  if (batch.materializedAt || batch.materialization) throw new Error("DAY30_BATCH_ALREADY_MATERIALIZED");
  return batch;
};

export const verifySetupIdentity = (setup, report, day30Sha) => {
  const document = setup.draft?.document;
  const manifest = document?.source_manifest;
  const expectedManifest = [report.inputs.may.sha256, day30Sha];
  if (manifest?.confirmed !== true) throw new Error("DAY30_SOURCE_MANIFEST_NOT_CONFIRMED");
  if (JSON.stringify(manifest.source_sha256) !== JSON.stringify(expectedManifest)) {
    throw new Error("DAY30_SOURCE_MANIFEST_MISMATCH");
  }
  if (sha256Json(document.meter_mapping) !== report.baseline.mappingHash) {
    throw new Error("DAY30_PREFLIGHT_MAPPING_DRIFT");
  }
};

export const verifySavedABaseline = (savedResponse, report, currentSnapshotId = null) => {
  if (sha256Text(savedResponse.text) !== report.baseline.savedResponseSha256) {
    throw new Error("SAVED_A_BYTES_CHANGED");
  }
  if (savedResponse.data.dataSnapshotId !== report.baseline.snapshotId) {
    throw new Error("SAVED_A_SNAPSHOT_CHANGED");
  }
  if (!savedResponse.text.includes(report.baseline.snapshotId)) throw new Error("SAVED_A_NO_LONGER_CONTAINS_A");
  if (currentSnapshotId && savedResponse.text.includes(currentSnapshotId)) {
    throw new Error("SAVED_A_CONTAINS_CURRENT_B");
  }
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root ?? EXACT_RUN_ROOT);
  if (root !== resolve(EXACT_RUN_ROOT)) throw new Error(`RESUME_ROOT_MUST_MATCH_ORIGINAL:${root}`);
  if (!existsSync(root)) throw new Error(`ORIGINAL_RUN_ROOT_MISSING:${root}`);
  if (await isPortListening(PORT)) throw new Error(`RESUME_PORT_ALREADY_IN_USE:${PORT}`);

  const reportPath = join(root, "acceptance-report.json");
  const sidecarPath = join(root, "day30-resume-report.json");
  if (existsSync(sidecarPath)) throw new Error(`DAY30_RESUME_SIDECAR_ALREADY_EXISTS:${sidecarPath}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const { day30 } = validateResumeReport(report, root);
  const runPaths = resolveRunPaths(root);
  for (const [label, path] of Object.entries(runPaths)) assertPathInsideRoot(root, path, label.toUpperCase());
  for (const required of [reportPath, runPaths.metadataDb, runPaths.duckDb]) {
    if (!existsSync(required)) throw new Error(`ORIGINAL_RUN_FILE_MISSING:${required}`);
  }

  const manifestPath = resolve(REPO_ROOT, report.inputs.generatorManifest);
  const day30Path = resolve(REPO_ROOT, day30.path);
  if (!existsSync(manifestPath)) throw new Error(`GENERATOR_MANIFEST_MISSING:${manifestPath}`);
  if (!existsSync(day30Path)) throw new Error(`DAY30_SOURCE_MISSING:${day30Path}`);
  const generatorManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const day30FileSha = sha256File(day30Path);
  verifyGeneratorManifest(report, generatorManifest, day30FileSha);

  const attemptStartedAt = performance.now();
  const attempt = {
    contract: "preschool-day30-targeted-resume@1",
    status: "running",
    startedAt: new Date().toISOString(),
    originalRunRoot: root,
    originalReportPath: reportPath,
    batchId: EXACT_DAY30_BATCH_ID,
    day30File: { path: day30Path, sha256: day30FileSha },
    httpEvents: [],
    phases: [],
    git: readGitState(),
  };
  writeJson(sidecarPath, attempt);
  const setPhase = (phase, detail = {}) => {
    attempt.currentPhase = { phase, at: new Date().toISOString(), ...detail };
    attempt.phases.push(attempt.currentPhase);
    writeJson(sidecarPath, attempt);
    process.stdout.write(`${JSON.stringify({ phase, ...detail })}\n`);
  };

  const envFile = resolveEnvFile(options.envFile);
  const childEnv = buildIsolatedEnvironment({ root, port: PORT, envFile, paths: runPaths });
  const logFd = openSync(runPaths.log, "a");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(REPO_ROOT, "apps", "api", "src", "index.ts")],
    { cwd: REPO_ROOT, env: childEnv, stdio: ["ignore", logFd, logFd], windowsHide: true },
  );
  attempt.api = { pid: child.pid, port: PORT, logPath: runPaths.log, envFile: envFile ? basename(envFile) : null };
  writeJson(sidecarPath, attempt);

  const client = createApiClient(`http://127.0.0.1:${PORT}`, (event) => {
    attempt.httpEvents.push(event);
    writeJson(sidecarPath, attempt);
  });
  let materializePostCount = 0;
  try {
    setPhase("api-ready-wait");
    await waitForReady(`http://127.0.0.1:${PORT}`, child, PORT, 120_000);
    attempt.api.readyAt = new Date().toISOString();

    setPhase("formal-preflight-imports");
    const imports = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/imports`);
    verifyInspectedDay30Batch(imports.data, day30FileSha);
    const previousSnapshotId = report.stages.at(-1).snapshotId;
    if (imports.data.dataSnapshot?.id !== previousSnapshotId) {
      throw new Error(`CURRENT_SNAPSHOT_NOT_DAY7:${imports.data.dataSnapshot?.id}:${previousSnapshotId}`);
    }

    setPhase("formal-preflight-setup");
    const setupBefore = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`);
    verifySetupIdentity(setupBefore.data, report, day30FileSha);

    setPhase("formal-preflight-saved-a");
    const savedBefore = await client.getRaw(
      `/api/v1/energy/projects/${PROJECT_ID}/saved-analyses/${report.baseline.savedAnalysisId}`,
    );
    verifySavedABaseline(savedBefore, report, previousSnapshotId);

    setPhase("day30-materialize", { batchId: EXACT_DAY30_BATCH_ID, timeoutMs: HTTP_TIMEOUT_MS });
    if (materializePostCount !== 0) throw new Error("DAY30_MATERIALIZE_POST_ALREADY_ATTEMPTED");
    materializePostCount += 1;
    const materializedResponse = await client.post(
      `/api/v1/energy/projects/${PROJECT_ID}/imports/${EXACT_DAY30_BATCH_ID}/materialize`,
      {},
    );
    const materialized = materializedResponse.data;
    const snapshotId = materialized.dataSnapshot?.id;
    if (!snapshotId) throw new Error("DAY30_SNAPSHOT_REQUIRED");
    if (snapshotId === previousSnapshotId) throw new Error("DAY30_SNAPSHOT_DID_NOT_ADVANCE");
    if (materialized.readiness?.ready !== true) throw new Error("DAY30_READINESS_REQUIRED");

    setPhase("day30-windows-resolve", { snapshotId });
    const windows = await resolveWindows(client);
    const currentSnapshot = windows["current-overview-28d"];
    if (currentSnapshot.dataSnapshot.id !== snapshotId) throw new Error("DAY30_CURRENT_SNAPSHOT_NOT_ACTIVE");
    const evidenceIds = assertSnapshotEvidencePins(currentSnapshot, snapshotId);
    const currentRelease = releaseIdentity(currentSnapshot);
    assertJsonEqual(currentRelease, report.baseline.release, "DAY30_PROJECT_RELEASE_DRIFT");

    setPhase("day30-postflight-identity", { snapshotId });
    const setupAfter = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`);
    verifySetupIdentity(setupAfter.data, report, day30FileSha);
    const savedAfter = await client.getRaw(
      `/api/v1/energy/projects/${PROJECT_ID}/saved-analyses/${report.baseline.savedAnalysisId}`,
    );
    verifySavedABaseline(savedAfter, report, snapshotId);

    const productAvailability = charlesSectionAvailability(currentSnapshot);
    const productBlockers = detectCharlesSectionBlockers("day30", productAvailability);
    const materializeEvent = [...attempt.httpEvents].reverse().find((event) => (
      event.method === "POST" && event.path.endsWith(`/${EXACT_DAY30_BATCH_ID}/materialize`)
    ));
    const stageRecord = {
      id: "day30",
      days: 30,
      batchId: EXACT_DAY30_BATCH_ID,
      snapshotId,
      previousSnapshotId,
      sourceManifest: [report.inputs.may.sha256, day30FileSha],
      materialization: materialized.batch.materialization,
      materializationTimings: materialized.materializationTimings ?? null,
      materializationHttpDurationMs: materializeEvent?.durationMs ?? null,
      audit: materialized.dataSnapshot.audit,
      release: currentRelease,
      evidenceIds,
      savedA: {
        id: report.baseline.savedAnalysisId,
        snapshotId: report.baseline.snapshotId,
        responseSha256: report.baseline.savedResponseSha256,
        byteStable: true,
      },
      artifact: { status: "not-checked", reason: "DAY30_RESUME_DATA_CHAIN_ONLY" },
      productAvailability,
      productBlockers,
      windows: Object.fromEntries(Object.entries(windows).map(([key, value]) => [key, compactSnapshot(value)])),
      durationMs: Math.round(performance.now() - attemptStartedAt),
    };

    attempt.status = "passed";
    attempt.completedAt = new Date().toISOString();
    attempt.currentPhase = { phase: "complete", at: attempt.completedAt, snapshotId };
    attempt.snapshotId = snapshotId;
    attempt.materializationTimings = stageRecord.materializationTimings;
    attempt.materializationHttpDurationMs = stageRecord.materializationHttpDurationMs;
    writeJson(sidecarPath, attempt);

    const priorFailure = {
      failedAt: report.failedAt,
      currentPhase: report.currentPhase,
      error: report.error,
    };
    report.resumeAttempts = [{
      contract: attempt.contract,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      batchId: EXACT_DAY30_BATCH_ID,
      snapshotId,
      materializationHttpDurationMs: stageRecord.materializationHttpDurationMs,
      materializationTimings: stageRecord.materializationTimings,
      reportPath: sidecarPath,
    }];
    report.priorFailure = priorFailure;
    report.stages.push(stageRecord);
    report.httpEvents.push(...attempt.httpEvents);
    report.invariants = {
      savedABytesStable: true,
      currentSnapshotsAdvanced: true,
      releaseIdentityStable: true,
      meterMappingStable: true,
      evidencePinnedToCurrentSnapshot: true,
      pureDataBRepublishedConfiguration: false,
    };
    report.productBlockers = report.stages.flatMap((stage) => stage.productBlockers ?? []);
    report.status = report.productBlockers.length > 0 ? "product-chain-incomplete" : "passed-with-ai-identity-blocker";
    report.currentPhase = { phase: "complete-after-day30-resume", at: attempt.completedAt, snapshotId };
    report.completedAt = attempt.completedAt;
    delete report.failedAt;
    delete report.error;
    writeJson(reportPath, report);
    process.stdout.write(`${JSON.stringify({ status: report.status, snapshotId, reportPath, sidecarPath }, null, 2)}\n`);
  } catch (error) {
    attempt.status = "failed";
    attempt.failedAt = new Date().toISOString();
    attempt.error = serializeError(error);
    attempt.materializePostCount = materializePostCount;
    writeJson(sidecarPath, attempt);

    const freshReport = JSON.parse(readFileSync(reportPath, "utf8"));
    freshReport.resumeAttempts = [{
      contract: attempt.contract,
      status: "failed",
      startedAt: attempt.startedAt,
      failedAt: attempt.failedAt,
      batchId: EXACT_DAY30_BATCH_ID,
      phase: attempt.currentPhase,
      materializePostCount,
      error: attempt.error,
      reportPath: sidecarPath,
    }];
    freshReport.currentPhase = { phase: "day30-resume-failed", at: attempt.failedAt, detail: attempt.currentPhase };
    freshReport.failedAt = attempt.failedAt;
    freshReport.error = attempt.error;
    writeJson(reportPath, freshReport);
    throw error;
  } finally {
    await client.close();
    await terminateOwnedChild(child);
    closeSync(logFd);
  }
}

function resolveRunPaths(root) {
  return {
    storage: join(root, "storage"),
    metadataDb: join(root, "metadata.sqlite"),
    files: join(root, "files"),
    duckDb: join(root, "energy.duckdb"),
    mastra: join(root, "mastra", "agent-state.sqlite"),
    workspaces: join(root, "workspaces"),
    log: join(root, "api-day30-resume.log"),
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") options.root = requireArgValue(args, ++index, arg);
    else if (arg === "--env-file") options.envFile = requireArgValue(args, ++index, arg);
    else throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
  }
  return options;
}

function requireArgValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`ARGUMENT_VALUE_REQUIRED:${flag}`);
  return value;
}

function resolveEnvFile(requested) {
  if (requested) {
    const path = resolve(requested);
    if (!existsSync(path)) throw new Error(`ENV_FILE_NOT_FOUND:${path}`);
    return path;
  }
  const integrationEnv = join(REPO_ROOT, ".env");
  if (existsSync(integrationEnv)) return integrationEnv;
  const sibling = resolve(REPO_ROOT, "..", "energyiq-datafoundry", ".env");
  return existsSync(sibling) ? sibling : null;
}

function buildIsolatedEnvironment({ root, port, envFile, paths }) {
  const fileEnv = envFile ? parseDotenv(readFileSync(envFile)) : {};
  return {
    ...process.env,
    ...fileEnv,
    NODE_ENV: "development",
    DATAFOUNDRY_AUTH_MODE: "dev",
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
    STORAGE_ROOT_DIR: paths.storage,
    METADATA_DB_PATH: paths.metadataDb,
    FILE_ASSET_STORAGE_ROOT: paths.files,
    ENERGYIQ_DUCKDB_PATH: paths.duckDb,
    MASTRA_STORAGE_PATH: paths.mastra,
    WORKSPACE_ROOT: paths.workspaces,
  };
}

function createApiClient(baseUrl, recordEvent) {
  const dispatcher = new UndiciAgent({
    headersTimeout: HTTP_TIMEOUT_MS,
    bodyTimeout: HTTP_TIMEOUT_MS,
    connectTimeout: 30_000,
  });
  const headers = { Authorization: "Bearer dev-token", "X-Workspace-Id": WORKSPACE_ID };
  const request = async (path, options = {}) => {
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const method = options.method ?? "GET";
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { ...headers, ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        dispatcher,
      });
      const text = await response.text();
      let envelope;
      try { envelope = JSON.parse(text); } catch { throw new Error(`HTTP_JSON_INVALID:${response.status}:${path}`); }
      if (!response.ok || envelope.success !== true) {
        throw new Error(`HTTP_REQUEST_FAILED:${response.status}:${path}:${envelope.error?.message ?? envelope.error?.code ?? text.slice(0, 200)}`);
      }
      recordEvent({
        method,
        path,
        startedAt: startedAtIso,
        endedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startedAt),
        status: response.status,
      });
      return { data: envelope.data, text };
    } catch (error) {
      recordEvent({
        method,
        path,
        startedAt: startedAtIso,
        endedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startedAt),
        status: "transport-error",
        error: serializeError(error),
      });
      throw error;
    }
  };
  return {
    get: (path) => request(path),
    getRaw: (path) => request(path),
    post: (path, body) => request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    close: () => dispatcher.close(),
  };
}

async function resolveWindows(client) {
  const entries = [];
  for (const analysisWindow of WINDOWS) {
    const response = await client.post("/api/v1/energy/analysis/resolve", {
      projectId: PROJECT_ID,
      scopeId: SCOPE_ID,
      resource: "electricity",
      analysisWindow,
      bypassCache: true,
    });
    if (response.data.status !== "ready") throw new Error(`ANALYSIS_NOT_READY:${analysisWindow}`);
    entries.push([analysisWindow, response.data.snapshot]);
  }
  return Object.fromEntries(entries);
}

function compactSnapshot(snapshot) {
  const productAvailability = charlesSectionAvailability(snapshot);
  return {
    context: {
      from: snapshot.context.from,
      to: snapshot.context.to,
      primaryPeriod: snapshot.context.primaryPeriod,
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.context.projectReleaseId,
      timezone: snapshot.context.timezone,
    },
    dataSnapshotId: snapshot.dataSnapshot.id,
    usageKwh: snapshot.analysis.summary.usageKwh,
    averageDailyUsageKwh: snapshot.analysis.summary.averageDailyUsageKwh,
    coveragePct: snapshot.dataQuality.coveragePct,
    validIntervalCount: snapshot.analysis.summary.validIntervalCount,
    centreCount: snapshot.analysis.childScopes.length,
    circuitCount: snapshot.analysis.circuits.length,
    standbyKwh: snapshot.analysis.offHours.status === "available" ? snapshot.analysis.offHours.standbyKwh : null,
    standbySharePct: snapshot.analysis.offHours.status === "available" ? snapshot.analysis.offHours.sharePct : null,
    cost: snapshot.analysis.cost.status === "available" ? snapshot.analysis.cost.amount : null,
    ...productAvailability,
  };
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function isPortListening(port) {
  return new Promise((done) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("timeout", () => { socket.destroy(); done(false); });
    socket.once("error", () => done(false));
  });
}

async function waitForReady(baseUrl, child, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`ISOLATED_API_EXITED:${child.exitCode}`);
    let ready = false;
    try {
      const [health, readiness] = await Promise.all([
        fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2_000) }),
        fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(2_000) }),
      ]);
      ready = health.ok && readiness.ok;
    } catch {
      ready = false;
    }
    if (ready) {
      const ownerPid = readPortOwnerPid(port);
      if (ownerPid !== null && ownerPid !== child.pid) {
        throw new Error(`ISOLATED_API_PORT_OWNER_MISMATCH:${ownerPid}:${child.pid}`);
      }
      return;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("ISOLATED_API_READY_TIMEOUT");
}

function readPortOwnerPid(port) {
  if (process.platform !== "win32") return null;
  const output = execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess`,
  ], { encoding: "utf8", windowsHide: true }).trim();
  const ownerPid = Number.parseInt(output, 10);
  if (!Number.isInteger(ownerPid)) throw new Error(`ISOLATED_API_PORT_OWNER_UNKNOWN:${port}`);
  return ownerPid;
}

async function terminateOwnedChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((done) => child.once("exit", done)),
    new Promise((done) => setTimeout(done, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function readGitState() {
  const run = (args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trimEnd();
  const status = run(["status", "--porcelain=v1"]);
  return {
    sha: run(["rev-parse", "HEAD"]),
    branch: run(["branch", "--show-current"]),
    dirty: Boolean(status),
    changedPaths: status ? status.split(/\r?\n/).map((line) => line.slice(3)) : [],
  };
}

function serializeError(error) {
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

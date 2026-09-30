import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { Agent as UndiciAgent } from "undici";

import { buildPreschoolDemoSnapshotPublicationPlan } from "./preschool-june-ab-generator.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const ACCEPTANCE_PARENT = join(REPO_ROOT, ".scratch", "t39-preschool-continuous-ab-acceptance");
const PROJECT_ID = "preschool-demo";
const WORKSPACE_ID = "preschool-demo-org";
const SCOPE_ID = "preschool-project";
const DEFAULT_PORT = 8788;
const HTTP_TIMEOUT_MS = 15 * 60 * 1_000;
const MAY_GOLDEN = Object.freeze({
  usageKwh: 24_921.8123,
  centreCount: 30,
  circuitCount: 270,
  coveragePct: 100,
});
const WINDOWS = Object.freeze([
  "latest-complete-day",
  "latest-complete-7d",
  "current-overview-28d",
]);

export const replaceSourceManifest = (document, sourceSha256) => ({
  ...structuredClone(document),
  source_manifest: {
    id: "energy-source-manifest-v1",
    source_sha256: [...sourceSha256],
    confirmed: true,
  },
});

export const releaseIdentity = (snapshot) => ({
  id: snapshot.projectRelease.id,
  templateRevisionId: snapshot.projectRelease.templateRevisionId,
  renderer: snapshot.projectRelease.renderer,
  recipe: snapshot.projectRelease.recipe,
  hierarchyRevisionId: snapshot.projectRelease.hierarchyRevisionId,
  meterMappingRevisionId: snapshot.projectRelease.meterMappingRevisionId,
  meterFormulaRevisionId: snapshot.projectRelease.meterFormulaRevisionId,
  metricRevisionIds: snapshot.projectRelease.metricRevisionIds,
  ruleRevisionIds: snapshot.projectRelease.ruleRevisionIds,
  businessCalendarVersion: snapshot.projectRelease.businessCalendarVersion,
  tariffScheduleVersion: snapshot.projectRelease.tariffScheduleVersion,
});

export const assertSnapshotEvidencePins = (snapshot, expectedSnapshotId) => {
  assert(snapshot.dataSnapshot?.id === expectedSnapshotId, "CURRENT_SNAPSHOT_ID_MISMATCH");
  assert(snapshot.context?.dataSnapshotId === expectedSnapshotId, "CURRENT_CONTEXT_SNAPSHOT_ID_MISMATCH");
  const evidenceIds = collectEvidenceIds(snapshot);
  assert(evidenceIds.length > 0, "CURRENT_EVIDENCE_REQUIRED");
  for (const evidenceId of evidenceIds) {
    assert(
      evidenceId.includes(`evidence:${expectedSnapshotId}:`),
      `CURRENT_EVIDENCE_SNAPSHOT_MISMATCH:${evidenceId}`,
    );
  }
  return evidenceIds;
};

export const validateAcceptanceRoot = (requestedRoot) => {
  const parent = resolve(ACCEPTANCE_PARENT);
  const root = resolve(requestedRoot);
  const rel = relative(parent, root);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error(`ACCEPTANCE_ROOT_OUTSIDE_ALLOWED_PARENT:${root}`);
  }
  return root;
};

export const makeStageManifestSha = (maySha, stageSha) => [maySha, stageSha];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = options.port ?? DEFAULT_PORT;
  if (port !== DEFAULT_PORT) throw new Error(`ACCEPTANCE_PORT_MUST_BE_${DEFAULT_PORT}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = validateAcceptanceRoot(options.root ?? join(ACCEPTANCE_PARENT, `run-${stamp}`));
  if (existsSync(root)) throw new Error(`ACCEPTANCE_ROOT_ALREADY_EXISTS:${root}`);
  if (await isPortListening(port)) throw new Error(`ACCEPTANCE_PORT_ALREADY_IN_USE:${port}`);

  mkdirSync(ACCEPTANCE_PARENT, { recursive: true });
  mkdirSync(root);
  const storageRoot = join(root, "storage");
  const reportPath = join(root, "acceptance-report.json");
  const logPath = join(root, "api.log");
  const report = {
    contract: "preschool-continuous-ab-acceptance@1",
    status: "running",
    startedAt: new Date().toISOString(),
    root,
    port,
    git: readGitState(),
    inputs: {},
    stages: [],
    httpEvents: [],
    invariants: {},
    aiArtifact: { status: "not-checked" },
  };
  writeReport(reportPath, report);

  const manifestPath = join(REPO_ROOT, "outputs", "t39-preschool-continuous-ab-20260810", "manifest.json");
  const generatorManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mayPath = join(REPO_ROOT, ".scratch", "Preschool_Database_30centres_May2026.normalized-cumulative.xlsx");
  assert(existsSync(mayPath), `MAY_SOURCE_MISSING:${mayPath}`);
  const maySha = sha256File(mayPath);
  assert(maySha === generatorManifest.inputs?.mayCumulative?.sha256, "MAY_SOURCE_SHA_MISMATCH");
  const stageInputs = generatorManifest.outputs.map((stage) => {
    const path = join(REPO_ROOT, stage.path);
    assert(existsSync(path), `STAGE_SOURCE_MISSING:${path}`);
    assert(sha256File(path) === stage.sha256, `STAGE_SOURCE_SHA_MISMATCH:${stage.stageId}`);
    return { id: stage.stageId, days: stage.days, path, sha256: stage.sha256 };
  });
  assert(stageInputs.map((stage) => stage.days).join(",") === "1,7,30", "STAGE_ORDER_INVALID");
  const canonicalPublication = buildPreschoolDemoSnapshotPublicationPlan({
    maySource: {
      id: "may-complete",
      sha256: maySha,
      coverageFrom: "2026-05-01",
      coverageToExclusive: "2026-06-01",
    },
    juneStageSources: stageInputs.map((stage) => ({
      id: stage.id,
      days: stage.days,
      sha256: stage.sha256,
    })),
  });
  report.inputs = {
    generatorManifest: relative(REPO_ROOT, manifestPath),
    may: { path: relative(REPO_ROOT, mayPath), sha256: maySha },
    canonicalPublication,
    stages: stageInputs.map((stage) => ({
      id: stage.id,
      days: stage.days,
      path: relative(REPO_ROOT, stage.path),
      sha256: stage.sha256,
    })),
  };
  writeReport(reportPath, report);

  const envFile = resolveEnvFile(options.envFile);
  const childEnv = buildIsolatedEnvironment({ root, storageRoot, port, envFile });
  const logFd = openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(REPO_ROOT, "apps", "api", "src", "index.ts")],
    { cwd: REPO_ROOT, env: childEnv, stdio: ["ignore", logFd, logFd], windowsHide: true },
  );
  report.api = { pid: child.pid, logPath, envFile: envFile ? basename(envFile) : null };
  writeReport(reportPath, report);

  const baseUrl = `http://127.0.0.1:${port}`;
  const setPhase = (phase, detail = {}) => {
    report.currentPhase = { phase, at: new Date().toISOString(), ...detail };
    writeReport(reportPath, report);
  };
  const client = createApiClient(baseUrl, (event) => {
    report.httpEvents.push(event);
    writeReport(reportPath, report);
  });
  try {
    setPhase("api-ready-wait");
    await waitForReady(baseUrl, child, port, 120_000);
    report.api.readyAt = new Date().toISOString();
    writeReport(reportPath, report);

    setPhase("baseline-setup-read");
    const setupInitial = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`);
    const initialMappingHash = sha256Json(setupInitial.data.draft.document.meter_mapping);

    setPhase("baseline-may-register");
    const mayBatch = await uploadExcel(client, mayPath);
    assert(mayBatch.sourceSha256 === maySha, "MAY_REGISTER_SHA_MISMATCH");
    setPhase("baseline-manifest-save", { batchId: mayBatch.id });
    await saveSourceManifest(client, [maySha]);

    setPhase("baseline-operational-policy-publish");
    await publishBaselineOperationalPolicies(client);
    setPhase("baseline-may-materialize", { batchId: mayBatch.id });
    const mayMaterialized = await materialize(client, mayBatch.id);
    assert(mayMaterialized.dataSnapshot?.id, "MAY_SNAPSHOT_REQUIRED");
    assert(mayMaterialized.readiness?.ready === true, "MAY_READINESS_REQUIRED");

    setPhase("baseline-project-publish", { snapshotId: mayMaterialized.dataSnapshot.id });
    await publishInitialProjectConfiguration(client);
    setPhase("baseline-full-may-resolve");
    const fullMay = await resolveAnalysis(client, {
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
    });
    assertClose(fullMay.analysis.summary.usageKwh, MAY_GOLDEN.usageKwh, 0.0001, "MAY_USAGE_GOLDEN_MISMATCH");
    assert(fullMay.analysis.childScopes.length === MAY_GOLDEN.centreCount, "MAY_CENTRE_COUNT_MISMATCH");
    assert(fullMay.analysis.circuits.length === MAY_GOLDEN.circuitCount, "MAY_CIRCUIT_COUNT_MISMATCH");
    assertClose(fullMay.dataQuality.coveragePct, MAY_GOLDEN.coveragePct, 0.0001, "MAY_COVERAGE_MISMATCH");

    setPhase("baseline-windows-resolve");
    const aWindows = await resolveWindows(client);
    const snapshotAId = aWindows["current-overview-28d"].dataSnapshot.id;
    const releaseA = releaseIdentity(aWindows["current-overview-28d"]);
    const evidenceA = assertSnapshotEvidencePins(aWindows["current-overview-28d"], snapshotAId);
    setPhase("baseline-save-a", { snapshotId: snapshotAId });
    const saveA = await client.post(`/api/v1/energy/projects/${PROJECT_ID}/saved-analyses`, {
      projectId: PROJECT_ID,
      scopeId: SCOPE_ID,
      resource: "electricity",
      analysisWindow: "current-overview-28d",
      title: "Preschool Snapshot A · May baseline",
    });
    const savedAId = saveA.data.id;
    assert(savedAId, "SAVED_A_ID_REQUIRED");
    const savedBaseline = await client.getRaw(`/api/v1/energy/projects/${PROJECT_ID}/saved-analyses/${savedAId}`);
    const savedBaselineHash = sha256Text(savedBaseline.text);
    assert(savedBaseline.data.dataSnapshotId === snapshotAId, "SAVED_A_SNAPSHOT_MISMATCH");

    const setupAfterA = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`);
    assert(sha256Json(setupAfterA.data.draft.document.meter_mapping) === initialMappingHash, "A_MAPPING_DRIFT");

    report.baseline = {
      snapshotId: snapshotAId,
      release: releaseA,
      mappingHash: initialMappingHash,
      savedAnalysisId: savedAId,
      savedResponseSha256: savedBaselineHash,
      evidenceIds: evidenceA,
      fullMay: compactSnapshot(fullMay),
      windows: Object.fromEntries(Object.entries(aWindows).map(([key, value]) => [key, compactSnapshot(value)])),
    };
    writeReport(reportPath, report);

    let previousSnapshotId = snapshotAId;
    for (const stageInput of stageInputs) {
      const stageStartedAt = performance.now();
      setPhase(`${stageInput.id}-register`);
      const batch = await uploadExcel(client, stageInput.path);
      assert(batch.sourceSha256 === stageInput.sha256, `REGISTER_SHA_MISMATCH:${stageInput.id}`);
      setPhase(`${stageInput.id}-manifest-save`, { batchId: batch.id });
      const stageSourceManifest = stageInput.days === 30
        ? canonicalPublication.sourceManifestSha256
        : makeStageManifestSha(maySha, stageInput.sha256);
      await saveSourceManifest(client, stageSourceManifest);
      setPhase(`${stageInput.id}-materialize`, { batchId: batch.id });
      const materialized = await materialize(client, batch.id);
      const snapshotId = materialized.dataSnapshot?.id;
      assert(snapshotId, `SNAPSHOT_REQUIRED:${stageInput.id}`);
      assert(snapshotId !== previousSnapshotId, `SNAPSHOT_DID_NOT_ADVANCE:${stageInput.id}`);
      assert(materialized.readiness?.ready === true, `READINESS_REQUIRED:${stageInput.id}`);

      setPhase(`${stageInput.id}-windows-resolve`, { snapshotId });
      const windows = await resolveWindows(client);
      const currentSnapshot = windows["current-overview-28d"];
      assert(currentSnapshot.dataSnapshot.id === snapshotId, `CURRENT_SNAPSHOT_NOT_ACTIVE:${stageInput.id}`);
      const evidenceIds = assertSnapshotEvidencePins(currentSnapshot, snapshotId);
      const currentRelease = releaseIdentity(currentSnapshot);
      assertJsonEqual(currentRelease, releaseA, `PROJECT_RELEASE_DRIFT:${stageInput.id}`);

      const setup = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`);
      assert(sha256Json(setup.data.draft.document.meter_mapping) === initialMappingHash, `MAPPING_DRIFT:${stageInput.id}`);

      const savedAfter = await client.getRaw(`/api/v1/energy/projects/${PROJECT_ID}/saved-analyses/${savedAId}`);
      assert(sha256Text(savedAfter.text) === savedBaselineHash, `SAVED_A_BYTES_CHANGED:${stageInput.id}`);
      assert(savedAfter.data.dataSnapshotId === snapshotAId, `SAVED_A_SNAPSHOT_CHANGED:${stageInput.id}`);
      assert(savedAfter.text.includes(snapshotAId), `SAVED_A_NO_LONGER_CONTAINS_A:${stageInput.id}`);
      assert(!savedAfter.text.includes(snapshotId), `SAVED_A_CONTAINS_CURRENT_B:${stageInput.id}`);

      setPhase(`${stageInput.id}-saved-a-artifact-check`, { snapshotId });
      const artifact = await readArtifactIdentity(client, snapshotId, currentRelease.id);
      const productAvailability = charlesSectionAvailability(currentSnapshot);
      const productBlockers = detectCharlesSectionBlockers(stageInput.id, productAvailability);
      const stageRecord = {
        id: stageInput.id,
        days: stageInput.days,
        batchId: batch.id,
        snapshotId,
        previousSnapshotId,
        sourceManifest: [...stageSourceManifest],
        materialization: materialized.batch.materialization,
        audit: materialized.dataSnapshot.audit,
        release: currentRelease,
        evidenceIds,
        savedA: { id: savedAId, snapshotId: snapshotAId, responseSha256: savedBaselineHash, byteStable: true },
        artifact,
        productAvailability,
        productBlockers,
        windows: Object.fromEntries(Object.entries(windows).map(([key, value]) => [key, compactSnapshot(value)])),
        durationMs: Math.round(performance.now() - stageStartedAt),
      };
      report.stages.push(stageRecord);
      writeReport(reportPath, report);
      previousSnapshotId = snapshotId;
    }

    report.invariants = {
      savedABytesStable: true,
      currentSnapshotsAdvanced: true,
      releaseIdentityStable: true,
      meterMappingStable: true,
      evidencePinnedToCurrentSnapshot: true,
      pureDataBRepublishedConfiguration: false,
    };
    report.productBlockers = report.stages.flatMap((stage) => stage.productBlockers);
    const artifacts = report.stages.map((stage) => stage.artifact);
    report.aiArtifact = artifacts.every((artifact) => artifact.status === "verified")
      ? { status: "verified", stages: artifacts }
      : { status: "blocked", stages: artifacts };
    report.status = report.productBlockers.length > 0
      ? "product-chain-incomplete"
      : report.aiArtifact.status === "verified"
        ? "passed"
        : "passed-with-ai-identity-blocker";
    report.currentPhase = { phase: "complete", at: new Date().toISOString() };
    report.completedAt = new Date().toISOString();
    writeReport(reportPath, report);
    process.stdout.write(`${JSON.stringify({ status: report.status, reportPath, root }, null, 2)}\n`);
  } catch (error) {
    report.status = "failed";
    report.failedAt = new Date().toISOString();
    report.error = serializeError(error);
    writeReport(reportPath, report);
    throw error;
  } finally {
    await client.close();
    await terminateOwnedChild(child);
    closeSync(logFd);
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") options.root = requireArgValue(args, ++index, arg);
    else if (arg === "--port") options.port = Number.parseInt(requireArgValue(args, ++index, arg), 10);
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
    assert(existsSync(path), `ENV_FILE_NOT_FOUND:${path}`);
    return path;
  }
  const integrationEnv = join(REPO_ROOT, ".env");
  if (existsSync(integrationEnv)) return integrationEnv;
  const authorisedSibling = resolve(REPO_ROOT, "..", "energyiq-datafoundry", ".env");
  return existsSync(authorisedSibling) ? authorisedSibling : null;
}

function buildIsolatedEnvironment({ root, storageRoot, port, envFile }) {
  const fileEnv = envFile ? parseDotenv(readFileSync(envFile)) : {};
  return {
    ...process.env,
    ...fileEnv,
    NODE_ENV: "development",
    DATAFOUNDRY_AUTH_MODE: "dev",
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
    STORAGE_ROOT_DIR: storageRoot,
    METADATA_DB_PATH: join(root, "metadata.sqlite"),
    FILE_ASSET_STORAGE_ROOT: join(root, "files"),
    ENERGYIQ_DUCKDB_PATH: join(root, "energy.duckdb"),
    MASTRA_STORAGE_PATH: join(root, "mastra", "agent-state.sqlite"),
    WORKSPACE_ROOT: join(root, "workspaces"),
  };
}

function createApiClient(baseUrl, recordEvent = () => undefined) {
  const headers = {
    Authorization: "Bearer dev-token",
    "X-Workspace-Id": WORKSPACE_ID,
  };
  const dispatcher = new UndiciAgent({
    headersTimeout: HTTP_TIMEOUT_MS,
    bodyTimeout: HTTP_TIMEOUT_MS,
    connectTimeout: 30_000,
  });
  const request = async (path, options = {}) => {
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const method = options.method ?? "GET";
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { ...headers, ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(options.timeoutMs ?? HTTP_TIMEOUT_MS),
        dispatcher,
      });
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
    const text = await response.text();
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new Error(`HTTP_JSON_INVALID:${response.status}:${path}:${text.slice(0, 300)}`);
    }
    if (!response.ok || envelope.success !== true) {
      const detail = envelope.error?.message ?? envelope.error?.code ?? text.slice(0, 300);
      throw new Error(`HTTP_REQUEST_FAILED:${response.status}:${path}:${detail}`);
    }
    const durationMs = Math.round(performance.now() - startedAt);
    recordEvent({
      method,
      path,
      startedAt: startedAtIso,
      endedAt: new Date().toISOString(),
      durationMs,
      status: response.status,
    });
    return { data: envelope.data, text, durationMs };
  };
  return {
    get: async (path) => request(path),
    getRaw: async (path) => request(path),
    post: async (path, body) => request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    put: async (path, body) => request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    upload: async (path, form) => request(path, { method: "POST", body: form }),
    close: async () => dispatcher.close(),
  };
}

async function uploadExcel(client, path) {
  const form = new FormData();
  form.set(
    "file",
    new Blob([readFileSync(path)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    basename(path),
  );
  const response = await client.upload(`/api/v1/energy/projects/${PROJECT_ID}/imports/excel`, form);
  return response.data.batch;
}

async function saveSourceManifest(client, sourceSha256) {
  const setup = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`);
  const originalDocument = setup.data.draft.document;
  const originalMappingHash = sha256Json(originalDocument.meter_mapping);
  const saved = await client.put(`/api/v1/energy/projects/${PROJECT_ID}/setup/draft`, {
    expectedRevision: setup.data.draft.revision,
    document: replaceSourceManifest(originalDocument, sourceSha256),
  });
  assert(sha256Json(saved.data.draft.document.meter_mapping) === originalMappingHash, "SOURCE_MANIFEST_CHANGED_MAPPING");
  return saved.data.draft;
}

async function materialize(client, batchId) {
  return (await client.post(`/api/v1/energy/projects/${PROJECT_ID}/imports/${encodeURIComponent(batchId)}/materialize`, {})).data;
}

async function publishBaselineOperationalPolicies(client) {
  await client.post(`/api/v1/energy/projects/${PROJECT_ID}/operational-policies/tariff`, {
    entries: [{
      owner: { kind: "project" },
      effectiveFrom: "2026-03-31T16:00:00.000Z",
      currency: "SGD",
      ratePerKwh: 0.2727,
    }],
  });
  const weekday = [{ from: "07:00", to: "19:00" }];
  await client.post(`/api/v1/energy/projects/${PROJECT_ID}/operational-policies/calendar`, {
    entries: [{
      owner: { kind: "project" },
      effectiveFrom: "2026-05-01",
      weekly: {
        monday: weekday,
        tuesday: weekday,
        wednesday: weekday,
        thursday: weekday,
        friday: weekday,
        saturday: [],
        sunday: [],
      },
      exceptions: [
        { date: "2026-05-01", operating: [], label: "Labour Day closure" },
        { date: "2026-05-27", operating: [], label: "Published closure" },
      ],
    }],
  });
}

async function publishInitialProjectConfiguration(client) {
  const [setup, template, metrics, rules] = await Promise.all([
    client.get(`/api/v1/energy/projects/${PROJECT_ID}/setup`),
    client.get(`/api/v1/energy/projects/${PROJECT_ID}/template-draft`),
    client.get(`/api/v1/energy/projects/${PROJECT_ID}/metric-config`),
    client.get(`/api/v1/energy/projects/${PROJECT_ID}/rule-config`),
  ]);
  return client.post(`/api/v1/energy/projects/${PROJECT_ID}/setup/publish`, {
    expectedRevision: setup.data.draft.revision,
    expectedTemplateDraftRevision: template.data.draft.revision,
    expectedMetricConfigRevision: metrics.data.config.revision,
    expectedRuleConfigRevision: rules.data.config.revision,
  });
}

async function resolveAnalysis(client, period) {
  const response = await client.post("/api/v1/energy/analysis/resolve", {
    projectId: PROJECT_ID,
    scopeId: SCOPE_ID,
    resource: "electricity",
    ...period,
    bypassCache: true,
  });
  assert(response.data.status === "ready", `ANALYSIS_NOT_READY:${JSON.stringify(response.data)}`);
  return response.data.snapshot;
}

async function resolveWindows(client) {
  const entries = [];
  for (const analysisWindow of WINDOWS) {
    entries.push([analysisWindow, await resolveAnalysis(client, { analysisWindow })]);
  }
  return Object.fromEntries(entries);
}

async function readArtifactIdentity(client, expectedSnapshotId, expectedReleaseId) {
  try {
    const response = await client.get(`/api/v1/energy/projects/${PROJECT_ID}/overview-ai-artifact?scopeId=${encodeURIComponent(SCOPE_ID)}`);
    const artifact = response.data;
    assert(artifact.dataSnapshotId === expectedSnapshotId, "AI_ARTIFACT_SNAPSHOT_MISMATCH");
    assert(artifact.projectReleaseId === expectedReleaseId, "AI_ARTIFACT_RELEASE_MISMATCH");
    assert(["missing", "queued", "running", "available", "failed"].includes(artifact.status), "AI_ARTIFACT_STATUS_INVALID");
    return {
      status: "verified",
      artifactStatus: artifact.status,
      id: artifact.id ?? null,
      dataSnapshotId: artifact.dataSnapshotId,
      projectReleaseId: artifact.projectReleaseId,
      modelProfileId: artifact.modelProfileId ?? null,
      modelProfileRevision: artifact.modelProfileRevision ?? null,
    };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
      expectedSnapshotId,
      expectedReleaseId,
    };
  }
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
    preschoolBenchmark: productAvailability.preschoolBenchmark,
    preschoolAppliances: productAvailability.preschoolAppliances,
    preschoolOperational: productAvailability.preschoolOperational,
    planningOutlook: productAvailability.planningOutlook,
  };
}

export function charlesSectionAvailability(snapshot) {
  const benchmark = snapshot.preschoolBenchmark ?? { status: "missing" };
  const appliances = snapshot.preschoolAppliances ?? { status: "missing" };
  const operational = snapshot.preschoolOperational ?? { status: "missing" };
  const planning = operational.status === "available"
    ? operational.planningOutlook
    : { status: "unavailable", reason: operational.reason ?? { code: "PRESCHOOL_OPERATIONAL_MISSING" } };
  return {
    preschoolBenchmark: {
      status: benchmark.status,
      ...(benchmark.reason ? { reason: benchmark.reason } : {}),
      ...(benchmark.period ? { period: benchmark.period } : {}),
    },
    preschoolAppliances: {
      status: appliances.status,
      ...(appliances.reason ? { reason: appliances.reason } : {}),
      ...(appliances.period ? { period: appliances.period } : {}),
    },
    preschoolOperational: {
      status: operational.status,
      ...(operational.reason ? { reason: operational.reason } : {}),
      ...(operational.period ? { period: operational.period } : {}),
    },
    planningOutlook: {
      status: planning.status,
      ...(planning.reason ? { reason: planning.reason } : {}),
      ...(planning.targetPeriod ? { targetPeriod: planning.targetPeriod } : {}),
      actualVsPlanAvailable: false,
    },
  };
}

export function detectCharlesSectionBlockers(stageId, availability) {
  const blockers = [];
  if (availability.preschoolBenchmark.status !== "provisional") {
    blockers.push(`${stageId}:SECTION2_BENCHMARK_${availability.preschoolBenchmark.status.toUpperCase()}`);
  }
  if (availability.preschoolAppliances.status !== "available") {
    blockers.push(`${stageId}:SECTION3_APPLIANCES_${availability.preschoolAppliances.status.toUpperCase()}`);
  }
  if (availability.preschoolOperational.status !== "available") {
    blockers.push(`${stageId}:SECTION3_4_OPERATIONAL_${availability.preschoolOperational.status.toUpperCase()}`);
  }
  if (availability.planningOutlook.status === "unavailable") {
    blockers.push(`${stageId}:SECTION5_PLANNING_UNAVAILABLE`);
  }
  if (!availability.planningOutlook.actualVsPlanAvailable) {
    blockers.push(`${stageId}:SECTION5_ACTUAL_VS_PLAN_NOT_IMPLEMENTED`);
  }
  return blockers;
}

function collectEvidenceIds(value, found = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("evidence:")) found.add(value);
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceIds(item, found);
    return [...found];
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectEvidenceIds(item, found);
  }
  return [...found];
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
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function assertClose(actual, expected, tolerance, message) {
  assert(typeof actual === "number" && Math.abs(actual - expected) <= tolerance, `${message}:${actual}:${expected}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function isPortListening(port) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolvePort(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(false));
  });
}

async function waitForReady(baseUrl, child, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`ISOLATED_API_EXITED:${child.exitCode}`);
    try {
      const [health, ready] = await Promise.all([
        fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2_000) }),
        fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(2_000) }),
      ]);
      if (health.ok && ready.ok) {
        const ownerPid = readPortOwnerPid(port);
        if (ownerPid !== null && ownerPid !== child.pid) {
          throw new Error(`ISOLATED_API_PORT_OWNER_MISMATCH:${ownerPid}:${child.pid}`);
        }
        return;
      }
    } catch {
      // Startup is asynchronous; retry until the bounded deadline.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("ISOLATED_API_READY_TIMEOUT");
}

function readPortOwnerPid(port) {
  if (process.platform !== "win32") return null;
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const ownerPid = Number.parseInt(output, 10);
  if (!Number.isInteger(ownerPid)) throw new Error(`ISOLATED_API_PORT_OWNER_UNKNOWN:${port}`);
  return ownerPid;
}

async function terminateOwnedChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
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

function writeReport(path, report) {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function serializeError(error, depth = 0) {
  if (!(error instanceof Error)) return { value: String(error) };
  const record = {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
  if ("code" in error && typeof error.code === "string") record.code = error.code;
  if (depth < 3 && error.cause !== undefined) record.cause = serializeError(error.cause, depth + 1);
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

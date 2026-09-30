import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const baseUrl = (options["base-url"] ?? "http://127.0.0.1:8787").replace(/\/$/u, "");
const projectId = options.project ?? "preschool-demo";
const scopeId = options.scope ?? "preschool-project";
const workspaceId = options.workspace ?? "preschool-demo-org";
const rounds = parseRoundCount(options.rounds ?? "3");
const outputDir = resolve(options.output ?? `outputs/energyiq/preschool-html-ai-slot-ab-${timestamp()}`);
const slotIds = [
  "executive-summary",
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
  "additional-insight",
];

await mkdir(outputDir, { recursive: true });

const structured = await request({
  method: "GET",
  path: `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact`,
  query: { scopeId },
});
const modelProfile = await request({
  method: "GET",
  path: "/api/v1/workspace-default-model-profile",
});
const projection = structured.data?.overviewContext
  ? structured.data
  : (await request({
      method: "GET",
      path: `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-projection`,
      query: {},
    })).data;
const structuredBinding = resolveStructuredBinding(structured.data, modelProfile.data, projection);
const pin = {
  from: structuredBinding.analysisPeriod.from,
  to: structuredBinding.analysisPeriod.to,
  dataSnapshotId: structuredBinding.dataSnapshotId,
  projectReleaseId: structuredBinding.projectReleaseId,
};
const pinQuery = { scopeId, ...pin };
const htmlSlotBindingResponse = await request({
  method: "GET",
  path: `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/html-slots`,
  query: pinQuery,
});
const promptRevision = requirePromptRevision(htmlSlotBindingResponse.data?.binding);
const structuredPath = resolve(outputDir, "structured-baseline.json");
await writeJson(structuredPath, structured);

const report = {
  contract: "preschool-html-slot-ab-report@2",
  status: "incomplete-until-three-independent-provider-rounds",
  startedAt: new Date().toISOString(),
  baseUrl,
  projectId,
  scopeId,
  workspaceId,
  modelProfileId: structuredBinding.modelProfileId,
  modelProfileRevision: structuredBinding.modelProfileRevision,
  identity: {
    dataSnapshotId: pin.dataSnapshotId,
    projectReleaseId: pin.projectReleaseId,
    analysisPeriod: structuredBinding.analysisPeriod,
    promptRevision,
  },
  structuredBaseline: {
    status: structured.data?.status ?? "unknown",
    sha256: sha256(JSON.stringify(structured.data ?? null)),
    path: structuredPath,
    review: {
      readability: null,
      decisionValue: null,
      evidenceCorrectness: null,
      visualFit: null,
      redundancy: null,
      accessibility: null,
      stability: null,
      status: "human-review-required",
    },
  },
  rounds: [],
  evidenceBoundary: [
    "The POST is the only generation request; GETs are read-only artifact reads.",
    "A stable identity intentionally deduplicates after the first successful generation.",
    "Repeated calls in this script are cache/read-path checks, not additional DeepSeek generations.",
    "A three-provider-round experiment requires three isolated evaluation identities or an explicitly approved evaluation seam; this product endpoint must not regenerate an available immutable Artifact.",
  ],
};

for (let index = 0; index < rounds; index += 1) {
  const roundNumber = index + 1;
  const before = await request({
    method: "GET",
    path: `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/html-slots`,
    query: pinQuery,
  });
  const beforeStatuses = slotStatuses(before.data);
  const startedAt = performance.now();
  let generation;
  try {
    generation = await request({
      method: "POST",
      path: `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/html-slots/ensure`,
      query: pinQuery,
    });
  } catch (error) {
    const round = {
      round: roundNumber,
      status: "request-failed",
      elapsedMs: Math.round(performance.now() - startedAt),
      beforeStatuses,
      error: errorRecord(error),
      providerCallsExpected: beforeStatuses.filter((status) => status === "missing").length,
    };
    report.rounds.push(round);
    await writeJson(resolve(outputDir, `round-${roundNumber}.json`), round);
    await writeJson(resolve(outputDir, "report.json"), report);
    throw error;
  }
  const round = await summarizeRound(roundNumber, generation.data, beforeStatuses, performance.now() - startedAt, outputDir);
  report.rounds.push(round);
  await writeJson(resolve(outputDir, `round-${roundNumber}.json`), round);
  await writeJson(resolve(outputDir, "report.json"), report);
}

report.completedAt = new Date().toISOString();
if (report.rounds.length === 3 && report.rounds.every((round) => round.status === "completed")) {
  report.status = report.rounds.some((round) => round.providerCallsExpected > 0)
    ? "completed-with-cache-verification"
    : "cache-only-no-provider-round-completed";
}
await writeJson(resolve(outputDir, "report.json"), report);
process.stdout.write(`${JSON.stringify({ status: report.status, outputDir, rounds: report.rounds.length }, null, 2)}\n`);

async function summarizeRound(round, data, beforeStatuses, elapsedMs, targetDir) {
  const slots = data?.slots && typeof data.slots === "object" ? data.slots : {};
  const slotRecords = await Promise.all(slotIds.map(async (slotId) => {
    const slot = slots[slotId];
    const artifact = slot?.artifact;
    const generation = slot?.generation;
    const artifactPath = artifact
      ? resolve(targetDir, `round-${round}-${slotId}.artifact.json`)
      : undefined;
    if (artifactPath) await writeJson(artifactPath, artifact);
    return {
      slotId,
      status: slot?.status ?? "missing",
      artifactPath,
      htmlBytes: typeof artifact?.html === "string" ? Buffer.byteLength(artifact.html, "utf8") : null,
      htmlSha256: typeof artifact?.html === "string" ? sha256(artifact.html) : null,
      evidenceRefCount: Array.isArray(artifact?.evidenceRefs) ? artifact.evidenceRefs.length : null,
      identity: artifact?.identity ?? null,
      latencyMs: generation?.latencyMs ?? null,
      inputTokens: generation?.inputTokens ?? null,
      outputTokens: generation?.outputTokens ?? null,
      storedHtmlSha256: generation?.htmlSha256 ?? null,
      acceptance: slot?.acceptance?.status ?? null,
      droppedClaims: Array.isArray(slot?.acceptance?.droppedClaims) ? slot.acceptance.droppedClaims : [],
      errorCode: slot?.errorCode ?? null,
      review: {
        readability: null,
        decisionValue: null,
        evidenceCorrectness: null,
        visualFit: null,
        redundancy: null,
        accessibility: null,
        stability: null,
        status: "human-review-required",
      },
    };
  }));
  if (slotRecords.length !== slotIds.length) throw new Error("HTML_SLOT_AB_SIX_SLOTS_REQUIRED");
  const providerCallsExpected = beforeStatuses.filter((status) => status === "missing").length;
  return {
    round,
    status: "completed",
    elapsedMs: Math.round(elapsedMs),
    beforeStatuses,
    providerCallsExpected,
    providerEvidence: providerCallsExpected > 0 ? "explicit POST entered generation path" : "no Provider call expected from stable identity",
    binding: data?.binding ?? null,
    slots: slotRecords,
  };
}

async function request({ method, path, query }) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer dev-token",
      "X-Workspace-Id": workspaceId,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(method === "POST" ? 13 * 60 * 1000 : 30_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2_000) }; }
  if (!response.ok || body.success !== true) {
    throw new Error(`HTML_SLOT_AB_HTTP_${response.status}:${JSON.stringify(body).slice(0, 2_000)}`);
  }
  return body;
}

function resolveStructuredBinding(data, profile, projection) {
  const binding = data?.result?.binding ?? data?.binding;
  const projectionIdentity = data?.overviewContext?.identity
    ?? data?.snapshot?.context
    ?? projection?.overviewContext?.identity
    ?? projection?.snapshot?.context;
  const resolvedBinding = binding && typeof binding === "object"
    ? binding
    : projectionIdentity && typeof projectionIdentity === "object" && profile && typeof profile === "object"
      ? {
          dataSnapshotId: projectionIdentity.dataSnapshotId,
          projectReleaseId: projectionIdentity.projectReleaseId,
          modelProfileId: profile.id,
          modelProfileRevision: profile.revision,
          analysisPeriod: { from: projectionIdentity.from, to: projectionIdentity.to },
        }
      : undefined;
  if (!resolvedBinding || typeof resolvedBinding !== "object") throw new Error("HTML_SLOT_AB_STRUCTURED_BINDING_REQUIRED");
  const required = ["dataSnapshotId", "projectReleaseId", "modelProfileId", "modelProfileRevision"];
  if (required.some((key) => resolvedBinding[key] === undefined || resolvedBinding[key] === null)) {
    throw new Error("HTML_SLOT_AB_STRUCTURED_BINDING_INCOMPLETE");
  }
  const analysisPeriod = resolvedBinding.analysisPeriod;
  if (!analysisPeriod?.from || !analysisPeriod?.to) throw new Error("HTML_SLOT_AB_PERIOD_REQUIRED");
  return { ...resolvedBinding, analysisPeriod };
}

function requirePromptRevision(binding) {
  const promptRevision = binding && typeof binding === "object" ? binding.promptRevision : undefined;
  if (typeof promptRevision !== "string" || !promptRevision.trim()) {
    throw new Error("HTML_SLOT_AB_PROMPT_REVISION_REQUIRED");
  }
  return promptRevision;
}

function slotStatuses(data) {
  const slots = data?.slots && typeof data.slots === "object" ? data.slots : {};
  return slotIds.map((slotId) => slots[slotId]?.status ?? "missing");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function errorRecord(error) {
  return { message: error instanceof Error ? error.message : String(error) };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
}

function parseRoundCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) throw new Error("HTML_SLOT_AB_ROUNDS_INVALID");
  return parsed;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`HTML_SLOT_AB_ARGUMENT_REQUIRED:${value}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

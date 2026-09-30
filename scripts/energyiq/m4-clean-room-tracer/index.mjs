import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

const DESIGN_INTENT_KEYS = [
  "audience",
  "managementQuestion",
  "sectionIntent",
  "visualHierarchy",
  "interactionIntent",
  "sourceRefs",
  "assumptions",
  "unresolvedQuestions",
];

const DEFAULT_FORBIDDEN_PATHS = [
  /(?:preschool|ngee-ann).*renderer/iu,
  /renderer.*(?:preschool|ngee-ann)/iu,
  /(?:^|\/)golden(?:s)?(?:\/|$)/iu,
  /(?:preschool|ngee-ann).*(?:fixture|snapshot)/iu,
];

const IMPLEMENTATION_LANGUAGE = /(?:\b(?:react|css|javascript|sql|renderer|capability|placement|grid|span|height|formula|prompt|kpi)\b|<\/?[a-z][^>]*>)/iu;
const DATA_VALUE = /\b\d+(?:\.\d+)?(?:\s*(?:kwh|kw|%|s\$|sqm|m²))?\b/iu;

export const assertSanitizedKit = async ({
  root,
  allowedPaths,
  forbiddenContent = [],
  forbiddenPaths = DEFAULT_FORBIDDEN_PATHS,
}) => {
  const absoluteRoot = resolve(root);
  const entries = await walk(absoluteRoot);
  const manifest = [];
  for (const absolutePath of entries) {
    const relativePath = relative(absoluteRoot, absolutePath).replaceAll("\\", "/");
    if (forbiddenPaths.some((pattern) => pattern.test(relativePath))) {
      throw new Error("TRACER_INPUT_CONTAMINATED");
    }
    const content = await readFile(absolutePath);
    if (forbiddenContent.some((sentinel) => content.includes(Buffer.from(sentinel)))) {
      throw new Error("TRACER_INPUT_CONTAMINATED");
    }
    manifest.push({
      path: relativePath,
      size: content.byteLength,
      sha256: sha256(content),
    });
  }
  const sorted = manifest.sort((left, right) => left.path.localeCompare(right.path));
  if (allowedPaths) {
    const actual = sorted.map((entry) => entry.path);
    const expected = [...allowedPaths].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("TRACER_INPUT_CONTAMINATED");
  }
  return sorted;
};

export const validateDesignIntent = (value) => {
  const record = requireRecord(value, "DESIGN_INTENT_INVALID");
  requireExactKeys(record, DESIGN_INTENT_KEYS, "DESIGN_INTENT_INVALID");
  const canonical = {
    audience: requireText(record.audience, "DESIGN_INTENT_INVALID"),
    managementQuestion: requireText(record.managementQuestion, "DESIGN_INTENT_INVALID"),
    sectionIntent: requireText(record.sectionIntent, "DESIGN_INTENT_INVALID"),
    visualHierarchy: requireTextArray(record.visualHierarchy, "DESIGN_INTENT_INVALID"),
    interactionIntent: requireTextArray(record.interactionIntent, "DESIGN_INTENT_INVALID"),
    sourceRefs: requireTextArray(record.sourceRefs, "DESIGN_INTENT_INVALID"),
    assumptions: requireTextArray(record.assumptions, "DESIGN_INTENT_INVALID"),
    unresolvedQuestions: requireTextArray(record.unresolvedQuestions, "DESIGN_INTENT_INVALID"),
  };
  const semanticText = [
    canonical.audience,
    canonical.managementQuestion,
    canonical.sectionIntent,
    ...canonical.visualHierarchy,
    ...canonical.interactionIntent,
    ...canonical.assumptions,
    ...canonical.unresolvedQuestions,
  ].join("\n");
  if (IMPLEMENTATION_LANGUAGE.test(semanticText) || DATA_VALUE.test(semanticText)) {
    throw new Error("DESIGN_INTENT_IMPLEMENTATION_LEAK");
  }
  return canonical;
};

export const buildBindingPlan = ({ intent, catalog, policy }) => {
  validateDesignIntent(intent);
  const capability = catalog.find((candidate) => candidate.family === "overview"
    && candidate.revision_id === "overview.consumption@1"
    && candidate.query_ids?.includes("scope_summary_v1"));
  if (!capability) {
    return { status: "gap", code: "CAPABILITY_REQUIRED", requestedFamily: "overview" };
  }
  const window = policy.windows.find((candidate) => candidate.role === "recent_operations");
  if (!window) {
    return { status: "gap", code: "WINDOW_UNKNOWN", requestedRole: "recent_operations" };
  }
  return {
    status: "bound",
    sectionKey: "portfolio-consumption",
    blockKey: "portfolio-consumption-summary",
    capabilityRevisionId: capability.revision_id,
    windowId: window.windowId,
    evidenceInputs: [...capability.query_ids],
    readiness: "partial",
    classification: "R",
    limitations: ["Official aggregation mapping is not present in the sanitized kit."],
  };
};

export const compileDeterministically = async ({ proposal, catalog, policy }) => {
  const compilerUrl = new URL("../../../packages/metadata/dist/energyiq-overview-definition.js", import.meta.url);
  const { compileEnergyIqOverviewDefinition } = await import(compilerUrl.href);
  const compile = () => compileEnergyIqOverviewDefinition({
    definition: proposal.desiredDefinition,
    catalog,
    reportTimePolicy: policy,
  });
  const first = compile();
  const second = compile();
  const firstBytes = JSON.stringify(first);
  const secondBytes = JSON.stringify(second);
  if (firstBytes !== secondBytes || first.definitionFingerprint !== second.definitionFingerprint) {
    throw new Error("DEFINITION_NOT_DETERMINISTIC");
  }
  return {
    stable: true,
    definitionFingerprint: first.definitionFingerprint,
    firstBytes,
    secondBytes,
    compiled: first,
  };
};

export const createOfflinePreview = ({
  proposal,
  compiledTemplate,
  fixedIdentity,
  counters,
  replay,
}) => {
  if (!fixedIdentity?.dataSnapshotId || !fixedIdentity?.projectReleaseId) {
    throw new Error("PREVIEW_IDENTITY_UNPINNED");
  }
  if (counters.publicationMutationCount !== 0
    || counters.providerRunCount !== 0
    || counters.queueRunCount !== 0) {
    throw new Error("PREVIEW_SIDE_EFFECT");
  }
  const section = proposal.desiredDefinition.sections[0];
  return {
    renderer: "m4-tracer-structured-preview",
    customerRendererParity: "unproven",
    fixedIdentity: { ...fixedIdentity },
    counters: { ...counters },
    section: {
      key: section.key,
      title: section.title,
      managementQuestion: section.managementQuestion,
      blocks: section.blocks.map((block) => ({ ...block })),
    },
    compiledTemplateSha256: sha256(JSON.stringify(compiledTemplate)),
    readiness: "partial",
    dataWitness: {
      kind: "source-level-deterministic-witness",
      totalUsageKwh: replay.totalUsageKwh,
      officialAggregationConfirmed: false,
    },
  };
};

export const validateReplayMatrix = (attempts) => {
  if (attempts.length !== 3
    || attempts.map((attempt) => attempt.label).join(",") !== "Day01,Day07,Day30") {
    throw new Error("RERUN_MATRIX_INVALID");
  }
  const fingerprints = new Set(attempts.map((attempt) => attempt.definitionFingerprint));
  if (fingerprints.size !== 1) throw new Error("RERUN_DESIGN_CHANGED");
  return {
    sameDefinition: true,
    definitionFingerprint: attempts[0].definitionFingerprint,
    attempts: attempts.map((attempt) => ({ ...attempt })),
  };
};

export const enforceCustomerRendererBoundary = (input) => {
  if (input.previewRenderer === "m4-tracer-structured-preview"
    && input.customerRendererParity !== "unproven") {
    throw new Error("CUSTOMER_RENDERER_PARITY_UNPROVEN");
  }
  return { ...input, customerRendererParity: "unproven" };
};

export const enforceEvidenceScope = (input) => {
  if (input.evidenceScope !== "process-mechanics-only"
    || /(?:third[- ]project|cross[- ]project|\bG5\b)/iu.test(input.conclusion)) {
    throw new Error("EVIDENCE_SCOPE_OVERCLAIMED");
  }
  return { ...input };
};

export const extractDesignIntentFromReference = (referenceHtml) => {
  if (typeof referenceHtml !== "string"
    || !/id=["']s1["']/iu.test(referenceHtml)
    || !/Overall\s+Consumption\s+Summary/iu.test(referenceHtml)) {
    throw new Error("REFERENCE_INTENT_NOT_FOUND");
  }
  return {
    audience: "Energy and facilities managers",
    managementQuestion: "How much electricity did the portfolio use, and where should management look first?",
    sectionIntent: "Summarise total portfolio consumption before deeper diagnostic sections.",
    visualHierarchy: ["Lead with the consumption summary", "Keep evidence inspectable"],
    interactionIntent: ["Allow evidence inspection"],
    sourceRefs: ["reference.html#s1"],
    assumptions: ["The reference expresses presentation intent only."],
    unresolvedQuestions: ["Confirm the official aggregation route."],
  };
};

export const buildCumulativeReplayFromRows = ({
  label,
  definitionFingerprint,
  sourceSha256,
  rows,
}) => {
  const readingsByKey = new Map();
  const conflictKeys = new Set();
  for (const row of rows) {
    if (!row.sourceLabel || !Number.isFinite(row.timestamp) || !Number.isFinite(row.reading) || row.reading < 0) continue;
    const key = `${row.sourceLabel}\u0000${row.timestamp}`;
    const existing = readingsByKey.get(key);
    if (existing && existing.reading !== row.reading) conflictKeys.add(key);
    else if (!existing) readingsByKey.set(key, { ...row });
  }
  for (const key of conflictKeys) readingsByKey.delete(key);
  const bySource = new Map();
  for (const row of readingsByKey.values()) {
    bySource.set(row.sourceLabel, [...(bySource.get(row.sourceLabel) ?? []), row]);
  }
  const intervals = [];
  for (const group of bySource.values()) {
    group.sort((left, right) => left.timestamp - right.timestamp);
    for (let index = 1; index < group.length; index += 1) {
      const minutes = (group[index].timestamp - group[index - 1].timestamp) / 60_000;
      if (minutes > 0) intervals.push(minutes);
    }
  }
  intervals.sort((left, right) => left - right);
  const typicalIntervalMinutes = intervals[Math.floor(intervals.length / 2)] ?? 0;
  const toleranceMinutes = typicalIntervalMinutes * 0.25;
  const qualityCounts = {
    ok: 0,
    negative_delta: 0,
    gap: 0,
    irregular_interval: 0,
    duplicate_conflict: conflictKeys.size,
  };
  let totalUsageKwh = 0;
  let coverageFrom;
  let coverageTo;
  for (const group of bySource.values()) {
    for (const row of group) {
      coverageFrom = coverageFrom === undefined ? row.timestamp : Math.min(coverageFrom, row.timestamp);
      coverageTo = coverageTo === undefined ? row.timestamp : Math.max(coverageTo, row.timestamp);
    }
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      const elapsedMinutes = (current.timestamp - previous.timestamp) / 60_000;
      const delta = current.reading - previous.reading;
      if (delta < 0) {
        qualityCounts.negative_delta += 1;
      } else if (elapsedMinutes > typicalIntervalMinutes + toleranceMinutes) {
        qualityCounts.gap += 1;
      } else if (elapsedMinutes < typicalIntervalMinutes - toleranceMinutes) {
        qualityCounts.irregular_interval += 1;
      } else {
        qualityCounts.ok += 1;
        totalUsageKwh += delta;
      }
    }
  }
  return {
    label,
    definitionFingerprint,
    sourceSha256,
    sourceSnapshotId: `m4-source-${sourceSha256.slice(0, 16)}`,
    readingCount: readingsByKey.size,
    validIntervalCount: qualityCounts.ok,
    totalUsageKwh: round(totalUsageKwh),
    typicalIntervalMinutes,
    qualityCounts,
    ...(coverageFrom === undefined ? {} : { coverageFrom: new Date(coverageFrom).toISOString() }),
    ...(coverageTo === undefined ? {} : { coverageTo: new Date(coverageTo).toISOString() }),
    result: qualityCounts.ok > 0 ? "pass" : "fail",
    truthBoundary: "source-level-deterministic-witness-only",
  };
};

export const evaluateTracerExitGate = ({
  contaminationPassed,
  definitionStable,
  preview,
  replayMatrix,
  ledgerComplete = true,
}) => {
  const blockers = [];
  if (!contaminationPassed) blockers.push("TRACER_INPUT_CONTAMINATED");
  if (!definitionStable) blockers.push("DEFINITION_NOT_DETERMINISTIC");
  if (!replayMatrix.sameDefinition || replayMatrix.attempts.some((attempt) => attempt.result !== "pass")) {
    blockers.push("DETERMINISTIC_REPLAY_INCOMPLETE");
  }
  if (preview.dataWitness.officialAggregationConfirmed !== true) {
    blockers.push("OFFICIAL_AGGREGATION_BINDING_UNAVAILABLE");
  }
  if (preview.customerRendererParity !== "proven") {
    blockers.push("CUSTOMER_RENDERER_PARITY_UNPROVEN");
  }
  if (Object.values(preview.counters).some((value) => value !== 0)) blockers.push("PREVIEW_SIDE_EFFECT");
  if (!ledgerComplete) blockers.push("HUMAN_TIME_UNMEASURED");
  return {
    status: blockers.length === 0 ? "M4-NIGHT-TRACER-PASS" : "M4-NIGHT-TRACER-BLOCKED",
    blockers,
    evidenceScope: "process-mechanics-only",
  };
};

const walk = async (root) => {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("TRACER_INPUT_ROOT_INVALID");
  const found = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) found.push(absolutePath);
      else throw new Error("TRACER_INPUT_LINK_FORBIDDEN");
    }
  };
  await visit(root);
  return found;
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const round = (value) => Math.round(value * 1_000_000) / 1_000_000;

const requireRecord = (value, code) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value;
};

const requireExactKeys = (record, expected, code) => {
  const actual = Object.keys(record).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) throw new Error(code);
};

const requireText = (value, code) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim().replace(/\s+/gu, " ");
};

const requireTextArray = (value, code) => {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((item) => requireText(item, code));
};

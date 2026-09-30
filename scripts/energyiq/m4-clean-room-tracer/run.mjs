import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import readExcelFile from "read-excel-file/node";

import {
  assertSanitizedKit,
  buildBindingPlan,
  buildCumulativeReplayFromRows,
  compileDeterministically,
  createOfflinePreview,
  enforceCustomerRendererBoundary,
  enforceEvidenceScope,
  evaluateTracerExitGate,
  extractDesignIntentFromReference,
  validateDesignIntent,
  validateReplayMatrix,
} from "./index.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.argv[2] ?? join(repoRoot, "docs", "energyiq", "evidence", "2026-08-20-m4-night-tracer-c4821a2"),
);
const allowedInputs = {
  reference: join(repoRoot, "docs", "template", "Preschool", "Energy_Report_May2026.html"),
  Day01: join(repoRoot, "outputs", "t39-preschool-continuous-ab-20260810", "Preschool_June_2026_Day01.incremental-cumulative.xlsx"),
  Day07: join(repoRoot, "outputs", "t39-preschool-continuous-ab-20260810", "Preschool_June_2026_Day07.incremental-cumulative.xlsx"),
  Day30: join(repoRoot, "outputs", "t39-preschool-continuous-ab-20260810", "Preschool_June_2026_Day30.incremental-cumulative.xlsx"),
};

const sourceBoundary = {
  reads: [
    "controlled-preschool-reference-html",
    "preschool-synthetic-acceptance-workbooks-day01-day07-day30",
  ],
  excludes: [
    "project-renderer-implementation",
    "compiled-project-definition",
    "production-database",
    "provider-response",
  ],
};

const catalog = [{
  revision_id: "overview.consumption@1",
  component_id: "overview.consumption",
  version: 1,
  display_name: "Consumption overview",
  description: "Total usage, daily average and peak demand for the selected scope and period.",
  family: "overview",
  view_key: "consumption_overview_v1",
  target: "both",
  metric_revision_ids: ["energy.total_usage_kwh@1", "energy.average_daily_usage_kwh@1", "energy.peak_demand_kw@1"],
  rule_revision_ids: [],
  query_ids: ["scope_summary_v1"],
  requirement: "always",
  allowed_presentation: {
    layout: { spans: [4, 6, 8, 12], heights: ["compact", "standard", "tall"] },
    visuals: {
      presets: ["auto", "cards"],
      densities: ["comfortable", "compact"],
      tones: ["default", "highlight", "quiet"],
      legend: { configurable: false, default: false },
      limit: { configurable: false, min: 1, max: 50, default: 10 },
    },
  },
  created_at: "2026-08-02T00:00:00.000Z",
}];

const policy = {
  policyId: "m4-clean-room-report-time",
  revision: "1",
  windows: [{
    windowId: "current-overview",
    role: "recent_operations",
    label: "Recent complete days",
    strategy: { kind: "rolling_complete_days", days: 28 },
  }],
};

const allowlist = [
  "input/reference.html",
  "input/day01.xlsx",
  "input/day07.xlsx",
  "input/day30.xlsx",
  "sanitized-kit/brief.json",
  "sanitized-kit/component-catalog.json",
  "sanitized-kit/report-time-policy.json",
];

const forbiddenContent = [
  "preschool-overview-renderer",
  "ngee-ann-overview-renderer",
  "PROJECT_OVERVIEW_PROFILES",
  "golden fixture",
];

const main = async () => {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const baselineSha = stdout.trim();
  const generatedAt = new Date().toISOString();
  const tempRoot = await mkdtemp(join(tmpdir(), "energyiq-m4-tracer-"));
  const startedAt = Date.now();
  try {
    await mkdir(dirname(outputRoot), { recursive: true });
    await mkdir(outputRoot, { recursive: false });
    await createIsolatedInputKit(tempRoot);
    const inputManifestEntries = await assertSanitizedKit({
      root: tempRoot,
      allowedPaths: allowlist,
      forbiddenContent,
    });
    const inputManifest = {
      contractRevision: "m4-reference-bundle-manifest@1",
      runId: basename(outputRoot),
      baselineSha,
      createdAt: generatedAt,
      evidenceScope: "process-mechanics-only",
      sourceBoundary,
      files: inputManifestEntries,
      allowlist,
      denylist: ["project renderer implementation", "compiled project definition", "production database", "provider response"],
    };

    const referenceHtml = await readFile(join(tempRoot, "input", "reference.html"), "utf8");
    const designIntent = validateDesignIntent(extractDesignIntentFromReference(referenceHtml));
    const bindingPlan = buildBindingPlan({ intent: designIntent, catalog, policy });
    if (bindingPlan.status !== "bound") throw new Error(bindingPlan.code);
    const proposal = createProposal(designIntent, bindingPlan);
    const compiled = await compileDeterministically({ proposal, catalog, policy });

    const replayAttempts = [];
    for (const label of ["Day01", "Day07", "Day30"]) {
      const content = await readFile(join(tempRoot, "input", `${label.toLowerCase()}.xlsx`));
      replayAttempts.push(buildCumulativeReplayFromRows({
        label,
        definitionFingerprint: compiled.definitionFingerprint,
        sourceSha256: sha256(content),
        rows: await parseCumulativeWorkbook(content),
      }));
    }
    const replayMatrix = validateReplayMatrix(replayAttempts);
    const day07 = replayAttempts[1];
    const preview = createOfflinePreview({
      proposal,
      compiledTemplate: compiled.compiled.templateDocument,
      fixedIdentity: {
        dataSnapshotId: day07.sourceSnapshotId,
        projectReleaseId: `m4-tracer-${baselineSha.slice(0, 12)}`,
      },
      counters: { publicationMutationCount: 0, providerRunCount: 0, queueRunCount: 0 },
      replay: day07,
    });
    enforceCustomerRendererBoundary({
      previewRenderer: preview.renderer,
      customerRendererParity: preview.customerRendererParity,
    });
    enforceEvidenceScope({
      evidenceScope: "process-mechanics-only",
      conclusion: "This tracer validates isolated conversion mechanics only.",
    });
    const exitGate = evaluateTracerExitGate({
      contaminationPassed: true,
      definitionStable: compiled.stable,
      preview,
      replayMatrix,
      ledgerComplete: false,
    });

    await writeEvidence({
      inputManifest,
      designIntent,
      bindingPlan,
      proposal,
      compiled,
      preview,
      replayMatrix,
      exitGate,
      baselineSha,
      generatedAt,
      elapsedMilliseconds: Date.now() - startedAt,
    });
    process.stdout.write(`${JSON.stringify({ outputRoot, exitGate, definitionFingerprint: compiled.definitionFingerprint }, null, 2)}\n`);
  } finally {
    const safeTempRoot = resolve(tempRoot);
    const systemTemp = resolve(tmpdir());
    if (!safeTempRoot.startsWith(`${systemTemp}\\`) || !basename(safeTempRoot).startsWith("energyiq-m4-tracer-")) {
      throw new Error("TRACER_TEMP_CLEANUP_TARGET_INVALID");
    }
    await rm(safeTempRoot, { recursive: true, force: true });
  }
};

const createIsolatedInputKit = async (tempRoot) => {
  const inputDir = join(tempRoot, "input");
  const kitDir = join(tempRoot, "sanitized-kit");
  await mkdir(inputDir, { recursive: true });
  await mkdir(kitDir, { recursive: true });
  await copyFile(allowedInputs.reference, join(inputDir, "reference.html"));
  await copyFile(allowedInputs.Day01, join(inputDir, "day01.xlsx"));
  await copyFile(allowedInputs.Day07, join(inputDir, "day07.xlsx"));
  await copyFile(allowedInputs.Day30, join(inputDir, "day30.xlsx"));
  await writeJson(join(kitDir, "component-catalog.json"), catalog);
  await writeJson(join(kitDir, "report-time-policy.json"), policy);
  await writeJson(join(kitDir, "brief.json"), {
    audience: "Energy and facilities managers",
    goal: "Create one inspectable portfolio consumption section from trusted inputs.",
    timezone: "Asia/Singapore",
    evidenceBoundary: "Reference values and executable code are not runtime truth.",
  });
};

const parseCumulativeWorkbook = async (content) => {
  const sheets = await readExcelFile(content);
  const sheet = sheets.find((candidate) => {
    const headers = new Set((candidate.data[0] ?? []).map((value) => String(value ?? "").trim().toLowerCase()));
    return ["device name", "time", "active energy"].every((header) => headers.has(header));
  });
  if (!sheet) throw new Error("TRACER_WORKBOOK_COLUMNS_REQUIRED");
  const headers = sheet.data[0].map((value) => String(value ?? "").trim().toLowerCase());
  const labelIndex = headers.indexOf("device name");
  const timeIndex = headers.indexOf("time");
  const readingIndex = headers.indexOf("active energy");
  return sheet.data.slice(1).flatMap((row) => {
    const sourceLabel = String(row[labelIndex] ?? "").trim();
    const timestamp = row[timeIndex] instanceof Date ? row[timeIndex].getTime() : Date.parse(String(row[timeIndex] ?? ""));
    const reading = typeof row[readingIndex] === "number" ? row[readingIndex] : Number(row[readingIndex]);
    return sourceLabel && Number.isFinite(timestamp) && Number.isFinite(reading)
      ? [{ sourceLabel, timestamp, reading }]
      : [];
  });
};

const createProposal = (intent, binding) => ({
  contractRevision: "energyiq-overview-definition-change@1",
  title: "Add portfolio consumption summary",
  rationale: "Lead with trusted consumption before deeper diagnosis.",
  desiredDefinition: {
    contractRevision: "energyiq-overview-definition@1",
    timePolicyRevisionId: `${policy.policyId}@${policy.revision}`,
    sections: [{
      key: binding.sectionKey,
      title: "Portfolio consumption",
      managementQuestion: intent.managementQuestion,
      primaryWindowId: binding.windowId,
      supportingWindowIds: [],
      blocks: [{
        key: binding.blockKey,
        capabilityRevisionId: binding.capabilityRevisionId,
        windowId: binding.windowId,
        emphasis: "primary",
      }],
    }],
  },
});

const writeEvidence = async (evidence) => {
  for (const directory of ["manifest", "sanitized-kit", "results", "ledger"]) {
    await mkdir(join(outputRoot, directory), { recursive: true });
  }
  await writeJson(join(outputRoot, "manifest", "input-manifest.json"), evidence.inputManifest);
  await writeJson(join(outputRoot, "sanitized-kit", "component-catalog.json"), catalog);
  await writeJson(join(outputRoot, "sanitized-kit", "report-time-policy.json"), policy);
  await writeJson(join(outputRoot, "sanitized-kit", "brief.json"), {
    audience: "Energy and facilities managers",
    goal: "Create one inspectable portfolio consumption section from trusted inputs.",
    timezone: "Asia/Singapore",
    evidenceBoundary: "Reference values and executable code are not runtime truth.",
  });
  await writeJson(join(outputRoot, "results", "design-intent.json"), evidence.designIntent);
  await writeJson(join(outputRoot, "results", "binding-plan.json"), evidence.bindingPlan);
  await writeJson(join(outputRoot, "results", "desired-definition.json"), evidence.proposal);
  await writeJson(join(outputRoot, "results", "compiled-template.json"), {
    definitionFingerprint: evidence.compiled.definitionFingerprint,
    definition: evidence.compiled.compiled.definition,
    templateDocument: evidence.compiled.compiled.templateDocument,
    diff: evidence.compiled.compiled.diff,
    deterministicBytesSha256: sha256(evidence.compiled.firstBytes),
  });
  await writeJson(join(outputRoot, "results", "preview-manifest.json"), evidence.preview);
  await writeFile(join(outputRoot, "results", "active-draft-preview.html"), renderPreviewHtml(evidence.preview), "utf8");
  await writeJson(join(outputRoot, "results", "rerun-matrix.json"), evidence.replayMatrix);
  await writeFile(join(outputRoot, "ledger", "delivery-ledger.yaml"), renderLedger(evidence), "utf8");
  await writeFile(join(outputRoot, "CONCLUSION.md"), renderConclusion(evidence), "utf8");
};

const renderPreviewHtml = (preview) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>M4 Active Draft Preview</title><style>
body{font-family:Arial,sans-serif;margin:0;background:#f5f5f2;color:#111}.shell{max-width:960px;margin:40px auto;padding:28px}.badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#ffe8b3;font-size:12px;font-weight:700}.card{margin-top:20px;background:white;border:1px solid #ddd;border-radius:16px;padding:28px}.value{font-size:44px;font-weight:760;margin:18px 0 4px}.muted{color:#666}.warning{border-left:4px solid #b56a00;padding-left:12px}
</style></head><body><main class="shell"><span class="badge">STRUCTURED TRACER PREVIEW · NOT PUBLISHED</span>
<h1>${escapeHtml(preview.section.title)}</h1><p>${escapeHtml(preview.section.managementQuestion)}</p>
<section class="card"><h2>Source-level consumption witness</h2><div class="value">${preview.dataWitness.totalUsageKwh.toLocaleString("en-SG")} kWh</div>
<p class="warning">This value is deterministic from the isolated source workbook, but official project aggregation is not confirmed because Mapping and the official route were deliberately excluded.</p>
<p class="muted">Snapshot ${escapeHtml(preview.fixedIdentity.dataSnapshotId)} · Release ${escapeHtml(preview.fixedIdentity.projectReleaseId)}</p></section>
<p class="muted">Customer Renderer parity: unproven · Provider/queue/publish side effects: zero</p></main></body></html>\n`;

const renderLedger = (evidence) => `delivery_id: ${basename(outputRoot)}
baseline_ref: ${evidence.baselineSha}
generated_at: ${evidence.generatedAt}
evidence_scope: process-mechanics-only
elapsed_automation_milliseconds: ${evidence.elapsedMilliseconds}
human_minutes:
  status: unavailable
  reason: automated tracer execution was not a human time study
blocks:
  - key: ${evidence.bindingPlan.blockKey}
    class: ${evidence.bindingPlan.classification}
    capability_revision_id: ${evidence.bindingPlan.capabilityRevisionId}
    window_id: ${evidence.bindingPlan.windowId}
    readiness: ${evidence.bindingPlan.readiness}
definition_fingerprint: ${evidence.compiled.definitionFingerprint}
preview:
  publication_mutation_count: 0
  provider_run_count: 0
  queue_run_count: 0
  customer_renderer_parity: unproven
rerun_attempts:
${evidence.replayMatrix.attempts.map((attempt) => `  - label: ${attempt.label}\n    source_snapshot_id: ${attempt.sourceSnapshotId}\n    result: ${attempt.result}\n    total_usage_kwh: ${attempt.totalUsageKwh}\n    truth_boundary: ${attempt.truthBoundary}`).join("\n")}
exit_status: ${evidence.exitGate.status}
blockers:
${evidence.exitGate.blockers.map((blocker) => `  - ${blocker}`).join("\n")}
`;

const renderConclusion = (evidence) => `# M4 clean-room tracer conclusion

**Status:** \`${evidence.exitGate.status}\`

## Passed mechanics

- Physical allowlist kit and SHA-256 manifest passed contamination scanning.
- Reference Section intent was extracted without carrying embedded values or executable code.
- One Section / one Block / one Window bound to \`overview.consumption@1\` and \`current-overview\`.
- The public Overview Definition compiler produced byte-stable output and one immutable fingerprint.
- Day01, Day07 and Day30 produced deterministic source-level witnesses under the same Definition fingerprint.
- Preview publication mutations, Provider Runs and queue Runs remained zero.

## Blockers

${evidence.exitGate.blockers.map((blocker) => `- \`${blocker}\``).join("\n")}

The sanitized kit deliberately excludes project Mapping and the official aggregation route, so source-meter deltas cannot be promoted to the trusted \`overview.consumption@1\` value. The Preview is a structured tracer artifact, not customer Renderer parity. Human delivery minutes were not measured during this automated run.

## Evidence boundary

This is **process-mechanics evidence only**. It is not M1 visual/content acceptance, not two live M2 data cycles, not M5 self-service, and not third-project/G5 proof.
`;

const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value) => String(value).replace(/[&<>"']/gu, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[character]);

await main();

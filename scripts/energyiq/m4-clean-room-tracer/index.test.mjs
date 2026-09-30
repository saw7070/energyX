import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSanitizedKit,
  buildBindingPlan,
  compileDeterministically,
  createOfflinePreview,
  enforceCustomerRendererBoundary,
  enforceEvidenceScope,
  evaluateTracerExitGate,
  extractDesignIntentFromReference,
  buildCumulativeReplayFromRows,
  validateDesignIntent,
  validateReplayMatrix,
} from "./index.mjs";

const expectCode = (code) => (error) => error instanceof Error && error.message === code;

const catalog = [{
  revision_id: "overview.consumption@1",
  component_id: "overview.consumption",
  version: 1,
  display_name: "Consumption overview",
  description: "Total usage, daily average and peak demand for the selected scope and period.",
  family: "overview",
  view_key: "consumption_overview_v1",
  target: "both",
  metric_revision_ids: ["energy.total_usage_kwh@1"],
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

const intent = {
  audience: "Energy and facilities managers",
  managementQuestion: "How much electricity did the portfolio use, and where should management look first?",
  sectionIntent: "Summarise total portfolio consumption before deeper diagnostic sections.",
  visualHierarchy: ["Lead with the consumption summary", "Keep evidence inspectable"],
  interactionIntent: ["Allow evidence inspection"],
  sourceRefs: ["reference.html#s1"],
  assumptions: ["The reference expresses presentation intent only."],
  unresolvedQuestions: ["Confirm the official aggregation route."],
};

const binding = {
  status: "bound",
  sectionKey: "portfolio-consumption",
  blockKey: "portfolio-consumption-summary",
  capabilityRevisionId: "overview.consumption@1",
  windowId: "current-overview",
  evidenceInputs: ["scope_summary_v1"],
  readiness: "partial",
  classification: "R",
  limitations: ["Official aggregation mapping is not present in the sanitized kit."],
};

const proposal = {
  contractRevision: "energyiq-overview-definition-change@1",
  title: "Add portfolio consumption summary",
  rationale: "Lead with trusted consumption before deeper diagnosis.",
  desiredDefinition: {
    contractRevision: "energyiq-overview-definition@1",
    timePolicyRevisionId: "m4-clean-room-report-time@1",
    sections: [{
      key: "portfolio-consumption",
      title: "Portfolio consumption",
      managementQuestion: intent.managementQuestion,
      primaryWindowId: "current-overview",
      supportingWindowIds: [],
      blocks: [{
        key: "portfolio-consumption-summary",
        capabilityRevisionId: "overview.consumption@1",
        windowId: "current-overview",
        emphasis: "primary",
      }],
    }],
  },
};

test("M4-R1 rejects a path or content fingerprint from a forbidden implementation", async () => {
  const root = await mkdtemp(join(tmpdir(), "m4-red-r1-"));
  try {
    const leaked = join(root, "apps", "web", "preschool-overview-renderer.tsx");
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await writeFile(leaked, "synthetic forbidden renderer sentinel", "utf8");
    await assert.rejects(
      assertSanitizedKit({ root, forbiddenContent: ["synthetic forbidden renderer sentinel"] }),
      expectCode("TRACER_INPUT_CONTAMINATED"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M4-R2 rejects Design Intent that leaks KPI values or implementation language", () => {
  assert.throws(
    () => validateDesignIntent({ ...intent, sectionIntent: "Render 24 KPI cards with React and CSS." }),
    expectCode("DESIGN_INTENT_IMPLEMENTATION_LEAK"),
  );
});

test("M4-R3 returns typed gaps instead of inventing an unknown Capability or Window", () => {
  const missingCapability = buildBindingPlan({ intent, catalog: [], policy });
  assert.deepEqual(missingCapability, {
    status: "gap",
    code: "CAPABILITY_REQUIRED",
    requestedFamily: "overview",
  });
  const missingWindow = buildBindingPlan({ intent, catalog, policy: { ...policy, windows: [] } });
  assert.deepEqual(missingWindow, {
    status: "gap",
    code: "WINDOW_UNKNOWN",
    requestedRole: "recent_operations",
  });
});

test("M4-R4 compiles identical input to byte-stable Definition, Template and Diff", async () => {
  const compiled = await compileDeterministically({ proposal, catalog, policy });
  assert.equal(compiled.stable, true);
  assert.match(compiled.definitionFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(compiled.firstBytes, compiled.secondBytes);
});

test("M4-R5 refuses an unpinned or side-effecting Active Draft Preview", () => {
  assert.throws(
    () => createOfflinePreview({
      proposal,
      compiledTemplate: {},
      fixedIdentity: { dataSnapshotId: "", projectReleaseId: "release-1" },
      counters: { publicationMutationCount: 0, providerRunCount: 0, queueRunCount: 0 },
      replay: { totalUsageKwh: 10 },
    }),
    expectCode("PREVIEW_IDENTITY_UNPINNED"),
  );
  assert.throws(
    () => createOfflinePreview({
      proposal,
      compiledTemplate: {},
      fixedIdentity: { dataSnapshotId: "snapshot-1", projectReleaseId: "release-1" },
      counters: { publicationMutationCount: 0, providerRunCount: 1, queueRunCount: 0 },
      replay: { totalUsageKwh: 10 },
    }),
    expectCode("PREVIEW_SIDE_EFFECT"),
  );
});

test("M4-R6 excludes attempts whose Definition fingerprint changes from deterministic replay", () => {
  assert.throws(
    () => validateReplayMatrix([
      { label: "Day01", definitionFingerprint: "same", result: "pass" },
      { label: "Day07", definitionFingerprint: "changed", result: "pass" },
      { label: "Day30", definitionFingerprint: "same", result: "pass" },
    ]),
    expectCode("RERUN_DESIGN_CHANGED"),
  );
});

test("M4-R7 never promotes a structured tracer preview to customer Renderer parity", () => {
  assert.throws(
    () => enforceCustomerRendererBoundary({
      previewRenderer: "m4-tracer-structured-preview",
      customerRendererParity: "proven",
    }),
    expectCode("CUSTOMER_RENDERER_PARITY_UNPROVEN"),
  );
});

test("M4-R8 rejects claims of third-project or G5 proof from a same-project replay", () => {
  assert.throws(
    () => enforceEvidenceScope({
      evidenceScope: "third-project-proof",
      conclusion: "This proves G5 cross-project reuse.",
    }),
    expectCode("EVIDENCE_SCOPE_OVERCLAIMED"),
  );
});

test("the Reference extractor preserves intent but drops embedded numbers and code", () => {
  const extracted = extractDesignIntentFromReference(`
    <section id="s1">
      <div class="section-title">Overall Consumption Summary</div>
      <p class="section-sub">Total portfolio energy and cost for May 2026 across all centres.</p>
      <script>const total = 24921.8;</script>
    </section>
  `);
  assert.equal(extracted.managementQuestion, "How much electricity did the portfolio use, and where should management look first?");
  assert.equal(extracted.sourceRefs[0], "reference.html#s1");
  assert.doesNotMatch(JSON.stringify(extracted), /(?:2026|24921|script|const total)/iu);
  assert.deepEqual(validateDesignIntent(extracted), extracted);
});

test("the source-level replay witness applies deterministic cumulative delta quality rules", () => {
  const replay = buildCumulativeReplayFromRows({
    label: "Day01",
    definitionFingerprint: "fingerprint",
    sourceSha256: "source",
    rows: [
      { sourceLabel: "A", timestamp: 0, reading: 100 },
      { sourceLabel: "A", timestamp: 15 * 60_000, reading: 103 },
      { sourceLabel: "A", timestamp: 30 * 60_000, reading: 102 },
      { sourceLabel: "B", timestamp: 0, reading: 50 },
      { sourceLabel: "B", timestamp: 15 * 60_000, reading: 54 },
    ],
  });
  assert.equal(replay.totalUsageKwh, 7);
  assert.equal(replay.validIntervalCount, 2);
  assert.equal(replay.qualityCounts.negative_delta, 1);
  assert.equal(replay.result, "pass");
});

test("the exit gate returns BLOCKED when official aggregation is absent", () => {
  const result = evaluateTracerExitGate({
    contaminationPassed: true,
    definitionStable: true,
    preview: {
      readiness: "partial",
      customerRendererParity: "unproven",
      dataWitness: { officialAggregationConfirmed: false },
      counters: { publicationMutationCount: 0, providerRunCount: 0, queueRunCount: 0 },
    },
    replayMatrix: { sameDefinition: true, attempts: [{ result: "pass" }, { result: "pass" }, { result: "pass" }] },
  });
  assert.deepEqual(result, {
    status: "M4-NIGHT-TRACER-BLOCKED",
    blockers: ["OFFICIAL_AGGREGATION_BINDING_UNAVAILABLE", "CUSTOMER_RENDERER_PARITY_UNPROVEN"],
    evidenceScope: "process-mechanics-only",
  });
});

test("the evidence admits controlled Preschool source inputs without claiming project implementation access", async () => {
  const testDirectory = new URL(".", import.meta.url);
  const evidenceDirectory = new URL(
    "../../../docs/energyiq/evidence/2026-08-20-m4-night-tracer-c4821a2/",
    import.meta.url,
  );
  const runner = await readFile(new URL("run.mjs", testDirectory), "utf8");
  const readme = await readFile(new URL("README.md", testDirectory), "utf8");
  const conclusion = await readFile(new URL("CONCLUSION.md", evidenceDirectory), "utf8");
  const testEvidence = await readFile(new URL("TEST-EVIDENCE.md", evidenceDirectory), "utf8");
  const ledger = await readFile(new URL("ledger/delivery-ledger.yaml", evidenceDirectory), "utf8");
  const manifest = JSON.parse(await readFile(new URL("manifest/input-manifest.json", evidenceDirectory), "utf8"));

  assert.match(runner, /docs", "template", "Preschool", "Energy_Report_May2026\.html/iu);
  assert.match(runner, /Preschool_June_2026_Day01\.incremental-cumulative\.xlsx/iu);
  assert.deepEqual(manifest.sourceBoundary, {
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
  });
  const recordedBoundary = [readme, conclusion, testEvidence, ledger].join("\n");
  assert.match(recordedBoundary, /controlled Preschool reference HTML/iu);
  assert.match(recordedBoundary, /synthetic(?:\/)acceptance workbooks/iu);
  assert.doesNotMatch(recordedBoundary, /No customer Renderer or Golden input/iu);
  assert.match(recordedBoundary, /does not read.*Renderer implementation/isu);
});

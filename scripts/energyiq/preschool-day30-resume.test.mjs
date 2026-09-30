import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  EXACT_DAY30_BATCH_ID,
  EXACT_RUN_ROOT,
  assertPathInsideRoot,
  validateResumeReport,
  verifyGeneratorManifest,
  verifyInspectedDay30Batch,
  verifySavedABaseline,
  verifySetupIdentity,
} from "./preschool-day30-resume.mjs";

const sha = (character) => character.repeat(64);
const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const reportFixture = () => ({
  contract: "preschool-continuous-ab-acceptance@1",
  status: "failed",
  root: EXACT_RUN_ROOT,
  currentPhase: { phase: "day30-materialize", batchId: EXACT_DAY30_BATCH_ID },
  inputs: {
    generatorManifest: "outputs/manifest.json",
    may: { sha256: sha("a") },
    stages: [{ id: "day30", days: 30, path: "outputs/day30.xlsx", sha256: sha("b") }],
  },
  stages: [{ id: "day1", snapshotId: "snapshot-1" }, { id: "day7", snapshotId: "snapshot-7" }],
  baseline: {
    snapshotId: "snapshot-a",
    savedAnalysisId: "saved-a",
    savedResponseSha256: sha("c"),
    mappingHash: sha("d"),
    release: { id: "release-a" },
  },
});

test("resume is pinned to the one original failed run and rejects a second attempt", () => {
  assert.equal(validateResumeReport(reportFixture()).root, EXACT_RUN_ROOT);
  assert.throws(() => validateResumeReport(reportFixture(), `${EXACT_RUN_ROOT}-other`), /RESUME_ROOT_MUST_MATCH_ORIGINAL/);
  const repeated = reportFixture();
  repeated.resumeAttempts = [{ status: "failed" }];
  assert.throws(() => validateResumeReport(repeated), /DAY30_RESUME_ALREADY_RECORDED/);
});

test("every writable runtime path must be a strict descendant of the original run root", () => {
  assert.match(assertPathInsideRoot(EXACT_RUN_ROOT, `${EXACT_RUN_ROOT}\\storage`), /storage$/);
  assert.throws(() => assertPathInsideRoot(EXACT_RUN_ROOT, EXACT_RUN_ROOT), /OUTSIDE_EXACT_RUN_ROOT/);
  assert.throws(() => assertPathInsideRoot(EXACT_RUN_ROOT, `${EXACT_RUN_ROOT}\\..\\other`), /OUTSIDE_EXACT_RUN_ROOT/);
});

test("generator manifest, report input and file bytes must identify the same Day30 workbook", () => {
  const report = reportFixture();
  const manifest = {
    generatorRevision: "preschool-june-ab-v1",
    outputs: [{ stageId: "day30", days: 30, path: "outputs/day30.xlsx", sha256: sha("b") }],
  };
  assert.equal(verifyGeneratorManifest(report, manifest, sha("b")).sha256, sha("b"));
  assert.throws(() => verifyGeneratorManifest(report, manifest, sha("e")), /GENERATOR_DAY30_SHA_MISMATCH/);
});

test("formal Import preflight accepts only the exact untouched inspected Day30 batch", () => {
  const payload = {
    batches: [{
      id: EXACT_DAY30_BATCH_ID,
      projectId: "preschool-demo",
      sourceSha256: sha("b"),
      status: "inspected",
    }],
  };
  assert.equal(verifyInspectedDay30Batch(payload, sha("b")).id, EXACT_DAY30_BATCH_ID);
  payload.batches[0].materializedAt = "2026-08-10T00:00:00.000Z";
  assert.throws(() => verifyInspectedDay30Batch(payload, sha("b")), /DAY30_BATCH_ALREADY_MATERIALIZED/);
});

test("setup preflight keeps exact May plus Day30 Source Manifest and baseline Mapping", () => {
  const report = reportFixture();
  const meterMapping = { confirmed: true, rows: [] };
  report.baseline.mappingHash = sha256Text(JSON.stringify(meterMapping));
  const setup = {
    draft: {
      document: {
        meter_mapping: meterMapping,
        source_manifest: { confirmed: true, source_sha256: [sha("a"), sha("b")] },
      },
    },
  };
  assert.doesNotThrow(() => verifySetupIdentity(setup, report, sha("b")));
  setup.draft.document.source_manifest.source_sha256.reverse();
  assert.throws(() => verifySetupIdentity(setup, report, sha("b")), /DAY30_SOURCE_MANIFEST_MISMATCH/);
});

test("Saved A validation requires exact bytes and original Snapshot A", () => {
  const report = reportFixture();
  const text = JSON.stringify({ dataSnapshotId: "snapshot-a" });
  report.baseline.savedResponseSha256 = sha256Text(text);
  const saved = { text, data: { dataSnapshotId: "snapshot-a" } };
  assert.doesNotThrow(() => verifySavedABaseline(saved, report, "snapshot-7"));
  assert.throws(() => verifySavedABaseline(saved, report, "snapshot-a"), /SAVED_A_CONTAINS_CURRENT_B/);
});

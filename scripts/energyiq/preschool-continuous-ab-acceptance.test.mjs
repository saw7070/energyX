import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  assertSnapshotEvidencePins,
  charlesSectionAvailability,
  detectCharlesSectionBlockers,
  makeStageManifestSha,
  releaseIdentity,
  replaceSourceManifest,
  validateAcceptanceRoot,
} from "./preschool-continuous-ab-acceptance.mjs";

test("source manifest replacement preserves mapping and keeps only May plus the current cumulative stage", () => {
  const document = {
    project: { name: "Preschool", timezone: "Asia/Singapore" },
    tiers: [{ id: "centre" }],
    nodes: [{ id: "centre-a" }],
    meter_mapping: { schema_version: 2, confirmed: true, rows: [{ id: "meter-a" }] },
    source_manifest: { source_sha256: ["old"], confirmed: true },
  };
  const shas = makeStageManifestSha("a".repeat(64), "b".repeat(64));
  const replaced = replaceSourceManifest(document, shas);

  assert.deepEqual(replaced.source_manifest.source_sha256, shas);
  assert.deepEqual(replaced.meter_mapping, document.meter_mapping);
  assert.notEqual(replaced, document);
  assert.deepEqual(document.source_manifest.source_sha256, ["old"]);
});

test("snapshot evidence validator rejects a value pinned to another Snapshot", () => {
  const snapshot = {
    context: { dataSnapshotId: "snapshot-b" },
    dataSnapshot: { id: "snapshot-b" },
    evidence: [{ id: "evidence:snapshot-a:summary" }],
  };
  assert.throws(
    () => assertSnapshotEvidencePins(snapshot, "snapshot-b"),
    /CURRENT_EVIDENCE_SNAPSHOT_MISMATCH/,
  );
});

test("release identity excludes mutable Source Manifest and Snapshot fields", () => {
  const snapshot = {
    projectRelease: {
      id: "release-a",
      templateRevisionId: "template-a",
      renderer: { key: "preschool-overview", version: "1" },
      recipe: { id: "energy-scope-analysis", version: "1" },
      hierarchyRevisionId: "hierarchy-a",
      meterMappingRevisionId: "mapping-a",
      meterFormulaRevisionId: "formula-a",
      metricRevisionIds: ["metric-a"],
      ruleRevisionIds: ["rule-a"],
      businessCalendarVersion: "calendar-a",
      tariffScheduleVersion: "tariff-a",
    },
    dataSnapshot: { id: "snapshot-b" },
  };
  assert.deepEqual(releaseIdentity(snapshot), {
    id: "release-a",
    templateRevisionId: "template-a",
    renderer: { key: "preschool-overview", version: "1" },
    recipe: { id: "energy-scope-analysis", version: "1" },
    hierarchyRevisionId: "hierarchy-a",
    meterMappingRevisionId: "mapping-a",
    meterFormulaRevisionId: "formula-a",
    metricRevisionIds: ["metric-a"],
    ruleRevisionIds: ["rule-a"],
    businessCalendarVersion: "calendar-a",
    tariffScheduleVersion: "tariff-a",
  });
});

test("acceptance root must be a new child of the dedicated scratch parent", () => {
  const valid = validateAcceptanceRoot(resolve(
    ".scratch",
    "t39-preschool-continuous-ab-acceptance",
    "test-run",
  ));
  assert.match(valid, /t39-preschool-continuous-ab-acceptance[\\/]test-run$/);
  assert.throws(
    () => validateAcceptanceRoot(resolve(".scratch", "other-run")),
    /ACCEPTANCE_ROOT_OUTSIDE_ALLOWED_PARENT/,
  );
});

test("Charles Section availability treats missing operational projections and actual-vs-plan as product blockers", () => {
  const availability = charlesSectionAvailability({
    preschoolBenchmark: { status: "provisional", period: { start: "2026-06-01" } },
    preschoolAppliances: { status: "unavailable", reason: { code: "PERIOD_UNSUPPORTED" } },
    preschoolOperational: { status: "unavailable", reason: { code: "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED" } },
  });
  assert.equal(availability.preschoolOperational.status, "unavailable");
  assert.equal(availability.planningOutlook.status, "unavailable");
  assert.deepEqual(detectCharlesSectionBlockers("day1", availability), [
    "day1:SECTION3_APPLIANCES_UNAVAILABLE",
    "day1:SECTION3_4_OPERATIONAL_UNAVAILABLE",
    "day1:SECTION5_PLANNING_UNAVAILABLE",
    "day1:SECTION5_ACTUAL_VS_PLAN_NOT_IMPLEMENTED",
  ]);
});

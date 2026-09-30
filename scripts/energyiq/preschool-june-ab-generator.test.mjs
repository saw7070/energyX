import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPreschoolDemoSnapshotPublicationPlan,
  generatePreschoolJuneAb,
  getSingaporeLocalParts,
  hashCanonicalReadings,
} from "./preschool-june-ab-generator.mjs";

function buildSeries({ label = "preschool-centre-g:Kitchen Plug Load", centre = "G", meter = "Kitchen Plug Load", terminal = 100 } = {}) {
  return {
    label,
    centre,
    meter,
    terminalCumulative: terminal,
    mayUsageByDay: new Map(Array.from({ length: 28 }, (_, index) => [
      index + 4,
      Array.from({ length: 24 }, (_, hour) => Number(`${index + 1}.${String(hour).padStart(2, "0")}`)),
    ])),
  };
}

test("creates stable Day1, Day7 and Day30 cumulative stages", () => {
  const series = [buildSeries()];
  const first = generatePreschoolJuneAb({ series });
  const second = generatePreschoolJuneAb({ series });

  assert.deepEqual(first.stages.map(({ days, readings, validation }) => ({
    days,
    readings: readings.length,
    intervals: validation.intervalCount,
    coverageTo: validation.coverageTo,
  })), [
    { days: 1, readings: 25, intervals: 24, coverageTo: "2026-06-02T00:00:00.000Z" },
    { days: 7, readings: 169, intervals: 168, coverageTo: "2026-06-08T00:00:00.000Z" },
    { days: 30, readings: 721, intervals: 720, coverageTo: "2026-07-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(
    first.stages.map(({ canonicalContentSha256 }) => canonicalContentSha256),
    second.stages.map(({ canonicalContentSha256 }) => canonicalContentSha256),
  );
  assert.equal(hashCanonicalReadings(first.stages[2].readings), first.stages[2].canonicalContentSha256);
});

test("uses a 28-day weekday baseline without random noise", () => {
  const result = generatePreschoolJuneAb({ series: [buildSeries({ centre: "X", meter: "Other" })] });
  const readings = result.stages[2].readings;
  const june1FirstHour = readings[1].intervalDelta;
  const june29FirstHour = readings[1 + 28 * 24].intervalDelta;
  const june2FirstHour = readings[1 + 24].intervalDelta;
  const june30FirstHour = readings[1 + 29 * 24].intervalDelta;

  assert.equal(june1FirstHour, june29FirstHour);
  assert.equal(june2FirstHour, june30FirstHour);
  assert.equal(result.baseline.strategy, "fixed-weekday-28-day-cycle");
});

test("applies only the three declared deterministic scenarios", () => {
  const result = generatePreschoolJuneAb({ series: [
    buildSeries({ label: "preschool-centre-a:Aircon 1", centre: "A", meter: "Aircon 1" }),
    buildSeries({ label: "preschool-centre-l:Other Lighting3", centre: "L", meter: "Other Lighting3" }),
    buildSeries({ label: "preschool-centre-g:Kitchen Plug Load", centre: "G", meter: "Kitchen Plug Load" }),
  ] });
  const stats = Object.fromEntries(result.scenarioStats.map((item) => [item.id, item]));

  assert.equal(stats["portfolio-aircon1-weekday-improvement"].matchedIntervalCount, 150);
  assert.equal(stats["centre-l-closed-hour-lighting-rise"].matchedIntervalCount, 36);
  assert.equal(stats["centre-g-latest-day-kitchen-spike"].matchedIntervalCount, 8);
  assert.ok(stats["portfolio-aircon1-weekday-improvement"].deltaKwh < 0);
  assert.equal(stats["centre-l-closed-hour-lighting-rise"].deltaKwh, 43.2);
  assert.ok(stats["centre-g-latest-day-kitchen-spike"].deltaKwh > 0);
});

test("applies scenario windows in Asia/Singapore local time across UTC boundaries", () => {
  assert.deepEqual(getSingaporeLocalParts("2026-06-23T16:00:00.000Z"), {
    year: 2026,
    month: 6,
    day: 24,
    hour: 0,
    weekday: "Wed",
  });

  const result = generatePreschoolJuneAb({ series: [
    buildSeries({ label: "preschool-centre-a:Aircon 1", centre: "A", meter: "Aircon 1" }),
    buildSeries({ label: "preschool-centre-l:Other Lighting3", centre: "L", meter: "Other Lighting3" }),
    buildSeries({ label: "preschool-centre-g:Kitchen Plug Load", centre: "G", meter: "Kitchen Plug Load" }),
  ] });
  const readingByKey = new Map(result.stages[2].readings.map((reading) => [
    `${reading.label}\u0000${reading.time}`,
    reading,
  ]));
  const scenarioIdsAt = (label, intervalEndUtc) => readingByKey.get(`${label}\u0000${intervalEndUtc}`).scenarioIds;

  assert.deepEqual(scenarioIdsAt("preschool-centre-a:Aircon 1", "2026-06-03 00:00:00 UTC"), []);
  assert.deepEqual(scenarioIdsAt("preschool-centre-a:Aircon 1", "2026-06-03 01:00:00 UTC"), [
    "portfolio-aircon1-weekday-improvement",
  ]);
  assert.deepEqual(scenarioIdsAt("preschool-centre-l:Other Lighting3", "2026-06-23 16:00:00 UTC"), []);
  assert.deepEqual(scenarioIdsAt("preschool-centre-l:Other Lighting3", "2026-06-23 17:00:00 UTC"), [
    "centre-l-closed-hour-lighting-rise",
  ]);
  assert.deepEqual(scenarioIdsAt("preschool-centre-g:Kitchen Plug Load", "2026-06-30 01:00:00 UTC"), []);
  assert.deepEqual(scenarioIdsAt("preschool-centre-g:Kitchen Plug Load", "2026-06-30 02:00:00 UTC"), [
    "centre-g-latest-day-kitchen-spike",
  ]);
});

test("rejects a missing May baseline day before generating a workbook", () => {
  const series = buildSeries();
  series.mayUsageByDay.delete(31);
  assert.throws(
    () => generatePreschoolJuneAb({ series: [series] }),
    /PRESCHOOL_JUNE_AB_MAY_DAY_REQUIRED/,
  );
});

test("publishes only May plus the authoritative complete June Demo source", () => {
  const plan = buildPreschoolDemoSnapshotPublicationPlan({
    maySource: {
      id: "may-complete",
      sha256: "a".repeat(64),
      coverageFrom: "2026-05-01",
      coverageToExclusive: "2026-06-01",
    },
    juneStageSources: [
      { id: "june-day1", days: 1, sha256: "b".repeat(64) },
      { id: "june-day7-first", days: 7, sha256: "c".repeat(64) },
      { id: "june-day7-second", days: 7, sha256: "d".repeat(64) },
      { id: "june-day30", days: 30, sha256: "e".repeat(64) },
    ],
    excludedSources: [{
      id: "july-controlled-fixture",
      sha256: "f".repeat(64),
      reason: "controlled-update-fixture",
    }],
  });

  assert.equal(plan.dataClassification, "demo_mock");
  assert.equal(plan.customerActual, false);
  assert.deepEqual(plan.sourceManifestSha256, ["a".repeat(64), "e".repeat(64)]);
  assert.deepEqual(plan.selectedSources.map(({ id }) => id), ["may-complete", "june-day30"]);
  assert.deepEqual(plan.supersededSources.map(({ id }) => id), [
    "june-day1",
    "june-day7-first",
    "june-day7-second",
  ]);
  assert.deepEqual(plan.excludedSources.map(({ id }) => id), ["july-controlled-fixture"]);
  assert.deepEqual(plan.coverage, {
    from: "2026-05-01",
    toExclusive: "2026-07-01",
  });
  assert.deepEqual(plan.reportEdition, {
    from: "2026-06-01",
    toExclusive: "2026-07-01",
    phase: "complete",
    comparisonFrom: "2026-05-01",
    comparisonToExclusive: "2026-06-01",
    outlookFrom: "2026-07-01",
    outlookToExclusive: "2026-08-01",
  });
});

test("fails closed when the complete June Demo source is absent or ambiguous", () => {
  const maySource = {
    id: "may-complete",
    sha256: "a".repeat(64),
    coverageFrom: "2026-05-01",
    coverageToExclusive: "2026-06-01",
  };
  assert.throws(
    () => buildPreschoolDemoSnapshotPublicationPlan({
      maySource,
      juneStageSources: [{ id: "june-day7", days: 7, sha256: "b".repeat(64) }],
    }),
    /PRESCHOOL_DEMO_COMPLETE_JUNE_SOURCE_REQUIRED/,
  );
  assert.throws(
    () => buildPreschoolDemoSnapshotPublicationPlan({
      maySource,
      juneStageSources: [
        { id: "june-day30-a", days: 30, sha256: "b".repeat(64) },
        { id: "june-day30-b", days: 30, sha256: "c".repeat(64) },
      ],
    }),
    /PRESCHOOL_DEMO_COMPLETE_JUNE_SOURCE_AMBIGUOUS/,
  );
});

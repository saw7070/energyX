import { createHash } from "node:crypto";

export const PRESCHOOL_JUNE_AB_GENERATOR_REVISION = "preschool-june-ab-v1";
export const PRESCHOOL_JUNE_AB_SEED = 20260810;
export const PRESCHOOL_JUNE_AB_STAGE_DAYS = Object.freeze([1, 7, 30]);
export const PRESCHOOL_PROJECT_TIMEZONE = "Asia/Singapore";
export const PRESCHOOL_DEMO_SNAPSHOT_PUBLICATION_CONTRACT = "preschool-demo-snapshot-publication@1";

const SINGAPORE_LOCAL_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRESCHOOL_PROJECT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export const PRESCHOOL_JUNE_AB_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "portfolio-aircon1-weekday-improvement",
    from: "2026-06-03",
    to: "2026-06-23",
    centres: "all",
    meter: "Aircon 1",
    hours: "08:00-18:00",
    weekdaysOnly: true,
    transform: "base * 0.90",
  }),
  Object.freeze({
    id: "centre-l-closed-hour-lighting-rise",
    from: "2026-06-24",
    to: "2026-06-29",
    centres: ["L"],
    meter: "Other Lighting3",
    hours: "00:00-06:00",
    weekdaysOnly: false,
    transform: "base + 1.2 kWh",
  }),
  Object.freeze({
    id: "centre-g-latest-day-kitchen-spike",
    from: "2026-06-30",
    to: "2026-06-30",
    centres: ["G"],
    meter: "Kitchen Plug Load",
    hours: "09:00-17:00",
    weekdaysOnly: false,
    transform: "max(base * 2.5, 0.35 kWh)",
  }),
]);

/**
 * Resolve the immutable source allow-list for the customer-facing Preschool
 * Demo Snapshot. Partial June stages remain acceptance evidence, but the
 * complete June source is the only June source allowed into the canonical
 * Snapshot manifest.
 */
export function buildPreschoolDemoSnapshotPublicationPlan({
  maySource,
  juneStageSources,
  excludedSources = [],
} = {}) {
  const may = requirePublicationSource(maySource, "PRESCHOOL_DEMO_MAY_SOURCE_INVALID");
  if (may.coverageFrom !== "2026-05-01" || may.coverageToExclusive !== "2026-06-01") {
    throw new Error("PRESCHOOL_DEMO_COMPLETE_MAY_COVERAGE_REQUIRED");
  }
  if (!Array.isArray(juneStageSources) || juneStageSources.length === 0) {
    throw new Error("PRESCHOOL_DEMO_JUNE_SOURCES_REQUIRED");
  }
  const juneSources = juneStageSources.map((source) => {
    const canonical = requirePublicationSource(source, "PRESCHOOL_DEMO_JUNE_SOURCE_INVALID");
    if (!Number.isInteger(source.days) || source.days < 1 || source.days > 30) {
      throw new Error(`PRESCHOOL_DEMO_JUNE_STAGE_DAYS_INVALID:${source.days}`);
    }
    return Object.freeze({ ...canonical, days: source.days });
  });
  const authoritativeJuneSources = juneSources.filter(({ days }) => days === 30);
  if (authoritativeJuneSources.length === 0) {
    throw new Error("PRESCHOOL_DEMO_COMPLETE_JUNE_SOURCE_REQUIRED");
  }
  if (authoritativeJuneSources.length !== 1) {
    throw new Error("PRESCHOOL_DEMO_COMPLETE_JUNE_SOURCE_AMBIGUOUS");
  }

  const authoritativeJune = authoritativeJuneSources[0];
  const excluded = excludedSources.map((source) => Object.freeze({
    ...requirePublicationSource(source, "PRESCHOOL_DEMO_EXCLUDED_SOURCE_INVALID"),
    reason: typeof source.reason === "string" && source.reason.trim()
      ? source.reason.trim()
      : "not-canonical-demo-source",
  }));
  const allIds = [may, ...juneSources, ...excluded].map(({ id }) => id);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("PRESCHOOL_DEMO_SOURCE_ID_DUPLICATE");
  }

  return Object.freeze({
    contract: PRESCHOOL_DEMO_SNAPSHOT_PUBLICATION_CONTRACT,
    dataClassification: "demo_mock",
    customerActual: false,
    timezone: PRESCHOOL_PROJECT_TIMEZONE,
    coverage: Object.freeze({ from: "2026-05-01", toExclusive: "2026-07-01" }),
    reportEdition: Object.freeze({
      from: "2026-06-01",
      toExclusive: "2026-07-01",
      phase: "complete",
      comparisonFrom: "2026-05-01",
      comparisonToExclusive: "2026-06-01",
      outlookFrom: "2026-07-01",
      outlookToExclusive: "2026-08-01",
    }),
    selectedSources: Object.freeze([
      Object.freeze({ ...may, role: "complete-may-comparison" }),
      Object.freeze({ ...authoritativeJune, role: "authoritative-complete-june" }),
    ]),
    supersededSources: Object.freeze(juneSources
      .filter(({ days }) => days < 30)
      .map((source) => Object.freeze({ ...source, reason: "superseded-by-complete-june" }))),
    excludedSources: Object.freeze(excluded),
    sourceManifestSha256: Object.freeze([may.sha256, authoritativeJune.sha256]),
  });
}

/**
 * Build a deterministic June cumulative-reading dataset from May hourly deltas.
 *
 * `series` entries must contain:
 * - label, centre, meter
 * - mayUsageByDay: Map<number, number[24]> for May 4..31
 * - terminalCumulative: May reading at 2026-06-01 00:00 UTC
 */
export function generatePreschoolJuneAb({
  series,
  stageDays = PRESCHOOL_JUNE_AB_STAGE_DAYS,
  revision = PRESCHOOL_JUNE_AB_GENERATOR_REVISION,
  seed = PRESCHOOL_JUNE_AB_SEED,
} = {}) {
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error("PRESCHOOL_JUNE_AB_SERIES_REQUIRED");
  }
  const normalizedStageDays = [...new Set(stageDays)].sort((left, right) => left - right);
  if (normalizedStageDays.some((days) => !Number.isInteger(days) || days < 1 || days > 30)) {
    throw new Error(`PRESCHOOL_JUNE_AB_STAGE_DAYS_INVALID:${stageDays.join(",")}`);
  }

  const sortedSeries = [...series].sort((left, right) => left.label.localeCompare(right.label));
  const labels = new Set();
  const readingsByStage = new Map(normalizedStageDays.map((days) => [days, []]));
  const scenarioStats = new Map(PRESCHOOL_JUNE_AB_SCENARIOS.map(({ id }) => [id, {
    id,
    matchedIntervalCount: 0,
    changedIntervalCount: 0,
    deltaKwh: 0,
  }]));

  for (const item of sortedSeries) {
    validateSeries(item, labels);
    let cumulative = round6(item.terminalCumulative);
    const boundary = Object.freeze({
      label: item.label,
      time: "2026-06-01 00:00:00 UTC",
      value: cumulative,
      intervalDelta: null,
      sourceMayDay: null,
      scenarioIds: Object.freeze([]),
    });
    for (const rows of readingsByStage.values()) rows.push(boundary);

    for (let juneDay = 1; juneDay <= 30; juneDay += 1) {
      const sourceMayDay = 4 + ((juneDay - 1) % 28);
      const sourceUsage = item.mayUsageByDay.get(sourceMayDay);
      if (!Array.isArray(sourceUsage) || sourceUsage.length !== 24) {
        throw new Error(`PRESCHOOL_JUNE_AB_MAY_DAY_REQUIRED:${item.label}:${sourceMayDay}`);
      }
      for (let hour = 0; hour < 24; hour += 1) {
        const base = finiteNonNegative(sourceUsage[hour], `${item.label}:${sourceMayDay}:${hour}`);
        const intervalStartUtc = new Date(Date.UTC(2026, 5, juneDay, hour, 0, 0));
        const transformed = applyScenarios({
          base,
          centre: item.centre,
          meter: item.meter,
          intervalStartUtc,
        });
        for (const scenarioId of transformed.scenarioIds) {
          const stats = scenarioStats.get(scenarioId);
          stats.matchedIntervalCount += 1;
          if (transformed.value !== base) stats.changedIntervalCount += 1;
          stats.deltaKwh = round6(stats.deltaKwh + transformed.value - base);
        }
        cumulative = round6(cumulative + transformed.value);
        const reading = Object.freeze({
          label: item.label,
          time: isoHour(juneDay, hour + 1),
          value: cumulative,
          intervalDelta: transformed.value,
          sourceMayDay,
          scenarioIds: Object.freeze(transformed.scenarioIds),
        });
        for (const days of normalizedStageDays) {
          if (juneDay <= days) readingsByStage.get(days).push(reading);
        }
      }
    }
  }

  const stages = normalizedStageDays.map((days) => {
    const readings = readingsByStage.get(days);
    const validation = validatePreschoolJuneStage({
      readings,
      expectedSeriesCount: sortedSeries.length,
      expectedDays: days,
      terminalByLabel: new Map(sortedSeries.map((item) => [item.label, round6(item.terminalCumulative)])),
    });
    return Object.freeze({
      days,
      stageId: `day${days}`,
      readings: Object.freeze(readings),
      canonicalContentSha256: hashCanonicalReadings(readings),
      validation: Object.freeze(validation),
    });
  });

  return Object.freeze({
    revision,
    seed,
    baseline: Object.freeze({
      strategy: "fixed-weekday-28-day-cycle",
      sourceMayDays: "May 4-31",
      mapping: "sourceMayDay = 4 + ((juneDay - 1) mod 28)",
    }),
    scenarios: PRESCHOOL_JUNE_AB_SCENARIOS,
    scenarioStats: Object.freeze([...scenarioStats.values()].map((value) => Object.freeze(value))),
    seriesCount: sortedSeries.length,
    stages: Object.freeze(stages),
  });
}

export function validatePreschoolJuneStage({
  readings,
  expectedSeriesCount,
  expectedDays,
  terminalByLabel,
}) {
  const expectedReadings = expectedSeriesCount * (1 + expectedDays * 24);
  const expectedIntervals = expectedSeriesCount * expectedDays * 24;
  if (readings.length !== expectedReadings) {
    throw new Error(`PRESCHOOL_JUNE_AB_READING_COUNT_INVALID:${readings.length}:${expectedReadings}`);
  }

  const uniqueKeys = new Set();
  const stateByLabel = new Map();
  let duplicateKeyCount = 0;
  let monotonicityViolationCount = 0;
  let negativeDeltaCount = 0;
  let gapCount = 0;
  let boundaryConflictCount = 0;
  let intervalCount = 0;
  let minimumTimestamp = Number.POSITIVE_INFINITY;
  let maximumTimestamp = Number.NEGATIVE_INFINITY;

  for (const reading of readings) {
    const key = `${reading.label}\u0000${reading.time}`;
    if (uniqueKeys.has(key)) duplicateKeyCount += 1;
    uniqueKeys.add(key);

    const timestamp = parseUtcText(reading.time);
    minimumTimestamp = Math.min(minimumTimestamp, timestamp);
    maximumTimestamp = Math.max(maximumTimestamp, timestamp);
    const state = stateByLabel.get(reading.label);
    if (!state) {
      const terminal = terminalByLabel.get(reading.label);
      if (reading.time !== "2026-06-01 00:00:00 UTC" || terminal === undefined || reading.value !== terminal) {
        boundaryConflictCount += 1;
      }
      stateByLabel.set(reading.label, { timestamp, value: reading.value, count: 1 });
      continue;
    }

    intervalCount += 1;
    if (timestamp - state.timestamp !== 60 * 60 * 1000) gapCount += 1;
    if (reading.value < state.value) monotonicityViolationCount += 1;
    const derivedDelta = round6(reading.value - state.value);
    if (derivedDelta < 0 || (reading.intervalDelta !== null && reading.intervalDelta < 0)) negativeDeltaCount += 1;
    state.timestamp = timestamp;
    state.value = reading.value;
    state.count += 1;
  }

  const seriesCount = stateByLabel.size;
  const perSeriesCountViolationCount = [...stateByLabel.values()]
    .filter(({ count }) => count !== 1 + expectedDays * 24).length;
  const coverageFrom = "2026-06-01T00:00:00.000Z";
  const coverageTo = new Date(Date.UTC(2026, 5, 1 + expectedDays, 0, 0, 0)).toISOString();
  const actualFrom = new Date(minimumTimestamp).toISOString();
  const actualTo = new Date(maximumTimestamp).toISOString();

  const validation = {
    expectedSeriesCount,
    seriesCount,
    expectedIntervals,
    intervalCount,
    expectedReadings,
    readingCount: readings.length,
    coverageFrom: actualFrom,
    coverageTo: actualTo,
    expectedCoverageFrom: coverageFrom,
    expectedCoverageTo: coverageTo,
    duplicateKeyCount,
    monotonicityViolationCount,
    negativeDeltaCount,
    gapCount,
    boundaryDuplicateCountWhenAppendedToMay: seriesCount,
    boundaryConflictCount,
    perSeriesCountViolationCount,
    orphanCount: 0,
    unmappedCount: 0,
  };

  const invalid = seriesCount !== expectedSeriesCount
    || intervalCount !== expectedIntervals
    || actualFrom !== coverageFrom
    || actualTo !== coverageTo
    || duplicateKeyCount !== 0
    || monotonicityViolationCount !== 0
    || negativeDeltaCount !== 0
    || gapCount !== 0
    || boundaryConflictCount !== 0
    || perSeriesCountViolationCount !== 0;
  if (invalid) throw new Error(`PRESCHOOL_JUNE_AB_INVARIANT_FAILED:${JSON.stringify(validation)}`);
  return validation;
}

export function hashCanonicalReadings(readings) {
  const hash = createHash("sha256");
  for (const reading of readings) {
    hash.update(reading.label);
    hash.update("\t");
    hash.update(reading.time);
    hash.update("\t");
    hash.update(reading.value.toFixed(6));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function toSpreadsheetRows(readings) {
  return [
    ["Device Name", "Time", "Active Energy"],
    ...readings.map(({ label, time, value }) => [label, time, value]),
  ];
}

export function getSingaporeLocalParts(intervalStartUtc) {
  const instant = intervalStartUtc instanceof Date ? intervalStartUtc : new Date(intervalStartUtc);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error(`PRESCHOOL_JUNE_AB_INTERVAL_START_INVALID:${intervalStartUtc}`);
  }
  const parts = Object.fromEntries(
    SINGAPORE_LOCAL_PARTS_FORMATTER.formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return Object.freeze({
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    weekday: parts.weekday,
  });
}

function validateSeries(item, labels) {
  if (!item || typeof item !== "object") throw new Error("PRESCHOOL_JUNE_AB_SERIES_INVALID");
  if (!item.label || !item.centre || !item.meter) {
    throw new Error(`PRESCHOOL_JUNE_AB_SERIES_IDENTITY_INVALID:${JSON.stringify(item)}`);
  }
  if (labels.has(item.label)) throw new Error(`PRESCHOOL_JUNE_AB_SERIES_DUPLICATE:${item.label}`);
  labels.add(item.label);
  finiteNonNegative(item.terminalCumulative, `${item.label}:terminal`);
  for (let day = 4; day <= 31; day += 1) {
    const usage = item.mayUsageByDay.get(day);
    if (!Array.isArray(usage) || usage.length !== 24) {
      throw new Error(`PRESCHOOL_JUNE_AB_MAY_DAY_REQUIRED:${item.label}:${day}`);
    }
  }
}

function applyScenarios({ base, centre, meter, intervalStartUtc }) {
  let value = base;
  const scenarioIds = [];
  const local = getSingaporeLocalParts(intervalStartUtc);
  const isJune2026 = local.year === 2026 && local.month === 6;
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(local.weekday);

  if (isJune2026 && meter === "Aircon 1" && local.day >= 3 && local.day <= 23 && isWeekday && local.hour >= 8 && local.hour < 18) {
    value = round6(value * 0.9);
    scenarioIds.push("portfolio-aircon1-weekday-improvement");
  }
  if (isJune2026 && centre === "L" && meter === "Other Lighting3" && local.day >= 24 && local.day <= 29 && local.hour >= 0 && local.hour < 6) {
    value = round6(value + 1.2);
    scenarioIds.push("centre-l-closed-hour-lighting-rise");
  }
  if (isJune2026 && centre === "G" && meter === "Kitchen Plug Load" && local.day === 30 && local.hour >= 9 && local.hour < 17) {
    value = round6(Math.max(value * 2.5, 0.35));
    scenarioIds.push("centre-g-latest-day-kitchen-spike");
  }
  return { value, scenarioIds };
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`PRESCHOOL_JUNE_AB_USAGE_INVALID:${label}:${value}`);
  }
  return number;
}

function requirePublicationSource(source, code) {
  if (!source || typeof source !== "object") throw new Error(code);
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const sha256 = typeof source.sha256 === "string" ? source.sha256.toLowerCase() : "";
  if (!id || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(code);
  return Object.freeze({
    id,
    sha256,
    ...(typeof source.coverageFrom === "string" ? { coverageFrom: source.coverageFrom } : {}),
    ...(typeof source.coverageToExclusive === "string"
      ? { coverageToExclusive: source.coverageToExclusive }
      : {}),
  });
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isoHour(day, hour) {
  const date = new Date(Date.UTC(2026, 5, day, hour, 0, 0));
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function parseUtcText(value) {
  const timestamp = Date.parse(value.replace(" UTC", "Z").replace(" ", "T"));
  if (!Number.isFinite(timestamp)) throw new Error(`PRESCHOOL_JUNE_AB_TIME_INVALID:${value}`);
  return timestamp;
}

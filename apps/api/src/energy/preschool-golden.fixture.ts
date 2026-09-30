import {
  type EnergyIntervalFactWrite,
  type EnergyNormalizedReadingWrite,
} from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";

export const PRESCHOOL_GOLDEN = {
  workspaceId: "preschool-demo-org",
  projectId: "preschool-demo",
  timezone: "Asia/Singapore",
  period: {
    localFrom: "2026-05-01",
    localToInclusive: "2026-05-31",
    usageKwh: 24_921.8123,
    averageDailyUsageKwh: 803.9294,
    nonOperatingSharePct: 12.45,
    centreCount: 30,
    circuitCount: 270,
  },
  centreA: {
    scopeId: "preschool-centre-a",
    usageKwh: 843.0985,
    circuitCount: 9,
  },
} as const;

const centreCodes = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
  "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
  "u", "v", "w", "x", "y", "z", "aa", "ab", "ac", "ad",
] as const;

const circuits = [
  ["aircon-1", "Aircon 1", "aircon"],
  ["aircon-2", "Aircon 2", "aircon"],
  ["heater", "Heater", "load"],
  ["living-area-plug-load", "Living Area Plug Load", "load"],
  ["kitchen-plug-load", "Kitchen Plug Load", "load"],
  ["plug-load3", "Plug Load3", "load"],
  ["living-room-lighting", "Living Room Lighting", "light"],
  ["kitchen-lighting", "Kitchen Lighting", "light"],
  ["other-lighting3", "Other Lighting3", "light"],
] as const;

// The production snapshot contains 200,880 hourly facts. The test fixture keeps
// one deterministic row per Circuit and local hour while preserving the Golden
// totals, topology, hour-of-day profile and operating/non-operating split.
const intervalCount = 24;
const nonOperatingIntervalCount = 8;
const operatingIntervalCount = intervalCount - nonOperatingIntervalCount;
const localStartMs = Date.UTC(2026, 4, 1);
const utcStartMs = Date.UTC(2026, 3, 30, 16);

export const materializePreschoolGoldenFixture = async (
  databasePath: string,
  metadataStore: MetadataStore,
  options: {
    transformIntervalFacts?: (facts: EnergyIntervalFactWrite[]) => EnergyIntervalFactWrite[];
    normalizedReadings?: EnergyNormalizedReadingWrite[];
  } = {},
) => {
  const intervalFacts: EnergyIntervalFactWrite[] = [];
  centreCodes.forEach((centreCode, centreIndex) => {
    const centreId = `preschool-centre-${centreCode}`;
    const centreUsage = centreUsageKwh(centreIndex);
    circuits.forEach(([circuitSlug, circuitName, category], circuitIndex) => {
      const meterPointId = `${centreId}-${circuitSlug}`;
      const circuitUsage = centreUsage * (circuitIndex === circuits.length - 1 ? 0.2 : 0.1);
      const nonOperatingUsage = circuitUsage * (PRESCHOOL_GOLDEN.period.nonOperatingSharePct / 100);
      const operatingUsage = circuitUsage - nonOperatingUsage;
      let activeEnergyKwh = 1_000 + centreIndex * 100 + circuitIndex * 10;
      for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
        const localTime = new Date(localStartMs + intervalIndex * 60 * 60_000);
        const localHour = localTime.getUTCHours();
        const isOperating = localHour >= 8;
        const usageKwh = isOperating
          ? operatingUsage / operatingIntervalCount
          : nonOperatingUsage / nonOperatingIntervalCount;
        const previousActiveEnergyKwh = activeEnergyKwh;
        activeEnergyKwh += usageKwh;
        const intervalStartMs = utcStartMs + intervalIndex * 60 * 60_000;
        intervalFacts.push({
          workspaceId: PRESCHOOL_GOLDEN.workspaceId,
          projectId: PRESCHOOL_GOLDEN.projectId,
          importBatchId: "preschool-golden-may-2026",
          resource: "electricity",
          meterPointId,
          scopeId: meterPointId,
          parentNodeId: centreId,
          sourceLabel: circuitName,
          category,
          meterRole: "component",
          intervalStart: new Date(intervalStartMs).toISOString(),
          intervalEnd: new Date(intervalStartMs + 60 * 60_000).toISOString(),
          elapsedMinutes: 60,
          activeEnergyKwh,
          previousActiveEnergyKwh,
          rawDeltaKwh: usageKwh,
          usageKwh,
          averageKw: usageKwh,
          qualityStatus: "ok",
          localDate: localTime.toISOString().slice(0, 10),
          localHour,
          dayType: [0, 6].includes(localTime.getUTCDay()) ? "weekend" : "weekday",
          isOperating,
          sourceFile: "preschool-golden-may-2026.fixture",
          sourceSha256: "preschool-golden-may-2026",
          sourceReadingKind: "interval_usage",
        });
      }
    });
  });

  return materializeTestProjectSnapshot({
    metadataStore,
    databasePath,
    workspaceId: PRESCHOOL_GOLDEN.workspaceId,
    projectId: PRESCHOOL_GOLDEN.projectId,
    timezone: "Asia/Singapore",
    batches: [{
      importBatchId: "preschool-golden-may-2026",
      sourceSha256: "preschool-golden-may-2026",
      rawReadings: [],
      normalizedReadings: options.normalizedReadings ?? [],
      intervalFacts: options.transformIntervalFacts?.(intervalFacts) ?? intervalFacts,
      qualityEvents: [],
    }],
  });
};

const centreUsageKwh = (centreIndex: number): number => {
  if (centreIndex === 0) return PRESCHOOL_GOLDEN.centreA.usageKwh;
  if (centreIndex === centreCodes.length - 1) return 830.2998;
  return 830.3005;
};

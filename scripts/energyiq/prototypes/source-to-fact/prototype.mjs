#!/usr/bin/env node

/**
 * PROTOTYPE — interactive shell for the Ngee Ann source-to-fact contract.
 * Run: npm run prototype:energy-source-facts
 */

import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { readSheet } from "read-excel-file/node";

import {
  SOURCE_ADAPTER_CONTRACT,
  buildSourceToFactSnapshot,
  registerImportBatch,
  summarizeMeterFacts
} from "./contract.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FILES = [
  resolve(ROOT, "data/raw_excel/Ngee Ann Poly Level 6 (21 April - 20 May).xlsx"),
  resolve(ROOT, "data/raw_excel/Ngee Ann Poly Level 6 (19 May - 17 June).xlsx")
];

const METER_POINTS = [
  meter("l6-total-light", "Total Office Light", "light", "total", true),
  meter("l6-total-load", "Total Office Load", "load", "total", true),
  meter("l6-light-left", "Office Light-Left: External", "light", "component", false),
  meter("l6-light-right", "Office Light-Right: Internal", "light", "component", false),
  meter("l6-load-1", "Office Load 1", "load", "component", false),
  meter("l6-load-2", "Office Load 2", "load", "component", false),
  meter("l6-load-3", "Office Load 3", "load", "component", false),
  meter("l6-load-4", "Office Load 4", "load", "component", false),
  meter("l6-load-5", "Office Load 5 Fan Isol 1/2", "load", "component", false),
  {
    meterPointId: "l6-virtual-load-12",
    scopeId: "level-6",
    displayName: "Virtual Load 12",
    resourceType: "electricity",
    businessCategory: "load",
    meterKind: "virtual",
    meterRole: "virtual",
    officialAggregation: false,
    unit: "kWh"
  }
];

const BINDINGS = [
  binding("Lvl 6 Total Office Light", "l6-total-light"),
  binding("Lvl 6 Total Office Load", "l6-total-load"),
  binding("Lvl 6 Office Light-Left: External", "l6-light-left"),
  binding("Lvl 6 Office Light-Right: Internal", "l6-light-right"),
  binding("Lvl 6 Office Load 1: L1P1-L3P6", "l6-load-1"),
  binding("Lvl 6 Office Load 2: L1P7-L3P12", "l6-load-2"),
  binding("Lvl 6 Office Load 3: L1P13-L3P18", "l6-load-3"),
  binding("Lvl 6 Office Load 4: L1P19-L3P24", "l6-load-4"),
  binding("Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2", "l6-load-5")
];

const FORMULAS = [
  {
    formulaId: "virtual-load-12-v1",
    outputMeterPointId: "l6-virtual-load-12",
    terms: [
      { meterPointId: "l6-load-1", coefficient: 1 },
      { meterPointId: "l6-load-2", coefficient: 1 }
    ]
  }
];

const state = {
  availableBatches: [],
  importedBatches: [],
  lastImportResult: undefined,
  view: "overview"
};

async function main() {
  output.write("Loading two real Ngee Ann Level 6 workbooks...\n");
  state.availableBatches = await Promise.all(FILES.map(loadExcelBatch));
  state.lastImportResult = registerBatch(state.availableBatches[0]);
  const requestedView = process.argv
    .find((argument) => argument.startsWith("--view="))
    ?.slice("--view=".length);
  if (["o", "v", "d", "e"].includes(requestedView)) state.view = requestedView;

  if (process.argv.includes("--demo")) {
    registerBatch(state.availableBatches[1]);
    render(false);
    return;
  }

  const terminal = createInterface({ input, output });
  try {
    while (true) {
      render(Boolean(output.isTTY));
      const command = (await terminal.question("\nChoose: ")).trim().toLowerCase();
      if (command === "q") break;
      if (command === "1") state.lastImportResult = registerBatch(state.availableBatches[0]);
      if (command === "2") state.lastImportResult = registerBatch(state.availableBatches[1]);
      if (command === "r") {
        const latest = state.importedBatches.at(-1) ?? state.availableBatches[0];
        state.lastImportResult = registerBatch(latest);
      }
      if (["o", "v", "d", "e"].includes(command)) state.view = command;
    }
  } finally {
    terminal.close();
  }
}

function registerBatch(batch) {
  const registered = registerImportBatch(state.importedBatches, batch);
  state.importedBatches = registered.batches;
  return registered.result;
}

function render(clear) {
  if (clear) console.clear();
  const snapshot = buildSnapshot(state.importedBatches);
  const totalLoad = official(snapshot, "load");
  const totalLight = official(snapshot, "light");
  const load1 = summarizeMeterFacts(snapshot, "l6-load-1");
  const load2 = summarizeMeterFacts(snapshot, "l6-load-2");
  const virtual = summarizeMeterFacts(snapshot, "l6-virtual-load-12");

  line("\x1b[1mPROTOTYPE — Ngee Ann source-to-fact contract\x1b[0m");
  line("Question: can Excel now and Tuya later share one traceable fact contract?");
  line("");
  line(`\x1b[1mState\x1b[0m`);
  line(`  View: ${viewName(state.view)}`);
  line(`  Imported batches: ${snapshot.importBatchIds.length} / ${state.availableBatches.length}`);
  line(`  Last import: ${state.lastImportResult?.status ?? "none"}`);
  line(`  Raw → canonical: ${snapshot.rawReadingCount.toLocaleString()} → ${snapshot.canonicalReadingCount.toLocaleString()}`);
  line(`  Same-value duplicates removed: ${snapshot.sameValueDuplicateCount.toLocaleString()}`);
  line(`  Overlap conflicts retained as evidence: ${snapshot.overlapConflictKeyCount.toLocaleString()} keys`);
  line(`  Publish state: ${snapshot.publishStatus}`);
  line("");

  if (state.view === "v") {
    renderVirtual(load1, load2, virtual, totalLoad);
  } else if (state.view === "d") {
    renderDataContract(snapshot);
  } else if (state.view === "e") {
    renderEdgeCases();
  } else {
    renderOverview(snapshot, totalLoad, totalLight, virtual);
  }

  line("");
  line("\x1b[1mCommands\x1b[0m");
  line("  [1] import Apr–May  [2] import overlapping May–Jun  [r] retry latest SHA");
  line("  [o] overview  [v] virtual meter  [d] adapter/evidence  [e] edge cases  [q] quit");
}

function renderOverview(snapshot, totalLoad, totalLight, virtual) {
  line("\x1b[1mOfficial Level 6 aggregation\x1b[0m");
  line(`  Load:  ${formatKwh(totalLoad?.usageValue)} from ${totalLoad?.meterPointIds.join(", ") ?? "no official meter"}`);
  line(`  Light: ${formatKwh(totalLight?.usageValue)} from ${totalLight?.meterPointIds.join(", ") ?? "no official meter"}`);
  line(`  All categories: ${formatKwh((totalLoad?.usageValue ?? 0) + (totalLight?.usageValue ?? 0))}`);
  line(`  Virtual Load 12 (analytical only): ${formatKwh(virtual.usageKwh)}`);
  line("  Virtual Load 12 is excluded from official totals, so no double counting occurs.");
  line("");
  line("\x1b[1mQuality\x1b[0m");
  line(`  Fact states: ${JSON.stringify(snapshot.qualityCounts)}`);
  line(`  Flags: ${JSON.stringify(snapshot.qualityFlags)}`);
}

function renderVirtual(load1, load2, virtual, totalLoad) {
  line("\x1b[1mVirtual Load 12 = Load 1 + Load 2\x1b[0m");
  line(`  Load 1: ${formatKwh(load1.usageKwh)} across ${load1.usableIntervalCount.toLocaleString()} intervals`);
  line(`  Load 2: ${formatKwh(load2.usageKwh)} across ${load2.usableIntervalCount.toLocaleString()} intervals`);
  line(`  Virtual: ${formatKwh(virtual.usageKwh)} across ${virtual.usableIntervalCount.toLocaleString()} intervals`);
  line(`  Formula check: ${formatKwh(load1.usageKwh + load2.usageKwh)}`);
  line(`  Official Total Office Load remains: ${formatKwh(totalLoad?.usageValue)}`);
  line(`  Incomplete virtual intervals: ${virtual.incompleteIntervalCount}`);
}

function renderDataContract(snapshot) {
  line("\x1b[1mSource Adapter seam\x1b[0m");
  line(`  Batch fields: ${SOURCE_ADAPTER_CONTRACT.batch.join(", ")}`);
  line(`  Reading fields: ${SOURCE_ADAPTER_CONTRACT.reading.join(", ")}`);
  line(`  Excel key: ${SOURCE_ADAPTER_CONTRACT.stableKeys.excel}`);
  line(`  Tuya key: ${SOURCE_ADAPTER_CONTRACT.stableKeys.tuya}`);
  line("");
  line("\x1b[1mEvidence pinned into the snapshot\x1b[0m");
  line(`  Setup: ${snapshot.evidence.setupRevisionId}`);
  line(`  Formula: ${snapshot.evidence.formulaRevisionId}`);
  line(`  Batch IDs: ${snapshot.evidence.sourceBatchIds.join(", ")}`);
  line(`  Canonical rule: ${snapshot.evidence.canonicalSelectionRule}`);
}

function renderEdgeCases() {
  const edge = buildSourceToFactSnapshot({
    batches: edgeCaseBatches(),
    bindings: [
      bindingFor("excel:edge-load-1", "edge-load-1"),
      bindingFor("excel:edge-load-2", "edge-load-2")
    ],
    meterPoints: [
      meter("edge-load-1", "Edge Load 1", "load", "component", false),
      meter("edge-load-2", "Edge Load 2", "load", "component", false),
      { ...meter("edge-virtual", "Edge Virtual", "load", "virtual", false), meterKind: "virtual" }
    ],
    formulas: [{
      formulaId: "edge-virtual-v1",
      outputMeterPointId: "edge-virtual",
      terms: [
        { meterPointId: "edge-load-1", coefficient: 1 },
        { meterPointId: "edge-load-2", coefficient: 1 }
      ]
    }]
  });
  const virtual = summarizeMeterFacts(edge, "edge-virtual");
  line("\x1b[1mSynthetic edge-case probe using the same pure contract\x1b[0m");
  line(`  Duplicate same-SHA batch: prevented by registerImportBatch (press [r] in the real-data state)`);
  line(`  Gap/irregular/reset/conflict flags: ${JSON.stringify(edge.qualityFlags)}`);
  line(`  Virtual incomplete intervals: ${virtual.incompleteIntervalCount}`);
  line("  Gap usage keeps its actual duration; reset usage is null; missing virtual input is never zero-filled.");
}

function buildSnapshot(batches) {
  return buildSourceToFactSnapshot({
    batches,
    bindings: BINDINGS,
    meterPoints: METER_POINTS,
    formulas: FORMULAS,
    setupRevisionId: "ngee-ann-setup-prototype-v1",
    formulaRevisionId: "ngee-ann-virtual-load-12-prototype-v1"
  });
}

async function loadExcelBatch(path) {
  const [file, rows] = await Promise.all([readFile(path), readSheet(path)]);
  const headers = rows[0].map(String);
  const expected = ["Device Name", "Time", "Active Energy"];
  if (headers.length !== expected.length || headers.some((header, index) => header !== expected[index])) {
    throw new Error(`Unexpected Excel headers in ${basename(path)}: ${headers.join(", ")}`);
  }
  const readings = rows.slice(1).map((row, index) => {
    const [deviceName, excelTime, activeEnergy] = row;
    if (typeof deviceName !== "string" || !(excelTime instanceof Date) || typeof activeEnergy !== "number") {
      throw new Error(`Invalid row ${index + 2} in ${basename(path)}.`);
    }
    const observedAt = singaporeWallTimeToUtc(excelTime);
    return {
      stableSourceKey: `excel:${deviceName.trim()}`,
      sourceLabel: deviceName.trim(),
      observedAt,
      cumulativeValue: activeEnergy,
      unit: "kWh",
      sourceRef: `${basename(path)}#row-${index + 2}`
    };
  });
  const sha = createHash("sha256").update(file).digest("hex");
  return {
    batchId: `excel-${sha.slice(0, 12)}`,
    sourceKind: "excel",
    sourceId: "ngee-ann-manual-excel",
    artifactSha256: sha,
    coverageEnd: readings.reduce(
      (latest, reading) => reading.observedAt > latest ? reading.observedAt : latest,
      readings[0].observedAt
    ),
    sourceName: basename(path),
    readings
  };
}

function singaporeWallTimeToUtc(excelDate) {
  const roundedLocalEpoch = Math.round(excelDate.getTime() / 60_000) * 60_000;
  return new Date(roundedLocalEpoch - 8 * 60 * 60 * 1_000).toISOString();
}

function edgeCaseBatches() {
  const first = {
    batchId: "edge-batch-old",
    sourceKind: "excel",
    sourceId: "edge-source",
    artifactSha256: "edge-old-sha",
    coverageEnd: "2026-01-01T01:00:00.000Z",
    readings: [
      raw("edge-load-1", "2026-01-01T00:00:00.000Z", 100, "old#1"),
      raw("edge-load-1", "2026-01-01T00:15:00.000Z", 101, "old#2"),
      raw("edge-load-1", "2026-01-01T00:45:00.000Z", 103, "old#3"),
      raw("edge-load-2", "2026-01-01T00:00:00.000Z", 200, "old#4"),
      raw("edge-load-2", "2026-01-01T00:15:00.000Z", 201, "old#5"),
      raw("edge-load-2", "2026-01-01T00:30:00.000Z", 10, "old#6")
    ]
  };
  const correction = {
    batchId: "edge-batch-new",
    sourceKind: "excel",
    sourceId: "edge-source",
    artifactSha256: "edge-new-sha",
    coverageEnd: "2026-01-02T00:00:00.000Z",
    readings: [raw("edge-load-1", "2026-01-01T00:15:00.000Z", 101.2, "new#1")]
  };
  return [first, correction];
}

function raw(sourceKey, observedAt, cumulativeValue, sourceRef) {
  return {
    stableSourceKey: `excel:${sourceKey}`,
    sourceLabel: sourceKey,
    observedAt,
    cumulativeValue,
    unit: "kWh",
    sourceRef
  };
}

function binding(label, meterPointId) {
  return bindingFor(`excel:${label}`, meterPointId);
}

function bindingFor(stableSourceKey, meterPointId) {
  return {
    sourceBindingId: `binding-${meterPointId}`,
    sourceKind: "excel",
    stableSourceKey,
    meterPointId
  };
}

function meter(meterPointId, displayName, businessCategory, meterRole, officialAggregation) {
  return {
    meterPointId,
    scopeId: "level-6",
    displayName,
    resourceType: "electricity",
    businessCategory,
    meterKind: "physical",
    meterRole,
    officialAggregation,
    unit: "kWh"
  };
}

function official(snapshot, category) {
  return snapshot.officialAggregation.find(
    (row) => row.scopeId === "level-6" && row.businessCategory === category
  );
}

function formatKwh(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)} kWh` : "n/a";
}

function viewName(view) {
  return ({ o: "overview", v: "virtual meter", d: "adapter and evidence", e: "edge cases" })[view] ?? view;
}

function line(value) {
  output.write(`${value}\n`);
}

await main();

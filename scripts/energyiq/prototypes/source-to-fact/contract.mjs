/**
 * PROTOTYPE — portable source-to-fact contract under evaluation.
 *
 * Question: can Excel today and Tuya API later produce the same traceable
 * cumulative-reading contract, interval facts, virtual facts and official
 * aggregation without coupling analysis code to either source?
 *
 * This module is deliberately pure. File/API I/O belongs to adapters.
 */

const VALUE_EPSILON = 1e-9;

export const SOURCE_ADAPTER_CONTRACT = Object.freeze({
  batch: [
    "batchId",
    "sourceKind",
    "sourceId",
    "artifactSha256",
    "coverageEnd",
    "readings"
  ],
  reading: [
    "stableSourceKey",
    "sourceLabel",
    "observedAt",
    "cumulativeValue",
    "unit",
    "sourceRef"
  ],
  stableKeys: {
    excel: "excel:<exact Device Name>",
    tuya: "tuya:<device_id>:<dp_code>"
  }
});

export function registerImportBatch(existingBatches, candidateBatch) {
  const duplicate = existingBatches.find(
    (batch) => batch.artifactSha256 === candidateBatch.artifactSha256
  );
  if (duplicate) {
    return {
      batches: existingBatches,
      result: {
        status: "duplicate_skipped",
        existingBatchId: duplicate.batchId,
        candidateBatchId: candidateBatch.batchId
      }
    };
  }
  return {
    batches: [...existingBatches, candidateBatch],
    result: { status: "accepted", batchId: candidateBatch.batchId }
  };
}

export function buildSourceToFactSnapshot({
  batches,
  bindings,
  meterPoints,
  formulas,
  expectedIntervalMinutes = 15,
  setupRevisionId = "prototype-setup-v1",
  formulaRevisionId = "prototype-formula-v1"
}) {
  const uniqueBatches = uniqueBy(batches, (batch) => batch.artifactSha256);
  const bindingBySourceKey = new Map(
    bindings.map((binding) => [bindingKey(binding.sourceKind, binding.stableSourceKey), binding])
  );
  const meterById = new Map(meterPoints.map((meter) => [meter.meterPointId, meter]));
  const structuralErrors = [];
  const mappedCandidates = [];
  const unknownSourceKeys = new Set();

  for (const batch of uniqueBatches) {
    for (const reading of batch.readings) {
      const binding = bindingBySourceKey.get(bindingKey(batch.sourceKind, reading.stableSourceKey));
      if (!binding) {
        unknownSourceKeys.add(`${batch.sourceKind}:${reading.stableSourceKey}`);
        continue;
      }
      if (!meterById.has(binding.meterPointId)) {
        structuralErrors.push(`Binding ${binding.sourceBindingId} references missing meter ${binding.meterPointId}.`);
        continue;
      }
      if (!Number.isFinite(reading.cumulativeValue) || !isIsoTimestamp(reading.observedAt)) {
        structuralErrors.push(`Invalid raw reading at ${reading.sourceRef}.`);
        continue;
      }
      mappedCandidates.push({
        ...reading,
        meterPointId: binding.meterPointId,
        batchId: batch.batchId,
        sourceKind: batch.sourceKind,
        sourceId: batch.sourceId,
        artifactSha256: batch.artifactSha256,
        coverageEnd: batch.coverageEnd
      });
    }
  }

  for (const sourceKey of [...unknownSourceKeys].sort()) {
    structuralErrors.push(`No published Source Binding for ${sourceKey}.`);
  }

  const canonicalResult = canonicalizeReadings(mappedCandidates);
  const physicalFacts = buildPhysicalIntervalFacts({
    readings: canonicalResult.readings,
    meterById,
    expectedIntervalMinutes,
    setupRevisionId
  });
  const virtualResult = buildVirtualIntervalFacts({
    physicalFacts,
    formulas,
    meterById,
    setupRevisionId,
    formulaRevisionId
  });
  structuralErrors.push(...virtualResult.errors);

  const allFacts = [...physicalFacts, ...virtualResult.facts];
  const officialAggregation = aggregateOfficialFacts(allFacts, meterPoints);
  const qualityCounts = countBy(allFacts, (fact) => fact.qualityStatus);
  const qualityFlags = countMany(allFacts.flatMap((fact) => fact.qualityFlags));

  return {
    contractVersion: "source-to-fact-prototype-v1",
    setupRevisionId,
    formulaRevisionId,
    importBatchIds: uniqueBatches.map((batch) => batch.batchId),
    artifactSha256s: uniqueBatches.map((batch) => batch.artifactSha256),
    rawReadingCount: uniqueBatches.reduce((total, batch) => total + batch.readings.length, 0),
    mappedCandidateCount: mappedCandidates.length,
    canonicalReadingCount: canonicalResult.readings.length,
    sameValueDuplicateCount: canonicalResult.sameValueDuplicateCount,
    overlapConflictKeyCount: canonicalResult.overlapConflictKeyCount,
    overlapConflictReadingCount: canonicalResult.overlapConflictReadingCount,
    physicalFacts,
    virtualFacts: virtualResult.facts,
    officialAggregation,
    qualityCounts,
    qualityFlags,
    publishStatus: structuralErrors.length === 0 ? "publishable_with_quality_warnings" : "blocked",
    structuralErrors,
    evidence: {
      sourceBatchIds: uniqueBatches.map((batch) => batch.batchId),
      sourceArtifactHashes: uniqueBatches.map((batch) => batch.artifactSha256),
      setupRevisionId,
      formulaRevisionId,
      canonicalSelectionRule: "latest coverageEnd, then lexical batchId",
      intervalRule: "adjacent cumulative readings; actual elapsed duration retained",
      officialAggregationRule: "only meter points explicitly marked officialAggregation=true"
    }
  };
}

export function summarizeMeterFacts(snapshot, meterPointId) {
  const facts = [...snapshot.physicalFacts, ...snapshot.virtualFacts].filter(
    (fact) => fact.meterPointId === meterPointId
  );
  const usable = facts.filter((fact) => Number.isFinite(fact.usageValue));
  return {
    meterPointId,
    usageKwh: round(usable.reduce((total, fact) => total + fact.usageValue, 0), 6),
    usableIntervalCount: usable.length,
    incompleteIntervalCount: facts.filter((fact) => fact.qualityFlags.includes("incomplete_inputs")).length,
    warningIntervalCount: facts.filter((fact) => fact.qualityStatus === "warning").length,
    invalidIntervalCount: facts.filter((fact) => fact.qualityStatus === "invalid").length,
    from: usable.at(0)?.intervalStart,
    to: usable.at(-1)?.intervalEnd
  };
}

function canonicalizeReadings(candidates) {
  const groups = groupBy(candidates, (reading) => `${reading.meterPointId}|${reading.observedAt}`);
  const readings = [];
  let sameValueDuplicateCount = 0;
  let overlapConflictKeyCount = 0;
  let overlapConflictReadingCount = 0;

  for (const group of groups.values()) {
    const values = uniqueBy(group, (reading) => reading.cumulativeValue)
      .map((reading) => reading.cumulativeValue);
    const isConflict = values.length > 1;
    if (isConflict) {
      overlapConflictKeyCount += 1;
      overlapConflictReadingCount += group.length;
    } else {
      sameValueDuplicateCount += Math.max(0, group.length - 1);
    }
    const selected = [...group].sort(compareCanonicalCandidates)[0];
    readings.push({
      ...selected,
      qualityFlags: isConflict ? ["overlap_conflict"] : [],
      sourceCandidates: group.map((reading) => ({
        batchId: reading.batchId,
        sourceRef: reading.sourceRef,
        cumulativeValue: reading.cumulativeValue
      }))
    });
  }

  readings.sort((left, right) => (
    left.meterPointId.localeCompare(right.meterPointId)
    || left.observedAt.localeCompare(right.observedAt)
  ));
  return {
    readings,
    sameValueDuplicateCount,
    overlapConflictKeyCount,
    overlapConflictReadingCount
  };
}

function compareCanonicalCandidates(left, right) {
  return right.coverageEnd.localeCompare(left.coverageEnd)
    || right.batchId.localeCompare(left.batchId);
}

function buildPhysicalIntervalFacts({ readings, meterById, expectedIntervalMinutes, setupRevisionId }) {
  const readingsByMeter = groupBy(readings, (reading) => reading.meterPointId);
  const facts = [];
  for (const [meterPointId, meterReadings] of readingsByMeter) {
    const meter = meterById.get(meterPointId);
    for (let index = 0; index < meterReadings.length; index += 1) {
      const current = meterReadings[index];
      const previous = meterReadings[index - 1];
      if (!previous) {
        facts.push({
          factId: factId(meterPointId, "boundary", current.observedAt),
          meterPointId,
          scopeId: meter.scopeId,
          resourceType: meter.resourceType,
          businessCategory: meter.businessCategory,
          meterKind: "physical",
          intervalStart: undefined,
          intervalEnd: current.observedAt,
          elapsedMinutes: undefined,
          usageValue: undefined,
          averageRate: undefined,
          unit: meter.unit,
          qualityStatus: "boundary",
          qualityFlags: ["boundary"],
          derivation: {
            setupRevisionId,
            currentSourceRef: current.sourceRef,
            currentBatchId: current.batchId
          }
        });
        continue;
      }

      const elapsedMinutes = (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / 60_000;
      const delta = current.cumulativeValue - previous.cumulativeValue;
      const qualityFlags = uniqueStrings([
        ...previous.qualityFlags,
        ...current.qualityFlags
      ]);
      let qualityStatus = qualityFlags.length > 0 ? "warning" : "ok";
      let usageValue = delta;

      if (delta < -VALUE_EPSILON) {
        qualityFlags.push("cumulative_reset_or_negative_delta");
        qualityStatus = "invalid";
        usageValue = undefined;
      } else if (elapsedMinutes > expectedIntervalMinutes + 0.1) {
        qualityFlags.push("gap");
        qualityStatus = "warning";
      } else if (elapsedMinutes < expectedIntervalMinutes - 0.1) {
        qualityFlags.push("irregular_interval");
        qualityStatus = "warning";
      }

      facts.push({
        factId: factId(meterPointId, previous.observedAt, current.observedAt),
        meterPointId,
        scopeId: meter.scopeId,
        resourceType: meter.resourceType,
        businessCategory: meter.businessCategory,
        meterKind: "physical",
        intervalStart: previous.observedAt,
        intervalEnd: current.observedAt,
        elapsedMinutes: round(elapsedMinutes, 6),
        usageValue: usageValue === undefined ? undefined : round(usageValue, 9),
        averageRate: usageValue === undefined || elapsedMinutes <= 0
          ? undefined
          : round(usageValue / (elapsedMinutes / 60), 9),
        unit: meter.unit,
        qualityStatus,
        qualityFlags: uniqueStrings(qualityFlags),
        derivation: {
          setupRevisionId,
          previousValue: previous.cumulativeValue,
          currentValue: current.cumulativeValue,
          previousSourceRef: previous.sourceRef,
          currentSourceRef: current.sourceRef,
          previousBatchId: previous.batchId,
          currentBatchId: current.batchId
        }
      });
    }
  }
  return facts;
}

function buildVirtualIntervalFacts({
  physicalFacts,
  formulas,
  meterById,
  setupRevisionId,
  formulaRevisionId
}) {
  const errors = [];
  const facts = [];
  const physicalByMeterAndInterval = new Map();
  for (const fact of physicalFacts) {
    if (!fact.intervalStart) continue;
    physicalByMeterAndInterval.set(`${fact.meterPointId}|${intervalKey(fact)}`, fact);
  }

  for (const formula of formulas) {
    const output = meterById.get(formula.outputMeterPointId);
    if (!output || output.meterKind !== "virtual") {
      errors.push(`Formula ${formula.formulaId} requires a virtual output meter.`);
      continue;
    }
    const inputMeters = formula.terms.map((term) => meterById.get(term.meterPointId));
    if (inputMeters.some((meter) => !meter)) {
      errors.push(`Formula ${formula.formulaId} references a missing input meter.`);
      continue;
    }
    if (inputMeters.some((meter) => meter.resourceType !== output.resourceType || meter.unit !== output.unit)) {
      errors.push(`Formula ${formula.formulaId} has incompatible resource types or units.`);
      continue;
    }

    const intervalKeys = new Set();
    for (const term of formula.terms) {
      for (const fact of physicalFacts) {
        if (fact.meterPointId === term.meterPointId && fact.intervalStart) {
          intervalKeys.add(intervalKey(fact));
        }
      }
    }

    for (const key of [...intervalKeys].sort()) {
      const inputs = formula.terms.map((term) => ({
        term,
        fact: physicalByMeterAndInterval.get(`${term.meterPointId}|${key}`)
      }));
      const missing = inputs.some(({ fact }) => !fact || !Number.isFinite(fact.usageValue));
      const representative = inputs.find(({ fact }) => fact)?.fact;
      if (!representative) continue;
      const qualityFlags = uniqueStrings(inputs.flatMap(({ fact }) => fact?.qualityFlags ?? []));
      if (missing) qualityFlags.push("incomplete_inputs");
      const usageValue = missing
        ? undefined
        : inputs.reduce((total, { term, fact }) => total + term.coefficient * fact.usageValue, 0);
      if (usageValue !== undefined && usageValue < -VALUE_EPSILON) {
        qualityFlags.push("negative_virtual_value");
      }
      const qualityStatus = missing
        ? "invalid"
        : qualityFlags.length > 0
          ? "warning"
          : "ok";
      facts.push({
        factId: factId(output.meterPointId, representative.intervalStart, representative.intervalEnd),
        meterPointId: output.meterPointId,
        scopeId: output.scopeId,
        resourceType: output.resourceType,
        businessCategory: output.businessCategory,
        meterKind: "virtual",
        intervalStart: representative.intervalStart,
        intervalEnd: representative.intervalEnd,
        elapsedMinutes: representative.elapsedMinutes,
        usageValue: usageValue === undefined ? undefined : round(usageValue, 9),
        averageRate: usageValue === undefined
          ? undefined
          : round(usageValue / (representative.elapsedMinutes / 60), 9),
        unit: output.unit,
        qualityStatus,
        qualityFlags: uniqueStrings(qualityFlags),
        derivation: {
          setupRevisionId,
          formulaRevisionId,
          formulaId: formula.formulaId,
          terms: inputs.map(({ term, fact }) => ({
            meterPointId: term.meterPointId,
            coefficient: term.coefficient,
            sourceFactId: fact?.factId
          }))
        }
      });
    }
  }
  return { facts, errors };
}

function aggregateOfficialFacts(facts, meterPoints) {
  const officialIds = new Set(
    meterPoints
      .filter((meter) => meter.officialAggregation === true)
      .map((meter) => meter.meterPointId)
  );
  const totals = new Map();
  for (const fact of facts) {
    if (!officialIds.has(fact.meterPointId) || !Number.isFinite(fact.usageValue)) continue;
    const key = `${fact.scopeId}|${fact.resourceType}|${fact.businessCategory}`;
    const current = totals.get(key) ?? {
      scopeId: fact.scopeId,
      resourceType: fact.resourceType,
      businessCategory: fact.businessCategory,
      usageValue: 0,
      meterPointIds: new Set(),
      factCount: 0
    };
    current.usageValue += fact.usageValue;
    current.meterPointIds.add(fact.meterPointId);
    current.factCount += 1;
    totals.set(key, current);
  }
  return [...totals.values()].map((value) => ({
    ...value,
    usageValue: round(value.usageValue, 6),
    meterPointIds: [...value.meterPointIds].sort()
  }));
}

function bindingKey(sourceKind, stableSourceKey) {
  return `${sourceKind}|${stableSourceKey}`;
}

function intervalKey(fact) {
  return `${fact.intervalStart}|${fact.intervalEnd}`;
}

function factId(meterPointId, start, end) {
  return `${meterPointId}|${start}|${end}`;
}

function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function uniqueBy(values, keyOf) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function countBy(values, keyOf) {
  const counts = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countMany(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

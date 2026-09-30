export type EnergyAiTypedEvidenceItem = {
  id: string;
  label: string;
  unit: string | null;
  values: Record<string, unknown>;
};

export type EnergyAiSqlEvidence = {
  columns: readonly string[];
  rows: readonly unknown[];
};

type NumericClaimRelation = {
  denominator: string[];
  numerator: string[];
};

type NumericClaim = {
  absoluteTolerance?: number;
  context: string;
  entityContext: string;
  precision: number;
  relation?: NumericClaimRelation;
  value: number;
};

type SqlDimension = { column: string | null; value: string };
type SqlNumericCell = {
  column: string | null;
  value: number;
  dimensions: SqlDimension[];
};

/**
 * Validates displayed numeric claims against one typed deterministic Evidence item
 * or one SQL row. A matching scalar elsewhere in the cited material is insufficient.
 */
export function energyAiNarrativeClaimsSupported(input: {
  narrative: string;
  evidence: readonly EnergyAiTypedEvidenceItem[];
  sqlEvidence: readonly EnergyAiSqlEvidence[];
  fallbackCentreReference?: string | null;
  knownCentreCodes?: readonly string[];
}): boolean {
  const knownCentreCodes = new Set((input.knownCentreCodes ?? [])
    .map((code) => code.trim().toLowerCase())
    .filter((code) => /^[a-z0-9][a-z0-9_-]{0,15}$/u.test(code)));
  const deterministic = input.evidence.flatMap((item) => collectTypedNumericEvidence(item.values)
    .map((cell) => ({ item, cell })));
  const sql = input.sqlEvidence.flatMap(({ columns, rows }) => collectSqlNumericEvidence(columns, rows));
  const centreReferences = namedCentreReferences(input.narrative, knownCentreCodes);
  if ([...centreReferences].some((reference) =>
    !input.evidence.some((item) => typedEvidenceSupportsCentre(item, reference))
    && !sql.some((cell) => sqlCellSupportsCentre(cell, reference)))) return false;
  return numericClaims(input.narrative).every((claim) =>
    deterministic.some(({ item, cell }) => numericMatches(claim, cell.value)
      && deterministicCellSupportsClaim(item, cell, claim, input.fallbackCentreReference ?? null, knownCentreCodes))
    || sql.some((cell) => numericMatches(claim, cell.value)
      && sqlCellSupportsClaim(cell, claim, input.fallbackCentreReference ?? null, knownCentreCodes)));
}

function namedCentreReferences(value: string, knownCentreCodes: ReadonlySet<string>): Set<string> {
  const references = new Set<string>();
  for (const introducer of value.matchAll(/\bcent(?:re|er)s?\s+/giu)) {
    let remainder = value.slice((introducer.index ?? 0) + introducer[0].length);
    const candidates: string[] = [];
    for (let count = 0; count < 16; count += 1) {
      const code = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}\b/u.exec(remainder)?.[0];
      if (!code) break;
      candidates.push(code);
      remainder = remainder.slice(code.length);
      const separator = /^(?:\s*,\s*(?:(?:and|&(?:amp;)?)\s+)?|\s+(?:and|&(?:amp;)?)\s+)/iu.exec(remainder)?.[0];
      if (!separator) break;
      remainder = remainder.slice(separator.length);
    }
    for (const candidate of candidates) {
      if (isProjectCentreCode(candidate, knownCentreCodes)) references.add(candidate.toLowerCase());
    }
  }
  return references;
}

function typedEvidenceSupportsCentre(item: EnergyAiTypedEvidenceItem, reference: string): boolean {
  const tokens: string[] = `${item.id} ${item.label} ${collectNamedCentreDimensions(item.values).join(" ")}`
    .toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  return tokens.includes(reference);
}

function sqlCellSupportsCentre(cell: SqlNumericCell, reference: string): boolean {
  return cell.dimensions.some((dimension) => {
    if (!dimension.column || !/(?:centre|center|parent_node|scope)/u.test(dimension.column.toLowerCase())) return false;
    const tokens: string[] = dimension.value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
    return tokens.includes(reference);
  });
}

function collectTypedNumericEvidence(
  value: unknown,
  field = "",
): Array<{ field: string | null; value: number }> {
  if (typeof value === "number") return Number.isFinite(value) ? [{ field: field || null, value }] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTypedNumericEvidence(item, field));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => collectTypedNumericEvidence(item, key));
  return [];
}

function collectSqlNumericEvidence(columns: readonly string[], rows: readonly unknown[]): SqlNumericCell[] {
  return rows.flatMap((row) => {
    if (Array.isArray(row)) {
      const dimensions = row.flatMap<SqlDimension>((value, columnIndex) => typeof value === "string"
        ? [{ column: columns[columnIndex] ?? null, value }]
        : []);
      return row.flatMap((value, columnIndex) => typeof value === "number" && Number.isFinite(value)
        ? [{ column: columns[columnIndex] ?? null, value, dimensions }]
        : []);
    }
    if (isRecord(row)) {
      const dimensions = Object.entries(row).flatMap<SqlDimension>(([column, value]) => typeof value === "string"
        ? [{ column, value }]
        : []);
      return Object.entries(row).flatMap(([column, value]) => typeof value === "number" && Number.isFinite(value)
        ? [{ column, value, dimensions }]
        : []);
    }
    return [];
  });
}

function numericClaims(value: string): NumericClaim[] {
  const nonBusinessRanges = dateTimeRanges(value);
  const digitClaims = [...value.matchAll(/(?<![A-Za-z0-9])[-+]?\d[\d,]*(?:\.\d+)?(?:(?=[xX]\b)|(?=×)|(?![A-Za-z0-9]))/gu)].flatMap((match) => {
    const token = match[0];
    const normalized = token.replaceAll(",", "");
    const parsed = Number(normalized);
    const start = match.index ?? 0;
    const end = start + token.length;
    if (nonBusinessRanges.some((range) => start >= range.start && end <= range.end)) return [];
    return Number.isFinite(parsed) ? [{
      context: numericUnitContext(value, start, end),
      entityContext: entityClauseAround(value, start, end),
      precision: normalized.includes(".") ? normalized.split(".")[1]!.length : 0,
      value: parsed,
    }] : [];
  });
  const lexicalFractionClaims = [...value.matchAll(
    /\b(?:(about|roughly|approximately|nearly|almost)\s+)?(a[\s\-‐‑‒–—]+quarter|one[\s\-‐‑‒–—]+quarter|a[\s\-‐‑‒–—]+half|one[\s\-‐‑‒–—]+half|half|a[\s\-‐‑‒–—]+third|one[\s\-‐‑‒–—]+third|two[\s\-‐‑‒–—]+thirds|three[\s\-‐‑‒–—]+quarters)\s+of\b/giu,
  )].map<NumericClaim>((match) => {
    const fraction = match[2]!.toLowerCase().replaceAll(/[\s\-‐‑‒–—]+/gu, " ");
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const isDuration = /^\s+(?:an?\s+)?hour\b/iu.test(value.slice(end));
    const fractionValue = lexicalFractionPercent(fraction);
    const claim: NumericClaim = {
      context: isDuration
        ? `${numericUnitContext(value, start, end)} minutes duration`
        : `${numericUnitContext(value, start, end)} percent share ratio`,
      entityContext: entityClauseAround(value, start, end),
      precision: 0,
      value: isDuration ? fractionValue * 0.6 : fractionValue,
    };
    if (match[1]) claim.absoluteTolerance = 2.5;
    if (!isDuration) claim.relation = lexicalFractionRelation(value, start, end);
    return claim;
  });
  const lexicalDurationClaims = [...value.matchAll(
    /\b(?:(about|roughly|approximately|nearly|almost)\s+)?(a[\s\-‐‑‒–—]+quarter|one[\s\-‐‑‒–—]+quarter|a[\s\-‐‑‒–—]+half|one[\s\-‐‑‒–—]+half|half|a[\s\-‐‑‒–—]+third|one[\s\-‐‑‒–—]+third|two[\s\-‐‑‒–—]+thirds|three[\s\-‐‑‒–—]+quarters)\s+(?:an?\s+)?hours?\b/giu,
  )].map<NumericClaim>((match) => {
    const fraction = match[2]!.toLowerCase().replaceAll(/[\s\-‐‑‒–—]+/gu, " ");
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const claim: NumericClaim = {
      context: `${numericUnitContext(value, start, end)} minutes duration`,
      entityContext: entityClauseAround(value, start, end),
      precision: 0,
      value: lexicalFractionPercent(fraction) * 0.6,
    };
    if (match[1]) claim.absoluteTolerance = 2.5;
    return claim;
  });
  return [...digitClaims, ...lexicalFractionClaims, ...lexicalDurationClaims];
}

function lexicalFractionPercent(fraction: string): number {
  const valueByFraction: Record<string, number> = {
    "a quarter": 25,
    "one quarter": 25,
    "a half": 50,
    "one half": 50,
    half: 50,
    "a third": 33.333333,
    "one third": 33.333333,
    "two thirds": 66.666667,
    "three quarters": 75,
  };
  return valueByFraction[fraction]!;
}

function lexicalFractionRelation(
  value: string,
  start: number,
  end: number,
): NumericClaimRelation {
  const before = value.slice(Math.max(0, start - 96), start)
    .split(/[,;.\n]|\b(?:and|but|however|while|whereas)\b/giu).at(-1) ?? "";
  const after = value.slice(end, Math.min(value.length, end + 96))
    .split(/[;.\n]|\b(?:but|however|while|whereas)\b/giu)[0] ?? "";
  const reversed = /^\s*(.+?)\b(?:occurs?|occurred|happens?|happened|is|was)\s+(?:mainly\s+)?during\s+(.+)$/iu.exec(after);
  if (reversed && semanticRelationTokens(before).length === 0) {
    return {
      numerator: semanticRelationTokens(reversed[2]!).slice(0, 3),
      denominator: semanticRelationTokens(reversed[1]!).slice(0, 3),
    };
  }
  return {
    numerator: semanticRelationTokens(before).slice(-3),
    denominator: semanticRelationTokens(after).slice(0, 3),
  };
}

function semanticRelationTokens(value: string): string[] {
  const stopWords = new Set([
    "a", "about", "account", "accounted", "accounts", "add", "adds", "almost", "an", "and", "approximately",
    "are", "as", "at", "be", "been", "being", "by", "comprise", "comprises", "dominate", "dominates",
    "center", "centre", "during", "for", "from", "in", "is", "it", "nearly", "occur", "occurred", "occurs",
    "of", "on", "overall", "portfolio", "represent",
    "represents", "roughly", "that", "the", "them", "this", "to", "total", "usage", "use", "was",
    "were", "with", "energy",
  ]);
  return semanticTokens(value).filter((token) => token.length > 2 && !stopWords.has(token));
}

function semanticTokens(value: string): string[] {
  return (value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9]+/gu) ?? [])
    .map((token) => token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
      ? token.slice(0, -1)
      : token);
}

function dateTimeRanges(value: string): Array<{ start: number; end: number }> {
  return [
    ...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu),
    ...value.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?\b/gu),
    ...value.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu),
  ].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function numericUnitContext(value: string, numberStart: number, numberEnd: number): string {
  const before = value.slice(Math.max(0, numberStart - 20), numberStart).toLowerCase();
  const after = value.slice(numberEnd, Math.min(value.length, numberEnd + 28)).toLowerCase();
  const explicitAfter = /^\s*(?:[xX]\b|×|%|percent(?:age)?|kwh|mwh|gwh|wh|kw|mw|gw|kilowatt[- ]?hours?|centres?|spikes?|events?|people|persons?|pax)/u.exec(after);
  const explicitBefore = /(?:[$€£]|\b(?:sgd|usd))\s*$/u.exec(before);
  return explicitAfter || explicitBefore
    ? `${explicitBefore?.[0] ?? ""} ${explicitAfter?.[0] ?? ""}`
    : `${before} ${after}`;
}

function entityClauseAround(value: string, numberStart: number, numberEnd: number): string {
  const boundaries = [...value.matchAll(/[.;\n]|\b(?:while|whereas|however|but)\b/giu)];
  const previous = boundaries.filter((boundary) => (boundary.index ?? 0) < numberStart).at(-1);
  const next = boundaries.find((boundary) => (boundary.index ?? value.length) >= numberEnd);
  const start = previous?.index === undefined ? 0 : previous.index + previous[0].length;
  const end = next?.index ?? value.length;
  return value.slice(start, end);
}

function numericMatches(claim: NumericClaim, evidence: number): boolean {
  const tolerance = claim.absoluteTolerance ?? (0.5 * (10 ** -claim.precision));
  return Math.abs(claim.value - evidence) <= tolerance + Number.EPSILON;
}

function deterministicCellSupportsClaim(
  item: EnergyAiTypedEvidenceItem,
  cell: { field: string | null; value: number },
  claim: NumericClaim,
  fallbackCentreReference: string | null,
  knownCentreCodes: ReadonlySet<string>,
): boolean {
  if (!sourceSupportsRelation([item.id, item.label, cell.field ?? ""], claim)) return false;
  const metricContext = `${claim.context} ${semanticMetricContext(claim.entityContext.toLowerCase())}`;
  if (!fieldSupportsClaim(cell.field, metricContext, item.unit)) return false;
  const centreReference = explicitCentreReference(claim.entityContext, knownCentreCodes) ?? fallbackCentreReference;
  if (!centreReference) return true;
  const dimensions: string[] = `${item.id} ${item.label} ${collectNamedCentreDimensions(item.values).join(" ")}`
    .toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  return dimensions.includes(centreReference);
}

function sqlCellSupportsClaim(
  cell: SqlNumericCell,
  claim: NumericClaim,
  fallbackCentreReference: string | null,
  knownCentreCodes: ReadonlySet<string>,
): boolean {
  if (!sourceSupportsRelation(sqlRelationSources(cell), claim)) return false;
  if (!fieldSupportsClaim(cell.column, `${claim.context} ${semanticMetricContext(claim.entityContext.toLowerCase())}`, null)) return false;
  const centreReference = explicitCentreReference(claim.entityContext, knownCentreCodes) ?? fallbackCentreReference;
  if (!centreReference) return true;
  return cell.dimensions.some((dimension) => {
    if (!dimension.column || !/(?:centre|center|parent_node|scope)/u.test(dimension.column.toLowerCase())) return false;
    const tokens: string[] = dimension.value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
    return tokens.includes(centreReference);
  });
}

function fieldSupportsClaim(field: string | null, context: string, itemUnit: string | null): boolean {
  const normalizedField = field?.toLowerCase() ?? "";
  if (/\b(?:x|times?|multiple|multiplier|factor)\b|×/u.test(context)) {
    return /ratio|multiple|multiplier|factor|fold|times?/u.test(normalizedField);
  }
  if (hasCurrencyUnit(context)) return /cost|amount|price|tariff|sgd|usd|currency/u.test(normalizedField);
  if (/\b(?:eui|kwh\s*(?:\/|per)\s*(?:m(?:²|2)|sqm|square metres?))\b/u.test(context)) {
    return /eui|kwh.*(?:m2|sqm)|(?:m2|sqm).*kwh/u.test(normalizedField);
  }
  if (/\bkwh\s*(?:\/|per)\s*(?:pax|people|persons?)\b|\bper[-_ ]?pax\b/u.test(context)) {
    return /per_?pax|pax|kwh.*person|person.*kwh/u.test(normalizedField);
  }
  if (/\b(?:minutes?|duration)\b/u.test(context)) {
    return /duration|minutes?|mins?/u.test(normalizedField)
      || /^(?:minutes?|mins?)$/u.test(itemUnit?.toLowerCase() ?? "");
  }
  const energyUnit = context.match(/\b(kwh|mwh|gwh|wh|kw|mw|gw|kilowatt[- ]?hours?)\b/u)?.[1];
  if (energyUnit) {
    const expected = energyUnit === "kwh" || energyUnit.startsWith("kilowatt") ? "kwh" : energyUnit;
    return normalizedField.includes(expected)
      || itemUnit?.toLowerCase() === expected && !/(?:count|pct|percent|share|rate|ratio)/u.test(normalizedField);
  }
  if (/%|\bpercent(?:age)?\b/u.test(context)) return /pct|percent|share|rate|ratio/u.test(normalizedField);
  if (/\bcentres?\b/u.test(context)) return /centre.*count|count.*centre/u.test(normalizedField);
  if (/\b(?:spikes?|events?)\b/u.test(context)) return /spike.*count|event.*count|count.*spike|count.*event/u.test(normalizedField);
  if (/\b(?:people|persons?|pax)\b/u.test(context)) return /pax|people|person|headcount/u.test(normalizedField);
  return true;
}

function sourceSupportsRelation(sources: readonly string[], claim: NumericClaim): boolean {
  if (!claim.relation) return true;
  if (claim.relation.numerator.length === 0 || claim.relation.denominator.length === 0) return false;
  return sources.some((source) => {
    const tokens = semanticTokens(source);
    const numeratorEnd = orderedTokenGroupEnd(tokens, claim.relation!.numerator, 0);
    return numeratorEnd !== -1
      && orderedTokenGroupEnd(tokens, claim.relation!.denominator, numeratorEnd) !== -1;
  });
}

function orderedTokenGroupEnd(source: readonly string[], expected: readonly string[], start: number): number {
  let cursor = start;
  for (const token of expected) {
    const index = source.indexOf(token, cursor);
    if (index === -1) return -1;
    cursor = index + 1;
  }
  return cursor;
}

function sqlRelationSources(cell: SqlNumericCell): string[] {
  const numeratorDimensions = cell.dimensions.filter(({ column }) =>
    /(?:period|state|schedule|time|hour|operating)/u.test(column?.toLowerCase() ?? ""));
  const denominatorDimensions = cell.dimensions.filter(({ column }) =>
    /(?:category|component|circuit|resource|load)/u.test(column?.toLowerCase() ?? ""));
  return [
    cell.column ?? "",
    ...numeratorDimensions.flatMap((numerator) => denominatorDimensions.map((denominator) =>
      `${numerator.value} share of ${denominator.value}`)),
  ];
}

function semanticMetricContext(entityContext: string): string {
  return [
    /[$€£]|\b(?:sgd|usd|cost|price|tariff|dollars?)\b/u.test(entityContext) ? "cost" : "",
    /\b(?:eui|kwh\s*(?:\/|per)\s*(?:m(?:²|2)|sqm|square metres?))\b/u.test(entityContext) ? "eui" : "",
    /\bkwh\s*(?:\/|per)\s*(?:pax|people|persons?)\b|\bper[-_ ]?pax\b/u.test(entityContext) ? "per-pax" : "",
  ].filter(Boolean).join(" ");
}

function collectNamedCentreDimensions(value: unknown, field = ""): string[] {
  if (typeof value === "string") {
    return /(?:centre|center|parent_node|scope)s?(?:_?(?:code|id|name)s?)?$/u.test(field.toLowerCase()) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectNamedCentreDimensions(item, field));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => collectNamedCentreDimensions(item, key));
  return [];
}

function explicitCentreReference(context: string, knownCentreCodes: ReadonlySet<string>): string | null {
  const references = new Set([...context.matchAll(/\bcent(?:re|er)\s+([a-z0-9][a-z0-9_-]{0,15})\b/giu)]
    .map((match) => match[1]!)
    .filter((reference) => isProjectCentreCode(reference, knownCentreCodes))
    .map((reference) => reference.toLowerCase()));
  if (references.size === 0) return null;
  if (references.size > 1) return "__ambiguous_centre__";
  return [...references][0]!;
}

function isProjectCentreCode(value: string, knownCentreCodes: ReadonlySet<string>): boolean {
  const normalized = value.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,15}$/u.test(normalized)) return false;
  if (knownCentreCodes.has(value.toLowerCase())) return true;
  if (/[0-9_-]/u.test(normalized)) return true;
  if (value === normalized) return normalized.length <= 8;
  return /^[a-z]$/u.test(value);
}

function hasCurrencyUnit(context: string): boolean {
  return /[$€£]|\b(?:sgd|usd|cost|price|tariff|dollars?)\b/u.test(context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

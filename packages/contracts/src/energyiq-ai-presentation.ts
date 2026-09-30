export type AiPresentationValueItem = {
  label: string;
  value: number;
};

export type AiPresentationEvidenceBinding = {
  evidenceRefs?: string[];
  evidenceSqlIndexes?: number[];
};

export type AiPresentationDisplayIntent = {
  prominence?: "primary" | "supporting";
};

export type AiPresentationBlock = AiPresentationEvidenceBinding & AiPresentationDisplayIntent & (
  | { type: "metric"; label: string; value: number; unit?: string; context?: string }
  | { type: "comparison" | "ranking" | "share" | "distribution"; title?: string; unit?: string; items: AiPresentationValueItem[] }
  | { type: "trend"; title?: string; unit?: string; points: AiPresentationValueItem[] }
  | { type: "heatmap"; title?: string; unit?: string; xLabels: string[]; yLabels: string[]; values: number[][] }
  | { type: "table"; title?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: "callout"; tone: "insight" | "caution" | "positive" | "neutral"; text: string }
);

export type AiFindingPresentation = {
  version: "1";
  blocks: AiPresentationBlock[];
};

const MAX_BLOCKS = 8;
const MAX_EVIDENCE_SOURCES = 16;
const MAX_SERIES_ITEMS = 12;
const MAX_TREND_POINTS = 31;
const MAX_TABLE_COLUMNS = 6;
const MAX_TABLE_ROWS = 12;
const MAX_HEATMAP_COLUMNS = 24;
const MAX_HEATMAP_ROWS = 12;

/**
 * Materializes the versioned, non-executable AI Finding presentation contract.
 * Invalid blocks fail locally; quantitative blocks require their own Evidence binding.
 */
export function parseAiFindingPresentation(value: unknown): AiFindingPresentation | null {
  if (!isRecord(value) || value.version !== "1" || !Array.isArray(value.blocks)) return null;
  const blocks = value.blocks.slice(0, MAX_BLOCKS).flatMap<AiPresentationBlock>(parseBlock);
  return blocks.length > 0 ? { version: "1", blocks } : null;
}

export function filterAiFindingPresentationEvidence(
  presentation: AiFindingPresentation | null | undefined,
  scope: { evidenceRefs: readonly string[]; evidenceSqlIndexes: readonly number[] },
): AiFindingPresentation | null {
  if (!presentation) return null;
  const allowedRefs = new Set(scope.evidenceRefs);
  const allowedSqlIndexes = new Set(scope.evidenceSqlIndexes);
  const blocks = presentation.blocks.filter((block) => (
    (block.evidenceRefs ?? []).every((reference) => allowedRefs.has(reference))
    && (block.evidenceSqlIndexes ?? []).every((index) => allowedSqlIndexes.has(index))
  ));
  return blocks.length > 0 ? { version: "1", blocks } : null;
}

function parseBlock(value: unknown): AiPresentationBlock[] {
  if (!isRecord(value)) return [];
  const displayIntent = parseDisplayIntent(value);
  if (!displayIntent) return [];
  const type = text(value.type, 40);
  if (type === "metric") {
    const binding = parseEvidenceBinding(value, true);
    const label = text(value.label, 120);
    const metricValue = finiteNumber(value.value);
    if (!binding || !label || metricValue === null) return [];
    const unit = optionalText(value.unit, 32);
    const context = optionalText(value.context, 180);
    return [{ type, label, value: metricValue, ...binding, ...displayIntent, ...(unit ? { unit } : {}), ...(context ? { context } : {}) }];
  }
  if (type === "comparison" || type === "ranking" || type === "share" || type === "distribution") {
    const binding = parseEvidenceBinding(value, true);
    const items = parseValueItems(value.items, type === "comparison" ? 2 : 1, MAX_SERIES_ITEMS);
    if (!binding || !items) return [];
    const title = optionalText(value.title, 160);
    const unit = optionalText(value.unit, 32);
    return [{ type, items, ...binding, ...displayIntent, ...(title ? { title } : {}), ...(unit ? { unit } : {}) }];
  }
  if (type === "trend") {
    const binding = parseEvidenceBinding(value, true);
    const points = parseValueItems(value.points, 2, MAX_TREND_POINTS);
    if (!binding || !points) return [];
    const title = optionalText(value.title, 160);
    const unit = optionalText(value.unit, 32);
    return [{ type, points, ...binding, ...displayIntent, ...(title ? { title } : {}), ...(unit ? { unit } : {}) }];
  }
  if (type === "heatmap") {
    const binding = parseEvidenceBinding(value, true);
    const title = optionalText(value.title, 160);
    const unit = optionalText(value.unit, 32);
    const xLabels = stringList(value.xLabels, MAX_HEATMAP_COLUMNS, 80);
    const yLabels = stringList(value.yLabels, MAX_HEATMAP_ROWS, 80);
    if (!binding || !xLabels || !yLabels || !Array.isArray(value.values) || value.values.length !== yLabels.length) return [];
    const values = value.values.flatMap<number[]>((row) => {
      if (!Array.isArray(row) || row.length !== xLabels.length) return [];
      const parsed = row.map(finiteNumber);
      return parsed.some((candidate) => candidate === null) ? [] : [parsed as number[]];
    });
    if (values.length !== yLabels.length) return [];
    return [{ type, xLabels, yLabels, values, ...binding, ...displayIntent, ...(title ? { title } : {}), ...(unit ? { unit } : {}) }];
  }
  if (type === "table") {
    const title = optionalText(value.title, 160);
    const columns = stringList(value.columns, MAX_TABLE_COLUMNS, 80);
    if (!columns || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_TABLE_ROWS) return [];
    const rows = value.rows.flatMap<Array<string | number>>((row) => {
      if (!Array.isArray(row) || row.length !== columns.length) return [];
      const cells = row.flatMap<string | number>((cell) => {
        const numeric = finiteNumber(cell);
        if (numeric !== null) return [numeric];
        const label = text(cell, 120);
        return label ? [label] : [];
      });
      return cells.length === columns.length ? [cells] : [];
    });
    if (rows.length !== value.rows.length) return [];
    const binding = parseEvidenceBinding(value, rows.some((row) => row.some((cell) => typeof cell === "number")));
    if (!binding) return [];
    return [{ type, columns, rows, ...binding, ...displayIntent, ...(title ? { title } : {}) }];
  }
  if (type === "callout") {
    const tone = text(value.tone, 20);
    const calloutText = text(value.text, 320);
    const binding = parseEvidenceBinding(value, Boolean(calloutText && /\d/u.test(calloutText)));
    if (!binding || !calloutText || (tone !== "insight" && tone !== "caution" && tone !== "positive" && tone !== "neutral")) return [];
    return [{ type, tone, text: calloutText, ...binding, ...displayIntent }];
  }
  return [];
}

function parseDisplayIntent(value: Record<string, unknown>): AiPresentationDisplayIntent | null {
  if (value.prominence === undefined || value.prominence === null) return {};
  return value.prominence === "primary" || value.prominence === "supporting"
    ? { prominence: value.prominence }
    : null;
}

function parseEvidenceBinding(
  value: Record<string, unknown>,
  required: boolean,
): AiPresentationEvidenceBinding | null {
  const evidenceRefs = optionalStringList(value.evidenceRefs, MAX_EVIDENCE_SOURCES, 160);
  const evidenceSqlIndexes = optionalPositiveIntegerList(value.evidenceSqlIndexes, MAX_EVIDENCE_SOURCES);
  if (evidenceRefs === null || evidenceSqlIndexes === null) return null;
  if (required && evidenceRefs.length === 0 && evidenceSqlIndexes.length === 0) return null;
  return {
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
    ...(evidenceSqlIndexes.length > 0 ? { evidenceSqlIndexes } : {}),
  };
}

function parseValueItems(value: unknown, minimum: number, maximum: number): AiPresentationValueItem[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const items = value.flatMap<AiPresentationValueItem>((candidate) => {
    if (!isRecord(candidate)) return [];
    const label = text(candidate.label, 100);
    const itemValue = finiteNumber(candidate.value);
    return label && itemValue !== null ? [{ label, value: itemValue }] : [];
  });
  return items.length === value.length ? items : null;
}

function optionalStringList(value: unknown, maximum: number, itemMaximum: number): string[] | null {
  if (value === undefined) return [];
  return stringList(value, maximum, itemMaximum, true);
}

function stringList(value: unknown, maximum: number, itemMaximum: number, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) return null;
  const items = value.flatMap((candidate) => {
    const item = text(candidate, itemMaximum);
    return item ? [item] : [];
  });
  return items.length === value.length ? [...new Set(items)] : null;
}

function optionalPositiveIntegerList(value: unknown, maximum: number): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) return null;
  const items = value.filter((candidate): candidate is number => (
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0
  ));
  return items.length === value.length ? [...new Set(items)] : null;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return value === undefined || value === null ? undefined : text(value, maximum) ?? undefined;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { createHash } from "node:crypto";
import { z } from "zod";

export const TRUSTED_ENERGY_TEXT_INTENTS = [
  "period-usage-vs-previous",
  "historical-normal-level",
  "day-type-pattern",
  "top-peer-scope",
  "normalised-performance",
  "top-circuit-contribution",
  "category-breakdown",
  "peak-and-contributors",
  "non-operating-usage",
  "priority-actions"
] as const;

export type TrustedEnergyTextIntent = typeof TRUSTED_ENERGY_TEXT_INTENTS[number];

/** Allowlisted primary and supporting Metrics for each deterministic Snapshot intent. */
export const TRUSTED_ENERGY_TEXT_INTENT_METRICS = {
  "period-usage-vs-previous": ["energy.total_usage_kwh"],
  "historical-normal-level": ["energy.total_usage_kwh"],
  "day-type-pattern": ["energy.total_usage_kwh"],
  "top-peer-scope": ["energy.total_usage_kwh"],
  "normalised-performance": ["energy.usage_per_sqm", "energy.usage_per_person"],
  "top-circuit-contribution": ["energy.total_usage_kwh"],
  "category-breakdown": ["energy.total_usage_kwh"],
  "peak-and-contributors": ["energy.peak_demand_kw", "energy.total_usage_kwh"],
  "non-operating-usage": ["energy.off_hours_usage_kwh", "energy.off_hours_share_pct"],
  "priority-actions": [
    "energy.total_usage_kwh",
    "energy.off_hours_usage_kwh",
    "energy.off_hours_share_pct",
    "energy.peak_demand_kw"
  ]
} as const satisfies Record<TrustedEnergyTextIntent, readonly string[]>;

const primaryMetricsByIntent = {
  "period-usage-vs-previous": ["energy.total_usage_kwh"],
  "historical-normal-level": ["energy.total_usage_kwh"],
  "day-type-pattern": ["energy.total_usage_kwh"],
  "top-peer-scope": ["energy.total_usage_kwh"],
  "normalised-performance": ["energy.usage_per_sqm", "energy.usage_per_person"],
  "top-circuit-contribution": ["energy.total_usage_kwh"],
  "category-breakdown": ["energy.total_usage_kwh"],
  "peak-and-contributors": ["energy.peak_demand_kw"],
  "non-operating-usage": ["energy.off_hours_usage_kwh", "energy.off_hours_share_pct"],
  "priority-actions": ["energy.total_usage_kwh"]
} as const satisfies Record<TrustedEnergyTextIntent, readonly string[]>;

const snapshotSelectorByIntent = {
  "period-usage-vs-previous": "analysis.summary+analysis.comparison",
  "historical-normal-level": "analysis.baseline",
  "day-type-pattern": "analysis.dayTypeProfile",
  "top-peer-scope": "analysis.childScopes",
  "normalised-performance": "analysis.childScopes.normalised",
  "top-circuit-contribution": "analysis.topCircuits",
  "category-breakdown": "analysis.categories",
  "peak-and-contributors": "analysis.summary.peak+analysis.topCircuits",
  "non-operating-usage": "analysis.offHours",
  "priority-actions": "findings+dataQuality"
} as const satisfies Record<TrustedEnergyTextIntent, string>;

const identifierSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const factValueSchema = z.union([z.string().trim().min(1).max(2_000), z.number().finite()]);
const metricSchema = z.object({
  id: identifierSchema,
  label: identifierSchema,
  unit: identifierSchema,
  revisionId: identifierSchema
}).strict();
const physicalSchemaIdentitySchema = z.object({
  schemaId: identifierSchema.optional(),
  tables: z.array(z.object({
    schema: identifierSchema.optional(),
    name: identifierSchema
  }).strict()).min(1).max(64)
}).strict();
const sourcePinSchema = z.object({
  datasourceId: identifierSchema,
  datasourceRevision: identifierSchema,
  physicalSchema: physicalSchemaIdentitySchema
}).strict();
const evidenceRefSchema = z.object({
  id: identifierSchema,
  metricId: identifierSchema,
  metricRevisionId: identifierSchema,
  dataSnapshotId: identifierSchema
}).strict();
const expectedFactSchema = z.object({
  id: identifierSchema,
  label: identifierSchema,
  metricId: identifierSchema,
  metricRevisionId: identifierSchema,
  value: factValueSchema,
  unit: identifierSchema.optional(),
  tolerance: z.number().finite().nonnegative().optional(),
  evidenceRefIds: z.array(identifierSchema).min(1).max(64)
}).strict();
const trustedEnergyTextRequestSchema = z.object({
  kind: z.literal("trusted-energy-text"),
  intent: z.enum(TRUSTED_ENERGY_TEXT_INTENTS),
  context: z.object({
    sourcePin: sourcePinSchema,
    project: z.object({ id: identifierSchema, name: identifierSchema }).strict(),
    scope: z.object({ id: identifierSchema, name: identifierSchema, type: identifierSchema }).strict(),
    period: z.object({
      label: identifierSchema,
      start: timestampSchema,
      endExclusive: timestampSchema,
      timezone: identifierSchema.refine(isTimeZone, { message: "Invalid IANA timezone." })
    }).strict(),
    metric: metricSchema,
    supportingMetrics: z.array(metricSchema).max(8),
    dataSnapshotId: identifierSchema,
    dataAsOf: timestampSchema,
    evidenceRefs: z.array(evidenceRefSchema).min(1).max(64),
    expectedFacts: z.array(expectedFactSchema).min(1).max(64)
  }).strict()
}).strict();

export type TrustedEnergyTextRequest = z.infer<typeof trustedEnergyTextRequestSchema>;
export type TrustedEnergyPhysicalSchemaIdentity = z.infer<typeof physicalSchemaIdentitySchema>;

export type TrustedEnergyTextQueryContract = {
  kind: "trusted-energy-text-query";
  id: string;
  intent: TrustedEnergyTextIntent;
  source: "project-analysis-snapshot";
  selector: typeof snapshotSelectorByIntent[TrustedEnergyTextIntent];
  pins: TrustedEnergyTextRequest["context"];
};

const resultClaimSchema = z.object({
  factId: identifierSchema,
  value: factValueSchema,
  evidenceRefIds: z.array(identifierSchema).min(1).max(64)
}).strict();
const trustedEnergyTextResultSchema = z.object({
  dataSnapshotId: identifierSchema,
  claims: z.array(resultClaimSchema).min(1).max(64)
}).strict();

export type TrustedEnergyTextResultInput = z.infer<typeof trustedEnergyTextResultSchema>;
export type TrustedEnergyTextResult = TrustedEnergyTextResultInput & {
  contractId: string;
  validated: true;
};

/** Compile only server-projected Snapshot facts; the model cannot choose a source, Metric or fact value. */
export const compileTrustedEnergyTextQuery = (input: unknown): TrustedEnergyTextQueryContract => {
  const parsed = trustedEnergyTextRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:${formatIssues(parsed.error)}`);
  }
  const { context, intent } = parsed.data;
  if (Date.parse(context.period.start) >= Date.parse(context.period.endExclusive)) {
    throw new Error("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:PERIOD_NOT_HALF_OPEN");
  }
  if (context.sourcePin.datasourceRevision === "unknown") {
    throw new Error("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:SOURCE_REVISION_REQUIRED");
  }
  requireUnique(
    context.sourcePin.physicalSchema.tables.map((table) => `${table.schema ?? ""}.${table.name}`),
    "PHYSICAL_SCHEMA_TABLE_DUPLICATE"
  );
  if (!primaryMetricsByIntent[intent].some((metricId) => metricId === context.metric.id)) {
    throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:PRIMARY_METRIC_MISMATCH:${intent}`);
  }

  const metrics = [context.metric, ...context.supportingMetrics];
  requireUnique(metrics.map((metric) => metric.id), "METRIC_DUPLICATE");
  for (const metric of metrics) {
    if (!TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent].some((metricId) => metricId === metric.id)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:SUPPORTING_METRIC_MISMATCH:${intent}`);
    }
    if (!metric.revisionId.startsWith(`${metric.id}@`)) {
      throw new Error("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:METRIC_REVISION_MISMATCH");
    }
  }

  const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
  requireUnique(context.evidenceRefs.map((ref) => ref.id), "EVIDENCE_DUPLICATE");
  for (const evidenceRef of context.evidenceRefs) {
    const metric = metricsById.get(evidenceRef.metricId);
    if (!metric) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:EVIDENCE_METRIC_MISMATCH:${evidenceRef.id}`);
    }
    if (evidenceRef.metricRevisionId !== metric.revisionId) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:EVIDENCE_METRIC_REVISION_MISMATCH:${evidenceRef.id}`);
    }
    if (evidenceRef.dataSnapshotId !== context.dataSnapshotId) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:EVIDENCE_SNAPSHOT_MISMATCH:${evidenceRef.id}`);
    }
  }
  for (const metric of metrics) {
    if (!context.evidenceRefs.some((ref) => ref.metricId === metric.id)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:METRIC_EVIDENCE_REQUIRED:${metric.id}`);
    }
  }

  const evidenceById = new Map(context.evidenceRefs.map((ref) => [ref.id, ref]));
  requireUnique(context.expectedFacts.map((fact) => fact.id), "EXPECTED_FACT_DUPLICATE");
  for (const fact of context.expectedFacts) {
    const metric = metricsById.get(fact.metricId);
    if (!metric) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:FACT_METRIC_MISMATCH:${fact.id}`);
    }
    if (fact.metricRevisionId !== metric.revisionId) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:FACT_METRIC_REVISION_MISMATCH:${fact.id}`);
    }
    if (typeof fact.value === "number" && fact.unit !== metric.unit) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:FACT_UNIT_MISMATCH:${fact.id}`);
    }
    if (typeof fact.value === "string" && fact.tolerance !== undefined) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:TEXT_FACT_TOLERANCE:${fact.id}`);
    }
    requireUnique(fact.evidenceRefIds, `FACT_EVIDENCE_DUPLICATE:${fact.id}`);
    for (const evidenceRefId of fact.evidenceRefIds) {
      const evidence = evidenceById.get(evidenceRefId);
      if (!evidence || evidence.metricId !== fact.metricId) {
        throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:FACT_EVIDENCE_MISMATCH:${fact.id}`);
      }
    }
    if (typeof fact.value === "string" && containsSecretBearingText(fact.value)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:FACT_SECRET_REDACTION_REQUIRED:${fact.id}`);
    }
  }
  for (const metric of metrics) {
    if (!context.expectedFacts.some((fact) => fact.metricId === metric.id)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:METRIC_FACT_REQUIRED:${metric.id}`);
    }
  }

  const pins = structuredClone(context);
  pins.sourcePin.physicalSchema.tables.sort(comparePhysicalTable);
  const id = createHash("sha256")
    .update(JSON.stringify({ intent, pins }))
    .digest("hex")
    .slice(0, 24);
  return deepFreeze({
    kind: "trusted-energy-text-query",
    id: `energy-text-${id}`,
    intent,
    source: "project-analysis-snapshot",
    selector: snapshotSelectorByIntent[intent],
    pins
  });
};

/** Compare model-shaped structured claims against the exact server-owned Snapshot fact registry. */
export const validateTrustedEnergyTextResult = (
  contract: TrustedEnergyTextQueryContract,
  input: unknown
): TrustedEnergyTextResult => {
  const parsed = trustedEnergyTextResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`TRUSTED_ENERGY_TEXT_RESULT_INVALID:${formatIssues(parsed.error)}`);
  }
  const result = parsed.data;
  if (result.dataSnapshotId !== contract.pins.dataSnapshotId) {
    throw new Error("TRUSTED_ENERGY_TEXT_SNAPSHOT_MISMATCH");
  }
  requireUniqueResultClaims(result.claims.map((claim) => claim.factId));
  if (result.claims.length !== contract.pins.expectedFacts.length) {
    throw new Error("TRUSTED_ENERGY_TEXT_CLAIM_SET_MISMATCH");
  }
  const claimsByFactId = new Map(result.claims.map((claim) => [claim.factId, claim]));
  const canonicalClaims = contract.pins.expectedFacts.map((fact) => {
    const claim = claimsByFactId.get(fact.id);
    if (!claim) {
      throw new Error(`TRUSTED_ENERGY_TEXT_CLAIM_NOT_FOUND:${fact.id}`);
    }
    if (!factValuesEqual(fact.value, claim.value, fact.tolerance ?? 0)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_CLAIM_VALUE_MISMATCH:${fact.id}`);
    }
    if (!sameSet(fact.evidenceRefIds, claim.evidenceRefIds)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_CLAIM_EVIDENCE_MISMATCH:${fact.id}`);
    }
    // Defense in depth after exact deterministic fact comparison; it is not the trust boundary.
    if (typeof claim.value === "string" && containsSecretBearingText(claim.value)) {
      throw new Error(`TRUSTED_ENERGY_TEXT_SECRET_REDACTION_REQUIRED:${fact.id}`);
    }
    return {
      factId: fact.id,
      value: fact.value,
      evidenceRefIds: [...fact.evidenceRefIds]
    };
  });
  return deepFreeze({
    contractId: contract.id,
    dataSnapshotId: result.dataSnapshotId,
    claims: canonicalClaims,
    validated: true as const
  });
};

/** Render only canonical claims that were validated against this exact contract. */
export const createTrustedEnergyAnswerEnvelope = (
  contract: TrustedEnergyTextQueryContract,
  result: TrustedEnergyTextResult
): string => {
  if (result.validated !== true || result.contractId !== contract.id) {
    throw new Error("TRUSTED_ENERGY_TEXT_RESULT_NOT_VALIDATED");
  }
  const canonicalResult = validateTrustedEnergyTextResult(contract, {
    dataSnapshotId: result.dataSnapshotId,
    claims: result.claims
  });
  const factsById = new Map(contract.pins.expectedFacts.map((fact) => [fact.id, fact]));
  const findingLines = canonicalResult.claims.map((claim) => {
    const fact = factsById.get(claim.factId);
    if (!fact) throw new Error("TRUSTED_ENERGY_TEXT_RESULT_NOT_VALIDATED");
    const unit = fact.unit ? ` ${fact.unit}` : "";
    return `- ${fact.label}: ${String(claim.value)}${unit} [Evidence: ${claim.evidenceRefIds.join(", ")}]`;
  });
  const evidenceIds = uniqueStrings(canonicalResult.claims.flatMap((claim) => claim.evidenceRefIds));
  const supportingMetricLine = contract.pins.supportingMetrics.length > 0
    ? [`Supporting Metrics: ${contract.pins.supportingMetrics.map(formatMetric).join("; ")}`]
    : [];
  return [
    "Findings:",
    ...findingLines,
    "",
    `Scope: ${contract.pins.scope.name}`,
    `Period: ${formatLocalTimestamp(contract.pins.period.start, contract.pins.period.timezone)} to `
      + `${formatLocalTimestamp(contract.pins.period.endExclusive, contract.pins.period.timezone)} (exclusive) · `
      + contract.pins.period.timezone,
    `Metric: ${formatMetric(contract.pins.metric)}`,
    ...supportingMetricLine,
    `Data as of: ${formatLocalTimestamp(contract.pins.dataAsOf, contract.pins.period.timezone)} · `
      + contract.pins.period.timezone,
    `Evidence: ${evidenceIds.join(", ")}`
  ].join("\n");
};

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

const formatMetric = (metric: TrustedEnergyTextRequest["context"]["metric"]): string =>
  `${metric.label} (${metric.unit}) · ${metric.revisionId}`;

const comparePhysicalTable = (
  left: TrustedEnergyPhysicalSchemaIdentity["tables"][number],
  right: TrustedEnergyPhysicalSchemaIdentity["tables"][number]
): number => `${left.schema ?? ""}.${left.name}`.localeCompare(`${right.schema ?? ""}.${right.name}`);

const factValuesEqual = (expected: string | number, actual: string | number, tolerance: number): boolean =>
  typeof expected === "number" && typeof actual === "number"
    ? Math.abs(expected - actual) <= tolerance
    : expected === actual;

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const requireUnique = (values: string[], code: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:${code}`);
  }
};

const requireUniqueResultClaims = (values: string[]): void => {
  if (new Set(values).size !== values.length) {
    throw new Error("TRUSTED_ENERGY_TEXT_CLAIM_DUPLICATE");
  }
};

const formatLocalTimestamp = (value: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
};

const containsSecretBearingText = (value: string): boolean =>
  /\b(?:api[_ -]?key|authorization|bearer|client[_ -]?secret)\b\s*[:=]|\bsk-[a-z0-9_-]{12,}\b/iu.test(value);

const formatIssues = (error: z.ZodError): string => error.issues
  .map((issue) => `${issue.path.join(".") || "request"}:${issue.code}`)
  .join(",");

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

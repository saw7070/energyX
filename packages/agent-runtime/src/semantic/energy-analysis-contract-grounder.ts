import { createAnalysisAssertions } from "../protocol/analysis-contract.js";
import type {
  AnalysisContractGrounder,
  AnalysisContractGroundingFinding,
  AnalysisContractGroundingResult,
} from "../protocol/model-analysis-contract-grounder.js";
import type { AnalysisRequirement } from "../protocol/analysis-requirements.js";
import type {
  AnalysisContextEvidenceCatalog,
  AnalysisContextEvidenceFact,
} from "../protocol/analysis-context-evidence.js";

export type EnergyAnalysisSemantics = {
  contract: "energyiq-analysis-semantics@1";
  relations: {
    facts: {
      relation: string;
      usageColumn: string;
      qualityStatusColumn: string;
      officialAggregationColumn: string;
    };
    scopeMetadata: {
      relation: string;
      scopeIdColumn: string;
      scopeTypeColumn: string;
      facilityTypeColumn: string;
      metadataStatusColumn: string;
      publishedFacilityTypes: string[];
    };
  };
  measureAuthorities: Array<{
    id: string;
    authority: "queryable" | "deterministic-evidence";
    source: "facts" | "scope-metadata" | "project-analysis-snapshot";
    unit?: string;
  }>;
};

/**
 * Ground the small set of EnergyIQ requirements whose physical mapping is
 * completely determined by the accepted Project release. Open-ended analysis
 * deliberately stays manual so the Analyst can choose its own investigation.
 */
export const createEnergyAnalysisContractGrounder = (
  semantics: EnergyAnalysisSemantics,
  contextEvidenceCatalog?: AnalysisContextEvidenceCatalog,
): AnalysisContractGrounder => async (input): Promise<AnalysisContractGroundingResult> => {
  const findings: AnalysisContractGroundingFinding[] = [];
  const availableTables = physicalTableNames(input.physicalSchema);
  const requirements = input.requirements.map((requirement) => {
    if (requirement.source !== "user") return cloneRequirement(requirement);
    const contextEvidence = contextEvidenceCatalog
      ? selectEnergyAnalysisContextEvidence(requirement.description, contextEvidenceCatalog)
      : undefined;
    const facilityType = requestedFacilityType(requirement.description, semantics);
    if (!facilityType || !isCountQuestion(requirement.description)) {
      return {
        ...cloneRequirement(requirement),
        ...(contextEvidence ? { contextEvidence } : {}),
      };
    }
    const metadata = semantics.relations.scopeMetadata;
    if (!availableTables.has(normalize(metadata.relation))) {
      findings.push({
        requirementId: requirement.id,
        code: "CONTRACT_UNKNOWN_TABLE",
        message: `Published Scope metadata relation '${metadata.relation}' is absent from the inspected schema.`,
      });
      return cloneRequirement(requirement);
    }
    return {
      ...cloneRequirement(requirement),
      assertions: createAnalysisAssertions(requirement.id, [{
        kind: "metric",
        description: `Count published Centre scopes with facility_type '${facilityType}'.`,
        sourceTables: [metadata.relation],
        dimensions: [metadata.facilityTypeColumn],
        sqlConstraints: [
          { kind: "source", table: metadata.relation },
          {
            kind: "filter",
            column: metadata.scopeTypeColumn,
            operator: "eq",
            value: "centre",
          },
          {
            kind: "filter",
            column: metadata.facilityTypeColumn,
            operator: "eq",
            value: facilityType,
          },
          { kind: "aggregate", function: "COUNT", column: "*", alias: "centre_count" },
        ],
        resultChecks: [
          { kind: "row_count", required: true, min: 1, max: 1 },
          { kind: "not_null", required: true, fields: ["centre_count"] },
        ],
        claimValues: [{ name: "centre_count", field: "centre_count", required: true }],
      }]),
    };
  });
  return { requirements, findings };
};

/** Ground requirements exclusively from an immutable Analysis Context Package. */
export const createEnergyContextEvidenceGrounder = (
  contextEvidenceCatalog: AnalysisContextEvidenceCatalog,
): AnalysisContractGrounder => async (input): Promise<AnalysisContractGroundingResult> => ({
  requirements: input.requirements.map((requirement) => {
    const contextEvidence = requirement.source === "user"
      ? selectEnergyAnalysisContextEvidence(requirement.description, contextEvidenceCatalog)
      : undefined;
    return {
      ...cloneRequirement(requirement),
      ...(contextEvidence ? { contextEvidence } : {}),
    };
  }),
  findings: [],
});

export const selectEnergyAnalysisContextEvidence = (
  question: string,
  catalog: AnalysisContextEvidenceCatalog,
): AnalysisRequirement["contextEvidence"] => {
  if (requiresEvidenceOutsideContextPackage(question)) return undefined;
  const normalized = normalize(question);
  const selectsPriorityFacts = /\b(?:investigat\w*|priorit(?:y|i\w*)|what should)\b|调查|优先|核查/iu
    .test(question);
  const requiresTargetedInvestigation = /\b(?:why|driver|cause|check next)\w*\b|原因|为什么|下一步/iu
    .test(question);
  const selected = selectsPriorityFacts
    ? investigationFacts(catalog.facts)
    : directQuestionFacts(normalized, catalog.facts);
  return selected.length > 0
    ? {
        mode: requiresTargetedInvestigation ? "supporting" : "sufficient",
        factIds: selected.map((fact) => fact.id),
      }
    : undefined;
};

const hourlyAnalysisPattern = /\b(?:hourly|time[\s-]?of[\s-]?day)\b|每小时|小时|时段/iu;

const requiresEvidenceOutsideContextPackage = (question: string): boolean => (
  /\b(?:forecast|predict|trend|daily|interval|timeline|chart|plot|tariff|cost|carbon|emission|water|raw\s+(?:row|data)|export|sql)\b|预测|趋势|逐日|明细|图表|曲线|原始数据|导出|电费|成本|碳排|水耗/iu
    .test(question)
  || (/\bpattern\b|模式/iu.test(question) && !hourlyAnalysisPattern.test(question))
);

const directQuestionFacts = (
  normalizedQuestion: string,
  facts: AnalysisContextEvidenceFact[],
): AnalysisContextEvidenceFact[] => {
  const releasedBenchmark = /\b(?:released|annualis(?:ed|ation)|annualiz(?:ed|ation)|benchmark|cohort|peer|p50|p75)\b|发布|年化|基准|同类/iu
    .test(normalizedQuestion);
  const requestsHourlyPattern = hourlyAnalysisPattern.test(normalizedQuestion);
  const requestsOffHours = /off[\s-]?hours?|non[\s-]?operating|非营业/iu
    .test(normalizedQuestion);
  const requestsAnomalyEvidence = /\b(?:anomal\w*|spike)\b|异常/iu
    .test(normalizedQuestion);
  const metricPatterns: Array<[RegExp, (fact: AnalysisContextEvidenceFact) => boolean]> = [
    [hourlyAnalysisPattern,
      (fact) => fact.metricId === "energy.hourly_usage_kwh" || fact.metricId === "energy.hourly_peak_kw"],
    [/\beui\b|energy\s+use\s+intensity/iu, (fact) => releasedBenchmark
      ? fact.metricId === "preschool.benchmark.eui"
      : fact.metricId.includes("eui")],
    [/kwh\s*\/\s*m2|单位面积/iu, (fact) => releasedBenchmark
      ? fact.metricId === "preschool.benchmark.eui"
      : fact.metricId.includes("kwh_per_sqm")],
    [/per[\s-]?pax|per\s+person|kwh\s*\/\s*person|人均/iu, (fact) => releasedBenchmark
      ? fact.metricId === "preschool.benchmark.per_pax"
      : fact.metricId.includes("per_pax") || fact.metricId.includes("per_person")],
    [/off[\s-]?hours?|non[\s-]?operating|非营业/iu, (fact) => fact.metricId.includes("off_hours")],
    [/\b(?:anomal\w*|spike)\b|异常/iu,
      (fact) => fact.metricId.startsWith("preschool.operational.closed_hour_spike")],
    [/\bpeak\b|峰值/iu, (fact) => fact.metricId.includes("peak")],
    [/\bchange\b|previous\s+period|相比|变化/iu, (fact) => fact.metricId.includes("change") || fact.id.includes("previous_usage")],
    [/\busage\b|energy\s+use|consumption|用电|能耗/iu, (fact) => fact.metricId.includes("usage")],
  ];
  const selectors = metricPatterns.filter(([pattern]) => pattern.test(normalizedQuestion)).map(([, select]) => select);
  if (selectors.length === 0) return [];
  let selected = facts.filter((fact) => selectors.some((select) => select(fact)));
  if (requestsHourlyPattern && !hasCompleteHourlyProfile(selected)) return [];
  if (requestsOffHours && !selected.some((fact) => fact.metricId.includes("off_hours"))) return [];
  if (requestsAnomalyEvidence && !selected.some((fact) => (
    fact.metricId === "preschool.operational.closed_hour_spike_count"
  ))) return [];
  const centre = selectedCentre(normalizedQuestion, facts);
  if (centre) {
    selected = selected.filter((fact) => fact.dimensions.scopeId === centre.scopeId);
    if (/\b(?:cohort|peer|benchmark|compare|p50|p75)\b|同类|基准|比较/iu.test(normalizedQuestion)) {
      selected.push(...facts.filter((fact) =>
        fact.dimensions.cohort === centre.cohort
        && (fact.dimensions.percentile === "p50" || fact.dimensions.percentile === "p75")
        && selectors.some((select) => select(fact))));
    }
  } else if (/\b(?:cohort|peer|benchmark|p50|p75)\b|同类|基准/iu.test(normalizedQuestion)) {
    selected = selected.filter((fact) => Boolean(fact.dimensions.percentile));
  } else {
    selected = selected.filter((fact) =>
      fact.id.startsWith("analysis.summary.")
      || fact.id.startsWith("analysis.comparison.")
      || (requestsHourlyPattern && fact.id.startsWith("analysis.hourly_profile."))
      || (requestsOffHours && fact.metricId.includes("off_hours"))
      || (requestsAnomalyEvidence && fact.metricId.startsWith("preschool.operational.closed_hour_spike")));
  }
  return uniqueFacts(selected);
};

const hasCompleteHourlyProfile = (facts: AnalysisContextEvidenceFact[]): boolean => {
  const hoursFor = (metricId: "energy.hourly_usage_kwh" | "energy.hourly_peak_kw"): Set<number> => new Set(
    facts
      .filter((fact) => fact.metricId === metricId)
      .map((fact) => Number(fact.dimensions.localHour))
      .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23),
  );
  const usageHours = hoursFor("energy.hourly_usage_kwh");
  const peakHours = hoursFor("energy.hourly_peak_kw");
  return usageHours.size === 24 && peakHours.size === 24;
};

const investigationFacts = (facts: AnalysisContextEvidenceFact[]): AnalysisContextEvidenceFact[] => {
  const priorityCentres = new Set(facts
    .filter((fact) => fact.metricId === "preschool.benchmark.priority" && fact.value === true)
    .map((fact) => fact.dimensions.scopeId));
  if (priorityCentres.size === 0) return [];
  return uniqueFacts(facts.filter((fact) =>
    priorityCentres.has(fact.dimensions.scopeId)
    && [
      "preschool.benchmark.priority",
      "preschool.benchmark.quadrant",
      "preschool.benchmark.eui",
      "preschool.benchmark.per_pax",
    ].includes(fact.metricId)));
};

const selectedCentre = (
  normalizedQuestion: string,
  facts: AnalysisContextEvidenceFact[],
): { scopeId: string; cohort?: string } | undefined => {
  const centreDimensions = uniqueDimensions(facts.filter((fact) => fact.dimensions.scopeId));
  const matches = centreDimensions.filter((dimensions) => [
    dimensions.scopeName,
    dimensions.centreCode ? `centre ${dimensions.centreCode}` : undefined,
    dimensions.centreCode ? `center ${dimensions.centreCode}` : undefined,
  ].some((value) => value && normalizedQuestion.includes(normalize(value))));
  return matches.length === 1
    ? { scopeId: matches[0]!.scopeId!, ...(matches[0]!.cohort ? { cohort: matches[0]!.cohort } : {}) }
    : undefined;
};

const uniqueDimensions = (facts: AnalysisContextEvidenceFact[]): Array<Record<string, string>> => [...new Map(
  facts.map((fact) => [fact.dimensions.scopeId, fact.dimensions]),
).values()];

const uniqueFacts = (facts: AnalysisContextEvidenceFact[]): AnalysisContextEvidenceFact[] => [...new Map(
  facts.map((fact) => [fact.id, fact]),
).values()];

const isCountQuestion = (value: string): boolean =>
  /\bhow\s+many\b|\bcount\b|\bnumber\s+of\b|多少|几个/iu.test(value);

const requestedFacilityType = (
  question: string,
  semantics: EnergyAnalysisSemantics,
): string | undefined => {
  const normalizedQuestion = normalize(question);
  const matches = semantics.relations.scopeMetadata.publishedFacilityTypes
    .filter((facilityType) => normalizedQuestion.includes(normalize(facilityType)))
    .sort((left, right) => right.length - left.length);
  return matches.length === 1 ? matches[0] : undefined;
};

const physicalTableNames = (physicalSchema: unknown): Set<string> => {
  if (!isRecord(physicalSchema) || !Array.isArray(physicalSchema.tables)) return new Set();
  return new Set(physicalSchema.tables.flatMap((table) => {
    if (typeof table === "string") return [normalize(table)];
    if (!isRecord(table) || typeof table.name !== "string") return [];
    return [normalize(table.name)];
  }));
};

const cloneRequirement = (requirement: AnalysisRequirement): AnalysisRequirement =>
  structuredClone(requirement);

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

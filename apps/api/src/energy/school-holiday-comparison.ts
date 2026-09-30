import type {
  EnergyIqAcademicPhase,
  EnergyIqCalendarDateContextResolution,
} from "@datafoundry/metadata";
import type { ReportTimeContext } from "@datafoundry/contracts";

export const ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT =
  "energyiq-school-holiday-comparison@1" as const;
export const SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID =
  "school_holiday_context_facts_v1" as const;
export const SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION =
  "comparison.school_holiday_context@1" as const;
export const SCHOOL_HOLIDAY_MINIMUM_OFFICIAL_FACT_COVERAGE_PCT = 95 as const;

export type SchoolHolidayEnergyFact = {
  localDate: string;
  kwh: number;
  accountingRole: "official_total" | "driver_only";
  levelId?: string;
  circuitId?: string;
  hour?: number;
  evidenceRef: string;
};

export type SchoolHolidayComparisonIdentity = {
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  comparisonWindowId: "school-holiday-comparison";
  reportTimePolicyRevision: string;
  period: { from: string; toExclusive: string };
  businessCalendarVersion: string;
  ruleRevision: string;
};

export type SchoolHolidayComparisonPolicy = {
  anomalyRelativeThresholdPct: number;
  anomalyAbsoluteThresholdKwh: number;
  minimumCohortSampleCount: number;
  minimumAnomalyBaselineSamples: number;
};

export type SchoolHolidayHourlyProfile = {
  status: "available";
  dayContext: DayContext;
  actualSampleCount: number;
  baselineSampleCount: number;
  values: Array<{
    localHour: number;
    actualAverageKwh: number;
    baselineAverageKwh: number;
    deltaKwh: number;
  }>;
} | {
  status: "unavailable";
  reason: "ACTUAL_HOURLY_PROFILE_UNAVAILABLE" | "TEACHING_HOURLY_PROFILE_UNAVAILABLE";
};

type AvailableCalendarContext = Extract<
  EnergyIqCalendarDateContextResolution,
  { status: "available" }
>["dates"][number];

type DayContext = "weekday" | "weekend" | "public_holiday";

type DailyEnergy = {
  localDate: string;
  context: AvailableCalendarContext;
  facts: SchoolHolidayEnergyFact[];
  totalKwh: number | null;
};

type ComparisonEvidence = Pick<
  SchoolHolidayComparisonIdentity,
  | "dataSnapshotId"
  | "projectReleaseId"
  | "comparisonWindowId"
  | "reportTimePolicyRevision"
  | "businessCalendarVersion"
  | "ruleRevision"
> & {
  metricId: "energy.total_usage_kwh@1";
  queryIds: [typeof SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID];
  period: SchoolHolidayComparisonIdentity["period"];
  actualRefs: string[];
  baselineRefs: string[];
};

type CohortComparison = {
  dayContext: DayContext;
  weekPart: "weekday" | "weekend";
  isPublicHoliday: boolean;
} & ({
  status: "available";
  actual: {
    academicPhase: "term_break" | "vacation";
    averageKwh: number;
    sampleCount: number;
  };
  baseline: {
    academicPhase: "teaching";
    averageKwh: number;
    sampleCount: number;
  };
  deltaKwh: number;
  deltaPercent: number;
  evidence: ComparisonEvidence;
} | {
  status: "unavailable";
  reason: "ACTUAL_SAMPLE_UNAVAILABLE" | "TEACHING_BASELINE_UNAVAILABLE";
});

type SchoolHolidayAnomaly = {
  localDate: string;
  academicPhase: EnergyIqAcademicPhase;
  schoolHolidayState: "school_holiday" | "non_school_holiday";
  dayContext: DayContext;
  actualKwh: number;
  baselineKwh: number;
  baselineSampleCount: number;
  deltaKwh: number;
  deltaPercent: number;
  baselineDates: string[];
  evidence: ComparisonEvidence;
};

export type SchoolHolidayComparisonResult = {
  status: "available";
  contract: typeof ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT;
  identity: SchoolHolidayComparisonIdentity;
  selectedHolidayInterval: {
    academicPhase: "term_break" | "vacation";
    from: string;
    toExclusive: string;
  };
  comparisons: CohortComparison[];
  hourlyProfile: SchoolHolidayHourlyProfile;
  anomalies: SchoolHolidayAnomaly[];
  quality: {
    expectedDayCount: number;
    completeDayCount: number;
    coveragePct: number;
    excludedLocalDates: string[];
  };
  excludedAcademicPhases: EnergyIqAcademicPhase[];
  limitations: string[];
} | {
  status: "unavailable";
  contract: typeof ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT;
  identity: SchoolHolidayComparisonIdentity;
  reason: {
    code:
      | "CALENDAR_CONTEXT_UNAVAILABLE"
      | "CALENDAR_CONTEXT_IDENTITY_MISMATCH"
      | "CALENDAR_CONTEXT_DATE_DUPLICATE"
      | "CALENDAR_CONTEXT_COVERAGE_INCOMPLETE"
      | "FACT_INVALID"
      | "FACT_QUERY_FAILED"
      | "FACT_COVERAGE_INCOMPLETE"
      | "SCHOOL_HOLIDAY_INTERVAL_UNAVAILABLE"
      | "ADJACENT_TEACHING_REFERENCE_UNAVAILABLE";
    message: string;
  };
  quality?: {
    expectedDayCount: number;
    completeDayCount: number;
    coveragePct: number;
    excludedLocalDates: string[];
  };
  limitations?: string[];
};

type BuildSchoolHolidayComparisonInput = {
  facts: SchoolHolidayEnergyFact[];
  calendarContexts: EnergyIqCalendarDateContextResolution;
  identity: SchoolHolidayComparisonIdentity;
  comparisonPolicy: SchoolHolidayComparisonPolicy;
  factQuality?: {
    expectedDayCount: number;
    completeDayCount: number;
    coveragePct: number;
    excludedLocalDates: string[];
  };
  factLimitations?: string[];
};

export const buildSchoolHolidayComparison = (
  input: BuildSchoolHolidayComparisonInput,
): SchoolHolidayComparisonResult => {
  const fail = (
    code: Extract<SchoolHolidayComparisonResult, { status: "unavailable" }>["reason"]["code"],
    message: string,
  ): SchoolHolidayComparisonResult => ({
    status: "unavailable",
    contract: ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT,
    identity: input.identity,
    reason: { code, message },
  });

  if (input.calendarContexts.status !== "available") {
    return fail("CALENDAR_CONTEXT_UNAVAILABLE", input.calendarContexts.reason.message);
  }
  if (input.calendarContexts.business_calendar_version !== input.identity.businessCalendarVersion) {
    return fail(
      "CALENDAR_CONTEXT_IDENTITY_MISMATCH",
      "Calendar Context does not match the Release-pinned Calendar Revision.",
    );
  }
  if (!validPolicy(input.comparisonPolicy)) {
    return fail("FACT_INVALID", "School Holiday comparison policy is invalid.");
  }

  const expectedDates = localDateRange(input.identity.period.from, input.identity.period.toExclusive);
  if (expectedDates.length === 0) {
    return fail("CALENDAR_CONTEXT_COVERAGE_INCOMPLETE", "The comparison period is empty or invalid.");
  }
  const contextsByDate = new Map<string, AvailableCalendarContext>();
  for (const context of input.calendarContexts.dates) {
    if (contextsByDate.has(context.local_date)) {
      return fail("CALENDAR_CONTEXT_DATE_DUPLICATE", `Calendar Context repeats ${context.local_date}.`);
    }
    contextsByDate.set(context.local_date, context);
  }
  if (contextsByDate.size !== expectedDates.length
    || expectedDates.some((localDate) => !contextsByDate.has(localDate))) {
    return fail(
      "CALENDAR_CONTEXT_COVERAGE_INCOMPLETE",
      "Calendar Context must cover every date in the comparison period exactly once.",
    );
  }

  const factsByDate = new Map<string, SchoolHolidayEnergyFact[]>();
  for (const fact of input.facts) {
    if (!contextsByDate.has(fact.localDate)
      || !Number.isFinite(fact.kwh)
      || fact.kwh < 0
      || !fact.evidenceRef.trim()
      || (fact.hour !== undefined
        && (!Number.isInteger(fact.hour) || fact.hour < 0 || fact.hour > 23))) {
      return fail("FACT_INVALID", "Energy facts must be valid and bound to the comparison period.");
    }
    factsByDate.set(fact.localDate, [...(factsByDate.get(fact.localDate) ?? []), fact]);
  }

  const days = expectedDates.map((localDate): DailyEnergy => {
    const context = contextsByDate.get(localDate)!;
    const facts = factsByDate.get(localDate) ?? [];
    const official = facts.filter(({ accountingRole }) => accountingRole === "official_total");
    return {
      localDate,
      context,
      facts,
      totalKwh: official.length === 0 ? null : round(official.reduce((sum, fact) => sum + fact.kwh, 0)),
    };
  });
  if (days.every(({ totalKwh }) => totalKwh === null)) {
    return fail("FACT_COVERAGE_INCOMPLETE", "The comparison period has no official-total facts.");
  }

  const intervals = completeHolidayIntervals(days);
  if (intervals.length === 0) {
    return fail(
      "SCHOOL_HOLIDAY_INTERVAL_UNAVAILABLE",
      "No complete Term Break or Vacation exists in the comparison period.",
    );
  }
  const selectedWithTeaching = [...intervals].reverse().flatMap((interval) => {
    const teaching = adjacentTeachingDays(days, interval.startIndex, interval.endIndex);
    return teaching.length > 0 ? [{ interval, teaching }] : [];
  })[0];
  if (!selectedWithTeaching) {
    return fail(
      "ADJACENT_TEACHING_REFERENCE_UNAVAILABLE",
      "The complete School Holiday interval has no adjacent Teaching reference.",
    );
  }

  const { interval: selected, teaching } = selectedWithTeaching;
  const holidayDays = days.slice(selected.startIndex, selected.endIndex + 1);
  const evidenceBase = {
    dataSnapshotId: input.identity.dataSnapshotId,
    projectReleaseId: input.identity.projectReleaseId,
    comparisonWindowId: input.identity.comparisonWindowId,
    reportTimePolicyRevision: input.identity.reportTimePolicyRevision,
    businessCalendarVersion: input.identity.businessCalendarVersion,
    ruleRevision: input.identity.ruleRevision,
    metricId: "energy.total_usage_kwh@1" as const,
    queryIds: [SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID] as [typeof SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID],
    period: input.identity.period,
  };
  const cohortContexts = [
    { dayContext: "weekday", weekPart: "weekday", isPublicHoliday: false },
    { dayContext: "weekend", weekPart: "weekend", isPublicHoliday: false },
    { dayContext: "public_holiday", weekPart: "weekday", isPublicHoliday: true },
  ] as const;
  const comparisons = cohortContexts.map((cohort): CohortComparison => {
    const actual = comparableDays(holidayDays, cohort.weekPart, cohort.isPublicHoliday);
    if (actual.length < input.comparisonPolicy.minimumCohortSampleCount) {
      return { ...cohort, status: "unavailable", reason: "ACTUAL_SAMPLE_UNAVAILABLE" };
    }
    const baseline = comparableDays(teaching, cohort.weekPart, cohort.isPublicHoliday);
    if (baseline.length < input.comparisonPolicy.minimumCohortSampleCount) {
      return { ...cohort, status: "unavailable", reason: "TEACHING_BASELINE_UNAVAILABLE" };
    }
    const actualAverage = mean(actual.map(({ totalKwh }) => totalKwh));
    const baselineAverage = mean(baseline.map(({ totalKwh }) => totalKwh));
    const deltaKwh = round(actualAverage - baselineAverage);
    return {
      ...cohort,
      status: "available",
      actual: { academicPhase: selected.academicPhase, averageKwh: actualAverage, sampleCount: actual.length },
      baseline: { academicPhase: "teaching", averageKwh: baselineAverage, sampleCount: baseline.length },
      deltaKwh,
      deltaPercent: percent(deltaKwh, baselineAverage),
      evidence: {
        ...evidenceBase,
        actualRefs: evidenceRefs(actual),
        baselineRefs: evidenceRefs(baseline),
      },
    };
  });

  if (!comparisons.some(({ status }) => status === "available")) {
    return fail(
      "ADJACENT_TEACHING_REFERENCE_UNAVAILABLE",
      "No School Holiday cohort has enough complete same-context Teaching dates for comparison.",
    );
  }

  const anomalies = buildAnomalies(days, input.comparisonPolicy, evidenceBase);
  const hourlyCohort = comparisons.find((comparison) => comparison.status === "available");
  const hourlyProfile = hourlyCohort?.status === "available"
    ? buildHourlyProfile(
      comparableDays(holidayDays, hourlyCohort.weekPart, hourlyCohort.isPublicHoliday),
      comparableDays(teaching, hourlyCohort.weekPart, hourlyCohort.isPublicHoliday),
      hourlyCohort.dayContext,
    )
    : { status: "unavailable", reason: "ACTUAL_HOURLY_PROFILE_UNAVAILABLE" } as const;
  const missingDates = days.filter(({ totalKwh }) => totalKwh === null).map(({ localDate }) => localDate);
  const excludedAcademicPhases = unique(days.map(({ context }) => context.academic_phase))
    .filter((phase) => phase !== selected.academicPhase && phase !== "teaching");
  return {
    status: "available",
    contract: ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT,
    identity: input.identity,
    selectedHolidayInterval: {
      academicPhase: selected.academicPhase,
      from: days[selected.startIndex]!.localDate,
      toExclusive: nextLocalDate(days[selected.endIndex]!.localDate),
    },
    comparisons,
    hourlyProfile,
    anomalies,
    quality: input.factQuality ?? {
      expectedDayCount: expectedDates.length,
      completeDayCount: expectedDates.length - missingDates.length,
      coveragePct: percent(expectedDates.length - missingDates.length, expectedDates.length),
      excludedLocalDates: missingDates,
    },
    excludedAcademicPhases,
    limitations: [
      ...comparisons.flatMap((comparison) => comparison.status === "unavailable"
        ? [`${comparison.dayContext}:${comparison.reason}`]
        : []),
      ...(input.factLimitations ?? []),
    ],
  };
};

export const schoolHolidayComparisonUnavailable = (input: {
  identity: SchoolHolidayComparisonIdentity;
  code: Extract<SchoolHolidayComparisonResult, { status: "unavailable" }>["reason"]["code"];
  message: string;
  quality?: Extract<SchoolHolidayComparisonResult, { status: "unavailable" }>["quality"];
  limitations?: string[];
}): SchoolHolidayComparisonResult => ({
  status: "unavailable",
  contract: ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT,
  identity: input.identity,
  reason: { code: input.code, message: input.message },
  ...(input.quality ? {
    quality: { ...input.quality, excludedLocalDates: [...input.quality.excludedLocalDates] },
  } : {}),
  ...(input.limitations ? { limitations: [...input.limitations] } : {}),
});

export const schoolHolidayComparisonHasRequiredShape = (
  value: unknown,
): value is SchoolHolidayComparisonResult => {
  if (!isRecord(value)
    || value.contract !== ENERGYIQ_SCHOOL_HOLIDAY_COMPARISON_CONTRACT
    || !comparisonIdentityHasRequiredShape(value.identity)) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason)
      && HOLIDAY_UNAVAILABLE_REASON_CODES.has(value.reason.code)
      && nonEmptyString(value.reason.message)
      && (value.quality === undefined || qualityHasRequiredShape(value.quality))
      && (value.limitations === undefined || stringArrayHasRequiredShape(value.limitations));
  }
  if (value.status !== "available"
    || !isRecord(value.selectedHolidayInterval)
    || !HOLIDAY_PHASES.has(value.selectedHolidayInterval.academicPhase)
    || !localDateHasRequiredShape(value.selectedHolidayInterval.from)
    || !localDateHasRequiredShape(value.selectedHolidayInterval.toExclusive)
    || value.selectedHolidayInterval.from >= value.selectedHolidayInterval.toExclusive
    || !recordArrayHasRequiredShape(value.comparisons, comparisonHasRequiredShape)
    || !hourlyProfileHasRequiredShape(value.hourlyProfile)
    || !recordArrayHasRequiredShape(value.anomalies, anomalyHasRequiredShape)
    || !qualityHasRequiredShape(value.quality)
    || !academicPhaseArrayHasRequiredShape(value.excludedAcademicPhases)
    || !stringArrayHasRequiredShape(value.limitations)) return false;
  const available = value as unknown as Extract<SchoolHolidayComparisonResult, { status: "available" }>;
  return availableSemanticsHaveRequiredShape(available)
    && available.comparisons.every((comparison) => (
    comparison.status !== "available"
    || evidenceMatchesIdentity(comparison.evidence, available.identity)
  )) && available.anomalies.every((anomaly) => evidenceMatchesIdentity(anomaly.evidence, available.identity));
};

const availableSemanticsHaveRequiredShape = (
  value: Extract<SchoolHolidayComparisonResult, { status: "available" }>,
): boolean => {
  if (value.selectedHolidayInterval.from < value.identity.period.from
    || value.selectedHolidayInterval.toExclusive > value.identity.period.toExclusive
    || value.comparisons.length !== 3) return false;
  const expectedCohorts = new Set([
    "weekday:weekday:false",
    "weekend:weekend:false",
    "public_holiday:weekday:true",
  ]);
  const actualCohorts = new Set(value.comparisons.map(({ dayContext, weekPart, isPublicHoliday }) => (
    `${dayContext}:${weekPart}:${String(isPublicHoliday)}`
  )));
  if (actualCohorts.size !== expectedCohorts.size
    || [...expectedCohorts].some((cohort) => !actualCohorts.has(cohort))) return false;
  const excludedPhases = new Set(value.excludedAcademicPhases);
  if (excludedPhases.size !== value.excludedAcademicPhases.length
    || excludedPhases.has("teaching")
    || excludedPhases.has(value.selectedHolidayInterval.academicPhase)) return false;
  const firstAvailable = value.comparisons.find((comparison) => comparison.status === "available");
  if (!firstAvailable
    || value.hourlyProfile.status !== "available"
    || value.hourlyProfile.dayContext !== firstAvailable.dayContext) return false;
  for (const comparison of value.comparisons) {
    if (comparison.status !== "available") continue;
    if (comparison.actual.academicPhase !== value.selectedHolidayInterval.academicPhase
      || round(comparison.actual.averageKwh - comparison.baseline.averageKwh) !== comparison.deltaKwh
      || percent(comparison.deltaKwh, comparison.baseline.averageKwh) !== comparison.deltaPercent
      || comparison.evidence.actualRefs.length === 0
      || comparison.evidence.baselineRefs.length === 0) return false;
  }
  if (value.hourlyProfile.values.some((point) => (
    round(point.actualAverageKwh - point.baselineAverageKwh) !== point.deltaKwh
  ))) return false;
  const periodDates = localDateRange(value.identity.period.from, value.identity.period.toExclusive);
  const excludedDates = value.quality.excludedLocalDates;
  const excludedSet = new Set(excludedDates);
  if (value.quality.expectedDayCount !== periodDates.length
    || value.quality.completeDayCount <= 0
    || value.quality.coveragePct < SCHOOL_HOLIDAY_MINIMUM_OFFICIAL_FACT_COVERAGE_PCT
    || excludedSet.size !== excludedDates.length
    || excludedDates.some((date) => !localDateHasRequiredShape(date) || !periodDates.includes(date))
    || value.quality.completeDayCount !== value.quality.expectedDayCount - excludedDates.length
    || value.quality.coveragePct !== percent(value.quality.completeDayCount, value.quality.expectedDayCount)) {
    return false;
  }
  const anomalyDates = new Set(value.anomalies.map(({ localDate }) => localDate));
  if (anomalyDates.size !== value.anomalies.length) return false;
  return value.anomalies.every((anomaly) => (
    localDateHasRequiredShape(anomaly.localDate)
    && periodDates.includes(anomaly.localDate)
    && round(anomaly.actualKwh - anomaly.baselineKwh) === anomaly.deltaKwh
    && percent(anomaly.deltaKwh, anomaly.baselineKwh) === anomaly.deltaPercent
    && anomaly.evidence.actualRefs.length > 0
    && anomaly.evidence.baselineRefs.length > 0
    && anomaly.baselineSampleCount === anomaly.baselineDates.length
    && new Set(anomaly.baselineDates).size === anomaly.baselineDates.length
    && anomaly.baselineDates.every((date) => localDateHasRequiredShape(date) && periodDates.includes(date))
    && ((anomaly.academicPhase === "term_break" || anomaly.academicPhase === "vacation")
      ? anomaly.schoolHolidayState === "school_holiday"
      : anomaly.schoolHolidayState === "non_school_holiday")
  ));
};

export const schoolHolidayComparisonMatchesReportTimeContext = (
  comparison: SchoolHolidayComparisonResult,
  reportTimeContext: ReportTimeContext,
): boolean => {
  if (!schoolHolidayComparisonHasRequiredShape(comparison)) return false;
  const windows = reportTimeContext.windows.filter(
    ({ windowId }) => windowId === comparison.identity.comparisonWindowId,
  );
  if (windows.length !== 1) return false;
  const window = windows[0]!;
  return comparison.identity.reportTimePolicyRevision
    === `${reportTimeContext.policyId}@${reportTimeContext.policyRevision}`
    && comparison.identity.period.from
      === reportTimeLocalDateAtInstant(window.from, reportTimeContext.timezone)
    && comparison.identity.period.toExclusive
      === reportTimeLocalDateAtInstant(window.toExclusive, reportTimeContext.timezone);
};

const reportTimeLocalDateAtInstant = (value: string, timezone: string): string => {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((item) => item.type === type)?.value ?? ""
  );
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const comparisonIdentityHasRequiredShape = (value: unknown): boolean => isRecord(value)
  && [
    "projectId", "scopeId", "dataSnapshotId", "projectReleaseId",
    "reportTimePolicyRevision", "businessCalendarVersion", "ruleRevision",
  ].every((field) => nonEmptyString(value[field]))
  && value.comparisonWindowId === "school-holiday-comparison"
  && isRecord(value.period)
  && localDateHasRequiredShape(value.period.from)
  && localDateHasRequiredShape(value.period.toExclusive)
  && value.period.from < value.period.toExclusive;

const localDateHasRequiredShape = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const comparisonHasRequiredShape = (value: Record<string, unknown>): boolean => {
  if (!DAY_CONTEXTS.has(value.dayContext)
    || !WEEK_PARTS.has(value.weekPart)
    || typeof value.isPublicHoliday !== "boolean") return false;
  if (value.status === "unavailable") {
    return value.reason === "ACTUAL_SAMPLE_UNAVAILABLE"
      || value.reason === "TEACHING_BASELINE_UNAVAILABLE";
  }
  return value.status === "available"
    && cohortHasRequiredShape(value.actual, HOLIDAY_PHASES)
    && cohortHasRequiredShape(value.baseline, new Set(["teaching"]))
    && finiteNumber(value.deltaKwh)
    && finiteNumber(value.deltaPercent)
    && evidenceHasRequiredShape(value.evidence);
};

const cohortHasRequiredShape = (value: unknown, phases: Set<unknown>): boolean => isRecord(value)
  && phases.has(value.academicPhase)
  && finiteNumber(value.averageKwh)
  && positiveSafeInteger(value.sampleCount);

const anomalyHasRequiredShape = (value: Record<string, unknown>): boolean => (
  nonEmptyString(value.localDate)
  && ACADEMIC_PHASES.has(value.academicPhase)
  && (value.schoolHolidayState === "school_holiday" || value.schoolHolidayState === "non_school_holiday")
  && DAY_CONTEXTS.has(value.dayContext)
  && finiteNumber(value.actualKwh)
  && finiteNumber(value.baselineKwh)
  && positiveSafeInteger(value.baselineSampleCount)
  && finiteNumber(value.deltaKwh)
  && finiteNumber(value.deltaPercent)
  && stringArrayHasRequiredShape(value.baselineDates)
  && evidenceHasRequiredShape(value.evidence)
);

const hourlyProfileHasRequiredShape = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.status === "unavailable") {
    return value.reason === "ACTUAL_HOURLY_PROFILE_UNAVAILABLE"
      || value.reason === "TEACHING_HOURLY_PROFILE_UNAVAILABLE";
  }
  if (value.status !== "available"
    || !DAY_CONTEXTS.has(value.dayContext)
    || !positiveSafeInteger(value.actualSampleCount)
    || !positiveSafeInteger(value.baselineSampleCount)
    || !Array.isArray(value.values)
    || value.values.length !== 24) return false;
  const hours = new Set<number>();
  for (const item of value.values) {
    if (!isRecord(item)) return false;
    const localHour = item.localHour;
    if (typeof localHour !== "number"
      || !Number.isSafeInteger(localHour)
      || localHour < 0
      || localHour > 23
      || !finiteNumber(item.actualAverageKwh)
      || !finiteNumber(item.baselineAverageKwh)
      || !finiteNumber(item.deltaKwh)) return false;
    hours.add(localHour);
  }
  return hours.size === 24;
};

const evidenceHasRequiredShape = (value: unknown): boolean => isRecord(value)
  && [
    "dataSnapshotId", "projectReleaseId", "reportTimePolicyRevision",
    "businessCalendarVersion", "ruleRevision",
  ].every((field) => nonEmptyString(value[field]))
  && value.comparisonWindowId === "school-holiday-comparison"
  && value.metricId === "energy.total_usage_kwh@1"
  && Array.isArray(value.queryIds)
  && value.queryIds.length === 1
  && value.queryIds[0] === SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID
  && isRecord(value.period)
  && localDateHasRequiredShape(value.period.from)
  && localDateHasRequiredShape(value.period.toExclusive)
  && value.period.from < value.period.toExclusive
  && stringArrayHasRequiredShape(value.actualRefs)
  && stringArrayHasRequiredShape(value.baselineRefs);

const evidenceMatchesIdentity = (
  value: unknown,
  identity: SchoolHolidayComparisonIdentity,
): boolean => isRecord(value)
  && value.dataSnapshotId === identity.dataSnapshotId
  && value.projectReleaseId === identity.projectReleaseId
  && value.comparisonWindowId === identity.comparisonWindowId
  && value.reportTimePolicyRevision === identity.reportTimePolicyRevision
  && value.businessCalendarVersion === identity.businessCalendarVersion
  && value.ruleRevision === identity.ruleRevision
  && isRecord(value.period)
  && value.period.from === identity.period.from
  && value.period.toExclusive === identity.period.toExclusive;

const qualityHasRequiredShape = (value: unknown): boolean => isRecord(value)
  && positiveSafeInteger(value.expectedDayCount)
  && nonNegativeSafeInteger(value.completeDayCount)
  && value.completeDayCount <= value.expectedDayCount
  && finiteNumber(value.coveragePct)
  && value.coveragePct >= 0
  && value.coveragePct <= 100
  && stringArrayHasRequiredShape(value.excludedLocalDates);

const recordArrayHasRequiredShape = (
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
): boolean => Array.isArray(value)
  && value.every((item) => isRecord(item) && predicate(item));

const stringArrayHasRequiredShape = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(nonEmptyString);

const academicPhaseArrayHasRequiredShape = (value: unknown): boolean => Array.isArray(value)
  && value.every((item) => ACADEMIC_PHASES.has(item));

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const nonNegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const HOLIDAY_PHASES = new Set<unknown>(["term_break", "vacation"]);
const ACADEMIC_PHASES = new Set<unknown>(["teaching", "term_break", "study_exam", "vacation"]);
const DAY_CONTEXTS = new Set<unknown>(["weekday", "weekend", "public_holiday"]);
const WEEK_PARTS = new Set<unknown>(["weekday", "weekend"]);
const HOLIDAY_UNAVAILABLE_REASON_CODES = new Set<unknown>([
  "CALENDAR_CONTEXT_UNAVAILABLE",
  "CALENDAR_CONTEXT_IDENTITY_MISMATCH",
  "CALENDAR_CONTEXT_DATE_DUPLICATE",
  "CALENDAR_CONTEXT_COVERAGE_INCOMPLETE",
  "FACT_INVALID",
  "FACT_QUERY_FAILED",
  "FACT_COVERAGE_INCOMPLETE",
  "SCHOOL_HOLIDAY_INTERVAL_UNAVAILABLE",
  "ADJACENT_TEACHING_REFERENCE_UNAVAILABLE",
]);

const completeHolidayIntervals = (days: DailyEnergy[]): Array<{
  academicPhase: "term_break" | "vacation";
  startIndex: number;
  endIndex: number;
}> => {
  const intervals: Array<{
    academicPhase: "term_break" | "vacation";
    startIndex: number;
    endIndex: number;
  }> = [];
  for (let index = 0; index < days.length; index += 1) {
    const phase = days[index]?.context.academic_phase;
    if (phase !== "term_break" && phase !== "vacation") continue;
    const startIndex = index;
    while (days[index + 1]?.context.academic_phase === phase) index += 1;
    const first = days[startIndex]!;
    const last = days[index]!;
    if (first.localDate === first.context.academic_period_from
      && nextLocalDate(last.localDate) === first.context.academic_period_to_exclusive
      && days.slice(startIndex, index + 1).every(({ context }) => (
        context.academic_period_id === first.context.academic_period_id
        && context.academic_period_from === first.context.academic_period_from
        && context.academic_period_to_exclusive === first.context.academic_period_to_exclusive
      ))) {
      intervals.push({ academicPhase: phase, startIndex, endIndex: index });
    }
  }
  return intervals;
};

const adjacentTeachingDays = (days: DailyEnergy[], startIndex: number, endIndex: number): DailyEnergy[] => {
  const before: DailyEnergy[] = [];
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (!day || day.context.academic_phase !== "teaching") break;
    before.unshift(day);
  }
  const after: DailyEnergy[] = [];
  for (let index = endIndex + 1; index < days.length; index += 1) {
    const day = days[index];
    if (!day || day.context.academic_phase !== "teaching") break;
    after.push(day);
  }
  return [...before, ...after];
};

const comparableDays = (
  days: DailyEnergy[],
  weekPart: "weekday" | "weekend",
  isPublicHoliday: boolean,
): Array<DailyEnergy & { totalKwh: number }> => days.filter(
  (day): day is DailyEnergy & { totalKwh: number } => day.totalKwh !== null
    && day.context.is_public_holiday === isPublicHoliday
    && (isPublicHoliday || day.context.week_part === weekPart),
);

const buildHourlyProfile = (
  actualDays: DailyEnergy[],
  baselineDays: DailyEnergy[],
  dayContext: DayContext,
): SchoolHolidayHourlyProfile => {
  const actual = actualDays.flatMap((day) => {
    const profile = completeOfficialHourlyProfile(day);
    return profile ? [profile] : [];
  });
  if (actual.length === 0) {
    return { status: "unavailable", reason: "ACTUAL_HOURLY_PROFILE_UNAVAILABLE" };
  }
  const baseline = baselineDays.flatMap((day) => {
    const profile = completeOfficialHourlyProfile(day);
    return profile ? [profile] : [];
  });
  if (baseline.length === 0) {
    return { status: "unavailable", reason: "TEACHING_HOURLY_PROFILE_UNAVAILABLE" };
  }
  return {
    status: "available",
    dayContext,
    actualSampleCount: actual.length,
    baselineSampleCount: baseline.length,
    values: Array.from({ length: 24 }, (_, localHour) => {
      const actualAverageKwh = mean(actual.map((profile) => profile[localHour]!));
      const baselineAverageKwh = mean(baseline.map((profile) => profile[localHour]!));
      return {
        localHour,
        actualAverageKwh,
        baselineAverageKwh,
        deltaKwh: round(actualAverageKwh - baselineAverageKwh),
      };
    }),
  };
};

const completeOfficialHourlyProfile = (day: DailyEnergy): number[] | null => {
  const official = day.facts.filter(({ accountingRole }) => accountingRole === "official_total");
  if (official.length === 0 || official.some(({ hour }) => hour === undefined)) return null;
  const byHour = new Map<number, number>();
  for (const fact of official) {
    const hour = fact.hour!;
    byHour.set(hour, round((byHour.get(hour) ?? 0) + fact.kwh));
  }
  return byHour.size === 24
    ? Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? 0)
    : null;
};

const buildAnomalies = (
  days: DailyEnergy[],
  policy: SchoolHolidayComparisonPolicy,
  evidenceBase: Omit<ComparisonEvidence, "actualRefs" | "baselineRefs">,
): SchoolHolidayAnomaly[] => days.flatMap((day): SchoolHolidayAnomaly[] => {
  if (day.totalKwh === null) return [];
  const baseline = days.filter((candidate): candidate is DailyEnergy & { totalKwh: number } => (
    candidate.localDate !== day.localDate
    && candidate.totalKwh !== null
    && candidate.context.academic_phase === day.context.academic_phase
    && contextKey(candidate.context) === contextKey(day.context)
  ));
  if (baseline.length < policy.minimumAnomalyBaselineSamples) return [];
  const baselineKwh = mean(baseline.map(({ totalKwh }) => totalKwh));
  const deltaKwh = round(day.totalKwh - baselineKwh);
  const deltaPercent = percent(deltaKwh, baselineKwh);
  if (deltaKwh < policy.anomalyAbsoluteThresholdKwh
    || deltaPercent < policy.anomalyRelativeThresholdPct) return [];
  return [{
    localDate: day.localDate,
    academicPhase: day.context.academic_phase,
    schoolHolidayState: day.context.school_holiday_state,
    dayContext: dayContextOf(day.context),
    actualKwh: day.totalKwh,
    baselineKwh,
    baselineSampleCount: baseline.length,
    deltaKwh,
    deltaPercent,
    baselineDates: baseline.map(({ localDate }) => localDate),
    evidence: {
      ...evidenceBase,
      actualRefs: evidenceRefs([day]),
      baselineRefs: evidenceRefs(baseline),
    },
  }];
});

const evidenceRefs = (days: DailyEnergy[]): string[] => unique(days.flatMap(({ facts }) => facts
  .filter(({ accountingRole }) => accountingRole === "official_total")
  .map(({ evidenceRef }) => evidenceRef))).sort();

const contextKey = (context: AvailableCalendarContext): string => context.is_public_holiday
  ? "public_holiday"
  : context.week_part;

const dayContextOf = (context: AvailableCalendarContext): DayContext => context.is_public_holiday
  ? "public_holiday"
  : context.week_part;

const validPolicy = (policy: SchoolHolidayComparisonPolicy): boolean => (
  Number.isFinite(policy.anomalyRelativeThresholdPct)
  && policy.anomalyRelativeThresholdPct >= 0
  && Number.isFinite(policy.anomalyAbsoluteThresholdKwh)
  && policy.anomalyAbsoluteThresholdKwh >= 0
  && Number.isSafeInteger(policy.minimumCohortSampleCount)
  && policy.minimumCohortSampleCount > 0
  && Number.isSafeInteger(policy.minimumAnomalyBaselineSamples)
  && policy.minimumAnomalyBaselineSamples > 0
);

const localDateRange = (from: string, toExclusive: string): string[] => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(from)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(toExclusive)
    || from >= toExclusive) return [];
  const dates: string[] = [];
  for (let cursor = from; cursor < toExclusive; cursor = nextLocalDate(cursor)) dates.push(cursor);
  return dates;
};

const nextLocalDate = (value: string): string => new Date(
  Date.parse(`${value}T00:00:00.000Z`) + 86_400_000,
).toISOString().slice(0, 10);

const mean = (values: number[]): number => round(values.reduce((sum, value) => sum + value, 0) / values.length);
const percent = (delta: number, baseline: number): number => baseline === 0 ? 0 : round(delta / baseline * 100);
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

import type {
  EnergyIqOperatingCalendarRevision,
  EnergyIqRuleRevisionRecord,
} from "@datafoundry/metadata";

export type OverviewCalendarLookbackRequirement = {
  requiredLocalFrom: string;
  ruleRevisionId: string;
  maximumLookbackDays: number;
};

export const resolveOverviewCalendarLookbackRequirement = (input: {
  rendererKey: string;
  overviewPeriodLocalFrom: string;
  anomalyRule: EnergyIqRuleRevisionRecord;
}): OverviewCalendarLookbackRequirement | null => {
  if (input.rendererKey !== "ngee-ann-overview") return null;
  const maximumLookbackDays = input.anomalyRule.parameters.maximum_lookback_days;
  if (!Number.isInteger(maximumLookbackDays) || Number(maximumLookbackDays) <= 0) {
    throw new Error(`ENERGYIQ_OVERVIEW_RULE_LOOKBACK_INVALID:${input.anomalyRule.revision_id}`);
  }
  return {
    requiredLocalFrom: shiftLocalDate(input.overviewPeriodLocalFrom, -Number(maximumLookbackDays)),
    ruleRevisionId: input.anomalyRule.revision_id,
    maximumLookbackDays: Number(maximumLookbackDays),
  };
};

export const operatingCalendarCoversOverviewLookback = (input: {
  calendar: EnergyIqOperatingCalendarRevision;
  rootScopeId: string;
  requiredLocalFrom: string;
  overviewPeriodLocalFrom: string;
}): boolean => {
  const applicableEntries = input.calendar.entries
    .filter((entry) => entry.owner.kind === "project"
      || (entry.owner.kind === "scope" && entry.owner.scope_id === input.rootScopeId))
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from));
  let coveredUntil = input.requiredLocalFrom;
  for (const entry of applicableEntries) {
    if (entry.effective_from > coveredUntil) break;
    if (entry.effective_to && entry.effective_to <= coveredUntil) continue;
    if (!entry.effective_to || entry.effective_to >= input.overviewPeriodLocalFrom) return true;
    coveredUntil = entry.effective_to;
  }
  return coveredUntil >= input.overviewPeriodLocalFrom;
};

const shiftLocalDate = (localDate: string, days: number): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error("ENERGYIQ_OVERVIEW_PERIOD_LOCAL_FROM_INVALID");
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
};

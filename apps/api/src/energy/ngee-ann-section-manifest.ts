import type { MetadataStore } from "@datafoundry/metadata";

import { SINGAPORE_2026_PUBLIC_HOLIDAYS } from "./ngee-ann-calendar-policy.js";
import { SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION } from "./school-holiday-comparison.js";

export const NGEE_ANN_CORE_SECTION_IDS = [
  "trend-and-demand",
  "time-behaviour",
  "circuit-concentration",
  "decision-priorities",
] as const;

export const NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID = "school-holiday-comparison" as const;
export const NGEE_ANN_HOLIDAY_CALENDAR_VERSION = "sg-calendar-holiday-v2" as const;
export const NGEE_ANN_SECTION_IDS = [
  ...NGEE_ANN_CORE_SECTION_IDS,
  NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID,
] as const;

export type NgeeAnnSectionId = typeof NGEE_ANN_SECTION_IDS[number];

type HolidayDisabledReason =
  | "SCHOOL_HOLIDAY_RELEASE_MANIFEST_NOT_FOUND"
  | "SCHOOL_HOLIDAY_CALENDAR_REVISION_NOT_PINNED"
  | "SCHOOL_HOLIDAY_CALENDAR_CONTRACT_INVALID"
  | "SCHOOL_HOLIDAY_RULE_REVISION_NOT_PINNED"
  | "SCHOOL_HOLIDAY_OVERVIEW_SECTION_NOT_PINNED"
  | "SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_PINNED"
  | "SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_REGISTERED"
  | "SCHOOL_HOLIDAY_COMPARISON_WINDOW_STRATEGY_INVALID"
  | "SCHOOL_HOLIDAY_CALENDAR_REVISION_NOT_FOUND"
  | "SCHOOL_HOLIDAY_ACADEMIC_PERIODS_NOT_CONFIGURED"
  | "SCHOOL_HOLIDAY_RULE_REVISION_NOT_FOUND";

export type NgeeAnnSectionManifest = {
  contract: "energyiq-ngee-ann-section-manifest@1";
  projectReleaseId: string;
  enabledSectionIds: NgeeAnnSectionId[];
  disabledCapabilities: Array<{
    sectionId: typeof NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID;
    reason: HolidayDisabledReason;
  }>;
};

type ReleaseManifestInput = {
  revision_id: string;
  project_id: string;
  business_calendar_version: string;
  selected_rule_revision_ids: string[];
};

type OverviewDefinitionInput = {
  template_revision_id: string;
  renderer_key: string;
  time_policy_revision_id: string;
  definition: {
    sections: Array<{
      key: string;
      primaryWindowId: string;
      supportingWindowIds: string[];
      blocks: Array<{ windowId: string }>;
    }>;
  };
} | null;

type ReportTimePolicyInput = {
  revision_id: string;
  policy: {
    windows: Array<{
      windowId: string;
      role?: string;
      strategy: unknown;
    }>;
  };
} | null;

export const resolveNgeeAnnSectionManifest = (input: {
  projectRelease: ReleaseManifestInput;
  overviewDefinition: OverviewDefinitionInput;
  reportTimePolicy?: ReportTimePolicyInput;
}): NgeeAnnSectionManifest => {
  const disabledReason = holidayDisabledReason(input);
  return {
    contract: "energyiq-ngee-ann-section-manifest@1",
    projectReleaseId: input.projectRelease.revision_id,
    enabledSectionIds: disabledReason
      ? [...NGEE_ANN_CORE_SECTION_IDS]
      : [...NGEE_ANN_CORE_SECTION_IDS, NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID],
    disabledCapabilities: disabledReason
      ? [{ sectionId: NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID, reason: disabledReason }]
      : [],
  };
};

export const resolveNgeeAnnSectionManifestForRelease = (
  metadataStore: MetadataStore,
  projectReleaseId: string,
): NgeeAnnSectionManifest => {
  const projectRelease = metadataStore.energyIq.templates.getProjectRevision(projectReleaseId);
  if (!projectRelease) return disabledManifest(projectReleaseId, "SCHOOL_HOLIDAY_RELEASE_MANIFEST_NOT_FOUND");
  if (projectRelease.project_id !== "ngee-ann-polytechnic") {
    throw new Error(`ENERGYIQ_NGEE_ANN_PROJECT_RELEASE_NOT_FOUND:${projectReleaseId}`);
  }
  const overviewDefinition = metadataStore.energyIq.overviewDefinitions.get(projectReleaseId);
  const reportTimePolicy = overviewDefinition
    ? metadataStore.energyIq.reportTimePolicies.get(
      projectRelease.project_id,
      overviewDefinition.time_policy_revision_id,
    )
    : null;
  const manifest = resolveNgeeAnnSectionManifest({
    projectRelease,
    overviewDefinition,
    reportTimePolicy,
  });
  if (!manifest.enabledSectionIds.includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID)) return manifest;
  const calendar = metadataStore.energyIq.operationalPolicy
    .listOperatingCalendars(projectRelease.project_id)
    .find(({ version_id }) => version_id === projectRelease.business_calendar_version);
  if (!calendar) return disabledManifest(projectReleaseId, "SCHOOL_HOLIDAY_CALENDAR_REVISION_NOT_FOUND");
  if (!calendar.academic_periods?.length) {
    return disabledManifest(projectReleaseId, "SCHOOL_HOLIDAY_ACADEMIC_PERIODS_NOT_CONFIGURED");
  }
  if (!ngeeAnnHolidayCalendarHasRequiredContract(calendar)) {
    return disabledManifest(projectReleaseId, "SCHOOL_HOLIDAY_CALENDAR_CONTRACT_INVALID");
  }
  const rule = metadataStore.energyIq.rules.listRevisions()
    .find(({ revision_id }) => revision_id === SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION);
  return rule ? manifest : disabledManifest(projectReleaseId, "SCHOOL_HOLIDAY_RULE_REVISION_NOT_FOUND");
};

const disabledManifest = (
  projectReleaseId: string,
  reason: HolidayDisabledReason,
): NgeeAnnSectionManifest => ({
  contract: "energyiq-ngee-ann-section-manifest@1",
  projectReleaseId,
  enabledSectionIds: [...NGEE_ANN_CORE_SECTION_IDS],
  disabledCapabilities: [{ sectionId: NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID, reason }],
});

const holidayDisabledReason = (input: {
  projectRelease: ReleaseManifestInput;
  overviewDefinition: OverviewDefinitionInput;
  reportTimePolicy?: ReportTimePolicyInput;
}): HolidayDisabledReason | null => {
  if (!input.projectRelease.business_calendar_version.trim()) {
    return "SCHOOL_HOLIDAY_CALENDAR_REVISION_NOT_PINNED";
  }
  if (input.projectRelease.business_calendar_version !== NGEE_ANN_HOLIDAY_CALENDAR_VERSION) {
    return "SCHOOL_HOLIDAY_CALENDAR_CONTRACT_INVALID";
  }
  if (!input.projectRelease.selected_rule_revision_ids.includes(SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION)) {
    return "SCHOOL_HOLIDAY_RULE_REVISION_NOT_PINNED";
  }
  const definition = input.overviewDefinition;
  const exactDefinition = definition
    && definition.template_revision_id === input.projectRelease.revision_id
    && definition.renderer_key === "ngee-ann-overview"
    ? definition
    : null;
  const section = exactDefinition?.definition.sections
    .find(({ key }) => key === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID);
  if (!section) return "SCHOOL_HOLIDAY_OVERVIEW_SECTION_NOT_PINNED";
  if (!(section.primaryWindowId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID
      || section.supportingWindowIds.includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID))
    || !section.blocks.some(({ windowId }) => windowId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID)) {
    return "SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_PINNED";
  }
  const policy = input.reportTimePolicy;
  if (!policy || policy.revision_id !== definition?.time_policy_revision_id) {
    return "SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_REGISTERED";
  }
  const window = policy.policy.windows
    .find(({ windowId }) => windowId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID);
  if (!window) return "SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_REGISTERED";
  return isExactHolidayWindowStrategy(window)
    ? null
    : "SCHOOL_HOLIDAY_COMPARISON_WINDOW_STRATEGY_INVALID";
};

export const ngeeAnnHolidayCalendarHasRequiredContract = (value: unknown): boolean => {
  if (!isRecord(value)
    || value.version_id !== NGEE_ANN_HOLIDAY_CALENDAR_VERSION
    || !Array.isArray(value.academic_periods)
    || value.academic_periods.length === 0
    || !Array.isArray(value.entries)) return false;
  if (value.entries.length !== 1 || !holidayWeeklyBoundaryHasRequiredContract(value.entries[0])) {
    return false;
  }
  const exceptions = value.entries.flatMap((entry) => (
    isRecord(entry) && Array.isArray(entry.exceptions) ? entry.exceptions : []
  ));
  return SINGAPORE_2026_PUBLIC_HOLIDAYS.every((expected) => {
    const matches = exceptions.filter((candidate) => (
      isRecord(candidate)
      && candidate.date === expected.date
      && candidate.classification === "public_holiday"
    ));
    return matches.length === 1;
  });
};

const holidayWeeklyBoundaryHasRequiredContract = (value: unknown): boolean => {
  if (!isRecord(value) || !isRecord(value.weekly)) return false;
  const weekly = value.weekly;
  const exactOperatingDay = (day: unknown): boolean => (
    Array.isArray(day)
    && day.length === 1
    && isRecord(day[0])
    && day[0].from === "08:00"
    && day[0].to === "18:00"
  );
  const exactClosedDay = (day: unknown): boolean => Array.isArray(day) && day.length === 0;
  return ["monday", "tuesday", "wednesday", "thursday", "friday"]
    .every((day) => exactOperatingDay(weekly[day]))
    && ["saturday", "sunday"].every((day) => exactClosedDay(weekly[day]));
};

const isExactHolidayWindowStrategy = (window: {
  role?: string;
  strategy: unknown;
}): boolean => {
  if (window.role !== "comparison" || !isRecord(window.strategy)) return false;
  return window.strategy.kind === "rolling_complete_days"
    && window.strategy.days === 120;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

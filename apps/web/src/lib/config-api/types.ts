import type {
  AdditionalAiInsightsArtifact,
  EvidenceRef,
  PreschoolHtmlAiSlotId,
  ReportTimeBasis,
  ReportTimeContext,
} from "@datafoundry/contracts";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "DATASOURCE_TEST_FAILED"
  | "EMAIL_NOT_VERIFIED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "JOB_NOT_FOUND"
  | "NOT_ENABLED"
  | "PARSE_FAILED"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_RATE_LIMITED"
  | "RATE_LIMITED"
  | "PROVIDER_TEST_FAILED"
  | "REINDEX_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "SECRET_MASTER_KEY_REQUIRED"
  | "SQL_BLOCKED"
  | "SQL_TIMEOUT"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_FILE_TYPE";

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: ApiErrorCode; message: string } };

export class ConfigApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ConfigApiError";
    this.code = code;
    this.status = status;
  }
}

export type DevIdentityUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  devToken?: string;
};

export type IdentityWorkspace = {
  id: string;
  name?: string;
};

export type MeResponseDto = {
  user: DevIdentityUser;
  workspace: IdentityWorkspace;
};

export type EnergyRole = "user" | "admin";

export type EnergyWorkspaceDto = {
  id: string;
  name: string;
  kind: "personal" | "customer";
  disabled: boolean;
};

export type EnergyAdminOrganisationDto = {
  id: string;
  name: string;
  status: "active" | "disabled";
  userCount: number;
  projectCount: number;
  projects: Array<{ id: string; name: string; status: string }>;
  createdAt: string;
};

export type EnergyAdminUserDto = {
  id: string;
  displayName?: string;
  email?: string;
  role: EnergyRole;
  status: "pending" | "active" | "disabled";
  organisationIds: string[];
  organisations: Array<{ id: string; name: string }>;
  projectIds: string[];
  lastLoginAt?: string;
  createdAt: string;
};

export type EnergyProjectDto = {
  id: string;
  workspaceId: string;
  name: string;
  status: "draft" | "published" | "archived";
  timezone: string;
  capabilities?: { readReports: boolean; readExplorer: boolean; readProjectInformation: boolean; readOwnHistory: boolean; createReport: boolean; manageSkills: boolean; manageAutomation: boolean; editConfiguration: boolean; publishConfiguration: boolean };
};

export type EnergyDeliveryStage = "draft" | "configured" | "published";

export type EnergyProjectRecordDto = {
  id: string;
  workspace_id: string;
  name: string;
  status: "draft" | "published" | "archived";
  timezone: string;
  hierarchy_revision_id: string;
  meter_formula_revision_id: string;
  data_snapshot_id: string;
  metric_version: string;
  business_calendar_version: string;
  tariff_schedule_version: string;
  delivery_stage: EnergyDeliveryStage;
  root_scope_id: string;
  has_unpublished_changes: boolean;
};

export type EnergyTierDefinitionDto = {
  id: string;
  ordinal: number;
  alias: string;
  description?: string;
};

export type EnergyProjectSetupNodeDto = {
  id: string;
  tier_definition_id: string;
  parent_id?: string;
  name: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_status: "provisional" | "confirmed";
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
  metadata?: Record<string, unknown>;
};

export type EnergyMeterCategoryDto = "overall" | "load" | "light" | "aircon" | "it" | "kitchen" | "plug" | "other";
export type EnergyMeterCoverageDto = "whole" | "partial" | "reference";
export type EnergyMeterRoleDto = "total" | "component" | "standalone";
export type EnergyAggregationUsageDto = "official" | "excluded";

export type EnergyMeterMappingRowDto = {
  presentation?: { device_name?: string; circuit_name?: string; group?: string };
  id: string;
  source_label: string;
  scope_id: string;
  navigation_scope_id?: string;
  display_name: string;
  resource: "electricity" | "water";
  category: EnergyMeterCategoryDto;
  coverage: EnergyMeterCoverageDto;
  meter_role: EnergyMeterRoleDto;
  aggregation_usage: EnergyAggregationUsageDto;
};

export type EnergyOfficialAggregationRouteDto = {
  scope_id: string;
  resource: "electricity" | "water";
  category: EnergyMeterCategoryDto;
  meter_point_ids: string[];
};

export type EnergyVirtualMeterTermDto = {
  mapping_row_id: string;
  coefficient: 1 | -1;
};

export type EnergyVirtualMeterDto = {
  presentation?: { device_name?: string; circuit_name?: string; group?: string };
  id: string;
  display_name: string;
  scope_id: string;
  resource: "electricity" | "water";
  category: EnergyMeterCategoryDto;
  terms: EnergyVirtualMeterTermDto[];
};

export type EnergyMeterMappingDraftDto = {
  schema_version: 2;
  source_kind: "excel" | "tuya";
  rows: EnergyMeterMappingRowDto[];
  official_aggregation_routes?: EnergyOfficialAggregationRouteDto[];
  virtual_meters?: EnergyVirtualMeterDto[];
  confirmed: boolean;
};

export type EnergyExcelImportInspectionDto = {
  sheetName?: string;
  columns: string[];
  sourceLabels: Array<{ label: string; rowCount: number }>;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  duplicateReadingCount: number;
  negativeReadingCount: number;
  coverageFrom?: string;
  coverageTo?: string;
  typicalIntervalMinutes?: number;
  readingKind: "cumulative";
  qualityStatus: "ready" | "needs_review";
  issues: string[];
};

export type EnergyImportBatchDto = {
  id: string;
  projectId: string;
  sourceKind: "excel" | "tuya";
  sourceSha256: string;
  filename: string;
  status: "inspected" | "materialized" | "failed";
  inspection: EnergyExcelImportInspectionDto;
  materialization?: {
    rawRowCount: number;
    normalizedReadingCount: number;
    intervalFactCount: number;
    totalUsageKwh: number;
    qualityCounts: Record<string, number>;
    mappingRevision: number;
    mappingFingerprint: string;
    timezone: string;
    materializerContractVersion: string;
    factWriterContractVersion: string;
  };
  materializedAt?: string;
  createdAt: string;
};

export type EnergyDataSnapshotDto = {
  id: string;
  projectId: string;
  manifest: unknown;
  audit: Record<string, unknown>;
  createdAt: string;
};

export type EnergyProjectDataReadinessDto = {
  status: "not_required" | "blocked" | "ready";
  ready: boolean;
  requiresFormalData: boolean;
  importBatchCount: number;
  materializedBatchCount: number;
  sourceLabelCount: number;
  mappedSourceLabelCount: number;
  unmappedSourceLabels: string[];
  inactiveMappingSourceLabels: string[];
  mappingConfirmed: boolean;
  dataSnapshotId?: string;
  blockingReasons: string[];
  warnings: string[];
  audit?: Record<string, unknown>;
};

export type EnergyImportBatchesResponseDto = {
  batches: EnergyImportBatchDto[];
  dataSnapshot?: EnergyDataSnapshotDto;
  readiness: EnergyProjectDataReadinessDto;
};

export type EnergyImportMaterializationResponseDto = {
  batch: EnergyImportBatchDto;
  dataSnapshot?: EnergyDataSnapshotDto;
  readiness: EnergyProjectDataReadinessDto;
  duplicate: boolean;
};

/** Which saved report a project's Overview page shows. Absent means "monthly". */
export type EnergyOverviewCadenceDto = "monthly" | "weekly";

export type EnergyProjectSetupDocumentDto = {
  project: { name: string; timezone: string; overview_cadence?: EnergyOverviewCadenceDto };
  tier_structure_locked: boolean;
  tiers: EnergyTierDefinitionDto[];
  nodes: EnergyProjectSetupNodeDto[];
  source_manifest?: EnergySourceManifestDto;
  meter_mapping?: EnergyMeterMappingDraftDto;
};

export type EnergySourceManifestDto = {
  id: string;
  source_sha256: string[];
  confirmed: boolean;
};

export type EnergyProjectSetupDraftDto = {
  project_id: string;
  revision: number;
  based_on_hierarchy_revision_id?: string;
  document: EnergyProjectSetupDocumentDto;
  updated_by: string;
  updated_at: string;
};

export type EnergyProjectSetupIssueDto = {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
};

export type EnergyProjectSetupValidationDto = {
  blocking: boolean;
  issues: EnergyProjectSetupIssueDto[];
};

export type EnergyHierarchyRevisionDto = {
  id: string;
  project_id: string;
  sequence: number;
  published_by: string;
  published_at: string;
};

export type EnergyProjectOverviewProfileDto = {
  rendererKey: EnergyProjectRendererKeyDto;
  rendererVersion: "1";
  contractVersion: "project-analysis-snapshot@1";
  currentAnalysisWindow: "current-overview-7d" | "current-overview-28d" | "current-month-to-date";
  source: "overview-definition" | "legacy-profile";
  horizons: {
    latestStatus: "latest-complete-day";
    shortTermDays: 7;
    mainDays: 7 | 28;
  };
};

export type EnergyProjectSetupDto = {
  project: EnergyProjectRecordDto;
  overviewProfile: EnergyProjectOverviewProfileDto | null;
  draft: EnergyProjectSetupDraftDto;
  validation: EnergyProjectSetupValidationDto;
  published: {
    tiers: EnergyTierDefinitionDto[];
    nodes: EnergyProjectNodeDto[];
    revisions: EnergyHierarchyRevisionDto[];
    templateRevisions: EnergyTemplateRevisionDto[];
  };
};

/** Whether each meter is actually reporting, so a site can notice one that stopped. */
/** The bell's site alerts: automatic reports that are ready and, for administrators, a failed daily live update. */
export type EnergyProjectAlertsDto = {
  reports: Array<{ key: string; reportId: string; cadence: "daily" | "weekly" | "monthly" | "other"; from: string; toExclusive: string; finishedAt: string }>;
  sync?: { key: string; failedAt: string; reason: "ip-blocked" | "sign-in" | "other" };
  readKeys: string[];
};

export type EnergyMeterHealthDto = {
  meters: Array<{
    meterPointId: string;
    name: string;
    sourceLabel: string;
    status: "usable" | "insufficient_history" | "no_readings";
    lastReadingAt?: string;
  }>;
  summary: { total: number; usable: number; insufficientHistory: number; noReadings: number };
  dataThrough?: string;
};

export type EnergyAccessContextDto = {
  role: EnergyRole;
  user: {
    id: string;
    email?: string;
    displayName?: string;
  };
  activeWorkspaceId: string;
  workspaces: EnergyWorkspaceDto[];
  projects: EnergyProjectDto[];
};

export type EnergyQueryContextRequestDto = {
  projectId: string;
  scopeId?: string;
  resource?: "electricity" | "water";
  period?: "Yesterday" | "Last 7 days" | "Last 30 days" | "Previous week" | "Previous month" | "Custom";
  from?: string;
  to?: string;
  analysisWindow?: "all-available" | "latest-complete-day" | "latest-complete-7d" | "current-project-overview" | "current-overview-28d" | "current-month-to-date";
  surface?: "project-explorer";
  expectedDataSnapshotId?: string;
  expectedProjectReleaseId?: string | null;
  expectedHierarchyRevisionId?: string;
  expectedMeterMappingRevisionId?: string;
  expectedMeterFormulaRevisionId?: string;
};

export type EnergyProjectDataCoverageDto = {
  from: string;
  to: string;
  intervalCount: number;
};

export type EnergyQueryContextDto = {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: "electricity" | "water";
  timezone: string;
  from: string;
  to: string;
  endExclusive: true;
  period: EnergyQueryContextRequestDto["period"];
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  projectReleaseId?: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  resolvedAt: string;
};

export type EnergyPolicyUnavailableReasonDto = {
  code:
    | "TARIFF_VERSION_MISSING"
    | "TARIFF_VERSION_NOT_FOUND"
    | "TARIFF_NOT_EFFECTIVE_FOR_PERIOD"
    | "TARIFF_CURRENCY_CONFLICT"
    | "COST_FACTS_UNAVAILABLE"
    | "OPERATING_CALENDAR_VERSION_MISSING"
    | "OPERATING_CALENDAR_VERSION_NOT_FOUND"
    | "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD"
    | "OPERATING_FACTS_UNAVAILABLE";
  message: string;
};

export type EnergyAnalysisComparisonDto = {
  usageKwh: number;
  changeKwh: number;
  changePct: number | null;
};

export type EnergyAnalysisDataHealthDto = {
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

export type EnergyDailyTotalsDto = {
  metricId: "energy.total_usage_kwh@1";
  grain: "day";
  timezone: string;
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    rows: Array<{
      localDate: string;
      from: string;
      to: string;
      usageKwh: number | null;
      dataHealth: EnergyTimeBucketDataHealthDto;
    }>;
  }>;
};

export type EnergyComponentCategoryBreakdownDto = {
  metricId: "energy.total_usage_kwh@1";
  queryId: "daily_component_categories_v1";
  accountingBasis: "published_component_circuits";
  grain: "day";
  timezone: string;
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    period: {
      status: "complete" | "partial" | "unavailable";
      reason: string | null;
      officialUsageKwh: number | null;
      componentUsageKwh: number | null;
      gapKwh: number | null;
      ratioPct: number | null;
      categories: Array<{
        category: string;
        usageKwh: number | null;
        sharePct: number | null;
      }>;
    };
    rows: Array<{
      localDate: string;
      from: string;
      to: string;
      dayType: "weekday" | "weekend" | "public_holiday" | null;
      officialUsageKwh: number | null;
      componentUsageKwh: number | null;
      categories: Array<{
        category: string;
        usageKwh: number | null;
        sharePct: number | null;
      }>;
      estimatedCost: {
        status: "available";
        amount: number;
        currency: string;
        ratePerKwh: number;
        tariffScheduleVersion: string;
      } | {
        status: "unavailable";
        reason: string;
      };
      dataHealth: EnergyTimeBucketDataHealthDto;
    }>;
  }>;
};

export type EnergyCalendarTotalsDto = {
  metricId: "energy.total_usage_kwh@1";
  timezone: string;
  derivedFromQueryId: "daily_totals_v1";
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    weeks: EnergyCalendarTotalRowDto[];
    months: EnergyCalendarTotalRowDto[];
  }>;
};

export type EnergyCalendarTotalRowDto = {
  localFrom: string;
  localToInclusive: string;
  from: string;
  to: string;
  usageKwh: number | null;
  isPartialCalendarPeriod: boolean;
  dataHealth: EnergyTimeBucketDataHealthDto;
};

export type EnergyTimeBucketDataHealthDto = EnergyAnalysisDataHealthDto & {
  status: "complete" | "partial" | "unavailable";
  aggregateStatus?: "complete" | "partial" | "unavailable";
  aggregateCoveragePct?: number;
  aggregateEligibleIntervalCount?: number;
  cadenceGapEventCount?: number;
};

export type EnergyTimeBehaviourDto = {
  metricId: "energy.total_usage_kwh@1";
  grain: "hour";
  unit: "kWh";
  timezone: string;
  queryId: "time_bucket_grid_v1";
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    cells: Array<{
      localDate: string;
      localHour: number;
      from: string;
      to: string;
      usageKwh: number | null;
      dataHealth: EnergyTimeBucketDataHealthDto;
    }>;
  }>;
  dayProfiles: Array<{
    dayType: "weekday" | "weekend" | "public_holiday";
    scopeId: string;
    scopeName: string;
    status: "available";
    sampleDayCount: number;
    values: Array<{
      localHour: number;
      usageKwh: number;
    }>;
  } | {
    dayType: "weekday" | "weekend" | "public_holiday";
    scopeId: string;
    scopeName: string;
    status: "unavailable";
    reason: {
      code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE";
      message: string;
    };
  }>;
};

export type EnergyComponentHourlyProfilesDto = {
  metricId: "energy.total_usage_kwh@1";
  queryId: "component_hourly_profiles_v1";
  accountingBasis: "published_component_circuits";
  grain: "hour";
  unit: "kWh";
  timezone: string;
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    profiles: Array<{
      dayType: "weekday" | "weekend" | "public_holiday";
      status: "available";
      sampleDayCount: number;
      categories: Array<{
        category: string;
        values: Array<{ localHour: number; usageKwh: number }>;
      }>;
      circuits: Array<{
        meterNodeId: string;
        name: string;
        category: string;
        values: Array<{ localHour: number; usageKwh: number }>;
      }>;
    } | {
      dayType: "weekday" | "weekend" | "public_holiday";
      status: "unavailable";
      reason: {
        code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE";
        message: string;
      };
    }>;
  }>;
};

export type EnergyDailyUsageAnomalySuppressionCodeDto =
  | "CALENDAR_EXCEPTION_DATE"
  | "DAILY_FACTS_UNAVAILABLE"
  | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE"
  | "COVERAGE_BELOW_THRESHOLD"
  | "QUALITY_EVENT_PRESENT"
  | "BASELINE_SAMPLE_COUNT_INSUFFICIENT"
  | "BASELINE_VALUE_UNAVAILABLE";

export type EnergyDailyUsageAnomaliesDto = {
  status: "available";
  bundleId: string;
  metricId: "energy.total_usage_kwh@1";
  queryId: "time_slot_anomaly_v1";
  ruleRevisionId: string;
  timezone: string;
  baselineCutoff: string;
  rule: {
    relativeThresholdPct: number;
    absoluteImpactKwh: number;
    minimumCoveragePct: number;
    minimumSampleCount: number;
    maximumQualityEventCount: number;
    maximumLookbackDays: number;
    direction: "above";
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour";
  };
  evidencePins: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    businessCalendarVersion: string;
    queryIds: ["time_slot_anomaly_v1"];
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    rollingComparisons: Array<{
      horizon: "rolling_7d" | "rolling_28d";
      cutoffLocalDate: string;
      current: {
        fromLocalDate: string;
        toLocalDate: string;
        totalKwh: number | null;
        completeDayCount: number;
      };
      baseline: {
        fromLocalDate: string;
        toLocalDate: string;
        totalKwh: number | null;
        completeDayCount: number;
      };
    } & ({
      status: "available";
      deltaKwh: number;
      relativePct: number;
    } | {
      status: "unavailable";
      reason: {
        code: "INCOMPLETE_HORIZON_EVIDENCE" | "NON_POSITIVE_HORIZON_BASELINE";
        message: string;
      };
    })>;
    rows: Array<{
      anomalyId: string;
      incidentId: string;
      ruleRevisionId: string;
      metricId: "energy.total_usage_kwh@1";
      queryId: "time_slot_anomaly_v1";
      localDate: string;
      from: string;
      to: string;
      dayType: "weekday" | "weekend" | null;
      baselineDates: string[];
      baselineSampleCount: number;
      baselineSamples: Array<{
        localDate: string;
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
        eligible: true;
      }>;
      actualKwh: number | null;
      baselineKwh: number | null;
      impactKwh: number | null;
      relativePct: number | null;
      thresholds: {
        relativeThresholdPct: number;
        absoluteImpactKwh: number;
        minimumCoveragePct: number;
        maximumQualityEventCount: number;
      };
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
      outcome: "triggered" | "within_threshold" | "suppressed";
      suppressionReason?: {
        code: EnergyDailyUsageAnomalySuppressionCodeDto;
        message: string;
      };
      hourlyComparison: Array<{
        localHour: number;
        actualKwh: number | null;
        baselineKwh: number | null;
        impactKwh: number | null;
        relativePct: number | null;
      }>;
      detailSeries: Array<{
        seriesId: string;
        relationship: "selected_scope" | "immediate_level" | "component_circuit";
        kind: "official_scope" | "component_circuit";
        scopeId: string;
        scopeName: string;
        meterNodeId?: string;
        category?: string;
        includedInOfficialTotal: boolean;
        status: "available" | "partial" | "unavailable";
        selectedTotalKwh: number | null;
        baselineTotalKwh: number | null;
        impactKwh: number | null;
        relativePct: number | null;
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
        points: Array<{
          localHour: number;
          selectedKwh: number | null;
          baselineKwh: number | null;
          impactKwh: number | null;
        }>;
      }>;
    }>;
  }>;
} | {
  status: "unavailable";
  ruleRevisionId: string;
  reason: {
    code:
      | "BUSINESS_CALENDAR_VERSION_MISSING"
      | "BUSINESS_CALENDAR_VERSION_NOT_FOUND"
      | "BUSINESS_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD"
      | "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE"
      | "DAILY_USAGE_ANOMALY_RULE_INVALID";
    message: string;
  };
};

export type NgeeAnnDecisionPriorityEvidencePinsDto = Extract<
  EnergyDailyUsageAnomaliesDto,
  { status: "available" }
>["evidencePins"];

export type NgeeAnnDecisionPriorityLimitationDto = {
  code:
    | "DAILY_USAGE_ANOMALIES_ABSENT"
    | "DAILY_USAGE_ANOMALIES_UNAVAILABLE"
    | "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH"
    | "EVIDENCE_PINS_MISMATCH"
    | "ALL_CANDIDATE_DATES_SUPPRESSED"
    | "SOME_CANDIDATE_DATES_SUPPRESSED"
    | "SUPPORTING_EVIDENCE_PARTIAL";
  message: string;
};

export type NgeeAnnDecisionPriorityDto = {
  priorityId: string;
  rank: 1 | 2 | 3;
  source: "daily_usage_anomaly";
  finding: {
    code: "DAILY_USAGE_ABOVE_BASELINE";
    title: string;
    actualKwh: number;
    baselineKwh: number;
    relativePct: number;
  };
  sourceOccurrenceIds: string[];
  recurrenceDayCount: number;
  horizons: Array<{
    horizon: "latest_complete_day" | "rolling_7d" | "rolling_28d";
    label: "Latest complete day" | "Rolling 7 days" | "Rolling 28 days";
    status: "available" | "unavailable";
    period: { fromLocalDate: string; toLocalDate: string };
    actualKwh: number | null;
    baselineKwh: number | null;
    deltaKwh: number | null;
    relativePct: number | null;
    limitation: string | null;
  }>;
  driver: {
    status: "available";
    kind: "official_scope" | "component_circuit";
    scopeId: string;
    label: string;
    impactKwh: number;
    limitation: "Evidence only; not a confirmed root cause.";
  } | {
    status: "unavailable";
    limitation: string;
  };
  evidence: {
    bundleId: string;
    metricId: "energy.total_usage_kwh@1";
    queryIds: ["time_slot_anomaly_v1"];
    ruleRevisionId: "comparison.daily_usage_above_baseline@1";
    period: { from: string; to: string };
    occurrence: {
      scopeId: string;
      scopeName: string;
      scopeType: string;
      localDate: string;
      from: string;
      to: string;
    };
    primaryIncidentId: string;
    supportingIncidentIds: string[];
  };
  impact: {
    energy: { status: "available"; deltaKwh: number };
    cost: {
      status: "unavailable";
      reason: {
        code: "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE";
        message: string;
      };
    };
  };
  action: {
    code: "INSPECT_DAILY_USAGE_DRIVERS";
    label: string;
    targetIncidentId: string;
    targetRef: { kind: "daily_usage_incident"; id: string };
    nextCheck: string;
    verificationMetricRef: {
      metricId: "energy.total_usage_kwh@1";
      label: string;
    };
  };
  confidence: {
    status: "complete" | "partial";
    limitation: NgeeAnnDecisionPriorityLimitationDto | null;
  };
};

export type NgeeAnnDecisionPrioritiesDto = {
  status: "available" | "empty" | "partial" | "suppressed" | "unavailable";
  limitation: NgeeAnnDecisionPriorityLimitationDto | null;
  evidencePins: NgeeAnnDecisionPriorityEvidencePinsDto;
  items: NgeeAnnDecisionPriorityDto[];
};

export type NgeeAnnDecisionLifecycleDto = {
  status: "available" | "unavailable";
  reference: {
    savedAnalysisId: string;
    dataSnapshotId: string;
    createdAt: string;
    evidenceStatus: "available" | "incomplete" | "unavailable";
  } | null;
  currentDataSnapshotId: string;
  items: Array<{
    themeKey: string;
    kind: "new" | "newly_supported" | "recurring" | "resolved" | "no_longer_supported";
    currentPriorityId: string | null;
    currentBundleId: string | null;
    previousBundleId: string | null;
  }>;
  limitation: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS" | "CURRENT_THEME_EVIDENCE_INCOMPLETE";
    message: string;
  } | null;
};

export type EnergyPeakIntervalDataHealthDto = EnergyAnalysisDataHealthDto & {
  status: "complete" | "unavailable";
};

export type EnergyPeakBreakdownDto = {
  status: "available";
  metricId: "energy.peak_demand_kw@1";
  intervalMinutes: number;
  timezone: string;
  unit: "kW";
  periodStatus: "complete" | "partial";
  coveragePct: number;
  peak: {
    from: string;
    to: string;
    averageKw: number;
    dataHealth: EnergyPeakIntervalDataHealthDto;
  };
  levels: Array<{
    scopeId: string;
    scopeName: string;
    averageKw: number;
    sharePct: number;
    dataHealth: EnergyPeakIntervalDataHealthDto;
    circuits: Array<{
      meterNodeId: string;
      name: string;
      category: string;
      averageKw: number | null;
      sharePct: number | null;
      includedInOfficialTotal: false;
      dataHealth: EnergyPeakIntervalDataHealthDto;
    }>;
  }>;
} | {
  status: "unavailable";
  reason: {
    code:
      | "PEAK_AT_MISSING"
      | "PEAK_INTERVAL_FACTS_UNAVAILABLE"
      | "PEAK_INTERVAL_FACTS_AMBIGUOUS"
      | "PEAK_INTERVAL_FACTS_REJECTED";
    message: string;
  };
};

export type EnergyVirtualMeterTraceTermDto = {
  meterNodeId: string;
  name: string;
  coefficient: 1 | -1;
  inputUsageKwh: number | null;
  contributionKwh: number | null;
  dataHealth: EnergyAnalysisDataHealthDto | null;
};

export type EnergyVirtualMeterTraceDto = {
  meterNodeId: string;
  name: string;
  scopeId: string;
  status: "available" | "partial";
  usageKwh: number | null;
  includedInOfficialTotal: false;
  missingTermMeterNodeIds: string[];
  terms: EnergyVirtualMeterTraceTermDto[];
};

export type EnergyCircuitAnalysisDto = {
  meterNodeId: string;
  name: string;
  appliance: string;
  category: string;
  meterRole: string;
  usageKwh: number;
  sharePct: number;
  nonOperatingKwh?: number;
  peakKw: number;
  qualityEventCount: number;
  scopeId?: string;
  parentScopeId?: string;
  includedInOfficialTotal?: boolean;
  comparison?: EnergyAnalysisComparisonDto;
  dataHealth?: EnergyAnalysisDataHealthDto;
};

export type EnergyReportingHealthDto = {
  latestReadingAt: string;
  shortDays: Array<{
    localDate: string;
    usageKwh: number;
    observedIntervalCount: number;
    expectedIntervalCount: number;
  }>;
  stoppedMeters: Array<{
    meterNodeId: string;
    lastReadingAt: string;
  }>;
};

export type EnergyScopeAnalysisDto = {
  monitoringMode?: "api" | "file" | "unknown";
  context: EnergyQueryContextDto;
  /**
   * What each meter has actually sent. Absent on an analysis projected before
   * this existed, so every reader treats it as optional.
   */
  reportingHealth?: EnergyReportingHealthDto;
  latestAvailablePeriod?: {
    period: "Custom";
    from: string;
    to: string;
  };
  latestAcceptedReading: {
    status: "available";
    valueKwh: number;
    recordedAt: string;
    meterNodeId: string;
    sourceFile: string;
    sourceSha256: string;
    sourceReadingKind: "cumulative_energy";
    queryId: "latest_accepted_reading_v1";
  } | {
    status: "not_applicable";
    queryId: "latest_accepted_reading_v1";
    reason: {
      code: "LEAF_METER_REQUIRED" | "INTERVAL_USAGE_SOURCE";
      message: string;
    };
  } | {
    status: "unavailable";
    queryId: "latest_accepted_reading_v1";
    reason: {
      code: "ACCEPTED_CUMULATIVE_READING_UNAVAILABLE";
      message: string;
    };
  };
  summary: {
    usageKwh: number;
    averageDailyUsageKwh: number;
    peakKw: number;
    peakAt?: string;
    nonOperatingKwh?: number;
    nonOperatingSharePct?: number;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    validIntervalCount: number;
    qualityEventCount: number;
  };
  explorerTrends?: Array<{id: string; expectedMinutesPerHour: number; cells: Array<[string, number, number | null, number, number]>}>;
  hourlyProfile: Array<{
    hour: number;
    usageKwh: number;
    averageKw: number;
    peakKw: number;
    observationCount: number;
  }>;
  comparison: {
    from: string;
    to: string;
    usageKwh: number;
    changeKwh: number;
    changePct: number | null;
  };
  categories: Array<{
    category: string;
    usageKwh: number;
    sharePct: number;
    comparison?: EnergyAnalysisComparisonDto;
    dataHealth?: EnergyAnalysisDataHealthDto;
  }>;
  childScopes: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    usageKwh: number;
    sharePct: number;
    comparison?: EnergyAnalysisComparisonDto;
    dataHealth?: EnergyAnalysisDataHealthDto;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    topCircuitName?: string;
    topCircuitUsageKwh?: number;
  }>;
  circuits: EnergyCircuitAnalysisDto[];
  explorerMeters?: Array<{
    id: string; name: string; scopeId: string; kind: "physical" | "virtual";
    role: string; coverage: string; category: string; includedInOfficialTotal: boolean; formula?: string;
    displayGroup?: string; circuitName?: string;
  }>;
  topCircuits: EnergyScopeAnalysisDto["circuits"];
  designatedTotals?: EnergyCircuitAnalysisDto[];
  componentReconciliation?: {
    officialUsageKwh: number;
    componentUsageKwh: number;
    gapKwh: number;
    ratioPct: number | null;
    officialMeterNodeIds: string[];
    componentMeterNodeIds: string[];
  };
  virtualMeters: Array<{
    meterNodeId: string;
    name: string;
    scopeId: string;
    termMeterNodeIds: string[];
    usageKwh: number;
    includedInOfficialTotal: false;
  }>;
  dailyTotals?: EnergyDailyTotalsDto;
  componentCategoryBreakdown?: EnergyComponentCategoryBreakdownDto;
  calendarTotals?: EnergyCalendarTotalsDto;
  timeBehaviour?: EnergyTimeBehaviourDto;
  componentHourlyProfiles?: EnergyComponentHourlyProfilesDto;
  dailyUsageAnomalies?: EnergyDailyUsageAnomaliesDto;
  peakBreakdown?: EnergyPeakBreakdownDto;
  virtualMeterTraces?: EnergyVirtualMeterTraceDto[];
  offHours: {
    status: "available";
    operatingKwh: number;
    standbyKwh: number;
    usageKwh: number;
    sharePct: number;
    timezone: string;
    businessCalendarVersion: string;
  } | {
    status: "unavailable";
    reason: EnergyPolicyUnavailableReasonDto;
    businessCalendarVersion?: string;
  };
  cost: {
    status: "available";
    amount: number;
    currency: string;
    tariffScheduleVersion: string;
    allocations: Array<{
      from: string;
      to: string;
      ratePerKwh: number;
      rateBasis?: "tax_inclusive" | "tax_exclusive";
      tax?: { name: string; ratePct: number };
      taxInclusiveRatePerKwh?: number;
      taxExclusiveRatePerKwh?: number;
      usageKwh: number;
      cost: number;
    }>;
  } | {
    status: "unavailable";
    reason: EnergyPolicyUnavailableReasonDto;
    tariffScheduleVersion?: string;
  };
  dataHealth: {
    status: "complete" | "partial" | "unavailable";
    coveragePct: number;
    expectedMeterIntervalCount: number;
    validIntervalCount: number;
    qualityEventCount: number;
    cumulativeDeltaMismatchCount: number;
    averageKwMismatchCount: number;
    invalidIntervalDurationCount: number;
    lastSeenAt?: string;
    importBatchIds: string[];
  };
  units: {
    usage: "kWh";
    demand: "kW";
    intervalMinutes: number;
    timezone: string;
  };
  attention: Array<{
    code: string;
    severity: "info" | "warning";
    title: string;
    evidence: string;
    suggestedAction: string;
  }>;
  provenance: {
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    ruleRevisionIds: string[];
    aggregationRule: "designated_total" | "component" | "submeter" | "none";
    sourceView: string;
    queryIds: Array<
      | "scope_summary_v1"
      | "daily_totals_v1"
      | "daily_component_categories_v1"
      | "time_bucket_grid_v1"
      | "component_hourly_profiles_v1"
      | "time_slot_anomaly_v1"
      | "peak_breakdown_v1"
      | "hourly_profile_v1"
      | "meter_breakdown_v1"
      | "previous_meter_usage_v1"
      | "operational_policy_scope_intervals_v1"
      | "operational_policy_meter_intervals_v1"
      | "latest_accepted_reading_v1"
    >;
  };
};

export type EnergyOperationalPolicyOwnerDto =
  | { kind: "project" }
  | { kind: "scope"; scope_id: string };

export type EnergyOperationalPolicyOwnerInputDto =
  | { kind: "project" }
  | { kind: "scope"; scopeId: string };

export type EnergyOperatingDayDto =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type EnergyOperatingTimeRangeDto = { from: string; to: string };

export type EnergyCalendarExceptionClassificationDto =
  | "public_holiday"
  | "special_closure"
  | "special_operating_day";

export type EnergyTariffScheduleEntryDto = {
  id: string;
  owner: EnergyOperationalPolicyOwnerDto;
  effective_from: string;
  effective_to?: string;
  currency: string;
  rate_per_kwh: number;
  rate_basis?: "tax_inclusive" | "tax_exclusive";
  tax?: { name: string; rate_pct: number };
};

export type EnergyTariffScheduleRevisionDto = {
  version_id: string;
  project_id: string;
  entries: EnergyTariffScheduleEntryDto[];
  published_by: string;
  published_at: string;
};

export type EnergyOperatingCalendarEntryDto = {
  id: string;
  owner: EnergyOperationalPolicyOwnerDto;
  effective_from: string;
  effective_to?: string;
  weekly: Record<EnergyOperatingDayDto, EnergyOperatingTimeRangeDto[]>;
  exceptions?: Array<{
    date: string;
    operating: EnergyOperatingTimeRangeDto[];
    label?: string;
    classification?: EnergyCalendarExceptionClassificationDto;
  }>;
};

export type EnergyOperatingCalendarRevisionDto = {
  academic_periods?: Array<{ id: string; from: string; to: string; phase: "teaching" | "term_break" | "study_exam" | "vacation"; label?: string; source: { label: string; url?: string } }>;
  version_id: string;
  project_id: string;
  timezone: string;
  entries: EnergyOperatingCalendarEntryDto[];
  published_by: string;
  published_at: string;
};

export type EnergyOperationalPolicyConfigurationDto = {
  projectId: string;
  timezone: string;
  published: {
    tariff_schedule_version: string;
    business_calendar_version: string;
    template_revision_id?: string;
  };
  pending: {
    tariff_schedule_version: string;
    business_calendar_version: string;
  };
  tariffRevisions: EnergyTariffScheduleRevisionDto[];
  operatingCalendarRevisions: EnergyOperatingCalendarRevisionDto[];
  hasUnpublishedChanges: boolean;
};

export type EnergyTariffScheduleEntryInputDto = {
  owner: EnergyOperationalPolicyOwnerInputDto;
  effectiveFrom: string;
  effectiveTo?: string;
  currency: string;
  ratePerKwh: number;
  rateBasis?: "tax_inclusive" | "tax_exclusive";
  tax?: { name: string; ratePct: number };
};

export type EnergyOperatingCalendarEntryInputDto = {
  owner: EnergyOperationalPolicyOwnerInputDto;
  effectiveFrom: string;
  effectiveTo?: string;
  weekly: Record<EnergyOperatingDayDto, EnergyOperatingTimeRangeDto[]>;
  exceptions?: Array<{
    date: string;
    operating: EnergyOperatingTimeRangeDto[];
    label?: string;
    classification?: EnergyCalendarExceptionClassificationDto;
  }>;
};

export type EnergyProjectRendererKeyDto = "ngee-ann-overview" | "preschool-overview" | "tuya-office-overview" | "energy-template-overview";

export type EnergyMeterDataHealthStatusDto = "no_readings" | "insufficient_history" | "usable";

export type EnergyMeterDataHealthDto = {
  summary: {
    total: number;
    usable: number;
    insufficientHistory: number;
    noReadings: number;
  };
  meters: Array<{
    meterPointId: string;
    sourceLabel: string;
    status: EnergyMeterDataHealthStatusDto;
    cumulativeReadingCount: number;
    intervalFactCount: number;
    readingFrom?: string;
    readingTo?: string;
    coverageFrom?: string;
    coverageTo?: string;
  }>;
};

export type EnergyScopeMetadataEvidenceDto = {
  metadataRevisionId: string;
  hierarchyRevisionId: string;
  dimension: "area" | "headcount";
  value: number | null;
  status: "confirmed" | "provisional";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  timezone: string;
};

export type EnergyScopeMetadataValueDto = {
  status: "confirmed" | "provisional";
  value: number;
  unit: "m2" | "people";
  metadataRevisionIds: string[];
  hierarchyRevisionIds: string[];
  evidence: EnergyScopeMetadataEvidenceDto[];
} | {
  status: "missing";
  value: null;
  unit: "m2" | "people";
  reason: "not-configured" | "not-effective-for-period" | "ambiguous-effective-revisions" | "value-changes-within-period" | "invalid-value";
  guidance: string;
  metadataRevisionIds: string[];
  hierarchyRevisionIds: string[];
  evidence: EnergyScopeMetadataEvidenceDto[];
};

export type EnergyNormalisedMetricDto = {
  status: "confirmed" | "provisional";
  metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
  value: number;
  unit: "kWh/m2" | "kWh/person";
  metadataRevisionIds: string[];
  hierarchyRevisionIds: string[];
  evidence: EnergyScopeMetadataEvidenceDto[];
} | {
  status: "missing";
  metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
  value: null;
  unit: "kWh/m2" | "kWh/person";
  reason: "not-configured" | "not-effective-for-period" | "ambiguous-effective-revisions" | "value-changes-within-period" | "invalid-value" | "invalid-energy";
  guidance: string;
  metadataRevisionIds: string[];
  hierarchyRevisionIds: string[];
  evidence: EnergyScopeMetadataEvidenceDto[];
};

export type EnergyProjectAnalysisMetadataEvidenceDto = EnergyScopeMetadataEvidenceDto & {
  scopeId: string;
  scopeName: string;
};

export type EnergyProjectAnalysisScopeMetadataDto = {
  scopeId: string;
  scopeName: string;
  usageKwh: number;
  status: "confirmed" | "provisional" | "missing";
  area: EnergyScopeMetadataValueDto;
  headcount: EnergyScopeMetadataValueDto;
  normalisations: {
    eui: EnergyNormalisedMetricDto;
    perPax: EnergyNormalisedMetricDto;
  };
  evidence: EnergyProjectAnalysisMetadataEvidenceDto[];
};

export type EnergyProjectAnalysisMetadataDto = {
  status: "confirmed" | "provisional" | "missing";
  hierarchyRevisionId: string;
  timezone: string;
  period: {
    start: string;
    endExclusive: string;
  };
  selectedScope: EnergyProjectAnalysisScopeMetadataDto;
  comparisonScopes: EnergyProjectAnalysisScopeMetadataDto[];
  evidence: EnergyProjectAnalysisMetadataEvidenceDto[];
};

export type EnergyProjectAnalysisPayloadDto = Omit<EnergyScopeAnalysisDto, "childScopes"> & {
  metadata: EnergyProjectAnalysisMetadataDto;
  childScopes: Array<EnergyScopeAnalysisDto["childScopes"][number] & {
    metadata: EnergyProjectAnalysisScopeMetadataDto;
  }>;
};

export type EnergyPublishedProjectReleaseDto = {
  id: string;
  source: "template-revision" | "legacy-profile";
  projectId: string;
  templateRevisionId: string | null;
  templateRevisionSequence: number | null;
  reportTimePolicyRevisionId: string;
  recipe: {
    id: "energy-scope-analysis";
    version: "1";
  };
  renderer: {
    key: EnergyProjectRendererKeyDto;
    version: "1";
    contractVersion: "project-analysis-snapshot@1";
    aiPresentationMode?: "structured" | "html";
  };
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricRevisionIds: string[];
  ruleRevisionIds: string[];
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  publishedAt: string | null;
  document: EnergyTemplateDraftDocumentDto;
  catalog: EnergyComponentRevisionDto[];
};

export type PreschoolBenchmarkProjectionDto = {
  status: "provisional";
  contract: {
    id: "preschool-may-2026-benchmark";
    version: "1";
    annualisationFactor: number;
  };
  period: {
    start: string;
    endExclusive: string;
    timezone: string;
  };
  sampleSize: number;
  portfolio: {
    eui: { p50: number; p75: number; unit: "kWh/m2/year" };
    perPax: { p50: number; p75: number; unit: "kWh/person/month" };
  };
  cohorts: Array<{
    name: string;
    sampleSize: number;
    eui: { p50: number; p75: number; unit: "kWh/m2/year" };
    perPax: { p50: number; p75: number; unit: "kWh/person/month" };
  }>;
  centres: Array<{
    scopeId: string;
    centreCode: string;
    name: string;
    cohort: string;
    usageKwh: number;
    annualisedEuiKwhPerSqmYear: number;
    mayKwhPerPerson: number;
    quadrant: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity";
    priority: boolean;
  }>;
  priorityCentreCodes: string[];
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    metricRevisionIds: string[];
    metadataRevisionIds: string[];
    sourceQueryIds: string[];
    projectionRecipeIds: [
      "preschool-eui-benchmark-v1",
      "preschool-per-pax-benchmark-v1",
      "preschool-quadrant-v1",
    ];
    cohortSource: "published-hierarchy-node-metadata";
    metadataStatus: "provisional";
    normalisation: {
      eui: string;
      perPax: string;
    };
  };
};

export type PreschoolOperationalApplianceCompositionDto = {
  totalKwh: number;
  provisionalCostBeforeGstSgd: number | null;
  cost?: { currency: string; amount: number };
  reconciliationGapKwh: number;
  applianceGroups: Array<{
    name: string;
    usageKwh: number;
    sharePct: number;
    provisionalCostBeforeGstSgd: number | null;
    cost?: { currency: string; amount: number };
    sourceAliases: string[];
  }>;
  appliances: Array<{
    name: string;
    applianceGroup: string;
    usageKwh: number;
    sharePct: number;
    provisionalCostBeforeGstSgd: number | null;
    cost?: { currency: string; amount: number };
    centreCount: number;
    sourceCircuitIds: string[];
  }>;
};

export type PreschoolOperationalTariffCostDto = {
  status: "available";
  currency: string;
  tariffScheduleVersion: string;
  allocations: Array<{
    from: string;
    to: string;
    ratePerKwh: number;
    rateBasis?: "tax_inclusive" | "tax_exclusive";
    tax?: { name: string; ratePct: number };
    taxInclusiveRatePerKwh?: number;
    taxExclusiveRatePerKwh?: number;
    usageKwh: number;
    cost: number;
  }>;
  total: { usageKwh: number; amount: number };
  standby: { usageKwh: number; amount: number };
  operating: { usageKwh: number; amount: number };
} | {
  status: "unavailable";
  reason: EnergyPolicyUnavailableReasonDto;
  tariffScheduleVersion?: string;
};

export type PreschoolPlanningTariffCostDto = {
  status: "available";
  currency: string;
  tariffScheduleVersion: string;
  allocations: Extract<PreschoolOperationalTariffCostDto, { status: "available" }>["allocations"];
  projectedAmount: number;
  lowerAmount: number;
  upperAmount: number;
} | {
  status: "unavailable";
  reason: EnergyPolicyUnavailableReasonDto;
  tariffScheduleVersion?: string;
};

export type PreschoolOperationalProjectionDto = {
  status: "available";
  contract: {
    id: "preschool-may-2026-operational-behaviour" | "preschool-operational-behaviour";
    version: "2" | "3" | "4" | "5";
    spikeThresholdPct: 50;
  };
  period: {
    start: string;
    endExclusive: string;
    timezone: string;
  };
  coverage?: {
    status: "complete" | "partial";
    expectedCellCount: number;
    observedCellCount: number;
    missingCellCount: number;
    completeLocalDayCount: number;
    partialLocalDayCount: number;
    missingLocalHourCount: number;
  };
  energy: {
    totalKwh: number;
    standbyKwh: number;
    standbySharePct: number;
    operatingKwh: number;
    operatingSharePct: number;
    provisionalStandbyCostBeforeGstSgd: number | null;
    provisionalOperatingCostBeforeGstSgd: number | null;
  };
  tariffCost?: PreschoolOperationalTariffCostDto;
  tariffReference?: {
    sourceName: "SP Group";
    sourceUrl: string;
    appendixUrl: string;
    supplyClass: "Low tension, non-domestic";
    appliesFrom: "2026-04-01";
    appliesTo: "2026-06-30";
    beforeGstSgdPerKwh: 0.2727;
    withGstSgdPerKwh: 0.2972;
  };
  standbyAppliances: PreschoolOperationalApplianceCompositionDto;
  operatingAppliances: PreschoolOperationalApplianceCompositionDto;
  hourlyProfile: {
    completeDayCount: number;
    unit: "mean kWh per complete day" | "mean kWh per observed day";
    rows: Array<{
      localHour: number;
      operatingKwh: number;
      closedHourKwh: number;
      totalKwh: number;
      observedDayCount?: number;
    }>;
  };
  planningOutlook: {
    status: "provisional";
    contract: {
      id: "preschool-june-2026-naive-weekly-baseline" | "preschool-monthly-naive-weekly-baseline";
      version: "1" | "2";
      method: "mean of four complete Monday-Sunday weeks";
    };
    targetPeriod: {
      start: string;
      endInclusive: string;
      endExclusive?: string;
      timezone?: string;
      days: number;
    };
    sourceWeeks: Array<{
      start: string;
      endInclusive: string;
      usageKwh: number;
    }>;
    weeklyBaseline: {
      averageKwh: number;
      minimumKwh: number;
      maximumKwh: number;
    };
    usageEstimate: {
      projectedKwh: number;
      lowerKwh: number;
      upperKwh: number;
    };
    costEstimate?: {
      currency: "SGD";
      currentPeriodBeforeGstSgd: number;
      projectedBeforeGstSgd: number;
      lowerBeforeGstSgd: number;
      upperBeforeGstSgd: number;
    };
    tariffCost?: PreschoolPlanningTariffCostDto;
    tariffReference?: {
      sourceName: "SP Group";
      sourceUrl: string;
      appendixUrl: string;
      supplyClass: "Low tension, non-domestic";
      appliesFrom: "2026-04-01";
      appliesTo: "2026-06-30";
      beforeGstSgdPerKwh: 0.2727;
      withGstSgdPerKwh: 0.2972;
    };
    evidence: {
      dataSnapshotId: string;
      queryId: "daily_totals_v1";
      recipeId: "preschool-naive-weekly-planning-baseline-v1";
    };
    estimateSeries?: PreschoolPlanningEstimateSeriesDto;
    limitations: string[];
  } | {
    status: "unavailable";
    reason: {
      code: "PRESCHOOL_PLANNING_BASELINE_INCOMPLETE";
      message: string;
    };
  };
  spikes: Record<"standby" | "operating", {
    count: number;
    centreCount: number;
    centres: Array<{
      scopeId: string;
      centreCode: string;
      name: string;
      centreType: string | null;
      spikeCount: number;
      worstSpike: {
        localDate: string;
        localHour: number;
        dayType: "weekday" | "weekend" | "calendar_exception";
        usageKwh: number;
        baselineKwh: number;
        impactKwh: number;
        variancePct: number;
        leadingCircuitName: string;
        leadingCircuitKwh: number;
        leadingCircuitSharePct: number;
      };
      events: Array<{
        localDate: string;
        localHour: number;
        dayType: "weekday" | "weekend" | "calendar_exception";
        usageKwh: number;
        baselineKwh: number;
        impactKwh: number;
        variancePct: number;
        leadingCircuitName: string;
        leadingCircuitKwh: number;
        leadingCircuitSharePct: number;
      }>;
    }>;
  }>;
  sop: {
    status: "provisional";
    label: "Provisional after-hours SOP signal";
    baselineScore: 100;
    deductionPerStandbySpike: 1;
    breachingCentreCodes: string[];
    centres: Array<{
      scopeId: string;
      centreCode: string;
      name: string;
      centreType: string | null;
      standbySpikeCount: number;
      score: number;
    }>;
  };
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    metricRevisionIds: string[];
    businessCalendarVersion: string;
    sourceQueryIds: string[];
    projectionQueryId: "preschool_centre_hour_appliance_cells_v2";
    projectionRecipeIds: [
      "preschool-hour-slot-spike-v1",
      "preschool-after-hours-sop-signal-v1",
      "preschool-operating-state-appliance-v1",
    ];
    baseline: "same-centre same-hour-slot mean within operating state";
  };
} | {
  status: "unavailable";
  reason: {
    code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE"
      | "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED"
      | "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE"
      | "PRESCHOOL_OPERATIONAL_EVIDENCE_MISMATCH";
    message: string;
  };
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    businessCalendarVersion: string;
  };
};

type PreschoolProvisionalPlanningOutlookDto = Extract<
  Extract<PreschoolOperationalProjectionDto, { status: "available" }>["planningOutlook"],
  { status: "provisional" }
>;

type PreschoolSavedPlanningOutlookDto = Omit<PreschoolProvisionalPlanningOutlookDto, "tariffReference"> & {
  tariffReference?: PreschoolProvisionalPlanningOutlookDto["tariffReference"];
};

export type PreschoolPlanningEstimateSeriesDto = {
  contract: {
    id: "preschool-june-2026-estimate-series" | "preschool-monthly-estimate-series";
    version: "1" | "2";
    method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total"
      | "same-weekday mean from four complete weeks, scaled to the Saved Plan total";
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    scopeRole: "portfolio" | "centre";
    estimatedKwh: number;
    estimatedCostBeforeGstSgd: number | null;
    buckets: Record<"daily" | "weekly" | "monthly", Array<{
      start: string;
      endExclusive: string;
      estimatedKwh: number;
    }>>;
  }>;
};

export type PreschoolPlanningForecastDto = {
  status: "waiting" | "partial" | "complete";
  contract: {
    id: "preschool-june-2026-forecast-series" | "preschool-monthly-energy-outlook";
    version: "1" | "2";
    method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total";
  };
  targetPeriod?: {
    start: string;
    endExclusive: string;
    timezone: string;
    targetDayCount: number;
  };
  tariffAssumption?: {
    status: "effective" | "provisional";
    beforeGstSgdPerKwh: number;
    sourceName: string;
    sourceUrl: string;
    supplyClass: string;
    appliesFrom: string;
    appliesTo: string;
    beforeGst: true;
    notBill: true;
  } | {
    status: "unavailable";
    reason: string;
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    scopeRole: "portfolio" | "centre";
    estimatedKwh: number;
    estimatedCostBeforeGstSgd: number | null;
    expectedFullMonthKwh?: number | null;
    expectedFullMonthCostBeforeGstSgd?: number | null;
    actualKwh: number | null;
    actualCostBeforeGstSgd?: number | null;
    actualCompleteDayCount: number;
    actualTargetDayCount: number;
    actualThroughLocalDate?: string | null;
    pacePct: number | null;
    outcome: "on_plan" | "above_plan" | "below_plan" | null;
    originalEstimateIdentity?: string;
    actualIdentity?: string;
    currentOutlookIdentity?: string;
    buckets: Record<"daily" | "weekly" | "monthly", Array<{
      start: string;
      endExclusive: string;
      estimatedKwh: number;
      originalEstimateKwh?: number;
      actualKwh: number | null;
      currentOutlookKwh?: number | null;
      futureOutlookKwh?: number | null;
      actualCompleteDayCount: number;
      actualTargetDayCount: number;
      actualStatus: "waiting" | "partial" | "complete";
    }>>;
  }>;
  evidence: {
    planDataSnapshotId: string;
    actualDataSnapshotId: string;
    planQueryId: "daily_totals_v1";
    actualQueryId: "daily_totals_v1";
    recipeId: "preschool-weekday-mean-series-v1";
  };
};

export type PreschoolPlanningLifecycleDto = {
  status: "available";
  contract: {
    id: "preschool-saved-plan-current-actual";
    version: "1" | "2";
  };
  targetPeriod: {
    start: string;
    endExclusive: string;
    timezone: string;
    targetDayCount: number;
  };
  plan: PreschoolSavedPlanningOutlookDto;
  actual: {
    status: "partial" | "complete";
    usageKwh: number | null;
    completeDayCount: number;
    targetDayCount: number;
    varianceKwh: number | null;
    variancePct: number | null;
  };
  forecast?: PreschoolPlanningForecastDto;
  planProvenance: {
    savedAnalysisId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    templateRevisionId: string;
    queryId: "daily_totals_v1";
    recipeId: "preschool-naive-weekly-planning-baseline-v1";
  };
  actualProvenance: {
    dataSnapshotId: string;
    projectReleaseId: string;
    queryId: "daily_totals_v1";
    period: {
      start: string;
      endExclusive: string;
      timezone: string;
    };
  };
} | {
  status: "unavailable";
  reason: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS" | "CURRENT_ACTUAL_UNAVAILABLE";
    message: string;
  };
};

export type PreschoolApplianceProjectionDto = {
  status: "available";
  contract: {
    id: "preschool-may-2026-appliance-ranking";
    version: "1";
    aliasContractId: "preschool-circuit-as-appliance-v1";
    sourceKind: "circuit";
  };
  period: {
    start: string;
    endExclusive: string;
    timezone: string;
  };
  totalKwh: number;
  appliances: Array<{
    name: string;
    applianceGroup: string;
    usageKwh: number;
    sharePct: number;
    centreCount: number;
    sourceCircuitIds: string[];
  }>;
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    sourceQueryIds: string[];
    projectionRecipeId: "preschool-appliance-ranking-v1";
    sourceKind: "circuit";
    reconciliationGapKwh: number;
  };
} | {
  status: "unavailable";
  reason: {
    code: "PRESCHOOL_APPLIANCE_SNAPSHOT_INCOMPLETE"
      | "PRESCHOOL_APPLIANCE_EVIDENCE_MISMATCH"
      | "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED"
      | "PRESCHOOL_APPLIANCE_RECONCILIATION_FAILED";
    message: string;
  };
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    sourceKind: "circuit";
  };
};

export type PreschoolDecisionSignalsDto = {
  contract: { id: "preschool-decision-signals"; version: "1" };
  context: {
    projectReleaseId: string;
    dataSnapshotId: string;
    period: { start: string; endExclusive: string; timezone: string };
  };
  status: "available" | "withheld";
  reason?: { code: "SNAPSHOT_INCOMPLETE"; message: string };
  items: Array<{
    id: "after-hours" | "efficiency" | "operating";
    kind: "after-hours-energy" | "normalised-peer-priority" | "operating-hour-spikes";
    sectionId: "overall-summary" | "centre-benchmark" | "operating-behaviour" | "appliance-contribution" | "planning-outlook";
    priority: 1 | 2 | 3;
    severity: "attention";
    label: string;
    metrics: Array<{
      id: string;
      label: string;
      metricId: string;
      value: number;
      unit: "kWh" | "%" | "count";
      role: "primary" | "supporting";
      precision: number;
      dimensions: Record<string, string>;
    }>;
    entities: Array<{ kind: "centre"; scopeId: string; code: string; name: string }>;
    evidenceRefs: string[];
    limitations: Array<{
      code: "CAUSE_NOT_OBSERVED" | "PROVISIONAL_METADATA" | "ACTIVITY_NOT_OBSERVED";
      label: string;
    }>;
  }>;
};

export type EnergyProjectReportWindowAnalysisDto = {
  windowId: string;
  period: {
    start: string;
    endExclusive: string;
  };
  status: "ready";
  analysis: {
    summary?: EnergyProjectAnalysisPayloadDto["summary"];
    offHours?: EnergyProjectAnalysisPayloadDto["offHours"];
    dailyTotals?: NonNullable<EnergyProjectAnalysisPayloadDto["dailyTotals"]>;
    timeBehaviour?: NonNullable<EnergyProjectAnalysisPayloadDto["timeBehaviour"]>;
    componentHourlyProfiles?: NonNullable<EnergyProjectAnalysisPayloadDto["componentHourlyProfiles"]>;
    composition?: Pick<EnergyProjectAnalysisPayloadDto,
      | "provenance"
      | "comparison"
      | "categories"
      | "childScopes"
      | "circuits"
      | "designatedTotals"
      | "componentReconciliation"
      | "virtualMeterTraces"
    >;
  };
};

export type EnergyProjectReportWindowSegmentSummaryDto = {
  windowId: string;
  status: "ready";
  segments: Array<{
    period: {
      start: string;
      endExclusive: string;
    };
    dataStatus: "complete" | "partial" | "unavailable";
    expectedDayCount: number;
    completeDayCount: number;
    summary: {
      usageKwh: number;
      averageDailyUsageKwh: number;
    } | null;
    evidence: {
      dataSnapshotId: string;
      queryId: "daily_totals_v1";
    };
  }>;
};

export type EnergySchoolHolidayComparisonDto = {
  status: "available";
  contract: "energyiq-school-holiday-comparison@1";
  identity: EnergySchoolHolidayComparisonIdentityDto;
  selectedHolidayInterval: {
    academicPhase: "term_break" | "vacation";
    from: string;
    toExclusive: string;
  };
  comparisons: EnergySchoolHolidayCohortComparisonDto[];
  hourlyProfile: EnergySchoolHolidayHourlyProfileDto;
  anomalies: EnergySchoolHolidayAnomalyDto[];
  quality: EnergySchoolHolidayComparisonQualityDto;
  excludedAcademicPhases: EnergySchoolHolidayAcademicPhaseDto[];
  limitations: string[];
} | {
  status: "unavailable";
  contract: "energyiq-school-holiday-comparison@1";
  identity: EnergySchoolHolidayComparisonIdentityDto;
  reason: { code: string; message: string };
  quality?: EnergySchoolHolidayComparisonQualityDto;
  limitations?: string[];
};

export type EnergySchoolHolidayHourlyProfileDto = {
  status: "available";
  dayContext: "weekday" | "weekend" | "public_holiday";
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

export type EnergySchoolHolidayAnomalyDto = {
  localDate: string;
  academicPhase: EnergySchoolHolidayAcademicPhaseDto;
  schoolHolidayState: "school_holiday" | "non_school_holiday";
  dayContext: "weekday" | "weekend" | "public_holiday";
  actualKwh: number;
  baselineKwh: number;
  baselineSampleCount: number;
  deltaKwh: number;
  deltaPercent: number;
  baselineDates: string[];
  evidence: EnergySchoolHolidayEvidenceDto;
};

export type EnergySchoolHolidayAcademicPhaseDto = "teaching" | "term_break" | "study_exam" | "vacation";

type EnergySchoolHolidayComparisonIdentityDto = {
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

type EnergySchoolHolidayComparisonQualityDto = {
  expectedDayCount: number;
  completeDayCount: number;
  coveragePct: number;
  excludedLocalDates: string[];
};

type EnergySchoolHolidayEvidenceDto = {
  dataSnapshotId: string;
  projectReleaseId: string;
  comparisonWindowId: "school-holiday-comparison";
  reportTimePolicyRevision: string;
  businessCalendarVersion: string;
  ruleRevision: string;
  metricId: "energy.total_usage_kwh@1";
  queryIds: ["school_holiday_context_facts_v1"];
  period: { from: string; toExclusive: string };
  actualRefs: string[];
  baselineRefs: string[];
};

type EnergySchoolHolidayCohortComparisonDto = {
  dayContext: "weekday" | "weekend" | "public_holiday";
  weekPart: "weekday" | "weekend";
  isPublicHoliday: boolean;
} & ({
  status: "available";
  actual: { academicPhase: "term_break" | "vacation"; averageKwh: number; sampleCount: number };
  baseline: { academicPhase: "teaching"; averageKwh: number; sampleCount: number };
  deltaKwh: number;
  deltaPercent: number;
  evidence: EnergySchoolHolidayEvidenceDto;
} | {
  status: "unavailable";
  reason: "ACTUAL_SAMPLE_UNAVAILABLE" | "TEACHING_BASELINE_UNAVAILABLE";
});

export type NgeeAnnSectionManifestDto = {
  contract: "energyiq-ngee-ann-section-manifest@1";
  projectReleaseId: string;
  enabledSectionIds: Array<
    "trend-and-demand" | "time-behaviour" | "circuit-concentration" | "decision-priorities"
    | "school-holiday-comparison"
  >;
  disabledCapabilities: Array<{ sectionId: "school-holiday-comparison"; reason: string }>;
};

export type EnergyProjectAnalysisSnapshotDto = {
  context: EnergyQueryContextDto & {
    primaryPeriod: {
      start: string;
      endExclusive: string;
    };
    projectReleaseId: string;
    latestCompleteLocalDay?: string | null;
    monthlyOutlookTargetPeriod?: {
      start: string;
      endExclusive: string;
      timezone: string;
      targetDayCount: number;
    } | null;
  };
  projectRelease: EnergyPublishedProjectReleaseDto;
  reportTimeContext?: ReportTimeContext;
  reportWindowAnalyses?: EnergyProjectReportWindowAnalysisDto[];
  reportWindowSegmentSummaries?: EnergyProjectReportWindowSegmentSummaryDto[];
  recipe: EnergyPublishedProjectReleaseDto["recipe"];
  renderer: EnergyPublishedProjectReleaseDto["renderer"];
  dataQuality: EnergyScopeAnalysisDto["dataHealth"];
  meterDataHealth?: EnergyMeterDataHealthDto;
  evidence: Array<{
    id: string;
    metricId: string;
    queryIds: EnergyScopeAnalysisDto["provenance"]["queryIds"];
    queryReceiptId?: string;
  }>;
  findings: EnergyScopeAnalysisDto["attention"];
  dataSnapshot: {
    id: string;
    importBatchIds: string[];
    lastSeenAt: string | null;
    sourceCoverage?: {
      fromLocalDate: string;
      throughLocalDate: string;
    };
  };
  latestAvailablePeriod?: {
    period: "Custom";
    from: string;
    to: string;
  };
  metadata: EnergyProjectAnalysisMetadataDto;
  analysis: EnergyProjectAnalysisPayloadDto;
  sectionManifest?: NgeeAnnSectionManifestDto;
  schoolHolidayComparison?: EnergySchoolHolidayComparisonDto;
  decisionPriorities?: NgeeAnnDecisionPrioritiesDto;
  decisionLifecycle?: NgeeAnnDecisionLifecycleDto;
  preschoolBenchmark?: PreschoolBenchmarkProjectionDto;
  preschoolAppliances?: PreschoolApplianceProjectionDto;
  preschoolOperational?: PreschoolOperationalProjectionDto;
  preschoolPlanningLifecycle?: PreschoolPlanningLifecycleDto;
  preschoolDecisionSignals?: PreschoolDecisionSignalsDto;
};

export type EnergyProjectAnalysisResolutionDto =
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
    overviewContext?: {
      contract: "energyiq-overview-context-reference@1";
      projectionRef: string;
      identity: Record<string, unknown>;
      evidenceRefs: string[];
    };
  }
  | {
    status: "configuration-required";
    context: EnergyQueryContextDto;
    projectId: string;
    title: "Project analysis is not configured";
    detail: string;
  };

export type EnergyProjectOverviewLifecycleDto = {
  contract: "energyiq-overview-lifecycle@1";
  projectionRef: string;
  observedAt: string;
  inputFingerprint: string;
  decisionLifecycle?: NgeeAnnDecisionLifecycleDto;
  preschoolPlanningLifecycle?: PreschoolPlanningLifecycleDto;
};

export type EnergyProjectOverviewMinimumDto = {
  status: "ready";
  contract: "energyiq-current-overview-minimum@2";
  sectionManifest?: NgeeAnnSectionManifestDto;
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    resource: "electricity";
    currentPin: {
      from: string;
      to: string;
      dataSnapshotId: string;
      projectReleaseId: string;
    };
    primaryReportWindowId: string | null;
    reportTimeBasis: ReportTimeBasis | null;
  };
  presentation: {
    projectName: string;
    title: string;
    renderer: {
      key: EnergyProjectRendererKeyDto;
      version: "1";
      contractVersion: "project-analysis-snapshot@1";
    };
    reportWindow: {
      label: string;
      start: string;
      endExclusive: string;
      timezone: string;
      dataThrough?: string;
    };
    navigation: Array<{
      id: string;
      label: string;
      number: string;
      depth: 0;
    }>;
  };
  headline: {
    dataQuality: {
      status: EnergyMeterDataHealthStatusDto;
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
    };
    metrics: Array<{
      id: "centres" | "energy" | "dailyAverage" | "peak" | "comparison" | "cost";
      label: string;
      value: number | null;
      unit: string;
      available: boolean;
    }>;
  };
};

export type EnergySavedAnalysisSummaryDto = {
  id: string;
  seriesId: string;
  sequence: number;
  projectId: string;
  scopeId: string;
  scopeName: string;
  resource: "electricity";
  title: string;
  templateRevisionId: string;
  dataSnapshotId: string;
  rerunOfId?: string;
  createdBy: string;
  createdAt: string;
};

export type EnergySavedAnalysisViewStateDto = {
  grain: "day" | "hour";
  comparison: "overlay" | "selected" | "average";
  category: "all" | "load" | "light";
};

export type PreschoolOverviewAiSectionIdDto =
  | "centre-benchmark"
  | "standby-wastage"
  | "operating-behaviour"
  | "planning-outlook";

export type PreschoolOverviewAiBindingDto = {
  workspaceId: string;
  projectId: "preschool-demo";
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  modelProfileId: string;
  modelProfileRevision: number;
};

type PreschoolSectionInterpretationResultBaseDto = {
  artifactKind: "section-interpretation";
  providerProfileId: string;
  runId: string;
  binding: PreschoolOverviewAiBindingDto;
  sectionId: PreschoolOverviewAiSectionIdDto;
};

export type PreschoolSectionInterpretationV3ResultDto = PreschoolSectionInterpretationResultBaseDto & ({
  status: "available";
  summary?: string;
  keyPoints: Array<{
    kind: "priority" | "finding" | "meaning" | "next-check";
    label?: string;
    text: string;
    evidenceRefs: string[];
  }>;
  limitation?: string;
} | {
  status: "empty";
  summary?: never;
  keyPoints: [];
  limitation?: string;
});

export type PreschoolSectionInsightDto = {
  id: string;
  title: string;
  label?: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  text: string;
  evidenceRefs: string[];
  deepDiveQuestion?: string;
};

export type PreschoolSectionInterpretationV4ResultDto = PreschoolSectionInterpretationResultBaseDto & ({
  status: "available";
  summary: {
    text: string;
    evidenceRefs: string[];
  };
  insights: PreschoolSectionInsightDto[];
  limitation?: string;
} | {
  status: "empty";
  summary?: never;
  insights: [];
  limitation?: string;
});

export type PreschoolSectionInterpretationResultDto =
  | PreschoolSectionInterpretationV3ResultDto
  | PreschoolSectionInterpretationV4ResultDto;

type PreschoolExecutiveSynthesisResultBaseDto = {
  artifactKind: "executive-synthesis";
  providerProfileId: string;
  runId: string;
  binding: PreschoolOverviewAiBindingDto;
  sourceSectionArtifactIds: string[];
};

export type PreschoolExecutiveSynthesisV3ResultDto = PreschoolExecutiveSynthesisResultBaseDto & ({
  status: "available";
  keyFindings: Array<{
    id: string;
    takeaway: string;
    sectionIds: PreschoolOverviewAiSectionIdDto[];
    evidenceRefs: string[];
  }>;
} | {
  status: "empty";
  keyFindings: [];
});

export type PreschoolOverviewKeyFindingDto = {
  id: string;
  title: string;
  text: string;
  sectionIds: PreschoolOverviewAiSectionIdDto[];
  evidenceRefs: string[];
  alert?: {
    severity: "attention" | "urgent";
    certainty: "confirmed" | "anomaly" | "possible";
  };
};

export type PreschoolExecutiveOverviewEvidenceLineageDto = {
  contract: "analysis-context-evidence@1";
  sourceId: string;
  pins: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    dataCutoff: string;
    projectReleaseId: string;
    metricVersion: string;
  };
  factIds: string[];
  facts: Array<{
    id: string;
    label: string;
    metricId: string;
    value: string | number | boolean | null;
    unit?: string;
    status: "confirmed" | "provisional" | "partial";
    evidenceRefs: string[];
    dimensions: Record<string, string>;
  }>;
};

export type PreschoolExecutiveSynthesisV4ResultDto = PreschoolExecutiveSynthesisResultBaseDto & ({
  status: "available";
  summary: {
    text: string;
    evidenceRefs: string[];
  };
  overviewEvidence?: PreschoolExecutiveOverviewEvidenceLineageDto;
  findings: PreschoolOverviewKeyFindingDto[];
} | {
  status: "empty";
  summary?: never;
  overviewEvidence?: never;
  findings: [];
});

export type PreschoolExecutiveSynthesisResultDto =
  | PreschoolExecutiveSynthesisV3ResultDto
  | PreschoolExecutiveSynthesisV4ResultDto;

export type PreschoolOverviewAiUnitStatusDto<T extends { status: "available" | "empty" }> =
  | { status: "queued" }
  | { status: "running" }
  | { status: "available"; artifactId: string; completedAt?: string; result: Extract<T, { status: "available" }> }
  | { status: "empty"; artifactId: string; completedAt?: string; result: Extract<T, { status: "empty" }> }
  | { status: "unavailable"; artifactId?: string; completedAt?: string; reason: string };

export type PreschoolOverviewAiReadModelDto = {
  artifactKind: "preschool-overview-ai-read-model";
  status: "available";
  binding: PreschoolOverviewAiBindingDto;
  sections: Record<PreschoolOverviewAiSectionIdDto, PreschoolOverviewAiUnitStatusDto<PreschoolSectionInterpretationResultDto>>;
  executive: PreschoolOverviewAiUnitStatusDto<PreschoolExecutiveSynthesisResultDto>;
  additional?: PreschoolOverviewAiUnitStatusDto<AdditionalAiInsightsArtifact>;
  autonomous?: unknown;
};

export type EnergySavedAnalysisAiArtifactInputDto = {
  contract: "energyiq-saved-ai-result@1";
  rendererKey: EnergyProjectRendererKeyDto;
  snapshotId: string;
  projectReleaseId: string;
  reportTimeBasis?: ReportTimeBasis;
  result: {
    status: "available";
    providerProfileId: string;
    runId: string;
    findings: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
} | {
  contract: "energyiq-saved-ai-result@2";
  rendererKey: "preschool-overview";
  snapshotId: string;
  projectReleaseId: string;
  reportTimeBasis?: ReportTimeBasis;
  result: PreschoolOverviewAiReadModelDto;
} | {
  contract: "energyiq-saved-ai-result@3";
  rendererKey: "ngee-ann-overview";
  snapshotId: string;
  projectReleaseId: string;
  reportTimeBasis?: ReportTimeBasis;
  result: EnergyProjectOverviewAiReadModelDto;
};

export type EnergyOverviewAiArtifactDto = {
  id?: string;
  status: "missing" | "queued" | "running" | "available" | "failed";
  dataSnapshotId: string;
  projectReleaseId: string;
  modelProfileId?: string;
  modelProfileRevision?: number;
  attemptCount?: number;
  runId?: string;
  completedAt?: string;
  errorCode?: string;
  result?: PreschoolOverviewAiReadModelDto | {
    status: "available";
    providerProfileId: string;
    runId: string;
    findings: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
};

export type EnergyPreschoolHtmlAiSlotArtifactDto = {
  contract: "energyiq-ai-slot-html-artifact@1";
  slotId: PreschoolHtmlAiSlotId;
  identity: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    reportTimePolicyId?: string;
    reportTimePolicyRevision?: string;
    reportTimeContextFingerprint?: string;
    modelProfileId: string;
    modelProfileRevision: number;
    promptRevision: string;
    slotDefinitionRevision: string;
  };
  evidenceRefs: string[];
  preferredHeightPx?: number;
  accessibleText: string;
  html: string;
};

export type EnergyPreschoolHtmlAiSlotAcceptanceDto = {
  status: "accepted" | "accepted_with_warnings";
  droppedClaims: Array<{
    blockId: string;
    reason: "unsupported-fact" | "unsupported-causal-claim" | "unsupported-evidence-ref" | "empty-structure";
  }>;
};

export type EnergyPreschoolHtmlAiSlotReadModelDto = {
  artifactKind: "preschool-html-ai-slot-read-model";
  status: "available" | "missing";
  binding: Omit<EnergyPreschoolHtmlAiSlotArtifactDto["identity"], "slotDefinitionRevision"> & {
    slotDefinitionRevisions: Record<string, string>;
    allowedEvidenceRefsBySlot: Record<string, string[]>;
  };
  slots: Record<string, {
    status: "queued" | "running" | "available" | "failed" | "missing";
    artifactId?: string;
    runId?: string;
    sessionId?: string;
    artifact?: EnergyPreschoolHtmlAiSlotArtifactDto;
    acceptance?: EnergyPreschoolHtmlAiSlotAcceptanceDto;
    errorCode?: string;
    generation?: {
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      htmlSha256?: string;
    };
  }>;
};

export type EnergyProjectOverviewAiUnitStatusDto =
  | { status: "missing" }
  | { status: "queued" | "running"; artifactId?: string }
  | { status: "available"; artifactId: string; completedAt?: string; result: Record<string, unknown> }
  | { status: "empty"; artifactId: string; runId?: string; completedAt?: string }
  | { status: "failed" | "unavailable"; artifactId?: string; completedAt?: string; reason: string };

export type EnergyProjectOverviewAiUnitGenerationDefinitionDto = {
  revision: string;
  role: string;
  skillId: string;
  skillRevision: string;
  methodId: string;
  methodRevision: string;
  contextRevision: string;
  toolPolicyRevision: string;
  outputContractRevision: string;
  validatorRevision: string;
  presentationReferenceRevision: string;
};

export type EnergyProjectOverviewAiReadModelDto = {
  contract: "energyiq-project-overview-ai-read-model@1";
  rendererKey: EnergyProjectRendererKeyDto;
  surface?: {
    overviewDefinitionRevision: string;
    keyFindings?: { slotId: string; regionId: string; label: string; order: number; generation?: EnergyProjectOverviewAiUnitGenerationDefinitionDto };
    sections: Array<{ id: string; regionId?: string; slotId?: string; label: string; order?: number; generation?: EnergyProjectOverviewAiUnitGenerationDefinitionDto }>;
    additionalInsights?: { slotId: string; regionId: string; label: string; order: number; generation?: EnergyProjectOverviewAiUnitGenerationDefinitionDto };
  };
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileId: string;
    modelProfileRevision: number;
    generation: Record<string, unknown> & {
      reportTimePolicyId?: string;
      reportTimePolicyRevision?: string;
      reportTimeContextFingerprint?: string;
      units?: {
        keyFindings: Record<string, unknown>;
        sections: Record<string, Record<string, unknown>>;
        additionalInsights: Record<string, unknown>;
      };
    };
  };
  keyFindings: EnergyProjectOverviewAiUnitStatusDto;
  sections: Record<string, EnergyProjectOverviewAiUnitStatusDto>;
  additionalInsights: EnergyProjectOverviewAiUnitStatusDto;
};

export type EnergyProjectOverviewAdminReadinessStatusDto =
  | "ready"
  | "generating"
  | "not-generated"
  | "needs-attention"
  | "no-new-insight"
  | "out-of-date";

export type EnergyProjectOverviewAdminReadinessItemDto = {
  id: string;
  label: string;
  status: EnergyProjectOverviewAdminReadinessStatusDto;
  detail: string;
  artifactId?: string;
  completedAt?: string;
};

export type EnergyProjectAiMethodTraceDto = {
  skillId: string;
  semanticVersion: string;
  resourceId: string;
  resourceRevision: number;
  scope: "builtin" | "user" | "workspace";
  role: "core-method" | "expert-direction";
  usage: "actually-loaded" | "finding-attributed";
  technical: {
    contentSha256: string;
    workspaceId: string;
    ownerId: string;
  };
};

export type EnergyProjectAiExplainabilityDto = {
  status: "available" | "unavailable";
  detail: string;
  declared: {
    status: "available" | "partially-unavailable" | "unavailable";
    detail: string;
    skills: Array<{ id: string; revision: string; availability: "declared-available" }>;
    methods: Array<{
      skillId: string;
      semanticVersion: string;
      resourceId: string;
      resourceRevision: number;
      scope: "builtin" | "workspace";
      lifecycle: "published";
      availability: "declared-available";
      technical: {
        contentSha256: string;
        workspaceId: string;
        ownerId: string;
        role: "core-method" | "expert-direction";
      };
    }>;
    tools: Array<{ id: string; availability: "declared-available" }>;
  };
  governance: {
    status: "available" | "unavailable";
    detail: string;
    proposals: Array<{
      id: string;
      title: string;
      lifecycle: "provisional" | "in-review" | "approved" | "published" | "rejected" | "superseded";
      revision: number;
      visibility: "project";
      projectId: string;
      findingId: string;
      sourceArtifactId: string;
    }>;
  };
  currentArtifact: null | {
    status: "available" | "unavailable";
    artifactId: string;
    readOnly: true;
    historical: false;
    detail: string;
    technical?: {
      runId: string;
      outputContractRevision: string;
      methodSetId: string;
      methodSetRevision: string;
      methodSetFingerprint: string;
      capabilityRevision: string;
    };
    loadedMethods?: EnergyProjectAiMethodTraceDto[];
    findings?: Array<{
      id: string;
      title: string;
      status: "available" | "unavailable";
      detail: string;
      evidenceSignal?: string;
      aiAngle?: string;
      origin?: "ai-discovery" | "expert-sop" | "hybrid";
      novelContribution?: string;
      evidenceRefs?: string[];
      attributedMethods?: EnergyProjectAiMethodTraceDto[];
      successfulTools?: Array<{
        auditId: string;
        toolName: string;
        evidenceRefs: string[];
        usage: "tool-succeeded";
      }>;
    }>;
  };
};

export type EnergyProjectOverviewAdminStateDto = {
  projectId: string;
  projectName: string;
  rendererKey: EnergyProjectRendererKeyDto | null;
  customerOverview: {
    status: EnergyProjectOverviewAdminReadinessStatusDto;
    detail: string;
    url: string | null;
  };
  currentIdentity: {
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileRevision: number;
  } | null;
  capabilities: {
    keyFindings: boolean;
    sectionAnalysis: string[];
    additionalInsights: boolean;
  };
  analysis: {
    supported: boolean;
    status: EnergyProjectOverviewAdminReadinessStatusDto;
    detail: string;
    readyCount: number;
    totalCount: number;
    lastGeneratedAt: string | null;
    items: EnergyProjectOverviewAdminReadinessItemDto[];
  };
  allowedActions: Array<"generate-missing">;
  recommendedNextAction: {
    action: "generate-missing";
    label: "Generate missing analysis" | "Retry failed analysis";
    detail: string;
  } | null;
  explainability?: EnergyProjectAiExplainabilityDto;
};

export type EnergyProjectHarnessConfigurationDto = {
  status: "available" | "partially-unavailable";
  detail: string;
  project: {
    id: string;
    name: string;
    workspaceId: string;
    rendererKey: EnergyProjectRendererKeyDto | null;
  };
  resources: {
    models: Array<{
      id: string;
      name: string;
      source: "server-system-binding" | "current-admin-resource";
      status: string;
      revision: number;
      enabled: boolean;
      provider: string | null;
      modelName: string | null;
      planningContext: {
        capabilitySource: "conservative-fallback" | "explicit-profile" | "verified-model-default";
        contextWindow: number;
        maxOutputTokens: number;
        outputReserve: number;
        safetyMargin: number;
        inputBudget: number;
      };
    }>;
    skills: Array<{
      id: string;
      name: string;
      description: string;
      version: string;
      revision: number;
      status: string;
      enabled: boolean;
      physicalOwner: "builtin" | "user";
      declaredScope: "builtin" | "user" | "workspace";
      scopeStatus: "verified" | "unverified";
      availability: "configured" | "unavailable";
      allowedToolIds: string[];
      deniedToolIds: string[];
      contentSha256: string | null;
    }>;
    methods: Array<{
      resourceId: string;
      resourceRevision: number;
      skillId: string;
      semanticVersion: string;
      role: "core-method" | "expert-direction";
      scope: "builtin" | "workspace";
      contentSha256: string;
      lifecycle: "published";
    }>;
    tools: Array<{
      id: string;
      source: "datafoundry-builtin" | "energyiq-server-owned";
      availability: "registered" | "declared-for-stage";
    }>;
    mcpServers: Array<{
      id: string;
      name: string;
      revision: number;
      status: string;
      enabled: boolean;
      physicalOwner: "user";
      availability: "configured";
      connection: "persisted-status";
      statusAsOf: string;
      toolManifest: {
        source: "persisted-last-test" | "not-tested";
        toolNames: string[];
      };
    }>;
  };
  managedOverview?: {
    status: "available" | "partially-unavailable" | "unavailable";
    source: "overview-definition" | "legacy-profile" | "unavailable";
    rendererKey: EnergyProjectRendererKeyDto | null;
    definition: {
      status: "available" | "unavailable";
      templateRevisionId: string | null;
      contractRevision: string | null;
      fingerprint: string | null;
    };
    reportTimePolicy: {
      status: "available" | "unavailable";
      revisionId: string | null;
      policyId: string | null;
      revision: string | null;
      windows: Array<{
        id: string;
        role: string;
        label: string;
        strategy: string;
      }>;
    };
    sections: Array<{
      id: string;
      title: string;
      primaryWindowId: string;
      supportingWindowIds: string[];
    }>;
  };
  harnesses: Array<{
    id: "ai-analyst" | "key-findings" | "section-analysis" | "additional-insights";
    label: string;
    resolution: "run-dependent" | "fixed-stage-contract";
    status: "available" | "unavailable";
    detail: string;
    runtimeStageIds?: string[];
    contract?: {
      provenance: "code-owned-current";
      artifactIdentityRevision: string;
      workflowRevision: string;
      promptRevisions: string[];
      validatorRevision: string;
      outputContractRevision: string;
    } | null;
    modelIds: string[];
    skillIds: string[];
    methodResourceIds: string[];
    toolIds: string[];
    mcpServerIds: string[];
    context: {
      mode: "run-planned";
      sources: string[];
    };
    instructions: Array<{
      kind: "platform" | "workflow-stage" | "skill-method" | "output-contract";
      label: string;
      revision: string | null;
      revisionStatus: "resource-pinned" | "run-pinned" | "not-separately-versioned";
      visibility: "summary-only";
    }>;
  }>;
  unavailable: Array<{ id: string; detail: string }>;
};

export type EnergyProjectAiRunSummaryDto = {
  runId: string;
  actorId: string;
  sessionId: string;
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "canceled";
  stage: string | null;
  modelProvider: string | null;
  modelName: string | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  parentRunId: string | null;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCounts: {
    called: number;
    succeeded: number;
    rejected: number;
    failed: number;
  } | null;
  traceAvailability: "available" | "partial" | "unavailable" | "detail-required";
};

export type EnergyProjectAiRunDetailDto = EnergyProjectAiRunSummaryDto & {
  historicalConfiguration: {
    status: "available" | "unavailable";
    detail: string;
    modelProfileId: string | null;
    resourceRevisions: Record<string, number>;
    selectedSkills: Array<{ id: string; name: string; revision: number }>;
    selectionAudit: { selected: number; rejected: number; unavailable: number };
    materializedSkills?: {
      status: "available" | "unavailable";
      items: Array<{ id: string; revision: number | null }>;
    };
    loadedSkills: {
      status: "available" | "unavailable";
      items: Array<{
        contentSha256: string | null;
        detail: string;
        evidenceStatus: "available" | "unavailable";
        id: string;
        loadSource: string | null;
        loadStage: string | null;
        name: string | null;
        ownerScope: "builtin" | "user" | "workspace" | null;
        ownerUserId: string | null;
        ownerWorkspaceId: string | null;
        packageRef: string | null;
        revision: number | null;
        semanticVersion: string | null;
      }>;
    };
    mcp: {
      enabledServerIds: string[];
      serverToolMapping: {
        status: "available" | "unavailable";
        items: Array<{ serverId: string; toolNames: string[] }>;
      };
    };
  };
  context: {
    status: "available" | "unavailable";
    steps: Array<{
      stepNumber: number;
      packageId: string | null;
      packageRevision: number | null;
      planId: string | null;
      selectedGroupCount: number;
      omittedGroupCount: number;
      selectedSourceTypes: string[];
      omittedSourceTypes: string[];
      truncationDecisionCount: number;
      promptTokens: number | null;
      inputBudget: number | null;
      contextWindow: number | null;
      remainingTokens: number | null;
      capabilitySource: string | null;
      highWaterMark: string | null;
    }>;
  };
  modelRequests: {
    status: "available" | "partial" | "unavailable";
    detail: string;
    items: Array<{
      stepNumber: number | null;
      retryCount: number | null;
      modelName: string | null;
      reconstructionStatus: "available" | "unavailable";
      snapshotId: string | null;
      contentSha256: string | null;
      contextPackageId: string | null;
      contextPackageRevision: number | null;
      toolNames: string[];
      payloadAvailability: "not-retained" | "retained" | null;
    }>;
  };
  tools: Array<{
    toolCallId: string;
    name: string;
    status: "called" | "succeeded" | "rejected" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  tokens: {
    status: "available" | "unavailable";
    input: number | null;
    output: number | null;
    total: number | null;
    cache: {
      status: "available" | "unavailable";
      hit: number | null;
      miss: number | null;
    };
  };
  lineage: {
    artifacts: Array<{ id: string; type: string; name: string }>;
    energyIqArtifacts: Array<{
      id: string;
      kind: string;
      targetId: string | null;
      findingIds: string[];
    }>;
  };
};

export type EnergyProjectAiOperationsDto = {
  project: { id: string; name: string; workspaceId: string };
  runs: EnergyProjectAiRunSummaryDto[];
  selectedRun: EnergyProjectAiRunDetailDto | null;
  pagination: {
    limit: number;
    returned: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export type EnergyAdditionalInsightFeedbackDto = {
  id: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  findingId: string;
  actorId: string;
  rating: "useful" | "not-useful";
  revision: number;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    revision: number;
    fromRating: "useful" | "not-useful" | null;
    toRating: "useful" | "not-useful";
    actorId: string;
    recordedAt: string;
  }>;
};

export type EnergyAdditionalInsightCommentDto = {
  id: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  findingId: string;
  actorId: string;
  text: string;
  createdAt: string;
};

export type EnergyInsightMethodProposalDto = {
  id: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  findingId: string;
  createdBy: string;
  title: string;
  guidance: string;
  status: "provisional" | "in-review" | "approved" | "published" | "rejected" | "superseded";
  revision: number;
  createdAt: string;
  updatedAt: string;
  audit: Array<{
    revision: number;
    fromStatus: EnergyInsightMethodProposalDto["status"] | null;
    toStatus: EnergyInsightMethodProposalDto["status"];
    actorId: string;
    recordedAt: string;
  }>;
};

export type EnergyAdditionalInsightEvaluationSummaryDto = {
  evaluationId: string;
  status: "running" | "awaiting-human-review" | "failed" | "passed" | "approved-candidate";
  target: {
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
  };
  completedAttemptCount: number;
  failedAttemptCount: number;
  humanReviewedCount: number;
  approval?: {
    selectedAttemptId: string;
    approvedAt: string;
    disposition: "publication-candidate-only";
  };
  publication?: {
    sourceAttemptId: string;
    artifactId: string;
    artifactIdentityHash: string;
    actorId: string;
    publishedAt: string;
    revision: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type EnergyAdditionalInsightTransitionSummaryDto = {
  transitionId: string;
  status: "running" | "completed" | "failed";
  previousSnapshotId: string;
  currentSnapshotId: string;
  outcomeCount?: number;
  outcomeCounts?: {
    new: number;
    changed: number;
    "still-supported": number;
    resolved: number;
    "no-material-change": number;
  };
  errorCode?: string;
  failureStage?: "generation" | "validation" | "comparison";
};

export type EnergySavedAnalysisAiArtifactDto = EnergySavedAnalysisAiArtifactInputDto & {
  completedAt: string;
  runProvenance?: {
    modelProvider: string;
    modelName: string;
    requestFingerprint?: string;
    contextSha256: string;
  };
};

export type EnergySavedAnalysisDetailDto = EnergySavedAnalysisSummaryDto & {
  query: EnergyQueryContextRequestDto;
  analysis: Omit<EnergyScopeAnalysisDto, "childScopes"> & {
    metadata?: EnergyProjectAnalysisMetadataDto;
    childScopes: Array<EnergyScopeAnalysisDto["childScopes"][number] & {
      metadata?: EnergyProjectAnalysisScopeMetadataDto;
    }>;
  };
  snapshot?: EnergyProjectAnalysisSnapshotDto;
  viewState?: EnergySavedAnalysisViewStateDto;
  aiArtifact?: EnergySavedAnalysisAiArtifactDto;
  templateRevision: EnergyTemplateRevisionDto;
  catalog: EnergyComponentRevisionDto[];
};

export type EnergySavedOverviewComparisonCandidateDto = EnergySavedAnalysisSummaryDto & {
  analysis: Pick<EnergySavedAnalysisDetailDto["analysis"], "summary">;
  snapshot: Pick<
    NonNullable<EnergySavedAnalysisDetailDto["snapshot"]>,
    "context" | "dataSnapshot" | "recipe" | "renderer" | "reportTimeContext"
  > & {
    projectRelease: Pick<NonNullable<EnergySavedAnalysisDetailDto["snapshot"]>["projectRelease"], "id">;
  };
  aiArtifact?: EnergySavedAnalysisAiArtifactDto;
};

export type EnergyProjectNodeDto = {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  node_type: string;
  tier_definition_id?: string;
  hierarchy_revision_id?: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_json?: string;
  metadata_status: "provisional" | "confirmed";
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
};

export type EnergyProjectHierarchyDto = {
  electricityMeters?: EnergyScopeAnalysisDto["explorerMeters"];
  project: {
    id: string;
    name: string;
    hierarchy_revision_id: string;
  };
  tiers: EnergyTierDefinitionDto[];
  nodes: EnergyProjectNodeDto[];
};

export type EnergyMetricFamilyDto = "aggregate" | "time" | "normalised" | "quality";
export type EnergyMetricRequirementDto = "always" | "area" | "people";

export type EnergyMetricRevisionDto = {
  revision_id: string;
  metric_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyMetricFamilyDto;
  unit: string;
  value_type: "number";
  calculation_key: string;
  requirement: EnergyMetricRequirementDto;
  created_at: string;
};

export type EnergyProjectMetricConfigDto = {
  project_id: string;
  revision: number;
  selected_metric_revision_ids: string[];
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyProjectMetricConfigResponseDto = {
  catalog: EnergyMetricRevisionDto[];
  config: EnergyProjectMetricConfigDto;
};

export type EnergyRuleFamilyDto = "data_quality" | "time" | "comparison";
export type EnergyRuleRequirementDto = "always" | "operating_hours" | "children" | "area_peers" | "people_peers";

export type EnergyRuleRevisionDto = {
  revision_id: string;
  rule_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyRuleFamilyDto;
  severity: "info" | "warning";
  evaluation_key: string;
  metric_revision_ids: string[];
  parameters: Record<string, number | string>;
  requirement: EnergyRuleRequirementDto;
  created_at: string;
};

export type EnergyProjectRuleConfigDto = {
  project_id: string;
  revision: number;
  selected_rule_revision_ids: string[];
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyProjectRuleConfigResponseDto = {
  catalog: EnergyRuleRevisionDto[];
  config: EnergyProjectRuleConfigDto;
};

export type EnergyComponentFamilyDto = "decision" | "overview" | "comparison" | "time" | "composition" | "quality" | "evidence";
export type EnergyComponentTargetDto = "project" | "tier" | "both";
export type EnergyComponentRequirementDto = "always" | "rules" | "operating_hours" | "children" | "area_peers" | "people_peers" | "meter_breakdown";
export type EnergyTemplateSpanDto = 4 | 6 | 8 | 12;
export type EnergyTemplateHeightDto = "compact" | "standard" | "tall";
export type EnergyTemplateVisualPresetDto = "auto" | "cards" | "bar" | "area" | "table" | "list";
export type EnergyTemplateDensityDto = "comfortable" | "compact";
export type EnergyTemplateToneDto = "default" | "highlight" | "quiet";

export type EnergyComponentAllowedPresentationDto = {
  layout: {
    spans: EnergyTemplateSpanDto[];
    heights: EnergyTemplateHeightDto[];
  };
  visuals: {
    presets: EnergyTemplateVisualPresetDto[];
    densities: EnergyTemplateDensityDto[];
    tones: EnergyTemplateToneDto[];
    legend: {
      configurable: boolean;
      default: boolean;
    };
    limit: {
      configurable: boolean;
      min: number;
      max: number;
      default: number;
    };
  };
};

export type EnergyComponentRevisionDto = {
  revision_id: string;
  component_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyComponentFamilyDto;
  view_key: string;
  target: EnergyComponentTargetDto;
  metric_revision_ids: string[];
  rule_revision_ids: string[];
  query_ids: string[];
  requirement: EnergyComponentRequirementDto;
  allowed_presentation: EnergyComponentAllowedPresentationDto;
  created_at: string;
};

export type EnergyTemplateComponentPlacementDto = {
  placement_id?: string;
  component_revision_id: string;
  enabled: boolean;
  section_id?: string;
  layout?: EnergyTemplateComponentLayoutDto;
  presentation?: EnergyTemplateComponentPresentationDto;
};

export type EnergyTemplateSectionDto = {
  section_id: string;
  title: string;
  navigation_label: string;
  description?: string;
};

export type EnergyTemplateComponentLayoutDto = {
  span: EnergyTemplateSpanDto;
  height: EnergyTemplateHeightDto;
};

export type EnergyTemplateComponentPresentationDto = {
  visual_preset: EnergyTemplateVisualPresetDto;
  density: EnergyTemplateDensityDto;
  tone: EnergyTemplateToneDto;
  show_legend: boolean;
  limit: number;
  title?: string;
  description?: string;
};

export type EnergyTemplateDefinitionDto = {
  template_id: string;
  target_kind: "project" | "tier";
  tier_definition_id?: string;
  sections?: EnergyTemplateSectionDto[];
  components: EnergyTemplateComponentPlacementDto[];
};

export type EnergyTemplateDraftDocumentDto = {
  schema_version?: 2;
  templates: EnergyTemplateDefinitionDto[];
};

export type EnergyProjectTemplateDraftDto = {
  project_id: string;
  revision: number;
  document: EnergyTemplateDraftDocumentDto;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyProjectTemplateDraftResponseDto = {
  catalog: EnergyComponentRevisionDto[];
  draft: EnergyProjectTemplateDraftDto;
};

export type EnergyTemplateRevisionDto = {
  revision_id: string;
  project_id: string;
  sequence: number;
  source_template_draft_revision: number;
  document: EnergyTemplateDraftDocumentDto;
  hierarchy_revision_id: string;
  meter_formula_revision_id: string;
  metric_config_revision: number;
  selected_metric_revision_ids: string[];
  rule_config_revision: number;
  selected_rule_revision_ids: string[];
  business_calendar_version: string;
  tariff_schedule_version: string;
  published_by: string;
  published_at: string;
};

export type EnergyPublishedTemplateResponseDto = {
  source: "published-revision" | "compatibility-default";
  revision: EnergyTemplateRevisionDto | null;
  document: EnergyTemplateDraftDocumentDto;
  catalog: EnergyComponentRevisionDto[];
};

export type EnergyTemplateChangeDiffItemDto = {
  kind: "placement_added" | "placement_removed" | "placement_moved" | "section_changed" | "layout_updated" | "presentation_updated";
  template_id: string;
  placement_id: string;
  summary: string;
} | {
  kind: "ai_slot_presentation_mode_updated";
  before: "structured" | "html";
  after: "structured" | "html";
} | {
  kind: "section_added" | "section_removed";
  sectionKey: string;
  index: number;
} | {
  kind: "section_order_changed";
  before: string[];
  after: string[];
} | {
  kind: "section_updated";
  sectionKey: string;
  changedFields: string[];
} | {
  kind: "block_added" | "block_removed";
  sectionKey: string;
  blockKey: string;
  index: number;
} | {
  kind: "block_order_changed";
  sectionKey: string;
  before: string[];
  after: string[];
} | {
  kind: "block_updated";
  sectionKey: string;
  blockKey: string;
  changedFields: string[];
};

export type EnergyOverviewDefinitionDto = {
  contractRevision: "energyiq-overview-definition@1";
  timePolicyRevisionId: string;
  aiSlotPresentationMode?: "structured" | "html";
  sections: Array<{
    key: string;
    title: string;
    managementQuestion: string;
    primaryWindowId: string;
    supportingWindowIds: string[];
    blocks: Array<{
      key: string;
      capabilityRevisionId: string;
      windowId: string;
      emphasis: "primary" | "standard" | "supporting";
    }>;
  }>;
};

export type EnergyTemplateChangeProposalDto = {
  id: string;
  workspace_id: string;
  project_id: string;
  base_revision_id: string;
  data_snapshot_id: string;
  scope_id: string;
  instruction: string;
  proposal: {
    title: string;
    rationale: string;
    operations: Array<Record<string, unknown>>;
  } | {
    contractRevision: "energyiq-overview-definition-change@1";
    title: string;
    rationale: string;
    desiredDefinition: EnergyOverviewDefinitionDto;
  };
  document: EnergyTemplateDraftDocumentDto;
  diff: EnergyTemplateChangeDiffItemDto[];
  status: "pending_review" | "rejected" | "published";
  created_by: string;
  created_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  published_revision_id?: string;
};

export type EnergyTemplateChangeContextDto = {
  fixedIdentity: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
  revision: EnergyTemplateRevisionDto;
  catalog: EnergyComponentRevisionDto[];
  proposals: EnergyTemplateChangeProposalDto[];
  overviewDefinition: EnergyOverviewDefinitionDto;
  rendererBoundary: {
    previewRenderer: "structured-template";
    customerRenderer: string;
    customerRendererAutomaticallyReordered: false;
    message: string;
  };
};

export type EnergyTemplateChangePreviewDto = {
  proposal: EnergyTemplateChangeProposalDto;
  catalog: EnergyComponentRevisionDto[];
  fixedIdentity: EnergyTemplateChangeContextDto["fixedIdentity"];
  rendererBoundary: {
    previewRenderer: "structured-template";
    customerRendererAutomaticallyReordered: false;
  };
};

export type DevIdentitiesResponseDto = {
  users: DevIdentityUser[];
  currentUserId: string;
  workspace: IdentityWorkspace;
};

export type BackendCapabilitiesResponse = {
  "artifact.export"?: boolean;
  "artifact.list"?: boolean;
  "artifact.promote"?: boolean;
  "chat.fileUpload"?: boolean;
  "chat.imageInput"?: boolean;
  "conversation.memory"?: boolean;
  "conversation.title"?: boolean;
  "interaction.resume"?: boolean;
  "datasource.fieldMasking"?: boolean;
  "datasource.extendedTypes"?: boolean;
  "datasource.introspectionPolicy"?: boolean;
  "datasource.queryPolicy"?: boolean;
  "datasource.samplePolicy"?: boolean;
  "datasource.server"?: boolean;
  "kb.chunking"?: boolean;
  "kb.citationPolicy"?: boolean;
  "kb.scope"?: boolean;
  "llm.advancedSampling"?: boolean;
  "mcp.stdio"?: boolean;
  "mcp.toolPolicy"?: boolean;
  "skill.resourceBinding"?: boolean;
  "llm.samplingParams"?: boolean;
  knowledge?: boolean;
  mcp?: boolean;
  skills?: boolean;
  files?: boolean;
};

export type FileAssetRefDto = {
  id: string;
  assetId?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  source?: string;
  origin?: string;
  scope?: "session" | "workspace";
  status?: string;
  sessionId?: string;
  runId?: string;
  createdAt?: string;
};

export type DatasourceDto = {
  id: string;
  name: string;
  description?: string;
  type: string;
  mode?: string;
  config?: Record<string, unknown>;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  connectionStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DatasourceTypeParamDto = {
  name: string;
  label: string;
  type: "string" | "password" | "select" | "number" | "boolean" | "file";
  required: boolean;
  default_value?: string | number | boolean;
  options?: string[];
};

export type DatasourceTypeDto = {
  name: string;
  label: string;
  enabled: boolean;
  description?: string;
  parameters: DatasourceTypeParamDto[];
};

export type KnowledgeBaseDto = {
  id: string;
  name: string;
  description?: string;
  retrievalTopK?: number;
  scoreThreshold?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  citationRequired?: boolean;
  chunkOverlap?: number;
  chunkSize?: number;
  graphRagEnabled?: boolean;
  rerankEnabled?: boolean;
  rerankModel?: string;
  scope?: string;
  vectorStore?: string;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  indexStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type KnowledgeDocumentDto = {
  id: string;
  userId?: string;
  collectionId?: string;
  filename: string;
  fileAssetRefId?: string;
  mimeType?: string;
  status: string;
};

export type McpServerDto = {
  id: string;
  name: string;
  description?: string;
  transport?: string;
  serverUrl?: string;
  apiUrl?: string;
  authType?: string;
  toolManifest?: unknown[];
  toolAllowlist?: string[] | string;
  timeoutMs?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  healthStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DatalinkServerDto = {
  id: string;
  name: string;
  description?: string;
  healthStatus?: string;
  serverUrl?: string;
  apiUrl?: string;
  transport?: string;
  toolCount?: number;
  toolNames?: string[];
  updatedAt?: string;
};

export type DatalinkNodeDto = {
  id: string;
  type: string;
  name?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DatalinkEdgeDto = {
  id: string;
  source_id?: string;
  source?: string;
  target_id?: string;
  target?: string;
  type: string;
  confidence?: number;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DatalinkGraphDto = {
  nodes: DatalinkNodeDto[];
  edges: DatalinkEdgeDto[];
};

export type DatalinkServersResponseDto = {
  servers: DatalinkServerDto[];
};

export type DatalinkGraphResponseDto = {
  graph: DatalinkGraphDto;
  server: DatalinkServerDto;
};

export type DatalinkToolResponseDto = {
  result: string;
  server: DatalinkServerDto;
};

export type ModelProfileDto = {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  fallbackProfileId?: string;
  frequencyPenalty?: number;
  maxTokens?: number;
  presencePenalty?: number;
  contextLength?: number;
  reasoningModel?: boolean;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  connectionStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SkillDto = {
  id: string;
  name: string;
  description?: string;
  allowedTools?: string[];
  version?: string;
  packageFileRefId?: string;
  packageFileName?: string;
  packageFormat?: "skill-md" | "zip";
  packageSource?: string;
  manifest?: Record<string, unknown>;
  defaultDbIds?: string[];
  defaultKbIds?: string[];
  defaultMcpIds?: string[];
  modelProfileId?: string;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  validationStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceConfigDto = {
  datasources: DatasourceDto[];
  knowledgeBases: KnowledgeBaseDto[];
  mcpServers: McpServerDto[];
  modelProfiles: ModelProfileDto[];
  skills: SkillDto[];
};

export type RunDefaultsDto = {
  enabledDatasourceIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  enabledSkillIds: string[];
  activeDatasourceId?: string;
  activeLlmProfileId: string | null;
  activeSkillId: string;
};

export type ConversationMessageDto = {
  id: string;
  runId: string;
  role: "assistant" | "user";
  source: "agent" | "client";
  messageId?: string;
  contentText: string;
  contentParts?: Array<{ type: "reasoning" | "text"; text: string }>;
  evidenceRefs?: EvidenceRef[];
  position: number;
  createdAt: string;
};

export type ConversationSummaryDto = {
  id: string;
  sourceRunId?: string;
  fromPosition: number;
  toPosition: number;
  summaryText: string;
  createdAt: string;
};

export type ConversationRunEventRefDto = {
  runId: string;
  eventCount: number;
  firstSeq?: number;
  lastSeq?: number;
};

export type ConversationCheckpointDto = {
  runId: string;
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "canceled";
  messageStartPosition?: number;
  messageEndPosition?: number;
  firstEventSeq?: number;
  lastEventSeq?: number;
  /** Absent for legacy event-only runs that have no `runs` row. */
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  /** Canonical terminal event name for the run status ("RUN_FINISHED" | "RUN_ERROR"). */
  terminalEvent?: "RUN_FINISHED" | "RUN_ERROR";
  /** Authoritative ids of artifacts produced by this run (R-018). */
  artifactIds?: string[];
};

export type ConversationBranchDto = {
  sessionId: string;
  threadId?: string;
  parentSessionId: string;
  rootSessionId: string;
  forkRunId: string;
  forkCheckpointId?: string;
  forkMessageEndPosition: number;
  isOriginal?: boolean;
  createdAt: string;
  title?: string;
};

export type SessionBranchDto = {
  id: string;
  sessionId: string;
  threadId?: string;
  parentSessionId: string;
  rootSessionId: string;
  forkRunId: string;
  forkCheckpointId?: string;
  forkMessageEndPosition: number;
  createdAt: string;
  title?: string;
  session: SessionListItemDto;
};

export type ContextCheckpointDto = {
  id: string;
  sessionId: string;
  runId: string;
  branchId: string;
  eventSeq: number;
  contextPackageId: string;
  contextPackageRevision: number;
  kind: "context-compiled" | "run-terminal" | "tool-result";
  status: "stable" | "failed" | "terminal";
  label: string;
  contextPlanId?: string;
  parentCheckpointId?: string;
  stepNumber?: number;
  stepId?: string;
  toolCallId?: string;
  messagePosition?: number;
  createdAt: string;
};

export type TraceDagNodeKind =
  | "artifact"
  | "branch"
  | "context"
  | "run-start"
  | "run-terminal"
  | "tool"
  | "user-turn";

export type TraceDagContextDetailDto = {
  type: "context";
  assistantOutput?: string;
  budgetTokens?: number;
  decisions?: unknown[];
  inputBudget?: number;
  model?: string;
  modelProfileId?: string;
  omittedGroupIds?: string[];
  omittedSources?: unknown[];
  packageId?: string;
  packageRevision?: number;
  planId?: string;
  promptTokens?: number;
  reasoning?: string;
  remainingTokens?: number;
  selectedGroupIds?: string[];
  selectedSources?: unknown[];
  stepNumber?: number;
  tokenReport?: unknown;
  totalTokens?: number;
};

export type TraceDagToolDetailDto = {
  type: "tool";
  arguments?: unknown;
  argumentsText?: string;
  result?: unknown;
  resultText?: string;
  toolName?: string;
};

export type TraceDagArtifactDetailDto = {
  type: "artifact";
  artifactType?: string;
  mimeType?: string;
  name?: string;
  preview?: unknown;
};

export type TraceDagTerminalDetailDto = {
  type: "terminal";
  error?: string;
  message?: string;
};

export type TraceDagNodeDetailDto =
  | TraceDagArtifactDetailDto
  | TraceDagContextDetailDto
  | TraceDagTerminalDetailDto
  | TraceDagToolDetailDto;

export type TraceDagNodeDto = {
  id: string;
  kind: TraceDagNodeKind;
  label: string;
  artifactId?: string;
  checkpointId?: string;
  checkpointKind?: ContextCheckpointDto["kind"];
  checkpointStatus?: ContextCheckpointDto["status"];
  createdAt?: string;
  eventSeq?: number;
  messageId?: string;
  messagePosition?: number;
  prominent?: boolean;
  rollbackable?: boolean;
  runId?: string;
  sessionId?: string;
  status?: string;
  summary?: string;
  toolCallId?: string;
  detail?: TraceDagNodeDetailDto;
};

export type TraceDagEdgeKind =
  | "branches_from"
  | "continues_to"
  | "emits"
  | "produces_artifact"
  | "starts_run";

export type TraceDagEdgeDto = {
  id: string;
  source: string;
  target: string;
  kind: TraceDagEdgeKind;
  label?: string;
};

export type TraceDagDto = {
  sessionId: string;
  nodes: TraceDagNodeDto[];
  edges: TraceDagEdgeDto[];
  sections: TraceDagSectionDto[];
};

export type TraceDagSectionDto = {
  id: string;
  runId: string;
  phaseKey: string;
  status: "completed" | "failed" | "in-progress";
  title: string;
  summary: string;
  startEventSeq: number;
  endEventSeq: number;
  nodeIds: string[];
};

export type ConversationToolCallDto = {
  runId: string;
  id?: string;
  toolCallId: string;
  status: "completed" | "failed" | "pending";
  /** Authoritative "run is suspended waiting on this HITL tool" flag (R-018). */
  awaitingInteraction?: boolean;
  name?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  callEventSeq?: number;
  endEventSeq?: number;
  resultEventSeq?: number;
  parentMessageId?: string;
  resultMessageId?: string;
  resultPreview?: string;
};

export type RestorableCustomEventDto = {
  runId: string;
  seq: number;
  name: string;
  value: unknown;
};

export type PendingInteractionDto = {
  interactionId: string;
  runId: string;
  toolCallId: string;
  toolName: "ask_user" | "submit_plan";
  interruptEvent?: unknown;
  payload?: unknown;
  resumeSchema?: unknown;
};

export type SessionActiveRunDto = {
  sessionId: string;
  activeRunId: string;
  status: "queued" | "running" | "suspended";
  startedAt: string;
  userInputPreview: string;
};

export type SessionEnergyContextDto = {
  sourceRunId?: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: "electricity" | "water";
  timezone: string;
  from: string;
  to: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  projectReleaseId?: string;
  dataSnapshotId: string;
  forkedFromSessionId?: string;
  forkedFromContextStatus?: "available" | "unavailable";
  forkedFromUnavailableReason?:
    | "source-run-unavailable"
    | "source-context-unavailable";
  forkedFromRunId?: string;
  forkedFromFrom?: string;
  forkedFromTo?: string;
};

export type ContinueEnergySessionResponseDto = {
  session: SessionListItemDto;
  energyContext: SessionEnergyContextDto;
};

export type SessionConversationDto = {
  sessionId: string;
  title?: string;
  titleSource?: string;
  updatedAt?: string;
  messages: ConversationMessageDto[];
  summary?: ConversationSummaryDto;
  runEventRefs: ConversationRunEventRefDto[];
  checkpoints?: ConversationCheckpointDto[];
  branch?: Omit<ConversationBranchDto, "isOriginal"> & { id: string };
  branches?: ConversationBranchDto[];
  toolCalls: ConversationToolCallDto[];
  pendingInteractions?: PendingInteractionDto[];
  restorableCustomEvents?: RestorableCustomEventDto[];
  activeRun?: SessionActiveRunDto | null;
  energyContext?: SessionEnergyContextDto;
};

export type SessionListItemDto = {
  id: string;
  threadId: string;
  workspaceId?: string;
  projectId?: string;
  title?: string;
  titleSource?: string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string;
  activeRun?: SessionActiveRunDto | null;
};

export type SessionListResponseDto = {
  sessions: SessionListItemDto[];
  nextCursor?: string;
};

export type SessionTitleDto = {
  sessionId: string;
  title: string;
  titleSource?: string;
  updatedAt?: string;
};

export type JobDto = {
  id: string;
  workspace_id?: string;
  user_id?: string;
  type: string;
  resource_id: string;
  resourceId?: string;
  artifactId?: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  result?: Record<string, unknown>;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
};

export type ArtifactExportFormat = "csv" | "xlsx";

export type RunCancelDto = {
  canceled: boolean;
  runId: string;
  sessionId?: string;
  persistedOnly?: boolean;
  reason?: string;
};

export type DatasourceSchemaColumnDto = {
  name: string;
  type?: string;
  nullable?: boolean;
  description?: string;
};

export type DatasourceSchemaTableDto = {
  name: string;
  table?: string;
  description?: string;
  sampleAvailable?: boolean;
  columns: DatasourceSchemaColumnDto[];
  stats?: {
    rowCount?: number;
    sizeBytes?: number;
  };
};

export type DatasourceSchemaDto = {
  datasourceId?: string;
  datasource_id?: string;
  tables: DatasourceSchemaTableDto[];
  inspectedAt?: string;
  adapterSchemaVersion?: number;
};

export type DatasourceTablePreviewColumnDto = {
  name: string;
  type?: string;
};

export type DatasourceTablePreviewDto = {
  columns: DatasourceTablePreviewColumnDto[];
  rows: Array<Record<string, unknown>>;
  total?: number;
  hasMore?: boolean;
};

export type QueryHistoryItemDto = {
  id: string;
  sessionId?: string;
  runId?: string;
  datasourceId?: string;
  sql: string;
  rowCount?: number;
  elapsedMs?: number;
  favorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type QueryHistoryListResponseDto = {
  queries: QueryHistoryItemDto[];
};

export type ArtifactDto = {
  id: string;
  type?: string;
  name?: string;
  fileId?: string;
  downloadUrl?: string;
  preview_json?: Record<string, unknown> | null;
  /** True when preview_json exists or a file-backed preview can be synthesized. */
  preview_available?: boolean;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  /** For session-file outputs: `session_file:<path>`. */
  logicalKey?: string;
  /** Number of stored versions. 0 when no version records exist (legacy artifacts). */
  versionCount?: number;
  /** Authoritative origin (R-018): the producing run / tool call / step. */
  runId?: string;
  toolCallId?: string;
  stepId?: string;
};

export type ArtifactVersionDto = {
  id: string;
  version: number;
  fileId?: string;
  downloadUrl?: string;
  createdAt: string;
};

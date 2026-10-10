import type { DatabaseSync } from "node:sqlite";

export type EnergyIqPolicyOwner =
  | { kind: "project" }
  | { kind: "scope"; scope_id: string };

/**
 * Time-of-use pricing: rate_per_kwh is the off-peak price and peak_rate_per_kwh applies inside the peak windows,
 * which are local times at the site. Public holidays in the operating calendar are off-peak all day when
 * holidays_off_peak is set.
 */
export type EnergyIqTariffTimeOfUse = {
  peak_rate_per_kwh: number;
  peak_windows: Array<{ days: EnergyIqOperatingDay[]; from: string; to: string }>;
  holidays_off_peak: boolean;
};

/** A charge that is not per kWh, kept with the rate for reference. Cost figures do not include it. */
export type EnergyIqTariffFixedCharge = {
  label: string;
  amount: number;
  unit: "per_month" | "per_kw_month";
};

/** The published tariff a rate was taken from, e.g. "TNB Low voltage, Time of Use". */
export type EnergyIqTariffPlan = { id: string; label: string; source?: string };

export type EnergyIqTariffScheduleEntry = {
  id: string;
  owner: EnergyIqPolicyOwner;
  effective_from: string;
  effective_to?: string;
  currency: string;
  rate_per_kwh: number;
  rate_basis?: "tax_inclusive" | "tax_exclusive";
  tax?: { name: string; rate_pct: number };
  time_of_use?: EnergyIqTariffTimeOfUse;
  fixed_charges?: EnergyIqTariffFixedCharge[];
  plan?: EnergyIqTariffPlan;
};

export type EnergyIqTariffScheduleRevision = {
  version_id: string;
  project_id: string;
  entries: EnergyIqTariffScheduleEntry[];
  published_by: string;
  published_at: string;
};

export type EnergyIqOperatingDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type EnergyIqOperatingTimeRange = {
  from: string;
  to: string;
};

export type EnergyIqCalendarExceptionClassification =
  | "public_holiday"
  | "special_closure"
  | "special_operating_day";

export type EnergyIqAcademicPhase =
  | "teaching"
  | "term_break"
  | "study_exam"
  | "vacation";

export type EnergyIqAcademicCalendarPeriod = {
  id: string;
  from: string;
  to: string;
  phase: EnergyIqAcademicPhase;
  label?: string;
  source: {
    label: string;
    url?: string;
  };
};

export type EnergyIqOperatingCalendarEntry = {
  id: string;
  owner: EnergyIqPolicyOwner;
  effective_from: string;
  effective_to?: string;
  weekly: Record<EnergyIqOperatingDay, EnergyIqOperatingTimeRange[]>;
  exceptions?: Array<{
    date: string;
    operating: EnergyIqOperatingTimeRange[];
    label?: string;
    classification?: EnergyIqCalendarExceptionClassification;
  }>;
};

export type EnergyIqOperatingCalendarRevision = {
  version_id: string;
  project_id: string;
  timezone: string;
  entries: EnergyIqOperatingCalendarEntry[];
  academic_periods?: EnergyIqAcademicCalendarPeriod[];
  published_by: string;
  published_at: string;
};

export type EnergyIqCalendarDateContextResolution =
  | {
      status: "available";
      timezone: string;
      business_calendar_version: string;
      dates: Array<{
        local_date: string;
        week_part: "weekday" | "weekend";
        is_public_holiday: boolean;
        public_holiday_label?: string;
        academic_phase: EnergyIqAcademicPhase;
        school_holiday_state: "school_holiday" | "non_school_holiday";
        academic_period_id: string;
        academic_period_label?: string;
        academic_period_from: string;
        academic_period_to_exclusive: string;
        academic_source: EnergyIqAcademicCalendarPeriod["source"];
      }>;
    }
  | {
      status: "unavailable";
      timezone: string;
      business_calendar_version: string;
      reason: {
        code:
          | "OPERATING_CALENDAR_VERSION_NOT_FOUND"
          | "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD"
          | "ACADEMIC_CALENDAR_CONTEXT_NOT_EFFECTIVE_FOR_PERIOD";
        message: string;
      };
    };

export type EnergyIqAnalysisInterval = {
  start: string;
  end_exclusive: string;
  usage_kwh: number;
};

export type EnergyIqOperationalPolicySource =
  | { mode: "active" }
  | {
      mode: "release-pinned";
      tariff_schedule_version: string;
      business_calendar_version: string;
    };

export type EnergyIqEvaluateAnalysisPolicyInput = {
  project_id: string;
  scope_id: string;
  period: { from: string; to: string };
  intervals: EnergyIqAnalysisInterval[];
  policy_source: EnergyIqOperationalPolicySource;
};

export type EnergyIqPolicyUnavailableReasonCode =
  | "TARIFF_VERSION_MISSING"
  | "TARIFF_VERSION_NOT_FOUND"
  | "TARIFF_NOT_EFFECTIVE_FOR_PERIOD"
  | "TARIFF_CURRENCY_CONFLICT"
  | "COST_FACTS_UNAVAILABLE"
  | "OPERATING_CALENDAR_VERSION_MISSING"
  | "OPERATING_CALENDAR_VERSION_NOT_FOUND"
  | "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD"
  | "OPERATING_FACTS_UNAVAILABLE";

export type EnergyIqPolicyUnavailableReason = {
  code: EnergyIqPolicyUnavailableReasonCode;
  message: string;
};

export type EnergyIqTariffEvaluation =
  | {
      status: "available";
      currency: string;
      tariff_schedule_version: string;
      total_cost: number;
      allocations: Array<{
        from: string;
        to: string;
        /** Present for time-of-use rates: which part of the day this usage and price belong to. */
        period?: "peak" | "off_peak";
        rate_per_kwh: number;
        rate_basis?: "tax_inclusive" | "tax_exclusive";
        tax?: { name: string; rate_pct: number };
        tax_inclusive_rate_per_kwh?: number;
        tax_exclusive_rate_per_kwh?: number;
        usage_kwh: number;
        cost: number;
      }>;
    }
  | {
      status: "unavailable";
      reason: EnergyIqPolicyUnavailableReason;
      tariff_schedule_version?: string;
    };

export type EnergyIqOperatingEvaluation =
  | {
      status: "available";
      timezone: string;
      business_calendar_version: string;
      operating_kwh: number;
      standby_kwh: number;
    }
  | {
      status: "unavailable";
      reason: EnergyIqPolicyUnavailableReason;
      business_calendar_version?: string;
    };

export type EnergyIqOperationalPolicyEvaluation = {
  tariff: EnergyIqTariffEvaluation;
  operating: EnergyIqOperatingEvaluation;
};

type EffectiveTariffSegment = {
  fromMs: number;
  toMs: number;
  entry: EnergyIqTariffScheduleEntry;
};

type EffectiveOperatingWindow = {
  fromMs: number;
  toMs: number;
};

const OPERATING_DAYS: EnergyIqOperatingDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const initializeEnergyIqOperationalPolicySchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_tariff_schedule_revisions (
      version_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entries_json TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE (project_id, version_id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (published_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_tariff_revisions_project
      ON energyiq_tariff_schedule_revisions(project_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_operating_calendar_revisions (
      version_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timezone TEXT NOT NULL,
      entries_json TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE (project_id, version_id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (published_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_operating_calendar_revisions_project
      ON energyiq_operating_calendar_revisions(project_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_operational_policy_bindings (
      project_id TEXT PRIMARY KEY,
      tariff_schedule_version TEXT,
      business_calendar_version TEXT,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, tariff_schedule_version)
        REFERENCES energyiq_tariff_schedule_revisions(project_id, version_id),
      FOREIGN KEY (project_id, business_calendar_version)
        REFERENCES energyiq_operating_calendar_revisions(project_id, version_id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TRIGGER IF NOT EXISTS energyiq_tariff_schedule_revisions_no_update
    BEFORE UPDATE ON energyiq_tariff_schedule_revisions
    BEGIN
      SELECT RAISE(ABORT, 'ENERGYIQ_TARIFF_REVISION_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS energyiq_tariff_schedule_revisions_no_delete
    BEFORE DELETE ON energyiq_tariff_schedule_revisions
    BEGIN
      SELECT RAISE(ABORT, 'ENERGYIQ_TARIFF_REVISION_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS energyiq_operating_calendar_revisions_no_update
    BEFORE UPDATE ON energyiq_operating_calendar_revisions
    BEGIN
      SELECT RAISE(ABORT, 'ENERGYIQ_OPERATING_CALENDAR_REVISION_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS energyiq_operating_calendar_revisions_no_delete
    BEFORE DELETE ON energyiq_operating_calendar_revisions
    BEGIN
      SELECT RAISE(ABORT, 'ENERGYIQ_OPERATING_CALENDAR_REVISION_IMMUTABLE');
    END;
  `);
};

export const ensureEnergyIqOperationalPolicyBindingOwnershipSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_energyiq_tariff_revisions_project_version
      ON energyiq_tariff_schedule_revisions(project_id, version_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_energyiq_operating_calendar_revisions_project_version
      ON energyiq_operating_calendar_revisions(project_id, version_id);
  `);
  if (hasCompositePolicyBindingForeignKeys(db)) return;

  const invalidBinding = db.prepare(`
    SELECT b.project_id
    FROM energyiq_operational_policy_bindings b
    WHERE (
      b.tariff_schedule_version IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM energyiq_tariff_schedule_revisions t
        WHERE t.project_id = b.project_id
          AND t.version_id = b.tariff_schedule_version
      )
    ) OR (
      b.business_calendar_version IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM energyiq_operating_calendar_revisions c
        WHERE c.project_id = b.project_id
          AND c.version_id = b.business_calendar_version
      )
    )
    LIMIT 1
  `).get();
  if (isRecord(invalidBinding)) {
    throw new Error(
      `ENERGYIQ_OPERATIONAL_POLICY_BINDING_PROJECT_MISMATCH:${requiredString(invalidBinding, "project_id")}`,
    );
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      ALTER TABLE energyiq_operational_policy_bindings
        RENAME TO energyiq_operational_policy_bindings_legacy;
      CREATE TABLE energyiq_operational_policy_bindings (
        project_id TEXT PRIMARY KEY,
        tariff_schedule_version TEXT,
        business_calendar_version TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, tariff_schedule_version)
          REFERENCES energyiq_tariff_schedule_revisions(project_id, version_id),
        FOREIGN KEY (project_id, business_calendar_version)
          REFERENCES energyiq_operating_calendar_revisions(project_id, version_id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );
      INSERT INTO energyiq_operational_policy_bindings (
        project_id, tariff_schedule_version, business_calendar_version, updated_by, updated_at
      )
      SELECT project_id, tariff_schedule_version, business_calendar_version, updated_by, updated_at
      FROM energyiq_operational_policy_bindings_legacy;
      DROP TABLE energyiq_operational_policy_bindings_legacy;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export class EnergyIqOperationalPolicyStore {
  constructor(private readonly db: DatabaseSync) {}

  publishTariffSchedule(input: {
    version_id: string;
    project_id: string;
    entries: EnergyIqTariffScheduleEntry[];
    published_by: string;
    published_at?: string;
    activate?: boolean;
  }): EnergyIqTariffScheduleRevision {
    this.requireProject(input.project_id);
    const entries = canonicalizeTariffEntries(input.entries);
    this.validateOwners(input.project_id, entries.map((entry) => entry.owner));
    const publishedAt = input.published_at ?? new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO energyiq_tariff_schedule_revisions (
          version_id, project_id, entries_json, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        input.version_id,
        input.project_id,
        JSON.stringify(entries),
        input.published_by,
        publishedAt,
      );
      if (input.activate) {
        this.activateVersionsWithinTransaction({
          project_id: input.project_id,
          tariff_schedule_version: input.version_id,
          updated_by: input.published_by,
          updated_at: publishedAt,
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getTariffSchedule(input.version_id);
  }

  getTariffSchedule(versionId: string): EnergyIqTariffScheduleRevision {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_tariff_schedule_revisions WHERE version_id = ?
    `).get(versionId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_TARIFF_REVISION_NOT_FOUND:${versionId}`);
    }
    return mapTariffRevision(row);
  }

  listTariffSchedules(projectId: string): EnergyIqTariffScheduleRevision[] {
    this.requireProject(projectId);
    return this.db.prepare(`
      SELECT * FROM energyiq_tariff_schedule_revisions
      WHERE project_id = ?
      ORDER BY published_at DESC, version_id DESC
    `).all(projectId).filter(isRecord).map(mapTariffRevision);
  }

  publishOperatingCalendar(input: {
    version_id: string;
    project_id: string;
    entries: EnergyIqOperatingCalendarEntry[];
    academic_periods?: EnergyIqAcademicCalendarPeriod[];
    published_by: string;
    published_at?: string;
    activate?: boolean;
  }): EnergyIqOperatingCalendarRevision {
    const project = this.requireProject(input.project_id);
    const timezone = requiredString(project, "timezone");
    assertTimeZone(timezone);
    const entries = canonicalizeOperatingCalendarEntries(input.entries);
    const academicPeriods = canonicalizeAcademicCalendarPeriods(input.academic_periods ?? []);
    this.validateOwners(input.project_id, entries.map((entry) => entry.owner));
    const publishedAt = input.published_at ?? new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO energyiq_operating_calendar_revisions (
          version_id, project_id, timezone, entries_json, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.version_id,
        input.project_id,
        timezone,
        JSON.stringify(academicPeriods.length > 0
          ? { entries, academic_periods: academicPeriods }
          : entries),
        input.published_by,
        publishedAt,
      );
      if (input.activate) {
        this.activateVersionsWithinTransaction({
          project_id: input.project_id,
          business_calendar_version: input.version_id,
          updated_by: input.published_by,
          updated_at: publishedAt,
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getOperatingCalendar(input.version_id);
  }

  getOperatingCalendar(versionId: string): EnergyIqOperatingCalendarRevision {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_operating_calendar_revisions WHERE version_id = ?
    `).get(versionId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_OPERATING_CALENDAR_REVISION_NOT_FOUND:${versionId}`);
    }
    return mapOperatingCalendarRevision(row);
  }

  listOperatingCalendars(projectId: string): EnergyIqOperatingCalendarRevision[] {
    this.requireProject(projectId);
    return this.db.prepare(`
      SELECT * FROM energyiq_operating_calendar_revisions
      WHERE project_id = ?
      ORDER BY published_at DESC, version_id DESC
    `).all(projectId).filter(isRecord).map(mapOperatingCalendarRevision);
  }

  resolveOperatingCalendarExceptionDates(input: {
    project_id: string;
    scope_id: string;
    version_id: string;
    period: { from: string; to: string };
  }): {
    timezone: string;
    business_calendar_version: string;
    exception_dates: string[];
    exceptions: Array<{
      date: string;
      classification?: EnergyIqCalendarExceptionClassification;
    }>;
  } | undefined {
    const period = parsePeriod(input.period);
    const scopeLineage = this.resolveScopeLineage(input.project_id, input.scope_id);
    const row = this.db.prepare(`
      SELECT * FROM energyiq_operating_calendar_revisions
      WHERE version_id = ? AND project_id = ?
    `).get(input.version_id, input.project_id);
    if (!isRecord(row)) return undefined;
    const revision = mapOperatingCalendarRevision(row);
    const exceptions = resolveOperatingCalendarExceptions({
      revision,
      scopeLineage,
      period,
    });
    if (!exceptions) return undefined;
    return {
      timezone: revision.timezone,
      business_calendar_version: revision.version_id,
      exception_dates: exceptions.map((exception) => exception.date),
      exceptions,
    };
  }

  resolveCalendarDateContexts(input: {
    project_id: string;
    scope_id: string;
    version_id: string;
    period: { from: string; to: string };
  }): EnergyIqCalendarDateContextResolution {
    const period = parsePeriod(input.period);
    const project = this.requireProject(input.project_id);
    const timezone = requiredString(project, "timezone");
    const row = this.db.prepare(`
      SELECT * FROM energyiq_operating_calendar_revisions
      WHERE version_id = ? AND project_id = ?
    `).get(input.version_id, input.project_id);
    if (!isRecord(row)) {
      return {
        status: "unavailable",
        timezone,
        business_calendar_version: input.version_id,
        reason: {
          code: "OPERATING_CALENDAR_VERSION_NOT_FOUND",
          message: `Operating Calendar Revision ${input.version_id} was not found for Project ${input.project_id}.`,
        },
      };
    }
    const revision = mapOperatingCalendarRevision(row);
    const scopeLineage = this.resolveScopeLineage(input.project_id, input.scope_id);
    const firstDate = localDateAtInstant(period.fromMs, revision.timezone);
    const lastDate = localDateAtInstant(period.toMs - 1, revision.timezone);
    const dates: Extract<EnergyIqCalendarDateContextResolution, { status: "available" }>["dates"] = [];
    for (const localDate of localDateRange(firstDate, lastDate)) {
      const operatingEntry = resolveOperatingCalendarEntryForDate({
        entries: revision.entries,
        scopeLineage,
        date: localDate,
      });
      if (!operatingEntry) {
        return {
          status: "unavailable",
          timezone: revision.timezone,
          business_calendar_version: revision.version_id,
          reason: {
            code: "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD",
            message: `No release-pinned Operating Calendar entry covers local date ${localDate}.`,
          },
        };
      }
      const academicPeriod = (revision.academic_periods ?? []).find((candidate) => (
        candidate.from <= localDate && candidate.to > localDate
      ));
      if (!academicPeriod) {
        return {
          status: "unavailable",
          timezone: revision.timezone,
          business_calendar_version: revision.version_id,
          reason: {
            code: "ACADEMIC_CALENDAR_CONTEXT_NOT_EFFECTIVE_FOR_PERIOD",
            message: `No release-pinned Academic Phase covers local date ${localDate}.`,
          },
        };
      }
      const publicHoliday = operatingEntry.exceptions?.find((candidate) => (
        candidate.date === localDate && candidate.classification === "public_holiday"
      ));
      const operatingDay = dayAtLocalDate(localDate);
      dates.push({
        local_date: localDate,
        week_part: operatingDay === "saturday" || operatingDay === "sunday" ? "weekend" : "weekday",
        is_public_holiday: Boolean(publicHoliday),
        ...(publicHoliday?.label ? { public_holiday_label: publicHoliday.label } : {}),
        academic_phase: academicPeriod.phase,
        school_holiday_state: academicPeriod.phase === "term_break" || academicPeriod.phase === "vacation"
          ? "school_holiday"
          : "non_school_holiday",
        academic_period_id: academicPeriod.id,
        ...(academicPeriod.label ? { academic_period_label: academicPeriod.label } : {}),
        academic_period_from: academicPeriod.from,
        academic_period_to_exclusive: academicPeriod.to,
        academic_source: academicPeriod.source,
      });
    }
    return {
      status: "available",
      timezone: revision.timezone,
      business_calendar_version: revision.version_id,
      dates,
    };
  }

  activateProjectPolicies(input: {
    project_id: string;
    tariff_schedule_version?: string;
    business_calendar_version?: string;
    updated_by: string;
    updated_at?: string;
  }): { tariff_schedule_version?: string; business_calendar_version?: string } {
    this.requireProject(input.project_id);
    if (!input.tariff_schedule_version && !input.business_calendar_version) {
      throw new Error("ENERGYIQ_OPERATIONAL_POLICY_VERSION_REQUIRED");
    }
    if (input.tariff_schedule_version) {
      this.requireOwnedRevision(
        "energyiq_tariff_schedule_revisions",
        input.tariff_schedule_version,
        input.project_id,
      );
    }
    if (input.business_calendar_version) {
      this.requireOwnedRevision(
        "energyiq_operating_calendar_revisions",
        input.business_calendar_version,
        input.project_id,
      );
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.activateVersionsWithinTransaction({
        project_id: input.project_id,
        ...(input.tariff_schedule_version
          ? { tariff_schedule_version: input.tariff_schedule_version }
          : {}),
        ...(input.business_calendar_version
          ? { business_calendar_version: input.business_calendar_version }
          : {}),
        updated_by: input.updated_by,
        updated_at: input.updated_at ?? new Date().toISOString(),
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getActivePolicyVersions(input.project_id);
  }

  getActivePolicyVersions(projectId: string): {
    tariff_schedule_version?: string;
    business_calendar_version?: string;
  } {
    const row = this.db.prepare(`
      SELECT tariff_schedule_version, business_calendar_version
      FROM energyiq_operational_policy_bindings
      WHERE project_id = ?
    `).get(projectId);
    if (!isRecord(row)) return {};
    const tariffVersion = optionalString(row.tariff_schedule_version);
    const calendarVersion = optionalString(row.business_calendar_version);
    return {
      ...(tariffVersion ? { tariff_schedule_version: tariffVersion } : {}),
      ...(calendarVersion ? { business_calendar_version: calendarVersion } : {}),
    };
  }

  evaluateAnalysisPolicy(input: EnergyIqEvaluateAnalysisPolicyInput): EnergyIqOperationalPolicyEvaluation {
    if (
      Object.prototype.hasOwnProperty.call(input, "tariff_schedule_version")
      || Object.prototype.hasOwnProperty.call(input, "business_calendar_version")
    ) {
      throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SOURCE_INVALID");
    }
    const policySource = validatePolicySource(input.policy_source);
    const period = parsePeriod(input.period);
    const intervals = canonicalizeIntervals(input.intervals, period);
    const scopeLineage = this.resolveScopeLineage(input.project_id, input.scope_id);
    const versions = policySource.mode === "active"
      ? this.getActivePolicyVersions(input.project_id)
      : {
          tariff_schedule_version: policySource.tariff_schedule_version,
          business_calendar_version: policySource.business_calendar_version,
        };

    return {
      tariff: this.evaluateTariff({
        projectId: input.project_id,
        scopeLineage,
        period,
        intervals,
        versionId: versions.tariff_schedule_version,
        timezone: requiredString(this.requireProject(input.project_id), "timezone"),
        publicHolidays: () => this.publicHolidayDates({
          projectId: input.project_id,
          scopeLineage,
          period,
          versionId: versions.business_calendar_version,
        }),
      }),
      operating: this.evaluateOperating({
        projectId: input.project_id,
        scopeLineage,
        period,
        intervals,
        versionId: versions.business_calendar_version,
      }),
    };
  }

  /** Local dates the operating calendar marks as public holidays. Dates it does not cover simply are not holidays. */
  private publicHolidayDates(input: {
    projectId: string;
    scopeLineage: string[];
    period: { fromMs: number; toMs: number };
    versionId: string | undefined;
  }): Set<string> {
    if (!input.versionId) return new Set();
    const row = this.db.prepare(`
      SELECT * FROM energyiq_operating_calendar_revisions
      WHERE version_id = ? AND project_id = ?
    `).get(input.versionId, input.projectId);
    if (!isRecord(row)) return new Set();
    const revision = mapOperatingCalendarRevision(row);
    const dates = new Set<string>();
    const firstDate = localDateAtInstant(input.period.fromMs, revision.timezone);
    const lastDate = localDateAtInstant(input.period.toMs - 1, revision.timezone);
    for (const date of localDateRange(firstDate, lastDate)) {
      const entry = resolveOperatingCalendarEntryForDate({ entries: revision.entries, scopeLineage: input.scopeLineage, date });
      if (entry?.exceptions?.some((exception) => exception.date === date && exception.classification === "public_holiday")) {
        dates.add(date);
      }
    }
    return dates;
  }

  private evaluateTariff(input: {
    projectId: string;
    scopeLineage: string[];
    period: { fromMs: number; toMs: number };
    intervals: EnergyIqAnalysisInterval[];
    versionId: string | undefined;
    timezone: string;
    publicHolidays: () => Set<string>;
  }): EnergyIqTariffEvaluation {
    if (!input.versionId) {
      return unavailable(
        "TARIFF_VERSION_MISSING",
        "No published Tariff schedule is active for this Project.",
      );
    }
    const row = this.db.prepare(`
      SELECT * FROM energyiq_tariff_schedule_revisions
      WHERE version_id = ? AND project_id = ?
    `).get(input.versionId, input.projectId);
    if (!isRecord(row)) {
      return unavailable(
        "TARIFF_VERSION_NOT_FOUND",
        `Tariff schedule ${input.versionId} is not published for this Project.`,
        { tariff_schedule_version: input.versionId },
      );
    }
    if (input.intervals.length === 0) {
      return unavailable(
        "COST_FACTS_UNAVAILABLE",
        "Cost is unavailable because the analysis has no interval energy facts.",
        { tariff_schedule_version: input.versionId },
      );
    }

    const revision = mapTariffRevision(row);
    const segments = resolveTariffSegments({
      entries: revision.entries,
      scopeLineage: input.scopeLineage,
      period: input.period,
    });
    if (!segments) {
      return unavailable(
        "TARIFF_NOT_EFFECTIVE_FOR_PERIOD",
        "The published Tariff schedule does not cover the complete analysis period.",
        { tariff_schedule_version: input.versionId },
      );
    }
    const currencies = new Set(segments.map((segment) => segment.entry.currency));
    if (currencies.size !== 1) {
      return unavailable(
        "TARIFF_CURRENCY_CONFLICT",
        "The effective Tariff segments use more than one currency and cannot be totalled.",
        { tariff_schedule_version: input.versionId },
      );
    }

    let holidays: Set<string> | undefined;
    const allocations = segments.flatMap((segment) => {
      const timeOfUse = segment.entry.time_of_use;
      const peakWindows = timeOfUse
        ? resolvePeakWindows({
            timeOfUse,
            fromMs: segment.fromMs,
            toMs: segment.toMs,
            timezone: input.timezone,
            holidays: timeOfUse.holidays_off_peak ? (holidays ??= input.publicHolidays()) : new Set(),
          })
        : [];
      let usage = 0;
      let peakUsage = 0;
      for (const interval of input.intervals) {
        const intervalFrom = Date.parse(interval.start);
        const intervalTo = Date.parse(interval.end_exclusive);
        const overlapFrom = Math.max(segment.fromMs, intervalFrom);
        const overlapTo = Math.min(segment.toMs, intervalTo);
        if (overlapTo <= overlapFrom) continue;
        const share = interval.usage_kwh / (intervalTo - intervalFrom);
        usage += share * (overlapTo - overlapFrom);
        if (timeOfUse) peakUsage += share * overlapWithWindows(peakWindows, overlapFrom, overlapTo);
      }
      const allocation = (rate: number, usageKwh: number, period?: "peak" | "off_peak") => {
        const roundedUsage = round(usageKwh);
        return {
          from: new Date(segment.fromMs).toISOString(),
          to: new Date(segment.toMs).toISOString(),
          ...(period ? { period } : {}),
          rate_per_kwh: rate,
          ...(segment.entry.rate_basis ? {
            rate_basis: segment.entry.rate_basis,
            tax: segment.entry.tax,
            ...deriveTaxRates(segment.entry, rate),
          } : {}),
          usage_kwh: roundedUsage,
          cost: round(roundedUsage * rate),
        };
      };
      if (!timeOfUse) return [allocation(segment.entry.rate_per_kwh, usage)];
      return [
        allocation(timeOfUse.peak_rate_per_kwh, peakUsage, "peak"),
        allocation(segment.entry.rate_per_kwh, Math.max(0, usage - peakUsage), "off_peak"),
      ];
    });

    return {
      status: "available",
      currency: [...currencies][0] as string,
      tariff_schedule_version: revision.version_id,
      total_cost: round(allocations.reduce((total, allocation) => total + allocation.cost, 0)),
      allocations,
    };
  }

  private evaluateOperating(input: {
    projectId: string;
    scopeLineage: string[];
    period: { fromMs: number; toMs: number };
    intervals: EnergyIqAnalysisInterval[];
    versionId: string | undefined;
  }): EnergyIqOperatingEvaluation {
    if (!input.versionId) {
      return unavailable(
        "OPERATING_CALENDAR_VERSION_MISSING",
        "No published operating calendar is active for this Project.",
      );
    }
    const row = this.db.prepare(`
      SELECT * FROM energyiq_operating_calendar_revisions
      WHERE version_id = ? AND project_id = ?
    `).get(input.versionId, input.projectId);
    if (!isRecord(row)) {
      return unavailable(
        "OPERATING_CALENDAR_VERSION_NOT_FOUND",
        `Operating calendar ${input.versionId} is not published for this Project.`,
        { business_calendar_version: input.versionId },
      );
    }
    if (input.intervals.length === 0) {
      return unavailable(
        "OPERATING_FACTS_UNAVAILABLE",
        "Operating and Standby usage are unavailable because the analysis has no interval energy facts.",
        { business_calendar_version: input.versionId },
      );
    }

    const revision = mapOperatingCalendarRevision(row);
    const windows = resolveOperatingWindows({
      revision,
      scopeLineage: input.scopeLineage,
      period: input.period,
    });
    if (!windows) {
      return unavailable(
        "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD",
        "The published operating calendar does not cover the complete analysis period.",
        { business_calendar_version: input.versionId },
      );
    }

    let operatingKwh = 0;
    let totalKwh = 0;
    for (const interval of input.intervals) {
      const intervalFrom = Date.parse(interval.start);
      const intervalTo = Date.parse(interval.end_exclusive);
      totalKwh += interval.usage_kwh;
      let operatingMs = 0;
      for (const window of windows) {
        operatingMs += Math.max(
          0,
          Math.min(window.toMs, intervalTo) - Math.max(window.fromMs, intervalFrom),
        );
      }
      operatingKwh += interval.usage_kwh * (operatingMs / (intervalTo - intervalFrom));
    }
    const roundedOperating = round(operatingKwh);
    return {
      status: "available",
      timezone: revision.timezone,
      business_calendar_version: revision.version_id,
      operating_kwh: roundedOperating,
      standby_kwh: round(totalKwh - roundedOperating),
    };
  }

  private resolveScopeLineage(projectId: string, scopeId: string): string[] {
    const project = this.requireProject(projectId);
    const rootScopeId = requiredString(project, "root_scope_id");
    if (scopeId === rootScopeId) return [rootScopeId];

    const rows = this.db.prepare(`
      SELECT id, parent_id FROM energyiq_project_nodes WHERE project_id = ?
    `).all(projectId).filter(isRecord);
    const byId = new Map(rows.map((row) => [requiredString(row, "id"), row]));
    if (!byId.has(scopeId)) {
      throw new Error(`ENERGYIQ_POLICY_SCOPE_NOT_FOUND:${scopeId}`);
    }

    const lineage: string[] = [];
    const visited = new Set<string>();
    let current = scopeId;
    while (current !== rootScopeId) {
      if (visited.has(current)) throw new Error("ENERGYIQ_POLICY_SCOPE_CYCLE");
      visited.add(current);
      lineage.push(current);
      const row = byId.get(current);
      if (!row) {
        throw new Error(`ENERGYIQ_POLICY_SCOPE_LINEAGE_INVALID:${scopeId}:${current}`);
      }
      const parentId = optionalString(row.parent_id);
      if (!parentId || (parentId !== rootScopeId && !byId.has(parentId))) {
        throw new Error(`ENERGYIQ_POLICY_SCOPE_LINEAGE_INVALID:${scopeId}:${parentId ?? "missing-parent"}`);
      }
      current = parentId;
    }
    lineage.push(rootScopeId);
    return lineage;
  }

  private validateOwners(projectId: string, owners: EnergyIqPolicyOwner[]): void {
    const project = this.requireProject(projectId);
    const rootScopeId = requiredString(project, "root_scope_id");
    const scopeIds = new Set(
      this.db.prepare("SELECT id FROM energyiq_project_nodes WHERE project_id = ?")
        .all(projectId)
        .filter(isRecord)
        .map((row) => requiredString(row, "id")),
    );
    scopeIds.add(rootScopeId);
    for (const owner of owners) {
      if (owner.kind === "scope" && !scopeIds.has(owner.scope_id)) {
        throw new Error(`ENERGYIQ_POLICY_OWNER_SCOPE_NOT_FOUND:${owner.scope_id}`);
      }
    }
  }

  private requireProject(projectId: string): Record<string, unknown> {
    const row = this.db.prepare("SELECT * FROM energyiq_projects WHERE id = ?").get(projectId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${projectId}`);
    return row;
  }

  private requireOwnedRevision(table: string, versionId: string, projectId: string): void {
    const row = this.db.prepare(`
      SELECT 1 FROM ${table} WHERE version_id = ? AND project_id = ?
    `).get(versionId, projectId);
    if (!row) throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_REVISION_NOT_FOUND:${versionId}`);
  }

  private activateVersionsWithinTransaction(input: {
    project_id: string;
    tariff_schedule_version?: string;
    business_calendar_version?: string;
    updated_by: string;
    updated_at: string;
  }): void {
    const current = this.getActivePolicyVersions(input.project_id);
    const tariffVersion = input.tariff_schedule_version ?? current.tariff_schedule_version ?? null;
    const calendarVersion = input.business_calendar_version ?? current.business_calendar_version ?? null;
    this.db.prepare(`
      INSERT INTO energyiq_operational_policy_bindings (
        project_id, tariff_schedule_version, business_calendar_version, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        tariff_schedule_version = excluded.tariff_schedule_version,
        business_calendar_version = excluded.business_calendar_version,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.project_id,
      tariffVersion,
      calendarVersion,
      input.updated_by,
      input.updated_at,
    );
    this.db.prepare(`
      UPDATE energyiq_projects
      SET has_unpublished_changes = 1, updated_at = ?
      WHERE id = ?
    `).run(input.updated_at, input.project_id);
  }
}

const canonicalizeTariffEntries = (entries: EnergyIqTariffScheduleEntry[]): EnergyIqTariffScheduleEntry[] => {
  if (entries.length === 0) throw new Error("ENERGYIQ_TARIFF_ENTRIES_REQUIRED");
  const canonical = entries.map((entry) => {
    const fromMs = parseInstant(entry.effective_from, `tariff:${entry.id}:effective_from`);
    const toMs = entry.effective_to === undefined
      ? undefined
      : parseInstant(entry.effective_to, `tariff:${entry.id}:effective_to`);
    if (toMs !== undefined && toMs <= fromMs) {
      throw new Error(`ENERGYIQ_TARIFF_EFFECTIVE_RANGE_INVALID:${entry.id}`);
    }
    if (!Number.isFinite(entry.rate_per_kwh) || entry.rate_per_kwh < 0) {
      throw new Error(`ENERGYIQ_TARIFF_RATE_INVALID:${entry.id}`);
    }
    if ((entry.rate_basis === undefined) !== (entry.tax === undefined)) {
      throw new Error(`ENERGYIQ_TARIFF_TAX_BASIS_INCOMPLETE:${entry.id}`);
    }
    if (entry.rate_basis !== undefined && entry.rate_basis !== "tax_inclusive" && entry.rate_basis !== "tax_exclusive") {
      throw new Error(`ENERGYIQ_TARIFF_RATE_BASIS_INVALID:${entry.id}`);
    }
    const tax = entry.tax === undefined
      ? undefined
      : {
          name: requiredText(entry.tax.name, `tariff:${entry.id}:tax:name`),
          rate_pct: entry.tax.rate_pct,
        };
    if (tax && (!Number.isFinite(tax.rate_pct) || tax.rate_pct < 0)) {
      throw new Error(`ENERGYIQ_TARIFF_TAX_RATE_INVALID:${entry.id}`);
    }
    const currency = entry.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`ENERGYIQ_TARIFF_CURRENCY_INVALID:${entry.id}`);
    }
    const { time_of_use: timeOfUse, fixed_charges: fixedCharges, plan, ...rest } = entry;
    return {
      ...rest,
      id: requiredText(entry.id, "tariff entry id"),
      owner: canonicalizeOwner(entry.owner),
      effective_from: new Date(fromMs).toISOString(),
      ...(toMs !== undefined ? { effective_to: new Date(toMs).toISOString() } : {}),
      currency,
      ...(entry.rate_basis && tax ? { rate_basis: entry.rate_basis, tax } : {}),
      ...(timeOfUse === undefined ? {} : { time_of_use: canonicalizeTimeOfUse(timeOfUse, entry.id) }),
      ...(fixedCharges === undefined || fixedCharges.length === 0
        ? {}
        : { fixed_charges: fixedCharges.map((charge, index) => canonicalizeFixedCharge(charge, `${entry.id}:${index}`)) }),
      ...(plan === undefined ? {} : {
        plan: {
          id: requiredText(plan.id, `tariff:${entry.id}:plan:id`),
          label: requiredText(plan.label, `tariff:${entry.id}:plan:label`),
          ...(plan.source?.trim() ? { source: plan.source.trim() } : {}),
        },
      }),
    };
  });

  const entryIds = new Set<string>();
  for (const entry of canonical) {
    if (entryIds.has(entry.id)) {
      throw new Error(`ENERGYIQ_TARIFF_ENTRY_ID_DUPLICATE:${entry.id}`);
    }
    entryIds.add(entry.id);
  }

  const byOwner = new Map<string, EnergyIqTariffScheduleEntry[]>();
  for (const entry of canonical) {
    const key = ownerKey(entry.owner);
    const ownerEntries = byOwner.get(key) ?? [];
    ownerEntries.push(entry);
    byOwner.set(key, ownerEntries);
  }
  for (const ownerEntries of byOwner.values()) {
    ownerEntries.sort((left, right) => Date.parse(left.effective_from) - Date.parse(right.effective_from));
    for (let index = 1; index < ownerEntries.length; index += 1) {
      const previous = ownerEntries[index - 1];
      const current = ownerEntries[index];
      if (!previous || !current) continue;
      const previousTo = previous.effective_to ? Date.parse(previous.effective_to) : Number.POSITIVE_INFINITY;
      if (Date.parse(current.effective_from) < previousTo) {
        throw new Error(`ENERGYIQ_TARIFF_EFFECTIVE_OVERLAP:${current.id}`);
      }
    }
  }
  return canonical.sort((left, right) =>
    ownerKey(left.owner).localeCompare(ownerKey(right.owner))
      || Date.parse(left.effective_from) - Date.parse(right.effective_from)
      || left.id.localeCompare(right.id));
};

const canonicalizeOperatingCalendarEntries = (
  entries: EnergyIqOperatingCalendarEntry[],
): EnergyIqOperatingCalendarEntry[] => {
  if (entries.length === 0) throw new Error("ENERGYIQ_OPERATING_CALENDAR_ENTRIES_REQUIRED");
  const canonical = entries.map((entry) => {
    const effectiveFrom = parseLocalDate(entry.effective_from, `calendar:${entry.id}:effective_from`);
    const effectiveTo = entry.effective_to === undefined
      ? undefined
      : parseLocalDate(entry.effective_to, `calendar:${entry.id}:effective_to`);
    if (effectiveTo !== undefined && effectiveTo <= effectiveFrom) {
      throw new Error(`ENERGYIQ_OPERATING_CALENDAR_EFFECTIVE_RANGE_INVALID:${entry.id}`);
    }
    const weekly = Object.fromEntries(
      OPERATING_DAYS.map((day) => [
        day,
        canonicalizeTimeRanges(entry.weekly[day], `calendar:${entry.id}:weekly:${day}`),
      ]),
    ) as Record<EnergyIqOperatingDay, EnergyIqOperatingTimeRange[]>;
    const exceptionDates = new Set<string>();
    const exceptions = (entry.exceptions ?? []).map((exception) => {
      const date = parseLocalDate(exception.date, `calendar:${entry.id}:exception`);
      if (date < effectiveFrom || (effectiveTo !== undefined && date >= effectiveTo)) {
        throw new Error(`ENERGYIQ_OPERATING_CALENDAR_EXCEPTION_OUTSIDE_RANGE:${entry.id}:${date}`);
      }
      if (exceptionDates.has(date)) {
        throw new Error(`ENERGYIQ_OPERATING_CALENDAR_EXCEPTION_DUPLICATE:${entry.id}:${date}`);
      }
      exceptionDates.add(date);
      return {
        date,
        operating: canonicalizeTimeRanges(
          exception.operating,
          `calendar:${entry.id}:exception:${date}`,
        ),
        ...(exception.label?.trim() ? { label: exception.label.trim() } : {}),
        ...(exception.classification ? { classification: exception.classification } : {}),
      };
    }).sort((left, right) => left.date.localeCompare(right.date));
    return {
      ...entry,
      id: requiredText(entry.id, "operating calendar entry id"),
      owner: canonicalizeOwner(entry.owner),
      effective_from: effectiveFrom,
      ...(effectiveTo !== undefined ? { effective_to: effectiveTo } : {}),
      weekly,
      ...(exceptions.length > 0 ? { exceptions } : {}),
    };
  });

  const byOwner = new Map<string, EnergyIqOperatingCalendarEntry[]>();
  for (const entry of canonical) {
    const key = ownerKey(entry.owner);
    const ownerEntries = byOwner.get(key) ?? [];
    ownerEntries.push(entry);
    byOwner.set(key, ownerEntries);
  }
  for (const ownerEntries of byOwner.values()) {
    ownerEntries.sort((left, right) => left.effective_from.localeCompare(right.effective_from));
    for (let index = 1; index < ownerEntries.length; index += 1) {
      const previous = ownerEntries[index - 1];
      const current = ownerEntries[index];
      if (!previous || !current) continue;
      if (!previous.effective_to || current.effective_from < previous.effective_to) {
        throw new Error(`ENERGYIQ_OPERATING_CALENDAR_EFFECTIVE_OVERLAP:${current.id}`);
      }
    }
  }
  return canonical.sort((left, right) =>
    ownerKey(left.owner).localeCompare(ownerKey(right.owner))
      || left.effective_from.localeCompare(right.effective_from)
      || left.id.localeCompare(right.id));
};

const canonicalizeAcademicCalendarPeriods = (
  periods: EnergyIqAcademicCalendarPeriod[],
): EnergyIqAcademicCalendarPeriod[] => {
  const ids = new Set<string>();
  const canonical = periods.map((period) => {
    const id = requiredText(period.id, "academic calendar period id");
    if (ids.has(id)) throw new Error(`ENERGYIQ_ACADEMIC_CALENDAR_PERIOD_ID_DUPLICATE:${id}`);
    ids.add(id);
    const from = parseLocalDate(period.from, `academic-calendar:${id}:from`);
    const to = parseLocalDate(period.to, `academic-calendar:${id}:to`);
    if (to <= from) throw new Error(`ENERGYIQ_ACADEMIC_CALENDAR_PERIOD_RANGE_INVALID:${id}`);
    if (
      period.phase !== "teaching"
      && period.phase !== "term_break"
      && period.phase !== "study_exam"
      && period.phase !== "vacation"
    ) {
      throw new Error(`ENERGYIQ_ACADEMIC_CALENDAR_PHASE_INVALID:${id}`);
    }
    const sourceLabel = requiredText(period.source.label, `academic-calendar:${id}:source:label`);
    const sourceUrl = period.source.url?.trim();
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      throw new Error(`ENERGYIQ_ACADEMIC_CALENDAR_SOURCE_URL_INVALID:${id}`);
    }
    return {
      id,
      from,
      to,
      phase: period.phase,
      ...(period.label?.trim() ? { label: period.label.trim() } : {}),
      source: {
        label: sourceLabel,
        ...(sourceUrl ? { url: sourceUrl } : {}),
      },
    };
  }).sort((left, right) => left.from.localeCompare(right.from) || left.id.localeCompare(right.id));
  for (let index = 1; index < canonical.length; index += 1) {
    const previous = canonical[index - 1];
    const current = canonical[index];
    if (previous && current && current.from < previous.to) {
      throw new Error(`ENERGYIQ_ACADEMIC_CALENDAR_PERIOD_OVERLAP:${current.id}`);
    }
  }
  return canonical;
};

const canonicalizeTimeRanges = (
  ranges: EnergyIqOperatingTimeRange[] | undefined,
  field: string,
): EnergyIqOperatingTimeRange[] => {
  if (!Array.isArray(ranges)) throw new Error(`ENERGYIQ_OPERATING_TIME_RANGES_REQUIRED:${field}`);
  const canonical = ranges.map((range) => {
    const fromMinutes = parseLocalTime(range.from, `${field}:from`);
    const toMinutes = parseLocalTime(range.to, `${field}:to`, true);
    if (toMinutes <= fromMinutes) throw new Error(`ENERGYIQ_OPERATING_TIME_RANGE_INVALID:${field}`);
    return { from: formatMinutes(fromMinutes), to: formatMinutes(toMinutes) };
  }).sort((left, right) => parseLocalTime(left.from, field) - parseLocalTime(right.from, field));
  for (let index = 1; index < canonical.length; index += 1) {
    const previous = canonical[index - 1];
    const current = canonical[index];
    if (!previous || !current) continue;
    if (parseLocalTime(current.from, field) < parseLocalTime(previous.to, field, true)) {
      throw new Error(`ENERGYIQ_OPERATING_TIME_RANGE_OVERLAP:${field}`);
    }
  }
  return canonical;
};

const resolveTariffSegments = (input: {
  entries: EnergyIqTariffScheduleEntry[];
  scopeLineage: string[];
  period: { fromMs: number; toMs: number };
}): EffectiveTariffSegment[] | undefined => {
  const boundaries = new Set<number>([input.period.fromMs, input.period.toMs]);
  for (const entry of input.entries) {
    const fromMs = Date.parse(entry.effective_from);
    const toMs = entry.effective_to ? Date.parse(entry.effective_to) : Number.POSITIVE_INFINITY;
    if (fromMs > input.period.fromMs && fromMs < input.period.toMs) boundaries.add(fromMs);
    if (toMs > input.period.fromMs && toMs < input.period.toMs) boundaries.add(toMs);
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  const segments: EffectiveTariffSegment[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const fromMs = sorted[index];
    const toMs = sorted[index + 1];
    if (fromMs === undefined || toMs === undefined || toMs <= fromMs) continue;
    const candidates = input.entries
      .filter((entry) => {
        const entryFrom = Date.parse(entry.effective_from);
        const entryTo = entry.effective_to ? Date.parse(entry.effective_to) : Number.POSITIVE_INFINITY;
        return entryFrom <= fromMs && entryTo > fromMs;
      })
      .map((entry) => ({ entry, rank: ownerRank(entry.owner, input.scopeLineage) }))
      .filter((candidate) => Number.isFinite(candidate.rank))
      .sort((left, right) => left.rank - right.rank);
    const selected = candidates[0]?.entry;
    if (!selected) return undefined;
    segments.push({ fromMs, toMs, entry: selected });
  }
  return segments;
};

const canonicalizeTimeOfUse = (value: EnergyIqTariffTimeOfUse, entryId: string): EnergyIqTariffTimeOfUse => {
  if (!isRecord(value)) throw new Error(`ENERGYIQ_TARIFF_TIME_OF_USE_INVALID:${entryId}`);
  if (!Number.isFinite(value.peak_rate_per_kwh) || value.peak_rate_per_kwh < 0) {
    throw new Error(`ENERGYIQ_TARIFF_PEAK_RATE_INVALID:${entryId}`);
  }
  if (!Array.isArray(value.peak_windows) || value.peak_windows.length === 0) {
    throw new Error(`ENERGYIQ_TARIFF_PEAK_WINDOWS_REQUIRED:${entryId}`);
  }
  const peakWindows = value.peak_windows.map((window, index) => {
    const field = `tariff:${entryId}:peak_windows:${index}`;
    if (!Array.isArray(window.days) || window.days.length === 0
      || window.days.some((day) => !OPERATING_DAYS.includes(day))) {
      throw new Error(`ENERGYIQ_TARIFF_PEAK_DAYS_INVALID:${entryId}`);
    }
    const fromMinutes = parseLocalTime(window.from, `${field}:from`);
    const toMinutes = parseLocalTime(window.to, `${field}:to`, true);
    if (toMinutes <= fromMinutes) throw new Error(`ENERGYIQ_TARIFF_PEAK_WINDOW_INVALID:${entryId}`);
    return {
      days: OPERATING_DAYS.filter((day) => window.days.includes(day)),
      from: formatMinutes(fromMinutes),
      to: formatMinutes(toMinutes),
    };
  });
  return {
    peak_rate_per_kwh: value.peak_rate_per_kwh,
    peak_windows: peakWindows,
    holidays_off_peak: value.holidays_off_peak === true,
  };
};

const canonicalizeFixedCharge = (value: EnergyIqTariffFixedCharge, field: string): EnergyIqTariffFixedCharge => {
  if (!isRecord(value) || !Number.isFinite(value.amount) || value.amount < 0
    || (value.unit !== "per_month" && value.unit !== "per_kw_month")) {
    throw new Error(`ENERGYIQ_TARIFF_FIXED_CHARGE_INVALID:${field}`);
  }
  return { label: requiredText(value.label, `tariff:${field}:label`), amount: value.amount, unit: value.unit };
};

/** The peak windows inside [fromMs, toMs) as instants, sorted and merged. Holidays in `holidays` have none. */
const resolvePeakWindows = (input: {
  timeOfUse: EnergyIqTariffTimeOfUse;
  fromMs: number;
  toMs: number;
  timezone: string;
  holidays: Set<string>;
}): EffectiveOperatingWindow[] => {
  const windows: EffectiveOperatingWindow[] = [];
  const firstDate = localDateAtInstant(input.fromMs, input.timezone);
  const lastDate = localDateAtInstant(input.toMs - 1, input.timezone);
  for (const date of localDateRange(firstDate, lastDate)) {
    if (input.holidays.has(date)) continue;
    const day = dayAtLocalDate(date);
    for (const window of input.timeOfUse.peak_windows) {
      if (!window.days.includes(day)) continue;
      const fromMs = localDateTimeToInstant(date, window.from, input.timezone);
      const toMs = window.to === "24:00"
        ? localDateTimeToInstant(addLocalDays(date, 1), "00:00", input.timezone)
        : localDateTimeToInstant(date, window.to, input.timezone);
      const clippedFrom = Math.max(fromMs, input.fromMs);
      const clippedTo = Math.min(toMs, input.toMs);
      if (clippedTo > clippedFrom) windows.push({ fromMs: clippedFrom, toMs: clippedTo });
    }
  }
  windows.sort((left, right) => left.fromMs - right.fromMs);
  const merged: EffectiveOperatingWindow[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, window.toMs);
    else merged.push({ ...window });
  }
  return merged;
};

/** Milliseconds of [fromMs, toMs) that fall inside the sorted, non-overlapping windows. */
const overlapWithWindows = (windows: EffectiveOperatingWindow[], fromMs: number, toMs: number): number => {
  let low = 0;
  let high = windows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((windows[middle] as EffectiveOperatingWindow).toMs <= fromMs) low = middle + 1;
    else high = middle;
  }
  let total = 0;
  for (let index = low; index < windows.length; index += 1) {
    const window = windows[index] as EffectiveOperatingWindow;
    if (window.fromMs >= toMs) break;
    total += Math.max(0, Math.min(window.toMs, toMs) - Math.max(window.fromMs, fromMs));
  }
  return total;
};

const resolveOperatingWindows = (input: {
  revision: EnergyIqOperatingCalendarRevision;
  scopeLineage: string[];
  period: { fromMs: number; toMs: number };
}): EffectiveOperatingWindow[] | undefined => {
  const firstDate = localDateAtInstant(input.period.fromMs, input.revision.timezone);
  const lastDate = localDateAtInstant(input.period.toMs - 1, input.revision.timezone);
  const windows: EffectiveOperatingWindow[] = [];
  for (const date of localDateRange(firstDate, lastDate)) {
    const selected = resolveOperatingCalendarEntryForDate({
      entries: input.revision.entries,
      scopeLineage: input.scopeLineage,
      date,
    });
    if (!selected) return undefined;
    const exception = selected.exceptions?.find((item) => item.date === date);
    const ranges = exception?.operating ?? selected.weekly[dayAtLocalDate(date)];
    for (const range of ranges) {
      const fromMs = localDateTimeToInstant(date, range.from, input.revision.timezone);
      const toMs = range.to === "24:00"
        ? localDateTimeToInstant(addLocalDays(date, 1), "00:00", input.revision.timezone)
        : localDateTimeToInstant(date, range.to, input.revision.timezone);
      const clippedFrom = Math.max(fromMs, input.period.fromMs);
      const clippedTo = Math.min(toMs, input.period.toMs);
      if (clippedTo > clippedFrom) windows.push({ fromMs: clippedFrom, toMs: clippedTo });
    }
  }
  return windows;
};

const resolveOperatingCalendarExceptions = (input: {
  revision: EnergyIqOperatingCalendarRevision;
  scopeLineage: string[];
  period: { fromMs: number; toMs: number };
}): Array<{
  date: string;
  classification?: EnergyIqCalendarExceptionClassification;
}> | undefined => {
  const firstDate = localDateAtInstant(input.period.fromMs, input.revision.timezone);
  const lastDate = localDateAtInstant(input.period.toMs - 1, input.revision.timezone);
  const exceptions: Array<{
    date: string;
    classification?: EnergyIqCalendarExceptionClassification;
  }> = [];
  for (const date of localDateRange(firstDate, lastDate)) {
    const selected = resolveOperatingCalendarEntryForDate({
      entries: input.revision.entries,
      scopeLineage: input.scopeLineage,
      date,
    });
    if (!selected) return undefined;
    const exception = selected.exceptions?.find((candidate) => candidate.date === date);
    if (exception) {
      exceptions.push({
        date,
        ...(exception.classification ? { classification: exception.classification } : {}),
      });
    }
  }
  return exceptions;
};

const deriveTaxRates = (entry: EnergyIqTariffScheduleEntry, rate = entry.rate_per_kwh): {
  tax_inclusive_rate_per_kwh: number;
  tax_exclusive_rate_per_kwh: number;
} | undefined => {
  if (!entry.rate_basis || !entry.tax) return undefined;
  const multiplier = 1 + entry.tax.rate_pct / 100;
  return entry.rate_basis === "tax_inclusive"
    ? {
        tax_inclusive_rate_per_kwh: rate,
        tax_exclusive_rate_per_kwh: round(rate / multiplier),
      }
    : {
        tax_inclusive_rate_per_kwh: round(rate * multiplier),
        tax_exclusive_rate_per_kwh: rate,
      };
};

const resolveOperatingCalendarEntryForDate = (input: {
  entries: EnergyIqOperatingCalendarEntry[];
  scopeLineage: string[];
  date: string;
}): EnergyIqOperatingCalendarEntry | undefined => input.entries
  .filter((entry) => entry.effective_from <= input.date
    && (!entry.effective_to || entry.effective_to > input.date))
  .map((entry) => ({ entry, rank: ownerRank(entry.owner, input.scopeLineage) }))
  .filter((candidate) => Number.isFinite(candidate.rank))
  .sort((left, right) => left.rank - right.rank)[0]?.entry;

const canonicalizeIntervals = (
  intervals: EnergyIqAnalysisInterval[],
  period: { fromMs: number; toMs: number },
): EnergyIqAnalysisInterval[] => intervals.map((interval, index) => {
  const startMs = parseInstant(interval.start, `interval:${index}:start`);
  const endMs = parseInstant(interval.end_exclusive, `interval:${index}:end_exclusive`);
  if (endMs <= startMs || startMs < period.fromMs || endMs > period.toMs) {
    throw new Error(`ENERGYIQ_POLICY_INTERVAL_RANGE_INVALID:${index}`);
  }
  if (!Number.isFinite(interval.usage_kwh) || interval.usage_kwh < 0) {
    throw new Error(`ENERGYIQ_POLICY_INTERVAL_USAGE_INVALID:${index}`);
  }
  return {
    start: new Date(startMs).toISOString(),
    end_exclusive: new Date(endMs).toISOString(),
    usage_kwh: interval.usage_kwh,
  };
});

const parsePeriod = (period: { from: string; to: string }): { fromMs: number; toMs: number } => {
  const fromMs = parseInstant(period.from, "period:from");
  const toMs = parseInstant(period.to, "period:to");
  if (toMs <= fromMs) throw new Error("ENERGYIQ_POLICY_PERIOD_INVALID");
  return { fromMs, toMs };
};

const validatePolicySource = (value: unknown): EnergyIqOperationalPolicySource => {
  if (!isRecord(value)) throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SOURCE_INVALID");
  if (value.mode === "active") {
    if (
      Object.prototype.hasOwnProperty.call(value, "tariff_schedule_version")
      || Object.prototype.hasOwnProperty.call(value, "business_calendar_version")
    ) {
      throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SOURCE_INVALID");
    }
    return { mode: "active" };
  }
  if (value.mode === "release-pinned") {
    const tariffVersion = optionalString(value.tariff_schedule_version)?.trim();
    const calendarVersion = optionalString(value.business_calendar_version)?.trim();
    if (!tariffVersion || !calendarVersion) {
      throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SOURCE_INVALID");
    }
    return {
      mode: "release-pinned",
      tariff_schedule_version: tariffVersion,
      business_calendar_version: calendarVersion,
    };
  }
  throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SOURCE_INVALID");
};

const hasCompositePolicyBindingForeignKeys = (db: DatabaseSync): boolean => {
  const rows = db.prepare("PRAGMA foreign_key_list(energyiq_operational_policy_bindings)")
    .all()
    .filter(isRecord);
  const hasPair = (table: string, versionColumn: string): boolean => {
    const groups = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.table !== table) continue;
      const id = String(row.id);
      const mappings = groups.get(id) ?? new Set<string>();
      mappings.add(`${String(row.from)}:${String(row.to)}`);
      groups.set(id, mappings);
    }
    return [...groups.values()].some((mappings) =>
      mappings.has("project_id:project_id")
        && mappings.has(`${versionColumn}:version_id`));
  };
  return hasPair("energyiq_tariff_schedule_revisions", "tariff_schedule_version")
    && hasPair("energyiq_operating_calendar_revisions", "business_calendar_version");
};

const parseInstant = (value: string, field: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`ENERGYIQ_POLICY_INSTANT_INVALID:${field}`);
  return parsed;
};

const parseLocalDate = (value: string, field: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`ENERGYIQ_POLICY_LOCAL_DATE_INVALID:${field}`);
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    throw new Error(`ENERGYIQ_POLICY_LOCAL_DATE_INVALID:${field}`);
  }
  return value;
};

const parseLocalTime = (value: string, field: string, allowEndOfDay = false): number => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`ENERGYIQ_POLICY_LOCAL_TIME_INVALID:${field}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && (!allowEndOfDay || minute !== 0))) {
    throw new Error(`ENERGYIQ_POLICY_LOCAL_TIME_INVALID:${field}`);
  }
  return hour * 60 + minute;
};

const formatMinutes = (minutes: number): string => {
  if (minutes === 24 * 60) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

const assertTimeZone = (timezone: string): void => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(0);
  } catch {
    throw new Error(`ENERGYIQ_PROJECT_TIMEZONE_INVALID:${timezone}`);
  }
};

const localDateAtInstant = (instantMs: number, timezone: string): string => {
  const parts = localPartsAtInstant(instantMs, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

const localPartsAtInstant = (instantMs: number, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instantMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`ENERGYIQ_PROJECT_TIMEZONE_PART_MISSING:${type}`);
    return Number(value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
};

const localDateTimeToInstant = (date: string, time: string, timezone: string): number => {
  const [yearText, monthText, dayText] = date.split("-");
  const [hourText, minuteText] = time.split(":");
  const desired = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0,
  };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  let candidate = desiredAsUtc;
  for (let index = 0; index < 4; index += 1) {
    const actual = localPartsAtInstant(candidate, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = desiredAsUtc - actualAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  const resolved = localPartsAtInstant(candidate, timezone);
  if (
    resolved.year !== desired.year
    || resolved.month !== desired.month
    || resolved.day !== desired.day
    || resolved.hour !== desired.hour
    || resolved.minute !== desired.minute
  ) {
    throw new Error(`ENERGYIQ_OPERATING_LOCAL_TIME_UNRESOLVABLE:${date}T${time}:${timezone}`);
  }
  return candidate;
};

const localDateRange = (from: string, toInclusive: string): string[] => {
  const result: string[] = [];
  let current = from;
  while (current <= toInclusive) {
    result.push(current);
    current = addLocalDays(current, 1);
  }
  return result;
};

const addLocalDays = (date: string, days: number): string => {
  const [yearText, monthText, dayText] = date.split("-");
  const next = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + days));
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
};

const dayAtLocalDate = (date: string): EnergyIqOperatingDay => {
  const [yearText, monthText, dayText] = date.split("-");
  const index = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))).getUTCDay();
  return (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[index] as EnergyIqOperatingDay;
};

const canonicalizeOwner = (owner: EnergyIqPolicyOwner): EnergyIqPolicyOwner =>
  owner.kind === "project"
    ? { kind: "project" }
    : { kind: "scope", scope_id: requiredText(owner.scope_id, "scope owner") };

const ownerKey = (owner: EnergyIqPolicyOwner): string =>
  owner.kind === "project" ? "project" : `scope:${owner.scope_id}`;

const ownerRank = (owner: EnergyIqPolicyOwner, scopeLineage: string[]): number => {
  if (owner.kind === "project") return scopeLineage.length + 1;
  const rank = scopeLineage.indexOf(owner.scope_id);
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
};

const mapTariffRevision = (row: Record<string, unknown>): EnergyIqTariffScheduleRevision => ({
  version_id: requiredString(row, "version_id"),
  project_id: requiredString(row, "project_id"),
  entries: parseTariffEntries(requiredString(row, "entries_json")),
  published_by: requiredString(row, "published_by"),
  published_at: requiredString(row, "published_at"),
});

const mapOperatingCalendarRevision = (
  row: Record<string, unknown>,
): EnergyIqOperatingCalendarRevision => {
  const document = parseOperatingCalendarDocument(requiredString(row, "entries_json"));
  return {
    version_id: requiredString(row, "version_id"),
    project_id: requiredString(row, "project_id"),
    timezone: requiredString(row, "timezone"),
    entries: document.entries,
    academic_periods: document.academic_periods,
    published_by: requiredString(row, "published_by"),
    published_at: requiredString(row, "published_at"),
  };
};

const parseTariffEntries = (value: string): EnergyIqTariffScheduleEntry[] => {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ENERGYIQ_TARIFF_REVISION_INVALID");
  return parsed as EnergyIqTariffScheduleEntry[];
};

const parseOperatingCalendarDocument = (value: string): {
  entries: EnergyIqOperatingCalendarEntry[];
  academic_periods: EnergyIqAcademicCalendarPeriod[];
} => {
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) {
    return { entries: parsed as EnergyIqOperatingCalendarEntry[], academic_periods: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries) || !Array.isArray(parsed.academic_periods)) {
    throw new Error("ENERGYIQ_OPERATING_CALENDAR_REVISION_INVALID");
  }
  return {
    entries: parsed.entries as EnergyIqOperatingCalendarEntry[],
    academic_periods: parsed.academic_periods as EnergyIqAcademicCalendarPeriod[],
  };
};

function unavailable(
  code: EnergyIqPolicyUnavailableReasonCode,
  message: string,
  version: { tariff_schedule_version?: string; business_calendar_version?: string } = {},
): EnergyIqTariffEvaluation & EnergyIqOperatingEvaluation {
  return {
    status: "unavailable",
    reason: { code, message },
    ...version,
  };
}

const requiredText = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`ENERGYIQ_POLICY_TEXT_REQUIRED:${field}`);
  return trimmed;
};

const requiredString = (row: Record<string, unknown>, field: string): string => {
  const value = row[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`ENERGYIQ_POLICY_FIELD_INVALID:${field}`);
  }
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const round = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

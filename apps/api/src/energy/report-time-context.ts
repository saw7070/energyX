import {
  type ReportTimeBinding,
  type ReportTimeContext,
  type ReportTimePolicyRevision,
  type ReportWindowPolicy,
  type ResolvedReportWindow
} from "@datafoundry/contracts";

const REPORT_TIME_CONTEXT_REVISION: ReportTimeContext["contractRevision"] = "energyiq-report-time-context@1";

export const resolveReportTimeContext = (input: {
  binding: ReportTimeBinding;
  timezone: string;
  asOf: string;
  acceptedDataEndExclusive: string;
  lastRefreshedAt: string;
  policy: ReportTimePolicyRevision;
}): ReportTimeContext => {
  if (Object.values(input.binding).some((value) => !value.trim())) {
    throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_BINDING_INVALID");
  }
  if (!input.policy.policyId.trim() || !input.policy.revision.trim() || !input.timezone.trim()) {
    throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_POLICY_INVALID");
  }

  const asOf = canonicalInstant(input.asOf);
  const acceptedDataEndExclusive = canonicalInstant(input.acceptedDataEndExclusive);
  const lastRefreshedAt = canonicalInstant(input.lastRefreshedAt);
  if (Date.parse(acceptedDataEndExclusive) > Date.parse(lastRefreshedAt)
    || Date.parse(lastRefreshedAt) > Date.parse(asOf)) {
    throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_CHRONOLOGY_INVALID");
  }

  const endLocalDate = localDateAtInstant(acceptedDataEndExclusive, input.timezone);
  const canonicalEnd = zonedStartOfLocalDate(endLocalDate, input.timezone);
  // All-available snapshots can end mid-day. Keep their exact evidence cutoff,
  // while complete-day policy windows end at the preceding local midnight.

  const policiesById = new Map<string, ReportWindowPolicy>();
  for (const window of input.policy.windows) {
    if (!window.windowId.trim() || !window.role.trim() || !window.label.trim() || policiesById.has(window.windowId)) {
      throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_WINDOW_ID_INVALID");
    }
    policiesById.set(window.windowId, window);
  }

  const resolvedById = new Map<string, ResolvedReportWindow>();
  const resolving = new Set<string>();
  const resolveWindow = (windowId: string): ResolvedReportWindow => {
    const cached = resolvedById.get(windowId);
    if (cached) return cached;
    const window = policiesById.get(windowId);
    if (!window) throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_SOURCE_WINDOW_NOT_FOUND");
    if (resolving.has(windowId)) throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_WINDOW_CYCLE");
    resolving.add(windowId);

    let resolved: ResolvedReportWindow;
    if (window.strategy.kind === "rolling_complete_days") {
      if (!Number.isInteger(window.strategy.days) || window.strategy.days < 1) {
        throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_STRATEGY_INVALID");
      }
      const fromLocalDate = shiftLocalDate(endLocalDate, -window.strategy.days);
      const from = zonedStartOfLocalDate(fromLocalDate, input.timezone);
      resolved = {
        ...window,
        phase: "complete",
        from,
        toExclusive: canonicalEnd,
        completeDayCount: window.strategy.days,
        segments: [{ from, toExclusive: canonicalEnd }],
        comparisonCompatibilityKey: compatibilityKey(input, window)
      };
    } else if (window.strategy.kind === "calendar_month_to_date") {
      const monthStartLocalDate = `${shiftLocalDate(endLocalDate, -1).slice(0, 7)}-01`;
      const completeDayCount = daysBetweenLocalDates(monthStartLocalDate, endLocalDate);
      const from = zonedStartOfLocalDate(monthStartLocalDate, input.timezone);
      resolved = {
        ...window,
        phase: endLocalDate.endsWith("-01") ? "complete" : "partial",
        from,
        toExclusive: canonicalEnd,
        completeDayCount,
        segments: [{ from, toExclusive: canonicalEnd }],
        comparisonCompatibilityKey: compatibilityKey(input, window)
      };
    } else if (window.strategy.kind === "completed_calendar_months") {
      requirePositiveInteger(window.strategy.months);
      const completedBoundaryLocalDate = endLocalDate.endsWith("-01")
        ? endLocalDate
        : `${endLocalDate.slice(0, 7)}-01`;
      const fromLocalDate = shiftLocalMonth(completedBoundaryLocalDate, -window.strategy.months);
      const segments = Array.from({ length: window.strategy.months }, (_, index) => {
        const segmentFromLocalDate = shiftLocalMonth(fromLocalDate, index);
        return {
          from: zonedStartOfLocalDate(segmentFromLocalDate, input.timezone),
          toExclusive: zonedStartOfLocalDate(shiftLocalMonth(segmentFromLocalDate, 1), input.timezone)
        };
      });
      resolved = {
        ...window,
        phase: "complete",
        from: segments[0]!.from,
        toExclusive: segments.at(-1)!.toExclusive,
        completeDayCount: daysBetweenLocalDates(fromLocalDate, completedBoundaryLocalDate),
        segments,
        comparisonCompatibilityKey: compatibilityKey(input, window)
      };
    } else if (window.strategy.kind === "prior_equivalent_progress") {
      requirePositiveInteger(window.strategy.months);
      const source = resolveWindow(window.strategy.sourceWindowId);
      if (source.strategy.kind !== "calendar_month_to_date") {
        throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_EQUIVALENT_SOURCE_INVALID");
      }
      const sourceFromLocalDate = localDateAtInstant(source.from, input.timezone);
      const segments = Array.from({ length: window.strategy.months }, (_, index) => {
        const segmentFromLocalDate = shiftLocalMonth(sourceFromLocalDate, -(index + 1));
        const nextMonth = shiftLocalMonth(segmentFromLocalDate, 1);
        const requestedTo = shiftLocalDate(segmentFromLocalDate, source.completeDayCount);
        const segmentToLocalDate = source.phase === "complete"
          ? nextMonth
          : requestedTo > nextMonth ? nextMonth : requestedTo;
        return {
          from: zonedStartOfLocalDate(segmentFromLocalDate, input.timezone),
          toExclusive: zonedStartOfLocalDate(segmentToLocalDate, input.timezone)
        };
      });
      resolved = {
        ...window,
        phase: source.phase,
        from: segments.at(-1)!.from,
        toExclusive: segments[0]!.toExclusive,
        completeDayCount: segments.reduce(
          (total, segment) => total + reportTimePeriodDayCount(segment, input.timezone),
          0,
        ),
        segments,
        comparisonCompatibilityKey: compatibilityKey(input, window)
      };
    } else if (window.strategy.kind === "next_complete_calendar_month") {
      const dataThroughLocalDate = shiftLocalDate(endLocalDate, -1);
      const nextMonthStart = shiftLocalMonth(`${dataThroughLocalDate.slice(0, 7)}-01`, 1);
      const followingMonthStart = shiftLocalMonth(nextMonthStart, 1);
      const from = zonedStartOfLocalDate(nextMonthStart, input.timezone);
      const toExclusive = zonedStartOfLocalDate(followingMonthStart, input.timezone);
      resolved = {
        ...window,
        phase: "forecast",
        from,
        toExclusive,
        completeDayCount: daysBetweenLocalDates(nextMonthStart, followingMonthStart),
        segments: [{ from, toExclusive }],
        comparisonCompatibilityKey: compatibilityKey(input, window)
      };
    } else {
      requirePositiveInteger(window.strategy.lookbackDays);
      const source = resolveWindow(window.strategy.sourceWindowId);
      const sourceFromLocalDate = localDateAtInstant(source.from, input.timezone);
      const fromLocalDate = shiftLocalDate(sourceFromLocalDate, -window.strategy.lookbackDays);
      const from = zonedStartOfLocalDate(fromLocalDate, input.timezone);
      const toExclusive = source.from;
      resolved = {
        ...window,
        phase: "complete",
        from,
        toExclusive,
        completeDayCount: window.strategy.lookbackDays,
        segments: [{ from, toExclusive }],
        comparisonCompatibilityKey: compatibilityKey(input, window)
      };
    }

    resolving.delete(windowId);
    resolvedById.set(windowId, resolved);
    return resolved;
  };

  const windows = input.policy.windows.map((window) => resolveWindow(window.windowId));

  return {
    contractRevision: REPORT_TIME_CONTEXT_REVISION,
    binding: { ...input.binding },
    timezone: input.timezone,
    asOf,
    acceptedDataEndExclusive,
    dataThroughLocalDate: shiftLocalDate(endLocalDate, -1),
    lastRefreshedAt,
    policyId: input.policy.policyId,
    policyRevision: input.policy.revision,
    windows
  };
};

const compatibilityKey = (
  input: { timezone: string; policy: ReportTimePolicyRevision },
  window: ReportWindowPolicy
): string => `${input.policy.policyId}:${input.policy.revision}:${input.timezone}:${JSON.stringify(window.strategy)}`;

const canonicalInstant = (value: string): string => {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_INSTANT_INVALID");
  }
  return instant.toISOString();
};

const localDateAtInstant = (value: string, timezone: string): string => {
  const instant = new Date(canonicalInstant(value));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftLocalDate = (value: string, days: number): string => {
  const [year, month, day] = localDateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const daysBetweenLocalDates = (from: string, toExclusive: string): number => {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${toExclusive}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
};

const shiftLocalMonth = (value: string, months: number): string => {
  const [year, month] = localDateParts(value);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 10);
};

const requirePositiveInteger = (value: number): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_STRATEGY_INVALID");
  }
};

export const reportTimePeriodDayCount = (
  period: { from: string; toExclusive: string },
  timezone: string
): number => daysBetweenLocalDates(
  localDateAtInstant(period.from, timezone),
  localDateAtInstant(period.toExclusive, timezone)
);

const zonedStartOfLocalDate = (localDate: string, timezone: string): string => {
  const [year, month, day] = localDateParts(localDate);
  const localAsUtc = Date.UTC(year, month - 1, day);
  let guess = localAsUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(guess));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");
    const zonedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    const next = guess - (zonedAsUtc - localAsUtc);
    if (next === guess) break;
    guess = next;
  }

  return new Date(guess).toISOString();
};

const localDateParts = (value: string): [number, number, number] => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_LOCAL_DATE_INVALID");
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const canonical = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toISOString().slice(0, 10);
  if (canonical !== value) throw new Error("ENERGYIQ_REPORT_TIME_CONTEXT_LOCAL_DATE_INVALID");
  return parts;
};

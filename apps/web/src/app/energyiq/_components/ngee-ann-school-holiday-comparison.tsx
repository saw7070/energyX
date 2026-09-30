import React from "react";

import type {
  EnergySchoolHolidayAnomalyDto,
  EnergySchoolHolidayComparisonDto,
  EnergySchoolHolidayHourlyProfileDto,
} from "../../../lib/config-api";
import { SafeAiMarkdown } from "./safe-ai-markdown";

export function NgeeAnnSchoolHolidayComparison({
  comparison,
  unavailableReason,
  projectExplorerHref,
  aiAnalystHref,
  aiHeadline,
  aiInterpretation,
}: {
  comparison?: EnergySchoolHolidayComparisonDto;
  unavailableReason?: string;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
  aiHeadline?: string;
  aiInterpretation?: string;
}) {
  if (!comparison || comparison.status === "unavailable") {
    return (
      <section className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6" role="status">
        <div className="rounded-xl border border-warning/25 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">School Holiday Comparison unavailable</p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            {comparison?.reason.message ?? unavailableReason ?? "This Release does not yet provide an exact School Holiday comparison."}
          </p>
          {comparison?.quality ? (
            <div className="mt-2 text-xs leading-5 text-warning">
              <p className="font-medium">
                Official coverage · {comparison.quality.completeDayCount} of {comparison.quality.expectedDayCount} dates ({formatPercent(comparison.quality.coveragePct)})
              </p>
              {comparison.quality.excludedLocalDates.length > 0 ? (
                <p>Excluded dates · {comparison.quality.excludedLocalDates.map(formatDate).join(", ")}</p>
              ) : null}
            </div>
          ) : null}
          {comparison?.status === "unavailable" && comparison.limitations?.map((limitation) => (
            <p className="mt-1 text-xs leading-5 text-muted" key={limitation}>Limitation · {limitation}</p>
          ))}
          <p className="mt-3 text-xs leading-5 text-muted">
            No anomaly or recommendation is published until the exact Release-bound evidence gate is satisfied.
          </p>
        </div>
      </section>
    );
  }

  const primary = comparison.comparisons.find((item) => item.status === "available");
  const holidayAnomalies = comparison.anomalies.filter(({ schoolHolidayState }) => (
    schoolHolidayState === "school_holiday"
  ));
  const teachingExamAnomalies = comparison.anomalies.filter(({ schoolHolidayState }) => (
    schoolHolidayState !== "school_holiday"
  ));
  const deterministicHeadline = primary?.status === "available"
    ? `School Holiday ${contextLabel(primary.dayContext)} use was ${formatPercent(Math.abs(primary.deltaPercent))} ${primary.deltaKwh < 0 ? "lower" : primary.deltaKwh > 0 ? "higher" : "unchanged"} than adjacent Teaching days.`
    : "A complete like-for-like School Holiday cohort is not yet available.";
  const exactAiAnalystHref = aiAnalystHref
    ? bindHolidayAnalysisHref(aiAnalystHref, comparison)
    : undefined;
  return (
    <section className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.07em] text-primary">
            Authoritative 120-day comparison window
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatDate(comparison.identity.period.from)}–{formatDate(previousDate(comparison.identity.period.toExclusive))}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
            Selected Holiday interval · {phaseLabel(comparison.selectedHolidayInterval.academicPhase)}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatDate(comparison.selectedHolidayInterval.from)}–{formatDate(previousDate(comparison.selectedHolidayInterval.toExclusive))}
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Complete School Holiday days are compared with adjacent Teaching days using the same weekday, weekend or Public Holiday context.
          </p>
        </div>
        <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[11px] font-semibold text-muted">
          {formatPercent(comparison.quality.coveragePct)} official coverage
        </span>
      </div>

      <h3 className="mt-5 max-w-4xl text-xl font-semibold leading-7 tracking-[-0.02em] text-foreground">
        {aiHeadline ?? deterministicHeadline}
      </h3>

      {aiInterpretation ? <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label="School Holiday AI interpretation">
        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-primary">AI interpretation</p>
        <SafeAiMarkdown className="mt-2 text-sm leading-6 text-foreground">{aiInterpretation}</SafeAiMarkdown>
        <p className="mt-2 text-xs leading-5 text-muted">This interpretation explains the released comparison; all metrics below remain server-calculated.</p>
      </div> : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-2" aria-label="School Holiday key points">
        <KeyPoint label="What changed">
          {primary?.status === "available"
            ? `School Holiday ${contextLabel(primary.dayContext)} use was ${formatPercent(Math.abs(primary.deltaPercent))} ${primary.deltaKwh < 0 ? "lower" : primary.deltaKwh > 0 ? "higher" : "unchanged"} than adjacent Teaching days.`
            : "No like-for-like cohort has enough complete samples yet."}
        </KeyPoint>
        <KeyPoint label="Pattern">
          {primary?.status === "available"
            ? `${contextLabel(primary.dayContext)} is the first complete like-for-like cohort; its 24-hour curve uses only that same context.`
            : "The published cohorts do not yet support a stable same-context pattern."}
        </KeyPoint>
        <KeyPoint label="So what">
          Descriptive differences help prioritise checks, but they do not prove that the School Holiday caused the change.
        </KeyPoint>
        <KeyPoint label="Next check">
          Review the largest exact hourly gaps and any separately triggered Rule anomalies before changing schedules or equipment.
        </KeyPoint>
      </div>

      {projectExplorerHref || exactAiAnalystHref ? <div className="mt-4 flex flex-wrap gap-2">
        {projectExplorerHref ? <a className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground" href={projectExplorerHref}>View in Energy consumption</a> : null}
        {exactAiAnalystHref ? <a className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white" href={exactAiAnalystHref}>Ask the advisor about this comparison</a> : null}
      </div> : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3" aria-label="School Holiday cohort comparisons">
        {comparison.comparisons.map((item) => (
          <article key={`${item.weekPart}:${item.isPublicHoliday}`} className="rounded-xl border border-border bg-surface-subtle p-4">
            <p className="text-xs font-semibold text-muted">{contextLabel(item.dayContext)}</p>
            {item.status === "available" ? <>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">{signedPercent(item.deltaPercent)}</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {formatKwh(item.actual.averageKwh)} Holiday vs {formatKwh(item.baseline.averageKwh)} Teaching
              </p>
              <p className="mt-2 text-[11px] leading-5 text-muted-light">
                {item.actual.sampleCount} Holiday days · {item.baseline.sampleCount} Teaching days
              </p>
            </> : (
              <p className="mt-2 text-sm leading-6 text-muted">Not enough complete dates for a fair comparison.</p>
            )}
          </article>
        ))}
      </div>

      <HourlyComparison profile={comparison.hourlyProfile} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AnomalyGroup title="School Holiday anomalies" anomalies={holidayAnomalies} />
        <AnomalyGroup title="Teaching / Exam anomalies" anomalies={teachingExamAnomalies} />
      </div>

      <div className="mt-5 rounded-xl border border-border bg-surface-subtle p-4" aria-label="Coverage and caveats">
        <h4 className="text-sm font-semibold text-foreground">Coverage and caveats</h4>
        <p className="mt-2 text-xs leading-5 text-muted">
          {comparison.quality.completeDayCount} of {comparison.quality.expectedDayCount} dates have complete official facts ({formatPercent(comparison.quality.coveragePct)}).
        </p>
        {comparison.quality.excludedLocalDates.length > 0 ? (
          <p className="mt-1 text-xs leading-5 text-muted">
            Excluded dates · {comparison.quality.excludedLocalDates.map(formatDate).join(", ")}
          </p>
        ) : null}
        {comparison.excludedAcademicPhases.length > 0 ? (
          <p className="mt-1 text-xs leading-5 text-muted">
            Excluded academic phases · {comparison.excludedAcademicPhases.map(phaseLabel).join(", ")}
          </p>
        ) : null}
        {comparison.comparisons.map((item) => item.status === "unavailable" ? (
          <p className="mt-1 text-xs leading-5 text-muted" key={`unavailable:${item.dayContext}`}>
            {contextLabel(item.dayContext)} cohort unavailable · {unavailableCohortReason(item.reason)}
          </p>
        ) : null)}
        {comparison.limitations.map((limitation) => (
          <p className="mt-1 text-xs leading-5 text-muted" key={limitation}>Limitation · {limitation}</p>
        ))}
      </div>

      <details className="mt-5 border-t border-border pt-4 text-xs text-muted">
        <summary className="cursor-pointer font-medium">Evidence and method</summary>
        <div className="mt-2 space-y-1 break-words font-mono text-[10px] leading-5">
          <p>Snapshot · {comparison.identity.dataSnapshotId}</p>
          <p>Release · {comparison.identity.projectReleaseId}</p>
          <p>Calendar · {comparison.identity.businessCalendarVersion}</p>
          <p>Rule · {comparison.identity.ruleRevision}</p>
          <p>Report-time policy · {comparison.identity.reportTimePolicyRevision}</p>
          <p>Comparison window · {comparison.identity.comparisonWindowId}</p>
          <p>Window · [{comparison.identity.period.from}, {comparison.identity.period.toExclusive})</p>
        </div>
      </details>
    </section>
  );
}

function HourlyComparison({ profile }: { profile: EnergySchoolHolidayHourlyProfileDto }) {
  if (profile.status === "unavailable") {
    return <div className="mt-6 rounded-xl border border-dashed border-border p-4">
      <h4 className="text-base font-semibold text-foreground">24-hour comparison</h4>
      <p className="mt-1 text-sm leading-6 text-muted">Complete hourly cohorts are unavailable; missing hours are not zero-filled.</p>
    </div>;
  }
  return <div className="mt-6 rounded-xl border border-border p-4">
    <h4 className="text-base font-semibold text-foreground">24-hour comparison</h4>
    <p className="mt-1 text-sm leading-6 text-muted">
      24 hourly points · {contextLabel(profile.dayContext)} context · {profile.actualSampleCount} Holiday days · {profile.baselineSampleCount} Teaching days
    </p>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-muted" aria-label="Hourly curve legend">
      <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary" />School Holiday</span>
      <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning" />Teaching</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold" aria-label="Operating bands">
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700" data-hour-band="overnight">00:00–08:00 · Overnight</span>
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800" data-hour-band="daytime">08:00–20:00 · Daytime</span>
    </div>
    <HourlyCurve profile={profile} />
  </div>;
}

function KeyPoint({ label, children }: { label: string; children: React.ReactNode }) {
  return <article className="rounded-xl border border-primary/20 bg-primary/5 p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-primary">{label}</p>
    <p className="mt-2 text-sm font-semibold leading-6 text-foreground">{children}</p>
  </article>;
}

function HourlyCurve({
  profile,
}: {
  profile: Extract<EnergySchoolHolidayHourlyProfileDto, { status: "available" }>;
}) {
  const values = [...profile.values].sort((left, right) => left.localHour - right.localHour);
  const maxValue = Math.max(1, ...values.flatMap((value) => [
    value.actualAverageKwh,
    value.baselineAverageKwh,
  ]));
  const width = 1_536;
  const height = 112;
  const x = (hour: number) => 32 + hour * 64;
  const y = (value: number) => 96 - (value / maxValue) * 80;
  const points = (key: "actualAverageKwh" | "baselineAverageKwh") => values
    .map((value) => `${x(value.localHour)},${y(value[key])}`)
    .join(" ");
  return <div className="mt-4 overflow-x-auto pb-2" aria-label="Complete hourly School Holiday and Teaching curve">
    <div style={{ minWidth: width }}>
      <svg
        aria-label="School Holiday and Teaching hourly usage curve from 00:00 to 23:00"
        className="h-28 w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <rect data-hour-band="overnight" x="0" y="0" width="512" height={height} className="fill-slate-100/70" />
        <rect data-hour-band="daytime" x="512" y="0" width="768" height={height} className="fill-amber-50/70" />
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            className="stroke-border"
            strokeWidth="1"
            x1="0"
            x2={width}
            y1={y(maxValue * ratio)}
            y2={y(maxValue * ratio)}
          />
        ))}
        <polyline fill="none" points={points("actualAverageKwh")} stroke="currentColor" strokeWidth="3" className="text-primary" />
        <polyline fill="none" points={points("baselineAverageKwh")} stroke="currentColor" strokeWidth="3" className="text-warning" />
        {values.flatMap((value) => [
          <circle key={`holiday:${value.localHour}`} cx={x(value.localHour)} cy={y(value.actualAverageKwh)} r="3" fill="currentColor" className="text-primary" />,
          <circle key={`teaching:${value.localHour}`} cx={x(value.localHour)} cy={y(value.baselineAverageKwh)} r="3" fill="currentColor" className="text-warning" />,
        ])}
      </svg>
      <div className="grid grid-cols-24 border-t border-border">
        {values.map((value) => (
          <article
            className="border-r border-border px-1 py-2 text-center last:border-r-0"
            data-hour={value.localHour}
            key={value.localHour}
            title={`${hourLabel(value.localHour)} · Holiday ${formatHourlyKwh(value.actualAverageKwh)} · Teaching ${formatHourlyKwh(value.baselineAverageKwh)}`}
          >
            <p className="text-[10px] font-semibold text-foreground">{hourLabel(value.localHour)}</p>
            <p className="mt-1 text-[10px] leading-4 text-primary">Holiday {formatHourlyKwh(value.actualAverageKwh)}</p>
            <p className="text-[10px] leading-4 text-warning">Teaching {formatHourlyKwh(value.baselineAverageKwh)}</p>
          </article>
        ))}
      </div>
    </div>
  </div>;
}

function bindHolidayAnalysisHref(
  href: string,
  comparison: Extract<EnergySchoolHolidayComparisonDto, { status: "available" }>,
): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  params.set("projectId", comparison.identity.projectId);
  params.set("scopeId", comparison.identity.scopeId);
  params.set("resource", "electricity");
  params.set("period", "Custom");
  params.set("from", comparison.identity.period.from);
  params.set("to", previousDate(comparison.identity.period.toExclusive));
  params.set("dataSnapshotId", comparison.identity.dataSnapshotId);
  params.set("projectReleaseId", comparison.identity.projectReleaseId);
  return `${path}?${params.toString()}${hash}`;
}

function AnomalyGroup({ title, anomalies }: { title: string; anomalies: EnergySchoolHolidayAnomalyDto[] }) {
  return <section className="rounded-xl border border-border p-4">
    <h4 className="text-sm font-semibold text-foreground">{title} · {anomalies.length}</h4>
    {anomalies.length === 0 ? (
      <p className="mt-2 text-xs leading-5 text-muted">No date crossed the Release-pinned sample and materiality gates.</p>
    ) : (
      <div className="mt-3 divide-y divide-border">
        {anomalies.slice(0, 4).map((anomaly) => <article key={anomaly.localDate} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">{formatDate(anomaly.localDate)} · {phaseLabel(anomaly.academicPhase)}</p>
            <p className="text-sm font-semibold text-warning">{signedPercent(anomaly.deltaPercent)}</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">{formatKwh(anomaly.actualKwh)} vs {formatKwh(anomaly.baselineKwh)} same-context baseline</p>
        </article>)}
      </div>
    )}
  </section>;
}

const contextLabel = (value: "weekday" | "weekend" | "public_holiday") => value === "public_holiday"
  ? "Public Holiday"
  : value === "weekday" ? "weekday" : "weekend";
const unavailableCohortReason = (
  value: "ACTUAL_SAMPLE_UNAVAILABLE" | "TEACHING_BASELINE_UNAVAILABLE",
) => value === "ACTUAL_SAMPLE_UNAVAILABLE"
  ? "not enough complete School Holiday dates"
  : "not enough adjacent Teaching dates";
const phaseLabel = (value: string) => value === "term_break" ? "Term Break"
  : value === "study_exam" ? "Study / Exam" : value === "vacation" ? "Vacation" : "Teaching";
const formatKwh = (value: number) => `${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(value)} kWh`;
const formatHourlyKwh = (value: number) => `${new Intl.NumberFormat("en-SG", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} kWh`;
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const formatPercent = (value: number) => `${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(value)}%`;
const signedPercent = (value: number) => `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
const previousDate = (value: string) => new Date(Date.parse(`${value}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
const formatDate = (value: string) => new Intl.DateTimeFormat("en-SG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${value}T12:00:00.000Z`));

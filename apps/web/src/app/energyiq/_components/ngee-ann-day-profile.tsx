"use client";

import React, { useState } from "react";

import type { NgeeAnnDayProfileViewModel } from "./ngee-ann-overview-view-model";

type DayProfile = NgeeAnnDayProfileViewModel["profiles"][number];

export function NgeeAnnDayProfile({ view }: { view: NgeeAnnDayProfileViewModel }) {
  const [selectedScopeId, setSelectedScopeId] = useState(view.scopes[0]?.id ?? "");
  const [selectedDayType, setSelectedDayType] = useState<"weekday" | "weekend" | "public_holiday">("weekday");
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  if (view.status === "unavailable") {
    return (
      <TimeModuleUnavailable
        heading="Day profile"
        headingId="ngee-ann-day-profile"
        question={view.decisionQuestion}
        reason={view.reason}
      />
    );
  }

  const profile = view.profiles.find((candidate) => (
    candidate.scopeId === selectedScopeId && candidate.dayType === selectedDayType
  )) ?? view.profiles[0]!;
  const activePoint = profile.values.find((point) => point.id === activePointId)
    ?? profile.values.find((point) => point.id === selectedPointId)
    ?? null;
  const comparisonDayType = profile.dayType === "weekday"
    ? "weekend"
    : profile.dayType === "weekend"
      ? "weekday"
      : null;
  const comparisonProfile = comparisonDayType
    ? view.profiles.find((candidate) => (
      candidate.scopeId === profile.scopeId
      && candidate.dayType === comparisonDayType
      && candidate.status === "available"
      && candidate.summary.status === "available"
    )) ?? null
    : null;
  let maximumUsageKwh = 0;
  for (const point of profile.values) {
    if (point.acceptedUsageKwh > maximumUsageKwh) maximumUsageKwh = point.acceptedUsageKwh;
  }
  const averageUsageKwh = profile.values.length === 0
    ? 0
    : profile.values.reduce((total, point) => total + point.acceptedUsageKwh, 0) / profile.values.length;
  const activeDifferencePct = activePoint && averageUsageKwh > 0
    ? (activePoint.acceptedUsageKwh - averageUsageKwh) / averageUsageKwh * 100
    : null;
  const summaryUnavailableReason = profile.summary.status === "unavailable"
    ? profile.summary.reason
    : profile.reason ?? "No complete Day Type profile is available for this selection.";

  const resetPoint = () => {
    setActivePointId(null);
    setSelectedPointId(null);
  };

  return (
    <section aria-labelledby="ngee-ann-day-profile" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Day profile</p>
          <h3 id="ngee-ann-day-profile" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            24-Hour Profile Comparison
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="text-xs leading-5 text-muted">
          Mean of complete local days / {view.evidence.timezone} / {view.evidence.unit}
        </p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3" aria-label="Project Day Profile averages">
        {(["weekday", "weekend", "public_holiday"] as const).map((dayType) => {
          const projectProfile = view.profiles.find((candidate) => (
            candidate.scopeId === view.scopes[0]?.id && candidate.dayType === dayType
          ));
          return <DayProfileKpi key={dayType} profile={projectProfile ?? null} />;
        })}
      </div>

      {view.holidayInsight.status === "available" ? (
        <aside
          className="mt-4 rounded-xl border border-step-warning/25 bg-step-warning/5 px-4 py-4"
          aria-label="Public Holiday observed insight"
          data-holiday-insight="true"
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-step-warning">Observed pattern</p>
              <p className="mt-1.5 text-base font-semibold leading-6 text-foreground">{view.holidayInsight.headline}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{view.holidayInsight.detail}</p>
            </div>
            <div className="rounded-lg bg-surface px-3 py-3">
              <p className="text-xs font-semibold text-foreground">Angle to investigate</p>
              <p className="mt-1 text-sm leading-6 text-muted"><em>{view.holidayInsight.angle}</em></p>
            </div>
          </div>
          <p className="mt-3 border-t border-step-warning/15 pt-2 text-xs leading-5 text-muted">{view.holidayInsight.caveat}</p>
        </aside>
      ) : null}

      <div className="mt-5 grid gap-3 rounded-xl border border-border bg-surface-subtle/45 p-3 lg:grid-cols-2">
        <fieldset className="min-w-0 rounded-lg bg-surface px-3 py-3">
          <legend className="mb-2 text-xs font-semibold text-muted">Day Profile type</legend>
          <div className="flex flex-wrap gap-1.5">
            {(["weekday", "weekend", "public_holiday"] as const).map((dayType) => {
              const selected = profile.dayType === dayType;
              const label = dayType === "weekday" ? "Weekday" : dayType === "weekend" ? "Weekend" : "Public Holiday";
              return (
                <button
                  key={dayType}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="ngee-ann-day-profile-chart"
                  className={filterClassName(selected)}
                  onClick={() => {
                    setSelectedDayType(dayType);
                    resetPoint();
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="min-w-0 rounded-lg bg-surface px-3 py-3">
          <legend className="mb-2 text-xs font-semibold text-muted">Day Profile Scope</legend>
          <div className="flex flex-wrap gap-1.5">
            {view.scopes.map((scope) => {
              const selected = scope.id === profile.scopeId;
              return (
                <button
                  key={scope.id}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="ngee-ann-day-profile-chart"
                  className={filterClassName(selected)}
                  onClick={() => {
                    setSelectedScopeId(scope.id);
                    resetPoint();
                  }}
                >
                  {scope.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface-subtle/60 px-4 py-4" data-when-energy-summary="true">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">When energy occurs</p>
        {profile.status === "available" && profile.summary.status === "available" ? (
          <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
            <div>
              <p className="text-lg font-semibold tracking-[-0.015em] text-foreground">
                {profile.dayTypeLabel} / {profile.scopeName} peaked at {profile.summary.peakHourLabel}
              </p>
              <p className="mt-1 text-base font-semibold tabular-nums text-step-inspect">
                {profile.summary.peakUsage} kWh mean
              </p>
              <p className="mt-1 text-xs text-muted">
                {profile.summary.sampleDayCount} complete-day {profile.summary.sampleDayCount === 1 ? "sample" : "samples"}
              </p>
            </div>
            <div className="text-sm leading-6 text-muted">
              {comparisonProfile && comparisonProfile.summary.status === "available" ? (
                <p>
                  {comparisonProfile.dayTypeLabel} / {comparisonProfile.scopeName} peaked at {comparisonProfile.summary.peakHourLabel} with a {comparisonProfile.summary.peakUsage} kWh mean across {comparisonProfile.summary.sampleDayCount} complete-day {comparisonProfile.summary.sampleDayCount === 1 ? "sample" : "samples"}.
                </p>
              ) : (
                <p>No second complete Day Type profile is available for a trustworthy comparison.</p>
              )}
              <p className="mt-1">This observed profile does not by itself prove an anomaly, waste or cause.</p>
            </div>
          </div>
        ) : (
          <div className="mt-2" role="status">
            <p className="text-sm font-semibold text-foreground">When-energy summary unavailable</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {summaryUnavailableReason}
            </p>
          </div>
        )}
      </div>

      {profile.status === "unavailable" ? (
        <div id="ngee-ann-day-profile-chart" className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-5" role="status">
          <p className="text-xs font-semibold text-foreground">{profile.dayTypeLabel} / {profile.scopeName} unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{profile.reason}</p>
          <p className="mt-2 text-[10px] leading-4 text-muted-light">No value is inferred or zero-filled for this selection.</p>
        </div>
      ) : (
        <>
          <HourlyProfileChart
            profile={profile}
            maximumUsageKwh={maximumUsageKwh}
            averageUsageKwh={averageUsageKwh}
            selectedPointId={selectedPointId}
            onActivePointChange={setActivePointId}
            onSelectedPointChange={setSelectedPointId}
          />
          <div className="mt-4 min-h-[78px] rounded-lg bg-surface-subtle px-4 py-3" aria-live="polite" aria-atomic="true">
            {activePoint ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">{profile.dayTypeLabel} / {profile.scopeName}</p>
                  <p className="mt-1 text-[10px] text-muted">{profile.sampleDayCount} complete-day samples / mean_of_complete_local_days</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">{activePoint.hourLabel} / {activePoint.usageKwh} kWh</p>
                  {activeDifferencePct !== null ? (
                    <p className={activeDifferencePct > 0 ? "mt-1 text-[10px] font-semibold text-step-inspect" : "mt-1 text-[10px] text-muted"}>
                      {activeDifferencePct > 0 ? "+" : ""}{activeDifferencePct.toFixed(1)}% vs profile mean
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-muted">
                Hover or focus an hour to inspect its server-provided mean. Press Enter or Space to keep its detail open.
              </p>
            )}
          </div>
        </>
      )}

      <TimeEvidence label="Day Profile evidence" evidence={view.evidence} />
      <TimeEvidence label="Component profile evidence" evidence={view.componentEvidence} />
    </section>
  );
}

function DayProfileKpi({ profile }: { profile: DayProfile | null }) {
  const title = profile?.dayType === "weekday"
    ? "Weekday daily average"
    : profile?.dayType === "weekend"
      ? "Weekend daily average"
      : "Public Holiday baseline";
  const accent = profile?.dayType === "weekday"
    ? "border-primary/35"
    : profile?.dayType === "weekend"
      ? "border-step-inspect/35"
      : "border-border";
  return (
    <article className={`min-w-0 rounded-xl border bg-surface px-4 py-4 ${accent}`}>
      <p className="text-xs font-semibold text-muted">{title}</p>
      {profile?.summary.status === "available" ? (
        <>
          <p aria-label={`${profile.summary.dailyUsage} kWh/day`} className="mt-2 text-2xl font-semibold tracking-[-0.025em] tabular-nums text-foreground">
            {profile.summary.dailyUsage} <span className="text-sm font-medium text-muted">kWh/day</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            {profile.summary.sampleDayCount} complete-day {profile.summary.sampleDayCount === 1 ? "sample" : "samples"}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm font-semibold text-foreground">{title} unavailable</p>
          <p className="mt-1 text-xs leading-5 text-muted">{profile?.reason ?? "No authoritative Day Type sample is available."}</p>
        </>
      )}
    </article>
  );
}

function HourlyProfileChart({
  profile,
  maximumUsageKwh,
  averageUsageKwh,
  selectedPointId,
  onActivePointChange,
  onSelectedPointChange,
}: {
  profile: DayProfile;
  maximumUsageKwh: number;
  averageUsageKwh: number;
  selectedPointId: string | null;
  onActivePointChange: (id: string | null) => void;
  onSelectedPointChange: (id: string | null) => void;
}) {
  const width = 960;
  const height = 300;
  const margin = { top: 26, right: 24, bottom: 42, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const componentCategories = profile.componentStack.status === "available"
    ? profile.componentStack.categories
    : [];
  const componentTotals = Array.from({ length: 24 }, (_, localHour) => (
    componentCategories.reduce((sum, category) => sum + category.values[localHour]!.acceptedUsageKwh, 0)
  ));
  const maximum = Math.max(maximumUsageKwh, ...componentTotals, 1);
  const coordinates = profile.values.map((point, index) => ({
    point,
    x: margin.left + (profile.values.length <= 1 ? 0 : index / (profile.values.length - 1) * plotWidth),
    y: margin.top + plotHeight - point.acceptedUsageKwh / maximum * plotHeight,
  }));
  const linePath = coordinates.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPath = coordinates.length === 0
    ? ""
    : `M${coordinates[0]!.x.toFixed(2)},${(margin.top + plotHeight).toFixed(2)} ${coordinates.map(({ x, y }) => `L${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} L${coordinates.at(-1)!.x.toFixed(2)},${(margin.top + plotHeight).toFixed(2)} Z`;
  const averageY = margin.top + plotHeight - averageUsageKwh / maximum * plotHeight;
  const stackPaths = componentCategories.map((category, categoryIndex) => {
    const lower = category.values.map((_, localHour) => (
      componentCategories.slice(0, categoryIndex)
        .reduce((sum, previous) => sum + previous.values[localHour]!.acceptedUsageKwh, 0)
    ));
    const upper = category.values.map((value, localHour) => lower[localHour]! + value.acceptedUsageKwh);
    const xAt = (localHour: number) => margin.left + localHour / 23 * plotWidth;
    const yAt = (value: number) => margin.top + plotHeight - value / maximum * plotHeight;
    const upperPath = upper.map((value, localHour) => `${localHour === 0 ? "M" : "L"}${xAt(localHour).toFixed(2)},${yAt(value).toFixed(2)}`).join(" ");
    const lowerPath = lower.map((value, localHour) => ({ value, localHour })).reverse()
      .map(({ value, localHour }) => `L${xAt(localHour).toFixed(2)},${yAt(value).toFixed(2)}`).join(" ");
    return {
      category,
      path: `${upperPath} ${lowerPath} Z`,
    };
  });

  return (
    <div id="ngee-ann-day-profile-chart" className="mt-4 rounded-xl border border-border bg-surface px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="w-5 border-t-[3px] border-primary" />Official Scope energy</span>
          {componentCategories.length > 0 ? (
            <span className="font-semibold text-foreground">Published component Category shape</span>
          ) : null}
          {componentCategories.map((category) => (
            <span key={category.category} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-3.5 rounded-sm" style={{ backgroundColor: componentCategoryColor(category.category) }} />
              {category.categoryLabel}
            </span>
          ))}
        </div>
        <span>{profile.sampleDayCount} complete {profile.sampleDayCount === 1 ? "day" : "days"} / 24 server values</span>
      </div>
      <div data-hour-plot="day-profile" className="relative mt-3">
        <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`day-profile-title-${profile.id} day-profile-desc-${profile.id}`}>
          <title id={`day-profile-title-${profile.id}`}>{`${profile.dayTypeLabel} 24-hour profile for ${profile.scopeName}`}</title>
          <desc id={`day-profile-desc-${profile.id}`}>The line shows official Scope mean energy. When published, stacked areas show component Circuit Categories for the same complete-day sample.</desc>
        {[0, 0.5, 1].map((ratio) => {
          const y = margin.top + plotHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={margin.left - 9} y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{(maximum * ratio).toFixed(1)}</text>
            </g>
          );
        })}
        {stackPaths.length > 0
          ? stackPaths.map(({ category, path }) => (
            <path key={category.category} d={path} fill={componentCategoryColor(category.category)} opacity="0.62" />
          ))
          : areaPath ? <path d={areaPath} fill="var(--primary)" opacity="0.16" /> : null}
        {linePath ? <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
        <line x1={margin.left} x2={width - margin.right} y1={averageY} y2={averageY} stroke="var(--step-inspect)" strokeWidth="1.5" strokeDasharray="6 5" />
        <text x={width - margin.right} y={averageY - 7} textAnchor="end" fontSize="10" fontWeight="600" fill="var(--step-inspect)">Hourly mean {averageUsageKwh.toFixed(2)} kWh</text>
          {coordinates.map(({ point, x, y }, index) => (
          <g
            key={point.id}
            className="cursor-pointer"
            onMouseEnter={() => onActivePointChange(point.id)}
            onMouseLeave={() => onActivePointChange(null)}
            onClick={() => onSelectedPointChange(point.id)}
          >
            <circle cx={x} cy={y} r={selectedPointId === point.id ? 6 : 4} fill="var(--surface)" stroke="var(--primary)" strokeWidth="3" />
            {(index % 3 === 0 || index === coordinates.length - 1) ? (
              <text x={x} y={height - 16} textAnchor="middle" fontSize="10" fill="var(--muted)">{point.hourLabel}</text>
            ) : null}
          </g>
        ))}
          <text x="12" y={margin.top + plotHeight / 2} fontSize="10" fill="var(--muted)" transform={`rotate(-90 12 ${margin.top + plotHeight / 2})`}>Mean energy (kWh)</text>
        </svg>
        <div className="absolute bottom-[14%] left-[5.4%] right-[2.5%] top-[8.6%] grid" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }} aria-label="Day Profile hourly points">
          {profile.values.map((point) => (
            <button
              key={point.id}
              type="button"
              aria-label={`${profile.dayTypeLabel} ${profile.scopeName} ${point.hourLabel}: ${point.usageKwh} kWh`}
              aria-pressed={selectedPointId === point.id}
              className="min-w-0 rounded-sm bg-transparent text-transparent outline-none focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/45"
              onMouseEnter={() => onActivePointChange(point.id)}
              onMouseLeave={() => onActivePointChange(null)}
              onFocus={() => onActivePointChange(point.id)}
              onBlur={() => onActivePointChange(null)}
              onClick={() => onSelectedPointChange(point.id)}
            />
          ))}
        </div>
      </div>
      <div data-hour-axis="day-profile" className="sr-only">Local-hour axis: 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00.</div>
    </div>
  );
}

function componentCategoryColor(category: string): string {
  if (category === "load") return "var(--step-transform)";
  if (category === "light") return "var(--step-query)";
  if (category === "aircon") return "var(--primary)";
  return "var(--step-inspect)";
}

function TimeModuleUnavailable({
  heading,
  headingId,
  question,
  reason,
}: {
  heading: string;
  headingId: string;
  question: string;
  reason: string | null;
}) {
  return (
    <section aria-labelledby={headingId} className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <h3 id={headingId} className="text-lg font-semibold tracking-[-0.015em] text-foreground">{heading}</h3>
      <p className="mt-1.5 text-sm leading-6 text-muted">{question}</p>
      <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
        <p className="text-xs font-semibold text-foreground">{heading} unavailable</p>
        <p className="mt-1 text-[11px] leading-5 text-muted">{reason}</p>
      </div>
    </section>
  );
}

function TimeEvidence({
  label,
  evidence,
}: {
  label: string;
  evidence: NgeeAnnDayProfileViewModel["evidence"] | NgeeAnnDayProfileViewModel["componentEvidence"];
}) {
  return (
    <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
      <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        {label} / {evidence.queryIds.join(", ")}
      </summary>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[80px_minmax(0,1fr)]">
        <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{evidence.snapshotId}</dd>
        <dt>Release</dt><dd className="break-all font-mono text-foreground">{evidence.projectReleaseId}</dd>
        <dt>Mapping</dt><dd className="break-all font-mono text-foreground">{evidence.meterMappingRevisionId}</dd>
        <dt>Formula</dt><dd className="break-all font-mono text-foreground">{evidence.meterFormulaRevisionId}</dd>
        <dt>Metric</dt><dd className="break-all font-mono text-foreground">{evidence.metricId}</dd>
        <dt>Period</dt><dd className="break-words text-foreground">{evidence.period}</dd>
        <dt>Timezone</dt><dd className="text-foreground">{evidence.timezone}</dd>
        <dt>Unit</dt><dd className="text-foreground">{evidence.unit}</dd>
        <dt>Query</dt><dd className="break-all font-mono text-foreground">{evidence.queryIds.join(", ")}</dd>
      </dl>
    </details>
  );
}

function filterClassName(selected: boolean): string {
  return selected
    ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    : "min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
}

export { TimeEvidence, TimeModuleUnavailable, filterClassName };

import React from "react";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { EnergyTemplateRenderer } from "./energy-template-renderer";
import { EnergyIcon } from "./icons";
import {
  TuyaOfficeProjectAiProvider,
  TuyaOfficeProjectAiRegion,
} from "./tuya-office-project-ai-slots";

export type TuyaOfficeOverviewRendererState =
  | {
    status: "loading" | "empty" | "unsupported" | "error";
    title: string;
    detail: string;
  }
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
  };

type TuyaOfficeOverviewRendererProps = {
  state: TuyaOfficeOverviewRendererState;
  onRetry?: () => void;
  showContextHeader?: boolean;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
};

type Finding = {
  title: string;
  detail: string;
  tone: "energy" | "quality" | "attention";
};

const NUMBER = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });
const PRECISE_NUMBER = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });

export function TuyaOfficeOverviewRenderer({
  state,
  onRetry,
  showContextHeader = true,
  projectExplorerHref,
  aiAnalystHref,
}: TuyaOfficeOverviewRendererProps) {
  if (state.status !== "ready") {
    return <EnergyTemplateRenderer state={state} onRetry={onRetry} />;
  }

  const { snapshot } = state;
  if (snapshot.context.projectId !== "tuya-office" || snapshot.projectRelease.projectId !== "tuya-office") {
    return (
      <EnergyTemplateRenderer
        state={{
          status: "error",
          title: "Tuya Overview identity does not match",
          detail: "Reload the published Tuya Office Release before showing this report.",
        }}
        onRetry={onRetry}
      />
    );
  }

  const { analysis } = snapshot;
  const dailyRows = projectDailyRows(snapshot);
  const dailyCoverage = summariseDailyCoverage(dailyRows);
  const partialCoverage = snapshot.dataQuality.coveragePct < 95;
  const completeWindowAvailable = dailyCoverage.allComplete && !partialCoverage;
  const aiCoverageWithheld = !completeWindowAvailable;
  const composition = compositionRows(snapshot);
  const findings = buildFindings(snapshot, { ...dailyCoverage, allComplete: completeWindowAvailable });
  const actions = buildActions(snapshot);
  const anomalyLens = buildAnomalyLens(snapshot);
  const topCircuit = analysis.topCircuits[0] ?? analysis.circuits[0];
  const dataThrough = snapshot.dataSnapshot.sourceCoverage?.throughLocalDate
    ?? snapshot.context.latestCompleteLocalDay
    ?? snapshot.dataSnapshot.lastSeenAt;
  const period = `${formatDate(snapshot.context.primaryPeriod.start)} – ${formatDate(snapshot.context.primaryPeriod.endExclusive, true)}`;
  const health = snapshot.meterDataHealth?.summary;

  return (
    <TuyaOfficeProjectAiProvider
      snapshot={snapshot}
      aiAnalystHref={aiAnalystHref}
      enabled={!aiCoverageWithheld}
    >
    <article
      aria-label="Tuya Office published energy overview"
      data-tuya-office-overview="true"
      data-snapshot-id={snapshot.dataSnapshot.id}
      data-project-release-id={snapshot.projectRelease.id}
      data-tuya-coverage-policy={partialCoverage ? "partial" : "complete"}
      className="overflow-hidden rounded-2xl border border-[#dfe5dc] bg-[#f7f9f5] text-[#1d2924] shadow-[0_18px_44px_rgba(26,50,41,0.08)]"
    >
      {showContextHeader ? (
        <header className="border-b border-[#dfe5dc] bg-white px-5 py-6 sm:px-7 lg:px-10 lg:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[#5d6c65]">
                <span className="font-semibold text-[#203a31]">Tuya Office</span>
                <EnergyIcon name="chevron" className="h-3 w-3" />
                <span>Whole project</span>
                <span aria-hidden="true">·</span>
                <span>{snapshot.context.timezone}</span>
              </div>
              <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.03em] text-[#173a30] sm:text-4xl">
                Energy Overview
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5d6c65] sm:text-base">
                A decision view of consumption, operating patterns and measurement readiness for the latest published office data.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#52645c] sm:text-sm">
                <span className="inline-flex items-center gap-1.5"><EnergyIcon name="calendar" className="h-4 w-4" />{period}</span>
                <span>Data through {formatDataThrough(dataThrough)}</span>
              </div>
            </div>
            <div className="min-w-[250px] rounded-xl bg-[#edf3ee] px-4 py-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-[#1e5a48]">
                <EnergyIcon name={snapshot.dataQuality.status === "complete" ? "check" : "info"} className="h-4 w-4" />
                {partialCoverage ? "Partial data" : snapshot.dataQuality.status === "complete" ? "Published data complete" : "Published with data limits"}
              </div>
              <p className="mt-2 leading-5 text-[#5d6c65]">
                {NUMBER.format(snapshot.dataQuality.coveragePct)}% coverage · {NUMBER.format(snapshot.dataQuality.validIntervalCount)} valid intervals
              </p>
              <p className="mt-1 break-all text-xs text-[#718078]">Snapshot {snapshot.dataSnapshot.id}</p>
            </div>
          </div>
        </header>
      ) : null}

      <div className="space-y-0">
        {partialCoverage ? (
          <div className="border-b border-[#ead9b8] bg-[#fff8e8] px-5 py-6 sm:px-7 lg:px-10" role="status">
            <h2 className="text-lg font-semibold text-[#6b4b16]">Partial data</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#795f31]">
              Coverage is {NUMBER.format(snapshot.dataQuality.coveragePct)}%. Business findings, anomaly conclusions and recommended actions are withheld until coverage reaches 95% and every published day is complete.
            </p>
          </div>
        ) : null}

        <OverviewSection id="tuya-key-findings" title="Key Findings" description="What deserves attention first, using only the current published Snapshot.">
          {aiCoverageWithheld ? (
            <WithheldState
              title="Business findings withheld"
              detail="Coverage must reach 95% and every published day must be complete before the report turns this evidence into business conclusions."
            />
          ) : (
            <div className="grid gap-px overflow-hidden rounded-xl border border-[#dce4dd] bg-[#dce4dd] lg:grid-cols-3">
              {findings.map((finding) => (
                <div key={finding.title} className="bg-white p-5 sm:p-6" data-finding-tone={finding.tone}>
                  <div className={`mb-4 h-1.5 w-12 rounded-full ${findingTone(finding.tone)}`} />
                  <h3 className="text-lg font-semibold tracking-[-0.015em] text-[#20352d]">{finding.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#5b6963]">{finding.detail}</p>
                </div>
              ))}
            </div>
          )}
          {aiCoverageWithheld ? (
            <div className="mt-4 rounded-xl border border-dashed border-[#cbd8d0] bg-[#f0f4ef] px-5 py-4" data-governed-ai-status="withheld">
              <p className="text-sm font-semibold text-[#28483c]">Governed AI interpretation</p>
              <p className="mt-1 text-sm leading-6 text-[#607068]">
                A governed AI interpretation is withheld until coverage reaches 95% and every published day is complete.
              </p>
            </div>
          ) : <TuyaOfficeProjectAiRegion regionId="tuya-key-findings" showRestoreStatus />}
        </OverviewSection>

        <OverviewSection id="tuya-overall-performance" title="Overall performance" description="Published headline metrics for the exact report window.">
          <dl className="grid gap-px overflow-hidden rounded-xl border border-[#dce4dd] bg-[#dce4dd] sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Official energy" value={`${NUMBER.format(analysis.summary.usageKwh)} kWh`} note="No double-counted components" />
            <Metric
              metric="average-per-day"
              evidenceStatus={completeWindowAvailable ? "complete" : "unavailable"}
              label="Average per day"
              value={completeWindowAvailable ? `${NUMBER.format(analysis.summary.averageDailyUsageKwh)} kWh` : "Unavailable"}
              note={completeWindowAvailable
                ? `${dailyCoverage.complete} complete day${dailyCoverage.complete === 1 ? "" : "s"}`
                : "Complete-day average unavailable while any published day is partial or unavailable"}
            />
            <Metric label="Peak interval average" value={`${PRECISE_NUMBER.format(analysis.summary.peakKw)} kW`} note={analysis.summary.peakAt ? `Observed ${formatTimestamp(analysis.summary.peakAt)}` : "Peak timestamp unavailable"} />
            <Metric
              label="Outside configured hours"
              value={analysis.offHours.status === "available" ? `${NUMBER.format(analysis.offHours.sharePct)}%` : "Unavailable"}
              note={analysis.offHours.status === "available" ? `${NUMBER.format(analysis.offHours.usageKwh)} kWh` : "Operating calendar required"}
            />
          </dl>
          {!aiCoverageWithheld ? <TuyaOfficeProjectAiRegion regionId="tuya-overall-performance" /> : null}
        </OverviewSection>

        <OverviewSection id="tuya-energy-composition" title="Energy composition" description="How published categories and Spaces contribute to the official total.">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <CompositionBars rows={composition} />
            <div className="rounded-xl bg-[#173a30] p-6 text-white">
              <h3 className="text-lg font-semibold">Space and Distribution Board context</h3>
              <p className="mt-2 text-sm leading-6 text-[#d8e6df]">
                These totals follow the Space, Distribution Board and meter relationships in this exact published Project Release. Partial residuals remain labelled by server evidence.
              </p>
              <div className="mt-5 space-y-3">
                {analysis.childScopes.slice(0, 5).map((scope) => (
                  <div key={scope.nodeId} className="flex items-baseline justify-between gap-4 border-t border-white/15 pt-3 text-sm">
                    <span className="min-w-0 truncate text-[#d8e6df]">{scope.name}</span>
                    <span className="shrink-0 font-semibold">{NUMBER.format(scope.usageKwh)} kWh · {NUMBER.format(scope.sharePct)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </OverviewSection>

        <OverviewSection id="tuya-trend" title="Trend & complete-day coverage" description="Daily official energy; gaps remain visible instead of being interpolated.">
          <DailyTrend rows={dailyRows} />
        </OverviewSection>

        <OverviewSection id="tuya-operating-pattern" title="Operating pattern" description="The server-provided average hourly profile across the published period.">
          <HourlyPattern points={analysis.hourlyProfile} />
          <p className="mt-5 max-w-3xl text-sm leading-6 text-[#5b6963]">
            This profile describes when demand persists. It does not label usage as waste without a confirmed operating calendar and equipment purpose.
          </p>
          {!aiCoverageWithheld ? <TuyaOfficeProjectAiRegion regionId="tuya-operating-pattern" /> : null}
        </OverviewSection>

        <OverviewSection id="tuya-circuit-health" title="Circuit attribution & data health" description="What can be attributed now, and what must be verified before stronger conclusions.">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-[#dce4dd] bg-white p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-[#20352d]">Leading measured contributors</h3>
              <div className="mt-5 space-y-4">
                {analysis.topCircuits.slice(0, 5).map((circuit) => (
                  <div key={circuit.meterNodeId}>
                    <div className="flex items-start justify-between gap-4 text-sm">
                      <span className="font-medium text-[#2a4138]">{circuit.name}</span>
                      <span className="shrink-0 text-[#5d6c65]">{NUMBER.format(circuit.usageKwh)} kWh</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#edf1ed]">
                      <div className="h-full rounded-full bg-[#3f7d68]" style={{ width: `${Math.max(2, Math.min(100, circuit.sharePct))}%` }} />
                    </div>
                  </div>
                ))}
                {analysis.topCircuits.length === 0 ? <p className="text-sm text-[#6b7972]">Circuit attribution is unavailable for this Snapshot.</p> : null}
              </div>
            </div>
            <div className="rounded-xl border border-[#dce4dd] bg-[#f0f4ef] p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-[#20352d]">Measurement readiness</h3>
              {health ? (
                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
                  <HealthMetric label="Configured meters" value={health.total} />
                  <HealthMetric label="Usable" value={health.usable} />
                  <HealthMetric label="Insufficient history" value={health.insufficientHistory} />
                  <HealthMetric label="No readings" value={health.noReadings} />
                </dl>
              ) : (
                <p className="mt-5 text-sm leading-6 text-[#5b6963]" data-meter-health-status="unavailable">
                  Meter-level health is unavailable for this Snapshot. No zero counts are inferred.
                </p>
              )}
              <p className="mt-5 text-sm leading-6 text-[#5b6963]">
                Virtual-meter residuals remain evidence, not official totals. Missing component inputs are shown as partial or unavailable.
              </p>
            </div>
          </div>
          {!aiCoverageWithheld ? <TuyaOfficeProjectAiRegion regionId="tuya-circuit-health" /> : null}
        </OverviewSection>

        <OverviewSection id="tuya-decision-lenses" title="Energy, safety & anomaly review" description="Three decision lenses, each limited to what the published evidence can support.">
          {aiCoverageWithheld ? (
            <WithheldState
              title="Anomaly conclusions withheld"
              detail="The exact Snapshot remains inspectable, but anomaly and business interpretations resume only after the governed coverage threshold is met."
            />
          ) : <div className="grid gap-4 lg:grid-cols-3">
            <DecisionLens
              eyebrow="Energy"
              title={topCircuit ? `${topCircuit.name} leads measured consumption` : "Attribution is not ready"}
              detail={topCircuit
                ? `${NUMBER.format(topCircuit.usageKwh)} kWh is attributed to this Circuit. Confirm the served equipment and operating purpose before changing controls.`
                : "Complete the published Circuit mapping before ranking equipment or estimating opportunities."}
            />
            <DecisionLens
              eyebrow="Safety"
              title="Energy data is not an electrical safety inspection"
              detail="The report can reveal persistent or unusual demand, but it cannot confirm overload, wiring condition or protective-device compliance. Escalate those questions to a qualified inspection."
            />
            <DecisionLens
              eyebrow="Anomaly"
              title={anomalyLens.title}
              detail={anomalyLens.detail}
            />
          </div>}
          {!aiCoverageWithheld ? <TuyaOfficeProjectAiRegion regionId="tuya-decision-lenses" /> : null}
        </OverviewSection>

        <OverviewSection id="tuya-actions" title="Recommended actions" description="Practical checks that follow from the published evidence without inventing savings.">
          {aiCoverageWithheld ? (
            <WithheldState
              title="Recommended actions withheld"
              detail="Inspect the exact Project and Snapshot if needed; action recommendations resume when coverage reaches the governed publication threshold."
            />
          ) : <ol className="divide-y divide-[#dce4dd] overflow-hidden rounded-xl border border-[#dce4dd] bg-white">
            {actions.map((action, index) => (
              <li key={action.title} className="grid gap-3 px-5 py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:px-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e9f1ec] text-sm font-semibold text-[#27624f]">{index + 1}</span>
                <div>
                  <h3 className="font-semibold text-[#20352d]">{action.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#5b6963]">{action.detail}</p>
                </div>
              </li>
            ))}
          </ol>}
          <div className="mt-6 flex flex-wrap gap-3">
            {projectExplorerHref ? <ActionLink href={projectExplorerHref} icon="explorer">View energy consumption</ActionLink> : null}
            {aiAnalystHref ? <ActionLink href={aiAnalystHref} icon="ask">Ask the advisor about this</ActionLink> : null}
          </div>
        </OverviewSection>
      </div>

      <footer className="flex flex-col gap-2 border-t border-[#dfe5dc] bg-white px-5 py-4 text-xs text-[#68766f] sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
        <span>Data through {formatDataThrough(dataThrough)} · current immutable Snapshot</span>
        <span>{topCircuit ? `Leading measured contributor: ${topCircuit.name}` : "Circuit attribution pending"}</span>
      </footer>
    </article>
    </TuyaOfficeProjectAiProvider>
  );
}

function OverviewSection({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-heading`}
      data-overview-section="true"
      data-overview-navigation-label={title}
      className="scroll-mt-24 border-b border-[#dfe5dc] px-5 py-10 [content-visibility:auto] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4e806d] sm:px-7 lg:px-10 lg:py-14"
    >
      <div className="mb-7 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <h2 id={`${id}-heading`} className="text-2xl font-semibold tracking-[-0.025em] text-[#173a30]">{title}</h2>
        <p className="max-w-2xl text-sm leading-6 text-[#66756e] lg:text-right">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  metric,
  evidenceStatus,
}: {
  label: string;
  value: string;
  note: string;
  metric?: string;
  evidenceStatus?: "complete" | "unavailable";
}) {
  return (
    <div className="bg-white p-5 sm:p-6" data-overview-metric={metric} data-evidence-status={evidenceStatus}>
      <dt className="text-sm font-medium text-[#617069]">{label}</dt>
      <dd className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#173a30]">{value}</dd>
      <p className="mt-2 text-xs leading-5 text-[#77847e]">{note}</p>
    </div>
  );
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs leading-5 text-[#68766f]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-[#173a30]">{NUMBER.format(value)}</dd>
    </div>
  );
}

function DecisionLens({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <article className="rounded-xl border border-[#dce4dd] bg-white p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f7d68]">{eyebrow}</p>
      <h3 className="mt-3 text-lg font-semibold tracking-[-0.015em] text-[#20352d]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#5b6963]">{detail}</p>
    </article>
  );
}

function WithheldState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#c9d3cc] bg-[#f3f5f2] px-5 py-5" data-business-conclusion-status="withheld">
      <h3 className="font-semibold text-[#34473f]">{title}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#65736d]">{detail}</p>
    </div>
  );
}

function CompositionBars({ rows }: { rows: Array<{ label: string; value: number; share: number }> }) {
  return (
    <div className="space-y-5">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium text-[#2a4138]">{row.label}</span>
            <span className="shrink-0 text-[#5d6c65]">{NUMBER.format(row.value)} kWh · {NUMBER.format(row.share)}%</span>
          </div>
          <div className="mt-2.5 h-3 overflow-hidden rounded-full bg-[#e7ece7]">
            <div className="h-full rounded-full bg-[#4e806d]" style={{ width: `${Math.max(2, Math.min(100, row.share))}%` }} />
          </div>
        </div>
      ))}
      {rows.length === 0 ? <p className="text-sm text-[#68766f]">Composition is unavailable for this Snapshot.</p> : null}
    </div>
  );
}

function DailyTrend({ rows }: { rows: Array<{ localDate: string; usageKwh: number | null; status: string }> }) {
  type MeasuredPoint = { localDate: string; usageKwh: number; status: string; x: number; y: number };
  const valid = rows.filter((row): row is { localDate: string; usageKwh: number; status: string } => row.usageKwh !== null);
  const coverage = summariseDailyCoverage(rows);
  const maximum = Math.max(1, ...valid.map((row) => row.usageKwh));
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? 380 : 24 + (index / (rows.length - 1)) * 712;
    const y = row.usageKwh === null ? null : 210 - (row.usageKwh / maximum) * 174;
    return { ...row, x, y };
  });
  const segments: MeasuredPoint[][] = [];
  let currentSegment: MeasuredPoint[] = [];
  for (const point of points) {
    if (point.usageKwh === null || point.y === null || point.status !== "complete") {
      if (currentSegment.length > 0) segments.push(currentSegment);
      currentSegment = [];
      continue;
    }
    currentSegment.push({ ...point, usageKwh: point.usageKwh, y: point.y });
  }
  if (currentSegment.length > 0) segments.push(currentSegment);
  return (
    <div className="overflow-hidden rounded-xl border border-[#dce4dd] bg-white p-4 sm:p-6">
      <svg viewBox="0 0 760 240" className="h-auto w-full" role="img" aria-label="Daily official energy trend">
        {[36, 94, 152, 210].map((y) => <line key={y} x1="24" y1={y} x2="736" y2={y} stroke="#e4e9e4" strokeWidth="1" />)}
        {segments.map((segment, index) => {
          const path = segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
          return <path key={`${segment[0]!.localDate}-${index}`} data-daily-trend-segment="true" d={path} fill="none" stroke="#2d6b57" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />;
        })}
        {points.map((point) => point.y === null || point.status === "unavailable"
          ? (
              <g key={point.localDate} data-daily-trend-status="unavailable" aria-label={`${point.localDate} unavailable`}>
                <line x1={point.x} y1="42" x2={point.x} y2="210" stroke="#a6b0aa" strokeWidth="2" strokeDasharray="6 6" />
                <circle cx={point.x} cy="210" r="5" fill="#f7f9f5" stroke="#7d8b84" strokeWidth="2" />
              </g>
            )
          : point.status === "partial"
            ? (
                <g key={point.localDate} data-daily-trend-status="partial" aria-label={`${point.localDate} partial`}>
                  <circle cx={point.x} cy={point.y} r="6" fill="#fff8ed" stroke="#d0933d" strokeWidth="3" />
                </g>
              )
            : <circle key={point.localDate} data-daily-trend-status="complete" cx={point.x} cy={point.y} r="4" fill="#2d6b57" />)}
      </svg>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4 text-xs text-[#6e7b75]">
        <span>{rows[0]?.localDate ?? "No daily rows"}</span>
        <span>{coverage.complete} complete · {coverage.partial} partial · {coverage.unavailable} unavailable</span>
        <span>{rows.at(-1)?.localDate ?? ""}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#6e7b75]" aria-label="Daily coverage legend">
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#2d6b57]" />Complete</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#d0933d] bg-[#fff8ed]" />Partial</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 border border-dashed border-[#7d8b84] bg-[#f4f6f3]" />Unavailable</span>
      </div>
    </div>
  );
}

function HourlyPattern({ points }: { points: Array<{ hour: number; averageKw: number; peakKw: number }> }) {
  const maximum = Math.max(1, ...points.map((point) => point.averageKw));
  return (
    <div className="grid grid-cols-12 gap-1.5 sm:grid-cols-24" role="img" aria-label="Average hourly demand profile">
      {Array.from({ length: 24 }, (_, hour) => {
        const point = points.find((candidate) => candidate.hour === hour);
        const ratio = point ? point.averageKw / maximum : 0;
        return (
          <div key={hour} className="flex min-w-0 flex-col items-center gap-2" data-hour-status={point ? "available" : "unavailable"}>
            <div className="flex h-32 w-full items-end overflow-hidden rounded-md bg-[#e8ede8]">
              {point ? (
                <div className="w-full rounded-t-md bg-[#466f8d]" style={{ height: `${Math.max(3, ratio * 100)}%` }} title={`${point.averageKw.toFixed(2)} kW average`} />
              ) : (
                <div className="h-full w-full border border-dashed border-[#a6b0aa] bg-[#f4f6f3]" title="Unavailable" />
              )}
            </div>
            <span className="text-[10px] text-[#748079]">{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActionLink({ href, icon, children }: { href: string; icon: "explorer" | "ask"; children: React.ReactNode }) {
  return (
    <a href={href} className="inline-flex items-center gap-2 rounded-lg bg-[#173a30] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#245244] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4e806d] focus-visible:ring-offset-2">
      <EnergyIcon name={icon} className="h-4 w-4" />{children}
    </a>
  );
}

function buildFindings(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  dailyCoverage: ReturnType<typeof summariseDailyCoverage>,
): Finding[] {
  const { analysis } = snapshot;
  const change = analysis.comparison.changePct;
  const health = snapshot.meterDataHealth?.summary;
  const topCircuit = analysis.topCircuits[0] ?? analysis.circuits[0];
  return [
    {
      tone: "energy",
      title: !dailyCoverage.allComplete
        ? "Period comparison unavailable until every published day is complete."
        : change === null
          ? "The current period has no comparable baseline yet."
          : `Official energy is ${Math.abs(change).toFixed(1)}% ${change >= 0 ? "above" : "below"} the comparison period.`,
      detail: !dailyCoverage.allComplete
        ? `${dailyCoverage.complete} complete, ${dailyCoverage.partial} partial and ${dailyCoverage.unavailable} unavailable day${dailyCoverage.complete + dailyCoverage.partial + dailyCoverage.unavailable === 1 ? "" : "s"} are published. No average or period comparison is inferred.`
        : change === null
        ? `${NUMBER.format(analysis.summary.usageKwh)} kWh is published for the exact current window.`
        : `${NUMBER.format(analysis.summary.usageKwh)} kWh now versus ${NUMBER.format(analysis.comparison.usageKwh)} kWh in the aligned comparison window.`,
    },
    {
      tone: "quality",
      title: health && health.usable === health.total ? "All configured meters are usable for this report." : "Some measurement inputs still limit attribution.",
      detail: health
        ? `${health.usable} of ${health.total} configured meters are usable; ${health.insufficientHistory} have insufficient history and ${health.noReadings} have no readings.`
        : `Snapshot coverage is ${NUMBER.format(snapshot.dataQuality.coveragePct)}%; meter-level health detail is unavailable.`,
    },
    {
      tone: "attention",
      title: topCircuit ? `${topCircuit.name} is the leading measured contributor.` : "Circuit ranking is not available yet.",
      detail: topCircuit
        ? `${NUMBER.format(topCircuit.usageKwh)} kWh (${NUMBER.format(topCircuit.sharePct)}%) is attributed to this measured Circuit. Verify its equipment purpose before acting.`
        : "Connect complete component series before publishing Circuit-level actions.",
    },
  ];
}

function buildAnomalyLens(snapshot: EnergyProjectAnalysisSnapshotDto): { title: string; detail: string } {
  const anomalies = snapshot.analysis.dailyUsageAnomalies;
  if (!anomalies || anomalies.status === "unavailable") {
    return {
      title: "Governed daily anomaly evidence is unavailable",
      detail: anomalies?.reason.message ?? "No governed daily anomaly bundle is published for this exact Snapshot.",
    };
  }
  const pins = anomalies.evidencePins;
  const pinsMatch = pins.projectReleaseId === snapshot.projectRelease.id
    && pins.dataSnapshotId === snapshot.dataSnapshot.id
    && pins.hierarchyRevisionId === snapshot.analysis.context.hierarchyRevisionId
    && pins.meterMappingRevisionId === snapshot.analysis.context.meterMappingRevisionId
    && pins.meterFormulaRevisionId === snapshot.analysis.context.meterFormulaRevisionId
    && pins.metricVersion === snapshot.analysis.context.metricVersion
    && pins.businessCalendarVersion === snapshot.analysis.context.businessCalendarVersion;
  if (!pinsMatch) {
    return {
      title: "Governed daily anomaly evidence is unavailable",
      detail: "The published anomaly evidence does not match this exact Snapshot and Project Release, so it is not displayed.",
    };
  }
  const scope = anomalies.scopes.find((candidate) => candidate.scopeId === snapshot.analysis.context.scopeId)
    ?? anomalies.scopes.find((candidate) => candidate.scopeType === "project");
  const triggered = scope?.rows
    .filter((row) => row.outcome === "triggered" && row.actualKwh !== null && row.baselineKwh !== null && row.impactKwh !== null)
    .sort((left, right) => Math.abs(right.impactKwh ?? 0) - Math.abs(left.impactKwh ?? 0))[0];
  if (triggered) {
    const relative = triggered.relativePct === null ? "relative change unavailable" : `${NUMBER.format(triggered.relativePct)}% above`;
    return {
      title: `Governed daily anomaly triggered on ${formatDataThrough(triggered.localDate)}`,
      detail: `${NUMBER.format(triggered.actualKwh!)} kWh versus ${NUMBER.format(triggered.baselineKwh!)} kWh against a governed baseline (${relative}, ${NUMBER.format(triggered.impactKwh!)} kWh impact) with ${NUMBER.format(triggered.coveragePct)}% interval coverage.`,
    };
  }
  const suppressed = scope?.rows.find((row) => row.outcome === "suppressed");
  if (suppressed) {
    return {
      title: "Daily anomaly evaluation was suppressed",
      detail: suppressed.suppressionReason?.message ?? "The published evidence did not meet the governed coverage or baseline requirements.",
    };
  }
  return {
    title: "No governed daily anomaly was triggered",
    detail: "The published daily comparisons stayed within the governed rule thresholds for this exact Scope and Snapshot.",
  };
}

function buildActions(snapshot: EnergyProjectAnalysisSnapshotDto): Array<{ title: string; detail: string }> {
  const { analysis } = snapshot;
  const health = snapshot.meterDataHealth?.summary;
  const actions: Array<{ title: string; detail: string }> = [];
  if (!health || health.insufficientHistory > 0 || health.noReadings > 0) {
    actions.push({
      title: "Verify meters with missing or insufficient history",
      detail: "Confirm device availability and the next accepted cumulative reading before treating a zero or missing series as an equipment fault.",
    });
  }
  if (analysis.offHours.status === "unavailable") {
    actions.push({
      title: "Confirm the operating calendar",
      detail: "Publish working hours and exceptions before classifying persistent demand as after-hours use or a savings opportunity.",
    });
  } else {
    actions.push({
      title: "Review persistent demand outside configured hours",
      detail: `${NUMBER.format(analysis.offHours.usageKwh)} kWh sits outside the published schedule. Check equipment purpose and control settings before changing operation.`,
    });
  }
  if (analysis.cost.status === "unavailable") {
    actions.push({
      title: "Add an applicable tariff before estimating savings",
      detail: "The report intentionally withholds monetary savings until a released tariff schedule covers this exact period.",
    });
  }
  if (actions.length < 3) {
    const topCircuit = analysis.topCircuits[0] ?? analysis.circuits[0];
    actions.push({
      title: topCircuit ? `Confirm the operating purpose of ${topCircuit.name}` : "Complete Circuit attribution",
      detail: topCircuit
        ? "Open it in Facility → Devices to check what the circuit serves and whether its hour-by-hour pattern matches the intended schedule."
        : "Connect component series and published virtual-meter formulas before ranking residual loads.",
    });
  }
  return actions.slice(0, 3);
}

function projectDailyRows(snapshot: EnergyProjectAnalysisSnapshotDto) {
  const scopes = snapshot.analysis.dailyTotals?.scopes ?? [];
  const selected = scopes.find((scope) => scope.scopeId === snapshot.analysis.context.scopeId)
    ?? scopes.find((scope) => scope.scopeType === "project")
    ?? scopes[0];
  return selected?.rows.map((row) => ({ localDate: row.localDate, usageKwh: row.usageKwh, status: row.dataHealth.status })) ?? [];
}

function summariseDailyCoverage(rows: Array<{ usageKwh: number | null; status: string }>) {
  const complete = rows.filter((row) => row.status === "complete" && row.usageKwh !== null).length;
  const partial = rows.filter((row) => row.status === "partial" && row.usageKwh !== null).length;
  const unavailable = rows.length - complete - partial;
  return {
    complete,
    partial,
    unavailable,
    allComplete: rows.length > 0 && complete === rows.length,
  };
}

function compositionRows(snapshot: EnergyProjectAnalysisSnapshotDto): Array<{ label: string; value: number; share: number }> {
  const categories = snapshot.analysis.categories
    .filter((row) => row.usageKwh > 0)
    .map((row) => ({ label: categoryLabel(row.category), value: row.usageKwh, share: row.sharePct }));
  if (categories.length > 0) return categories;
  return snapshot.analysis.childScopes
    .filter((row) => row.usageKwh > 0)
    .map((row) => ({ label: row.name, value: row.usageKwh, share: row.sharePct }));
}

function categoryLabel(value: string): string {
  return value.split(/[_-]/g).map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function findingTone(tone: Finding["tone"]): string {
  if (tone === "energy") return "bg-[#3f7d68]";
  if (tone === "quality") return "bg-[#466f8d]";
  return "bg-[#d0933d]";
}

function formatDate(value: string, exclusive = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  if (exclusive) date.setUTCDate(date.getUTCDate() - 1);
  return DATE.format(date);
}

function formatDataThrough(value: string | null | undefined): string {
  if (!value) return "unavailable";
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+08:00` : value;
  return formatDate(normalised);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" }).format(date);
}

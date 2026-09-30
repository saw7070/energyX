import React from "react";

import type {
  EnergyNormalisedMetricDto,
  EnergyProjectAnalysisMetadataDto,
  EnergyProjectAnalysisMetadataEvidenceDto,
  EnergyProjectAnalysisScopeMetadataDto,
  EnergyScopeMetadataValueDto,
} from "../../../lib/config-api";

type MetadataStatus = "confirmed" | "provisional" | "missing";

export function ScopeMetadataStatus({
  metadata,
  mode,
}: {
  metadata?: EnergyProjectAnalysisMetadataDto;
  mode: "interactive" | "saved";
}) {
  if (!metadata) {
    return (
      <section className="rounded-xl border border-border bg-surface p-5" aria-label="Area and headcount metadata">
        <h2 className="text-sm font-semibold text-foreground">Area &amp; headcount evidence unavailable</h2>
        <p className="mt-2 text-xs leading-5 text-muted">
          {mode === "saved"
            ? "Area and Headcount evidence was not frozen in this saved result. The result remains read-only and is not recalculated from current Project metadata."
            : "The resolved analysis did not include Area and Headcount evidence. Refresh the same published Project Release before using normalised metrics."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]" aria-label="Area and headcount metadata">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Area &amp; headcount</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Period-effective values pinned to hierarchy {metadata.hierarchyRevisionId} in {metadata.timezone}.
          </p>
        </div>
        <StatusBadge status={metadata.status} />
      </div>

      <div className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light">Selected Scope</p>
        <ScopeMetadataCard scope={metadata.selectedScope} />

        {metadata.comparisonScopes.length > 0 ? (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light">Comparison Scopes</p>
              <p className="text-[11px] text-muted">{metadata.comparisonScopes.length} Scopes use the same Period and pinned release.</p>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-muted-light">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Scope</th>
                    <th className="px-3 py-2 font-semibold">Area</th>
                    <th className="px-3 py-2 font-semibold">EUI</th>
                    <th className="px-3 py-2 font-semibold">Headcount</th>
                    <th className="px-3 py-2 font-semibold">Per-pax</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {metadata.comparisonScopes.map((scope) => (
                    <ScopeMetadataRow key={scope.scopeId} scope={scope} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <MetadataEvidence evidence={metadata.evidence} />
      </div>
    </section>
  );
}

function ScopeMetadataCard({ scope }: { scope: EnergyProjectAnalysisScopeMetadataDto }) {
  const guidance = uniqueGuidance(scope);
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-subtle/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{scope.scopeName}</h3>
          <p className="mt-0.5 font-mono text-[10px] text-muted-light">{scope.scopeId}</p>
        </div>
        <StatusBadge status={scope.status} />
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricFact label="Area" result={scope.area} />
        <MetricFact label="EUI" result={scope.normalisations.eui} />
        <MetricFact label="Headcount" result={scope.headcount} />
        <MetricFact label="Per-pax" result={scope.normalisations.perPax} />
      </dl>
      {guidance.length > 0 ? (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs leading-5 text-step-warning">
          {guidance.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function ScopeMetadataRow({ scope }: { scope: EnergyProjectAnalysisScopeMetadataDto }) {
  const guidance = uniqueGuidance(scope);
  return (
    <tr className="border-t border-border align-top first:border-t-0">
      <td className="px-3 py-3">
        <span className="block font-semibold text-foreground">{scope.scopeName}</span>
        {guidance.length > 0 ? (
          <span className="mt-1 block max-w-sm text-[11px] leading-4 text-step-warning">{guidance.join(" ")}</span>
        ) : null}
      </td>
      <td className="px-3 py-3"><CompactMetric result={scope.area} /></td>
      <td className="px-3 py-3"><CompactMetric result={scope.normalisations.eui} /></td>
      <td className="px-3 py-3"><CompactMetric result={scope.headcount} /></td>
      <td className="px-3 py-3"><CompactMetric result={scope.normalisations.perPax} /></td>
      <td className="px-3 py-3"><StatusBadge status={scope.status} /></td>
    </tr>
  );
}

function MetricFact({
  label,
  result,
}: {
  label: string;
  result: EnergyScopeMetadataValueDto | EnergyNormalisedMetricDto;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{formatMetric(result)}</dd>
      <dd className="mt-1"><StatusBadge status={result.status} compact /></dd>
    </div>
  );
}

function CompactMetric({
  result,
}: {
  result: EnergyScopeMetadataValueDto | EnergyNormalisedMetricDto;
}) {
  return (
    <span>
      <span className="block font-medium text-foreground">{formatMetric(result)}</span>
      <span className="mt-1 block"><StatusBadge status={result.status} compact /></span>
    </span>
  );
}

function StatusBadge({ status, compact = false }: { status: MetadataStatus; compact?: boolean }) {
  const styles = status === "confirmed"
    ? "border-step-success/25 bg-step-success/10 text-step-success"
    : status === "provisional"
      ? "border-step-warning/25 bg-step-warning/10 text-step-warning"
      : "border-step-error/25 bg-step-error/10 text-step-error";
  return (
    <span className={[
      "inline-flex rounded-full border font-semibold uppercase tracking-wide",
      compact ? "px-1.5 py-0.5 text-[8px]" : "px-2.5 py-1 text-[9px]",
      styles,
    ].join(" ")}>
      {status[0]?.toUpperCase()}{status.slice(1)}
    </span>
  );
}

function MetadataEvidence({ evidence }: { evidence: EnergyProjectAnalysisMetadataEvidenceDto[] }) {
  return (
    <details className="mt-6 border-t border-border pt-4">
      <summary className="cursor-pointer text-xs font-semibold text-primary">
        Metadata Evidence ({evidence.length})
      </summary>
      {evidence.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {evidence.map((item) => (
            <li key={`${item.scopeId}:${item.dimension}:${item.metadataRevisionId}`} className="rounded-md bg-surface-subtle px-3 py-2 text-[11px] leading-5 text-muted">
              <span className="font-semibold text-foreground">{item.scopeName} · {item.dimension === "area" ? "Area" : "Headcount"}</span>
              {` · ${item.value === null ? "Unavailable" : formatNumber(item.value)} · ${statusLabel(item.status)} · `}
              <code className="text-[10px] text-muted-light">{item.metadataRevisionId}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-muted">No metadata revision applies to the selected Scope. Follow the completion guidance above.</p>
      )}
    </details>
  );
}

function uniqueGuidance(scope: EnergyProjectAnalysisScopeMetadataDto): string[] {
  const results = [
    scope.area,
    scope.headcount,
    scope.normalisations.eui,
    scope.normalisations.perPax,
  ];
  return [...new Set(results.flatMap((result) => result.status === "missing" ? [result.guidance] : []))];
}

function formatMetric(result: EnergyScopeMetadataValueDto | EnergyNormalisedMetricDto): string {
  if (result.status === "missing") return "Unavailable";
  return `${formatNumber(result.value)} ${formatUnit(result.unit)}`;
}

function formatUnit(unit: EnergyScopeMetadataValueDto["unit"] | EnergyNormalisedMetricDto["unit"]): string {
  return unit === "m2" ? "m²" : unit;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(value);
}

function statusLabel(status: MetadataStatus): string {
  return `${status[0]?.toUpperCase()}${status.slice(1)}`;
}

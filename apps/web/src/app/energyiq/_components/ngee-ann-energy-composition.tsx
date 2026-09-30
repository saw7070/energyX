import React, { useEffect, useState } from "react";

import type { NgeeAnnEnergyCompositionViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnEnergyComposition({
  view,
  category = "all",
  onCategoryChange,
}: {
  view: NgeeAnnEnergyCompositionViewModel;
  category?: "all" | "load" | "light";
  onCategoryChange?: (category: "all" | "load" | "light") => void;
}) {
  const [selectedLevelId, setSelectedLevelId] = useState("all");
  const [selectedCategoryId, setSelectedCategoryId] = useState<"all" | "load" | "light">(category);
  const [showAllCircuits, setShowAllCircuits] = useState(false);
  const [accountingExpanded, setAccountingExpanded] = useState(false);
  const [derivedExpanded, setDerivedExpanded] = useState(false);
  const levelOptions = uniqueCircuitOptions(
    view.circuits.rows.map((row) => ({ id: row.levelId, label: row.levelName })),
  );
  const categoryOptions = uniqueCircuitOptions(
    view.circuits.rows.map((row) => ({ id: row.categoryId, label: row.category })),
  );
  const matchingCircuits = view.circuits.rows.filter((row) =>
    (selectedLevelId === "all" || row.levelId === selectedLevelId)
    && (selectedCategoryId === "all" || row.categoryId === selectedCategoryId),
  );
  const visibleCircuits = showAllCircuits ? matchingCircuits : matchingCircuits.slice(0, 5);

  useEffect(() => {
    setSelectedCategoryId(category);
  }, [category]);

  const selectLevel = (levelId: string) => {
    setSelectedLevelId(() => levelId);
    setShowAllCircuits(() => false);
  };
  const selectCategory = (categoryId: string) => {
    if (categoryId === "all" || categoryId === "load" || categoryId === "light") {
      setSelectedCategoryId(categoryId);
      onCategoryChange?.(categoryId);
    }
    setShowAllCircuits(() => false);
  };
  const toggleAccounting = () => {
    setAccountingExpanded((expanded) => {
      if (expanded) setDerivedExpanded(false);
      return !expanded;
    });
  };

  return (
    <section aria-labelledby="ngee-ann-energy-composition" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="ngee-ann-energy-composition" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Energy composition
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="max-w-md text-xs leading-5 text-muted">
          Start with the split, then inspect the largest component Circuits.
        </p>
      </div>

      <div className="mt-5">
        <h4 className="text-sm font-semibold text-foreground">Where the energy went</h4>
        <p className="mt-1 text-xs leading-5 text-muted">
          Load and lighting split the same official Project total.
        </p>
        {view.categories.status === "unavailable" ? (
          <Unavailable title="Category comparison unavailable" reason={view.categories.reason} />
        ) : (
          <>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
              <p className="text-xs font-semibold text-foreground">Current concentration by Category</p>
              {view.categories.summary.currentConcentration.status === "available" ? (
                <p className="mt-1 text-sm leading-6 text-muted">
                  <span className="font-semibold text-foreground">{view.categories.summary.currentConcentration.name}</span> uses {view.categories.summary.currentConcentration.currentUsageKwh} kWh ({view.categories.summary.currentConcentration.projectShare} of Project energy).
                </p>
              ) : <p className="mt-1 text-sm text-muted">{view.categories.summary.currentConcentration.reason}</p>}
            </div>
            <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
              <p className="text-xs font-semibold text-foreground">Largest measured Category movement</p>
              {view.categories.summary.measuredChange.status === "available" ? (
                <p className="mt-1 text-sm leading-6 text-muted">
                  <span className="font-semibold text-foreground">{view.categories.summary.measuredChange.name}</span> changed {view.categories.summary.measuredChange.changeKwh} ({view.categories.summary.measuredChange.changePct}) versus the previous window.
                </p>
              ) : (
                <p className="mt-1 text-sm leading-6 text-muted"><span className="font-semibold text-foreground">Measured Category movement unavailable.</span> {view.categories.summary.measuredChange.reason}</p>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Level and Category are separate views; their overlap and cause are not established here.</p>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {view.categories.rows.map((row) => (
              <article key={row.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(220px,1fr)_180px_200px] lg:items-center lg:gap-7">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-4">
                    <h5 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${categoryColour(row.id)}`} />
                      {row.name}
                    </h5>
                    <span className="text-xs font-semibold tabular-nums text-muted">{row.projectShare}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                    <div className={`h-full rounded-full ${categoryColour(row.id)}`} style={{ width: row.projectShare }} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted">Current window</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em] text-foreground">
                    {row.currentUsageKwh} <span className="text-xs font-medium tracking-normal text-muted">kWh</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Versus previous window</p>
                  {row.movement.status === "available" ? (
                    <>
                      <p className={`mt-1 text-base font-semibold tabular-nums ${changeTone(row.changePct)}`}>{row.changePct}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted">{row.changeKwh}</p>
                    </>
                  ) : <p className="mt-1 text-xs font-semibold text-muted">Movement unavailable</p>}
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Comparison details</summary>
                    <dl className="mt-2 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                      <dt>Previous</dt><dd className="tabular-nums text-foreground">{row.movement.status === "available" ? `${row.previousUsageKwh} kWh` : row.movement.reason}</dd>
                      <dt>Coverage</dt><dd className="text-foreground">{row.quality.coverage}</dd>
                      <dt>Intervals</dt><dd className="text-foreground">{row.quality.intervals} valid</dd>
                      <dt>Quality</dt><dd className="text-foreground">{row.quality.qualityEvents}</dd>
                      <dt>Exact values</dt><dd className="tabular-nums text-foreground">Current {row.exact.currentUsageKwh} kWh · share {row.exact.projectShare}{row.movement.status === "available" ? ` · previous ${row.exact.previousUsageKwh} kWh · change ${row.exact.changeKwh} (${row.exact.changePct})` : " · movement unavailable"}</dd>
                    </dl>
                  </details>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {showAllCircuits ? "All available component Circuits" : "Largest component Circuits"}
            </h4>
            <p className="mt-1 text-xs leading-5 text-muted">
              Ranked by current usage only. This is not an anomaly, priority or savings ranking.
            </p>
          </div>
          <span className="text-xs font-medium text-muted">Share of official Project total</span>
        </div>
        {view.circuits.status === "unavailable" ? (
          <Unavailable title="Component Circuit ranking unavailable" reason={view.circuits.reason} />
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row">
                <CircuitFilter
                  label="Filter component Circuits by Level"
                  options={levelOptions}
                  selectedId={selectedLevelId}
                  onSelect={selectLevel}
                />
                <CircuitFilter
                  label="Filter component Circuits by Category"
                  options={categoryOptions}
                  selectedId={selectedCategoryId}
                  onSelect={selectCategory}
                />
              </div>
              <div className="flex min-h-10 flex-wrap items-center gap-3">
                <p className="text-[11px] text-muted" aria-live="polite" aria-atomic="true">
                  Showing {visibleCircuits.length} of {matchingCircuits.length} matching component Circuits.
                </p>
                {matchingCircuits.length > 5 ? (
                  <button
                    type="button"
                    className="min-h-10 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    aria-expanded={showAllCircuits}
                    aria-controls="ngee-ann-component-circuit-rows"
                    onClick={() => setShowAllCircuits((expanded) => !expanded)}
                  >
                    {showAllCircuits
                      ? "Show Top 5 Circuits"
                      : `Show all ${matchingCircuits.length} Circuits`}
                  </button>
                ) : null}
              </div>
            </div>
            {matchingCircuits.length === 0 ? (
              <Unavailable
                title="No component Circuits match these filters"
                reason="Choose All or another Level and Category combination to restore the Snapshot rows."
              />
            ) : (
              <div id="ngee-ann-component-circuit-rows" className="mt-3 divide-y divide-border border-y border-border">
                {visibleCircuits.map((row) => (
                  <article
                    key={row.meterNodeId}
                    data-circuit-row
                    data-level-id={row.levelId}
                    data-category-id={row.categoryId}
                    className="py-4"
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_180px_200px] lg:items-center lg:gap-7">
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h5 className="truncate text-sm font-semibold text-foreground">{row.rank}. {row.name}</h5>
                            <p className="mt-1 text-xs text-muted">{row.levelName} · {row.category}</p>
                          </div>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">{row.projectShare}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                          <div className={`h-full rounded-full ${categoryColour(row.categoryId)}`} style={{ width: row.projectShare }} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Current window</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums tracking-[-0.015em] text-foreground">
                          {row.currentUsageKwh} <span className="text-xs font-medium tracking-normal text-muted">kWh</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Versus previous window</p>
                        {row.movement.status === "available" ? (
                          <>
                            <p className={`mt-1 text-sm font-semibold tabular-nums ${changeTone(row.changePct)}`}>{row.changePct}</p>
                            <p className="mt-0.5 text-xs tabular-nums text-muted">{row.changeKwh}</p>
                          </>
                        ) : <p className="mt-1 text-xs font-semibold text-muted">Circuit movement unavailable</p>}
                      </div>
                    </div>
                    <details className="mt-3 text-xs text-muted">
                      <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                        Circuit details and Evidence
                      </summary>
                      <div className="mt-2 grid gap-4 lg:grid-cols-2">
                        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                          <dt>Previous</dt><dd className="tabular-nums text-foreground">{row.movement.status === "available" ? `${row.previousUsageKwh} kWh` : row.movement.reason}</dd>
                          <dt>Coverage</dt><dd className="text-foreground">{row.quality.coverage}</dd>
                          <dt>Intervals</dt><dd className="text-foreground">{row.quality.intervals} valid</dd>
                          <dt>Quality</dt><dd className="text-foreground">{row.quality.qualityEvents}</dd>
                          <dt>Accounting</dt><dd className="text-foreground">Explanatory only</dd>
                          <dt>Exact values</dt><dd className="tabular-nums text-foreground">Current {row.exact.currentUsageKwh} kWh · share {row.exact.projectShare}{row.movement.status === "available" ? ` · previous ${row.exact.previousUsageKwh} kWh · change ${row.exact.changeKwh} (${row.exact.changePct})` : " · movement unavailable"}</dd>
                        </dl>
                        <CircuitEvidenceDetails row={row} evidence={view.evidence} />
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h4>
          <button
            id="ngee-ann-accounting-trace-trigger"
            type="button"
            className="flex min-h-10 w-full items-center justify-between gap-4 text-left text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-expanded={accountingExpanded}
            aria-controls="ngee-ann-accounting-trace-panel"
            onClick={toggleAccounting}
          >
            <span>Accounting trace</span>
            <span className="text-[10px] font-semibold text-muted">{accountingExpanded ? "Hide" : "Show"}</span>
          </button>
        </h4>
        <div
          id="ngee-ann-accounting-trace-panel"
          role="region"
          aria-labelledby="ngee-ann-accounting-trace-trigger"
          hidden={!accountingExpanded}
        >
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Four designated totals form the official Project route. Component Circuits remain outside this addition.
          </p>
          {view.accounting.status === "unavailable" || !view.accounting.reconciliation ? (
            <Unavailable title="Accounting trace unavailable" reason={view.accounting.reason} />
          ) : (
            <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <caption className="sr-only">Designated totals included in the official Project total</caption>
                <thead className="border-y border-border bg-surface-subtle text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">Designated total</th>
                    <th scope="col" className="px-3 py-2.5">Level</th>
                    <th scope="col" className="px-3 py-2.5">Category</th>
                    <th scope="col" className="px-3 py-2.5">Current</th>
                    <th scope="col" className="px-3 py-2.5">Official route</th>
                    <th scope="col" className="px-3 py-2.5">Data quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {view.accounting.designatedTotals.map((row) => (
                    <tr key={row.meterNodeId}>
                      <th scope="row" className="px-3 py-3.5 align-top">
                        <p className="text-xs font-semibold text-foreground">{row.name}</p>
                        <p className="mt-1 break-all font-mono text-[10px] font-normal text-muted">{row.scopeId}</p>
                      </th>
                      <td className="px-3 py-3.5 align-top text-xs text-foreground">{row.levelName}</td>
                      <td className="px-3 py-3.5 align-top text-xs text-foreground">{row.category}</td>
                      <td className="px-3 py-3.5 align-top text-xs font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</td>
                      <td className="px-3 py-3.5 align-top text-[10px] font-semibold text-foreground">Included once</td>
                      <td className="px-3 py-3.5 align-top"><Quality quality={row.quality} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 bg-surface-subtle px-4 py-3" role="note">
              <p className="text-xs font-semibold leading-5 text-foreground">
                Component Circuits explain {view.accounting.reconciliation.componentUsageKwh} kWh of {view.accounting.reconciliation.officialUsageKwh} kWh ({view.accounting.reconciliation.ratioPct}).
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                The {view.accounting.reconciliation.gapKwh} kWh difference remains outside the component breakdown; it is not classified here as an anomaly, missing data or savings.
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {view.accounting.reconciliation.componentMeterCount} component meters reconciled against {view.accounting.reconciliation.officialMeterCount} designated totals.
              </p>
              <p className="mt-1 text-[10px] text-muted">
                Designated rows are rounded for display; the server-reconciled official total is authoritative.
              </p>
            </div>
            </>
          )}
          <DerivedMeterTrace
            view={view}
            expanded={derivedExpanded}
            onToggle={() => setDerivedExpanded((expanded) => !expanded)}
          />
        </div>
      </div>

      <details className="mt-5 border-t border-border pt-3 text-[10px] leading-4 text-muted">
        <summary className="cursor-pointer text-[10px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Composition evidence · {view.evidence.queryIds.length} shared queries
        </summary>
        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[80px_minmax(0,1fr)]">
          <dt className="text-muted">Snapshot</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
          <dt className="text-muted">Release</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
          <dt className="text-muted">Mapping</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.meterMappingRevisionId}</dd>
          <dt className="text-muted">Formula</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.meterFormulaRevisionId}</dd>
          <dt className="text-muted">Period / unit</dt>
          <dd className="break-words text-foreground">{view.evidence.period} · {view.evidence.unit}</dd>
          <dt className="text-muted">Queries</dt>
          <dd className="break-words text-foreground">{view.evidence.queryIds.join(", ")}</dd>
        </dl>
      </details>
    </section>
  );
}

function CircuitFilter({
  label,
  options,
  selectedId,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {[{ id: "all", label: "All" }, ...options].map((option) => {
          const selected = selectedId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={selected
                ? "min-h-10 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                : "min-h-10 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"}
              aria-pressed={selected}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function uniqueCircuitOptions(options: Array<{ id: string; label: string }>) {
  const unique = new Map<string, string>();
  for (const option of options) {
    if (!unique.has(option.id)) {
      unique.set(option.id, option.label);
    }
  }
  return [...unique].map(([id, label]) => ({ id, label }));
}

function categoryColour(categoryId: string): string {
  if (categoryId.toLocaleLowerCase() === "load") return "bg-violet-600";
  if (categoryId.toLocaleLowerCase() === "light") return "bg-amber-600";
  return "bg-primary";
}

function changeTone(changePct: string): string {
  if (changePct.startsWith("+")) return "text-step-warning";
  if (changePct.startsWith("-")) return "text-teal-700";
  return "text-foreground";
}

function DerivedMeterTrace({
  view,
  expanded,
  onToggle,
}: {
  view: NgeeAnnEnergyCompositionViewModel;
  expanded: boolean;
  onToggle: () => void;
}) {
  const trace = view.derivedMeterTrace;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h5>
        <button
          id="ngee-ann-derived-meter-trace-trigger"
          type="button"
          className="flex min-h-10 w-full items-center justify-between gap-4 text-left text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-expanded={expanded}
          aria-controls="ngee-ann-derived-meter-trace-panel"
          onClick={onToggle}
        >
          <span>Derived meter trace</span>
          <span className="text-[10px] font-semibold text-muted">{expanded ? "Hide" : "Show"}</span>
        </button>
      </h5>
      <div
        id="ngee-ann-derived-meter-trace-panel"
        role="region"
        aria-labelledby="ngee-ann-derived-meter-trace-trigger"
        hidden={!expanded}
      >
        <p className="mt-1 text-[11px] leading-5 text-muted">
          Server-provided term values explain the derived result; this view does not recalculate it.
        </p>

        {trace.status === "unavailable" ? (
          <Unavailable title="Derived meter trace unavailable" reason={trace.reason} />
        ) : trace.status === "partial" ? (
          <div className="mt-3 bg-surface-subtle px-4 py-3" role="status">
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <p className="min-w-0 break-words text-xs font-semibold text-foreground">
                {trace.name} / {trace.scopeName} / {trace.meterKind}
              </p>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Partial</span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">{trace.reason}</p>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Affected inputs</p>
            <ul className="mt-1 space-y-1">
              {trace.impactedInputs.map((input) => (
                <li key={input.meterNodeId} className="min-w-0 text-[11px] leading-5 text-foreground">
                  <span className="font-semibold">{input.name}</span>
                  <span className="ml-2 break-all font-mono text-[10px] text-muted">{input.meterNodeId}</span>
                </li>
              ))}
            </ul>
            <DerivedTraceBoundaryCopy />
          </div>
        ) : (
          <div className="mt-3">
            <div className="flex min-w-0 flex-col gap-2 bg-surface-subtle px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="break-words text-xs font-semibold text-foreground">
                  {trace.name} / {trace.scopeName} / {trace.meterKind}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted">{trace.meterNodeId}</p>
              </div>
              <p className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                Result {trace.resultUsageKwh} kWh
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <caption className="sr-only">Physical meter terms supplied for the Load 12 derived result</caption>
                <thead className="border-y border-border text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">Physical meter</th>
                    <th scope="col" className="px-3 py-2.5">Server trace</th>
                    <th scope="col" className="px-3 py-2.5">Data quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {trace.terms.map((term) => (
                    <tr key={term.meterNodeId}>
                      <th scope="row" className="max-w-[360px] px-3 py-3 align-top">
                        <p className="break-words text-xs font-semibold text-foreground">{term.name}</p>
                        <p className="mt-1 break-all font-mono text-[10px] font-normal text-muted">{term.meterNodeId}</p>
                      </th>
                      <td className="px-3 py-3 align-top text-xs font-semibold tabular-nums text-foreground">
                        {term.coefficient} × {term.inputUsageKwh} kWh = {term.contributionKwh} kWh
                      </td>
                      <td className="px-3 py-3 align-top"><Quality quality={term.quality} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DerivedTraceBoundaryCopy />
          </div>
        )}
      </div>
    </div>
  );
}

function DerivedTraceBoundaryCopy() {
  return (
    <div className="mt-3 text-[10px] leading-4 text-muted">
      <p className="font-semibold text-foreground">Load 12 is not added separately to the official Project total.</p>
      <p className="mt-1">Evidence uses the same Snapshot, Release, Mapping revision, Formula revision, Period, unit and query ids listed below.</p>
    </div>
  );
}

function Quality({
  quality,
}: {
  quality: { coverage: string; intervals: string; qualityEvents: string };
}) {
  return (
    <>
      <p className="text-xs font-semibold text-foreground">{quality.coverage}</p>
      <p className="mt-1 text-[10px] text-muted">{quality.intervals} valid / {quality.qualityEvents}</p>
    </>
  );
}

function Unavailable({ title, reason }: { title: string; reason: string | null }) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{reason}</p>
    </div>
  );
}

function CircuitEvidenceDetails({
  row,
  evidence,
}: {
  row: NgeeAnnEnergyCompositionViewModel["circuits"]["rows"][number];
  evidence: NgeeAnnEnergyCompositionViewModel["evidence"];
}) {
  return (
      <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt>Meter point</dt><dd className="break-all font-mono text-foreground">{row.meterNodeId}</dd>
        <dt>Scope</dt><dd className="break-all font-mono text-foreground">{row.scopeId}</dd>
        <dt>Parent</dt><dd className="break-all font-mono text-foreground">{row.parentScopeId}</dd>
        <dt>Category</dt><dd className="text-foreground">{row.category}</dd>
        <dt>Official</dt><dd className="text-foreground">No · explanatory component</dd>
        <dt>Period</dt><dd className="break-words text-foreground">{evidence.period}</dd>
        <dt>Unit</dt><dd className="text-foreground">{evidence.unit}</dd>
        <dt>Quality</dt><dd className="text-foreground">{row.quality.coverage}; {row.quality.intervals} valid; {row.quality.qualityEvents}</dd>
        <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{evidence.snapshotId}</dd>
      </dl>
  );
}

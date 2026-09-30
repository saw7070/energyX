import React, { useState } from "react";

import type { NgeeAnnComponentCategoryBreakdownViewModel } from "./ngee-ann-overview-view-model";

type BreakdownScope = NgeeAnnComponentCategoryBreakdownViewModel["scopes"][number];
type BreakdownRow = BreakdownScope["rows"][number];

export function NgeeAnnConsumptionBreakdown({
  view,
}: {
  view: NgeeAnnComponentCategoryBreakdownViewModel;
}) {
  const [filterMode, setFilterMode] = useState<"tag" | "space">("tag");
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [selectedScopeId, setSelectedScopeId] = useState(view.scopes[0]?.id ?? "");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  if (view.status === "unavailable") {
    return <Unavailable title="Consumption Breakdown unavailable" reason={view.reason} />;
  }
  const projectScope = view.scopes[0]!;
  const selectedScope = filterMode === "tag"
    ? projectScope
    : view.scopes.find((scope) => scope.id === selectedScopeId) ?? projectScope;
  const activeRow = selectedScope.rows.find((row) => row.id === activeRowId) ?? null;

  return (
    <section aria-labelledby="ngee-ann-consumption-breakdown" className="border-b border-border px-5 py-6 lg:px-7 lg:py-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 id="ngee-ann-consumption-breakdown" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Consumption Breakdown
          </h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
            Daily published component Circuit usage by Category, with release-pinned estimated cost from the official Scope total.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
          <label className="grid gap-1.5 text-xs font-semibold text-muted">
            Breakdown filter
            <select
              aria-label="Consumption Breakdown filter type"
              value={filterMode}
              onChange={(event) => {
                setFilterMode(event.target.value === "space" ? "space" : "tag");
                setActiveRowId(null);
              }}
              className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <option value="tag">Filter by Category</option>
              <option value="space">Filter by Scope</option>
            </select>
          </label>
          {filterMode === "tag" ? (
            <label className="grid gap-1.5 text-xs font-semibold text-muted">
              Component Category
              <select
                aria-label="Consumption Breakdown Category"
                value={selectedCategoryId}
                onChange={(event) => {
                  setSelectedCategoryId(event.target.value);
                  setActiveRowId(null);
                }}
                className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                <option value="all">All component Categories</option>
                {view.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
              </select>
            </label>
          ) : (
            <label className="grid gap-1.5 text-xs font-semibold text-muted">
              Scope
              <select
                aria-label="Consumption Breakdown Scope"
                value={selectedScope.id}
                onChange={(event) => {
                  setSelectedScopeId(event.target.value);
                  setActiveRowId(null);
                }}
                className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                {view.scopes.map((scope, index) => (
                  <option key={scope.id} value={scope.id}>{index === 0 ? "All spaces" : scope.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {view.status === "partial" ? (
        <div className="mt-5 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3" role="status">
          <p className="text-sm font-semibold text-foreground">Partial component data</p>
          <p className="mt-1 text-xs leading-5 text-muted">{view.reason} Daily rows remain visible with their own data-health state.</p>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted" aria-label="Consumption Breakdown legend">
        {(selectedCategoryId === "all" || filterMode === "space" ? view.categories : view.categories.filter((category) => category.id === selectedCategoryId)).map((category) => (
          <span key={category.id} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: categoryColour(category.id) }} />
            {category.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-0 w-5 border-t-2 border-dashed border-foreground" />
          Estimated cost from official total
        </span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-surface-subtle" />Weekend</span>
      </div>

      <DailyComponentChart
        scope={selectedScope}
        selectedCategoryId={filterMode === "tag" ? selectedCategoryId : "all"}
        activeRow={activeRow}
        onActiveRowChange={setActiveRowId}
      />

      {selectedScope.period.status === "complete" ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 text-xs leading-5 text-muted sm:grid-cols-3">
          <p><span className="font-semibold text-foreground">Component subtotal:</span> {selectedScope.period.componentUsageKwh} kWh.</p>
          <p><span className="font-semibold text-foreground">Official Scope total:</span> {selectedScope.period.officialUsageKwh} kWh.</p>
          <p><span className="font-semibold text-foreground">Coverage ratio:</span> {selectedScope.period.ratioPct}; gap {selectedScope.period.gapKwh} kWh.</p>
        </div>
      ) : (
        <div className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted" role="status">
          <span className="font-semibold text-foreground">Period totals withheld.</span> {selectedScope.period.reason}
        </div>
      )}
    </section>
  );
}

function DailyComponentChart({
  scope,
  selectedCategoryId,
  activeRow,
  onActiveRowChange,
}: {
  scope: BreakdownScope;
  selectedCategoryId: string;
  activeRow: BreakdownRow | null;
  onActiveRowChange: (id: string | null) => void;
}) {
  const width = 960;
  const height = 330;
  const margin = { top: 28, right: 54, bottom: 46, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const visibleRows = scope.rows;
  const availableEnergyValues = visibleRows.flatMap((row) => {
    const value = selectedCategoryId === "all"
      ? row.componentUsageKwhValue
      : row.categories.find((category) => category.id === selectedCategoryId)?.usageKwhValue ?? null;
    return value === null ? [] : [value];
  });
  const maxEnergy = Math.max(1, ...availableEnergyValues);
  const availableCosts = visibleRows.flatMap((row) => row.estimatedCost.status === "available"
    ? [row.estimatedCost.amountValue]
    : []);
  const maxCost = Math.max(1, ...availableCosts);
  const slotWidth = plotWidth / Math.max(visibleRows.length, 1);
  const barWidth = Math.max(4, Math.min(24, slotWidth * 0.64));
  const costPoints = visibleRows.flatMap((row, index) => row.estimatedCost.status === "available" ? [{
    x: margin.left + slotWidth * index + slotWidth / 2,
    y: margin.top + plotHeight - row.estimatedCost.amountValue / maxCost * plotHeight,
  }] : []);
  const costPath = costPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const tickStep = Math.max(1, Math.ceil(visibleRows.length / 8));

  return (
    <div className="relative mt-4 rounded-xl border border-border bg-surface px-2 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2 text-xs text-muted">
        <span>Daily component usage · kWh</span>
        <span>{scope.name} · focus or hover a day for exact values</span>
      </div>
      <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`component-chart-title-${scope.id} component-chart-desc-${scope.id}`}>
        <title id={`component-chart-title-${scope.id}`}>{`Daily component Category usage for ${scope.name}`}</title>
        <desc id={`component-chart-desc-${scope.id}`}>Stacked component Circuit Category usage by day. A dashed line shows release-pinned estimated cost based on the official Scope total.</desc>
        {[0, 0.5, 1].map((ratio) => {
          const y = margin.top + plotHeight * (1 - ratio);
          return <g key={ratio}>
            <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{(maxEnergy * ratio).toFixed(0)}</text>
          </g>;
        })}
        {visibleRows.map((row, index) => {
          const x = margin.left + slotWidth * index + (slotWidth - barWidth) / 2;
          const categories = selectedCategoryId === "all"
            ? row.categories
            : row.categories.filter((category) => category.id === selectedCategoryId);
          let stackedHeight = 0;
          const ariaValues = categories.map((category) => `${category.label} ${category.usageKwh} kWh`).join(", ");
          return (
            <g
              key={row.id}
              tabIndex={0}
              role="img"
              aria-label={`${row.dateLabel}, ${row.dayTypeLabel}: ${ariaValues}; component subtotal ${row.componentUsageKwh} kWh; official total ${row.officialUsageKwh} kWh; estimated cost ${row.estimatedCost.status === "available" ? row.estimatedCost.amount : "unavailable"}; ${row.dataStatus}, ${row.coverage} coverage.`}
              className="outline-none focus-visible:[filter:drop-shadow(0_0_3px_var(--primary))]"
              onMouseEnter={() => onActiveRowChange(row.id)}
              onMouseLeave={() => onActiveRowChange(null)}
              onFocus={() => onActiveRowChange(row.id)}
              onBlur={() => onActiveRowChange(null)}
            >
              {row.dayType === "weekend" || row.dayType === "public_holiday" ? (
                <rect x={margin.left + slotWidth * index} y={margin.top} width={slotWidth} height={plotHeight} fill="var(--surface-subtle)" />
              ) : null}
              {categories.flatMap((category) => {
                if (category.usageKwhValue === null) return [];
                const value = category.usageKwhValue;
                const segmentHeight = value / maxEnergy * plotHeight;
                stackedHeight += segmentHeight;
                return [(
                  <rect
                    key={category.id}
                    x={x}
                    y={margin.top + plotHeight - stackedHeight}
                    width={barWidth}
                    height={Math.max(0, segmentHeight)}
                    rx="2"
                    fill={categoryColour(category.id)}
                    opacity={row.dataStatus === "complete" ? 0.92 : 0.48}
                  />
                )];
              })}
              {(index % tickStep === 0 || index === visibleRows.length - 1) ? (
                <text x={x + barWidth / 2} y={height - 18} textAnchor="middle" fontSize="10" fill="var(--muted)">{row.dateLabel}</text>
              ) : null}
            </g>
          );
        })}
        {costPath ? <path d={costPath} fill="none" stroke="var(--foreground)" strokeWidth="2" strokeDasharray="5 4" /> : null}
        {costPoints.map((point, index) => <circle key={`${point.x}:${index}`} cx={point.x} cy={point.y} r="2.5" fill="var(--foreground)" />)}
        <text x={width - margin.right + 8} y={margin.top + 4} fontSize="10" fill="var(--muted)">Cost</text>
        <text x={width - margin.right + 8} y={margin.top + plotHeight} fontSize="10" fill="var(--muted)">S$0</text>
      </svg>
      {activeRow ? (
        <div className="pointer-events-none absolute right-4 top-14 z-10 max-w-[280px] rounded-lg border border-border bg-surface px-3 py-2 shadow-[var(--shadow-card)]" role="status">
          <p className="text-xs font-semibold text-foreground">{activeRow.dateLabel} · {activeRow.dayTypeLabel}</p>
          <div className="mt-1 space-y-0.5 text-[11px] leading-5 text-muted">
            {activeRow.categories.map((category) => <p key={category.id}>{category.label}: <span className="font-semibold tabular-nums text-foreground">{category.usageKwh} kWh</span></p>)}
            <p>Component subtotal: <span className="font-semibold tabular-nums text-foreground">{activeRow.componentUsageKwh} kWh</span></p>
            <p>Official total: <span className="font-semibold tabular-nums text-foreground">{activeRow.officialUsageKwh} kWh</span></p>
            <p>Estimated cost: <span className="font-semibold tabular-nums text-foreground">{activeRow.estimatedCost.status === "available" ? activeRow.estimatedCost.amount : "Unavailable"}</span></p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Unavailable({ title, reason }: { title: string; reason: string | null }) {
  return (
    <div className="border-b border-border px-5 py-6 lg:px-7" role="status">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{reason}</p>
    </div>
  );
}

export function ngeeAnnCategoryColour(categoryId: string): string {
  return categoryId === "light" ? "var(--step-query)" : "var(--step-transform)";
}

function categoryColour(categoryId: string): string {
  return ngeeAnnCategoryColour(categoryId);
}

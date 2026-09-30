import React, { useEffect, useMemo, useState } from "react";

import { ngeeAnnCategoryColour } from "./ngee-ann-consumption-breakdown";
import type { NgeeAnnComponentCategoryBreakdownViewModel } from "./ngee-ann-overview-view-model";

type DistributionCategory = {
  id: string;
  label: string;
  usageKwhValue: number;
  usageKwh: string;
  sharePctValue: number;
  sharePct: string;
};

export function NgeeAnnEnergyDistribution({
  view,
}: {
  view: NgeeAnnComponentCategoryBreakdownViewModel;
}) {
  const [selectedScopeId, setSelectedScopeId] = useState(view.scopes[0]?.id ?? "");
  const [range, setRange] = useState<"period" | "day">("period");
  const selectedScope = view.scopes.find((scope) => scope.id === selectedScopeId) ?? view.scopes[0];
  const [selectedDate, setSelectedDate] = useState(selectedScope?.rows.at(-1)?.localDate ?? "");
  const [selectedCategoryId, setSelectedCategoryId] = useState(view.categories[0]?.id ?? "");

  useEffect(() => {
    if (!selectedScope?.rows.some((row) => row.localDate === selectedDate)) {
      setSelectedDate(selectedScope?.rows.at(-1)?.localDate ?? "");
    }
  }, [selectedDate, selectedScope]);

  if (view.status !== "available" || !selectedScope) {
    return (
      <div className="border-b border-border px-5 py-6 lg:px-7" role="status">
        <h3 className="text-lg font-semibold text-foreground">
          Energy Distribution {view.status === "partial" ? "partial" : "unavailable"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted">{view.reason}</p>
        {view.status === "partial" ? (
          <p className="mt-1 text-xs leading-5 text-muted">Period composition is withheld because it would otherwise present an incomplete total as complete.</p>
        ) : null}
      </div>
    );
  }
  const selectedDay = selectedScope.rows.find((row) => row.localDate === selectedDate) ?? selectedScope.rows.at(-1)!;
  const series: DistributionCategory[] = range === "period"
    ? selectedScope.period.categories.flatMap((category) =>
      category.usageKwhValue === null || category.sharePctValue === null
        ? []
        : [{
          id: category.id,
          label: category.label,
          usageKwhValue: category.usageKwhValue,
          usageKwh: category.usageKwh,
          sharePctValue: category.sharePctValue,
          sharePct: category.sharePct,
        }])
    : selectedDay.categories.flatMap((category) => category.usageKwhValue === null || category.sharePctValue === null
      ? []
      : [{
        id: category.id,
        label: category.label,
        usageKwhValue: category.usageKwhValue,
        usageKwh: category.usageKwh,
        sharePctValue: category.sharePctValue,
        sharePct: category.sharePct,
      }]);
  const activeCategory = series.find((category) => category.id === selectedCategoryId) ?? series[0] ?? null;
  const ranking = view.rankings.find((candidate) =>
    candidate.scopeId === selectedScope.id && candidate.categoryId === activeCategory?.id,
  );

  return (
    <section aria-labelledby="ngee-ann-energy-distribution" className="border-b border-border px-5 py-6 lg:px-7 lg:py-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 id="ngee-ann-energy-distribution" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Energy Distribution
          </h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
            Explore the published component Circuit mix by Scope and period. Select a Category to see its Circuit ranking.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="grid min-w-44 gap-1.5 text-xs font-semibold text-muted">
            Space Filter
            <select
              aria-label="Energy Distribution Space Filter"
              value={selectedScope.id}
              onChange={(event) => {
                setSelectedScopeId(event.target.value);
                setRange("period");
              }}
              className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              {view.scopes.map((scope, index) => <option key={scope.id} value={scope.id}>{index === 0 ? "All spaces" : scope.name}</option>)}
            </select>
          </label>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">Range</p>
            <div className="inline-flex min-h-10 rounded-lg border border-border bg-surface p-1" aria-label="Energy Distribution Range">
              <button type="button" aria-pressed={range === "period"} className={rangeButtonClass(range === "period")} onClick={() => setRange("period")}>Selected period</button>
              <button type="button" aria-pressed={range === "day"} className={rangeButtonClass(range === "day")} onClick={() => setRange("day")}>Single day</button>
            </div>
          </div>
          {range === "day" ? (
            <label className="grid min-w-36 gap-1.5 text-xs font-semibold text-muted">
              Local date
              <select
                aria-label="Energy Distribution Local date"
                value={selectedDay.localDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                {selectedScope.rows.map((row) => <option key={row.id} value={row.localDate}>{row.dateLabel}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(360px,1.15fr)] xl:items-start">
        <div className="grid gap-5 sm:grid-cols-[280px_minmax(0,1fr)] sm:items-center xl:grid-cols-1">
          <DistributionDonut
            scopeName={selectedScope.name}
            rangeLabel={range === "period" ? "Selected period" : selectedDay.dateLabel}
            series={series}
            activeCategoryId={activeCategory?.id ?? null}
            onSelect={setSelectedCategoryId}
          />
          <div className="divide-y divide-border border-y border-border">
            {series.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={activeCategory?.id === category.id}
                className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25"
                onClick={() => setSelectedCategoryId(category.id)}
              >
                <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: ngeeAnnCategoryColour(category.id) }} />
                  <span className="truncate">{category.label}</span>
                </span>
                <span className="text-right text-xs tabular-nums text-muted">
                  <strong className="block text-sm text-foreground">{category.usageKwh} kWh</strong>
                  {category.sharePct}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-border bg-surface-subtle px-4 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Circuit ranking</p>
              <h4 className="mt-1 text-base font-semibold text-foreground">{activeCategory?.label ?? "Select a Category"}</h4>
            </div>
            <span className="text-xs text-muted">Current selected-period facts</span>
          </div>
          {range === "day" ? (
            <p className="mt-2 text-xs leading-5 text-muted">
              The donut reflects {selectedDay.dateLabel}; Circuit ranking remains the selected-period ranking because this Snapshot does not publish per-Circuit daily totals.
            </p>
          ) : null}
          {ranking && ranking.rows.length > 0 ? (
            <div className="mt-3 max-h-[340px] overflow-y-auto overscroll-contain border-y border-border pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" tabIndex={0} role="region" aria-label={`${activeCategory?.label ?? "Selected Category"} Circuit ranking for ${selectedScope.name}`}>
              {ranking.rows.map((row) => (
                <div key={row.meterNodeId} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0">
                  <span className="text-xs font-semibold tabular-nums text-muted">{row.rank}</span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">{row.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{row.levelName} · {row.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{row.usageKwh} kWh</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">{row.projectShare} of official Project</p>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-muted">Select a Category with published component Circuits to view its ranking.</p>}
        </div>
      </div>

      <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted">
        Distribution is based on published component Circuits, not the designated official total meters. {selectedScope.period.componentUsageKwh} kWh of components reconciles to {selectedScope.period.ratioPct} of the {selectedScope.period.officialUsageKwh} kWh official Scope total.
      </p>
    </section>
  );
}

function DistributionDonut({
  scopeName,
  rangeLabel,
  series,
  activeCategoryId,
  onSelect,
}: {
  scopeName: string;
  rangeLabel: string;
  series: DistributionCategory[];
  activeCategoryId: string | null;
  onSelect: (categoryId: string) => void;
}) {
  const segments = useMemo(() => {
    let startAngle = -90;
    return series.map((category) => {
      const endAngle = startAngle + category.sharePctValue / 100 * 360;
      const segment = { category, path: donutArcPath(140, 140, 104, 62, startAngle, endAngle) };
      startAngle = endAngle;
      return segment;
    });
  }, [series]);
  const active = series.find((category) => category.id === activeCategoryId) ?? series[0] ?? null;
  return (
    <svg className="mx-auto block h-auto w-full max-w-[320px]" viewBox="0 0 280 280" role="img" aria-labelledby="ngee-ann-distribution-title ngee-ann-distribution-desc">
      <title id="ngee-ann-distribution-title">{`Energy Distribution for ${scopeName}`}</title>
      <desc id="ngee-ann-distribution-desc">{rangeLabel}. Focus a segment to hear Category, energy and share.</desc>
      <text x="140" y="132" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted)">{active?.label ?? "No data"}</text>
      <text x="140" y="153" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--foreground)">{active ? `${active.usageKwh} kWh` : "Unavailable"}</text>
      <text x="140" y="173" textAnchor="middle" fontSize="12" fill="var(--muted)">{active?.sharePct ?? ""}</text>
      {segments.map(({ category, path }) => (
        <path
          key={category.id}
          d={path}
          fill={ngeeAnnCategoryColour(category.id)}
          opacity={active?.id === category.id ? 1 : 0.72}
          stroke="var(--surface)"
          strokeWidth="3"
          tabIndex={0}
          role="button"
          aria-label={`${category.label}, ${category.usageKwh} kWh, ${category.sharePct}`}
          aria-pressed={active?.id === category.id}
          className="cursor-pointer outline-none transition-opacity focus-visible:[filter:drop-shadow(0_0_4px_var(--primary))]"
          onClick={() => onSelect(category.id)}
          onFocus={() => onSelect(category.id)}
        />
      ))}
    </svg>
  );
}

function donutArcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const point = (radius: number, angle: number) => {
    const radians = angle * Math.PI / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  };
  const outerStart = point(outer, start);
  const outerEnd = point(outer, end);
  const innerEnd = point(inner, end);
  const innerStart = point(inner, start);
  const largeArc = end - start > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function rangeButtonClass(active: boolean): string {
  return [
    "min-h-8 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
    active ? "bg-foreground text-background" : "text-muted hover:bg-surface-subtle hover:text-foreground",
  ].join(" ");
}

"use client";

import React, { useState } from "react";

import type { NgeeAnnUsageHeatmapViewModel } from "./ngee-ann-overview-view-model";
import { filterClassName, TimeEvidence, TimeModuleUnavailable } from "./ngee-ann-day-profile";

type HeatmapCell = NgeeAnnUsageHeatmapViewModel["scopes"][number]["cells"][number];
type AverageProfile = NgeeAnnUsageHeatmapViewModel["averageProfiles"][number];
type CircuitProfile = NgeeAnnUsageHeatmapViewModel["circuitProfiles"][number];
type CircuitCell = CircuitProfile["circuits"][number]["values"][number] & {
  meterNodeId: string;
  circuitName: string;
  categoryLabel: string;
  levelScopeId: string;
  levelScopeName: string;
  dayTypeLabel: "Weekday" | "Weekend";
  sampleDayCount: number;
};

export function NgeeAnnUsageHeatmap({ view }: { view: NgeeAnnUsageHeatmapViewModel }) {
  const [viewMode, setViewMode] = useState<"date-hour" | "level-hour">(view.defaultView);
  const [selectedDateScopeId, setSelectedDateScopeId] = useState(view.scopes[0]?.id ?? "");
  const [selectedLevelScopeId, setSelectedLevelScopeId] = useState(view.circuitProfiles[0]?.levelScopeId ?? "");
  const [selectedDayType, setSelectedDayType] = useState<"weekday" | "weekend">("weekday");
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  if (view.status === "unavailable") {
    return (
      <TimeModuleUnavailable
        heading="Usage heatmap"
        headingId="ngee-ann-usage-heatmap"
        question={view.decisionQuestion}
        reason={view.reason}
      />
    );
  }

  const selectedScope = view.scopes.find((scope) => scope.id === selectedDateScopeId) ?? view.scopes[0]!;
  const dateRows = view.dates.map((date) => ({
      id: date.id,
      label: `${date.weekday} ${date.label}`,
      cells: selectedScope.cells.filter((cell) => cell.localDate === date.id),
    }));
  const selectedCircuitProfile = view.circuitProfiles.find((profile) => (
    profile.levelScopeId === selectedLevelScopeId && profile.dayType === selectedDayType
  )) ?? view.circuitProfiles.find((profile) => profile.dayType === selectedDayType) ?? null;
  const circuitRows = selectedCircuitProfile?.circuits.map((circuit) => ({
    id: circuit.meterNodeId,
    label: circuit.name,
    categoryLabel: circuit.categoryLabel,
    cells: circuit.values.map((value): CircuitCell => ({
      ...value,
      meterNodeId: circuit.meterNodeId,
      circuitName: circuit.name,
      categoryLabel: circuit.categoryLabel,
      levelScopeId: selectedCircuitProfile.levelScopeId,
      levelScopeName: selectedCircuitProfile.levelScopeName,
      dayTypeLabel: selectedCircuitProfile.dayTypeLabel,
      sampleDayCount: selectedCircuitProfile.sampleDayCount,
    })),
  })) ?? [];
  const dateCells = dateRows.flatMap((row) => row.cells);
  const circuitCells = circuitRows.flatMap((row) => row.cells);
  const visibleCells = viewMode === "date-hour" ? dateCells : circuitCells;
  const activeCell = viewMode === "date-hour"
    ? dateCells.find((cell) => cell.id === activeCellId)
      ?? dateCells.find((cell) => cell.id === selectedCellId)
      ?? null
    : null;
  const activeCircuitCell = viewMode === "level-hour"
    ? circuitCells.find((cell) => cell.id === activeCellId)
      ?? circuitCells.find((cell) => cell.id === selectedCellId)
      ?? null
    : null;
  let maximumUsageKwh = 0;
  for (const cell of visibleCells) {
    if (cell.acceptedUsageKwh !== null && cell.acceptedUsageKwh > maximumUsageKwh) {
      maximumUsageKwh = cell.acceptedUsageKwh;
    }
  }

  const resetCell = () => {
    setActiveCellId(null);
    setSelectedCellId(null);
  };

  return (
    <section aria-labelledby="ngee-ann-usage-heatmap" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Usage heatmap</p>
          <h3 id="ngee-ann-usage-heatmap" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Daily usage pattern by Level
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="text-xs leading-5 text-muted">
          {viewMode === "level-hour" ? "Server-provided complete-day means" : "Server hourly cells"} / {view.evidence.timezone} / {view.evidence.unit}
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-muted">Heatmap view</legend>
          <div className="flex flex-wrap gap-1.5">
            {(["date-hour", "level-hour"] as const).map((mode) => {
              const selected = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="ngee-ann-usage-heatmap-grid"
                  className={filterClassName(selected)}
                  onClick={() => {
                    setViewMode(mode);
                    resetCell();
                  }}
                >
                  {mode === "date-hour" ? "Date × hour" : "Level → Circuit"}
                </button>
              );
            })}
          </div>
        </fieldset>

        {viewMode === "date-hour" ? (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">Heatmap Level</legend>
            <div className="flex flex-wrap gap-1.5">
              {view.scopes.map((scope) => {
                const selected = scope.id === selectedScope.id;
                return (
                  <button
                    key={scope.id}
                    type="button"
                    aria-pressed={selected}
                    aria-controls="ngee-ann-usage-heatmap-grid"
                    className={filterClassName(selected)}
                    onClick={() => {
                      setSelectedDateScopeId(scope.id);
                      resetCell();
                    }}
                  >
                    {scope.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">Average day type</legend>
            <div className="flex flex-wrap gap-1.5">
              {(["weekday", "weekend"] as const).map((dayType) => {
                const selected = selectedDayType === dayType;
                return (
                  <button
                    key={dayType}
                    type="button"
                    aria-pressed={selected}
                    aria-controls="ngee-ann-usage-heatmap-grid"
                    className={filterClassName(selected)}
                    onClick={() => {
                      setSelectedDayType(dayType);
                      resetCell();
                    }}
                  >
                    {dayType === "weekday" ? "Weekday" : "Weekend"}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>

      <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start">
        <LevelProfileSummary
          profiles={view.averageProfiles.filter((candidate) => candidate.dayType === selectedDayType && candidate.scopeId !== view.scopes[0]?.id)}
          selectedScopeId={selectedLevelScopeId}
          onSelect={(scopeId) => {
            setSelectedLevelScopeId(scopeId);
            resetCell();
          }}
        />
        <div id="ngee-ann-usage-heatmap-grid" className="min-w-0 overflow-x-auto pb-1">
          <div className="min-w-[820px]">
          <div className="grid grid-cols-[112px_repeat(24,minmax(34px,1fr))] gap-1 text-[9px] text-muted">
            <span aria-hidden="true" />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="pb-1 text-center">{hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : ""}</span>
            ))}
            {viewMode === "date-hour"
              ? dateRows.map((row) => (
                <React.Fragment key={row.id}>
                  <span className="flex min-h-9 items-center pr-2 text-[10px] font-semibold text-foreground">{row.label}</span>
                  {row.cells.map((cell) => (
                    <HeatmapCellButton
                      key={cell.id}
                      cell={cell}
                      rowLabel={row.label}
                      maximumUsageKwh={maximumUsageKwh}
                      selected={selectedCellId === cell.id}
                      onActivate={setActiveCellId}
                      onSelect={setSelectedCellId}
                    />
                  ))}
                </React.Fragment>
              ))
              : circuitRows.map((row) => (
                <React.Fragment key={row.id}>
                  <span className={[
                    "flex min-h-9 flex-col justify-center rounded-l px-2 text-[10px] font-semibold text-foreground",
                    row.cells[0]?.levelScopeId === selectedLevelScopeId ? "bg-primary/10" : "",
                  ].join(" ")}><span>{row.label}</span><span className="font-normal text-muted">{row.categoryLabel}</span></span>
                  {row.cells.map((cell) => (
                    <CircuitHeatmapCellButton
                      key={cell.id}
                      cell={cell}
                      maximumUsageKwh={maximumUsageKwh}
                      selected={selectedCellId === cell.id}
                      onActivate={setActiveCellId}
                      onSelect={setSelectedCellId}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted">
        Darker Heatmap cells show higher accepted usage within the selected view; they do not by themselves prove an anomaly, waste or cause.
      </p>

      <div className="mt-4 min-h-[96px] rounded-lg bg-surface-subtle px-4 py-3" aria-live="polite" aria-atomic="true">
        {activeCircuitCell ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">
                {activeCircuitCell.levelScopeName} / {activeCircuitCell.circuitName} / {activeCircuitCell.dayTypeLabel} / {activeCircuitCell.hourLabel}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {activeCircuitCell.categoryLabel} · {activeCircuitCell.sampleDayCount} common complete-day samples / published component Circuit
              </p>
            </div>
            <p className="text-sm font-semibold tabular-nums text-foreground">{activeCircuitCell.usageKwh} kWh</p>
          </div>
        ) : activeCell ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {scopeNameForCell(view, activeCell)} / {activeCell.weekday} {activeCell.dateLabel} / {activeCell.hourLabel}
                </p>
                <p className="mt-1 text-[10px] text-muted">{activeCell.range}</p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {activeCell.usageKwh === null ? "No accepted facts" : `${activeCell.usageKwh} kWh`}
              </p>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {activeCell.quality.statusLabel} / {activeCell.quality.coverage} / {activeCell.quality.intervals} / {activeCell.quality.qualityEvents}
            </p>
          </>
        ) : (
          <p className="text-[11px] leading-5 text-muted">
            Hover or keyboard-focus a cell to inspect the {viewMode === "level-hour" ? "server-provided mean" : "same server fact"}. Press Enter or Space to keep its detail open.
          </p>
        )}
      </div>

      <TimeEvidence label="Heatmap evidence" evidence={view.evidence} />
      <TimeEvidence label="Circuit heatmap evidence" evidence={view.componentEvidence} />
    </section>
  );
}

function LevelProfileSummary({
  profiles,
  selectedScopeId,
  onSelect,
}: {
  profiles: NgeeAnnUsageHeatmapViewModel["averageProfiles"];
  selectedScopeId: string;
  onSelect: (scopeId: string) => void;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-subtle/55 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Level profile summary</p>
      <p className="mt-1 text-xs leading-5 text-muted">Select a Level to inspect its observed hourly pattern.</p>
      <div className="mt-3 divide-y divide-border border-y border-border">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            aria-pressed={selectedScopeId === profile.scopeId}
            className="grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
            onClick={() => onSelect(profile.scopeId)}
          >
            <span className="min-w-0">
              <strong className="block text-sm text-foreground">{profile.scopeName}</strong>
              <span className="mt-1 block text-xs text-muted">Peak {profile.peakHourLabel} · {profile.peakUsage} kWh</span>
            </span>
            <span className="text-right text-xs tabular-nums text-muted">
              <strong className="block text-sm text-foreground">{profile.dailyUsage}</strong>
              kWh/day
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted">Level totals remain official. The selected Level opens only server-published component Circuit rows; no sub-meter value is inferred in Web.</p>
    </div>
  );
}

function HeatmapCellButton({
  cell,
  rowLabel,
  maximumUsageKwh,
  selected,
  onActivate,
  onSelect,
}: {
  cell: HeatmapCell;
  rowLabel: string;
  maximumUsageKwh: number;
  selected: boolean;
  onActivate: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const intensity = cell.acceptedUsageKwh === null || maximumUsageKwh <= 0
    ? 0
    : 0.18 + (cell.acceptedUsageKwh / maximumUsageKwh) * 0.72;
  const label = cell.usageKwh === null ? "no accepted facts" : `${cell.usageKwh} kWh`;
  return (
    <button
      type="button"
      aria-label={`${rowLabel} / ${cell.weekday} ${cell.dateLabel} ${cell.hourLabel}: ${label}; ${cell.quality.statusLabel}; ${cell.quality.coverage}`}
      aria-pressed={selected}
      className={[
        "relative h-9 overflow-hidden rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        selected ? "ring-2 ring-primary/40" : "",
        cell.quality.status === "unavailable"
          ? "border-dashed border-border bg-surface-subtle"
          : cell.quality.status === "partial"
            ? "border-step-warning/40 bg-step-warning/30"
            : "border-primary/10 bg-surface",
      ].join(" ")}
      onMouseEnter={() => onActivate(cell.id)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(cell.id)}
      onBlur={() => onActivate(null)}
      onClick={() => onSelect(cell.id)}
    >
      {cell.quality.status === "complete" ? (
        <span className="absolute inset-0 bg-primary" style={{ opacity: intensity }} aria-hidden="true" />
      ) : null}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function CircuitHeatmapCellButton({
  cell,
  maximumUsageKwh,
  selected,
  onActivate,
  onSelect,
}: {
  cell: CircuitCell;
  maximumUsageKwh: number;
  selected: boolean;
  onActivate: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const intensity = maximumUsageKwh <= 0 ? 0 : 0.18 + cell.acceptedUsageKwh / maximumUsageKwh * 0.72;
  return (
    <button
      type="button"
      aria-label={`${cell.levelScopeName} / ${cell.circuitName} / ${cell.dayTypeLabel} ${cell.hourLabel}: mean ${cell.usageKwh} kWh across ${cell.sampleDayCount} common complete days`}
      aria-pressed={selected}
      className={[
        "relative h-9 overflow-hidden rounded border border-step-inspect/15 bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-step-inspect/50",
        selected ? "ring-2 ring-step-inspect/40" : "",
      ].join(" ")}
      onMouseEnter={() => onActivate(cell.id)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(cell.id)}
      onBlur={() => onActivate(null)}
      onClick={() => onSelect(cell.id)}
    >
      <span className="absolute inset-0 bg-step-inspect" style={{ opacity: intensity }} aria-hidden="true" />
      <span className="sr-only">Mean {cell.usageKwh} kWh</span>
    </button>
  );
}

function scopeNameForCell(view: NgeeAnnUsageHeatmapViewModel, cell: HeatmapCell): string {
  return view.scopes.find((scope) => scope.id === cell.scopeId)?.name ?? "Scope";
}

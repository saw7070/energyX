import { Fragment, useMemo, useState } from "react";
import {
  buildDeviceHourlyMatrix,
  computeHeatmapBounds,
  deltaPercentHeatColor,
  formatDeltaPercent,
  formatHeatmapHourHeader,
  HOUR_LABELS,
  usageHeatColor
} from "@/components/analysis/nap/napDeviceHeatmapUtils";
import { NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

type DetailViewMode = "overlay" | "selected" | "average";
type SpaceScope = "all" | "level6" | "level7";

interface NapAnomalyDeviceDetailPanelProps {
  data: NapEnergyAnalysisData;
  dateLabel: string;
  shortLabel: string;
  dayType: "weekday" | "weekend" | "holiday";
  referenceLabel: string;
  spaceScope: SpaceScope;
  detailMode: DetailViewMode;
  onDetailModeChange: (mode: DetailViewMode) => void;
}

export function NapAnomalyDeviceDetailPanel({
  data,
  dateLabel,
  shortLabel,
  dayType,
  referenceLabel,
  spaceScope,
  detailMode,
  onDetailModeChange
}: NapAnomalyDeviceDetailPanelProps) {
  const hourlyUnitLabel = "kWh/h";
  const [hoveredCell, setHoveredCell] = useState<{
    device: string;
    hour: string;
    display: string;
    x: number;
    y: number;
  } | null>(null);

  const matrixRows = useMemo(() => {
    const spikeProfiles = data.deviceHourlyByDate[dateLabel] ?? [];
    const averageProfiles = data.deviceHourlyProfilesByDayType[dayType] ?? [];
    return buildDeviceHourlyMatrix(spikeProfiles, averageProfiles, spaceScope);
  }, [data.deviceHourlyByDate, data.deviceHourlyProfilesByDayType, dateLabel, dayType, spaceScope]);

  const valueBounds = useMemo(() => {
    const values =
      detailMode === "average"
        ? matrixRows.flatMap((row) => row.averageHourly)
        : matrixRows.flatMap((row) => row.spikeHourly);
    return computeHeatmapBounds(values);
  }, [detailMode, matrixRows]);

  const deltaMaxAbs = useMemo(() => {
    const deltas = matrixRows
      .flatMap((row) => row.deltaPercentHourly)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (deltas.length === 0) {
      return 100;
    }
    const peak = Math.max(...deltas.map((value) => Math.abs(value)));
    return Math.max(50, Math.min(200, Math.ceil(peak / 10) * 10));
  }, [matrixRows]);

  const peakDeviation = useMemo(() => {
    let bestDevice = "";
    let bestHour = 0;
    let bestDelta = -Infinity;
    matrixRows.forEach((row) => {
      row.deltaPercentHourly.forEach((delta, hour) => {
        if (delta !== null && delta > bestDelta) {
          bestDelta = delta;
          bestDevice = row.shortName;
          bestHour = hour;
        }
      });
    });
    if (!bestDevice || !Number.isFinite(bestDelta)) {
      return null;
    }
    return {
      device: bestDevice,
      window: `${HOUR_LABELS[bestHour]}-${HOUR_LABELS[(bestHour + 1) % 24]}`,
      deltaPct: bestDelta
    };
  }, [matrixRows]);

  const modeOptions: Array<{ key: DetailViewMode; label: string }> = [
    { key: "overlay", label: "Overlay comparison" },
    { key: "selected", label: `${shortLabel} (spike)` },
    { key: "average", label: referenceLabel }
  ];

  function cellDisplay(mode: DetailViewMode, row: (typeof matrixRows)[number], hourIndex: number): string {
    if (mode === "overlay") {
      return formatDeltaPercent(row.deltaPercentHourly[hourIndex]);
    }
    const value = mode === "average" ? row.averageHourly[hourIndex] : row.spikeHourly[hourIndex];
    return value.toFixed(2);
  }

  function cellColor(mode: DetailViewMode, row: (typeof matrixRows)[number], hourIndex: number): string {
    if (mode === "overlay") {
      return deltaPercentHeatColor(row.deltaPercentHourly[hourIndex], deltaMaxAbs);
    }
    const value = mode === "average" ? row.averageHourly[hourIndex] : row.spikeHourly[hourIndex];
    return usageHeatColor(value, valueBounds.min, valueBounds.max);
  }

  function cellTooltip(mode: DetailViewMode, row: (typeof matrixRows)[number], hourIndex: number): string {
    const hour = HOUR_LABELS[hourIndex];
    const spike = row.spikeHourly[hourIndex];
    const average = row.averageHourly[hourIndex];
    const delta = row.deltaPercentHourly[hourIndex];
    if (mode === "overlay") {
      return `L${row.level} · ${row.device} · ${hour}\nSpike: ${spike.toFixed(2)} ${hourlyUnitLabel} · Avg: ${average.toFixed(2)} ${hourlyUnitLabel} · Δ ${formatDeltaPercent(delta)}`;
    }
    if (mode === "average") {
      return `L${row.level} · ${row.device} · ${hour}\n${referenceLabel}: ${average.toFixed(2)} ${hourlyUnitLabel}`;
    }
    return `L${row.level} · ${row.device} · ${hour}\n${shortLabel}: ${spike.toFixed(2)} ${hourlyUnitLabel}`;
  }

  function levelBadgeClass(level: 6 | 7): string {
    return level === 6
      ? "border-emerald-600/50 bg-emerald-950/60 text-emerald-300"
      : "border-blue-600/50 bg-blue-950/60 text-blue-300";
  }

  function renderDeviceLabel(row: (typeof matrixRows)[number]) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={`shrink-0 rounded border px-0.5 text-[7px] font-semibold leading-none ${levelBadgeClass(row.level)}`}
          title={`Level ${row.level}`}
        >
          L{row.level}
        </span>
        <span className="truncate">{row.shortName}</span>
      </div>
    );
  }

  return (
    <section className="rounded-md border border-shell-700 bg-shell-900 p-3">
      <h4 className="mb-2 text-xs font-semibold text-emerald-300">
        Sub-meter heatmap: {shortLabel} vs {referenceLabel}
      </h4>
      <div className="mb-2 inline-flex rounded border border-shell-600 bg-shell-800 p-1 text-xs">
        {modeOptions.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded px-2 py-1 ${detailMode === item.key ? "bg-emerald-700 text-white" : "text-slate-300"}`}
            onClick={() => onDetailModeChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-slate-400">
        {detailMode === "overlay" ? (
          <>
            Each cell: (spike − {referenceLabel.toLowerCase()}) / average as %. Grey = average is 0 at that hour.
            {peakDeviation ? (
              <>
                {" "}
                Largest deviation:{" "}
                <span className="text-rose-300">
                  {peakDeviation.device} at {peakDeviation.window} (+{Math.round(peakDeviation.deltaPct)}%)
                </span>
              </>
            ) : null}
          </>
        ) : detailMode === "selected" ? (
          <>Absolute hourly usage ({hourlyUnitLabel}) on the anomaly day, per sub-meter.</>
        ) : (
          <>
            Average hourly usage ({hourlyUnitLabel}) for {referenceLabel.toLowerCase()}, per sub-meter.
          </>
        )}
      </p>

      {matrixRows.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">No sub-meter hourly data for this date and scope.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-shell-700 bg-black/20 p-1.5">
          <div
            className="grid min-w-[920px] gap-px"
            style={{ gridTemplateColumns: "minmax(108px, 148px) repeat(24, minmax(32px, 1fr))" }}
          >
            <div className="sticky left-0 bg-shell-900 text-[9px] text-slate-500">
              Device
              {spaceScope === "all" ? (
                <span className="mt-0.5 block text-[8px] font-normal text-slate-600">L6 / L7 badge</span>
              ) : null}
            </div>
            {Array.from({ length: 24 }, (_, hourIndex) => (
              <div
                key={`header-${hourIndex}`}
                className="text-center text-[8px] leading-none text-slate-500"
                title={`${HOUR_LABELS[hourIndex]} – ${HOUR_LABELS[(hourIndex + 1) % 24]}`}
              >
                {formatHeatmapHourHeader(hourIndex)}
              </div>
            ))}

            {matrixRows.map((row, rowIndex) => {
              const prevLevel = rowIndex > 0 ? matrixRows[rowIndex - 1].level : null;
              const showLevelDivider = spaceScope === "all" && prevLevel === 6 && row.level === 7;
              return (
              <Fragment key={row.device}>
                {showLevelDivider ? (
                  <div
                    className="col-span-full border-t border-dashed border-shell-600/80 py-0.5 pl-1 text-[8px] font-medium text-blue-400/80"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    Level 7
                  </div>
                ) : null}
                {spaceScope === "all" && rowIndex === 0 && row.level === 6 ? (
                  <div
                    className="col-span-full border-t border-transparent py-0.5 pl-1 text-[8px] font-medium text-emerald-400/80"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    Level 6
                  </div>
                ) : null}
                <div
                  className="sticky left-0 bg-shell-900 pr-1 text-[9px] text-slate-300"
                  title={`Level ${row.level} · ${row.device} (${row.category})`}
                >
                  {renderDeviceLabel(row)}
                </div>
                {Array.from({ length: 24 }, (_, hourIndex) => {
                  const display = cellDisplay(detailMode, row, hourIndex);
                  return (
                    <div
                      key={`${row.device}-${hourIndex}`}
                      className="flex min-h-[26px] items-center justify-center rounded-sm border border-shell-800/80 px-0.5 text-[7px] leading-tight text-slate-100"
                      style={{ backgroundColor: cellColor(detailMode, row, hourIndex) }}
                      title={cellTooltip(detailMode, row, hourIndex)}
                      onMouseEnter={(event) =>
                        setHoveredCell({
                          device: row.device,
                          hour: HOUR_LABELS[hourIndex],
                          display: cellTooltip(detailMode, row, hourIndex),
                          x: event.clientX,
                          y: event.clientY
                        })
                      }
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {display}
                    </div>
                  );
                })}
              </Fragment>
            );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        {detailMode === "overlay" ? (
          <>
            <span>Below avg</span>
            <div className="h-2 w-28 rounded-full bg-gradient-to-r from-emerald-600 via-slate-600 to-rose-500" />
            <span>Above avg</span>
            <span className="text-slate-400">Scale ±{deltaMaxAbs}%</span>
          </>
        ) : (
          <>
            <span>Low</span>
            <div className="h-2 w-28 rounded-full bg-gradient-to-r from-slate-700 via-amber-500 to-red-500" />
            <span>High</span>
            <span className="text-slate-400">
              {valueBounds.min.toFixed(2)}–{valueBounds.max.toFixed(2)} {hourlyUnitLabel}
            </span>
          </>
        )}
      </div>

      {hoveredCell ? (
        <div
          className="pointer-events-none fixed z-[120] max-w-xs whitespace-pre-line rounded-md border border-shell-600 bg-shell-950 px-2 py-1.5 text-[10px] text-slate-200 shadow-lg"
          style={{ left: hoveredCell.x + 12, top: hoveredCell.y + 12 }}
        >
          {hoveredCell.display}
        </div>
      ) : null}
    </section>
  );
}

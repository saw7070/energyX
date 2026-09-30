import {
  Bolt,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Droplets,
  Fan,
  Flame,
  Gauge,
  Lightbulb,
  Plug,
  TriangleAlert,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { useMemo, useState } from "react";
import { EliteCategoryIcon, eliteCategoryIconMeta } from "@/components/analysis/eliteiot/EliteCategoryIcon";
import { NapPeakBreakdownModal } from "@/components/analysis/nap/NapPeakBreakdownModal";
import { formatPeakWindowLabel } from "@/components/analysis/nap/napPeakHelpers";
import { formatIsoDatesInText } from "@/components/analysis/nap/napDateFormat";
import { NapBreakdownMeterRow, NapHighlightBreakdown, NapPeakWindow } from "@/mock/napEnergyAnalysisData";
import { AnalysisHighlight } from "@/mock/types";
import type { LucideIcon } from "lucide-react";

const iconMap = {
  bolt: Bolt,
  droplet: Droplets,
  flame: Flame,
  coins: Coins,
  gauge: Gauge,
  building: Building2,
  clock: Clock3,
  triangle: TriangleAlert
} as const;

type MeterKind = "light" | "load" | "fan";

const meterKindMeta: Record<MeterKind, { label: string; Icon: LucideIcon; badgeClass: string; iconClass: string }> = {
  light: {
    label: "Lighting",
    Icon: Lightbulb,
    badgeClass: "bg-emerald-500/15",
    iconClass: "text-emerald-300"
  },
  load: {
    label: "Office load",
    Icon: Plug,
    badgeClass: "bg-blue-500/15",
    iconClass: "text-blue-300"
  },
  fan: {
    label: "Ventilation / fan",
    Icon: Fan,
    badgeClass: "bg-violet-500/15",
    iconClass: "text-violet-300"
  }
};

function getMeterKind(name: string, group: NapBreakdownMeterRow["group"]): MeterKind {
  const normalized = name.toLowerCase();
  if (group === "light" || normalized.includes("light")) {
    return "light";
  }
  if (normalized.includes("fan") || normalized.includes("isol")) {
    return "fan";
  }
  return "load";
}

function MeterTypeIcon({ kind, size = "sm" }: { kind: MeterKind; size?: "sm" | "md" }) {
  const meta = meterKindMeta[kind];
  const Icon = meta.Icon;
  const boxClass = size === "md" ? "h-8 w-8" : "h-7 w-7";
  const iconClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <span
      className={`inline-flex ${boxClass} shrink-0 items-center justify-center rounded-md ${meta.badgeClass}`}
      title={meta.label}
    >
      <Icon className={`${iconClass} ${meta.iconClass}`} />
    </span>
  );
}

function TrendInline({ trendPct, muted = false }: { trendPct: number; muted?: boolean }) {
  const positive = trendPct > 0;
  const neutral = trendPct === 0;
  const trendClass = neutral
    ? muted
      ? "text-slate-500"
      : "text-slate-400"
    : positive
      ? "text-amber-300"
      : "text-emerald-300";

  return (
    <span className={`ml-1.5 text-xs ${trendClass}`}>
      ({positive ? "+" : ""}
      {trendPct.toFixed(1)}%)
    </span>
  );
}

function MeterRow({
  meter,
  unit,
  muted = false,
  variant = "nap"
}: {
  meter: NapBreakdownMeterRow;
  unit: string;
  muted?: boolean;
  variant?: "nap" | "elite";
}) {
  const kind = getMeterKind(meter.name, meter.group);
  const category = meter.category ?? "F&B";

  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className={`inline-flex min-w-0 items-start gap-2.5 ${muted ? "text-slate-400" : "text-slate-300"}`}>
        {variant === "elite" ? (
          <EliteCategoryIcon category={category} />
        ) : (
          <MeterTypeIcon kind={kind} />
        )}
        <span className="pt-1 leading-snug">{meter.name}</span>
      </span>
      <span className={`shrink-0 pt-1 ${muted ? "text-slate-300" : "text-slate-100"}`}>
        {formatValue(meter.kwh, unit)}
        {meter.trendPct !== undefined ? <TrendInline trendPct={meter.trendPct} muted={muted} /> : null}
      </span>
    </li>
  );
}

function BreakdownLegend({ variant = "nap" }: { variant?: "nap" | "elite" }) {
  if (variant === "elite") {
    return (
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(eliteCategoryIconMeta).map(([category, meta]) => (
          <span
            key={category}
            className="inline-flex items-center gap-1.5 rounded-full border border-shell-600 bg-shell-800 px-2.5 py-1 text-xs text-slate-400"
          >
            <EliteCategoryIcon category={category} />
            {meta.label}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {(Object.keys(meterKindMeta) as MeterKind[]).map((kind) => {
        const meta = meterKindMeta[kind];
        return (
          <span
            key={kind}
            className="inline-flex items-center gap-1.5 rounded-full border border-shell-600 bg-shell-800 px-2.5 py-1 text-xs text-slate-400"
          >
            <MeterTypeIcon kind={kind} />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

interface NapKeyHighlightCardsProps {
  cards: AnalysisHighlight[];
  breakdowns: Record<string, NapHighlightBreakdown>;
  topPeaks?: NapPeakWindow[];
  previousPeriodLabel: string;
  variant?: "nap" | "elite";
}

function TrendBadge({ trendPct, previousPeriodLabel }: { trendPct: number; previousPeriodLabel: string }) {
  const positive = trendPct > 0;
  const neutral = trendPct === 0;
  const badgeClass = neutral
    ? "bg-slate-500/20 text-slate-300"
    : positive
      ? "bg-amber-500/20 text-amber-300"
      : "bg-emerald-500/20 text-emerald-300";

  return (
    <span
      className={`inline-flex flex-col items-end gap-0.5 rounded px-2 py-1 text-xs ${badgeClass}`}
      title={`Compared with previous period (${previousPeriodLabel})`}
    >
      <span className="inline-flex items-center gap-1">
        {neutral ? null : positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {positive ? "+" : ""}
        {trendPct.toFixed(1)}%
      </span>
      <span className="text-[10px] uppercase tracking-wide opacity-80">vs prev period</span>
    </span>
  );
}

function formatValue(value: number, unit: string) {
  if (unit === "SGD") {
    return `SGD ${value.toLocaleString()}`;
  }
  if (unit === "%") {
    return `${value.toLocaleString()} %`;
  }
  return `${value.toLocaleString()} ${unit}`;
}

function BreakdownModal({
  card,
  breakdown,
  previousPeriodLabel,
  onClose,
  variant = "nap"
}: {
  card: AnalysisHighlight;
  breakdown: NapHighlightBreakdown;
  previousPeriodLabel: string;
  onClose: () => void;
  variant?: "nap" | "elite";
}) {
  const defaultExpanded =
    variant === "elite"
      ? Object.fromEntries(breakdown.levels.map((level) => [level.level, true]))
      : { 6: true, 7: true };
  const [expandedLevels, setExpandedLevels] = useState<Record<number, boolean>>(defaultExpanded);
  const [expandedSubMeters, setExpandedSubMeters] = useState<Record<number, boolean>>(
    variant === "elite"
      ? Object.fromEntries(breakdown.levels.map((level) => [level.level, false]))
      : { 6: false, 7: false }
  );

  function toggleLevel(level: number) {
    setExpandedLevels((current) => ({ ...current, [level]: !current[level] }));
  }

  function toggleSubMeters(level: number) {
    setExpandedSubMeters((current) => ({ ...current, [level]: !current[level] }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-shell-600 bg-shell-900 shadow-soft">
        <div className="flex items-start justify-between gap-3 border-b border-shell-600 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Breakdown</p>
            <h3 className="text-lg font-semibold text-white">{card.label}</h3>
            <p className="mt-1 text-sm text-emerald-300">
              {formatValue(breakdown.totalKwh, breakdown.unit)}
              {breakdown.totalTrendPct !== undefined ? <TrendInline trendPct={breakdown.totalTrendPct} /> : null}
            </p>
            <p className="mt-1 text-xs text-slate-500">{formatIsoDatesInText(breakdown.note)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-800"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <BreakdownLegend variant={variant} />
          <div className="space-y-3">
            {breakdown.levels.map((level) => {
              const levelOpen = expandedLevels[level.level] ?? false;
              const subOpen = expandedSubMeters[level.level] ?? false;

              return (
                <div key={level.level} className="rounded-lg border border-shell-600 bg-shell-800/70">
                  <button
                    type="button"
                    onClick={() => toggleLevel(level.level)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
                      {levelOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      {level.name}
                    </span>
                    <span className="text-sm text-slate-200">
                      {formatValue(level.totalKwh, breakdown.unit)}
                      {level.totalTrendPct !== undefined ? <TrendInline trendPct={level.totalTrendPct} /> : null}
                      <span className="ml-1.5 text-xs text-slate-500">(%)</span>
                    </span>
                  </button>

                  {levelOpen ? (
                    <div className="border-t border-shell-600 px-4 py-3">
                      {level.aggregates.length > 0 ? (
                        <>
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                            {variant === "elite" ? "Site / category total" : "Aggregate meters"}
                          </p>
                          <ul className="space-y-2">
                            {level.aggregates.map((meter) => (
                              <MeterRow key={meter.name} meter={meter} unit={breakdown.unit} variant={variant} />
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {level.subMeters.length > 0 ? (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleSubMeters(level.level)}
                            className={`inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 ${
                              level.aggregates.length > 0 ? "mt-4" : ""
                            }`}
                          >
                            {subOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {subOpen ? "Hide" : "Show"} circuit detail (sub-meters)
                          </button>

                          {subOpen ? (
                            <ul className="mt-3 space-y-2 border-t border-shell-700 pt-3">
                              {level.subMeters.map((meter) => (
                                <MeterRow key={meter.name} meter={meter} unit={breakdown.unit} muted variant={variant} />
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            {variant === "elite"
              ? "Incoming 3Phase is the site total. Sub-meter categories (F&B, Lighting, IT Devices, General Plug) are shown for circuit detail and are not added to the incoming total."
              : "Floor totals use aggregate meters only. Sub-meters are shown for circuit detail and are not added to floor totals."}{" "}
            Percentages compare with the previous period ({previousPeriodLabel}).
          </p>
        </div>
      </div>
    </div>
  );
}

export function NapKeyHighlightCards({
  cards,
  breakdowns,
  topPeaks = [],
  previousPeriodLabel,
  variant = "nap"
}: NapKeyHighlightCardsProps) {
  const [activeBreakdownKey, setActiveBreakdownKey] = useState<string | null>(null);
  const [peakModalOpen, setPeakModalOpen] = useState(false);
  const activeCard = useMemo(
    () => cards.find((item) => item.key === activeBreakdownKey) ?? null,
    [activeBreakdownKey, cards]
  );
  const activeBreakdown = activeBreakdownKey ? breakdowns[activeBreakdownKey] : null;
  const hasPeakBreakdown = topPeaks.length > 0;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-white">Key Highlights</h2>
      <p className="mb-3 text-xs text-slate-500">
        Trend badges compare the current period with the previous period ({previousPeriodLabel}), except peak consumption.
        Click a card for breakdown.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = iconMap[card.icon];
          const isPeakCard = card.key === "peak";
          const hasBreakdown = isPeakCard ? hasPeakBreakdown : Boolean(breakdowns[card.key]);

          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                if (!hasBreakdown) {
                  return;
                }
                if (isPeakCard) {
                  setPeakModalOpen(true);
                  return;
                }
                setActiveBreakdownKey(card.key);
              }}
              className={`panel p-4 text-left transition ${hasBreakdown ? "cursor-pointer hover:border-blue-500/40 hover:bg-shell-800/80" : "cursor-default"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-lg bg-blue-500/15 p-2 text-blue-300">
                  <Icon className="h-4 w-4" />
                </span>
                {isPeakCard ? null : (
                  <TrendBadge trendPct={card.trendPct} previousPeriodLabel={previousPeriodLabel} />
                )}
              </div>
              <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {card.unit === "SGD" ? "SGD " : ""}
                {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
                {card.unit && card.unit !== "SGD" && card.unit !== "%" ? ` ${card.unit}` : card.unit === "%" ? " %" : ""}
              </p>
              {isPeakCard && topPeaks.length > 0 ? (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatPeakWindowLabel(topPeaks[0].window)}
                  </p>
                  <p className="mt-2 text-xs text-blue-300">View top 5 clock-hour peaks</p>
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-500">{formatIsoDatesInText(card.note)}</p>
              )}
              {hasBreakdown && !isPeakCard ? <p className="mt-2 text-xs text-blue-300">Click to view breakdown</p> : null}
            </button>
          );
        })}
      </div>

      {peakModalOpen && topPeaks.length > 0 ? (
        <NapPeakBreakdownModal peaks={topPeaks} onClose={() => setPeakModalOpen(false)} variant={variant} />
      ) : null}

      {activeCard && activeBreakdown ? (
        <BreakdownModal
          card={activeCard}
          breakdown={activeBreakdown}
          previousPeriodLabel={previousPeriodLabel}
          onClose={() => setActiveBreakdownKey(null)}
          variant={variant}
        />
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface NapDistributionDayCalendarProps {
  periodStart: string;
  periodEnd: string;
  availableDates: Set<string>;
  selectedDate: string;
  mode: "period" | "day";
  onSelectPeriod: () => void;
  onSelectDate: (isoDate: string) => void;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function padIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthKey(year: number, month: number): number {
  return year * 12 + month;
}

function parseViewFromIsoDate(isoDate: string): { year: number; month: number } {
  const date = new Date(`${isoDate}T12:00:00`);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function formatSelectedDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Time-range toggle with a popover calendar for single-day selection.
 * Calendar opens only in single-day mode; one month per page with arrow navigation.
 */
export function NapDistributionDayCalendar({
  periodStart,
  periodEnd,
  availableDates,
  selectedDate,
  mode,
  onSelectPeriod,
  onSelectDate
}: NapDistributionDayCalendarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [{ year: viewYear, month: viewMonth }, setView] = useState(() => parseViewFromIsoDate(selectedDate));

  const periodStartMonth = useMemo(() => {
    const date = parseViewFromIsoDate(periodStart);
    return monthKey(date.year, date.month);
  }, [periodStart]);

  const periodEndMonth = useMemo(() => {
    const date = parseViewFromIsoDate(periodEnd);
    return monthKey(date.year, date.month);
  }, [periodEnd]);

  const viewMonthKey = monthKey(viewYear, viewMonth);
  const canGoPrev = viewMonthKey > periodStartMonth;
  const canGoNext = viewMonthKey < periodEndMonth;

  useEffect(() => {
    if (mode === "day") {
      setView(parseViewFromIsoDate(selectedDate));
    }
  }, [mode, selectedDate]);

  useEffect(() => {
    if (!calendarOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [calendarOpen]);

  const openSingleDayCalendar = () => {
    setView(parseViewFromIsoDate(selectedDate));
    setCalendarOpen(true);
    if (availableDates.has(selectedDate)) {
      onSelectDate(selectedDate);
    }
  };

  const handleSelectPeriod = () => {
    setCalendarOpen(false);
    onSelectPeriod();
  };

  const handleSelectDate = (isoDate: string) => {
    onSelectDate(isoDate);
    setCalendarOpen(false);
  };

  const goPrevMonth = () => {
    if (!canGoPrev) {
      return;
    }
    setView((current) => {
      const date = new Date(current.year, current.month - 1, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  const goNextMonth = () => {
    if (!canGoNext) {
      return;
    }
    setView((current) => {
      const date = new Date(current.year, current.month + 1, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  const firstDay = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <div className="inline-flex items-center gap-1 rounded-md border border-shell-600 bg-shell-900 px-1 py-0.5">
        <span className="px-1 text-[10px] text-slate-500">Range</span>
        <div className="inline-flex gap-0.5 text-[10px]">
          <button
            type="button"
            onClick={handleSelectPeriod}
            className={`whitespace-nowrap rounded px-2 py-0.5 ${
              mode === "period"
                ? "bg-emerald-900/40 text-emerald-100"
                : "text-slate-400 hover:bg-shell-800 hover:text-slate-200"
            }`}
          >
            Last 1 Month
          </button>
          <button
            type="button"
            onClick={openSingleDayCalendar}
            className={`whitespace-nowrap rounded px-2 py-0.5 ${
              mode === "day"
                ? "bg-emerald-900/40 text-emerald-100"
                : "text-slate-400 hover:bg-shell-800 hover:text-slate-200"
            }`}
          >
            {mode === "day" ? formatSelectedDayLabel(selectedDate) : "Single day"}
          </button>
        </div>
      </div>

      {calendarOpen && mode === "day" ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-[188px] rounded-md border border-shell-600 bg-shell-900 p-1.5 shadow-xl">
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              disabled={!canGoPrev}
              className="rounded p-0.5 text-slate-400 hover:bg-shell-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-[10px] font-medium text-slate-200">{monthLabel(viewYear, viewMonth)}</p>
            <button
              type="button"
              onClick={goNextMonth}
              disabled={!canGoNext}
              className="rounded p-0.5 text-slate-400 hover:bg-shell-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-px text-center text-[9px]">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-0.5 text-slate-500">
                {label.slice(0, 1)}
              </span>
            ))}
            {Array.from({ length: startOffset }).map((_, index) => (
              <span key={`pad-${index}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, index) => {
              const day = index + 1;
              const isoDate = padIsoDate(viewYear, viewMonth, day);
              const inPeriod = isoDate >= periodStart && isoDate <= periodEnd;
              const hasData = availableDates.has(isoDate);
              const selectable = inPeriod && hasData;
              const isSelected = selectedDate === isoDate;

              return (
                <button
                  key={isoDate}
                  type="button"
                  disabled={!selectable}
                  onClick={() => {
                    if (selectable) {
                      handleSelectDate(isoDate);
                    }
                  }}
                  className={`rounded py-0.5 transition-colors ${
                    isSelected
                      ? "bg-emerald-600 font-semibold text-white"
                      : selectable
                        ? "text-slate-200 hover:bg-shell-700"
                        : "cursor-not-allowed text-slate-600"
                  }`}
                  title={selectable ? isoDate : undefined}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

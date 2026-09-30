import React from "react";

type HourAxisPoint = {
  localHour: number;
  hourLabel: string;
};

export function NgeeAnnHourAxis({
  points,
  axis,
  gap = "narrow",
}: {
  points: HourAxisPoint[];
  axis: "day-profile" | "energy-trend" | "anomaly-series";
  gap?: "narrow" | "wide";
}) {
  return (
    <div
      data-hour-axis={axis}
      className={`grid px-2 pt-2 text-[9px] text-muted ${gap === "wide" ? "gap-2" : "gap-1"}`}
      style={{ gridTemplateColumns: `repeat(${points.length}, minmax(32px, 1fr))` }}
      aria-hidden="true"
    >
      {points.map((point) => (
        <span key={point.localHour} className="min-h-4 text-center">
          {point.localHour % 3 === 0 ? point.hourLabel : ""}
        </span>
      ))}
    </div>
  );
}

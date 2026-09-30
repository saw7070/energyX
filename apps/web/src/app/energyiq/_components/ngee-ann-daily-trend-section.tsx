"use client";

import React, { useEffect, useState } from "react";

import { NgeeAnnDailyAnomalies } from "./ngee-ann-daily-anomalies";
import { NgeeAnnEnergyTrend, type NgeeAnnTrendDayType } from "./ngee-ann-energy-trend";
import type {
  NgeeAnnDailyAnomalyViewModel,
  NgeeAnnEnergyTrendViewModel,
} from "./ngee-ann-overview-view-model";

type ViewMode = "overlay" | "selected" | "average";

export function NgeeAnnDailyTrendSection({
  trend,
  anomalies,
  comparison = "overlay",
  category = "all",
  onComparisonChange,
  onCategoryChange,
}: {
  trend: NgeeAnnEnergyTrendViewModel;
  anomalies: NgeeAnnDailyAnomalyViewModel;
  comparison?: ViewMode;
  category?: "all" | "load" | "light";
  onComparisonChange?: (comparison: ViewMode) => void;
  onCategoryChange?: (category: "all" | "load" | "light") => void;
}) {
  const [selectedScopeId, setSelectedScopeId] = useState(trend.scopes[0]?.id ?? "");
  const [selectedDayType, setSelectedDayType] = useState<NgeeAnnTrendDayType>(() => (
    trend.scopes.some((scope) => scope.points.some((point) => point.dayType === "weekday"))
      ? "weekday"
      : "weekend"
  ));
  const [detailComparison, setDetailComparison] = useState<ViewMode>(comparison);
  const [detailCategory, setDetailCategory] = useState<"all" | "load" | "light">(category);
  const hasClassifiedDays = trend.grain === "day"
    && trend.scopes.some((scope) => scope.points.some((point) => point.dayType !== null));

  useEffect(() => setDetailComparison(comparison), [comparison]);
  useEffect(() => setDetailCategory(category), [category]);
  const handleComparisonChange = (nextComparison: ViewMode) => {
    setDetailComparison(nextComparison);
    onComparisonChange?.(nextComparison);
  };
  const handleCategoryChange = (nextCategory: "all" | "load" | "light") => {
    setDetailCategory(nextCategory);
    onCategoryChange?.(nextCategory);
  };

  return (
    <>
      <NgeeAnnEnergyTrend
        view={trend}
        selectedScopeId={selectedScopeId}
        selectedDayType={hasClassifiedDays ? selectedDayType : undefined}
        onScopeChange={setSelectedScopeId}
        onDayTypeChange={hasClassifiedDays ? setSelectedDayType : undefined}
      />
      <NgeeAnnDailyAnomalies
        view={anomalies}
        selectedScopeId={selectedScopeId}
        selectedDayType={hasClassifiedDays ? selectedDayType : undefined}
        comparison={detailComparison}
        category={detailCategory}
        onComparisonChange={handleComparisonChange}
        onCategoryChange={handleCategoryChange}
      />
    </>
  );
}

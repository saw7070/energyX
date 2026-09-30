export type OverviewHistoryState = {
  open: boolean;
  selectedAnalysisId: string | null;
};

export function overviewHistoryStateFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): OverviewHistoryState {
  const selectedAnalysisId = searchParams.get("savedAnalysisId")?.trim() || null;
  return {
    open: searchParams.get("history") === "1" || selectedAnalysisId !== null,
    selectedAnalysisId,
  };
}

export function overviewUrlWithHistory(
  currentSearch: string,
  state: OverviewHistoryState,
): string {
  const next = new URLSearchParams(currentSearch);
  if (state.open) {
    next.set("history", "1");
    if (state.selectedAnalysisId) next.set("savedAnalysisId", state.selectedAnalysisId);
    else next.delete("savedAnalysisId");
  } else {
    next.delete("history");
    next.delete("savedAnalysisId");
  }
  const query = next.toString();
  return query ? `/energyiq/overview?${query}` : "/energyiq/overview";
}

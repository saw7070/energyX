import type { EnergyProjectOverviewProfileDto } from "../../../lib/config-api";

export type AdminOverviewProfilePresentation = {
  name: string;
  revisionLabel: string;
  latestStatusLabel: string;
  shortTermLabel: string;
  mainRangeLabel: string;
};

export function presentAdminOverviewProfile(
  profile: EnergyProjectOverviewProfileDto,
): AdminOverviewProfilePresentation {
  const name = profile.rendererKey === "ngee-ann-overview"
    ? "Ngee Ann decision overview"
    : profile.rendererKey === "preschool-overview"
      ? "Preschool portfolio overview"
      : "Published energy overview";
  return {
    name,
    revisionLabel: `${profile.rendererKey}@${profile.rendererVersion}`,
    latestStatusLabel: "Latest complete day",
    shortTermLabel: `Rolling ${profile.horizons.shortTermDays} days`,
    mainRangeLabel: profile.currentAnalysisWindow === "current-month-to-date"
      ? "Calendar month to date"
      : `Rolling ${profile.horizons.mainDays} complete days`,
  };
}

export function resolveAdminOverviewPreviewMode(
  profile: EnergyProjectOverviewProfileDto | null,
): "customer-renderer-handoff" | "generic-layout-preview" {
  return profile ? "customer-renderer-handoff" : "generic-layout-preview";
}

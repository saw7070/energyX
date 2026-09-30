import type { AdminSection } from "./admin-sidebar";

export type ProjectDeliverySignals = {
  hasBasics: boolean;
  hasStructure: boolean;
  hasSource: boolean;
  hasConfirmedMapping: boolean;
  hasMaterializedFacts: boolean;
  hasAnalysisConfiguration: boolean;
  hasPublishedRevision: boolean;
};

export type ProjectDeliveryStage = {
  label: string;
  state: string;
  section: AdminSection;
  enabled: boolean;
};

export type ProjectDeliveryProgress = {
  nextSection: AdminSection;
  nextLabel: string;
  stages: ProjectDeliveryStage[];
};

export function deriveProjectDeliveryProgress(
  signals: ProjectDeliverySignals,
): ProjectDeliveryProgress {
  const dataState = signals.hasMaterializedFacts && signals.hasConfirmedMapping
    ? "Facts ready"
    : signals.hasConfirmedMapping
      ? "Mapping confirmed"
      : signals.hasSource
        ? "Source inspected"
        : "Not configured";

  let nextSection: AdminSection = "basics";
  let nextLabel = "Complete project basics";

  if (signals.hasBasics) {
    nextSection = "structure";
    nextLabel = "Finish project structure";
  }
  if (signals.hasStructure) {
    nextSection = "data-sources";
    nextLabel = "Connect the first data source";
  }
  if (signals.hasSource && !signals.hasConfirmedMapping) {
    nextSection = "meter-mapping";
    nextLabel = "Complete meter mapping";
  }
  if (signals.hasConfirmedMapping && !signals.hasMaterializedFacts) {
    nextSection = "data-sources";
    nextLabel = "Build interval facts";
  }
  if (signals.hasMaterializedFacts && signals.hasConfirmedMapping) {
    nextSection = "templates";
    nextLabel = "Configure analysis";
  }
  if (signals.hasMaterializedFacts && signals.hasConfirmedMapping && signals.hasAnalysisConfiguration) {
    nextSection = "project-overview";
    nextLabel = signals.hasPublishedRevision ? "Review current publication" : "Review and publish";
  }

  return {
    nextSection,
    nextLabel,
    stages: [
      { label: "Basics", state: signals.hasBasics ? "Complete" : "Needs action", section: "basics", enabled: true },
      { label: "Structure", state: signals.hasStructure ? "Draft ready" : "Needs action", section: "structure", enabled: true },
      { label: "Data & Meters", state: dataState, section: "data-sources", enabled: true },
      {
        label: "Analysis",
        state: signals.hasAnalysisConfiguration
          ? "Configured"
          : signals.hasMaterializedFacts && signals.hasConfirmedMapping
            ? "Ready to configure"
            : "Waiting for data",
        section: "templates",
        enabled: true,
      },
      {
        label: "Review & Publish",
        state: signals.hasPublishedRevision
          ? "Published"
          : signals.hasAnalysisConfiguration && signals.hasMaterializedFacts && signals.hasConfirmedMapping
            ? "Ready"
            : "Not ready",
        section: "project-overview",
        enabled: signals.hasAnalysisConfiguration && signals.hasMaterializedFacts && signals.hasConfirmedMapping,
      },
    ],
  };
}

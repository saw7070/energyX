const CURRENT_OVERVIEW_SLOT_PREFIX = "energyiq-overview-slot-";
const LEGACY_OVERVIEW_SLOT_PREFIXES = [
  "ngee-ann-overview-",
  "preschool-overview-",
] as const;
const INTERNAL_ADDITIONAL_AI_SESSION_PREFIXES = [
  "preschool-section-interpreter-",
  "preschool-executive-synthesis-",
  "preschool-additional-ai-insights-",
  "preschool-additional-evaluation-",
  "preschool-additional-transition-generation-",
  "preschool-additional-transition-comparison-",
] as const;

export const isEnergyIqOverviewSlotSessionId = (sessionId: string): boolean =>
  sessionId.startsWith(CURRENT_OVERVIEW_SLOT_PREFIX)
  || LEGACY_OVERVIEW_SLOT_PREFIXES.some((prefix) => sessionId.startsWith(prefix))
  || INTERNAL_ADDITIONAL_AI_SESSION_PREFIXES.some((prefix) => sessionId.startsWith(prefix));

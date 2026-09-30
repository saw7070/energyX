/**
 * Resource-safety ceilings for accepted Decision Brief copy.
 *
 * These are deliberately much larger than the customer-facing editorial
 * targets. They prevent abusive payloads without turning a writing target into
 * whole-Artifact rejection.
 */
export const ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1 = {
  sectionSummaryChars: 4_096,
  sectionInsightTitleChars: 512,
  sectionInsightLabelChars: 512,
  sectionInsightTextChars: 8_192,
  sectionDeepDiveQuestionChars: 4_096,
  sectionLimitationChars: 4_096,
  executiveSummaryChars: 4_096,
  executiveFindingTitleChars: 512,
  executiveFindingTextChars: 8_192,
} as const;

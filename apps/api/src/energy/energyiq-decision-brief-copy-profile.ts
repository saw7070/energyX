export const ENERGYIQ_DECISION_BRIEF_COPY_PROFILE_REVISION = "energyiq-decision-brief-copy@1" as const;

export const decisionBriefCopyGuidance = (conclusionKind: "Insight" | "Finding"): readonly string[] => {
  const article = conclusionKind === "Insight" ? "an" : "a";
  return [
    `Decision Brief copy profile: ${ENERGYIQ_DECISION_BRIEF_COPY_PROFILE_REVISION}.`,
    "Write customer-facing copy in ordinary words. Use one direct claim per sentence.",
    "Explain a necessary technical term on first use; write 'energy per square metre' instead of unexplained 'EUI'.",
    "Keep method, schema, and Evidence-system terminology out of customer copy.",
    "Keep the Summary to one complete sentence.",
    `Do not repeat the Summary in ${article} ${conclusionKind}.`,
  ] as const;
};

/** Analysis capabilities implemented by the Tuya Section Pack. */
export const TUYA_OFFICE_AI_SECTION_TARGET_IDS = [
  "data-readiness",
  "consumption-and-demand",
  "meter-contribution-and-operations",
] as const;

export type TuyaOfficeAiSectionTargetId = typeof TUYA_OFFICE_AI_SECTION_TARGET_IDS[number];

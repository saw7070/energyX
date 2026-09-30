/** Saved content must run without access to the importing machine or source Session. */
export function validateReportSkillContent(content: string): void {
  if (/\b(?:references|scripts)\/[\w./-]+/i.test(content)) throw new Error("REPORT_SKILL_RESOURCE_NOT_EMBEDDED");
}

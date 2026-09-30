/**
 * Display-only wording for AI text written before "operating hours" became the one term for a site's schedule.
 * Stored findings, evidence and reports are not rewritten.
 */
const RULES: Array<[RegExp, string | ((...groups: string[]) => string)]> = [
  // Keeps any days or times named in between, e.g. "provisional Mon-Fri 09:00-18:00 window".
  [/\bprovisional (?:([^.,;]{1,30}?) )??(?:operating )?(?:window|hours)\b/gi, (_match, detail) => detail ? `assumed ${detail} operating hours` : "assumed operating hours"],
  [/\bprovisional (\d{1,2}:\d{2}) close\b/gi, (_match, time) => `assumed ${time} closing time`],
  [/\b(?:opening|business|office|open|published) hours\b/gi, "operating hours"],
  [/\bopening-hour\b/gi, "operating-hour"],
];

export function operatingHoursWording(text: string): string {
  return RULES.reduce((result, [pattern, replacement]) => result.replace(pattern, (match, ...groups: string[]) => {
    const next = typeof replacement === "function" ? replacement(match, ...groups) : replacement;
    return /^[A-Z]/.test(match) ? next.charAt(0).toUpperCase() + next.slice(1) : next;
  }), text);
}

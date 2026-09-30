/**
 * What the welcome screen puts in the message box when someone picks a starting point or an example.
 *
 * The labels on those buttons follow the reader's language; these prompts are sent to the advisor as written,
 * so they stay in English in every language. Kept apart from the panel so the printed user guide can quote the
 * same words without copying them.
 */
export const ADVISOR_STARTER_PROMPTS = {
  consumption: "Summarise energy consumption for the selected period.",
  loads: "Help me investigate unusual loads in the selected period.",
  report: "Create an energy report for the selected period.",
} as const;

export const ADVISOR_EXAMPLE_PROMPTS = {
  overview: "Write a monthly energy report in the style of the Overview: one headline finding, what it costs per month, and the two or three actions worth taking, each with the evidence behind it.",
  afterHours: "Which equipment costs the most outside operating hours? Give the monthly cost for each and say what could be switched off.",
  compare: "Compare this period with the one before it: what changed, why, and what the difference cost.",
} as const;

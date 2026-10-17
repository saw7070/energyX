import styles from "./report-workbench.module.css";

/** A key number the advisor pulls out of its answer, shown as a tile under the text. */
export type AdvisorFigure = { label: string; value: string; tone: "alert" | "neutral" | "good" };

const OPEN = "```figures";
const TONES = new Set<AdvisorFigure["tone"]>(["alert", "neutral", "good"]);

/**
 * Splits the advisor's optional ```figures block (a JSON list of up to three key numbers) from the answer text.
 * While an answer is still streaming the block may be unfinished: it is hidden and no tiles are shown yet.
 * Anything malformed is dropped rather than shown, so a bad block never reaches the reader as code.
 */
export function splitAdvisorFigures(answer: string): { text: string; figures: AdvisorFigure[] } {
  const start = answer.lastIndexOf(OPEN);
  if (start < 0) return { text: answer, figures: [] };
  const bodyStart = answer.indexOf("\n", start);
  const end = bodyStart < 0 ? -1 : answer.indexOf("```", bodyStart);
  const text = (answer.slice(0, start) + (end < 0 ? "" : answer.slice(end + 3))).trim();
  if (end < 0) return { text, figures: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(answer.slice(bodyStart + 1, end)); } catch { return { text, figures: [] }; }
  if (!Array.isArray(parsed)) return { text, figures: [] };
  const figures = parsed.flatMap((item): AdvisorFigure[] => {
    if (!item || typeof item !== "object") return [];
    const { label, value, tone } = item as Record<string, unknown>;
    if (typeof label !== "string" || typeof value !== "string" || !label.trim() || !value.trim()) return [];
    return [{ label: label.trim().slice(0, 40), value: value.trim().slice(0, 32), tone: TONES.has(tone as AdvisorFigure["tone"]) ? tone as AdvisorFigure["tone"] : "neutral" }];
  }).slice(0, 3);
  return { text, figures };
}

export function AdvisorFigureTiles({ figures, label }: { figures: AdvisorFigure[]; label: string }) {
  if (!figures.length) return null;
  return <ul className={styles.figureTiles} aria-label={label}>
    {figures.map((figure, index) => <li key={`${index}-${figure.label}`} data-tone={figure.tone}><span>{figure.label}</span><strong>{figure.value}</strong></li>)}
  </ul>;
}

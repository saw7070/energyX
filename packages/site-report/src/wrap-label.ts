/**
 * Splits a label into lines of at most `maxChars`, breaking on spaces only, for SVG text that has no wrapping of its
 * own. apps/web's site-floor-map.tsx keeps the same helper for the interactive map.
 */
export function wrapLabel(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

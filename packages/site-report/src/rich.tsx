/**
 * The two React helpers the report's wording needs. They live apart from the message catalogues so those stay free of
 * React and can run on the server; apps/web re-exports `rich` from analysis-messages.ts, where it used to live.
 */
import { createElement, Fragment, type ReactNode } from "react";

/**
 * Fills `{name}` placeholders that a translation left in place with React nodes, so a whole sentence is translated
 * with its bold figures in the right place for each language, e.g. rich(t("headline", { name }), { cost: <Strong>…</Strong> }).
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = text.split(/\{(\w+)\}/g);
  if (pieces.length === 1) return text;
  const nodes = pieces.map((piece, index) => index % 2 === 0 ? piece : piece in parts ? parts[piece] : `{${piece}}`).filter(node => node !== "");
  return createElement(Fragment, null, ...nodes);
}

/** Bold the phrases the model marks with **…**, as the reference report bolds the number a decision depends on. */
export function Rich({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part)}</>;
}

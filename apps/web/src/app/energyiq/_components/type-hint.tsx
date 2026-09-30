"use client";
import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AnalysisCategory } from "./analysis-model";
import { analysisMessages, categoryDescription, categoryLabel, listText } from "./analysis-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { EnergyIcon } from "./icons";

/**
 * A meter-type name with an ⓘ that explains it in plain language on hover, focus or tap.
 * The explanation is fixed-positioned so tables and scrolling panels never clip it.
 */
export function TypeHint({ category, examples = [], place, children }: { category: AnalysisCategory; examples?: string[]; place?: string; children?: ReactNode }) {
  const id = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(analysisMessages);
  const label = categoryLabel(category, locale);
  const reposition = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setPos({ left: Math.max(8, Math.min(box.left - 8, window.innerWidth - 296)), top: box.bottom + 8 });
  };
  const open = !!pos;
  useEffect(() => {
    if (!open) return;
    // Follow the ⓘ while the page scrolls (focusing it can scroll it into view).
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPos(null); };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); window.removeEventListener("keydown", escape); };
  }, [open]);
  return <span className="inline-flex items-center gap-1">
    {children ?? label}
    <button ref={anchor} type="button" aria-label={t("hint.aria", { label })} aria-describedby={pos ? id : undefined}
      onMouseEnter={reposition} onMouseLeave={() => setPos(null)} onFocus={reposition} onBlur={() => setPos(null)}
      onClick={event => { event.stopPropagation(); if (pos) setPos(null); else reposition(); }}
      className="inline-flex shrink-0 cursor-help rounded-full text-slate-400 hover:text-slate-700 focus-visible:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400">
      <EnergyIcon name="info" className="h-3.5 w-3.5" />
    </button>
    {pos && <span role="tooltip" id={id} style={{ position: "fixed", left: pos.left, top: pos.top }} className="pointer-events-none z-[150] w-72 whitespace-normal break-words rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg">
      <strong className="mb-0.5 block text-[13px] font-semibold text-slate-900">{label}</strong>
      {categoryDescription(category, locale)}
      {examples.length > 0 && <span className="mt-1.5 block text-slate-700">{place ? t("hint.at", { place, examples: listText(examples, locale) }) : t("hint.here", { examples: listText(examples, locale) })}</span>}
    </span>}
  </span>;
}

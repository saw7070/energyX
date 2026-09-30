"use client";
import { useState } from "react";
import { analysisMessages, analysisText, joinText } from "./analysis-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import type { EnergyIqLocale } from "./energyiq-messages";

export type ShareSlice = { id: string; name: string; kwh: number; colour: string; detail?: string };
export type CircuitReading = { id: string; name: string; kwh: number; periodKwh: number };

/** Validated categorical order (adjacent pairs pass in light and dark); a circuit keeps its colour whichever hour is picked. */
const SLOTS = ["var(--share-1)", "var(--share-2)", "var(--share-3)", "var(--share-4)"];

/**
 * Up to four circuits by name, then "Other circuits", then the part of the space no circuit meter covers.
 * Named circuits are the space's four biggest over the whole period, so colours and order stay put between hours.
 */
export function circuitSlices(circuits: CircuitReading[], spaceKwh: number, locale: EnergyIqLocale = "en"): ShareSlice[] {
  const t = analysisText(locale);
  const named = [...circuits].sort((a, b) => b.periodKwh - a.periodKwh).slice(0, SLOTS.length);
  const slices: ShareSlice[] = named.flatMap((circuit, index) => circuit.kwh > 0 ? [{ id: circuit.id, name: circuit.name, kwh: circuit.kwh, colour: SLOTS[index]! }] : []);
  const others = circuits.filter(circuit => circuit.kwh > 0 && !named.includes(circuit)).sort((a, b) => b.kwh - a.kwh);
  if (others.length) slices.push({ id: "other-circuits", name: others.length === 1 ? others[0]!.name : t("donut.others", { count: others.length }), kwh: others.reduce((sum, circuit) => sum + circuit.kwh, 0), colour: "var(--share-other)", ...(others.length > 1 ? { detail: joinText(others.map(circuit => circuit.name), locale) } : {}) });
  const rest = spaceKwh - circuits.reduce((sum, circuit) => sum + Math.max(0, circuit.kwh), 0);
  if (rest > spaceKwh * 0.005) slices.push({ id: "not-split", name: t("donut.notSplit"), kwh: rest, colour: "var(--share-rest)", detail: t("donut.notSplitDetail") });
  return slices;
}

const point = (cx: number, cy: number, r: number, angle: number) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)] as const;
/** SVG path for one ring segment from angle a to b (radians, clockwise from 12 o'clock). */
export function ringPath(cx: number, cy: number, outer: number, inner: number, a: number, b: number): string {
  if (b - a >= Math.PI * 2 - 1e-6) b = a + Math.PI * 2 - 1e-4;
  const large = b - a > Math.PI ? 1 : 0;
  const [x1, y1] = point(cx, cy, outer, a), [x2, y2] = point(cx, cy, outer, b), [x3, y3] = point(cx, cy, inner, b), [x4, y4] = point(cx, cy, inner, a);
  const f = (value: number) => value.toFixed(2);
  return `M${f(x1)},${f(y1)} A${outer},${outer} 0 ${large} 1 ${f(x2)},${f(y2)} L${f(x3)},${f(y3)} A${inner},${inner} 0 ${large} 0 ${f(x4)},${f(y4)} Z`;
}

const kwhText = (value: number) => value.toLocaleString("en-SG", { maximumFractionDigits: 2 });
const pctText = (value: number) => `${value.toLocaleString("en-SG", { maximumFractionDigits: value < 10 ? 1 : 0 })}%`;

/** Donut of where one space's energy went in one hour, with a legend that carries every value. */
export function PeakShareDonut({ slices, total, spaceName }: { slices: ShareSlice[]; total: number; spaceName: string }) {
  const [active, setActive] = useState<string | null>(null);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(analysisMessages);
  if (!slices.length || total <= 0) return null;
  const size = 184, c = size / 2, outer = 86, inner = 58, gap = slices.length > 1 ? 0.022 : 0;
  let start = 0;
  const arcs = slices.map(slice => { const sweep = slice.kwh / total * Math.PI * 2; const arc = { slice, a: start + gap / 2, b: start + sweep - gap / 2 }; start += sweep; return arc; });
  const focus = slices.find(slice => slice.id === active);
  return <div className="energyiq-share grid items-center gap-5 sm:grid-cols-[184px_minmax(0,1fr)]">
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-[184px] w-[184px]" role="img" aria-label={t("donut.aria", { space: spaceName, slices: joinText(slices.map(slice => t("donut.slice", { name: slice.name, kwh: kwhText(slice.kwh), pct: pctText(slice.kwh / total * 100) })), locale) })}>
      {arcs.map(({ slice, a, b }) => <path key={slice.id} d={ringPath(c, c, active === slice.id ? outer + 3 : outer, inner, a, Math.max(a + 0.002, b))} style={{ fill: slice.colour, opacity: active && active !== slice.id ? 0.35 : 1, transition: "opacity 120ms" }} onMouseEnter={() => setActive(slice.id)} onMouseLeave={() => setActive(null)}><title>{t("donut.title", { name: slice.name, kwh: kwhText(slice.kwh), pct: pctText(slice.kwh / total * 100) })}</title></path>)}
      <text x={c} y={c - 6} textAnchor="middle" className="fill-slate-900 text-[17px] font-semibold tabular-nums">{kwhText(focus ? focus.kwh : total)} kWh</text>
      <text x={c} y={c + 14} textAnchor="middle" className="fill-slate-500 text-[11px]">{focus ? t("donut.ofSpace", { pct: pctText(focus.kwh / total * 100) }) : t("donut.thisHour")}</text>
    </svg>
    <ul className="grid gap-1.5" aria-label={t("donut.listLabel")}>{slices.map(slice => <li key={slice.id} onMouseEnter={() => setActive(slice.id)} onMouseLeave={() => setActive(null)} className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 text-xs ${active === slice.id ? "bg-slate-100" : ""}`}>
      <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.colour }} aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{slice.name}</span>{slice.detail && <span className="block text-[11px] text-slate-500">{slice.detail}</span>}</span>
      <span className="shrink-0 text-right tabular-nums text-slate-700">{kwhText(slice.kwh)} kWh<span className="ml-2 inline-block w-11 font-semibold text-slate-900">{pctText(slice.kwh / total * 100)}</span></span>
    </li>)}</ul>
  </div>;
}

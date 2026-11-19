/**
 * The energy review as a document: the page the Overview shows for a site set to it, the page the server saves, and the
 * file people download.
 *
 * On the Overview the review is a working page: a bar of sections that follows the reader down the page, charts that
 * give their figures when pointed at, a switch between energy and cost, layers that can be hidden, measures that can be
 * left out of the saving total, and a meter list that sorts. A saved or downloaded copy (`standalone`) is the same
 * document without the moving parts, with a short title block at the top so the file names itself; every figure the
 * charts give on hover is also printed in the text or a table, so nothing is lost on paper.
 *
 * Nothing here reads the DOM while rendering, so the server renders the same document with renderEnergyReviewHtml().
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ENERGY_REVIEW_PALETTE as P, worthSaying, type EnergyReview, type EnergyReviewFollowUp, type EnergyReviewHeadline, type EnergyReviewMeter, type EnergyReviewQuestion, type EnergyReviewSlice } from "./energy-review.js";
import { energyReviewMessages } from "./energy-review-messages.js";
import { forHoursMeaning, translatorFor } from "./locale.js";
import { Rich } from "./rich.js";
import { niceTicks, useWidth } from "./site-report-document.js";
import { clock, moneyText } from "./site-report-model.js";

type T = ReturnType<typeof reviewText>;
const reviewText = (review: Pick<EnergyReview, "locale" | "hoursMeaning">) => forHoursMeaning(translatorFor(energyReviewMessages, review.locale), energyReviewMessages, review.hoursMeaning);
const num = (value: number | null, digits = 1) => value == null ? "—" : value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const whole = (value: number) => Math.round(value).toLocaleString("en-SG");
const kwhLabel = (value: number) => `${value < 100 ? num(value) : whole(value)} kWh`;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const INK = "#18211D", MUTED = "#5D6A64", FAINT = "#8A9690", LINE = "#E4E9E6", BRONZE = "#B47E33";
/** Ids carry a prefix so they never meet an id of the page around the review. */
const sectionId = (id: string) => `er-${id}`;
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The review's own styles, scoped to it; it never borrows the full report's. It is a paper document, light in any theme. */
export const ENERGY_REVIEW_CSS = `
.eiq-energy-review{--er-green:#1F5C46;--er-green-deep:#163F31;--er-green-soft:#E9F2ED;--er-bronze:${BRONZE};--er-bronze-soft:#F8F0E3;--er-ink:${INK};--er-body:#2E3934;--er-muted:${MUTED};--er-faint:${FAINT};--er-line:${LINE};--er-soft:#F6F8F7;--er-sticky-top:0px;
  font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--er-body);background:#fff;line-height:1.6;font-size:15.5px;color-scheme:light;text-align:left;container-type:inline-size;-webkit-font-smoothing:antialiased}
.eiq-energy-review *{box-sizing:border-box;margin:0;padding:0}
.eiq-energy-review .er-page{max-width:940px;margin:0 auto;padding:0 32px 64px}
.eiq-energy-review h1,.eiq-energy-review h2,.eiq-energy-review h3{font-family:'Source Serif 4','Source Serif Pro','Iowan Old Style',Georgia,'Times New Roman',serif;font-weight:600;color:var(--er-ink);letter-spacing:-.012em;text-wrap:balance}
.eiq-energy-review h2{font-size:clamp(23px,3.2vw,29px);line-height:1.22;margin-top:8px}
.eiq-energy-review h3{font-size:18.5px;line-height:1.3;margin:34px 0 4px}
.eiq-energy-review p{max-width:68ch;margin-top:12px}
.eiq-energy-review .er-lede{font-size:17px;line-height:1.6;color:var(--er-body)}
.eiq-energy-review strong{font-weight:650;color:var(--er-ink)}
.eiq-energy-review a{color:inherit;text-decoration:none}
.eiq-energy-review button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.eiq-energy-review :focus-visible{outline:2px solid var(--er-bronze);outline-offset:2px;border-radius:4px}
.eiq-energy-review .er-kicker{display:flex;align-items:center;gap:10px;font-size:11.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--er-green)}
.eiq-energy-review .er-kicker::before{content:"";width:22px;height:2px;background:var(--er-green);border-radius:2px}
.eiq-energy-review .er-sec{padding-top:52px;margin-top:52px;border-top:1px solid var(--er-line);scroll-margin-top:calc(var(--er-sticky-top) + 64px)}
.eiq-energy-review .er-sec{position:relative}
.eiq-energy-review .er-fb{position:absolute;top:44px;right:0;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--er-line);border-radius:999px;background:#fff;color:var(--er-green);font:inherit;font-size:13px;font-weight:600;cursor:pointer;opacity:.55;transition:opacity .15s,background .15s,border-color .15s}
.eiq-energy-review .er-fb svg{width:15px;height:15px}
.eiq-energy-review .er-sec:hover>.er-fb,.eiq-energy-review .er-fb:focus-visible,.eiq-energy-review .er-fb[aria-expanded="true"]{opacity:1}
.eiq-energy-review .er-fb:hover{background:var(--er-soft);border-color:#BBD3C6}
.eiq-energy-review .er-first>.er-fb{top:-8px}
.eiq-energy-review .er-two>.er-sec>.er-fb{top:16px;right:16px}
@media (hover:none){.eiq-energy-review .er-fb{opacity:1}}
@media (max-width:700px){.eiq-energy-review .er-fb{position:static;margin:0 0 12px}}
.eiq-energy-review .er-sec.er-first{border-top:0;margin-top:0;padding-top:34px}

/* the bar of sections */
.eiq-energy-review .er-nav{position:sticky;top:var(--er-sticky-top);z-index:6;padding:10px 0;background:rgba(255,255,255,.97);box-shadow:0 6px 16px -14px rgba(22,63,49,.35);border-bottom:1px solid var(--er-line)}
.eiq-energy-review .er-nav ol{list-style:none;display:flex;gap:4px;max-width:940px;margin:0 auto;padding:0 32px;overflow-x:auto;scrollbar-width:none;scroll-behavior:smooth}
.eiq-energy-review .er-nav ol::-webkit-scrollbar{display:none}
.eiq-energy-review .er-nav a{display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:500;color:var(--er-muted);white-space:nowrap;transition:background .15s,color .15s}
.eiq-energy-review .er-nav a:hover{background:var(--er-soft);color:var(--er-ink)}
.eiq-energy-review .er-nav a[aria-current="true"]{background:var(--er-green);color:#fff}

/* the title block of a saved copy */
.eiq-energy-review .er-head{padding-bottom:28px}
.eiq-energy-review .er-mast{padding:36px 0 0;border-top:5px solid var(--er-green);margin-top:24px}
.eiq-energy-review .er-mast .er-brand{font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--er-muted)}
.eiq-energy-review .er-mast h1{font-size:clamp(30px,5vw,42px);line-height:1.1;margin-top:14px}
.eiq-energy-review .er-mast .er-sub{font-size:16.5px;color:var(--er-muted);margin-top:10px}
.eiq-energy-review .er-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:24px;padding:16px 0;border-top:1px solid var(--er-line);border-bottom:1px solid var(--er-line);font-size:13.5px;color:var(--er-ink)}
.eiq-energy-review .er-meta dt{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--er-muted);margin-bottom:4px}

/* summary: the key figures as one band, then the key findings as cards */
.eiq-energy-review .er-figs{display:grid;grid-template-columns:repeat(var(--er-figs,4),minmax(0,1fr));gap:1px;margin-top:28px;border:1px solid var(--er-line);border-top:3px solid var(--er-green);border-radius:14px;background:var(--er-line);overflow:hidden;box-shadow:0 1px 2px rgba(22,63,49,.04),0 16px 32px -26px rgba(22,63,49,.4)}
.eiq-energy-review .er-fig-tile{display:flex;flex-direction:column;min-width:0;padding:18px 20px 17px;background:#fff;transition:background .15s}
.eiq-energy-review a.er-fig-tile:hover{background:var(--er-soft)}
.eiq-energy-review a.er-fig-tile:focus-visible{outline-offset:-4px}
.eiq-energy-review .er-fig-label{margin-top:6px;font-size:13px;font-weight:600;line-height:1.35;color:var(--er-body)}
.eiq-energy-review a.er-fig-tile:hover .er-fig-label{color:var(--er-green)}
.eiq-energy-review .er-fig-tile b{order:-1;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font-family:'Source Serif 4','Iowan Old Style',Georgia,serif;font-size:34px;font-weight:600;line-height:1.05;color:var(--er-ink);font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.015em}
.eiq-energy-review .er-fig-tile b small{font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;color:var(--er-muted);letter-spacing:0}
.eiq-energy-review .er-fig-detail{margin-top:auto;padding-top:12px;font-size:12.5px;font-weight:500;line-height:1.4;color:var(--er-green)}
.eiq-energy-review .er-finds{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:16px}
.eiq-energy-review .er-finds>li{display:flex;min-width:0}
.eiq-energy-review .er-find{--er-accent:var(--er-green);--er-accent-soft:var(--er-green-soft);position:relative;display:flex;flex-direction:column;width:100%;padding:16px 18px 18px;border:1px solid var(--er-line);border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(22,63,49,.04);transition:border-color .15s,box-shadow .15s}
.eiq-energy-review .er-find.er-tone-watch{--er-accent:var(--er-bronze);--er-accent-soft:var(--er-bronze-soft)}
.eiq-energy-review .er-find.er-tone-good::before,.eiq-energy-review .er-find.er-tone-watch::before{content:"";position:absolute;top:-1px;left:18px;width:40px;height:3px;border-radius:0 0 3px 3px;background:var(--er-accent)}
.eiq-energy-review a.er-find:hover{border-color:#BBD3C6;box-shadow:0 14px 30px -22px rgba(22,63,49,.55)}
.eiq-energy-review a.er-find:focus-visible{border-radius:14px}
.eiq-energy-review .er-find-top{display:flex;align-items:center;gap:10px;min-height:30px}
.eiq-energy-review .er-find-icon{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:9px;background:var(--er-accent-soft);color:var(--er-accent)}
.eiq-energy-review .er-find-icon svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
.eiq-energy-review .er-find-topic{flex:1;min-width:0;font-size:11.5px;font-weight:700;line-height:1.3;letter-spacing:.12em;text-transform:uppercase;color:var(--er-green)}
.eiq-energy-review .er-find-go{flex:none;color:var(--er-faint);font-size:16px;line-height:1;transition:transform .15s,color .15s}
.eiq-energy-review a.er-find:hover .er-find-go{color:var(--er-green);transform:translateX(3px)}
.eiq-energy-review .er-find-figure{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:7px;margin-top:14px;color:var(--er-ink)}
.eiq-energy-review .er-find-figure b{font-family:'Source Serif 4','Iowan Old Style',Georgia,serif;font-size:27px;font-weight:600;line-height:1.12;letter-spacing:-.012em;font-variant-numeric:tabular-nums lining-nums;overflow-wrap:anywhere}
.eiq-energy-review .er-find-figure small{font-size:13.5px;font-weight:500;line-height:1.35;color:var(--er-muted)}
.eiq-energy-review .er-find-text{display:block;margin-top:8px;font-size:14px;line-height:1.55;color:var(--er-body)}
.eiq-energy-review .er-find-foot{display:block;margin-top:auto;padding-top:12px}
.eiq-energy-review .er-note{font-size:12.5px;line-height:1.5;color:var(--er-muted);margin-top:12px}
.eiq-energy-review .er-sum-note{margin-top:18px}

/* figures */
.eiq-energy-review .er-fig{margin-top:22px;padding:18px 20px 16px;border:1px solid var(--er-line);border-radius:16px;background:#fff}
.eiq-energy-review .er-fig-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-bottom:10px}
.eiq-energy-review .er-fig-title{font-weight:650;font-size:14px;color:var(--er-ink)}
.eiq-energy-review .er-hint{font-size:12px;color:var(--er-faint)}
.eiq-energy-review .er-typ{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--er-muted)}
.eiq-energy-review .er-typ i{display:block;width:20px;border-top:2px dashed var(--er-bronze)}
.eiq-energy-review .er-switch{display:inline-flex;padding:3px;border-radius:999px;background:var(--er-soft);border:1px solid var(--er-line)}
.eiq-energy-review .er-switch button{padding:4px 12px;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--er-muted)}
.eiq-energy-review .er-switch button[aria-pressed="true"]{background:#fff;color:var(--er-green);box-shadow:0 1px 3px rgba(22,63,49,.18)}
.eiq-energy-review .er-plot{position:relative}
.eiq-energy-review .er-scroll{overflow-x:auto}
.eiq-energy-review svg{display:block;max-width:none;overflow:visible}
.eiq-energy-review svg text{font-family:inherit;font-size:11px;fill:${MUTED}}
.eiq-energy-review svg text.dark{fill:${INK};font-weight:600}
.eiq-energy-review svg .er-hit{fill:transparent;cursor:crosshair}
.eiq-energy-review svg .er-dim{transition:opacity .15s}
.eiq-energy-review .er-tip{position:absolute;z-index:4;pointer-events:none;min-width:150px;padding:9px 11px;border-radius:10px;background:var(--er-ink);color:#fff;font-size:12px;line-height:1.45;box-shadow:0 12px 28px -12px rgba(16,24,20,.55);transform:translate(-50%,calc(-100% - 12px));white-space:nowrap}
.eiq-energy-review .er-tip.er-left{transform:translate(-14%,calc(-100% - 12px))}
.eiq-energy-review .er-tip.er-right{transform:translate(-86%,calc(-100% - 12px))}
.eiq-energy-review .er-tip b{display:block;font-weight:650;margin-bottom:3px}
.eiq-energy-review .er-tip .er-row{display:flex;align-items:center;gap:8px;justify-content:space-between}
.eiq-energy-review .er-tip .er-row span:first-child{display:flex;align-items:center;gap:6px;color:#C9D4CE}
.eiq-energy-review .er-tip .er-row i{width:9px;height:9px;border-radius:2px;display:block}
.eiq-energy-review .er-tip .er-row.er-sum{border-top:1px solid rgba(255,255,255,.18);margin-top:4px;padding-top:4px;font-weight:650}
.eiq-energy-review .er-tip em{display:block;font-style:normal;color:#E7C58F;margin-top:3px}
.eiq-energy-review .er-key{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.eiq-energy-review .er-key>*{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border:1px solid var(--er-line);border-radius:999px;font-size:12.5px;color:var(--er-body);background:#fff;transition:opacity .15s,border-color .15s}
.eiq-energy-review .er-key i{width:10px;height:10px;border-radius:3px;display:block}
.eiq-energy-review .er-key button:hover{border-color:#BBD3C6}
.eiq-energy-review .er-key button[aria-pressed="false"]{opacity:.45}
.eiq-energy-review .er-key button[aria-pressed="false"] i{background:transparent!important;outline:1.5px solid var(--er-faint);outline-offset:-1.5px}
.eiq-energy-review .er-key .er-reset{border-style:dashed;color:var(--er-green);font-weight:600}

/* rings */
.eiq-energy-review .er-ring{display:grid;grid-template-columns:auto minmax(0,1fr);gap:28px;align-items:center}
.eiq-energy-review .er-ring.er-stacked{grid-template-columns:1fr;gap:16px;justify-items:center}
.eiq-energy-review .er-ring.er-stacked .er-legend{width:100%}
.eiq-energy-review .er-ring path{transition:opacity .15s,transform .15s;cursor:pointer}
.eiq-energy-review .er-legend{display:grid;gap:2px;font-size:13.5px}
.eiq-energy-review .er-legend>*{display:grid;grid-template-columns:12px minmax(0,1fr) minmax(40px,90px) auto 42px;gap:10px;align-items:center;padding:6px 8px;border-radius:8px;text-align:left;font-variant-numeric:tabular-nums;transition:background .15s,opacity .15s}
.eiq-energy-review .er-legend>.er-on{background:var(--er-soft)}
.eiq-energy-review .er-legend.er-focus>*:not(.er-on){opacity:.5}
.eiq-energy-review .er-legend i{width:11px;height:11px;border-radius:3px;display:block}
.eiq-energy-review .er-legend em{font-style:normal;color:var(--er-ink);min-width:0;overflow-wrap:anywhere}
.eiq-energy-review .er-legend .er-track{height:5px;border-radius:3px;background:var(--er-line);overflow:hidden}
.eiq-energy-review .er-legend .er-track span{display:block;height:100%;border-radius:3px}
.eiq-energy-review .er-legend .er-pct{color:var(--er-muted);text-align:right}
.eiq-energy-review .er-blocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:22px}
.eiq-energy-review .er-blocks .er-fig{margin-top:0}
.eiq-energy-review .er-blocks h3{margin:0 0 12px;font-size:17px}
.eiq-energy-review .er-ring.er-stacked .er-legend>*{grid-template-columns:12px minmax(0,1fr) 48px auto 38px}
@container (min-width:681px){
  .eiq-energy-review .er-blocks>:last-child:nth-child(odd){grid-column:1/-1}
  .eiq-energy-review .er-blocks>:last-child:nth-child(odd) .er-ring.er-stacked{grid-template-columns:auto minmax(0,1fr);justify-items:stretch;gap:28px}
  .eiq-energy-review .er-blocks>:last-child:nth-child(odd) .er-ring.er-stacked .er-legend>*{grid-template-columns:12px minmax(0,1fr) minmax(40px,90px) auto 42px}
}

/* like for like */
.eiq-energy-review .er-pairs{display:grid}
.eiq-energy-review .er-pair{display:grid;grid-template-columns:minmax(120px,30%) minmax(0,1fr) 84px;gap:14px;align-items:center;padding:8px 6px;border-bottom:1px solid var(--er-line);font-size:13px;border-radius:6px;transition:background .15s}
.eiq-energy-review .er-pair:last-child{border-bottom:0}
.eiq-energy-review .er-pair:hover{background:var(--er-soft)}
.eiq-energy-review .er-pair>span:first-child{color:var(--er-ink);font-weight:500}
.eiq-energy-review .er-bars{display:grid;gap:4px}
.eiq-energy-review .er-bar{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--er-muted);font-variant-numeric:tabular-nums}
.eiq-energy-review .er-bar>span{display:block;height:9px;min-width:2px;border-radius:0 3px 3px 0;transition:width .3s}
.eiq-energy-review .er-gap{justify-self:end;font-size:11.5px;font-weight:600;color:var(--er-muted);background:var(--er-soft);border-radius:999px;padding:2px 8px;white-space:nowrap}
.eiq-energy-review .er-gap.er-wide{background:var(--er-bronze-soft);color:#7C5320}
.eiq-energy-review .er-alert{display:flex;gap:12px;align-items:flex-start;margin-top:12px;padding:10px 14px;border-radius:10px;background:var(--er-bronze-soft);color:#5E3E14;font-size:13px;line-height:1.5}
.eiq-energy-review .er-alert b{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--er-bronze);color:#fff;font-size:12px;font-weight:800}
.eiq-energy-review .er-alert p{margin:0;max-width:none}
.eiq-energy-review .er-pair-total{border-top:1.5px solid var(--er-ink);border-bottom:0;margin-top:2px}
.eiq-energy-review .er-pair-total>span:first-child{font-weight:700}
.eiq-energy-review .er-timeline{list-style:none;margin-top:16px;border-top:1px solid var(--er-line);padding-top:6px;display:grid}
.eiq-energy-review .er-timeline li{display:grid;grid-template-columns:minmax(92px,auto) minmax(0,1fr);gap:14px;align-items:baseline;padding:8px 0;border-bottom:1px dashed var(--er-line);font-size:13.5px}
.eiq-energy-review .er-timeline li:last-child{border-bottom:0}
.eiq-energy-review .er-timeline time{font-weight:700;color:var(--er-green);font-variant-numeric:tabular-nums;white-space:nowrap}
.eiq-energy-review .er-callout{display:flex;gap:14px;margin-top:20px;padding:14px 18px;border-radius:12px;background:var(--er-bronze-soft);max-width:none}
.eiq-energy-review .er-callout::before{content:"";flex:none;width:3px;border-radius:2px;background:var(--er-bronze)}

/* checks, notes and steps */
.eiq-energy-review .er-checks{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:16px}
.eiq-energy-review .er-checks li{display:grid;grid-template-columns:34px minmax(0,1fr);gap:4px;padding:16px 18px;border:1px solid var(--er-line);border-radius:14px;background:#fff}
.eiq-energy-review .er-checks li>b{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--er-bronze-soft);color:#7C5320;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.eiq-energy-review .er-checks p{margin:2px 0 0;font-size:14px;line-height:1.55}
.eiq-energy-review .er-checks strong{display:block;margin-bottom:2px}
.eiq-energy-review .er-checks .er-ask{grid-column:2;justify-self:start;margin-top:4px;padding:6px 0;font-size:13px;font-weight:600;color:var(--er-green);text-decoration:underline;text-decoration-color:#BBD3C6;text-underline-offset:3px;transition:color .15s,text-decoration-color .15s}
.eiq-energy-review .er-checks .er-ask:hover{color:var(--er-green-deep);text-decoration-color:currentColor}
.eiq-energy-review .er-follow{list-style:none;margin-top:16px;display:grid;gap:10px}
.eiq-energy-review .er-follow li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:start;padding:14px 18px;border:1px solid var(--er-line);border-radius:14px;background:#fff}
.eiq-energy-review .er-follow li.er-closed{background:var(--er-soft)}
.eiq-energy-review .er-follow p{margin:0;max-width:none;font-size:14px;line-height:1.55;color:var(--er-ink)}
.eiq-energy-review .er-follow li.er-closed p{color:var(--er-muted)}
.eiq-energy-review .er-follow .er-evidence{grid-column:1/-1;font-size:13px;color:var(--er-muted)}
.eiq-energy-review .er-chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:650;line-height:1.6;white-space:nowrap;background:var(--er-bronze-soft);color:#7C5320}
.eiq-energy-review .er-chip.er-chip-resolved,.eiq-energy-review .er-chip.er-chip-done{background:var(--er-green-soft);color:var(--er-green)}
.eiq-energy-review .er-chip.er-chip-dropped{background:#EEF1EF;color:var(--er-muted)}
.eiq-energy-review .er-known{margin:10px 0 0 20px;display:grid;gap:6px;font-size:14px;max-width:68ch}
.eiq-energy-review .er-known li{padding-left:2px}
.eiq-energy-review .er-known strong{font-weight:600}
.eiq-energy-review .er-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:52px;padding-top:52px;border-top:1px solid var(--er-line)}
.eiq-energy-review .er-two>.er-sec{margin:0;padding:22px 24px;border:1px solid var(--er-line);border-radius:16px;background:var(--er-soft)}
.eiq-energy-review .er-two h2{font-size:21px}
.eiq-energy-review .er-steps{list-style:none;counter-reset:step;margin-top:14px;display:grid;gap:10px}
.eiq-energy-review .er-steps li{counter-increment:step;display:grid;grid-template-columns:34px minmax(0,1fr);gap:4px;padding:14px 18px;border:1px solid var(--er-line);border-radius:14px}
.eiq-energy-review .er-steps li::before{content:counter(step);display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--er-green);color:#fff;font-size:12.5px;font-weight:700}
.eiq-energy-review .er-steps p{margin:2px 0 0;color:var(--er-ink)}
.eiq-energy-review .er-tags{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:12.5px;color:var(--er-muted)}
.eiq-energy-review .er-tags b{font-weight:600;color:var(--er-body)}

/* tables */
.eiq-energy-review .er-table{overflow-x:auto;margin-top:14px}
.eiq-energy-review table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
.eiq-energy-review th{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--er-muted);font-weight:700;text-align:left;padding:9px 12px 9px 0;border-bottom:1.5px solid var(--er-ink);vertical-align:bottom;white-space:nowrap}
.eiq-energy-review th button{display:inline-flex;align-items:center;gap:4px;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit}
.eiq-energy-review th button:hover{color:var(--er-ink)}
.eiq-energy-review th button span{font-size:9px;color:var(--er-faint)}
.eiq-energy-review th[aria-sort] button span{color:var(--er-green)}
.eiq-energy-review td{padding:11px 12px 11px 0;border-bottom:1px solid var(--er-line);vertical-align:top}
.eiq-energy-review tbody tr{transition:background .12s}
.eiq-energy-review tbody tr:hover{background:#FAFBFA}
.eiq-energy-review .r{text-align:right}
.eiq-energy-review td.r{white-space:nowrap}
.eiq-energy-review tr.er-total td{font-weight:700;color:var(--er-ink);border-top:1.5px solid var(--er-ink);border-bottom:0}
.eiq-energy-review td small{display:block;font-size:12.5px;color:var(--er-muted);margin-top:2px}
.eiq-energy-review .er-proj td:first-child{font-weight:600;color:var(--er-ink)}
.eiq-energy-review .er-sav td.er-pick{width:30px;padding-right:6px}
.eiq-energy-review .er-sav input{width:16px;height:16px;accent-color:var(--er-green);margin-top:3px;cursor:pointer}
.eiq-energy-review .er-sav tr.er-off td:not(.er-pick){opacity:.4}
.eiq-energy-review .er-sav td.er-barcell{width:32%;vertical-align:middle}
.eiq-energy-review .er-sav .er-barcell span{display:block;height:10px;border-radius:0 3px 3px 0;background:linear-gradient(90deg,#4E8F72,var(--er-green));min-width:2px;transition:width .3s}
.eiq-energy-review .er-more{margin-top:12px;padding:7px 14px;border:1px solid var(--er-line);border-radius:999px;font-size:13px;font-weight:600;color:var(--er-green)!important}
.eiq-energy-review .er-more:hover{background:var(--er-soft)}
.eiq-energy-review dl.er-assume{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin-top:16px;border-top:1px solid var(--er-line);border-left:1px solid var(--er-line);border-radius:14px 0 0 0;overflow:hidden}
.eiq-energy-review dl.er-assume>div{padding:12px 16px;border-right:1px solid var(--er-line);border-bottom:1px solid var(--er-line)}
.eiq-energy-review dl.er-assume dt{font-size:12px;color:var(--er-muted)}
.eiq-energy-review dl.er-assume dd{font-size:14px;font-weight:600;color:var(--er-ink);margin-top:2px;font-variant-numeric:tabular-nums}
.eiq-energy-review footer{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--er-line);margin-top:52px;padding-top:14px;font-size:12px;color:var(--er-muted)}
@container (max-width:680px){
  .eiq-energy-review .er-page{padding:0 16px 48px}
  .eiq-energy-review .er-nav{padding:8px 0}
  .eiq-energy-review .er-nav ol{padding:0 16px}
  .eiq-energy-review .er-sec{padding-top:40px;margin-top:40px}
  .eiq-energy-review .er-fig{padding:14px 12px 12px;border-radius:12px}
  .eiq-energy-review .er-meta,.eiq-energy-review .er-two{grid-template-columns:1fr}
  .eiq-energy-review .er-figs{grid-template-columns:repeat(2,minmax(0,1fr))}
  .eiq-energy-review .er-figs>:last-child:nth-child(odd){grid-column:1/-1}
  .eiq-energy-review .er-fig-tile{padding:14px 14px 13px}
  .eiq-energy-review .er-fig-tile b{font-size:26px}
  .eiq-energy-review .er-fig-label{font-size:12.5px}
  .eiq-energy-review .er-fig-tile b small{font-size:12.5px}
  .eiq-energy-review .er-fig-detail{font-size:12px;padding-top:8px}
  .eiq-energy-review .er-find-figure b{font-size:25px}
  .eiq-energy-review .er-ring{grid-template-columns:1fr;justify-items:center}
  .eiq-energy-review .er-ring .er-legend{width:100%}
  .eiq-energy-review .er-legend>*{grid-template-columns:12px minmax(0,1fr) auto 38px}
  .eiq-energy-review .er-legend .er-track{display:none}
  .eiq-energy-review .er-pair{grid-template-columns:1fr auto;gap:6px 10px}
  .eiq-energy-review .er-pair .er-bars{grid-column:1/-1;grid-row:2}
  .eiq-energy-review .er-sav td.er-barcell{display:none}
  .eiq-energy-review .er-hint{display:none}
  .eiq-energy-review .er-follow li{grid-template-columns:1fr;padding:12px 14px}
  .eiq-energy-review .er-follow .er-chip{grid-row:1;justify-self:start}
}
@media (prefers-reduced-motion:reduce){.eiq-energy-review *{transition:none!important}}
@media print{
  .eiq-energy-review .er-nav,.eiq-energy-review .er-switch,.eiq-energy-review .er-hint,.eiq-energy-review .er-tip,.eiq-energy-review .er-more,.eiq-energy-review .er-reset,.eiq-energy-review .er-ask,.eiq-energy-review .er-fb{display:none!important}
  .eiq-energy-review .er-fig,.eiq-energy-review .er-checks li,.eiq-energy-review .er-steps li,.eiq-energy-review .er-follow li,.eiq-energy-review .er-figs,.eiq-energy-review .er-finds>li{break-inside:avoid}
  .eiq-energy-review .er-figs,.eiq-energy-review .er-find{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .eiq-energy-review .er-finds{grid-template-columns:repeat(2,minmax(0,1fr))}
  .eiq-energy-review .er-find-go{display:none}
  .eiq-energy-review svg{max-width:100%;height:auto}
  .eiq-energy-review .er-scroll{overflow:visible}
}
`;

// ---------- small pieces ----------

/** A rectangle with its top corners rounded, for bars standing on the baseline. */
function topRounded(x: number, y: number, w: number, h: number, radius: number) {
  if (h <= 0) return "";
  const r = Math.min(radius, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** A readout over a chart: `x` and `y` are where it points, in the chart's own space; it turns inward near the edges. */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const side = x < 110 ? " er-left" : x > width - 110 ? " er-right" : "";
  return <div className={`er-tip${side}`} role="status" style={{ left: x, top: Math.max(y, 8) }}>{children}</div>;
}
const TipRow = ({ colour, label, value, sum }: { colour?: string | undefined; label: string; value: string; sum?: boolean | undefined }) =>
  <div className={`er-row${sum ? " er-sum" : ""}`}><span>{colour && <i style={{ background: colour }} />}{label}</span><span>{value}</span></div>;

/** The scroll offset of a chart that is wider than its box, so a readout stays over the bar it describes. */
function useScrollLeft() {
  const [left, setLeft] = useState(0);
  return [left, (event: { currentTarget: HTMLDivElement }) => setLeft(event.currentTarget.scrollLeft)] as const;
}

/** The chart-space x of a pointer over an SVG drawn `width` wide. */
const svgX = (event: PointerEvent<SVGElement>, width: number) => {
  const box = (event.currentTarget.ownerSVGElement ?? event.currentTarget as unknown as SVGSVGElement).getBoundingClientRect();
  return box.width ? (event.clientX - box.left) * (width / box.width) : 0;
};

/** Each topic's eyebrow over its heading and on its key finding: what the section is about, never a number. */
const EYEBROW: Record<EnergyReviewQuestion, Parameters<T>[0]> = {
  total: "eyebrow.total", groups: "eyebrow.groups", largest: "eyebrow.largest", comparison: "eyebrow.comparison",
  profile: "eyebrow.profile", littleUse: "eyebrow.littleUse", perLight: "eyebrow.perLight", savings: "eyebrow.savings",
};

const Question = ({ id, title, children, t, className }: { id: EnergyReviewQuestion; title: string; children: ReactNode; t: T; className?: string | undefined }) =>
  <section id={sectionId(`q-${id}`)} className={`er-sec${className ? ` ${className}` : ""}`}>
    <SectionTools id={`q-${id}`} />
    <div className="er-kicker">{t(EYEBROW[id])}</div>
    <h2>{title}</h2>
    <SectionSlot id={`q-${id}`} />
    {children}
  </section>;

// ---------- key findings ----------

/** A small line icon for each key finding, drawn in the card's accent colour on a 24-unit grid. */
const FINDING_ICON: Record<EnergyReviewQuestion | "checks", ReactNode> = {
  total: <path d="M13 3 5.5 13.5H11l-1 7.5 7.5-10.5H12z" />,
  groups: <><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" /><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z" /></>,
  largest: <><path d="M4 6h15" /><path d="M4 12h10" /><path d="M4 18h5.5" /></>,
  comparison: <><path d="M4 8h15l-3.5-3.5" /><path d="M20 16H5l3.5 3.5" /></>,
  profile: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  checks: <><path d="M12 4 3 19.5h18z" /><path d="M12 10v4.2" /><path d="M12 17.2h.01" /></>,
  littleUse: <><path d="M12 3.5V11" /><path d="M7.4 6.6a7 7 0 1 0 9.2 0" /></>,
  perLight: <><path d="M9.5 18h5" /><path d="M10.5 21h3" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" /></>,
  savings: <><path d="M5 19c.6-8.4 5.6-13.4 14-14-.6 8.4-5.6 13.4-14 14z" /><path d="M5 19l7.5-7.5" /></>,
};
type Finding = { key: string; href: string; icon: ReactNode; topic: string; headline: EnergyReviewHeadline; text: string; chip: string };

/**
 * The key findings as cards, each taking the reader to its section: topic, headline figure, one-sentence takeaway. The
 * link is named in one punctuated sentence ("Checks (Needs a check): 1 to check. Linkway lights has stopped reporting.").
 */
function KeyFindings({ findings, t }: { findings: Finding[]; t: T }) {
  return <ul className="er-finds">{findings.map(item => <li key={item.key}>
    <a className={`er-find er-tone-${item.headline.tone}`} href={item.href} aria-label={t("findings.aria", {
      topic: item.chip ? t("findings.ariaChip", { topic: item.topic, chip: item.chip }) : item.topic,
      headline: [item.headline.value, item.headline.unit].filter(Boolean).join(" "), text: item.text })}>
      <span className="er-find-top">
        <span className="er-find-icon" aria-hidden="true"><svg viewBox="0 0 24 24">{item.icon}</svg></span>
        <span className="er-find-topic">{item.topic}</span>
        <span className="er-find-go" aria-hidden="true">→</span>
      </span>
      <span className="er-find-figure"><b>{item.headline.value}</b>{item.headline.unit && <small>{item.headline.unit}</small>}</span>
      <span className="er-find-text">{item.text}</span>
      {item.chip && <span className="er-find-foot"><span className="er-chip">{item.chip}</span></span>}
    </a>
  </li>)}</ul>;
}

// ---------- feedback on a section ----------

/**
 * On the live page, each section can take feedback: a "Give feedback" button at its top right, and a place under its
 * heading where the page shows its own feedback box. `id` is the section's id without "er-" ("summary", "q-total",
 * "checks"…), `title` how the section is named in the bar ("Total use"). The page supplies the wording.
 */
export type ReviewSectionFeedback = {
  label: string;
  ariaLabel: (title: string) => string;
  open: (section: { id: string; title: string }) => void;
  /** The section whose box is open, so its button says so. */
  openId?: string | null | undefined;
  /** What the page shows under the heading of section `id`: its feedback box when open, else nothing. */
  slot?: ((id: string) => ReactNode) | undefined;
};
const FeedbackContext = createContext<{ feedback: ReviewSectionFeedback; titleOf: (id: string) => string } | null>(null);
const COMMENT_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;
/** The section's "Give feedback" button; the section's id and name ride on it, so a text selection can find them. */
function SectionTools({ id }: { id: string }) {
  const context = useContext(FeedbackContext);
  if (!context) return null;
  const title = context.titleOf(id);
  return <button type="button" className="er-fb" data-feedback-section={id} data-feedback-title={title} aria-expanded={context.feedback.openId === id}
    aria-label={context.feedback.ariaLabel(title)} onClick={() => context.feedback.open({ id, title })}>{COMMENT_ICON}{context.feedback.label}</button>;
}
function SectionSlot({ id }: { id: string }) {
  const context = useContext(FeedbackContext);
  return <>{context?.feedback.slot?.(id) ?? null}</>;
}

// ---------- the bar of sections ----------

type NavItem = { id: string; label: string };

/** The sections as a bar that stays at the top while the review scrolls, marking the one being read. */
function SectionNav({ items, t, live }: { items: NavItem[]; t: T; live: boolean }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const list = useRef<HTMLOListElement>(null);
  const ids = items.map(item => item.id).join(" ");
  useEffect(() => {
    if (!live || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
      const first = items.find(item => seen.get(item.id));
      if (first) setActive(first.id);
    }, { rootMargin: "-90px 0px -60% 0px" });
    for (const item of items) { const node = document.getElementById(item.id); if (node) observer.observe(node); }
    return () => observer.disconnect();
  }, [ids, live]);
  // Keeps the marked section in sight along the bar, without moving the page.
  useEffect(() => {
    const bar = list.current, chip = bar?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (bar && chip) bar.scrollLeft = chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2;
  }, [active]);
  return <nav className="er-nav" aria-label={t("nav.aria")}>
    <ol ref={list}>{items.map(item => <li key={item.id}>
      <a href={`#${item.id}`} data-section={item.id} aria-current={live && active === item.id ? "true" : undefined}>{item.label}</a>
    </li>)}</ol>
  </nav>;
}

// ---------- 1. energy each day ----------

function DailyBars({ review, live }: { review: EnergyReview; live: boolean }) {
  const t = reviewText(review);
  const days = review.total!.days;
  const typical = review.total!.projection[0] ?? null;
  const [mode, setMode] = useState<"kwh" | "cost">("kwh");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, measured] = useWidth(780);
  const [scrollLeft, onScroll] = useScrollLeft();
  const withCost = review.rate != null;
  const costMode = withCost && mode === "cost";
  const valueOf = (day: (typeof days)[number]) => costMode ? day.cost ?? 0 : day.kwh;
  const typicalValue = typical ? costMode ? typical.cost : typical.kwh : null;
  const width = Math.max(measured, days.length * 30 + 60);
  const staticCost = withCost && !live;
  const height = staticCost ? 248 : 232;
  const m = { l: 44, r: 12, t: 26, b: staticCost ? 62 : 46 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const ticks = niceTicks(Math.max(...days.map(valueOf), typicalValue ?? 0, 0.001) * 1.15);
  const top = ticks.at(-1)!;
  const y = (value: number) => m.t + ph - value / top * ph;
  const band = pw / Math.max(days.length, 1);
  const barW = Math.min(46, Math.max(4, band * 0.6));
  const every = band >= 40 ? 1 : band >= 18 ? 2 : 7;
  const day = hover == null ? null : days[hover]!;
  return <figure className="er-fig">
    <figcaption className="er-fig-head">
      <span style={{ display: "grid", gap: 4 }}>
        <span className="er-fig-title">{costMode ? t("chart.costTitle", { currency: review.currency === "SGD" ? "S$" : review.currency }) : t("total.chartTitle")}</span>
        {typicalValue != null && typicalValue > 0 && <span className="er-typ"><i aria-hidden="true" />{t("chart.typical", { value: costMode ? moneyText(typicalValue, review.currency, 2) : kwhLabel(typicalValue) })}</span>}
      </span>
      {live && <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="er-hint">{t("chart.hint")}</span>
        {withCost && <span className="er-switch" role="group" aria-label={t("chart.show")}>
          <button type="button" aria-pressed={mode === "kwh"} onClick={() => setMode("kwh")}>{t("chart.energy")}</button>
          <button type="button" aria-pressed={mode === "cost"} onClick={() => setMode("cost")}>{t("chart.cost")}</button>
        </span>}
      </span>}
    </figcaption>
    <div className="er-plot">
      <div className="er-scroll" ref={ref} onScroll={onScroll}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("total.chartTitle")} onPointerLeave={event => { if (event.pointerType === "mouse") setHover(null); }}>
        {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={LINE} strokeDasharray={tick === 0 ? undefined : "2 4"} /><text x={m.l - 10} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
        {days.map((item, index) => {
          const x = m.l + band * index + (band - barW) / 2;
          const value = valueOf(item);
          const [weekday, ...rest] = item.label.split(" ");
          const show = index % every === 0;
          const dim = hover != null && hover !== index;
          return <g key={item.date}>
            <path className="er-dim" d={topRounded(x, y(value), barW, Math.max(0, y(0) - y(value)), 4)} fill={item.complete ? hover === index ? "#174635" : P[0] : "#A9C1B6"} opacity={dim ? 0.4 : 1}>
              {!live && <title>{[`${item.label} · ${num(item.kwh)} kWh`, item.cost != null ? moneyText(item.cost, review.currency, 2) : null, item.complete ? null : t("total.missingDay")].filter(Boolean).join(" · ")}</title>}
            </path>
            {band >= 34 && value > 0 && <text className="dark" x={x + barW / 2} y={y(value) - 7} textAnchor="middle" opacity={dim ? 0.35 : 1} style={{ fontSize: 10.5 }}>{costMode ? num(value, 2) : num(value)}</text>}
            {show && <text className="dark" x={x + barW / 2} y={height - m.b + 17} textAnchor="middle">{weekday}</text>}
            {show && <text x={x + barW / 2} y={height - m.b + 31} textAnchor="middle">{rest.join(" ")}</text>}
            {show && staticCost && item.cost != null && band >= 34 && <text x={x + barW / 2} y={height - m.b + 47} textAnchor="middle" style={{ fill: BRONZE }}>{moneyText(item.cost, review.currency, 2)}</text>}
            {live && <rect className="er-hit" x={m.l + band * index} y={m.t} width={band} height={ph} tabIndex={0} aria-label={`${item.label}: ${num(item.kwh)} kWh`}
              onPointerEnter={() => setHover(index)} onPointerDown={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />}
          </g>;
        })}
        {typicalValue != null && typicalValue > 0 && <g pointerEvents="none">
          <line x1={m.l} x2={width - m.r} y1={y(typicalValue)} y2={y(typicalValue)} stroke={BRONZE} strokeWidth={1.5} strokeDasharray="6 4" />
        </g>}
        <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={MUTED} />
      </svg></div>
      {live && day && hover != null && <Tip x={m.l + band * (hover + 0.5) - scrollLeft} y={y(valueOf(day))} width={measured}>
        <b>{day.label}</b>
        <TipRow label={t("chart.energy")} value={`${num(day.kwh)} kWh`} />
        {day.cost != null && <TipRow label={review.costBasis ? `${t("chart.cost")} (${review.costBasis})` : t("chart.cost")} value={moneyText(day.cost, review.currency, 2)} />}
        {typical && typical.kwh > 0 && <TipRow label={t("chart.vsTypical")} value={`${day.kwh >= typical.kwh ? "+" : "−"}${pct(Math.abs(day.kwh / typical.kwh - 1))}`} />}
        {worthSaying(day.recoveredKwh, day.kwh) ? <em>{t("chart.recovered", { kwh: kwhLabel(day.recoveredKwh) })}</em> : !day.complete && <em>{t("total.missingDay")}</em>}
      </Tip>}
    </div>
    {review.total!.outage && <div className="er-alert" role="note"><b aria-hidden="true">!</b><p>{review.total!.outage}</p></div>}
    <p className="er-note">{review.total!.caption}{staticCost && review.total!.costCaption ? `${review.locale === "zh-Hans" ? "" : " "}${review.total!.costCaption}` : ""}{days.some(item => !item.complete && item.kwh > 0) ? review.locale === "zh-Hans" ? `${t("total.legendMissing")}。` : ` ${t("total.legendMissing")}.` : ""}</p>
  </figure>;
}

// ---------- rings ----------

/** A ring of slices with a figure in the middle, and the slices listed beside it; pointing at either picks the slice out. */
function Ring({ slices, centre, unit, value, size = 188, stacked, live, t }: { slices: EnergyReviewSlice[]; centre: string; unit: string; value: (slice: EnergyReviewSlice) => string; size?: number; stacked?: boolean | undefined; live: boolean; t: T }) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const pad = 6, r = size / 2 - pad, inner = r * 0.62, c = size / 2;
  const maxShare = Math.max(...slices.map(slice => slice.share), 0.001);
  let angle = -Math.PI / 2;
  const arcs = slices.map(slice => {
    const sweep = slice.value / total * Math.PI * 2;
    const start = angle, end = angle + sweep, mid = start + sweep / 2;
    angle = end;
    const p = (radius: number, a: number) => `${(c + radius * Math.cos(a)).toFixed(2)},${(c + radius * Math.sin(a)).toFixed(2)}`;
    if (sweep >= Math.PI * 2 - 1e-6) return { slice, mid, d: `M${c},${c - r} A${r},${r} 0 1 1 ${c - 0.01},${c - r} L${c - 0.01},${c - inner} A${inner},${inner} 0 1 0 ${c},${c - inner} Z` };
    const large = sweep > Math.PI ? 1 : 0;
    return { slice, mid, d: `M${p(r, start)} A${r},${r} 0 ${large} 1 ${p(r, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z` };
  });
  const picked = active == null ? null : slices[active]!;
  return <div className={`er-ring${stacked ? " er-stacked" : ""}`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centre} ${unit}`} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }}>
      {arcs.map((arc, index) => {
        const lift = active === index ? 5 : 0;
        return <path key={arc.slice.name} d={arc.d} fill={arc.slice.colour} stroke="#fff" strokeWidth={2} strokeLinejoin="round"
          style={{ transform: `translate(${(Math.cos(arc.mid) * lift).toFixed(2)}px,${(Math.sin(arc.mid) * lift).toFixed(2)}px)`, opacity: active != null && active !== index ? 0.32 : 1 }}
          onPointerEnter={live ? () => setActive(index) : undefined} onPointerDown={live ? () => setActive(index) : undefined}>
          {!live && <title>{`${arc.slice.name} · ${value(arc.slice)} · ${pct(arc.slice.share)}`}</title>}
        </path>;
      })}
      {picked ? <>
        <text className="dark" x={c} y={c - 2} textAnchor="middle" style={{ fontSize: 19, fontWeight: 700 }}>{pct(picked.share)}</text>
        <text x={c} y={c + 16} textAnchor="middle" style={{ fontSize: 10.5 }}>{`${value(picked).replace(/\s*kWh$/, "")} ${unit}`}</text>
      </> : <>
        <text className="dark" x={c} y={c + 2} textAnchor="middle" style={{ fontSize: 21, fontWeight: 700 }}>{centre}</text>
        <text x={c} y={c + 20} textAnchor="middle" style={{ fontSize: 10.5 }}>{unit}</text>
      </>}
    </svg>
    <div className={`er-legend${active != null ? " er-focus" : ""}`}>{slices.map((slice, index) => {
      const cells = <>
        <i style={{ background: slice.colour }} /><em>{slice.name}</em>
        <span className="er-track"><span style={{ width: `${slice.share / maxShare * 100}%`, background: slice.colour }} /></span>
        <span className="r">{value(slice)}</span><span className="er-pct">{pct(slice.share)}</span>
      </>;
      return live
        ? <button key={slice.name} type="button" className={active === index ? "er-on" : undefined} aria-label={`${slice.name}: ${value(slice)}, ${t("chart.share", { pct: pct(slice.share) })}`}
            onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>{cells}</button>
        : <div key={slice.name}>{cells}</div>;
    })}</div>
  </div>;
}

// ---------- 4. like for like ----------

function Pairs({ review, t }: { review: EnergyReview; t: T }) {
  const comparison = review.comparison!;
  const max = Math.max(...comparison.rows.flatMap(row => row.perDay), ...(comparison.total?.perDay ?? []), 0.001);
  const two = comparison.groups.length === 2;
  return <figure className="er-fig">
    <figcaption className="er-fig-head"><span className="er-fig-title">{comparison.title}</span></figcaption>
    <div className="er-key">{comparison.groups.map(group => <span key={group.name}><i style={{ background: group.colour }} />{group.name}</span>)}</div>
    <div className="er-pairs">{[...comparison.rows, ...(comparison.total ? [comparison.total] : [])].map(row => {
      const [a = 0, b = 0] = row.perDay;
      const isTotal = row === comparison.total;
      const gap = two && Math.min(a, b) > 0 ? Math.abs(a - b) / Math.min(a, b) : null;
      return <div key={row.name} className={`er-pair${isTotal ? " er-pair-total" : ""}`}>
        <span>{row.name}</span>
        <span className="er-bars">{row.perDay.map((value, index) => <span key={comparison.groups[index]!.name} className="er-bar">
          <span style={{ width: `${value / max * 80}%`, background: comparison.groups[index]!.colour }} />{num(value, 2)}
        </span>)}</span>
        {two ? gap != null ? <span className={`er-gap${gap >= 0.15 ? " er-wide" : ""}`}>{gap >= 1 ? `${num(gap + 1)}×` : t("chart.gap", { pct: pct(gap) })}</span> : <span /> : null}
      </div>;
    })}</div>
  </figure>;
}

// ---------- 5. the average 24 hours ----------

/** The average day hour by hour, the layers stacked as steps; layers can be hidden, and pointing at an hour reads it out. */
function Layers({ review, live, t }: { review: EnergyReview; live: boolean; t: T }) {
  const profile = review.profile!;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [ref, measured] = useWidth(780);
  const [scrollLeft, onScroll] = useScrollLeft();
  const width = measured, height = 268;
  const m = { l: 50, r: 12, t: 16, b: 30 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const shown = profile.layers.filter(layer => !hidden.has(layer.key));
  const stackTop = Array.from({ length: 24 }, (_, hour) => shown.reduce((sum, layer) => sum + (layer.hours[hour] ?? 0), 0));
  const ticks = niceTicks(Math.max(...stackTop, 0.001) * 1.12);
  const top = ticks.at(-1)!;
  const x = (hour: number) => m.l + hour / 24 * pw;
  const y = (kw: number) => m.t + ph - kw / top * ph;
  const below = Array.from({ length: 24 }, () => 0);
  const shapes = shown.map(layer => {
    const bottom = [...below];
    for (let hour = 0; hour < 24; hour += 1) below[hour]! += layer.hours[hour] ?? 0;
    const topLine = Array.from({ length: 24 }, (_, hour) => `L${x(hour).toFixed(1)},${y(below[hour]!).toFixed(1)} L${x(hour + 1).toFixed(1)},${y(below[hour]!).toFixed(1)}`).join(" ");
    const bottomLine = Array.from({ length: 24 }, (_, index) => 23 - index).map(hour => `L${x(hour + 1).toFixed(1)},${y(bottom[hour]!).toFixed(1)} L${x(hour).toFixed(1)},${y(bottom[hour]!).toFixed(1)}`).join(" ");
    return { layer, d: `M${x(0).toFixed(1)},${y(bottom[0]!).toFixed(1)} ${topLine} ${bottomLine} Z` };
  });
  const toggle = (key: string) => setHidden(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else if (shown.length > 1) next.add(key);
    return next;
  });
  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const hour = Math.floor((svgX(event, width) - m.l) / pw * 24);
    setHover(hour >= 0 && hour < 24 ? hour : null);
  };
  return <figure className="er-fig">
    <figcaption className="er-fig-head">
      <span className="er-fig-title">{profile.title}</span>
      {live && <span className="er-hint">{t("chart.hint")}</span>}
    </figcaption>
    <div className="er-key">
      {profile.layers.map(layer => live
        ? <button key={layer.key} type="button" aria-pressed={!hidden.has(layer.key)} title={t("chart.toggleLayer", { name: layer.name })} onClick={() => toggle(layer.key)}><i style={{ background: layer.colour }} />{layer.name}</button>
        : <span key={layer.key}><i style={{ background: layer.colour }} />{layer.name}</span>)}
      {live && hidden.size > 0 && <button type="button" className="er-reset" onClick={() => setHidden(new Set())}>{t("chart.showAll")}</button>}
    </div>
    <div className="er-plot">
      <div className="er-scroll" ref={ref} onScroll={onScroll}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={profile.title}>
        {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={LINE} strokeDasharray={tick === 0 ? undefined : "2 4"} /><text x={m.l - 10} y={y(tick) + 4} textAnchor="end">{`${tick} kW`}</text></g>)}
        {shapes.map(shape => <path key={shape.layer.key} d={shape.d} fill={shape.layer.colour} stroke="#fff" strokeWidth={0.6} strokeOpacity={0.7}>{!live && <title>{shape.layer.name}</title>}</path>)}
        {hover != null && <g pointerEvents="none">
          <rect x={x(hover)} y={m.t} width={pw / 24} height={ph} fill={INK} opacity={0.08} />
          <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ph} stroke={INK} strokeOpacity={0.35} />
          <line x1={x(hover + 1)} x2={x(hover + 1)} y1={m.t} y2={m.t + ph} stroke={INK} strokeOpacity={0.35} />
        </g>}
        <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={MUTED} />
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => <text key={hour} x={x(hour)} y={height - 8} textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}>{clock(hour % 24, review.locale)}</text>)}
        {live && <rect className="er-hit" x={m.l} y={m.t} width={pw} height={ph} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={event => { if (event.pointerType === "mouse") setHover(null); }} />}
      </svg></div>
      {live && hover != null && <Tip x={x(hover + 0.5) - scrollLeft} y={y(stackTop[hover]!)} width={measured}>
        <b>{t("chart.hours", { from: clock(hover, review.locale), to: clock((hover + 1) % 24, review.locale) })}</b>
        {[...shown].reverse().map(layer => <TipRow key={layer.key} colour={layer.colour} label={layer.name} value={`${num(layer.hours[hover] ?? 0, 2)} kW`} />)}
        {shown.length > 1 && <TipRow sum label={t("chart.total")} value={`${num(stackTop[hover]!, 2)} kW`} />}
      </Tip>}
    </div>
    {profile.timeline.length > 0 && <ol className="er-timeline">{profile.timeline.map(moment => <li key={`${moment.time}|${moment.text}`}><time>{moment.time}</time><span>{moment.text}</span></li>)}</ol>}
  </figure>;
}

// ---------- 8. savings ----------

/** The measures with what each saves a year; on the page a measure can be left out and the total follows. */
function Savings({ review, live, t }: { review: EnergyReview; live: boolean; t: T }) {
  const savings = review.savings!;
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const withCost = savings.totalCost != null;
  const valueOf = (row: (typeof savings.rows)[number]) => row.costYear ?? row.kwhYear;
  const max = Math.max(...savings.rows.map(valueOf), 0.001);
  const kept = savings.rows.filter(row => !off.has(row.title));
  const keptKwh = kept.reduce((sum, row) => sum + row.kwhYear, 0);
  const keptCost = kept.reduce((sum, row) => sum + (row.costYear ?? 0), 0);
  const allIn = kept.length === savings.rows.length;
  const flip = (title: string) => setOff(current => { const next = new Set(current); if (next.has(title)) next.delete(title); else next.add(title); return next; });
  return <figure className="er-fig">
    <figcaption className="er-fig-head">
      <span className="er-fig-title">{savings.title}</span>
      {live && savings.rows.length > 1 && <span className="er-hint">{t("sav.pick")}</span>}
    </figcaption>
    <div className="er-table" style={{ marginTop: 0 }}><table className="er-sav">
      <thead><tr>{live && savings.rows.length > 1 && <th aria-hidden="true" />}<th>{t("sav.col.measure")}</th><th aria-hidden="true" /><th className="r">{t("sav.col.kwh")}</th>{withCost && <th className="r">{t("sav.col.cost", { currency: review.currency === "SGD" ? "S$" : review.currency })}</th>}</tr></thead>
      <tbody>
        {savings.rows.map(row => {
          const out = off.has(row.title);
          return <tr key={row.title} className={out ? "er-off" : undefined}>
            {live && savings.rows.length > 1 && <td className="er-pick"><input type="checkbox" checked={!out} onChange={() => flip(row.title)} aria-label={t("sav.include", { name: row.title })} /></td>}
            <td><strong>{row.title}</strong><small>{row.basis}</small></td>
            <td className="er-barcell"><span style={{ width: `${valueOf(row) / max * 100}%` }} /></td>
            <td className="r">{whole(row.kwhYear)}</td>
            {withCost && <td className="r">{row.costYear == null ? "—" : moneyText(row.costYear, review.currency)}</td>}
          </tr>;
        })}
        {savings.rows.length > 1 && <tr className="er-total">
          {live && <td />}
          <td>{allIn ? t("sav.total") : t("sav.selected", { count: kept.length, all: savings.rows.length })}</td><td />
          <td className="r">{whole(allIn ? savings.totalKwh : keptKwh)}</td>
          {withCost && <td className="r">{moneyText(allIn ? savings.totalCost! : keptCost, review.currency)}</td>}
        </tr>}
      </tbody>
    </table></div>
    {savings.note && <p className="er-note">{savings.note}</p>}
  </figure>;
}

// ---------- method: the meters ----------

type SortKey = "name" | "group" | "perDay";
const SHORT_LIST = 8;

function MeterTable({ meters, live, t }: { meters: EnergyReviewMeter[]; live: boolean; t: T }) {
  const [sort, setSort] = useState<{ key: SortKey; up: boolean } | null>(null);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    if (!sort) return meters;
    const factor = sort.up ? 1 : -1;
    return [...meters].sort((a, b) => sort.key === "perDay" ? ((a.perDay ?? -1) - (b.perDay ?? -1)) * factor : a[sort.key].localeCompare(b[sort.key]) * factor);
  }, [meters, sort]);
  const shown = live && !all ? rows.slice(0, SHORT_LIST) : rows;
  const head = (key: SortKey, label: string, right?: boolean) => {
    const on = sort?.key === key;
    return <th className={right ? "r" : undefined} aria-sort={on ? sort!.up ? "ascending" : "descending" : undefined}>{live
      ? <button type="button" title={t("met.sort", { column: label })} onClick={() => setSort(current => current?.key === key ? { key, up: !current.up } : { key, up: key !== "perDay" })}>{label}<span aria-hidden="true">{on ? sort!.up ? "▲" : "▼" : "↕"}</span></button>
      : label}</th>;
  };
  return <>
    <div className="er-table"><table>
      <thead><tr>{head("name", t("met.col.meter"))}{head("group", t("met.col.group"))}{head("perDay", t("met.col.perDay"), true)}<th>{t("met.col.basis")}</th></tr></thead>
      <tbody>{shown.map(meter => <tr key={meter.id}><td style={{ color: INK, fontWeight: 500 }}>{meter.name}</td><td>{meter.group || "—"}</td><td className="r">{num(meter.perDay, 2)}</td><td><small style={{ marginTop: 0 }}>{meter.basis}</small></td></tr>)}</tbody>
    </table></div>
    {live && meters.length > SHORT_LIST && <button type="button" className="er-more" onClick={() => setAll(value => !value)} aria-expanded={all}>{all ? t("met.showFewer") : t("met.showAll", { count: meters.length })}</button>}
  </>;
}

// ---------- follow-ups from feedback ----------

/** The chip a follow-up wears: closed ones say how they closed; open ones say what the latest check found. */
const followUpChip = (item: EnergyReviewFollowUp): { kind: string; key: Parameters<T>[0] } =>
  item.status === "done" ? { kind: "done", key: "followUps.status.done" }
    : item.status === "dropped" ? { kind: "dropped", key: "followUps.status.dropped" }
    : item.verdict === "resolved" ? { kind: "resolved", key: "followUps.status.resolved" }
    : item.verdict === "ongoing" ? { kind: "ongoing", key: "followUps.status.ongoing" }
    : { kind: "open", key: "followUps.status.open" };

// ---------- the document ----------

/**
 * The review itself, from one `EnergyReview` and nothing else. `standalone` is for a saved or downloaded copy: a title
 * block in place of the page's own heading, and no moving parts. `onCheckFeedback`: on the live page, each point to
 * check offers "Tell the AI about this", which hands the point's stable key and title to the page around the review.
 */
export function EnergyReviewDocument({ review, standalone, onCheckFeedback, sectionFeedback }: { review: EnergyReview; standalone?: boolean | undefined; onCheckFeedback?: ((check: { key: string; title: string }) => void) | undefined; sectionFeedback?: ReviewSectionFeedback | undefined }) {
  const t = reviewText(review);
  const live = !standalone;
  const { cover, summary, total, groups, largest, comparison, profile, checks, littleUse, perLight, savings, nextSteps, method } = review;
  // Reviews built before feedback existed have neither list.
  const followUps = review.followUps ?? [];
  const memory = review.memory ?? [];
  const setAside = method.setAside ?? [];
  const has = (id: EnergyReviewQuestion) => review.questions.includes(id);
  const costHead = review.costBasis ? t("total.col.costBasis", { basis: review.costBasis }) : t("total.col.cost");
  const withCarbon = review.carbonFactor != null;
  const co2Cell = (kg: number | null) => kg == null ? "—" : kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${kg.toFixed(1)} kg`;
  const pair = has("littleUse") && has("perLight");
  const littleSection = has("littleUse") && littleUse && <Question id="littleUse" title={littleUse.heading} t={t}><p><Rich text={littleUse.text} /></p></Question>;
  const lightSection = has("perLight") && perLight && <Question id="perLight" title={perLight.heading} t={t}><p><Rich text={perLight.text} /></p></Question>;
  const navLabel: Record<EnergyReviewQuestion, Parameters<T>[0]> = { total: "nav.total", groups: "nav.groups", largest: "nav.largest", comparison: "nav.comparison", profile: "nav.profile", littleUse: "nav.littleUse", perLight: "nav.perLight", savings: "nav.savings" };
  // The points to check and the follow-ups come after the 24 hours (or before the method, without it).
  const afterProfile: NavItem[] = [
    ...(checks.length ? [{ id: sectionId("checks"), label: t("nav.checks") }] : []),
    ...(followUps.length ? [{ id: sectionId("followups"), label: t("nav.followUps") }] : []),
  ];
  const nav: NavItem[] = [
    { id: sectionId("summary"), label: t("nav.summary") },
    ...review.questions.flatMap(id => {
      const item = { id: sectionId(`q-${id}`), label: t(navLabel[id]) };
      return id === "profile" ? [item, ...afterProfile] : [item];
    }),
    ...(!has("profile") ? afterProfile : []),
    { id: sectionId("method"), label: t("nav.method") },
  ];
  // Links inside the review glide to their section rather than jump, and leave the page address alone.
  const glide = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as HTMLElement).closest?.("a[href^='#er-']");
    if (!live || !link) return;
    const target = document.getElementById(link.getAttribute("href")!.slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  };
  // Each section's name as the bar shows it ("Total use"), for the feedback it is given.
  const titles = new Map(nav.map(item => [item.id.replace(/^er-/, ""), item.label]));
  // The key findings: one per topic, and the points to check as a finding of their own after the 24 hours (or last).
  const checksFinding: Finding[] = checks.length ? [{
    key: "checks", href: `#${sectionId("checks")}`, icon: FINDING_ICON.checks, topic: t("nav.checks"), chip: t("findings.chip.check"),
    headline: { value: String(checks.length), unit: t("findings.checks.unit"), tone: "watch" },
    text: [...checks.slice(0, 2).map(check => check.title), ...(checks.length > 2 ? [t("findings.checks.more", { count: checks.length - 2 })] : [])].join(review.locale === "zh-Hans" ? "" : " "),
  }] : [];
  const findings: Finding[] = [
    ...summary.answers.flatMap(row => {
      const item: Finding = { key: row.id, href: `#${sectionId(`q-${row.id}`)}`, icon: FINDING_ICON[row.id], topic: t(EYEBROW[row.id]), headline: row.headline, text: row.answer,
        chip: row.headline.tone === "watch" ? t("findings.chip.look") : "" };
      return row.id === "profile" ? [item, ...checksFinding] : [item];
    }),
    ...(!has("profile") ? checksFinding : []),
  ];
  const feedbackContext = live && sectionFeedback ? { feedback: sectionFeedback, titleOf: (id: string) => titles.get(id) ?? id } : null;
  return <FeedbackContext.Provider value={feedbackContext}><article className="eiq-energy-review" aria-label={t("doc.aria", { name: review.projectName })} onClick={glide}>
    {standalone && <div className="er-page er-head">
      <header className="er-mast">
        <div className="er-brand">{cover.kicker}</div>
        <h1>{cover.title}</h1>
        <p className="er-sub">{cover.subtitle}</p>
        <dl className="er-meta">
          <div><dt>{t("cover.preparedFor")}</dt>{cover.preparedFor.map(line => <dd key={line}>{line}</dd>)}</div>
          <div><dt>{t("cover.period")}</dt>{cover.period.map(line => <dd key={line}>{line}</dd>)}</div>
          <div><dt>{t("cover.issued")}</dt>{cover.issued.map(line => <dd key={line}>{line}</dd>)}</div>
        </dl>
      </header>
    </div>}
    <SectionNav items={nav} t={t} live={live} />
    <div className="er-page">
      <section id={sectionId("summary")} className="er-sec er-first">
        <SectionTools id="summary" />
        <div className="er-kicker">{t("sum.kicker")}</div>
        <h2>{t("sum.heading")}</h2>
        <SectionSlot id="summary" />
        <p className="er-lede">{summary.intro}</p>
        {summary.figures.length > 0 && <div className="er-figs" style={{ "--er-figs": summary.figures.length } as CSSProperties}>{summary.figures.map(figure => {
          const cells = <><span className="er-fig-label">{figure.label}</span><b>{figure.value}{figure.unit && <small>{figure.unit}</small>}</b>{figure.detail && <span className="er-fig-detail">{figure.detail}</span>}</>;
          return has(figure.target)
            ? <a key={figure.label} className="er-fig-tile" href={`#${sectionId(`q-${figure.target}`)}`}>{cells}</a>
            : <div key={figure.label} className="er-fig-tile">{cells}</div>;
        })}</div>}
        {findings.length > 0 && <>
          <h3>{t("findings.heading")}</h3>
          <KeyFindings findings={findings} t={t} />
        </>}
        <p className="er-note er-sum-note">{summary.note}</p>
      </section>

      {has("total") && total && <Question id="total" title={total.heading} t={t}>
        <p><Rich text={total.intro} /></p>
        {total.days.length > 0 && <DailyBars review={review} live={live} />}
        {total.projection.length > 0 && <div className="er-table"><table className="er-proj">
          <thead><tr><th>{t("total.col.projection")}</th><th className="r">{t("total.col.energy")}</th>{review.rate != null && <th className="r">{costHead}</th>}{withCarbon && <th className="r">{t("total.col.co2")}</th>}</tr></thead>
          <tbody>{total.projection.map(row => <tr key={row.label}><td>{row.label}</td><td className="r">{kwhLabel(row.kwh)}</td>{review.rate != null && <td className="r">{row.cost == null ? "—" : moneyText(row.cost, review.currency, row.cost < 100 ? 2 : 0)}</td>}{withCarbon && <td className="r">{co2Cell(row.co2Kg)}</td>}</tr>)}</tbody>
        </table></div>}
      </Question>}

      {has("groups") && groups && <Question id="groups" title={groups.heading} t={t}>
        <p><Rich text={groups.intro} /></p>
        <figure className="er-fig"><Ring slices={groups.slices} centre={groups.centre} unit={groups.unit} value={slice => `${whole(slice.value)} kWh`} live={live} t={t} /></figure>
      </Question>}

      {has("largest") && largest && <Question id="largest" title={largest.heading} t={t}>
        <p><Rich text={largest.intro} /></p>
        <div className="er-blocks">{largest.blocks.map(block => <figure key={block.key} className="er-fig">
          <h3>{block.name}</h3>
          <Ring slices={block.slices} centre={block.centre} unit={t("largest.unit")} value={slice => num(slice.value, 2)} size={168} stacked live={live} t={t} />
        </figure>)}</div>
        <p className="er-note">{largest.note}</p>
      </Question>}

      {has("comparison") && comparison && <Question id="comparison" title={comparison.heading} t={t}>
        <p><Rich text={comparison.intro} /></p>
        <Pairs review={review} t={t} />
        {comparison.callout && <div className="er-callout"><p style={{ margin: 0 }}><Rich text={comparison.callout} /></p></div>}
      </Question>}

      {has("profile") && profile && <Question id="profile" title={profile.heading} t={t}>
        <p><Rich text={profile.intro} /></p>
        <Layers review={review} live={live} t={t} />
      </Question>}

      {checks.length > 0 && <section id={sectionId("checks")} className="er-sec">
        <SectionTools id="checks" />
        <div className="er-kicker">{t("nav.checks")}</div>
        <h2>{t("checks.heading")}</h2>
        <SectionSlot id="checks" />
        <ol className="er-checks">{checks.map((check, index) => <li key={check.key || check.title}>
          <b>{String(index + 1).padStart(2, "0")}</b><p><strong>{check.title}</strong>{check.text}</p>
          {live && onCheckFeedback && check.key && <button type="button" className="er-ask" aria-label={t("checks.askAria", { title: check.title })} onClick={() => onCheckFeedback({ key: check.key, title: check.title })}>{t("checks.ask")}</button>}
        </li>)}</ol>
      </section>}

      {followUps.length > 0 && <section id={sectionId("followups")} className="er-sec">
        <SectionTools id="followups" />
        <div className="er-kicker">{t("nav.followUps")}</div>
        <h2>{t("followUps.heading")}</h2>
        <SectionSlot id="followups" />
        <p>{t("followUps.intro")}</p>
        <ul className="er-follow">{followUps.map((item, index) => {
          const chip = followUpChip(item);
          return <li key={`${index}|${item.text}`} className={item.status === "open" ? undefined : "er-closed"}>
            <p>{item.text}</p>
            <span className={`er-chip er-chip-${chip.kind}`}>{t(chip.key)}</span>
            {item.evidence && <p className="er-evidence">{t("followUps.evidence", { evidence: item.evidence })}</p>}
          </li>;
        })}</ul>
      </section>}

      {pair ? <div className="er-two">{littleSection}{lightSection}</div> : <>{littleSection}{lightSection}</>}

      {has("savings") && savings && <Question id="savings" title={savings.heading} t={t}>
        <p><Rich text={savings.intro} /></p>
        {savings.rows.length > 0 && <Savings review={review} live={live} t={t} />}
        {nextSteps.length > 0 && <>
          <h3>{t("steps.heading")}</h3>
          <ol className="er-steps">{nextSteps.map(step => <li key={step.action}><div>
            <p>{step.action}</p>
            <div className="er-tags"><span>{t("steps.col.who")}: <b>{step.who}</b></span><span>{t("steps.col.when")}: <b>{step.when}</b></span></div>
          </div></li>)}</ol>
        </>}
      </Question>}

      <section id={sectionId("method")} className="er-sec">
        <SectionTools id="method" />
        <div className="er-kicker">{t("met.kicker")}</div>
        <h2>{t("met.heading")}</h2>
        <SectionSlot id="method" />
        <p>{method.intro}</p>
        <dl className="er-assume">{method.assumptions.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
        {memory.length > 0 && <>
          <h3>{t("met.memoryTitle")}</h3>
          <p className="er-note">{t("met.memoryNote")}</p>
          <ul className="er-known">{memory.map((text, index) => <li key={`${index}|${text}`}>{text}</li>)}</ul>
        </>}
        {setAside.length > 0 && <>
          <h3>{t("met.setAsideTitle")}</h3>
          <p className="er-note">{t("met.setAsideNote")}</p>
          <ul className="er-known">{setAside.map(item => <li key={item.title}><strong>{item.title}</strong>{item.reason ? `${review.locale === "zh-Hans" ? "" : " "}${item.reason}` : ""}</li>)}</ul>
        </>}
        {method.meters.length > 0 && <>
          <h3>{t("met.metersTitle")}</h3>
          <MeterTable meters={method.meters} live={live} t={t} />
        </>}
      </section>

      <footer><span>{review.footer.left}</span><span>EnergyX</span></footer>
    </div>
  </article></FeedbackContext.Provider>;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
/** The review's own markup, with no page around it: the saved copy, with its title block and no moving parts. */
export const renderEnergyReviewMarkup = (review: EnergyReview) => renderToStaticMarkup(<EnergyReviewDocument review={review} standalone />);
/** A standalone copy of the review: the document plus its styles, no scripts or external files. */
export function renderEnergyReviewHtml(review: EnergyReview) {
  const title = reviewText(review)("file.title", { name: review.projectName, period: review.cover.period[0] ?? "" });
  return `<!DOCTYPE html>\n<html lang="${review.locale}">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${escapeHtml(title)}</title>\n<style>body{margin:0;background:#fff}${ENERGY_REVIEW_CSS}</style>\n</head>\n<body>\n${renderEnergyReviewMarkup(review)}\n</body>\n</html>\n`;
}
/** The name the downloaded file is saved under. */
export const energyReviewFileName = (review: EnergyReview) => `${review.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-energy-review-${review.from}-to-${review.to}.html`;

/**
 * The energy review as a document: the page the Overview shows for a site set to it, the page the server saves, and the
 * file people download. It follows the look of the first SKTC review: a cover with a green edge, serif headings, a
 * green kicker over each question, bars and rings in deep green and bronze, and plain ruled tables. Nothing here reads
 * the DOM, so the server renders the same document with renderEnergyReviewHtml().
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ENERGY_REVIEW_PALETTE as P, type EnergyReview, type EnergyReviewQuestion, type EnergyReviewSlice } from "./energy-review.js";
import { energyReviewMessages } from "./energy-review-messages.js";
import { forHoursMeaning, translatorFor } from "./locale.js";
import { Rich } from "./rich.js";
import { niceTicks, useWidth } from "./site-report-document.js";
import { clock, moneyText } from "./site-report-model.js";

const reviewText = (review: Pick<EnergyReview, "locale" | "hoursMeaning">) => forHoursMeaning(translatorFor(energyReviewMessages, review.locale), energyReviewMessages, review.hoursMeaning);
const num = (value: number | null, digits = 1) => value == null ? "—" : value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const whole = (value: number) => Math.round(value).toLocaleString("en-SG");
const INK = "#1E2622", MUTED = "#5F6B66", LINE = "#DDE3E0";

/** The review's own styles, scoped to it; it never borrows the full report's. */
export const ENERGY_REVIEW_CSS = `
.eiq-energy-review{--er-green:#1F5C46;--er-bronze:#C28A3C;--er-ink:#1E2622;--er-muted:#5F6B66;--er-line:#DDE3E0;--er-soft:#F3F6F4;
  font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--er-ink);background:#fff;line-height:1.55;font-size:15.5px;color-scheme:light;text-align:left;container-type:inline-size}
.eiq-energy-review *{box-sizing:border-box;margin:0;padding:0}
.eiq-energy-review .er-page{max-width:860px;margin:0 auto;padding:0 28px 72px}
.eiq-energy-review h1,.eiq-energy-review h2,.eiq-energy-review h3{font-family:'Source Serif 4','Source Serif Pro','Iowan Old Style',Georgia,'Times New Roman',serif;font-weight:600;color:var(--er-ink);letter-spacing:-.01em;text-wrap:balance}
.eiq-energy-review h2{font-size:clamp(24px,3.4vw,30px);line-height:1.2;margin:6px 0 12px}
.eiq-energy-review h3{font-size:19px;margin:30px 0 10px}
.eiq-energy-review p{max-width:70ch;margin-top:10px}
.eiq-energy-review strong{font-weight:700}
.eiq-energy-review .er-kicker{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--er-green)}
.eiq-energy-review section{padding-top:44px}
.eiq-energy-review .er-cover{border-left:18px solid var(--er-green);padding:44px 0 32px 36px;margin:0 -28px 8px;display:flex;flex-direction:column;gap:18px;min-height:420px}
.eiq-energy-review .er-cover .er-brand{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--er-muted)}
.eiq-energy-review .er-cover h1{font-size:clamp(34px,6vw,54px);line-height:1.08;margin-top:auto}
.eiq-energy-review .er-cover .er-sub{font-size:18px;color:#3C4743;max-width:52ch;margin:0}
.eiq-energy-review .er-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;border-top:1px solid var(--er-line);padding-top:16px;margin-top:auto;font-size:13.5px}
.eiq-energy-review .er-meta b{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--er-muted);margin-bottom:4px}
.eiq-energy-review .er-figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;border-top:2px solid var(--er-ink);border-bottom:1px solid var(--er-line);padding:22px 0 18px;margin-top:22px}
.eiq-energy-review .er-figs b{font-family:'Source Serif 4','Iowan Old Style',Georgia,serif;font-size:34px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
.eiq-energy-review .er-figs b small{font-size:16px;color:var(--er-muted);font-weight:500;margin-left:4px}
.eiq-energy-review .er-figs span{display:block;font-size:13px;color:var(--er-muted);margin-top:8px}
.eiq-energy-review .er-table{overflow-x:auto;margin-top:12px}
.eiq-energy-review table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
.eiq-energy-review th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--er-muted);font-weight:700;text-align:left;padding:8px 10px 8px 0;border-bottom:1.5px solid var(--er-ink);vertical-align:bottom}
.eiq-energy-review td{padding:10px 10px 10px 0;border-bottom:1px solid var(--er-line);vertical-align:top}
.eiq-energy-review .r{text-align:right}
.eiq-energy-review td.er-n{color:var(--er-green);font-weight:700;width:34px}
.eiq-energy-review tr.er-total td{font-weight:700;border-top:1.5px solid var(--er-ink)}
.eiq-energy-review .er-note{font-size:12.5px;color:var(--er-muted);margin-top:12px}
.eiq-energy-review .er-chart-title{font-weight:700;font-size:14px;margin:20px 0 8px}
.eiq-energy-review .er-scroll{overflow-x:auto}
.eiq-energy-review svg{display:block;max-width:none}
.eiq-energy-review svg text{font-family:inherit;font-size:11px;fill:${MUTED}}
.eiq-energy-review svg text.dark{fill:${INK};font-weight:600}
.eiq-energy-review .er-ring{display:grid;grid-template-columns:180px minmax(0,1fr);gap:24px;align-items:center;margin-top:14px}
.eiq-energy-review .er-legend{display:grid;gap:6px;font-size:13.5px}
.eiq-energy-review .er-legend div{display:grid;grid-template-columns:14px minmax(0,1fr) auto 52px;gap:10px;align-items:center;font-variant-numeric:tabular-nums}
.eiq-energy-review .er-legend i{width:12px;height:12px;display:block}
.eiq-energy-review .er-legend em{font-style:normal;color:var(--er-ink)}
.eiq-energy-review .er-key{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;color:var(--er-muted);margin:4px 0 6px}
.eiq-energy-review .er-key i{display:inline-block;width:11px;height:11px;margin-right:6px;vertical-align:-1px}
.eiq-energy-review .er-pairs{display:grid;margin-top:6px}
.eiq-energy-review .er-pair{display:grid;grid-template-columns:minmax(110px,28%) minmax(0,1fr);gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid var(--er-line);font-size:13px}
.eiq-energy-review .er-bars{display:grid;gap:3px}
.eiq-energy-review .er-bar{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--er-muted);font-variant-numeric:tabular-nums}
.eiq-energy-review .er-bar span{display:block;height:10px;min-width:2px}
.eiq-energy-review .er-callout{border-left:3px solid var(--er-bronze);padding:6px 0 6px 18px;margin-top:22px;max-width:72ch}
.eiq-energy-review .er-checks{list-style:none;margin-top:8px}
.eiq-energy-review .er-checks li{display:grid;grid-template-columns:34px minmax(0,1fr);padding:11px 0;border-bottom:1px solid var(--er-line)}
.eiq-energy-review .er-checks li>b{color:var(--er-bronze);font-weight:700;font-variant-numeric:tabular-nums}
.eiq-energy-review .er-checks p{margin:0}
.eiq-energy-review .er-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:36px}
.eiq-energy-review .er-two section{padding-top:32px}
.eiq-energy-review .er-saving{display:grid;grid-template-columns:minmax(150px,46%) minmax(0,1fr);gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--er-line);font-size:13px}
.eiq-energy-review .er-saving .er-bar span{height:14px;background:#4E8F72}
.eiq-energy-review .er-saving .er-bar b{color:var(--er-ink)}
.eiq-energy-review footer{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--er-line);margin-top:48px;padding-top:12px;font-size:12px;color:var(--er-muted)}
@container (max-width:640px){
  .eiq-energy-review .er-page{padding:0 16px 56px}
  .eiq-energy-review .er-cover{margin:0 -16px 8px;padding:28px 0 24px 22px;border-left-width:10px;min-height:0}
  .eiq-energy-review .er-meta,.eiq-energy-review .er-two{grid-template-columns:1fr}
  .eiq-energy-review .er-figs{grid-template-columns:repeat(2,minmax(0,1fr))}
  .eiq-energy-review .er-ring{grid-template-columns:1fr}
  .eiq-energy-review .er-ring svg{margin:0 auto}
  .eiq-energy-review .er-saving,.eiq-energy-review .er-pair{grid-template-columns:1fr}
}
@media print{.eiq-energy-review .er-cover{break-after:page;min-height:90vh}.eiq-energy-review section{break-inside:avoid-page}.eiq-energy-review svg{max-width:100%;height:auto}.eiq-energy-review .er-scroll{overflow:visible}}
`;

const Question = ({ id, number, title, children, t }: { id: string; number: number; title: string; children: ReactNode; t: ReturnType<typeof reviewText> }) => <section id={`q-${id}`}>
  <div className="er-kicker">{t("q.kicker", { n: number })}</div>
  <h2>{title}</h2>
  {children}
</section>;

/** Energy each day as green bars, the value above each and the date and cost under it. */
function DailyBars({ review }: { review: EnergyReview }) {
  const t = reviewText(review);
  const days = review.total!.days;
  const [ref, measured] = useWidth(780);
  const width = Math.max(measured, days.length * 22 + 60);
  const withCost = review.rate != null;
  const height = withCost ? 230 : 214;
  const m = { l: 40, r: 8, t: 22, b: withCost ? 48 : 32 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const ticks = niceTicks(Math.max(...days.map(day => day.kwh), 0.001) * 1.15);
  const top = ticks.at(-1)!;
  const y = (value: number) => m.t + ph - value / top * ph;
  const band = pw / Math.max(days.length, 1);
  const barW = Math.min(110, Math.max(3, band * 0.62));
  const every = band >= 70 ? 1 : band >= 36 ? 2 : band >= 18 ? 4 : 7;
  return <figure>
    <div className="er-chart-title">{t("total.chartTitle")}</div>
    <div className="er-scroll" ref={ref}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("total.chartTitle")}>
      {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={LINE} /><text x={m.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
      {days.map((day, index) => {
        const x = m.l + band * index + (band - barW) / 2;
        const show = index % every === 0;
        return <g key={day.date}>
          <rect x={x} y={y(day.kwh)} width={barW} height={Math.max(0, y(0) - y(day.kwh))} fill={day.complete ? P[0] : "#9DB4AA"}>
            <title>{[`${day.label} · ${num(day.kwh)} kWh`, day.cost != null ? moneyText(day.cost, review.currency, 2) : null, day.complete ? null : t("total.missingDay")].filter(Boolean).join(" · ")}</title>
          </rect>
          {band >= 36 && day.kwh > 0 && <text className="dark" x={x + barW / 2} y={y(day.kwh) - 6} textAnchor="middle">{num(day.kwh)}</text>}
          {show && <text className="dark" x={x + barW / 2} y={height - m.b + 16} textAnchor="middle">{day.label}</text>}
          {show && withCost && day.cost != null && band >= 36 && <text x={x + barW / 2} y={height - m.b + 31} textAnchor="middle">{moneyText(day.cost, review.currency, 2)}</text>}
        </g>;
      })}
      <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={MUTED} />
    </svg></div>
    <p className="er-note">{review.total!.caption}{days.some(day => !day.complete && day.kwh > 0) ? review.locale === "zh-Hans" ? `${t("total.legendMissing")}。` : ` ${t("total.legendMissing")}.` : ""}</p>
  </figure>;
}

/** A ring of slices with a figure in the middle, and the slices listed beside it. */
function Ring({ slices, centre, unit, value, size = 172 }: { slices: EnergyReviewSlice[]; centre: string; unit: string; value: (slice: EnergyReviewSlice) => string; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const r = size / 2, inner = r * 0.6;
  let angle = -Math.PI / 2;
  const arcs = slices.map(slice => {
    const sweep = slice.value / total * Math.PI * 2;
    const start = angle, end = angle + sweep;
    angle = end;
    if (sweep >= Math.PI * 2 - 1e-6) return { slice, d: `M${r},0 A${r},${r} 0 1 1 ${r - 0.01},0 L${r - 0.01},${r - inner} A${inner},${inner} 0 1 0 ${r},${r - inner} Z` };
    const large = sweep > Math.PI ? 1 : 0;
    const p = (radius: number, a: number) => `${(r + radius * Math.cos(a)).toFixed(2)},${(r + radius * Math.sin(a)).toFixed(2)}`;
    return { slice, d: `M${p(r, start)} A${r},${r} 0 ${large} 1 ${p(r, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z` };
  });
  return <div className="er-ring">
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centre} ${unit}`}>
      {arcs.map(arc => <path key={arc.slice.name} d={arc.d} fill={arc.slice.colour} stroke="#fff" strokeWidth={1.5}><title>{`${arc.slice.name} · ${value(arc.slice)} · ${Math.round(arc.slice.share * 100)}%`}</title></path>)}
      <text className="dark" x={r} y={r + 3} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700 }}>{centre}</text>
      <text x={r} y={r + 21} textAnchor="middle" style={{ fontSize: 10 }}>{unit}</text>
    </svg>
    <div className="er-legend">{slices.map(slice => <div key={slice.name}><i style={{ background: slice.colour }} /><em>{slice.name}</em><span className="r">{value(slice)}</span><span className="r">{Math.round(slice.share * 100)}%</span></div>)}</div>
  </div>;
}

/** The same circuits side by side, one bar per group. */
function Pairs({ review }: { review: EnergyReview }) {
  const comparison = review.comparison!;
  const max = Math.max(...comparison.rows.flatMap(row => row.perDay), 0.001);
  return <figure>
    <div className="er-chart-title">{comparison.title}</div>
    <div className="er-key" aria-hidden="true">{comparison.groups.map(group => <span key={group.name}><i style={{ background: group.colour }} />{group.name}</span>)}</div>
    <div className="er-pairs">{comparison.rows.map(row => <div key={row.name} className="er-pair">
      <span>{row.name}</span>
      <span className="er-bars">{row.perDay.map((value, index) => <span key={comparison.groups[index]!.name} className="er-bar">
        <span style={{ width: `${value / max * 82}%`, background: comparison.groups[index]!.colour }} />{num(value, 2)}
      </span>)}</span>
    </div>)}</div>
  </figure>;
}

/** The average day hour by hour, the layers stacked as steps (one step per hour of readings). */
function Layers({ review }: { review: EnergyReview }) {
  const profile = review.profile!;
  const [ref, measured] = useWidth(780);
  const width = measured, height = 250;
  const m = { l: 44, r: 10, t: 12, b: 28 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const ticks = niceTicks(Math.max(profile.peakKw, 0.001) * 1.12);
  const top = ticks.at(-1)!;
  const x = (hour: number) => m.l + hour / 24 * pw;
  const y = (kw: number) => m.t + ph - kw / top * ph;
  // Each layer sits on the ones below it.
  const below = Array.from({ length: 24 }, () => 0);
  const shapes = profile.layers.map(layer => {
    const bottom = [...below];
    for (let hour = 0; hour < 24; hour += 1) below[hour]! += layer.hours[hour] ?? 0;
    const topLine = Array.from({ length: 24 }, (_, hour) => `L${x(hour).toFixed(1)},${y(below[hour]!).toFixed(1)} L${x(hour + 1).toFixed(1)},${y(below[hour]!).toFixed(1)}`).join(" ");
    const bottomLine = Array.from({ length: 24 }, (_, index) => 23 - index).map(hour => `L${x(hour + 1).toFixed(1)},${y(bottom[hour]!).toFixed(1)} L${x(hour).toFixed(1)},${y(bottom[hour]!).toFixed(1)}`).join(" ");
    return { layer, d: `M${x(0).toFixed(1)},${y(bottom[0]!).toFixed(1)} ${topLine} ${bottomLine} Z` };
  });
  return <figure>
    <div className="er-chart-title">{profile.title}</div>
    <div className="er-key" aria-hidden="true">{profile.layers.map(layer => <span key={layer.key}><i style={{ background: layer.colour }} />{layer.name}</span>)}</div>
    <div className="er-scroll" ref={ref}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={profile.title}>
      {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={LINE} /><text x={m.l - 8} y={y(tick) + 4} textAnchor="end">{`${tick} kW`}</text></g>)}
      {shapes.map(shape => <path key={shape.layer.key} d={shape.d} fill={shape.layer.colour}><title>{shape.layer.name}</title></path>)}
      <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={MUTED} />
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => <text key={hour} x={x(hour)} y={height - 8} textAnchor="middle">{clock(hour % 24, review.locale)}</text>)}
    </svg></div>
  </figure>;
}

function SavingBars({ review }: { review: EnergyReview }) {
  const savings = review.savings!;
  const value = (row: (typeof savings.rows)[number]) => row.costYear ?? row.kwhYear;
  const max = Math.max(...savings.rows.map(value), 0.001);
  return <figure>
    <div className="er-chart-title">{savings.title}</div>
    {savings.rows.map(row => <div key={row.title} className="er-saving">
      <span>{row.title}</span>
      <span className="er-bar"><span style={{ width: `${value(row) / max * 70}%` }} />{row.costYear != null ? <><b>{moneyText(row.costYear, review.currency)}</b> {whole(row.kwhYear)} kWh</> : <b>{whole(row.kwhYear)} kWh</b>}</span>
    </div>)}
  </figure>;
}

/** The review itself, from one `EnergyReview` and nothing else. */
export function EnergyReviewDocument({ review }: { review: EnergyReview }) {
  const t = reviewText(review);
  const { cover, summary, total, groups, largest, comparison, profile, checks, littleUse, perLight, savings, nextSteps, method } = review;
  const numberOf = (id: EnergyReviewQuestion) => review.questions.indexOf(id) + 1;
  const has = (id: EnergyReviewQuestion) => review.questions.includes(id);
  const costHead = review.costBasis ? t("total.col.costBasis", { basis: review.costBasis }) : t("total.col.cost");
  const withCarbon = review.carbonFactor != null;
  const co2Cell = (kg: number | null) => kg == null ? "—" : kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${kg.toFixed(1)} kg`;
  const pair = has("littleUse") && has("perLight");
  const littleSection = has("littleUse") && littleUse && <Question id="littleUse" number={numberOf("littleUse")} title={littleUse.heading} t={t}><p><Rich text={littleUse.text} /></p></Question>;
  const lightSection = has("perLight") && perLight && <Question id="perLight" number={numberOf("perLight")} title={perLight.heading} t={t}><p><Rich text={perLight.text} /></p></Question>;
  return <article className="eiq-energy-review" aria-label={t("doc.aria", { name: review.projectName })}>
    <div className="er-page">
      <header className="er-cover">
        <div className="er-brand">{cover.kicker}</div>
        <h1>{cover.title}</h1>
        <p className="er-sub">{cover.subtitle}</p>
        <div className="er-meta">
          <div><b>{t("cover.preparedFor")}</b>{cover.preparedFor.map(line => <div key={line}>{line}</div>)}</div>
          <div><b>{t("cover.period")}</b>{cover.period.map(line => <div key={line}>{line}</div>)}</div>
          <div><b>{t("cover.issued")}</b>{cover.issued.map(line => <div key={line}>{line}</div>)}</div>
        </div>
      </header>

      <section id="summary">
        <div className="er-kicker">{t("sum.kicker")}</div>
        <h2>{t("sum.heading")}</h2>
        <p>{summary.intro}</p>
        {summary.figures.length > 0 && <div className="er-figs">{summary.figures.map(figure => <div key={figure.label}><b>{figure.value}{figure.unit && <small>{figure.unit}</small>}</b><span>{figure.label}</span></div>)}</div>}
        <h3>{t("glance.heading")}</h3>
        <div className="er-table"><table>
          <thead><tr><th>#</th><th>{t("glance.col.question")}</th><th>{t("glance.col.answer")}</th></tr></thead>
          <tbody>{summary.answers.map((row, index) => <tr key={row.id}><td className="er-n">{index + 1}</td><td>{row.question}</td><td>{row.answer}</td></tr>)}</tbody>
        </table></div>
        <p className="er-note">{summary.note}</p>
      </section>

      {has("total") && total && <Question id="total" number={numberOf("total")} title={total.heading} t={t}>
        <p><Rich text={total.intro} /></p>
        {total.days.length > 0 && <DailyBars review={review} />}
        {total.projection.length > 0 && <div className="er-table"><table>
          <thead><tr><th>{t("total.col.projection")}</th><th className="r">{t("total.col.energy")}</th>{review.rate != null && <th className="r">{costHead}</th>}{withCarbon && <th className="r">{t("total.col.co2")}</th>}</tr></thead>
          <tbody>{total.projection.map(row => <tr key={row.label}><td>{row.label}</td><td className="r">{row.kwh < 100 ? `${num(row.kwh)} kWh` : `${whole(row.kwh)} kWh`}</td>{review.rate != null && <td className="r">{row.cost == null ? "—" : moneyText(row.cost, review.currency, row.cost < 100 ? 2 : 0)}</td>}{withCarbon && <td className="r">{co2Cell(row.co2Kg)}</td>}</tr>)}</tbody>
        </table></div>}
      </Question>}

      {has("groups") && groups && <Question id="groups" number={numberOf("groups")} title={groups.heading} t={t}>
        <p><Rich text={groups.intro} /></p>
        <Ring slices={groups.slices} centre={groups.centre} unit={groups.unit} value={slice => `${whole(slice.value)} kWh`} />
      </Question>}

      {has("largest") && largest && <Question id="largest" number={numberOf("largest")} title={largest.heading} t={t}>
        <p><Rich text={largest.intro} /></p>
        {largest.blocks.map(block => <div key={block.key}>
          <h3>{block.name}</h3>
          <Ring slices={block.slices} centre={block.centre} unit={t("largest.unit")} value={slice => num(slice.value, 2)} size={150} />
        </div>)}
        <p className="er-note">{largest.note}</p>
      </Question>}

      {has("comparison") && comparison && <Question id="comparison" number={numberOf("comparison")} title={comparison.heading} t={t}>
        <p><Rich text={comparison.intro} /></p>
        <Pairs review={review} />
        {comparison.callout && <div className="er-callout"><Rich text={comparison.callout} /></div>}
      </Question>}

      {has("profile") && profile && <Question id="profile" number={numberOf("profile")} title={profile.heading} t={t}>
        <p><Rich text={profile.intro} /></p>
        <Layers review={review} />
      </Question>}

      {checks.length > 0 && <section id="checks">
        <h3>{t("checks.heading")}</h3>
        <ol className="er-checks">{checks.map((check, index) => <li key={check.title}><b>{String(index + 1).padStart(2, "0")}</b><p><strong>{check.title}</strong> {check.text}</p></li>)}</ol>
      </section>}

      {pair ? <div className="er-two">{littleSection}{lightSection}</div> : <>{littleSection}{lightSection}</>}

      {has("savings") && savings && <Question id="savings" number={numberOf("savings")} title={savings.heading} t={t}>
        <p><Rich text={savings.intro} /></p>
        {savings.rows.length > 0 && <>
          <SavingBars review={review} />
          <div className="er-table"><table>
            <thead><tr><th>{t("sav.col.measure")}</th><th>{t("sav.col.basis")}</th><th className="r">{t("sav.col.kwh")}</th>{savings.totalCost != null && <th className="r">{t("sav.col.cost", { currency: review.currency === "SGD" ? "S$" : review.currency })}</th>}</tr></thead>
            <tbody>
              {savings.rows.map(row => <tr key={row.title}><td>{row.title}</td><td>{row.basis}</td><td className="r">{whole(row.kwhYear)}</td>{savings.totalCost != null && <td className="r">{row.costYear == null ? "—" : moneyText(row.costYear, review.currency)}</td>}</tr>)}
              {savings.rows.length > 1 && <tr className="er-total"><td>{t("sav.total")}</td><td /><td className="r">{whole(savings.totalKwh)}</td>{savings.totalCost != null && <td className="r">{moneyText(savings.totalCost, review.currency)}</td>}</tr>}
            </tbody>
          </table></div>
          {savings.note && <p className="er-note">{savings.note}</p>}
        </>}
        {nextSteps.length > 0 && <>
          <h3>{t("steps.heading")}</h3>
          <div className="er-table"><table>
            <thead><tr><th>{t("steps.col.action")}</th><th>{t("steps.col.who")}</th><th>{t("steps.col.when")}</th></tr></thead>
            <tbody>{nextSteps.map(step => <tr key={step.action}><td>{step.action}</td><td>{step.who}</td><td>{step.when}</td></tr>)}</tbody>
          </table></div>
        </>}
      </Question>}

      <section id="method">
        <div className="er-kicker">{t("met.kicker")}</div>
        <h2>{t("met.heading")}</h2>
        <p>{method.intro}</p>
        <div className="er-table"><table>
          <thead><tr><th>{t("met.col.assumption")}</th><th className="r">{t("met.col.value")}</th></tr></thead>
          <tbody>{method.assumptions.map(row => <tr key={row.label}><td>{row.label}</td><td className="r">{row.value}</td></tr>)}</tbody>
        </table></div>
        {method.meters.length > 0 && <>
          <h3>{t("met.metersTitle")}</h3>
          <div className="er-table"><table>
            <thead><tr><th>{t("met.col.meter")}</th><th>{t("met.col.group")}</th><th className="r">{t("met.col.perDay")}</th><th>{t("met.col.basis")}</th></tr></thead>
            <tbody>{method.meters.map(meter => <tr key={meter.id}><td>{meter.name}</td><td>{meter.group || "—"}</td><td className="r">{num(meter.perDay, 2)}</td><td>{meter.basis}</td></tr>)}</tbody>
          </table></div>
        </>}
      </section>

      <footer><span>{review.footer.left}</span></footer>
    </div>
  </article>;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
/** The review's own markup, with no page around it. */
export const renderEnergyReviewMarkup = (review: EnergyReview) => renderToStaticMarkup(<EnergyReviewDocument review={review} />);
/** A standalone copy of the review: the document plus its styles, no scripts or external files. */
export function renderEnergyReviewHtml(review: EnergyReview) {
  const title = reviewText(review)("file.title", { name: review.projectName, period: review.cover.period[0] ?? "" });
  return `<!DOCTYPE html>\n<html lang="${review.locale}">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${escapeHtml(title)}</title>\n<style>body{margin:0;background:#fff}${ENERGY_REVIEW_CSS}</style>\n</head>\n<body>\n${renderEnergyReviewMarkup(review)}\n</body>\n</html>\n`;
}
/** The name the downloaded file is saved under. */
export const energyReviewFileName = (review: EnergyReview) => `${review.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-energy-review-${review.from}-to-${review.to}.html`;

/**
 * The management review as a document: the page the server saves and the file people download or print. It uses the
 * full report's paper look (REPORT_CSS) and its average-day chart, with a few plainer pieces of its own: a daily bar
 * chart with the cost under each day, bars for groups, and short tables. Nothing here reads the DOM, so the server
 * renders the same document with renderManagementReviewHtml().
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { shortDate } from "./analysis-model.js";
import { forHoursMeaning, forOneDay, translatorFor } from "./locale.js";
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData } from "./analysis-types.js";
import type { EnergyIqLocale } from "./locale.js";
import { buildManagementReview, type ManagementReview, type ReviewGroup, type ReviewSectionId } from "./management-review.js";
import type { SiteReportStyle } from "./report-style.js";
import { managementReviewMessages } from "./management-review-messages.js";
import { rich, Rich } from "./rich.js";
import { niceTicks, ProfileChart, renderSiteReportHtml, useWidth } from "./site-report-document.js";
import { buildSiteReport, kwhText, moneyText, pctText, REPORT_COLOURS as C } from "./site-report-model.js";
import { REPORT_CSS } from "./site-report-styles.js";

const reviewText = (review: Pick<ManagementReview, "locale" | "hoursMeaning"> & { dayCount?: number | undefined }) =>
  forHoursMeaning(forOneDay(translatorFor(managementReviewMessages, review.locale), managementReviewMessages, review.dayCount === 1), managementReviewMessages, review.hoursMeaning);
const num = (value: number | null, digits = 1) => value == null ? "—" : value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const whole = (value: number) => Math.round(value).toLocaleString("en-SG");

/** A few extra rules on top of the full report's styles, scoped to the review. */
export const MANAGEMENT_REVIEW_CSS = `
.eiq-review .kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--steel);font-weight:700;margin-bottom:8px}
.eiq-review h1{max-width:22ch}
.eiq-review h3{font-size:16px;font-weight:700;margin-top:26px}
.eiq-review .findings{list-style:none;counter-reset:finding;margin-top:12px;max-width:72ch}
.eiq-review .findings li{counter-increment:finding;display:grid;grid-template-columns:34px 1fr;padding:9px 0;border-bottom:1px solid var(--line)}
.eiq-review .findings li::before{content:counter(finding,decimal-leading-zero);font-weight:800;color:var(--ember)}
.eiq-review .bars{display:grid;gap:8px;margin-top:6px}
.eiq-review .bar-row{display:grid;grid-template-columns:minmax(120px,32%) 1fr auto;gap:10px;align-items:center;font-size:14px}
.eiq-review .bar-track{background:#fff;border:1px solid var(--line);height:16px;position:relative}
.eiq-review .bar-fill{position:absolute;left:0;top:0;bottom:0}
.eiq-review .bar-value{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:13px}
.eiq-review .bar-sub{font-size:12.5px;color:var(--muted)}
.eiq-review .group-block{margin-top:18px}
.eiq-review .group-block h4{font-size:14.5px;font-weight:700;margin-bottom:6px}
.eiq-review .side .bar-track{height:12px}
.eiq-review .side .bar-row{grid-template-columns:minmax(120px,32%) 1fr}
.eiq-review .side-bars{display:grid;gap:3px}
.eiq-review .side-bar{display:grid;grid-template-columns:1fr 78px;gap:8px;align-items:center}
.eiq-review .muted{color:var(--muted)}
@container (max-width:620px){.eiq-review .bar-row{grid-template-columns:1fr auto}.eiq-review .bar-row .bar-track{grid-column:1 / -1;grid-row:2}}
@media print{.eiq-review .group-block{break-inside:avoid}}
`;

const Section = ({ id, number, title, children }: { id: string; number: number; title: string; children: ReactNode }) => <section id={id}>
  <div className="sec-head"><span className="num">{number}</span><h2>{title}</h2></div>
  {children}
</section>;

/** One horizontal bar, its width a share of the longest. */
const Bar = ({ label, sub, value, fraction, colour }: { label: ReactNode; sub?: string | undefined; value: string; fraction: number; colour: string }) => <div className="bar-row">
  <span>{label}{sub ? <><br /><span className="bar-sub">{sub}</span></> : null}</span>
  <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: colour }} /></span>
  <span className="bar-value">{value}</span>
</div>;

/** Energy each day as bars, the cost under each date, and a dashed line at the typical day. */
function DailyChart({ review }: { review: ManagementReview }) {
  const t = reviewText(review);
  const { locale } = review;
  const [ref, width] = useWidth(780);
  const days = review.total.days;
  const withCost = review.rate != null;
  const height = 250;
  const m = { l: 46, r: 8, t: 22, b: withCost ? 58 : 44 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const typical = review.total.typicalKwh;
  const ticks = niceTicks(Math.max(...days.map(day => day.kwh), typical ?? 0) * 1.12);
  const top = ticks.at(-1)!;
  const y = (value: number) => m.t + ph - value / top * ph;
  const band = pw / Math.max(days.length, 1);
  const barW = Math.max(2, band * 0.7);
  const every = band >= 34 ? 1 : band >= 17 ? 2 : band >= 9 ? 4 : 7;
  const labelValues = band >= 34;
  return <div className="figure">
    <div className="pie-title">{t("total.chartTitle")}</div>
    <div className="legend" aria-hidden="true">
      <span><i style={{ background: C.steel }} />{t("total.legend.day")}</span>
      <span><i style={{ background: C.slateSoft }} />{t("total.legend.missing")}</span>
      {typical != null && <span><i className="dash" />{t("total.legend.typical")}</span>}
    </div>
    <div className="chart-scroll" ref={ref}><div className="chart-wrap" style={{ minWidth: width }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("total.chartAria", { from: days[0] ? shortDate(days[0].date, locale) : "", to: days.at(-1) ? shortDate(days.at(-1)!.date, locale) : "" })}>
        {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={C.line} /><text className="tick" x={m.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
        {days.map((day, index) => {
          const x = m.l + band * index + (band - barW) / 2;
          const show = index % every === 0;
          return <g key={day.date}>
            <rect x={x} y={y(day.kwh)} width={barW} height={Math.max(0, y(0) - y(day.kwh))} fill={day.complete ? C.steel : C.slateSoft}>
              <title>{[`${day.dow} ${shortDate(day.date, locale)} · ${num(day.kwh)} kWh`, day.cost != null ? moneyText(day.cost, review.currency, 2) : null, day.complete ? null : t("total.legend.missing")].filter(Boolean).join(" · ")}</title>
            </rect>
            {labelValues && day.kwh > 0 && <text className="tick dark" x={x + barW / 2} y={y(day.kwh) - 5} textAnchor="middle">{num(day.kwh)}</text>}
            {show && <text className="tick dark" x={x + barW / 2} y={height - m.b + 15} textAnchor="middle">{shortDate(day.date, locale)}</text>}
            {show && <text className="tick" x={x + barW / 2} y={height - m.b + 29} textAnchor="middle">{day.dow}</text>}
            {show && withCost && day.cost != null && band >= 34 && <text className="tick" x={x + barW / 2} y={height - m.b + 43} textAnchor="middle">{moneyText(day.cost, review.currency, 2)}</text>}
          </g>;
        })}
        <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={C.muted} />
        {typical != null && <g pointerEvents="none">
          <line x1={m.l} x2={width - m.r} y1={y(typical)} y2={y(typical)} stroke={C.ink} strokeWidth={1.4} strokeDasharray="6 5" />
          <text className="chart-label" x={width - m.r - 4} y={y(typical) - 6} textAnchor="end" fill={C.ink}>{kwhText(typical)}</text>
        </g>}
      </svg>
    </div></div>
    <div className="caption">{review.total.caption}</div>
  </div>;
}

function GroupBars({ review }: { review: ManagementReview }) {
  const t = reviewText(review);
  const groups = review.groups!;
  const max = Math.max(...groups.rows.map(row => row.kwh), 0.001);
  return <div className="figure">
    <div className="bars">{groups.rows.map(row => <Bar key={row.key} label={<strong>{row.name}</strong>} value={`${kwhText(row.kwh)} · ${pctText(row.share)}`} fraction={row.kwh / max} colour={row.colour} />)}</div>
    {!groups.byCircuit && <div className="table-wrap"><table>
      <thead><tr><th>{t("groups.col.group")}</th><th className="r">{t("groups.col.used")}</th><th className="r">{t("groups.col.perDay")}</th><th className="r">{t("groups.col.share")}</th></tr></thead>
      <tbody>{groups.rows.map(row => <tr key={row.key}><td>{row.name}</td><td className="r">{whole(row.kwh)}</td><td className="r">{num(row.perDay)}</td><td className="r">{pctText(row.share)}</td></tr>)}</tbody>
    </table></div>}
  </div>;
}

function GroupParts({ review, row }: { review: ManagementReview; row: ReviewGroup }) {
  const t = reviewText(review);
  const max = Math.max(...row.parts.map(part => part.kwh), 0.001);
  return <div className="group-block">
    <h4>{row.name}</h4>
    <div className="bars">{row.parts.map(part => <Bar key={part.name} label={part.name} value={`${kwhText(part.kwh)} · ${pctText(part.share)}`} fraction={part.kwh / max} colour={row.colour} />)}</div>
    {row.more > 0 && <p className="bar-sub">{t(row.more === 1 ? "groups.others.one" : "groups.others.other", { count: row.more })}</p>}
    {row.biggest && <p className="note"><Rich text={row.biggest} /></p>}
  </div>;
}

function SideBySide({ review }: { review: ManagementReview }) {
  const t = reviewText(review);
  const comparison = review.comparison!;
  const lines = [{ name: t("cmp.total"), perDay: comparison.groups.map(group => group.perDay), total: true }, ...comparison.parts.map(part => ({ ...part, total: false }))];
  const max = Math.max(...lines.flatMap(line => line.perDay), 0.001);
  return <div className="figure side">
    <div className="pie-title">{t("cmp.chartTitle")}</div>
    <div className="legend" aria-hidden="true">{comparison.groups.map(group => <span key={group.key}><i style={{ background: group.colour }} />{group.name}</span>)}</div>
    <div className="bars">{lines.map(line => <div key={line.name} className="bar-row">
      <span>{line.total ? <strong>{line.name}</strong> : line.name}</span>
      <span className="side-bars">{line.perDay.map((value, index) => <span key={comparison.groups[index]!.key} className="side-bar">
        <span className="bar-track"><span className="bar-fill" style={{ width: `${value / max * 100}%`, background: comparison.groups[index]!.colour }} /></span>
        <span className="bar-value">{kwhText(value)}</span>
      </span>)}</span>
    </div>)}</div>
    <div className="caption">{comparison.caption}</div>
  </div>;
}

/**
 * The review itself, from one `ManagementReview` and nothing else. `standalone` is for a saved copy: it leaves out
 * the hover readout of the average-day chart.
 */
export function ManagementReviewDocument({ review, standalone }: { review: ManagementReview; standalone?: boolean | undefined }) {
  const t = reviewText(review);
  const { summary, total, savings, method } = review;
  const money = (value: number | null) => value == null ? "—" : moneyText(value, review.currency);
  const numberOf = (id: ReviewSectionId) => review.sections.indexOf(id) + 1;
  const has = (id: ReviewSectionId) => review.sections.includes(id);
  return <article className="eiq-report eiq-review" aria-label={t("doc.aria", { name: review.projectName })}>
    <div className="page">
      <header className="masthead">
        <div className="doc-line">
          <span><strong>{review.masthead.site}</strong> · {review.masthead.kicker}</span>
          <span>{rich(t("doc.period", { note: review.masthead.periodNote }), { period: <strong>{review.masthead.period}</strong> })}</span>
        </div>
        <div className="kicker">{review.masthead.kicker}</div>
        <h1>{review.title}</h1>
        <p className="lede">{review.lede}</p>
        {review.keyFigures.length > 0 && <div className="keyfigs">{review.keyFigures.map(figure => <div key={figure.label}><b>{figure.value}</b><small>{figure.label}</small></div>)}</div>}
      </header>

      <Section id="summary" number={numberOf("summary")} title={t("sec.summary")}>
        <h3>{t("sum.findings")}</h3>
        <ol className="findings">{summary.findings.map(finding => <li key={finding}><span><Rich text={finding} /></span></li>)}</ol>
        <h3>{t("sum.decide")}</h3>
        {summary.decisions.length ? <div className="table-wrap"><table>
          <thead><tr><th>{t("sum.col.what")}</th><th>{t("sum.col.why")}</th><th className="r">{t("sum.col.worth")}</th></tr></thead>
          <tbody>{summary.decisions.map(item => <tr key={item.title}><td><strong>{item.title}</strong></td><td>{item.why}</td><td className="r">{item.worth ?? "—"}</td></tr>)}</tbody>
        </table></div> : <p>{t("sum.none")}</p>}
      </Section>

      {has("total") && <Section id="total" number={numberOf("total")} title={t("sec.total")}>
        {total.intro && <p><Rich text={total.intro} /></p>}
        {total.days.length > 0 && <DailyChart review={review} />}
        {total.standout && <div className="standout">
          <h3>{total.standout.title}</h3>
          {total.standout.items.length > 0 && <ul>{total.standout.items.map(item => <li key={item.date}>{item.text}</li>)}</ul>}
          {total.standout.note && <p>{total.standout.note}</p>}
          <p className="rule">{total.standout.rule}</p>
        </div>}
        {total.rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{t("total.col.projection")}</th><th className="r">{t("total.col.energy")}</th>{review.rate != null && <th className="r">{t("total.col.cost")}</th>}</tr></thead>
          <tbody>{total.rows.map(row => <tr key={row.label}><td>{row.label}</td><td className="r">{kwhText(row.kwh)}</td>{review.rate != null && <td className="r">{row.cost == null ? "—" : moneyText(row.cost, review.currency, row.kwh < 100 ? 2 : 0)}</td>}</tr>)}</tbody>
        </table></div>}
      </Section>}

      {has("groups") && review.groups && <Section id="groups" number={numberOf("groups")} title={review.groups.heading}>
        <p>{review.groups.intro}</p>
        <GroupBars review={review} />
        {review.groups.note && <p className="note">{review.groups.note}</p>}
        {!review.groups.byCircuit && review.groups.rows.some(row => row.parts.length > 0) && <>
          <h3>{t("groups.partsTitle")}</h3>
          {review.groups.rows.filter(row => row.parts.length > 0).map(row => <GroupParts key={row.key} review={review} row={row} />)}
        </>}
      </Section>}

      {has("comparison") && review.comparison && <Section id="comparison" number={numberOf("comparison")} title={review.comparison.heading}>
        <p><Rich text={review.comparison.intro} /></p>
        <SideBySide review={review} />
      </Section>}

      {has("profile") && review.profile && <Section id="profile" number={numberOf("profile")} title={t("sec.profile")}>
        <p><Rich text={review.profile.intro} /></p>
        <ProfileChart pattern={{ hours: review.profile.hours, openFrom: review.profile.openFrom, openTo: review.profile.openTo, notes: [], caption: review.profile.caption }} report={review} standalone={standalone} />
      </Section>}

      {has("savings") && <Section id="savings" number={numberOf("savings")} title={t("sec.savings")}>
        <p><Rich text={savings.intro} /></p>
        {savings.rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{t("sav.col.measure")}</th><th>{t("sav.col.basis")}</th><th className="r">{t("sav.col.kwh")}</th>{review.rate != null && <th className="r">{t("sav.col.cost")}</th>}</tr></thead>
          <tbody>
            {savings.rows.map(row => <tr key={row.title}><td><strong>{row.title}</strong>{row.area && <small className="code">{row.area}</small>}</td><td>{row.basis}</td><td className="r">{whole(row.kwhYear)}</td>{review.rate != null && <td className="r">{money(row.costYear)}</td>}</tr>)}
            {savings.rows.length > 1 && <tr className="total"><td>{t("sav.total")}</td><td /><td className="r">{whole(savings.totalKwh)}</td>{review.rate != null && <td className="r">{money(savings.totalCost)}</td>}</tr>}
          </tbody>
        </table></div>}
        {savings.checks.length > 0 && <div className="callout"><strong>{t("sav.checks")}:</strong> {savings.checks.join(review.locale === "zh-Hans" ? "；" : "; ")}</div>}
        {savings.note && <p className="note">{savings.note}</p>}
      </Section>}

      <Section id="method" number={numberOf("method")} title={t("sec.method")}>
        <p>{method.intro}</p>
        <div className="table-wrap"><table><tbody>{method.rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.value}</td></tr>)}</tbody></table></div>
        {method.meters.length > 0 && <>
          <h3>{t("met.metersTitle")}</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>{t("met.col.meter")}</th><th>{t("met.col.group")}</th><th className="r">{t("met.col.perDay")}</th><th>{t("met.col.note")}</th></tr></thead>
            <tbody>{method.meters.map(meter => <tr key={meter.id}><td>{meter.name}</td><td>{meter.group || "—"}</td><td className="r">{num(meter.perDay, 2)}</td><td className={meter.note ? undefined : "muted"}>{meter.note || "—"}</td></tr>)}</tbody>
          </table></div>
        </>}
        {method.notInUseNote && <p className="note">{method.notInUseNote}</p>}
      </Section>

      <footer><span>{review.footer.left}</span><span>{review.footer.right}</span></footer>
    </div>
  </article>;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
/** The review's own markup, with no page around it. */
export const renderManagementReviewMarkup = (review: ManagementReview) => renderToStaticMarkup(<ManagementReviewDocument review={review} standalone />);
/** A standalone copy of the review: the document plus its styles, no scripts or external files. */
export function renderManagementReviewHtml(review: ManagementReview) {
  const title = reviewText(review)("file.title", { name: review.projectName, period: review.masthead.period });
  return `<!DOCTYPE html>\n<html lang="${review.locale}">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${escapeHtml(title)}</title>\n<style>body{margin:0;background:#fff}${REPORT_CSS}${MANAGEMENT_REVIEW_CSS}</style>\n</head>\n<body>\n${renderManagementReviewMarkup(review)}\n</body>\n</html>\n`;
}
/** The name the downloaded file is saved under. */
export const managementReviewFileName = (review: ManagementReview) => `${review.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-energy-review-${review.from}-to-${review.to}.html`;

/**
 * The saved page for a site report in the chosen style, from the readings: the full report or the management review.
 * The server uses this for scheduled and custom reports, so both styles come from one place.
 */
export function renderStyledSiteReportHtml(style: SiteReportStyle, data: AnalysisData, reference: ProjectSpatialReference | null, generatedAt: string, locale: EnergyIqLocale = "en") {
  return style === "management"
    ? renderManagementReviewHtml(buildManagementReview(data, reference, generatedAt, locale))
    : renderSiteReportHtml(buildSiteReport(data, reference, generatedAt, locale));
}

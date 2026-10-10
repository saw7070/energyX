import PDFDocument from "pdfkit";

import type { Portfolio, PortfolioBudgetStatus, PortfolioSite } from "./energy-portfolio.js";

/**
 * The portfolio as a printable A4 report for people who will not open the app: a branded cover band, the headline
 * figures and what stands out, every site side by side, their monthly budgets, and the carbon method and factors a
 * sustainability report has to cite.
 *
 * Only the PDF's built-in Helvetica is used, so nothing has to be shipped or embedded. It can draw Western European
 * characters only, so every customer-supplied name goes through pdfText(), which shows "?" for anything else rather
 * than a broken glyph.
 */

export type PortfolioPdfOptions = { title?: string; frequencyLabel?: string };

type Doc = PDFKit.PDFDocument;
type Align = "left" | "right" | "center";
type TextStyle = { size: number; bold?: boolean; color?: string; /** Extra space between letters, in points. */ tracking?: number };
type WriteOptions = TextStyle & { width?: number; align?: Align; /** Smallest font size to shrink to before clipping. */ shrink?: number };

const COLOR = {
  brand: "#1F4D3A",
  brandDeep: "#163A2C",
  brandSoft: "#2F7D5A",
  bandText: "#D8EBDF",
  bandMuted: "#A9CDB8",
  mint: "#EEF6F1",
  mintLine: "#CFE3D7",
  ink: "#101828",
  body: "#344054",
  muted: "#667085",
  faint: "#98A2B3",
  rule: "#EAECF0",
  zebra: "#F9FAFB",
  head: "#F2F6F3",
  track: "#EEF0F3",
  card: "#FFFFFF",
  over: "#B42318",
  overBg: "#FEE4E2",
  risk: "#B54708",
  riskBg: "#FEF0C7",
  ok: "#067647",
  okBg: "#DCFAE6",
  none: "#475467",
  noneBg: "#F2F4F7",
} as const;

/** Site colours for the carbon share bar, darkest first. */
const SERIES = ["#1F4D3A", "#2F7D5A", "#4FA27A", "#86C5A2", "#5B8DB8", "#A3C4E0", "#C9A227", "#E3C770"];

const MARGIN = 40;
/** Where content starts on pages after the first, below the running header. */
const PAGE_TOP = 64;
const BAND_HEIGHT = 150;
/** Helvetica's ascender (and cap height), as a fraction of the font size. */
const ASCENT = 0.718;
const CHART_SITES = 15;
const SHARE_SITES = 6;
const LOW_COVERAGE_PCT = 95;
const FACTOR_SITE_NAMES = 10;
const KEY_POINTS = 6;
const DASH = "—";
/** Helvetica's built-in encoding has no minus sign; an en dash is the usual stand-in. */
const MINUS = "–";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Tone = { text: string; color: string; background: string };

const BUDGET_STATUS: Record<PortfolioBudgetStatus["status"], Tone> = {
  "over": { text: "Over", color: COLOR.over, background: COLOR.overBg },
  "at-risk": { text: "At risk", color: COLOR.risk, background: COLOR.riskBg },
  "on-track": { text: "On track", color: COLOR.ok, background: COLOR.okBg },
  "no-data": { text: "No data", color: COLOR.none, background: COLOR.noneBg },
};

const COST_NOTE: Record<NonNullable<PortfolioBudgetStatus["costNote"]>, string> = {
  "tariff-unavailable": "Compared on kWh: the electricity price is not set",
  "currency-differs": "Compared on kWh: the price is in a different currency",
};

export const renderPortfolioPdf = async (portfolio: Portfolio, options: PortfolioPdfOptions = {}): Promise<Buffer> => {
  const title = pdfText(options.title ?? "Energy portfolio report");
  const created = new Date(portfolio.generatedAt);
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: `${options.title ?? "Energy portfolio report"} – ${portfolio.workspaceName}`,
      Author: "EnergyX",
      ...(Number.isNaN(created.getTime()) ? {} : { CreationDate: created }),
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const writer = new ReportWriter(doc);
  drawCover(writer, portfolio, title, options.frequencyLabel === undefined ? undefined : pdfText(options.frequencyLabel));
  drawSummary(writer, portfolio);
  drawKeyPoints(writer, portfolio);
  drawSitesTable(writer, portfolio);
  drawEnergyChart(writer, portfolio);
  drawBudgets(writer, portfolio);
  drawCarbon(writer, portfolio);
  drawNotes(writer, portfolio);
  drawChrome(writer, title, pdfText(portfolio.workspaceName));

  doc.end();
  return finished;
};

/** e.g. "EnergyX-acme-holdings-2026-09-01-to-2026-09-30.pdf": ASCII only, safe in a download header. */
export const portfolioPdfFileName = (portfolio: Portfolio): string => {
  const slug = portfolio.workspaceName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/gu, "") || "portfolio";
  const day = (value: string): string => (/^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : "undated");
  return `EnergyX-${slug}-${day(portfolio.period.from)}-to-${day(portfolio.period.to)}.pdf`;
};

/** Characters the built-in fonts' WinAnsi encoding has beyond Latin-1 (curly quotes, dashes, euro and so on). */
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Keeps what Helvetica can draw (printable Latin-1 and the WinAnsi extras); anything else becomes "?". */
export const pdfText = (value: string): string => {
  let text = "";
  for (const char of value.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) text += " ";
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(char)) text += char;
    else text += "?";
  }
  return text;
};

/**
 * Draws top-down with an explicit cursor. All text is placed with lineBreak off, so pdfkit never adds a page on its
 * own; room() decides page breaks so that tables can repeat their header row.
 */
class ReportWriter {
  readonly doc: Doc;
  readonly left = MARGIN;
  readonly right: number;
  readonly width: number;
  /** Lowest point for content; the footer sits below it. */
  readonly bottom: number;
  y = MARGIN;

  constructor(doc: Doc) {
    this.doc = doc;
    this.right = doc.page.width - MARGIN;
    this.width = this.right - this.left;
    this.bottom = doc.page.height - MARGIN - 14;
  }

  /** Starts a new page when the next `height` points would run into the footer; true when it did. */
  room(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  newPage(): void {
    this.doc.addPage();
    this.y = PAGE_TOP;
  }

  font(style: TextStyle): void {
    this.doc.font(style.bold ? "Helvetica-Bold" : "Helvetica").fontSize(style.size);
  }

  measure(value: string, style: TextStyle): number {
    this.font(style);
    return this.doc.widthOfString(value, { characterSpacing: style.tracking ?? 0 });
  }

  /** One line of text with its cap top at `y`; clipped with an ellipsis (or first shrunk) to fit `width`. */
  write(value: string, x: number, y: number, options: WriteOptions): number {
    const { doc } = this;
    this.font(options);
    const spacing = { characterSpacing: options.tracking ?? 0 };
    let size = options.size;
    let text = value;
    if (options.width !== undefined) {
      if (options.shrink !== undefined) {
        while (size > options.shrink && doc.widthOfString(text, spacing) > options.width) {
          size = Math.max(options.shrink, size - 0.5);
          doc.fontSize(size);
        }
      }
      text = clip(doc, text, options.width);
    }
    const textWidth = doc.widthOfString(text, spacing);
    const offset = options.width === undefined || options.align === undefined || options.align === "left"
      ? 0
      : options.align === "right" ? options.width - textWidth : (options.width - textWidth) / 2;
    // A shrunk line keeps the baseline of the size it was asked for.
    doc.fillColor(options.color ?? COLOR.ink).text(text, x + offset, y + (options.size - size) * ASCENT, { lineBreak: false, ...spacing });
    return textWidth;
  }

  line(y: number, color: string = COLOR.rule, lineWidth = 0.5, from = this.left, to = this.right): void {
    this.doc.moveTo(from, y).lineTo(to, y).lineWidth(lineWidth).strokeColor(color).stroke();
  }

  /** A rounded tag of text; returns its width. `x` is its left edge, or its right edge when `alignRight`. */
  pill(tone: Tone, x: number, y: number, options: { size?: number; alignRight?: boolean } = {}): number {
    const size = options.size ?? 7;
    const style = { size, bold: true, color: tone.color };
    const width = this.measure(tone.text, style) + 12;
    const height = size + 7;
    const left = options.alignRight ? x - width : x;
    this.doc.roundedRect(left, y, width, height, height / 2).fill(tone.background);
    this.write(tone.text, left + 6, y + (height - size * ASCENT) / 2, style);
    return width;
  }

  /** A section heading with a short brand bar, moved to the next page with the first `keepWithNext` points of what follows. */
  heading(title: string, keepWithNext: number, aside?: string): void {
    const fresh = this.y <= PAGE_TOP;
    const above = fresh ? 0 : 26;
    if (this.y + above + 26 + keepWithNext > this.bottom) {
      this.newPage();
    } else {
      this.y += above;
    }
    this.doc.roundedRect(this.left, this.y - 1, 3, 13, 1.5).fill(COLOR.brandSoft);
    const width = this.write(title, this.left + 10, this.y, { size: 12.5, bold: true, color: COLOR.ink });
    if (aside) this.write(aside, this.left + 10 + width + 8, this.y + 3, { size: 8.5, color: COLOR.muted });
    this.y += 24;
  }

  /** Wrapped text across `width`, breaking pages between lines. */
  paragraph(text: string, style: TextStyle, indent = 0, width = this.width - indent): void {
    const lineHeight = style.size * 1.5;
    this.font(style);
    for (const line of wrap(this.doc, text, width)) {
      this.room(lineHeight);
      this.write(line, this.left + indent, this.y, style);
      this.y += lineHeight;
    }
  }

  lines(text: string, style: TextStyle, width: number): string[] {
    this.font(style);
    return wrap(this.doc, text, width);
  }
}

// ---- Cover and summary -------------------------------------------------------------------------------------------

const drawCover = (writer: ReportWriter, portfolio: Portfolio, title: string, frequencyLabel: string | undefined): void => {
  const { doc, left, width } = writer;
  const pageWidth = doc.page.width;
  doc.rect(0, 0, pageWidth, BAND_HEIGHT).fill(COLOR.brand);
  // A soft lighter wedge on the right keeps the band from looking flat.
  doc.save();
  doc.polygon([pageWidth * 0.62, 0], [pageWidth, 0], [pageWidth, BAND_HEIGHT], [pageWidth * 0.78, BAND_HEIGHT]).fillOpacity(0.18).fill(COLOR.brandSoft);
  doc.restore();
  doc.rect(0, BAND_HEIGHT, pageWidth, 3).fill(COLOR.brandSoft);

  const top = 34;
  doc.roundedRect(left, top - 1, 11, 11, 2.5).fill(COLOR.bandText);
  doc.roundedRect(left + 3, top + 2, 5, 5, 1).fill(COLOR.brand);
  writer.write("EnergyX", left + 17, top + 0.5, { size: 10.5, bold: true, color: "#FFFFFF" });
  const generated = generatedDay(portfolio);
  if (generated) writer.write(`Generated ${generated}`, left, top + 1.5, { size: 8, color: COLOR.bandMuted, width, align: "right" });

  writer.write(title, left, top + 30, { size: 22, bold: true, color: "#FFFFFF", width: width * 0.8, shrink: 15 });
  writer.write(pdfText(portfolio.workspaceName), left, top + 62, { size: 12.5, bold: true, color: COLOR.bandText, width: width * 0.8, shrink: 9 });
  const period = `${formatDay(portfolio.period.from)} – ${formatDay(portfolio.period.to)}`;
  const periodWidth = writer.write(period, left, top + 84, { size: 9.5, color: COLOR.bandMuted });
  if (frequencyLabel) {
    const x = left + periodWidth + 10;
    const tagWidth = writer.measure(frequencyLabel, { size: 7.5, bold: true }) + 16;
    doc.roundedRect(x, top + 81, tagWidth, 14, 7).lineWidth(0.75).strokeColor(COLOR.bandMuted).stroke();
    writer.write(frequencyLabel, x + 8, top + 85.5, { size: 7.5, bold: true, color: COLOR.bandText });
  }
  writer.y = BAND_HEIGHT + 26;
};

type TileTag = { text: string; tone: Tone };
type Tile = { label: string; lines: string[]; color?: string; sub?: string; tag?: TileTag };

const summaryTiles = (portfolio: Portfolio): Tile[] => {
  const { totals } = portfolio;
  const change = totals.previousUsageKwh > 0 ? changePct(totals.usageKwh, totals.previousUsageKwh) : undefined;
  const energy: Tile = {
    label: "Total energy",
    lines: [`${formatKwh(totals.usageKwh)} kWh`],
    ...(change === undefined
      ? { sub: "No previous period to compare" }
      : { tag: { text: formatSignedPct(change), tone: changeTone(change) }, sub: "vs previous period" }),
  };

  const costs = Object.entries(totals.costByCurrency);
  const unpriced = portfolio.sites.filter((site) => site.status === "ok" && !site.cost).length;
  const costLines = costs.length > 3
    ? [...costs.slice(0, 2).map(([currency, amount]) => formatMoney(amount, currency)), `+${costs.length - 2} more currencies`]
    : costs.map(([currency, amount]) => formatMoney(amount, currency));
  const cost: Tile = {
    label: "Electricity cost",
    lines: costLines.length ? costLines : ["Not available"],
    ...(costLines.length ? {} : { color: COLOR.muted }),
    sub: unpriced > 0 ? `${plural(unpriced, "site")} without a price` : costs.length > 1 ? "Not added across currencies" : "For the period",
  };

  const carbon: Tile = {
    label: "Carbon emissions",
    lines: [`${formatNumber(totals.carbonKg / 1000, 1)} tCO2e`],
    sub: "Scope 2, location-based",
  };

  return [energy, cost, carbon, budgetTile(portfolio)];
};

const budgetTile = (portfolio: Portfolio): Tile => {
  const budgets = portfolio.sites.flatMap((site) => (site.budget ? [site.budget] : []));
  if (!budgets.length) return { label: "Budgets", lines: ["No budgets set"], color: COLOR.muted, sub: "Set per site in EnergyX" };
  const { sitesOverBudget: over, sitesAtRisk: atRisk } = portfolio.totals;
  const parts = [over ? `${over} over` : "", atRisk ? `${atRisk} at risk` : ""].filter(Boolean);
  const noData = budgets.every((budget) => budget.status === "no-data");
  return {
    label: "Budgets",
    lines: [parts.length ? parts.join(" · ") : noData ? "No data yet" : "On track"],
    color: over ? COLOR.over : atRisk ? COLOR.risk : noData ? COLOR.muted : COLOR.ok,
    sub: `${plural(budgets.length, "site")} with a monthly budget`,
  };
};

const drawSummary = (writer: ReportWriter, portfolio: Portfolio): void => {
  const tiles = summaryTiles(portfolio);
  const gap = 10;
  const tileWidth = (writer.width - gap * (tiles.length - 1)) / tiles.length;
  const height = 82;
  const inner = tileWidth - 24;
  writer.room(height);
  tiles.forEach((tile, index) => {
    const x = writer.left + index * (tileWidth + gap);
    const y = writer.y;
    writer.doc.roundedRect(x, y, tileWidth, height, 7).lineWidth(0.75).fillAndStroke(COLOR.card, COLOR.rule);
    writer.doc.roundedRect(x + 12, y + 12, 18, 3, 1.5).fill(tile.color && tile.color !== COLOR.muted ? tile.color : COLOR.brandSoft);
    writer.write(tile.label.toUpperCase(), x + 12, y + 22, { size: 6.5, bold: true, color: COLOR.muted, width: inner, tracking: 0.5 });
    const size = tile.lines.length === 1 ? 16 : tile.lines.length === 2 ? 12 : 9.5;
    tile.lines.forEach((line, lineIndex) => {
      writer.write(line, x + 12, y + 36 + lineIndex * size * 1.22, { size, bold: true, color: tile.color ?? COLOR.ink, width: inner, shrink: 8 });
    });
    let subX = x + 12;
    if (tile.tag) subX += writer.pill({ ...tile.tag.tone, text: tile.tag.text }, subX, y + height - 21, { size: 6.8 }) + 5;
    if (tile.sub) writer.write(tile.sub, subX, y + height - 17, { size: 7, color: COLOR.muted, width: x + tileWidth - 12 - subX });
  });
  writer.y += height;
};

/** The few things a manager should notice first, worked out from the figures. */
export const keyPoints = (portfolio: Portfolio): string[] => {
  const withData = portfolio.sites.filter((site) => site.status === "ok" && site.usageKwh > 0);
  const total = portfolio.totals.usageKwh;
  const points: string[] = [];
  const top = [...withData].sort((left, right) => right.usageKwh - left.usageKwh)[0];
  if (top && withData.length > 1 && total > 0) {
    points.push(`${pdfText(top.name)} used the most energy: ${formatKwh(top.usageKwh)} kWh, ${formatNumber((top.usageKwh / total) * 100, 0)}% of the portfolio.`);
  } else if (top) {
    points.push(`${pdfText(top.name)} used ${formatKwh(top.usageKwh)} kWh, about ${formatKwh(top.averageDailyKwh)} kWh a day.`);
  }
  if (portfolio.totals.previousUsageKwh > 0) {
    const change = changePct(total, portfolio.totals.previousUsageKwh);
    points.push(Math.abs(change) < 0.5
      ? `Total use was level with the previous period (${formatKwh(portfolio.totals.previousUsageKwh)} kWh).`
      : `Total use was ${formatNumber(Math.abs(change), 0)}% ${change > 0 ? "higher" : "lower"} than the previous period (${formatKwh(portfolio.totals.previousUsageKwh)} kWh).`);
  }
  const budgets = portfolio.sites.filter((site) => site.budget && site.budget.status !== "no-data");
  const over = budgets.filter((site) => site.budget!.status === "over");
  const risk = budgets.filter((site) => site.budget!.status === "at-risk");
  if (over.length || risk.length) {
    const names = (sites: PortfolioSite[]) => listNames(sites.map((site) => pdfText(site.name)), 3);
    points.push([
      over.length ? `${plural(over.length, "site")} over budget (${names(over)})` : "",
      risk.length ? `${plural(risk.length, "site")} heading over (${names(risk)})` : "",
    ].filter(Boolean).join("; ") + ".");
  } else if (budgets.length) {
    points.push(budgets.length === 1 ? "The site with a budget is on track." : `All ${budgets.length} sites with a budget are on track.`);
  }
  const rising = withData.filter((site) => site.changePct !== null && site.changePct >= 5).sort((left, right) => right.changePct! - left.changePct!)[0];
  if (rising && withData.length > 1) points.push(`Largest increase: ${pdfText(rising.name)}, ${formatSignedPct(rising.changePct!)} on the previous period.`);
  const afterHours = withData.filter((site) => (site.afterHoursSharePct ?? 0) >= 25).sort((left, right) => right.afterHoursSharePct! - left.afterHoursSharePct!)[0];
  if (afterHours) {
    points.push(`${pdfText(afterHours.name)} used ${formatNumber(afterHours.afterHoursSharePct!, 0)}% of its energy outside operating hours. Worth checking what runs overnight and at weekends.`);
  }
  const carbonTop = [...withData].sort((left, right) => right.carbonKg - left.carbonKg)[0];
  if (carbonTop && withData.length > 1 && portfolio.totals.carbonKg > 0) {
    points.push(`Emissions were ${formatNumber(portfolio.totals.carbonKg / 1000, 1)} tCO2e; ${pdfText(carbonTop.name)} accounts for ${formatNumber((carbonTop.carbonKg / portfolio.totals.carbonKg) * 100, 0)}%.`);
  }
  const low = portfolio.sites.filter((site) => site.status === "ok" && site.coveragePct < LOW_COVERAGE_PCT).length;
  if (low) points.push(`${plural(low, "site")} ${low === 1 ? "has" : "have"} incomplete readings for the period, so ${low === 1 ? "its figures may be" : "their figures may be"} understated.`);
  return points.slice(0, KEY_POINTS);
};

const drawKeyPoints = (writer: ReportWriter, portfolio: Portfolio): void => {
  const points = keyPoints(portfolio);
  if (!points.length) return;
  const style: TextStyle = { size: 8.8, color: COLOR.body };
  const textWidth = writer.width - 44;
  const wrapped = points.map((point) => writer.lines(point, style, textWidth));
  const lineHeight = 13;
  const height = 38 + wrapped.reduce((sum, lines) => sum + lines.length * lineHeight + 4, 0);
  writer.y += 18;
  writer.room(height);
  const top = writer.y;
  writer.doc.roundedRect(writer.left, top, writer.width, height, 7).fill(COLOR.mint);
  writer.doc.roundedRect(writer.left, top, 4, height, 2).fill(COLOR.brandSoft);
  writer.write("Key points", writer.left + 20, top + 14, { size: 10, bold: true, color: COLOR.brand });
  let y = top + 34;
  for (const lines of wrapped) {
    writer.doc.circle(writer.left + 24, y + 3, 2).fill(COLOR.brandSoft);
    for (const line of lines) {
      writer.write(line, writer.left + 34, y, style);
      y += lineHeight;
    }
    y += 4;
  }
  writer.y = top + height;
};

// ---- Sites -------------------------------------------------------------------------------------------------------

const drawSitesTable = (writer: ReportWriter, portfolio: Portfolio): void => {
  writer.heading("Sites compared", 74, `${formatDay(portfolio.period.from)} – ${formatDay(portfolio.period.to)}`);
  if (!portfolio.sites.length) {
    writer.paragraph("No sites in this report.", { size: 8.5, color: COLOR.muted });
    return;
  }
  const columns: Column[] = [
    { title: "Site", width: 0 },
    { title: "Energy", unit: "kWh", width: 60 },
    { title: "Change", unit: "vs previous", width: 50 },
    { title: "Cost", width: 70 },
    { title: "Peak", unit: "kW", width: 40 },
    { title: "After", unit: "hours", width: 40 },
    { title: "Carbon", unit: "tCO2e", width: 42 },
    { title: "Budget", width: 58 },
  ];
  const { totals } = portfolio;
  const currencies = Object.entries(totals.costByCurrency);
  const total: Row = {
    cells: [
      { text: "Total", bold: true },
      { text: formatKwh(totals.usageKwh), bold: true },
      totals.previousUsageKwh > 0 ? changeCell(changePct(totals.usageKwh, totals.previousUsageKwh), true) : muted(DASH),
      currencies.length === 1 ? { text: formatMoney(currencies[0]![1], currencies[0]![0]), bold: true } : muted(currencies.length ? "Mixed" : DASH),
      muted(""),
      muted(""),
      { text: formatTonnes(totals.carbonKg), bold: true },
      muted(""),
    ],
  };
  drawTable(writer, columns, portfolio.sites.map(siteRow), { continued: "Sites compared (continued)", noteAcrossRow: false, total });
};

const siteRow = (site: PortfolioSite): Row => {
  const name: Cell = { text: pdfText(site.name), bold: true };
  if (site.status === "unavailable") return { cells: [name], span: muted("No readings for this period"), ...(site.budget ? { trailing: budgetPill(site.budget) } : {}) };
  const notes = [
    site.kwhPerSqm !== undefined ? `${formatKwh(site.kwhPerSqm)} kWh/m²` : "",
    site.coveragePct < LOW_COVERAGE_PCT ? `Readings ${formatCoverage(site.coveragePct)} complete` : "",
  ].filter(Boolean);
  return {
    cells: [
      name,
      { text: formatKwh(site.usageKwh) },
      site.changePct === null ? muted(DASH) : changeCell(site.changePct, false),
      site.cost ? { text: formatMoney(site.cost.amount, site.cost.currency) } : muted(DASH),
      { text: formatKwh(site.peakKw) },
      site.afterHoursSharePct === undefined ? muted(DASH) : { text: `${formatNumber(site.afterHoursSharePct, 0)}%`, ...(site.afterHoursSharePct >= 25 ? { color: COLOR.risk } : {}) },
      { text: formatTonnes(site.carbonKg) },
      site.budget ? budgetPill(site.budget) : muted(DASH),
    ],
    ...(notes.length ? { note: muted(notes.join("  ·  ")) } : {}),
  };
};

/** More energy than before reads as a warning, less as good news. */
const changeCell = (change: number, bold: boolean): Cell => {
  const rounded = Math.round(change);
  return { text: formatSignedPct(change), bold, ...(rounded > 0 ? { color: COLOR.over } : rounded < 0 ? { color: COLOR.ok } : {}) };
};

const changeTone = (change: number): Tone => {
  const rounded = Math.round(change);
  return rounded > 0
    ? { text: "", color: COLOR.over, background: COLOR.overBg }
    : rounded < 0 ? { text: "", color: COLOR.ok, background: COLOR.okBg } : { text: "", color: COLOR.none, background: COLOR.noneBg };
};

const drawEnergyChart = (writer: ReportWriter, portfolio: Portfolio): void => {
  const sites = portfolio.sites
    .filter((site) => site.status === "ok" && site.usageKwh > 0)
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const shown = sites.slice(0, CHART_SITES);
  const rowHeight = 22;
  const more = sites.length > shown.length;
  const showPrevious = shown.some((site) => site.previousUsageKwh > 0);
  writer.heading("Energy by site", shown.length ? 18 + shown.length * rowHeight + (more ? 16 : 0) : 14);
  if (!shown.length) {
    writer.paragraph("No readings for this period.", { size: 8.5, color: COLOR.muted });
    return;
  }
  if (showPrevious) {
    const legendY = writer.y - 20;
    let x = writer.right;
    const legend = (label: string, color: string, height: number) => {
      const width = writer.measure(label, { size: 7 });
      x -= width;
      writer.write(label, x, legendY, { size: 7, color: COLOR.muted });
      x -= 14;
      writer.doc.roundedRect(x, legendY + (5 - height) / 2, 10, height, height / 2).fill(color);
      x -= 14;
    };
    legend("Previous period", COLOR.faint, 2.5);
    legend("This period", COLOR.brand, 6);
  }
  const labelWidth = 150;
  const valueWidth = 92;
  const barX = writer.left + labelWidth + 10;
  const barWidth = writer.right - valueWidth - 12 - barX;
  const largest = Math.max(...shown.map((site) => Math.max(site.usageKwh, site.previousUsageKwh)));
  const total = portfolio.totals.usageKwh;
  for (const site of shown) {
    writer.room(rowHeight);
    const top = writer.y;
    writer.write(pdfText(site.name), writer.left, top + 5, { size: 8, color: COLOR.body, width: labelWidth });
    writer.doc.roundedRect(barX, top + 3, barWidth, 8, 4).fill(COLOR.track);
    writer.doc.roundedRect(barX, top + 3, Math.max(4, (barWidth * site.usageKwh) / largest), 8, 4).fill(COLOR.brand);
    if (site.previousUsageKwh > 0) writer.doc.roundedRect(barX, top + 13.5, Math.max(2, (barWidth * site.previousUsageKwh) / largest), 2.5, 1.25).fill(COLOR.faint);
    const share = total > 0 ? `${formatNumber((site.usageKwh / total) * 100, 0)}%` : "";
    const shareWidth = 26;
    writer.write(`${formatKwh(site.usageKwh)} kWh`, writer.right - valueWidth, top + 5, { size: 8, bold: true, width: valueWidth - shareWidth - 4, align: "right", shrink: 6.5 });
    writer.write(share, writer.right - shareWidth, top + 5, { size: 8, color: COLOR.muted, width: shareWidth, align: "right" });
    writer.y += rowHeight;
  }
  if (more) {
    writer.y += 2;
    writer.write(`The ${shown.length} sites that used the most energy, of ${sites.length} with readings.`, writer.left, writer.y, { size: 7.5, color: COLOR.muted });
    writer.y += 12;
  }
};

// ---- Budgets -----------------------------------------------------------------------------------------------------

const drawBudgets = (writer: ReportWriter, portfolio: Portfolio): void => {
  const sites = portfolio.sites.filter((site) => site.budget);
  if (!sites.length) return;
  const months = [...new Set(sites.map((site) => site.budget!.month))];
  writer.heading("Monthly budgets", 74, months.length === 1 ? formatLongMonth(months[0]!) : undefined);
  const columns: Column[] = [
    { title: "Site", width: 0 },
    ...(months.length > 1 ? [{ title: "Month", width: 50 }] : []),
    { title: "Spent", unit: "so far", width: 72 },
    { title: "Budget", unit: "for the month", width: 72 },
    { title: "Forecast", unit: "month end", width: 72 },
    { title: "Progress", width: 84 },
    { title: "Status", width: 58 },
  ];
  drawTable(writer, columns, sites.map((site) => budgetRow(site, site.budget!, months.length > 1)), { continued: "Monthly budgets (continued)", noteAcrossRow: true });
};

const budgetRow = (site: PortfolioSite, budget: PortfolioBudgetStatus, withMonth: boolean): Row => {
  const name: Cell = { text: pdfText(site.name), bold: true };
  const month: Cell[] = withMonth ? [{ text: formatMonth(budget.month) }] : [];
  if (budget.status === "no-data") {
    return { cells: [name, ...month, muted(DASH), { text: formatMoney(budget.budgetAmount, budget.currency) }, muted(DASH), muted(""), budgetPill(budget)] };
  }
  const bar = (actual: number, forecast: number, target: number): Cell => ({ text: "", bar: { actual, forecast, target, color: BUDGET_STATUS[budget.status].color } });
  if (budget.costNote) {
    const kwh = (value: number): Cell => ({ text: `${formatKwh(value)} kWh` });
    // Without money or a kWh budget, there was nothing to compare against.
    const compared = budget.budgetKwh !== undefined;
    return {
      cells: [
        name,
        ...month,
        kwh(budget.actualKwh),
        compared ? kwh(budget.budgetKwh!) : muted("No kWh budget"),
        kwh(budget.forecastKwh),
        compared ? bar(budget.actualKwh, budget.forecastKwh, budget.budgetKwh!) : muted(""),
        compared ? budgetPill(budget) : { text: "", pill: { text: "Not compared", color: COLOR.none, background: COLOR.noneBg } },
      ],
      note: muted(COST_NOTE[budget.costNote]),
    };
  }
  const money = (value: number | undefined): Cell => (value === undefined ? muted(DASH) : { text: formatMoney(value, budget.currency) });
  return {
    cells: [
      name,
      ...month,
      money(budget.actualCost),
      money(budget.budgetAmount),
      money(budget.forecastCost),
      budget.actualCost !== undefined && budget.forecastCost !== undefined ? bar(budget.actualCost, budget.forecastCost, budget.budgetAmount) : muted(""),
      budgetPill(budget),
    ],
  };
};

const budgetPill = (budget: PortfolioBudgetStatus): Cell => ({ text: "", pill: BUDGET_STATUS[budget.status] });

// ---- Carbon ------------------------------------------------------------------------------------------------------

const drawCarbon = (writer: ReportWriter, portfolio: Portfolio): void => {
  const sites = portfolio.sites.filter((site) => site.status === "ok" && site.carbonKg > 0).sort((left, right) => right.carbonKg - left.carbonKg);
  const total = portfolio.totals.carbonKg;
  writer.heading("Carbon emissions", 90, "Scope 2, location-based");
  writer.room(30);
  const width = writer.write(`${formatNumber(total / 1000, 1)} tCO2e`, writer.left, writer.y, { size: 18, bold: true });
  writer.write("for the period, from metered electricity", writer.left + width + 10, writer.y + 7, { size: 8.5, color: COLOR.muted });
  writer.y += 30;

  if (sites.length > 1 && total > 0) {
    const shown = sites.slice(0, SHARE_SITES);
    const other = sites.slice(SHARE_SITES).reduce((sum, site) => sum + site.carbonKg, 0);
    const parts = [...shown.map((site, index) => ({ label: pdfText(site.name), kg: site.carbonKg, color: SERIES[index % SERIES.length]! })),
      ...(other > 0 ? [{ label: `${sites.length - shown.length} other sites`, kg: other, color: COLOR.faint }] : [])];
    const legendRows = Math.ceil(parts.length / 2);
    writer.room(22 + legendRows * 14);
    const barTop = writer.y;
    writer.doc.save();
    writer.doc.roundedRect(writer.left, barTop, writer.width, 12, 6).clip();
    let x = writer.left;
    for (const part of parts) {
      const segment = (writer.width * part.kg) / total;
      writer.doc.rect(x, barTop, segment + 0.5, 12).fill(part.color);
      x += segment;
    }
    writer.doc.restore();
    writer.y += 22;
    const columnWidth = writer.width / 2;
    parts.forEach((part, index) => {
      const columnX = writer.left + (index % 2) * columnWidth;
      const rowY = writer.y + Math.floor(index / 2) * 14;
      writer.doc.roundedRect(columnX, rowY, 8, 8, 2).fill(part.color);
      writer.write(part.label, columnX + 14, rowY + 1, { size: 8, color: COLOR.body, width: columnWidth - 120 });
      writer.write(`${formatTonnes(part.kg)} t · ${formatNumber((part.kg / total) * 100, 0)}%`, columnX + columnWidth - 104, rowY + 1, { size: 8, color: COLOR.muted, width: 92, align: "right" });
    });
    writer.y += legendRows * 14 + 8;
  }

  const groups = new Map<string, { factor: PortfolioSite["carbonFactor"]; names: string[] }>();
  for (const site of portfolio.sites.filter((candidate) => candidate.status === "ok")) {
    const factor = site.carbonFactor;
    const key = [factor.kgCo2ePerKwh, factor.year, factor.source, factor.provisional === true, factor.basis].join("|");
    const group = groups.get(key) ?? { factor, names: [] };
    group.names.push(pdfText(site.name));
    groups.set(key, group);
  }
  if (groups.size) {
    writer.y += 6;
    writer.room(16 + 24 + 29);
    writer.write("Emission factors used", writer.left, writer.y, { size: 9, bold: true });
    writer.y += 16;
    const columns: Column[] = [
      { title: "Source", width: 0 },
      { title: "Factor", unit: "kg CO2e/kWh", width: 70 },
      { title: "Year", width: 40 },
      { title: "Basis", width: 86 },
    ];
    const rows: Row[] = [...groups.values()].map(({ factor, names }) => ({
      cells: [
        { text: `${pdfText(factor.source)}${factor.provisional ? " (provisional)" : ""}` },
        { text: formatNumber(factor.kgCo2ePerKwh, 3, 4), bold: true },
        { text: String(factor.year) },
        factor.basis === "custom" ? { text: "Entered by customer", color: COLOR.risk } : { text: "Official grid", color: COLOR.ok },
      ],
      note: muted(`Sites: ${listNames(names, FACTOR_SITE_NAMES)}`),
    }));
    drawTable(writer, columns, rows, { continued: "Emission factors used (continued)", noteAcrossRow: true });
  }
  writer.y += 10;
  writer.paragraph(
    "Scope 2 emissions are calculated from each site's metered electricity and its grid emission factor (location-based method). Market-based figures, which account for renewable energy certificates or green tariffs, are not shown.",
    { size: 7.8, color: COLOR.muted },
  );
};

const drawNotes = (writer: ReportWriter, portfolio: Portfolio): void => {
  const low = portfolio.sites
    .filter((site) => site.coveragePct < LOW_COVERAGE_PCT)
    .sort((left, right) => left.coveragePct - right.coveragePct);
  const note = "Figures use each site's official readings, the same as the site's Overview in EnergyX. Coverage below 100% means some meter readings are missing for the period, so energy, cost and carbon for that site may be understated.";
  const style: TextStyle = { size: 7.8, color: COLOR.muted };
  const noteHeight = writer.lines(note, style, writer.width).length * style.size * 1.5;
  const listHeight = low.length ? 22 + low.length * 15 : 0;
  // A short list stays on the page with its explanation rather than leaving a few lines on a page of their own.
  writer.heading("About these figures", noteHeight + Math.min(listHeight, 22 + 8 * 15));
  writer.paragraph(note, style);
  if (!low.length) return;
  writer.y += 8;
  writer.room(16 + Math.min(low.length, 2) * 15);
  writer.write(`Sites with readings below ${LOW_COVERAGE_PCT}% complete`, writer.left, writer.y, { size: 8, bold: true });
  writer.y += 16;
  const nameWidth = 280;
  const valueWidth = 120;
  for (const site of low) {
    writer.room(15);
    writer.write(pdfText(site.name), writer.left, writer.y, { size: 8, color: COLOR.body, width: nameWidth });
    const coverage = site.status === "unavailable" ? "No readings" : `${formatCoverage(site.coveragePct)} of readings`;
    writer.write(coverage, writer.left + nameWidth, writer.y, { size: 8, color: site.status === "unavailable" ? COLOR.over : COLOR.risk, width: valueWidth, align: "right" });
    writer.line(writer.y + 10.5, COLOR.rule, 0.5, writer.left, writer.left + nameWidth + valueWidth);
    writer.y += 15;
  }
};

/** A running header on every page after the first, and "Page X of Y" on every page, once the count is known. */
const drawChrome = (writer: ReportWriter, title: string, workspace: string): void => {
  const { doc } = writer;
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    if (index > 0) {
      const y = 30;
      doc.roundedRect(writer.left, y - 1, 8, 8, 2).fill(COLOR.brand);
      writer.write("EnergyX", writer.left + 12, y, { size: 8, bold: true, color: COLOR.brand });
      writer.font({ size: 7.5 });
      writer.write(`${title} · ${clip(doc, workspace, 220)}`, writer.left, y + 0.5, { size: 7.5, color: COLOR.muted, width: writer.width, align: "right" });
      writer.line(y + 15, COLOR.rule, 0.75);
    }
    const footerY = doc.page.height - MARGIN + 8;
    writer.line(footerY - 9, COLOR.rule, 0.75);
    writer.font({ size: 7.2 });
    writer.write(`Prepared for ${clip(doc, workspace, 260)} by EnergyX`, writer.left, footerY, { size: 7.2, color: COLOR.faint, width: writer.width * 0.7 });
    writer.write(`Page ${index + 1} of ${range.count}`, writer.left, footerY, { size: 7.2, bold: true, color: COLOR.muted, width: writer.width, align: "right" });
  }
};

// ---- Tables ------------------------------------------------------------------------------------------------------

/** The first column takes the width the others leave; it is left-aligned and the rest are right-aligned. */
type Column = { title: string; unit?: string; width: number };
type Cell = {
  text: string;
  color?: string;
  bold?: boolean;
  /** Drawn as a coloured tag instead of plain text. */
  pill?: Tone;
  /** A small progress bar: spent so far, forecast, and the budget as a marker. */
  bar?: { actual: number; forecast: number; target: number; color: string };
};
type Row = {
  cells: Cell[];
  /** Text across every column after the first, in place of their cells (the last column can keep `trailing`). */
  span?: Cell;
  trailing?: Cell;
  /** A small second line, under the first column or across the row. */
  note?: Cell;
};

const ROW_HEIGHT = 21;
const ROW_WITH_NOTE_HEIGHT = 31;
const HEADER_HEIGHT = 26;
const CELL_SIZE = 8.5;

const drawTable = (
  writer: ReportWriter,
  columns: Column[],
  rows: Row[],
  options: { continued: string; noteAcrossRow: boolean; total?: Row },
): void => {
  const fixed = columns.slice(1).reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map((column, index) => (index === 0 ? writer.width - fixed : column.width));
  const xs = widths.map((_, index) => writer.left + widths.slice(0, index).reduce((sum, width) => sum + width, 0));
  const pad = 8;

  const drawHead = (): void => {
    const top = writer.y;
    writer.doc.roundedRect(writer.left, top, writer.width, HEADER_HEIGHT, 5).fill(COLOR.head);
    columns.forEach((column, index) => {
      const x = index === 0 ? xs[0]! + pad : xs[index]! + 4;
      const width = index === 0 ? widths[0]! - pad : widths[index]! - 4 - (index === columns.length - 1 ? pad : 0);
      const align: Align = index === 0 ? "left" : "right";
      const title = column.title.toUpperCase();
      if (column.unit) {
        writer.write(title, x, top + 6, { size: 6.5, bold: true, color: COLOR.muted, width, align, tracking: 0.4 });
        writer.write(column.unit, x, top + 15.5, { size: 6.5, color: COLOR.faint, width, align });
      } else {
        writer.write(title, x, top + 10.5, { size: 6.5, bold: true, color: COLOR.muted, width, align, tracking: 0.4 });
      }
    });
    writer.y += HEADER_HEIGHT + 2;
  };

  const drawCell = (cell: Cell, index: number, textY: number, rowTop: number): void => {
    const right = xs[index]! + widths[index]! - (index === columns.length - 1 ? pad : 0);
    if (cell.pill) {
      writer.pill(cell.pill, right, rowTop + (ROW_HEIGHT - 13.5) / 2, { size: 6.8, alignRight: true });
      return;
    }
    if (cell.bar) {
      const barWidth = widths[index]! - 14;
      const left = right - barWidth;
      const y = rowTop + ROW_HEIGHT / 2 - 3;
      const scale = Math.max(cell.bar.target, cell.bar.forecast, cell.bar.actual, 1);
      writer.doc.roundedRect(left, y, barWidth, 6, 3).fill(COLOR.track);
      writer.doc.save();
      writer.doc.roundedRect(left, y, barWidth, 6, 3).clip();
      writer.doc.rect(left, y, (barWidth * cell.bar.forecast) / scale, 6).fillOpacity(0.28).fill(cell.bar.color);
      writer.doc.rect(left, y, (barWidth * cell.bar.actual) / scale, 6).fillOpacity(1).fill(cell.bar.color);
      writer.doc.restore();
      const marker = left + (barWidth * cell.bar.target) / scale;
      writer.doc.rect(marker - 0.75, y - 3, 1.5, 12).fill(COLOR.ink);
      return;
    }
    writer.write(cell.text, xs[index]! + 6, textY, {
      size: CELL_SIZE,
      bold: cell.bold ?? false,
      color: cell.color ?? COLOR.ink,
      width: right - xs[index]! - 6,
      align: "right",
      shrink: 6.5,
    });
  };

  const drawRow = (row: Row, height: number, shade: string | undefined, separator: boolean): void => {
    const top = writer.y;
    if (shade) writer.doc.rect(writer.left, top, writer.width, height).fill(shade);
    const textY = top + (ROW_HEIGHT - CELL_SIZE * ASCENT) / 2;
    const first = row.cells[0];
    if (first) writer.write(first.text, xs[0]! + pad, textY, { size: CELL_SIZE, bold: first.bold ?? false, color: first.color ?? COLOR.ink, width: widths[0]! - pad - 8 });
    if (row.span) {
      writer.write(row.span.text, xs[1]! + 6, textY, { size: CELL_SIZE, bold: row.span.bold ?? false, color: row.span.color ?? COLOR.ink, width: writer.right - xs[1]! - 6 - (row.trailing ? widths.at(-1)! : 0) });
      if (row.trailing) drawCell(row.trailing, columns.length - 1, textY, top);
    } else {
      row.cells.slice(1).forEach((cell, offset) => drawCell(cell, offset + 1, textY, top));
    }
    if (row.note) {
      const width = options.noteAcrossRow ? writer.width - pad * 2 : widths[0]! - pad - 8;
      writer.write(row.note.text, xs[0]! + pad, top + 19, { size: 7, color: row.note.color ?? COLOR.muted, width });
    }
    writer.y += height;
    if (separator) writer.line(writer.y, COLOR.rule, 0.5);
  };

  /** On a new page, the table carries on under its name and a repeated header row. */
  const roomFor = (height: number): void => {
    if (!writer.room(height)) return;
    writer.write(options.continued, writer.left, writer.y, { size: 9.5, bold: true, color: COLOR.brand });
    writer.y += 18;
    drawHead();
  };

  writer.room(HEADER_HEIGHT + ROW_WITH_NOTE_HEIGHT);
  drawHead();
  rows.forEach((row, index) => {
    const height = row.note ? ROW_WITH_NOTE_HEIGHT : ROW_HEIGHT;
    roomFor(height);
    drawRow(row, height, index % 2 === 1 ? COLOR.zebra : undefined, true);
  });
  if (options.total) {
    roomFor(ROW_HEIGHT + 2);
    writer.doc.roundedRect(writer.left, writer.y + 2, writer.width, ROW_HEIGHT, 5).fill(COLOR.mint);
    writer.y += 2;
    drawRow(options.total, ROW_HEIGHT, undefined, false);
  }
};

// ---- Text and numbers --------------------------------------------------------------------------------------------

const muted = (text: string): Cell => ({ text, color: COLOR.muted });

const listNames = (names: string[], limit: number): string =>
  names.length > limit ? `${names.slice(0, limit).join(", ")} and ${names.length - limit} more` : names.join(", ");

/** Shortens text with an ellipsis until it fits `width` in the current font. */
const clip = (doc: Doc, value: string, width: number): string => {
  if (doc.widthOfString(value) <= width) return value;
  for (let end = value.length - 1; end > 0; end -= 1) {
    const candidate = `${value.slice(0, end).trimEnd()}…`;
    if (doc.widthOfString(candidate) <= width) return candidate;
  }
  return "";
};

/** Greedy word wrap in the current font; a single word wider than the line is clipped. */
const wrap = (doc: Doc, text: string, width: number): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (doc.widthOfString(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = clip(doc, word, width);
  }
  if (line) lines.push(line);
  return lines;
};

const numberFormats = new Map<string, Intl.NumberFormat>();
const formatNumber = (value: number, minDigits: number, maxDigits = minDigits): string => {
  const key = `${minDigits}-${maxDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("en-SG", { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
    numberFormats.set(key, format);
  }
  return format.format(value);
};

const formatKwh = (value: number): string => formatNumber(value, Math.abs(value) >= 100 ? 0 : 1);

const formatTonnes = (kg: number): string => {
  const tonnes = kg / 1000;
  return tonnes > 0 && tonnes < 0.05 ? "<0.1" : formatNumber(tonnes, 1);
};

const formatSignedPct = (value: number): string => {
  const rounded = Math.round(value);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : MINUS}${formatNumber(Math.abs(rounded), 0)}%`;
};

const formatCoverage = (pct: number): string => `${formatNumber(Math.floor(pct * 10) / 10, 0, 1)}%`;

const changePct = (current: number, previous: number): number => ((current - previous) / previous) * 100;

const currencyMark = (currency: string): string => (currency === "SGD" ? "S$" : currency === "MYR" ? "RM" : `${pdfText(currency)} `);

const formatMoney = (amount: number, currency: string): string =>
  `${amount < 0 ? MINUS : ""}${currencyMark(currency)}${formatNumber(Math.abs(amount), 2)}`;

const plural = (count: number, noun: string): string => `${formatNumber(count, 0)} ${noun}${count === 1 ? "" : "s"}`;

/** "2026-09-01" as "1 Sep 2026", read as written (no time zone). */
const formatDay = (date: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : pdfText(date);
};

/** "2026-10" as "Oct 2026". */
const formatMonth = (value: string): string => {
  const match = /^(\d{4})-(\d{2})$/u.exec(value);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${month} ${match[1]}` : pdfText(value);
};

/** "2026-10" as "October 2026". */
const formatLongMonth = (value: string): string => {
  const match = /^(\d{4})-(\d{2})$/u.exec(value);
  const month = match ? LONG_MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${month} ${match[1]}` : pdfText(value);
};

/** The day the report was made, in the sites' local time (they share one in Singapore and Malaysia). */
const generatedDay = (portfolio: Portfolio): string | undefined => {
  const at = new Date(portfolio.generatedAt);
  if (Number.isNaN(at.getTime())) return undefined;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: portfolio.sites[0]?.timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at).map((part) => [part.type, part.value]));
    return formatDay(`${parts.year}-${parts.month}-${parts.day}`);
  } catch {
    return formatDay(at.toISOString().slice(0, 10));
  }
};

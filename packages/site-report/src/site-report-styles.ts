/**
 * Styles for the site energy report, matching the reference Tuya Office report. Plain CSS scoped to `.eiq-report`
 * (not a CSS module) so the same rules style the report on the Overview and inside the downloaded HTML file.
 * The report is a white paper document in both themes, like a printed report.
 */
export const REPORT_CSS = `
.eiq-report{--ink:#1C2530;--ember:#FF4E16;--ember-soft:#FFB59B;--slate:#9AA7B4;--steel:#1F4E63;--fog:#F4F3F0;--line:#E3E1DC;--muted:#6B7480;
  font-family:'Archivo',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:#fff;line-height:1.55;font-size:16px;color-scheme:light;text-align:left}
.eiq-report *{box-sizing:border-box;margin:0;padding:0}
.eiq-report .page{max-width:880px;margin:0 auto;padding:56px 28px 80px}
.eiq-report strong{font-weight:700}
.eiq-report .masthead{border-bottom:3px solid var(--ink);padding-bottom:28px;margin-bottom:8px}
.eiq-report .doc-line{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--muted);margin-bottom:26px}
.eiq-report .doc-line strong{color:var(--ink);font-weight:600}
.eiq-report h1{color:var(--ink);font-size:clamp(30px,5vw,44px);font-weight:800;line-height:1.12;letter-spacing:-.5px;max-width:16ch}
.eiq-report h1 span{color:var(--ember)}
.eiq-report .lede{color:var(--ink);margin-top:14px;font-size:17px;max-width:62ch}
.eiq-report .keyfigs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border-top:1px solid var(--line);margin-top:26px}
.eiq-report .keyfigs div{padding:14px 16px 0 0}
.eiq-report .keyfigs div+div{border-left:1px solid var(--line);padding-left:16px}
.eiq-report .keyfigs b{display:block;font-size:26px;font-weight:800;letter-spacing:-.3px}
.eiq-report .keyfigs small{font-size:12.5px;color:var(--muted);line-height:1.35;display:block;margin-top:2px}
.eiq-report section{margin-top:54px}
.eiq-report .sec-head{display:flex;align-items:baseline;gap:14px;border-top:1px solid var(--ink);padding-top:14px}
.eiq-report .sec-head .num{font-weight:800;font-size:15px;color:var(--ember)}
.eiq-report h2{color:var(--ink);font-size:22px;font-weight:800;letter-spacing:-.2px}
.eiq-report section>p{margin-top:12px;max-width:70ch}
.eiq-report section p+p{margin-top:10px}
.eiq-report .figure{background:var(--fog);border:1px solid var(--line);padding:22px 22px 14px;margin-top:20px}
.eiq-report .figure .caption{font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.45}
.eiq-report .chart-wrap{position:relative}
.eiq-report .chart-scroll{overflow-x:auto}
.eiq-report .chart-wrap svg{display:block;width:100%;height:auto;overflow:visible}
.eiq-report .legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--ink);margin-bottom:10px}
.eiq-report .legend span{display:inline-flex;align-items:center;gap:6px}
.eiq-report .legend i{display:inline-block;width:12px;height:12px;border-radius:2px}
.eiq-report .legend i.line{height:0;width:18px;border-top:2px solid var(--ember);border-radius:0}
.eiq-report .legend i.dash{height:0;width:18px;border-top:2px dashed var(--ink);border-radius:0}
.eiq-report .pies{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}
.eiq-report .pies .figure{margin-top:0}
.eiq-report .pie-title{font-size:14px;font-weight:600;margin-bottom:6px}
.eiq-report .donut{display:block;width:100%;max-width:260px;height:auto;margin:4px auto 0}
.eiq-report .donut-legend{list-style:none;margin-top:12px;display:grid;gap:5px;font-size:12.5px}
.eiq-report .donut-legend li{display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:baseline}
.eiq-report .donut-legend i{width:12px;height:12px;border-radius:2px;display:inline-block;transform:translateY(1px)}
.eiq-report .donut-legend b{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.eiq-report .donut-legend li.active{font-weight:600}
.eiq-report .table-wrap{overflow-x:auto;margin-top:18px}
.eiq-report table{width:100%;border-collapse:collapse;font-size:14.5px}
.eiq-report th{font-weight:600;text-align:left;border-bottom:2px solid var(--ink);padding:8px 10px 8px 0;vertical-align:bottom}
.eiq-report td{border-bottom:1px solid var(--line);padding:8px 10px 8px 0;font-variant-numeric:tabular-nums;vertical-align:top}
.eiq-report th.r,.eiq-report td.r{text-align:right}
.eiq-report td.r{white-space:nowrap}
.eiq-report td:first-child{min-width:150px}
.eiq-report td small.code{display:block;font-size:11.5px;color:var(--muted);margin-top:1px}
.eiq-report th.r:last-child,.eiq-report td.r:last-child{padding-right:0}
.eiq-report td.hot{color:var(--ember);font-weight:600}
.eiq-report tr.total td{border-bottom:none;border-top:2px solid var(--ink);font-weight:600}
.eiq-report .callout{border-left:4px solid var(--ember);background:#FFF4EF;padding:14px 18px;margin-top:18px;max-width:70ch;font-size:15px}
.eiq-report .note{font-size:13px;color:var(--muted);margin-top:14px;max-width:70ch}
.eiq-report .zones p{margin-top:6px}
.eiq-report footer{margin-top:64px;border-top:1px solid var(--line);padding-top:16px;font-size:12.5px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}
.eiq-report .svgt{font-family:inherit}
.eiq-report .tick{font-size:11px;fill:var(--muted)}
.eiq-report .tick.dark{fill:var(--ink)}
.eiq-report .axis-title{font-size:11.5px;fill:var(--muted)}
.eiq-report .chart-label{font-size:11px;font-weight:600;paint-order:stroke;stroke:var(--fog);stroke-width:4px;stroke-linejoin:round}
.eiq-report .hit{fill:transparent;cursor:default}
.eiq-report .tip{position:absolute;z-index:2;pointer-events:none;background:var(--ink);color:#fff;font-size:12px;line-height:1.4;padding:6px 9px;border-radius:4px;white-space:nowrap;transform:translate(-50%,calc(-100% - 10px));box-shadow:0 4px 12px rgba(28,37,48,.18)}
.eiq-report .tip b{display:block;font-weight:600}
.eiq-report .plan-wrap{overflow-x:auto}
.eiq-report .plan{display:block;width:100%;min-width:600px;height:auto}
.eiq-report .plan .zone-title{font-size:15px;font-weight:800;fill:var(--ink)}
.eiq-report .plan .room{fill:#fff;stroke:#8A94A0;stroke-width:1.2}
.eiq-report .plan .rlabel{font-size:12px;fill:var(--ink)}
.eiq-report .plan .rsub{font-size:10.5px;fill:var(--muted)}
.eiq-report .plan .dbtext{font-size:10.5px;font-weight:600;fill:#fff}
.eiq-report .plan .legend-text{font-size:11.5px;fill:var(--ink)}
.eiq-report .plan .halo{paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
/* Narrow layouts follow the report's own width (it also sits inside the Overview), not the window. */
.eiq-report{container-type:inline-size}
@container (max-width:760px){.eiq-report .page{padding:36px 18px 56px}.eiq-report .keyfigs{grid-template-columns:1fr 1fr}.eiq-report .keyfigs div:nth-child(odd){border-left:none;padding-left:0}.eiq-report .keyfigs div:nth-child(even){border-left:1px solid var(--line);padding-left:16px}}
@container (max-width:620px){.eiq-report .pies{grid-template-columns:1fr}.eiq-report .figure{padding:16px 12px 10px}.eiq-report table{font-size:13.5px}}
@media print{.eiq-report .page{padding:20px 0}.eiq-report .figure{break-inside:avoid}.eiq-report section{break-inside:avoid-page;margin-top:36px}.eiq-report .tip{display:none}}
`;

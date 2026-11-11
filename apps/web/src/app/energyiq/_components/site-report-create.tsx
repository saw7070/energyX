"use client";
/**
 * "Create a report" on the Reports page. Two ways to get one:
 * - a site report on the dates you choose, written straight from the meter readings in a few seconds (no AI), in the
 *   style you choose: the full report (the default, as on the Overview) or the management review;
 * - or a question for the energy advisor, which opens the advisor as before.
 */
import { useEffect, useRef, useState } from "react";
import { configApi } from "../../../lib/config-api";
import { useMessages } from "./energyiq-locale";
import { defineMessages } from "./energyiq-messages";
import { useFriendlyError } from "./friendly-error";
import { shiftDate } from "./report-period";
import styles from "./site-report-create.module.css";

export type SiteReportStyleChoice = "full" | "management";

export const siteReportCreateMessages = defineMessages({
  title: "Create a report",
  close: "Close",
  readingsTitle: "From your meter readings",
  readingsIntro: "Written straight from the readings in a few seconds. No AI is used, and it is saved in Reports for your team.",
  from: "From",
  to: "To",
  style: "Style",
  styleFull: "Full report",
  styleFullHint: "Every chart, table and check, as on the Overview.",
  styleManagement: "Management review",
  styleManagementHint: "Short and plain, organised by group, with the things worth deciding. For management.",
  create: "Create report",
  creating: "Writing the report…",
  endAfterStart: "Choose an end date on or after the start date.",
  tooLong: "Choose up to three months at a time.",
  busy: "A report for this site is already being written. Try again in a moment.",
  failed: "The report could not be written from the readings. Check the dates and try again.",
  advisorTitle: "Ask the energy advisor",
  advisorIntro: "For a question, or a report the advisor writes for you.",
  openAdvisor: "Open the energy advisor",
}, {
  "zh-Hans": {
    title: "创建报告",
    close: "关闭",
    readingsTitle: "根据电表读数",
    readingsIntro: "几秒钟内直接根据读数生成，不使用 AI，并保存在报告中供团队查看。",
    from: "开始",
    to: "结束",
    style: "样式",
    styleFull: "完整报告",
    styleFullHint: "包含所有图表、表格和检查，与概览中的相同。",
    styleManagement: "管理层回顾",
    styleManagementHint: "简短易懂，按分组整理，并列出值得决定的事项。适合管理层阅读。",
    create: "创建报告",
    creating: "正在生成报告…",
    endAfterStart: "请选择不早于开始日期的结束日期。",
    tooLong: "每次最多选择三个月。",
    busy: "本场地正在生成一份报告，请稍后再试。",
    failed: "无法根据读数生成报告。请检查日期后重试。",
    advisorTitle: "询问能源顾问",
    advisorIntro: "用于提问，或请顾问为您撰写报告。",
    openAdvisor: "打开能源顾问",
  },
  ms: {
    title: "Cipta laporan",
    close: "Tutup",
    readingsTitle: "Daripada bacaan meter anda",
    readingsIntro: "Ditulis terus daripada bacaan dalam beberapa saat. Tiada AI digunakan, dan ia disimpan dalam Laporan untuk pasukan anda.",
    from: "Dari",
    to: "Hingga",
    style: "Gaya",
    styleFull: "Laporan penuh",
    styleFullHint: "Setiap carta, jadual dan semakan, seperti di Gambaran keseluruhan.",
    styleManagement: "Semakan pengurusan",
    styleManagementHint: "Ringkas dan mudah, disusun mengikut kumpulan, dengan perkara yang perlu diputuskan. Untuk pihak pengurusan.",
    create: "Cipta laporan",
    creating: "Sedang menulis laporan…",
    endAfterStart: "Pilih tarikh akhir pada atau selepas tarikh mula.",
    tooLong: "Pilih sehingga tiga bulan pada satu masa.",
    busy: "Laporan untuk tapak ini sedang ditulis. Cuba lagi sebentar lagi.",
    failed: "Laporan tidak dapat ditulis daripada bacaan. Semak tarikh dan cuba lagi.",
    advisorTitle: "Tanya penasihat tenaga",
    advisorIntro: "Untuk soalan, atau laporan yang ditulis oleh penasihat untuk anda.",
    openAdvisor: "Buka penasihat tenaga",
  },
});

/** Today in the browser, as a calendar date. */
const today = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

/** Asks the server for a site report on the chosen dates and style; resolves with the new report's id. */
export async function createSiteReport(projectId: string, input: { from: string; to: string; style: SiteReportStyleChoice }): Promise<string> {
  const result = await configApi.reportAgentRequest<{ id: string }>(projectId, "site-reports", {
    method: "POST", body: JSON.stringify({ period: { from: input.from, toExclusive: shiftDate(input.to, 1) }, style: input.style }),
  });
  return result.id;
}

export function SiteReportCreateDialog({ projectId, canAskAdvisor, onCreated, onAskAdvisor, onClose }: {
  projectId: string; canAskAdvisor: boolean; onCreated: (reportId: string) => void; onAskAdvisor: () => void; onClose: () => void;
}) {
  const t = useMessages(siteReportCreateMessages);
  const friendly = useFriendlyError();
  const ref = useRef<HTMLDialogElement>(null);
  // The last seven full days by default: a week is what management usually asks about.
  const [to, setTo] = useState(() => shiftDate(today(), -1));
  const [from, setFrom] = useState(() => shiftDate(today(), -7));
  const [style, setStyle] = useState<SiteReportStyleChoice>("full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // happy-dom and older browsers have no showModal; the dialog is then simply shown in place.
    if (ref.current && typeof ref.current.showModal === "function" && !ref.current.open) ref.current.showModal();
    else ref.current?.setAttribute("open", "");
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const create = async () => {
    setError("");
    if (!from || !to || to < from) { setError(t("endAfterStart")); return; }
    setBusy(true);
    try {
      onCreated(await createSiteReport(projectId, { from, to, style }));
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(/PERIOD_TOO_LONG/.test(code) ? t("tooLong") : /ALREADY_RUNNING/.test(code) ? t("busy") : /INVALID_(DATE|PERIOD)|PERIOD_INVALID/.test(code) ? t("endAfterStart") : friendly(reason, t("failed")));
    } finally { setBusy(false); }
  };
  return <dialog ref={ref} className={styles.dialog} aria-label={t("title")} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={styles.bar}><span>{t("title")}</span><button type="button" aria-label={t("close")} onClick={onClose}>✕</button></div>
    <div className={styles.body}>
      <section className={styles.option} aria-labelledby="site-report-create-readings">
        <h3 id="site-report-create-readings">{t("readingsTitle")}</h3>
        <p>{t("readingsIntro")}</p>
        <div className={styles.dates}>
          <label>{t("from")}<input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label>
          <label>{t("to")}<input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
        </div>
        <fieldset className={styles.styles}>
          <legend>{t("style")}</legend>
          {([["full", "styleFull", "styleFullHint"], ["management", "styleManagement", "styleManagementHint"]] as const).map(([value, label, hint]) => <label key={value} className={styles.style}>
            <input type="radio" name="site-report-style" value={value} checked={style === value} onChange={() => setStyle(value)} />
            <strong>{t(label)}</strong>
            <span>{t(hint)}</span>
          </label>)}
        </fieldset>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void create()}>{busy ? t("creating") : t("create")}</button>
          {busy && <span role="status" className={styles.status}>{t("creating")}</span>}
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
      {canAskAdvisor && <section className={styles.option} aria-labelledby="site-report-create-advisor">
        <h3 id="site-report-create-advisor">{t("advisorTitle")}</h3>
        <p>{t("advisorIntro")}</p>
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={onAskAdvisor}>{t("openAdvisor")}</button></div>
      </section>}
    </div>
  </dialog>;
}

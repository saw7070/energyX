"use client";
import { useRef } from "react";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { ReportMarkdown } from "./report-file-preview";
import { EnergyIcon } from "./icons";
import { BoardLegend, SiteFloorMap, mapDevices, propertySummary } from "./site-floor-map";
import { withoutFacts } from "./advisor-facts-model";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { spatialMessages } from "./facility-messages";
import styles from "./project-notes.module.css";

export function ProjectSpatialPreview({ notes, projectId, meters = [] }: { notes: string; projectId: string; meters?: Array<{ id: string; name: string; board: string }> }) {
  const t = useMessages(spatialMessages);
  const { locale } = useEnergyIqLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const spatial = readProjectSpatialReference(notes, projectId);
  if (!spatial) return <div className={styles.brief}><ReportMarkdown>{withoutFacts(notes)}</ReportMarkdown></div>;
  const { reference } = spatial;
  const address = propertySummary(reference, locale);
  const devices = mapDevices(reference, meters);
  const brief = withoutFacts(notes.replace(spatial.block, "")).trim();
  return <div className={styles.notes}>
    <section className={styles.mapCard} aria-label={t("aria")}>
      <header className={styles.header}>
        <div><h4>{t("title")}</h4><p>{address ? `${address} · ` : ""}{t("illustrative")}</p></div>
        <button type="button" className={styles.button} onClick={() => dialog.current?.showModal()}><EnergyIcon name="expand" />{t("enlarge")}</button>
      </header>
      <div className={styles.mapBody}>
        <button type="button" className={styles.mapFrame} aria-label={t("enlargeAria")} onClick={() => dialog.current?.showModal()}><SiteFloorMap reference={reference} devices={devices} /></button>
        <aside><h5>{t("boards")}</h5><BoardLegend reference={reference} /></aside>
      </div>
      <p className={styles.source}>{t("source", { file: reference.provenance.file, status: reference.provenance.status })}</p>
    </section>
    <dialog ref={dialog} className={styles.dialog} aria-label={t("dialog")}>
      <header className={styles.header}><div><h4>{t("title")}</h4>{address && <p>{address}</p>}</div><form method="dialog"><button autoFocus className={styles.button}>{t("close")}</button></form></header>
      <div className={styles.dialogBody}><SiteFloorMap reference={reference} devices={devices} large /><BoardLegend reference={reference} /></div>
    </dialog>
    {brief && <section className={styles.brief} aria-label={t("brief")}><h4>{t("brief")}</h4><ReportMarkdown>{brief}</ReportMarkdown></section>}
  </div>;
}

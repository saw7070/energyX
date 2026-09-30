"use client";
import { useState } from "react";
import { EnergySelect } from "./energy-select";
import { configApi } from "../../../lib/config-api";
import styles from "./project-actions.module.css";
import { useMessages } from "./energyiq-locale";
import { findingLabelMessages, insightReviewMessages, labelFor } from "./project-actions-messages";
export type FindingReview = { revision: number; status: string; importance: string; urgency: string; reason: string };
export function InsightReview({ projectId, insight, onSaved }: { projectId: string; insight: { id: string; title: string; review?: FindingReview }; onSaved: () => void }) {
 const t = useMessages(insightReviewMessages), labels = useMessages(findingLabelMessages);
 // A finding nobody has reviewed carries the service's placeholder reason; start the answer blank instead.
 const initial = insight.review?.revision ? insight.review : { revision: 0, status: "open", importance: "medium", urgency: "routine", ...insight.review, reason: "" };
 const [value, setValue] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(false);
 const options = (kind: "status" | "importance" | "urgency", values: string[]) => values.map(v => ({ value: v, label: labelFor(labels, findingLabelMessages, `${kind}.${v}`, v.charAt(0).toUpperCase() + v.slice(1)) }));
 return <form className={styles.findingEditor} aria-label={t("label")} onSubmit={async e => { e.preventDefault(); setBusy(true); setError(false); try { await configApi.reportActionRequest(projectId, `insights/${insight.id}/review`, { method: "POST", body: JSON.stringify(value) }); onSaved(); } catch { setError(true); } finally { setBusy(false); } }}>
 <h3>{t("title")}</h3>
 <label>{t("status")}<EnergySelect ariaLabel={t("statusLabel")} value={value.status} options={options("status", ["open","monitoring","resolved","archived"])} onValueChange={status => setValue(v => ({...v,status}))} /></label>
 <label>{t("importance")}<EnergySelect ariaLabel={t("importanceLabel")} value={value.importance} options={options("importance", ["high","medium","low"])} onValueChange={importance => setValue(v => ({...v,importance}))} /></label>
 <label>{t("urgency")}<EnergySelect ariaLabel={t("urgencyLabel")} value={value.urgency} options={options("urgency", ["urgent","soon","routine"])} onValueChange={urgency => setValue(v => ({...v,urgency}))} /></label>
 <label>{value.status === "resolved" ? t("resolvedEvidence") : t("why")}<textarea required minLength={12} maxLength={1200} value={value.reason} onChange={e => setValue(v => ({...v,reason:e.target.value}))} /></label>
 {error && <p role="alert">{t("saveFailed")}</p>}<button className={styles.primaryButton} disabled={busy}>{busy ? t("saving") : t("save")}</button>
 </form>;
}

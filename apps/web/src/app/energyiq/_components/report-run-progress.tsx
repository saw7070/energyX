"use client";
import { useEffect, useState } from "react";
import styles from "./report-workbench.module.css";
import { useMessages } from "./energyiq-locale";
import { advisorMessages } from "./report-agent-panel-messages";

type RunState = { status: string; createdAt: string; errorCode?: string };
export function ReportRunProgress({ run, phase, lastActivityAt, connectionLost = false }: {
  run: RunState; phase: string; lastActivityAt?: string; connectionLost?: boolean;
}) {
  const t = useMessages(advisorMessages);
  const [now, setNow] = useState(() => Date.now());
  const active = ["queued", "running"].includes(run.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active && !["failed", "interrupted", "cancelled"].includes(run.status)) return null;
  const minutes = Math.max(0, Math.floor((now - Date.parse(run.createdAt)) / 60000));
  const activityMinutes = lastActivityAt ? Math.max(0, Math.floor((now - Date.parse(lastActivityAt)) / 60000)) : null;
  return <section className={styles.runProgress} aria-label={t("taskStatus")}>
    <strong role="status">{connectionLost && active ? t("reconnecting") : run.status === "queued" ? t("waitingToStart") : phase}</strong>
    {active ? <>
      <span>{Number.isFinite(minutes) ? minutes < 1 ? t("startedRecently") : t("minutesSinceSubmission", { minutes }) : t("taskSavedShort")}{activityMinutes != null && Number.isFinite(activityMinutes) ? ` · ${activityMinutes < 1 ? t("lastActivityRecent") : t("lastActivityMinutes", { minutes: activityMinutes })}` : ""}</span>
      <p>{connectionLost ? t("connectionLostBody") : t("backgroundBody")}</p>
      {minutes >= 5 && !connectionLost && <p>{t("longRunning")}</p>}
    </> : <p>{run.status === "cancelled" ? t("cancelledBody") : run.status === "interrupted" ? t("interruptedBody") : run.errorCode === "REPORT_METER_NAMES_REQUIRED" ? t("meterNamesBody") : run.errorCode === "REPORT_REVIEW_BLOCKED" ? t("reviewBlockedBody") : t("failedBody")}</p>}
  </section>;
}

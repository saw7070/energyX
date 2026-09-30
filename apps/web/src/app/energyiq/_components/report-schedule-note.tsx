"use client";
import { useEffect, useState } from "react";
import { configApi } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { nextReportRun, type ReportFrequency } from "./report-schedule";
import { dateLocale, libraryMessages } from "./report-library-messages";
import styles from "./report-workbench.module.css";

type Schedule = { frequency: string; localHour: number; timezone?: string };

/**
 * When the next report arrives by itself. Shown wherever someone waits for one — the Reports list and
 * the Overview — so nobody wonders whether a report has to be asked for.
 */
export function ReportScheduleNote({ projectId, schedule: given, canSee = true, className }: {
  projectId: string; schedule?: Schedule | null; canSee?: boolean; className?: string;
}) {
  const t = useMessages(libraryMessages);
  const { locale } = useEnergyIqLocale();
  const [loaded, setLoaded] = useState<Schedule | null>(null);
  const fetching = given === undefined && canSee;
  useEffect(() => {
    if (!fetching) { setLoaded(null); return; }
    const controller = new AbortController();
    configApi.reportAgentRequest<{ settings: Schedule }>(projectId, "", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setLoaded(data.settings); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, fetching]);

  const schedule = given ?? loaded;
  if (!canSee || !schedule) return null;
  const time = `${String(schedule.localHour).padStart(2, "0")}:00`;
  const cadence = schedule.frequency === "daily" ? "scheduleDaily"
    : schedule.frequency === "weekly" ? "scheduleWeekly"
    : schedule.frequency === "weekly-monthly" ? "scheduleWeeklyMonthly"
    : "scheduleMonthly";
  const next = schedule.frequency === "off" ? null
    : nextReportRun(new Date(), schedule.timezone ?? "Asia/Singapore", schedule.frequency as ReportFrequency, schedule.localHour);
  return <p className={`${styles.librarySchedule} ${className ?? ""}`}>
    <EnergyIcon name="clock" />
    {schedule.frequency === "off" ? t("scheduleOff") : <>{t(cadence, { time })}
      {next ? <> <strong>{t("nextReport", {
        date: new Date(`${next.date}T12:00:00Z`).toLocaleDateString(dateLocale(locale, "en-GB"), { timeZone: schedule.timezone ?? "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).replace("Sept", "Sep"),
        time: `${String(next.hour).padStart(2, "0")}:00`,
      })}</strong></> : null}</>}
  </p>;
}

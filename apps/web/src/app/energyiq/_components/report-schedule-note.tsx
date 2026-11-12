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
 * the Overview — so nobody wonders whether a report has to be asked for. The Overview (`overview`) shows only the
 * weekly or monthly site report, so there it counts down to those and says daily reports are kept in Reports.
 */
export function ReportScheduleNote({ projectId, schedule: given, canSee = true, overview = false, className }: {
  projectId: string; schedule?: Schedule | null; canSee?: boolean; overview?: boolean; className?: string;
}) {
  const t = useMessages(libraryMessages);
  const { locale } = useEnergyIqLocale();
  const [loaded, setLoaded] = useState<Schedule | null>(null);
  const fetching = given === undefined && canSee;
  useEffect(() => {
    if (!fetching) { setLoaded(null); return; }
    const controller = new AbortController();
    configApi.reportAgentRequest<{ settings: Schedule }>(projectId, "context", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setLoaded(data.settings); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, fetching]);

  const schedule = given ?? loaded;
  if (!canSee || !schedule) return null;
  const time = `${String(schedule.localHour).padStart(2, "0")}:00`;
  // On the Overview a daily report never replaces the one shown: only the weekly and monthly ones count down here.
  const dailyElsewhere = overview && (schedule.frequency === "daily" || schedule.frequency === "daily-weekly-monthly");
  const frequency = dailyElsewhere ? schedule.frequency === "daily" ? "off" : "weekly-monthly" : schedule.frequency;
  const cadence = frequency === "daily" ? "scheduleDaily"
    : frequency === "weekly" ? "scheduleWeekly"
    : frequency === "weekly-monthly" ? "scheduleWeeklyMonthly"
    : frequency === "daily-weekly-monthly" ? "scheduleDailyWeeklyMonthly"
    : "scheduleMonthly";
  const next = frequency === "off" ? null
    : nextReportRun(new Date(), schedule.timezone ?? "Asia/Singapore", frequency as ReportFrequency, schedule.localHour);
  return <p className={`${styles.librarySchedule} ${className ?? ""}`}>
    <EnergyIcon name="clock" />
    {schedule.frequency === "off" ? t("scheduleOff")
      : dailyElsewhere && frequency === "off" ? t("scheduleDailyInReports", { time })
      : <>{t(cadence, { time })}{dailyElsewhere ? <> {t("scheduleDailyAlsoInReports")}</> : null}
      {next ? <> <strong>{t("nextReport", {
        date: new Date(`${next.date}T12:00:00Z`).toLocaleDateString(dateLocale(locale, "en-GB"), { timeZone: schedule.timezone ?? "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).replace("Sept", "Sep"),
        time: `${String(next.hour).padStart(2, "0")}:00`,
      })}</strong></> : null}</>}
  </p>;
}

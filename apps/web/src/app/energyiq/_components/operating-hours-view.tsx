"use client";
import type { ReactNode } from "react";
import type { EnergyOperatingCalendarEntryDto, EnergyOperatingCalendarRevisionDto, EnergyOperatingDayDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { EnergyIcon } from "./icons";
import { operatingHoursMessages, weekdayMessages } from "./operating-policy-messages";
import styles from "./operating-hours-view.module.css";

const WEEK: EnergyOperatingDayDto[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
type Phase = NonNullable<EnergyOperatingCalendarRevisionDto["academic_periods"]>[number]["phase"];
const PHASES = new Set<string>(["teaching", "term_break", "study_exam", "vacation"] satisfies Phase[]);
/** School phase names in the reader's language; an unknown phase from the server is shown as sent. */
const phaseName = (phase: Phase, locale: EnergyIqLocale) => PHASES.has(phase) ? translatorFor(operatingHoursMessages, locale)(`phase.${phase}`) : phase;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hoursText = (value: number, locale: EnergyIqLocale = "en") => translatorFor(operatingHoursMessages, locale)("hours", { hours: Number.isInteger(value) ? value : value.toFixed(1) });

/** Dates in the calendar are local calendar days; end dates are exclusive. */
const day = (date: string, options: Intl.DateTimeFormatOptions, locale: EnergyIqLocale = "en") => new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
const previousDay = (date: string) => new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const WITH_YEAR = { day: "numeric", month: "short", year: "numeric" } as const;
const NO_YEAR = { day: "numeric", month: "short" } as const;
export function dateRange(from: string, toInclusive: string, locale: EnergyIqLocale = "en"): string {
  const sameYear = from.slice(0, 4) === toInclusive.slice(0, 4);
  if (from.slice(0, 10) === toInclusive.slice(0, 10)) return day(from, { weekday: "short", ...WITH_YEAR }, locale);
  // Chinese writes a shared year once on the start date (2026年7月1日至9月30日); English and Malay write it on the end date.
  const [start, end] = locale === "zh-Hans" ? [WITH_YEAR, sameYear ? NO_YEAR : WITH_YEAR] : [sameYear ? NO_YEAR : WITH_YEAR, WITH_YEAR];
  return translatorFor(operatingHoursMessages, locale)("range", { from: day(from, start, locale), to: day(toInclusive, end, locale) });
}
export function inEffect(entry: Pick<EnergyOperatingCalendarEntryDto, "effective_from" | "effective_to">, locale: EnergyIqLocale = "en"): string {
  return entry.effective_to ? dateRange(entry.effective_from, previousDay(entry.effective_to), locale) : translatorFor(operatingHoursMessages, locale)("from", { date: day(entry.effective_from, WITH_YEAR, locale) });
}

/** Hours per week and open weekdays, e.g. { hours: 45, days: "Mon–Fri" }. */
export function weeklySummary(weekly: EnergyOperatingCalendarEntryDto["weekly"], locale: EnergyIqLocale = "en"): { hours: number; openDays: number; days: string } {
  const t = translatorFor(operatingHoursMessages, locale), weekday = translatorFor(weekdayMessages, locale);
  const short = (key: EnergyOperatingDayDto) => weekday(`${key}.short`);
  const open = WEEK.filter(key => (weekly[key] ?? []).length);
  const hours = open.reduce((sum, key) => sum + (weekly[key] ?? []).reduce((total, range) => total + (minutes(range.to) - minutes(range.from)) / 60, 0), 0);
  const runs: EnergyOperatingDayDto[][] = [];
  for (const key of WEEK) {
    if (!(weekly[key] ?? []).length) continue;
    const last = runs[runs.length - 1];
    if (last && WEEK.indexOf(last[last.length - 1]!) === WEEK.indexOf(key) - 1) last.push(key);
    else runs.push([key]);
  }
  const days = runs.map(run => run.length > 2 ? t("dayRun", { from: short(run[0]!), to: short(run[run.length - 1]!) }) : run.map(short).join(t("daySeparator"))).join(t("daySeparator")) || t("closedAllWeek");
  return { hours, openDays: open.length, days };
}

type Upcoming = { from: string; to: string; label: string; closed: boolean; kind: string };
/** The next holidays and special days, with consecutive days of the same name grouped. */
export function upcomingDays(entries: EnergyOperatingCalendarEntryDto[], today: string, limit = 3, locale: EnergyIqLocale = "en"): Upcoming[] {
  const t = translatorFor(operatingHoursMessages, locale);
  const items = entries.flatMap(entry => entry.exceptions ?? []).filter(item => item.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const grouped: Upcoming[] = [];
  for (const item of items) {
    const kind = item.classification === "public_holiday" ? t("kind.publicHoliday") : item.classification === "special_operating_day" || item.operating.length ? t("kind.specialHours") : t("kind.closure");
    const label = item.label ?? kind;
    const last = grouped[grouped.length - 1];
    if (last && last.label === label && last.kind === kind && previousDay(item.date) === last.to) { last.to = item.date; continue; }
    grouped.push({ from: item.date, to: item.date, label, closed: item.operating.length === 0, kind });
  }
  return grouped.slice(0, limit);
}

type Status = "published" | "draft" | "saved";

export function OperatingHoursView({ revision, status, action, ownerName, onViewCalendar, timezone }: {
  revision: EnergyOperatingCalendarRevisionDto; status: Status; action?: ReactNode; ownerName: (owner: EnergyOperatingCalendarEntryDto["owner"]) => string; onViewCalendar: () => void; timezone: string;
}) {
  const t = useMessages(operatingHoursMessages);
  const weekday = useMessages(weekdayMessages);
  const { locale } = useEnergyIqLocale();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const holidays = revision.entries.reduce((sum, entry) => sum + (entry.exceptions?.length ?? 0), 0);
  const upcoming = upcomingDays(revision.entries, today, 3, locale);
  const phases = revision.academic_periods ?? [];
  return <div className={styles.view}>
    <div className={styles.statusRow}>
      <span className={`${styles.badge} ${styles[status]}`}><span className={styles.dot} />{t(`status.${status}`)}</span>
      <span className={styles.hint}>{t(`status.${status}.hint`)}</span>
      {action}
    </div>

    {revision.entries.map(entry => {
      const summary = weeklySummary(entry.weekly, locale);
      return <section key={entry.id} className={styles.entry} aria-label={t("entryLabel", { owner: ownerName(entry.owner) })}>
        <div className={styles.tiles}>
          <div className={styles.tile}><span>{t("openDays")}</span><strong>{summary.days}</strong><small>{t(summary.openDays === 1 ? "openDaysCount.one" : "openDaysCount.other", { count: summary.openDays, owner: ownerName(entry.owner) })}</small></div>
          <div className={styles.tile}><span>{t("hoursPerWeek")}</span><strong>{hoursText(summary.hours, locale)}</strong><small>{summary.openDays ? t("perOpenDay", { hours: hoursText(summary.hours / summary.openDays, locale) }) : t("closedAllWeek")}</small></div>
          <div className={styles.tile}><span>{t("inEffect")}</span><strong>{inEffect(entry, locale)}</strong><small>{entry.effective_to ? t("updateBeforeEnd") : t("noEndDate")}</small></div>
        </div>

        <div className={styles.week} role="table" aria-label={t("weekTable")}>
          <div className={styles.axis} role="presentation" aria-hidden="true"><span /><span className={styles.axisTrack}>{[0, 6, 12, 18, 24].map(hour => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}</span><span /></div>
          {WEEK.map(key => {
            const ranges = entry.weekly[key] ?? [];
            const length = ranges.reduce((total, range) => total + (minutes(range.to) - minutes(range.from)) / 60, 0);
            return <div key={key} role="row" className={`${styles.day} ${ranges.length ? "" : styles.closed}`}>
              <span role="rowheader" className={styles.dayName}>{weekday(`${key}.long`)}</span>
              <span role="cell" className={styles.track} aria-hidden="true">{ranges.map(range => <span key={`${range.from}-${range.to}`} className={styles.open} style={{ left: `${minutes(range.from) / 1440 * 100}%`, width: `${(minutes(range.to) - minutes(range.from)) / 1440 * 100}%` }} />)}</span>
              <span role="cell" className={styles.times}>{ranges.length ? <><strong>{ranges.map(range => `${range.from} – ${range.to}`).join(", ")}</strong><small>{hoursText(length, locale)}</small></> : <strong className={styles.closedText}>{t("closed")}</strong>}</span>
            </div>;
          })}
        </div>
      </section>;
    })}

    <section className={styles.special} aria-label={t("specialLabel")}>
      <header><div><h4>{t("specialTitle")}</h4><p>{t("specialSaved", { count: holidays })}</p></div><button type="button" className={styles.link} onClick={onViewCalendar}>{t("viewCalendar")} <EnergyIcon name="arrow" /></button></header>
      {upcoming.length ? <ul>{upcoming.map(item => <li key={`${item.from}-${item.label}`}>
        <span className={styles.when}>{dateRange(item.from, item.to, locale)}</span>
        <span className={styles.what}><strong>{item.label}</strong><small>{t(item.closed ? "upcomingClosed" : "upcomingDifferent", { kind: item.kind })}</small></span>
      </li>)}</ul> : <p className={styles.none}>{t("noneUpcoming")}</p>}
    </section>

    {phases.length > 0 && <section className={styles.special} aria-label={t("schoolCalendar")}>
      <header><div><h4>{t("schoolCalendar")}</h4><p>{t("schoolCalendarHint")}</p></div></header>
      <ul>{phases.map(period => {
        const current = period.from.slice(0, 10) <= today && today < period.to.slice(0, 10);
        const phase = phaseName(period.phase, locale);
        return <li key={period.id} className={current ? styles.current : undefined}>
          <span className={styles.when}>{dateRange(period.from, previousDay(period.to), locale)}</span>
          <span className={styles.what}><strong>{period.label ?? phase}</strong><small>{current ? t("phaseNow", { phase }) : phase}</small></span>
        </li>;
      })}</ul>
    </section>}
  </div>;
}

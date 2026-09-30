"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { configApi, type EnergyOperatingCalendarRevisionDto } from "../../../lib/config-api";
import { OPERATING_DAYS, calendarDraftFromRevision, calendarPublishEntries, type OperatingCalendarEntryDraft, type OperatingExceptionDraft } from "../admin/operational-policy-model";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, type EnergyIqLocale, type Translate } from "./energyiq-messages";
import { holidayCalendarMessages } from "./holiday-calendar-messages";
import { EnergyIcon } from "./icons";
import { weekdayMessages } from "./operating-policy-messages";
import styles from "./holiday-calendar.module.css";

type ExceptionCategory = Exclude<OperatingExceptionDraft["classification"], "">;
type Category = ExceptionCategory | "school_holiday";
type AcademicPeriod = NonNullable<EnergyOperatingCalendarRevisionDto["academic_periods"]>[number];
type HoursMode = "closed" | "normal" | "custom";
type HolidayText = Translate<keyof typeof holidayCalendarMessages.en>;
/** Categories in display order; their names, hints and examples are in holiday-calendar-messages.ts. */
export const HOLIDAY_CATEGORIES: Array<{ value: Category; hours: HoursMode }> = [
  { value: "public_holiday", hours: "closed" },
  { value: "school_holiday", hours: "normal" },
  { value: "special_closure", hours: "closed" },
  { value: "special_operating_day", hours: "custom" },
];
const HOURS_OPTIONS: HoursMode[] = ["closed", "normal", "custom"];
const hoursText = (group: Pick<Day, "mode" | "hours">, t: HolidayText) => group.mode === "closed" ? t("hours.closed") : group.mode === "normal" ? t("hours.normal") : group.hours;
export const categoryLabel = (value: Category | "", t: HolidayText) => {
  const category = HOLIDAY_CATEGORIES.find(item => item.value === value);
  return category ? t(`${category.value}.label`) : t("otherCategory");
};
const SCHOOL_BREAKS = new Set<AcademicPeriod["phase"]>(["term_break", "vacation"]);
// Saved with the school holiday as its source; stored data, so it stays in English.
const SITE_PROFILE_SOURCE = "Entered in Facility";
const MONTHS = Array.from({ length: 12 }, (_, month) => month);
const MAX_RANGE_DAYS = 62;
const MAX_SCHOOL_DAYS = 120;
const VISIBLE_LANES = 3;

type Day = { date: string; label: string; classification: Category | ""; mode: HoursMode; hours: string; scope: string; usualClosed?: boolean };
type Group = Day & { to: string; dates: string[]; periodId?: string };
type FormState = { original: string[]; periodId?: string; date: string; until: string; name: string; category: Category | ""; hoursMode: HoursMode; from: string; to: string };
type DayInfo = { closed: boolean | null };

/** Month (Apple-style bars) and year views of holidays and school breaks; edits are saved together as one calendar version. */
export function HolidayCalendar({ projectId, timezone, revision, scopeNames, canEdit, onSaved }: { projectId?: string; timezone: string; revision?: EnergyOperatingCalendarRevisionDto; scopeNames: Map<string, string>; canEdit: boolean; onSaved: (message: string) => void }) {
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), [timezone]);
  const [view, setView] = useState<"month" | "year">("month");
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [entries, setEntries] = useState<OperatingCalendarEntryDraft[]>(() => revision ? calendarDraftFromRevision(revision) : []);
  const [periods, setPeriods] = useState<AcademicPeriod[]>(() => revision?.academic_periods ?? []);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const t = useMessages(holidayCalendarMessages);
  const { locale } = useEnergyIqLocale();
  const fmt = (date: string, withWeekday = true) => formatDate(date, withWeekday, locale);
  const oneLocation = t("oneLocation");
  const editable = canEdit && !!projectId && !!revision;
  const year = cursor.year;
  const days = useMemo(() => dayMap(entries, scopeNames, oneLocation), [entries, scopeNames, oneLocation]);
  const originalDays = useMemo(() => dayMap(revision ? calendarDraftFromRevision(revision) : [], scopeNames, oneLocation), [revision, scopeNames, oneLocation]);
  const schoolGroups = useMemo(() => periods.filter(period => SCHOOL_BREAKS.has(period.phase)).map(schoolGroup), [periods]);
  const originalSchoolDates = useMemo(() => new Set((revision?.academic_periods ?? []).filter(period => SCHOOL_BREAKS.has(period.phase)).flatMap(period => dateRange(period.from, addDays(period.to, -1), Infinity))), [revision]);
  const schoolDates = useMemo(() => new Set(schoolGroups.flatMap(group => group.dates)), [schoolGroups]);
  const changedDays = [...new Set([...days.keys(), ...originalDays.keys()])].filter(date => JSON.stringify(days.get(date)) !== JSON.stringify(originalDays.get(date))).length
    + [...new Set([...schoolDates, ...originalSchoolDates])].filter(date => schoolDates.has(date) !== originalSchoolDates.has(date)).length;
  const exceptionGroups = useMemo(() => groupDays([...days.values()].sort((a, b) => a.date.localeCompare(b.date))), [days]);
  const allGroups = useMemo(() => [...exceptionGroups, ...schoolGroups].sort((a, b) => a.date.localeCompare(b.date) || (a.periodId ? 1 : -1)), [exceptionGroups, schoolGroups]);
  const groups = allGroups.filter(group => group.date <= `${year}-12-31` && group.to >= `${year}-01-01`);
  const next = allGroups.find(group => group.to >= today);
  const counts = HOLIDAY_CATEGORIES.filter(item => item.value !== "school_holiday" || periods.length > 0).map(item => ({ ...item, count: item.value === "school_holiday"
    ? [...schoolDates].filter(date => date.startsWith(`${year}-`)).length
    : [...days.values()].filter(day => day.date.startsWith(`${year}-`) && day.classification === item.value).length }));
  const projectEntries = entries.filter(entry => entry.owner.kind === "project");
  const coverage = projectEntries.map(entry => entry.effectiveTo ? t("range", { from: fmt(entry.effectiveFrom, false), to: fmt(addDays(entry.effectiveTo, -1), false) }) : t("coverageFrom", { date: fmt(entry.effectiveFrom, false) })).join(t("listSeparator"));
  const selected = new Set(form ? dateRange(form.date, form.until && form.until >= form.date ? form.until : form.date, MAX_SCHOOL_DAYS) : []);
  const projectEntryFor = (date: string) => projectEntries.find(entry => entry.effectiveFrom <= date && (!entry.effectiveTo || entry.effectiveTo > date));
  const dayInfo = (date: string): DayInfo => { const entry = projectEntryFor(date); return { closed: !entry ? null : entry.weekly[OPERATING_DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!].length === 0 }; };
  const blankForm = (from: string, until = ""): FormState => ({ original: [], date: from, until, name: "", category: "", hoursMode: "closed", ...defaultHours(projectEntryFor(from)) });

  const pickDay = (date: string) => {
    if (!editable) return;
    setError("");
    const group = exceptionGroups.find(item => item.dates.includes(date) && !item.scope) ?? schoolGroups.find(item => item.date <= date && item.to >= date);
    setForm(group ? formFromGroup(group) : blankForm(date));
  };
  const pickRange = (from: string, to: string) => { if (!editable) return; setError(""); setForm(blankForm(from, to > from ? to : "")); };
  const openGroup = (group: Group) => { if (!editable || group.scope) return; setError(""); setForm(formFromGroup(group)); };
  const apply = (state: FormState) => {
    const name = state.name.trim().replace(/\s+/g, " ");
    if (!state.date) return setError(t("error.date"));
    if (!name) return setError(t("error.name"));
    if (!state.category) return setError(t("error.category"));
    const last = state.until || state.date;
    if (last < state.date) return setError(t("error.order"));
    if (state.category === "school_holiday") return applySchool(state, name, last);
    const dates = dateRange(state.date, last, MAX_RANGE_DAYS);
    if (dates.length > MAX_RANGE_DAYS) return setError(t("error.tooLong", { max: MAX_RANGE_DAYS }));
    if (state.hoursMode === "custom" && !(state.from && state.to && state.from < state.to)) return setError(t("error.hours"));
    const outside = dates.filter(date => !projectEntryFor(date));
    if (outside.length) return setError(t("error.outside", { date: fmt(outside[0]!) }));
    const clash = dates.find(date => days.has(date) && !state.original.includes(date));
    if (clash) { const existing = days.get(clash)!.label; return setError(existing ? t("error.clash", { date: fmt(clash), name: existing }) : t("error.clashUnnamed", { date: fmt(clash) })); }
    const category = state.category;
    if (state.periodId) setPeriods(current => current.filter(period => period.id !== state.periodId));
    setEntries(current => current.map(entry => {
      if (entry.owner.kind !== "project") return entry;
      const kept = entry.exceptions.filter(item => !state.original.includes(item.date));
      const added = dates.filter(date => entry.effectiveFrom <= date && (!entry.effectiveTo || entry.effectiveTo > date))
        .map(date => ({ key: `holiday-${date}`, date, label: name, classification: category, operating: (state.hoursMode === "closed" ? [] : state.hoursMode === "custom" ? [{ from: state.from, to: state.to }] : entry.weekly[weekdayKey(date)])
          .map((range, index) => ({ key: `range-${date}-${index}`, from: range.from, to: range.to })) }));
      return { ...entry, exceptions: [...kept, ...added].sort((a, b) => a.date.localeCompare(b.date)) };
    }));
    finish(state.date);
  };
  // A school holiday is a school break in the academic calendar: term time is split around it and operating hours are unchanged.
  const applySchool = (state: FormState, name: string, last: string) => {
    const from = state.date, toExclusive = addDays(last, 1);
    if (dateRange(from, last, MAX_SCHOOL_DAYS).length > MAX_SCHOOL_DAYS) return setError(t("error.schoolTooLong", { max: MAX_SCHOOL_DAYS }));
    const others = periods.filter(period => period.id !== state.periodId);
    const clash = others.find(period => SCHOOL_BREAKS.has(period.phase) && period.from < toExclusive && period.to > from);
    if (clash) {
      const range = t("range", { from: fmt(clash.from, false), to: fmt(addDays(clash.to, -1), false) });
      return setError(clash.label ? t("error.schoolOverlap", { name: clash.label, range }) : t("error.schoolOverlapUnnamed", { range }));
    }
    const original = periods.find(period => period.id === state.periodId);
    const trimmed = others.flatMap(period => period.from >= toExclusive || period.to <= from ? [period] : [
      ...(period.from < from ? [{ ...period, id: `${period.id}-a`, to: from }] : []),
      ...(period.to > toExclusive ? [{ ...period, id: `${period.id}-b`, from: toExclusive }] : []),
    ]);
    const added: AcademicPeriod = { id: original?.id ?? `school-holiday-${from}`, from, to: toExclusive, phase: original?.phase ?? "vacation", label: name, source: original?.source ?? { label: SITE_PROFILE_SOURCE } };
    if (state.original.length) setEntries(current => current.map(entry => entry.owner.kind !== "project" ? entry : { ...entry, exceptions: entry.exceptions.filter(item => !state.original.includes(item.date)) }));
    setPeriods([...trimmed, added].sort((a, b) => a.from.localeCompare(b.from)));
    finish(from);
  };
  const finish = (date: string) => { setForm(null); setError(""); setCursor({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 }); };
  const remove = (state: FormState) => {
    if (state.periodId) setPeriods(current => current.filter(period => period.id !== state.periodId));
    else setEntries(current => current.map(entry => entry.owner.kind !== "project" ? entry : { ...entry, exceptions: entry.exceptions.filter(item => !state.original.includes(item.date)) }));
    setForm(null); setError("");
  };
  const save = async () => {
    if (!projectId || saving) return;
    setSaving(true); setError("");
    try { await configApi.publishEnergyOperatingCalendar(projectId, { entries: calendarPublishEntries(entries, locale), academicPeriods: periods }); onSaved(t("saved")); }
    catch { setError(t("error.save")); }
    finally { setSaving(false); }
  };
  const discard = () => { setEntries(revision ? calendarDraftFromRevision(revision) : []); setPeriods(revision?.academic_periods ?? []); setForm(null); setError(""); };
  const step = (delta: number) => setCursor(current => view === "year" ? { ...current, year: current.year + delta } : { year: current.year + Math.floor((current.month + delta) / 12), month: ((current.month + delta) % 12 + 12) % 12 });
  const isCurrent = view === "year" ? year === Number(today.slice(0, 4)) : `${year}-${String(cursor.month + 1).padStart(2, "0")}` === today.slice(0, 7);

  if (!revision) return <section className={styles.panel}><h3>{t("title")}</h3><p className={styles.muted}>{t("noHours")}</p></section>;
  return <section className={styles.panel} aria-label={t("regionLabel")}>
    <header className={styles.header}>
      <div>
        <h3>{t("title")}</h3>
        <p className={styles.muted}>{editable ? t("instructions") : t("viewOnly")}</p>
      </div>
      {editable && <button type="button" className={styles.primary} onClick={() => { setError(""); setForm(blankForm(today)); }}><EnergyIcon name="plus" />{t("addDay")}</button>}
    </header>

    <div className={styles.summary} style={{ gridTemplateColumns: `repeat(${counts.length},minmax(0,1fr)) minmax(0,1.6fr)` }}>
      {counts.map(item => <div key={item.value} className={styles.stat}><span className={`${styles.swatch} ${styles[item.value]}`} aria-hidden="true" /><strong>{item.count}</strong><span>{item.count === 1 ? t(`${item.value}.label`) : t(`${item.value}.plural`)}</span></div>)}
      <div className={`${styles.stat} ${styles.nextUp}`}><EnergyIcon name="calendar" aria-hidden="true" /><span><small>{t("nextUp")}</small>{next ? <b>{t("nextValue", { name: next.label || categoryLabel(next.classification, t), date: fmt(next.date) })}</b> : <b>{t("nothingScheduled")}</b>}</span></div>
    </div>

    {changedDays > 0 && <div className={styles.unsaved} role="status"><span><b>{t(changedDays === 1 ? "changed.one" : "changed.other", { count: changedDays })}</b> {t("notSaved")}</span><div><button type="button" className={styles.secondary} disabled={saving} onClick={discard}>{t("discard")}</button><button type="button" className={styles.primary} disabled={saving} onClick={() => void save()}>{saving ? t("saving") : t("saveChanges")}</button></div></div>}
    {error && !form && <p role="alert" className={styles.error}>{error}</p>}

    <div className={styles.layout}>
      <div className={styles.calendar}>
        <div className={styles.toolbar}>
          <h4 aria-live="polite">{view === "year" ? year : monthHeading(year, cursor.month, locale)}</h4>
          <div className={styles.toolbarActions}>
            <div className={styles.segmented} role="group" aria-label={t("calendarView")}>{(["month", "year"] as const).map(option => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}>{option === "month" ? t("month") : t("year")}</button>)}</div>
            <div className={styles.stepper}>
              <button type="button" aria-label={view === "year" ? t("previousYear") : t("previousMonth")} onClick={() => step(-1)}><EnergyIcon name="chevron" className={styles.flip} /></button>
              <button type="button" className={styles.todayButton} disabled={isCurrent} onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })}>{t("today")}</button>
              <button type="button" aria-label={view === "year" ? t("nextYear") : t("nextMonth")} onClick={() => step(1)}><EnergyIcon name="chevron" /></button>
            </div>
          </div>
        </div>
        {view === "month"
          ? <MonthView year={year} month={cursor.month} today={today} groups={allGroups} editable={editable} selected={selected} dayInfo={dayInfo} onPickDay={pickDay} onPickRange={pickRange} onOpenGroup={openGroup} />
          : <div className={styles.months}>{MONTHS.map(month => <MiniMonth key={month} year={year} month={month} today={today} editable={editable} selected={selected} groups={allGroups} dayInfo={dayInfo} onPick={pickDay} onOpenMonth={() => { setCursor({ year, month }); setView("month"); }} />)}</div>}
        <div className={styles.calendarMeta}>
          <ul className={styles.legend} aria-label={t("legend")}>
            {HOLIDAY_CATEGORIES.map(item => <li key={item.value}><span className={`${styles.swatch} ${styles[item.value]}`} />{t(`${item.value}.label`)}</li>)}
            <li><span className={`${styles.swatch} ${styles.closedSwatch}`} />{t("normallyClosed")}</li>
            <li><span className={styles.sampleOutside}>12</span>{t("noOperatingHours")}</li>
          </ul>
          {coverage && <p className={styles.coverage}><EnergyIcon name="info" aria-hidden="true" />{t("coverage", { coverage })}</p>}
        </div>
      </div>

      <aside className={styles.side} aria-label={form ? t("detailsLabel") : t("yearLabel", { year })}>
        {form ? <HolidayForm state={form} error={error} onChange={setForm} onCancel={() => { setForm(null); setError(""); }} onSubmit={() => apply(form)} onRemove={form.original.length || form.periodId ? () => remove(form) : undefined} />
          : <YearList year={year} groups={groups} today={today} editable={editable} onOpen={openGroup} onAdd={() => { setError(""); setForm(blankForm(today.startsWith(`${year}-`) ? today : `${year}-01-01`)); }} />}
      </aside>
    </div>
  </section>;
}

/** Apple Calendar-style month: all-day entries are single bars that span their days and wrap onto the next week. */
function MonthView({ year, month, today, groups, editable, selected, dayInfo, onPickDay, onPickRange, onOpenGroup }: { year: number; month: number; today: string; groups: Group[]; editable: boolean; selected: Set<string>; dayInfo: (date: string) => DayInfo; onPickDay: (date: string) => void; onPickRange: (from: string, to: string) => void; onOpenGroup: (group: Group) => void }) {
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const start = addDays(first, -lead);
  const weeks = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
  const [drag, setDrag] = useState<{ anchor: string; current: string } | null>(null);
  const suppressClick = useRef(false);
  const t = useMessages(holidayCalendarMessages);
  const weekdayName = useMessages(weekdayMessages);
  const { locale } = useEnergyIqLocale();
  const separator = t("listSeparator");
  useEffect(() => {
    if (!drag) return;
    const end = () => { if (drag.anchor !== drag.current) { suppressClick.current = true; const [from, to] = [drag.anchor, drag.current].sort() as [string, string]; onPickRange(from, to); } setDrag(null); };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, [drag, onPickRange]);
  const dragging = (date: string) => !!drag && date >= (drag.anchor < drag.current ? drag.anchor : drag.current) && date <= (drag.anchor < drag.current ? drag.current : drag.anchor);
  return <div className={styles.monthView} role="grid" aria-label={monthYear(year, month, locale)}>
    <div className={styles.weekdays} role="row">{OPERATING_DAYS.map(day => <span key={day} role="columnheader">{weekdayName(`${day}.short`)}</span>)}</div>
    {weeks.map(week => {
      const weekStart = week[0]!, weekEnd = week[6]!;
      const lanes: string[] = [];
      const segments = groups.filter(group => group.date <= weekEnd && group.to >= weekStart)
        .map(group => ({ group, from: group.date < weekStart ? weekStart : group.date, to: group.to > weekEnd ? weekEnd : group.to }))
        .sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to))
        .map(segment => { let lane = lanes.findIndex(end => end < segment.from); if (lane < 0) { lane = lanes.length; lanes.push(segment.to); } else lanes[lane] = segment.to; return { ...segment, lane }; });
      const hidden = (date: string) => segments.filter(segment => segment.lane >= VISIBLE_LANES && segment.from <= date && segment.to >= date).length;
      return <div key={weekStart} className={styles.week} role="row">
        {week.map(date => {
          const info = dayInfo(date);
          const outsideMonth = !date.startsWith(first.slice(0, 7));
          const count = hidden(date);
          const label = [formatDate(date, true, locale), ...segments.filter(segment => segment.from <= date && segment.to >= date).map(segment => `${segment.group.label || t("unnamed")}${separator}${categoryLabel(segment.group.classification, t)}`), segments.some(segment => segment.from <= date && segment.to >= date) ? "" : info.closed === null ? t("noHoursSet") : info.closed ? t("normallyClosedDay") : ""].filter(Boolean).join(separator);
          const classes = [styles.cell, info.closed ? styles.cellClosed : "", info.closed === null ? styles.cellOutside : "", outsideMonth ? styles.cellOtherMonth : "", selected.has(date) || dragging(date) ? styles.cellSelected : ""].filter(Boolean).join(" ");
          const number = <span className={`${styles.cellNumber} ${date === today ? styles.cellToday : ""}`}>{Number(date.slice(8)) === 1 && outsideMonth ? firstOfMonth(date, locale) : Number(date.slice(8))}</span>;
          return editable
            ? <button key={date} type="button" role="gridcell" className={classes} aria-label={label} aria-selected={selected.has(date)}
              onPointerDown={event => { if (event.button === 0) setDrag({ anchor: date, current: date }); }}
              onPointerEnter={() => setDrag(current => current ? { ...current, current: date } : current)}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onPickDay(date); }}>{number}{count > 0 && <small className={styles.more}>{t("more", { count })}</small>}</button>
            : <div key={date} role="gridcell" className={classes} aria-label={label}>{number}{count > 0 && <small className={styles.more}>{t("more", { count })}</small>}</div>;
        })}
        <div className={styles.bars}>{segments.filter(segment => segment.lane < VISIBLE_LANES).map(segment => {
          const column = (new Date(`${segment.from}T00:00:00Z`).getUTCDay() + 6) % 7;
          const span = Math.round((Date.parse(segment.to) - Date.parse(segment.from)) / 86_400_000) + 1;
          const continues = [segment.group.date < weekStart ? styles.fromBefore : "", segment.group.to > weekEnd ? styles.toAfter : ""].join(" ");
          const detail = segment.group.periodId ? "" : hoursText(segment.group, t);
          const category = categoryLabel(segment.group.classification, t);
          const content = <><span className={styles.barLabel}>{segment.group.label || category}</span>{span > 1 && detail && <span className={styles.barDetail}>{detail}</span>}</>;
          const style = { gridColumn: `${column + 1} / span ${span}`, gridRow: segment.lane + 1 };
          const className = `${styles.bar} ${styles[segment.group.classification || "other"]} ${continues}`;
          return editable && !segment.group.scope
            ? <button key={`${segment.group.periodId ?? "day"}-${segment.group.date}-${segment.from}`} type="button" className={className} style={style} title={`${segment.group.label} · ${category}`} onClick={() => onOpenGroup(segment.group)}>{content}</button>
            : <span key={`${segment.group.periodId ?? "day"}-${segment.group.date}-${segment.from}`} className={className} style={style} title={`${segment.group.label} · ${category}`}>{content}</span>;
        })}</div>
      </div>;
    })}
  </div>;
}

function MiniMonth({ year, month, today, editable, selected, groups, dayInfo, onPick, onOpenMonth }: { year: number; month: number; today: string; editable: boolean; selected: Set<string>; groups: Group[]; dayInfo: (date: string) => DayInfo; onPick: (date: string) => void; onOpenMonth: () => void }) {
  const t = useMessages(holidayCalendarMessages);
  const weekdayName = useMessages(weekdayMessages);
  const { locale } = useEnergyIqLocale();
  const separator = t("listSeparator");
  const name = monthName(month, locale);
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, index) => `${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`)];
  return <table className={styles.month} aria-label={monthYear(year, month, locale)}>
    <caption><button type="button" onClick={onOpenMonth}>{name}</button></caption>
    <thead><tr>{OPERATING_DAYS.map(day => <th key={day} scope="col" abbr={weekdayName(`${day}.long`)}>{weekdayName(`${day}.narrow`)}</th>)}</tr></thead>
    <tbody>{Array.from({ length: Math.ceil(cells.length / 7) }, (_, week) => <tr key={week}>{cells.slice(week * 7, week * 7 + 7).map((date, index) => {
      if (!date) return <td key={`blank-${index}`} />;
      const info = dayInfo(date);
      const exception = groups.find(group => !group.periodId && group.date <= date && group.to >= date);
      const school = groups.find(group => group.periodId && group.date <= date && group.to >= date);
      const fill = exception ? styles[exception.classification || "other"] : school ? styles.school_holiday : info.closed === null ? styles.outside : info.closed ? styles.closed : "";
      const classes = [styles.day, fill, exception && school ? styles.schoolMark : "", date === today ? styles.today : "", selected.has(date) ? styles.selected : ""].filter(Boolean).join(" ");
      const description = [formatDate(date, true, locale), exception ? `${exception.label || t("unnamed")}${separator}${categoryLabel(exception.classification, t)}` : "", school ? `${school.label || t("schoolBreak")}${separator}${categoryLabel("school_holiday", t)}` : "", !exception && !school ? info.closed === null ? t("noHoursSet") : info.closed ? t("normallyClosedDay") : "" : ""].filter(Boolean).join(separator);
      const number = Number(date.slice(8));
      return <td key={date}>{editable ? <button type="button" className={classes} aria-label={description} title={description} aria-pressed={selected.has(date)} onClick={() => onPick(date)}>{number}</button> : <span className={classes} title={description} aria-label={description} role="img">{number}</span>}</td>;
    })}</tr>)}</tbody>
  </table>;
}

function YearList({ year, groups, today, editable, onOpen, onAdd }: { year: number; groups: Group[]; today: string; editable: boolean; onOpen: (group: Group) => void; onAdd: () => void }) {
  const t = useMessages(holidayCalendarMessages);
  const { locale } = useEnergyIqLocale();
  const fmt = (date: string, withWeekday = true) => formatDate(date, withWeekday, locale);
  const monthOf = (group: Group) => group.date.startsWith(`${year}-`) ? Number(group.date.slice(5, 7)) - 1 : 0;
  const byMonth = MONTHS.map(index => ({ index, name: monthName(index, locale), items: groups.filter(group => monthOf(group) === index) })).filter(month => month.items.length);
  return <div className={styles.list}>
    <div className={styles.listHead}><h4>{year}</h4><span>{t(groups.length === 1 ? "entries.one" : "entries.other", { count: groups.length })}</span></div>
    {!groups.length ? <div className={styles.emptyList}><EnergyIcon name="calendar" aria-hidden="true" /><p>{t("emptyYear", { year })}</p>{editable && <button type="button" className={styles.secondary} onClick={onAdd}>{t("addFirst")}</button>}</div>
      : byMonth.map(month => <section key={month.index} aria-label={month.name}>
        <h5>{month.name}</h5>
        <ul>{month.items.map(group => {
          const category = categoryLabel(group.classification, t);
          const content = <>
            <span className={`${styles.dateBadge} ${styles[group.classification || "other"]}`}><small>{weekday(group.date, locale)}</small><b>{Number(group.date.slice(8))}</b></span>
            <span className={styles.itemText}><strong>{group.label || category}</strong><small>{[group.to !== group.date ? t("range", { from: fmt(group.date, false), to: fmt(group.to, false) }) : "", category, group.periodId ? t("hours.normal") : hoursText(group, t), group.scope ? t("scopeOnly", { scope: group.scope }) : ""].filter(Boolean).join(" · ")}</small></span>
          </>;
          const past = group.to < today ? styles.past : "";
          return <li key={`${group.periodId ?? "day"}-${group.date}`}>{editable && !group.scope ? <button type="button" className={`${styles.item} ${past}`} aria-label={t("edit", { name: group.label || fmt(group.date) })} onClick={() => onOpen(group)}>{content}<EnergyIcon name="chevron" className={styles.itemChevron} /></button> : <div className={`${styles.item} ${past}`}>{content}</div>}</li>;
        })}</ul>
      </section>)}
  </div>;
}

function HolidayForm({ state, error, onChange, onSubmit, onCancel, onRemove }: { state: FormState; error: string; onChange: (state: FormState) => void; onSubmit: () => void; onCancel: () => void; onRemove?: () => void }) {
  const t = useMessages(holidayCalendarMessages);
  const category = HOLIDAY_CATEGORIES.find(item => item.value === state.category);
  const editing = state.original.length > 0 || !!state.periodId;
  const hoursApply = !!state.category && state.category !== "school_holiday";
  return <form className={styles.form} aria-label={editing ? t("form.edit") : t("form.add")} onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <div className={styles.formHead}><h4>{editing ? t("form.editTitle") : t("form.addTitle")}</h4><button type="button" aria-label={t("close")} className={styles.iconButton} onClick={onCancel}><EnergyIcon name="close" /></button></div>
    <div className={styles.pair}>
      <label>{t("from")}<input type="date" name="holiday-from" value={state.date} onChange={event => onChange({ ...state, date: event.target.value })} required /></label>
      <label><span>{t("to")} <em>{t("optional")}</em></span><input type="date" name="holiday-to" value={state.until} min={state.date} onChange={event => onChange({ ...state, until: event.target.value })} /></label>
    </div>
    <label>{t("name")}<input name="holiday-name" value={state.name} placeholder={t(`${category?.value ?? "public_holiday"}.example`)} onChange={event => onChange({ ...state, name: event.target.value })} autoFocus /></label>
    <fieldset className={styles.categories}>
      <legend>{t("category")} <em>{t("chooseOne")}</em></legend>
      {HOLIDAY_CATEGORIES.map(item => <label key={item.value} className={`${styles.categoryCard} ${state.category === item.value ? styles.chosen : ""}`}>
        <input type="radio" name="holiday-category" value={item.value} checked={state.category === item.value} onChange={() => onChange({ ...state, category: item.value, hoursMode: item.hours })} />
        <span className={`${styles.swatch} ${styles[item.value]}`} aria-hidden="true" />
        <span><strong>{t(`${item.value}.label`)}</strong><small>{t(`${item.value}.hint`)}</small></span>
      </label>)}
    </fieldset>
    {hoursApply && <fieldset className={styles.hoursChoice}>
      <legend>{t("hoursOnDays")}</legend>
      <div className={styles.choiceGroup}>{HOURS_OPTIONS.map(option => <label key={option} className={state.hoursMode === option ? styles.choiceChosen : ""}>
        <input type="radio" name="holiday-hours" value={option} checked={state.hoursMode === option} onChange={() => onChange({ ...state, hoursMode: option })} />{t(`hours.${option}`)}
      </label>)}</div>
      <small>{t(`hours.${state.hoursMode}.hint`)}</small>
    </fieldset>}
    {hoursApply && state.hoursMode === "custom" && <div className={styles.pair}>
      <label>{t("opens")}<input type="time" name="holiday-opens" value={state.from} onChange={event => onChange({ ...state, from: event.target.value })} /></label>
      <label>{t("closes")}<input type="time" name="holiday-closes" value={state.to} onChange={event => onChange({ ...state, to: event.target.value })} /></label>
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.formActions}>
      {onRemove && <button type="button" className={styles.danger} onClick={onRemove}>{t("remove")}</button>}
      <button type="button" className={styles.secondary} onClick={onCancel}>{t("cancel")}</button>
      <button type="submit" className={styles.primary} disabled={!state.category}>{editing ? t("update") : t("add")}</button>
    </div>
    <p className={styles.hint}>{t("collected")}</p>
  </form>;
}

function dayMap(entries: OperatingCalendarEntryDraft[], scopeNames: Map<string, string>, unnamedScope: string): Map<string, Day> {
  const map = new Map<string, Day>();
  for (const entry of entries) for (const item of entry.exceptions) {
    const scope = entry.owner.kind === "project" ? "" : scopeNames.get(entry.owner.scopeId) ?? unnamedScope;
    const usual = entry.weekly[weekdayKey(item.date)];
    const mode: HoursMode = !item.operating.length ? "closed" : sameRanges(item.operating, usual) ? "normal" : "custom";
    if (!map.has(item.date) || entry.owner.kind === "project") map.set(item.date, { date: item.date, label: item.label, classification: item.classification, mode, hours: mode === "custom" ? item.operating.map(range => `${range.from}–${range.to}`).join(", ") : "", scope, usualClosed: !usual.length });
  }
  return map;
}

/** Joins consecutive days with the same entry. A normally closed day with no hours fits either Closed or Normal hours, so ranges over weekends stay one bar. */
function groupDays(days: Day[]): Group[] {
  const groups: Array<Group & { settled: boolean }> = [];
  const flexible = (day: Day) => !!day.usualClosed && day.mode === "closed";
  for (const day of days) {
    const last = groups.at(-1);
    const sameEntry = last && last.label === day.label && last.classification === day.classification && last.scope === day.scope && addDays(last.to, 1) === day.date;
    const sameHours = last && (flexible(day) || !last.settled || (last.mode === day.mode && last.hours === day.hours));
    if (last && sameEntry && sameHours) {
      if (!last.settled && !flexible(day)) Object.assign(last, { mode: day.mode, hours: day.hours, settled: true });
      last.to = day.date; last.dates.push(day.date);
    } else groups.push({ ...day, to: day.date, dates: [day.date], settled: !flexible(day) });
  }
  return groups.map(({ settled: _settled, ...group }) => group);
}

const schoolGroup = (period: AcademicPeriod): Group => {
  const to = addDays(period.to, -1);
  return { date: period.from, to, dates: dateRange(period.from, to, Infinity), label: period.label ?? "", classification: "school_holiday", mode: "normal", hours: "", scope: "", periodId: period.id };
};
const formFromGroup = (group: Group): FormState => {
  if (group.periodId) return { original: [], periodId: group.periodId, date: group.date, until: group.to === group.date ? "" : group.to, name: group.label, category: "school_holiday", hoursMode: "normal", from: "09:00", to: "13:00" };
  const [from = "", to = ""] = group.hours.split(",")[0]?.split("–") ?? [];
  const category = group.classification || (group.mode === "custom" ? "special_operating_day" : "special_closure");
  return { original: group.dates, date: group.date, until: group.to === group.date ? "" : group.to, name: group.label, category, hoursMode: group.mode, from: from.trim() || "09:00", to: to.trim() || "13:00" };
};
const defaultHours = (entry?: OperatingCalendarEntryDraft) => {
  const range = entry ? OPERATING_DAYS.map(day => entry.weekly[day][0]).find(Boolean) : undefined;
  return { from: range?.from ?? "09:00", to: range?.to ?? "13:00" };
};
const weekdayKey = (date: string) => OPERATING_DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;
const sameRanges = (left: Array<{ from: string; to: string }>, right: Array<{ from: string; to: string }>) => left.length === right.length && left.every((range, index) => range.from === right[index]?.from && range.to === right[index]?.to);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dateRange = (from: string, to: string, limit: number) => { const dates: string[] = []; if (!from) return dates; for (let date = from; date <= to && dates.length <= limit; date = addDays(date, 1)) dates.push(date); return dates; };
/** English keeps the en-GB dates this calendar always showed; other languages follow the reader's conventions. */
const dateLocale = (locale: EnergyIqLocale) => locale === "en" ? "en-GB" : intlLocale(locale);
const weekday = (date: string, locale: EnergyIqLocale = "en") => new Intl.DateTimeFormat(dateLocale(locale), { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));
export const formatDate = (date: string, withWeekday = true, locale: EnergyIqLocale = "en") => new Intl.DateTimeFormat(dateLocale(locale), { timeZone: "UTC", ...(withWeekday ? { weekday: "short" as const } : {}), day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
const monthFormat = (locale: EnergyIqLocale, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(dateLocale(locale), { timeZone: "UTC", ...options });
const monthName = (month: number, locale: EnergyIqLocale) => monthFormat(locale, { month: "long" }).format(new Date(Date.UTC(2000, month, 1)));
/** "September 2026", "2026年9月", as a label. */
const monthYear = (year: number, month: number, locale: EnergyIqLocale) => monthFormat(locale, { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month, 1)));
/** The same, with the year in a span so it can be styled apart from the month. */
const monthHeading = (year: number, month: number, locale: EnergyIqLocale) => monthFormat(locale, { month: "long", year: "numeric" }).formatToParts(new Date(Date.UTC(year, month, 1)))
  .map((part, index) => part.type === "year" ? <span key={index}>{part.value}</span> : part.value);
/** The first day of a neighbouring month in the month grid: "Oct 1" in English, "10月1日" / "1 Okt" otherwise. */
const firstOfMonth = (date: string, locale: EnergyIqLocale) => locale === "en"
  ? `${monthName(Number(date.slice(5, 7)) - 1, locale).slice(0, 3)} 1`
  : monthFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));

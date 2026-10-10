"use client";
import { useState, type ReactNode } from "react";
import type { EnergyOperatingDayDto } from "../../../lib/config-api";
import { EnergySelect } from "./energy-select";
import { useMessages } from "./energyiq-locale";
import { withCurrency } from "./money";
import { newSiteMessages } from "./new-site-messages";
import { choosePlan, CUSTOM_PLAN, DAYS, includeHolidays, type SiteSettings } from "./new-site-settings";
import { COUNTRY_DEFAULTS, usualOpeningDays, type TariffPlanId } from "./site-region";
import styles from "./new-site.module.css";

const TIMEZONES = ["Asia/Singapore", "Asia/Kuala_Lumpur"];

/** The settings a new site starts with, each pre-filled for its country and editable or left for later. */
export function NewSiteSettingsPanel({ settings, onChange, disabled }: {
  settings: SiteSettings; onChange: (next: SiteSettings) => void; disabled?: boolean;
}) {
  const t = useMessages(newSiteMessages);
  const defaults = COUNTRY_DEFAULTS[settings.country];
  const update = (patch: Partial<SiteSettings>) => onChange({ ...settings, ...patch });
  return <div className={styles.sections}>
    <Section title={t("moneyTitle")}>
      <div className={styles.row}>
        <label><span className={styles.fieldLabel}>{t("currency")}</span>
          <input className={styles.input} disabled={disabled} maxLength={3} value={settings.currency} onChange={event => update({ currency: event.target.value.toUpperCase() })} /></label>
        <label><span className={styles.fieldLabel}>{t("timezone")}</span>
          <EnergySelect ariaLabel={t("timezone")} disabled={disabled} value={settings.timezone} className="w-full"
            options={TIMEZONES.map(zone => ({ value: zone, label: zone.replace("_", " ") }))} onValueChange={timezone => update({ timezone })} /></label>
      </div>
      <TaxFields settings={settings} disabled={disabled} onChange={tax => update({ tax })} />
    </Section>

    <Section title={t("priceTitle")} on={settings.price !== null} disabled={disabled}
      onToggle={on => onChange(on ? choosePlan(settings, defaults.tariffs[0]?.id ?? CUSTOM_PLAN) : { ...settings, price: null })}
      later={t("priceLater")}>
      <PriceFields settings={settings} disabled={disabled} onChange={onChange} />
    </Section>

    <Section title={t("hoursTitle")} on={settings.hours !== null} disabled={disabled}
      onToggle={on => onChange(on
        ? includeHolidays({ ...settings, hours: { days: usualOpeningDays(settings.country, settings.state || undefined), from: "09:00", to: "18:00" } })
        : { ...settings, hours: null })}
      later={t("hoursLater")}>
      {settings.hours && <>
        <div><span className={styles.fieldLabel}>{t("openOn")}</span>
          <DayPicker days={settings.hours.days} disabled={disabled} onChange={days => update({ hours: { ...settings.hours!, days } })} /></div>
        <div className={styles.row}>
          <TimeField label={t("from")} value={settings.hours.from} disabled={disabled} onChange={from => update({ hours: { ...settings.hours!, from } })} />
          <TimeField label={t("to")} value={settings.hours.to} disabled={disabled} onChange={to => update({ hours: { ...settings.hours!, to } })} />
        </div>
      </>}
    </Section>

    <Section title={t("holidaysTitle")} on={settings.hours !== null && settings.holidays !== null} disabled={disabled || settings.hours === null}
      onToggle={on => onChange(on ? includeHolidays(settings) : { ...settings, holidays: null })}
      later={settings.hours === null ? t("holidaysNeedHours") : t("holidaysLater")}>
      <HolidayFields settings={settings} disabled={disabled} onChange={onChange} />
    </Section>
  </div>;
}

function Section({ title, on, onToggle, later, disabled, children }: {
  title: string; on?: boolean; onToggle?: (on: boolean) => void; later?: string; disabled?: boolean; children: ReactNode;
}) {
  const t = useMessages(newSiteMessages);
  const shown = on ?? true;
  return <section className={styles.section} aria-label={title}>
    <header className={styles.sectionHead}>
      <h3>{title}</h3>
      {onToggle && <div className={styles.switch} role="group" aria-label={title}>
        <button type="button" disabled={disabled} aria-pressed={shown} onClick={() => onToggle(true)}>{t("addNow")}</button>
        <button type="button" disabled={disabled} aria-pressed={!shown} onClick={() => onToggle(false)}>{t("later")}</button>
      </div>}
    </header>
    {shown ? <div className={styles.sectionBody}>{children}</div> : <p className={styles.later}>{later}</p>}
  </section>;
}

function TaxFields({ settings, disabled, onChange }: { settings: SiteSettings; disabled?: boolean; onChange: (tax: SiteSettings["tax"]) => void }) {
  const t = useMessages(newSiteMessages);
  const tax = settings.tax;
  if (!tax) {
    return <div>
      <span className={styles.fieldLabel}>{t("tax")}</span>
      <p className={styles.hint}>{settings.country === "MY" ? t("taxNoneMY") : t("taxNone")}</p>
      <button type="button" className={styles.textButton} disabled={disabled}
        onClick={() => onChange({ name: settings.country === "MY" ? "SST" : "GST", pct: settings.country === "MY" ? "8" : "9", basis: "tax_exclusive" })}>{t("taxAdd")}</button>
    </div>;
  }
  return <div>
    <span className={styles.fieldLabel}>{t("tax")}</span>
    <div className={styles.row3}>
      <label><span className={styles.hint}>{t("taxName")}</span>
        <input className={styles.input} disabled={disabled} value={tax.name} onChange={event => onChange({ ...tax, name: event.target.value })} /></label>
      <label><span className={styles.hint}>{t("taxPct")}</span>
        <input className={styles.input} disabled={disabled} inputMode="decimal" value={tax.pct} onChange={event => onChange({ ...tax, pct: event.target.value })} /></label>
      <EnergySelect ariaLabel={t("tax")} disabled={disabled} value={tax.basis} className="w-full"
        options={(["tax_exclusive", "tax_inclusive"] as const).map(basis => ({ value: basis, label: t(`basis.${basis}`) }))}
        onValueChange={basis => onChange({ ...tax, basis: basis === "tax_inclusive" ? "tax_inclusive" : "tax_exclusive" })} />
    </div>
    <button type="button" className={styles.textButton} disabled={disabled} onClick={() => onChange(null)}>{t("taxRemove")}</button>
  </div>;
}

function PriceFields({ settings, disabled, onChange }: { settings: SiteSettings; disabled?: boolean; onChange: (next: SiteSettings) => void }) {
  const t = useMessages(newSiteMessages);
  const price = settings.price;
  if (!price) return null;
  const plans: TariffPlanId[] = [...COUNTRY_DEFAULTS[settings.country].tariffs.map(tariff => tariff.id), CUSTOM_PLAN];
  const preset = COUNTRY_DEFAULTS[settings.country].tariffs.find(tariff => tariff.id === price.planId);
  const setPrice = (patch: Partial<NonNullable<SiteSettings["price"]>>) => onChange({ ...settings, price: { ...price, ...patch } });
  const smallUnit = settings.currency === "MYR" ? "rateSen" : settings.currency === "SGD" ? "rateCents" : null;
  const inSmallUnit = (value: string) => smallUnit && Number(value) > 0 ? t(smallUnit, { value: (Number(value) * 100).toFixed(2) }) : "";
  const priceField = (label: string, value: string, change: (next: string) => void) => <label>
    <span className={styles.fieldLabel}>{label}</span>
    <input className={styles.input} disabled={disabled} inputMode="decimal" value={value} onChange={event => change(event.target.value)} />
    <span className={styles.unit}>{t("rateUnit", { currency: settings.currency || "?" })} {inSmallUnit(value)}</span>
  </label>;
  return <>
    <div className={styles.plans} role="radiogroup" aria-label={t("priceTitle")}>
      {plans.map(id => <button key={id} type="button" role="radio" aria-checked={price.planId === id} disabled={disabled} className={styles.plan}
        onClick={() => onChange(choosePlan(settings, id))}>
        <span className={styles.dot} aria-hidden="true" />
        <span><strong>{t(`plan.${id}`)}</strong><small>{t(`plan.${id}.hint`)}</small></span>
      </button>)}
    </div>
    {price.planId === CUSTOM_PLAN && <label className={styles.check}>
      <input type="checkbox" disabled={disabled} checked={price.peak !== null}
        onChange={event => setPrice({ peak: event.target.checked ? { rate: price.rate, days: DAYS.slice(0, 5), from: "14:00", to: "22:00", holidaysOffPeak: true } : null })} />
      {t("hasPeak")}
    </label>}
    {price.peak
      ? <div className={styles.prices}>
          {priceField(t("peakRate"), price.peak.rate, rate => setPrice({ peak: { ...price.peak!, rate } }))}
          {priceField(t("offPeakRate"), price.rate, rate => setPrice({ rate }))}
        </div>
      : <div className={styles.prices}>{priceField(t("rate"), price.rate, rate => setPrice({ rate }))}</div>}
    {price.peak && <div>
      <span className={styles.fieldLabel}>{t("peakHours")}</span>
      <DayPicker days={price.peak.days} disabled={disabled} onChange={days => setPrice({ peak: { ...price.peak!, days } })} />
      <div className={styles.row} style={{ marginTop: 10 }}>
        <TimeField label={t("from")} value={price.peak.from} disabled={disabled} onChange={from => setPrice({ peak: { ...price.peak!, from } })} />
        <TimeField label={t("to")} value={price.peak.to} disabled={disabled} onChange={to => setPrice({ peak: { ...price.peak!, to } })} />
      </div>
      <label className={styles.check} style={{ marginTop: 10 }}>
        <input type="checkbox" disabled={disabled} checked={price.peak.holidaysOffPeak} onChange={event => setPrice({ peak: { ...price.peak!, holidaysOffPeak: event.target.checked } })} />
        {t("holidaysOffPeak")}
      </label>
    </div>}
    {preset && preset.parts.length > 1 && <div className={styles.details}>
      <h4>{t("partsTitle", { unit: t(`unit.${settings.currency === "MYR" ? "MYR" : "SGD"}`) })}</h4>
      <ul>{preset.parts.map(part => <li key={part.key}><span>{t(`part.${part.key}`)}</span>
        <span>{part.peak !== undefined ? t("peakOff", { peak: part.peak.toFixed(2), offPeak: part.value.toFixed(2) }) : part.value.toFixed(2)}</span></li>)}</ul>
    </div>}
    {price.fixedCharges.length > 0 && <div className={styles.details}>
      <h4>{t("fixedTitle")}</h4>
      <ul>{price.fixedCharges.map(charge => <li key={charge.label}><span>{charge.label}</span>
        <span>{t(`fixed.${charge.unit}`, { amount: withCurrency(settings.currency, charge.amount.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) })}</span></li>)}</ul>
    </div>}
    {preset && <p className={styles.source}>{t("source", { source: preset.source })}</p>}
  </>;
}

function HolidayFields({ settings, disabled, onChange }: { settings: SiteSettings; disabled?: boolean; onChange: (next: SiteSettings) => void }) {
  const t = useMessages(newSiteMessages);
  const [open, setOpen] = useState(false);
  const holidays = settings.holidays;
  if (!holidays) return null;
  if (settings.country === "MY" && !settings.state) return <p className={styles.hint}>{t("holidaysNeedState")}</p>;
  const chosen = holidays.filter(holiday => holiday.chosen).length;
  return <>
    <p className={styles.hint} style={{ marginTop: 0 }}>{t("holidaysCount", { chosen, total: holidays.length })} {t("holidaysCheck")}</p>
    <button type="button" className={styles.textButton} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t("hideList") : t("showList")}</button>
    {open && <div className={styles.holidayList}>
      {holidays.map((holiday, index) => <label key={holiday.date}>
        <input type="checkbox" disabled={disabled} checked={holiday.chosen}
          onChange={event => onChange({ ...settings, holidays: holidays.map((item, at) => at === index ? { ...item, chosen: event.target.checked } : item) })} />
        <span className={styles.holidayDate}>{holiday.date}</span>
        <span className={styles.holidayName}>{holiday.name}
          {holiday.provisional && <span className={styles.tag}>{t("provisional")}</span>}</span>
      </label>)}
    </div>}
  </>;
}

function DayPicker({ days, disabled, onChange }: { days: EnergyOperatingDayDto[]; disabled?: boolean; onChange: (days: EnergyOperatingDayDto[]) => void }) {
  const t = useMessages(newSiteMessages);
  return <div className={styles.days}>
    {DAYS.map(day => <button key={day} type="button" className={styles.day} disabled={disabled} aria-pressed={days.includes(day)}
      onClick={() => onChange(days.includes(day) ? days.filter(item => item !== day) : DAYS.filter(item => item === day || days.includes(item)))}>{t(`day.${day}`)}</button>)}
  </div>;
}

function TimeField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label><span className={styles.fieldLabel}>{label}</span>
    <input type="time" step={900} className={styles.input} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

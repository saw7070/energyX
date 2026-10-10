"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { configApi, type EnergyBudgetStatusDto, type EnergyProjectTargetsDto, type EnergyProjectTargetsInputDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { friendlyErrorMessage } from "./friendly-error";
import { withCurrency } from "./money";
import { siteTargetsMessages } from "./site-targets-messages";
import styles from "./site-targets.module.css";

const THRESHOLDS = [20, 30, 50, 100];

/** A site's monthly budget, carbon factor and overnight check, with where the budget stands this month. */
export function SiteTargets({ projectId }: { projectId: string }) {
  const t = useMessages(siteTargetsMessages);
  const [targets, setTargets] = useState<EnergyProjectTargetsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTargets(await configApi.getEnergyProjectTargets(projectId, { status: true }));
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("loadFailed") }));
    }
  }, [projectId, t]);
  useEffect(() => { setTargets(null); void load(); }, [load]);

  const save = async (body: EnergyProjectTargetsInputDto): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await configApi.updateEnergyProjectTargets(projectId, body);
      setTargets(current => ({ ...saved, ...(current?.status ? { status: current.status } : {}) }));
      setNotice(t("saved"));
      // Budget status depends on the new figures; refresh it quietly.
      void configApi.getEnergyProjectTargets(projectId, { status: true }).then(setTargets).catch(() => undefined);
      return true;
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("saveFailed") }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!targets) return <section className={styles.panel}>{error ? <p role="alert" className={styles.error}>{error}</p> : <p role="status" className={styles.muted}>{t("loading")}</p>}</section>;
  return <SiteTargetsView targets={targets} busy={busy} error={error} notice={notice} onSave={save} />;
}

export function SiteTargetsView({ targets, busy, error, notice, onSave }: {
  targets: EnergyProjectTargetsDto;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSave: (body: EnergyProjectTargetsInputDto) => Promise<boolean>;
}) {
  const t = useMessages(siteTargetsMessages);
  return (
    <section className={styles.panel} aria-label={t("title")}>
      <header className={styles.header}>
        <h3>{t("title")}</h3>
        <p>{t("intro")}</p>
        {!targets.canEdit && <p className={styles.muted}>{t("readOnly")}</p>}
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <BudgetCard targets={targets} busy={busy} onSave={onSave} />
      <CarbonCard targets={targets} busy={busy} onSave={onSave} />
      <OvernightCard targets={targets} busy={busy} onSave={onSave} />
    </section>
  );
}

type CardProps = { targets: EnergyProjectTargetsDto; busy: boolean; onSave: (body: EnergyProjectTargetsInputDto) => Promise<boolean> };

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.card}><header className={styles.cardHeader}><h4>{title}</h4>{action}</header>{children}</section>;
}

function BudgetCard({ targets, busy, onSave }: CardProps) {
  const t = useMessages(siteTargetsMessages);
  const { locale } = useEnergyIqLocale();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [kwh, setKwh] = useState("");
  const currency = targets.budget?.currency ?? targets.currency;
  const money = (value: number, digits = 0) => withCurrency(currency, value.toLocaleString(intlLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  const number = (value: number) => value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 });
  const start = () => {
    setAmount(targets.budget ? String(targets.budget.monthlyAmount) : "");
    setKwh(targets.budget?.monthlyKwh ? String(targets.budget.monthlyKwh) : "");
    setEditing(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await onSave({ budget: { monthlyAmount: Number(amount), currency, ...(kwh.trim() ? { monthlyKwh: Number(kwh) } : {}) } });
    if (ok) setEditing(false);
  };
  const action = targets.canEdit && !editing
    ? <button type="button" className={styles.link} onClick={start}>{targets.budget ? t("edit") : t("budgetAdd")}</button>
    : undefined;
  return (
    <Card title={t("budgetTitle")} action={action}>
      {editing ? (
        <form className={styles.form} onSubmit={event => void submit(event)}>
          <label className={styles.field}><span>{t("budgetAmount")}</span>
            <span className={styles.money}><b>{withCurrency(currency, "").trim()}</b><input inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} aria-label={t("budgetAmount")} /></span>
          </label>
          <label className={styles.field}><span>{t("budgetKwh")}</span>
            <input inputMode="decimal" value={kwh} onChange={event => setKwh(event.target.value)} aria-label={t("budgetKwh")} />
            <small>{t("budgetKwhHint")}</small>
          </label>
          <div className={styles.actions}>
            {targets.budget && <button type="button" className={styles.danger} disabled={busy} onClick={() => void onSave({ budget: null }).then(ok => ok && setEditing(false))}>{t("budgetRemove")}</button>}
            <button type="button" className={styles.secondary} onClick={() => setEditing(false)}>{t("cancel")}</button>
            <button type="submit" className={styles.primary} disabled={busy || !(Number(amount) > 0)}>{t("save")}</button>
          </div>
        </form>
      ) : targets.budget ? (
        <>
          <p className={styles.value}>{targets.budget.monthlyKwh
            ? t("budgetPerMonthKwh", { amount: money(targets.budget.monthlyAmount), kwh: number(targets.budget.monthlyKwh) })
            : t("budgetPerMonth", { amount: money(targets.budget.monthlyAmount) })}</p>
          {targets.status?.budget && <BudgetStatus status={targets.status.budget} />}
        </>
      ) : <p className={styles.muted}>{t("budgetNone")}</p>}
    </Card>
  );
}

export function BudgetStatus({ status }: { status: EnergyBudgetStatusDto }) {
  const t = useMessages(siteTargetsMessages);
  const { locale } = useEnergyIqLocale();
  const money = (value: number) => withCurrency(status.currency, value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 }));
  const number = (value: number) => value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 });
  const month = new Date(`${status.month}-01T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", month: "long", year: "numeric" });
  if (status.status === "no-data") return <p className={styles.muted}>{t("budgetNoData")}</p>;
  const onMoney = status.actualCost !== undefined && status.forecastCost !== undefined;
  const target = onMoney ? status.budgetAmount : status.budgetKwh ?? 0;
  const actual = onMoney ? status.actualCost! : status.actualKwh;
  const forecast = onMoney ? status.forecastCost! : status.forecastKwh;
  const scale = Math.max(target, forecast, actual, 1);
  return (
    <div className={styles.status}>
      <div className={styles.statusLine}>
        <strong>{t("budgetMonth", { month })}</strong>
        <span className={`${styles.badge} ${styles[status.status]}`}>{t(`status.${status.status}`)}</span>
      </div>
      <p>{onMoney ? t("budgetSpent", { spent: money(actual), budget: money(target) }) : t("budgetUsed", { used: number(actual), budget: number(target) })}</p>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.barForecast} style={{ width: `${(forecast / scale) * 100}%` }} />
        <span className={styles.barActual} style={{ width: `${(actual / scale) * 100}%` }} />
        <span className={styles.barBudget} style={{ left: `${(target / scale) * 100}%` }} />
      </div>
      <p>{t("budgetForecast", { value: onMoney ? money(forecast) : `${number(forecast)} kWh` })}</p>
      {status.dataThrough && <small className={styles.muted}>{t("budgetDataThrough", { date: new Date(`${status.dataThrough}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short" }) })}</small>}
      {status.costNote && <small className={styles.muted}>{t(status.costNote === "currency-differs" ? "budgetCurrencyDiffers" : "budgetTariffMissing")}</small>}
    </div>
  );
}

function CarbonCard({ targets, busy, onSave }: CardProps) {
  const t = useMessages(siteTargetsMessages);
  const [editing, setEditing] = useState(false);
  const [factor, setFactor] = useState("");
  const [year, setYear] = useState("");
  const [source, setSource] = useState("");
  const carbon = targets.carbon;
  const start = () => {
    setFactor(String(carbon.kgCo2ePerKwh));
    setYear(String(carbon.year));
    setSource(carbon.basis === "custom" ? carbon.source : "");
    setEditing(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await onSave({ carbon: { kgCo2ePerKwh: Number(factor), ...(year ? { year: Number(year) } : {}), ...(source.trim() ? { source: source.trim() } : {}) } });
    if (ok) setEditing(false);
  };
  return (
    <Card title={t("carbonTitle")} action={targets.canEdit && !editing ? <button type="button" className={styles.link} onClick={start}>{t("edit")}</button> : undefined}>
      <p className={styles.muted}>{t("carbonBody")}</p>
      {editing ? (
        <form className={styles.form} onSubmit={event => void submit(event)}>
          <div className={styles.grid}>
            <label className={styles.field}><span>{t("carbonEditFactor")}</span><input inputMode="decimal" required value={factor} onChange={event => setFactor(event.target.value)} aria-label={t("carbonEditFactor")} /></label>
            <label className={styles.field}><span>{t("carbonEditYear")}</span><input inputMode="numeric" value={year} onChange={event => setYear(event.target.value)} aria-label={t("carbonEditYear")} /></label>
          </div>
          <label className={styles.field}><span>{t("carbonEditSource")}</span><input value={source} maxLength={200} onChange={event => setSource(event.target.value)} aria-label={t("carbonEditSource")} /><small>{t("carbonEditSourceHint")}</small></label>
          <small className={styles.muted}>{t("carbonEditHint")}</small>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setEditing(false)}>{t("cancel")}</button>
            <button type="submit" className={styles.primary} disabled={busy || !(Number(factor) >= 0) || factor.trim() === ""}>{t("save")}</button>
          </div>
        </form>
      ) : (
        <div className={styles.factor}>
          <p className={styles.value}>{t("carbonFactor", { factor: carbon.kgCo2ePerKwh })}</p>
          <p className={styles.muted}>
            <span className={styles.tag}>{carbon.basis === "grid" ? t("carbonOfficial") : t("carbonCustom")}</span>
            {" "}{carbon.source} · {carbon.year}{carbon.provisional ? ` (${t("carbonProvisional")})` : ""}
          </p>
          {carbon.basis === "custom" && targets.canEdit && (
            <button type="button" className={styles.link} disabled={busy} onClick={() => void onSave({ carbon: null })}>{t("carbonUseOfficial", { factor: targets.gridCarbon.kgCo2ePerKwh })}</button>
          )}
        </div>
      )}
    </Card>
  );
}

function OvernightCard({ targets, busy, onSave }: CardProps) {
  const t = useMessages(siteTargetsMessages);
  const { locale } = useEnergyIqLocale();
  const finding = targets.status?.overnight;
  const thresholds = THRESHOLDS.includes(targets.overnight.thresholdPct) ? THRESHOLDS : [...THRESHOLDS, targets.overnight.thresholdPct].sort((a, b) => a - b);
  return (
    <Card title={t("overnightTitle")}>
      <p className={styles.muted}>{t("overnightBody")}</p>
      <div className={styles.overnight}>
        <div role="radiogroup" aria-label={t("overnightTitle")} className={styles.segmented}>
          {[true, false].map(enabled => (
            <button key={String(enabled)} type="button" role="radio" aria-checked={targets.overnight.enabled === enabled} disabled={!targets.canEdit || busy}
              onClick={() => targets.overnight.enabled !== enabled && void onSave({ overnight: { enabled } })}>
              {enabled ? t("overnightOn") : t("overnightOff")}
            </button>
          ))}
        </div>
        {targets.overnight.enabled && (targets.canEdit
          ? <label className={styles.inline}><span>{t("overnightSensitivity")}</span>
              <select value={targets.overnight.thresholdPct} disabled={busy} onChange={event => void onSave({ overnight: { thresholdPct: Number(event.target.value) } })} aria-label={t("overnightSensitivity")}>
                {thresholds.map(pct => <option key={pct} value={pct}>{pct}%</option>)}
              </select>
            </label>
          : <span className={styles.muted}>{t("overnightThreshold", { pct: targets.overnight.thresholdPct })}</span>)}
      </div>
      {targets.overnight.enabled && targets.status && (finding
        ? <p className={styles.warning}>{t("overnightLast", {
            date: new Date(`${finding.night}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }),
            kw: finding.nightKw, usual: finding.usualKw, pct: finding.abovePct,
          })}</p>
        : <p className={styles.muted}>{t("overnightClear")}</p>)}
    </Card>
  );
}

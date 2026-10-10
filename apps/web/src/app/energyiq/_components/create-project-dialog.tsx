"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { configApi } from "../../../lib/config-api";
import { EnergySelect } from "./energy-select";
import { EnergyIcon } from "./icons";
import { useMessages } from "./energyiq-locale";
import { translatorFor } from "./energyiq-messages";
import { newSiteMessages } from "./new-site-messages";
import { calendarEntryForSave, chooseState, defaultSiteSettings, settingsProblem, tariffEntryForSave, type SettingsProblem, type SiteSettings } from "./new-site-settings";
import { NewSiteSettingsPanel } from "./new-site-settings-panel";
import { projectSetupMessages } from "./report-project-setup-messages";
import { MALAYSIA_STATES, type CountryCode, type TariffPlanId } from "./site-region";
import siteStyles from "./new-site.module.css";

// Saved plan names stay in English, like other configuration, whatever language the person creates them in.
const planLabel = (planId: TariffPlanId) => translatorFor(newSiteMessages, "en")(`plan.${planId}`);

/**
 * Create project in two steps: a name and where the site is, then the settings that place gives it (money, tax,
 * time zone, electricity price, opening hours and public holidays), each checked and editable before anything is
 * saved. A retry never creates the project twice and never repeats a part that already saved.
 */
export function CreateProjectDialog({ workspaceName, onCreated, onClose }: {
  workspaceName: string; onCreated: (projectId: string) => Promise<void>; onClose: () => void;
}) {
  const t = useMessages(projectSetupMessages);
  const site = useMessages(newSiteMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"place" | "settings">("place");
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [problem, setProblem] = useState<SettingsProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unsaved, setUnsaved] = useState<"price" | "hours" | null>(null);
  const createdId = useRef<string | null>(null);
  const saved = useRef({ price: false, hours: false });
  const inFlight = useRef(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const country = settings?.country ?? null;
  const placeReady = name.trim() !== "" && settings !== null && (settings.country !== "MY" || settings.state !== "");
  const place = settings ? (settings.country === "MY" && settings.state
    ? `${site("country.MY")} (${MALAYSIA_STATES.find(([code]) => code === settings.state)?.[1] ?? settings.state})`
    : site(`country.${settings.country}`)) : "";

  const pickCountry = (next: CountryCode) => {
    if (next === country) return;
    setSettings(defaultSiteSettings(next));
    setProblem(null);
  };

  async function finish(projectId: string) {
    try {
      await onCreated(projectId);
    } catch {
      setError(t("createdButNotOpened"));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "place") {
      if (placeReady) { setStep("settings"); setProblem(null); }
      return;
    }
    if (inFlight.current || !settings) return;
    const nextProblem = settingsProblem(settings);
    setProblem(nextProblem);
    if (nextProblem) return;
    inFlight.current = true; setBusy(true); setError(""); setUnsaved(null);
    try {
      if (!createdId.current) {
        try {
          const result = await configApi.createEnergyProject({
            name: name.trim(),
            timezone: settings.timezone,
            region: { country: settings.country, ...(settings.state ? { state: settings.state } : {}) },
          });
          createdId.current = result.project.id;
        } catch {
          setError(t("createFailed"));
          return;
        }
      }
      const projectId = createdId.current;
      if (!saved.current.price) {
        const entry = tariffEntryForSave(settings, planLabel);
        try {
          if (entry) await configApi.publishEnergyTariffSchedule(projectId, { entries: [entry] });
          saved.current.price = true;
        } catch {
          setUnsaved("price");
          return;
        }
      }
      if (!saved.current.hours) {
        const entry = calendarEntryForSave(settings);
        try {
          if (entry) await configApi.publishEnergyOperatingCalendar(projectId, { entries: [entry] });
          saved.current.hours = true;
        } catch {
          setUnsaved("hours");
          return;
        }
      }
      await finish(projectId);
    } finally { inFlight.current = false; setBusy(false); }
  }

  const created = createdId.current !== null;
  const stepState = (which: "place" | "settings") => which === step ? "current" : which === "place" ? "done" : "next";
  return <dialog ref={dialog} aria-label={t("createProject")} className={siteStyles.dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={siteStyles.dialogHead}>
      <span className={siteStyles.dialogIcon} aria-hidden="true"><EnergyIcon name="building" /></span>
      <div className={siteStyles.dialogTitle}><h2>{t("createProject")}</h2><p>{site("dialogSubtitle", { workspace: workspaceName })}</p></div>
      <button type="button" className={siteStyles.dialogClose} aria-label={t("closeCreate")} disabled={busy} onClick={onClose}><EnergyIcon name="close" /></button>
    </header>
    <ol className={siteStyles.stepper} aria-label={site(step === "place" ? "step.place" : "step.settings")}>
      {(["place", "settings"] as const).map((which, index) => <li key={which} className={siteStyles.step} data-state={stepState(which)} aria-current={which === step ? "step" : undefined}>
        <small>{site("stepOf", { step: index + 1 })}</small><strong>{site(`step.${which}`)}</strong>
      </li>)}
    </ol>
    <form id="create-project-form" onSubmit={submit} className={siteStyles.dialogBody}>
      {step === "place" ? <>
        <p className={siteStyles.intro}>{site("placeIntro")}</p>
        <label className="block"><span className={siteStyles.fieldLabel}>{t("projectName")}</span>
          <input autoFocus required maxLength={200} disabled={busy || created} value={name} onChange={event => setName(event.target.value)} placeholder={t("namePlaceholder")} className={siteStyles.nameInput} /></label>
        <fieldset disabled={busy || created}>
          <legend className={siteStyles.fieldLabel}>{site("whereTitle")}</legend>
          <div className={siteStyles.countries}>
            {(["SG", "MY"] as const).map(code => <button key={code} type="button" className={siteStyles.country} aria-pressed={country === code} onClick={() => pickCountry(code)}>
              <span className={siteStyles.countryTop}><span className={siteStyles.countryBadge} aria-hidden="true">{code}</span><span className={siteStyles.countryCheck} aria-hidden="true" /></span>
              <strong>{site(`country.${code}`)}</strong><small>{site(`country.${code}.hint`)}</small>
            </button>)}
          </div>
          <p className={siteStyles.hint}>{site("whereHint")}</p>
        </fieldset>
        {settings?.country === "MY" && <div>
          <span className={siteStyles.fieldLabel}>{site("state")}</span>
          <EnergySelect ariaLabel={site("state")} placeholder={site("statePlaceholder")} disabled={busy || created} value={settings.state} className="w-full"
            options={MALAYSIA_STATES.map(([code, label]) => ({ value: code, label }))} onValueChange={state => setSettings(chooseState(settings, state))} />
          <p className={siteStyles.hint}>{site("stateHint")}</p>
        </div>}
      </> : settings && <>
        <p className={siteStyles.intro}><strong>{name.trim()}</strong> · {site("settingsIntro", { place })}</p>
        <NewSiteSettingsPanel settings={settings} disabled={busy} onChange={next => { setSettings(next); setProblem(null); }} />
        {problem && <p role="alert" className={siteStyles.problem}>{site(`problem.${problem}`)}</p>}
        {error && <p role="alert" className={siteStyles.problem}>{error}</p>}
        {unsaved && <div role="alert" className={siteStyles.problem}>
          {site("partlySaved", { what: site(unsaved === "price" ? "whatPrice" : "whatHours") })}{" "}
          <button type="button" className={siteStyles.textButton} disabled={busy} onClick={() => createdId.current && void finish(createdId.current)}>{site("continueAnyway")}</button>
        </div>}
      </>}
    </form>
    <footer className={siteStyles.dialogFoot}>
      {step === "place"
        ? <button type="button" className={siteStyles.secondary} disabled={busy} onClick={onClose}>{site("cancel")}</button>
        : <button type="button" className={siteStyles.secondary} disabled={busy || created} onClick={() => setStep("place")}>{site("back")}</button>}
      {step === "place"
        ? <button type="submit" form="create-project-form" disabled={!placeReady} className={siteStyles.primary}>{site("next")}</button>
        : <button type="submit" form="create-project-form" disabled={busy} className={siteStyles.primary}>{busy ? site("creating") : created ? t("openConversation") : site("create")}</button>}
    </footer>
  </dialog>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { EnergyIcon } from "./icons";
import styles from "./energyiq-top-bar.module.css";
import { LOCALES } from "./energyiq-messages";
import { useEnergyIqLocale } from "./energyiq-locale";

/** Top-bar language menu. Covers the app's frame (navigation, top bar, account); pages follow as they are translated. */
export function EnergyIqLanguageSwitch() {
  const { locale, setLocale, t } = useEnergyIqLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = LOCALES.find(item => item.id === locale) ?? LOCALES[0];
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return <div ref={root} className={styles.language}>
    <button ref={trigger} type="button" className={styles.languageButton} aria-label={t("language.current", { language: current.name })} title={t("language.label")} aria-haspopup="menu" aria-expanded={open} aria-controls="energyiq-language-menu" onClick={() => setOpen(value => !value)}>
      <EnergyIcon name="globe" /><span>{current.short}</span>
    </button>
    {open && <div id="energyiq-language-menu" role="menu" aria-label={t("language.label")} className={styles.languageMenu} onKeyDown={event => {
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") setOpen(false);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }
    }}>
      {LOCALES.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === locale} lang={item.id} onClick={() => { setLocale(item.id); close(); }}>
        <span>{item.name}</span>{item.id === locale && <EnergyIcon name="check" />}
      </button>)}
    </div>}
  </div>;
}

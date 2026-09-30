"use client";
import { useEffect, useState } from "react";
import { EnergyIcon } from "./icons";
import styles from "./energyiq-top-bar.module.css";
import { THEME_STORAGE_KEY, type ThemePreference } from "./energyiq-theme-boot";
import { useEnergyIqLocale } from "./energyiq-locale";

function readPreference(): ThemePreference {
  try { const saved = localStorage.getItem(THEME_STORAGE_KEY); return saved === "dark" || saved === "system" ? saved : "light"; } catch { return "light"; }
}
const prefersDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark = (preference: ThemePreference) => preference === "dark" || (preference === "system" && prefersDark());

/**
 * Light / dark slider, remembered in this browser only. A saved "system" choice from earlier keeps following the
 * device until the switch is used; the switch always stores an explicit light or dark.
 */
export function EnergyIqThemeSwitch() {
  const { t } = useEnergyIqLocale();
  const [preference, setPreference] = useState<ThemePreference>("light");
  const [dark, setDark] = useState(false);
  useEffect(() => { setPreference(readPreference()); }, []);
  useEffect(() => {
    const apply = () => { const next = isDark(preference); setDark(next); document.documentElement.dataset.energyiqTheme = next ? "dark" : "light"; };
    apply();
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
  // Leaving EnergyX returns the rest of the app to its own light styling.
  useEffect(() => () => { delete document.documentElement.dataset.energyiqTheme; }, []);
  const toggle = () => {
    const next: ThemePreference = dark ? "light" : "dark";
    setPreference(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Private browsing: the choice lasts for this visit only. */ }
  };
  return <button type="button" role="switch" aria-checked={dark} aria-label={t("theme.darkMode")} title={t(dark ? "theme.toLight" : "theme.toDark")} className={styles.themeSwitch} onClick={toggle}>
    <EnergyIcon name="sun" className={styles.themeSun} />
    <EnergyIcon name="moon" className={styles.themeMoon} />
    <span className={styles.themeKnob} aria-hidden="true"><EnergyIcon name={dark ? "moon" : "sun"} /></span>
  </button>;
}

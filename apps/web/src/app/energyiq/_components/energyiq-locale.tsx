"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { LANGUAGE_STORAGE_KEY, isLocale, translator, translatorFor, type EnergyIqLocale, type EnergyIqTranslate, type Translate, type Translations } from "./energyiq-messages";

type LocaleState = { locale: EnergyIqLocale; setLocale: (locale: EnergyIqLocale) => void; t: EnergyIqTranslate };
// Without a provider (isolated component tests) everything reads in English.
const LocaleContext = createContext<LocaleState>({ locale: "en", setLocale: () => undefined, t: translator("en") });

export const useEnergyIqLocale = () => useContext(LocaleContext);
/** Translator for one area's wording (see defineMessages), following the reader's language. */
export function useMessages<K extends string>(book: Translations<K>): Translate<K> {
  const { locale } = useEnergyIqLocale();
  return useMemo(() => translatorFor(book, locale), [book, locale]);
}

/** The reader's language, remembered in this browser only, like the light / dark choice. */
export function EnergyIqLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<EnergyIqLocale>("en");
  // Before paint, so a saved language replaces the server-rendered English without a visible flicker.
  useLayoutEffect(() => {
    try { const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY); if (isLocale(saved)) setLocaleState(saved); } catch { /* Storage is optional. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  // Leaving EnergyX hands the page back to the rest of the app's English.
  useEffect(() => () => { document.documentElement.lang = "en"; }, []);
  const value = useMemo<LocaleState>(() => ({
    locale,
    t: translator(locale),
    setLocale: next => {
      setLocaleState(next);
      try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Private browsing: the choice lasts for this visit only. */ }
    },
  }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

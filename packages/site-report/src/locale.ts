/**
 * The language machinery EnergyIQ's wording is built on, shared by the web app and the server so a report reads the
 * same wherever it is produced. The app's own catalogue stays in apps/web (energyiq-messages.ts), which re-exports
 * these helpers so every page keeps importing them from one place.
 */
export type EnergyIqLocale = "en" | "zh-Hans" | "ms";

/** One area's wording in every language. English is the source; the type makes every language supply every key. */
export type Translations<K extends string> = Record<EnergyIqLocale, Record<K, string>>;
export type Translate<K extends string> = (key: K, values?: Record<string, string | number>) => string;

/**
 * Declares an area's wording next to the code that shows it, e.g. `const messages = defineMessages({ title: "Analysis" },
 * { "zh-Hans": { title: "用电分析" }, ms: { title: "Analisis" } })`. `{name}` placeholders are filled from `values`.
 */
export function defineMessages<const E extends Record<string, string>>(en: E, others: Record<Exclude<EnergyIqLocale, "en">, Record<keyof E, string>>): Translations<Extract<keyof E, string>> {
  return { en, ...others } as Translations<Extract<keyof E, string>>;
}
export const translatorFor = <K extends string>(book: Translations<K>, locale: EnergyIqLocale): Translate<K> => (key, values) =>
  (book[locale][key] ?? book.en[key]).replace(/\{(\w+)\}/g, (placeholder, name: string) => values && name in values ? String(values[name]) : placeholder);

/** The locale to hand to Intl / toLocaleString for numbers and dates; Singapore conventions in every language. */
export const intlLocale = (locale: EnergyIqLocale) => ({ en: "en-SG", "zh-Hans": "zh-Hans-SG", ms: "ms-SG" } as const)[locale];

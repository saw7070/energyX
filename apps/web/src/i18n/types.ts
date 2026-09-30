export type Locale = "zh-CN" | "en";

export type MessageParams = Record<string, string | number>;

export type MessageTree = {
  [key: string]: string | MessageTree;
};

export type TranslateFn = (key: string, params?: MessageParams) => string;

export const LOCALE_STORAGE_KEY = "energyiq:locale:v2";

export const DEFAULT_LOCALE: Locale = "en";

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "en"];

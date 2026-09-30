export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "energyiq-theme";

/**
 * Runs in the page before first paint (see the EnergyX layout) so a saved dark choice never flashes light.
 * Must match isDark in energyiq-theme-switch.tsx.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.energyiqTheme=d?"dark":"light";}catch(e){}`;

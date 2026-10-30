// ESLint flat config for the whole monorepo (`npm run lint`).
//
// The codebase predates linting, so the recommended rule sets start as warnings: they show up in
// editors and CI logs without blocking anyone. A short list of correctness rules that the code already
// passes is enforced as errors so that they cannot regress. Promote further rules to "error" once
// their warnings are cleared. Linting is syntax-only (no type information) to keep it fast.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Turns every enabled rule in the given configs into a warning, keeping its options. */
function asWarnings(configs) {
  return configs.map((config) => {
    if (!config.rules) return config;
    const rules = Object.fromEntries(
      Object.entries(config.rules).map(([name, setting]) => {
        const [severity, ...options] = Array.isArray(setting) ? setting : [setting];
        const off = severity === "off" || severity === 0;
        return [name, off ? setting : ["warn", ...options]];
      }),
    );
    return { ...config, rules };
  });
}

/**
 * Correctness rules that pass today and must keep passing. TypeScript already reports some of these
 * for .ts files; enforcing them everywhere also covers the plain JavaScript scripts.
 */
const enforcedRules = {
  "no-compare-neg-zero": "error",
  "no-cond-assign": "error",
  "no-constant-binary-expression": "error",
  "no-debugger": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-invalid-regexp": "error",
  "no-self-assign": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
};

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.next-*/**",
    "**/coverage/**",
    "**/*.d.ts",
    ".claude/**",
    ".scratch/**",
    "deploy/**",
    "docs/**",
    "evaluations/**",
    "outputs/**",
    "site/**",
    "storage/**",
  ]),
  {
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  ...asWarnings([js.configs.recommended, ...tseslint.configs.recommended]),
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: "apps/web/" } },
    rules: asWarnings([nextPlugin.configs["core-web-vitals"]])[0].rules,
  },
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx}", "apps/tui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...asWarnings([reactHooks.configs["recommended-latest"]])[0].rules,
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Node scripts that hand functions to a headless browser (page.evaluate).
    files: ["scripts/energyiq/ui-preview/**", "scripts/energyiq/report-agent/report-browser.mjs"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
  { rules: enforcedRules },
);

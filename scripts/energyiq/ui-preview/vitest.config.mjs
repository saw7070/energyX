import { defineConfig } from 'vitest/config';
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: { include: ['apps/web/src/app/energyiq/**/*.test.{ts,tsx}'] },
});

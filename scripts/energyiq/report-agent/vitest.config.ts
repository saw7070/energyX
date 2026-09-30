import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: Object.fromEntries(['contracts', 'metadata', 'files', 'data-gateway', 'artifacts', 'knowledge', 'skills', 'agent-runtime'].map(name => [`@datafoundry/${name}`, resolve(`packages/${name}/src/index.ts`)])) },
  test: { include: ['apps/api/src/report-agent/*.test.ts'], testTimeout: 120000 },
});

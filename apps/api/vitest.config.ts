import { defineConfig } from "vitest/config";

// `npm test` in this workspace runs every API test. The pool options match the repository root:
// vitest only reads the config in the directory it is started from.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Most API tests are integration tests over real SQLite and DuckDB files. Several take 3-7 s on
    // a quiet machine, so vitest's 5 s default made them fail at random on a busy CI runner.
    testTimeout: 30_000,
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
  },
});

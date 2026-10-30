import { defineConfig } from "vitest/config";

// `npm test` in this workspace runs every API test. The pool options match the repository root:
// vitest only reads the config in the directory it is started from.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
  },
});

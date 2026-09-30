import { defineConfig } from "vitest/config";

// Same as the repository root: vitest only reads the config in the directory it is started from.
export default defineConfig({
  test: { poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } } },
});

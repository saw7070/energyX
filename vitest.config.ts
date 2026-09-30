import { defineConfig } from "vitest/config";

/**
 * Node 26 defines a global `localStorage` that is `undefined` unless the process is started with
 * --localstorage-file, and it shadows the one the test DOM provides, so every test that touches
 * storage fails with "Cannot read properties of undefined (reading 'setItem')". Turning Node's own
 * Web Storage off in the workers leaves the DOM's in place, whichever way vitest is started.
 */
export default defineConfig({
  test: { poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } } },
});

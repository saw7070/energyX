import { describe, expect, it } from "vitest";
import { isDeployedEnvironment, loadPasswordAuthConfig } from "./config.js";

describe("loadPasswordAuthConfig", () => {
  it("refuses dev sign-in in production, staging or behind a public address", () => {
    for (const env of [
      { DATAFOUNDRY_AUTH_MODE: "dev", NODE_ENV: "production" },
      { DATAFOUNDRY_AUTH_MODE: "dev", ENERGYX_ENVIRONMENT: "staging" },
      { DATAFOUNDRY_AUTH_MODE: "dev", AUTH_PUBLIC_BASE_URL: "https://energyiq.example.com" },
    ]) {
      expect(() => loadPasswordAuthConfig(env)).toThrow(/AUTH_CONFIG_INVALID/);
    }
  });

  it("keeps dev sign-in for local development", () => {
    expect(loadPasswordAuthConfig({ DATAFOUNDRY_AUTH_MODE: "dev" }).mode).toBe("dev");
    expect(loadPasswordAuthConfig({ DATAFOUNDRY_AUTH_MODE: "dev", AUTH_PUBLIC_BASE_URL: "http://127.0.0.1:3000" }).mode).toBe("dev");
    expect(loadPasswordAuthConfig({}).mode).toBe("dev");
  });

  it("defaults to password sign-in in production", () => {
    expect(() => loadPasswordAuthConfig({ NODE_ENV: "production" })).toThrow(/AUTH_SESSION_SECRET/);
  });

  it("recognises deployed environments", () => {
    expect(isDeployedEnvironment({ AUTH_PUBLIC_BASE_URL: "http://localhost:3000" })).toBe(false);
    expect(isDeployedEnvironment({ ENERGYX_ENVIRONMENT: "Production" })).toBe(true);
  });
});

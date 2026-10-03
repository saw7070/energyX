import type { MetadataStore } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import { resolveEnergyProjectDataSource } from "./energy-query-context.js";

const store = (input: { connection?: { sync_enabled: boolean }; batches?: Array<{ status: string }> }) => ({
  energyIq: {
    liveConnectors: { find: () => input.connection },
    listImportBatches: () => input.batches ?? [],
  },
}) as unknown as MetadataStore;

describe("Project data source", () => {
  it("is live while an app connection updates the site by itself", () => {
    expect(resolveEnergyProjectDataSource(store({ connection: { sync_enabled: true } }), "site", {})).toBe("live");
  });

  it("is live for the project the server's own Tuya settings sync", () => {
    const env = { ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: "site", ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: "{}", ENERGYIQ_TUYA_SYNC_ENABLED: "true" };
    expect(resolveEnergyProjectDataSource(store({}), "site", env)).toBe("live");
    expect(resolveEnergyProjectDataSource(store({}), "other", env)).toBe("none");
  });

  it("counts a connection with its daily update off, or none at all, as uploaded once readings exist", () => {
    const batches = [{ status: "materialized" }];
    expect(resolveEnergyProjectDataSource(store({ connection: { sync_enabled: false }, batches }), "site", {})).toBe("upload");
    expect(resolveEnergyProjectDataSource(store({ batches }), "site", {})).toBe("upload");
    expect(resolveEnergyProjectDataSource(store({ batches: [{ status: "inspected" }] }), "site", {})).toBe("none");
  });
});

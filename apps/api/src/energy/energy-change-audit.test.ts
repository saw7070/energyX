import { describe, expect, it } from "vitest";
import { changeEventFor } from "./energy-change-audit.js";

describe("recording who changed project settings", () => {
  it("names each kind of change and ignores reads and admin routes", () => {
    expect(changeEventFor(["projects"], "POST")).toBe("energyiq.project_created");
    expect(changeEventFor(["projects", "kl", "operational-policies", "tariff"], "POST")).toBe("energyiq.electricity_rate_published");
    expect(changeEventFor(["projects", "kl", "operational-policies", "calendar"], "POST")).toBe("energyiq.hours_holidays_published");
    expect(changeEventFor(["projects", "kl", "setup"], "PUT")).toBe("energyiq.setup_draft_saved");
    expect(changeEventFor(["projects", "kl", "setup", "apply"], "POST")).toBe("energyiq.changes_made_live");
    expect(changeEventFor(["projects", "kl", "imports"], "POST")).toBe("energyiq.data_import_changed");
    expect(changeEventFor(["projects", "kl", "live-connection"], "DELETE")).toBe("energyiq.live_connection_changed");
    expect(changeEventFor(["projects", "kl", "operational-policies"], "GET")).toBeNull();
    expect(changeEventFor(["projects", "kl", "alerts", "read"], "POST")).toBeNull();
    expect(changeEventFor(["admin", "users"], "POST")).toBeNull();
  });
});

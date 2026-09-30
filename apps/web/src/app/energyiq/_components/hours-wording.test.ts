import { describe, expect, it } from "vitest";
import { operatingHoursWording } from "./hours-wording";

describe("operatingHoursWording", () => {
  it("uses one term for the site's schedule in older AI text", () => {
    expect(operatingHoursWording("Showroom Conow used 380.50 kWh outside published hours")).toBe("Showroom Conow used 380.50 kWh outside operating hours");
    expect(operatingHoursWording("Panel B Meter 05 continues drawing power outside provisional hours")).toBe("Panel B Meter 05 continues drawing power outside assumed operating hours");
    expect(operatingHoursWording("73% of weekly energy outside the provisional operating window.")).toBe("73% of weekly energy outside the assumed operating hours.");
    expect(operatingHoursWording("Panel A Lighting runs well past the provisional 18:00 close")).toBe("Panel A Lighting runs well past the assumed 18:00 closing time");
    expect(operatingHoursWording("Business hours use rose; office hours and opening hours differ")).toBe("Operating hours use rose; operating hours and operating hours differ");
  });

  it("keeps the named days of an assumed schedule", () => {
    expect(operatingHoursWording("Its consumption does not follow the provisional Monday–Friday operating window.")).toBe("Its consumption does not follow the assumed Monday–Friday operating hours.");
    expect(operatingHoursWording("39.27 kWh (71.7%) outside the provisional Mon-Fri 09:00-18:00 window")).toBe("39.27 kWh (71.7%) outside the assumed Mon-Fri 09:00-18:00 operating hours");
  });

  it("leaves unrelated text untouched", () => {
    expect(operatingHoursWording("Check whether the lights turn off at 20:00.")).toBe("Check whether the lights turn off at 20:00.");
  });
});

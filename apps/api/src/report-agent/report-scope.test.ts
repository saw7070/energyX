import { expect, it } from "vitest";
import { stampReportScope } from "./report-scope.js";

it("persists the selected calendar scope separately from generation and measured coverage", () => {
  const html = stampReportScope('<html><body class="report"><p>Readings available: August 4–29</p></body></html>', { from: "2026-08-01", toExclusive: "2026-09-01" }, "Asia/Singapore", "2026-09-13T04:00:00Z");
  expect(html).toContain('Requested analysis period: 2026-08-01 – 2026-08-31');
  expect(html).toContain('Generated: 2026-09-13T04:00:00Z');
  expect(html).toContain('Readings available: August 4–29');
  expect(html.indexOf('System report scope')).toBeLessThan(html.indexOf('<p>'));
});

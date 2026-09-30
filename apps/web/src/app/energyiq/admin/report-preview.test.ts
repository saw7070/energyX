import { describe, expect, it } from "vitest";
import { reportPreviewHtml } from "./report-preview";
describe("report preview", () => {
  it("places a restrictive policy before any generated script and permits offline inline charts", () => {
    const result = reportPreviewHtml('<html><script src="https://example.com/track.js"></script><body>Report</body></html>');
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(result.indexOf("<script"));
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("script-src 'unsafe-inline'");
    expect(result).toContain("base-uri 'none'");
  });
});

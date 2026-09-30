/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { ReportMarkdown, readableReportText } from "./report-markdown";
it("renders GFM tables as accessible scrollable tables while rejecting active HTML",async()=>{vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const el=document.createElement("div");const root=createRoot(el);await act(async()=>root.render(<ReportMarkdown>{"| Meter | kWh |\n| --- | ---: |\n| Cooling | 123.45 |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))"}</ReportMarkdown>));expect(el.querySelectorAll("th")).toHaveLength(2);expect(el.querySelector("td")?.textContent).toBe("Cooling");expect(el.querySelector('[role="region"]')?.getAttribute("tabindex")).toBe("0");expect(el.querySelector("script")).toBeNull();expect(el.querySelector("a")).toBeNull();await act(async()=>root.unmount());vi.unstubAllGlobals();});
it("omits labelled machine identifiers without changing measurements or filenames",()=>{expect(readableReportText("Run ID: `12345678-abcd-abcd-abcd-123456789abc`\nFile hash: "+"a".repeat(64)+"\nMeter: 12345678901234567890123456789012, 123.45 kWh, readings.csv")).toBe("Run ID: internal reference\nFile hash: internal reference\nMeter: 12345678901234567890123456789012, 123.45 kWh, readings.csv");});

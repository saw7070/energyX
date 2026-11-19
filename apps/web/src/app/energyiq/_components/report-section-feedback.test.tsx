/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { buildEnergyReview } from "@datafoundry/site-report";
import { EnergyReviewDocument } from "@datafoundry/site-report/energy-review-document";
import { DATA } from "./standout-days.test-fixture";
import { feedbackText, useSectionFeedback } from "./report-section-feedback";
import { reportFeedbackApi, type ReportFeedbackController, type ReportFeedbackState } from "./report-feedback-model";

const review = buildEnergyReview(DATA, null, "2026-11-17T02:00:00Z");
const state: ReportFeedbackState = { canGive: true, canManage: false, aiAvailable: true, feedback: [], memory: [], followUps: [], dismissedChecks: [] };
const controller = (overrides: Partial<ReportFeedbackState> = {}): ReportFeedbackController => ({ state: { ...state, ...overrides }, setState: vi.fn(), reload: vi.fn(), loading: false, error: null, forbidden: false } as unknown as ReportFeedbackController);

function Page({ feedback }: { feedback: ReportFeedbackController }) {
  const section = useSectionFeedback({ projectId: "p", controller: feedback, review, report: null });
  return <div onPointerUp={section.onPointerUp}><EnergyReviewDocument review={review} sectionFeedback={section.sectionFeedback} />{section.overlay}</div>;
}
async function render(feedback: ReportFeedbackController) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Page feedback={feedback} />));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("puts the highlighted words first, within the length the server takes", () => {
  expect(feedbackText("  Lights are on a timer.  ")).toBe("Lights are on a timer.");
  expect(feedbackText("That is normal.", "drop at 7 am")).toBe("“drop at 7 am”\nThat is normal.");
  expect(feedbackText("x", "a".repeat(600)).startsWith(`“${"a".repeat(399)}…”`)).toBe(true);
});

it("offers feedback on every section and sends it tied to that section", async () => {
  const send = vi.spyOn(reportFeedbackApi, "send").mockResolvedValue({ feedback: { id: "f", text: "", about: null, authorUserId: "u", authorName: "A", createdAt: "", status: "processed", reply: "Noted: the drop at 7 am is the timer.", memoryIds: [], followUpIds: [], suggestions: [] }, state });
  const { host, done } = await render(controller());
  try {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.er-fb")];
    // Summary, each topic, the method: every section has one, named as the bar names it (never by a number).
    expect(buttons.length).toBeGreaterThan(3);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Give feedback on Summary");
    const total = buttons.find(button => button.dataset.feedbackSection === "q-total")!;
    expect(total.dataset.feedbackTitle).toBe("Total use");
    await act(async () => total.click());
    expect(total.getAttribute("aria-expanded")).toBe("true");
    // The box opens inside that section, under its heading.
    const box = host.querySelector("#er-q-total [role='group']")!;
    expect(box.textContent).toContain(`Feedback on ${total.dataset.feedbackTitle}`);
    const textarea = box.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "The total looks right.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => box.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(send).toHaveBeenCalledWith("p", expect.objectContaining({ text: "The total looks right.", about: { kind: "section", id: "q-total", title: total.dataset.feedbackTitle } }));
    expect(host.querySelector("#er-q-total [role='status']")!.textContent).toContain("Noted: the drop at 7 am is the timer.");
  } finally { await done(); }
});

it("offers nothing to readers who may not give feedback", async () => {
  const { host, done } = await render(controller({ canGive: false }));
  try { expect(host.querySelectorAll("button.er-fb")).toHaveLength(0); } finally { await done(); }
});

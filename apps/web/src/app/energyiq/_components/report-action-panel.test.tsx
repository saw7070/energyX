/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { ReportActionPanel } from "./report-action-panel";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams("projectId=project&reportId=report-1"),
}));
vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => ({
    activeProject: { id: "project", name: "Office" },
    access: { role: "user", projects: [] },
  }),
}));
import { ReportLibraryView } from "./report-library";
it("shows actual execution state and opens a project-time form without pretending feedback is ready", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  const request = vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({
    actions: [
      {
        id: "a",
        title: "LED shutdown",
        recommendation: "Close at 19:00",
        state: "implemented",
        revision: 2,
      },
    ],
    meters: [],
    baseline: {
      from: "2026-09-01",
      toExclusive: "2026-09-10",
      snapshotId: "s",
    },
    timezone: "Asia/Singapore",
  });
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  try {
    await act(async () => {
      root.render(<ReportActionPanel projectId="p" reportId="r" />);
    });
    expect(div.textContent).toContain("Done");
    expect(div.textContent).toContain(
      "the system checks readings automatically",
    );
    const button = [...div.querySelectorAll("button")].find(
      (b) => b.textContent === "Record progress",
    )!;
    await act(async () => button.click());
    expect(div.textContent).toContain("Asia/Singapore");
    expect(div.querySelector('input[type="datetime-local"]')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    div.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("opens linked feedback safely and offers retry for failed feedback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  const request = vi
    .spyOn(configApi, "reportActionRequest")
    .mockImplementation(async (_project, path) =>
      path?.includes("/feedback/")
        ? ({ content: "<html><body>Observed difference</body></html>" } as any)
        : ({
            actions: [
              {
                id: "a",
                title: "LED shutdown",
                recommendation: "Earlier shutdown",
                state: "implemented",
                revision: 2,
                feedback: [
                  {
                    stage: "initial",
                    runId: "f1",
                    status: "succeeded",
                    revision: 2,
                    stale: false,
                  },
                  {
                    stage: "weekly",
                    runId: "f2",
                    status: "failed",
                    revision: 2,
                    stale: false,
                  },
                ],
              },
            ],
            meters: [],
            baseline: {
              from: "2026-08-01",
              toExclusive: "2026-09-01",
              snapshotId: "s",
            },
            timezone: "Asia/Singapore",
          } as any),
    );
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  try {
    await act(async () =>
      root.render(<ReportActionPanel projectId="p" reportId="r" />),
    );
    expect(div.textContent).toContain("Check the result again");
    await act(async () =>
      [...div.querySelectorAll("button")]
        .find((b) => b.textContent === "Did it work?")!
        .click(),
    );
    expect(div.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-scripts",
    );
    expect(div.querySelector("iframe")?.srcdoc).toContain(
      "Observed difference",
    );
    await act(async () =>
      [...div.querySelectorAll("button")]
        .find((b) => b.textContent === "Add a recommendation")!
        .click(),
    );
    expect(
      div.querySelectorAll('input[type="date"]')[0]?.getAttribute("value") ??
        (div.querySelector('input[type="date"]') as HTMLInputElement).value,
    ).toBe("2026-08-01");
  } finally {
    await act(async () => root.unmount());
    div.remove();
    request.mockRestore();
    vi.unstubAllGlobals();
  }
});

describe("report recommendations and scenario planning", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const spyRequest = () => vi.spyOn(configApi, "reportActionRequest");
  let request: ReturnType<typeof spyRequest>;
  const suggestion = {
    id: "suggestion-1",
    title: "Earlier lighting shutdown",
    recommendation: "Switch off after the team leaves",
    meterId: "lighting",
    sourceQuote: "<script>not executable</script> Lighting ran after 19:00.",
  };
  const scenario = {
    id: "scenario-1",
    recordedAt: "2026-09-14T01:00:00Z",
    value: {
      energyKwh: 132,
      inputs: {
        reduciblePowerKw: 2,
        hoursPerDay: 3,
        days: 22,
        assumptions: "Lighting is unused after closing.",
      },
      basis: "user_assumptions",
    },
  };
  const action = {
    id: "action-1",
    title: "Lighting hours",
    recommendation: "Reduce lighting hours",
    state: "proposed",
    visibility: "private",
    scenarioLocked: false,
    revision: 3,
    scenarios: [scenario],
  };
  const state = (extra: Record<string, unknown> = {}) => ({
    canExtract: true,
    canShare: false,
    actions: [],
    meters: [{ meterPointId: "lighting", sourceLabel: "Office lights" }],
    baseline: {
      from: "2026-08-01",
      toExclusive: "2026-08-29",
      snapshotId: "snapshot",
    },
    timezone: "Asia/Singapore",
    suggestions: {
      status: "succeeded",
      runId: "extraction-1",
      items: [suggestion],
    },
    ...extra,
  });
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    request = spyRequest().mockResolvedValue(state() as any);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find(
      (item) => item.textContent === text,
    )!;
  const click = async (text: string) => {
    await act(async () => button(text).click());
  };
  const render = async (reportId = "report-1") => {
    await act(async () =>
      root.render(
        <ReportActionPanel projectId="project" reportId={reportId} />,
      ),
    );
  };
  const form = () => host.querySelector("form")!;
  const submit = async () => {
    await act(async () =>
      form().dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  };
  const postCalls = () =>
    request.mock.calls
      .filter((call) => call[2]?.method === "POST")
      .map(
        ([project, path, init]) =>
          [project, path, { ...init, body: String(init?.body) }] as const,
      );
  const change = async (
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("prefills a tracked recommendation with its provenance, selected known meter and baseline", async () => {
    await render();
    expect(host.querySelector("blockquote")?.textContent).toBe(
      suggestion.sourceQuote,
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("details")?.open).toBe(false);
    await click("Track this action");
    expect((form().querySelector("input") as HTMLInputElement).value).toBe(
      suggestion.title,
    );
    expect(document.activeElement).toBe(form().querySelector("input"));
    expect(
      (form().querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe(suggestion.recommendation);
    expect(
      [...form().querySelectorAll('input[type="date"]')].map(
        (node) => (node as HTMLInputElement).value,
      ),
    ).toEqual(["2026-08-01", "2026-08-28"]);
    await submit();
    const body = JSON.parse(postCalls()[0]![2].body);
    expect(body).toMatchObject({
      sourceReportId: "report-1",
      suggestionId: "suggestion-1",
      suggestionRunId: "extraction-1",
      meterIds: ["lighting"],
      baseline: { from: "2026-08-01", toExclusive: "2026-08-29" },
    });
  });

  it.each([null, "unknown-meter"])(
    "requires an explicit meter choice for %s instead of choosing the first meter",
    async (meterId) => {
      request.mockResolvedValue(
        state({
          suggestions: {
            status: "succeeded",
            items: [{ ...suggestion, meterId }],
          },
        }),
      );
      await render();
      await click("Track this action");
      expect(button("Save action").disabled).toBe(true);
      expect(host.textContent).toContain(
        "Choose the meter affected by this change",
      );
      expect(
        host.querySelector('[aria-label="Affected meter"]')?.textContent,
      ).not.toContain("Office lights");
    },
  );

  it("hides already tracked suggestions and omits extraction run ID for original-report suggestions", async () => {
    request.mockResolvedValue(
      state({
        actions: [{ ...action, suggestionId: "already-tracked" }],
        suggestions: {
          status: "succeeded",
          items: [suggestion, { ...suggestion, id: "already-tracked" }],
        },
      }),
    );
    await render();
    expect(
      [...host.querySelectorAll("button")].filter(
        (item) => item.textContent === "Track this action",
      ),
    ).toHaveLength(1);
    await click("Track this action");
    await submit();
    expect(JSON.parse(postCalls()[0]![2].body)).not.toHaveProperty(
      "suggestionRunId",
    );
  });

  it("starts extraction, displays progress and polls until recommendations arrive", async () => {
    vi.useFakeTimers();
    let current = state({ suggestions: { status: "not_started", items: [] } });
    request.mockImplementation(async (_project, path, options) => {
      if (options?.method === "POST") {
        current = state({
          suggestions: { status: "running", runId: "new-run", items: [] },
        });
        return {};
      }
      return current;
    });
    await render();
    await click("Find recommendations");
    expect(postCalls()[0]?.[1]).toBe("suggestions");
    expect(JSON.parse(postCalls()[0]![2].body)).toEqual({
      sourceReportId: "report-1",
    });
    expect(host.textContent).toContain("Reading this report");
    expect(button("Find recommendations")).toBeUndefined();
    current = state();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(button("Track this action")).toBeDefined();
  });

  it.each(["failed", "interrupted", "cancelled"])(
    "retries %s extraction through the same endpoint",
    async (status) => {
      request.mockResolvedValue(
        state({
          suggestions: { status, items: [], issue: "internal details" },
        }),
      );
      await render();
      await click("Retry recommendations");
      expect(postCalls()[0]?.[1]).toBe("suggestions");
      expect(host.textContent).not.toContain("internal details");
    },
  );

  it("preserves a failed create draft and reuses its request identity on retry", async () => {
    request.mockImplementation(async (_project, _path, options) => {
      if (options?.method === "POST") throw Error("offline");
      return state();
    });
    await render();
    await click("Track this action");
    await submit();
    expect(
      (form().querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe(suggestion.recommendation);
    expect(host.textContent).toContain("Your input is kept");
    await submit();
    expect(JSON.parse(postCalls()[0]![2].body).idempotencyKey).toBe(
      JSON.parse(postCalls()[1]![2].body).idempotencyKey,
    );
  });

  it("adopts a saved scenario with revision and stable request ID without recording execution", async () => {
    request.mockImplementation(async (_project, _path, options) => {
      if (options?.method === "POST") throw Error("offline");
      return state({ actions: [action] });
    });
    await render();
    await click("Use this estimate");
    await click("Use this estimate");
    expect(postCalls().map((call) => call[1])).toEqual([
      "action-1/scenario-adoption",
      "action-1/scenario-adoption",
    ]);
    const first = JSON.parse(postCalls()[0]![2].body),
      second = JSON.parse(postCalls()[1]![2].body);
    expect(first).toMatchObject({
      revision: 3,
      scenarioId: "scenario-1",
      requestId: expect.any(String),
    });
    expect(second.requestId).toBe(first.requestId);
    expect(host.textContent).not.toContain("Done");
    expect(host.textContent).toContain(scenario.value.inputs.assumptions);
  });

  it.each(["implemented", "paused", "declined"])(
    "does not offer scenario rebinding for %s actions",
    async (stateName) => {
      request.mockResolvedValue(
        state({
          actions: [
            { ...action, state: stateName, adoptedScenarioId: scenario.id },
          ],
        }),
      );
      await render();
      expect(button("Use this estimate")).toBeUndefined();
      expect(host.textContent).toContain("Estimate in use");
      expect(host.textContent).toContain("132.00 kWh estimated saving");
      expect(button("Record progress")).toBeDefined();
    },
  );

  it("saves a scenario and clears the displayed estimate when assumptions change", async () => {
    request.mockImplementation(async (_project, _path, options) =>
      options?.method === "POST"
        ? { id: "new-scenario", energyKwh: 132 }
        : state({ actions: [action] }),
    );
    await render();
    await click("Estimate lighting savings");
    const power = form().querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    await change(power, "2");
    await change(
      form().querySelector("textarea")!,
      "Lighting is unused after closing.",
    );
    await submit();
    expect(postCalls()[0]?.[1]).toBe("action-1/scenarios");
    expect(host.querySelector("output")?.textContent).toContain("132.00 kWh");
    await change(
      form().querySelector("textarea")!,
      "Closing time may vary on Fridays.",
    );
    expect(host.querySelector("output")).toBeNull();
  });

  it("clears report-specific drafts and ignores a late scenario result after switching reports", async () => {
    let resolveCalculation!: (value: unknown) => void;
    request.mockImplementation(async (_project, path, options) =>
      options?.method === "POST"
        ? new Promise((resolve) => {
            resolveCalculation = resolve;
          })
        : path?.includes("report-2")
          ? state({
              actions: [],
              suggestions: { status: "not_started", items: [] },
            })
          : state({ actions: [action] }),
    );
    await render();
    await click("Estimate lighting savings");
    await change(form().querySelector('input[type="number"]')!, "2");
    await change(
      form().querySelector("textarea")!,
      "Lighting is unused after closing.",
    );
    await act(() =>
      form().dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await render("report-2");
    await act(async () => resolveCalculation({ id: "late", energyKwh: 999 }));
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).not.toContain("999");
    expect(host.textContent).not.toContain("Lighting hours");
  });
  it.each([1, 2, 61, 366])(
    "keeps a %s-day estimate in history but disables adoption",
    async (days) => {
      request.mockResolvedValue(
        state({
          actions: [
            {
              ...action,
              scenarios: [
                {
                  ...scenario,
                  value: {
                    ...scenario.value,
                    inputs: { ...scenario.value.inputs, days },
                  },
                },
              ],
            },
          ],
        }),
      );
      await render();
      expect(button("Use this estimate").disabled).toBe(true);
      expect(host.textContent).toContain("pick 3–60 days");
    },
  );
  it("explains an unsupported observation window returned by the API", async () => {
    request.mockImplementation(async (_project, _path, options) => {
      if (options?.method === "POST")
        throw Error("ACTION_SCENARIO_WINDOW_UNSUPPORTED");
      return state({ actions: [action] });
    });
    await render();
    await click("Use this estimate");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "3–60 days",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain(
      "ACTION_SCENARIO",
    );
  });
  it("distinguishes the full scenario comparison from partial feedback", async () => {
    request.mockResolvedValue(
      state({
        actions: [
          {
            ...action,
            adoptedScenarioId: scenario.id,
            feedback: [
              {
                stage: "scenario",
                runId: "full",
                status: "succeeded",
                stale: false,
              },
              {
                stage: "weekly",
                runId: "week",
                status: "succeeded",
                stale: false,
              },
            ],
          },
        ],
      }),
    );
    await render();
    expect(button("Did it save as much as estimated?")).toBeDefined();
    expect(button("Did it keep working?")).toBeDefined();
    expect(host.textContent).toContain("Early result");
  });

  it("shows the linked estimate after adoption without marking implementation", async () => {
    let adopted = false;
    request.mockImplementation(async (_project, _path, options) => {
      if (options?.method === "POST") {
        adopted = true;
        return {};
      }
      return state({
        actions: [
          {
            ...action,
            ...(adopted ? { revision: 4, adoptedScenarioId: scenario.id } : {}),
          },
        ],
      });
    });
    await render();
    await click("Use this estimate");
    expect(host.textContent).toContain("Estimate in use");
    expect(host.textContent).toContain("It is not marked as done");
    expect(host.textContent).not.toContain("Done");
    expect(button("Use this estimate")).toBeUndefined();
    await click("Record progress");
    expect(host.textContent).toContain("enough full days of readings");
  });
  it("keeps scenario parameters after failed calculation and allows retry", async () => {
    request.mockImplementation(async (_project, _path, options) => {
      if (options?.method === "POST") throw Error("offline");
      return state({ actions: [action] });
    });
    await render();
    await click("Estimate lighting savings");
    await change(form().querySelector('input[type="number"]')!, "4");
    await change(
      form().querySelector("textarea")!,
      "The meeting room is unused after 18:00.",
    );
    await submit();
    expect(
      (form().querySelector('input[type="number"]') as HTMLInputElement).value,
    ).toBe("4");
    expect(
      (form().querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("The meeting room is unused after 18:00.");
    expect(host.querySelector("output")).toBeNull();
    expect(button("Calculate & save").disabled).toBe(false);
  });
  it("allows a reader to track existing suggestions but hides extraction and sharing controls", async () => {
    request.mockResolvedValue(state({ canExtract: false, canShare: false }));
    await render();
    expect(button("Find recommendations")).toBeUndefined();
    await click("Track this action");
    expect(host.textContent).not.toContain(
      "Share this action with your project team",
    );
    await submit();
    expect(JSON.parse(postCalls()[0]![2].body).visibility).toBe("private");
  });
  it("does not show extraction retry to a reader who can only consume recommendations", async () => {
    request.mockResolvedValue(
      state({
        canExtract: false,
        suggestions: { status: "failed", items: [] },
      }),
    );
    await render();
    expect(button("Retry recommendations")).toBeUndefined();
    expect(button("Add a recommendation")).toBeDefined();
  });
  it("requires explicit opt-in for a shared action and keeps failed sharing input", async () => {
    request.mockImplementation(async (_project, _path, options) => {
      if (options?.method === "POST") throw Error("offline");
      return state({ canShare: true });
    });
    await render();
    await click("Track this action");
    const checkbox = form().querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    await submit();
    expect(JSON.parse(postCalls()[0]![2].body).visibility).toBe("project");
    expect(checkbox.checked).toBe(true);
    await submit();
    expect(JSON.parse(postCalls()[0]![2].body).idempotencyKey).toBe(
      JSON.parse(postCalls()[1]![2].body).idempotencyKey,
    );
  });
  it("resets sharing to private for the next action without changing a failed draft", async () => {
    request.mockResolvedValue(state({ canShare: true }));
    await render();
    await click("Track this action");
    await act(async () =>
      (
        form().querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click(),
    );
    await click("Cancel");
    await click("Add a recommendation");
    expect(
      (form().querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    ).toBe(false);
  });
  it("honors a server scenario lock even when an implemented action has returned to planned", async () => {
    request.mockResolvedValue(
      state({
        actions: [{ ...action, state: "scheduled", scenarioLocked: true }],
      }),
    );
    await render();
    expect(button("Use this estimate")).toBeUndefined();
    expect(host.textContent).toContain("cannot be changed at this stage");
    expect(button("Record progress")).toBeDefined();
  });
  it("shows project scope, actor names and effective progress times without a manual check dependency", async () => {
    request.mockResolvedValue(
      state({
        actions: [
          {
            ...action,
            state: "implemented",
            visibility: "project",
            events: [
              {
                type: "implemented",
                effectiveAt: "2026-09-14T01:00:00Z",
                recordedAt: "2026-09-14T01:10:00Z",
                details: "Lighting timers changed",
                actorName: "Charles",
              },
            ],
          },
          { ...action, id: "private", visibility: "private" },
        ],
      }),
    );
    await render();
    expect(host.textContent).toContain("Shared with project team");
    expect(host.textContent).toContain("Only you");
    expect(host.textContent).toContain("Charles");
    expect(host.textContent).toContain("Lighting timers changed");
    expect(
      host.querySelector('time[datetime="2026-09-14T01:00:00Z"]')?.textContent,
    ).toContain("09:00");
    expect(button("Check latest readings")).toBeUndefined();
    expect(host.textContent).toContain("Automatic monitoring is active");
  });
  it("shows a scheduled automatic retry alongside failed feedback without requesting another check", async () => {
    request.mockResolvedValue(
      state({
        actions: [
          {
            ...action,
            state: "implemented",
            check: {
              revision: 3,
              status: "retry_scheduled",
              nextRetryAt: "2026-09-14T02:00:00Z",
            },
            feedback: [
              {
                stage: "initial",
                runId: "retry",
                status: "failed",
                stale: false,
              },
            ],
          },
        ],
      }),
    );
    await render();
    expect(host.textContent).toContain("An automatic retry is scheduled");
    expect(host.textContent).toContain("Asia/Singapore");
    expect(button("Check the result again")).toBeUndefined();
    expect(postCalls()).toHaveLength(0);
  });
  it.each(["cancelled", "failed"])(
    "retains explicit retry for %s feedback when automatic retries are exhausted",
    async (status) => {
      request.mockResolvedValue(
        state({
          actions: [
            {
              ...action,
              state: "implemented",
              check: { revision: 3, status: "retry_exhausted" },
              feedback: [
                { stage: "initial", runId: "retry", status, stale: false },
              ],
            },
          ],
        }),
      );
      await render();
      expect(host.textContent).toContain("Automatic retries have stopped");
      await click("Check the result again");
      expect(postCalls()[0]?.[1]).toBe("action-1/feedback/retry/retry");
    },
  );
  it("retains an unsaved action draft when retrying a different feedback report", async () => {
    request.mockResolvedValue(
      state({
        actions: [
          {
            ...action,
            state: "implemented",
            feedback: [
              {
                stage: "initial",
                runId: "retry",
                status: "cancelled",
                stale: false,
              },
            ],
          },
        ],
      }),
    );
    await render();
    await click("Track this action");
    await change(
      form().querySelector("textarea")!,
      "Keep this edited recommendation while retrying feedback.",
    );
    await click("Check the result again");
    expect(
      (form().querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("Keep this edited recommendation while retrying feedback.");
  });
  it.each([true, false, undefined])(
    "uses the library's canUseActions=%s rather than report authorship or editor grants",
    async (canUseActions) => {
      vi.stubEnv("NEXT_PUBLIC_REPORT_ACTIONS_PILOT", "false");
      vi.spyOn(configApi, "reportLibraryRequest").mockImplementation(
        async (_id, path = "") =>
          (path.startsWith("output/")
            ? { content: "<html><body>Office report</body></html>" }
            : {
                canUseActions,
                canChat: false,
                canManageProject: canUseActions !== true,
                reports: [
                  {
                    id: "report-1",
                    title: "Shared office report",
                    canDiscuss: false,
                    kind: "report",
                    category: "custom",
                    version: 1,
                    period: { from: "2026-08-01", toExclusive: "2026-08-29" },
                    createdAt: "2026-09-01T00:00:00Z",
                  },
                ],
                skills: [],
                tools: [],
              }) as any,
      );
      request.mockResolvedValue(state({ canExtract: false, canShare: false }));
      try {
        await act(async () =>
          root.render(<ReportLibraryView projectId="project" view="reports" />),
        );
        if (canUseActions) {
          expect(button("Actions")).toBeDefined();
          await click("Actions");
          expect(button("Track this action")).toBeDefined();
          expect(button("Find recommendations")).toBeUndefined();
        } else {
          expect(button("Actions")).toBeUndefined();
          expect(request).not.toHaveBeenCalled();
        }
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("lets a reader record progress on a project action without extraction or chat privileges", async () => {
    request.mockResolvedValue(
      state({
        canExtract: false,
        canShare: false,
        actions: [{ ...action, visibility: "project" }],
      }),
    );
    await render();
    await click("Record progress");
    await change(
      form().querySelector('input[type="datetime-local"]')!,
      "2026-09-14T09:00",
    );
    await submit();
    expect(postCalls()[0]?.[1]).toBe("action-1/events");
    expect(JSON.parse(postCalls()[0]![2].body)).toMatchObject({
      revision: 3,
      type: "implemented",
      effectiveAt: "2026-09-14T01:00:00.000Z",
    });
  });
  it("explains automatic retry of a data check without inventing a feedback report", async () => {
    request.mockResolvedValue(
      state({
        actions: [
          {
            ...action,
            state: "implemented",
            check: { revision: 3, status: "check_failed" },
          },
        ],
      }),
    );
    await render();
    expect(host.textContent).toContain("next automatic check");
    expect(button("Check the result again")).toBeUndefined();
    expect(button("Check latest readings")).toBeUndefined();
    expect(postCalls()).toHaveLength(0);
  });
  it("explains an empty report without silently extracting older recommendations", async () => {
    request.mockResolvedValue(
      state({
        canExtract: true,
        suggestions: { status: "not_started", items: [] },
      }),
    );
    await render();
    expect(host.textContent).toContain(
      "This report has no available recommendations yet",
    );
    expect(button("Add a recommendation")).toBeDefined();
    expect(postCalls()).toHaveLength(0);
  });
});

it("links an existing action with a verified suggestion and displays report provenance", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  const request = vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({
    actions: [
      {
        id: "old",
        title: "Other action",
        recommendation: "Other",
        state: "proposed",
        revision: 1,
        sources: [
          { reportId: "old-report", recommendation: "Original advice" },
        ],
      },
    ],
    projectActions: [
      {
        id: "existing",
        title: "LED evening routine",
        meterIds: ["led"],
        sources: [{ reportId: "previous" }],
      },
    ],
    suggestions: {
      status: "succeeded",
      items: [
        {
          id: "suggestion",
          title: "Close LED",
          recommendation: "Close earlier",
          meterId: "led",
          sourceQuote: "Close the LED after hours",
        },
      ],
    },
    meters: [],
    baseline: {
      from: "2026-09-01",
      toExclusive: "2026-09-10",
      snapshotId: "s",
    },
    timezone: "Asia/Singapore",
  });
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  try {
    await act(async () =>
      root.render(<ReportActionPanel projectId="p" reportId="r" />),
    );
    expect(div.querySelector("a")?.getAttribute("href")).toContain(
      "reportId=old-report",
    );
    const button = [...div.querySelectorAll("button")].find(
      (b) => b.textContent === "LED evening routine",
    )!;
    await act(async () => button.click());
    expect(request).toHaveBeenCalledWith("p", "existing/sources", {
      method: "POST",
      body: JSON.stringify({ sourceReportId: "r", suggestionId: "suggestion" }),
    });
    expect(div.textContent).toContain("Existing progress is preserved");
  } finally {
    await act(async () => root.unmount());
    div.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("opens only the requested project action without report recommendation controls", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({
    actions: [
      {
        id: "a",
        title: "Selected LED action",
        recommendation: "Close earlier",
        state: "proposed",
        revision: 1,
      },
      {
        id: "b",
        title: "Unrelated action",
        recommendation: "Other",
        state: "proposed",
        revision: 1,
      },
    ],
    meters: [],
    baseline: {
      from: "2026-09-01",
      toExclusive: "2026-09-10",
      snapshotId: "s",
    },
    timezone: "Asia/Singapore",
  });
  const div = document.createElement("div");
  const root = createRoot(div);
  try {
    await act(async () =>
      root.render(
        <ReportActionPanel projectId="p" reportId="r" actionId="a" />,
      ),
    );
    expect(div.textContent).toContain("Selected LED action");
    expect(div.textContent).not.toContain("Unrelated action");
    expect(div.textContent).not.toContain("Recommendations from this report");
    expect(div.textContent).not.toContain("Add a recommendation");
    expect(div.textContent).toContain("Record an update");
    expect(div.querySelectorAll("h1")).toHaveLength(1);
    expect(div.textContent).not.toContain("Tracked actions");
    await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Record an update")!.click());
    const form = div.querySelector('[aria-label="Tell us what changed"]');
    expect(form?.textContent).toContain("What did you do?");
    expect(form?.parentElement?.hidden).toBe(false);
    await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Expected benefit")!.click());
    expect(div.querySelector('[aria-label="Tell us what changed"]')).toBe(form);
    expect(form?.parentElement?.hidden).toBe(true);
    expect(div.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Expected benefit");
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

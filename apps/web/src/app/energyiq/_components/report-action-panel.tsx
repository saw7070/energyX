"use client";
import { useEffect, useState, useRef } from "react";
import { configApi } from "../../../lib/config-api";
import { actionLocalInstant } from "./action-local-time";
import { reportPreviewHtml } from "./report-preview";
import { EnergySelect } from "./energy-select";
import styles from "./report-action-panel.module.css";
import { ActionProgressInput } from "./action-progress-input";
import { ActionSiteQuestion } from "./key-points";
import { ActionAiEstimate } from "./action-ai-estimate";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { around, labelFor } from "./project-actions-messages";
import { reportActionPanelMessages, type ReportActionPanelMessage } from "./report-action-panel-messages";
type Scenario = {
  id: string;
  recordedAt: string;
  value: {
    energyKwh: number;
    inputs: {
      reduciblePowerKw: number;
      hoursPerDay: number;
      days: number;
      assumptions: string;
    };
    basis: string;
  };
};
type Suggestion = {
  id: string;
  title: string;
  recommendation: string;
  meterId: string | null;
  sourceQuote: string;
};
type Action = {
  meterIds?: string[];
  sources?: Array<{
    reportId: string;
    recommendation: string;
    sourceQuote?: string;
  }>;
  visibility?: "private" | "project";
  scenarioLocked?: boolean;
  events?: Array<{
    type: string;
    effectiveAt: string;
    details: string;
    recordedAt: string;
    actorName: string;
  }>;
  suggestionId?: string;
  scenarios?: Scenario[];
  adoptedScenarioId?: string;
  id: string;
  title: string;
  recommendation: string;
  state: string;
  revision: number;
  check?: {
    revision: number;
    status: string;
    reason?: string;
    comparableDays?: number;
    nextRetryAt?: string;
  };
  feedback?: Array<{
    stage: string;
    runId: string;
    status: string;
    revision: number;
    stale: boolean;
  }>;
};
type State = {
  projectActions?: Array<{
    id: string;
    title: string;
    meterIds: string[];
    sources: Array<{ reportId: string }>;
  }>;
  canExtract?: boolean;
  canShare?: boolean;
  suggestions?: {
    status:
      | "not_started"
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "interrupted"
      | "cancelled";
    runId?: string;
    items: Suggestion[];
    issue?: string;
  };
  actions: Action[];
  meters: Array<{ meterPointId: string; sourceLabel: string }>;
  baseline: { from: string; toExclusive: string; snapshotId: string };
  timezone: string;
};
export function ReportActionPanel(props: {
  projectId: string;
  reportId: string;
  actionId?: string;
  initialSection?: string;
  insightTitle?: string;
}) {
  return (
    <ActionPanel
      key={`${props.projectId}:${props.reportId}:${props.actionId ?? "all"}`}
      {...props}
    />
  );
}
function ActionPanel({
  projectId,
  reportId,
  actionId,
  insightTitle,
  initialSection,
}: {
  projectId: string;
  reportId: string;
  actionId?: string;
  initialSection?: string;
  insightTitle?: string;
}) {
  const t = useMessages(reportActionPanelMessages), { locale } = useEnergyIqLocale();
  const [detailSection, setDetailSection] = useState(initialSection ?? "estimate");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const titleInput = useRef<HTMLInputElement>(null);
  const updateForm = useRef<HTMLFormElement>(null);
  const estimateForm = useRef<HTMLFormElement>(null);
  const [suggestion, setSuggestion] = useState<{
    id: string;
    runId?: string;
  } | null>(null);
  const requests = useRef(new Map<string, string>());
  const requestKey = (content: unknown) => {
    const key = JSON.stringify(content);
    let id = requests.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      requests.current.set(key, id);
    }
    return id;
  };
  const [shareWithProject, setShareWithProject] = useState(false);
  const [historicalFeedback, setHistoricalFeedback] = useState(false);
  const [feedbackHtml, setFeedbackHtml] = useState<string | null>(null);
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState<ReportActionPanelMessage | "">("");
  const [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(""),
    [details, setDetails] = useState(""),
    [meter, setMeter] = useState("");
  const [baselineFrom, setBaselineFrom] = useState("");
  const [baselineEnd, setBaselineEnd] = useState("");
  const shiftDate = (date: string, days: number) =>
    new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const [selected, setSelected] = useState<Action | null>(null),
    [eventType, setEventType] = useState("implemented"),
    [effectiveAt, setEffectiveAt] = useState("");
  const [scenarioFor, setScenarioFor] = useState<string | null>(null),
    [kw, setKw] = useState(""),
    [hours, setHours] = useState("3"),
    [days, setDays] = useState("22"),
    [assumptions, setAssumptions] = useState("");
  const [estimate, setEstimate] = useState<{
      id: string;
      energyKwh: number;
    } | null>(null),
    [notice, setNotice] = useState<ReportActionPanelMessage | "">("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    configApi
      .reportActionRequest<State>(
        projectId,
        `?reportId=${encodeURIComponent(reportId)}`,
        { signal: c.signal },
      )
      .then((v) => {
        if (!c.signal.aborted) setData(v);
      })
      .catch(() => {
        if (!c.signal.aborted) setError("loadFailed");
      });
    return () => c.abort();
  }, [projectId, reportId, reload]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") setReload((v) => v + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [projectId, reportId]);
  useEffect(() => {
    if (adding) titleInput.current?.focus();
  }, [adding, suggestion?.id]);
  useEffect(() => {
    const form = selected ? updateForm.current : scenarioFor ? estimateForm.current : null;
    form?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    form?.querySelector<HTMLElement>("input, textarea, button")?.focus();
  }, [selected?.id, scenarioFor]);
  const pendingSuggestions =
    data?.suggestions?.status === "queued" ||
    data?.suggestions?.status === "running";
  const remainingSuggestions = (data?.suggestions?.items ?? []).filter(
    (item) =>
      !data?.actions.some(
        (action) =>
          action.suggestionId === item.id ||
          action.sources?.some(
            (source) =>
              source.reportId === reportId &&
              source.sourceQuote === item.sourceQuote,
          ),
      ),
  );
  function startAdding(item?: Suggestion) {
    if (!data) return;
    setShareWithProject(false);
    setAdding(true);
    setSelected(null);
    setScenarioFor(null);
    setError("");
    setNotice("");
    setTitle(item?.title ?? "");
    setDetails(item?.recommendation ?? "");
    setMeter(
      item?.meterId && data.meters.some((m) => m.meterPointId === item.meterId)
        ? item.meterId
        : "",
    );
    setSuggestion(
      item
        ? {
            id: item.id,
            ...(data.suggestions?.runId
              ? { runId: data.suggestions.runId }
              : {}),
          }
        : null,
    );
    setBaselineFrom(data.baseline.from);
    setBaselineEnd(shiftDate(data.baseline.toExclusive, -1));
  }
  async function mutate(path: string, body: unknown, onSuccess: () => void) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await configApi.reportActionRequest(projectId, path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!alive.current) return;
      onSuccess();
      setReload((v) => v + 1);
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error &&
            error.message.includes("ACTION_SCENARIO_WINDOW_UNSUPPORTED")
            ? "windowUnsupported"
            : "saveFailed",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function submit(path: string, body: unknown) {
    await mutate(path, body, () => {
      if (!path || path.endsWith("/events")) {
        setAdding(false);
        setSelected(null);
        setDetails("");
        setSuggestion(null);
      }
      setNotice(
        path.endsWith("/check")
          ? "noticeChecked"
          : path.endsWith("/retry")
            ? "noticeRetry"
            : path.endsWith("/events")
              ? "noticeProgress"
              : "noticeSaved",
      );
    });
  }
  const canAdopt = (action: Action) =>
    action.scenarioLocked === false &&
    ["proposed", "scheduled"].includes(action.state);
  const eventLabel = (type: string) => labelFor(t, reportActionPanelMessages, `event.${type}`, t("eventOther"));
  const stateLabel = (state: string) => labelFor(t, reportActionPanelMessages, `state.${state}`, state);
  const runStatusLabel = (status: string) => labelFor(t, reportActionPanelMessages, `run.${status}`, status);
  // Sentences with a <time> inside: the text on either side of it, in the reader's word order.
  const effectiveText = around(t("effective", { timezone: data?.timezone ?? "" }), "time");
  const recordedText = around(t("recorded"), "time");
  const estimatedText = around(t("estimatedAvoided"), "value");
  const displayTime = (value: string) =>
    new Date(value).toLocaleString(intlLocale(locale), {
      timeZone: data?.timezone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  function adopt(action: Action, scenarioId: string) {
    void mutate(
      `${encodeURIComponent(action.id)}/scenario-adoption`,
      {
        revision: action.revision,
        scenarioId,
        requestId: requestKey({
          reportId,
          actionId: action.id,
          revision: action.revision,
          scenarioId,
        }),
      },
      () => setNotice("noticeAdopted"),
    );
  }
  return (
    <section className={`${styles.panel} ${actionId ? styles.detailPanel : ""}`} aria-label={t("panelLabel")}>
      {!actionId && <header>
        <h2>{t("heading")}</h2>
        <p>{t("intro")}</p>
      </header>}
      {!actionId && <p className={styles.scopeNote}>{t("scopeNote")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      {notice && <p role="status">{t(notice)}</p>}
      {feedbackHtml && (
        <div>
          <button onClick={() => setFeedbackHtml(null)}>{t("backToActions")}</button>
          {historicalFeedback && (
            <p role="status">{t("historicalNote")}</p>
          )}
          <iframe
            title={t("effectReportFrame")}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "70vh", border: 0 }}
            srcDoc={reportPreviewHtml(feedbackHtml)}
          />
        </div>
      )}
      {!data ? (
        !error && <p role="status">{t("loading")}</p>
      ) : (
        <>
          {!actionId && (
            <section
              className={styles.recommendations}
              aria-label={t("recommendationsLabel")}
            >
              <div className={styles.sectionHeading}>
                <div>
                  <h3>{t("recommendationsTitle")}</h3>
                  <p>{t("recommendationsIntro")}</p>
                </div>
                {data.canExtract && !pendingSuggestions && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        "suggestions",
                        { sourceReportId: reportId },
                        () => {
                          setData((current) =>
                            current
                              ? {
                                  ...current,
                                  suggestions: {
                                    ...current.suggestions,
                                    status: "queued",
                                    items: current.suggestions?.items ?? [],
                                  },
                                }
                              : current,
                          );
                        },
                      )
                    }
                  >
                    {["failed", "interrupted", "cancelled"].includes(
                      data.suggestions?.status ?? "",
                    )
                      ? t("retryRecommendations")
                      : t("findRecommendations")}
                  </button>
                )}
              </div>
              {pendingSuggestions && (
                <p role="status" className={styles.pending}>{t("readingReport")}</p>
              )}
              {["failed", "interrupted", "cancelled"].includes(
                data.suggestions?.status ?? "",
              ) && (
                <p role="alert">{t("recommendationsFailed")}</p>
              )}
              {!pendingSuggestions && !remainingSuggestions.length && (
                <p className={styles.muted}>
                  {data.suggestions?.items.length
                    ? t("allTracked")
                    : t("noRecommendations")}
                </p>
              )}
              {remainingSuggestions.map((item) => (
                <article className={styles.suggestion} key={item.id}>
                  <h4>{item.title}</h4>
                  <p>{item.recommendation}</p>
                  <details className={styles.source}>
                    <summary>{t("viewWording")}</summary>
                    <blockquote>{item.sourceQuote}</blockquote>
                  </details>
                  <button
                    disabled={busy || adding || !!selected || !!scenarioFor}
                    onClick={() => startAdding(item)}
                  >
                    {t("trackAction")}
                  </button>
                  {!!data.projectActions?.some(
                    (a) =>
                      a.meterIds.includes(item.meterId ?? "") &&
                      !a.sources.some((s) => s.reportId === reportId),
                  ) && (
                    <details className={styles.source}>
                      <summary>{t("linkExisting")}</summary>
                      <p>{t("linkExistingHint")}</p>
                      {data.projectActions
                        .filter(
                          (a) =>
                            a.meterIds.includes(item.meterId ?? "") &&
                            !a.sources.some((s) => s.reportId === reportId),
                        )
                        .map((a) => (
                          <button
                            key={a.id}
                            disabled={
                              busy || adding || !!selected || !!scenarioFor
                            }
                            onClick={() =>
                              mutate(
                                `${a.id}/sources`,
                                {
                                  sourceReportId: reportId,
                                  suggestionId: item.id,
                                },
                                () => setNotice("noticeLinked"),
                              )
                            }
                          >
                            {a.title}
                          </button>
                        ))}
                    </details>
                  )}
                </article>
              ))}
            </section>
          )}
          <div className={styles.sectionHeading}>
            {!actionId && <h3>{t("trackedActions")}</h3>}
            {!actionId && !adding && (
              <button
                disabled={busy || !!selected || !!scenarioFor}
                onClick={() => startAdding()}
              >
                {t("addRecommendation")}
              </button>
            )}
          </div>
          {!data.actions.length && !adding && (
            <p className={styles.empty}>{t("noActions")}</p>
          )}
          {actionId && !data.actions.some((a) => a.id === actionId) && (
            <p role="status">{t("actionUnavailable")}</p>
          )}
          {data.actions
            .filter((a) => !actionId || a.id === actionId)
            .map((a) => (
              <article key={a.id} className={styles.action}>
                <div className={styles.actionMeta}>
                  <span className={styles.visibility}>
                    {a.visibility === "project" ? t("projectAction") : t("onlyYou")}
                  </span>
                  <span className={styles.status}>
                    {stateLabel(a.state)}
                  </span>
                </div>
                {actionId ? <h1>{a.title}</h1> : <h3>{a.title}</h3>}
                {actionId && insightTitle && <p className={styles.findingContext}>{t("whyItMatters", { title: insightTitle })}</p>}
                {actionId ? <details className={styles.source}><summary>{t("whatInvolves")}</summary><p>{a.recommendation}</p></details> : <p>{a.recommendation}</p>}
                {actionId && <div className={styles.nextStep}>
                  <h2>{a.state === "implemented" ? t("nextImplemented") : a.state === "paused" ? t("nextPaused") : a.state === "scheduled" ? t("nextScheduled") : t("nextDefault")}</h2>
                  <p>{a.state === "implemented" ? t("nextImplementedBody") : t("nextDefaultBody")}</p>
                </div>}
                <div className={styles.buttons}>
                  <button
                    disabled={busy || adding || !!selected || !!scenarioFor}
                    onClick={() => {
                      if(actionId){setDetailSection("updates");return;}
                      setAdding(false);
                      setScenarioFor(null);
                      setEffectiveAt("");
                      setError("");
                      setSelected(a);
                      setDetails("");
                      setEventType(!actionId || a.state === "implemented" ? "implemented" : "scheduled");
                    }}
                  >
                    {actionId ? t("recordUpdate") : t("recordProgress")}
                  </button>
                  <button
                    disabled={busy || adding || !!selected || !!scenarioFor}
                    onClick={() => {
                      setAdding(false);
                      setSelected(null);
                      if (actionId) {setDetailSection("estimate");return;}
                      setKw("");
                      setHours("3");
                      setDays("22");
                      setAssumptions("");
                      setError("");
                      setScenarioFor(a.id);
                      setEstimate(null);
                    }}
                  >
                    {actionId ? t("viewAssessment") : t("estimateLighting")}
                  </button>
                </div>
                {actionId && <nav className={styles.detailTabs} aria-label={t("sectionsLabel")}>
                  {([["updates", "tabUpdates"], ["estimate", "tabEstimate"], ["results", "tabResults"]] as const).map(([key,label]) => <button key={key} aria-pressed={detailSection === key} onClick={() => setDetailSection(key)}>{t(label)}</button>)}
                </nav>}
                <div hidden={!!actionId && detailSection !== "updates"}>
                {actionId && <ActionProgressInput projectId={projectId} actionId={a.id} timezone={data.timezone} onSaved={()=>setReload(n=>n+1)}/> }

                {!!a.sources?.length && (
                  <details className={styles.source}>
                    <summary>{t("sourceReports", { count: a.sources.length })}</summary>
                    {a.sources.map((source, index) => (
                      <div key={source.reportId}>
                        <a
                          href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}&reportId=${encodeURIComponent(source.reportId)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("openSourceReport", { number: index + 1 })}
                        </a>
                        <blockquote>
                          {source.sourceQuote ?? source.recommendation}
                        </blockquote>
                      </div>
                    ))}
                  </details>
                )}
                {!!a.events?.length && (
                  <details className={styles.progressHistory}>
                    <summary>{t("progressHistory", { count: a.events.length })}</summary>
                    <ol>
                      {a.events.map((event, index) => (
                        <li key={`${event.recordedAt}:${index}`}>
                          <div className={styles.sectionHeading}>
                            <strong>{eventLabel(event.type)}</strong>
                            <span>{event.actorName}</span>
                          </div>
                          <p>
                            {effectiveText[0]}
                            <time dateTime={event.effectiveAt}>
                              {displayTime(event.effectiveAt)}
                            </time>
                            {effectiveText[1]}
                          </p>
                          <p className={styles.assumptions}>{event.details}</p>
                          <small>
                            {recordedText[0]}
                            <time dateTime={event.recordedAt}>
                              {displayTime(event.recordedAt)}
                            </time>
                            {recordedText[1]}
                          </small>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                </div>
                <div hidden={!!actionId && detailSection !== "estimate"}>
                {actionId && (a.meterIds?.length ?? 0) > 0 && <section aria-label={t("affectedEquipment")}><h3>{t("equipmentTitle")}</h3><ul>{(a.meterIds??[]).map(id=>{const meter=data.meters.find(m=>m.meterPointId===id);return <li key={id}>{meter?.sourceLabel ?? t("equipmentUnconfirmed")}</li>;})}</ul></section>}
                {actionId && <ActionSiteQuestion projectId={projectId} actionId={a.id} />}
                {actionId && <ActionAiEstimate key={`${projectId}:${a.id}`} projectId={projectId} actionId={a.id} />}
                {(a.adoptedScenarioId || !!a.scenarios?.length) && <details><summary>{t("earlierScenarios")}</summary><p>{t("earlierScenariosNote")}</p>
                {a.adoptedScenarioId && (
                  <div className={styles.linked}>
                    <strong>{t("linkedEstimate")}</strong>
                    <p>
                      {t("avoidedUse", { kwh: a.scenarios
                        ?.find((item) => item.id === a.adoptedScenarioId)
                        ?.value.energyKwh.toFixed(2) ?? "—" })}
                    </p>
                    <small>{t("estimateOnly")}</small>
                  </div>
                )}
                {!!a.scenarios?.length && (
                  <details
                    className={styles.scenarioHistory}
                    open={scenarioFor === a.id || undefined}
                  >
                    <summary>{t("scenarioHistory", { count: a.scenarios.length })}</summary>
                    {a.scenarios.map((scenario) => (
                      <div key={scenario.id} className={styles.scenario}>
                        <div className={styles.sectionHeading}>
                          <strong>
                            {t("avoidedUse", { kwh: scenario.value.energyKwh.toFixed(2) })}
                          </strong>
                          <time dateTime={scenario.recordedAt}>
                            {new Date(scenario.recordedAt).toLocaleString(
                              intlLocale(locale),
                              {
                                timeZone: data.timezone,
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </time>
                        </div>
                        <p>
                          {t("scenarioInputs", { kw: scenario.value.inputs.reduciblePowerKw, hours: scenario.value.inputs.hoursPerDay, days: scenario.value.inputs.days })}
                        </p>
                        <p className={styles.assumptions}>
                          {scenario.value.inputs.assumptions}
                        </p>
                        {a.adoptedScenarioId === scenario.id ? (
                          <p className={styles.linkedLabel}>{t("linkedEstimate")}</p>
                        ) : (
                          canAdopt(a) && (
                            <>
                              <button
                                disabled={
                                  busy ||
                                  scenario.value.inputs.days < 3 ||
                                  scenario.value.inputs.days > 60
                                }
                                onClick={() => adopt(a, scenario.id)}
                              >
                                {t("adoptScenario")}
                              </button>
                              {(scenario.value.inputs.days < 3 ||
                                scenario.value.inputs.days > 60) && (
                                <p className={styles.muted}>{t("scenarioOutOfRange")}</p>
                              )}
                            </>
                          )
                        )}
                      </div>
                    ))}
                    <p className={styles.muted}>
                      {canAdopt(a)
                        ? t("adoptHint")
                        : t("adoptLocked")}
                    </p>
                  </details>
                )}
                </details>}
                </div>
                <div hidden={!!actionId && detailSection !== "results"}>
                {actionId && a.state !== "implemented" && !a.feedback?.length && <p>{t("resultsNotStarted")}</p>}
                {a.check &&
                  a.check.revision === a.revision &&
                  (!a.feedback?.some((f) => !f.stale) ||
                    ["retry_scheduled", "retry_exhausted"].includes(
                      a.check.status,
                    )) && (
                    <p role="status">
                      {a.check.status === "retry_scheduled"
                        ? a.check.nextRetryAt
                          ? t("retryScheduledAt", { time: displayTime(a.check.nextRetryAt), timezone: data.timezone })
                          : t("retryScheduled")
                        : a.check.status === "retry_exhausted"
                          ? t("retryExhausted")
                          : a.check.status === "waiting_data"
                            ? t("waitingData", { reason: a.check.reason ?? t("waitingDataDefault") })
                            : a.check.status === "check_failed"
                              ? t("checkFailed")
                              : t("preparing")}
                    </p>
                  )}
                {a.feedback
                  ?.filter((f) => !f.stale)
                  .map((f) => (
                    <div key={f.runId}>
                      {a.adoptedScenarioId && f.stage !== "scenario" && (
                        <p className={styles.muted}>{t("partialObservation")}</p>
                      )}
                      {f.status === "succeeded" ? (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await configApi.reportActionRequest<{
                                content: string;
                                historical?: boolean;
                              }>(
                                projectId,
                                `${encodeURIComponent(a.id)}/feedback/${encodeURIComponent(f.runId)}`,
                              );
                              if (alive.current) {
                                setFeedbackHtml(r.content);
                                void configApi.reportActionRequest(projectId,`notifications/${f.runId}`,{method:"POST",body:"{}"});
                                setHistoricalFeedback(r.historical ?? false);
                              }
                            } catch {
                              if (alive.current) setError("feedbackUnavailable");
                            } finally {
                              if (alive.current) setBusy(false);
                            }
                          }}
                        >
                          {f.stage === "scenario"
                            ? t("scenarioComparison")
                            : f.stage === "initial" ? t("readInitial") : t("readExtended")}
                        </button>
                      ) : (
                        <div>
                          {["failed", "interrupted", "cancelled"].includes(
                            f.status,
                          ) ? (
                            <>
                              <p>{t("feedbackFailed")}</p>
                              {(f.status === "cancelled" ||
                                a.check?.status !== "retry_scheduled") && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void submit(
                                      `${encodeURIComponent(a.id)}/feedback/${encodeURIComponent(f.runId)}/retry`,
                                      {},
                                    )
                                  }
                                >
                                  {t("retryEffect")}
                                </button>
                              )}
                            </>
                          ) : (
                            <p>{t("effectQueued")}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                {!!a.feedback?.some((f) => f.stale) && (
                  <details className={styles.progressHistory}>
                    <summary>
                      {t("earlierAssessments", { count: a.feedback.filter((f) => f.stale).length })}
                    </summary>
                    <p>{t("earlierAssessmentsNote")}</p>
                    {a.feedback
                      .filter((f) => f.stale)
                      .map((f) => (
                        <div key={f.runId}>
                          {f.status === "succeeded" ? (
                            <button
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const result =
                                    await configApi.reportActionRequest<{
                                      content: string;
                                    }>(
                                      projectId,
                                      `${encodeURIComponent(a.id)}/feedback/${encodeURIComponent(f.runId)}`,
                                    );
                                  if (alive.current) {
                                    setFeedbackHtml(result.content);
                                    void configApi.reportActionRequest(projectId,`notifications/${f.runId}`,{method:"POST",body:"{}"});
                                    setHistoricalFeedback(true);
                                  }
                                } catch {
                                  if (alive.current) setError("earlierUnavailable");
                                } finally {
                                  if (alive.current) setBusy(false);
                                }
                              }}
                            >
                              {t(f.stage === "scenario" ? "readEarlierScenario" : "readEarlierEffect", { revision: f.revision })}
                            </button>
                          ) : (
                            <p>{t("earlierStatus", { status: runStatusLabel(f.status) })}</p>
                          )}
                        </div>
                      ))}
                  </details>
                )}
                {a.state === "implemented" &&
                  !a.check &&
                  !a.feedback?.some((f) => !f.stale) && (
                    <p role="status">{t("monitoringActive")}</p>
                  )}

                </div>
              </article>
            ))}
          {adding && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit("", {
                  sourceReportId: reportId,
                  visibility:
                    data.canShare && shareWithProject ? "project" : "private",
                  ...(suggestion
                    ? {
                        suggestionId: suggestion.id,
                        ...(suggestion.runId
                          ? { suggestionRunId: suggestion.runId }
                          : {}),
                      }
                    : {}),
                  title,
                  recommendation: details,
                  meterIds: [meter],
                  baseline: {
                    ...data.baseline,
                    from: baselineFrom,
                    toExclusive: shiftDate(baselineEnd, 1),
                  },
                  idempotencyKey: requestKey({
                    reportId,
                    suggestion,
                    visibility:
                      data.canShare && shareWithProject ? "project" : "private",
                    title,
                    details,
                    meter,
                    baseline: {
                      ...data.baseline,
                      from: baselineFrom,
                      toExclusive: shiftDate(baselineEnd, 1),
                    },
                  }),
                });
              }}
            >
              <h3>
                {suggestion
                  ? t("trackRecommendation")
                  : t("addRecommendation")}
              </h3>
              <label>
                {t("actionTitle")}
                <input
                  required
                  ref={titleInput}
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                {t("whatShouldChange")}
                <textarea
                  required
                  maxLength={2000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </label>
              <fieldset>
                <legend>{t("beforeChange")}</legend>
                <p>{t("beforeChangeHint")}</p>
                <label>
                  {t("baselineStarts")}
                  <input
                    type="date"
                    required
                    value={baselineFrom}
                    onChange={(e) => setBaselineFrom(e.target.value)}
                  />
                </label>
                <label>
                  {t("baselineEnds")}
                  <input
                    type="date"
                    required
                    min={baselineFrom}
                    value={baselineEnd}
                    onChange={(e) => setBaselineEnd(e.target.value)}
                  />
                </label>
              </fieldset>
              {data.canShare && (
                <label className={styles.shareOption}>
                  <input
                    type="checkbox"
                    checked={shareWithProject}
                    onChange={(event) =>
                      setShareWithProject(event.target.checked)
                    }
                  />
                  <span>
                    {t("shareWithProject")}
                    <small>{t("shareHint")}</small>
                  </span>
                </label>
              )}
              {!meter && (
                <p className={styles.muted}>{t("chooseMeterHint")}</p>
              )}
              <EnergySelect
                ariaLabel={t("affectedMeter")}
                value={meter}
                options={data.meters.map((m) => ({
                  value: m.meterPointId,
                  label: m.sourceLabel,
                }))}
                onValueChange={setMeter}
                placeholder={t("chooseMeter")}
              />
              <div className={styles.buttons}>
                <button
                  className={styles.primary}
                  disabled={busy || !meter || !data.baseline.snapshotId}
                >
                  {t("saveAction")}
                </button>
                <button type="button" onClick={() => setAdding(false)}>
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}
          {selected && (
            <form
              ref={updateForm}
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  void submit(`${encodeURIComponent(selected.id)}/events`, {
                    revision: selected.revision,
                    requestId: requestKey({
                      id: selected.id,
                      revision: selected.revision,
                      eventType,
                      effectiveAt,
                      details,
                    }),
                    type: eventType,
                    effectiveAt: actionLocalInstant(effectiveAt, data.timezone),
                    details,
                  });
                } catch {
                  setError("invalidTime");
                }
              }}
            >
              <h3>{t("recordUpdate")}</h3>
              <p>{t("updateIntro", { timezone: data.timezone })}</p>
              <EnergySelect
                ariaLabel={t("progress")}
                value={eventType}
                options={[
                  { value: "scheduled", label: t("optionPlanned") },
                  { value: "implemented", label: t("optionImplemented") },
                  { value: "paused", label: t("optionPaused") },
                  { value: "declined", label: t("optionDeclined") },
                ]}
                onValueChange={setEventType}
              />
              <label>
                {t(eventType === "scheduled" ? "whenPlanned" : "whenEffective", { timezone: data.timezone })}
                <input
                  type="datetime-local"
                  required
                  value={effectiveAt}
                  onChange={(e) => setEffectiveAt(e.target.value)}
                />
              </label>
              <label>
                {eventType === "scheduled" ? t("whatPlan") : t("whatChanged")}
                <textarea
                  required
                  maxLength={2000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </label>
              <div className={styles.buttons}>
                <button className={styles.primary} disabled={busy}>
                  {t("saveProgress")}
                </button>
                <button type="button" onClick={() => setSelected(null)}>
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}
          {scenarioFor && (
            <form
              ref={estimateForm}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const r = await configApi.reportActionRequest<{
                    id: string;
                    energyKwh: number;
                  }>(
                    projectId,
                    `${encodeURIComponent(scenarioFor)}/scenarios`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        reduciblePowerKw: Number(kw),
                        hoursPerDay: Number(hours),
                        days: Number(days),
                        assumptions,
                      }),
                    },
                  );
                  if (!alive.current) return;
                  setEstimate({ id: r.id, energyKwh: r.energyKwh });
                  setReload((v) => v + 1);
                } catch {
                  if (alive.current) setError("estimateFailed");
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            >
              <h3>{t("whatIfLighting")}</h3>
              <fieldset disabled={busy} className={styles.scenarioInputs}>
                <p>{t("estimateBasis")}</p>
                <label>
                  {t("removablePower")}
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="any"
                    required
                    value={kw}
                    onChange={(e) => {
                      setKw(e.target.value);
                      setEstimate(null);
                    }}
                  />
                </label>
                <label>
                  {t("fewerHours")}
                  <input
                    type="number"
                    min="0.01"
                    max="24"
                    step="any"
                    required
                    value={hours}
                    onChange={(e) => {
                      setHours(e.target.value);
                      setEstimate(null);
                    }}
                  />
                </label>
                <label>
                  {t("observationDays")}
                  <input
                    type="number"
                    min="1"
                    max="366"
                    required
                    value={days}
                    onChange={(e) => {
                      setDays(e.target.value);
                      setEstimate(null);
                    }}
                  />
                </label>
                <p className={styles.muted}>{t("observationHint")}</p>
                <label>
                  {t("assumptions")}
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={assumptions}
                    onChange={(e) => {
                      setAssumptions(e.target.value);
                      setEstimate(null);
                    }}
                  />
                </label>
              </fieldset>
              {estimate !== null && (
                <output className={styles.result}>
                  {estimatedText[0]}
                  <strong>{estimate.energyKwh.toFixed(2)} kWh</strong>
                  {estimatedText[1]}
                  <p>{t("savedToHistory")}</p>
                </output>
              )}
              <div className={styles.buttons}>
                <button className={styles.primary} disabled={busy}>
                  {t("calculateSave")}
                </button>
                <button type="button" onClick={() => setScenarioFor(null)}>
                  {t("closeEstimate")}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

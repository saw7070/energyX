"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ReportActionPanel } from "./report-action-panel";
import { configApi } from "../../../lib/config-api";
import styles from "./project-actions.module.css";
import { operatingHoursWording } from "./hours-wording";
import { ActionResultNotices } from "./action-result-notices";
import { ActionDemonstration } from "./action-demonstration";
import { ActionFindingEditor } from "./action-finding-editor";
import { InsightReview, type FindingReview } from "./insight-review";
import {InsightMerge} from "./insight-merge";
import { useMessages } from "./energyiq-locale";
import { findingLabelMessages, labelFor, projectActionsMessages } from "./project-actions-messages";
type Item = {
  id: string;
  title: string;
  recommendation: string;
  state: string;
  sourceReportId: string;
  visibility?: string;
  canPrioritise: boolean;
  canDemonstrate?: boolean;
  sources: Array<{ reportId: string; recommendation: string }>;
  priority: {
    revision: number;
    level: "high" | "medium" | "low";
    reason: string;
  };
};
const rank = { high: 0, medium: 1, low: 2 };
type Message = keyof (typeof projectActionsMessages)["en"];
export function ProjectActions({ projectId }: { projectId: string }) {
  const t = useMessages(projectActionsMessages), labels = useMessages(findingLabelMessages);
  const statusLabel = (state: string) => labelFor(t, projectActionsMessages, `state.${state}`, state);
  const listStateLabel = (state: string) => labelFor(t, projectActionsMessages, `listState.${state}`, state);
  const priorityLabel = (level: string) => labelFor(t, projectActionsMessages, `priority.${level}`, `${level.charAt(0).toUpperCase()}${level.slice(1)} priority`);
  const findingLabel = (kind: "statusInline" | "importanceInline" | "urgencyInline", value: string) => labelFor(labels, findingLabelMessages, `${kind}.${value}`, value);
  const requestedActionId = useSearchParams()?.get("actionId");
  const [resultAction,setResultAction]=useState<string|null>(null);
  const [linking, setLinking] = useState<Item | null>(null);
  const [insightReload, setInsightReload] = useState(0);
  const [insights, setInsights] = useState<
    Array<{
      id: string;
      title: string;
      summary: string;
      version?: string;
      meterIds?: string[];
      mergeId?: string;
      mergedFindings?: Array<{id:string;title:string;summary:string;review:FindingReview}>;
      review?: FindingReview;
      reviewHistory?: Array<FindingReview & { at: string }>;
      actionIds: string[];
      sources: Array<{ reportId: string; sourceQuote: string }>;
    }>
  >([]);
  useEffect(() => {
    const c = new AbortController();
    configApi
      .reportActionRequest<{ insights: typeof insights }>(
        projectId,
        "insights",
        { signal: c.signal },
      )
      .then((r) => {
        if (!c.signal.aborted) setInsights(r.insights ?? []);
      })
      .catch(() => {});
    return () => c.abort();
  }, [projectId, insightReload]);
  const [reviewReports, setReviewReports] = useState<
    Array<{
      reportId: string;
      count: number;
      from: string;
      toExclusive: string;
    }>
  >([]);
  const [reviewReport, setReviewReport] = useState<string | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [items, setItems] = useState<Item[] | null>(null),
    [error, setError] = useState<Message | "">(""),
    [filter, setFilter] = useState("all"),
    [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null),
    [level, setLevel] = useState<Item["priority"]["level"]>("medium"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    configApi
      .reportActionRequest<{
        actions: Item[];
        reviewReports?: typeof reviewReports;
      }>(projectId, "project-list", { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) {
          setItems(v.actions);
          if (requestedActionId) setDetail(v.actions.find(action => action.id === requestedActionId) ?? null);
          setReviewReports(v.reviewReports ?? []);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError("loadFailed");
      });
    return () => c.abort();
  }, [projectId, reload, requestedActionId]);
  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await configApi.reportActionRequest(projectId, `${editing.id}/priority`, {
        method: "POST",
        body: JSON.stringify({
          revision: editing.priority.revision,
          level,
          reason,
        }),
      });
      setEditing(null);
      setReload((n) => n + 1);
    } catch {
      setError("priorityFailed");
    } finally {
      setBusy(false);
    }
  }
  const shown = (items ?? [])
    .filter(
      (a) => filter === "all" || !["paused", "declined"].includes(a.state),
    )
    .sort((a, b) => rank[a.priority.level] - rank[b.priority.level]);
  const groupedIds = new Set(insights.flatMap((i) => i.actionIds));
  const unlinked = shown.filter((a) => !groupedIds.has(a.id));
  const visibleInsights = insights.filter((i) =>
    i.actionIds.some((id) => shown.some((a) => a.id === id)),
  ).sort((a,b) => {
    const priority = (ids: string[]) => Math.min(...shown.filter(item => ids.includes(item.id)).map(item => rank[item.priority.level]));
    const closed = (i: typeof a) => ["resolved", "archived"].includes(i.review?.status ?? "open") ? 1 : 0;
    const urgency = (i: typeof a) => ({ urgent: 0, soon: 1, routine: 2 }[i.review?.urgency ?? "routine"] ?? 2);
    const importance = (i: typeof a) => rank[(i.review?.importance ?? "medium") as keyof typeof rank];
    return closed(a) - closed(b) || urgency(a) - urgency(b) || importance(a) - importance(b) || priority(a.actionIds) - priority(b.actionIds);
  });
  const selectedInsight = detail
    ? insights.find((i) => i.actionIds.includes(detail.id))
    : undefined;
  if (reviewReport)
    return (
      <main className={styles.page}>
        <button
          onClick={() => {
            setReviewReport(null);
            setReload((n) => n + 1);
          }}
        >
          {t("backToPlan")}
        </button>
        <ReportActionPanel projectId={projectId} reportId={reviewReport} />
      </main>
    );
  if (detail)
    return (
      <main className={styles.page}>
        <button
          onClick={() => {
            setDetail(null);
            setReload((n) => n + 1);
          }}
        >
          {t("backToPlan")}
        </button>
        <ReportActionPanel
          projectId={projectId}
          reportId={detail.sourceReportId}
          actionId={detail.id}
          initialSection={resultAction===detail.id?"results":"estimate"}
          insightTitle={selectedInsight?.title}
        />
        {detail.canDemonstrate && (
          <details className={styles.demoEntry}>
            <summary>{t("tryDemo")}</summary>
            <ActionDemonstration
              key={detail.id}
              projectId={projectId}
              actionId={detail.id}

            />
          </details>
        )}
      </main>
    );
  return (
    <main className={styles.page}>
      <ActionResultNotices projectId={projectId} onOpen={id=>{const a=items?.find(a=>a.id===id);if(a){setResultAction(id);setDetail(a);}}}/>
      <header className={styles.heading}>
        <div>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        <Link
          href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}`}
        >
          {t("readReports")}
        </Link>
      </header>
      <ol className={styles.journey} aria-label={t("journey")}>
        {([["step1Title", "step1Body"], ["step2Title", "step2Body"], ["step3Title", "step3Body"], ["step4Title", "step4Body"]] as const).map(([title, body], index) => (
          <li key={title}>
            <span>{index + 1}</span>
            <div>
              <strong>{t(title)}</strong>
              <p>{t(body)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className={styles.sectionHeading}>
        <h2>
          {t("needsAttention")}
          {items && (
            <span>
              {t(insights.length === 1 ? "findingsOne" : "findingsMany", { count: insights.length })}
            </span>
          )}
        </h2>
        <div className={styles.filters} aria-label={t("filters")}>
          {["all", "active"].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? t("allActions") : t("activeActions")}
            </button>
          ))}
        </div>
      </div>
      {items && !insights.length && (
        <p className={styles.empty}>{t("noFindings")}</p>
      )}
      {!!visibleInsights.length && (
        <section className={styles.insights} aria-label={t("insights")}>
          {visibleInsights.map((insight) => {
            const related = shown.filter((a) =>
              insight.actionIds.includes(a.id),
            );
            return (
              <article key={insight.id} className={styles.finding}>
                <div className={styles.findingEvidence}>
                  <span className={styles.columnLabel}>{t("whatWeFound")}</span>
                  <h2>{operatingHoursWording(insight.title)}</h2>
                  {items?.some(a=>a.canDemonstrate)&&<InsightMerge key={`${insight.id}:${insight.version}:${insight.mergeId??"single"}`} projectId={projectId} finding={insight} findings={insights} onSaved={()=>setInsightReload(n=>n+1)}/>}
                  <p>{t("reviewSummary", { status: findingLabel("statusInline", insight.review?.status ?? "open"), importance: findingLabel("importanceInline", insight.review?.importance ?? "medium"), urgency: findingLabel("urgencyInline", insight.review?.urgency ?? "routine") })}</p>
                  {items?.some(a => a.canDemonstrate) && <details><summary>{t("reviewFinding")}</summary><InsightReview key={`${insight.id}:${insight.review?.revision ?? 0}`} projectId={projectId} insight={insight} onSaved={() => setInsightReload(n => n + 1)} /></details>}
                  {!!insight.reviewHistory?.length && <details><summary>{t("assessmentHistory")}</summary>{insight.reviewHistory.map(r => <p key={r.revision}>{t("historyEntry", { status: findingLabel("statusInline", r.status), reason: r.reason })}</p>)}</details>}
                  <p>{operatingHoursWording(insight.summary.split(/(?<=[.!?])\s/)[0] ?? "")}</p>
                  <details>
                    <summary>
                      {t(insight.sources.length === 1 ? "evidenceOne" : "evidenceMany", { count: insight.sources.length })}
                    </summary>
                    <p>{operatingHoursWording(insight.summary)}</p>
                    {insight.sources.map((s, i) => (
                      <p key={s.reportId}>
                        <Link
                          href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}&reportId=${encodeURIComponent(s.reportId)}`}
                        >
                          {t("openSourceReport", { number: i + 1 })}
                        </Link>
                        <br />
                        {s.sourceQuote}
                      </p>
                    ))}
                  </details>
                </div>
                <div className={styles.relatedActions}>
                  <h3>
                    {t("whatYouCanDo")}{" "}
                    <span>
                      {t(related.length === 1 ? "actionsOne" : "actionsMany", { count: related.length })}
                    </span>
                  </h3>
                  {related.map((a, index) => (
                    <details open={index === 0 ? true : undefined}
                      key={a.id}
                      className={styles.actionRow}
                      aria-label={t("actionFor", { title: insight.title })}
                    >
                      <summary>{index === 0 ? t("recommendedAction") : t("anotherOption")}</summary>
                      <div className={styles.meta}>
                        <span data-priority={a.priority.level}>
                          {priorityLabel(a.priority.level)}
                        </span>
                        <span className={styles.status}>
                          {statusLabel(a.state)}
                        </span>
                      </div>
                      <h4>{operatingHoursWording(a.title)}</h4>
                      <button
                        className={styles.primaryButton}
                        onClick={() => setDetail(a)}
                      >
                        {t("reviewAction")}
                      </button>
                      {a.canPrioritise && (
                        <button
                          className={styles.quietButton}
                          onClick={() => {
                            setEditing(a);
                            setLevel(a.priority.level);
                            setReason(a.priority.reason);
                          }}
                        >
                          {t("setPriority")}
                        </button>
                      )}
                    </details>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}
      {!!reviewReports.length && (
        <section className={styles.action}>
          <h2>{t("recommendationsToReview")}</h2>
          <p>{t("recommendationsToReviewBody")}</p>
          {reviewReports.map((r) => (
            <p key={r.reportId}>
              <button onClick={() => setReviewReport(r.reportId)}>
                {t(r.count === 1 ? "reviewRecommendationsOne" : "reviewRecommendationsMany", { count: r.count, from: r.from })}
              </button>
            </p>
          ))}
        </section>
      )}
      {error && (
        <p role="alert">
          {t(error)}{" "}
          <button onClick={() => setReload((n) => n + 1)}>{t("refresh")}</button>
        </p>
      )}
      {!items && !error && <p>{t("loading")}</p>}
      {items && !shown.length && (
        <section className={styles.empty}>
          <h2>{items.length ? t("noActive") : t("noActionsYet")}</h2>
          {items.length ? (
            <>
              <p>{t("pausedKept")}</p>
              <button onClick={() => setFilter("all")}>{t("viewAll")}</button>
            </>
          ) : (
            <p>{t("emptyBody")}</p>
          )}
        </section>
      )}
      {!!unlinked.length && <details className={styles.demoEntry}>
        <summary>{t("awaitingReview", { count: unlinked.length })}</summary>
        <p>{t("awaitingReviewBody")}</p>
      <div className={styles.list}>
        {unlinked.map((a) => (
          <article key={a.id} className={styles.action}>
            <div className={styles.meta}>
              <span data-priority={a.priority.level}>
                {priorityLabel(a.priority.level)}
              </span>
              <span>
                {a.visibility === "project"
                  ? t("sharedWithProject")
                  : t("onlyYou")}
              </span>
            </div>
            <h2>{operatingHoursWording(a.title)}</h2>
            <p>{operatingHoursWording(a.recommendation)}</p>
            <div className={styles.next}>
              <strong>{listStateLabel(a.state)}</strong>
              <span>
                {a.state === "implemented"
                  ? t("nextImplemented")
                  : t("nextOther")}
              </span>
            </div>
            <footer>
              {a.canDemonstrate && a.visibility === "project" && <button disabled={!!linking} onClick={() => setLinking(a)}>{t("linkToFinding")}</button>}
              <button
                className={styles.primaryButton}
                onClick={() => setDetail(a)}
              >
                {t("reviewAction")}
              </button>
              {a.canPrioritise && (
                <button
                  onClick={() => {
                    setEditing(a);
                    setLevel(a.priority.level);
                    setReason(a.priority.reason);
                  }}
                >
                  {t("setPriority")}
                </button>
              )}
              <span>
                {t(a.sources.length === 1 ? "sourceReportsOne" : "sourceReportsMany", { count: a.sources.length })}
              </span>
            </footer>
            <details>
              <summary>{t("whyPriority")}</summary>
              {/* The service stores this English placeholder until someone sets a priority. */}
              <p>{a.priority.reason === "Not yet prioritised" ? t("notYetPrioritised") : a.priority.reason}</p>
            </details>
          </article>
        ))}
      </div>
      </details>}
      {linking && <ActionFindingEditor key={`${projectId}:${linking.id}`} projectId={projectId} action={linking} findings={insights} onCancel={() => setLinking(null)} onSaved={() => { setLinking(null); setInsightReload(n => n + 1); setReload(n => n + 1); }} />}
      {editing && (
        <section className={styles.editor} aria-label={t("editPriority")}>
          <h2>{t("priorityHeading", { title: editing.title })}</h2>
          <div className={styles.filters}>
            {(["high", "medium", "low"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={level === v}
                onClick={() => setLevel(v)}
              >
                {t(`level.${v}`)}
              </button>
            ))}
          </div>
          <label>
            {t("whyMatters")}
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={busy || !reason.trim()} onClick={save}>
            {busy ? t("saving") : t("savePriority")}
          </button>
          <button disabled={busy} onClick={() => setEditing(null)}>
            {t("cancel")}
          </button>
        </section>
      )}
    </main>
  );
}

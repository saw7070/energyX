"use client";

import { useEffect, useRef, useState } from "react";
import { ReportRunProgress } from "./report-run-progress";
import { EnergyIcon } from "./icons";
import { EnergySelect } from "./energy-select";
import Link from "next/link";
import { formatPeriod, shiftDate, presetPeriod, initialReportPeriod, type PeriodOptions, type PeriodPreset } from "./report-period";
import { configApi, type EnergyProjectSetupDto } from "../../../lib/config-api";
import { ProjectConfigurationSummary } from "./project-configuration-summary";
import { ReportFilePreview, ReportMarkdown, type PreviewFile } from "./report-file-preview";
import { type ReportLibrary, artifactFile, reportFile } from "./report-library";
import { ReportSkillUsage, ReportSkillSelector, ReportSkillVersionDialog, type ReportSkillOption, type SkillSelection } from "./report-skill-controls";
import styles from "./report-workbench.module.css";
import { ReportThumbnail } from "./report-thumbnail";
import { useEnergyIqAccess } from "./energyiq-access";
import { composerDraftKey, readComposerDraft, writeComposerDraft } from "./report-composer-draft";
import { OPEN_REPORT } from "./report-navigation";
import { notifyReportSessionsChanged } from "./report-session-navigation";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { advisorMessages, type AdvisorMessageKey, type AdvisorTranslate } from "./report-agent-panel-messages";
import { ADVISOR_EXAMPLE_PROMPTS, ADVISOR_STARTER_PROMPTS } from "./advisor-starter-prompts";
import { dateLocale, fillTemplate } from "./report-library-messages";

type Period = { from: string; toExclusive: string };
type Settings = {
  contextNotes: string; fileRefIds: string[]; useProjectData: boolean; skill: string; revision: number;
  skillSourceRunId?: string; comparisonPeriod?: Period;
  schedulePermissionIssue?: string;
  frequency: "off" | "daily" | "weekly" | "monthly" | "weekly-monthly"; localHour: number; scheduledPrompt: string; timezone: string;
};
type Run = { skillUsage?: Array<{ id: string; version: string; name: string; source: string; contentHash: string }>; hasReport?: boolean; hasSkillDraft?: boolean; id: string; sessionId?: string; status: string; kind: "report" | "skill" | "chat"; prompt: string; answer?: string; errorCode?: string; createdAt: string; period: Period };
type Session = { id: string; createdAt: string };
type Event = { text?: string; sequence: number; time: string; type: string; tool?: string; isError?: boolean };
type ProjectData = { status: "connected" | "not_configured" | "unavailable"; actualLastIntervalEnd: string | null; reason?: string | null };
type Overview = { canChat?: boolean; canManageProject?: boolean; skills?: ReportSkillOption[]; projectData?: ProjectData; periodOptions?: PeriodOptions; dataSummary?: { runId: string; dataSnapshotId: string; rows: number; actualLastIntervalEnd: string | null } | null; settings: Settings; runs: Run[]; sessions?: Session[]; files: Array<{ id: string; filename: string; bytes: number }> };
const inputClass = "w-full rounded-lg border border-border bg-surface p-2 text-base";
const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";
const active = (run: Run) => ["queued", "running"].includes(run.status);

type PanelProps = { referenceReportId?: string; settingsMode?: "project" | "automation"; configurationFocus?: string; initialConfigure?: boolean; projectId: string; initialSessionId?: string; sidebarNavigation?: boolean; onSessionChange?: (sessionId: string) => void };
export function ReportAgentPanel(props: PanelProps) {
  const { access, activeProject } = useEnergyIqAccess();
  const [configurationProject, setConfigurationProject] = useState<string | null>(props.initialConfigure ? props.projectId : null);
  return <ProjectReportPanel key={JSON.stringify([access?.user?.id, access?.activeWorkspaceId, props.projectId, props.initialSessionId ?? "auto", props.initialConfigure, props.configurationFocus])} {...props} configurationEnabled={configurationProject === props.projectId} onConfigure={() => setConfigurationProject(props.projectId)} />;
}
function ProjectReportPanel({ referenceReportId, settingsMode, configurationFocus, initialConfigure = false, projectId, initialSessionId, sidebarNavigation = false, onSessionChange, configurationEnabled, onConfigure }: PanelProps & { configurationEnabled: boolean; onConfigure: () => void }) {  const [overview, setOverview] = useState<Overview | null>(null);
  const { access, activeProject } = useEnergyIqAccess();
  const t = useMessages(advisorMessages);
  const { locale } = useEnergyIqLocale();
  const draftScope = access?.user?.id ? [access.user.id, access.activeWorkspaceId] : null;
  const draftKey = (id: string) => draftScope ? composerDraftKey(draftScope[0]!, draftScope[1]!, projectId, id, initialConfigure ? configurationFocus : "") : null;
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const savedSettings = useRef<Settings | null>(null);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("recent");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [messageFiles, setMessageFiles] = useState<string[] | null>(null);
  const attachedIds = messageFiles ?? settings?.fileRefIds ?? [];
  const [settingsConflict, setSettingsConflict] = useState<Settings | null>(null);
  useEffect(() => {
    const latest = overview?.settings;
    if (!latest || !savedSettings.current || latest.revision <= savedSettings.current.revision) return;
    if (JSON.stringify(settings) === JSON.stringify(savedSettings.current)) {
      savedSettings.current = latest; setSettings(latest); setSettingsConflict(null);
    } else setSettingsConflict(latest);
  }, [overview?.settings, settings]);
  const [tab, setTab] = useState<"create" | "library" | "settings">(settingsMode ? "settings" : "create");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(initialConfigure ? ({initialize:"Help me set up this project using the data and documents I attach. Check the current setup, identify the meters, locations, units and dates, and ask me to confirm anything missing. Import, map and publish when supported by the evidence. Clearly distinguish completed steps from pending work; ask about missing information and never claim success without confirmation.",structure:"Help me review and update the project spaces and hierarchy. Read the current setup first, then ask what I want to change. Save requested changes as a draft.",meters:"Help me review and update meter names, assignments and calculations. Read the current setup first and ask which meters I want to change.",context:"Help me organise and save project background information from my documents. Read existing project notes first and preserve useful information.",calendar:"Help me configure operating hours and any relevant calendar exceptions or school term dates. Read existing policies and ask for missing details. Save changes for review without activating them.",tariff:"Help me configure the electricity tariff using the bill or rate I provide. Read existing policies and ask for missing currency, tax and effective date details. Save for review without activation."} as Record<string,string>)[configurationFocus ?? ""] ?? "Review this project configuration and help me update its structure, meter mapping or project information. Save requested changes as a draft and explain what changed." : "");
  const promptInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = promptInput.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight,200)}px`; } }, [prompt, !!settings, tab]);
  const [configuration, setConfiguration] = useState<EnergyProjectSetupDto | null>(null);
  const [configurationError, setConfigurationError] = useState("");
  const [configurationRefresh, setConfigurationRefresh] = useState(0);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [parentId, setParentId] = useState("");
  const [output, setOutput] = useState("");
  const [skillSelection, setSkillSelection] = useState<SkillSelection>({ mode: "default", refs: [] });
  const [skillDraft, setSkillDraft] = useState<{ content: string; runId: string } | null>(null);
  useEffect(() => { setSkillSelection({ mode: "default", refs: [] }); setSkillDraft(null); }, [projectId]);
  const [statusConnectionLost, setStatusConnectionLost] = useState(false);
  const [activityConnectionLost, setActivityConnectionLost] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const selected = overview?.runs.find((run) => run.id === selectedId);
  const hasBackgroundWork = overview?.runs.some(active) ?? false;
  const conversation = (overview?.runs ?? []).filter((run) => run.sessionId === sessionId && sessionId).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const activeConversationRun = conversation.find(active);
  const pending = !!activeConversationRun;
  const completedConversation = conversation.filter(run => !active(run)).map(run => `${run.id}:${run.status}`).join("|");
  useEffect(() => {
    if (!configurationEnabled || !overview?.canManageProject) return;
    let cancelled = false;
    setConfiguration(null); setConfigurationError("");
    configApi.getEnergyProjectSetup(projectId).then(data => { if (!cancelled) setConfiguration(data); }).catch(reason => { if (!cancelled) setConfigurationError(message(reason, t("operationFailed"))); });
    return () => { cancelled = true; };
  }, [projectId, configurationEnabled, !!overview, completedConversation, configurationRefresh]);
  function configureProject() {
    const suggestion = "Review this project's current configuration and identify what needs updating. Help me edit and save a draft; clearly distinguish draft changes from the published configuration.";
    setPrompt(current => current.trim() ? `${current}\n\n${suggestion}` : suggestion);
    setTab("create"); onConfigure();
    requestAnimationFrame(() => promptInput.current?.focus());
  }
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  function scrollToLatest() { const el = messagesRef.current; if (el) el.scrollTop = el.scrollHeight; followLatest.current = true; setAwayFromLatest(false); }
  const latestAnswerProgress = events.findLast(event => event.type === "answer_progress")?.text;
  useEffect(() => { if (followLatest.current) scrollToLatest(); }, [conversation.length, completedConversation, latestAnswerProgress]);
  useEffect(() => { scrollToLatest(); }, [sessionId]);
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [library, setLibrary] = useState<ReportLibrary | null>(null);
  useEffect(() => { const controller = new AbortController(); configApi.reportLibraryRequest<ReportLibrary>(projectId, "", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setLibrary(data); }).catch(() => {}); return () => controller.abort(); }, [projectId, overview?.runs.filter(run => run.status === "succeeded").length]);
  const isReport = (run: Run) => run.kind === "report" || run.hasReport || library?.reports.some(item=>item.id === run.id);
  const skillSource = conversation.filter(run=>run.status === "succeeded" && run.kind !== "skill").at(-1);
  const request = <T,>(path = "", init?: RequestInit) => configApi.reportAgentRequest<T>(projectId, path, init);
  const refresh = async () => { const data = await request<Overview>(); setOverview(data); return data; };

  useEffect(() => {
    const controller = new AbortController();
    configApi.reportAgentRequest<Overview>(projectId, "", { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setOverview(data); setSettings(data.settings); savedSettings.current = data.settings;
      const latest = initialSessionId === "new" ? undefined : initialSessionId ? data.runs.find((run) => run.sessionId === initialSessionId) : data.runs[0];
      if (initialSessionId && initialSessionId !== "new" && !data.sessions?.some((session) => session.id === initialSessionId)) setError(t("conversationUnavailable"));
      const resolvedSession = initialSessionId === "new" ? "" : initialSessionId ?? latest?.sessionId ?? data.sessions?.[0]?.id ?? "";
      setSessionId(resolvedSession);
      if (latest) { setSelectedId(latest.id); setFrom(latest.period.from); setTo(shiftDate(latest.period.toExclusive,-1)); setPeriodPreset("custom"); } else if (data.periodOptions) { const initial = initialReportPeriod(data.periodOptions); setFrom(initial.period.from); setTo(shiftDate(initial.period.toExclusive,-1)); setPeriodPreset(initial.preset); }
      restoreDraft(resolvedSession);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason, t("operationFailed"))); });
    return () => controller.abort();
  }, [projectId]);

  function restoreDraft(id: string) {
    const key = draftKey(id);
    const draft = key ? readComposerDraft(key) : null;
    setLoadedDraftKey(key);
    if (draft) { setMessageFiles(draft.fileRefIds ?? null); setPrompt(draft.prompt); setFrom(draft.from); setTo(draft.to); setPeriodPreset(draft.periodPreset as PeriodPreset); setParentId(draft.parentId); }
  }
  useEffect(() => {
    if (!loadedDraftKey) return;
    writeComposerDraft(loadedDraftKey, prompt || messageFiles !== null ? { prompt, from, to, periodPreset, parentId, fileRefIds: messageFiles } : null);
  }, [loadedDraftKey, prompt, from, to, periodPreset, parentId, messageFiles]);

  useEffect(() => {
    if (!hasBackgroundWork) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const data = await configApi.reportAgentRequest<Overview>(projectId, "", { signal: controller.signal }); if (!controller.signal.aborted) { setOverview(data); setStatusConnectionLost(false); } }
      catch { if (!controller.signal.aborted) setStatusConnectionLost(true); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000); }
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, hasBackgroundWork]);

  useEffect(() => {
    setOutput("");
    if (!selectedId || selected?.status !== "succeeded" || (selected.kind === "chat" && !isReport(selected))) return;
    const controller = new AbortController();
    configApi.reportAgentRequest<{ content: string }>(projectId, `output/${selectedId}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setOutput(data.content); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason, t("operationFailed"))); });
    return () => controller.abort();
  }, [projectId, selectedId, selected?.status, selected?.hasReport, library?.reports.length]);

  useEffect(() => {
    setEvents([]);
    if (!selectedId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let after = 0;
    const poll = async () => {
      try {
        const data = await configApi.reportAgentRequest<{ events: Event[] }>(projectId, `runs/${selectedId}/events?after=${after}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setActivityConnectionLost(false);
        if (data.events.length) {
          after = data.events.at(-1)!.sequence;
          setEvents((current) => [...current, ...data.events].slice(-200));
        }
        if (data.events.length === 200 || ["queued", "running"].includes(selected?.status ?? "")) timer = setTimeout(() => void poll(), data.events.length === 200 ? 0 : selected?.status === "running" ? 400 : 2000);
      } catch { if (!controller.signal.aborted) { setActivityConnectionLost(true); timer = setTimeout(() => void poll(), 3000); } }
    };
    void poll();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, selectedId, selected?.status]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { setError(message(reason, t("operationFailed"))); } finally { setBusy(false); }
  }
  async function save(next = settings) {
    if (!overview?.canManageProject) throw new Error(t("adminOnlySettings"));
    if (!next) throw new Error(t("loadSettingsFirst"));
    if (settingsConflict) throw new Error(t("settingsChangedOnServer"));
    if (savedSettings.current?.revision && JSON.stringify(next) === JSON.stringify(savedSettings.current)) return next;
    const saved = await request<Settings>("settings", { method: "PUT", body: JSON.stringify(next) });
    setSettings(saved); savedSettings.current = saved; return saved;
  }
  async function generate(kind: "skill" | "chat", source = selected) {
    if (!settings?.revision && overview?.canManageProject) await save();
    const period = kind === "skill" && source ? source.period : { from, toExclusive: shiftDate(to,1) };
    if ((kind !== "chat" || from || to) && (!period.from || !period.toExclusive || period.from >= period.toExclusive)) throw new Error(t("endAfterStart"));
    if (parentId && library?.reports.find(item=>item.id===parentId)?.canDiscuss === false) throw new Error(t("privateConversation"));
    const parent = kind === "skill" ? source && isReport(source) ? source.id : "" : parentId;
    const result = await request<{ id: string }>("runs", { method: "POST", body: JSON.stringify({ kind, skillSelection, fileRefIds: attachedIds, ...(kind !== "skill" && periodPreset === "all" ? { periodPreset: "all" } : kind !== "chat" || (period.from && period.toExclusive && period.from < period.toExclusive) ? { period } : {}),
      prompt: kind === "skill" ? `Revise the existing reusable English project analysis Skill using this conversation, report findings and explicit feedback. Prefer updating its existing purpose over creating another Skill. Keep only supported reusable improvements, list changed rules and evidence in your response, and write a reviewable candidate without activating it. ${skillSelection.mode === "selected" ? "Use the explicitly selected methods as revision targets." : "Use the current project methods as revision targets."}` : prompt,
      ...((kind === "skill" ? source?.sessionId : sessionId) ? { sessionId: kind === "skill" ? source?.sessionId : sessionId } : {}), ...(parent ? { parentRunId: parent } : {}),
    }) });
    if (kind === "chat") {
      if (loadedDraftKey) writeComposerDraft(loadedDraftKey, null);
      setLoadedDraftKey(null); setMessageFiles(null); setPrompt("");
    }
    const data = await refresh();
    const nextSessionId = data.runs.find((run) => run.id === result.id)?.sessionId ?? sessionId;
    setSelectedId(result.id); if (kind === "chat") setSessionId(nextSessionId);
    notifyReportSessionsChanged(projectId);
    if (kind === "chat" && nextSessionId && nextSessionId !== initialSessionId) onSessionChange?.(nextSessionId);
    if (kind === "chat") setLoadedDraftKey(draftKey(nextSessionId)); setNotice(t("taskSaved"));
  }
  function chooseSession(id: string) {
    setMessageFiles(null); setFile(null); setSessionId(id); setParentId(""); setPrompt(""); onSessionChange?.(id || "new");
    const latest = overview?.runs.find((run) => run.sessionId === id);
    setSelectedId(latest?.id ?? "");
    if (latest) { setFrom(latest.period.from); setTo(shiftDate(latest.period.toExclusive,-1)); setPeriodPreset("custom"); } else { const initial = overview?.periodOptions ? initialReportPeriod(overview.periodOptions) : null; setFrom(initial?.period.from ?? ""); setTo(shiftDate(initial?.period.toExclusive ?? "",-1)); setPeriodPreset(initial?.preset ?? "recent"); }
    restoreDraft(id);
  }
  useEffect(() => { const open=(event: globalThis.Event)=>{const detail=(event as CustomEvent<{projectId:string;reportId:string}>).detail;if(detail?.projectId!==projectId)return;const report=library?.reports.find(item=>item.id===detail.reportId);if(report)setFile(reportFile(projectId,report,locale));};window.addEventListener(OPEN_REPORT,open);return()=>window.removeEventListener(OPEN_REPORT,open);},[library,projectId]);
  const appliedReference = useRef<string | null>(null);
  useEffect(()=>{if(!overview || !loadedDraftKey || !referenceReportId || appliedReference.current===referenceReportId)return;const report=library?.reports.find(item=>item.id===referenceReportId);if(report && library?.canChat && report.canDiscuss === false){appliedReference.current=referenceReportId;setFile(reportFile(projectId,report,locale));setNotice(t("sharedFromAnotherAuthor"));return;}if(report && library?.canChat && report.canDiscuss !== false){appliedReference.current=referenceReportId;setParentId(report.id);setFrom(report.period.from);setTo(shiftDate(report.period.toExclusive,-1));setPeriodPreset("custom");setFile(reportFile(projectId,report,locale));}},[referenceReportId,library,projectId,overview,loadedDraftKey]);
  function continueReport(run: Run) {
    chooseSession(run.sessionId ?? ""); setSelectedId(run.id); setParentId(run.id);
    setFrom(run.period.from); setTo(shiftDate(run.period.toExclusive,-1)); setPeriodPreset("custom"); setTab("create");
    setNotice(t("continueWithReport"));
  }
  function uploadInput(file: File) { return action(async()=>{const data=new FormData();data.set("file",file);const uploaded=await request<{id:string}>("inputs",{method:"POST",body:data});if (settingsMode) setSettings(current=>current?{...current,fileRefIds:[...current.fileRefIds,uploaded.id]}:current); else setMessageFiles([...attachedIds,uploaded.id]);await refresh();setNotice(t("fileAttached"));}); }
  function openSkillDraft(run: Run) { setFile({id:`${run.id}:skill`,title:"project-skill.md",mimeType:"text/markdown",load:signal=>configApi.reportAgentRequest(projectId,run.kind === "skill" ? `output/${run.id}` : `draft-skill/${run.id}`,{signal})}); }
  function openRun(run: Run) {
    setSelectedId(run.id);
    const report = library?.reports.find(item => item.id === run.id);
    setFile({ id: run.id, title: run.kind === "skill" ? "project-skill.md" : `${report?.title ?? t("reportFallbackTitle", { date: run.period.from })} · v${report?.version ?? 1}`, filename: run.kind === "skill" ? "project-skill.md" : `report-${run.period.from}-${run.id.slice(-8)}.html`, mimeType: run.kind === "skill" ? "text/markdown" : "text/html", load: signal => configApi.reportAgentRequest(projectId, `output/${run.id}`, { signal }) });
  }
  return <div className={`${styles.workbench} ${styles.chatWorkbench} ${file ? styles.withPreview : ""}`}>
    <div className={styles.center}>
      <header className={styles.header} hidden={!!settingsMode}>
        <div className={styles.headerTitle}>
          <span className={styles.headerMark} aria-hidden="true"><EnergyIcon name="ask" /></span>
          <div>
            <h1>{t("energyAdvisor")}</h1>
            <div className={styles.headerMeta}>
              <span>{activeProject?.name ?? t("selectedProject")}</span>
              <section aria-label={t("projectData")} className={styles.dataStatus} data-status={!overview ? "checking" : overview.projectData?.status ?? "unknown"}>
                <span className="sr-only">{t("projectDataPrefix")}</span><i aria-hidden="true" />
                <span>{!overview ? error ? t("statusUnavailable") : t("checkingConnection") : overview.projectData?.status === "connected" ? t("connected") : overview.projectData?.status === "not_configured" ? t("setupRequired") : t("statusUnavailable")}</span>
                {overview?.projectData?.actualLastIntervalEnd && overview.projectData.status === "connected" ? <span>{t("latestReading", { time: new Date(overview.projectData.actualLastIntervalEnd).toLocaleString(dateLocale(locale),{timeZone:"Asia/Singapore",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) })}</span> : overview?.projectData?.reason ? <span>· {overview.projectData.reason}</span> : overview?.projectData?.status === "connected" ? <span>{t("latestReadingUnavailable")}</span> : null}
                {overview?.projectData?.status === "connected" && settings?.useProjectData === false && <span className={styles.dataWarning}>{t("meterDataExcluded")}</span>}
              </section>
            </div>
          </div>
        </div>
        <div className={styles.headerActions} hidden={sidebarNavigation || !!settingsMode}>
          <div className={styles.segmented} role="group" aria-label={t("advisorViews")}>
            <button aria-pressed={tab === "create"} onClick={() => setTab("create")}>{t("chat")}</button>
            {!sidebarNavigation && <button aria-pressed={tab === "library"} onClick={() => setTab("library")}>{t("reportLibrary")}</button>}
            {overview?.canManageProject && <button aria-pressed={tab === "settings"} onClick={() => setTab("settings")}>{t("reportPreferences")}</button>}
          </div>
          {overview?.canManageProject && <button className={styles.headerButton} onClick={configureProject}>{t("configureProject")}</button>}
        </div>
      </header>
      {configurationEnabled && overview?.canManageProject && <section aria-label={t("facilityStatus")} className={styles.projectData}><div><strong>{t("facility")}</strong><button className="text-xs underline" onClick={() => setConfigurationRefresh(value => value + 1)}>{t("refreshStatus")}</button></div>{configurationError ? <p role="alert">{t("configurationUnavailable", { error: configurationError })}</p> : !configuration ? <p role="status">{t("checkingConfiguration")}</p> : <><p>{configuration.project.status === "published" ? configuration.project.has_unpublished_changes ? t("publishedWithDraft") : t("publishedClean") : t("draftUnpublished")}</p><p>{t("draftRevision", { revision: configuration.draft.revision, time: new Date(configuration.draft.updated_at).toLocaleString(dateLocale(locale), { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</p><ProjectConfigurationSummary setup={configuration} contextNotes={overview?.settings.contextNotes} /></>}</section>}
      {settingsConflict && <section role="alert" className={styles.banner}><p>{t("settingsConflict")}</p><button className="mt-1 underline" onClick={() => { savedSettings.current = settingsConflict; setSettings(settingsConflict); setSettingsConflict(null); setError(""); }}>{t("discardLocal")}</button></section>}
      {skillDraft && <ReportSkillVersionDialog canManageProject={overview?.canManageProject === true} projectId={projectId} skills={overview?.skills ?? []} content={skillDraft.content} sourceRunId={skillDraft.runId} onClose={()=>setSkillDraft(null)} onSaved={()=>void refresh()} />}
      {error && <p role="alert" className={styles.banner}>{error}</p>}{notice && <p role="status" className={styles.banner}>{notice}</p>}
      {!settings ? <p className={styles.banner}>{error ? t("settingsUnavailable") : t("loadingSettings")}</p> : <>
      {tab === "settings" && overview?.canManageProject && <section className={styles.settings} aria-label={t("reportPreferences")}>
        <h2 className="text-xl font-semibold">{settingsMode === "project" ? t("projectBackground") : settingsMode === "automation" ? t("automaticReports") : t("reportPreferences")}</h2><p className="mt-2 text-sm text-muted">{settingsMode === "automation" ? t("automationIntro") : t("preferencesIntro")}</p>
        {settingsMode !== "automation" && <><section className={styles.setupGroup}><h3>{t("projectContext")}</h3><p>{t("projectContextIntro")}</p>
          <label className="block">{t("buildingContext")}<textarea className={inputClass} rows={4} value={settings.contextNotes} onChange={e => setSettings({...settings,contextNotes:e.target.value})} placeholder={t("buildingContextPlaceholder")} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={settings.useProjectData} onChange={e=>setSettings({...settings,useProjectData:e.target.checked})} />{t("includeMeterData")}</label><p>{t("includeMeterDataHint")}</p>
          <details><summary>{t("advancedCompare")}</summary><div className="mt-3 space-y-3"><label className="flex items-center gap-2"><input type="checkbox" checked={!!settings.comparisonPeriod} onChange={e=>{const next={...settings}; if(e.target.checked) next.comparisonPeriod={from:"",toExclusive:""}; else delete next.comparisonPeriod; setSettings(next);}} />{t("addComparison")}</label>{settings.comparisonPeriod && <div className={styles.period}><label>{t("from")}<input aria-label={t("comparisonStart")} type="date" value={settings.comparisonPeriod.from} onChange={e=>setSettings({...settings,comparisonPeriod:{...settings.comparisonPeriod!,from:e.target.value}})} /></label><label>{t("through")}<input aria-label={t("comparisonEnd")} type="date" value={shiftDate(settings.comparisonPeriod.toExclusive,-1)} onChange={e=>setSettings({...settings,comparisonPeriod:{...settings.comparisonPeriod!,toExclusive:shiftDate(e.target.value,1)}})} /></label></div>}<p>{t("comparisonHint")}</p></div></details>
        </section>
        <section className={styles.setupGroup}><h3>{t("defaultDocuments")}</h3><p>{t("defaultDocumentsIntro")}</p>
          {overview?.files.map(file=><label key={file.id} className="flex items-start gap-2"><input type="checkbox" checked={settings.fileRefIds.includes(file.id)} onChange={e=>setSettings({...settings,fileRefIds:e.target.checked?[...settings.fileRefIds,file.id]:settings.fileRefIds.filter(id=>id!==file.id)})} /><span className="break-all">{file.filename}</span></label>)}
          <input aria-label={t("uploadInput")} type="file" accept=".csv,.xlsx,.pptx,.pdf,.md,.txt,.json,.parquet" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;void uploadInput(file);e.target.value="";}} />
        </section>
        </>}{settingsMode !== "project" && <section className={styles.setupGroup}><h3>{t("scheduleHeading")}</h3>{settings.schedulePermissionIssue && <p role="status">{settings.schedulePermissionIssue}</p>}<p>{t("scheduleIntro")}</p><div className="flex flex-wrap gap-4"><div><span className={styles.fieldLabel}>{t("frequency")}</span><EnergySelect ariaLabel={t("reportFrequency")} value={settings.frequency} onValueChange={value=>setSettings({...settings,frequency:value as Settings["frequency"]})} options={([["off","frequencyOff"],["daily","frequencyDaily"],["weekly","frequencyWeekly"],["monthly","frequencyMonthly"],["weekly-monthly","frequencyWeeklyMonthly"]] as const).map(([value,key])=>({value,label:t(key)}))} /></div><label>{t("runHour", { timezone: settings.timezone })}<input className={inputClass} type="number" min={0} max={23} value={settings.localHour} onChange={e=>setSettings({...settings,localHour:Number(e.target.value)})} /></label></div><label className="block">{t("reportInstructions")}<textarea className={inputClass} rows={3} value={settings.scheduledPrompt} onChange={e=>setSettings({...settings,scheduledPrompt:e.target.value})} placeholder={t("scheduledPlaceholder")} /></label><p>{fillTemplate(t("skillSupplies"), { link: <Link className="underline" href={`/energyiq/skills?${new URLSearchParams({projectId})}`}>{t("reviewSkills")}</Link> })}</p></section>}
        <button className={styles.primaryAction} disabled={busy} onClick={()=>void action(async()=>{await save();setNotice(t("preferencesSaved"));})}>{settingsMode === "project" ? t("saveProjectBackground") : settingsMode === "automation" ? t("saveSchedule") : t("savePreferences")}</button>
      </section>}

      {tab === "library" && <div className={styles.settings}><h2>{t("historyHeading")}</h2>{overview?.runs.map(run => <button key={run.id} className={styles.fileCard} onClick={() => { chooseSession(run.sessionId ?? ""); setTab("create"); if (run.status === "succeeded" && (run.kind === "skill" || isReport(run))) openRun(run); }}><strong>{run.period.from} · {run.kind === "report" ? t("kindReport") : run.kind === "skill" ? t("kindSkill") : run.kind === "chat" ? t("kindChat") : run.kind}</strong><span>{statusLabel(run.status, t)} · {new Date(run.createdAt).toLocaleString(dateLocale(locale),{timeZone:"Asia/Singapore",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} SGT</span></button>)}</div>}
      {tab === "create" && <>
        {!sidebarNavigation && <div className={styles.conversationBar}><EnergySelect ariaLabel={t("conversation")} className={styles.conversationSelect} size="small" value={sessionId} onValueChange={chooseSession} options={[...(overview?.canChat ? [{value:"",label:t("newConversation")}] : []),...(overview?.sessions ?? []).map(session=>{const first=overview?.runs.filter(run=>run.sessionId===session.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]?.prompt.trim().replace(/\s+/g," ");const when=new Date(session.createdAt).toLocaleString(dateLocale(locale),{timeZone:"Asia/Singapore",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" SGT";return {value:session.id,label:first?`${first.length>60?`${first.slice(0,57)}…`:first} · ${when}`:when};})]} />{overview?.canChat && sessionId && <button type="button" className={styles.newConversation} onClick={() => chooseSession("")}><EnergyIcon name="plus" />{t("newConversation")}</button>}</div>}
        <div ref={messagesRef} aria-label={t("conversationHistory")} className={styles.messages} onScroll={() => { const el = messagesRef.current; if (!el) return; const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80; followLatest.current = !away; setAwayFromLatest(away); }}>
          {!conversation.length && overview?.canChat && <div className={styles.welcome}>{initialConfigure && configurationFocus === "initialize" ? <section className={styles.initializationIntro}><h2>{t("setupHeading")}</h2><p>{t("setupIntro")}</p><button onClick={()=>attachmentInput.current?.click()}><EnergyIcon name="attach" />{t("addProjectFiles")}</button><small>{t("setupNote")}</small></section> : <><span className={styles.welcomeMark} aria-hidden="true"><EnergyIcon name="bolt" /></span><h2>{t("welcomeHeading")}</h2><p>{t("welcomeIntro", { project: activeProject?.name ?? t("thisProject") })}</p><div className={styles.starterGrid}>{/* Labels follow the reader's language; the prompt placed in the message box is sent to the advisor as written. */}{([{ icon: "analysis", label: t("starterConsumption"), hint: t("starterConsumptionHint"), prompt: ADVISOR_STARTER_PROMPTS.consumption }, { icon: "search", label: t("starterLoads"), hint: t("starterLoadsHint"), prompt: ADVISOR_STARTER_PROMPTS.loads }, { icon: "document", label: t("starterReport"), hint: t("starterReportHint"), prompt: ADVISOR_STARTER_PROMPTS.report }] as const).map(item => <button key={item.label} aria-label={item.label} onClick={() => { setPrompt(item.prompt); promptInput.current?.focus(); }}><span className={styles.starterIcon}><EnergyIcon name={item.icon} /></span><strong>{item.label}</strong><small>{item.hint}</small></button>)}</div><section className={styles.tips} aria-label={t("tipsHeading")}><h3>{t("tipsHeading")}</h3><ul>{([["tipDecideTitle","tipDecide"],["tipDatesTitle","tipDates"],["tipMoneyTitle","tipMoney"]] as const).map(([title,body])=><li key={title}><strong>{t(title)}</strong>{t(body)}</li>)}</ul><p>{t("tipExamples")}</p><div className={styles.tipExamples}>{/* Labels follow the reader's language; the prompt placed in the message box is sent to the advisor as written. */}{([{ label: t("exampleOverview"), prompt: ADVISOR_EXAMPLE_PROMPTS.overview }, { label: t("exampleAfterHours"), prompt: ADVISOR_EXAMPLE_PROMPTS.afterHours }, { label: t("exampleCompare"), prompt: ADVISOR_EXAMPLE_PROMPTS.compare }] as const).map(item => <button key={item.label} onClick={() => { setPrompt(item.prompt); promptInput.current?.focus(); }}>{item.label}</button>)}</div></section></>}{!!library?.reports.length && <details className={styles.recentReports} aria-label={t("recentToExplore")}><summary>{t("continueRecent")}</summary><header><Link href={`/energyiq/library?${new URLSearchParams({projectId})}`}>{t("viewAll")}</Link></header><div>{library.reports.slice().sort((a,b)=>(b.finishedAt || b.createdAt).localeCompare(a.finishedAt || a.createdAt)).slice(0,3).map(report=><button key={report.id} aria-label={t("previewNamed", { title: report.title })} onClick={()=>setFile(reportFile(projectId,report,locale))}><ReportThumbnail file={reportFile(projectId,report,locale)} /><strong>{report.title}</strong><small>{report.period.from} → {shiftDate(report.period.toExclusive,-1)}</small></button>)}</div></details>}</div>}
          {conversation.map(run => <article key={run.id} className={styles.turn}>
            <div className={styles.user}><span className="sr-only">{t("you")}</span>{run.prompt.length > 600 ? <details className={styles.longPrompt}><summary>{run.prompt.slice(0,240)}…<span>{t("showFullMessage")}</span></summary><p>{run.prompt}</p></details> : run.prompt}</div>
            <div className={styles.reply}><ReportRunProgress run={run} phase={runActivityLabel(run, selectedId === run.id ? events : [], t)} lastActivityAt={selectedId === run.id ? events.at(-1)?.time : undefined} connectionLost={statusConnectionLost || (selectedId === run.id && activityConnectionLost)} />
              <details className={styles.execution} onToggle={event => { if (event.currentTarget.open) setSelectedId(run.id); }}><summary><EnergyIcon name={active(run) ? "spark" : run.status === "succeeded" ? "check" : "alert"} /><span>{runActivityLabel(run, selectedId === run.id ? events : [], t)}</span><span className={styles.executionHint}>{t("activityDetails")}</span><EnergyIcon name="chevron" /></summary><div className={styles.executionBody}><p className={styles.muted}>{run.period.from} → {shiftDate(run.period.toExclusive,-1)}</p>{selectedId === run.id ? events.some(event=>event.type !== "answer_progress") ? <ol>{events.filter(event=>event.type !== "answer_progress").map(event => <li key={event.sequence}><EnergyIcon name={event.isError ? "alert" : event.tool ? "code" : "check"} /><span>{activityLabel(event.type, t) ?? event.tool ?? event.type}<small>{event.type}{event.isError ? ` · ${t("statusFailed")}` : ""}</small></span><time>{new Date(event.time).toLocaleTimeString(dateLocale(locale), {timeZone:"Asia/Singapore"})}</time></li>)}</ol> : <p className={styles.muted}>{t("noActivity")}</p> : <p className={styles.muted}>{t("selectToLoad")}</p>}{!!run.skillUsage?.length && <ReportSkillUsage skills={run.skillUsage} prepared={selectedId === run.id && events.some(event => event.type === "skill_inputs_prepared")} />}</div></details>
<span className="sr-only">{t("assistant")}</span>
              {visibleAnswer(run, selectedId === run.id ? events : []) && <div className={styles.answer} tabIndex={0} aria-label={t("advisorResponse")}><ReportMarkdown>{visibleAnswer(run, selectedId === run.id ? events : [])}</ReportMarkdown></div>}
              {active(run) && visibleAnswer(run, selectedId === run.id ? events : []) && <p role="status" className={styles.muted}>{t("writing")}</p>}
              {run.errorCode && <div role="alert"><p>{run.errorCode === "REPORT_METER_NAMES_REQUIRED" ? t("errorMeterNames") : run.errorCode === "REPORT_REVIEW_BLOCKED" ? t("errorReviewBlocked") : t("errorGeneric")}</p><details><summary>{t("technicalDetails")}</summary><code>{run.errorCode}</code></details></div>}
              {run.status === "succeeded" && (run.kind === "skill" || isReport(run)) && <button className={`${styles.fileCard} ${isReport(run) ? styles.reportDelivery : ""}`} onClick={() => openRun(run)}>{isReport(run) && library?.reports.find(item=>item.id===run.id) && <div className={styles.deliveryThumbnail}><ReportThumbnail file={reportFile(projectId,library.reports.find(item=>item.id===run.id)!,locale)} /></div>}<strong>{run.kind === "skill" ? "project-skill.md" : library?.reports.find(item => item.id === run.id)?.title ?? t("energyReportFallback", { date: run.period.from })}</strong><span>{run.kind === "skill" ? t("markdownSkill") : t("htmlReport", { version: library?.reports.find(item => item.id === run.id)?.version ?? 1 })} · {t("openPreview")}</span></button>}
              {run.status === "succeeded" && run.hasSkillDraft && <><button className={styles.fileCard} onClick={()=>openSkillDraft(run)}><strong>project-skill.md</strong><span>{t("skillDraft")} · {t("openPreview")}</span></button><button className={styles.activityLink} disabled={busy} onClick={()=>void action(async()=>{const draft=await request<{content:string}>(`draft-skill/${run.id}`);setSkillDraft({content:draft.content,runId:run.id});})}>{t("reviewAndSave")}</button></>}
              {library?.canChat && library.artifacts?.some(item=>item.runId===run.id) && <details><summary>{t("supportingFiles")}</summary>{library.artifacts.filter(item => item.runId === run.id).map(item => <button key={item.filename} className={styles.activityLink} onClick={() => setFile(artifactFile(projectId, item))}>{item.filename} ↗</button>)}</details>}
              <div className={styles.toolbar}>{overview?.canChat && isReport(run) && run.status === "succeeded" && <button onClick={() => continueReport(run)}>{t("discussReport")}</button>}</div>
{selectedId === run.id && <>                <div className={styles.toolbar}>
                  {active(run) && <button disabled={busy} onClick={() => void action(async () => { await request(`runs/${run.id}/stop`, { method: "POST" }); await refresh(); })}>{t("stopTask")}</button>}
                  {overview?.canChat && ["failed","interrupted","cancelled"].includes(run.status) && <button disabled={busy || pending} onClick={() => void action(async () => { const result = await request<{ id: string }>(`runs/${run.id}/resume`, { method: "POST" }); await refresh(); setSelectedId(result.id); })}>{t("retryTask")}</button>}
                  {overview?.canChat && output && run.status === "succeeded" && run.kind === "skill" && !run.hasSkillDraft && <button className={buttonClass} disabled={busy} onClick={()=>void action(async()=>{setSkillDraft({content:output,runId:run.id});})}>{t("reviewAndSave")}</button>}
                </div></>}
            </div>
          </article>)}
        </div>
        <div className={styles.composeArea}>{overview?.canChat !== true ? <p role="status" className={styles.banner}>{t("readOnly")}</p> : <>{awayFromLatest && <button className={styles.jumpLatest} aria-label={t("scrollToLatest")} onClick={scrollToLatest}><EnergyIcon name="arrow" /></button>}

          <div className={styles.composerCard}>
          <section className={styles.analysisRange} aria-label={t("analysisPeriod")}>
            <details className={styles.dateOptions}><summary aria-label={t("changeDates")}><EnergyIcon name="calendar" /><strong>{periodPreset === "recent" ? t("presetRecent") : periodPreset === "previous-month" ? t("presetPreviousMonth") : periodPreset === "all" ? t("presetAllAvailable") : t("presetCustom")}</strong><span>{from && to ? t("periodSgt", { period: formatPeriod(from, to, locale) }) : t("chooseDates")}</span><EnergyIcon name="chevron" /></summary><div className={styles.dateOptionBody}>
            <div className={styles.rangeShortcuts}><span>{t("datesForMessage")}</span>{([["recent","presetRecent"],["previous-month","presetPreviousMonth"],["all","shortcutAll"]] as const).map(([value,label])=><button key={value} aria-pressed={periodPreset === value} disabled={!overview?.periodOptions || (value === "all" && !overview.periodOptions.availablePeriod)} onClick={()=>{if(!overview?.periodOptions)return;const range=presetPeriod(value,overview.periodOptions);if(range){setPeriodPreset(value);setFrom(range.from);setTo(shiftDate(range.toExclusive,-1));}}}>{t(label)}</button>)}</div>
            <details className={styles.rangePicker}><summary><EnergyIcon name="calendar" />{from && to ? formatPeriod(from, to, locale) : t("chooseDates")}<span>{t("sgtEditDates")}</span><EnergyIcon name="chevron" /></summary><div className={styles.period}><label>{t("from")}<input aria-label={t("startDate")} type="date" value={from} max={to || undefined} onChange={e=>{setPeriodPreset("custom");setFrom(e.target.value);}} /></label><label>{t("through")}<input aria-label={t("endDate")} type="date" value={to} min={from || undefined} onChange={e=>{setPeriodPreset("custom");setTo(e.target.value);}} /></label></div></details>
            <details className={styles.rangePicker}><summary>{t("multipleMonths")}</summary><div className={styles.period}><label>{t("firstMonth")}<input type="month" aria-label={t("firstReportMonth")} value={from.slice(0,7)} onChange={e=>{if(e.target.value){setPeriodPreset("custom");setFrom(`${e.target.value}-01`);if(to){const end=new Date(`${to.slice(0,7)}-01T00:00:00Z`);end.setUTCMonth(end.getUTCMonth()+1);setTo(shiftDate(end.toISOString().slice(0,10),-1));}}}} /></label><label>{t("lastMonth")}<input type="month" aria-label={t("lastReportMonth")} min={from.slice(0,7)} value={to.slice(0,7)} onChange={e=>{if(e.target.value){const date=new Date(`${e.target.value}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+1);if(from)setFrom(`${from.slice(0,7)}-01`);setPeriodPreset("custom");setTo(shiftDate(date.toISOString().slice(0,10),-1));}}} /></label></div></details>
            </div></details>
            <div className={styles.dateCoverage}>{overview?.periodOptions?.availablePeriod ? <span>{t(from < overview.periodOptions.availablePeriod.from || shiftDate(to,1) > overview.periodOptions.availablePeriod.toExclusive ? "gapsAvailable" : "readingsAvailable", { period: formatPeriod(overview.periodOptions.availablePeriod.from, shiftDate(overview.periodOptions.availablePeriod.toExclusive,-1), locale) })}</span> : <span>{t("readingDatesUnavailable")}</span>}</div>
          </section>
          <section className={styles.composer} aria-label={t("reportCreation")}>
            {parentId && <div className={styles.reportMode}><span>{fillTemplate(t("reference"), { title: <strong>{library?.reports.find(item=>item.id===parentId)?.title ?? t("selectedReport")}</strong> })}{library?.reports.find(item=>item.id===parentId) && ` · v${library.reports.find(item=>item.id===parentId)!.version}`}</span><button onClick={()=>setParentId("")}>{t("removeReference")}</button></div>}
            {attachedIds.length > 0 && <section aria-label={t("attachments")} className={styles.attachments}><div className={styles.fieldLabel}>{t("materialsForAnalysis")}</div><div className={styles.attachmentChips}>{attachedIds.map(id=>{const file=overview?.files.find(item=>item.id===id);return file ? <span key={id}>{file.filename}<button aria-label={t("removeAttachment", { filename: file.filename })} onClick={()=>setMessageFiles(attachedIds.filter(value=>value!==id))}>×</button></span> : null;})}</div><p className={styles.muted}>{t("selectionNote")}</p></section>}
            {overview?.canManageProject && messageFiles !== null && <button disabled={busy} className={styles.activityLink} onClick={()=>void action(async()=>{await save({...settings,fileRefIds:attachedIds});setMessageFiles(null);setNotice(t("materialsSaved"));})}>{t("saveSelection")}</button>}
            <textarea disabled={busy} ref={promptInput} aria-label={t("reportInstructions")} rows={2} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !busy && !pending && prompt.trim()){e.preventDefault();void action(()=>generate("chat"));}}} placeholder={t("composerPlaceholder")} />
            <input ref={attachmentInput} type="file" hidden aria-label={t("attachDocument")} accept=".csv,.xlsx,.pptx,.pdf,.md,.txt,.json,.parquet" onChange={e=>{const file=e.target.files?.[0];if(file)void uploadInput(file);e.target.value="";}} />
            <footer><div className={styles.toolbar}><button className={styles.quietAction} disabled={busy} onClick={()=>attachmentInput.current?.click()} title={t("attachTitle")}><EnergyIcon name="plus" /><span className="sr-only">{t("attachFile")}</span></button><ReportSkillSelector skills={overview?.skills ?? []} value={skillSelection} onChange={setSkillSelection} />{skillSource && <button className={styles.quietAction} disabled={busy||pending} onClick={()=>void action(()=>generate("skill",skillSource))} title={t("saveMethodTitle")}>{t("saveMethod")}</button>}</div><button aria-label={activeConversationRun ? t("stopGenerating") : t("sendMessage")} title={activeConversationRun ? t("stopGenerating") : t("sendMessageEnter")} className={`${styles.primaryAction} ${styles.sendAction}`} disabled={busy || (pending ? !activeConversationRun : !prompt.trim())} onClick={()=>void action(async()=>{if(activeConversationRun){await request(`runs/${activeConversationRun.id}/stop`,{method:"POST"});await refresh();}else await generate("chat");})}><span className="sr-only">{activeConversationRun ? t("stopGenerating") : t("sendMessage")}</span>{activeConversationRun ? <span className={styles.stopIcon} /> : <EnergyIcon name="arrow" />}</button></footer>
          </section>
          </div>
          <p className={styles.composerNote}>{t("composerNote")}</p>
        </>}</div>
      </>}
    </>}
    </div>{file && <ReportFilePreview onDiscuss={library?.canChat && library.reports.some(item=>item.id===file.id && item.canDiscuss !== false) ? ()=>{const report=library.reports.find(item=>item.id===file.id);if(report){setParentId(file.id);setFrom(report.period.from);setTo(shiftDate(report.period.toExclusive,-1));setPeriodPreset("custom");}setNotice(t("reportAdded"));promptInput.current?.focus();} : undefined} file={file} onClose={() => setFile(null)} />}
  </div>;
}

// Statuses and activity types are English codes from the service; only their labels are translated.
const statusKeys: Record<string, AdvisorMessageKey> = { queued: "statusQueued", running: "statusRunning", succeeded: "statusSucceeded", failed: "statusFailed", interrupted: "statusInterrupted", cancelled: "statusCancelled" };
const lookup = (keys: Record<string, AdvisorMessageKey>, code: string) => Object.prototype.hasOwnProperty.call(keys, code) ? keys[code] : undefined;
function statusLabel(status: string, t: AdvisorTranslate): string { const key = lookup(statusKeys, status); return key ? t(key) : status; }
function message(reason: unknown, fallback: string): string { return reason instanceof Error ? reason.message : fallback; }

const activityKeys: Record<string, AdvisorMessageKey> = {
  skill_inputs_prepared: "activitySkillInputs",
  review_started: "activityReviewing",
  revision_started: "activityRevising",
  review_passed: "activityReviewPassed",
  review_blocked: "needsAttention",
};
function activityLabel(type: string, t: AdvisorTranslate): string | undefined { const key = lookup(activityKeys, type); return key ? t(key) : undefined; }
function runActivityLabel(run: Run, events: Event[], t: AdvisorTranslate): string {
  if (run.status === "queued") return t("waitingToStart");
  if (run.errorCode === "REPORT_METER_NAMES_REQUIRED") return t("meterDetailsNeeded");
  if (run.errorCode === "REPORT_REVIEW_BLOCKED") return t("needsAttention");
  if (!active(run)) return statusLabel(run.status, t);
  const phase = events.findLast(event => event.type.startsWith("review_") || event.type === "revision_started");
  return (phase && activityLabel(phase.type, t)) ?? t("working");
}

export function visibleAnswer(run: {status: string; answer?: string | null}, events: Array<{type: string; text?: string}>): string {
  return run.status === "running" ? events.findLast(event => event.type === "answer_progress" && typeof event.text === "string")?.text ?? run.answer ?? "" : run.answer ?? "";
}

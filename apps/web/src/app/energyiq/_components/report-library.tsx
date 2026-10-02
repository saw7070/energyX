"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ReportActionPanel } from "./report-action-panel";
import { ReportThumbnail as Thumbnail } from "./report-thumbnail";
import { OPEN_REPORT } from "./report-navigation";
import { ReportSettingsButton } from "./report-settings-dialog";
import { useEffect, useRef, useState } from "react";
import { useEnergyIqAccess } from "./energyiq-access";
import { configApi } from "../../../lib/config-api";
import { ReportFilePreview, ReportMarkdown, type PreviewFile, type FileContent } from "./report-file-preview";
import { methodTitle, ReportSkillVersionDialog, type ReportSkillOption } from "./report-skill-controls";
import { preferredSkillVersion, skillVersionGroups } from "./report-skill-versions";
import { formatPeriod, shiftDate } from "./report-period";
import { EnergyIcon, type EnergyIconName } from "./icons";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { dateLocale, libraryMessages, coverageLabel } from "./report-library-messages";
import { useFriendlyError } from "./friendly-error";
import { nextReportRun, type ReportFrequency } from "./report-schedule";
import styles from "./report-workbench.module.css";
import { ReportScheduleNote } from "./report-schedule-note";
// `source` says who wrote a report: "site" reports are the ones the server writes for the whole site on the schedule
// and the Overview shows; "advisor" reports are the ones somebody asked for.
type Report = { canDiscuss?: boolean; previousReportId?: string; id: string; kind: "report"; period: { from: string; toExclusive: string }; createdAt: string; finishedAt?: string; parentRunId?: string; category: "scheduled" | "custom"; version: number; title: string; source?: "site" | "advisor"; cadence?: "weekly" | "monthly" };
type Skill = { id?: string; revision?: number; isDefault?: boolean; required?: boolean; readOnly?: boolean; scope?: "general" | "project" | "personal"; category?: "analysis" | "presentation" | "other"; name: string; version: string; content: string; sourceRunId?: string; sourceSessionId?: string; projectId: string };
export type Artifact = { runId: string; filename: string; mimeType: string; bytes: number; encoding: "utf8" | "base64"; createdAt: string };
export type ReportLibrary = { reports: Report[]; skills: Skill[]; tools: Array<{ name: string; description: string }>; canChat: boolean; canManageProject?: boolean; canUseActions?: boolean; artifacts?: Artifact[]; overviewCadence?: "weekly" | "monthly" };
export function artifactFile(projectId: string, item: Artifact): PreviewFile { return { id: `${item.runId}/${item.filename}`, title: item.filename, mimeType: item.mimeType, load: signal => configApi.reportLibraryRequest(projectId, `artifact/${encodeURIComponent(item.runId)}/${encodeURIComponent(item.filename)}`, { signal }) }; }
export function reportFile(projectId: string, report: Report, locale: EnergyIqLocale = "en"): PreviewFile { return { id: report.id, title: `${report.title ?? translatorFor(libraryMessages, locale)("energyReportFallback", { date: report.period.from })} · v${report.version ?? 1}`, filename: `report-${report.period.from}-v${report.version ?? 1}-${report.id.slice(-8)}.html`, mimeType: "text/html", load: signal => configApi.reportLibraryRequest(projectId, `output/${encodeURIComponent(report.id)}`, { signal }) }; }
/** Page fallback while the library route loads. */
export function ReportLibraryLoading() { const t = useMessages(libraryMessages); return <p className="p-6">{t("loadingLibrary")}</p>; }
export function ReportLibraryView({ projectId, view }: { projectId: string; view: "reports" | "skills" }) { return <ProjectLibrary key={`${projectId}:${view}`} projectId={projectId} view={view} />; }
function ProjectLibrary({ projectId, view }: { projectId: string; view: "reports" | "skills" }) {
  const t = useMessages(libraryMessages);
  const friendly = useFriendlyError();
  const { locale } = useEnergyIqLocale();
  const searchParams = useSearchParams();
  const requestedReport = searchParams.get("reportId");
  const { activeProject } = useEnergyIqAccess();
  const router = useRouter();
  function openReport(report: Report) { setFile(reportFile(projectId,report,locale));router.replace(`/energyiq/library?${new URLSearchParams({projectId,reportId:report.id})}`,{scroll:false}); }
  function closeReport() { setFile(null);if(view === "reports")router.replace(`/energyiq/library?${new URLSearchParams({projectId})}`,{scroll:false}); }
  const projectName = activeProject?.id === projectId ? activeProject.name ?? t("thisProject") : t("thisProject");
  const [knowledgeTab, setKnowledgeTab] = useState<"reports" | "materials" | "context">("reports");
  const [materials, setMaterials] = useState<{settings:{fileRefIds:string[];contextNotes:string};files:Array<{id:string;filename:string;bytes:number}>} | null>(null);
  // The schedule answers "when does the next one arrive?" without opening Automatic reports.
  const [schedule, setSchedule] = useState<{frequency:string;localHour:number;timezone?:string} | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [saving, setSaving] = useState(false); const [notice, setNotice] = useState("");
  const [library, setLibrary] = useState<ReportLibrary | null>(null); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<PreviewFile | null>(null); const [search, setSearch] = useState(""); const [page, setPage] = useState(0); const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null); const [skillSourceView,setSkillSourceView] = useState(false); const [skillsTab, setSkillsTab] = useState<"skills" | "tools">("skills");
  useEffect(() => { const controller = new AbortController(); setError(""); configApi.reportLibraryRequest<ReportLibrary>(projectId, requestedReport ? `?reportId=${encodeURIComponent(requestedReport)}` : "", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setLibrary(data); }).catch(reason => { if (!controller.signal.aborted) { setLibrary(null); setFile(null); setError(friendly(reason, t("libraryUnavailable"))); } }); return () => controller.abort(); }, [projectId, revision, requestedReport]);
  useEffect(()=>{if(view!=="reports" || knowledgeTab==="reports")return;const controller=new AbortController();configApi.reportAgentRequest<{settings:{fileRefIds:string[];contextNotes:string};files:Array<{id:string;filename:string;bytes:number}>}>(projectId,"",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setMaterials(data);}).catch(()=>{if(!controller.signal.aborted)setError(t("materialsLoadFailed"));});return()=>controller.abort();},[projectId,knowledgeTab,view,revision]);
  // Only people who may change the schedule fetch it; a reader without that permission would be refused.
  const canSeeSchedule = (activeProject?.id === projectId && activeProject.capabilities?.manageAutomation) ?? false;
  useEffect(() => { if(!canSeeSchedule) { setSchedule(null); return; } const controller=new AbortController(); configApi.reportAgentRequest<{settings:{frequency:string;localHour:number;timezone?:string}}>(projectId,"",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setSchedule(data.settings);}).catch(()=>{}); return ()=>controller.abort(); },[projectId,canSeeSchedule]);
  useEffect(() => { const report=library?.reports.find(item=>item.id===requestedReport); if(report) setFile(reportFile(projectId,report,locale)); },[library,projectId,requestedReport]);
  useEffect(() => { const open=(event: Event)=>{const detail=(event as CustomEvent<{projectId:string;reportId:string}>).detail;if(detail?.projectId!==projectId)return;const report=library?.reports.find(item=>item.id===detail.reportId);if(report)setFile(reportFile(projectId,report,locale));};window.addEventListener(OPEN_REPORT,open);return()=>window.removeEventListener(OPEN_REPORT,open);},[library,projectId]);
  async function setDefault(skill: Skill) {
    setSaving(true); setError("");
    try {
      const data = await configApi.reportAgentRequest<{ settings: { revision: number } }>(projectId);
      await configApi.reportAgentRequest(projectId, "skills/default", { method: "POST", body: JSON.stringify({ id: skill.id, version: skill.version, revision: data.settings.revision }) });
      setRevision(value => value + 1); setNotice(skill.category === "presentation" ? t("styleUpdated") : t("methodUpdated")); setSelectedSkill(null);
    } catch (reason) { setError(friendly(reason, t("defaultUpdateFailed"))); } finally { setSaving(false); }
  }
  // Category is saved as an English word; only its label is translated.
  const categoryLabel = (category?: string) => category === "analysis" ? t("categoryAnalysis") : category === "presentation" ? t("categoryPresentation") : !category || category === "other" ? t("categoryOther") : category;
  function renderSkill(skill: Skill) {
    const icon: EnergyIconName = skill.category === "presentation" ? "document" : skill.category === "analysis" ? "analysis" : "spark";
    return <button key={`${skill.id ?? skill.name}:${skill.version}`} className={styles.skillCard} aria-label={t("openSkill", { name: skill.name })} onClick={()=>{setSelectedSkill(skill);setSkillSourceView(false);setEditing(null);setError("");}}>
      <span className={styles.skillCardHead}><span className={styles.skillIcon} aria-hidden="true"><EnergyIcon name={icon} /></span>{skill.isDefault && <span className={styles.skillDefault}>{t("default")}</span>}</span>
      <strong title={skill.name}>{methodTitle(skill.name)}</strong>
      <p>{skillPurpose(skill.content) || t("skillPurposeFallback")}</p>
      <span className={styles.skillMeta}><span>{categoryLabel(skill.category)}</span><span>{skill.scope === "general" ? t("scopeGeneral") : skill.scope === "personal" ? t("scopePersonal") : t("scopeProject")}</span><span>{/^v/i.test(String(skill.version)) ? skill.version : `v${skill.version}`}</span></span>
    </button>;
  }
  const displayedSkills = skillVersionGroups(library?.skills ?? []).map(versions => preferredSkillVersion(versions)!);
  const selectedVersions = selectedSkill ? (selectedSkill.id ? library?.skills.filter(skill => skill.id === selectedSkill.id) ?? [] : [selectedSkill]) : [];
  const dayKey = (report: Report) => new Date(report.finishedAt || report.createdAt).toLocaleDateString("en-CA",{timeZone:"Asia/Singapore",year:"numeric",month:"2-digit",day:"2-digit"});
  const [showVersions, setShowVersions] = useState(false);
  // First-time readers look for "the monthly report"; this separates the scheduled ones from answers they asked for.
  const [kind, setKind] = useState<"all" | "scheduled" | "custom">("all");
  // "Which one is the monthly report?" is answered by the length it covers, so that is a filter too.
  const [length, setLength] = useState("");
  const reportIndex = new Map((library?.reports ?? []).map(report=>[report.id,report]));
  function previousVersions(report: Report) { const previous: Report[] = [];const seen=new Set([report.id]);let parent=report.previousReportId ?? report.parentRunId;while(parent && !seen.has(parent)){seen.add(parent);const item=reportIndex.get(parent);if(!item)break;previous.push(item);parent=item.previousReportId ?? item.parentRunId;}return previous; }
  const superseded = new Set((library?.reports ?? []).map(report=>report.previousReportId ?? report.parentRunId).filter(Boolean));
  // The Overview shows one of these: the newest site report for the cadence this project chose. Pointing at it here
  // answers "where is the report I see on the Overview?" without opening anything. The server lists newest first.
  const siteReports = (library?.reports ?? []).filter(report=>report.source === "site");
  const overviewReportId = (siteReports.find(report=>report.cadence === (library?.overviewCadence === "weekly" ? "weekly" : "monthly")) ?? siteReports[0])?.id;
  const reports = (library?.reports ?? []).filter(report=>showVersions || !superseded.has(report.id)).filter(report => `${report.title} ${report.period.from} ${formatPeriod(report.period.from, shiftDate(report.period.toExclusive,-1), locale)}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => dayKey(b).localeCompare(dayKey(a)) || Number(b.category === "scheduled") - Number(a.category === "scheduled") || (b.finishedAt || b.createdAt).localeCompare(a.finishedAt || a.createdAt));
  const kindCounts = { all: reports.length, scheduled: reports.filter(report=>report.category === "scheduled").length, custom: reports.filter(report=>report.category !== "scheduled").length };
  const byKind = kind === "all" ? reports : reports.filter(report => kind === "scheduled" ? report.category === "scheduled" : report.category !== "scheduled");
  // Offer only the lengths this project actually has, shortest first.
  const lengths = [...new Map(byKind.map(report => [coverageLabel(report.period.from, report.period.toExclusive, locale), Math.round((Date.parse(`${report.period.toExclusive}T00:00:00Z`) - Date.parse(`${report.period.from}T00:00:00Z`)) / 86400000)])).entries()].filter(([label]) => label).sort((a, b) => a[1] - b[1]);
  const shown = length ? byKind.filter(report => coverageLabel(report.period.from, report.period.toExclusive, locale) === length) : byKind;
  const latestReports = (library?.reports ?? []).filter(report=>!superseded.has(report.id)).length;
  const maxPage = Math.max(0,Math.ceil(shown.length/12)-1); const currentPage=Math.min(page,maxPage);
  const groups = new Map<string,Report[]>();
  for (const report of shown.slice(currentPage*12,currentPage*12+12)) { const day=dayKey(report); groups.set(day,[...(groups.get(day) ?? []),report]); }
  return <div className={`${styles.workbench} ${file ? styles.withPreview : ""}`}><div className={styles.center}>
    <header className={styles.header}><div><h1>{view === "reports" ? t("reportsTitle") : t("guidelinesTitle")}</h1><p>{view === "reports" ? `${projectName} · ${library ? t(latestReports === 1 ? "savedReportsOne" : "savedReportsOther", { count: latestReports }) : t("savedEnergyReports")}` : t("savedMethods")}</p></div><div className={styles.toolbar}>{view === "reports" && library?.canChat && <button className={styles.createReportAction} onClick={()=>router.push(`/energyiq/reports?${new URLSearchParams({projectId,sessionId:"new"})}`)}><EnergyIcon name="plus" />{t("createReport")}</button>}{view === "reports" && library?.canManageProject && <ReportSettingsButton projectId={projectId} mode="automation" />}<button onClick={() => setRevision(value => value + 1)}>{t("refresh")}</button></div></header>
    <div className={styles.libraryScroll}>

    {error && <p role="alert">{error}</p>}{!library && !error && <p role="status">{t("loadingLibrary")}</p>}
    {library && view === "reports" && <nav aria-label={t("reportSections")} className={styles.innerTabs}>{(["reports", ...(library.canManageProject ? ["materials", "context"] as const : [])] as const).map(tab=><button key={tab} aria-pressed={knowledgeTab===tab} onClick={()=>setKnowledgeTab(tab)}>{tab==="reports"?t("tabReports"):tab==="materials"?t("tabMaterials"):t("tabContext")}</button>)}</nav>}
    {library && view === "reports" && knowledgeTab!=="reports" && <section aria-label={t("materialsAndContext")}>{!materials ? <p role="status">{t("loadingMaterials")}</p> : knowledgeTab==="materials" ? <><h2>{t("materialsHeading")}</h2><p className={styles.muted}>{t("materialsIntro")}</p>{materials.settings.fileRefIds.length ? <ul>{materials.settings.fileRefIds.map(id=>{const item=materials.files.find(file=>file.id===id);return <li key={id} className="border-b border-border py-3">{item?.filename ?? t("fileUnavailable")}{item && <small className="ml-3">{Math.ceil(item.bytes/1024)} KB</small>}</li>;})}</ul> : <p>{t("noMaterials")}</p>}</> : <><h2>{t("contextHeading")}</h2><p className={styles.muted}>{t("contextIntro")}</p>{materials.settings.contextNotes ? <ReportMarkdown>{materials.settings.contextNotes}</ReportMarkdown> : <p>{t("noContext")}</p>}</>}</section>}
    {library && view === "reports" && knowledgeTab==="reports" && <section aria-label={t("projectReports")}>
      <p className={styles.libraryIntro}>{t("libraryIntro")} <span>{t("libraryIntroAutomatic")}</span></p>
      <ReportScheduleNote projectId={projectId} schedule={schedule} canSee={canSeeSchedule} />
      <div className={styles.reportSearchTools}>
        <label className={styles.searchField}><EnergyIcon name="search" /><input aria-label={t("searchReports")} type="search" placeholder={t("searchPlaceholder")} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label>
        <div className={styles.reportFilters} role="group" aria-label={t("filterLabel")}>
          {(["all","scheduled","custom"] as const).map(option=><button key={option} type="button" aria-pressed={kind===option} onClick={()=>{setKind(option);setLength("");setPage(0);}}>
            {t(option === "all" ? "filterAll" : option === "scheduled" ? "filterAutomatic" : "filterCustom")}<span>{kindCounts[option]}</span>
          </button>)}
        </div>
        {lengths.length > 1 && <label className={styles.lengthFilter}>{t("lengthLabel")}<select value={length} onChange={event=>{setLength(event.target.value);setPage(0);}}>
          <option value="">{t("lengthAny")}</option>
          {lengths.map(([label])=><option key={label} value={label}>{label}</option>)}
        </select></label>}
        <label className={styles.switch}><input type="checkbox" role="switch" checked={showVersions} onChange={e=>{setShowVersions(e.target.checked);setPage(0);}} /><span aria-hidden="true" />{t("showEarlierVersions")}</label>
        <span className={styles.reportCount}>{t(shown.length === 1 ? "reportCountOne" : "reportCountOther", { count: shown.length })}</span>
      </div>
      {!shown.length ? <div className={styles.reportsEmpty}><EnergyIcon name="document" /><strong>{search ? t("noSearchMatch") : kind === "scheduled" ? t("filterAutomatic") : t("noReports")}</strong>{!search && <p>{kind === "scheduled" ? t("noneOfKind") : t("askForFirstReport")}</p>}</div> : [...groups].map(([day,items],groupIndex)=><section key={day} aria-label={t("reportsGenerated", { day })} className={styles.reportDay}><h2>{t("groupCreated", { day: new Date(`${day}T12:00:00Z`).toLocaleDateString(dateLocale(locale, "en-GB"),{timeZone:"Asia/Singapore",day:"numeric",month:"long",year:"numeric"}) })}</h2><div className={styles.grid}>{items.map((report,index)=>{
        const previewFile=reportFile(projectId,report,locale);const previous=previousVersions(report);
        // The newest report on the first page is shown wide, in place of its normal card.
        const featured=currentPage===0 && groupIndex===0 && index===0 && !search;
        const generated=new Date(report.finishedAt || report.createdAt).toLocaleString(dateLocale(locale, "en-GB"),{timeZone:"Asia/Singapore",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).replace("Sept","Sep");
        return <article key={report.id} className={`${styles.reportCard} ${featured ? styles.featuredReport : ""}`}>
          <button className={styles.document} onClick={()=>openReport(report)} aria-label={t("openNamed", { title: report.title })}>
            <span className={styles.paper}><Thumbnail file={previewFile} /></span>
            <span className={styles.reportInfo}>
              {featured && <span className={styles.eyebrow}>{t("latestReport")}</span>}
              <strong>{report.title}</strong>
              <span className={styles.reportPeriod}><b className={styles.coverage}>{coverageLabel(report.period.from, report.period.toExclusive, locale)}</b>{formatPeriod(report.period.from, shiftDate(report.period.toExclusive,-1), locale)}</span>
              <span className={styles.reportTags}><span className={report.category === "scheduled" ? styles.tagAutomatic : undefined}>{report.category === "scheduled" ? t("automatic") : t("custom")}</span>{report.source === "site" && <span className={report.id === overviewReportId ? styles.tagAutomatic : undefined}>{report.id === overviewReportId ? t("onOverview") : t("siteReport")}</span>}<span>v{report.version ?? 1}</span>{featured && <span>{t("generatedAt", { time: generated })}</span>}</span>
              {featured && <span className={styles.reportCta}>{t("openReport")}<EnergyIcon name="arrow" /></span>}
            </span>
          </button>
          {!showVersions && previous.length>0 && <details className={styles.versions}><summary>{t("earlierVersions", { count: previous.length })}</summary>{previous.map(item=><button key={item.id} className={styles.activityLink} onClick={()=>openReport(item)}>v{item.version} · {formatPeriod(item.period.from, shiftDate(item.period.toExclusive,-1), locale)} · {t("generatedAt", { time: dayKey(item) })}</button>)}</details>}
        </article>;})}</div></section>)}{shown.length>12 && <nav aria-label={t("reportPages")} className={styles.pagination}><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>{t("previous")}</button><span>{t("pageOf", { page: currentPage+1, total: maxPage+1 })}</span><button disabled={currentPage===maxPage} onClick={()=>setPage(currentPage+1)}>{t("next")}</button></nav>}</section>}
    {library && view === "skills" && <>
      <div role="tablist" aria-label={t("skillsAndTools")} className={styles.innerTabs}>{(["skills","tools"] as const).map(tab=><button key={tab} role="tab" aria-selected={skillsTab===tab} onClick={()=>{setSkillsTab(tab);setFile(null);}}>{tab === "skills" ? t("tabSkills") : t("tabTools")}</button>)}</div>
      <section className={styles.skillGuide} aria-label={t("howToUseSkills")}><h2>{t("reuseHeading")}</h2><p>{t("reuseIntro")}</p><ol><li><strong>{t("stepReadTitle")}</strong>{t("stepReadBody")}</li><li><strong>{t("stepUseTitle")}</strong>{t("stepUseBody")}</li><li><strong>{t("stepKeepTitle")}</strong>{t("stepKeepBody")}</li></ol>{library.canChat && <button onClick={()=>router.push(`/energyiq/reports?${new URLSearchParams({projectId,sessionId:"new"})}`)}>{t("openAdvisor")}</button>}<p className={styles.muted}>{t("activationNote")}</p></section>
      {notice && <p role="status" className="mb-4 text-sm">{notice}</p>}
      {skillsTab === "skills" && <section aria-label={t("savedSkills")}><div className={styles.skillCount}><h2>{t("skillsHeading")}</h2><span>{t(displayedSkills.length === 1 ? "skillCountOne" : "skillCountOther", { count: displayedSkills.length })}</span></div>{(["general","project","personal"] as const).map(scope=>{const items=displayedSkills.filter(skill=>(skill.scope ?? "project") === scope);return <section key={scope} aria-label={scope === "general" ? t("generalMethods") : scope === "personal" ? t("personalSkills") : t("projectSkills")} className={styles.skillGroup}><div className={styles.skillCount}><h3>{scope === "general" ? t("generalMethods") : scope === "personal" ? t("personalSkills") : t("projectSkills")}</h3><span>{items.length}</span></div>{items.length ? <div className={styles.skillCards}>{items.map(renderSkill)}</div> : <p className={styles.muted}>{scope === "general" ? t("noGeneral") : scope === "personal" ? t("noPersonal") : t("noProjectSkills")}</p>}</section>;})}</section>}
      {selectedSkill && !editing && <SkillDialog onClose={()=>{setSelectedSkill(null);setEditing(null);}} title={selectedSkill.name}>
        <dl className={styles.skillMetadata}><div><dt>{t("version")}</dt><dd><select aria-label={t("versionHistory")} value={selectedSkill.version} onChange={event => { const version = selectedVersions.find(skill => skill.version === event.target.value); if (version) setSelectedSkill(version); }}>{[...selectedVersions].reverse().map(skill => <option key={skill.version} value={skill.version}>{skill.version}{skill.isDefault ? ` · ${t("enabled")}` : ""}</option>)}</select></dd></div><div><dt>{t("category")}</dt><dd>{categoryLabel(selectedSkill.category)}</dd></div><div><dt>{t("scope")}</dt><dd>{selectedSkill.scope === "general" ? t("scopeGeneral") : selectedSkill.scope === "personal" ? t("scopePersonalOnlyYou") : t("scopeShared")}</dd></div><div><dt>{t("project")}</dt><dd>{selectedSkill.required || selectedSkill.id?.startsWith("builtin:") ? t("allProjects") : projectName}</dd></div></dl>{selectedSkill.name === "Skill Creator" && <p className="my-4 text-sm">{t("skillCreatorHelp")}</p>}
        {error && <p role="alert">{error}</p>}
        {!editing && <><div className={`${styles.toolbar} mt-4`}><button aria-pressed={!skillSourceView} onClick={()=>setSkillSourceView(false)}>{t("preview")}</button><button aria-pressed={skillSourceView} onClick={()=>setSkillSourceView(true)}>{t("source")}</button>{library.canChat && !selectedSkill.readOnly && <button disabled={saving} onClick={()=>setEditing(selectedSkill)}>{t("editSkill")}</button>}{library.canManageProject && selectedSkill.id && !selectedSkill.required && selectedSkill.scope !== "personal" && !selectedSkill.isDefault && <button disabled={saving} onClick={()=>void setDefault(selectedSkill)}>{selectedSkill.category === "presentation" ? t("useReportStyle") : t("setProjectDefault")}</button>}</div><p className="my-4 text-sm text-muted">{skillPurpose(selectedSkill.content) || t("skillPurposeFallback")}</p><div className={styles.skillInstructions}>{skillSourceView ? <pre className="whitespace-pre-wrap break-words font-mono text-sm">{selectedSkill.content}</pre> : <ReportMarkdown>{selectedSkill.content.replace(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "")}</ReportMarkdown>}</div></>}

      </SkillDialog>}
      {editing && <ReportSkillVersionDialog canManageProject={library.canManageProject === true} projectId={projectId} skills={library.skills.filter((skill): skill is Skill & ReportSkillOption => !!skill.id && skill.revision !== undefined)} initial={editing as ReportSkillOption} content={editing.content} onClose={()=>setEditing(null)} onSaved={()=>{setRevision(value=>value+1);setNotice(t("skillVersionSaved"));}} />}
      {skillsTab === "tools" && <section aria-label={t("availableTools")} className="mt-8"><h2 className="mb-3 font-semibold">{t("availableTools")}</h2>{!library.tools.length ? <p className={styles.muted}>{t("noTools")}</p> : <ul className="divide-y divide-border">{library.tools.map(tool => <li key={tool.name} className="py-3 text-sm"><strong>{tool.name}</strong><p className="mt-1 text-muted">{tool.description}</p></li>)}</ul>}</section>}
    </>}
    </div></div>{file && <ReportFilePreview actions={library?.canUseActions === true && library.reports.some(item=>item.id===file.id) ? <ReportActionPanel key={`${projectId}:${file.id}`} projectId={projectId} reportId={file.id} /> : undefined} notice={library?.reports.find(item=>item.id===file.id)?.source === "site" ? t("siteReportNotice") : library?.reports.find(item=>item.id===file.id)?.canDiscuss === false ? t("sharedReportNotice") : undefined} onDiscuss={library?.canChat && library.reports.some(item=>item.id===file.id && item.canDiscuss !== false) ? ()=>{router.push(`/energyiq/reports?${new URLSearchParams({projectId,sessionId:"new",reportId:file.id})}`);} : undefined} file={file} onClose={closeReport} />}</div>;
}

/** Read the display description without treating the whole document as YAML; empty when the Skill has none. */
function skillPurpose(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const frontmatter = normalized.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  if (frontmatter) {
    const lines = frontmatter[1]!.split("\n");
    const index = lines.findIndex(line => /^description\s*:/.test(line));
    if (index >= 0) {
      const first = lines[index]!.replace(/^description\s*:\s*/, "");
      const parts = /^[>|][+-]?(?:\s+#.*)?$/.test(first) ? [] : [first];
      for (let next = index + 1; next < lines.length; next++) {
        const line = lines[next]!;
        if (line.trim() && !/^\s/.test(line)) break;
        if (line.trim() && !/^\s*#/.test(line)) parts.push(line.trim());
      }
      let description = parts.join(" ").trim();
      if (description.startsWith('"') && description.endsWith('"')) {
        try { description = JSON.parse(description) as string; } catch { description = description.slice(1,-1); }
      } else if (description.startsWith("'") && description.endsWith("'")) description = description.slice(1,-1).replace(/''/g, "'");
      else description = description.replace(/\s+#.*$/, "");
      if (description.trim()) return description.replace(/\s+/g, " ").trim().slice(0,140);
    }
  }
  const body = frontmatter ? normalized.slice(frontmatter[0].length) : normalized;
  for (const paragraph of body.split(/\n\s*\n/)) {
    const text = paragraph.split("\n").filter(line => !/^\s*(?:#{1,6}\s|(?:name|version|description)\s*:|[-=]{3,}\s*$)/i.test(line)).join(" ").trim();
    if (text) return text.replace(/\s+/g, " ").slice(0,140);
  }
  return "";
}

function SkillDialog({ title, onClose, children }: { title:string; onClose:()=>void; children: React.ReactNode }) {
  const t = useMessages(libraryMessages);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const opener=document.activeElement as HTMLElement;dialog.current?.showModal();return ()=>{if(opener?.isConnected)opener.focus();};},[]);
  return <dialog ref={dialog} className={styles.skillDialog} aria-label={t("skillDialog", { title })} onCancel={event=>{event.preventDefault();onClose();}}><header><h2>{title}</h2><button aria-label={t("closeSkill")} onClick={onClose}>{t("close")}</button></header><div className={styles.skillDialogBody}>{children}</div></dialog>;
}

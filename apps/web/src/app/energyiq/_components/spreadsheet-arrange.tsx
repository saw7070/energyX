"use client";
import { useMemo, useState } from "react";
import { configApi, type EnergyMeterMappingRowDto, type EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import type { Translate } from "./energyiq-messages";
import { spreadsheetArrangeMessages } from "./spreadsheet-arrange-messages";
import {
  ARRANGE_MAX_ROWS, TEMPLATE_FILENAME, arrangeChangesNothing, arrangeGroups, columnLetter, detectLayout, floorPlanWithGroupAreas, matchRows, matchSummary,
  parseDelimitedText, previewTree, readRows, sheetFromCells, templateCsv, withColumnRole, withPick,
  type ArrangeResult, type ColumnRole, type PreviewGroup, type RowMatch, type SheetColumn, type SheetLayout,
} from "./spreadsheet-arrange-model";
import { downloadText } from "./explorer-export";
import { notesWithReference, referenceFromPlan, type StoredSpatialReference } from "./floor-plan-model";
import { projectMeterName, projectMeterSubtitle } from "./project-meter-name";
import facility from "./project-configuration-view.module.css";
import styles from "./spreadsheet-arrange.module.css";

const ROLES: ColumnRole[] = ["ignore", "group", "meter", "device", "short", "lights"];
const PATH = " › ";
type Loaded = { file: string; cells: string[][]; layout: SheetLayout };
type ArrangeKey = Extract<keyof (typeof spreadsheetArrangeMessages)["en"], string>;
/** Sentences follow each other with a space, except in Chinese. */
const sentences = (parts: string[], locale: string) => parts.filter(Boolean).join(locale === "zh-Hans" ? "" : " ");

/**
 * "Arrange from a spreadsheet" in the Groups editor: read the installer's sheet in the browser, match each row to a
 * meter, show the groups that would result, and only on "Apply these groups" hand the edited draft to the editor's own
 * save, so it is one ordinary change. Optionally adds a labelled floor-plan area for each top-level group.
 */
export function SpreadsheetArrange({ doc, projectId, notes, block, previous, canEditPlan, busy, error, onApply, onPlanSaved, onCancel }: {
  doc: EnergyProjectSetupDocumentDto;
  projectId: string;
  /** Project notes and the floor-plan block in them, for adding areas without touching the rest. */
  notes: string;
  block: string | null;
  previous: StoredSpatialReference | null;
  canEditPlan: boolean;
  busy: boolean;
  error: string;
  /** Saves the edited draft the way every Groups edit is saved; true once saved. */
  onApply: (next: EnergyProjectSetupDocumentDto, message: string) => Promise<boolean>;
  onPlanSaved?: () => void;
  onCancel: () => void;
}) {
  const t = useMessages(spreadsheetArrangeMessages);
  const { locale } = useEnergyIqLocale();
  const meters = useMemo(() => doc.meter_mapping?.rows ?? [], [doc]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [picks, setPicks] = useState<Array<{ rowIndex: number; meterId: string | null }>>([]);
  const [removeEmptied, setRemoveEmptied] = useState(true);
  const [addPlan, setAddPlan] = useState(false);
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => loaded ? readRows(loaded.cells, loaded.layout) : [], [loaded]);
  const matches = useMemo(() => picks.reduce<RowMatch[]>((current, pick) => withPick(current, pick.rowIndex, pick.meterId), matchRows(rows, doc)), [rows, doc, picks]);
  const summary = useMemo(() => matchSummary(rows, matches, doc), [rows, matches, doc]);
  const result = useMemo(() => loaded ? arrangeGroups(doc, projectId, rows, matches, { removeEmptied }, locale) : null, [loaded, doc, projectId, rows, matches, removeEmptied, locale]);
  const arranged = result && !("error" in result) ? result : null;
  const tree = useMemo(() => arranged ? previewTree(arranged) : [], [arranged]);
  const planCandidate = useMemo(() => {
    if (!canEditPlan || !arranged) return null;
    try { return floorPlanWithGroupAreas(previous, tree.map(group => group.name), locale); } catch { return null; }
  }, [canEditPlan, arranged, previous, tree, locale]);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    // Old binary .xls (and .xlsb) can't be read in the browser; .xlsx/.xlsm can.
    if (/\.xls[b]?$/iu.test(file.name)) return setProblem(t("error.oldExcel"));
    let cells: string[][];
    try {
      if (/\.xls[xm]$/iu.test(file.name)) {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const sheets = (await readXlsxFile(file)).map(sheet => sheetFromCells(sheet.data, { decodeXml: true }));
        // The first sheet with a meter name column; workbooks often keep notes or totals on other sheets.
        cells = sheets.find(sheet => detectLayout(sheet, meters)?.columns.some(column => column.role === "meter" || column.role === "device")) ?? sheets[0] ?? [];
      } else cells = parseDelimitedText(await file.text());
    } catch { return setProblem(t("error.unreadable")); }
    const layout = detectLayout(cells, meters);
    if (!layout) return setProblem(t("error.empty"));
    if (readRows(cells, layout).length > ARRANGE_MAX_ROWS) return setProblem(t("error.tooMany", { max: ARRANGE_MAX_ROWS }));
    setPicks([]); setAddPlan(false);
    setLoaded({ file: file.name, cells, layout });
  };

  const setRole = (index: number, role: ColumnRole) => {
    if (!loaded) return;
    setPicks([]);
    setLoaded({ ...loaded, layout: withColumnRole(loaded.layout, index, role) });
  };
  const pick = (rowIndex: number, meterId: string | null) => setPicks(current => [...current, { rowIndex, meterId }]);

  const apply = async () => {
    if (!loaded || !arranged || arrangeChangesNothing(arranged)) return;
    setProblem(""); setSaving(true);
    try {
      let planNote = "";
      const plan = addPlan ? planCandidate : null;
      if (plan) {
        // The floor plan is saved first, so a failure there leaves the groups untouched too.
        try {
          const reference = referenceFromPlan(plan.plan, projectId, previous, locale);
          const current = await configApi.reportAgentRequest<{ settings: Record<string, unknown> & { contextNotes: string } }>(projectId, "");
          if (current.settings.contextNotes !== notes) { setProblem(t("plan.notesChanged")); return; }
          await configApi.reportAgentRequest(projectId, "settings", { method: "PUT", body: JSON.stringify({ ...current.settings, contextNotes: notesWithReference(notes, block, reference) }) });
        } catch { setProblem(t("plan.failed")); return; }
        planNote = t(plan.added.length === 1 ? "plan.addedOne" : "plan.addedMany", { count: plan.added.length });
      }
      const saved = await onApply(arranged.document, sentences([t("applied", { file: loaded.file }), planNote], locale));
      // The plan is already saved: reload the notes so another try does not add its areas twice.
      if (!saved && plan) onPlanSaved?.();
    } finally { setSaving(false); }
  };

  const columnLabel = (column: SheetColumn) => column.header || t("columns.letter", { letter: columnLetter(column.index) });
  const groupColumns = loaded?.layout.columns.filter(column => column.role === "group") ?? [];
  const hasName = loaded?.layout.columns.some(column => column.role === "meter" || column.role === "device") ?? false;
  const shown = problem || error;
  const working = busy || saving;

  return <section className={`${facility.inlineForm} ${styles.panel}`} aria-label={t("title")}>
    <header className={styles.header}>
      <div><h4>{t("title")}</h4><p className={facility.formHint}>{t("intro")}</p></div>
      <button type="button" className={facility.secondaryAction} onClick={() => downloadText(TEMPLATE_FILENAME, templateCsv())}>{t("template")}</button>
    </header>
    <p className={facility.formHint}>{t("templateHint")}</p>
    {!meters.length ? <p role="status" className={styles.note}>{t("error.noMeters")}</p> : <div className={styles.fileRow}>
      <label className={`${facility.secondaryAction} ${styles.fileButton}`}>
        {loaded ? t("chooseAnother") : t("chooseFile")}
        <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={working}
          onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      <span className={facility.formHint}>{loaded ? t("fileRead", { file: loaded.file, count: rows.length }) : t("fileHint")}</span>
    </div>}

    {loaded && <>
      <section className={styles.step} aria-labelledby="arrange-columns">
        <h5 id="arrange-columns">{t("columns.title")}</h5>
        <p className={facility.formHint}>{t("columns.hint")}</p>
        <div className={styles.columns}>{loaded.layout.columns.map(column => <label key={column.index} className={styles.column}>
          <span className={styles.columnName}><strong>{columnLabel(column)}</strong><small>{column.idColumn ? t("columns.idNote") : column.sample ? t("columns.example", { value: column.sample }) : ""}</small></span>
          <select aria-label={t("columns.roleAria", { column: columnLabel(column) })} value={column.role} disabled={working || column.idColumn} onChange={event => setRole(column.index, event.target.value as ColumnRole)}>
            {ROLES.map(role => <option key={role} value={role}>{t(`role.${role}`)}</option>)}
          </select>
        </label>)}</div>
        <p className={styles.note}>{groupColumns.length ? t("columns.order", { order: groupColumns.map(columnLabel).join(PATH) }) : t("columns.noGroup")}</p>
        {!hasName && <p role="alert" className={facility.editorError}>{t("columns.needName")}</p>}
      </section>

      {hasName && <MatchStep rows={rows} matches={matches} summary={summary} meters={meters} disabled={working} onPick={pick} />}

      {hasName && <section className={styles.step} aria-labelledby="arrange-preview">
        <h5 id="arrange-preview">{t("preview.title")}</h5>
        {result && "error" in result ? <p role="alert" className={facility.editorError}>{result.error}</p> : arranged && <>
          <p className={styles.counts}>{arrangeChangesNothing(arranged) ? t("preview.nothing") : changeCounts(arranged, t)}</p>
          {arranged.badLights.length > 0 && <p className={styles.note}>{t(arranged.badLights.length === 1 ? "preview.badLightsOne" : "preview.badLightsMany", { rows: arranged.badLights.map(item => item.row).join(", ") })}</p>}
          <ul className={styles.tree} aria-label={t("preview.treeAria")}>{tree.map(group => <PreviewNode key={group.id} group={group} result={arranged} />)}</ul>
          {arranged.emptied.length > 0 && <div className={styles.option}>
            <p>{t(arranged.emptied.length === 1 ? "preview.emptiedOne" : "preview.emptiedMany", { count: arranged.emptied.length, names: arranged.emptied.map(group => group.path.join(PATH)).join(", ") })}</p>
            <label className={facility.checkboxField}><input type="checkbox" checked={removeEmptied} disabled={working} onChange={event => setRemoveEmptied(event.target.checked)} />{t("preview.removeEmptied")}</label>
            {!removeEmptied && <p className={facility.formHint}>{t("preview.keepEmptied")}</p>}
          </div>}
          {planCandidate && <div className={styles.option}>
            <label className={facility.checkboxField}><input type="checkbox" checked={addPlan} disabled={working} onChange={event => setAddPlan(event.target.checked)} />{t("plan.offer", { names: planCandidate.added.join(", ") })}</label>
            <p className={facility.formHint}>{t("plan.hint")}</p>
          </div>}
        </>}
      </section>}
    </>}

    {shown && <p role="alert" className={facility.editorError}>{shown}</p>}
    <div className={facility.editorActions}>
      <button type="button" className={facility.secondaryAction} disabled={saving} onClick={onCancel}>{t("cancel")}</button>
      <button type="button" className={facility.primaryAction} disabled={working || !arranged || arrangeChangesNothing(arranged) || !hasName} onClick={() => void apply()}>{working ? t("applying") : t("apply")}</button>
    </div>
  </section>;
}

/** "2 new groups · 12 meters move · 8 short names set · 19 numbers of lights set", leaving out what does not change. */
function changeCounts(result: ArrangeResult, t: Translate<ArrangeKey>): string {
  const part = (count: number, one: "preview.groupsOne" | "preview.movesOne" | "preview.shortOne" | "preview.lightsOne", many: "preview.groupsMany" | "preview.movesMany" | "preview.shortMany" | "preview.lightsMany") => count ? t(count === 1 ? one : many, { count }) : "";
  return [part(result.created.length, "preview.groupsOne", "preview.groupsMany"), part(result.moved.length, "preview.movesOne", "preview.movesMany"), part(result.shortNames.length, "preview.shortOne", "preview.shortMany"), part(result.lightCounts.length, "preview.lightsOne", "preview.lightsMany")].filter(Boolean).join(" · ");
}

function MatchStep({ rows, matches, summary, meters, disabled, onPick }: {
  rows: ReturnType<typeof readRows>; matches: RowMatch[]; summary: ReturnType<typeof matchSummary>; meters: EnergyMeterMappingRowDto[]; disabled: boolean; onPick: (rowIndex: number, meterId: string | null) => void;
}) {
  const t = useMessages(spreadsheetArrangeMessages);
  const { locale } = useEnergyIqLocale();
  const options = useMemo(() => [...meters].map(meter => ({ id: meter.id, label: projectMeterSubtitle(meter) ? `${projectMeterName(meter)} (${projectMeterSubtitle(meter)})` : projectMeterName(meter) }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true })), [meters]);
  const unmatched = summary.unmatchedRows.length;
  return <section className={styles.step} aria-labelledby="arrange-meters">
    <h5 id="arrange-meters">{t("match.title")}</h5>
    <p className={styles.counts} role="status">{sentences([
      t("match.summary", { matched: summary.matched, total: summary.total }),
      unmatched ? t(unmatched === 1 ? "match.unmatchedOne" : "match.unmatchedMany", { count: unmatched }) : "",
      summary.guesses ? t(summary.guesses === 1 ? "match.guessOne" : "match.guessMany", { count: summary.guesses }) : "",
    ], locale)}</p>
    <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th scope="col">{t("match.rowColumn")}</th><th scope="col">{t("match.fileColumn")}</th><th scope="col">{t("match.groupColumn")}</th><th scope="col">{t("match.meterColumn")}</th></tr></thead>
      <tbody>{rows.map((row, index) => { const match = matches[index]!; const confidence = match.confidence ?? "none"; return <tr key={row.row} data-confidence={confidence}>
        <td className={styles.rowNumber}>{row.row}</td>
        <td><span className={styles.fileName}>{row.meterName || row.deviceName}</span>{row.shortName && <small>{t("match.short", { name: row.shortName })}</small>}{row.lights && <small>{t("match.lights", { count: row.lights })}</small>}</td>
        <td>{row.path.length ? row.path.join(PATH) : <span className={styles.muted}>{t("match.noGroup")}</span>}</td>
        <td><div className={styles.matchCell}>
          <select aria-label={t("match.selectAria", { row: row.row })} value={match.meterId ?? ""} disabled={disabled} onChange={event => onPick(index, event.target.value || null)}>
            <option value="">{t("match.skip")}</option>
            {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <span className={styles.badge} data-confidence={confidence}>{t(`conf.${confidence}`)}</span>
        </div></td>
      </tr>; })}</tbody>
    </table></div>
    {summary.notInFile.length > 0 && <p className={styles.note}>{t(summary.notInFile.length === 1 ? "match.notInFileOne" : "match.notInFileMany", { count: summary.notInFile.length, names: summary.notInFile.map(meter => projectMeterName(meter)).join(", ") })}</p>}
  </section>;
}

function PreviewNode({ group, result }: { group: PreviewGroup; result: ArrangeResult }) {
  const t = useMessages(spreadsheetArrangeMessages);
  const moved = new Map(result.moved.map(item => [item.meterId, item]));
  const named = new Map(result.shortNames.map(item => [item.meterId, item.name]));
  const lit = new Map(result.lightCounts.map(item => [item.meterId, item.count]));
  return <li>
    <div className={styles.groupLine}><strong>{group.name}</strong>{group.isNew && <span className={styles.newBadge}>{t("preview.new")}</span>}{!group.meters.length && !group.children.length && <small className={styles.muted}>{t("preview.empty")}</small>}</div>
    {(group.meters.length > 0 || group.children.length > 0) && <ul>
      {group.meters.map(meter => { const move = moved.get(meter.id); const shortName = named.get(meter.id), lights = lit.get(meter.id); return <li key={meter.id} className={`${styles.meter} ${move || shortName || lights ? styles.changed : ""}`}>
        <span>{projectMeterName(meter)}</span>
        {move && <small>{move.from.length ? t("preview.movesFrom", { from: move.from.join(PATH) }) : t("preview.movesHere")}</small>}
        {shortName && <small>{t("preview.shortName", { name: shortName })}</small>}
        {lights && <small>{t("preview.lights", { count: lights })}</small>}
      </li>; })}
      {group.children.map(child => <PreviewNode key={child.id} group={child} result={result} />)}
    </ul>}
  </li>;
}

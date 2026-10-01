"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";

import {
  configApi,
  type EnergyImportBatchDto,
  type EnergyProjectSetupDocumentDto,
  type EnergyProjectSetupDto,
} from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "../_components/energyiq-locale";
import { translatorFor, type Translate } from "../_components/energyiq-messages";
import { resetMeterHealthRequests } from "../_components/meter-health-notice";
import { loadAnalysis } from "../_components/analysis-data";
import {
  evaluateEnergyImportMaterializationGuard,
  pinEnergySourceManifest,
  sourceLabelsAcrossImportBatches,
} from "./project-setup-model";
import { importDateLocale, smartImportMessages } from "./smart-import-messages";
import { buildSmartSetup, parseDeviceList, savedDeviceList, type SmartSetupPlan } from "./smart-setup";

/**
 * Add readings files and a device list, check the result, then publish in one step.
 * Self-contained (loads and saves its own project setup) so it can sit on the Admin Data Sources page or in
 * the Facility page's Upload data dialog. Only hand-uploaded files are handled here; projects fed by a live
 * connector are left alone. All wording follows the reader's language (smart-import-messages.ts).
 */

type T = Translate<keyof typeof smartImportMessages.en>;
const english: T = translatorFor(smartImportMessages, "en");
const messageFrom = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason ?? "");

/** The server's error codes in the reader's language. */
export const friendlyImportError = (message: string, t: T = english): string => {
  const column = /ENERGYIQ_EXCEL_COLUMN_REQUIRED:(.+)$/u.exec(message)?.[1];
  if (column) return t("errColumn", { column });
  if (message.includes("FILE_ASSET_REF_NOT_FOUND")) return t("errFileGone");
  if (message.includes("ENERGYIQ_EXCEL_FILE_INVALID")) return t("errFileType");
  if (message.includes("ENERGYIQ_EXCEL_EMPTY")) return t("errEmpty");
  if (/REVISION|CONFLICT/u.test(message)) return t("errConflict");
  if (message.includes("VISION_UNAVAILABLE")) return t("errVisionUnavailable");
  if (message.includes("IMAGE_TYPE_UNSUPPORTED")) return t("errImageType");
  if (message.includes("IMAGE_SIZE_INVALID")) return t("errImageSize");
  if (message.includes("VISION_UNREADABLE") || message.includes("VISION_FAILED")) return t("errPhoto");
  return t("errGeneric", { message });
};

export type ImportSummary = { from?: string; to?: string; readings: number; devices: string[] };

export const summariseImport = (batches: EnergyImportBatchDto[]): ImportSummary => {
  const froms = batches.map((batch) => batch.inspection.coverageFrom).filter((value): value is string => Boolean(value)).sort();
  const tos = batches.map((batch) => batch.inspection.coverageTo).filter((value): value is string => Boolean(value)).sort();
  return {
    ...(froms[0] ? { from: froms[0] } : {}),
    ...(tos.at(-1) ? { to: tos.at(-1)! } : {}),
    readings: batches.reduce((sum, batch) => sum + batch.inspection.validRowCount, 0),
    devices: sourceLabelsAcrossImportBatches(batches),
  };
};

const dateIn = (dateLocale: string) => (value?: string): string => value
  ? new Date(value).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  : "—";
const numberIn = (dateLocale: string) => (value: number) => value.toLocaleString(dateLocale);

const BLOCKER_KEYS: Record<string, Parameters<T>[0]> = {
  IMPORT_BATCH_REQUIRED: "blockerImport",
  METER_MAPPING_NOT_CONFIRMED: "blockerMapping",
  SOURCE_LABEL_UNMAPPED: "blockerUnmapped",
  MAPPING_SOURCE_INACTIVE: "blockerInactive",
  SOURCE_LABEL_DUPLICATE: "blockerDuplicate",
  PROJECT_TIMEZONE_UNSAVED: "blockerTimezone",
};
/** Why an import cannot be built yet, in plain words (English unless a translator is given). */
export const explainImportBlocker = (reason: string, t: T = english): string => {
  const key = BLOCKER_KEYS[reason];
  return key ? t(key) : reason;
};

type ImportChange = { before: ImportSummary; after: ImportSummary };

export function SmartImportPanel({ projectId, onChanged, onOpenMapping }: {
  projectId: string;
  /** Called after files are added or data is published, so the host page can reload. */
  onChanged?: () => void;
  /** Where to send the admin when a new device must be placed by hand; omitted where Meter Mapping is not available. */
  onOpenMapping?: () => void;
}) {
  const t = useMessages(smartImportMessages);
  const { locale } = useEnergyIqLocale();
  const dateLocale = importDateLocale(locale);
  const [setup, setSetup] = useState<EnergyProjectSetupDto | null>(null);
  const [batches, setBatches] = useState<EnergyImportBatchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceListText, setDeviceListText] = useState("");
  // Kept in session storage: publishing can remount the host page.
  const changeKey = `energyiq:import-change:${projectId}`;
  const [change, setChangeState] = useState<ImportChange | null>(() => {
    try {
      const saved = window.sessionStorage.getItem(changeKey);
      return saved ? JSON.parse(saved) as ImportChange : null;
    } catch {
      return null;
    }
  });
  const setChange = (value: ImportChange | null) => {
    setChangeState(value);
    try {
      if (value) window.sessionStorage.setItem(changeKey, JSON.stringify(value));
      else window.sessionStorage.removeItem(changeKey);
    } catch {
      // Storage can be unavailable (private mode); the summary then lasts until the page remounts.
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSetup, imports] = await Promise.all([
        configApi.getEnergyProjectSetup(projectId),
        configApi.listEnergyImportBatches(projectId),
      ]);
      setSetup(nextSetup);
      setBatches(imports.batches);
      return imports.batches;
    } catch (reason) {
      setError(friendlyImportError(messageFrom(reason), t));
      return null;
    } finally {
      setLoading(false);
    }
  // The translator only changes the wording of an error already shown; it must not reload the project.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // Live-connector projects get their readings automatically; only hand-uploaded files are handled here.
  const liveConnected = batches.some((batch) => batch.sourceKind !== "excel");
  const uploads = useMemo(() => batches.filter((batch) => batch.sourceKind === "excel"), [batches]);
  const published = uploads.filter((batch) => batch.status === "materialized");
  const waiting = uploads.filter((batch) => batch.status !== "materialized");
  const devices = useMemo(() => parseDeviceList(deviceListText), [deviceListText]);
  const plan = useMemo(() => setup && uploads.length
    ? buildSmartSetup({ document: setup.draft.document, projectId, labels: sourceLabelsAcrossImportBatches(uploads), devices })
    : null, [devices, projectId, setup, uploads]);
  const busy = uploadingCount > 0 || step !== null;
  const publishedSummary = summariseImport(published);

  const upload = async (files: File[]) => {
    setUploadingCount(files.length);
    setError(null);
    try {
      for (const file of files) await configApi.uploadEnergyExcelImport(projectId, file);
    } catch (reason) {
      setError(friendlyImportError(messageFrom(reason), t));
    } finally {
      await load();
      setUploadingCount(0);
      onChanged?.();
    }
  };

  const publish = async (prepared: EnergyProjectSetupDocumentDto) => {
    if (!setup || uploads.length === 0 || busy) return;
    const before = summariseImport(published);
    setError(null);
    try {
      setStep(0);
      const sourceManifest = await pinEnergySourceManifest(uploads);
      const saved = await configApi.saveEnergyProjectSetupDraft(projectId, {
        expectedRevision: setup.draft.revision,
        document: { ...prepared, source_manifest: sourceManifest },
      });
      const guard = evaluateEnergyImportMaterializationGuard({ document: saved.draft.document, savedDocument: saved.draft.document, batches: uploads });
      if (!guard.ready) {
        setError(t("cantPublish", { reasons: guard.reasons.map((reason) => explainImportBlocker(reason, t)).join(" ") }));
        await load();
        return;
      }
      setStep(1);
      for (const batch of [...uploads].reverse()) await configApi.materializeEnergyImportBatch(projectId, batch.id);
      setStep(2);
      await configApi.applyEnergyProjectChanges(projectId);
      const after = (await load())?.filter((batch) => batch.sourceKind === "excel") ?? uploads;
      resetMeterHealthRequests();
      // Warm the Overview report for the new data in the background, so its first visit is quick.
      void loadAnalysis(projectId, { kind: "latest-28" }).catch(() => undefined);
      setChange({ before, after: summariseImport(after) });
      setDeviceListText("");
      onChanged?.();
    } catch (reason) {
      setError(friendlyImportError(messageFrom(reason), t));
      await load();
    } finally {
      setStep(null);
    }
  };

  if (loading && !setup) return <p role="status" className="py-10 text-center text-sm text-muted">{t("loading")}</p>;

  if (liveConnected) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <StatusDot tone="green" />
          <div>
            <h3 className="text-sm font-semibold">{t("liveTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{t("liveBody")}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span aria-hidden="true" className="mt-0.5 font-bold">!</span>
          <p className="flex-1">{error}</p>
          <button type="button" onClick={() => setError(null)} className="text-xs font-semibold underline">{t("dismiss")}</button>
        </div>
      ) : null}
      {change ? <ImportChangeSummary change={change} onDismiss={() => setChange(null)} /> : null}

      <CurrentData published={published} t={t} dateLocale={dateLocale} />

      <Card>
        <SectionTitle number={1} title={t("addFilesTitle")} hint={t("addFilesHint")} />
        <DropZone uploadingCount={uploadingCount} disabled={busy} onFiles={(files) => void upload(files)} t={t} />
        {waiting.length ? (
          <ul className="mt-3 space-y-2" aria-label={t("filesReady")}>
            {waiting.map((batch) => (
              <WaitingFile key={batch.id} batch={batch} publishedTo={publishedSummary.to} knownDevices={publishedSummary.devices} t={t} dateLocale={dateLocale} />
            ))}
          </ul>
        ) : null}
      </Card>

      {plan ? (
        <Card>
          <SectionTitle number={2} title={t("namesTitle")} hint={t("namesHint")} />
          <DeviceNames plan={plan} saved={setup ? savedDeviceList(setup.draft.document, projectId).length : 0} deviceListText={deviceListText} setDeviceListText={setDeviceListText} onError={setError} t={t} />
          {plan.unplacedLabels.length > 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t("unplaced", { devices: plan.unplacedLabels.join(", ") })}{" "}
              {onOpenMapping ? <button type="button" className="font-semibold underline" onClick={onOpenMapping}>{t("placeInMapping")}</button> : t("askAdminToPlace")}
            </p>
          ) : null}
        </Card>
      ) : null}

      {plan ? <PublishBar plan={plan} waiting={waiting} devicesTyped={devices.length} step={step} busy={busy} onPublish={() => void publish(plan.document)} t={t} dateLocale={dateLocale} /> : null}
    </div>
  );
}

/** One uploaded file: what it contains, and what it adds beyond the data already published. */
export const describeFileCoverage = (
  batch: EnergyImportBatchDto,
  publishedTo: string | undefined,
  knownDevices: string[],
  t: T = english,
  dateLocale = "en-SG",
): { tone: "new" | "warning"; text: string; detail?: string } => {
  const date = dateIn(dateLocale);
  const from = batch.inspection.coverageFrom;
  const to = batch.inspection.coverageTo;
  const devices = batch.inspection.sourceLabels.map((label) => label.label);
  const newDevices = devices.filter((device) => !knownDevices.includes(device));
  if (!from || !to) return { tone: "warning", text: t("coverageNoDates") };
  if (!publishedTo || from > publishedTo) {
    return {
      tone: "new",
      text: t("coverageNew", { from: date(from), to: date(to) }),
      detail: newDevices.length ? t("coverageDevicesNew", { count: devices.length, new: newDevices.length }) : t("coverageDevices", { count: devices.length }),
    };
  }
  if (to <= publishedTo) {
    return newDevices.length
      ? { tone: "new", text: newDevices.length === 1 ? t("coverageAddsDevicesOne") : t("coverageAddsDevicesMany", { count: newDevices.length }), detail: t("coverageOthersLoaded", { from: date(from), to: date(to) }) }
      : { tone: "warning", text: t("coverageNothingNew"), detail: `${date(from)} – ${date(to)}` };
  }
  // New readings start one interval after the last published one (a last reading at 23:45 means the next day).
  const newFrom = new Date(Date.parse(publishedTo) + (batch.inspection.typicalIntervalMinutes ?? 15) * 60_000).toISOString();
  return {
    tone: "new",
    text: t("coverageNew", { from: date(newFrom), to: date(to) }),
    detail: t("coverageOverlap", { from: date(from), to: date(publishedTo) }),
  };
};

function WaitingFile({ batch, publishedTo, knownDevices, t, dateLocale }: { batch: EnergyImportBatchDto; publishedTo?: string; knownDevices: string[]; t: T; dateLocale: string }) {
  const coverage = describeFileCoverage(batch, publishedTo, knownDevices, t, dateLocale);
  const date = dateIn(dateLocale);
  return (
    <li className={`rounded-lg px-3 py-2 text-xs ${coverage.tone === "warning" ? "bg-amber-50 text-amber-900" : "bg-surface-subtle"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{batch.filename}</span>
        <span className="text-muted">{t("fileCovers", { from: date(batch.inspection.coverageFrom), to: date(batch.inspection.coverageTo) })}</span>
      </div>
      <p className="mt-1">
        <span className={`font-semibold ${coverage.tone === "new" ? "text-emerald-800" : ""}`}>{coverage.text}</span>
        {coverage.detail ? <span className="text-muted"> · {coverage.detail}</span> : null}
      </p>
    </li>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">{children}</section>;
}

function SectionTitle({ number, title, hint }: { number: number; title: string; hint: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{number}</span>
      <div>
        <h3 className="text-[15px] font-semibold leading-7">{title}</h3>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}

function StatusDot({ tone }: { tone: "green" | "grey" }) {
  return <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone === "green" ? "bg-emerald-500" : "bg-slate-300"}`} />;
}

function CurrentData({ published, t, dateLocale }: { published: EnergyImportBatchDto[]; t: T; dateLocale: string }) {
  const summary = summariseImport(published);
  const date = dateIn(dateLocale);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
      <StatusDot tone={published.length ? "green" : "grey"} />
      {published.length ? (
        <p className="text-sm">
          <span className="font-semibold">{t("liveData", { from: date(summary.from), to: date(summary.to) })}</span>
          <span className="text-muted"> · {t("liveDetail", { devices: summary.devices.length, readings: numberIn(dateLocale)(summary.readings) })}</span>
        </p>
      ) : (
        <p className="text-sm"><span className="font-semibold">{t("noData")}</span><span className="text-muted"> {t("noDataHint")}</span></p>
      )}
    </div>
  );
}

function DropZone({ uploadingCount, disabled, onFiles, t }: { uploadingCount: number; disabled: boolean; onFiles: (files: File[]) => void; t: T }) {
  const [over, setOver] = useState(false);
  const accept = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])].filter((file) => /\.(csv|xlsx)$/iu.test(file.name));
    if (files.length) onFiles(files);
  };
  const dragProps = disabled ? {} : {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => { event.preventDefault(); setOver(false); accept(event.dataTransfer.files); },
  };
  return (
    <div>
      <label
        {...dragProps}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${over ? "border-primary bg-primary/5" : "border-border bg-surface-subtle/40"} ${disabled ? "cursor-wait opacity-70" : "cursor-pointer hover:border-primary/60 hover:bg-primary/5"}`}
      >
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-primary" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        {uploadingCount ? (
          <p className="text-sm font-semibold">{uploadingCount === 1 ? t("checkingOne") : t("checkingMany", { count: uploadingCount })}</p>
        ) : (
          <>
            <p className="text-sm font-semibold">{t("dropTitle")} <span className="text-primary underline underline-offset-2">{t("chooseFiles")}</span></p>
            <p className="text-xs text-muted">{t("dropHint")}</p>
          </>
        )}
        <input
          type="file"
          multiple
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => { accept(event.target.files); event.target.value = ""; }}
        />
      </label>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">{t("formatQuestion")}</summary>
        <p className="mt-2">{t("formatAnswer")}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-subtle px-3 py-2 font-mono text-[11px]">{"Device Name,Time,Active Energy\nMain DB,2026-09-01 00:00,10234.5\nMain DB,2026-09-01 00:15,10235.0"}</pre>
      </details>
    </div>
  );
}

function DeviceNames({ plan, saved, deviceListText, setDeviceListText, onError, t }: {
  plan: SmartSetupPlan;
  saved: number;
  deviceListText: string;
  setDeviceListText: (value: string) => void;
  onError: (message: string) => void;
  t: T;
}) {
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(plan.mode === "new");
  const [reading, setReading] = useState(false);
  const named = plan.rows.filter((row) => row.displayName !== row.sourceLabel).length;
  const total = plan.rows.find((row) => row.role === "total" && (plan.mode === "new" || row.location === "Main distribution board"));
  const readPhoto = async (file: File) => {
    setReading(true);
    try {
      const result = await configApi.extractEnergyDeviceListFromImage(file);
      if (result.devices.length === 0) onError(t("noTableInPhoto"));
      else setDeviceListText(["Code\tItems", ...result.devices.map((device) => `${device.code}\t${device.description}`)].join("\n"));
    } catch (reason) {
      onError(friendlyImportError(messageFrom(reason), t));
    } finally {
      setReading(false);
    }
  };
  const rows = showAll ? plan.rows : plan.rows.filter((row) => row.status !== "existing");
  const summary = [
    t("namedCount", { count: named }),
    saved ? t("listSaved") : "",
    total ? t("isSiteTotal", { name: total.sourceLabel }) : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-subtle px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">{t("devicesCount", { count: plan.rows.length })}</span>
          <span className="text-muted"> · {summary}</span>
        </p>
        <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-subtle">
          {editing ? t("doneNames") : t("editNames")}
        </button>
      </div>

      {editing ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs text-muted">{t("pasteHelp")}</p>
          <textarea
            autoFocus
            value={deviceListText}
            onChange={(event) => setDeviceListText(event.target.value)}
            rows={5}
            placeholder={"A18P\tCoffee machine x1, Warmer machine x1\nB2R\tBalcony light x1, Toilet light x3"}
            aria-label={t("deviceList")}
            className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <FileButton label={reading ? t("readingPhoto") : t("readPhoto")} accept="image/png,image/jpeg,image/webp" disabled={reading} onFile={(file) => void readPhoto(file)} />
            <FileButton label={t("loadCsv")} accept=".csv,.txt,text/csv,text/plain" onFile={(file) => void file.text().then(setDeviceListText)} />
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-xs text-muted">
              <tr><th className="px-4 py-2 font-medium">{t("columnDevice")}</th><th className="px-4 py-2 font-medium">{t("columnShownAs")}</th><th className="px-4 py-2 font-medium">{t("columnLocation")}</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.sourceLabel} className={row.status === "needs_placement" ? "bg-amber-50" : undefined}>
                  <td className="px-4 py-2 font-mono text-xs">{row.sourceLabel}</td>
                  <td className="px-4 py-2">
                    {row.displayName}
                    {row === total ? <Badge>{t("badgeSiteTotal")}</Badge> : null}
                    {row.status === "new" && plan.mode === "update" ? <Badge tone="green">{t("badgeNew")}</Badge> : null}
                  </td>
                  <td className="px-4 py-2 text-muted">{row.status === "needs_placement" ? t("notPlaced") : row.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {plan.rows.length > rows.length || (showAll && plan.mode === "update") ? (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="text-xs font-semibold text-primary hover:underline">
          {showAll ? t("showOnlyNew") : t("showAll", { count: plan.rows.length })}
        </button>
      ) : null}
    </div>
  );
}

function FileButton({ label, accept, disabled, onFile }: { label: string; accept: string; disabled?: boolean; onFile: (file: File) => void }) {
  return (
    <label className={`inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold ${disabled ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-surface-subtle"}`}>
      {label}
      <input type="file" accept={accept} disabled={disabled} className="sr-only" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onFile(file);
      }} />
    </label>
  );
}

function Badge({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "green" }) {
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone === "green" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{children}</span>;
}

function PublishBar({ plan, waiting, devicesTyped, step, busy, onPublish, t, dateLocale }: {
  plan: SmartSetupPlan;
  waiting: EnergyImportBatchDto[];
  devicesTyped: number;
  step: number | null;
  busy: boolean;
  onPublish: () => void;
  t: T;
  dateLocale: string;
}) {
  const date = dateIn(dateLocale);
  const steps = [t("stepSaving"), t("stepReading"), t("stepPublishing")];
  const nothingToDo = plan.mode === "update" && !plan.upgraded && devicesTyped === 0 && plan.newLabels.length === 0 && waiting.length === 0;
  const blocked = plan.unplacedLabels.length > 0;
  const range = summariseImport(waiting);
  const span = { from: date(range.from), to: date(range.to) };
  const description = plan.mode === "new"
    ? t("publishNew", { count: plan.rows.length, ...span })
    : waiting.length
      ? plan.newLabels.length
        ? t("publishFilesDevices", { count: waiting.length, devices: plan.newLabels.length, ...span })
        : waiting.length === 1 ? t("publishFilesOne", span) : t("publishFilesMany", { count: waiting.length, ...span })
      : devicesTyped
        ? t("publishNames")
        : plan.upgraded
          ? t("publishUpgrade")
          : t("publishNothing");
  return (
    <div className="sticky bottom-0 rounded-2xl border border-border bg-surface px-5 py-4 shadow-[0_-8px_24px_-16px_rgba(16,24,20,0.25)]">
      {step !== null ? (
        <ol className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label={t("progress")}>
          {steps.map((label, index) => (
            <li key={label} className={`flex items-center gap-2 ${index <= step ? "text-foreground" : "text-muted"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${index < step ? "bg-emerald-500 text-white" : index === step ? "bg-primary text-white" : "bg-slate-200 text-slate-500"}`}>
                {index < step ? "✓" : index + 1}
              </span>
              {label}{index === step ? "…" : ""}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-sm ${nothingToDo ? "text-muted" : ""}`}>{blocked ? t("publishBlocked") : description}</p>
          <button
            type="button"
            onClick={onPublish}
            disabled={busy || nothingToDo || blocked}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {plan.mode === "new" ? t("setUpAndPublish") : t("publish")}
          </button>
        </div>
      )}
    </div>
  );
}

export function ImportChangeSummary({ change, onDismiss }: { change: ImportChange; onDismiss: () => void }) {
  const t = useMessages(smartImportMessages);
  const { locale } = useEnergyIqLocale();
  const dateLocale = importDateLocale(locale);
  const date = dateIn(dateLocale);
  const number = numberIn(dateLocale);
  const { before, after } = change;
  const newDevices = after.devices.filter((device) => !before.devices.includes(device));
  const addedReadings = Math.max(0, after.readings - before.readings);
  const stats = [
    { label: t("statCovers"), value: `${date(after.from)} – ${date(after.to)}`, note: before.to ? t("wasUpTo", { date: date(before.to) }) : t("firstImport") },
    { label: t("statReadings"), value: number(addedReadings), note: t("inTotal", { count: number(after.readings) }) },
    { label: t("statDevices"), value: String(after.devices.length), note: newDevices.length ? t("newDevicesList", { count: newDevices.length, list: `${newDevices.slice(0, 4).join(", ")}${newDevices.length > 4 ? "…" : ""}` }) : t("noNewDevices") },
  ];
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5" aria-label={t("whatChanged")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-emerald-900">{t("published")}</h3>
          <p className="mt-1 text-xs text-emerald-800">{t("publishedBody")}</p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50">{t("dismiss")}</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-emerald-200 bg-white px-4 py-3">
            <p className="text-[11px] font-medium text-muted">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{stat.value}</p>
            <p className="mt-1 text-[11px] text-muted">{stat.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

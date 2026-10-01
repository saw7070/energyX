"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";

import {
  configApi,
  type EnergyImportBatchDto,
  type EnergyProjectSetupDocumentDto,
  type EnergyProjectSetupDto,
} from "../../../lib/config-api";
import {
  evaluateEnergyImportMaterializationGuard,
  pinEnergySourceManifest,
  sourceLabelsAcrossImportBatches,
} from "./project-setup-model";
import { buildSmartSetup, parseDeviceList, savedDeviceList, type SmartSetupPlan } from "./smart-setup";

/**
 * Add readings files and a device list, check the result, then publish in one step.
 * Self-contained (loads and saves its own project setup) so it can sit on the Admin Data Sources page or in
 * the Facility page's Upload data dialog. Only hand-uploaded files are handled here; projects fed by a live
 * connector are left alone.
 */

const messageFrom = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback;

/** Plain-English versions of the server's error codes. */
export const friendlyImportError = (message: string): string => {
  const column = /ENERGYIQ_EXCEL_COLUMN_REQUIRED:(.+)$/u.exec(message)?.[1];
  if (column) return `A file is missing the "${column}" column. Each file needs Device Name, Time and Active Energy columns.`;
  if (message.includes("FILE_ASSET_REF_NOT_FOUND")) return "One of the uploaded files can no longer be found on the server. Upload it again, then publish.";
  if (message.includes("ENERGYIQ_EXCEL_FILE_INVALID")) return "Only .csv and .xlsx files can be uploaded.";
  if (message.includes("ENERGYIQ_EXCEL_EMPTY")) return "That file has no rows of readings.";
  if (/REVISION|CONFLICT/u.test(message)) return "This project's setup was changed somewhere else just now. Close and reopen this window, then try again.";
  if (message.includes("VISION_UNAVAILABLE")) return "Reading photos needs the AI connection, which isn't set up on this server. Paste the table from Excel instead.";
  if (message.includes("IMAGE_TYPE_UNSUPPORTED")) return "Use a PNG, JPEG or WebP image.";
  if (message.includes("IMAGE_SIZE_INVALID")) return "That image is too large (10 MB maximum).";
  if (message.includes("VISION_UNREADABLE") || message.includes("VISION_FAILED")) return "The photo couldn't be read. Try a clearer, straight-on photo, or paste the table instead.";
  return `Something went wrong: ${message}`;
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

const shortDate = (value?: string): string => value
  ? new Date(value).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  : "—";

const IMPORT_BLOCKER_TEXT: Record<string, string> = {
  IMPORT_BATCH_REQUIRED: "Upload a readings file first.",
  METER_MAPPING_NOT_CONFIRMED: "Confirm Meter Mapping.",
  SOURCE_LABEL_UNMAPPED: "Some devices in the files are not placed yet; open Meter Mapping.",
  MAPPING_SOURCE_INACTIVE: "Meter Mapping lists devices that are not in the uploaded files.",
  SOURCE_LABEL_DUPLICATE: "Two devices have the same name.",
  PROJECT_TIMEZONE_UNSAVED: "Save the project's timezone change first.",
};
export const explainImportBlocker = (reason: string): string => IMPORT_BLOCKER_TEXT[reason] ?? reason;

type ImportChange = { before: ImportSummary; after: ImportSummary };
const STEPS = ["Saving files", "Reading the data", "Publishing"] as const;

export function SmartImportPanel({ projectId, onChanged, onOpenMapping }: {
  projectId: string;
  /** Called after files are added or data is published, so the host page can reload. */
  onChanged?: () => void;
  /** Where to send the admin when a new device must be placed by hand; omitted where Meter Mapping is not available. */
  onOpenMapping?: () => void;
}) {
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
      setError(friendlyImportError(messageFrom(reason, "the project could not be loaded")));
      return null;
    } finally {
      setLoading(false);
    }
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

  const upload = async (files: File[]) => {
    setUploadingCount(files.length);
    setError(null);
    try {
      for (const file of files) await configApi.uploadEnergyExcelImport(projectId, file);
    } catch (reason) {
      setError(friendlyImportError(messageFrom(reason, "the file could not be checked")));
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
        setError(`Can't publish yet: ${guard.reasons.map(explainImportBlocker).join(" ")}`);
        await load();
        return;
      }
      setStep(1);
      for (const batch of [...uploads].reverse()) await configApi.materializeEnergyImportBatch(projectId, batch.id);
      setStep(2);
      await configApi.applyEnergyProjectChanges(projectId);
      const after = (await load())?.filter((batch) => batch.sourceKind === "excel") ?? uploads;
      setChange({ before, after: summariseImport(after) });
      setDeviceListText("");
      onChanged?.();
    } catch (reason) {
      setError(friendlyImportError(messageFrom(reason, "publishing failed")));
      await load();
    } finally {
      setStep(null);
    }
  };

  if (loading && !setup) return <p role="status" className="py-10 text-center text-sm text-muted">Loading…</p>;

  if (liveConnected) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <StatusDot tone="green" />
          <div>
            <h3 className="text-sm font-semibold">This project updates automatically</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Its readings come from the live meter connection, so there is nothing to upload. New data appears on its own.
            </p>
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
          <button type="button" onClick={() => setError(null)} className="text-xs font-semibold underline">Dismiss</button>
        </div>
      ) : null}
      {change ? <ImportChangeSummary change={change} onDismiss={() => setChange(null)} /> : null}

      <CurrentData published={published} />

      <Card>
        <SectionTitle number={1} title="Add data files" hint="CSV or Excel exports from your meters, e.g. from the Tuya app." />
        <DropZone uploadingCount={uploadingCount} disabled={busy} onFiles={(files) => void upload(files)} />
        {waiting.length ? (
          <ul className="mt-3 space-y-2" aria-label="Files ready to publish">
            {waiting.map((batch) => (
              <WaitingFile key={batch.id} batch={batch} publishedTo={summariseImport(published).to} knownDevices={summariseImport(published).devices} />
            ))}
          </ul>
        ) : null}
      </Card>

      {plan ? (
        <Card>
          <SectionTitle number={2} title="Check device names" hint="Optional. Names make charts and reports easier to read." />
          <DeviceNames plan={plan} saved={setup ? savedDeviceList(setup.draft.document, projectId).length : 0} deviceListText={deviceListText} setDeviceListText={setDeviceListText} onError={setError} />
          {plan.unplacedLabels.length > 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {plan.unplacedLabels.join(", ")} {plan.unplacedLabels.length === 1 ? "is a new device" : "are new devices"} that can't be placed automatically in this project's layout.
              {onOpenMapping ? <> <button type="button" className="font-semibold underline" onClick={onOpenMapping}>Place {plan.unplacedLabels.length === 1 ? "it" : "them"} in Meter Mapping</button> first.</> : " Ask an administrator to place them in Admin console › Meter Mapping first."}
            </p>
          ) : null}
        </Card>
      ) : null}

      {plan ? <PublishBar plan={plan} waiting={waiting} devicesTyped={devices.length} step={step} busy={busy} onPublish={() => void publish(plan.document)} /> : null}
    </div>
  );
}

/** One uploaded file: what it contains, and what it adds beyond the data already published. */
export const describeFileCoverage = (batch: EnergyImportBatchDto, publishedTo: string | undefined, knownDevices: string[]) => {
  const from = batch.inspection.coverageFrom;
  const to = batch.inspection.coverageTo;
  const devices = batch.inspection.sourceLabels.map((label) => label.label);
  const newDevices = devices.filter((device) => !knownDevices.includes(device));
  if (!from || !to) return { tone: "warning" as const, text: "No readable dates were found in this file." };
  if (!publishedTo || from > publishedTo) {
    return { tone: "new" as const, text: `New data: ${shortDate(from)} – ${shortDate(to)}`, detail: `${devices.length} devices${newDevices.length ? `, ${newDevices.length} new` : ""}` };
  }
  if (to <= publishedTo) {
    return newDevices.length
      ? { tone: "new" as const, text: `Adds ${newDevices.length} new device${newDevices.length === 1 ? "" : "s"}`, detail: `dates ${shortDate(from)} – ${shortDate(to)} are already loaded for the others` }
      : { tone: "warning" as const, text: "Nothing new: every date in this file is already loaded", detail: `${shortDate(from)} – ${shortDate(to)}` };
  }
  // New readings start one interval after the last published one (a last reading at 23:45 means the next day).
  const newFrom = new Date(Date.parse(publishedTo) + (batch.inspection.typicalIntervalMinutes ?? 15) * 60_000).toISOString();
  return {
    tone: "new" as const,
    text: `New data: ${shortDate(newFrom)} – ${shortDate(to)}`,
    detail: `${shortDate(from)} – ${shortDate(publishedTo)} is already loaded and won't be counted twice`,
  };
};

function WaitingFile({ batch, publishedTo, knownDevices }: { batch: EnergyImportBatchDto; publishedTo?: string; knownDevices: string[] }) {
  const coverage = describeFileCoverage(batch, publishedTo, knownDevices);
  return (
    <li className={`rounded-lg px-3 py-2 text-xs ${coverage.tone === "warning" ? "bg-amber-50 text-amber-900" : "bg-surface-subtle"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{batch.filename}</span>
        <span className="text-muted">File covers {shortDate(batch.inspection.coverageFrom)} – {shortDate(batch.inspection.coverageTo)}</span>
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

function CurrentData({ published }: { published: EnergyImportBatchDto[] }) {
  const summary = summariseImport(published);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
      <StatusDot tone={published.length ? "green" : "grey"} />
      {published.length ? (
        <p className="text-sm">
          <span className="font-semibold">Live data: {shortDate(summary.from)} – {shortDate(summary.to)}</span>
          <span className="text-muted"> · {summary.devices.length} devices · {summary.readings.toLocaleString("en-SG")} readings</span>
        </p>
      ) : (
        <p className="text-sm"><span className="font-semibold">No data yet.</span><span className="text-muted"> Add your first files below.</span></p>
      )}
    </div>
  );
}

function DropZone({ uploadingCount, disabled, onFiles }: { uploadingCount: number; disabled: boolean; onFiles: (files: File[]) => void }) {
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
          <p className="text-sm font-semibold">Checking {uploadingCount} file{uploadingCount === 1 ? "" : "s"}…</p>
        ) : (
          <>
            <p className="text-sm font-semibold">Drag files here, or <span className="text-primary underline underline-offset-2">choose files</span></p>
            <p className="text-xs text-muted">.csv or .xlsx · you can select several at once · overlapping dates are fine</p>
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
        <summary className="cursor-pointer select-none">What should the files look like?</summary>
        <p className="mt-2">Each file needs three columns: <strong>Device Name</strong>, <strong>Time</strong> and <strong>Active Energy</strong> (the meter's running kWh total). Other columns are ignored. Tuya exports already have these.</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-subtle px-3 py-2 font-mono text-[11px]">{"Device Name,Time,Active Energy\nMain DB,2026-09-01 00:00,10234.5\nMain DB,2026-09-01 00:15,10235.0"}</pre>
      </details>
    </div>
  );
}

function DeviceNames({ plan, saved, deviceListText, setDeviceListText, onError }: {
  plan: SmartSetupPlan;
  saved: number;
  deviceListText: string;
  setDeviceListText: (value: string) => void;
  onError: (message: string) => void;
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
      if (result.devices.length === 0) onError("No device table was found in that image. Try a clearer photo, or paste the table instead.");
      else setDeviceListText(["Code\tItems", ...result.devices.map((device) => `${device.code}\t${device.description}`)].join("\n"));
    } catch (reason) {
      onError(friendlyImportError(messageFrom(reason, "the photo could not be read")));
    } finally {
      setReading(false);
    }
  };
  const rows = showAll ? plan.rows : plan.rows.filter((row) => row.status !== "existing");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-subtle px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">{plan.rows.length} devices</span>
          <span className="text-muted"> · {named} named{saved ? ` · name list saved with this project` : ""}{total ? ` · ${total.sourceLabel} is the site total` : ""}</span>
        </p>
        <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-subtle">
          {editing ? "Done" : "Add or change names"}
        </button>
      </div>

      {editing ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs text-muted">Copy your device table from Excel (code, then what it powers) and paste it below, or use one of the buttons.</p>
          <textarea
            autoFocus
            value={deviceListText}
            onChange={(event) => setDeviceListText(event.target.value)}
            rows={5}
            placeholder={"A18P\tCoffee machine x1, Warmer machine x1\nB2R\tBalcony light x1, Toilet light x3"}
            aria-label="Device list"
            className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <FileButton label={reading ? "Reading photo…" : "Read from a photo"} accept="image/png,image/jpeg,image/webp" disabled={reading} onFile={(file) => void readPhoto(file)} />
            <FileButton label="Load a CSV" accept=".csv,.txt,text/csv,text/plain" onFile={(file) => void file.text().then(setDeviceListText)} />
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-xs text-muted">
              <tr><th className="px-4 py-2 font-medium">Device</th><th className="px-4 py-2 font-medium">Shown as</th><th className="px-4 py-2 font-medium">Location</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.sourceLabel} className={row.status === "needs_placement" ? "bg-amber-50" : undefined}>
                  <td className="px-4 py-2 font-mono text-xs">{row.sourceLabel}</td>
                  <td className="px-4 py-2">
                    {row.displayName}
                    {row === total ? <Badge>Site total</Badge> : null}
                    {row.status === "new" && plan.mode === "update" ? <Badge tone="green">New</Badge> : null}
                  </td>
                  <td className="px-4 py-2 text-muted">{row.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {plan.rows.length > rows.length || (showAll && plan.mode === "update") ? (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="text-xs font-semibold text-primary hover:underline">
          {showAll ? "Show only new devices" : `Show all ${plan.rows.length} devices`}
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

function PublishBar({ plan, waiting, devicesTyped, step, busy, onPublish }: {
  plan: SmartSetupPlan;
  waiting: EnergyImportBatchDto[];
  devicesTyped: number;
  step: number | null;
  busy: boolean;
  onPublish: () => void;
}) {
  const nothingToDo = plan.mode === "update" && !plan.upgraded && devicesTyped === 0 && plan.newLabels.length === 0 && waiting.length === 0;
  const blocked = plan.unplacedLabels.length > 0;
  const range = summariseImport(waiting);
  const description = plan.mode === "new"
    ? `Sets up ${plan.rows.length} devices and publishes data from ${shortDate(range.from)} to ${shortDate(range.to)}.`
    : waiting.length
      ? `Adds ${waiting.length} file${waiting.length === 1 ? "" : "s"} (${shortDate(range.from)} – ${shortDate(range.to)})${plan.newLabels.length ? ` and ${plan.newLabels.length} new device${plan.newLabels.length === 1 ? "" : "s"}` : ""}.`
      : devicesTyped
        ? "Updates the device names."
        : plan.upgraded
          ? "Updates this project so reports list every circuit."
          : "Everything is already published. Add newer files to extend the data.";
  return (
    <div className="sticky bottom-0 rounded-2xl border border-border bg-surface px-5 py-4 shadow-[0_-8px_24px_-16px_rgba(16,24,20,0.25)]">
      {step !== null ? (
        <ol className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="Publishing progress">
          {STEPS.map((label, index) => (
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
          <p className={`text-sm ${nothingToDo ? "text-muted" : ""}`}>{blocked ? "Place the new devices first, then publish." : description}</p>
          <button
            type="button"
            onClick={onPublish}
            disabled={busy || nothingToDo || blocked}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {plan.mode === "new" ? "Set up & publish" : "Publish"}
          </button>
        </div>
      )}
    </div>
  );
}

export function ImportChangeSummary({ change, onDismiss }: { change: ImportChange; onDismiss: () => void }) {
  const { before, after } = change;
  const newDevices = after.devices.filter((device) => !before.devices.includes(device));
  const addedReadings = Math.max(0, after.readings - before.readings);
  const stats = [
    { label: "Data now covers", value: `${shortDate(after.from)} – ${shortDate(after.to)}`, note: before.to ? `was up to ${shortDate(before.to)}` : "first import" },
    { label: "Readings added", value: addedReadings.toLocaleString("en-SG"), note: `${after.readings.toLocaleString("en-SG")} in total` },
    { label: "Devices", value: String(after.devices.length), note: newDevices.length ? `${newDevices.length} new: ${newDevices.slice(0, 4).join(", ")}${newDevices.length > 4 ? "…" : ""}` : "no new devices" },
  ];
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5" aria-label="What changed">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-emerald-900">Published</h3>
          <p className="mt-1 text-xs text-emerald-800">Overview, Analysis and reports now use the updated data.</p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50">Dismiss</button>
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

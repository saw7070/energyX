"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { buildSmartSetup, parseDeviceList, savedDeviceList } from "./smart-setup";

/**
 * Upload readings files and a device list, preview the resulting setup, then import and publish in one step.
 * Self-contained (loads and saves its own project setup) so it can sit on the Admin Data Sources page or in
 * a dialog on the Facility page.
 */

const primaryButton = "inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton = "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
const messageFrom = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback;

type ImportChange = { before: ImportSummary; after: ImportSummary };

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
  const [uploading, setUploading] = useState(false);
  const [applyStep, setApplyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      return { setup: nextSetup, batches: imports.batches };
    } catch (reason) {
      setError(messageFrom(reason, "Failed to load project data"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (files: File[]) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    let added = 0;
    let duplicates = 0;
    try {
      for (const file of files) {
        const result = await configApi.uploadEnergyExcelImport(projectId, file);
        if (result.duplicate) duplicates += 1;
        else added += 1;
      }
      setNotice(`${added} file(s) checked and added${duplicates ? `; ${duplicates} already uploaded before` : ""}. Review the devices below, then import.`);
    } catch (reason) {
      setError(messageFrom(reason, "File check failed"));
    } finally {
      await load();
      setUploading(false);
      onChanged?.();
    }
  };

  const run = async (prepared: EnergyProjectSetupDocumentDto) => {
    if (!setup || batches.length === 0 || applyStep) return;
    const before = summariseImport(batches.filter((batch) => batch.status === "materialized"));
    setError(null);
    setNotice(null);
    try {
      setApplyStep("Saving your files (1 of 3)…");
      const sourceManifest = await pinEnergySourceManifest(batches);
      const saved = await configApi.saveEnergyProjectSetupDraft(projectId, {
        expectedRevision: setup.draft.revision,
        document: { ...prepared, source_manifest: sourceManifest },
      });
      const guard = evaluateEnergyImportMaterializationGuard({ document: saved.draft.document, savedDocument: saved.draft.document, batches });
      if (!guard.ready) {
        setError(`Can't import yet: ${guard.reasons.map(explainImportBlocker).join(" ")}`);
        await load();
        return;
      }
      setApplyStep("Building readings (2 of 3)…");
      for (const batch of [...batches].reverse()) await configApi.materializeEnergyImportBatch(projectId, batch.id);
      setApplyStep("Publishing (3 of 3)…");
      await configApi.applyEnergyProjectChanges(projectId);
      const after = await load();
      setChange({ before, after: summariseImport(after?.batches ?? batches) });
      setDeviceListText("");
      onChanged?.();
    } catch (reason) {
      setError(messageFrom(reason, "Import failed"));
      await load();
    } finally {
      setApplyStep(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">{notice}</p> : null}
      {change ? <ImportChangeSummary change={change} onDismiss={() => setChange(null)} /> : null}

      <section className="rounded-xl border border-border bg-surface p-5" aria-label="Upload readings">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold">1. Upload readings</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              One or more <code>.xlsx</code> or <code>.csv</code> files with the columns <strong>Device Name</strong>, <strong>Time</strong> and <strong>Active Energy</strong> (the meter's running kWh total), e.g. a Tuya export. Overlapping days between files are fine.
            </p>
            {batches.length ? (() => {
              const total = summariseImport(batches);
              return <p className="mt-2 text-xs text-foreground">{batches.length} file(s) uploaded · {shortDate(total.from)} – {shortDate(total.to)} · {total.devices.length} device(s)</p>;
            })() : null}
          </div>
          <label className={`${primaryButton} ${uploading || applyStep ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
            {uploading ? "Checking files…" : "Upload readings files"}
            <input
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              disabled={uploading || applyStep !== null}
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length) void upload(files);
              }}
            />
          </label>
        </div>
      </section>

      {loading && !setup ? <p role="status" className="text-xs text-muted">Loading project data…</p> : null}
      {setup && batches.length > 0 ? (
        <SmartSetupCard
          projectId={projectId}
          document={setup.draft.document}
          batches={batches}
          deviceListText={deviceListText}
          setDeviceListText={setDeviceListText}
          busy={applyStep !== null || uploading}
          applyStep={applyStep}
          onRun={(prepared) => void run(prepared)}
          onOpenMapping={onOpenMapping ?? (() => setError("Place the new devices in Admin console › Meter Mapping first."))}
        />
      ) : null}
    </div>
  );
}

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

export function ImportChangeSummary({ change, onDismiss }: { change: { before: ImportSummary; after: ImportSummary }; onDismiss: () => void }) {
  const { before, after } = change;
  const newDevices = after.devices.filter((device) => !before.devices.includes(device));
  const addedReadings = Math.max(0, after.readings - before.readings);
  const stats = [
    { label: "Data now covers", value: `${shortDate(after.from)} – ${shortDate(after.to)}`, note: before.to ? `was up to ${shortDate(before.to)}` : "first import" },
    { label: "Readings added", value: addedReadings.toLocaleString("en-SG"), note: `${after.readings.toLocaleString("en-SG")} in total` },
    { label: "Devices", value: String(after.devices.length), note: newDevices.length ? `${newDevices.length} new: ${newDevices.slice(0, 4).join(", ")}${newDevices.length > 4 ? "…" : ""}` : "no new devices" },
  ];
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5" aria-label="What changed">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-emerald-900">What changed</h3>
          <p className="mt-1 text-xs text-emerald-800">The new readings are live. Overview, Analysis and reports now use the updated data.</p>
        </div>
        <button type="button" onClick={onDismiss} className={secondaryButton}>Dismiss</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-emerald-200 bg-white px-4 py-3">
            <p className="text-[11px] font-medium text-muted">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{stat.value}</p>
            <p className="mt-1 text-[11px] text-muted">{stat.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SmartSetupCard({
  projectId,
  document,
  batches,
  deviceListText,
  setDeviceListText,
  busy,
  applyStep,
  onRun,
  onOpenMapping,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  batches: EnergyImportBatchDto[];
  deviceListText: string;
  setDeviceListText: (value: string) => void;
  busy: boolean;
  applyStep: string | null;
  onRun: (prepared: EnergyProjectSetupDocumentDto) => void;
  onOpenMapping: () => void;
}) {
  const devices = useMemo(() => parseDeviceList(deviceListText), [deviceListText]);
  const saved = useMemo(() => savedDeviceList(document, projectId), [document, projectId]);
  const [reading, setReading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const readPhoto = async (file: File) => {
    setReading(true);
    setPhotoError(null);
    try {
      const result = await configApi.extractEnergyDeviceListFromImage(file);
      if (result.devices.length === 0) {
        setPhotoError("No device table was found in that image. Try a clearer photo, or paste the table instead.");
        return;
      }
      setDeviceListText(["Code\tItems", ...result.devices.map((device) => `${device.code}\t${device.description}`)].join("\n"));
    } catch (reason) {
      const message = messageFrom(reason, "Could not read the photo");
      setPhotoError(
        message.includes("VISION_UNAVAILABLE") ? "Reading photos needs the AI connection, which isn't set up on this server (LLM_API_KEY). Paste the table from Excel instead."
          : message.includes("IMAGE_TYPE_UNSUPPORTED") ? "Use a PNG, JPEG or WebP image."
            : message.includes("IMAGE_SIZE_INVALID") ? "That image is too large (10 MB maximum)."
              : message.includes("VISION_UNREADABLE") || message.includes("VISION_FAILED") ? "The photo couldn't be read. Try a clearer, straight-on photo, or paste the table instead."
                : message,
      );
    } finally {
      setReading(false);
    }
  };
  const plan = useMemo(() => buildSmartSetup({ document, projectId, labels: sourceLabelsAcrossImportBatches(batches), devices }), [batches, devices, document, projectId]);
  const pendingFiles = batches.filter((batch) => batch.status !== "materialized").length;
  const isNew = plan.mode === "new";
  const nothingToDo = !isNew && !plan.upgraded && devices.length === 0 && plan.newLabels.length === 0 && pendingFiles === 0 && document.meter_mapping?.confirmed;
  return (
    <section className="rounded-xl border border-primary/30 bg-surface p-5" aria-label="Smart setup">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold">2. Check devices and publish</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {isNew
              ? `Creates a distribution board, one location for each of the ${plan.rows.length} devices in your files and names the meters, then imports the readings and makes them live.`
              : plan.newLabels.length
                ? `Adds ${plan.newLabels.length} new device(s) and ${pendingFiles} new file(s), then shows what changed.`
                : pendingFiles
                  ? `Adds ${pendingFiles} new file(s) to the existing devices, then shows what changed.`
                  : plan.upgraded
                    ? "Updates this project so reports list every circuit alongside the site total."
                    : devices.length
                      ? "Applies the device names below to this project."
                    : "Everything uploaded is already imported. Upload newer files to extend the data."}
          </p>
          {isNew && plan.totalLabel ? (
            <p className="mt-1 text-xs text-muted"><strong>{plan.totalLabel}</strong> looks like the incoming supply, so it becomes the site total and the other devices show the breakdown.</p>
          ) : isNew ? (
            <p className="mt-1 text-xs text-muted">No incoming or main meter was found, so the site total is the sum of all devices.</p>
          ) : null}
        </div>
        <button
          type="button"
          className={primaryButton}
          disabled={busy || Boolean(nothingToDo) || plan.unplacedLabels.length > 0}
          onClick={() => onRun(plan.document)}
        >
          {applyStep ?? (isNew ? "Set up & publish" : "Import & publish")}
        </button>
      </div>

      <details className="mt-4 rounded-lg border border-border bg-surface-subtle/40 px-4 py-3" open={isNew && devices.length === 0}>
        <summary className="cursor-pointer select-none text-xs font-semibold">
          Device names {devices.length ? `(${devices.length} from your list)` : saved.length ? `(${saved.length} saved with this project)` : "(optional)"}
        </summary>
        <p className="mt-2 text-[11px] leading-5 text-muted">
          Paste your device list straight from Excel (two columns: code, then what it powers), load it as CSV, or read it from a photo or screenshot of the table. Devices not on the list keep their code as the name.
          {saved.length ? " The list is saved with the project, so devices added later are named automatically." : ""}
        </p>
        <textarea
          value={deviceListText}
          onChange={(event) => setDeviceListText(event.target.value)}
          rows={4}
          placeholder={"A18P\tCoffee machine x1, Warmer machine x1\nB2R\tBalcony light x1, Toilet light x3"}
          aria-label="Device list"
          className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-primary"
        />
        <label className={`mr-4 mt-2 inline-flex text-[11px] font-semibold text-primary ${reading ? "cursor-wait opacity-60" : "cursor-pointer hover:underline"}`}>
          {reading ? "Reading photo…" : "Read from photo"}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={reading} className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readPhoto(file);
          }} />
        </label>
        <label className="mt-2 inline-flex cursor-pointer text-[11px] font-semibold text-primary hover:underline">
          Load device list from CSV
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void file.text().then(setDeviceListText);
          }} />
        </label>
        {photoError ? <p className="mt-2 text-[11px] text-step-warning">{photoError}</p> : null}
        {reading ? null : devices.length > 0 && deviceListText.startsWith("Code\t") ? <p className="mt-1 text-[11px] text-muted">Check the rows read from the photo before continuing; edit any mistakes directly above.</p> : null}
      </details>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-subtle/60 text-[11px] text-muted">
            <tr><th className="px-3 py-2 font-medium">Device in file</th><th className="px-3 py-2 font-medium">Name in the app</th><th className="px-3 py-2 font-medium">Location</th><th className="px-3 py-2 font-medium">Role</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {plan.rows.map((row) => (
              <tr key={row.sourceLabel} className={row.status === "needs_placement" ? "bg-amber-50" : undefined}>
                <td className="px-3 py-2 font-mono">{row.sourceLabel}{row.status === "new" && !isNew ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-emerald-800">New</span> : null}</td>
                <td className="px-3 py-2">{row.displayName}</td>
                <td className="px-3 py-2">{row.location}</td>
                <td className="px-3 py-2">{row.role !== "total" ? "Breakdown" : isNew || row.location === "Main distribution board" ? "Site total" : `Total for ${row.location}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.unplacedLabels.length > 0 ? (
        <p className="mt-3 text-xs text-step-warning">
          {plan.unplacedLabels.join(", ")} {plan.unplacedLabels.length === 1 ? "is" : "are"} new and this project's layout was built by hand, so
          {" "}<button type="button" className="font-semibold underline" onClick={onOpenMapping}>place {plan.unplacedLabels.length === 1 ? "it" : "them"} in Meter Mapping</button> first.
        </p>
      ) : null}
    </section>
  );
}

const IMPORT_BLOCKER_TEXT: Record<string, string> = {
  IMPORT_BATCH_REQUIRED: "Upload a readings file first.",
  METER_MAPPING_NOT_CONFIRMED: "Confirm Meter Mapping.",
  SOURCE_LABEL_UNMAPPED: "Some devices in the file are not mapped yet; open Meter Mapping.",
  MAPPING_SOURCE_INACTIVE: "Meter Mapping lists devices that are not in the uploaded files; remove them or re-run Use all detected labels.",
  SOURCE_LABEL_DUPLICATE: "Two devices in Meter Mapping have the same name.",
  PROJECT_TIMEZONE_UNSAVED: "Save the project's timezone change first.",
};
export const explainImportBlocker = (reason: string): string => IMPORT_BLOCKER_TEXT[reason] ?? reason;


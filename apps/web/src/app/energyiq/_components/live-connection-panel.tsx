"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { configApi } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import type { Translate } from "@datafoundry/site-report";
import { liveConnectionMessages } from "./live-connection-messages";

export type LiveConnectionDto = {
  projectId: string;
  provider: "tuya";
  managedByServer: boolean;
  environmentProject?: boolean;
  connected: boolean;
  accountHint?: string;
  publishedSetup: boolean;
  meters: Array<{ meterPointId: string; name: string; sourceLabel: string; device?: { ref: string; name: string; productName?: string } }>;
  matchedCount: number;
  ready: boolean;
  schedule: { enabled: boolean; localHour: number; timezone: string };
  lastCheck?: { at: string; ok: boolean; message?: string };
  sync: { running: boolean; lastSuccessAt?: string; lastFailureAt?: string; lastErrorCode?: string; dataUntil?: string };
};

export type LiveDeviceDto = { ref: string; name: string; productName?: string; category?: string; online: boolean; matchedTo?: string };

type CheckDto = { ok: boolean; message?: string; deviceCount?: number; meters: Array<{ meterPointId: string; ok: boolean; reason?: string }> };
type LiveKey = keyof (typeof liveConnectionMessages)["en"] & string;
type T = Translate<LiveKey>;

const normalise = (value: string): string => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Pair meters with devices whose names match, without overriding a choice already made. */
export function suggestMatches(
  meters: LiveConnectionDto["meters"],
  devices: LiveDeviceDto[],
  current: Record<string, string>,
): Record<string, string> {
  const next = { ...current };
  const taken = new Set(Object.values(next).filter(Boolean));
  for (const meter of meters) {
    if (next[meter.meterPointId]) continue;
    const names = [meter.name, meter.sourceLabel].map(normalise).filter(Boolean);
    const exact = devices.filter((device) => !taken.has(device.ref) && names.includes(normalise(device.name)));
    const loose = exact.length > 0 ? exact : devices.filter((device) => {
      const name = normalise(device.name);
      return !taken.has(device.ref) && name.length >= 3 && names.some((candidate) => candidate.length >= 3 && (candidate.includes(name) || name.includes(candidate)));
    });
    if (loose.length === 1) {
      next[meter.meterPointId] = loose[0]!.ref;
      taken.add(loose[0]!.ref);
    }
  }
  return next;
}

/** The plain-language message for an error code from the live-connection endpoints. */
export function liveErrorKey(message: string): LiveKey {
  if (/ENERGYIQ_LIVE_ACCESS_(ID|SECRET)_INVALID/u.test(message)) return "error.credentials";
  if (message.startsWith("ENERGYIQ_LIVE_ACCOUNT_REJECTED")) {
    if (/:1114|ip\(|_ip_|allow/iu.test(message)) return "error.ip";
    if (/permission|28841|1106|subscri/iu.test(message)) return "error.permission";
    if (/TIMEOUT|UNREACHABLE|HTTP_ERROR|REQUEST_FAILED|fetch/iu.test(message)) return "error.unreachable";
    return "error.signIn";
  }
  if (message.includes("ENERGYIQ_LIVE_TAKEOVER_DEVICES_MISSING")) return "error.takeOverMissing";
  if (message.includes("ENERGYIQ_LIVE_TAKEOVER_UNAVAILABLE")) return "error.takeOverUnavailable";
  if (message.includes("ENERGYIQ_LIVE_SERVER_KEY_REQUIRED")) return "error.serverKey";
  if (message.includes("ENERGYIQ_LIVE_CREDENTIALS_UNREADABLE")) return "error.unreadable";
  if (message.includes("ENERGYIQ_LIVE_METERS_NOT_MATCHED")) return "error.notMatched";
  if (message.includes("ENERGYIQ_LIVE_DEVICE_NOT_FOUND")) return "error.deviceGone";
  if (message.includes("ENERGYIQ_LIVE_DEVICE_USED_TWICE")) return "error.usedTwice";
  if (message.includes("ENERGYIQ_LIVE_SYNC_UNAVAILABLE")) return "error.unavailable";
  if (message.includes("PUBLISHED_SETUP_REQUIRED") || message.includes("PUBLISHED_MAPPING_REQUIRED")) return "error.setupFirst";
  return "error.generic";
}

export function checkReasonKey(reason = ""): LiveKey {
  if (reason.includes("PROPERTY_REQUIRED:total_forward_energy")) return "reason.energy";
  if (reason.includes("PROPERTY_REQUIRED:cur_power")) return "reason.power";
  if (reason.includes("UNIT_INVALID")) return "reason.unit";
  return "reason.other";
}

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

/** Facility → Live connection: account, device per meter, then check and daily update. */
export function LiveConnectionPanel({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const t = useMessages(liveConnectionMessages);
  const { locale } = useEnergyIqLocale();
  const [connection, setConnection] = useState<LiveConnectionDto | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"account" | "devices" | "save" | "test" | "check" | "schedule" | "sync" | "disconnect" | null>(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [accessId, setAccessId] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [devices, setDevices] = useState<LiveDeviceDto[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<CheckDto | null>(null);
  // Test connection (any time) and Check devices (once every meter is matched) share one endpoint.
  const [checkFrom, setCheckFrom] = useState<"test" | "check">("check");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // "all": every meter shows a drop-down (first setup); a meter id: only that row is being changed.
  const [editing, setEditing] = useState<"all" | string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [lastReadings, setLastReadings] = useState<Map<string, string>>(new Map());
  const accessIdInput = useRef<HTMLInputElement>(null);

  const when = useCallback((iso: string) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(iso)), [locale]);
  // The watermark sits two hours into the next day; the readings run to the end of the day before it.
  const day = useCallback((iso: string) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "Asia/Singapore" }).format(new Date(Date.parse(iso) - 2 * 3_600_000 - 1)), [locale]);

  const adopt = useCallback((next: LiveConnectionDto) => {
    setConnection(next);
    setDraft(Object.fromEntries(next.meters.map((meter) => [meter.meterPointId, meter.device?.ref ?? ""])));
    setEditing(next.connected && !next.managedByServer && next.matchedCount === 0 ? "all" : null);
    setConfirmRemove(null);
  }, []);

  // When each meter last sent a reading, from uploads or live updates alike: what "Live" is judged on.
  const loadReadings = useCallback(() => {
    void Promise.resolve()
      .then(() => configApi.getEnergyProjectMeterHealth(projectId))
      .then((health) => setLastReadings(new Map(health.meters.flatMap((meter) => meter.lastReadingAt ? [[meter.meterPointId, meter.lastReadingAt] as const] : []))))
      .catch(() => undefined);
  }, [projectId]);
  useEffect(() => { loadReadings(); }, [loadReadings]);

  const load = useCallback(async () => {
    try {
      const { connection: next } = await configApi.liveConnectionRequest<{ connection: LiveConnectionDto }>(projectId);
      setLoadFailed(false);
      return next;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setConnection(null);
    setDevices(null);
    void load().then((next) => { if (next && !cancelled) adopt(next); });
    return () => { cancelled = true; };
  }, [load, adopt]);

  const loadDevices = useCallback(async () => {
    setBusy("devices");
    try {
      const { devices: next } = await configApi.liveConnectionRequest<{ devices: LiveDeviceDto[] }>(projectId, "devices");
      setDevices(next);
    } catch (reason) {
      setDevices([]);
      setError(t(liveErrorKey(messageOf(reason))));
    } finally {
      setBusy(null);
    }
  }, [projectId, t]);

  const canListDevices = Boolean(connection?.publishedSetup && (connection.connected || connection.managedByServer));
  useEffect(() => {
    if (canListDevices && devices === null) void loadDevices();
  }, [canListDevices, devices, loadDevices]);

  // While a fetch runs, look again every few seconds so the result appears without a reload.
  const running = connection?.sync.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (!next) return;
        setConnection(next);
        if (!next.sync.running) { loadReadings(); onChanged?.(); }
      });
    }, 5_000);
    return () => clearInterval(timer);
  }, [running, load, onChanged, loadReadings]);

  const act = async (kind: NonNullable<typeof busy>, work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (reason) {
      setError(t(liveErrorKey(messageOf(reason))));
    } finally {
      setBusy(null);
    }
  };

  const saveAccount = (event: FormEvent, takeOver = false) => {
    event.preventDefault();
    void act("account", async () => {
      const result = await configApi.liveConnectionRequest<{ connection: LiveConnectionDto; deviceCount: number }>(projectId, "account", {
        method: "PUT",
        body: JSON.stringify({ accessId: accessId.trim(), accessSecret: accessSecret.trim(), ...(takeOver ? { takeOver: true } : {}) }),
      });
      adopt(result.connection);
      setAccessId("");
      setAccessSecret("");
      setEditingAccount(false);
      setDevices(null);
      setCheck(null);
      setNotice(takeOver ? t("takenOver") : t("devicesFound", { count: result.deviceCount }));
    });
  };

  const putMatches = (matches: Record<string, string>, done: string) => void act("save", async () => {
    const result = await configApi.liveConnectionRequest<{ connection: LiveConnectionDto }>(projectId, "matches", { method: "PUT", body: JSON.stringify({ matches }) });
    adopt(result.connection);
    setCheck(null);
    setNotice(done);
  });
  const saveMatches = () => putMatches(Object.fromEntries(Object.entries(draft).filter(([, ref]) => ref)), t("saved"));

  const runCheck = (from: "test" | "check") => void act(from, async () => {
    setCheckFrom(from);
    const result = await configApi.liveConnectionRequest<{ check: CheckDto; connection: LiveConnectionDto }>(projectId, "check", { method: "POST", body: "{}" });
    setConnection(result.connection);
    setCheck(result.check);
    if (!result.check.ok && result.check.meters.length === 0 && result.check.message) setError(t(liveErrorKey(`ENERGYIQ_LIVE_ACCOUNT_REJECTED:${result.check.message}`)));
  });

  const saveSchedule = (enabled: boolean, localHour: number) => void act("schedule", async () => {
    const result = await configApi.liveConnectionRequest<{ connection: LiveConnectionDto }>(projectId, "schedule", { method: "PUT", body: JSON.stringify({ enabled, localHour }) });
    setConnection(result.connection);
    setNotice(t(result.connection.schedule.enabled ? "dailyOn" : "dailyOff"));
  });

  const fetchNow = () => void act("sync", async () => {
    const result = await configApi.liveConnectionRequest<{ connection: LiveConnectionDto }>(projectId, "sync", { method: "POST", body: "{}" });
    setConnection(result.connection);
    setNotice(t("fetchStarted"));
  });

  const disconnect = () => {
    if (!confirmDisconnect) { setConfirmDisconnect(true); return; }
    setConfirmDisconnect(false);
    void act("disconnect", async () => {
      const result = await configApi.liveConnectionRequest<{ connection: LiveConnectionDto }>(projectId, "", { method: "DELETE" });
      const handedBack = result.connection.managedByServer;
      adopt(result.connection);
      setDevices(null);
      setCheck(null);
      setNotice(t(handedBack ? "handedBack" : "disconnected"));
    });
  };

  const dirty = useMemo(() => Boolean(connection?.meters.some((meter) => (meter.device?.ref ?? "") !== (draft[meter.meterPointId] ?? ""))), [connection, draft]);
  const draftCount = Object.values(draft).filter(Boolean).length;

  if (loadFailed && !connection) {
    return <Card><p role="alert" className="text-sm">{t("loadFailed")}</p><button type="button" className={secondaryButton + " mt-3"} onClick={() => void load().then((next) => next && adopt(next))}>{t("retry")}</button></Card>;
  }
  if (!connection) return <p role="status" className="py-10 text-center text-sm text-muted">{t("loading")}</p>;

  if (!connection.publishedSetup) {
    return <Card>
      <h3 className="text-sm font-semibold">{t("setupFirstTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{t("setupFirstBody")}</p>
    </Card>;
  }

  const takenBy = new Map(Object.entries(draft).filter(([, ref]) => ref).map(([meterPointId, ref]) => [ref, meterPointId]));
  const failedChecks = new Map((check?.meters ?? []).filter((meter) => !meter.ok).map((meter) => [meter.meterPointId, meter.reason]));
  const accountForm = !connection.connected || editingAccount;
  const deviceByRef = new Map((devices ?? []).map((device) => [device.ref, device]));
  const hour = `${String(connection.schedule.localHour).padStart(2, "0")}:00`;
  type Meter = LiveConnectionDto["meters"][number];

  const savedMatches = (): Record<string, string> => Object.fromEntries(connection.meters
    .flatMap((meter) => meter.device ? [[meter.meterPointId, meter.device.ref] as const] : []));
  const resetDraft = () => setDraft(Object.fromEntries(connection.meters.map((meter) => [meter.meterPointId, meter.device?.ref ?? ""])));
  const saveRow = (meter: Meter) => {
    const next = savedMatches();
    const ref = draft[meter.meterPointId];
    if (ref) next[meter.meterPointId] = ref;
    else delete next[meter.meterPointId];
    putMatches(next, t("rowSaved", { meter: meter.name }));
  };
  const removeRow = (meter: Meter) => {
    if (confirmRemove !== meter.meterPointId) { setConfirmRemove(meter.meterPointId); return; }
    const next = savedMatches();
    delete next[meter.meterPointId];
    putMatches(next, t("rowRemoved", { meter: meter.name }));
  };

  /** Whether a meter is sending readings: judged on its last reading, then on what Tuya says about its device. */
  const statusOf = (meter: Meter): { tone: Tone; label: string; detail?: string } => {
    const last = lastReadings.get(meter.meterPointId);
    const detail = last ? t("status.lastReading", { when: when(last) }) : undefined;
    const withDetail = (tone: Tone, label: string) => ({ tone, label, ...(detail ? { detail } : {}) });
    if (!meter.device) return withDetail("grey", t("status.notConnected"));
    const device = deviceByRef.get(meter.device.ref);
    if (device && !device.online) return withDetail("red", t("status.offline"));
    if (last && Date.now() - Date.parse(last) <= 3 * 86_400_000) return withDetail("green", t("status.live"));
    if (last) return withDetail("amber", t("status.stale"));
    return withDetail("amber", t("status.waiting"));
  };

  const failedLast = Boolean(connection.sync.lastFailureAt && (!connection.sync.lastSuccessAt || connection.sync.lastFailureAt > connection.sync.lastSuccessAt));
  const overall: { tone: Tone; title: string; body: string } = !connection.connected
    ? { tone: "grey", title: t("overall.offTitle"), body: t("overall.noAccountBody") }
    : !connection.ready
      ? { tone: "amber", title: t("overall.partialTitle"), body: t("overall.partialBody", { matched: connection.matchedCount, total: connection.meters.length }) }
      : !connection.schedule.enabled
        ? { tone: "amber", title: t("overall.switchedOffTitle"), body: t("overall.switchedOffBody") }
        : failedLast
          ? { tone: "red", title: t("overall.failedTitle"), body: t("overall.failedBody", { code: connection.sync.lastErrorCode ?? "?", hour }) }
          : connection.sync.lastSuccessAt
            ? { tone: "green", title: t("overall.liveTitle"), body: t("overall.liveBody", { hour, date: connection.sync.dataUntil ? day(connection.sync.dataUntil) : "—" }) }
            : { tone: "amber", title: t("overall.waitingTitle"), body: t("overall.waitingBody", { hour }) };
  const overallCard = <div role="status" aria-label={overall.title} className={`flex items-start gap-3 rounded-2xl border px-5 py-4 ${TONE_BOX[overall.tone]}`}>
    <Dot tone={overall.tone} />
    <div><p className="text-sm font-semibold">{overall.title}</p><p className="mt-0.5 text-sm leading-6 opacity-90">{overall.body}</p></div>
  </div>;

  const banners = <>
    {error ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <span aria-hidden="true" className="mt-0.5 font-bold">!</span>
      <p className="flex-1">{error}</p>
      <button type="button" onClick={() => setError(null)} className="text-xs font-semibold underline">{t("dismiss")}</button>
    </div> : null}
    {notice ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p> : null}
  </>;

  const accountFields = <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted">{t("accessId")}
            <input ref={accessIdInput} value={accessId} onChange={(event) => setAccessId(event.target.value)} autoComplete="off" spellCheck={false} required className={inputClass} />
          </label>
          <label className="block text-xs font-semibold text-muted">{t("accessSecret")}
            <span className="relative mt-1 block">
              <input type={showSecret ? "text" : "password"} value={accessSecret} onChange={(event) => setAccessSecret(event.target.value)} autoComplete="new-password" spellCheck={false} required className={`${inputClass} mt-0 pr-16`} />
              <button type="button" onClick={() => setShowSecret((value) => !value)} className="absolute inset-y-0 right-2 my-auto h-7 rounded-md px-2 text-[11px] font-semibold text-primary hover:bg-primary/10" aria-label={t(showSecret ? "hideSecret" : "showSecret")}>{t(showSecret ? "hide" : "show")}</button>
            </span>
          </label>
        </div>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none font-semibold">{t("whereToFind")}</summary>
          <p className="mt-2 leading-5">{t("whereToFindBody")}</p>
        </details>
  </>;

  const deviceSelect = (meter: Meter) => <select aria-label={`${t("columnDevice")}: ${meter.name}`} value={draft[meter.meterPointId] ?? ""} onChange={(event) => setDraft({ ...draft, [meter.meterPointId]: event.target.value })} className={`${inputClass} mt-0`}>
    <option value="">{t("notConnected")}</option>
    {(devices ?? []).map((candidate) => {
      const owner = takenBy.get(candidate.ref);
      const elsewhere = owner !== undefined && owner !== meter.meterPointId;
      return <option key={candidate.ref} value={candidate.ref} disabled={elsewhere}>
        {candidate.name}{candidate.productName ? ` · ${candidate.productName}` : ""} · {t(candidate.online ? "online" : "offline")}{elsewhere ? ` ${t("usedElsewhere")}` : ""}
      </option>;
    })}
  </select>;

  const deviceLabel = (meter: Meter) => {
    if (!meter.device) return <span className="text-muted">—</span>;
    const device = deviceByRef.get(meter.device.ref);
    if (!device) return <span className="text-muted">{devices === null ? t("loadingDevices") : meter.device.name || t("deviceMissing")}</span>;
    return <span>{device.name}{device.productName ? <span className="text-muted"> · {device.productName}</span> : null}</span>;
  };

  /** Every meter with its device, whether it is sending readings, and what can be done to it. */
  const meterTable = (kind: "app" | "server" | "preview") => <div className="overflow-x-auto rounded-xl border border-border">
    <table className="w-full min-w-[680px] text-left text-sm">
      <thead className="bg-surface-subtle text-xs text-muted"><tr>
        <th className="px-4 py-2 font-medium">{t("columnMeter")}</th>
        <th className="px-4 py-2 font-medium">{t("columnDevice")}</th>
        <th className="px-4 py-2 font-medium">{t("columnStatus")}</th>
        {kind === "server" ? null : <th className="px-4 py-2 text-right font-medium"><span className="sr-only">{t("columnActions")}</span></th>}
      </tr></thead>
      <tbody className="divide-y divide-border">
        {connection.meters.map((meter) => {
          const reason = failedChecks.get(meter.meterPointId);
          const status = statusOf(meter);
          const rowEditing = kind === "app" && (editing === "all" || editing === meter.meterPointId);
          const locked = busy !== null || (editing !== null && editing !== meter.meterPointId);
          return <tr key={meter.meterPointId} className={reason ? "bg-amber-50" : rowEditing && editing !== "all" ? "bg-primary/5" : undefined}>
            <td className="px-4 py-2 align-top">
              <span className="font-medium">{meter.name}</span>
              {meter.sourceLabel !== meter.name ? <span className="ml-2 font-mono text-[11px] text-muted">{meter.sourceLabel}</span> : null}
              {reason ? <p className="mt-1 text-xs text-amber-900">{t(checkReasonKey(reason))}</p> : null}
            </td>
            <td className="px-4 py-2 align-top">{rowEditing ? deviceSelect(meter) : deviceLabel(meter)}</td>
            <td className="px-4 py-2 align-top">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_PILL[status.tone]}`}><Dot tone={status.tone} small />{status.label}</span>
              {status.detail ? <p className="mt-1 text-[11px] text-muted">{status.detail}</p> : null}
            </td>
            {kind === "server" ? null : <td className="whitespace-nowrap px-4 py-2 text-right align-top">
              {kind === "preview"
                ? <button type="button" className={rowButton} onClick={() => { accessIdInput.current?.focus(); setNotice(t("connectFirstShort")); }}>{t("match")}</button>
                : editing === meter.meterPointId
                  ? <>
                    <button type="button" className={rowButton} disabled={busy !== null} onClick={() => saveRow(meter)}>{busy === "save" ? t("saving") : t("saveRow")}</button>
                    <button type="button" className={rowButtonMuted} disabled={busy !== null} onClick={() => { resetDraft(); setEditing(null); }}>{t("cancel")}</button>
                  </>
                  : editing === "all" ? null
                  : meter.device
                    ? <>
                      <button type="button" className={rowButton} disabled={locked || !devices?.length} onClick={() => { setConfirmRemove(null); setEditing(meter.meterPointId); }}>{t("edit")}</button>
                      <button type="button" className={rowButtonDanger} disabled={locked} onBlur={() => setConfirmRemove(null)} onClick={() => removeRow(meter)}>{confirmRemove === meter.meterPointId ? t("removeConfirm") : t("remove")}</button>
                    </>
                    : <button type="button" className={rowButton} disabled={locked || !devices?.length} onClick={() => { setConfirmRemove(null); setEditing(meter.meterPointId); }}>{t("match")}</button>}
            </td>}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;

  const failedDevices = (result: CheckDto) => result.meters.filter((meter) => !meter.ok)
    .map((meter) => `${connection.meters.find((row) => row.meterPointId === meter.meterPointId)?.name ?? meter.meterPointId} (${t(checkReasonKey(meter.reason))})`).join(", ");
  const lastCheckedLine = connection.lastCheck ? <p className="text-xs text-muted">{t("lastChecked", { when: when(connection.lastCheck.at) })}</p> : null;
  const testLine = check && checkFrom === "test" ? check.deviceCount === undefined ? null : <div className="space-y-1 text-sm">
    <p className="font-medium text-emerald-800">{t("testOk", { count: check.deviceCount })}</p>
    {check.meters.length === 0 ? <p className="text-xs text-muted">{t("testNoMatches")}</p>
      : check.ok ? <p className="text-xs text-emerald-800">{t("testMatchedOk", { count: check.meters.length })}</p>
      : <p className="text-xs text-amber-900">{t("checkFailed")} {failedDevices(check)}</p>}
  </div> : lastCheckedLine;

  const checkLine = check && checkFrom === "test" ? null : check ? check.ok
    ? <p className="text-sm text-emerald-800">{t("checkOk", { count: check.meters.length })}</p>
    : check.meters.length > 0 ? <p className="text-sm text-amber-900">{t("checkFailed")} {failedDevices(check)}</p> : null
    : null;

  const devicesNote = devices === null || busy === "devices"
    ? <p role="status" className="mb-3 text-xs text-muted">{t("loadingDevices")}</p>
    : devices.length === 0 ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("noDevices")}</p> : null;

  if (connection.managedByServer) {
    return <div className="space-y-4">
      {banners}
      {overallCard}
      <Card>
        <div className="mb-4">
          <h3 className="text-sm font-semibold">{t("serverTitle")}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{t("serverBody")}</p>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t("matchedCount", { matched: connection.matchedCount, total: connection.meters.length })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void loadDevices()}>{t("refreshDevices")}</button>
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => runCheck("test")}>{busy === "test" ? t("testing") : t("testConnection")}</button>
          </div>
        </div>
        {devicesNote}
        {meterTable("server")}
        <div className="mt-3 space-y-2">{testLine}<SyncSummary connection={connection} when={when} day={day} t={t} /></div>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold">{t("takeOverTitle")}</h3>
        <p className="mb-4 mt-1 text-sm leading-6 text-muted">{t("takeOverBody")}</p>
        <form onSubmit={(event) => saveAccount(event, true)} className="space-y-3">
          {accountFields}
          <button type="submit" disabled={busy !== null || !accessId.trim() || !accessSecret.trim()} className={primaryButton}>{busy === "account" ? t("takingOver") : t("takeOver")}</button>
        </form>
      </Card>
    </div>;
  }

  return <div className="space-y-4">
    {banners}
    {overallCard}

    <Card>
      <Step number={1} title={t("step.account")} hint={t("step.accountHint")} done={connection.connected && !editingAccount} />
      {accountForm ? <form onSubmit={saveAccount} className="space-y-3">
        {accountFields}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy !== null || !accessId.trim() || !accessSecret.trim()} className={primaryButton}>{busy === "account" ? t("connecting") : t("connect")}</button>
          {editingAccount ? <button type="button" className={secondaryButton} onClick={() => setEditingAccount(false)}>{t("cancel")}</button> : null}
        </div>
      </form> : <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-subtle px-4 py-3">
          <div>
            <p className="text-sm font-medium">{t("connectedAs", { hint: connection.accountHint ?? "" })}</p>
            {connection.environmentProject ? <p className="mt-0.5 text-xs text-muted">{t("takenOverNote")}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => runCheck("test")}>{busy === "test" ? t("testing") : t("testConnection")}</button>
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => setEditingAccount(true)}>{t("change")}</button>
          </div>
        </div>
        {testLine}
      </div>}
    </Card>

    {connection.connected ? <Card>
      <Step number={2} title={t("step.match")} hint={t("step.matchHint")} done={connection.ready && editing === null} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><span className="font-semibold">{t("matchedCount", { matched: editing === "all" ? draftCount : connection.matchedCount, total: connection.meters.length })}</span>{editing === "all" && dirty ? <span className="text-amber-800"> · {t("unsaved")}</span> : null}</p>
        <div className="flex flex-wrap gap-2">
          {editing === "all" ? <button type="button" className={secondaryButton} disabled={!devices?.length || busy !== null} onClick={() => {
            const next = suggestMatches(connection.meters, devices ?? [], draft);
            const added = Object.values(next).filter(Boolean).length - draftCount;
            setDraft(next);
            setNotice(added > 0 ? t("matchByNameDone", { count: added }) : t("matchByNameNone"));
          }}>{t("matchByName")}</button>
            : <button type="button" className={secondaryButton} disabled={!devices?.length || busy !== null || editing !== null} onClick={() => { setConfirmRemove(null); setEditing("all"); }}>{t("editAll")}</button>}
          <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void loadDevices()}>{t("refreshDevices")}</button>
        </div>
      </div>
      {devicesNote}
      {meterTable("app")}
      {editing === "all" ? <div className="mt-3 flex justify-end gap-2">
        {connection.matchedCount > 0 ? <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => { resetDraft(); setEditing(null); }}>{t("cancel")}</button> : null}
        <button type="button" className={primaryButton} disabled={!dirty || busy !== null} onClick={saveMatches}>{busy === "save" ? t("saving") : t("save")}</button>
      </div> : null}
    </Card> : <Card>
      <Step number={2} title={t("step.match")} hint={t("step.matchHint")} done={false} />
      <p className="mb-3 rounded-lg bg-surface-subtle px-3 py-2 text-xs text-muted">{t("connectFirst", { count: connection.meters.length })}</p>
      {meterTable("preview")}
    </Card>}

    {connection.connected ? <Card>
      <Step number={3} title={t("step.switchOn")} hint={t("step.switchOnHint")} done={connection.schedule.enabled} />
      {!connection.ready ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("needAllMatched")}</p> : null}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={secondaryButton} disabled={!connection.ready || dirty || busy !== null} onClick={() => runCheck("check")}>{busy === "check" ? t("checking") : t("check")}</button>
          {checkLine}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-subtle px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={connection.schedule.enabled} disabled={busy !== null || (!connection.ready && !connection.schedule.enabled)} onChange={(event) => saveSchedule(event.target.checked, connection.schedule.localHour)} className="h-4 w-4 accent-[var(--color-primary,#1d513a)]" />
            {t("dailyUpdate")}
          </label>
          <select aria-label={t("dailyUpdate")} value={connection.schedule.localHour} disabled={busy !== null || !connection.connected} onChange={(event) => saveSchedule(connection.schedule.enabled, Number(event.target.value))} className={`${inputClass} mt-0 w-auto`}>
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>)}
          </select>
          <p className="basis-full text-xs text-muted">{t("dailyUpdateHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primaryButton} disabled={!connection.ready || dirty || busy !== null || running} onClick={fetchNow}>{t("fetchNow")}</button>
          {running ? <p role="status" className="text-sm text-muted">{t("fetching")}</p> : null}
        </div>
        <SyncSummary connection={connection} when={when} day={day} t={t} />
      </div>
    </Card> : null}

    {connection.connected ? <div className="flex justify-end">
      <button type="button" disabled={busy !== null} onClick={disconnect} onBlur={() => setConfirmDisconnect(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">{connection.environmentProject
        ? confirmDisconnect ? t("handBackConfirm") : t("handBack")
        : confirmDisconnect ? t("disconnectConfirm") : t("disconnect")}</button>
    </div> : null}
  </div>;
}

function SyncSummary({ connection, when, day, t }: { connection: LiveConnectionDto; when: (iso: string) => string; day: (iso: string) => string; t: T }) {
  const { sync } = connection;
  const failedLast = sync.lastFailureAt && (!sync.lastSuccessAt || sync.lastFailureAt > sync.lastSuccessAt);
  return <div className="space-y-1 text-xs text-muted">
    {sync.lastSuccessAt
      ? <p>{t("lastUpdated", { when: when(sync.lastSuccessAt) })}{sync.dataUntil ? ` · ${t("dataUntil", { when: day(sync.dataUntil) })}` : ""}</p>
      : <p>{t("neverUpdated")}</p>}
    {failedLast ? <p className="text-amber-900">{t("lastFailed", { code: sync.lastErrorCode ?? "?" })}</p> : null}
  </div>;
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">{children}</section>;
}

function Step({ number, title, hint, done }: { number: number; title: string; hint: string; done: boolean }) {
  return <div className="mb-4 flex items-start gap-3">
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"}`}>{done ? "✓" : number}</span>
    <div>
      <h3 className="text-[15px] font-semibold leading-7">{title}</h3>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  </div>;
}

type Tone = "green" | "amber" | "red" | "grey";
const TONE_DOT: Record<Tone, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", grey: "bg-slate-300" };
const TONE_PILL: Record<Tone, string> = { green: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-900", red: "bg-rose-50 text-rose-800", grey: "bg-surface-subtle text-muted" };
const TONE_BOX: Record<Tone, string> = { green: "border-emerald-200 bg-emerald-50 text-emerald-900", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-rose-200 bg-rose-50 text-rose-900", grey: "border-border bg-surface text-foreground" };

function Dot({ tone, small = false }: { tone: Tone; small?: boolean }) {
  return <span aria-hidden="true" className={`${small ? "h-1.5 w-1.5" : "mt-1.5 h-2.5 w-2.5"} shrink-0 rounded-full ${TONE_DOT[tone]}`} />;
}

const inputClass = "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const primaryButton = "inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40";
const rowButton = "rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40";
const rowButtonMuted = "rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
const rowButtonDanger = "rounded-md px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton = "rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";

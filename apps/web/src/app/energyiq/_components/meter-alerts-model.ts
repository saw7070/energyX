/**
 * The meter alerts the server keeps (apps/api energy-meter-alerts.ts), as the bell shows them: meters that stopped
 * sending (for the people who look after the hardware), a meter that used power it should never use, and hours of
 * unusual use (for the people who run the site). The server sends only what this reader may see; the wording is the
 * page's, in the reader's language.
 *
 * The shapes match the API (`GET /api/v1/energy/projects/:id/alerts` → `meterAlerts`, and
 * `/api/v1/energy/projects/:id/meter-alerts/settings`) field for field.
 */
import { configApi, type EnergyProjectAlertsDto } from "../../../lib/config-api";
import { intlLocale, type EnergyIqLocale, type Translate } from "./energyiq-messages";
import type { notificationMessages } from "./notification-messages";

export type MeterAlertKind = "meter_offline" | "never_used" | "usage_pattern" | "usage_pattern_more";
export type MeterAlertDto = {
  key: string;
  /** The key a reader marks read; meters sending again have their own, so that news is shown once. */
  readKey: string;
  kind: MeterAlertKind;
  status: "open" | "resolved";
  openedAt: string;
  resolvedAt?: string;
  details: Record<string, unknown>;
};
export type ProjectAlertsWithMetersDto = EnergyProjectAlertsDto & { meterAlerts?: MeterAlertDto[] };

export type MeterAlertSettingsDto = {
  projectId: string;
  /** Unusual hourly use alerts; on by default. */
  patternAlerts: boolean;
  /** Extra addresses for stopped-meter alerts, shown only to the people who may change them. */
  hardwareEmails: string[];
  maxHardwareEmails: number;
  canEditPattern: boolean;
  canEditRecipients: boolean;
};

export const getMeterAlertSettings = (projectId: string): Promise<MeterAlertSettingsDto> =>
  Promise.resolve().then(() => configApi.meterAlertSettingsRequest<MeterAlertSettingsDto>(projectId));
export const updateMeterAlertSettings = (projectId: string, body: { patternAlerts?: boolean; hardwareEmails?: string[] }): Promise<MeterAlertSettingsDto> =>
  Promise.resolve().then(() => configApi.meterAlertSettingsRequest<MeterAlertSettingsDto>(projectId, { method: "PUT", body: JSON.stringify(body) }));

export type MeterAlertBellKind = "meter-offline" | "never-used" | "pattern";
export type MeterAlertEntry = {
  key: string;
  readKey: string;
  tone: "warning" | "info";
  kind: MeterAlertBellKind;
  title: string;
  detail: string;
  href: string;
  at: string;
  /** The meters an open stopped-sending alert covers, so the bell does not list them again as stopped. */
  quietMeterIds: string[];
};

type NotificationTranslate = Translate<Extract<keyof typeof notificationMessages.en, string>>;
type OfflineMeter = { id: string; name: string; since: string };

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const meters = (value: unknown): OfflineMeter[] => Array.isArray(value)
  ? value.flatMap((item) => {
    const meter = item as Partial<OfflineMeter> | null;
    return meter && typeof meter.id === "string" && typeof meter.since === "string" ? [{ id: meter.id, name: text(meter.name) || meter.id, since: meter.since }] : [];
  })
  : [];

/** The bell's entries for the meter alerts, in the reader's language and the site's time zone (Singapore by default). */
export function meterAlertEntries(alerts: readonly MeterAlertDto[], input: { t: NotificationTranslate; locale: EnergyIqLocale; projectId: string; timeZone?: string }): MeterAlertEntry[] {
  const { t, projectId } = input;
  const locale = intlLocale(input.locale);
  const timeZone = input.timeZone ?? "Asia/Singapore";
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
  const clock = (iso: string) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: new Date(iso).getUTCMinutes() ? "2-digit" : undefined, timeZone }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(iso));
  const energy = (value: number, unit: "kW" | "kWh") => `${value.toLocaleString(locale, { maximumFractionDigits: value < 1 ? 2 : 1, minimumFractionDigits: value < 1 ? 2 : 1 })} ${unit}`;
  const facility = `/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: "availability" })}`;
  const analysis = `/energyiq/analysis?${new URLSearchParams({ projectId })}`;
  return alerts.flatMap((alert): MeterAlertEntry[] => {
    const details = alert.details ?? {};
    const base = { key: alert.readKey, readKey: alert.readKey, at: alert.resolvedAt && alert.readKey !== alert.key ? alert.resolvedAt : alert.openedAt };
    if (alert.kind === "meter_offline") {
      const list = meters(details.meters);
      if (!list.length) return [];
      const since = text(details.since) || list[0]!.since;
      const area = text(details.location);
      const title = list.length === 1
        ? t("meterOffline.one", { name: list[0]!.name, when: when(since) })
        : area ? t("meterOffline.group", { count: list.length, area, time: clock(since) }) : t("meterOffline.many", { count: list.length, when: when(since) });
      const back = text(details.back);
      const names = list.slice(0, 4).map((meter) => meter.name).join(", ") + (list.length > 4 ? "…" : "");
      const detail = alert.status === "resolved" && back
        ? t(number(details.filledLateKwh) > 0 ? "meterOffline.back" : "meterOffline.backPlain", { when: when(back) })
        : list.length === 1 ? t("meterOffline.detail") : t("meterOffline.detailGroup", { names });
      return [{ ...base, tone: alert.status === "open" ? "warning" : "info", kind: "meter-offline", title, detail, href: facility, quietMeterIds: alert.status === "open" ? list.map((meter) => meter.id) : [] }];
    }
    if (alert.kind === "never_used") {
      const start = text(details.start) || alert.openedAt;
      const hours = Math.max(1, number(details.hours));
      const detail = [
        hours > 1 ? t("neverUsed.detailMany", { hours, when: when(start) }) : t("neverUsed.detailOne", { date: day(start) }),
        details.ongoing === true ? t("neverUsed.still") : "",
      ].filter(Boolean).join(" ");
      return [{
        ...base, tone: "warning", kind: "never-used", href: analysis, quietMeterIds: [],
        title: t("neverUsed.title", { name: text(details.meterName), kwh: energy(number(details.totalKwh), "kWh"), time: clock(start) }), detail,
      }];
    }
    if (alert.kind === "usage_pattern") {
      const at = text(details.at) || text(details.start) || alert.openedAt;
      const direction = details.direction === "zero" || details.direction === "low" ? details.direction : "high";
      const hours = Math.max(1, number(details.hours));
      const end = text(details.end);
      return [{
        ...base, tone: "warning", kind: "pattern", href: analysis, quietMeterIds: [],
        title: t(`pattern.${direction}`, { name: text(details.meterName), kw: energy(number(details.kwh), "kW"), usual: energy(number(details.usualKwh), "kW"), time: clock(at) }),
        detail: alert.status === "resolved" && end && details.ongoing === false
          ? t(hours === 1 ? "pattern.detailHourBack" : "pattern.detailBack", { date: day(text(details.start) || at), hours, time: clock(end) })
          : t(hours === 1 ? "pattern.detailHour" : "pattern.detail", { date: day(text(details.start) || at), hours }),
      }];
    }
    if (alert.kind === "usage_pattern_more") {
      const names = Array.isArray(details.names) ? (details.names as unknown[]).map(text).filter(Boolean) : [];
      const count = number(details.count);
      if (!count) return [];
      return [{
        ...base, tone: "info", kind: "pattern", href: analysis, quietMeterIds: [],
        title: t("patternMore.title", { count }), detail: t("patternMore.detail", { names: names.join(", ") + (count > names.length ? "…" : "") }),
      }];
    }
    return [];
  });
}

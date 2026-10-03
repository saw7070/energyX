"use client";
import { useEffect, useState } from "react";
import { configApi, type EnergyLiveReadingsDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { liveNowMessages } from "./live-now-messages";
import { EnergyIcon } from "./icons";

/** How often the page asks again; the server reads the meters every 15 minutes. */
const REFRESH_MS = 60_000;

/** "Using 12.4 kW now · 86.2 kWh so far today", for a site with a live connection. Shows nothing otherwise. */
export function LiveNow({ projectId, className }: { projectId: string; className?: string }) {
  const t = useMessages(liveNowMessages);
  const { locale } = useEnergyIqLocale();
  const [live, setLive] = useState<EnergyLiveReadingsDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => configApi.getEnergyLiveReadings(projectId)
      .then((next) => { if (!cancelled) setLive(next); })
      .catch(() => { if (!cancelled) setLive(null); });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [projectId]);
  if (!live?.connected) return null;
  const number = (value: number) => value.toLocaleString(intlLocale(locale), { maximumFractionDigits: value < 10 ? 2 : 1 });
  const time = live.readAt
    ? new Date(live.readAt).toLocaleTimeString(intlLocale(locale), { hour: "numeric", minute: "2-digit" })
    : "";
  const figures = [
    live.powerKw !== undefined ? t("power", { power: number(live.powerKw) }) : null,
    live.todayKwh !== undefined ? t("today", { energy: number(live.todayKwh) }) : null,
  ].filter(Boolean).join(" · ");
  return <div className={className} aria-label={t("label")} role="status">
    <EnergyIcon name="bolt" />
    <p>
      <strong>{t("label")}</strong>{" "}
      {figures
        ? <>{figures} <span>({t("updated", { time, minutes: String(live.intervalMinutes) })})</span></>
        : live.readAt && live.officialMeterCount > 0
          ? t("partial", { reporting: String(live.reportingMeterCount), total: String(live.officialMeterCount) })
          : t("waiting", { minutes: String(live.intervalMinutes) })}
      {figures ? <><br /><span>{t("note")}</span></> : null}
    </p>
  </div>;
}

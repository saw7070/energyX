"use client";
import { useEffect, useState } from "react";
import { configApi } from "../../../lib/config-api";
import { useMessages } from "./energyiq-locale";
import { projectInformationMessages } from "./facility-messages";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const isWeekday = (day: string): day is (typeof WEEKDAYS)[number] => (WEEKDAYS as readonly string[]).includes(day);

export type ProjectInformation = {
  name: string; timezone: string; basis: "published";
  locations: Array<{ id: string; name: string; parentId: string | null }>;
  meters: Array<{ id: string; name: string; locationId: string; location: string; officialAggregation: boolean }>;
  calendar: { version: string; entries: Array<{ location: string; from: string; toExclusive: string | null; weekly: Record<string, Array<{ from: string; to: string }>>; exceptions: Array<{ date: string; label: string; operating: Array<{ from: string; to: string }> }> }> } | null;
  tariff: { version: string; entries: Array<{ location: string; from: string; toExclusive: string | null; currency: string; ratePerKwh: number; taxBasis: string | null; tax: { name: string; ratePct: number } | null }> } | null;
};

export function PublishedProjectInformation({ projectId }: { projectId: string }) {
  const t = useMessages(projectInformationMessages);
  const [data, setData] = useState<ProjectInformation | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; setData(null); setError(false);
    configApi.getEnergyProjectInformation<ProjectInformation>(projectId).then(value => { if (!cancelled) setData(value); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [projectId, attempt]);
  const effective = (entry: { from: string; toExclusive: string | null }) => entry.toExclusive ? t("effectiveBetween", { from: entry.from, to: entry.toExclusive }) : t("effectiveFrom", { from: entry.from });
  const taxBasis = (basis: string | null) => basis === "tax_inclusive" ? t("taxInclusive") : basis === "tax_exclusive" ? t("taxExclusive") : basis?.replaceAll("_", " ") ?? t("taxUnknown");
  if (error) return <section role="alert"><p>{t("loadFailed")}</p><button className="mt-2 underline" onClick={() => setAttempt(value => value + 1)}>{t("retry")}</button></section>;
  if (!data) return <p role="status">{t("loading")}</p>;
  return <section className="space-y-8">
    <header><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 text-muted">{data.name} · {data.timezone} · {t("published")}</p></header>
    <div className="grid gap-8 lg:grid-cols-2">
      <section><h2 className="mb-3 text-lg font-semibold">{t("locations")}</h2><ul className="space-y-4">{data.locations.map(location => <li key={location.id}><h3 className="font-medium">{location.name}</h3><ul className="mt-1 space-y-1 text-sm text-muted">{data.meters.filter(meter => meter.locationId === location.id).map(meter => <li key={meter.id}>{meter.name}</li>)}</ul></li>)}</ul>{!data.locations.length && <p>{t("noLocations")}</p>}</section>
      <div className="space-y-8"><section><h2 className="mb-3 text-lg font-semibold">{t("operatingHours")}</h2>{!data.calendar ? <p className="text-muted">{t("notConfigured")}</p> : data.calendar.entries.map((entry, index) => <div key={index} className="mb-5"><h3 className="font-medium">{entry.location}</h3><p className="text-sm text-muted">{effective(entry)}</p><dl className="mt-2 space-y-1">{Object.entries(entry.weekly).map(([day, ranges]) => <div key={day} className="flex flex-wrap justify-between gap-2"><dt className="capitalize">{isWeekday(day) ? t(`day.${day}`) : day}</dt><dd>{ranges.length ? ranges.map(range => `${range.from}–${range.to}`).join(", ") : t("closed")}</dd></div>)}</dl>{entry.exceptions.length > 0 && <details className="mt-3"><summary>{t("exceptions")}</summary><ul className="mt-2 text-sm">{entry.exceptions.map(item => <li key={item.date}>{item.date} · {item.label} · {item.operating.length ? item.operating.map(range => `${range.from}–${range.to}`).join(", ") : t("closed")}</li>)}</ul></details>}</div>)}</section>
      <section><h2 className="mb-3 text-lg font-semibold">{t("tariff")}</h2>{!data.tariff ? <p className="text-muted">{t("notConfigured")}</p> : data.tariff.entries.map((entry, index) => <div key={index} className="mb-4"><h3 className="font-medium">{entry.location} · {entry.currency} {entry.ratePerKwh} / kWh</h3><p className="text-sm text-muted">{effective(entry)}</p><p className="text-sm">{taxBasis(entry.taxBasis)}{entry.tax ? ` · ${entry.tax.name} ${entry.tax.ratePct}%` : ""}</p></div>)}</section></div>
    </div>
  </section>;
}

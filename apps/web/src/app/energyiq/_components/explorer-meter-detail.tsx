import { completeDailyAverage } from "./explorer-trend-model";
import { ExplorerTrends } from "./explorer-trends";
import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { ExplorerMeterQuality, formatMeterEnergy } from "./explorer-meter-quality";

type Meter = NonNullable<EnergyScopeAnalysisDto["explorerMeters"]>[number];
export function ExplorerMeterDetail({
  meter,
  analysis,
  loading,
  error,
  breadcrumbs,
  onSelect,
  onHealth,
}: {
  meter: Meter;
  analysis: EnergyScopeAnalysisDto | null;
  loading: boolean;
  error: string | null;
  breadcrumbs: Array<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  onHealth?: (a: EnergyScopeAnalysisDto | null) => void;
}) {
  // Bind the leaf to the analysis response's published directory, never a stale tree revision.
  const published = analysis?.explorerMeters?.find(
    (item) => item.id === meter.id && item.scopeId === meter.scopeId,
  );
  const circuit = published
    ? analysis?.circuits.find((item) => item.meterNodeId === meter.id)
    : undefined;
  const trace = published
    ? analysis?.virtualMeterTraces?.find(
        (item) => item.meterNodeId === meter.id,
      )
    : undefined;
  const available =
    meter.kind === "virtual"
      ? trace?.status === "available"
      : (circuit?.dataHealth?.validIntervalCount ?? 0) > 0;
  const usage = meter.kind === "virtual" ? trace?.usageKwh : circuit?.usageKwh;
  const average = completeDailyAverage(analysis, meter.id);
  const label = loading
    ? "Loading…"
    : available && usage != null
      ? formatMeterEnergy(usage)
      : "No data";
  const date = (value: string) =>
    new Date(value).toLocaleDateString("en-SG", {
      timeZone: analysis?.context.timezone ?? "Asia/Singapore",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  return (
    <section aria-label="Circuit details" className="space-y-5">
      <nav
        aria-label="Circuit breadcrumb"
        className="flex flex-wrap gap-2 text-xs text-muted"
      >
        {breadcrumbs.map((node, index) => (
          <span key={node.id}>
            {index > 0 && " / "}
            <button
              type="button"
              className="underline"
              onClick={() => onSelect(node.id)}
            >
              {node.name}
            </button>
          </span>
        ))}
      </nav>
      <header>
        <h1 className="text-2xl font-semibold">
          {published?.name ?? meter.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {(published?.circuitName ?? meter.circuitName) && `${published?.circuitName ?? meter.circuitName} · `}
          {meter.kind === "virtual" ? "Virtual circuit" : "Circuit"} ·{" "}
          {meter.role === "total"
            ? "Main / total"
            : meter.role === "component"
              ? "Submeter / component"
              : meter.role}{" "}
          · {meter.coverage}
        </p>
        {analysis && (
          <p className="mt-2 text-sm text-muted">
            {date(analysis.context.from)} –{" "}
            {date(new Date(Date.parse(analysis.context.to) - 1).toISOString())}{" "}
            · {analysis.context.timezone}
          </p>
        )}
      </header>
      {error && (
        <p role="alert" className="text-sm text-step-warning">
          Circuit data unavailable: {error}
        </p>
      )}
      {!loading && analysis && !published && (
        <p role="alert">
          The published meter configuration changed. Reload Explorer to refresh
          the device tree.
        </p>
      )}
      <dl className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Total energy</dt>
          <dd className="mt-2 text-2xl font-semibold">{label}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Daily average</dt>
          <dd className="mt-2 text-xl">{loading ? "Loading…" : average.value == null ? "No complete days" : `${average.value.toFixed(2)} kWh/day`}</dd>
          {!loading && average.days > 0 && <p className="mt-1 text-xs text-muted">Based on {average.days} complete days</p>}
        </div>
        <div>
          <dt className="text-xs text-muted">Peak interval power</dt>
          <dd className="mt-2 text-xl">
            {loading
              ? "Loading…"
              : meter.kind === "physical" && available
                ? `${circuit!.peakKw.toFixed(2)} kW`
                : meter.kind === "virtual" && trace?.peakKw != null
                  ? `${trace.peakKw.toFixed(2)} kW`
                  : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Data coverage</dt>
          <dd className="mt-2 text-xl">
            {loading
              ? "Loading…"
              : meter.kind === "virtual"
                ? available
                  ? "Inputs available"
                  : "Inputs incomplete"
                : available
                  ? `${circuit!.dataHealth!.coveragePct.toFixed(1)}%`
                  : "Missing readings"}
          </dd>
        </div>
      </dl>
      {!loading && meter.kind === "virtual" && available && usage != null && usage < 0 && (
        <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This calculation is below zero: the meters subtracted add up to more than the main meter. Check the
          calculation&apos;s meters, or whether a meter is wired or labelled wrongly.
        </p>
      )}
      {!loading && !error && published && <section aria-label="Data quality explanation" className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold">Selected-period coverage</h2>
        <ExplorerMeterQuality meter={published} circuit={circuit} trace={trace} catalog={analysis?.explorerMeters} />
      </section>}
      <p className="text-sm text-muted">
        {published?.includedInOfficialTotal
          ? "Included in the parent scope's published official route."
          : "Detail only; excluded from the parent scope's official total."}{" "}
        Do not add parent and circuit readings together.
      </p>
      <ExplorerTrends analysis={loading ? null : analysis} meterId={meter.id} onHealth={onHealth} />
      {published?.formula && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Published calculation</h2>
          <p className="mt-2 text-sm">{published.formula}</p>
        </section>
      )}
      {!loading && !available && (
        <p className="text-sm text-muted">
          This device remains in the published configuration. Missing readings
          or incomplete calculation inputs are not zero consumption.
        </p>
      )}
    </section>
  );
}

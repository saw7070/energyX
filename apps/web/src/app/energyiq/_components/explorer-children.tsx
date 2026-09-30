import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { ExplorerMeterQuality, formatMeterEnergy } from "./explorer-meter-quality";

type Scope = { id: string; parentId: string | null; name: string };
type Meter = NonNullable<EnergyScopeAnalysisDto["explorerMeters"]>[number];

export function ExplorerChildren({
  selectedId,
  nodes,
  analysis,
  loading,
  onSelect,
}: {
  selectedId: string;
  nodes: Scope[];
  analysis: EnergyScopeAnalysisDto | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const children = nodes.filter((node) => node.parentId === selectedId);
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  const circuits = new Map(
    analysis?.circuits.map((meter) => [meter.meterNodeId, meter]) ?? [],
  );
  const childFacts = new Map(
    analysis?.childScopes.map((scope) => [scope.nodeId, scope]) ?? [],
  );
  const catalog = analysis?.explorerMeters ?? [];
  function belongsTo(scopeId: string, parentId: string) {
    const visited = new Set<string>();
    let current: string | null = scopeId;
    while (current && !visited.has(current)) {
      if (current === parentId) return true;
      visited.add(current);
      current = nodes.find((node) => node.id === current)?.parentId ?? null;
    }
    return false;
  }
  function meterTable(meters: Meter[]) {
    if (!meters.length)
      return (
        <p className="px-4 py-3 text-xs text-muted">
          {loading
            ? "Loading meters…"
            : "No published meters attached in this scope."}
        </p>
      );
    return (
      <div className="overflow-x-auto"><p className="px-4 py-2 text-xs text-muted">Meter readings may overlap. Do not add them together.</p>
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-surface-subtle text-muted">
            <tr>
              {[
                "Device",
                "Energy used",
                "Readings",
              ].map((label) => (
                <th key={label} className="px-4 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meters.map((meter) => {
              const circuit = circuits.get(meter.id);
              const trace = analysis?.virtualMeterTraces?.find(
                (value) => value.meterNodeId === meter.id,
              );
              const valid =
                meter.kind === "virtual"
                  ? trace?.status === "available"
                  : (circuit?.dataHealth?.validIntervalCount ?? 0) > 0;
              const usage =
                meter.kind === "virtual" ? trace?.usageKwh : circuit?.usageKwh;
              const coverage = circuit?.dataHealth?.coveragePct;
              return (
                <tr
                  key={meter.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3">
                    <strong>{meter.name}</strong>
                    <div className="mt-1 text-muted">
                      {names.get(meter.scopeId) ?? "Unknown space"} ·{" "}
                      {meter.category}
                    </div>
                    <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Meter setup</summary><div className="mt-2 space-y-1"><p>{meter.kind === "virtual" ? "Virtual" : meter.role === "total" ? "Main / total" : meter.role === "component" ? "Submeter / component" : "Standalone"}</p><p>{meter.coverage}</p>{meter.formula && <p>{meter.formula}</p>}<p>{meter.includedInOfficialTotal ? "Included in official route" : "Excluded · detail only"}</p></div></details>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-base font-semibold tabular-nums">
                    {loading
                      ? "Loading…"
                      : valid && usage != null
                        ? formatMeterEnergy(usage)
                        : "No data"}
                  </td>
                  <td className="px-4 py-4">{loading ? "Loading…" : <><ExplorerMeterQuality compact meter={meter} circuit={circuit} trace={trace} catalog={catalog} />{coverage != null && <p className="mt-2 text-xs text-muted">{coverage.toFixed(1)}% coverage</p>}</>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section aria-label="Child spaces and meters" className="mt-8 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Energy by space and device</h2>
        <p className="mt-1 text-xs text-muted">
          {analysis ? `${new Date(analysis.context.from).toLocaleDateString("en-SG", {timeZone:analysis.context.timezone})} – ${new Date(Date.parse(analysis.context.to)-1).toLocaleDateString("en-SG", {timeZone:analysis.context.timezone})} · ` : ""}Open a space or expand its readings.
        </p>
      </div>
      {children.map((child) => {
        const fact = childFacts.get(child.id);
        const valid = (fact?.dataHealth?.validIntervalCount ?? 0) > 0;
        return (
          <section
            key={child.id}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => onSelect(child.id)}
                className="text-sm font-semibold underline underline-offset-4"
              >
                {child.name}
              </button>
              <span className="text-base font-semibold tabular-nums">
                {loading
                  ? "Loading…"
                  : valid
                    ? `${fact!.usageKwh.toFixed(2)} kWh · ${fact!.dataHealth!.coveragePct.toFixed(1)}% coverage`
                    : "No data for official route"}
              </span>
            </div>
            <details>
              <summary className="cursor-pointer px-4 pb-3 text-xs text-muted">
                Meter details ·{" "}
                {
                  catalog.filter((meter) => belongsTo(meter.scopeId, child.id))
                    .length
                }
              </summary>
              {meterTable(
                catalog.filter((meter) => belongsTo(meter.scopeId, child.id)),
              )}
            </details>
          </section>
        );
      })}
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="px-4 py-3 text-sm font-semibold">
          Devices in {names.get(selectedId)}
        </h3>
        {meterTable(catalog.filter((meter) => meter.scopeId === selectedId))}
      </section>
      {!loading && analysis && !analysis.explorerMeters && (
        <p className="text-xs text-muted">
          Published meter directory unavailable. Reload after the analysis
          service is updated.
        </p>
      )}
    </section>
  );
}

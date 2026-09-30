import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";

type EnergyCircuitAnalysisDto = EnergyScopeAnalysisDto["circuits"][number];
type EnergyVirtualMeterTraceDto = NonNullable<EnergyScopeAnalysisDto["virtualMeterTraces"]>[number];

type Meter = NonNullable<EnergyScopeAnalysisDto["explorerMeters"]>[number];
type Notice = { label: string; explanation: string; warning: boolean };

export function formatMeterEnergy(value: number): string {
  if (value > 0 && value < 0.01) return "<0.01 kWh";
  if (value < 0 && value > -0.01) return "−<0.01 kWh";
  return `${value.toFixed(2)} kWh`;
}

export function meterQualityNotices(meter: Meter, circuit?: EnergyCircuitAnalysisDto, trace?: EnergyVirtualMeterTraceDto, catalog: Meter[] = []): Notice[] {
  if (meter.kind === "virtual") {
    if (!trace || trace.status !== "available" || trace.usageKwh == null) {
      const missing = trace?.missingTermMeterNodeIds?.map(id => {
        const input = catalog.find(item => item.id === id);
        return input ? `${input.name}${input.circuitName && input.circuitName !== input.name ? ` (${input.circuitName})` : ""}` : id;
      }) ?? [];
      return [{label:"Inputs incomplete", warning:true, explanation:`Cannot calculate complete energy.${missing.length ? ` Missing or incomplete inputs: ${missing.join(", ")}.` : " Input readings are unavailable."} Missing inputs are not zero consumption.`}];
    }
    const affected = (trace.terms ?? []).filter(term => !term.dataHealth || term.dataHealth.coveragePct < 100 || term.dataHealth.validIntervalCount < term.dataHealth.expectedMeterIntervalCount || term.dataHealth.qualityEventCount > 0);
    const notices: Notice[] = affected.length ? [{label:"Input quality review",warning:true,explanation:`Partial coverage or quality concerns in: ${affected.map(term => catalog.find(item=>item.id===term.meterNodeId)?.name ?? term.name).join(", ")}. This calculation uses available input totals and may not represent the full period.`}] : [];
    if (!trace.terms?.length) notices.push({label:"Input quality unavailable",warning:true,explanation:"Input-level coverage is unavailable; the calculation has not been verified for full-period coverage."});
    notices.push({label:trace.usageKwh === 0 ? "Calculated zero" : "Inputs available",warning:false,explanation:trace.usageKwh === 0 ? "The input calculation equals zero. This does not establish whether a circuit is switched off." : "A numeric input is available for each formula term; check input coverage before relying on the period total."});
    return notices;
  }
  const health = circuit?.dataHealth;
  if (!health || health.validIntervalCount <= 0 || !Number.isFinite(circuit?.usageKwh)) {
    return [{label:"Missing readings",warning:true,explanation:"No usable readings in the selected period. Check device connectivity, collection and data quality; this does not confirm an equipment fault."}];
  }
  const notices: Notice[] = [];
  const incomplete = health.validIntervalCount < health.expectedMeterIntervalCount || health.coveragePct < 100;
  if (incomplete) {
    const unavailable = Math.max(0, health.expectedMeterIntervalCount - health.validIntervalCount);
    notices.push({label:health.coveragePct >= 97 ? "Minor gaps" : "Incomplete data",warning:health.coveragePct < 97,explanation:`${health.coveragePct.toFixed(1)}% coverage.${unavailable > 0 ? ` ${unavailable} expected intervals have missing or unusable readings.` : " Some expected readings are unavailable."} Energy covers available readings only; the full-period total may be incomplete.`});
  }
  if (Math.max(health.qualityEventCount ?? 0,circuit?.qualityEventCount ?? 0) > 0) {
    notices.push({label:"Quality review",warning:true,explanation:"Data quality events were recorded. Review source readings and collection; these events alone do not prove an equipment fault."});
  }
  if (circuit?.usageKwh === 0) {
    notices.push({label:incomplete ? "Zero in available data" : "Zero consumption",warning:false,explanation:`${incomplete ? "Available valid readings" : "Valid readings"} show zero period energy. The circuit may be unused or have no load; its switch state and equipment condition are unconfirmed. An unchanged cumulative meter can also represent zero consumption.`});
  }
  if (!notices.length) notices.push({label:"Readings available",warning:false,explanation:"Valid readings cover the selected period. This is data availability, not confirmation of equipment health."});
  return notices;
}

export function ExplorerMeterQuality({meter,circuit,trace,catalog,compact=false}: {compact?:boolean;meter:Meter;circuit?:EnergyCircuitAnalysisDto;trace?:EnergyVirtualMeterTraceDto;catalog?:Meter[]}) {
  return <div aria-label="Meter data quality" className="space-y-2">
    {meterQualityNotices(meter,circuit,trace,catalog).map(notice => compact ? <details key={notice.label}><summary className={`cursor-pointer text-xs font-medium ${notice.warning ? "text-step-warning" : "text-muted"}`}>{notice.label}</summary><p className="mt-2 max-w-prose text-xs leading-5 text-muted">{notice.explanation}</p></details> : <div key={notice.label}>
      <span className={`text-xs font-medium ${notice.warning ? "text-step-warning" : "text-muted"}`}>{notice.label}</span>
      <p className="mt-1 max-w-prose text-xs text-muted">{notice.explanation}</p>
    </div>)}
  </div>;
}

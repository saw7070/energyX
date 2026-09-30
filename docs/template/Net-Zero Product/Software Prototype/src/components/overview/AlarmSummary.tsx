import { EmptyState } from "@/components/ui/EmptyState";
import { AlarmRecord } from "@/mock/types";

interface AlarmSummaryProps {
  alarms: AlarmRecord[];
}

export function AlarmSummary({ alarms }: AlarmSummaryProps) {
  const active = alarms.filter((alarm) => alarm.status === "active");
  const critical = active.filter((alarm) => alarm.severity === "critical").length;
  const warning = active.filter((alarm) => alarm.severity === "warning").length;
  const communicationFailure = active.filter((alarm) => alarm.category === "communication_failure").length;
  const dataUnavailable = active.filter((alarm) => alarm.category === "data_unavailable").length;

  return (
    <section className="panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Active Alarm Summary</h3>
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm xl:grid-cols-5">
        <Stat label="Total Active" value={active.length} tone="blue" />
        <Stat label="Critical" value={critical} tone="red" />
        <Stat label="Warning" value={warning} tone="amber" />
        <Stat label="Communication Failure" value={communicationFailure} tone="red" />
        <Stat label="Data Unavailable" value={dataUnavailable} tone="amber" />
      </div>

      {active.length === 0 ? (
        <EmptyState title="No active alarms" description="All sites are currently healthy with no active incident alarms." />
      ) : (
        <div className="space-y-2">
          {active.slice(0, 5).map((alarm) => (
            <div key={alarm.id} className="flex items-center justify-between rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
              <div>
                <p className="text-sm text-slate-100">{alarm.type}</p>
                <p className="text-xs text-slate-400">
                  {alarm.time} · {alarm.siteName}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-xs font-medium ${alarm.severity === "critical" ? "text-rose-300" : "text-amber-300"}`}>{alarm.severity}</p>
                <p className="text-xs text-slate-500">{alarm.status}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "blue" | "red" | "amber" }) {
  const toneClass =
    tone === "red" ? "text-rose-300 bg-rose-500/10" : tone === "amber" ? "text-amber-300 bg-amber-500/10" : "text-blue-300 bg-blue-500/10";
  return (
    <div className={`rounded-lg p-2 ${toneClass}`}>
      <p className="text-xs">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

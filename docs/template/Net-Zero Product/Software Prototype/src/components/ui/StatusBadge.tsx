import { HealthStatus } from "@/mock/types";

const statusStyles: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  warning: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  offline: "bg-slate-500/20 text-slate-300 border-slate-500/40"
};

export function StatusBadge({ status }: { status: HealthStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${statusStyles[status]}`}>
      {status}
    </span>
  );
}

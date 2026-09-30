import { ActionLogItem } from "@/mock/types";

export function ActionLogTable({ rows }: { rows: ActionLogItem[] }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Action Log</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Recommendation</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created Date</th>
              <th className="px-3 py-2 text-left">Expected Saving</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.recommendation}-${row.createdDate}`} className="border-t border-shell-600">
                <td className="px-3 py-2 text-slate-100">{row.recommendation}</td>
                <td className="px-3 py-2 text-slate-300">{row.owner}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 text-slate-300">{row.createdDate}</td>
                <td className="px-3 py-2 text-slate-300">{row.expectedSaving}</td>
                <td className="px-3 py-2 text-right">
                  <button className="rounded border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-700">Update</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ActionLogItem["status"] }) {
  const style =
    status === "Implemented"
      ? "bg-emerald-500/20 text-emerald-300"
      : status === "In Review"
        ? "bg-amber-500/20 text-amber-300"
        : status === "Rejected"
          ? "bg-rose-500/20 text-rose-300"
          : "bg-blue-500/20 text-blue-300";
  return <span className={`rounded px-2 py-1 text-xs ${style}`}>{status}</span>;
}

import { OverviewIssueItem } from "@/mock/types";

export function TopIssuesPanel({ issues }: { issues: OverviewIssueItem[] }) {
  return (
    <section className="panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Top Issues Panel</h3>
      <div className="space-y-2">
        {issues.map((issue) => (
          <article key={issue.id} className="rounded-lg border border-shell-600 bg-shell-900 p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-100">{issue.issueType}</p>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  issue.severity === "critical"
                    ? "bg-rose-500/20 text-rose-300"
                    : issue.severity === "warning"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-blue-500/20 text-blue-300"
                }`}
              >
                {issue.severity}
              </span>
            </div>
            <p className="text-xs text-slate-400">Affected location: {issue.location}</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-slate-500">Last updated: {issue.updatedAt}</p>
              <button className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500">View Details</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

"use client";

import nextDynamic from "next/dynamic";

/**
 * Keep the entry tiny so the browser can paint a shell before downloading the CopilotKit-heavy workbench chunk.
 */
const DataTasksApp = nextDynamic(() => import("./data-tasks-app"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      Loading workbench…
    </div>
  ),
});

export function DataTasksEntry() {
  return <DataTasksApp />;
}

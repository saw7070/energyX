import { redirect } from "next/navigation";

import { DataTasksEntry } from "./data-tasks-entry";

export const dynamic = "force-dynamic";

/**
 * The general-purpose SQL workbench inherited from DataFoundry is not part of EnergyX. Deployed servers send people to
 * EnergyX instead unless an operator turns it on for diagnostics with ENERGYX_LEGACY_WORKBENCH_ENABLED=true.
 */
export default function DataTasksPage() {
  const enabled = process.env.ENERGYX_LEGACY_WORKBENCH_ENABLED === "true" || process.env.NODE_ENV !== "production";
  if (!enabled) redirect("/energyiq/overview");
  return <DataTasksEntry />;
}

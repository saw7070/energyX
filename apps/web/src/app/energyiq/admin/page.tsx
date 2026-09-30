"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { useEnergyIqAccess } from "../_components/energyiq-access";
import { isAdminSection } from "./admin-sidebar";
import { EnergyIqAdminWorkbench } from "./project-setup-workbench";

export default function EnergyIqAdminPage() {
  const accessState = useEnergyIqAccess();

  if (accessState.loading) {
    return <AdminState title="Loading administration data…" />;
  }
  if (accessState.error) {
    return (
      <AdminState title="Administration data is unavailable">
        <p className="text-sm text-muted">{accessState.error}</p>
        <button
          type="button"
          onClick={() => void accessState.refresh()}
          className="mt-4 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white"
        >
          Retry
        </button>
      </AdminState>
    );
  }
  if (!accessState.access || accessState.access.role !== "admin") {
    return (
      <AdminState title="Admin access required">
        <Link href="/energyiq/overview" className="text-sm font-medium text-primary">
          Return to Overview
        </Link>
      </AdminState>
    );
  }

  return (
    <Suspense fallback={<AdminState title="Loading administration view…" />}>
      <AdminView accessState={accessState} />
    </Suspense>
  );
}

function AdminView({ accessState }: { accessState: ReturnType<typeof useEnergyIqAccess> }) {
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section");
  return (
    <EnergyIqAdminWorkbench
      accessState={accessState}
      initialSection={isAdminSection(requestedSection) ? requestedSection : "overview"}
    />
  );
}

function AdminState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

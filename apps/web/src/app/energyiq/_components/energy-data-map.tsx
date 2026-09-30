"use client";

import { useRouter } from "next/navigation";

import { LocaleProvider } from "../../../i18n/locale-context";
import { DataLinkPanel } from "../../data-tasks/components/DataLinkPanel";

export function EnergyDataMap() {
  const router = useRouter();

  return (
    <div className="h-full min-h-[560px]">
      <LocaleProvider>
        <DataLinkPanel
          readOnly
          onBack={() => router.push("/energyiq/ai")}
          onOpenMcpSettings={() => undefined}
        />
      </LocaleProvider>
    </div>
  );
}

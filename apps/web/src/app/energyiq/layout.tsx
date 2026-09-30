import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./energyiq-theme.css";

import { DataTaskIdentityProvider } from "../data-tasks/data-task-identity";
import { EnergyIqShell } from "./_components/energyiq-shell";
import { EnergyIqAccessProvider } from "./_components/energyiq-access";
import { THEME_BOOT_SCRIPT } from "./_components/energyiq-theme-boot";
import { LANGUAGE_BOOT_SCRIPT } from "./_components/energyiq-messages";
import { EnergyIqLocaleProvider } from "./_components/energyiq-locale";

export const metadata: Metadata = {
  title: "EnergyX",
  description: "Decision-first energy and water analysis",
};

export default function EnergyIqLayout({ children }: { children: ReactNode }) {
  return (
    <DataTaskIdentityProvider>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT + LANGUAGE_BOOT_SCRIPT }} />
      <EnergyIqLocaleProvider>
        <EnergyIqAccessProvider>
          <EnergyIqShell>{children}</EnergyIqShell>
        </EnergyIqAccessProvider>
      </EnergyIqLocaleProvider>
    </DataTaskIdentityProvider>
  );
}

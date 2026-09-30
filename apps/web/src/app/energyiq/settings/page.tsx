import type { Metadata } from "next";

import { EnergyIqSettings } from "./settings-client";

export const metadata: Metadata = {
  title: "Settings",
};

export default function EnergyIqSettingsPage() {
  return <EnergyIqSettings />;
}

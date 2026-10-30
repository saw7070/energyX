import type { Metadata } from "next";

import { EnergyIqTeamActivity } from "./activity-client";

export const metadata: Metadata = {
  title: "Team activity",
};

export default function EnergyIqTeamActivityPage() {
  return <EnergyIqTeamActivity />;
}

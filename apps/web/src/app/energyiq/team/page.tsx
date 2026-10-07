import type { Metadata } from "next";

import { EnergyIqTeam } from "./team-client";

export const metadata: Metadata = {
  title: "Team",
};

export default function EnergyIqTeamPage() {
  return <EnergyIqTeam />;
}

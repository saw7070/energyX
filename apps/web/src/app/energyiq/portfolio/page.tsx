import type { Metadata } from "next";

import { EnergyIqPortfolio } from "./portfolio-client";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default function EnergyIqPortfolioPage() {
  return <EnergyIqPortfolio />;
}

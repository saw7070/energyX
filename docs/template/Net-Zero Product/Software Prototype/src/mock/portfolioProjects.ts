export type PortfolioProjectType = "Commercial" | "Industrial" | "Residential" | "Hospitality" | "Data Centre";
export type PortfolioProjectStatus = "Operational" | "Under Maintenance";

export interface PortfolioProjectRecord {
  id: string;
  name: string;
  address: string;
  type: PortfolioProjectType;
  status: PortfolioProjectStatus;
  electricity: number;
  water: number;
  gas: number;
  eui: number;
  cost: number;
  alarms: number;
  gfa: number;
  carbon: number;
  map: { lat: number; lng: number };
}

export const portfolioProjectRecords: PortfolioProjectRecord[] = [
  { id: "pf-vg-hq", name: "VG HQ Tower", address: "1 Raffles Place, Singapore", type: "Commercial", status: "Operational", electricity: 1203, water: 0.8, gas: 9.8, eui: 231.3, cost: 4950, alarms: 3, gfa: 8000, carbon: 0.96, map: { lat: 1.284, lng: 103.851 } },
  { id: "pf-thomson-hub", name: "Thomson Logistics Hub", address: "45 Thomson Rd, Singapore", type: "Industrial", status: "Operational", electricity: 3450, water: 2.1, gas: 15.2, eui: 287.5, cost: 12300, alarms: 7, gfa: 12000, carbon: 2.45, map: { lat: 1.344, lng: 103.839 } },
  { id: "pf-marina-office", name: "Marina Bay Office", address: "Marina Blvd, Singapore", type: "Commercial", status: "Operational", electricity: 2100, water: 1.4, gas: 5.6, eui: 247.1, cost: 8200, alarms: 1, gfa: 7400, carbon: 1.42, map: { lat: 1.278, lng: 103.855 } },
  { id: "pf-jurong-dorm", name: "Jurong Dormitory", address: "Jurong West, Singapore", type: "Residential", status: "Operational", electricity: 4200, water: 8.5, gas: 22, eui: 280, cost: 18500, alarms: 12, gfa: 19000, carbon: 3.05, map: { lat: 1.339, lng: 103.705 } },
  { id: "pf-woodlands-mall", name: "Woodlands Mall", address: "Woodlands Ave, Singapore", type: "Commercial", status: "Under Maintenance", electricity: 5800, water: 3.2, gas: 8.4, eui: 290, cost: 22000, alarms: 5, gfa: 22000, carbon: 3.78, map: { lat: 1.438, lng: 103.787 } },
  { id: "pf-changi-dc", name: "Changi Data Centre", address: "Changi North, Singapore", type: "Data Centre", status: "Operational", electricity: 8900, water: 0.3, gas: 0.5, eui: 2966.7, cost: 35000, alarms: 2, gfa: 3000, carbon: 5.92, map: { lat: 1.368, lng: 103.978 } },
  { id: "pf-tuas-park", name: "Tuas Industrial Park", address: "Tuas South, Singapore", type: "Industrial", status: "Operational", electricity: 7200, water: 5.4, gas: 30, eui: 288, cost: 28000, alarms: 8, gfa: 25000, carbon: 4.81, map: { lat: 1.295, lng: 103.629 } },
  { id: "pf-sentosa-resort", name: "Sentosa Resort", address: "Sentosa, Singapore", type: "Hospitality", status: "Operational", electricity: 4500, water: 12, gas: 18, eui: 250, cost: 20000, alarms: 4, gfa: 16000, carbon: 3.09, map: { lat: 1.249, lng: 103.833 } }
];

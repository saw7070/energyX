import { eliteiotEnergyAnalysisData, ELITE_PROJECT_ID } from "@/mock/eliteiotEnergyAnalysisData";
import { NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

export function isEliteIotAnalysisProject(projectId: string): boolean {
  return projectId === ELITE_PROJECT_ID;
}

export function resolveEliteIotAnalysisData(projectId: string): NapEnergyAnalysisData | null {
  if (projectId === ELITE_PROJECT_ID) {
    return eliteiotEnergyAnalysisData;
  }
  return null;
}

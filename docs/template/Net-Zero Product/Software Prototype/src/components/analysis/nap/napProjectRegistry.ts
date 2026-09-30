import {
  napEnergyAnalysisData,
  NP_PROJECT_ID,
  NapEnergyAnalysisData
} from "@/mock/napEnergyAnalysisData";
import {
  napEnergyAnalysisDataV2,
  NP_V2_PROJECT_ID
} from "@/mock/napEnergyAnalysisDataV2";

export function isNapAnalysisProject(projectId: string): boolean {
  return projectId === NP_PROJECT_ID || projectId === NP_V2_PROJECT_ID;
}

export function resolveNapAnalysisData(projectId: string): NapEnergyAnalysisData | null {
  if (projectId === NP_PROJECT_ID) {
    return napEnergyAnalysisData;
  }
  if (projectId === NP_V2_PROJECT_ID) {
    return napEnergyAnalysisDataV2;
  }
  return null;
}

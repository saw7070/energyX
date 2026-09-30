/**
 * @file napEnergyAnalysisDataV2.ts
 * @brief Ngee Ann Poly v2.0 analysis — same dataset as NP Energy Analysis, separate project shell for iteration.
 */
import { napEnergyAnalysisData, NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

export const NP_V2_PROJECT_ID = "proj-nap-energy-analysis-v2";
export const NP_V2_PROJECT_NAME = "Ngee Ann Poly v2.0";

/** Shallow clone with v2 project identity; nested readings share the same source object until forked. */
export const napEnergyAnalysisDataV2: NapEnergyAnalysisData = {
  ...napEnergyAnalysisData,
  projectId: NP_V2_PROJECT_ID,
  projectName: NP_V2_PROJECT_NAME
};

import { SpaceNode } from "@/components/analysis/spaceHierarchy";
import { napEnergyAnalysisData, NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

function deviceLeaf(name: string): SpaceNode {
  return { name };
}

export function buildNapSpaceRoot(data: NapEnergyAnalysisData = napEnergyAnalysisData): SpaceNode {
  const { devicesByLevel } = data;

  return {
    name: data.projectName,
    children: [
      {
        name: "Level 6",
        children: devicesByLevel.level6.map(deviceLeaf)
      },
      {
        name: "Level 7",
        children: devicesByLevel.level7.map(deviceLeaf)
      }
    ]
  };
}

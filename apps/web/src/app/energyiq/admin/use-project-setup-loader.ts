import { useEffect } from "react";

export function useProjectSetupLoader(
  projectId: string,
  loadSetup: (projectId: string) => Promise<void>,
) {
  useEffect(() => {
    if (!projectId) return;
    void loadSetup(projectId);
  }, [loadSetup, projectId]);
}

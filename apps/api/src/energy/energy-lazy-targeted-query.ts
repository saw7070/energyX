import type { DataGateway } from "@datafoundry/data-gateway";

type LazyWorkspace = { scopedDatasource: { datasourceId: string } };

/**
 * Keep package-hit startup free of workspace materialization while preserving
 * the canonical governed DataGateway tools for a later, bounded fact query.
 */
export const createLazyEnergyTargetedQueryGateway = (input: {
  dataGateway: DataGateway;
  ensureWorkspace: () => Promise<LazyWorkspace>;
  virtualDatasourceId: string;
}): DataGateway => {
  let workspace: Promise<LazyWorkspace> | undefined;
  const realDatasourceId = async (requested: string): Promise<string> => {
    if (requested !== input.virtualDatasourceId) {
      throw new Error("ENERGYIQ_LAZY_DATASOURCE_IDENTITY_MISMATCH");
    }
    workspace ??= input.ensureWorkspace();
    return (await workspace).scopedDatasource.datasourceId;
  };
  return {
    listDataSources: (request) => input.dataGateway.listDataSources(request),
    supportTypes: () => input.dataGateway.supportTypes(),
    registerDataSource: () => Promise.reject(new Error("ENERGYIQ_LAZY_DATASOURCE_READ_ONLY")),
    testConnect: () => Promise.reject(new Error("ENERGYIQ_LAZY_DATASOURCE_READ_ONLY")),
    inspectSchema: async (request) => input.dataGateway.inspectSchema({
      ...request,
      datasource_id: await realDatasourceId(request.datasource_id),
    }),
    previewTable: async (request) => input.dataGateway.previewTable({
      ...request,
      datasource_id: await realDatasourceId(request.datasource_id),
    }),
    runSqlReadonly: async (request) => input.dataGateway.runSqlReadonly({
      ...request,
      datasource_id: await realDatasourceId(request.datasource_id),
    }),
    createArtifact: (request) => input.dataGateway.createArtifact(request),
  };
};

const PROJECT_EXPLORER_PATH = "/energyiq/explorer";

export function projectExplorerHrefForScope(
  baseHref: string | undefined,
  scopeId: string,
): string | undefined {
  const normalizedScopeId = scopeId.trim();
  if (!baseHref || !normalizedScopeId) return undefined;

  const [pathAndQuery] = baseHref.split("#", 1);
  const queryIndex = pathAndQuery.indexOf("?");
  const pathname = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  if (pathname !== PROJECT_EXPLORER_PATH) return undefined;

  const query = queryIndex === -1 ? "" : pathAndQuery.slice(queryIndex + 1);
  const searchParams = new URLSearchParams(query);
  searchParams.set("scopeId", normalizedScopeId);
  return `${PROJECT_EXPLORER_PATH}?${searchParams.toString()}`;
}

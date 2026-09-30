export type ProjectTreeNode = {
  id: string;
  parentId: string | null;
};

export type ProjectTreeSelection = {
  selectedId: string;
  expandedIds: Set<string>;
};

export function revealProjectTreeSelection<T extends ProjectTreeNode>(
  nodes: T[],
  expandedIds: ReadonlySet<string>,
  selectedId: string,
): ProjectTreeSelection {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nextExpandedIds = new Set(expandedIds);
  const visited = new Set<string>();
  let node = nodesById.get(selectedId);

  while (node?.parentId && !visited.has(node.parentId)) {
    visited.add(node.parentId);
    nextExpandedIds.add(node.parentId);
    node = nodesById.get(node.parentId);
  }

  return { selectedId, expandedIds: nextExpandedIds };
}

export function orderProjectNodesDepthFirst<T extends ProjectTreeNode>(nodes: T[]): T[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const childrenByParentId = new Map<string | null, T[]>();

  for (const node of nodes) {
    const parentId = node.parentId && nodeIds.has(node.parentId)
      ? node.parentId
      : null;
    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenByParentId.set(parentId, [node]);
    }
  }

  const ordered: T[] = [];
  const visited = new Set<string>();
  const visit = (node: T) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    for (const child of childrenByParentId.get(node.id) ?? []) {
      visit(child);
    }
  };

  for (const root of childrenByParentId.get(null) ?? []) {
    visit(root);
  }

  // Keep malformed or cyclic nodes visible so administrators can diagnose them.
  for (const node of nodes) {
    visit(node);
  }

  return ordered;
}

import { useState } from "react";
import { ChevronDown, ChevronRight, FolderTree } from "lucide-react";
import { HierarchyNode } from "@/mock/types";

interface HierarchyTreeProps {
  nodes: HierarchyNode[];
}

function TreeNode({ node }: { node: HierarchyNode }) {
  const [open, setOpen] = useState(true);
  const hasChildren = Boolean(node.children?.length);
  return (
    <div className="space-y-1">
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-slate-300 hover:bg-shell-700"
        onClick={() => setOpen((current) => !current)}
      >
        {hasChildren ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : <FolderTree className="h-4 w-4 text-slate-500" />}
        <span>{node.name}</span>
        <span className="ml-auto rounded bg-shell-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{node.level}</span>
      </button>
      {open && hasChildren ? (
        <div className="ml-5 border-l border-shell-600 pl-2">
          {node.children!.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HierarchyTree({ nodes }: HierarchyTreeProps) {
  return (
    <div className="panel p-3">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400">Hierarchy</p>
      <div className="space-y-1">
        {nodes.map((node) => (
          <TreeNode key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}

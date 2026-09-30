import { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
}

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="panel flex h-full min-h-52 flex-col items-center justify-center gap-2 p-6 text-center">
      {icon ? <div className="rounded-full bg-blue-500/20 p-3 text-blue-300">{icon}</div> : null}
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="max-w-md text-sm text-slate-400">{description}</p>
    </div>
  );
}

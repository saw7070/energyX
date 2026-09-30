import { ReactNode } from "react";

interface PageContainerProps {
  title: string;
  subtitle: string;
  breadcrumbs: string[];
  actions?: ReactNode;
  children: ReactNode;
}

export function PageContainer({ title, subtitle, breadcrumbs, actions, children }: PageContainerProps) {
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-3">
        <p className="text-xs text-slate-400">{breadcrumbs.join(" / ")}</p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">{title}</h1>
            <p className="text-sm text-slate-400">{subtitle}</p>
          </div>
          {actions}
        </div>
      </header>
      {children}
    </div>
  );
}

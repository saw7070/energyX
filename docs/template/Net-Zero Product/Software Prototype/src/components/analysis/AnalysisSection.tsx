import { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { RequirementGuideContent, RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

interface AnalysisSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  requirementGuide?: RequirementGuideContent;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

export function AnalysisSection({
  id,
  title,
  subtitle,
  requirementGuide,
  isCollapsed,
  onToggle,
  children
}: AnalysisSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          {requirementGuide ? (
            <RequirementGuideTitle title={title} content={requirementGuide} className="text-base font-semibold text-white" />
          ) : (
            <h2 className="text-base font-semibold text-white">{title}</h2>
          )}
          {subtitle ? <p className="text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        <button
          className="inline-flex items-center gap-1 rounded-md border border-shell-600 bg-shell-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-700"
          onClick={() => onToggle(id)}
        >
          {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          {isCollapsed ? "Expand" : "Collapse"}
        </button>
      </div>
      {!isCollapsed ? children : null}
    </section>
  );
}

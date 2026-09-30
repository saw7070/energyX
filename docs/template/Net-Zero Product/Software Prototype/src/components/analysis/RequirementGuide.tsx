import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { Info, X } from "lucide-react";

export interface RequirementGuideContent {
  title: string;
  summary: string;
  dataAcquisition: string[];
  chartGeneration: string[];
}

type RequirementGuideContextValue = {
  openGuide: (content: RequirementGuideContent) => void;
};

const RequirementGuideContext = createContext<RequirementGuideContextValue | null>(null);

function useRequirementGuideContext() {
  const context = useContext(RequirementGuideContext);
  if (!context) {
    throw new Error("RequirementGuide components must be used within RequirementGuideProvider.");
  }
  return context;
}

export function RequirementGuideProvider({ children }: { children: ReactNode }) {
  const [activeGuide, setActiveGuide] = useState<RequirementGuideContent | null>(null);
  const value = useMemo(
    () => ({
      openGuide: (content: RequirementGuideContent) => setActiveGuide(content)
    }),
    []
  );

  return (
    <RequirementGuideContext.Provider value={value}>
      {children}
      {activeGuide ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-shell-600 bg-shell-950 p-4 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white">{activeGuide.title}</h3>
                <p className="mt-1 text-xs text-slate-400">{activeGuide.summary}</p>
              </div>
              <button
                type="button"
                className="rounded border border-shell-600 p-1 text-slate-300 hover:text-white"
                onClick={() => setActiveGuide(null)}
                aria-label="Close requirement guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <section className="mb-3 rounded-md border border-shell-700 bg-shell-900 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-200">Data Acquisition</h4>
              <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
                {activeGuide.dataAcquisition.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-md border border-shell-700 bg-shell-900 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-200">Chart / Table Generation</h4>
              <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
                {activeGuide.chartGeneration.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
    </RequirementGuideContext.Provider>
  );
}

interface RequirementGuideTitleProps {
  title: string;
  content: RequirementGuideContent;
  className?: string;
}

export function RequirementGuideTitle({ title, content, className }: RequirementGuideTitleProps) {
  const { openGuide } = useRequirementGuideContext();
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 text-left hover:text-blue-300 ${className ?? ""}`}
      onClick={() => openGuide(content)}
      title="View requirements"
    >
      <span>{title}</span>
      <Info className="h-3.5 w-3.5 text-slate-400" />
    </button>
  );
}

export function RequirementGuideIconButton({ content, className }: { content: RequirementGuideContent; className?: string }) {
  const { openGuide } = useRequirementGuideContext();
  return (
    <button
      type="button"
      className={`inline-flex items-center rounded border border-shell-600 p-1 text-slate-300 hover:text-white ${className ?? ""}`}
      onClick={() => openGuide(content)}
      title="View requirements"
      aria-label="View requirements"
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  );
}

import React, { Component, ReactNode } from "react";
import { NapAnalysisView } from "@/components/analysis/nap/NapAnalysisView";
import { RequirementGuideProvider } from "@/components/analysis/RequirementGuide";
import { PageContainer } from "@/components/layout/PageContainer";
import { napEnergyAnalysisDataShare } from "@/mock/napEnergyAnalysisData.share";
class ShareErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-shell-950 p-6 text-slate-200">
          <h1 className="text-lg font-semibold text-rose-300">Failed to load Energy Analysis demo</h1>
          <pre className="mt-4 whitespace-pre-wrap rounded-md border border-rose-500/40 bg-shell-900 p-4 text-sm text-rose-100">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Minimal standalone shell for public NP Energy Analysis HTML export. */
export function NapShareApp() {
  const data = napEnergyAnalysisDataShare;

  return (
    <ShareErrorBoundary>
      <div className="flex min-h-screen flex-col bg-shell-950">
        <header className="flex h-14 shrink-0 items-center border-b border-shell-600 bg-shell-900 px-6">
          <span className="text-sm font-medium text-slate-200">{data.projectName}</span>
          <span className="ml-3 text-xs text-slate-500">Electricity Analysis · Demo dataset</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <PageContainer
            title="Electricity Analysis"
            subtitle="Electricity consumption patterns, anomalies, and recommendations"
            breadcrumbs={["Analysis", "Electricity Analysis"]}
          >
            <RequirementGuideProvider>
              <NapAnalysisView data={data} />
            </RequirementGuideProvider>
          </PageContainer>        </main>
      </div>
    </ShareErrorBoundary>
  );
}

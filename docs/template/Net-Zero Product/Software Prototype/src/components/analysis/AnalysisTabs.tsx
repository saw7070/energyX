import { SectionTabs } from "@/components/ui/SectionTabs";

const tabs = ["Electricity Analysis", "Water Analysis", "Gas Analysis"];

interface AnalysisTabsProps {
  activeTab: string;
  onChange: (tab: string) => void;
  tabsOverride?: string[];
}

export function AnalysisTabs({ activeTab, onChange, tabsOverride }: AnalysisTabsProps) {
  return <SectionTabs tabs={tabsOverride ?? tabs} active={activeTab} onChange={onChange} />;
}

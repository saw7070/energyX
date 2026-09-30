interface SectionTabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function SectionTabs({ tabs, active, onChange }: SectionTabsProps) {
  return (
    <div className="inline-flex rounded-lg border border-shell-600 bg-shell-800 p-1">
      {tabs.map((tab) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${selected ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
            onClick={() => onChange(tab)}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}

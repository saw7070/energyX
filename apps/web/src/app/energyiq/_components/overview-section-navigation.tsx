export type OverviewNavigationSection = {
  id: string;
  label: string;
  number: string;
  depth: number;
};

export function OverviewSectionNavigation({
  sections,
  activeSectionId,
  onSelect,
}: {
  sections: ReadonlyArray<OverviewNavigationSection>;
  activeSectionId: string;
  onSelect: (sectionId: string) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <aside className="sticky top-0 z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur xl:top-6 xl:z-auto xl:mx-0 xl:bg-transparent xl:px-0 xl:py-0 xl:backdrop-blur-none">
      <p className="mb-2 hidden px-3 text-ui-label font-semibold text-foreground xl:block">
        Overview contents
      </p>
      <nav
        className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-card)] xl:max-h-[calc(100dvh-7rem)] xl:flex-col xl:overflow-y-auto xl:overscroll-contain xl:shadow-none"
        aria-label="Overview contents"
      >
        {sections.map((section) => {
          const active = activeSectionId === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(event) => {
                event.preventDefault();
                onSelect(section.id);
              }}
              aria-current={active ? "location" : undefined}
              aria-label={`${section.number} ${section.label}`}
              className={[
                "flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-ui-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 xl:w-full",
                section.depth > 0 ? "xl:pl-7" : "",
                active
                  ? "bg-surface-subtle text-foreground ring-1 ring-inset ring-border"
                  : "text-muted hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              <span aria-hidden="true" className="min-w-[2.2rem] shrink-0 text-xs font-semibold tabular-nums text-muted-light">
                {section.number}{" "}
              </span>
              <span className={section.depth > 0 ? "text-xs" : ""}>{section.label}</span>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

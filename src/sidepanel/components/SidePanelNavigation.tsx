export type SidePanelView = "dashboard" | "presets" | "run-log";

export interface SidePanelNavigationProps {
  readonly activeView: SidePanelView;
  readonly onChange: (view: SidePanelView) => void;
}

const navigationItems: readonly {
  readonly view: SidePanelView;
  readonly label: string;
  readonly shortLabel: string;
}[] = [
  { view: "dashboard", label: "Dashboard", shortLabel: "Run" },
  { view: "presets", label: "Presets and editor", shortLabel: "Presets" },
  { view: "run-log", label: "Run log", shortLabel: "Log" }
];

export function SidePanelNavigation({
  activeView,
  onChange
}: SidePanelNavigationProps) {
  return (
    <nav className="workspace-navigation" aria-label="Side panel sections">
      {navigationItems.map((item) => (
        <button
          aria-current={activeView === item.view ? "page" : undefined}
          aria-label={item.label}
          className="workspace-navigation__item"
          key={item.view}
          onClick={() => onChange(item.view)}
          type="button"
        >
          <span aria-hidden="true" className={`workspace-navigation__icon workspace-navigation__icon--${item.view}`} />
          <span>{item.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}

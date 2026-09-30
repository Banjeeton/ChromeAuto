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
          <NavigationIcon view={item.view} />
          <span>{item.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}

function NavigationIcon({ view }: { readonly view: SidePanelView }) {
  if (view === "dashboard") {
    return (
      <svg aria-hidden="true" className="workspace-navigation__icon workspace-navigation__icon--dashboard" viewBox="0 0 24 24">
        <rect height="16" rx="4" width="16" x="4" y="4" />
        <path d="m10 8 6 4-6 4V8Z" />
      </svg>
    );
  }
  if (view === "presets") {
    return (
      <svg aria-hidden="true" className="workspace-navigation__icon workspace-navigation__icon--presets" viewBox="0 0 24 24">
        <rect height="17" rx="2" width="15" x="4.5" y="3.5" />
        <path d="M8 8h1m3 0h4M8 12h1m3 0h4M8 16h1m3 0h4" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="workspace-navigation__icon workspace-navigation__icon--run-log" viewBox="0 0 24 24">
      <path d="M6 3.5h8l4 4v13H6v-17Z" />
      <path d="M14 3.5v4h4M9 12h6M9 16h6" />
    </svg>
  );
}

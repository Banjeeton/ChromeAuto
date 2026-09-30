import { Icon, type IconName } from "./Icon";

export type SidePanelView = "dashboard" | "presets" | "run-log";

export interface SidePanelNavigationProps {
  readonly activeView: SidePanelView;
  readonly onChange: (view: SidePanelView) => void;
}

const navigationItems: readonly {
  readonly view: SidePanelView;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: IconName;
}[] = [
  { view: "dashboard", label: "Dashboard", shortLabel: "Run", icon: "run" },
  { view: "presets", label: "Presets and editor", shortLabel: "Presets", icon: "presets" },
  { view: "run-log", label: "Run log", shortLabel: "Log", icon: "log" }
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
          <Icon
            className={`workspace-navigation__icon workspace-navigation__icon--${item.view}`}
            name={item.icon}
            size={24}
          />
          <span>{item.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}

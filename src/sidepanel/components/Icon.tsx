import type { SVGAttributes } from "react";

import { classNames } from "./class-names";

export type IconName =
  | "bolt"
  | "run"
  | "stop"
  | "record"
  | "edit"
  | "settings"
  | "import"
  | "export"
  | "duplicate"
  | "delete"
  | "repeat"
  | "pacing"
  | "presets"
  | "log"
  | "check"
  | "clock"
  | "disabled"
  | "unavailable"
  | "failed"
  | "add"
  | "refresh"
  | "up"
  | "down";

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "children"> {
  readonly name: IconName;
  readonly size?: 12 | 14 | 16 | 18 | 20 | 24;
}

/** Local, resolution-independent icon set used throughout the side panel. */
export function Icon({ className, name, size = 16, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={classNames("ui-icon", `ui-icon--${name}`, className)}
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <IconPath name={name} />
    </svg>
  );
}

function IconPath({ name }: { readonly name: IconName }) {
  switch (name) {
    case "bolt":
      return <path className="ui-icon__fill" d="M13.2 2 4.8 13h6l-1 9L19.2 10h-6.3l.3-8Z" />;
    case "run":
      return <><circle cx="12" cy="12" r="9" /><path className="ui-icon__fill" d="m10 8 6 4-6 4V8Z" /></>;
    case "stop":
      return <rect className="ui-icon__fill" height="12" rx="1.5" width="12" x="6" y="6" />;
    case "record":
      return <circle className="ui-icon__fill" cx="12" cy="12" r="7" />;
    case "edit":
      return <><path d="m4 20 4.3-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z" /><path d="m14.7 6.6 3 3" /></>;
    case "settings":
      return <><circle cx="12" cy="12" r="3" /><path d="M19 13.2 21 15l-2 3.5-2.6-.8a8.2 8.2 0 0 1-2.1 1.2L13.7 22h-4l-.6-3.1A8.2 8.2 0 0 1 7 17.7l-2.6.8-2-3.5 2-1.8a8 8 0 0 1 0-2.4L2.4 9l2-3.5 2.6.8a8.2 8.2 0 0 1 2.1-1.2L9.7 2h4l.6 3.1a8.2 8.2 0 0 1 2.1 1.2l2.6-.8L21 9l-2 1.8a8 8 0 0 1 0 2.4Z" /></>;
    case "import":
      return <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 17v3h14v-3" /></>;
    case "export":
      return <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M5 15v5h14v-5" /></>;
    case "duplicate":
      return <><rect height="12" rx="2" width="12" x="8" y="8" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>;
    case "delete":
      return <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7" /><path d="M10 11v5m4-5v5" /></>;
    case "repeat":
      return <><path d="M17 2.5 21 6l-4 3.5V7H8a4 4 0 0 0-4 4" /><path d="m7 21.5-4-3.5 4-3.5V17h9a4 4 0 0 0 4-4" /></>;
    case "pacing":
      return <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 3h6M12 3v2" /></>;
    case "presets":
      return <><rect height="17" rx="2" width="15" x="4.5" y="3.5" /><path d="M8 8h1m3 0h4M8 12h1m3 0h4M8 16h1m3 0h4" /></>;
    case "log":
      return <><path d="M6 3.5h8l4 4v13H6v-17Z" /><path d="M14 3.5v4h4M9 12h6M9 16h6" /></>;
    case "check":
      return <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 8" /></>;
    case "clock":
      return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
    case "disabled":
      return <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>;
    case "unavailable":
      return <><path d="M7 10V8a5 5 0 0 1 10 0v2" /><rect height="10" rx="2" width="14" x="5" y="10" /><path d="M12 14v2" /></>;
    case "failed":
      return <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>;
    case "add":
      return <path d="M12 5v14M5 12h14" />;
    case "refresh":
      return <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /></>;
    case "up":
      return <><path d="m7 14 5-5 5 5" /><path d="M12 9v10" /></>;
    case "down":
      return <><path d="m7 10 5 5 5-5" /><path d="M12 5v10" /></>;
  }
}

import type { HTMLAttributes } from "react";

import { Badge, type StatusTone } from "./Badge";
import { classNames } from "./class-names";
import { Icon, type IconName } from "./Icon";

export type AutomationStatus =
  | "Ready"
  | "Running"
  | "Waiting"
  | "Recording"
  | "Stopped"
  | "Disabled"
  | "Unavailable"
  | "Failed";

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly status: AutomationStatus;
}

const statusStyle: Record<AutomationStatus, { tone: StatusTone; icon: IconName }> = {
  Ready: { tone: "success", icon: "check" },
  Running: { tone: "info", icon: "run" },
  Waiting: { tone: "warning", icon: "clock" },
  Recording: { tone: "error", icon: "record" },
  Stopped: { tone: "warning", icon: "stop" },
  Disabled: { tone: "neutral", icon: "disabled" },
  Unavailable: { tone: "neutral", icon: "unavailable" },
  Failed: { tone: "error", icon: "failed" }
};

export function StatusBadge({ className, status, ...props }: StatusBadgeProps) {
  const style = statusStyle[status];
  return (
    <Badge
      className={classNames("status-badge", `status-badge--${status.toLowerCase()}`, className)}
      tone={style.tone}
      {...props}
    >
      <Icon name={style.icon} size={12} />
      <span>{status}</span>
    </Badge>
  );
}

import type { HTMLAttributes } from "react";

import { classNames } from "./class-names";

export type StatusTone = "neutral" | "success" | "warning" | "error" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: StatusTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={classNames("ui-badge", `ui-badge--${tone}`, className)}
      {...props}
    />
  );
}

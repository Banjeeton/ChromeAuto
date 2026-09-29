import type { HTMLAttributes, ReactNode } from "react";

import { classNames } from "./class-names";
import type { StatusTone } from "./Badge";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly tone?: StatusTone;
  readonly title?: ReactNode;
}

export function Alert({
  children,
  className,
  role,
  title,
  tone = "info",
  ...props
}: AlertProps) {
  return (
    <div
      className={classNames("ui-alert", `ui-alert--${tone}`, className)}
      role={role ?? (tone === "error" ? "alert" : "status")}
      {...props}
    >
      {title !== undefined && <strong className="ui-alert__title">{title}</strong>}
      {children}
    </div>
  );
}

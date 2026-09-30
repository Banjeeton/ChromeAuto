import type { HTMLAttributes } from "react";

import { classNames } from "./class-names";

export type CardProps = HTMLAttributes<HTMLElement>;

export function Card({ className, ...props }: CardProps) {
  return <section className={classNames("ui-card", className)} {...props} />;
}

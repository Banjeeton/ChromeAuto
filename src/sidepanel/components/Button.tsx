import { forwardRef, type ButtonHTMLAttributes } from "react";

import { classNames } from "./class-names";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "small" | "medium";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, size = "medium", type = "button", variant = "primary", ...props },
  ref
) {
  return (
    <button
      className={classNames(
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${size}`,
        className
      )}
      ref={ref}
      type={type}
      {...props}
    />
  );
});

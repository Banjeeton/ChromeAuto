import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";

import { classNames } from "./class-names";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref
) {
  return <input className={classNames("ui-input", className)} ref={ref} {...props} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref
) {
  return <select className={classNames("ui-select", className)} ref={ref} {...props} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea className={classNames("ui-textarea", className)} ref={ref} {...props} />
    );
  }
);

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "type"> {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly containerClassName?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { className, containerClassName, description, label, ...props },
    ref
  ) {
    return (
      <label className={classNames("ui-checkbox", containerClassName)}>
        <input
          className={classNames("ui-checkbox__control", className)}
          ref={ref}
          type="checkbox"
          {...props}
        />
        <span className="ui-checkbox__copy">
          <span>{label}</span>
          {description !== undefined && (
            <span className="ui-checkbox__description">{description}</span>
          )}
        </span>
      </label>
    );
  }
);

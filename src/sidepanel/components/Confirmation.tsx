import type { ReactNode } from "react";

import { Button } from "./Button";
import { classNames } from "./class-names";
import { Modal } from "./Modal";

export interface ConfirmationProps {
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly busy?: boolean;
  readonly tone?: "danger" | "warning";
  readonly className?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function Confirmation({
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  tone = "danger",
  className,
  onCancel,
  onConfirm
}: ConfirmationProps) {
  return (
    <div
      className={classNames(
        "ui-confirmation",
        `ui-confirmation--${tone}`,
        className
      )}
      role="alert"
    >
      <p className="ui-confirmation__message">{children}</p>
      <div className="ui-confirmation__actions">
        <Button disabled={busy} onClick={onCancel} size="small" variant="secondary">
          {cancelLabel}
        </Button>
        <Button disabled={busy} onClick={onConfirm} size="small" variant="danger">
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export interface ConfirmationDialogProps extends ConfirmationProps {
  readonly open: boolean;
  readonly title: ReactNode;
}

export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onCancel,
  onConfirm
}: ConfirmationDialogProps) {
  return (
    <Modal
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} size="small" variant="secondary">
            {cancelLabel}
          </Button>
          <Button disabled={busy} onClick={onConfirm} size="small" variant="danger">
            {confirmLabel}
          </Button>
        </>
      }
      onClose={busy ? undefined : onCancel}
      open={open}
      title={title}
    >
      {children}
    </Modal>
  );
}

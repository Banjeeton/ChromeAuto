import { useId, type ReactNode } from "react";

export interface ModalProps {
  readonly open: boolean;
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly closeLabel?: string;
  readonly onClose?: () => void;
}

export function Modal({
  open,
  title,
  children,
  footer,
  closeLabel = "Close dialog",
  onClose
}: ModalProps) {
  const titleId = useId();
  if (!open) return null;

  return (
    <div
      className="ui-modal__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="ui-modal"
        role="dialog"
      >
        <header className="ui-modal__header">
          <h2 id={titleId}>{title}</h2>
          {onClose !== undefined && (
            <button
              aria-label={closeLabel}
              className="ui-modal__close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          )}
        </header>
        <div className="ui-modal__body">{children}</div>
        {footer !== undefined && <footer className="ui-modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}

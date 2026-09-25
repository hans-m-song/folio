import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

import "../styles/confirmation-dialog.css";

export const ConfirmationDialog = ({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  pending = false,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    cancelButtonRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!pending) onCancel();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (!pending) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
      aria-busy={pending}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error ? (
        <p id={errorId} className="confirmation-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="confirmation-dialog__actions">
        <button
          ref={cancelButtonRef}
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="confirmation-dialog__confirm"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
};

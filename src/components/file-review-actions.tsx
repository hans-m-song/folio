export type FileReviewQueueStatus = "loading" | "loaded" | "error";

type FileReviewActionsProps = {
  canConfirm: boolean;
  busy: boolean;
  navigationBusy: boolean;
  confirmed: boolean;
  queueStatus: FileReviewQueueStatus;
  atEnd: boolean;
  navigationError: string;
  disabledReason?: string;
  onConfirm: (advance: boolean) => void;
  onSkip: () => void;
  onRetryQueue: () => void;
};

export const FileReviewActions = ({
  canConfirm,
  busy,
  navigationBusy,
  confirmed,
  queueStatus,
  atEnd,
  navigationError,
  disabledReason,
  onConfirm,
  onSkip,
  onRetryQueue,
}: FileReviewActionsProps) => {
  const controlsBusy = busy || navigationBusy;
  const confirmDisabled = !canConfirm || controlsBusy || confirmed;

  return (
    <section aria-label="File review actions" className="file-review-actions">
      {disabledReason && <p>{disabledReason}</p>}
      {queueStatus === "loading" && <p role="status">Loading review queue…</p>}
      {queueStatus === "error" && (
        <>
          <p role="alert">
            The review queue could not be loaded. Retry to navigate between
            files.
          </p>
          <button type="button" disabled={controlsBusy} onClick={onRetryQueue}>
            Retry review queue
          </button>
        </>
      )}
      {atEnd && <p role="status">No more files to review.</p>}
      {navigationError && <p role="alert">{navigationError}</p>}
      <div className="file-detail-actions">
        <button
          type="button"
          disabled={confirmDisabled}
          onClick={() => onConfirm(false)}
        >
          {confirmed ? "Confirmed" : busy ? "Confirming…" : "Confirm"}
        </button>
        <button
          type="button"
          disabled={confirmDisabled || queueStatus !== "loaded"}
          onClick={() => onConfirm(true)}
        >
          Confirm and next
        </button>
        <button
          type="button"
          disabled={controlsBusy || queueStatus !== "loaded" || atEnd}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </section>
  );
};

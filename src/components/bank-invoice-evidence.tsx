import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";

import { ConfirmationDialog } from "./confirmation-dialog";
import {
  InvoiceSuggestionReview,
  type InvoiceReviewObservation,
} from "./invoice-suggestion-review";
import { FileUploadPage, hasPdfHeader } from "../routes/-file-upload";
import { approveArtifact, getArtifactDetails } from "../server/operations";
import "../styles/file-workspace.css";
import "../styles/bank-invoice-evidence.css";
import { TransactionPdfPreview } from "./transaction-pdf-preview";

export type BankInvoiceArtifactDetails = NonNullable<
  Awaited<ReturnType<typeof getArtifactDetails>>
>;

type ReviewArtifactState =
  | { status: "loading"; id: string }
  | { status: "error"; id: string; message: string }
  | {
      status: "ready";
      artifact: BankInvoiceArtifactDetails;
      approvalBusy: boolean;
      message?: string;
    };

type SelectedArtifactState =
  | { id: string; status: "loading" }
  | { id: string; status: "unavailable" }
  | { id: string; status: "ready"; artifact: BankInvoiceArtifactDetails };

const isInvoicePdf = (
  artifact: BankInvoiceArtifactDetails | null,
  id: string,
  states: readonly BankInvoiceArtifactDetails["state"][],
): artifact is BankInvoiceArtifactDetails =>
  artifact !== null &&
  artifact.id === id &&
  artifact.artifactProfile === "manual_invoice_pdf_v1" &&
  artifact.mediaType === "application/pdf" &&
  states.includes(artifact.state);

const metadataRows = (
  artifact: BankInvoiceArtifactDetails,
): [string, string][] => {
  const rows: [string, string | null | undefined][] = [
    ["Filename", artifact.filename],
    ["Original filename", artifact.originalFilename],
    ["Supplier", artifact.supplier],
    ["Document date", artifact.documentDate],
    ["Reference", artifact.reference],
    [
      "Coverage",
      artifact.periodStart || artifact.periodEnd
        ? `${artifact.periodStart ?? "Not set"} to ${artifact.periodEnd ?? "Not set"}`
        : null,
    ],
    ["Notes", artifact.notes],
  ];
  return rows.filter(
    (row): row is [string, string] =>
      typeof row[1] === "string" && Boolean(row[1].trim()),
  );
};

const ArtifactMetadata = ({
  artifact,
}: {
  artifact: BankInvoiceArtifactDetails;
}) => {
  const rows = metadataRows(artifact);
  if (rows.length === 0)
    return (
      <p className="bank-invoice-evidence__metadata-empty">
        No invoice or coverage metadata was recorded for this PDF.
      </p>
    );

  return (
    <dl className="bank-invoice-evidence__metadata">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};

export const BankInvoiceEvidence = ({
  actorId,
  contextKey,
  selectedArtifact,
  busy = false,
  onApproved,
  onInvoiceObservation,
  onPendingChange,
}: {
  actorId: string;
  contextKey: string;
  selectedArtifact?: {
    id: string;
    filename?: string;
    originalFilename?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  } | null;
  busy?: boolean;
  onApproved: (artifact: BankInvoiceArtifactDetails) => void;
  onInvoiceObservation?: (
    artifactId: string,
    observation: InvoiceReviewObservation | null,
  ) => void;
  onPendingChange: (pending: boolean) => void;
}) => {
  const uploadTitleId = useId();
  const uploadDescriptionId = useId();
  const lifecycle = useRef(true);
  const contextIdentityRef = useRef({ key: contextKey });
  if (contextIdentityRef.current.key !== contextKey)
    contextIdentityRef.current = { key: contextKey };
  const contextIdentity = contextIdentityRef.current;
  const callbacks = useRef({
    onApproved,
    onInvoiceObservation,
    onPendingChange,
  });
  callbacks.current = { onApproved, onInvoiceObservation, onPendingChange };
  const reviewRequest = useRef(0);
  const selectedDetailsRequest = useRef(0);
  const localPreviewUrl = useRef<string | null>(null);
  const [uploadFormKey, setUploadFormKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<
    | { file: File; status: "checking" }
    | { file: File; status: "invalid" }
    | { file: File; status: "ready"; url: string }
    | null
  >(null);
  const [reviewArtifact, setReviewArtifact] =
    useState<ReviewArtifactState | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [uploadTransferBusy, setUploadTransferBusy] = useState(false);
  const [selectedArtifactState, setSelectedArtifactState] =
    useState<SelectedArtifactState | null>(null);
  const selectedArtifactId = selectedArtifact?.id ?? null;

  useEffect(() => {
    lifecycle.current = true;
    return () => {
      lifecycle.current = false;
      reviewRequest.current += 1;
      selectedDetailsRequest.current += 1;
      if (localPreviewUrl.current) {
        URL.revokeObjectURL(localPreviewUrl.current);
        localPreviewUrl.current = null;
      }
    };
  }, []);

  const isCurrentContext = (identity: { key: string }) =>
    lifecycle.current && contextIdentityRef.current === identity;

  const markPending = (pending: boolean, identity: { key: string }) => {
    if (isCurrentContext(identity)) callbacks.current.onPendingChange(pending);
  };

  const markUploadBusy = (busy: boolean, identity: { key: string }) => {
    if (isCurrentContext(identity)) setUploadTransferBusy(busy);
  };

  const closeAfterApproval = (
    artifact: BankInvoiceArtifactDetails,
    identity: { key: string },
  ) => {
    if (!isCurrentContext(identity)) return;
    callbacks.current.onApproved(artifact);
    markPending(false, identity);
    setReviewArtifact(null);
    setSelectedFile(null);
    revokeLocalPreview();
    setLocalPreview(null);
    setUploadFormKey((current) => current + 1);
    setDiscardConfirmationOpen(false);
    setUploadOpen(false);
  };

  const revokeLocalPreview = () => {
    if (!localPreviewUrl.current) return;
    URL.revokeObjectURL(localPreviewUrl.current);
    localPreviewUrl.current = null;
  };

  useEffect(() => {
    if (!selectedFile) {
      setLocalPreview(null);
      return;
    }

    let current = true;
    let objectUrl: string | null = null;
    const effectContext = contextIdentity;
    setLocalPreview({ file: selectedFile, status: "checking" });
    void selectedFile
      .slice(0, 16)
      .arrayBuffer()
      .then((buffer) => {
        if (!current || !isCurrentContext(effectContext)) return;
        if (!hasPdfHeader(new Uint8Array(buffer))) {
          setLocalPreview({ file: selectedFile, status: "invalid" });
          return;
        }
        objectUrl = URL.createObjectURL(
          new Blob([selectedFile], { type: "application/pdf" }),
        );
        localPreviewUrl.current = objectUrl;
        setLocalPreview({
          file: selectedFile,
          status: "ready",
          url: objectUrl,
        });
      })
      .catch(() => {
        if (current && isCurrentContext(effectContext))
          setLocalPreview({ file: selectedFile, status: "invalid" });
      });

    return () => {
      current = false;
      if (objectUrl && localPreviewUrl.current === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        localPreviewUrl.current = null;
      }
    };
  }, [contextIdentity, contextKey, selectedFile]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setSelectedArtifactState(null);
      return;
    }

    let current = true;
    const effectContext = contextIdentity;
    const request = ++selectedDetailsRequest.current;
    setSelectedArtifactState({ id: selectedArtifactId, status: "loading" });
    void getArtifactDetails({ data: { id: selectedArtifactId } }).then(
      (artifact) => {
        if (
          !current ||
          !isCurrentContext(effectContext) ||
          selectedDetailsRequest.current !== request
        )
          return;
        setSelectedArtifactState(
          isInvoicePdf(artifact, selectedArtifactId, ["available"])
            ? { id: selectedArtifactId, status: "ready", artifact }
            : { id: selectedArtifactId, status: "unavailable" },
        );
      },
      () => {
        if (
          current &&
          isCurrentContext(effectContext) &&
          selectedDetailsRequest.current === request
        )
          setSelectedArtifactState({
            id: selectedArtifactId,
            status: "unavailable",
          });
      },
    );

    return () => {
      current = false;
    };
  }, [contextIdentity, contextKey, selectedArtifactId]);

  const loadUploadedArtifact = async (
    artifactId: string,
    operationContext: { key: string },
  ) => {
    if (!isCurrentContext(operationContext)) return;
    const request = ++reviewRequest.current;
    const isCurrentRequest = () =>
      isCurrentContext(operationContext) && reviewRequest.current === request;

    markPending(true, operationContext);
    revokeLocalPreview();
    setLocalPreview(null);
    setReviewArtifact({ status: "loading", id: artifactId });
    try {
      const artifact = await getArtifactDetails({ data: { id: artifactId } });
      if (!isCurrentRequest()) return;
      if (
        !isInvoicePdf(artifact, artifactId, ["awaiting_review", "available"])
      ) {
        setReviewArtifact({
          status: "error",
          id: artifactId,
          message:
            "The confirmed upload is not an awaiting or approved invoice PDF. The transaction was not saved or matched.",
        });
        return;
      }

      setReviewArtifact({
        status: "ready",
        artifact,
        approvalBusy: false,
      });
      if (artifact.state === "available") {
        closeAfterApproval(artifact, operationContext);
      }
    } catch {
      if (!isCurrentRequest()) return;
      setReviewArtifact({
        status: "error",
        id: artifactId,
        message:
          "The upload is preserved, but its review details could not be loaded. Retry or dismiss this PDF before saving.",
      });
    }
  };

  const handleFileChange = (
    file: File | null,
    operationContext: { key: string },
  ) => {
    if (!isCurrentContext(operationContext)) return;
    setSelectedFile(file);
    if (file) {
      if (
        reviewArtifact?.status === "ready" &&
        reviewArtifact.artifact.state === "available"
      )
        setReviewArtifact(null);
      markPending(true, operationContext);
      return;
    }
    markPending(false, operationContext);
  };

  const approveUploadedArtifact = async () => {
    if (
      busy ||
      !isCurrentContext(contextIdentity) ||
      reviewArtifact?.status !== "ready" ||
      reviewArtifact.artifact.state !== "awaiting_review" ||
      reviewArtifact.approvalBusy
    )
      return;

    const operationContext = contextIdentity;
    const artifactBeforeApproval = reviewArtifact.artifact;
    const request = ++reviewRequest.current;
    const isCurrentRequest = () =>
      isCurrentContext(operationContext) && reviewRequest.current === request;
    setReviewArtifact({
      status: "ready",
      artifact: artifactBeforeApproval,
      approvalBusy: true,
    });

    try {
      const approved = await approveArtifact({
        data: { id: artifactBeforeApproval.id },
      });
      if (!isCurrentRequest()) return;
      if (
        approved.id !== artifactBeforeApproval.id ||
        approved.artifactProfile !== "manual_invoice_pdf_v1" ||
        approved.mediaType !== "application/pdf" ||
        approved.state !== "available"
      )
        throw new Error("Invoice approval was not confirmed.");

      const details = await getArtifactDetails({
        data: { id: artifactBeforeApproval.id },
      });
      if (!isCurrentRequest()) return;
      if (!isInvoicePdf(details, artifactBeforeApproval.id, ["available"]))
        throw new Error("The approved invoice details could not be confirmed.");

      setReviewArtifact({
        status: "ready",
        artifact: details,
        approvalBusy: false,
      });
      closeAfterApproval(details, operationContext);
    } catch {
      if (!isCurrentRequest()) return;
      setReviewArtifact({
        status: "ready",
        artifact: artifactBeforeApproval,
        approvalBusy: false,
        message:
          "Approval could not be fully confirmed. Refresh the PDF status before retrying or dismiss it from this transaction.",
      });
    }
  };

  const dismissUploadedArtifact = () => {
    if (
      busy ||
      uploadTransferBusy ||
      (reviewArtifact?.status === "ready" && reviewArtifact.approvalBusy) ||
      !isCurrentContext(contextIdentity)
    )
      return;
    const artifactId =
      reviewArtifact?.status === "ready"
        ? reviewArtifact.artifact.id
        : reviewArtifact?.id;
    reviewRequest.current += 1;
    if (artifactId) callbacks.current.onInvoiceObservation?.(artifactId, null);
    setReviewArtifact(null);
    setSelectedFile(null);
    revokeLocalPreview();
    setLocalPreview(null);
    setUploadFormKey((current) => current + 1);
    setUploadTransferBusy(false);
    markPending(false, contextIdentity);
  };

  const approvalBusy =
    reviewArtifact?.status === "ready" && reviewArtifact.approvalBusy;
  const uploadCloseBusy = busy || uploadTransferBusy || approvalBusy;
  const requestCloseUpload = () => {
    if (uploadCloseBusy || !isCurrentContext(contextIdentity)) return;
    if (selectedFile || reviewArtifact) {
      setDiscardConfirmationOpen(true);
      return;
    }
    setUploadOpen(false);
  };

  const confirmDiscardAndClose = () => {
    if (uploadCloseBusy) return;
    dismissUploadedArtifact();
    setDiscardConfirmationOpen(false);
    setUploadOpen(false);
  };

  const selectedMetadata = selectedArtifact
    ? [selectedArtifact.periodStart, selectedArtifact.periodEnd]
        .filter((value): value is string => Boolean(value))
        .join(" to ")
    : "";
  const selectedReadyArtifact =
    selectedArtifactState?.status === "ready"
      ? selectedArtifactState.artifact
      : null;
  const uploadedReadyArtifact =
    reviewArtifact?.status === "ready" ? reviewArtifact.artifact : null;
  const uploadLocked =
    busy ||
    uploadTransferBusy ||
    reviewArtifact?.status === "loading" ||
    reviewArtifact?.status === "error" ||
    (reviewArtifact?.status === "ready" &&
      reviewArtifact.artifact.state === "awaiting_review");

  return (
    <section
      className="bank-invoice-evidence"
      aria-label="Invoice PDF evidence"
      aria-busy={busy || uploadTransferBusy || approvalBusy}
      data-preview-size="half"
    >
      <header className="bank-invoice-evidence__header">
        <h3>Invoice PDF</h3>
        <p>
          Approved PDFs are attached when you save and match. Upload and review
          files separately; file metadata does not change transaction fields.
        </p>
      </header>
      {selectedArtifactId && selectedArtifactState?.status === "loading" && (
        <p className="bank-invoice-evidence__status" role="status">
          Loading selected invoice PDF…
        </p>
      )}
      {selectedArtifactId &&
        selectedArtifactState?.status === "unavailable" && (
          <p className="bank-invoice-evidence__error" role="alert">
            The selected file is no longer an approved invoice PDF. Remove it
            from the transaction form before saving.
          </p>
        )}
      {selectedReadyArtifact && (
        <section className="bank-invoice-evidence__selected-preview">
          <TransactionPdfPreview
            artifactId={selectedReadyArtifact.id}
            filename={selectedReadyArtifact.filename}
          />
          <ArtifactMetadata artifact={selectedReadyArtifact} />
        </section>
      )}
      {selectedArtifact && selectedMetadata && (
        <p className="bank-invoice-evidence__selected-summary">
          Selected coverage: {selectedMetadata}
        </p>
      )}
      {!selectedReadyArtifact && !selectedArtifactId && (
        <p className="bank-invoice-evidence__empty">
          No approved invoice PDF is selected.
        </p>
      )}

      <button
        type="button"
        className="secondary bank-invoice-evidence__open-upload"
        disabled={uploadCloseBusy}
        onClick={() => setUploadOpen(true)}
      >
        Upload PDF
      </button>

      <ModalOverlay
        className="bank-invoice-upload-overlay"
        isOpen={uploadOpen}
        isDismissable={!uploadCloseBusy && !discardConfirmationOpen}
        isKeyboardDismissDisabled={uploadCloseBusy || discardConfirmationOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseUpload();
        }}
      >
        <Modal className="bank-invoice-upload-modal">
          <Dialog
            className="bank-invoice-upload-drawer"
            aria-labelledby={uploadTitleId}
            aria-describedby={uploadDescriptionId}
            inert={!uploadOpen}
          >
            <header className="bank-invoice-upload-drawer__header">
              <div>
                <p className="bank-invoice-upload-drawer__kicker">
                  Invoice evidence
                </p>
                <h2 id={uploadTitleId}>Upload and review PDF</h2>
                <p id={uploadDescriptionId}>
                  File metadata describes this PDF. Transaction fields remain
                  unchanged until you choose an explicit action after approval.
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={uploadCloseBusy}
                onClick={requestCloseUpload}
              >
                Close
              </button>
            </header>
            <div className="bank-invoice-upload-drawer__body">
              {localPreview?.status === "checking" && (
                <p className="bank-invoice-evidence__status" role="status">
                  Checking the selected PDF before preview…
                </p>
              )}
              {localPreview?.status === "invalid" && (
                <p className="bank-invoice-evidence__error" role="alert">
                  The selected file does not have a PDF header. Clear it or
                  choose another PDF.
                </p>
              )}
              {localPreview?.status === "ready" && (
                <section className="transaction-pdf-preview bank-invoice-evidence__local-preview">
                  <header className="transaction-pdf-preview__header">
                    <div>
                      <h2>Selected PDF</h2>
                      <p>{localPreview.file.name}</p>
                    </div>
                  </header>
                  <iframe
                    className="transaction-pdf-preview__frame"
                    title={`PDF preview: ${localPreview.file.name}`}
                    src={`${localPreview.url}#view=FitH`}
                    referrerPolicy="no-referrer"
                  />
                </section>
              )}
              {!reviewArtifact && (
                <fieldset
                  className="bank-invoice-evidence__upload"
                  disabled={uploadLocked}
                >
                  <FileUploadPage
                    key={uploadFormKey}
                    session={{ authenticated: true, user: { id: actorId } }}
                    embedded
                    invoiceOnly
                    onFileChange={(file) =>
                      handleFileChange(file, contextIdentity)
                    }
                    onBusyChange={(transferBusy) =>
                      markUploadBusy(transferBusy, contextIdentity)
                    }
                    navigateToArtifact={(artifactId) => {
                      if (!isCurrentContext(contextIdentity)) return;
                      revokeLocalPreview();
                      setLocalPreview(null);
                      void loadUploadedArtifact(artifactId, contextIdentity);
                    }}
                  />
                </fieldset>
              )}
              {reviewArtifact?.status === "loading" && (
                <p className="bank-invoice-evidence__status" role="status">
                  Loading confirmed PDF review details…
                </p>
              )}
              {reviewArtifact?.status === "error" && (
                <section className="bank-invoice-evidence__review">
                  <p className="bank-invoice-evidence__error" role="alert">
                    {reviewArtifact.message}
                  </p>
                  <div className="bank-invoice-evidence__actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={uploadCloseBusy}
                      onClick={() =>
                        void loadUploadedArtifact(
                          reviewArtifact.id,
                          contextIdentity,
                        )
                      }
                    >
                      Retry PDF review
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={uploadCloseBusy}
                      onClick={dismissUploadedArtifact}
                    >
                      Dismiss PDF from this transaction
                    </button>
                  </div>
                </section>
              )}
              {uploadedReadyArtifact && (
                <>
                  <section className="bank-invoice-evidence__selected-preview">
                    <TransactionPdfPreview
                      artifactId={uploadedReadyArtifact.id}
                      filename={uploadedReadyArtifact.filename}
                    />
                    <ArtifactMetadata artifact={uploadedReadyArtifact} />
                  </section>
                  <InvoiceSuggestionReview
                    file={null}
                    artifacts={[
                      {
                        id: uploadedReadyArtifact.id,
                        filename: uploadedReadyArtifact.filename,
                        originalFilename:
                          uploadedReadyArtifact.originalFilename,
                      },
                    ]}
                    busy={uploadCloseBusy}
                    observationOnly
                    getValues={() => ({
                      counterparty: "",
                      invoiceDate: "",
                      reference: "",
                      documentAmount: "",
                      documentCurrency: "",
                    })}
                    onApply={() => undefined}
                    onObservation={(observation) => {
                      if (
                        !isCurrentContext(contextIdentity) ||
                        observation.artifactId !== uploadedReadyArtifact.id
                      )
                        return;
                      callbacks.current.onInvoiceObservation?.(
                        observation.artifactId,
                        observation,
                      );
                    }}
                  />
                  {uploadedReadyArtifact.state === "awaiting_review" && (
                    <section className="bank-invoice-evidence__review">
                      <p
                        className="bank-invoice-evidence__status"
                        role="status"
                      >
                        Review the PDF and approve it before returning to the
                        transaction.
                      </p>
                      {reviewArtifact?.status === "ready" &&
                        reviewArtifact.message && (
                          <p
                            className="bank-invoice-evidence__error"
                            role="alert"
                          >
                            {reviewArtifact.message}
                          </p>
                        )}
                      <div className="bank-invoice-evidence__actions">
                        <button
                          type="button"
                          disabled={
                            uploadCloseBusy ||
                            Boolean(
                              reviewArtifact?.status === "ready" &&
                              reviewArtifact.message,
                            )
                          }
                          onClick={() => void approveUploadedArtifact()}
                        >
                          {approvalBusy
                            ? "Approving PDF…"
                            : "Approve and return"}
                        </button>
                        {reviewArtifact?.status === "ready" &&
                        reviewArtifact.message ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={uploadCloseBusy}
                            onClick={() =>
                              void loadUploadedArtifact(
                                uploadedReadyArtifact.id,
                                contextIdentity,
                              )
                            }
                          >
                            Retry approval review
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            disabled={uploadCloseBusy}
                            onClick={dismissUploadedArtifact}
                          >
                            Dismiss PDF from this transaction
                          </button>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
            {discardConfirmationOpen && (
              <ConfirmationDialog
                title={
                  reviewArtifact
                    ? "Dismiss this PDF from the transaction?"
                    : "Discard the selected PDF?"
                }
                description={
                  reviewArtifact
                    ? "The PDF may remain in the file library, but its pending review and file selection will be cleared from this transaction. Transaction fields will be kept."
                    : "The selected PDF and its file metadata will be cleared. Nothing has been uploaded, and the transaction fields will be kept."
                }
                confirmLabel={
                  reviewArtifact
                    ? "Dismiss PDF and return"
                    : "Discard PDF and return"
                }
                cancelLabel="Keep reviewing"
                onCancel={() => setDiscardConfirmationOpen(false)}
                onConfirm={confirmDiscardAndClose}
              />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  );
};

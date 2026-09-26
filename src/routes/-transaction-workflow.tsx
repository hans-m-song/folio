import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { getCurrentSession } from "../auth/session-server";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { CsvDuplicateWarnings } from "../components/csv-duplicate-warnings";
import { SourceTabs } from "../components/import-profile-tabs";
import {
  ManualTransactionForm,
  type ManualTransactionSubmission,
} from "../components/manual-transaction-form";
import type { ManualTransactionServerIssue } from "../domain/manual-transaction";
import type { StripeImportPreview } from "../domain/stripe-csv";
import type { CsvDuplicateWarningReport } from "../database/repository";
import { defaultTaxTreatmentForTransaction } from "../domain/tax";
import {
  expenseCategorySuggestions,
  type TransactionInput,
  type TransactionRecord,
} from "../domain/types";
import {
  approveArtifact,
  confirmArtifactUpload,
  discardProposedDraftEvidence,
  findArtifactFilenameMatches,
  getFolioUiConfig,
  getProposedDraftEvidence,
  getTransaction,
  importStripeCsv,
  listArtifacts,
  listAvailableInvoiceArtifacts,
  listTransactionFormOptions,
  saveManualTransaction,
  previewStripeCsv,
  previewArtifactForReview,
  rejectArtifact,
  startArtifactUpload,
  voidTransaction,
} from "../server/operations";
import { getCsvDuplicateWarnings } from "../server/bank-operations";

const emptyTransaction: TransactionInput = {
  ownerId: null,
  sourceArtifactId: null,
  kind: "supplier_expense",
  reference: null,
  counterparty: null,
  description: null,
  status: "draft",
  category: null,
  notes: null,
  occurredAt: null,
  availableAt: null,
  invoiceDate: null,
  settledAt: null,
  documentCurrency: "AUD",
  documentAmount: null,
  documentTaxAmount: null,
  taxTreatment: "gst_included",
  settlementCurrency: "AUD",
  settlementAmount: null,
  gstCreditStatus: "not_registered",
  claimableGstAud: "0.0000",
};

export const safeTransactionWorkflowError = (
  error: unknown,
  fallback: string,
): string => {
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    message.length > 180 ||
    /https?:\/\/|@|secret|password|credential|stack/i.test(message)
  )
    return fallback;
  return message;
};

export const manualSaveFailureDetail = (
  failureDetail: string,
  newlyConfirmedArtifactId: string | null,
): string => {
  if (/\bDB_OUTCOME_UNKNOWN\b/.test(failureDetail))
    return `${failureDetail} The transaction outcome is uncertain. Inspect or reload the transaction list to determine whether another save is needed.`;
  if (newlyConfirmedArtifactId)
    return `${failureDetail} Transaction was not saved. The confirmed PDF is archived and preserved (artifact ${newlyConfirmedArtifactId}); retry save to link it without re-uploading.`;
  return `${failureDetail} Transaction was not saved. Retry save when ready.`;
};

export const voidTransactionConfirmation = (
  reference: string | null,
  id: string,
): string =>
  `Voiding transaction ${reference ?? id} may not be reversible. Verify the record before continuing.`;

const sha256Base64 = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const loadManualTransactionRouteData = async (
  transactionId?: string,
) => {
  const session = await getCurrentSession();
  if (!session.authenticated)
    return {
      session,
      formOptions: null,
      uiConfig: null,
      availableArtifacts: null,
      transaction: null,
      proposedDraftEvidence: null,
    };
  const [
    formOptions,
    uiConfig,
    availableArtifacts,
    transaction,
    proposedDraftEvidence,
  ] = await Promise.all([
    listTransactionFormOptions(),
    getFolioUiConfig(),
    listAvailableInvoiceArtifacts(),
    transactionId
      ? getTransaction({ data: { id: transactionId } })
      : Promise.resolve(null),
    transactionId
      ? getProposedDraftEvidence({ data: { transactionId } })
      : Promise.resolve(null),
  ]);
  return {
    session,
    formOptions,
    uiConfig,
    availableArtifacts,
    transaction,
    proposedDraftEvidence,
  };
};

export const loadTransactionWorkflowSession = () => getCurrentSession();

type ManualRouteData = Awaited<
  ReturnType<typeof loadManualTransactionRouteData>
>;

interface WorkflowState {
  stage:
    | "idle"
    | "validating"
    | "uploading"
    | "confirming"
    | "saving"
    | "preview"
    | "cancelled"
    | "complete"
    | "error";
  detail: string;
  artifactId: string | null;
}

const WorkflowStatus = ({
  workflow,
  label = "Manual transaction workflow",
  showArtifactId = true,
  alertErrors = false,
  focusErrors = false,
}: {
  workflow: WorkflowState;
  label?: string;
  showArtifactId?: boolean;
  alertErrors?: boolean;
  focusErrors?: boolean;
}) => {
  const statusRef = useRef<HTMLDivElement>(null);
  const isError = workflow.stage === "error";

  useEffect(() => {
    if (focusErrors && isError) statusRef.current?.focus();
  }, [focusErrors, isError, workflow.detail]);

  if (workflow.stage === "idle") return null;
  return (
    <div
      ref={statusRef}
      className={`workflow-status ${isError ? "error" : workflow.stage === "complete" ? "complete" : "progress"}`}
      role={alertErrors && isError ? "alert" : "status"}
      aria-live={alertErrors && isError ? "assertive" : "polite"}
      tabIndex={focusErrors && isError ? -1 : undefined}
    >
      {label && <strong>{label}</strong>}
      <span>{workflow.detail}</span>
      {showArtifactId && workflow.artifactId && (
        <small>Artifact ID: {workflow.artifactId}</small>
      )}
    </div>
  );
};

const idleWorkflow: WorkflowState = {
  stage: "idle",
  detail: "",
  artifactId: null,
};

export const TransactionAuthenticationRequired = ({
  returnTo,
  embedded = false,
}: {
  returnTo: string;
  embedded?: boolean;
}) => {
  const Page = embedded ? "div" : "main";
  return (
    <Page className="transaction-workflow-page">
      <header>
        <p className="eyebrow">Private preparation workspace</p>
        <h1>Sign in required</h1>
        <p>Sign in to open this transaction workflow.</p>
        <a href={`/auth/login?return_to=${encodeURIComponent(returnTo)}`}>
          Sign in
        </a>
      </header>
    </Page>
  );
};

export const ManualTransactionRoute = ({
  data,
  mode,
  returnTo,
  reviewReturnTo,
}: {
  data: ManualRouteData;
  mode: "create" | "edit";
  returnTo: string;
  reviewReturnTo?: string;
}) => {
  const router = useRouter();
  const transaction = data.transaction;
  const [workflow, setWorkflow] = useState(idleWorkflow);
  const [busy, setBusy] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidPending, setVoidPending] = useState(false);
  const [voidError, setVoidError] = useState("");
  const [completedTransactionId, setCompletedTransactionId] = useState<
    string | null
  >(null);
  const inFlight = useRef(false);
  const [issues, setIssues] = useState<readonly ManualTransactionServerIssue[]>(
    [],
  );
  const [artifactId, setArtifactId] = useState(
    transaction?.sourceArtifacts?.[0]?.id ??
      transaction?.sourceArtifactId ??
      null,
  );
  const [evidence, setEvidence] = useState<{
    filename: string;
    status: "selected" | "awaiting_review" | "approved" | "attached" | "failed";
  } | null>(
    artifactId
      ? {
          filename:
            transaction?.sourceArtifacts?.[0]?.filename ??
            transaction?.sourceArtifactFilename ??
            "Existing PDF attachment",
          status: "attached",
        }
      : null,
  );
  const [stagedPdf, setStagedPdf] = useState<{
    file: File;
    id: string;
    approved: boolean;
  } | null>(null);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null);
  const [stagedPreviewOpened, setStagedPreviewOpened] = useState(false);
  const [proposedEvidence, setProposedEvidence] = useState(
    data.proposedDraftEvidence,
  );
  const [proposedPreviewUrl, setProposedPreviewUrl] = useState<string | null>(
    null,
  );
  const [proposedPreviewOpened, setProposedPreviewOpened] = useState(false);

  if (
    !data.session.authenticated ||
    !data.formOptions ||
    !data.uiConfig ||
    !data.availableArtifacts
  )
    return <TransactionAuthenticationRequired returnTo={returnTo} />;

  if (mode === "edit" && !transaction)
    return (
      <main>
        <h1>Transaction not found</h1>
        <p>This record is unavailable or is not a manual transaction.</p>
        <a href="/transactions">Back to Transactions</a>
      </main>
    );

  if (transaction?.sourceSystem === "stripe")
    return (
      <main>
        <h1>Imported transaction</h1>
        <p>
          Stripe transactions are read-only. Review this record on its detail
          page.
        </p>
        <a href={`/transactions/${transaction.id}`}>View transaction</a>
      </main>
    );

  const current =
    transaction ??
    ({
      ...emptyTransaction,
      ownerId: data.session.authenticated ? data.session.user.id : null,
    } as TransactionRecord);
  const returnHref = reviewReturnTo ?? "/transactions";
  const returnLabel = reviewReturnTo ? "Reconcile" : "Transactions";
  const uploadEvidence = async (file: File, ownerId: string | null) => {
    setWorkflow({
      stage: "validating",
      detail: "Validating PDF evidence…",
      artifactId: null,
    });
    const checksumSha256 = await sha256Base64(file);
    setWorkflow({
      stage: "uploading",
      detail: "Uploading PDF evidence…",
      artifactId: null,
    });
    const started = await startArtifactUpload({
      data: {
        ownerId,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: file.name,
        mediaType: "application/pdf",
        byteSize: file.size,
        checksumSha256,
      },
    });
    const response = await fetch(started.uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "content-type": "application/pdf",
        "x-amz-checksum-sha256": checksumSha256,
        "x-amz-meta-folio-artifact-id": started.artifact.id,
      },
    });
    if (!response.ok) throw new Error(`PDF upload failed (${response.status})`);
    setWorkflow({
      stage: "confirming",
      detail: "Confirming PDF evidence…",
      artifactId: started.artifact.id,
    });
    const confirmed = await confirmArtifactUpload({
      data: { id: started.artifact.id },
    });
    setStagedPdf({ file, id: confirmed.id, approved: false });
    setReviewPreviewUrl(null);
    setStagedPreviewOpened(false);
    setEvidence({ filename: file.name, status: "awaiting_review" });
    return confirmed.id;
  };

  const preparePdfPreview = async () => {
    if (!stagedPdf || busy) return;
    setBusy(true);
    try {
      const url = await previewArtifactForReview({
        data: { id: stagedPdf.id },
      });
      setReviewPreviewUrl(url);
      setStagedPreviewOpened(false);
      setWorkflow({
        stage: "preview",
        detail: "Open the PDF preview, then approve the file if it is correct.",
        artifactId: stagedPdf.id,
      });
    } catch (error) {
      setWorkflow({
        stage: "error",
        detail: safeTransactionWorkflowError(
          error,
          "PDF preview could not be prepared. Retry before approving.",
        ),
        artifactId: stagedPdf.id,
      });
    } finally {
      setBusy(false);
    }
  };

  const approveStagedPdf = async () => {
    if (!stagedPdf || busy || !stagedPreviewOpened) return;
    setBusy(true);
    try {
      await approveArtifact({ data: { id: stagedPdf.id } });
      setStagedPdf({ ...stagedPdf, approved: true });
      setArtifactId(stagedPdf.id);
      setEvidence({ filename: stagedPdf.file.name, status: "approved" });
      setWorkflow({
        stage: "preview",
        detail: "PDF approved. Save the transaction to attach it.",
        artifactId: stagedPdf.id,
      });
    } catch (error) {
      setWorkflow({
        stage: "error",
        detail: safeTransactionWorkflowError(
          error,
          "PDF approval failed. The transaction was not saved.",
        ),
        artifactId: stagedPdf.id,
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshProposedEvidence = async () => {
    if (!transaction || busy) return;
    setBusy(true);
    try {
      const result = await getProposedDraftEvidence({
        data: { transactionId: transaction.id },
      });
      setProposedEvidence(result);
      setProposedPreviewUrl(null);
      setProposedPreviewOpened(false);
      setWorkflow({
        stage: "preview",
        detail: "Proposed PDF review state refreshed.",
        artifactId: result?.artifactId ?? null,
      });
    } catch (error) {
      setWorkflow({
        stage: "error",
        detail: safeTransactionWorkflowError(
          error,
          "Proposed PDF review state could not be refreshed.",
        ),
        artifactId: proposedEvidence?.artifactId ?? null,
      });
    } finally {
      setBusy(false);
    }
  };

  const previewProposedEvidence = async () => {
    if (!proposedEvidence || busy) return;
    setBusy(true);
    try {
      const url = await previewArtifactForReview({
        data: { id: proposedEvidence.artifactId },
      });
      setProposedPreviewUrl(url);
      setProposedPreviewOpened(false);
    } catch (error) {
      setWorkflow({
        stage: "error",
        detail: safeTransactionWorkflowError(
          error,
          "Proposed PDF preview could not be prepared.",
        ),
        artifactId: proposedEvidence.artifactId,
      });
    } finally {
      setBusy(false);
    }
  };

  const approveProposedEvidence = async () => {
    if (!proposedEvidence || !proposedPreviewOpened || busy) return;
    setBusy(true);
    try {
      await approveArtifact({ data: { id: proposedEvidence.artifactId } });
      setProposedEvidence({ ...proposedEvidence, state: "available" });
      setWorkflow({
        stage: "preview",
        detail: "Proposed PDF approved. Recording this draft will attach it.",
        artifactId: proposedEvidence.artifactId,
      });
    } catch (error) {
      setWorkflow({
        stage: "error",
        detail: safeTransactionWorkflowError(
          error,
          "Proposed PDF approval failed. The draft remains unrecorded.",
        ),
        artifactId: proposedEvidence.artifactId,
      });
    } finally {
      setBusy(false);
    }
  };

  const discardProposedEvidence = async () => {
    if (!proposedEvidence || !transaction || busy) return;
    setBusy(true);
    try {
      const result = await discardProposedDraftEvidence({
        data: { transactionId: transaction.id },
      });
      setProposedEvidence(result);
      setProposedPreviewUrl(null);
      setProposedPreviewOpened(false);
      setWorkflow({
        stage: "preview",
        detail:
          "Proposed PDF removed from this draft. The source artifact remains in Sources.",
        artifactId: result?.artifactId ?? null,
      });
    } catch (error) {
      setWorkflow({
        stage: "error",
        detail: safeTransactionWorkflowError(
          error,
          "Proposed PDF could not be removed from the draft.",
        ),
        artifactId: proposedEvidence.artifactId,
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async (submission: ManualTransactionSubmission) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setIssues([]);
    let confirmedId: string | null = null;
    let linkedIds = [...submission.artifactIds];
    try {
      if (
        proposedEvidence &&
        !proposedEvidence.discardedAt &&
        (submission.action === "save_recorded" ||
          submission.action === "restore_recorded")
      ) {
        if (proposedEvidence.state !== "available") {
          setWorkflow({
            stage: "error",
            detail:
              "Approve or remove the proposed PDF before recording this draft.",
            artifactId: proposedEvidence.artifactId,
          });
          return;
        }
        linkedIds = [...new Set([...linkedIds, proposedEvidence.artifactId])];
      }
      if (submission.file instanceof File && submission.file.size > 0) {
        if (stagedPdf?.file !== submission.file) {
          confirmedId = await uploadEvidence(
            submission.file,
            submission.transaction.ownerId,
          );
          setWorkflow({
            stage: "preview",
            detail:
              "PDF uploaded and awaiting review. Preview and approve it before saving the transaction.",
            artifactId: confirmedId,
          });
          return;
        }
        if (!stagedPdf.approved) {
          setWorkflow({
            stage: "preview",
            detail:
              "Preview and approve this PDF before saving the transaction.",
            artifactId: stagedPdf.id,
          });
          return;
        }
        linkedIds = [...new Set([...linkedIds, stagedPdf.id])];
      } else if (stagedPdf?.approved)
        linkedIds = [...new Set([...linkedIds, stagedPdf.id])];
      else if (artifactId) linkedIds = [...new Set([...linkedIds, artifactId])];
      setWorkflow({
        stage: "saving",
        detail: "Saving transaction…",
        artifactId: confirmedId ?? artifactId,
      });
      const result = await saveManualTransaction({
        data: {
          id: transaction?.id ?? null,
          expectedUpdatedAt: transaction?.updatedAt ?? null,
          action: submission.action,
          transaction: {
            ...submission.transaction,
            sourceArtifactId: linkedIds[0] ?? null,
          },
          artifactIds: linkedIds,
        },
      });
      if (result.status === "invalid") {
        setIssues(result.issues);
        setWorkflow({
          stage: "error",
          detail: "Review the highlighted transaction fields.",
          artifactId: confirmedId ?? artifactId,
        });
        return;
      }
      setCompletedTransactionId(result.transaction.id);
      setWorkflow({
        stage: "complete",
        detail: reviewReturnTo
          ? "Transaction saved. Return to Reconcile to review the selected bank row. Recording did not match it."
          : "Transaction saved. Return to the transaction list to review the refreshed record.",
        artifactId: confirmedId ?? artifactId,
      });
      try {
        await router.invalidate();
        if (mode === "create")
          await router.navigate({
            to: "/transactions/$transactionId",
            params: { transactionId: result.transaction.id },
            replace: true,
          });
      } catch {
        setWorkflow({
          stage: "complete",
          detail:
            "Transaction saved, but navigation failed. Do not resubmit; use the record link below.",
          artifactId: confirmedId ?? artifactId,
        });
      }
      return;
    } catch (error) {
      const failure = safeTransactionWorkflowError(
        error,
        "Transaction save failed. Retry the operation.",
      );
      if (/artifact|invoice/i.test(failure))
        setIssues([{ field: "artifact", message: failure }]);
      setWorkflow({
        stage: "error",
        detail: manualSaveFailureDetail(failure, confirmedId),
        artifactId: confirmedId ?? artifactId,
      });
      if (
        submission.file instanceof File &&
        submission.file.size > 0 &&
        !confirmedId &&
        stagedPdf?.file !== submission.file
      )
        setEvidence({ filename: submission.file.name, status: "failed" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const voidCurrent = async () => {
    if (!transaction || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setVoidPending(true);
    setVoidError("");
    try {
      await voidTransaction({
        data: { id: transaction.id, expectedUpdatedAt: transaction.updatedAt },
      });
      setVoidDialogOpen(false);
      setWorkflow({
        stage: "complete",
        detail:
          "Transaction voided. Return to the transaction list to review the refreshed record.",
        artifactId,
      });
      try {
        await router.invalidate();
      } catch {
        setWorkflow({
          stage: "complete",
          detail:
            "Transaction was voided, but the transaction list did not refresh. Reload before making further changes.",
          artifactId,
        });
      }
    } catch (error) {
      setVoidError(
        safeTransactionWorkflowError(
          error,
          "Transaction could not be voided. Reload before retrying.",
        ),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      setVoidPending(false);
    }
  };

  const requestVoid = () => {
    if (busy || inFlight.current) return;
    setVoidError("");
    setVoidDialogOpen(true);
  };

  const counterparties = [
    ...new Set(data.formOptions.entrySuggestions.counterparties),
  ];
  const categories = [
    ...new Set([
      ...expenseCategorySuggestions,
      ...data.formOptions.entrySuggestions.categories,
    ]),
  ];
  if (completedTransactionId && mode === "create")
    return (
      <main className="transaction-workflow-page">
        <header>
          <p className="eyebrow">Transaction saved</p>
          <h1>Manual transaction created</h1>
          <p>The saved record will not be submitted again from this page.</p>
        </header>
        <div className="actions">
          <a href={`/transactions/${completedTransactionId}`}>
            View transaction
          </a>
          <a href="/transactions/new">Create another transaction</a>
        </div>
      </main>
    );
  return (
    <main className="transaction-workflow-page">
      <a
        className="transaction-button-link transaction-button-link--secondary"
        href={returnHref}
      >
        ← {returnLabel}
      </a>
      <header>
        <p className="eyebrow">Transactions</p>
        <h1>
          {mode === "create"
            ? "New manual transaction"
            : "Edit manual transaction"}
        </h1>
        <p>
          {mode === "create"
            ? "Record one manual business transaction and its evidence."
            : "Correct this manual record, its evidence, or its state."}
        </p>
      </header>
      {proposedEvidence && !proposedEvidence.discardedAt && (
        <section
          className="transaction-proposed-evidence"
          aria-label="Proposed PDF evidence"
        >
          <h2>Proposed PDF evidence</h2>
          <p>
            {proposedEvidence.filename} ·{" "}
            {proposedEvidence.state.replaceAll("_", " ")}
          </p>
          {proposedEvidence.note && <p>{proposedEvidence.note}</p>}
          <p>
            {proposedEvidence.state === "available"
              ? "This approved PDF will be attached when the draft is recorded."
              : "Approve this PDF or remove the proposal before recording the draft."}
          </p>
          <div className="actions">
            {proposedEvidence.state === "awaiting_review" && (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void previewProposedEvidence()}
                >
                  Prepare PDF preview
                </button>
                {proposedPreviewUrl && (
                  <a
                    href={proposedPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setProposedPreviewOpened(true)}
                  >
                    Open PDF preview
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy || !proposedPreviewOpened}
                  onClick={() => void approveProposedEvidence()}
                >
                  Approve PDF
                </button>
              </>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void refreshProposedEvidence()}
            >
              Refresh PDF status
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void discardProposedEvidence()}
            >
              Remove proposed PDF
            </button>
          </div>
        </section>
      )}
      <ManualTransactionForm
        transaction={{
          ...current,
          taxTreatment:
            current.taxTreatment ??
            defaultTaxTreatmentForTransaction(
              current.documentCurrency,
              current.kind,
            ),
        }}
        autoDefaultTaxTreatment={mode === "create"}
        users={data.formOptions.users}
        counterparties={counterparties}
        supplierCategories={
          data.formOptions.entrySuggestions.supplierCategories
        }
        categories={categories}
        gstRegistered={data.uiConfig.gstRegistered}
        attachedArtifactId={artifactId}
        attachedArtifactIds={
          transaction?.sourceArtifacts?.map((artifact) => artifact.id) ??
          (transaction?.sourceArtifactId ? [transaction.sourceArtifactId] : [])
        }
        availableArtifacts={data.availableArtifacts}
        evidenceStatus={
          <div>
            <p id="pdf-evidence-status" role="status" aria-live="polite">
              {evidence
                ? `PDF filename: ${evidence.filename}. Status: ${evidence.status === "attached" ? "already attached" : evidence.status.replaceAll("_", " ")}.`
                : "No PDF selected or attached."}
            </p>
            {stagedPdf && !stagedPdf.approved && (
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void preparePdfPreview()}
                >
                  Prepare PDF preview
                </button>
                {reviewPreviewUrl && (
                  <a
                    href={reviewPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setStagedPreviewOpened(true)}
                  >
                    Open PDF preview
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy || !stagedPreviewOpened}
                  onClick={() => void approveStagedPdf()}
                >
                  Approve PDF
                </button>
              </div>
            )}
          </div>
        }
        busy={busy}
        serverIssues={issues}
        onEvidenceChange={(file) => {
          setEvidence(
            file ? { filename: file.name, status: "selected" } : null,
          );
          if (stagedPdf?.file !== file) {
            setStagedPdf(null);
            setReviewPreviewUrl(null);
            setStagedPreviewOpened(false);
          }
        }}
        onSubmit={save}
        onCancel={
          mode === "edit" ? () => window.location.assign(returnHref) : undefined
        }
      />
      <WorkflowStatus
        workflow={workflow}
        label=""
        showArtifactId={workflow.stage !== "error"}
        alertErrors
        focusErrors
      />
      {transaction && transaction.status !== "void" && (
        <div className="actions transaction-workflow-page__void-actions">
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={requestVoid}
          >
            Void transaction
          </button>
        </div>
      )}
      {voidDialogOpen && transaction ? (
        <ConfirmationDialog
          title="Void transaction?"
          description={voidTransactionConfirmation(
            transaction.reference,
            transaction.id,
          )}
          confirmLabel="Void transaction"
          pending={voidPending}
          error={voidError}
          onCancel={() => setVoidDialogOpen(false)}
          onConfirm={() => void voidCurrent()}
        />
      ) : null}
      {workflow.stage === "complete" && (
        <p className="transaction-workflow-page__return">
          <a
            className="transaction-button-link transaction-button-link--secondary"
            href={returnHref}
          >
            Return to {returnLabel}
          </a>
        </p>
      )}
    </main>
  );
};

type StripeQueueStatus =
  | "pending"
  | "validating"
  | "uploading"
  | "confirming"
  | "previewing"
  | "preview"
  | "accepted"
  | "rejecting"
  | "rejected"
  | "importing"
  | "imported"
  | "failed";

interface StripeQueueItem {
  id: number;
  file: File | null;
  filename: string;
  byteSize: number;
  status: StripeQueueStatus;
  decision: "accepted" | "rejected" | null;
  artifactId: string | null;
  uploadConfirmed: boolean;
  canRetryConfirmation: boolean;
  preview: StripeImportPreview | null;
  previewStale: boolean;
  canRetryPreview: boolean;
  sourceInvalid: boolean;
  importedCount: number | null;
  errorDetail: string | null;
  filenameMatchCount: number | null;
  filenameMatchCheckFailed: boolean;
  duplicateWarnings: CsvDuplicateWarningReport | null;
  duplicateWarningCheckFailed: boolean;
}

const stripeFileSelectionError = (file: File): string | null => {
  if (file.size === 0) return "This file is empty. Choose a non-empty CSV.";
  if (file.type !== "text/csv" && !file.name.toLowerCase().endsWith(".csv"))
    return "This is not a CSV file. Choose a Stripe Balance Summary itemised CSV.";
  return null;
};

const stripeQueueStatusText = (item: StripeQueueItem): string => {
  if (item.status === "rejected")
    return "Rejected — archived file remains visible";
  if (item.status === "rejecting") return "Rejecting archived file…";
  if (item.previewStale && item.status !== "imported")
    return "Review needs refresh";
  if (item.status === "pending") return "Ready to upload";
  if (item.status === "validating") return "Validating file…";
  if (item.status === "uploading") return "Uploading…";
  if (item.status === "confirming") return "Confirming archived file…";
  if (item.status === "previewing") return "Loading preview…";
  if (item.status === "preview")
    return "Preview ready — choose Add to batch or Reject";
  if (item.status === "accepted")
    return "Added to batch — awaiting confirmation";
  if (item.status === "importing") return "Importing atomically…";
  if (item.status === "imported")
    return item.importedCount === 0
      ? "Import complete — no new rows"
      : "Import complete";
  return "Needs attention";
};

export const StripeImportRoute = ({
  session,
  embedded = false,
}: {
  session: Awaited<ReturnType<typeof getCurrentSession>>;
  embedded?: boolean;
}) => {
  const router = useRouter();
  const [queueItems, setQueueItems] = useState<StripeQueueItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [reviewingItemId, setReviewingItemId] = useState<number | null>(null);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [savedQueueOffset, setSavedQueueOffset] = useState(0);
  const [savedQueueTotal, setSavedQueueTotal] = useState(0);
  const [loadingSavedQueue, setLoadingSavedQueue] = useState(false);
  const nextQueueId = useRef(0);
  const inFlight = useRef(false);

  const loadSavedQueue = async (offset: number) => {
    setLoadingSavedQueue(true);
    try {
      const result = await listArtifacts({
        data: {
          search: "",
          profile: "stripe_balance_itemised_csv_v1",
          state: "awaiting_review",
          from: null,
          to: null,
          linkage: "all",
          limit: 100,
          offset,
        },
      });
      setQueueItems((items) => {
        const existingIds = new Set(items.map((item) => item.artifactId));
        const restored = result.rows
          .filter((row) => !existingIds.has(row.id))
          .map(
            (row): StripeQueueItem => ({
              id: nextQueueId.current++,
              file: null,
              filename: row.filename,
              byteSize: Number(row.byteSize),
              status: "preview",
              decision: null,
              artifactId: row.id,
              uploadConfirmed: true,
              canRetryConfirmation: false,
              preview: null,
              previewStale: false,
              canRetryPreview: true,
              sourceInvalid: false,
              importedCount: null,
              errorDetail: null,
              filenameMatchCount: 0,
              filenameMatchCheckFailed: false,
              duplicateWarnings: null,
              duplicateWarningCheckFailed: false,
            }),
          );
        return [...items, ...restored];
      });
      setSavedQueueOffset(offset + result.rows.length);
      setSavedQueueTotal(result.total);
    } catch {
      setQueueNotice(
        "Saved Stripe files could not be loaded. Retry from the file library.",
      );
    } finally {
      setLoadingSavedQueue(false);
    }
  };

  useEffect(() => {
    if (!session.authenticated) return;
    void loadSavedQueue(0);
  }, [session.authenticated]);
  if (!session.authenticated) {
    const authenticationRequired = (
      <TransactionAuthenticationRequired
        returnTo="/imports/stripe"
        embedded={embedded}
      />
    );
    return authenticationRequired;
  }

  const updateQueueItem = (id: number, changes: Partial<StripeQueueItem>) =>
    setQueueItems((items) =>
      items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );

  const checkDuplicateWarnings = async (id: number, artifactId: string) => {
    try {
      const duplicateWarnings = await getCsvDuplicateWarnings({
        data: { artifactId },
      });
      updateQueueItem(id, {
        duplicateWarnings,
        duplicateWarningCheckFailed: false,
      });
    } catch {
      updateQueueItem(id, { duplicateWarningCheckFailed: true });
    }
  };

  const addFiles = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedFiles.length === 0) return;
    const addedItems = selectedFiles.map((file) => {
      const errorDetail = stripeFileSelectionError(file);
      return {
        id: nextQueueId.current++,
        file,
        filename: file.name,
        byteSize: file.size,
        status: errorDetail ? ("failed" as const) : ("pending" as const),
        decision: null,
        artifactId: null,
        uploadConfirmed: false,
        canRetryConfirmation: false,
        preview: null,
        previewStale: false,
        canRetryPreview: false,
        sourceInvalid: errorDetail !== null,
        importedCount: null,
        errorDetail,
        filenameMatchCount: null,
        filenameMatchCheckFailed: false,
        duplicateWarnings: null,
        duplicateWarningCheckFailed: false,
      } satisfies StripeQueueItem;
    });
    setQueueItems((items) => [...items, ...addedItems]);
    const addedIndices = new Map(
      addedItems.map((item, index) => [item.id, index]),
    );
    void findArtifactFilenameMatches({
      data: {
        profile: "stripe_balance_itemised_csv_v1",
        filenames: addedItems.map((item) => item.file.name),
      },
    })
      .then((matchCounts) =>
        setQueueItems((items) =>
          items.map((item) => {
            const matchIndex = addedIndices.get(item.id);
            if (matchIndex === undefined) return item;
            return {
              ...item,
              filenameMatchCount: matchCounts[matchIndex] ?? 0,
            };
          }),
        ),
      )
      .catch(() =>
        setQueueItems((items) =>
          items.map((item) =>
            addedIndices.has(item.id)
              ? { ...item, filenameMatchCheckFailed: true }
              : item,
          ),
        ),
      );
    setSelectedFiles([]);
    setQueueNotice(null);
    event.currentTarget.reset();
  };

  const uploadAndPreview = async (id: number) => {
    const item = queueItems.find((candidate) => candidate.id === id);
    if (
      !item ||
      !item.file ||
      item.sourceInvalid ||
      item.uploadConfirmed ||
      item.decision !== null ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusyItemId(id);
    setReviewingItemId(id);
    setQueueNotice(null);
    updateQueueItem(id, {
      status: "validating",
      artifactId: null,
      uploadConfirmed: false,
      canRetryConfirmation: false,
      preview: null,
      previewStale: false,
      canRetryPreview: false,
      errorDetail: null,
    });
    let artifactId: string | null = null;
    let confirmationAttempted = false;
    let uploadConfirmed = false;
    try {
      const checksumSha256 = await sha256Base64(item.file);
      const started = await startArtifactUpload({
        data: {
          ownerId: null,
          artifactProfile: "stripe_balance_itemised_csv_v1",
          filename: item.filename,
          mediaType: "text/csv",
          byteSize: item.byteSize,
          checksumSha256,
        },
      });
      artifactId = started.artifact.id;
      updateQueueItem(id, { status: "uploading", artifactId });
      const response = await fetch(started.uploadUrl, {
        method: "PUT",
        body: item.file,
        headers: {
          "content-type": "text/csv",
          "x-amz-checksum-sha256": checksumSha256,
          "x-amz-meta-folio-artifact-id": artifactId,
        },
      });
      if (!response.ok)
        throw new Error(`Stripe CSV upload failed (${response.status})`);
      updateQueueItem(id, { status: "confirming" });
      confirmationAttempted = true;
      await confirmArtifactUpload({ data: { id: artifactId } });
      uploadConfirmed = true;
      updateQueueItem(id, {
        status: "previewing",
        uploadConfirmed: true,
        canRetryConfirmation: false,
        canRetryPreview: true,
      });
      const preview = await previewStripeCsv({
        data: { artifactId, page: 1 },
      });
      updateQueueItem(id, {
        status: "preview",
        decision: null,
        artifactId,
        uploadConfirmed: true,
        canRetryConfirmation: false,
        preview,
        previewStale: false,
        canRetryPreview: true,
        errorDetail: null,
      });
      void checkDuplicateWarnings(id, artifactId);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const failure = safeTransactionWorkflowError(
        error,
        uploadConfirmed
          ? "The confirmed Stripe CSV preview could not be loaded."
          : confirmationAttempted
            ? "Stripe upload confirmation could not be verified."
            : "Stripe upload failed before confirmation.",
      );
      const invalidStripeCsv =
        rawMessage.includes("STRIPE_CSV_INVALID") ||
        failure.includes("STRIPE_CSV_INVALID");
      const unsupportedReport =
        rawMessage.includes("Stripe All activity export") ||
        failure.includes("Stripe All activity export");
      const sourceInvalid = uploadConfirmed && invalidStripeCsv;
      const errorDetail = sourceInvalid
        ? unsupportedReport
          ? "Unsupported Stripe All activity export. Export the itemised Balance change from activity CSV from Reporting > Balance Summary Reports."
          : "This CSV is malformed or does not match the Stripe Balance Summary itemised format. Correct the source file and add it again."
        : uploadConfirmed
          ? `${failure} The validated artifact awaits review; retry its preview without uploading again.`
          : confirmationAttempted
            ? `${failure} Retry confirmation for this same uploaded artifact before previewing it.`
            : `${failure} The artifact is not confirmed and cannot be previewed. Retry this file or choose the source again.`;
      updateQueueItem(id, {
        status: "failed",
        decision: null,
        artifactId,
        uploadConfirmed,
        canRetryConfirmation: confirmationAttempted && !uploadConfirmed,
        preview: null,
        previewStale: false,
        canRetryPreview: uploadConfirmed && !invalidStripeCsv,
        sourceInvalid,
        errorDetail,
      });
    } finally {
      inFlight.current = false;
      setBusyItemId(null);
    }
  };

  const retryConfirmation = async (id: number) => {
    const item = queueItems.find((candidate) => candidate.id === id);
    if (
      !item?.artifactId ||
      !item.canRetryConfirmation ||
      item.uploadConfirmed ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusyItemId(id);
    setReviewingItemId(id);
    setQueueNotice(null);
    updateQueueItem(id, { status: "confirming", errorDetail: null });
    let confirmed = false;
    try {
      await confirmArtifactUpload({ data: { id: item.artifactId } });
      confirmed = true;
      updateQueueItem(id, {
        status: "previewing",
        uploadConfirmed: true,
        canRetryConfirmation: false,
        canRetryPreview: true,
      });
      const preview = await previewStripeCsv({
        data: { artifactId: item.artifactId, page: 1 },
      });
      updateQueueItem(id, {
        status: "preview",
        uploadConfirmed: true,
        canRetryConfirmation: false,
        canRetryPreview: true,
        preview,
        previewStale: false,
        errorDetail: null,
      });
      void checkDuplicateWarnings(id, item.artifactId);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const failure = safeTransactionWorkflowError(
        error,
        confirmed
          ? "The confirmed Stripe CSV preview could not be loaded."
          : "Stripe upload confirmation could not be verified.",
      );
      const sourceInvalid =
        confirmed &&
        (rawMessage.includes("STRIPE_CSV_INVALID") ||
          failure.includes("STRIPE_CSV_INVALID"));
      const unsupportedReport =
        rawMessage.includes("Stripe All activity export") ||
        failure.includes("Stripe All activity export");
      updateQueueItem(id, {
        status: "failed",
        uploadConfirmed: confirmed,
        canRetryConfirmation: !confirmed,
        canRetryPreview: confirmed && !sourceInvalid,
        sourceInvalid,
        errorDetail: sourceInvalid
          ? unsupportedReport
            ? "Unsupported Stripe All activity export. Export the itemised Balance change from activity CSV from Reporting > Balance Summary Reports."
            : "This CSV is malformed or does not match the Stripe Balance Summary itemised format. Correct the source file and add it again."
          : confirmed
            ? `${failure} Retry preview without uploading again.`
            : `${failure} Retry confirmation for this same uploaded artifact.`,
      });
    } finally {
      inFlight.current = false;
      setBusyItemId(null);
    }
  };

  const loadConfirmedPreview = async (id: number, page: number) => {
    const item = queueItems.find((candidate) => candidate.id === id);
    if (!item?.artifactId || !item.uploadConfirmed || inFlight.current) return;
    inFlight.current = true;
    setBusyItemId(id);
    setReviewingItemId(id);
    setQueueNotice(null);
    updateQueueItem(id, { status: "previewing", errorDetail: null });
    try {
      const preview = await previewStripeCsv({
        data: { artifactId: item.artifactId, page },
      });
      updateQueueItem(id, {
        status: item.decision === "accepted" ? "accepted" : "preview",
        preview,
        previewStale: false,
        canRetryPreview: true,
        errorDetail: null,
      });
      void checkDuplicateWarnings(id, item.artifactId);
    } catch (error) {
      const failure = safeTransactionWorkflowError(
        error,
        "The confirmed Stripe CSV preview could not be loaded.",
      );
      updateQueueItem(id, {
        status: "failed",
        previewStale: true,
        canRetryPreview: true,
        errorDetail: `${failure} The validated artifact still awaits review; retry its preview without uploading again.`,
      });
    } finally {
      inFlight.current = false;
      setBusyItemId(null);
    }
  };

  const addToBatch = (id: number) => {
    const item = queueItems.find((candidate) => candidate.id === id);
    if (
      !item?.preview ||
      !item.uploadConfirmed ||
      item.previewStale ||
      item.preview.conflictCount > 0 ||
      item.decision !== null ||
      inFlight.current
    )
      return;
    updateQueueItem(id, {
      status: "accepted",
      decision: "accepted",
      errorDetail: null,
    });
    setQueueNotice(
      `${item.filename} was added to the batch. No transactions have been imported.`,
    );
  };

  const rejectFile = async (id: number) => {
    const item = queueItems.find((candidate) => candidate.id === id);
    if (
      !item?.artifactId ||
      !item.uploadConfirmed ||
      item.status === "imported" ||
      item.status === "rejected" ||
      item.status === "importing" ||
      item.decision === "rejected" ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusyItemId(id);
    setQueueNotice(null);
    updateQueueItem(id, { status: "rejecting" });
    try {
      await rejectArtifact({ data: { id: item.artifactId } });
      updateQueueItem(id, {
        status: "rejected",
        decision: "rejected",
        previewStale: false,
        errorDetail: item.sourceInvalid ? item.errorDetail : null,
      });
      if (reviewingItemId === id) setReviewingItemId(null);
      setQueueNotice(
        `${item.filename} was rejected and remains visible in the queue.`,
      );
    } catch (error) {
      const failure = safeTransactionWorkflowError(
        error,
        "The archived Stripe CSV could not be marked as rejected.",
      );
      updateQueueItem(id, {
        status:
          item.decision === "accepted"
            ? "accepted"
            : item.preview
              ? "preview"
              : "failed",
        errorDetail: item.errorDetail
          ? `${item.errorDetail} Rejection failed: ${failure}.`
          : `${failure} The file still awaits review; rejection was not confirmed.`,
      });
    } finally {
      inFlight.current = false;
      setBusyItemId(null);
    }
  };

  const confirmBatch = async () => {
    const acceptedItems = queueItems.filter(
      (item) => item.decision === "accepted",
    );
    const importItems = acceptedItems.filter(
      (item) => item.status !== "imported",
    );
    const ready =
      importItems.length > 0 &&
      importItems.every(
        (item) =>
          item.status === "accepted" &&
          item.preview !== null &&
          !item.previewStale &&
          item.preview.conflictCount === 0,
      );
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setBusyItemId(importItems[0]!.id);
    setQueueNotice(null);
    let completedFiles = 0;
    let importedRows = 0;
    let filesNeedingReview = 0;
    let importedAny = false;
    try {
      for (const item of importItems) {
        setBusyItemId(item.id);
        updateQueueItem(item.id, { status: "importing", errorDetail: null });
        try {
          const freshPreview = await previewStripeCsv({
            data: { artifactId: item.artifactId!, page: 1 },
          });
          updateQueueItem(item.id, {
            status: "accepted",
            preview: freshPreview,
            previewStale: false,
            errorDetail: null,
          });
          if (freshPreview.conflictCount > 0) {
            updateQueueItem(item.id, {
              status: "failed",
              errorDetail: `The refreshed preview contains ${freshPreview.conflictCount} conflicting Stripe references. Reject this file or resolve the conflicts before another confirmation.`,
            });
            filesNeedingReview += 1;
            continue;
          }
          const count = await importStripeCsv({
            data: { artifactId: item.artifactId! },
          });
          updateQueueItem(item.id, {
            status: "imported",
            importedCount: count,
            previewStale: false,
            errorDetail: null,
          });
          completedFiles += 1;
          importedRows += count;
          importedAny = true;
        } catch (error) {
          const failure = safeTransactionWorkflowError(
            error,
            "Stripe batch import failed. The archived CSV still awaits review.",
          );
          const outcomeUnknown =
            /\bDB_OUTCOME_UNKNOWN\b/.test(failure) ||
            (error instanceof Error &&
              error.message.includes("DB_OUTCOME_UNKNOWN"));
          const conflict =
            /\bSTRIPE_IMPORT_CONFLICT\b/.test(failure) ||
            /Stripe balance transaction conflicts/.test(failure);
          updateQueueItem(item.id, {
            status: "failed",
            previewStale: true,
            errorDetail: outcomeUnknown
              ? `${failure} Refresh this file before retrying; imported references will show as already imported.`
              : conflict
                ? `${failure} Refresh this file's preview to inspect the conflicting references.`
                : `${failure} No partial import is committed for this file. Refresh its preview before retrying.`,
          });
          filesNeedingReview += 1;
        }
      }
      setReviewingItemId(null);
      const summary =
        filesNeedingReview > 0
          ? `Batch finished: ${completedFiles} file${completedFiles === 1 ? "" : "s"} completed, ${importedRows} new rows imported, and ${filesNeedingReview} file${filesNeedingReview === 1 ? " needs" : "s need"} review. Completed files will not be retried.`
          : `Batch finished: ${completedFiles} file${completedFiles === 1 ? "" : "s"} completed; ${importedRows} new rows imported.`;
      setQueueNotice(summary);
      if (importedAny) {
        try {
          await router.invalidate();
        } catch {
          setQueueNotice(
            `${summary} The page refresh failed; completed files remain marked and will not be retried.`,
          );
        }
      }
    } finally {
      inFlight.current = false;
      setBusyItemId(null);
    }
  };

  const removeQueueItem = (id: number) => {
    if (inFlight.current) return;
    const item = queueItems.find((candidate) => candidate.id === id);
    if (!item || item.uploadConfirmed) return;
    setQueueItems((items) => items.filter((item) => item.id !== id));
    if (reviewingItemId === id) setReviewingItemId(null);
  };

  const closePreview = () => {
    if (reviewingItemId === null || inFlight.current) return;
    setReviewingItemId(null);
    setQueueNotice(
      "Preview closed. No import was started. The validated CSV remains in the queue.",
    );
  };

  const reviewingItem = queueItems.find((item) => item.id === reviewingItemId);
  const preview = reviewingItem?.preview ?? null;
  const busy = busyItemId !== null;
  const acceptedItems = queueItems.filter(
    (item) => item.decision === "accepted",
  );
  const importItems = acceptedItems.filter(
    (item) => item.status !== "imported",
  );
  const canConfirmBatch =
    importItems.length > 0 &&
    importItems.every(
      (item) =>
        item.status === "accepted" &&
        item.preview !== null &&
        !item.previewStale &&
        item.preview.conflictCount === 0,
    );
  const batchTotals = acceptedItems.reduce(
    (totals, item) => ({
      totalCount: totals.totalCount + (item.preview?.totalCount ?? 0),
      willImportCount:
        totals.willImportCount + (item.preview?.willImportCount ?? 0),
      alreadyImportedCount:
        totals.alreadyImportedCount + (item.preview?.alreadyImportedCount ?? 0),
      conflictCount: totals.conflictCount + (item.preview?.conflictCount ?? 0),
    }),
    {
      totalCount: 0,
      willImportCount: 0,
      alreadyImportedCount: 0,
      conflictCount: 0,
    },
  );

  const Page = embedded ? "div" : "main";
  return (
    <Page className="transaction-workflow-page">
      {!embedded && (
        <>
          <a href="/transactions">← Transactions</a>
          <header>
            <p className="eyebrow">Transactions</p>
            <h1>Import Stripe CSV</h1>
            <p>
              Review each file, add it to the batch or reject its archived
              artifact, then confirm the accepted batch once.
            </p>
          </header>
          <SourceTabs active="stripe" />
        </>
      )}
      <section aria-labelledby="stripe-choose-heading">
        <h2 id="stripe-choose-heading">Choose files</h2>
        <form onSubmit={addFiles} className="upload">
          <label htmlFor="stripe-csv">
            Stripe itemised CSV
            <input
              id="stripe-csv"
              name="stripeCsv"
              type="file"
              accept="text/csv,.csv"
              multiple
              required
              disabled={busy}
              onChange={(event) =>
                setSelectedFiles(Array.from(event.currentTarget.files ?? []))
              }
            />
          </label>
          <button type="submit" disabled={busy || selectedFiles.length === 0}>
            Queue files for review
          </button>
        </form>
        <p>
          Export the itemised “Balance change from activity” CSV from Reporting
          &gt; Balance Summary Reports. Stripe’s All activity export is
          unsupported. Review each uploaded file and choose Add to batch or
          Reject. Nothing is imported until you confirm the accepted batch.
        </p>
      </section>
      <section
        className="stripe-import-queue"
        aria-labelledby="stripe-queue-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Per-file decisions</p>
            <h2 id="stripe-queue-heading">Upload and review files</h2>
          </div>
          <p>{queueItems.length} files in queue</p>
        </div>
        {queueItems.length === 0 ? (
          <p>No Stripe CSV files have been added yet.</p>
        ) : (
          <ol className="stripe-import-queue__list">
            {queueItems.map((item) => {
              const canRemove =
                !item.uploadConfirmed &&
                !item.canRetryConfirmation &&
                (item.status === "pending" || item.status === "failed");
              const canUpload =
                item.status === "pending" ||
                (item.status === "failed" &&
                  !item.uploadConfirmed &&
                  !item.canRetryConfirmation &&
                  !item.sourceInvalid);
              const canRetryConfirmation =
                item.status === "failed" &&
                !item.uploadConfirmed &&
                item.canRetryConfirmation &&
                item.artifactId !== null;
              const canRetryPreview =
                item.status === "failed" &&
                item.uploadConfirmed &&
                item.canRetryPreview &&
                !item.preview &&
                item.decision !== "rejected";
              const canLoadSavedPreview =
                item.status === "preview" &&
                item.uploadConfirmed &&
                !item.preview;
              const canReviewPreview =
                item.preview !== null &&
                item.status !== "imported" &&
                item.status !== "rejected" &&
                item.status !== "rejecting" &&
                item.id !== reviewingItemId;
              const actionLabel = canRetryConfirmation
                ? `Retry confirmation for ${item.filename}`
                : canUpload
                  ? item.status === "pending"
                    ? `Upload and preview ${item.filename}`
                    : `Retry upload ${item.filename}`
                  : canRetryPreview
                    ? `Retry preview ${item.filename}`
                    : canLoadSavedPreview
                      ? `Load preview for ${item.filename}`
                      : canReviewPreview &&
                          (item.previewStale ||
                            item.status === "failed" ||
                            (item.preview?.conflictCount ?? 0) > 0)
                        ? `Refresh preview for ${item.filename}`
                        : canReviewPreview
                          ? `Review preview for ${item.filename}`
                          : null;
              const canReject =
                item.uploadConfirmed &&
                item.status !== "imported" &&
                item.status !== "rejected" &&
                item.status !== "rejecting" &&
                item.status !== "importing";

              return (
                <li
                  key={item.id}
                  className={`stripe-import-queue__item stripe-import-queue__item--${item.status}`}
                >
                  <div className="stripe-import-queue__file">
                    <strong>{item.filename}</strong>
                    <span>
                      {(item.byteSize / 1024).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}{" "}
                      KB
                    </span>
                  </div>
                  {item.filenameMatchCount === null &&
                    !item.filenameMatchCheckFailed && (
                      <p
                        className="artifact-filename-match-warning"
                        role="status"
                      >
                        Checking for an existing filename…
                      </p>
                    )}
                  {item.filenameMatchCount !== null &&
                    item.filenameMatchCount > 0 && (
                      <p
                        className="artifact-filename-match-warning"
                        role="status"
                      >
                        {item.filenameMatchCount} existing artifact
                        {item.filenameMatchCount === 1 ? "" : "s"} match this
                        filename.
                      </p>
                    )}
                  {item.filenameMatchCheckFailed && (
                    <p
                      className="artifact-filename-match-warning"
                      role="status"
                    >
                      Could not check this filename; upload remains possible.
                    </p>
                  )}
                  <CsvDuplicateWarnings report={item.duplicateWarnings} />
                  {item.duplicateWarningCheckFailed && (
                    <p className="artifact-duplicate-warning" role="status">
                      Could not check duplicate CSV content; review remains
                      possible.
                    </p>
                  )}
                  <p
                    className={`stripe-import-queue__status stripe-import-queue__status--${item.status}`}
                    role={item.status === "failed" ? "alert" : "status"}
                    aria-live={
                      item.status === "failed" ? "assertive" : "polite"
                    }
                  >
                    {stripeQueueStatusText(item)}
                    {item.importedCount !== null &&
                      ` — ${item.importedCount} new rows`}
                  </p>
                  {item.preview && item.decision === "accepted" && (
                    <p>
                      {item.preview.totalCount} rows:{" "}
                      {item.preview.willImportCount} new,{" "}
                      {item.preview.alreadyImportedCount} already imported,{" "}
                      {item.preview.conflictCount} conflicts.
                    </p>
                  )}
                  {item.errorDetail && (
                    <p className="stripe-import-queue__error">
                      {item.errorDetail}
                    </p>
                  )}
                  <div className="stripe-import-preview__actions">
                    {actionLabel && (
                      <button
                        type="button"
                        className={
                          canUpload ||
                          canRetryConfirmation ||
                          canRetryPreview ||
                          canLoadSavedPreview
                            ? undefined
                            : "secondary"
                        }
                        disabled={busy}
                        onClick={() => {
                          if (canRetryConfirmation)
                            void retryConfirmation(item.id);
                          else if (canUpload) void uploadAndPreview(item.id);
                          else if (canRetryPreview || canLoadSavedPreview)
                            void loadConfirmedPreview(item.id, 1);
                          else if (
                            item.previewStale ||
                            item.status === "failed" ||
                            (item.preview?.conflictCount ?? 0) > 0
                          )
                            void loadConfirmedPreview(item.id, 1);
                          else setReviewingItemId(item.id);
                        }}
                      >
                        {actionLabel}
                      </button>
                    )}
                    {canReject && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void rejectFile(item.id)}
                      >
                        Reject {item.filename}
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => removeQueueItem(item.id)}
                      >
                        Remove {item.filename}
                      </button>
                    )}
                    {item.status === "imported" && (
                      <a href="/transactions">Review imported transactions</a>
                    )}
                    {item.status === "rejected" && (
                      <a href="/imports/library?state=rejected">
                        View rejected artifacts
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {savedQueueOffset < savedQueueTotal && (
          <button
            type="button"
            className="secondary"
            disabled={busy || loadingSavedQueue}
            onClick={() => void loadSavedQueue(savedQueueOffset)}
          >
            {loadingSavedQueue
              ? "Loading saved files…"
              : "Load more saved files"}
          </button>
        )}
      </section>
      {queueNotice && (
        <p className="stripe-import-queue__notice" role="status">
          {queueNotice}
        </p>
      )}
      <section
        className="stripe-import-batch"
        aria-labelledby="stripe-batch-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Batch review</p>
            <h2 id="stripe-batch-heading">Accepted files</h2>
          </div>
          <p>{acceptedItems.length} files added to batch</p>
        </div>
        {acceptedItems.length === 0 ? (
          <p>Add a previewed file to the batch to see combined counts here.</p>
        ) : (
          <>
            <dl className="stripe-import-batch__totals">
              <div>
                <dt>Rows</dt>
                <dd>{batchTotals.totalCount}</dd>
              </div>
              <div>
                <dt>New</dt>
                <dd>{batchTotals.willImportCount}</dd>
              </div>
              <div>
                <dt>Already imported</dt>
                <dd>{batchTotals.alreadyImportedCount}</dd>
              </div>
              <div>
                <dt>Conflicts</dt>
                <dd>{batchTotals.conflictCount}</dd>
              </div>
            </dl>
            <ol className="stripe-import-batch__list">
              {acceptedItems.map((item) => (
                <li key={item.id} className="stripe-import-batch__item">
                  <div className="stripe-import-queue__file">
                    <strong>{item.filename}</strong>
                    <span>{stripeQueueStatusText(item)}</span>
                  </div>
                  {item.preview ? (
                    <p>
                      {item.preview.totalCount} rows:{" "}
                      {item.preview.willImportCount} new,{" "}
                      {item.preview.alreadyImportedCount} already imported,{" "}
                      {item.preview.conflictCount} conflicts.
                    </p>
                  ) : (
                    <p>Preview unavailable. Refresh it before confirming.</p>
                  )}
                  {item.errorDetail && (
                    <p className="stripe-import-queue__error" role="alert">
                      {item.errorDetail}
                    </p>
                  )}
                  {item.previewStale && (
                    <p className="stripe-import-preview__blocking" role="alert">
                      This file must be refreshed before the batch can be
                      confirmed.
                    </p>
                  )}
                  <div className="stripe-import-preview__actions">
                    {item.status !== "imported" && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            item.previewStale ||
                            item.status === "failed" ||
                            !item.preview ||
                            item.preview.conflictCount > 0
                          )
                            void loadConfirmedPreview(item.id, 1);
                          else setReviewingItemId(item.id);
                        }}
                      >
                        {item.previewStale ||
                        item.status === "failed" ||
                        !item.preview ||
                        item.preview.conflictCount > 0
                          ? `Refresh preview for ${item.filename}`
                          : `Review preview for ${item.filename}`}
                      </button>
                    )}
                    {item.status !== "imported" && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void rejectFile(item.id)}
                      >
                        Reject {item.filename}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="stripe-import-preview__actions">
          {importItems.length > 0 && (
            <button
              type="button"
              onClick={() => void confirmBatch()}
              disabled={busy || !canConfirmBatch}
            >
              Confirm import
            </button>
          )}
          {acceptedItems.length > 0 && importItems.length === 0 && (
            <p role="status">
              Batch complete. Imported files will not be retried.
            </p>
          )}
        </div>
      </section>
      {preview && reviewingItem && (
        <section
          className="stripe-import-preview"
          aria-labelledby="stripe-preview-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">File preview</p>
              <h2 id="stripe-preview-heading">
                Review {reviewingItem.filename}
              </h2>
              <p>
                {reviewingItem.filename} contains {preview.totalCount} rows:{" "}
                {preview.willImportCount} new, {preview.alreadyImportedCount}{" "}
                already imported, and {preview.conflictCount} conflicts.
              </p>
            </div>
          </div>
          {reviewingItem.previewStale && (
            <p className="stripe-import-preview__blocking" role="alert">
              Another file was imported after this preview. Refresh this file
              before confirming so duplicate and conflicting references are
              current.
            </p>
          )}
          {preview.conflictCount > 0 && (
            <p className="stripe-import-preview__blocking" role="alert">
              Resolve all {preview.conflictCount} conflicts before importing.
              Confirm is blocked because an existing Stripe reference has
              different data.
            </p>
          )}
          <div className="stripe-import-preview__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Available</th>
                  <th>Kind</th>
                  <th>Gross</th>
                  <th>Fee</th>
                  <th>Net</th>
                  <th>Currency</th>
                  <th>Mapping</th>
                  <th>Import status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.reference}>
                    <td>{row.reference}</td>
                    <td>
                      <time dateTime={row.occurredAt}>{row.occurredAt}</time>
                    </td>
                    <td>
                      {row.availableAt ? (
                        <time dateTime={row.availableAt}>
                          {row.availableAt}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{row.kind.replaceAll("_", " ")}</td>
                    <td>{row.sourceGross}</td>
                    <td>{row.sourceFee}</td>
                    <td>{row.sourceNet}</td>
                    <td>{row.sourceCurrency}</td>
                    <td>
                      {row.mappingWarning ??
                        `Mapped from ${row.reportingCategory}`}
                    </td>
                    <td>{row.importStatus.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav
            className="stripe-import-preview__pagination"
            aria-label="Stripe preview pages"
          >
            <p>
              Page {preview.page} of {preview.totalPages}; showing rows{" "}
              {preview.totalCount === 0
                ? 0
                : (preview.page - 1) * preview.pageSize + 1}
              –{(preview.page - 1) * preview.pageSize + preview.displayedCount}{" "}
              of {preview.totalCount}. Conflicts are shown first.
            </p>
            <div className="stripe-import-preview__actions">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void loadConfirmedPreview(reviewingItem.id, preview.page - 1)
                }
                disabled={
                  busy || reviewingItem.previewStale || preview.page <= 1
                }
              >
                Previous page
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void loadConfirmedPreview(reviewingItem.id, preview.page + 1)
                }
                disabled={
                  busy ||
                  reviewingItem.previewStale ||
                  preview.page >= preview.totalPages
                }
              >
                Next page
              </button>
            </div>
          </nav>
          <div className="stripe-import-preview__actions">
            {reviewingItem.previewStale && (
              <button
                type="button"
                onClick={() => void loadConfirmedPreview(reviewingItem.id, 1)}
                disabled={busy}
              >
                Refresh preview before confirmation
              </button>
            )}
            {reviewingItem.decision === null ? (
              <button
                type="button"
                onClick={() => addToBatch(reviewingItem.id)}
                disabled={
                  busy ||
                  reviewingItem.previewStale ||
                  preview.conflictCount > 0
                }
              >
                Add to batch
              </button>
            ) : (
              <p role="status">
                This file is in the accepted batch. Confirm the batch when all
                files are ready.
              </p>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => void rejectFile(reviewingItem.id)}
              disabled={busy}
            >
              Reject file
            </button>
            <button
              type="button"
              className="secondary"
              onClick={closePreview}
              disabled={busy}
            >
              Close preview
            </button>
          </div>
        </section>
      )}
    </Page>
  );
};

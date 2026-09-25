import {
  createFileRoute,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  createAndMatchBankTransaction,
  getBankReconciliation,
  reconcileBankTransaction,
} from "../server/bank-operations";
import {
  confirmArtifactUpload,
  startArtifactUpload,
} from "../server/operations";
import {
  ManualTransactionForm,
  type ManualTransactionSubmission,
} from "../components/manual-transaction-form";
import type { ManualTransactionServerIssue } from "../domain/manual-transaction";
import type {
  BankClassification,
  BankReconciliationCommand,
} from "../domain/bank-transactions";
import {
  expenseCategorySuggestions,
  isOwnerFundingKind,
  transactionKindLabels,
  type TransactionInput,
} from "../domain/types";
import { defaultTaxTreatmentForTransaction } from "../domain/tax";
import { manualCashEffectAudMinor } from "../domain/cash-effect";
import { formatAudDecimal, parseDecimal } from "../domain/money";
import bankingCss from "../styles/banking.css?url";

interface ReconcileSearch {
  bank?: string;
  artifact?: string;
  window?: "14" | "31" | "all";
  page?: number;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseReconcileSearch = (
  search: Record<string, unknown>,
): ReconcileSearch => {
  const page = Number(search.page ?? 1);
  return {
    bank:
      typeof search.bank === "string" && uuidPattern.test(search.bank)
        ? search.bank
        : undefined,
    artifact:
      typeof search.artifact === "string" && uuidPattern.test(search.artifact)
        ? search.artifact
        : undefined,
    window: ["14", "31", "all"].includes(String(search.window))
      ? (String(search.window) as ReconcileSearch["window"])
      : "14",
    page: Number.isInteger(page) && page > 1 && page <= 101 ? page : 1,
  };
};

export const canAdvanceBankReconciliationPage = (
  page: number,
  total: number,
): boolean => page < 101 && page * 100 < total;

export const bankMatchTransactionKinds = (
  amountAud: string,
): TransactionInput["kind"][] => {
  const movement = parseDecimal(amountAud);
  if (movement === 0n) return [];

  const settlementAmount = amountAud.startsWith("-")
    ? amountAud.slice(1)
    : amountAud;
  return (
    Object.keys(transactionKindLabels) as TransactionInput["kind"][]
  ).filter(
    (kind) =>
      manualCashEffectAudMinor({
        sourceSystem: "manual",
        status: "recorded",
        kind,
        settledAt: "2000-01-01T00:00:00.000Z",
        settlementCurrency: "AUD",
        settlementAmount,
      }) === movement,
  );
};

export const Route = createFileRoute("/banking/reconcile")({
  head: () => ({ links: [{ rel: "stylesheet", href: bankingCss }] }),
  validateSearch: parseReconcileSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    getBankReconciliation({
      data: {
        bankTransactionId: deps.bank,
        artifactId: deps.artifact,
        windowDays:
          deps.window === "all" ? null : deps.window === "31" ? 31 : 14,
        offset: ((deps.page ?? 1) - 1) * 100,
      },
    }),
  pendingComponent: BankReconcilePending,
  errorComponent: BankReconcileError,
  component: BankReconcilePage,
});

function BankReconcilePending() {
  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <h1>Reconcile</h1>
      <p className="banking-route-pending" role="status" aria-live="polite">
        Loading bank reconciliation…
      </p>
    </main>
  );
}

function BankReconcileError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <section className="banking-panel banking-route-error">
        <h1>Reconciliation unavailable</h1>
        <p role="alert">
          Folio could not load reconciliation data. Check your access or
          connection, then retry.
        </p>
        <button type="button" onClick={retry}>
          Retry reconciliation
        </button>
      </section>
    </main>
  );
}

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The reconciliation action failed. Reload and retry.";

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

interface BankSourceReview {
  postedDate: string;
  movementAud: string;
  description: string;
  filename: string;
  sourceRow: number | null;
  hints: { label: string; value: string }[];
}

export const bankSourceReview = (
  bank: {
    postedDate: string;
    amountAud: string;
    description: string;
    metadata: Record<string, string | number | boolean | null>;
  },
  source: { filename: string; sourceRow: number | null },
): BankSourceReview => {
  const metadata = bank.metadata;
  const hints = [
    { label: "Value date (payment timing hint)", value: metadata.valueDate },
    {
      label: "Parsed foreign-currency suggestion",
      value: metadata.foreignCurrency,
    },
    {
      label: "Parsed foreign-amount suggestion",
      value: metadata.foreignAmount,
    },
  ].flatMap(({ label, value }) =>
    value === undefined || value === null
      ? []
      : [{ label, value: String(value) }],
  );

  return {
    postedDate:
      typeof metadata.postedDate === "string"
        ? metadata.postedDate
        : bank.postedDate,
    movementAud:
      typeof metadata.amountAud === "string"
        ? metadata.amountAud
        : bank.amountAud,
    description:
      typeof metadata.description === "string"
        ? metadata.description
        : bank.description,
    filename: source.filename,
    sourceRow:
      typeof metadata.sourceRow === "number"
        ? metadata.sourceRow
        : source.sourceRow,
    hints,
  };
};

export const createBankTransactionPrefill = (
  data: {
    actorId: string;
    gstRegistered: boolean;
    detail: {
      bankTransaction: {
        id: string;
        postedDate: string;
        amountAud: string;
        description: string;
        metadata: Record<string, string | number | boolean | null>;
      };
    } | null;
  },
  kind: TransactionInput["kind"],
): TransactionInput | null => {
  const bank = data.detail?.bankTransaction;
  if (!bank) return null;
  const magnitude = bank.amountAud.startsWith("-")
    ? bank.amountAud.slice(1)
    : bank.amountAud;
  const ownerFunding = isOwnerFundingKind(kind);
  const fundingAmount =
    ownerFunding && parseDecimal(bank.amountAud) > 0n ? magnitude : null;
  return {
    ownerId: data.actorId,
    sourceArtifactId: null,
    kind,
    reference: null,
    counterparty: null,
    description: bank.description,
    status: "recorded",
    category: null,
    notes: `Payment source: imported bank row ${bank.id}. Review every accounting field before saving.`,
    occurredAt: null,
    availableAt: null,
    invoiceDate: null,
    settledAt: `${bank.postedDate}T00:00:00.000Z`,
    documentCurrency: fundingAmount ? "AUD" : null,
    documentAmount: fundingAmount,
    documentTaxAmount: null,
    taxTreatment: defaultTaxTreatmentForTransaction("AUD", kind),
    settlementCurrency: "AUD",
    settlementAmount: magnitude,
    gstCreditStatus: ownerFunding
      ? data.gstRegistered
        ? "not_claimable"
        : "not_registered"
      : data.gstRegistered
        ? "unknown"
        : "not_registered",
    claimableGstAud: "0.0000",
  };
};

interface ReconciliationUndo {
  bankTransactionId: string;
  expectedRevision: string;
  command: Extract<BankReconciliationCommand, { type: "classify" | "reset" }>;
  label: string;
}

interface CreatedBankMatch {
  bankTransactionId: string;
  transactionId: string;
  sourceRevision: string;
}

interface InvoiceUploadIntent {
  artifactId: string;
  uploadUrl: string;
  stage: "started" | "uploaded" | "confirmed";
}

function BankReconcilePage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/banking/reconcile" });
  const router = useRouter();
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<TransactionInput["kind"] | "">(
    "",
  );
  const [undoAction, setUndoAction] = useState<ReconciliationUndo | null>(null);
  const [showMatchedResetConfirm, setShowMatchedResetConfirm] = useState(false);
  const [serverIssues, setServerIssues] = useState<
    readonly ManualTransactionServerIssue[]
  >([]);
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [createdBankMatch, setCreatedBankMatch] =
    useState<CreatedBankMatch | null>(null);
  const [transactionId, setTransactionId] = useState(() => crypto.randomUUID());
  const uploadIntents = useRef(new Map<string, InvoiceUploadIntent>());
  const inFlight = useRef(false);
  const matchedResetTriggerRef = useRef<HTMLButtonElement>(null);
  const matchedResetCancelRef = useRef<HTMLButtonElement>(null);
  const matchedResetConfirmRef = useRef<HTMLButtonElement>(null);
  const wasMatchedResetConfirmOpen = useRef(false);
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const selectedQueueRowRef = useRef<HTMLLIElement>(null);
  const selected = data.detail?.bankTransaction;
  const matchedTransactionId =
    selected?.matchedTransactionId ??
    (selected &&
    createdBankMatch?.bankTransactionId === selected.id &&
    createdBankMatch.sourceRevision === selected?.revision &&
    selected.reviewState === "unresolved"
      ? createdBankMatch.transactionId
      : null);
  const sourceReview = selected
    ? bankSourceReview(selected, data.detail!.source)
    : null;
  const prefill = useMemo(
    () => (createKind ? createBankTransactionPrefill(data, createKind) : null),
    [createKind, data],
  );
  const availableCreateKinds = selected
    ? bankMatchTransactionKinds(selected.amountAud)
    : [];
  const activeUndo =
    undoAction &&
    selected &&
    undoAction.bankTransactionId === selected.id &&
    undoAction.expectedRevision === selected.revision
      ? undoAction
      : null;

  useEffect(() => {
    setCandidateId(null);
    setShowCreate(false);
    setCreateKind("");
    setShowMatchedResetConfirm(false);
    setServerIssues([]);
    setSubmissionStatus("");
    setSubmissionError("");
    setCreatedBankMatch(null);
    setTransactionId(crypto.randomUUID());
  }, [selected?.id]);

  useEffect(() => {
    setCandidateId(null);
  }, [search.window]);

  useEffect(() => {
    const queue = queueScrollRef.current;
    const row = selectedQueueRowRef.current;
    if (!queue || !row) return;

    const queueBounds = queue.getBoundingClientRect();
    const visibleTop = queueBounds.top + queue.clientTop;
    const visibleBottom =
      visibleTop + (queue.clientHeight || queueBounds.height);
    const rowBounds = row.getBoundingClientRect();

    if (rowBounds.top < visibleTop) {
      queue.scrollTop -= visibleTop - rowBounds.top;
      return;
    }

    if (rowBounds.bottom > visibleBottom)
      queue.scrollTop += rowBounds.bottom - visibleBottom;
  }, [data.rows, selected?.id]);

  useEffect(() => {
    if (showMatchedResetConfirm) {
      wasMatchedResetConfirmOpen.current = true;
      matchedResetCancelRef.current?.focus();
      return;
    }
    if (!wasMatchedResetConfirmOpen.current) return;
    wasMatchedResetConfirmOpen.current = false;
    matchedResetTriggerRef.current?.focus();
  }, [showMatchedResetConfirm]);

  useEffect(() => {
    if (!search.bank && selected)
      void navigate({
        replace: true,
        search: { ...search, bank: selected.id },
      });
  }, [navigate, search, selected]);

  const reload = async () => {
    setCandidateId(null);
    setShowCreate(false);
    setCreateKind("");
    setServerIssues([]);
    await router.invalidate();
  };

  const mutate = async (
    command: BankReconciliationCommand,
    expectedRevision = selected?.revision,
  ) => {
    if (!selected || !expectedRevision) return null;
    setBusy(true);
    setMessage("");
    setCreatedBankMatch(null);
    try {
      const result = await reconcileBankTransaction({
        data: {
          bankTransactionId: selected.id,
          expectedRevision,
          command,
        },
      });
      setMessage(
        result.status === "already_applied"
          ? "This reconciliation state was already applied."
          : "Reconciliation saved.",
      );
      if (command.type === "match")
        setCreatedBankMatch({
          bankTransactionId: selected.id,
          transactionId: command.transactionId,
          sourceRevision: selected.revision,
        });
      await reload();
      return result;
    } catch (error) {
      const failureMessage = errorMessage(error);
      setMessage(failureMessage);
      try {
        await router.invalidate();
      } catch {
        setMessage(
          `${failureMessage} The current row could not be refreshed; reload before retrying.`,
        );
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const classifySelected = async (classification: BankClassification) => {
    if (!selected) return;
    setUndoAction(null);
    const bankTransactionId = selected.id;
    const result = await mutate({ type: "classify", classification });
    if (!result || result.status !== "applied") return;
    setUndoAction({
      bankTransactionId,
      expectedRevision: result.revision,
      command: { type: "reset" },
      label: `Undo ${classification} classification`,
    });
    setMessage(`Marked as ${classification}.`);
  };

  const resetClassified = async (classification: BankClassification) => {
    if (!selected) return;
    setUndoAction(null);
    const bankTransactionId = selected.id;
    const result = await mutate({ type: "reset" });
    if (!result || result.status !== "applied") return;
    setUndoAction({
      bankTransactionId,
      expectedRevision: result.revision,
      command: { type: "classify", classification },
      label: `Undo reset (restore ${classification})`,
    });
    setMessage("Returned to Unresolved.");
  };

  const resetSelected = () => {
    if (!selected || selected.reviewState === "unresolved") return;
    if (selected.reviewState === "matched") {
      setShowMatchedResetConfirm(true);
      return;
    }
    void resetClassified(selected.reviewState);
  };

  const resetMatched = async () => {
    if (!selected || selected.reviewState !== "matched") return;
    setShowMatchedResetConfirm(false);
    setUndoAction(null);
    const result = await mutate({ type: "reset" });
    if (result?.status === "applied")
      setMessage(
        "The bank-row match was removed. The Folio transaction remains recorded.",
      );
  };

  const undo = async () => {
    if (!selected || !activeUndo) return;
    const action = activeUndo;
    setUndoAction(null);
    const result = await mutate(action.command, action.expectedRevision);
    if (!result) return;
    setMessage(
      result.status === "already_applied"
        ? "This reconciliation change was already undone."
        : "The previous bank-row state was restored.",
    );
  };

  const handleMatchedResetDialogKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setShowMatchedResetConfirm(false);
      return;
    }
    if (event.key !== "Tab") return;
    const first = matchedResetCancelRef.current;
    const last = matchedResetConfirmRef.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const createAndMatch = async (submission: ManualTransactionSubmission) => {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setSubmissionError("");
    setSubmissionStatus("");
    setUndoAction(null);
    setServerIssues([]);
    let invoiceArtifactId: string | null = null;
    let invoiceChecksumSha256: string | null = null;
    try {
      const artifactIds = [...submission.artifactIds];
      if (submission.file) {
        const file = submission.file;
        setSubmissionStatus("Validating the selected invoice PDF…");
        const checksumSha256 = await sha256Base64(file);
        invoiceChecksumSha256 = checksumSha256;
        let intent = uploadIntents.current.get(checksumSha256);

        if (intent?.stage === "uploaded") {
          const recoveredArtifact = data.availableArtifacts.find(
            (artifact) => artifact.checksumSha256 === checksumSha256,
          );
          if (recoveredArtifact) {
            intent = {
              ...intent,
              artifactId: recoveredArtifact.id,
              stage: "confirmed",
            };
            uploadIntents.current.set(checksumSha256, intent);
          }
        }

        if (!intent) {
          setSubmissionStatus("Starting authenticated invoice PDF upload…");
          const started = await startArtifactUpload({
            data: {
              ownerId: submission.transaction.ownerId,
              artifactProfile: "manual_invoice_pdf_v1",
              filename: file.name,
              mediaType: "application/pdf",
              byteSize: file.size,
              checksumSha256,
            },
          });
          intent = {
            artifactId: started.artifact.id,
            uploadUrl: started.uploadUrl,
            stage: "started",
          };
          uploadIntents.current.set(checksumSha256, intent);
        }

        if (intent.stage === "started") {
          setSubmissionStatus("Uploading invoice PDF…");
          const response = await fetch(intent.uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "content-type": "application/pdf",
              "x-amz-checksum-sha256": checksumSha256,
              "x-amz-meta-folio-artifact-id": intent.artifactId,
            },
          });
          if (!response.ok)
            throw new Error(`Invoice PDF upload failed (${response.status}).`);
          intent = { ...intent, stage: "uploaded" };
          uploadIntents.current.set(checksumSha256, intent);
        }

        if (intent.stage === "uploaded") {
          setSubmissionStatus("Confirming invoice PDF…");
          const confirmed = await confirmArtifactUpload({
            data: { id: intent.artifactId },
          });
          intent = {
            ...intent,
            artifactId: confirmed.id,
            stage: "confirmed",
          };
          uploadIntents.current.set(checksumSha256, intent);
        }

        invoiceArtifactId = intent.artifactId;
        if (!artifactIds.includes(invoiceArtifactId))
          artifactIds.push(invoiceArtifactId);
        setSubmissionStatus(
          "Invoice PDF confirmed. Saving the transaction and bank-row match…",
        );
      } else {
        setSubmissionStatus("Saving the transaction and bank-row match…");
      }

      const result = await createAndMatchBankTransaction({
        data: {
          bankTransactionId: selected.id,
          expectedRevision: selected.revision,
          transactionId,
          transaction: {
            ...submission.transaction,
            sourceArtifactId:
              submission.transaction.sourceArtifactId ?? invoiceArtifactId,
          },
          artifactIds,
        },
      });
      if (result.status === "invalid") {
        setServerIssues(result.issues);
        setSubmissionError(
          "The server rejected this transaction. Review the highlighted fields and retry.",
        );
        setSubmissionStatus(
          invoiceArtifactId
            ? "The confirmed invoice PDF is preserved and will be reused on retry."
            : "The transaction submission ID is preserved for a safe retry.",
        );
        return;
      }
      setMessage(
        result.status === "already_applied"
          ? "The transaction and match were already saved."
          : "Transaction created and matched.",
      );
      setCreatedBankMatch({
        bankTransactionId: selected.id,
        transactionId,
        sourceRevision: selected.revision,
      });
      await reload();
      uploadIntents.current.clear();
      setTransactionId(crypto.randomUUID());
    } catch (error) {
      const failureMessage = errorMessage(error);
      const retainedIntent = invoiceChecksumSha256
        ? uploadIntents.current.get(invoiceChecksumSha256)
        : undefined;
      setSubmissionError(failureMessage);
      setSubmissionStatus(
        invoiceArtifactId
          ? "The confirmed invoice PDF is preserved and will be reused on retry."
          : retainedIntent
            ? "The invoice PDF upload intent is preserved; retry will reuse the same artifact and continue confirmation."
            : "The transaction submission ID is preserved for a safe retry.",
      );
      setMessage(failureMessage);
      try {
        await router.invalidate();
      } catch {
        setSubmissionStatus(
          invoiceArtifactId
            ? "The confirmed invoice PDF is preserved. Reload before retrying to verify the bank-row state."
            : "Reload before retrying to verify the bank-row state; the transaction submission ID is preserved.",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="banking-page">
      <header className="banking-header">
        <p className="eyebrow">Banking</p>
        <h1>Banking</h1>
        <p className="banking-lead">
          Review imported movements against recorded Folio transactions.
        </p>
      </header>

      <nav className="banking-tabs" aria-label="Banking sections">
        <a href="/banking/activity">Activity</a>
        <a href="/banking/reconcile" aria-current="page">
          Reconcile
        </a>
        <a href="/banking/imports">Imports</a>
      </nav>

      <div
        className="banking-metrics"
        role="group"
        aria-label="Review progress"
      >
        <div className="banking-metric">
          <span>Total rows</span>
          <strong>{data.counts.total}</strong>
        </div>
        <div className="banking-metric">
          <span>Reviewed</span>
          <strong>{data.counts.reviewed}</strong>
        </div>
        <div className="banking-metric banking-metric-unresolved">
          <span>Unresolved</span>
          <strong>{data.counts.unresolved}</strong>
        </div>
      </div>
      <p className="banking-breakdown">
        {data.counts.matched} matched <span aria-hidden="true">·</span>{" "}
        {data.counts.private} private <span aria-hidden="true">·</span>{" "}
        {data.counts.transfer} transfer <span aria-hidden="true">·</span>{" "}
        {data.counts.duplicate} duplicate
      </p>

      <div className="banking-reconcile-layout">
        <section
          className="banking-panel banking-queue-panel"
          aria-labelledby="reconcile-queue"
        >
          <div className="banking-panel-heading">
            <div>
              <p className="banking-kicker">Review queue</p>
              <h2 id="reconcile-queue">Bank rows</h2>
              <p className="banking-muted">
                Select a source row to inspect its details and available
                actions.
              </p>
            </div>
          </div>

          {data.rows.length === 0 ? (
            <div className="banking-empty-state">
              <h3>No imported bank rows</h3>
              <p>Import a CommBank CSV to begin reviewing bank activity.</p>
              <a className="banking-button-link" href="/imports/commbank">
                Import CSV
              </a>
            </div>
          ) : (
            <div className="banking-queue-scroll" ref={queueScrollRef}>
              <ul className="banking-queue">
                {data.rows.map((row) => (
                  <li
                    key={row.id}
                    ref={selected?.id === row.id ? selectedQueueRowRef : null}
                  >
                    <a
                      className="banking-queue-link"
                      aria-current={
                        selected?.id === row.id ? "page" : undefined
                      }
                      href={`/banking/reconcile?bank=${encodeURIComponent(row.id)}${search.artifact ? `&artifact=${encodeURIComponent(search.artifact)}` : ""}&window=${search.window ?? "14"}&page=${search.page ?? 1}`}
                    >
                      <span className="banking-queue-meta">
                        <time dateTime={row.postedDate}>{row.postedDate}</time>
                        <span
                          className={`banking-state banking-state-${row.reviewState}`}
                        >
                          {row.reviewState}
                        </span>
                      </span>
                      <span className="banking-queue-main">
                        <span className="banking-queue-description">
                          {row.description}
                        </span>
                        <strong
                          className={
                            row.amountAud.startsWith("-")
                              ? "amount-negative"
                              : "amount-positive"
                          }
                        >
                          {formatAudDecimal(row.amountAud)}
                        </strong>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="banking-pagination" aria-label="Bank row pages">
            <button
              type="button"
              className="secondary"
              disabled={(search.page ?? 1) <= 1}
              onClick={() =>
                void navigate({
                  search: {
                    ...search,
                    bank: undefined,
                    page: Math.max(1, (search.page ?? 1) - 1),
                  },
                })
              }
            >
              Previous
            </button>
            <span>Page {search.page ?? 1}</span>
            <button
              type="button"
              className="secondary"
              disabled={
                !canAdvanceBankReconciliationPage(
                  search.page ?? 1,
                  data.counts.total,
                )
              }
              onClick={() =>
                void navigate({
                  search: {
                    ...search,
                    bank: undefined,
                    page: (search.page ?? 1) + 1,
                  },
                })
              }
            >
              Next
            </button>
          </div>
        </section>

        {data.detail && selected && (
          <section
            className="banking-panel banking-selected-panel"
            aria-labelledby="selected-bank-row"
          >
            <div className="banking-panel-heading">
              <div>
                <p className="banking-kicker">Selected source row</p>
                <h2 id="selected-bank-row">Bank row details</h2>
              </div>
              <span
                className={`banking-state banking-state-${selected.reviewState}`}
              >
                {selected.reviewState}
              </span>
              {matchedTransactionId && (
                <a
                  className="banking-button-link"
                  href={`/transactions/${encodeURIComponent(matchedTransactionId)}`}
                >
                  View matched transaction
                </a>
              )}
            </div>

            <dl className="banking-detail-grid">
              <div>
                <dt>Posted (as imported)</dt>
                <dd>{sourceReview?.postedDate}</dd>
              </div>
              <div>
                <dt>Movement (AUD, as imported)</dt>
                <dd>{sourceReview?.movementAud}</dd>
              </div>
              <div className="banking-detail-wide">
                <dt>Raw description</dt>
                <dd>{sourceReview?.description}</dd>
              </div>
              <div>
                <dt>Source profile</dt>
                <dd>{data.detail.source.profile}</dd>
              </div>
              <div>
                <dt>Import period</dt>
                <dd>
                  {data.detail.source.earliestDate ?? "—"} to{" "}
                  {data.detail.source.latestDate ?? "—"}
                </dd>
              </div>
              <div className="banking-detail-wide">
                <dt>Source filename</dt>
                <dd>
                  <a href="/banking/imports">{sourceReview?.filename}</a>
                </dd>
              </div>
              <div>
                <dt>Source row</dt>
                <dd>{sourceReview?.sourceRow ?? "Not supplied"}</dd>
              </div>
              <div className="banking-detail-wide">
                <dt>Unverified payment hints</dt>
                <dd>
                  {sourceReview?.hints.length ? (
                    <ul>
                      {sourceReview.hints.map((hint) => (
                        <li key={hint.label}>
                          {hint.label}: {hint.value}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "No payment hints"
                  )}
                </dd>
              </div>
              <div className="banking-detail-wide">
                <dt>Stable bank row ID</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>Last reviewed</dt>
                <dd>
                  <time dateTime={selected.updatedAt}>
                    {selected.updatedAt}
                  </time>
                </dd>
              </div>
              <div className="banking-detail-wide">
                <dt>Reviewed by actor</dt>
                <dd>{selected.updatedById}</dd>
              </div>
              {selected.matchedTransactionId && (
                <div className="banking-detail-wide">
                  <dt>Matched Folio transaction</dt>
                  <dd>
                    <a
                      href={`/transactions/${encodeURIComponent(selected.matchedTransactionId)}`}
                    >
                      {selected.matchedTransactionId}
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            <fieldset
              className="banking-candidate-fieldset"
              disabled={busy || selected.reviewState !== "unresolved"}
            >
              <legend>Exact signed-AUD candidates</legend>
              <label className="banking-window-field">
                Date window
                <select
                  value={search.window ?? "14"}
                  onChange={(event) =>
                    void navigate({
                      search: {
                        ...search,
                        window: event.target.value as "14" | "31" | "all",
                      },
                    })
                  }
                >
                  <option value="14">±14 days</option>
                  <option value="31">±31 days</option>
                  <option value="all">Search all dates</option>
                </select>
              </label>
              {data.detail.candidates.length === 0 ? (
                <p className="banking-muted">
                  No eligible candidates in this date window.
                </p>
              ) : (
                <div className="banking-candidate-list">
                  {data.detail.candidates.map((candidate) => (
                    <label
                      className="banking-candidate-option"
                      key={candidate.id}
                    >
                      <input
                        type="radio"
                        name="candidate"
                        checked={candidateId === candidate.id}
                        onChange={() => setCandidateId(candidate.id)}
                      />
                      <span className="banking-candidate-content">
                        <span className="banking-candidate-title">
                          <strong>
                            {candidate.counterparty ?? "No counterparty"}
                          </strong>
                          <span>{formatAudDecimal(candidate.amountAud)}</span>
                        </span>
                        <span>
                          {candidate.settledAt.slice(0, 10)} · {candidate.kind}
                        </span>
                        <span>
                          {candidate.reference ?? "No reference"} ·{" "}
                          {candidate.description ?? "No description"}
                        </span>
                        <span className="banking-muted">
                          {candidate.dateDistanceDays} day difference · text
                          evidence {candidate.textScore}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={!candidateId || busy}
                onClick={() => {
                  if (!candidateId) return;
                  setUndoAction(null);
                  void mutate({ type: "match", transactionId: candidateId });
                }}
              >
                Match selected transaction
              </button>
            </fieldset>

            <div className="actions banking-action-row">
              <button
                type="button"
                className="secondary"
                disabled={busy || selected.reviewState !== "unresolved"}
                onClick={() => {
                  setCreateKind("");
                  setShowCreate((shown) => !shown);
                }}
              >
                {showCreate
                  ? "Cancel create transaction"
                  : "Create transaction"}
              </button>
              {(["private", "transfer", "duplicate"] as const).map(
                (classification) => (
                  <button
                    key={classification}
                    type="button"
                    className="secondary"
                    disabled={busy || selected.reviewState !== "unresolved"}
                    onClick={() => void classifySelected(classification)}
                  >
                    Mark {classification}
                  </button>
                ),
              )}
              <button
                type="button"
                className="secondary"
                disabled={busy || selected.reviewState === "unresolved"}
                ref={matchedResetTriggerRef}
                onClick={resetSelected}
              >
                Unmatch or reset to unresolved
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  const index = data.rows.findIndex(
                    (row) => row.id === selected.id,
                  );
                  const next = data.rows[index + 1] ?? data.rows[0];
                  if (next)
                    void navigate({
                      search: { ...search, bank: next.id },
                    });
                }}
              >
                Leave unresolved and continue
              </button>
            </div>

            <p
              className="banking-action-status"
              role="status"
              aria-live="polite"
            >
              {message}
            </p>

            {activeUndo && (
              <div className="banking-undo-control">
                <span>{activeUndo.label}.</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void undo()}
                >
                  {activeUndo.label}
                </button>
              </div>
            )}

            {showMatchedResetConfirm && selected.reviewState === "matched" && (
              <div className="banking-dialog-backdrop">
                <section
                  className="banking-confirm-dialog"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="matched-reset-title"
                  aria-describedby="matched-reset-description"
                  onKeyDown={handleMatchedResetDialogKeyDown}
                >
                  <h3 id="matched-reset-title">Unmatch this bank row?</h3>
                  <p id="matched-reset-description">
                    The Folio transaction will remain recorded; only this
                    bank-row match will be removed.
                  </p>
                  <div className="banking-confirm-actions">
                    <button
                      ref={matchedResetCancelRef}
                      type="button"
                      className="secondary"
                      onClick={() => setShowMatchedResetConfirm(false)}
                    >
                      Keep match
                    </button>
                    <button
                      ref={matchedResetConfirmRef}
                      type="button"
                      onClick={() => void resetMatched()}
                    >
                      Unmatch bank row
                    </button>
                  </div>
                </section>
              </div>
            )}

            {showCreate && (
              <section
                className="banking-create-panel"
                aria-labelledby="create-from-bank"
              >
                <h3 id="create-from-bank">
                  Review transaction before save and match
                </h3>
                {!prefill ? (
                  <div className="banking-kind-choice">
                    <p className="banking-csv-provenance">
                      Bank details prefill the posted date, AUD settlement
                      amount, and raw description after you select a transaction
                      kind. They do not identify a supplier or establish an
                      invoice date.
                    </p>
                    {availableCreateKinds.length > 0 && (
                      <div
                        className="actions banking-action-row"
                        role="group"
                        aria-label="Create transaction by kind"
                      >
                        {availableCreateKinds.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => setCreateKind(kind)}
                          >
                            Create {transactionKindLabels[kind].toLowerCase()}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="banking-muted">
                      Only transaction kinds with a cash effect matching this
                      movement are available. For a private item, transfer
                      between accounts, or duplicate, use the corresponding
                      review action.
                    </p>
                    {availableCreateKinds.length === 0 && (
                      <p className="banking-muted" role="status">
                        This movement has no supported transaction kind to
                        match. Use a review action if appropriate, or leave it
                        unresolved.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="banking-csv-provenance" role="note">
                      <strong>Bank CSV provenance</strong>
                      <span>
                        The CommBank CSV records payment movement only. It is
                        not invoice evidence and does not establish an invoice
                        total, GST, or deductibility.
                      </span>
                    </p>
                    <ManualTransactionForm
                      key={`${selected.id}:${createKind}`}
                      transaction={prefill}
                      autoDefaultTaxTreatment
                      users={data.users}
                      counterparties={data.entrySuggestions.counterparties}
                      supplierCategories={
                        data.entrySuggestions.supplierCategories
                      }
                      categories={[
                        ...new Set([
                          ...expenseCategorySuggestions,
                          ...data.entrySuggestions.categories,
                        ]),
                      ]}
                      gstRegistered={data.gstRegistered}
                      attachedArtifactId={null}
                      availableArtifacts={data.availableArtifacts.map(
                        (artifact) => ({
                          id: artifact.id,
                          filename: artifact.filename,
                        }),
                      )}
                      bankSettlementPrefilled
                      bankPaymentHints={{
                        foreignCurrency:
                          typeof selected.metadata.foreignCurrency === "string"
                            ? selected.metadata.foreignCurrency
                            : null,
                        foreignAmount:
                          typeof selected.metadata.foreignAmount === "string"
                            ? selected.metadata.foreignAmount
                            : null,
                      }}
                      allowedKinds={availableCreateKinds}
                      bankMovementIsPositive={
                        parseDecimal(selected.amountAud) > 0n
                      }
                      evidenceStatus={
                        <p className="banking-csv-evidence-status">
                          Supplier invoice PDFs are uploaded and confirmed
                          separately. No bank CSV file is attached as invoice
                          evidence.
                        </p>
                      }
                      busy={busy}
                      serverIssues={serverIssues}
                      submissionStatus={submissionStatus || undefined}
                      submissionError={submissionError || undefined}
                      onEvidenceChange={(file) => {
                        setSubmissionError("");
                        setSubmissionStatus(
                          file
                            ? `Selected ${file.name}. It will be uploaded and confirmed as invoice evidence before the bank match is saved.`
                            : "",
                        );
                      }}
                      onSubmit={createAndMatch}
                      onCancel={() => {
                        setCreateKind("");
                        setShowCreate(false);
                      }}
                    />
                  </>
                )}
              </section>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

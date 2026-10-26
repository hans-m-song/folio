import { AutocompleteSelect } from "../components/autocomplete";
import { randomUuid } from "../browser/crypto";
import {
  createFileRoute,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  createAndMatchBankTransaction,
  getBankReconciliation,
  getNextBankReconciliation,
  reconcileBankTransaction,
} from "../server/bank-operations";
import { MoneyText } from "../components/money-text";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import {
  BankInvoiceEvidence,
  type BankInvoiceArtifactDetails,
} from "../components/bank-invoice-evidence";
import {
  ManualTransactionForm,
  type ManualArtifactOption,
  type ManualTransactionSubmission,
} from "../components/manual-transaction-form";
import type { InvoiceReviewObservation } from "../components/invoice-suggestion-review";
import { BankProposalSuggestions } from "../components/bank-proposal-suggestions";
import {
  loadManualTransactionRouteData,
  ManualTransactionRoute,
} from "./-transaction-workflow";
import type { ManualTransactionServerIssue } from "../domain/manual-transaction";
import type {
  BankClassification,
  BankMatchBasis,
  BankReconciliationCommand,
} from "../domain/bank-transactions";
import { assessBankMatchCandidate } from "../domain/bank-transactions";
import {
  expenseCategorySuggestions,
  isOwnerFundingKind,
  isOwnerLoanRepaymentKind,
  transactionKindLabels,
  type TransactionInput,
} from "../domain/types";
import { defaultTaxTreatmentForTransaction } from "../domain/tax";
import { manualCashEffectAudMinor } from "../domain/cash-effect";
import { formatAudDecimal, parseDecimal } from "../domain/money";
import bankingCss from "../styles/banking.css?url";
import "../styles/transactions.css";

interface ReconcileSearch {
  bank?: string;
  artifact?: string;
  unresolved?: boolean;
  window?: "14" | "31" | "all";
  page?: number;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultReconciliationWindow = "31" as const;
const reconciliationDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const reconciliationTimestampFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Australia/Brisbane",
  timeZoneName: "short",
});

const bankReconciliationDateParts = (value: string) => {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const sourceDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const year = Number(isoDate?.[1] ?? sourceDate?.[3]);
  const month = Number(isoDate?.[2] ?? sourceDate?.[2]);
  const day = Number(isoDate?.[3] ?? sourceDate?.[1]);
  if (!isoDate && !sourceDate) return null;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    date,
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
};

export const bankReconciliationDateIso = (value: string): string | null =>
  bankReconciliationDateParts(value)?.isoDate ?? null;

export const bankReconciliationDateDisplay = (value: string): string => {
  const date = bankReconciliationDateParts(value);
  return date ? reconciliationDateFormatter.format(date.date) : value;
};

export const bankReconciliationTimestampDisplay = (value: string): string => {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf())
    ? value
    : reconciliationTimestampFormatter.format(timestamp);
};

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
    unresolved:
      search.unresolved === true ||
      search.unresolved === 1 ||
      search.unresolved === "true" ||
      search.unresolved === "1"
        ? true
        : undefined,
    window: ["14", "31", "all"].includes(String(search.window))
      ? (String(search.window) as ReconcileSearch["window"])
      : defaultReconciliationWindow,
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
        unresolvedOnly: deps.unresolved ?? false,
        windowDays:
          deps.window === "all" ? null : deps.window === "14" ? 14 : 31,
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

const reconciliationNavigationContext = (search: ReconcileSearch) =>
  JSON.stringify({
    bankTransactionId: search.bank ?? null,
    artifactId: search.artifact ?? null,
    unresolvedOnly: search.unresolved ?? false,
    window: search.window ?? defaultReconciliationWindow,
    page: search.page ?? 1,
  });

interface BankSourceReview {
  postedDate: string;
  movementAud: string;
  description: string;
  filename: string;
  sourceRow: number | null;
  hints: { label: string; value: string }[];
}

interface BankCandidateReviewInput {
  amountAud: string | null;
  candidateDate?: string | null;
  dateDistanceDays: number;
  documentAmount?: string | null;
  documentCurrency?: string | null;
  matchBasis?: BankMatchBasis;
  settledAt?: string | null;
}

export const bankCandidateReview = (
  candidate: BankCandidateReviewInput,
  bank: {
    postedDate: string;
    metadata: Record<string, string | number | boolean | null>;
  },
) => {
  const matchBasis = candidate.matchBasis ?? "settlement_aud";
  const isInvoiceMatch = matchBasis !== "settlement_aud";
  const isUnverifiedForeignHint = matchBasis === "invoice_foreign_hint";
  const comparisonDateSource =
    typeof bank.metadata.valueDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(bank.metadata.valueDate)
      ? "bank value date"
      : "bank posted date";
  const candidateDate = isInvoiceMatch
    ? candidate.candidateDate?.slice(0, 10)
    : candidate.settledAt?.slice(0, 10);
  const dateDifference = candidate.dateDistanceDays;
  const dateDifferenceLabel =
    dateDifference === 0
      ? `same date as ${comparisonDateSource}`
      : `${dateDifference} ${dateDifference === 1 ? "day" : "days"} from ${comparisonDateSource}`;
  const invoiceAmount = [candidate.documentCurrency, candidate.documentAmount]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    matchBasis,
    isInvoiceMatch,
    isUnverifiedForeignHint,
    basisLabel:
      matchBasis === "settlement_aud"
        ? "Settlement amount (AUD)"
        : matchBasis === "invoice_aud"
          ? "Invoice total (AUD)"
          : "Unverified foreign invoice hint",
    amountLabel: isInvoiceMatch
      ? invoiceAmount || "Invoice amount unavailable"
      : candidate.amountAud
        ? `AUD ${candidate.amountAud}`
        : "AUD amount unavailable",
    candidateDateSourceLabel: isInvoiceMatch
      ? "Invoice/activity date"
      : "Settlement date",
    candidateDate: candidateDate ?? null,
    comparisonDateSource,
    dateDifferenceLabel,
  };
};

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
  const bankMovement = parseDecimal(bank.amountAud);
  const ownerFundingDirectionMatches = isOwnerLoanRepaymentKind(kind)
    ? bankMovement < 0n
    : bankMovement > 0n;
  const fundingAmount =
    ownerFunding && ownerFundingDirectionMatches ? magnitude : null;
  return {
    ownerId: isOwnerLoanRepaymentKind(kind) ? null : data.actorId,
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

interface PendingReconciliationAdvance {
  anchorBankTransactionId: string;
  contextKey: string;
  targetBankTransactionId?: string;
  retryWhenResolved: boolean;
}

interface SuggestedDraftContext {
  bankTransactionId: string;
  sourceRevision: string;
  contextKey: string;
  generation: number;
  navigationGeneration: number;
}

interface SavedSuggestedDraft extends SuggestedDraftContext {
  transactionId: string;
  attempt: number;
  explicit: boolean;
  settlementAcknowledgement?: SuggestedSettlementAcknowledgement;
  phase:
    | "ready"
    | "matching"
    | "confirmation"
    | "missing"
    | "refresh_failed"
    | "failed"
    | "review";
}

interface SuggestedSettlementBank {
  id: string;
  revision: string;
  postedDate: string;
  amountAud: string;
  metadata: Record<string, unknown>;
  reviewState: string;
  matchedTransactionId: string | null;
}

const suggestedSettlementBankKey = (bank: SuggestedSettlementBank) =>
  JSON.stringify({
    id: bank.id,
    revision: bank.revision,
    postedDate: bank.postedDate,
    amountAud: parseDecimal(bank.amountAud).toString(),
    reviewState: bank.reviewState,
    matchedTransactionId: bank.matchedTransactionId,
    foreignCurrency: bank.metadata.foreignCurrency ?? null,
    foreignAmount: bank.metadata.foreignAmount ?? null,
  });

const suggestedSettlementKey = (
  bank: SuggestedSettlementBank,
  candidate: BankCandidateReviewInput & { id: string; kind: string },
  contextKey: string,
  navigationGeneration: number,
) =>
  JSON.stringify({
    contextKey,
    navigationGeneration,
    bank: suggestedSettlementBankKey(bank),
    candidate: {
      id: candidate.id,
      kind: candidate.kind,
      matchBasis: candidate.matchBasis ?? "settlement_aud",
      candidateDate: candidate.candidateDate?.slice(0, 10) ?? null,
      settledAt: candidate.settledAt?.slice(0, 10) ?? null,
      documentCurrency: candidate.documentCurrency ?? null,
      documentAmount: candidate.documentAmount
        ? parseDecimal(candidate.documentAmount).toString()
        : null,
      amountAud: candidate.amountAud
        ? parseDecimal(candidate.amountAud).toString()
        : null,
    },
  });

interface SuggestedSettlementAcknowledgement {
  key: string;
  bankKey: string;
}

interface SuggestedSettlementConfirmation {
  origin: SuggestedDraftContext;
  key: string;
  bankKey: string;
  description: string;
  resolve: (confirmed: boolean) => void;
}

const noSelectedInvoiceArtifacts: readonly string[] = [];

function BankReconcilePage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/banking/reconcile" });
  const router = useRouter();
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [settlementConfirmationKey, setSettlementConfirmationKey] = useState<
    string | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const showCreateRef = useRef(showCreate);
  showCreateRef.current = showCreate;
  const [showDiscardCreateConfirm, setShowDiscardCreateConfirm] =
    useState(false);
  const createFormDirtyRef = useRef(false);
  const createExitCleanupPendingRef = useRef(false);
  const createDrawerBankTransactionIdRef = useRef<string | null>(null);
  const createDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const createDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const markCreateFormDirty = useCallback(() => {
    createFormDirtyRef.current = true;
  }, []);
  const resetCreateWorkflow = useCallback(() => {
    setShowDiscardCreateConfirm(false);
    setCreateKind("");
    setSelectedInvoiceArtifacts(null);
    setInvoiceObservation(null);
    setPendingInvoiceEvidenceContextKey(null);
    setServerIssues([]);
    setSubmissionError("");
    setSubmissionStatus("");
    createFormDirtyRef.current = false;
  }, []);
  const setCreateOverlayRef = useCallback(
    (overlay: HTMLDivElement | null) => {
      if (overlay || !createExitCleanupPendingRef.current) return;
      createExitCleanupPendingRef.current = false;
      resetCreateWorkflow();
      createDrawerBankTransactionIdRef.current = null;
      const trigger = createDrawerTriggerRef.current;
      queueMicrotask(() => {
        if (!showCreateRef.current && trigger?.isConnected && !trigger.disabled)
          trigger.focus();
      });
    },
    [resetCreateWorkflow],
  );
  const [createAndNext, setCreateAndNext] = useState(false);
  const [pendingAdvance, setPendingAdvance] =
    useState<PendingReconciliationAdvance | null>(null);
  const [draftEditor, setDraftEditor] = useState<
    | { status: "loading"; id: string }
    | { status: "error"; id: string; message: string }
    | {
        status: "ready";
        id: string;
        data: Awaited<ReturnType<typeof loadManualTransactionRouteData>>;
        origin: SuggestedDraftContext;
      }
    | null
  >(null);
  const draftLoadVersion = useRef(0);
  const mountedRef = useRef(true);
  const [savedSuggestedDraft, setSavedSuggestedDraft] =
    useState<SavedSuggestedDraft | null>(null);
  const claimedSuggestedAttempt = useRef<string | null>(null);
  const suggestedMatchInFlight = useRef(false);
  const [suggestedSettlementConfirmation, setSuggestedSettlementConfirmation] =
    useState<SuggestedSettlementConfirmation | null>(null);
  const suggestedSettlementConfirmationRef =
    useRef<SuggestedSettlementConfirmation | null>(null);
  const suggestedSettlementAcknowledgement = useRef<{
    generation: number;
    acknowledgement: SuggestedSettlementAcknowledgement;
  } | null>(null);
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
  const [transactionId, setTransactionId] = useState(() => randomUuid());
  const [approvedInvoiceArtifacts, setApprovedInvoiceArtifacts] = useState<
    readonly ManualArtifactOption[]
  >([]);
  const [selectedInvoiceArtifacts, setSelectedInvoiceArtifacts] = useState<{
    readonly contextKey: string;
    readonly ids: readonly string[];
  } | null>(null);
  const [invoiceObservation, setInvoiceObservation] = useState<{
    readonly contextKey: string;
    readonly observation: InvoiceReviewObservation;
  } | null>(null);
  const [
    pendingInvoiceEvidenceContextKey,
    setPendingInvoiceEvidenceContextKey,
  ] = useState<string | null>(null);
  const inFlight = useRef(false);
  const matchedResetTriggerRef = useRef<HTMLButtonElement>(null);
  const matchedResetCancelRef = useRef<HTMLButtonElement>(null);
  const matchedResetConfirmRef = useRef<HTMLButtonElement>(null);
  const wasMatchedResetConfirmOpen = useRef(false);
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const selectedQueueRowRef = useRef<HTMLLIElement>(null);
  const selected = data.detail?.bankTransaction;
  const navigationContextKey = reconciliationNavigationContext(search);
  const invoiceEvidenceContextKey = JSON.stringify({
    navigationContextKey,
    bankTransactionId: selected?.id ?? null,
    bankRevision: selected?.revision ?? null,
    createKind: createKind || null,
    transactionId,
  });
  const invoiceEvidenceContextKeyRef = useRef(invoiceEvidenceContextKey);
  invoiceEvidenceContextKeyRef.current = invoiceEvidenceContextKey;
  const navigationContextKeyRef = useRef(navigationContextKey);
  navigationContextKeyRef.current = navigationContextKey;
  const currentBankRef = useRef(selected);
  currentBankRef.current = selected;
  const navigationVersionRef = useRef(0);
  const draftNavigationRef = useRef({
    contextKey: navigationContextKey,
    bankTransactionId: selected?.id,
  });
  if (
    draftNavigationRef.current.contextKey !== navigationContextKey ||
    draftNavigationRef.current.bankTransactionId !== selected?.id
  ) {
    if (draftNavigationRef.current.contextKey !== navigationContextKey)
      navigationVersionRef.current += 1;
    draftLoadVersion.current += 1;
    draftNavigationRef.current = {
      contextKey: navigationContextKey,
      bankTransactionId: selected?.id,
    };
  }
  const searchRef = useRef(search);
  searchRef.current = search;
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
  const selectedCandidate = data.detail?.candidates.find(
    (candidate) => candidate.id === candidateId,
  );
  const selectedCandidateReview =
    selected && selectedCandidate
      ? bankCandidateReview(selectedCandidate, selected)
      : null;
  const currentSettlementConfirmationKey =
    selected && selectedCandidate
      ? JSON.stringify({
          bankTransactionId: selected.id,
          bankRevision: selected.revision,
          bankPostedDate: selected.postedDate,
          bankAmountAud: selected.amountAud,
          candidateId: selectedCandidate.id,
          matchBasis: selectedCandidate.matchBasis ?? "settlement_aud",
          candidateDate:
            selectedCandidate.candidateDate ??
            selectedCandidate.settledAt ??
            null,
          documentCurrency: selectedCandidate.documentCurrency ?? null,
          documentAmount: selectedCandidate.documentAmount ?? null,
          window: search.window ?? defaultReconciliationWindow,
        })
      : null;
  const settlementConfirmed =
    currentSettlementConfirmationKey !== null &&
    settlementConfirmationKey === currentSettlementConfirmationKey;
  const prefill = useMemo(
    () => (createKind ? createBankTransactionPrefill(data, createKind) : null),
    [createKind, data],
  );
  const availableCreateKinds = selected
    ? bankMatchTransactionKinds(selected.amountAud)
    : [];
  const availableInvoiceArtifacts = useMemo(() => {
    const artifacts = new Map<string, ManualArtifactOption>();
    for (const artifact of data.availableArtifacts)
      artifacts.set(artifact.id, {
        id: artifact.id,
        filename: artifact.filename,
        originalFilename: artifact.originalFilename,
        supplier: artifact.supplier,
        periodStart: artifact.periodStart,
        periodEnd: artifact.periodEnd,
      });
    for (const artifact of approvedInvoiceArtifacts)
      artifacts.set(artifact.id, artifact);
    return [...artifacts.values()];
  }, [approvedInvoiceArtifacts, data.availableArtifacts]);
  const selectedInvoiceArtifactIds =
    selectedInvoiceArtifacts?.contextKey === invoiceEvidenceContextKey
      ? selectedInvoiceArtifacts.ids
      : noSelectedInvoiceArtifacts;
  const selectedInvoiceArtifactId = selectedInvoiceArtifactIds.at(-1) ?? null;
  const selectedInvoiceArtifact = selectedInvoiceArtifactId
    ? (availableInvoiceArtifacts.find(
        (artifact) => artifact.id === selectedInvoiceArtifactId,
      ) ?? null)
    : null;
  const invoiceEvidencePending =
    pendingInvoiceEvidenceContextKey === invoiceEvidenceContextKey;
  const createWorkflowPending = busy || invoiceEvidencePending;
  const handleInvoiceObservationChange = useCallback(
    (artifactId: string, observation: InvoiceReviewObservation | null) => {
      if (invoiceEvidenceContextKeyRef.current !== invoiceEvidenceContextKey)
        return;
      setInvoiceObservation((current) => {
        if (!observation)
          return current?.contextKey === invoiceEvidenceContextKey &&
            current.observation.artifactId === artifactId
            ? null
            : current;
        return { contextKey: invoiceEvidenceContextKey, observation };
      });
    },
    [invoiceEvidenceContextKey],
  );
  const handleInvoiceArtifactApproved = useCallback(
    (artifact: BankInvoiceArtifactDetails) => {
      if (invoiceEvidenceContextKeyRef.current !== invoiceEvidenceContextKey)
        return;
      markCreateFormDirty();

      const option: ManualArtifactOption = {
        id: artifact.id,
        filename: artifact.filename,
        originalFilename: artifact.originalFilename,
        supplier: artifact.supplier,
        periodStart: artifact.periodStart,
        periodEnd: artifact.periodEnd,
      };
      setApprovedInvoiceArtifacts((current) => {
        const existing = current.find((item) => item.id === option.id);
        if (
          existing &&
          existing.filename === option.filename &&
          existing.originalFilename === option.originalFilename &&
          existing.supplier === option.supplier &&
          existing.periodStart === option.periodStart &&
          existing.periodEnd === option.periodEnd
        )
          return current;
        return [...current.filter((item) => item.id !== option.id), option];
      });
      setSelectedInvoiceArtifacts((current) => {
        const ids =
          current?.contextKey === invoiceEvidenceContextKey
            ? current.ids
            : noSelectedInvoiceArtifacts;
        if (ids.includes(option.id)) return current;
        return {
          contextKey: invoiceEvidenceContextKey,
          ids: [...ids, option.id],
        };
      });
      setSubmissionError("");
      setSubmissionStatus(
        "Approved invoice PDF selected for this transaction.",
      );
    },
    [invoiceEvidenceContextKey, markCreateFormDirty],
  );
  const handleInvoiceEvidencePendingChange = useCallback(
    (pending: boolean) => {
      if (invoiceEvidenceContextKeyRef.current !== invoiceEvidenceContextKey)
        return;
      setPendingInvoiceEvidenceContextKey((current) => {
        if (pending)
          return current === invoiceEvidenceContextKey
            ? current
            : invoiceEvidenceContextKey;
        return current === invoiceEvidenceContextKey ? null : current;
      });
    },
    [invoiceEvidenceContextKey],
  );
  const handleSelectedInvoiceArtifactsChange = useCallback(
    (artifactIds: readonly string[]) => {
      if (invoiceEvidenceContextKeyRef.current !== invoiceEvidenceContextKey)
        return;
      const ids = [...new Set(artifactIds)];
      if (
        ids.length !== selectedInvoiceArtifactIds.length ||
        ids.some((id, index) => selectedInvoiceArtifactIds[index] !== id)
      )
        markCreateFormDirty();
      setSelectedInvoiceArtifacts((current) => {
        const currentIds =
          current?.contextKey === invoiceEvidenceContextKey
            ? current.ids
            : noSelectedInvoiceArtifacts;
        if (
          currentIds.length === ids.length &&
          currentIds.every((id, index) => id === ids[index])
        )
          return current;
        return ids.length
          ? { contextKey: invoiceEvidenceContextKey, ids }
          : null;
      });
      setSubmissionError("");
    },
    [
      invoiceEvidenceContextKey,
      markCreateFormDirty,
      selectedInvoiceArtifactIds,
    ],
  );
  const closeCreate = () => {
    createExitCleanupPendingRef.current = true;
    setShowCreate(false);
    setShowDiscardCreateConfirm(false);
  };
  const requestCloseCreate = () => {
    if (createWorkflowPending) return;
    if (createFormDirtyRef.current) {
      setShowDiscardCreateConfirm(true);
      return;
    }
    closeCreate();
  };
  const openCreateTransaction = (kind?: TransactionInput["kind"]) => {
    if (
      !selected ||
      createWorkflowPending ||
      selected.reviewState !== "unresolved" ||
      (kind && !availableCreateKinds.includes(kind))
    )
      return;
    createDrawerTriggerRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    createExitCleanupPendingRef.current = false;
    resetCreateWorkflow();
    if (kind) setCreateKind(kind);
    createDrawerBankTransactionIdRef.current = selected.id;
    setShowCreate(true);
  };
  useEffect(() => {
    if (showCreate) createDrawerCloseRef.current?.focus();
  }, [showCreate]);
  const activeUndo =
    undoAction &&
    selected &&
    undoAction.bankTransactionId === selected.id &&
    undoAction.expectedRevision === selected.revision
      ? undoAction
      : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      draftLoadVersion.current += 1;
      suggestedSettlementConfirmationRef.current?.resolve(false);
      suggestedSettlementConfirmationRef.current = null;
    };
  }, []);

  const finishSuggestedSettlementConfirmation = (confirmed: boolean) => {
    const pending = suggestedSettlementConfirmationRef.current;
    if (!pending) return;
    suggestedSettlementConfirmationRef.current = null;
    setSuggestedSettlementConfirmation(null);
    const bank = currentBankRef.current;
    const current =
      mountedRef.current &&
      draftLoadVersion.current === pending.origin.generation &&
      navigationVersionRef.current === pending.origin.navigationGeneration &&
      navigationContextKeyRef.current === pending.origin.contextKey &&
      bank &&
      suggestedSettlementBankKey(bank) === pending.bankKey;
    if (confirmed && current)
      suggestedSettlementAcknowledgement.current = {
        generation: pending.origin.generation,
        acknowledgement: { key: pending.key, bankKey: pending.bankKey },
      };
    pending.resolve(Boolean(confirmed && current));
  };

  useEffect(() => {
    const pending = suggestedSettlementConfirmationRef.current;
    if (
      pending &&
      (draftLoadVersion.current !== pending.origin.generation ||
        navigationVersionRef.current !== pending.origin.navigationGeneration ||
        navigationContextKey !== pending.origin.contextKey ||
        !selected ||
        suggestedSettlementBankKey(selected) !== pending.bankKey)
    )
      finishSuggestedSettlementConfirmation(false);
  });

  const confirmSuggestedSettlement = async (
    origin: SuggestedDraftContext,
    id: string,
    transaction: TransactionInput,
  ): Promise<boolean> => {
    if (suggestedSettlementConfirmationRef.current) return false;
    suggestedSettlementAcknowledgement.current = null;
    const bank = currentBankRef.current;
    if (
      !bank ||
      !mountedRef.current ||
      draftLoadVersion.current !== origin.generation ||
      navigationVersionRef.current !== origin.navigationGeneration ||
      navigationContextKeyRef.current !== origin.contextKey ||
      bank.id !== origin.bankTransactionId ||
      bank.revision !== origin.sourceRevision ||
      bank.reviewState !== "unresolved" ||
      bank.matchedTransactionId
    )
      return false;
    const assessment = assessBankMatchCandidate({
      bank,
      transaction: {
        ...transaction,
        sourceSystem: "manual",
        status: "recorded",
      },
    });
    if (
      !assessment ||
      "reason" in assessment ||
      assessment.basis === "settlement_aud"
    )
      return true;
    const key = suggestedSettlementKey(
      bank,
      {
        ...transaction,
        id,
        matchBasis: assessment.basis,
        candidateDate: assessment.candidateDate,
        amountAud: assessment.amountAud,
        dateDistanceDays: 0,
      },
      origin.contextKey,
      origin.navigationGeneration,
    );
    return new Promise<boolean>((resolve) => {
      const pending = {
        origin,
        key,
        bankKey: suggestedSettlementBankKey(bank),
        description: `${assessment.basis === "invoice_foreign_hint" ? "This foreign invoice amount is an unverified hint, not a verified AUD settlement amount. " : ""}Save this invoice (${transaction.documentCurrency} ${transaction.documentAmount}, dated ${bankReconciliationDateDisplay(assessment.candidateDate)}) and record the bank posted date ${bankReconciliationDateDisplay(bank.postedDate)} and AUD movement ${formatAudDecimal(bank.amountAud)} as settlement. The invoice date and amount are preserved. Unmatching later leaves the recorded settlement unchanged.`,
        resolve,
      };
      suggestedSettlementConfirmationRef.current = pending;
      setSuggestedSettlementConfirmation(pending);
    });
  };

  useEffect(() => {
    draftLoadVersion.current += 1;
    setDraftEditor(null);
    setSavedSuggestedDraft(null);
    setCandidateId(null);
    setSettlementConfirmationKey(null);
    createExitCleanupPendingRef.current = false;
    createDrawerBankTransactionIdRef.current = null;
    setInvoiceObservation(null);
    setShowCreate(false);
    setShowDiscardCreateConfirm(false);
    createFormDirtyRef.current = false;
    setCreateAndNext(false);
    setCreateKind("");
    setShowMatchedResetConfirm(false);
    setServerIssues([]);
    setSubmissionStatus("");
    setSubmissionError("");
    setCreatedBankMatch(null);
    setTransactionId(randomUuid());
  }, [selected?.id]);

  useEffect(() => {
    setDraftEditor(null);
    setSavedSuggestedDraft(null);
  }, [navigationContextKey]);

  const openDraftEditor = async (id: string) => {
    if (!selected || busy || suggestedMatchInFlight.current) return;
    const requestVersion = ++draftLoadVersion.current;
    const origin: SuggestedDraftContext = {
      bankTransactionId: selected.id,
      sourceRevision: selected.revision,
      contextKey: navigationContextKey,
      generation: requestVersion,
      navigationGeneration: navigationVersionRef.current,
    };
    setSavedSuggestedDraft(null);
    createDrawerBankTransactionIdRef.current = null;
    setShowCreate(false);
    setDraftEditor({ status: "loading", id });
    try {
      const draftData = await loadManualTransactionRouteData(id);
      if (!mountedRef.current || requestVersion !== draftLoadVersion.current)
        return;
      if (
        !draftData.transaction ||
        draftData.transaction.status !== "draft" ||
        draftData.transaction.sourceSystem !== "manual"
      ) {
        setDraftEditor({
          status: "error",
          id,
          message: "This draft is no longer available for editing.",
        });
        return;
      }
      setDraftEditor({ status: "ready", id, data: draftData, origin });
    } catch {
      if (!mountedRef.current || requestVersion !== draftLoadVersion.current)
        return;
      setDraftEditor({
        status: "error",
        id,
        message:
          "The draft could not be loaded. Retry or open its transaction page.",
      });
    }
  };

  useEffect(() => {
    setCandidateId(null);
    setSettlementConfirmationKey(null);
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
    setSettlementConfirmationKey(null);
    createExitCleanupPendingRef.current = false;
    createDrawerBankTransactionIdRef.current = null;
    setShowCreate(false);
    setShowDiscardCreateConfirm(false);
    createFormDirtyRef.current = false;
    setCreateKind("");
    setServerIssues([]);
    await router.invalidate();
  };

  const selectCandidate = (id: string) => {
    setCandidateId(id);
    setSettlementConfirmationKey(null);
  };

  const advanceToNext = async (
    anchorBankTransactionId: string,
    contextKey: string,
    retryWhenResolved = true,
    navigationGeneration?: number,
  ) => {
    const isCurrent = () =>
      mountedRef.current &&
      navigationContextKeyRef.current === contextKey &&
      (navigationGeneration === undefined ||
        navigationVersionRef.current === navigationGeneration);
    if (!isCurrent()) return;

    let result: Awaited<ReturnType<typeof getNextBankReconciliation>>;
    try {
      result = await getNextBankReconciliation({
        data: {
          bankTransactionId: anchorBankTransactionId,
          artifactId: searchRef.current.artifact,
          unresolvedOnly: searchRef.current.unresolved ?? false,
        },
      });
    } catch {
      if (!isCurrent()) return;
      setPendingAdvance({
        anchorBankTransactionId,
        contextKey,
        retryWhenResolved,
      });
      setMessage(
        "The bank row was matched, but advancing failed. Retry advance to continue without repeating the match.",
      );
      return;
    }

    if (!isCurrent()) return;
    if (result.status === "none") {
      setPendingAdvance(null);
      setMessage(
        "The bank row was matched. No unresolved rows remain in this queue.",
      );
      return;
    }
    if (result.status === "advance_incomplete") {
      setPendingAdvance(null);
      setMessage(
        result.reason === "queue_limit"
          ? "The bank row was matched, but the next unresolved row is beyond the 10,100-row queue limit. Narrow the import or filters before advancing."
          : "The bank row was matched, but the queue changed before Folio could select the next row. Reload and continue manually.",
      );
      return;
    }

    const nextSearch = {
      ...searchRef.current,
      bank: result.bankId,
      page: result.page,
    };
    const nextContextKey = reconciliationNavigationContext(nextSearch);
    setPendingAdvance({
      anchorBankTransactionId: result.bankId,
      contextKey: nextContextKey,
      targetBankTransactionId: result.bankId,
      retryWhenResolved,
    });
    setMessage("Bank row matched. Opening the next unresolved row…");

    try {
      await navigate({ search: nextSearch });
    } catch {
      const currentContextKey = navigationContextKeyRef.current;
      if (
        !mountedRef.current ||
        (currentContextKey !== contextKey &&
          currentContextKey !== nextContextKey)
      )
        return;
      setPendingAdvance({
        anchorBankTransactionId,
        contextKey: currentContextKey,
        retryWhenResolved,
      });
      setMessage(
        "The bank row was matched, but Folio could not open the next row. Retry advance to continue without repeating the match.",
      );
    }
  };

  useEffect(() => {
    if (
      !pendingAdvance?.targetBankTransactionId ||
      pendingAdvance.contextKey !== navigationContextKey ||
      selected?.id !== pendingAdvance.targetBankTransactionId
    )
      return;

    if (selected.reviewState === "unresolved") {
      setPendingAdvance(null);
      return;
    }

    if (pendingAdvance.retryWhenResolved) {
      setPendingAdvance(null);
      void advanceToNext(selected.id, navigationContextKey, false);
      return;
    }

    setPendingAdvance({
      anchorBankTransactionId: selected.id,
      contextKey: navigationContextKey,
      retryWhenResolved: false,
    });
    setMessage(
      "The next row was resolved while opening it. Retry advance to continue without repeating the match.",
    );
  }, [
    pendingAdvance,
    navigationContextKey,
    selected?.id,
    selected?.reviewState,
  ]);

  const mutate = async (
    command: BankReconciliationCommand,
    expectedRevision = selected?.revision,
  ) => {
    if (!selected || !expectedRevision) return null;
    setBusy(true);
    setMessage("");
    setCreatedBankMatch(null);

    let result: Awaited<ReturnType<typeof reconcileBankTransaction>>;
    try {
      result = await reconcileBankTransaction({
        data: {
          bankTransactionId: selected.id,
          expectedRevision,
          command,
        },
      });
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
      setBusy(false);
      return null;
    }

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
    try {
      await reload();
    } catch {
      setMessage(
        "The reconciliation was saved, but Folio could not refresh the selected row. Reload before taking another action.",
      );
    } finally {
      setBusy(false);
    }
    return result;
  };

  const matchSelected = async (
    transactionId: string,
    advanceAfterMatch: boolean,
    navigationGeneration?: number,
    settlementAcknowledgement?: SuggestedSettlementAcknowledgement,
  ) => {
    const candidate = data.detail?.candidates.find(
      (item) => item.id === transactionId,
    );
    if (!selected || !candidate || busy) return null;
    const candidateReview = bankCandidateReview(candidate, selected);
    const acknowledged =
      settlementAcknowledgement !== undefined &&
      settlementAcknowledgement.key ===
        suggestedSettlementKey(
          selected,
          candidate,
          navigationContextKey,
          navigationVersionRef.current,
        );
    if (candidateReview.isInvoiceMatch && !settlementConfirmed && !acknowledged)
      return null;

    const anchorBankTransactionId = selected.id;
    const contextKey = navigationContextKey;
    setUndoAction(null);
    const command = candidateReview.isInvoiceMatch
      ? { type: "match" as const, transactionId, confirmSettlement: true }
      : { type: "match" as const, transactionId };
    const result = await mutate(command);
    if (result?.status === "applied" || result?.status === "already_applied")
      setSavedSuggestedDraft((current) =>
        current?.bankTransactionId === anchorBankTransactionId ? null : current,
      );
    if (
      !advanceAfterMatch ||
      !result ||
      (result.status !== "applied" && result.status !== "already_applied")
    )
      return result;
    await advanceToNext(
      anchorBankTransactionId,
      contextKey,
      true,
      navigationGeneration,
    );
    return result;
  };

  useEffect(() => {
    const saved = savedSuggestedDraft;
    if (saved?.settlementAcknowledgement && selected) {
      const candidate = data.detail?.candidates.find(
        (item) => item.id === saved.transactionId,
      );
      if (
        suggestedSettlementBankKey(selected) !==
          saved.settlementAcknowledgement.bankKey ||
        candidateId !== saved.transactionId ||
        (candidate &&
          suggestedSettlementKey(
            selected,
            candidate,
            navigationContextKey,
            navigationVersionRef.current,
          ) !== saved.settlementAcknowledgement.key)
      ) {
        setSettlementConfirmationKey(null);
        setSavedSuggestedDraft({
          ...saved,
          settlementAcknowledgement: undefined,
        });
        return;
      }
    }
    if (
      !saved ||
      saved.phase === "matching" ||
      saved.phase === "review" ||
      saved.phase === "refresh_failed" ||
      busy ||
      suggestedMatchInFlight.current
    )
      return;
    if (
      navigationContextKey !== saved.contextKey ||
      selected?.id !== saved.bankTransactionId ||
      draftLoadVersion.current !== saved.generation
    )
      return;

    if (
      selected.reviewState === "matched" &&
      selected.matchedTransactionId === saved.transactionId
    ) {
      const claim = `${saved.generation}:${saved.attempt}:readback`;
      if (claimedSuggestedAttempt.current === claim) return;
      claimedSuggestedAttempt.current = claim;
      setSavedSuggestedDraft(null);
      void advanceToNext(
        saved.bankTransactionId,
        saved.contextKey,
        true,
        saved.navigationGeneration,
      );
      return;
    }
    if (
      selected.revision !== saved.sourceRevision ||
      selected.reviewState !== "unresolved" ||
      matchedTransactionId
    ) {
      setSavedSuggestedDraft({ ...saved, phase: "review" });
      return;
    }
    if (saved.phase !== "ready") return;

    const claim = `${saved.generation}:${saved.attempt}:match`;
    if (claimedSuggestedAttempt.current === claim) return;
    claimedSuggestedAttempt.current = claim;
    const candidate = data.detail?.candidates.find(
      (item) => item.id === saved.transactionId,
    );
    setCandidateId(saved.transactionId);
    if (candidateId !== saved.transactionId) setSettlementConfirmationKey(null);
    if (!candidate) {
      setSavedSuggestedDraft({ ...saved, phase: "missing" });
      return;
    }
    const review = bankCandidateReview(candidate, selected);
    const acknowledged =
      saved.settlementAcknowledgement !== undefined &&
      saved.settlementAcknowledgement.key ===
        suggestedSettlementKey(
          selected,
          candidate,
          navigationContextKey,
          navigationVersionRef.current,
        );
    if (
      review.isInvoiceMatch &&
      !acknowledged &&
      (!saved.explicit ||
        candidateId !== saved.transactionId ||
        !settlementConfirmed)
    ) {
      setSavedSuggestedDraft({
        ...saved,
        settlementAcknowledgement: undefined,
        phase: "confirmation",
      });
      return;
    }

    suggestedMatchInFlight.current = true;
    setSavedSuggestedDraft({ ...saved, phase: "matching" });
    void matchSelected(
      saved.transactionId,
      true,
      saved.navigationGeneration,
      acknowledged ? saved.settlementAcknowledgement : undefined,
    ).then((result) => {
      suggestedMatchInFlight.current = false;
      if (
        !mountedRef.current ||
        navigationContextKeyRef.current !== saved.contextKey ||
        currentBankRef.current?.id !== saved.bankTransactionId ||
        draftLoadVersion.current !== saved.generation ||
        result
      )
        return;
      setSavedSuggestedDraft((current) =>
        current?.generation === saved.generation &&
        current.attempt === saved.attempt
          ? { ...current, phase: "failed" }
          : current,
      );
    });
  }, [
    savedSuggestedDraft,
    selectedCandidate,
    data.detail,
    navigationContextKey,
    selected,
    matchedTransactionId,
    candidateId,
    settlementConfirmed,
    busy,
  ]);

  const retrySuggestedDraftMatch = async () => {
    const saved = savedSuggestedDraft;
    if (!saved || busy || suggestedMatchInFlight.current) return;
    suggestedMatchInFlight.current = true;
    setBusy(true);
    setSavedSuggestedDraft({ ...saved, phase: "matching" });
    try {
      await router.invalidate({ sync: true });
      if (
        !mountedRef.current ||
        navigationContextKeyRef.current !== saved.contextKey ||
        currentBankRef.current?.id !== saved.bankTransactionId ||
        draftLoadVersion.current !== saved.generation
      )
        return;
      setSavedSuggestedDraft((current) =>
        current?.generation === saved.generation &&
        current.attempt === saved.attempt
          ? {
              ...current,
              attempt: current.attempt + 1,
              explicit: true,
              phase: "ready",
            }
          : current,
      );
    } catch {
      if (
        mountedRef.current &&
        navigationContextKeyRef.current === saved.contextKey &&
        currentBankRef.current?.id === saved.bankTransactionId &&
        draftLoadVersion.current === saved.generation
      )
        setSavedSuggestedDraft((current) =>
          current?.generation === saved.generation &&
          current.attempt === saved.attempt
            ? { ...current, phase: "refresh_failed" }
            : current,
        );
    } finally {
      suggestedMatchInFlight.current = false;
      if (mountedRef.current) setBusy(false);
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
    if (invoiceEvidencePending) {
      setSubmissionError(
        "Wait for invoice PDF review to finish, or clear the pending evidence before saving.",
      );
      return;
    }
    if (submission.file) {
      setSubmissionError(
        "Choose and approve invoice PDFs in the adjacent evidence panel before saving and matching.",
      );
      return;
    }

    const artifactIds = [
      ...new Set([...selectedInvoiceArtifactIds, ...submission.artifactIds]),
    ];
    const availableArtifactIds = new Set(
      availableInvoiceArtifacts.map((artifact) => artifact.id),
    );
    if (artifactIds.some((id) => !availableArtifactIds.has(id))) {
      setSubmissionError(
        "Only available, approved invoice PDFs can be linked to this transaction.",
      );
      return;
    }

    const anchorBankTransactionId = selected.id;
    const operationContextKey = navigationContextKey;
    const shouldAdvance = createAndNext;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setSubmissionError("");
    setSubmissionStatus("");
    setUndoAction(null);
    setServerIssues([]);
    try {
      setSubmissionStatus("Saving the transaction and bank-row match…");

      const result = await createAndMatchBankTransaction({
        data: {
          bankTransactionId: selected.id,
          expectedRevision: selected.revision,
          transactionId,
          transaction: {
            ...submission.transaction,
            sourceArtifactId: artifactIds.includes(
              submission.transaction.sourceArtifactId ?? "",
            )
              ? submission.transaction.sourceArtifactId
              : (artifactIds[0] ?? null),
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
          "The transaction submission ID is preserved for a safe retry.",
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
      let selectedRowRefreshed = true;
      try {
        await reload();
      } catch {
        selectedRowRefreshed = false;
        setSubmissionStatus(
          "The transaction and bank-row match were saved, but the selected row could not be refreshed.",
        );
      }
      setTransactionId(randomUuid());
      setCreateAndNext(false);
      if (
        shouldAdvance &&
        (result.status === "applied" || result.status === "already_applied") &&
        navigationContextKeyRef.current === operationContextKey
      ) {
        if (selectedRowRefreshed) setSubmissionStatus("");
        await advanceToNext(anchorBankTransactionId, operationContextKey);
      }
    } catch (error) {
      const failureMessage = errorMessage(error);
      setSubmissionError(failureMessage);
      setSubmissionStatus(
        "The transaction submission ID is preserved for a safe retry.",
      );
      setMessage(failureMessage);
      try {
        await router.invalidate();
      } catch {
        setSubmissionStatus(
          "Reload before retrying to verify the bank-row state; the transaction submission ID is preserved.",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const createDrawerBankTransactionId =
    createDrawerBankTransactionIdRef.current;

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

          <label className="banking-queue-filter">
            <input
              type="checkbox"
              checked={search.unresolved ?? false}
              onChange={(event) =>
                void navigate({
                  search: {
                    ...search,
                    unresolved: event.target.checked ? true : undefined,
                    page: 1,
                    bank: undefined,
                  },
                })
              }
            />
            Unresolved only
          </label>

          {data.rows.length === 0 ? (
            <div className="banking-empty-state">
              {search.unresolved ? (
                <>
                  <h3>No unresolved bank rows</h3>
                  <p>All bank rows in this queue have been reviewed.</p>
                </>
              ) : (
                <>
                  <h3>No imported bank rows</h3>
                  <p>Import a CommBank CSV to begin reviewing bank activity.</p>
                  <a className="banking-button-link" href="/imports/commbank">
                    Import CSV
                  </a>
                </>
              )}
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
                      href={`/banking/reconcile?bank=${encodeURIComponent(row.id)}${search.artifact ? `&artifact=${encodeURIComponent(search.artifact)}` : ""}${search.unresolved ? "&unresolved=true" : ""}&window=${search.window ?? defaultReconciliationWindow}&page=${search.page ?? 1}`}
                    >
                      <span className="banking-queue-meta">
                        <time
                          dateTime={
                            bankReconciliationDateIso(row.postedDate) ??
                            undefined
                          }
                        >
                          {bankReconciliationDateDisplay(row.postedDate)}
                        </time>
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
                        <MoneyText
                          as="strong"
                          className={
                            row.amountAud.startsWith("-")
                              ? "amount-negative"
                              : "amount-positive"
                          }
                        >
                          {formatAudDecimal(row.amountAud)}
                        </MoneyText>
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
                  search.unresolved
                    ? data.counts.unresolved
                    : data.counts.total,
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

            <div className="banking-selected-review-groups">
              <section
                className="banking-selected-transaction banking-transaction-summary"
                aria-labelledby="selected-bank-transaction-summary"
              >
                <h3 id="selected-bank-transaction-summary">Transaction</h3>
                <dl className="banking-detail-grid">
                  <div>
                    <dt>Description</dt>
                    <dd>{sourceReview?.description}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>
                      {sourceReview && (
                        <time
                          dateTime={
                            bankReconciliationDateIso(
                              sourceReview.postedDate,
                            ) ?? undefined
                          }
                        >
                          {bankReconciliationDateDisplay(
                            sourceReview.postedDate,
                          )}
                        </time>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Movement (AUD, as imported)</dt>
                    <dd>
                      <MoneyText>{sourceReview?.movementAud}</MoneyText>
                    </dd>
                  </div>
                  <div className="banking-detail-wide banking-summary-hints">
                    <dt>Payment hints</dt>
                    <dd>
                      {sourceReview?.hints.length ? (
                        <ul className="banking-payment-hints">
                          {sourceReview.hints.map((hint) => (
                            <li key={hint.label}>
                              {hint.label}:{" "}
                              {hint.label ===
                              "Value date (payment timing hint)" ? (
                                <time
                                  dateTime={
                                    bankReconciliationDateIso(hint.value) ??
                                    undefined
                                  }
                                >
                                  {bankReconciliationDateDisplay(hint.value)}
                                </time>
                              ) : (
                                hint.value
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "No payment hints"
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                className="banking-selected-source"
                aria-labelledby="selected-bank-source-summary"
              >
                <h3 id="selected-bank-source-summary">Source</h3>
                <dl className="banking-detail-grid">
                  <div className="banking-detail-wide">
                    <dt>Filename</dt>
                    <dd>
                      <a href="/banking/imports">{sourceReview?.filename}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Source row</dt>
                    <dd>{sourceReview?.sourceRow ?? "Not supplied"}</dd>
                  </div>
                  <div>
                    <dt>Profile</dt>
                    <dd>
                      <code className="banking-identifier">
                        {data.detail.source.profile}
                      </code>
                    </dd>
                  </div>
                  <div className="banking-detail-wide">
                    <dt>Import period</dt>
                    <dd>
                      {data.detail.source.earliestDate ? (
                        <time
                          dateTime={
                            bankReconciliationDateIso(
                              data.detail.source.earliestDate,
                            ) ?? undefined
                          }
                        >
                          {bankReconciliationDateDisplay(
                            data.detail.source.earliestDate,
                          )}
                        </time>
                      ) : (
                        "—"
                      )}{" "}
                      to{" "}
                      {data.detail.source.latestDate ? (
                        <time
                          dateTime={
                            bankReconciliationDateIso(
                              data.detail.source.latestDate,
                            ) ?? undefined
                          }
                        >
                          {bankReconciliationDateDisplay(
                            data.detail.source.latestDate,
                          )}
                        </time>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                className="banking-selected-folio-metadata"
                aria-labelledby="selected-bank-folio-summary"
              >
                <h3 id="selected-bank-folio-summary">Folio metadata</h3>
                <dl className="banking-detail-grid">
                  <div className="banking-detail-wide">
                    <dt>Bank row ID</dt>
                    <dd>
                      <code className="banking-identifier">{selected.id}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Reviewed at</dt>
                    <dd>
                      <time dateTime={selected.updatedAt}>
                        {bankReconciliationTimestampDisplay(selected.updatedAt)}
                      </time>
                    </dd>
                  </div>
                  <div className="banking-detail-wide">
                    <dt>Reviewed by</dt>
                    <dd>
                      {selected.updatedById ? (
                        <code className="banking-identifier">
                          {selected.updatedById}
                        </code>
                      ) : (
                        "Unknown"
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <BankProposalSuggestions
              bankTransactionId={selected.id}
              suggestions={data.suggestions}
              onEditDraft={(id) => void openDraftEditor(id)}
            />

            {draftEditor && (
              <section
                className="banking-create-panel"
                aria-label="Edit suggested draft"
              >
                {draftEditor.status === "loading" ? (
                  <p role="status">Loading draft…</p>
                ) : draftEditor.status === "error" ? (
                  <p role="alert">{draftEditor.message}</p>
                ) : (
                  <ManualTransactionRoute
                    key={draftEditor.id}
                    data={draftEditor.data}
                    mode="edit"
                    returnTo={`/banking/reconcile?bank=${selected.id}`}
                    reviewReturnTo={`/banking/reconcile?bank=${selected.id}`}
                    embedded
                    allowSaveMatchNext={
                      selected.reviewState === "unresolved" &&
                      !matchedTransactionId &&
                      selected.id === draftEditor.origin.bankTransactionId &&
                      selected.revision === draftEditor.origin.sourceRevision &&
                      navigationContextKey === draftEditor.origin.contextKey
                    }
                    onBeforeSaveMatchNext={(transaction) =>
                      confirmSuggestedSettlement(
                        draftEditor.origin,
                        draftEditor.id,
                        transaction,
                      )
                    }
                    onCancel={() => {
                      draftLoadVersion.current += 1;
                      setDraftEditor(null);
                    }}
                    onDeleted={() => {
                      if (
                        !mountedRef.current ||
                        draftLoadVersion.current !==
                          draftEditor.origin.generation
                      )
                        return;
                      draftLoadVersion.current += 1;
                      setDraftEditor(null);
                      setMessage(
                        "Draft deleted. Uploaded files were retained.",
                      );
                    }}
                    onSaved={(status, saved) => {
                      const origin = draftEditor.origin;
                      if (
                        !mountedRef.current ||
                        draftLoadVersion.current !== origin.generation ||
                        navigationContextKeyRef.current !== origin.contextKey ||
                        currentBankRef.current?.id !== origin.bankTransactionId
                      )
                        return;
                      draftLoadVersion.current += 1;
                      setDraftEditor(null);
                      if (
                        status === "recorded" &&
                        saved.afterSave === "match_next"
                      ) {
                        setSavedSuggestedDraft({
                          ...origin,
                          generation: draftLoadVersion.current,
                          transactionId: saved.transactionId,
                          phase: saved.refreshSucceeded
                            ? "ready"
                            : "refresh_failed",
                          attempt: 0,
                          explicit: false,
                          settlementAcknowledgement:
                            suggestedSettlementAcknowledgement.current
                              ?.generation === origin.generation
                              ? suggestedSettlementAcknowledgement.current
                                  .acknowledgement
                              : undefined,
                        });
                        setCandidateId(saved.transactionId);
                        setSettlementConfirmationKey(null);
                        setMessage("");
                        return;
                      }
                      setMessage(
                        status === "recorded"
                          ? "Draft recorded. Match the bank row separately when ready."
                          : "Draft changes saved. The bank row remains unresolved.",
                      );
                    }}
                  />
                )}
              </section>
            )}

            {suggestedSettlementConfirmation && (
              <ConfirmationDialog
                title="Confirm bank settlement before saving?"
                description={suggestedSettlementConfirmation.description}
                confirmLabel="Confirm settlement and save"
                cancelLabel="Keep editing"
                onCancel={() => finishSuggestedSettlementConfirmation(false)}
                onConfirm={() => finishSuggestedSettlementConfirmation(true)}
              />
            )}

            {!draftEditor && (
              <>
                {savedSuggestedDraft &&
                  savedSuggestedDraft.bankTransactionId === selected.id &&
                  savedSuggestedDraft.contextKey === navigationContextKey && (
                    <section aria-label="Saved suggested transaction">
                      <p role="status">
                        {savedSuggestedDraft.phase === "matching" ||
                        savedSuggestedDraft.phase === "ready"
                          ? "Saved. Checking the bank match…"
                          : savedSuggestedDraft.phase === "confirmation"
                            ? "Saved, unmatched. Confirm the bank settlement below, then retry the match."
                            : savedSuggestedDraft.phase === "review"
                              ? "Saved, unmatched. The bank row changed. Review its current state before matching separately."
                              : savedSuggestedDraft.phase === "refresh_failed"
                                ? "Saved, unmatched. The current bank row could not be refreshed. Refresh before retrying the match."
                                : savedSuggestedDraft.phase === "missing"
                                  ? "Saved, unmatched. The recorded transaction is not an eligible candidate in the current date window. Refresh and retry, or review the transaction and date window."
                                  : "Saved, unmatched. Matching failed. Retry the match without saving the transaction again."}
                      </p>
                      <a
                        href={`/transactions/${encodeURIComponent(savedSuggestedDraft.transactionId)}`}
                      >
                        View saved transaction
                      </a>
                      {savedSuggestedDraft.phase !== "review" && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            busy ||
                            savedSuggestedDraft.phase === "matching" ||
                            savedSuggestedDraft.phase === "ready" ||
                            (savedSuggestedDraft.phase === "confirmation" &&
                              (candidateId !==
                                savedSuggestedDraft.transactionId ||
                                !settlementConfirmed))
                          }
                          onClick={() => void retrySuggestedDraftMatch()}
                        >
                          {savedSuggestedDraft.phase === "missing" ||
                          savedSuggestedDraft.phase === "refresh_failed"
                            ? "Refresh and retry match"
                            : "Retry match and next"}
                        </button>
                      )}
                    </section>
                  )}
                {!matchedTransactionId &&
                  selected.reviewState !== "matched" && (
                    <fieldset
                      className="banking-candidate-fieldset"
                      disabled={busy || selected.reviewState !== "unresolved"}
                    >
                      <legend>Invoice and settlement candidates</legend>
                      <label className="banking-window-field">
                        Date window
                        <AutocompleteSelect
                          aria-label="Date window"
                          value={search.window ?? defaultReconciliationWindow}
                          onValueChange={(event) =>
                            void navigate({
                              search: {
                                ...search,
                                window: event as "14" | "31" | "all",
                              },
                            })
                          }
                        >
                          <option value="14">±14 days</option>
                          <option value="31">±31 days</option>
                          <option value="all">Search all dates</option>
                        </AutocompleteSelect>
                      </label>
                      {data.detail.candidates.length === 0 ? (
                        <p className="banking-muted">
                          No candidates{" "}
                          {search.window === "all"
                            ? "across all dates"
                            : `within ±${search.window ?? defaultReconciliationWindow} days`}
                          . Invoice matches need a recorded invoice or activity
                          date; settlement matches need a settlement date.
                        </p>
                      ) : (
                        <div className="banking-candidate-list">
                          {data.detail.candidates.map((candidate) => {
                            const review = bankCandidateReview(
                              candidate,
                              selected,
                            );
                            return (
                              <label
                                className="banking-candidate-option"
                                key={candidate.id}
                              >
                                <input
                                  type="radio"
                                  name="candidate"
                                  checked={candidateId === candidate.id}
                                  onChange={() => selectCandidate(candidate.id)}
                                />
                                <span className="banking-candidate-content">
                                  <span className="banking-candidate-title">
                                    <strong>
                                      {candidate.counterparty ??
                                        "No counterparty"}
                                    </strong>
                                    {review.isInvoiceMatch ? (
                                      <strong>{review.amountLabel}</strong>
                                    ) : candidate.amountAud ? (
                                      <MoneyText>
                                        {formatAudDecimal(candidate.amountAud)}
                                      </MoneyText>
                                    ) : (
                                      <strong>{review.amountLabel}</strong>
                                    )}
                                  </span>
                                  <span
                                    className={
                                      review.isUnverifiedForeignHint
                                        ? "banking-candidate-unverified"
                                        : "banking-muted"
                                    }
                                  >
                                    {review.basisLabel}
                                  </span>
                                  <span>
                                    {review.candidateDateSourceLabel}:{" "}
                                    {review.candidateDate ? (
                                      <time
                                        dateTime={
                                          bankReconciliationDateIso(
                                            review.candidateDate,
                                          ) ?? undefined
                                        }
                                      >
                                        {bankReconciliationDateDisplay(
                                          review.candidateDate,
                                        )}
                                      </time>
                                    ) : (
                                      "unavailable"
                                    )}{" "}
                                    · {review.dateDifferenceLabel}
                                  </span>
                                  <span>
                                    {candidate.kind} ·{" "}
                                    {candidate.reference ?? "No reference"} ·{" "}
                                    {candidate.description ?? "No description"}
                                  </span>
                                  <span className="banking-muted">
                                    Text evidence {candidate.textScore}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {selected && selectedCandidateReview?.isInvoiceMatch && (
                        <div
                          className="banking-candidate-confirmation"
                          role="group"
                          aria-label="Confirm bank settlement"
                        >
                          {selectedCandidateReview.isUnverifiedForeignHint && (
                            <p
                              className="banking-candidate-warning"
                              role="alert"
                            >
                              This foreign invoice amount is an unverified hint.
                              It is not a verified AUD settlement amount.
                            </p>
                          )}
                          <p>
                            The bank posted date{" "}
                            <time
                              dateTime={
                                bankReconciliationDateIso(
                                  selected.postedDate,
                                ) ?? undefined
                              }
                            >
                              {bankReconciliationDateDisplay(
                                selected.postedDate,
                              )}
                            </time>{" "}
                            and AUD movement{" "}
                            <MoneyText>
                              {formatAudDecimal(selected.amountAud)}
                            </MoneyText>{" "}
                            will be recorded as settlement. The invoice date and
                            amount are preserved.
                          </p>
                          <p className="banking-muted">
                            Unmatching later removes the bank link; it leaves
                            the transaction's recorded settlement unchanged.
                          </p>
                          <label>
                            <input
                              type="checkbox"
                              checked={settlementConfirmed}
                              onChange={(event) =>
                                setSettlementConfirmationKey(
                                  event.currentTarget.checked
                                    ? currentSettlementConfirmationKey
                                    : null,
                                )
                              }
                            />
                            {selectedCandidateReview.isUnverifiedForeignHint
                              ? "I acknowledge this foreign invoice amount is an unverified hint and confirm the bank movement as settlement."
                              : "I confirm the bank posted date and AUD movement as settlement."}
                          </label>
                        </div>
                      )}
                      <div className="actions banking-action-row banking-candidate-match-actions">
                        <button
                          type="button"
                          disabled={
                            !selectedCandidate ||
                            busy ||
                            Boolean(
                              selectedCandidateReview?.isInvoiceMatch &&
                              !settlementConfirmed,
                            )
                          }
                          onClick={() => {
                            if (!selectedCandidate) return;
                            void matchSelected(selectedCandidate.id, false);
                          }}
                        >
                          Match selected transaction
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            !selectedCandidate ||
                            busy ||
                            Boolean(
                              selectedCandidateReview?.isInvoiceMatch &&
                              !settlementConfirmed,
                            )
                          }
                          onClick={() => {
                            if (!selectedCandidate) return;
                            void matchSelected(selectedCandidate.id, true);
                          }}
                        >
                          Match and next
                        </button>
                      </div>
                    </fieldset>
                  )}

                <div className="banking-action-rows">
                  <div
                    className="actions banking-action-row"
                    role="group"
                    aria-label="Classify bank row"
                  >
                    {(["private", "transfer", "duplicate"] as const).map(
                      (classification) => (
                        <button
                          key={classification}
                          type="button"
                          className="secondary"
                          disabled={
                            busy || selected.reviewState !== "unresolved"
                          }
                          onClick={() => void classifySelected(classification)}
                        >
                          Mark {classification}
                        </button>
                      ),
                    )}
                  </div>
                  <div
                    className="actions banking-action-row"
                    role="group"
                    aria-label="Create transaction actions"
                  >
                    <button
                      type="button"
                      className="secondary"
                      ref={createDrawerTriggerRef}
                      aria-haspopup="dialog"
                      disabled={busy || selected.reviewState !== "unresolved"}
                      onClick={() => openCreateTransaction()}
                    >
                      Create transaction
                    </button>
                    {availableCreateKinds.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className="secondary"
                        aria-label={`Create ${transactionKindLabels[kind].toLowerCase()}`}
                        aria-haspopup="dialog"
                        disabled={busy || selected.reviewState !== "unresolved"}
                        onClick={() => openCreateTransaction(kind)}
                      >
                        {transactionKindLabels[kind]}
                      </button>
                    ))}
                  </div>
                  <div
                    className="actions banking-action-row"
                    role="group"
                    aria-label="Other reconciliation actions"
                  >
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
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || selected.reviewState === "unresolved"}
                      ref={matchedResetTriggerRef}
                      onClick={resetSelected}
                    >
                      Unmatch or reset to unresolved
                    </button>
                  </div>
                </div>

                <p
                  className="banking-action-status"
                  role="status"
                  aria-live="polite"
                >
                  {message}
                </p>

                {pendingAdvance?.contextKey === navigationContextKey &&
                  !pendingAdvance.targetBankTransactionId && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void advanceToNext(
                          pendingAdvance.anchorBankTransactionId,
                          pendingAdvance.contextKey,
                          pendingAdvance.retryWhenResolved,
                        )
                      }
                    >
                      Retry advance
                    </button>
                  )}

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

                {showMatchedResetConfirm &&
                  selected.reviewState === "matched" && (
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
                          Only the bank link will be removed. The Folio
                          transaction and its recorded settlement date and
                          amount will remain unchanged.
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
              </>
            )}
          </section>
        )}
      </div>

      {data.detail &&
        selected &&
        sourceReview &&
        createDrawerBankTransactionId === selected.id && (
          <ModalOverlay
            ref={setCreateOverlayRef}
            className="banking-create-overlay"
            isOpen={showCreate}
            isDismissable={!createWorkflowPending && !showDiscardCreateConfirm}
            isKeyboardDismissDisabled={
              createWorkflowPending || showDiscardCreateConfirm
            }
            onOpenChange={(open) => {
              if (!open) requestCloseCreate();
            }}
          >
            <Modal className="banking-create-modal">
              <Dialog
                className="banking-create-drawer"
                aria-labelledby="create-from-bank"
                aria-describedby="create-drawer-description"
                inert={!showCreate}
              >
                <header className="banking-create-drawer-header">
                  <div>
                    <p className="banking-kicker">Reconcile bank row</p>
                    <h2 id="create-from-bank">Create transaction</h2>
                    <p id="create-drawer-description">
                      Review the imported movement and transaction details
                      before saving and matching.
                    </p>
                  </div>
                  <button
                    ref={createDrawerCloseRef}
                    type="button"
                    className="secondary"
                    aria-label="Return to reconciliation queue"
                    disabled={createWorkflowPending}
                    onClick={requestCloseCreate}
                  >
                    <span className="banking-create-return-label">
                      Return to reconciliation queue
                    </span>
                    <span
                      className="banking-create-close-icon"
                      aria-hidden="true"
                    >
                      ×
                    </span>
                  </button>
                </header>

                <div className="banking-create-drawer-body">
                  <div className="banking-create-drawer-summary">
                    <section
                      className="banking-create-summary-section banking-transaction-summary"
                      aria-labelledby="create-bank-transaction"
                    >
                      <h3 id="create-bank-transaction">Transaction</h3>
                      <dl className="banking-create-summary-grid">
                        <div>
                          <dt>Description</dt>
                          <dd>{sourceReview.description}</dd>
                        </div>
                        <div>
                          <dt>Date</dt>
                          <dd>
                            <time
                              dateTime={
                                bankReconciliationDateIso(
                                  sourceReview.postedDate,
                                ) ?? undefined
                              }
                            >
                              {bankReconciliationDateDisplay(
                                sourceReview.postedDate,
                              )}
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>Movement (AUD)</dt>
                          <dd>
                            <MoneyText>{sourceReview.movementAud}</MoneyText>
                          </dd>
                        </div>
                        <div className="banking-create-summary-wide banking-summary-hints">
                          <dt>Payment hints</dt>
                          <dd>
                            {sourceReview.hints.length > 0 ? (
                              <ul className="banking-payment-hints">
                                {sourceReview.hints.map((hint) => (
                                  <li key={hint.label}>
                                    {hint.label}:{" "}
                                    {hint.label ===
                                    "Value date (payment timing hint)" ? (
                                      <time
                                        dateTime={
                                          bankReconciliationDateIso(
                                            hint.value,
                                          ) ?? undefined
                                        }
                                      >
                                        {bankReconciliationDateDisplay(
                                          hint.value,
                                        )}
                                      </time>
                                    ) : (
                                      hint.value
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              "No payment hints"
                            )}
                          </dd>
                        </div>
                      </dl>
                    </section>

                    <section
                      className="banking-create-summary-section"
                      aria-labelledby="create-bank-source"
                    >
                      <h3 id="create-bank-source">Source</h3>
                      <dl className="banking-create-summary-grid">
                        <div className="banking-create-summary-wide">
                          <dt>Filename</dt>
                          <dd>
                            <a href="/banking/imports">
                              {sourceReview.filename}
                            </a>
                          </dd>
                        </div>
                        <div>
                          <dt>Source row</dt>
                          <dd>{sourceReview.sourceRow ?? "Not supplied"}</dd>
                        </div>
                        <div>
                          <dt>Profile</dt>
                          <dd>
                            <code className="banking-identifier">
                              {data.detail.source.profile}
                            </code>
                          </dd>
                        </div>
                        <div className="banking-create-summary-wide">
                          <dt>Import period</dt>
                          <dd>
                            {data.detail.source.earliestDate ? (
                              <time
                                dateTime={
                                  bankReconciliationDateIso(
                                    data.detail.source.earliestDate,
                                  ) ?? undefined
                                }
                              >
                                {bankReconciliationDateDisplay(
                                  data.detail.source.earliestDate,
                                )}
                              </time>
                            ) : (
                              "—"
                            )}{" "}
                            to{" "}
                            {data.detail.source.latestDate ? (
                              <time
                                dateTime={
                                  bankReconciliationDateIso(
                                    data.detail.source.latestDate,
                                  ) ?? undefined
                                }
                              >
                                {bankReconciliationDateDisplay(
                                  data.detail.source.latestDate,
                                )}
                              </time>
                            ) : (
                              "—"
                            )}
                          </dd>
                        </div>
                      </dl>
                    </section>

                    <section
                      className="banking-create-summary-section"
                      aria-labelledby="create-bank-folio"
                    >
                      <h3 id="create-bank-folio">Folio metadata</h3>
                      <dl className="banking-create-summary-grid">
                        <div className="banking-create-summary-wide">
                          <dt>Bank row ID</dt>
                          <dd>
                            <code className="banking-identifier">
                              {selected.id}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt>Reviewed at</dt>
                          <dd>
                            <time dateTime={selected.updatedAt}>
                              {bankReconciliationTimestampDisplay(
                                selected.updatedAt,
                              )}
                            </time>
                          </dd>
                        </div>
                        <div className="banking-create-summary-wide">
                          <dt>Reviewed by</dt>
                          <dd>
                            {selected.updatedById ? (
                              <code className="banking-identifier">
                                {selected.updatedById}
                              </code>
                            ) : (
                              "Unknown"
                            )}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </div>

                  {!prefill ? (
                    <div className="banking-kind-choice">
                      <p className="banking-csv-provenance">
                        Bank details prefill the posted date, AUD settlement
                        amount, and raw description after you select a
                        transaction kind. They do not identify a supplier or
                        establish an invoice date.
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
                              disabled={createWorkflowPending}
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
                    <div
                      className="banking-create-workspace"
                      onInputCapture={markCreateFormDirty}
                      onChangeCapture={markCreateFormDirty}
                      onClickCapture={(event) => {
                        const target =
                          event.target instanceof Element ? event.target : null;
                        if (!target) return;
                        if (target.closest('[role="option"]')) {
                          markCreateFormDirty();
                          return;
                        }
                        if (!target.closest(".manual-entry-form")) return;
                        const button = target.closest("button");
                        if (
                          !button ||
                          button.type === "submit" ||
                          button.classList.contains("link") ||
                          button
                            .getAttribute("aria-label")
                            ?.startsWith("Show ") ||
                          button.textContent?.trim() === "Cancel edit"
                        )
                          return;
                        markCreateFormDirty();
                      }}
                    >
                      <div className="banking-create-form-column">
                        <p className="banking-csv-provenance" role="note">
                          <strong>Bank CSV provenance</strong>
                          <span>
                            The CommBank CSV records payment movement only. It
                            is not invoice evidence and does not establish an
                            invoice total, GST, or deductibility.
                          </span>
                        </p>
                        <label className="banking-create-and-next">
                          <input
                            type="checkbox"
                            checked={createAndNext}
                            disabled={createWorkflowPending}
                            onChange={(event) =>
                              setCreateAndNext(event.target.checked)
                            }
                          />
                          Go to the next unresolved row after a successful match
                        </label>
                        <ManualTransactionForm
                          key={invoiceEvidenceContextKey}
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
                          attachedArtifactIds={selectedInvoiceArtifactIds}
                          availableArtifacts={availableInvoiceArtifacts}
                          invoiceObservation={
                            invoiceObservation?.contextKey ===
                            invoiceEvidenceContextKey
                              ? invoiceObservation.observation
                              : null
                          }
                          bankSettlementPrefilled
                          bankPaymentHints={{
                            foreignCurrency:
                              typeof selected.metadata.foreignCurrency ===
                              "string"
                                ? selected.metadata.foreignCurrency
                                : null,
                            foreignAmount:
                              typeof selected.metadata.foreignAmount ===
                              "string"
                                ? selected.metadata.foreignAmount
                                : null,
                          }}
                          allowedKinds={availableCreateKinds}
                          recordButtonLabel={
                            createAndNext ? "Save, match, and next" : undefined
                          }
                          bankMovementIsPositive={
                            parseDecimal(selected.amountAud) > 0n
                          }
                          evidenceStatus={
                            <p className="banking-csv-evidence-status">
                              The bank CSV remains payment provenance. Only
                              approved invoice PDFs can be linked.
                            </p>
                          }
                          busy={createWorkflowPending}
                          serverIssues={serverIssues}
                          submissionStatus={submissionStatus || undefined}
                          submissionError={submissionError || undefined}
                          onEvidenceChange={() => undefined}
                          onSelectedArtifactsChange={
                            handleSelectedInvoiceArtifactsChange
                          }
                          onSubmit={createAndMatch}
                          hideFileUpload
                          onCancel={requestCloseCreate}
                        />
                      </div>
                      <aside
                        className="banking-create-evidence-column"
                        aria-label="Invoice evidence"
                      >
                        <BankInvoiceEvidence
                          key={invoiceEvidenceContextKey}
                          actorId={data.actorId}
                          contextKey={invoiceEvidenceContextKey}
                          selectedArtifact={selectedInvoiceArtifact}
                          busy={busy}
                          onApproved={handleInvoiceArtifactApproved}
                          onInvoiceObservation={handleInvoiceObservationChange}
                          onPendingChange={handleInvoiceEvidencePendingChange}
                        />
                      </aside>
                    </div>
                  )}
                </div>
                {showDiscardCreateConfirm && (
                  <ConfirmationDialog
                    title="Discard transaction edits?"
                    description="Your transaction fields, artifact selection, and invoice metadata edits will be discarded. Approved PDFs remain available in the file library."
                    confirmLabel="Discard edits"
                    cancelLabel="Keep editing"
                    onCancel={() => setShowDiscardCreateConfirm(false)}
                    onConfirm={closeCreate}
                  />
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        )}
    </main>
  );
}

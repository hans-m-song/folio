import { parseDecimal } from "./money";
import type { ManualTransactionAction } from "./manual-transaction";
import {
  isOwnerFundingKind,
  isOwnerLoanRepaymentKind,
  type TransactionInput,
} from "./types";
import {
  isInvoiceEvidenceProfile,
  legacyArtifactProfile,
  type ArtifactProfile,
} from "../artifacts/profiles";

export interface EvidenceState {
  artifactProfile?: ArtifactProfile;
  /** @deprecated use artifactProfile; retained for existing in-process callers. */
  kind?: "pdf" | "stripe_csv";
  state: "pending" | "available" | "superseded" | "abandoned";
}

const evidenceProfile = (
  evidence: EvidenceState | null,
): ArtifactProfile | null => {
  if (!evidence) return null;
  if (evidence.artifactProfile) return evidence.artifactProfile;
  return evidence.kind ? legacyArtifactProfile(evidence.kind) : null;
};

export const dateToUtcMidnight = (date: string | null): string | null =>
  date ? `${date}T00:00:00.000Z` : null;

export const dateInputFromTimestamp = (timestamp: string | null): string =>
  timestamp?.slice(0, 10) ?? "";

export type FileSelectionState = "none" | "empty" | "ready";

export const fileSelectionState = (value: unknown): FileSelectionState => {
  if (!value || typeof value !== "object") return "none";
  const candidate = value as { name?: unknown; size?: unknown };
  if (typeof candidate.name !== "string" || !candidate.name.trim())
    return "none";
  return typeof candidate.size === "number" && candidate.size > 0
    ? "ready"
    : "empty";
};

export const invoiceDateToOccurredAt = dateToUtcMidnight;

export interface InvoiceDateOccurrenceDraft {
  occurredAtInput: string;
  suggestedInvoiceDate: string | null;
  operatorEdited: boolean;
}

export const applyInvoiceDateOccurrenceSuggestion = (
  draft: InvoiceDateOccurrenceDraft,
  invoiceDate: string | null,
): InvoiceDateOccurrenceDraft => {
  if (draft.operatorEdited) return { ...draft, suggestedInvoiceDate: null };
  if (draft.suggestedInvoiceDate !== null) {
    return {
      occurredAtInput: invoiceDate ?? "",
      suggestedInvoiceDate: invoiceDate,
      operatorEdited: false,
    };
  }
  if (!draft.occurredAtInput && invoiceDate) {
    return {
      occurredAtInput: invoiceDate,
      suggestedInvoiceDate: invoiceDate,
      operatorEdited: false,
    };
  }
  return draft;
};

export function assertTransactionRules(
  input: TransactionInput,
  gstRegistered: boolean,
  evidence: EvidenceState | null,
): void {
  if (isOwnerLoanRepaymentKind(input.kind) && !input.ownerId)
    throw new Error("Choose an owner");
  if (
    isOwnerLoanRepaymentKind(input.kind) &&
    input.settlementAmount !== null &&
    parseDecimal(input.settlementAmount) <= 0n
  ) {
    throw new Error(
      "Owner loan repayments require a positive settlement amount when supplied",
    );
  }
  if (isOwnerFundingKind(input.kind)) {
    if (input.taxTreatment !== "no_tax")
      throw new Error(
        isOwnerLoanRepaymentKind(input.kind)
          ? "Owner loan repayments must use no tax treatment"
          : "Owner contributions and loans must use no tax treatment",
      );
    if (input.documentTaxAmount && parseDecimal(input.documentTaxAmount) !== 0n)
      throw new Error(
        isOwnerLoanRepaymentKind(input.kind)
          ? "Owner loan repayments cannot have document tax"
          : "Owner contributions and loans cannot have document tax",
      );
    if (!["not_claimable", "not_registered"].includes(input.gstCreditStatus))
      throw new Error(
        isOwnerLoanRepaymentKind(input.kind)
          ? "Owner loan repayments must be not claimable or not registered"
          : "Owner contributions and loans must be not claimable or not registered",
      );
    if (input.claimableGstAud && parseDecimal(input.claimableGstAud) !== 0n)
      throw new Error(
        isOwnerLoanRepaymentKind(input.kind)
          ? "Owner loan repayments require zero claimable GST"
          : "Owner contributions and loans require zero claimable GST",
      );
  }
  if (!gstRegistered && input.gstCreditStatus === "claimable") {
    throw new Error(
      "GST credits are disabled while the business is not registered",
    );
  }
  if (
    input.sourceArtifactId &&
    (!isInvoiceEvidenceProfile(evidenceProfile(evidence)) ||
      evidence?.state !== "available")
  ) {
    throw new Error(
      "Manual transactions require an available PDF invoice artifact",
    );
  }
  if (
    input.gstCreditStatus === "claimable" &&
    (!isInvoiceEvidenceProfile(evidenceProfile(evidence)) ||
      evidence?.state !== "available")
  ) {
    throw new Error("Claimable GST requires an available PDF invoice");
  }
}

export function assertStatusTransition(
  current: "draft" | "recorded" | "void",
  next: "draft" | "recorded" | "void",
  action?: ManualTransactionAction,
): void {
  const actionMatchesStatus =
    action === undefined ||
    (action === "save_draft" && next === "draft") ||
    (action === "save_recorded" && next === "recorded") ||
    (action === "save_void" && next === "void") ||
    (action === "restore_draft" && next === "draft") ||
    (action === "restore_recorded" && next === "recorded");
  const explicitRestore =
    current === "void" &&
    ((action === "restore_draft" && next === "draft") ||
      (action === "restore_recorded" && next === "recorded"));
  const allowed =
    current === next ||
    (current === "draft" && next === "recorded") ||
    (current !== "void" && next === "void") ||
    explicitRestore;
  if (!allowed || !actionMatchesStatus)
    throw new Error(
      `Invalid transaction status transition: ${current} -> ${next}`,
    );
}

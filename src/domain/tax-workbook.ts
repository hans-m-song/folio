import { z } from "zod";

import { parseDecimal, sumDecimals } from "./money";
import {
  calculateTaxAdjustments,
  taxAdjustmentSchema,
  type TaxAdjustment,
} from "./tax-adjustments";
import {
  taxPartnerSelectionsSchema,
  type TaxPartnerOption,
  type TaxPartnerSelection,
} from "./tax-partners";
import type { TaxSourceReview } from "./tax-source-review";
import {
  buildTaxAttribution,
  type TaxAttributionResult,
  type TaxPartnerAttribution,
} from "./tax-attribution";

export const taxReviewInputSchema = z
  .object({
    financialYearStartYear: z.literal(2025),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    adjustments: z.array(taxAdjustmentSchema),
    partners: taxPartnerSelectionsSchema,
    reviewerAttestation: z.string().trim().min(20).max(2_000),
  })
  .strict();

export type TaxReviewInput = z.infer<typeof taxReviewInputSchema>;

interface ReviewedTaxSnapshotCommon {
  financialYearStartYear: number;
  financialYear: string;
  timezone: string;
  gstRegistered: false;
  cashLedger: TaxSourceReview["cashLedger"];
  bankRows: TaxSourceReview["bankRows"];
  humanAdjustments: TaxAdjustment[];
  totals: {
    sourceIncomeAud: string;
    sourceExpenseAud: string;
    reviewedIncomeAud: string;
    reviewedDeductibleExpenseAud: string;
    reviewedNetResultAud: string;
  };
  reviewerAttestation: string;
}

export type LegacyReviewedTaxSnapshot = ReviewedTaxSnapshotCommon & {
  modelVersion?: 1;
  sourceFingerprintVersion?: 1;
  partnerShares: Array<{
    label: string;
    percentage: string;
    amountAud: string;
  }>;
};

export type VersionedReviewedTaxSnapshot = ReviewedTaxSnapshotCommon & {
  modelVersion: 2;
  sourceFingerprintVersion: 2;
  partnerShares: TaxPartnerAttribution[];
  attribution: TaxAttributionResult;
};

export type ReviewedTaxSnapshot =
  | LegacyReviewedTaxSnapshot
  | VersionedReviewedTaxSnapshot;

export const buildReviewedTaxSnapshot = (
  source: TaxSourceReview,
  input: {
    adjustments: readonly TaxAdjustment[];
    partners: readonly TaxPartnerSelection[];
    reviewerAttestation: string;
  },
  partnerOptions: readonly TaxPartnerOption[],
) => {
  if (!source.readyForReview)
    throw new Error(
      "Resolve source exceptions before reviewing the tax worksheet",
    );
  const sourceTransactionIds = new Set(
    source.cashLedger.rows.map((row) => row.transactionId),
  );
  if (
    input.adjustments.some(
      (adjustment) =>
        adjustment.transactionId &&
        !sourceTransactionIds.has(adjustment.transactionId),
    )
  )
    throw new Error(
      "Linked adjustment transaction must be in the selected financial year source ledger",
    );
  const calculation = calculateTaxAdjustments({
    baseIncomeAud: source.cashLedger.totals.incomeEffectAud,
    baseDeductibleExpenseAud: source.cashLedger.totals.expenseEffectAud,
    adjustments: [...input.adjustments],
  });
  const attribution = buildTaxAttribution({
    rows: source.cashLedger.rows,
    adjustments: calculation.adjustments,
    partners: input.partners,
    partnerOptions,
  });
  const allocatedIncome = sumDecimals(
    attribution.partners.map(({ finalIncomeAud }) => finalIncomeAud),
  );
  const allocatedExpense = sumDecimals(
    attribution.partners.map(({ finalExpenseAud }) => finalExpenseAud),
  );
  if (
    allocatedIncome !== calculation.adjustedIncomeAud ||
    allocatedExpense !== calculation.adjustedDeductibleExpenseAud ||
    attribution.partners.some(
      ({ finalIncomeAud, finalExpenseAud, netAud }) =>
        parseDecimal(finalIncomeAud) - parseDecimal(finalExpenseAud) !==
        parseDecimal(netAud),
    )
  )
    throw new Error(
      "Tax partner attribution does not reconcile to reviewed totals",
    );
  return {
    modelVersion: 2 as const,
    sourceFingerprintVersion: 2 as const,
    financialYearStartYear: source.financialYearStartYear,
    financialYear: source.financialYear,
    timezone: source.timezone,
    gstRegistered: false as const,
    cashLedger: source.cashLedger,
    bankRows: source.bankRows,
    humanAdjustments: calculation.adjustments,
    partnerShares: attribution.partners,
    attribution,
    totals: {
      sourceIncomeAud: calculation.baseIncomeAud,
      sourceExpenseAud: calculation.baseDeductibleExpenseAud,
      reviewedIncomeAud: calculation.adjustedIncomeAud,
      reviewedDeductibleExpenseAud: calculation.adjustedDeductibleExpenseAud,
      reviewedNetResultAud: calculation.netResultAud,
    },
    reviewerAttestation: input.reviewerAttestation.trim(),
  };
};

const csvCell = (value: string | number | null | undefined): string => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe =
    /^[=+@-]/.test(raw) && !/^-\d+(?:\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export const taxSourceReviewCsv = (source: TaxSourceReview): string => {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "row_type",
      "id",
      "cash_or_posted_date",
      "reference",
      "description",
      "review_state",
      "income_aud",
      "expense_aud",
      "cash_aud",
      "issues",
    ],
    [
      "preparation_only",
      "",
      "",
      source.financialYear,
      `Unreviewed source ledger; not partnership taxable income; reporting timezone ${source.timezone}`,
      source.readyForReview ? "ready_for_review" : "incomplete",
      source.cashLedger.totals.incomeEffectAud,
      source.cashLedger.totals.expenseEffectAud,
      source.cashLedger.totals.cashEffectAud,
      "",
    ],
    ...source.cashLedger.rows.map((row) => [
      "source_transaction",
      row.transactionId,
      row.cashDate,
      row.reference,
      row.description,
      row.disposition,
      row.incomeEffectAud,
      row.expenseEffectAud,
      row.cashEffectAud,
      row.issues.join("; "),
    ]),
    ...source.bankRows.map((row) => [
      "bank_review",
      row.id,
      row.postedDate,
      "",
      "",
      row.reviewState,
      "",
      "",
      "",
      "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
};

const legacyReviewedTaxSnapshotCsv = (
  snapshot: LegacyReviewedTaxSnapshot,
  metadata?: { id: string; reviewedAt: string },
): string => {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "row_type",
      "id",
      "date",
      "reference_or_label",
      "description_or_reason",
      "status_or_direction",
      "income_aud",
      "expense_aud",
      "cash_aud",
      "amount_aud",
      "percentage",
    ],
    [
      "review_metadata",
      metadata?.id ?? "",
      metadata?.reviewedAt ?? "",
      snapshot.financialYear,
      `Saved review version; reporting timezone ${snapshot.timezone}`,
      "reviewed",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "review_attestation",
      "",
      "",
      "",
      snapshot.reviewerAttestation,
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "reviewed_total",
      "",
      "",
      snapshot.financialYear,
      "Reviewed partnership net result; not tax payable",
      "reviewed",
      snapshot.totals.reviewedIncomeAud,
      snapshot.totals.reviewedDeductibleExpenseAud,
      "",
      snapshot.totals.reviewedNetResultAud,
      "",
    ],
    ...snapshot.cashLedger.rows.map((row) => [
      "source_transaction",
      row.transactionId,
      row.cashDate,
      row.reference,
      row.description,
      row.disposition,
      row.incomeEffectAud,
      row.expenseEffectAud,
      row.cashEffectAud,
      "",
      "",
    ]),
    ...snapshot.bankRows.map((row) => [
      "bank_review",
      row.id,
      row.postedDate,
      "",
      "",
      row.reviewState,
      "",
      "",
      "",
      "",
      "",
    ]),
    ...snapshot.humanAdjustments.map((adjustment) => [
      "tax_adjustment",
      adjustment.id,
      "",
      adjustment.transactionId ?? "",
      adjustment.reason,
      adjustment.direction,
      "",
      "",
      "",
      adjustment.amountAud,
      "",
    ]),
    ...snapshot.partnerShares.map((partner) => [
      "partner_share",
      "",
      "",
      partner.label,
      "",
      "",
      "",
      "",
      "",
      partner.amountAud,
      partner.percentage,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
};

export const taxSnapshotModelVersion = (snapshot: unknown): 1 | 2 => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Reviewed tax snapshot is invalid");
  const record = snapshot as Record<string, unknown>;
  const modelVersion = record.modelVersion;
  const sourceFingerprintVersion = record.sourceFingerprintVersion;

  if (
    (modelVersion === undefined || modelVersion === 1) &&
    (sourceFingerprintVersion === undefined || sourceFingerprintVersion === 1)
  )
    return 1;
  if (modelVersion === 2 && sourceFingerprintVersion === 2) return 2;
  throw new Error("Unsupported reviewed tax snapshot version");
};

const versionedReviewedTaxSnapshotCsv = (
  snapshot: VersionedReviewedTaxSnapshot,
  metadata?: { id: string; reviewedAt: string },
): string => {
  const componentColumns = [
    "direct_income_aud",
    "direct_expense_aud",
    "business_income_aud",
    "business_expense_aud",
    "final_income_aud",
    "final_expense_aud",
    "final_net_aud",
  ];
  const addComponents = (
    row: Array<string | number | null | undefined>,
    components: Array<string | number | null | undefined> = [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
  ) => [...row, ...components];
  const rows: Array<Array<string | number | null | undefined>> = [
    addComponents(
      [
        "row_type",
        "id",
        "date",
        "reference_or_label",
        "description_or_reason",
        "status_or_direction",
        "income_aud",
        "expense_aud",
        "cash_aud",
        "amount_aud",
        "percentage",
      ],
      componentColumns,
    ),
    addComponents([
      "review_metadata",
      metadata?.id ?? "",
      metadata?.reviewedAt ?? "",
      snapshot.financialYear,
      `Saved review version; reporting timezone ${snapshot.timezone}`,
      "reviewed",
      "",
      "",
      "",
      "",
      "",
    ]),
    addComponents([
      "review_attestation",
      "",
      "",
      "",
      snapshot.reviewerAttestation,
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
    addComponents([
      "reviewed_total",
      "",
      "",
      snapshot.financialYear,
      "Reviewed partnership net result; not tax payable",
      "reviewed",
      snapshot.totals.reviewedIncomeAud,
      snapshot.totals.reviewedDeductibleExpenseAud,
      "",
      snapshot.totals.reviewedNetResultAud,
      "",
    ]),
    ...snapshot.cashLedger.rows.map((row) =>
      addComponents([
        "source_transaction",
        row.transactionId,
        row.cashDate,
        row.reference,
        row.description,
        row.disposition,
        row.incomeEffectAud,
        row.expenseEffectAud,
        row.cashEffectAud,
        "",
        "",
      ]),
    ),
    ...snapshot.bankRows.map((row) =>
      addComponents([
        "bank_review",
        row.id,
        row.postedDate,
        "",
        "",
        row.reviewState,
        "",
        "",
        "",
        "",
        "",
      ]),
    ),
    ...snapshot.humanAdjustments.map((adjustment) =>
      addComponents([
        "tax_adjustment",
        adjustment.id,
        "",
        adjustment.transactionId ?? "",
        adjustment.reason,
        adjustment.direction,
        "",
        "",
        "",
        adjustment.amountAud,
        "",
      ]),
    ),
  ];

  const sourceRows = new Map(
    snapshot.cashLedger.rows.map((row) => [row.transactionId, row]),
  );
  const partnerLabels = new Map(
    snapshot.partnerShares.map((partner) => [partner.userId, partner.label]),
  );
  rows.push(
    ...snapshot.attribution.sources.map((attribution) => {
      const row = sourceRows.get(attribution.transactionId);
      return addComponents(
        [
          "source_attribution",
          attribution.transactionId,
          row?.cashDate ?? "",
          row?.reference ?? "",
          row?.description ?? "",
          attribution.classification === "direct"
            ? `Direct · ${partnerLabels.get(attribution.partnerUserId!)}`
            : "Business shared",
          attribution.incomeEffectAud,
          attribution.expenseEffectAud,
          row?.cashEffectAud ?? "",
          "",
          "",
        ],
        [
          attribution.directIncomeAud,
          attribution.directExpenseAud,
          attribution.businessIncomeAud,
          attribution.businessExpenseAud,
          "",
          "",
          "",
        ],
      );
    }),
    ...snapshot.attribution.adjustments.map((attribution) =>
      addComponents(
        [
          "adjustment_attribution",
          attribution.id,
          "",
          attribution.transactionId ?? "",
          snapshot.humanAdjustments.find(({ id }) => id === attribution.id)
            ?.reason ?? "",
          attribution.classification === "direct"
            ? `Direct · ${partnerLabels.get(attribution.partnerUserId!)}`
            : "Business shared",
          attribution.incomeEffectAud,
          attribution.expenseEffectAud,
          "",
          attribution.amountAud,
          "",
        ],
        [
          attribution.classification === "direct"
            ? attribution.incomeEffectAud
            : "0.0000",
          attribution.classification === "direct"
            ? attribution.expenseEffectAud
            : "0.0000",
          attribution.classification === "business"
            ? attribution.incomeEffectAud
            : "0.0000",
          attribution.classification === "business"
            ? attribution.expenseEffectAud
            : "0.0000",
          "",
          "",
          "",
        ],
      ),
    ),
    addComponents(
      [
        "business_pool",
        "",
        "",
        "Business shared",
        "Pool before partner percentages",
        "shared",
        snapshot.attribution.businessPool.incomeAud,
        snapshot.attribution.businessPool.expenseAud,
        "",
        snapshot.attribution.businessPool.netAud,
        "",
      ],
      [
        "",
        "",
        snapshot.attribution.businessPool.incomeAud,
        snapshot.attribution.businessPool.expenseAud,
        "",
        "",
        "",
      ],
    ),
    ...snapshot.partnerShares.map((partner) =>
      addComponents(
        [
          "partner_share",
          partner.userId,
          "",
          partner.label,
          "Direct plus Business share",
          "reviewed",
          "",
          "",
          "",
          partner.netAud,
          partner.percentage,
        ],
        [
          partner.directIncomeAud,
          partner.directExpenseAud,
          partner.businessIncomeAud,
          partner.businessExpenseAud,
          partner.finalIncomeAud,
          partner.finalExpenseAud,
          partner.netAud,
        ],
      ),
    ),
  );

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
};

export const reviewedTaxSnapshotCsv = (
  snapshot: ReviewedTaxSnapshot,
  metadata?: { id: string; reviewedAt: string },
): string =>
  taxSnapshotModelVersion(snapshot) === 2
    ? versionedReviewedTaxSnapshotCsv(
        snapshot as VersionedReviewedTaxSnapshot,
        metadata,
      )
    : legacyReviewedTaxSnapshotCsv(
        snapshot as LegacyReviewedTaxSnapshot,
        metadata,
      );

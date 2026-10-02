import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { buildFinancialYearCashLedger } from "../domain/reports";
import { buildOwnerFundingSummary } from "../domain/owner-funding";
import { FolioDiagnosticError } from "../domain/diagnostics";
import { buildTaxSourceReview } from "../domain/tax-source-review";
import {
  buildReviewedTaxSnapshot,
  reviewedTaxSnapshotCsv,
  taxSourceReviewCsv,
  taxSnapshotModelVersion,
  taxReviewInputSchema,
  type ReviewedTaxSnapshot,
} from "../domain/tax-workbook";
import {
  operationPermissions,
  requirePermission,
  resolveAuthorizedActor,
} from "./authorization";
import { runOperation } from "./diagnostics";
import { runtime } from "./runtime";

const financialYearSchema = z
  .object({ financialYearStartYear: z.literal(2025) })
  .strict();

const authorizedRuntime = async (
  operation: keyof Pick<
    typeof operationPermissions,
    | "getTaxWorksheet"
    | "getTaxPartnerOptions"
    | "exportTaxSource"
    | "reviewTaxWorksheet"
    | "exportTaxWorksheet"
  >,
) => {
  const current = runtime();
  const required = operationPermissions[operation];
  const actor = await resolveAuthorizedActor({
    token: getCookie(current.authConfig.sessionCookieName) ?? null,
    permission: required[0],
    session: (token) => current.auth.session(token),
  });
  for (const permission of required.slice(1))
    requirePermission(actor, permission);
  return { actor, current };
};

export const getTaxPartnerOptions = createServerFn({ method: "GET" }).handler(
  async () =>
    runOperation("List active tax partner options", async () => {
      const { actor, current } = await authorizedRuntime(
        "getTaxPartnerOptions",
      );
      return current.repository.listTaxPartnerOptions(actor.id);
    }),
);

const loadSourceRecords = async (
  current: ReturnType<typeof runtime>,
  actorId: string,
  financialYearStartYear: number,
) => {
  const [transactions, bankRows] = await Promise.all([
    current.repository.listTransactions(actorId),
    current.bankRepository.financialYearReviewRows(
      actorId,
      financialYearStartYear,
    ),
  ]);
  return {
    ledger: buildFinancialYearCashLedger(
      transactions,
      financialYearStartYear,
      current.config.reportingTimezone,
    ),
    bankRows,
  };
};

const loadSourceReview = async (
  current: ReturnType<typeof runtime>,
  actorId: string,
  financialYearStartYear: number,
) => {
  const { ledger, bankRows } = await loadSourceRecords(
    current,
    actorId,
    financialYearStartYear,
  );
  return buildTaxSourceReview(ledger, bankRows);
};

export const getTaxWorksheet = createServerFn({ method: "GET" })
  .validator(financialYearSchema)
  .handler(async ({ data }) =>
    runOperation("Load tax worksheet", async () => {
      const { actor, current } = await authorizedRuntime("getTaxWorksheet");
      const [records, snapshots] = await Promise.all([
        loadSourceRecords(current, actor.id, data.financialYearStartYear),
        current.taxReviewRepository.listReviewedSnapshots<ReviewedTaxSnapshot>(
          actor.id,
        ),
      ]);
      const source = buildTaxSourceReview(records.ledger, records.bankRows);
      const yearSnapshots = snapshots.filter(
        (snapshot) =>
          snapshot.financialYearStartYear === data.financialYearStartYear,
      );
      const latest = yearSnapshots[0] ?? null;
      const latestModelVersion = latest
        ? taxSnapshotModelVersion(latest.snapshot)
        : null;
      return {
        source,
        ownerFunding: buildOwnerFundingSummary(records.ledger),
        latest,
        latestIsCurrent:
          latest !== null &&
          latest.sourceFingerprint ===
            (latestModelVersion === 1
              ? source.legacyFingerprint
              : source.fingerprint),
        reviewedVersionCount: yearSnapshots.length,
      };
    }),
  );

export const exportTaxSource = createServerFn({ method: "GET" })
  .validator(financialYearSchema)
  .handler(async ({ data }) =>
    runOperation("Export tax source ledger", async () => {
      const { actor, current } = await authorizedRuntime("exportTaxSource");
      const source = await loadSourceReview(
        current,
        actor.id,
        data.financialYearStartYear,
      );
      return {
        filename: `folio-${data.financialYearStartYear}-${data.financialYearStartYear + 1}-cash-source-ledger.csv`,
        mediaType: "text/csv;charset=utf-8",
        content: taxSourceReviewCsv(source),
      };
    }),
  );

export const reviewTaxWorksheet = createServerFn({ method: "POST" })
  .validator(taxReviewInputSchema)
  .handler(async ({ data }) =>
    runOperation("Review tax worksheet", async () => {
      const { actor, current } = await authorizedRuntime("reviewTaxWorksheet");
      const [source, partnerOptions] = await Promise.all([
        loadSourceReview(current, actor.id, data.financialYearStartYear),
        current.repository.listTaxPartnerOptions(actor.id),
      ]);
      if (source.fingerprint !== data.sourceFingerprint)
        throw new FolioDiagnosticError({
          category: "validation",
          code: "TAX_SOURCE_CHANGED",
          retryable: true,
          httpStatus: 409,
        });
      if (!source.readyForReview)
        throw new FolioDiagnosticError({
          category: "validation",
          code: "TAX_SOURCE_INCOMPLETE",
          retryable: false,
          httpStatus: 409,
        });
      const activePartnerIds = new Set(partnerOptions.map(({ id }) => id));
      if (data.partners.some(({ userId }) => !activePartnerIds.has(userId)))
        throw new FolioDiagnosticError({
          category: "validation",
          code: "TAX_PARTNER_INACTIVE",
          retryable: false,
          httpStatus: 422,
        });
      const snapshot = buildReviewedTaxSnapshot(source, data, partnerOptions);
      return current.taxReviewRepository.createReviewedSnapshot(actor.id, {
        financialYearStartYear: data.financialYearStartYear,
        snapshot,
        sourceFingerprint: source.fingerprint,
      });
    }),
  );

export const exportTaxWorksheet = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        snapshotId: z.string().uuid(),
        format: z.enum(["csv", "json"]),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation("Export tax worksheet", async () => {
      const { actor, current } = await authorizedRuntime("exportTaxWorksheet");
      const record =
        await current.taxReviewRepository.getReviewedSnapshot<ReviewedTaxSnapshot>(
          actor.id,
          data.snapshotId,
        );
      if (!record)
        throw new FolioDiagnosticError({
          category: "validation",
          code: "TAX_REVIEW_NOT_FOUND",
          retryable: false,
          httpStatus: 404,
        });
      const source = await loadSourceReview(
        current,
        actor.id,
        record.financialYearStartYear,
      );
      const modelVersion = taxSnapshotModelVersion(record.snapshot);
      const currentFingerprint =
        modelVersion === 1 ? source.legacyFingerprint : source.fingerprint;
      if (currentFingerprint !== record.sourceFingerprint)
        throw new FolioDiagnosticError({
          category: "validation",
          code: "TAX_REVIEW_STALE",
          retryable: false,
          httpStatus: 409,
        });
      const filename = `folio-${record.financialYearStartYear}-${record.financialYearStartYear + 1}-reviewed-partnership-tax.${data.format}`;
      return {
        filename,
        mediaType:
          data.format === "csv" ? "text/csv;charset=utf-8" : "application/json",
        content:
          data.format === "csv"
            ? reviewedTaxSnapshotCsv(record.snapshot, {
                id: record.id,
                reviewedAt: record.reviewedAt,
              })
            : JSON.stringify(record, null, 2),
      };
    }),
  );

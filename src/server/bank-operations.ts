import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { parseCommBankTransactionHistoryCsv } from "../domain/bank-profiles/commbank-transaction-history-v1";
import { bankReconciliationCommandSchema } from "../domain/bank-transactions";
import {
  commBankDuplicateIdentities,
  stripeDuplicateIdentities,
} from "../domain/csv-duplicates";
import { parseStripeBalanceCsv } from "../domain/stripe-csv";
import {
  operationPermissions,
  permissions,
  requirePermission,
  resolveAuthorizedActor,
  type Permission,
} from "./authorization";
import {
  manualTransactionInputSchema,
  safeManualTransactionServerIssues,
} from "../domain/manual-transaction";
import { runOperation } from "./diagnostics";
import { runtime } from "./runtime";

const commbankProfile = "commbank_transaction_history_csv_v1" as const;
const stripeProfile = "stripe_balance_itemised_csv_v1" as const;

const authorize = async (required: readonly Permission[]) => {
  const current = runtime();
  const actor = await resolveAuthorizedActor({
    token: getCookie(current.authConfig.sessionCookieName) ?? null,
    permission: required[0]!,
    session: (token) => current.auth.session(token),
  });
  for (const permission of required.slice(1))
    requirePermission(actor, permission);
  return { actor, current };
};

export const previewBankCsv = createServerFn({ method: "POST" })
  .validator(z.object({ artifactId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation("Preview CommBank CSV", async () => {
      const { actor, current } = await authorize(
        operationPermissions.previewBankCsv,
      );
      const object = await current.documents.readReviewText(
        actor.id,
        data.artifactId,
        commbankProfile,
      );
      return parseCommBankTransactionHistoryCsv(object.text);
    }),
  );

export const getCsvDuplicateWarnings = createServerFn({ method: "POST" })
  .validator(z.object({ artifactId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation("Check CSV duplicate warnings", async () => {
      const { actor, current } = await authorize(
        operationPermissions.listArtifacts,
      );
      const artifact = await current.repository.getArtifact(data.artifactId);
      const profile = artifact?.artifactProfile;
      if (profile !== stripeProfile && profile !== commbankProfile)
        throw new Error("Reviewable CSV artifact not found");

      requirePermission(
        actor,
        profile === stripeProfile
          ? permissions.stripeImport
          : permissions.bankActivityImport,
      );
      const object = await current.documents.readReviewText(
        actor.id,
        data.artifactId,
        profile,
      );
      const identities =
        profile === stripeProfile
          ? stripeDuplicateIdentities(
              parseStripeBalanceCsv(object.text, {
                reportingTimezone: current.config.reportingTimezone,
              }),
            )
          : commBankDuplicateIdentities(
              parseCommBankTransactionHistoryCsv(object.text).rows,
            );
      return current.repository.findCsvDuplicateWarnings(
        actor.id,
        data.artifactId,
        profile,
        identities,
      );
    }),
  );

export const confirmBankImport = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        artifactId: z.string().uuid(),
        acknowledgedOverlapFingerprint: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .nullable()
          .default(null),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Confirm CommBank import",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.confirmBankImport,
        );
        const artifact = await current.repository.getArtifact(data.artifactId);
        if (
          artifact?.state === "available" &&
          artifact.artifactProfile === commbankProfile
        )
          return current.bankRepository.confirmImport({
            actorId: actor.id,
            artifactId: data.artifactId,
            versionId: artifact.versionId ?? "",
            rows: [],
            earliestDate: "1970-01-01",
            latestDate: "1970-01-01",
            acknowledgedOverlapFingerprint: data.acknowledgedOverlapFingerprint,
          });
        const object = await current.documents.readReviewText(
          actor.id,
          data.artifactId,
          commbankProfile,
        );
        const preview = parseCommBankTransactionHistoryCsv(object.text);
        if (
          preview.errors.length ||
          !preview.rows.length ||
          !preview.earliestDate ||
          !preview.latestDate
        )
          return { status: "invalid" as const, errors: preview.errors };
        return current.bankRepository.confirmImport({
          actorId: actor.id,
          artifactId: data.artifactId,
          versionId: object.versionId,
          rows: preview.rows,
          earliestDate: preview.earliestDate,
          latestDate: preview.latestDate,
          acknowledgedOverlapFingerprint: data.acknowledgedOverlapFingerprint,
        });
      },
      {},
      { mutation: true },
    ),
  );

export const cancelBankImport = createServerFn({ method: "POST" })
  .validator(z.object({ artifactId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Cancel CommBank import",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.cancelBankImport,
        );
        await current.documents.rejectArtifact(actor.id, data.artifactId);
        return { status: "rejected" as const };
      },
      {},
      { mutation: true },
    ),
  );

const pageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

const queryTextOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
]);
const queryComparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]);
const queryEnumOperatorSchema = z.enum(["is", "is_not"]);
const queryEnumMembershipOperatorSchema = z.enum([
  "contains_any",
  "contains_none",
]);
const bankReviewStateValues = [
  "unresolved",
  "matched",
  "private",
  "transfer",
  "duplicate",
] as const;
const bankReviewStateSchema = z.enum(bankReviewStateValues);
const bankMatchStatusValues = ["matched", "unmatched"] as const;
const bankMatchStatusSchema = z.enum(bankMatchStatusValues);
const bankImportStateValues = [
  "pending",
  "awaiting_review",
  "available",
  "rejected",
  "abandoned",
  "superseded",
] as const;
const bankImportStateSchema = z.enum(bankImportStateValues);
const queryDateValueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    );
  });
const queryNumberValueSchema = z
  .string()
  .max(48)
  .regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/);
const queryCountValueSchema = z.string().max(12).regex(/^\d+$/);
const queryTextValueSchema = z.string().trim().min(1).max(200);

const bankActivityFilterSchema = z.union([
  z
    .object({
      field: z.literal("postedDate"),
      operator: queryComparisonOperatorSchema,
      value: queryDateValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("description"),
      operator: queryTextOperatorSchema,
      value: queryTextValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("amountAud"),
      operator: queryComparisonOperatorSchema,
      value: queryNumberValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("reviewState"),
      operator: queryEnumOperatorSchema,
      value: bankReviewStateSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("reviewState"),
      operator: queryEnumMembershipOperatorSchema,
      value: z.array(bankReviewStateSchema).max(bankReviewStateValues.length),
    })
    .strict(),
  z
    .object({
      field: z.literal("matchStatus"),
      operator: queryEnumOperatorSchema,
      value: bankMatchStatusSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("matchStatus"),
      operator: queryEnumMembershipOperatorSchema,
      value: z.array(bankMatchStatusSchema).max(bankMatchStatusValues.length),
    })
    .strict(),
]);

const bankImportFilterSchema = z.union([
  z
    .object({
      field: z.literal("filename"),
      operator: queryTextOperatorSchema,
      value: queryTextValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("earliestDate"),
      operator: queryComparisonOperatorSchema,
      value: queryDateValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("latestDate"),
      operator: queryComparisonOperatorSchema,
      value: queryDateValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("rowCount"),
      operator: queryComparisonOperatorSchema,
      value: queryCountValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("reviewedCount"),
      operator: queryComparisonOperatorSchema,
      value: queryCountValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("unresolvedCount"),
      operator: queryComparisonOperatorSchema,
      value: queryCountValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("state"),
      operator: queryEnumOperatorSchema,
      value: bankImportStateSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("state"),
      operator: queryEnumMembershipOperatorSchema,
      value: z.array(bankImportStateSchema).max(bankImportStateValues.length),
    })
    .strict(),
]);

const bankActivitySortSchema = z
  .array(
    z
      .object({
        key: z.enum([
          "postedDate",
          "description",
          "amountAud",
          "reviewState",
          "matchStatus",
        ]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict(),
  )
  .max(5)
  .superRefine((clauses, context) => {
    const keys = new Set<string>();
    clauses.forEach(({ key }, index) => {
      if (keys.has(key))
        context.addIssue({
          code: "custom",
          path: [index, "key"],
          message: "Sort fields must be unique",
        });
      keys.add(key);
    });
  });

const bankImportSortSchema = z
  .array(
    z
      .object({
        key: z.enum([
          "filename",
          "earliestDate",
          "latestDate",
          "rowCount",
          "reviewedCount",
          "unresolvedCount",
          "state",
        ]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict(),
  )
  .max(7)
  .superRefine((clauses, context) => {
    const keys = new Set<string>();
    clauses.forEach(({ key }, index) => {
      if (keys.has(key))
        context.addIssue({
          code: "custom",
          path: [index, "key"],
          message: "Sort fields must be unique",
        });
      keys.add(key);
    });
  });

const bankImportsListSchema = pageSchema.extend({
  filters: z.array(bankImportFilterSchema).max(20).default([]),
  sort: bankImportSortSchema.default([]),
});
const bankTransactionsListSchema = pageSchema.extend({
  artifactId: z.string().uuid().optional(),
  state: z
    .enum(["unresolved", "matched", "private", "transfer", "duplicate"])
    .optional(),
  filters: z.array(bankActivityFilterSchema).max(20).default([]),
  sort: bankActivitySortSchema.default([]),
});

export const listBankImports = createServerFn({ method: "GET" })
  .validator(bankImportsListSchema)
  .handler(async ({ data }) =>
    runOperation("List bank imports", async () => {
      const { actor, current } = await authorize(
        operationPermissions.listBankImports,
      );
      return current.bankRepository.listImports(actor.id, data);
    }),
  );

export const listBankTransactions = createServerFn({ method: "GET" })
  .validator(bankTransactionsListSchema)
  .handler(async ({ data }) =>
    runOperation("List bank activity", async () => {
      const { actor, current } = await authorize(
        operationPermissions.listBankTransactions,
      );
      return current.bankRepository.listTransactions(actor.id, data);
    }),
  );

const reconciliationQuerySchema = z
  .object({
    bankTransactionId: z.string().uuid().optional(),
    artifactId: z.string().uuid().optional(),
    unresolvedOnly: z.boolean().default(false),
    windowDays: z.union([z.literal(14), z.literal(31), z.null()]).default(14),
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const getBankReconciliation = createServerFn({ method: "GET" })
  .validator(reconciliationQuerySchema)
  .handler(async ({ data }) =>
    runOperation("Load bank reconciliation", async () => {
      const { actor, current } = await authorize(
        operationPermissions.getBankReconciliation,
      );
      const [rows, counts, users, entrySuggestions, availableArtifacts] =
        await Promise.all([
          current.bankRepository.listTransactions(actor.id, {
            limit: 100,
            offset: data.offset,
            artifactId: data.artifactId,
            state: data.unresolvedOnly ? "unresolved" : undefined,
          }),
          current.bankRepository.reconciliationCounts(
            actor.id,
            data.artifactId,
          ),
          current.repository.listUsers(actor.id),
          current.repository.listEntrySuggestions(actor.id),
          current.repository.listAvailableInvoiceArtifacts(actor.id),
        ]);
      const selectedId =
        data.bankTransactionId ??
        rows.find((row) => row.reviewState === "unresolved")?.id ??
        rows[0]?.id;
      const detail = selectedId
        ? await current.bankRepository.reconciliationDetail(
            actor.id,
            selectedId,
            data.windowDays,
            data.artifactId,
          )
        : null;
      const suggestions =
        detail && selectedId
          ? await current.proposalRepository.listSuggestionsForBankRow(
              selectedId,
            )
          : [];
      return {
        actorId: actor.id,
        rows,
        counts,
        detail,
        suggestions,
        users,
        entrySuggestions,
        availableArtifacts,
        gstRegistered: current.config.gstRegistered,
      };
    }),
  );

const nextReconciliationQuerySchema = z
  .object({
    bankTransactionId: z.string().uuid(),
    artifactId: z.string().uuid().optional(),
    unresolvedOnly: z.boolean(),
  })
  .strict();

export const getNextBankReconciliation = createServerFn({ method: "GET" })
  .validator(nextReconciliationQuerySchema)
  .handler(async ({ data }) =>
    runOperation("Select next unresolved bank row", async () => {
      const { actor, current } = await authorize(
        operationPermissions.getNextBankReconciliation,
      );
      return current.bankRepository.nextReconciliationTarget(
        actor.id,
        data.bankTransactionId,
        data.artifactId,
        data.unresolvedOnly,
      );
    }),
  );

export const reconcileBankTransaction = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        bankTransactionId: z.string().uuid(),
        expectedRevision: z.string().regex(/^\d+$/),
        command: bankReconciliationCommandSchema,
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Reconcile bank transaction",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.reconcileBankTransaction,
        );
        return current.bankRepository.reconcile({ actorId: actor.id, ...data });
      },
      {},
      { mutation: true },
    ),
  );

const createAndMatchSchema = z
  .object({
    bankTransactionId: z.string().uuid(),
    expectedRevision: z.string().regex(/^\d+$/),
    transactionId: z.string().uuid(),
    transaction: manualTransactionInputSchema,
    artifactIds: z.array(z.string().uuid()).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.transaction.status !== "recorded")
      context.addIssue({
        code: "custom",
        path: ["transaction", "status"],
        message: "Created bank matches must be recorded",
      });
  });

export const createAndMatchBankTransaction = createServerFn({ method: "POST" })
  .validator(z.unknown())
  .handler(async ({ data }) =>
    runOperation(
      "Create and match bank transaction",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.createAndMatchBankTransaction,
        );
        const parsed = createAndMatchSchema.safeParse(data);
        if (!parsed.success)
          return {
            status: "invalid" as const,
            issues: safeManualTransactionServerIssues(parsed.error),
          };
        return current.bankRepository.createAndMatch({
          actorId: actor.id,
          ...parsed.data,
        });
      },
      {},
      { mutation: true },
    ),
  );

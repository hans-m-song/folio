import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { invoiceStatusSchema } from "../domain/invoice-status";

import {
  artifactProfileSchema,
  isBankArtifactProfile,
} from "../artifacts/profiles";
import { buildBalanceSeries, buildReport, reportCsv } from "../domain/reports";
import {
  manualTransactionSavePayloadSchema,
  safeManualTransactionServerIssues,
} from "../domain/manual-transaction";
import {
  classifyStripeReportingCategory,
  parseStripeBalanceCsv,
  type StripeImportPreview,
  type StripeImportPreviewRow,
} from "../domain/stripe-csv";
import {
  transactionKindSchema,
  transactionStatusSchema,
  userRoleSchema,
} from "../domain/types";
import type { ClientRenderFailure } from "../domain/diagnostics";
import {
  operationPermissions,
  permissions,
  requirePermission,
  resolveAuthorizedActor,
  type Permission,
} from "./authorization";
import { runOperation, writeClientRenderFailure } from "./diagnostics";
import { runtime } from "./runtime";
import { enumFilterSchema } from "../domain/enum-filter";
import { bulkTransactionRequestSchema } from "../domain/bulk-transactions";

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

const clientRenderFailureNameSchema = z.enum([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

const clientRenderFailureSchema = z.discriminatedUnion("code", [
  z
    .object({
      name: clientRenderFailureNameSchema,
      code: z.literal("CLIENT_RENDER_FAILURE"),
      message: z.enum([
        "Cannot read properties of undefined",
        "Cannot read properties of null",
        "A function call failed",
        "A React render invariant failed",
        "Client render failed",
      ]),
    })
    .strict(),
  z
    .object({
      name: z.literal("TypeError"),
      code: z.literal("CLIENT_RENDER_TRIM_NOT_STRING"),
      message: z.literal("trim is not a function; the value is not a string"),
    })
    .strict(),
]);

const clientRenderFailureLimit = 5;
const clientRenderFailureWindowMs = 60_000;
const clientRenderFailureWindows = new Map<
  string,
  { startedAt: number; count: number }
>();

const canReportClientRenderFailure = (actorId: string): boolean => {
  const now = Date.now();
  const window = clientRenderFailureWindows.get(actorId);
  if (!window || now - window.startedAt >= clientRenderFailureWindowMs) {
    clientRenderFailureWindows.set(actorId, { startedAt: now, count: 1 });
    return true;
  }
  if (window.count >= clientRenderFailureLimit) return false;
  window.count += 1;
  return true;
};

const transactionComparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]);

export const transactionPageQuerySchema = z
  .object({
    search: z.string().trim().max(200).default(""),
    filters: z
      .array(
        z
          .discriminatedUnion("field", [
            z
              .object({
                field: z.enum(["counterparty", "description"]),
                operator: z.enum([
                  "equals",
                  "not_equals",
                  "contains",
                  "not_contains",
                ]),
                value: z.string().trim().min(1).max(2_000),
              })
              .strict(),
            z
              .object({
                field: z.literal("date"),
                operator: transactionComparisonOperatorSchema,
                value: z.string().date(),
              })
              .strict(),
            z
              .object({
                field: z.literal("amount"),
                operator: transactionComparisonOperatorSchema,
                value: z
                  .string()
                  .trim()
                  .min(1)
                  .max(100)
                  .regex(
                    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/,
                    "Expected a number",
                  )
                  .refine((value) => Number.isFinite(Number(value)), {
                    message: "Expected a finite number",
                  }),
              })
              .strict(),
            z
              .object({
                field: z.literal("kind"),
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains_any",
                  "contains_none",
                ]),
                value: z.union([
                  transactionKindSchema,
                  z.array(transactionKindSchema).max(20),
                ]),
              })
              .strict(),
            z
              .object({
                field: z.literal("status"),
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains_any",
                  "contains_none",
                ]),
                value: z.union([
                  transactionStatusSchema,
                  z.array(transactionStatusSchema).max(20),
                ]),
              })
              .strict(),
            z
              .object({
                field: z.literal("source"),
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains_any",
                  "contains_none",
                ]),
                value: z.union([
                  z.enum(["manual", "stripe"]),
                  z.array(z.enum(["manual", "stripe"])).max(20),
                ]),
              })
              .strict(),
            z
              .object({
                field: z.literal("settlement"),
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains_any",
                  "contains_none",
                ]),
                value: z.union([
                  z.enum(["settled", "pending", "not_applicable"]),
                  z
                    .array(z.enum(["settled", "pending", "not_applicable"]))
                    .max(20),
                ]),
              })
              .strict(),
            z
              .object({
                field: z.literal("evidence"),
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains_any",
                  "contains_none",
                ]),
                value: z.union([
                  z.enum(["attached", "missing"]),
                  z.array(z.enum(["attached", "missing"])).max(20),
                ]),
              })
              .strict(),
            z
              .object({
                field: z.literal("invoice"),
                operator: z.enum([
                  "is",
                  "is_not",
                  "contains_any",
                  "contains_none",
                ]),
                value: z.union([
                  invoiceStatusSchema,
                  z.array(invoiceStatusSchema).max(20),
                ]),
              })
              .strict(),
          ])
          .superRefine((filter, context) => {
            if (
              filter.field === "counterparty" ||
              filter.field === "description" ||
              filter.field === "date" ||
              filter.field === "amount"
            )
              return;

            const membershipOperator =
              filter.operator === "contains_any" ||
              filter.operator === "contains_none";
            if (membershipOperator !== Array.isArray(filter.value))
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["value"],
                message: membershipOperator
                  ? "Choose one or more enum values."
                  : "Choose one enum value.",
              });
          }),
      )
      .max(20)
      .default([]),
    sort: z
      .object({
        key: z.enum(["date", "counterparty", "amount", "state"]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
      .default({ key: "date", direction: "desc" }),
    sortClauses: z
      .array(
        z
          .object({
            key: z.enum(["date", "counterparty", "amount", "state"]),
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .min(1)
      .max(4)
      .optional(),
    page: z.number().int().min(1).max(2_001).default(1),
  })
  .strict();

export const privateGate = createServerFn({ method: "GET" }).handler(async () =>
  runOperation(
    "Folio access",
    async () => {
      runtime();
      return true;
    },
    {},
    { log: "failures" },
  ),
);

export const getFolioUiConfig = createServerFn({ method: "GET" }).handler(
  async () =>
    runOperation("Load Folio configuration", async () => {
      const { current } = await authorize(
        operationPermissions.getFolioUiConfig,
      );
      return {
        gstRegistered: current.config.gstRegistered,
        reportingTimezone: current.config.reportingTimezone,
      };
    }),
);

export const healthCheck = createServerFn({ method: "GET" }).handler(async () =>
  runOperation(
    "Folio health check",
    async () => {
      const current = runtime();
      await current.repository.health();
      return { status: "ok" as const };
    },
    {},
    { log: "none" },
  ),
);

export const reportClientRenderFailure = createServerFn({ method: "POST" })
  .validator(clientRenderFailureSchema)
  .handler(async ({ data }) =>
    runOperation("Report client render failure", async () => {
      const { actor } = await authorize(operationPermissions.getTransaction);
      if (!canReportClientRenderFailure(actor.id))
        return { reported: false as const };
      writeClientRenderFailure(data as ClientRenderFailure);
      return { reported: true as const };
    }),
  );

export const listWorkspace = createServerFn({ method: "GET" })
  .validator(z.object({ search: z.string().max(200).default("") }).strict())
  .handler(async ({ data }) =>
    runOperation("Load workspace", async () => {
      const { actor, current } = await authorize(
        operationPermissions.listWorkspace,
      );
      const [users, transactions, entrySuggestions] = await Promise.all([
        current.repository.listUsers(actor.id),
        current.repository.listTransactions(actor.id, data.search),
        current.repository.listEntrySuggestions(actor.id),
      ]);
      return { users, transactions, entrySuggestions };
    }),
  );

export const listTransactionFormOptions = createServerFn({
  method: "GET",
}).handler(async () =>
  runOperation("Load transaction form options", async () => {
    const { actor, current } = await authorize(
      operationPermissions.listWorkspace,
    );
    const [users, entrySuggestions] = await Promise.all([
      current.repository.listUsers(actor.id),
      current.repository.listEntrySuggestions(actor.id),
    ]);
    return { users, entrySuggestions };
  }),
);

export const listTransactionPage = createServerFn({ method: "GET" })
  .validator(transactionPageQuerySchema)
  .handler(async ({ data }) =>
    runOperation("List transactions", async () => {
      const { actor, current } = await authorize(
        operationPermissions.getTransaction,
      );
      return current.repository.listTransactionPage(actor.id, {
        ...data,
        reportingTimezone: current.config.reportingTimezone,
      });
    }),
  );

export const previewBulkTransactionEdit = createServerFn({ method: "POST" })
  .validator(bulkTransactionRequestSchema)
  .handler(async ({ data }) =>
    runOperation("Preview transaction bulk edit", async () => {
      const { actor, current } = await authorize(
        operationPermissions.previewBulkTransactionEdit,
      );
      return current.repository.previewBulkTransactionEdit(actor.id, data);
    }),
  );

export const applyBulkTransactionEdit = createServerFn({ method: "POST" })
  .validator(bulkTransactionRequestSchema)
  .handler(async ({ data }) =>
    runOperation(
      "Apply transaction bulk edit",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.applyBulkTransactionEdit,
        );
        return current.repository.applyBulkTransactionEdit(actor.id, data);
      },
      {},
      { mutation: true },
    ),
  );

export const getOverviewSummary = createServerFn({ method: "GET" }).handler(
  async () =>
    runOperation("Load overview summary", async () => {
      const { actor, current } = await authorize([
        permissions.transactionRead,
        permissions.bankActivityView,
      ]);
      const [transactions, banking] = await Promise.all([
        current.repository.transactionOverviewSummary(actor.id),
        current.bankRepository.overviewSummary(actor.id),
      ]);
      return {
        attention: {
          unresolvedBankRows: banking.unresolvedBankRows,
          importsWithUnresolvedRows: banking.importsWithUnresolvedRows,
          missingInvoiceOrCreditNoteCount:
            transactions.missingInvoiceOrCreditNoteCount,
          pendingImportUploads: transactions.pendingImportUploads,
          abandonedImportUploads: transactions.abandonedImportUploads,
        },
        recent: {
          transactions: transactions.recentTransactions,
          bankRows: banking.recentBankRows,
        },
      };
    }),
);

export const listUsers = createServerFn({ method: "GET" }).handler(async () =>
  runOperation("List users", async () => {
    const { actor, current } = await authorize(operationPermissions.listUsers);
    return current.repository.listUsers(actor.id);
  }),
);

export const getTransaction = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation("Load transaction", async () => {
      const { actor, current } = await authorize(
        operationPermissions.getTransaction,
      );
      return current.repository.getTransaction(actor.id, data.id);
    }),
  );

export const getProposedDraftEvidence = createServerFn({ method: "GET" })
  .validator(z.object({ transactionId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation("Load proposed draft evidence", async () => {
      const { actor, current } = await authorize(
        operationPermissions.getTransaction,
      );
      return current.proposalRepository.getProposedEvidenceForDraft(
        actor.id,
        data.transactionId,
      );
    }),
  );

export const discardProposedDraftEvidence = createServerFn({ method: "POST" })
  .validator(z.object({ transactionId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Discard proposed draft evidence",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.saveManualTransaction,
        );
        return current.proposalRepository.discardProposedEvidenceForDraft(
          actor.id,
          data.transactionId,
        );
      },
      {},
      { mutation: true },
    ),
  );

export const saveManualTransaction = createServerFn({ method: "POST" })
  .validator(z.unknown())
  .handler(async ({ data }) =>
    runOperation(
      "Save manual transaction",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.saveManualTransaction,
        );
        const parsed = manualTransactionSavePayloadSchema.safeParse(data);
        if (!parsed.success)
          return {
            status: "invalid" as const,
            issues: safeManualTransactionServerIssues(parsed.error),
          };
        const transaction = parsed.data.id
          ? parsed.data.artifactIds === undefined
            ? current.repository.updateManual(
                actor.id,
                parsed.data.id,
                parsed.data.transaction,
                parsed.data.expectedUpdatedAt ?? "",
                parsed.data.action,
              )
            : current.repository.updateManual(
                actor.id,
                parsed.data.id,
                parsed.data.transaction,
                parsed.data.expectedUpdatedAt ?? "",
                parsed.data.action,
                parsed.data.artifactIds,
              )
          : parsed.data.artifactIds === undefined
            ? current.repository.createManual(actor.id, parsed.data.transaction)
            : current.repository.createManual(
                actor.id,
                parsed.data.transaction,
                parsed.data.artifactIds,
              );
        return { status: "saved" as const, transaction: await transaction };
      },
      {},
      { mutation: true },
    ),
  );

export const voidTransaction = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        id: z.string().uuid(),
        expectedUpdatedAt: z.string().datetime(),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Void transaction",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.voidTransaction,
        );
        return current.repository.voidTransaction(
          actor.id,
          data.id,
          data.expectedUpdatedAt,
        );
      },
      {},
      { mutation: true },
    ),
  );

export const deleteDraftTransaction = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        id: z.string().uuid(),
        expectedUpdatedAt: z.string().datetime(),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Delete draft transaction",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.deleteDraftTransaction,
        );
        return current.repository.deleteDraftTransaction(
          actor.id,
          data.id,
          data.expectedUpdatedAt,
        );
      },
      {},
      { mutation: true },
    ),
  );

export const createUser = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        email: z.string().trim().email(),
        displayName: z.string().trim().max(200).nullable(),
        role: userRoleSchema,
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Create user",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.createUser,
        );
        return current.repository.createUser(actor.id, data);
      },
      {},
      { mutation: true },
    ),
  );

export const updateUser = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        id: z.string().uuid(),
        role: userRoleSchema,
        active: z.boolean(),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Update user",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.updateUser,
        );
        return current.repository.updateUser(actor.id, data.id, data);
      },
      {},
      { mutation: true },
    ),
  );

const uploadSchema = z
  .object({
    ownerId: z.string().uuid().nullable(),
    artifactProfile: artifactProfileSchema.optional(),
    /** @deprecated existing browser callers may still send the legacy kind. */
    kind: z.enum(["pdf", "stripe_csv"]).optional(),
    filename: z.string().trim().min(1).max(255),
    mediaType: z.enum(["application/pdf", "text/csv"]),
    byteSize: z.number().int().positive(),
    checksumSha256: z.string(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.artifactProfile && !value.kind)
      context.addIssue({
        code: "custom",
        path: ["artifactProfile"],
        message: "Choose an artifact profile",
      });
    if (value.artifactProfile && value.kind)
      context.addIssue({
        code: "custom",
        path: ["artifactProfile"],
        message: "Choose one artifact profile",
      });
  });

export const startArtifactUpload = createServerFn({ method: "POST" })
  .validator(uploadSchema)
  .handler(async ({ data }) =>
    runOperation(
      "Start artifact upload",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.startArtifactUpload,
        );
        if (data.artifactProfile && isBankArtifactProfile(data.artifactProfile))
          requirePermission(actor, permissions.bankActivityImport);
        return current.documents.startUpload({ ...data, actorId: actor.id });
      },
      {},
      { mutation: true },
    ),
  );

export const confirmArtifactUpload = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Confirm artifact upload",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.confirmArtifactUpload,
        );
        const artifact = await current.repository.getArtifact(data.id);
        if (
          artifact?.artifactProfile &&
          isBankArtifactProfile(artifact.artifactProfile)
        )
          requirePermission(actor, permissions.bankActivityImport);
        return current.documents.confirmUpload(actor.id, data.id);
      },
      {},
      { mutation: true },
    ),
  );

export const approveArtifact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Approve PDF artifact",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.confirmArtifactUpload,
        );
        requirePermission(actor, permissions.artifactDownload);
        return current.documents.approveArtifact(actor.id, data.id);
      },
      {},
      { mutation: true },
    ),
  );

export const downloadArtifact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation("Download artifact", async () => {
      const { actor, current } = await authorize(
        operationPermissions.downloadArtifact,
      );
      return current.documents.download(actor.id, data.id);
    }),
  );

export const previewArtifactForReview = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation("Preview PDF artifact for review", async () => {
      const { actor, current } = await authorize(
        operationPermissions.downloadArtifact,
      );
      return current.documents.previewArtifactForReview(actor.id, data.id);
    }),
  );

export const rejectArtifact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Reject artifact",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.rejectArtifact,
        );
        return current.documents.rejectArtifact(actor.id, data.id);
      },
      {},
      { mutation: true },
    ),
  );

export const deleteArtifact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Delete artifact",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.deleteArtifact,
        );
        return current.documents.deleteArtifact(actor.id, data.id);
      },
      {},
      { mutation: true },
    ),
  );

export const deleteRejectedArtifact = deleteArtifact;

export const listAvailableInvoiceArtifacts = createServerFn({
  method: "GET",
}).handler(async () =>
  runOperation("List available invoice artifacts", async () => {
    const { actor, current } = await authorize(
      operationPermissions.listAvailableInvoiceArtifacts,
    );
    return current.repository.listAvailableInvoiceArtifacts(actor.id);
  }),
);

const artifactListFilterSchema = z.union([
  z
    .object({
      field: z.literal("filename"),
      operator: z.enum(["equals", "not_equals", "contains", "not_contains"]),
      value: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      field: z.literal("uploaded"),
      operator: z.enum([
        "equals",
        "not_equals",
        "greater_than",
        "greater_than_or_equal",
        "less_than",
        "less_than_or_equal",
      ]),
      value: z.string().date(),
    })
    .strict(),
  z
    .object({
      field: z.enum(["transactions", "bank_activity"]),
      operator: z.enum([
        "equals",
        "not_equals",
        "greater_than",
        "greater_than_or_equal",
        "less_than",
        "less_than_or_equal",
      ]),
      value: z.string().trim().min(1).max(9).regex(/^\d+$/),
    })
    .strict(),
  enumFilterSchema("profile", artifactProfileSchema),
  enumFilterSchema("type", z.enum(["application/pdf", "text/csv"])),
  enumFilterSchema(
    "state",
    z.enum([
      "pending",
      "awaiting_review",
      "available",
      "rejected",
      "superseded",
      "abandoned",
      "deleting",
    ]),
  ),
  enumFilterSchema("linkage", z.enum(["linked", "unlinked"])),
]);

const artifactListSortSchema = z
  .object({
    field: z.enum([
      "filename",
      "profile",
      "type",
      "uploaded",
      "state",
      "transactions",
      "bank_activity",
    ]),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

export const listArtifacts = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        search: z.string().max(200).optional(),
        profile: artifactProfileSchema.nullable().optional(),
        state: z
          .enum([
            "pending",
            "awaiting_review",
            "available",
            "rejected",
            "superseded",
            "abandoned",
            "deleting",
          ])
          .nullable()
          .optional(),
        from: z.string().date().nullable().optional(),
        to: z.string().date().nullable().optional(),
        linkage: z.enum(["all", "linked", "unlinked"]).optional(),
        filters: z.array(artifactListFilterSchema).max(20).optional(),
        sort: z.array(artifactListSortSchema).max(7).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(100_000).default(0),
      })
      .strict()
      .transform((input) => {
        const legacyFilters: z.infer<typeof artifactListFilterSchema>[] = [];
        const search = input.search?.trim();
        if (search)
          legacyFilters.push({
            field: "filename",
            operator: "contains",
            value: search,
          });
        if (input.profile)
          legacyFilters.push({
            field: "profile",
            operator: "is",
            value: input.profile,
          });
        if (input.state)
          legacyFilters.push({
            field: "state",
            operator: "is",
            value: input.state,
          });
        if (input.from)
          legacyFilters.push({
            field: "uploaded",
            operator: "greater_than_or_equal",
            value: input.from,
          });
        if (input.to)
          legacyFilters.push({
            field: "uploaded",
            operator: "less_than_or_equal",
            value: input.to,
          });
        if (input.linkage && input.linkage !== "all")
          legacyFilters.push({
            field: "linkage",
            operator: "is",
            value: input.linkage,
          });

        return {
          filters: input.filters ?? legacyFilters,
          sort: input.sort ?? [{ field: "uploaded", direction: "desc" }],
          limit: input.limit,
          offset: input.offset,
        };
      }),
  )
  .handler(async ({ data }) =>
    runOperation("List artifacts", async () => {
      const { actor, current } = await authorize(
        operationPermissions.listArtifacts,
      );
      return current.repository.listArtifacts(actor.id, data);
    }),
  );

export const findArtifactFilenameMatches = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        profile: artifactProfileSchema,
        filenames: z.array(z.string().trim().min(1).max(255)).min(1).max(1000),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation("Find artifact filename matches", async () => {
      const { actor, current } = await authorize(
        operationPermissions.listArtifacts,
      );
      return current.repository.findArtifactFilenameMatches(
        actor.id,
        data.profile,
        data.filenames,
      );
    }),
  );

export const linkTransactionArtifact = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        transactionId: z.string().uuid(),
        artifactId: z.string().uuid(),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Link transaction artifact",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.linkTransactionArtifact,
        );
        await current.repository.linkTransactionArtifact(
          actor.id,
          data.transactionId,
          data.artifactId,
        );
        return { status: "linked" as const };
      },
      {},
      { mutation: true },
    ),
  );

export const unlinkTransactionArtifact = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        transactionId: z.string().uuid(),
        artifactId: z.string().uuid(),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Unlink transaction artifact",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.unlinkTransactionArtifact,
        );
        await current.repository.unlinkTransactionArtifact(
          actor.id,
          data.transactionId,
          data.artifactId,
        );
        return { status: "unlinked" as const };
      },
      {},
      { mutation: true },
    ),
  );

export const importStripeCsv = createServerFn({ method: "POST" })
  .validator(z.object({ artifactId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    runOperation(
      "Import Stripe CSV",
      async () => {
        const { actor, current } = await authorize(
          operationPermissions.importStripeCsv,
        );
        const object = await current.documents.readReviewText(
          actor.id,
          data.artifactId,
          "stripe_balance_itemised_csv_v1",
        );
        const rows = parseStripeBalanceCsv(object.text, {
          reportingTimezone: current.config.reportingTimezone,
        });
        return current.repository.importStripe(
          actor.id,
          data.artifactId,
          rows,
          current.config.reportingTimezone,
        );
      },
      {},
      { mutation: true },
    ),
  );

const stripePreviewRowLimit = 200;

export const previewStripeCsv = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        artifactId: z.string().uuid(),
        page: z.number().int().min(1).max(100_000).default(1),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation("Preview Stripe CSV", async () => {
      const { actor, current } = await authorize(
        operationPermissions.importStripeCsv,
      );
      const object = await current.documents.readReviewText(
        actor.id,
        data.artifactId,
        "stripe_balance_itemised_csv_v1",
      );
      const rows = parseStripeBalanceCsv(object.text, {
        reportingTimezone: current.config.reportingTimezone,
      });
      const statuses = await current.repository.previewStripeImport(
        actor.id,
        data.artifactId,
        rows,
      );
      if (statuses.length !== rows.length)
        throw new Error("Stripe preview status count mismatch");
      const previewRows: StripeImportPreviewRow[] = rows.map((row, index) => {
        const classification = classifyStripeReportingCategory(
          row.reportingCategory,
        );
        return {
          reference: row.reference,
          occurredAt: row.occurredAt,
          availableAt: row.availableAt,
          sourceCurrency: row.sourceCurrency,
          sourceGross: row.sourceGross,
          sourceFee: row.sourceFee,
          sourceNet: row.sourceNet,
          reportingCategory: row.reportingCategory,
          kind: classification.kind,
          mappingWarning: !classification.known
            ? "Unknown Stripe category; mapped to adjustment for review."
            : classification.requiresReview
              ? "Mapped to adjustment; review classification."
              : null,
          importStatus: statuses[index]!,
        };
      });
      const priority = { conflict: 0, will_import: 1, already_imported: 2 };
      const orderedRows = [...previewRows].sort(
        (left, right) =>
          priority[left.importStatus] - priority[right.importStatus],
      );
      const offset = (data.page - 1) * stripePreviewRowLimit;
      const displayRows = orderedRows.slice(
        offset,
        offset + stripePreviewRowLimit,
      );
      const result: StripeImportPreview = {
        artifactId: data.artifactId,
        totalCount: previewRows.length,
        willImportCount: previewRows.filter(
          (row) => row.importStatus === "will_import",
        ).length,
        alreadyImportedCount: previewRows.filter(
          (row) => row.importStatus === "already_imported",
        ).length,
        conflictCount: previewRows.filter(
          (row) => row.importStatus === "conflict",
        ).length,
        page: data.page,
        pageSize: stripePreviewRowLimit,
        totalPages: Math.max(
          1,
          Math.ceil(previewRows.length / stripePreviewRowLimit),
        ),
        displayedCount: displayRows.length,
        rows: displayRows,
      };
      return result;
    }),
  );

export const getReport = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        basis: z.enum(["activity", "cash"]),
        periodType: z.enum(["month", "bas_quarter", "financial_year"]),
        format: z.enum(["json", "csv"]).default("json"),
      })
      .strict(),
  )
  .handler(async ({ data }) =>
    runOperation("Load report", async () => {
      const { actor, current } = await authorize(
        data.format === "csv"
          ? operationPermissions.exportReport
          : operationPermissions.getReport,
      );
      const transactions = await current.repository.listTransactions(actor.id);
      const report = buildReport(
        transactions,
        data.basis,
        data.periodType,
        current.config.reportingTimezone,
      );
      if (data.format === "csv")
        return { csv: reportCsv(report), report: null };
      return {
        csv: null,
        report,
        balance: buildBalanceSeries(
          transactions,
          data.basis,
          data.periodType,
          current.config.reportingTimezone,
        ),
      };
    }),
  );

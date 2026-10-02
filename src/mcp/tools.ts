import {
  fromJsonSchema,
  type JsonSchemaType,
  type McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  artifactProfileSchema,
  getArtifactProfile,
} from "../artifacts/profiles";
import type { BankRepository } from "../database/bank-repository";
import type {
  CsvDuplicateWarningReport,
  FolioRepository,
} from "../database/repository";
import {
  ProposalAuthorizationError,
  ProposalDraftNotEditableError,
  ProposalIdempotencyConflictError,
  ProposalTransactionConflictError,
  ProposalTransactionNotFoundError,
  type ProposalRepository,
} from "../database/proposal-repository";
import { ArtifactUploadIdempotencyConflictError } from "../documents/service";
import { parseCommBankTransactionHistoryCsv } from "../domain/bank-profiles/commbank-transaction-history-v1";
import {
  directBankTargetSchema,
  commBankArtifactRowLocatorSchema,
  parseProposalSubmission,
  validatePreImportCommBankLocator,
} from "../domain/proposals";
import { transactionInputSchema, transactionKindSchema } from "../domain/types";
import type { DocumentService } from "../documents/service";
import type { FolioConfig } from "../config";
import {
  type McpPrincipal,
  type McpScope,
  type McpToolRegistrar,
} from "./server";

const uploadProfiles = [
  "manual_invoice_pdf_v1",
  "stripe_balance_itemised_csv_v1",
  "commbank_transaction_history_csv_v1",
] as const;

const uploadProfileSchema = z.enum(uploadProfiles);

const artifactStateSchema = z.enum([
  "pending",
  "awaiting_review",
  "available",
  "rejected",
  "superseded",
  "abandoned",
  "deleting",
]);

const output = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

type McpPublicErrorCode =
  | "INVALID_ARGUMENTS"
  | "NOT_AUTHORIZED"
  | "IDEMPOTENCY_CONFLICT"
  | "BANK_ROW_NOT_ACTIONABLE"
  | "ARTIFACT_NOT_CONFIRMABLE"
  | "INVALID_BANK_ROW_LOCATOR"
  | "MATCH_CANDIDATE_NOT_ELIGIBLE"
  | "EVIDENCE_NOT_REVIEWABLE"
  | "DRAFT_NOT_EDITABLE"
  | "REVISION_CONFLICT"
  | "TRANSACTION_NOT_FOUND"
  | "REQUEST_FAILED";

class McpToolError extends Error {
  constructor(
    readonly code: McpPublicErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const safeError = (
  error: unknown,
): { code: McpPublicErrorCode; message: string } => {
  if (error instanceof z.ZodError)
    return {
      code: "INVALID_ARGUMENTS",
      message: "Tool input did not satisfy the accepted schema.",
    };
  if (error instanceof ProposalAuthorizationError)
    return { code: "NOT_AUTHORIZED", message: "Credential is not authorized." };
  if (error instanceof ProposalDraftNotEditableError)
    return {
      code: "DRAFT_NOT_EDITABLE",
      message: "The draft is no longer editable by this credential.",
    };
  if (error instanceof ProposalTransactionConflictError)
    return {
      code: "REVISION_CONFLICT",
      message: "The transaction changed after it was read.",
    };
  if (error instanceof ProposalTransactionNotFoundError)
    return {
      code: "TRANSACTION_NOT_FOUND",
      message: "The transaction was not found.",
    };
  if (
    error instanceof ProposalIdempotencyConflictError ||
    error instanceof ArtifactUploadIdempotencyConflictError
  )
    return {
      code: "IDEMPOTENCY_CONFLICT",
      message: "This idempotency key was used with a different request.",
    };
  if (error instanceof McpToolError)
    return { code: error.code, message: error.message };
  if (error instanceof Error) {
    if (error.message === "Intended bank row is stale or already resolved")
      return {
        code: "BANK_ROW_NOT_ACTIONABLE",
        message: "The selected bank row is stale or already resolved.",
      };
    if (
      error.message === "Proposed match transaction is not recorded and manual"
    )
      return {
        code: "MATCH_CANDIDATE_NOT_ELIGIBLE",
        message: "The match candidate must be a recorded manual transaction.",
      };
    if (error.message === "Proposed invoice evidence not found")
      return {
        code: "EVIDENCE_NOT_REVIEWABLE",
        message: "The proposed invoice evidence is not reviewable.",
      };
  }
  return {
    code: "REQUEST_FAILED",
    message: "The request could not be completed.",
  };
};

const failed = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify(safeError(error)) }],
});

const runTool = async (action: () => Promise<unknown>) => {
  try {
    return output(await action());
  } catch (error) {
    return failed(error);
  }
};

const hasScope = (principal: McpPrincipal, required: McpScope) =>
  principal.scopes.includes(required);

const jsonObject = (
  properties: NonNullable<JsonSchemaType["properties"]>,
  required: readonly string[] = [],
): JsonSchemaType => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

const stringSchema = (maxLength: number): JsonSchemaType => ({
  type: "string",
  maxLength,
});

const nullable = (schema: JsonSchemaType): JsonSchemaType => ({
  anyOf: [schema, { type: "null" }],
});

const bankRowsInput = z
  .object({
    limit: z.number().int().min(1).max(50).default(25),
    offset: z.number().int().min(0).max(10_000).default(0),
    artifactId: z.string().uuid().optional(),
  })
  .strict();

const searchInput = z
  .object({
    search: z.string().trim().max(120).default(""),
    page: z.number().int().min(1).max(100_000).default(1),
  })
  .strict();

const listArtifactsInput = z
  .object({
    search: z.string().trim().max(120).default(""),
    profile: artifactProfileSchema.nullable().default(null),
    state: artifactStateSchema.nullable().default(null),
    limit: z.number().int().min(1).max(50).default(25),
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

const beginUploadInput = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    profile: uploadProfileSchema,
    filename: z.string().trim().min(1).max(255),
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .strict();

const confirmUploadInput = z.object({ artifactId: z.string().uuid() }).strict();

const directBankTargetInput = directBankTargetSchema.extend({
  expectedRevision: z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(20),
});

const draftTransactionFieldsSchema = z
  .object({
    kind: transactionKindSchema,
    reference: z.string().trim().max(200).nullable().optional(),
    counterparty: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    category: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(4_000).nullable().optional(),
    occurredAt: z.string().datetime().nullable().optional(),
    availableAt: z.string().datetime().nullable().optional(),
    invoiceDate: z.string().date().nullable().optional(),
    settledAt: z.string().datetime().nullable().optional(),
    documentCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    documentAmount: z.string().max(50).nullable().optional(),
    documentTaxAmount: z.string().max(50).nullable().optional(),
    taxTreatment: z
      .enum([
        "gst_included",
        "gst_separately_shown",
        "foreign_tax_included",
        "no_tax",
        "unknown_mixed",
      ])
      .optional(),
    settlementCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    settlementAmount: z.string().max(50).nullable().optional(),
    gstCreditStatus: z
      .enum(["not_registered", "unknown", "not_claimable", "claimable"])
      .optional(),
    claimableGstAud: z.string().max(50).nullable().optional(),
  })
  .strict();

const draftInput = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    transaction: draftTransactionFieldsSchema,
    bankTarget: z
      .union([directBankTargetInput, commBankArtifactRowLocatorSchema])
      .optional(),
    proposedEvidenceArtifactId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

const editDraftInput = z
  .object({
    transactionId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ precision: 6 }),
    changes: draftTransactionFieldsSchema
      .partial()
      .refine((changes) => Object.keys(changes).length > 0),
  })
  .strict();

const suggestMatchInput = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    existingTransactionId: z.string().uuid(),
    bankTarget: directBankTargetInput,
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

const draftTransactionJsonSchema = jsonObject(
  {
    kind: {
      type: "string",
      enum: [
        "sale",
        "supplier_expense",
        "processing_fee",
        "sale_refund",
        "supplier_credit",
        "dispute",
        "transfer",
        "owner_contribution",
        "owner_loan",
        "adjustment",
      ],
    },
    reference: nullable(stringSchema(200)),
    counterparty: nullable(stringSchema(300)),
    description: nullable(stringSchema(2_000)),
    category: nullable(stringSchema(200)),
    notes: nullable(stringSchema(4_000)),
    occurredAt: nullable({ type: "string", format: "date-time" }),
    availableAt: nullable({ type: "string", format: "date-time" }),
    invoiceDate: nullable({ type: "string", format: "date" }),
    settledAt: nullable({ type: "string", format: "date-time" }),
    documentCurrency: nullable({ type: "string", pattern: "^[A-Z]{3}$" }),
    documentAmount: nullable(stringSchema(50)),
    documentTaxAmount: nullable(stringSchema(50)),
    taxTreatment: {
      type: "string",
      enum: [
        "gst_included",
        "gst_separately_shown",
        "foreign_tax_included",
        "no_tax",
        "unknown_mixed",
      ],
    },
    settlementCurrency: nullable({ type: "string", pattern: "^[A-Z]{3}$" }),
    settlementAmount: nullable(stringSchema(50)),
    gstCreditStatus: {
      type: "string",
      enum: ["not_registered", "unknown", "not_claimable", "claimable"],
    },
    claimableGstAud: nullable(stringSchema(50)),
  },
  ["kind"],
);

const draftTransactionChangesJsonSchema: JsonSchemaType = {
  ...draftTransactionJsonSchema,
  required: [],
};

const directBankTargetJsonSchema = jsonObject(
  {
    kind: { const: "bank_transaction", type: "string" },
    bankTransactionId: { type: "string", format: "uuid" },
    expectedRevision: {
      type: "string",
      pattern: "^[1-9]\\d*$",
      maxLength: 20,
    },
  },
  ["kind", "bankTransactionId", "expectedRevision"],
);

const commBankLocatorJsonSchema = jsonObject(
  {
    kind: { const: "commbank_artifact_row", type: "string" },
    artifactId: { type: "string", format: "uuid" },
    sourceRow: { type: "integer", minimum: 1, maximum: 1_000_000 },
  },
  ["kind", "artifactId", "sourceRow"],
);

const registerToolsForPrincipal = (
  server: McpServer,
  principal: McpPrincipal,
  dependencies: McpToolDependencies,
) => {
  if (hasScope(principal, "bank_rows:read")) {
    server.registerTool(
      "list_unresolved_bank_rows",
      {
        description:
          "List a bounded page of unresolved bank facts with revision tokens.",
        inputSchema: fromJsonSchema<{
          limit?: number;
          offset?: number;
          artifactId?: string;
        }>(
          jsonObject({
            limit: { type: "integer", minimum: 1, maximum: 50 },
            offset: { type: "integer", minimum: 0, maximum: 10_000 },
            artifactId: { type: "string", format: "uuid" },
          }),
        ),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = bankRowsInput.parse(input);
          const rows = await dependencies.bankRepository.listTransactions(
            principal.actorUserId,
            {
              limit: request.limit,
              offset: request.offset,
              state: "unresolved",
              ...(request.artifactId ? { artifactId: request.artifactId } : {}),
            },
          );
          return {
            rows: rows.map((row) => ({
              id: row.id,
              postedDate: row.postedDate,
              amountAud: row.amountAud,
              description: row.description,
              state: row.reviewState,
              revision: row.revision,
              artifactIds: row.artifactIds,
            })),
            nextOffset:
              rows.length === request.limit
                ? request.offset + rows.length
                : null,
          };
        }),
    );
  }

  if (hasScope(principal, "transactions:search")) {
    server.registerTool(
      "search_transactions",
      {
        description: "Search a bounded page of transactions in any status.",
        inputSchema: fromJsonSchema<{
          search?: string;
          page?: number;
        }>(
          jsonObject({
            search: { type: "string", maxLength: 120 },
            page: { type: "integer", minimum: 1, maximum: 100_000 },
          }),
        ),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = searchInput.parse(input);
          const page = await dependencies.repository.listTransactionPage(
            principal.actorUserId,
            {
              search: request.search,
              filters: [],
              sort: { key: "date", direction: "desc" },
              page: request.page,
              reportingTimezone: dependencies.config.reportingTimezone,
            },
          );
          return {
            total: page.total,
            page: page.page,
            pageSize: page.pageSize,
            rows: page.rows.map((row) => ({
              id: row.id,
              kind: row.kind,
              status: row.status,
              sourceSystem: row.sourceSystem,
              invoiceDate: row.invoiceDate,
              occurredAt: row.occurredAt,
              settledAt: row.settledAt,
              counterparty: row.counterparty,
              reference: row.reference,
              description: row.description,
              category: row.category,
              documentCurrency: row.documentCurrency,
              documentAmount: row.documentAmount,
              settlementCurrency: row.settlementCurrency,
              settlementAmount: row.settlementAmount,
              updatedAt: row.updatedAt,
            })),
          };
        }),
    );
  }

  if (hasScope(principal, "artifacts:read")) {
    server.registerTool(
      "list_artifacts",
      {
        description:
          "List bounded artifact metadata only; original file bytes and download URLs are not available.",
        inputSchema: fromJsonSchema<{
          search?: string;
          profile?: string | null;
          state?: string | null;
          limit?: number;
          offset?: number;
        }>(
          jsonObject({
            search: { type: "string", maxLength: 120 },
            profile: nullable({
              type: "string",
              enum: artifactProfileSchema.options,
            }),
            state: nullable({
              type: "string",
              enum: artifactStateSchema.options,
            }),
            limit: { type: "integer", minimum: 1, maximum: 50 },
            offset: { type: "integer", minimum: 0, maximum: 10_000 },
          }),
        ),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = listArtifactsInput.parse(input);
          const page = await dependencies.repository.listArtifacts(
            principal.actorUserId,
            {
              search: request.search,
              profile: request.profile,
              state: request.state,
              from: null,
              to: null,
              linkage: "all",
              limit: request.limit,
              offset: request.offset,
            },
          );
          return page;
        }),
    );
  }

  if (hasScope(principal, "artifacts:upload")) {
    server.registerTool(
      "begin_artifact_upload",
      {
        description:
          "Create a bounded direct-to-storage upload intent for a supported artifact profile.",
        inputSchema: fromJsonSchema<{
          idempotencyKey: string;
          profile: (typeof uploadProfiles)[number];
          filename: string;
          byteSize: number;
          checksumSha256: string;
        }>(
          jsonObject(
            {
              idempotencyKey: stringSchema(200),
              profile: { type: "string", enum: uploadProfiles },
              filename: { type: "string", minLength: 1, maxLength: 255 },
              byteSize: {
                type: "integer",
                minimum: 1,
                maximum: 50 * 1024 * 1024,
              },
              checksumSha256: {
                type: "string",
                pattern: "^[A-Za-z0-9+/]{43}=$",
              },
            },
            [
              "idempotencyKey",
              "profile",
              "filename",
              "byteSize",
              "checksumSha256",
            ],
          ),
        ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = beginUploadInput.parse(input);
          const profile = getArtifactProfile(request.profile);
          const result = await dependencies.documents.startIdempotentUpload({
            credentialId: principal.credentialId,
            idempotencyKey: request.idempotencyKey,
            actorId: principal.actorUserId,
            ownerId: principal.defaultOwnerId,
            artifactProfile: request.profile,
            filename: request.filename,
            mediaType: profile.mediaType,
            byteSize: request.byteSize,
            checksumSha256: request.checksumSha256,
          });
          if (result.status === "intent_not_uploadable")
            return {
              status: result.status,
              artifactId: result.artifactId,
              artifactState: result.artifactState,
              replayed: true,
            };
          return {
            status: result.status,
            artifact: publicArtifact(result.artifact),
            uploadUrl: result.uploadUrl,
            replayed: result.replayed,
          };
        }),
    );

    server.registerTool(
      "confirm_artifact_upload",
      {
        description:
          "Confirm an actor-owned immutable upload version and queue it for human review.",
        inputSchema: fromJsonSchema<{ artifactId: string }>(
          jsonObject({ artifactId: { type: "string", format: "uuid" } }, [
            "artifactId",
          ]),
        ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = confirmUploadInput.parse(input);
          const creatorId = await dependencies.repository.getArtifactCreatorId(
            request.artifactId,
          );
          if (creatorId !== principal.actorUserId)
            throw new McpToolError(
              "ARTIFACT_NOT_CONFIRMABLE",
              "Only the credential actor may confirm this upload.",
            );
          const artifact = await dependencies.repository.getArtifact(
            request.artifactId,
          );
          if (
            !artifact ||
            !uploadProfiles.includes(
              artifact.artifactProfile as (typeof uploadProfiles)[number],
            )
          )
            throw new McpToolError(
              "ARTIFACT_NOT_CONFIRMABLE",
              "The artifact is not in a supported upload profile.",
            );
          const confirmed = await dependencies.documents.confirmUpload(
            principal.actorUserId,
            request.artifactId,
          );
          let duplicateWarnings:
            | { status: "available"; report: CsvDuplicateWarningReport }
            | { status: "unavailable" }
            | null = null;
          if (
            artifact.artifactProfile === "stripe_balance_itemised_csv_v1" ||
            artifact.artifactProfile === "commbank_transaction_history_csv_v1"
          ) {
            duplicateWarnings = { status: "unavailable" };
            if (dependencies.getCsvDuplicateWarnings) {
              try {
                duplicateWarnings = {
                  status: "available",
                  report: await dependencies.getCsvDuplicateWarnings(
                    principal.actorUserId,
                    request.artifactId,
                  ),
                };
              } catch {
                duplicateWarnings = { status: "unavailable" };
              }
            }
          }
          return {
            artifact: publicArtifact(confirmed),
            duplicateWarnings,
          };
        }),
    );
  }

  if (hasScope(principal, "transactions:draft")) {
    server.registerTool(
      "submit_draft_transaction",
      {
        description:
          "Submit one manual draft for human review; this tool cannot record or match transactions.",
        inputSchema: fromJsonSchema<{
          idempotencyKey: string;
          transaction: Record<string, unknown> & { kind: string };
          bankTarget?:
            | {
                kind: "bank_transaction";
                bankTransactionId: string;
                expectedRevision: string;
              }
            | {
                kind: "commbank_artifact_row";
                artifactId: string;
                sourceRow: number;
              };
          proposedEvidenceArtifactId?: string | null;
          note?: string | null;
        }>(
          jsonObject(
            {
              idempotencyKey: stringSchema(200),
              transaction: draftTransactionJsonSchema,
              bankTarget: {
                anyOf: [directBankTargetJsonSchema, commBankLocatorJsonSchema],
              },
              proposedEvidenceArtifactId: nullable({
                type: "string",
                format: "uuid",
              }),
              note: nullable(stringSchema(2_000)),
            },
            ["idempotencyKey", "transaction"],
          ),
        ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = draftInput.parse(input);
          const validatedTransaction = transactionInputSchema.parse({
            ...request.transaction,
            ownerId: null,
            sourceArtifactId: null,
            status: "draft",
          });
          const submission = parseProposalSubmission({
            kind: "draft_transaction",
            idempotencyKey: request.idempotencyKey,
            transaction: validatedTransaction,
            bankTarget: request.bankTarget ?? null,
            proposedEvidenceArtifactId:
              request.proposedEvidenceArtifactId ?? null,
            note: request.note ?? null,
          });
          let commBankLocator;
          if (submission.bankTarget?.kind === "commbank_artifact_row") {
            const artifact = await dependencies.repository.getArtifact(
              submission.bankTarget.artifactId,
            );
            if (
              !artifact ||
              artifact.artifactProfile !==
                "commbank_transaction_history_csv_v1" ||
              artifact.state !== "awaiting_review"
            )
              throw new McpToolError(
                "INVALID_BANK_ROW_LOCATOR",
                "The pinned CommBank artifact is not awaiting review.",
              );
            const review = await dependencies.documents.readReviewText(
              principal.actorUserId,
              artifact.id,
              "commbank_transaction_history_csv_v1",
            );
            const parsed = parseCommBankTransactionHistoryCsv(review.text);
            if (parsed.errors.length > 0 || parsed.rows.length === 0)
              throw new McpToolError(
                "INVALID_BANK_ROW_LOCATOR",
                "The pinned CommBank CSV must parse cleanly before row submission.",
              );
            try {
              commBankLocator = validatePreImportCommBankLocator({
                locator: submission.bankTarget,
                artifact: review.artifact,
                parsedRows: parsed.rows,
              });
            } catch {
              throw new McpToolError(
                "INVALID_BANK_ROW_LOCATOR",
                "The source row was not found in the pinned CommBank CSV.",
              );
            }
          }
          const result = await dependencies.proposalRepository.submit(
            principal.credentialId,
            submission,
            commBankLocator ? { commBankLocator } : {},
          );
          return {
            submissionId: result.submissionId,
            kind: result.kind,
            linkedId: result.linkedId,
            replayed: result.replayed,
          };
        }),
    );
  }

  if (
    hasScope(principal, "transactions:draft") ||
    hasScope(principal, "transactions:categorize")
  ) {
    server.registerTool(
      "edit_transaction",
      {
        description:
          "Edit an own still-draft transaction, or change only the category of any transaction when authorized. The exact updatedAt token is required.",
        inputSchema: fromJsonSchema<{
          transactionId: string;
          expectedUpdatedAt: string;
          changes: Record<string, unknown>;
        }>(
          jsonObject(
            {
              transactionId: { type: "string", format: "uuid" },
              expectedUpdatedAt: {
                type: "string",
                pattern:
                  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$",
              },
              changes: draftTransactionChangesJsonSchema,
            },
            ["transactionId", "expectedUpdatedAt", "changes"],
          ),
        ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = editDraftInput.parse(input);
          if (
            Object.keys(request.changes).length === 1 &&
            "category" in request.changes &&
            hasScope(principal, "transactions:categorize")
          )
            return dependencies.proposalRepository.categorizeTransaction(
              principal.credentialId,
              request.transactionId,
              request.expectedUpdatedAt,
              request.changes.category ?? null,
            );
          if (!hasScope(principal, "transactions:draft"))
            throw new ProposalAuthorizationError();
          return dependencies.proposalRepository.updateDraft(
            principal.credentialId,
            request.transactionId,
            request.expectedUpdatedAt,
            request.changes,
          );
        }),
    );
  }

  if (hasScope(principal, "bank_matches:suggest")) {
    server.registerTool(
      "suggest_existing_match",
      {
        description:
          "Suggest one recorded manual transaction for an unresolved bank row; this never creates a match.",
        inputSchema: fromJsonSchema<{
          idempotencyKey: string;
          existingTransactionId: string;
          bankTarget: {
            kind: "bank_transaction";
            bankTransactionId: string;
            expectedRevision: string;
          };
          note?: string | null;
        }>(
          jsonObject(
            {
              idempotencyKey: stringSchema(200),
              existingTransactionId: { type: "string", format: "uuid" },
              bankTarget: directBankTargetJsonSchema,
              note: nullable(stringSchema(2_000)),
            },
            ["idempotencyKey", "existingTransactionId", "bankTarget"],
          ),
        ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        runTool(async () => {
          const request = suggestMatchInput.parse(input);
          const submission = parseProposalSubmission({
            kind: "existing_match",
            idempotencyKey: request.idempotencyKey,
            existingTransactionId: request.existingTransactionId,
            bankTarget: request.bankTarget,
            note: request.note ?? null,
          });
          const result = await dependencies.proposalRepository.submit(
            principal.credentialId,
            submission,
          );
          return {
            submissionId: result.submissionId,
            kind: result.kind,
            linkedId: result.linkedId,
            replayed: result.replayed,
          };
        }),
    );
  }
};

const publicArtifact = (artifact: {
  id: string;
  artifactProfile?: string;
  kind?: string;
  filename?: string;
  originalFilename?: string;
  mediaType: string;
  byteSize: string;
  checksumSha256: string;
  state: string;
  versionId: string | null;
}) => ({
  id: artifact.id,
  profile: artifact.artifactProfile ?? artifact.kind ?? null,
  filename: artifact.originalFilename ?? artifact.filename ?? null,
  mediaType: artifact.mediaType,
  byteSize: artifact.byteSize,
  checksumSha256: artifact.checksumSha256,
  state: artifact.state,
  versionId: artifact.versionId,
});

export interface McpToolDependencies {
  config: Pick<FolioConfig, "reportingTimezone">;
  bankRepository: Pick<BankRepository, "listTransactions">;
  repository: Pick<
    FolioRepository,
    | "listTransactionPage"
    | "listArtifacts"
    | "getArtifact"
    | "getArtifactCreatorId"
  >;
  documents: Pick<
    DocumentService,
    "startIdempotentUpload" | "confirmUpload" | "readReviewText"
  >;
  proposalRepository: Pick<
    ProposalRepository,
    "submit" | "updateDraft" | "categorizeTransaction"
  >;
  getCsvDuplicateWarnings?: (
    actorId: string,
    artifactId: string,
  ) => Promise<CsvDuplicateWarningReport>;
}

export const createMcpToolRegistrar =
  (dependencies: McpToolDependencies): McpToolRegistrar =>
  (server, { principal }) => {
    registerToolsForPrincipal(server, principal, dependencies);
  };

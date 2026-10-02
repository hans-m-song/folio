import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type { ArtifactRecord } from "../documents/service";
import type { ParsedBankTransaction } from "./bank-transactions";
import { transactionInputSchema } from "./types";

export const MAX_PROPOSAL_REQUEST_BYTES = 64 * 1024;

export const proposalCredentialIssuanceScopeSchema = z.enum([
  "bank_rows:read",
  "transactions:search",
  "transactions:draft",
  "transactions:categorize",
  "bank_matches:suggest",
  "artifacts:read",
  "artifacts:upload",
]);

export const proposalCredentialScopeSchema = z.enum([
  ...proposalCredentialIssuanceScopeSchema.options,
  "submissions:read",
]);

export type ProposalCredentialIssuanceScope = z.infer<
  typeof proposalCredentialIssuanceScopeSchema
>;

export type ProposalCredentialScope = z.infer<
  typeof proposalCredentialScopeSchema
>;

export const expandCredentialScopes = (
  patterns: readonly string[],
): ProposalCredentialIssuanceScope[] => {
  const expanded = new Set<ProposalCredentialIssuanceScope>();
  for (const pattern of patterns) {
    if (pattern === "*") {
      proposalCredentialIssuanceScopeSchema.options.forEach((scope) =>
        expanded.add(scope),
      );
      continue;
    }
    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -1);
      const matches = proposalCredentialIssuanceScopeSchema.options.filter(
        (scope) => scope.startsWith(prefix),
      );
      if (matches.length === 0)
        throw new Error(`Unknown credential scope: ${pattern}`);
      matches.forEach((scope) => expanded.add(scope));
      continue;
    }
    const scope = proposalCredentialIssuanceScopeSchema.safeParse(pattern);
    if (!scope.success) throw new Error(`Unknown credential scope: ${pattern}`);
    expanded.add(scope.data);
  }
  return proposalCredentialIssuanceScopeSchema.options.filter((scope) =>
    expanded.has(scope),
  );
};

export const generateCredentialSecret = () => {
  const token = `folio_mcp_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
};

export const proposalCredentialInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    actorUserId: z.string().uuid(),
    defaultOwnerId: z.string().uuid(),
    scopes: z.array(proposalCredentialScopeSchema).min(1).max(8),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.actorUserId === input.defaultOwnerId)
      context.addIssue({
        code: "custom",
        path: ["actorUserId"],
        message: "Credential actor must be distinct from its default owner",
      });
    if (new Set(input.scopes).size !== input.scopes.length)
      context.addIssue({
        code: "custom",
        path: ["scopes"],
        message: "Credential scopes must be unique",
      });
  });

export type ProposalCredentialInput = z.infer<
  typeof proposalCredentialInputSchema
>;

const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const directBankTargetSchema = z
  .object({
    kind: z.literal("bank_transaction"),
    bankTransactionId: z.string().uuid(),
    expectedRevision: z.string().regex(/^[1-9]\d*$/),
  })
  .strict();

export const commBankArtifactRowLocatorSchema = z
  .object({
    kind: z.literal("commbank_artifact_row"),
    artifactId: z.string().uuid(),
    sourceRow: z.number().int().positive().max(1_000_000),
  })
  .strict();

export type CommBankArtifactRowLocator = z.infer<
  typeof commBankArtifactRowLocatorSchema
>;

declare const validatedCommBankLocator: unique symbol;
export type ValidatedCommBankArtifactRowLocator = CommBankArtifactRowLocator & {
  readonly [validatedCommBankLocator]: true;
};

const bankTargetSchema = z.discriminatedUnion("kind", [
  directBankTargetSchema,
  commBankArtifactRowLocatorSchema,
]);

const proposedDraftTransactionSchema = transactionInputSchema.superRefine(
  (transaction, context) => {
    if (transaction.status !== "draft")
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Proposal credentials may create drafts only",
      });
    if (transaction.ownerId !== null)
      context.addIssue({
        code: "custom",
        path: ["ownerId"],
        message: "Draft ownership is bound to the credential",
      });
    if (transaction.sourceArtifactId !== null)
      context.addIssue({
        code: "custom",
        path: ["sourceArtifactId"],
        message: "Proposed evidence must not be an approved artifact link",
      });
  },
);

const commonSubmissionFields = {
  idempotencyKey: idempotencyKeySchema,
  note: z.string().trim().max(2_000).nullable().default(null),
};

const draftTransactionProposalSchema = z
  .object({
    ...commonSubmissionFields,
    kind: z.literal("draft_transaction"),
    transaction: proposedDraftTransactionSchema,
    bankTarget: bankTargetSchema.nullable().default(null),
    proposedEvidenceArtifactId: z.string().uuid().nullable().default(null),
  })
  .strict();

const existingMatchProposalSchema = z
  .object({
    ...commonSubmissionFields,
    kind: z.literal("existing_match"),
    existingTransactionId: z.string().uuid(),
    bankTarget: directBankTargetSchema,
  })
  .strict();

export const proposalSubmissionSchema = z.discriminatedUnion("kind", [
  draftTransactionProposalSchema,
  existingMatchProposalSchema,
]);

export type ProposalSubmission = z.infer<typeof proposalSubmissionSchema>;

export const proposalDraftNotes = (
  transactionNotes: string | null,
  submissionNote: string | null,
): string | null => {
  const combined = [transactionNotes, submissionNote]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  if (combined.length > 4_000)
    throw new Error(
      "Combined draft and submission notes exceed 4000 characters",
    );
  return combined || null;
};

export const parseProposalSubmission = (input: unknown): ProposalSubmission => {
  const serialized = JSON.stringify(input);
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > MAX_PROPOSAL_REQUEST_BYTES
  )
    throw new Error("Proposal request exceeds the configured size limit");
  const parsed = proposalSubmissionSchema.parse(input);
  if (parsed.kind === "draft_transaction")
    proposalDraftNotes(parsed.transaction.notes, parsed.note);
  return parsed;
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

export const proposalPayloadHash = (submission: ProposalSubmission): string => {
  const { idempotencyKey: _idempotencyKey, ...payload } = submission;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
};

export const validatePreImportCommBankLocator = (input: {
  locator: CommBankArtifactRowLocator;
  artifact: ArtifactRecord;
  parsedRows: readonly ParsedBankTransaction[];
}): ValidatedCommBankArtifactRowLocator => {
  const locator = commBankArtifactRowLocatorSchema.parse(input.locator);
  if (
    input.artifact.id !== locator.artifactId ||
    input.artifact.artifactProfile !== "commbank_transaction_history_csv_v1" ||
    input.artifact.state !== "awaiting_review" ||
    !input.artifact.versionId
  )
    throw new Error("Pinned CommBank artifact is not awaiting review");
  if (!input.parsedRows.some((row) => row.sourceRow === locator.sourceRow))
    throw new Error("CommBank source row was not found in the pinned artifact");
  return locator as ValidatedCommBankArtifactRowLocator;
};

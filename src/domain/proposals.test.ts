import { describe, expect, it } from "vitest";

import type { ArtifactRecord } from "../documents/service";
import {
  expandCredentialScopes,
  MAX_PROPOSAL_REQUEST_BYTES,
  parseProposalSubmission,
  proposalCredentialInputSchema,
  proposalCredentialScopeSchema,
  proposalDraftNotes,
  proposalPayloadHash,
  validatePreImportCommBankLocator,
} from "./proposals";

const draft = {
  kind: "draft_transaction" as const,
  idempotencyKey: "request-1",
  transaction: { kind: "supplier_expense" as const, status: "draft" as const },
  bankTarget: null,
  proposedEvidenceArtifactId: null,
  note: "Review the synthetic invoice",
};

describe("proposal domain", () => {
  it("canonicalizes equivalent parsed payloads independently of key order", () => {
    const first = parseProposalSubmission(draft);
    const second = parseProposalSubmission({
      note: draft.note,
      proposedEvidenceArtifactId: null,
      bankTarget: null,
      transaction: { status: "draft", kind: "supplier_expense" },
      idempotencyKey: "request-1",
      kind: "draft_transaction",
    });
    expect(proposalPayloadHash(first)).toBe(proposalPayloadHash(second));
  });

  it("excludes the request key from the canonical payload checksum", () => {
    const first = parseProposalSubmission(draft);
    const retry = parseProposalSubmission({
      ...draft,
      idempotencyKey: "request-2",
    });
    expect(proposalPayloadHash(first)).toBe(proposalPayloadHash(retry));
  });

  it("rejects oversized, recorded, owner-selected, and approved-link drafts", () => {
    expect(() =>
      parseProposalSubmission({
        ...draft,
        note: "x".repeat(MAX_PROPOSAL_REQUEST_BYTES),
      }),
    ).toThrow("size limit");
    for (const transaction of [
      { kind: "supplier_expense", status: "recorded" },
      {
        kind: "supplier_expense",
        status: "draft",
        ownerId: "11111111-1111-4111-8111-111111111111",
      },
      {
        kind: "supplier_expense",
        status: "draft",
        sourceArtifactId: "11111111-1111-4111-8111-111111111111",
      },
    ])
      expect(() =>
        parseProposalSubmission({ ...draft, transaction }),
      ).toThrow();
  });

  it("requires a distinct dedicated actor and unique bounded scopes", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(() =>
      proposalCredentialInputSchema.parse({
        label: "Synthetic credential",
        tokenHash: "a".repeat(64),
        actorUserId: id,
        defaultOwnerId: id,
        scopes: ["transactions:draft", "transactions:draft"],
      }),
    ).toThrow();
  });

  it("keeps the legacy scope valid for stored credentials but not explicit issuance", () => {
    expect(proposalCredentialScopeSchema.parse("submissions:read")).toBe(
      "submissions:read",
    );
    expect(
      proposalCredentialInputSchema.safeParse({
        label: "Synthetic credential",
        tokenHash: "a".repeat(64),
        actorUserId: "22222222-2222-4222-8222-222222222222",
        defaultOwnerId: "33333333-3333-4333-8333-333333333333",
        scopes: ["submissions:read"],
      }).success,
    ).toBe(true);
    expect(() => expandCredentialScopes(["submissions:read"])).toThrow(
      "Unknown credential scope",
    );
  });

  it("expands only the current concrete credential scopes", () => {
    expect(expandCredentialScopes(["transactions:*", "artifacts:*"])).toEqual([
      "transactions:search",
      "transactions:draft",
      "transactions:categorize",
      "artifacts:read",
      "artifacts:upload",
    ]);
    expect(expandCredentialScopes(["bank_matches:*"])).toEqual([
      "bank_matches:suggest",
    ]);
    expect(expandCredentialScopes(["*"])).toHaveLength(7);
    expect(() => expandCredentialScopes(["future:*"])).toThrow(
      "Unknown credential scope",
    );
  });

  it("validates a positive row against the pinned CommBank preview", () => {
    const artifact: ArtifactRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      artifactProfile: "commbank_transaction_history_csv_v1",
      objectKey: "private/commbank/object",
      versionId: "version-1",
      mediaType: "text/csv",
      byteSize: "10",
      checksumSha256: "checksum",
      state: "awaiting_review",
    };
    expect(
      validatePreImportCommBankLocator({
        locator: {
          kind: "commbank_artifact_row",
          artifactId: artifact.id,
          sourceRow: 2,
        },
        artifact,
        parsedRows: [
          {
            sourceRow: 2,
            postedDate: "2026-09-01",
            amountAud: "-1.0000",
            description: "Synthetic row",
            metadata: {
              sourceRow: 2,
              postedDate: "2026-09-01",
              amountAud: "-1.0000",
              description: "Synthetic row",
              runningBalance: "9.0000",
            },
          },
        ],
      }),
    ).toMatchObject({ sourceRow: 2 });
    expect(() =>
      validatePreImportCommBankLocator({
        locator: {
          kind: "commbank_artifact_row",
          artifactId: artifact.id,
          sourceRow: 3,
        },
        artifact,
        parsedRows: [],
      }),
    ).toThrow("source row");
  });

  it("requires existing-match suggestions to target a concrete bank revision", () => {
    expect(() =>
      parseProposalSubmission({
        kind: "existing_match",
        idempotencyKey: "match-1",
        existingTransactionId: "11111111-1111-4111-8111-111111111111",
        bankTarget: {
          kind: "commbank_artifact_row",
          artifactId: "22222222-2222-4222-8222-222222222222",
          sourceRow: 1,
        },
      }),
    ).toThrow();
  });

  it("keeps caller notes and appends the editable submission explanation", () => {
    const parsed = parseProposalSubmission({
      ...draft,
      note: "Suggested explanation",
      transaction: {
        ...draft.transaction,
        notes: "Caller context",
      },
    });
    expect(parsed.kind).toBe("draft_transaction");
    expect(proposalDraftNotes("Caller context", "Suggested explanation")).toBe(
      "Caller context\n\nSuggested explanation",
    );
    expect(() =>
      parseProposalSubmission({
        ...draft,
        note: "x".repeat(2_000),
        transaction: {
          ...draft.transaction,
          notes: "y".repeat(4_000),
        },
      }),
    ).toThrow("Combined draft");
  });
});

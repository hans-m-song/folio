import { describe, expect, it, vi } from "vitest";

import {
  parseProposalSubmission,
  proposalPayloadHash,
  validatePreImportCommBankLocator,
} from "../domain/proposals";
import {
  ProposalAuthorizationError,
  ProposalDraftNotEditableError,
  ProposalIdempotencyConflictError,
  ProposalRepository,
} from "./proposal-repository";

const credentialId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const humanOwnerId = "88888888-8888-4888-8888-888888888888";
const administratorId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
const bankId = "66666666-6666-4666-8666-666666666666";
const transactionId = "77777777-7777-4777-8777-777777777777";

const credentialRow = {
  id: credentialId,
  label: "Synthetic proposal credential",
  actor_user_id: actorId,
  default_owner_id: ownerId,
  scopes: ["proposals:submit", "submissions:read"],
  created_by_id: administratorId,
  revoked_at: null,
  created_at: new Date("2026-09-26T00:00:00.000Z"),
};

const draftSubmission = parseProposalSubmission({
  kind: "draft_transaction",
  idempotencyKey: "draft-request-1",
  transaction: {
    kind: "supplier_expense",
    status: "draft",
    counterparty: "Synthetic supplier",
    documentCurrency: "AUD",
    documentAmount: "10.0000",
    notes: "Caller context",
  },
  note: "Review suggestion",
});

const repositoryWithClients = (...queries: Array<ReturnType<typeof vi.fn>>) => {
  const clients = queries.map((query) => ({ query, release: vi.fn() }));
  return {
    repository: new ProposalRepository(
      {
        connect: vi.fn().mockImplementation(async () => clients.shift()),
      } as never,
      "folio",
      false,
    ),
    clients,
  };
};

describe("proposal repository", () => {
  const editableDraftRow = {
    id: draftId,
    owner_id: humanOwnerId,
    source_system: "manual",
    status: "draft",
    kind: "supplier_expense",
    reference: null,
    counterparty: "Synthetic supplier",
    description: null,
    category: null,
    notes: null,
    occurred_at: null,
    available_at: null,
    invoice_date: new Date("2026-05-30T14:00:00.000Z"),
    invoice_date_text: "2026-05-31",
    settled_at: null,
    document_currency: "AUD",
    document_amount: "10.0000",
    document_tax_amount: null,
    tax_treatment: "no_tax",
    settlement_currency: null,
    settlement_amount: null,
    gst_credit_status: "not_registered",
    claimable_gst_aud: "0.0000",
  };

  it("updates only its credential-owned draft fields without a revision token", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({ rows: [editableDraftRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ updated_at: new Date("2026-09-27T00:00:00.000Z") }],
      })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    await expect(
      repository.updateDraft(credentialId, draftId, {
        reference: "INV-42",
        documentAmount: "37.0800",
      }),
    ).resolves.toEqual({
      transactionId: draftId,
      updatedAt: "2026-09-27T00:00:00.000Z",
    });
    expect(query.mock.calls[2]?.[0]).toContain("submission.credential_id=$2");
    expect(query.mock.calls[4]?.[0]).toContain("status='draft'");
    expect(query.mock.calls[4]?.[1]).toContain("INV-42");
    expect(query.mock.calls[4]?.[1]).toContain("37.0800");
    expect(query.mock.calls[4]?.[1]).toContain("2026-05-31");
    expect(query.mock.calls[4]?.[1]).toContain(humanOwnerId);
    expect(query.mock.calls[4]?.[1]).toContain(actorId);
  });

  it.each([
    { row: null, error: ProposalAuthorizationError },
    {
      row: { ...editableDraftRow, status: "recorded" },
      error: ProposalDraftNotEditableError,
    },
  ])(
    "rejects another credential's or no-longer-draft record",
    async ({ row, error }) => {
      const query = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [credentialRow] })
        .mockResolvedValueOnce({ rows: row ? [row] : [] })
        .mockResolvedValueOnce({});
      const { repository } = repositoryWithClients(query);

      await expect(
        repository.updateDraft(credentialId, draftId, { reference: "INV-42" }),
      ).rejects.toBeInstanceOf(error);
      expect(
        query.mock.calls.some(([statement]) =>
          String(statement).startsWith("UPDATE"),
        ),
      ).toBe(false);
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    },
  );

  it("stores only a hash while binding a distinct actor and owner", async () => {
    const tokenHash = "a".repeat(64);
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          { id: administratorId, role: "administrator", active: true },
          { id: actorId, role: "member", active: true },
          { id: ownerId, role: "member", active: true },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ ...credentialRow }], rowCount: 1 })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    await expect(
      repository.createCredential(administratorId, {
        label: credentialRow.label,
        tokenHash,
        actorUserId: actorId,
        defaultOwnerId: ownerId,
        scopes: ["proposals:submit", "submissions:read"],
      }),
    ).resolves.toMatchObject({ actorUserId: actorId, defaultOwnerId: ownerId });
    expect(query.mock.calls[2]?.[0]).toContain("token_hash");
    expect(query.mock.calls[2]?.[0]).not.toMatch(/token(?!_hash)/);
    expect(query.mock.calls[2]?.[1]).toContain(tokenHash);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("requires a dedicated actor distinct from the provisioning administrator", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          { id: administratorId, role: "administrator", active: true },
          { id: ownerId, role: "member", active: true },
        ],
      })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    await expect(
      repository.createCredential(administratorId, {
        label: credentialRow.label,
        tokenHash: "c".repeat(64),
        actorUserId: administratorId,
        defaultOwnerId: ownerId,
        scopes: ["proposals:submit"],
      }),
    ).rejects.toBeInstanceOf(ProposalAuthorizationError);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).startsWith("INSERT"),
      ),
    ).toBe(false);
  });

  it.each([
    {
      label: "missing administrator",
      users: [{ id: actorId, role: "member", active: true }],
      participant: "administrator",
      reason: "not_found",
    },
    {
      label: "inactive actor",
      users: [
        { id: administratorId, role: "administrator", active: true },
        { id: actorId, role: "member", active: false },
        { id: ownerId, role: "member", active: true },
      ],
      participant: "actor",
      reason: "inactive",
    },
    {
      label: "actor with an unsupported role",
      users: [
        { id: administratorId, role: "administrator", active: true },
        { id: actorId, role: "viewer", active: true },
        { id: ownerId, role: "member", active: true },
      ],
      participant: "actor",
      reason: "wrong_role",
    },
    {
      label: "missing owner",
      users: [
        { id: administratorId, role: "administrator", active: true },
        { id: actorId, role: "member", active: true },
      ],
      participant: "owner",
      reason: "not_found",
    },
  ])(
    "identifies the $label before inserting",
    async ({ users, participant, reason }) => {
      const query = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: users })
        .mockResolvedValueOnce({});
      const { repository } = repositoryWithClients(query);

      await expect(
        repository.createCredential(administratorId, {
          label: credentialRow.label,
          tokenHash: "d".repeat(64),
          actorUserId: actorId,
          defaultOwnerId: ownerId,
          scopes: ["proposals:submit"],
        }),
      ).rejects.toMatchObject({
        name: "ProposalCredentialEligibilityError",
        participant,
        reason,
      });
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(
        query.mock.calls.some(([statement]) =>
          String(statement).startsWith("INSERT"),
        ),
      ).toBe(false);
    },
  );

  it("resolves only active, unrevoked credentials with the requested scope", async () => {
    const tokenHash = "b".repeat(64);
    const query = vi.fn().mockResolvedValue({ rows: [credentialRow] });
    const repository = new ProposalRepository(
      { query } as never,
      "folio",
      false,
    );

    await expect(
      repository.credentialForTokenHash(tokenHash),
    ).resolves.toMatchObject({ id: credentialId });
    expect(query.mock.calls[0]?.[0]).toMatch(
      /token_hash=\$1.*revoked_at IS NULL.*\$2::text IS NULL OR \$2=ANY\(credential\.scopes\)/s,
    );
    expect(query.mock.calls[0]?.[1]).toEqual([tokenHash, null]);
    await expect(
      repository.credentialForTokenHash("plaintext-token", "proposals:submit"),
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it("creates one forced-owner draft and replays the same canonical request", async () => {
    const firstQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: draftId }], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const existingSubmission = {
      id: "88888888-8888-4888-8888-888888888888",
      kind: "draft_transaction",
      draft_transaction_id: draftId,
      proposed_transaction_id: null,
      payload_sha256: proposalPayloadHash(draftSubmission),
    };
    const retryQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [existingSubmission] })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(firstQuery, retryQuery);

    const first = await repository.submit(credentialId, draftSubmission);
    const retry = await repository.submit(credentialId, draftSubmission);

    expect(first).toMatchObject({
      kind: "draft_transaction",
      linkedId: draftId,
      replayed: false,
    });
    expect(retry).toEqual({
      submissionId: existingSubmission.id,
      kind: "draft_transaction",
      linkedId: draftId,
      replayed: true,
    });
    expect(firstQuery.mock.calls[4]?.[0]).toContain("'manual'");
    expect(firstQuery.mock.calls[4]?.[0]).toContain("'draft'");
    expect(firstQuery.mock.calls[4]?.[1]?.slice(0, 2)).toEqual([
      ownerId,
      actorId,
    ]);
    expect(firstQuery.mock.calls[4]?.[1]?.[7]).toBe(
      "Caller context\n\nReview suggestion",
    );
    expect(
      firstQuery.mock.calls.some(([statement]) =>
        String(statement).includes("transaction_artifacts"),
      ),
    ).toBe(false);
    expect(
      firstQuery.mock.calls.some(([statement]) =>
        String(statement).startsWith("UPDATE"),
      ),
    ).toBe(false);
  });

  it("conflicts without creating a draft when the same key has a changed payload", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            payload_sha256: "f".repeat(64),
          },
        ],
      })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    await expect(
      repository.submit(credentialId, draftSubmission),
    ).rejects.toBeInstanceOf(ProposalIdempotencyConflictError);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).startsWith('INSERT INTO "folio"."transactions"'),
      ),
    ).toBe(false);
  });

  it("stores an existing-match suggestion without mutating the bank row", async () => {
    const submission = parseProposalSubmission({
      kind: "existing_match",
      idempotencyKey: "match-request-1",
      existingTransactionId: transactionId,
      bankTarget: {
        kind: "bank_transaction",
        bankTransactionId: bankId,
        expectedRevision: "7",
      },
      note: "Review this candidate",
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            revision: "7",
            matched_transaction_id: null,
            classification: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ source_system: "manual", status: "recorded" }],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    await expect(
      repository.submit(credentialId, submission),
    ).resolves.toMatchObject({
      kind: "existing_match",
      linkedId: transactionId,
      replayed: false,
    });
    expect(query.mock.calls[6]?.[0]).toContain("mcp_submissions");
    expect(
      query.mock.calls.some(([statement]) =>
        /^UPDATE .*bank_transactions/.test(String(statement)),
      ),
    ).toBe(false);
  });

  it("stores validated CommBank provenance and proposed PDF evidence without approved links", async () => {
    const commBankArtifactId = "99999999-9999-4999-8999-999999999999";
    const evidenceArtifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const locator = {
      kind: "commbank_artifact_row" as const,
      artifactId: commBankArtifactId,
      sourceRow: 12,
    };
    const submission = parseProposalSubmission({
      ...draftSubmission,
      idempotencyKey: "locator-request-1",
      bankTarget: locator,
      proposedEvidenceArtifactId: evidenceArtifactId,
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            artifact_profile: "commbank_transaction_history_csv_v1",
            state: "awaiting_review",
            version_id: "commbank-version",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            artifact_profile: "manual_invoice_pdf_v1",
            state: "awaiting_review",
            version_id: "invoice-version",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: draftId }], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    const validatedLocator = validatePreImportCommBankLocator({
      locator,
      artifact: {
        id: commBankArtifactId,
        artifactProfile: "commbank_transaction_history_csv_v1",
        objectKey: "private/commbank/object",
        versionId: "commbank-version",
        mediaType: "text/csv",
        byteSize: "10",
        checksumSha256: "checksum",
        state: "awaiting_review",
      },
      parsedRows: [
        {
          sourceRow: 12,
          postedDate: "2026-09-01",
          amountAud: "-1.0000",
          description: "Synthetic row",
          metadata: {
            sourceRow: 12,
            postedDate: "2026-09-01",
            amountAud: "-1.0000",
            description: "Synthetic row",
            runningBalance: "9.0000",
          },
        },
      ],
    });
    await expect(
      repository.submit(credentialId, submission, {
        commBankLocator: validatedLocator,
      }),
    ).resolves.toMatchObject({ linkedId: draftId });
    expect(query.mock.calls[7]?.[1]?.slice(9, 12)).toEqual([
      commBankArtifactId,
      12,
      evidenceArtifactId,
    ]);
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes("transaction_artifacts"),
      ),
    ).toBe(false);
  });

  it("rejects an unauthorized credential and a Stripe row locator before writes", async () => {
    const unauthorized = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    const stripeLocator = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            artifact_profile: "stripe_balance_itemised_csv_v1",
            state: "awaiting_review",
            version_id: "stripe-version",
          },
        ],
      })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(unauthorized, stripeLocator);
    const locatorSubmission = parseProposalSubmission({
      ...draftSubmission,
      idempotencyKey: "locator-request-2",
      bankTarget: {
        kind: "commbank_artifact_row",
        artifactId: "99999999-9999-4999-8999-999999999999",
        sourceRow: 1,
      },
    });

    await expect(
      repository.submit(credentialId, draftSubmission),
    ).rejects.toThrow("not authorized");
    await expect(
      repository.submit(credentialId, locatorSubmission),
    ).rejects.toThrow("application-layer row validation");
    expect(
      stripeLocator.mock.calls.some(([statement]) =>
        String(statement).startsWith("INSERT"),
      ),
    ).toBe(false);
  });

  it("returns only direct or resolved-locator suggestions for one bank row", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          submission_id: "88888888-8888-4888-8888-888888888888",
          kind: "draft_transaction",
          note: "Synthetic note",
          observed_bank_revision: "4",
          created_at: new Date("2026-09-26T00:00:00.000Z"),
          transaction_id: draftId,
          status: "draft",
          transaction_kind: "supplier_expense",
          counterparty: "Synthetic supplier",
          reference: null,
          document_currency: "AUD",
          document_amount: "10.0000",
          settlement_currency: null,
          settlement_amount: null,
          current_bank_revision: "4",
          matched_transaction_id: null,
          classification: null,
        },
      ],
    });
    const repository = new ProposalRepository(
      { query } as never,
      "folio",
      false,
    );

    await expect(repository.listSuggestionsForBankRow(bankId)).resolves.toEqual(
      [
        {
          submissionId: "88888888-8888-4888-8888-888888888888",
          kind: "draft_transaction",
          note: "Synthetic note",
          observedBankRevision: "4",
          createdAt: "2026-09-26T00:00:00.000Z",
          actionability: "actionable",
          transaction: {
            id: draftId,
            status: "draft",
            kind: "supplier_expense",
            counterparty: "Synthetic supplier",
            reference: null,
            documentCurrency: "AUD",
            documentAmount: "10.0000",
            settlementCurrency: null,
            settlementAmount: null,
          },
        },
      ],
    );
    expect(query.mock.calls[0]?.[0]).toMatch(
      /submission\.bank_transaction_id=\$1[\s\S]*link\.bank_transaction_id=\$1/,
    );
    expect(query.mock.calls[0]?.[0]).toContain("LIMIT 100");
    expect(query.mock.calls[0]?.[1]).toEqual([bankId]);
  });

  it.each([
    [{ current_bank_revision: "5" }, "stale"],
    [{ matched_transaction_id: draftId }, "resolved"],
  ] as const)(
    "marks changed or resolved bank rows as %s",
    async (bankState, expected) => {
      const query = vi.fn().mockResolvedValue({
        rows: [
          {
            submission_id: "88888888-8888-4888-8888-888888888888",
            kind: "draft_transaction",
            note: null,
            observed_bank_revision: "4",
            created_at: new Date("2026-09-26T00:00:00.000Z"),
            transaction_id: draftId,
            status: "draft",
            transaction_kind: "supplier_expense",
            counterparty: null,
            reference: null,
            document_currency: "AUD",
            document_amount: "10.0000",
            settlement_currency: null,
            settlement_amount: null,
            current_bank_revision: "4",
            matched_transaction_id: null,
            classification: null,
            ...bankState,
          },
        ],
      });
      const repository = new ProposalRepository(
        { query } as never,
        "folio",
        false,
      );

      const suggestions = await repository.listSuggestionsForBankRow(bankId);

      expect(suggestions[0]?.actionability).toBe(expected);
    },
  );

  it("returns status only through the credential-scoped lookup", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [credentialRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            kind: "draft_transaction",
            draft_transaction_id: draftId,
            proposed_transaction_id: null,
            transaction_status: "recorded",
            bank_transaction_id: null,
            resolved_bank_transaction_id: bankId,
            matched_transaction_id: null,
            classification: null,
            created_at: new Date("2026-09-26T00:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({});
    const { repository } = repositoryWithClients(query);

    await expect(
      repository.getSubmissionStatus(
        credentialId,
        "88888888-8888-4888-8888-888888888888",
      ),
    ).resolves.toMatchObject({
      linkedId: draftId,
      outcome: "recorded",
      intendedBankTransactionId: null,
      resolvedBankTransactionId: bankId,
    });
    expect(query.mock.calls[2]?.[0]).toContain("submission.credential_id=$2");
  });

  it("reads and persistently discards proposed evidence for an authenticated human", async () => {
    const evidenceArtifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const proposed = {
      submission_id: "88888888-8888-4888-8888-888888888888",
      draft_transaction_id: draftId,
      proposed_evidence_artifact_id: evidenceArtifactId,
      note: "Review this invoice",
      evidence_discarded_at: null,
      filename: "synthetic-invoice.pdf",
      state: "awaiting_review",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [proposed] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...proposed,
            evidence_discarded_at: new Date("2026-09-26T01:00:00.000Z"),
          },
        ],
      });
    const repository = new ProposalRepository(
      { query } as never,
      "folio",
      false,
    );

    await expect(
      repository.getProposedEvidenceForDraft(actorId, draftId),
    ).resolves.toEqual({
      submissionId: proposed.submission_id,
      transactionId: draftId,
      artifactId: evidenceArtifactId,
      filename: "synthetic-invoice.pdf",
      state: "awaiting_review",
      note: "Review this invoice",
      discardedAt: null,
    });
    await expect(
      repository.discardProposedEvidenceForDraft(actorId, draftId),
    ).resolves.toMatchObject({
      artifactId: evidenceArtifactId,
      discardedAt: "2026-09-26T01:00:00.000Z",
    });
    expect(query.mock.calls[0]?.[0]).toContain("actor.active=true");
    expect(query.mock.calls[1]?.[0]).toContain("evidence_discarded_at");
    expect(query.mock.calls[1]?.[0]).toContain("evidence_discarded_by_id");
  });
});

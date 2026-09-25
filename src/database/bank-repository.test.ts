import { describe, expect, it, vi } from "vitest";

import { BankRepository } from "./bank-repository";
import { transactionInputSchema } from "../domain/types";

describe("bank repository queries", () => {
  it("serializes CommBank confirmation and re-requests acknowledgement when overlaps change", async () => {
    const artifactId = "11111111-1111-4111-8111-111111111111";
    const artifactA = "22222222-2222-4222-8222-222222222222";
    const artifactB = "33333333-3333-4333-8333-333333333333";
    const overlapsA = [
      {
        id: artifactA,
        filename: "first.csv",
        overlap_start: "2026-09-01",
        overlap_end: "2026-09-05",
      },
    ];
    const overlapsAB = [
      ...overlapsA,
      {
        id: artifactB,
        filename: "second.csv",
        overlap_start: "2026-09-04",
        overlap_end: "2026-09-07",
      },
    ];
    const overlapsABInReverse = [...overlapsAB].reverse();
    const row = {
      sourceRow: 1,
      postedDate: "2026-09-02",
      amountAud: "-1.0000",
      description: "Synthetic movement",
      metadata: {
        sourceRow: 1,
        postedDate: "2026-09-02",
        amountAud: "-1.0000",
        description: "Synthetic movement",
        runningBalance: "10.0000",
      },
    };
    const confirmWithOverlaps = async (
      overlapRows: typeof overlapsA,
      acknowledgedOverlapFingerprint: string | null,
    ) => {
      const query = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [
            {
              id: artifactId,
              artifact_profile: "commbank_transaction_history_csv_v1",
              state: "pending",
              checksum_sha256: "synthetic-checksum",
            },
          ],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: overlapRows })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: "44444444-4444-4444-8444-444444444444" }],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const release = vi.fn();
      const result = await new BankRepository(
        {
          connect: vi.fn().mockResolvedValue({ query, release }),
        } as never,
        "folio",
      ).confirmImport({
        actorId: "55555555-5555-4555-8555-555555555555",
        artifactId,
        versionId: "synthetic-version",
        rows: [row],
        earliestDate: "2026-09-02",
        latestDate: "2026-09-02",
        acknowledgedOverlapFingerprint,
      });
      return { result, query, release };
    };

    const first = await confirmWithOverlaps(overlapsA, null);
    expect(first.result).toMatchObject({
      status: "overlap_acknowledgement_required",
      overlaps: [
        {
          artifactId: artifactA,
          filename: "first.csv",
          overlapStart: "2026-09-01",
          overlapEnd: "2026-09-05",
        },
      ],
    });
    if (first.result.status !== "overlap_acknowledgement_required")
      throw new Error("Expected initial overlap acknowledgement");
    expect(first.query.mock.calls[2]?.[0]).toMatch(/pg_advisory_xact_lock/);
    expect(first.query.mock.calls[2]?.[1]).toEqual([
      "commbank_transaction_history_csv_v1:imports",
    ]);
    expect(first.query.mock.calls[3]?.[0]).toMatch(
      /source_artifacts.*WHERE id=\$1 FOR UPDATE/s,
    );
    expect(first.query.mock.calls[4]?.[0]).toMatch(/pg_advisory_xact_lock/);
    expect(first.query.mock.calls[4]?.[1]).toEqual([
      "commbank_transaction_history_csv_v1:synthetic-checksum",
    ]);
    expect(first.query.mock.calls[6]?.[0]).toMatch(
      /daterange\(min\(bank\.posted_date\)/,
    );
    expect(first.release).toHaveBeenCalledOnce();

    const changed = await confirmWithOverlaps(
      overlapsAB,
      first.result.overlapFingerprint,
    );
    expect(changed.result.status).toBe("overlap_acknowledgement_required");
    if (changed.result.status !== "overlap_acknowledgement_required")
      throw new Error("Expected changed overlap acknowledgement");
    expect(changed.result.overlapFingerprint).not.toBe(
      first.result.overlapFingerprint,
    );
    expect(changed.query.mock.calls[7]?.[0]).toBe("COMMIT");

    const acknowledged = await confirmWithOverlaps(
      overlapsABInReverse,
      changed.result.overlapFingerprint,
    );
    expect(acknowledged.result).toEqual({
      status: "imported",
      artifactId,
      rowCount: 1,
    });
    expect(acknowledged.query.mock.calls[7]?.[0]).toMatch(
      /UPDATE .*source_artifacts.*state='available'/s,
    );
    expect(acknowledged.query.mock.calls[8]?.[0]).toMatch(
      /INSERT INTO .*bank_transactions/,
    );
    expect(acknowledged.query.mock.calls[9]?.[0]).toMatch(
      /INSERT INTO .*bank_transaction_artifacts/,
    );
  });

  it("imports without warning when the serialized overlap query is empty", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            artifact_profile: "commbank_transaction_history_csv_v1",
            state: "pending",
            checksum_sha256: "synthetic-checksum",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const result = await new BankRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
    ).confirmImport({
      actorId: "33333333-3333-4333-8333-333333333333",
      artifactId: "11111111-1111-4111-8111-111111111111",
      versionId: "synthetic-version",
      rows: [
        {
          sourceRow: 1,
          postedDate: "2026-09-02",
          amountAud: "-1.0000",
          description: "Synthetic movement",
          metadata: {
            sourceRow: 1,
            postedDate: "2026-09-02",
            amountAud: "-1.0000",
            description: "Synthetic movement",
            runningBalance: "10.0000",
          },
        },
      ],
      earliestDate: "2026-09-02",
      latestDate: "2026-09-02",
      acknowledgedOverlapFingerprint: null,
    });

    expect(result).toEqual({
      status: "imported",
      artifactId: "11111111-1111-4111-8111-111111111111",
      rowCount: 1,
    });
  });

  it("preserves the exact-checksum already-imported recovery before overlap lookup", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            artifact_profile: "commbank_transaction_history_csv_v1",
            state: "pending",
            checksum_sha256: "synthetic-checksum",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ count: 9 }] })
      .mockResolvedValueOnce({});
    const result = await new BankRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
    ).confirmImport({
      actorId: "33333333-3333-4333-8333-333333333333",
      artifactId: "11111111-1111-4111-8111-111111111111",
      versionId: "synthetic-version",
      rows: [],
      earliestDate: "2026-09-02",
      latestDate: "2026-09-02",
      acknowledgedOverlapFingerprint: null,
    });

    expect(result).toEqual({
      status: "already_imported",
      artifactId: "22222222-2222-4222-8222-222222222222",
      rowCount: 9,
    });
    expect(query.mock.calls[5]?.[0]).toMatch(/checksum_sha256=\$3/);
    expect(query).toHaveBeenCalledTimes(9);
  });

  it("returns exact overview counts and bounded non-PII bank snapshots", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ unresolved_bank_rows: 7, imports_with_unresolved_rows: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            posted_date_text: "2026-09-23",
            amount_aud: "-12.3400",
            matched_transaction_id: null,
            classification: null,
            updated_at: new Date("2026-09-23T01:00:00Z"),
          },
        ],
      });

    await expect(
      new BankRepository({ query } as never, "folio").overviewSummary("actor"),
    ).resolves.toEqual({
      unresolvedBankRows: 7,
      importsWithUnresolvedRows: 2,
      recentBankRows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          postedDate: "2026-09-23",
          amountAud: "-12.3400",
          reviewState: "unresolved",
          updatedAt: "2026-09-23T01:00:00.000Z",
        },
      ],
    });
    expect(query.mock.calls[1]?.[0]).toMatch(
      /count\(\*\).*unresolved_bank_rows.*count\(DISTINCT link\.source_artifact_id\).*artifact\.state='available'/s,
    );
    expect(query.mock.calls[2]?.[0]).toContain(
      "ORDER BY updated_at DESC, id DESC LIMIT 5",
    );
    expect(query.mock.calls[2]?.[0]).not.toMatch(/description|metadata/);
    expect(query.mock.calls[2]).toHaveLength(1);
  });

  it("ranks reconciliation candidates from raw bank description, not legacy counterparty metadata", async () => {
    const bankTransactionId = "11111111-1111-4111-8111-111111111111";
    const actorId = "22222222-2222-4222-8222-222222222222";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: bankTransactionId,
            posted_date_text: "2026-09-23",
            amount_aud: "-35.0000",
            description: "PAYMENT TO ACME",
            metadata: {
              valueDate: "2026-09-24",
              counterpartySuggestion: "Legacy Vendor",
            },
            matched_transaction_id: null,
            classification: null,
            revision: "1",
            artifact_id: "33333333-3333-4333-8333-333333333333",
            artifact_ids: ["33333333-3333-4333-8333-333333333333"],
            source_artifact_ids: ["33333333-3333-4333-8333-333333333333"],
            artifact_profile: "commbank_transaction_history_csv_v1",
            filename: "synthetic.csv",
            source_row: "17",
            earliest_date: "2026-09-23",
            latest_date: "2026-09-23",
            created_at: new Date("2026-09-23T00:00:00Z"),
            updated_at: new Date("2026-09-23T00:00:00Z"),
            updated_by_id: actorId,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            settled_at: new Date("2026-09-24T00:00:00Z"),
            kind: "supplier_expense",
            counterparty: "Legacy Vendor",
            reference: null,
            description: null,
            amount_aud: "-35.0000",
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            settled_at: new Date("2026-09-24T00:00:00Z"),
            kind: "supplier_expense",
            counterparty: "ACME Systems",
            reference: null,
            description: null,
            amount_aud: "-35.0000",
          },
        ],
      });

    const detail = await new BankRepository(
      { query } as never,
      "folio",
    ).reconciliationDetail(actorId, bankTransactionId, 14);

    expect(detail?.bankTransaction.metadata.counterpartySuggestion).toBe(
      "Legacy Vendor",
    );
    expect(
      detail?.candidates.map(({ counterparty, textScore }) => [
        counterparty,
        textScore,
      ]),
    ).toEqual([
      ["ACME Systems", 4],
      ["Legacy Vendor", 0],
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      "-35.0000",
      "2026-09-24",
      14,
      bankTransactionId,
    ]);
  });

  it("returns one activity row with every deterministic source attribution", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          posted_date: new Date("2025-12-31T14:00:00.000Z"),
          posted_date_text: "2026-01-01",
          amount_aud: "-1.0000",
          description: "Synthetic",
          metadata: { sourceRow: 1 },
          matched_transaction_id: null,
          classification: null,
          revision: "1",
          source_artifact_ids: [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
          ],
          created_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const rows = await new BankRepository(
      { query } as never,
      "folio",
    ).listTransactions("actor", { limit: 50, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      postedDate: "2026-01-01",
      reviewState: "unresolved",
      artifactId: "22222222-2222-4222-8222-222222222222",
      artifactIds: [
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
    });
    expect(query.mock.calls[0]?.[0]).toContain(
      "bank.posted_date::text AS posted_date_text",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "array_agg(link.source_artifact_id ORDER BY link.source_artifact_id)",
    );
    expect(query.mock.calls[0]?.[1]).toEqual(["actor", null, null, 50, 0]);
  });

  it("abandons only the actor's pending CommBank artifact", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await expect(
      new BankRepository({ query } as never, "folio").abandonPending(
        "actor",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toBeUndefined();
    expect(query.mock.calls[0]?.[0]).toMatch(
      /created_by_id=\$2.*artifact_profile=\$3.*state='pending'/s,
    );
  });

  it("locks the bank row before an exact-match transaction and applies one revision", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            amount_aud: "10.0000",
            revision: "4",
            matched_transaction_id: null,
            classification: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            source_system: "manual",
            status: "recorded",
            kind: "sale",
            settled_at: new Date("2026-09-23T00:00:00Z"),
            settlement_currency: "AUD",
            settlement_amount: "10.0000",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ revision: "5" }] })
      .mockResolvedValueOnce({});
    const release = vi.fn();
    const result = await new BankRepository(
      { connect: vi.fn().mockResolvedValue({ query, release }) } as never,
      "folio",
    ).reconcile({
      actorId: "actor",
      bankTransactionId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: "4",
      command: {
        type: "match",
        transactionId: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(result).toEqual({ status: "applied", revision: "5" });
    expect(query.mock.calls[2]?.[0]).toMatch(/bank_transactions.*FOR UPDATE/s);
    expect(query.mock.calls[3]?.[0]).toMatch(/transactions.*FOR UPDATE/s);
    expect(release).toHaveBeenCalledOnce();
  });

  it("treats a stale replay of the same classification as already applied", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            revision: "8",
            matched_transaction_id: null,
            classification: "private",
          },
        ],
      })
      .mockResolvedValueOnce({});
    const result = await new BankRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
    ).reconcile({
      actorId: "actor",
      bankTransactionId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: "1",
      command: { type: "classify", classification: "private" },
    });

    expect(result).toEqual({ status: "already_applied", revision: "8" });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("locks available invoice artifacts in deterministic order before create-and-match links", async () => {
    const lowerArtifactId = "22222222-2222-4222-8222-222222222222";
    const higherArtifactId = "33333333-3333-4333-8333-333333333333";
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            amount_aud: "-10.0000",
            revision: "1",
            matched_transaction_id: null,
            classification: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: lowerArtifactId,
            artifact_profile: "manual_invoice_pdf_v1",
            state: "available",
          },
          {
            id: higherArtifactId,
            artifact_profile: "manual_invoice_pdf_v1",
            state: "available",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ revision: "2" }] })
      .mockResolvedValueOnce({});
    const result = await new BankRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
    ).createAndMatch({
      actorId: "44444444-4444-4444-8444-444444444444",
      bankTransactionId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: "1",
      transactionId: "55555555-5555-4555-8555-555555555555",
      transaction: transactionInputSchema.parse({
        ownerId: "44444444-4444-4444-8444-444444444444",
        kind: "supplier_expense",
        status: "recorded",
        settledAt: "2026-09-23T00:00:00.000Z",
        settlementCurrency: "AUD",
        settlementAmount: "10.0000",
      }),
      artifactIds: [higherArtifactId, lowerArtifactId, higherArtifactId],
    });

    expect(result).toEqual({
      status: "applied",
      revision: "2",
      transactionId: "55555555-5555-4555-8555-555555555555",
    });
    expect(query.mock.calls[2]?.[0]).toMatch(/bank_transactions.*FOR UPDATE/s);
    expect(query.mock.calls[3]?.[0]).toMatch(
      /source_artifacts.*ORDER BY id FOR UPDATE/s,
    );
    expect(query.mock.calls[3]?.[1]).toEqual([
      [lowerArtifactId, higherArtifactId],
    ]);
    expect(query.mock.calls[5]?.[1]).toEqual([
      "55555555-5555-4555-8555-555555555555",
      lowerArtifactId,
    ]);
    expect(query.mock.calls[6]?.[1]).toEqual([
      "55555555-5555-4555-8555-555555555555",
      higherArtifactId,
    ]);
  });

  it("rolls back before creation when a locked artifact became superseded", async () => {
    const artifactId = "22222222-2222-4222-8222-222222222222";
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            amount_aud: "-10.0000",
            revision: "1",
            matched_transaction_id: null,
            classification: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: artifactId,
            artifact_profile: "manual_invoice_pdf_v1",
            state: "superseded",
          },
        ],
      })
      .mockResolvedValueOnce({});
    const repository = new BankRepository(
      {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      } as never,
      "folio",
    );

    await expect(
      repository.createAndMatch({
        actorId: "44444444-4444-4444-8444-444444444444",
        bankTransactionId: "11111111-1111-4111-8111-111111111111",
        expectedRevision: "1",
        transactionId: "55555555-5555-4555-8555-555555555555",
        transaction: transactionInputSchema.parse({
          ownerId: "44444444-4444-4444-8444-444444444444",
          kind: "supplier_expense",
          status: "recorded",
          settledAt: "2026-09-23T00:00:00.000Z",
          settlementCurrency: "AUD",
          settlementAmount: "10.0000",
        }),
        artifactIds: [artifactId],
      }),
    ).rejects.toThrow("available invoice PDFs");
    expect(query.mock.calls[3]?.[0]).toMatch(/ORDER BY id FOR UPDATE/);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).startsWith('INSERT INTO "folio"."transactions"'),
      ),
    ).toBe(false);
  });
});

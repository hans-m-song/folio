import { request as httpRequest } from "node:http";

import {
  ProposalIdempotencyConflictError,
  ProposalTransactionConflictError,
} from "../database/proposal-repository";
import type { ArtifactRecord } from "../documents/service";
import { describe, expect, it, vi } from "vitest";

import { MCP_SCOPES, type McpPrincipal } from "./server";
import { startMcpServer, type StartMcpServerOptions } from "./start";
import { createMcpToolRegistrar, type McpToolDependencies } from "./tools";

const ids = {
  credential: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000003",
  artifact: "00000000-0000-4000-8000-000000000004",
  bankRow: "00000000-0000-4000-8000-000000000005",
  transaction: "00000000-0000-4000-8000-000000000006",
  submission: "00000000-0000-4000-8000-000000000007",
};

const principal = (
  scopes: readonly McpPrincipal["scopes"][number][] = MCP_SCOPES,
) =>
  ({
    credentialId: ids.credential,
    actorUserId: ids.actor,
    defaultOwnerId: ids.owner,
    scopes,
  }) satisfies McpPrincipal;

const artifact = {
  id: ids.artifact,
  artifactProfile: "commbank_transaction_history_csv_v1" as const,
  kind: undefined,
  objectKey: "private/internal-object-key",
  versionId: "immutable-version-1",
  mediaType: "text/csv",
  byteSize: "42",
  checksumSha256: `${"A".repeat(43)}=`,
  state: "awaiting_review" as const,
  filename: "statement.csv",
  originalFilename: "statement.csv",
};

const csvWarningReport = {
  artifactId: ids.artifact,
  profile: "commbank_transaction_history_csv_v1" as const,
  rowCount: 1,
  rowIdentityLimitReached: false,
  warnings: [
    {
      reason: "same_filename" as const,
      totalArtifactCount: 1,
      truncated: false,
      matches: [
        {
          artifactId: "00000000-0000-4000-8000-000000000008",
          filename: "statement.csv",
          matchingRowCount: null,
        },
      ],
    },
  ],
};

const createDependencies = () => {
  const bankRepository = {
    listTransactions: vi.fn(async () => [
      {
        id: ids.bankRow,
        postedDate: "2026-01-01",
        amountAud: "-1.00",
        description: "Synthetic row",
        metadata: { description: "Synthetic row" },
        matchedTransactionId: null,
        classification: null,
        reviewState: "unresolved" as const,
        revision: "3",
        artifactId: ids.artifact,
        artifactIds: [ids.artifact],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedById: ids.actor,
      },
    ]),
    reconcile: vi.fn(),
  };
  const repository = {
    listTransactionPage: vi.fn(async () => ({
      rows: Array.from({ length: 50 }, (_, index) => ({
        id: `${ids.transaction.slice(0, -1)}${String((index % 9) + 1)}`,
        kind: "sale" as const,
        status: "recorded" as const,
        sourceSystem: "manual" as const,
        invoiceDate: "2026-01-01",
        occurredAt: null,
        settledAt: null,
        counterparty: "Synthetic counterparty",
        reference: "SYN-1",
        description: "Synthetic transaction",
        documentCurrency: "AUD",
        documentAmount: "1.00",
        settlementCurrency: null,
        settlementAmount: null,
        category: "Synthetic category",
        updatedAt: "2026-01-01T00:00:00.123456Z",
      })),
      total: 50,
      page: 2,
      pageSize: 50 as const,
    })),
    listArtifacts: vi.fn(async () => ({
      total: 1,
      rows: [
        {
          id: ids.artifact,
          filename: "statement.csv",
          artifactProfile: "commbank_transaction_history_csv_v1",
          mediaType: "text/csv",
          state: "awaiting_review",
          byteSize: "42",
          checksumSha256: `${"A".repeat(43)}=`,
          createdAt: "2026-01-01T00:00:00.000Z",
          transactionCount: 0,
          bankRowCount: 0,
        },
      ],
    })),
    getArtifact: vi.fn(async (): Promise<ArtifactRecord | null> => artifact),
    getArtifactCreatorId: vi.fn(async () => ids.actor),
    findCsvDuplicateWarnings: vi.fn(async () => csvWarningReport),
    createManual: vi.fn(),
  };
  const documents = {
    startIdempotentUpload: vi.fn(async () => ({
      status: "upload_ready" as const,
      artifact,
      uploadUrl: "http://storage.test/signed-put",
      replayed: false,
    })),
    confirmUpload: vi.fn(async () => ({
      ...artifact,
      state: "awaiting_review" as const,
    })),
    readReviewText: vi.fn(async () => ({
      artifact,
      versionId: artifact.versionId,
      text: "01/01/2026,-1.00,Synthetic row,10.00",
    })),
  };
  const proposalRepository = {
    submit: vi.fn(async (_credentialId, submission) => ({
      submissionId: ids.submission,
      kind: submission.kind,
      linkedId:
        submission.kind === "draft_transaction"
          ? ids.transaction
          : submission.existingTransactionId,
      replayed: false,
    })),
    updateDraft: vi.fn(async () => ({
      transactionId: ids.transaction,
      updatedAt: "2026-09-27T00:00:00.123456Z",
    })),
    categorizeTransaction: vi.fn(async () => ({
      transactionId: ids.transaction,
      updatedAt: "2026-09-27T00:00:00.123456Z",
    })),
  };
  const getCsvDuplicateWarnings = vi.fn(async () => csvWarningReport);
  const dependencies = {
    config: { reportingTimezone: "Australia/Brisbane" },
    bankRepository,
    repository,
    documents,
    proposalRepository,
    getCsvDuplicateWarnings,
  } as unknown as McpToolDependencies;
  return {
    dependencies,
    bankRepository,
    repository,
    documents,
    proposalRepository,
    getCsvDuplicateWarnings,
  };
};

type RunningMcpServer = Awaited<ReturnType<typeof startMcpServer>>;
type HttpResponse = { statusCode: number; body: string };

const rpcBody = (method: string, params: Record<string, unknown> = {}) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });

const send = (port: number, body: string, method: string, name?: string) =>
  new Promise<HttpResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          host: `127.0.0.1:${port}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          authorization: "Bearer synthetic-test-credential",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": method,
          ...(method === "tools/call" && name ? { "mcp-name": name } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });

const withServer = async (
  dependencies: McpToolDependencies,
  inputPrincipal: McpPrincipal,
  run: (server: RunningMcpServer) => Promise<void>,
) => {
  const options: StartMcpServerOptions = {
    verifyCredential: async () => inputPrincipal,
    registerTools: createMcpToolRegistrar(dependencies),
    port: 0,
  };
  const server = await startMcpServer(options);
  try {
    await run(server);
  } finally {
    await server.close();
  }
};

const call = async (
  port: number,
  name: string,
  args: Record<string, unknown>,
) =>
  send(
    port,
    rpcBody("tools/call", { name, arguments: args }),
    "tools/call",
    name,
  );

const parseResult = (response: HttpResponse) =>
  JSON.parse(response.body) as {
    result?: { content?: { text?: string }[]; isError?: boolean };
    error?: { code: number; message: string };
  };

const toolValue = (response: HttpResponse) => {
  const result = parseResult(response).result;
  const text = result?.content?.[0]?.text;
  if (!text) return { result, value: null };
  try {
    return { result, value: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { result, value: { text } };
  }
};

describe("Folio MCP tools", () => {
  it("registers only tools authorized by the exact credential scopes", async () => {
    const scopeTools = [
      ["bank_rows:read", ["list_unresolved_bank_rows"]],
      ["transactions:search", ["search_transactions"]],
      ["artifacts:read", ["list_artifacts"]],
      [
        "artifacts:upload",
        ["begin_artifact_upload", "confirm_artifact_upload"],
      ],
      ["transactions:draft", ["submit_draft_transaction", "edit_transaction"]],
      ["transactions:categorize", ["edit_transaction"]],
      ["bank_matches:suggest", ["suggest_existing_match"]],
      ["submissions:read", []],
    ] as const;

    for (const [scope, authorizedTools] of scopeTools) {
      const fakes = createDependencies();
      await withServer(
        fakes.dependencies,
        principal([scope]),
        async ({ address }) => {
          const listing = await send(
            address.port,
            rpcBody("tools/list"),
            "tools/list",
          );
          const listingResult = JSON.parse(listing.body) as {
            result?: { tools: { name: string }[] };
          };
          expect(listingResult.result, listing.body).toBeDefined();
          const toolNames = listingResult.result!.tools.map(({ name }) => name);

          expect(toolNames).toEqual(["folio_ping", ...authorizedTools]);
          expect(toolNames).not.toContain("read_artifact");
          expect(toolNames).not.toContain("download_artifact");

          if (scope === "submissions:read") {
            expect(toolNames).not.toContain("get_submission_status");
            const removedTool = await call(
              address.port,
              "get_submission_status",
              { submissionId: ids.submission },
            );
            expect(
              parseResult(removedTool).error ??
                parseResult(removedTool).result?.isError,
            ).toBeTruthy();
          }

          const deniedTool =
            scope === "bank_rows:read"
              ? "list_artifacts"
              : "list_unresolved_bank_rows";
          const denied = await call(address.port, deniedTool, {});
          expect(
            parseResult(denied).error ?? parseResult(denied).result?.isError,
          ).toBeTruthy();
          expect(fakes.bankRepository.listTransactions).not.toHaveBeenCalled();
          expect(fakes.repository.listArtifacts).not.toHaveBeenCalled();
        },
      );
    }
  });

  it("returns bounded unresolved bank facts and all-status 50-row search pages", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const unresolved = await call(address.port, "list_unresolved_bank_rows", {
        limit: 50,
        artifactId: ids.artifact,
      });
      const unresolvedValue = toolValue(unresolved).value;
      expect(fakes.bankRepository.listTransactions).toHaveBeenCalledWith(
        ids.actor,
        { limit: 50, offset: 0, state: "unresolved", artifactId: ids.artifact },
      );
      expect(unresolvedValue?.rows).toHaveLength(1);
      expect(JSON.stringify(unresolvedValue)).not.toContain("metadata");

      const searched = await call(address.port, "search_transactions", {
        search: "Synthetic",
        page: 2,
      });
      const searchedValue = toolValue(searched).value;
      expect(fakes.repository.listTransactionPage).toHaveBeenCalledWith(
        ids.actor,
        expect.objectContaining({
          page: 2,
          filters: [],
          reportingTimezone: "Australia/Brisbane",
        }),
      );
      expect(searchedValue?.pageSize).toBe(50);
      const searchedRows = searchedValue?.rows as Record<string, unknown>[];
      expect(searchedRows).toHaveLength(50);
      expect(searchedRows[0]).toMatchObject({
        category: "Synthetic category",
        updatedAt: "2026-01-01T00:00:00.123456Z",
      });
    });
  });

  it("lists artifact metadata without object keys or file bytes", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "list_artifacts", {
        profile: "commbank_transaction_history_csv_v1",
        state: "awaiting_review",
        limit: 10,
      });
      const value = toolValue(response).value;

      expect(fakes.repository.listArtifacts).toHaveBeenCalledWith(
        ids.actor,
        expect.objectContaining({
          profile: "commbank_transaction_history_csv_v1",
          state: "awaiting_review",
          limit: 10,
          linkage: "all",
        }),
      );
      expect(JSON.stringify(value)).not.toContain("objectKey");
      expect(JSON.stringify(value)).not.toContain(
        "private/internal-object-key",
      );
      expect(JSON.stringify(value)).not.toContain("http");
    });
  });

  it("begins only supported actor-bound idempotent uploads", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "begin_artifact_upload", {
        idempotencyKey: "upload:synthetic-1",
        profile: "commbank_transaction_history_csv_v1",
        filename: "statement.csv",
        byteSize: 42,
        checksumSha256: `${"A".repeat(43)}=`,
      });
      const value = toolValue(response).value;

      expect(fakes.documents.startIdempotentUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: ids.credential,
          idempotencyKey: "upload:synthetic-1",
          actorId: ids.actor,
          ownerId: ids.owner,
          artifactProfile: "commbank_transaction_history_csv_v1",
          mediaType: "text/csv",
        }),
      );
      expect(value?.status).toBe("upload_ready");
      expect(value?.replayed).toBe(false);

      for (const [profile, mediaType, filename] of [
        ["manual_invoice_pdf_v1", "application/pdf", "invoice.pdf"],
        ["stripe_balance_itemised_csv_v1", "text/csv", "stripe.csv"],
      ] as const) {
        const accepted = await call(address.port, "begin_artifact_upload", {
          idempotencyKey: `upload:${profile}`,
          profile,
          filename,
          byteSize: 42,
          checksumSha256: `${"A".repeat(43)}=`,
        });
        expect(toolValue(accepted).value?.status).toBe("upload_ready");
        expect(fakes.documents.startIdempotentUpload).toHaveBeenCalledWith(
          expect.objectContaining({ artifactProfile: profile, mediaType }),
        );
      }

      for (const profile of [
        "nab_transaction_history_csv_v1",
        "commbank_statement_pdf_v1",
      ]) {
        const unsupported = await call(address.port, "begin_artifact_upload", {
          idempotencyKey: `upload:${profile}`,
          profile,
          filename: "statement.csv",
          byteSize: 42,
          checksumSha256: `${"A".repeat(43)}=`,
        });
        expect(toolValue(unsupported).result?.isError).toBe(true);
      }
      expect(fakes.documents.startIdempotentUpload).toHaveBeenCalledTimes(3);
    });
  });

  it("requires the creator actor to confirm and returns non-blocking CSV warnings", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      fakes.repository.getArtifactCreatorId.mockResolvedValueOnce(ids.owner);
      const denied = await call(address.port, "confirm_artifact_upload", {
        artifactId: ids.artifact,
      });
      expect(toolValue(denied).value?.code).toBe("ARTIFACT_NOT_CONFIRMABLE");
      expect(fakes.documents.confirmUpload).not.toHaveBeenCalled();

      const confirmed = await call(address.port, "confirm_artifact_upload", {
        artifactId: ids.artifact,
      });
      const confirmedValue = toolValue(confirmed).value;
      expect(fakes.documents.confirmUpload).toHaveBeenCalledWith(
        ids.actor,
        ids.artifact,
      );
      expect(confirmedValue?.duplicateWarnings).toEqual({
        status: "available",
        report: csvWarningReport,
      });

      fakes.getCsvDuplicateWarnings.mockRejectedValueOnce(
        new Error("synthetic"),
      );
      const warningFailure = await call(
        address.port,
        "confirm_artifact_upload",
        {
          artifactId: ids.artifact,
        },
      );
      expect(toolValue(warningFailure).value?.duplicateWarnings).toEqual({
        status: "unavailable",
      });
      expect(toolValue(warningFailure).result?.isError).toBeFalsy();
    });
  });

  it("submits drafts only and validates a CommBank locator against its pinned CSV", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const draft = await call(address.port, "submit_draft_transaction", {
        idempotencyKey: "draft:synthetic-1",
        transaction: {
          kind: "sale",
          documentAmount: "1.00",
          documentCurrency: "AUD",
        },
      });
      expect(toolValue(draft).value?.submissionId).toBe(ids.submission);
      const firstSubmission =
        fakes.proposalRepository.submit.mock.calls[0]?.[1];
      expect(firstSubmission?.kind).toBe("draft_transaction");
      if (firstSubmission?.kind === "draft_transaction") {
        expect(firstSubmission.transaction.status).toBe("draft");
        expect(firstSubmission.transaction.ownerId).toBeNull();
        expect(firstSubmission.transaction.sourceArtifactId).toBeNull();
      }

      const locatorSubmission = await call(
        address.port,
        "submit_draft_transaction",
        {
          idempotencyKey: "draft:synthetic-2",
          transaction: {
            kind: "supplier_expense",
            documentAmount: "1.00",
            documentCurrency: "AUD",
          },
          bankTarget: {
            kind: "commbank_artifact_row",
            artifactId: ids.artifact,
            sourceRow: 1,
          },
        },
      );
      expect(toolValue(locatorSubmission).result?.isError).toBeFalsy();
      const validation = (
        fakes.proposalRepository.submit.mock.calls[1] as unknown[] | undefined
      )?.[2] as { commBankLocator?: unknown } | undefined;
      expect(validation?.commBankLocator).toEqual({
        kind: "commbank_artifact_row",
        artifactId: ids.artifact,
        sourceRow: 1,
      });
      expect(fakes.documents.readReviewText).toHaveBeenCalledWith(
        ids.actor,
        ids.artifact,
        "commbank_transaction_history_csv_v1",
      );

      const wrongRow = await call(address.port, "submit_draft_transaction", {
        idempotencyKey: "draft:synthetic-3",
        transaction: { kind: "supplier_expense" },
        bankTarget: {
          kind: "commbank_artifact_row",
          artifactId: ids.artifact,
          sourceRow: 2,
        },
      });
      expect(toolValue(wrongRow).value?.code).toBe("INVALID_BANK_ROW_LOCATOR");
      expect(fakes.proposalRepository.submit).toHaveBeenCalledTimes(2);
      expect(fakes.repository.createManual).not.toHaveBeenCalled();
      expect(fakes.bankRepository.reconcile).not.toHaveBeenCalled();

      fakes.repository.getArtifact.mockResolvedValueOnce({
        ...artifact,
        artifactProfile: "stripe_balance_itemised_csv_v1",
      });
      const stripeLocator = await call(
        address.port,
        "submit_draft_transaction",
        {
          idempotencyKey: "draft:stripe-locator",
          transaction: { kind: "supplier_expense" },
          bankTarget: {
            kind: "commbank_artifact_row",
            artifactId: ids.artifact,
            sourceRow: 1,
          },
        },
      );
      expect(toolValue(stripeLocator).value?.code).toBe(
        "INVALID_BANK_ROW_LOCATOR",
      );
      expect(fakes.proposalRepository.submit).toHaveBeenCalledTimes(2);
    });
  });

  it("passes only parsed draft field changes to the credential-bound update", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const edited = await call(address.port, "edit_transaction", {
        transactionId: ids.transaction,
        expectedUpdatedAt: "2026-09-27T00:00:00.123456Z",
        changes: { reference: "INV-42", documentAmount: "37.08" },
      });
      expect(toolValue(edited).value?.transactionId).toBe(ids.transaction);
      expect(fakes.proposalRepository.updateDraft).toHaveBeenCalledWith(
        ids.credential,
        ids.transaction,
        "2026-09-27T00:00:00.123456Z",
        { reference: "INV-42", documentAmount: "37.08" },
      );

      const forbidden = await call(address.port, "edit_transaction", {
        transactionId: ids.transaction,
        expectedUpdatedAt: "2026-09-27T00:00:00.123456Z",
        changes: { status: "recorded" },
      });
      expect(toolValue(forbidden).result?.isError).toBe(true);
      expect(fakes.proposalRepository.updateDraft).toHaveBeenCalledTimes(1);
    });
  });

  it("routes a category-only edit through categorization authority", async () => {
    const fakes = createDependencies();
    await withServer(
      fakes.dependencies,
      principal(["transactions:categorize"]),
      async ({ address }) => {
        const edited = await call(address.port, "edit_transaction", {
          transactionId: ids.transaction,
          expectedUpdatedAt: "2026-09-27T00:00:00.123456Z",
          changes: { category: "Software" },
        });
        expect(toolValue(edited).value?.transactionId).toBe(ids.transaction);
        expect(
          fakes.proposalRepository.categorizeTransaction,
        ).toHaveBeenCalledWith(
          ids.credential,
          ids.transaction,
          "2026-09-27T00:00:00.123456Z",
          "Software",
        );
        expect(fakes.proposalRepository.updateDraft).not.toHaveBeenCalled();
      },
    );
  });

  it("returns a distinct revision conflict code for stale edits", async () => {
    const fakes = createDependencies();
    fakes.proposalRepository.updateDraft.mockRejectedValueOnce(
      new ProposalTransactionConflictError(),
    );
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "edit_transaction", {
        transactionId: ids.transaction,
        expectedUpdatedAt: "2026-09-27T00:00:00.123456Z",
        changes: { reference: "INV-43" },
      });
      expect(toolValue(response).value).toEqual({
        code: "REVISION_CONFLICT",
        message: "The transaction changed after it was read.",
      });
    });
  });

  it("stores existing-match suggestions without matching", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const suggested = await call(address.port, "suggest_existing_match", {
        idempotencyKey: "match:synthetic-1",
        existingTransactionId: ids.transaction,
        bankTarget: {
          kind: "bank_transaction",
          bankTransactionId: ids.bankRow,
          expectedRevision: "3",
        },
      });
      expect(toolValue(suggested).value?.submissionId).toBe(ids.submission);
      expect(fakes.proposalRepository.submit).toHaveBeenCalledWith(
        ids.credential,
        expect.objectContaining({ kind: "existing_match" }),
      );
      expect(fakes.bankRepository.reconcile).not.toHaveBeenCalled();
    });
  });

  it("returns a safe idempotency conflict code without echoing payloads", async () => {
    const fakes = createDependencies();
    fakes.proposalRepository.submit.mockRejectedValueOnce(
      new ProposalIdempotencyConflictError(),
    );
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "suggest_existing_match", {
        idempotencyKey: "match:conflict",
        existingTransactionId: ids.transaction,
        bankTarget: {
          kind: "bank_transaction",
          bankTransactionId: ids.bankRow,
          expectedRevision: "3",
        },
        note: "Synthetic private note must not be echoed",
      });
      const value = toolValue(response).value;
      expect(value).toEqual({
        code: "IDEMPOTENCY_CONFLICT",
        message: "This idempotency key was used with a different request.",
      });
      expect(JSON.stringify(value)).not.toContain("Synthetic private note");
    });
  });

  it("reports domain validation without echoing submitted financial values", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "submit_draft_transaction", {
        idempotencyKey: "draft:invalid-value",
        transaction: {
          kind: "sale",
          counterparty: "Synthetic customer detail",
          documentAmount: "not-a-decimal",
        },
      });
      const value = toolValue(response).value;

      expect(value?.code).toBe("INVALID_ARGUMENTS");
      expect(JSON.stringify(value)).not.toContain("Synthetic customer detail");
      expect(JSON.stringify(value)).not.toContain("not-a-decimal");
      expect(fakes.proposalRepository.submit).not.toHaveBeenCalled();
    });
  });
});

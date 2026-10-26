import { request as httpRequest } from "node:http";

import {
  ProposalDraftNotEditableError,
  ProposalIdempotencyConflictError,
  ProposalTransactionConflictError,
  ProposalTransactionRevisionRequiredError,
} from "../database/proposal-repository";
import { AppError } from "../domain/errors";
import type { InvoiceFieldReader } from "../documents/invoice-field-reader";
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
  mediaType: "text/csv",
  byteSize: "42",
  checksumSha256: `${"A".repeat(43)}=`,
  state: "awaiting_review" as const,
  filename: "statement.csv",
  originalFilename: "original-statement.csv",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  documentDate: null,
  reference: "SYN-2026",
  notes: "Synthetic upload metadata",
  supplier: "Synthetic supplier",
  confirmedAt: "2026-01-01T00:00:00.000Z",
  uploadExpiresAt: null,
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
          originalFilename: "original-statement.csv",
          artifactProfile: "commbank_transaction_history_csv_v1",
          mediaType: "text/csv",
          state: "awaiting_review",
          byteSize: "42",
          checksumSha256: `${"A".repeat(43)}=`,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          documentDate: null,
          reference: "SYN-2026",
          notes: "Synthetic upload metadata",
          supplier: "Synthetic supplier",
          createdAt: "2026-01-01T00:00:00.000Z",
          transactionCount: 0,
          bankRowCount: 0,
        },
      ],
    })),
    getArtifactDetails: vi.fn(async () => ({
      id: ids.artifact,
      artifactProfile: "stripe_balance_itemised_csv_v1",
      filename: "renamed-stripe.csv",
      originalFilename: "Stripe-2026-08-01-2026-08-31.csv",
      mediaType: "text/csv",
      state: "available",
      byteSize: "42",
      checksumSha256: `${"A".repeat(43)}=`,
      confirmedAt: "2026-01-01T00:00:00.000Z",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      documentDate: null,
      reference: null,
      notes: null,
      supplier: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      linkedTransactionIds: [ids.transaction, ids.submission],
      bankRowCount: 1,
      objectKey: "private/artifact-object-key",
      downloadUrl: "https://private-storage.test/artifact",
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
      uploadHeaders: {
        "Content-Type": "text/csv",
        "x-amz-checksum-sha256": `${"A".repeat(43)}=`,
        "x-amz-meta-folio-artifact-id": ids.artifact,
        "If-None-Match": "*",
      },
      replayed: false,
    })),
    confirmUpload: vi.fn(async () => ({
      ...artifact,
      state: "awaiting_review" as const,
    })),
    updateMetadata: vi.fn(
      async (
        _actorId: string,
        input: {
          id: string;
          filename: string;
          periodStart: string | null;
          periodEnd: string | null;
        },
      ) => ({
        ...artifact,
        id: input.id,
        filename: input.filename,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      }),
    ),
    readReviewText: vi.fn(async () => ({
      artifact,
      text: "01/01/2026,-1.00,Synthetic row,10.00",
    })),
  };
  const extractInvoiceFields = vi.fn<InvoiceFieldReader>(async () => ({
    status: "parsed",
    artifactId: ids.artifact,
    checksumSha256: `${"A".repeat(43)}=`,
    confirmedAt: "2026-01-01T00:00:00.000Z",
    result: {
      fields: { supplier: "Synthetic supplier", reference: "INV-42" },
    } as never,
    duplicateHints: {
      linkedTransactions: 0,
      matchingReferenceTransactions: 1,
      matchingChecksumArtifacts: 0,
    },
  }));
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
    extractInvoiceFields,
    proposalRepository,
    getCsvDuplicateWarnings,
  } as unknown as McpToolDependencies;
  return {
    dependencies,
    bankRepository,
    repository,
    documents,
    extractInvoiceFields,
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
  it("advertises six-digit transaction revisions for existing-match suggestions", async () => {
    const fakes = createDependencies();
    await withServer(
      fakes.dependencies,
      principal(["bank_matches:suggest"]),
      async ({ address }) => {
        const listing = await send(
          address.port,
          rpcBody("tools/list"),
          "tools/list",
        );
        const listingResult = JSON.parse(listing.body) as {
          result?: {
            tools: {
              name: string;
              inputSchema?: {
                properties?: Record<string, { pattern?: string }>;
                required?: string[];
              };
            }[];
          };
        };
        const suggestion = listingResult.result?.tools.find(
          ({ name }) => name === "suggest_existing_match",
        );
        const revisionSchema =
          suggestion?.inputSchema?.properties?.expectedUpdatedAt;

        expect(revisionSchema?.pattern).toBe(
          "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$",
        );
        expect(suggestion?.inputSchema?.required).not.toContain(
          "expectedUpdatedAt",
        );
        const revisionPattern = new RegExp(revisionSchema!.pattern!);
        expect(revisionPattern.test("2026-09-27T00:00:00.123456Z")).toBe(true);
        expect(revisionPattern.test("2026-09-27T00:00:00.123Z")).toBe(false);
      },
    );
  });

  it("registers only tools authorized by the exact credential scopes", async () => {
    const scopeTools = [
      { scopes: ["bank_rows:read"], tools: ["list_unresolved_bank_rows"] },
      { scopes: ["transactions:search"], tools: ["search_transactions"] },
      {
        scopes: ["artifacts:read"],
        tools: ["list_artifacts", "get_artifact"],
      },
      { scopes: ["artifacts:edit"], tools: [] },
      { scopes: ["artifacts:extract"], tools: [] },
      {
        scopes: ["artifacts:read", "artifacts:edit"],
        tools: ["list_artifacts", "get_artifact", "update_artifact_metadata"],
      },
      {
        scopes: ["artifacts:read", "artifacts:extract"],
        tools: ["list_artifacts", "get_artifact", "extract_invoice_fields"],
      },
      {
        scopes: ["artifacts:upload"],
        tools: ["begin_artifact_upload", "confirm_artifact_upload"],
      },
      {
        scopes: ["transactions:draft"],
        tools: ["submit_draft_transaction", "edit_transaction"],
      },
      { scopes: ["transactions:categorize"], tools: ["edit_transaction"] },
      { scopes: ["bank_matches:suggest"], tools: ["suggest_existing_match"] },
      { scopes: ["submissions:read"], tools: [] },
    ] as const;

    for (const { scopes, tools: authorizedTools } of scopeTools) {
      const fakes = createDependencies();
      await withServer(
        fakes.dependencies,
        principal(scopes),
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

          if (scopes[0] === "submissions:read") {
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
            scopes[0] === "bank_rows:read"
              ? "list_artifacts"
              : "list_unresolved_bank_rows";
          const denied = await call(address.port, deniedTool, {});
          expect(
            parseResult(denied).error ?? parseResult(denied).result?.isError,
          ).toBeTruthy();
          expect(fakes.bankRepository.listTransactions).not.toHaveBeenCalled();
          expect(fakes.repository.listArtifacts).not.toHaveBeenCalled();
          expect(fakes.repository.getArtifactDetails).not.toHaveBeenCalled();
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
      expect(value?.rows).toMatchObject([
        {
          filename: "statement.csv",
          originalFilename: "original-statement.csv",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          documentDate: null,
          reference: "SYN-2026",
          notes: "Synthetic upload metadata",
          supplier: "Synthetic supplier",
        },
      ]);
      expect(JSON.stringify(value)).not.toContain("objectKey");
      expect(JSON.stringify(value)).not.toContain(
        "private/internal-object-key",
      );
      expect(JSON.stringify(value)).not.toContain("http");
    });
  });

  it("returns safe artifact details and filename hints without linked IDs", async () => {
    const fakes = createDependencies();
    await withServer(
      fakes.dependencies,
      principal(["artifacts:read"]),
      async ({ address }) => {
        const response = await call(address.port, "get_artifact", {
          artifactId: ids.artifact,
        });
        const value = toolValue(response).value;

        expect(fakes.repository.getArtifactDetails).toHaveBeenCalledWith(
          ids.actor,
          ids.artifact,
        );
        expect(value).toMatchObject({
          id: ids.artifact,
          artifactProfile: "stripe_balance_itemised_csv_v1",
          filename: "renamed-stripe.csv",
          originalFilename: "Stripe-2026-08-01-2026-08-31.csv",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          linkedTransactionCount: 2,
          bankRowCount: 1,
          filenameSuggestions: {
            source: "original_filename",
            provider: "Stripe",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-31",
          },
        });
        expect(value).not.toHaveProperty("linkedTransactionIds");
        expect(JSON.stringify(value)).not.toContain("objectKey");
        expect(JSON.stringify(value)).not.toContain(
          "private/artifact-object-key",
        );
        expect(JSON.stringify(value)).not.toContain("private-storage.test");
      },
    );
  });

  it("updates only artifact metadata with an expected snapshot and maps conflicts safely", async () => {
    const fakes = createDependencies();
    const input = {
      artifactId: ids.artifact,
      filename: "renamed.csv",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      expected: {
        filename: "statement.csv",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      },
    };

    await withServer(
      fakes.dependencies,
      principal(["artifacts:read", "artifacts:edit"]),
      async ({ address }) => {
        const updated = await call(
          address.port,
          "update_artifact_metadata",
          input,
        );
        expect(toolValue(updated).value).toMatchObject({
          id: ids.artifact,
          filename: "renamed.csv",
          originalFilename: "original-statement.csv",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
        });
        expect(fakes.documents.updateMetadata).toHaveBeenCalledWith(ids.actor, {
          id: ids.artifact,
          filename: "renamed.csv",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          expected: input.expected,
        });
        expect(fakes.proposalRepository.submit).not.toHaveBeenCalled();
        expect(fakes.proposalRepository.updateDraft).not.toHaveBeenCalled();
        expect(fakes.bankRepository.reconcile).not.toHaveBeenCalled();

        fakes.documents.updateMetadata.mockRejectedValueOnce(
          new AppError({ code: "ARTIFACT_METADATA_CONFLICT" }),
        );
        const conflict = await call(
          address.port,
          "update_artifact_metadata",
          input,
        );
        expect(toolValue(conflict).value).toMatchObject({
          code: "ARTIFACT_METADATA_CONFLICT",
          message:
            "Artifact metadata changed or is no longer editable. Reload before saving again.",
          recovery: "refresh",
        });

        const invalid = await call(address.port, "update_artifact_metadata", {
          ...input,
          periodStart: "2026-09-01",
          periodEnd: "2026-08-31",
        });
        expect(toolValue(invalid).value?.code).toBe("INVALID_ARGUMENTS");
        expect(fakes.documents.updateMetadata).toHaveBeenCalledTimes(2);
      },
    );
  });

  it("extracts invoice fields only for a required checksum and returns unsupported identity safely", async () => {
    const fakes = createDependencies();
    await withServer(
      fakes.dependencies,
      principal(["artifacts:read", "artifacts:extract"]),
      async ({ address }) => {
        const missingChecksum = await call(
          address.port,
          "extract_invoice_fields",
          {
            artifactId: ids.artifact,
          },
        );
        expect(toolValue(missingChecksum).result?.isError).toBe(true);
        expect(fakes.extractInvoiceFields).not.toHaveBeenCalled();

        const parsed = await call(address.port, "extract_invoice_fields", {
          artifactId: ids.artifact,
          expectedChecksumSha256: `${"A".repeat(43)}=`,
        });
        const parsedValue = toolValue(parsed).value;
        expect(fakes.extractInvoiceFields).toHaveBeenCalledWith(ids.actor, {
          artifactId: ids.artifact,
          expectedChecksumSha256: `${"A".repeat(43)}=`,
        });
        expect(parsedValue).toMatchObject({
          status: "parsed",
          artifactId: ids.artifact,
          checksumSha256: `${"A".repeat(43)}=`,
          duplicateHints: { matchingReferenceTransactions: 1 },
        });
        expect(JSON.stringify(parsedValue)).not.toContain("normalizedDocument");
        expect(JSON.stringify(parsedValue)).not.toContain("bytes");
        expect(JSON.stringify(parsedValue)).not.toContain("objectKey");

        fakes.extractInvoiceFields.mockResolvedValueOnce({
          status: "unsupported",
          artifactId: ids.artifact,
          checksumSha256: `${"A".repeat(43)}=`,
          confirmedAt: "2026-01-01T00:00:00.000Z",
          reason: "encrypted",
        });
        const unsupported = await call(address.port, "extract_invoice_fields", {
          artifactId: ids.artifact,
          expectedChecksumSha256: `${"A".repeat(43)}=`,
        });
        expect(toolValue(unsupported).value).toMatchObject({
          status: "unsupported",
          artifactId: ids.artifact,
          checksumSha256: `${"A".repeat(43)}=`,
          confirmedAt: "2026-01-01T00:00:00.000Z",
          reason: "encrypted",
        });
      },
    );
  });

  it("begins only supported actor-bound idempotent uploads", async () => {
    const fakes = createDependencies();
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "begin_artifact_upload", {
        idempotencyKey: "upload:synthetic-1",
        profile: "commbank_transaction_history_csv_v1",
        filename: "statement.csv",
        originalFilename: "source-statement.csv",
        supplier: "  Synthetic supplier  ",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        documentDate: null,
        reference: "  SYN-2026  ",
        notes: "  Synthetic upload note  ",
        byteSize: 42,
        checksumSha256: `${"A".repeat(43)}=`,
      });
      const value = toolValue(response).value;
      const listing = await send(
        address.port,
        rpcBody("tools/list"),
        "tools/list",
      );
      const listedTools = JSON.parse(listing.body) as {
        result?: {
          tools: {
            name: string;
            description?: string;
            inputSchema?: {
              properties?: Record<string, unknown>;
              required?: string[];
            };
          }[];
        };
      };
      const uploadTool = listedTools.result?.tools.find(
        ({ name }) => name === "begin_artifact_upload",
      );
      expect(uploadTool?.description).toContain(
        "PUT the raw file bytes to uploadUrl with every exact name and value in uploadHeaders",
      );
      expect(uploadTool?.description).toContain(
        "periodStart and periodEnd describe the export coverage interval",
      );
      expect(uploadTool?.description).toContain(
        "coverage dates are not accepted",
      );
      expect(uploadTool?.description).toContain(
        "If the PUT returns HTTP 412, call confirm_artifact_upload",
      );
      expect(uploadTool?.inputSchema?.properties).toHaveProperty(
        "originalFilename",
      );
      expect(uploadTool?.inputSchema?.properties).toHaveProperty("supplier");
      expect(uploadTool?.inputSchema?.properties).toHaveProperty("periodStart");
      expect(uploadTool?.inputSchema?.properties).toHaveProperty(
        "documentDate",
      );
      expect(uploadTool?.inputSchema?.required).not.toContain(
        "originalFilename",
      );

      expect(fakes.documents.startIdempotentUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: ids.credential,
          idempotencyKey: "upload:synthetic-1",
          actorId: ids.actor,
          ownerId: ids.owner,
          artifactProfile: "commbank_transaction_history_csv_v1",
          filename: "statement.csv",
          originalFilename: "source-statement.csv",
          supplier: "Synthetic supplier",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          documentDate: null,
          reference: "SYN-2026",
          notes: "Synthetic upload note",
          mediaType: "text/csv",
        }),
      );
      expect(value?.status).toBe("upload_ready");
      expect(value?.replayed).toBe(false);
      expect(value?.uploadHeaders).toEqual({
        "Content-Type": "text/csv",
        "x-amz-checksum-sha256": `${"A".repeat(43)}=`,
        "x-amz-meta-folio-artifact-id": ids.artifact,
        "If-None-Match": "*",
      });
      expect(value?.artifact).toMatchObject({
        filename: "statement.csv",
        originalFilename: "original-statement.csv",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        documentDate: null,
        reference: "SYN-2026",
        notes: "Synthetic upload metadata",
        supplier: "Synthetic supplier",
        confirmedAt: "2026-01-01T00:00:00.000Z",
        uploadExpiresAt: null,
      });
      expect(JSON.stringify(value)).not.toContain("versionId");

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

      const invalidPdfCoverage = await call(
        address.port,
        "begin_artifact_upload",
        {
          idempotencyKey: "upload:pdf-coverage-invalid",
          profile: "manual_invoice_pdf_v1",
          filename: "invoice.pdf",
          periodStart: "2026-08-01",
          byteSize: 42,
          checksumSha256: `${"A".repeat(43)}=`,
        },
      );
      expect(toolValue(invalidPdfCoverage).result?.isError).toBe(true);
      expect(fakes.documents.startIdempotentUpload).toHaveBeenCalledTimes(3);

      const invalidCsvCoverage = await call(
        address.port,
        "begin_artifact_upload",
        {
          idempotencyKey: "upload:csv-coverage-invalid",
          profile: "commbank_transaction_history_csv_v1",
          filename: "statement.csv",
          periodStart: "2026-09-01",
          periodEnd: "2026-08-31",
          byteSize: 42,
          checksumSha256: `${"A".repeat(43)}=`,
        },
      );
      expect(toolValue(invalidCsvCoverage).result?.isError).toBe(true);
      expect(fakes.documents.startIdempotentUpload).toHaveBeenCalledTimes(3);
    });
  });

  it("requires the creator actor to confirm and returns non-blocking CSV warnings", async () => {
    const fakes = createDependencies();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
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
        expect(errorLog).toHaveBeenCalledTimes(1);
        const event = JSON.parse(errorLog.mock.calls[0][0] as string);
        expect(event).toMatchObject({
          operation: "confirm_artifact_upload",
          stage: "duplicate_warnings",
          mutation: false,
          phase: "failure",
          artifactId: ids.artifact,
          actorId: ids.actor,
        });

        expect(JSON.stringify(toolValue(warningFailure).value)).not.toContain(
          "synthetic",
        );
      });
    } finally {
      errorLog.mockRestore();
    }
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

      const diagnosticLog = vi
        .spyOn(console, "info")
        .mockImplementation(() => {});
      const wrongRow = await call(address.port, "submit_draft_transaction", {
        idempotencyKey: "draft:synthetic-3",
        transaction: { kind: "supplier_expense" },
        bankTarget: {
          kind: "commbank_artifact_row",
          artifactId: ids.artifact,
          sourceRow: 2,
        },
      });
      const logged = diagnosticLog.mock.calls.map(([line]) => String(line));
      diagnosticLog.mockRestore();
      expect(toolValue(wrongRow).value?.code).toBe("INVALID_BANK_ROW_LOCATOR");
      expect(toolValue(wrongRow).value?.message).toBe(
        "The source row was not found in the pinned CommBank CSV.",
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('"operation":"submit_draft_transaction"');
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

  it("passes only parsed draft field changes to the manual draft update", async () => {
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

  it("reports protected manual drafts without implying credential ownership", async () => {
    const fakes = createDependencies();
    fakes.proposalRepository.updateDraft.mockRejectedValueOnce(
      new ProposalDraftNotEditableError(),
    );
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "edit_transaction", {
        transactionId: ids.transaction,
        expectedUpdatedAt: "2026-09-27T00:00:00.123456Z",
        changes: { reference: "INV-43" },
      });
      expect(toolValue(response).value).toMatchObject({
        code: "DRAFT_NOT_EDITABLE",
        message: "The draft is no longer editable.",
      });
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
      expect(toolValue(response).value).toMatchObject({
        code: "REVISION_CONFLICT",
        message: "The transaction changed after it was read.",
        recovery: "refresh",
      });
      expect(toolValue(response).value?.reference).toMatch(/^[0-9a-f-]{36}$/i);
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

  it("passes an optional transaction revision through existing-match suggestions", async () => {
    const fakes = createDependencies();
    const expectedUpdatedAt = "2026-09-27T00:00:00.123456Z";
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      await call(address.port, "suggest_existing_match", {
        idempotencyKey: "match:synthetic-revision",
        existingTransactionId: ids.transaction,
        expectedUpdatedAt,
        bankTarget: {
          kind: "bank_transaction",
          bankTransactionId: ids.bankRow,
          expectedRevision: "3",
        },
      });
      expect(fakes.proposalRepository.submit).toHaveBeenCalledWith(
        ids.credential,
        expect.objectContaining({
          kind: "existing_match",
          expectedUpdatedAt,
        }),
      );
    });
  });

  it("returns a safe argument error when a draft suggestion omits its revision", async () => {
    const fakes = createDependencies();
    fakes.proposalRepository.submit.mockRejectedValueOnce(
      new ProposalTransactionRevisionRequiredError(),
    );
    await withServer(fakes.dependencies, principal(), async ({ address }) => {
      const response = await call(address.port, "suggest_existing_match", {
        idempotencyKey: "match:missing-revision",
        existingTransactionId: ids.transaction,
        bankTarget: {
          kind: "bank_transaction",
          bankTransactionId: ids.bankRow,
          expectedRevision: "3",
        },
      });

      expect(toolValue(response).value).toMatchObject({
        code: "INVALID_ARGUMENTS",
        message:
          "A manual draft match requires its current transaction revision.",
      });
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
      expect(value).toMatchObject({
        code: "IDEMPOTENCY_CONFLICT",
        message: "This idempotency key was used with a different request.",
        recovery: "refresh",
      });
      expect(value?.reference).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.stringify(value)).not.toContain("Synthetic private note");
    });
  });

  it("keeps server diagnostics while sanitizing the tool response", async () => {
    const fakes = createDependencies();
    fakes.repository.getArtifactDetails.mockRejectedValueOnce(
      new Error("Synthetic private server diagnostic"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withServer(
        fakes.dependencies,
        principal(["artifacts:read"]),
        async ({ address }) => {
          const response = await call(address.port, "get_artifact", {
            artifactId: ids.artifact,
          });
          const value = toolValue(response).value;

          expect(value).toMatchObject({
            code: "REQUEST_FAILED",
            message: "The request could not be completed.",
          });
          expect(JSON.stringify(value)).not.toContain(
            "Synthetic private server diagnostic",
          );
          expect(error).toHaveBeenCalledOnce();
          const event = JSON.parse(error.mock.calls[0][0] as string) as Record<
            string,
            unknown
          >;
          expect(event).toMatchObject({
            operation: "get_artifact",
            code: "UNEXPECTED_ERROR",
            correlationId: value?.reference,
          });
        },
      );
    } finally {
      error.mockRestore();
    }
  });

  it("logs successful mutations without logging successful reads", async () => {
    const fakes = createDependencies();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await withServer(fakes.dependencies, principal(), async ({ address }) => {
        const read = await call(address.port, "search_transactions", {
          search: "",
          page: 1,
        });
        expect(toolValue(read).value?.isError).toBeUndefined();
        expect(log).not.toHaveBeenCalled();

        const mutation = await call(address.port, "begin_artifact_upload", {
          idempotencyKey: "upload:diagnostic-test",
          profile: "commbank_transaction_history_csv_v1",
          filename: "statement.csv",
          byteSize: 42,
          checksumSha256: `${"A".repeat(43)}=`,
        });
        expect(toolValue(mutation).value?.isError).toBeUndefined();
        expect(log).toHaveBeenCalledTimes(1);
        const event = JSON.parse(log.mock.calls[0][0] as string) as Record<
          string,
          unknown
        >;
        expect(event).toMatchObject({
          operation: "begin_artifact_upload",
          stage: "tool_call",
          phase: "success",
          actorId: ids.actor,
          artifactId: ids.artifact,
        });
        expect(event).not.toHaveProperty("filename");
      });
    } finally {
      log.mockRestore();
    }
  });

  it("reports domain validation without echoing submitted financial values", async () => {
    const fakes = createDependencies();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
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
        expect(value?.recovery).toBe("fix_input");
        expect(value?.reference).toMatch(/^[0-9a-f-]{36}$/i);
        expect(JSON.stringify(value)).not.toContain(
          "Synthetic customer detail",
        );
        expect(JSON.stringify(value)).not.toContain("not-a-decimal");
        expect(fakes.proposalRepository.submit).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledTimes(1);
        const event = JSON.parse(info.mock.calls[0][0] as string) as Record<
          string,
          unknown
        >;
        expect(event).toMatchObject({
          operation: "submit_draft_transaction",
          stage: "tool_call",
          phase: "failure",
          code: "INVALID_ARGUMENTS",
          actorId: ids.actor,
        });
        expect(value?.reference).toBe(event.correlationId);
        expect(JSON.stringify(event)).not.toContain(
          "Synthetic customer detail",
        );
        expect(JSON.stringify(event)).not.toContain("not-a-decimal");
      });
    } finally {
      info.mockRestore();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Authorization from "./authorization";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "folio_session" },
  auth: { session: vi.fn() },
  repository: {
    listUsers: vi.fn().mockResolvedValue([]),
    listTransactions: vi.fn().mockResolvedValue([]),
    findArtifactFilenameMatches: vi.fn(),
    listTransactionPage: vi
      .fn()
      .mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 }),
    transactionOverviewSummary: vi.fn().mockResolvedValue({
      transactionLinkedEvidenceGaps: 0,
      pendingImportUploads: 0,
      abandonedImportUploads: 0,
      recentTransactions: [],
    }),
    listEntrySuggestions: vi.fn().mockResolvedValue({
      counterparties: [],
      categories: [],
      supplierCategories: [],
    }),
    createManual: vi.fn(),
    updateManual: vi.fn(),
    createUser: vi.fn(),
    previewStripeImport: vi.fn(),
  },
  bankRepository: {
    overviewSummary: vi.fn().mockResolvedValue({
      unresolvedBankRows: 0,
      importsWithUnresolvedRows: 0,
      recentBankRows: [],
    }),
  },
  proposalRepository: {
    getProposedEvidenceForDraft: vi.fn(),
    discardProposedEvidenceForDraft: vi.fn(),
  },
  documents: {
    startUpload: vi.fn(),
    readReviewText: vi.fn(),
    rejectArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
  },
  config: {
    gstRegistered: false,
    reportingTimezone: "Australia/Brisbane",
  },
}));

const permissionProbe = vi.hoisted(() => ({
  requirePermission: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: vi.fn().mockReturnValue("opaque-session"),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse(value: unknown): unknown } | undefined;
    const builder = {
      validator(schema: { parse(value: unknown): unknown }) {
        validator = schema;
        return builder;
      },
      handler(callback: (input: { data: unknown }) => Promise<unknown>) {
        return (input: { data?: unknown } = {}) =>
          callback({ data: validator?.parse(input.data) });
      },
    };
    return builder;
  },
}));

vi.mock("./authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof Authorization>();
  permissionProbe.requirePermission.mockImplementation(
    actual.requirePermission,
  );
  return { ...actual, requirePermission: permissionProbe.requirePermission };
});

vi.mock("./runtime", () => ({ runtime: () => current }));

import { permissions } from "./authorization";
import { FolioDiagnosticError } from "../domain/diagnostics";
import { ArtifactPresignRecoveryError } from "../documents/service";
import {
  createUser,
  deleteArtifact,
  discardProposedDraftEvidence,
  getOverviewSummary,
  getProposedDraftEvidence,
  getReport,
  listTransactionFormOptions,
  listTransactionPage,
  listWorkspace,
  findArtifactFilenameMatches,
  previewStripeCsv,
  reportClientRenderFailure,
  rejectArtifact,
  saveManualTransaction,
  startArtifactUpload,
} from "./operations";

const member = {
  id: "trusted-actor-id",
  email: "member@example.test",
  displayName: null,
  role: "member" as const,
};

const administrator = {
  ...member,
  id: "trusted-admin-id",
  role: "administrator" as const,
};

const viewer = {
  ...member,
  id: "viewer-id",
  role: "viewer" as const,
};

const ownerId = "00000000-0000-4000-8000-000000000001";

describe("server operation authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.auth.session.mockResolvedValue(member);
    current.repository.listUsers.mockResolvedValue([]);
    current.repository.listTransactions.mockResolvedValue([]);
    current.repository.listTransactionPage.mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    current.repository.transactionOverviewSummary.mockResolvedValue({
      transactionLinkedEvidenceGaps: 0,
      pendingImportUploads: 0,
      abandonedImportUploads: 0,
      recentTransactions: [],
    });
    current.bankRepository.overviewSummary.mockResolvedValue({
      unresolvedBankRows: 0,
      importsWithUnresolvedRows: 0,
      recentBankRows: [],
    });
    current.repository.listEntrySuggestions.mockResolvedValue({
      counterparties: [],
      categories: [],
      supplierCategories: [],
    });
    current.repository.createManual.mockReset();
    current.repository.updateManual.mockReset();
    current.documents.startUpload.mockReset();
    current.documents.readReviewText.mockReset();
    current.documents.rejectArtifact.mockReset();
    current.documents.deleteArtifact.mockReset();
    current.repository.previewStripeImport.mockReset();
  });

  it("reads proposed draft evidence only through authenticated transaction access", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    current.proposalRepository.getProposedEvidenceForDraft.mockResolvedValue({
      transactionId,
      artifactId: "22222222-2222-4222-8222-222222222222",
    });
    await expect(
      getProposedDraftEvidence({ data: { transactionId } }),
    ).resolves.toMatchObject({ transactionId });
    expect(
      current.proposalRepository.getProposedEvidenceForDraft,
    ).toHaveBeenCalledWith(member.id, transactionId);

    current.auth.session.mockResolvedValue(viewer);
    await expect(
      getProposedDraftEvidence({ data: { transactionId } }),
    ).rejects.toThrow("Code PERMISSION_DENIED");
  });

  it("requires write and link authority to discard proposed PDF evidence", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    current.proposalRepository.discardProposedEvidenceForDraft.mockResolvedValue(
      null,
    );
    await discardProposedDraftEvidence({ data: { transactionId } });
    expect(
      current.proposalRepository.discardProposedEvidenceForDraft,
    ).toHaveBeenCalledWith(member.id, transactionId);

    current.auth.session.mockResolvedValue(viewer);
    await expect(
      discardProposedDraftEvidence({ data: { transactionId } }),
    ).rejects.toThrow("Code PERMISSION_DENIED");
  });

  it("fails a protected operation closed without an authenticated session", async () => {
    current.auth.session.mockResolvedValue(null);
    await expect(listWorkspace({ data: { search: "" } })).rejects.toThrow(
      "Code UNAUTHENTICATED",
    );
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
  });

  it("authenticates and rate-limits safe client render reports", async () => {
    current.auth.session.mockResolvedValue({
      ...member,
      id: "render-failure-report-actor",
    });
    const errorWriter = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const infoWriter = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    try {
      const reports = [];
      for (let index = 0; index < 6; index += 1)
        reports.push(
          await reportClientRenderFailure({
            data: {
              name: "TypeError",
              code: "CLIENT_RENDER_FAILURE",
              message: "Cannot read properties of undefined",
            },
          }),
        );

      expect(reports).toEqual([
        { reported: true },
        { reported: true },
        { reported: true },
        { reported: true },
        { reported: true },
        { reported: false },
      ]);
      expect(errorWriter).toHaveBeenCalledTimes(5);
      const event = JSON.parse(String(errorWriter.mock.calls[0]?.[0]));
      expect(event).toMatchObject({
        event: "folio.client_render_failure",
        name: "TypeError",
        code: "CLIENT_RENDER_FAILURE",
        message: "Cannot read properties of undefined",
      });
      expect(event.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(infoWriter).toHaveBeenCalledTimes(6);
    } finally {
      errorWriter.mockRestore();
      infoWriter.mockRestore();
    }

    expect(current.auth.session).toHaveBeenCalledWith("opaque-session");
  });

  it("rejects client render reports that include extra form data", () => {
    expect(() =>
      reportClientRenderFailure({
        data: {
          name: "TypeError",
          code: "CLIENT_RENDER_FAILURE",
          message: "Client render failed",
          formValues: { counterparty: "Synthetic Supplier" },
        },
      } as never),
    ).toThrow();
    expect(() =>
      reportClientRenderFailure({
        data: {
          name: "TypeError",
          code: "CLIENT_RENDER_TRIM_NOT_STRING",
          message: "A function call failed",
        },
      } as never),
    ).toThrow();
    expect(current.auth.session).not.toHaveBeenCalled();
  });

  it("logs the specific sanitized trim failure mapping", async () => {
    current.auth.session.mockResolvedValue({
      ...member,
      id: "render-trim-report-actor",
    });
    const errorWriter = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const infoWriter = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    try {
      await expect(
        reportClientRenderFailure({
          data: {
            name: "TypeError",
            code: "CLIENT_RENDER_TRIM_NOT_STRING",
            message: "trim is not a function; the value is not a string",
          },
        }),
      ).resolves.toEqual({ reported: true });

      expect(errorWriter).toHaveBeenCalledTimes(1);
      const event = JSON.parse(String(errorWriter.mock.calls[0]?.[0]));
      expect(event).toMatchObject({
        event: "folio.client_render_failure",
        name: "TypeError",
        code: "CLIENT_RENDER_TRIM_NOT_STRING",
        message: "trim is not a function; the value is not a string",
      });
      expect(event.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(infoWriter).toHaveBeenCalledTimes(1);
    } finally {
      errorWriter.mockRestore();
      infoWriter.mockRestore();
    }
  });

  it("uses the server-session actor for repository calls", async () => {
    await listWorkspace({ data: { search: "invoice" } });
    expect(current.auth.session).toHaveBeenCalledWith("opaque-session");
    expect(current.repository.listTransactions).toHaveBeenCalledWith(
      member.id,
      "invoice",
    );
  });

  it("authorizes and scopes filename match counts to the session actor", async () => {
    current.repository.findArtifactFilenameMatches.mockResolvedValue([2, 0]);

    await expect(
      findArtifactFilenameMatches({
        data: {
          profile: "stripe_balance_itemised_csv_v1",
          filenames: ["  export.csv  ", "report.csv"],
        },
      }),
    ).resolves.toEqual([2, 0]);

    expect(current.repository.findArtifactFilenameMatches).toHaveBeenCalledWith(
      member.id,
      "stripe_balance_itemised_csv_v1",
      ["export.csv", "report.csv"],
    );

    current.auth.session.mockResolvedValue(viewer);
    await expect(
      findArtifactFilenameMatches({
        data: {
          profile: "stripe_balance_itemised_csv_v1",
          filenames: ["export.csv"],
        },
      }),
    ).rejects.toThrow("Code PERMISSION_DENIED");
    expect(
      current.repository.findArtifactFilenameMatches,
    ).toHaveBeenCalledTimes(1);
  });

  it("loads member transaction form options without loading transactions", async () => {
    const users = [
      {
        id: "owner-id",
        email: "owner@example.test",
        displayName: null,
        role: "member",
        active: true,
      },
    ];
    const entrySuggestions = {
      counterparties: ["Counterparty"],
      categories: ["Category"],
      supplierCategories: [],
    };
    current.repository.listUsers.mockResolvedValue(users);
    current.repository.listEntrySuggestions.mockResolvedValue(entrySuggestions);

    await expect(listTransactionFormOptions()).resolves.toEqual({
      users,
      entrySuggestions,
    });
    expect(current.repository.listUsers).toHaveBeenCalledWith(member.id);
    expect(current.repository.listEntrySuggestions).toHaveBeenCalledWith(
      member.id,
    );
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
    expect(current.repository.listTransactionPage).not.toHaveBeenCalled();
  });

  it("denies transaction form options before repository access", async () => {
    current.auth.session.mockResolvedValue(viewer);
    await expect(listTransactionFormOptions()).rejects.toThrow(
      "Code PERMISSION_DENIED",
    );
    expect(current.repository.listUsers).not.toHaveBeenCalled();
    expect(current.repository.listEntrySuggestions).not.toHaveBeenCalled();
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
  });

  it("validates and authorizes the bounded transaction query", async () => {
    await listTransactionPage({
      data: {
        search: " invoice ",
        filters: [
          { field: "status", operator: "is", value: "recorded" },
          {
            field: "amount",
            operator: "greater_than_or_equal",
            value: "100.00",
          },
        ],
        sort: { key: "amount", direction: "desc" },
        page: 2,
      },
    });

    expect(current.repository.listTransactionPage).toHaveBeenCalledWith(
      member.id,
      {
        search: "invoice",
        filters: [
          { field: "status", operator: "is", value: "recorded" },
          {
            field: "amount",
            operator: "greater_than_or_equal",
            value: "100.00",
          },
        ],
        sort: { key: "amount", direction: "desc" },
        page: 2,
        reportingTimezone: "Australia/Brisbane",
      },
    );
  });

  it("rejects malformed transaction query state before repository access", () => {
    expect(() =>
      listTransactionPage({
        data: {
          filters: [
            { field: "status", operator: "contains", value: "recorded" },
          ],
        },
      } as never),
    ).toThrow();
    expect(current.repository.listTransactionPage).not.toHaveBeenCalled();
  });

  it("denies transaction page access before repository access", async () => {
    current.auth.session.mockResolvedValue(viewer);
    await expect(listTransactionPage({ data: {} })).rejects.toThrow(
      "Code PERMISSION_DENIED",
    );
    expect(current.repository.listTransactionPage).not.toHaveBeenCalled();
  });

  it("returns exact overview aggregates and bounded record snapshots", async () => {
    current.repository.transactionOverviewSummary.mockResolvedValue({
      transactionLinkedEvidenceGaps: 4,
      pendingImportUploads: 2,
      abandonedImportUploads: 3,
      recentTransactions: [{ id: "transaction" }],
    });
    current.bankRepository.overviewSummary.mockResolvedValue({
      unresolvedBankRows: 7,
      importsWithUnresolvedRows: 2,
      recentBankRows: [{ id: "bank-row" }],
    });

    await expect(getOverviewSummary()).resolves.toEqual({
      attention: {
        unresolvedBankRows: 7,
        importsWithUnresolvedRows: 2,
        transactionLinkedEvidenceGaps: 4,
        pendingImportUploads: 2,
        abandonedImportUploads: 3,
      },
      recent: {
        transactions: [{ id: "transaction" }],
        bankRows: [{ id: "bank-row" }],
      },
    });
    expect(current.repository.transactionOverviewSummary).toHaveBeenCalledWith(
      member.id,
    );
    expect(current.bankRepository.overviewSummary).toHaveBeenCalledWith(
      member.id,
    );
    expect(permissionProbe.requirePermission).toHaveBeenCalledWith(
      member,
      permissions.bankActivityView,
    );
  });

  it("denies overview summary before either repository query", async () => {
    current.auth.session.mockResolvedValue(viewer);
    await expect(getOverviewSummary()).rejects.toThrow(
      "Code PERMISSION_DENIED",
    );
    expect(
      current.repository.transactionOverviewSummary,
    ).not.toHaveBeenCalled();
    expect(current.bankRepository.overviewSummary).not.toHaveBeenCalled();
  });

  it("returns safe structured manual transaction validation issues after authorization", async () => {
    const result = await saveManualTransaction({
      data: {
        id: null,
        expectedUpdatedAt: null,
        action: "save_draft",
        transaction: {
          ownerId,
          kind: "supplier_expense",
          status: "draft",
          documentAmount: "35.12345",
        },
      },
    });

    expect(result).toEqual({
      status: "invalid",
      issues: [
        {
          field: "documentAmount",
          message: "Expected a decimal with at most four places",
        },
      ],
    });
    expect(current.auth.session).toHaveBeenCalledWith("opaque-session");
    expect(current.repository.createManual).not.toHaveBeenCalled();
  });

  it("rejects ownerless manual saves at the authoritative parse boundary", async () => {
    const result = await saveManualTransaction({
      data: {
        id: null,
        expectedUpdatedAt: null,
        action: "save_draft",
        transaction: {
          kind: "supplier_expense",
          status: "draft",
        },
      },
    });

    expect(result).toEqual({
      status: "invalid",
      issues: [{ field: "ownerId", message: "Choose an owner." }],
    });
    expect(current.repository.createManual).not.toHaveBeenCalled();
  });

  it("authorizes before parsing a malformed manual save envelope", async () => {
    current.auth.session.mockResolvedValue(null);
    let failure: unknown;
    try {
      await saveManualTransaction({
        data: {
          id: "malformed-secret-id",
          expectedUpdatedAt: "malformed-secret-revision",
          extra: "malformed-secret-extra",
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("Code UNAUTHENTICATED");
    expect((failure as Error).message).not.toContain("malformed-secret");
    expect(current.repository.createManual).not.toHaveBeenCalled();
  });

  it("returns one safe form issue for an authenticated malformed envelope", async () => {
    const result = await saveManualTransaction({
      data: {
        id: "malformed-secret-id",
        expectedUpdatedAt: "malformed-secret-revision",
        action: "malformed-secret-action",
        transaction: "malformed-secret-transaction",
        extra: "malformed-secret-extra",
      },
    });

    expect(result).toEqual({
      status: "invalid",
      issues: [{ field: "form", message: "Transaction request is invalid." }],
    });
    expect(JSON.stringify(result)).not.toContain("malformed-secret");
    expect(current.repository.createManual).not.toHaveBeenCalled();
  });

  it("sanitises invalid save actions without echoing their value", async () => {
    const result = await saveManualTransaction({
      data: {
        id: null,
        expectedUpdatedAt: null,
        action: "unsafe-provider-secret",
        transaction: { ownerId, kind: "supplier_expense", status: "draft" },
      },
    });

    expect(result).toEqual({
      status: "invalid",
      issues: [{ field: "form", message: "Choose a valid save action." }],
    });
    expect(JSON.stringify(result)).not.toContain("unsafe-provider-secret");
  });

  it("sanitises invalid managed select values", async () => {
    const result = await saveManualTransaction({
      data: {
        id: null,
        expectedUpdatedAt: null,
        action: "save_draft",
        transaction: {
          ownerId,
          kind: "unsafe-provider-secret",
          status: "draft",
        },
      },
    });

    expect(result).toEqual({
      status: "invalid",
      issues: [{ field: "kind", message: "Choose a valid transaction kind." }],
    });
    expect(JSON.stringify(result)).not.toContain("unsafe-provider-secret");
  });

  it("keeps repository failures on the generic diagnostic path", async () => {
    current.repository.createManual.mockRejectedValue(
      new Error("unsafe provider detail"),
    );

    await expect(
      saveManualTransaction({
        data: {
          id: null,
          expectedUpdatedAt: null,
          action: "save_draft",
          transaction: { ownerId, kind: "supplier_expense", status: "draft" },
        },
      }),
    ).rejects.toThrow(/Code UNEXPECTED_ERROR\. Reference/);
  });

  it("returns only the primary failure reference while logging safe cleanup recovery detail", async () => {
    const artifactId = "0f935296-35b3-43bd-bc3d-0caa0b0a2510";
    const primary = Object.assign(new Error("unsafe presign detail"), {
      code: "E_PRESIGN",
    });
    const cleanup = Object.assign(new Error("cleanup unavailable"), {
      name: "CleanupError",
      code: "08006",
      filename: "unsafe.csv",
    });
    current.documents.startUpload.mockRejectedValue(
      new ArtifactPresignRecoveryError(primary, artifactId, cleanup),
    );
    let loggedLine = "";
    const errorWriter = vi
      .spyOn(console, "error")
      .mockImplementation((line) => {
        loggedLine = String(line);
      });
    let clientFailure: unknown;
    try {
      await startArtifactUpload({
        data: {
          ownerId: null,
          artifactProfile: "manual_invoice_pdf_v1",
          filename: "unsafe.pdf",
          mediaType: "application/pdf",
          byteSize: 5,
          checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
      });
    } catch (error) {
      clientFailure = error;
    } finally {
      errorWriter.mockRestore();
    }
    expect(clientFailure).toBeInstanceOf(Error);
    expect((clientFailure as Error).message).toMatch(
      /Code UNEXPECTED_ERROR\. Reference [0-9a-f-]{36}\./,
    );
    expect((clientFailure as Error).message).not.toContain(artifactId);
    expect((clientFailure as Error).message).not.toContain(primary.message);
    const record = JSON.parse(loggedLine);
    expect(record.sourceError.cleanupFailure).toEqual({
      artifactId,
      error: {
        name: cleanup.name,
        code: cleanup.code,
        message: cleanup.message,
      },
    });
    expect(JSON.stringify(record.sourceError.cleanupFailure)).not.toContain(
      "unsafe.csv",
    );
  });

  it("returns a saved discriminator only after repository persistence", async () => {
    const saved = { id: "transaction-id", status: "draft" };
    current.repository.createManual.mockResolvedValue(saved);

    await expect(
      saveManualTransaction({
        data: {
          id: null,
          expectedUpdatedAt: null,
          action: "save_draft",
          transaction: { ownerId, kind: "supplier_expense", status: "draft" },
        },
      }),
    ).resolves.toEqual({ status: "saved", transaction: saved });
    expect(current.repository.createManual).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({ status: "draft" }),
    );
  });

  it("rejects forged attribution fields before repository access", () => {
    expect(() =>
      listWorkspace({
        data: {
          search: "invoice",
          actorEmail: "forged@example.test",
        },
      } as never),
    ).toThrow("Unrecognized key");
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
  });

  it("denies member user administration at the operation boundary", async () => {
    await expect(
      createUser({
        data: {
          email: "new-user@example.test",
          displayName: null,
          role: "member",
        },
      }),
    ).rejects.toThrow("Code PERMISSION_DENIED");
    expect(current.repository.createUser).not.toHaveBeenCalled();
  });

  it("allows an administrator to create a user with the trusted actor ID", async () => {
    current.auth.session.mockResolvedValue(administrator);
    const input = {
      email: "new-user@example.test",
      displayName: "New user",
      role: "member" as const,
    };
    await createUser({ data: input });
    expect(current.repository.createUser).toHaveBeenCalledWith(
      administrator.id,
      input,
    );
  });

  it("uses the trusted actor for reject and confirmed permanent deletion", async () => {
    const artifactId = "22222222-2222-4222-8222-222222222222";
    current.documents.rejectArtifact.mockResolvedValue({
      id: artifactId,
      state: "rejected",
    });
    current.documents.deleteArtifact.mockResolvedValue({
      status: "deleted",
    });

    await expect(
      rejectArtifact({ data: { id: artifactId } }),
    ).resolves.toMatchObject({ state: "rejected" });
    await expect(deleteArtifact({ data: { id: artifactId } })).resolves.toEqual(
      { status: "deleted" },
    );
    expect(current.documents.rejectArtifact).toHaveBeenCalledWith(
      member.id,
      artifactId,
    );
    expect(current.documents.deleteArtifact).toHaveBeenCalledWith(
      member.id,
      artifactId,
    );
  });

  it("denies a viewer before representative workspace repository access", async () => {
    current.auth.session.mockResolvedValue(viewer);
    await expect(listWorkspace({ data: { search: "" } })).rejects.toThrow(
      "Code PERMISSION_DENIED",
    );
    expect(current.repository.listUsers).not.toHaveBeenCalled();
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
    expect(current.repository.listEntrySuggestions).not.toHaveBeenCalled();
  });

  it("requires report export permission in addition to report read for CSV", async () => {
    permissionProbe.requirePermission.mockImplementationOnce(
      (_actor, permission) => {
        expect(permission).toBe(permissions.reportExport);
        throw new FolioDiagnosticError({
          category: "actor",
          code: "PERMISSION_DENIED",
          retryable: false,
        });
      },
    );
    await expect(
      getReport({
        data: {
          basis: "activity",
          periodType: "financial_year",
          format: "csv",
        },
      }),
    ).rejects.toThrow("Code PERMISSION_DENIED");
    expect(permissionProbe.requirePermission).toHaveBeenCalledWith(
      member,
      permissions.reportExport,
    );
    expect(current.repository.listTransactions).not.toHaveBeenCalled();
  });

  it("permits a member JSON report without requiring export", async () => {
    await expect(
      getReport({
        data: {
          basis: "activity",
          periodType: "financial_year",
          format: "json",
        },
      }),
    ).resolves.toMatchObject({ csv: null, report: expect.any(Object) });
    expect(permissionProbe.requirePermission).not.toHaveBeenCalled();
    expect(current.repository.listTransactions).toHaveBeenCalledWith(member.id);
  });

  it("resolves a fresh session for each protected operation", async () => {
    current.auth.session
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(null);
    await listWorkspace({ data: { search: "" } });
    await expect(listWorkspace({ data: { search: "" } })).rejects.toThrow(
      "Code UNAUTHENTICATED",
    );
    expect(current.auth.session).toHaveBeenCalledTimes(2);
    expect(current.repository.listTransactions).toHaveBeenCalledTimes(1);
  });

  it("previews parsed Stripe rows without importing them", async () => {
    current.auth.session.mockResolvedValue(administrator);
    current.documents.readReviewText.mockResolvedValue({
      text: "balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,Sale",
    });
    current.repository.previewStripeImport.mockResolvedValue(["will_import"]);

    await expect(
      previewStripeCsv({
        data: {
          artifactId: "44444444-4444-4444-8444-444444444444",
          page: 1,
        },
      }),
    ).resolves.toMatchObject({
      totalCount: 1,
      willImportCount: 1,
      conflictCount: 0,
      page: 1,
      pageSize: 200,
      totalPages: 1,
      rows: [
        {
          kind: "sale",
          sourceCurrency: "AUD",
          sourceGross: "10.0000",
          sourceFee: "0.3000",
          sourceNet: "9.7000",
          importStatus: "will_import",
        },
      ],
    });
    expect(current.documents.readReviewText).toHaveBeenCalledWith(
      administrator.id,
      "44444444-4444-4444-8444-444444444444",
      "stripe_balance_itemised_csv_v1",
    );
    expect(current.repository.previewStripeImport).toHaveBeenCalledOnce();
  });

  it("returns exactly one preview page for 200 parsed rows", async () => {
    current.auth.session.mockResolvedValue(administrator);
    const rows = Array.from(
      { length: 200 },
      (_, index) =>
        `txn_${index + 1},2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,Sale`,
    );
    current.documents.readReviewText.mockResolvedValue({
      text: `balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description\n${rows.join("\n")}`,
    });
    current.repository.previewStripeImport.mockResolvedValue(
      Array.from({ length: 200 }, () => "will_import"),
    );

    await expect(
      previewStripeCsv({
        data: {
          artifactId: "44444444-4444-4444-8444-444444444444",
          page: 1,
        },
      }),
    ).resolves.toMatchObject({
      totalCount: 200,
      page: 1,
      pageSize: 200,
      totalPages: 1,
      displayedCount: 200,
    });
  });

  it("makes row 201 and conflicts beyond the first page inspectable", async () => {
    current.auth.session.mockResolvedValue(administrator);
    const rows = Array.from(
      { length: 201 },
      (_, index) =>
        `txn_${index + 1},2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,Sale`,
    );
    current.documents.readReviewText.mockResolvedValue({
      text: `balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description\n${rows.join("\n")}`,
    });
    current.repository.previewStripeImport.mockResolvedValue(
      Array.from({ length: 201 }, () => "conflict"),
    );

    await expect(
      previewStripeCsv({
        data: {
          artifactId: "44444444-4444-4444-8444-444444444444",
          page: 2,
        },
      }),
    ).resolves.toMatchObject({
      totalCount: 201,
      conflictCount: 201,
      page: 2,
      pageSize: 200,
      totalPages: 2,
      displayedCount: 1,
      rows: [{ reference: "txn_201", importStatus: "conflict" }],
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  hasPermission,
  operationPermissions,
  permissions,
  resolveAuthorizedActor,
  rolePermissionBundles,
} from "./authorization";

describe("authorization policy", () => {
  it("keeps stable named permissions in reviewed role bundles", () => {
    expect(Object.values(permissions)).toEqual([
      "workspace:read",
      "transaction:read",
      "transaction:write",
      "artifact:upload",
      "artifact:download",
      "artifact:list",
      "artifact:link",
      "artifact:delete",
      "import:stripe",
      "bank_activity:view",
      "bank_activity:import",
      "bank_activity:reconcile",
      "report:read",
      "report:export",
      "report:review",
      "user:admin",
      "audit:read",
      "session:admin",
    ]);
    expect(rolePermissionBundles.viewer).toEqual([]);
    expect(hasPermission("member", permissions.userAdmin)).toBe(false);
    expect(hasPermission("member", permissions.reportExport)).toBe(true);
    expect(hasPermission("member", permissions.reportReview)).toBe(true);
    expect(hasPermission("administrator", permissions.sessionAdmin)).toBe(true);
    expect(operationPermissions.createUser).toEqual([permissions.userAdmin]);
    expect(operationPermissions.exportReport).toEqual([
      permissions.reportRead,
      permissions.reportExport,
    ]);
    expect(operationPermissions.getBankReconciliation).toEqual([
      permissions.bankActivityView,
      permissions.transactionRead,
      permissions.artifactList,
    ]);
    expect(operationPermissions.getNextBankReconciliation).toEqual(
      operationPermissions.getBankReconciliation,
    );
    expect(operationPermissions.getTaxPartnerOptions).toEqual([
      permissions.reportRead,
      permissions.reportReview,
    ]);
    expect(operationPermissions.extractInvoiceFields).toEqual([
      permissions.artifactDownload,
      permissions.artifactUpload,
    ]);
    expect(operationPermissions.createAndMatchBankTransaction).toEqual([
      permissions.bankActivityReconcile,
      permissions.transactionWrite,
      permissions.artifactLink,
    ]);
    expect(Object.keys(operationPermissions)).toEqual([
      "listWorkspace",
      "listUsers",
      "getFolioUiConfig",
      "getTransaction",
      "saveManualTransaction",
      "voidTransaction",
      "previewBulkTransactionEdit",
      "applyBulkTransactionEdit",
      "deleteDraftTransaction",
      "createUser",
      "updateUser",
      "startArtifactUpload",
      "confirmArtifactUpload",
      "downloadArtifact",
      "extractInvoiceFields",
      "rejectArtifact",
      "deleteArtifact",
      "listAvailableInvoiceArtifacts",
      "listArtifacts",
      "linkTransactionArtifact",
      "unlinkTransactionArtifact",
      "importStripeCsv",
      "previewBankCsv",
      "confirmBankImport",
      "cancelBankImport",
      "listBankImports",
      "listBankTransactions",
      "getBankReconciliation",
      "getNextBankReconciliation",
      "reconcileBankTransaction",
      "createAndMatchBankTransaction",
      "getReport",
      "exportReport",
      "getTaxWorksheet",
      "getTaxPartnerOptions",
      "exportTaxSource",
      "reviewTaxWorksheet",
      "exportTaxWorksheet",
      "getRecurringBillsWorkspace",
      "getRecurringBillAttention",
      "previewRecurringBill",
      "saveRecurringBill",
      "setRecurringBillActive",
      "linkRecurringBillTransaction",
      "unlinkRecurringBillTransaction",
    ]);
    for (const required of Object.values(operationPermissions))
      for (const permission of required)
        expect(hasPermission("viewer", permission)).toBe(false);
  });

  it("fails closed without a session and denies missing permissions", async () => {
    await expect(
      resolveAuthorizedActor({
        token: null,
        permission: permissions.workspaceRead,
        session: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      resolveAuthorizedActor({
        token: "opaque",
        permission: permissions.userAdmin,
        session: vi.fn().mockResolvedValue({
          id: "actor-id",
          email: "member@example.test",
          displayName: null,
          role: "member",
        }),
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("returns only the identity resolved by the opaque session", async () => {
    const actor = {
      id: "trusted-actor-id",
      email: "trusted@example.test",
      displayName: null,
      role: "administrator" as const,
    };
    await expect(
      resolveAuthorizedActor({
        token: "opaque",
        permission: permissions.userAdmin,
        session: vi.fn().mockResolvedValue(actor),
      }),
    ).resolves.toBe(actor);
  });

  it("preserves unexpected session lookup failures", async () => {
    const failure = new Error("session lookup unavailable");
    await expect(
      resolveAuthorizedActor({
        token: "opaque",
        permission: permissions.workspaceRead,
        session: vi.fn().mockRejectedValue(failure),
      }),
    ).rejects.toBe(failure);
  });
});

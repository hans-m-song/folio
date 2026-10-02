import type { AuthenticatedUser } from "../database/auth-repository";
import type { User } from "../domain/types";
import { FolioDiagnosticError } from "../domain/diagnostics";

export const permissions = {
  workspaceRead: "workspace:read",
  transactionRead: "transaction:read",
  transactionWrite: "transaction:write",
  artifactUpload: "artifact:upload",
  artifactDownload: "artifact:download",
  artifactList: "artifact:list",
  artifactLink: "artifact:link",
  artifactDelete: "artifact:delete",
  stripeImport: "import:stripe",
  bankActivityView: "bank_activity:view",
  bankActivityImport: "bank_activity:import",
  bankActivityReconcile: "bank_activity:reconcile",
  reportRead: "report:read",
  reportExport: "report:export",
  reportReview: "report:review",
  userAdmin: "user:admin",
  auditRead: "audit:read",
  sessionAdmin: "session:admin",
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];

const memberPermissions = [
  permissions.workspaceRead,
  permissions.transactionRead,
  permissions.transactionWrite,
  permissions.artifactUpload,
  permissions.artifactDownload,
  permissions.artifactList,
  permissions.artifactLink,
  permissions.artifactDelete,
  permissions.stripeImport,
  permissions.bankActivityView,
  permissions.bankActivityImport,
  permissions.bankActivityReconcile,
  permissions.reportRead,
  permissions.reportExport,
  permissions.reportReview,
] as const satisfies readonly Permission[];

export const rolePermissionBundles = {
  administrator: [
    ...memberPermissions,
    permissions.userAdmin,
    permissions.auditRead,
    permissions.sessionAdmin,
  ],
  member: memberPermissions,
  viewer: [],
} as const satisfies Record<User["role"], readonly Permission[]>;

export const operationPermissions = {
  listWorkspace: [permissions.workspaceRead, permissions.transactionRead],
  listUsers: [permissions.userAdmin],
  getFolioUiConfig: [permissions.workspaceRead],
  getTransaction: [permissions.transactionRead],
  saveManualTransaction: [
    permissions.transactionWrite,
    permissions.artifactLink,
  ],
  voidTransaction: [permissions.transactionWrite],
  previewBulkTransactionEdit: [
    permissions.transactionRead,
    permissions.transactionWrite,
  ],
  applyBulkTransactionEdit: [permissions.transactionWrite],
  deleteDraftTransaction: [permissions.transactionWrite],
  createUser: [permissions.userAdmin],
  updateUser: [permissions.userAdmin],
  startArtifactUpload: [permissions.artifactUpload],
  confirmArtifactUpload: [permissions.artifactUpload],
  downloadArtifact: [permissions.artifactDownload],
  extractInvoiceFields: [
    permissions.artifactDownload,
    permissions.artifactUpload,
  ],
  rejectArtifact: [permissions.artifactUpload],
  deleteArtifact: [permissions.artifactDelete],
  listAvailableInvoiceArtifacts: [permissions.artifactList],
  listArtifacts: [permissions.artifactList],
  linkTransactionArtifact: [permissions.artifactLink],
  unlinkTransactionArtifact: [permissions.artifactLink],
  importStripeCsv: [permissions.stripeImport],
  previewBankCsv: [permissions.bankActivityImport],
  confirmBankImport: [permissions.bankActivityImport],
  cancelBankImport: [permissions.bankActivityImport],
  listBankImports: [permissions.bankActivityView],
  listBankTransactions: [permissions.bankActivityView],
  getBankReconciliation: [
    permissions.bankActivityView,
    permissions.transactionRead,
    permissions.artifactList,
  ],
  getNextBankReconciliation: [
    permissions.bankActivityView,
    permissions.transactionRead,
    permissions.artifactList,
  ],
  reconcileBankTransaction: [permissions.bankActivityReconcile],
  createAndMatchBankTransaction: [
    permissions.bankActivityReconcile,
    permissions.transactionWrite,
    permissions.artifactLink,
  ],
  getReport: [permissions.reportRead],
  exportReport: [permissions.reportRead, permissions.reportExport],
  getTaxWorksheet: [permissions.reportRead],
  getTaxPartnerOptions: [permissions.reportRead, permissions.reportReview],
  exportTaxSource: [permissions.reportRead, permissions.reportExport],
  reviewTaxWorksheet: [permissions.reportRead, permissions.reportReview],
  exportTaxWorksheet: [permissions.reportRead, permissions.reportExport],
  getRecurringBillsWorkspace: [permissions.transactionRead],
  getRecurringBillAttention: [permissions.transactionRead],
  previewRecurringBill: [permissions.transactionRead],
  saveRecurringBill: [permissions.transactionWrite],
  setRecurringBillActive: [permissions.transactionWrite],
  linkRecurringBillTransaction: [permissions.transactionWrite],
  unlinkRecurringBillTransaction: [permissions.transactionWrite],
} as const satisfies Record<string, readonly Permission[]>;

export const hasPermission = (
  role: User["role"],
  permission: Permission,
): boolean => rolePermissionBundles[role].includes(permission as never);

const rejection = (code: "UNAUTHENTICATED" | "PERMISSION_DENIED") =>
  new FolioDiagnosticError({
    category: "actor",
    code,
    retryable: false,
  });

export const requirePermission = (
  actor: Pick<AuthenticatedUser, "role">,
  permission: Permission,
): void => {
  if (!hasPermission(actor.role, permission))
    throw rejection("PERMISSION_DENIED");
};

export const resolveAuthorizedActor = async (input: {
  token: string | null;
  permission: Permission;
  session: (token: string | null) => Promise<AuthenticatedUser | null>;
}): Promise<AuthenticatedUser> => {
  const actor = await input.session(input.token);
  if (!actor) throw rejection("UNAUTHENTICATED");
  requirePermission(actor, input.permission);
  return actor;
};

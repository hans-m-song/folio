// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";
import { StrictMode, type ComponentType } from "react";
import type { TransactionInput } from "../domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestEvidenceProps {
  actorId: string;
  contextKey: string;
  selectedArtifact?: {
    id: string;
    filename?: string;
    originalFilename?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  } | null;
  busy?: boolean;
  onApproved: (artifact: unknown) => void;
  onPendingChange: (pending: boolean) => void;
}

interface TestDraftEditorProps {
  onBeforeSaveMatchNext?: (transaction: TransactionInput) => Promise<boolean>;
  allowSaveMatchNext?: boolean;
  onCancel: () => void;
  onSaved: (
    status: "draft" | "recorded",
    saved: {
      transactionId: string;
      afterSave?: "match_next";
      refreshSucceeded: boolean;
    },
  ) => void;
}

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  invalidate: vi.fn(),
  getBankReconciliation: vi.fn(),
  reconcileBankTransaction: vi.fn(),
  getNextBankReconciliation: vi.fn(),
  createAndMatchBankTransaction: vi.fn(),
  evidenceProps: null as TestEvidenceProps | null,
  approvalArtifact: null as unknown,
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  draftEditorProps: null as TestDraftEditorProps | null,
  draftRefreshSucceeded: true,
  draftTransaction: {} as TransactionInput,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.data,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));

vi.mock("../server/bank-operations", () => ({
  createAndMatchBankTransaction: mocks.createAndMatchBankTransaction,
  getBankReconciliation: mocks.getBankReconciliation,
  getNextBankReconciliation: mocks.getNextBankReconciliation,
  reconcileBankTransaction: mocks.reconcileBankTransaction,
}));

vi.mock("../components/bank-invoice-evidence", () => ({
  BankInvoiceEvidence: (props: TestEvidenceProps) => {
    mocks.evidenceProps = props;
    return (
      <section aria-label="Invoice evidence test panel">
        <output data-testid="invoice-evidence-context">
          {props.actorId}:{props.contextKey}
        </output>
        <button type="button" onClick={() => props.onPendingChange(true)}>
          Begin pending invoice review
        </button>
        <button
          type="button"
          onClick={() => {
            if (mocks.approvalArtifact)
              props.onApproved(mocks.approvalArtifact);
            props.onPendingChange(false);
          }}
        >
          Approve test invoice PDF
        </button>
        <button type="button" onClick={() => props.onPendingChange(false)}>
          Clear pending invoice review
        </button>
      </section>
    );
  },
}));

vi.mock("./-transaction-workflow", () => ({
  loadManualTransactionRouteData: mocks.loadDraft,
  ManualTransactionRoute: (props: TestDraftEditorProps) => {
    mocks.draftEditorProps = props;
    return (
      <div>
        Draft transaction editor
        <button type="button" onClick={props.onCancel}>
          Cancel test draft
        </button>
        <button
          type="button"
          onClick={() => {
            mocks.saveDraft();
            props.onSaved("recorded", {
              transactionId: "33333333-3333-4333-8333-333333333333",
              refreshSucceeded: mocks.draftRefreshSucceeded,
            });
          }}
        >
          Save test draft
        </button>
        {props.allowSaveMatchNext && (
          <button
            type="button"
            onClick={async () => {
              if (
                props.onBeforeSaveMatchNext &&
                !(await props.onBeforeSaveMatchNext(mocks.draftTransaction))
              )
                return;
              mocks.saveDraft();
              props.onSaved("recorded", {
                transactionId: "33333333-3333-4333-8333-333333333333",
                afterSave: "match_next",
                refreshSucceeded: mocks.draftRefreshSucceeded,
              });
            }}
          >
            Save test draft and match next
          </button>
        )}
      </div>
    );
  },
}));

import { Route } from "./banking.reconcile";

interface TestBankRow {
  id: string;
  postedDate: string;
  amountAud: string;
  description: string;
  metadata: Record<string, string | number | boolean | null>;
  reviewState: "private" | "transfer" | "duplicate" | "matched" | "unresolved";
  revision: string;
  updatedAt: string;
  updatedById: string;
  matchedTransactionId: string | null;
}

interface TestRouteData {
  actorId: string;
  gstRegistered: boolean;
  counts: {
    total: number;
    reviewed: number;
    unresolved: number;
    matched: number;
    private: number;
    transfer: number;
    duplicate: number;
  };
  rows: Pick<
    TestBankRow,
    "id" | "postedDate" | "amountAud" | "description" | "reviewState"
  >[];
  detail: {
    bankTransaction: TestBankRow;
    source: {
      profile: string;
      filename: string;
      earliestDate: string;
      latestDate: string;
      sourceRow: number;
    };
    candidates: unknown[];
  };
  suggestions: unknown[];
  users: {
    id: string;
    email: string;
    displayName: string;
    role: "member";
    active: true;
  }[];
  entrySuggestions: {
    counterparties: string[];
    categories: string[];
    supplierCategories: { counterparty: string; category: string }[];
  };
  availableArtifacts: {
    id: string;
    filename: string;
    checksumSha256?: string;
  }[];
}

const actorId = "11111111-1111-4111-8111-111111111111";
const bankTransactionId = "22222222-2222-4222-8222-222222222222";
const originalFileArrayBuffer = Object.getOwnPropertyDescriptor(
  File.prototype,
  "arrayBuffer",
);
const originalDialogShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalDialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
const originalElementGetAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "getAnimations",
);

const makeRouteData = (
  reviewState: TestBankRow["reviewState"] = "unresolved",
  amountAud = "-35.1200",
): TestRouteData => {
  const bankTransaction: TestBankRow = {
    id: bankTransactionId,
    postedDate: "2026-09-24",
    amountAud,
    description: "PAYMENT TO EXAMPLE",
    metadata: {
      counterpartySuggestion: "Example Supplier",
      runningBalance: null,
      valueDate: null,
      cardSuffix: null,
      foreignCurrency: null,
      foreignAmount: null,
    },
    reviewState,
    revision: "3",
    updatedAt: "2026-09-24T00:00:00.000Z",
    updatedById: actorId,
    matchedTransactionId:
      reviewState === "matched" ? "33333333-3333-4333-8333-333333333333" : null,
  };

  return {
    actorId,
    gstRegistered: true,
    counts: {
      total: 1,
      reviewed: reviewState === "unresolved" ? 0 : 1,
      unresolved: reviewState === "unresolved" ? 1 : 0,
      matched: reviewState === "matched" ? 1 : 0,
      private: reviewState === "private" ? 1 : 0,
      transfer: reviewState === "transfer" ? 1 : 0,
      duplicate: reviewState === "duplicate" ? 1 : 0,
    },
    rows: [bankTransaction],
    detail: {
      bankTransaction,
      source: {
        profile: "CommBank CSV",
        filename: "bank.csv",
        earliestDate: "2026-09-24",
        latestDate: "2026-09-24",
        sourceRow: 17,
      },
      candidates: [],
    },
    suggestions: [],
    users: [
      {
        id: actorId,
        email: "owner@example.test",
        displayName: "Owner",
        role: "member",
        active: true,
      },
    ],
    entrySuggestions: {
      counterparties: ["Example Supplier"],
      categories: [],
      supplierCategories: [],
    },
    availableArtifacts: [],
  };
};

const ReconcilePage = (Route as unknown as { component: ComponentType })
  .component;
const loadBankReconciliation = (
  Route as unknown as {
    loader: (input: {
      deps: {
        bank?: string;
        artifact?: string;
        unresolved?: boolean;
        window?: "14" | "31" | "all";
        page?: number;
      };
    }) => Promise<unknown>;
  }
).loader;
const selectedRow = () => (mocks.data as TestRouteData).detail.bankTransaction;
const createKindButton = (kind: string) =>
  within(screen.getByRole("dialog", { name: "Create transaction" })).getByRole(
    "button",
    { name: `Create ${kind}` },
  );
const addMatchCandidate = () => {
  const data = mocks.data as TestRouteData;
  const transactionId = "33333333-3333-4333-8333-333333333333";
  data.detail.candidates = [
    {
      id: transactionId,
      counterparty: "Synthetic supplier",
      amountAud: "35.1200",
      settledAt: "2026-09-24T00:00:00.000Z",
      kind: "supplier_expense",
      dateDistanceDays: 0,
      textScore: 1,
      reference: null,
      description: "Synthetic payment",
    },
  ];
  return transactionId;
};

const makeInvoiceCandidate = (
  overrides: {
    id?: string;
    amountAud?: string | null;
    candidateDate?: string | null;
    dateDistanceDays?: number;
    documentAmount?: string | null;
    documentCurrency?: string | null;
    matchBasis?: "invoice_aud" | "invoice_foreign_hint";
    counterparty?: string;
  } = {},
) => ({
  id: "33333333-3333-4333-8333-333333333333",
  counterparty: "Invoice supplier",
  amountAud: "-35.1200",
  settledAt: null,
  candidateDate: "2026-09-22",
  documentAmount: "35.1200",
  documentCurrency: "AUD",
  matchBasis: "invoice_aud" as const,
  kind: "supplier_expense",
  dateDistanceDays: 2,
  textScore: 1,
  reference: "INV-35",
  description: "Invoice payment",
  ...overrides,
});

const openSuggestedDraft = async (
  strict = false,
  kind: "draft_transaction" | "existing_match" = "draft_transaction",
) => {
  const user = userEvent.setup();
  (mocks.data as TestRouteData).suggestions = [
    {
      submissionId: "44444444-4444-4444-8444-444444444444",
      kind,
      observedBankRevision: "3",
      createdAt: "2026-09-26T00:00:00.000Z",
      actionability: "actionable",
      transaction: {
        id: "33333333-3333-4333-8333-333333333333",
        status: "draft",
        kind: "supplier_expense",
        counterparty: "Synthetic supplier",
        documentCurrency: "AUD",
        documentAmount: "35.12",
      },
    },
  ];
  mocks.loadDraft.mockResolvedValue({
    transaction: { status: "draft", sourceSystem: "manual" },
  });
  const element = () =>
    strict ? (
      <StrictMode>
        <ReconcilePage />
      </StrictMode>
    ) : (
      <ReconcilePage />
    );
  const view = render(element());
  await user.click(screen.getByRole("button", { name: "Edit draft here" }));
  await screen.findByText("Draft transaction editor");
  return { user, view, rerender: () => view.rerender(element()) };
};

const applyMockReconciliation = async ({
  data,
}: {
  data: {
    expectedRevision: string;
    command:
      | { type: "match"; transactionId: string }
      | {
          type: "classify";
          classification: "private" | "transfer" | "duplicate";
        }
      | { type: "reset" };
  };
}) => {
  const row = selectedRow();
  const revision = String(Number(row.revision) + 1);
  if (data.command.type === "classify") {
    row.reviewState = data.command.classification;
    row.matchedTransactionId = null;
  } else if (data.command.type === "match") {
    row.reviewState = "matched";
    row.matchedTransactionId = data.command.transactionId;
  } else {
    row.reviewState = "unresolved";
    row.matchedTransactionId = null;
  }
  row.revision = revision;
  return { status: "applied", revision } as const;
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
  mocks.data = makeRouteData();
  mocks.search = { bank: bankTransactionId, window: "14", page: 1 };
  mocks.navigate.mockReset();
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.getBankReconciliation.mockReset();
  mocks.reconcileBankTransaction
    .mockReset()
    .mockImplementation(applyMockReconciliation);
  mocks.getNextBankReconciliation.mockReset().mockResolvedValue({
    status: "none",
  });
  mocks.createAndMatchBankTransaction.mockReset();
  mocks.evidenceProps = null;
  mocks.approvalArtifact = null;
  mocks.loadDraft.mockReset();
  mocks.saveDraft.mockReset();
  mocks.draftEditorProps = null;
  mocks.draftRefreshSucceeded = true;
  mocks.draftTransaction = {
    kind: "supplier_expense",
    status: "recorded",
    documentCurrency: "AUD",
    documentAmount: "35.1200",
    invoiceDate: "2026-09-22",
    occurredAt: null,
    settledAt: "2026-09-24",
    settlementCurrency: "AUD",
    settlementAmount: "35.1200",
  } as TransactionInput;
});

afterEach(() => {
  cleanup();
  if (originalDialogShowModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalDialogShowModal,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalDialogClose)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      originalDialogClose,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (originalElementGetAnimations)
    Object.defineProperty(
      HTMLElement.prototype,
      "getAnimations",
      originalElementGetAnimations,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  if (originalFileArrayBuffer)
    Object.defineProperty(
      File.prototype,
      "arrayBuffer",
      originalFileArrayBuffer,
    );
  else Reflect.deleteProperty(File.prototype, "arrayBuffer");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bank reconciliation actions", () => {
  it.each([
    { window: undefined, expectedWindowDays: 31 },
    { window: "14" as const, expectedWindowDays: 14 },
    { window: "31" as const, expectedWindowDays: 31 },
    { window: "all" as const, expectedWindowDays: null },
  ])(
    "loads the $window date window with the matching repository range",
    async ({ window, expectedWindowDays }) => {
      await loadBankReconciliation({
        deps: window === undefined ? {} : { window },
      });

      expect(mocks.getBankReconciliation).toHaveBeenCalledWith({
        data: {
          bankTransactionId: undefined,
          artifactId: undefined,
          unresolvedOnly: false,
          windowDays: expectedWindowDays,
          offset: 0,
        },
      });
    },
  );

  it("shows ±31 days for an omitted date window in controls and queue links", () => {
    mocks.search = { bank: bankTransactionId, page: 1 };
    render(<ReconcilePage />);

    expect(
      (
        screen.getByRole("combobox", {
          name: "Date window",
        }) as HTMLSelectElement
      ).value,
    ).toBe("±31 days");
    expect(screen.getByText(/No candidates within ±31 days/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /PAYMENT TO EXAMPLE/ })
        .getAttribute("href"),
    ).toBe(`/banking/reconcile?bank=${bankTransactionId}&window=31&page=1`);
  });

  it("marks queue, imported movement, and candidate amounts as money", () => {
    const data = makeRouteData();
    data.detail.candidates = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        counterparty: "Example Supplier",
        amountAud: "28.0000",
        settledAt: "2026-09-24T00:00:00.000Z",
        kind: "supplier_expense",
        dateDistanceDays: 0,
        textScore: 10,
        reference: "INV-28",
        description: "Hosting",
      },
    ];
    mocks.data = data;
    render(<ReconcilePage />);

    const queueAmount = screen.getByText("-$35.1200");
    expect(queueAmount.tagName).toBe("STRONG");
    expect(queueAmount.getAttribute("data-money-value")).toBe("");

    const importedMovement = screen.getByText("-35.1200");
    expect(importedMovement.getAttribute("data-money-value")).toBe("");

    const candidateAmount = screen.getByText("+$28.0000");
    expect(candidateAmount.getAttribute("data-money-value")).toBe("");
  });

  it("keeps ordinary matching on the selected row", async () => {
    const user = userEvent.setup();
    const transactionId = addMatchCandidate();
    render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(
      screen.getByRole("button", { name: "Match selected transaction" }),
    );

    expect(mocks.reconcileBankTransaction).toHaveBeenCalledWith({
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: { type: "match", transactionId },
      },
    });
    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { window: "14", description: "within ±14 days" },
    { window: "31", description: "within ±31 days" },
    { window: "all", description: "across all dates" },
  ])(
    "explains the empty candidate state for the $window date window",
    ({ window, description }) => {
      const data = makeRouteData();
      data.detail.candidates = [];
      mocks.data = data;
      mocks.search = { ...mocks.search, window };
      render(<ReconcilePage />);

      expect(
        screen.getByText(new RegExp(`No candidates ${description}`)),
      ).toBeTruthy();
      expect(
        screen.getByText(
          /Invoice matches need a recorded invoice or activity date/,
        ),
      ).toBeTruthy();
    },
  );

  it("requires explicit settlement confirmation for an AUD invoice match", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    const candidate = makeInvoiceCandidate();
    data.detail.candidates = [candidate];
    mocks.data = data;
    render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));

    expect(screen.getByText("AUD 35.1200")).toBeTruthy();
    const candidateDate = screen.getByText("22 Sept 2026", { exact: true });
    expect(
      candidateDate
        .closest(".banking-candidate-content")
        ?.textContent?.includes("Invoice/activity date:"),
    ).toBe(true);
    expect(
      screen.getByRole("group", { name: "Confirm bank settlement" })
        .textContent,
    ).toContain("The bank posted date 24 Sept 2026 and AUD movement");
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();

    const confirmation = screen.getByRole("checkbox", {
      name: "I confirm the bank posted date and AUD movement as settlement.",
    });
    const matchButton = screen.getByRole("button", {
      name: "Match selected transaction",
    });
    expect(confirmation).toMatchObject({ checked: false });
    expect(matchButton).toMatchObject({ disabled: true });
    expect(
      screen.getByText(/Unmatching later removes the bank link/),
    ).toBeTruthy();

    await user.click(confirmation);
    await user.click(matchButton);

    expect(mocks.reconcileBankTransaction).toHaveBeenCalledWith({
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: {
          type: "match",
          transactionId: candidate.id,
          confirmSettlement: true,
        },
      },
    });
  });

  it("marks foreign invoice candidates as unverified and requires acknowledgement", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    const candidate = makeInvoiceCandidate({
      matchBasis: "invoice_foreign_hint",
      amountAud: null,
      candidateDate: "2026-09-23",
      dateDistanceDays: 1,
      documentAmount: "37.08",
      documentCurrency: "USD",
    });
    data.detail.candidates = [candidate];
    mocks.data = data;
    render(<ReconcilePage />);

    expect(screen.getByText("Unverified foreign invoice hint")).toBeTruthy();
    expect(screen.getByText("USD 37.08")).toBeTruthy();
    await user.click(screen.getByRole("radio"));

    expect(screen.getByRole("alert").textContent).toContain("unverified hint");
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();

    const confirmation = screen.getByRole("checkbox", {
      name: "I acknowledge this foreign invoice amount is an unverified hint and confirm the bank movement as settlement.",
    });
    const matchButton = screen.getByRole("button", {
      name: "Match selected transaction",
    });
    expect(matchButton).toMatchObject({ disabled: true });
    await user.click(confirmation);
    await user.click(matchButton);

    expect(mocks.reconcileBankTransaction).toHaveBeenCalledWith({
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: {
          type: "match",
          transactionId: candidate.id,
          confirmSettlement: true,
        },
      },
    });
  });

  it("clears settlement acknowledgement when the candidate selection changes", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    data.detail.candidates = [
      makeInvoiceCandidate(),
      makeInvoiceCandidate({
        id: "44444444-4444-4444-8444-444444444444",
        counterparty: "Second supplier",
      }),
    ];
    mocks.data = data;
    render(<ReconcilePage />);

    const [firstCandidate, secondCandidate] = screen.getAllByRole("radio");
    const confirmationName =
      "I confirm the bank posted date and AUD movement as settlement.";
    await user.click(firstCandidate!);
    await user.click(screen.getByRole("checkbox", { name: confirmationName }));
    expect(
      screen.getByRole("checkbox", { name: confirmationName }),
    ).toMatchObject({ checked: true });

    await user.click(secondCandidate!);

    expect(
      screen.getByRole("checkbox", { name: confirmationName }),
    ).toMatchObject({ checked: false });
    expect(
      screen.getByRole("button", { name: "Match selected transaction" }),
    ).toMatchObject({ disabled: true });
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it("clears settlement acknowledgement when navigating to another bank row", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    data.detail.candidates = [makeInvoiceCandidate()];
    mocks.data = data;
    const view = render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    const confirmationName =
      "I confirm the bank posted date and AUD movement as settlement.";
    await user.click(screen.getByRole("checkbox", { name: confirmationName }));
    expect(
      screen.getByRole("checkbox", { name: confirmationName }),
    ).toMatchObject({ checked: true });

    const nextBankId = "66666666-6666-4666-8666-666666666666";
    const nextData = makeRouteData();
    nextData.detail.bankTransaction.id = nextBankId;
    nextData.rows = nextData.rows.map((row) => ({ ...row, id: nextBankId }));
    nextData.detail.candidates = [makeInvoiceCandidate()];
    mocks.data = nextData;
    mocks.search = { ...mocks.search, bank: nextBankId };
    view.rerender(<ReconcilePage />);

    await waitFor(() =>
      expect(
        (
          screen.queryByRole("checkbox", {
            name: confirmationName,
          }) as HTMLInputElement | null
        )?.checked ?? false,
      ).toBe(false),
    );
    await user.click(screen.getByRole("radio"));
    expect(
      screen.getByRole("checkbox", { name: confirmationName }),
    ).toMatchObject({ checked: false });
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it("requires fresh settlement acknowledgement after changing the date window", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    data.detail.candidates = [makeInvoiceCandidate()];
    mocks.data = data;
    const view = render(<ReconcilePage />);
    const confirmationName =
      "I confirm the bank posted date and AUD movement as settlement.";

    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("checkbox", { name: confirmationName }));
    expect(
      screen.getByRole("checkbox", { name: confirmationName }),
    ).toMatchObject({ checked: true });

    mocks.search = { ...mocks.search, window: "31" };
    view.rerender(<ReconcilePage />);

    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: confirmationName }),
      ).toBeNull(),
    );
    await user.click(screen.getByRole("radio"));
    expect(
      screen.getByRole("checkbox", { name: confirmationName }),
    ).toMatchObject({ checked: false });
    expect(
      screen.getByRole("button", { name: "Match selected transaction" }),
    ).toMatchObject({ disabled: true });
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it("requires fresh confirmation when the same candidate reloads with different facts", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    data.detail.candidates = [makeInvoiceCandidate()];
    mocks.data = data;
    const view = render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(
      screen.getByRole("checkbox", {
        name: "I confirm the bank posted date and AUD movement as settlement.",
      }),
    );

    const refreshedData = makeRouteData();
    refreshedData.detail.candidates = [
      makeInvoiceCandidate({
        matchBasis: "invoice_foreign_hint",
        amountAud: null,
        candidateDate: "2026-09-23",
        documentAmount: "37.08",
        documentCurrency: "USD",
      }),
    ];
    mocks.data = refreshedData;
    view.rerender(<ReconcilePage />);

    expect(
      screen.getByRole("checkbox", {
        name: "I acknowledge this foreign invoice amount is an unverified hint and confirm the bank movement as settlement.",
      }),
    ).toMatchObject({ checked: false });
    expect(
      screen.getByRole("button", { name: "Match selected transaction" }),
    ).toMatchObject({ disabled: true });
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it.each(["applied", "already_applied"] as const)(
    "advances after an explicit successful match (%s)",
    async (status) => {
      const user = userEvent.setup();
      addMatchCandidate();
      const artifactId = "55555555-5555-4555-8555-555555555555";
      const targetId = "66666666-6666-4666-8666-666666666666";
      mocks.search = {
        bank: bankTransactionId,
        artifact: artifactId,
        unresolved: true,
        window: "31",
        page: 4,
      };
      mocks.reconcileBankTransaction.mockResolvedValueOnce({
        status,
        revision: "4",
      });
      mocks.getNextBankReconciliation.mockResolvedValueOnce({
        status: "target",
        bankId: targetId,
        page: 5,
      });
      render(<ReconcilePage />);

      await user.click(screen.getByRole("radio"));
      await user.click(screen.getByRole("button", { name: "Match and next" }));

      expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledWith({
        data: {
          bankTransactionId,
          artifactId,
          unresolvedOnly: true,
        },
      });
      expect(mocks.navigate).toHaveBeenCalledWith({
        search: {
          bank: targetId,
          artifact: artifactId,
          unresolved: true,
          window: "31",
          page: 5,
        },
      });
    },
  );

  it.each(["explicit match", "create and match"] as const)(
    "uses the server target when an implicit loader selection changes after %s",
    async (action) => {
      const user = userEvent.setup();
      const artifactId = "55555555-5555-4555-8555-555555555555";
      const implicitNextId = "66666666-6666-4666-8666-666666666666";
      const serverNextId = "77777777-7777-4777-8777-777777777777";
      mocks.search = {
        artifact: artifactId,
        unresolved: true,
        window: "31",
        page: 4,
      };
      mocks.getNextBankReconciliation.mockResolvedValueOnce({
        status: "target",
        bankId: serverNextId,
        page: 5,
      });
      mocks.createAndMatchBankTransaction.mockResolvedValueOnce({
        status: "applied",
        revision: "4",
      });
      let rerenderAfterInvalidate = () => {};
      mocks.invalidate.mockImplementation(async () => {
        const refreshed = makeRouteData();
        refreshed.detail.bankTransaction.id = implicitNextId;
        refreshed.rows = refreshed.rows.map((row) => ({
          ...row,
          id: implicitNextId,
        }));
        mocks.data = refreshed;
        rerenderAfterInvalidate();
      });
      if (action === "explicit match") addMatchCandidate();
      const view = render(<ReconcilePage />);
      rerenderAfterInvalidate = () => view.rerender(<ReconcilePage />);

      if (action === "explicit match") {
        await user.click(screen.getByRole("radio"));
        await user.click(
          screen.getByRole("button", { name: "Match and next" }),
        );
      } else {
        await user.click(
          screen.getByRole("button", { name: "Create transaction" }),
        );
        await user.click(createKindButton("supplier expense"));
        await user.click(
          screen.getByRole("checkbox", {
            name: "Go to the next unresolved row after a successful match",
          }),
        );
        await user.click(
          screen.getByRole("button", { name: "Save, match, and next" }),
        );
      }

      await waitFor(() =>
        expect(mocks.getNextBankReconciliation).toHaveBeenCalledWith({
          data: {
            bankTransactionId,
            artifactId,
            unresolvedOnly: true,
          },
        }),
      );
      expect(mocks.navigate).toHaveBeenLastCalledWith({
        search: {
          bank: serverNextId,
          artifact: artifactId,
          unresolved: true,
          window: "31",
          page: 5,
        },
      });
      expect(implicitNextId).not.toBe(serverNextId);
    },
  );

  it("does not select a next row when matching fails", async () => {
    const user = userEvent.setup();
    addMatchCandidate();
    mocks.reconcileBankTransaction.mockRejectedValueOnce(
      new Error("The row changed since it was loaded."),
    );
    render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Match and next" }));

    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("retries a failed advance with only a queue read", async () => {
    const user = userEvent.setup();
    addMatchCandidate();
    mocks.getNextBankReconciliation
      .mockRejectedValueOnce(new Error("Queue read unavailable"))
      .mockResolvedValueOnce({
        status: "target",
        bankId: "66666666-6666-4666-8666-666666666666",
        page: 2,
      });
    render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Match and next" }));
    expect(
      await screen.findByRole("button", { name: "Retry advance" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry advance" }));

    expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("retries queue selection after target navigation fails without rematching", async () => {
    const user = userEvent.setup();
    addMatchCandidate();
    mocks.getNextBankReconciliation.mockResolvedValue({
      status: "target",
      bankId: "66666666-6666-4666-8666-666666666666",
      page: 2,
    });
    mocks.navigate.mockRejectedValueOnce(new Error("Navigation failed"));
    render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Match and next" }));
    expect(
      await screen.findByRole("button", { name: "Retry advance" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry advance" }));

    expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });

  it("keeps the matched detail visible when the unresolved queue is empty", async () => {
    const user = userEvent.setup();
    addMatchCandidate();
    mocks.getNextBankReconciliation.mockResolvedValueOnce({ status: "none" });
    render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Match and next" }));

    expect(selectedRow().reviewState).toBe("matched");
    expect(
      screen.getByText(
        "The bank row was matched. No unresolved rows remain in this queue.",
      ),
    ).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("rechecks a target resolved during loading once, then stops", async () => {
    const user = userEvent.setup();
    const targetId = "66666666-6666-4666-8666-666666666666";
    const followingId = "77777777-7777-4777-8777-777777777777";
    addMatchCandidate();
    mocks.getNextBankReconciliation
      .mockResolvedValueOnce({ status: "target", bankId: targetId, page: 2 })
      .mockResolvedValueOnce({
        status: "target",
        bankId: followingId,
        page: 2,
      });
    const view = render(<ReconcilePage />);

    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: "Match and next" }));
    const targetData = makeRouteData("matched");
    targetData.detail.bankTransaction.id = targetId;
    mocks.data = targetData;
    mocks.search = { bank: targetId, window: "14", page: 2 };
    view.rerender(<ReconcilePage />);

    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(2),
    );
    expect(mocks.getNextBankReconciliation.mock.calls[1]?.[0]).toEqual({
      data: {
        bankTransactionId: targetId,
        artifactId: undefined,
        unresolvedOnly: false,
      },
    });
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });

  it.each(["filters", "bank selection"] as const)(
    "ignores a late queue response after the active %s changes",
    async (changedContext) => {
      const user = userEvent.setup();
      addMatchCandidate();
      let resolveNext!: (value: {
        status: "target";
        bankId: string;
        page: number;
      }) => void;
      mocks.getNextBankReconciliation.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
      );
      const view = render(<ReconcilePage />);

      await user.click(screen.getByRole("radio"));
      const matchClick = user.click(
        screen.getByRole("button", { name: "Match and next" }),
      );
      await waitFor(() =>
        expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
      );
      mocks.search =
        changedContext === "filters"
          ? {
              ...mocks.search,
              artifact: "77777777-7777-4777-8777-777777777777",
            }
          : {
              ...mocks.search,
              bank: "77777777-7777-4777-8777-777777777777",
            };
      view.rerender(<ReconcilePage />);
      resolveNext({
        status: "target",
        bankId: "66666666-6666-4666-8666-666666666666",
        page: 2,
      });
      await matchClick;

      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["applied", "already_applied"] as const)(
    "offers create-and-next for a successful save (%s)",
    async (status) => {
      const user = userEvent.setup();
      mocks.createAndMatchBankTransaction.mockResolvedValue({
        status,
        revision: "4",
      });
      mocks.getNextBankReconciliation.mockResolvedValueOnce({
        status: "target",
        bankId: "66666666-6666-4666-8666-666666666666",
        page: 2,
      });
      render(<ReconcilePage />);

      await user.click(
        screen.getByRole("button", { name: "Create transaction" }),
      );
      await user.click(createKindButton("supplier expense"));
      await user.click(
        screen.getByRole("checkbox", {
          name: "Go to the next unresolved row after a successful match",
        }),
      );
      await user.click(
        screen.getByRole("button", { name: "Save, match, and next" }),
      );

      expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(1);
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledWith({
        data: {
          bankTransactionId,
          artifactId: undefined,
          unresolvedOnly: false,
        },
      });
      expect(mocks.navigate).toHaveBeenCalledWith({
        search: {
          bank: "66666666-6666-4666-8666-666666666666",
          window: "14",
          page: 2,
        },
      });
    },
  );

  it("does not advance when the create-and-match operation is invalid", async () => {
    const user = userEvent.setup();
    mocks.createAndMatchBankTransaction.mockResolvedValueOnce({
      status: "invalid",
      issues: [],
    });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Go to the next unresolved row after a successful match",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save, match, and next" }),
    );

    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("toggles the unresolved queue and pages using its filtered count", async () => {
    const data = makeRouteData();
    data.counts.total = 250;
    data.counts.unresolved = 50;
    mocks.data = data;
    const user = userEvent.setup();
    const { rerender } = render(<ReconcilePage />);

    await user.click(screen.getByRole("checkbox", { name: "Unresolved only" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: {
        ...mocks.search,
        unresolved: true,
        page: 1,
        bank: undefined,
      },
    });

    mocks.search = { ...mocks.search, unresolved: true };
    rerender(<ReconcilePage />);
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen
        .getByRole("link", { name: /PAYMENT TO EXAMPLE/ })
        .getAttribute("href"),
    ).toContain("unresolved=true");
  });

  it.each([false, true])(
    "records a suggested draft and matches its refreshed settlement candidate once (StrictMode: %s)",
    async (strict) => {
      const { user, rerender } = await openSuggestedDraft(strict);
      expect((mocks.data as TestRouteData).detail.candidates).toEqual([]);
      const refreshed = makeRouteData();
      mocks.data = refreshed;
      const transactionId = addMatchCandidate();
      rerender();
      await user.click(
        screen.getByRole("button", { name: "Save test draft and match next" }),
      );
      await waitFor(() =>
        expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
      );
      rerender();
      expect(mocks.reconcileBankTransaction).toHaveBeenCalledExactlyOnceWith({
        data: {
          bankTransactionId,
          expectedRevision: "3",
          command: { type: "match", transactionId },
        },
      });
      expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
      expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /Retry match/ })).toBeNull();
    },
  );

  it("edits and matches the same draft referenced by an existing-match suggestion", async () => {
    const transactionId = "33333333-3333-4333-8333-333333333333";
    const { user, rerender } = await openSuggestedDraft(
      false,
      "existing_match",
    );
    expect(mocks.loadDraft).toHaveBeenCalledExactlyOnceWith(transactionId);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();

    mocks.data = makeRouteData();
    const candidateId = addMatchCandidate();
    rerender();
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );

    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
    );
    expect(candidateId).toBe(transactionId);
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledExactlyOnceWith({
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: { type: "match", transactionId },
      },
    });
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
  });

  it("keeps normal suggested-draft save separate from matching", async () => {
    const { user } = await openSuggestedDraft();
    addMatchCandidate();
    await user.click(screen.getByRole("button", { name: "Save test draft" }));
    expect(
      screen.getByText(
        "Draft recorded. Match the bank row separately when ready.",
      ),
    ).toBeTruthy();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
  });

  it("retries only the saved draft's match after a failed match", async () => {
    const { user, rerender } = await openSuggestedDraft();
    addMatchCandidate();
    rerender();
    mocks.reconcileBankTransaction.mockRejectedValueOnce(
      new Error("Temporary match failure"),
    );
    mocks.reconcileBankTransaction.mockResolvedValueOnce({
      status: "already_applied",
      revision: "4",
    });
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry match and next" }),
    );
    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
    );
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.loadDraft).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Retry match and next" }),
    ).toBeNull();
  });

  it("confirms invoice settlement before recording, then matches and advances without retry", async () => {
    const { user, rerender } = await openSuggestedDraft();
    mocks.draftTransaction = {
      ...mocks.draftTransaction,
      settledAt: null,
      settlementAmount: null,
    };
    mocks.draftTransaction = {
      ...mocks.draftTransaction,
      documentAmount: "35.12",
    };
    mocks.saveDraft.mockImplementationOnce(() => {
      mocks.data = makeRouteData();
      (mocks.data as TestRouteData).detail.candidates = [
        makeInvoiceCandidate({ candidateDate: "2026-09-22T00:00:00.000Z" }),
      ];
      rerender();
    });
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Confirm bank settlement before saving?",
    });
    expect(dialog.textContent).toContain("24 Sept 2026");
    expect(dialog.textContent).toContain("-$35.1200");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Confirm settlement and save",
      }),
    );
    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
    );
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledExactlyOnceWith({
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: {
          type: "match",
          transactionId: makeInvoiceCandidate().id,
          confirmSettlement: true,
        },
      },
    });
    expect(
      screen.queryByRole("button", { name: "Retry match and next" }),
    ).toBeNull();
  });

  it("cancels invoice settlement confirmation without saving and prompts again for edited facts", async () => {
    const { user } = await openSuggestedDraft();
    mocks.draftTransaction = {
      ...mocks.draftTransaction,
      settledAt: null,
      settlementAmount: null,
    };
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Keep editing",
      }),
    );
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    mocks.draftTransaction = {
      ...mocks.draftTransaction,
      invoiceDate: "2026-09-23",
    };
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "23 Sept 2026",
    );
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it.each([
    "revision",
    "postedDate",
    "amountAud",
    "navigation",
    "draft",
    "unmount",
  ] as const)(
    "cancels the pending invoice submission when %s changes",
    async (change) => {
      const { user, rerender, view } = await openSuggestedDraft();
      mocks.draftTransaction = {
        ...mocks.draftTransaction,
        settledAt: null,
        settlementAmount: null,
      };
      await user.click(
        screen.getByRole("button", { name: "Save test draft and match next" }),
      );
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      if (change === "unmount") view.unmount();
      else if (change === "draft")
        await user.click(
          screen.getByRole("button", { name: "Cancel test draft" }),
        );
      else {
        if (change === "navigation")
          mocks.search = { ...mocks.search, window: "all" };
        if (change === "revision") selectedRow().revision = "4";
        if (change === "postedDate") selectedRow().postedDate = "2026-09-25";
        if (change === "amountAud") selectedRow().amountAud = "-40.0000";
        rerender();
      }
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(mocks.saveDraft).not.toHaveBeenCalled();
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    },
  );

  it("requires explicit foreign-invoice acknowledgement before saving", async () => {
    const { user, rerender } = await openSuggestedDraft();
    selectedRow().metadata.foreignCurrency = "USD";
    selectedRow().metadata.foreignAmount = "20.0000";
    mocks.draftTransaction = {
      ...mocks.draftTransaction,
      settledAt: null,
      settlementAmount: null,
      documentCurrency: "USD",
      documentAmount: "20",
    };
    (mocks.data as TestRouteData).detail.candidates = [
      makeInvoiceCandidate({
        documentCurrency: "USD",
        documentAmount: "20.0000",
        amountAud: null,
        matchBasis: "invoice_foreign_hint",
      }),
    ];
    rerender();
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("unverified hint");
    expect(dialog.textContent).toContain("USD 20");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Confirm settlement and save",
      }),
    );
    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
    );
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(
      mocks.reconcileBankTransaction.mock.lastCall?.[0].data.command
        .confirmSettlement,
    ).toBe(true);
  });

  it.each(["documentAmount", "candidateDate", "kind", "matchBasis"] as const)(
    "does not reuse pre-save acknowledgement after refreshed %s changes",
    async (fact) => {
      const { user, rerender } = await openSuggestedDraft();
      mocks.draftTransaction = {
        ...mocks.draftTransaction,
        settledAt: null,
        settlementAmount: null,
      };
      mocks.saveDraft.mockImplementationOnce(() => {
        const changes = {
          documentAmount: "40.0000",
          candidateDate: "2026-09-23",
          kind: "processing_fee",
          matchBasis: "invoice_foreign_hint",
        };
        (mocks.data as TestRouteData).detail.candidates = [
          makeInvoiceCandidate({ [fact]: changes[fact] }),
        ];
        rerender();
      });
      await user.click(
        screen.getByRole("button", { name: "Save test draft and match next" }),
      );
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Confirm settlement and save",
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Retry match and next" }),
        ).toHaveProperty("disabled", true),
      );
      expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
      expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
    },
  );

  it.each(["before", "during"])(
    "invalidates acknowledged invoice facts across A-B-A refreshes %s match retry",
    async (timing) => {
      const { user, rerender } = await openSuggestedDraft();
      mocks.draftTransaction = {
        ...mocks.draftTransaction,
        settledAt: null,
        settlementAmount: null,
      };
      (mocks.data as TestRouteData).detail.candidates = [
        makeInvoiceCandidate(),
      ];
      mocks.draftRefreshSucceeded = false;
      await user.click(
        screen.getByRole("button", { name: "Save test draft and match next" }),
      );
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Confirm settlement and save",
        }),
      );
      let finishRefresh: () => void = () => undefined;
      if (timing === "during") {
        mocks.invalidate.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishRefresh = resolve;
            }),
        );
        await user.click(
          screen.getByRole("button", { name: "Refresh and retry match" }),
        );
      }
      (mocks.data as TestRouteData).detail.candidates = [
        makeInvoiceCandidate({ documentAmount: "40.0000" }),
      ];
      rerender();
      (mocks.data as TestRouteData).detail.candidates = [
        makeInvoiceCandidate(),
      ];
      rerender();
      if (timing === "during")
        await act(async () => {
          finishRefresh();
        });
      else
        await user.click(
          screen.getByRole("button", { name: "Refresh and retry match" }),
        );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Retry match and next" }),
        ).toHaveProperty("disabled", true),
      );
      expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    },
  );

  it("requires fresh acknowledgement when invoice facts change during retry refresh", async () => {
    const { user, rerender } = await openSuggestedDraft();
    (mocks.data as TestRouteData).detail.candidates = [makeInvoiceCandidate()];
    rerender();
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "I confirm the bank posted date and AUD movement as settlement.",
      }),
    );
    mocks.invalidate.mockImplementationOnce(async () => {
      const refreshed = makeRouteData();
      refreshed.detail.candidates = [
        makeInvoiceCandidate({ documentAmount: "40.0000" }),
      ];
      mocks.data = refreshed;
      rerender();
    });
    await user.click(
      screen.getByRole("button", { name: "Retry match and next" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry match and next" }),
      ).toHaveProperty("disabled", true),
    );
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it.each(["absent candidate", "refresh failure"] as const)(
    "retains the saved ID and refreshes before retry after %s",
    async (failure) => {
      const { user, rerender } = await openSuggestedDraft();
      mocks.draftRefreshSucceeded = failure !== "refresh failure";
      if (failure === "refresh failure") addMatchCandidate();
      await user.click(
        screen.getByRole("button", { name: "Save test draft and match next" }),
      );
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole("link", { name: "View saved transaction" })
          .getAttribute("href"),
      ).toBe("/transactions/33333333-3333-4333-8333-333333333333");
      mocks.invalidate.mockImplementationOnce(async () => {
        mocks.data = makeRouteData();
        addMatchCandidate();
        rerender();
      });
      await user.click(
        screen.getByRole("button", { name: "Refresh and retry match" }),
      );
      await waitFor(() =>
        expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
      );
      expect(mocks.invalidate).toHaveBeenCalledWith({ sync: true });
      expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
      expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    },
  );

  it("requires review when the original bank revision changes before the save callback", async () => {
    const { rerender } = await openSuggestedDraft();
    const callback = mocks.draftEditorProps!.onSaved;
    mocks.data = makeRouteData();
    addMatchCandidate();
    selectedRow().revision = "4";
    rerender();
    expect(mocks.draftEditorProps?.allowSaveMatchNext).toBe(false);
    act(() =>
      callback("recorded", {
        transactionId: "33333333-3333-4333-8333-333333333333",
        afterSave: "match_next",
        refreshSucceeded: true,
      }),
    );
    expect(
      screen.getByText(/The bank row changed. Review its current state/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry match/ })).toBeNull();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it("requires review for a conflicting matched transaction", async () => {
    const { rerender } = await openSuggestedDraft();
    const callback = mocks.draftEditorProps!.onSaved;
    mocks.data = makeRouteData("matched");
    selectedRow().matchedTransactionId = "77777777-7777-4777-8777-777777777777";
    selectedRow().revision = "4";
    rerender();
    act(() =>
      callback("recorded", {
        transactionId: "33333333-3333-4333-8333-333333333333",
        afterSave: "match_next",
        refreshSucceeded: true,
      }),
    );
    expect(
      screen.getByText(/The bank row changed. Review its current state/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "View saved transaction" })
        .getAttribute("href"),
    ).toBe("/transactions/33333333-3333-4333-8333-333333333333");
    expect(screen.queryByRole("button", { name: /Retry match/ })).toBeNull();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
  });

  it("claims duplicate retry clicks once while refreshing the saved match", async () => {
    const { user, rerender } = await openSuggestedDraft();
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    let finishRefresh: () => void = () => {};
    mocks.invalidate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const retry = screen.getByRole("button", {
      name: "Refresh and retry match",
    });
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Match and next" }),
    ).toHaveProperty("disabled", true);
    await act(async () => {
      addMatchCandidate();
      rerender();
      finishRefresh();
    });
    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
    );
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
  });

  it.each(["navigation", "cancel", "unmount"] as const)(
    "ignores a stale save callback after %s",
    async (change) => {
      const { user, view, rerender } = await openSuggestedDraft();
      const callback = mocks.draftEditorProps!.onSaved;
      if (change === "navigation") {
        mocks.search = { ...mocks.search, window: "all" };
        rerender();
      } else if (change === "cancel") {
        await user.click(
          screen.getByRole("button", { name: "Cancel test draft" }),
        );
      } else view.unmount();
      act(() =>
        callback("recorded", {
          transactionId: "33333333-3333-4333-8333-333333333333",
          afterSave: "match_next",
          refreshSucceeded: true,
        }),
      );
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
      expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("link", { name: "View saved transaction" }),
      ).toBeNull();
    },
  );

  it("does not advance a completed saved-draft match after navigating away and back", async () => {
    const { user, rerender } = await openSuggestedDraft();
    addMatchCandidate();
    rerender();
    let finishMatch: (result: {
      status: "applied";
      revision: string;
    }) => void = () => {};
    mocks.reconcileBankTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMatch = resolve;
        }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    mocks.search = { ...mocks.search, window: "all" };
    rerender();
    mocks.search = { ...mocks.search, window: "14" };
    rerender();
    await act(async () => finishMatch({ status: "applied", revision: "4" }));
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.getNextBankReconciliation).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Retry match and next" }),
    ).toBeNull();
  });

  it("advances from same-transaction matched readback without another match write", async () => {
    const { user, rerender } = await openSuggestedDraft();
    addMatchCandidate();
    rerender();
    mocks.reconcileBankTransaction.mockRejectedValueOnce(
      new Error("Response lost"),
    );
    mocks.invalidate.mockImplementationOnce(async () => {
      mocks.data = makeRouteData("matched");
      rerender();
    });
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    await waitFor(() =>
      expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(1),
    );
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Retry match and next" }),
    ).toBeNull();
  });

  it("keeps only advance recovery after a suggested draft was matched", async () => {
    const { user, rerender } = await openSuggestedDraft();
    addMatchCandidate();
    rerender();
    mocks.getNextBankReconciliation.mockRejectedValueOnce(
      new Error("Queue unavailable"),
    );
    await user.click(
      screen.getByRole("button", { name: "Save test draft and match next" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry advance" }),
    );
    expect(mocks.getNextBankReconciliation).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Retry match and next" }),
    ).toBeNull();
  });

  it("opens a bank-linked draft inline without recording or matching it", async () => {
    (mocks.data as TestRouteData).suggestions = [
      {
        submissionId: "44444444-4444-4444-8444-444444444444",
        kind: "draft_transaction",
        note: "Review the invoice PDF.",
        observedBankRevision: "3",
        createdAt: "2026-09-26T00:00:00.000Z",
        actionability: "actionable",
        transaction: {
          id: "55555555-5555-4555-8555-555555555555",
          status: "draft",
          kind: "supplier_expense",
          counterparty: "Example supplier",
          reference: null,
          documentCurrency: "USD",
          documentAmount: "35.19",
          settlementCurrency: "AUD",
          settlementAmount: "35.12",
        },
      },
    ];
    render(<ReconcilePage />);

    expect(screen.getByText("Suggested draft")).toBeTruthy();
    mocks.loadDraft.mockResolvedValue({
      transaction: { status: "draft", sourceSystem: "manual" },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Edit draft here" }));
    await waitFor(() =>
      expect(screen.getByText("Draft transaction editor")).toBeTruthy(),
    );
    expect(
      screen.getByRole("region", { name: "Bank row details" }),
    ).toBeTruthy();
    expect(mocks.loadDraft).toHaveBeenCalledWith(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
  });

  it("shows queue metadata above the description and keeps the selected row in its scroll area", () => {
    const rect = (top: number, bottom: number) =>
      ({
        x: 0,
        y: top,
        top,
        right: 320,
        bottom,
        left: 0,
        width: 320,
        height: bottom - top,
        toJSON: () => ({}),
      }) as DOMRect;
    let selectedRowBounds = rect(280, 350);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("banking-queue-scroll"))
          return rect(100, 300);
        if (
          this.matches(".banking-queue li") &&
          this.querySelector('[aria-current="page"]')
        )
          return selectedRowBounds;
        return rect(0, 0);
      },
    );

    const { container, rerender } = render(<ReconcilePage />);
    const queue = container.querySelector(
      ".banking-queue-scroll",
    ) as HTMLDivElement;
    const link = screen.getByRole("link", { name: /PAYMENT TO EXAMPLE/ });

    expect(link.querySelector(".banking-queue-meta time")?.textContent).toBe(
      "24 Sept 2026",
    );
    expect(
      link.querySelector(".banking-queue-meta .banking-state")?.textContent,
    ).toBe("unresolved");
    expect(link.querySelector(".banking-queue-main")?.textContent).toContain(
      "PAYMENT TO EXAMPLE",
    );
    expect(link.querySelector(".banking-queue-main strong")?.textContent).toBe(
      "-$35.1200",
    );
    expect(queue.scrollTop).toBe(50);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);

    const nextPage = makeRouteData();
    const nextPageRow = {
      ...nextPage.detail.bankTransaction,
      id: "44444444-4444-4444-8444-444444444444",
      postedDate: "2026-09-25",
      description: "NEXT PAGE PAYMENT",
    };
    nextPage.rows = [nextPageRow];
    nextPage.detail.bankTransaction = nextPageRow;
    mocks.data = nextPage;
    mocks.search = {
      bank: nextPageRow.id,
      window: "14",
      page: 2,
    };
    selectedRowBounds = rect(320, 370);
    queue.scrollTop = 0;
    rerender(<ReconcilePage />);

    expect(queue.scrollTop).toBe(70);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });

  it("shows compact selected-row sections with readable dates and coded identifiers", () => {
    const { container } = render(<ReconcilePage />);
    const selected = screen.getByRole("region", { name: "Bank row details" });

    const transaction = within(selected).getByRole("region", {
      name: "Transaction",
    });
    expect(transaction).toBeTruthy();
    expect(
      Array.from(
        transaction.querySelectorAll(".banking-detail-grid > div dt"),
        (label) => label.textContent,
      ),
    ).toEqual([
      "Description",
      "Date",
      "Movement (AUD, as imported)",
      "Payment hints",
    ]);
    expect(
      within(selected).getByRole("region", { name: "Source" }),
    ).toBeTruthy();
    expect(
      within(selected).getByRole("region", { name: "Folio metadata" }),
    ).toBeTruthy();
    expect(
      selected.querySelectorAll(".banking-selected-review-groups details"),
    ).toHaveLength(0);
    expect(
      within(selected).getAllByText("24 Sept 2026", { exact: true }),
    ).toHaveLength(3);
    expect(within(selected).getByText(/24 Sept 2026.*10:00 AEST/)).toBeTruthy();

    const identifiers = Array.from(
      selected.querySelectorAll(".banking-identifier"),
    ).map((identifier) => identifier.textContent);
    expect(identifiers).toEqual(["CommBank CSV", bankTransactionId, actorId]);
    expect(
      container.querySelector(".banking-selected-review-groups"),
    ).toBeTruthy();
  });

  it("opens an accessible drawer over the queue and restores focus after Escape", async () => {
    const user = userEvent.setup();
    const routeData = mocks.data as TestRouteData;
    routeData.detail.bankTransaction.metadata.postedDate = "27/08/2026";
    routeData.detail.source.earliestDate = "27/08/2026";
    routeData.detail.source.latestDate = "2026-08-28";
    const { container } = render(<ReconcilePage />);
    const trigger = screen.getByRole("button", {
      name: "Create transaction",
    });

    await user.click(trigger);

    const drawer = screen.getByRole("dialog", {
      name: "Create transaction",
    });
    expect(container.querySelector(".banking-queue-panel")).toBeTruthy();
    expect(within(drawer).getByText("PAYMENT TO EXAMPLE")).toBeTruthy();
    const transaction = within(drawer).getByRole("region", {
      name: "Transaction",
    });
    expect(transaction).toBeTruthy();
    expect(
      Array.from(
        transaction.querySelectorAll(".banking-create-summary-grid > div dt"),
        (label) => label.textContent,
      ),
    ).toEqual(["Description", "Date", "Movement (AUD)", "Payment hints"]);
    const source = within(drawer).getByRole("region", { name: "Source" });
    expect(
      within(drawer).getByRole("region", { name: "Folio metadata" }),
    ).toBeTruthy();
    expect(
      drawer.querySelectorAll(".banking-create-drawer-summary details"),
    ).toHaveLength(0);
    const drawerBody = drawer.querySelector(".banking-create-drawer-body");
    const drawerSummary = drawer.querySelector(
      ".banking-create-drawer-summary",
    );
    expect(drawerBody?.contains(drawerSummary)).toBe(true);
    expect(
      drawerBody?.contains(drawer.querySelector(".banking-kind-choice")),
    ).toBe(true);
    const transactionDate = transaction.querySelector("time");
    expect(transactionDate?.textContent).toBe("27 Aug 2026");
    expect(transactionDate?.getAttribute("datetime")).toBe("2026-08-27");
    const sourceDates = Array.from(source.querySelectorAll("time"));
    expect(sourceDates.map((date) => date.textContent)).toEqual([
      "27 Aug 2026",
      "28 Aug 2026",
    ]);
    expect(sourceDates.map((date) => date.getAttribute("datetime"))).toEqual([
      "2026-08-27",
      "2026-08-28",
    ]);
    expect(within(drawer).getByText(/24 Sept 2026.*10:00 AEST/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark private" })).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create transaction" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses a clean create drawer from an outside click", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);
    const trigger = screen.getByRole("button", {
      name: "Create transaction",
    });

    await user.click(trigger);
    const overlay = document.querySelector(".banking-create-overlay");
    if (!overlay) throw new Error("Create drawer overlay is missing");
    await user.click(overlay);

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create transaction" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("retains the inert create drawer until its exit animation finishes", async () => {
    const user = userEvent.setup();
    let finishExit: (() => void) | undefined;
    const exitFinished = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    const exitAnimation = { finished: exitFinished } as unknown as Animation;
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value(this: HTMLElement) {
        return this.hasAttribute("data-exiting") ? [exitAnimation] : [];
      },
    });

    render(<ReconcilePage />);
    const trigger = screen.getByRole("button", {
      name: "Create transaction",
    });
    await user.click(trigger);
    await user.click(createKindButton("supplier expense"));
    const drawer = screen.getByRole("dialog", {
      name: "Create transaction",
    });
    const description = within(drawer).getByRole("textbox", {
      name: "Description",
    }) as HTMLInputElement;
    const close = within(drawer).getByRole("button", {
      name: "Return to reconciliation queue",
    });

    await user.click(close);

    expect(
      document
        .querySelector(".banking-create-overlay")
        ?.hasAttribute("data-exiting"),
    ).toBe(true);
    expect(
      document
        .querySelector(".banking-create-modal")
        ?.hasAttribute("data-exiting"),
    ).toBe(true);
    expect(drawer.hasAttribute("inert")).toBe(true);
    expect(description.value).toBe("PAYMENT TO EXAMPLE");
    expect(document.activeElement).not.toBe(trigger);

    await act(async () => {
      finishExit?.();
      await exitFinished;
    });
    await waitFor(() =>
      expect(document.querySelector(".banking-create-overlay")).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("cancels deferred drawer cleanup when the drawer reopens during exit", async () => {
    const user = userEvent.setup();
    let finishExit: (() => void) | undefined;
    const exitFinished = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    const exitAnimation = { finished: exitFinished } as unknown as Animation;
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value(this: HTMLElement) {
        return this.hasAttribute("data-exiting") ? [exitAnimation] : [];
      },
    });

    render(<ReconcilePage />);
    const trigger = screen.getByRole("button", {
      name: "Create transaction",
    });
    await user.click(trigger);
    await user.click(createKindButton("supplier expense"));
    const close = screen.getByRole("button", {
      name: "Return to reconciliation queue",
    });
    await user.click(close);

    await user.click(trigger);

    const drawer = screen.getByRole("dialog", {
      name: "Create transaction",
    });
    expect(
      within(drawer).getByRole("group", {
        name: "Create transaction by kind",
      }),
    ).toBeTruthy();
    expect(
      within(drawer).queryByRole("textbox", { name: "Description" }),
    ).toBeNull();

    await act(async () => {
      finishExit?.();
      await exitFinished;
      await Promise.resolve();
    });
    expect(document.querySelector(".banking-create-overlay")).toBeTruthy();
    expect(
      screen.getByRole("dialog", { name: "Create transaction" }),
    ).toBeTruthy();
  });

  it("confirms discarding edited transaction fields before closing", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);
    const trigger = screen.getByRole("button", {
      name: "Create transaction",
    });

    await user.click(trigger);
    await user.click(createKindButton("supplier expense"));
    const description = screen.getByRole("textbox", { name: "Description" });
    await user.clear(description);
    await user.type(description, "Edited transaction description");
    const overlay = document.querySelector(".banking-create-overlay");
    if (!overlay) throw new Error("Create drawer overlay is missing");
    await user.click(overlay);

    expect(
      await screen.findByRole("alertdialog", {
        name: "Discard transaction edits?",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("dialog", { name: "Create transaction" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(
      screen.queryByRole("alertdialog", {
        name: "Discard transaction edits?",
      }),
    ).toBeNull();
    const overlayAfterCancel = document.querySelector(
      ".banking-create-overlay",
    );
    if (!overlayAfterCancel)
      throw new Error("Create drawer overlay is missing");
    await user.click(overlayAfterCancel);
    await user.click(screen.getByRole("button", { name: "Discard edits" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create transaction" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the create drawer open during a pending save after an outside click", async () => {
    const user = userEvent.setup();
    let resolveSubmission!: (value: {
      status: "applied";
      revision: string;
    }) => void;
    const submission = new Promise<{
      status: "applied";
      revision: string;
    }>((resolve) => {
      resolveSubmission = resolve;
    });
    mocks.createAndMatchBankTransaction.mockReturnValueOnce(submission);
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );
    await waitFor(() =>
      expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(1),
    );

    const overlay = document.querySelector(".banking-create-overlay");
    if (!overlay) throw new Error("Create drawer overlay is missing");
    await user.click(overlay);

    expect(
      screen.getByRole("dialog", { name: "Create transaction" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("alertdialog", { name: "Discard transaction edits?" }),
    ).toBeNull();

    await act(async () =>
      resolveSubmission({ status: "applied", revision: "4" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create transaction" }),
      ).toBeNull(),
    );
  });

  it("keeps supplier autocomplete options selectable in the create drawer", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    const supplier = screen.getByRole("combobox", {
      name: "Supplier / counterparty",
    });
    await user.click(supplier);
    await user.click(
      await screen.findByRole("option", { name: "Example Supplier" }),
    );

    expect(supplier).toHaveProperty("value", "Example Supplier");
  });

  it("prefills verified bank facts while leaving supplier and invoice facts blank", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    expect(
      screen.getByRole("group", { name: "Create transaction by kind" }),
    ).toBeTruthy();
    expect(createKindButton("supplier expense")).toBeTruthy();
    expect(createKindButton("processing fee")).toBeTruthy();
    expect(createKindButton("sale refund")).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Choose transaction kind" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Invoice total (tax-inclusive)" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Apply source hints" }),
    ).toBeNull();

    await user.click(createKindButton("supplier expense"));

    expect(
      screen.getByRole("textbox", { name: "Invoice total (tax-inclusive)" }),
    ).toMatchObject({ value: "" });
    expect(
      screen.getByRole("textbox", { name: "Settlement amount" }),
    ).toMatchObject({ value: "35.1200" });
    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toMatchObject({ value: "" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({ value: "" });
    expect(
      screen.getByLabelText("Payment date / final posted date"),
    ).toMatchObject({ value: "2026-09-24" });
    expect(screen.getByRole("textbox", { name: "Description" })).toMatchObject({
      value: "PAYMENT TO EXAMPLE",
    });
    expect(screen.getByText(/No available invoice PDFs yet/)).toBeTruthy();
    expect(screen.getByText("Bank CSV provenance")).toBeTruthy();
    expect(screen.getAllByText("Payment hints").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("Parsed counterparty suggestion: Example Supplier"),
    ).toBeNull();
    expect(screen.queryByText(/running balance|card suffix/i)).toBeNull();

    await user.click(screen.getByText("Advanced"));
    expect(
      screen.getByRole("combobox", { name: "Settlement currency" }),
    ).toMatchObject({ value: "AUD" });
    expect(screen.getByRole("combobox", { name: "Owner" })).toMatchObject({
      value: "Owner",
    });
    expect(screen.getByLabelText("Occurrence date")).toMatchObject({
      value: "",
    });
  });

  it("prefills bank payment details without copying supplier or invoice-date hints", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("processing fee"));

    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toMatchObject({ value: "" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({ value: "" });
    expect(
      screen.getByLabelText("Payment date / final posted date"),
    ).toMatchObject({ value: "2026-09-24" });
    expect(screen.getByRole("textbox", { name: "Description" })).toMatchObject({
      value: "PAYMENT TO EXAMPLE",
    });
  });

  it("prefills owner funding from the positive bank movement without GST", async () => {
    const user = userEvent.setup();
    mocks.data = makeRouteData("unresolved", "35.1200");
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("owner contribution"));

    expect(
      screen.getByRole("textbox", { name: "Contribution amount" }),
    ).toMatchObject({ value: "35.1200" });
    expect(
      screen.getByRole("textbox", { name: "Settlement amount" }),
    ).toMatchObject({ value: "35.1200" });
    expect(screen.queryByRole("textbox", { name: /Invoice total/ })).toBeNull();
    expect(screen.getByLabelText("Funding date")).toMatchObject({ value: "" });
    expect(
      screen.getByText(/does not establish an invoice total, GST/),
    ).toBeTruthy();

    await user.click(screen.getByText("Tax and classification"));
    expect(
      screen.getByRole("combobox", { name: "Document tax treatment" }),
    ).toMatchObject({ value: "No tax", disabled: true });
    expect(
      screen.queryByRole("combobox", { name: "GST credit status" }),
    ).toBeNull();
  });

  it("does not treat an outgoing movement as owner funding", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    expect(createKindButton("supplier expense")).toBeTruthy();
    expect(createKindButton("processing fee")).toBeTruthy();
    expect(createKindButton("sale refund")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create sale" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create transfer" }),
    ).toBeNull();
    expect(screen.getByText(/corresponding review action/)).toBeTruthy();
    await user.click(createKindButton("supplier expense"));

    const nestedKind = screen.getByRole("combobox", { name: "Kind" });
    expect(screen.queryByRole("option", { name: "Sale" })).toBeNull();
    expect(
      screen.queryByRole("option", { name: "Owner contribution" }),
    ).toBeNull();
    expect(nestedKind).toMatchObject({ value: "Supplier expense" });
    await user.click(screen.getByRole("button", { name: "Show Kind options" }));
    expect(screen.getByRole("option", { name: "Processing fee" })).toBeTruthy();

    await selectAutocompleteOption(nestedKind, "Processing fee");
    expect(nestedKind).toMatchObject({ value: "Processing fee" });
  });

  it("follows document currency defaults for a new bank-created expense", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.click(screen.getByText("Tax and classification"));

    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    const treatment = screen.getByRole("combobox", {
      name: "Document tax treatment",
    });
    expect(treatment).toMatchObject({
      value: "Australian GST included (suggest total ÷ 11)",
    });

    await user.clear(currency);
    await user.type(currency, "USD");
    expect(treatment).toMatchObject({ value: "Foreign tax included" });
  });

  it("approves invoice evidence without resetting bank facts or filename inference", async () => {
    const user = userEvent.setup();
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const data = makeRouteData();
    const approval = {
      id: artifactId,
      filename: "chosen-download-name.pdf",
      originalFilename: "Acme Supplies-2026-09-20-INV-77.pdf",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      artifactProfile: "manual_invoice_pdf_v1",
      mediaType: "application/pdf",
      state: "available",
    };
    mocks.data = data;
    mocks.approvalArtifact = approval;
    mocks.createAndMatchBankTransaction.mockResolvedValue({
      status: "applied",
      revision: "4",
    });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));

    expect(
      screen.getByTestId("invoice-evidence-context").textContent,
    ).toContain(`${actorId}:`);
    expect(document.querySelector(".banking-create-overlay")).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Settlement amount" }),
    ).toMatchObject({ value: "35.1200" });
    const description = screen.getByRole("textbox", { name: "Description" });
    await user.clear(description);
    await user.type(description, "Invoice for this bank payment");

    await user.click(
      screen.getByRole("button", { name: "Approve test invoice PDF" }),
    );
    const selectedArtifact = await screen.findByRole("checkbox", {
      name: "chosen-download-name.pdf",
    });
    await waitFor(() =>
      expect(selectedArtifact).toHaveProperty("checked", true),
    );
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(description).toHaveProperty(
      "value",
      "Invoice for this bank payment",
    );
    const filenameSuggestions = screen.getByRole("group", {
      name: "Suggestions from PDF 1: chosen-download-name.pdf",
    });
    await user.click(
      within(filenameSuggestions).getByRole("button", {
        name: "Apply supplier Acme Supplies",
      }),
    );
    await user.click(
      within(filenameSuggestions).getByRole("button", {
        name: "Apply date 2026-09-20",
      }),
    );
    await user.click(
      within(filenameSuggestions).getByRole("button", {
        name: "Apply reference INV-77",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    await waitFor(() =>
      expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(1),
    );
    const submission = mocks.createAndMatchBankTransaction.mock.calls[0]?.[0];
    expect(submission?.data.artifactIds).toEqual([artifactId]);
    expect(submission?.data.transaction).toMatchObject({
      sourceArtifactId: artifactId,
      counterparty: "Acme Supplies",
      invoiceDate: "2026-09-20",
      reference: "INV-77",
      description: "Invoice for this bank payment",
      settlementAmount: "35.1200",
    });
  });

  it("keeps transaction fields unchanged while invoice evidence is pending", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    const activityDate = document.querySelector<HTMLInputElement>(
      "#transaction-occurred-at",
    );
    if (!activityDate) throw new Error("Occurrence date field is missing");
    fireEvent.change(activityDate, { target: { value: "2026-09-17" } });
    await user.click(
      screen.getByRole("button", { name: "Begin pending invoice review" }),
    );
    expect(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    ).toHaveProperty("disabled", true);
    expect(
      document.querySelector<HTMLInputElement>("#transaction-counterparty")
        ?.value,
    ).toBe("");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-invoice-date")
        ?.value,
    ).toBe("");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-reference")?.value,
    ).toBe("");
    expect(activityDate.value).toBe("2026-09-17");
    expect(activityDate.value).toBe("2026-09-17");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-settled-at")
        ?.value,
    ).toBe("2026-09-24");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-settlement-amount")
        ?.value,
    ).toBe("35.1200");
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    ).toHaveProperty("disabled", true);
    expect(mocks.evidenceProps).not.toHaveProperty("onApplyToTransaction");
  });

  it("blocks matching while evidence is pending, then preserves approved evidence and transaction ID for retry", async () => {
    const user = userEvent.setup();
    const artifactId = "44444444-4444-4444-8444-444444444444";
    mocks.approvalArtifact = {
      id: artifactId,
      filename: "invoice.pdf",
      originalFilename: "Invoice-2026-09-20-INV-77.pdf",
      periodStart: null,
      periodEnd: null,
      artifactProfile: "manual_invoice_pdf_v1",
      mediaType: "application/pdf",
      state: "available",
    };
    mocks.createAndMatchBankTransaction
      .mockRejectedValueOnce(new Error("The match request was interrupted."))
      .mockResolvedValueOnce({ status: "applied", revision: "4" });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.click(
      screen.getByRole("button", { name: "Approve test invoice PDF" }),
    );
    await screen.findByRole("checkbox", { name: "invoice.pdf" });
    await user.click(
      screen.getByRole("button", { name: "Begin pending invoice review" }),
    );

    expect(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    ).toHaveProperty("disabled", true);
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Clear pending invoice review" }),
    );
    const saveButton = screen.getByRole("button", {
      name: "Save changes (recorded)",
    });
    await waitFor(() => expect(saveButton).toHaveProperty("disabled", false));
    await user.click(saveButton);

    const alert = await screen.findByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(
      screen.getByText(
        /transaction submission ID is preserved for a safe retry/i,
      ),
    ).toBeTruthy();
    const firstSubmission =
      mocks.createAndMatchBankTransaction.mock.calls[0]?.[0];
    expect(firstSubmission?.data.artifactIds).toEqual([artifactId]);
    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    await waitFor(() =>
      expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(2),
    );
    const retrySubmission =
      mocks.createAndMatchBankTransaction.mock.calls[1]?.[0];
    expect(retrySubmission?.data.transactionId).toBe(
      firstSubmission?.data.transactionId,
    );
    expect(retrySubmission?.data.artifactIds).toEqual([artifactId]);
  });

  it("submits only the currently selected available PDF after evidence selection changes", async () => {
    const user = userEvent.setup();
    const firstArtifactId = "44444444-4444-4444-8444-444444444444";
    const secondArtifactId = "55555555-5555-4555-8555-555555555555";
    const data = makeRouteData();
    data.availableArtifacts = [
      { id: firstArtifactId, filename: "first-invoice.pdf" },
      { id: secondArtifactId, filename: "second-invoice.pdf" },
    ];
    mocks.data = data;
    mocks.createAndMatchBankTransaction.mockResolvedValue({
      status: "applied",
      revision: "4",
    });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.click(
      screen.getByRole("checkbox", { name: "first-invoice.pdf" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "first-invoice.pdf" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "second-invoice.pdf" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    await waitFor(() =>
      expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(1),
    );
    const submission = mocks.createAndMatchBankTransaction.mock.calls[0]?.[0];
    expect(submission?.data.artifactIds).toEqual([secondArtifactId]);
    expect(submission?.data.transaction.sourceArtifactId).toBe(
      secondArtifactId,
    );
  });

  it("ignores stale evidence callbacks and blocks closing during pending invoice review", async () => {
    const user = userEvent.setup();
    const staleArtifactId = "44444444-4444-4444-8444-444444444444";
    const { rerender } = render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    const staleProps = mocks.evidenceProps;
    expect(staleProps).not.toBeNull();

    const revisedData = makeRouteData();
    revisedData.detail.bankTransaction.revision = "4";
    mocks.data = revisedData;
    mocks.search = { ...mocks.search, window: "31" };
    rerender(<ReconcilePage />);
    const currentProps = mocks.evidenceProps;
    expect(currentProps?.contextKey).not.toBe(staleProps?.contextKey);

    act(() => {
      staleProps?.onPendingChange(true);
      staleProps?.onApproved({
        id: staleArtifactId,
        filename: "stale.pdf",
        originalFilename: "Stale-2026-09-20-INV-88.pdf",
        periodStart: null,
        periodEnd: null,
      });
    });
    expect(screen.queryByRole("checkbox", { name: "stale.pdf" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toHaveProperty("value", "");
    expect(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    ).toHaveProperty("disabled", false);

    await user.click(
      screen.getByRole("button", { name: "Begin pending invoice review" }),
    );
    expect(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    ).toHaveProperty("disabled", true);
    const closeButton = screen.getByRole("button", {
      name: "Return to reconciliation queue",
    });
    expect(closeButton).toHaveProperty("disabled", true);
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("invoice-evidence-context")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Clear pending invoice review" }),
    );
    await user.click(closeButton);
    expect(screen.queryByTestId("invoice-evidence-context")).toBeNull();
    expect(screen.getByText("Bank row details")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    expect(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    ).toHaveProperty("disabled", false);
  });

  it("shows a prominent matched-transaction link after create-and-match and when revisited", async () => {
    const user = userEvent.setup();
    mocks.createAndMatchBankTransaction.mockResolvedValue({
      status: "applied",
      revision: "4",
    });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    const createdSubmission =
      mocks.createAndMatchBankTransaction.mock.calls[0][0];
    const createdLink = await screen.findByRole("link", {
      name: "View matched transaction",
    });
    expect(createdLink.getAttribute("href")).toBe(
      `/transactions/${createdSubmission.data.transactionId}`,
    );
    expect(screen.queryByText("Matched Folio transaction")).toBeNull();
    expect(
      screen.queryByRole("group", {
        name: "Invoice and settlement candidates",
      }),
    ).toBeNull();

    cleanup();
    mocks.data = makeRouteData("matched");
    render(<ReconcilePage />);

    expect(
      screen
        .getByRole("link", { name: "View matched transaction" })
        .getAttribute("href"),
    ).toBe("/transactions/33333333-3333-4333-8333-333333333333");
    expect(screen.queryByText("Matched Folio transaction")).toBeNull();
    expect(
      screen.queryByRole("group", {
        name: "Invoice and settlement candidates",
      }),
    ).toBeNull();
  });

  it("groups bank-row actions and opens the generic chooser without writing", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    const actionRows = document.querySelector(".banking-action-rows");
    if (!(actionRows instanceof HTMLElement))
      throw new Error("Bank-row action groups are missing");
    expect(
      within(actionRows)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual([
      "Classify bank row",
      "Create transaction actions",
      "Other reconciliation actions",
    ]);

    const createActions = within(actionRows).getByRole("group", {
      name: "Create transaction actions",
    });
    expect(
      within(createActions).getByRole("button", {
        name: "Create transaction",
      }),
    ).toBeTruthy();
    expect(
      within(createActions).getByRole("button", {
        name: "Create supplier expense",
      }),
    ).toBeTruthy();
    expect(
      within(createActions).getByRole("button", {
        name: "Create processing fee",
      }),
    ).toBeTruthy();

    await user.click(
      within(createActions).getByRole("button", {
        name: "Create transaction",
      }),
    );

    expect(
      screen.getByRole("group", { name: "Create transaction by kind" }),
    ).toBeTruthy();
    expect(selectedRow().reviewState).toBe("unresolved");
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      amountAud: "-35.1200",
      actionName: "Create supplier expense",
      selectedKind: "Supplier expense",
    },
    {
      amountAud: "35.1200",
      actionName: "Create sale",
      selectedKind: "Sale",
    },
  ])(
    "opens the $selectedKind form directly for a matching bank movement",
    async ({ amountAud, actionName, selectedKind }) => {
      const user = userEvent.setup();
      mocks.data = makeRouteData("unresolved", amountAud);
      render(<ReconcilePage />);
      const trigger = screen.getByRole("button", { name: actionName });

      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      await user.click(trigger);

      const drawer = screen.getByRole("dialog", {
        name: "Create transaction",
      });
      expect(
        within(drawer).getByRole("combobox", { name: "Kind" }),
      ).toMatchObject({ value: selectedKind });
      expect(
        within(drawer).queryByRole("group", {
          name: "Create transaction by kind",
        }),
      ).toBeNull();
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
      expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();

      await user.click(
        within(drawer).getByRole("button", {
          name: "Return to reconciliation queue",
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Create transaction" }),
        ).toBeNull(),
      );
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("disables transaction creation actions for an already resolved row", () => {
    mocks.data = makeRouteData("private");
    render(<ReconcilePage />);

    expect(
      screen.getByRole("button", { name: "Create transaction" }),
    ).toMatchObject({ disabled: true });
    expect(
      screen.getByRole("button", { name: "Create supplier expense" }),
    ).toMatchObject({ disabled: true });
    expect(
      screen.queryByRole("dialog", { name: "Create transaction" }),
    ).toBeNull();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
  });

  it("disables transaction creation actions while a reconciliation save is pending", async () => {
    const user = userEvent.setup();
    let finishSave:
      | ((result: { status: "applied"; revision: string }) => void)
      | undefined;
    const savePending = new Promise<{ status: "applied"; revision: string }>(
      (resolve) => {
        finishSave = resolve;
      },
    );
    mocks.reconcileBankTransaction.mockReturnValueOnce(savePending);
    render(<ReconcilePage />);

    await user.click(screen.getByRole("button", { name: "Mark private" }));
    await waitFor(() =>
      expect(mocks.reconcileBankTransaction).toHaveBeenCalledTimes(1),
    );

    const genericCreate = screen.getByRole("button", {
      name: "Create transaction",
    });
    const directCreate = screen.getByRole("button", {
      name: "Create supplier expense",
    });
    expect(genericCreate).toMatchObject({ disabled: true });
    expect(directCreate).toMatchObject({ disabled: true });
    expect(
      screen.queryByRole("dialog", { name: "Create transaction" }),
    ).toBeNull();
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();

    await act(async () => {
      finishSave?.({ status: "applied", revision: "4" });
      await savePending;
    });
  });

  it("offers only inflow create buttons for a positive movement and none for zero", async () => {
    const user = userEvent.setup();
    mocks.data = makeRouteData("unresolved", "35.1200");
    render(<ReconcilePage />);

    const positiveActions = screen.getByRole("group", {
      name: "Create transaction actions",
    });
    expect(
      within(positiveActions).getByRole("button", { name: "Create sale" }),
    ).toBeTruthy();
    expect(
      within(positiveActions).queryByRole("button", {
        name: "Create supplier expense",
      }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    expect(
      screen.getByRole("group", { name: "Create transaction by kind" }),
    ).toBeTruthy();
    expect(createKindButton("sale")).toBeTruthy();
    expect(createKindButton("supplier credit")).toBeTruthy();
    expect(createKindButton("owner contribution")).toBeTruthy();
    expect(createKindButton("owner loan to business")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Create supplier expense" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Create dispute" })).toBeNull();

    cleanup();
    mocks.data = makeRouteData("unresolved", "0.0000");
    render(<ReconcilePage />);
    expect(
      within(
        screen.getByRole("group", { name: "Create transaction actions" }),
      ).getAllByRole("button"),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    expect(
      screen.getByText(/no supported transaction kind to match/i),
    ).toBeTruthy();
    expect(
      screen.queryByRole("group", { name: "Create transaction by kind" }),
    ).toBeNull();
  });

  it("opens the selected positive-movement kind in the transaction form", async () => {
    const user = userEvent.setup();
    mocks.data = makeRouteData("unresolved", "35.1200");
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("sale"));

    expect(screen.getByRole("combobox", { name: "Kind" })).toMatchObject({
      value: "Sale",
    });
    expect(
      screen.getByRole("textbox", { name: "Settlement amount" }),
    ).toMatchObject({ value: "35.1200" });
  });

  it("offers parsed foreign payment hints only after opening transaction creation", async () => {
    const user = userEvent.setup();
    const data = makeRouteData();
    data.detail.bankTransaction.metadata.foreignCurrency = "USD";
    data.detail.bankTransaction.metadata.foreignAmount = "37.08";
    mocks.data = data;
    render(<ReconcilePage />);

    expect(
      screen.queryByRole("button", { name: "Apply currency USD" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));

    expect(
      screen.getByRole("button", { name: "Apply currency USD" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Apply invoice total 37.08" }),
    ).toBeTruthy();
  });

  it("applies a classification directly and undoes it using the returned revision", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    render(<ReconcilePage />);

    await user.click(screen.getByRole("button", { name: "Mark private" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Undo private classification",
      }),
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.reconcileBankTransaction).toHaveBeenNthCalledWith(1, {
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: { type: "classify", classification: "private" },
      },
    });
    expect(mocks.reconcileBankTransaction).toHaveBeenNthCalledWith(2, {
      data: {
        bankTransactionId,
        expectedRevision: "4",
        command: { type: "reset" },
      },
    });
    expect(selectedRow().reviewState).toBe("unresolved");
  });

  it("resets a classified row directly and lets Undo restore its classification", async () => {
    const user = userEvent.setup();
    mocks.data = makeRouteData("transfer");
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Unmatch or reset to unresolved" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Undo reset (restore transfer)",
      }),
    );

    expect(mocks.reconcileBankTransaction).toHaveBeenNthCalledWith(1, {
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: { type: "reset" },
      },
    });
    expect(mocks.reconcileBankTransaction).toHaveBeenNthCalledWith(2, {
      data: {
        bankTransactionId,
        expectedRevision: "4",
        command: { type: "classify", classification: "transfer" },
      },
    });
    expect(selectedRow().reviewState).toBe("transfer");
  });

  it("uses an app-owned confirmation dialog for matched rows", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    mocks.data = makeRouteData("matched");
    render(<ReconcilePage />);

    expect(screen.queryByText("Matched Folio transaction")).toBeNull();
    expect(
      screen.queryByRole("group", {
        name: "Invoice and settlement candidates",
      }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Unmatch or reset to unresolved" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Unmatch bank row" }));

    expect(mocks.reconcileBankTransaction).toHaveBeenCalledWith({
      data: {
        bankTransactionId,
        expectedRevision: "3",
        command: { type: "reset" },
      },
    });
    expect(selectedRow().reviewState).toBe("unresolved");
    expect(
      await screen.findByRole("group", {
        name: "Invoice and settlement candidates",
      }),
    ).toBeTruthy();
  });

  it("drops a stale Undo after a revision conflict and refreshes the row", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(screen.getByRole("button", { name: "Mark private" }));
    mocks.reconcileBankTransaction.mockRejectedValueOnce(
      new Error("The row changed since it was loaded. Code REVISION_CONFLICT."),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Undo private classification",
      }),
    );

    expect(mocks.reconcileBankTransaction).toHaveBeenNthCalledWith(2, {
      data: {
        bankTransactionId,
        expectedRevision: "4",
        command: { type: "reset" },
      },
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "REVISION_CONFLICT",
    );
    expect(
      screen.queryByRole("button", { name: "Undo private classification" }),
    ).toBeNull();
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  });
});

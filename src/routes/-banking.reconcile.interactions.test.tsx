// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  invalidate: vi.fn(),
  reconcileBankTransaction: vi.fn(),
  getNextBankReconciliation: vi.fn(),
  createAndMatchBankTransaction: vi.fn(),
  startArtifactUpload: vi.fn(),
  confirmArtifactUpload: vi.fn(),
  extractInvoiceFields: vi.fn(),
  loadDraft: vi.fn(),
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
  getBankReconciliation: vi.fn(),
  getNextBankReconciliation: mocks.getNextBankReconciliation,
  reconcileBankTransaction: mocks.reconcileBankTransaction,
}));

vi.mock("../server/operations", () => ({
  startArtifactUpload: mocks.startArtifactUpload,
  confirmArtifactUpload: mocks.confirmArtifactUpload,
}));

vi.mock("../server/invoice-operations", () => ({
  extractInvoiceFields: mocks.extractInvoiceFields,
}));

vi.mock("./-transaction-workflow", () => ({
  loadManualTransactionRouteData: mocks.loadDraft,
  ManualTransactionRoute: () => <div>Draft transaction editor</div>,
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
const selectedRow = () => (mocks.data as TestRouteData).detail.bankTransaction;
const createKindButton = (kind: string) =>
  screen.getByRole("button", { name: `Create ${kind}` });
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
  mocks.data = makeRouteData();
  mocks.search = { bank: bankTransactionId, window: "14", page: 1 };
  mocks.navigate.mockReset();
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.reconcileBankTransaction
    .mockReset()
    .mockImplementation(applyMockReconciliation);
  mocks.getNextBankReconciliation.mockReset().mockResolvedValue({
    status: "none",
  });
  mocks.createAndMatchBankTransaction.mockReset();
  mocks.startArtifactUpload.mockReset();
  mocks.confirmArtifactUpload.mockReset();
  mocks.extractInvoiceFields.mockReset();
  mocks.loadDraft.mockReset();
});

afterEach(() => {
  cleanup();
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
          screen.getByRole("button", { name: "Save, match and next" }),
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
        screen.getByRole("button", { name: "Save, match and next" }),
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
      screen.getByRole("button", { name: "Save, match and next" }),
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
      "2026-09-24",
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
    expect(screen.getByText("Unverified payment hints")).toBeTruthy();
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

  it("confirms a new invoice PDF once and reuses it with the same transaction ID on retry", async () => {
    const user = userEvent.setup();
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const uploadUrl = "https://storage.example.test/upload";
    const digest = new Uint8Array(32).buffer;
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(digest);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    mocks.startArtifactUpload.mockResolvedValue({
      artifact: { id: artifactId },
      uploadUrl,
    });
    mocks.confirmArtifactUpload.mockResolvedValue({ id: artifactId });
    mocks.createAndMatchBankTransaction
      .mockRejectedValueOnce(new Error("The match request was interrupted."))
      .mockResolvedValueOnce({ status: "applied", revision: "4" });
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.upload(
      screen.getByLabelText("PDF evidence"),
      new File(["%PDF-1.7"], "invoice.pdf", { type: "application/pdf" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    const alert = await screen.findByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(screen.getByText(/preserved and will be reused/i)).toBeTruthy();
    expect(mocks.startArtifactUpload).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: actorId,
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "invoice.pdf",
        mediaType: "application/pdf",
      }),
    });
    expect(mocks.confirmArtifactUpload).toHaveBeenCalledWith({
      data: { id: artifactId },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      uploadUrl,
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "x-amz-meta-folio-artifact-id": artifactId,
        }),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    expect(mocks.startArtifactUpload).toHaveBeenCalledTimes(1);
    expect(mocks.confirmArtifactUpload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(2);
    const firstSubmission =
      mocks.createAndMatchBankTransaction.mock.calls[0][0];
    const retrySubmission =
      mocks.createAndMatchBankTransaction.mock.calls[1][0];
    expect(retrySubmission.data.transactionId).toBe(
      firstSubmission.data.transactionId,
    );
    expect(retrySubmission.data.artifactIds).toContain(artifactId);
    expect(retrySubmission.data.transaction.sourceArtifactId).toBe(artifactId);
  });

  it("confirms a new PDF for explicit extraction, then reuses it on create and match", async () => {
    const user = userEvent.setup();
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const uploadUrl = "https://storage.example.test/upload";
    const digest = new Uint8Array(32).buffer;
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(digest);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    mocks.startArtifactUpload.mockResolvedValue({
      artifact: { id: artifactId },
      uploadUrl,
    });
    mocks.confirmArtifactUpload.mockResolvedValue({ id: artifactId });
    mocks.extractInvoiceFields.mockResolvedValue({
      status: "unsupported",
      artifactId,
      checksumSha256: "synthetic-checksum",
      versionId: "synthetic-version",
      reason: "page_limit",
    });
    mocks.createAndMatchBankTransaction.mockResolvedValue({
      status: "applied",
      revision: "4",
    });
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(createKindButton("supplier expense"));
    await user.upload(
      screen.getByLabelText("PDF evidence"),
      new File(["%PDF-1.7"], "invoice.pdf", { type: "application/pdf" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Upload and extract invoice fields" }),
    );

    await screen.findByText(/This PDF could not be safely extracted/);
    expect(mocks.startArtifactUpload).toHaveBeenCalledTimes(1);
    expect(mocks.confirmArtifactUpload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.extractInvoiceFields).toHaveBeenCalledWith({
      data: { artifactId },
    });
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
    expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Save changes (recorded)" }),
    );

    await waitFor(() =>
      expect(mocks.createAndMatchBankTransaction).toHaveBeenCalledTimes(1),
    );
    expect(mocks.startArtifactUpload).toHaveBeenCalledTimes(1);
    expect(mocks.confirmArtifactUpload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      mocks.createAndMatchBankTransaction.mock.calls[0]?.[0].data.artifactIds,
    ).toContain(artifactId);
    expect(
      mocks.createAndMatchBankTransaction.mock.calls[0]?.[0].data.transaction
        .sourceArtifactId,
    ).toBe(artifactId);
  });

  it.each(["navigation", "selected PDF"] as const)(
    "stops new-PDF preparation before confirmation when %s changes",
    async (changedSource) => {
      const user = userEvent.setup();
      let finishStartUpload!: (result: {
        artifact: { id: string };
        uploadUrl: string;
      }) => void;
      mocks.startArtifactUpload.mockReturnValueOnce(
        new Promise((resolve) => {
          finishStartUpload = resolve;
        }),
      );
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
        new Uint8Array(32).buffer,
      );
      Object.defineProperty(File.prototype, "arrayBuffer", {
        configurable: true,
        value: async () => new Uint8Array([1, 2, 3]).buffer,
      });
      const view = render(<ReconcilePage />);

      await user.click(
        screen.getByRole("button", { name: "Create transaction" }),
      );
      await user.click(createKindButton("supplier expense"));
      await user.upload(
        screen.getByLabelText("PDF evidence"),
        new File(["%PDF-1.7"], "invoice.pdf", { type: "application/pdf" }),
      );
      await user.click(
        screen.getByRole("button", {
          name: "Upload and extract invoice fields",
        }),
      );
      await waitFor(() =>
        expect(mocks.startArtifactUpload).toHaveBeenCalledTimes(1),
      );

      if (changedSource === "navigation") {
        mocks.search = {
          bank: "77777777-7777-4777-8777-777777777777",
          window: "14",
          page: 1,
        };
        view.rerender(<ReconcilePage />);
      } else {
        await user.upload(
          screen.getByLabelText("PDF evidence"),
          new File(["%PDF-1.7"], "replacement.pdf", {
            type: "application/pdf",
          }),
        );
      }
      finishStartUpload({
        artifact: { id: "44444444-4444-4444-8444-444444444444" },
        uploadUrl: "https://storage.example.test/upload",
      });

      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: "Upload and extract invoice fields",
          }),
        ).toHaveProperty("disabled", false),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.confirmArtifactUpload).not.toHaveBeenCalled();
      expect(mocks.extractInvoiceFields).not.toHaveBeenCalled();
      expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
      expect(mocks.reconcileBankTransaction).not.toHaveBeenCalled();
      expect(mocks.invalidate).not.toHaveBeenCalled();
    },
  );

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

    cleanup();
    mocks.data = makeRouteData("matched");
    render(<ReconcilePage />);

    expect(
      screen
        .getByRole("link", { name: "View matched transaction" })
        .getAttribute("href"),
    ).toBe("/transactions/33333333-3333-4333-8333-333333333333");
  });

  it("offers only inflow create buttons for a positive movement and none for zero", async () => {
    const user = userEvent.setup();
    mocks.data = makeRouteData("unresolved", "35.1200");
    render(<ReconcilePage />);

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

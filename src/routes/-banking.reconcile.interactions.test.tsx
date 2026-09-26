// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  invalidate: vi.fn(),
  reconcileBankTransaction: vi.fn(),
  createAndMatchBankTransaction: vi.fn(),
  startArtifactUpload: vi.fn(),
  confirmArtifactUpload: vi.fn(),
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
  reconcileBankTransaction: mocks.reconcileBankTransaction,
}));

vi.mock("../server/operations", () => ({
  startArtifactUpload: mocks.startArtifactUpload,
  confirmArtifactUpload: mocks.confirmArtifactUpload,
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
  mocks.createAndMatchBankTransaction.mockReset();
  mocks.startArtifactUpload.mockReset();
  mocks.confirmArtifactUpload.mockReset();
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
  it("shows a bank-linked draft for review without recording or matching it", () => {
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
    expect(
      screen.getByRole("link", { name: "Review draft" }).getAttribute("href"),
    ).toBe(
      `/transactions/55555555-5555-4555-8555-555555555555/edit?bank=${bankTransactionId}`,
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
      value: actorId,
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
    ).toMatchObject({ value: "no_tax", disabled: true });
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
    expect(nestedKind).toMatchObject({ value: "supplier_expense" });
    expect(screen.getByRole("option", { name: "Processing fee" })).toBeTruthy();

    await user.selectOptions(nestedKind, "processing_fee");
    expect(nestedKind).toMatchObject({ value: "processing_fee" });
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
    expect(treatment).toMatchObject({ value: "gst_included" });

    await user.clear(currency);
    await user.type(currency, "USD");
    expect(treatment).toMatchObject({ value: "foreign_tax_included" });
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
      value: "sale",
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

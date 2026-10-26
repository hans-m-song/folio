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
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const artifactId = "44444444-4444-4444-8444-444444444444";
const actorId = "11111111-1111-4111-8111-111111111111";
const bankTransactionId = "22222222-2222-4222-8222-222222222222";

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
  getArtifactDetails: vi.fn(),
  approveArtifact: vi.fn(),
  previewArtifactForReview: vi.fn(),
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
  approveArtifact: mocks.approveArtifact,
  confirmArtifactUpload: mocks.confirmArtifactUpload,
  getArtifactDetails: mocks.getArtifactDetails,
  previewArtifactForReview: mocks.previewArtifactForReview,
  startArtifactUpload: mocks.startArtifactUpload,
}));

vi.mock("./-transaction-workflow", () => ({
  loadManualTransactionRouteData: mocks.loadDraft,
  ManualTransactionRoute: () => <div>Draft transaction editor</div>,
}));

import { Route } from "./banking.reconcile";

const ReconcilePage = (Route as unknown as { component: ComponentType })
  .component;

class FakeXmlHttpRequest {
  static requests: FakeXmlHttpRequest[] = [];

  readonly upload: {
    onprogress: ((event: ProgressEvent<EventTarget>) => unknown) | null;
  } = { onprogress: null };
  readonly headers = new Map<string, string>();
  method = "";
  url = "";
  status = 0;
  body: XMLHttpRequestBodyInit | Document | null = null;
  onload:
    | ((this: XMLHttpRequest, event: ProgressEvent<EventTarget>) => unknown)
    | null = null;
  onerror:
    | ((this: XMLHttpRequest, event: ProgressEvent<EventTarget>) => unknown)
    | null = null;
  onabort:
    | ((this: XMLHttpRequest, event: ProgressEvent<EventTarget>) => unknown)
    | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: XMLHttpRequestBodyInit | Document | null) {
    this.body = body;
    FakeXmlHttpRequest.requests.push(this);
  }

  finish(status: number) {
    this.status = status;
    this.onload?.call(
      this as unknown as XMLHttpRequest,
      new ProgressEvent("load"),
    );
  }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const artifactDetails = (state: "awaiting_review" | "available") => ({
  id: artifactId,
  artifactProfile: "manual_invoice_pdf_v1",
  filename: "reviewed-invoice.pdf",
  originalFilename: "Supplier-2026-09-24-INV-42.pdf",
  mediaType: "application/pdf",
  state,
  byteSize: "256",
  checksumSha256: "synthetic-checksum",
  confirmedAt: "2026-09-24T01:00:00.000Z",
  periodStart: "2026-09-01",
  periodEnd: null,
  supplier: "Reviewed supplier",
  documentDate: "2026-09-24",
  reference: "INV-42",
  notes: "Synthetic upload metadata",
  createdAt: "2026-09-24T00:59:00.000Z",
  linkedTransactionIds: [],
  bankRowCount: 0,
});

const makeRouteData = () => {
  const bankTransaction = {
    id: bankTransactionId,
    postedDate: "2026-09-24",
    amountAud: "-35.1200",
    description: "PAYMENT TO EXAMPLE",
    metadata: {
      counterpartySuggestion: "Example Supplier",
      runningBalance: null,
      valueDate: null,
      cardSuffix: null,
      foreignCurrency: null,
      foreignAmount: null,
    },
    reviewState: "unresolved",
    revision: "3",
    updatedAt: "2026-09-24T00:00:00.000Z",
    updatedById: actorId,
    matchedTransactionId: null,
  };

  return {
    actorId,
    gstRegistered: true,
    counts: {
      total: 1,
      reviewed: 0,
      unresolved: 1,
      matched: 0,
      private: 0,
      transfer: 0,
      duplicate: 0,
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

let currentArtifactState: "awaiting_review" | "available" = "awaiting_review";
const originalBlobArrayBuffer = Object.getOwnPropertyDescriptor(
  Blob.prototype,
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
  mocks.reconcileBankTransaction.mockReset();
  mocks.getNextBankReconciliation.mockReset().mockResolvedValue({
    status: "none",
  });
  mocks.createAndMatchBankTransaction.mockReset();
  mocks.startArtifactUpload.mockReset().mockResolvedValue({
    artifact: { id: artifactId },
    uploadUrl: "https://upload.example.test/file",
    uploadHeaders: {
      "Content-Type": "application/pdf",
      "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "x-amz-meta-folio-artifact-id": artifactId,
      "If-None-Match": "*",
    },
  });
  mocks.confirmArtifactUpload.mockReset().mockResolvedValue({
    id: artifactId,
    state: "awaiting_review",
  });
  currentArtifactState = "awaiting_review";
  mocks.getArtifactDetails
    .mockReset()
    .mockImplementation(async () => artifactDetails(currentArtifactState));
  mocks.approveArtifact.mockReset();
  mocks.previewArtifactForReview
    .mockReset()
    .mockResolvedValue("https://preview.example.test/invoice.pdf");
  mocks.loadDraft.mockReset();
  FakeXmlHttpRequest.requests = [];

  vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => "synthetic-uuid"),
    subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
  });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:synthetic-pdf"),
    revokeObjectURL: vi.fn(),
  });
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new TextEncoder().encode("%PDF-1.7\nsynthetic").buffer,
  });
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
  if (originalBlobArrayBuffer)
    Object.defineProperty(
      Blob.prototype,
      "arrayBuffer",
      originalBlobArrayBuffer,
    );
  else Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
  vi.unstubAllGlobals();
});

describe("bank-led invoice upload interactions", () => {
  it("keeps parent transaction fields while upload and approval stay in the child drawer", async () => {
    const user = userEvent.setup();
    render(<ReconcilePage />);

    await user.click(
      screen.getByRole("button", { name: "Create transaction" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create supplier expense" }),
    );

    const description = screen.getByRole("textbox", { name: "Description" });
    await user.clear(description);
    await user.type(description, "Keep this parent edit");
    const evidence = screen.getByRole("region", {
      name: "Invoice PDF evidence",
    });
    const openUploadButton = screen.getByRole("button", { name: "Upload PDF" });
    const saveButton = screen.getByRole("button", {
      name: "Save changes (recorded)",
    });
    const closeButton = screen.getByRole("button", {
      name: "Return to reconciliation queue",
    });
    await user.click(openUploadButton);
    let uploadDialog = screen.getByRole("dialog", {
      name: "Upload and review PDF",
    });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Upload and review PDF" }),
      ).toBeNull(),
    );
    expect(evidence.isConnected).toBe(true);
    expect(description).toHaveProperty("value", "Keep this parent edit");
    await user.click(openUploadButton);
    uploadDialog = screen.getByRole("dialog", {
      name: "Upload and review PDF",
    });
    const emptyOverlay = document.querySelector(".bank-invoice-upload-overlay");
    if (!emptyOverlay) throw new Error("Upload drawer overlay is missing");
    await user.click(emptyOverlay);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Upload and review PDF" }),
      ).toBeNull(),
    );
    expect(document.querySelector(".banking-create-overlay")).toBeTruthy();
    await user.click(openUploadButton);
    uploadDialog = screen.getByRole("dialog", {
      name: "Upload and review PDF",
    });
    const uploader = within(uploadDialog);

    const file = new File(
      ["%PDF-1.7\nsynthetic"],
      "Supplier-2026-09-24-INV-42.pdf",
      { type: "application/pdf" },
    );
    fireEvent.change(uploader.getByLabelText("File"), {
      target: { files: [file] },
    });
    await screen.findByTitle("PDF preview: Supplier-2026-09-24-INV-42.pdf");

    expect(uploader.queryByLabelText("Coverage start")).toBeNull();
    expect(uploader.queryByLabelText("Coverage end")).toBeNull();

    const filename = uploader.getByRole("textbox", { name: "Filename" });
    const uploadButton = uploader.getByRole("button", { name: "Upload file" });

    expect({
      evidenceBusy: evidence.getAttribute("aria-busy"),
      filenameDisabled: filename.matches(":disabled"),
      uploadDisabled: uploadButton.matches(":disabled"),
      saveDisabled: (saveButton as HTMLButtonElement).disabled,
      closeDisabled: (closeButton as HTMLButtonElement).disabled,
    }).toEqual({
      evidenceBusy: "false",
      filenameDisabled: false,
      uploadDisabled: false,
      saveDisabled: true,
      closeDisabled: true,
    });

    const selectedOverlay = document.querySelector(
      ".bank-invoice-upload-overlay",
    );
    if (!selectedOverlay) throw new Error("Upload drawer overlay is missing");
    await user.click(selectedOverlay);
    const discardDialog = screen.getByRole("alertdialog", {
      name: "Discard the selected PDF?",
    });
    expect(uploadDialog.isConnected).toBe(true);
    await user.click(
      within(discardDialog).getByRole("button", { name: "Keep reviewing" }),
    );

    await user.clear(filename);
    await user.type(filename, "reviewed-invoice.pdf");
    fireEvent.change(uploader.getByLabelText("Document date"), {
      target: { value: "2026-09-24" },
    });
    await user.type(
      uploader.getByRole("textbox", { name: "Reference" }),
      "INV-42",
    );
    await user.type(
      uploader.getByRole("textbox", { name: "Supplier" }),
      "Reviewed supplier",
    );

    await user.click(uploadButton);
    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    expect(mocks.startArtifactUpload).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "reviewed-invoice.pdf",
        originalFilename: "Supplier-2026-09-24-INV-42.pdf",
        documentDate: "2026-09-24",
        reference: "INV-42",
        supplier: "Reviewed supplier",
      }),
    });
    const uploadMetadata = mocks.startArtifactUpload.mock.calls[0]?.[0]
      .data as Record<string, unknown>;
    expect(uploadMetadata).not.toHaveProperty("periodStart");
    expect(uploadMetadata).not.toHaveProperty("periodEnd");
    expect(
      (uploader.getByRole("textbox", { name: "Filename" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect((closeButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      (uploader.getByRole("button", { name: "Close" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const transferOverlay = document.querySelector(
      ".bank-invoice-upload-overlay",
    );
    if (!transferOverlay) throw new Error("Upload drawer overlay is missing");
    await user.click(transferOverlay);
    expect(uploadDialog.isConnected).toBe(true);
    expect(document.querySelector(".banking-create-overlay")).toBeTruthy();

    await act(async () => FakeXmlHttpRequest.requests[0]?.finish(200));
    await waitFor(() =>
      expect(mocks.confirmArtifactUpload).toHaveBeenCalledWith({
        data: { id: artifactId },
      }),
    );
    await waitFor(() =>
      expect(uploader.queryByRole("textbox", { name: "Filename" })).toBeNull(),
    );

    const approveButton = await screen.findByRole("button", {
      name: "Approve and return",
    });
    const dismissButton = screen.getByRole("button", {
      name: "Dismiss PDF from this transaction",
    });
    expect((approveButton as HTMLButtonElement).disabled).toBe(false);
    expect((dismissButton as HTMLButtonElement).disabled).toBe(false);
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect((closeButton as HTMLButtonElement).disabled).toBe(true);

    const approval = deferred<{
      id: string;
      artifactProfile: string;
      mediaType: string;
      state: string;
    }>();
    mocks.approveArtifact.mockReturnValueOnce(approval.promise);
    await user.click(approveButton);
    const approvingButton = await screen.findByRole("button", {
      name: "Approving PDF…",
    });
    expect((approvingButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Dismiss PDF from this transaction",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Close" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect((closeButton as HTMLButtonElement).disabled).toBe(true);

    const approvalOverlay = document.querySelector(
      ".bank-invoice-upload-overlay",
    );
    if (!approvalOverlay) throw new Error("Upload drawer overlay is missing");
    await user.click(approvalOverlay);
    expect(uploadDialog.isConnected).toBe(true);
    expect(document.querySelector(".banking-create-overlay")).toBeTruthy();

    currentArtifactState = "available";
    await act(async () =>
      approval.resolve({
        id: artifactId,
        artifactProfile: "manual_invoice_pdf_v1",
        mediaType: "application/pdf",
        state: "available",
      }),
    );

    expect(
      await screen.findByText(
        "Approved invoice PDF selected for this transaction.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Upload and review PDF" }),
    ).toBeNull();
    const approvedArtifact = await screen.findByRole("checkbox", {
      name: "reviewed-invoice.pdf",
    });
    expect(approvedArtifact).toHaveProperty("checked", true);
    expect(description).toHaveProperty("value", "Keep this parent edit");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-counterparty")
        ?.value,
    ).toBe("");
    const supplierField = document.querySelector<HTMLInputElement>(
      "#transaction-counterparty",
    );
    if (!supplierField)
      throw new Error("Transaction supplier field is missing");
    await user.click(
      await screen.findByRole("button", {
        name: "Apply supplier Reviewed supplier",
      }),
    );
    expect(supplierField.value).toBe("Reviewed supplier");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-invoice-date")
        ?.value,
    ).toBe("");
    expect(
      document.querySelector<HTMLInputElement>("#transaction-reference")?.value,
    ).toBe("");
    await waitFor(() => {
      expect((saveButton as HTMLButtonElement).disabled).toBe(false);
      expect((closeButton as HTMLButtonElement).disabled).toBe(false);
    });
    expect(mocks.createAndMatchBankTransaction).not.toHaveBeenCalled();
  });
});

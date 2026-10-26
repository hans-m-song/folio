// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  approveArtifact: vi.fn(),
  getArtifactDetails: vi.fn(),
}));
vi.mock("../server/operations", () => operations);

vi.mock("../routes/-file-upload", async () => {
  const React = await import("react");
  const createFile = (contents: string, name: string, type = "") => {
    const file = new File([contents], name, { type });
    Object.defineProperty(file, "slice", {
      value: () => ({
        arrayBuffer: async () =>
          new TextEncoder().encode(contents).buffer as ArrayBuffer,
      }),
    });
    return file;
  };
  return {
    hasPdfHeader: (bytes: Uint8Array) =>
      new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-",
    FileUploadPage: ({
      onFileChange,
      navigateToArtifact,
      onBusyChange,
    }: {
      onFileChange?: (file: File | null) => void;
      navigateToArtifact?: (artifactId: string) => void;
      onBusyChange?: (busy: boolean) => void;
    }) => {
      const [complete, setComplete] = React.useState(false);
      return React.createElement(
        "div",
        { "data-testid": "upload-harness" },
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              onFileChange?.(
                createFile("%PDF-1.7\nsynthetic", "fixture.pdf", "text/html"),
              ),
          },
          "Choose PDF",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              onFileChange?.(createFile("not a PDF", "invalid.pdf")),
          },
          "Choose invalid file",
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => onFileChange?.(null) },
          "Clear selected file",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => onBusyChange?.(true),
          },
          "Begin upload transfer",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => onBusyChange?.(false),
          },
          "Finish upload transfer",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              setComplete(true);
              navigateToArtifact?.("11111111-1111-4111-8111-111111111111");
            },
          },
          "Confirm uploaded PDF",
        ),
        complete && React.createElement("p", null, "Uploader completed"),
      );
    },
  };
});

vi.mock("./transaction-pdf-preview", async () => {
  const React = await import("react");
  return {
    TransactionPdfPreview: ({
      artifactId,
      filename,
    }: {
      artifactId: string;
      filename: string;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "artifact-preview", "data-artifact-id": artifactId },
        filename,
      ),
  };
});

import { BankInvoiceEvidence } from "./bank-invoice-evidence";
import type { BankInvoiceArtifactDetails } from "./bank-invoice-evidence";

const invoiceDetails = (
  id: string,
  state: "awaiting_review" | "available" = "awaiting_review",
): BankInvoiceArtifactDetails => ({
  id,
  artifactProfile: "manual_invoice_pdf_v1",
  filename: "invoice.pdf",
  originalFilename: "Supplier-2026-10-18-INV-42.pdf",
  mediaType: "application/pdf",
  state,
  byteSize: "256",
  checksumSha256: "synthetic-checksum",
  confirmedAt: "2026-10-18T01:00:00.000Z",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  supplier: "Reviewed supplier",
  documentDate: "2026-10-18",
  reference: "INV-42",
  notes: "Synthetic metadata",
  createdAt: "2026-10-18T00:59:00.000Z",
  linkedTransactionIds: [],
  bankRowCount: 0,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const renderEvidence = (
  props: Pick<
    ComponentProps<typeof BankInvoiceEvidence>,
    "selectedArtifact"
  > = {},
) => {
  const onApproved = vi.fn<(artifact: BankInvoiceArtifactDetails) => void>();
  const onPendingChange = vi.fn<(pending: boolean) => void>();
  const rendered = render(
    <BankInvoiceEvidence
      actorId="synthetic-actor"
      contextKey="bank-row-one:revision-one"
      onApproved={onApproved}
      onPendingChange={onPendingChange}
      selectedArtifact={props.selectedArtifact}
    />,
  );
  return { ...rendered, onApproved, onPendingChange };
};

const openUpload = () =>
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));

beforeEach(() => {
  operations.approveArtifact.mockReset();
  operations.getArtifactDetails.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("bank invoice evidence", () => {
  it("keeps uploader filename actions separate from transaction fields", async () => {
    const { onPendingChange } = renderEvidence();

    openUpload();
    expect(
      await screen.findByRole("dialog", { name: "Upload and review PDF" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }));
    await screen.findByTitle("PDF preview: fixture.pdf");
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(
      screen.queryByRole("button", { name: /apply .* to transaction/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /apply .* filename suggestions/i }),
    ).toBeNull();
    expect(operations.approveArtifact).not.toHaveBeenCalled();
  });

  it("previews only header-checked PDFs as sanitized PDF blobs and revokes them", async () => {
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe("application/pdf");
      return "blob:synthetic-pdf";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const { onPendingChange } = renderEvidence();

    openUpload();
    fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }));
    const frame = await screen.findByTitle("PDF preview: fixture.pdf");
    expect(frame.getAttribute("src")).toBe("blob:synthetic-pdf#view=FitH");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({
      type: "application/pdf",
    });
    expect(onPendingChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Choose invalid file" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "does not have a PDF header",
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-pdf");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear selected file" }),
    );
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("waits for explicit approval and refreshes full metadata before selecting", async () => {
    const uploaded = invoiceDetails("11111111-1111-4111-8111-111111111111");
    const approved = invoiceDetails(uploaded.id, "available");
    operations.getArtifactDetails
      .mockResolvedValue(approved)
      .mockResolvedValueOnce(uploaded)
      .mockResolvedValueOnce(approved);
    operations.approveArtifact.mockResolvedValue(approved);
    const evidence = renderEvidence();
    const { onApproved, onPendingChange } = evidence;

    openUpload();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm uploaded PDF" }),
    );
    await screen.findByRole("button", { name: "Approve and return" });
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(screen.getByText("2026-10-01 to 2026-10-31")).toBeTruthy();
    expect(screen.getByText("Reviewed supplier")).toBeTruthy();
    expect(screen.getByText("Synthetic metadata")).toBeTruthy();
    expect(screen.queryByText("Uploader completed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve and return" }));
    await waitFor(() => expect(onApproved).toHaveBeenCalledOnce());
    expect(operations.approveArtifact).toHaveBeenCalledWith({
      data: { id: uploaded.id },
    });
    expect(operations.getArtifactDetails).toHaveBeenCalledTimes(2);
    expect(onApproved).toHaveBeenCalledWith(approved);
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByRole("dialog", { name: "Upload and review PDF" }),
    ).toBeNull();

    evidence.rerender(
      <BankInvoiceEvidence
        actorId="synthetic-actor"
        contextKey="bank-row-one:revision-one"
        selectedArtifact={{ id: uploaded.id, filename: approved.filename }}
        onApproved={onApproved}
        onPendingChange={onPendingChange}
      />,
    );
    await screen.findByTestId("artifact-preview");
    expect(screen.getByTestId("artifact-preview").dataset.artifactId).toBe(
      uploaded.id,
    );

    openUpload();
    fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }));
    await screen.findByTitle("PDF preview: fixture.pdf");
    expect(
      screen.queryByText("This invoice PDF is approved and ready for use."),
    ).toBeNull();
  });

  it("ignores a confirmed-upload detail response after the bank context changes", async () => {
    const detailsRequest = deferred<BankInvoiceArtifactDetails | null>();
    operations.getArtifactDetails.mockReturnValue(detailsRequest.promise);
    const { onApproved, onPendingChange, rerender } = renderEvidence();
    openUpload();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm uploaded PDF" }),
    );
    await waitFor(() =>
      expect(operations.getArtifactDetails).toHaveBeenCalledOnce(),
    );
    const pendingCallsBeforeNavigation = onPendingChange.mock.calls.length;

    rerender(
      <BankInvoiceEvidence
        actorId="synthetic-actor"
        contextKey="bank-row-two:revision-one"
        onApproved={onApproved}
        onPendingChange={onPendingChange}
      />,
    );
    await act(async () => {
      detailsRequest.resolve(
        invoiceDetails("11111111-1111-4111-8111-111111111111"),
      );
    });

    expect(onApproved).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenCalledTimes(pendingCallsBeforeNavigation);
    expect(
      screen.queryByRole("button", { name: "Approve and return" }),
    ).toBeNull();
  });

  it("ignores an approval response after the bank context changes", async () => {
    const uploaded = invoiceDetails("11111111-1111-4111-8111-111111111111");
    const approvalRequest = deferred<BankInvoiceArtifactDetails>();
    operations.getArtifactDetails.mockResolvedValueOnce(uploaded);
    operations.approveArtifact.mockReturnValue(approvalRequest.promise);
    const { onApproved, onPendingChange, rerender } = renderEvidence();
    openUpload();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm uploaded PDF" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approve and return" }),
    );
    await waitFor(() =>
      expect(operations.approveArtifact).toHaveBeenCalledOnce(),
    );
    const pendingCallsBeforeNavigation = onPendingChange.mock.calls.length;

    rerender(
      <BankInvoiceEvidence
        actorId="synthetic-actor"
        contextKey="bank-row-two:revision-one"
        onApproved={onApproved}
        onPendingChange={onPendingChange}
      />,
    );
    await act(async () => {
      approvalRequest.resolve(invoiceDetails(uploaded.id, "available"));
    });

    expect(operations.getArtifactDetails).toHaveBeenCalledOnce();
    expect(onApproved).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenCalledTimes(pendingCallsBeforeNavigation);
  });

  it("shows one approved preview as the selected library artifact changes", async () => {
    const first = invoiceDetails(
      "11111111-1111-4111-8111-111111111111",
      "available",
    );
    const second = invoiceDetails(
      "22222222-2222-4222-8222-222222222222",
      "available",
    );
    operations.getArtifactDetails.mockImplementation(
      ({ data }: { data: { id: string } }) =>
        Promise.resolve(data.id === first.id ? first : second),
    );
    const evidence = renderEvidence({ selectedArtifact: { id: first.id } });
    await screen.findByTestId("artifact-preview");
    expect(screen.getAllByTestId("artifact-preview")).toHaveLength(1);

    evidence.rerender(
      <BankInvoiceEvidence
        actorId="synthetic-actor"
        contextKey="bank-row-one:revision-one"
        selectedArtifact={{ id: second.id }}
        onApproved={evidence.onApproved}
        onPendingChange={evidence.onPendingChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("artifact-preview").dataset.artifactId).toBe(
        second.id,
      ),
    );
    expect(screen.getAllByTestId("artifact-preview")).toHaveLength(1);
  });

  it("keeps preview height fixed at half page without size controls", async () => {
    const artifact = invoiceDetails(
      "11111111-1111-4111-8111-111111111111",
      "available",
    );
    operations.getArtifactDetails.mockResolvedValue(artifact);
    const { onApproved } = renderEvidence({
      selectedArtifact: { id: artifact.id },
    });
    await screen.findByTestId("artifact-preview");

    const evidence = screen.getByRole("region", {
      name: "Invoice PDF evidence",
    });
    expect(evidence.getAttribute("data-preview-size")).toBe("half");
    expect(screen.queryByRole("button", { name: "One page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Half page" })).toBeNull();

    openUpload();
    fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }));
    await screen.findByTitle("PDF preview: fixture.pdf");

    expect(evidence.getAttribute("data-preview-size")).toBe("half");
    expect(screen.queryByRole("button", { name: "One page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Half page" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear selected file" }),
    );
    expect(evidence.getAttribute("data-preview-size")).toBe("half");
    expect(screen.getByTestId("artifact-preview").dataset.artifactId).toBe(
      artifact.id,
    );
    expect(operations.approveArtifact).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });
});

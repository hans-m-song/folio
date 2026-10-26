// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const operations = vi.hoisted(() => ({
  confirmArtifactUpload: vi.fn(),
  startArtifactUpload: vi.fn(),
}));

vi.mock("../server/operations", () => operations);

import {
  FileUploadPage,
  fileUploadFilenameIssue,
  fileUploadPeriodIssue,
  fileUploadProfiles,
  hasPdfHeader,
} from "./-file-upload";

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

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent<EventTarget>);
  }

  finish(status: number) {
    this.status = status;
    this.onload?.call(
      this as unknown as XMLHttpRequest,
      new ProgressEvent("load"),
    );
  }
}

const authenticatedSession = {
  authenticated: true as const,
  user: { id: "actor" },
};

const originalFileArrayBuffer = Object.getOwnPropertyDescriptor(
  File.prototype,
  "arrayBuffer",
);

beforeEach(() => {
  vi.resetAllMocks();
  FakeXmlHttpRequest.requests = [];
  operations.startArtifactUpload.mockResolvedValue({
    artifact: { id: "artifact-id" },
    uploadUrl: "https://upload.example.test/file",
    uploadHeaders: {
      "Content-Type": "text/csv",
      "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "x-amz-meta-folio-artifact-id": "artifact-id",
      "If-None-Match": "*",
    },
  });
  operations.confirmArtifactUpload.mockResolvedValue({
    id: "artifact-id",
    state: "awaiting_review",
  });
  vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
  vi.stubGlobal("crypto", {
    subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
  });
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: async function (this: File) {
      return new TextEncoder().encode(
        this.name.toLowerCase().endsWith(".pdf")
          ? "%PDF-1.7\nsynthetic"
          : "Date,Amount\n2026-01-01,10.00\n",
      ).buffer;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalFileArrayBuffer)
    Object.defineProperty(
      File.prototype,
      "arrayBuffer",
      originalFileArrayBuffer,
    );
  else delete (File.prototype as Partial<File>).arrayBuffer;
});

describe("single-file upload validation", () => {
  it("offers only supported upload profiles", () => {
    expect(fileUploadProfiles.map(({ profile }) => profile)).toEqual([
      "manual_invoice_pdf_v1",
      "stripe_balance_itemised_csv_v1",
      "commbank_transaction_history_csv_v1",
    ]);

    render(<FileUploadPage session={authenticatedSession} />);
    expect(screen.getByText(/Keep the \.pdf extension\./)).toBeTruthy();
    expect(
      (screen.getByLabelText("File") as HTMLInputElement).accept,
    ).toContain(".csv");
    fireEvent.change(screen.getByLabelText("File profile"), {
      target: { value: "stripe_balance_itemised_csv_v1" },
    });
    expect(screen.getByText(/Keep the \.csv extension\./)).toBeTruthy();
  });

  it("applies a changed legacy profile when the form is still empty", () => {
    const view = render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="manual_invoice_pdf_v1"
      />,
    );
    const profile = screen.getByLabelText("File profile") as HTMLSelectElement;
    expect(profile.value).toBe("manual_invoice_pdf_v1");

    view.rerender(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="stripe_balance_itemised_csv_v1"
      />,
    );

    expect(profile.value).toBe("stripe_balance_itemised_csv_v1");
  });

  it("keeps the embedded invoice profile fixed and preserves filename suggestions", () => {
    const { container } = render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="commbank_transaction_history_csv_v1"
        embedded
        invoiceOnly
      />,
    );

    expect(container.querySelector("main")).toBeNull();
    expect(screen.queryByLabelText("File profile")).toBeNull();
    expect(screen.getByLabelText("Supplier")).toBeTruthy();
    expect(screen.getByLabelText("Document date")).toBeTruthy();
    expect(screen.getByLabelText("Reference")).toBeTruthy();
    expect(screen.queryByLabelText("Coverage start")).toBeNull();
    expect(screen.queryByLabelText("Coverage end")).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Use document date for coverage" }),
    ).toBeNull();
    expect(
      (screen.getByLabelText("File") as HTMLInputElement).accept,
    ).toContain(".pdf");
    expect(
      (screen.getByLabelText("File") as HTMLInputElement).accept,
    ).not.toContain(".csv");

    fireEvent.change(screen.getByLabelText("File"), {
      target: {
        files: [
          new File(["synthetic pdf"], "Acme-2026-02-28-INV-104.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    expect(screen.getByText("Supplier: Acme")).toBeTruthy();
    expect(screen.getByText("Document date: 2026-02-28")).toBeTruthy();
    expect(screen.getByText("Reference: INV-104")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Apply supplier to file metadata",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Apply filename suggestions" }),
    ).toBeNull();
  });

  it("notifies the parent when an embedded file is selected or cleared", () => {
    const onFileChange = vi.fn();
    render(
      <FileUploadPage
        session={authenticatedSession}
        embedded
        invoiceOnly
        onFileChange={onFileChange}
      />,
    );
    const fileInput = screen.getByLabelText("File");
    const file = new File(["synthetic pdf"], "invoice.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(onFileChange).toHaveBeenLastCalledWith(file);

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(onFileChange).toHaveBeenLastCalledWith(null);
  });

  it("requires a safe download name with the profile extension", () => {
    expect(fileUploadFilenameIssue("invoice.pdf", "pdf")).toBeNull();
    expect(fileUploadFilenameIssue("invoice", "pdf")).toContain(".pdf");
    expect(fileUploadFilenameIssue("folder/invoice.pdf", "pdf")).toContain(
      "slashes",
    );
    expect(fileUploadFilenameIssue("invoice\n.pdf", "pdf")).toContain(
      "control characters",
    );
  });

  it("requires a coverage start on or before its end and recognizes PDF headers", () => {
    expect(fileUploadPeriodIssue("2026-06-01", "2026-06-30")).toBeNull();
    expect(fileUploadPeriodIssue("2026-07-01", "2026-06-30")).toContain(
      "on or before",
    );
    expect(hasPdfHeader(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(hasPdfHeader(new TextEncoder().encode("not a PDF"))).toBe(false);
  });
});

describe("file upload", () => {
  it("sends the original and chosen names with descriptive CSV metadata", async () => {
    const navigateToArtifact = vi.fn();
    const onBusyChange = vi.fn();
    render(
      <FileUploadPage
        session={authenticatedSession}
        navigateToArtifact={navigateToArtifact}
        onBusyChange={onBusyChange}
      />,
    );

    const profile = screen.getByLabelText("File profile") as HTMLSelectElement;
    expect(profile.options).toHaveLength(3);
    fireEvent.change(profile, {
      target: { value: "stripe_balance_itemised_csv_v1" },
    });
    const file = new File(["synthetic csv"], "stripe-export.csv", {
      type: "text/csv",
    });
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    expect(fileInput.hasAttribute("multiple")).toBe(false);
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "stripe-june.csv" },
    });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("Coverage end"), {
      target: { value: "2026-06-30" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "June payout export" },
    });

    const form = fileInput.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.startArtifactUpload).toHaveBeenCalledWith({
      data: {
        ownerId: null,
        artifactProfile: "stripe_balance_itemised_csv_v1",
        filename: "stripe-june.csv",
        originalFilename: "stripe-export.csv",
        mediaType: "text/csv",
        byteSize: file.size,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        notes: "June payout export",
      },
    });
    const request = FakeXmlHttpRequest.requests[0]!;
    expect(request.method).toBe("PUT");
    expect(request.body).toBe(file);
    expect(request.headers.get("If-None-Match")).toBe("*");
    request.progress(file.size / 2, file.size);
    await screen.findByText("50%");
    request.finish(200);

    await waitFor(() =>
      expect(operations.confirmArtifactUpload).toHaveBeenCalledWith({
        data: { id: "artifact-id" },
      }),
    );
    expect(navigateToArtifact).toHaveBeenCalledWith("artifact-id");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("clears the transfer busy state through the latest callback on unmount", async () => {
    const firstBusyCallback = vi.fn();
    const latestBusyCallback = vi.fn();
    const view = render(
      <FileUploadPage
        session={authenticatedSession}
        onBusyChange={firstBusyCallback}
      />,
    );
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["synthetic pdf"], "export.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.submit(fileInput.closest("form")!);
    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    expect(firstBusyCallback).toHaveBeenLastCalledWith(true);

    view.rerender(
      <FileUploadPage
        session={authenticatedSession}
        onBusyChange={latestBusyCallback}
      />,
    );
    view.unmount();

    expect(latestBusyCallback).toHaveBeenLastCalledWith(false);
    expect(firstBusyCallback).not.toHaveBeenLastCalledWith(false);
  });

  it("keeps invoice-only metadata scoped to invoice PDFs", async () => {
    const navigateToArtifact = vi.fn();
    render(
      <FileUploadPage
        session={authenticatedSession}
        navigateToArtifact={navigateToArtifact}
      />,
    );
    const file = new File(["synthetic pdf"], "invoice.pdf", {
      type: "application/pdf",
    });
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Document date"), {
      target: { value: "2026-06-12" },
    });
    fireEvent.change(screen.getByLabelText("Reference"), {
      target: { value: "INV-42" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: "Acme Supplies" },
    });
    fireEvent.submit(fileInput.closest("form")!);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    const uploadMetadata = operations.startArtifactUpload.mock.calls[0]?.[0]
      .data as Record<string, unknown>;
    expect(uploadMetadata).toMatchObject({
      ownerId: null,
      artifactProfile: "manual_invoice_pdf_v1",
      filename: "invoice.pdf",
      originalFilename: "invoice.pdf",
      mediaType: "application/pdf",
      documentDate: "2026-06-12",
      reference: "INV-42",
      supplier: "Acme Supplies",
    });
    expect(uploadMetadata).not.toHaveProperty("periodStart");
    expect(uploadMetadata).not.toHaveProperty("periodEnd");
    FakeXmlHttpRequest.requests[0]!.finish(200);
    await waitFor(() =>
      expect(navigateToArtifact).toHaveBeenCalledWith("artifact-id"),
    );
  });

  it("applies PDF filename suggestions one blank metadata field at a time", () => {
    render(<FileUploadPage session={authenticatedSession} />);
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    const file = new File(["synthetic pdf"], "Acme-2026-02-28-INV-104.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "review-copy.pdf" },
    });
    fireEvent.change(screen.getByLabelText("Document date"), {
      target: { value: "2026-03-01" },
    });

    expect(screen.getByText("Supplier: Acme")).toBeTruthy();
    expect(screen.getByText("Document date: 2026-02-28")).toBeTruthy();
    expect(screen.getByText("Reference: INV-104")).toBeTruthy();
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      screen.queryByRole("button", { name: /apply .* to transaction/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Apply filename suggestions" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply supplier to file metadata",
      }),
    );

    expect((screen.getByLabelText("Supplier") as HTMLInputElement).value).toBe(
      "Acme",
    );
    expect(
      (screen.getByLabelText("Document date") as HTMLInputElement).value,
    ).toBe("2026-03-01");
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText("Filename") as HTMLInputElement).value).toBe(
      "review-copy.pdf",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Supplier suggestion was applied to file metadata",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply document date to file metadata",
      }),
    );
    expect(
      (screen.getByLabelText("Document date") as HTMLInputElement).value,
    ).toBe("2026-03-01");
    expect(screen.getByRole("status").textContent).toContain(
      "Document date already has a value",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply reference to file metadata",
      }),
    );
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe(
      "INV-104",
    );
  });

  it("keeps filename suggestions scoped to file metadata", () => {
    render(<FileUploadPage session={authenticatedSession} />);
    fireEvent.change(screen.getByLabelText("File"), {
      target: {
        files: [
          new File(["synthetic pdf"], "Acme-2026-02-28.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Apply supplier to file metadata",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Apply to file metadata" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /apply .* to transaction/i }),
    ).toBeNull();
    expect(screen.queryByLabelText("Coverage start")).toBeNull();
  });

  it("applies original CSV filename coverage only after selecting the suggested profile", async () => {
    render(<FileUploadPage session={authenticatedSession} />);
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    const file = new File(
      ["synthetic csv"],
      "Stripe-2026-06-01-2026-06-30.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [file] } });

    const profile = screen.getByLabelText("File profile") as HTMLSelectElement;
    expect(profile.value).toBe("manual_invoice_pdf_v1");
    expect(fileInput.files?.[0]).toBe(file);
    expect(
      screen.getByText(
        "Original filename suggests a Stripe CSV export covering 2026-06-01 to 2026-06-30.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use Stripe CSV profile" }),
    );

    expect(profile.value).toBe("stripe_balance_itemised_csv_v1");
    expect(fileInput.files?.[0]).toBe(file);
    expect(screen.queryByLabelText("Supplier")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "renamed.csv" },
    });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "2026-06-05" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply to file metadata" }),
    );

    expect(
      (screen.getByLabelText("Coverage start") as HTMLInputElement).value,
    ).toBe("2026-06-05");
    expect(
      (screen.getByLabelText("Coverage end") as HTMLInputElement).value,
    ).toBe("2026-06-30");
    expect(
      screen.getByText(
        "Original filename suggests a Stripe CSV export covering 2026-06-01 to 2026-06-30.",
      ),
    ).toBeTruthy();

    fireEvent.submit(fileInput.closest("form")!);
    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    expect(operations.startArtifactUpload).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artifactProfile: "stripe_balance_itemised_csv_v1",
        filename: "renamed.csv",
        originalFilename: "Stripe-2026-06-01-2026-06-30.csv",
        periodStart: "2026-06-05",
        periodEnd: "2026-06-30",
      }),
    });
    expect(
      operations.startArtifactUpload.mock.calls[0]?.[0].data,
    ).not.toHaveProperty("supplier");
  });

  it("applies legacy CSV coverage ranges without inferring a provider profile", () => {
    render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="commbank_transaction_history_csv_v1"
      />,
    );
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    const profile = screen.getByLabelText("File profile") as HTMLSelectElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["synthetic csv"], "stripe_2026-09-01_to_2026-09-30.csv", {
            type: "text/csv",
          }),
        ],
      },
    });

    expect(profile.value).toBe("commbank_transaction_history_csv_v1");
    expect(screen.getByText("Coverage: 2026-09-01 to 2026-09-30")).toBeTruthy();
    expect(screen.queryByText("Provider: Stripe")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Use Stripe CSV profile" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Apply to file metadata" }),
    );

    expect(
      (screen.getByLabelText("Coverage start") as HTMLInputElement).value,
    ).toBe("2026-09-01");
    expect(
      (screen.getByLabelText("Coverage end") as HTMLInputElement).value,
    ).toBe("2026-09-30");
    expect(profile.value).toBe("commbank_transaction_history_csv_v1");
  });

  it("keeps CSV coverage values when switching profiles and excludes them from PDF uploads", async () => {
    render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="stripe_balance_itemised_csv_v1"
      />,
    );
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    const file = new File(
      ["synthetic csv"],
      "Stripe-2026-06-01-2026-06-30.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("Coverage end"), {
      target: { value: "2026-06-30" },
    });

    const profile = screen.getByLabelText("File profile") as HTMLSelectElement;
    fireEvent.change(profile, {
      target: { value: "manual_invoice_pdf_v1" },
    });
    expect(screen.queryByLabelText("Coverage start")).toBeNull();
    expect(screen.queryByLabelText("Coverage end")).toBeNull();
    expect(screen.getByLabelText("Document date")).toBeTruthy();
    expect(screen.getByLabelText("Reference")).toBeTruthy();
    expect(screen.getByLabelText("Notes")).toBeTruthy();
    expect(fileInput.files?.[0]).toBe(file);

    const pdf = new File(["synthetic pdf"], "invoice.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInput, { target: { files: [pdf] } });
    fireEvent.change(screen.getByLabelText("Document date"), {
      target: { value: "2026-06-12" },
    });
    fireEvent.change(screen.getByLabelText("Reference"), {
      target: { value: "INV-42" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "PDF note" },
    });
    fireEvent.submit(fileInput.closest("form")!);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    const pdfMetadata = operations.startArtifactUpload.mock.calls[0]?.[0]
      .data as Record<string, unknown>;
    expect(pdfMetadata).toMatchObject({
      artifactProfile: "manual_invoice_pdf_v1",
      documentDate: "2026-06-12",
      reference: "INV-42",
      notes: "PDF note",
    });
    expect(pdfMetadata).not.toHaveProperty("periodStart");
    expect(pdfMetadata).not.toHaveProperty("periodEnd");
  });

  it("preserves manual CSV coverage values when switching profiles", () => {
    render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="stripe_balance_itemised_csv_v1"
      />,
    );
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    const file = new File(["synthetic csv"], "custom-export.csv", {
      type: "text/csv",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("Coverage end"), {
      target: { value: "2026-06-30" },
    });
    const profile = screen.getByLabelText("File profile") as HTMLSelectElement;

    fireEvent.change(profile, {
      target: { value: "manual_invoice_pdf_v1" },
    });
    expect(fileInput.files?.[0]).toBe(file);
    expect(screen.queryByLabelText("Coverage start")).toBeNull();
    expect(screen.getByLabelText("Document date")).toBeTruthy();

    fireEvent.change(profile, {
      target: { value: "stripe_balance_itemised_csv_v1" },
    });
    expect(fileInput.files?.[0]).toBe(file);
    expect(
      (screen.getByLabelText("Coverage start") as HTMLInputElement).value,
    ).toBe("2026-06-01");
    expect(
      (screen.getByLabelText("Coverage end") as HTMLInputElement).value,
    ).toBe("2026-06-30");
  });

  it("refreshes suggestions for the current file and clears them after a profile switch", () => {
    render(<FileUploadPage session={authenticatedSession} />);
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["synthetic pdf"], "First Supplier-2026-01-01-INV-1.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(screen.getByText("Supplier: First Supplier")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("File profile"), {
      target: { value: "stripe_balance_itemised_csv_v1" },
    });
    expect(
      screen.queryByRole("button", { name: "Apply to file metadata" }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("File profile"), {
      target: { value: "manual_invoice_pdf_v1" },
    });
    expect(
      screen.getByRole("button", {
        name: "Apply supplier to file metadata",
      }),
    ).toBeTruthy();

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["synthetic pdf"], "Second Supplier-2026-01-02-INV-2.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(screen.queryByText("Supplier: First Supplier")).toBeNull();
    expect(screen.getByText("Supplier: Second Supplier")).toBeTruthy();
  });

  it("skips and explains a coverage suggestion that would invert entered dates", () => {
    render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="commbank_transaction_history_csv_v1"
      />,
    );
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["synthetic csv"], "CommBank-2026-01-01-2026-01-31.csv", {
            type: "text/csv",
          }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "2026-02-01" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Apply to file metadata" }),
    );

    expect(
      (screen.getByLabelText("Coverage start") as HTMLInputElement).value,
    ).toBe("2026-02-01");
    expect(
      (screen.getByLabelText("Coverage end") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByRole("status").textContent).toContain(
      "suggested coverage end was left blank",
    );
  });

  it("rejects an inverted coverage range before starting an upload", () => {
    render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="commbank_transaction_history_csv_v1"
      />,
    );
    const file = new File(["synthetic csv"], "bank.csv", {
      type: "text/csv",
    });
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Coverage start"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("Coverage end"), {
      target: { value: "2026-06-30" },
    });
    fireEvent.submit(fileInput.closest("form")!);

    expect(screen.getByRole("alert").textContent).toContain(
      "Coverage start must be on or before coverage end.",
    );
    expect(operations.startArtifactUpload).not.toHaveBeenCalled();
  });

  it("requires a separate explicit upload after a failed transfer and keeps the pending link", async () => {
    render(<FileUploadPage session={authenticatedSession} />);
    const file = new File(["synthetic csv"], "bank.csv", { type: "text/csv" });
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(screen.getByLabelText("File profile"), {
      target: { value: "commbank_transaction_history_csv_v1" },
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.submit(fileInput.closest("form")!);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    FakeXmlHttpRequest.requests[0]!.finish(503);
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Start a separate upload" }),
    );

    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(fileInput.value).toBe("");
    expect(
      screen
        .getByRole("link", { name: "Review earlier file 1" })
        .getAttribute("href"),
    ).toBe("/imports/files/artifact-id");
    expect(FakeXmlHttpRequest.requests).toHaveLength(1);
  });

  it("retries uncertain confirmation for the same artifact without re-uploading", async () => {
    const navigateToArtifact = vi.fn();
    operations.confirmArtifactUpload
      .mockRejectedValueOnce(new Error("uncertain response"))
      .mockResolvedValueOnce({ id: "artifact-id", state: "awaiting_review" });
    render(
      <FileUploadPage
        session={authenticatedSession}
        initialProfile="commbank_transaction_history_csv_v1"
        navigateToArtifact={navigateToArtifact}
      />,
    );
    const file = new File(["synthetic csv"], "bank.csv", { type: "text/csv" });
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.submit(fileInput.closest("form")!);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    FakeXmlHttpRequest.requests[0]!.finish(200);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry confirmation" }));

    await waitFor(() =>
      expect(navigateToArtifact).toHaveBeenCalledWith("artifact-id"),
    );
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(FakeXmlHttpRequest.requests).toHaveLength(1);
    expect(operations.confirmArtifactUpload).toHaveBeenCalledTimes(2);
  });
});

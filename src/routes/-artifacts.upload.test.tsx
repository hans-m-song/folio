// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";

const operations = vi.hoisted(() => ({
  confirmArtifactUpload: vi.fn(),
  findArtifactFilenameMatches: vi.fn(),
  startArtifactUpload: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) =>
    configuration,
}));

vi.mock("./-transaction-workflow", () => ({
  loadTransactionWorkflowSession: vi.fn(),
}));

vi.mock("../server/operations", () => operations);

import {
  ArtifactPdfUploadPage,
  hasPdfHeader,
  invoicePdfFileIssue,
} from "./-artifacts.upload";

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
  user: { id: "actor" } as never,
};

beforeEach(() => {
  vi.resetAllMocks();
  FakeXmlHttpRequest.requests = [];
  let id = 0;
  operations.findArtifactFilenameMatches.mockResolvedValue([]);
  operations.startArtifactUpload.mockImplementation(
    async ({ data }: { data: { filename: string } }) => ({
      artifact: { id: `artifact-${++id}` },
      uploadUrl: `https://upload.example.test/${encodeURIComponent(data.filename)}`,
    }),
  );
  operations.confirmArtifactUpload.mockImplementation(async ({ data }) => data);
  vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
  vi.stubGlobal("crypto", {
    subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
  });
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: async function (this: File) {
      return new TextEncoder().encode(
        this.name === "bad-content.pdf" ? "not a PDF" : "%PDF-1.7\n",
      ).buffer;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("invoice PDF upload checks", () => {
  it("rejects empty and non-PDF filenames", () => {
    expect(invoicePdfFileIssue({ name: "invoice.pdf", size: 0 })).toBe(
      "The selected file is empty.",
    );
    expect(invoicePdfFileIssue({ name: "invoice.txt", size: 10 })).toBe(
      "Choose a file with a .pdf extension.",
    );
    expect(invoicePdfFileIssue({ name: "INVOICE.PDF", size: 10 })).toBeNull();
  });

  it("requires a PDF header before upload", () => {
    expect(hasPdfHeader(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(hasPdfHeader(new TextEncoder().encode("not a PDF"))).toBe(false);
  });
});

describe("bulk invoice PDF upload", () => {
  it("warns about an existing PDF filename without preventing upload", async () => {
    operations.findArtifactFilenameMatches.mockResolvedValueOnce([2]);
    render(
      createElement(ArtifactPdfUploadPage, { session: authenticatedSession }),
    );

    const file = new File(["%PDF-data"], "invoice.pdf", {
      type: "application/pdf",
    });
    const input = screen.getByLabelText("Invoice or evidence PDFs");
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText("2 existing artifacts match this filename."),
    ).toBeTruthy();
    expect(operations.findArtifactFilenameMatches).toHaveBeenCalledWith({
      data: {
        profile: "manual_invoice_pdf_v1",
        filenames: ["invoice.pdf"],
      },
    });
    const uploadButton = screen.getByRole("button", {
      name: "Upload 1 queued PDF",
    }) as HTMLButtonElement;
    expect(uploadButton.disabled).toBe(false);
    fireEvent.click(uploadButton);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
  });

  it("uploads files independently, reports progress, and retries only a failed file", async () => {
    const first = new File(["%PDF-first"], "first.pdf", {
      type: "application/pdf",
    });
    const second = new File(["%PDF-second"], "second.pdf", {
      type: "application/pdf",
    });
    render(
      createElement(ArtifactPdfUploadPage, { session: authenticatedSession }),
    );

    const input = screen.getByLabelText("Invoice or evidence PDFs");
    fireEvent.change(input, { target: { files: [first, second] } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    const firstRequest = FakeXmlHttpRequest.requests[0]!;
    expect(firstRequest.method).toBe("PUT");
    expect(firstRequest.body).toBe(first);
    expect(operations.startArtifactUpload).toHaveBeenNthCalledWith(1, {
      data: {
        ownerId: "actor",
        artifactProfile: "manual_invoice_pdf_v1",
        filename: "first.pdf",
        mediaType: "application/pdf",
        byteSize: first.size,
        checksumSha256: expect.any(String),
      },
    });
    firstRequest.progress(first.size / 2, first.size);
    await screen.findByText("50%");
    firstRequest.finish(503);

    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(2));
    const secondRequest = FakeXmlHttpRequest.requests[1]!;
    expect(secondRequest.body).toBe(second);
    secondRequest.finish(200);
    await screen.findByText(
      "Confirmed and available as reusable evidence in the file library.",
    );
    expect(operations.confirmArtifactUpload).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Retry upload for first.pdf" }),
    );
    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(3));
    expect(FakeXmlHttpRequest.requests[2]?.body).toBe(first);
    expect(operations.startArtifactUpload).toHaveBeenCalledTimes(3);
    FakeXmlHttpRequest.requests[2]!.finish(200);
    await waitFor(() =>
      expect(screen.getAllByText("Available in file library").length).toBe(2),
    );
    expect(operations.confirmArtifactUpload).toHaveBeenCalledTimes(2);
  });

  it("keeps unauthenticated visitors out of the upload workflow", () => {
    render(
      createElement(ArtifactPdfUploadPage, {
        session: { authenticated: false },
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/auth/login?return_to=%2Fimports%2Fpdf");
  });

  it("rejects a PDF filename when its content has no PDF header", async () => {
    const file = new File(["not a PDF"], "bad-content.pdf", {
      type: "application/pdf",
    });
    render(
      createElement(ArtifactPdfUploadPage, { session: authenticatedSession }),
    );

    const input = screen.getByLabelText("Invoice or evidence PDFs");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.submit(input.closest("form")!);

    expect(
      await screen.findByText("The selected file does not have a PDF header."),
    ).toBeTruthy();
    expect(operations.startArtifactUpload).not.toHaveBeenCalled();
  });

  it("does not offer a blind retry after uncertain PDF confirmation", async () => {
    operations.confirmArtifactUpload.mockRejectedValueOnce(
      new Error("Confirmation response unavailable"),
    );
    const file = new File(["%PDF-data"], "invoice.pdf", {
      type: "application/pdf",
    });
    render(
      createElement(ArtifactPdfUploadPage, { session: authenticatedSession }),
    );

    const input = screen.getByLabelText("Invoice or evidence PDFs");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    FakeXmlHttpRequest.requests[0]!.finish(200);

    expect(
      await screen.findByText(
        "Confirmation could not be verified. Check the file library before retrying this PDF.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Retry upload for invoice.pdf" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", {
        name: "Check the file library before adding this file again",
      }),
    ).toBeTruthy();
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
  });

  it("retries a known pre-commit storage failure against the existing artifact", async () => {
    operations.confirmArtifactUpload
      .mockRejectedValueOnce(new Error("Code S3_UNAVAILABLE"))
      .mockResolvedValueOnce({ id: "artifact-1" });
    const file = new File(["%PDF-data"], "invoice.pdf", {
      type: "application/pdf",
    });
    render(
      createElement(ArtifactPdfUploadPage, { session: authenticatedSession }),
    );

    const input = screen.getByLabelText("Invoice or evidence PDFs");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(FakeXmlHttpRequest.requests).toHaveLength(1));
    FakeXmlHttpRequest.requests[0]!.finish(200);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Retry confirmation for invoice.pdf",
      }),
    );
    await screen.findByText(
      "Confirmed and available as reusable evidence in the file library.",
    );
    expect(operations.startArtifactUpload).toHaveBeenCalledOnce();
    expect(operations.confirmArtifactUpload).toHaveBeenCalledTimes(2);
    expect(operations.confirmArtifactUpload).toHaveBeenNthCalledWith(2, {
      data: { id: "artifact-1" },
    });
  });
});

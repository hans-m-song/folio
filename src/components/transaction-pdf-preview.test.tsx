// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  previewArtifactForReview: vi.fn(),
}));

vi.mock("../server/operations", () => operations);

import { TransactionPdfPreview } from "./transaction-pdf-preview";

beforeEach(() => {
  operations.previewArtifactForReview.mockReset();
});

afterEach(cleanup);

describe("transaction PDF preview", () => {
  it("requests fit width without changing the signed URL query", async () => {
    const url =
      "https://preview.example.test/invoice.pdf?signature=synthetic#page=2";
    operations.previewArtifactForReview.mockResolvedValue(url);
    render(
      <TransactionPdfPreview artifactId="fixture" filename="invoice.pdf" />,
    );
    const frame = await screen.findByTitle("PDF preview: invoice.pdf");
    expect(frame.getAttribute("src")).toBe(`${url}&view=FitH`);
    expect(
      screen
        .getByRole("link", { name: "Open PDF in a new tab" })
        .getAttribute("href"),
    ).toBe(url);
  });

  it("shows the authorized inline preview and a new-tab fallback", async () => {
    operations.previewArtifactForReview.mockResolvedValue(
      "https://preview.example.test/invoice.pdf",
    );
    render(
      <TransactionPdfPreview
        artifactId="11111111-1111-4111-8111-111111111111"
        filename="invoice.pdf"
      />,
    );

    const frame = await screen.findByTitle("PDF preview: invoice.pdf");
    expect(frame.getAttribute("src")).toBe(
      "https://preview.example.test/invoice.pdf#view=FitH",
    );
    expect(operations.previewArtifactForReview).toHaveBeenCalledWith({
      data: { id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(
      screen
        .getByRole("link", { name: "Open PDF in a new tab" })
        .getAttribute("target"),
    ).toBe("_blank");
  });

  it("shows loading and error states and lets the reviewer retry", async () => {
    let resolvePreview!: (url: string) => void;
    operations.previewArtifactForReview
      .mockRejectedValueOnce(new Error("Synthetic preview failure"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePreview = resolve;
          }),
      );
    render(
      <TransactionPdfPreview
        artifactId="11111111-1111-4111-8111-111111111111"
        filename="invoice.pdf"
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "PDF preview could not be prepared.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Preparing PDF preview…",
    );
    await act(async () => {
      resolvePreview("https://preview.example.test/retried.pdf");
    });
    expect(
      (await screen.findByTitle("PDF preview: invoice.pdf")).getAttribute(
        "src",
      ),
    ).toBe("https://preview.example.test/retried.pdf#view=FitH");
  });

  it("ignores a stale preview response after the selected artifact changes", async () => {
    let resolveFirst!: (url: string) => void;
    operations.previewArtifactForReview.mockImplementation(
      ({ data }: { data: { id: string } }) =>
        data.id === "11111111-1111-4111-8111-111111111111"
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve("https://preview.example.test/second.pdf"),
    );
    const preview = render(
      <TransactionPdfPreview
        artifactId="11111111-1111-4111-8111-111111111111"
        filename="first.pdf"
      />,
    );
    await waitFor(() =>
      expect(operations.previewArtifactForReview).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Preparing PDF preview…",
    );

    preview.rerender(
      <TransactionPdfPreview
        artifactId="22222222-2222-4222-8222-222222222222"
        filename="second.pdf"
      />,
    );
    const secondFrame = await screen.findByTitle("PDF preview: second.pdf");
    await act(async () => {
      resolveFirst("https://preview.example.test/stale.pdf");
    });
    await waitFor(() =>
      expect(secondFrame.getAttribute("src")).toBe(
        "https://preview.example.test/second.pdf#view=FitH",
      ),
    );
    expect(screen.queryByTitle("PDF preview: first.pdf")).toBeNull();
  });
});

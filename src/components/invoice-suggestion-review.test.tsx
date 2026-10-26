// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSupplierInvoice } from "../domain/invoice-parser";
import { normalizedInvoiceDocumentVersion } from "../domain/invoice-types";
import { selectAutocompleteOption } from "./autocomplete-test-helpers";
import {
  InvoiceSuggestionReview,
  type InvoiceReviewObservation,
} from "./invoice-suggestion-review";

const operation = vi.hoisted(() => vi.fn());
vi.mock("../server/invoice-operations", () => ({
  extractInvoiceFields: operation,
}));

const blank = {
  counterparty: "",
  invoiceDate: "",
  reference: "",
  documentAmount: "",
  documentCurrency: "AUD",
};
const artifact = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "synthetic.pdf",
};
const response = (lines: string[], additionalPages: string[][] = []) => ({
  status: "parsed" as const,
  artifactId: artifact.id,
  checksumSha256: "synthetic-checksum",
  confirmedAt: "2026-10-07T00:00:00.000Z",
  duplicateHints: {
    linkedTransactions: 0,
    matchingReferenceTransactions: 0,
    matchingChecksumArtifacts: 0,
  },
  result: parseSupplierInvoice({
    schemaVersion: normalizedInvoiceDocumentVersion,
    pages: [lines, ...additionalPages].map((pageLines, index) => ({
      pageNumber: index + 1,
      width: 612,
      height: 792,
      items: pageLines.map((text, itemIndex) => ({
        text,
        x: 40,
        y: 40 + itemIndex * 20,
        width: 300,
        height: 12,
      })),
    })),
  }),
});

beforeEach(() => {
  operation.mockReset();
});
afterEach(cleanup);

describe("invoice review panel", () => {
  it("uploads a new file only on request and flags filename conflicts before applying", async () => {
    operation.mockResolvedValue(
      response([
        "Google Workspace Invoice",
        "Invoice date: 2026-06-30",
        "Total AUD 100.00",
      ]),
    );
    const file = new File(
      ["synthetic pdf"],
      "Google Workspace - 2026-06-01.pdf",
      { type: "application/pdf" },
    );
    const prepare = vi.fn().mockResolvedValue(artifact.id);
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={file}
        artifacts={[]}
        busy={false}
        prepareFile={prepare}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Upload and extract invoice fields" }),
    );
    await screen.findByRole("list", { name: "Invoice field conflicts" });
    expect(prepare).toHaveBeenCalledWith(file);
    expect(operation).toHaveBeenCalledWith({
      data: { artifactId: artifact.id },
    });
    expect(
      screen.getByText(/Invoice date differs from the filename/),
    ).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("extracts only on explicit request and applies invoice fields without settlement or occurrence fields", async () => {
    operation.mockResolvedValue(
      response([
        "Google Workspace Invoice",
        "Invoice date: 2026-06-30",
        "Total AUD 100.00",
        "Amount paid AUD 60.00",
        "Amount due AUD 40.00",
      ]),
    );
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    expect(operation).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await screen.findByRole("button", { name: "Apply to blank fields" });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply to blank fields" }),
    );
    expect(apply).toHaveBeenCalledWith({
      counterparty: "Google Workspace",
      invoiceDate: "2026-06-30",
      documentAmount: "100.0000",
    });
  });

  it("keeps unconfirmed currency, amounts, and provenance from multiple pages", async () => {
    operation.mockResolvedValue(
      response(
        ["Supabase Invoice", "Amount paid $10.25"],
        [["Subtotal $10.25"]],
      ),
    );
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    const table = await screen.findByRole("table", {
      name: "Observed invoice facts",
    });
    const paidRow = within(table).getByRole("row", { name: /Amount paid/ });
    const subtotalRow = within(table).getByRole("row", { name: /Subtotal/ });

    expect(paidRow.textContent).toContain("Currency unconfirmed");
    expect(paidRow.textContent).toContain("10.25");
    expect(paidRow.textContent).toContain("Page 1: Amount paid");
    expect(subtotalRow.textContent).toContain("Currency unconfirmed");
    expect(subtotalRow.textContent).toContain("10.25");
    expect(subtotalRow.textContent).toContain("Page 2: Subtotal");
  });

  it("requires reviewed total entry and currency confirmation for paid-only receipts", async () => {
    operation.mockResolvedValue(
      response(["Supabase Invoice", "Subtotal $10.25", "Amount paid $10.25"]),
    );
    const apply = vi.fn();
    const applySettlement = vi.fn(() => true);
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
        canApplySettlement={() => true}
        onApplySettlement={applySettlement}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    const total = await screen.findByLabelText("Invoice total");
    expect((total as HTMLInputElement).value).toBe("");
    fireEvent.change(total, { target: { value: "10.25" } });
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Currency" }),
      "USD",
    );
    const use = screen.getByRole("button", {
      name: "Use reviewed invoice total and currency",
    });
    const useSettlement = screen.getByRole("button", {
      name: "Use reviewed amount as settlement",
    });
    expect((use as HTMLButtonElement).disabled).toBe(true);
    expect((useSettlement as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I checked the invoice total and currency against the source PDF.",
      }),
    );
    expect((useSettlement as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(useSettlement);
    expect(applySettlement).toHaveBeenCalledWith({
      settlementAmount: "10.25",
      settlementCurrency: "USD",
    });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(use);
    expect(apply).toHaveBeenCalledWith({
      documentAmount: "10.25",
      documentCurrency: "USD",
    });
  });

  it("keeps Stripe facts read-only and shows duplication safeguards", async () => {
    const stripe = response([
      "Stripe Invoice",
      "Processing fees AUD10.00",
      "Total AUD10.00",
      "Amount due AUD0.00",
    ]);
    operation.mockResolvedValue({
      ...stripe,
      duplicateHints: { ...stripe.duplicateHints, linkedTransactions: 2 },
    });
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await screen.findByText(/Stripe review-only/);
    expect(
      screen.queryByRole("button", { name: "Apply to blank fields" }),
    ).toBeNull();
    expect(screen.getByText(/2 existing transaction link/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("returns read-only observations with duplicate hints and restores them only for the matching artifact", async () => {
    const parsed = response([
      "Google Workspace Invoice",
      "Invoice date: 2026-06-30",
      "Total AUD 100.00",
    ]);
    operation.mockResolvedValue({
      ...parsed,
      duplicateHints: {
        linkedTransactions: 1,
        matchingReferenceTransactions: 1,
        matchingChecksumArtifacts: 1,
      },
    });
    const observation = vi.fn<(value: InvoiceReviewObservation) => void>();
    const apply = vi.fn();
    const props = {
      file: null,
      artifacts: [artifact],
      busy: false,
      getValues: () => blank,
      onApply: apply,
    };
    const view = render(
      <InvoiceSuggestionReview
        {...props}
        observationOnly
        onObservation={observation}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Extract observed invoice facts" }),
    );
    await screen.findByRole("table", { name: "Observed invoice facts" });
    expect(screen.getByText(/1 existing transaction link/)).toBeTruthy();
    expect(
      screen.getByText(/1 transaction\(s\) with the same reference/),
    ).toBeTruthy();
    expect(
      screen.getByText(/1 other PDF\(s\) with the same checksum/),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).not.toMatch(/apply/i);
    expect(screen.queryByLabelText("Invoice total")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /apply to blank fields/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /use reviewed amount/i }),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();

    await waitFor(() => expect(observation).toHaveBeenCalledOnce());
    const cachedObservation = observation.mock.calls[0]![0];
    expect(cachedObservation).toMatchObject({
      artifactId: artifact.id,
      duplicateMessage: expect.stringContaining("1 existing transaction link"),
    });
    expect(cachedObservation.result).toEqual(parsed.result);

    view.rerender(
      <InvoiceSuggestionReview {...props} observation={cachedObservation} />,
    );
    expect(
      screen.getByRole("table", { name: "Observed invoice facts" }),
    ).toBeTruthy();
    expect(operation).toHaveBeenCalledOnce();

    view.rerender(
      <InvoiceSuggestionReview
        {...props}
        observation={cachedObservation}
        artifacts={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            filename: "replacement.pdf",
          },
        ]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("table", { name: "Observed invoice facts" }),
      ).toBeNull(),
    );
    expect(operation).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
  });

  it("discards an extraction response after a target field is edited", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    operation.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let values = { ...blank };
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => values}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    values = { ...values, reference: "Edited while loading" };
    resolve(response(["Google Workspace Invoice", "Total AUD100.00"]));
    await screen.findByText(/Transaction fields changed during extraction/);
    expect(
      screen.queryByRole("button", { name: "Apply to blank fields" }),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("discards extracted facts after the selected artifact changes", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    operation.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const apply = vi.fn();
    const props = {
      file: null,
      busy: false,
      getValues: () => blank,
      onApply: apply,
    };
    const { rerender } = render(
      <InvoiceSuggestionReview {...props} artifacts={[artifact]} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await waitFor(() => expect(operation).toHaveBeenCalledOnce());
    rerender(
      <InvoiceSuggestionReview
        {...props}
        artifacts={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            filename: "replacement.pdf",
          },
        ]}
      />,
    );
    await act(async () => {
      resolve(response(["Google Workspace Invoice", "Total AUD 100.00"]));
    });
    expect(
      screen.queryByRole("table", { name: "Observed invoice facts" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Apply to blank fields" }),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledOnce();
    expect(
      (
        screen.getByRole("button", {
          name: "Extract invoice fields",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("does not expose raw extraction failures or mutate transactions", async () => {
    operation.mockRejectedValue(new Error("private diagnostic text"));
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await screen.findByText(/Invoice extraction failed/);
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});

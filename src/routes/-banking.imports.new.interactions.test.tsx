// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findArtifactFilenameMatches: vi.fn(),
  startArtifactUpload: vi.fn(),
  previewBankCsv: vi.fn(),
  confirmBankImport: vi.fn(),
  cancelBankImport: vi.fn(),
  rejectArtifact: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) =>
    configuration,
}));

vi.mock("../server/operations", () => ({
  findArtifactFilenameMatches: mocks.findArtifactFilenameMatches,
  startArtifactUpload: mocks.startArtifactUpload,
  rejectArtifact: mocks.rejectArtifact,
}));

vi.mock("../server/bank-operations", () => ({
  previewBankCsv: mocks.previewBankCsv,
  confirmBankImport: mocks.confirmBankImport,
  cancelBankImport: mocks.cancelBankImport,
}));

import { NewBankImportPage } from "./banking.imports.new";

beforeEach(() => {
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(async (_algorithm, data: ArrayBuffer) => data.slice(0)),
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  mocks.findArtifactFilenameMatches.mockReset().mockResolvedValue([]);
  mocks.startArtifactUpload.mockReset().mockImplementation(({ data }) =>
    Promise.resolve({
      artifact: {
        id:
          data.filename === "bank-b.csv"
            ? "22222222-2222-4222-8222-222222222222"
            : data.filename === "bank-a.csv"
              ? "11111111-1111-4111-8111-111111111111"
              : "33333333-3333-4333-8333-333333333333",
      },
      uploadUrl: "http://127.0.0.1/upload",
    }),
  );
  mocks.previewBankCsv.mockReset().mockResolvedValue({
    rows: [
      {
        sourceRow: 1,
        postedDate: "2026-08-27",
        amountAud: "300.0000",
        description: "Example movement",
        metadata: { runningBalance: "350.0300" },
      },
    ],
    errors: [],
    earliestDate: "2026-08-27",
    latestDate: "2026-08-27",
  });
  mocks.confirmBankImport.mockReset().mockImplementation(async ({ data }) => ({
    status: "imported",
    artifactId: data.artifactId,
    rowCount: 1,
  }));
  mocks.cancelBankImport.mockReset();
  mocks.rejectArtifact.mockReset().mockResolvedValue({ status: "rejected" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const makeFile = (name: string, bytes: number[]) => {
  const file = new File([new Uint8Array(bytes)], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn().mockResolvedValue(new Uint8Array(bytes).buffer),
  });
  return file;
};

const uploadAndPreview = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Upload and preview" }));
  await screen.findByText("Example movement");
};

const addActiveFileToBatch = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  await user.click(screen.getByRole("button", { name: "Add to batch" }));
};

const prepareTwoFileBatch = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  await user.upload(screen.getByLabelText(/CSV files/), [
    makeFile("bank-a.csv", [1]),
    makeFile("bank-b.csv", [2]),
  ]);
  await user.click(screen.getByRole("button", { name: /bank-a\.csv/ }));
  await uploadAndPreview(user);
  await addActiveFileToBatch(user);
  await user.click(screen.getByRole("button", { name: /bank-b\.csv/ }));
  await uploadAndPreview(user);
  await addActiveFileToBatch(user);
  await user.click(
    screen.getByRole("button", { name: /Review batch \(2 files\)/ }),
  );
};

describe("CommBank batch import interaction", () => {
  it("supports embedding without adding another Banking shell", () => {
    render(<NewBankImportPage embedded />);

    expect(
      screen.getByRole("heading", { name: "Import CommBank CSVs" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Banking sections" }),
    ).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Import type" }),
    ).toBeNull();
    expect(document.querySelector(".banking-import-embedded")?.tagName).toBe(
      "DIV",
    );
  });

  it("warns about an existing CommBank filename without preventing upload", async () => {
    const user = userEvent.setup();
    mocks.findArtifactFilenameMatches.mockResolvedValueOnce([3]);
    render(<NewBankImportPage />);

    await user.upload(
      screen.getByLabelText(/CSV files/),
      makeFile("bank.csv", [1]),
    );

    expect(
      await screen.findByText("3 existing artifacts match this filename."),
    ).toBeTruthy();
    expect(mocks.findArtifactFilenameMatches).toHaveBeenCalledWith({
      data: {
        profile: "commbank_transaction_history_csv_v1",
        filenames: ["bank.csv"],
      },
    });
    await uploadAndPreview(user);
    expect(mocks.startArtifactUpload).toHaveBeenCalledOnce();
  });

  it("keeps reviewed rows unimported until the single batch confirmation action", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);

    await user.upload(
      screen.getByLabelText(/CSV files/),
      makeFile("bank.csv", [1]),
    );
    await uploadAndPreview(user);
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();

    await addActiveFileToBatch(user);
    await user.click(
      screen.getByRole("button", { name: "Review batch (1 file)" }),
    );
    expect(
      screen.getByRole("heading", { name: "Review accepted files" }),
    ).toBeTruthy();
    expect(
      document.querySelector("[aria-label='Batch counts']")?.textContent,
    ).toMatch(/1 file.*1 valid row.*0 errors/);
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(mocks.confirmBankImport).toHaveBeenCalledOnce());
    expect(await screen.findByText("Imported 1 bank rows.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imported/ })).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm import",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("rejects duplicate contents while keeping a single queued file", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);

    await user.upload(screen.getByLabelText(/CSV files/), [
      makeFile("bank.csv", [1, 2]),
      makeFile("bank-copy.csv", [1, 2]),
    ]);

    expect(
      await screen.findByText(/duplicate file was rejected/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /bank\.csv/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bank-copy\.csv/ })).toBeNull();
    expect(mocks.startArtifactUpload).not.toHaveBeenCalled();
  });

  it("shows per-file rows, errors, and acknowledgement before import", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);
    mocks.previewBankCsv.mockResolvedValueOnce({
      rows: [
        {
          sourceRow: 1,
          postedDate: "2026-08-27",
          amountAud: "300.0000",
          description: "Example movement",
          metadata: { runningBalance: "350.0300" },
        },
      ],
      errors: [
        {
          row: 2,
          field: "amountAud",
          message: "Invalid amount",
        },
      ],
      earliestDate: "2026-08-27",
      latestDate: "2026-08-27",
    });

    await user.upload(
      screen.getByLabelText(/CSV files/),
      makeFile("bank.csv", [1]),
    );
    await uploadAndPreview(user);
    await addActiveFileToBatch(user);
    await user.click(
      screen.getByRole("button", { name: "Review batch (1 file)" }),
    );

    expect(
      document.querySelector("[aria-label='Batch counts']")?.textContent,
    ).toMatch(/1 file.*1 valid row.*1 error/);
    expect(screen.getByText(/Row 2, amountAud: Invalid amount/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm import",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();
  });

  it("rejects an uploaded preview visibly and links to the rejected artifact library", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);

    await user.upload(
      screen.getByLabelText(/CSV files/),
      makeFile("bank.csv", [1]),
    );
    await uploadAndPreview(user);
    await user.click(screen.getByRole("button", { name: "Reject file" }));

    expect(
      await screen.findByText(
        "This uploaded CSV was rejected and will not be imported.",
      ),
    ).toBeTruthy();
    expect(mocks.rejectArtifact).toHaveBeenCalledWith({
      data: { id: "33333333-3333-4333-8333-333333333333" },
    });
    expect(
      screen
        .getByRole("link", { name: "View rejected artifact" })
        .getAttribute("href"),
    ).toBe("/imports/library?state=rejected");
    expect(mocks.confirmBankImport).not.toHaveBeenCalled();
  });

  it("keeps a rejection failure visible and allows retrying the rejection", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);
    mocks.rejectArtifact
      .mockRejectedValueOnce(new Error("Reject failed"))
      .mockResolvedValueOnce({ status: "rejected" });

    await user.upload(
      screen.getByLabelText(/CSV files/),
      makeFile("bank.csv", [1]),
    );
    await uploadAndPreview(user);
    await user.click(screen.getByRole("button", { name: "Reject file" }));

    expect(
      await screen.findByText(
        "Rejection failed; this file remains outside the batch.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "View rejected artifact" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reject file" }));
    expect(
      await screen.findByText(
        "This uploaded CSV was rejected and will not be imported.",
      ),
    ).toBeTruthy();
    expect(mocks.rejectArtifact).toHaveBeenCalledTimes(2);
  });

  it("keeps overlap acknowledgement with its file and never retries imported files", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);
    const artifactA = "11111111-1111-4111-8111-111111111111";
    const artifactB = "22222222-2222-4222-8222-222222222222";
    mocks.confirmBankImport.mockImplementation(async ({ data }) => {
      if (data.artifactId === artifactA && !data.acknowledgedOverlapFingerprint)
        return {
          status: "overlap_acknowledgement_required",
          overlapFingerprint: "a".repeat(64),
          overlaps: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              filename: "prior.csv",
              overlapStart: "2026-08-27",
              overlapEnd: "2026-08-27",
            },
          ],
        };
      return {
        status: "imported",
        artifactId: data.artifactId,
        rowCount: 1,
      };
    });

    await prepareTwoFileBatch(user);
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(
      await screen.findByText("prior.csv: 2026-08-27 to 2026-08-27"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imported/ })).toBeTruthy();
    const acknowledgement = screen.getByLabelText(/I reviewed these overlaps/);
    expect((acknowledgement as HTMLInputElement).checked).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm import",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await user.click(acknowledgement);
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() =>
      expect(mocks.confirmBankImport).toHaveBeenCalledTimes(3),
    );
    expect(
      mocks.confirmBankImport.mock.calls.map(([call]) => call.data),
    ).toEqual([
      { artifactId: artifactA, acknowledgedOverlapFingerprint: null },
      { artifactId: artifactB, acknowledgedOverlapFingerprint: null },
      {
        artifactId: artifactA,
        acknowledgedOverlapFingerprint: "a".repeat(64),
      },
    ]);
  });

  it("retries only a failed file after another accepted file imported", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);
    const artifactA = "11111111-1111-4111-8111-111111111111";
    const artifactB = "22222222-2222-4222-8222-222222222222";
    mocks.confirmBankImport.mockImplementation(async ({ data }) => {
      if (data.artifactId === artifactB) {
        if (
          mocks.confirmBankImport.mock.calls.filter(
            ([call]) => call.data.artifactId === artifactB,
          ).length === 1
        )
          throw new Error("Response unavailable");
        return {
          status: "imported",
          artifactId: artifactB,
          rowCount: 1,
        };
      }
      return {
        status: "imported",
        artifactId: artifactA,
        rowCount: 1,
      };
    });

    await prepareTwoFileBatch(user);
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findByText(/completed imports are excluded from retry/i),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /The import result is unknown; retry will check this file only/,
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() =>
      expect(mocks.confirmBankImport).toHaveBeenCalledTimes(3),
    );
    expect(
      mocks.confirmBankImport.mock.calls.map(([call]) => call.data.artifactId),
    ).toEqual([artifactA, artifactB, artifactB]);
  });

  it("retries only the failed preview upload and keeps other queued files", async () => {
    const user = userEvent.setup();
    render(<NewBankImportPage />);
    mocks.previewBankCsv
      .mockRejectedValueOnce(new Error("Preview failed"))
      .mockResolvedValue({
        rows: [
          {
            sourceRow: 1,
            postedDate: "2026-08-27",
            amountAud: "300.0000",
            description: "Example movement",
            metadata: { runningBalance: "350.0300" },
          },
        ],
        errors: [],
        earliestDate: "2026-08-27",
        latestDate: "2026-08-27",
      });

    await user.upload(screen.getByLabelText(/CSV files/), [
      makeFile("bank-a.csv", [1]),
      makeFile("bank-b.csv", [2]),
    ]);
    await user.click(screen.getByRole("button", { name: /bank-a\.csv/ }));
    await user.click(
      screen.getByRole("button", { name: "Upload and preview" }),
    );
    expect((await screen.findAllByText(/could not be parsed/i)).length).toBe(2);
    expect(screen.getByRole("button", { name: /bank-b\.csv/ })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /bank-a\.csv/ })
        .querySelector(".banking-import-queue-status")
        ?.classList.contains("is-error"),
    ).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Retry upload and preview" }),
    );
    await screen.findByText("Example movement");
    await user.click(screen.getByRole("button", { name: /bank-b\.csv/ }));
    expect(
      screen.getByText("Queued", { selector: ".banking-import-queue-status" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Upload and preview" }),
    );
    await screen.findAllByText("Example movement");

    expect(
      mocks.startArtifactUpload.mock.calls.map(([call]) => call.data.filename),
    ).toEqual(["bank-a.csv", "bank-a.csv", "bank-b.csv"]);
  });
});

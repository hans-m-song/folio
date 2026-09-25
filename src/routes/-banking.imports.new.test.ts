import { describe, expect, it, vi } from "vitest";

import {
  abandonFailedBankUpload,
  bankCancelFailureMessage,
  bankImportConfirmationEnabled,
  bankImportConfirmationCandidates,
  bankUploadFailureMessage,
  signedBankImportTotal,
  type BankImportConfirmationCandidate,
} from "./banking.imports.new";

describe("CommBank batch import review", () => {
  const validPreview = { rows: [{}], errors: [] } as never;

  it("blocks malformed or empty previews", () => {
    expect(
      bankImportConfirmationEnabled(
        { rows: [], errors: [] },
        null,
        null,
        false,
      ),
    ).toBe(false);
    expect(
      bankImportConfirmationEnabled(
        { rows: [{}] as never, errors: [{}] as never },
        null,
        null,
        false,
      ),
    ).toBe(false);
  });

  it("requires acknowledgement only after precise overlaps are present", () => {
    expect(bankImportConfirmationEnabled(validPreview, null, null, false)).toBe(
      true,
    );
    expect(
      bankImportConfirmationEnabled(validPreview, "fingerprint-a", null, false),
    ).toBe(false);
    expect(
      bankImportConfirmationEnabled(
        validPreview,
        "fingerprint-a",
        "fingerprint-a",
        false,
      ),
    ).toBe(true);
    expect(
      bankImportConfirmationEnabled(
        validPreview,
        "fingerprint-b",
        "fingerprint-a",
        false,
      ),
    ).toBe(false);
  });

  it("retries only unresolved accepted files and excludes completed imports", () => {
    const items = [
      {
        id: "new",
        decision: "accepted",
        artifactId: "new-id",
        preview: validPreview,
        confirmationStatus: null,
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
      },
      {
        id: "unknown",
        decision: "accepted",
        artifactId: "unknown-id",
        preview: validPreview,
        confirmationStatus: "failed",
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
      },
      {
        id: "overlap",
        decision: "accepted",
        artifactId: "overlap-id",
        preview: validPreview,
        confirmationStatus: "overlap",
        overlapFingerprint: "a".repeat(64),
        acknowledgedOverlapFingerprint: null,
      },
      {
        id: "acknowledged-overlap",
        decision: "accepted",
        artifactId: "acknowledged-overlap-id",
        preview: validPreview,
        confirmationStatus: "overlap",
        overlapFingerprint: "b".repeat(64),
        acknowledgedOverlapFingerprint: "b".repeat(64),
      },
      {
        id: "imported",
        decision: "accepted",
        artifactId: "imported-id",
        preview: validPreview,
        confirmationStatus: "imported",
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
      },
      {
        id: "already-imported",
        decision: "accepted",
        artifactId: "already-imported-id",
        preview: validPreview,
        confirmationStatus: "already_imported",
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
      },
      {
        id: "invalid",
        decision: "accepted",
        artifactId: "invalid-id",
        preview: validPreview,
        confirmationStatus: "invalid",
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
      },
      {
        id: "pending",
        decision: "pending",
        artifactId: "pending-id",
        preview: validPreview,
        confirmationStatus: null,
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
      },
    ] as const;

    const candidates = items as unknown as Array<
      BankImportConfirmationCandidate & { id: string }
    >;
    expect(
      bankImportConfirmationCandidates(candidates, false).map(
        (item) => item.id,
      ),
    ).toEqual(["new", "unknown", "acknowledged-overlap"]);
    expect(bankImportConfirmationCandidates(candidates, true)).toEqual([]);
  });

  it("sums signed amounts exactly without floating-point rounding", () => {
    expect(
      signedBankImportTotal({
        rows: [{ amountAud: "1000.0001" }, { amountAud: "-35.1900" }] as never,
        errors: [],
      }),
    ).toBe("A$964.8101");
    expect(
      signedBankImportTotal({
        rows: [{ amountAud: "-0.0001" }] as never,
        errors: [],
      }),
    ).toBe("−A$0.0001");
  });

  it("omits a signed total when the preview has errors or an unsafe amount", () => {
    expect(
      signedBankImportTotal({
        rows: [{ amountAud: "1.0000" }] as never,
        errors: [{}] as never,
      }),
    ).toBeNull();
    expect(
      signedBankImportTotal({
        rows: [{ amountAud: "not-a-decimal" }] as never,
        errors: [],
      }),
    ).toBeNull();
  });

  it("abandons a known pending artifact after browser upload failure", async () => {
    const abandon = vi.fn().mockResolvedValue({ status: "abandoned" });
    await expect(
      abandonFailedBankUpload("11111111-1111-4111-8111-111111111111", abandon),
    ).resolves.toBe("abandoned");
    expect(abandon).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(bankUploadFailureMessage("upload", "abandoned")).toContain(
      "browser upload failed",
    );
  });

  it("retains the original actionable failure when cancellation also fails", async () => {
    await expect(
      abandonFailedBankUpload(
        "artifact-id",
        vi.fn().mockRejectedValue(new Error()),
      ),
    ).resolves.toBe("abandon_failed");
    const message = bankUploadFailureMessage("preview", "abandon_failed");
    expect(message).toContain("could not be parsed");
    expect(message).toContain("could not be abandoned");
    expect(message).toContain("Cancel pending upload");
    expect(bankCancelFailureMessage(message)).toContain(message);
    expect(bankCancelFailureMessage(message)).toContain(
      "pending artifact is still retained",
    );
  });
});

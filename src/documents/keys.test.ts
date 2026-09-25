import { describe, expect, it } from "vitest";

import { createObjectKey } from "./keys";

describe("S3 keys", () => {
  it("uses the profile, shared UUID, and registered extension", () => {
    const id = "0f935296-35b3-43bd-bc3d-0caa0b0a2510";
    expect(createObjectKey("private/folio/", "manual_invoice_pdf_v1", id)).toBe(
      "private/folio/artifacts/manual_invoice_pdf_v1/0f935296-35b3-43bd-bc3d-0caa0b0a2510.pdf",
    );
  });

  it("uses only the configured prefix, artifact kind and an opaque id", () => {
    expect(
      createObjectKey(
        "private/folio/",
        "pdf",
        "0f935296-35b3-43bd-bc3d-0caa0b0a2510",
      ),
    ).toBe("private/folio/pdf/0f935296-35b3-43bd-bc3d-0caa0b0a2510");
  });
});

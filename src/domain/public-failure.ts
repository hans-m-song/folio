import {
  errorPolicyCatalog,
  unsupportedStripeExportMessage,
  type PublicFailure,
} from "./errors";

const referencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const publicFailureFrom = (
  error: unknown,
): PublicFailure | undefined => {
  try {
    if (!error || typeof error !== "object") return undefined;
    const candidate = error as {
      publicFailure?: Partial<PublicFailure>;
      message?: unknown;
    };
    const message =
      typeof candidate.message === "string" ? candidate.message : "";
    const encoded = /^(.*) Code ([A-Z_]+)\. Reference ([0-9a-f-]+)\.$/i.exec(
      message,
    );
    const code = candidate.publicFailure?.code ?? encoded?.[2];
    const reference = candidate.publicFailure?.reference ?? encoded?.[3];
    if (
      typeof code !== "string" ||
      typeof reference !== "string" ||
      !referencePattern.test(reference)
    )
      return undefined;
    const candidates = Object.entries(errorPolicyCatalog).filter(
      ([internalCode, policy]) =>
        ("publicCode" in policy ? policy.publicCode : internalCode) === code,
    );
    const suppliedMessage = candidate.publicFailure?.message ?? encoded?.[1];
    const selected =
      candidates.find(
        ([, policy]) => policy.message === suppliedMessage,
      )?.[1] ?? candidates[0]?.[1];
    if (!selected) return undefined;
    return {
      code,
      reference,
      message:
        code === "STRIPE_CSV_INVALID" &&
        suppliedMessage === unsupportedStripeExportMessage
          ? unsupportedStripeExportMessage
          : selected.message,
      recovery: selected.recovery,
    };
  } catch {
    return undefined;
  }
};

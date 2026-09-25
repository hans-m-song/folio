import { createHash, timingSafeEqual } from "node:crypto";

export const localAdministratorEmail = "local-admin@folio.invalid";

export const localPasswordMatches = (
  supplied: string,
  expected: string,
): boolean => {
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
};

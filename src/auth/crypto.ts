import { createHash, randomBytes } from "node:crypto";

export const randomOpaqueToken = (): string =>
  randomBytes(32).toString("base64url");

export const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

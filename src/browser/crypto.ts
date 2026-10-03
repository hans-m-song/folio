import { sha256 } from "@noble/hashes/sha2.js";

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
};

export const sha256Base64 = async (bytes: Uint8Array): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return base64(sha256(bytes));

  const ownedBytes = new Uint8Array(bytes);
  return base64(new Uint8Array(await subtle.digest("SHA-256", ownedBytes)));
};

export const sha256FileBase64 = async (file: File): Promise<string> =>
  sha256Base64(new Uint8Array(await file.arrayBuffer()));

export const randomUuid = (): string => {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function") {
    throw new Error(
      "Secure random UUID generation is unavailable because crypto.getRandomValues is not supported.",
    );
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

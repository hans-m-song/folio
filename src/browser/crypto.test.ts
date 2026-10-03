import { afterEach, describe, expect, it, vi } from "vitest";

import { randomUuid, sha256Base64, sha256FileBase64 } from "./crypto";

const encoder = new TextEncoder();
const multiBlockBacking = Uint8Array.from(
  { length: 140 },
  (_, index) => (index * 73 + 19) % 256,
);
const multiBlockView = multiBlockBacking.subarray(3, 131);
const hashVectors = [
  {
    name: "empty bytes",
    bytes: new Uint8Array(),
    digest: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  },
  {
    name: "ASCII text",
    bytes: encoder.encode("abc"),
    digest: "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
  },
  {
    name: "a binary multi-block nonzero-offset view",
    bytes: multiBlockView,
    digest: "I0ZbJ3qNVs15SFAtZGvBNY1fqMRSrcXTXeE237YM5uw=",
  },
] as const;

afterEach(() => vi.unstubAllGlobals());

describe("sha256Base64", () => {
  it("uses native Web Crypto for fixed vectors", async () => {
    const nativeSubtle = globalThis.crypto?.subtle;
    expect(nativeSubtle).toBeDefined();
    vi.stubGlobal("crypto", { subtle: nativeSubtle });

    for (const vector of hashVectors) {
      await expect(sha256Base64(vector.bytes)).resolves.toBe(vector.digest);
    }
  });

  it("uses the bundled SHA-256 when Web Crypto subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {});

    for (const vector of hashVectors) {
      await expect(sha256Base64(vector.bytes)).resolves.toBe(vector.digest);
    }
  });

  it("does not hide native digest failures", async () => {
    const failure = new Error("native digest failed");
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockRejectedValue(failure) },
    });

    await expect(sha256Base64(encoder.encode("abc"))).rejects.toBe(failure);
  });
});

describe("sha256FileBase64", () => {
  it("hashes file bytes when Web Crypto subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {});

    const file = new File([encoder.encode("abc")], "abc.bin");
    await expect(sha256FileBase64(file)).resolves.toBe(
      "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );
  });
});

describe("randomUuid", () => {
  it("uses the native UUID implementation when available", () => {
    const randomUUID = vi.fn(() => "native-uuid");
    vi.stubGlobal("crypto", { randomUUID });

    expect(randomUuid()).toBe("native-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a secure RFC 4122 version 4 UUID when native UUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Uint8Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const uuid = randomUuid();
    expect(uuid).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(uuid).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("reports when secure random number generation is unavailable", () => {
    vi.stubGlobal("crypto", {});

    expect(() => randomUuid()).toThrow("crypto.getRandomValues");
  });
});

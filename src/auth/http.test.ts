import { describe, expect, it } from "vitest";

import {
  clearedSessionCookie,
  cookieValue,
  safeReturnPath,
  sessionCookie,
} from "./http";

describe("authentication HTTP boundaries", () => {
  it("accepts only same-origin relative return paths", () => {
    const origin = "https://folio.buildsight.com.au";
    expect(safeReturnPath("/reports?period=2026", origin)).toBe(
      "/reports?period=2026",
    );
    expect(safeReturnPath("//attacker.example/path", origin)).toBe("/");
    expect(safeReturnPath("https://attacker.example/path", origin)).toBe("/");
    expect(safeReturnPath(null, origin)).toBe("/");
  });

  it("uses distinct secure production and insecure development cookies", () => {
    expect(
      sessionCookie({
        name: "__Host-folio_session",
        value: "opaque",
        secure: true,
        maxAgeSeconds: 43_200,
      }),
    ).toBe(
      "__Host-folio_session=opaque; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure",
    );
    expect(
      sessionCookie({
        name: "folio_dev_session",
        value: "opaque",
        secure: false,
        maxAgeSeconds: 43_200,
      }),
    ).not.toContain("Secure");
    expect(clearedSessionCookie("__Host-folio_session", true)).toContain(
      "Max-Age=0; Secure",
    );
  });

  it("reads only the named cookie", () => {
    const request = new Request("https://folio.buildsight.com.au", {
      headers: { cookie: "other=one; folio_dev_session=opaque-token" },
    });
    expect(cookieValue(request, "folio_dev_session")).toBe("opaque-token");
    expect(cookieValue(request, "missing")).toBeNull();
  });
});

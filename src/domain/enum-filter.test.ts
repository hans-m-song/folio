import { describe, expect, it } from "vitest";
import { z } from "zod";
import { enumFilterSchema } from "./enum-filter";

describe("enum filter validation", () => {
  const schema = enumFilterSchema("state", z.enum(["available", "rejected"]));
  it("preserves legacy scalar filters and deduplicates exact membership", () => {
    expect(
      schema.parse({ field: "state", operator: "is", value: "available" })
        .value,
    ).toBe("available");
    expect(
      schema.parse({
        field: "state",
        operator: "contains_any",
        value: ["available", "rejected", "available"],
      }).value,
    ).toEqual(["available", "rejected"]);
  });
  it.each([
    { operator: "contains_any", value: [] },
    { operator: "contains_any", value: ["unknown"] },
    { operator: "contains_none", value: Array(21).fill("available") },
    { operator: "is", value: ["available"] },
    { operator: "contains_any", value: "available" },
  ])("rejects invalid enum or operator/value shape: %j", (filter) => {
    expect(schema.safeParse({ field: "state", ...filter }).success).toBe(false);
  });
});

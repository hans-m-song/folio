import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { runAddUser } from "./add-user";

describe("runAddUser", () => {
  it.each([
    ["help", ["--help"], 0],
    ["invalid arguments", ["--email", "operator@example.test", "extra"], 1],
  ])(
    "does not load configuration or create a pool for %s",
    async (_name, arguments_, expectedCode) => {
      const configLoader = vi.fn();
      const poolFactory = vi.fn();
      const output = vi.fn();
      const error = vi.fn();

      await expect(
        runAddUser({
          arguments_,
          configLoader,
          poolFactory,
          output,
          error,
        }),
      ).resolves.toBe(expectedCode);

      expect(configLoader).not.toHaveBeenCalled();
      expect(poolFactory).not.toHaveBeenCalled();
      expect(
        [...output.mock.calls.flat(), ...error.mock.calls.flat()].join(" "),
      ).not.toContain("operator@example.test");
    },
  );

  it("inserts the normalized fields as query parameters", async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const end = vi.fn().mockResolvedValue(undefined);
    const configLoader = vi.fn(
      () => ({ databaseUrl: "unused", databaseSchema: "folio" }) as never,
    );
    const poolFactory = vi.fn(() => ({ query, end }) as unknown as Pool);
    const output = vi.fn();
    const error = vi.fn();

    await expect(
      runAddUser({
        arguments_: [
          "--email",
          " operator@example.test ",
          "--role",
          "administrator",
          "--display-name",
          " Example Operator ",
        ],
        environment: {},
        configLoader,
        poolFactory,
        output,
        error,
      }),
    ).resolves.toBe(0);

    expect(query).toHaveBeenCalledWith(
      'INSERT INTO "folio"."users" (email, display_name, role) VALUES ($1, $2, $3)',
      ["operator@example.test", "Example Operator", "administrator"],
    );
    expect(end).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith("Folio user created.\n");
    expect(error).not.toHaveBeenCalled();
  });

  it("does not print supplied values when the database operation fails", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new Error("failed for operator@example.test"));
    const end = vi.fn().mockResolvedValue(undefined);
    const configLoader = vi.fn(
      () => ({ databaseUrl: "unused", databaseSchema: "folio" }) as never,
    );
    const poolFactory = vi.fn(() => ({ query, end }) as unknown as Pool);
    const output = vi.fn();
    const error = vi.fn();
    await expect(
      runAddUser({
        arguments_: ["--email", "operator@example.test"],
        environment: {},
        configLoader,
        poolFactory,
        output,
        error,
      }),
    ).resolves.toBe(1);

    expect(end).toHaveBeenCalledOnce();
    expect(output).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Unable to create Folio user.\n");
  });
});

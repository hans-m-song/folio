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
    const diagnostic = vi.fn();

    await expect(
      runAddUser({
        arguments_: ["--email", "operator@example.test"],
        environment: {},
        configLoader,
        poolFactory,
        output,
        error,
        diagnostic,
      }),
    ).resolves.toBe(1);

    expect(end).toHaveBeenCalledOnce();
    expect(output).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Unable to create Folio user.\n");
  });

  it("logs configuration causes while keeping the user-facing failure generic", async () => {
    const diagnostic = vi.fn();
    const output = vi.fn();
    const error = vi.fn();

    await expect(
      runAddUser({
        arguments_: ["--email", "operator@example.test"],
        environment: {},
        configLoader: vi.fn(() => {
          throw new Error("synthetic invalid database configuration");
        }),
        poolFactory: vi.fn(),
        output,
        error,
        diagnostic,
      }),
    ).resolves.toBe(1);

    const event = JSON.parse(diagnostic.mock.calls[0]?.[0] as string);
    expect(event).toMatchObject({
      operation: "add_user",
      stage: "configuration",
      message: "synthetic invalid database configuration",
    });
    expect(error).toHaveBeenCalledWith("Unable to create Folio user.\n");
    expect(output).not.toHaveBeenCalled();
  });

  it("logs query and pool-close causes without exposing them in user output", async () => {
    const queryError = new Error("synthetic insert failure");
    const closeError = new Error("synthetic pool close failure");
    const diagnostic = vi.fn();
    const error = vi.fn();
    const query = vi.fn().mockRejectedValue(queryError);
    const end = vi.fn().mockRejectedValue(closeError);
    const configLoader = vi.fn(
      () => ({ databaseUrl: "unused", databaseSchema: "folio" }) as never,
    );

    await expect(
      runAddUser({
        arguments_: ["--email", "operator@example.test"],
        environment: {},
        configLoader,
        poolFactory: vi.fn(() => ({ query, end }) as unknown as Pool),
        error,
        diagnostic,
      }),
    ).resolves.toBe(1);

    const event = JSON.parse(diagnostic.mock.calls[0]?.[0] as string);
    expect(event).toMatchObject({
      operation: "add_user",
      stage: "pool_close",
      message: "synthetic insert failure",
    });
    expect(event.cleanupFailures).toMatchObject([
      { message: "synthetic pool close failure" },
    ]);
    expect(error).toHaveBeenCalledWith("Unable to create Folio user.\n");
    expect(error.mock.calls.flat().join(" ")).not.toContain("synthetic");
  });

  it("reports a pool-close failure after a successful insert", async () => {
    const diagnostic = vi.fn();
    const error = vi.fn();
    const query = vi.fn().mockResolvedValue(undefined);
    const end = vi.fn().mockRejectedValue(new Error("synthetic close failure"));
    const configLoader = vi.fn(
      () => ({ databaseUrl: "unused", databaseSchema: "folio" }) as never,
    );

    await expect(
      runAddUser({
        arguments_: ["--email", "operator@example.test"],
        environment: {},
        configLoader,
        poolFactory: vi.fn(() => ({ query, end }) as unknown as Pool),
        error,
        diagnostic,
      }),
    ).resolves.toBe(1);

    const event = JSON.parse(diagnostic.mock.calls[0]?.[0] as string);
    expect(event).toMatchObject({
      operation: "add_user",
      stage: "pool_close",
      message: "synthetic close failure",
    });
    expect(error).toHaveBeenCalledWith("Unable to create Folio user.\n");
  });
});

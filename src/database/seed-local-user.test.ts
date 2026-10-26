import { describe, expect, it, vi } from "vitest";

import type { loadAuthConfig, loadConfig } from "../config";
import { runSeedLocalUser } from "./seed-local-user";

describe("local administrator seeding CLI", () => {
  it("formats configuration failures without exposing configuration values", async () => {
    const error = vi.fn();
    const poolFactory = vi.fn();

    const exitCode = await runSeedLocalUser({
      environment: {},
      poolFactory,
      error,
    });

    expect(exitCode).toBe(1);
    expect(poolFactory).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const event = JSON.parse(error.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      event: "folio.operation",
      operation: "seed_local_user",
      stage: "configuration",
      phase: "failure",
      code: "INPUT_INVALID",
    });
    expect(JSON.stringify(event)).not.toContain("FOLIO_DATABASE_URL");
  });

  it("links cleanup failure without replacing the primary seed failure", async () => {
    const error = vi.fn();
    const pool = {
      query: vi.fn(async () => {
        throw new Error("private database detail");
      }),
      end: vi.fn(async () => {
        throw new Error("private cleanup detail");
      }),
    };
    const exitCode = await runSeedLocalUser({
      environment: {},
      configLoader: () =>
        ({
          databaseUrl: "postgres://synthetic.invalid/folio",
          databaseSchema: "folio",
          gstRegistered: false,
        }) as ReturnType<typeof loadConfig>,
      authConfigLoader: () =>
        ({ authMode: "local", nodeEnv: "development" }) as ReturnType<
          typeof loadAuthConfig
        >,
      poolFactory: () => pool as never,
      error,
    });

    expect(exitCode).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    const event = JSON.parse(error.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      stage: "seed",
      code: "UNEXPECTED_ERROR",
      cleanupFailures: [
        {
          stage: "close",
          code: "UNEXPECTED_ERROR",
        },
      ],
    });
    expect(JSON.stringify(event)).toContain("private database detail");
    expect(JSON.stringify(event)).toContain("private cleanup detail");
  });
});

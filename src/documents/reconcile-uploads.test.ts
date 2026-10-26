import { describe, expect, it, vi } from "vitest";

import { runReconcileUploads } from "./reconcile-uploads";

describe("upload reconciliation CLI", () => {
  it("reports parse failures without echoing options", async () => {
    const error = vi.fn();
    const poolFactory = vi.fn();

    const exitCode = await runReconcileUploads({
      arguments_: ["--actor-email", "private@example.test", "--unknown"],
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
      operation: "reconcile_uploads",
      stage: "arguments",
      phase: "failure",
      code: "UNEXPECTED_ERROR",
    });
    expect(JSON.stringify(event)).not.toContain("private@example.test");
    expect(JSON.stringify(event)).not.toContain("--unknown");
    expect(JSON.stringify(event)).toContain("Input parsing failed.");
  });

  it("links pool cleanup failure to the primary reconciliation failure", async () => {
    const error = vi.fn();
    const pool = {
      query: vi.fn(async () => {
        throw new Error("private query detail");
      }),
      end: vi.fn(async () => {
        throw new Error("private close detail");
      }),
    };
    const exitCode = await runReconcileUploads({
      arguments_: [],
      environment: {},
      configLoader: () =>
        ({
          databaseUrl: "postgres://synthetic.invalid/folio",
          databaseSchema: "folio",
          gstRegistered: false,
          s3Region: "us-east-1",
          s3Bucket: "folio-test",
        }) as never,
      poolFactory: () => pool as never,
      storageFactory: () => ({}) as never,
      output: () => undefined,
      error,
    });

    expect(exitCode).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    const event = JSON.parse(error.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      stage: "reconcile",
      mutation: false,
      code: "UNEXPECTED_ERROR",
      cleanupFailures: [
        {
          stage: "close",
          code: "UNEXPECTED_ERROR",
        },
      ],
    });
    expect(JSON.stringify(event)).toContain("private query detail");
    expect(JSON.stringify(event)).toContain("private close detail");
  });

  it("passes the assumed-role provider to its S3 client without resolving it", async () => {
    const client = { destroy: vi.fn() };
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => undefined),
    };
    const s3ClientFactory = vi.fn((_options: unknown) => client as never);
    const exitCode = await runReconcileUploads({
      arguments_: [],
      environment: {},
      configLoader: () =>
        ({
          databaseUrl: "postgres://synthetic.invalid/folio",
          databaseSchema: "folio",
          gstRegistered: false,
          s3Region: "ap-southeast-2",
          awsAssumeRoleArn: "arn:aws:iam::123456789012:role/folio",
          s3Bucket: "folio-test",
        }) as never,
      poolFactory: () => pool as never,
      s3ClientFactory,
      storageFactory: () => ({}) as never,
      output: () => undefined,
      error: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(s3ClientFactory).toHaveBeenCalledTimes(1);
    expect(s3ClientFactory.mock.calls[0]?.[0]).toMatchObject({
      region: "ap-southeast-2",
      credentials: expect.any(Function),
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});

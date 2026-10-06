import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fromTemporaryCredentials: vi.fn(),
}));

vi.mock("@aws-sdk/credential-providers", () => mocks);

import { createS3CredentialsProvider } from "./credentials";

describe("S3 credentials provider", () => {
  beforeEach(() => {
    mocks.fromTemporaryCredentials.mockReset();
  });

  it("keeps the default AWS credential chain when no role is configured", () => {
    expect(createS3CredentialsProvider(null, "ap-southeast-2")).toBeUndefined();
    expect(createS3CredentialsProvider("  ", "ap-southeast-2")).toBeUndefined();
    expect(mocks.fromTemporaryCredentials).not.toHaveBeenCalled();
  });

  it("assumes the configured role in the S3 region", () => {
    const provider = vi.fn();
    mocks.fromTemporaryCredentials.mockReturnValue(provider);

    expect(
      createS3CredentialsProvider(
        " arn:aws:iam::123456789012:role/folio ",
        "ap-southeast-2",
      ),
    ).toBe(provider);
    expect(mocks.fromTemporaryCredentials).toHaveBeenCalledWith({
      params: {
        RoleArn: "arn:aws:iam::123456789012:role/folio",
        RoleSessionName: "folio",
      },
      clientConfig: { region: "ap-southeast-2" },
    });
  });
});

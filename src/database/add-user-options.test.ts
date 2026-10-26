import { describe, expect, it } from "vitest";

import { addUserUsage, parseAddUserOptions } from "./add-user-options";

describe("parseAddUserOptions", () => {
  it("parses required named email and optional role and display name", () => {
    expect(
      parseAddUserOptions([
        "--email",
        "  operator@example.test ",
        "--role",
        "viewer",
        "--display-name",
        "  Example Operator  ",
      ]),
    ).toEqual({
      action: "insert",
      input: {
        email: "operator@example.test",
        role: "viewer",
        displayName: "Example Operator",
      },
    });
  });

  it("defaults the role to member and blank display names to null", () => {
    expect(
      parseAddUserOptions([
        "--email=operator@example.test",
        "--display-name",
        "  ",
      ]),
    ).toEqual({
      action: "insert",
      input: {
        email: "operator@example.test",
        role: "member",
        displayName: null,
      },
    });
  });

  it("uses null when display name is omitted", () => {
    expect(parseAddUserOptions(["--email", "operator@example.test"])).toEqual({
      action: "insert",
      input: {
        email: "operator@example.test",
        role: "member",
        displayName: null,
      },
    });
  });

  it("returns help without requiring the email flag", () => {
    expect(parseAddUserOptions(["--help"])).toEqual({ action: "help" });
    expect(addUserUsage()).toContain("Usage: pnpm user:add --email <email>");
  });

  it.each([
    ["positional arguments", ["operator@example.test"]],
    ["unknown flags", ["--email", "operator@example.test", "--unknown"]],
    ["missing email", []],
    ["invalid email", ["--email", "not-an-email"]],
    ["invalid role", ["--email", "operator@example.test", "--role", "owner"]],
    [
      "overlong display name",
      ["--email", "operator@example.test", "--display-name", "x".repeat(201)],
    ],
  ])("rejects %s", (_description, arguments_) => {
    expect(() => parseAddUserOptions(arguments_)).toThrow(
      "Invalid user:add arguments. Use --help for usage.",
    );
  });
});

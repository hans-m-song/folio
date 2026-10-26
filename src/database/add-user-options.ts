import { parseArgs } from "node:util";
import { z } from "zod";

import { userRoleSchema } from "../domain/types";

const addUserInputSchema = z.object({
  email: z.string().trim().email(),
  role: userRoleSchema,
  displayName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((displayName) => displayName || null),
});

export type AddUserCommand =
  | { action: "help" }
  | { action: "insert"; input: z.infer<typeof addUserInputSchema> };

export const addUserUsage = () =>
  [
    "Usage: pnpm user:add --email <email> [--role <role>] [--display-name <name>]",
    "",
    "Options:",
    "  --email <email>         Required email address",
    `  --role <role>           User role: ${userRoleSchema.options.join(", ")} (default: member)`,
    "  --display-name <name>   Optional display name (maximum 200 characters)",
    "  --help                  Show this help",
  ].join("\n");

export const parseAddUserOptions = (arguments_: string[]): AddUserCommand => {
  try {
    const parsed = parseArgs({
      args: arguments_,
      allowPositionals: false,
      strict: true,
      options: {
        email: { type: "string" },
        role: { type: "string" },
        "display-name": { type: "string" },
        help: { type: "boolean" },
      },
    });

    if (parsed.values.help) return { action: "help" };

    const input = addUserInputSchema.parse({
      email: parsed.values.email,
      role: parsed.values.role ?? "member",
      displayName: parsed.values["display-name"],
    });

    return { action: "insert", input };
  } catch {
    throw new Error("Invalid user:add arguments. Use --help for usage.");
  }
};

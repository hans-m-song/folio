import { ZodError } from "zod";

const databaseMessages: Record<string, string> = {
  "28P01": "Database authentication failed.",
  "42P01": "Required database table is missing; apply Folio migrations.",
  "42501": "Database role lacks permission for this operation.",
  "42601": "Database rejected a migration statement.",
  "23503": "A referenced record does not exist.",
  "23505": "A conflicting record already exists.",
  "23514": "A database constraint rejected the input.",
  ECONNREFUSED: "Database connection was refused.",
  ENOTFOUND: "Database host could not be resolved.",
  ENOENT: "A required migration file is missing.",
};

const safeErrorCode = (error: unknown) => {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  const code = error.code;
  return typeof code === "string" && /^[A-Z0-9]{2,16}$/.test(code)
    ? code
    : undefined;
};

const credentialEligibilityMessages = {
  administrator: {
    not_found: "Administrator ID was not found in the CLI database.",
    inactive: "Administrator user is inactive.",
    wrong_role: "Administrator user does not have the administrator role.",
    not_distinct: "Administrator must be distinct from the actor.",
  },
  actor: {
    not_found: "Actor ID was not found in the CLI database.",
    inactive: "Actor user is inactive.",
    wrong_role: "Actor must have the member or administrator role.",
    not_distinct: "Actor must be distinct from the administrator and owner.",
  },
  owner: {
    not_found: "Owner ID was not found in the CLI database.",
    inactive: "Owner user is inactive.",
    wrong_role: "Owner role is not permitted.",
    not_distinct: "Owner must be distinct from the actor.",
  },
} as const;

const credentialEligibility = (error: Error) => {
  if (error.name !== "ProposalCredentialEligibilityError") return undefined;
  const participant = (error as Error & { participant?: unknown }).participant;
  const reason = (error as Error & { reason?: unknown }).reason;
  if (
    typeof participant !== "string" ||
    !(participant in credentialEligibilityMessages) ||
    typeof reason !== "string"
  )
    return undefined;
  const messages =
    credentialEligibilityMessages[
      participant as keyof typeof credentialEligibilityMessages
    ];
  if (!(reason in messages)) return undefined;
  return {
    code: `${participant.toUpperCase()}_${reason.toUpperCase()}`,
    message: messages[reason as keyof typeof messages],
  };
};

export const formatDatabaseCliFailure = (
  operation: "migrate" | "mcp_credential",
  stage: string,
  error: unknown,
) => {
  if (error instanceof ZodError) {
    const fields = [
      ...new Set(error.issues.map((issue) => issue.path.join("."))),
    ]
      .filter(Boolean)
      .sort()
      .join(", ");
    return `operation=${operation} stage=${stage} code=INVALID_INPUT message="Check ${fields || "command input"}."`;
  }
  if (operation === "mcp_credential" && stage === "arguments")
    return `operation=${operation} stage=${stage} code=INVALID_ARGUMENTS message="Use scopes, create, or revoke with the required named options."`;
  const eligibility = error instanceof Error && credentialEligibility(error);
  if (eligibility)
    return `operation=${operation} stage=${stage} code=${eligibility.code} message="${eligibility.message}"`;
  if (error instanceof Error && error.name === "ProposalAuthorizationError")
    return `operation=${operation} stage=${stage} code=USER_INELIGIBLE message="Check that the administrator is active with the administrator role, the dedicated actor is active with a member or administrator role, and the owner is active."`;

  const code = safeErrorCode(error);
  if (code)
    return `operation=${operation} stage=${stage} code=${code} message="${databaseMessages[code] ?? "Database operation failed; inspect the code and stage."}"`;

  return `operation=${operation} stage=${stage} code=UNEXPECTED_ERROR message="Operation failed; no sensitive error details were printed."`;
};

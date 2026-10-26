import { parseWithDiagnostics } from "../domain/validation-diagnostics";
import { validateInput } from "./input-validation";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { ProposalCredentialScopesConflictError } from "../database/proposal-repository";
import { AppError } from "../domain/errors";
import {
  expandCredentialScopes,
  generateCredentialSecret,
  proposalCredentialInputSchema,
  proposalCredentialScopeUpdateSchema,
} from "../domain/proposals";
import { permissions, resolveAuthorizedActor } from "./authorization";
import { runOperation } from "./diagnostics";
import { setDiagnosticContext } from "./error-handling";
import { runtime } from "./runtime";

const scopePatternSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      return expandCredentialScopes([value]).length > 0;
    } catch {
      return false;
    }
  });

const createInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    actorUserId: z.string().uuid(),
    defaultOwnerId: z.string().uuid(),
    scopes: z.array(scopePatternSchema).min(1).max(50),
  })
  .strict();

const revokeInputSchema = z
  .object({ credentialId: z.string().uuid() })
  .strict();

const updateCredentialScopesInputSchema = z
  .object({
    credentialId: z.string().uuid(),
    scopes: proposalCredentialScopeUpdateSchema,
    expectedScopes: proposalCredentialScopeUpdateSchema,
  })
  .strict();

const authorizeAdministrator = async () => {
  const current = runtime();
  const actor = await resolveAuthorizedActor({
    token: getCookie(current.authConfig.sessionCookieName) ?? null,
    permission: permissions.userAdmin,
    session: (token) => current.auth.session(token),
  });
  setDiagnosticContext({ ids: { actorId: actor.id } });
  return { current, actor };
};

export const listMcpCredentials = createServerFn({ method: "GET" }).handler(
  async () =>
    runOperation("List access tokens", async () => {
      const { current, actor } = await authorizeAdministrator();
      return current.proposalRepository.listCredentials(actor.id);
    }),
);

export const createMcpCredential = createServerFn({ method: "POST" })
  .validator(validateInput(createInputSchema))
  .handler(async ({ data }) =>
    runOperation(
      "Create access token",
      async () => {
        const { current, actor } = await authorizeAdministrator();
        const secret = generateCredentialSecret();
        const credential = await current.proposalRepository.createCredential(
          actor.id,
          parseWithDiagnostics(proposalCredentialInputSchema, {
            label: data.label,
            actorUserId: data.actorUserId,
            defaultOwnerId: data.defaultOwnerId,
            scopes: expandCredentialScopes(data.scopes),
            tokenHash: secret.tokenHash,
          }),
        );
        setDiagnosticContext({ ids: { credentialId: credential.id } });
        return { credential, token: secret.token };
      },
      {},
      { mutation: true },
    ),
  );

export const revokeMcpCredential = createServerFn({ method: "POST" })
  .validator(validateInput(revokeInputSchema))
  .handler(async ({ data }) =>
    runOperation(
      "Revoke access token",
      async () => {
        const { current, actor } = await authorizeAdministrator();
        await current.proposalRepository.revokeCredential(
          actor.id,
          data.credentialId,
        );
        return { revoked: true as const };
      },
      {},
      { mutation: true },
    ),
  );

export const updateMcpCredentialScopes = createServerFn({ method: "POST" })
  .validator(validateInput(updateCredentialScopesInputSchema))
  .handler(async ({ data }) =>
    runOperation(
      "Update access token scopes",
      async () => {
        const { current, actor } = await authorizeAdministrator();
        setDiagnosticContext({ ids: { credentialId: data.credentialId } });
        try {
          return await current.proposalRepository.updateCredentialScopes(
            actor.id,
            data.credentialId,
            data.scopes,
            data.expectedScopes,
          );
        } catch (error) {
          if (error instanceof ProposalCredentialScopesConflictError)
            throw new AppError({ code: "REVISION_CONFLICT", cause: error });
          throw error;
        }
      },
      {},
      { mutation: true },
    ),
  );

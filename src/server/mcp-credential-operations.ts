import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  expandCredentialScopes,
  generateCredentialSecret,
  proposalCredentialInputSchema,
} from "../domain/proposals";
import { permissions, resolveAuthorizedActor } from "./authorization";
import { runOperation } from "./diagnostics";
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

const authorizeAdministrator = async () => {
  const current = runtime();
  const actor = await resolveAuthorizedActor({
    token: getCookie(current.authConfig.sessionCookieName) ?? null,
    permission: permissions.userAdmin,
    session: (token) => current.auth.session(token),
  });
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
  .validator(createInputSchema)
  .handler(async ({ data }) =>
    runOperation(
      "Create access token",
      async () => {
        const { current, actor } = await authorizeAdministrator();
        const secret = generateCredentialSecret();
        const credential = await current.proposalRepository.createCredential(
          actor.id,
          proposalCredentialInputSchema.parse({
            label: data.label,
            actorUserId: data.actorUserId,
            defaultOwnerId: data.defaultOwnerId,
            scopes: expandCredentialScopes(data.scopes),
            tokenHash: secret.tokenHash,
          }),
        );
        return { credential, token: secret.token };
      },
      {},
      { mutation: true },
    ),
  );

export const revokeMcpCredential = createServerFn({ method: "POST" })
  .validator(revokeInputSchema)
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

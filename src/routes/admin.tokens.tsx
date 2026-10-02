import { AutocompleteSelect } from "../components/autocomplete";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { getCurrentSession } from "../auth/session-server";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import type { ProposalCredentialRecord } from "../database/proposal-repository";
import type { User } from "../domain/types";
import { hasPermission, permissions } from "../server/authorization";
import {
  createMcpCredential,
  listMcpCredentials,
  revokeMcpCredential,
} from "../server/mcp-credential-operations";
import { listUsers } from "../server/operations";
import "../styles/admin.css";

const scopeOptions = [
  { value: "*", label: "All current scopes" },
  { value: "transactions:*", label: "All current transaction scopes" },
  { value: "artifacts:*", label: "All current artifact scopes" },
  { value: "transactions:search", label: "Search transactions" },
  { value: "transactions:draft", label: "Create and edit own drafts" },
  { value: "transactions:categorize", label: "Categorize any transaction" },
  { value: "bank_rows:read", label: "Read bank rows" },
  { value: "bank_matches:suggest", label: "Suggest bank matches" },
  { value: "artifacts:read", label: "Read artifact metadata" },
  { value: "artifacts:upload", label: "Upload artifacts for review" },
] as const;

type CreatedCredential = {
  token: string;
  credential: ProposalCredentialRecord;
};

export const Route = createFileRoute("/admin/tokens")({
  loader: async () => {
    const session = await getCurrentSession();
    if (
      !session.authenticated ||
      !hasPermission(session.user.role, permissions.userAdmin)
    )
      return {
        allowed: false as const,
        administratorId: null,
        users: [] as User[],
        credentials: [] as ProposalCredentialRecord[],
      };

    const [users, credentials] = await Promise.all([
      listUsers(),
      listMcpCredentials(),
    ]);
    return {
      allowed: true as const,
      administratorId: session.user.id,
      users,
      credentials,
    };
  },
  component: AccessTokensPage,
});

const userLabel = (user: User): string =>
  `${user.displayName?.trim() || user.email} (${user.role})`;

export function AccessTokensPage() {
  const { allowed, administratorId, users, credentials } =
    Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<CreatedCredential | null>(null);
  const [revoking, setRevoking] = useState<ProposalCredentialRecord | null>(
    null,
  );
  const [revokeError, setRevokeError] = useState("");

  if (!allowed)
    return (
      <main className="admin-page">
        <h1>Access tokens</h1>
        <p>Token administration is unavailable for this session.</p>
      </main>
    );

  const activeUsers = users.filter((user) => user.active);
  const actors = activeUsers.filter((user) => user.id !== administratorId);
  const userById = new Map(users.map((user) => [user.id, user]));

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const scopes = data
      .getAll("scope")
      .map(String)
      .filter((value): value is (typeof scopeOptions)[number]["value"] =>
        scopeOptions.some((scope) => scope.value === value),
      );
    if (scopes.length === 0) {
      setMessage("Select at least one scope.");
      return;
    }
    setBusy(true);
    setMessage("");
    setCreated(null);
    try {
      const result = await createMcpCredential({
        data: {
          label: String(data.get("label") ?? ""),
          actorUserId: String(data.get("actorUserId") ?? ""),
          defaultOwnerId: String(data.get("defaultOwnerId") ?? ""),
          scopes,
        },
      });
      setCreated(result);
      form.reset();
      await router.invalidate();
      setMessage("Token created. Copy it now; it cannot be shown again.");
    } catch {
      setMessage("Could not create the token. Check the users and scopes.");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setMessage("Token copied. Store it securely.");
    } catch {
      setMessage("Could not copy the token. Copy it from this page now.");
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setRevokeError("");
    try {
      await revokeMcpCredential({ data: { credentialId: revoking.id } });
      await router.invalidate();
      setRevoking(null);
      setMessage("Token revoked.");
    } catch {
      setRevokeError("Could not revoke the token. Reload and retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-page">
      <header>
        <h1>Access tokens</h1>
        <p>Manage credentials used by local integrations.</p>
      </header>
      <section aria-labelledby="create-token-heading">
        <h2 id="create-token-heading">Create token</h2>
        <p>
          Wildcards include only scopes available now. Existing tokens do not
          gain future permissions.
        </p>
        <form
          className="admin-token-form"
          onSubmit={(event) => void create(event)}
        >
          <label>
            Label
            <input name="label" required maxLength={200} />
          </label>
          <label>
            Dedicated actor
            <AutocompleteSelect
              aria-label="Dedicated actor"
              name="actorUserId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose an active user
              </option>
              {actors.map((user) => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                </option>
              ))}
            </AutocompleteSelect>
          </label>
          <label>
            Default owner
            <AutocompleteSelect
              aria-label="Default owner"
              name="defaultOwnerId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose an active user
              </option>
              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                </option>
              ))}
            </AutocompleteSelect>
          </label>
          <fieldset className="admin-token-scopes">
            <legend>Scopes</legend>
            {scopeOptions.map((scope) => (
              <label key={scope.value}>
                <input type="checkbox" name="scope" value={scope.value} />
                {scope.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={busy || actors.length === 0}>
            Create token
          </button>
        </form>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {created && (
          <div
            className="admin-token-reveal"
            role="group"
            aria-label="New token"
          >
            <p>Copy this token now. Folio will not display it again.</p>
            <code>{created.token}</code>
            <div className="admin-token-reveal-actions">
              <button type="button" onClick={() => void copyToken()}>
                Copy token
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setCreated(null)}
              >
                Dismiss token
              </button>
            </div>
          </div>
        )}
      </section>
      <section aria-labelledby="issued-tokens-heading">
        <h2 id="issued-tokens-heading">Issued tokens</h2>
        {credentials.length === 0 ? (
          <p>No tokens issued.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Label</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Default owner</th>
                  <th scope="col">Scopes</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr key={credential.id}>
                    <th scope="row">{credential.label}</th>
                    <td>
                      {userById.get(credential.actorUserId)
                        ? userLabel(userById.get(credential.actorUserId)!)
                        : credential.actorUserId}
                    </td>
                    <td>
                      {userById.get(credential.defaultOwnerId)
                        ? userLabel(userById.get(credential.defaultOwnerId)!)
                        : credential.defaultOwnerId}
                    </td>
                    <td>{credential.scopes.join(", ")}</td>
                    <td>{credential.createdAt}</td>
                    <td>{credential.revokedAt ? "Revoked" : "Active"}</td>
                    <td>
                      {!credential.revokedAt && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRevokeError("");
                            setRevoking(credential);
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {revoking && (
        <ConfirmationDialog
          title="Revoke access token?"
          description={`${revoking.label} will stop authenticating immediately. This cannot be undone.`}
          confirmLabel="Revoke token"
          pending={busy}
          error={revokeError}
          onCancel={() => setRevoking(null)}
          onConfirm={() => void revoke()}
        />
      )}
    </main>
  );
}

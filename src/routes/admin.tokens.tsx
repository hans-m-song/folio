import { AutocompleteSelect } from "../components/autocomplete";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { getCurrentSession } from "../auth/session-server";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import type { ProposalCredentialRecord } from "../database/proposal-repository";
import type { ProposalCredentialScope } from "../domain/proposals";
import type { User } from "../domain/types";
import { hasPermission, permissions } from "../server/authorization";
import {
  createMcpCredential,
  listMcpCredentials,
  revokeMcpCredential,
  updateMcpCredentialScopes,
} from "../server/mcp-credential-operations";
import { listUsers } from "../server/operations";
import "../styles/admin.css";

const concreteScopeOptions = [
  { value: "transactions:search", label: "Search transactions" },
  {
    value: "transactions:draft",
    label: "Create and edit any manual transaction drafts",
  },
  { value: "transactions:categorize", label: "Categorize any transaction" },
  { value: "bank_rows:read", label: "Read bank rows" },
  { value: "bank_matches:suggest", label: "Suggest bank matches" },
  { value: "artifacts:read", label: "Read artifact metadata" },
  { value: "artifacts:upload", label: "Upload artifacts for review" },
  { value: "artifacts:edit", label: "Edit artifact metadata" },
  {
    value: "artifacts:extract",
    label: "Extract PDF fields (reads file contents)",
  },
] as const satisfies readonly {
  value: ProposalCredentialScope;
  label: string;
}[];

const scopeOptions = [
  {
    value: "*",
    label:
      "All current scopes, including PDF field extraction (reads file contents)",
  },
  { value: "transactions:*", label: "All current transaction scopes" },
  {
    value: "artifacts:*",
    label:
      "All artifact scopes, including PDF field extraction (reads file contents)",
  },
  ...concreteScopeOptions,
] as const;

const legacySubmissionScopeOption = {
  value: "submissions:read",
  label: "Read submission outcomes (legacy: submissions:read)",
} as const satisfies {
  value: ProposalCredentialScope;
  label: string;
};

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
  const [copyFeedback, setCopyFeedback] = useState<{
    credential: CreatedCredential;
    message: string;
  } | null>(null);
  const createdRef = useRef<CreatedCredential | null>(null);
  const tokenElementRef = useRef<HTMLElement | null>(null);
  const [revoking, setRevoking] = useState<ProposalCredentialRecord | null>(
    null,
  );
  const [revokeError, setRevokeError] = useState("");
  const [editingScopes, setEditingScopes] =
    useState<ProposalCredentialRecord | null>(null);
  const [scopeUpdateError, setScopeUpdateError] = useState("");
  const [scopeUpdateBlocked, setScopeUpdateBlocked] = useState(false);

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
    createdRef.current = null;
    setCreated(null);
    setCopyFeedback(null);
    try {
      const result = await createMcpCredential({
        data: {
          label: String(data.get("label") ?? ""),
          actorUserId: String(data.get("actorUserId") ?? ""),
          defaultOwnerId: String(data.get("defaultOwnerId") ?? ""),
          scopes,
        },
      });
      createdRef.current = result;
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
    setCopyFeedback(null);

    try {
      const clipboard = navigator.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(created.token);
        if (createdRef.current !== created) return;
        setCopyFeedback({
          credential: created,
          message: "Token copied",
        });
        return;
      }
    } catch {
      if (createdRef.current !== created) return;
    }

    if (createdRef.current !== created) return;

    let tokenSelected = false;
    let copied = false;
    try {
      const tokenElement = tokenElementRef.current;
      const selection = window.getSelection();
      if (tokenElement?.isConnected && selection) {
        const range = document.createRange();
        range.selectNodeContents(tokenElement);
        selection.removeAllRanges();
        selection.addRange(range);
        tokenSelected = true;
        copied = document.execCommand("copy");
      }
    } catch {
      copied = false;
    }

    if (createdRef.current !== created) return;
    setCopyFeedback({
      credential: created,
      message: copied
        ? "Token copied"
        : tokenSelected
          ? "Could not copy automatically. The token is selected; press Cmd/Ctrl+C to copy it."
          : "Could not copy automatically. Select the token and press Cmd/Ctrl+C to copy it.",
    });
  };

  const dismissCreated = () => {
    createdRef.current = null;
    setCreated(null);
    setCopyFeedback(null);
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

  const saveScopes = async (scopes: ProposalCredentialScope[]) => {
    if (!editingScopes) return;
    setBusy(true);
    setScopeUpdateError("");
    setScopeUpdateBlocked(false);

    try {
      await updateMcpCredentialScopes({
        data: {
          credentialId: editingScopes.id,
          scopes,
          expectedScopes: [...editingScopes.scopes],
        },
      });
    } catch (error) {
      const isConflict =
        error instanceof Error && /\bREVISION_CONFLICT\b/.test(error.message);
      const message = isConflict
        ? "This token's scopes changed after editing began. Close and reload before editing again."
        : "Could not confirm that the scope changes were saved. Close and reload the token list before trying again.";
      setScopeUpdateError(message);
      setScopeUpdateBlocked(true);
      setBusy(false);
      return;
    }

    setEditingScopes(null);
    try {
      await router.invalidate({ sync: true });
      setMessage("Token scopes updated.");
    } catch {
      setMessage(
        "Token scopes were saved, but the list could not refresh. Do not resubmit; reload before editing again.",
      );
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
            <code ref={tokenElementRef}>{created.token}</code>
            <div className="admin-token-reveal-actions">
              <button type="button" onClick={() => void copyToken()}>
                Copy token
              </button>
              <button
                type="button"
                className="secondary"
                onClick={dismissCreated}
              >
                Dismiss token
              </button>
            </div>
            {copyFeedback?.credential === created && (
              <p
                className="admin-token-copy-toast"
                role="status"
                aria-live="polite"
              >
                {copyFeedback.message}
              </p>
            )}
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
                        <div className="admin-token-reveal-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setMessage("");
                              setScopeUpdateError("");
                              setScopeUpdateBlocked(false);
                              setEditingScopes(credential);
                            }}
                          >
                            Edit scopes
                          </button>
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
                        </div>
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
      {editingScopes && (
        <CredentialScopeDialog
          key={editingScopes.id}
          credential={editingScopes}
          pending={busy}
          error={scopeUpdateError}
          saveBlocked={scopeUpdateBlocked}
          onCancel={() => {
            setEditingScopes(null);
            if (scopeUpdateError) setMessage(scopeUpdateError);
          }}
          onSave={(scopes) => void saveScopes(scopes)}
        />
      )}
    </main>
  );
}

const CredentialScopeDialog = ({
  credential,
  pending,
  error,
  saveBlocked,
  onCancel,
  onSave,
}: {
  credential: ProposalCredentialRecord;
  pending: boolean;
  error: string;
  saveBlocked: boolean;
  onCancel: () => void;
  onSave: (scopes: ProposalCredentialScope[]) => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [selectionError, setSelectionError] = useState("");
  const scopeOptionsForCredential = [
    ...concreteScopeOptions,
    ...(credential.scopes.includes("submissions:read")
      ? [legacySubmissionScopeOption]
      : []),
  ];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    cancelButtonRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = new Set(
      new FormData(event.currentTarget).getAll("scope").map(String),
    );
    const scopes = scopeOptionsForCredential
      .filter((scope) => selected.has(scope.value))
      .map((scope) => scope.value);
    if (scopes.length === 0) {
      setSelectionError("Select at least one scope.");
      return;
    }
    setSelectionError("");
    onSave(scopes);
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-token-scopes-heading"
      aria-describedby="edit-token-scopes-description"
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id="edit-token-scopes-heading">Edit scopes for {credential.label}</h2>
      <p id="edit-token-scopes-description">
        Saved changes apply to subsequent requests. Its identity and secret stay
        the same.
      </p>
      <form className="admin-token-scope-form" onSubmit={save}>
        <fieldset
          className="admin-token-scopes"
          disabled={pending || saveBlocked}
        >
          <legend>Token scopes</legend>
          {scopeOptionsForCredential.map((scope) => (
            <label key={scope.value}>
              <input
                type="checkbox"
                name="scope"
                value={scope.value}
                defaultChecked={credential.scopes.includes(scope.value)}
                onChange={() => setSelectionError("")}
              />
              {scope.label}
            </label>
          ))}
        </fieldset>
        {selectionError ? (
          <p className="confirmation-dialog__error" role="alert">
            {selectionError}
          </p>
        ) : null}
        {error ? (
          <p className="confirmation-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="confirmation-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" disabled={pending || saveBlocked}>
            {pending ? "Saving…" : "Save scopes"}
          </button>
        </div>
      </form>
    </dialog>
  );
};

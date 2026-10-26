import { AutocompleteSelect } from "../components/autocomplete";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from "react";

import { getCurrentSession } from "../auth/session-server";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { hasPermission, permissions } from "../server/authorization";
import { createUser, listUsers, updateUser } from "../server/operations";
import type { User } from "../domain/types";
import "../styles/admin.css";

export const Route = createFileRoute("/admin/users")({
  loader: async () => {
    const session = await getCurrentSession();
    if (
      !session.authenticated ||
      !hasPermission(session.user.role, permissions.userAdmin)
    )
      return { allowed: false as const, users: [] as User[] };
    return { allowed: true as const, users: await listUsers() };
  },
  component: UsersPage,
});

const EditUserDialog = ({
  user,
  pending,
  error,
  onCancel,
  onSave,
}: {
  user: User;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onSave: (changes: { displayName: string | null; role: User["role"] }) => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [role, setRole] = useState<User["role"]>(user.role);
  const [validationError, setValidationError] = useState("");
  const errorMessage = validationError || error;

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

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!pending) onCancel();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = displayName.trim();
    if (normalizedName.length > 200) {
      setValidationError("Display name must be 200 characters or fewer.");
      return;
    }

    setValidationError("");
    onSave({ displayName: normalizedName || null, role });
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog admin-edit-user-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={
        errorMessage ? `${descriptionId} ${errorId}` : descriptionId
      }
      aria-busy={pending}
      onCancel={handleCancel}
    >
      <h2 id={titleId}>Edit user</h2>
      <p id={descriptionId}>Update the user's display name and role.</p>
      <form className="admin-edit-user-form" onSubmit={handleSubmit}>
        <label>
          Display name
          <input
            name="displayName"
            value={displayName}
            maxLength={200}
            disabled={pending}
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setValidationError("");
            }}
          />
        </label>
        <label>
          Role
          <select
            name="role"
            value={role}
            disabled={pending}
            onChange={(event) => setRole(event.target.value as User["role"])}
          >
            {user.role === "viewer" ? (
              <option value="viewer">Viewer (legacy)</option>
            ) : null}
            <option value="member">Member</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        {errorMessage ? (
          <p id={errorId} className="confirmation-dialog__error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="confirmation-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
};

export function UsersPage() {
  const { allowed, users } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState("");
  const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null);
  const [deactivationPending, setDeactivationPending] = useState(false);
  const [deactivationError, setDeactivationError] = useState("");

  if (!allowed)
    return (
      <main>
        <header>
          <h1>Administration</h1>
          <p>User administration is unavailable for this session.</p>
        </header>
      </main>
    );

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      await createUser({
        data: {
          email: String(data.get("email") ?? ""),
          displayName: String(data.get("displayName") ?? "").trim() || null,
          role: String(data.get("role")) as User["role"],
        },
      });
      form.reset();
      await router.invalidate();
      setMessage("User added.");
    } catch {
      setMessage("Could not add the user. Check the fields and retry.");
    } finally {
      setBusy(false);
    }
  };

  const setUserActive = async (user: User, active: boolean) => {
    setBusy(true);
    setMessage("");
    if (!active) {
      setDeactivationPending(true);
      setDeactivationError("");
    }
    try {
      await updateUser({
        data: { id: user.id, active },
      });
      await router.invalidate();
      setMessage(active ? "User activated." : "User deactivated.");
      if (!active) setDeactivatingUser(null);
    } catch {
      const error = "Could not update the user. Reload and retry.";
      if (active) setMessage(error);
      else setDeactivationError(error);
    } finally {
      setBusy(false);
      if (!active) setDeactivationPending(false);
    }
  };

  const edit = async (changes: {
    displayName: string | null;
    role: User["role"];
  }) => {
    if (!editingUser) return;

    setBusy(true);
    setEditPending(true);
    setEditError("");
    setMessage("");
    try {
      await updateUser({
        data: { id: editingUser.id, ...changes },
      });
      setEditingUser(null);
      setMessage("User saved. Refreshing the user list…");
      try {
        await router.invalidate({ sync: true });
        setMessage("User updated.");
      } catch {
        setMessage(
          "User changes were saved, but the list could not be refreshed. Reload to see the saved values.",
        );
      }
    } catch {
      setEditError("Could not save user changes. Check the fields and retry.");
    } finally {
      setBusy(false);
      setEditPending(false);
    }
  };

  const openEdit = (user: User) => {
    setMessage("");
    setEditError("");
    setEditingUser(user);
  };

  const cancelEdit = () => {
    if (editPending) return;
    setEditError("");
    setEditingUser(null);
  };

  const toggle = (user: User) => {
    if (!user.active) {
      void setUserActive(user, true);
      return;
    }

    setDeactivationError("");
    setDeactivatingUser(user);
  };

  const copyUserId = async (userId: string) => {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(userId);
      setMessage("User ID copied.");
    } catch {
      setMessage("Could not copy user ID. Check clipboard access and retry.");
    }
  };

  return (
    <main className="admin-page">
      <header>
        <h1>Administration</h1>
        <p>Manage the people permitted to use this private workspace.</p>
      </header>
      <section aria-labelledby="users-heading">
        <h2 id="users-heading">Users and roles</h2>
        <form className="admin-add-user" onSubmit={(event) => void add(event)}>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Display name
            <input name="displayName" />
          </label>
          <label>
            Role
            <AutocompleteSelect
              aria-label="Role"
              name="role"
              defaultValue="member"
            >
              <option value="member">Member</option>
              <option value="administrator">Administrator</option>
            </AutocompleteSelect>
          </label>
          <button type="submit" disabled={busy}>
            Add user
          </button>
        </form>
        <p className="field-help">
          Viewer access is not implemented; it is not offered for new users.
        </p>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {users.length === 0 ? (
          <p>No provisioned users.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName?.trim() || user.email}</strong>
                      {user.displayName?.trim() ? (
                        <small className="admin-email">{user.email}</small>
                      ) : null}
                    </td>
                    <td>{user.role}</td>
                    <td>{user.active ? "Active" : "Inactive"}</td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(user)}
                      >
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => void copyUserId(user.id)}
                        aria-label={`Copy user ID for ${user.displayName?.trim() || user.email}`}
                      >
                        Copy ID
                      </button>{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggle(user)}
                      >
                        {user.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editingUser ? (
        <EditUserDialog
          user={editingUser}
          pending={editPending}
          error={editError}
          onCancel={cancelEdit}
          onSave={(changes) => void edit(changes)}
        />
      ) : null}
      {deactivatingUser ? (
        <ConfirmationDialog
          title="Deactivate user?"
          description={`${deactivatingUser.displayName?.trim() || deactivatingUser.email} will be deactivated and their active sessions revoked.`}
          confirmLabel="Deactivate user"
          pending={deactivationPending}
          error={deactivationError}
          onCancel={() => setDeactivatingUser(null)}
          onConfirm={() => void setUserActive(deactivatingUser, false)}
        />
      ) : null}
    </main>
  );
}

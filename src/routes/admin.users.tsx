import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

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

export function UsersPage() {
  const { allowed, users } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
        data: { id: user.id, role: user.role, active },
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

  const toggle = (user: User) => {
    if (!user.active) {
      void setUserActive(user, true);
      return;
    }

    setDeactivationError("");
    setDeactivatingUser(user);
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
            <select name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="administrator">Administrator</option>
            </select>
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

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  loaderData: {
    allowed: true,
    users: [] as Array<{
      id: string;
      email: string;
      displayName: string | null;
      role: "administrator" | "member" | "viewer";
      active: boolean;
    }>,
  },
  router: { invalidate: vi.fn() },
}));

const operations = vi.hoisted(() => ({
  createUser: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => mocks.loaderData,
  }),
  useRouter: () => mocks.router,
}));

vi.mock("../auth/session-server", () => ({ getCurrentSession: vi.fn() }));
vi.mock("../server/authorization", () => ({
  hasPermission: vi.fn(),
  permissions: { userAdmin: "userAdmin" },
}));
vi.mock("../server/operations", () => operations);

import { UsersPage } from "./admin.users";

const user = (active: boolean) => ({
  id: "user-1",
  email: "member@example.test",
  displayName: "Workspace member",
  role: "member" as const,
  active,
});

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
  vi.resetAllMocks();
  mocks.loaderData = { allowed: true, users: [user(true)] };
  mocks.router.invalidate.mockResolvedValue(undefined);
  operations.updateUser.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("user activation controls", () => {
  it("copies the selected user's ID without modifying the user", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(createElement(UsersPage));

    fireEvent.click(
      screen.getByRole("button", { name: "Copy user ID for Workspace member" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("user-1"));
    expect(screen.getByRole("status").textContent).toBe("User ID copied.");
    expect(operations.updateUser).not.toHaveBeenCalled();
  });

  it("reports clipboard failure without exposing the ID in a message", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(createElement(UsersPage));

    fireEvent.click(
      screen.getByRole("button", { name: "Copy user ID for Workspace member" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Could not copy user ID",
      ),
    );
    expect(screen.getByRole("status").textContent).not.toContain("user-1");
  });

  it("requires confirmation before deactivation and restores focus when cancelled", () => {
    render(createElement(UsersPage));
    const trigger = screen.getByRole("button", { name: "Deactivate" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("alertdialog", {
      name: "Deactivate user?",
    });
    expect(screen.getByText(/active sessions revoked/)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(operations.updateUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(operations.updateUser).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(false);
  });

  it("shows pending state during deactivation and updates only after confirmation", async () => {
    let resolveUpdate: (() => void) | undefined;
    operations.updateUser.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    render(createElement(UsersPage));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Deactivate user?",
    });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate user" }));

    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Working…" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(operations.updateUser).toHaveBeenCalledWith({
      data: { id: "user-1", role: "member", active: false },
    });

    resolveUpdate?.();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("User deactivated.");
  });

  it("activates an inactive user directly", async () => {
    mocks.loaderData = { allowed: true, users: [user(false)] };
    render(createElement(UsersPage));

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() =>
      expect(operations.updateUser).toHaveBeenCalledWith({
        data: { id: "user-1", role: "member", active: true },
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps a deactivation error in the dialog", async () => {
    operations.updateUser.mockRejectedValueOnce(new Error("Request failed"));
    render(createElement(UsersPage));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate user" }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe(
      "Could not update the user. Reload and retry.",
    );
    expect(
      screen.getByRole("alertdialog", { name: "Deactivate user?" }),
    ).toBeTruthy();
  });
});

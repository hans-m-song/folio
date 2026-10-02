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
import { selectAutocompleteOption } from "../components/autocomplete-test-helpers";

const administratorId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const credentialId = "44444444-4444-4444-8444-444444444444";

const users = [
  {
    id: administratorId,
    email: "admin@example.test",
    displayName: "Administrator",
    role: "administrator" as const,
    active: true,
  },
  {
    id: actorId,
    email: "actor@example.test",
    displayName: "Dedicated actor",
    role: "member" as const,
    active: true,
  },
  {
    id: ownerId,
    email: "owner@example.test",
    displayName: "Default owner",
    role: "member" as const,
    active: true,
  },
];

const credential = {
  id: credentialId,
  label: "Synthetic integration",
  actorUserId: actorId,
  defaultOwnerId: ownerId,
  scopes: ["transactions:search"],
  createdById: administratorId,
  revokedAt: null,
  createdAt: "2026-09-28T00:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  loaderData: null as unknown,
  router: { invalidate: vi.fn() },
  getCurrentSession: vi.fn(),
  hasPermission: vi.fn(),
  listUsers: vi.fn(),
  listMcpCredentials: vi.fn(),
  createMcpCredential: vi.fn(),
  revokeMcpCredential: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => mocks.loaderData,
  }),
  useRouter: () => mocks.router,
}));
vi.mock("../auth/session-server", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("../server/authorization", () => ({
  hasPermission: mocks.hasPermission,
  permissions: { userAdmin: "user:admin" },
}));
vi.mock("../server/operations", () => ({ listUsers: mocks.listUsers }));
vi.mock("../server/mcp-credential-operations", () => ({
  listMcpCredentials: mocks.listMcpCredentials,
  createMcpCredential: mocks.createMcpCredential,
  revokeMcpCredential: mocks.revokeMcpCredential,
}));

import { AccessTokensPage, Route } from "./admin.tokens";

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
  vi.clearAllMocks();
  mocks.loaderData = {
    allowed: true,
    administratorId,
    users,
    credentials: [credential],
  };
  mocks.router.invalidate.mockResolvedValue(undefined);
  mocks.getCurrentSession.mockResolvedValue({
    authenticated: true,
    user: users[0],
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.listUsers.mockResolvedValue(users);
  mocks.listMcpCredentials.mockResolvedValue([credential]);
});

afterEach(() => cleanup());

describe("access token administration", () => {
  it("does not load credential metadata for a non-administrator", async () => {
    mocks.hasPermission.mockReturnValue(false);
    const loader = (
      Route as unknown as { options: { loader: () => Promise<unknown> } }
    ).options.loader;

    await expect(loader()).resolves.toMatchObject({ allowed: false });
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.listMcpCredentials).not.toHaveBeenCalled();
  });

  it("lists only metadata and requires confirmation before revoking", async () => {
    render(createElement(AccessTokensPage));
    expect(screen.getByText("Synthetic integration")).toBeTruthy();
    expect(screen.queryByText(/token_hash/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(mocks.revokeMcpCredential).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Revoke access token?" }),
    ).toBeTruthy();

    mocks.revokeMcpCredential.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await waitFor(() =>
      expect(mocks.revokeMcpCredential).toHaveBeenCalledWith({
        data: { credentialId },
      }),
    );
  });

  it("creates a wildcard token and reveals the plaintext only until dismissed", async () => {
    const token = "synthetic-token-shown-once";
    mocks.createMcpCredential.mockResolvedValue({ token, credential });
    render(createElement(AccessTokensPage));
    expect(screen.getByLabelText("All current artifact scopes")).toBeTruthy();
    expect(screen.queryByLabelText("Read submission outcomes")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "Synthetic integration" },
    });
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Dedicated actor" }),
      "Dedicated actor (member)",
    );
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Default owner" }),
      "Default owner (member)",
    );
    fireEvent.click(screen.getByLabelText("All current transaction scopes"));
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() =>
      expect(mocks.createMcpCredential).toHaveBeenCalledWith({
        data: {
          label: "Synthetic integration",
          actorUserId: actorId,
          defaultOwnerId: ownerId,
          scopes: ["transactions:*"],
        },
      }),
    );
    expect(screen.getByText(token)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss token" }));
    expect(screen.queryByText(token)).toBeNull();
  });
});

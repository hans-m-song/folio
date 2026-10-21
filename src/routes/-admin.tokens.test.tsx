// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);

const setClipboard = (clipboard: unknown) =>
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

const setExecCommand = (copy: () => boolean) => {
  const execCommand = vi.fn(copy);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  return execCommand;
};

const selectedText = () => window.getSelection()?.toString() ?? "";
const copyFeedbackText = () =>
  within(screen.getByRole("group", { name: "New token" })).queryByRole("status")
    ?.textContent ?? "";

const createToken = async (token: string) => {
  mocks.createMcpCredential.mockResolvedValue({ token, credential });
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
  fireEvent.click(screen.getByLabelText("Search transactions"));
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  await waitFor(() => expect(screen.getByText(token)).toBeTruthy());
};

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

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalExecCommandDescriptor) {
    Object.defineProperty(
      document,
      "execCommand",
      originalExecCommandDescriptor,
    );
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
});

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

  it("copies with the modern clipboard API and reports success beside the button", async () => {
    const token = "synthetic-modern-copy-token";
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacyCopy = setExecCommand(() => true);
    render(createElement(AccessTokensPage));
    await createToken(token);
    setClipboard({ writeText });
    expect(navigator.clipboard?.writeText).toBe(writeText);
    expect(document.execCommand).toBe(legacyCopy);

    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

    await waitFor(() =>
      expect(copyFeedbackText()).toBe("Token copied. Store it securely."),
    );
    expect(writeText).toHaveBeenCalledWith(token);
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it("uses selected visible token fallback when the modern API is absent", async () => {
    const token = "synthetic-legacy-copy-token";
    const legacyCopy = setExecCommand(() => true);
    render(createElement(AccessTokensPage));
    await createToken(token);
    setClipboard(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

    await waitFor(() => expect(legacyCopy).toHaveBeenCalledWith("copy"));
    await waitFor(() =>
      expect(copyFeedbackText()).toBe("Token copied. Store it securely."),
    );
    expect(selectedText()).toBe(token);
  });

  it("falls back to selected visible token when modern clipboard access is denied", async () => {
    const token = "synthetic-denied-copy-token";
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const legacyCopy = setExecCommand(() => true);
    render(createElement(AccessTokensPage));
    await createToken(token);
    setClipboard({ writeText });

    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
    await waitFor(() => expect(legacyCopy).toHaveBeenCalledWith("copy"));
    await waitFor(() =>
      expect(copyFeedbackText()).toBe("Token copied. Store it securely."),
    );
    expect(selectedText()).toBe(token);
  });

  it.each([
    ["returns false", () => false],
    [
      "throws",
      () => {
        throw new Error("copy unavailable");
      },
    ],
  ])(
    "leaves the token selected and gives manual instructions when legacy copy %s",
    async (_case, copy) => {
      const token = "synthetic-manual-copy-token";
      const legacyCopy = setExecCommand(copy);
      render(createElement(AccessTokensPage));
      await createToken(token);
      setClipboard(undefined);

      fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

      await waitFor(() =>
        expect(copyFeedbackText()).toBe(
          "Could not copy automatically. The token is selected; press Cmd/Ctrl+C to copy it.",
        ),
      );
      expect(legacyCopy).toHaveBeenCalledWith("copy");
      expect(selectedText()).toBe(token);
      expect(screen.queryByText("Token copied. Store it securely.")).toBeNull();
    },
  );

  it.each(["fulfills", "rejects"] as const)(
    "does not let a pending copy that later %s affect its replacement",
    async (outcome) => {
      const firstToken = "synthetic-first-copy-token";
      const secondToken = "synthetic-second-copy-token";
      let resolveCopy: (() => void) | undefined;
      let rejectCopy: ((reason?: unknown) => void) | undefined;
      const legacyCopy = setExecCommand(() => true);
      render(createElement(AccessTokensPage));
      await createToken(firstToken);
      setClipboard({
        writeText: vi.fn(
          () =>
            new Promise<void>((resolve, reject) => {
              resolveCopy = resolve;
              rejectCopy = reject;
            }),
        ),
      });

      fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
      await waitFor(() =>
        expect(outcome === "fulfills" ? resolveCopy : rejectCopy).toBeDefined(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Dismiss token" }));
      await createToken(secondToken);

      await act(async () => {
        if (outcome === "fulfills") resolveCopy?.();
        else rejectCopy?.(new Error("permission denied"));
        await Promise.resolve();
      });
      expect(screen.getByText(secondToken)).toBeTruthy();
      expect(copyFeedbackText()).toBe("");
      expect(selectedText()).toBe("");
      expect(legacyCopy).not.toHaveBeenCalled();
    },
  );
});

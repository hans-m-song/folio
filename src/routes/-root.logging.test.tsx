// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import type * as TanStackRouter from "@tanstack/react-router";

const mocks = vi.hoisted(() => ({
  pathname: "/health",
  privateGate: vi.fn().mockResolvedValue(true),
  getCurrentSession: vi.fn().mockResolvedValue({ authenticated: false }),
  reportClientRenderFailure: vi.fn().mockResolvedValue({ reported: true }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof TanStackRouter>()),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: mocks.pathname } }),
}));

vi.mock("../server/operations", () => ({
  privateGate: mocks.privateGate,
  reportClientRenderFailure: mocks.reportClientRenderFailure,
}));

vi.mock("../auth/session-server", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { Route } from "./__root";

const ErrorBoundary = (
  Route as unknown as {
    options: {
      errorComponent: ComponentType<{ error: unknown; reset: () => void }>;
    };
  }
).options.errorComponent;

afterEach(() => {
  cleanup();
  mocks.privateGate.mockClear();
  mocks.getCurrentSession.mockReset().mockResolvedValue({
    authenticated: false,
  });
  mocks.reportClientRenderFailure.mockClear();
});

describe("root error logging", () => {
  it("skips authentication for health while protecting private pages", async () => {
    const beforeLoad = (
      Route as unknown as {
        options: {
          beforeLoad: (context: {
            location: { pathname: string; href: string };
          }) => Promise<unknown>;
        };
      }
    ).options.beforeLoad;

    await beforeLoad({ location: { pathname: "/health", href: "/health" } });
    expect(mocks.privateGate).not.toHaveBeenCalled();
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();

    await expect(
      beforeLoad({
        location: { pathname: "/transactions", href: "/transactions" },
      }),
    ).rejects.toMatchObject({
      options: {
        to: "/auth/login",
        search: { return_to: "/transactions" },
        replace: true,
      },
    });
    expect(mocks.privateGate).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentSession).toHaveBeenCalledTimes(1);
  });

  it("preserves a safe return path and query when redirecting to login", async () => {
    const beforeLoad = (
      Route as unknown as {
        options: {
          beforeLoad: (context: {
            location: { pathname: string; href: string };
          }) => Promise<unknown>;
        };
      }
    ).options.beforeLoad;

    await expect(
      beforeLoad({
        location: {
          pathname: "/reports",
          href: "/reports?period=2026&view=month#gst",
        },
      }),
    ).rejects.toMatchObject({
      options: {
        to: "/auth/login",
        search: { return_to: "/reports?period=2026&view=month#gst" },
      },
    });

    await expect(
      beforeLoad({
        location: {
          pathname: "/reports",
          href: "//attacker.example/private",
        },
      }),
    ).rejects.toMatchObject({
      options: {
        to: "/auth/login",
        search: { return_to: "/" },
      },
    });
  });

  it.each(["/auth", "/auth/login"])(
    "does not redirect unauthenticated authentication route %s back to login",
    async (pathname) => {
      const beforeLoad = (
        Route as unknown as {
          options: {
            beforeLoad: (context: {
              location: { pathname: string; href: string };
            }) => Promise<unknown>;
          };
        }
      ).options.beforeLoad;

      await expect(
        beforeLoad({ location: { pathname, href: pathname } }),
      ).resolves.toMatchObject({
        session: { authenticated: false },
      });
      expect(mocks.getCurrentSession).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps unexpected session lookup failures as route failures", async () => {
    const beforeLoad = (
      Route as unknown as {
        options: {
          beforeLoad: (context: {
            location: { pathname: string; href: string };
          }) => Promise<unknown>;
        };
      }
    ).options.beforeLoad;
    const failure = new Error("session store unavailable");
    mocks.getCurrentSession.mockRejectedValueOnce(failure);

    await expect(
      beforeLoad({
        location: { pathname: "/transactions", href: "/transactions" },
      }),
    ).rejects.toBe(failure);
  });

  it("does not report failed health rendering as a client event", () => {
    mocks.pathname = "/health";

    render(
      createElement(ErrorBoundary, {
        error: new Error("health failed"),
        reset: vi.fn(),
      }),
    );

    expect(mocks.reportClientRenderFailure).not.toHaveBeenCalled();
  });

  it("continues reporting failures outside the health route", async () => {
    mocks.pathname = "/transactions";

    render(
      createElement(ErrorBoundary, {
        error: new Error("page failed"),
        reset: vi.fn(),
      }),
    );

    await waitFor(() =>
      expect(mocks.reportClientRenderFailure).toHaveBeenCalledTimes(1),
    );
  });
});

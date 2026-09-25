// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";

const routerMock = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) =>
    configuration,
  Outlet: () => null,
  useNavigate: () => vi.fn(),
  useRouter: () => routerMock,
  useRouterState: () => "/banking/imports",
}));

vi.mock("../server/bank-operations", () => ({
  createAndMatchBankTransaction: vi.fn(),
  getBankReconciliation: vi.fn(),
  listBankImports: vi.fn(),
  listBankTransactions: vi.fn(),
  reconcileBankTransaction: vi.fn(),
}));

import { Route as ActivityRoute } from "./banking.activity";
import { Route as ImportsRoute } from "./banking.imports";
import { Route as ReconcileRoute } from "./banking.reconcile";

interface RouteBoundary {
  pendingComponent: ComponentType;
  errorComponent: ComponentType<{
    error: unknown;
    reset: () => void;
  }>;
}

const routeBoundaries = [
  {
    name: "activity",
    route: ActivityRoute as unknown as RouteBoundary,
    loadingText: "Loading bank activity",
    errorHeading: "Bank activity unavailable",
    retryButton: "Retry bank activity",
  },
  {
    name: "imports",
    route: ImportsRoute as unknown as RouteBoundary,
    loadingText: "Loading bank import history",
    errorHeading: "Import history unavailable",
    retryButton: "Retry import history",
  },
  {
    name: "reconcile",
    route: ReconcileRoute as unknown as RouteBoundary,
    loadingText: "Loading bank reconciliation",
    errorHeading: "Reconciliation unavailable",
    retryButton: "Retry reconciliation",
  },
];

afterEach(() => cleanup());

beforeEach(() => routerMock.invalidate.mockReset());

describe("banking route load boundaries", () => {
  it.each(routeBoundaries)(
    "shows an accessible $name loading state",
    ({ route, loadingText }) => {
      render(createElement(route.pendingComponent));

      expect(screen.getByRole("status").textContent).toContain(loadingText);
    },
  );

  it.each(routeBoundaries)(
    "offers an accessible $name retry",
    ({ route, errorHeading, retryButton }) => {
      const reset = vi.fn();
      render(
        createElement(route.errorComponent, {
          error: new Error("loader rejected"),
          reset,
        }),
      );

      expect(screen.getByRole("heading", { name: errorHeading })).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain(
        "Check your access or connection",
      );
      fireEvent.click(screen.getByRole("button", { name: retryButton }));

      expect(reset).toHaveBeenCalledTimes(1);
      expect(routerMock.invalidate).toHaveBeenCalledTimes(1);
    },
  );
});

// @vitest-environment jsdom

import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ pathname: "/banking/reconcile" }));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: routeState.pathname } }),
}));

import { AppShell } from "./app-shell";

afterEach(cleanup);

beforeEach(() => {
  routeState.pathname = "/banking/reconcile";
});

describe("application navigation", () => {
  it("combines Imports and Artifacts under one active Sources item", () => {
    routeState.pathname = "/imports/library";
    render(
      <AppShell userRole="member">
        <h1>File library</h1>
      </AppShell>,
    );

    const primaryNavigations = document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    );
    expect(primaryNavigations).toHaveLength(2);
    for (const navigation of primaryNavigations) {
      const primary = within(navigation as HTMLElement);
      const sources = primary.getByRole("link", { name: "Sources" });
      expect(sources).toHaveProperty("pathname", "/imports");
      expect(sources.getAttribute("aria-current")).toBe("location");
      expect(primary.queryByRole("link", { name: "Imports" })).toBeNull();
      expect(primary.queryByRole("link", { name: "Artifacts" })).toBeNull();
    }
  });

  it("opens as a native disclosure and exposes the current location", async () => {
    const user = userEvent.setup();
    render(
      <AppShell userRole="member">
        <h1>Bank reconciliation</h1>
      </AppShell>,
    );

    const menu = document.querySelector<HTMLDetailsElement>(".app-mobile-nav");
    expect(menu).not.toBeNull();
    const summary = within(menu as HTMLDetailsElement).getByText("Menu");

    await user.click(summary);

    expect(menu?.open).toBe(true);
    const navigation = within(menu as HTMLDetailsElement);
    expect(
      navigation
        .getByRole("link", { name: "Banking" })
        .getAttribute("aria-current"),
    ).toBe("location");
    expect(
      navigation
        .getByRole("link", { name: "Reconcile" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("closes on Escape and returns focus to the menu disclosure", async () => {
    const user = userEvent.setup();
    render(
      <AppShell userRole="member">
        <h1>Bank reconciliation</h1>
      </AppShell>,
    );

    const menu = document.querySelector<HTMLDetailsElement>(".app-mobile-nav");
    expect(menu).not.toBeNull();
    const disclosure = within(menu as HTMLDetailsElement).getByText("Menu");
    await user.click(disclosure);

    within(menu as HTMLDetailsElement)
      .getByRole("link", { name: "Reconcile" })
      .focus();
    await user.keyboard("{Escape}");

    expect(menu?.open).toBe(false);
    expect(document.activeElement).toBe(disclosure);
  });

  it("closes after a navigation link is activated", async () => {
    const user = userEvent.setup();
    render(
      <AppShell userRole="member">
        <h1>Bank reconciliation</h1>
      </AppShell>,
    );

    const menu = document.querySelector<HTMLDetailsElement>(".app-mobile-nav");
    expect(menu).not.toBeNull();
    const navigation = within(menu as HTMLDetailsElement);
    await user.click(navigation.getByText("Menu"));
    const transactionsLink = navigation.getByRole("link", {
      name: "Transactions",
    });
    transactionsLink.addEventListener(
      "click",
      (event) => event.preventDefault(),
      { once: true },
    );

    await user.click(transactionsLink);

    expect(menu?.open).toBe(false);
  });

  it("sends Add imports to their Sources tabs", () => {
    render(
      <AppShell userRole="member">
        <h1>Sources</h1>
      </AppShell>,
    );

    const addMenu = document.querySelector<HTMLDetailsElement>(".app-add");
    expect(addMenu).not.toBeNull();
    (addMenu as HTMLDetailsElement).open = true;
    const links = within(addMenu as HTMLDetailsElement);
    expect(
      links.getByRole("link", { name: "Import Stripe CSV" }),
    ).toHaveProperty("pathname", "/imports/stripe");
    expect(
      links.getByRole("link", { name: "Import CommBank CSV" }),
    ).toHaveProperty("pathname", "/imports/commbank");
    expect(
      links.getByRole("link", { name: "Upload PDF evidence" }),
    ).toHaveProperty("pathname", "/imports/pdf");
  });
});

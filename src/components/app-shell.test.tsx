// @vitest-environment jsdom

import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MoneyText } from "./money-text";

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
  it("keeps Overview active only on / and shows the Financial summary child", () => {
    routeState.pathname = "/reports";
    const view = render(
      <AppShell userRole="member">
        <h1>Reports</h1>
      </AppShell>,
    );

    const primaryNavigations = document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    );
    expect(primaryNavigations).toHaveLength(2);
    for (const navigation of primaryNavigations) {
      const primary = within(navigation as HTMLElement);
      const overview = primary.getByRole("link", { name: "Overview" });
      const reports = primary.getByRole("link", { name: "Reports" });
      const preparation = primary.getByRole("link", {
        name: "Financial summary",
      });
      const tax = primary.getByRole("link", { name: "Tax preparation" });
      expect(overview.getAttribute("aria-current")).toBeNull();
      expect(overview.getAttribute("data-active")).toBeNull();
      expect(reports.getAttribute("aria-current")).toBe("location");
      expect(reports.getAttribute("data-active")).toBe("true");
      expect(overview.closest("li.app-nav-group")).toBeNull();
      expect(reports.closest("li.app-nav-group")).not.toBeNull();
      expect(preparation.getAttribute("aria-current")).toBe("page");
      expect(tax.getAttribute("aria-current")).toBeNull();
    }

    routeState.pathname = "/";
    view.rerender(
      <AppShell userRole="member">
        <h1>Overview</h1>
      </AppShell>,
    );

    for (const navigation of document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    )) {
      const primary = within(navigation as HTMLElement);
      expect(
        primary
          .getByRole("link", { name: "Overview" })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(
        primary
          .getByRole("link", { name: "Reports" })
          .getAttribute("aria-current"),
      ).toBeNull();
    }
  });

  it("selects only Tax preparation on the worksheet route", () => {
    routeState.pathname = "/reports/tax";
    render(
      <AppShell userRole="member">
        <h1>Tax preparation</h1>
      </AppShell>,
    );

    for (const navigation of document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    )) {
      const primary = within(navigation as HTMLElement);
      expect(
        primary
          .getByRole("link", { name: "Reports" })
          .getAttribute("aria-current"),
      ).toBe("location");
      expect(
        primary
          .getByRole("link", { name: "Financial summary" })
          .getAttribute("aria-current"),
      ).toBeNull();
      const tax = primary.getByRole("link", { name: "Tax preparation" });
      expect(tax.getAttribute("href")).toBe("/reports/tax");
      expect(tax.getAttribute("aria-current")).toBe("page");
    }
  });

  it("keeps Transactions clickable and shows Recurring bills as its child", () => {
    routeState.pathname = "/transactions/recurring";
    render(
      <AppShell userRole="member">
        <h1>Recurring bills</h1>
      </AppShell>,
    );

    for (const navigation of document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    )) {
      const primary = within(navigation as HTMLElement);
      const transactions = primary.getByRole("link", { name: "Transactions" });
      expect(transactions).toHaveProperty("pathname", "/transactions");
      expect(transactions.getAttribute("aria-current")).toBe("location");
      expect(transactions.getAttribute("data-active")).toBe("true");

      const recurringBills = primary.getByRole("link", {
        name: "Recurring bills",
      });
      expect(recurringBills).toHaveProperty(
        "pathname",
        "/transactions/recurring",
      );
      expect(recurringBills.getAttribute("aria-current")).toBe("page");
      expect(recurringBills.getAttribute("data-active")).toBe("true");
      expect(
        within(
          transactions.closest("li.app-nav-group") as HTMLElement,
        ).getByRole("link", { name: "Recurring bills" }),
      ).toBe(recurringBills);
    }
  });

  it("shows Users and Access tokens under Administration for administrators", () => {
    routeState.pathname = "/admin/tokens";
    render(
      <AppShell userRole="administrator">
        <h1>Access tokens</h1>
      </AppShell>,
    );

    const primaryNavigations = document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    );
    expect(primaryNavigations).toHaveLength(2);
    for (const navigation of primaryNavigations) {
      const primary = within(navigation as HTMLElement);
      const administration = primary.getByRole("link", {
        name: "Administration",
      });
      expect(administration.getAttribute("aria-current")).toBe("location");
      const users = primary.getByRole("link", { name: "Users" });
      expect(users).toHaveProperty("pathname", "/admin/users");
      expect(users.getAttribute("aria-current")).toBeNull();
      const tokens = primary.getByRole("link", { name: "Access tokens" });
      expect(tokens).toHaveProperty("pathname", "/admin/tokens");
      expect(tokens.getAttribute("aria-current")).toBe("page");
      expect(
        within(
          administration.closest("li.app-nav-group") as HTMLElement,
        ).getByRole("link", { name: "Access tokens" }),
      ).toBe(tokens);
    }
  });

  it("hides Administration links from members", () => {
    routeState.pathname = "/admin/tokens";
    render(
      <AppShell userRole="member">
        <h1>Access tokens</h1>
      </AppShell>,
    );

    for (const navigation of document.querySelectorAll(
      '[aria-label="Primary navigation"]',
    )) {
      const primary = within(navigation as HTMLElement);
      expect(
        primary.queryByRole("link", { name: "Administration" }),
      ).toBeNull();
      expect(primary.queryByRole("link", { name: "Access tokens" })).toBeNull();
    }
  });

  it("shows the four Sources destinations under the active Sources item", () => {
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
      expect(sources.getAttribute("data-active")).toBe("true");
      expect(primary.getByRole("link", { name: "Stripe CSV" })).toHaveProperty(
        "pathname",
        "/imports/stripe",
      );
      expect(
        primary.getByRole("link", { name: "CommBank CSV" }),
      ).toHaveProperty("pathname", "/imports/commbank");
      expect(
        primary.getByRole("link", { name: "PDF evidence" }),
      ).toHaveProperty("pathname", "/imports/pdf");
      expect(
        primary.getByRole("link", { name: "File library" }),
      ).toHaveProperty("pathname", "/imports/library");
      expect(
        primary
          .getByRole("link", { name: "File library" })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(primary.queryByRole("link", { name: "Imports" })).toBeNull();
      expect(primary.queryByRole("link", { name: "Artifacts" })).toBeNull();
    }
  });

  it.each([
    { pathname: "/imports/stripe", label: "Stripe CSV" },
    { pathname: "/imports/commbank", label: "CommBank CSV" },
    { pathname: "/imports/pdf", label: "PDF evidence" },
    { pathname: "/imports/library", label: "File library" },
  ])(
    "marks $label current in desktop and mobile navigation",
    ({ pathname, label }) => {
      routeState.pathname = pathname;
      render(
        <AppShell userRole="member">
          <h1>Sources</h1>
        </AppShell>,
      );

      const primaryNavigations = document.querySelectorAll(
        '[aria-label="Primary navigation"]',
      );
      expect(primaryNavigations).toHaveLength(2);
      for (const navigation of primaryNavigations) {
        const primary = within(navigation as HTMLElement);
        expect(
          primary
            .getByRole("link", { name: "Sources" })
            .getAttribute("aria-current"),
        ).toBe("location");
        const selectedTab = primary.getByRole("link", { name: label });
        expect(selectedTab.getAttribute("aria-current")).toBe("page");
        expect(selectedTab.getAttribute("data-active")).toBe("true");
      }
    },
  );

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

  it("closes after a Sources child link is activated", async () => {
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
    const sourceLink = navigation.getByRole("link", {
      name: "Stripe CSV",
    });
    sourceLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });

    await user.click(sourceLink);

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

  it("copies one monetary amount through AppShell and removes its listener on unmount", () => {
    const view = render(
      <StrictMode>
        <AppShell userRole="member">
          <MoneyText>AUD -1,234.5000</MoneyText>
        </AppShell>
      </StrictMode>,
    );
    const moneyText = document.querySelector("[data-money-value]")!;
    const textNode = moneyText.firstChild as Text;
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(moneyText);
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboardData = { setData: vi.fn() };
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", {
      value: clipboardData,
    });
    document.body.dispatchEvent(copyEvent);

    expect(clipboardData.setData).toHaveBeenCalledOnce();
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/plain",
      "AUD -1234.5000",
    );
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(textNode.textContent).toBe("AUD -1,234.5000");

    view.unmount();
    const detachedAmount = document.createElement("span");
    detachedAmount.dataset.moneyValue = "";
    detachedAmount.textContent = "AUD 5,678.00";
    document.body.append(detachedAmount);
    const detachedRange = document.createRange();
    detachedRange.selectNodeContents(detachedAmount);
    selection.removeAllRanges();
    selection.addRange(detachedRange);

    const detachedClipboard = { setData: vi.fn() };
    const detachedEvent = new Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(detachedEvent, "clipboardData", {
      value: detachedClipboard,
    });
    document.body.dispatchEvent(detachedEvent);

    expect(detachedClipboard.setData).not.toHaveBeenCalled();
    expect(detachedEvent.defaultPrevented).toBe(false);
    detachedAmount.remove();
  });
});

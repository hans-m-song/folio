// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";

const routerMock = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) =>
    configuration,
  useRouter: () => routerMock,
}));

vi.mock("../server/operations", () => ({ getReport: vi.fn() }));

import { Route } from "./reports";

const reportRoute = Route as unknown as {
  errorComponent: ComponentType;
};

afterEach(() => cleanup());

describe("Reports route error state", () => {
  it("offers an accessible retry that invalidates the route loader", () => {
    render(createElement(reportRoute.errorComponent));

    expect(screen.getByRole("alert").textContent).toContain("Retry the page");
    fireEvent.click(screen.getByRole("button", { name: "Retry reports" }));
    expect(routerMock.invalidate).toHaveBeenCalledTimes(1);
  });
});

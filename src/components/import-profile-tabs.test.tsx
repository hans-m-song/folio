// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SourceTabs } from "./import-profile-tabs";

afterEach(cleanup);

describe("source navigation", () => {
  it("provides the three import flows and file library as tabs", () => {
    render(<SourceTabs active="library" />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/imports/stripe",
      "/imports/commbank",
      "/imports/pdf",
      "/imports/library",
    ]);
    expect(
      screen
        .getByRole("link", { name: "File library" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "CommBank CSV" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sources" })).toBeTruthy();
  });
});

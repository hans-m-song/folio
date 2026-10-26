// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SourceTabs } from "./import-profile-tabs";

afterEach(cleanup);

describe("source navigation", () => {
  it("provides upload and file library as tabs", () => {
    render(<SourceTabs active="upload" />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/imports/upload",
      "/imports/library",
    ]);
    expect(
      screen
        .getByRole("link", { name: "Upload file" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "File library" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sources" })).toBeTruthy();
  });
});

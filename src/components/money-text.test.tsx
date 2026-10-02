// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MoneyText } from "./money-text";

afterEach(cleanup);

describe("monetary text presentation", () => {
  it("preserves the displayed currency, grouping, sign, and precision", () => {
    render(<MoneyText>−AUD 1,234.5601</MoneyText>);

    const amount = screen.getByText("−AUD 1,234.5601");
    expect(amount.tagName).toBe("SPAN");
    expect(amount.classList.contains("money-text")).toBe(true);
    expect(amount.hasAttribute("data-money-value")).toBe(true);
    expect(amount.style.fontFamily).toBe("");
    expect(amount.style.fontSize).toBe("");
  });

  it("preserves strong summary semantics and amount tones", () => {
    render(
      <MoneyText as="strong" className="amount-negative">
        -$12.00
      </MoneyText>,
    );

    const amount = screen.getByText("-$12.00");
    expect(amount.tagName).toBe("STRONG");
    expect(amount.className).toBe("money-text amount-negative");
  });

  it("retains small secondary amount semantics", () => {
    render(<MoneyText as="small">USD 987.65</MoneyText>);

    expect(screen.getByText("USD 987.65").tagName).toBe("SMALL");
  });

  it("does not invent a value for absent source facts", () => {
    const { container } = render(<MoneyText>{null}</MoneyText>);

    expect(container.querySelector("[data-money-value]")?.textContent).toBe("");
  });
});

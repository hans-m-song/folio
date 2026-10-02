// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AutocompleteSelect, AutocompleteMultiSelect } from "./autocomplete";
import { selectAutocompleteOption } from "./autocomplete-test-helpers";

afterEach(cleanup);

describe("fixed-choice autocomplete", () => {
  it("supports compact input sizing and an explicit prompt", () => {
    render(
      <AutocompleteSelect
        aria-label="Clause"
        value=""
        inputSize={12}
        placeholder="Add clause…"
      >
        <option value="">Choose a clause</option>
        <option value="date">Date</option>
      </AutocompleteSelect>,
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.size).toBe(12);
    expect(input.placeholder).toBe("Add clause…");
  });

  it("opens both controls when their inputs receive focus", async () => {
    const user = userEvent.setup();
    const single = render(
      <AutocompleteSelect aria-label="Kind" defaultValue="sale">
        <option value="sale">Sale</option>
        <option value="supplier_expense">Supplier expense</option>
      </AutocompleteSelect>,
    );
    const singleInput = screen.getByRole("combobox", { name: "Kind" });
    await user.click(singleInput);
    expect(singleInput.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
    single.unmount();

    render(
      <AutocompleteMultiSelect
        aria-label="Status filter value"
        options={[
          { value: "draft", label: "Draft" },
          { value: "recorded", label: "Recorded" },
        ]}
        value={[]}
        onChange={() => {}}
      />,
    );
    const multipleInput = screen.getByRole("combobox", {
      name: "Status filter value",
    });
    await user.click(multipleInput);
    expect(multipleInput.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("blocks keyboard submission of unmatched text without a required selection", async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    render(
      <form
        aria-label="Keyboard example"
        onSubmit={(event) => {
          event.preventDefault();
          submitted(new FormData(event.currentTarget));
        }}
      >
        <AutocompleteSelect
          aria-label="Owner"
          name="owner"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Choose an owner
          </option>
          <option value="synthetic-owner">Example owner</option>
        </AutocompleteSelect>
        <button type="submit">Submit</button>
      </form>,
    );
    const input = screen.getByRole("combobox");
    await user.type(input, "Unlisted owner");
    await user.keyboard("{Enter}{Enter}");
    expect(submitted).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("form", {
          name: "Keyboard example",
        }) as HTMLFormElement
      ).checkValidity(),
    ).toBe(false);
    await selectAutocompleteOption(input, "Example owner");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(submitted.mock.calls[0][0].get("owner")).toBe("synthetic-owner");
  });

  it("requires a choice and clears named state on native form reset", async () => {
    const user = userEvent.setup();
    render(
      <form aria-label="Required example">
        <AutocompleteSelect
          aria-label="Owner"
          name="owner"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Choose an owner
          </option>
          <option value="synthetic-owner">Example owner</option>
        </AutocompleteSelect>
        <button type="reset">Reset</button>
      </form>,
    );
    const form = screen.getByRole("form", {
      name: "Required example",
    }) as HTMLFormElement;
    expect(form.checkValidity()).toBe(false);
    await selectAutocompleteOption(
      screen.getByRole("combobox"),
      "Example owner",
    );
    await user.tab();
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get("owner")).toBe("synthetic-owner");
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(new FormData(form).get("owner")).toBe("");
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    expect(form.checkValidity()).toBe(false);
  });

  it("searches labels, selects by keyboard and submits the enum value", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <form aria-label="Example">
        <AutocompleteSelect
          aria-label="Kind"
          name="kind"
          defaultValue="sale"
          onValueChange={changed}
        >
          <option value="sale">Sale</option>
          <option value="supplier_expense">Supplier expense</option>
        </AutocompleteSelect>
      </form>,
    );
    const input = screen.getByRole("combobox", { name: "Kind" });
    await user.clear(input);
    await user.type(input, "supplier");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(changed).toHaveBeenCalledWith("supplier_expense");
    expect((input as HTMLInputElement).value).toBe("Supplier expense");
    expect(
      new FormData(
        screen.getByRole("form", { name: "Example" }) as HTMLFormElement,
      ).get("kind"),
    ).toBe("supplier_expense");
  });

  it("rejects arbitrary typed values and disabled options", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <AutocompleteSelect
        aria-label="Status"
        defaultValue="draft"
        onValueChange={changed}
      >
        <option value="draft">Draft</option>
        <option value="void" disabled>
          Void
        </option>
      </AutocompleteSelect>,
    );
    const input = screen.getByRole("combobox", { name: "Status" });
    await user.clear(input);
    await user.type(input, "anything");
    await user.tab();
    expect(changed).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("Draft");
    await user.clear(input);
    await user.type(input, "Void");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(changed).not.toHaveBeenCalled();
  });

  it("preserves disabled form behavior", () => {
    render(
      <form aria-label="Example">
        <AutocompleteSelect
          aria-label="Kind"
          name="kind"
          defaultValue="sale"
          disabled
        >
          <option value="sale">Sale</option>
        </AutocompleteSelect>
      </form>,
    );
    expect(
      (screen.getByRole("combobox", { name: "Kind" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      new FormData(
        screen.getByRole("form", { name: "Example" }) as HTMLFormElement,
      ).has("kind"),
    ).toBe(false);
  });
});

describe("multi-select autocomplete", () => {
  it("adds exact choices, excludes selected items and removes chips", async () => {
    const Example = () => {
      const [value, setValue] = useState<string[]>([]);
      return (
        <AutocompleteMultiSelect
          aria-label="Status filter value"
          options={[
            { value: "draft", label: "Draft" },
            { value: "recorded", label: "Recorded" },
          ]}
          value={value}
          onChange={setValue}
        />
      );
    };
    const submitted = vi.fn();
    const user = userEvent.setup();
    render(
      <form
        aria-label="Filter form"
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <Example />
        <button type="button">Outside</button>
      </form>,
    );
    const input = screen.getByRole("combobox", {
      name: "Status filter value",
    });
    const control = input.closest(".autocomplete-multiple-control");
    expect(control).toBeTruthy();
    expect(control?.getAttribute("role")).toBe("group");
    expect(control?.getAttribute("aria-label")).toBe(
      "Selected Status filter value and available options",
    );
    expect(control?.querySelector(".autocomplete-chips")).toBeTruthy();
    expect(control?.querySelector(".autocomplete-input-row input")).toBe(input);
    expect(
      control?.querySelector(
        'button[aria-label="Show Status filter value options"]',
      ),
    ).toBeTruthy();

    await selectAutocompleteOption(screen.getByRole("combobox"), "Draft");
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove Draft" })).toBeTruthy();
    await selectAutocompleteOption(screen.getByRole("combobox"), "Recorded");
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Remove Recorded" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove Draft" }));
    expect(screen.queryByRole("button", { name: "Remove Draft" })).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
    await selectAutocompleteOption(screen.getByRole("combobox"), "Draft");
    expect(
      screen.getAllByRole("button", { name: "Remove Draft" }),
    ).toHaveLength(1);
  });
});

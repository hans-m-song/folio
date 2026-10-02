// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type FormEvent } from "react";

import {
  QueryChipBuilder,
  type QueryChipClause,
  type QueryChipField,
} from "./query-chip-builder";

afterEach(cleanup);

const filterFields: QueryChipField[] = [
  {
    value: "description",
    label: "Description",
    valueKind: "text",
    operators: [
      { value: "contains", label: "Contains" },
      { value: "not_contains", label: "Does not contain" },
      { value: "equals", label: "Equals" },
    ],
  },
  {
    value: "status",
    label: "Status",
    valueKind: "enum",
    operators: [
      { value: "contains_any", label: "Contains any of" },
      { value: "contains_none", label: "Contains none of" },
      { value: "is", label: "Is" },
      { value: "is_not", label: "Is not" },
    ],
    options: [
      { value: "draft", label: "Draft" },
      { value: "recorded", label: "Recorded" },
    ],
  },
  {
    value: "created_at",
    label: "Created date",
    valueKind: "date",
    operators: [{ value: "equals", label: "On" }],
  },
  {
    value: "amount",
    label: "Amount",
    valueKind: "number",
    operators: [{ value: "equals", label: "Equals" }],
  },
];

const sortFields = [
  { value: "created_at", label: "Transaction date" },
  { value: "amount", label: "Amount" },
  { value: "description", label: "Description" },
];

const defaultSort: QueryChipClause[] = [
  {
    id: 0,
    type: "sort",
    field: "created_at",
    operator: "desc",
    value: "",
  },
];

const baseProps = {
  label: "Transaction query",
  filterFields,
  sortFields,
  defaultSort,
};

const addClause = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) => {
  const input = screen.getByRole("combobox", {
    name: "Transaction query add filter or sort",
  });
  await user.click(input);
  await user.type(input, label);
  await user.click(await screen.findByRole("option", { name: label }));
  const nextControl = await screen.findByRole("combobox", {
    name: /filter operator|sort direction/,
  });
  await waitFor(() => expect(document.activeElement).toBe(nextControl));
  await user.keyboard("{Escape}");
  expect(nextControl.getAttribute("aria-expanded")).toBe("false");
};

const selectOption = async (
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  label: string,
) => {
  await user.clear(input);
  await user.type(input, label);
  await user.click(await screen.findByRole("option", { name: label }));
};

describe("query chip builder", () => {
  it("stages a text filter inline and commits on Enter without submitting its form", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <QueryChipBuilder {...baseProps} clauses={[]} onChange={onChange} />
      </form>,
    );

    await addClause(user, "Filter · Description");
    const value = await screen.findByRole("textbox", {
      name: "Description Contains value",
    });
    const editingChip = value.closest("li");
    expect(editingChip?.classList.contains("query-chip-builder__chip")).toBe(
      true,
    );
    expect(
      editingChip?.classList.contains("query-chip-builder__chip--editing"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Clear filters" })
        .classList.contains("secondary"),
    ).toBe(true);
    await user.type(value, "invoice 42");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        {
          id: 1,
          type: "filter",
          field: "description",
          operator: "contains",
          value: "invoice 42",
        },
      ]),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Apply filter clause" }),
    ).toBeNull();
  });

  it("keeps an incomplete edit local after blur and cancels it with Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const clauses: QueryChipClause[] = [
      {
        id: 0,
        type: "filter",
        field: "description",
        operator: "contains",
        value: "saved value",
      },
    ];
    render(
      <>
        <QueryChipBuilder
          {...baseProps}
          clauses={clauses}
          onChange={onChange}
        />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(
      screen.getByRole("button", { name: /Edit Filter Description/ }),
    );
    const value = screen.getByRole("textbox", {
      name: "Description Contains value",
    });
    await user.clear(value);
    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("textbox", { name: "Description Contains value" }),
    ).toBeTruthy();

    await user.click(value);
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Description Contains value" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Edit Filter Description Contains saved value",
      }),
    ).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses keyboard-only column, operator, and value steps without form submission", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const submitted = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submitted}>
        <QueryChipBuilder {...baseProps} clauses={[]} onChange={onChange} />
      </form>,
    );

    const addInput = screen.getByRole("combobox", {
      name: "Transaction query add filter or sort",
    });
    await user.tab();
    expect(document.activeElement).toBe(addInput);
    await user.type(addInput, "Filter · Description");
    await user.keyboard("{ArrowDown}{Enter}");

    const operator = await screen.findByRole("combobox", {
      name: "Description filter operator",
    });
    await user.clear(operator);
    await user.type(operator, "Equals");
    await user.keyboard("{ArrowDown}{Enter}");

    const value = await screen.findByRole("textbox", {
      name: "Description Equals value",
    });
    await user.type(value, "invoice");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        {
          id: 1,
          type: "filter",
          field: "description",
          operator: "equals",
          value: "invoice",
        },
      ]),
    );
    expect(submitted).not.toHaveBeenCalled();
  });

  it("encodes membership filters as exact arrays and preserves legacy scalar operators", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const membershipView = render(
      <QueryChipBuilder {...baseProps} clauses={[]} onChange={onChange} />,
    );

    await addClause(user, "Filter · Status");
    const operator = await screen.findByRole("combobox", {
      name: "Status filter operator",
    });
    await selectOption(user, operator, "Contains none of");
    const values = await screen.findByRole("combobox", {
      name: "Status Contains none of values",
    });
    await selectOption(user, values, "Draft");
    await selectOption(user, values, "Recorded");
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );

    expect(onChange).toHaveBeenLastCalledWith([
      {
        id: 1,
        type: "filter",
        field: "status",
        operator: "contains_none",
        value: ["draft", "recorded"],
      },
    ]);
    membershipView.unmount();

    const legacyOnChange = vi.fn();
    render(
      <QueryChipBuilder
        {...baseProps}
        clauses={[
          {
            id: 0,
            type: "filter",
            field: "status",
            operator: "is_not",
            value: "draft",
          },
        ]}
        onChange={legacyOnChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Edit Filter Status Is not Draft/ }),
    );
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Apply filter clause" }),
    );
    expect(legacyOnChange).toHaveBeenCalledWith([
      {
        id: 0,
        type: "filter",
        field: "status",
        operator: "is_not",
        value: "draft",
      },
    ]);
  });

  it("restores default sorts with collision-free ids, supports re-edit, and excludes duplicates", async () => {
    const user = userEvent.setup();
    const controlledProps = {
      clauses: [
        {
          id: 1,
          type: "filter" as const,
          field: "description",
          operator: "contains",
          value: "invoice",
        },
        {
          id: 2,
          type: "sort" as const,
          field: "amount",
          operator: "asc",
          value: "",
        },
      ],
    };
    const ControlledBuilder = () => {
      const [clauses, setClauses] = useState<QueryChipClause[]>(
        controlledProps.clauses,
      );
      return (
        <QueryChipBuilder
          {...baseProps}
          clauses={clauses}
          onChange={setClauses}
        />
      );
    };
    render(<ControlledBuilder />);

    await user.click(screen.getByRole("button", { name: "Clear sorts" }));
    const restored = await screen.findByRole("button", {
      name: "Edit Sort Transaction date Descending",
    });
    expect(restored).toBeTruthy();
    expect(restored.textContent).toBe("Transaction date↓");
    expect(
      restored
        .querySelector(".query-chip-builder__sort-direction")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Clear sorts" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(restored);
    const direction = await screen.findByRole("combobox", {
      name: "Transaction query sort direction",
    });
    expect(
      direction
        .closest("li")
        ?.classList.contains("query-chip-builder__chip--editing"),
    ).toBe(true);
    await selectOption(user, direction, "Ascending");
    await user.click(screen.getByRole("button", { name: "Apply sort clause" }));
    expect(
      screen.getByRole("button", {
        name: "Edit Sort Transaction date Ascending",
      }),
    ).toBeTruthy();

    const addPicker = screen.getByRole("combobox", {
      name: "Transaction query add filter or sort",
    });
    await user.click(addPicker);
    await user.type(addPicker, "Sort ·");
    expect(
      screen.queryByRole("option", { name: "Sort · Transaction date" }),
    ).toBeNull();
    await user.click(
      await screen.findByRole("option", { name: "Sort · Amount" }),
    );
  });

  it("cancels stale edits when clauses change externally", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const initial: QueryChipClause[] = [
      {
        id: 1,
        type: "filter",
        field: "description",
        operator: "contains",
        value: "before",
      },
    ];
    const { rerender } = render(
      <QueryChipBuilder {...baseProps} clauses={initial} onChange={onChange} />,
    );
    await user.click(
      screen.getByRole("button", { name: /Edit Filter Description/ }),
    );
    await user.clear(
      screen.getByRole("textbox", { name: "Description Contains value" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Description Contains value" }),
      "stale draft",
    );

    rerender(
      <QueryChipBuilder
        {...baseProps}
        clauses={[
          {
            ...initial[0],
            value: "external update",
          },
        ]}
        onChange={onChange}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Edit Filter Description Contains external update",
        }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: "Apply filter clause" }),
    ).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

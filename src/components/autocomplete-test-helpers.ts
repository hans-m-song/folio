import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export const selectAutocompleteOption = async (
  input: HTMLElement,
  label: string,
) => {
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, label);
  await user.click(await screen.findByRole("option", { name: label }));
  await user.keyboard("{Escape}");
};

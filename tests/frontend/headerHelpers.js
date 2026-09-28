// The header's account menu in tests: the signed-in user's details (role, store, last login), the
// profile link and Log out are inside it, so open it first.
import { fireEvent, screen } from "@testing-library/react";

export const openUserMenu = () => {
  if (!screen.queryByTestId("user-menu")) fireEvent.click(screen.getByTestId("user-menu-button"));
  return screen.getByTestId("user-menu");
};

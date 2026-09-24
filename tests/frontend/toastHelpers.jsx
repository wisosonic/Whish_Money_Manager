// Helpers for asserting toast notifications (sonner) in component tests. Render <AppToaster /> next
// to the component under test, then:
//   const toast = await findToast("تم حذف العملية.");
//   expect(toast).toHaveAttribute("data-type", "success");
import { screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

// The toast element (li[data-sonner-toast]) that shows `text` — the same text may also be inline.
export const findToast = async (text) => {
  let node = null;
  await waitFor(() => {
    const matches = screen.queryAllByText(text).map((el) => el.closest("[data-sonner-toast]")).filter(Boolean);
    if (!matches.length) throw new Error(`no toast showing ${text}`);
    node = matches[0];
  });
  return node;
};

export const toastTexts = () =>
  [...document.querySelectorAll("[data-sonner-toast]")].map((el) => el.querySelector("[data-title]")?.textContent ?? el.textContent);

// Toasts live in a module-level store: clear them between tests.
export const clearToasts = () => toast.dismiss();

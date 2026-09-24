// Toast notifications for feedback on actions (imports, saves, deletes, settings, admin panel).
// One wrapper around sonner so every screen uses the same kinds and durations, and tests can mock
// "@/lib/notify". Messages are already translated by the caller (t(...) / errorText(...)).
//
//   notify.success(t("toast.tx.deleted"));
//   notify.error(errorText(err.message) || t("toast.tx.saveFailed"));
//   notify.warning(t("toast.import.notReconciled"));
//
// Errors and warnings stay longer, so there's time to read them. Pass { id } to replace an earlier
// toast instead of stacking a new one (e.g. several quick settings changes → one "Saved").
import { toast } from "sonner";

export const TOAST_DURATION = { success: 4000, info: 4000, warning: 7000, error: 8000 };

const show = (kind) => (message, options = {}) => toast[kind](message, { duration: TOAST_DURATION[kind], ...options });

export const notify = {
  success: show("success"),
  info: show("info"),
  warning: show("warning"),
  error: show("error"),
};

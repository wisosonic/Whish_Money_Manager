import { Toaster } from "sonner";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/PreferencesContext";

// Where toast notifications appear (see src/lib/notify.js). Follows the interface direction —
// bottom-left in Arabic, bottom-right in English, away from the sticky header — and the dark theme.
// richColors gives each kind its own colour and icon (success / info / warning / error); the text
// says what happened, so the colour is never the only signal. Screen readers announce toasts
// through sonner's live region, labelled in the interface language.
export default function AppToaster() {
  const { t, dir } = useI18n();
  const { isDark } = usePreferences();
  return (
    <Toaster
      dir={dir}
      theme={isDark ? "dark" : "light"}
      position={dir === "rtl" ? "bottom-left" : "bottom-right"}
      richColors
      closeButton
      visibleToasts={4}
      containerAriaLabel={t("toast.region")}
      toastOptions={{ closeButtonAriaLabel: t("common.close"), className: "font-[inherit]" }}
    />
  );
}

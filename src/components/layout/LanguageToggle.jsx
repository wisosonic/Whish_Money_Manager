import { Languages } from "lucide-react";
import { LANGUAGES, useI18n } from "@/lib/i18n";

// Switches the interface between Arabic and English. Shows the language you'd switch TO,
// written in that language, so it's recognisable whichever language is active.
export default function LanguageToggle({ className = "" }) {
  const { lang, t, toggleLang } = useI18n();
  const other = lang === "ar" ? "en" : "ar";

  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={t("language.switchTo")}
      title={t("language.switchTo")}
      data-testid="language-toggle"
      lang={other}
      className={`flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-2xl px-3 py-2 transition text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${className}`}
    >
      <Languages className="w-4 h-4" aria-hidden="true" />
      <span>{LANGUAGES[other].label}</span>
    </button>
  );
}

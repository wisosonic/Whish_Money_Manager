import { LANGUAGES, useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/PreferencesContext";

// Switches the interface between Arabic and English. A two-position switch: "ع" on the left,
// "EN" on the right, with a knob that slides under the active language. Screen readers hear a
// switch named "English" that is on or off. The track is always left-to-right so the knob
// doesn't jump sides when the page direction flips. Shown on the login page, so the language can be
// chosen before signing in; signed-in users change it on the Settings page. If it's ever used while
// signed in, the choice is saved to the account (see PreferencesContext.setLanguage).
export default function LanguageToggle({ className = "" }) {
  const { lang, t, toggleLang } = useI18n();
  const { setLanguage } = usePreferences();
  const isEnglish = lang === "en";
  const onToggle = () => (setLanguage ? setLanguage(isEnglish ? "ar" : "en") : toggleLang());
  const label = (code, active) => (
    <span
      aria-hidden="true"
      lang={code}
      className={`relative z-10 flex-1 text-center font-bold leading-none ${code === "ar" ? "text-base" : "text-sm"} transition-colors duration-200 motion-reduce:transition-none ${active ? "text-slate-900" : "text-white/80"}`}
    >
      {LANGUAGES[code].short}
    </span>
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isEnglish}
      aria-label={t("language.english")}
      title={t("language.switchTo")}
      onClick={onToggle}
      data-testid="language-toggle"
      dir="ltr"
      className={`relative inline-flex shrink-0 items-center h-9 w-[84px] p-1 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${className}`}
    >
      <span
        aria-hidden="true"
        data-testid="language-toggle-knob"
        className={`theme-fixed absolute top-1 bottom-1 left-1 w-[38px] rounded-full bg-white shadow transition-transform duration-200 ease-out motion-reduce:transition-none ${isEnglish ? "translate-x-[38px]" : "translate-x-0"}`}
      />
      {label("ar", !isEnglish)}
      {label("en", isEnglish)}
    </button>
  );
}

// Interface language (Arabic / English). Arabic is the default. The choice is kept in the
// `wmm_lang` cookie so it survives reloads and applies before sign-in (login page included).
//
//   const { t, lang, dir, locale, toggleLang } = useI18n();
//   t("header.logout")                    → "خروج" / "Log out"
//   t("list.count", { count: 5 })         → "5 عملية" / "5 transactions"
//
// Components used without a <LanguageProvider> (e.g. in unit tests) get Arabic.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import ar from "@/locales/ar";
import en from "@/locales/en";

export const LANG_COOKIE = "wmm_lang";
export const DEFAULT_LANG = "ar";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export const LANGUAGES = {
  // `label` is each language's own name in its own script; `short` is what the switch shows.
  ar: { dictionary: ar, dir: "rtl", locale: "ar-u-nu-latn", label: "العربية", short: "ع" },
  en: { dictionary: en, dir: "ltr", locale: "en-US", label: "English", short: "EN" },
};

export const readLangCookie = () => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(ar|en)(?:;|$)`));
  return match ? match[1] : null;
};

export const writeLangCookie = (lang) => {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
};

// Looks up a key (falling back to Arabic, then to the key itself), picks a plural form when the
// entry is { one, other } and `count` is given, and fills {placeholders}.
export const translate = (lang, key, params = {}) => {
  const dictionary = (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANG]).dictionary;
  let entry = dictionary[key] ?? LANGUAGES[DEFAULT_LANG].dictionary[key] ?? key;
  if (entry && typeof entry === "object") {
    entry = (params.count === 1 ? entry.one : entry.other) ?? entry.other ?? key;
  }
  return String(entry).replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? String(params[name]) : match));
};

// The API answers in English; show known messages in the interface language.
export const translateServerError = (lang, message) => {
  const errors = (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANG]).dictionary.__serverErrors || {};
  return errors[message] || message;
};

const buildValue = (lang, setLang) => ({
  lang,
  dir: LANGUAGES[lang].dir,
  locale: LANGUAGES[lang].locale,
  t: (key, params) => translate(lang, key, params),
  errorText: (message) => translateServerError(lang, message),
  setLang,
  toggleLang: () => setLang(lang === "ar" ? "en" : "ar"),
});

const I18nContext = createContext(buildValue(DEFAULT_LANG, () => {}));

export function LanguageProvider({ children, initialLang }) {
  const [lang, setLangState] = useState(() => initialLang || readLangCookie() || DEFAULT_LANG);

  const setLang = useCallback((next) => {
    if (!LANGUAGES[next]) return;
    writeLangCookie(next);
    setLangState(next);
  }, []);

  // The whole page follows the language: <html lang> for screen readers and fonts,
  // <html dir> so layout and text alignment mirror.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGUAGES[lang].dir;
  }, [lang]);

  const value = useMemo(() => buildValue(lang, setLang), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

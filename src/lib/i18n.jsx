// Interface language (Arabic / English). Arabic is the default. The choice is kept in the
// `wmm_lang` cookie so it survives reloads and applies before sign-in (login page included).
//
//   const { t, lang, dir, locale, toggleLang } = useI18n();
//   t("header.logout")                    → "خروج" / "Log out"
//   t("list.count", { count: 5 })         → "5 عملية" / "5 transactions"
//
// Components used without a <LanguageProvider> (e.g. in unit tests) get Arabic.
//
// Digits: in Arabic, the Number style setting can show Arabic-Indic digits (٠١٢٣…). t() converts
// numeric params automatically ({count}); formatted text (amounts, dates, the clock) goes through
// num(). Identifiers people copy — phones, reference and customer numbers — are left as they are.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import ar from "@/locales/ar";
import en from "@/locales/en";
import { COOKIES, readCookie, writeCookie } from "@/lib/cookies";

export const LANG_COOKIE = COOKIES.lang;
export const DEFAULT_LANG = "ar";

export const LANGUAGES = {
  // `label` is each language's own name in its own script; `short` is what the switch shows.
  ar: { dictionary: ar, dir: "rtl", locale: "ar-u-nu-latn", label: "العربية", short: "ع" },
  en: { dictionary: en, dir: "ltr", locale: "en-US", label: "English", short: "EN" },
};

export const readLangCookie = () => {
  const value = readCookie(LANG_COOKIE);
  return value === "ar" || value === "en" ? value : null;
};

export const writeLangCookie = (lang) => writeCookie(LANG_COOKIE, lang);

// Looks up a key (falling back to Arabic, then to the key itself), picks a plural form when the
// entry is { one, other } and `count` is given, and fills {placeholders}. `display` holds the text
// to show for each param when it differs from the value (e.g. count 5 shown as "٥").
export const translate = (lang, key, params = {}, display = params) => {
  const dictionary = (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANG]).dictionary;
  let entry = dictionary[key] ?? LANGUAGES[DEFAULT_LANG].dictionary[key] ?? key;
  if (entry && typeof entry === "object") {
    entry = (params.count === 1 ? entry.one : entry.other) ?? entry.other ?? key;
  }
  return String(entry).replace(/\{(\w+)\}/g, (match, name) => (display[name] !== undefined ? String(display[name]) : match));
};

// "1,234.50" → "١٬٢٣٤٫٥٠": digits, and the separators between digits.
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const toArabicDigits = (text) =>
  String(text)
    .replace(/(\d),(?=\d)/g, "$1٬")
    .replace(/(\d)\.(?=\d)/g, "$1٫")
    .replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

// The API answers in English; show known messages in the interface language.
export const translateServerError = (lang, message) => {
  const errors = (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANG]).dictionary.__serverErrors || {};
  return errors[message] || message;
};

const buildValue = (lang, setLang, numerals = "western", setNumerals = () => {}) => {
  const arabicDigits = lang === "ar" && numerals === "arabic";
  const num = (value) => (arabicDigits ? toArabicDigits(value) : String(value));
  return {
    lang,
    dir: LANGUAGES[lang].dir,
    locale: LANGUAGES[lang].locale,
    numerals,
    num,
    t: (key, params) => {
      if (!arabicDigits || !params) return translate(lang, key, params);
      // Numbers passed as numbers ({count}) follow the digit style; text params are left alone.
      const converted = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "number" ? num(v) : v]));
      return translate(lang, key, params, converted);
    },
    errorText: (message) => translateServerError(lang, message),
    setLang,
    setNumerals,
    toggleLang: () => setLang(lang === "ar" ? "en" : "ar"),
  };
};

const I18nContext = createContext(buildValue(DEFAULT_LANG, () => {}));

export function LanguageProvider({ children, initialLang }) {
  const [lang, setLangState] = useState(() => initialLang || readLangCookie() || DEFAULT_LANG);
  // Set by PreferencesProvider from the signed-in user's Number style setting.
  const [numerals, setNumerals] = useState("western");

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

  const value = useMemo(() => buildValue(lang, setLang, numerals, setNumerals), [lang, setLang, numerals]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

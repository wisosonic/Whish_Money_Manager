// The signed-in user's display preferences (Settings page): language, visible table columns,
// row density and which summaries start open. Stored on the server per user, so they follow the
// user to any device; the rules and defaults are shared with the API (src/lib/preferences.js).
//
//   const { preferences, savePreferences, setLanguage, status } = usePreferences();
//
// Changes apply at once (optimistically) and are saved in the background; if the server refuses,
// the previous values come back and `status` becomes "error".
// Components rendered without a <PreferencesProvider> (e.g. in unit tests) get the defaults.
//
// Theme: "dark" (or "system" while the device is in dark mode) puts the `dark` class on <html>;
// the dark palette lives in src/assets/css/index.css. The choice is mirrored to the `wmm_theme`
// cookie so index.html can apply it before the first paint (no white flash on reload).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { configureNotify, notify } from "@/lib/notify";
import { DEFAULT_PREFERENCES, resolvePreferences } from "@/lib/preferences";

export const THEME_COOKIE = "wmm_theme";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const PreferencesContext = createContext({
  preferences: resolvePreferences(DEFAULT_PREFERENCES),
  savePreferences: async () => {},
  setLanguage: null,
  status: "idle",
  error: "",
  isDark: false,
});

const prefersDarkQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function PreferencesProvider({ children }) {
  const { user, isLoadingAuth } = useAuth();
  const { setLang, setNumerals, t, errorText } = useI18n();
  // The translation in effect when a save finishes (not when it started): changing the language is
  // itself a save, and its confirmation must appear in the new language.
  const i18nNow = useRef({ t, errorText });
  i18nNow.current = { t, errorText };
  const [preferences, setPreferences] = useState(() => resolvePreferences(user?.preferences));
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  // The last values the server confirmed (what we fall back to if a save fails). Saves are sent one
  // at a time, in order (`queue`), so each answer already includes every earlier change; while a
  // newer change is waiting, an older answer isn't shown, so it can't undo that change on screen.
  const confirmed = useRef(preferences);
  const latestSave = useRef(0);
  const queue = useRef(Promise.resolve());

  // A different user signed in (or out): take their stored preferences, and their saved language
  // if they ever chose one while signed in.
  const userId = user?.id ?? null;
  useEffect(() => {
    const stored = resolvePreferences(user?.preferences);
    confirmed.current = stored;
    setPreferences(stored);
    setStatus("idle");
    setError("");
    if (stored.language) setLang(stored.language);
    // Only when the account changes — not on every user object refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Success and failure are both reported; toasts share one id, so quick changes update one toast.
  const savePreferences = useCallback((changes) => {
    if (!userId) return Promise.resolve();
    const saveId = ++latestSave.current;
    setPreferences((prev) => resolvePreferences({
      ...prev,
      ...changes,
      summaries: { ...prev.summaries, ...(changes.summaries || {}) },
      // A partial default sort (just the direction, or just the column) keeps the other half.
      defaultSort: { ...prev.defaultSort, ...(changes.defaultSort || {}) },
    }));
    setStatus("saving");
    setError("");
    const send = async () => {
      try {
        const updated = await api.auth.updatePreferences(changes);
        confirmed.current = resolvePreferences(updated?.preferences);
        if (saveId !== latestSave.current) return;
        setPreferences(confirmed.current);
        setStatus("saved");
        notify.success(i18nNow.current.t("toast.settings.saved"), { id: "settings-save" });
      } catch (err) {
        // A newer save is still coming; its answer (the server's full state) will settle the screen.
        if (saveId !== latestSave.current) return;
        setPreferences(confirmed.current);
        setStatus("error");
        setError(err?.message || "");
        const { t: tNow, errorText: errorTextNow } = i18nNow.current;
        notify.error(err?.message ? errorTextNow(err.message) : tNow("settings.saveFailed"), { id: "settings-save" });
      }
    };
    queue.current = queue.current.then(send);
    return queue.current;
  }, [userId]);

  // Number style (digits in Arabic) and notification settings follow the preferences.
  useEffect(() => { setNumerals(preferences.numerals); }, [preferences.numerals, setNumerals]);
  useEffect(() => {
    configureNotify({ duration: preferences.toastDuration, showSuccess: preferences.toastSuccess });
  }, [preferences.toastDuration, preferences.toastSuccess]);

  // ═══ Theme ═══
  const [isDark, setIsDark] = useState(false);
  const theme = preferences.theme;
  useEffect(() => {
    // While the session is still being checked, keep whatever index.html applied from the cookie.
    if (isLoadingAuth) return undefined;
    const root = document.documentElement;
    const media = theme === "system" ? prefersDarkQuery() : null;
    const apply = () => {
      const dark = theme === "dark" || Boolean(media?.matches);
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
      setIsDark(dark);
    };
    apply();
    if (userId) {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
    }
    media?.addEventListener?.("change", apply);
    return () => media?.removeEventListener?.("change", apply);
  }, [theme, userId, isLoadingAuth]);

  // Switching language on the Settings page also remembers it for the account; on the login page
  // (signed out) it only changes the interface.
  const setLanguage = useCallback((lang) => {
    setLang(lang);
    if (userId) savePreferences({ language: lang });
  }, [setLang, savePreferences, userId]);

  const value = useMemo(
    () => ({ preferences, savePreferences, setLanguage, status, error, isDark }),
    [preferences, savePreferences, setLanguage, status, error, isDark]
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

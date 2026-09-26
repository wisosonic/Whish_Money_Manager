// Everything the app remembers in the browser lives in cookies (user's request, 2026-09-26): one
// year, the whole site, SameSite=Lax, Secure over HTTPS. They're readable by the page on purpose
// (index.html applies the language and theme before the first paint). Nothing secret goes here —
// the session is a separate HttpOnly cookie set by the server.
//
//   wmm_lang            interface language (also read by index.html)
//   wmm_theme           light / dark / system (also read by index.html)
//   wmm_prefs           every personal setting of the account last signed in on this browser:
//                       { u: user id, p: preferences } (src/lib/PreferencesContext.jsx)
//   wmm_selected_date   the dashboard's last day viewed
//   wmm_selected_store  the Admin's chosen store on the dashboard ("all" or an id)

export const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
export const COOKIES = {
  lang: "wmm_lang",
  theme: "wmm_theme",
  preferences: "wmm_prefs",
  selectedDate: "wmm_selected_date",
  selectedStore: "wmm_selected_store",
};

const hasDocument = () => typeof document !== "undefined";
const escapeName = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const readCookie = (name) => {
  if (!hasDocument()) return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escapeName(name)}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // a damaged value: treated as missing
  }
};

// The attributes every app cookie gets (exported for tests).
export const cookieAttributes = (maxAge = ONE_YEAR_SECONDS) => {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  return `; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
};

export const writeCookie = (name, value) => {
  if (!hasDocument()) return;
  document.cookie = `${name}=${encodeURIComponent(String(value))}${cookieAttributes()}`;
};

export const removeCookie = (name) => {
  if (!hasDocument()) return;
  document.cookie = `${name}=${cookieAttributes(0)}`;
};

// A value remembered in a cookie. `legacyKey`: where older versions kept it (localStorage): read
// once, moved into the cookie and removed, so nobody loses their last day or store on upgrade.
export const readRemembered = (name, legacyKey) => {
  const value = readCookie(name);
  if (value !== null || !legacyKey) return value;
  try {
    const old = window.localStorage.getItem(legacyKey);
    if (old === null) return null;
    writeCookie(name, old);
    window.localStorage.removeItem(legacyKey);
    return old;
  } catch {
    return null; // storage unavailable
  }
};

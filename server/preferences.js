// Per-user display preferences, shared by the API (validation, storage) and the UI (defaults,
// column list) — the same pattern as permissions.js. Stored as JSON in users.preferences.
//
//   language       "ar" | "en" | null   null = never chosen while signed in: keep the browser's cookie
//   hiddenColumns  column keys           transactions table columns the user turned off
//   density        "comfortable" | "compact"
//   summaries      { month, year }       whether each summary block starts expanded
//   theme          "light" | "dark" | "system"   "system" follows the device's light/dark setting

// Transactions table data columns, in display order (the checkbox and actions columns always show).
export const TABLE_COLUMNS = [
  "index", "type", "sender", "receiver", "amount", "commissionRate",
  "commission", "reference", "service", "note", "date",
];

export const PREFERENCE_LANGUAGES = ["ar", "en"];
export const DENSITIES = ["comfortable", "compact"];
export const THEMES = ["light", "dark", "system"];

// The defaults reproduce the app as it was before settings existed (monthly summary open,
// yearly closed, every column visible, roomy rows).
export const DEFAULT_PREFERENCES = Object.freeze({
  language: null,
  hiddenColumns: Object.freeze([]),
  density: "comfortable",
  summaries: Object.freeze({ month: true, year: false }),
  theme: "light",
});

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Stored JSON (or anything else) → a complete, valid preferences object. Tolerant: unknown or bad
// values fall back to the defaults, so an old or hand-edited row can never break the page.
export const resolvePreferences = (stored) => {
  let value = stored;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const source = isPlainObject(value) ? value : {};
  const summaries = isPlainObject(source.summaries) ? source.summaries : {};
  const hidden = Array.isArray(source.hiddenColumns)
    ? [...new Set(source.hiddenColumns.filter((key) => TABLE_COLUMNS.includes(key)))]
    : [];
  return {
    language: PREFERENCE_LANGUAGES.includes(source.language) ? source.language : null,
    // Never hide everything: a table with no data columns is useless.
    hiddenColumns: hidden.length >= TABLE_COLUMNS.length ? [] : hidden,
    density: DENSITIES.includes(source.density) ? source.density : DEFAULT_PREFERENCES.density,
    summaries: {
      month: typeof summaries.month === "boolean" ? summaries.month : DEFAULT_PREFERENCES.summaries.month,
      year: typeof summaries.year === "boolean" ? summaries.year : DEFAULT_PREFERENCES.summaries.year,
    },
    theme: THEMES.includes(source.theme) ? source.theme : DEFAULT_PREFERENCES.theme,
  };
};

// A change sent by the client → { preferences } merged over `current`, or { error }. Strict:
// anything unexpected is rejected rather than silently dropped, so client bugs surface.
export const applyPreferenceChanges = (current, changes) => {
  if (!isPlainObject(changes)) return { error: "Invalid preferences" };
  const next = resolvePreferences(current);

  for (const [key, value] of Object.entries(changes)) {
    switch (key) {
      case "language":
        if (value !== null && !PREFERENCE_LANGUAGES.includes(value)) return { error: "Invalid preferences" };
        next.language = value;
        break;
      case "hiddenColumns":
        if (!Array.isArray(value) || value.some((column) => !TABLE_COLUMNS.includes(column))) {
          return { error: "Invalid preferences" };
        }
        if (new Set(value).size >= TABLE_COLUMNS.length) return { error: "At least one column must stay visible" };
        next.hiddenColumns = [...new Set(value)];
        break;
      case "density":
        if (!DENSITIES.includes(value)) return { error: "Invalid preferences" };
        next.density = value;
        break;
      case "theme":
        if (!THEMES.includes(value)) return { error: "Invalid preferences" };
        next.theme = value;
        break;
      case "summaries":
        if (!isPlainObject(value)) return { error: "Invalid preferences" };
        for (const [part, open] of Object.entries(value)) {
          if (!["month", "year"].includes(part) || typeof open !== "boolean") return { error: "Invalid preferences" };
          next.summaries[part] = open;
        }
        break;
      default:
        return { error: "Invalid preferences" };
    }
  }
  return { preferences: next };
};

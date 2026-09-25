// Per-user display preferences, shared by the API (validation, storage) and the UI (defaults,
// column list) — the same pattern as permissions.js. Stored as JSON in users.preferences.
//
//   language       "ar" | "en" | null   null = never chosen while signed in: keep the browser's cookie
//   hiddenColumns  column keys           transactions table columns the user turned off
//   density        "comfortable" | "compact"
//   summaries      { month, year }       whether each summary block starts expanded
//   theme          "light" | "dark" | "system"   "system" follows the device's light/dark setting
//   startOn        "last" | "today"      which day the dashboard opens on
//   searchScope    "all" | "day"         where a search looks by default
//   defaultSort    { key, dir }          the table's sort when it opens (key null = journal order)
//   clock          "12h" | "24h" | "hidden"
//   numerals       "western" | "arabic"  digits in the Arabic interface (0123 or ٠١٢٣)
//   toastDuration  "short" | "normal" | "long"
//   toastSuccess   boolean               false = only warnings and errors are shown
//   rowsPerPage    0 | 25 | 50 | 100     0 = every row on one page

// Transactions table data columns, in display order (the checkbox and actions columns always show).
export const TABLE_COLUMNS = [
  "index", "type", "sender", "receiver", "amount", "commissionRate",
  "commission", "reference", "service", "note", "date",
];

export const PREFERENCE_LANGUAGES = ["ar", "en"];
export const DENSITIES = ["comfortable", "compact"];
export const THEMES = ["light", "dark", "system"];
export const START_ON = ["last", "today"];
export const SEARCH_SCOPES = ["all", "day"];
export const SORT_DIRECTIONS = ["asc", "desc"];
export const CLOCKS = ["12h", "24h", "hidden"];
export const NUMERALS = ["western", "arabic"];
export const TOAST_DURATIONS = ["short", "normal", "long"];
export const ROWS_PER_PAGE = [0, 25, 50, 100];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The defaults reproduce the app as it was before settings existed (monthly summary open,
// yearly closed, every column visible, roomy rows).
export const DEFAULT_PREFERENCES = Object.freeze({
  language: null,
  hiddenColumns: Object.freeze([]),
  density: "comfortable",
  summaries: Object.freeze({ month: true, year: false }),
  theme: "light",
  startOn: "last",
  searchScope: "all",
  defaultSort: Object.freeze({ key: null, dir: "asc" }),
  clock: "12h",
  numerals: "western",
  toastDuration: "normal",
  toastSuccess: true,
  rowsPerPage: 0,
});

const oneOf = (list, value, fallback) => (list.includes(value) ? value : fallback);
const resolveSort = (value) => {
  const sort = isPlainObject(value) ? value : {};
  return {
    key: TABLE_COLUMNS.includes(sort.key) ? sort.key : null,
    dir: oneOf(SORT_DIRECTIONS, sort.dir, "asc"),
  };
};

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
    startOn: oneOf(START_ON, source.startOn, DEFAULT_PREFERENCES.startOn),
    searchScope: oneOf(SEARCH_SCOPES, source.searchScope, DEFAULT_PREFERENCES.searchScope),
    defaultSort: resolveSort(source.defaultSort),
    clock: oneOf(CLOCKS, source.clock, DEFAULT_PREFERENCES.clock),
    numerals: oneOf(NUMERALS, source.numerals, DEFAULT_PREFERENCES.numerals),
    toastDuration: oneOf(TOAST_DURATIONS, source.toastDuration, DEFAULT_PREFERENCES.toastDuration),
    toastSuccess: typeof source.toastSuccess === "boolean" ? source.toastSuccess : DEFAULT_PREFERENCES.toastSuccess,
    rowsPerPage: oneOf(ROWS_PER_PAGE, source.rowsPerPage, DEFAULT_PREFERENCES.rowsPerPage),
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
      case "startOn":
      case "searchScope":
      case "clock":
      case "numerals":
      case "toastDuration":
      case "rowsPerPage": {
        const allowed = { startOn: START_ON, searchScope: SEARCH_SCOPES, clock: CLOCKS, numerals: NUMERALS, toastDuration: TOAST_DURATIONS, rowsPerPage: ROWS_PER_PAGE }[key];
        if (!allowed.includes(value)) return { error: "Invalid preferences" };
        next[key] = value;
        break;
      }
      case "toastSuccess":
        if (typeof value !== "boolean") return { error: "Invalid preferences" };
        next.toastSuccess = value;
        break;
      case "defaultSort":
        if (!isPlainObject(value) || Object.keys(value).some((k) => !["key", "dir"].includes(k))) return { error: "Invalid preferences" };
        if (value.key !== null && value.key !== undefined && !TABLE_COLUMNS.includes(value.key)) return { error: "Invalid preferences" };
        if (value.dir !== undefined && !SORT_DIRECTIONS.includes(value.dir)) return { error: "Invalid preferences" };
        // "key" sent as null means journal order; a missing key keeps the current one.
        next.defaultSort = { key: "key" in value ? value.key : next.defaultSort.key, dir: value.dir ?? next.defaultSort.dir };
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

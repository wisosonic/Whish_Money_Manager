// Single source of truth shared with the API: the same column list, defaults and rules the server
// uses to validate and store each user's preferences.
export {
  TABLE_COLUMNS,
  PREFERENCE_LANGUAGES,
  DENSITIES,
  THEMES,
  START_ON,
  SEARCH_SCOPES,
  SORT_DIRECTIONS,
  CLOCKS,
  NUMERALS,
  TOAST_DURATIONS,
  ROWS_PER_PAGE,
  DEFAULT_PREFERENCES,
  resolvePreferences,
  applyPreferenceChanges,
} from "../../server/preferences.js";

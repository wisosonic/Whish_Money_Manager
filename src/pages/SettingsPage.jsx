import { Languages, Columns3, LayoutList, RotateCcw, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import Header from "@/components/layout/Header";
import { LANGUAGES, useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/PreferencesContext";
import { DEFAULT_PREFERENCES, DENSITIES, TABLE_COLUMNS } from "@/lib/preferences";

// Per-user settings: language, which transactions-table columns show, and display options.
// Every change applies immediately and is saved to the account (PreferencesContext).
function Section({ id, icon: Icon, title, description, children }) {
  return (
    <section className="bg-white rounded-xl shadow p-4 md:p-6 min-w-0" aria-labelledby={id} data-testid={id}>
      <div className="flex items-start gap-3 mb-4">
        <div className="bg-blue-50 text-blue-700 rounded-lg p-2 shrink-0">
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-gray-800 text-lg" id={id}>{title}</h2>
          {description && <p className="text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// A selectable card wrapping a native radio or checkbox (keyboard and screen readers work natively).
function Choice({ type, name, checked, disabled, onChange, label, hint, lang, testId }) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"} ${checked ? "border-blue-400 bg-blue-50/60" : "border-gray-200"}`}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        data-testid={testId}
        className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium text-gray-800" lang={lang}>{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const { t, dir, lang, errorText } = useI18n();
  const { preferences, savePreferences, setLanguage, status, error } = usePreferences();
  const hidden = new Set(preferences.hiddenColumns);
  const visibleCount = TABLE_COLUMNS.length - hidden.size;

  const toggleColumn = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    savePreferences({ hiddenColumns: TABLE_COLUMNS.filter((column) => next.has(column)) });
  };

  const isDefaultDisplay =
    hidden.size === 0 &&
    preferences.density === DEFAULT_PREFERENCES.density &&
    preferences.summaries.month === DEFAULT_PREFERENCES.summaries.month &&
    preferences.summaries.year === DEFAULT_PREFERENCES.summaries.year;

  const resetDisplay = () => savePreferences({
    hiddenColumns: [],
    density: DEFAULT_PREFERENCES.density,
    summaries: { ...DEFAULT_PREFERENCES.summaries },
  });

  const columnLabel = (key) => (key === "index" ? `${t("columns.number")} (#)` : t(`columns.${key}`));

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <main className="p-3 md:p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{t("settings.title")}</h1>
            <p className="text-sm text-gray-500">{t("settings.subtitle")}</p>
          </div>
          {/* Save status, announced politely to screen readers. */}
          <p role="status" aria-live="polite" data-testid="settings-status" className="text-sm font-medium min-h-[1.25rem] flex items-center gap-1.5">
            {status === "saving" && <><Loader2 className="w-4 h-4 animate-spin text-gray-500" aria-hidden="true" /><span className="text-gray-500">{t("settings.saving")}</span></>}
            {status === "saved" && <><CheckCircle2 className="w-4 h-4 text-green-700" aria-hidden="true" /><span className="text-green-700">{t("settings.saved")}</span></>}
            {status === "error" && <><AlertCircle className="w-4 h-4 text-red-600" aria-hidden="true" /><span className="text-red-600">{error ? errorText(error) : t("settings.saveFailed")}</span></>}
          </p>
        </div>

        <Section id="settings-language" icon={Languages} title={t("settings.language.title")} description={t("settings.language.description")}>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("settings.language.title")}>
            {Object.entries(LANGUAGES).map(([code, info]) =>
              <Choice
                key={code}
                type="radio"
                name="language"
                checked={lang === code}
                onChange={() => setLanguage(code)}
                label={info.label}
                lang={code}
                testId={`language-${code}`} />
            )}
          </div>
        </Section>

        <Section id="settings-columns" icon={Columns3} title={t("settings.columns.title")} description={t("settings.columns.description")}>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3" role="group" aria-label={t("settings.columns.title")}>
            {TABLE_COLUMNS.map((key) => {
              const visible = !hidden.has(key);
              return (
                <Choice
                  key={key}
                  type="checkbox"
                  checked={visible}
                  // The last visible column can't be turned off: the table needs at least one.
                  disabled={visible && visibleCount === 1}
                  onChange={() => toggleColumn(key)}
                  label={columnLabel(key)}
                  testId={`column-${key}`} />
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
            <p className="text-xs text-gray-500" data-testid="columns-count">
              {t("settings.columns.count", { visible: visibleCount, total: TABLE_COLUMNS.length })}
              {visibleCount === 1 && <span className="ms-1">{t("settings.columns.lastOne")}</span>}
            </p>
            <button
              type="button"
              onClick={() => savePreferences({ hiddenColumns: [] })}
              disabled={hidden.size === 0}
              className="text-sm text-blue-700 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              {t("settings.columns.showAll")}
            </button>
          </div>
        </Section>

        <Section id="settings-display" icon={LayoutList} title={t("settings.display.title")} description={t("settings.display.description")}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2" id="density-label">{t("settings.density.title")}</h3>
          <div className="grid gap-2 sm:grid-cols-2 mb-5" role="radiogroup" aria-labelledby="density-label">
            {DENSITIES.map((density) =>
              <Choice
                key={density}
                type="radio"
                name="density"
                checked={preferences.density === density}
                onChange={() => savePreferences({ density })}
                label={t(`settings.density.${density}`)}
                hint={t(`settings.density.${density}Hint`)}
                testId={`density-${density}`} />
            )}
          </div>

          <h3 className="text-sm font-semibold text-gray-700 mb-2" id="summaries-label">{t("settings.summaries.title")}</h3>
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-labelledby="summaries-label">
            {["month", "year"].map((part) =>
              <Choice
                key={part}
                type="checkbox"
                checked={preferences.summaries[part]}
                onChange={() => savePreferences({ summaries: { [part]: !preferences.summaries[part] } })}
                label={t(`settings.summaries.${part}`)}
                testId={`summary-${part}`} />
            )}
          </div>
        </Section>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetDisplay}
            disabled={isDefaultDisplay}
            data-testid="settings-reset"
            className="flex items-center gap-2 border border-gray-300 bg-white rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            {t("settings.reset")}
          </button>
        </div>
      </main>
    </div>
  );
}

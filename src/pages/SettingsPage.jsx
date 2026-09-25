import { useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Languages, Columns3, LayoutList, RotateCcw, CheckCircle2, Loader2, AlertCircle,
  SlidersHorizontal, Palette, Table2, Bell, Building2, DatabaseBackup, Clock3, CalendarDays, ArrowUpDown,
} from "lucide-react";
import Header from "@/components/layout/Header";
import { Section, Choice, RadioGroup } from "@/components/settings/SettingsControls";
import CommissionRates from "@/components/settings/CommissionRates";
import RestoreBackup from "@/components/settings/RestoreBackup";
import { useAuth } from "@/lib/AuthContext";
import { LANGUAGES, useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/PreferencesContext";
import { PERMISSIONS } from "@/lib/permissions";
import {
  CLOCKS, DEFAULT_PREFERENCES, DENSITIES, NUMERALS, ROWS_PER_PAGE, SEARCH_SCOPES, START_ON, TABLE_COLUMNS,
  THEMES, TOAST_DURATIONS,
} from "@/lib/preferences";

// Settings, grouped in tabs. Personal tabs (every user): General, Appearance, Transactions table,
// Notifications — saved to the account at once (PreferencesContext). Office tabs (Admin + Manager):
// Office (commission rate) and Backup & restore. The open tab is kept in the URL (#table …).
const PERSONAL_DEFAULTS = {
  hiddenColumns: [],
  theme: DEFAULT_PREFERENCES.theme,
  density: DEFAULT_PREFERENCES.density,
  summaries: { ...DEFAULT_PREFERENCES.summaries },
  startOn: DEFAULT_PREFERENCES.startOn,
  searchScope: DEFAULT_PREFERENCES.searchScope,
  defaultSort: { ...DEFAULT_PREFERENCES.defaultSort },
  clock: DEFAULT_PREFERENCES.clock,
  numerals: DEFAULT_PREFERENCES.numerals,
  toastDuration: DEFAULT_PREFERENCES.toastDuration,
  toastSuccess: DEFAULT_PREFERENCES.toastSuccess,
  rowsPerPage: DEFAULT_PREFERENCES.rowsPerPage,
};

export default function SettingsPage() {
  const { t, dir, lang, errorText } = useI18n();
  const { can } = useAuth();
  const { preferences, savePreferences, setLanguage, status, error } = usePreferences();
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    { id: "general", icon: SlidersHorizontal },
    { id: "appearance", icon: Palette },
    { id: "table", icon: Table2 },
    { id: "notifications", icon: Bell },
    ...(can(PERMISSIONS.OFFICE_SETTINGS) ? [{ id: "office", icon: Building2 }] : []),
    ...(can(PERMISSIONS.DATA_RESTORE) ? [{ id: "backup", icon: DatabaseBackup }] : []),
  ];
  const requested = location.hash.replace("#", "");
  const active = tabs.some((tab) => tab.id === requested) ? requested : "general";
  const tabRefs = useRef({});
  const openTab = (id, focus = false) => {
    navigate({ hash: id }, { replace: true });
    if (focus) tabRefs.current[id]?.focus();
  };
  // Tabs keyboard pattern: arrows move between tabs (both orientations), Home / End jump.
  const onTabKey = (e) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    const forward = ["ArrowDown", dir === "rtl" ? "ArrowLeft" : "ArrowRight"];
    const back = ["ArrowUp", dir === "rtl" ? "ArrowRight" : "ArrowLeft"];
    let next = null;
    if (forward.includes(e.key)) next = (index + 1) % tabs.length;
    else if (back.includes(e.key)) next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    openTab(tabs[next].id, true);
  };

  // ─── Columns ───
  const hidden = new Set(preferences.hiddenColumns);
  const visibleCount = TABLE_COLUMNS.length - hidden.size;
  const toggleColumn = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    savePreferences({ hiddenColumns: TABLE_COLUMNS.filter((column) => next.has(column)) });
  };
  const columnLabel = (key) => (key === "index" ? `${t("columns.number")} (#)` : t(`columns.${key}`));

  const isDefault = Object.entries(PERSONAL_DEFAULTS).every(([key, value]) => JSON.stringify(preferences[key]) === JSON.stringify(value));

  const options = (list, prefix, extra = () => ({})) => list.map((value) => ({ value, label: t(`${prefix}.${value}`), ...extra(value) }));

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <main className="p-3 md:p-6 max-w-5xl mx-auto space-y-4">
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

        <div className="grid gap-4 md:grid-cols-[13rem_1fr] items-start">
          {/* Tabs: a row that scrolls on phones, a column beside the content on wider screens. */}
          <div
            role="tablist"
            aria-label={t("settings.title")}
            aria-orientation="vertical"
            className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible bg-white rounded-xl shadow p-1.5 md:sticky md:top-[calc(var(--app-header-height,0px)+1rem)]">
            {tabs.map(({ id, icon: Icon }) =>
              <button
                key={id}
                ref={(el) => { tabRefs.current[id] = el; }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={active === id}
                aria-controls={`panel-${id}`}
                tabIndex={active === id ? 0 : -1}
                onClick={() => openTab(id)}
                onKeyDown={onTabKey}
                data-testid={`tab-${id}`}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${active === id ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}>
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t(`settings.tab.${id}`)}
              </button>
            )}
          </div>

          <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="space-y-4 min-w-0">
            {active === "general" && <>
              <Section id="settings-language" icon={Languages} title={t("settings.language.title")} description={t("settings.language.description")}>
                <RadioGroup
                  id="language"
                  label={t("settings.language.title")}
                  labelHidden
                  options={Object.entries(LANGUAGES).map(([code, info]) => ({ value: code, label: info.label, lang: code }))}
                  value={lang}
                  onChange={setLanguage} />
              </Section>
              <Section id="settings-startup" icon={CalendarDays} title={t("settings.startup.title")} description={t("settings.startup.description")}>
                <RadioGroup id="startOn" label={t("settings.startOn.title")} options={options(START_ON, "settings.startOn", (v) => ({ hint: t(`settings.startOn.${v}Hint`) }))}
                  value={preferences.startOn} onChange={(startOn) => savePreferences({ startOn })} />
              </Section>
              <Section id="settings-format" icon={Clock3} title={t("settings.format.title")} description={t("settings.format.description")}>
                <RadioGroup id="clock" label={t("settings.clock.title")} columns="sm:grid-cols-3"
                  options={options(CLOCKS, "settings.clock")} value={preferences.clock} onChange={(clock) => savePreferences({ clock })} />
                <RadioGroup id="numerals" label={t("settings.numerals.title")} hint={t("settings.numerals.hint")}
                  options={options(NUMERALS, "settings.numerals")} value={preferences.numerals} onChange={(numerals) => savePreferences({ numerals })} />
              </Section>
            </>}

            {active === "appearance" && <>
              <Section id="settings-display" icon={LayoutList} title={t("settings.display.title")} description={t("settings.display.description")}>
                <RadioGroup id="theme" label={t("settings.theme.title")} columns="sm:grid-cols-3"
                  options={options(THEMES, "settings.theme", (v) => ({ hint: t(`settings.theme.${v}Hint`) }))}
                  value={preferences.theme} onChange={(theme) => savePreferences({ theme })} />
                <RadioGroup id="density" label={t("settings.density.title")}
                  options={options(DENSITIES, "settings.density", (v) => ({ hint: t(`settings.density.${v}Hint`) }))}
                  value={preferences.density} onChange={(density) => savePreferences({ density })} />
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2" id="summaries-label">{t("settings.summaries.title")}</h3>
                  <div className="grid gap-2 sm:grid-cols-2" role="group" aria-labelledby="summaries-label">
                    {["month", "year"].map((part) =>
                      <Choice key={part} type="checkbox" checked={preferences.summaries[part]}
                        onChange={() => savePreferences({ summaries: { [part]: !preferences.summaries[part] } })}
                        label={t(`settings.summaries.${part}`)} testId={`summary-${part}`} />
                    )}
                  </div>
                </div>
              </Section>
            </>}

            {active === "table" && <>
              <Section id="settings-columns" icon={Columns3} title={t("settings.columns.title")} description={t("settings.columns.description")}>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={t("settings.columns.title")}>
                  {TABLE_COLUMNS.map((key) => {
                    const visible = !hidden.has(key);
                    return (
                      <Choice key={key} type="checkbox" checked={visible}
                        // The last visible column can't be turned off: the table needs at least one.
                        disabled={visible && visibleCount === 1}
                        onChange={() => toggleColumn(key)} label={columnLabel(key)} testId={`column-${key}`} />
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                  <p className="text-xs text-gray-500" data-testid="columns-count">
                    {t("settings.columns.count", { visible: visibleCount, total: TABLE_COLUMNS.length })}
                    {visibleCount === 1 && <span className="ms-1">{t("settings.columns.lastOne")}</span>}
                  </p>
                  <button type="button" onClick={() => savePreferences({ hiddenColumns: [] })} disabled={hidden.size === 0}
                    className="text-sm text-blue-700 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                    {t("settings.columns.showAll")}
                  </button>
                </div>
              </Section>

              <Section id="settings-table-behaviour" icon={ArrowUpDown} title={t("settings.tableBehaviour.title")} description={t("settings.tableBehaviour.description")}>
                <div className="mb-5">
                  <h3 className="text-sm font-semibold text-gray-700" id="defaultSort-label">{t("settings.defaultSort.title")}</h3>
                  <p className="text-xs text-gray-500 mb-2">{t("settings.defaultSort.hint")}</p>
                  <div className="flex flex-wrap items-center gap-3" role="group" aria-labelledby="defaultSort-label">
                    <select
                      value={preferences.defaultSort.key ?? ""}
                      onChange={(e) => savePreferences({ defaultSort: { key: e.target.value || null } })}
                      aria-label={t("settings.defaultSort.column")}
                      data-testid="defaultSort-column"
                      className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <option value="">{t("settings.defaultSort.none")}</option>
                      {TABLE_COLUMNS.map((key) => <option key={key} value={key}>{columnLabel(key)}</option>)}
                    </select>
                    {["asc", "desc"].map((sortDir) =>
                      <label key={sortDir} className={`flex items-center gap-2 text-sm ${preferences.defaultSort.key ? "cursor-pointer" : "opacity-50"}`}>
                        <input type="radio" name="defaultSort-dir" checked={preferences.defaultSort.dir === sortDir}
                          disabled={!preferences.defaultSort.key} onChange={() => savePreferences({ defaultSort: { dir: sortDir } })}
                          data-testid={`defaultSort-${sortDir}`} className="w-4 h-4 accent-blue-600" />
                        {t(`settings.defaultSort.${sortDir}`)}
                      </label>
                    )}
                  </div>
                </div>
                <RadioGroup id="rowsPerPage" label={t("settings.rowsPerPage.title")} hint={t("settings.rowsPerPage.hint")} columns="grid-cols-2 sm:grid-cols-4"
                  options={ROWS_PER_PAGE.map((value) => ({ value, label: value ? t("settings.rowsPerPage.count", { count: value }) : t("settings.rowsPerPage.all") }))}
                  value={preferences.rowsPerPage} onChange={(rowsPerPage) => savePreferences({ rowsPerPage })} />
                <RadioGroup id="searchScope" label={t("settings.searchScope.title")} hint={t("settings.searchScope.hint")}
                  options={options(SEARCH_SCOPES, "list.scope")} value={preferences.searchScope} onChange={(searchScope) => savePreferences({ searchScope })} />
              </Section>
            </>}

            {active === "notifications" && <>
              <Section id="settings-notifications" icon={Bell} title={t("settings.notifications.title")} description={t("settings.notifications.description")}>
                <RadioGroup id="toastDuration" label={t("settings.toastDuration.title")} columns="sm:grid-cols-3"
                  options={options(TOAST_DURATIONS, "settings.toastDuration", (v) => ({ hint: t(`settings.toastDuration.${v}Hint`) }))}
                  value={preferences.toastDuration} onChange={(toastDuration) => savePreferences({ toastDuration })} />
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">{t("settings.toastSuccess.title")}</h3>
                  <Choice type="checkbox" checked={preferences.toastSuccess}
                    onChange={() => savePreferences({ toastSuccess: !preferences.toastSuccess })}
                    label={t("settings.toastSuccess.label")} hint={t("settings.toastSuccess.hint")} testId="toastSuccess" />
                </div>
              </Section>
            </>}

            {active === "office" && <CommissionRates />}
            {active === "backup" && <RestoreBackup />}

            {["general", "appearance", "table", "notifications"].includes(active) &&
              <div className="flex justify-end">
                <button type="button" onClick={() => savePreferences(PERSONAL_DEFAULTS)} disabled={isDefault} data-testid="settings-reset"
                  className="flex items-center gap-2 border border-gray-300 bg-white rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  {t("settings.reset")}
                </button>
              </div>
            }
          </div>
        </div>
      </main>
    </div>
  );
}

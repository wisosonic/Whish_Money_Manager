import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Percent, Loader2, Trash2 } from "lucide-react";
import { api } from "@/api/apiClient";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { Section } from "@/components/settings/SettingsControls";
import StorePicker from "@/components/stores/StorePicker";
import { useStoreList, withStoreArg } from "@/lib/useStores";

// Settings → Office → Commission rate (Admin + Manager). A store's rate on credits, with the date
// each rate applies from. Each store has its own: a Manager edits their store's, the Admin picks the
// store (when there are several). Stored commissions never change: a new rate is used for new transactions (and
// imported statements) dated on or after its start. Past entries are history; only a rate that
// hasn't started yet can be removed.
const BASE_RATE_DATE = "2000-01-01"; // the starting 1% (see server/db.js)

export default function CommissionRates() {
  const { t, dir, num, errorText } = useI18n();
  const today = format(new Date(), "yyyy-MM-dd");
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const { stores, loaded, multiStore } = useStoreList();
  const [chosen, setChosen] = useState(null);
  const storeId = multiStore ? chosen ?? stores[0].id : null;
  const storeArgs = withStoreArg(storeId);

  const load = async () => {
    try {
      setData(await api.commissionRates.get(...(storeId ? [undefined, storeId] : [])));
      setLoadError("");
    } catch (err) {
      setLoadError(errorText(err?.message || ""));
    }
  };
  useEffect(() => { if (loaded) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [loaded, storeId]);

  const rateNumber = Number(rate);
  const rateValid = rate !== "" && Number.isFinite(rateNumber) && rateNumber >= 0 && rateNumber <= 100
    && Math.round(rateNumber * 1000) === rateNumber * 1000;
  const canSave = rateValid && /^\d{4}-\d{2}-\d{2}$/.test(from) && from > BASE_RATE_DATE;

  const save = async () => {
    setSaving(true);
    try {
      setData(await api.commissionRates.set(...storeArgs(rateNumber, from)));
      notify.success(t("toast.office.rateSaved", { rate: num(rateNumber), date: num(from) }));
      setRate("");
      setConfirming(false);
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.office.rateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (effectiveFrom) => {
    setRemoving(effectiveFrom);
    try {
      setData(await api.commissionRates.remove(...storeArgs(effectiveFrom)));
      notify.success(t("toast.office.rateRemoved", { date: num(effectiveFrom) }));
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.office.rateFailed"));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Section id="settings-commission" icon={Percent} title={t("settings.office.rate.title")} description={t("settings.office.rate.description")}>
      {multiStore &&
        <div className="mb-4" data-testid="rate-store">
          <StorePicker stores={stores} value={storeId} onChange={(id) => { setChosen(id); setData(null); }} label={t("stores.rateFor")} testId="rate-store-select" />
        </div>
      }
      {loadError && <p role="alert" className="text-sm text-red-600 mb-3">{loadError}</p>}
      {data &&
        <p className="text-sm text-gray-700 mb-4" data-testid="current-rate">
          {t("settings.office.rate.current")}{" "}
          <span className="font-bold text-lg text-gray-900" dir="ltr">{num(data.current)}%</span>
        </p>
      }

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); if (canSave) setConfirming(true); }}>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          {t("settings.office.rate.newRate")}
          <span className="flex items-center gap-1" dir="ltr">
            <input
              type="number" inputMode="decimal" min="0" max="100" step="0.001"
              value={rate} onChange={(e) => setRate(e.target.value)}
              data-testid="rate-input"
              className="border rounded-lg px-3 py-2 w-28 font-bold focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <span className="text-gray-500">%</span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          {t("settings.office.rate.from")}
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            data-testid="rate-from"
            className="border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </label>
        <button
          type="submit" disabled={!canSave} data-testid="rate-save"
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
          {t("settings.office.rate.save")}
        </button>
      </form>
      {rate !== "" && !rateValid && <p className="text-xs text-red-600 mt-2">{t("settings.office.rate.invalid")}</p>}
      <p className="text-xs text-gray-500 mt-2">{t("settings.office.rate.note")}</p>

      {data?.history?.length > 0 &&
        <div className="overflow-x-auto mt-5">
          <table className="w-full text-sm text-start" data-testid="rate-history">
            <caption className="text-start text-sm font-semibold text-gray-700 mb-2">{t("settings.office.rate.history")}</caption>
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-start">{t("settings.office.rate.col.from")}</th>
                <th className="px-3 py-2 text-start">{t("settings.office.rate.col.rate")}</th>
                <th className="px-3 py-2 text-start">{t("settings.office.rate.col.by")}</th>
                <th className="px-3 py-2"><span className="sr-only">{t("common.delete")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.history.map((row) =>
                <tr key={row.effective_from}>
                  <td className="px-3 py-2 font-medium">
                    {row.effective_from === BASE_RATE_DATE ? t("settings.office.rate.sinceStart") : num(row.effective_from)}
                    {row.effective_from > today && <span className="ms-2 text-xs text-blue-700 font-semibold">{t("settings.office.rate.scheduled")}</span>}
                  </td>
                  <td className="px-3 py-2 font-bold" dir="ltr">{num(row.rate)}%</td>
                  <td className="px-3 py-2 text-gray-600">{row.created_by === "system" ? "—" : row.created_by}</td>
                  <td className="px-3 py-2 text-end">
                    {row.effective_from > today &&
                      <button
                        type="button" onClick={() => remove(row.effective_from)} disabled={removing === row.effective_from}
                        title={t("settings.office.rate.remove")} aria-label={t("settings.office.rate.remove")}
                        className="text-gray-400 hover:text-red-600 transition disabled:opacity-50">
                        {removing === row.effective_from ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    }
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      }

      {confirming &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
          <div role="alertdialog" aria-labelledby="rate-confirm-title" aria-describedby="rate-confirm-body" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h3 id="rate-confirm-title" className="font-bold text-gray-800 text-lg mb-2">
              {t("settings.office.rate.confirmTitle", { rate: num(rateNumber), date: num(from) })}
            </h3>
            <p id="rate-confirm-body" className="text-sm text-gray-600 mb-5">{t("settings.office.rate.confirmBody")}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirming(false)} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {t("common.cancel")}
              </button>
              <button
                type="button" onClick={save} disabled={saving} data-testid="rate-confirm"
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {t("settings.office.rate.save")}
              </button>
            </div>
          </div>
        </div>
      }
    </Section>
  );
}

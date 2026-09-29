import { useState } from "react";
import { AlertTriangle, Calendar, X } from "lucide-react";
import { api } from "@/api/apiClient";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";

// "Edit and add" (user's request, 2026-09-29; debit/credit inputs, user's request, 2026-09-29): corrects
// one ambiguous statement row into a real transaction. Only what the office worker needs to fix is
// asked here — the commission is computed on the server the same way the CSV engine always does (the
// store's office rate on the date, on credits only), and is never sent from here.
//
// Debit and credit are two separate inputs, mirroring the statement's own columns (and the row's
// original ambiguity: a negative one, both filled, or neither) — not a single "type + amount" choice,
// since the whole reason the row is here is that those columns couldn't be trusted as one or the
// other. Exactly one must end up with a non-zero value: whichever it is decides the transaction's
// type (debit → Cash Out, credit → Cash In), and its absolute value is the amount (a transaction's
// stored amount is always positive; the sign is only ever the statement's own printed sign, kept
// editable here since it's part of what needs correcting).
const numberOrNull = (text) => {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN; // NaN: typed but not a number (kept invalid, not empty)
};

export default function ConvertAmbiguousRowModal({ row, onClose, onSaved }) {
  const { t, dir, errorText } = useI18n();
  const [form, setForm] = useState({
    debit: row.debit || "",
    credit: row.credit || "",
    sender_name: row.description || "",
    receiver_name: row.description || "",
    phone: "",
    customer_number: "",
    service: row.service || "",
    note: "",
    reference_number: row.reference_number || "",
    transaction_date: row.date || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const field = (label, key, type = "text") => (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-600 font-medium">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 text-start" />
    </div>
  );

  const debitValue = numberOrNull(form.debit);
  const creditValue = numberOrNull(form.credit);
  const debitOk = Number.isFinite(debitValue) && debitValue !== 0;
  const creditOk = Number.isFinite(creditValue) && creditValue !== 0;
  const bothFilled = debitOk && creditOk;
  const exactlyOne = debitOk !== creditOk; // true xor true is false: exactly one, never both, never neither
  const canSave = exactlyOne && !!form.transaction_date;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await api.importHistory.convert(row.id, {
        type: debitOk ? "cash_out" : "cash_in",
        amount: Math.abs(debitOk ? debitValue : creditValue),
        sender_name: form.sender_name,
        receiver_name: form.receiver_name,
        phone: form.phone,
        customer_number: form.customer_number,
        service: form.service,
        note: form.note,
        reference_number: form.reference_number,
        transaction_date: form.transaction_date,
      });
      notify.success(t("ambiguous.convertedToast"));
      onSaved(row.id);
    } catch (err) {
      const message = err?.message ? errorText(err.message) : t("ambiguous.convertFailed");
      setError(message);
      notify.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
      <div role="dialog" aria-modal="true" aria-labelledby="convert-ambiguous-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" data-testid="convert-ambiguous-modal">
        <div className="flex items-center justify-between mb-4">
          <h2 id="convert-ambiguous-title" className="text-lg font-bold text-gray-800">{t("ambiguous.convertTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="text-gray-400 hover:text-gray-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mb-4" data-testid="convert-original">
          {t("ambiguous.convertHint")}
          <span className="block mt-1 font-mono" dir="ltr">{row.description || "-"} · {t("ambiguous.col.debit")} {row.debit || "—"} · {t("ambiguous.col.credit")} {row.credit || "—"}</span>
        </p>

        {error && <p role="alert" className="mb-3 flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />{error}</p>}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {field(t("form.senderName"), "sender_name")}
            {field(t("form.receiverName"), "receiver_name")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-gray-600 font-medium">{t("ambiguous.col.debit")}</label>
              <input
                type="number"
                step="any"
                value={form.debit}
                onChange={(e) => setForm({ ...form, debit: e.target.value })}
                data-testid="convert-debit"
                className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 text-start" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-gray-600 font-medium">{t("ambiguous.col.credit")}</label>
              <input
                type="number"
                step="any"
                value={form.credit}
                onChange={(e) => setForm({ ...form, credit: e.target.value })}
                data-testid="convert-credit"
                className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 text-start" />
            </div>
          </div>
          {bothFilled ?
            <p role="alert" data-testid="convert-debit-credit-error" className="text-xs text-red-700">{t("ambiguous.debitCreditBoth")}</p> :
            <p className="text-xs text-gray-500">{t("ambiguous.debitCreditHint")}</p>
          }
          <div className="grid grid-cols-2 gap-3">
            {field(t("form.phone"), "phone")}
            {field(t("form.customerNumber"), "customer_number")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field(t("columns.reference"), "reference_number")}
            {field(t("columns.service"), "service")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-gray-600 font-medium">{t("columns.date")}</label>
              <div className="relative">
                <Calendar className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden="true" />
                <input
                  type="date"
                  value={form.transaction_date}
                  onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                  data-testid="convert-date"
                  className="w-full border rounded-lg ps-3 pe-9 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 text-start" />
              </div>
            </div>
            {field(t("columns.note"), "note")}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50 transition">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !canSave}
            data-testid="convert-save"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

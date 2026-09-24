import { useState } from "react";
import { X, Pencil, AlertCircle } from "lucide-react";
import { api } from "@/api/apiClient";
import { useI18n } from "@/lib/i18n";

// Fields that make sense to set on many transactions at once. Per-row values (amount, reference,
// phone) stay in the single-row editor. The commission rate is applied to each row's own amount.
const FIELDS = [
  { key: "type", labelKey: "columns.type", kind: "type", initial: "cash_in" },
  { key: "commission_rate", labelKey: "bulk.commissionRate", kind: "number", initial: "1", hintKey: "bulk.commissionRateHint" },
  { key: "service", labelKey: "columns.service", kind: "text", initial: "" },
  { key: "sender_name", labelKey: "bulk.senderName", kind: "text", initial: "" },
  { key: "receiver_name", labelKey: "bulk.receiverName", kind: "text", initial: "" },
  { key: "transaction_date", labelKey: "columns.date", kind: "date", initial: "" },
  { key: "note", labelKey: "columns.note", kind: "textarea", initial: "" },
];

export default function BulkEditModal({ transactions, onClose, onSaved }) {
  const { t: tr, dir, errorText } = useI18n();
  const [enabled, setEnabled] = useState({});
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, f.initial])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changes = Object.fromEntries(FIELDS.filter((f) => enabled[f.key]).map((f) => [f.key, values[f.key]]));
  const changeCount = Object.keys(changes).length;

  const validationError = (() => {
    if (enabled.commission_rate) {
      const rate = Number(values.commission_rate);
      if (values.commission_rate === "" || !Number.isFinite(rate) || rate < 0) return tr("bulk.rateInvalid");
    }
    if (enabled.transaction_date && !values.transaction_date) return tr("bulk.dateRequired");
    return "";
  })();

  const handleSave = async () => {
    if (!changeCount || validationError) return;
    setSaving(true);
    setError("");
    try {
      const payload = { ...changes };
      if (payload.commission_rate !== undefined) payload.commission_rate = Number(payload.commission_rate);
      await api.entities.Transaction.bulkUpdate(transactions.map((t) => t.id), payload);
      onSaved(payload);
    } catch (err) {
      setError(err?.message ? errorText(err.message) : tr("bulk.saveFailed"));
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-start disabled:bg-gray-100 disabled:text-gray-400";

  const renderInput = (field) => {
    const common = {
      id: `bulk-${field.key}`,
      value: values[field.key],
      disabled: !enabled[field.key],
      onChange: (e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value })),
      className: inputCls,
    };
    if (field.kind === "type") {
      return (
        <select {...common}>
          <option value="cash_in">Cash In</option>
          <option value="cash_out">Cash Out</option>
        </select>
      );
    }
    if (field.kind === "textarea") return <textarea {...common} rows={2} className={`${inputCls} resize-none`} />;
    return <input {...common} type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"} min={field.kind === "number" ? 0 : undefined} step={field.kind === "number" ? "0.01" : undefined} />;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2 md:p-4" dir={dir}>
      <div className="bg-[#F3F5FA] rounded-2xl shadow-xl w-full max-w-lg max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-3">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-800">{tr("bulk.title", { count: transactions.length })}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={tr("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="px-5 text-sm text-gray-500">{tr("bulk.intro")}</p>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
          {FIELDS.map((field) => (
            <div key={field.key} className="bg-white rounded-lg border border-gray-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <label htmlFor={`bulk-${field.key}`} className="text-sm font-medium text-gray-700">{tr(field.labelKey)}</label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!enabled[field.key]}
                    onChange={(e) => setEnabled((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                    aria-label={tr("bulk.changeField", { field: tr(field.labelKey) })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  {tr("bulk.change")}
                </label>
              </div>
              {renderInput(field)}
              {field.hintKey && enabled[field.key] && <p className="text-xs text-gray-400 mt-1">{tr(field.hintKey)}</p>}
            </div>
          ))}
        </div>

        {(validationError || error) && (
          <div className="mx-5 mb-2 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span>{validationError || error}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 p-5 pt-3 border-t border-gray-200">
          <span className="text-xs text-gray-500">
            {changeCount ? tr("bulk.summary", { fields: changeCount, count: transactions.length }) : tr("bulk.noneSelected")}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition"
            >
              {tr("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !changeCount || !!validationError}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50"
            >
              {saving ? tr("common.saving") : tr("bulk.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

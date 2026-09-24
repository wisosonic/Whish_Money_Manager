import { useState } from "react";
import { api } from "@/api/apiClient";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";

export default function CashOutModal({ onClose, onSaved }) {
  const { t, dir, errorText } = useI18n();
  const [form, setForm] = useState({
    sender_name: "",
    receiver_name: "",
    phone: "",
    amount: "",
    commission: "",
    note: "",
    reference_number: "",
    currency: "USD",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.entities.Transaction.create({
        ...form,
        type: "cash_out",
        amount: Number(form.amount),
        commission: Number(form.commission) || 0,
      });
      notify.success(t("toast.tx.cashOutSaved"));
      onSaved();
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.tx.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, type = "text", placeholder = "") => (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-600 font-medium">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir={dir}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-red-600">{t("form.cashOutTitle")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          {field(t("form.senderName"), "sender_name", "text", t("form.senderName"))}
          {field(t("form.receiverName"), "receiver_name", "text", t("form.receiverName"))}
          {field(t("form.phone"), "phone", "text", t("form.phone"))}
          {field(t("form.amount"), "amount", "number", "0.00")}
          {field(t("form.commission"), "commission", "number", "0.00")}
          {field(t("columns.reference"), "reference_number", "text", t("form.referencePlaceholder"))}
          {field(t("columns.note"), "note", "text", t("form.notePlaceholder"))}
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50 transition"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.amount}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
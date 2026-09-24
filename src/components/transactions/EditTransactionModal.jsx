import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, Calendar } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function EditTransactionModal({ transaction, onClose, onSaved }) {
  const { t, dir } = useI18n();
  const commissionRate = transaction.amount > 0
    ? ((transaction.commission / transaction.amount) * 100).toFixed(2)
    : "1";

  const [form, setForm] = useState({
    type: transaction.type || "cash_in",
    sender_name: transaction.sender_name || "",
    receiver_name: transaction.receiver_name || "",
    phone: transaction.phone || "",
    amount: transaction.amount || "",
    commission: transaction.commission || "",
    commission_rate: commissionRate,
    reference_number: transaction.reference_number || "",
    customer_number: transaction.customer_number || "",
    note: transaction.note || "",
    transaction_date: transaction.transaction_date || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const amt = Number(form.amount) || 0;
      const finalCommission = parseFloat(form.commission) || 0;

      await base44.entities.Transaction.update(transaction.id, {
        type: form.type,
        sender_name: form.sender_name,
        receiver_name: form.receiver_name,
        phone: form.phone,
        amount: amt,
        commission: finalCommission,
        reference_number: form.reference_number,
        customer_number: form.customer_number,
        note: form.note,
        transaction_date: form.transaction_date,
      });
      setSaving(false);
      onSaved();
    } catch (error) {
      console.error('خطأ في الحفظ:', error);
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-start placeholder-gray-300";
  const labelCls = "block text-sm text-gray-600 mb-1 text-start";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir={dir}>
      <div className="bg-[#F3F5FA] rounded-2xl shadow-xl w-full max-w-lg p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-bold text-gray-800">{t("edit.title")}</h2>
        </div>

        <div className="space-y-3">
          {/* النوع - full width */}
          <div>
            <div className="flex items-center justify-start gap-2">
              <label className="text-sm text-gray-600 font-medium">{t("columns.type")}:</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-start"
              >
                <option value="cash_in">Cash In</option>
                <option value="cash_out">Cash Out</option>
              </select>
            </div>
          </div>

          {/* اسم المرسل | اسم المستلم */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.receiverName")}</label>
              <input
                type="text"
                value={form.receiver_name}
                onChange={(e) => setForm({ ...form, receiver_name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("form.senderName")}</label>
              <input
                type="text"
                value={form.sender_name}
                onChange={(e) => setForm({ ...form, sender_name: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* المبلغ | رقم الهاتف */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.amount")}</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => {
                  const amt = Number(e.target.value) || 0;
                  const rate = Number(form.commission_rate) || 0;
                  setForm((prev) => ({
                    ...prev,
                    amount: e.target.value,
                    commission: amt > 0 ? (amt * rate / 100).toFixed(2) : prev.commission,
                  }));
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("form.phone")}</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* نسبة العمولة | العمولة — two separate fields per column */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.commission")}</label>
              <input
                type="number"
                placeholder="0.00"
                value={form.commission}
                onChange={(e) => setForm({ ...form, commission: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("bulk.commissionRate")}</label>
              <input
                type="number"
                placeholder="1"
                value={form.commission_rate}
                onChange={(e) => {
                  const rate = parseFloat(e.target.value);
                  const amt = Number(form.amount) || 0;
                  setForm((prev) => ({
                    ...prev,
                    commission_rate: e.target.value,
                    commission: !isNaN(rate) && amt > 0 ? (amt * rate / 100).toFixed(2) : prev.commission,
                  }));
                }}
                className={inputCls}
              />
            </div>
          </div>

          {/* رقم العملية | رقم الزبون */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.customerNumber")}</label>
              <input
                type="text"
                value={form.customer_number}
                onChange={(e) => setForm({ ...form, customer_number: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("columns.reference")}</label>
              <input
                type="text"
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* ملاحظة - full width */}
          <div>
            <label className={labelCls}>{t("columns.note")}</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* التاريخ + أزرار في صف واحد */}
          <div className="flex items-end justify-between gap-3">
            {/* أزرار يسار */}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
              >
                {saving ? t("common.saving") : t("edit.save")}
              </button>
              <button
                onClick={onClose}
                className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition"
              >
                {t("common.cancel")}
              </button>
            </div>

            {/* التاريخ يمين */}
            <div className="text-start">
              <label className={labelCls}>{t("columns.date")}</label>
              <div className="relative">
                <Calendar className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={form.transaction_date}
                  onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                  className="border border-gray-200 rounded-lg pe-9 ps-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-start w-44"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
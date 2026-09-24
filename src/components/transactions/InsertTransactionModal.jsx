import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X } from "lucide-react";

export default function InsertTransactionModal({ insertAfterDate, onClose, onSaved }) {
  const [form, setForm] = useState({
    type: "cash_in",
    sender_name: "",
    receiver_name: "",
    phone: "",
    amount: "",
    commission: "",
    commission_rate: "1",
    reference_number: "",
    customer_number: "",
    note: "",
    transaction_date: insertAfterDate || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const amt = Number(form.amount) || 0;
    const finalCommission = parseFloat(form.commission) || 0;
    const { commission_rate, ...rest } = form;
    await base44.entities.Transaction.create({
      ...rest,
      amount: amt,
      commission: finalCommission,
    });
    setSaving(false);
    onSaved();
  };

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-right placeholder-gray-300";
  const labelCls = "block text-sm text-gray-600 mb-1 text-right";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-[#F3F5FA] rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-bold text-gray-800">إضافة عملية جديدة</h2>
        </div>

        <div className="space-y-3">
          {/* النوع */}
          <div className="flex items-center justify-end gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-right"
            >
              <option value="cash_in">Cash In</option>
              <option value="cash_out">Cash Out</option>
            </select>
            <label className="text-sm text-gray-600 font-medium">:النوع</label>
          </div>

          {/* اسم المرسل | اسم المستلم */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>اسم المستلم</label>
              <input type="text" value={form.receiver_name} onChange={(e) => setForm({ ...form, receiver_name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>اسم المرسل</label>
              <input type="text" value={form.sender_name} onChange={(e) => setForm({ ...form, sender_name: e.target.value })} className={inputCls} />
            </div>
          </div>

          {/* المبلغ | رقم الهاتف */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>المبلغ ($)</label>
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
              <label className={labelCls}>رقم الهاتف</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </div>
          </div>

          {/* العمولة | نسبة العمولة */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>العمولة ($)</label>
              <input type="number" placeholder="0.00" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>نسبة العمولة (%)</label>
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
              <label className={labelCls}>رقم الزبون</label>
              <input type="text" value={form.customer_number} onChange={(e) => setForm({ ...form, customer_number: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>رقم العملية</label>
              <input type="text" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} className={inputCls} />
            </div>
          </div>

          {/* ملاحظة */}
          <div>
            <label className={labelCls}>ملاحظة</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
          </div>

          {/* التاريخ + أزرار */}
          <div className="flex items-end justify-between gap-3">
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50">
                {saving ? "جاري الحفظ..." : "حفظ"}
              </button>
              <button onClick={onClose} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition">
                إلغاء
              </button>
            </div>
            <div className="text-right">
              <label className={labelCls}>التاريخ</label>
              <input
                type="date"
                value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 text-right w-44"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
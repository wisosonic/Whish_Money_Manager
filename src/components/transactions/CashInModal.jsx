import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X } from "lucide-react";

export default function CashInModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    sender_name: "",
    receiver_name: "",
    phone: "",
    amount: "",
    commission: "",
    commission_rate: "1",
    note: "",
    reference_number: "",
    currency: "USD",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.Transaction.create({
      ...form,
      type: "cash_in",
      amount: Number(form.amount),
      commission: Number(form.commission) || 0,
    });
    setSaving(false);
    onSaved();
  };

  const field = (label, key, type = "text", placeholder = "") => (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-600 font-medium">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
      />
    </div>
  );

  const handleAmountChange = (val) => {
    const amt = Number(val);
    setForm((prev) => ({
      ...prev,
      amount: val,
      commission: amt > 0 ? (amt * 0.01).toFixed(2) : "0",
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-green-600">إيداع - Cash In</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          {field("اسم المرسل", "sender_name", "text", "اسم المرسل")}
          {field("اسم المستلم", "receiver_name", "text", "اسم المستلم")}
          {field("رقم الهاتف", "phone", "text", "رقم الهاتف")}
          <div className="flex flex-col gap-1">
            <label className="text-sm text-gray-600 font-medium">المبلغ ($)</label>
            <input
              type="number"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-gray-600 font-medium">العمولة - 1% ($)</label>
            <div className="border rounded-lg px-3 py-2 text-sm bg-green-50 text-green-700 font-semibold">
              ${(Number(form.amount || 0) * 0.01).toFixed(2)}
            </div>
          </div>
          {field("رقم العملية", "reference_number", "text", "رقم مرجعي")}
          {field("ملاحظة", "note", "text", "أي ملاحظات...")}
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50 transition"
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.amount}
            className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50"
          >
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}
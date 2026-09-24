// @ts-nocheck

import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { detectFileType } from "@/lib/fileType";
import { useAuth } from "@/lib/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { X, Upload, FileText, CheckCircle, AlertCircle, Loader2, Calendar } from "lucide-react";

export default function ImportPDFModal({ onClose, onSaved }) {
  // Replacing an imported statement deletes the old entries, so it needs delete rights.
  const { can } = useAuth();
  const canReplace = can(PERMISSIONS.TRANSACTIONS_DELETE);
  const [step, setStep] = useState("upload"); // upload | duplicates | preview | saving | done
  const [duplicates, setDuplicates] = useState([]);
  const [overwrite, setOverwrite] = useState(false);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const [editRows, setEditRows] = useState([]);
  const [detectedDate, setDetectedDate] = useState("");
  const [openingBalance, setOpeningBalance] = useState(null);
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    const fileType = await detectFileType(file);
    if (!fileType) {
      setError("يرجى اختيار ملف PDF أو CSV فقط");
      return;
    }
    setError("");
    setLoading(true);
    setStep("upload");
    setDuplicates([]);
    setOverwrite(false);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);

    try {
      const result = fileType === "csv"
        ? await base44.integrations.Core.ExtractCsv(file)
        : await base44.integrations.Core.ExtractPdf(file);
      setValidation(result?.validation || null);

      const rows = result?.transactions || [];
      if (rows.length === 0) {
        setError("لم يتم استخراج حوالات تلقائياً. يمكنك حفظ ملف فارغ أو رفع ملف آخر.");
      }
      const expectedCount = result?.total_transactions_count;
      if (expectedCount && rows.length < expectedCount) {
        setError(`تحذير: الكشف يحتوي على ${expectedCount} عملية لكن تم استخراج ${rows.length} فقط — قد يكون هناك نقص. يمكنك المتابعة أو إعادة الرفع.`);
      }

      const stmtDate = result?.statement_date || "";
      setDetectedDate(stmtDate);
      const ob = result?.opening_balance ?? 0;
      setOpeningBalance(ob);

    // ═══ التحقق من صحة اتجاه العمليات (cash_in / cash_out) ═══
    // منطق: opening_balance + cash_in - cash_out = closing_balance
    // إذا كانت مقلوبة: opening_balance - cash_in + cash_out = closing_balance
    // نجرب الاتجاهين ونرى أيهما يتطابق مع closing_balance
      let finalRows = rows;
      const closing = result?.closing_balance;
      if (closing != null && ob != null) {
        const sumIn  = rows.filter(r => r.type === "cash_in").reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const sumOut = rows.filter(r => r.type === "cash_out").reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const calcNormal  = Math.abs(ob + sumIn - sumOut - closing);
        const calcFlipped = Math.abs(ob + sumOut - sumIn - closing);
        // إذا الاتجاه المقلوب أقرب للـ closing، اعكس الكل
        if (calcFlipped < calcNormal && calcFlipped < 0.1) {
          finalRows = rows.map(r => ({
            ...r,
            type: r.type === "cash_in" ? "cash_out" : "cash_in",
          }));
        }
      }

      const rowsWithDate = finalRows.map((r) => ({
        ...r,
        date: r.date || stmtDate || "",
        service: r.service || "",
        commission: +(Number(r.commission)).toFixed(3),
      }));

      // ═══ كشف العمليات المكررة (نفس رقم العملية مسجل مسبقاً) ═══
      const references = [...new Set(rowsWithDate.map((r) => String(r.reference_number || "").trim()).filter(Boolean))];
      const existing = references.length ? await base44.entities.Transaction.findDuplicates(references) : [];

      setEditRows(rowsWithDate);
      setDuplicates(existing);
      clearInterval(timerRef.current);
      setElapsed(61); // يكمل الشريط إلى 100%
      setStep(existing.length > 0 ? "duplicates" : "preview");
      setLoading(false);
    } catch (err) {
      clearInterval(timerRef.current);
      setLoading(false);
      setError(err?.message || "تعذر تحليل الملف في الوضع المحلي.");
      setStep("upload");
      return;
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  };

  const handleSaveAll = async () => {
    setStep("saving");
    try {
      if (!editRows || editRows.length === 0) {
        console.error("لا توجد عمليات للحفظ");
        setStep("preview");
        return;
      }

      // تأكد من أن التاريخ محدد
      const finalDate = detectedDate || new Date().toISOString().split("T")[0];

      const records = editRows.map((row, index) => {
        const receiverIsPhone = /^\+?\d{7,}$/.test((row.receiver_name || "").trim());
        return {
          type: row.type || "cash_in",
          sender_name: row.sender_name || "",
          receiver_name: receiverIsPhone ? "" : (row.receiver_name || ""),
          phone: receiverIsPhone ? row.receiver_name.trim() : (row.phone || ""),
          amount: Number(row.amount) || 0,
          commission: Number(row.commission) || 0,
          reference_number: row.reference_number || "",
          customer_number: receiverIsPhone ? row.receiver_name.trim().replace(/^(\+?961)/, "") : (row.customer_number || ""),
          note: row.note || "",
          service: row.service || "",
          currency: "USD",
          status: "completed",
          transaction_date: row.date || finalDate,
          sort_order: index,
        };
      });

      await base44.entities.Transaction.importRecords(records, { overwrite });

      setStep("done");
      setTimeout(() => { 
        onSaved(openingBalance, finalDate); 
      }, 1500);
    } catch (error) {
      console.error("خطأ في حفظ العمليات:", error);
      setStep("preview");
    }
  };

  const resetUpload = () => {
    setStep("upload");
    setEditRows([]);
    setDetectedDate("");
    setDuplicates([]);
    setOverwrite(false);
    setValidation(null);
    setError("");
  };

  const updateRow = (i, key, val) => {
    setEditRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  };

  const removeRow = (i) => {
    setEditRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  // تطبيق تاريخ موحد على جميع الصفوف
  const applyDateToAll = (date) => {
    setDetectedDate(date);
    setEditRows((prev) => prev.map((r) => ({ ...r, date })));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-800">استيراد من PDF / CSV</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {/* STEP: Upload */}
          {step === "upload" && !loading && (
            <div
              className="border-2 border-dashed border-blue-300 rounded-2xl p-16 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-12 h-12 text-blue-400 mx-auto mb-4" />
              <p className="text-lg font-semibold text-gray-700">اسحب ملف PDF أو CSV هنا أو اضغط للاختيار</p>
              <p className="text-gray-400 text-sm mt-2">سيتم استخراج جميع الحوالات والتاريخ تلقائياً</p>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.csv,application/pdf,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files && e.target.files[0])}
              />
              {error && (
                <div className="mt-4 flex items-center justify-center gap-2 text-red-500">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP: Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-5">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <div className="text-center">
                <p className="text-gray-600 font-medium mb-1">جاري قراءة الملف واستخراج جميع العمليات...</p>
                <p className="text-gray-400 text-sm">يستخدم نموذج ذكاء اصطناعي متقدم — قد يستغرق 30-60 ثانية</p>
              </div>
              {/* شريط التقدم */}
              <div className="w-full max-w-sm">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>الوقت المنقضي: {elapsed}ث</span>
                  <span>المتوقع: ~60ث</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full bg-blue-500 transition-all duration-1000"
                    style={{ width: elapsed >= 61 ? "100%" : `${Math.min((elapsed / 60) * 100, 95)}%` }}
                  />
                </div>
                <p className="text-center text-sm font-bold text-blue-600 mt-2">{elapsed >= 61 ? "100%" : `${Math.min(Math.round((elapsed / 60) * 100), 95)}%`}</p>
              </div>
            </div>
          )}

          {/* STEP: Duplicates */}
          {step === "duplicates" && (
            <div className="max-w-xl mx-auto py-10">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6 text-center">
                <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
                <p className="text-lg font-bold text-amber-800 mb-2">هذا الكشف مستورد مسبقاً</p>
                <p className="text-sm text-amber-700 mb-1">
                  تم العثور على {duplicates.length} عملية من أصل {editRows.length} مسجلة مسبقاً بنفس أرقام العمليات
                  {(() => {
                    const dates = [...new Set(duplicates.map((d) => d.transaction_date).filter(Boolean))].sort();
                    return dates.length ? ` (${dates.join("، ")})` : "";
                  })()}
                  .
                </p>
                {canReplace ? (
                  <p className="text-sm text-amber-700 mb-5">هل تريد استبدال العمليات الموجودة بالعمليات الجديدة أم إلغاء الرفع؟</p>
                ) : (
                  <p className="text-sm text-amber-700 mb-5">استبدال العمليات الموجودة يتطلب صلاحية الحذف — اطلب من المدير رفع هذا الكشف.</p>
                )}
                <div className="flex justify-center gap-3">
                  <button
                    onClick={resetUpload}
                    className="border rounded-lg px-4 py-2 text-gray-600 bg-white hover:bg-gray-50"
                  >
                    إلغاء الرفع
                  </button>
                  {canReplace && (
                    <button
                      onClick={() => { setOverwrite(true); setStep("preview"); }}
                      className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-5 py-2 font-semibold transition"
                    >
                      استبدال العمليات الموجودة
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP: Preview */}
          {step === "preview" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-green-600 font-semibold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  تم استخراج {editRows.length} حوالة — راجع البيانات قبل الحفظ
                </p>
                <button
                  onClick={resetUpload}
                  className="text-sm text-blue-500 hover:underline"
                >
                  رفع ملف آخر
                </button>
              </div>

              {overwrite && duplicates.length > 0 && (
                <div className="flex items-center gap-2 mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  <AlertCircle className="w-4 h-4" />
                  عند الحفظ سيتم حذف {duplicates.length} عملية موجودة واستبدالها بعمليات هذا الملف.
                </div>
              )}

              {validation && (
                validation.is_valid ? (
                  <div className="flex items-center gap-2 mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                    <CheckCircle className="w-4 h-4" />
                    الكشف متطابق: مجموع المدين والدائن ورصيد النهاية مطابقة للأرقام في الملف.
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                    <AlertCircle className="w-4 h-4" />
                    <span>
                      تحذير: الكشف غير متطابق
                      {!validation.total_debit_matches && " — مجموع المدين مختلف"}
                      {!validation.total_credit_matches && " — مجموع الدائن مختلف"}
                      {!validation.closing_balance_matches && " — رصيد النهاية مختلف"}
                      {validation.balance_mismatch_lines?.length > 0 && ` — رصيد غير متطابق في الأسطر: ${validation.balance_mismatch_lines.join("، ")}`}
                    </span>
                  </div>
                )
              )}

              {/* Opening Balance */}
              {openingBalance !== null && (
                <div className="flex items-center gap-3 mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <span className="text-sm font-medium text-green-700">💰 Opening Balance المكتشف:</span>
                  <input
                    type="number"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(Number(e.target.value))}
                    className="border border-green-300 rounded-lg px-2 py-1 text-sm font-bold text-green-800 w-32 focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <span className="text-xs text-green-600">سيُوضع تلقائياً في رصيد البداية</span>
                </div>
              )}

              {/* تاريخ موحد */}
              <div className="flex items-center gap-3 mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-gray-600 font-medium">
                  {detectedDate ? `تم اكتشاف التاريخ: ${detectedDate}` : "لم يُكتشف تاريخ — حدده يدوياً:"}
                </span>
                <input
                  type="date"
                  value={detectedDate}
                  onChange={(e) => applyDateToAll(e.target.value)}
                  className="border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <span className="text-xs text-gray-400">سيُطبَّق على جميع الحوالات</span>
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm text-right">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2">النوع</th>
                      <th className="px-3 py-2">الخدمة</th>
                      <th className="px-3 py-2">المرسل</th>
                      <th className="px-3 py-2">المستلم</th>
                      {/* <th className="px-3 py-2">الهاتف</th> */}
                      <th className="px-3 py-2">المبلغ</th>
                      <th className="px-3 py-2">العمولة</th>
                      <th className="px-3 py-2">نسبة العمولة %</th>
                      <th className="px-3 py-2">رقم العملية</th>
                      <th className="px-3 py-2">ملاحظة</th>
                      <th className="px-3 py-2">التاريخ</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {editRows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <select
                            value={row.type}
                            onChange={(e) => updateRow(i, "type", e.target.value)}
                            className={`rounded-lg px-2 py-1 text-xs font-semibold border ${
                              row.type === "cash_in"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-red-100 text-red-700 border-red-200"
                            }`}
                          >
                            <option value="cash_in">Cash In</option>
                            <option value="cash_out">Cash Out</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.service || ""}
                            onChange={(e) => updateRow(i, "service", e.target.value)}
                            className="border rounded px-2 py-1 text-sm w-full min-w-[80px] focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        </td>
                        {["sender_name", "receiver_name", "amount", "commission", "commissionRate", "reference_number", "note"].map((key) => (
                          <td key={key} className="px-3 py-2">
                            <input
                              type={["amount", "commission", "commissionRate"].includes(key) ? "number" : "text"}
                              value={row[key] || ""}
                              onChange={(e) => updateRow(i, key, e.target.value)}
                              className="border rounded px-2 py-1 text-sm w-full min-w-[80px] focus:outline-none focus:ring-1 focus:ring-blue-300"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={row.date || ""}
                            onChange={(e) => updateRow(i, "date", e.target.value)}
                            className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP: Saving */}
          {step === "saving" && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-12 h-12 text-green-500 animate-spin" />
              <p className="text-gray-600 font-medium">جاري حفظ الحوالات...</p>
            </div>
          )}

          {/* STEP: Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <CheckCircle className="w-16 h-16 text-green-500" />
              <p className="text-xl font-bold text-gray-700">تم الحفظ بنجاح!</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "preview" && (
          <div className="border-t p-4 flex justify-between items-center">
            <span className="text-gray-500 text-sm">{editRows.length} حوالة جاهزة للحفظ</span>
            <div className="flex gap-3">
              <button onClick={onClose} className="border rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50">
                إلغاء
              </button>
              <button
                onClick={handleSaveAll}
                disabled={editRows.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-6 py-2 font-semibold transition disabled:opacity-50"
              >
                حفظ الكل ({editRows.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
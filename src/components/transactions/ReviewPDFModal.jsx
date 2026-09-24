import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { X, Upload, AlertCircle, Loader2, CheckCircle, XCircle, Scale } from "lucide-react";

export default function ReviewPDFModal({ onClose, transactions, onRefresh }) {
  const [step, setStep] = useState("upload"); // upload | comparing | result
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState(null);
  const [addingMissing, setAddingMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file || file.type !== "application/pdf") {
      setError("يرجى اختيار ملف PDF فقط");
      return;
    }
    setError("");
    setLoading(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      const result = await base44.integrations.Core.InvokeLLM({
      prompt: `أنت محاسب متخصص جداً في قراءة الكشوف البنكية. اقرأ الكشف بحذر شديد:

⚠️ تعليمات حاسمة:
1. اقرأ كل صفحة من الأول إلى الآخر
2. استخرج كل عملية (transaction) بدون استثناء — لا تترك أي عملية
3. احسب الإجماليات بنفسك، لا تأخذها من سطر الإجمالي في الكشف
4. تحقق: مجموع الإيداعات + Opening Balance - مجموع السحوبات = Closing Balance

═══ البيانات المطلوبة ═══

📊 الأرقام الإجمالية (احسبها من جميع العمليات):
- total_cash_in: مجموع كل Credit من جميع الصفوف (أزل الفواصل: 1,234.56 → 1234.56)
- total_cash_out: مجموع كل Debit من جميع الصفوف
- count_cash_in: عدد صفوف Credit
- count_cash_out: عدد صفوف Debit
- opening_balance: من سطر OPENING BALANCE (في عمود Balance)
- closing_balance: آخر رقم في عمود Balance
- total_commission: مجموع العمولات إذا وُجدت (0 إذا لا)

📝 كل عملية في مصفوفة transactions (استخرج كل واحدة):
- type: "cash_in" أو "cash_out"
- amount: الرقم فقط، بدون $، بدون فواصل
- sender_name: اسم المرسل (أو "-")
- receiver_name: اسم المستلم (أو "-")
- reference_number: رقم المرجع أو العملية
- note: وصف العملية من Description
- date: بصيغة YYYY-MM-DD (إذا لم يوجد، اترك فارغ)

🔍 تحقق من عملك:
- (total_cash_in + opening_balance) - total_cash_out = closing_balance
- العدد count_cash_in + count_cash_out = عدد الصفوف الكلي

اطبع المجاميع بدقة عالية جداً!`,
      file_urls: [file_url],
      model: "claude_sonnet_4_6",
      response_json_schema: {
        type: "object",
        properties: {
          total_cash_in: { type: "number" },
          total_cash_out: { type: "number" },
          count_cash_in: { type: "number" },
          count_cash_out: { type: "number" },
          total_commission: { type: "number" },
          opening_balance: { type: "number" },
          closing_balance: { type: "number" },
          transactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                sender_name: { type: "string" },
                receiver_name: { type: "string" },
                amount: { type: "number" },
                commission: { type: "number" },
                reference_number: { type: "string" },
                note: { type: "string" },
                date: { type: "string" },
              },
            },
          },
        },
      },
    });

      // حساب أرقام الموقع من transactions المحمّلة
      const siteCashIn = transactions.filter(t => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
      const siteCashOut = transactions.filter(t => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);
      const siteCountIn = transactions.filter(t => t.type === "cash_in").length;
      const siteCountOut = transactions.filter(t => t.type === "cash_out").length;
      const siteCommission = transactions.reduce((s, t) => s + (t.commission || 0), 0);

      // تحديد العمليات الناقصة والمقلوبة
      const pdfTransactions = result?.transactions || [];

      // نسخ مؤقتة للمطابقة حتى لا تُستهلك مرتين
      const usedSiteIds = new Set();

      // أولاً: ابحث عن المطابق الكامل (مبلغ + نوع + مرجع إن وجد)
      const matchedPdfIndices = new Set();
      pdfTransactions.forEach((pdfTx, pi) => {
      const match = transactions.find(siteTx =>
        !usedSiteIds.has(siteTx.id) &&
        Math.abs(siteTx.amount - pdfTx.amount) < 0.01 &&
        siteTx.type === pdfTx.type &&
        (!pdfTx.reference_number || siteTx.reference_number === pdfTx.reference_number)
      );
      if (match) {
        usedSiteIds.add(match.id);
        matchedPdfIndices.add(pi);
      }
      });

      // ثانياً: من غير المطابَقين، ابحث عن مقلوبين (نفس المبلغ لكن نوع معكوس)
      const wrongTypePdfIndices = new Set();
      pdfTransactions.forEach((pdfTx, pi) => {
      if (matchedPdfIndices.has(pi)) return;
      const flipped = transactions.find(siteTx =>
        !usedSiteIds.has(siteTx.id) &&
        Math.abs(siteTx.amount - pdfTx.amount) < 0.01 &&
        siteTx.type !== pdfTx.type
      );
      if (flipped) {
        usedSiteIds.add(flipped.id);
        matchedPdfIndices.add(pi);
        wrongTypePdfIndices.add(pi);
      }
      });

      // الناقصة: لا يوجد لها مقابل
      const missingTransactions = pdfTransactions.filter((_, pi) => !matchedPdfIndices.has(pi));
      // المقلوبة: نفس المبلغ لكن نوع خاطئ
      const wrongTypeTransactions = pdfTransactions.filter((_, pi) => wrongTypePdfIndices.has(pi));

      const pdfOpeningBalance = result?.opening_balance ?? null;
      const pdfClosingBalance = result?.closing_balance ?? null;
      // الصافي المحسوب في الموقع = رصيد البداية + إيداعات - سحوبات
      const siteNetBalance = siteCashIn - siteCashOut;
      // الصافي المتوقع من الـ PDF = closing - opening
      const pdfNetBalance = (pdfClosingBalance !== null && pdfOpeningBalance !== null)
        ? pdfClosingBalance - pdfOpeningBalance
        : null;

      setComparison({
      pdf: {
        total_cash_in: result?.total_cash_in || 0,
        total_cash_out: result?.total_cash_out || 0,
        count_cash_in: result?.count_cash_in || 0,
        count_cash_out: result?.count_cash_out || 0,
        total_commission: result?.total_commission || 0,
        opening_balance: pdfOpeningBalance,
        closing_balance: pdfClosingBalance,
        net_balance: pdfNetBalance,
        transactions: pdfTransactions,
      },
      site: {
        total_cash_in: siteCashIn,
        total_cash_out: siteCashOut,
        count_cash_in: siteCountIn,
        count_cash_out: siteCountOut,
        total_commission: siteCommission,
        net_balance: siteNetBalance,
      },
      missing: missingTransactions,
      wrongType: wrongTypeTransactions,
      });

      clearInterval(timerRef.current);
      setElapsed(61);
      setLoading(false);
      setStep("result");
    } catch (err) {
      clearInterval(timerRef.current);
      setLoading(false);
      setStep("upload");
      setError(err?.message || "تعذر تحليل الكشف في الوضع المحلي.");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  };

  const Row = ({ label, pdfVal, siteVal, isMoney = true }) => {
    const match = Math.abs(pdfVal - siteVal) < 0.01;
    const fmt = (v) => isMoney ? `$${v.toFixed(2)}` : v;
    return (
      <tr className={`border-b ${match ? "bg-green-50" : "bg-red-50"}`}>
        <td className="px-4 py-3 font-medium text-gray-700">{label}</td>
        <td className="px-4 py-3 font-bold text-blue-700 text-center">{fmt(pdfVal)}</td>
        <td className="px-4 py-3 font-bold text-gray-800 text-center">{fmt(siteVal)}</td>
        <td className="px-4 py-3 text-center">
          {match ? (
            <span className="flex items-center justify-center gap-1 text-green-600 font-semibold text-sm">
              <CheckCircle className="w-4 h-4" /> مطابق
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1 text-red-600 font-semibold text-sm">
              <XCircle className="w-4 h-4" /> فرق: {isMoney ? `$${Math.abs(pdfVal - siteVal).toFixed(2)}` : Math.abs(pdfVal - siteVal)}
            </span>
          )}
        </td>
      </tr>
    );
  };

  const allMatch = comparison && 
    Math.abs(comparison.pdf.total_cash_in - comparison.site.total_cash_in) < 0.01 &&
    Math.abs(comparison.pdf.total_cash_out - comparison.site.total_cash_out) < 0.01;

  // صف خاص لمقارنة Closing Balance
  const ClosingRow = () => {
    if (comparison?.pdf?.closing_balance === null || comparison?.pdf?.closing_balance === undefined) {
      return (
        <tr className="border-b bg-gray-50">
          <td className="px-4 py-3 font-medium text-gray-700">Closing Balance (آخر رصيد)</td>
          <td className="px-4 py-3 text-center text-gray-400 italic text-sm" colSpan={3}>لم يُعثر على Closing Balance في الكشف</td>
        </tr>
      );
    }
    const pdfClosing = comparison.pdf.closing_balance;
    const pdfOpening = comparison.pdf.opening_balance ?? 0;
    // الصافي الموقع = opening من الـ PDF + إيداعات الموقع - سحوبات الموقع
    const siteClosing = pdfOpening + comparison.site.total_cash_in - comparison.site.total_cash_out;
    const match = Math.abs(pdfClosing - siteClosing) < 0.01;
    return (
      <>
        {comparison.pdf.opening_balance !== null && (
          <tr className="border-b bg-blue-50">
            <td className="px-4 py-3 font-medium text-gray-700">Opening Balance (رصيد البداية)</td>
            <td className="px-4 py-3 font-bold text-blue-700 text-center">${comparison.pdf.opening_balance.toFixed(2)}</td>
            <td className="px-4 py-3 text-center text-gray-400 text-sm italic">-</td>
            <td className="px-4 py-3 text-center text-gray-400 text-sm italic">من الكشف</td>
          </tr>
        )}
        <tr className={`border-b ${match ? "bg-green-50" : "bg-red-50"}`}>
          <td className="px-4 py-3 font-medium text-gray-700">Closing Balance (رصيد النهاية)</td>
          <td className="px-4 py-3 font-bold text-blue-700 text-center">${pdfClosing.toFixed(2)}</td>
          <td className="px-4 py-3 font-bold text-gray-800 text-center">${siteClosing.toFixed(2)}</td>
          <td className="px-4 py-3 text-center">
            {match ? (
              <span className="flex items-center justify-center gap-1 text-green-600 font-semibold text-sm">
                <CheckCircle className="w-4 h-4" /> مطابق
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1 text-red-600 font-semibold text-sm">
                <XCircle className="w-4 h-4" /> فرق: ${Math.abs(pdfClosing - siteClosing).toFixed(2)}
              </span>
            )}
          </td>
        </tr>
      </>
    );
  };

  const handleAddMissing = async () => {
    if (!comparison?.missing || comparison.missing.length === 0) return;
    setAddingMissing(true);
    const records = comparison.missing.map((tx) => ({
      type: tx.type || "cash_in",
      sender_name: tx.sender_name || "",
      receiver_name: tx.receiver_name || "",
      amount: Number(tx.amount) || 0,
      commission: Number(tx.commission) || 0,
      reference_number: tx.reference_number || "",
      note: tx.note || "",
      currency: "USD",
      status: "completed",
      transaction_date: tx.date || "",
    }));
    await base44.entities.Transaction.bulkCreate(records);
    setAddingMissing(false);
    if (onRefresh) onRefresh();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-bold text-gray-800">مراجعة الكشف</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {/* Upload */}
          {step === "upload" && !loading && (
            <div>
              <p className="text-gray-500 text-sm mb-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
                📋 سيقارن هذا الزر أرقام الموقع الحالية مع إجماليات كشف الحساب PDF للتحقق من التطابق.
              </p>
              <div
                className="border-2 border-dashed border-purple-300 rounded-2xl p-12 text-center cursor-pointer hover:border-purple-500 hover:bg-purple-50 transition"
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current.click()}
              >
                <Upload className="w-10 h-10 text-purple-400 mx-auto mb-3" />
                <p className="text-base font-semibold text-gray-700">ارفع كشف الحساب PDF للمراجعة</p>
                <p className="text-gray-400 text-sm mt-1">سيُستخرج الإجماليات ويُقارن مع الموقع</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files[0])}
                />
                {error && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-red-500">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              <Loader2 className="w-12 h-12 text-purple-500 animate-spin" />
              <div className="text-center">
                <p className="text-gray-600 font-medium mb-1">جاري قراءة الكشف ومقارنة الأرقام...</p>
                <p className="text-gray-400 text-sm">يستخدم نموذج ذكاء اصطناعي متقدم — قد يستغرق 30-60 ثانية</p>
              </div>
              <div className="w-full max-w-sm">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>الوقت المنقضي: {elapsed}ث</span>
                  <span>المتوقع: ~60ث</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full bg-purple-500 transition-all duration-1000"
                    style={{ width: elapsed >= 61 ? "100%" : `${Math.min((elapsed / 60) * 100, 95)}%` }}
                  />
                </div>
                <p className="text-center text-sm font-bold text-purple-600 mt-2">{elapsed >= 61 ? "100%" : `${Math.min(Math.round((elapsed / 60) * 100), 95)}%`}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {step === "result" && comparison && (
            <div>
              {/* Status Banner */}
              <div className={`flex items-center gap-3 rounded-xl px-4 py-3 mb-5 ${allMatch ? "bg-green-100 border border-green-300" : "bg-red-100 border border-red-300"}`}>
                {allMatch ? (
                  <>
                    <CheckCircle className="w-6 h-6 text-green-600" />
                    <p className="font-bold text-green-700 text-base">✅ الأرقام متطابقة — جميع العمليات محمّلة بشكل صحيح</p>
                  </>
                ) : (
                  <>
                    <XCircle className="w-6 h-6 text-red-600" />
                    <p className="font-bold text-red-700 text-base">⚠️ يوجد فرق بين الكشف والموقع — راجع التفاصيل أدناه</p>
                  </>
                )}
              </div>

              {/* Wrong type transactions banner */}
              {comparison?.wrongType && comparison.wrongType.length > 0 && (
                <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-4 bg-orange-100 border border-orange-300">
                  <div>
                    <p className="font-bold text-orange-700">⚠️ تم اكتشاف {comparison.wrongType.length} عملية مقلوبة النوع</p>
                    <p className="text-sm text-orange-600 mt-1">عمليات مسجلة بمبلغ صحيح لكن نوعها خاطئ (Cash In ↔ Cash Out)</p>
                  </div>
                </div>
              )}

              {/* Missing transactions banner */}
              {comparison?.missing && comparison.missing.length > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-5 bg-yellow-100 border border-yellow-300">
                  <div>
                    <p className="font-bold text-yellow-700">🔍 تم اكتشاف {comparison.missing.length} عملية ناقصة</p>
                    <p className="text-sm text-yellow-600 mt-1">عمليات موجودة في الكشف لكن لم تُسجل في الجدول</p>
                  </div>
                  <button
                    onClick={handleAddMissing}
                    disabled={addingMissing}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg font-semibold transition disabled:opacity-50 whitespace-nowrap"
                  >
                    {addingMissing ? "جاري الإضافة..." : "إضافة الناقصة"}
                  </button>
                </div>
              )}

              {/* Comparison Table */}
              <table className="w-full text-sm text-right rounded-xl overflow-hidden border mb-6">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">البند</th>
                    <th className="px-4 py-3 text-center text-blue-700">كشف PDF</th>
                    <th className="px-4 py-3 text-center text-gray-700">الموقع</th>
                    <th className="px-4 py-3 text-center">النتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="إجمالي الإيداعات (Cash In)" pdfVal={comparison.pdf.total_cash_in} siteVal={comparison.site.total_cash_in} />
                  <Row label="إجمالي السحوبات (Cash Out)" pdfVal={comparison.pdf.total_cash_out} siteVal={comparison.site.total_cash_out} />
                  <Row label="عدد عمليات الإيداع" pdfVal={comparison.pdf.count_cash_in} siteVal={comparison.site.count_cash_in} isMoney={false} />
                  <Row label="عدد عمليات السحب" pdfVal={comparison.pdf.count_cash_out} siteVal={comparison.site.count_cash_out} isMoney={false} />
                  <Row label="إجمالي العمولات" pdfVal={comparison.pdf.total_commission} siteVal={comparison.site.total_commission} />
                  <ClosingRow />
                </tbody>
              </table>

              {/* Running Balance Table */}
              {comparison.pdf.transactions && comparison.pdf.transactions.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3">📊 تتبع الرصيد التراكمي (لاكتشاف أين بدأ الفرق):</h3>
                  <div className="overflow-x-auto rounded-xl border max-h-96 overflow-y-auto">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-gray-100 text-gray-700 sticky top-0">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">النوع</th>
                          <th className="px-3 py-2">المبلغ (PDF)</th>
                          <th className="px-3 py-2">المبلغ (الموقع)</th>
                          <th className="px-3 py-2">فرق المبلغ</th>
                          <th className="px-3 py-2">الرصيد التراكمي للفرق</th>
                          <th className="px-3 py-2">رقم المرجع</th>
                          <th className="px-3 py-2">ملاحظة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(() => {
                          let runningDiff = 0;
                          const usedIds = new Set();
                          return comparison.pdf.transactions.map((pdfTx, idx) => {
                            // ابحث أولاً عن مطابقة كاملة
                            let siteTx = transactions.find(s =>
                              !usedIds.has(s.id) &&
                              s.type === pdfTx.type &&
                              Math.abs(s.amount - pdfTx.amount) < 0.01
                            );
                            let isFlipped = false;
                            // ثم ابحث عن مقلوب
                            if (!siteTx) {
                              siteTx = transactions.find(s =>
                                !usedIds.has(s.id) &&
                                s.type !== pdfTx.type &&
                                Math.abs(s.amount - pdfTx.amount) < 0.01
                              );
                              if (siteTx) isFlipped = true;
                            }
                            if (siteTx) usedIds.add(siteTx.id);

                            const siteAmt = siteTx ? siteTx.amount : 0;
                            const diff = pdfTx.amount - siteAmt;
                            runningDiff += diff;
                            const hasDiff = Math.abs(diff) > 0.01;
                            const hasRunningDiff = Math.abs(runningDiff) > 0.01;
                            const rowBg = isFlipped ? "bg-orange-50" : hasDiff ? "bg-red-50" : "hover:bg-gray-50";
                            return (
                              <tr key={idx} className={rowBg}>
                                <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${pdfTx.type === "cash_in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                    {pdfTx.type === "cash_in" ? "In" : "Out"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-bold text-blue-700">${(pdfTx.amount || 0).toFixed(2)}</td>
                                <td className="px-3 py-2 font-bold text-gray-800">
                                  {siteTx
                                    ? <span className={isFlipped ? "text-orange-600" : ""}>
                                        ${siteAmt.toFixed(2)} {isFlipped ? `(${siteTx.type === "cash_in" ? "In ✗" : "Out ✗"})` : ""}
                                      </span>
                                    : <span className="text-red-500 italic">غير موجود</span>}
                                </td>
                                <td className={`px-3 py-2 font-bold ${isFlipped ? "text-orange-600" : hasDiff ? "text-red-600" : "text-green-600"}`}>
                                  {isFlipped ? "نوع خاطئ" : hasDiff ? `$${diff.toFixed(2)}` : "✓"}
                                </td>
                                <td className={`px-3 py-2 font-bold ${hasRunningDiff ? "text-orange-600" : "text-green-600"}`}>
                                  {hasRunningDiff ? `$${runningDiff.toFixed(2)}` : "✓"}
                                </td>
                                <td className="px-3 py-2 text-gray-500">{pdfTx.reference_number || "-"}</td>
                                <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{pdfTx.note || "-"}</td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Wrong Type Transactions Details */}
              {comparison?.wrongType && comparison.wrongType.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3">⚠️ عمليات مقلوبة النوع ({comparison.wrongType.length}) — مسجلة بنوع خاطئ:</h3>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-orange-50 text-gray-700">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">النوع الصحيح (PDF)</th>
                          <th className="px-3 py-2">النوع المسجل (الموقع)</th>
                          <th className="px-3 py-2">المبلغ</th>
                          <th className="px-3 py-2">المرسل</th>
                          <th className="px-3 py-2">رقم المرجع</th>
                          <th className="px-3 py-2">التاريخ</th>
                          <th className="px-3 py-2">ملاحظة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-orange-100">
                        {comparison.wrongType.map((tx, idx) => {
                          const wrongSite = transactions.find(s =>
                            Math.abs(s.amount - tx.amount) < 0.01 && s.type !== tx.type
                          );
                          return (
                            <tr key={idx} className="bg-orange-50 hover:bg-orange-100">
                              <td className="px-3 py-2">{idx + 1}</td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${tx.type === "cash_in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                  {tx.type === "cash_in" ? "Cash In ✓" : "Cash Out ✓"}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {wrongSite ? (
                                  <span className={`px-2 py-1 rounded text-xs font-semibold ${wrongSite.type === "cash_in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"} opacity-60`}>
                                    {wrongSite.type === "cash_in" ? "Cash In ✗" : "Cash Out ✗"}
                                  </span>
                                ) : "-"}
                              </td>
                              <td className="px-3 py-2 font-bold text-gray-800">${(tx.amount || 0).toFixed(2)}</td>
                              <td className="px-3 py-2">{tx.sender_name || "-"}</td>
                              <td className="px-3 py-2 text-gray-500">{tx.reference_number || "-"}</td>
                              <td className="px-3 py-2 text-gray-500">{tx.date || "-"}</td>
                              <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{tx.note || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Missing Transactions Details */}
              {comparison?.missing && comparison.missing.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3">📋 تفاصيل العمليات الناقصة ({comparison.missing.length}):</h3>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-yellow-50 text-gray-700">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">النوع</th>
                          <th className="px-3 py-2">المرسل</th>
                          <th className="px-3 py-2">المستلم</th>
                          <th className="px-3 py-2">المبلغ</th>
                          <th className="px-3 py-2">العمولة</th>
                          <th className="px-3 py-2">رقم المرجع</th>
                          <th className="px-3 py-2">التاريخ</th>
                          <th className="px-3 py-2">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-yellow-100">
                        {comparison.missing.map((tx, idx) => (
                          <tr key={idx} className="hover:bg-yellow-50">
                            <td className="px-3 py-2">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                tx.type === "cash_in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                              }`}>
                                {tx.type === "cash_in" ? "In" : "Out"}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-medium">{tx.sender_name || "-"}</td>
                            <td className="px-3 py-2">{tx.receiver_name || "-"}</td>
                            <td className="px-3 py-2 font-bold text-gray-800">${(tx.amount || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-600">${(tx.commission || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-500">{tx.reference_number || "-"}</td>
                            <td className="px-3 py-2 text-gray-500">{tx.date || "-"}</td>
                            <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{tx.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                onClick={() => { setStep("upload"); setComparison(null); }}
                className="text-sm text-purple-500 hover:underline"
              >
                مراجعة كشف آخر
              </button>
            </div>
          )}
        </div>

        <div className="border-t p-4 flex justify-end">
          <button onClick={onClose} className="border rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
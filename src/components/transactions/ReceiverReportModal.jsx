import { useState, useMemo } from "react";
import { X, Search, UserCheck, ArrowDownCircle, ArrowUpCircle, Percent, Hash } from "lucide-react";
import { matchesReceiver, receiverDisplay } from "@/lib/transactionSearch";

export default function ReceiverReportModal({ allTransactions, onClose }) {
  const [receiverQuery, setReceiverQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searched, setSearched] = useState(false);

  const fmt = (n) => (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const results = useMemo(() => {
    if (!receiverQuery.trim()) return [];
    return allTransactions.filter((t) => {
      // المستلم: الاسم، أو رقم الزبون/الهاتف إذا كان المستلم مسجلاً كرقم
      if (!matchesReceiver(t, receiverQuery)) return false;

      const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
      if (dateFrom && tDate < dateFrom) return false;
      if (dateTo && tDate > dateTo) return false;
      return true;
    });
  }, [receiverQuery, dateFrom, dateTo, allTransactions]);

  const stats = useMemo(() => {
    const deposits = results.filter((t) => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
    const withdrawals = results.filter((t) => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);
    const commissions = results.reduce((s, t) => s + (t.commission || 0), 0);
    return { deposits, withdrawals, commissions, count: results.length };
  }, [results]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-bold text-gray-800">تقرير المستلم</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b bg-gray-50 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 mb-1 block">اسم أو رقم المستلم</label>
            <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="اكتب اسم أو رقم المستلم..."
                value={receiverQuery}
                onChange={(e) => { setReceiverQuery(e.target.value); setSearched(true); }}
                className="bg-transparent outline-none text-sm w-full text-right"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">من تاريخ</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="من تاريخ"
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">إلى تاريخ</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="إلى تاريخ"
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-gray-400 hover:text-red-500 transition mt-4"
            >
              مسح الفلتر
            </button>
          )}
        </div>

        {/* Stats */}
        {searched && receiverQuery.trim() && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b bg-green-50/50">
            <div className="bg-white rounded-lg p-3 border border-gray-100 flex items-center gap-3">
              <div className="bg-purple-100 rounded-lg p-2"><Hash className="w-5 h-5 text-purple-600" /></div>
              <div>
                <p className="text-xs text-gray-500">عدد الحوالات</p>
                <p className="text-lg font-bold text-gray-800" data-testid="receiver-count">{stats.count}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-100 flex items-center gap-3">
              <div className="bg-green-100 rounded-lg p-2"><ArrowDownCircle className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-xs text-gray-500">إجمالي الإيداعات</p>
                <p className="text-lg font-bold text-green-700" data-testid="receiver-deposits">${fmt(stats.deposits)}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-100 flex items-center gap-3">
              <div className="bg-red-100 rounded-lg p-2"><ArrowUpCircle className="w-5 h-5 text-red-500" /></div>
              <div>
                <p className="text-xs text-gray-500">إجمالي السحوبات</p>
                <p className="text-lg font-bold text-red-600" data-testid="receiver-withdrawals">${fmt(stats.withdrawals)}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-100 flex items-center gap-3">
              <div className="bg-orange-100 rounded-lg p-2"><Percent className="w-5 h-5 text-orange-500" /></div>
              <div>
                <p className="text-xs text-gray-500">إجمالي العمولات</p>
                <p className="text-lg font-bold text-orange-600" data-testid="receiver-commissions">${fmt(stats.commissions)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {!searched || !receiverQuery.trim() ? (
            <div className="p-12 text-center text-gray-400">
              <UserCheck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p>اكتب اسم أو رقم المستلم للبحث</p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <p>لا توجد نتائج للبحث عن &quot;{receiverQuery}&quot;</p>
            </div>
          ) : (
            <table className="w-full text-sm text-right">
              <thead className="bg-gray-50 text-gray-600 sticky top-0">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">المستلم</th>
                  <th className="px-4 py-3">المرسل</th>
                  <th className="px-4 py-3">النوع</th>
                  <th className="px-4 py-3">المبلغ</th>
                  <th className="px-4 py-3">العمولة</th>
                  <th className="px-4 py-3">رقم العملية</th>
                  <th className="px-4 py-3">الخدمة</th>
                  <th className="px-4 py-3">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((t, i) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{receiverDisplay(t) || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{t.sender_name || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        t.type === "cash_in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                        {t.type === "cash_in" ? "Cash In" : "Cash Out"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-800">${(t.amount || 0).toFixed(2)}</td>
                    <td className={`px-4 py-3 font-bold ${t.type === "cash_out" ? "text-red-600" : "text-green-600"}`}>
                      ${(t.commission || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{t.reference_number || "-"}</td>
                    <td className="px-4 py-3">
                      {t.service ? (
                        <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-blue-200">
                          {t.service}
                        </span>
                      ) : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {t.transaction_date || new Date(t.created_date).toISOString().split("T")[0]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

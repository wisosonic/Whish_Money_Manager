import { useMemo } from "react";
import { X, Percent } from "lucide-react";

export default function DailyCommissionReport({ transactions, selectedDate, onClose }) {
  const senderStats = useMemo(() => {
    const dayTx = transactions.filter((t) => {
      const d = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
      return d === selectedDate && (t.commission || 0) > 0;
    });

    const map = {};
    dayTx.forEach((t) => {
      const name = t.sender_name || "غير معروف";
      if (!map[name]) map[name] = { count: 0, totalAmount: 0, totalCommission: 0 };
      map[name].count += 1;
      map[name].totalAmount += t.amount || 0;
      map[name].totalCommission += t.commission || 0;
    });

    return Object.entries(map)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.totalCommission - a.totalCommission);
  }, [transactions, selectedDate]);

  const totalCommission = senderStats.reduce((s, r) => s + r.totalCommission, 0);
  const totalCount = senderStats.reduce((s, r) => s + r.count, 0);

  const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="bg-orange-100 rounded-lg p-2">
              <Percent className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 text-lg">تقرير العمولات اليومي</h2>
              <p className="text-gray-500 text-sm">{selectedDate}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 p-4 bg-gray-50 border-b">
          <div className="bg-white rounded-lg p-3 text-center border">
            <p className="text-xs text-gray-500 mb-1">إجمالي العمولات</p>
            <p className="font-bold text-orange-600 text-base">${fmt(totalCommission)}</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center border">
            <p className="text-xs text-gray-500 mb-1">عدد المرسلين</p>
            <p className="font-bold text-blue-600 text-base">{senderStats.length}</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center border">
            <p className="text-xs text-gray-500 mb-1">عدد العمليات</p>
            <p className="font-bold text-gray-700 text-base">{totalCount}</p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {senderStats.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Percent className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>لا توجد عمولات لهذا اليوم</p>
            </div>
          ) : (
            <table className="w-full text-sm text-right">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-gray-600 font-medium">#</th>
                  <th className="px-4 py-3 text-gray-600 font-medium">اسم المرسل</th>
                  <th className="px-4 py-3 text-gray-600 font-medium">عدد العمليات</th>
                  <th className="px-4 py-3 text-gray-600 font-medium">إجمالي المبالغ</th>
                  <th className="px-4 py-3 text-gray-600 font-medium">إجمالي العمولة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {senderStats.map((row, i) => (
                  <tr key={row.name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{row.name}</td>
                    <td className="px-4 py-3 text-gray-600">{row.count}</td>
                    <td className="px-4 py-3 text-gray-700">${fmt(row.totalAmount)}</td>
                    <td className="px-4 py-3 font-bold text-orange-600">${fmt(row.totalCommission)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-orange-50 border-t-2 border-orange-200">
                <tr>
                  <td colSpan={2} className="px-4 py-3 font-bold text-gray-700">الإجمالي</td>
                  <td className="px-4 py-3 font-bold text-gray-700">{totalCount}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 font-bold text-orange-700 text-base">${fmt(totalCommission)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
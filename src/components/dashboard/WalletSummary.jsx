import { useState } from "react";
import { Wallet, TrendingUp, ArrowDownCircle, ArrowUpCircle, Percent, Pencil, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function WalletSummary({
  openingBalance,
  openingBalanceDate,
  totalDeposits,
  totalWithdrawals,
  totalCommissions,
  netBalance,
  onSaveOpeningBalance
}) {
  const { t, dir, num } = useI18n();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const formatAmount = (amount) =>
  (amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleEdit = () => {
    setEditValue(openingBalance ?? 0);
    setEditing(true);
  };

  const handleSave = async () => {
    if (onSaveOpeningBalance) await onSaveOpeningBalance(Number(editValue));
    setEditing(false);
  };

  const handleCancel = () => setEditing(false);

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 md:p-5 border border-gray-100 w-full" dir={dir}>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        {/* الصافي */}
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 rounded-lg p-3 flex-shrink-0">
            <Wallet className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-xs md:text-sm font-medium text-[hsl(var(--foreground))]">{t("wallet.net")}</p>
            <p className="text-gray-900 font-bold text-sm md:text-base">
              ${num(formatAmount(netBalance))}
            </p>
          </div>
        </div>

        {/* عمولات */}
        <div className="flex items-center gap-3">
          <div className="bg-orange-100 rounded-lg p-3 flex-shrink-0">
            <Percent className="w-6 h-6 text-orange-500" />
          </div>
          <div>
            <p className="text-xs md:text-sm font-medium text-[hsl(var(--foreground))]">{t("wallet.commissions")}</p>
            <p className="text-gray-900 font-bold text-sm md:text-base">
              ${num(formatAmount(totalCommissions))}
            </p>
          </div>
        </div>

        {/* سحوبات */}
        <div className="flex items-center gap-3">
          <div className="bg-red-100 rounded-lg p-3 flex-shrink-0">
            <ArrowUpCircle className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <p className="text-xs md:text-sm font-medium text-start text-[hsl(var(--foreground))]">{t("wallet.withdrawals")}</p>
            <p className="text-gray-900 font-bold text-sm md:text-base">
              ${num(formatAmount(totalWithdrawals))}
            </p>
          </div>
        </div>

        {/* إيداعات */}
        <div className="flex items-center gap-3">
          <div className="bg-green-100 rounded-lg p-3 flex-shrink-0">
            <ArrowDownCircle className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <p className="md:text-sm font-medium text-[hsl(var(--foreground))] text-sm">{t("wallet.deposits")}</p>
            <p className="text-gray-900 font-bold text-sm md:text-base">
              ${num(formatAmount(totalDeposits))}
            </p>
          </div>
        </div>

        {/* رصيد البداية */}
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 rounded-lg p-3 flex-shrink-0">
            <TrendingUp className="w-6 h-6 text-indigo-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs md:text-sm font-medium text-[hsl(var(--foreground))]">{t("wallet.openingBalance")}</p>
            {editing ?
            <div className="flex items-center gap-1 mt-0.5">
                <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="border border-indigo-300 rounded px-2 py-0.5 text-sm font-bold w-24 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                autoFocus
                onKeyDown={(e) => {if (e.key === "Enter") handleSave();if (e.key === "Escape") handleCancel();}} />
              
                <button onClick={handleSave} className="text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
                <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div> :

            <div className="flex items-center gap-1">
                <p className="text-gray-900 font-bold text-sm md:text-base">${num(formatAmount(openingBalance))}</p>
                {onSaveOpeningBalance &&
                <button onClick={handleEdit} className="text-gray-300 hover:text-indigo-500 transition" aria-label={t("wallet.editOpeningBalance")}><Pencil className="w-3.5 h-3.5" /></button>
                }
              </div>
            }
          </div>
        </div>
      </div>
    </div>);

}
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { api } from "@/api/apiClient";
import AmbiguousRowsTable from "@/components/transactions/AmbiguousRowsTable";
import ConvertAmbiguousRowModal from "@/components/transactions/ConvertAmbiguousRowModal";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";

// The dashboard's "Ambiguous rows" window (user's request, 2026-09-28): every statement row past
// imports set aside because it couldn't be read as one Cash In or Cash Out (a negative debit or
// credit, both, or neither), newest import first. Who sees what follows the import history (the
// Admin every store, a Manager their store, a User their own imports).
//
// Three actions per row (user's request, 2026-09-29):
//   - Accept as is: saves it as printed, no review — the larger of debit/credit (in absolute value)
//     decides the type and the amount, same as the file's own numbers (with an inline "تأكيد", since
//     it can't be undone). A row with nothing usable (e.g. "neither": blank or zero) is refused by the
//     server (400/423/409, same checks as a correction) and shown as an error toast; "correct and add"
//     is the way to fix those.
//   - Discard: removes it for good (with an inline "تأكيد", since it can't be undone).
//   - Correct and add: opens ConvertAmbiguousRowModal, which turns it into a real transaction.
// All three remove the row from the list on success and call onChanged() so the dashboard's badge
// (which counts these rows) is asked again.
const asPrinted = (row) => {
  const debit = Math.abs(parseFloat(row.debit)) || 0;
  const credit = Math.abs(parseFloat(row.credit)) || 0;
  return debit >= credit
    ? { type: "cash_out", amount: debit }
    : { type: "cash_in", amount: credit };
};
export default function AmbiguousRowsModal({ storeId, withStore = false, onClose, onChanged }) {
  const { t, dir, errorText } = useI18n();
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [editingRow, setEditingRow] = useState(null);

  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => api.importHistory.ambiguous(storeId))
      .then((answer) => { if (current) setResult(answer); })
      .catch((err) => { if (current) setError(err?.message ? errorText(err.message) : t("ambiguous.loadFailed")); });
    return () => { current = false; };
  }, [storeId, errorText, t]);

  // Escape closes it, like the other windows should (unless the correction form is open — that one
  // handles its own Escape by way of its Cancel button, so this Escape only ever closes one layer).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !editingRow) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editingRow]);

  // Removes a row from the list shown here (after either action succeeds) and tells the dashboard to
  // recount the badge — and, only when a transaction was just created (a correction, not a plain
  // discard), to refresh the day shown too, in case the new transaction belongs to it.
  const removeRow = (id, { createdTransaction = false } = {}) => {
    setResult((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - 1), rows: prev.rows.filter((r) => r.id !== id) } : prev));
    onChanged?.({ createdTransaction });
  };

  const handleAccept = async (row) => {
    setPendingId(row.id);
    try {
      const { type, amount } = asPrinted(row);
      await api.importHistory.convert(row.id, {
        type, amount,
        sender_name: row.description || "",
        receiver_name: row.description || "",
        service: row.service || "",
        reference_number: row.reference_number || "",
        transaction_date: row.date || "",
      });
      notify.success(t("ambiguous.acceptedToast"));
      removeRow(row.id, { createdTransaction: true });
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("ambiguous.acceptFailed"));
    } finally {
      setPendingId(null);
    }
  };

  const handleDiscard = async (row) => {
    setPendingId(row.id);
    try {
      await api.importHistory.discardAmbiguous(row.id);
      notify.success(t("ambiguous.discardedToast"));
      removeRow(row.id);
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("ambiguous.discardFailed"));
    } finally {
      setPendingId(null);
    }
  };

  const handleConverted = (id) => {
    setEditingRow(null);
    removeRow(id, { createdTransaction: true });
  };

  const rows = result?.rows ?? [];
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
      <div role="dialog" aria-modal="true" aria-labelledby="ambiguous-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col" data-testid="ambiguous-modal">
        <div className="flex items-center justify-between gap-3 p-5 border-b">
          <div>
            <h2 id="ambiguous-title" className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-700" aria-hidden="true" />
              {t("ambiguous.title")}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{t("ambiguous.description")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="text-gray-400 hover:text-gray-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {error && <p role="alert" className="m-5 text-sm text-red-700">{error}</p>}
          {!result && !error &&
            <p role="status" className="p-8 flex items-center justify-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("common.loading")}</p>}
          {result && rows.length === 0 &&
            <p className="p-10 text-center text-gray-600" data-testid="ambiguous-empty">{t("ambiguous.empty")}</p>}
          {rows.length > 0 && <>
            <p className="px-5 pt-3 pb-2 text-sm text-gray-500" data-testid="ambiguous-count">{t("ambiguous.count", { count: result.total })}</p>
            {result.truncated &&
              <p role="status" className="mx-5 mb-2 rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">{t("ambiguous.truncated", { shown: rows.length, total: result.total })}</p>}
            <AmbiguousRowsTable
              rows={rows}
              withImport
              withStore={withStore}
              onAccept={handleAccept}
              onDiscard={handleDiscard}
              onConvertClick={setEditingRow}
              pendingId={pendingId} />
          </>}
        </div>
      </div>
      {editingRow &&
      <ConvertAmbiguousRowModal row={editingRow} onClose={() => setEditingRow(null)} onSaved={handleConverted} />
      }
    </div>
  );
}

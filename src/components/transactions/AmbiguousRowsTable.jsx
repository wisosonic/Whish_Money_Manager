import { useState } from "react";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { formatLastLogin } from "@/components/layout/Header";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/PreferencesContext";

// Statement rows the CSV engine set aside as ambiguous (user's request, 2026-09-29): a negative
// debit or credit, both a debit and a credit, or neither. Shown as printed in the file.
// withImport: also the import each came from (file, when, by) — the dashboard's list; withStore:
// the store too (All stores).
//
// Row actions (user's request, 2026-09-29), shown only when the callbacks are passed — never in the
// import preview (ImportPDFModal), whose rows aren't saved yet and have no id to act on:
//   onAccept(row)        called once its inline "تأكيد" confirms it — accepts the row as printed
//                        (the larger of debit/credit decides type and amount) and saves it.
//   onDiscard(row)       called once its inline "تأكيد" confirms it — removes the row for good.
//   onConvertClick(row)  opens the parent's "correct and add" modal (its own Save does the work).
//   pendingId            the row currently being accepted or discarded — buttons disable, a spinner shows.
export default function AmbiguousRowsTable({ rows, withImport = false, withStore = false, onAccept, onDiscard, onConvertClick, pendingId = null, testId = "ambiguous-table" }) {
  const { t, num } = useI18n();
  const hour24 = usePreferences().preferences.clock === "24h";
  const [confirm, setConfirm] = useState(null); // { id, action: "accept" | "discard" } | null
  const th = "px-3 py-2 text-start font-semibold whitespace-nowrap";
  const withActions = Boolean(onAccept || onDiscard || onConvertClick);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm text-start" data-testid={testId}>
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className={th}>{t("ambiguous.col.line")}</th>
            <th className={th}>{t("ambiguous.col.date")}</th>
            <th className={th}>{t("ambiguous.col.description")}</th>
            <th className={th}>{t("ambiguous.col.debit")}</th>
            <th className={th}>{t("ambiguous.col.credit")}</th>
            <th className={th}>{t("ambiguous.col.reason")}</th>
            {withStore && <th className={th}>{t("stores.column")}</th>}
            {withImport && <th className={th}>{t("ambiguous.col.import")}</th>}
            {withActions && <th className={th}>{t("ambiguous.col.actions")}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => {
            const key = row.id ?? `${row.line_no}-${i}`;
            const pending = pendingId != null && pendingId === row.id;
            return (
              <tr key={key} data-testid="ambiguous-row">
                <td className="px-3 py-2 text-gray-500" dir="ltr">{row.line_no ?? "-"}</td>
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{row.date ? num(row.date) : "-"}</td>
                <td className="px-3 py-2">
                  <span className="block">{row.description || "-"}</span>
                  {row.reference_number && <span className="block text-xs text-gray-500" dir="ltr">{row.reference_number}</span>}
                </td>
                <td className="px-3 py-2 font-mono" dir="ltr">{row.debit || "—"}</td>
                <td className="px-3 py-2 font-mono" dir="ltr">{row.credit || "—"}</td>
                <td className="px-3 py-2">
                  <span className="inline-block rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-2 py-0.5" data-testid="ambiguous-reason">
                    {t(`ambiguous.reason.${row.reason}`)}
                  </span>
                </td>
                {withStore && <td className="px-3 py-2">{row.store_name ?? t("imports.deletedStore")}</td>}
                {withImport &&
                  <td className="px-3 py-2 text-xs text-gray-600">
                    <span className="block break-words" dir="ltr">{row.file_name || t("imports.noFileName")}</span>
                    <span className="block" dir="ltr">{num(formatLastLogin(row.imported_at, { hour24 }))}</span>
                    <span className="block">{row.imported_by_name || row.imported_by}</span>
                  </td>
                }
                {withActions &&
                  <td className="px-3 py-2">
                    {pending ?
                      <span className="flex items-center gap-1 text-gray-400" data-testid="ambiguous-row-pending">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      </span> :
                    confirm?.id === row.id ?
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setConfirm(null); (confirm.action === "accept" ? onAccept : onDiscard)(row); }}
                          data-testid={confirm.action === "accept" ? "ambiguous-accept-confirm" : "ambiguous-discard-confirm"}
                          className={`text-xs text-white px-2 py-0.5 rounded font-semibold transition ${confirm.action === "accept" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"}`}>
                          {t("common.confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirm(null)}
                          aria-label={t("common.cancel")}
                          className="text-gray-400 hover:text-gray-600">
                          <X className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div> :
                      <div className="flex items-center gap-2">
                        {onAccept &&
                        <button
                          type="button"
                          onClick={() => setConfirm({ id: row.id, action: "accept" })}
                          title={t("ambiguous.action.accept")}
                          aria-label={t("ambiguous.action.accept")}
                          data-testid="ambiguous-accept"
                          className="text-gray-400 hover:text-green-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 rounded">
                            <Check className="w-4 h-4" aria-hidden="true" />
                          </button>
                        }
                        {onConvertClick &&
                        <button
                          type="button"
                          onClick={() => onConvertClick(row)}
                          title={t("ambiguous.action.convert")}
                          aria-label={t("ambiguous.action.convert")}
                          data-testid="ambiguous-convert"
                          className="text-gray-400 hover:text-blue-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                        }
                        {onDiscard &&
                        <button
                          type="button"
                          onClick={() => setConfirm({ id: row.id, action: "discard" })}
                          title={t("ambiguous.action.discard")}
                          aria-label={t("ambiguous.action.discard")}
                          data-testid="ambiguous-discard"
                          className="text-gray-400 hover:text-red-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded">
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        }
                      </div>
                    }
                  </td>
                }
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

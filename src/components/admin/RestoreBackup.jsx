import { useRef, useState } from "react";
import { DatabaseBackup, Upload, Loader2, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { api } from "@/api/apiClient";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { Section } from "@/components/settings/SettingsControls";

// Admin panel → Restore from a backup (data:restore — Admin + Manager). Adds back rows from a CSV
// downloaded with the panel's Backup section — transactions or opening balances. Nothing is written until the preview is confirmed:
// rows still in the database are left as they are, rows on closed days are skipped, and a file
// with any invalid row can't be restored (see server/admin.js).
const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// onRestored: called after rows were added, so the panel can refresh its range summary.
export default function RestoreBackup({ onRestored }) {
  const { t, dir, num, errorText } = useI18n();
  const fileInput = useRef(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const reset = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  };

  const check = async (text) => {
    setChecking(true);
    setError("");
    setPreview(null);
    try {
      setPreview(await api.admin.restorePreview(text));
    } catch (err) {
      const message = errorText(err?.message || "") || t("restore.checkFailed");
      setError(message);
      notify.error(message);
    } finally {
      setChecking(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await check(text);
  };

  const restore = async () => {
    setRestoring(true);
    try {
      const result = await api.admin.restore(csv, preview.to_add);
      notify.success(t(`toast.restore.done.${result.kind}`, { count: result.restored }), { duration: 10000 });
      setConfirming(false);
      reset();
      onRestored?.();
    } catch (err) {
      const message = errorText(err?.message || "") || t("restore.failed");
      setConfirming(false);
      if (err?.status === 409) {
        notify.warning(message);
        await check(csv); // show the new counts
      } else {
        notify.error(message);
      }
    } finally {
      setRestoring(false);
    }
  };

  const canRestore = preview && preview.invalid_count === 0 && preview.to_add > 0;

  return (
    <Section id="admin-restore" icon={DatabaseBackup} title={t("restore.title")} description={t("restore.description")}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition cursor-pointer focus-within:ring-2 focus-within:ring-blue-300">
          <Upload className="w-4 h-4" aria-hidden="true" />
          {t("restore.choose")}
          <input
            ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" data-testid="restore-file"
            onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {fileName && <span className="text-sm text-gray-600" dir="ltr">{fileName}</span>}
        {checking && <span className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("restore.checking")}</span>}
      </div>
      <p className="text-xs text-gray-500 mt-2">{t("restore.hint")}</p>

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

      {preview &&
        <div className="mt-4 rounded-lg border bg-gray-50 p-4 text-sm space-y-2" aria-live="polite" data-testid="restore-preview">
          <p className="font-bold text-gray-800">{t(`restore.fileHolds.${preview.kind}`, { count: preview.rows })}</p>
          {preview.invalid_count > 0 ?
            <div className="text-red-700" data-testid="restore-invalid">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" aria-hidden="true" />{t("restore.invalid", { count: preview.invalid_count })}</p>
              <ul className="list-disc ps-6 mt-1">
                {preview.invalid.map((row) => <li key={row.line}>{t("restore.invalidRow", { line: row.line, field: row.field })}</li>)}
              </ul>
            </div> :
            <ul className="space-y-1">
              <li className="flex items-center gap-2 text-green-800" data-testid="restore-to-add">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />{t("restore.toAdd", { count: preview.to_add })}
                {preview.to_add > 0 && preview.first_date &&
                  <span className="text-gray-600">{t("restore.range", { from: num(preview.first_date), to: num(preview.last_date) })}</span>}
              </li>
              {preview.kind === "transactions" && preview.to_add > 0 &&
                <li className="text-gray-700" dir="ltr">{t("admin.summary.in")} {num(money(preview.total_in))} · {t("admin.summary.out")} {num(money(preview.total_out))}</li>}
              <li className="text-gray-600">{t("restore.existing", { count: preview.existing })}</li>
              {preview.on_closed_days > 0 &&
                <li className="text-amber-800 flex items-center gap-2"><Lock className="w-4 h-4" aria-hidden="true" />{t("restore.closed", { count: preview.on_closed_days, days: preview.closed_days.map(num).join(t("common.listSeparator")) })}</li>}
              {preview.duplicates_in_file > 0 && <li className="text-gray-600">{t("restore.duplicates", { count: preview.duplicates_in_file })}</li>}
            </ul>
          }
          {preview.invalid_count === 0 && preview.to_add === 0 && <p className="text-gray-700">{t("restore.nothing")}</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button" onClick={() => setConfirming(true)} disabled={!canRestore} data-testid="restore-start"
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 font-semibold transition disabled:opacity-50">
              {t(`restore.button.${preview.kind}`, { count: preview.to_add })}
            </button>
            <button type="button" onClick={reset} className="border rounded-lg px-4 py-2 text-gray-600 hover:bg-white transition">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      }

      {confirming && preview &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
          <div role="alertdialog" aria-labelledby="restore-confirm-title" aria-describedby="restore-confirm-body" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h3 id="restore-confirm-title" className="font-bold text-gray-800 text-lg mb-2">
              {t(`restore.confirmTitle.${preview.kind}`, { count: preview.to_add })}
            </h3>
            <p id="restore-confirm-body" className="text-sm text-gray-600 mb-5">{t("restore.confirmBody")}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirming(false)} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {t("common.cancel")}
              </button>
              <button
                type="button" onClick={restore} disabled={restoring} data-testid="restore-confirm"
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">
                {restoring && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {t("restore.confirm")}
              </button>
            </div>
          </div>
        </div>
      }
    </Section>
  );
}

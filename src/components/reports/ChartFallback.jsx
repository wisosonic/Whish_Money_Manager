import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// Shown while the chart's code (Recharts, a separate download) loads the first time a chart opens.
// `overlay`: in place of the dashboard's chart window, so the page doesn't jump when it appears.
export default function ChartFallback({ overlay = false }) {
  const { t, dir } = useI18n();
  const spinner = (
    <div role="status" className="flex items-center justify-center gap-2 p-12 text-gray-500" data-testid="chart-code-loading">
      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
      {t("common.loading")}
    </div>
  );
  if (!overlay) return spinner;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 md:p-4" dir={dir}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl">{spinner}</div>
    </div>
  );
}

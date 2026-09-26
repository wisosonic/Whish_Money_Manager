import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// Shown while the chart's code (Recharts, a separate download) loads the first time the admin
// panel's Income report opens.
export default function ChartFallback() {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-12 text-gray-500" data-testid="chart-code-loading">
      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
      {t("common.loading")}
    </div>
  );
}

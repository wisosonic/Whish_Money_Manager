import { Store } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// Choose a store (the Admin, when there are several). value: a store id, or "all" when `allowAll`.
export default function StorePicker({ stores, value, onChange, allowAll = false, label, testId = "store-picker-select" }) {
  const { t } = useI18n();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-700">
      <Store className="w-4 h-4 text-blue-600" aria-hidden="true" />
      {label ?? t("stores.column")}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "all" ? "all" : Number(e.target.value))} data-testid={testId}
        className="border rounded-lg px-3 py-1.5 font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
        {allowAll && <option value="all">{t("stores.all")}</option>}
        {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
      </select>
    </label>
  );
}

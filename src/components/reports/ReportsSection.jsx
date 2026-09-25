import { useRef, useState } from "react";
import { BarChart3, TrendingUp, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Section } from "@/components/settings/SettingsControls";
import IncomeReport from "@/components/reports/IncomeReport";
import PartyReport from "@/components/reports/PartyReport";
import { useI18n } from "@/lib/i18n";

// Admin panel → Reports: income by month, top senders, top recipients — as tabs. Only the open
// report is rendered (and fetched). Keyboard: arrows (mirrored in RTL), Home / End.
const TABS = [
  { id: "income", icon: TrendingUp },
  { id: "senders", icon: ArrowDownCircle },
  { id: "recipients", icon: ArrowUpCircle },
];

export default function ReportsSection() {
  const { t, dir } = useI18n();
  const [active, setActive] = useState("income");
  const tabRefs = useRef({});

  const open = (id, focus = false) => {
    setActive(id);
    if (focus) tabRefs.current[id]?.focus();
  };
  const onKey = (e) => {
    const index = TABS.findIndex((tab) => tab.id === active);
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let next = null;
    if (e.key === forward) next = (index + 1) % TABS.length;
    else if (e.key === back) next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    open(TABS[next].id, true);
  };

  return (
    <Section id="admin-reports" icon={BarChart3} title={t("adminReports.title")} description={t("adminReports.description")}>
      <div role="tablist" aria-label={t("adminReports.title")} className="flex flex-wrap gap-2 border-b pb-3 mb-4" onKeyDown={onKey}>
        {TABS.map(({ id, icon: Icon }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              ref={(el) => { tabRefs.current[id] = el; }}
              type="button"
              role="tab"
              id={`report-tab-${id}`}
              aria-selected={selected}
              aria-controls={`report-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => open(id)}
              data-testid={`report-tab-${id}`}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${selected ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
              <Icon className="w-4 h-4" aria-hidden="true" />
              {t(`adminReports.tab.${id}`)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`report-panel-${active}`} aria-labelledby={`report-tab-${active}`} tabIndex={0} className="focus:outline-none">
        {active === "income" && <IncomeReport />}
        {active === "senders" && <PartyReport party="sender" />}
        {active === "recipients" && <PartyReport party="receiver" />}
      </div>
    </Section>
  );
}

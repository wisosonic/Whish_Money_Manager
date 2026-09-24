import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Percent, Wallet, Hash, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const fmt = (n) => (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "سبتمبر 2026" / "September 2026" — month name in the interface language, Latin digits.
const formatMonthLabel = (selectedDate, locale) => {
  const [year, month] = String(selectedDate || "").split("-").map(Number);
  if (!year || !month) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
};

function StatCard({ label, value, icon, iconBg }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 md:p-5 border border-gray-100">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-gray-800 text-xs md:text-sm font-medium mb-2">{label}</p>
          <p className="text-gray-900 text-lg md:text-xl font-bold break-words">{value}</p>
        </div>
        <div className={`${iconBg} rounded-lg p-2.5 flex-shrink-0`}>{icon}</div>
      </div>
    </div>
  );
}

// Collapsible summary block. When collapsed, the header still shows the key figures inline.
function SummarySection({ id, title, period, cards, collapsedSummary, defaultOpen, gridClassName }) {
  const { dir } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${id}-content`;

  return (
    <section data-testid={id} className="rounded-xl border border-gray-200 bg-gray-50/80">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 md:px-4 py-2.5 text-start"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-bold text-gray-800 text-sm md:text-base">{title}</span>
          {period && <span className="text-xs md:text-sm text-gray-500">{period}</span>}
        </span>
        <span className="flex items-center gap-3 ms-auto">
          {!open && (
            <span className={`text-xs md:text-sm text-gray-600 animate-in fade-in ${dir === "rtl" ? "slide-in-from-left-1" : "slide-in-from-right-1"} duration-300 motion-reduce:animate-none`} data-testid={`${id}-collapsed`}>
              {collapsedSummary}
            </span>
          )}
          <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform duration-300 ease-in-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {/* Animated expand/collapse: the grid row goes 0fr ↔ 1fr so the panel grows to its natural
          height (no fixed max-height), while the cards fade and slide into place. The content stays
          mounted; when closed it's made invisible and inert so it can't be reached by keyboard or
          screen readers. visibility is part of the transition, so it only switches off once the
          closing animation has finished. */}
      <div
        id={contentId}
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        {...(!open && { inert: "" })}
        style={{ visibility: open ? "visible" : "hidden" }}
        className={`grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-in-out motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            data-testid={`${id}-cards`}
            className={`grid gap-3 md:gap-4 px-3 pb-3 md:px-4 md:pb-4 transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-y-0" : "-translate-y-2"} ${gridClassName}`}
          >
            {cards.map((card) => <StatCard key={card.label} {...card} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function StatsCards({
  netBalance,
  monthlyCommissions, monthlyCount, monthlyDeposits, monthlyWithdrawals,
  yearlyCommissions, yearlyCount, yearlyDeposits, yearlyWithdrawals,
  selectedDate,
}) {
  const { t, dir, locale } = useI18n();
  const periodCards =({ count, commissions, withdrawals, deposits, countLabel, commissionsLabel }) => [
    {
      label: countLabel,
      value: count || 0,
      icon: <Hash className="w-6 h-6 text-white" />,
      iconBg: "bg-purple-600",
    },
    {
      label: commissionsLabel,
      value: `$${fmt(commissions)}`,
      icon: <Percent className="w-6 h-6 text-white" />,
      iconBg: "bg-orange-500",
    },
    {
      label: t("summary.withdrawals"),
      value: `$${fmt(withdrawals)}`,
      icon: <ArrowUpCircle className="w-6 h-6 text-white" />,
      iconBg: "bg-red-500",
    },
    {
      label: t("summary.deposits"),
      value: `$${fmt(deposits)}`,
      icon: <ArrowDownCircle className="w-6 h-6 text-white" />,
      iconBg: "bg-green-500",
    },
  ];

  const monthlyCards = [
    {
      label: t("summary.netWallet"),
      value: `$${fmt(netBalance)}`,
      icon: <Wallet className="w-6 h-6 text-white" />,
      iconBg: "bg-blue-600",
    },
    ...periodCards({
      count: monthlyCount, commissions: monthlyCommissions, withdrawals: monthlyWithdrawals, deposits: monthlyDeposits,
      countLabel: t("summary.monthCount"), commissionsLabel: t("summary.monthCommissions"),
    }),
  ];

  const yearlyCards = periodCards({
    count: yearlyCount, commissions: yearlyCommissions, withdrawals: yearlyWithdrawals, deposits: yearlyDeposits,
    countLabel: t("summary.yearCount"), commissionsLabel: t("summary.yearCommissions"),
  });

  return (
    <div className="w-full space-y-2 md:space-y-3" dir={dir}>
      <SummarySection
        id="monthly-summary"
        title={t("summary.monthTitle")}
        period={formatMonthLabel(selectedDate, locale)}
        cards={monthlyCards}
        collapsedSummary={t("summary.monthCollapsed", { net: fmt(netBalance), count: monthlyCount || 0, commissions: fmt(monthlyCommissions) })}
        defaultOpen
        gridClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
      />
      <SummarySection
        id="yearly-summary"
        title={t("summary.yearTitle")}
        period={String(selectedDate || "").slice(0, 4)}
        cards={yearlyCards}
        collapsedSummary={t("summary.yearCollapsed", { count: yearlyCount || 0, commissions: fmt(yearlyCommissions) })}
        defaultOpen={false}
        gridClassName="grid-cols-2 lg:grid-cols-4"
      />
    </div>
  );
}

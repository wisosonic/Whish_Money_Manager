/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MonthlyChartModal, { CHART_SERIES, ChartLegend, ChartTooltip } from "@/components/dashboard/MonthlyChartModal";

// jsdom has no layout, so ResponsiveContainer would measure 0×0 and draw nothing. Replace it with a
// fixed-size stand-in that records the sizing props the component asked for.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children, width, height }) => (
      <div data-testid="responsive-container" data-width={String(width)} data-height={String(height)}>
        {cloneElement(children, { width: 800, height: typeof height === "number" ? height : 400 })}
      </div>
    ),
  };
});

const tx = (id, date, type, amount, commission = 0) => ({ id, transaction_date: date, type, amount, commission });
const transactions = [
  tx(1, "2026-06-06", "cash_in", 1000, 10),
  tx(2, "2026-06-07", "cash_out", 400),
  tx(3, "2026-09-23", "cash_in", 500, 5),
  tx(4, "2026-09-23", "cash_out", 1500),
  tx(5, "2025-12-31", "cash_in", 999, 9.99),
];

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

const setViewport = ({ width = 1024, reducedMotion = true } = {}) => {
  window.innerWidth = width;
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : width < 768,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
};

const renderChart = (props = {}) =>
  render(<MonthlyChartModal allTransactions={transactions} selectedDate="2026-09-23" onClose={vi.fn()} {...props} />);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 23, 12)); // 23 Sep 2026
  setViewport();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
  window.innerWidth = originalInnerWidth;
});

const chart = () => screen.getByTestId("monthly-chart");
const xTicks = () => [...chart().querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value")].map((t) => t.textContent);

describe("MonthlyChartModal — content", () => {
  it("defaults to the selected date's year and shows the year totals", () => {
    renderChart();
    expect(screen.getByText("الرسم البياني الشهري")).toBeInTheDocument();
    expect(screen.getByLabelText("السنة")).toHaveValue("2026");
    expect(screen.getByTestId("chart-total-profit")).toHaveTextContent("$15.00");
    expect(screen.getByTestId("chart-total-cashIn")).toHaveTextContent("$1,500.00");
    expect(screen.getByTestId("chart-total-cashOut")).toHaveTextContent("$1,900.00");
    expect(screen.getByTestId("chart-total-count")).toHaveTextContent("4");
  });

  it("puts the 12 months on the x-axis", () => {
    renderChart();
    expect(xTicks()).toEqual([
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
    ]);
  });

  it("has profit on a left axis and cash in/out on a right axis", () => {
    renderChart();
    const yAxes = chart().querySelectorAll(".recharts-yAxis");
    expect(yAxes).toHaveLength(2);
    // The profit axis (rendered first) sits on the left edge, the cash-flow axis on the right edge.
    const tickX = (axis) => Number(axis.querySelector(".recharts-cartesian-axis-tick-value").getAttribute("x"));
    expect(tickX(yAxes[0])).toBeLessThan(100);
    expect(tickX(yAxes[1])).toBeGreaterThan(700);
    // Axis captions
    expect(within(chart()).getByText("← الربح")).toBeInTheDocument();
    expect(within(chart()).getByText("الإيداعات / السحوبات →")).toBeInTheDocument();
    // Left axis is scaled to profit (max $10), right axis to cash flows (max $1,500).
    const tickTexts = (axis) => [...axis.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((t) => t.textContent);
    expect(tickTexts(yAxes[0]).at(-1)).toMatch(/^\$\d+(\.\d+)?$/);
    expect(tickTexts(yAxes[1]).at(-1)).toMatch(/k$/);
  });

  it("draws profit as bars and cash in / cash out as two lines (cash out dashed)", () => {
    renderChart();
    const bars = chart().querySelectorAll(".recharts-bar-rectangle path");
    expect(bars.length).toBeGreaterThanOrEqual(2); // June and September have profit
    bars.forEach((bar) => expect(bar).toHaveAttribute("fill", CHART_SERIES.profit.color));

    const curves = [...chart().querySelectorAll(".recharts-line-curve")];
    expect(curves).toHaveLength(2);
    expect(curves.map((c) => c.getAttribute("stroke"))).toEqual([CHART_SERIES.cashIn.color, CHART_SERIES.cashOut.color]);
    expect(curves[1]).toHaveAttribute("stroke-dasharray", "6 4");
    expect(curves[0].getAttribute("stroke-dasharray")).not.toBe("6 4");
  });

  it("shows a legend naming all three series", () => {
    renderChart();
    const legend = chart().querySelector(".recharts-legend-wrapper");
    expect(legend).toHaveTextContent(CHART_SERIES.profit.name);
    expect(legend).toHaveTextContent(CHART_SERIES.cashIn.name);
    expect(legend).toHaveTextContent(CHART_SERIES.cashOut.name);
  });

  it("switches year", () => {
    renderChart();
    fireEvent.change(screen.getByLabelText("السنة"), { target: { value: "2025" } });
    expect(screen.getByTestId("chart-total-cashIn")).toHaveTextContent("$999.00");
    expect(screen.getByTestId("chart-total-count")).toHaveTextContent("1");
  });

  it("shows a message for a year without transactions", () => {
    renderChart({ selectedDate: "2024-05-01" });
    expect(screen.getByText("لا توجد عمليات في سنة 2024")).toBeInTheDocument();
    expect(screen.queryByTestId("monthly-chart")).not.toBeInTheDocument();
  });

  it("offers a table view with every month, blanks for future months, and totals", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: /عرض كجدول/ }));
    const table = screen.getByTestId("chart-table");
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(12);
    expect(rows[5]).toHaveTextContent("يونيو$10.00$1,000.00$400.002");
    expect(rows[10]).toHaveTextContent("نوفمبر————");
    expect(table.querySelector("tfoot")).toHaveTextContent("المجموع$15.00$1,500.00$1,900.004");

    fireEvent.click(screen.getByRole("button", { name: /عرض كرسم بياني/ }));
    expect(screen.getByTestId("monthly-chart")).toBeInTheDocument();
  });

  it("closes", () => {
    const onClose = vi.fn();
    renderChart({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MonthlyChartModal — dynamic updates", () => {
  it("re-renders totals, table and chart when the transactions change", () => {
    const { rerender } = renderChart();
    expect(screen.getByTestId("chart-total-cashIn")).toHaveTextContent("$1,500.00");

    const updated = [...transactions, tx(6, "2026-07-10", "cash_in", 2000, 20)];
    rerender(<MonthlyChartModal allTransactions={updated} selectedDate="2026-09-23" onClose={vi.fn()} />);

    expect(screen.getByTestId("chart-total-cashIn")).toHaveTextContent("$3,500.00");
    expect(screen.getByTestId("chart-total-profit")).toHaveTextContent("$35.00");
    expect(chart().querySelectorAll(".recharts-bar-rectangle path").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole("button", { name: /عرض كجدول/ }));
    expect(screen.getByTestId("chart-table").querySelectorAll("tbody tr")[6]).toHaveTextContent("يوليو$20.00$2,000.00$0.001");
  });

  it("adds a newly seen year to the year selector", () => {
    const { rerender } = renderChart();
    expect([...screen.getByLabelText("السنة").options].map((o) => o.value)).toEqual(["2026", "2025"]);
    rerender(<MonthlyChartModal allTransactions={[...transactions, tx(7, "2024-03-01", "cash_in", 5)]} selectedDate="2026-09-23" onClose={vi.fn()} />);
    expect([...screen.getByLabelText("السنة").options].map((o) => o.value)).toEqual(["2026", "2025", "2024"]);
  });
});

describe("MonthlyChartModal — responsiveness", () => {
  it("fills the container width on every screen", () => {
    renderChart();
    expect(screen.getByTestId("responsive-container")).toHaveAttribute("data-width", "100%");
  });

  it("uses month names and a taller chart on desktop", () => {
    setViewport({ width: 1280 });
    renderChart();
    expect(chart()).toHaveAttribute("data-layout", "desktop");
    expect(screen.getByTestId("responsive-container")).toHaveAttribute("data-height", "400");
    expect(xTicks()[0]).toBe("يناير");
  });

  it("uses month numbers, short captions and a shorter chart on phones", () => {
    setViewport({ width: 400 });
    renderChart();
    expect(chart()).toHaveAttribute("data-layout", "mobile");
    expect(screen.getByTestId("responsive-container")).toHaveAttribute("data-height", "300");
    expect(xTicks()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(within(chart()).getByText("الربح")).toBeInTheDocument();
    expect(within(chart()).getByText("إيداع / سحب")).toBeInTheDocument();
  });

  it("skips animation when the user prefers reduced motion, animates otherwise", () => {
    setViewport({ reducedMotion: true });
    renderChart();
    // With animation off, bars are drawn at full height immediately.
    const heights = [...chart().querySelectorAll(".recharts-bar-rectangle path")].map((p) => p.getAttribute("d"));
    expect(heights.every((d) => d && !d.includes("NaN"))).toBe(true);
    cleanup();

    setViewport({ reducedMotion: false });
    renderChart();
    expect(chart().querySelectorAll(".recharts-line").length).toBe(2);
  });
});

describe("ChartTooltip", () => {
  const payload = [
    { dataKey: "profit", name: CHART_SERIES.profit.name, value: 15, color: CHART_SERIES.profit.color, payload: { label: "سبتمبر" } },
    { dataKey: "cashIn", name: CHART_SERIES.cashIn.name, value: 1500, color: CHART_SERIES.cashIn.color, payload: { label: "سبتمبر" } },
    { dataKey: "cashOut", name: CHART_SERIES.cashOut.name, value: 1900.5, color: CHART_SERIES.cashOut.color, payload: { label: "سبتمبر" } },
  ];

  it("lists every series for the hovered month, value first", () => {
    const { container } = render(<ChartTooltip active payload={payload} label={9} />);
    expect(screen.getByText("سبتمبر")).toBeInTheDocument();
    const rows = container.querySelectorAll(".flex.items-center");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent(`$1,900.50${CHART_SERIES.cashOut.name}`);
  });

  it("renders nothing when inactive or for an empty (future) month", () => {
    const { container, rerender } = render(<ChartTooltip active={false} payload={payload} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChartTooltip active payload={payload.map((p) => ({ ...p, value: null }))} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ChartLegend", () => {
  it("keys bars with a box and lines with a line (dashed for cash out), in text ink", () => {
    const { container } = render(
      <ChartLegend payload={Object.entries(CHART_SERIES).map(([dataKey, s]) => ({ dataKey, value: s.name, color: s.color }))} />
    );
    const keys = container.querySelectorAll("li > span:first-child");
    expect(keys[0]).toHaveClass("rounded-sm");
    expect(keys[1].style.borderTop).toContain("solid");
    expect(keys[2].style.borderTop).toContain("dashed");
    expect(container.querySelector("ul")).toHaveClass("text-gray-700");
  });
});


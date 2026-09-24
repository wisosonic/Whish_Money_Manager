/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import StatsCards from "@/components/dashboard/StatsCards";

const props = {
  netBalance: 10004.53,
  monthlyCount: 127,
  monthlyCommissions: 404.477,
  monthlyWithdrawals: 41091.65,
  monthlyDeposits: 40447.67,
  yearlyCount: 624,
  yearlyCommissions: 1234.5,
  yearlyWithdrawals: 150000,
  yearlyDeposits: 149000.25,
  selectedDate: "2026-09-23",
};

const renderCards = (overrides = {}) => render(<StatsCards {...props} {...overrides} />);
const section = (id) => screen.getByTestId(id);
const header = (id) => within(section(id)).getAllByRole("button")[0];
const panel = (id) => document.getElementById(`${id}-content`);
// A closed panel stays in the page (so it can animate) but is invisible and unreachable.
const expectClosed = (id) => {
  expect(panel(id)).toHaveAttribute("aria-hidden", "true");
  expect(panel(id)).toHaveAttribute("inert");
  expect(panel(id)).toHaveAttribute("data-state", "closed");
  expect(panel(id)).not.toBeVisible();
};
const expectOpen = (id) => {
  expect(panel(id)).toHaveAttribute("aria-hidden", "false");
  expect(panel(id)).not.toHaveAttribute("inert");
  expect(panel(id)).toHaveAttribute("data-state", "open");
  expect(panel(id)).toBeVisible();
};

afterEach(cleanup);

describe("StatsCards — monthly summary", () => {
  it("is expanded by default and shows the five monthly cards", () => {
    renderCards();
    const monthly = section("monthly-summary");
    expect(header("monthly-summary")).toHaveAttribute("aria-expanded", "true");
    expect(within(monthly).getByText("ملخص الشهر")).toBeInTheDocument();
    expect(within(monthly).getByText("سبتمبر 2026")).toBeInTheDocument();

    expect(within(monthly).getByText("صافي المحفظة")).toBeInTheDocument();
    expect(within(monthly).getByText("$10,004.53")).toBeInTheDocument();
    expect(within(monthly).getByText("عمليات الشهر")).toBeInTheDocument();
    expect(within(monthly).getByText("127")).toBeInTheDocument();
    expect(within(monthly).getByText("عمولات الشهر")).toBeInTheDocument();
    expect(within(monthly).getByText("$404.48")).toBeInTheDocument();
    expect(within(monthly).getByText("$41,091.65")).toBeInTheDocument();
    expect(within(monthly).getByText("$40,447.67")).toBeInTheDocument();
  });

  it("collapses to a one-line summary and expands again", () => {
    renderCards();
    const monthly = section("monthly-summary");
    fireEvent.click(header("monthly-summary"));

    expect(header("monthly-summary")).toHaveAttribute("aria-expanded", "false");
    expectClosed("monthly-summary");
    expect(within(monthly).getByText("صافي المحفظة $10,004.53 · 127 عملية · عمولات $404.48")).toBeInTheDocument();

    fireEvent.click(header("monthly-summary"));
    expect(header("monthly-summary")).toHaveAttribute("aria-expanded", "true");
    expectOpen("monthly-summary");
    expect(within(monthly).getByText("عمليات الشهر")).toBeVisible();
  });

  it("links the toggle to its content for screen readers", () => {
    renderCards();
    const button = header("monthly-summary");
    const content = document.getElementById(button.getAttribute("aria-controls"));
    expect(content).not.toBeNull();
    expect(section("monthly-summary")).toContainElement(content);
  });

  it("uses a responsive grid (2 → 3 → 5 columns)", () => {
    renderCards();
    expect(screen.getByTestId("monthly-summary-cards")).toHaveClass("grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-5");
  });

  it("shows zeros instead of blanks when there is no data", () => {
    renderCards({ netBalance: 0, monthlyCount: 0, monthlyCommissions: undefined, monthlyWithdrawals: undefined, monthlyDeposits: undefined });
    const monthly = section("monthly-summary");
    expect(within(monthly).getByText("0")).toBeInTheDocument();
    expect(within(monthly).getAllByText("$0.00")).toHaveLength(4);
  });
});

describe("StatsCards — yearly summary", () => {
  it("is collapsed by default, showing only the year and key figures", () => {
    renderCards();
    const yearly = section("yearly-summary");
    expect(header("yearly-summary")).toHaveAttribute("aria-expanded", "false");
    expect(within(yearly).getByText("ملخص السنة")).toBeInTheDocument();
    expect(within(yearly).getByText("2026")).toBeInTheDocument();
    expect(within(yearly).getByText("624 عملية · عمولات $1,234.50")).toBeInTheDocument();
    expectClosed("yearly-summary");
    expect(within(yearly).getByText("عمليات السنة")).not.toBeVisible();
  });

  it("expands to the four yearly cards, without duplicating the wallet card", () => {
    renderCards();
    const yearly = section("yearly-summary");
    fireEvent.click(header("yearly-summary"));

    expect(header("yearly-summary")).toHaveAttribute("aria-expanded", "true");
    expectOpen("yearly-summary");
    expect(within(yearly).getByText("عمليات السنة")).toBeVisible();
    expect(within(yearly).getByText("624")).toBeInTheDocument();
    expect(within(yearly).getByText("عمولات السنة")).toBeInTheDocument();
    expect(within(yearly).getByText("$1,234.50")).toBeInTheDocument();
    expect(within(yearly).getByText("$150,000.00")).toBeInTheDocument();
    expect(within(yearly).getByText("$149,000.25")).toBeInTheDocument();
    expect(within(yearly).queryByText("صافي المحفظة")).not.toBeInTheDocument();
    expect(screen.getByTestId("yearly-summary-cards")).toHaveClass("grid-cols-2", "lg:grid-cols-4");
  });

  it("toggles independently of the monthly summary", () => {
    renderCards();
    fireEvent.click(header("yearly-summary"));
    expect(header("monthly-summary")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header("monthly-summary"));
    expect(header("yearly-summary")).toHaveAttribute("aria-expanded", "true");
    expect(header("monthly-summary")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("StatsCards — expand/collapse animation", () => {
  it("animates the panel height (grid rows 0fr ↔ 1fr) and opacity instead of jumping", () => {
    renderCards();
    const monthly = panel("monthly-summary");
    expect(monthly).toHaveClass("grid", "transition-[grid-template-rows,opacity,visibility]", "duration-300", "ease-in-out");
    expect(monthly).toHaveClass("grid-rows-[1fr]", "opacity-100");

    fireEvent.click(header("monthly-summary"));
    expect(monthly).toHaveClass("grid-rows-[0fr]", "opacity-0");
    expect(monthly).not.toHaveClass("grid-rows-[1fr]");

    fireEvent.click(header("monthly-summary"));
    expect(monthly).toHaveClass("grid-rows-[1fr]", "opacity-100");
  });

  it("clips the content while it grows/shrinks, so nothing spills out mid-animation", () => {
    renderCards();
    const clip = panel("yearly-summary").firstElementChild;
    expect(clip).toHaveClass("overflow-hidden", "min-h-0");
  });

  it("slides the cards into place as they appear", () => {
    renderCards();
    const cards = screen.getByTestId("yearly-summary-cards");
    expect(cards).toHaveClass("transition-transform", "-translate-y-2");
    fireEvent.click(header("yearly-summary"));
    expect(cards).toHaveClass("translate-y-0");
    expect(cards).not.toHaveClass("-translate-y-2");
  });

  it("turns visibility off only after the closing animation (visibility is part of the transition)", () => {
    renderCards();
    fireEvent.click(header("monthly-summary"));
    expect(panel("monthly-summary").style.visibility).toBe("hidden");
    expect(panel("monthly-summary").className).toContain("visibility");
  });

  it("rotates the arrow in step with the panel", () => {
    renderCards();
    const arrow = header("yearly-summary").querySelector("svg");
    expect(arrow).toHaveClass("transition-transform", "duration-300");
    expect(arrow).not.toHaveClass("rotate-180");
    fireEvent.click(header("yearly-summary"));
    expect(arrow).toHaveClass("rotate-180");
  });

  it("fades the one-line summary in when a block collapses", () => {
    renderCards();
    expect(screen.getByTestId("yearly-summary-collapsed")).toHaveClass("animate-in", "fade-in", "duration-300");
    expect(screen.queryByTestId("monthly-summary-collapsed")).not.toBeInTheDocument();
    fireEvent.click(header("monthly-summary"));
    expect(screen.getByTestId("monthly-summary-collapsed")).toHaveClass("animate-in", "fade-in");
  });

  it("switches every animation off for users who prefer reduced motion", () => {
    renderCards();
    fireEvent.click(header("monthly-summary"));
    expect(panel("monthly-summary")).toHaveClass("motion-reduce:transition-none");
    expect(screen.getByTestId("monthly-summary-cards")).toHaveClass("motion-reduce:transition-none");
    expect(header("monthly-summary").querySelector("svg")).toHaveClass("motion-reduce:transition-none");
    expect(screen.getByTestId("monthly-summary-collapsed")).toHaveClass("motion-reduce:animate-none");
  });
});

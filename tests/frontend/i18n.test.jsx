/** @vitest-environment jsdom */
// Language toggle (Arabic default ↔ English): dictionaries, completeness, cookie persistence,
// page direction, and the main screens rendered in English.
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ar from "@/locales/ar";
import en from "@/locales/en";
import {
  DEFAULT_LANG, LANG_COOKIE, LanguageProvider, readLangCookie, translate, translateServerError, useI18n, writeLangCookie,
} from "@/lib/i18n";
import LanguageToggle from "@/components/layout/LanguageToggle";
import Header from "@/components/layout/Header";
import LoginPage from "@/components/auth/LoginPage";
import StatsCards from "@/components/dashboard/StatsCards";
import TransactionsList from "@/components/dashboard/TransactionsList";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({ api: { entities: { Transaction: { delete: vi.fn(), bulkDelete: vi.fn(), bulkUpdate: vi.fn() } } } }));

const root = path.resolve(__dirname, "../..");
const clearLangCookie = () => { document.cookie = `${LANG_COOKIE}=; Path=/; Max-Age=0`; };

beforeEach(() => {
  setAuthRole("admin");
  clearLangCookie();
  document.documentElement.lang = "";
  document.documentElement.dir = "";
});
afterEach(() => {
  cleanup();
  clearLangCookie();
});

// ─── Dictionaries ───────────────────────────────────────────────────────────

const placeholders = (value) => {
  const texts = typeof value === "object" ? Object.values(value) : [value];
  return [...new Set(texts.flatMap((text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
};

// Every source file with UI text, except the translations themselves.
const sourceFiles = () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["ui", "locales"].includes(entry.name)) walk(full);
    } else if (/\.jsx?$/.test(entry.name)) {
      files.push(full);
    }
  });
  walk(path.join(root, "src"));
  return files;
};

describe("dictionaries", () => {
  it("Arabic and English have exactly the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it("every entry uses the same {placeholders} in both languages", () => {
    Object.keys(ar).filter((k) => k !== "__serverErrors").forEach((key) => {
      expect([key, placeholders(en[key])]).toEqual([key, placeholders(ar[key])]);
    });
  });

  it("no entry is empty, and plural entries have 'one' and 'other'", () => {
    Object.entries({ ...ar, ...en }).filter(([k]) => k !== "__serverErrors").forEach(([key, value]) => {
      if (typeof value === "object") {
        expect([key, typeof value.one, typeof value.other]).toEqual([key, "string", "string"]);
      } else {
        expect([key, String(value).trim().length > 0]).toEqual([key, true]);
      }
    });
  });

  it("every key used in the code exists in both languages", () => {
    const used = new Set(["roles.admin", "roles.manager", "roles.user", "roles.admin.description", "roles.manager.description", "roles.user.description"]);
    for (let m = 1; m <= 12; m += 1) used.add(`months.${m}`);
    sourceFiles().forEach((file) => {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/\b(?:t|tr)\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g)) used.add(match[1]);
      for (const match of source.matchAll(/(?:labelKey|hintKey|nameKey):\s*"([\w.]+)"/g)) used.add(match[1]);
    });
    const missing = [...used].filter((key) => !(key in ar) || !(key in en));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(200);
  });

  it("no hardcoded Arabic is left in the interface code (everything goes through t())", () => {
    const offenders = [];
    // i18n.jsx is exempt: it holds each language's own name ("العربية"), which is never translated.
    sourceFiles().filter((file) => !file.endsWith("i18n.jsx")).forEach((file) => {
      const stripped = fs.readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")          // block and JSX comments
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")      // line comments
        .replace(/console\.\w+\([^)]*\);?/g, "");   // developer logs
      stripped.split("\n").forEach((line, i) => {
        if (/[؀-ۿ]/.test(line)) offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    });
    expect(offenders).toEqual([]);
  });

  it("no hardcoded right-to-left direction is left (it follows the language)", () => {
    const offenders = sourceFiles().filter((file) => /dir="rtl"/.test(fs.readFileSync(file, "utf8"))).map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});

// ─── translate() ────────────────────────────────────────────────────────────

describe("translate", () => {
  it("returns the text for the language, with placeholders filled", () => {
    expect(translate("ar", "header.logout")).toBe("خروج");
    expect(translate("en", "header.logout")).toBe("Log out");
    expect(translate("en", "reports.noResults", { query: "Ali" })).toBe('No results for "Ali"');
  });

  it("picks the English plural form from count (Arabic keeps one form)", () => {
    expect(translate("en", "list.count", { count: 1 })).toBe("1 transaction");
    expect(translate("en", "list.count", { count: 5 })).toBe("5 transactions");
    expect(translate("en", "list.count", { count: 0 })).toBe("0 transactions");
    expect(translate("ar", "list.count", { count: 5 })).toBe("5 عملية");
  });

  it("keeps a literal $ before a placeholder", () => {
    expect(translate("en", "summary.yearCollapsed", { count: 2, commissions: "3.70" })).toBe("2 transactions · commissions $3.70");
    expect(translate("ar", "summary.yearCollapsed", { count: 2, commissions: "3.70" })).toBe("2 عملية · عمولات $3.70");
  });

  it("falls back to Arabic, then to the key, and leaves unknown placeholders visible", () => {
    expect(translate("fr", "header.logout")).toBe("خروج");
    expect(translate("en", "no.such.key")).toBe("no.such.key");
    expect(translate("en", "reports.noResults")).toBe('No results for "{query}"');
  });

  it("translates the API's English messages in Arabic, passes them through in English", () => {
    expect(translateServerError("ar", "Invalid email or password")).toBe("البريد الإلكتروني أو كلمة المرور غير صحيحة");
    expect(translateServerError("en", "Invalid email or password")).toBe("Invalid email or password");
    expect(translateServerError("ar", "Something unexpected")).toBe("Something unexpected");
  });
});

// ─── Cookie + provider ──────────────────────────────────────────────────────

const Probe = () => {
  const { lang, dir, t } = useI18n();
  return <p data-testid="probe">{`${lang}|${dir}|${t("header.logout")}`}</p>;
};

describe("language preference (cookie)", () => {
  it("writes wmm_lang for a year, whole site, SameSite=Lax — and reads it back", () => {
    const setter = vi.spyOn(document, "cookie", "set");
    writeLangCookie("en");
    expect(setter).toHaveBeenCalledWith(expect.stringMatching(/^wmm_lang=en; Path=\/; Max-Age=31536000; SameSite=Lax$/));
    setter.mockRestore();
    writeLangCookie("en");
    expect(readLangCookie()).toBe("en");
  });

  it("ignores missing or unknown values", () => {
    expect(readLangCookie()).toBeNull();
    document.cookie = `${LANG_COOKIE}=fr; Path=/`;
    expect(readLangCookie()).toBeNull();
  });
});

describe("LanguageProvider", () => {
  it("is Arabic by default: right-to-left page, <html lang='ar' dir='rtl'>", () => {
    expect(DEFAULT_LANG).toBe("ar");
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("ar|rtl|خروج");
    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });

  it("starts in the language saved in the cookie", () => {
    writeLangCookie("en");
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("en|ltr|Log out");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
  });

  it("an invalid cookie falls back to Arabic", () => {
    document.cookie = `${LANG_COOKIE}=xx; Path=/`;
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("ar|rtl");
  });

  it("components without a provider (e.g. tests) get Arabic", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("ar|rtl|خروج");
  });
});

describe("LanguageToggle", () => {
  it("is an English on/off switch: off in Arabic, flips the whole page and saves the choice", () => {
    render(<LanguageProvider><LanguageToggle /><Probe /></LanguageProvider>);
    const toggle = screen.getByRole("switch", { name: "الإنجليزية" });
    expect(toggle).toBe(screen.getByTestId("language-toggle"));
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("title", "التبديل إلى الإنجليزية");
    expect(screen.getByTestId("language-toggle-knob")).toHaveClass("translate-x-0");

    fireEvent.click(toggle);
    expect(screen.getByTestId("probe")).toHaveTextContent("en|ltr|Log out");
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(readLangCookie()).toBe("en");
    expect(screen.getByRole("switch", { name: "English" })).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("title", "Switch to Arabic");
    expect(screen.getByTestId("language-toggle-knob")).toHaveClass("translate-x-[38px]");

    fireEvent.click(toggle);
    expect(screen.getByTestId("probe")).toHaveTextContent("ar|rtl|خروج");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(readLangCookie()).toBe("ar");
  });

  it("shows both languages on the track, highlights the active one, and never mirrors", () => {
    render(<LanguageProvider><LanguageToggle /></LanguageProvider>);
    const toggle = screen.getByTestId("language-toggle");
    // The track stays left-to-right in both languages, so the knob doesn't jump sides.
    expect(toggle).toHaveAttribute("dir", "ltr");
    const [ar, en] = toggle.querySelectorAll("span[lang]");
    expect(ar).toHaveTextContent("ع");
    expect(ar).toHaveAttribute("lang", "ar");
    expect(en).toHaveTextContent("EN");
    expect(en).toHaveAttribute("lang", "en");
    expect(ar).toHaveClass("text-slate-900");
    expect(en).toHaveClass("text-white/80");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("dir", "ltr");
    expect(ar).toHaveClass("text-white/80");
    expect(en).toHaveClass("text-slate-900");
    // Keyboard: it's a real button, so Space/Enter work natively; the knob respects reduced motion.
    expect(toggle.tagName).toBe("BUTTON");
    expect(screen.getByTestId("language-toggle-knob")).toHaveClass("motion-reduce:transition-none");
  });

  it("the choice survives a reload (new provider reads the cookie)", () => {
    const first = render(<LanguageProvider><LanguageToggle /></LanguageProvider>);
    fireEvent.click(screen.getByTestId("language-toggle"));
    first.unmount();
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("en|ltr");
  });
});

// ─── Screens in English ─────────────────────────────────────────────────────

const inEnglish = (ui) => render(<LanguageProvider initialLang="en"><MemoryRouter>{ui}</MemoryRouter></LanguageProvider>);

describe("screens in English", () => {
  it("header: labels, role, last login, clock order, left-to-right", () => {
    setAuthRole("manager", { previous_login: new Date(2026, 8, 23, 20, 5).toISOString() });
    inEnglish(<Header />);
    const header = screen.getByTestId("app-header");
    expect(header).toHaveAttribute("dir", "ltr");
    expect(header).toHaveClass("bg-gradient-to-r");
    expect(within(header).getByText("Log out")).toBeInTheDocument();
    expect(screen.getByTestId("role-badge")).toHaveTextContent("Manager");
    expect(screen.getByTestId("last-login")).toHaveTextContent("Last login: 2026/09/23 08:05 PM");
    expect(screen.getByText("Money transfers and financial transactions")).toBeInTheDocument();
    expect(screen.getByTestId("scroll-to-top")).toHaveAttribute("title", "Back to top");
    expect(within(header).getByText(/^\d{2}:\d{2}:\d{2} (AM|PM)$/)).toBeInTheDocument();
  });

  it("header in Arabic keeps its Arabic labels, and has no language switch (it's in Settings)", () => {
    setAuthRole("admin");
    render(<LanguageProvider><MemoryRouter><Header /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText("خروج")).toBeInTheDocument();
    expect(screen.getByTestId("role-badge")).toHaveTextContent("مسؤول");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByTestId("language-toggle")).not.toBeInTheDocument();
    // The way to change it is the Settings link.
    expect(screen.getByTestId("settings-link")).toHaveAttribute("href", "/settings");
  });

  it("login page has its own toggle (before sign-in) and English labels", () => {
    render(<LanguageProvider><MemoryRouter><LoginPage /></MemoryRouter></LanguageProvider>);
    fireEvent.click(screen.getByTestId("language-toggle"));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("summaries: English titles, month name and plural-aware collapsed line", () => {
    inEnglish(
      <StatsCards netBalance={100} monthlyCount={1} monthlyCommissions={2} monthlyWithdrawals={3} monthlyDeposits={4}
        yearlyCount={624} yearlyCommissions={1234.5} yearlyWithdrawals={5} yearlyDeposits={6} selectedDate="2026-09-23" />
    );
    expect(screen.getByText("Month summary")).toBeInTheDocument();
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByText("Transactions this month")).toBeInTheDocument();
    expect(screen.getByTestId("yearly-summary-collapsed")).toHaveTextContent("624 transactions · commissions $1,234.50");
    fireEvent.click(within(screen.getByTestId("monthly-summary")).getAllByRole("button")[0]);
    expect(screen.getByTestId("monthly-summary-collapsed")).toHaveTextContent("Wallet net $100.00 · 1 transaction · commissions $2.00");
  });

  it("transactions table: toolbar, columns, counts and bulk bar in English", () => {
    const rows = [
      { id: 1, type: "cash_in", amount: 50, commission: 0.5, sender_name: "ALI", receiver_name: "Vicario", reference_number: "tr:1", transaction_date: "2026-09-23", created_date: "2026-09-23T10:00:00Z", created_by: "admin@test.local" },
      { id: 2, type: "cash_out", amount: 20, commission: 0, sender_name: "Vicario", receiver_name: "SAM", reference_number: "tr:2", transaction_date: "2026-09-23", created_date: "2026-09-23T11:00:00Z", created_by: "admin@test.local" },
    ];
    const noop = vi.fn();
    const { container } = inEnglish(
      <TransactionsList transactions={rows} allTransactions={rows} loading={false} search="" setSearch={noop} selectedDate="2026-09-23"
        setSelectedDate={noop} onToday={noop} onCashIn={noop} onCashOut={noop} onImportPDF={noop} onRefresh={noop}
        onResetOpeningBalance={noop} onDeleteDailyBalanceForDate={noop} />
    );
    expect(screen.getByText("2 transactions")).toBeInTheDocument();
    ["Chart", "Sender report", "Receiver report", "Commission report", "Delete all", "Import PDF / CSV", "Today"].forEach((name) => {
      expect(screen.getByRole("button", { name: new RegExp(name.replace("/", "\\/")) })).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Search by name, amount, number or note...")).toBeInTheDocument();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent).filter(Boolean);
    expect(headers).toEqual(expect.arrayContaining(["Type", "Sender", "Receiver", "Amount", "Commission", "Reference", "Service", "Note", "Date"]));
    expect(container.querySelector("table")).toHaveClass("text-start");

    fireEvent.click(screen.getByLabelText("Select transaction 1"));
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("1 transaction selected");
    expect(screen.getByRole("region", { name: "Bulk actions" })).toBeInTheDocument();
  });

  it("switching language re-renders an open screen immediately", () => {
    const Switcher = () => {
      const { setLang } = useI18n();
      return <button onClick={() => setLang("en")}>to-en</button>;
    };
    render(<LanguageProvider><MemoryRouter><Switcher /><Header /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText("خروج")).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByText("to-en")));
    expect(screen.getByText("Log out")).toBeInTheDocument();
    expect(screen.queryByText("خروج")).not.toBeInTheDocument();
  });
});

describe("index.html", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  it("starts right-to-left Arabic, and applies an English cookie before the first paint", () => {
    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
    expect(html).toMatch(/wmm_lang=en/);
    expect(html).toMatch(/document\.documentElement\.dir = "ltr"/);
  });
});

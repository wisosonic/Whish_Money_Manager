import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { History, Users, LayoutDashboard, Settings, ShieldCheck, Store } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { APP_NAME } from "@/lib/branding";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/PreferencesContext";
import { PERMISSIONS } from "@/lib/permissions";
import AppLogo from "@/components/layout/AppLogo";
import UserMenu from "@/components/layout/UserMenu";

// "2026/09/23 08:05 PM" in the viewer's local time, matching the header clock's date format.
export const formatLastLogin = (iso, { hour24 = false } = {}) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const hours = d.getHours();
  const date = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return hour24
    ? `${date} ${pad(hours)}:${pad(d.getMinutes())}`
    : `${date} ${pad(hours % 12 || 12)}:${pad(d.getMinutes())} ${hours >= 12 ? "PM" : "AM"}`;
};

// Smooth scroll to the top — instant for users who prefer reduced motion.
export const scrollToTop = () => {
  const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
};

// Header layout (user's request, 2026-09-28): logo + clock | the pages (all of them, the current one
// marked) | Settings + the account menu. On narrow screens the pages wrap onto their own row.
const NAV_LINK = "flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2 transition text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";
// The current page: tinted, outlined and bold (not colour alone), plus aria-current="page".
const NAV_CURRENT = "bg-sky-500/30 ring-1 ring-inset ring-sky-300/70 font-semibold text-white";
const NAV_OTHER = "bg-white/10 hover:bg-white/20";

export default function Header() {
  const [time, setTime] = useState(new Date());
  const { user, logout, can } = useAuth();
  const { t, dir, lang, num } = useI18n();
  // Settings → General → Clock: 12-hour (default) or 24-hour; Settings → Appearance: show it or not.
  const { clock, showClock } = usePreferences().preferences;
  const hour24 = clock === "24h";
  const location = useLocation();
  const onPage = (path) => (path === "/" ? location.pathname === "/" : location.pathname.startsWith(path));
  const onSettingsPage = onPage("/settings");
  const onProfilePage = onPage("/profile");
  // Stores: the Admin manages them all; others see the store they work in (if any).
  const canManageStores = can(PERMISSIONS.STORES_MANAGE);
  // Every page the user may open, whatever page is showing (the current one is marked).
  const pages = [
    { to: "/", icon: LayoutDashboard, label: t("header.dashboard"), testId: "dashboard-link" },
    can(PERMISSIONS.TRANSACTIONS_IMPORT) && { to: "/imports", icon: History, label: t("header.imports"), testId: "imports-link" },
    can(PERMISSIONS.USERS_MANAGE) && { to: "/users", icon: Users, label: t("header.users"), testId: "users-link" },
    (canManageStores || user?.store_id != null) && { to: "/stores", icon: Store, label: canManageStores ? t("header.stores") : t("header.myStore"), testId: "stores-link" },
    can(PERMISSIONS.DATA_EXPORT) && { to: "/admin", icon: ShieldCheck, label: t("header.admin"), testId: "admin-link" },
  ].filter(Boolean);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Publish the header's current height as --app-header-height. index.css uses it as
  // scroll-padding-top, so elements scrolled into view (e.g. when tabbing to a field) stop below
  // the sticky header instead of behind it. The height changes when the header wraps on phones.
  const headerRef = useRef(null);
  useEffect(() => {
    const element = headerRef.current;
    if (!element) return undefined;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--app-header-height", `${element.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--app-header-height");
    };
  }, []);

  // Arabic keeps its original "AM 08 : 05 : 09" order; English reads "08:05:09 AM".
  const formatTime = (d) => {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    if (hour24) {
      h = String(h).padStart(2, "0");
      return num(lang === "ar" ? `${h} : ${m} : ${s}` : `${h}:${m}:${s}`);
    }
    const ampm = h >= 12 ? "PM" : "AM";
    h = String(h % 12 || 12).padStart(2, "0");
    return num(lang === "ar" ? `${ampm} ${h} : ${m} : ${s}` : `${h}:${m}:${s} ${ampm}`);
  };

  const formatDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return num(`${y}/${m}/${day}`);
  };

  // The sign-in before the current one (recorded by the server at login) — not the current time.
  // The date is kept left-to-right so it isn't reordered inside the Arabic label.
  const lastLogin = !user ? null : user.previous_login ?
  <>{t("header.lastLogin")}: <span dir="ltr">{num(formatLastLogin(user.previous_login, { hour24 }))}</span></> :
  t("header.firstLogin");

  return (
    // Sticky at the top while the page scrolls. z-40 keeps it above page content but below
    // modals (z-50). Its background is opaque, so content never shows through.
    <header
      ref={headerRef}
      data-testid="app-header"
      className={`sticky top-0 z-40 ${dir === "rtl" ? "bg-gradient-to-l" : "bg-gradient-to-r"} from-gray-900 to-slate-800 text-white px-4 md:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-3 shadow-2xl`}
      dir={dir}>
      {/* Start: logo + title (clicking it scrolls back to the top; the button sits inside the <h1>,
          since a heading isn't allowed inside a button), then the clock. */}
      {/* flex-1 below lg: the start takes the room left by the icons, so they stay on the first row
          (the clock wraps under the logo on phones instead). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0 flex-1 lg:flex-none" data-testid="header-start">
        <h1 className="min-w-0">
          <button
            type="button"
            onClick={scrollToTop}
            title={t("header.backToTop")}
            data-testid="scroll-to-top"
            className="flex items-center gap-3 text-start rounded-xl p-1 -m-1 cursor-pointer transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">
            <AppLogo className="w-11 h-11 md:w-12 md:h-12 shadow-md" />
            <span className="min-w-0 flex flex-col">
              <span className="text-xl md:text-2xl font-bold whitespace-nowrap" dir="ltr">{APP_NAME}</span>
              <span className="text-slate-300 text-sm font-normal">{t("app.tagline")}</span>
            </span>
          </button>
        </h1>
        {/* The clock (Settings → Appearance → Show the clock; its format under General). */}
        {showClock &&
        <div className="bg-white/10 rounded-xl px-3 py-1 text-center" title={t("header.clock")} data-testid="header-clock">
            <p className="text-sm font-mono font-bold leading-tight whitespace-nowrap">{formatTime(time)}</p>
            <p className="text-blue-100 text-[11px] font-bold leading-tight">{formatDate(time)}</p>
          </div>
        }
      </div>

      {/* The pages: all of them, always, the current one marked. Their own full-width row below lg,
          centred between the two ends from lg. */}
      <nav aria-label={t("header.nav")} data-testid="header-nav" className="order-last w-full lg:order-none lg:w-auto lg:flex-1 flex flex-wrap items-center lg:justify-center gap-2">
        {pages.map(({ to, icon: Icon, label, testId }) => {
          const current = onPage(to);
          return (
            <Link key={to} to={to} aria-current={current ? "page" : undefined} data-testid={testId}
              className={`${NAV_LINK} ${current ? NAV_CURRENT : NAV_OTHER}`}>
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* End: Settings, then the account menu (details, profile, Log out). No language switch here:
          signed-in users change it in Settings; the login page has one. */}
      <div className="flex items-center gap-2 ms-auto" data-testid="header-end">
        <Link to="/settings" title={t("header.settings")} aria-label={t("header.settings")} aria-current={onSettingsPage ? "page" : undefined}
          data-testid="settings-link"
          className={`flex items-center justify-center rounded-full w-10 h-10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${onSettingsPage ? NAV_CURRENT : NAV_OTHER}`}>
          <Settings className="w-5 h-5" aria-hidden="true" />
        </Link>
        <UserMenu user={user} lastLogin={lastLogin} onProfilePage={onProfilePage} onLogout={() => logout()} />
      </div>
    </header>);

}

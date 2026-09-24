import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { User, LogOut, Users, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { APP_NAME } from "@/lib/branding";
import { useI18n } from "@/lib/i18n";
import LanguageToggle from "@/components/layout/LanguageToggle";
import { PERMISSIONS } from "@/lib/permissions";
import AppLogo from "@/components/layout/AppLogo";

// "2026/09/23 08:05 PM" in the viewer's local time, matching the header clock's date format.
export const formatLastLogin = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const hours = d.getHours();
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(hours % 12 || 12)}:${pad(d.getMinutes())} ${hours >= 12 ? "PM" : "AM"}`;
};

// Smooth scroll to the top — instant for users who prefer reduced motion.
export const scrollToTop = () => {
  const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
};

const ROLE_BADGE = {
  admin: "bg-red-500/30 text-red-100",
  manager: "bg-amber-500/30 text-amber-100",
  user: "bg-sky-500/30 text-sky-100",
};

export default function Header() {
  const [time, setTime] = useState(new Date());
  const { user, logout, can } = useAuth();
  const { t, dir, lang } = useI18n();
  const location = useLocation();
  const onUsersPage = location.pathname.startsWith("/users");

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
    const ampm = h >= 12 ? "PM" : "AM";
    h = String(h % 12 || 12).padStart(2, "0");
    return lang === "ar" ? `${ampm} ${h} : ${m} : ${s}` : `${h}:${m}:${s} ${ampm}`;
  };

  const formatDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  };

  // The sign-in before the current one (recorded by the server at login) — not the current time.
  // The date is kept left-to-right so it isn't reordered inside the Arabic label.
  const lastLogin = !user ? null : user.previous_login ?
  <>{t("header.lastLogin")}: <span dir="ltr">{formatLastLogin(user.previous_login)}</span></> :
  t("header.firstLogin");

  return (
    // Sticky at the top while the page scrolls. z-40 keeps it above page content but below
    // modals (z-50). Its background is opaque, so content never shows through.
    <header
      ref={headerRef}
      data-testid="app-header"
      className={`sticky top-0 z-40 ${dir === "rtl" ? "bg-gradient-to-l" : "bg-gradient-to-r"} from-gray-900 to-slate-800 text-white px-4 md:px-6 py-3 md:py-4 flex flex-wrap items-center justify-between gap-3 shadow-2xl`}
      dir={dir}>
      {/* Right: Logo + title — clicking it scrolls back to the top of the page. The button sits
          inside the <h1> (a heading isn't allowed inside a button), so it stays the page heading. */}
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

      {/* Center: User */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl px-4 py-2 hover:bg-white/15 transition">
          <div className="text-start">
            <p className="font-semibold text-sm flex items-center gap-2">
              {user?.full_name || user?.email || t("header.userFallback")}
              {user?.role_label &&
              <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${ROLE_BADGE[user.role] || "bg-white/20"}`} data-testid="role-badge">
                  {t(`roles.${user.role}`)}
                </span>
              }
            </p>
            <p className="text-slate-300 text-xs font-bold" data-testid="last-login">
              {lastLogin}
            </p>
          </div>
          <div className="bg-slate-600 rounded-full p-2">
            <User className="w-5 h-5" />
          </div>
        </div>
        {can(PERMISSIONS.USERS_MANAGE) && (
          onUsersPage ?
          <Link to="/" className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-2xl px-4 py-2 transition text-sm font-medium">
              <LayoutDashboard className="w-4 h-4" />
              <span>{t("header.dashboard")}</span>
            </Link> :
          <Link to="/users" className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-2xl px-4 py-2 transition text-sm font-medium">
              <Users className="w-4 h-4" />
              <span>{t("header.users")}</span>
            </Link>)
        }
        <button
          onClick={() => logout()}
          className="flex items-center gap-2 bg-red-500/30 hover:bg-red-500/50 backdrop-blur-sm rounded-2xl px-4 py-2 transition text-sm font-medium"
          title={t("header.logoutTitle")}>
          
          <LogOut className="w-4 h-4" />
          <span>{t("header.logout")}</span>
        </button>
        <LanguageToggle />
      </div>

      {/* Left: Clock */}
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl px-4 py-2 text-center min-w-[140px]">
        <p className="text-xl font-mono font-bold">{formatTime(time)}</p>
        <p className="text-blue-100 text-xs font-bold">{formatDate(time)}</p>
      </div>
    </header>);

}
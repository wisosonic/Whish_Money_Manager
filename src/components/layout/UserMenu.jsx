import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, User, UserCog } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// The header's account menu (user's request, 2026-09-28): an icon button at the end of the bar that
// opens the signed-in user's details (name, email, role, store, last login), a link to their profile
// and Log out.
//
// A small hand-written menu button (WAI-ARIA "menu button" pattern) rather than Radix's dropdown:
// the header is in the main bundle, and Radix's positioning library would add ~70 kB to it. Keys:
// Enter / Space / ↓ open on the first item, ↑ on the last; in the menu ↑ ↓ Home End move, Escape
// closes back to the button, Tab closes. A click outside closes it.

const ROLE_BADGE = {
  admin: "bg-red-500/30 text-red-100",
  manager: "bg-amber-500/30 text-amber-100",
  user: "bg-sky-500/30 text-sky-100",
};

export default function UserMenu({ user, lastLogin, onProfilePage, onLogout }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [focusOnOpen, setFocusOnOpen] = useState("first");
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const name = user?.full_name || user?.email || t("header.userFallback");

  const items = () => [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
  const openMenu = (where = "first") => { setFocusOnOpen(where); setOpen(true); };
  const close = ({ focusButton = false } = {}) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  // Opening moves focus into the menu (first or last item).
  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOnOpen === "last" ? list[list.length - 1] : list[0])?.focus();
  }, [open, focusOnOpen]);

  // A click (or tap) anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const onButtonKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); openMenu("first"); }
    if (e.key === "ArrowUp") { e.preventDefault(); openMenu("last"); }
  };
  const onMenuKey = (e) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    const move = (to) => { e.preventDefault(); list[(to + list.length) % list.length]?.focus(); };
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); close({ focusButton: true }); }
    else if (e.key === "Tab") close();
  };

  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-start transition hover:bg-white/10 focus:outline-none focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400";

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openMenu("first"))}
        onKeyDown={onButtonKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("header.userMenu", { name })}
        title={name}
        data-testid="user-menu-button"
        className={`flex items-center justify-center rounded-full w-10 h-10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
          onProfilePage || open ? "bg-sky-500/30 ring-1 ring-inset ring-sky-300/70" : "bg-white/10 hover:bg-white/20"}`}>
        <User className="w-5 h-5" aria-hidden="true" />
      </button>

      {open &&
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={t("header.userMenu", { name })}
        onKeyDown={onMenuKey}
        data-testid="user-menu"
        className="absolute end-0 top-full mt-2 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-slate-800 text-white shadow-2xl ring-1 ring-white/10 p-2">
          {/* Who is signed in (not a menu item: nothing to choose here). */}
          <div className="px-3 py-2 border-b border-white/10 mb-1" data-testid="user-menu-identity">
            <p className="font-semibold text-sm break-words">{name}</p>
            {user?.full_name && user?.email && <p className="text-slate-300 text-xs break-all rtl:text-end" dir="ltr">{user.email}</p>}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {user?.role_label &&
              <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${ROLE_BADGE[user.role] || "bg-white/20"}`} data-testid="role-badge">
                  {t(`roles.${user.role}`)}
                </span>
              }
              {user?.store_name &&
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-white/15 text-slate-100" data-testid="store-badge" title={t("stores.column")}>
                  {user.store_name}
                </span>
              }
            </div>
            <p className="text-slate-300 text-xs font-bold mt-1.5" data-testid="last-login">{lastLogin}</p>
          </div>
          <Link
            to="/profile"
            role="menuitem"
            tabIndex={-1}
            onClick={() => close()}
            aria-current={onProfilePage ? "page" : undefined}
            data-testid="profile-link"
            className={item}>
            <UserCog className="w-4 h-4" aria-hidden="true" />
            {t("header.profile")}
          </Link>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => { close(); onLogout(); }}
            title={t("header.logoutTitle")}
            data-testid="logout-button"
            className={`${item} text-red-200 hover:bg-red-500/30 focus-visible:bg-red-500/30`}>
            <LogOut className="w-4 h-4" aria-hidden="true" />
            {t("header.logout")}
          </button>
        </div>
      }
    </div>
  );
}

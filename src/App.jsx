import { BrowserRouter as Router, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { SERVER_ERROR_EVENT } from '@/api/apiClient';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AppErrorBoundary from "@/components/layout/AppErrorBoundary";
import Dashboard from "./pages/Dashboard";
import NotFoundPage from "./pages/NotFoundPage";
import ServerErrorPage from "./pages/ServerErrorPage";
import LoginPage from "@/components/auth/LoginPage";
import { PERMISSIONS } from "@/lib/permissions";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import AppToaster from "@/components/layout/AppToaster";

// The dashboard is what everyone opens, so it's in the main download. The other pages are fetched
// the first time they're opened, which keeps the first load small (the admin panel's reports also
// pull in Recharts).
const UsersPage = lazy(() => import("./pages/UsersPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const StoresPage = lazy(() => import("./pages/StoresPage"));
const ImportHistoryPage = lazy(() => import("./pages/ImportHistoryPage"));

// Route guard for pages that need a permission (the API enforces the same rule).
export const RequirePermission = ({ permission, children }) => {
  const { can } = useAuth();
  const { t, dir } = useI18n();
  if (can(permission)) return children;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6" dir={dir}>
      <div className="bg-white rounded-2xl shadow p-8 text-center max-w-sm">
        <h1 className="text-xl font-bold text-gray-800 mb-2">{t("guard.title")}</h1>
        <p className="text-gray-500 text-sm mb-4">{t("guard.message")}</p>
        <a href="/" className="text-blue-600 hover:underline text-sm">{t("guard.back")}</a>
      </div>
    </div>
  );
};

// Full-page spinner: while the session is checked, and while a page's code downloads.
const PageSpinner = () => (
  <div className="fixed inset-0 flex items-center justify-center" role="status" data-testid="page-loading">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

// Any server error (a 5xx answer, or no answer at all) opens the 500 page (user's request,
// 2026-09-29), remembering the page it came from so "Try again" can go back to it.
export const ServerErrorRedirect = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const current = `${location.pathname}${location.search}${location.hash}`;
  useEffect(() => {
    const onServerError = (event) => {
      if (window.location.pathname === "/500") return;
      navigate("/500", { state: { from: current, reason: event.detail?.status === 0 ? "unreachable" : "server" } });
    };
    window.addEventListener(SERVER_ERROR_EVENT, onServerError);
    return () => window.removeEventListener(SERVER_ERROR_EVENT, onServerError);
  }, [navigate, current]);
  return null;
};

export const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  const { pathname } = useLocation();

  // The 500 page shows signed in or not: the session check itself may be what failed.
  if (pathname === "/500") return <ServerErrorPage />;

  if (isLoadingAuth) {
    return <PageSpinner />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Render the main app. A screen that crashes shows the 500 page instead of a blank page.
  return (
    <AppErrorBoundary resetKey={pathname}>
    <Suspense fallback={<PageSpinner />}>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route
        path="/users"
        element={<RequirePermission permission={PERMISSIONS.USERS_MANAGE}><UsersPage /></RequirePermission>} />
      <Route
        path="/admin"
        element={<RequirePermission permission={PERMISSIONS.DATA_EXPORT}><AdminPage /></RequirePermission>} />
      {/* Everyone who imports statements; what each sees is decided by the server. */}
      <Route
        path="/imports"
        element={<RequirePermission permission={PERMISSIONS.TRANSACTIONS_IMPORT}><ImportHistoryPage /></RequirePermission>} />
      {/* Every signed-in user has their own settings. */}
      <Route path="/settings" element={<SettingsPage />} />
      {/* …and their own profile (name, email, password). */}
      <Route path="/profile" element={<ProfilePage />} />
      {/* Stores: the Admin manages them all; everyone else sees their own store. */}
      <Route path="/stores" element={<StoresPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
    </AppErrorBoundary>
  );
};


function App() {

  return (
    <LanguageProvider>
      <AuthProvider>
        <PreferencesProvider>
          <Router>
            <ServerErrorRedirect />
            <AuthenticatedApp />
          </Router>
          <AppToaster />
        </PreferencesProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Dashboard from "./pages/Dashboard";
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

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <PageSpinner />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
  }

  // Render the main app
  return (
    <Suspense fallback={<PageSpinner />}>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route
        path="/users"
        element={<RequirePermission permission={PERMISSIONS.USERS_MANAGE}><UsersPage /></RequirePermission>} />
      <Route
        path="/admin"
        element={<RequirePermission permission={PERMISSIONS.DATA_EXPORT}><AdminPage /></RequirePermission>} />
      {/* Every signed-in user has their own settings. */}
      <Route path="/settings" element={<SettingsPage />} />
      {/* …and their own profile (name, email, password). */}
      <Route path="/profile" element={<ProfilePage />} />
      {/* Stores: the Admin manages them all; everyone else sees their own store. */}
      <Route path="/stores" element={<StoresPage />} />
      {/* Add your page Route elements here */}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};


function App() {

  return (
    <LanguageProvider>
      <AuthProvider>
        <PreferencesProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <AuthenticatedApp />
            </Router>
            <AppToaster />
          </QueryClientProvider>
        </PreferencesProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App
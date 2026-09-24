import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
// Add page imports here
import Dashboard from "./pages/Dashboard";
import UsersPage from "./pages/UsersPage";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "@/components/auth/LoginPage";
import { PERMISSIONS } from "@/lib/permissions";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";

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

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
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
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route
        path="/users"
        element={<RequirePermission permission={PERMISSIONS.USERS_MANAGE}><UsersPage /></RequirePermission>} />
      {/* Every signed-in user has their own settings. */}
      <Route path="/settings" element={<SettingsPage />} />
      {/* Add your page Route elements here */}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
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
            <Toaster />
          </QueryClientProvider>
        </PreferencesProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App
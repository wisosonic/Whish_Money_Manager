import { Home, RotateCcw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import ErrorPage, { errorPageButton } from "@/components/layout/ErrorPage";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";

// 500 (user's request, 2026-09-29): shown at /500 whenever the server answers a request with an
// error (any 5xx) or can't be reached, and when a screen crashes (AppErrorBoundary). "Try again"
// goes back to the page that failed, which loads its data again.
//   reason: "server" (a 5xx), "unreachable" (no answer), "crash" (the page itself failed)
export default function ServerErrorPage({ reason: reasonProp, onRetry }) {
  const { t } = useI18n();
  const { isAuthenticated, checkUserAuth } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const reason = reasonProp ?? state?.reason ?? "server";
  const from = state?.from && state.from !== "/500" ? state.from : "/";

  const retry = () => {
    if (onRetry) { onRetry(); return; }
    // If the session check failed too, ask again (else the login page would show for a signed-in user).
    if (!isAuthenticated) checkUserAuth?.();
    navigate(from, { replace: true });
  };

  return (
    <ErrorPage code="500" title={t("serverError.title")} message={t(`serverError.${reason}`)} testId="server-error-page">
      <button type="button" onClick={retry} className={errorPageButton} data-testid="server-error-retry">
        <RotateCcw className="w-4 h-4 me-2" aria-hidden="true" />
        {t("serverError.retry")}
      </button>
      <button type="button" onClick={() => { if (onRetry) onRetry(); navigate("/", { replace: true }); }} className={errorPageButton} data-testid="server-error-home">
        <Home className="w-4 h-4 me-2" aria-hidden="true" />
        {t("serverError.home")}
      </button>
    </ErrorPage>
  );
}

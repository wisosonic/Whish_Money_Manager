import { Link, useLocation } from "react-router-dom";
import { Home } from "lucide-react";
import ErrorPage, { errorPageButton } from "@/components/layout/ErrorPage";
import { useI18n } from "@/lib/i18n";

// 404: an address that isn't a page of the app (the route "*").
export default function NotFoundPage() {
  const { t } = useI18n();
  const page = useLocation().pathname.slice(1);
  return (
    <ErrorPage code="404" title={t("notFound.title")} message={t("notFound.message", { page })} testId="not-found-page">
      <Link to="/" className={errorPageButton}>
        <Home className="w-4 h-4 me-2" aria-hidden="true" />
        {t("notFound.home")}
      </Link>
    </ErrorPage>
  );
}

import { useI18n } from "@/lib/i18n";

// The layout shared by the 404 and 500 pages: the code, a title, what happened, and what to do.
export default function ErrorPage({ code, title, message, children, testId }) {
  const { dir } = useI18n();
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-100" dir={dir} data-testid={testId}>
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <p className="text-7xl font-light text-slate-300" dir="ltr" aria-hidden="true">{code}</p>
          <div className="h-0.5 w-16 bg-slate-200 mx-auto"></div>
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-medium text-slate-800">{title}</h1>
          <p className="text-slate-600 leading-relaxed">{message}</p>
        </div>
        <div className="pt-4 flex flex-wrap items-center justify-center gap-3">{children}</div>
      </div>
    </main>
  );
}

export const errorPageButton = "inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500";

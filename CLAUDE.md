# CLAUDE.md

Guidance for Claude (and other AI assistants) working on **Whish Money Manager** (formerly HawalaFlow), plus a log of changes made with Claude. User-facing docs are in [README.md](README.md).

## Commands

```bash
npm run dev          # web (Vite :5173) + API (Express :3001) together
npm test             # Vitest, once
npm run verify       # lint + tests + build — must pass before finishing any change
npm run seed         # default roles + first Admin (+ reassign pre-accounts data to that Admin)
npx vitest run tests/backend/csvEngine.test.js   # a single file
```

## Architecture in one minute

- **Backend** (`server/`):
  - `index.js`: API routes, each with its permission check, plus the PDF and CSV engines and the import and bulk endpoints. It exports `app` and the parsers for tests, and only calls `listen()` when run directly.
  - `db.js`: the SQLite connection and schema: `transactions`, `daily_balances`, `roles`, `users`, `sessions`.
  - `auth.js`: login and logout, the session cookie, the `authenticate` and `requirePermission` middleware, and the Admin user-management routes.
  - `permissions.js`: permission names and the default roles.
  - `seed.js`: `npm run seed`.
- `src/api/base44Client.js`: the app's API client. The name comes from the Base44 platform the project started on; **Base44 is no longer used at all** (removed 2026-09-24). Components call `base44.entities.Transaction.*`, `base44.integrations.Core.ExtractPdf/ExtractCsv`, `base44.auth.*` and `base44.users/roles.*`.
  - The only credential is the HTTP-only session cookie; there are **no identity headers and no user in localStorage**.
  - A 401 on a non-auth call fires `SESSION_ENDED_EVENT`.
- `src/lib/AuthContext.jsx`: session state, loaded from `/auth/me` on start. Exposes `can(permission)` and `canEditTransaction(t)`.
- `src/lib/permissions.js` **re-exports `server/permissions.js`**, so the UI and the API share one definition. Never duplicate the rules.
- `src/components/transactions/ImportPDFModal.jsx`: the single import screen for both engines. Steps: upload → (duplicates) → preview → saving → done.
- `src/pages/Dashboard.jsx`: all totals and balances are calculated in the browser. Search logic is in `src/lib/transactionSearch.js`.

## Business rules (confirmed by the user — don't change without asking)

- Debit → `cash_out`, credit → `cash_in`.
- **CSV commission**: 1% on every credit (rounded to 3 decimals), 0 on debits, no exceptions.
- **PDF commission** still has its original exceptions (description contains "cashin" or "qr topup", or service contains "reversed" → 0%). The user hasn't asked to align it with the CSV rule; ask before changing it.
- `NAME - 96171588017` descriptions are split in **both** engines (`splitNamePhone`): the name goes to sender/receiver, `phone` gets the number as printed, and `customer_number` gets it without the `961` / `+961` prefix.
- Duplicates are matched by `reference_number` **across the whole office** (everyone shares one set of transactions). On re-import the user chooses **overwrite** (delete same-reference rows, then insert, in one database transaction) or **cancel**. Rows without a reference are never matched or deleted.
- Manual insertion between table rows ("+ إدراج هنا") was removed at the user's request. Cash In / Cash Out buttons stay. `InsertTransactionModal.jsx` still exists but nothing uses it.
- Search covers only the selected day (intentional: the table is a daily journal).
- **Receiver report** ("تقرير مستلم", `ReceiverReportModal.jsx`) searches all days. It matches `receiver_name`, and matches `phone` / `customer_number` only when `receiver_name` is empty or a phone number (`matchesReceiver` in `src/lib/transactionSearch.js`). This is because `phone` / `customer_number` belong to the other party: on a cash-in from "NAME - 961…" they're the sender's. The receiver is displayed with `receiverDisplay`, following the same rule as the table's receiver column.
- **Summaries** (`StatsCards.jsx`):
  - "ملخص الشهر" is expanded by default and "ملخص السنة" is collapsed by default. The user specified these defaults.
  - Open/closed state is deliberately not saved across page loads, so the defaults always apply.
  - Month and year come from the **selected date**, not today. The figures are calculated in `Dashboard.jsx` with the same filter as the monthly figures.
  - "صافي المحفظة" (net wallet) is a global figure, so it appears only in the monthly block and isn't repeated in the yearly one.
  - **Expand/collapse animation** (user's request): the panel content **stays mounted**, so it can animate.
    - The wrapper animates `grid-template-rows` from `0fr` to `1fr`, plus `opacity`, over 0.3s. The inner `min-h-0 overflow-hidden` div clips the content, so there's no fixed max-height.
    - The cards slide from `-translate-y-2`, and the chevron rotates.
    - The collapsed one-line summary uses `animate-in fade-in` from tailwindcss-animate.
    - Closed means `aria-hidden`, `inert` and inline `visibility: hidden`. `visibility` is in the transition list, so it switches off only after the close finishes.
    - Every part has `motion-reduce:` overrides.
    - Tests assert hidden or visible state, not presence. Don't go back to conditional rendering, which would kill the animation.
    - Headless screenshots can't capture mid-transition. Check computed `transition*` styles instead.
- **Monthly chart** ("الرسم البياني", `MonthlyChartModal.jsx`, data in `src/lib/monthlyChartData.js`):
  - The user specified the layout: x = months, **left y-axis = profit** (commissions, blue bars), **right y-axis = cash in + cash out** (lines).
  - Two y-axes normally go against charting best practice. It was kept on purpose because the user asked for it, and it's softened by different marks (bars vs lines), captions on each axis, a tooltip, and the table view. Don't "fix" it into a single axis without asking.
  - Colors: `#1d4ed8` / `#16a34a` / `#991b1b`. They were checked with the dataviz palette validator: every pair is distinguishable for color-blind readers (ΔE ≥ 17), with at least 3:1 contrast on white. Cash out is also dashed.
  - **Don't use lighter or orange hues:** red vs green or orange failed that check.
  - Future months of the current year are `null`, so they show as gaps rather than $0. Lines are `linear`, not smoothed.
  - Axis captions are horizontal and anchored to the axis edge; rotated Arabic was unreadable. The legend sits below the plot so it doesn't collide with the captions on phones.
  - Animation is off when the user has `prefers-reduced-motion` turned on.
  - **Screenshotting it headless:** use `--force-prefers-reduced-motion`. Otherwise the capture shows the first frame of the animation (no bars or lines). Headless Chrome/Edge also lays out at least ~492px wide, so a 400px screenshot looks cropped even though the chart fits.
- **Bulk actions** (`TransactionsList.jsx` selection + `BulkEditModal.jsx`; server `POST /transactions/bulk-update` and `/bulk-delete`):
  - **Selection** is a `Set` of ids, limited to the currently visible rows. A `useEffect` on `transactions` drops ids that disappear through a day change or search, so bulk actions never hit hidden rows.
  - **Bulk edit is opt-in per field** (a "تغيير" checkbox). Only ticked fields are sent, and ticked + empty clears the field.
    - Allowed fields are defined in `BULK_EDITABLE_FIELDS` on the server, plus `commission_rate`, which is applied per row in SQL: `commission = ROUND(amount * rate / 100, 3)`.
    - Amount, reference and phone are deliberately not bulk-editable.
  - **Both endpoints** act in one statement over office-wide rows. They validate `type`, the date format and the rate.
    - Bulk update needs `transactions:update:any`, or `:own` with **every** selected row owned. Otherwise it returns 403 listing `not_own`, and nothing changes.
    - Bulk delete needs `transactions:delete`.
  - **After a bulk delete or a date move**, `onDeleteDailyBalanceForDate` runs once per affected day, removing opening balances for days left empty. For a date move it skips the destination day.
- **Undo ("تراجع") and Refresh ("تحديث") removed** at the user's request:
  - Single-row delete used to hide the row and really delete it 60 minutes later, only so Undo could cancel it. If the page was reloaded within that hour, the delete never happened and the row came back.
  - Delete is now immediate after "تأكيد", then the table reloads.
  - The `hiddenIds` / `onHiddenIdsChange` plumbing was removed from `TransactionsList` and `Dashboard`.
- The **"مراجعة الكشف"** (statement review) button was removed at the user's request. `ReviewPDFModal.jsx` still exists but nothing uses it.
- **Accounts, roles and permissions** (user's decisions, 2026-09-24):
  - **Visibility:** everyone sees **all** office transactions and balances. Reads are never filtered by user.
  - **User:** read, create, import, and edit **own** transactions (`created_by === email`). No delete of any kind, no import overwrite (it deletes), no opening balances, no user management.
  - **Manager:** everything except `users:manage`.
  - **Admin:** everything. The matrix is in `server/permissions.js` `DEFAULT_ROLES`.
  - **Sessions never expire; only logout ends them.** The JWT has **no `exp`** and carries a session id (`sid`), and every request checks that the `sessions` row exists and the user is active. That's what makes logout, deactivation and password reset take effect instantly. **Don't make the tokens stateless.**
  - **The cookie:** `wmm_session`, with `httpOnly`, `sameSite: "strict"` and `secure` in production. It uses a 400-day Max-Age because of the browser cap, re-issued at most daily by `authenticate`.
  - **Permissions are read from the DB on every request**, so role changes apply immediately.
  - **created_by** is always `req.user.email`. It's not in any `mutableFields`, so clients can't set it.
  - **Sticky header** (user's request): `Header.jsx` renders a `<header>` with `sticky top-0 z-40`.
    - **Layering:** z-40 stays below the z-50 modal overlays. Keep new modals at z-50 or higher.
    - **Clipping:** no ancestor of the header may get `overflow: hidden/auto`, or sticky stops working.
    - **Scroll padding:** the header publishes its live height as `--app-header-height` on `<html>` (a ResizeObserver, since it wraps taller on phones). `index.css` uses it for `scroll-padding-top`, so focus and anchor scrolls land below the header.
    - **Checked in Edge:** the header stays at top 0 after scrolling, and an anchored row lands 8px below it on both desktop (92px header) and phone (144px).
    - **Screenshot quirk:** headless Edge screenshots of a *scrolled page* come out blank. To show scrolled layouts, scroll an inner container instead, and measure page scrolling via `--dump-dom`.
  - **Logo + name = back to top** (user's request): they're one `<button>` placed **inside** the `<h1>`, because a heading isn't allowed inside a button. It calls `scrollToTop()` (exported from `Header.jsx`): `window.scrollTo({ top: 0, behavior: "smooth" })`, or `"auto"` under `prefers-reduced-motion`. It never navigates.
    - Headless Edge doesn't run smooth scrolling under `--virtual-time-budget` (even the browser's own plain version stays put). Verify with `--force-prefers-reduced-motion`, which scrolled from 2500 to 0.
  - **Last login in the header** ("آخر دخول"): shows `user.previous_login`, the sign-in *before* the current one, formatted by `formatLastLogin` in `Header.jsx` as local `yyyy/MM/dd hh:mm AM/PM`.
    - At login the server runs `previous_login = last_login, last_login = now`, so `last_login` is the current sign-in. The Users page shows that one.
    - `null` means first sign-in ("أول تسجيل دخول").
    - The header used to build this from `new Date()`, the current time, with a hardcoded "AM". Don't go back to deriving it on the client.
    - Schema: `initializeDb()` adds the `previous_login` column to older databases (`PRAGMA table_info` check). Use the same pattern for future columns.
  - **Automatic seeding on startup** (user's request): when `node server/index.js` starts and the `users` table is empty, `ensureInitialAdmin()` in `seed.js` seeds the roles and an Admin, and prints the email plus a one-time generated password.
    - It uses `SEED_ADMIN_*` when set, in which case no password is printed.
    - It runs only when the server is run directly, never in tests (they import `app`). Once any user exists it never seeds again.
    - `tests/backend/startup.test.js` spawns the real server twice to check this.
  - **Existing data:** rows from before accounts existed have `created_by = 'local@hawalaflow.app'` (`LEGACY_OWNER_EMAIL`), and the seed reassigns them to the first Admin.
  - **Opening balances** are one per date office-wide: `POST /daily-balances/create` on an existing date updates it.
  - **Safety rules:** there's always at least one active Admin, and an Admin can't deactivate themselves. Deactivation and password reset delete the user's sessions.
  - **No CORS:** the app is same-origin via the Vite proxy. Writes must be JSON (a 415 otherwise), which, together with SameSite=Strict, blocks CSRF.
  - **Login:** bcrypt (`BCRYPT_ROUNDS`, default 12), a generic "Invalid email or password", a dummy-hash comparison for unknown emails (so response time doesn't reveal them), and an in-memory lockout of 10 failures per IP+email per 15 minutes.

## Conventions

- UI text is Arabic and the layout is RTL (`dir="rtl"`). Code, comments and server error messages are English.
- **Branding**:
  - The app is called "Whish Money Manager". Components get the name, short name, tagline and logo from `src/lib/branding.js`; never hardcode them.
  - `index.html` (tab title and icon) and `public/manifest.json` repeat the name by hand. `tests/frontend/branding.test.jsx` checks they stay in sync.
  - `logo.png` has a **white, not transparent, border**: the red square sits at x 8–441, y 5–438 of 450×444, with ~12% corner radius. **Always render it with `<AppLogo className="w-12 h-12" />`** (`src/components/layout/AppLogo.jsx`), which crops the image to the red square inside a rounded frame.
    - Rounding a plain `<img>` (the first attempt, `rounded-[22%] object-cover`) still left ~1px white slivers at header size.
    - If the logo file is replaced, re-measure and update `CROP` in `AppLogo.jsx`.
  - **Internal identifiers keep the old name on purpose**, because renaming them would break existing data: `server/hawalaflow.db`, `HAWALAFLOW_DB_PATH`, and `local@hawalaflow.app` (`LEGACY_OWNER_EMAIL`, the owner of pre-accounts rows until `npm run seed` reassigns them). The old `hawalaflow_local_user` localStorage entry is now deleted on load.
- **Assets** live in `src/assets/` (the user's layout):
  - `css/index.css` is the only stylesheet, imported in `src/main.jsx`. `components.json` points to it.
  - New images go in `images/` and are imported from components (`import logo from "@/assets/images/…"`), so Vite fingerprints them.
  - `js/` is for standalone or vendored scripts only. App source code stays in `src/components`, `src/lib` and so on.
  - `public/manifest.json` stays in `public/`, because it must be served at a fixed URL.
  - Most styling is Tailwind classes in the JSX, not CSS.
- Import with the `@/` alias (`@/api/...`, `@/lib/...`). It's defined in `vite.config.js`, `vitest.config.js` and `jsconfig.json`; keep the three in sync.
- Keep pure logic in `src/lib/` (or exported from `server/index.js`) so it can be unit-tested.
- Match the surrounding style: small inline helpers, `// ═══ Section ═══` headers in long files, Tailwind classes inline.

## Testing notes

- Backend tests use an in-memory database (`HAWALAFLOW_DB_PATH=":memory:"`). **Never run tests or experiments against `server/hawalaflow.db`**: it is the user's real data. For manual checks, copy it to the scratchpad or open it read-only.
- Frontend tests need `/** @vitest-environment jsdom */` and mock `@/api/base44Client`.
- **Auth in backend tests:** `tests/backend/helpers.js` provides `startServer()`, `createTestUsers()` (admin, manager, user, user2, password `PASSWORD`), and `makeClient()`, which keeps one cookie per account. Use `client.request(method, route, { as: "user", body })`.
  - Each test file gets its own in-memory database.
  - Call `resetLoginRateLimit()` in tests that make many failed logins.
- **Auth in component tests:** `vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock)` and `setAuthRole("user")`. `can` uses the real shared rules.
- `vitest.config.js` sets `JWT_SECRET` (so no `server/.jwt-secret` file is written) and `BCRYPT_ROUNDS=4` (fast).
- **Security tests were checked for real failures:** granting Users `transactions:delete` made 3 permission tests fail. Keep them meaningful: assert both the status code and that the data didn't change.
- jsdom lacks `Blob.prototype.text()`, `matchMedia` and `ResizeObserver`. `tests/setup.js` stubs all three.
- Chart tests replace Recharts' `ResponsiveContainer` with a fixed-size stand-in, because jsdom has no layout. The stand-in records the requested width and height so responsiveness can be checked. Tests set `window.innerWidth` and `matchMedia` to switch between the phone and desktop layouts.
- The fixture `tests/fixtures/statement.csv` is a real export: 127 rows, totals reconcile exactly, and 10 rows have ±0.01 balance rounding.
- pdfjs logs `standardFontDataUrl` warnings in the PDF tests. They're harmless for text extraction.

## Known issues / backlog (not yet fixed)

- **PDF engine, one-cent problem**: the balance check (`Math.abs(trueAmount - transaction.amount) > 0.01`) fires on floating-point values like `|999.99 − 1000| = 0.0100000000000477`. That overwrites the amount by one cent on rows where the provider's rounded balance differs by 0.01, which is about 10 rows in a typical statement.
- **PDF engine, fragile opening-balance pattern**: `OPENING BALANCE…` takes the first run of digits (decimals optional). A missed or wrong opening balance defaults to 0 and corrupts the first transaction through the balance check.
- **PDF engine, no final check**: the closing balance is never compared with the result. `total_transactions_count` equals `transactions.length`, so the "fewer rows than expected" warning can't fire for PDFs.
- **`total_commission` from the PDF engine is built as text**: commission is a `toFixed` string, so the total is string concatenation. The UI doesn't use it.
- **ReviewPDFModal** (no longer used anywhere) calls `Core.UploadFile` / `Core.InvokeLLM`, which the local client doesn't implement. If it's brought back, wire it to `/pdf/extract` or `/csv/extract` instead.
- **Security, remaining:**
  - `/pdf/extract` has no page limit or timeout, and parsing blocks the server's main thread.
  - The login lockout is in memory, so it resets when the server restarts.
  - There's no self-service "change my password"; an Admin resets passwords.
  - Sessions are never pruned; rows are deleted only by logout, deactivation or password reset.
  - Fixed on 2026-09-24: SQL injection through filter keys, the trusted `x-user-email` header, and PUT/DELETE without permission checks.
- **Bundle size:** the JS bundle is about 796 kB (Recharts), and Vite warns about chunks over 500 kB. Code-splitting the chart modal would fix it.
- **Import preview**: editing amount or commission rate doesn't recalculate commission, and the phone column is hidden (it was already commented out).

## Change log

### 2026-09-23
- **Analysis**: reviewed the architecture and the PDF parsing path, and documented the accuracy risks listed above. No code changes.
- **CSV import engine** (`server/index.js`: `parseCsvText`, `extractTransactionsFromCsv`, `POST /local-api/csv/extract`):
  - Two-section CSV, columns found by header name, `,`/`;` delimiters, BOM and `="…"` handling.
  - Returns the same shape as the PDF engine plus `validation` (totals, closing balance, per-row balance within ±0.015).
- **File-type detection** (`src/lib/fileType.js`): `%PDF-` signature, otherwise `.csv` extension or CSV MIME types (Windows reports `application/vnd.ms-excel`). Labels changed to "PDF / CSV".
- **Name/phone split** (`splitNamePhone`) applied in both engines.
- **Duplicate detection and overwrite**:
  - `POST /transactions/find-duplicates` and `POST /transactions/import` (`overwrite` flag, one database transaction).
  - Duplicates step in `ImportPDFModal`; saving goes through `importRecords`.
  - `bulk-create` now shares `insertEntityRecord`; behaviour unchanged.
- **Reconciliation banner** in the import preview when the engine returns `validation`.
- **Search fix** (`src/lib/transactionSearch.js`):
  - Also searches `service`, `phone` and `customer_number`. 39% of stored rows have an empty `receiver_name`, and the table shows `customer_number` instead.
  - Phone numbers match regardless of formatting, amounts match as `50`/`50.00`/`$1,500`, and whitespace is collapsed.
- **Removed manual row insertion** ("+ إدراج هنا") from `TransactionsList`. This also removed the key-less fragment around each row.
- **Tests**: added Vitest with Testing Library and jsdom, 76 tests across backend and frontend. Added the `test`, `test:watch` and `verify` scripts, `vitest.config.js`, and the `HAWALAFLOW_DB_PATH` override. The server no longer listens when imported.
- Removed an unused `FileText` import in `ReviewPDFModal.jsx`. It was already there and made lint fail.
- Rewrote `README.md` and added this file.
- **Receiver report**:
  - Added the "تقرير مستلم" button (next to "تقرير مرسل") and `ReceiverReportModal.jsx`, built like the sender report: count, deposits, withdrawals, commissions, and a date range.
  - Added `matchesReceiver` / `receiverDisplay` to `src/lib/transactionSearch.js`.
- **Removed the "مراجعة الكشف" button** and its modal wiring from `TransactionsList`.
- **Monthly/yearly summaries**:
  - `StatsCards` now renders two collapsible `SummarySection`s: month (expanded) and year (collapsed, new).
  - The headers are buttons with `aria-expanded` / `aria-controls`.
  - A collapsed section shows a one-line summary.
  - Responsive grids: month 2/3/5 columns, year 2/4.
  - `Dashboard` computes `yearly*` figures.
  - Added `StatsCards.test.jsx` and Dashboard summary tests. Total now 104.
### 2026-09-24
- **Back to top from the logo/name**:
  - A button inside the `<h1>` calls `scrollToTop()` (smooth, or instant under reduced motion), with a focus ring and a tooltip.
  - Checked in Edge: the layout is unchanged, and the page scrolls to 0.
  - Added 7 tests (total 327).
- **Sticky header**:
  - The header is a sticky `<header>` (z-40, below modals). It publishes `--app-header-height`, which `index.css` uses for `scroll-padding-top`.
  - Checked in Edge at desktop and phone widths, including with a modal open.
  - Added 5 header tests (total 320).
- **Base44 removed** (user no longer uses the platform):
  - Deleted the `base44/` folder (platform metadata and stale entity schemas), `src/lib/app-params.js` (unused Base44 URL/token params) and `.env.local` (only `VITE_BASE44_*`).
  - Uninstalled `@base44/sdk` (never imported) and `@base44/vite-plugin`.
  - `vite.config.js` now defines the `@` alias itself. The plugin used to provide it; its other features were Base44 Builder/sandbox-only.
  - Package renamed to `whish-money-manager`.
  - Checked: 315 tests, build, and the dev server serving `@/` imports with no errors.
  - The API client keeps its `base44Client` / `base44` name, to avoid churn in about 25 files.
- **Animated summary blocks**:
  - `SummarySection` keeps its panel mounted and animates height (grid rows) and opacity. The cards slide, the chevron rotates, and the collapsed line fades in, with `motion-reduce` support.
  - Checked in Edge: the computed transition is `grid-template-rows, opacity, visibility` 0.3s, and closed blocks leave no gap.
  - `StatsCards.test.jsx` was updated for hidden-vs-open state, plus 7 animation tests (total 315).
- **Header "last login" fixed**:
  - It showed the current time, with a hardcoded "AM", instead of the previous sign-in.
  - Added `users.previous_login` (plus an upgrade step for existing databases), recorded at login and returned by `/auth/login` and `/auth/me`.
  - The header shows it, with the date kept left-to-right inside the Arabic label, or "أول تسجيل دخول".
  - Tests: 4 backend and 7 frontend (total 308).
- **Auto-seed on startup**: `ensureInitialAdmin()`. When no users exist, server start creates the roles and an Admin and logs the credentials. Added `startup.test.js` (4 tests; total 298).
- **Authentication, roles and permissions**:
  - **New server modules:** `server/db.js` (schema plus `roles`, `users` and `sessions`), `server/auth.js` (bcrypt, a JWT in an HTTP-only SameSite=Strict cookie, a session row per login, the `authenticate` and `requirePermission` middleware, the lockout, and Admin user APIs), `server/permissions.js` and `server/seed.js` (`npm run seed`).
  - **Every API route now requires a session**, and each has its permission check. The fake `admin/admin` login, the trusted `x-user-email` header and CORS were removed. Filter keys are whitelisted.
  - **Office-wide data:** reads, duplicate detection and bulk actions are no longer scoped by user. `created_by` is set by the server.
  - **Frontend:**
    - A cookie-based client with a session-ended event.
    - `AuthContext` with `can()` and `canEditTransaction()`.
    - A login page with no preset credentials.
    - A role badge in the header, plus a Users link for Admins.
    - `UsersPage` (add users, change roles, deactivate, reset passwords), guarded by `RequirePermission`.
    - Role-gated controls: delete everywhere, per-row edit, bulk edit only for own rows, import replace, and the opening-balance pencil.
  - **Tests:** 294 in total. New: `auth`, `permissions`, `users` and `seed` backend suites, and `AuthContext` and `UsersPage` frontend suites. Existing suites were updated to sign in.
  - **Checks:**
    - A sanity check confirmed the permission tests fail when the rules are loosened.
    - An end-to-end run on a **copy** of the real database: 625 transactions were reassigned and visible to all roles, User restrictions held, and logout revoked the session. The real database was not modified; it changes only when `npm run seed` is run.
- **Logo white slivers fixed** (reported by the user from the running app):
  - Added `AppLogo`, which crops `logo.png` to its red square using measured pixel bounds. The header and login page use it.
  - Checked at 4× pixel density on the dark header background.
- **Rebrand to "Whish Money Manager"**:
  - Added `src/lib/branding.js`.
  - The header now shows the logo, name and tagline, and wraps on narrow screens.
  - The login page shows the logo and name.
  - Tab title, and tab and home-screen icon (`index.html` → `src/assets/images/logo.png`; Vite fingerprints it in the build).
  - Manifest name and short name updated.
  - Checked visually with headless Edge at desktop and phone widths.
  - Added `branding.test.jsx` (9 tests; total 172). Internal identifiers left unchanged; see Branding above.
- **Assets folder**:
  - Moved `src/index.css` to `src/assets/css/index.css`, and updated the import in `src/main.jsx` and the `css` path in `components.json`.
  - The project has no image files: the tab icon is loaded from `https://base44.com/logo_v2.svg`.
  - It has no standalone JS assets, so `images/` and `js/` are empty.
  - Verified that the built CSS still contains the theme variables and Tailwind classes.

### 2026-09-23 (continued)
- **Bulk actions**:
  - Added multi-select: row checkboxes, a select-all checkbox with the partly-selected state, and a bulk bar showing the count and total.
  - Bulk edit through `BulkEditModal`, and bulk delete with a confirmation.
  - New endpoints `bulk-update` / `bulk-delete`, and client methods `bulkUpdate` / `bulkDelete`.
  - Checked visually with headless Edge; fixed the `$` placement in the RTL total.
  - Tests: backend bulk tests, `BulkEditModal.test.jsx`, table bulk-flow tests and client tests. Total now 163.
- **Monthly chart + toolbar cleanup**:
  - Added the "الرسم البياني" button and `MonthlyChartModal`: Recharts `ComposedChart`, dual axis as requested, year selector, table view, reduced-motion support, and phone and desktop layouts.
  - Checked visually with headless Edge screenshots against the real data.
  - Removed "تراجع" and "تحديث"; single-row delete is now immediate.
  - Tests: added `monthlyChartData.test.js`, `MonthlyChartModal.test.jsx` and new table tests. Total now 134.
- Tests: then 93. Added receiver matching unit tests, `ReceiverReportModal.test.jsx`, and table tests for both report buttons and the absent review button. There were no existing tests for the review button to remove.

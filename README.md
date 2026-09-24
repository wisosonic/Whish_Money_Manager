# Whish Money Manager

<img src="src/assets/images/logo.png" alt="Whish Money Manager logo" width="96" />

Whish Money Manager is a web app for a money-transfer office to record daily transactions, reconcile them against the Whish Money account statement, and track balances and commissions. The interface is in Arabic (right-to-left). The project was previously called HawalaFlow.

The app name and logo are defined once in `src/lib/branding.js`, and the header and login page read them from there. The browser tab (`index.html`) and the installed-app name (`public/manifest.json`) can't import code, so they repeat the name. The logo file is `src/assets/images/logo.png`.

It runs entirely on your machine: a React frontend and a small Node.js/Express API that stores data in a local SQLite file.

---

## Features

- **Daily journal**: every transaction for the selected day, with deposits (Cash In), withdrawals (Cash Out), commissions and the running wallet balance.
- **Monthly and yearly summaries**: two collapsible blocks at the top of the dashboard. Both follow the month and year of the date selected in the date picker.
  - **ملخص الشهر** (open by default): wallet net balance, number of transactions, commissions, withdrawals and deposits for the month.
  - **ملخص السنة** (collapsed by default): number of transactions, commissions, withdrawals and deposits for the year.
  - Click a block's header to open or close it. A collapsed block still shows its key figures on one line, e.g. `624 عملية · عمولات $1,234.50`.
  - Opening and closing is animated (0.3 s): the block smoothly grows or shrinks to its natural height, the cards fade and slide into place, the arrow rotates, and the one-line summary fades in. Users with "reduce motion" turned on in their system settings get no animation.
  - The cards rearrange for smaller screens: monthly 2 → 3 → 5 columns, yearly 2 → 4.
  - Both blocks open as described above each time the page loads. Each user can change which ones start open in [Settings](#settings).
- **Opening balance per day**: set by hand, taken from an imported statement, or carried forward from the previous day's closing figure.
- **Statement import (PDF or CSV)**: drop in the provider's account statement and the app extracts every transaction:
  - **PDF engine**: reads the statement table from the PDF text layer. Scanned or image-only PDFs aren't supported.
  - **CSV engine**: reads the provider's CSV export directly (exact amounts, no guessing), and checks the totals and running balance against the file.
  - The file type is detected automatically (PDF by its `%PDF-` signature, CSV by extension or MIME type).
  - Rows can be reviewed and edited before saving.
- **Duplicate protection**: re-importing a statement is detected by transaction reference number (e.g. `tr:626186571`). You choose to replace the existing entries or cancel. Manual entries are never touched.
- **Search**: names, reference numbers, notes, service, phone and customer numbers (in any format, e.g. `+961 71 389 296` or `071389296`) and amounts (`50`, `50.00`, `$1,500`).
  - **All days or this day:** a switch next to the search box chooses where to look. **كل الأيام** (all days, the default) searches every day. **هذا اليوم** (this day) searches only the date in the date picker.
  - **All-days results:** they show every match in journal order (oldest day first), with a blue line such as "6 نتيجة في 3 يوم" (6 results across 3 days).
  - **In the results:** each date is a link. Click it to open that day, which also clears the search. "#" is each row's number within its own day, and rows from another day name their date for screen readers (e.g. "تحديد العملية 1 بتاريخ 2026-09-22").
  - **What doesn't change:** the day's totals above the table (deposits, withdrawals, commissions) always count the selected day only, whatever the search scope. "Delete all for this day" is hidden while all-days results are shown, so it can't be confused with them.
  - With an empty search box, the table shows the selected day as usual.
- **Reports**: daily commission report, and two per-party reports with count, deposits, withdrawals and commissions over an optional date range:
  - **تقرير مرسل** (sender report): all transactions whose sender name matches.
  - **تقرير مستلم** (receiver report): all transactions whose receiver matches, by name or, when the receiver was stored as a phone number, by that number in any format (`71389296`, `+961 71 389 296`, `071389296`). The receiver is shown the same way as in the transactions table.
- **Monthly chart (الرسم البياني)**: one bar-and-line chart for a whole year, built with [Recharts](https://recharts.org):
  - **X-axis**: the 12 months. Phones show month numbers (1–12) instead of names.
  - **Left y-axis**: profit, meaning the commissions earned each month, drawn as blue bars.
  - **Right y-axis**: total cash in (solid green line) and total cash out (dashed red line).
  - **Year selector**: defaults to the selected date's year and lists every year that has transactions.
  - **Tooltip**: on hover, shows every series for that month. **Legend** below the chart.
  - **Year totals**: profit, cash in, cash out and number of transactions.
  - **Table view** ("عرض كجدول") with the same figures per month plus totals, for exact values and screen readers.
  - **Future months** of the current year are left blank instead of drawn as $0.
  - **Live**: recalculates whenever transactions change (import, add, edit, delete).
  - **Responsive**: fills the width of its container and resizes with the screen.
  - **Accessibility**:
    - Colors were checked for color-blind readers, and cash out is also dashed, so no series relies on color alone.
    - The animation is skipped for users who turn on "reduce motion".
  - Because profit and cash flows use different scales on the two axes, compare each line against its own axis. The tooltip and table view give exact values.
- **Your place is kept:** after editing, deleting, a bulk action, Cash In/Out or an import, the table updates in place and the page stays exactly where you had scrolled. It doesn't jump back to the top. "Loading..." appears only the first time the page opens.
- **Type column**: each row shows an icon instead of text: a **green ↓** for Cash In and a **red ↑** for Cash Out (the same arrows as the Cash In / Cash Out buttons). Hover over an icon to see its name; screen readers read it out.
- **Sorting (every column)**: click any column header (#, Type, Sender, Receiver, Amount, Commission rate, Commission, Reference, Service, Note, Date) to sort by it. Click once for ascending, again for descending, and a third time to go back to the journal order.
  - The sorted column is highlighted in blue, with ▲ or ▼ next to its name. Hovering over a header tells you what the next click will do.
  - Only one column is sorted at a time; clicking another column starts it ascending.
  - **Ascending means:** A→Z, smallest first, oldest first. For Type, it means Cash In first.
  - **How values compare:**
    - Names ignore upper/lower case, and Arabic names sort in Arabic alphabetical order.
    - References compare their numbers naturally (`tr:9` before `tr:10`).
    - Receiver sorts by what the column shows.
    - Rows with an empty value always go last, and rows with the same value keep their journal order.
  - The "#" column always shows each row's real number in the day's journal. Selecting rows and bulk actions work the same while sorted.
  - The sort resets when the page reloads.
- **Personal settings** (⚙️ in the header): each user chooses their language, light or dark theme, which table columns to show, compact or comfortable rows, and which summaries start open. Saved to their account. See [Settings](#settings).
- **Admin panel** (Admin and Manager): download a CSV backup of any date range, or permanently delete all data in a range. See [Admin panel](#admin-panel-admin-and-manager).
- **Manual entry**: Cash In / Cash Out forms, plus edit, delete, and "delete all for this day". Deleting a row happens as soon as you confirm it ("تأكيد"); there is no undo.
- **Bulk actions (multi-select)**: tick the checkbox on any rows, or use the header checkbox to select every visible row. A partly-selected header shows a dash.
  - A blue bar appears above the table with the selection count and total amount, plus:
    - **تعديل المحدد** (edit selected): set the same values on every selected transaction. Tick "تغيير" next to each field you want to change; unticked fields stay as they are on every row, and a ticked field left empty clears it (e.g. remove all notes). Editable fields:
      - type
      - sender name, receiver name
      - service
      - note
      - date (moves the transactions to another day)
      - commission rate: each row's commission is recalculated from its own amount, e.g. 1.5% of $250 = $3.750
    - Amount, reference number and phone differ per transaction, so they stay in the single-row editor.
    - **حذف المحدد** (delete selected): deletes all selected transactions after a confirmation, in one request. It can't be undone.
    - **إلغاء التحديد** (clear selection).
  - **Only visible rows can be selected.** When you change the day or search, selected rows that are no longer shown are dropped from the selection, so an action never hits rows you can't see.
  - **Opening balances:** when a bulk delete or date change leaves a day with no transactions, that day's opening balance is removed, the same as a single delete.

The transactions table's toolbar has: الرسم البياني, تقرير مرسل, تقرير مستلم, تقرير العمولات, delete all, استيراد PDF / CSV, Cash Out and Cash In. These buttons have been removed:
- statement review ("مراجعة الكشف")
- between-row insertion ("إدراج هنا")
- undo ("تراجع")
- refresh ("تحديث"): the table already reloads after every change.

## How it works

```
Browser (React + Vite, :5173)  ──/local-api (Vite proxy)──►  Express API (:3001)  ──►  SQLite (server/hawalaflow.db)
src/api/base44Client.js                                       server/index.js
```

- `src/api/base44Client.js` is the app's API client (`base44.auth`, `base44.entities.*`, `base44.integrations.Core.*`, `base44.users`); it talks only to the local Express API. (The `base44` name is historical: the project started on the Base44 platform, which is no longer used.)
- PDF and CSV parsing happen on the server. Both engines return the same result shape, so the import screen, the save step and the dashboard don't care which one was used.
- Dashboard totals are calculated in the browser from the stored transactions and the opening balance for each day.

---

## Getting started

### Requirements

- **Node.js 20 or newer** (developed and tested on Node 24)
- npm
- `better-sqlite3` is a native module. Prebuilt binaries cover common platforms. Otherwise npm builds it, which needs Python and a C++ toolchain (on Windows: "Desktop development with C++" from Visual Studio Build Tools).

### Install

```bash
npm install
```

No `.env` file is needed for local use. The optional settings are listed under Configuration.

### Run

```bash
npm run dev
```

This starts both processes:

| Process | Command | URL |
|---|---|---|
| Web app | `npm run dev:web` | http://localhost:5173 |
| API | `npm run dev:api` | http://localhost:3001 (proxied at `/local-api`) |

### First-time setup: the Admin account

The app has real accounts. **On startup, the API checks for user accounts. If there are none, it seeds automatically:** it creates the three roles and an Admin, and prints the sign-in details in the terminal:

```
[local-api] No user accounts found — created the default roles and an Admin account:
[local-api]   Email:    admin@whish.local
[local-api]   Password: Xy7…                     ← generated, shown only once
```

- **Your own details:** set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_NAME` before the first start. The password is then never printed.
- **Lost the password:** run the seed script with a different email to create another Admin.
- **Seeding manually:** you can create the roles and first Admin yourself before the first start:

```bash
npm run seed -- --email you@yourshop.com --password "a long password" --name "Your Name"
```

- **No password given:** the script generates a strong one and prints it **once**. Store it safely.
- **Default email** (if you don't pass `--email`): `admin@whish.local`.
- **Existing data:** transactions and opening balances created before accounts existed (by the old built-in `admin/admin` login) are handed to this Admin.
- **Safe to run again:** it restores the three default roles' permissions, and never changes an existing Admin's password.

Then start the app, sign in with that email and password, and add your team from the **المستخدمون** (Users) page.

The database file `server/hawalaflow.db` is created on first start and is git-ignored. **Back it up**: it holds all your data.

### Configuration

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `API_PORT` | API | `3001` | Port the API listens on (update the proxy in `vite.config.js` if you change it) |
| `HAWALAFLOW_DB_PATH` | API | `server/hawalaflow.db` | SQLite file to use (`:memory:` for a throwaway database) |
| `JWT_SECRET` | API | generated once into `server/.jwt-secret` (git-ignored) | Secret used to sign session tokens. Set it explicitly in production. Changing it signs everyone out. |
| `COOKIE_SECURE` | API | `false` (`true` when `NODE_ENV=production`) | Send the session cookie over HTTPS only. Turn on whenever the app is served over HTTPS. |
| `BCRYPT_ROUNDS` | API | `12` | Password-hashing cost |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | `npm run seed` | — | Alternatives to the `--email`, `--password` and `--name` flags |

---

## Accounts, roles and permissions

Everyone signs in with their own email and password. There are three roles:

| | Admin | Manager | User |
|---|:-:|:-:|:-:|
| See all office transactions, balances, reports and the chart | ✓ | ✓ | ✓ |
| Add transactions (Cash In / Cash Out) | ✓ | ✓ | ✓ |
| Import PDF / CSV statements | ✓ | ✓ | ✓ |
| Edit transactions **they entered** (single and bulk) | ✓ | ✓ | ✓ |
| Edit **anyone's** transactions | ✓ | ✓ | — |
| Delete transactions (single, bulk, "delete all for this day") | ✓ | ✓ | — |
| Replace an already-imported statement (deletes the old entries) | ✓ | ✓ | — |
| Set or change opening balances | ✓ | ✓ | — |
| Manage users and roles (المستخدمون page) | ✓ | — | — |
| Admin panel: CSV backup by date range | ✓ | ✓ | — |
| Admin panel: delete all data in a date range | ✓ | ✓ | — |

- **Everyone sees everything.** The office shares one set of transactions; roles only limit what people may change.
- **The server enforces every rule.** Buttons a user can't use are hidden, but the API also refuses the action (HTTP 403), so the rules can't be bypassed.
- **"Entered by"** is the account that created the transaction, recorded automatically; users can't change it.

### Signing in and staying signed in

- **Session length:** sessions have **no expiry date**. You stay signed in until you press **خروج** (log out), even after closing the browser.
- **Where the session lives:** in a secure cookie that page scripts can't read (`HttpOnly`) and that other websites can't send (`SameSite=Strict`).
- **The browser cap:** browsers keep cookies for at most about 400 days. The app renews the cookie as you use it, so this only matters if nobody opens the app for 400 days.
- **Logout:** ends that session on the server immediately. A copy of the token can't be reused, and other devices stay signed in.
- **Brute-force protection:** after 10 wrong passwords for the same email, sign-in is blocked for 15 minutes.
- **Language (العربية / English):** the header has an on/off language switch, and so does the login page, so it works before signing in. It shows **ع** on the left and **EN** on the right, and a white knob sits on the active language. Click it (or Tab to it and press Space/Enter) to slide to the other one. Screen readers announce it as the "English" switch, on or off.
  - **Arabic is the default.**
  - **The whole interface switches:** every label, message, month name, number of transactions (with English singular/plural) and the page direction. Arabic is right-to-left; English is left-to-right, with the layout mirrored.
  - **Server messages** (e.g. a wrong password) are shown in the chosen language.
  - **The choice is saved in a cookie** (`wmm_lang`, kept for a year), so it survives reloads and applies from the first screen.
  - **When you're signed in, it's also saved to your account** (see [Settings](#settings)), so it follows you to other devices and is applied when you sign in there.
- **Back to top:** click the logo or the app name in the header to scroll smoothly back to the top of the page (instantly if "reduce motion" is on). It also works from the keyboard: Tab to it, then press Enter.
- **Header position:** the header (logo, user, logout, clock) stays **fixed at the top of the screen** while you scroll, on every page and screen size. Pop-up windows still appear above it. When the keyboard moves focus to a field lower down, the page scrolls so the field lands just below the header, not behind it.
- **Header:** shows your name, your role, and **your last login**. That's the date and time of the sign-in *before* the current one (e.g. `آخر دخول: 2026/09/23 08:05 PM`), in your local time. It shows "أول تسجيل دخول" on your first ever sign-in. Because sessions don't expire, it changes only when you sign in again. Signing in on another device counts as a new sign-in.

### Settings

Every user has a **Settings** page: click the ⚙️ gear in the header (next to Log out). Changes apply **immediately** and are **saved to your account** on the server, so they follow you to any device or browser. A small status line at the top says "Saving…", then "Saved", or explains what went wrong. If a save fails, the previous value comes back.

- **Language:** العربية or English. This is the same choice as the header switch.
- **Table columns:** tick or untick any of the 11 columns of the transactions table:
  - #, Type, Sender, Receiver, Amount, Commission rate, Commission, Reference, Service, Note, Date
  - The row checkboxes and the edit/delete buttons always stay.
  - At least one column must stay visible, so the last one can't be unticked.
  - "Show all columns" brings them all back.
  - Hiding a column you had sorted by returns the table to the journal order.
- **Display:**
  - **Theme:** *Light* (the default), *Dark*, or *Match system*, which follows the device's light/dark setting and switches with it (e.g. at sunset, if the device does).
    - Dark mode covers every screen, pop-up and the chart, which uses its own colours checked for colour-blind readers on the dark background.
    - The header and login page are dark in both themes.
    - The theme is also remembered in this browser (cookie `wmm_theme`), so a dark page doesn't flash white while loading.
  - **Row spacing:** *Comfortable* (the default) or *Compact*, which fits more transactions on screen.
  - **Summaries open when the page loads:** whether "ملخص الشهر" and "ملخص السنة" start expanded. The defaults are month open and year closed. You can still open or close them on the dashboard at any time.
- **Restore default display settings** resets the theme, columns, row spacing and summaries in one step. Your language is left as it is.

Settings are personal: they never change what other users see.

### Admin panel (Admin and Manager)

Open **لوحة الإدارة** (Admin panel) in the header. Users don't see the link, and opening `/admin` directly shows a "no permission" page.

1. **Choose a date range:** a start and end date (both included), or a quick range:
   - This month
   - Last month
   - This year
   - All data (from the first to the last day that has anything)

   Below the dates, a preview shows what the range holds: the number of transactions and days, opening balances, and the total in, out and commissions. It updates as you change the dates. A start date after the end date is refused.
2. **Backup:** two buttons download the range as CSV files.
   - **Transactions:** `transactions_<from>_<to>.csv`, with every column: type, amount, commission, names, phone, customer number, reference, service, note, currency, status, who entered it and when.
   - **Opening balances:** `opening-balances_<from>_<to>.csv`.
   - **Opening in Excel:** the files open in Excel with Arabic names intact. Text that Excel would treat as a formula (starting with `=` or `@`, for example) is saved with a leading `'`, so opening a file can't run anything. Phone numbers such as `+96171…` and amounts are saved exactly.
3. **Delete data** (red section): permanently deletes **every transaction and every opening balance** in the range, for everyone in the office.
   - **Confirming:** a confirmation window shows the range and the counts. It offers "Download a backup first", and you must type the exact number of transactions (e.g. `128`) before "Delete permanently" is enabled.
   - **If the data changed:** if someone added or deleted transactions in that range after you opened the confirmation, nothing is deleted. You're asked to check the new counts first.
   - **Afterwards:** a message confirms how many transactions and opening balances were deleted. The server also logs who deleted what.
   - **It can't be undone.** Keep the CSV backup if you might need the data again.

### Managing users (Admin)

Open **المستخدمون** in the header to:
- **Add a user:** name, email, role and a password of at least 8 characters.
- **Change a role:** takes effect on the user's next action; no re-login needed.
- **Deactivate or reactivate:** deactivating signs the user out on every device and blocks sign-in. Their transactions are kept.
- **Reset a password:** signs the user out on every device.

Safety rules: there must always be at least one active Admin, and an Admin can't deactivate their own account.

## Using the app

### Daily workflow

1. Pick the day with the date picker ("اليومية") or press "اليوم" for today.
2. Import that day's statement ("استيراد PDF / CSV") or add entries with **Cash In** / **Cash Out**.
3. Check the wallet summary: opening balance + deposits − withdrawals = net balance.
4. Open **ملخص الشهر** / **ملخص السنة** at the top for totals across the whole month or year.

### Importing a statement

1. Click **استيراد PDF / CSV** and drop in the statement file.
2. If transactions with the same reference numbers already exist, you're asked to either:
   - **استبدال العمليات الموجودة** (replace): the existing entries are deleted and replaced when you save.
   - **إلغاء الرفع** (cancel): nothing is saved.
3. Review the rows. For CSV files, a banner shows whether the file reconciles: debit total, credit total, closing balance, and each row's balance. Fix or remove rows if needed.
4. Click **حفظ الكل**. The statement's opening balance is stored for that day, and the dashboard jumps to it.

### Import rules

| Rule | Behaviour |
|---|---|
| Direction | Debit → **Cash Out**, credit → **Cash In** |
| Commission (CSV) | 1% of every credit (rounded to 3 decimals). Debits have no commission. |
| Commission (PDF) | 1% of credits, except descriptions containing "cashin" or "qr topup" and services containing "reversed". Debits have no commission. |
| `NAME - 96171588017` | Split in both engines: name → sender/receiver, `phone` = `96171588017`, `customer_number` = `71588017` (without 961) |
| Bare phone as receiver | Moved to `phone` / `customer_number` on save |
| Duplicates | Same reference number for the same user |

### CSV statement format

The provider's CSV export has two sections in one file, separated by blank lines. Columns are matched by header name, so column order doesn't matter, and `,` or `;` delimiters both work.

```csv
statement_id,period_from,period_to,issued_on,full_name,phone_number,account_no,address,whish_card_last4,currency,opening_balance,total_debit,total_credit,closing_balance
SOA-20260923-0001,"=""23/09/2026""","=""23/09/2026""","=""23/09/2026""",Vicario,961…,20200813,"…",**** 6965,USD,"10,648.51","41,091.65","40,447.67","10,004.53"

statement_id,line_no,date,reference,service,description,debit,credit,balance
SOA-20260923-0001,1,"=""2026-09-23""",tr:626186571,,+9613915112,50.00,0.00,"10,598.51"
```

- Required transaction columns: `date`, `debit`, `credit`, `balance`. Also used: `line_no`, `reference`, `service`, `description`.
- The summary section is optional. Without it, opening and closing balances are taken from the first and last rows.
- Excel's `="…"` wrapping and thousands separators are handled.
- The provider prints every figure rounded to the cent from more precise values (sub-cent fees, currency conversions). So a row's balance may move a cent more or less than its amount, and over a whole statement these cents can leave the closing balance one cent away from opening + credits − debits.
  - **How the app checks:** it doesn't simply allow a cent of slack. It checks that the rounding can really explain the difference: every exact value must be within half a cent of what's printed, and all the balances must still add up.
  - **When rounding explains it:** the statement shows as reconciled, with a note such as "The provider's rounding accounts for a $0.01 difference, spread over 145 rows…".
  - **When it doesn't:** for example a missing row, an amount off by more than rounding allows, or a closing balance that differs from the last row. The statement shows as not reconciled, with the line where the balances stop adding up.
  - **What it can't catch:** a one-cent typo that happens to look exactly like rounding, since the printed figures are then genuinely consistent.
  - Amounts always come from the debit/credit columns; balances are only used for checking.

A sample export is included: `AccountStatementCSV_20200813.csv` (also used as a test fixture).

### Known limitations

- **Scanned PDFs**: the PDF engine needs a text layer.
- **Passwords:** there's no self-service "change my password" yet; an Admin resets passwords from the Users page.
- **HTTPS:** served over plain HTTP, sessions can be intercepted on the network. Put the app behind HTTPS and set `COOKIE_SECURE=true` before using it anywhere other than the office's own computer or network.

---

## Development

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run web app and API together |
| `npm run seed` | Create/restore the default roles and the first Admin (see First-time setup) |
| `npm run build` | Production build of the frontend into `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run verify` | Lint + tests + build (run this before every deploy) |

### Tests

Tests use [Vitest](https://vitest.dev) and live in `tests/`:

```
tests/
├── setup.js                  # jest-dom matchers; jsdom stubs for Blob.text(), matchMedia, ResizeObserver
├── fixtures/statement.csv    # real CSV statement export (127 rows)
├── backend/
│   ├── helpers.js            # test server, one account per role, cookie-keeping client
│   ├── api.test.js           # HTTP API (as Admin): CRUD, office-wide data, created_by, filter safety,
│   │                         # balances, import, duplicates/overwrite, bulk update/delete
│   ├── auth.test.js          # login, cookie flags, JWT (no expiry), tampered/forged tokens, 401 on
│   │                         # every route, logout revocation, never-expiring + sliding sessions, lockout,
│   │                         # previous-login tracking + schema upgrade
│   ├── permissions.test.js   # role matrix end to end: Admin / Manager / User on every endpoint,
│   │                         # own-vs-others edits, live role changes
│   ├── preferences.test.js   # per-user settings: defaults, partial saves, validation (400), per-account,
│   │                         # tolerant reading of stored JSON, database upgrade
│   ├── admin.test.js         # admin panel API: permissions, preview, CSV (quoting, formula guard, BOM),
│   │                         # delete by range (409 when counts changed), permission upgrade
│   ├── users.test.js         # Admin user management, deactivation/reset revoke sessions, last-Admin rules
│   ├── seed.test.js          # default roles, first Admin, generated password, idempotency, data migration
│   ├── startup.test.js       # auto-seed on server start when no users exist (runs the real server twice)
│   ├── csvEngine.test.js     # CSV parser, fee rule, name/phone split, validation, format variations
│   └── pdfEngine.test.js     # PDF engine on generated PDFs, balance-based direction correction
└── frontend/
    ├── authMock.js           # simulated signed-in user per role for component tests
    ├── base44Client.test.js  # API client: cookie session (no identity header), 401 handling, errors
    ├── AuthContext.test.jsx  # session restore, login/logout, session-ended, can(), route guard
    ├── UsersPage.test.jsx    # Admin users screen: list, add, role change, deactivate, reset password
    ├── fileType.test.js      # PDF/CSV detection
    ├── transactionSearch.test.js
    ├── ImportPDFModal.test.jsx   # PDF/CSV routing, preview, duplicate prompt, save payload
    ├── TransactionsList.test.jsx     # table, report/chart buttons, removed buttons, immediate delete,
    │                                 # multi-select, select-all, bulk edit/delete flows,
    │                                 # type icons, sorting by every column
    ├── transactionSort.test.js       # sort cycle, stability, empty values last, natural/Arabic order
    ├── AdminPage.test.jsx            # admin panel: ranges, preview, downloads, typed-count delete, 409, header link
    ├── theme.test.jsx                # dark mode: saved/system theme, pre-paint script, stylesheet mappings, chart
    ├── download.test.js              # saving a CSV download
    ├── SettingsPage.test.jsx         # settings page, saving (in order, errors), language on sign-in,
    │                                 # header link, table columns/density and summaries following the settings
    ├── BulkEditModal.test.jsx        # opt-in fields, payload, commission rate, validation, errors
    ├── ReceiverReportModal.test.jsx  # receiver matching, totals, date filter
    ├── branding.test.jsx             # header (logo, name, role, last login, sticky), login page, tab title/icon, manifest
    ├── i18n.test.jsx                 # language toggle: dictionaries match, no untranslated text, cookie,
    │                                 # page direction, main screens in English
    ├── StatsCards.test.jsx           # monthly/yearly summaries: defaults, collapse, layout, animation
    ├── monthlyChartData.test.js      # per-month aggregation, future months, formatters
    ├── MonthlyChartModal.test.jsx    # axes, bars/lines, legend, tooltip, table view, year switch,
    │                                 # live updates, desktop vs phone layout, reduced motion
    └── Dashboard.test.jsx            # search, monthly/yearly totals following the date picker,
                                      # table kept in place (scroll position) while refreshing after edit/delete
```

- Backend tests start the API on a random port against an **in-memory SQLite database** (`HAWALAFLOW_DB_PATH=":memory:"`, set in `vitest.config.js`). Your real `server/hawalaflow.db` is never touched.
- Frontend tests run in jsdom (`/** @vitest-environment jsdom */` at the top of the file) with the API client mocked. Screens that depend on the signed-in user use `authMock.js` to test each role.
- Tests use a fixed `JWT_SECRET` and cheap password hashing (`BCRYPT_ROUNDS=4`), set in `vitest.config.js`.

### Project structure

```
server/index.js               Express API routes (with permission checks), PDF + CSV engines, import/bulk endpoints
server/auth.js                Login/logout, JWT session cookie, authenticate + requirePermission middleware, user admin API
server/permissions.js         Permission names and the three default roles (shared with the frontend)
server/db.js                  SQLite connection and schema (transactions, daily_balances, roles, users, sessions)
server/admin.js               Admin panel API: range preview, CSV export, delete by date range
server/preferences.js         Per-user settings: column list, defaults, validation (shared with the frontend)
server/seed.js                `npm run seed`: default roles + first Admin + legacy data migration
src/api/base44Client.js       API client for the local Express API (name kept from the project's Base44 origins)
src/pages/Dashboard.jsx       Main screen: totals, balances, day filter, search
src/pages/UsersPage.jsx       Admin: users and roles
src/pages/SettingsPage.jsx    Every user: language, theme, visible table columns, row spacing, summaries
src/pages/AdminPage.jsx       Admin + Manager: CSV backup and delete by date range
src/lib/PreferencesContext.jsx  The signed-in user's settings: applied at once, saved in order to the account
src/components/dashboard/     Stats cards, wallet summary, transactions table, monthly chart
src/components/transactions/  Import, cash in/out, edit, sender/receiver/commission reports
src/lib/                      Auth context (session, can()), permissions, search matching, file-type detection, chart data
src/assets/css/index.css      The app's only stylesheet: Tailwind directives + theme colour variables
src/assets/images/logo.png    App logo: header, login page, browser tab icon
src/lib/branding.js           App name, short name, tagline and logo (single source for components)
src/lib/i18n.jsx              Language provider, t() lookup, wmm_lang cookie, page direction
src/locales/ar.js, en.js      All interface text: Arabic (default) and English, same keys
src/assets/js/                Standalone scripts / vendored JS (none yet — app source stays in src/)
public/manifest.json          Web app manifest (must stay in public/: served as-is at /manifest.json)
tests/                        Test suite
```

### API

All routes are under `/local-api`.
- **Public:** only `/health`, `/auth/login` and `/auth/logout`. Everything else needs the session cookie (401 without it).
- **Permissions:** the "Needs" column lists the permission required (403 without it).
- **Writes:** must be `application/json`.

| Method | Route | Needs | Purpose |
|---|---|---|---|
| POST | `/auth/login` | — | `{ email, password }` → sets the session cookie, returns the user with role, permissions, `last_login` (this sign-in) and `previous_login` (the one before) |
| POST | `/auth/logout` | — | Deletes the session and clears the cookie |
| GET | `/auth/me` | session | The signed-in user, including their `preferences` |
| PUT | `/auth/preferences` | session (own account only) | Partial change, e.g. `{ density: "compact" }` or `{ hiddenColumns: ["note"] }`, merged over what's stored. Keys: `language` (`ar`/`en`/`null`), `hiddenColumns` (column keys; at least one must stay visible), `density` (`comfortable`/`compact`), `summaries` (`{ month, year }` booleans), `theme` (`light`/`dark`/`system`). Unknown keys or values → 400. Returns the user |
| GET | `/admin/range` | `data:export` | `{ first_date, last_date }` of all data |
| GET | `/admin/summary?from=&to=` | `data:export` | Counts and totals in the range (dates `YYYY-MM-DD`, both included) |
| GET | `/admin/export?kind=&from=&to=` | `data:export` | CSV download; `kind` = `transactions` or `balances` |
| POST | `/admin/purge` | `data:purge` | `{ from, to, expected_count }` deletes the range's transactions and opening balances in one database transaction. 409 (nothing deleted) if the range no longer has `expected_count` transactions |
| GET | `/users` · `/roles` | `users:manage` | List users / roles |
| POST | `/users` | `users:manage` | `{ email, full_name, password, role }` → create a user |
| PUT | `/users/:id` | `users:manage` | `{ full_name?, role?, is_active?, password? }`. Deactivation and password reset end the user's sessions |
| POST | `/pdf/extract` · `/csv/extract` | `transactions:import` | Extract a statement |
| POST | `/transactions/find-duplicates` | `transactions:import` | `{ references }` → existing transactions with those references (office-wide) |
| POST | `/transactions/import` | `transactions:import` (+ `transactions:delete` when `overwrite`) | `{ records, overwrite }` |
| POST | `/transactions/bulk-update` | `transactions:update:any`, or `:own` if every selected row is theirs | `{ ids, changes }` |
| POST | `/transactions/bulk-delete` | `transactions:delete` | `{ ids }` |
| POST | `/transactions/filter` · `/daily-balances/filter` | `transactions:read` / `balances:read` | List. Filter keys must be real columns |
| POST | `/transactions/create` · `/bulk-create` | `transactions:create` / `transactions:import` | `created_by` is always the signed-in user |
| PUT | `/transactions/:id` | `transactions:update:any`, or `:own` for their own rows | Update |
| DELETE | `/transactions/:id` | `transactions:delete` | Delete |
| POST / PUT / DELETE | `/daily-balances/…` | `balances:write` | One opening balance per date (creating an existing date updates it) |

### Deploying

1. Run `npm run verify`. Don't deploy unless it passes, and fix any failing test first.
2. Set `JWT_SECRET` to a long random value and serve over HTTPS with `COOKIE_SECURE=true` (or `NODE_ENV=production`).
3. Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` for the first start, so the automatic seed creates your Admin instead of printing a generated password in the server log.
4. Build the frontend (`npm run build`) and serve `dist/`.
5. Run the API (`node server/index.js`) next to it, with `/local-api` routed to it, and a persistent location for the SQLite file (`HAWALAFLOW_DB_PATH`).

The project originally started on the Base44 platform. It no longer uses Base44 in any way: no Base44 packages, settings or hosting. It's a standalone React + Express app.

# ColleagueSplit

> **Spend together. Split smarter.**

A mobile-first, installable (PWA) expense-sharing app for a small group of colleagues who share lunches, coffees and snacks. Inspired by Splitwise. Currency: **AED**.

Built with Next.js (App Router), TypeScript, Tailwind CSS, Supabase (Postgres, Auth, Storage) and Lucide icons. Deploys to Vercel.

## Status — what is and isn't verified

| Area | Status |
| --- | --- |
| Calculation logic (splits, balances, debt simplification, CSV) | Implemented, **49 automated tests pass** |
| Demo mode (full UI with sample data in your browser) | Implemented, production build passes |
| Supabase schema, RLS, RPC functions, storage policies | Written (`supabase/migrations`), **not yet run against a live Supabase project** — see [Verifying your Supabase setup](#verifying-your-supabase-setup) |
| Supabase auth / invite flow in the UI | Implemented against the Supabase API, **untested against a real project** |
| Visual QA on real phones | **Not done** — please try it on your devices |

No external service has been configured for you. You must create a Supabase project and set the env vars yourself (below).

## Features

- Email sign-up / login, persistent secure sessions (cookie-based, refreshed in middleware)
- Create a group, invite via link or code (12-char random code, expires in 7 days, max 10 uses, admin-only). Member count is not hard-coded.
- Dashboard: balances, you owe / owed to you, group total, monthly summary, recent expenses
- Add expense: description, amount, date, payer, 8 categories, split between selected members, **equal / exact / percentage** splits with a live per-person preview, notes, optional private receipt
- Integer-fils money arithmetic (no floating point); shares always add up exactly (largest-remainder rounding)
- Settle Up: minimised payment suggestions, full or partial payments, cash/bank transfer, history, undo with reason + audit log. **Two-sided confirmation:** one settlement record per payment. Whoever records it (payer: "I paid", or receiver: "Received") applies it to balances immediately; the other person gets a *Confirm receipt* / *Confirm payment* button. Statuses: *Awaiting confirmation*, *Confirmed*, *Undone*. Confirming updates the same record and never changes a balance. Settlements move balances but never count as spending. **No payment gateway** — it only records payments you make yourselves.
- Expense history: search, filter by member / category / date range, edit, delete (with confirmation), per-expense activity, CSV export
- Reports: month navigation, total, paid vs share per member, by category, outstanding balances, CSV export
- Activity log of every add / edit / delete / settlement / undo
- **Expense audit history:** every create / edit / delete stores a full snapshot (amount, payer, date, category, split, notes, receipt) with who did it and when. Open an expense → *Change history* to see before → after for each field. Entries can't be edited or deleted by anyone through the app, and edits are flagged with an "edited" badge.
- Dark mode, skeleton loaders, empty states, toasts, bottom navigation on mobile
- PWA: manifest, generated icons, service worker, offline banner

## Quick start (demo mode — no accounts needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase variables set, the app runs in **demo mode**: sample data for a four-person group lives in your browser's `localStorage`. Pick a demo user on the login screen; switch users or reset data from **Profile → Demo tools**. A 5th "outsider" user lets you test the invite flow: as Aisha (admin) create an invite in Profile, switch to the outsider and join with the code.

Demo mode enforces the same authorization and validation rules as the real backend, but data never leaves your browser.

## Setting up Supabase (real mode)

1. Create a project at https://supabase.com.
2. Run the migrations **in order** in the SQL editor (or with the Supabase CLI: `supabase link` then `supabase db push`):
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_rls.sql`
   3. `supabase/migrations/0003_functions.sql`
   4. `supabase/migrations/0004_storage.sql`
   5. `supabase/migrations/0005_expense_history.sql` (audit history; existing expenses get a "history starts here" baseline entry)
   6. `supabase/migrations/0006_settlement_confirmation.sql` (one settlement per payment + confirmation; existing settlements become "confirmed")
3. **Authentication → URL Configuration**: set *Site URL* to your deployed URL (or `http://localhost:3000` for local) and add `<your-url>/auth/callback` to *Redirect URLs*.
4. **Authentication → Providers → Email**: keep "Confirm email" on for production (the app shows a "check your email" screen). Turn it off for quick local testing if you prefer.
5. Copy `.env.example` to `.env.local` and fill in **Project Settings → API**:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
   ```
   Use the **anon** key only. The service-role key is never used by this app and must never be placed in a `NEXT_PUBLIC_` variable.
6. `npm run dev`, sign up, create your group, and invite your colleagues from **Profile**.

### Checking for duplicate settlements from the old bug

Before the two-sided confirmation fix, tapping both "I paid" and "Received" recorded the same payment twice. Run `supabase/tests/find_duplicate_settlements.sql` (read-only, changes nothing) to list possible duplicates. Review each with the people involved, then use **Undo** on the extra payment from Settle Up with a reason — never delete rows by hand.

### Verifying your Supabase setup

The SQL has not been executed against a live database by the author. After running the migrations, run `supabase/tests/verify.sql` in the SQL editor — it creates two throw-away users and checks that RLS blocks outsiders, duplicate submissions return the same row, bad splits are rejected, and balances sum to zero. It cleans up after itself.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## Deploying to Vercel

1. Push this repo to GitHub/GitLab and import it in Vercel (framework preset: Next.js, no custom build command).
2. Add environment variables (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Leave `NEXT_PUBLIC_DEMO_MODE` unset (or `false`).
3. Deploy. Then in Supabase **Authentication → URL Configuration** set the Site URL to your Vercel domain and add `https://<domain>/auth/callback` (and your preview domain pattern if needed).
4. Open the site on a phone and install it (below).

> If Supabase variables are missing at build time, the deployed site silently runs in demo mode. Check the amber "Demo mode" banner.

## Installing on a phone (PWA)

- **Android (Chrome):** open the site → menu → *Install app* / *Add to Home screen*.
- **iPhone (Safari):** open the site → Share → *Add to Home Screen*.

The service worker is only registered in production builds. It caches only public static assets and an offline page. **Pages, API responses and Supabase data are never cached**, and writes are never queued offline: with no connection you'll see an offline banner and save buttons are disabled. This is deliberate — an unreliable offline sync on shared money is worse than none.

## Architecture

```
src/
  lib/core/       Pure logic: money (fils), splits, balances, debt simplification, validation, reports/CSV
  lib/store/      Repo interface + DemoRepo (localStorage) + SupabaseRepo (RLS + RPC)
  lib/supabase/   Browser/server clients, env detection
  components/     UI (shadcn-style primitives in components/ui), app shell, forms
  app/(app)/      Authenticated screens: dashboard, expenses, settle, reports, profile, activity
  app/(auth)/     Login / sign-up
  middleware.ts   Session refresh + redirect unauthenticated users
supabase/migrations/  Schema, RLS, transactional functions, storage
tests/                Vitest suites
```

Key decisions:

- **Money is integer fils everywhere** (UI parses decimal strings straight to integers; Postgres uses `bigint`).
- **All writes go through `SECURITY DEFINER` Postgres functions** (`save_expense`, `record_settlement`, …). Each call is a single transaction, re-validates input, checks membership/role from `auth.uid()`, and writes the activity log. Direct INSERT/UPDATE/DELETE on those tables is revoked, and RLS limits SELECT to group members.
- **Defence in depth for splits:** validated in the browser, again in the function, and a deferred constraint trigger guarantees `sum(shares) = amount` at commit.
- **Duplicate prevention:** every form generates a `client_request_id` once; `unique (group_id, client_request_id)` makes retries/double-taps return the original record.
- **Audit history** is written by a deferred database trigger (`0005`), so it fires at commit after the splits are final and can't be skipped by the app. The table is select-only for clients and blocks updates and direct deletes. Changes made directly in the database (SQL editor) are still captured, shown as "Direct database change". Edits made *before* `0005` was applied are only in the activity log, not itemised.
- **Settlement confirmation** (`0006`): balances count every settlement that is not undone, from the moment it is recorded, so confirming can never double-apply it. `record_settlement` takes a per-pair advisory lock; if the *other* party already recorded the same direction + amount and it is still unconfirmed, the call becomes a confirmation of that row instead of inserting a second one. `confirm_settlement` is idempotent and only the payer/receiver who did *not* record it may confirm. Different amounts (partial payments) and repeated same-amount payments by the same person are separate records.
- **Deletes are soft** (`deleted_at`) so the audit trail survives; settlements are never deleted, only undone with a reason.
- **Who can edit/delete an expense:** its creator, its payer, or a group admin. **Record a settlement:** the payer, the receiver, or an admin. **Undo:** those people or the recorder.
- The browser loads a whole group in one go (`loadGroup`) and computes balances client-side — appropriate for small groups; add pagination/server aggregation if groups grow large.
- Receipts live in a **private** bucket at `<group_id>/<uuid>`; access needs group membership and is served through 60-second signed URLs.
- Avatars live in a public-read bucket under unguessable file names (write access limited to your own folder).

## Security notes

- No service-role key anywhere in the codebase. `.env*` files are git-ignored.
- Invitation codes: 48 bits from a CSPRNG, expiring, use-limited, admin-only, with one generic error for all failure modes. For extra brute-force protection enable Supabase's rate limits / CAPTCHA.
- CSV export neutralises spreadsheet formula injection (`=`, `+`, `-`, `@` prefixes).
- `?next=` redirects are restricted to same-site relative paths.
- Security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) are set in `next.config.mjs`. Add a Content-Security-Policy once you've decided on your final script/image sources.
- Not implemented: rate limiting, removal of members, deleting a group, password reset UI (use Supabase's built-in recovery emails), account deletion.

## Tests

`npm test` covers: equal split between four, selected members only, exact amounts, percentages, rounding, multiple payers, full/partial settlements, undo, edit, delete, unauthorized group access, duplicate-submission prevention, invitation expiry, role-based edit/delete, CSV injection, and the invariant that **balances always sum to zero** (including 200 randomised runs).

The authorization/idempotency tests run against `DemoRepo`, which mirrors the SQL functions. They do **not** execute the SQL; use `supabase/tests/verify.sql` for that.

## Future-ready (not built)

The model leaves room for: receipt OCR (`receipt_path` + private bucket), WhatsApp sharing of balances (`simplifyDebts` output is ready), reminders and recurring expenses (new tables + a scheduled job), multiple currencies (`groups.currency` exists; relax its check and add per-expense currency), multiple groups (data model and `selectGroup` already support it; only a group switcher UI is missing), and analytics (`summarizeMonth`).

# CLAUDE.md — ColleagueSplit

Mobile-first AED expense-splitting PWA. Next.js 15 (App Router) + TypeScript + Tailwind 3 + Supabase.

## Commands
- `npm run dev` — dev server (demo mode if Supabase env vars are empty)
- `npm test` — Vitest (`tests/`), `npm run lint`, `npm run typecheck`, `npm run build`
- Always run test + typecheck + lint + build before finishing a change.

## Hard rules
- **Money is integer fils.** Never use floats for amounts. Parse with `parseAmountToFils`, format with `formatAed`. Shares must sum exactly to the total (`lib/core/money.ts`).
- **Balance sum is always 0.** Don't compute balances anywhere except `lib/core/balances.ts`.
- **All DB writes go through RPC functions** in `supabase/migrations/0003_functions.sql`. Never add INSERT/UPDATE/DELETE grants or policies for the client on money tables. Never use or reference a service-role key.
- **Validation lives in three places that must stay in sync:** `lib/core/validate.ts` (client + DemoRepo), the SQL functions, and table CHECK constraints.
- **Authorization rules must match in `DemoRepo` (`lib/store/demo.ts`) and SQL** — edit/delete expense: creator, payer or admin; record settlement: payer, receiver or admin; undo: those or recorder (reason required); invite: admin only.
- Forms create a `clientRequestId` once (`useRef(uuid())`); keep that for idempotency.
- The service worker (`public/sw.js`) must never cache HTML, API or Supabase responses and must never queue writes.

## Layout
- `src/lib/core/*` pure logic (unit-tested) · `src/lib/store/*` `Repo` interface with `DemoRepo` and `SupabaseRepo` · `src/components/app-provider.tsx` loads the user + active group bundle and derives balances.
- UI primitives (`components/ui/*`) are hand-written shadcn-style components (cva + Radix).
- Routes: `(app)` = authenticated shell with bottom nav; `(auth)` = login/signup; `/offline` is public + static.
- Schema changes = new numbered migration in `supabase/migrations/`; never edit an applied one. Update `supabase/tests/verify.sql` and the README if behaviour changes.

## Gotchas
- Demo mode is chosen at build time from `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` (`lib/supabase/env.ts`); `NEXT_PUBLIC_DEMO_MODE=true` forces it.
- SQL has not been run against a live database in this repo's history unless noted in the README status table.
- Not implemented on purpose (see README "Future-ready"): OCR, WhatsApp share, reminders, recurring, multi-currency, multi-group switcher UI, analytics.

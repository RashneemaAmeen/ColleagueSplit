// NEXT_PUBLIC_* values are inlined at build time. They are safe for the browser:
// the anon key only grants what Row Level Security allows.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when Supabase isn't configured (or demo mode is forced). */
export const IS_DEMO =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !SUPABASE_URL || !SUPABASE_ANON_KEY;

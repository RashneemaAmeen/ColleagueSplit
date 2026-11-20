/**
 * "Remember me" support.
 *
 * Supabase keeps the login in long-lived cookies. When the user unticks "Remember me" we want the
 * login to end when the browser is closed. We do that with two non-sensitive marker cookies:
 *  - `cs_alive`        session cookie (vanishes when the browser closes)
 *  - `cs_no_remember`  long-lived cookie, only present when the user opted out
 * The middleware drops the auth cookies when `cs_no_remember` exists but `cs_alive` does not,
 * i.e. on the first request after the browser was closed and reopened.
 */
export const ALIVE_COOKIE = "cs_alive";
export const NO_REMEMBER_COOKIE = "cs_no_remember";

export function setRememberPreference(remember: boolean): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ALIVE_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
  document.cookie = remember
    ? `${NO_REMEMBER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
    : `${NO_REMEMBER_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

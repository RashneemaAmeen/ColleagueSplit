import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ALIVE_COOKIE, NO_REMEMBER_COOKIE } from "@/lib/supabase/remember";

/**
 * Server-side session gate:
 *  - refreshes the Supabase auth cookie on every request (so logins persist securely)
 *  - redirects unauthenticated visitors to /login for every private page
 * In demo mode (no Supabase env) it does nothing.
 */
const PUBLIC_PATHS = ["/login", "/signup", "/offline", "/auth"];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !url || !key) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  // "Remember me" was off and the browser has since been closed: end the login.
  if (request.cookies.has(NO_REMEMBER_COOKIE) && !request.cookies.has(ALIVE_COOKIE)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = path === "/" || isPublic ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const res = isPublic ? NextResponse.next() : NextResponse.redirect(login);
    request.cookies.getAll().forEach(({ name }) => {
      if (name.startsWith("sb-") || name === NO_REMEMBER_COOKIE) res.cookies.delete(name);
    });
    return res;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() validates the JWT with Supabase Auth (getSession() alone is not trustworthy server-side).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Keep the destination (e.g. an invite link) so we can return after sign-in.
    login.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  // Skip static assets, the service worker, manifest and icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};

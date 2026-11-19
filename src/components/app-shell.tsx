"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, Plus, Receipt, Scale, User, FlaskConical } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { GroupSwitcher } from "@/components/group-switcher";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/expenses/new", label: "Add", icon: Plus, primary: true },
  { href: "/settle", label: "Settle Up", icon: Scale },
  { href: "/profile", label: "Profile", icon: User },
] as const;

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/expenses") return path === "/expenses" || (path.startsWith("/expenses/") && !path.startsWith("/expenses/new"));
  return path === href || path.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, me, groups, isDemo, data, loadError, refresh } = useApp();
  const router = useRouter();
  const path = usePathname();
  const onWelcome = path === "/welcome" || path.startsWith("/join");

  React.useEffect(() => {
    if (!ready) return;
    if (!me) router.replace(`/login${path !== "/" ? `?next=${encodeURIComponent(path)}` : ""}`);
    else if (groups.length === 0 && !onWelcome) router.replace("/welcome");
  }, [ready, me, groups.length, onWelcome, path, router]);

  if (!ready || !me || (groups.length === 0 && !onWelcome)) return <ShellSkeleton />;

  if (onWelcome) {
    return (
      <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-safe">
        <div className="pt-8">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-28 md:pb-10">
      {isDemo && (
        <div className="pt-safe bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">
          <FlaskConical className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Demo mode — sample data stored only in this browser
        </div>
      )}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="ColleagueSplit home">
            <LogoMark size={28} />
            <span className="hidden sm:inline">ColleagueSplit</span>
          </Link>
          <GroupSwitcher />
          {/* Desktop nav (mobile uses the bottom bar) */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.filter((n) => !("primary" in n && n.primary)).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  isActive(path, n.href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {n.label}
              </Link>
            ))}
            <Button asChild size="sm" className="ml-2">
              <Link href="/expenses/new">
                <Plus className="h-4 w-4" /> Add expense
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-5">
        {loadError && !data ? (
          <div className="rounded-2xl border border-negative/30 bg-negative/5 p-4 text-sm">
            <p className="font-medium text-negative">Couldn&apos;t load your group</p>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refresh()}>
              Try again
            </Button>
          </div>
        ) : data ? (
          children
        ) : (
          <ShellSkeleton inline />
        )}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            const Icon = n.icon;
            return (
              <li key={n.href} className="flex justify-center">
                {"primary" in n && n.primary ? (
                  <Link
                    href={n.href}
                    aria-label="Add expense"
                    className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background active:scale-95"
                  >
                    <Icon className="h-7 w-7" />
                  </Link>
                ) : (
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {n.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function ShellSkeleton({ inline = false }: { inline?: boolean }) {
  return (
    <div className={cn("mx-auto max-w-2xl space-y-4 px-4", inline ? "" : "pt-16")} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-56 w-full rounded-2xl" />
    </div>
  );
}

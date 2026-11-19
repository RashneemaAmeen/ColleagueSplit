import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline" };

// Static, public, contains no user data: safe for the service worker to cache.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <WifiOff className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold">You&apos;re offline</h1>
      <p className="mt-2 text-muted-foreground">
        ColleagueSplit needs a connection to show balances and save changes, so nothing is stored on this device for offline use. Reconnect and try again.
      </p>
      {/* A full page load (not client navigation) is intended: we need to re-hit the network. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
        Try again
      </a>
    </main>
  );
}

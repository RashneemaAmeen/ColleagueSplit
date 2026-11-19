"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";

/**
 * Registers the service worker (production only) and shows a banner while offline.
 * Financial writes are NOT queued offline — see the forms, which block submit when offline.
 */
export function PwaSupport() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* PWA install is a progressive enhancement; ignore failures */
    });
  }, []);
  return <OfflineBanner />;
}

export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="pt-safe fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-black"
    >
      <WifiOff className="h-4 w-4" aria-hidden />
      You&apos;re offline. You can view this screen, but adding or changing expenses needs a connection.
    </div>
  );
}

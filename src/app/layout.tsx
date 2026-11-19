import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "@/components/app-provider";
import { PwaSupport } from "@/components/pwa";
import { themeInitScript } from "@/components/theme";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "ColleagueSplit", template: "%s · ColleagueSplit" },
  description: "Spend together. Split smarter. Share lunch, coffee and snack expenses with your colleagues.",
  applicationName: "ColleagueSplit",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ColleagueSplit", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/192", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/180", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f766e" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1512" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ToastProvider>
          <AppProvider>
            <PwaSupport />
            {children}
          </AppProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
